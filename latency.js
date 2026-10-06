/*
 * latency.js — 스피커→마이크 왕복 지연 재기
 * ------------------------------------------
 * 왜 필요한가 (2026-10-03): 거울 보기에서 내 소리가 선생님보다 약 1소박(0.21초) 늦게 들렸다.
 * 서버와 거울은 녹음에서 학생 장단을 (예약 시각 − 녹음 0초) + 지연 자리에서 자르는데, 그 지연을
 * 브라우저가 다 알려 주지 않는다(outputLatency 는 스피커 쪽만, 마이크 쪽은 아예 없음).
 * 노래하는 사람은 스피커에서 들은 박에 맞춰 부르므로, 학생 소리는 '앱이 낸 소리'와 똑같은
 * 경로(출력 → 공기 → 마이크 → 녹음)를 지난다. 그래서 앱이 낸 소리가 녹음에 몇 ms 늦게 나타났는지가
 * 곧 보정할 지연이다.
 *
 * 두 가지 재는 법이 있다.
 *  ① 녹음마다 자동으로 (2026-10-05, 앱이 쓰는 것) — estimateDelay()
 *     이어폰 없이 스피커로 듣고 부르므로, 앱이 튼 장단(과 선생님 소리)이 녹음에 그대로 새어 든다
 *     (getUserMedia 의 echoCancellation 을 꺼 두었다). 학생이 부르지 않는 장단(앞장단·선생님 차례·
 *     준비 장단)에서, 앱이 낸 소리의 '타점 시작'과 녹음 속 타점 시작을 겹쳐 보며 가장 잘 맞는 어긋남을 찾는다.
 *     **학생 목소리는 계산에 쓰지 않는다.** 녹음 전체를 같은 만큼 당길 뿐 늘이거나 줄이지 않으므로,
 *     학생이 실제로 빠르게·늦게 부른 것은 곡선에 그대로 남는다.
 *  ② 따로 딸깍 16번 (2026-10-03, latency.html) — clickOffsets()
 *     ①이 맞는지 확인하는 정답지로 쓴다. 학생이 쓰는 화면에는 없다.
 *
 * 아래 함수는 계산만 한다(브라우저 API를 쓰지 않는다). tests/test_latency_js.py 가 node 로 검사한다.
 */

/** 딸깍 하나하나가 기대 위치보다 몇 ms 늦게 잡혔는가. 잡히지 않은 딸깍은 null.
 *  pcm: Float32Array, sr: 표본율, expected: 기대 위치(초) 배열 — 녹음 0초 기준.
 *  opt.before/after: 기대 위치 앞뒤로 찾는 범위(초). 딸깍 간격보다 좁아야 이웃 딸깍을 잡지 않는다. */
function clickOffsets(pcm, sr, expected, opt) {
  const before = (opt && opt.before) || 0.15;
  const after = (opt && opt.after) || 0.55;
  // 잡음 바닥: 첫 딸깍을 찾기 시작하는 자리 앞의 조용한 구간
  const quietEnd = Math.max(0, Math.min(pcm.length, Math.floor((expected[0] - before - 0.05) * sr)));
  let s = 0;
  for (let i = 0; i < quietEnd; i++) s += pcm[i] * pcm[i];
  const noise = quietEnd > 0 ? Math.sqrt(s / quietEnd) : 0;
  const out = [];
  for (const e of expected) {
    const a = Math.max(0, Math.round((e - before) * sr));
    const b = Math.min(pcm.length, Math.round((e + after) * sr));
    if (b - a < 16) { out.push(null); continue; }
    let peak = 0;
    for (let i = a; i < b; i++) peak = Math.max(peak, Math.abs(pcm[i]));
    // 잡음보다 충분히 크지 않으면 딸깍을 못 들은 것이다(이어폰을 꽂았거나 스피커 음량이 0)
    if (peak < 1e-3 || peak < 6 * noise) { out.push(null); continue; }
    const thr = Math.max(8 * noise, 0.3 * peak);
    let k = a;
    while (k < b && Math.abs(pcm[k]) < thr) k++;
    out.push((k / sr - e) * 1000);
  }
  return out;
}

/** 중앙값·사분위·개수 */
function summarize(values) {
  const v = values.filter(x => x !== null && Number.isFinite(x)).sort((p, q) => p - q);
  if (!v.length) return { n: 0 };
  const at = f => {
    const i = (v.length - 1) * f, lo = Math.floor(i), hi = Math.ceil(i);
    return v[lo] + (v[hi] - v[lo]) * (i - lo);
  };
  return { n: v.length, median: at(0.5), q1: at(0.25), q3: at(0.75), min: v[0], max: v[v.length - 1] };
}

/* ---------------- ① 녹음마다 자동으로 재기 ----------------
 * 2026-10-05 시뮬레이션(실제 장단·선생님 음원 + 스피커 저역 깎임 + 방 울림 + 잡음 + 학생 목소리)에서
 * 세 장단 모두 넣은 지연을 1ms 안쪽으로 되찾았다. 파형을 그대로 맞추는 방식(GCC-PHAT)은 방 울림의
 * 반사를 잡아 10ms씩 틀려서 버렸다. 실제 기기에서 맞는지는 latency.html(②)과 견주어 확인할 것.
 */
const AUTO_LATENCY = {
  lo_s: -0.02,          // 찾는 범위. 음수는 물리적으로 없지만 시계 계산이 틀렸을 때 드러나도록 조금 둔다
  hi_s: 0.5,            // 블루투스가 아닌 스피커·마이크의 왕복 지연은 이 안에 든다
  hop_s: 0.0005,        // 타점 포락선 간격(0.5ms). 포물선 보간으로 그 사이도 읽는다
  win_s: 0.002,         // 소리 크기를 재는 창(2ms)
  min_contrast: 2.0,    // 가장 잘 맞는 자리가 그다음(±30ms 밖)보다 이만큼 뚜렷해야 믿는다
  agree_s: 0.005,       // 장단 묶음마다 따로 잰 값이 전체 값과 이만큼 안에 들어야 '일치'
  // 뚜렷함이 모자라도(1.5 이상) 이 브라우저에서 지난번에 잰 값과 10ms 안이면 믿는다(아이 소리가 섞인 경우)
  weak_contrast: 1.5,
  weak_match_s: 0.010,
};

/** 앱이 스피커로 낸 소리를 녹음 시간축 위에 다시 그린다 — 지연이 0이었다면 녹음에 들어왔을 모양.
 *  events: [{ data: Float32Array(모노), when: 녹음 0초 기준 시작(초), offset: 버퍼 안 시작(초),
 *             dur: 길이(초), loop: 되풀이 여부, gain }]  — app.js 의 playBuf 호출과 1:1 */
function renderPlayed(events, sr, length) {
  const out = new Float32Array(length);
  for (const e of events) {
    const d = e.data;
    if (!d || !d.length) continue;
    const i0 = Math.round(e.when * sr), n = Math.round(e.dur * sr), o = Math.round((e.offset || 0) * sr);
    const g = e.gain === undefined ? 1 : e.gain;
    for (let k = Math.max(0, -i0); k < n; k++) {
      const i = i0 + k;
      if (i >= length) break;
      let j = o + k;
      if (e.loop) j %= d.length;
      else if (j >= d.length) break;
      out[i] += g * d[j];
    }
  }
  return out;
}

/** 타점 포락선: 소리가 갑자기 커지는 순간만 남긴다. 장구 타점의 시작은 스피커·방을 지나도 날카롭다.
 *  고음 강조(앞 차분) → 2ms 창의 크기 → 로그 → 1ms 사이에 커진 만큼(양수만).
 *  로그의 바닥은 regions(초) 안 크기의 95번째 백분위의 1%로 둔다. 녹음은 새어 든 소리라 작으므로
 *  신호마다 자기 크기에 맞춰야 두 포락선이 같은 모양이 된다. */
function onsetEnvelope(x, sr, regions, opt) {
  const o = Object.assign({}, AUTO_LATENCY, opt || {});
  const hop = Math.max(1, Math.round(sr * o.hop_s)), win = Math.max(hop, Math.round(sr * o.win_s));
  const m = Math.max(0, Math.floor((x.length - win) / hop));
  const a = new Float32Array(m);
  for (let f = 0; f < m; f++) {
    const s0 = f * hop;
    let s = 0;
    for (let i = s0; i < s0 + win; i++) {
      const y = x[i] - 0.97 * (i > 0 ? x[i - 1] : 0);
      s += y * y;
    }
    a[f] = Math.sqrt(s / win);
  }
  const fr = sr / hop, picked = [];
  for (const [t0, t1] of regions) {
    for (let f = Math.max(0, Math.floor(t0 * fr)); f < Math.min(m, Math.floor(t1 * fr)); f++) picked.push(a[f]);
  }
  const sorted = Float32Array.from(picked).sort();
  const p95 = sorted.length ? sorted[Math.floor(0.95 * (sorted.length - 1))] : 0;
  const floor = 0.01 * p95 + 1e-12;
  const env = new Float32Array(m);
  let prev2 = 0, prev1 = 0;
  for (let f = 0; f < m; f++) {
    const c = Math.log(a[f] + floor);
    if (f >= 2) env[f] = Math.max(0, c - prev2);
    prev2 = prev1; prev1 = c;
  }
  return { env, hop, fr };
}

/** 점수 곡선에서 가장 높은 자리(포물선 보간)와 그 뚜렷함 */
function _peak(score, L0, fr, farS) {
  let b = 0;
  for (let k = 1; k < score.length; k++) if (score[k] > score[b]) b = k;
  let delta = 0;
  if (b > 0 && b < score.length - 1) {
    const den = score[b - 1] - 2 * score[b] + score[b + 1];
    if (den < 0) delta = Math.max(-0.5, Math.min(0.5, 0.5 * (score[b - 1] - score[b + 1]) / den));
  }
  const sorted = Float64Array.from(score).sort();
  const med = sorted[Math.floor(sorted.length / 2)];
  let far = -Infinity;
  const farK = farS * fr;
  for (let k = 0; k < score.length; k++) if (Math.abs(k - b) > farK && score[k] > far) far = score[k];
  const contrast = (score[b] - med) / Math.max(1e-9, far - med);
  return { delay_s: (L0 + b + delta) / fr, contrast, atEdge: b === 0 || b === score.length - 1 };
}

/** 녹음(rec)에 앱이 낸 소리(ref)가 몇 초 늦게 들어왔는가.
 *  groups: 장단 묶음마다 [[시작초, 끝초], …] — 학생이 부르지 않는 자리만 넣는다(녹음 0초 기준).
 *          묶음마다 따로도 재서, 서로 맞는지로 결과를 믿을지 정한다.
 *  돌려주는 것: { ok, delay_s, contrast, agree, n_groups, per_group_s, reason } */
function estimateDelay(rec, ref, sr, groups, opt) {
  const o = Object.assign({}, AUTO_LATENCY, opt || {});
  const all = [].concat(...groups);
  if (!all.length) return { ok: false, reason: "학생이 부르지 않는 장단이 없습니다" };
  const R = onsetEnvelope(ref, sr, all, o);
  const X = onsetEnvelope(rec, sr, all.map(([a, b]) => [a, b + o.hi_s]), o);
  const fr = R.fr, L0 = Math.floor(o.lo_s * fr), L1 = Math.ceil(o.hi_s * fr), nL = L1 - L0 + 1;
  const G = groups.length;
  const num = new Float64Array(G * nL), xx = new Float64Array(G * nL), rr = new Float64Array(G);
  // 묶음마다 분자·분모를 모은다. 전체 점수는 그 합으로 낸다(한 번만 훑는다).
  for (let g = 0; g < G; g++) {
    for (const [t0, t1] of groups[g]) {
      const m0 = Math.max(0, Math.floor(t0 * fr)), m1 = Math.min(R.env.length, Math.floor(t1 * fr));
      for (let m = m0; m < m1; m++) rr[g] += R.env[m] * R.env[m];
      for (let k = 0; k < nL; k++) {
        const L = L0 + k, a = Math.max(m0, -L), b = Math.min(m1, X.env.length - L);
        let s = 0, q = 0;
        for (let m = a; m < b; m++) { const v = X.env[m + L]; s += R.env[m] * v; q += v * v; }
        num[g * nL + k] += s; xx[g * nL + k] += q;
      }
    }
  }
  let rrAll = 0;
  for (let g = 0; g < G; g++) rrAll += rr[g];
  if (!(rrAll > 0)) return { ok: false, reason: "앱이 낸 소리를 알 수 없습니다" };
  const cos = (n, x, r) => (x > 0 && r > 0) ? n / Math.sqrt(x * r) : 0;
  const whole = new Float64Array(nL);
  for (let k = 0; k < nL; k++) {
    let n = 0, x = 0;
    for (let g = 0; g < G; g++) { n += num[g * nL + k]; x += xx[g * nL + k]; }
    whole[k] = cos(n, x, rrAll);
  }
  const W = _peak(whole, L0, fr, 0.03);
  const per = [];
  for (let g = 0; g < G; g++) {
    const sc = new Float64Array(nL);
    for (let k = 0; k < nL; k++) sc[k] = cos(num[g * nL + k], xx[g * nL + k], rr[g]);
    per.push(_peak(sc, L0, fr, 0.03).delay_s);
  }
  const agree = per.filter(p => Math.abs(p - W.delay_s) <= o.agree_s).length;
  const out = {
    delay_s: W.delay_s, contrast: W.contrast, agree, n_groups: G, per_group_s: per,
  };
  if (W.atEdge) return Object.assign(out, { ok: false, reason: "찾는 범위의 끝에 걸렸습니다" });
  if (W.contrast < o.min_contrast) return Object.assign(out, { ok: false, reason: "장구 소리가 뚜렷하게 잡히지 않았습니다" });
  if (agree < Math.ceil(G / 2)) return Object.assign(out, { ok: false, reason: "장단마다 잰 값이 서로 맞지 않습니다" });
  return Object.assign(out, { ok: true, reason: "" });
}

/** 이번 녹음에 쓸 지연을 고른다.
 *  ① 자동으로 잰 값을 믿을 수 있으면 그것("auto")
 *  ② 조금 덜 뚜렷해도 이 브라우저에서 지난번에 잰 값과 거의 같으면 이번 값("auto")
 *  ③ 못 쟀으면 이 브라우저에서 지난번에 잰 값("previous")
 *  ④ 그것도 없으면 예전 방식(브라우저가 알려 준 출력 지연 + config 고정값, "fixed")
 *  previous_s: 지난번 값(없으면 null), fixed_s: ④의 값 */
function chooseLatency(est, previous_s, fixed_s, opt) {
  const o = Object.assign({}, AUTO_LATENCY, opt || {});
  if (est && est.ok) return { latency_s: est.delay_s, method: "auto" };
  const prevOk = Number.isFinite(previous_s);
  if (est && prevOk && Number.isFinite(est.delay_s) && est.contrast >= o.weak_contrast &&
      Math.abs(est.delay_s - previous_s) <= o.weak_match_s) {
    return { latency_s: est.delay_s, method: "auto" };
  }
  if (prevOk) return { latency_s: previous_s, method: "previous" };
  return { latency_s: fixed_s, method: "fixed" };
}

if (typeof module !== "undefined") {
  module.exports = { clickOffsets, summarize, renderPlayed, onsetEnvelope, estimateDelay, chooseLatency, AUTO_LATENCY };
}
