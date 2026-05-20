class PcmProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input.length > 0) {
      const mono = input[0];
      if (mono && mono.length > 0) {
        this.port.postMessage(new Float32Array(mono));
      }
    }
    return true;
  }
}

registerProcessor("pcm-processor", PcmProcessor);
