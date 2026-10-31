#!/usr/bin/env python3
"""
generate_music.py
Generates a warm, ambient, royalty-free corporate tech soundtrack
using procedural audio synthesis (pure Python standard library wave/math)
and encodes it to MP3 via FFmpeg.
"""

import math
import struct
import subprocess
import wave
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
MUSIC_DIR = BASE_DIR / "assets" / "audio" / "music"
FFMPEG_PATH = r"C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"


def generate_ambient_track(output_wav: Path, duration_sec: float = 140.0):
    sample_rate = 44100
    total_samples = int(sample_rate * duration_sec)

    # Chord progression (frequencies in Hz):
    # Cmaj7 (C4, E4, G4, B4) -> Am7 (A3, C4, E4, G4) -> Fmaj7 (F3, A3, C4, E4) -> G9 (G3, B3, D4, A4)
    chords = [
        [261.63, 329.63, 392.00, 493.88],  # Cmaj7
        [220.00, 261.63, 329.63, 392.00],  # Am7
        [174.61, 220.00, 261.63, 329.63],  # Fmaj7
        [196.00, 246.94, 293.66, 440.00],  # G9
    ]
    chord_len = 8.0  # seconds per chord

    # Open WAV
    with wave.open(str(output_wav), "w") as wav:
        wav.setnchannels(2)  # Stereo
        wav.setsampwidth(2)  # 16-bit
        wav.setframerate(sample_rate)

        chunk_size = 4096
        sample_idx = 0

        while sample_idx < total_samples:
            chunk = []
            curr_chunk_size = min(chunk_size, total_samples - sample_idx)

            for _ in range(curr_chunk_size):
                t = sample_idx / sample_rate

                # Master fade in (3s) and fade out (5s)
                fade_in = min(1.0, t / 3.0)
                fade_out = min(1.0, (duration_sec - t) / 5.0) if t > duration_sec - 5.0 else 1.0
                envelope = fade_in * fade_out

                # Current chord index
                chord_idx = int(t / chord_len) % len(chords)
                chord_freqs = chords[chord_idx]

                # Intra-chord smooth crossfade
                intra_t = (t % chord_len) / chord_len
                chord_env = math.sin(intra_t * math.pi) ** 0.5

                left = 0.0
                right = 0.0

                # Subtle pulsing LFO
                lfo = 0.85 + 0.15 * math.sin(2 * math.pi * 0.25 * t)

                # Synthesize chord harmonics with gentle chorus panning
                for i, freq in enumerate(chord_freqs):
                    # Fundamental + soft second harmonic
                    wave_val = 0.6 * math.sin(2 * math.pi * freq * t) + 0.3 * math.sin(4 * math.pi * freq * t)
                    pan = 0.3 + 0.4 * (i / (len(chord_freqs) - 1))  # stereo spread

                    left += wave_val * (1.0 - pan)
                    right += wave_val * pan

                # Deep warm sub-bass (fundamental / 2)
                sub_freq = chord_freqs[0] / 2.0
                sub_val = 0.5 * math.sin(2 * math.pi * sub_freq * t)
                left += sub_val * 0.5
                right += sub_val * 0.5

                # High shimmering bell harmonic
                shimmer = 0.15 * math.sin(2 * math.pi * chord_freqs[-1] * 2.0 * t) * math.sin(2 * math.pi * 1.5 * t)
                left += shimmer * 0.3
                right += shimmer * 0.7

                # Normalize and scale
                gain = 0.28 * envelope * chord_env * lfo
                s_left = max(-32767, min(32767, int(left * gain * 32767)))
                s_right = max(-32767, min(32767, int(right * gain * 32767)))

                chunk.append(struct.pack("<hh", s_left, s_right))
                sample_idx += 1

            wav.writeframes(b"".join(chunk))


def main():
    print("=" * 80)
    print(" BRIGHTLOOP VIDEO PRODUCTION: PROCEDURAL MUSIC GENERATOR")
    print("=" * 80)
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)

    wav_path = MUSIC_DIR / "ambient_background.wav"
    mp3_path = MUSIC_DIR / "ambient_background.mp3"

    print(f"Synthesizing 140s ambient corporate tech audio -> {wav_path.name}...")
    generate_ambient_track(wav_path, duration_sec=140.0)
    print(f"Generated WAV ({wav_path.stat().st_size / 1024 / 1024:.2f} MB)")

    print(f"Encoding to MP3 via FFmpeg -> {mp3_path.name}...")
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-i", str(wav_path),
        "-codec:a", "libmp3lame",
        "-b:a", "192k",
        str(mp3_path)
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    print(f"Generated MP3 ({mp3_path.stat().st_size / 1024:.1f} KB)")

    if wav_path.exists():
        wav_path.unlink()  # remove large wav

    print("Background soundtrack ready!")
    print("=" * 80)


if __name__ == "__main__":
    main()

