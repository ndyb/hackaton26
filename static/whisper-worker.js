import { pipeline, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3";

env.allowLocalModels = false;
env.allowRemoteModels = true;

let transcriber = null;
let loading = false;

function dedup(text) {
  const words = text.split(/\s+/);
  if (words.length < 8) return text;
  for (let len = 3; len <= 8; len++) {
    const tail = words.slice(-len).join(" ");
    let repeats = 0;
    for (let i = words.length - len; i >= len; i -= len) {
      if (words.slice(i - len, i).join(" ") === tail) repeats++;
      else break;
    }
    if (repeats >= 3) {
      return words.slice(0, words.length - repeats * len).join(" ");
    }
  }
  return text;
}

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
        dtype: "q8",
        progress_callback: (p) => {
          if (p.status === "progress") {
            const pct = p.progress ? Math.round(p.progress) : 0;
            self.postMessage({ type: "status", msg: `Laster: ${p.file || "..."} ${pct}%` });
          }
          if (p.status === "initiate") {
            self.postMessage({ type: "status", msg: `Henter ${p.file}...` });
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
      max_new_tokens: 128,
      no_repeat_ngram_size: 4,
    });

    const elapsed = performance.now() - t0;
    const text = dedup(result.text.trim());
    self.postMessage({
      type: "result",
      text,
      transcribeMs: elapsed,
    });
  }
};
