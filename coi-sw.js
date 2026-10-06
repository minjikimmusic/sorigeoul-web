/*
 * coi-sw.js — 헤더를 못 붙이는 곳(GitHub Pages)에서 여러 스레드 분석을 켜는 서비스 워커
 * ========================================================================================
 * 여러 스레드 분석(onnxruntime-web)은 페이지가 '교차 출처 격리' 상태일 때만 켜진다. 그 상태는 서버가 응답마다 두 헤더
 * (Cross-Origin-Opener-Policy·Cross-Origin-Embedder-Policy)를 붙여 줘야 된다. GitHub Pages는 헤더를 고를 수 없어서
 * 그대로 두면 한 스레드로 돈다(결과는 같고 분석 전체로 약 2.7배 느림).
 * 서비스 워커는 브라우저 안에서 이 사이트의 요청을 중간에서 받아 대신 내보내는 작은 일꾼이다. 여기서는 받은 응답을
 * 그대로 두고 헤더 셋만 더 붙인다. 등록은 사본 index.html 맨 앞의 등록 스크립트(tools/isolation/register.js)가 한다.
 *
 *   - 같은 출처(이 사이트) 요청만 다룬다. 다른 출처는 손대지 않는다(이 사이트는 바깥 파일을 부르지 않는다).
 *   - 크롬 개발자 도구가 보내는 only-if-cached(no-cors) 요청은 fetch로 다시 보낼 수 없어 손대지 않는다.
 *   - 응답의 상태(206 이어받기 포함)·헤더(Content-Range·ETag 등)·본문을 그대로 옮긴다. 본문은 받는 만큼 바로 넘긴다
 *     (분석 일꾼의 이어받기와 받은 양 표시가 그대로 돈다 — client/analyzer-worker.js의 download).
 *   - 불투명 응답(상태 0 — 페이지 이동 응답 등)은 헤더를 붙일 수 없으니 그대로 돌려준다.
 *   - 캐시하지 않는다. 늘 네트워크(브라우저의 보통 캐시 규칙)로 간다 — 사이트를 고쳐 올리면 그대로 반영된다.
 * 사이트 맨 위(site/coi-sw.js)에 두어야 한다. 서비스 워커는 제 폴더와 그 아래 주소만 맡는다.
 * 바깥 라이브러리(coi-serviceworker 등)를 부르지 않고 직접 짰다 — 사이트가 바깥 주소를 하나도 부르지 않게.
 * tests/test_isolation_js.py가 node로 검사한다.
 */
self.addEventListener("install", function () {
  self.skipWaiting();                      // 기다리지 않고 바로 일을 시작한다
});

self.addEventListener("activate", function (event) {
  event.waitUntil(self.clients.claim());   // 등록한 그 페이지도 곧바로 맡는다(그래도 격리는 새로 고친 뒤부터다)
});

self.addEventListener("fetch", function (event) {
  var request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") return;
  if (new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(isolate));
});

/** 응답에 교차 출처 격리 헤더 셋을 붙인 새 응답. 상태·나머지 헤더·본문(흘려 받는 그대로)은 바꾸지 않는다. */
function isolate(response) {
  if (response.status === 0) return response;
  var headers = new Headers(response.headers);
  headers.set("Cross-Origin-Embedder-Policy", "require-corp");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Cross-Origin-Resource-Policy", "same-origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: headers });
}
