import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

env.allowRemoteModels = true;
env.allowLocalModels = false;

const MODEL_URL = self.location.origin + "/models/";

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
      MODEL_URL,
      {
        device,
        dtype: "q8",
        progress_callback: (p) => {
          if (p.status === "progress") {
            const pct = p.progress ? Math.round(p.progress) : 0;
            self.postMessage({ type: "status", msg: `Laster: ${p.file || "..."} ${pct}%` });
          }
          if (p.status === "initiate") {
            self.postMessage({ type: "status", msg: `Henter ${p.file}...` });
          }
          if (p.status === "done") {
            self.postMessage({ type: "status", msg: `${p.file} lastet` });
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
    if (!transcriber) await load();
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
