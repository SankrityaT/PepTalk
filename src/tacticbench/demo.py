"""Ingest a team's timeline into HydraDB and run the demo queries.

    uv run python -m tacticbench.demo ingest "Barcelona"
    uv run python -m tacticbench.demo query  "Barcelona" --dimension press_height

The `query` output is the landing page in miniature: the same question asked at
two dates returning two different answers, the overwrite chain that connects
them, the evidence behind each claim, and the flat lookup that a system without
a temporal graph would return instead.
"""

from __future__ import annotations

import argparse
import datetime as dt
import zlib

from .graph import Graph, facts_for_team, load_series
from .temporal import OPEN_ENDED

# Explicit ids for the demo teams; everything else is derived deterministically.
TEAM_IDS = {"Barcelona": 1, "Werder Bremen": 2}


def team_id(team: str) -> int:
    """Stable across processes.

    Python's built-in `hash()` is salted per interpreter (PYTHONHASHSEED), so
    using it here would give a team a different id on ingest than on query, and
    the graph lookups would silently return nothing.
    """
    if team in TEAM_IDS:
        return TEAM_IDS[team]
    return zlib.crc32(team.encode()) % 90_000 + 100


def ord_of(iso: str) -> int:
    return dt.date.fromisoformat(iso).toordinal()


def human(o: int) -> str:
    if o >= OPEN_ENDED:
        return "present"
    return dt.date.fromordinal(o).isoformat()


def cmd_ingest(args) -> None:
    team = args.team
    tid = team_id(team)

    series = load_series(team)
    print(f"{team}: {len(series)} matches, {series[0].date} -> {series[-1].date}")

    facts = facts_for_team(series)
    for dim, flist in facts.items():
        print(f"  {dim:<28} {len(flist)} eras")

    g = Graph()
    try:
        stats = g.ingest_team(team, tid, series, facts)
        print(f"\ningested: {stats}")
    finally:
        g.close()


def cmd_query(args) -> None:
    team = args.team
    tid = team_id(team)
    dim = args.dimension

    g = Graph()
    try:
        evidence = g.evidence(tid, dim)
        print(f"=== {team} / {dim} ===")
        print(f"evidence: {evidence} observations")
        if evidence < args.threshold:
            print(f"\nABSTAIN: below threshold of {args.threshold}. Not enough history.")
            return

        print("\n--- timeline (each era, as HydraDB stores it) ---")
        tl = g.timeline(tid, dim)
        for f in tl:
            print(
                f"  {human(f['valid_from'])} -> {human(f['valid_to']):<10} "
                f"{f['band']:<10} ({f['observations']} matches)  id={f['id']}"
            )

        print("\n--- point-in-time: same question, two dates ---")
        for at in args.at:
            f = g.fact_at(tid, dim, ord_of(at))
            if f:
                print(
                    f"  {at}: {f['band']}  (valid {human(f['valid_from'])} -> "
                    f"{human(f['valid_to'])}, {f['observations']} matches, "
                    f"median {f['median_value']})"
                )
                for m in g.cited_matches(f["id"], limit=3):
                    print(f"       cited: {m['label']}  [{m['competition']}]")
            else:
                print(f"  {at}: no fact — outside observed history")

        if tl:
            print("\n--- SUPERSEDED_BY chain from the earliest era ---")
            for step in g.supersede_chain(tl[0]["id"]):
                print(
                    f"  -> {step['band']:<10} from {human(step['valid_from'])} "
                    f"to {human(step['valid_to'])}"
                )

        print("\n--- WITHOUT HydraDB (flat lookup, no validity intervals) ---")
        flat = g.flat_lookup(tid, dim)
        if flat:
            print(
                f"  '{flat['band']}' — {flat['observations']} matches, "
                "presented with no sense that it ever stopped being true"
            )
    finally:
        g.close()


def main() -> None:
    p = argparse.ArgumentParser(prog="tacticbench.demo")
    sub = p.add_subparsers(dest="cmd", required=True)

    i = sub.add_parser("ingest")
    i.add_argument("team")
    i.set_defaults(func=cmd_ingest)

    q = sub.add_parser("query")
    q.add_argument("team")
    q.add_argument("--dimension", default="press_height")
    q.add_argument("--at", nargs="+", default=["2011-03-01", "2021-03-01"])
    q.add_argument("--threshold", type=int, default=6)
    q.set_defaults(func=cmd_query)

    args = p.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
