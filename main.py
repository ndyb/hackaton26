import asyncio
import io
import os
import re
import struct
import subprocess
import time
from contextlib import asynccontextmanager

import numpy as np
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pywhispercpp.model import Model
from scipy.signal import resample as scipy_resample

MODEL_PATH = os.environ.get("WHISPER_MODEL", "/models/nb-whisper-medium-q5_0.bin")
BUILD_SHA = os.environ.get("BUILD_SHA", "dev")
N_THREADS = int(os.environ.get("WHISPER_THREADS", "4"))
PIPER_BINARY = os.environ.get("PIPER_BINARY", "piper")
PIPER_MODEL = os.environ.get("PIPER_MODEL", "/models/piper/en_US-lessac-medium.onnx")

WHISPER_SAMPLE_RATE = 16000
MAX_DURATION_S = 120
MIN_DURATION_S = 0.5

SUPPRESS_HALLUCINATIONS = [
    "Takk for at du så på.",
    "Takk for at du så på!",
    "Undertekster av Nicolai Winther",
    "Tekst: Nicolai Winther",
]

SPECIAL_TOKEN_RE = re.compile(r"<\|[^|]*\|>")

whisper_model: Model | None = None
transcribe_sem: asyncio.Semaphore | None = None
tts_sem: asyncio.Semaphore | None = None
tts_available = False


def normalize_for_match(s: str) -> str:
    return " ".join(s.lower().split()).rstrip(".!?…").strip()


def is_hallucination(text: str) -> bool:
    normalized = normalize_for_match(text)
    for bad in SUPPRESS_HALLUCINATIONS:
        n_bad = normalize_for_match(bad)
        if not n_bad:
            continue
        if normalized == n_bad:
            return True
        if normalized.startswith(n_bad):
            rest = normalized[len(n_bad):]
            after_punct = rest.lstrip(".!?…")
            if not after_punct or after_punct.startswith(" "):
                return True
    return False


def clean_transcript(raw: str) -> str:
    stripped = SPECIAL_TOKEN_RE.sub("", raw).strip()
    if not stripped or is_hallucination(stripped):
        return ""
    return stripped


def check_piper() -> bool:
    try:
        subprocess.run(
            [PIPER_BINARY, "--help"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=5,
        )
        return os.path.isfile(PIPER_MODEL)
    except Exception:
        return False


def synthesize_piper(text: str, speed: float) -> bytes:
    length_scale = 1.0 / speed if speed > 0 else 1.0
    proc = subprocess.run(
        [PIPER_BINARY, "--model", PIPER_MODEL, "--output-raw",
         "--length-scale", f"{length_scale:.2f}"],
        input=text.encode(),
        capture_output=True,
        timeout=30,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.decode().strip())
    pcm = proc.stdout
    if not pcm:
        raise RuntimeError("Piper produced no audio")
    return wrap_wav(pcm)


def wrap_wav(pcm: bytes) -> bytes:
    sample_rate = 22050
    channels = 1
    bits = 16
    data_len = len(pcm)
    byte_rate = sample_rate * channels * bits // 8
    block_align = channels * bits // 8
    buf = io.BytesIO()
    buf.write(b"RIFF")
    buf.write(struct.pack("<I", 36 + data_len))
    buf.write(b"WAVE")
    buf.write(b"fmt ")
    buf.write(struct.pack("<IHHIIHH", 16, 1, channels, sample_rate, byte_rate, block_align, bits))
    buf.write(b"data")
    buf.write(struct.pack("<I", data_len))
    buf.write(pcm)
    return buf.getvalue()


@asynccontextmanager
async def lifespan(app: FastAPI):
    global whisper_model, transcribe_sem, tts_sem, tts_available
    print(f"Laster Whisper-modell fra {MODEL_PATH}...")
    t0 = time.time()
    whisper_model = Model(
        MODEL_PATH,
        params_sampling_strategy=1,
        n_threads=N_THREADS,
        language="no",
        print_progress=False,
        print_realtime=False,
        print_timestamps=False,
    )
    print(f"Modell lastet på {time.time() - t0:.1f}s")
    transcribe_sem = asyncio.Semaphore(1)
    tts_sem = asyncio.Semaphore(2)
    tts_available = check_piper()
    print(f"TTS: {'tilgjengelig' if tts_available else 'ikke tilgjengelig'}")
    yield
    whisper_model = None


app = FastAPI(title="Skansen – Norsk tale-til-tekst", lifespan=lifespan)


@app.post("/api/transcribe")
async def transcribe(
    audio: UploadFile = File(...),
    sample_rate: int = Form(48000),
):
    if whisper_model is None:
        raise HTTPException(503, "Modell ikke lastet")
    if not (8000 <= sample_rate <= 192000):
        raise HTTPException(400, f"Ugyldig sample rate: {sample_rate}")

    raw = await audio.read()
    if len(raw) == 0:
        raise HTTPException(400, "Tom lydfil")
    if len(raw) % 4 != 0:
        raise HTTPException(400, "Ugyldig lydformat (må være float32)")

    samples = np.frombuffer(raw, dtype=np.float32)
    duration = len(samples) / sample_rate

    if duration < MIN_DURATION_S:
        return JSONResponse({"text": "", "duration": duration})
    if duration > MAX_DURATION_S:
        raise HTTPException(400, f"Klippet er for langt ({duration:.0f}s, maks {MAX_DURATION_S}s)")

    if sample_rate != WHISPER_SAMPLE_RATE:
        new_length = int(len(samples) * WHISPER_SAMPLE_RATE / sample_rate)
        samples = scipy_resample(samples, new_length).astype(np.float32)

    try:
        await asyncio.wait_for(transcribe_sem.acquire(), timeout=0.25)
    except asyncio.TimeoutError:
        raise HTTPException(503, "Transkribering opptatt, prøv igjen")

    try:
        segments = await asyncio.to_thread(
            whisper_model.transcribe,
            samples,
            max_tokens=128,
            no_context=True,
            temperature=0.0,
            no_speech_thold=0.6,
            entropy_thold=2.6,
            logprob_thold=-1.0,
            suppress_blank=True,
        )
    finally:
        transcribe_sem.release()

    raw_text = " ".join(seg.text.strip() for seg in segments if seg.text.strip())
    text = clean_transcript(raw_text)

    return JSONResponse({"text": text, "duration": duration})


@app.post("/api/tts")
async def text_to_speech(text: str = Form(...), speed: float = Form(1.0)):
    if not tts_available:
        raise HTTPException(503, "TTS ikke tilgjengelig")
    if not text or len(text) > 5000:
        raise HTTPException(400, "Tekst mangler eller for lang (maks 5000 tegn)")
    if not (0.25 <= speed <= 4.0):
        raise HTTPException(400, "Speed må være mellom 0.25 og 4.0")

    try:
        await asyncio.wait_for(tts_sem.acquire(), timeout=0.25)
    except asyncio.TimeoutError:
        raise HTTPException(503, "TTS opptatt, prøv igjen")

    try:
        wav = await asyncio.to_thread(synthesize_piper, text, speed)
    finally:
        tts_sem.release()

    return Response(content=wav, media_type="audio/wav")


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "model_loaded": whisper_model is not None,
        "tts_available": tts_available,
        "version": BUILD_SHA,
    }


@app.get("/pcm-worklet.js")
async def pcm_worklet():
    return FileResponse("static/pcm-worklet.js", media_type="application/javascript")


app.mount("/", StaticFiles(directory="static", html=True), name="static")
