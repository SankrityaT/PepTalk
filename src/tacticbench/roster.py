"""Per-player measurement, from the event feed.

The Roster placeholder in the interface said it was waiting on "stable player
identity across footage". That is true for drawing a name on a box in a video,
and it was wrongly treated as blocking the whole feature. Every number on a
player card is in the event data already, named, and currently discarded.

`state.py` drops player names on purpose — "Position name only. Names and
jersey numbers are deliberately dropped" — but that is anti-leakage for the
model path, so the model cannot recognise a match from its team sheet. A roster
reads the same events without going through `anonymize`, and nothing here is
ever shown to the model as input.

Six measures, chosen because a coach can act on each one:

    minutes                 from Starting XI and Substitution events
    touches                 events where the player had the ball
    final_third_entries     passes and carries that cross x=80
    progressive_ratio       share of passes that get 10y closer to goal
    xt_created              threat added by their completed passes and carries
    xt_left                 threat available on a better ball they did not play
    turnovers               dispossessions and miscontrols per 100 touches

`xt_left` is the one that makes the card worth opening. Every other number says
what a player did; that one says what was on and did not happen, which is the
only kind of number a coach can train against.

Rates are per 90. A substitute with twelve minutes and one good pass should not
top the list, and totals let them.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import httpx

from . import data, workspace
from . import xt as xt_mod
from .pass_options import analyse
from .pep import short_name

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

# A touch is possession of the ball, not merely appearing in an event. Pressure
# and Duel are actions on someone else's touch, so they are counted as defensive
# work rather than inflating a player's involvement.
TOUCH_TYPES = {
    "Pass",
    "Ball Receipt*",
    "Carry",
    "Shot",
    "Dribble",
    "Clearance",
    "Interception",
    "Ball Recovery",
    "Miscontrol",
    "Dispossessed",
    "Goal Keeper",
    "Foul Won",
}

DEFENSIVE_TYPES = {"Pressure", "Interception", "Ball Recovery", "Duel", "Block", "Clearance"}

PITCH_X = 120.0
FINAL_THIRD = 80.0
GOAL = (120.0, 40.0)

# Below this a card is noise: one substitute cameo is not a norm, and a roster
# that lists everyone buries the players a coach actually picks.
MIN_MINUTES = 45


def minutes_from_events(events: list[dict], team: str) -> dict[str, float]:
    """Minutes on the pitch, read off the events rather than the lineup feed.

    The lineup feed carries `positions[].from/to`, which looks like the obvious
    source and is wrong for any match that goes to a shootout. Messi's entry for
    the 2022 final reads:

        Right Wing          00:00  -> 115:32   periods 1 -> 4
        Right Center Fwd    115:32 -> 28:11    periods 4 -> 1
        Right Wing          28:19 -> None      period  1

    which totals 87 minutes for a man who played all 120. The clock restarts and
    the period numbering goes with it once period 5 begins.

    Events do not have that problem: `minute` is a continuous match clock, and
    Starting XI plus Substitution is a complete record of who was on. Period 5
    is excluded from the final whistle so a shootout does not credit everyone
    with an extra five minutes.
    """
    on: dict[str, float] = {}
    off: dict[str, float] = {}
    end = 0.0

    for e in events:
        t = e["type"]["name"]
        at = (e.get("minute") or 0) + (e.get("second") or 0) / 60.0
        if e.get("period", 1) <= 4:
            end = max(end, at)
        if (e.get("team") or {}).get("name") != team:
            continue

        if t == "Starting XI":
            for p in ((e.get("tactics") or {}).get("lineup") or []):
                name = (p.get("player") or {}).get("name")
                if name:
                    on.setdefault(name, 0.0)
        elif t == "Substitution":
            going = (e.get("player") or {}).get("name")
            coming = ((e.get("substitution") or {}).get("replacement") or {}).get("name")
            if going:
                off[going] = at
            if coming:
                on.setdefault(coming, at)
        elif t in {"Bad Behaviour", "Foul Committed"}:
            # A sending off ends a player's match as surely as a substitution.
            card = ((e.get(t.lower().replace(" ", "_")) or {}).get("card") or {}).get("name", "")
            name = (e.get("player") or {}).get("name")
            if name and "Red" in card:
                off[name] = at

    return {n: max(0.0, off.get(n, end) - start) for n, start in on.items()}


def dist_to_goal(x: float, y: float) -> float:
    return ((GOAL[0] - x) ** 2 + (GOAL[1] - y) ** 2) ** 0.5


def end_of(e: dict) -> list | None:
    t = e["type"]["name"]
    if t == "Pass":
        return (e.get("pass") or {}).get("end_location")
    if t == "Carry":
        return (e.get("carry") or {}).get("end_location")
    return None


def measure_match(match_id: int, team: str, xt_model: dict) -> dict[str, dict]:
    """Every player of this team in this match, measured.

    Returns full name -> counts. Rates are left to the caller, because a norm
    across games is a rate over summed minutes rather than an average of rates:
    a player who was excellent for ten minutes and ordinary for eighty is
    ordinary, and averaging per-match rates says otherwise.
    """
    with httpx.Client(timeout=120) as c:
        events = data.events(c, match_id)
        lineups = data.lineups(c, match_id)

    mins_by_name = minutes_from_events(events, team)

    out: dict[str, dict] = {}
    for side in lineups:
        if side.get("team_name") != team:
            continue
        for entry in side.get("lineup", []):
            name = entry.get("player_name")
            if not name:
                continue
            positions = entry.get("positions") or []
            if not positions or name not in mins_by_name:
                continue  # named in the squad, never came on
            mins = mins_by_name[name]
            out[name] = {
                "player_id": entry.get("player_id"),
                "name": name,
                "nickname": entry.get("player_nickname"),
                "jersey": entry.get("jersey_number"),
                "country": (entry.get("country") or {}).get("name"),
                # The position they started in, not the one they finished in: a
                # late shift to wing back is a tactical tweak, not who they are.
                "position": positions[0].get("position"),
                "minutes": round(mins, 1),
                "touches": 0,
                "passes": 0,
                "passes_completed": 0,
                "progressive": 0,
                "final_third_entries": 0,
                "defensive_actions": 0,
                "turnovers": 0,
                "shots": 0,
                "xt_created": 0.0,
                "xt_left": 0.0,
                "cards": len(entry.get("cards") or []),
            }

    for e in events:
        p = e.get("player") or {}
        name = p.get("name")
        row = out.get(name) if name else None
        if row is None or (e.get("team") or {}).get("name") != team:
            continue
        t = e["type"]["name"]
        if t in TOUCH_TYPES:
            row["touches"] += 1
        if t in DEFENSIVE_TYPES and (e.get("location") or [0])[0] > 60:
            row["defensive_actions"] += 1
        if t in {"Dispossessed", "Miscontrol"}:
            row["turnovers"] += 1
        if t == "Shot":
            row["shots"] += 1

        start = e.get("location")
        end = end_of(e)
        if not start or not end:
            continue
        if t == "Pass":
            row["passes"] += 1
            incomplete = (e.get("pass") or {}).get("outcome")
            if incomplete:
                continue
            row["passes_completed"] += 1
            if dist_to_goal(*start[:2]) - dist_to_goal(*end[:2]) >= 10:
                row["progressive"] += 1

        if start[0] < FINAL_THIRD <= end[0]:
            row["final_third_entries"] += 1

        # Threat added, on the same grid the whole product is scored against.
        gain = xt_mod.value_at(xt_model, end[0], end[1]) - xt_mod.value_at(
            xt_model, start[0], start[1]
        )
        if gain > 0:
            row["xt_created"] += gain

    return out


def rates_for(r: dict) -> dict:
    """Counts to per-90 rates. Shared with the fact builder, deliberately.

    A norm and a match reading have to be computed the same way or the arrow
    between them is measuring the difference between two formulas.
    """
    n = max(r["minutes"], 1.0) / 90.0
    return {
        "xt_created": round(r["xt_created"] / n, 3),
        "xt_left": round(r["xt_left"] / n, 3),
        "final_third_entries": round(r["final_third_entries"] / n, 2),
        "touches": round(r["touches"] / n, 1),
        "defensive_actions": round(r["defensive_actions"] / n, 2),
        "progressive_ratio": round(r["progressive"] / r["passes_completed"], 3)
        if r.get("passes_completed")
        else 0.0,
        "turnover_rate": round(100 * r["turnovers"] / r["touches"], 2)
        if r.get("touches")
        else 0.0,
    }


def add_xt_left(rows: dict[str, dict], match_id: int, team: str) -> None:
    """Threat the player had available on a better ball and did not play.

    Only passes with a 360 freeze frame are eligible, so this is a floor rather
    than a total. The card says how many passes it is drawn from for that
    reason.
    """
    try:
        found = analyse(match_id)
    except Exception:
        # StatsBomb 360 starts at Euro 2020, so a 2018 World Cup match has no
        # freeze frames and no reading here. Leaving xt_left at 0 would tell
        # the fact builder the player wasted nothing that day, which is a
        # fabricated observation rather than a missing one.
        return
    for name in rows:
        rows[name]["has_options"] = True
    for r in found.get("all_options", []):
        if r.get("team") != team:
            continue
        row = rows.get(r.get("player"))
        if row is None:
            continue
        row["xt_left"] += r["missed"]
        row["options_seen"] = row.get("options_seen", 0) + 1


def campaign(key: str | None = None) -> list[int]:
    """Every match this side played in the workspace's competition and season.

    Read from the graph rather than listed here, so a second workspace gets its
    own campaign by pointing at a different competition.
    """
    from .graph import Graph

    ws = workspace.load(key)
    g = Graph()
    try:
        rows = g.run(
            "MATCH (t:Team {name: $n})-[:PLAYED]->(m:Match) "
            "WHERE m.competition = $c AND m.season = $s "
            "RETURN m.statsbomb_id AS id ORDER BY m.date_ord",
            n=ws.team, c=ws.competition, s=ws.season,
        )
        return [int(r["id"]) for r in rows]
    finally:
        g.close()


def build(key: str | None = None, matches: list[int] | None = None) -> dict:
    """The roster: this match, and the same players across everything held."""
    ws = workspace.load(key)
    xt_model = json.loads((RESULTS / "xt_model.json").read_text())

    ids = matches or [ws.match_id]
    per_match: dict[int, dict[str, dict]] = {}
    for mid in ids:
        rows = measure_match(mid, ws.team, xt_model)
        add_xt_left(rows, mid, ws.team)
        per_match[mid] = rows

    # Career totals across whatever was passed in, summed rather than averaged.
    totals: dict[str, dict] = {}
    for mid, rows in per_match.items():
        for name, r in rows.items():
            t = totals.setdefault(
                name,
                {
                    k: r[k]
                    for k in ("player_id", "name", "nickname", "jersey", "country", "position")
                }
                | {"games": 0, "minutes": 0.0},
            )
            t["games"] += 1
            for k, v in r.items():
                if isinstance(v, (int, float)) and k not in {"player_id", "jersey"}:
                    t[k] = t.get(k, 0) + v
            t["jersey"] = r["jersey"] or t.get("jersey")

    def rates(r: dict) -> dict:
        return rates_for(r)


    here = per_match[ws.match_id]
    players = []
    for name, r in sorted(here.items(), key=lambda kv: -kv[1]["minutes"]):
        if r["minutes"] < MIN_MINUTES:
            continue
        t = totals[name]
        players.append(
            {
                "key": str(r["player_id"]),
                "name": name,
                # The name an encyclopaedia files them under, which is what the
                # photo fetcher needs: "Ángel Di María" has an article,
                # "Ángel Fabián Di María Hernández" does not even redirect.
                "nickname": r["nickname"],
                "short": short_name(r["nickname"] or name),
                "jersey": r["jersey"],
                "position": r["position"],
                "country": r["country"],
                "match": {
                    "minutes": round(r["minutes"], 1),
                    "touches": r["touches"],
                    "passes": r["passes"],
                    "passes_completed": r["passes_completed"],
                    "shots": r["shots"],
                    "options_seen": r.get("options_seen", 0),
                    **rates(r),
                },
                "across": {
                    "games": t["games"],
                    "minutes": round(t["minutes"], 1),
                    **rates(t),
                }
                if t["games"] > 1
                else None,
            }
        )

    return {
        "team": ws.team,
        "match_id": ws.match_id,
        "games_measured": len(ids),
        "min_minutes": MIN_MINUTES,
        "players": players,
    }


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=None)
    ap.add_argument(
        "--matches",
        default=None,
        help="comma-separated match ids, or 'campaign' for every game this side "
        "played in the workspace's competition and season",
    )
    ap.add_argument("--out", type=Path, default=None)
    args = ap.parse_args()

    if args.matches == "campaign":
        ids = campaign(args.workspace)
    elif args.matches:
        ids = [int(x) for x in args.matches.split(",")]
    else:
        ids = None
    snap = build(args.workspace, ids)
    out = args.out or ROOT / "src" / "content" / "snapshots" / "roster.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(snap, indent=2) + "\n")

    print(f"{len(snap['players'])} players over {MIN_MINUTES} minutes, {snap['games_measured']} games measured")
    for p in snap["players"][:6]:
        m = p["match"]
        print(
            f"  {str(p['jersey'] or '?'):>2}  {p['short']:<16} {p['position']:<22} "
            f"{m['minutes']:>5.1f}m  xT+{m['xt_created']:.2f}  left {m['xt_left']:.2f}"
        )
    print(f"wrote {out}")


if __name__ == "__main__":
    main()
