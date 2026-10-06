/*
 * jangdan.js — 장구 장단 합성 재생기 (Web Audio API)
 * ------------------------------------------------------
 * 녹음된 장단 음원 파일이 없어도 브라우저 안에서 장구 소리를 합성해 정확한 템포로 재생한다.
 * 왜 합성인가: 연구 설계상 전문가·학생의 시간축을 '같은 템포의 장단 반주'로 고정해야 하므로
 * 템포를 config에서 정확히 통제할 수 있어야 한다. 파일 재생은 템포 변경·박 위치 계산이 어렵다.
 * 나중에 실제 장구 녹음 파일을 쓰고 싶으면 hit() 안의 합성 부분만 샘플 재생으로 바꾸면 된다.
 *
 * 타점 종류: deong(덩) kung(쿵) deok(덕) gideok(기덕) deoreoreo(더러러러)
 *
 * 꾸밈음(기덕 앞꾸밈)과 굴림(더러러러)은 절대 시간이 아니라 소박 길이에 비례해서 놓는다.
 * 그래야 곡마다 템포가 달라도(쾌지나칭칭나네 굿거리 ♩.=50, 금다래꿍 중중모리 ♩.=80)
 * 같은 장단으로 들린다. 반면 북편·채편의 울림(감쇠)은 가죽의 물리적 성질이라 절대 시간으로
 * 둔다 — 템포가 느려져도 장구가 더 오래 울지는 않는다(2026-09-14 연구자 결정).
 */

// 소박 길이에 대한 비율. ♩.=60(소박 1/3초)에서 종전 고정값과 똑같은 소리가 나도록 역산했다.
// → 세마치 곡과 금다래꿍의 장구 소리는 이 변경으로 달라지지 않는다.
const GIDEOK_GRACE_SOBAK = 0.27;                  // 앞꾸밈이 본채보다 앞서는 정도 (60에서 0.09초)
const DEOREOREO_SOBAK = [0, 0.21, 0.42, 0.63];    // 굴림 4타의 위치 (60에서 0·0.07·0.14·0.21초)
class Janggu {
  constructor(ctx) {
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    this.noiseBuf = this._makeNoise();
    this.scheduled = [];   // 예약된 노드들(정지용)
  }

  _makeNoise() {
    const len = this.ctx.sampleRate * 0.3;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 북편(궁편): 낮고 둥근 소리
  _kung(t, gain = 1.0) {
    const o = this.ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.18);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9 * gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.38);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.4);
    // 타격 노이즈
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const lp = this.ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 400;
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.5 * gain, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(lp).connect(ng).connect(this.master);
    n.start(t); n.stop(t + 0.08);
    this.scheduled.push(o, n);
  }

  // 채편: 높고 짧은 소리
  _deok(t, gain = 1.0) {
    const n = this.ctx.createBufferSource(); n.buffer = this.noiseBuf;
    const bp = this.ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 3200; bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.7 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t); n.stop(t + 0.1);
    const o = this.ctx.createOscillator(); o.type = "triangle"; o.frequency.value = 880;
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.25 * gain, t);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.06);
    this.scheduled.push(n, o);
  }

  /** 타점 하나를 t 에 예약한다. sobakS = 그 곡의 소박 길이(초) — 꾸밈음 간격의 기준. */
  hit(type, t, sobakS) {
    switch (type) {
      case "deong": this._kung(t); this._deok(t); break;
      case "kung": this._kung(t); break;
      case "deok": this._deok(t); break;
      case "gideok":
        this._deok(t - GIDEOK_GRACE_SOBAK * sobakS, 0.45); this._deok(t); break;
      case "deoreoreo":
        DEOREOREO_SOBAK.forEach((d, i) => this._deok(t + d * sobakS, 0.7 - i * 0.12));
        break;
    }
  }

  /**
   * 장단을 startTime(AudioContext 시각)부터 count번 반복 예약한다.
   * 반환: 끝나는 시각. jd = config.jangdan[...] 객체.
   */
  schedule(jd, startTime, count) {
    const sobakS = 60 / jd.bpm_bak / jd.sobak_per_bak;
    const jangdanS = sobakS * jd.bak * jd.sobak_per_bak;
    for (let r = 0; r < count; r++) {
      const base = startTime + r * jangdanS;
      for (const p of jd.pattern) this.hit(p.hit, base + p.sobak * sobakS, sobakS);
    }
    return startTime + count * jangdanS;
  }

  stop() {
    for (const n of this.scheduled) { try { n.stop(); } catch (e) { /* 이미 끝난 노드 */ } }
    this.scheduled = [];
  }
}

/* ---------------------------------------------------------------------------
 * 움직이는 정간보
 * config의 pattern(타점이 놓인 소박)으로 칸을 그리고, 소리에 맞춰 칸에 불을 켜고
 * 타점을 키운다. 그림 파일이 아니라 코드로 그리므로 장단을 바꾸면 자동으로 따라온다.
 * 기호는 정간보 관례: 덩 = 원+세로선, 쿵 = 원, 덕 = 세로선, 기덕 = 세로선+앞꾸밈, 더러러러 = 물결
 * ------------------------------------------------------------------------- */
const JANGGU_SYM = {
  deong: '<svg width="26" height="26"><circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/><line x1="13" y1="2" x2="13" y2="24" stroke="currentColor" stroke-width="1.6"/></svg>',
  kung:  '<svg width="26" height="26"><circle cx="13" cy="13" r="9" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  deok:  '<svg width="26" height="26"><line x1="13" y1="2" x2="13" y2="24" stroke="currentColor" stroke-width="1.8"/></svg>',
  gideok: '<svg width="26" height="26"><line x1="15" y1="2" x2="15" y2="24" stroke="currentColor" stroke-width="1.8"/><path d="M15 6 L8 2" stroke="currentColor" stroke-width="1.4" fill="none"/></svg>',
  deoreoreo: '<svg width="26" height="26"><path d="M3 13 q3.5 -6 7 0 t7 0 t6 0" stroke="currentColor" stroke-width="1.6" fill="none"/></svg>',
};
const JANGGU_GU = { deong: "덩", kung: "쿵", deok: "덕", gideok: "기덕", deoreoreo: "더러러러" };

/** 정간보 DOM을 코드로 그린다. 반환: {cells, playhead} — animateJeonggan 이 받는 view */
function buildJeonggan(el, jd) {
  el.className = "jeonggan";
  el.innerHTML = "";
  const cells = [];
  const hitAt = {};
  for (const p of jd.pattern) (hitAt[p.sobak] = hitAt[p.sobak] || []).push(p.hit);
  for (let b = 0; b < jd.bak; b++) {
    const bak = document.createElement("div");
    bak.className = "bak";
    for (let s = 0; s < jd.sobak_per_bak; s++) {
      const k = b * jd.sobak_per_bak + s;
      const c = document.createElement("div");
      c.className = "sobak";
      const hits = hitAt[k] || [];
      c.innerHTML = `<div class="sym">${hits.map(h => JANGGU_SYM[h] || "").join("")}</div>` +
                    `<div class="gu">${hits.map(h => JANGGU_GU[h] || "").join(" ")}</div>`;
      c.dataset.hit = hits.length ? "1" : "";
      bak.appendChild(c); cells.push(c);
    }
    el.appendChild(bak);
  }
  return { cells, playhead: null };   // 코드 정간보는 칸 강조만 쓰고 재생선은 두지 않는다
}

/* ---------------------------------------------------------------------------
 * 장단 그림 위에 재생 위치 겹치기
 * config 에 score_image + score_image_grid 가 있는 장단은 코드로 그리는 대신
 * 연구자가 준 정간보 그림을 띄우고, 그 격자 위에 투명한 소박 칸과 재생선을 겹친다.
 * 격자 좌표는 원본 픽셀이지만 여기서 %로 바꿔 쓰므로 그림이 줄어도 위치가 따라간다.
 * 칸 element 의 모양(class·dataset.hit)을 코드 정간보와 똑같이 맞췄기 때문에
 * animateJeonggan 은 두 방식을 구분하지 않고 그대로 움직인다.
 * ------------------------------------------------------------------------- */
function buildJangdanImage(el, jd) {
  const g = jd.score_image_grid;
  const pct = (v, whole) => (v / whole) * 100 + "%";
  el.className = "jangdan-img";
  el.innerHTML = "";

  const img = document.createElement("img");
  img.src = jd.score_image;
  img.alt = `${jd.name} 정간보`;
  el.appendChild(img);

  // 격자 상자에 정확히 포개지는 오버레이. 그림과 같은 흐름에 두면 크기가 함께 변한다.
  const ov = document.createElement("div");
  ov.className = "overlay";
  ov.style.left = pct(g.x0, g.width);
  ov.style.top = pct(g.y0, g.height);
  ov.style.width = pct(g.x1 - g.x0, g.width);
  ov.style.height = pct(g.y1 - g.y0, g.height);

  // 타점이 놓인 소박. 그림에 인쇄된 기호 위치가 아니라 실제로 소리가 나는 소박을 따른다
  // (굿거리는 그림의 더러러러 기호가 1소박 앞서 있다 — config.py 주석 참조).
  const hitAt = {};
  for (const p of jd.pattern) (hitAt[p.sobak] = hitAt[p.sobak] || []).push(p.hit);

  const cells = [];
  for (let k = 0; k < g.cells; k++) {
    const c = document.createElement("div");
    c.className = "cell";
    if (k % jd.sobak_per_bak === 0) c.classList.add("bak-start");
    c.dataset.hit = hitAt[k] ? "1" : "";
    ov.appendChild(c); cells.push(c);
  }

  const playhead = document.createElement("div");
  playhead.className = "playhead";
  ov.appendChild(playhead);

  el.appendChild(ov);
  return { cells, playhead };
}

/**
 * 장단 그림에서 오선보 부분만 잘라낸 띠를 만든다(staff_crop 이 있는 장단만).
 * 파생 이미지 파일을 따로 두지 않고 원본을 %로 오려 쓰므로, 그림을 교체해도
 * config 의 좌표만 다시 재면 된다. 소리와 무관한 정지 화면이다.
 */
function buildStaffStrip(jd) {
  const c = jd.staff_crop;
  const cw = c.x1 - c.x0, ch = c.y1 - c.y0;
  const wrap = document.createElement("div");
  wrap.className = "jangdan-staff";
  wrap.style.aspectRatio = `${cw} / ${ch}`;
  const img = document.createElement("img");
  img.src = jd.score_image;
  img.alt = `${jd.name} 오선보`;
  // 오려낸 창(wrap)을 기준으로 한 %라 창이 줄어들면 그림도 같은 비율로 따라 줄어든다.
  img.style.width = (c.width / cw) * 100 + "%";
  img.style.left = (-c.x0 / cw) * 100 + "%";
  img.style.top = (-c.y0 / ch) * 100 + "%";
  wrap.appendChild(img);
  return wrap;
}

/**
 * 장단 표시를 그린다. config.py 의 세 갈래를 그대로 따른다.
 *  ① 그림 + 격자  → 그림 위에 재생 위치를 겹친다(굿거리)
 *  ② 그림 + 오선보 오려내기 → 오선보 띠를 얹고 그 아래에 코드 정간보(세마치)
 *  ③ 그 외 → 코드 정간보만
 * ②에서도 정간보는 buildJeonggan 이 그대로 그리므로 움직임과 타이밍이 달라지지 않는다.
 */
function buildJangdanView(el, jd) {
  if (jd.score_image && jd.score_image_grid) return buildJangdanImage(el, jd);
  if (jd.score_image && jd.staff_crop) {
    el.className = "jangdan-stack";
    el.innerHTML = "";
    el.appendChild(buildStaffStrip(jd));
    const inner = document.createElement("div");   // 정간보는 제 클래스를 스스로 붙인다
    el.appendChild(inner);
    return buildJeonggan(inner, jd);
  }
  return buildJeonggan(el, jd);
}

/**
 * 재생 시각(오디오 시계)에 맞춰 장단 표시를 움직인다. stop()을 돌려준다.
 * view = buildJangdanView()가 돌려준 {cells, playhead}.
 *  - cells    : 소박이 바뀔 때만 강조를 옮긴다(칸 단위라 매 프레임 고칠 이유가 없다).
 *  - playhead : 있으면 매 프레임 장단 안의 진행 비율로 미끄러진다(그림 방식에서만).
 * 시각을 오디오 시계(ctx.currentTime)에서 바로 읽으므로 소리와 어긋나지 않는다.
 * mapT(지난 초) → 장단 격자 위 초. 주지 않으면 그대로 흐른다. 구간 반복처럼 같은 자리를
 * 되풀이할 때 '지금 격자의 어디인가'를 알려 주는 데 쓴다.
 */
function animateJeonggan(view, ctx, startTime, jd, endTime, mapT) {
  const { cells, playhead } = view;
  const sobakS = 60 / jd.bpm_bak / jd.sobak_per_bak;
  const nSobak = jd.bak * jd.sobak_per_bak;
  const jangdanS = sobakS * nSobak;
  let raf = null, last = -1;
  const tick = () => {
    const now = ctx.currentTime;
    if (endTime && now > endTime) { clear(); return; }
    if (now >= startTime) {
      const elapsed = mapT ? mapT(now - startTime) : now - startTime;
      const k = Math.floor(elapsed / sobakS) % nSobak;
      if (k !== last) {
        last = k;
        cells.forEach((c, i) => {
          c.classList.toggle("on", i === k);
          if (i === k && c.dataset.hit) {
            c.classList.add("hit");
            setTimeout(() => c.classList.remove("hit"), Math.min(220, sobakS * 900));
          }
        });
      }
      if (playhead) {
        playhead.style.left = ((elapsed % jangdanS) / jangdanS) * 100 + "%";
        playhead.classList.add("on");
      }
    }
    raf = requestAnimationFrame(tick);
  };
  const clear = () => {
    if (raf) cancelAnimationFrame(raf);
    raf = null;
    cells.forEach(c => c.classList.remove("on", "hit"));
    if (playhead) { playhead.classList.remove("on"); playhead.style.left = "0%"; }
  };
  tick();
  return clear;
}

/** 장단 시간 계산 도우미 */
function jangdanTiming(jd) {
  const sobakS = 60 / jd.bpm_bak / jd.sobak_per_bak;
  const sobakPerJangdan = jd.bak * jd.sobak_per_bak;
  return { sobakS, bakS: sobakS * jd.sobak_per_bak, sobakPerJangdan, jangdanS: sobakS * sobakPerJangdan };
}
