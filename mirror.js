/*
 * mirror.js — 소리거울
 * ---------------------------------------------------------------------------
 * 두 가락선을 '거울' 안에 겹쳐 놓고, 소리가 흐르는 대로 함께 움직이게 한다.
 *
 * 무엇을 보여 주려는 것인가
 *   - 두 선이 가까울수록 닮은 부분, 벌어질수록 다른 부분. 그 사이를 옅은 띠로 채워
 *     '얼마나 벌어져 있는지'가 눈에 바로 들어오게 한다.
 *   - 점수·정오 표시는 하지 않는다. 숫자는 지금 재생 중인 지점의 차이(cent)만 보여 준다.
 *   - 지나간 부분은 진하게, 앞으로 올 부분은 흐리게 그려서 선이 '그려지는' 느낌을 준다.
 *   - 거울면(본청선) 아래쪽에 두 선을 뒤집어 비친 반사를 옅게 깔아 깊이감을 준다.
 *     반사는 장식이고 읽는 대상은 위쪽 선이다.
 *
 * 시간축은 build_reference.py가 맞춰 둔 장단 격자를 그대로 쓴다(사후 정렬 없음).
 */

// 가사 줄·가락선 위 글자는 lyrics.js 에 있다.

/* ---------- 거울 그리기 ---------- */

function mirrorGeom(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
    canvas.width = w * dpr; canvas.height = h * dpr;
  }
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w, h };
}

/**
 * @param o {expert, student, timing, yMin, yMax, tNow(초|null), colors:{expert,student},
 *           studentLabel,
 *           lyrics:{glyphs, size, active}  — 가락선 위 글자(lyrics.js),
 *           selection:{a, b}               — 되풀이해 들을 구간(초). 그 밖은 옅게 가린다,
 *           view:{t0, t1, mode}            — 확대해 볼 범위(초). mode = "jangdan" | "bak".
 *                                            없으면 전체. yMin/yMax 는 부르는 쪽이 그 범위에 맞춰 준다}
 * @returns {X, Y, T, total} — T 는 화면 가로 위치(px) → 시각(초). 끌어서 구간을 고를 때 쓴다.
 */
function drawMirror(canvas, o) {
  const { ctx, w, h } = mirrorGeom(canvas);
  const tm = o.timing, total = tm.total_seconds;
  const lyr = (o.lyrics && o.lyrics.glyphs && o.lyrics.glyphs.length) ? o.lyrics : null;
  const lyrSize = lyr ? (lyr.size || 17) : 0;
  // 가사 글자가 맨 위 곡선 위에도 들어가도록 위 여백을 글자 높이만큼 늘린다
  const padL = 8, padR = 8, padT = lyr ? 8 + lyricTopPad(lyrSize) : 14;
  const reflectH = Math.min(56, h * 0.18);      // 아래쪽 반사 띠
  const plotH = h - padT - reflectH - 10;
  // 확대해 볼 때는 거울 폭 전체가 그 범위(한 장단 또는 한 박)다
  const view = o.view || null;
  const v0 = view ? view.t0 : 0, v1 = view ? view.t1 : total;
  const X = t => padL + ((t - v0) / (v1 - v0)) * (w - padL - padR);
  const T = x => Math.max(v0, Math.min(v1, v0 + ((x - padL) / (w - padL - padR)) * (v1 - v0)));
  const Y = c => padT + (1 - (c - o.yMin) / (o.yMax - o.yMin)) * plotH;
  const tNow = (o.tNow === null || o.tNow === undefined) ? total : o.tNow;

  ctx.clearRect(0, 0, w, h);

  /* 거울 바탕: 은빛 유리 — 위에서 아래로 옅은 그라데이션 + 사선 광택 (테두리·빛줄기는 style.css) */
  let g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, "#FBFCFD"); g.addColorStop(0.55, "#F1F3F6"); g.addColorStop(1, "#E3E7EC");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
  g = ctx.createLinearGradient(0, 0, w * 0.75, h);
  g.addColorStop(0, "rgba(255,255,255,0.55)"); g.addColorStop(0.35, "rgba(255,255,255,0.06)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);

  const sideLabels = [];                           // 오른쪽 끝 글씨(cent 숫자·'본청'). 곡선 뒤에 쓴다.
  const cellLabels = [];                           // 확대 때 칸 이름(첫째 소박·1박…). 곡선 뒤에 쓴다.
  /* 장단·박 격자. 확대해 볼 때는 소박 칸도 긋고, 칸마다 이름(1박~4박 / 첫째~셋째 소박)을 적는다 */
  const sobakS = tm.sobak_seconds, perJangdan = tm.sobak_per_jangdan, perBak = tm.sobak_per_bak;
  const kA = Math.floor(v0 / sobakS + 1e-6), kB = Math.ceil(v1 / sobakS - 1e-6);
  for (let k = kA; k <= kB; k++) {
    const isJd = k % perJangdan === 0, isBak = k % perBak === 0;
    if (!isBak && !view) continue;
    ctx.strokeStyle = isJd ? "rgba(90,80,64,0.38)" : (isBak ? "rgba(140,130,110,0.22)" : "rgba(140,130,110,0.10)");
    ctx.lineWidth = isJd ? 1.6 : 1;
    ctx.beginPath(); ctx.moveTo(X(k * sobakS), padT - 6); ctx.lineTo(X(k * sobakS), padT + plotH); ctx.stroke();
    if (!view && isJd && k < tm.total_sobak) {
      cellLabels.push({ text: `${k / perJangdan + 1}장단`, x: X(k * sobakS) + 5, y: padT + plotH - 4, align: "left", font: "11px system-ui" });
    }
  }
  if (view) {
    const ORD = ["첫째", "둘째", "셋째", "넷째"];
    const cell = view.mode === "bak" ? sobakS : sobakS * perBak;
    // 칸 이름도 곡선 뒤에 바탕 테두리와 함께 쓴다(곡선이 아래로 내려가며 글씨를 지나간다)
    for (let t = v0; t < v1 - 1e-6; t += cell) {
      const kk = Math.round(t / cell);
      const name = view.mode === "bak" ? `${ORD[kk % perBak]} 소박` : `${(kk % (perJangdan / perBak)) + 1}박`;
      cellLabels.push({ text: name, x: (X(t) + X(t + cell)) / 2, y: padT + plotH - 4 });
    }
    // 세로도 그 범위에 맞춰 키웠으므로 cent 눈금을 옅게 적어 얼마나 키웠는지 보이게 한다
    const span = o.yMax - o.yMin;
    const step = [10, 20, 25, 50, 100, 200, 300, 500].find(s => span / s <= 6) || 600;
    // 숫자는 오른쪽 끝에 적는다('본청'과 같은 쪽). 왼쪽 끝에는 첫 가사 글자와 선의 시작이 온다.
    // 곡선이 지나가며 숫자를 가리지 않게, 선만 여기서 긋고 숫자는 곡선을 다 그린 뒤에 쓴다(sideLabels).
    for (let c = Math.ceil(o.yMin / step) * step; c <= o.yMax; c += step) {
      if (c === 0) continue;                       // 본청선은 따로 긋는다
      const y = Y(c);
      ctx.strokeStyle = "rgba(140,130,110,0.12)"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(w - padR, y); ctx.stroke();
      if (y < padT + plotH - 16) sideLabels.push({ text: `${c > 0 ? "+" : ""}${c}`, y: y - 3 });   // 아래 줄은 소박 이름 자리
    }
  }

  /* 되풀이 구간 바탕 — 고른 곳을 옅게 물들인다(밖을 가리는 막은 곡선을 그린 뒤에 덮는다) */
  const clampX = x => Math.max(0, Math.min(w, x));
  const sel = o.selection ? { xa: clampX(X(o.selection.a)), xb: clampX(X(o.selection.b)) } : null;
  if (sel) {
    ctx.fillStyle = "rgba(47,74,110,0.06)";
    ctx.fillRect(sel.xa, padT - 6, sel.xb - sel.xa, plotH + 6);
  }

  /* 거울면 = 본청선 (확대해 본청이 범위 밖이면 긋지 않는다) */
  const y0 = Y(0);
  if (o.yMin <= 0 && 0 <= o.yMax) {
  g = ctx.createLinearGradient(0, y0 - 3, 0, y0 + 3);
  g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.9)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g; ctx.fillRect(0, y0 - 3, w, 6);
  ctx.strokeStyle = "rgba(90,80,64,0.45)"; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, y0); ctx.lineTo(w - padR, y0); ctx.stroke();
  // '본청'은 오른쪽 끝에 적는다. 왼쪽 끝에는 첫 가사 글자가 앉는다(아리랑 '아'가 덮었다).
  sideLabels.push({ text: "본청", y: y0 - 5, strong: true });
  }

  const pts = curve => curve.map(p => (p.cents === null ? null : { x: X(p.t), y: Y(p.cents), t: p.t, c: p.cents }));
  const E = pts(o.expert.curve), S = pts(o.student.curve);

  // 확대해 볼 때는 그 범위 밖(옆 박·위아래로 넘친 곳)의 선과 띠를 그림 칸에서 잘라 낸다
  ctx.save();
  if (view) { ctx.beginPath(); ctx.rect(padL, padT - 6, w - padL - padR, plotH + 6); ctx.clip(); }

  /* 두 선 사이의 차이를 옅은 띠로 — 가까우면 거의 안 보이고 벌어질수록 진해진다 */
  const n = Math.min(E.length, S.length);
  let i = 0;
  while (i < n) {
    if (!E[i] || !S[i]) { i++; continue; }
    let j = i;
    while (j < n && E[j] && S[j]) j++;
    for (let k = i; k < j - 1; k++) {
      const d = Math.abs(E[k].c - S[k].c);
      const a = Math.min(0.3, Math.max(0, (d - 25) / 260) * 0.3);
      if (a <= 0.006) continue;
      ctx.fillStyle = `rgba(196,138,60,${E[k].t <= tNow ? a : a * 0.35})`;
      ctx.beginPath();
      ctx.moveTo(E[k].x, E[k].y); ctx.lineTo(E[k + 1].x, E[k + 1].y);
      ctx.lineTo(S[k + 1].x, S[k + 1].y); ctx.lineTo(S[k].x, S[k].y);
      ctx.closePath(); ctx.fill();
    }
    i = j;
  }

  /* 곡선: 지나간 부분은 진하게, 앞으로 올 부분은 흐리게 */
  // 짧은 틈은 잇고 긴 틈(실제 숨자리)은 끊는다. chart.js 의 같은 규칙 — 표시 규칙일 뿐이다.
  const bridgeS = (o.bridgeGapMs || 0) / 1000;
  const hopS = hopSeconds(o.expert.curve);
  const stroke = (P, color, played) => {
    ctx.strokeStyle = color; ctx.lineWidth = played ? 3 : 2;
    ctx.globalAlpha = played ? 1 : 0.22;
    ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    let prevT = null;
    for (const p of P) {
      if (!p) continue;                                    // 음고를 재지 못한 프레임
      // 재생 위치(tNow)에서 진한 선과 흐린 선이 갈린다. 이 경계는 틈이 아니므로 잇지 않는다.
      if (played ? p.t > tNow : p.t < tNow) { prevT = null; continue; }
      if (canBridge(prevT, p.t, hopS, bridgeS)) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
      prevT = p.t;
    }
    ctx.stroke(); ctx.globalAlpha = 1;
  };
  stroke(E, o.colors.expert, false); stroke(S, o.colors.student, false);
  stroke(E, o.colors.expert, true);  stroke(S, o.colors.student, true);
  ctx.restore();

  /* 오른쪽 끝 글씨 — 바탕색 테두리를 둘러 곡선이 지나가도 읽히게 */
  ctx.font = "11px system-ui"; ctx.textAlign = "right"; ctx.lineJoin = "round"; ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(251,248,241,0.85)";
  for (const L of sideLabels) {
    ctx.strokeText(L.text, w - padR - 4, L.y);
    ctx.fillStyle = L.strong ? "rgba(90,80,64,0.6)" : "rgba(90,80,64,0.5)";
    ctx.fillText(L.text, w - padR - 4, L.y);
  }
  for (const L of cellLabels) {
    ctx.font = L.font || "12px system-ui"; ctx.textAlign = L.align || "center";
    ctx.strokeText(L.text, L.x, L.y);
    ctx.fillStyle = "rgba(90,80,64,0.55)"; ctx.fillText(L.text, L.x, L.y);
  }
  ctx.textAlign = "left";

  /* 아래쪽 반사 띠 — 거울에 비친 모습(장식) */
  const rTop = padT + plotH + 10;
  ctx.save();
  ctx.beginPath(); ctx.rect(padL, rTop, w - padL - padR, reflectH); ctx.clip();
  ctx.translate(0, rTop * 2 + reflectH * 0.1);
  ctx.scale(1, -0.42);
  ctx.globalAlpha = 0.20;
  stroke(E, o.colors.expert, true); stroke(S, o.colors.student, true);
  ctx.restore();
  g = ctx.createLinearGradient(0, rTop, 0, rTop + reflectH);
  g.addColorStop(0, "rgba(232,225,210,0.15)"); g.addColorStop(1, "rgba(232,225,210,1)");
  ctx.fillStyle = g; ctx.fillRect(0, rTop, w, reflectH);

  /* 되풀이 구간 밖은 옅은 막으로 덮어 고른 곳에 눈이 가게 하고, 양 끝에 점선을 긋는다 */
  if (sel) {
    ctx.fillStyle = "rgba(240,234,222,0.62)";
    ctx.fillRect(0, 0, sel.xa, h);
    ctx.fillRect(sel.xb, 0, w - sel.xb, h);
    ctx.strokeStyle = "rgba(47,74,110,0.6)"; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
    for (const x of [sel.xa, sel.xb]) { ctx.beginPath(); ctx.moveTo(x, padT - 6); ctx.lineTo(x, padT + plotH); ctx.stroke(); }
    ctx.setLineDash([]);
  }

  let diffLabel = null;                            // 재생선 옆 차이 숫자(가사 글자 뒤에 쓴다)
  /* 재생 위치 (확대해 볼 때는 그 범위 안에 있을 때만) */
  if (o.tNow !== null && o.tNow !== undefined && o.tNow < total && o.tNow >= v0 && o.tNow <= v1) {
    const x = X(tNow);
    g = ctx.createLinearGradient(x - 16, 0, x + 16, 0);
    g.addColorStop(0, "rgba(255,255,255,0)"); g.addColorStop(0.5, "rgba(255,255,255,0.75)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g; ctx.fillRect(x - 16, padT - 6, 32, plotH + 6);
    ctx.strokeStyle = "rgba(70,60,48,0.55)"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(x, padT - 6); ctx.lineTo(x, padT + plotH); ctx.stroke();

    // 지금 자리의 음고 점. 재생선 바로 앞(전체 보기 0.08초, 확대하면 화면 12px 안)에 잰 값이 있을 때만.
    // 단, 곡선 점 간격(10ms)보다 짧으면 점이 프레임마다 켜졌다 꺼졌다 한다(1박 보기에서 깜빡였다).
    const tol = Math.max(1.5 * hopS, Math.min(0.08, 12 * (v1 - v0) / (w - padL - padR)));
    const at = P => {
      let best = null;
      for (const p of P) if (p && p.t <= tNow && (!best || p.t > best.t)) best = p;
      return (best && tNow - best.t < tol && best.x >= padL && best.x <= w - padR &&
              best.y >= padT - 6 && best.y <= padT + plotH) ? best : null;
    };
    const pe = at(E), ps = at(S);
    if (pe && ps) {   // 두 점을 잇는 표시 — 가까우면 후광, 멀면 점선
      const d = Math.abs(pe.c - ps.c);
      if (d < 50) {
        ctx.fillStyle = "rgba(120,170,140,0.28)";
        ctx.beginPath(); ctx.arc(x, (pe.y + ps.y) / 2, Math.max(14, Math.abs(pe.y - ps.y)), 0, 7); ctx.fill();
      } else {
        ctx.strokeStyle = "rgba(140,110,70,0.5)"; ctx.setLineDash([3, 3]); ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.moveTo(x, pe.y); ctx.lineTo(x, ps.y); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = "600 12px system-ui";
        const label = `${Math.round(d)}`;
        // 오른쪽 끝 가까이에서는 재생선 왼쪽에 쓴다(끝의 눈금 숫자와 겹치거나 잘리지 않게).
        // 가사 글자 밑에 깔리지 않게 글자를 그린 뒤에 쓴다(diffLabel).
        const left = x + 6 + ctx.measureText(label).width > w - padR - 40;
        diffLabel = { text: label, align: left ? "right" : "left",
                      x: left ? Math.min(x - 6, w - padR - 34) : x + 6, y: (pe.y + ps.y) / 2 + 4 };
      }
    }
    for (const [p, col] of [[pe, o.colors.expert], [ps, o.colors.student]]) {
      if (!p) continue;
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(p.x, p.y, 6.5, 0, 7); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(p.x, p.y, 4.5, 0, 7); ctx.fill();
    }
  }

  /* 가락선 위 글자 — 두 선 가운데 그 자리에서 더 높은 선 바로 위에 얹는다 */
  if (lyr) drawLyricGlyphs(ctx, lyr.glyphs, {
    X, T, Y, curves: [o.expert.curve, o.student.curve], yMin: o.yMin, yMax: o.yMax,
    xMin: padL, xMax: w - padR, top: 2, size: lyrSize,
    tNow: o.tNow, active: !!lyr.active, bridgeS, jangdanS: sobakS * perJangdan,
    dim: o.selection || null,              // 되풀이 구간 밖 글자는 곡선처럼 흐리게
  });

  if (diffLabel) {
    ctx.font = "600 12px system-ui"; ctx.textAlign = diffLabel.align; ctx.lineJoin = "round";
    ctx.lineWidth = 3; ctx.strokeStyle = "rgba(251,248,241,0.9)";
    ctx.strokeText(diffLabel.text, diffLabel.x, diffLabel.y);
    ctx.fillStyle = "rgba(110,85,50,0.95)"; ctx.fillText(diffLabel.text, diffLabel.x, diffLabel.y);
    ctx.textAlign = "left";
  }

  /* 유리 테두리 */
  ctx.strokeStyle = "rgba(255,255,255,0.85)"; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, w - 1, h - 1);
  return { X, Y, T, total, view };
}
