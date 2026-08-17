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

**What works is asking a model that was trained for exactly this.** Roboflow's
`football-field-detection-f07vi` predicts 32 pitch landmarks per frame, each one
a known point on a known-size pitch: box corners, six-yard corners, penalty
spots, the centre circle intersections. That turns an unsolved correspondence
problem into a solved one, and the homography is then a least-squares fit with
RANSAC to throw out the landmarks it got wrong.

The 32 vertices come from `SoccerPitchConfiguration` in roboflow/sports, on a
12000x7000cm pitch, converted here to the 120x80 StatsBomb coordinates the rest
of this codebase speaks.
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
CLASS_OFFSET = -2

#: Landmark class -> StatsBomb coordinates.
LANDMARKS: dict[int, tuple[float, float]] = {
    i + 1 - CLASS_OFFSET: (x / LENGTH_CM * PITCH_X, y / WIDTH_CM * PITCH_Y)
    for i, (x, y) in enumerate(_vertices_cm())
}


@dataclass
class Calibration:
    """A projection from pitch coordinates to pixels, and how much to trust it."""

    H: np.ndarray
    inliers: int
    seen: int
    spread: float
    frame_w: int
    frame_h: int

    @property
    def ok(self) -> bool:
        return self.inliers >= MIN_INLIERS and self.spread >= MIN_SPREAD

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

    pitch, image = [], []
    for k in kps:
        if k.get("confidence", 0) < MIN_CONFIDENCE:
            continue
        here = LANDMARKS.get(int(k["class"]))
        if here is None:
            continue
        pitch.append(here)
        image.append([k["x"], k["y"]])

    if len(pitch) < 4:
        return None

    P = np.array(pitch, dtype=np.float32)
    H, mask = cv2.findHomography(P, np.array(image, dtype=np.float32), cv2.RANSAC, RANSAC_PX)
    if H is None or mask is None:
        return None

    keep = P[mask.ravel().astype(bool)]
    return Calibration(
        H=H,
        inliers=int(mask.sum()),
        seen=len(pitch),
        spread=spread_of(keep),
        frame_w=w,
        frame_h=h,
    )


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
        f"{cal.inliers}/{cal.seen} landmarks agree, spread {cal.spread:.2f}  "
        f"({'usable' if cal.ok else 'NOT usable'})"
    )
    if args.check:
        draw_check(args.frame, cal, args.check)
        print(f"wrote {args.check}")


if __name__ == "__main__":
    main()
