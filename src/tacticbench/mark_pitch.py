"""Calibrate any football video by naming four points you can see.

    # 1. a frame with a coordinate grid on it
    uv run python -m tacticbench.mark_pitch grid --video training.mp4 --at 12.5

    # 2. read four landmarks off that image and solve
    uv run python -m tacticbench.mark_pitch fit --video training.mp4 --at 12.5 \\
        --point left_post_base=620,380 \\
        --point right_post_base=735,406 \\
        --point box_left=430,300 \\
        --point box_right=980,520

    # 3. look at it before believing it
    uv run python -m tacticbench.mark_pitch check --video training.mp4 --at 12.5

`--video` takes a path to any file, or the key of a clip this repo already
cut. A coach's phone recording works the same way as a broadcast.

Why this exists rather than an automatic fit
--------------------------------------------
`calibrate.py` solves the projection from freeze-frame players against tracked
boxes with RANSAC, and does not converge: best fits score 21 to 44% against a
45% bar. Pitch-line detection does not rescue it either, because a shot tight
enough to be worth analysing contains one usable line and a lot of advertising
hoardings. Four points a person can see settles it in a minute.

How `check` verifies it
-----------------------
It draws the pitch model back onto the frame: touchlines, halfway, centre
circle, both penalty areas, both six-yard boxes, the goals. If the projection
is right those land on the paint that is really there, and if it is wrong that
is unmissable from across a room. No event data is needed, so this works on a
video nobody has analysed yet.

One homography describes one camera pose. A fixed touchline camera holds for a
whole match; a panning broadcast needs a fit per shot. `--at` is part of the
key the result is saved under for exactly that reason.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results" / "calibration"
OUT = ROOT / ".cache" / "calib"

#: Where clips cut by this repo live, so `--video 008_25` works as a shorthand.
KNOWN_CLIPS = [
    ROOT / "public" / "clips",
    ROOT / ".cache" / "clips",
    Path("/tmp/peptalk-ui/public/clips"),
]

#: StatsBomb pitch coordinates, fixed by the laws of the game. The attacking
#: goal is at x=120; y runs 0 to 80 across the pitch.
LANDMARKS: dict[str, tuple[float, float]] = {
    "left_post_base": (120.0, 36.0),
    "right_post_base": (120.0, 44.0),
    "six_yard_left": (114.0, 30.0),
    "six_yard_right": (114.0, 50.0),
    "six_yard_left_goalline": (120.0, 30.0),
    "six_yard_right_goalline": (120.0, 50.0),
    "box_left": (102.0, 18.0),
    "box_right": (102.0, 62.0),
    "box_left_goalline": (120.0, 18.0),
    "box_right_goalline": (120.0, 62.0),
    "penalty_spot": (108.0, 40.0),
    "halfway_top": (60.0, 0.0),
    "halfway_bottom": (60.0, 80.0),
    "corner_near": (120.0, 80.0),
    "corner_far": (120.0, 0.0),
    # The other end, for a shot at the defensive third.
    "own_box_left": (18.0, 18.0),
    "own_box_right": (18.0, 62.0),
    "own_left_post_base": (0.0, 36.0),
    "own_right_post_base": (0.0, 44.0),
}


def resolve(video: str) -> Path:
    """A path, or the key of a clip this repo cut."""
    p = Path(video)
    if p.exists():
        return p
    for d in KNOWN_CLIPS:
        cand = d / f"{video}.mp4"
        if cand.exists():
            return cand
    raise SystemExit(
        f"no video at {video!r}.\n"
        f"  Give a path, or a clip key from {', '.join(str(d) for d in KNOWN_CLIPS)}"
    )


def key_for(path: Path, at: float) -> str:
    return f"{path.stem}_{at:g}".replace(".", "p")


def frame_at(src: Path, t: float, dest: Path, grid: bool = False) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    vf = "scale=1280:-1"
    if grid:
        vf += ",drawgrid=w=64:h=36:t=1:c=yellow@0.45"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(src),
         "-vframes", "1", "-vf", vf, str(dest), "-y"],
        check=True,
    )
    if not dest.exists():
        raise SystemExit(f"could not read a frame at {t}s of {src}")
    return dest


def degenerate(pitch: np.ndarray) -> str | None:
    """Why this set of landmarks cannot determine a projection.

    The easy mistake, and one I made testing this: the goal posts and both
    goal-line box corners are all visible in an attacking-third shot and all
    sit on x=120. Four points on one line fix nothing, and the solver does not
    fail on that, it returns a matrix with residuals of several hundred pixels.
    So the check has to happen before the solve.
    """
    xs, ys = pitch[:, 0], pitch[:, 1]
    if np.ptp(xs) < 1e-6:
        return "every landmark is on one goal line; include one further upfield"
    if np.ptp(ys) < 1e-6:
        return "every landmark is on one touchline; include one across the pitch"
    if len(pitch) == 4:
        for i in range(4):
            for j in range(i + 1, 4):
                for k in range(j + 1, 4):
                    a, b, c = pitch[i], pitch[j], pitch[k]
                    area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
                    if area < 1e-6:
                        return "three of the four landmarks are in a line"
    return None


def homography(pitch: np.ndarray, image: np.ndarray) -> np.ndarray:
    rows = []
    for (x, y), (u, v) in zip(pitch, image):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    _, _, vt = np.linalg.svd(np.asarray(rows, float))
    H = vt[-1].reshape(3, 3)
    return H / H[2, 2]


def project(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    hom = np.hstack([pts, np.ones((len(pts), 1))]) @ H.T
    w = hom[:, 2:3]
    w[np.abs(w) < 1e-12] = 1e-12
    return hom[:, :2] / w


def pitch_model() -> list[list[tuple[float, float]]]:
    """The painted lines, as polylines in pitch coordinates.

    Drawing these back onto a frame is the verification: they should sit on
    the paint that is really there.
    """
    def box(x0, x1, y0, y1):
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1), (x0, y0)]

    circle = [
        (60 + 10 * np.cos(a), 40 + 10 * np.sin(a))
        for a in np.linspace(0, 2 * np.pi, 40)
    ]
    return [
        box(0, 120, 0, 80),               # touchlines and goal lines
        [(60, 0), (60, 80)],              # halfway
        circle,
        box(102, 120, 18, 62),            # penalty area
        box(114, 120, 30, 50),            # six yard box
        box(0, 18, 18, 62),
        box(0, 6, 30, 50),
        [(120, 36), (120, 44)],           # goals
        [(0, 36), (0, 44)],
    ]


def cmd_grid(args) -> None:
    src = resolve(args.video)
    dest = OUT / f"{key_for(src, args.at)}_grid.png"
    frame_at(src, args.at, dest, grid=True)
    print(f"wrote {dest}")
    print("\nOpen it and read pixel positions off the grid (64px cells across, 36 down).")
    print("Name any four of these that you can see:\n")
    for name, (x, y) in LANDMARKS.items():
        print(f"  {name:<26} pitch ({x:g}, {y:g})")
    print(
        "\nFour is enough, but they must span the pitch in both directions.\n"
        "Two goal posts plus two penalty-area corners is a reliable set."
    )


def cmd_fit(args) -> None:
    src = resolve(args.video)
    pitch, image, names = [], [], []
    for spec in args.point:
        name, _, pos = spec.partition("=")
        if name not in LANDMARKS:
            raise SystemExit(f"unknown landmark {name!r}. Run `grid` for the list.")
        u, v = (float(n) for n in pos.split(","))
        pitch.append(LANDMARKS[name])
        image.append((u, v))
        names.append(name)

    if len(pitch) < 4:
        raise SystemExit("need at least four points")

    why = degenerate(np.array(pitch, float))
    if why:
        raise SystemExit(
            f"these landmarks cannot determine a projection: {why}.\n"
            "  Pick points that span the pitch in both directions, for example\n"
            "  the two goal posts plus two penalty-area corners further out."
        )

    H = homography(np.array(pitch, float), np.array(image, float))
    err = np.linalg.norm(project(H, np.array(pitch, float)) - np.array(image, float), axis=1)
    print("fit residuals, in pixels:")
    for n, e in zip(names, err):
        print(f"  {n:<26} {e:6.2f}")
    print(f"\nworst {err.max():.2f}px, mean {err.mean():.2f}px")
    if err.max() > 6:
        print("  ! above a few pixels means a landmark was misread")

    RESULTS.mkdir(parents=True, exist_ok=True)
    path = RESULTS / f"{key_for(src, args.at)}.json"
    path.write_text(json.dumps({
        "video": str(src), "at": args.at, "points": names,
        "residual_px": round(float(err.max()), 2),
        "H": [float(v) for v in H.flatten()],
    }, indent=1))
    print(f"\nwrote {path}")
    print(f"  now: mark_pitch check --video {args.video} --at {args.at:g}")


def cmd_check(args) -> None:
    import cv2

    src = resolve(args.video)
    path = RESULTS / f"{key_for(src, args.at)}.json"
    if not path.exists():
        raise SystemExit(f"no fit yet; run `fit --video {args.video} --at {args.at:g}`")
    H = np.array(json.loads(path.read_text())["H"], float).reshape(3, 3)

    dest = OUT / f"{key_for(src, args.at)}_check.png"
    frame_at(src, args.at, dest)
    img = cv2.imread(str(dest))
    h, w = img.shape[:2]
    sx = w / 1280.0

    # The pitch model, drawn back onto the frame. Needs no event data, so this
    # works on a video nobody has analysed.
    for poly in pitch_model():
        pts = project(H, np.array(poly, float)) * sx
        for a, b in zip(pts[:-1], pts[1:]):
            if not (np.isfinite(a).all() and np.isfinite(b).all()):
                continue
            cv2.line(img, tuple(a.astype(int)), tuple(b.astype(int)), (0, 220, 255), 2)

    cv2.imwrite(str(dest), img)
    print(f"wrote {dest}")
    print("  the yellow lines should sit on the painted lines in the picture")


def main() -> None:
    ap = argparse.ArgumentParser(prog="tacticbench.mark_pitch")
    sub = ap.add_subparsers(dest="cmd", required=True)

    for name, fn, extra in (
        ("grid", cmd_grid, False),
        ("fit", cmd_fit, True),
        ("check", cmd_check, False),
    ):
        s = sub.add_parser(name)
        s.add_argument("--video", required=True, help="path to a video, or a clip key")
        s.add_argument("--at", type=float, default=0.0, help="seconds into the video")
        if extra:
            s.add_argument("--point", action="append", required=True,
                           metavar="name=x,y", help="repeatable; four or more")
        s.set_defaults(func=fn)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
