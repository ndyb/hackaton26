const $ = (sel) => document.querySelector(sel);

fetch("/api/health").then(r => r.json()).then(d => {
  const v = d.version || "?";
  $("#version-footer").textContent = `v${v.slice(0, 7)}`;
}).catch(() => {});

let audioCtx = null;
let workletNode = null;
let mediaStream = null;
let chunks = [];
let recording = false;

const recordBtn = $("#record-btn");
const recordStatus = $("#record-status");
const status = $("#status");
const metric = $("#metric");
const transcript = $("#transcript");
const ttsBtn = $("#tts-btn");
const historyEl = $("#history");

let audioDuration = 0;

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (e) {
    recordStatus.textContent = "Mikrofontilgang avslått";
    recordStatus.className = "status error";
    return;
  }

  audioCtx = new AudioContext({ sampleRate: 16000 });
  await audioCtx.audioWorklet.addModule("/pcm-worklet.js");

  const source = audioCtx.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");

  chunks = [];
  workletNode.port.onmessage = (e) => chunks.push(e.data);

  source.connect(workletNode);
  workletNode.connect(audioCtx.destination);

  recording = true;
  recordBtn.textContent = "Stopp";
  recordBtn.classList.add("recording");
  recordStatus.textContent = "Tar opp...";
  recordStatus.className = "status recording";

  metric.textContent = "";
  metric.className = "metric";
  status.textContent = "";
  transcript.textContent = "Venter...";
  ttsBtn.style.display = "none";
}

async function stopRecording() {
  recording = false;
  recordBtn.textContent = "Ta opp";
  recordBtn.classList.remove("recording");

  if (workletNode) { workletNode.disconnect(); workletNode = null; }
  if (mediaStream) { mediaStream.getTracks().forEach((t) => t.stop()); mediaStream = null; }

  const sampleRate = audioCtx ? audioCtx.sampleRate : 16000;
  if (audioCtx) { await audioCtx.close(); audioCtx = null; }

  if (chunks.length === 0) {
    recordStatus.textContent = "Ingen lyd tatt opp";
    recordStatus.className = "status error";
    return;
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const pcm = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
  chunks = [];

  audioDuration = totalLen / sampleRate;
  recordStatus.textContent = `Opptak: ${audioDuration.toFixed(1)}s — transkriberer...`;
  recordStatus.className = "status processing";

  transcribeServer(pcm, sampleRate);
}

async function transcribeServer(pcm, sampleRate) {
  status.textContent = "Transkriberer...";
  status.className = "status processing";
  recordBtn.disabled = true;

  const t0 = performance.now();
  const blob = new Blob([pcm.buffer], { type: "application/octet-stream" });
  const formData = new FormData();
  formData.append("audio", blob, "audio.pcm");
  formData.append("sample_rate", sampleRate.toString());

  try {
    const resp = await fetch("/api/transcribe", { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || "Feil");
    }
    const data = await resp.json();
    const elapsed = performance.now() - t0;

    const text = data.text || "(ingen tale gjenkjent)";
    transcript.textContent = text;
    metric.textContent = `${(elapsed / 1000).toFixed(2)}s`;
    metric.className = "metric done";
    status.textContent = "Ferdig!";
    status.className = "status success";
    recordStatus.textContent = `Opptak: ${audioDuration.toFixed(1)}s`;
    recordStatus.className = "status info";

    if (data.text) {
      ttsBtn.style.display = "block";
    }

    addToHistory(text, audioDuration, elapsed);
  } catch (e) {
    status.textContent = `Feil: ${e.message}`;
    status.className = "status error";
    metric.textContent = "feilet";
    metric.className = "metric done";
  } finally {
    recordBtn.disabled = false;
  }
}

function addToHistory(text, duration, elapsedMs) {
  const entry = document.createElement("div");
  entry.className = "history-entry";
  const time = new Date().toLocaleTimeString("nb-NO");
  entry.innerHTML = `
    <div class="history-meta">
      <span>${time}</span>
      <span>Opptak: ${duration.toFixed(1)}s</span>
      <span>Tid: ${(elapsedMs / 1000).toFixed(2)}s</span>
    </div>
    <div class="history-text">${escapeHtml(text)}</div>`;
  historyEl.prepend(entry);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

let ttsPlaying = false;

ttsBtn.addEventListener("click", async () => {
  if (ttsPlaying) return;
  const text = transcript.textContent;
  if (!text || text === "(ingen tale gjenkjent)") return;

  ttsBtn.textContent = "Leser opp...";
  ttsBtn.disabled = true;
  ttsPlaying = true;

  try {
    const formData = new FormData();
    formData.append("text", text);
    formData.append("speed", "1.0");
    const resp = await fetch("/api/tts", { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || "TTS feilet");
    }
    const wavBlob = await resp.blob();
    const url = URL.createObjectURL(wavBlob);
    const audio = new Audio(url);
    audio.onended = () => {
      URL.revokeObjectURL(url);
      ttsBtn.textContent = "Les opp";
      ttsBtn.disabled = false;
      ttsPlaying = false;
    };
    audio.onerror = () => {
      URL.revokeObjectURL(url);
      ttsBtn.textContent = "Les opp";
      ttsBtn.disabled = false;
      ttsPlaying = false;
    };
    audio.play();
  } catch (e) {
    status.textContent = `TTS feil: ${e.message}`;
    status.className = "status error";
    ttsBtn.textContent = "Les opp";
    ttsBtn.disabled = false;
    ttsPlaying = false;
  }
});

recordBtn.addEventListener("click", () => {
  if (recording) stopRecording(); else startRecording();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    recordBtn.click();
  }
});
