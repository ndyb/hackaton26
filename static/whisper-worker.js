import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

let transcriber = null;
let loading = false;

async function load() {
  if (transcriber || loading) return;
  loading = true;

  const hasWebGPU = !!navigator.gpu;
  const device = hasWebGPU ? "webgpu" : "wasm";
  self.postMessage({ type: "status", msg: `Laster modell (${device})...` });

  try {
    transcriber = await pipeline(
      "automatic-speech-recognition",
      "Xenova/nb-whisper-small-beta",
      {
        device,
        dtype: device === "webgpu"
          ? { encoder_model: "fp32", decoder_model_merged: "q4" }
          : "q8",
        progress_callback: (p) => {
          if (p.status === "downloading") {
            const pct = p.total ? Math.round((p.loaded / p.total) * 100) : 0;
            const mb = p.total ? (p.total / 1e6).toFixed(0) : "?";
            self.postMessage({ type: "status", msg: `Laster: ${p.file} (${pct}%, ${mb}MB)` });
          }
          if (p.status === "ready") {
            self.postMessage({ type: "status", msg: `Klargjør ${p.task}...` });
          }
        },
      }
    );

    self.postMessage({ type: "status", msg: `Modell klar (${device})` });
    self.postMessage({ type: "ready", device });
  } catch (err) {
    self.postMessage({ type: "error", msg: err.message });
  }
  loading = false;
}

self.onmessage = async (e) => {
  if (e.data.type === "load") {
    await load();
    return;
  }

  if (e.data.type === "transcribe") {
    if (!transcriber) {
      await load();
    }
    if (!transcriber) return;

    const audio = e.data.audio;
    const t0 = performance.now();

    self.postMessage({ type: "status", msg: "Transkriberer..." });

    const result = await transcriber(audio, {
      language: "norwegian",
      task: "transcribe",
      chunk_length_s: 30,
      stride_length_s: 5,
    });

    const elapsed = performance.now() - t0;
    self.postMessage({
      type: "result",
      text: result.text.trim(),
      transcribeMs: elapsed,
    });
  }
};
