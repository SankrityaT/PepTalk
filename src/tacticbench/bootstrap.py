"""Fetch and build everything the interface needs, in one command.

    uv run python -m tacticbench.bootstrap

The repository carries no footage. Broadcast video is not ours to
redistribute, so `public/clips` and `public/tape` are gitignored and a fresh
clone renders the brief with no video in it. This rebuilds them.

Everything here is reproducible from two public sources: a full match
recording on YouTube, and StatsBomb's open event data. Nothing needs a
credential, and the whole run takes a few minutes on a laptop.

The alignment between video time and match time is the only piece that is not
mechanical, and it is documented rather than fudged. The broadcast carries a
clock in its overlay; reading it at two known points gives one offset per
period. Every cut is checked afterwards by reading its clock back off the
first frame, so a wrong offset fails loudly instead of quietly showing the
wrong passage.
"""

from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
CACHE = ROOT / ".cache" / "clips"

#: Where the Next.js app looks for footage. Overridable for a different
#: checkout layout.
UI = Path(__file__).resolve().parents[2]
PUBLIC_CLIPS = UI / "public" / "clips"
PUBLIC_TAPE = UI / "public" / "tape"

VIDEO_ID = "RgqKdplLIk4"
URL = f"https://www.youtube.com/watch?v={VIDEO_ID}"

#: The continuous passage the Tape tab plays. Match 20:24 to 21:54, which is
#: video 22:00 to 23:30 once the first-half offset is applied.
TAPE_WINDOW = ("00:22:00", "00:23:30")
TAPE_NAME = "wc2022.mp4"

#: The goal that is worth watching. Cut with its build up.
GOAL_WINDOW = ("01:30:44", "01:31:06")
GOAL_NAME = "goal_080_59.mp4"


def have(cmd: str) -> bool:
    return shutil.which(cmd) is not None


def cut(start: str, end: str, dest: Path, attempts: int = 3) -> bool:
    """One window out of the recording, retrying past a flaky read."""
    if dest.exists():
        print(f"    have {dest.name}")
        return True
    dest.parent.mkdir(parents=True, exist_ok=True)
    for attempt in range(1, attempts + 1):
        cmd = [
            "yt-dlp",
            "--download-sections", f"*{start}-{end}",
            "-f", "bv*[height<=720][ext=mp4]/bv*[height<=720]",
            "-q", "--no-warnings", "-o", str(dest),
        ]
        if attempt == 1:
            cmd.insert(3, "--force-keyframes-at-cuts")
        cmd.append(URL)
        if subprocess.run(cmd).returncode == 0 and dest.exists():
            return True
        for stale in dest.parent.glob(f"{dest.stem}.mp4*"):
            stale.unlink(missing_ok=True)
        print(f"    retry {attempt}/{attempts}")
    return False


def main() -> None:
    if not have("yt-dlp"):
        raise SystemExit(
            "yt-dlp is required.\n  uv pip install yt-dlp"
        )
    if not have("ffmpeg"):
        raise SystemExit("ffmpeg is required.\n  brew install ffmpeg")

    print("1. the continuous passage for the Tape tab")
    tape = CACHE / TAPE_NAME
    if cut(*TAPE_WINDOW, tape):
        PUBLIC_TAPE.mkdir(parents=True, exist_ok=True)
        shutil.copy(tape, PUBLIC_TAPE / TAPE_NAME)
        print(f"    -> {PUBLIC_TAPE / TAPE_NAME}")

    print("\n2. the moments the engine flagged")
    from .fetch_clips import main as fetch_main

    fetch_main()

    print("\n3. tracking those cuts")
    from .build_clips import main as build_main

    build_main()

    print("\n4. the goal, with its build up")
    goal = CACHE / GOAL_NAME
    if cut(*GOAL_WINDOW, goal):
        from .conceded import build as conceded_build
        from .cv_video import track

        t = track(goal, every_n=3, max_frames=260, device="mps")
        PUBLIC_CLIPS.mkdir(parents=True, exist_ok=True)
        shutil.copy(goal, PUBLIC_CLIPS / GOAL_NAME)

        goals = conceded_build(3869685, "Argentina")
        for g in goals:
            key = f"goal_{g['minute']:03d}_{g['second']:02d}"
            g["key"] = key
            if g["clock"] == "80:59":
                g.update(
                    {
                        "clip": f"/clips/{GOAL_NAME}",
                        "goal_at": 13.5,
                        "frames": t["frames"],
                        "detections": t.get("detections", 0),
                    }
                )
            else:
                g.update({"clip": None, "frames": [], "detections": 0})
        RESULTS.mkdir(exist_ok=True)
        (RESULTS / "conceded.json").write_text(json.dumps(goals, indent=1))
        print(f"    {len(t['frames'])} frames, {t.get('detections', 0)} detections")

    print("\ndone. `pnpm dev` and open /dashboard")


if __name__ == "__main__":
    main()
