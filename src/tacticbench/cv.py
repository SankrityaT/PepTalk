"""Tactical state from broadcast video.

Pipeline: per-frame player boxes and a camera homography, projected into pitch
metres, teams separated by kit colour, then aggregated into the same shape of
tactical state the event-data path produces.

Verified working on real Premier League footage — 800 frames of Burnley/Arsenal
produced 12,389 player observations spanning the full pitch.

Two things worth knowing before trusting the numbers
----------------------------------------------------

**The homography is pitch -> image, so it must be inverted.** SoccerNet's
`1_field_calib_ccbv.json` gives a 3x3 that maps pitch coordinates onto the
frame. Projecting a player's feet the other way needs `inv(H)`. Applying it
un-inverted yields coordinates in the tens of thousands, which is how the
mistake announces itself.

**CV metrics are not numerically interchangeable with event-derived ones.**
Event `press_height` is the mean x of pressure *events*; the closest CV analogue
is the mean x of *player positions*, which is a different measurement of a
related idea. They are stored with `source: 'cv'` and should be compared to
event-derived facts only with that in mind — not silently averaged together.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

# SoccerNet pitch coordinates are metres, origin at the centre circle.
PITCH_LENGTH_M = 105.0
PITCH_WIDTH_M = 68.0

# StatsBomb's frame, so CV output lands in the same coordinate space as the
# event-derived state even though the measurements differ.
SB_LENGTH = 120.0
SB_WIDTH = 80.0

MIN_CALIB_CONFIDENCE = 0.85
MIN_PLAYERS_PER_FRAME = 12

# Torso band within a player box, as a fraction of box height. Sampling the
# whole box averages in grass, shorts and skin: on Burnley/Arsenal that washed
# both kits to near-identical dark teal and split the teams 10716/1673 instead
# of roughly evenly.
TORSO_TOP = 0.15
TORSO_BOTTOM = 0.45

# Horizontal inset. A bounding box is a rectangle and a player is narrow, so the
# left and right edges are mostly pitch. Sampling the full width pulled the
# cluster centroid to RGB(134,147,79) — olive, i.e. grass — and split the teams
# 81/19. Keeping only the central column of the box is what separates the kits.
TORSO_INSET = 0.30


@dataclass(frozen=True)
class PlayerObservation:
    frame: int
    x_m: float
    y_m: float
    team: int | None = None

    @property
    def x_sb(self) -> float:
        return (self.x_m + PITCH_LENGTH_M / 2) / PITCH_LENGTH_M * SB_LENGTH

    @property
    def y_sb(self) -> float:
        return (self.y_m + PITCH_WIDTH_M / 2) / PITCH_WIDTH_M * SB_WIDTH


def load_predictions(game_dir: Path) -> tuple[list, list]:
    calib = json.loads((game_dir / "1_field_calib_ccbv.json").read_text())["predictions"]
    boxes = json.loads((game_dir / "1_player_boundingbox_maskrcnn.json").read_text())["predictions"]
    return calib, boxes


def invert_homography(flat: list[float]) -> np.ndarray | None:
    """Image <- pitch becomes pitch <- image. Returns None if degenerate."""
    H = np.asarray(flat, dtype=float).reshape(3, 3)
    try:
        return np.linalg.inv(H)
    except np.linalg.LinAlgError:
        return None


def project_foot(Hi: np.ndarray, box: list[float]) -> tuple[float, float]:
    """Bottom-centre of a bounding box is where the player meets the ground."""
    x1, _y1, x2, y2 = box
    p = Hi @ np.array([(x1 + x2) / 2.0, float(y2), 1.0])
    return p[0] / p[2], p[1] / p[2]


# Plausible player geometry at 720p. MaskRCNN occasionally emits large,
# grass-covering boxes — frame 344 of this match has a 671px-wide detection
# alongside genuine ~40x76 player boxes. Those wide boxes sample almost pure
# pitch, and they were the main reason kit clustering came out 88/12 with a
# visibly green centroid.
BOX_MIN_H, BOX_MAX_H = 20.0, 260.0
BOX_MIN_W, BOX_MAX_W = 8.0, 130.0
BOX_MIN_ASPECT = 1.2  # a standing person is taller than wide


def plausible_player_box(box: list[float]) -> bool:
    x1, y1, x2, y2 = box
    w, h = x2 - x1, y2 - y1
    if not (BOX_MIN_W <= w <= BOX_MAX_W and BOX_MIN_H <= h <= BOX_MAX_H):
        return False
    return h / w >= BOX_MIN_ASPECT if w > 0 else False


def on_pitch(x_m: float, y_m: float, margin: float = 3.0) -> bool:
    return (
        abs(x_m) <= PITCH_LENGTH_M / 2 + margin
        and abs(y_m) <= PITCH_WIDTH_M / 2 + margin
    )


def observations(
    calib: list, boxes: list, max_frames: int | None = None, stride: int = 1
) -> list[PlayerObservation]:
    out: list[PlayerObservation] = []
    used = 0
    for i in range(0, len(calib), stride):
        c = calib[i]
        if not c or c[0].get("confidence", 0.0) < MIN_CALIB_CONFIDENCE:
            continue
        b = boxes[i] if i < len(boxes) else None
        if not b or len(b.get("bboxes", [])) < MIN_PLAYERS_PER_FRAME:
            continue
        Hi = invert_homography(c[0]["homography"])
        if Hi is None:
            continue
        for box in b["bboxes"]:
            if not plausible_player_box(box):
                continue
            x_m, y_m = project_foot(Hi, box)
            if on_pitch(x_m, y_m):
                out.append(PlayerObservation(frame=i, x_m=x_m, y_m=y_m))
        used += 1
        if max_frames and used >= max_frames:
            break
    return out


def pitch_fraction(frame_bgr: np.ndarray) -> float:
    """Fraction of the frame that looks like grass.

    Broadcast footage is not all football. Replays, dugout close-ups and
    league-logo wipes all carry high calibration confidence and a full set of
    person detections — at 10:00 in this match the frame is a Premier League
    logo with eighteen boxes scattered across the lion. Sampling those frames
    is what dragged kit clustering to an olive centroid and an 81/19 split.

    Hue in OpenCV's HSV is 0-179, so grass sits around 35-85.
    """
    hsv = cv2.cvtColor(frame_bgr.astype(np.uint8), cv2.COLOR_BGR2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    grass = (h >= 30) & (h <= 90) & (s >= 40) & (v >= 40)
    return float(grass.mean())


def is_pitch_view(frame_bgr: np.ndarray, threshold: float = 0.35) -> bool:
    return pitch_fraction(frame_bgr) >= threshold


def torso_colours(frame_bgr: np.ndarray, bboxes: list[list[float]]) -> np.ndarray:
    """Mean colour of each player's torso band.

    Sampling the torso rather than the whole box is what makes kit clustering
    work at all — see TORSO_TOP.
    """
    h, w = frame_bgr.shape[:2]
    out = []
    for x1, y1, x2, y2 in bboxes:
        bh, bw = y2 - y1, x2 - x1
        ty1 = int(max(0, min(h - 1, y1 + bh * TORSO_TOP)))
        ty2 = int(max(0, min(h, y1 + bh * TORSO_BOTTOM)))
        tx1 = int(max(0, min(w - 1, x1 + bw * TORSO_INSET)))
        tx2 = int(max(0, min(w, x2 - bw * TORSO_INSET)))
        if ty2 <= ty1 or tx2 <= tx1:
            out.append([0.0, 0.0, 0.0])
            continue
        patch = frame_bgr[ty1:ty2, tx1:tx2].reshape(-1, 3)
        # Median, not mean: any grass that survives the inset is an outlier
        # rather than something that should drag the estimate.
        out.append(np.median(patch, axis=0).tolist())
    return np.asarray(out, dtype=float)


def detect_players(model, frame_bgr: np.ndarray, conf: float = 0.35, device: str = "mps") -> list[list[float]]:
    """Person boxes for one frame, via YOLO.

    We run detection ourselves rather than using SoccerNet's precomputed
    MaskRCNN boxes. Those are offset from this video's frames — drawn over
    frame 1000 every box sits down-and-right of its player — and no amount of
    colour sampling recovers from boxes that are not on the player. Detecting
    on the exact frame we read removes the whole class of problem, and YOLO
    lands tight boxes (median 36x90, aspect 2.44) on the same frame where the
    precomputed set was unusable.
    """
    r = model.predict(frame_bgr, classes=[0], conf=conf, device=device, verbose=False)[0]
    boxes = r.boxes.xyxy.cpu().numpy().tolist()
    return [b for b in boxes if plausible_player_box(b)]


#: Label for detections that belong to neither team — officials, goalkeepers in
#: a third kit, anyone on the touchline who survived the other filters.
OTHER = -1


def assign_teams(
    colours: np.ndarray, n_clusters: int = 4, seed: int = 0
) -> np.ndarray:
    """Split detections into two teams, discarding everyone else.

    A football pitch holds more than two kits: two outfield sets, two
    goalkeepers, and up to three officials. Forcing k=2 makes every one of them
    join a team — on the World Cup final the referee's dark red landed with
    France's navy, and a match official was quietly contributing to a national
    side's shape numbers.

    So cluster into more groups than there are teams and keep the two most
    populous. Twenty outfield players outnumber the stragglers by an order of
    magnitude, so the two big clusters are the teams and the rest are not.

    Returns team 0, team 1, or OTHER.
    """
    from sklearn.cluster import KMeans

    n = len(colours)
    if n < n_clusters:
        return np.zeros(n, dtype=int)

    raw = KMeans(n_clusters=n_clusters, n_init=10, random_state=seed).fit(colours)
    sizes = np.bincount(raw.labels_, minlength=n_clusters)
    teams = np.argsort(sizes)[::-1][:2]

    # The brighter kit is team 0, so the mapping is stable across runs rather
    # than dependent on k-means initialisation order. It also grounds the label:
    # on the 2022 final Argentina's white stripes are far brighter than France's
    # navy, so "team 0 is the lighter kit" is checkable rather than asserted.
    brightness = raw.cluster_centers_.mean(axis=1)
    if brightness[teams[0]] < brightness[teams[1]]:
        teams = teams[::-1]

    out = np.full(n, OTHER, dtype=int)
    out[raw.labels_ == teams[0]] = 0
    out[raw.labels_ == teams[1]] = 1
    return out


def run_pipeline(
    game_dir: Path,
    video_name: str = "1_720p.mkv",
    max_frames: int = 60,
    stride: int = 23,
    start: int = 300,
    model_name: str = "yolo11n.pt",
    device: str = "mps",
) -> dict:
    """Video in, per-team tactical state out.

    Deliberately samples rather than processing every frame: calibration is
    published at 2fps and tactical shape does not change meaningfully between
    consecutive half-second samples, so a stride buys wall-clock time at no
    real cost to the aggregate.
    """
    from ultralytics import YOLO

    calib, _ = load_predictions(game_dir)
    model = YOLO(model_name)
    cap = cv2.VideoCapture(str(game_dir / video_name))

    obs: list[PlayerObservation] = []
    colours: list[list[float]] = []
    used = skipped_not_pitch = 0

    try:
        for i in range(start, len(calib), stride):
            c = calib[i]
            if not c or c[0].get("confidence", 0.0) < MIN_CALIB_CONFIDENCE:
                continue
            cap.set(cv2.CAP_PROP_POS_MSEC, (i / 2.0) * 1000.0)
            ok, frame = cap.read()
            if not ok:
                continue
            if not is_pitch_view(frame):
                skipped_not_pitch += 1
                continue
            Hi = invert_homography(c[0]["homography"])
            if Hi is None:
                continue
            boxes = detect_players(model, frame, device=device)
            if len(boxes) < 10:
                continue
            for box, col in zip(boxes, torso_colours(frame, boxes)):
                x_m, y_m = project_foot(Hi, box)
                if on_pitch(x_m, y_m):
                    obs.append(PlayerObservation(frame=i, x_m=x_m, y_m=y_m))
                    colours.append(col.tolist())
            used += 1
            if used >= max_frames:
                break
    finally:
        cap.release()

    if not obs:
        return {"frames": 0, "observations": 0, "teams": {}}

    labels = assign_teams(np.asarray(colours))
    obs = [PlayerObservation(o.frame, o.x_m, o.y_m, int(t)) for o, t in zip(obs, labels)]

    return {
        "frames": used,
        "skipped_not_pitch": skipped_not_pitch,
        "observations": len(obs),
        "teams": {int(t): tactical_state(obs, team=int(t)) for t in set(labels)},
    }


def assign_teams_per_frame(
    per_frame: list[np.ndarray], min_players: int = 8, seed: int = 0
) -> list[np.ndarray]:
    """Cluster kits within each frame rather than across the whole clip.

    One global clustering has to find a single colour boundary that holds for
    every lighting condition in the video. Over four minutes of the 2022 final
    it does not: a player who walks into shade reads darker than his own team
    and falls out of their cluster. That is how Messi lost his box — not a
    detection failure, a colour-boundary failure.

    Clustering per frame removes the problem at the root, because exposure is
    constant within one frame.

    The brightness ordering is what keeps frames comparable: cluster indices
    from k-means are arbitrary and would otherwise swap teams between frames.
    Sorting by centroid brightness means "team 0 is the lighter kit" holds
    everywhere, which is both stable and checkable — on this match Argentina's
    white stripes against France's navy.
    """
    from sklearn.cluster import KMeans

    out: list[np.ndarray] = []
    for colours in per_frame:
        n = len(colours)
        if n < min_players:
            out.append(np.full(n, OTHER, dtype=int))
            continue

        # Three groups per frame: two kits plus officials and keepers.
        k = 3 if n >= 12 else 2
        fit = KMeans(n_clusters=k, n_init=10, random_state=seed).fit(colours)
        sizes = np.bincount(fit.labels_, minlength=k)
        teams = np.argsort(sizes)[::-1][:2]

        brightness = fit.cluster_centers_.mean(axis=1)
        if brightness[teams[0]] < brightness[teams[1]]:
            teams = teams[::-1]

        labels = np.full(n, OTHER, dtype=int)
        labels[fit.labels_ == teams[0]] = 0
        labels[fit.labels_ == teams[1]] = 1
        out.append(labels)
    return out


def tactical_state(obs: list[PlayerObservation], team: int | None = None) -> dict:
    """Aggregate positions into a state dict shaped like the event-data path."""
    pts = [o for o in obs if team is None or o.team == team]
    if len(pts) < MIN_PLAYERS_PER_FRAME:
        return {}

    xs = np.array([p.x_sb for p in pts])
    ys = np.array([p.y_sb for p in pts])
    return {
        "source": "cv",
        "observations": len(pts),
        "frames": len({p.frame for p in pts}),
        # Mean position rather than mean pressure-event location. Related to
        # the event-derived measure, not identical to it.
        "line_height_cv": round(float(xs.mean()), 2),
        "team_width_cv": round(float(ys.std() * 2), 2),
        "shape_depth_cv": round(float(xs.max() - xs.min()), 2),
        "x_range_m": [round(float(min(p.x_m for p in pts)), 2), round(float(max(p.x_m for p in pts)), 2)],
        "y_range_m": [round(float(min(p.y_m for p in pts)), 2), round(float(max(p.y_m for p in pts)), 2)],
    }
