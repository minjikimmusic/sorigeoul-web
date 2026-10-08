/*
 * app.js — 소리거울 클라이언트 흐름
 * ----------------------------------
 * ① 곡 선택 → ② 노래할 준비하기(악보·곡 소개·장단 듣기) → ③ 한 장단 주고받기(녹음) → ④ 결과
 *
 * 규칙(연구방법 확정 사항):
 *  - 학생 곡선은 녹음 중 절대 표시하지 않는다. 주고받기가 끝난 뒤 한 번에 분석해 결과를 받는다.
 *  - 녹음은 AudioWorklet으로 원시 PCM을 받아 무손실 WAV로 만든다(recorder.js). MediaRecorder를 쓰지 않는다:
 *    손실 압축·컨테이너 패딩·알 수 없는 시작 지연이 전부 장단 격자를 밀기 때문이다.
 *  - 시간축은 장단 반주(합성 장구, config 템포)로 사전에 고정한다. 사후 정렬(DTW) 없음.
 *  - 그 전의 "브라우저에서 음고 분석 금지"는 연구자 결정(2026-10-06)으로 풀었다.
 *    음고와 판정은 웹페이지 안 분석 일꾼(analyzer.js)이 서버와 같은 파이썬 코드로 한다. 녹음은 밖으로 보내지 않는다.
 *  - 점수·정오 판정 UI 없음. 두 곡선의 병치와 규칙 기반 안내 문장만.
 */
const $ = id => document.getElementById(id);

/* 곡 카드의 가락 조각. tools/gen_f0_contour.py 가 표식 사이를 갈아 끼운다 — 손으로 고치지 말 것. */
const CARD_CONTOUR = {/* f0:start */
  BOX: "2.0 2.9 196.0 46.3",
  arirang: "M4.0 30.2L6.3 30.2 8.5 30.6 10.8 30.8 13.0 30.5 15.3 30.0 17.6 29.4 19.8 29.1 22.1 28.8 24.4 28.8 26.6 29.1 28.9 29.8 31.1 30.4 33.4 30.0 35.7 28.9 37.9 29.0 40.2 29.5 40.2 30.0 42.6 29.7 44.9 28.7 47.3 27.3 49.6 25.3 52.0 23.1 54.4 20.2 56.7 17.7 59.1 15.5 61.4 13.7 63.8 12.8 63.8 12.9 66.1 12.9 68.3 13.1 70.6 13.3 72.9 13.2 75.2 13.1 77.4 12.9 79.7 12.4 82.0 12.4 84.3 11.9 86.5 11.6 88.8 11.9 91.1 12.6 93.4 13.5 95.6 13.9 97.9 12.9 100.2 11.7 102.4 11.8 104.7 12.4 104.7 12.8 107.0 12.9 109.3 13.6 111.5 14.8 113.8 16.3 116.1 17.8 118.4 19.5 120.6 20.6 122.9 21.4 125.2 22.0 125.2 21.9 127.5 22.2 129.8 22.6 132.1 22.4 134.4 22.2 136.7 21.7 139.0 21.3 141.3 20.9 143.6 21.2 145.9 22.2 148.2 23.1 150.5 22.0 152.8 21.5 155.1 22.0 155.1 22.3 157.6 22.1 160.0 20.3 162.5 18.1 165.0 15.5 167.4 12.8 169.9 10.5 172.4 9.1 172.4 9.1 174.8 9.2 177.1 9.3 179.5 9.2 181.8 8.6 184.2 8.2 186.6 8.2 188.9 9.5 191.3 9.7 193.6 8.0 196.0 8.8",
  jindo: "M4.0 36.2L6.3 36.8 8.5 38.4 10.8 38.8 13.1 37.9 15.3 36.1 17.6 34.0 19.9 31.7 22.1 28.5 24.4 26.8 26.7 31.1 28.9 40.6 31.2 44.3 33.5 35.7 35.7 27.2 38.0 27.5 40.3 30.6 42.5 32.0 44.8 30.8 47.1 28.7 49.3 27.6 51.6 27.5 53.9 29.3 56.1 36.4 58.4 45.2 60.7 35.6 62.9 28.1 65.2 42.3 67.5 41.1 69.7 35.8 69.7 36.3 72.0 36.1 74.2 35.0 76.5 32.4 78.7 29.4 81.0 25.8 83.2 22.1 85.5 18.9 87.7 15.9 90.0 13.7 92.2 12.6 92.2 12.6 94.4 13.0 96.7 13.5 98.9 13.3 101.1 12.9 103.3 12.3 105.6 11.8 107.8 11.0 110.0 10.8 112.2 11.7 114.5 13.5 116.7 13.8 118.9 11.9 121.1 10.8 123.4 11.5 123.4 12.1 125.8 13.3 128.2 18.3 130.6 25.0 133.0 31.2 135.5 34.2 135.5 34.4 137.7 35.1 139.9 36.5 142.2 36.8 144.4 36.2 146.7 34.9 148.9 33.4 151.2 31.2 153.4 28.5 155.6 26.9 157.9 28.0 160.1 33.8 162.4 40.6 164.6 40.0 166.9 32.0 169.1 26.6 171.3 27.5 173.6 29.9 175.8 30.8 178.1 30.0 180.3 28.1 182.5 26.9 184.8 26.6 187.0 27.6 189.3 31.7 191.5 39.6 193.8 37.4 196.0 30.5",
  kwaejina: "M4.0 7.9L6.3 8.1 8.5 8.4 10.8 8.3 13.0 8.0 15.3 7.6 17.6 7.4 19.8 7.2 22.1 7.2 24.4 8.1 26.6 9.0 28.9 7.7 31.1 6.9 33.4 7.5 33.4 8.1 35.7 8.4 38.0 10.5 40.3 13.3 42.6 16.2 44.9 18.9 47.2 20.2 47.2 20.0 49.6 20.1 52.0 20.6 54.3 20.5 56.7 19.9 59.0 19.3 61.4 19.0 63.8 19.6 66.1 21.2 68.5 20.8 70.8 19.3 73.2 19.8 73.2 20.4 75.5 21.0 77.8 22.8 80.1 25.8 82.4 28.9 84.7 31.5 87.0 32.8 87.0 32.7 89.3 32.8 91.6 33.1 93.8 33.3 96.1 33.1 98.3 32.8 100.6 32.4 102.9 32.1 105.1 32.3 107.4 33.4 109.6 34.4 111.9 33.3 114.2 32.0 116.4 32.6M128.5 11.1L130.8 11.4 133.0 11.6 135.3 11.4 137.5 11.1 139.8 10.7 142.0 10.6 144.3 11.8 146.5 12.2 148.8 10.5 151.0 11.1 151.0 11.6 153.5 12.0 156.0 14.1 158.4 16.9 160.9 20.4 163.4 24.1 165.9 26.8 168.3 28.2 168.3 28.2 170.6 28.6 172.9 28.9 175.2 28.7 177.5 27.9 179.9 27.3 182.2 26.9 184.5 26.8 186.8 28.0 189.1 29.8 191.4 28.4 193.7 26.9 196.0 27.7",
  geumdaraekkung: "M4.0 16.0L6.3 16.3 8.5 15.9 10.8 15.3 13.0 17.3 15.3 14.9 17.5 14.5 19.8 14.1 22.1 15.7 24.3 17.9 26.6 16.9 28.8 16.5 31.1 18.6 33.3 12.0 35.6 20.0 37.8 15.2 40.1 20.1 42.4 14.3 44.6 11.8 46.9 18.4 49.1 18.6 51.4 18.8 53.6 17.5 55.9 17.7 58.2 15.2 60.4 11.5 62.7 11.5 64.9 20.3 67.2 18.5 69.4 11.8 71.7 18.1 74.0 13.9 76.2 17.3 78.5 19.8 80.7 19.5 83.0 19.7 85.2 13.8 87.5 14.1 89.7 16.5 89.7 15.7 92.0 16.0 94.2 17.0 96.4 18.3 98.6 20.0 100.8 22.5 103.0 24.8 105.2 27.1 107.4 29.3 109.6 31.2 111.8 32.8 114.0 33.5 114.0 33.5 116.2 33.8 118.4 33.4 120.6 33.1 122.8 33.1 125.1 33.1 127.3 31.8 129.5 35.4 131.7 35.6 133.9 32.8 136.1 35.7 138.4 37.5 140.6 32.8 142.8 37.6 145.0 34.3 147.2 37.1 149.4 31.1 151.7 31.8 153.9 33.2 156.1 36.1 158.3 36.6 160.5 32.4 162.7 33.3 165.0 33.6 167.2 38.4 169.4 38.2 171.6 38.4 173.8 30.8 176.0 37.9 178.3 30.5 180.5 34.0 182.7 32.8 184.9 37.9 187.1 37.9 189.3 30.6 191.6 37.4 193.8 36.7 196.0 32.9",
/* f0:end */};
/* 화면은 분석 서버를 쓰지 않는다(2026-10-06부터). 설정·선생님 곡선·예시 결과는 tools/build_site.py가 site/data/에
   파일로 구워 둔다(서버 server/main.py의 get_config·get_expert·get_student와 같은 내용). 주소의 ?v=는 고친 뒤 옛 사본을 피한다. */
const dataUrl = p => `data/${p}?v=${encodeURIComponent(window.__V || "")}`;

const state = {
  cfg: null, songId: null, song: null, jd: null, tm: null,
  expert: null,          // 선생님 결과(data/expert/{곡}.json)
  audioCtx: null, janggu: null,
  introLoop: null,       // 장단 듣기 — 합성음 반복 예약 타이머
  bufs: {}, playing: [], mute: {},   // 디코딩해 둔 음원, 재생 중인 노드, 파트별 음소거
  mirror: null,          // 소리거울 재생 상태 {t0, end, raf}
  jangdanBuf: null,      // 녹음 장단(있는 장단만). 없으면 합성 장구로 대체
  expertBuf: null,       // 선생님(전문가) 가창 (곡의 주고받기 장단 수만큼)
  studentBuf: null,      // 학습자 예시 가창 (미리 녹음한 것, 같은 길이)
  expertFullBuf: null,   // '선생님 노래 듣기'용 전체 녹음
  studentData: null,     // 미리 분석해 둔 학습자 가창 (있으면 '비교 보기' 모드: 녹음하지 않음)
  jeonggan: null, jeongganStop: null,
  jangdanOn: false,      // 장단 듣기 재생 중 여부
  introAudio: null, hasExpertAudio: false, hasIntroAudio: false,
  stream: null, mic: null,
  singing: false,
  analyzingTimer: null,  // 분석 기다리는 동안 초를 올리는 타이머        // 주고받기가 돌고 있는가 (겹쳐 시작하는 것을 막는다)
  held: null,            // 결과가 나올 때까지 들고 있는 방금 부른 녹음 {blob, timing, …} — '다시 분석하기'가 쓴다
  opening: null,         // 지금 여는 곡(곡 음원을 받는 중). 그동안 누른 카드는 무시한다
  myBuf: null,           // 방금 내가 부른 소리 (거울 재생용)
  studentGain: 1,        // 내 소리를 선생님 소리 크기에 맞추려고 곱한 배수 (재생 전용)
  studentVol: 1,         // 거울 하단 슬라이더로 사람이 더 조절한 배수
  compareMode: false,    // true = 미리 녹음해 둔 학습자 가창 비교 보기(마이크를 쓰지 않는다)
  timeline: null, raf: null, result: null,
  mirrorView: { mode: "all", k: 0, lastT: null },   // 소리거울 확대 범위(박 기준 확대)
};

/* ---------------- 공통 ---------------- */
function show(id) {
  for (const s of document.querySelectorAll(".screen")) s.hidden = true;
  $(id).hidden = false;
  $("btn-speaker").hidden = (id !== "screen-intro");
  // 곡을 고르기 전에는 돌아갈 곳이 없다. 그 화면에서만 숨긴다.
  $("btn-back").hidden = (id === "screen-select");
  window.scrollTo(0, 0);
}
function ensureAudio() {
  if (!state.audioCtx) {
    state.audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    state.janggu = new Janggu(state.audioCtx);
  }
  if (state.audioCtx.state === "suspended") state.audioCtx.resume();
  return state.audioCtx;
}
/** 음원 슬라이스가 정박보다 앞서 시작하는 길이(초) */
function preroll() {
  const r = state.song && state.song.reference;
  return (r && r.audio_preroll_s) || 0;
}
/** 잘라 쓴 구간의 첫 소박이 곡 전체에서 몇 번째 소박인가 (가사 위치 계산용) */
function sliceSobakBase() {
  const r = state.song && state.song.reference;
  return r && r.use_jangdan ? (r.use_jangdan[0] - 1) * state.tm.sobak_per_jangdan : 0;
}
// 부른 사람의 실명(선생님·학습자)은 화면에 쓰지 않는다(2026-10-05 연구자 요청).
// config 의 reference.expert_csv / student_csv 는 자료 출처 기록일 뿐이다.
/** '내 소리' 자리에 쓸 이름. 비교 보기에서는 '학습자 소리'. */
function meLabelText() {
  return state.compareMode ? "학습자 소리" : "내 소리";   // 학습자 실명은 화면에 쓰지 않는다(2026-10-05 연구자 요청)
}

function hasLyrics() { return !!(state.song && state.song.lyric_lines && state.song.lyric_lines.length); }
/** 비교 구간(그래프 시간축) 위의 가사 글자. 녹음 화면 그래프와 거울이 같은 목록을 쓴다. */
function songGlyphs() {
  if (!state.song || !state.tm) return [];
  return lyricGlyphs(state.song, sliceSobakBase(), state.tm.sobak_seconds, state.tm.total_seconds);
}
/** 이 곡에서 주고받을 장단 수 = 선생님 n장단 + 학생 n장단.
 *  서버의 config.jangdan_count()가 정해 내려 준다(모든 곡 공통 기본 4장단).
 *  여기서 다시 세지 않는다 — 기준이 두 곳이 되면 곡선·음원·쌍의 수가 어긋난다. */
function nPairs() {
  return (state.song && state.song.jangdan_count) || 1;
}

function yRange() {   // 곡별 y축 범위(없으면 기본값)
  const v = state.cfg.viz, r = state.song.y_range_cents;
  return r ? { yMin: r[0], yMax: r[1] } : { yMin: v.y_min_cents, yMax: v.y_max_cents };
}
async function exists(url) {
  try { const r = await fetch(url, { method: "HEAD" }); return r.ok; } catch (e) { return false; }
}

/* 음원은 <audio> 태그가 아니라 AudioBuffer로 다룬다.
   이유: 장단 격자에 맞춰 ms 단위로 정확히 시작·반복시켜야 하는데, <audio>는 재생 시작 지연과
   반복 사이 빈틈이 있어 시간축이 어긋난다. AudioBuffer는 오디오 시계로 예약할 수 있다. */
async function loadBuf(url) {
  if (!url) return null;
  if (url in state.bufs) return state.bufs[url];
  const ctx = ensureAudio();
  try {
    const r = await fetch(url);
    if (!r.ok) throw new Error(r.status);
    state.bufs[url] = await ctx.decodeAudioData(await r.arrayBuffer());
  } catch (e) { state.bufs[url] = null; }
  return state.bufs[url];
}
/* ---------------- 재생 음량 ----------------
 * 아동의 소리는 노트북 마이크로 받으면 선생님 음원보다 10~25배 작다. 같은 크기로 틀면
 * 묻혀서 비교가 되지 않으므로, 유성부 RMS를 재어 선생님 소리 크기에 맞춘다.
 * **재생 음량만 바꾼다.** 서버에 보낸 WAV와 음고 분석 결과는 그대로다(재생 음량은 분석과 무관). */

/** 재생 음량 설정. 서버가 낡아 playback 항목이 없어도 화면이 죽지 않게 기본값을 준다.
    (음량은 부가 기능이므로, 없으면 조용히 '키우지 않음'으로 동작해야 한다) */
function playbackCfg() {
  return (state.cfg && state.cfg.playback) ||
    { match_student_level: false, level_floor: 1e-3, target_rms: 0.268,
      student_gain_max: 1, student_gain_min: 1 };
}

/** 버퍼의 유성부 RMS와 피크. 무음 구간은 빼고 재야 실제로 부른 소리의 크기가 나온다. */
function bufferLevel(buf, floor) {
  if (!buf) return null;
  const d = buf.getChannelData(0);
  const step = Math.max(1, Math.floor(d.length / 200000));   // 긴 버퍼는 표본만 훑는다
  let sum = 0, n = 0, peak = 0;
  for (let i = 0; i < d.length; i += step) {
    const v = Math.abs(d[i]);
    if (v > peak) peak = v;
    if (v > floor) { sum += v * v; n++; }
  }
  return { rms: n ? Math.sqrt(sum / n) : 0, peak, voicedRatio: n / Math.ceil(d.length / step) };
}

/** 학습자 버퍼를 선생님 소리 크기에 맞추는 배수. 선생님 음원이 없는 곡은 config의 목표값을 쓴다. */
function computeStudentGain(buf) {
  const P = playbackCfg();
  if (!P.match_student_level) return 1;
  const me = bufferLevel(buf, P.level_floor);
  if (!me || me.rms <= 0) return 1;
  const exp = bufferLevel(state.expertBuf, P.level_floor);
  const target = (exp && exp.rms > 0) ? exp.rms : P.target_rms;
  return Math.min(P.student_gain_max, Math.max(P.student_gain_min, target / me.rms));
}

/** 트랙별 최종 음량. 음소거가 우선하고, 학생 트랙만 자동 배수 × 수동 배수를 곱한다. */
function trackGain(tag) {
  if (tag && state.mute[tag]) return 0;
  if (tag === "student") return (state.studentGain || 1) * (state.studentVol === undefined ? 1 : state.studentVol);
  return 1;
}

/** 재생 중인 소리에 지금의 음량을 다시 입힌다 (체크박스·슬라이더를 만졌을 때) */
function refreshGains() {
  for (const s of state.playing) if (s._gain) s._gain.gain.value = trackGain(s._tag);
}

function playBuf(buf, when, offset, dur, loop, tag) {
  if (!buf) return null;
  const ctx = ensureAudio();
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = !!loop;
  const g = ctx.createGain();
  g.gain.value = trackGain(tag);
  s.connect(g).connect(ctx.destination);
  if (loop) { s.start(when); if (dur) s.stop(when + dur); }
  else s.start(when, offset || 0, dur);
  s._gain = g; s._tag = tag;
  state.playing.push(s);
  return s;
}
/** 재생 중에 파트별로 소리를 켜고 끈다 (거울 화면의 체크박스) */
function setMute(tag, off) {
  state.mute[tag] = off;
  refreshGains();
}
function stopBufs() {
  for (const s of state.playing) { try { s.stop(); } catch (e) { /* 이미 끝남 */ } }
  state.playing = [];
}

/* ---------------- 분석 도구 준비 상태 (pesto-onnx) ----------------
 * 분석 도구(약 30MB)를 받는 동안·실패했을 때 무엇을 보여 줄지. 준비 화면 아래 한 줄과, 노래가 끝난 뒤 기다리는
 * 원 아래 한 줄이 같은 상태(Analyzer.status)를 쓴다. 기술 문장(오류 원문)은 화면에 쓰지 않고 콘솔에만 남긴다. */
function startAnalyzer() {
  Analyzer.prepare().catch(e => console.warn("[소리거울] 분석 도구 준비 실패:", e.kind || "", e.message));
}
/** 이 주소에서 마이크를 열 수 있는가. 브라우저는 https 주소나 localhost에서만 마이크를 준다(http 학교 서버 등은 안 됨). */
function micAvailable() {
  return !!(window.isSecureContext && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}
const MIC_BLOCKED = "이 주소(http)에서는 브라우저가 마이크를 막아요. https 주소로 열어 주세요.";
const mb = n => (n / 1e6).toFixed(n >= 1e7 ? 0 : 1);
function progressText(s) {
  return s.total ? ` · ${mb(s.loaded || 0)}/${mb(s.total)}MB` : "";
}
/** 분석 도구 준비 실패를 알리는 한 문장. where: "intro"(노래 전) 또는 "sing"(노래가 끝난 뒤). */
function analyzerFailText(kind, where) {
  if (kind === "device") {
    return "이 기기(브라우저)에서는 소리 분석을 할 수 없어요. 크롬 최신판이나 iPadOS 16.4 이상의 iPad에서 열어 주세요." +
      (where === "intro" ? " ‘예시 비교 보기’는 그대로 쓸 수 있어요." : "");
  }
  // 404·403: 사이트에 파일이 없거나, 학교망이 그 파일을 막는다. 다시 해도 같다.
  if (kind === "missing") return "소리 분석 도구 파일을 받을 수 없어요(사이트에 없거나 이 인터넷망에서 막혀 있어요). 사이트를 올린 분께 알려 주세요.";
  return where === "intro"
    ? "소리 분석 도구를 받지 못했어요. 인터넷 연결을 확인해 주세요. 노래를 시작하면 다시 받아 볼게요."
    : "분석 도구를 받지 못했어요. 인터넷 연결을 확인한 뒤 ‘다시 분석하기’를 눌러 주세요. 방금 부른 노래는 그대로 있어요.";
}
/** 노래가 끝난 뒤 기다리는 원 아래의 한 줄 */
function analyzingHint(s = Analyzer.status) {
  if (Analyzer.ready) return "음고 분석 중…";
  const unstable = s.again || !!s.retry;
  if (s.phase === "loading" && s.step === "download") {
    return unstable ? `인터넷이 불안정해 분석 도구를 다시 받는 중${progressText(s)} · 방금 부른 노래는 그대로 있어요`
                    : `분석 도구를 받는 중${progressText(s)} (처음 한 번만)`;
  }
  if (s.phase === "waiting") return `인터넷이 불안정해요. ${Math.round(s.waitMs / 1000)}초 뒤에 분석 도구를 다시 받아 볼게요`;
  return "분석 도구를 준비하는 중…";
}
/** 준비 화면 아래 한 줄과 '노래할 준비가 됐어요' 단추. 이 기기로는 부를 수 없으면(마이크를 못 엶·분석 도구를 못 돌림)
 *  노래하기 전에 알리고 단추를 막는다 — 다 부른 뒤에야 알리면 아이의 노래가 버려진다. 예시 비교 보기는 그대로 둔다. */
function showAnalyzerStatus(s = Analyzer.status) {
  let text = null, warn = false;
  const stuck = s.phase === "failed" && (s.kind === "device" || s.kind === "missing");   // 다시 해도 같은 실패
  if (!micAvailable()) { text = MIC_BLOCKED + " ‘예시 비교 보기’는 그대로 쓸 수 있어요."; warn = true; }
  else if (s.phase === "loading") {
    const unstable = s.again || !!s.retry;
    text = s.step === "download"
      ? (unstable ? `인터넷 연결이 불안정해 소리 분석 도구를 다시 받고 있어요${progressText(s)}`
                  : `소리 분석 도구를 받고 있어요${progressText(s)} (처음 한 번만 — 노래하는 동안에도 계속 받아요)`)
      : "소리 분석 도구를 준비하고 있어요…";
  } else if (s.phase === "waiting") {
    text = `인터넷 연결이 불안정해 ${Math.round(s.waitMs / 1000)}초 뒤에 소리 분석 도구를 다시 받아 볼게요.`;
    warn = true;
  } else if (s.phase === "failed") {
    text = analyzerFailText(s.kind, "intro");
    warn = true;
  }
  const el = $("intro-analyzer-note");
  el.hidden = !text;
  el.textContent = text || "";
  el.classList.toggle("warn", warn);
  $("btn-start-sing").disabled = stuck || !micAvailable();
  if (!$("sing-analyzing").hidden) $("sing-analyzing-hint").textContent = analyzingHint(s);
}

/* ---------------- ① 곡 선택 ---------------- */
async function init() {
  state.cfg = await (await fetch(dataUrl("config.json"))).json();
  // 분석 도구(웹페이지 안 파이썬·PESTO, 약 30MB)는 여기서 받지 않는다. 곡을 열어 그 곡의 음원을 다 받은 뒤에 받기
  // 시작한다(openIntro → startAnalyzer). 첫 화면에서 바로 받으면 느린 교실망에서 곡 음원과 회선을 나눠 써서, 곡 카드를
  // 누른 뒤 준비 화면까지 약 4배 오래 걸렸다(2026-10-06 검토). 준비 화면을 보고 노래하는 동안 대부분 다 받는다.
  Analyzer.onStatus(showAnalyzerStatus);
  $("dummy-note").hidden = !state.cfg.dummy_mode;
  const grid = $("song-grid"); grid.innerHTML = "";
  let n = 0;
  for (const id of state.cfg.song_order) {
    const s = state.cfg.songs[id], jd = s.jangdan_resolved;
    const b = document.createElement("button");
    b.className = "song-card";
    b.dataset.song = id;            // 카드별 지역 표시·가락선 강조를 CSS에서 붙이기 위한 표식
    b.style.setProperty("--i", n++);   // 카드마다 조금씩 늦게 떠오르게
    // 가락 조각 = 그 곡의 서명. 토리의 성격(떠는소리·꺾는소리·흘러내림·잔떨림)이 선에 들어 있다.
    b.innerHTML =
      `<span class="sc-no">${String(n).padStart(2, "0")}</span>` +
      `<svg class="sc-sig" viewBox="${CARD_CONTOUR.BOX}"` +
        ` preserveAspectRatio="none" fill="none" aria-hidden="true" focusable="false">` +
        `<path pathLength="1" d="${CARD_CONTOUR[id] || ""}" />` +
      `</svg>` +
      `<b>${s.name}</b>` +
      `<span class="sc-tori">${s.tori_name}</span>` +
      `<span class="sc-meta"><i>${s.region}</i><i>${jd.name}</i></span>`;
    b.onclick = () => openIntro(id);
    grid.appendChild(b);
  }
  show("screen-select");
}

/* ---------------- ② 노래할 준비하기 ---------------- */
/** 곡 카드를 누르면 그 곡을 연다. 곡 음원을 받는 동안(느린 교실망에서는 수십 초) 누른 카드에 '불러오는 중'을 보이고,
 *  그 사이에 누른 카드(같은 곡이든 다른 곡이든)는 무시한다 — 두 곡을 한꺼번에 열면 늦게 끝난 쪽이 앞 곡의
 *  상태(선생님 곡선·음원)를 덮어쓴다. 예전에는 아무 표시가 없어 아이가 같은 카드를 여러 번 눌렀다. */
async function openIntro(songId) {
  if (state.opening) return;
  state.opening = songId;
  const card = document.querySelector(`#song-grid .song-card[data-song="${songId}"]`);
  if (card) { card.classList.add("loading"); card.setAttribute("aria-busy", "true"); }
  try {
    await loadIntro(songId);
  } finally {
    state.opening = null;
    if (card) { card.classList.remove("loading"); card.removeAttribute("aria-busy"); }
  }
  // 이 곡의 음원을 다 받았다 — 이제 분석 도구를 받기 시작한다(준비 화면을 보고 노래하는 동안에도 받는다).
  // 마이크를 열 수 없는 주소(http)면 부를 수 없으니 받지 않는다.
  if (micAvailable()) startAnalyzer();
}

async function loadIntro(songId) {
  stopIntroLoop();
  state.songId = songId;
  state.song = state.cfg.songs[songId];
  // 곡별 템포 덮어쓰기가 적용된 장단(config.jangdan_for). cfg.jangdan[..] 은 장단 기본값이라
  // 같은 굿거리라도 곡마다 다른 템포가 반영돼 있지 않다 — 화면·재생은 반드시 이쪽을 쓴다.
  state.jd = state.song.jangdan_resolved;
  $("topbar-song").textContent = state.song.full_name;
  $("intro-title").textContent = state.song.full_name;
  $("intro-meta").innerHTML =
    `<span class="tag">${state.song.tori_name}</span><span class="tag">${state.song.region} 지역</span>` +
    `<span class="tag">${state.jd.name} · ${state.jd.bak}박 × ${state.jd.sobak_per_bak}소박</span>` +
    `<span class="tag" title="${state.jd.tempo_source || ""}">1박(♩.) = ${state.jd.bpm_bak}` +
    `${/임시/.test(state.jd.tempo_source || "") ? " (임시 템포)" : ""}</span>`;
  // 곡 악보 위에 장단 그림(장단별 1장). 없는 장단이면 숨긴다.
  // 정간보는 config의 pattern으로 직접 그린다(고정 그림은 중복이라 쓰지 않는다)
  $("intro-jangdan-caption").textContent =
    `${state.jd.name} · 1박(♩.) = ${state.jd.bpm_bak} · ‘장단 듣기’를 누르면 소리에 맞춰 움직여요`;
  $("intro-jangdan-fig").hidden = false;
  state.jeonggan = buildJangdanView($("jangdan-strip"), state.jd);

  $("intro-score").src = state.song.score_image;
  $("intro-score-caption").textContent = `${state.song.full_name} · ${state.jd.name}`;
  $("intro-text").textContent = state.song.intro;

  // 전문가 곡선(사전 분석 JSON) 미리 받아두기
  state.expert = await (await fetch(dataUrl(`expert/${songId}.json`))).json();
  state.tm = state.expert.timing;

  // 음원 준비: 장단 반주 / 선생님 가창 / 학습자 예시 가창
  state.jangdanBuf = await loadBuf(state.jd.audio);
  state.expertBuf = await loadBuf(state.song.expert_audio);
  state.expertFullBuf = await loadBuf(state.song.expert_audio_full);
  state.studentBuf = await loadBuf(state.song.student_demo_audio);
  state.hasExpertAudio = !!(state.expertBuf || state.expertFullBuf);

  // 미리 분석해 둔 학습자 가창이 있으면 '비교 보기' 모드 — 마이크를 쓰지 않는다
  try {
    const r = await fetch(dataUrl(`student/${songId}.json`));
    state.studentData = r.ok ? await r.json() : null;
  } catch (e) { state.studentData = null; }
  $("btn-start-sing").textContent = "노래할 준비가 됐어요 →";
  $("btn-compare-demo").hidden = !state.studentData;
  state.hasIntroAudio = await exists(state.song.intro_audio);
  $("btn-expert-audio").hidden = !state.hasExpertAudio;
  const notes = [];
  notes.push(state.jangdanBuf
    ? `‘장단 듣기’와 반주는 녹음한 ${state.jd.name} 음원입니다(1박 ♩. = ${state.jd.bpm_bak}).`
    : `${state.jd.name} 녹음 음원이 아직 없어 합성 장구 소리로 들려줍니다(1박 ♩. = ${state.jd.bpm_bak}, 임시 템포).`);
  // 2026-10-07: 금다래꿍은 새 선생님 녹음 6장단 가운데 앞 4장단만 듣기 음원으로 쓴다(뒤는 잘라 냄). 그래서 '원본 전체를
  // 자르지 않고'라고 하지 않고, 네 곡 모두에 맞는 '빠르기를 바꾸지 않고'라고 적는다.
  if (state.expertFullBuf) notes.push(
    `‘선생님 노래 듣기’는 전문가 녹음(${state.expertFullBuf.duration.toFixed(1)}초)을 빠르기를 바꾸지 않고 그대로 들려줍니다.`);
  else if (!state.expertBuf) notes.push(`선생님 노래 음원(client/${state.song.expert_audio})이 아직 없어 지금은 장단만 들을 수 있어요.`);
  if (state.studentData) notes.push(`이 곡은 선생님과 학습자의 실제 녹음을 미리 분석해 둔 자료도 있습니다. ` +
    "‘예시 비교 보기’를 누르면 마이크를 쓰지 않고 그 두 가락선을 나란히 보여 줍니다.");
  // 파일 자리(audio/…_intro.mp3)는 연구자용이라 화면에 적지 않는다(사이트 사본에는 client/ 폴더도 없다).
  if (!state.hasIntroAudio) notes.push("안내 음성이 아직 없어 스피커 버튼은 꺼져 있어요.");
  $("intro-audio-note").textContent = notes.join(" ");
  showAnalyzerStatus();

  const sp = $("btn-speaker");
  sp.classList.toggle("off", !state.hasIntroAudio);
  if (state.introAudio) { state.introAudio.pause(); state.introAudio = null; }
  if (state.hasIntroAudio) {
    state.introAudio = new Audio(state.song.intro_audio);
    state.introAudio.play().catch(() => {});
    sp.textContent = "🔊";
  } else sp.textContent = "🔇";

  $("btn-jangdan").textContent = "▶ 장단 듣기"; $("btn-jangdan").classList.remove("active");
  show("screen-intro");
}

function stopIntroLoop() {
  if (state.introLoop) { clearInterval(state.introLoop); state.introLoop = null; }
  if (state.janggu) state.janggu.stop();
  stopBufs();
  if (state.jeongganStop) { state.jeongganStop(); state.jeongganStop = null; }
  if (state.lyricRaf) { cancelAnimationFrame(state.lyricRaf); state.lyricRaf = null; }
  const lb = $("intro-lyric");
  if (lb) { lb.innerHTML = ""; lb.dataset.line = ""; $("intro-lyric-next").textContent = ""; }
  state.jangdanOn = false;
  $("btn-jangdan").textContent = "▶ 장단 듣기"; $("btn-jangdan").classList.remove("active");
  $("btn-expert-audio").textContent = "▶ 선생님 노래 듣기"; $("btn-expert-audio").classList.remove("active");
}

$("btn-jangdan").onclick = () => {
  if (state.jangdanOn) { stopIntroLoop(); return; }
  const ctx = ensureAudio();
  const start = ctx.currentTime + 0.08;
  if (state.jangdanBuf) {            // ① 녹음 장단 음원이 있으면 끊김 없이 반복 재생
    playBuf(state.jangdanBuf, start, 0, 0, true);
  } else {                           // ② 없으면 config 템포로 합성 장구 재생
    const jt = jangdanTiming(state.jd);
    let next = start;
    const tick = () => {   // 항상 2장단 앞서 예약해 끊김 없이 반복
      while (next < ctx.currentTime + jt.jangdanS * 2) next = state.janggu.schedule(state.jd, next, 1);
    };
    tick(); state.introLoop = setInterval(tick, 250);
  }
  if (state.jeonggan) state.jeongganStop = animateJeonggan(state.jeonggan, ctx, start, state.jd);
  state.jangdanOn = true;
  $("btn-jangdan").textContent = "■ 장단 멈추기"; $("btn-jangdan").classList.add("active");
};

$("btn-expert-audio").onclick = () => {
  const on = $("btn-expert-audio").classList.contains("active");
  stopIntroLoop();
  // 전체 녹음이 있으면 처음부터 끝까지 들려준다(자르지 않은 원본).
  const full = !!state.expertFullBuf, buf = state.expertFullBuf || state.expertBuf;
  if (on || !buf) return;
  const ctx = ensureAudio(), start = ctx.currentTime + 0.05;
  const s = playBuf(buf, start);
  $("btn-expert-audio").textContent = "■ 멈추기"; $("btn-expert-audio").classList.add("active");
  if (s) s.onended = () => stopIntroLoop();

  // 가사: 전체 녹음은 파일 0초가 곧 녹음 0초이므로, 첫 정박 기준으로 소박을 센다.
  const ref = state.song.reference, L = state.song.lyric_lines;
  if (!L || !L.length) return;
  const d0 = full ? (ref ? ref.grid_first_downbeat_s : 0) : -(ref ? ref.audio_preroll_s || 0 : 0);
  // 1장단의 소박 수는 장단마다 다르다(세마치 9, 굿거리 12). 곡의 격자에서 읽는다.
  const per = state.tm.sobak_per_jangdan;
  const sobakS = full ? (ref ? ref.grid_cycle_s / per : state.tm.sobak_seconds) : state.tm.sobak_seconds;
  const base = full ? 0 : sliceSobakBase();
  $("intro-lyric-bar").hidden = false;
  const tick = () => {
    if (!state.jangdanOn && !$("btn-expert-audio").classList.contains("active")) {
      $("intro-lyric").innerHTML = ""; $("intro-lyric").dataset.line = "";
      $("intro-lyric-next").textContent = ""; return;
    }
    const sob = base + (ctx.currentTime - start - d0) / sobakS;
    renderLyric($("intro-lyric"), state.song, sob);
    $("intro-lyric-next").textContent = lyricNext(state.song, sob);
    state.lyricRaf = requestAnimationFrame(tick);
  };
  tick();
};

$("btn-speaker").onclick = () => {
  if (!state.introAudio) return;
  if (state.introAudio.paused) { state.introAudio.play(); $("btn-speaker").textContent = "🔊"; }
  else { state.introAudio.pause(); $("btn-speaker").textContent = "🔇"; }
};

$("btn-start-sing").onclick = () => {
  stopIntroLoop(); if (state.introAudio) state.introAudio.pause(); startSing(false);
};
// 미리 녹음·분석해 둔 학습자 가창(학습자)을 보는 보조 경로. 마이크를 열지 않는다.
$("btn-compare-demo").onclick = () => {
  stopIntroLoop(); if (state.introAudio) state.introAudio.pause(); startSing(true);
};

/* ---------------- ③ 한 장단 주고받기 ---------------- */
function buildPills(containerId) {
  const c = $(containerId); if (!c) return; c.innerHTML = "";
  const me = state.compareMode ? "학" : "나";   // 비교 보기에서는 '학습자'(실명은 쓰지 않는다)
  for (let p = 0; p < nPairs(); p++) {
    for (const role of state.cfg.turn_taking.sequence_per_pair) {
      if (role === "ready") continue;
      const d = document.createElement("div");
      d.className = `pill ${role}`; d.dataset.pair = p; d.dataset.role = role;
      d.textContent = role === "expert" ? `선${p + 1}` : `${me}${p + 1}`;
      c.appendChild(d);
    }
  }
}

// compareMode = true 이면 미리 녹음해 둔 학습자 가창을 보는 화면이다(마이크를 쓰지 않는다).
// 기본은 false — 내가 직접 부른다.
async function startSing(compareMode) {
  // 준비 중이거나 이미 부르고 있으면 다시 시작하지 않는다. 겹쳐 돌면 두 벌의 녹음기와
  // 타임라인이 같은 전역 상태를 번갈아 덮어써서, 소리와 시각이 서로 다른 것이 된다.
  if (state.singing) return;
  state.singing = true;
  state.singRun = (state.singRun || 0) + 1;   // 이 차례의 번호. 앞 차례의 늦은 분석 결과를 버리는 데 쓴다(finishSing)
  // 거울 화면의 믹스 체크박스(state.mute)는 **결과 화면에서 비교해 들을 때만** 쓰는 것이다.
  // 그런데 같은 전역을 주고받기 화면도 보기 때문에, 거울에서 '장단'을 한 번 끄면
  // 그 뒤로 부르는 모든 곡의 반주가 꺼진 채로 녹음됐다(2026-10-01 확인).
  // 반주가 안 들리면 아이가 장단을 못 맞추고, 시간축 고정이라는 전제 자체가 깨진다.
  // 그래서 새로 부를 때마다 전부 들리는 상태에서 시작한다.
  state.mute = {};
  for (const id of ["mix-expert", "mix-student", "mix-jangdan"]) {
    const el = $(id); if (el) el.checked = true;
  }
  compareMode = !!compareMode;
  state.compareMode = compareMode;
  // 학습자 소리 음량 배수도 새로 정한다. 앞 판(내 마이크 녹음)에서 작은 소리를 키우려고 정한 배수가
  // 남아 있으면, 이번 예시 비교 보기의 주고받기에서 이미 알맞은 크기인 예시 음원을 그만큼 또 키워
  // 학습자 소리만 유독 크게 들렸다(2026-10-05). 결과 화면에서 다시 셈하지만 주고받기는 그 전이다.
  state.studentGain = compareMode ? computeStudentGain(state.studentBuf) : 1;
  show("screen-sing");
  $("mic-denied").hidden = true; $("count-big").textContent = "";
  buildPills("pills");
  $("bak-dots").innerHTML = Array.from({ length: state.jd.bak }, () => "<i></i>").join("");
  drawSingExpert(0);

  $("sing-student-label").textContent = meLabelText();
  $("chart-sing-student").hidden = !compareMode;
  $("sing-student-placeholder").hidden = compareMode;
  $("sing-student-placeholder").textContent = SING_PLACEHOLDER;   // 앞 판이 실패 문구로 바꿔 두었을 수 있다
  $("sing-placeholder-why").hidden = false;
  $("btn-retry-analyze").hidden = true;
  state.held = null;
  $("sing-status").textContent = compareMode ? "두 소리를 차례로 들려 드릴게요." : "마이크를 준비하고 있어요…";
  if (compareMode) drawSingStudent(0);

  if (!compareMode) {
    // 0) 이 기기로 부를 수 있는가 — 다 부른 뒤에야 알리면 아이의 노래가 버려진다(pesto-onnx)
    const st = Analyzer.status;
    const blocked = !micAvailable() ? MIC_BLOCKED
      : Analyzer.unsupported() ? analyzerFailText("device", "sing")
      : (st.phase === "failed" && st.kind === "missing") ? analyzerFailText("missing", "sing") : null;
    if (blocked) {
      $("sing-status").textContent = blocked;
      state.singing = false;
      return;
    }
    // 분석 도구 받기가 실패해 멈춰 있으면 노래하는 동안 다시 받는다(이미 받는 중이거나 받아 두었으면 그대로 둔다)
    if (!Analyzer.ready) startAnalyzer();
    // 1) 마이크 권한
    try {
      if (!state.stream) state.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
    } catch (e) {
      $("sing-status").textContent = "마이크를 열 수 없어요.";
      $("mic-denied").hidden = false;
      state.singing = false;
      return;
    }
  }

  // 2) 녹음 시작 → 시작 시각을 오디오 시계로 기록 → 그 시각을 기준으로 장단·순서를 예약
  const ctx = ensureAudio();
  const jt = jangdanTiming(state.jd);
  state.mic = null; state.myBuf = null;
  if (!compareMode) {
    state.mic = new MicRecorder(ctx, state.stream);
    try {
      // start()는 첫 표본이 실제로 들어온 뒤에 끝난다. 그때의 오디오 시계 시각이
      // 녹음 0초다 — 장단을 예약하는 시계와 같은 시계이므로 시작 지연이 생기지 않는다.
      await state.mic.start();
    } catch (e) {
      $("sing-status").textContent = `마이크 녹음을 시작할 수 없어요 (${e.message})`;
      $("mic-denied").hidden = false;
      state.singing = false;
      return;
    }
  }

  const base = ctx.currentTime + 0.6;   // 첫 장단까지의 여유
  const tt = state.cfg.turn_taking;
  const slots = [];
  let t = base;
  for (let i = 0; i < tt.lead_in_jangdan; i++) { slots.push({ role: "lead", pair: -1, start: t, end: t + jt.jangdanS }); t += jt.jangdanS; }
  for (let p = 0; p < nPairs(); p++) for (const role of tt.sequence_per_pair) { slots.push({ role, pair: p, start: t, end: t + jt.jangdanS }); t += jt.jangdanS; }
  state.timeline = { base, end: t, slots, jt };

  // 스피커로 내보낸 소리를 그대로 적어 둔다(오디오 시계 기준). 녹음이 끝나면 이것이 녹음에
  // 몇 ms 늦게 새어 들었는지로 기기 지연을 잰다(latency.js estimateDelay).
  const played = [];
  const play = (buf, when, offset, dur, loop, tag) => {
    playBuf(buf, when, offset, dur, loop, tag);
    played.push({ buf, when, offset, dur, loop, gain: trackGain(tag) });
  };

  // 반주: 녹음 장단이 있으면 오디오 시계에 정확히 걸어 반복시킨다(파일 길이가 장단 배수라 이음매 없음)
  stopBufs();
  if (state.jangdanBuf) play(state.jangdanBuf, base, 0, t - base, true, "jangdan");
  else state.janggu.schedule(state.jd, base, slots.length);

  // 가창 음원도 각 슬롯 시작 시각에 맞춰 미리 예약한다(재생 지연 없이 장단 격자에 정확히 얹힌다).
  // preroll: 음원은 정박보다 조금 앞에서 잘려 있다(첫 음의 어택 보호). 그만큼 먼저 걸어 준다.
  const pre = preroll();
  for (const s of slots) {
    // 학생 차례의 음원은 '예시 비교 보기'에서만 튼다. 내가 부를 때 남의 소리가 나면 안 된다.
    const buf = s.role === "expert" ? state.expertBuf
      : (s.role === "student" && compareMode ? state.studentBuf : null);
    if (buf) play(buf, Math.max(ctx.currentTime, s.start - pre), s.pair * jt.jangdanS, jt.jangdanS + pre, false, s.role);
  }
  state.timeline.played = played;

  // 정간보·가사
  state.singJeonggan = buildJangdanView($("sing-jeonggan"), state.jd);
  $("sing-lyric-bar").hidden = !hasLyrics();
  if (state.jeongganStop) state.jeongganStop();
  state.jeongganStop = animateJeonggan(state.singJeonggan, ctx, base, state.jd, t);

  state.raf = requestAnimationFrame(singFrame);
}

/** 녹음 화면의 선생님 곡선. lyricT = 지금 부르는 자리(초) — 그 글자를 진하게 한다(없으면 강조 없음). */
function drawSingExpert(revealUntil, lyricT) {
  drawPitchChart($("chart-sing-expert"), {
    curve: state.expert.curve, timing: state.tm, color: state.cfg.viz.color_expert,
    ...yRange(), yTick: state.cfg.viz.y_tick_cents,
    bridgeGapMs: state.cfg.viz.bridge_gap_ms,
    revealUntil,
    // 가사 글자는 선이 아직 그려지지 않은 자리에도 처음부터 보인다(아이가 앞을 읽고 준비하게).
    // 높이는 미리 분석해 둔 선생님 곡선 전체로 정하므로, 선이 그려져도 글자가 움직이지 않는다.
    lyrics: { glyphs: songGlyphs(), curves: [state.expert.curve], size: 15,
              tNow: lyricT, active: state.singing },
  });
}
function drawSingStudent(revealUntil) {
  if (!state.studentData) return;
  drawPitchChart($("chart-sing-student"), {
    curve: state.studentData.curve, timing: state.tm, color: state.cfg.viz.color_student,
    ...yRange(), yTick: state.cfg.viz.y_tick_cents,
    bridgeGapMs: state.cfg.viz.bridge_gap_ms,
    revealUntil,
    // 글자는 없지만 위 선생님 그래프와 같은 위 여백을 두어 두 그래프의 세로 눈금을 맞춘다
    reserveTop: hasLyrics() ? lyricTopPad(15) : 0,
  });
}

let lastSlotIdx = -1;
function singFrame() {
  const ctx = state.audioCtx, now = ctx.currentTime, tl = state.timeline, jt = tl.jt;
  if (now >= tl.end + 0.4) { finishSing(); return; }
  const idx = tl.slots.findIndex(s => now >= s.start && now < s.end);
  const slot = tl.slots[idx];
  if (slot) {
    if (idx !== lastSlotIdx) {   // 슬롯이 바뀔 때 한 번만 하는 일
      lastSlotIdx = idx;
      document.querySelectorAll("#pills .pill").forEach(p => {
        p.classList.remove("now");
        const done = tl.slots.findIndex(s => s.role === p.dataset.role && s.pair == p.dataset.pair) < idx;
        p.classList.toggle("done", done);
        if (slot.role === p.dataset.role && slot.pair == p.dataset.pair) p.classList.add("now");
      });
      const cm = state.compareMode, N = nPairs();
      const msg = {
        lead: "장단을 들어 보세요. 곧 선생님이 먼저 부릅니다.",
        expert: `선생님 차례 (${slot.pair + 1}/${N}) — 잘 들어 보세요.`,
        ready: cm ? "이어서 학습자 소리를 들려 드릴게요." : "준비… 다음 장단에 내가 부릅니다!",
        student: cm ? `학습자 차례 (${slot.pair + 1}/${N}) — 가락선이 함께 그려집니다.`
                    : `내 차례 (${slot.pair + 1}/${N}) — 지금 불러요! 🎤`,
      }[slot.role];
      $("sing-status").textContent = msg;
    }
    const bak = Math.min(state.jd.bak - 1, Math.floor((now - slot.start) / jt.bakS));
    document.querySelectorAll("#bak-dots i").forEach((d, i) => d.classList.toggle("on", i === bak));
    const cm = state.compareMode;
    $("count-big").textContent = slot.role === "ready" ? (cm ? "" : (state.jd.count_in_labels[bak] || ""))
      : (slot.role === "student" ? (cm ? "" : "🎤") : "");
    // 두 곡선 모두 사전 분석 JSON이므로 재생 진행에 맞춰 그려도 된다(실시간 분석이 아님)
    const doneE = tl.slots.filter((s, i) => s.role === "expert" && i < idx).length;
    // 선생님이든 나든 지금 부르고 있는 자리. 그 글자가 가락선 위에서 진해진다.
    const singingT = (slot.role === "expert" || slot.role === "student")
      ? slot.pair * jt.jangdanS + (now - slot.start) : null;
    drawSingExpert(slot.role === "expert" ? slot.pair * jt.jangdanS + (now - slot.start) : doneE * jt.jangdanS,
                   singingT);
    if (cm) {
      const doneS = tl.slots.filter((s, i) => s.role === "student" && i < idx).length;
      drawSingStudent(slot.role === "student" ? slot.pair * jt.jangdanS + (now - slot.start) : doneS * jt.jangdanS);
    }
    // 가사: 지금 부르고 있는 장단의 글자를 강조한다
    if (hasLyrics()) {
      const per = state.tm.sobak_per_jangdan;
      const sob = sliceSobakBase() + (slot.role === "expert" || slot.role === "student"
        ? slot.pair * per + (now - slot.start) / jt.sobakS
        : (slot.role === "ready" ? slot.pair * per : 0));
      renderLyric($("sing-lyric"), state.song, sob);
      $("sing-lyric-next").textContent = lyricNext(state.song, sob);
    }
  }
  state.raf = requestAnimationFrame(singFrame);
}

/* ---------------- 기기 지연 (2026-10-05) ----------------
 * 스피커 → 공기 → 마이크 → 녹음을 지나는 동안 생기는 지연. 기기·브라우저마다 다르고 같은 기계에서도
 * 흔들리므로 녹음마다 잰다. 이어폰 없이 스피커로 듣고 부르므로 앱이 튼 장단·선생님 소리가 녹음에 새어 든다.
 * 그것이 '틀어진 자리'보다 몇 ms 늦게 녹음에 나타났는지를 학생이 부르지 않는 장단에서만 잰다.
 * 녹음 전체를 그만큼 당길 뿐이므로 학생이 빠르게·늦게 부른 것은 그대로 남는다. */
const LATENCY_KEY = "sorigeoul.deviceLatency";
function loadPrevLatency() {
  try {
    const v = JSON.parse(localStorage.getItem(LATENCY_KEY) || "null");
    return v && Number.isFinite(v.latency_s) ? v.latency_s : null;
  } catch (e) { return null; }
}
function savePrevLatency(s) {
  try { localStorage.setItem(LATENCY_KEY, JSON.stringify({ latency_s: s, at: new Date().toISOString() })); }
  catch (e) { /* 사생활 보호 창 등에서는 저장되지 않아도 된다 — 다음 녹음에서 다시 잰다 */ }
}
const _mono = new WeakMap();
/** AudioBuffer → 모노 Float32Array (스피커로는 모든 채널이 섞여 나간다) */
function monoData(buf) {
  if (_mono.has(buf)) return _mono.get(buf);
  const n = buf.numberOfChannels, out = new Float32Array(buf.length);
  for (let c = 0; c < n; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / n;
  }
  _mono.set(buf, out);
  return out;
}
/** 이번 녹음에 쓸 기기 지연(초)과 그 출처. { latency_s, method, est, previous_s, fixed_s, ms } */
function measureLatency(take, recStart) {
  const fixed = take.outputLatency + (state.cfg.mic_latency_ms || 0) / 1000;
  let est = null, ms = null;
  if (state.cfg.auto_latency !== false && typeof estimateDelay === "function") {
    try {
      const t0 = performance.now(), sr = take.sampleRate, tl = state.timeline;
      const events = (tl.played || []).filter(p => p.buf.sampleRate === sr).map(p => ({
        data: monoData(p.buf), when: p.when - recStart, offset: p.offset, dur: p.dur, loop: p.loop, gain: p.gain,
      }));
      // 학생이 부르지 않는 장단을 학생 차례마다 끊어 묶는다: [앞장단·선생님·준비] [선생님·준비] …
      const groups = [[]];
      for (const s of tl.slots) {
        if (s.role === "student") { if (groups[groups.length - 1].length) groups.push([]); continue; }
        groups[groups.length - 1].push([s.start - recStart, s.end - recStart]);
      }
      if (!groups[groups.length - 1].length) groups.pop();
      est = estimateDelay(take.pcm, renderPlayed(events, sr, take.pcm.length), sr, groups);
      ms = Math.round(performance.now() - t0);
    } catch (e) {
      console.error("[소리거울] 기기 지연을 재지 못했습니다", e);
    }
  }
  const prev = loadPrevLatency();
  const pick = chooseLatency(est, prev, fixed);
  if (pick.method === "auto") savePrevLatency(pick.latency_s);
  return Object.assign(pick, { est, ms, previous_s: prev, fixed_s: fixed });
}

async function finishSing() {
  // 분석을 기다리는 동안 '← 처음으로'를 누르거나 새로 부르기 시작하면 번호가 바뀐다(goHome·startSing).
  // 그 뒤에 도착한 결과·오류는 버린다 — 곡 선택 화면에 있다가 결과 화면으로 갑자기 넘어가면 안 된다.
  const run = state.singRun;
  state.singing = false;          // 한 차례가 끝났다 — 다시 부를 수 있다
  cancelAnimationFrame(state.raf); lastSlotIdx = -1; stopBufs();
  if (state.jeongganStop) { state.jeongganStop(); state.jeongganStop = null; }
  document.querySelectorAll("#pills .pill").forEach(p => { p.classList.remove("now"); p.classList.add("done"); });
  $("count-big").textContent = "";
  drawSingExpert(undefined);

  // 비교 보기 모드: 녹음도 전송도 없다. 미리 분석해 둔 결과를 그대로 보여 준다.
  if (state.compareMode) {
    state.studentGain = computeStudentGain(state.studentBuf);
    state.myLevel = bufferLevel(state.studentBuf, playbackCfg().level_floor);
    drawSingStudent(undefined);
    state.result = JSON.parse(JSON.stringify(state.studentData));
    state.result.client_roundtrip_seconds = 0;
    showResult();
    return;
  }

  $("sing-status").textContent = `${nPairs()}장단 녹음 완료! 잘했어요 👏`;
  showAnalyzing(true);
  const take = await state.mic.stop();
  if (run !== state.singRun) return;   // 녹음을 마무리하는 사이에 처음으로 돌아갔다
  state.__take = take;   // 진단용 — 화면에는 쓰지 않는다

  // 녹음 0초가 오디오 시계로 언제인가 — **방금 멈춘 그 녹음기에게 직접 묻는다.**
  // state.recStartCtx 를 쓰지 않는 이유: 전역 상태라, 어떤 사정으로든 다른 녹음기로
  // 바뀌어 있으면 '소리는 이 녹음기 것, 시각은 저 녹음기 것'이 되어 구간이 어긋난다.
  // 실제로 그 일이 일어났다(2026-10-01: 25.6초짜리 녹음에 4934초 지점을 보냈다).
  // 소리와 시각은 반드시 같은 객체에서 나와야 한다.
  const recStart = take.startTime;
  if (!Number.isFinite(recStart)) {
    $("sing-status").textContent =
      "녹음 시작 시각을 알 수 없어 분석하지 않았어요. ‘← 처음으로’를 눌러 다시 불러 주세요.";
    console.error("[소리거울] take.startTime 이 없습니다", take);
    showAnalyzing(false);
    return;
  }
  const windows = state.timeline.slots.filter(s => s.role === "student").map(s => ({
    pair: s.pair,
    start_s: +(s.start - recStart).toFixed(4),
    end_s: +(s.end - recStart).toFixed(4),
  }));

  // 보내기 전에 구간이 녹음 안에 들어오는지 확인한다. 어긋난 채 보내면 분석기가
  // 거절할 뿐이고, 아이는 왜 안 되는지 알 수 없다.
  const bad = windows.filter(w => w.start_s < 0 || w.end_s > take.seconds + 0.5);
  if (bad.length) {
    $("sing-status").textContent =
      `녹음과 장단 위치가 어긋나 분석하지 않았어요(${take.seconds.toFixed(1)}초 녹음, ` +
      `${bad.length}개 구간이 범위 밖). ‘← 처음으로’를 눌러 다시 불러 주세요.`;
    console.error("[소리거울] 구간이 녹음 밖입니다", { 녹음초: take.seconds, windows });
    showAnalyzing(false);
    return;
  }
  // 기기 지연: 이 녹음에 새어 든 장단 소리로 잰다. 학생 목소리는 쓰지 않는다(measureLatency 참조).
  const lat = measureLatency(take, recStart);
  state.latency = lat;
  const est = lat.est || {};
  const r4 = x => Number.isFinite(x) ? +x.toFixed(4) : null;
  const timing = {
    jangdan: state.song.jangdan, bpm_bak: state.jd.bpm_bak,
    jangdan_seconds: state.timeline.jt.jangdanS, sobak_seconds: state.timeline.jt.sobakS,
    sample_rate: take.sampleRate,
    recording_seconds: +take.seconds.toFixed(3),
    output_latency_s: +take.outputLatency.toFixed(4),
    // 학생 장단을 자를 자리 = 예약 시각 − 녹음 0초 + 이 값. 서버와 거울 재생이 같은 값을 쓴다.
    device_latency_s: r4(lat.latency_s),
    latency_method: lat.method,          // "auto" / "previous" / "fixed"
    // 진단용(서버 로그·결과 source): 자동으로 잰 과정. 분석에는 device_latency_s 만 쓴다.
    latency_auto: lat.est ? {
      ok: !!est.ok, delay_s: r4(est.delay_s), contrast: Number.isFinite(est.contrast) ? +est.contrast.toFixed(2) : null,
      agree: est.agree, n_groups: est.n_groups, per_group_s: (est.per_group_s || []).map(r4),
      reason: est.reason || "", ms: lat.ms,
    } : null,
    previous_latency_s: r4(lat.previous_s),
    base_latency_s: +((state.audioCtx && state.audioCtx.baseLatency) || 0).toFixed(4),
    start_time_drift_s: Number.isFinite(take.startTimeDrift) ? +take.startTimeDrift.toFixed(4) : null,
    student_windows: windows,
  };

  // 거울 재생용으로 내가 부른 세 장단만 잘라 이어 붙인다(분석한 구간과 같은 자리).
  state.myBuf = joinBuffers(state.audioCtx,
    windows.map(w => take.slice(w.start_s + lat.latency_s, state.timeline.jt.jangdanS)));
  // 선생님 소리와 나란히 들리도록 음량을 맞춘다(재생 전용).
  state.studentGain = computeStudentGain(state.myBuf);
  state.myLevel = bufferLevel(state.myBuf, playbackCfg().level_floor);

  // 녹음(WAV)과 timing은 결과가 나올 때까지 들고 있는다. 분석 도구를 아직 받는 중이면 다 받는 대로 분석하고,
  // 받기에 실패하면 ‘다시 분석하기’로 같은 녹음을 다시 분석한다 — 아이가 다시 부르지 않아도 된다(2026-10-06 검토).
  state.held = { blob: take.blob, timing, sampleRate: take.sampleRate, songId: state.songId, run };
  await analyzeHeld();
}

/** 들고 있는 녹음(state.held)을 웹페이지 안 분석 일꾼에게 넘겨 결과 화면으로 간다.
 *  녹음은 이 컴퓨터 밖으로 나가지 않는다. 서버에 보내던 것과 같은 16bit WAV를 일꾼에게 넘길 뿐이다. */
async function analyzeHeld() {
  const job = state.held;
  if (!job || job.run !== state.singRun) return;
  const run = job.run;
  $("btn-retry-analyze").hidden = true;
  showAnalyzing(true);
  const t0 = performance.now();
  try {
    // 매번 새로 꺼낸다 — 일꾼에게 넘긴 바이트는 넘겨준 쪽에서 비워지므로(transfer) 다시 분석할 때 쓸 수 없다.
    const wavBytes = new Uint8Array(await job.blob.arrayBuffer());
    const result = await Analyzer.analyze({ wav: wavBytes, songId: job.songId, timing: job.timing,
                                            expert: state.expert, sampleRate: job.sampleRate });
    if (run !== state.singRun) {   // 기다리는 사이에 처음으로 돌아갔다 — 늦게 온 결과는 버린다
      console.warn("[소리거울] 처음으로 돌아간 뒤에 도착한 분석 결과를 버립니다.");
      return;
    }
    state.held = null;
    state.result = result;
    showAnalyzing(false);
    state.result.client_roundtrip_seconds = +((performance.now() - t0) / 1000).toFixed(2);
    logDiagnostics(result, job.timing);
    showResult();
  } catch (e) {
    if (run !== state.singRun) {   // 오류도 마찬가지 — 지금 화면(곡 선택·새 노래)에 끼어들지 않는다
      console.warn("[소리거울] 처음으로 돌아간 뒤에 도착한 분석 오류를 버립니다:", e);
      return;
    }
    // 세 경우를 나눠 알린다. 화면에는 한국어 문장만 둔다 — 오류 원문(영어 기술 문장)은 콘솔에만 남긴다.
    //  ① 분석할 수 없는 녹음(서버의 400과 같은 경우): 파이썬이 쓴 이유를 보여 준다. 같은 녹음을 다시 분석해도 같으므로
    //     다시 부르게 한다. 노래 화면에 보이는 버튼은 위쪽의 ‘← 처음으로’뿐이라 그것을 가리킨다.
    //  ② 분석하는 도중의 뜻밖의 오류(e.stage === "analyze"): 같은 녹음으로 다시 분석해 보거나 다시 부르게 한다.
    //  ③ 분석 도구를 못 받음·못 띄움: 갈래(e.kind)에 따라 — 인터넷이면 ‘다시 분석하기’, 이 기기로는 안 되거나
    //     사이트에 파일이 없으면 다시 해도 같으므로 그 사정만 알린다.
    const tool = !e.analysisError && e.stage !== "analyze";
    const retry = !e.analysisError && !(tool && (e.kind === "device" || e.kind === "missing"));
    showAnalyzing(false, true);
    $("sing-status").textContent = e.analysisError
      ? `결과를 만들지 못했어요 — ${e.message} ‘← 처음으로’를 눌러 다시 불러 주세요.`
      : !tool
        ? "분석하다가 오류가 났어요. ‘다시 분석하기’를 누르거나, ‘← 처음으로’를 눌러 다시 불러 주세요."
        : analyzerFailText(e.kind, "sing");
    $("btn-retry-analyze").hidden = !retry;
    if (!retry) state.held = null;
    console.error("[소리거울] 분석 실패:", { 갈래: e.kind || null, 단계: e.stage || null, timing: job.timing }, e);
  }
}

/** 결과가 비어 보일 때 되짚을 수치를 브라우저 콘솔(개발자 도구)에 한 줄 남긴다. main의 분석 서버가 분석마다 로그에
 *  남기던 것과 같은 내용이다(server/main.py). 이 사이트에는 서버가 없어 그 로그가 없다. 수치만 남기고 녹음은 보내지 않는다.
 *  예: 최대진폭이 0.001(config의 pesto_silence_peak)보다 작으면 크기 맞춤을 건너뛰어 '소리가 잡힌 프레임'이 0%가 된다. */
function logDiagnostics(r, timing) {
  const s = r.source || {}, a = s.latency_auto || {};
  console.info("[소리거울] 분석 진단 " + JSON.stringify({
    곡: state.songId, 유효프레임: s.valid_ratio, 녹음초: s.recording_seconds, 표본율: s.sample_rate,
    최대진폭: s.input_peak, 장단별최대진폭: s.student_window_peaks, 옥타브이동: s.octave_shift,
    기기지연ms: Number.isFinite(s.latency_offset_s) ? +(s.latency_offset_s * 1000).toFixed(1) : null,
    지연방법: s.latency_method,
    자동측정: { 믿음: !!a.ok, 지연s: a.delay_s, 뚜렷함: a.contrast, 장단일치: `${a.agree}/${a.n_groups}`,
                장단별s: a.per_group_s, 이유: a.reason || "" },
    지난번값s: timing.previous_latency_s, outputLatency_s: timing.output_latency_s,
    baseLatency_s: timing.base_latency_s, startTimeDrift_s: timing.start_time_drift_s,
    분석초: s.analysis_seconds, 일꾼초: r.worker_seconds, 스레드: Analyzer.info && Analyzer.info.threads,
  }));
}

$("btn-mic-retry").onclick = () => startSing(false);
$("btn-retry-analyze").onclick = () => {
  $("sing-status").textContent = "방금 부른 노래를 다시 분석하고 있어요…";   // 앞의 실패 문구를 남겨 두지 않는다
  analyzeHeld();
};

/* ---------------- ④ 결과 ---------------- */

/** 분석을 기다리는 동안 '내 소리' 자리에 원을 돌리고 지난 시간을 올린다.
 *  on=false 면 멈추고 치운다(결과가 왔거나 오류로 끝났거나). failed면 자리 안내를 '이번에는 못 만들었다'로 바꾼다 —
 *  '노래가 끝나고 살펴본 뒤에 나타나요'가 다시 보이면 실패했는데도 곧 곡선이 나올 것처럼 읽힌다. */
const SING_PLACEHOLDER = $("sing-student-placeholder").textContent;
function showAnalyzing(on, failed) {
  const box = $("sing-analyzing"), ph = $("sing-student-placeholder");
  if (!box) return;
  if (state.analyzingTimer) { clearInterval(state.analyzingTimer); state.analyzingTimer = null; }
  box.hidden = !on;
  const hint = $("sing-analyzing-hint");
  if (hint && on) hint.textContent = analyzingHint();   // 도구를 아직 받는 중이면 그 사정(받은 양)을 말한다
  // 자리 안내와 그 이유는 '부르는 동안'에 대한 말이므로 분석 중에는 치운다.
  if (ph) {
    ph.hidden = on;
    ph.textContent = failed ? "이번에는 곡선을 만들지 못했어요" : SING_PLACEHOLDER;
  }
  const why = $("sing-placeholder-why");
  if (why) why.hidden = on || !!failed;
  if (!on) return;
  const t0 = performance.now();
  const tick = () => {
    const sec = Math.floor((performance.now() - t0) / 1000);
    $("sing-analyzing-sec").textContent = `${sec}초`;
  };
  tick();
  state.analyzingTimer = setInterval(tick, 1000);
}

/* 결과 화면 아래의 설명. 무엇을 어떻게 분석한 결과인지 숨기지 않고 적는다.
   (연구 자료로 쓰려면 화면에 보이는 수치가 어디서 나왔는지 화면 안에서 알 수 있어야 한다) */
function resultNotes(r) {
  const notes = [];
  const src = r.source || {};
  if (state.compareMode) {
    notes.push(`※ 두 곡선 모두 <b>미리 녹음해 둔 가창을 분석한 결과</b>입니다. ` +
      "이 화면은 마이크를 쓰지 않는 예시 비교 화면입니다.");
    return notes;
  }
  if (r.live) {
    notes.push(`분석 시간: 웹페이지 안에서 ${r.elapsed_seconds}초 / 노래가 끝나고 결과까지 ${r.client_roundtrip_seconds}초 (목표 10초 이내)`);
    notes.push(`녹음은 이 컴퓨터 밖으로 보내지 않았어요. 무손실 WAV ${(src.sample_rate / 1000).toFixed(1)}kHz 모노, ` +
      `${src.recording_seconds}초 중 학생 장단 ${(src.student_window_starts_s || []).length}개 구간만 분석했어요.`);
    notes.push(`음고 추정: ${src.f0_model} ${src.f0_variant || ""} (${src.f0_device}) · ` +
      `소리가 잡힌 프레임 ${(src.valid_ratio * 100).toFixed(0)}%`);
    if (src.octave_shift) notes.push(
      `※ 선생님보다 <b>${Math.abs(src.octave_shift)}옥타브 ${src.octave_shift > 0 ? "높은" : "낮은"} 자리</b>에서 불러서, ` +
      `곡선을 ${Math.abs(src.octave_shift * 1200)}cent만큼 옮겨 나란히 놓았습니다. ` +
      `옥타브 안의 음높이 차이는 옮기지 않았으므로 그대로 보입니다.`);
    const latMs = Number.isFinite(src.latency_offset_s) ? Math.round(src.latency_offset_s * 1000) : null;
    const why = (src.latency_auto && src.latency_auto.reason) ? ` — ${src.latency_auto.reason}` : "";
    if (src.latency_method === "auto") notes.push(
      `기기 지연 ${latMs}ms: 이 녹음에 새어 든 장단 소리로 자동으로 재서, 내 소리를 그만큼 당겨 선생님 소리와 맞췄습니다. ` +
      "내가 빠르게·늦게 부른 것은 그대로 남아 있습니다.");
    else if (src.latency_method === "previous") notes.push(
      `※ 이번 녹음에서는 장단 소리로 기기 지연을 재지 못해${why}, 이 브라우저에서 지난번에 잰 ${latMs}ms로 맞췄습니다.`);
    else notes.push(
      `※ 기기 지연을 자동으로 재지 못했습니다${why}. 브라우저가 알려 준 ${latMs}ms만 맞췄으므로 ` +
      "내 곡선이 실제보다 늦게(오른쪽으로) 보일 수 있습니다. 스피커 음량을 조금 올려 다시 불러 보세요.");
    if (state.studentGain > 1.05) notes.push(
      `내 소리가 선생님 소리보다 작아 <b>${state.studentGain.toFixed(1)}배</b> 키워 들려 드립니다` +
      `${state.myLevel ? ` (잰 소리 크기 RMS ${state.myLevel.rms.toFixed(3)})` : ""}. ` +
      `<b>재생 음량만</b> 조절한 것이고 음고 분석에는 영향이 없습니다. 거울 아래 슬라이더로 더 조절할 수 있어요.`);
    if (state.studentGain >= playbackCfg().student_gain_max - 0.01) notes.push(
      `※ 키울 수 있는 한도(${playbackCfg().student_gain_max}배)까지 올렸는데도 선생님 소리보다 작습니다. ` +
      `다음에는 마이크에 조금 더 가까이서, 조금 더 크게 불러 보세요. 지금은 거울 아래 슬라이더로 더 키울 수 있어요.`);
    if (src.recording_truncated) notes.push(
      "※ 녹음이 세 장단을 다 담지 못해 모자란 부분은 빈 곳으로 두었습니다.");
    if (r.expert_dummy) notes.push(
      "※ 내 곡선은 실제 분석 결과지만, <b>선생님 곡선은 아직 임시(더미) 자료</b>입니다. " +
      "이 곡의 전문가 녹음을 분석해 넣기 전까지 두 곡선의 비교는 참고용입니다.");
    return notes;
  }
  notes.push(`분석 시간: ${r.elapsed_seconds}초`);
  if (r.dummy) notes.push("※ 지금 표시된 내 소리 곡선과 안내 문장은 임시(더미) 자료입니다 " +
    "(config.ANALYSIS의 dummy_mode가 켜져 있습니다).");
  return notes;
}

function showResult() {
  const r = state.result, v = state.cfg.viz;
  show("screen-result");
  const meLabel = meLabelText();
  $("result-status").textContent = `소리거울에 선생님 소리와 ${meLabel}를 함께 비췄어요. ▶ 거울 보기를 눌러 보세요.`;
  document.querySelectorAll("#screen-result .who-student")
    .forEach(el => { el.textContent = meLabelText(); });
  setupMirror();

  // 무엇이 같고 무엇이 다른가 — 규칙으로 계산한 관찰 문장(채점 아님)
  const cmp = r.comparison;
  $("compare-box").hidden = !cmp;
  if (cmp) {
    $("compare-list").innerHTML = cmp.summary.map(x => `<li>${x}</li>`).join("");
    $("compare-nums-body").innerHTML = '<div class="num">' +
      Object.entries(cmp.numbers).map(([k, v]) =>
        `${k}: ${Array.isArray(v) ? v.join(" / ") : (typeof v === "object" ? Object.entries(v).map(([a, b]) => `${a} ${b > 0 ? "+" : ""}${b}`).join(", ") : v)}`
      ).join("<br>") + "</div>";
  }

  $("feedback").textContent = r.feedback;
  $("result-note").innerHTML = resultNotes(r).join("<br>");
}

/* ---------------- 소리거울 ---------------- */

/* 박 기준 확대 ----------------
 * [전체] [1장단] [1박] 가운데 하나를 고르면 거울 폭 전체에 그만큼만 크게 보여 준다.
 * 세로(음높이)도 그 범위의 두 곡선에 맞춰 키운다.
 * ◀ ▶ 는 1박 보기에서 한 박씩, 1장단 보기에서 한 장단씩 옮긴다.
 * 재생 중에는 재생선이 보이던 범위를 지나가면 다음 범위로 넘어간다(책장 넘기듯). */
const ZOOM_SIZE = { all: 17, jangdan: 19, bak: 22 };   // 확대할수록 가사 글자도 조금 크게

/** 지금 확대 범위 한 칸의 길이(초). 전체 보기면 null */
function zoomCell() {
  const v = state.mirrorView;
  if (!v || v.mode === "all" || !state.tm) return null;
  return v.mode === "bak" ? bakSeconds() : state.tm.sobak_seconds * state.tm.sobak_per_jangdan;
}
function zoomCount() {
  const c = zoomCell();
  return c ? Math.round(state.tm.total_seconds / c) : 1;
}
/** 지금 확대 범위 {t0, t1, mode}. 전체 보기면 null */
function mirrorWindow() {
  const c = zoomCell();
  if (!c) return null;
  const k = Math.max(0, Math.min(zoomCount() - 1, state.mirrorView.k));
  return { t0: k * c, t1: (k + 1) * c, mode: state.mirrorView.mode };
}
/** 그 범위의 두 곡선에 맞춘 세로 범위(cent). 2~98% 백분위로
 *  잡아, 한두 프레임 튄 값이나 장단 경계에서 뚝 떨어지는 꼬리 때문에 세로가 덜 커지지 않게 한다.
 *  그 밖으로 나간 선은 그림 칸에서 잘린다(값을 바꾸지는 않는다). 위아래로 조금 여유를 둔다. */
function zoomYRange(t0, t1) {
  const vals = [];
  for (const c of [state.expert.curve, state.result.curve]) {
    for (const p of c) if (p.t >= t0 && p.t <= t1 && p.cents !== null) vals.push(p.cents);
  }
  if (!vals.length) { const r = yRange(); return { yMin: r.yMin, yMax: r.yMax }; }
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.02)], hi = vals[Math.min(vals.length - 1, Math.floor(vals.length * 0.98))];
  const span = Math.max(hi - lo, 150), mid = (hi + lo) / 2, pad = span * 0.12 + 20;
  return { yMin: mid - span / 2 - pad, yMax: mid + span / 2 + pad };
}
/** 시각 t 가 든 칸으로 확대 범위를 옮긴다 */
function zoomTo(t) {
  const c = zoomCell();
  if (!c) return;
  state.mirrorView.k = Math.max(0, Math.min(zoomCount() - 1, Math.floor(t / c + 1e-9)));
}
/** 재생 중 책장 넘기기: 재생선이 보이던 범위를 벗어나면(또는 재생을 범위 밖에서 시작하면) 따라간다.
 *  ◀ ▶ 로 다른 범위를 보고 있는 동안에는 재생선이 그 범위에 들어왔다 나갈 때까지 끌고 가지 않는다. */
function zoomFollow(t) {
  const win = mirrorWindow(), v = state.mirrorView;
  if (v.hold) return;              // 거울을 끄는 동안에는 넘기지 않는다(누른 박과 다른 박이 골라진다)
  if (!win) { v.lastT = t; return; }
  const inside = x => x !== null && x !== undefined && x >= win.t0 - 1e-6 && x < win.t1 - 1e-6;
  if (!inside(t) && (v.lastT === null || v.lastT === undefined || inside(v.lastT))) { zoomTo(t); updateZoomUi(); }
  v.lastT = t;
}
function updateZoomUi() {
  const v = state.mirrorView;
  document.querySelectorAll("#mirror-zoom [data-zoom]").forEach(b => b.classList.toggle("on", b.dataset.zoom === v.mode));
  const win = mirrorWindow();
  // 자리는 늘 남겨 둔다 — 좁은 화면에서 ◀▶ 줄이 생겼다 사라지며 거울이 위아래로 밀리지 않게
  $("mirror-zoom-nav").style.visibility = win ? "" : "hidden";
  if (!win) return;
  const k = Math.round(win.t0 / zoomCell());
  $("mirror-zoom-label").textContent = v.mode === "bak" ? bakName(k) : `${k + 1}장단`;
  $("btn-zoom-prev").disabled = k <= 0;
  $("btn-zoom-next").disabled = k >= zoomCount() - 1;
}

function mirrorDraw(tNow) {
  if (!state.result || !state.expert) return;
  const view = mirrorWindow();
  const yr = view ? zoomYRange(view.t0, view.t1) : yRange();
  // 돌려받은 T(가로 위치 → 시각)는 거울을 끌어 구간을 고를 때 쓴다
  state.mirrorGeo = drawMirror($("chart-mirror"), {
    expert: state.expert, student: state.result, timing: state.tm, ...yr,
    colors: { expert: state.cfg.viz.color_expert, student: state.cfg.viz.color_student },
    bridgeGapMs: state.cfg.viz.bridge_gap_ms,
    tNow,
    lyrics: { glyphs: songGlyphs(), size: ZOOM_SIZE[state.mirrorView.mode] || 17, active: !!state.mirror },
    selection: state.loopDraft || state.loop,
    view,
  });
}
function setupMirror() {
  const on = !!(state.result && state.result.curve && state.expert && state.expert.curve);
  $("mirror-wrap").hidden = !on;
  // 앞 곡(또는 앞 판)에서 골라 둔 반복 구간·확대 범위는 새 결과에 맞지 않는다
  state.loop = null; state.loopDraft = null;
  state.mirrorView = { mode: "all", k: 0, lastT: null };
  updateLoopUi();
  updateZoomUi();
  if (!on) return;
  // 장단 표시는 integration 쪽의 새 방식(그림·오선보까지 다루는 buildJangdanView)을 쓰고,
  // 내 소리 음량 표시는 live-pitch 가 새로 넣은 것이라 둘 다 살린다.
  state.mirrorJeonggan = buildJangdanView($("mirror-jeonggan"), state.jd);
  showStudentVol();
  $("mirror-lyric").dataset.line = "";
  if (hasLyrics()) renderLyric($("mirror-lyric"), state.song, sliceSobakBase());
  quietLyricBar();
  mirrorDraw(null);
}
/** 멈춰 있는 거울의 가사 줄: 줄은 보이되 '지금 부르는 글자' 강조와 '다음 ♪'은 끈다 */
function quietLyricBar() {
  $("mirror-lyric").querySelectorAll(".ly.on").forEach(e => e.classList.remove("on"));
  $("mirror-lyric-next").textContent = "";
}
function stopMirror() {
  if (state.mirror) {
    cancelAnimationFrame(state.mirror.raf);
    if (state.mirror.timer) clearInterval(state.mirror.timer);
    state.mirror = null;
  }
  stopBufs();
  if (state.mirrorStop) { state.mirrorStop(); state.mirrorStop = null; }
  updateLoopUi();
  mirrorDraw(null);
  // 위쪽 가사 줄도 멈춘 자리의 글자를 진하게 남겨 두지 않는다. 처음(고른 구간이 있으면 그 시작) 줄로.
  $("mirror-lyric").dataset.line = "";
  if (state.tm && hasLyrics()) renderLyric($("mirror-lyric"), state.song,
    sliceSobakBase() + (state.loop ? state.loop.a / state.tm.sobak_seconds : 0));
  quietLyricBar();
}

/** 재생 중인 거울을 한 프레임 그린다: 곡선·재생선·가사 줄. t = 격자 위 시각(초). */
function mirrorFrame(t) {
  zoomFollow(t);
  mirrorDraw(t);
  if (hasLyrics()) {
    const sob = sliceSobakBase() + t / state.tm.sobak_seconds;
    renderLyric($("mirror-lyric"), state.song, sob);
    // 되풀이하는 동안에는 다음 줄이 오지 않으므로 '다음 ♪'을 비운다
    $("mirror-lyric-next").textContent = (state.mirror && state.mirror.loop) ? "" : lyricNext(state.song, sob);
  }
}

/** 처음부터 끝까지 한 번 */
function playMirrorFull() {
  stopMirror();
  const ctx = ensureAudio();
  const pre = preroll(), dur = state.tm.total_seconds;
  const t0 = ctx.currentTime + 0.25;
  // 셋을 같은 시각에 걸어 두면 장단 격자·가락선·가사가 하나의 시계로 움직인다
  playBuf(state.jangdanBuf, t0, 0, dur, true, "jangdan");
  playBuf(state.expertBuf, t0 - pre, 0, dur + pre, false, "expert");
  // 내가 부른 녹음이 있으면 그것을 튼다. 비교 보기에서만 학습자의 예시 음원을 쓴다.
  const mine = state.myBuf;
  if (mine) playBuf(mine, t0, 0, dur, false, "student");
  else playBuf(state.studentBuf, t0 - pre, 0, dur + pre, false, "student");
  if (state.mirrorJeonggan) state.mirrorStop = animateJeonggan(state.mirrorJeonggan, ctx, t0, state.jd, t0 + dur);
  const tick = () => {
    const t = ctx.currentTime - t0;
    if (t > dur + 0.25) { stopMirror(); return; }
    mirrorFrame(t < 0 ? 0 : Math.min(dur, t));
    state.mirror.raf = requestAnimationFrame(tick);
  };
  state.mirror = { t0, raf: 0, timer: 0 };
  state.mirrorView.lastT = null;
  updateLoopUi();
  tick();
}

/* ---------------- 구간 반복 ----------------
 * 거울 위를 옆으로 끌면 그 구간을 박에 맞춰 잡고, 멈출 때까지 쉬지 않고 되풀이해 들려준다.
 * 선생님 소리·내 소리·장단이 함께 나오고, 아래 체크박스로 하나씩 끌 수 있다(전체 재생과 같다).
 * 박에 맞추는 이유: 반복할 때마다 박 머리에서 다시 시작해야 장단이 어색하게 끊기지 않는다.
 *
 * 소리는 반복 한 번마다 오디오 시계에 미리 걸어 둔다(늘 0.6초 앞까지). <audio> 의 loop 나
 * setTimeout 으로 다시 틀면 이음매마다 수십 ms씩 밀려 장단이 흔들린다. */

/** 1박의 길이(초) */
function bakSeconds() { return state.tm.sobak_seconds * state.tm.sobak_per_bak; }

/** 끈 범위(초)를 가장 가까운 박 경계로 맞춘다.
 *  두 끝이 같은 경계로 모이면(한 박 안에서 짧게 끈 경우) 끈 범위의 가운데가 든 박 하나를 고른다.
 *  (전에는 늘 경계 뒤 박을 골라, 박의 뒤쪽 절반을 끌면 끈 곳이 아닌 다음 박이 반복됐다) */
function loopFromDrag(tA, tB) {
  const B = bakSeconds(), total = state.tm.total_seconds;
  const nBak = Math.round(total / B);
  let a = Math.round(Math.min(tA, tB) / B), b = Math.round(Math.max(tA, tB) / B);
  a = Math.max(0, Math.min(nBak, a)); b = Math.max(0, Math.min(nBak, b));
  if (b <= a) {
    const k = Math.max(0, Math.min(nBak - 1, Math.floor((tA + tB) / 2 / B)));
    a = k; b = k + 1;
  }
  return { a: a * B, b: b * B };
}

/** 박 번호(0부터)를 "2장단 3박"으로 */
function bakName(k) {
  const perJ = state.tm.sobak_per_jangdan / state.tm.sobak_per_bak;
  return `${Math.floor(k / perJ) + 1}장단 ${(k % perJ) + 1}박`;
}

/** 고른 구간을 사람이 읽는 말로. 끝은 '그 박까지'(끝 경계 바로 앞 박)로 적는다. */
function loopLabel(sel) {
  const B = bakSeconds();
  const ka = Math.round(sel.a / B), kb = Math.round(sel.b / B) - 1;
  return ka === kb ? `${bakName(ka)} 한 박` : `${bakName(ka)} ~ ${bakName(kb)}`;
}

/** 반복용 한 토막을 when 에 건다. 이음매에서 '틱' 소리가 나지 않게 앞뒤 6ms를 살짝 올리고 내린다.
 *  wrap = 버퍼 끝에서 처음으로 돌아가며 잇는다(장단 반주 — 파일 길이가 장단의 배수다). */
function playSlice(buf, when, offset, dur, tag, wrap) {
  if (!buf || dur <= 0) return null;
  if (wrap) offset = ((offset % buf.duration) + buf.duration) % buf.duration;
  else {
    if (offset < 0) { when -= offset; dur += offset; offset = 0; }   // 녹음 맨 앞보다 앞은 비워 둔다
    if (dur <= 0 || offset >= buf.duration) return null;            // 녹음이 거기까지 없다
  }
  const ctx = ensureAudio();
  const s = ctx.createBufferSource();
  s.buffer = buf; s.loop = !!wrap;
  const env = ctx.createGain(), g = ctx.createGain();
  const f = Math.min(0.006, dur / 4);
  env.gain.setValueAtTime(0, when);
  env.gain.linearRampToValueAtTime(1, when + f);
  env.gain.setValueAtTime(1, when + dur - f);
  env.gain.linearRampToValueAtTime(0, when + dur);
  g.gain.value = trackGain(tag);            // 음소거·음량은 이 마디가 맡는다(refreshGains 가 바꾼다)
  s.connect(env).connect(g).connect(ctx.destination);
  s.start(when, offset);
  s.stop(when + dur);
  s._gain = g; s._tag = tag;
  state.playing.push(s);
  // 오래 반복하면 끝난 토막이 쌓인다. 끝나면 목록에서 뺀다.
  s.onended = () => { const i = state.playing.indexOf(s); if (i >= 0) state.playing.splice(i, 1); };
  return s;
}

/** 고른 구간을 멈출 때까지 되풀이한다 */
function playMirrorLoop() {
  const sel = state.loop;
  stopMirror();
  if (!sel) return;
  const ctx = ensureAudio();
  const pre = preroll(), L = sel.b - sel.a;
  // 이음매를 박 선보다 12ms 앞에 둔다. 장구 타점은 박 선보다 몇 ms 먼저 울리기 시작하기도 해서
  // (금다래꿍 반주), 박 선에서 자르면 첫 타점의 머리가 잘리거나 페이드에 묻혀 무뎌진다.
  // 네 소리를 똑같이 당기므로 서로의 어긋남은 없다. 화면(재생선)은 12ms 차이라 그대로 둔다.
  const SEAM = 0.012;
  const T0 = ctx.currentTime + 0.15;
  let n = 0;                                    // 다음에 걸 반복 번호
  const schedule = () => {
    while (T0 + n * L < ctx.currentTime + 0.6) {
      let T = T0 + n * L - SEAM, from = sel.a - SEAM, len = L;
      // 화면이 잠깐 멈춰(다른 탭 등) 시각이 이미 지났으면, 지난 만큼 건너뛰고 지금부터 이어 튼다.
      // 브라우저는 늦게 건 소리를 앞당겨 주지 않아서, 그대로 걸면 그 한 바퀴만 박이 밀린다.
      const late = ctx.currentTime + 0.005 - T;
      if (late >= len) { n++; continue; }
      if (late > 0) { T += late; from += late; len -= late; }
      // 음원마다 격자 0초가 파일의 어디인지가 다르다: 선생님·예시 음원은 앞여유(pre)가 있고,
      // 내 녹음은 서버가 분석한 구간 그대로 잘라 붙였으므로 없다(전체 재생과 같은 셈).
      playSlice(state.jangdanBuf, T, from, len, "jangdan", true);
      playSlice(state.expertBuf, T, from + pre, len, "expert");
      if (state.myBuf) playSlice(state.myBuf, T, from, len, "student");
      else playSlice(state.studentBuf, T, from + pre, len, "student");
      n++;
    }
  };
  const posAt = el => sel.a + (((el % L) + L) % L);        // 지난 시간 → 구간 안의 격자 시각
  schedule();
  if (state.mirrorJeonggan) {
    state.mirrorStop = animateJeonggan(state.mirrorJeonggan, ctx, T0, state.jd, undefined, posAt);
  }
  const tick = () => {
    const el = ctx.currentTime - T0;
    mirrorFrame(el < 0 ? sel.a : posAt(el));
    state.mirror.raf = requestAnimationFrame(tick);
  };
  // 예약은 화면 그리기와 떼어 둔다. 화면이 잠깐 멈춰도(다른 탭 등) 소리는 이어지게.
  state.mirror = { t0: T0, raf: 0, timer: setInterval(schedule, 100), loop: true };
  state.mirrorView.lastT = null;
  updateLoopUi();
  tick();
}

/** 반복 구간을 지운다. 재생 중이면 멈추고, 멈춰 있어도 거울·가사 줄을 처음 화면으로 되돌린다.
 *  (구간이 있는 동안 재생은 늘 반복 재생이므로 여기서 멈춰도 전체 재생을 끊는 일은 없다) */
function clearLoop() {
  state.loop = null; state.loopDraft = null;
  stopMirror();
}

/** 재생 단추 글자와 '반복 구간' 안내를 지금 상태에 맞춘다 */
function updateLoopUi() {
  const btn = $("btn-mirror-play");
  const playing = !!state.mirror;
  btn.textContent = playing ? "■ 멈추기" : (state.loop ? "▶ 구간 반복 듣기" : "▶ 거울 보기");
  btn.classList.toggle("active", playing);
  $("mirror-loop").hidden = !state.loop;
  if (state.loop) $("mirror-loop-label").textContent = `🔁 ${loopLabel(state.loop)}`;
}

$("btn-mirror-play").onclick = () => {
  if (state.mirror) { stopMirror(); return; }
  if (state.loop) playMirrorLoop(); else playMirrorFull();
};
$("btn-loop-clear").onclick = () => clearLoop();

/* 확대 단추. 확대 범위를 고를 때는 지금 보고 있던 자리(재생 중이면 재생선, 구간이 있으면 그 시작,
 * 이미 확대해 있으면 그 범위의 처음)가 든 칸으로 간다. */
document.querySelectorAll("#mirror-zoom [data-zoom]").forEach(b => {
  b.onclick = () => {
    const v = state.mirrorView, before = mirrorWindow();
    const anchor = state.mirror && v.lastT !== null && v.lastT !== undefined ? v.lastT
      : (before ? before.t0 : (state.loop ? state.loop.a : 0));
    v.mode = b.dataset.zoom;
    zoomTo(anchor);
    v.lastT = state.mirror ? anchor : null;
    updateZoomUi();
    if (!state.mirror) mirrorDraw(null);
  };
});
const zoomStep = d => {
  const v = state.mirrorView;
  if (!mirrorWindow()) return;
  v.k = Math.max(0, Math.min(zoomCount() - 1, v.k + d));
  updateZoomUi();
  if (!state.mirror) mirrorDraw(null);
};
$("btn-zoom-prev").onclick = () => zoomStep(-1);
$("btn-zoom-next").onclick = () => zoomStep(1);

/* 거울 위에서 끌기. 마우스·손가락 모두 받는다(pointer 이벤트).
 * 6px 넘게 움직여야 '끌기'로 본다 — 그보다 작으면 한 번 누른 것이고, 고른 구간을 지운다. */
(() => {
  const cv = $("chart-mirror");
  let drag = null;
  const tAt = ev => {
    const r = cv.getBoundingClientRect();
    return state.mirrorGeo ? state.mirrorGeo.T(ev.clientX - r.left) : 0;
  };
  cv.addEventListener("pointerdown", ev => {
    if (!state.mirrorGeo || ev.button > 0) return;
    drag = { x0: ev.clientX, t0: tAt(ev), moved: false };
    state.mirrorView.hold = true;            // 끄는 동안 확대 화면이 넘어가지 않게
    try { cv.setPointerCapture(ev.pointerId); } catch (e) { /* 이미 놓친 포인터 */ }
  });
  cv.addEventListener("pointermove", ev => {
    if (!drag) return;
    if (!drag.moved && Math.abs(ev.clientX - drag.x0) < 6) return;
    drag.moved = true;
    state.loopDraft = loopFromDrag(drag.t0, tAt(ev));
    if (!state.mirror) mirrorDraw(null);        // 재생 중이면 다음 프레임이 그린다
  });
  cv.addEventListener("pointerup", ev => {
    state.mirrorView.hold = false;
    if (!drag) return;
    const d = drag; drag = null;
    if (d.moved) {
      state.loop = loopFromDrag(d.t0, tAt(ev));
      state.loopDraft = null;
      playMirrorLoop();                         // 고르자마자 되풀이해 들려준다
    } else if (state.loop) {
      clearLoop();
    }
  });
  cv.addEventListener("pointercancel", () => {
    drag = null; state.loopDraft = null; state.mirrorView.hold = false;
    if (!state.mirror) mirrorDraw(null);
  });
})();
for (const [id, tag] of [["mix-expert", "expert"], ["mix-student", "student"], ["mix-jangdan", "jangdan"]]) {
  $(id).onchange = e => setMute(tag, !e.target.checked);
}
/** 내 소리 음량 슬라이더 — 자동으로 맞춘 배수에 사람이 더 곱한다 */
function showStudentVol() {
  const total = (state.studentGain || 1) * state.studentVol;
  $("mix-student-vol-val").textContent = `총 ×${total.toFixed(1)}`;
  $("mix-student-vol-val").title =
    `자동 맞춤 ×${(state.studentGain || 1).toFixed(1)} × 슬라이더 ×${state.studentVol.toFixed(1)}`;
}
$("mix-student-vol").oninput = e => {
  state.studentVol = +e.target.value;
  showStudentVol();
  refreshGains();
};

$("btn-again").onclick = () => { stopMirror(); startSing(state.compareMode); };
$("btn-other").onclick = () => { stopMirror(); stopIntroLoop(); show("screen-select"); $("topbar-song").textContent = ""; };
/** 곡 선택 화면으로 돌아간다. 돌고 있는 것(거울 재생·장구·애니메이션·마이크)을 모두 멈춘다.
 *  상단바의 '소리거울' 글자와 '← 처음으로' 버튼이 같이 쓴다. */
function goHome() {
  stopMirror(); stopIntroLoop();
  if (state.raf) cancelAnimationFrame(state.raf); if (state.janggu) state.janggu.stop();
  if (state.mic) { try { state.mic.stop(); } catch (e) { /* 이미 멈춤 */ } state.mic = null; }
  state.singing = false;
  state.singRun = (state.singRun || 0) + 1;   // 기다리던 분석이 있으면 그 결과·오류는 버린다(finishSing)
  state.held = null;                          // 들고 있던 녹음도 놓는다(다시 분석하지 않는다)
  $("btn-retry-analyze").hidden = true;
  showAnalyzing(false);
  // 안내 음성은 <audio> 태그라 stopIntroLoop()의 stopBufs()(AudioBuffer 전용)에 걸리지 않는다.
  // 여기서 따로 멈추지 않으면 곡 선택 화면으로 돌아간 뒤에도 곡 소개가 계속 들린다.
  if (state.introAudio) state.introAudio.pause();
  show("screen-select"); $("topbar-song").textContent = "";
}
$("btn-home").onclick = goHome;
$("btn-back").onclick = goHome;
window.addEventListener("resize", () => {
  if ($("screen-result").hidden || !state.result) return;
  if (!state.mirror) mirrorDraw(null);
});

init();
