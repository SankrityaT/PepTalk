"""Put the pass that was on into the footage.

Everything needed has been sitting in separate places: the ball that was played
and the ball that was available live in pitch coordinates from `pass_options`,
the frame lives in pixels, and calibration finally joins the two.

Drawn only at the instant the clip stops on. A camera pans and zooms through a
ten second window, and one homography describes one moment of it, so an arrow
held across the whole clip would drift off the grass within a second or two.
The tape already pauses on the pass, which is the frame the calibration was fit
to and the only frame the geometry is true for.

Two sanity checks come free, and both are recorded rather than assumed:

* Where the passer stands is known from the freeze frame, so the arrow's tail
  should land on a tracked box. When it does not, the calibration is wrong
  whatever its paint score said.
* The pitch is 120 by 80, so anything projecting outside it is nonsense and is
  dropped instead of drawn into the crowd.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import workspace
from .pitch import calibrate

#: How far the tail of the arrow may sit from the nearest tracked player before
#: the calibration is treated as untrustworthy for this clip, as a share of
#: frame width. A passer is at the ball; if the projection puts him a quarter
#: of the screen away, the fit is wrong however well its lines scored.
TAIL_TOLERANCE = 0.08


def to_image(H: np.ndarray, pts) -> np.ndarray:
    p = np.asarray(pts, dtype=float).reshape(-1, 2)
    hom = np.hstack([p, np.ones((len(p), 1))]) @ np.asarray(H).T
    w = hom[:, 2:3]
    w[np.abs(w) < 1e-12] = 1e-12
    return hom[:, :2] / w


def arrows_for(clip: dict, H: np.ndarray, frame_w: int, frame_h: int) -> dict | None:
    """The two passes in normalised image space, or None if they do not land.

    Normalised so the interface can draw them over a video element at any size
    without knowing the frame's own resolution.
    """
    pts = to_image(H, [clip["from"], clip["played_to"], clip["best_to"]])
    if not np.isfinite(pts).all():
        return None

    norm = pts / np.array([frame_w, frame_h])
    # A little outside the frame is fine, since a pass can end off screen. Far
    # outside means the projection has folded.
    if (norm < -0.4).any() or (norm > 1.4).any():
        return None

    tail = norm[0]
    frame = min(clip["frames"], key=lambda f: abs(f["t"] - clip["pass_at"]))
    feet = np.array(
        [[(p["box"][0] + p["box"][2]) / 2, p["box"][3]] for p in frame["players"]]
    )
    near = float(np.min(np.linalg.norm(feet - tail, axis=1))) if len(feet) else 9.9

    return {
        "from": [round(float(tail[0]), 4), round(float(tail[1]), 4)],
        "played": [round(float(norm[1][0]), 4), round(float(norm[1][1]), 4)],
        "best": [round(float(norm[2][0]), 4), round(float(norm[2][1]), 4)],
        # Reported rather than hidden: the interface shows the arrows only when
        # the passer is where the projection says he is.
        "tail_to_nearest_player": round(near, 4),
        "trusted": near <= TAIL_TOLERANCE,
    }


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--frames", type=Path, default=Path("/tmp/peptalk-ui/public/calib"))
    args = ap.parse_args()

    snap = workspace.snapshot_dir()
    clicked = {}
    store = snap / "calibration.json"
    if store.exists():
        clicked = json.loads(store.read_text())

    for name in ("clip-moments.json", "player-clips.json"):
        path = snap / name
        if not path.exists():
            continue
        blob = json.loads(path.read_text())
        rows = blob.get("moments") or blob.get("clips") or []

        drawn = 0
        for clip in rows:
            frame = args.frames / f"{clip['key']}.jpg"
            if not frame.exists():
                continue

            # A person's calibration beats the model's every time.
            hit = clicked.get(clip["key"])
            if hit:
                H = np.array(hit["H"], float).reshape(3, 3)
                w, h, source = 1280, 720, "clicked"
            else:
                cal = calibrate(frame)
                if cal is None or not cal.ok:
                    clip.pop("arrows", None)
                    continue
                H, w, h, source = cal.H, cal.frame_w, cal.frame_h, "automatic"

            got = arrows_for(clip, H, w, h)
            if got is None:
                clip.pop("arrows", None)
                continue
            clip["arrows"] = {**got, "source": source}
            if got["trusted"]:
                drawn += 1
            print(
                f"  {clip['key']:<18} {source:<9} tail {got['tail_to_nearest_player']:.3f} "
                f"from a player  {'drawn' if got['trusted'] else 'held back'}"
            )

        path.write_text(json.dumps(blob))
        print(f"{drawn} clips carry arrows -> {path}\n")


if __name__ == "__main__":
    main()
