"""Who actually won, including the shootout.

    uv run python -m tacticbench.result 3869685

Every model in this repo excludes the shootout, and that is right: eight
penalties would swamp a match's chance count and say nothing about how a side
played. `drop_shootout` exists precisely so Liverpool do not appear to have
generated 4.93 xG in Istanbul.

But the *result* is not a model input, it is a fact about the game, and
excluding the shootout from it produced a card reading `D 3-3` for a World Cup
final Argentina won. Two of the campaign's knockout ties came back as draws
the same way. That is the kind of error a football person spots instantly and
then distrusts everything else on the page for.

So the two are separated here. The models keep their clean open-play view; the
scoreline is computed from the whole game, shootout included, and says so.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from . import data

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

#: StatsBomb records the shootout as its own period.
SHOOTOUT_PERIOD = 5


def shootout(events: list[dict]) -> dict[str, int] | None:
    """Penalties scored per side, or None if the tie did not go that far."""
    pens = [
        e for e in events
        if e.get("period") == SHOOTOUT_PERIOD and e["type"]["name"] == "Shot"
    ]
    if not pens:
        return None
    out: dict[str, int] = {}
    for e in pens:
        team = e["team"]["name"]
        scored = e.get("shot", {}).get("outcome", {}).get("name") == "Goal"
        out[team] = out.get(team, 0) + (1 if scored else 0)
    return out


def result_for(match: dict, events: list[dict], team: str) -> dict:
    """The real result of one match from one side's point of view."""
    home = match["home_team"]["home_team_name"]
    away = match["away_team"]["away_team_name"]
    at_home = team == home

    # Normal time plus extra time, which is what the official score is.
    us = match["home_score"] if at_home else match["away_score"]
    them = match["away_score"] if at_home else match["home_score"]

    pens = shootout(events)
    out = {
        "us": us,
        "them": them,
        "opponent": away if at_home else home,
        "went_to_penalties": bool(pens),
        "stage": match.get("competition_stage", {}).get("name", ""),
    }

    if pens:
        ours = pens.get(team, 0)
        theirs = sum(v for k, v in pens.items() if k != team)
        out["pens"] = {"us": ours, "them": theirs}
        out["outcome"] = "W" if ours > theirs else "L" if ours < theirs else "D"
        out["scoreline"] = f"{us}-{them} ({ours}-{theirs} pens)"
    else:
        out["outcome"] = "W" if us > them else "L" if us < them else "D"
        out["scoreline"] = f"{us}-{them}"

    return out


def main() -> None:
    import sys

    mid = int(sys.argv[1]) if len(sys.argv) > 1 else 3869685
    team = sys.argv[2] if len(sys.argv) > 2 else "Argentina"
    with httpx.Client(timeout=120) as c:
        match = next(m for m in data.all_matches(c) if m["match_id"] == mid)
        events = data.events(c, mid)

    r = result_for(match, events, team)
    print(f"{team} v {r['opponent']}  ({r['stage']})")
    print(f"  {r['outcome']}  {r['scoreline']}")
    if r["went_to_penalties"]:
        print("  decided on penalties")

    RESULTS.mkdir(exist_ok=True)
    (RESULTS / f"result_{mid}.json").write_text(json.dumps(r, indent=1))


if __name__ == "__main__":
    main()
