"""Track players in an arbitrary broadcast clip.

    uv run python -m tacticbench.cv_video /tmp/wcfinal.mp4 --out /tmp/wc_track.json

Unlike `cv.py`, this assumes nothing is provided with the video. SoccerNet ships
a per-frame homography; a clip pulled off the internet ships nothing. So this
does detection, kit clustering and pitch-view filtering on its own, and leaves
pitch-coordinate projection to a separate calibration step.

That split is deliberate. Boxes on players are useful immediately and need no
calibration at all — which is exactly what a broadcast-analysis overlay shows.
Projecting to a minimap needs a homography per frame, and on a panning,
zooming broadcast camera that is the genuinely hard part.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2
import numpy as np

from .cv import (
    OTHER,
    assign_teams_per_frame,
    is_pitch_view,
    pitch_fraction,
    plausible_player_box,
    torso_colours,
)


#: Fewest boxes a frame needs before it is worth keeping. Two kits can be
#: separated from about four players; below that a "team" is one cluster of
#: noise, and a wrong colour is worse than no box.
MIN_TRACKED = 4


def sample_frames(
    video: Path,
    every_n: int = 12,
    max_frames: int = 240,
    start_s: float = 0.0,
) -> list[tuple[int, float, np.ndarray]]:
    """Read every Nth frame, keeping only frames that look like football."""
    cap = cv2.VideoCapture(str(video))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    out: list[tuple[int, float, np.ndarray]] = []
    skipped = 0
    idx = int(start_s * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
    try:
        while len(out) < max_frames:
            ok, frame = cap.read()
            if not ok:
                break
            if idx % every_n == 0:
                if is_pitch_view(frame):
                    out.append((idx, idx / fps, frame))
                else:
                    skipped += 1
            idx += 1
    finally:
        cap.release()
    print(f"  sampled {len(out)} pitch frames, rejected {skipped} non-pitch", flush=True)
    return out


def track(
    video: Path,
    every_n: int = 12,
    max_frames: int = 240,
    start_s: float = 0.0,
    model_name: str = "yolo11m.pt",
    device: str = "mps",
    conf: float = 0.3,
) -> dict:
    from ultralytics import YOLO

    model = YOLO(model_name)
    frames_out: list[dict] = []
    per_frame_colours: list[np.ndarray] = []

    for idx, t, frame in sample_frames(video, every_n, max_frames, start_s):
        h, w = frame.shape[:2]
        r = model.predict(frame, classes=[0], conf=conf, device=device, verbose=False)[0]
        boxes = [b for b in r.boxes.xyxy.cpu().numpy().tolist() if plausible_player_box(b)]
        # Enough bodies to tell two kits apart, not enough to require a wide
        # shot. The old floor of eight silently dropped the whole build-up to
        # a pass — on the 13:02 clip, 31 of 50 frames, every one of them real
        # football at a tighter camera — so the overlay stayed blank until the
        # shot went wide and then snapped on. Frames that are not football at
        # all are already gone: `is_pitch_view` rejected them upstream.
        if len(boxes) < MIN_TRACKED:
            continue
        tc = torso_colours(frame, boxes)
        players = []
        for box in boxes:
            players.append(
                {
                    # Normalised so the overlay scales with whatever size the
                    # frame is rendered at in the browser.
                    "box": [
                        round(box[0] / w, 4), round(box[1] / h, 4),
                        round(box[2] / w, 4), round(box[3] / h, 4),
                    ],
                }
            )
        per_frame_colours.append(np.asarray(tc, dtype=float))
        frames_out.append(
            {"idx": idx, "t": round(t, 2), "grass": round(pitch_fraction(frame), 3), "players": players}
        )

    if not frames_out:
        return {"frames": [], "note": "no usable pitch frames"}

    per_frame_labels = assign_teams_per_frame(per_frame_colours)
    k = 0
    flat = []
    for f, labels in zip(frames_out, per_frame_labels):
        for p, lab in zip(f["players"], labels):
            p["team"] = int(lab)
            flat.append(int(lab))
            k += 1

    labels = np.asarray(flat)
    split = [int((labels == t).sum()) for t in (0, 1)]
    other = int((labels == OTHER).sum())

    # Detections that belong to neither team are dropped rather than shown: a
    # referee rendered in a team colour is worse than one not rendered at all.
    for f in frames_out:
        f["players"] = [p for p in f["players"] if p["team"] != OTHER]
    frames_out = [f for f in frames_out if len(f["players"]) >= 6]

    return {
        "source": video.name,
        "frames": frames_out,
        "detections": k,
        "team_split": split,
        "excluded_non_team": other,
        "balance": round(min(split) / max(split), 3) if max(split) else 0.0,
    }


def main() -> None:
    p = argparse.ArgumentParser(prog="tacticbench.cv_video")
    p.add_argument("video")
    p.add_argument("--out", default="/tmp/track.json")
    p.add_argument("--every-n", type=int, default=12)
    p.add_argument("--max-frames", type=int, default=240)
    p.add_argument("--start", type=float, default=0.0)
    p.add_argument("--model", default="yolo11m.pt")
    args = p.parse_args()

    out = track(
        Path(args.video),
        every_n=args.every_n,
        max_frames=args.max_frames,
        start_s=args.start,
        model_name=args.model,
    )
    Path(args.out).write_text(json.dumps(out))
    print(
        f"frames={len(out['frames'])} detections={out.get('detections')} "
        f"split={out.get('team_split')} balance={out.get('balance')}"
    )
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
