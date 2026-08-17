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


def grab(source: str, at: str, out: Path, crop: bool = True) -> Path | None:
    """A single frame from `source` at a video timestamp.

    `source` is a local file path or a URL; a bare YouTube id is accepted too,
    for the CLI that has always taken one. Cropped to the scoreboard by
    default, because that is what a person is being asked to read. The upload
    flow asks for the whole frame instead: a coach who cannot find the clock in
    a cropped strip has nothing to orient by.
    """
    from .fetch_clips import _is_local, cut_window

    out.parent.mkdir(parents=True, exist_ok=True)
    start = hhmmss_to_s(at)

    if _is_local(source):
        # Already on disk, so there is nothing to fetch: seek and take a frame.
        cmd = ["ffmpeg", "-nostdin", "-v", "error", "-ss", str(start),
               "-i", source, "-vframes", "1"]
        if crop:
            cmd += ["-vf", CROP]
        cmd += [str(out), "-y"]
        if subprocess.run(cmd).returncode != 0 or not out.exists():
            return None
        return out

    url = source if "://" in source else f"https://www.youtube.com/watch?v={source}"
    clip = out.with_suffix(".mp4")
    if cut_window(url, start, start + 6, clip, force=True) is None:
        return None

    cmd = ["ffmpeg", "-nostdin", "-v", "error", "-ss", "1", "-i", str(clip),
           "-vframes", "1"]
    if crop:
        cmd += ["-vf", CROP]
    cmd += [str(out), "-y"]
    subprocess.run(cmd, check=True)
    return out


#: How long a half time break runs, in seconds. The two offsets differ by
#: exactly this, so a pair outside the range means one clock was misread — the
#: only check available on a number nobody can derive.
BREAK_MIN_S = 8 * 60
BREAK_MAX_S = 15 * 60


def offset_from(video_at: str, clock_mmss: str) -> float:
    """The offset implied by one reading: video position minus match clock.

    Both are `MM:SS` or `HH:MM:SS`. This is the whole of the arithmetic the
    guided alignment step performs, kept here so it is tested rather than
    reimplemented in TypeScript.
    """
    return float(hhmmss_to_s(video_at) - hhmmss_to_s(clock_mmss))


def check_offsets(first: float, second: float) -> str | None:
    """Why a pair of offsets looks wrong, or None if it looks right.

    A misread digit is worth sixty seconds of silent misalignment, and the
    resulting clip looks plausible — it is simply the wrong passage, with
    nothing on screen to reveal it. The gap between the two offsets is the half
    time break, so it is the one quantity that can be sanity-checked.
    """
    gap = second - first
    if gap < 0:
        return (
            "The second-half offset is smaller than the first. The two readings "
            "are probably swapped, or one was taken in the wrong half."
        )
    if gap < BREAK_MIN_S:
        return (
            f"Those readings put half time at {gap / 60:.1f} minutes, which is "
            "too short for a break. Check the clock in the second-half frame."
        )
    if gap > BREAK_MAX_S:
        return (
            f"Those readings put half time at {gap / 60:.1f} minutes, which is "
            "too long for a break. Check the clock in one of the frames."
        )
    return None


def main() -> None:
    ap = argparse.ArgumentParser(prog="tacticbench.find_offsets")
    ap.add_argument("--video", required=True,
                    help="YouTube id, URL, or a path to a local recording")
    ap.add_argument("--at", action="append", required=True,
                    help="video timestamp to sample, HH:MM:SS. Repeatable.")
    args = ap.parse_args()

    print("Cutting scoreboard frames. Open each and read the match clock.\n")
    frames = []
    for at in args.at:
        # A path makes a poor filename, so name the frame after the source's
        # last component rather than the whole thing.
        stem = Path(args.video).stem or "video"
        dest = OUT / f"{stem}_{at.replace(':', '')}.png"
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
