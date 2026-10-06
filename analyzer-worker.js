/*
 * analyzer-worker.js — 웹페이지 안에서 음고를 재고 판정하는 일꾼 (pesto-onnx 브랜치)
 * ==================================================================================
 * 화면(app.js)이 멈추지 않도록 무거운 일은 전부 여기서 한다. analyzer.js가 이 일꾼을 띄운다.
 *
 *   ① Pyodide(웹페이지 안 파이썬)를 올리고, 저장소의 파이썬 파일(config.py, pitch.py, server/*.py)을
 *      가상 파일시스템에 그대로 쓴다. 구간 자르기·판정·안내 문장은 서버와 **같은 파일**이 만든다.
 *   ② onnxruntime-web으로 PESTO(ONNX)를 올린다. 창 자르기와 CQT 필터는 파이썬(server/pesto_web.py)이
 *      만들고, 여기서는 신경망 계산만 돌린다(runCore).
 * 녹음은 이 일꾼 밖으로 나가지 않는다. 어디에도 보내지 않는다.
 *
 * 분석 도구 받기(2026-10-06): 큰 실행기 파일 넷(약 29MB, py/manifest.json의 preload)은 이 일꾼이 직접 받는다.
 *   - 받은 바이트 수를 화면에 알린다(progress). 느린 학교망에서도 '받고 있다'를 보여 주고, 화면(analyzer.js)은
 *     '느리지만 받는 중'과 '멈춤'을 가른다. 예전에는 화면이 첫 화면부터 2분을 재서, 느리게 받고 있던 일꾼까지
 *     끝내 버렸다(기기당 약 1Mbps 이하에서는 몇 번을 다시 해도 끝내 받지 못했다).
 *   - 받는 중 STALL_MS 동안 한 바이트도 오지 않으면 끊고 다시 받는다. 올리는 곳이 이어받기(Range)를 해 주면
 *     받은 데서부터 잇는다. 404처럼 다시 해도 안 될 오류는 곧바로 실패로 알린다(kind "missing").
 *   - 받은 파일은 Pyodide에는 fetch를 가로채 넘기고(pyodide.asm.wasm·python_stdlib.zip·numpy 휠),
 *     onnxruntime-web에는 env.wasm.wasmBinary로 넘긴다. 둘에게 직접 받게 두면 안 되는 이유:
 *     Pyodide 314는 wasm을 받다 끊기면 콘솔 경고만 남기고 영영 기다리고(실패도 성공도 알리지 않는다),
 *     onnxruntime-web은 같은 일꾼 안에서 한 번 실패한 준비를 기억해 다시 하지 않는다.
 *   실패는 갈래(kind)를 붙여 화면에 알린다: network(인터넷) / missing(사이트에 파일 없음) / device(이 기기·브라우저로는
 *   못 돌림) / other. 화면은 갈래로 문구와 '새 일꾼으로 다시 해 볼지'를 정한다(analyzer.js).
 *
 * 여러 스레드: 페이지가 교차 출처 격리(COOP/COEP 헤더) 상태일 때만 쓸 수 있다. 아니면 한 스레드로 돈다
 * (같은 결과. 신경망 계산만 재면 약 3.4배, 분석 전체로는 약 2.7배 느림 — 이 맥 실측). tools/static_server.py가 헤더를 붙인다.
 * 분석은 한 번에 하나씩 줄을 세운다. 같은 신경망 세션을 두 분석이 동시에 돌리면 깨진다.
 */
const V = new URL(import.meta.url).searchParams.get("v") || "";
const here = p => new URL(p, import.meta.url);
const versioned = p => { const u = here(p); if (V) u.searchParams.set("v", V); return u.href; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// 이 일꾼이 직접 하는 받기는 늘 원래 fetch로 한다. Pyodide를 띄우는 동안 self.fetch를 가로채 두는데(serveFromMemory),
// 끊겨서 다시 받는 요청이 가로챈 쪽으로 가면 제 자신을 기다리게 된다.
const netFetch = self.fetch.bind(self);

let ort = null, loadPyodide = null;   // 실행기 모듈. 준비할 때 불러온다 — 못 불러오면 그 이유로 실패를 알릴 수 있게
let ready = null;                 // 준비 Promise. 실패하면 null로 돌린다(화면은 실패한 일꾼을 끝내고 새 일꾼을 띄운다)
let queue = Promise.resolve();    // 분석 줄
let py = null, web = null, session = null, info = null;
const EXPERT_TIMEOUT_MS = 8000;   // 선생님 결과 파일(곡마다 25~62KB) 하나를 받는 데 주는 시간. 넘으면 끊고 화면이 넘긴 것을 쓴다
const STALL_MS = 30000;           // 실행기 파일을 받는 중 이만큼 한 바이트도 오지 않으면 끊고 다시 받는다
const RETRY_WAIT_MS = [1000, 3000, 8000];   // 파일 하나를 다시 받기 전에 쉬는 시간(처음 받기 + 세 번 더)
const PROGRESS_EVERY_MS = 250;    // 받은 바이트 수를 화면에 알리는 간격(가장 짧게)
const expertTexts = new Map();    // 곡 → Promise<선생님 결과 JSON 글자 | null>. 받기에 실패한 곡은 지워, 다음 분석이 한 번 더 받아 본다

/** 갈래(kind)가 붙은 실패. 화면이 문구와 다시 시도할지를 이것으로 정한다. */
function fail(message, kind, cause) {
  return Object.assign(new Error(message), { kind, cause });
}

/** 화면에 넘길 오류 한 줄. 파이썬 오류(Pyodide의 PythonError)는 message가 traceback 전체라 첫 줄이
 *  'Traceback (most recent call last):'이고 실제 이유('ValueError: …')는 끝에 있다. 예외 이름이 붙은 마지막 줄을
 *  넘긴다 — Pyodide가 그 뒤에 덧붙이는 안내 줄('See https://pyodide.org/…')은 이유가 아니다.
 *  전체는 이 일꾼의 콘솔(개발자 도구)에 남겨 되짚을 수 있게 한다. */
function describe(e) {
  const msg = String((e && e.message) || e);
  if (!((e && e.name === "PythonError") || msg.startsWith("Traceback"))) return msg;
  console.error("[소리거울] 분석 일꾼 안 파이썬 오류(전체):\n" + msg);
  const lines = msg.split("\n").map(s => s.trim()).filter(Boolean);
  const named = lines.filter(l => /^[A-Za-z_][\w.]*(Error|Exception|Exit|Interrupt)\b/.test(l));
  return named[named.length - 1] || lines[lines.length - 1] || msg;
}

const GONE = [404, 403, 410];     // 다시 해도 같은 응답(파일이 사이트에 없음·막힘)

async function getOk(url, as) {
  const name = new URL(url).pathname;
  let r;
  try {
    r = await netFetch(url);
  } catch (e) {
    throw fail(`파일을 받지 못했어요: ${name} (${describe(e)})`, "network", e);
  }
  if (!r.ok) throw fail(`파일을 받지 못했어요: ${name} (${r.status})`, GONE.includes(r.status) ? "missing" : "network");
  try {
    return as === "json" ? await r.json() : await r.text();
  } catch (e) {
    throw fail(`파일을 받다가 끊겼어요: ${name} (${describe(e)})`, "network", e);
  }
}

/** 시간 제한이 있는 받기(글자). 제한을 넘기면 끊는다 — 응답을 기다리는 중이든 본문을 받는 중이든. */
async function getTextWithin(url, ms) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error(`${ms / 1000}초 안에 받지 못했어요`)), ms);
  try {
    const r = await netFetch(url, { signal: ctl.signal });
    if (!r.ok) throw new Error(`파일을 받지 못했어요: ${new URL(url).pathname} (${r.status})`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

/* ---------------- 큰 실행기 파일 받기 ---------------- */

let lastProgressAt = 0;
/** 준비가 어디까지 왔는지 화면에 알린다. force가 아니면 PROGRESS_EVERY_MS에 한 번만. 화면은 이 소식으로 '멈춤'을 가른다. */
function progress(p, force) {
  const now = Date.now();
  if (!force && now - lastProgressAt < PROGRESS_EVERY_MS) return;
  lastProgressAt = now;
  self.postMessage({ type: "progress", ...p });
}

function contentRangeStart(r) {
  const m = /^bytes\s+(\d+)-/i.exec(r.headers.get("Content-Range") || "");
  return m ? +m[1] : -1;
}
/** 이어받기에 쓸 검증값. 약한 ETag(W/…)는 If-Range에 쓸 수 없어 날짜를 쓴다. */
function strongValidator(r) {
  const etag = r.headers.get("ETag");
  return (etag && !etag.startsWith("W/")) ? etag : r.headers.get("Last-Modified");
}
function joinChunks(parts, n) {
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out.buffer;
}

/** url을 받아 ArrayBuffer로 돌려준다. 받은 바이트를 onBytes(늘어난 수)로 알린다(처음부터 다시 받으면 음수).
 *  - STALL_MS 동안 한 바이트도 오지 않으면 끊고, 조금 쉬었다 다시 받는다(RETRY_WAIT_MS의 길이만큼 더).
 *  - 올리는 곳이 이어받기를 해 주면(Accept-Ranges: bytes, 압축 없이, 검증값 있음) 받은 데서부터 잇는다.
 *    아니면(이 저장소의 static_server.py처럼) 처음부터 다시 받는다.
 *  - 404·403·410은 다시 해도 같으므로 곧바로 실패(kind "missing"). 그 밖에는 다 써 본 뒤 실패(kind "network").
 *  - bytes(사이트를 만들 때 적은 크기)와 받은 크기가 다르면 받다 끊긴 것으로 보고 다시 받는다. */
async function download(url, bytes, onBytes, onRetry) {
  const name = new URL(url).pathname.split("/").pop();
  let parts = [], got = 0, validator = null, resumable = false, last = null;
  const restart = () => { if (got) onBytes(-got); parts = []; got = 0; };
  for (let attempt = 0; attempt <= RETRY_WAIT_MS.length; attempt++) {
    if (attempt) {
      onRetry(name, attempt, last);
      await sleep(RETRY_WAIT_MS[attempt - 1]);
    }
    const ctl = new AbortController();
    let timer = 0;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => ctl.abort(fail(`${STALL_MS / 1000}초 동안 받은 것이 없어요`, "network")), STALL_MS);
    };
    try {
      arm();
      const resume = got > 0 && resumable;
      const headers = resume ? { Range: `bytes=${got}-`, "If-Range": validator } : undefined;
      // 낮은 우선순위: 곡 음원·악보 그림처럼 화면이 지금 쓰는 파일이 먼저 오게(지원하지 않는 브라우저는 무시한다)
      const r = await netFetch(url, { signal: ctl.signal, headers, priority: "low" });
      if (r.status === 206 && resume && contentRangeStart(r) === got) {
        // 받은 데서부터 이어 받는다
      } else if (r.ok && r.status !== 206) {
        restart();                                   // 처음부터(이어받기를 안 해 주거나 파일이 바뀌었다)
        validator = strongValidator(r);
        resumable = !!validator && /bytes/i.test(r.headers.get("Accept-Ranges") || "") &&
                    !r.headers.get("Content-Encoding");
      } else if (GONE.includes(r.status)) {
        throw fail(`분석 도구 파일이 사이트에 없어요: ${name} (${r.status})`, "missing");
      } else {
        restart();
        throw fail(`${name}: 서버 응답 ${r.status}`, "network");
      }
      const reader = r.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        arm();
        parts.push(value);
        got += value.length;
        onBytes(value.length);
      }
      clearTimeout(timer);
      if (bytes && got !== bytes) {
        if (got > bytes) restart();                  // 다른 내용이 왔다(와이파이 로그인 화면 등) — 이어 붙일 수 없다
        throw fail(`${name}: 받은 크기 ${got}바이트가 ${bytes}바이트와 다름`, "network");
      }
      return joinChunks(parts, got);
    } catch (e) {
      clearTimeout(timer);
      if (e && e.kind === "missing") throw e;
      last = e;
    }
  }
  throw fail(`분석 도구 파일을 받지 못했어요: ${name} (${describe(last)})`, "network", last);
}

/** SRI 값('sha256-…')과 내용이 맞는지. 이 브라우저가 확인할 수단(crypto.subtle — https나 localhost에서만)이 없으면
 *  넘어간다 — 크기는 이미 확인했고, 실행기 파일의 지문은 사이트를 만들 때 확인했다(tools/build_site.py). */
async function checkIntegrity(buf, integrity) {
  const m = /^sha256-(\S+)/.exec(String(integrity).trim());
  if (!m || !(self.crypto && self.crypto.subtle)) return;
  const digest = new Uint8Array(await self.crypto.subtle.digest("SHA-256", buf));
  let bin = "";
  for (const b of digest) bin += String.fromCharCode(b);
  if (btoa(bin) !== m[1]) throw new TypeError("받아 둔 파일의 내용 확인값(integrity)이 맞지 않아요");
}

/** Pyodide가 부르는 fetch 가운데 미리 받는 파일(files: 주소 → Promise<ArrayBuffer>)은 받아 둔 것으로 돌려준다.
 *  나머지는 그대로 네트워크로 간다. 받기가 끝내 실패하면 그 실패를 failed()에 남긴다(아래 watchPyodideBoot가 쓴다).
 *  돌려준 함수를 부르면 원래 fetch로 되돌린다. */
function serveFromMemory(files, failed) {
  const real = self.fetch;
  self.fetch = function (input, init) {
    const href = input instanceof Request ? input.url : String(input);
    const key = new URL(href, self.location && self.location.href).href;
    const p = files.get(key);
    if (!p) return real.call(this, input, init);
    files.delete(key);                               // 한 번만 쓴다(메모리를 일찍 놓아준다)
    const res = (async () => {
      let buf;
      try {
        buf = await p;
      } catch (e) {
        failed(e);
        throw e;
      }
      if (init && init.integrity) await checkIntegrity(buf, init.integrity);
      return new Response(buf, { status: 200, headers: {
        "Content-Type": key.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" } });
    })();
    // Pyodide는 이 Promise를 만들어 두고 한참 뒤에 기다린다. 그 전에 실패하면 '처리하지 않은 실패'로 콘솔에 찍히므로
    // 여기서 받아 둔다(실패는 그대로 Pyodide에 간다 — 위의 failed()가 이유를 남긴다).
    res.catch(() => {});
    return res;
  };
  return () => { self.fetch = real; };
}

/** Pyodide 314의 loadPyodide는 wasm을 띄우지 못하면 console.warn("wasm instantiation failed!")만 남기고 영영 기다린다
 *  (pyodide.mjs getInstantiateWasmFunc). 그 경고를 보는 즉시 failure를 실패로 돌린다. 받은 파일은 이미 메모리에 있으므로,
 *  받기가 실패한 게 아니면 이 기기·브라우저가 그 wasm을 못 돌리는 것이다(kind "device": 기능 없음·메모리 부족). */
function watchPyodideBoot(downloadError) {
  const warn = console.warn;
  let reject, decided = false;
  const failure = new Promise((_, rej) => { reject = rej; });
  failure.catch(() => {});
  const decide = cause => {
    if (decided) return;
    decided = true;
    reject(downloadError() || fail(`이 브라우저에서 파이썬 실행기를 띄우지 못했어요 (${describe(cause)})`, "device", cause));
  };
  let pending = false;
  console.warn = function (...a) {
    warn.apply(console, a);
    if (pending) { pending = false; decide(a[0]); return; }      // 경고 다음 줄이 실제 오류다
    if (typeof a[0] === "string" && a[0].startsWith("wasm instantiation failed")) {
      pending = true;
      setTimeout(() => { if (pending) { pending = false; decide(a[0]); } }, 0);
    }
  };
  return { failure, done() { console.warn = warn; } };
}

/* ---------------- 선생님 결과 ---------------- */

/** 선생님 결과(JSON 글자)를 곡마다 한 번 받아 둔다. 준비가 끝날 때 네 곡을 미리 받는다(prepare).
 *  글자 그대로인 이유: 서버는 data/expert/{곡}.json을 파이썬으로 바로 읽는다. 화면이 넘긴 객체를 다시 JSON으로 만들면
 *  159.0 같은 소수가 정수 159가 되어(자바스크립트 수에는 정수·소수 구분이 없다) 파이썬이 쓰는 비교 문장이 서버와
 *  달라진다('소박 5.8 솔 159.0cent' → '159cent', 2026-10-05 아리랑 크롬 검사).
 *  미리·시간 제한을 두고 받는 이유: 노래가 끝난 바로 그때 받기가 멈추면 '음고 분석 중' 원이 끝없이 돌고 분석 줄도 막힌다.
 *  못 받거나(끊김·시간 초과·404) 선생님 결과 모양의 JSON이 아니면(와이파이 로그인 화면 등) null — 화면이 넘긴 것을 쓴다. */
function expertText(songId) {
  let p = expertTexts.get(songId);
  if (!p) {
    p = getTextWithin(versioned(`data/expert/${encodeURIComponent(songId)}.json`), EXPERT_TIMEOUT_MS)
      .then(text => {
        const v = JSON.parse(text);
        if (!v || typeof v !== "object" || !Array.isArray(v.curve) || !v.timing) {
          throw new Error("선생님 결과 모양(curve·timing)의 JSON이 아니에요");
        }
        return text;
      })
      .catch(e => {
        if (expertTexts.get(songId) === p) expertTexts.delete(songId);
        console.warn(`[소리거울] 선생님 결과 파일(${songId})을 쓰지 못해 화면이 넘긴 것을 씁니다: ${describe(e)}`);
        return null;
      });
    expertTexts.set(songId, p);
  }
  return p;
}

/** 신경망 한 번. 파이썬이 넘긴 numpy 배열(PyProxy)을 복사 없이 읽어 ONNX 입력으로 쓴다. */
async function runCore(frames, kernel, sqrtLengths) {
  const fb = frames.getBuffer("f32"), kb = kernel.getBuffer("f32"), sb = sqrtLengths.getBuffer("f32");
  try {
    const out = await session.run({
      frames: new ort.Tensor("float32", fb.data, fb.shape),
      kernel: new ort.Tensor("float32", kb.data, kb.shape),
      sqrt_lengths: new ort.Tensor("float32", sb.data, sb.shape),
    });
    return [out.logits.data, out.confidence.data];
  } finally {
    fb.release(); kb.release(); sb.release();
  }
}

/** onnxruntime-web이 준비에 실패한 이유의 갈래. 기능이 없는 기기면 device, 파일을 못 받았으면 network. */
function ortKind(e) {
  const m = String((e && e.message) || e);
  if (/SIMD|not supported|Out of memory|RangeError/i.test(m)) return "device";
  if (/NetworkError|Failed to fetch|fetch|import|load/i.test(m)) return "network";
  return "other";
}

/* ---------------- 준비 ---------------- */

async function prepare(opts) {
  const t0 = performance.now();
  progress({ phase: "start" }, true);
  try {
    const [pyMod, ortMod] = await Promise.all([import("./vendor/pyodide/pyodide.mjs"),
                                               import("./vendor/ort/ort.wasm.min.mjs")]);
    loadPyodide = pyMod.loadPyodide;
    ort = ortMod;
  } catch (e) {
    throw fail(`분석 실행기를 불러오지 못했어요 (${describe(e)})`, "network", e);
  }
  const most = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
  const threads = Math.max(1, Math.min(opts.threads || most, most));
  ort.env.wasm.wasmPaths = here("./vendor/ort/").href;
  ort.env.wasm.numThreads = threads;
  const manifest = await getOk(versioned("py/manifest.json"), "json");

  // 큰 파일 받기를 모두 한꺼번에 시작한다. 받은 바이트를 화면에 알린다.
  const preload = manifest.preload || [];
  const total = preload.reduce((s, f) => s + (f.bytes || 0), 0);
  let loaded = 0;
  const onBytes = n => { loaded += n; progress({ phase: "download", loaded, total }, loaded >= total); };
  const onRetry = (name, attempt, why) => {
    console.warn(`[소리거울] ${name} 받기가 끊겨 다시 받습니다(${attempt}번째): ${describe(why)}`);
    progress({ phase: "download", loaded, total, retry: { name, attempt } }, true);
  };
  progress({ phase: "download", loaded, total }, true);
  const pyFiles = new Map();
  let ortWasm = Promise.resolve(undefined);
  const all = [];
  for (const f of preload) {
    const u = here(f.path);
    const p = download(f.hash ? `${u.href}?h=${f.hash}` : u.href, f.bytes, onBytes, onRetry);
    all.push(p);
    if (f.for === "ort") ortWasm = p;
    else pyFiles.set(u.href, p);
  }
  let downloadError = null;
  const allDone = Promise.all(all);
  allDone.catch(e => { downloadError = downloadError || e; });

  // Pyodide는 가로챈 fetch로 받아 둔 파일을 쓴다. 받기가 끝나기 전에 시작해도 그 파일이 올 때까지 기다린다.
  const restoreFetch = serveFromMemory(pyFiles, e => { downloadError = downloadError || e; });
  const boot = watchPyodideBoot(() => downloadError);
  try {
    const [pyodide, sources, meta, sess] = await Promise.all([
      Promise.race([
        loadPyodide({ indexURL: here("./vendor/pyodide/").href }).catch(e => {
          throw downloadError || fail(`파이썬 실행기를 띄우지 못했어요 (${describe(e)})`, "other", e);
        }),
        boot.failure,
      ]).then(p => { progress({ phase: "start", step: "python" }, true); return p; }),
      Promise.all(manifest.files.map(async f => [f, await getOk(versioned("py/" + f))])),
      getOk(versioned(manifest.meta), "json"),
      ortWasm.then(async bin => {
        if (bin) ort.env.wasm.wasmBinary = bin;      // 받아 둔 wasm을 쓴다 — onnxruntime-web이 스스로 받지 않게
        try {
          return await ort.InferenceSession.create(versioned(manifest.model), { executionProviders: ["wasm"] });
        } catch (e) {
          throw fail(`음고 실행기를 띄우지 못했어요 (${describe(e)})`, ortKind(e), e);
        }
      }).then(s => { progress({ phase: "start", step: "model" }, true); return s; }),
      allDone,                                        // 한 파일이라도 끝내 못 받으면 곧바로 실패로 끝낸다
    ]);
    py = pyodide; session = sess;
    await py.loadPackage("numpy");                    // 휠도 받아 둔 것을 쓴다(가로챈 fetch)
    try {
      py.runPython("import numpy");                   // loadPackage는 실패해도 오류를 던지지 않고 콘솔에만 남긴다
    } catch (e) {
      throw downloadError || fail(`numpy를 불러오지 못했어요 (${describe(e)})`, "other", e);
    }
    progress({ phase: "start", step: "numpy" }, true);
    for (const [f, text] of sources) {
      const path = "/sorigeoul/" + f;
      py.FS.mkdirTree(path.slice(0, path.lastIndexOf("/")));
      py.FS.writeFile(path, text);
    }
    py.runPython("import sys\nif '/sorigeoul' not in sys.path:\n    sys.path.insert(0, '/sorigeoul')");
    web = py.pyimport("server.pesto_web");
    web.set_meta(JSON.stringify(meta));
  } finally {
    restoreFetch();
    boot.done();
  }
  // 선생님 결과 파일을 미리 받아 둔다(네 곡 합쳐 약 150KB) — 받아 두면 분석할 때는 네트워크를 쓰지 않는다(못 받은 곡만
  // 분석 때 한 번 더, 8초 안에서 받아 본다). 곡 목록은 site/data/expert/를 만든 것과 같은 config.SONG_ORDER.
  // 기다리지 않는다: 준비가 이 파일 때문에 늦어지거나 실패하지 않는다.
  for (const sid of JSON.parse(py.runPython("import json, config\njson.dumps(config.SONG_ORDER)"))) expertText(sid);
  if (opts.sampleRate) await web.warm(opts.sampleRate, runCore);
  info = {
    threads, isolated: self.crossOriginIsolated,
    prepare_seconds: +((performance.now() - t0) / 1000).toFixed(2),
    runtime: `onnxruntime-web ${(ort.env.versions && ort.env.versions.web) || ""} wasm`.trim(),
    model: manifest.model,
    downloaded_bytes: loaded,
  };
  progress({ phase: "ready" }, true);
  return info;
}

function ensureReady(opts) {
  if (!ready) ready = prepare(opts || {}).catch(e => { ready = null; throw e; });
  return ready;
}

async function analyze(m) {
  try {
    await ensureReady({ sampleRate: m.sampleRate });
  } catch (e) {
    throw Object.assign(e, { stage: "prepare" });   // 분석이 아니라 도구 준비가 실패했다(화면 문구가 다르다)
  }
  const t0 = performance.now();
  const engine = JSON.stringify({ f0_device: `브라우저(wasm, ${info.threads}스레드)`, f0_runtime: info.runtime });
  // 선생님 결과: 받아 둔 파일 글자(서버와 같은 비교 문장). 못 받았으면 화면이 넘긴 객체를 다시 JSON으로 만들어 쓴다 —
  // 그때는 위(expertText)의 이유로 비교 문장 속 수 하나가 '159cent'처럼 서버('159.0cent')와 표기만 다를 수 있다.
  const expert = (await expertText(m.songId)) || (m.expert ? JSON.stringify(m.expert) : "");
  const co = web.analyze(m.wav, m.songId, JSON.stringify(m.timing || {}), expert, runCore, engine);
  let out;
  try { out = await co; } finally { if (co && co.destroy) co.destroy(); }
  return { result: JSON.parse(out), worker_seconds: +((performance.now() - t0) / 1000).toFixed(3), info };
}

self.onmessage = e => {
  const m = e.data;
  const reply = (ok, body) => self.postMessage({ id: m.id, ok, ...body });
  const failed = (err, stage) => reply(false, { error: describe(err), stage, kind: (err && err.kind) || "other" });
  if (m.type === "prepare") {
    ensureReady(m).then(i => reply(true, { info: i }), err => failed(err, "prepare"));
  } else if (m.type === "analyze") {
    const job = queue.then(() => analyze(m));
    queue = job.catch(() => {});                 // 앞 분석이 실패해도 줄은 계속 간다
    job.then(r => reply(true, r), err => failed(err, err && err.stage === "prepare" ? "prepare" : "analyze"));
  } else {
    reply(false, { error: `알 수 없는 요청: ${m.type}`, stage: "message" });
  }
};
// 이 파일을 다 읽었다 — 화면은 이 소식 전에 난 오류를 '일꾼을 못 띄움', 뒤에 난 오류를 '일꾼이 멈춤'으로 가른다.
self.postMessage({ type: "hello" });
