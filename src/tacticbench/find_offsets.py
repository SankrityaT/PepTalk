"""Read the broadcast clock, so a new workspace can align its own footage.

    uv run python -m tacticbench.find_offsets --video RgqKdplLIk4 --at 00:12:00

Aligning video time to match time is the one step in setting up a workspace
that cannot be derived, and it is the step that quietly ruins a demo when it is
wrong: every clip lands somewhere plausible and shows the wrong passage.

This cuts a frame at a video timestamp and crops the scoreboard out of it, so
the clock can be read and the offset worked out:

    offset = video_seconds - match_seconds_shown

Run it twice, once inside each half, because the half time break is not on the
match clock. Extra time needs a third for the same reason.

It deliberately does not OCR the clock. Broadcast overlays differ per
competition, per broadcaster and per year, and a misread digit here is worth
sixty seconds of misalignment with nothing on screen to reveal it. A person
reading two numbers is both more reliable and faster than the code that would
be needed to do it badly.
"""

from __future__ import annotations

import argparse
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / ".cache" / "offsets"

#: The scoreboard sits top-left in most broadcasts. Widened and scaled up so
#: the digits are legible without hunting.
CROP = "crop=iw*0.5:ih*0.13:0:ih*0.01,scale=iw*2.2:ih*2.2"


def hhmmss_to_s(t: str) -> int:
    parts = [int(p) for p in t.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, s = parts
    return h * 3600 + m * 60 + s


def grab(video_id: str, at: str, out: Path) -> Path | None:
    """A single frame's scoreboard, at a video timestamp."""
    out.parent.mkdir(parents=True, exist_ok=True)
    clip = out.with_suffix(".mp4")
    end = f"{hhmmss_to_s(at) + 6}"
    end_hms = f"{int(end) // 3600:02d}:{(int(end) % 3600) // 60:02d}:{int(end) % 60:02d}"

    for attempt in range(3):
        cmd = [
            "yt-dlp",
            "--download-sections", f"*{at}-{end_hms}",
            "-f", "bv*[height<=720][ext=mp4]/bv*[height<=720]",
            "-q", "--no-warnings", "-o", str(clip),
        ]
        if attempt == 0:
            cmd.insert(3, "--force-keyframes-at-cuts")
        cmd.append(f"https://www.youtube.com/watch?v={video_id}")
        if subprocess.run(cmd).returncode == 0 and clip.exists():
            break
        for stale in clip.parent.glob(f"{clip.stem}.mp4*"):
            stale.unlink(missing_ok=True)
    else:
        return None

    subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", "1", "-i", str(clip),
         "-vframes", "1", "-vf", CROP, str(out), "-y"],
        check=True,
    )
    return out


def main() -> None:
    ap = argparse.ArgumentParser(prog="tacticbench.find_offsets")
    ap.add_argument("--video", required=True, help="YouTube id of the full match")
    ap.add_argument("--at", action="append", required=True,
                    help="video timestamp to sample, HH:MM:SS. Repeatable.")
    args = ap.parse_args()

    print("Cutting scoreboard frames. Open each and read the match clock.\n")
    frames = []
    for at in args.at:
        dest = OUT / f"{args.video}_{at.replace(':', '')}.png"
        got = grab(args.video, at, dest)
        if got:
            frames.append((at, got))
            print(f"  {at}  ->  {got}")
        else:
            print(f"  {at}  ->  could not fetch")

    if not frames:
        return

    print("\nFor each frame, the offset is:")
    print("    offset = video_seconds - match_seconds_on_the_clock\n")
    for at, _ in frames:
        v = hhmmss_to_s(at)
        print(f"  {at} is {v}s of video. If the clock reads M:SS, offset = {v} - (M*60+SS)")

    print(
        "\nSample once inside each half. The two offsets should differ by the\n"
        "length of the half time break, roughly 8 to 15 minutes. If they do\n"
        "not, one of the readings is wrong.\n"
        "\nThen put them in your workspace.json:\n"
        '    "period_offset": {"1": <first half>, "2": <second half>}'
    )


if __name__ == "__main__":
    main()
