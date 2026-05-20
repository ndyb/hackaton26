const $ = (sel) => document.querySelector(sel);

let audioCtx = null;
let workletNode = null;
let mediaStream = null;
let chunks = [];
let recording = false;
let browserReady = false;

const recordBtn = $("#record-btn");
const recordStatus = $("#record-status");
const serverStatus = $("#server-status");
const serverMetric = $("#server-metric");
const serverTranscript = $("#server-transcript");
const browserStatus = $("#browser-status");
const browserMetric = $("#browser-metric");
const browserTranscript = $("#browser-transcript");
const browserBadge = $("#browser-badge");
const loadModelBtn = $("#load-model-btn");
const historyEl = $("#history");

const worker = new Worker("/whisper-worker.js", { type: "module" });

worker.onmessage = (e) => {
  const { type } = e.data;
  if (type === "status") {
    browserStatus.textContent = e.data.msg;
    browserStatus.className = "status processing";
  } else if (type === "ready") {
    browserReady = true;
    browserStatus.textContent = `Klar (${e.data.device})`;
    browserStatus.className = "status success";
    browserBadge.textContent = `nb-whisper-small (${e.data.device})`;
    loadModelBtn.style.display = "none";
  } else if (type === "result") {
    const ms = e.data.transcribeMs;
    browserTranscript.textContent = e.data.text || "(ingen tale gjenkjent)";
    browserMetric.textContent = `${(ms / 1000).toFixed(2)}s`;
    browserMetric.className = "metric done";
    browserStatus.textContent = "Ferdig!";
    browserStatus.className = "status success";
    checkBothDone();
  }
};

loadModelBtn.addEventListener("click", () => {
  loadModelBtn.disabled = true;
  loadModelBtn.textContent = "Laster...";
  worker.postMessage({ type: "load" });
});

let pendingResults = { server: null, browser: null };
let recordingStopTime = null;
let audioDuration = 0;

function checkBothDone() {
  const serverDone = serverMetric.classList.contains("done");
  const browserDone = browserMetric.classList.contains("done") || !browserReady;

  if (serverDone && browserDone) {
    const sMs = parseMetric(serverMetric.textContent);
    const bMs = browserReady ? parseMetric(browserMetric.textContent) : null;
    addToHistory(
      serverTranscript.textContent,
      browserReady ? browserTranscript.textContent : null,
      audioDuration,
      sMs,
      bMs
    );
  }
}

function parseMetric(text) {
  const m = text.match(/([\d.]+)s/);
  return m ? parseFloat(m[1]) * 1000 : 0;
}

function addToHistory(serverText, browserText, duration, serverMs, browserMs) {
  const entry = document.createElement("div");
  entry.className = "history-entry";
  const time = new Date().toLocaleTimeString("nb-NO");
  const dur = duration.toFixed(1);
  const sTime = (serverMs / 1000).toFixed(2);
  const bTime = browserMs !== null ? (browserMs / 1000).toFixed(2) : "—";
  const winner = browserMs !== null
    ? (serverMs < browserMs ? "server" : "browser")
    : "server";

  entry.innerHTML = `
    <div class="history-meta">
      <span class="time">${time}</span>
      <span class="duration">Opptak: ${dur}s</span>
    </div>
    <div class="history-times">
      <span class="${winner === 'server' ? 'winner' : ''}">Server: ${sTime}s</span>
      <span class="${winner === 'browser' ? 'winner' : ''}">Browser: ${bTime}s</span>
    </div>
    <div class="history-texts">
      <p><strong>S:</strong> ${serverText}</p>
      ${browserText ? `<p><strong>B:</strong> ${browserText}</p>` : ""}
    </div>`;
  historyEl.prepend(entry);
}

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

  serverMetric.textContent = "";
  serverMetric.className = "metric";
  browserMetric.textContent = "";
  browserMetric.className = "metric";
  serverTranscript.textContent = "Venter...";
  browserTranscript.textContent = "Venter...";
  serverStatus.textContent = "";
  if (browserReady) browserStatus.textContent = "";
}

async function stopRecording() {
  recording = false;
  recordBtn.textContent = "Ta opp";
  recordBtn.classList.remove("recording");
  recordingStopTime = performance.now();

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
  if (browserReady) transcribeBrowser(pcm);
}

async function transcribeServer(pcm, sampleRate) {
  serverStatus.textContent = "Transkriberer...";
  serverStatus.className = "status processing";
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

    serverTranscript.textContent = data.text || "(ingen tale gjenkjent)";
    serverMetric.textContent = `${(elapsed / 1000).toFixed(2)}s`;
    serverMetric.className = "metric done";
    serverStatus.textContent = "Ferdig!";
    serverStatus.className = "status success";
  } catch (e) {
    serverStatus.textContent = `Feil: ${e.message}`;
    serverStatus.className = "status error";
    serverMetric.textContent = "feilet";
    serverMetric.className = "metric done";
  } finally {
    recordBtn.disabled = false;
    checkBothDone();
  }
}

function transcribeBrowser(pcm) {
  browserStatus.textContent = "Transkriberer...";
  browserStatus.className = "status processing";
  worker.postMessage({ type: "transcribe", audio: pcm }, [pcm.buffer]);
}

recordBtn.addEventListener("click", () => {
  if (recording) stopRecording(); else startRecording();
});

document.addEventListener("keydown", (e) => {
  if (e.code === "Space" && e.target === document.body) {
    e.preventDefault();
    recordBtn.click();
  }
});
