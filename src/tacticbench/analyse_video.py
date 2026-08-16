"""Take any video and produce what the interface needs to show it.

    uv run --extra cv python -m tacticbench.analyse_video /path/to/training.mp4
    uv run --extra cv python -m tacticbench.analyse_video game.mp4 --label "U16s"

The `--extra cv` is required: detection pulls torch and ultralytics, which are
optional so that running the graph and the API stays light.

This is the upload path. A coach hands over a file, and what comes back is
tracking, chalk-ready frames, and a snapshot the dashboard can render. No
StatsBomb id, no known fixture, no configuration.

What it will produce for any football video
-------------------------------------------
Detections per frame, kits separated, officials dropped, and from those the
marks that are computed in image space: the defensive line, movement arrows,
and the player in the most space. All of that needs nothing but pixels.

What it cannot produce without more
-----------------------------------
Anything in pitch coordinates: expected threat, what else was on, the pass
that should have been played. Those are claims about where players stood on a
pitch, and pixels alone do not carry that. Two ways to get there:

* `mark_pitch` gives a projection from four landmarks a person can see, and
  then image positions become pitch positions.
* Event data for the match, if it exists, which is what the built-in workspace
  uses.

The snapshot records which of those are available, so the interface can show
what it has rather than inventing the rest. A clip of a Sunday league game
gets boxes and chalk and an honest note; the same clip with a calibration gets
the tactical layer too.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
CALIB = RESULTS / "calibration"
PUBLIC = ROOT / "public" / "uploads"
SNAPSHOTS = ROOT / "src" / "content" / "snapshots"

#: Sample every Nth frame. Dense enough that the overlay does not lag the
#: players it belongs to, sparse enough that a long clip is not an afternoon.
EVERY_N = 3

#: Above this the tracker is looking at a wide enough shot to say anything
#: about shape. Below it the camera is tight on the ball.
SHAPE_MIN_PLAYERS = 8


def probe(path: Path) -> dict:
    """Duration and size, straight from the container."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "format=duration:stream=width,height", "-of", "json", str(path)],
        capture_output=True, text=True,
    ).stdout
    try:
        d = json.loads(out)
    except json.JSONDecodeError:
        return {}
    stream = (d.get("streams") or [{}])[0]
    return {
        "duration": float(d.get("format", {}).get("duration", 0) or 0),
        "width": stream.get("width"),
        "height": stream.get("height"),
    }


def calibration_for(path: Path) -> dict | None:
    """Any homography already fitted for this video, from `mark_pitch`."""
    if not CALIB.exists():
        return None
    for f in sorted(CALIB.glob(f"{path.stem}_*.json")):
        d = json.loads(f.read_text())
        if Path(d.get("video", "")).stem == path.stem:
            return d
    return None


def main() -> None:
    ap = argparse.ArgumentParser(prog="tacticbench.analyse_video")
    ap.add_argument("video", help="any football video")
    ap.add_argument("--label", default="", help="what to call it in the interface")
    ap.add_argument("--every-n", type=int, default=EVERY_N)
    ap.add_argument("--max-frames", type=int, default=400)
    ap.add_argument("--device", default="mps")
    args = ap.parse_args()

    src = Path(args.video).expanduser().resolve()
    if not src.exists():
        raise SystemExit(f"no video at {src}")

    meta = probe(src)
    print(f"{src.name}: {meta.get('duration', 0):.1f}s, "
          f"{meta.get('width')}x{meta.get('height')}")

    from .cv_video import track

    print("tracking ...", flush=True)
    try:
        t = track(src, every_n=args.every_n, max_frames=args.max_frames, device=args.device)
    except ModuleNotFoundError as e:
        # Vision is an optional extra so the core install stays light: running
        # the graph and the API should not pull ~2GB of torch.
        #
        # `uv run` re-syncs the environment from the lockfile every time, so a
        # package added with `uv pip install` is removed again before the next
        # run. The extra has to be requested on the command, not installed
        # beside it.
        raise SystemExit(
            f"{e.name} is missing. Detection needs the vision extra, and it has\n"
            "to be requested on the run rather than installed separately:\n"
            f'  uv run --extra cv python -m tacticbench.analyse_video {args.video}'
        ) from e
    frames = t.get("frames") or []
    if not frames:
        raise SystemExit(
            "no usable frames. The pitch detector rejected every sample, which\n"
            "usually means this is not football, or the camera never shows grass."
        )

    counts = [len(f["players"]) for f in frames]
    wide = sum(1 for c in counts if c >= SHAPE_MIN_PLAYERS)
    print(f"  {len(frames)} frames, {t.get('detections', 0)} detections")
    print(f"  {wide} frames wide enough to read shape ({wide / len(frames):.0%})")

    calib = calibration_for(src)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    dest = PUBLIC / src.name
    if dest.resolve() != src:
        shutil.copy(src, dest)

    payload = {
        "key": src.stem,
        "label": args.label or src.stem,
        "clip": f"/uploads/{src.name}",
        "duration": meta.get("duration"),
        "frames": frames,
        "detections": t.get("detections", 0),
        "excluded_non_team": t.get("excluded_non_team", 0),
        # What the interface is allowed to claim about this video.
        "has": {
            "tracking": True,
            "chalk": wide > 0,
            # Pitch coordinates, and everything built on them, need one of
            # these. Stated rather than assumed so the interface shows what it
            # has instead of inventing the rest.
            "pitch_coordinates": bool(calib),
            "tactical_moments": False,
        },
        "calibration": calib,
    }

    SNAPSHOTS.mkdir(parents=True, exist_ok=True)
    out = SNAPSHOTS / f"upload-{src.stem}.json"
    out.write_text(json.dumps(payload))
    print(f"\nwrote {out}")
    print(f"       {dest}")

    if not calib:
        print(
            "\nNo calibration for this video, so it gets boxes and chalk but no\n"
            "tactical layer. To add one:\n"
            f"  uv run python -m tacticbench.mark_pitch grid  --video {src} --at 5\n"
            f"  uv run python -m tacticbench.mark_pitch fit   --video {src} --at 5 --point ...\n"
            f"  uv run python -m tacticbench.mark_pitch check --video {src} --at 5"
        )


if __name__ == "__main__":
    main()
