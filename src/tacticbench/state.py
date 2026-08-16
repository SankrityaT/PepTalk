"""Derive first-half tactical state from StatsBomb events.

Coordinate convention (verified against match 2302764): StatsBomb records every
event in the acting team's own attacking frame, so x=120 is always the goal that
team is attacking. A team's *defensive* actions therefore sit at low x when they
are defending deep, and high x when they press.

The y axis is mirrored the same way: y=0 is that team's own left touchline.
Verified on Liverpool's back line, which runs monotonically from Left Midfield
(y=12.7) through the goalkeeper (y=40.2) to Right Back (y=73.7). So
``build_up_side_pct`` is always relative to the team's own attacking direction,
never to a fixed broadcast camera.

Note that position labels come from the lineup slot while coordinates come from
observed events, so a drifting centre-back can appear on the "wrong" side. That
is real data, not an extraction bug.

Everything produced here must survive anonymization, so no player names, jersey
numbers, team names, or competition metadata are read into the output.
"""

from __future__ import annotations

import statistics as st
from dataclasses import dataclass, field

PITCH_X = 120.0
PITCH_Y = 80.0

DEFENSIVE_ACTIONS = {"Pressure", "Duel", "Interception", "Block", "Clearance"}
FINAL_THIRD_X = 80.0

# StatsBomb period 5 is the penalty shootout. Verified on match 2302764
# (Istanbul 2005): eight shootout penalties contributed 6.27 xG — more than the
# 4.94 xG from all 120 minutes of actual football. Counting them makes any match
# that went to penalties look like a shooting gallery, so they are excluded from
# every metric. Extra time (periods 3 and 4) is kept: it is open play.
SHOOTOUT_PERIOD = 5


def drop_shootout(events: list[dict]) -> list[dict]:
    return [e for e in events if e.get("period") != SHOOTOUT_PERIOD]


def parse_formation(code: int | str) -> str:
    """StatsBomb encodes formations as digit runs: 41212 -> '4-1-2-1-2'."""
    return "-".join(str(code))


def _loc(e: dict) -> tuple[float, float] | None:
    loc = e.get("location")
    if not loc or len(loc) < 2:
        return None
    return float(loc[0]), float(loc[1])


def _mean(xs: list[float]) -> float | None:
    return round(st.mean(xs), 2) if xs else None


def _stdev(xs: list[float]) -> float | None:
    return round(st.stdev(xs), 2) if len(xs) > 1 else None


@dataclass
class TeamState:
    formation: str | None = None
    players: list[dict] = field(default_factory=list)
    metrics: dict = field(default_factory=dict)


def _starting_elevens(events: list[dict]) -> dict[str, dict]:
    out = {}
    for e in events:
        if e.get("type", {}).get("name") == "Starting XI":
            out[e["team"]["name"]] = e
    return out


def _player_positions(events: list[dict], team: str) -> dict[str, dict]:
    """Average position and touch count per player, keyed by position name."""
    acc: dict[str, dict] = {}
    for e in events:
        if e.get("team", {}).get("name") != team:
            continue
        pos = e.get("position", {}).get("name")
        loc = _loc(e)
        if not pos or not loc:
            continue
        slot = acc.setdefault(pos, {"xs": [], "ys": []})
        slot["xs"].append(loc[0])
        slot["ys"].append(loc[1])
    return acc


def _team_metrics(events: list[dict], team: str, total_events: int) -> dict:
    events = drop_shootout(events)
    total_events = len(events) or total_events
    own = [e for e in events if e.get("team", {}).get("name") == team]

    passes = [e for e in own if e.get("type", {}).get("name") == "Pass"]
    shots = [e for e in own if e.get("type", {}).get("name") == "Shot"]
    def_acts = [
        e for e in own if e.get("type", {}).get("name") in DEFENSIVE_ACTIONS
    ]
    pressures = [e for e in own if e.get("type", {}).get("name") == "Pressure"]

    pass_locs = [l for e in passes if (l := _loc(e))]
    def_locs = [l for e in def_acts if (l := _loc(e))]
    press_locs = [l for e in pressures if (l := _loc(e))]

    # Pass direction: end_location minus origin along x.
    forward = 0
    lengths: list[float] = []
    final_third_entries = 0
    for e in passes:
        start = _loc(e)
        end = e.get("pass", {}).get("end_location")
        if not start or not end or len(end) < 2:
            continue
        dx = float(end[0]) - start[0]
        dy = float(end[1]) - start[1]
        lengths.append(round((dx**2 + dy**2) ** 0.5, 2))
        if dx > 0:
            forward += 1
        if start[0] < FINAL_THIRD_X <= float(end[0]):
            final_third_entries += 1

    # Build-up side: which vertical third the team plays through.
    left = sum(1 for _, y in pass_locs if y < PITCH_Y / 3)
    centre = sum(1 for _, y in pass_locs if PITCH_Y / 3 <= y < 2 * PITCH_Y / 3)
    right = sum(1 for _, y in pass_locs if y >= 2 * PITCH_Y / 3)

    xg = sum(e.get("shot", {}).get("statsbomb_xg", 0.0) for e in shots)

    return {
        "possession_share_pct": round(100 * len(own) / total_events, 1)
        if total_events
        else None,
        "passes": len(passes),
        "pass_forward_ratio": round(forward / len(lengths), 3) if lengths else None,
        "avg_pass_length": _mean(lengths),
        "final_third_entries": final_third_entries,
        "build_up_side_pct": {
            "left": round(100 * left / len(pass_locs), 1) if pass_locs else None,
            "centre": round(100 * centre / len(pass_locs), 1) if pass_locs else None,
            "right": round(100 * right / len(pass_locs), 1) if pass_locs else None,
        },
        "defensive_action_height": _mean([x for x, _ in def_locs]),
        "press_height": _mean([x for x, _ in press_locs]),
        "presses_in_opposition_half": sum(1 for x, _ in press_locs if x > PITCH_X / 2),
        "team_width": _stdev([y for _, y in pass_locs]),
        "shots": len(shots),
        "xg": round(xg, 3),
    }


def first_half_state(events: list[dict], home: str, away: str) -> dict:
    """Tactical state of both teams over period 1, ready for anonymization."""
    p1 = [e for e in events if e.get("period") == 1]
    xis = _starting_elevens(events)

    out: dict[str, dict] = {}
    for side, team in (("home", home), ("away", away)):
        ts = TeamState()
        xi = xis.get(team)
        if xi:
            ts.formation = parse_formation(xi["tactics"]["formation"])

        avg = _player_positions(p1, team)
        # Position name only. Names and jersey numbers are deliberately dropped.
        for pos, slot in sorted(avg.items()):
            ts.players.append(
                {
                    "position": pos,
                    "avg_x": _mean(slot["xs"]),
                    "avg_y": _mean(slot["ys"]),
                    "touches": len(slot["xs"]),
                }
            )

        ts.metrics = _team_metrics(p1, team, len(p1))

        xs = [p["avg_x"] for p in ts.players if p["avg_x"] is not None]
        ts.metrics["shape_depth"] = (
            round(max(xs) - min(xs), 2) if len(xs) > 1 else None
        )

        out[side] = {
            "formation": ts.formation,
            "players": ts.players,
            "metrics": ts.metrics,
        }

    return out


def substitutions_used(events: list[dict], team: str, period: int = 1) -> int:
    return sum(
        1
        for e in events
        if e.get("period") == period
        and e.get("type", {}).get("name") == "Substitution"
        and e.get("team", {}).get("name") == team
    )
