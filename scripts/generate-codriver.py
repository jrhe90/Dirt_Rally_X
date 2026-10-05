"""Render the co-driver pace-note vocabulary with Piper TTS into one audio sprite per language.

Usage: npm run generate-codriver  (or python3 scripts/generate-codriver.py [--voices-dir .cache/voices] [--lang zh en])

Needs `pip install "piper-tts[zh]"` and ffmpeg with libmp3lame. Voice models (~60 MB each) are
downloaded once into the voices dir, which is git-ignored. Output goes to public/assets/audio/.
"""

import argparse
import io
import json
import subprocess
import tempfile
import urllib.request
import wave
from pathlib import Path

import numpy as np
from piper import PiperVoice, SynthesisConfig

ROOT = Path(__file__).resolve().parent.parent
LINES = ROOT / "src/game/audio/codriverLines.json"
PHRASES = ROOT / "scripts/pacenote-phrases.json"
OUT_DIR = ROOT / "public/assets/audio"
VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main"

VOICES = {
    "zh": {"path": "zh/zh_CN/chaowen/medium/zh_CN-chaowen-medium", "length_scale": 0.78},
    "en": {
        "path": "en/en_GB/northern_english_male/medium/en_GB-northern_english_male-medium",
        "length_scale": 0.8,
    },
}

GAP_SECONDS = 0.12
TARGET_RMS_DB = -17.0
PEAK_LIMIT = 0.95


def ensure_voice(voices_dir: Path, rel: str) -> Path:
    voices_dir.mkdir(parents=True, exist_ok=True)
    model = voices_dir / (Path(rel).name + ".onnx")
    for suffix in (".onnx", ".onnx.json"):
        target = voices_dir / (Path(rel).name + suffix)
        if not target.exists():
            print(f"downloading {target.name}")
            urllib.request.urlretrieve(f"{VOICE_BASE}/{rel}{suffix}", target)
    return model


def synthesize(voice: PiperVoice, text: str, length_scale: float) -> tuple[np.ndarray, int]:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        voice.synthesize_wav(text, w, syn_config=SynthesisConfig(length_scale=length_scale))
    buf.seek(0)
    with wave.open(buf, "rb") as w:
        rate = w.getframerate()
        data = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768
    return data, rate


def tidy(x: np.ndarray, rate: int) -> np.ndarray:
    """Trim silence, normalize loudness and fade the edges so clips can be chained tightly."""
    frame = int(rate * 0.01)
    env = np.array([np.abs(x[i : i + frame]).max() for i in range(0, len(x) - frame, frame)])
    loud = np.nonzero(env > env.max() * 0.03)[0]
    # Generous pre-roll keeps soft initial consonants (z, s, f) intact.
    start = max(0, (loud[0] - 4) * frame)
    end = min(len(x), (loud[-1] + 3) * frame)
    x = x[start:end].copy()

    rms = np.sqrt(np.mean(x[x != 0] ** 2))
    x *= 10 ** (TARGET_RMS_DB / 20) / max(rms, 1e-6)
    peak = np.abs(x).max()
    if peak > PEAK_LIMIT:
        x *= PEAK_LIMIT / peak

    fade = int(rate * 0.006)
    x[:fade] *= np.linspace(0, 1, fade)
    x[-fade:] *= np.linspace(1, 0, fade)
    return x


def render(lang: str, voices_dir: Path, lines: dict, phrases: list[str]) -> None:
    cfg = VOICES[lang]
    voice = PiperVoice.load(str(ensure_voice(voices_dir, cfg["path"])), download_dir=voices_dir)
    rate = voice.config.sample_rate
    gap = np.zeros(int(GAP_SECONDS * rate), dtype=np.float32)

    # Single words are the fallback for chaining; whole phrases sound natural in one breath.
    sep = "" if lang == "zh" else " "
    texts = {key: text[lang] for key, text in lines.items()}
    for phrase in phrases:
        texts[phrase] = sep.join(lines[k][lang] for k in phrase.split("+"))

    parts = [gap]
    clips = {}
    cursor = len(gap)
    for key, text in texts.items():
        audio, _ = synthesize(voice, text, cfg["length_scale"])
        audio = tidy(audio, rate)
        clips[key] = [round(cursor / rate, 4), round(len(audio) / rate, 4)]
        parts += [audio, gap]
        cursor += len(audio) + len(gap)
        print(f"  {lang} {len(audio) / rate:.2f}s  {text}")

    pcm = (np.clip(np.concatenate(parts), -1, 1) * 32767).astype(np.int16)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(suffix=".wav") as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1)
            w.setsampwidth(2)
            w.setframerate(rate)
            w.writeframes(pcm.tobytes())
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", tmp.name, "-ac", "1", "-b:a", "48k",
             str(OUT_DIR / f"codriver-{lang}.mp3")],
            check=True,
        )
    manifest = {"sampleRate": rate, "clips": clips}
    (OUT_DIR / f"codriver-{lang}.json").write_text(json.dumps(manifest, indent=1) + "\n")
    print(f"wrote codriver-{lang}.mp3 ({len(pcm) / rate:.1f}s, {len(clips)} clips)")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--voices-dir", type=Path, default=ROOT / ".cache/voices")
    parser.add_argument("--lang", nargs="+", default=list(VOICES))
    args = parser.parse_args()
    lines = json.loads(LINES.read_text())
    phrases = json.loads(PHRASES.read_text()) if PHRASES.exists() else []
    for lang in args.lang:
        render(lang, args.voices_dir, lines, phrases)


if __name__ == "__main__":
    main()
