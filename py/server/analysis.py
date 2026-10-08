import dataclasses
import os
import sys
import time
import numpy as np
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import config
import pitch
from server import f0 as f0_engine
from server import wav
PAD_S = 0.1

class AnalysisError(ValueError):
    pass

def _anchor_cents(expert, song):
    if expert and (not expert.get('dummy')) and expert.get('curve'):
        v = [c['cents'] for c in expert['curve'] if c['cents'] is not None]
        if len(v) >= 30:
            return float(np.median(v))
    notes = list(song.get('notes_cents', {}).values())
    return float(np.median(notes)) if notes else None

def _windows(timing_info, tm):
    ws = (timing_info or {}).get('student_windows') or []
    out = []
    for w in ws:
        try:
            out.append(float(w['start_s']))
        except (KeyError, TypeError, ValueError):
            raise AnalysisError('학생 장단 구간(student_windows)의 형식이 잘못되었습니다.')
    if not out:
        raise AnalysisError('학생 장단 구간(student_windows)이 비어 있어 어디를 분석할지 알 수 없습니다.')
    if len(out) != tm['n_jangdan']:
        raise AnalysisError(f"학생 장단 구간이 {len(out)}개인데 화면은 {tm['n_jangdan']}장단을 그립니다. 장단 수는 config.jangdan_count()가 한 곳에서 정하므로, 클라이언트가 낡은 설정을 들고 있는 것입니다(브라우저를 새로 고치거나 서버를 다시 켜 주세요).")
    return out
LATENCY_RANGE_S = (-0.05, 1.0)

def _latency(timing_info, A):
    ti = timing_info or {}
    try:
        out_lat = float(ti.get('output_latency_s') or 0.0)
    except (TypeError, ValueError):
        out_lat = 0.0
    dev = ti.get('device_latency_s')
    try:
        dev = float(dev) if dev is not None else None
    except (TypeError, ValueError):
        dev = None
    if dev is not None and np.isfinite(dev) and (LATENCY_RANGE_S[0] <= dev <= LATENCY_RANGE_S[1]):
        method = ti.get('latency_method')
        return (dev, method if method in ('auto', 'previous', 'fixed') else 'client', out_lat)
    return (out_lat + A['mic_latency_ms'] / 1000.0, 'fixed', out_lat)

def _latency_auto(timing_info):
    a = (timing_info or {}).get('latency_auto')
    if not isinstance(a, dict):
        return None
    keep = ('ok', 'delay_s', 'contrast', 'agree', 'n_groups', 'per_group_s', 'reason', 'ms')
    return {k: a.get(k) for k in keep}

@dataclasses.dataclass
class Prep:
    song_id: str
    sr: int
    tm: dict
    samples_len: int
    input_peak: float
    starts: list
    out_lat: float
    offset: float
    latency_method: str
    latency_auto: object
    segments: list
    t_start: float
    ready_segments: list = dataclasses.field(default_factory=list)

def _ready_lag():
    seq = config.TURN_TAKING['sequence_per_pair']
    if 'ready' not in seq or 'student' not in seq:
        return None
    lag = seq.index('student') - seq.index('ready')
    return lag if lag > 0 else None

def _cut_inside(samples, sr, start_s, length_s):
    if start_s < 0:
        return None
    seg, pad_before, cut_tail = wav.cut(samples, sr, start_s, length_s, PAD_S)
    return None if cut_tail else {'samples': seg, 'pad_before': pad_before}
TURN_GAP_TOL_S = 0.05

def _ready_segments(samples, sr, starts, offset, J, lag):
    gap = len(config.TURN_TAKING['sequence_per_pair']) * J
    if any((abs(b - a - gap) > TURN_GAP_TOL_S for a, b in zip(starts, starts[1:]))):
        return []
    return [_cut_inside(samples, sr, s - lag * J + offset, J) for s in starts]

def prepare(wav_bytes, song_id, timing_info):
    t_start = time.perf_counter()
    jd = config.jangdan_for(song_id)
    A = config.ANALYSIS
    tm = pitch.timing_block(jd, config.jangdan_count(song_id))
    samples, sr = wav.read_wav(wav_bytes)
    if len(samples) < sr * 0.5:
        raise AnalysisError('녹음이 0.5초도 되지 않습니다. 마이크가 소리를 받았는지 확인해 주세요.')
    if not np.any(samples):
        raise AnalysisError(f'녹음 {len(samples) / sr:.1f}초가 완전히 무음입니다. 마이크에서 소리가 들어오지 않았어요. 주소창 왼쪽의 사이트 설정에서 마이크가 허용되어 있고 실제 마이크 장치가 골라져 있는지, 기기 설정에서 이 브라우저가 마이크를 쓸 수 있는지(맥: 시스템 설정 → 개인정보 보호 및 보안 → 마이크) 확인해 주세요.')
    starts = _windows(timing_info, tm)
    offset, method, out_lat = _latency(timing_info, A)
    segments = []
    for start_s in starts:
        seg, pad_before, cut_tail = wav.cut(samples, sr, start_s + offset, tm['jangdan_seconds'], PAD_S)
        segments.append({'samples': seg, 'pad_before': pad_before, 'cut_tail': cut_tail, 'peak': round(float(np.abs(seg).max()) if len(seg) else 0.0, 4)})
    ready, lag = ([], _ready_lag())
    if config.measures_voice(song_id) and lag:
        ready = _ready_segments(samples, sr, starts, offset, tm['jangdan_seconds'], lag)
    return Prep(song_id=song_id, sr=int(sr), tm=tm, samples_len=len(samples), input_peak=round(float(np.abs(samples).max()), 4), starts=starts, out_lat=out_lat, offset=offset, latency_method=method, latency_auto=_latency_auto(timing_info), segments=segments, t_start=t_start, ready_segments=ready)

def finish(prep, predictions, expert=None, engine=None):
    if len(predictions) != len(prep.segments):
        raise ValueError(f'학생 장단 {len(prep.segments)}개에 음고 결과가 {len(predictions)}개입니다')
    song = config.SONGS[prep.song_id]
    A = config.ANALYSIS
    hop_s = A['hop_ms'] / 1000.0
    tm = prep.tm
    per_jangdan = int(round(tm['jangdan_seconds'] / hop_s))
    f0_all, conf_all = ([], [])
    voice = [] if config.measures_voice(prep.song_id) else None
    clipped = []
    truncated = any((s['cut_tail'] for s in prep.segments))
    for j, (s, (f, c)) in enumerate(zip(prep.segments, predictions)):
        skip = int(round(s['pad_before'] / hop_s))
        f, c = (f[skip:skip + per_jangdan], c[skip:skip + per_jangdan])
        if voice is not None:
            lv = pitch.voice_level(s['samples'], prep.sr, A)[skip:skip + per_jangdan]
            voice.append(np.concatenate([lv, np.full(per_jangdan - len(lv), np.nan)]))
            clipped += [j * per_jangdan + k - skip for k in pitch.clipped_frames(s['samples'], prep.sr, A) if 0 <= k - skip < min(len(lv), per_jangdan)]
        if len(f) < per_jangdan:
            k = per_jangdan - len(f)
            f = np.concatenate([f, np.zeros(k)])
            c = np.concatenate([c, np.zeros(k)])
            truncated = True
        f0_all.append(f)
        conf_all.append(c)
    f0_hz = np.concatenate(f0_all)
    conf = np.concatenate(conf_all)
    cent = pitch.to_cents(f0_hz, song['bonchung_hz'])
    ok = (conf >= A['confidence_threshold']) & (f0_hz > 0)
    cent, ok, fixed, odd = pitch.fix_octave(cent, ok)
    ok, spikes = pitch.despike(cent, ok)
    odd += spikes
    cent, oct_k, med_cents = pitch.octave_fold(cent, ok, _anchor_cents(expert, song)) if A['student_octave_fold'] else (cent, 0, None)
    segs, segs_alt, diag, diag2 = pitch.analyze_cents(cent, ok, hop_s, A, song, tm['sobak_seconds'])
    times = np.arange(len(cent)) * hop_s
    curve = pitch.build_curve(times, cent, ok)
    eng = {'f0_device': None, 'f0_variant': f"{A['pesto_model']} {A['pesto_decoder']}"}
    eng.update(engine or {})
    if eng['f0_device'] is None:
        eng['f0_device'] = f0_engine.device(A)
    out = {'song_id': prep.song_id, 'role': 'student', 'dummy': False, 'live': True, 'bonchung_hz': song['bonchung_hz'], 'timing': tm, 'curve': curve, 'segments': segs, 'segments_alt': segs_alt, 'source': {'input': 'microphone', 'f0_model': A['f0_model'], **eng, 'sample_rate': prep.sr, 'recording_seconds': round(prep.samples_len / prep.sr, 3), 'input_peak': prep.input_peak, 'student_window_peaks': [s['peak'] for s in prep.segments], 'student_window_starts_s': [round(s, 3) for s in prep.starts], 'latency_offset_s': round(prep.offset, 4), 'latency_method': prep.latency_method, 'latency_auto': prep.latency_auto, 'output_latency_s': round(prep.out_lat, 4), 'mic_latency_ms': A['mic_latency_ms'], 'confidence_threshold': A['confidence_threshold'], 'window_ms': A['window_ms'], 'thresholds': {k: A[k] for k in ('stable_std_cents_max', 'moving_slope_cents_per_s', 'sigimsae_peak_ratio_min')}, 'octave_fixed_frames': int(fixed), 'outlier_frames_dropped': int(odd), 'valid_ratio': round(float(ok.mean()), 3), 'octave_shift': oct_k, 'octave_anchor_cents': _anchor_cents(expert, song), 'median_cents_before_fold': med_cents, 'recording_truncated': truncated, 'sigimsae_diagnostics': diag, 'sigimsae_diagnostics_alt': diag2, 'analysis_seconds': round(time.perf_counter() - prep.t_start, 3)}}
    if voice is not None:
        out['voice_db'] = pitch.level_list(np.concatenate(voice))
        out['voice_clipped'] = sorted(clipped)
        out['source']['voice_level'] = {'band_hz': list(A['voice_band_hz']), 'window_ms': A['voice_level_window_ms']}
        backing = _backing_db(prep, per_jangdan, hop_s, A)
        if backing is not None:
            out['backing_db'], n_ready = backing
            out['source']['voice_level']['backing_ready_jangdan'] = n_ready
    return out

def _backing_db(prep, per_jangdan, hop_s, A):
    rows = []
    for s in prep.ready_segments:
        if s is None:
            continue
        skip = int(round(s['pad_before'] / hop_s))
        lv = pitch.voice_level(s['samples'], prep.sr, A)[skip:skip + per_jangdan]
        if len(lv) == per_jangdan:
            rows.append(lv)
    if not rows:
        return None
    return (pitch.level_list(np.median(np.array(rows), axis=0)), len(rows))

def analyze_wav(wav_bytes, song_id, timing_info, expert=None):
    prep = prepare(wav_bytes, song_id, timing_info)
    preds = [f0_engine.predict(s['samples'], prep.sr, config.ANALYSIS) for s in prep.segments]
    return finish(prep, preds, expert)
