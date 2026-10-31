#!/usr/bin/env python3
"""
generate_narration.py
Generates edge-tts voiceover (en-US-JennyNeural) for each scene defined in scenes_config.json,
measures exact durations via ffprobe, and generates synchronized SRT and VTT subtitle files.
"""

import asyncio
import json
import os
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config" / "scenes_config.json"
TIMING_PATH = BASE_DIR / "config" / "scenes_timing.json"
AUDIO_DIR = BASE_DIR / "assets" / "audio" / "narration"
SUBTITLES_DIR = BASE_DIR / "subtitles"
FFPROBE_PATH = r"C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffprobe.exe"


def format_srt_time(seconds: float) -> str:
    millis = int((seconds % 1) * 1000)
    secs = int(seconds) % 60
    mins = int(seconds // 60) % 60
    hours = int(seconds // 3600)
    return f"{hours:02d}:{mins:02d}:{secs:02d},{millis:03d}"


def format_vtt_time(seconds: float) -> str:
    millis = int((seconds % 1) * 1000)
    secs = int(seconds) % 60
    mins = int(seconds // 60) % 60
    hours = int(seconds // 3600)
    return f"{hours:02d}:{mins:02d}:{secs:02d}.{millis:03d}"


def get_audio_duration(file_path: Path) -> float:
    cmd = [
        FFPROBE_PATH,
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        str(file_path)
    ]
    try:
        res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, check=True)
        return float(res.stdout.strip())
    except Exception as e:
        print(f"Error measuring audio duration for {file_path}: {e}")
        return 10.0


async def generate_scene_speech(voice: str, text: str, output_path: Path):
    cmd = [
        sys.executable,
        "-m", "edge_tts",
        "--voice", voice,
        "--text", text,
        "--write-media", str(output_path)
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    stdout, stderr = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"edge-tts error for {output_path.name}: {stderr.decode()}")


async def main():
    print("=" * 80)
    print(" BRIGHTLOOP VIDEO PRODUCTION: NARRATION & SUBTITLE GENERATOR")
    print("=" * 80)

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    voice = config["project"].get("voice", "en-US-JennyNeural")
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    SUBTITLES_DIR.mkdir(parents=True, exist_ok=True)

    scenes = config["scenes"]
    timing_data = []

    srt_entries = []
    vtt_entries = ["WEBVTT\n"]

    current_timestamp = 0.5  # slight 0.5s breathing lead-in

    for idx, sc in enumerate(scenes, 1):
        scene_id = sc["id"]
        narration = sc["narration"]
        out_audio = AUDIO_DIR / f"{scene_id}.mp3"

        print(f"[{idx}/{len(scenes)}] Generating audio for: {scene_id} ({sc['title']})...")
        await generate_scene_speech(voice, narration, out_audio)

        duration = get_audio_duration(out_audio)
        # Pad slightly (e.g. 0.8s) for scene visual settling and subtitle clarity
        clip_duration = round(duration + 0.8, 2)

        start_time = current_timestamp
        end_time = start_time + duration

        srt_entries.append(
            f"{idx}\n"
            f"{format_srt_time(start_time)} --> {format_srt_time(end_time)}\n"
            f"{narration}\n"
        )

        vtt_entries.append(
            f"{format_vtt_time(start_time)} --> {format_vtt_time(end_time)}\n"
            f"{narration}\n"
        )

        timing_data.append({
            "id": scene_id,
            "scene_number": sc["scene_number"],
            "title": sc["title"],
            "narration": narration,
            "audio_file": str(out_audio.relative_to(BASE_DIR)).replace("\\", "/"),
            "audio_duration": duration,
            "clip_duration": clip_duration,
            "start_time": round(start_time, 2),
            "end_time": round(end_time, 2),
            "is_slot": sc.get("is_slot", False),
            "slot_name": sc.get("slot_name")
        })

        current_timestamp += clip_duration

    total_duration = round(current_timestamp, 2)
    print(f"\nAll narration generated successfully! Total video length: {total_duration}s (~{int(total_duration // 60)}m {int(total_duration % 60)}s)")

    # Save timings
    with open(TIMING_PATH, "w", encoding="utf-8") as f:
        json.dump({
            "project": config["project"],
            "total_duration": total_duration,
            "scenes": timing_data
        }, f, indent=2)
    print(f"Saved scene timing metadata to: {TIMING_PATH}")

    # Write SRT
    srt_path = SUBTITLES_DIR / "brightloop_demo.srt"
    with open(srt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(srt_entries))
    print(f"Saved SRT subtitles to: {srt_path}")

    # Write VTT
    vtt_path = SUBTITLES_DIR / "brightloop_demo.vtt"
    with open(vtt_path, "w", encoding="utf-8") as f:
        f.write("\n".join(vtt_entries))
    print(f"Saved WebVTT subtitles to: {vtt_path}")
    print("=" * 80)


if __name__ == "__main__":
    asyncio.run(main())

