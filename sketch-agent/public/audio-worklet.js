// AudioWorklet: sammelt Mikrofon-Samples (Float32, Original-Samplerate des
// AudioContext) und liefert sie als Int16-PCM-Bloecke an den Main-Thread.
// Die Samplerate wird dem Server mitgeteilt, der sie 1:1 an Deepgram
// weitergibt — dadurch ist kein Resampling im Browser noetig.

class PCMCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(4096);
    this.offset = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    let i = 0;
    while (i < channel.length) {
      const space = this.buffer.length - this.offset;
      const n = Math.min(space, channel.length - i);
      this.buffer.set(channel.subarray(i, i + n), this.offset);
      this.offset += n;
      i += n;

      if (this.offset === this.buffer.length) {
        const int16 = new Int16Array(this.buffer.length);
        for (let j = 0; j < this.buffer.length; j++) {
          const s = Math.max(-1, Math.min(1, this.buffer[j]));
          int16[j] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
        this.port.postMessage(int16.buffer, [int16.buffer]);
        this.offset = 0;
      }
    }
    return true;
  }
}

registerProcessor("pcm-capture", PCMCaptureProcessor);
