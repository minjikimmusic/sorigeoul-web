import math
import config

def _cents(curve):
    return [c['cents'] for c in curve]

def _median(v):
    v = sorted((x for x in v if x is not None))
    if not v:
        return None
    n = len(v)
    return v[n // 2] if n % 2 else (v[n // 2 - 1] + v[n // 2]) / 2

def _pct(v, p):
    v = sorted((x for x in v if x is not None))
    return v[min(len(v) - 1, int(p / 100 * len(v)))] if v else None

def _runs(flags, min_len):
    out = []
    i = 0
    while i < len(flags):
        if flags[i]:
            j = i
            while j < len(flags) and flags[j]:
                j += 1
            if j - i >= min_len:
                out.append((i, j))
            i = j
        else:
            i += 1
    return out

def _lyric_at(song, k):
    ly = song.get('lyrics') or []
    for i, e in enumerate(ly):
        nxt = ly[i + 1]['sobak'] if i + 1 < len(ly) else e['sobak'] + 3
        if e['sobak'] <= k < nxt:
            return e['text']
    return None

def place_label(song, tm, k):
    pos = f"{k // tm['sobak_per_jangdan'] + 1}장단 {k % tm['sobak_per_jangdan'] // tm['sobak_per_bak'] + 1}박"
    w = _lyric_at(song, k)
    return f'‘{w}’({pos})' if w else pos

def _eul(word):
    c = ord(word[-1])
    return '을' if 44032 <= c <= 55203 and (c - 44032) % 28 else '를'

def _first_frame(t, hop):
    return int(math.ceil(t / hop - 1e-06))

def own_voice(result, n):
    A = config.ANALYSIS
    on = [c['cents'] is not None for c in result['curve'][:n]]
    db, bk = (result.get('voice_db'), result.get('backing_db'))
    if not db or not bk:
        return (on, {'고른 법': '음높이가 잡힌 칸(반주 세기 없음 — 미리 녹음한 자료)'})
    per = len(bk)

    def over(i):
        b = bk[i % per] if i < len(db) else None
        return None if b is None or db[i] is None else db[i] - b
    ex = sorted((x for x in (over(i) for i in range(n) if on[i]) if x is not None))
    mid = ex[len(ex) // 2] if ex else None
    margin = A['own_voice_margin_db']
    why = {'고른 법': f'음높이가 잡힌 칸이 이어진 조각 가운데 같은 자리 반주(준비 장단)보다 평균 {margin:g}dB 이상 큰 조각', '반주보다 큰 정도 가운데 값(dB)': None if mid is None else round(mid, 1)}
    if mid is None or mid < margin:
        why['판정'] = f'학습자 소리를 반주와 가려낼 수 없음 — 음높이가 잡힌 칸 절반 넘게가 반주보다 {margin:g}dB 넘게 크지 않다(거의 부르지 않았거나 스피커 소리가 목소리만큼 크다)'
        return (None, why)
    out, left = ([False] * n, 0)
    for a0, b0 in _runs(on, 1):
        for a, b in _split_at(a0, b0, per):
            v = [x for x in (over(i) for i in range(a, b)) if x is not None]
            if v and sum(v) / len(v) >= margin:
                out[a:b] = [True] * (b - a)
            else:
                left += b - a
    why['뺀 유성 칸'] = left
    return (out, why)

def _split_at(a, b, per):
    out = []
    while a < b:
        z = min(b, (a // per + 1) * per)
        out.append((a, z))
        a = z
    return out

def _jangdan_accents(data, ok, tm, R, n, hop, shifts=None, turns=False):
    db = data['voice_db']
    clipped = set(data.get('voice_clipped') or ())
    w0, w1 = R['window_s']
    per = int(round(tm['jangdan_seconds'] / hop))
    vals, why = ([], [])
    for j in range(tm['n_jangdan']):
        lo, hi = (j * per, (j + 1) * per) if turns else (0, n)
        lo, hi = (max(0, lo), min(n, hi))
        windows = []
        for k in shifts[j] if shifts else (0,):
            row = []
            for b in range(tm['bak']):
                head = (j * tm['sobak_per_jangdan'] + b * tm['sobak_per_bak']) * tm['sobak_seconds'] + k * hop
                row.append((max(lo, _first_frame(head + w0, hop)), min(hi, _first_frame(head + w1, hop))))
            windows.append(row)
        if any((i in clipped for row in windows for a, z in row for i in range(a, z))):
            vals.append(None)
            why.append('소리가 잘림')
            continue
        best = None
        for row in windows:
            beats = []
            for a, z in row:
                v = [db[i] for i in range(a, z) if ok[i] and db[i] is not None]
                beats.append(sum(v) / len(v) if len(v) >= R['min_voiced_frames'] else None)
            if any((x is None for x in beats)):
                continue
            acc = beats[0] - sum(beats[1:]) / len(beats[1:])
            best = acc if best is None else max(best, acc)
        vals.append(None if best is None else round(best, 1))
        why.append(None if best is not None else '박 창에 소리가 모자람')
    return (vals, why)

def _align_shift(expert, eok, student, sok, j, per, n, R, turns):
    edb, sdb = (expert['voice_db'], student['voice_db'])
    K = int(round(R.get('student_shift_s', 0.0) / (config.ANALYSIS['hop_ms'] / 1000.0)))
    lo, hi = (j * per, min(n, (j + 1) * per)) if turns else (0, n)
    cost = {}
    for k in range(-K, K + 1):
        d = [edb[i] - sdb[i + k] for i in range(j * per, min(n, (j + 1) * per)) if lo <= i + k < hi and eok[i] and sok[i + k] and (edb[i] is not None) and (sdb[i + k] is not None)]
        if len(d) >= R.get('align_min_frames', 50):
            mu = sum(d) / len(d)
            cost[k] = sum(((x - mu) ** 2 for x in d)) / len(d)
    if not cost:
        return None
    best = min(cost, key=lambda k: (round(cost[k], 6), abs(k)))
    return best if 0 not in cost or cost[best] <= R.get('align_gain', 0.8) * cost[0] else 0

def first_beat_accents(song_id, expert, student):
    R = config.SONGS[song_id].get('accent_feedback')
    if not R or not expert.get('voice_db') or (not student.get('voice_db')):
        return None
    tm, hop = (expert['timing'], config.ANALYSIS['hop_ms'] / 1000.0)
    n = min(len(expert['curve']), len(student['curve']), len(expert['voice_db']), len(student['voice_db']))
    J = tm['n_jangdan']
    eok = [c['cents'] is not None for c in expert['curve'][:n]]
    te, te_why = _jangdan_accents(expert, eok, tm, R, n, hop)
    ok, own = own_voice(student, n)
    if ok is None:
        ts, ts_why, ks = ([None] * J, ['학습자 소리를 반주와 가려낼 수 없음'] * J, [None] * J)
    else:
        turns = bool(student.get('live'))
        per = int(round(tm['jangdan_seconds'] / hop))
        ks = [_align_shift(expert, eok, student, ok, j, per, n, R, turns) for j in range(J)]
        ts, ts_why = _jangdan_accents(student, ok, tm, R, n, hop, [sorted({0, k or 0}) for k in ks], turns=turns)
    eps = 1e-06
    weak = [j for j in range(J) if te[j] is not None and ts[j] is not None and (te[j] >= R['teacher_min_db'] - eps) and (ts[j] <= te[j] - R['gap_db'] + eps)]
    return {'teacher': te, 'student': ts, 'weak': weak, 'teacher_why': te_why, 'student_why': ts_why, 'shift': ks, 'own_voice': own}

def _top_lyric(song, xs):
    cnt = {}
    for x in xs:
        w = _lyric_at(song, int(round(x.get('start_sobak', -1))))
        if w:
            cnt[w] = cnt.get(w, 0) + 1
    return max(cnt, key=lambda k: cnt[k]) if cnt else None

def _note_of(song, c, tol=150):
    best, bn = (tol, None)
    for nm, cv in song['notes_cents'].items():
        if abs(c - cv) < best:
            best, bn = (abs(c - cv), nm)
    return bn

def compare(song_id, expert, student):
    song = config.SONGS[song_id]
    tm = expert['timing']
    sob = tm['sobak_seconds']
    hop = 0.01
    e, s = (_cents(expert['curve']), _cents(student['curve']))
    n = min(len(e), len(s))
    both = [i for i in range(n) if e[i] is not None and s[i] is not None]
    if len(both) < 30:
        return {'summary': ['두 곡선이 겹치는 부분이 너무 적어 비교하기 어려워요.'], 'numbers': {}}
    diff = [s[i] - e[i] for i in both]
    adiff = [abs(d) for d in diff]
    med = _median(adiff)
    over100 = sum((1 for d in adiff if d >= 100)) / len(adiff) * 100

    def sobak_label(i):
        return place_label(song, tm, int(i * hop / sob))
    sents, nums = ([], {})
    nums['겹치는 시간 비율(%)'] = round(len(both) / n * 100)
    nums['음고 차이 중앙값(cent)'] = round(med)
    nums['반음 이상 벌어진 시간(%)'] = round(over100)
    if med <= 50:
        sents.append(f'전체적으로는 선생님과 아주 비슷하게 불렀어요. 두 곡선의 높이 차이가 보통 {round(med)}cent (반음의 {med / 100:.1f}배)쯤이에요.')
    elif med <= 100:
        sents.append(f'전체적인 가락의 흐름은 선생님과 닮았어요. 높이 차이는 보통 {round(med)}cent 정도예요.')
    else:
        sents.append(f'두 곡선의 높이가 보통 {round(med)}cent(반음 {med / 100:.1f}배) 떨어져 있어요. 먼저 본청(가운데 가로선)에 맞추어 보면 좋겠어요.')
    n_sob = tm['total_sobak']
    per_sob = []
    for k in range(n_sob):
        a, b = (int(k * sob / hop), int((k + 1) * sob / hop))
        d = _median([s[i] - e[i] for i in range(a, min(b, n)) if s[i] is not None and e[i] is not None])
        per_sob.append(d)
    big = [d is not None and abs(d) >= 150 for d in per_sob]
    rs = sorted(_runs(big, 1), key=lambda r: (r[0] - r[1], -abs(per_sob[r[0]])))[:2]
    if rs:
        parts = []
        for a, b in sorted(rs):
            d = _median(per_sob[a:b])
            parts.append(f"{sobak_label(int(a * sob / hop))} 부근(내가 약 {abs(round(d))}cent {('더 높게' if d > 0 else '더 낮게')})")
        sents.append('가장 많이 갈라지는 곳은 ' + ', '.join(parts) + '이에요. 거울에서 그 부분을 옆으로 끌어 되풀이해 들어 보세요.')
        nums['크게 갈리는 소박'] = [f'소박 {a + 1}~{b} ({round(_median(per_sob[a:b]))}cent)' for a, b in sorted(rs)]
    per = {}
    for i in both:
        nm = _note_of(song, e[i])
        if nm:
            per.setdefault(nm, []).append(s[i] - e[i])
    shifted = [(nm, _median(v), len(v)) for nm, v in per.items() if len(v) >= 30]
    shifted.sort(key=lambda x: -abs(x[1]))
    if shifted and abs(shifted[0][1]) >= 50:
        nm, d, cnt = shifted[0]
        eul = _eul(nm)
        sents.append(f"선생님이 '{nm}'{eul} 부를 때, 나는 평균적으로 {abs(round(d))}cent {('높게' if d > 0 else '낮게')} 잡았어요. 다른 음은 더 가깝게 맞았으니 '{nm}'만 따로 들어 보세요.")
    nums['구성음별 차이(cent)'] = {nm: round(d) for nm, d, _ in shifted}

    def steady(cur):
        c = _cents(cur)
        k = 0
        for i in range(10, len(c) - 10):
            w = c[i - 10:i + 10]
            if any((x is None for x in w)):
                continue
            if max(w) - min(w) <= 50:
                k += 1
        return k
    se, ss = (steady(expert['curve']), steady(student['curve']))
    nums['지속음 프레임(선생님/나)'] = [se, ss]
    if ss > se * 1.6:
        sents.append('선생님은 같은 음을 낼 때에도 음높이를 계속 조금씩 움직이는 데 비해, 내 소리는 더 곧게 뻗어 있어요. 선생님 곡선의 잔물결이 어디에 있는지 찾아보세요.')
    elif se > ss * 1.6:
        sents.append('선생님은 음을 곧게 뻗는 곳에서 내 소리가 더 많이 흔들렸어요. 어느 구간인지 비교해 보세요.')

    def sigsum(d):
        out = {}
        for x in d['segments']:
            if x.get('type') == 'sigimsae':
                out.setdefault(x.get('note') or '(이름 없음)', []).append(x)
        return out
    ge, gs = (sigsum(expert), sigsum(student))
    ne = sum((len(v) for v in ge.values()))
    ns = sum((len(v) for v in gs.values()))
    nums['떨림 구간 수(선생님/나)'] = [ne, ns]
    nums['떨림이 붙은 음(선생님)'] = {k: len(v) for k, v in ge.items()}
    nums['떨림이 붙은 음(나)'] = {k: len(v) for k, v in gs.items()}
    if ne or ns:
        top_e = max(ge, key=lambda k: len(ge[k])) if ge else None
        top_s = max(gs, key=lambda k: len(gs[k])) if gs else None
        t = f"이 {tm['n_jangdan']}장단에서 떠는소리(농현)가 선생님은 {ne}군데, 나는 {ns}군데 보여요."
        we = _top_lyric(song, [x for v in ge.values() for x in v])
        ws = _top_lyric(song, [x for v in gs.values() for x in v])
        remark = song.get('tori_vibrato_remark', True)
        if we and ws and (we != ws):
            t += f' 선생님은 주로 ‘{we}’에서, 나는 ‘{ws}’에서 떨었어요.'
            if remark:
                t += ' 어디를 떠는지가 토리의 특징이에요.'
        elif we and ws:
            t += f' 둘 다 ‘{we}’에서 떨었어요.'
        elif we:
            t += f' 선생님은 ‘{we}’에서 떨었는데 내 곡선에는 떠는소리가 잡히지 않았어요.'
        elif top_e and top_s and (top_e != top_s):
            t += f" 선생님은 주로 '{top_e}'에서, 나는 '{top_s}'에서 떨었어요."
            if remark:
                t += ' 어느 음을 떠는지가 토리의 특징이에요.'
        elif top_e and top_s:
            t += f" 둘 다 '{top_e}'에서 떨었어요."
        elif top_e:
            t += f" 선생님은 '{top_e}'에서 떨었는데 내 곡선에는 떠는소리가 잡히지 않았어요."
        sents.append(t)

    def kkeok(d):
        return [x for x in d['segments'] if x.get('kkeok_drop_cents')]
    ke, ks = (kkeok(expert), kkeok(student))
    nums['꺾는소리(선생님)'] = [f"소박 {x['start_sobak']:.1f} {x['note']} {x['kkeok_drop_cents']}cent" for x in ke]
    nums['꺾는소리(나)'] = [f"소박 {x['start_sobak']:.1f} {x['note']} {x['kkeok_drop_cents']}cent" for x in ks]
    if ke and (not ks):
        x = ke[0]
        sents.append(f"선생님은 {sobak_label(int(x['start_sobak'] * sob / hop))} 부근에서 소리를 {round(x['kkeok_drop_cents'])}cent 꺾어 내렸어요. 내 곡선에는 그 꺾는소리가 보이지 않아요.")
    elif ke and ks and (abs(ke[0]['start_sobak'] - ks[0]['start_sobak']) > 2):
        sents.append(f"둘 다 꺾는소리를 낸 곳이 있는데 위치가 달라요. 선생님은 {sobak_label(ke[0]['start_sobak'] * sob / hop)} 부근, 나는 {sobak_label(ks[0]['start_sobak'] * sob / hop)} 부근이에요.")
    ve = sum((1 for x in e[:n] if x is not None)) / n * 100
    vs = sum((1 for x in s[:n] if x is not None)) / n * 100
    nums['소리가 잡힌 시간(%) 선생님/나'] = [round(ve), round(vs)]
    acc = first_beat_accents(song_id, expert, student)
    if acc:
        R = song['accent_feedback']
        J = range(tm['n_jangdan'])

        def shown(v, why):
            return f'잴 수 없음({why})' if v is None else v
        nums['첫 박 강세(dB) 선생님'] = {f'{j + 1}장단': shown(acc['teacher'][j], acc['teacher_why'][j]) for j in J}
        nums['첫 박 강세(dB) 나'] = {f'{j + 1}장단': shown(acc['student'][j], acc['student_why'][j]) for j in J}
        nums['첫 박 강세: 내 박 창을 옮긴 초'] = {f'{j + 1}장단': round((acc['shift'][j] or 0) * hop, 2) for j in J}
        nums['첫 박이 약한 장단'] = [f'{j + 1}장단' for j in acc['weak']] or '없음'
        lo, hi = config.ANALYSIS['voice_band_hz']
        w0, w1 = R['window_s']
        nums['첫 박 강세 기준'] = f"강세 = 첫 박 세기 − 나머지 박 세기 평균. 선생님 ≥ {R['teacher_min_db']:g}dB이고 나 ≤ 선생님 − {R['gap_db']:g}dB인 장단을 말한다. 박 세기 = 박 머리 {w0:+g}~{w1:+g}초 안 유성 칸의 목소리({lo:g}~{hi:g}Hz) 세기 평균(dB 평균). 내 박 창은 장단마다 세기 곡선을 선생님에 맞춘 자리(앞뒤 {R.get('student_shift_s', 0.0):g}초 안)와 옮기지 않은 자리에서 재어 큰 값을 쓴다"
        if acc['weak']:
            ks = [j * tm['sobak_per_jangdan'] for j in acc['weak']]
            last = _lyric_at(song, ks[-1]) or place_label(song, tm, ks[-1])
            sents.append(R['sentence'].format(자리들=', '.join((place_label(song, tm, k) for k in ks)), 조사=_eul(last)))
    return {'summary': sents, 'numbers': nums}
