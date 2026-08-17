"""Calibrate a camera from four clicks, and check the result before trusting it.

Four automatic attempts are recorded in `pitch.py`, and every one of them
failed in the same place: nothing in the image says which end of a symmetric
pitch is in view, and a homography absorbs a reflection happily, so no
geometric score can settle it. The last got to 74% of pitch lines on paint with
the goalposts twenty pixels out, which is close and still not good enough to
put an arrow at a player's feet.

A person clicking four landmarks does not have that problem. They can see the
goal. It takes about thirty seconds per camera angle and it cannot fail the way
the search does, and it is a real feature rather than a workaround: a coach
calibrates their camera once, and a fixed camera at a training ground is then
calibrated for every game they ever upload.

Two things make it safe:

**The landmarks are unambiguous.** A penalty spot is a penalty spot. Where a
choice is screen-relative, both readings are solved and the one whose pitch
lines land on the painted lines wins, which is a decision the machine can make
even when it cannot find the lines unaided.

**The fit is scored, not assumed.** The same paint score guards this as guards
the automatic path, so a misclick comes back as a low number and a wrong
overlay rather than as a silently crooked projection.

The by-product matters as much as the feature. A set of verified homographies
is ground truth, and the Roboflow keypoint model's labelling can be recovered
by fitting against them, which is the thing that could not be worked out from a
single frame.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from . import workspace
from .pitch import (
    PITCH_X,
    PITCH_Y,
    coverage,
    outline,
    paint_mask,
    paint_score,
    refine,
    spread_of,
)

#: What a person is asked to click. `y_pair` marks the two whose pitch y
#: depends on which way round the camera is; both readings are tried.
LANDMARKS: dict[str, dict] = {
    "penalty_spot": {
        "label": "the penalty spot",
        "hint": "the mark in front of the goal",
        "pitch": (110.0, 40.0),
    },
    "goal_centre": {
        "label": "the middle of the goal line",
        "hint": "on the line, halfway between the posts",
        "pitch": (120.0, 40.0),
    },
    "post_a": {
        "label": "the base of the LEFT goalpost",
        "hint": "where it meets the grass, on your left",
        "pitch": (120.0, 35.8),
        "y_pair": "post_b",
    },
    "post_b": {
        "label": "the base of the RIGHT goalpost",
        "hint": "where it meets the grass, on your right",
        "pitch": (120.0, 44.2),
        "y_pair": "post_a",
    },
    "box_goalline_a": {
        "label": "where the box meets the goal line, LEFT",
        "hint": "the corner of the big box on the goal line",
        "pitch": (120.0, 1450 / 7000 * 80),
        "y_pair": "box_goalline_b",
    },
    "box_goalline_b": {
        "label": "where the box meets the goal line, RIGHT",
        "hint": "the same corner on the other side",
        "pitch": (120.0, 5550 / 7000 * 80),
        "y_pair": "box_goalline_a",
    },
    "six_front_a": {
        "label": "the front corner of the SMALL box, LEFT",
        "hint": "the six yard box, nearest corner away from the goal",
        "pitch": ((12000 - 550) / 12000 * 120, 2584 / 7000 * 80),
        "y_pair": "six_front_b",
    },
    "six_front_b": {
        "label": "the front corner of the SMALL box, RIGHT",
        "hint": "the same corner on the other side",
        "pitch": ((12000 - 550) / 12000 * 120, 4416 / 7000 * 80),
        "y_pair": "six_front_a",
    },
    "box_front_a": {
        "label": "the front corner of the big box, LEFT",
        "hint": "where the 18 yard line turns toward the goal",
        "pitch": ((12000 - 2015) / 12000 * 120, 1450 / 7000 * 80),
        "y_pair": "box_front_b",
    },
    "box_front_b": {
        "label": "the front corner of the big box, RIGHT",
        "hint": "the same corner on the other side",
        "pitch": ((12000 - 2015) / 12000 * 120, 5550 / 7000 * 80),
        "y_pair": "box_front_a",
    },
}

#: Below this share of the pitch lines landing on paint, the clicks disagree
#: with the picture and the fit is reported as bad rather than saved quietly.
GOOD_ENOUGH = 0.45

#: How two-dimensional the chosen landmarks must be, 1.0 being a circle and 0.0
#: a straight line. Four points on the goal line satisfy every other check and
#: determine nothing.
MIN_SPREAD_CLICKS = 0.08

#: Share of the frame the clicks must span, as a fraction of its area.
MIN_CLICK_AREA = 0.06


#: The four pitch points the polish step moves. Corners of the penalty area,
#: because they are far apart and always near whatever a camera behind a goal
#: is looking at.
REFINE_ANCHORS = np.array(
    [
        [120.0, 1450 / 7000 * 80],
        [120.0, 5550 / 7000 * 80],
        [(12000 - 2015) / 12000 * 120, 1450 / 7000 * 80],
        [(12000 - 2015) / 12000 * 120, 5550 / 7000 * 80],
    ],
    dtype=np.float32,
)


class Degenerate(ValueError):
    """The chosen landmarks do not determine a projection."""


@dataclass
class Fit:
    H: np.ndarray
    paint: float
    coverage: float
    flipped: bool

    def as_json(self) -> dict:
        return {
            "H": self.H.flatten().tolist(),
            "paint": round(self.paint, 3),
            "coverage": round(self.coverage, 3),
            "flipped": self.flipped,
            "good": self.paint >= GOOD_ENOUGH,
        }


def mirror(y: float) -> float:
    return PITCH_Y - y


def solve(clicks: dict[str, tuple[float, float]], frame: Path) -> Fit | None:
    """Fit from clicked landmarks, trying both ways round, keeping the better.

    Which goalpost is "left" depends on where the camera stands, so the pitch y
    of every screen-relative landmark is ambiguous. Rather than ask a person to
    work that out, both readings are solved and scored against the painted
    lines. The wrong one puts the pitch lines through the crowd.
    """
    import cv2

    known = {k: v for k, v in clicks.items() if k in LANDMARKS}
    if len(known) < 4:
        return None
    if spread_of(np.array([LANDMARKS[k]["pitch"] for k in known])) < MIN_SPREAD_CLICKS:
        # Every landmark on the goal line is four points on a straight line,
        # which cannot determine a projection. This is exactly how the first
        # attempt at calibration failed, silently, so it is refused here with a
        # reason rather than returning a matrix that looks like an answer.
        raise Degenerate(
            "those points are all on one line. Add the penalty spot or a front "
            "corner of the box, away from the goal line."
        )

    img = cv2.imread(str(frame))
    if img is None:
        return None
    h, w = img.shape[:2]

    # The clicks also have to be spread across the picture, not only across the
    # pitch. Four landmarks bunched around the goal are well separated in pitch
    # coordinates and cover a tenth of the frame, and the homography they give
    # is fine where they are and wild everywhere else: the projected pitch came
    # back covering 8% of the image.
    pix = np.array(list(known.values()), dtype=float)
    if (np.ptp(pix[:, 0]) / w) * (np.ptp(pix[:, 1]) / h) < MIN_CLICK_AREA:
        raise Degenerate(
            "those points are all bunched in one part of the picture. Spread "
            "them out: the far corner of the box is worth more than a second "
            "point beside the goal."
        )
    mask, grass = paint_mask(img)

    best: Fit | None = None
    for flipped in (False, True):
        src, dst = [], []
        for key, (px, py) in known.items():
            x, y = LANDMARKS[key]["pitch"]
            if flipped and LANDMARKS[key].get("y_pair"):
                y = mirror(y)
            src.append([x, y])
            dst.append([px, py])
        H, _ = cv2.findHomography(
            np.array(src, np.float32), np.array(dst, np.float32),
            cv2.RANSAC if len(src) > 4 else 0, 8.0,
        )
        if H is None or not np.isfinite(H).all():
            continue
        # Polish. The clicks put the projection in the right basin, which is
        # the part no search could manage; a four point fit then inherits the
        # click precision exactly, and a couple of pixels on a landmark is a
        # couple of percent on the score. Nudging where those four points land,
        # to maximise how much of the pitch falls on painted line, recovers it
        # without asking anyone to click more carefully.
        # Parameterised on four fixed pitch points rather than on the clicks:
        # a person may click five landmarks, and a perspective transform is
        # defined by exactly four. These four also span the pitch, so nudging
        # them moves the projection evenly instead of pivoting it about
        # whichever corner happened to be clicked first.
        H, polished = refine(H, REFINE_ANCHORS, mask, grass, w, h)
        fit = Fit(H=H, paint=polished, coverage=coverage(H, w, h), flipped=flipped)
        if best is None or fit.paint > best.paint:
            best = fit
    return best


def overlay(frame: Path, H: np.ndarray, out: Path) -> None:
    """Draw the pitch model on the frame, so a person can see the fit."""
    import cv2

    img = cv2.imread(str(frame))
    for a, b in outline():
        pa, pb = _to_image(H, [a, b])
        if np.isfinite(pa).all() and np.isfinite(pb).all():
            cv2.line(img, tuple(pa.astype(int)), tuple(pb.astype(int)), (0, 200, 255), 2)
    t = np.linspace(0, 2 * np.pi, 90)
    ring = np.stack([PITCH_X / 2 + (915 / 12000 * PITCH_X) * np.cos(t),
                     PITCH_Y / 2 + (915 / 7000 * PITCH_Y) * np.sin(t)], axis=1)
    pr = _to_image(H, ring)
    for i in range(len(pr) - 1):
        if np.isfinite(pr[i]).all() and np.isfinite(pr[i + 1]).all():
            cv2.line(img, tuple(pr[i].astype(int)), tuple(pr[i + 1].astype(int)),
                     (0, 200, 255), 2)
    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), img)


def _to_image(H, pts) -> np.ndarray:
    p = np.asarray(pts, dtype=float).reshape(-1, 2)
    hom = np.hstack([p, np.ones((len(p), 1))]) @ np.asarray(H).T
    wv = hom[:, 2:3]
    wv[np.abs(wv) < 1e-12] = 1e-12
    return hom[:, :2] / wv


def store() -> Path:
    return workspace.snapshot_dir() / "calibration.json"


def load_all() -> dict:
    p = store()
    return json.loads(p.read_text()) if p.exists() else {}


def save(clip_key: str, fit: Fit, clicks: dict) -> dict:
    all_fits = load_all()
    all_fits[clip_key] = {**fit.as_json(), "clicks": clicks}
    store().write_text(json.dumps(all_fits, indent=1) + "\n")
    return all_fits[clip_key]
