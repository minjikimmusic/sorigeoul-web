import math
import random
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))
import config
HOP_S = 0.01

def _timing(song_id):
    song = config.SONGS[song_id]
    jd = config.jangdan_for(song_id)
    sobak_per_jangdan = jd['bak'] * jd['sobak_per_bak']
    sobak_s = 60.0 / jd['bpm_bak'] / jd['sobak_per_bak']
    n_jangdan = config.jangdan_count(song_id)
    return {'sobak_per_bak': jd['sobak_per_bak'], 'bak': jd['bak'], 'sobak_per_jangdan': sobak_per_jangdan, 'sobak_seconds': sobak_s, 'jangdan_seconds': sobak_s * sobak_per_jangdan, 'n_jangdan': n_jangdan, 'total_sobak': sobak_per_jangdan * n_jangdan, 'total_seconds': sobak_s * sobak_per_jangdan * n_jangdan}

def _skeleton(song_id, rng):
    song = config.SONGS[song_id]
    tm = _timing(song_id)
    names = list(song['notes_cents'].keys())
    idx = rng.randrange(len(names))
    out = []
    s = 0
    while s < tm['total_sobak']:
        length = rng.choice([1, 1, 2, 3, 3])
        if s % tm['sobak_per_bak'] == 0 and rng.random() < 0.5:
            length = tm['sobak_per_bak']
        length = min(length, tm['total_sobak'] - s)
        name = names[idx]
        out.append((name, song['notes_cents'][name], s, length))
        s += length
        step = rng.choice([-2, -1, -1, 0, 1, 1, 2])
        idx = max(0, min(len(names) - 1, idx + step))
    return out

def _vibrato_params(tori, is_expert, rng):
    if tori == 'namdo':
        rate, extent = (4.0, 110.0)
    elif tori == 'seodo':
        rate, extent = (6.8, 40.0)
    else:
        return None
    if not is_expert:
        rate *= rng.uniform(0.75, 1.5)
        extent *= rng.uniform(0.3, 1.3)
    return (rate, extent)

def make_curve(song_id, is_expert, seed=None):
    song = config.SONGS[song_id]
    tori = song['tori']
    tm = _timing(song_id)
    if is_expert:
        rng = random.Random(f'expert-{song_id}')
    else:
        rng = random.Random(seed if seed is not None else random.random())
    skel = _skeleton(song_id, random.Random(f'skeleton-{song_id}'))
    sobak_s = tm['sobak_seconds']
    n = int(round(tm['total_seconds'] / HOP_S))
    cents = [None] * n
    segments = []
    for k, (name, base, start_sobak, length) in enumerate(skel):
        t0 = start_sobak * sobak_s
        t1 = (start_sobak + length) * sobak_s
        pitch_offset = 0.0 if is_expert else rng.gauss(0, 25)
        vib = None
        seg_type = 'stable'
        kkeok = tori == 'namdo' and name == '도'
        if kkeok:
            seg_type = 'moving'
        if name in song['sigimsae_notes'] and length >= 2 and (not kkeok):
            vib = _vibrato_params(tori, is_expert, rng)
            if vib:
                seg_type = 'sigimsae'
        if tori == 'gyeong' and (not is_expert) and (length >= 3) and (rng.random() < 0.35):
            vib = (rng.uniform(4.5, 6.0), rng.uniform(70, 110))
            seg_type = 'sigimsae'
        descent = False
        if tori == 'dongbu' and k + 1 < len(skel) and (skel[k + 1][1] < base) and (name in ('라', '솔')):
            descent = True
            seg_type = 'moving'
        cut_gap = not is_expert and descent and (rng.random() < 0.5)
        kk_drop = 100.0 if is_expert else rng.uniform(30, 120)
        kk_dur = 0.2 if is_expert else rng.uniform(0.15, 0.4)
        i0, i1 = (int(t0 / HOP_S), min(n, int(t1 / HOP_S)))
        glide = int(0.08 / HOP_S)
        prev_c = None
        if k > 0:
            prev_c = skel[k - 1][1]
        for i in range(i0, i1):
            t = i * HOP_S
            c = base + pitch_offset
            if prev_c is not None and i - i0 < glide:
                a = (i - i0) / glide
                c = prev_c * (1 - a) + c * a
            if vib:
                rate, extent = vib
                c += extent * math.sin(2 * math.pi * rate * (t - t0))
            if kkeok:
                a = min(1.0, (t - t0) / kk_dur)
                c -= kk_drop * a
            if descent:
                nxt = skel[k + 1][1]
                a = (i - i0) / max(1, i1 - i0)
                c = base * (1 - a * 0.6) + nxt * (a * 0.6) + pitch_offset
                if cut_gap and 0.45 < a < 0.65:
                    cents[i] = None
                    continue
            jitter = rng.gauss(0, 3 if is_expert else 9)
            cents[i] = round(c + jitter, 1)
        for i in range(max(0, i0 - 3), i0):
            cents[i] = None
        seg = {'start_sobak': start_sobak, 'end_sobak': start_sobak + length, 'note': name, 'type': seg_type, 'vibrato_rate': round(vib[0], 2) if vib else None, 'vibrato_extent_cents': round(vib[1], 1) if vib else None}
        if descent:
            seg['descent_cut'] = bool(cut_gap)
        if kkeok:
            seg['kkeok_drop_cents'] = round(kk_drop, 1)
        segments.append(seg)
    curve = [{'t': round(i * HOP_S, 3), 'cents': cents[i]} for i in range(n)]
    return (curve, segments, tm)

def select_feedback(tori, segments):
    rules = config.FEEDBACK_RULES[tori]
    S = rules['sentences']
    sig = [s for s in segments if s['type'] == 'sigimsae' and s.get('vibrato_extent_cents') is not None]
    mean_extent = sum((s['vibrato_extent_cents'] for s in sig)) / len(sig) if sig else 0.0
    mean_rate = sum((s['vibrato_rate'] for s in sig)) / len(sig) if sig else 0.0
    if tori == 'gyeong':
        return S['too_much'] if mean_extent > rules['extent_max_cents'] else S['smooth']
    if tori == 'namdo':
        if not sig or mean_extent < 25:
            return S['none']
        if mean_extent >= rules['extent_min_cents'] and mean_rate <= rules['rate_max_hz']:
            return S['thick_ok']
        return S['too_thin']
    if tori == 'dongbu':
        cuts = [s for s in segments if s['type'] == 'moving' and s.get('descent_cut')]
        return S['flow_cut'] if cuts else S['flow_ok']
    if tori == 'seodo':
        if not sig or mean_extent < 10:
            return S['none']
        if mean_extent <= rules['extent_max_cents'] and mean_rate >= rules['rate_min_hz']:
            return S['fine_ok']
        return S['too_thick']
    return ''

def expert_result(song_id):
    curve, segments, tm = make_curve(song_id, is_expert=True)
    return {'song_id': song_id, 'role': 'expert', 'bonchung_hz': config.SONGS[song_id]['bonchung_hz'], 'timing': tm, 'curve': curve, 'segments': segments, 'dummy': True}

def student_result(song_id, seed=None):
    curve, segments, tm = make_curve(song_id, is_expert=False, seed=seed)
    return {'song_id': song_id, 'role': 'student', 'bonchung_hz': config.SONGS[song_id]['bonchung_hz'], 'timing': tm, 'curve': curve, 'segments': segments, 'feedback': select_feedback(config.SONGS[song_id]['tori'], segments), 'dummy': True}
