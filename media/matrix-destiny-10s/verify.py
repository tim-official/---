import json
import wave
from pathlib import Path

import av
import numpy as np
from av.video.reformatter import ColorRange, Interpolation


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "matrix-destiny-10s.mp4"
STILLS = ROOT.parents[1] / ".tools" / "matrix-video-work" / "stills"
REFERENCE_FRAMES = (48, 150, 285, 450, 558)
POSTER_FRAME = 558
ACCURATE = Interpolation.BICUBIC | Interpolation.ACCURATE_RND | Interpolation.FULL_CHR_H_INT
EXPECTED_SPEECH = [
    ("01-title", "Матрица судьбы."),
    ("02-path", "Твоя дата. Твой путь."),
    ("03-discovery", "Открой себя с новой стороны."),
]


def read_png(path):
    if not path.is_file():
        raise FileNotFoundError(f"Render the lossless stills before verification: {path}")
    with av.open(str(path)) as container:
        return next(container.decode(video=0)).to_ndarray(format="rgb24").astype(np.float64)


def compare(image, reference):
    shift = float(np.abs(image.reshape(-1, 3).mean(0) - reference.reshape(-1, 3).mean(0)).max())
    psnr = float(10 * np.log10(255**2 / np.mean((image - reference) ** 2)))
    return psnr, shift


def verify():
    if not VIDEO.is_file():
        raise FileNotFoundError(f"The requested video has not been rendered: {VIDEO}")
    narration = json.loads((ROOT / "narration.json").read_text(encoding="utf-8"))
    assert [item["text"] for item in narration["timings"]] == [text for _, text in EXPECTED_SPEECH]
    assert narration["timings"][-1]["end"] <= 9.6, "The complete narration must finish without being cut off"
    for name, text in EXPECTED_SPEECH:
        metadata = (ROOT / "audio" / f"{name}.json").read_text(encoding="utf-8").splitlines()
        sentences = [json.loads(line)["text"] for line in metadata]
        assert " ".join(sentences) == text, f"Provider did not confirm the complete approved text: {name}"
    with av.open(VIDEO) as container:
        video = container.streams.video[0]
        video.codec_context.thread_count = 1
        audio = container.streams.audio[0]
        assert (video.width, video.height) == (1080, 1920), "Incorrect vertical resolution"
        assert video.average_rate == 60, "Video must be 60 fps"
        assert video.codec_context.name == "h264", "Expected broadly compatible H.264"
        assert video.codec_context.format.name == "yuv420p", "Expected 8-bit 4:2:0 video"
        tags = (video.codec_context.color_range, video.codec_context.colorspace, video.codec_context.color_primaries, video.codec_context.color_trc)
        assert tags == (1, 1, 1, 1), f"Expected BT.709 limited-range colour tags, got {tags}"
        assert audio.codec_context.name == "aac", "Expected AAC narration/music"
        assert audio.codec_context.sample_rate == 48000, "Audio must be 48 kHz"
        assert len(audio.codec_context.layout.channels) == 2, "Expected stereo audio"
        duration = container.duration / av.time_base
        assert abs(duration - 10.0) < 0.003, f"Expected 10.000 seconds, got {duration}"
        samples = {}
        count = 0
        for frame in container.decode(video=0):
            assert abs(frame.time - count / 60) < 0.00001, f"Discontinuous video timing at frame {count}"
            if count in REFERENCE_FRAMES:
                samples[count] = frame.reformat(
                    format="rgb24", src_colorspace="ITU709", src_color_range=ColorRange.MPEG,
                    dst_color_range=ColorRange.JPEG, interpolation=ACCURATE, threads=1,
                ).to_ndarray().astype(np.float64)
            count += 1
        assert count == 600, f"Expected exactly 600 frames, got {count}"
    fidelity = {}
    for number, image in samples.items():
        psnr, shift = compare(image, read_png(STILLS / f"{number:05}.png"))
        assert psnr > 32, f"Frame {number} differs from the rendered artwork: {psnr:.2f} dB"
        assert shift < 1.5, f"Frame {number} colours drift from the rendered artwork: {shift:.3f}"
        fidelity[number] = (psnr, shift)
    change = np.abs(samples[150] - samples[450]).mean()
    assert change > 2, "The animation appears frozen"
    with av.open(VIDEO) as container:
        chunks = [frame.to_ndarray() for frame in container.decode(audio=0)]
    waveform = np.concatenate(chunks, axis=1)
    assert 480000 <= waveform.shape[1] <= 481024, "Audio samples are missing or excessive"
    with wave.open(str(ROOT / "audio" / "master.wav"), "rb") as source:
        reference = np.frombuffer(source.readframes(480000), dtype="<i2").reshape(-1, 2).T / 32768
    correlation = float(np.corrcoef(reference.ravel(), waveform[:, :480000].ravel())[0, 1])
    assert correlation > 0.99, f"Encoded audio differs from the complete soundtrack: {correlation}"
    peak = float(np.max(np.abs(waveform)))
    rms = float(np.sqrt(np.mean(waveform**2)))
    assert 0.1 < peak < 0.99, f"Audio is absent or clipping: peak={peak}"
    assert 0.025 < rms < 0.3, f"Unexpected audio level: RMS={rms}"
    for start, end in ((0.8, 2.3), (3.1, 5.3), (6.3, 9.1)):
        region = waveform[:, int(start * 48000):int(end * 48000)]
        assert float(np.sqrt(np.mean(region**2))) > 0.045, "A narration segment is missing"
    assert (ROOT / "poster.png").is_file(), "Poster is missing"
    poster_psnr, colour_shift = compare(read_png(ROOT / "poster.png"), read_png(STILLS / f"{POSTER_FRAME:05}.png"))
    assert colour_shift < 1.5, f"Poster colours drift from the rendered artwork: {colour_shift:.3f}"
    assert poster_psnr > 32, f"Poster differs too much from the rendered artwork: {poster_psnr:.2f} dB"
    report = {
        "file": VIDEO.name,
        "dimensions": [1080, 1920],
        "duration_seconds": duration,
        "fps": 60,
        "frames": count,
        "video_codec": "h264",
        "audio_codec": "aac",
        "colour": "BT.709 limited range",
        "reference_psnr_db": {str(number): round(psnr, 2) for number, (psnr, _) in fidelity.items()},
        "reference_max_mean_channel_shift": round(max(shift for _, shift in fidelity.values()), 3),
        "poster_psnr_db": round(poster_psnr, 2),
        "poster_max_mean_channel_shift": round(colour_shift, 3),
        "audio_peak_dbfs": round(20 * np.log10(peak), 2),
        "audio_rms_dbfs": round(20 * np.log10(rms), 2),
        "complete_narration_verified": True,
        "audio_correlation": round(correlation, 5),
        "visual_change_mean": round(float(change), 2),
        "bytes": VIDEO.stat().st_size,
    }
    (ROOT / "verification.json").write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    verify()
