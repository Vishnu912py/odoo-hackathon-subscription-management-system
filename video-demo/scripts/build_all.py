#!/usr/bin/env python3
"""
build_all.py
Master build script for Brightloop video production pipeline:
1. Captures genuine application screenshots from frontend/dist via headless Chrome.
2. Generates professional Edge-TTS narration (en-US-JennyNeural) & synced subtitles.
3. Procedurally synthesizes ambient background soundtrack.
4. Renders 1920x1080 branded graphics & modular slot placeholders.
5. Assembles and exports the final 1080p 30fps demo video.
"""

import subprocess
import sys
import time
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
SCRIPTS_DIR = BASE_DIR / "scripts"


def run_stage(script_name: str, stage_num: int, total_stages: int, description: str):
    print(f"\n[{stage_num}/{total_stages}] Running {script_name}: {description}...")
    start_time = time.time()
    script_path = SCRIPTS_DIR / script_name
    res = subprocess.run([sys.executable, str(script_path)], cwd=str(BASE_DIR))
    if res.returncode != 0:
        print(f"\n[FATAL] Stage {stage_num} failed with return code {res.returncode}!")
        sys.exit(res.returncode)
    elapsed = time.time() - start_time
    print(f"[STAGE {stage_num} OK] Completed in {elapsed:.1f}s")


def main():
    total_start = time.time()
    print("=" * 80)
    print(" BRIGHTLOOP VIDEO PRODUCTION: FULL PIPELINE BUILD")
    print("=" * 80)

    stages = [
        ("capture_genuine_screens.py", "Capture genuine frontend screens with headless Chrome"),
        ("generate_narration.py", "Generate Edge-TTS narration & synchronized SRT/VTT subtitles"),
        ("generate_music.py", "Synthesize ambient corporate tech background soundtrack"),
        ("generate_assets.py", "Render 1080p branded cards, diagrams, and modular slot graphics"),
        ("assemble_video.py", "Assemble clips, mix audio, burn subtitles & encode final MP4"),
    ]

    for idx, (script, desc) in enumerate(stages, 1):
        run_stage(script, idx, len(stages), desc)

    total_elapsed = time.time() - total_start
    print("\n" + "=" * 80)
    print(f" FULL PIPELINE COMPLETED SUCCESSFULLY IN {total_elapsed:.1f}s!")
    print("=" * 80)


if __name__ == "__main__":
    main()

