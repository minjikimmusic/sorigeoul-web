import numpy as np
_models = {}
_device = None

def device(A):
    global _device
    if _device is not None:
        return _device
    want = A.get('f0_device', 'auto')
    if want != 'auto':
        _device = want
        return _device
    _device = 'cpu'
    try:
        import torch
        if torch.backends.mps.is_available():
            _device = 'mps'
        elif torch.cuda.is_available():
            _device = 'cuda'
    except Exception:
        pass
    return _device

def available():
    try:
        import pesto
        return True
    except Exception:
        return False

def _model(sample_rate, A):
    key = (A['pesto_model'], int(sample_rate), A['hop_ms'], device(A))
    if key not in _models:
        import pesto
        m = pesto.load_model(A['pesto_model'], step_size=float(A['hop_ms']), sampling_rate=int(sample_rate)).to(device(A))
        box = {}
        m.encoder.fc.register_forward_hook(lambda mod, inp, out: box.__setitem__('logits', out.detach().clone()))
        _models[key] = (m, box)
    return _models[key]

def warmup(A):
    try:
        predict(np.zeros(int(0.3 * 48000), dtype=np.float32), 48000, A)
        return True
    except Exception:
        return False

def normalize(samples, A):
    samples = np.asarray(samples, dtype=np.float32)
    target = A.get('pesto_normalize_peak')
    peak = float(np.abs(samples).max()) if len(samples) else 0.0
    if target and peak >= A.get('pesto_silence_peak', 0.001):
        samples = samples * (target / peak)
    return samples

def decode(logits, shift_bins, bps, A):
    lg = np.roll(np.asarray(logits, dtype=np.float64), -shift_bins, axis=-1)
    n_bins = lg.shape[-1]
    midi = np.arange(n_bins, dtype=np.float64) / bps
    lo = 69 + 12 * np.log2(A['f0_fmin_hz'] / 440.0)
    hi = 69 + 12 * np.log2(A['f0_fmax_hz'] / 440.0)
    allowed = (midi >= lo) & (midi <= hi)
    b = np.where(allowed, lg, -np.inf).argmax(-1)
    rows = np.arange(lg.shape[0])
    how = A.get('pesto_decoder', 'parabolic')
    if how == 'alwa':
        p = np.exp(lg - lg.max(-1, keepdims=True))
        p /= p.sum(-1, keepdims=True)
        idx = np.clip(b[:, None] + np.arange(-(bps - 1), bps)[None], 0, n_bins - 1)
        w = np.take_along_axis(p, idx, -1)
        return (w * idx).sum(-1) / w.sum(-1) / bps
    if how == 'parabolic':
        i0 = np.clip(b, 1, n_bins - 2)
        l_m, l_0, l_p = (lg[rows, i0 - 1], lg[rows, i0], lg[rows, i0 + 1])
        den = l_m - 2 * l_0 + l_p
        delta = np.where(den < 0, 0.5 * (l_m - l_p) / np.minimum(den, -1e-12), 0.0)
        return (i0 + np.clip(delta, -0.5, 0.5)) / bps
    raise ValueError(f'알 수 없는 pesto_decoder: {how!r} ("parabolic" 또는 "alwa")')

def predict(samples, sample_rate, A):
    import torch
    hop = int(A['hop_ms'] * sample_rate / 1000 + 0.5)
    if hop < 1:
        raise ValueError(f"hop_ms({A['hop_ms']})가 표본율({sample_rate})에 비해 너무 작습니다")
    m, box = _model(sample_rate, A)
    samples = normalize(samples, A)
    x = torch.from_numpy(np.ascontiguousarray(samples)).to(device(A))
    with torch.inference_mode():
        _, conf, _, _ = m(x, sr=int(sample_rate), convert_to_freq=False, return_activations=True)
        logits = box['logits']
    bps = m.bins_per_semitone
    semis = decode(logits.detach().to('cpu').numpy(), round(m.shift.cpu().item() * bps), bps, A)
    f0 = 440.0 * 2 ** ((semis - 69) / 12)
    return (f0.astype(float), conf.detach().cpu().numpy().astype(float).reshape(-1))
