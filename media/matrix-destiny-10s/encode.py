import wave
from fractions import Fraction
from pathlib import Path

import av
import numpy as np
from av.video.reformatter import ColorRange, Interpolation


ROOT = Path(__file__).resolve().parent
WORK = ROOT.parents[1] / ".tools" / "matrix-video-work"
FPS = 60
SAMPLE_RATE = 48000
TOTAL_FRAMES = 600
# Swscale's fast YUV->RGB path shifts the near-black green background toward blue.
ACCURATE = Interpolation.BICUBIC | Interpolation.ACCURATE_RND | Interpolation.FULL_CHR_H_INT
VIDEO_OPTIONS = {
    "crf": "18", "maxrate": "20M", "bufsize": "40M",
    "preset": "slow", "profile": "high", "level": "4.2",
    "x264-params": "rc-lookahead=12:sync-lookahead=0:lookahead-threads=1",
}


def source_to_video(frame):
    if frame.format.name != "yuvj420p" or frame.color_range != ColorRange.JPEG:
        raise ValueError(f"Expected full-range JPEG frames, got {frame.format.name}/{frame.color_range}")
    rgb = frame.reformat(
        format="rgb24", src_colorspace="ITU601", src_color_range=ColorRange.JPEG,
        dst_color_range=ColorRange.JPEG, interpolation=ACCURATE, threads=1,
    )
    video = rgb.reformat(
        format="yuv420p", dst_colorspace="ITU709", dst_color_range=ColorRange.MPEG,
        interpolation=Interpolation.BICUBIC | Interpolation.ACCURATE_RND, threads=1,
    )
    video.color_range = ColorRange.MPEG
    return video


def video_to_rgb(frame):
    return frame.reformat(
        format="rgb24", src_colorspace="ITU709", src_color_range=ColorRange.MPEG,
        dst_color_range=ColorRange.JPEG, interpolation=ACCURATE, threads=1,
    )


def save_png(frame, path):
    encoder = av.CodecContext.create("png", "w")
    encoder.width = frame.width
    encoder.height = frame.height
    encoder.pix_fmt = "rgb24"
    encoder.thread_count = 1
    encoder.time_base = Fraction(1, 1)
    image = video_to_rgb(frame)
    image.pts = 0
    packets = encoder.encode(image) + encoder.encode(None)
    path.write_bytes(b"".join(bytes(packet) for packet in packets))


def encode():
    paths = [WORK / "frames" / f"{index:05}.jpg" for index in range(TOTAL_FRAMES)]
    for path in paths:
        if not path.is_file():
            raise FileNotFoundError(f"Render every frame before encoding: {path}")
    with wave.open(str(ROOT / "audio" / "master.wav"), "rb") as source:
        if (source.getnchannels(), source.getsampwidth(), source.getframerate(), source.getnframes()) != (2, 2, SAMPLE_RATE, 480000):
            raise ValueError("The soundtrack must be exactly ten seconds of 48 kHz stereo 16-bit PCM")
        waveform = np.frombuffer(source.readframes(480000), dtype="<i2").reshape(-1, 2).T.astype(np.float32) / 32768
    temporary = ROOT / "matrix-destiny-10s.part.mp4"
    with (
        av.open(str(WORK / "frames" / "%05d.jpg"), format="image2", options={"framerate": str(FPS), "start_number": "0"}) as images,
        av.open(temporary, "w", format="mp4", options={"movflags": "+faststart"}) as output,
    ):
        images.streams.video[0].codec_context.thread_count = 1
        frames = images.decode(video=0)
        output.metadata["title"] = "Матрица судьбы"
        output.metadata["comment"] = "Original symbolic animation, original ambient music, synthetic Russian narration."
        video = output.add_stream("libx264", rate=FPS)
        video.width = 1080
        video.height = 1920
        video.pix_fmt = "yuv420p"
        video.time_base = Fraction(1, FPS)
        video.codec_context.time_base = Fraction(1, FPS)
        video.codec_context.thread_count = 2
        video.codec_context.gop_size = FPS * 2
        video.codec_context.color_range = ColorRange.MPEG
        video.codec_context.color_primaries = 1
        video.codec_context.color_trc = 1
        video.codec_context.colorspace = 1
        video.options = VIDEO_OPTIONS
        audio = output.add_stream("aac", rate=SAMPLE_RATE)
        audio.layout = "stereo"
        audio.bit_rate = 192000
        audio.time_base = Fraction(1, SAMPLE_RATE)
        sample = 0
        for index, path in enumerate(paths):
            frame = next(frames)
            if (frame.width, frame.height) != (1080, 1920):
                raise ValueError(f"Unexpected frame dimensions: {path}")
            frame = source_to_video(frame)
            frame.pts = index
            frame.time_base = Fraction(1, FPS)
            for packet in video.encode(frame):
                output.mux(packet)
            end = (index + 1) * SAMPLE_RATE // FPS
            while sample < end:
                count = min(1024, waveform.shape[1] - sample)
                segment = np.ascontiguousarray(waveform[:, sample:sample + count])
                audio_frame = av.AudioFrame.from_ndarray(segment, format="fltp", layout="stereo")
                audio_frame.sample_rate = SAMPLE_RATE
                audio_frame.pts = sample
                audio_frame.time_base = Fraction(1, SAMPLE_RATE)
                for packet in audio.encode(audio_frame):
                    output.mux(packet)
                sample += count
            if index % FPS == 0:
                print(f"Encoded {index}/{TOTAL_FRAMES} frames", flush=True)
        for packet in video.encode(None):
            output.mux(packet)
        for packet in audio.encode(None):
            output.mux(packet)
    final = ROOT / "matrix-destiny-10s.mp4"
    temporary.replace(final)
    stills = WORK / "encoded"
    stills.mkdir(exist_ok=True)
    with av.open(final) as output:
        output.streams.video[0].codec_context.thread_count = 1
        for index, frame in enumerate(output.decode(video=0)):
            if index in (48, 150, 285, 450, 558):
                save_png(frame, stills / f"{index:05}.png")
            if index == 558:
                save_png(frame, ROOT / "poster.png")
    print(f"Created {final.name}: {final.stat().st_size:,} bytes", flush=True)


if __name__ == "__main__":
    encode()
