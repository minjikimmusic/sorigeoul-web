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
        k = int(i * hop / sob)
        pos = f"{k // tm['sobak_per_jangdan'] + 1}장단 {k % tm['sobak_per_jangdan'] // tm['sobak_per_bak'] + 1}박"
        w = _lyric_at(song, k)
        return f'‘{w}’({pos})' if w else pos
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
        c = ord(nm[-1])
        eul = '을' if 44032 <= c <= 55203 and (c - 44032) % 28 else '를'
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
        t = f"이 {tm['n_jangdan']}장단에서 떨림이 선생님은 {ne}군데, 나는 {ns}군데 보여요."
        we = _top_lyric(song, [x for v in ge.values() for x in v])
        ws = _top_lyric(song, [x for v in gs.values() for x in v])
        if we and ws and (we != ws):
            t += f' 선생님은 주로 ‘{we}’에서, 나는 ‘{ws}’에서 떨었어요. 어디를 떠는지가 토리의 특징이에요.'
        elif we and ws:
            t += f' 둘 다 ‘{we}’에서 떨었어요.'
        elif we:
            t += f' 선생님은 ‘{we}’에서 떨었는데 내 곡선에는 떨림이 잡히지 않았어요.'
        elif top_e and top_s and (top_e != top_s):
            t += f" 선생님은 주로 '{top_e}'에서, 나는 '{top_s}'에서 떨었어요. 어느 음을 떠는지가 토리의 특징이에요."
        elif top_e and top_s:
            t += f" 둘 다 '{top_e}'에서 떨었어요."
        elif top_e:
            t += f" 선생님은 '{top_e}'에서 떨었는데 내 곡선에는 떨림이 잡히지 않았어요."
        sents.append(t)

    def kkeok(d):
        return [x for x in d['segments'] if x.get('kkeok_drop_cents')]
    ke, ks = (kkeok(expert), kkeok(student))
    nums['꺾는소리(선생님)'] = [f"소박 {x['start_sobak']:.1f} {x['note']} {x['kkeok_drop_cents']}cent" for x in ke]
    nums['꺾는소리(나)'] = [f"소박 {x['start_sobak']:.1f} {x['note']} {x['kkeok_drop_cents']}cent" for x in ks]
    if ke and (not ks):
        x = ke[0]
        sents.append(f"선생님은 {sobak_label(int(x['start_sobak'] * sob / hop))} 부근에서 소리를 {round(x['kkeok_drop_cents'])}cent 꺾어 내렸어요. 내 곡선에는 그 꺾임이 보이지 않아요.")
    elif ke and ks and (abs(ke[0]['start_sobak'] - ks[0]['start_sobak']) > 2):
        sents.append(f"둘 다 소리를 꺾는 곳이 있는데 위치가 달라요. 선생님은 {sobak_label(ke[0]['start_sobak'] * sob / hop)} 부근, 나는 {sobak_label(ks[0]['start_sobak'] * sob / hop)} 부근이에요.")
    ve = sum((1 for x in e[:n] if x is not None)) / n * 100
    vs = sum((1 for x in s[:n] if x is not None)) / n * 100
    nums['소리가 잡힌 시간(%) 선생님/나'] = [round(ve), round(vs)]
    return {'summary': sents, 'numbers': nums}
