import json
import time
import numpy as np
import config
from server import analysis, dummy, f0, report, wav
CHUNK_FRAMES = 512
META = None
_kernels = {}

def set_meta(meta):
    global META
    if isinstance(meta, str):
        meta = json.loads(meta)
    want = config.ANALYSIS['pesto_model']
    if meta.get('model') != want:
        raise ValueError(f"ONNX 모델({meta.get('model')})이 config의 pesto_model({want})과 다릅니다. tools/export_onnx.py로 다시 만드십시오.")
    META = dict(meta)
    _kernels.clear()

def hann(n):
    if n <= 1:
        return np.ones(n)
    fac = np.linspace(-np.pi, np.pi, n + 1)
    w = np.zeros(n + 1)
    w += 0.5 * np.cos(0 * fac)
    w += 0.5 * np.cos(1 * fac)
    return w[:-1]

def cqt_kernel(sr, hcqt):
    if list(hcqt.get('harmonics', [1])) != [1]:
        raise ValueError('배음이 여러 개인 HCQT는 옮기지 않았습니다(mir-1k_g7은 배음 1개)')
    bps = hcqt['bins_per_semitone']
    n_bins = hcqt['n_bins']
    gamma = hcqt.get('gamma', 0)
    fmin = hcqt['fmin']
    if hcqt.get('center_bins', True):
        fmin = fmin / 2 ** ((bps - 1) / (24 * bps))
    bins_per_octave = 12 * bps
    Q = 1.0 / (2 ** (1 / bins_per_octave) - 1)
    freqs = fmin * 2.0 ** (np.r_[0:n_bins] / np.double(bins_per_octave))
    if np.max(freqs) > sr / 2:
        raise ValueError(f'표본율 {sr}Hz로는 가장 높은 칸 {np.max(freqs):.0f}Hz를 잴 수 없습니다')
    alpha = 2.0 ** (1.0 / bins_per_octave) - 1.0
    lengths = np.ceil(Q * sr / (freqs + gamma / alpha))
    width = int(2 ** np.ceil(np.log2(int(max(lengths)))))
    k = np.zeros((n_bins, width), dtype=np.complex64)
    for i in range(n_bins):
        l = lengths[i]
        if l % 2 == 1:
            start = int(np.ceil(width / 2.0 - l / 2.0)) - 1
        else:
            start = int(np.ceil(width / 2.0 - l / 2.0))
        sig = hann(int(l)) * np.exp(np.r_[-l // 2:l // 2] * 1j * 2 * np.pi * freqs[i] / sr) / l
        k[i, start:start + int(l)] = sig / np.linalg.norm(sig, 1)
    weight = np.concatenate((k.real, -k.imag), axis=0)
    sqrt_lengths = np.sqrt(lengths.astype(np.float32))
    return (np.ascontiguousarray(weight.T), sqrt_lengths, width)

def kernel_for(sr):
    sr = int(sr)
    if sr not in _kernels:
        if META is None:
            raise RuntimeError('pesto_web.set_meta()를 먼저 부르십시오')
        _kernels[sr] = cqt_kernel(sr, META['hcqt_params'])
    return _kernels[sr]

def hop_length(sr, A):
    hop = int(A['hop_ms'] * sr / 1000 + 0.5)
    if hop < 1:
        raise ValueError(f"hop_ms({A['hop_ms']})가 표본율({sr})에 비해 너무 작습니다")
    return hop

def frame_chunks(x, hop, width, chunk=CHUNK_FRAMES):
    x = np.asarray(x, dtype=np.float32)
    half = width // 2
    if len(x) <= half:
        raise ValueError(f'구간이 너무 짧습니다({len(x)}표본). 반사 채움에 {half + 1}표본 이상이 필요합니다.')
    padded = np.pad(x, (half, half), mode='reflect')
    n = 1 + len(x) // hop
    step = padded.strides[0]
    for a in range(0, n, chunk):
        m = min(chunk, n - a)
        need = (m - 1) * hop + width
        part = padded[a * hop:a * hop + need]
        if len(part) < need:
            raise ValueError(f'창 길이({width})가 짝수가 아니라 마지막 창이 채운 소리 밖으로 나갑니다.')
        yield np.ascontiguousarray(np.lib.stride_tricks.as_strided(part, shape=(m, width), strides=(hop * step, step), writeable=False))

def _from_core(out, n):
    logits, conf = (out[0], out[1])
    if hasattr(logits, 'to_bytes'):
        logits = np.frombuffer(logits.to_bytes(), dtype=np.float32)
        conf = np.frombuffer(conf.to_bytes(), dtype=np.float32)
    return (np.asarray(logits, dtype=np.float32).reshape(n, -1), np.asarray(conf, dtype=np.float32).reshape(n))

def _begin(samples, sr, A):
    try:
        kernel, sqrt_lengths, width = kernel_for(sr)
    except ValueError as e:
        raise analysis.AnalysisError(f'이 마이크 설정으로는 음높이를 잴 수 없어요(녹음 표본율 {int(sr)}Hz가 너무 낮아요). 다른 마이크로 바꿔 주세요.') from e
    x = f0.normalize(samples, A)
    if len(x) <= width // 2:
        raise analysis.AnalysisError(f'분석할 구간이 {len(x) / sr:.2f}초뿐이라 음고를 잴 수 없습니다. 녹음이 학생 차례를 다 담지 못했어요. 다시 불러 주세요.')
    return (x, hop_length(sr, A), kernel, sqrt_lengths, width)

def _end(logits, conf, A):
    semis = f0.decode(np.concatenate(logits), META['shift_bins'], META['bins_per_semitone'], A)
    hz = 440.0 * 2 ** ((semis - 69) / 12)
    return (hz.astype(float), np.concatenate(conf).astype(float).reshape(-1))

def predict(samples, sr, A, run_core):
    x, hop, kernel, sl, width = _begin(samples, sr, A)
    lg, cf = ([], [])
    for frames in frame_chunks(x, hop, width):
        a, b = _from_core(run_core(frames, kernel, sl), len(frames))
        lg.append(a)
        cf.append(b)
    return _end(lg, cf, A)

async def predict_async(samples, sr, A, run_core):
    x, hop, kernel, sl, width = _begin(samples, sr, A)
    lg, cf = ([], [])
    for frames in frame_chunks(x, hop, width):
        a, b = _from_core(await run_core(frames, kernel, sl), len(frames))
        lg.append(a)
        cf.append(b)
    return _end(lg, cf, A)

async def warm(sr, run_core):
    await predict_async(np.zeros(int(0.3 * int(sr)), dtype=np.float32), int(sr), config.ANALYSIS, run_core)
    return True

async def analyze(wav_bytes, song_id, timing_json, expert_json, run_core, engine_json='{}'):
    t0 = time.perf_counter()
    if hasattr(wav_bytes, 'to_bytes'):
        wav_bytes = wav_bytes.to_bytes()
    try:
        timing = json.loads(timing_json) if timing_json else {}
    except json.JSONDecodeError:
        timing = {}
    expert = json.loads(expert_json) if expert_json else None
    engine = json.loads(engine_json) if engine_json else {}
    A = config.ANALYSIS
    if song_id not in config.SONGS:
        return json.dumps({'error': f'알 수 없는 곡입니다: {song_id}'}, ensure_ascii=False)
    if A['dummy_mode']:
        result = dummy.student_result(song_id)
        result['feedback_basis'] = {}
    else:
        try:
            prep = analysis.prepare(wav_bytes, song_id, timing)
            preds = [await predict_async(s['samples'], prep.sr, A, run_core) for s in prep.segments]
            result = analysis.finish(prep, preds, expert, dict(engine, f0_variant=f"{A['pesto_model']} {A['pesto_decoder']} · ONNX"))
        except (analysis.AnalysisError, wav.WavError) as e:
            return json.dumps({'error': str(e)}, ensure_ascii=False)
        result = report.with_feedback(result, song_id, expert)
    result['received_audio_bytes'] = len(wav_bytes)
    result['received_timing'] = timing
    result['elapsed_seconds'] = round(time.perf_counter() - t0, 3)
    return json.dumps(result, ensure_ascii=False, allow_nan=False)
