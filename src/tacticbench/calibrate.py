"""Fit a pitch-to-image homography so chalk can be drawn on the footage.

    uv run python -m tacticbench.calibrate

Everything the coach interface wants to draw on a video frame lives in pitch
coordinates: the ball that was played, the ball that was on, the man who was
free. The frame is pixels. Without a projection between them the interface can
only draw on a separate board, which is what it had been doing.

**Where the correspondences come from.** We already hold both halves of the
answer at the instant of the pass:

* StatsBomb's 360 freeze frame gives every player in pitch coordinates.
* Our own tracker gives players in image coordinates in the same frame.

They are the same twenty-odd people. Matching them is an assignment problem
with no labels, so it is solved with RANSAC rather than assumed.

**Why a plain RANSAC does not work here.** Sampling four pairs at random from
every image point crossed with every pitch point makes the chance that all four
are correct about 1 in 160,000, so the search wanders. The prior that rescues
it is the camera: a broadcast main camera sits on the halfway line, so a
player's rank left-to-right in the image tracks their rank along the pitch.
Restricting each image point to pitch points of similar rank cuts the candidate
set per point from twenty to about nine and lifts the hit rate by three orders
of magnitude.

The fit is then scored by how many freeze-frame players land near a tracked box
when projected, which is a check on the thing we actually care about rather than
on the algebra.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from . import workspace

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

#: StatsBomb pitch, in the units the event data uses.
PITCH_X = 120.0
PITCH_Y = 80.0

#: How far apart two players may be, in ranks along the pitch, and still be
#: considered a possible match. Tightening this speeds the search and risks
#: excluding the true pair when the tracker misses people.
RANK_WINDOW = 5

#: A projected player counts as explained if it lands this close to a tracked
#: box, as a fraction of frame width.
INLIER_TOL = 0.045

#: Enough samples that a run with a workable geometry converges, few enough
#: that four clips calibrate in seconds.
ITERATIONS = 60_000

#: Below this share of tracked players explained, the fit is not trustworthy
#: and the caller should fall back to drawing on a board.
MIN_INLIER_RATIO = 0.45


def foot(box: list[float]) -> tuple[float, float]:
    """Where a player stands: the middle of the bottom edge of their box."""
    return ((box[0] + box[2]) / 2, box[3])


def homography(src: np.ndarray, dst: np.ndarray) -> np.ndarray | None:
    """Least-squares homography from four or more point pairs.

    Written out rather than pulled from OpenCV so the failure mode is visible:
    a degenerate sample (three collinear points, say) produces a singular
    system and returns None instead of a silently useless matrix.
    """
    rows = []
    for (x, y), (u, v) in zip(src, dst):
        rows.append([x, y, 1, 0, 0, 0, -u * x, -u * y, -u])
        rows.append([0, 0, 0, x, y, 1, -v * x, -v * y, -v])
    A = np.asarray(rows, dtype=float)
    try:
        _, s, vt = np.linalg.svd(A)
    except np.linalg.LinAlgError:
        return None
    if s[-1] > 1e-6 * s[0]:
        # No near-null vector: the sample does not determine a projection.
        return None
    h = vt[-1].reshape(3, 3)
    if abs(h[2, 2]) < 1e-12:
        return None
    return h / h[2, 2]


def project(H: np.ndarray, pts: np.ndarray) -> np.ndarray:
    """Pitch points through the homography into image space."""
    ones = np.ones((len(pts), 1))
    hom = np.hstack([pts, ones]) @ H.T
    w = hom[:, 2:3]
    w[np.abs(w) < 1e-12] = 1e-12
    return hom[:, :2] / w


def fit(
    pitch: np.ndarray,
    image: np.ndarray,
    rng: np.random.Generator,
    iterations: int = ITERATIONS,
) -> tuple[np.ndarray | None, float]:
    """Best pitch-to-image projection, and the share of players it explains."""
    if len(pitch) < 4 or len(image) < 4:
        return None, 0.0

    # Rank each set along its own left-to-right axis, then only pair players
    # whose ranks are close. This is the camera prior doing the work.
    p_rank = np.argsort(np.argsort(pitch[:, 0]))
    i_rank = np.argsort(np.argsort(image[:, 0]))
    p_scaled = p_rank / max(1, len(pitch) - 1)
    i_scaled = i_rank / max(1, len(image) - 1)
    window = RANK_WINDOW / max(1, len(pitch) - 1)

    candidates: list[np.ndarray] = []
    for i in range(len(image)):
        near = np.nonzero(np.abs(p_scaled - i_scaled[i]) <= window)[0]
        candidates.append(near if len(near) else np.arange(len(pitch)))

    best_H: np.ndarray | None = None
    best_score = 0.0

    for _ in range(iterations):
        picks = rng.choice(len(image), size=4, replace=False)
        js = [int(rng.choice(candidates[i])) for i in picks]
        if len(set(js)) < 4:
            continue

        H = homography(pitch[js], image[picks])
        if H is None:
            continue

        proj = project(H, pitch)
        if not np.isfinite(proj).all():
            continue
        if not plausible(H, proj):
            continue
        # Score on tracked players explained, not on pitch players projected:
        # the tracker sees fewer people, and those are the ones on screen.
        d = np.linalg.norm(image[:, None, :] - proj[None, :, :], axis=2)
        # Symmetric: every tracked player wants a projected player on it, and
        # every projected player wants to land on somebody. Scoring one
        # direction alone rewards scattering points until something is hit.
        fwd = (d.min(axis=1) <= INLIER_TOL).mean()
        rev = (d.min(axis=0) <= INLIER_TOL).mean()
        score = min(fwd, rev)
        if score > best_score:
            best_score, best_H = score, H

    return best_H, best_score


#: A projection is only believable if the pitch lands roughly where a pitch
#: lands: on screen, the right way round, and not folded through infinity.
FRAME_MARGIN = 0.35
MIN_ON_SCREEN = 0.6

#: The projected pitch must cover at least this many frames' worth of area.
#: A camera showing part of a pitch implies the pitch is larger than the shot.
MIN_PITCH_AREA = 1.0


def plausible(H: np.ndarray, proj: np.ndarray) -> bool:
    """Reject projections that score well by accident.

    The first version of this scored only how many tracked players sat near
    *some* projected point, which a degenerate homography satisfies by
    scattering points across the plane: one such fit put the passer at
    (-2160, -311) and still scored 64%. These three checks are what separates
    a camera from an accident.
    """
    corners = np.array([[0, 0], [PITCH_X, 0], [PITCH_X, PITCH_Y], [0, PITCH_Y]], float)
    q = project(H, corners)
    if not np.isfinite(q).all():
        return False

    lo, hi = -FRAME_MARGIN, 1 + FRAME_MARGIN

    # 1. The pitch must be BIGGER than the frame, not inside it.
    #
    # The first version of this demanded all four pitch corners land within
    # the frame, which rejected every correct fit: a broadcast camera zoomed
    # into the penalty area never shows a whole pitch, so the far corners are
    # supposed to project well outside. What a real camera does guarantee is
    # the opposite, that the pitch covers the frame.
    area = 0.5 * abs(
        sum(
            q[i][0] * q[(i + 1) % 4][1] - q[(i + 1) % 4][0] * q[i][1]
            for i in range(4)
        )
    )
    if not np.isfinite(area) or area < MIN_PITCH_AREA:
        return False

    # 2. Convex and consistently wound, so the pitch is not folded or mirrored.
    cross = []
    for i in range(4):
        a, b, c = q[i], q[(i + 1) % 4], q[(i + 2) % 4]
        u, v = b - a, c - b
        # 2D cross product written out; numpy dropped the 2-vector form.
        cross.append(u[0] * v[1] - u[1] * v[0])
    signs = np.sign(cross)
    if not (signs == signs[0]).all() or signs[0] == 0:
        return False

    # 3. Most of the players actually on the pitch have to be on screen.
    inside = ((proj > lo) & (proj < hi)).all(axis=1).mean()
    return inside >= MIN_ON_SCREEN


def calibrate_moment(moment: dict, rng: np.random.Generator) -> dict | None:
    """Fit for one moment, using the tracked frame nearest the pass."""
    frames = moment.get("frames") or []
    if not frames:
        return None
    target = moment["pass_at"]
    frame = min(frames, key=lambda f: abs(f["t"] - target))

    image = np.array([foot(p["box"]) for p in frame["players"]], dtype=float)
    freeze = moment.get("freeze") or []
    pitch = np.array([[p["x"], p["y"]] for p in freeze], dtype=float)
    if len(image) < 4 or len(pitch) < 4:
        return None

    H, score = fit(pitch, image, rng)
    if H is None or score < MIN_INLIER_RATIO:
        return {"key": moment["key"], "ok": False, "score": round(score, 3)}

    return {
        "key": moment["key"],
        "ok": True,
        "score": round(score, 3),
        "frame_t": frame["t"],
        "tracked": len(image),
        "freeze": len(pitch),
        # Row-major, ready for a CSS/SVG matrix on the client.
        "H": [round(float(v), 8) for v in H.flatten()],
    }


def main() -> None:
    # Namespaced by workspace: two teams used to write this same file.
    src = workspace.snapshot_dir() / "clip-moments.json"
    data = json.loads(src.read_text())
    rng = np.random.default_rng(20221218)

    out = []
    for m in data["moments"]:
        r = calibrate_moment(m, rng)
        if not r:
            print(f"  {m['key']}: no usable frame")
            continue
        out.append(r)
        if r["ok"]:
            print(f"  {r['key']}: fitted, {r['score']:.0%} of {r['tracked']} tracked explained")
        else:
            print(f"  {r['key']}: NO FIT ({r['score']:.0%}), will draw on the board")
        m["H"] = r.get("H")
        m["H_score"] = r.get("score")

    src.write_text(json.dumps(data))
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "homography.json").write_text(json.dumps(out, indent=1))
    good = sum(1 for r in out if r["ok"])
    print(f"\n{good}/{len(out)} clips calibrated")


if __name__ == "__main__":
    main()
