"""Player facts: what was true of a footballer, and when it stopped being true.

The team side of this graph already holds dated facts with a supersession
chain, which is the argument for storing any of it in HydraDB rather than a
vector index: "Barcelona pressed high, and that ended in 2020" is a claim with
a shape a nearest-neighbour lookup cannot represent.

A squad is the same question one level down, and it is the level a coach
actually works at. "He is giving the ball away more" is a hunch. "He is giving
it away 1.8 times per 100 touches, against 0.7 across the 17 games I hold, and
it has been that way since the 2024 group stage" is something to take into a
session on Tuesday.

Everything reuses the team machinery — `build_facts`, the same banding, the
same `SUPERSEDED_BY` chain — with two differences that matter.

**Band edges come from the squad, not the player.** High and low have to mean
something against peers, so the thresholds are quantiles over every
player-match observation pooled, and a centre back is then legitimately "low"
for final-third entries. That is a description of his job, not a criticism, and
the interface says so by showing position beside band.

**The window scales to the series.** The team defaults (window 15, min_run 8)
were tuned against Barcelona's 531 matches. A player with 17 international
appearances smoothed over a 15-match window has no history left at all: one
band, one fact, forever. Both parameters scale with the length of the series
and are floored so that a short series honestly resolves to a single era rather
than being chopped into noise.
"""

from __future__ import annotations

import argparse
import json
import statistics as st
from collections import defaultdict
from pathlib import Path

import httpx

from . import data, workspace
from . import xt as xt_mod
from .graph import Graph, date_ord, team_id_for
from .roster import add_xt_left, measure_match, rates_for
from .temporal import (
    Fact,
    Observation,
    build_facts,
    merge_insignificant,
    quantile_thresholds,
)

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

PLAYER_ID_BASE = 600_000_000
PLAYER_FACT_ID_BASE = 700_000_000

#: One `SUPERSEDED_BY` chain per dimension per player, so ids must not collide
#: across dimensions. Six dimensions and a handful of eras each fits easily.
FACTS_PER_PLAYER = 100

CITATIONS_PER_FACT = 5

#: What a card asks about, and what the model gets to cite. `higher_is_better`
#: is carried here rather than in the interface because a band name has to be
#: chosen with it: "high" turnovers is not a compliment.
PLAYER_DIMENSIONS: dict[str, tuple[str, str, str]] = {
    "xt_created": ("quiet", "steady", "creative"),
    "xt_left": ("decisive", "mixed", "wasteful"),
    "final_third_entries": ("deep", "linking", "advanced"),
    "progressive_ratio": ("sideways", "mixed", "direct"),
    "defensive_actions": ("passive", "involved", "relentless"),
    "turnover_rate": ("secure", "mixed", "loose"),
}

#: A player needs this many appearances before a norm is a norm. Below it the
#: graph holds the observations and refuses the claim, which is the same
#: abstention the team side already does.
MIN_APPEARANCES = 4

#: Below this many minutes an appearance is a cameo and its per-90 rates are
#: violent extrapolations: one pass in four minutes is not "22 passes per 90".
MIN_MINUTES_FOR_OBSERVATION = 25


def series(team: str, match_ids: list[tuple[int, str]]) -> dict[str, dict]:
    """Every player's per-match rates across the given matches.

    Returns name -> {meta, observations: dimension -> [Observation]}. Matches
    are (statsbomb_id, iso_date) so the fact builder has real dates to put on
    the intervals.
    """
    xt_model = json.loads((RESULTS / "xt_model.json").read_text())
    out: dict[str, dict] = {}

    for mid, iso in match_ids:
        rows = measure_match(mid, team, xt_model)
        add_xt_left(rows, mid, team)
        for name, r in rows.items():
            if r["minutes"] < MIN_MINUTES_FOR_OBSERVATION:
                continue
            rate = rates_for(r)
            slot = out.setdefault(
                name,
                {
                    "player_id": r["player_id"],
                    "name": name,
                    "nickname": r["nickname"],
                    "jersey": r["jersey"],
                    "position": r["position"],
                    "country": r["country"],
                    "appearances": 0,
                    "minutes": 0.0,
                    "observations": defaultdict(list),
                },
            )
            slot["appearances"] += 1
            slot["minutes"] += r["minutes"]
            slot["jersey"] = r["jersey"] or slot["jersey"]
            slot["position"] = r["position"]
            for dim in PLAYER_DIMENSIONS:
                # StatsBomb 360 begins at Euro 2020, so a 2018 World Cup match
                # yields no better-ball reading. Recording a 0 would tell the
                # fact builder he wasted nothing that day, which is a
                # fabricated observation rather than an absent one, and it
                # would drag every norm down for the players with the longest
                # careers — exactly the ones worth having a norm for.
                if dim == "xt_left" and not r.get("has_options"):
                    continue
                slot["observations"][dim].append(
                    Observation(match_id=mid, date_ord=date_ord(iso), value=rate[dim])
                )

    return out


def edges_for(squad: dict[str, dict]) -> dict[str, tuple[float, float]]:
    """Band thresholds per dimension, pooled across the whole squad.

    A player is high or low against his teammates rather than against himself,
    which is the only reading that makes the band useful. Computed once over
    every player-match observation so a regular starter does not drag the
    thresholds toward his own average.
    """
    pooled: dict[str, list[float]] = defaultdict(list)
    for p in squad.values():
        for dim, obs in p["observations"].items():
            pooled[dim].extend(o.value for o in obs)
    return {dim: quantile_thresholds(values) for dim, values in pooled.items() if values}


def window_for(n: int) -> tuple[int, int]:
    """Smoothing window and run length, scaled to how many games there are.

    The team defaults are 15 and 8, tuned against a 531-match series. Applied
    to a footballer with 17 caps they erase the series: everything smooths to
    one band and every player gets a single fact that says nothing. Applied at
    the other extreme, a window of 3 turns one poor afternoon into an era.

    A third and a quarter of the series, floored at 3 apiece. The first
    version used a sixth for the run length, which put the floor at 2 for a
    sixteen-cap career and gave Messi four turnover eras, one of them two games
    long. Two games is a fortnight, not an era, and the team code already
    carries the same warning: that is churn dressed as memory.

    A player with eight appearances therefore gets one era unless three
    consecutive games say otherwise, which is the correct answer rather than a
    failure: eight games is not enough to claim something changed.
    """
    return max(3, min(15, n // 3)), max(3, min(8, n // 4))


def facts_for(squad: dict[str, dict]) -> dict[str, dict[str, list[Fact]]]:
    """Dated facts per player per dimension."""
    edges = edges_for(squad)
    out: dict[str, dict[str, list[Fact]]] = {}

    for name, p in squad.items():
        if p["appearances"] < MIN_APPEARANCES:
            continue
        window, min_run = window_for(p["appearances"])
        per_dim: dict[str, list[Fact]] = {}
        for dim, names in PLAYER_DIMENSIONS.items():
            obs = p["observations"].get(dim) or []
            if not obs or dim not in edges:
                continue
            built = build_facts(obs, dim, edges[dim], names, window=window, min_run=min_run)
            # Second pass, exactly as the team side does it: an era boundary can
            # be statistically real and tactically meaningless, so adjacent eras
            # whose medians sit within a third of the dimension's own spread get
            # collapsed. Without it a player picks up a one-game opening era
            # every time his first match sits near a band edge.
            built = merge_insignificant(built, spread=edges[dim][1] - edges[dim][0])
            if built:
                per_dim[dim] = built
        if per_dim:
            out[name] = per_dim

    return out


def ingest(team: str, key: str | None = None) -> dict:
    """Measure the squad across everything held, and write the facts."""
    g = Graph()
    try:
        rows = g.run(
            "MATCH (t:Team {name: $n})-[:PLAYED]->(m:Match) "
            "RETURN m.statsbomb_id AS id, m.date AS date ORDER BY m.date_ord",
            n=team,
        )
        matches = [(int(r["id"]), r["date"]) for r in rows]
        if not matches:
            raise SystemExit(f"{team} has no matches in the graph")

        squad = series(team, matches)
        facts = facts_for(squad)
        return g.ingest_players(team, team_id_for(team), squad, facts)
    finally:
        g.close()


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--workspace", default=None)
    ap.add_argument("--team", default=None)
    args = ap.parse_args()

    ws = workspace.load(args.workspace)
    team = args.team or ws.team

    print(f"measuring {team} across everything in the graph…")
    written = ingest(team, args.workspace)
    print(
        f"{written['players']} players · {written['facts']} facts · "
        f"{written['observations']} citations · {written['supersedes']} supersessions"
    )
    if written.get("dropped_eras"):
        print(f"warning: {written['dropped_eras']} eras past the per-dimension cap were not written")


if __name__ == "__main__":
    main()
