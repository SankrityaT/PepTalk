"""How the goals went in.

    uv run python -m tacticbench.conceded

The rest of the system asks what a side failed to do with the ball. This asks
the question a coach actually loses sleep over: when we conceded, what happened
in front of us.

For each goal against, it pulls the passage that produced it, the freeze frame
at the shot, and a read of the defence at that instant. Everything here is
measured off StatsBomb's 360 frame, which records every player on the pitch
when the ball was struck, so the defensive claims are as checkable as the
attacking ones:

* how many defenders were goal side of the ball
* how far the nearest one was from the scorer
* whether the shot came from inside the box

What it does not do is assign blame. "Nobody picked him up" needs to know who
was responsible for whom, which is a coaching decision the data does not carry.
It reports where people were and lets the coach draw that conclusion, which is
the honest division of labour.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import httpx

from . import data, workspace
from .pass_options import load_360

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

GOAL = (120.0, 40.0)
BOX_X = 102.0
BOX_Y = (18.0, 62.0)

#: How far back to walk the passage that produced the goal.
BUILD_UP_S = 20

#: Events worth showing in a build-up. Receipts and pressure events triple the
#: length of the sequence without telling a coach anything new.
KEEP = {"Pass", "Carry", "Shot", "Dribble", "Interception", "Clearance", "Duel"}


def in_box(x: float, y: float) -> bool:
    return x >= BOX_X and BOX_Y[0] <= y <= BOX_Y[1]


def goal_side(defender: list[float], ball: list[float]) -> bool:
    """Is this defender between the ball and the goal?"""
    return defender[0] > ball[0]


def read_defence(shot: dict, frame: dict | None) -> dict:
    """What the defence looked like when the ball was struck."""
    loc = shot.get("location") or [0, 0]
    out: dict = {
        "from_box": in_box(loc[0], loc[1]),
        "distance_to_goal": round(math.dist(loc[:2], GOAL), 1),
    }
    if not frame:
        return out

    # In the shooter's freeze frame, `teammate` is a France player, so the
    # defenders are the ones flagged otherwise.
    defenders = [p["location"] for p in frame["freeze_frame"] if not p.get("teammate")]
    if not defenders:
        return out

    nearest = min(math.dist(loc[:2], d) for d in defenders)
    out.update(
        {
            "defenders_visible": len(defenders),
            "defenders_goal_side": sum(1 for d in defenders if goal_side(d, loc)),
            "nearest_defender_yds": round(nearest, 1),
            "defenders_in_box": sum(1 for d in defenders if in_box(d[0], d[1])),
        }
    )
    return out


def describe(shot: dict, defence: dict) -> str:
    """One line, computed. Positions only; never who should have been there.

    Penalties are handled apart. Reporting "nearest defender 10 yards" for a
    spot kick is arithmetic about a wall, and it invites a coach to study a
    defensive shape that was never being asked to defend. The thing to look at
    for a penalty is the passage before the whistle.
    """
    kind = shot.get("shot", {}).get("type", {}).get("name", "")
    if kind == "Penalty":
        # The clip runs from before the whistle on purpose. Geometry at the
        # spot kick describes a wall; what a coach needs to see is the foul.
        return (
            "A penalty. Watch the twenty seconds before the whistle, because "
            "that is where it was given away."
        )
    n = defence.get("nearest_defender_yds")
    goal_side_n = defence.get("defenders_goal_side")
    where = "inside the box" if defence["from_box"] else f"from {defence['distance_to_goal']:.0f} yards"

    bits = [f"Struck {where}."]
    if n is not None:
        bits.append(
            f"Nearest defender {n:.0f} yards away"
            if n >= 3
            else f"A defender was right on him, {n:.0f} yards"
        )
    if goal_side_n is not None:
        bits.append(f"{goal_side_n} bodies goal side of the ball")
    return ", ".join(bits) + "."


def build(match_id: int, team: str) -> list[dict]:
    """Every goal this side conceded, with the passage that produced it."""
    frames = load_360(match_id)
    with httpx.Client(timeout=120) as c:
        events = data.events(c, match_id)

    def clock(e: dict) -> int:
        return e["minute"] * 60 + e.get("second", 0)

    out = []
    for e in events:
        if e["type"]["name"] != "Shot":
            continue
        if e.get("shot", {}).get("outcome", {}).get("name") != "Goal":
            continue
        if e["team"]["name"] == team:
            continue
        # The shootout is not a goal conceded in play.
        if e.get("period", 1) >= 5:
            continue

        t = clock(e)
        frame = frames.get(e.get("id", ""))
        defence = read_defence(e, frame)

        passage = []
        for p in events:
            if not (t - BUILD_UP_S <= clock(p) <= t):
                continue
            if p["type"]["name"] not in KEEP:
                continue
            passage.append(
                {
                    "minute": p["minute"],
                    "second": p.get("second", 0),
                    "type": p["type"]["name"],
                    "team": p["team"]["name"],
                    "player": (p.get("player") or {}).get("name"),
                    "location": p.get("location"),
                }
            )

        out.append(
            {
                "minute": e["minute"],
                "second": e.get("second", 0),
                "period": e.get("period", 1),
                "clock": f"{e['minute']}:{e.get('second', 0):02d}",
                "scorer": e["player"]["name"],
                "team": e["team"]["name"],
                "kind": e["shot"].get("type", {}).get("name", ""),
                "xg": round(e["shot"].get("statsbomb_xg", 0.0), 3),
                "location": e.get("location"),
                "defence": defence,
                "line": describe(e, defence),
                "passage": passage[-12:],
                "freeze": [
                    {
                        "x": round(float(p["location"][0]), 1),
                        "y": round(float(p["location"][1]), 1),
                        # From this bench, "mate" means one of ours, so the
                        # flag is inverted: the shooter's teammates are theirs.
                        "mate": not p.get("teammate"),
                        "actor": bool(p.get("actor")),
                        "keeper": bool(p.get("keeper")),
                    }
                    for p in (frame or {}).get("freeze_frame", [])
                    if p.get("location")
                ],
            }
        )
    return out


def main() -> None:
    ws = workspace.load()
    goals = build(ws.match_id, ws.team)
    print(f"{len(goals)} goals conceded\n")
    for g in goals:
        d = g["defence"]
        print(f"  {g['clock']:>7}  {g['scorer'].split()[-1]:<12} {g['kind']:<11} xg={g['xg']:.3f}")
        print(f"           {g['line']}")
        if "defenders_in_box" in d:
            print(f"           {d['defenders_in_box']} of yours in the box, "
                  f"{d['defenders_visible']} tracked in frame")
        print(f"           passage: {len(g['passage'])} events")
        print()

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / "conceded.json").write_text(json.dumps(goals, indent=1))
    print(f"wrote {RESULTS / 'conceded.json'}")


if __name__ == "__main__":
    main()
