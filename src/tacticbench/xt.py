"""Expected threat, learned from elite football.

    uv run python -u -m tacticbench.xt build

Expected threat (xT) answers "how dangerous is having the ball here?" — the
probability that possession in a pitch zone leads to a goal within the next few
actions. It is the model that lets a system say *he played the safe one worth
+0.02; the ball into the channel was worth +0.11*, which is what a coach
actually wants to hear and what a bounding box can never say.

Method is Karun Singh's. For every zone z:

    xT[z] = P(shot|z) * P(goal|shot,z)
          + P(move|z) * sum over z' of T[z][z'] * xT[z']

read as: the value of a zone is the chance you score from it directly, plus the
chance you move the ball somewhere better times how good that place is. Solved
by iteration from a zero grid; it converges in a handful of passes.

Why this is the defensible part
-------------------------------
Player detection is a commodity — YOLO installs in one command and anyone can
run it. This is not. The grid below is distilled from thousands of matches of
elite football, and it is what makes the product's actual claim possible:
judging a Sunday league pass against how the best teams in the world move the
ball. The graph is where that knowledge lives and compounds; the detector is
just how frames get in.
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from .data import CACHE
from .state import PITCH_X, PITCH_Y, drop_shootout

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

# 16x12 is the usual choice: fine enough that the penalty area is several
# cells, coarse enough that each cell still sees thousands of actions.
GRID_X = 16
GRID_Y = 12

MOVE_TYPES = {"Pass", "Carry"}


def cell(x: float, y: float) -> tuple[int, int]:
    cx = min(GRID_X - 1, max(0, int(x / PITCH_X * GRID_X)))
    cy = min(GRID_Y - 1, max(0, int(y / PITCH_Y * GRID_Y)))
    return cx, cy


def _end_location(e: dict) -> list | None:
    t = e["type"]["name"]
    if t == "Pass":
        # An incomplete pass does not deliver the ball anywhere, so it must not
        # contribute to the transition matrix.
        if e.get("pass", {}).get("outcome"):
            return None
        return e.get("pass", {}).get("end_location")
    if t == "Carry":
        return e.get("carry", {}).get("end_location")
    return None


def accumulate(events: list[dict], acc: dict) -> None:
    """Fold one match's events into the running counts."""
    for e in drop_shootout(events):
        t = e["type"]["name"]
        loc = e.get("location")
        if not loc or len(loc) < 2:
            continue
        cx, cy = cell(loc[0], loc[1])

        if t == "Shot":
            acc["shots"][cx, cy] += 1
            acc["xg"][cx, cy] += float(e.get("shot", {}).get("statsbomb_xg") or 0.0)
        elif t in MOVE_TYPES:
            end = _end_location(e)
            if not end or len(end) < 2:
                continue
            ex, ey = cell(end[0], end[1])
            acc["moves"][cx, cy] += 1
            acc["trans"][cx, cy, ex, ey] += 1


def new_accumulator() -> dict:
    return {
        "shots": np.zeros((GRID_X, GRID_Y)),
        "xg": np.zeros((GRID_X, GRID_Y)),
        "moves": np.zeros((GRID_X, GRID_Y)),
        "trans": np.zeros((GRID_X, GRID_Y, GRID_X, GRID_Y)),
    }


def solve(acc: dict, iterations: int = 8) -> dict:
    """Iterate the xT recurrence to convergence."""
    shots, xg, moves, trans = acc["shots"], acc["xg"], acc["moves"], acc["trans"]
    total = shots + moves
    safe = np.where(total > 0, total, 1)

    p_shot = shots / safe
    p_move = moves / safe
    # Mean xG of shots taken from the zone: the payoff if you do shoot.
    p_goal = np.divide(xg, np.where(shots > 0, shots, 1))

    # Row-normalise the transition matrix.
    tsum = trans.sum(axis=(2, 3), keepdims=True)
    T = np.divide(trans, np.where(tsum > 0, tsum, 1))

    xt = np.zeros((GRID_X, GRID_Y))
    history = []
    for _ in range(iterations):
        moved_value = np.einsum("ijkl,kl->ij", T, xt)
        nxt = p_shot * p_goal + p_move * moved_value
        history.append(float(np.abs(nxt - xt).max()))
        xt = nxt

    return {
        "grid_x": GRID_X,
        "grid_y": GRID_Y,
        "xt": xt.tolist(),
        "p_shot": p_shot.tolist(),
        "p_goal": p_goal.tolist(),
        "actions": int(total.sum()),
        "shots": int(shots.sum()),
        "convergence": [round(h, 6) for h in history],
    }


def value_at(model: dict, x: float, y: float) -> float:
    """xT of a pitch location, in StatsBomb coordinates."""
    cx, cy = cell(x, y)
    return float(model["xt"][cx][cy])


def build(limit: int | None = None) -> dict:
    """Train on every cached match."""
    files = sorted((CACHE / "events").glob("*.json"))
    if limit:
        files = files[:limit]
    print(f"training xT on {len(files)} cached matches...", flush=True)

    acc = new_accumulator()
    used = failed = 0
    for i, f in enumerate(files, 1):
        try:
            accumulate(json.loads(f.read_text()), acc)
            used += 1
        except Exception:
            failed += 1
        if i % 250 == 0:
            print(f"  {i}/{len(files)}  ({failed} unreadable)", flush=True)

    model = solve(acc)
    model["matches"] = used
    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "xt_model.json").write_text(json.dumps(model))
    print(
        f"\ntrained on {used} matches, {model['actions']:,} actions, "
        f"{model['shots']:,} shots"
    )
    print(f"convergence (max delta per iteration): {model['convergence']}")
    return model


if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "build"
    if cmd == "build":
        m = build()
        xt = np.array(m["xt"])
        print(f"\nxT range: {xt.min():.4f} .. {xt.max():.4f}")
        print("value by pitch third (own -> opposition):")
        for i, name in enumerate(["own", "middle", "final"]):
            band = xt[i * GRID_X // 3 : (i + 1) * GRID_X // 3]
            print(f"  {name:<8} mean {band.mean():.4f}  max {band.max():.4f}")
    else:
        raise SystemExit("usage: xt build")
