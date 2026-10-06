/*
 * analyzer.js — 분석 일꾼(analyzer-worker.js)의 화면 쪽 창구 (pesto-onnx 브랜치)
 * ===========================================================================
 * 일꾼이 무거운 일을 하는 동안 화면은 멈추지 않는다.
 *   Analyzer.prepare({sampleRate})   분석 도구를 미리 받아 띄워 둔다(실행기 약 30MB, 두 번째부터는 브라우저 캐시).
 *                                    app.js는 곡을 열어 그 곡의 음원을 다 받은 뒤에 부른다(음원이 먼저 오게).
 *   Analyzer.analyze({wav, songId, timing, expert, sampleRate})
 *        → 서버(server/main.py의 analyze)와 같은 모양의 결과. 녹음(wav)은 일꾼에게 넘길 뿐 어디에도 보내지 않는다.
 *        분석할 수 없는 녹음이면 err.analysisError = true (파이썬이 쓴 한국어 이유가 err.message)
 *        선생님 결과는 일꾼이 data/expert/{곡}.json 글자를 그대로 파이썬에 넘긴다(서버처럼). 준비 때 곡마다 한 번 받아 두고,
 *        분석 때는 다시 받지 않는다. expert는 그 파일을 못 받았을 때만 쓴다(끊김·8초 넘음·선생님 결과 JSON이 아님).
 *   Analyzer.status / Analyzer.onStatus(fn)   준비가 어디까지 왔는지(받은 바이트, 다시 시도, 실패 갈래). 화면 안내에 쓴다.
 *   Analyzer.unsupported()   이 기기·브라우저로는 분석 도구를 못 돌리면 그 이유(아니면 null). 받기 전에 바로 안다.
 *   주소 끝에 ?threads=1 을 붙이면 한 스레드로 돈다(속도 비교용).
 * makeAnalyzer(일꾼 주소)는 같은 창구를 하나 더 만든다. 검사 도구가 틀린 주소로 실패 경로를 볼 때 쓴다.
 *
 * 준비가 느릴 때와 멈췄을 때를 가른다(2026-10-06). 예전에는 첫 화면부터 2분을 재서 넘으면 일꾼을 끝냈다. 그러면 느린
 * 학교망에서 받고 있던 절반이 버려지고, 다음 시도도 처음부터 받아 기기당 약 1Mbps 이하에서는 끝내 받지 못했다.
 *   - 일꾼은 받은 바이트·단계를 수시로 알린다. 그 소식이 STALL_MS 동안 끊길 때만 '멈춤'으로 보고 일꾼을 끝낸다.
 *     느리더라도 받고 있으면 얼마가 걸리든 기다린다(화면은 받은 양을 보여 준다).
 *   - 준비가 어떤 이유로든 실패하면 그 일꾼을 끝내고 새 일꾼으로 다시 한다. onnxruntime-web은 같은 일꾼 안에서 한 번
 *     실패한 준비를 기억해 다시 하지 않기 때문이다(예전에는 '2분 넘음'일 때만 새 일꾼을 띄워, 첫 화면에서 한 번 끊기면
 *     그 페이지에서는 몇 번을 다시 불러도 같은 오류가 났다). 다시 해도 같을 실패 — 사이트에 파일이 없음(missing),
 *     이 기기로는 못 돌림(device) — 는 다시 하지 않는다. 그 밖에는 AUTO_RETRY_MS만큼 쉬고 저절로 다시 한다.
 * 실패는 언제나 거절된 Promise로 알린다(err.kind: network·missing·device·stalled·crashed·worker·other).
 * tests/test_analyzer_js.py가 node로 검사한다.
 */
function makeAnalyzer(workerUrl) {
  const STALL_MS = 60000;                       // 준비 중 일꾼에게서 이만큼 아무 소식이 없으면 멈춘 것으로 본다
  const AUTO_RETRY_MS = [3000, 10000, 30000];   // 준비가 실패하면 이만큼 쉬고 새 일꾼으로 다시(세 번까지)
  const PROBE_MS = 5000;                        // 일꾼 파일이 사이트에 있는지 물어보는 데 주는 시간
  // 이 브라우저가 실행기를 돌릴 수 있는가. onnxruntime-web은 WebAssembly SIMD가(아래 바이트는 그 라이브러리가 쓰는 검사
  // 그대로), Pyodide는 WebAssembly 예외 처리(try/catch)가 있어야 돈다. 없으면 약 30MB를 받은 뒤에야 실패한다
  // (예: iPadOS 16.4보다 낮은 iPad의 Safari). 받기 전에 바로 알아본다.
  const SIMD_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 30, 1, 28, 0, 65, 0,
    253, 15, 253, 12, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 253, 186, 1, 26, 11]);
  const EH_PROBE = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25,
    11, 11]);
  const RETRYABLE = kind => kind !== "missing" && kind !== "device";
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  let worker = null, seq = 0, started = false, watchdog = 0;
  let preparing = null, readyInfo = null, failedBefore = false;   // failedBefore: 이 페이지에서 준비가 끝내 실패한 적이 있다
  let status = { phase: "idle" };
  const waiting = new Map(), listeners = new Set();

  function failure(message, kind, extra) {
    return Object.assign(new Error(message), { kind }, extra || {});
  }
  function setStatus(s) {
    status = s;
    for (const fn of listeners) {
      try { fn(status); } catch (e) { console.error("[소리거울] 분석 도구 상태 알림 오류", e); }
    }
  }
  function failAll(err) {
    for (const w of waiting.values()) w.reject(err);
    waiting.clear();
  }
  function stopWatchdog() {
    clearTimeout(watchdog);
    watchdog = 0;
  }
  /** 일꾼을 끝내고 처음 상태로 되돌린다. 다음 일은 새 일꾼으로 처음부터 한다. */
  function reset(err) {
    stopWatchdog();
    if (worker) { try { worker.terminate(); } catch (x) { /* 이미 멈춤 */ } }
    worker = null; started = false; readyInfo = null;
    if (status.phase === "ready") setStatus({ phase: "idle" });   // 준비가 끝난 뒤에 멈춘 일꾼 — 다음 일이 새로 준비한다
    failAll(err);
  }
  function armWatchdog() {
    stopWatchdog();
    watchdog = setTimeout(() => reset(failure(
      `분석 도구가 ${STALL_MS / 1000}초 동안 아무 진행이 없어 멈춘 것으로 보고 다시 시작합니다`, "stalled")), STALL_MS);
  }
  /** 일꾼의 진행 소식 → status. step은 받은 양으로 정한다: 다 받기 전이면 "download", 아니면 "start"(띄우는 중).
   *  일꾼은 파이썬을 먼저 띄우고 음고 실행기를 마저 받기도 해서, 일꾼이 붙인 단계를 그대로 쓰면 화면 문구가 오락가락한다. */
  function onProgress(m) {
    if (readyInfo || status.phase !== "loading") return;
    const s = { ...status };
    if (m.phase === "download") Object.assign(s, { loaded: m.loaded, total: m.total, retry: m.retry || s.retry || null });
    s.step = (s.total && s.loaded < s.total) ? "download" : "start";
    setStatus(s);
  }
  function start() {
    if (worker) return worker;
    const v = encodeURIComponent(window.__V || "");
    const url = `${workerUrl}?v=${v}`;
    let w;
    try {
      w = new Worker(url, { type: "module" });
    } catch (e) {
      // 올리는 곳의 보안 정책(일꾼 금지)·잘못된 주소면 그 자리에서 예외가 난다. 실패로 알린다.
      throw failure(`분석 일꾼을 띄우지 못했어요 (${(e && e.message) || e})`, "worker");
    }
    worker = w;
    w.onmessage = e => {
      if (w !== worker) return;                  // 이미 끝낸 일꾼의 늦은 소식
      const m = e.data || {};
      started = true;
      if (watchdog) armWatchdog();               // 소식이 왔다 — 멈추지 않았다
      if (m.type === "hello") return;
      if (m.type === "progress") { onProgress(m); return; }
      const p = waiting.get(m.id);
      if (!p) return;
      waiting.delete(m.id);
      if (m.ok) p.resolve(m);
      else p.reject(failure(m.error || "알 수 없는 오류", m.kind || "other", { stage: m.stage }));
    };
    w.onerror = e => {
      // 모듈을 못 불러온 경우(파일 없음·오래된 브라우저)와, 돌다가 잡히지 않은 오류로 멈춘 경우가 여기로 온다.
      if (e && e.preventDefault) e.preventDefault();
      if (w !== worker) return;
      const why = (e && e.message) || "";
      if (started) {
        reset(failure(`분석 일꾼이 멈췄어요 (${why || "오류"})`, "crashed"));
        return;
      }
      // 일꾼 파일을 사이트에서 아예 못 찾는 것인지(다시 해도 같다) 물어본다. 대답이 없으면 인터넷 쪽으로 본다.
      const msg = `분석 일꾼을 띄우지 못했어요 (${why || "모듈을 불러오지 못함"})`;
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), PROBE_MS);
      Promise.resolve()
        .then(() => fetch(url, { method: "HEAD", cache: "no-store", signal: ctl.signal }))
        .then(r => (r.status === 404 || r.status === 403 || r.status === 410) ? "missing" : "worker", () => "network")
        .then(kind => { clearTimeout(t); if (w === worker) reset(failure(msg, kind)); });
    };
    return w;
  }
  function call(type, payload, transfer) {
    // 일꾼 띄우기·보내기가 그 자리에서 예외를 던져도 거절된 Promise로 돌려준다. 예외가 그대로 새면
    // 화면(app.js)의 그 자리 코드가 멈춘다.
    return new Promise((resolve, reject) => {
      const w = start(), id = ++seq;
      waiting.set(id, { resolve, reject });
      try { w.postMessage({ id, type, ...payload }, transfer || []); }
      catch (e) { waiting.delete(id); throw e; }
    });
  }
  const urlThreads = +(new URLSearchParams(location.search).get("threads") || 0) || undefined;

  /** 이 기기·브라우저로는 실행기를 못 돌리면 그 이유(개발자용 한 줄), 돌릴 수 있으면 null. */
  function unsupported() {
    if (typeof Worker !== "function") return "이 브라우저에는 Web Worker가 없어요";
    if (typeof WebAssembly !== "object" || typeof WebAssembly.validate !== "function") {
      return "이 브라우저에는 WebAssembly가 없어요";
    }
    try {
      if (!WebAssembly.validate(SIMD_PROBE)) return "이 브라우저는 WebAssembly SIMD를 지원하지 않아요(onnxruntime-web에 필요)";
      if (!WebAssembly.validate(EH_PROBE)) return "이 브라우저는 WebAssembly 예외 처리를 지원하지 않아요(Pyodide에 필요)";
    } catch (e) {
      return `WebAssembly 기능을 확인하지 못했어요 (${(e && e.message) || e})`;
    }
    return null;
  }

  /** 한 번 준비해 본다(일꾼 하나). 소식이 STALL_MS 동안 끊기면 멈춘 것으로 보고 끝낸다. */
  async function attempt(opts, n) {
    // again: 처음 받는 것이 아니다(앞 시도가 실패했다) — 화면이 '(처음 한 번만)' 대신 '다시 받는 중'이라고 쓰게
    setStatus({ phase: "loading", step: "start", loaded: 0, total: 0, attempt: n, again: n > 0 || failedBefore, retry: null });
    armWatchdog();
    try {
      return (await call("prepare", opts)).info;
    } finally {
      stopWatchdog();
    }
  }

  async function prepareLoop(opts) {
    const bad = unsupported();
    if (bad) {
      const e = failure(bad, "device");
      setStatus({ phase: "failed", kind: e.kind, message: e.message });
      throw e;
    }
    for (let n = 0; ; n++) {
      try {
        readyInfo = await attempt(opts, n);
        setStatus({ phase: "ready", info: readyInfo });
        return readyInfo;
      } catch (e) {
        if (!e.kind) e.kind = "other";
        // 어떤 실패든 그 일꾼은 끝낸다 — 같은 일꾼에게 다시 시키면 onnxruntime-web은 첫 실패를 그대로 돌려준다.
        reset(e);
        if (!RETRYABLE(e.kind) || n >= AUTO_RETRY_MS.length) {
          failedBefore = true;
          setStatus({ phase: "failed", kind: e.kind, message: e.message });
          throw e;
        }
        const wait = AUTO_RETRY_MS[n];
        console.warn(`[소리거울] 분석 도구 준비 실패(${e.kind}) — ${wait / 1000}초 뒤 새 일꾼으로 다시 합니다: ${e.message}`);
        setStatus({ phase: "waiting", kind: e.kind, message: e.message, attempt: n + 1, waitMs: wait });
        await sleep(wait);
      }
    }
  }

  const api = {
    /** 분석 도구를 준비한다. 이미 준비 중이면 그 준비를, 끝났으면 그 결과를 돌려준다. 실패한 뒤에 부르면 처음부터 다시 한다. */
    prepare(opts = {}) {
      if (readyInfo) return Promise.resolve(readyInfo);
      if (!preparing) {
        const o = { threads: urlThreads, ...opts };
        preparing = prepareLoop(o).finally(() => { preparing = null; });
      }
      return preparing;
    },
    get ready() { return !!readyInfo; },
    get info() { return readyInfo; },
    get status() { return status; },
    /** 준비 상태가 바뀔 때마다 fn(status)를 부른다. 돌려준 함수를 부르면 그만 듣는다. */
    onStatus(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    unsupported,
    async analyze({ wav, songId, timing, expert, sampleRate }) {
      await api.prepare({ sampleRate });
      const m = await call("analyze", { wav, songId, timing, expert, sampleRate }, [wav.buffer]);
      if (m.result && m.result.error) throw Object.assign(new Error(m.result.error), { analysisError: true });
      m.result.worker_seconds = m.worker_seconds;
      return m.result;
    },
  };
  return api;
}
const Analyzer = makeAnalyzer("analyzer-worker.js");
