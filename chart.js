/*
 * chart.js — 음고 곡선 그리기 (외부 라이브러리 없이 <canvas>)
 * ------------------------------------------------------------
 * x축: 시간(초)이지만 격자는 장단·박 구조로 그린다(굵은 세로선 = 장단 시작, 옅은 세로선 = 박).
 * y축: 본청 기준 cent (0 = 본청 가로선).
 * 곡선은 단색 한 줄. 시김새 감지 구간만 옅은 음영. 점수·등급 표현 없음.
 * o.lyrics 를 주면 가사 글자를 가락선 바로 위에 얹는다(lyrics.js 의 drawLyricGlyphs).
 */
function drawPitchChart(canvas, o) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  // 가사 글자를 가락선 위에 얹을 때는 맨 위 곡선 위에도 글자가 들어갈 자리를 둔다.
  // 글자가 없는 옆 그래프는 reserveTop 으로 같은 여백을 두어 두 그래프의 세로 눈금을 맞춘다.
  const lyr = (o.lyrics && o.lyrics.glyphs && o.lyrics.glyphs.length) ? o.lyrics : null;
  const lyrSize = lyr ? (lyr.size || 15) : 0;
  const m = { l: 62, r: 14, t: lyr ? lyricTopPad(lyrSize) : Math.max(12, o.reserveTop || 0), b: 34 };
  const pw = W - m.l - m.r, ph = H - m.t - m.b;
  const tm = o.timing;
  const t0 = o.xRange ? o.xRange[0] : 0;
  const t1 = o.xRange ? o.xRange[1] : tm.total_seconds;
  const yMin = o.yMin, yMax = o.yMax;
  const toX = t => m.l + (t - t0) / (t1 - t0) * pw;
  const toY = c => m.t + (yMax - c) / (yMax - yMin) * ph;

  // 음영(시김새 구간)
  if (o.shadeSegments) {
    ctx.fillStyle = o.shadeColor || "rgba(230,200,120,0.28)";
    for (const s of o.shadeSegments) {
      const a = Math.max(t0, s.start_sobak * tm.sobak_seconds), b = Math.min(t1, s.end_sobak * tm.sobak_seconds);
      if (b <= a) continue;
      ctx.fillRect(toX(a), m.t, toX(b) - toX(a), ph);
      if (o.highlight === s) { ctx.strokeStyle = "#C9A24A"; ctx.lineWidth = 2; ctx.strokeRect(toX(a), m.t + 1, toX(b) - toX(a), ph - 2); }
    }
  }

  // 가로 격자 + y 라벨
  ctx.font = "13px system-ui, sans-serif"; ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const yTick = o.yTick || 300;
  // 그래프가 낮으면(작은 노트북의 녹음 화면) 숫자가 서로 겹친다. 그럴 때는 한 칸씩 걸러 적는다.
  // 가로선은 모두 긋고, '본청'은 늘 적는다.
  const every = Math.max(1, Math.ceil(15 / (ph * yTick / (yMax - yMin))));
  for (let c = Math.ceil(yMin / yTick) * yTick; c <= yMax; c += yTick) {
    const y = toY(c);
    ctx.strokeStyle = c === 0 ? "#8A8478" : "#E6E0D3"; ctx.lineWidth = c === 0 ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
    if (c !== 0 && Math.round(c / yTick) % every !== 0) continue;
    ctx.fillStyle = "#7A746A"; ctx.fillText(c === 0 ? "본청" : String(c), m.l - 8, y);
  }
  if (o.yLabelsFine) {   // 돋보기: 촘촘한 눈금
    ctx.strokeStyle = "#EFEAE0"; ctx.lineWidth = 1;
    for (let c = Math.ceil(yMin / o.yLabelsFine) * o.yLabelsFine; c <= yMax; c += o.yLabelsFine) {
      const y = toY(c); ctx.beginPath(); ctx.moveTo(m.l, y); ctx.lineTo(W - m.r, y); ctx.stroke();
      ctx.fillStyle = "#A39C8E"; ctx.fillText(c === 0 ? "본청" : String(Math.round(c)), m.l - 8, y);
    }
  }

  // 세로 격자: 박(옅게) / 장단 시작(굵게) / 소박(돋보기에서만)
  const bakS = tm.sobak_seconds * tm.sobak_per_bak;
  const jangdanS = tm.sobak_seconds * tm.sobak_per_jangdan;
  ctx.textAlign = "center"; ctx.textBaseline = "top";
  if (o.showSobak) {
    ctx.strokeStyle = "#F0EBE1"; ctx.lineWidth = 1;
    for (let k = Math.ceil(t0 / tm.sobak_seconds); k * tm.sobak_seconds <= t1; k++) {
      const x = toX(k * tm.sobak_seconds); ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    }
  }
  for (let k = Math.ceil(t0 / bakS - 1e-6); k * bakS <= t1 + 1e-6; k++) {
    const t = k * bakS, x = toX(t);
    const isJangdan = Math.abs((t / jangdanS) - Math.round(t / jangdanS)) < 1e-6;
    ctx.strokeStyle = isJangdan ? "#8A8478" : "#D9D2C4"; ctx.lineWidth = isJangdan ? 2.5 : 1;
    ctx.beginPath(); ctx.moveTo(x, m.t); ctx.lineTo(x, m.t + ph); ctx.stroke();
    if (isJangdan && Math.round(t / jangdanS) < tm.n_jangdan) {
      ctx.fillStyle = "#7A746A";
      ctx.fillText(`${Math.round(t / jangdanS) + 1}장단`, x + (o.xRange ? 0 : pw / tm.n_jangdan / 2), m.t + ph + 8);
    } else if (o.xRange && !isJangdan) {
      const jd = Math.floor(t / jangdanS), bk = Math.round((t - jd * jangdanS) / bakS);
      ctx.fillStyle = "#A39C8E"; ctx.fillText(`${jd + 1}장단 ${bk + 1}박`, x, m.t + ph + 8);
    }
  }

  // 곡선들
  const series = [{ curve: o.curve, color: o.color, width: o.lineWidth || 2.6 }].concat(o.overlay || []);
  const bridgeS = (o.bridgeGapMs || 0) / 1000;
  // 가사 글자가 있으면 곡선을 그림 칸 위 끝에서 자른다. 돋보기처럼 세로 범위를 좁게 잡은 그래프에서
  // 범위 위로 나간 선이 글자 줄까지 올라와 글자를 지나가지 않게 한다(아래로 나간 선은 그대로).
  ctx.save();
  if (lyr) { ctx.beginPath(); ctx.rect(0, m.t - 1, W, H); ctx.clip(); }
  for (const s of series) {
    if (!s.curve) continue;
    ctx.strokeStyle = s.color; ctx.lineWidth = s.width || 2.6; ctx.lineJoin = "round"; ctx.lineCap = "round";
    ctx.beginPath();
    const hopS = hopSeconds(s.curve);
    let prevT = null;
    for (const p of s.curve) {
      if (p.t < t0 || p.t > t1) continue;
      if (o.revealUntil !== undefined && p.t > o.revealUntil) break;
      // 음고를 재지 못한 프레임. 이을지 말지는 다음 유효 프레임에서 틈의 길이로 정한다.
      if (p.cents === null || p.cents === undefined) continue;
      // 화면 밖으로 나간 값은 '잰 값'이다. 가로질러 이으면 그 움직임을 감추게 되므로 끊는다.
      if (p.cents < yMin - 50 || p.cents > yMax + 50) { prevT = null; continue; }
      const x = toX(p.t), y = toY(p.cents);
      if (canBridge(prevT, p.t, hopS, bridgeS)) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      prevT = p.t;
    }
    ctx.stroke();
  }
  ctx.restore();

  // 가락선 위 글자 (lyrics.js). 곡선을 다 그린 뒤에 얹어야 선에 가려지지 않는다.
  const toT = px => t0 + (px - m.l) / pw * (t1 - t0);
  if (lyr) drawLyricGlyphs(ctx, lyr.glyphs, {
    X: toX, T: toT, Y: toY, curves: lyr.curves || [o.curve], yMin, yMax,
    xMin: m.l, xMax: W - m.r, top: 0, size: lyrSize, tNow: lyr.tNow, active: lyr.active,
    bridgeS: (o.bridgeGapMs || 0) / 1000,
    cut: [yMin - 50, yMax + 50],                          // 위 곡선 그리기와 같은 끊음 기준
    jangdanS,
  });

  // 클릭 판정용 정보 반환
  return { toT, plotLeft: m.l, plotRight: W - m.r };
}

/* ---------------- 짧은 틈 잇기 (표시 규칙) ----------------
 * 음고를 재지 못한 프레임은 데이터에서 null로 남는다(값을 지어내지 않는다는 원칙).
 * 다만 끊김의 대부분은 10~30ms짜리 한두 프레임이고, 이는 숨이 아니라 자음이나
 * 순간적인 신뢰도 저하다. 그래서 **그리는 단계에서만** config.VIZ.bridge_gap_ms 이하의
 * 틈을 선으로 잇는다. 그보다 긴 틈(대부분 가사 구절 경계의 실제 숨자리)은 그대로 끊는다.
 * 분석 결과(curve의 null, 시김새 판정, 비교 수치)는 전혀 바뀌지 않는다. */

/** 곡선의 프레임 간격(초). config.ANALYSIS.hop_ms 와 같지만 데이터에서 직접 읽는다. */
function hopSeconds(curve) {
  return (curve && curve.length > 1) ? (curve[1].t - curve[0].t) : 0.01;
}

/** 앞서 그린 점과 지금 점 사이의 빈 시간이 이어도 될 만큼 짧은가 */
function canBridge(prevT, t, hopS, bridgeS) {
  if (prevT === null) return false;
  return (t - prevT) - hopS <= bridgeS + 1e-9;
}
