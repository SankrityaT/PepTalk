"""What else was on. The pass a coach wishes had been played.

    uv run python -m tacticbench.pass_options 3869685

For a pass, this asks what every visible teammate was worth as an alternative:
how much expected threat the ball would have gained going there, discounted by
how likely the pass was to arrive. That product — value times probability — is
the number a coach actually cares about, because a brilliant ball that gets cut
out is worth nothing.

Two models sit underneath, both learned rather than assumed:

* **Expected threat** (`xt.py`), from 3,961 matches of elite football. It is
  what makes "worth more" mean something.
* **Pass completion**, fitted here from StatsBomb 360 freeze frames. Given the
  distance of a pass and how many opponents sit in its corridor, how often does
  it actually arrive?

The second one matters more than it looks. Without it the system recommends the
killer ball every time, because the most valuable pass on the pitch is almost
always the one that will not arrive — and a coach who is told that twice stops
listening.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path

import httpx
import numpy as np

from . import data
from .xt import value_at

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
THREE_SIXTY = "https://raw.githubusercontent.com/statsbomb/open-data/master/data/three-sixty/{}.json"

#: Half-width of the corridor, in metres, that counts as "in the way".
LANE_HALF_WIDTH = 4.0


@dataclass
class Option:
    kind: str  # "played" or "available"
    x: float
    y: float
    xt_gain: float
    completion: float
    expected: float
    defenders_in_lane: int
    distance: float


def load_360(match_id: int) -> dict[str, dict]:
    """Freeze frames keyed by event uuid."""
    cached = RESULTS / f"360_{match_id}.json"
    if cached.exists():
        rows = json.loads(cached.read_text())
    else:
        rows = httpx.get(THREE_SIXTY.format(match_id), timeout=120).raise_for_status().json()
        RESULTS.mkdir(exist_ok=True)
        cached.write_text(json.dumps(rows))
    return {r["event_uuid"]: r for r in rows}


def defenders_in_lane(
    start: tuple[float, float], end: tuple[float, float], opponents: list[list[float]]
) -> int:
    """Opponents within a corridor between two points.

    Distance to the segment, not the infinite line: a defender standing behind
    the passer is not in the way of a forward ball, and treating him as though
    he were is how a model learns to recommend nothing.
    """
    x1, y1 = start
    x2, y2 = end
    dx, dy = x2 - x1, y2 - y1
    seg = dx * dx + dy * dy
    if seg == 0:
        return 0

    n = 0
    for ox, oy in opponents:
        t = max(0.0, min(1.0, ((ox - x1) * dx + (oy - y1) * dy) / seg))
        px, py = x1 + t * dx, y1 + t * dy
        if math.hypot(ox - px, oy - py) <= LANE_HALF_WIDTH:
            n += 1
    return n


def fit_completion(events: list[dict], frames: dict[str, dict]) -> dict:
    """Logistic fit of completion against distance and traffic.

    Trained on the match's own passes, which keeps it honest about the level of
    football being judged rather than importing a prior from elsewhere.
    """
    from sklearn.linear_model import LogisticRegression

    X, y = [], []
    for e in events:
        if e["type"]["name"] != "Pass":
            continue
        ff = frames.get(e.get("id", ""))
        loc, end = e.get("location"), e.get("pass", {}).get("end_location")
        if not ff or not loc or not end:
            continue
        opp = [p["location"] for p in ff["freeze_frame"] if not p["teammate"]]
        dist = math.dist(loc[:2], end[:2])
        X.append([dist, defenders_in_lane(tuple(loc[:2]), tuple(end[:2]), opp)])
        y.append(0 if e["pass"].get("outcome") else 1)

    if len(set(y)) < 2:
        return {"trained": False, "n": len(y)}

    model = LogisticRegression().fit(np.array(X), np.array(y))
    return {
        "trained": True,
        "n": len(y),
        "completion_rate": round(float(np.mean(y)), 3),
        "coef_distance": round(float(model.coef_[0][0]), 4),
        "coef_traffic": round(float(model.coef_[0][1]), 4),
        "intercept": round(float(model.intercept_[0]), 4),
        "_model": model,
    }


def completion_probability(fit: dict, distance: float, traffic: int) -> float:
    if not fit.get("trained"):
        # Documented fallback rather than a silent constant.
        return max(0.15, min(0.95, 1.0 - distance / 120.0 - 0.12 * traffic))
    return float(fit["_model"].predict_proba(np.array([[distance, traffic]]))[0][1])


def options_for_pass(
    event: dict, frame: dict, xt: dict, fit: dict, max_options: int = 6
) -> list[Option]:
    loc = event.get("location")
    end = event.get("pass", {}).get("end_location")
    if not loc or not end:
        return []

    start = (float(loc[0]), float(loc[1]))
    base = value_at(xt, *start)
    mates = [p["location"] for p in frame["freeze_frame"] if p["teammate"] and not p["actor"]]
    opp = [p["location"] for p in frame["freeze_frame"] if not p["teammate"]]

    def build(kind: str, target: tuple[float, float]) -> Option:
        dist = math.dist(start, target)
        traffic = defenders_in_lane(start, target, opp)
        gain = value_at(xt, *target) - base
        p = completion_probability(fit, dist, traffic)
        return Option(kind, target[0], target[1], gain, p, gain * p, traffic, dist)

    out = [build("played", (float(end[0]), float(end[1])))]
    for m in mates:
        out.append(build("available", (float(m[0]), float(m[1]))))

    played = out[0]
    rest = sorted(out[1:], key=lambda o: o.expected, reverse=True)[:max_options]
    return [played] + rest


def analyse(match_id: int, top: int = 8) -> dict:
    xt = json.loads((RESULTS / "xt_model.json").read_text())
    frames = load_360(match_id)
    with httpx.Client(timeout=120) as c:
        events = data.events(c, match_id)

    fit = fit_completion(events, frames)

    rows = []
    for e in events:
        if e["type"]["name"] != "Pass":
            continue
        ff = frames.get(e.get("id", ""))
        if not ff or len(ff["freeze_frame"]) < 12:
            continue
        opts = options_for_pass(e, ff, xt, fit)
        if len(opts) < 2:
            continue
        played, best = opts[0], opts[1]
        if best.expected <= played.expected:
            continue
        loc = e.get("location") or [0, 0]
        rows.append(
            {
                # Where the ball was played FROM. Without it the UI can draw the
                # destinations but not the passes.
                "from": [round(float(loc[0]), 1), round(float(loc[1]), 1)],
                "minute": e.get("minute"),
                "second": e.get("second"),
                "team": e.get("team", {}).get("name"),
                "player": e.get("player", {}).get("name"),
                "played": played.__dict__,
                "best": best.__dict__,
                "missed": round(best.expected - played.expected, 5),
            }
        )

    rows.sort(key=lambda r: r["missed"], reverse=True)
    return {
        "match_id": match_id,
        "completion_model": {k: v for k, v in fit.items() if k != "_model"},
        "passes_analysed": len(rows),
        "top_missed": rows[:top],
    }


if __name__ == "__main__":
    import sys

    mid = int(sys.argv[1]) if len(sys.argv) > 1 else 3869685
    out = analyse(mid)
    print(json.dumps(out["completion_model"], indent=1))
    print(f"\npasses where a better option existed: {out['passes_analysed']}\n")
    for r in out["top_missed"]:
        p, b = r["played"], r["best"]
        print(
            f"  {r['minute']:>3}' {r['team'][:11]:<11} {(r['player'] or '')[:22]:<22} "
            f"played xT{p['xt_gain']:+.3f} p={p['completion']:.0%}  ->  "
            f"best xT{b['xt_gain']:+.3f} p={b['completion']:.0%} "
            f"({b['defenders_in_lane']} in lane)  missed {r['missed']:+.3f}"
        )
    (RESULTS / f"pass_options_{mid}.json").write_text(json.dumps(out, indent=1))
