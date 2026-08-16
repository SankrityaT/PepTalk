"""The next fixture, and what the graph holds on whoever it is against.

The snapshot this replaces was built by hand and picked the opponent as
whichever side had the most matches in the graph. For an Argentina workspace
that returned Barcelona: 531 games of a club side a national team has never
played, presented as the next match. Convincing until someone reads it.

The fixture is now a query. Take the workspace's match date, ask for the team's
next match after it, and prepare for whoever that turns out to be. Every number
about them is then scoped to what the graph actually holds, which is the honest
and more interesting quantity: a coach who has seen five of someone is in a
different position from one who has seen five hundred, and the interface should
say which.

Two cases have to be handled rather than hidden:

* **No later match.** The workspace's game is the most recent one in the data,
  which is where the second workspace will start life. There is nothing to
  prepare for and the snapshot says so.
* **A thin opponent.** The fixture is real but the graph has barely seen them.
  The card reports the count and every dimension that abstains stays absent
  rather than being filled with a league average.
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
from pathlib import Path

from . import workspace
from .coach import DIMENSION_LABELS
from .graph import Graph, team_id_for
from .temporal import OPEN_ENDED

ROOT = Path(__file__).resolve().parents[2]
SNAPSHOT = ROOT / "src" / "content" / "snapshots" / "scout.json"


def human(o: int) -> str:
    return "present" if o >= OPEN_ENDED else dt.date.fromordinal(o).isoformat()


def fixtures(g: Graph, team: str) -> list[dict]:
    """Every match this side has played, oldest first."""
    rows = g.run(
        "MATCH (t:Team {name: $n})-[:PLAYED]->(m:Match) "
        "RETURN m.statsbomb_id AS statsbomb_id, m.date AS date, "
        "m.date_ord AS date_ord, m.label AS label, "
        "m.competition AS competition, m.stage AS stage "
        "ORDER BY m.date_ord",
        n=team,
    )
    return [dict(r) for r in rows]


def opponent_of(label: str, team: str) -> str | None:
    """The other name in "Argentina 3-3 France".

    Scorelines carry no separator beyond the digits, so the split is on the
    team's own name and whatever remains with the score stripped is the
    opponent. Returns None rather than a guess when the label does not parse,
    which happens if a side's name ever contains a digit.
    """
    if team not in label:
        return None
    rest = label.replace(team, "", 1).strip()
    parts = rest.split()
    # Drop the scoreline, wherever it landed: "3-3 France" or "France 3-3".
    parts = [p for p in parts if not any(c.isdigit() for c in p)]
    name = " ".join(parts).strip()
    return name or None


def next_fixture(g: Graph, team: str, after_match: int) -> dict | None:
    """The match this side played next, or None if there is not one.

    Keyed off the workspace match's own date rather than today's, so the
    snapshot is reproducible: a demo recorded in August and replayed in
    December prepares for the same opponent.
    """
    played = fixtures(g, team)
    here = next((m for m in played if m["statsbomb_id"] == after_match), None)
    if here is None:
        raise SystemExit(
            f"{team} has no match {after_match} in the graph. "
            "Ingest it first, or point the workspace at one that is there."
        )
    later = [m for m in played if m["date_ord"] > here["date_ord"]]
    if not later:
        return None
    nxt = later[0]
    return {**nxt, "opponent": opponent_of(nxt["label"], team), "after": here}


def read(g: Graph, team: str, at: int) -> dict:
    """Both lookups for every dimension: dated, and the flat one without dates.

    `norms` is what HydraDB answers. `flat` is the same question asked of a
    store with no validity intervals, which is the comparison the memory switch
    turns on and off.
    """
    tid = team_id_for(team)
    norms: dict[str, dict] = {}
    flat: dict[str, dict | None] = {}
    for dim in DIMENSION_LABELS:
        f = g.fact_at(tid, dim, at)
        if f:
            norms[dim] = {
                "band": f["band"],
                "value": round(f["median_value"], 2) if f["median_value"] is not None else None,
                "obs": f["observations"],
                "since": human(f["valid_from"]),
                "id": f["id"],
            }
        flat[dim] = g.flat_lookup(tid, dim)
    return {"norms": norms, "flat": flat}


def build(key: str | None = None) -> dict:
    """The snapshot: my norms, the next opponent's, and how thin they are."""
    ws = workspace.load(key)
    g = Graph()
    try:
        nxt = next_fixture(g, ws.team, ws.match_id)
        # Read both sides as of the fixture, not as of today. What was true
        # when they last met is not the question a coach is asking.
        at = nxt["date_ord"] if nxt else None
        played = fixtures(g, ws.team)
        here = next(m for m in played if m["statsbomb_id"] == ws.match_id)
        mine = read(g, ws.team, at or here["date_ord"])

        out: dict = {
            "team": ws.team,
            "labels": DIMENSION_LABELS,
            "mine": mine,
            "after": {
                "label": here["label"],
                "date": here["date"],
                "competition": here["competition"],
                "stage": here.get("stage"),
            },
        }

        if nxt is None or not nxt["opponent"]:
            out["fixture"] = None
            out["opponents"] = {}
            return out

        name = nxt["opponent"]
        theirs = read(g, name, nxt["date_ord"])
        theirs["games"] = len(fixtures(g, name))
        out["fixture"] = {
            "opponent": name,
            "date": nxt["date"],
            "competition": nxt["competition"],
            "stage": nxt.get("stage"),
            "statsbomb_id": nxt["statsbomb_id"],
            "label": nxt["label"],
        }
        out["opponents"] = {name: theirs}
        return out
    finally:
        g.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--out", type=Path, default=SNAPSHOT)
    args = ap.parse_args()

    snap = build(args.workspace)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(snap, indent=2) + "\n")

    f = snap.get("fixture")
    if f:
        held = snap["opponents"][f["opponent"]]["games"]
        print(
            f"next: {f['opponent']} on {f['date']} "
            f"({f['competition']}, {f['stage']}) — {held} of theirs in the graph"
        )
    else:
        print(f"no fixture after {snap['after']['label']} on {snap['after']['date']}")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
