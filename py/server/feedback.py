import math
import config
from server import compare

def _sig(segs, note=None):
    out = [s for s in segs if s.get('type') == 'sigimsae']
    if note:
        out = [s for s in out if s.get('note') == note]
    return out

def _med(vals):
    vals = sorted((v for v in vals if v is not None))
    return vals[len(vals) // 2] if vals else None

def _syllable_spans(song):
    ly = sorted(song.get('lyrics') or [], key=lambda e: e['sobak'])
    out = []
    for m in song.get('sigimsae_syllables') or []:
        nxt = next((e['sobak'] for e in ly if e['sobak'] > m['sobak']), m['sobak'] + 3)
        out.append((m['sobak'], nxt, m['text'], m['line']))
    return out

def _depth_at(segs, lo, hi):
    v = [s.get('vibrato_extent_cents') or 0 for s in segs if s.get('type') == 'sigimsae' and lo <= s.get('start_sobak', -99) < hi]
    return max(v) if v else None

def _rate_at(segs, lo, hi):
    v = [s.get('vibrato_rate') or 0 for s in segs if s.get('type') == 'sigimsae' and lo <= s.get('start_sobak', -99) < hi]
    return max(v) if v else None

def _eul(word):
    c = ord(word[-1])
    has_batchim = 44032 <= c <= 55203 and (c - 44032) % 28
    return '을' if has_batchim else '를'

def _by_lyric(song, segs, exp_segs):
    R = config.SIGIMSAE_BY_LYRIC
    S = R['sentences']
    rows, deepest = ([], None)
    for lo, hi, syl, line in _syllable_spans(song):
        ds, de = (_depth_at(segs, lo, hi), _depth_at(exp_segs or [], lo, hi))
        rows.append({'자리': f"{line}의 '{syl}'", '학습자 폭': ds, '선생님 폭': de, '학습자 빠르기': _rate_at(segs, lo, hi), '선생님 빠르기': _rate_at(exp_segs or [], lo, hi)})
        if ds is not None and (deepest is None or ds > deepest[0]):
            deepest = (ds, syl, line, de)
    why = {'기준': f"같은 자리 선생님 떨림 폭의 {R['depth_ratio_min']}배 이상이면 '깊게 떨었다'", '자리별': rows}
    first = _syllable_spans(song)[0]
    if deepest is None:
        why['판정'] = '학습자 떨림 없음'
        return (S['none'].format(줄=first[3], 음절=first[2]), why)
    ds, syl, line, de = deepest
    if not de:
        why['판정'] = '그 자리에서 선생님 떨림이 잡히지 않아 견주지 못함' if de is None else '그 자리에서 선생님 떨림 구간은 있으나 폭을 재지 못해(0) 견주지 못함'
        return (S['alone'].format(줄=line, 음절=syl, 조사=_eul(syl)), why)
    ratio = ds / de
    why['고른 자리'] = f"{line}의 '{syl}' (학습자 {ds:.0f} / 같은 자리 선생님 {de:.0f} = {ratio:.2f}배)"
    key = 'deep_ok' if ratio >= R['depth_ratio_min'] else 'shallow'
    return (S[key].format(줄=line, 음절=syl, 조사=_eul(syl)), why)
_EACH_SPOT_CASE = {(True, True): 'both_ok', (True, False): 'first_ok', (False, True): 'second_ok', (False, False): 'both_weak'}
_EACH_SPOT_SENTENCES = ('both_ok', 'first_ok', 'second_ok', 'both_weak', 'mirror')

def each_spot_plan(song):
    F = song['sigimsae_feedback']

    def bad(msg):
        return ValueError(f"{song.get('name', '?')} 곡 설정 sigimsae_feedback: {msg}")

    def ref(r):
        return (r.get('sobak'), r.get('text')) if isinstance(r, dict) else (r, None)
    listed = [(lo, hi, syl, line) for lo, hi, syl, line in _syllable_spans(song)]
    spans = {(lo, syl): (lo, hi, syl, line) for lo, hi, syl, line in listed}
    if len(spans) != len(listed):
        raise bad('sigimsae_syllables 에 같은 자리(소박·글자)가 두 번 적혀 있습니다')
    pair, extras = (list(F.get('pair') or []), list(F.get('extras') or []))
    if len(pair) != 2:
        raise bad(f'pair 는 두 자리여야 합니다(지금 {len(pair)}자리)')
    refs = [ref(r) for r in pair + extras]
    for s, t in refs:
        if (s, t) not in spans:
            raise bad(f'가리키는 자리(소박 {s}, ‘{t}’)가 sigimsae_syllables 에 없습니다')
    twice = sorted({r for r in refs if refs.count(r) > 1})
    if twice:
        raise bad('한 자리를 두 번 가리킵니다: ' + ', '.join((f'소박 {s} ‘{t}’' for s, t in twice)))
    left = [k for k in spans if k not in refs]
    if left:
        raise bad('sigimsae_syllables 의 ' + ', '.join((f'소박 {s} ‘{t}’' for s, t in left)) + ' 자리에 문장이 없습니다 — pair 나 extras 에 넣을 것')
    for k in _EACH_SPOT_SENTENCES:
        if not isinstance(F.get(k), str) or not F[k].strip():
            raise bad(f"'{k}' 문장이 없습니다")
    for e in extras:
        for k in ('ok', 'weak'):
            if not isinstance(e.get(k), str) or not e[k].strip():
                raise bad(f"extras 의 소박 {e.get('sobak')} ‘{e.get('text')}’ 자리에 '{k}' 문장이 없습니다")
    thick_min = None
    if F.get('thick_min_from_tori'):
        rule = config.FEEDBACK_RULES.get(song.get('tori')) or {}
        if 'extent_min_cents' not in rule:
            raise bad(f"thick_min_from_tori 가 켜져 있는데 토리 규칙 FEEDBACK_RULES['{song.get('tori')}'] 에 extent_min_cents(굵은 떨림 최소 폭)가 없습니다")
        thick_min = rule['extent_min_cents']
    return ([spans[ref(r)] for r in pair], [(spans[ref(e)], e) for e in extras], thick_min)

def _each_spot(song, segs, exp_segs):
    pair, extras, thick_min = each_spot_plan(song)
    k = config.SIGIMSAE_BY_LYRIC['depth_ratio_min']
    F = song['sigimsae_feedback']
    rows = []

    def judge(span):
        lo, hi, syl, line = span
        ds, de = (_depth_at(segs, lo, hi), _depth_at(exp_segs or [], lo, hi))
        if ds is None:
            ok, cmp = (None, '학습자 떨림이 잡히지 않음')
        else:
            above = thick_min is None or ds >= thick_min
            floor = '' if thick_min is None else f" · 최소 폭 {thick_min:g} {('이상' if above else '미만')}"
            if de:
                ok = ds >= k * de and above
                cmp = f'학습자 {ds:.1f} / 선생님 {de:.1f} = {ds / de:.2f}배{floor}'
            else:
                ok = above
                cmp = f'견주지 못함 — 그 자리에서 선생님 떨림 폭이 잡히지 않아 학습자가 떤 것만 봄 (학습자 {ds:.1f}{floor})'
        rows.append({'자리': f"{line}의 '{syl}'", '학습자 폭': ds, '선생님 폭': de, '학습자 빠르기': _rate_at(segs, lo, hi), '선생님 빠르기': _rate_at(exp_segs or [], lo, hi), '견줌': cmp, '판정': '떨림 없음' if ok is None else '잘 떨었다' if ok else '약하다'})
        return bool(ok)
    key = _EACH_SPOT_CASE[tuple((judge(s) for s in pair))]
    parts, extra_keys = ([F[key]], [])
    for span, e in extras:
        extra_keys.append('ok' if judge(span) else 'weak')
        parts.append(e[extra_keys[-1]])
    crit = f'같은 자리 선생님 떨림 폭의 {k}배 이상'
    if thick_min is not None:
        crit += f"이고 {song.get('tori_name') or song.get('tori')} 굵은 떨림 최소 폭 {thick_min:g}cent 이상"
    why = {'기준': crit + '이면 잘했다. 그 자리에서 선생님 떨림이 잡히지 않았으면 견주지 못하므로 학습자가 떤 것만 본다' + ('(최소 폭은 넘어야 한다)' if thick_min is not None else '') + '. 빠르기는 기준에 넣지 않았다(근거에만 남긴다)', '자리별': rows, '판정': key}
    if extras:
        why['덧붙인 자리 판정'] = extra_keys
    return (' '.join(parts + [F['mirror']]), why)

def _fill_short_gaps(on, max_gap):
    out, i, n = (list(on), 0, len(on))
    while i < n:
        if on[i]:
            i += 1
            continue
        j = i
        while j < n and (not on[j]):
            j += 1
        if i > 0 and j < n and (j - i <= max_gap):
            out[i:j] = [True] * (j - i)
        i = j
    return out

def _longest(flags):
    best = cur = 0
    for f in flags:
        cur = cur + 1 if f else 0
        best = max(best, cur)
    return best

def breath_breaks(song_id, expert, student):
    song = config.SONGS[song_id]
    R = song.get('breath_feedback')
    if not R:
        return ('', None)
    if not expert or expert.get('dummy') or (not expert.get('curve')) or (not (student or {}).get('curve')):
        return ('', {'판정': '선생님 실제 곡선이 없어(더미) 숨 끊김을 보지 않음'})
    tm = expert['timing']
    hop = config.ANALYSIS['hop_ms'] / 1000.0
    sob, spb, spj = (tm['sobak_seconds'], tm['sobak_per_bak'], tm['sobak_per_jangdan'])
    e = [c['cents'] is not None for c in expert['curve']]
    n = min(len(e), len(student['curve']))
    sung, own = compare.own_voice(student, n)
    if sung is None:
        return ('', {'판정': '학습자 소리를 반주와 가려낼 수 없어 숨 끊김을 보지 않음', '학습자 소리': own})
    teacher = _fill_short_gaps(e[:n], int(R['teacher_gap_max_s'] / hop + 1e-06))
    gap_min = int(math.ceil(R['student_gap_min_s'] / hop - 1e-06))
    resume = int(math.ceil(R['resume_min_s'] / hop - 1e-06))
    turns = bool(student.get('live'))
    db = student.get('voice_db')

    def level(idx):
        v = sorted((db[i] for i in idx if i < len(db) and db[i] is not None)) if db else []
        return round(v[len(v) // 2], 1) if v else None
    found, dropped = ([], [])
    for a, b in compare._runs([teacher[i] and (not sung[i]) for i in range(n)], gap_min):
        pos = a * hop / sob + 1e-06
        item = {'자리': compare.place_label(song, tm, int(pos)), '시작 초': round(a * hop, 2), '길이 초': round((b - a) * hop, 2)}
        if db:
            item['빈 곳 세기(dB)'] = level(range(a, b))
        line = next((ln for ln in song.get('lyric_lines') or [] if ln[0] <= pos < ln[1]), None)
        why = []
        if line is None:
            why.append('가사 줄 밖')
        else:
            lo, hi = (line[0], line[1])
            if turns:
                j = int(pos // spj)
                lo, hi = (max(lo, j * spj), min(hi, (j + 1) * spj))
            if pos >= line[1] - spb:
                why.append('줄 마지막 박')
            la, lb = (int(round(lo * sob / hop)), min(n, int(round(hi * sob / hop))))
            if _longest(sung[la:a]) < resume:
                why.append('앞에 학습자 소리가 없음')
            if _longest(sung[b:lb]) < resume:
                why.append('뒤에 다시 이어 부르지 않음')
            t_on = [i for i in range(la, lb) if teacher[i]]
            if t_on and sum((1 for i in t_on if sung[i])) < R['min_sung_ratio'] * len(t_on):
                why.append('그 부분을 거의 부르지 않음')
        if why:
            dropped.append(dict(item, 까닭=why))
        else:
            found.append(item)
    places = []
    for f in found:
        if f['자리'] not in places:
            places.append(f['자리'])
    places = places[:R['max_places']]
    basis = {'기준': f"선생님이 소리 내는 동안(선생님 쪽 {R['teacher_gap_max_s']:g}초 이하의 틈은 이어진 것으로 봄) 학습자만 {R['student_gap_min_s']:g}초 이상 빈 곳. 같은 단위 안에서 그 앞과 뒤에 학습자 소리가 {R['resume_min_s']:g}초 이상 이어진 곳이 있어야 하고, 그 단위에서 선생님 소리 칸의 {R['min_sung_ratio']:g}배 이상 학습자 소리가 있어야 한다. 줄 마지막 박에서 시작한 것은 뺀다. 문장에는 시간 순으로 {R['max_places']}곳까지", '단위': '가사 줄 가운데 그 장단(직접 부른 소리 — 장단마다 따로 부른다)' if turns else '가사 줄', '학습자 소리': own, '찾은 곳': found, '뺀 곳': dropped}
    if db:
        basis['학습자 노래 세기(dB)'] = level([i for i in range(n) if sung[i]])
    return (R['sentence'].format(자리=', '.join(places)) if places else '', basis)

def select(song_id, student_segments, expert_segments=None, diag=None):
    song = config.SONGS[song_id]
    rules = config.FEEDBACK_RULES[song['tori']]
    S = rules['sentences']
    segs = student_segments or []
    why = {}
    broken = bool(diag and diag.get('score_max', 0) < diag.get('score_min', 0))
    if broken and (not _sig(segs)):
        why = {'시김새 판정': '측정 불가', '진단': diag}
        return ('지금은 떨림(시김새)을 자동으로 재지 못했어요. 대신 두 곡선의 모양과 소리를 꺾는 자리를 눈으로 비교해 보세요.', why)
    if song.get('sigimsae_feedback'):
        return _each_spot(song, segs, expert_segments)
    if song.get('sigimsae_syllables'):
        return _by_lyric(song, segs, expert_segments)
    if song['tori'] == 'gyeong':
        big = [s for s in _sig(segs) if (s.get('vibrato_extent_cents') or 0) > rules['extent_max_cents']]
        why = {'큰 떨림 구간 수': len(big), '기준': f"진폭 > {rules['extent_max_cents']}cent"}
        return (S['too_much'] if big else S['smooth'], why)
    if song['tori'] == 'namdo':
        mi = _sig(segs, '미')
        if not mi:
            why = {"'미' 떨림 구간": 0}
            return (S['none'], why)
        ext = _med([s.get('vibrato_extent_cents') for s in mi])
        rate = _med([s.get('vibrato_rate') for s in mi])
        why = {"'미' 떨림 구간": len(mi), '진폭 중앙': ext, '주기 중앙': rate, '기준': f"진폭 >= {rules['extent_min_cents']}, 주기 <= {rules['rate_max_hz']}"}
        ok = (ext or 0) >= rules['extent_min_cents'] and (rate or 99) <= rules['rate_max_hz']
        return (S['thick_ok'] if ok else S['too_thin'], why)
    if song['tori'] == 'dongbu':
        cut = [s for s in segs if s.get('type') == 'moving' and s.get('descent_cut')]
        why = {'끊긴 하행 구간': len(cut)}
        return (S['flow_cut'] if cut else S['flow_ok'], why)
    if song['tori'] == 'seodo':
        la = _sig(segs, '라')
        if not la:
            return (S['none'], {"'라' 떨림 구간": 0})
        ext = _med([s.get('vibrato_extent_cents') for s in la])
        rate = _med([s.get('vibrato_rate') for s in la])
        others = [s for s in _sig(segs) if s.get('note') and s.get('note') != '라']
        o_ext = _med([s.get('vibrato_extent_cents') for s in others])
        o_rate = _med([s.get('vibrato_rate') for s in others])
        why = {"'라' 떨림 구간": len(la), "'라' 진폭 중앙": ext, "'라' 주기 중앙": rate, '둘레 음 떨림 구간': len(others), '둘레 진폭 중앙': o_ext, '둘레 주기 중앙': o_rate, '기준': f"'라' 진폭 >= {rules['la_extent_min_cents']} / 둘레 진폭 <= {rules['fine_extent_max_cents']}, 주기 >= {rules['fine_rate_min_hz']}"}
        thick = (ext or 0) >= rules['la_extent_min_cents']
        return (S['thick_ok'] if thick else S['too_thin'], why)
    return ('', why)
