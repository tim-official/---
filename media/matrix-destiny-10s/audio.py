import argparse
import asyncio
import json
import wave
from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parent
RATE = 48000
DURATION = 10
LINES = [
    ("01-title", "Матрица судьбы.", 0.65, 2.7),
    ("02-path", "Твоя дата. Твой путь.", 2.95, 5.9),
    ("03-discovery", "Открой себя с новой стороны.", 6.25, 9.6),
]


async def narrate():
    import edge_tts

    destination = ROOT / "audio"
    destination.mkdir(exist_ok=True)
    for name, text, _, _ in LINES:
        path = destination / f"{name}.mp3"
        if path.exists():
            decode_voice(path)
            print(f"Reusing validated recording: {name}", flush=True)
            continue
        temporary = destination / f"{name}.part.mp3"
        metadata = destination / f"{name}.part.json"
        voice = edge_tts.Communicate(
            text, "ru-RU-DmitryNeural", rate="-4%", pitch="-5Hz",
            connect_timeout=15, receive_timeout=45,
        )
        async with asyncio.timeout(80):
            await voice.save(str(temporary), str(metadata))
        decode_voice(temporary)
        temporary.replace(path)
        metadata.replace(path.with_suffix(".json"))
        print(f"Recorded {name}: {path.stat().st_size} bytes", flush=True)
        await asyncio.sleep(1)


def decode_voice(path):
    resampler = av.AudioResampler(format="fltp", layout="mono", rate=RATE)
    parts = []
    with av.open(path) as container:
        for frame in container.decode(audio=0):
            parts.extend(item.to_ndarray()[0] for item in resampler.resample(frame))
        parts.extend(item.to_ndarray()[0] for item in resampler.resample(None))
    signal = np.concatenate(parts)
    audible = np.flatnonzero(np.abs(signal) > max(0.004, float(np.max(np.abs(signal))) * 0.025))
    if not len(audible):
        raise ValueError(f"Received silent narration: {path}")
    left = max(0, audible[0] - int(0.08 * RATE))
    right = min(len(signal), audible[-1] + int(0.16 * RATE))
    return signal[left:right].astype(np.float64)


def mix():
    n = RATE * DURATION
    time = np.arange(n) / RATE
    voice_track = np.zeros(n)
    timings = []
    for name, text, start, limit in LINES:
        signal = decode_voice(ROOT / "audio" / f"{name}.mp3")
        end = start + len(signal) / RATE
        if end > limit:
            raise ValueError(f"{name} ends at {end:.3f}s, beyond its {limit}s scene; retime before mixing")
        signal *= 0.74 / np.max(np.abs(signal))
        first = int(start * RATE)
        voice_track[first:first + len(signal)] += signal
        timings.append({"text": text, "start": start, "end": round(end, 4)})
    atmosphere = np.zeros((2, n))
    fade = np.minimum(time / 0.8, 1) * np.clip((10 - time) / 1.15, 0, 1)
    for i, frequency in enumerate((73.416, 110, 146.832, 174.614, 220)):
        for channel in range(2):
            detune = 1 + (channel * 2 - 1) * 0.0011
            tone = np.sin(2 * np.pi * frequency * detune * time + i * 0.6)
            shimmer = np.sin(2 * np.pi * frequency * 2.002 * time + channel)
            envelope = 0.74 + 0.26 * np.sin(time * 0.48 + i)
            atmosphere[channel] += (tone + shimmer * 0.17) * envelope * (0.009 / (1 + i * 0.4))
    rng = np.random.default_rng(22)
    noise = rng.standard_normal(n)
    spectrum = np.fft.rfft(noise)
    frequencies = np.fft.rfftfreq(n, 1 / RATE)
    spectrum *= np.exp(-((frequencies - 1400) / 950)**2)
    air = np.fft.irfft(spectrum, n=n)
    for onset, level in ((0.3, 0.016), (2.65, 0.012), (6.0, 0.019)):
        swell = np.exp(-((time - onset - 0.45) / 0.55)**2)
        atmosphere[0] += air * swell * level
        atmosphere[1] += np.roll(air, 240) * swell * level
    for onset, frequency in ((0.38, 587.33), (2.65, 880), (4.38, 1174.66), (6.18, 783.99)):
        elapsed = np.maximum(time - onset, 0)
        bell = (1 - np.exp(-elapsed * 65)) * np.exp(-elapsed * 2.1) * (time >= onset)
        chime = np.sin(2 * np.pi * frequency * elapsed) + 0.24 * np.sin(2 * np.pi * frequency * 2.756 * elapsed)
        atmosphere[0] += chime * bell * 0.024
        atmosphere[1] += np.roll(chime * bell, 510) * 0.020
    duck = np.ones(n)
    for timing in timings:
        attack = np.clip((time - timing["start"] + 0.15) / 0.15, 0, 1)
        release = np.clip((timing["end"] + 0.3 - time) / 0.3, 0, 1)
        duck *= 1 - 0.28 * attack * release
    atmosphere *= fade * duck
    track = atmosphere + voice_track[None, :]
    peak = float(np.abs(track).max())
    if peak > 0.85:
        track *= 0.85 / peak
    pcm = np.round(track.T * 32767).astype("<i2")
    path = ROOT / "audio" / "master.wav"
    with wave.open(str(path), "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(pcm.tobytes())
    (ROOT / "narration.json").write_text(
        json.dumps({"voice": "ru-RU-DmitryNeural", "timings": timings, "seconds": DURATION}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps({"timings": timings, "samples": n, "peak": float(np.abs(track).max())}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("narrate", "mix"))
    args = parser.parse_args()
    if args.action == "narrate":
        asyncio.run(narrate())
    else:
        mix()
