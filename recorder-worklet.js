/*
 * recorder-worklet.js — 마이크 원시 PCM을 모으는 AudioWorklet 프로세서
 * --------------------------------------------------------------------
 * 오디오 스레드에서 돈다. 하는 일은 두 가지뿐이다.
 *   1. 첫 블록이 들어온 순간의 오디오 시계 시각(currentTime)을 한 번 알려 준다.
 *      → 장단을 예약한 것과 같은 시계이므로, 녹음 안에서 학생 장단이 어디인지 계산할 수 있다.
 *        (MediaRecorder는 이 시각을 알려 주지 않아 시작 지연만큼 어긋났다)
 *   2. 표본을 모아 두었다가 일정 크기가 되면 메인 스레드로 넘긴다.
 *      블록(128표본)마다 넘기면 초당 375번이라 낭비이므로 8192표본씩 모은다.
 *
 * 여기서 소리를 가공하지 않는다. 음고 분석은 서버가 한다(브라우저에서 F0 분석 금지).
 */
const CHUNK = 8192;

class PcmCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(CHUNK);
    this.n = 0;
    this.announced = false;
    // 멈출 때 메인 스레드가 "남은 것 보내"라고 한다. 안 그러면 마지막 덩어리
    // (최대 8192표본 = 170ms)가 버려져 녹음이 그만큼 짧아진다.
    this.port.onmessage = (e) => {
      if (e.data && e.data.type === "flush") {
        this.flush();
        this.port.postMessage({ type: "flushed" });
      }
    };
  }

  flush() {
    if (!this.n) return;
    const out = this.buf.slice(0, this.n);
    this.port.postMessage({ type: "pcm", data: out }, [out.buffer]);
    this.n = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;                 // 마이크가 아직 안 붙었거나 끊긴 경우
    if (!this.announced) {
      this.announced = true;
      // 이 블록의 첫 표본이 오디오 시계로 언제인가. 녹음 시작 시각의 기준이 된다.
      this.port.postMessage({ type: "start", time: currentTime, sampleRate });
    }
    for (let i = 0; i < ch.length; i++) {
      this.buf[this.n++] = ch[i];
      if (this.n === CHUNK) this.flush();
    }
    return true;
  }
}

registerProcessor("pcm-capture", PcmCaptureProcessor);
