"""Build match state for every team in the dataset, in one pass.

    uv run python -u -m tacticbench.ingest_all series   # compute + cache series
    uv run python -u -m tacticbench.ingest_all graph    # write them into HydraDB

Deliberately one pass over matches rather than one pass per team: each events
file yields metrics for *both* sides, so 3,961 reads cover what would otherwise
be ~8,000. The result is that any match a judge picks is already in the graph,
which is the point — a demo limited to a handful of hand-chosen fixtures reads
as staged, however real it actually is.
"""

from __future__ import annotations

import json
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import httpx

from . import data
from .demo import team_id
from .graph import Graph, MatchMetrics, facts_for_team
from .state import _team_metrics

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"
ALL_SERIES = RESULTS / "all_series.json"

MIN_MATCHES_FOR_MEMORY = 6


def _one_match(client: httpx.Client, m: dict) -> list[tuple[str, dict]] | None:
    try:
        ev = data.events(client, m["match_id"])
    except Exception:
        return None

    home = m["home_team"]["home_team_name"]
    away = m["away_team"]["away_team_name"]
    label = f"{home} {m['home_score']}-{m['away_score']} {away}"
    common = {
        "match_id": m["match_id"],
        "date": m["match_date"][:10],
        "competition": m["competition"]["competition_name"],
        "label": label,
    }
    total = len(ev)
    return [
        (home, {**common, "metrics": _team_metrics(ev, home, total)}),
        (away, {**common, "metrics": _team_metrics(ev, away, total)}),
    ]


def build_series(workers: int = 12) -> dict[str, list[dict]]:
    series: dict[str, list[dict]] = {}
    lock = threading.Lock()

    with httpx.Client(timeout=90.0) as client:
        matches = data.all_matches(client)
        print(f"computing state for {len(matches)} matches with {workers} workers...")

        done = failed = 0
        with ThreadPoolExecutor(max_workers=workers) as pool:
            futures = {pool.submit(_one_match, client, m): m for m in matches}
            for fut in as_completed(futures):
                rows = fut.result()
                done += 1
                if not rows:
                    failed += 1
                else:
                    with lock:
                        for team, row in rows:
                            series.setdefault(team, []).append(row)
                if done % 250 == 0:
                    print(f"  {done}/{len(matches)} ({failed} failed)", flush=True)

    for team in series:
        series[team].sort(key=lambda r: r["date"])

    RESULTS.mkdir(exist_ok=True)
    ALL_SERIES.write_text(json.dumps(series))
    print(f"\n{len(series)} teams -> {ALL_SERIES}  ({failed} matches failed)")
    return series


def load_all() -> dict[str, list[dict]]:
    return json.loads(ALL_SERIES.read_text())


def ingest_all(min_matches: int = 1) -> dict:
    """Write every team into the graph.

    Teams below the memory floor still get their Match nodes and a Team node —
    they simply have no Facts, so the system abstains on them. That is the
    honest state to be in, and it is worth storing rather than leaving a hole.
    """
    series = load_all()
    g = Graph()
    stats = {"teams": 0, "matches": 0, "facts": 0, "supersedes": 0, "abstaining": 0}
    try:
        for i, (team, rows) in enumerate(sorted(series.items()), 1):
            if len(rows) < min_matches:
                continue
            mm = [MatchMetrics(**r) for r in rows]
            facts = facts_for_team(mm) if len(mm) >= MIN_MATCHES_FOR_MEMORY else {}
            out = g.ingest_team(team, team_id(team), mm, facts)

            stats["teams"] += 1
            stats["matches"] += out["matches"]
            stats["facts"] += out["facts"]
            stats["supersedes"] += out["supersedes"]
            if not facts:
                stats["abstaining"] += 1

            if i % 25 == 0:
                print(f"  {i}/{len(series)} teams  {stats}", flush=True)
    finally:
        g.close()
    print(f"\nDONE {stats}")
    return stats


def enrich_scores() -> dict:
    """Attach scorelines and halftime-deficit flags to Match nodes.

    Kept as a second pass because the scan already computed halftime scores the
    hard way (from period-1 goal events) and there is no reason to redo it. With
    these properties present the browse endpoint is a plain Cypher query rather
    than a join against a JSON file in Python — the graph answers for itself.
    """
    from .graph import MATCH_ID_BASE

    scan = json.loads((RESULTS / "ht_deficits.json").read_text())
    deficits = {r["match_id"]: r for r in scan["matches"]}

    g = Graph()
    updated = flagged = 0
    try:
        with httpx.Client(timeout=90.0) as client:
            matches = data.all_matches(client)

        for i, m in enumerate(matches, 1):
            mid = m["match_id"]
            d = deficits.get(mid)
            ht_h, ht_a = (d["ht"] if d else (0, 0))
            g.run(
                "MATCH (mt:Match) WHERE mt.id = $mid "
                "SET mt.ft_home = $fh, mt.ft_away = $fa, mt.ht_home = $hh, "
                "mt.ht_away = $ha, mt.ht_deficit = $deficit, mt.recovered = $rec, "
                "mt.stage = $stage, mt.season = $season",
                mid=MATCH_ID_BASE + mid,
                fh=int(m["home_score"]), fa=int(m["away_score"]),
                hh=int(ht_h), ha=int(ht_a),
                deficit=int(d["ht_deficit"]) if d else 0,
                rec=bool(d["recovered"]) if d else False,
                stage=(m.get("competition_stage") or {}).get("name") or "",
                season=m["season"]["season_name"],
            )
            updated += 1
            if d:
                flagged += 1
            if i % 500 == 0:
                print(f"  enriched {i}/{len(matches)}", flush=True)
    finally:
        g.close()
    out = {"updated": updated, "with_deficit": flagged}
    print(f"\nENRICHED {out}")
    return out


if __name__ == "__main__":
    import sys

    cmd = sys.argv[1] if len(sys.argv) > 1 else "series"
    if cmd == "series":
        build_series()
    elif cmd == "graph":
        ingest_all()
    elif cmd == "enrich":
        enrich_scores()
    else:
        raise SystemExit("usage: ingest_all [series|graph|enrich]")
