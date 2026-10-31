#!/usr/bin/env python3
"""
assemble_video.py
Assembles the complete Brightloop demo video using FFmpeg:
1. Generates 1080p 30fps video clips for each scene from images/recordings + narration audio.
2. Concatenates scene clips with seamless visual flow.
3. Mixes narration voiceover with ambient background music.
4. Burns synchronized subtitles from brightloop_demo.srt.
5. Exports production-ready MP4 to output/brightloop_demo_preliminary.mp4.
"""

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
CONFIG_PATH = BASE_DIR / "config" / "scenes_config.json"
TIMING_PATH = BASE_DIR / "config" / "scenes_timing.json"
AUDIO_DIR = BASE_DIR / "assets" / "audio" / "narration"
MUSIC_PATH = BASE_DIR / "assets" / "audio" / "music" / "ambient_background.mp3"
SUBTITLES_PATH = BASE_DIR / "subtitles" / "brightloop_demo.srt"
OUTPUT_DIR = BASE_DIR / "output"
CLIPS_DIR = OUTPUT_DIR / "clips"
FINAL_VIDEO_PATH = OUTPUT_DIR / "brightloop_demo_preliminary.mp4"

FFMPEG_PATH = r"C:\Users\User\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe\ffmpeg-9.0.2-full_build\bin\ffmpeg.exe"


def run_cmd(cmd: list[str], desc: str = ""):
    if desc:
        print(f" -> {desc}")
    res = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    if res.returncode != 0:
        print(f"ERROR in command: {' '.join(cmd)}")
        print(f"STDERR:\n{res.stderr}")
        raise RuntimeError(f"FFmpeg command failed with code {res.returncode}")


def render_scene_clip(scene_info: dict, out_clip_path: Path):
    scene_id = scene_info["id"]
    clip_duration = scene_info["clip_duration"]
    audio_path = BASE_DIR / scene_info["audio_file"]

    # Check for replacement video slot if this is a modular slot
    slot_name = scene_info.get("slot_name")
    video_replacement = None
    if slot_name:
        candidate_mp4 = BASE_DIR / "assets" / "placeholders" / f"{slot_name}.mp4"
        if candidate_mp4.exists() and candidate_mp4.stat().st_size > 0:
            video_replacement = candidate_mp4

    # Determine visual asset
    if video_replacement:
        print(f"   [SLOT POPULATED] Using live recording: {video_replacement.name}")
        # Scale/pad video to 1920x1080 @ 30fps and loop or trim to clip_duration
        cmd = [
            FFMPEG_PATH, "-y",
            "-stream_loop", "-1",
            "-i", str(video_replacement),
            "-i", str(audio_path),
            "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
            "-c:v", "libx264", "-preset", "fast", "-crf", "20", "-r", "30",
            "-c:a", "aac", "-b:a", "192k",
            "-t", str(clip_duration),
            str(out_clip_path)
        ]
        run_cmd(cmd, f"Rendering video slot: {scene_id}")
    else:
        # Static image asset
        # Check if defined in scenes_config.json
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            cfg = json.load(f)
        cfg_scene = next((s for s in cfg["scenes"] if s["id"] == scene_id), None)
        image_rel = cfg_scene["image_asset"] if cfg_scene else f"assets/graphics/{scene_id}.png"
        image_path = BASE_DIR / image_rel

        if not image_path.exists():
            raise FileNotFoundError(f"Visual asset missing: {image_path}")

        # Create clip with loop image and audio
        cmd = [
            FFMPEG_PATH, "-y",
            "-loop", "1",
            "-i", str(image_path),
            "-i", str(audio_path),
            "-c:v", "libx264",
            "-tune", "stillimage",
            "-pix_fmt", "yuv420p",
            "-r", "30",
            "-c:a", "aac",
            "-b:a", "192k",
            "-shortest",
            "-t", str(clip_duration),
            str(out_clip_path)
        ]
        run_cmd(cmd, f"Rendering still clip: {scene_id} ({clip_duration}s)")


def main():
    print("=" * 80)
    print(" BRIGHTLOOP VIDEO PRODUCTION: MASTER VIDEO ASSEMBLER")
    print("=" * 80)

    if not TIMING_PATH.exists():
        print("Timing configuration missing. Run generate_narration.py first.")
        sys.exit(1)

    with open(TIMING_PATH, "r", encoding="utf-8") as f:
        timing_data = json.load(f)

    scenes = timing_data["scenes"]
    total_duration = timing_data["total_duration"]
    print(f"Loaded {len(scenes)} scenes. Target duration: {total_duration}s")

    CLIPS_DIR.mkdir(parents=True, exist_ok=True)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    clip_paths = []

    # 1. Render individual scene clips
    print("\n--- STEP 1: Rendering Individual Scene Clips ---")
    for sc in scenes:
        scene_id = sc["id"]
        out_clip = CLIPS_DIR / f"{scene_id}.mp4"
        print(f"Rendering [{sc['scene_number']}/{len(scenes)}] {scene_id} ({sc['title']})...")
        render_scene_clip(sc, out_clip)
        clip_paths.append(out_clip)

    # 2. Concatenate scene clips
    print("\n--- STEP 2: Concatenating Scene Clips ---")
    concat_list_path = CLIPS_DIR / "concat_list.txt"
    with open(concat_list_path, "w", encoding="utf-8") as f:
        for p in clip_paths:
            f.write(f"file '{p.name}'\n")

    unmixed_video = OUTPUT_DIR / "temp_unmixed.mp4"
    cmd = [
        FFMPEG_PATH, "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", str(concat_list_path),
        "-c", "copy",
        str(unmixed_video)
    ]
    run_cmd(cmd, "Concatenating scene clips into continuous sequence")

    # 3. Mix Audio (Voice + Ambient Music) & Burn Subtitles
    print("\n--- STEP 3: Mixing Audio & Burning Synchronized Subtitles ---")
    # Subtitle path for ffmpeg filter: escape colon on Windows
    sub_path_escaped = str(SUBTITLES_PATH.resolve().as_posix()).replace(":", r"\:")

    # Subtitle styling: Segoe UI / Arial, white text with semi-transparent dark box (BorderStyle=4)
    sub_filter = (
        f"subtitles=filename='{sub_path_escaped}':force_style="
        "'FontName=Segoe UI,FontSize=20,Bold=1,PrimaryColour=&H00FFFFFF,"
        "OutlineColour=&H00000000,BackColour=&HA0000000,BorderStyle=4,MarginV=40'"
    )

    # Audio filter: duck music to volume 0.09, smooth fade out at end
    fade_out_start = max(0.0, total_duration - 4.0)
    audio_filter = (
        f"[0:a]volume=1.0[voice]; "
        f"[1:a]volume=0.08,afade=t=in:ss=0:d=2.5,afade=t=out:st={fade_out_start}:d=4.0[music]; "
        f"[voice][music]amix=inputs=2:duration=first:dropout_transition=2[aout]"
    )

    cmd = [
        FFMPEG_PATH, "-y",
        "-i", str(unmixed_video),
        "-i", str(MUSIC_PATH),
        "-filter_complex", audio_filter,
        "-map", "0:v",
        "-map", "[aout]",
        "-vf", sub_filter,
        "-c:v", "libx264",
        "-preset", "medium",
        "-crf", "19",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-t", str(total_duration),
        str(FINAL_VIDEO_PATH)
    ]
    run_cmd(cmd, f"Exporting Final Demo Video -> {FINAL_VIDEO_PATH.name}")

    # Clean up temporary unmixed video
    if unmixed_video.exists():
        unmixed_video.unlink()

    file_size_mb = FINAL_VIDEO_PATH.stat().st_size / (1024 * 1024)
    print("\n" + "=" * 80)
    print(" VIDEO PRODUCTION COMPLETE!")
    print("=" * 80)
    print(f" Output Video:     {FINAL_VIDEO_PATH}")
    print(f" File Size:        {file_size_mb:.2f} MB")
    print(f" Resolution:       1920x1080 (Full HD, 16:9)")
    print(f" Frame Rate:       30 FPS")
    print(f" Duration:         {total_duration} seconds (~2 minutes)")
    print(f" Subtitles:        Hardcoded with clean translucent box")
    print(f" Audio:            Edge-TTS en-US-JennyNeural mixed with ambient soundtrack")
    print("=" * 80)


if __name__ == "__main__":
    main()
