class PCMProcessor extends AudioWorkletProcessor {
    constructor() {
      super();
      this.buffer = [];
    }
  
    process(inputs) {
      const input = inputs[0];
  
      if (!input || !input[0]) return true;
  
      const channelData = input[0]; // Float32Array
  
      // accumulate
      this.buffer.push(...channelData);
  
      // send every ~4096 samples (~256ms @ 16kHz)
      if (this.buffer.length >= 4096) {
        const float32 = new Float32Array(this.buffer);
        this.buffer = [];
  
        // convert Float32 → Int16
        const int16 = new Int16Array(float32.length);
  
        for (let i = 0; i < float32.length; i++) {
          let s = Math.max(-1, Math.min(1, float32[i]));
          int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
        }
  
        this.port.postMessage(int16.buffer, [int16.buffer]);
      }
  
      return true;
    }
  }

  registerProcessor("pcm-processor", PCMProcessor);
