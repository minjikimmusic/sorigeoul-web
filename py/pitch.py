import math
import numpy as np

def to_cents(f_hz, bonchung_hz):
    f = np.asarray(f_hz, dtype=float)
    return np.where(f > 0, 1200 * np.log2(np.maximum(f, 1e-06) / bonchung_hz), 0.0)

def fix_octave(cents, ok, win=100, tol=120, drop_over=700):
    out = cents.copy()
    ok2 = ok.copy()
    fixed = 0
    dropped = 0
    for i in np.where(ok)[0]:
        lo, hi = (max(0, i - win), min(len(cents), i + win))
        near = cents[lo:hi][ok[lo:hi]]
        if len(near) < 20:
            continue
        d = cents[i] - np.median(near)
        for k in (1, -1, 2, -2):
            if abs(d - 1200 * k) < tol:
                out[i] = cents[i] - 1200 * k
                fixed += 1
                break
        else:
            if abs(d) > drop_over:
                ok2[i] = False
                dropped += 1
    return (out, ok2, fixed, dropped)

def despike(cents, ok, half=8, thr=250, min_near=3):
    ok2 = ok.copy()
    n = len(cents)
    dropped = 0
    for i in range(n):
        if not ok[i]:
            continue
        lo, hi = (max(0, i - half), min(n, i + half + 1))
        near = [cents[j] for j in range(lo, hi) if j != i and ok[j]]
        if len(near) < min_near:
            continue
        if abs(cents[i] - np.median(near)) > thr:
            ok2[i] = False
            dropped += 1
    return (ok2, dropped)

def octave_fold(cents, valid, anchor_cents, min_frames=30):
    v = np.asarray(cents)[np.asarray(valid, dtype=bool)]
    if anchor_cents is None or len(v) < min_frames:
        return (cents, 0, round(float(np.median(v)), 1) if len(v) else None)
    med = float(np.median(v))
    k = int(round((med - anchor_cents) / 1200.0))
    if k == 0:
        return (cents, 0, round(med, 1))
    return (cents - 1200.0 * k, k, round(med, 1))

def reversals(x, thr):
    k, last, ref = (0, 0, x[0])
    for v in x[1:]:
        d = v - ref
        if abs(d) >= thr:
            s = 1 if d > 0 else -1
            if last and s != last:
                k += 1
            last, ref = (s, v)
    return k

def nongyeon(x, sr, A):
    n = len(x)
    if n < 8:
        return (0.0, 0.0, 0.0)
    x = x - x.mean()
    k = reversals(list(x), A['nongyeon_reversal_cents'])
    rng = float(x.max() - x.min())
    rate = k / (n / sr) / 2.0
    return (rate, rng / 2.0, float(k if rng >= A['nongyeon_range_min_cents'] else 0))

def periodicity(x, sr, method, lo=2.0, hi=12.0):
    n = len(x)
    if n < 8:
        return (0.0, 0.0, 0.0)
    x = x - x.mean()
    extent = float(np.std(x) * math.sqrt(2))
    if method == 'autocorr':
        ac = np.correlate(x, x, 'full')[n - 1:]
        if ac[0] <= 0:
            return (0.0, 0.0, 0.0)
        ac = ac / ac[0]
        k0, k1 = (int(sr / hi), min(n - 3, int(sr / lo)))
        if k1 <= k0:
            return (0.0, extent, 0.0)
        k = k0 + int(np.argmax(ac[k0:k1]))
        return (float(sr / k), extent, float(ac[k]))
    sp = np.abs(np.fft.rfft(x * np.hanning(n)))
    fr = np.fft.rfftfreq(n, 1.0 / sr)
    band = (fr >= lo) & (fr <= hi)
    if not band.any() or sp[band].max() <= 0:
        return (0.0, 0.0, 0.0)
    k = int(np.argmax(sp[band]))
    mean = sp[band].mean()
    return (float(fr[band][k]), extent, float(sp[band][k] / mean if mean > 0 else 0))

def criterion(method, A):
    if method == 'nongyeon':
        return (A['nongyeon_reversals_min'], 0)
    if method == 'autocorr':
        return (A['sigimsae_autocorr_min'], A.get('sigimsae_extent_min_cents', 20))
    return (A['sigimsae_peak_ratio_min'], A.get('sigimsae_extent_min_cents', 20))

def classify(cent, valid, hop_s, A, method):
    n = len(cent)
    W = max(8, int(round(A['window_ms'] / 1000.0 / hop_s)))
    half = W // 2
    lab = np.array([None] * n, dtype=object)
    rate = np.zeros(n)
    ext = np.zeros(n)
    slope = np.zeros(n)
    score_min, ext_min = criterion(method, A)
    scores = []
    for i in range(n):
        lo, hi = (max(0, i - half), min(n, i + half))
        m = valid[lo:hi]
        if m.mean() < 0.6:
            continue
        y = cent[lo:hi][m]
        x = np.arange(lo, hi)[m] * hop_s
        a, b = np.polyfit(x, y, 1)
        resid = y - (a * x + b)
        rstd = float(np.std(resid))
        if method == 'nongyeon':
            r, e, score = nongyeon(resid, 1.0 / hop_s, A)
        else:
            r, e, score = periodicity(resid, 1.0 / hop_s, method)
        slope[i] = a
        scores.append(score)
        if score >= score_min and e >= ext_min and (1.5 <= r <= 12.0):
            lab[i] = 'sigimsae'
            rate[i] = r
            ext[i] = e
        elif rstd <= A['stable_std_cents_max'] and abs(a) < A['moving_slope_cents_per_s']:
            lab[i] = 'stable'
        else:
            lab[i] = 'moving'
    diag = {'method': method, 'score_min': score_min, 'score_max': round(float(max(scores)), 3) if scores else 0.0, 'score_median': round(float(np.median(scores)), 3) if scores else 0.0, 'windows': len(scores), 'sigimsae_frames': int(sum((1 for v in lab if v == 'sigimsae')))}
    return (lab, rate, ext, slope, diag)

def merge(lab, rate, ext, slope, cent, valid, hop_s, sobak_s, notes, tori, min_ms=120):
    n = len(lab)
    runs = []
    i = 0
    while i < n:
        if lab[i] is None:
            i += 1
            continue
        j = i
        while j < n and lab[j] == lab[i]:
            j += 1
        runs.append([i, j, lab[i]])
        i = j
    out = []
    for r in runs:
        dur = (r[1] - r[0]) * hop_s * 1000
        if dur < min_ms and out:
            out[-1][1] = r[1]
        else:
            out.append(r)
    segs = []
    for a, b, kind in out:
        m = valid[a:b]
        if m.sum() < 3:
            continue
        y = cent[a:b][m]
        med = float(np.median(y))
        note, best = (None, 1000000000.0)
        for nm, cv in notes.items():
            if abs(med - cv) < best and abs(med - cv) <= 150:
                note, best = (nm, abs(med - cv))
        s = {'start_sobak': round(a * hop_s / sobak_s, 3), 'end_sobak': round(b * hop_s / sobak_s, 3), 'note': note, 'type': kind, 'median_cents': round(med, 1), 'vibrato_rate': None, 'vibrato_extent_cents': None}
        if kind == 'sigimsae':
            rr = rate[a:b][rate[a:b] > 0]
            ee = ext[a:b][ext[a:b] > 0]
            if len(rr):
                s['vibrato_rate'] = round(float(np.median(rr)), 2)
                s['vibrato_extent_cents'] = round(float(np.median(ee)), 1)
        if kind == 'moving':
            drop = float(y[0] - y[-1])
            dur_s = (b - a) * hop_s
            if tori == 'dongbu' and drop > 0:
                s['descent_cut'] = bool((~m).sum() * hop_s > 0.12)
            if drop >= 80 and dur_s <= 0.45:
                s['kkeok_drop_cents'] = round(drop, 1)
        segs.append(s)
    return segs

def build_curve(times, cent, valid):
    return [{'t': round(float(times[i]), 3), 'cents': round(float(cent[i]), 1) if valid[i] else None} for i in range(len(times))]
VOICE_FLOOR_DB = -120.0

def voice_level(samples, sr, A, chunk=256):
    x = np.asarray(samples, dtype=np.float64)
    sr = int(sr)
    hop = int(A['hop_ms'] * sr / 1000 + 0.5)
    n = 1 + len(x) // hop
    L = max(16, int(round(A['voice_level_window_ms'] * sr / 1000.0)))
    win = np.hanning(L)
    freqs = np.fft.rfftfreq(L, 1.0 / sr)
    lo, hi = A['voice_band_hz']
    band = (freqs >= lo) & (freqs <= hi)
    scale = 2.0 / (L * float(np.sum(win ** 2)))
    padded = np.concatenate([np.zeros(L // 2), x, np.zeros(L)])
    offsets = np.arange(L)
    out = np.empty(n)
    for a in range(0, n, chunk):
        k = np.arange(a, min(n, a + chunk))
        frames = padded[(k * hop)[:, None] + offsets[None, :]] * win
        power = (np.abs(np.fft.rfft(frames, axis=1)[:, band]) ** 2).sum(axis=1) * scale
        out[a:a + len(k)] = np.where(power > 0, 10.0 * np.log10(np.maximum(power, 1e-300)), VOICE_FLOOR_DB)
    return np.maximum(out, VOICE_FLOOR_DB)

def level_list(levels):
    return [round(float(v), 1) if np.isfinite(v) else None for v in levels]

def clipped_frames(samples, sr, A):
    hit = np.abs(np.asarray(samples, dtype=np.float64)) >= A['clip_level']
    sr = int(sr)
    hop = int(A['hop_ms'] * sr / 1000 + 0.5)
    n = 1 + len(hit) // hop
    L = max(16, int(round(A['voice_level_window_ms'] * sr / 1000.0)))
    if not hit.any():
        return []
    c = np.concatenate([[0], np.cumsum(hit)])
    a = np.arange(n) * hop - L // 2
    cnt = c[np.clip(a + L, 0, len(hit))] - c[np.clip(a, 0, len(hit))]
    return [int(k) for k in np.nonzero(cnt > A['clip_ratio'] * L)[0]]

def timing_block(jd, n_jangdan):
    sobak_s = 60.0 / jd['bpm_bak'] / jd['sobak_per_bak']
    per_jangdan = jd['bak'] * jd['sobak_per_bak']
    return {'sobak_per_bak': jd['sobak_per_bak'], 'bak': jd['bak'], 'sobak_per_jangdan': per_jangdan, 'sobak_seconds': sobak_s, 'jangdan_seconds': sobak_s * per_jangdan, 'n_jangdan': n_jangdan, 'total_sobak': per_jangdan * n_jangdan, 'total_seconds': sobak_s * per_jangdan * n_jangdan}

def analyze_cents(cent, valid, hop_s, A, song, sobak_s):
    m_show = A.get('sigimsae_display_method', A.get('sigimsae_method', 'fft_peak_ratio'))
    m_alt = A.get('sigimsae_method', 'fft_peak_ratio')
    if m_alt == m_show:
        m_alt = 'fft_peak_ratio' if m_show != 'fft_peak_ratio' else 'nongyeon'
    lab, rate, ext, slope, diag = classify(cent, valid, hop_s, A, m_show)
    segs = merge(lab, rate, ext, slope, cent, valid, hop_s, sobak_s, song['notes_cents'], song['tori'])
    lab2, rate2, ext2, slope2, diag2 = classify(cent, valid, hop_s, A, m_alt)
    segs_alt = merge(lab2, rate2, ext2, slope2, cent, valid, hop_s, sobak_s, song['notes_cents'], song['tori'])
    return (segs, segs_alt, diag, diag2)
