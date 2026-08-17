"""Pitch-to-image calibration, so chalk can be drawn on real footage.

Everything the interface wants to draw on a frame lives in pitch coordinates:
the ball that was played, the ball that was on, a ring round the man who was
free. The frame is pixels. Without a projection between the two, the interface
can only draw on a separate board beside the video, which is what it did.

**Two attempts failed before this one, and both failures were instructive.**

Marking landmarks by hand produced four points that all sat on the goal line.
Four collinear points cannot determine a projection, so the solver returned a
matrix with a near-zero column and nobody noticed until the chalk landed in the
crowd.

Registering the StatsBomb 360 freeze frame against our own tracked boxes got to
36-38% of players explained against a 45% bar, and adding team labels made it
worse, because per-frame kit clustering is unreliable enough to exclude the true
correspondence. Eleven boxes against nineteen freeze players, with false
positives on both sides, is too weak a correspondence to bootstrap from.

**The third attempt, using a trained keypoint model, also does not work yet, and
the reason is worth writing down.** Roboflow's `football-field-detection-f07vi`
returns 32 pitch landmarks per frame, eleven of them confident here, which
should turn an unsolved correspondence problem into a solved one. It does not,
because its class numbering does not line up with `SoccerPitchConfiguration` in
roboflow/sports, and the output is internally inconsistent under every
alignment tried:

* Classes 25 and 26 should sit on the goal line with 27 to 30. They are 40 and
  50 pixels off the line those four form.
* Classes 20 to 23 are collinear in the image and are not collinear in pitch
  space at any offset.
* Scanning all offsets and reflections, no assignment is simultaneously good on
  inlier count, on line alignment, and on where it puts the goal. The best by
  paint alignment (40%) puts the goalposts 241 pixels from the real ones; the
  best by goalpost error (32 pixels) aligns only 19% of the pitch lines.

A homography absorbs reflections, so inlier count cannot settle orientation
either: all four reflections of a given offset score identically.

**What did come out of this and is worth keeping is `paint_mask`.** It extracts
the painted lines cleanly, and that is a real asset for any future attempt: the
first version of it returned a mask that was almost entirely Argentina's white
shirts, which made every candidate fit score the same useless 10%.

Where this goes next, in order of how likely it is to work:

1. Identify four non-collinear landmarks by hand on one frame, verify the
   overlay, then read off what each model class actually means and use that
   mapping everywhere. One careful frame recovers the convention.
2. Fit to lines rather than points. `paint_mask` plus a Hough pass gives clean
   pitch lines; lines transform under the inverse transpose, and there are few
   enough candidate pitch lines to enumerate.
"""

from __future__ import annotations

import base64
import json
import os
import urllib.request
from dataclasses import dataclass
from pathlib import Path

import numpy as np

MODEL = "football-field-detection-f07vi/15"
ENDPOINT = f"https://serverless.roboflow.com/{MODEL}"

#: Pitch dimensions the keypoint model was trained against, in centimetres.
LENGTH_CM = 12000
WIDTH_CM = 7000
PENALTY_BOX_W = 4100
PENALTY_BOX_L = 2015
GOAL_BOX_W = 1832
GOAL_BOX_L = 550
CIRCLE_R = 915
SPOT = 1100

#: StatsBomb's pitch, which everything else in this repo uses.
PITCH_X = 120.0
PITCH_Y = 80.0

#: A landmark has to be at least this confident to be used. The model reports
#: points it cannot see, and a hallucinated corner drags the whole fit.
MIN_CONFIDENCE = 0.5

#: Reprojection tolerance for RANSAC, in pixels on a 1280-wide frame.
RANSAC_PX = 12.0

#: Below this many landmarks agreeing, the fit is not trustworthy and the caller
#: draws on a board instead. Four is the minimum a homography needs; six gives
#: it something to disagree with.
MIN_INLIERS = 6

#: How two-dimensional the agreeing landmarks must be. Eight points strung
#: along two lines satisfy any inlier count and still leave the projection
#: unconstrained across those lines, which is how a fit can look right on every
#: point it was measured against and be wrong everywhere else.
MIN_SPREAD = 0.15

#: Share of the projected pitch that must land on painted line. Lines are thin
#: and partly occluded by players, so a correct fit does not reach 1.0; a wrong
#: one sits near chance.
MIN_PAINT = 0.35

#: The projected pitch must cover this share of the frame before its lines are
#: scored, and be sampled at least this many times. Both exist because a
#: degenerate fit that collapses the pitch onto a single painted line otherwise
#: scores a perfect 100% off 89 samples.
MIN_COVERAGE = 0.20
MIN_SAMPLES = 250


def _vertices_cm() -> list[tuple[float, float]]:
    """The 32 landmarks, in the order the model emits them."""
    w, ln = WIDTH_CM, LENGTH_CM
    return [
        (0, 0),
        (0, (w - PENALTY_BOX_W) / 2),
        (0, (w - GOAL_BOX_W) / 2),
        (0, (w + GOAL_BOX_W) / 2),
        (0, (w + PENALTY_BOX_W) / 2),
        (0, w),
        (GOAL_BOX_L, (w - GOAL_BOX_W) / 2),
        (GOAL_BOX_L, (w + GOAL_BOX_W) / 2),
        (SPOT, w / 2),
        (PENALTY_BOX_L, (w - PENALTY_BOX_W) / 2),
        (PENALTY_BOX_L, (w - GOAL_BOX_W) / 2),
        (PENALTY_BOX_L, (w + GOAL_BOX_W) / 2),
        (PENALTY_BOX_L, (w + PENALTY_BOX_W) / 2),
        (ln / 2, 0),
        (ln / 2, w / 2 - CIRCLE_R),
        (ln / 2, w / 2 + CIRCLE_R),
        (ln / 2, w),
        (ln - PENALTY_BOX_L, (w - PENALTY_BOX_W) / 2),
        (ln - PENALTY_BOX_L, (w - GOAL_BOX_W) / 2),
        (ln - PENALTY_BOX_L, (w + GOAL_BOX_W) / 2),
        (ln - PENALTY_BOX_L, (w + PENALTY_BOX_W) / 2),
        (ln - SPOT, w / 2),
        (ln - GOAL_BOX_L, (w - GOAL_BOX_W) / 2),
        (ln - GOAL_BOX_L, (w + GOAL_BOX_W) / 2),
        (ln, 0),
        (ln, (w - PENALTY_BOX_W) / 2),
        (ln, (w - GOAL_BOX_W) / 2),
        (ln, (w + GOAL_BOX_W) / 2),
        (ln, (w + PENALTY_BOX_W) / 2),
        (ln, w),
        (ln / 2 - CIRCLE_R, w / 2),
        (ln / 2 + CIRCLE_R, w / 2),
    ]


#: UNRESOLVED: this offset fits well and still projects wrongly.
#:
#: At -2 the homography takes 8 of 11 landmarks within 12px with a healthy 0.45
#: spread, and drawing the pitch back onto the frame still does not line up.
#: The cause is that a football pitch is symmetric end to end and side to side,
#: so a shifted assignment can map one end's landmarks onto the other end's and
#: satisfy every numeric check. All four reflections score identically at 8
#: inliers, which is the tell: inlier count cannot disambiguate orientation
#: because a homography represents a reflection happily.
#:
#: What resolves it is scoring against the image rather than against the
#: labels: project the pitch lines and measure how much of them lands on white
#: paint in the grass mask. That is independent of how the classes are numbered
#: and is the next thing to build here.
#:
#: The model's class labels are offset by two from the vertex order in
#: SoccerPitchConfiguration. Found by scanning offsets against a real frame:
#: at -2 the fit takes 8 of 11 landmarks, at every other offset it takes 5 or
#: fewer, which is the difference between a projection and a guess. The three
#: it rejects are genuine misdetections, including a penalty-box corner
#: reported fifty pixels off the goal line at 0.93 confidence.

#: Vertex index (1-based, as SoccerPitchConfiguration numbers them) ->
#: StatsBomb coordinates. Which class maps to which vertex is searched for at
#: calibration time rather than assumed.
LANDMARKS_RAW: dict[int, tuple[float, float]] = {
    i + 1: (x / LENGTH_CM * PITCH_X, y / WIDTH_CM * PITCH_Y)
    for i, (x, y) in enumerate(_vertices_cm())
}


@dataclass
class Calibration:
    """A projection from pitch coordinates to pixels, and how much to trust it."""

    H: np.ndarray
    inliers: int
    seen: int
    spread: float
    #: Share of the drawn pitch that lands on painted line. The real test.
    paint: float
    offset: int
    flip_x: bool
    flip_y: bool
    frame_w: int
    frame_h: int

    @property
    def ok(self) -> bool:
        return (
            self.inliers >= MIN_INLIERS
            and self.spread >= MIN_SPREAD
            and self.paint >= MIN_PAINT
        )

    def to_image(self, pts) -> np.ndarray:
        """Pitch points to pixels."""
        p = np.asarray(pts, dtype=float).reshape(-1, 2)
        hom = np.hstack([p, np.ones((len(p), 1))]) @ self.H.T
        w = hom[:, 2:3]
        w[np.abs(w) < 1e-12] = 1e-12
        return hom[:, :2] / w

    def to_pitch(self, pts) -> np.ndarray:
        """Pixels back to pitch coordinates, for naming a tracked box."""
        inv = np.linalg.inv(self.H)
        p = np.asarray(pts, dtype=float).reshape(-1, 2)
        hom = np.hstack([p, np.ones((len(p), 1))]) @ inv.T
        w = hom[:, 2:3]
        w[np.abs(w) < 1e-12] = 1e-12
        return hom[:, :2] / w

    def as_json(self) -> dict:
        return {
            "H": self.H.flatten().tolist(),
            "inliers": self.inliers,
            "landmarks_seen": self.seen,
            "spread": round(self.spread, 3),
            "paint": round(self.paint, 3),
            "assignment": {"offset": self.offset, "flip_x": self.flip_x, "flip_y": self.flip_y},
            "frame": [self.frame_w, self.frame_h],
        }


def detect(image_path: Path, api_key: str | None = None) -> list[dict]:
    """Ask the keypoint model where the pitch landmarks are in this frame."""
    key = api_key or os.environ.get("ROBOFLOW_API_KEY")
    if not key:
        raise SystemExit(
            "ROBOFLOW_API_KEY is not set. The pitch keypoint model is a hosted "
            "call; without it calibration cannot run and the interface draws on "
            "a board instead."
        )
    payload = base64.b64encode(image_path.read_bytes())
    req = urllib.request.Request(
        f"{ENDPOINT}?api_key={key}",
        data=payload,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    body = json.load(urllib.request.urlopen(req, timeout=120))
    preds = body.get("predictions") or []
    return preds[0].get("keypoints", []) if preds else []


def paint_mask(img):
    """Pitch lines only: white paint inside the grass, with the players removed.

    The first version took white pixels inside the grass and got a mask that was
    almost entirely Argentina's shirts. Scoring a projection against that
    rewards putting pitch lines through footballers, and every candidate fit
    scored the same useless 10%.

    Paint is thin and players are thick, which a top hat separates cleanly: it
    keeps bright structures narrower than its kernel and erases anything wider.
    A line is about four pixels across at this resolution and a player is forty,
    so a fifteen pixel kernel keeps one and removes the other.
    """
    import cv2

    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    grass = cv2.morphologyEx(
        cv2.inRange(hsv, (30, 40, 40), (90, 255, 255)),
        cv2.MORPH_CLOSE,
        np.ones((25, 25), np.uint8),
    )
    grey = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    thin = cv2.morphologyEx(grey, cv2.MORPH_TOPHAT, np.ones((15, 15), np.uint8))
    lines = cv2.threshold(thin, 28, 255, cv2.THRESH_BINARY)[1]
    lines = cv2.bitwise_and(lines, grass)
    return cv2.dilate(lines, np.ones((7, 7), np.uint8)), grass


def paint_score(H: "np.ndarray", mask, grass, w: int, h: int) -> float:
    """How much of the projected pitch lands on actual paint.

    Two failures shaped this.

    Scoring only the samples that landed on grass rewarded throwing the pitch
    off frame: a candidate with three quarters of its lines in the crowd kept
    the few that fell on grass, hit some, and scored 83% while drawing the
    goalposts into the stands.

    Requiring most of the pitch to be visible instead rejected everything,
    because a close broadcast shot of one penalty area legitimately shows a
    fifth of the pitch. Demanding otherwise fails every correct fit.

    So a sample inside the frame counts either way: on grass it is a chance to
    hit paint, and off grass it is a miss. A pitch line drawn through a crowd is
    evidence against the fit rather than something to skip over.
    """
    # A projection has to actually show a pitch before its lines are judged.
    # Without this, a fit that folds the whole pitch onto one painted line
    # scores 89 samples, 89 hits, a perfect 100%, and is nonsense.
    if coverage(H, w, h) < MIN_COVERAGE:
        return 0.0

    hits = judged = 0
    for a, b in outline():
        pa, pb = _project(H, [a, b])
        if not (np.isfinite(pa).all() and np.isfinite(pb).all()):
            return 0.0
        n = max(2, int(np.hypot(*(pb - pa)) / 6))
        for t in np.linspace(0, 1, n):
            x, y = pa + (pb - pa) * t
            xi, yi = int(round(x)), int(round(y))
            if not (0 <= xi < w and 0 <= yi < h):
                continue  # off screen says nothing either way
            judged += 1
            if grass[yi, xi] and mask[yi, xi]:
                hits += 1
    # Too little of the pitch on screen to judge at all.
    return hits / judged if judged >= MIN_SAMPLES else 0.0


def coverage(H: "np.ndarray", w: int, h: int) -> float:
    """Share of the frame the projected pitch covers, from 0 to 1."""
    import cv2

    corners = _project(H, [(0, 0), (PITCH_X, 0), (PITCH_X, PITCH_Y), (0, PITCH_Y)])
    if not np.isfinite(corners).all():
        return 0.0
    # Clip to the frame before measuring: a pitch mostly off screen covers
    # only what is on it.
    frame = np.array([[0, 0], [w, 0], [w, h], [0, h]], dtype=np.float32)
    inter, _ = cv2.intersectConvexConvex(
        corners.astype(np.float32), frame, handleNested=True
    )
    return float(inter) / (w * h)


def _project(H, pts) -> "np.ndarray":
    p = np.asarray(pts, dtype=float).reshape(-1, 2)
    hom = np.hstack([p, np.ones((len(p), 1))]) @ np.asarray(H).T
    wv = hom[:, 2:3]
    wv[np.abs(wv) < 1e-12] = 1e-12
    return hom[:, :2] / wv


def calibrate(image_path: Path, api_key: str | None = None) -> Calibration | None:
    """Fit the pitch-to-image projection for one frame.

    RANSAC rather than plain least squares, because the model reports landmarks
    it cannot actually see. On the frame this was built against it emitted a
    penalty-box corner fifty pixels off the goal line it belongs to, at 0.93
    confidence. One such point is enough to tilt a least-squares fit and put
    every arrow in the wrong place.
    """
    import cv2

    kps = detect(image_path, api_key)
    img = cv2.imread(str(image_path))
    h, w = img.shape[:2]
    mask, grass = paint_mask(img)

    seen = [k for k in kps if k.get("confidence", 0) >= MIN_CONFIDENCE]
    if len(seen) < 4:
        return None

    best: Calibration | None = None
    # Search the assignment rather than assume it. Which vertex a class means is
    # not documented anywhere we can read, and the pitch's own symmetry means no
    # label-based score can settle it: the winner is whichever assignment draws
    # the pitch lines onto the painted lines.
    for offset in range(-8, 9):
        for flip_x in (False, True):
            for flip_y in (False, True):
                pitch, image = [], []
                for k in seen:
                    v = LANDMARKS_RAW.get(int(k["class"]) + offset)
                    if v is None:
                        continue
                    x, y = v
                    if flip_x:
                        x = PITCH_X - x
                    if flip_y:
                        y = PITCH_Y - y
                    pitch.append([x, y])
                    image.append([k["x"], k["y"]])
                if len(pitch) < 4:
                    continue

                P = np.array(pitch, dtype=np.float32)
                H, m = cv2.findHomography(
                    P, np.array(image, dtype=np.float32), cv2.RANSAC, RANSAC_PX
                )
                if H is None or m is None or int(m.sum()) < 4:
                    continue

                keep = P[m.ravel().astype(bool)]
                cal = Calibration(
                    H=H,
                    inliers=int(m.sum()),
                    seen=len(pitch),
                    spread=spread_of(keep),
                    paint=paint_score(H, mask, grass, w, h),
                    offset=offset,
                    flip_x=flip_x,
                    flip_y=flip_y,
                    frame_w=w,
                    frame_h=h,
                )
                if best is None or cal.paint > best.paint:
                    best = cal

    return best


def spread_of(pts: np.ndarray) -> float:
    """How two-dimensional a set of pitch points is, from 0 to 1.

    The check this exists for. On the frame this was built against, RANSAC
    found eight landmarks agreeing within twelve pixels and the projection was
    still wrong everywhere: all eight sat on just two lines, the goal line and
    the front edge of the box. Points on two lines pin a homography along those
    lines and leave it free perpendicular to them, so the fit is perfect where
    it was measured and nonsense a few yards away.

    Ratio of the smaller to the larger singular value of the centred point set:
    1.0 is a circle, 0.0 is a straight line.
    """
    if len(pts) < 4:
        return 0.0
    centred = pts - pts.mean(axis=0)
    s = np.linalg.svd(centred, compute_uv=False)
    return float(s[1] / s[0]) if s[0] > 1e-9 else 0.0


#: The pitch as line segments, for drawing it back onto a frame to check a fit.
def outline() -> list[tuple[tuple[float, float], tuple[float, float]]]:
    """The pitch as segments, in StatsBomb coordinates.

    Derived from the same constants the landmarks are, rather than from the
    18-yard figure a person would reach for. The model's pitch is 41m wide at
    the box on a 70m field; hardcoding 18 drew a box two yards short and made a
    correct projection look broken.
    """
    x, y = PITCH_X, PITCH_Y
    box_l = PENALTY_BOX_L / LENGTH_CM * x
    six_l = GOAL_BOX_L / LENGTH_CM * x
    box_edge = (y - PENALTY_BOX_W / WIDTH_CM * y) / 2
    six_edge = (y - GOAL_BOX_W / WIDTH_CM * y) / 2
    segs = [
        ((0, 0), (x, 0)), ((x, 0), (x, y)), ((x, y), (0, y)), ((0, y), (0, 0)),
        ((x / 2, 0), (x / 2, y)),
    ]
    for near in (True, False):
        gl = 0.0 if near else x
        b = box_l if near else x - box_l
        s6 = six_l if near else x - six_l
        segs += [
            ((gl, box_edge), (b, box_edge)),
            ((b, box_edge), (b, y - box_edge)),
            ((b, y - box_edge), (gl, y - box_edge)),
            ((gl, six_edge), (s6, six_edge)),
            ((s6, six_edge), (s6, y - six_edge)),
            ((s6, y - six_edge), (gl, y - six_edge)),
        ]
    return segs


def draw_check(image_path: Path, cal: Calibration, out: Path) -> None:
    """Render the pitch model over the frame. If it lines up, the fit is right."""
    import cv2

    img = cv2.imread(str(image_path))
    for a, b in outline():
        pa, pb = cal.to_image([a, b])
        if not (np.isfinite(pa).all() and np.isfinite(pb).all()):
            continue
        cv2.line(img, tuple(pa.astype(int)), tuple(pb.astype(int)), (0, 200, 255), 2)
    # The centre circle, as a polyline, since a circle projects to an ellipse.
    t = np.linspace(0, 2 * np.pi, 80)
    rx = CIRCLE_R / LENGTH_CM * PITCH_X
    ry = CIRCLE_R / WIDTH_CM * PITCH_Y
    ring = np.stack([PITCH_X / 2 + rx * np.cos(t), PITCH_Y / 2 + ry * np.sin(t)], axis=1)
    proj = cal.to_image(ring)
    for i in range(len(proj) - 1):
        if np.isfinite(proj[i]).all() and np.isfinite(proj[i + 1]).all():
            cv2.line(img, tuple(proj[i].astype(int)), tuple(proj[i + 1].astype(int)), (0, 200, 255), 2)
    cv2.imwrite(str(out), img)


def lines_in(img) -> list[dict]:
    """The long painted lines in a frame, merged and refit.

    Hough returns many short segments per line, so they are grouped by angle
    and perpendicular offset and refit as one. Only the longest survive: the
    goal line, the box, the touchlines.
    """
    import cv2

    mask, _ = paint_mask(img)
    thin = cv2.erode(mask, np.ones((5, 5), np.uint8))
    found = cv2.HoughLinesP(thin, 1, np.pi / 720, threshold=60, minLineLength=100, maxLineGap=45)
    if found is None:
        return []
    segs = np.asarray(found).reshape(-1, 4)

    groups: list[dict] = []
    for x1, y1, x2, y2 in segs:
        a = np.arctan2(y2 - y1, x2 - x1) % np.pi
        n = np.array([np.sin(a), -np.cos(a)])
        d = float(n @ np.array([x1, y1]))
        for g in groups:
            if abs(((g["a"] - a + np.pi / 2) % np.pi) - np.pi / 2) < 0.04 and abs(g["d"] - d) < 22:
                g["pts"] += [(x1, y1), (x2, y2)]
                break
        else:
            groups.append({"a": a, "d": d, "pts": [(x1, y1), (x2, y2)]})

    out = []
    for g in groups:
        pts = np.array(g["pts"], np.float32)
        if len(pts) < 4:
            continue
        vx, vy, x0, y0 = cv2.fitLine(pts, cv2.DIST_L2, 0, 0.01, 0.01).ravel()
        out.append({"v": (float(vx), float(vy)), "p0": (float(x0), float(y0)),
                    "span": float(np.ptp(pts[:, 0]) + np.ptp(pts[:, 1]))})
    out.sort(key=lambda L: -L["span"])
    return out[:6]


#: Pitch lines a broadcast shot of one penalty area can contain, as constant
#: x and constant y in StatsBomb coordinates.
X_LINES = {"goal": 120.0, "box_front": (12000 - 2015) / 12000 * 120,
           "six_front": (12000 - 550) / 12000 * 120}
Y_LINES = {"touch_far": 0.0, "touch_near": 80.0,
           "box_far": 1450 / 7000 * 80, "box_near": 5550 / 7000 * 80,
           "six_far": 2584 / 7000 * 80, "six_near": 4416 / 7000 * 80}


def players_agree(H, freeze, boxes, w: int, h: int, tol_frac: float = 0.022) -> float:
    """How well the players the graph knows about land on the players we see.

    This is the one signal that can settle orientation, and it is worth writing
    down why. A pitch is symmetric end to end and side to side, so no measure
    of lines-on-lines can tell which end is in view, and a homography
    represents a reflection happily. The twenty-two people standing on it at a
    given instant are not symmetric. Their arrangement is unique to that
    second, so a projection that puts the wrong end on screen scatters them.

    Symmetric on purpose: every tracked box wants a projected player standing on
    it, and every projected player who is on screen wants a box. Scoring one
    direction alone rewards a fit that sprays points until something is hit.

    It does work. On the 8:25 frame it took 662 candidates that all cleared the
    paint bar down to one. What it could not do is make that one correct, and
    the reason is upstream: only six lines are detected, and the four line
    assignment that would describe the camera exactly is not among the
    combinations they can form. Coordinate descent from there is stuck in the
    wrong basin, moving 0.157 to 0.160 and no further.
    """
    proj = _project(H, freeze)
    if not np.isfinite(proj).all():
        return 0.0
    on = (proj[:, 0] > 0) & (proj[:, 0] < w) & (proj[:, 1] > 0) & (proj[:, 1] < h)
    if on.sum() < 5:
        return 0.0
    d = np.linalg.norm(boxes[:, None, :] - proj[None, on, :], axis=2)
    tol = tol_frac * w
    return float(min((d.min(axis=1) <= tol).mean(), (d.min(axis=0) <= tol).mean()))


def refine(H, SRC, mask, grass, w, h):
    """Nudge the four anchor points to maximise paint alignment.

    A four point fit inherits every bit of error in the line fits it was built
    from. Local coordinate descent on where those points land recovers most of
    it: on the frame this was built against, 63% to 74%.
    """
    import cv2

    dst = cv2.perspectiveTransform(SRC.reshape(-1, 1, 2), H).reshape(-1, 2).astype(np.float64)

    def score(d):
        M = cv2.getPerspectiveTransform(SRC, d.astype(np.float32))
        return paint_score(M, mask, grass, w, h) if np.isfinite(M).all() else -1.0

    best = score(dst)
    for step in (16, 8, 4, 2, 1):
        moved = True
        while moved:
            moved = False
            for i in range(4):
                for dx, dy in ((step, 0), (-step, 0), (0, step), (0, -step)):
                    trial = dst.copy()
                    trial[i] += (dx, dy)
                    s = score(trial)
                    if s > best + 1e-6:
                        best, dst, moved = s, trial, True
    return cv2.getPerspectiveTransform(SRC, dst.astype(np.float32)), best


def main() -> None:
    import argparse

    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("frame", type=Path)
    ap.add_argument("--check", type=Path, default=None, help="write an overlay to verify the fit")
    args = ap.parse_args()

    cal = calibrate(args.frame)
    if cal is None:
        print("no calibration: too few landmarks")
        return
    print(
        f"{cal.inliers}/{cal.seen} landmarks agree · spread {cal.spread:.2f} · "
        f"paint {cal.paint:.0%} · offset {cal.offset:+d} "
        f"flip {int(cal.flip_x)}{int(cal.flip_y)}  "
        f"({'usable' if cal.ok else 'NOT usable'})"
    )
    if args.check:
        draw_check(args.frame, cal, args.check)
        print(f"wrote {args.check}")


if __name__ == "__main__":
    main()
