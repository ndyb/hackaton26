const $ = (sel) => document.querySelector(sel);

let audioCtx = null;
let workletNode = null;
let mediaStream = null;
let chunks = [];
let recording = false;

const recordBtn = $("#record-btn");
const statusEl = $("#status");
const transcriptEl = $("#transcript");
const historyEl = $("#history");

function setStatus(msg, type = "info") {
  statusEl.textContent = msg;
  statusEl.className = `status ${type}`;
}

function addToHistory(text, duration) {
  const entry = document.createElement("div");
  entry.className = "history-entry";
  const time = new Date().toLocaleTimeString("nb-NO");
  entry.innerHTML = `<span class="time">${time}</span> <span class="duration">(${duration.toFixed(1)}s)</span><p>${text}</p>`;
  historyEl.prepend(entry);
}

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
  } catch (e) {
    setStatus("Mikrofontilgang avslått", "error");
    return;
  }

  audioCtx = new AudioContext({ sampleRate: 48000 });
  await audioCtx.audioWorklet.addModule("/pcm-worklet.js");

  const source = audioCtx.createMediaStreamSource(mediaStream);
  workletNode = new AudioWorkletNode(audioCtx, "pcm-processor");

  chunks = [];
  workletNode.port.onmessage = (e) => {
    chunks.push(e.data);
  };

  source.connect(workletNode);
  workletNode.connect(audioCtx.destination);

  recording = true;
  recordBtn.textContent = "⏹ Stopp";
  recordBtn.classList.add("recording");
  setStatus("Tar opp...", "recording");
}

async function stopRecording() {
  recording = false;
  recordBtn.textContent = "🎤 Ta opp";
  recordBtn.classList.remove("recording");

  if (workletNode) {
    workletNode.disconnect();
    workletNode = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }

  const sampleRate = audioCtx ? audioCtx.sampleRate : 48000;
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = null;
  }

  if (chunks.length === 0) {
    setStatus("Ingen lyd tatt opp", "error");
    return;
  }

  const totalLen = chunks.reduce((s, c) => s + c.length, 0);
  const pcm = new Float32Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) {
    pcm.set(chunk, offset);
    offset += chunk.length;
  }
  chunks = [];

  setStatus("Transkriberer...", "processing");
  recordBtn.disabled = true;

  const blob = new Blob([pcm.buffer], { type: "application/octet-stream" });
  const formData = new FormData();
  formData.append("audio", blob, "audio.pcm");
  formData.append("sample_rate", sampleRate.toString());

  try {
    const resp = await fetch("/api/transcribe", { method: "POST", body: formData });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ detail: resp.statusText }));
      throw new Error(err.detail || "Transkribering feilet");
    }
    const data = await resp.json();
    if (data.text) {
      transcriptEl.textContent = data.text;
      addToHistory(data.text, data.duration);
      setStatus("Ferdig!", "success");
    } else {
      transcriptEl.textContent = "(ingen tale gjenkjent)";
      setStatus("Ingen tale gjenkjent", "info");
    }
  } catch (e) {
    setStatus(`Feil: ${e.message}`, "error");
  } finally {
    recordBtn.disabled = false;
  }
}

recordBtn.addEventListener("click", () => {
  if (recording) {
    stopRecording();
  } else {
    startRecording();
  }
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    recordBtn.click();
  }
});

async function copyTranscript() {
  const text = transcriptEl.textContent;
  if (!text || text === "Trykk på knappen og snakk norsk...") return;
  await navigator.clipboard.writeText(text);
  const btn = $("#copy-btn");
  btn.textContent = "✓ Kopiert";
  setTimeout(() => (btn.textContent = "Kopier"), 1500);
}

$("#copy-btn").addEventListener("click", copyTranscript);
