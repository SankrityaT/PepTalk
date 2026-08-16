"""Calibrate a clip by naming four points you can see, and check the result.

    # 1. get a frame with a coordinate grid on it
    uv run python -m tacticbench.mark_pitch grid --clip 008_25

    # 2. read the pixel positions of four landmarks off that image, then
    uv run python -m tacticbench.mark_pitch fit --clip 008_25 \\
        --point left_post_base=620,380 \\
        --point right_post_base=735,406 \\
        --point six_yard_left=648,432 \\
        --point six_yard_right=792,470

    # 3. look at what it produced before believing it
    uv run python -m tacticbench.mark_pitch check --clip 008_25

Why this exists rather than an automatic fit.

`calibrate.py` tries to solve the projection from freeze-frame players against
tracked boxes with RANSAC. It does not converge: best fits score 21 to 44%
against a 45% bar. Pitch-line detection does not rescue it either, because a
broadcast shot tight enough to be worth analysing usually contains one usable
line and a lot of advertising hoardings.

Four points a person can see settles it in a minute, and `check` renders the
result so a bad fit is obvious rather than subtle. That is the whole tool.

The landmarks below are the ones usually visible in an attacking-third shot.
Their pitch coordinates are fixed by the laws of the game, so the only thing
being supplied is where they appear on screen.
"""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
CLIPS = Path("/tmp/peptalk-ui/public/clips")
OUT = ROOT / ".cache" / "calib"

#: StatsBomb pitch coordinates for landmarks fixed by the laws of the game.
#: The attacking goal is at x=120; y runs 0 to 80 across the pitch.
LANDMARKS: dict[str, tuple[float, float]] = {
    # Goal is 8 yards wide, centred on 40.
    "left_post_base": (120.0, 36.0),
    "right_post_base": (120.0, 44.0),
    # Six-yard box: 6 out, 20 wide.
    "six_yard_left": (114.0, 30.0),
    "six_yard_right": (114.0, 50.0),
    "six_yard_left_goalline": (120.0, 30.0),
    "six_yard_right_goalline": (120.0, 50.0),
    # Penalty area: 18 out, 44 wide.
    "box_left": (102.0, 18.0),
    "box_right": (102.0, 62.0),
    "box_left_goalline": (120.0, 18.0),
    "box_right_goalline": (120.0, 62.0),
    "penalty_spot": (108.0, 40.0),
    # Halfway line, for a wider shot.
    "halfway_top": (60.0, 0.0),
    "halfway_bottom": (60.0, 80.0),
}


def frame_at(clip: str, t: float, dest: Path, grid: bool = False) -> Path:
    src = CLIPS / f"{clip}.mp4"
    if not src.exists():
        raise SystemExit(f"no clip at {src}")
    dest.parent.mkdir(parents=True, exist_ok=True)
    vf = "scale=1280:-1"
    if grid:
        vf += ",drawgrid=w=64:h=36:t=1:c=yellow@0.45"
    subprocess.run(
        ["ffmpeg", "-v", "error", "-ss", str(t), "-i", str(src),
         "-vframes", "1", "-vf", vf, str(dest), "-y"],
        check=True,
    )
    return dest


def moment_for(clip: str) -> dict:
    data = json.loads(
        (Path("/tmp/peptalk-ui/src/content/snapshots/clip-moments.json")).read_text()
    )
    for m in data["moments"]:
        if m["key"] == clip:
            return m
    raise SystemExit(f"no moment for clip {clip}")


def degenerate(pitch: np.ndarray) -> str | None:
    """Why this set of landmarks cannot determine a projection.

    The easy mistake, and one I made testing this tool: the goal posts and
    both goal-line box corners are all visible in an attacking-third shot and
    all sit on x=120. Four points on one line fix nothing, and the solver
    happily returns a matrix with residuals of several hundred pixels rather
    than failing, so the check belongs here.
    """
    xs, ys = pitch[:, 0], pitch[:, 1]
    if np.ptp(xs) < 1e-6:
        return "every landmark is on the goal line; include one further upfield"
    if np.ptp(ys) < 1e-6:
        return "every landmark is on one touchline; include one across the pitch"

    # Any three collinear points make the set rank deficient.
    for i in range(len(pitch)):
        for j in range(i + 1, len(pitch)):
            for k in range(j + 1, len(pitch)):
                a, b, c = pitch[i], pitch[j], pitch[k]
                area = abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
                if area < 1e-6 and len(pitch) == 4:
                    return "three of the four landmarks are in a line"
    return None


def homography(pitch: np.ndarray, image: np.ndarray) -> np.ndarray:
    """Exact projection through four or more correspondences."""
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


def cmd_grid(args) -> None:
    m = moment_for(args.clip)
    dest = OUT / f"{args.clip}_grid.png"
    frame_at(args.clip, m["pass_at"], dest, grid=True)
    print(f"wrote {dest}")
    print("\nOpen it and read pixel positions off the grid (64px cells in x, 36 in y).")
    print("Landmarks you can name:\n")
    for name, (x, y) in LANDMARKS.items():
        print(f"  {name:<26} pitch ({x:g}, {y:g})")
    print("\nFour is enough. Prefer points far apart and not in a line.")


def cmd_fit(args) -> None:
    pitch, image, names = [], [], []
    for spec in args.point:
        name, _, pos = spec.partition("=")
        if name not in LANDMARKS:
            raise SystemExit(f"unknown landmark {name!r}. See `grid` for the list.")
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
    back = project(H, np.array(pitch, float))
    err = np.linalg.norm(back - np.array(image, float), axis=1)
    print("fit residuals, in pixels:")
    for n, e in zip(names, err):
        print(f"  {n:<26} {e:6.2f}")
    print(f"\nworst {err.max():.2f}px, mean {err.mean():.2f}px")
    if err.max() > 6:
        print("  ! a residual above a few pixels means a landmark was misread")

    RESULTS.mkdir(exist_ok=True)
    path = RESULTS / f"homography_{args.clip}.json"
    path.write_text(json.dumps({"clip": args.clip, "points": names,
                                "H": [float(v) for v in H.flatten()]}, indent=1))
    print(f"\nwrote {path}\n  now: mark_pitch check --clip {args.clip}")


def cmd_check(args) -> None:
    """Draw the projection onto the frame. A wrong fit is obvious here."""
    import cv2

    path = RESULTS / f"homography_{args.clip}.json"
    if not path.exists():
        raise SystemExit(f"no fit yet; run `fit --clip {args.clip}` first")
    H = np.array(json.loads(path.read_text())["H"], float).reshape(3, 3)

    m = moment_for(args.clip)
    dest = OUT / f"{args.clip}_check.png"
    frame_at(args.clip, m["pass_at"], dest)
    img = cv2.imread(str(dest))
    h, w = img.shape[:2]
    sx = w / 1280.0

    def px(pt):
        q = project(H, np.array([pt], float))[0]
        return int(q[0] * sx), int(q[1] * sx)

    # Every player from the freeze frame. If the fit is right these land on
    # people, and if it is wrong that is unmissable.
    for p in m.get("freeze", []):
        x, y = px((p["x"], p["y"]))
        if 0 <= x < w and 0 <= y < h:
            cv2.circle(img, (x, y), 12, (0, 255, 255) if p["mate"] else (255, 0, 255), 2)

    a, b, c = px(m["from"]), px(m["played_to"]), px(m["best_to"])
    cv2.arrowedLine(img, a, b, (200, 200, 200), 3, tipLength=0.15)
    cv2.arrowedLine(img, a, c, (0, 90, 255), 5, tipLength=0.15)
    cv2.circle(img, c, 22, (0, 90, 255), 3)
    cv2.circle(img, a, 9, (255, 255, 255), -1)

    cv2.imwrite(str(dest), img)
    print(f"wrote {dest}")
    print("  circles should sit on players; the orange arrow is the ball that was on")


def main() -> None:
    ap = argparse.ArgumentParser(prog="tacticbench.mark_pitch")
    sub = ap.add_subparsers(dest="cmd", required=True)

    g = sub.add_parser("grid", help="frame with a coordinate grid")
    g.add_argument("--clip", required=True)
    g.set_defaults(func=cmd_grid)

    f = sub.add_parser("fit", help="solve from named landmarks")
    f.add_argument("--clip", required=True)
    f.add_argument("--point", action="append", required=True,
                   metavar="name=x,y", help="repeatable; four or more")
    f.set_defaults(func=cmd_fit)

    c = sub.add_parser("check", help="render the projection to verify it")
    c.add_argument("--clip", required=True)
    c.set_defaults(func=cmd_check)

    args = ap.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
