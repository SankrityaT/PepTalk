"""Extract what the trailing team actually changed after halftime.

Deliberately derived from event data, never from match reports. Post-hoc
narrative is a real contaminant: Hamann's introduction at Istanbul is famous
because Liverpool won, and if they had lost 5-0 nobody would name it. Event data
has no such bias.

Second-half state is computed with the same functions as the first half, so the
comparison is like-for-like.
"""

from __future__ import annotations

from .state import _player_positions, _team_metrics, parse_formation

# Deadbands: change smaller than this counts as "unchanged". Units are pitch
# metres on StatsBomb's 120x80 grid, except ratios which are absolute.
DEADBAND = {
    "press_height": 2.0,
    "defensive_action_height": 2.0,
    "team_width": 1.5,
    "pass_forward_ratio": 0.03,
    "avg_pass_length": 1.5,
}


def _direction(delta: float | None, band: float, up: str, down: str) -> str:
    if delta is None:
        return "unknown"
    if delta > band:
        return up
    if delta < -band:
        return down
    return "unchanged"


def _half_metrics(events: list[dict], team: str, period: int) -> dict:
    half = [e for e in events if e.get("period") == period]
    return _team_metrics(half, team, len(half))


def formation_timeline(events: list[dict], team: str) -> list[dict]:
    """Starting shape plus every in-match tactical shift for one team."""
    out = []
    for e in events:
        if e.get("team", {}).get("name") != team:
            continue
        name = e.get("type", {}).get("name")
        if name in ("Starting XI", "Tactical Shift"):
            tactics = e.get("tactics") or {}
            if (f := tactics.get("formation")) is not None:
                out.append(
                    {
                        "period": e.get("period"),
                        "minute": e.get("minute"),
                        "formation": parse_formation(f),
                        "event": name,
                    }
                )
    return out


def halftime_substitutions(events: list[dict], team: str) -> list[dict]:
    """Substitutions made at the break or in the opening minutes of period 2.

    StatsBomb logs a halftime change as a period-2 substitution at minute 45.
    """
    out = []
    for e in events:
        if (
            e.get("type", {}).get("name") == "Substitution"
            and e.get("team", {}).get("name") == team
            and e.get("period") == 2
            and e.get("minute", 99) <= 50
        ):
            out.append(
                {
                    "minute": e.get("minute"),
                    "position_off": e.get("position", {}).get("name"),
                    "reason": e.get("substitution", {}).get("outcome", {}).get("name"),
                }
            )
    return out


def actual_intervention(events: list[dict], team: str) -> dict:
    """Categorical description of the trailing team's second-half changes.

    Output dimensions mirror the recommendation schema exactly so scoring is a
    mechanical comparison rather than a judgement call.
    """
    m1 = _half_metrics(events, team, 1)
    m2 = _half_metrics(events, team, 2)

    timeline = formation_timeline(events, team)
    start_shape = timeline[0]["formation"] if timeline else None
    second_half_shapes = [t for t in timeline if t["period"] and t["period"] >= 2]
    shifted = bool(second_half_shapes)
    end_shape = second_half_shapes[-1]["formation"] if shifted else start_shape

    subs = halftime_substitutions(events, team)

    # Known data limitation, verified on match 2302764: StatsBomb does not always
    # log a period-2 Tactical Shift even when the shape demonstrably changed.
    # Liverpool switched to three at the back at Istanbul, and neither the
    # formation field nor the per-event position labels reflect it.
    #
    # Reporting changed=False there would be a systematic false negative on the
    # single most important scoring dimension. Instead the dimension is marked
    # undetermined and excluded from the denominator by the scorer. A tactical
    # substitution at the break is recorded as a weaker corroborating signal.
    if not shifted:
        shape_status = "undetermined"
    elif end_shape != start_shape:
        shape_status = "changed"
    else:
        shape_status = "unchanged"

    def delta(key: str) -> float | None:
        a, b = m1.get(key), m2.get(key)
        return None if a is None or b is None else b - a

    return {
        "shape_change": {
            "status": shape_status,
            "from_formation": start_shape,
            "to_formation": end_shape if shifted else None,
            "implied_by_tactical_sub": any(s["reason"] == "Tactical" for s in subs),
        },
        "personnel": {
            "halftime_substitutions": len(subs),
            "positions_replaced": [s["position_off"] for s in subs if s["position_off"]],
        },
        "pressing_height": _direction(
            delta("press_height"), DEADBAND["press_height"], "higher", "lower"
        ),
        "width": _direction(
            delta("team_width"), DEADBAND["team_width"], "wider", "narrower"
        ),
        "tempo": _direction(
            delta("pass_forward_ratio"),
            DEADBAND["pass_forward_ratio"],
            "more_direct",
            "more_patient",
        ),
        "deltas": {
            "press_height": delta("press_height"),
            "defensive_action_height": delta("defensive_action_height"),
            "team_width": delta("team_width"),
            "pass_forward_ratio": delta("pass_forward_ratio"),
            "avg_pass_length": delta("avg_pass_length"),
            "possession_share_pct": delta("possession_share_pct"),
            "final_third_entries": delta("final_third_entries"),
        },
    }
