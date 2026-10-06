/*
 * lyrics.js — 가사를 화면에 얹는다
 * ---------------------------------------------------------------------------
 * 두 가지로 보여 준다.
 *   ① 가사 줄      : 화면 위쪽 가운데에 지금 부르는 줄 하나를 크게(준비·주고받기·거울 화면).
 *   ② 가락선 위 글자 : 그래프 안에서 글자마다 그 소리가 시작하는 자리, 가락선 바로 위에.
 *
 * 글자 자리는 config 의 lyrics 에서 온다. 토막(sobak/text)은 박 단위이고, 한 박에 여러 글자가
 * 묶인 토막에는 글자마다의 소박(char_sobak — 선생님 녹음에서 재어 연구자가 확인한 값)이 있다.
 * 자리가 적히지 않은 묶음은 자리를 지어내지 않고 묶음 그대로 한 덩이로 놓는다.
 * 서버의 비교 문장은 토막만 읽으므로 여기서 글자를 어떻게 놓든 분석에는 영향이 없다.
 */

/** 가사를 글자 하나씩 푼다. [{sobak, text, chunk}] — chunk 는 그 글자가 속한 토막의 소박. */
function lyricChars(song) {
  const out = [];
  for (const e of (song && song.lyrics) || []) {
    const chars = [...e.text];
    if (e.char_sobak && e.char_sobak.length === chars.length) {
      chars.forEach((c, i) => out.push({ sobak: e.char_sobak[i], text: c, chunk: e.sobak }));
    } else {
      out.push({ sobak: e.sobak, text: e.text, chunk: e.sobak });
    }
  }
  return out;
}

/* ---------- ① 가사 줄 ---------- */

/** 지금 소박 위치에 해당하는 가사 줄 */
function lyricLineAt(song, sobak) {
  const L = song.lyric_lines || [];
  for (let i = 0; i < L.length; i++) if (sobak >= L[i][0] && sobak < L[i][1]) return i;
  return -1;
}

/**
 * 가사 줄을 그린다. 줄이 바뀔 때만 다시 만들고, 그 사이에는 글자 강조만 옮긴다.
 * (매 프레임 DOM을 새로 만들면 글자가 깜빡인다)
 * 토막은 한 덩이(.ly-w)로 묶어 띄어 쓰고, 강조는 가락선 위 글자와 같이 글자 하나씩 옮긴다.
 */
function renderLyric(el, song, sobak) {
  const L = song.lyric_lines || [];
  if (!L.length) { el.innerHTML = ""; return; }
  const li = lyricLineAt(song, sobak);
  if (el.dataset.line !== String(li)) {
    el.dataset.line = String(li);
    if (li < 0) { el.innerHTML = '<span class="ly-wait">♪</span>'; return; }
    const [a, b] = L[li];
    const chars = lyricChars(song).filter(c => c.chunk >= a && c.chunk < b);
    // 낱말 묶음은 줄 문구(lyric_lines)의 띄어쓰기를 따른다 — '다음 ♪' 줄과 같은 모양이 되게.
    // (토막은 박 단위라 '금다래|꿍'처럼 낱말 가운데서 끊긴다.) 글자 수가 맞지 않으면 토막대로 묶는다.
    // 글자 자리가 없는 여러 글자 토막('아라')도 한 낱말 안에 들어가면 그대로 받는다.
    const words = [];
    const spaced = (L[li][2] || "").split(/\s+/).filter(Boolean);
    let byWords = spaced.length > 0 && spaced.join("") === chars.map(c => c.text).join("");
    if (byWords) {
      let k = 0;
      for (const wd of spaced) {
        const w = { chars: [] }; let n = 0;
        while (k < chars.length && n < [...wd].length) { w.chars.push(chars[k]); n += [...chars[k].text].length; k++; }
        if (n !== [...wd].length) { byWords = false; break; }       // 토막이 낱말 경계에 걸침
        words.push(w);
      }
    }
    if (!byWords) {
      words.length = 0;
      for (const c of chars) {
        if (!words.length || words[words.length - 1].chunk !== c.chunk) words.push({ chunk: c.chunk, chars: [] });
        words[words.length - 1].chars.push(c);
      }
    }
    el.innerHTML = words.length
      ? words.map(w => `<span class="ly-w">${w.chars.map(c =>
          `<span class="ly" data-s="${c.sobak}">${c.text}</span>`).join("")}</span>`).join("")
      : `<span class="ly-w"><span class="ly" data-s="${a}">${L[li][2]}</span></span>`;
    el.classList.remove("ly-in"); void el.offsetWidth; el.classList.add("ly-in");
  }
  if (li < 0) return;
  const spans = [...el.querySelectorAll(".ly")];
  let cur = -1;
  for (let i = 0; i < spans.length; i++) if (sobak >= +spans[i].dataset.s) cur = i;
  spans.forEach((s, i) => s.classList.toggle("on", i === cur));
}

/** 다음 줄 미리보기 */
function lyricNext(song, sobak) {
  const L = song.lyric_lines || [];
  const li = lyricLineAt(song, sobak);
  // 노래가 시작되기 전에만 첫 줄을 미리 보인다(다 부른 뒤에 첫 줄이 다시 올 것처럼 보이지 않게)
  if (li < 0) return (L.length && sobak < L[0][0]) ? L[0][2] : "";
  return L[li + 1] ? L[li + 1][2] : "";
}

/* ---------- ② 가락선 위 글자 ---------- */

/** 글자 줄이 쓰는 위 여백(px). 지금 글자는 1.25배로 커지므로 그만큼 둔다.
 *  글자가 없는 옆 그래프도 같은 값을 쓰면 두 그래프의 세로 눈금이 맞는다. */
function lyricTopPad(size) { return Math.round(size * 1.25) + 6; }

/**
 * 그래프 시간축 위의 글자 목록. t = 0 은 비교 구간의 첫 정박(곡 전체에서 base 번째 소박)이다.
 * 각 글자는 다음 글자 직전까지 이어진다고 본다(tEnd) — '지금 부르는 글자'를 고를 때 쓴다.
 * chunk = 그 글자가 속한 토막(한 박)의 소박. 비교 구간 밖의 글자는 뺀다.
 */
function lyricGlyphs(song, base, sobakS, total) {
  const ch = lyricChars(song);
  const out = [];
  for (let i = 0; i < ch.length; i++) {
    const t = (ch[i].sobak - base) * sobakS;
    if (t < -1e-6 || t >= total - 1e-6) continue;
    const tEnd = i + 1 < ch.length ? Math.min(total, (ch[i + 1].sobak - base) * sobakS) : total;
    out.push({ t: Math.max(0, t), tEnd, text: ch[i].text, sobak: ch[i].sobak, chunk: ch[i].chunk });
  }
  return out;
}

/**
 * 곡선 c 에서 시각 t 를 사이에 둔, 화면에 선으로 이어 그려진 두 프레임 [i, j]. 선이 없으면 null.
 * 그리기 규칙(chart.js)을 그대로 따른다: 짧은 틈만 잇고(canBridge), 그래프 밖으로 나간 값(cut)에서는 끊는다.
 */
function curveSegmentAt(c, t, bridgeS, cut) {
  const ok = p => p && p.cents !== null && p.cents !== undefined && (!cut || (p.cents >= cut[0] && p.cents <= cut[1]));
  let lo = 0, hi = c.length;                     // t 이상인 첫 프레임 (이분 탐색)
  while (lo < hi) { const mid = (lo + hi) >> 1; if (c[mid].t < t) lo = mid + 1; else hi = mid; }
  let i = lo - 1, j = lo;
  if (j < c.length && c[j].t === t && ok(c[j])) return [j, j];
  while (i >= 0 && c[i].cents === null) i--;
  while (j < c.length && c[j].cents === null) j++;
  if (i < 0 || j >= c.length || !ok(c[i]) || !ok(c[j])) return null;
  const hop = c.length > 1 ? c[1].t - c[0].t : 0.01;
  return canBridge(c[i].t, c[j].t, hop, bridgeS || 0) ? [i, j] : null;
}

/**
 * 시각 tA~tB 사이에서 곡선들이 가장 높이 올라간 값(cent). 잰 값이 하나도 없으면 null.
 * 양 끝(tA, tB)에서는 화면에 그어진 선분의 높이도 본다 — 프레임 사이로 선이 글자 모서리를
 * 가로지를 수 있기 때문이다(확대한 돋보기에서는 프레임 사이가 몇 px씩 벌어진다).
 * cut = [아래, 위] — 그래프가 그리지 않는 값(그래프 밖)은 보지 않는다.
 */
function curvesTopCents(curves, tA, tB, bridgeS, cut) {
  let best = null;
  const take = v => { if (v !== null && v !== undefined && (best === null || v > best)) best = v; };
  for (const c of curves) {
    if (!c || !c.length) continue;
    const lineAt = t => {
      const seg = curveSegmentAt(c, t, bridgeS, cut);
      if (!seg) return null;
      const [i, j] = seg;
      if (i === j) return c[i].cents;
      const r = (t - c[i].t) / (c[j].t - c[i].t);
      return c[i].cents + (c[j].cents - c[i].cents) * Math.max(0, Math.min(1, r));
    };
    let k = 0, hi = c.length;
    while (k < hi) { const mid = (k + hi) >> 1; if (c[mid].t < tA) k = mid + 1; else hi = mid; }
    for (; k < c.length && c[k].t <= tB; k++) {
      const v = c[k].cents;
      if (v !== null && v !== undefined && (!cut || (v >= cut[0] && v <= cut[1]))) take(v);
    }
    take(lineAt(tA)); take(lineAt(tB));
  }
  return best;
}

/**
 * 한 박에 묶인 글자(토막)가 그 박 안에 다 들어가는 글자 크기. 화면이 좁으면 줄인다.
 * 줄이지 않으면 겹침을 피해 오른쪽으로 민 글자가 쌓여 다음 박의 음 위에 앉는다.
 */
function fitLyricSize(glyphs, o, base, minSize, measureAt1) {
  let size = base;
  for (let i = 0; i < glyphs.length;) {
    let j = i;
    while (j < glyphs.length && glyphs[j].chunk === glyphs[i].chunk) j++;
    const end = j < glyphs.length ? glyphs[j].t : glyphs[j - 1].tEnd;
    const avail = o.X(end) - o.X(glyphs[i].t) - 2;
    let need = 0;
    for (let k = i; k < j; k++) need += measureAt1(glyphs[k].text) + (k > i ? 2 / base : 0);
    if (need > 0 && avail > 0) size = Math.min(size, avail / need);
    i = j;
  }
  return Math.max(minSize, Math.min(base, Math.floor(size)));
}

/**
 * 글자 자리를 계산한다(그리지는 않는다).
 *  - 가로: 글자의 왼쪽 끝을 그 글자가 시작하는 시각 바로 오른쪽(1px, 장단 첫 글자는 굵은 장단선을
 *          비켜 3px)에 둔다. 앞 글자와 겹치면 오른쪽으로 민다(빠른 '쾌지나'처럼 반 소박 간격이면
 *          글자 폭보다 좁다). 왼쪽 끝에 거의 수직인 선(음과 음 사이의 뚝 떨어짐)이 걸리면 그 선
 *          오른쪽으로 비켜 앉는다 — 그 선 꼭대기에 맞추면 글자가 앞 음 높이에 떠서 앞 음의 글자처럼 보인다.
 *          창(돋보기) 왼쪽 밖에서 시작해 창 안으로 글자 폭 넘게 이어지는 글자는 창 왼쪽 끝에 놓고
 *          cont 로 표시한다. 제 자리에서 창 오른쪽 끝에 다 들어가지 않는 글자는 뺀다.
 *  - 세로: 글자가 차지하는 폭 안에서 곡선이 가장 높이 올라간 곳의 바로 위. 그래야 글자가
 *          어느 선도 가리지 않는다. 글자 시작 전의 선은 보지 않는다 — 장단 경계에서 뚝 떨어지기
 *          전의 높은 음까지 보면 글자가 앞 음 위로 떠서 앞 장단의 글자처럼 보인다.
 *          그 폭에 잰 값이 없으면(무성 자음·숨) 그 글자가 이어지는 동안의 가장 높은 곳을,
 *          그래도 없으면 앞 글자의 높이를 쓴다.
 * o = {X, T, Y, curves, yMin, yMax, xMin, xMax, top, size, gap, bridgeS, cut, jangdanS, measure}
 */
function layoutLyricGlyphs(glyphs, o) {
  const gap = o.gap === undefined ? 4 : o.gap;
  const out = [];
  let prevRight = -Infinity, prevY = null;
  // 시각 t 에 걸린 거의 수직인 선이 있으면 그 선이 끝나는 x(+3px), 없으면 null
  const steepEnd = t => {
    let end = null;
    for (const c of o.curves) {
      if (!c || !c.length) continue;
      const seg = curveSegmentAt(c, t, o.bridgeS, o.cut);
      if (!seg || seg[0] === seg[1]) continue;
      const [i, j] = seg;
      const dx = o.X(c[j].t) - o.X(c[i].t), dy = Math.abs(o.Y(c[j].cents) - o.Y(c[i].cents));
      if (dx < 4 && dy > o.size) end = Math.max(end === null ? -Infinity : end, o.X(c[j].t) + 3);
    }
    return end;
  };
  for (const g of glyphs) {
    const x0 = o.X(g.t);
    if (x0 >= o.xMax - 1 || o.X(g.tEnd) <= o.xMin + 1) continue;   // 그래프(창) 밖
    const cont = x0 < o.xMin - 1;
    const w = o.measure(g.text);
    if (cont && o.X(g.tEnd) - o.xMin < w + 3) continue;           // 창 안에 거의 남지 않은 소리
    const head = o.jangdanS && Math.abs(g.t / o.jangdanS - Math.round(g.t / o.jangdanS)) < 1e-6;
    let x = Math.max(cont ? o.xMin + 1 : x0 + (head ? 3 : 1), prevRight + 2);
    const se = steepEnd(o.T(x));
    if (se !== null && se > x && se - x < w) x = se;
    // 아주 좁은 화면: 앞 글자에 밀려 제 소리 구간 밖으로 나가는 글자는 빼고, 뒤 글자는 더 밀지 않는다.
    // (그대로 두면 밀림이 쌓여 줄 끝 글자 — 금다래꿍의 떠는 자리 '네' 같은 — 가 통째로 빠진다)
    // (장단 첫 글자가 굵은 장단선을 비켜 원래 띄우는 3px 는 '밀림'으로 치지 않는다 — 반 소박짜리 '쾌'가 빠졌다)
    if (!cont && x > x0 + (head ? 3 : 1) + 0.01 && x >= o.X(g.tEnd) - 1) continue;
    if (x + w > o.xMax) {
      if (!cont && x0 + 1 + w > o.xMax) continue;                 // 제 자리에서 안 들어가면 빼고
      x = Math.max(o.xMin, o.xMax - w);                           // 앞 글자에 밀린 것이면 당긴다
      if (x < prevRight + 2) continue;                            // 당길 자리도 없으면(아주 좁은 화면) 겹쳐 쌓지 않고 뺀다
    }
    let c = curvesTopCents(o.curves, o.T(x), o.T(x + w), o.bridgeS, o.cut);
    if (c === null) c = curvesTopCents(o.curves, Math.max(g.t, o.T(o.xMin)), g.tEnd, o.bridgeS, o.cut);
    let y;
    if (c !== null) y = o.Y(Math.min(o.yMax, Math.max(o.yMin, c))) - gap;
    else y = prevY !== null ? prevY : o.Y(0) - gap;
    y = Math.max(o.top + o.size * 1.25, y);
    out.push({ ...g, x, y, w, cont });
    prevRight = x + w; prevY = y;
  }
  return out;
}

/**
 * 글자를 그린다. 글씨는 굵게, 뒤에 바탕색 테두리를 둘러 격자선·곡선 위에서도 읽히게 한다.
 * o.active = 재생 중인가. 재생 중에는 지금 부르는 글자(o.tNow 가 그 글자 안)만 진하고 크게,
 * 나머지는 한 단계 옅게 그린다. 멈춰 있을 때는 모두 진하게.
 * o.dim = {a, b} 이면 그 구간(되풀이 구간) 밖 글자를 흐리게 한다.
 */
function drawLyricGlyphs(ctx, glyphs, o) {
  const base = o.size || 16;
  const font = s => `800 ${s}px system-ui, -apple-system, "Apple SD Gothic Neo", sans-serif`;
  ctx.save();
  ctx.font = font(100);
  // 아주 좁은 그래프(휴대폰)에서는 글자를 조금 더 줄여서라도 넣는다
  const narrow = (o.xMax - o.xMin) < 500;
  const size = fitLyricSize(glyphs, o, base, Math.min(base, o.minSize || (narrow ? 9 : 11)),
    t => ctx.measureText(t).width / 100);
  ctx.font = font(size);
  const placed = layoutLyricGlyphs(glyphs, { ...o, size, measure: t => ctx.measureText(t).width });
  ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.lineJoin = "round";
  const hasNow = o.tNow !== null && o.tNow !== undefined;
  for (const g of placed) {
    const now = hasNow && o.tNow >= g.t && o.tNow < g.tEnd;
    const s = now ? Math.round(size * 1.25) : size;
    ctx.font = font(s);
    const x = g.x + g.w / 2 - ctx.measureText(g.text).width / 2;   // 커져도 제자리에서
    // 구간에 조금이라도 걸치는 글자(구간 앞에서 시작해 길게 뻗는 '네' 등)와 지금 글자는 흐리게 하지 않는다
    const outside = o.dim && !now && (g.tEnd <= o.dim.a + 1e-6 || g.t >= o.dim.b - 1e-6);
    ctx.globalAlpha = outside ? 0.35 : (g.cont ? 0.55 : 1);       // cont = 창 앞에서 이어지는 글자
    // 테두리는 얇고 살짝 비치게 — 글자 뒤를 지나는 본청선·장단선이 토막토막 끊겨 보이지 않도록
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(255,253,248,0.8)";
    ctx.strokeText(g.text, x, g.y);
    if (now) { ctx.shadowColor = "rgba(192,106,45,0.6)"; ctx.shadowBlur = 10; }
    ctx.fillStyle = now ? "#191C21" : (o.active ? "#646A73" : "#33383F");
    ctx.fillText(g.text, x, g.y);
    ctx.shadowBlur = 0; ctx.shadowColor = "transparent";
  }
  ctx.restore();
  return placed;
}
