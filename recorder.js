/*
 * recorder.js — 마이크 녹음 (원시 PCM → 무손실 WAV)
 * --------------------------------------------------
 * 왜 MediaRecorder(WebM/Opus)를 쓰지 않는가 (2026-09-11):
 *   1. 손실 압축이다. 음고 분석에 쓸 자료를 굳이 깎을 이유가 없다.
 *   2. 컨테이너가 앞뒤에 수십 ms 패딩을 붙인다. README가 mp3에 대해 이미 지적한 문제와 같다 —
 *      장단 격자가 밀리면 "같은 시각끼리 비교한다"는 이 연구의 전제가 깨진다.
 *   3. 서버에서 풀려면 ffmpeg 같은 디코더가 필요하다.
 *   4. 녹음이 실제로 언제 시작됐는지 알려 주지 않는다. 이것이 가장 큰 문제였다.
 *      AudioWorklet은 장단을 예약한 것과 **같은 오디오 시계**로 첫 표본의 시각을 알려 준다.
 *
 * 쓰는 법:
 *   const rec = new MicRecorder(audioCtx, stream);
 *   await rec.start();          // 첫 표본이 들어올 때까지 기다린다 → rec.startTime 이 정해진다
 *   ...
 *   const take = rec.stop();    // { blob, sampleRate, seconds, startTime, outputLatency }
 *   take.slice(초, 길이)         // 거울 재생용으로 한 장단만 잘라내기
 */
class MicRecorder {
  constructor(ctx, stream) {
    this.ctx = ctx;
    this.stream = stream;
    this.chunks = [];
    this.total = 0;
    this.startTime = null;     // 첫 표본의 오디오 시계 시각 (ctx.currentTime 과 같은 축)
    this.sampleRate = ctx.sampleRate;
    this.node = null;
    this.src = null;
  }

  static get supported() {
    return !!(window.AudioWorkletNode && navigator.mediaDevices);
  }

  async start() {
    if (!MicRecorder.supported) throw new Error("이 브라우저는 AudioWorklet을 지원하지 않아요. Chrome을 써 주세요.");
    if (!this._loaded) {
      // 주소에 버전을 붙여 낡은 워크렛이 캐시에서 나오지 않게 한다(window.__V 는 서버가 넣어 준다)
      const v = (typeof window !== "undefined" && window.__V) ? `?v=${window.__V}` : "";
      await this.ctx.audioWorklet.addModule(`recorder-worklet.js${v}`);
      this._loaded = true;
    }
    this.node = new AudioWorkletNode(this.ctx, "pcm-capture", {
      numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1,
    });
    const firstBlock = new Promise(resolve => {
      this.node.port.onmessage = e => {
        const m = e.data;
        if (m.type === "start") {
          this.startTime = m.time;
          this.sampleRate = m.sampleRate;
          resolve();
        } else if (m.type === "pcm") {
          this.chunks.push(m.data);
          this.total += m.data.length;
        }
      };
    });
    this.src = this.ctx.createMediaStreamSource(this.stream);
    this.src.connect(this.node);
    // 출력에 연결하지 않는다 — 연결하면 자기 목소리가 스피커로 되돌아 나가 하울링이 된다.
    await firstBlock;
    return this.startTime;
  }

  /** 녹음을 멈추고 결과를 돌려준다. 오디오 스레드에 남은 표본까지 받아오므로 async 다. */
  async stop() {
    if (this.node) {
      // 남은 표본을 마저 받는다. 응답이 없어도 200ms 뒤에는 진행한다.
      await new Promise(resolve => {
        const done = setTimeout(resolve, 200);
        this.node.port.onmessage = e => {
          const m = e.data;
          if (m.type === "pcm") { this.chunks.push(m.data); this.total += m.data.length; }
          else if (m.type === "flushed") { clearTimeout(done); resolve(); }
        };
        this.node.port.postMessage({ type: "flush" });
      });
    }
    // 마지막 표본이 오디오 시계로 지금이므로, 표본 수를 빼면 녹음 0초가 나온다.
    const stopTime = this.ctx.currentTime;
    if (this.src) { try { this.src.disconnect(); } catch (e) { /* 이미 끊김 */ } }
    if (this.node) { try { this.node.disconnect(); } catch (e) { /* 이미 끊김 */ } this.node.port.onmessage = null; }
    const pcm = new Float32Array(this.total);
    let o = 0;
    for (const c of this.chunks) { pcm.set(c, o); o += c.length; }
    this.pcm = pcm;
    const self = this;
    return {
      pcm,
      /** 이 녹음에서 [start, start+length) 초를 잘라 AudioBuffer 로 (거울 재생용).
       *  take 안에 두는 이유: 소리와 시각이 같은 녹음에서 나오게 하기 위함이다. */
      slice: (start, length) => self.sliceBuffer(start, length),
      blob: new Blob([encodeWav(pcm, this.sampleRate)], { type: "audio/wav" }),
      sampleRate: this.sampleRate,
      seconds: pcm.length / this.sampleRate,
      // 녹음 0초. 워크렛이 알려준 시각(this.startTime)을 쓰지 않고 표본 수로 역산한다.
      // 이유: 워크렛의 알림은 메인 스레드가 바쁘면 늦게 도착하는데, 그러면 그 뒤에
      // 계산한 장단 시각이 녹음보다 한참 뒤로 밀린다(2026-10-01 실측 5.02초 어긋남).
      // 표본 수는 그런 지연과 무관하다.
      startTime: stopTime - pcm.length / this.sampleRate,
      reportedStartTime: this.startTime,
      startTimeDrift: (stopTime - pcm.length / this.sampleRate) - this.startTime,
      // 스피커로 소리가 나가는 데 걸리는 지연. 마이크로 들어오는 쪽 지연은 브라우저가
      // 알려 주지 않아 서버의 config.ANALYSIS["mic_latency_ms"]로 보탠다.
      outputLatency: this.ctx.outputLatency || this.ctx.baseLatency || 0,
    };
  }

  /** 녹음에서 [start, start+length) 초를 잘라 AudioBuffer로 만든다 (거울 재생용) */
  sliceBuffer(startSeconds, lengthSeconds) {
    if (!this.pcm) return null;
    const sr = this.sampleRate;
    const a = Math.max(0, Math.round(startSeconds * sr));
    const b = Math.min(this.pcm.length, a + Math.round(lengthSeconds * sr));
    const buf = this.ctx.createBuffer(1, Math.max(1, b - a), sr);
    buf.copyToChannel(this.pcm.subarray(a, b), 0);
    return buf;
  }
}

/** 여러 구간을 순서대로 이어 붙인 AudioBuffer (학생 장단 3개 → 3장단짜리 한 덩어리) */
function joinBuffers(ctx, buffers) {
  const ok = buffers.filter(Boolean);
  if (!ok.length) return null;
  const sr = ok[0].sampleRate;
  const total = ok.reduce((n, b) => n + b.length, 0);
  const out = ctx.createBuffer(1, total, sr);
  const ch = out.getChannelData(0);
  let o = 0;
  for (const b of ok) { ch.set(b.getChannelData(0), o); o += b.length; }
  return out;
}

/** Float32 PCM → 16bit 모노 WAV 바이트. server/wav.py 의 write_wav 와 같은 형식이다. */
function encodeWav(pcm, sampleRate) {
  const bytes = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(bytes);
  const ascii = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ascii(0, "RIFF"); v.setUint32(4, 36 + pcm.length * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);                    // PCM
  v.setUint16(22, 1, true);                    // 모노
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);       // 초당 바이트
  v.setUint16(32, 2, true);                    // 블록 정렬
  v.setUint16(34, 16, true);                   // 16bit
  ascii(36, "data"); v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}
