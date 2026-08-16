"""End-to-end system check.

    uv run python -m tacticbench.verify

Written to be re-runnable and to fail loudly. Every claim the project makes in
its README or on its landing page should be reproducible by running this: if a
number here disagrees with a number there, the number there is wrong.

Checks the graph is populated and internally consistent, the derived facts still
say what we claim they say, and the API answers. Exits non-zero on any failure.
"""

from __future__ import annotations

import datetime as dt
import sys

import httpx

from .demo import team_id
from .graph import Graph
from .temporal import OPEN_ENDED

API = "http://127.0.0.1:8000"

PASS, FAIL, WARN = "PASS", "FAIL", "WARN"
results: list[tuple[str, str, str]] = []


def check(name: str, ok: bool, detail: str = "", warn_only: bool = False) -> bool:
    status = PASS if ok else (WARN if warn_only else FAIL)
    results.append((status, name, detail))
    return ok


def human(o: int) -> str:
    return "present" if o >= OPEN_ENDED else dt.date.fromordinal(o).isoformat()


def check_graph(g: Graph) -> None:
    counts = {}
    for label in ("Team", "Fact", "Match", "Highlight"):
        counts[label] = g.run(f"MATCH (n:{label}) RETURN count(*) AS n")[0]["n"]

    check("graph: teams present", counts["Team"] > 300, f"{counts['Team']} teams")
    check("graph: facts present", counts["Fact"] > 1000, f"{counts['Fact']} facts")
    check(
        "graph: full dataset ingested",
        counts["Match"] >= 3961,
        f"{counts['Match']} match nodes (expect >=3961)",
    )

    ev = g.run("MATCH (m:Match) WHERE m.source = 'event_data' RETURN count(*) AS n")[0]["n"]
    cv = g.run("MATCH (m:Match) WHERE m.source = 'cv' RETURN count(*) AS n")[0]["n"]
    check("graph: event-derived matches", ev >= 3961, f"{ev} from event data")
    check("graph: video-derived matches", cv > 0, f"{cv} from video", warn_only=True)

    sup = g.run("MATCH (a:Fact)-[r:SUPERSEDED_BY]->(b:Fact) RETURN count(*) AS n")[0]["n"]
    check("graph: supersede chain exists", sup > 100, f"{sup} SUPERSEDED_BY edges")

    check(
        "graph: highlights attached",
        counts["Highlight"] > 0,
        f"{counts['Highlight']} highlights",
        warn_only=True,
    )


def check_temporal_integrity(g: Graph) -> None:
    """Every team's eras must tile time without gaps or overlaps."""
    bad_overlap = bad_gap = checked = 0
    teams = g.run(
        "MATCH (t:Team)-[:HAS_FACT]->(f:Fact) RETURN t.id AS id, count(*) AS n "
        "ORDER BY n DESC LIMIT 40"
    )
    for row in teams:
        for dim in ("possession_share_pct", "press_height", "team_width"):
            tl = g.timeline(row["id"], dim)
            if len(tl) < 2:
                continue
            checked += 1
            for a, b in zip(tl, tl[1:]):
                if a["valid_to"] > b["valid_from"]:
                    bad_overlap += 1
                elif a["valid_to"] < b["valid_from"]:
                    bad_gap += 1

    check("temporal: no overlapping eras", bad_overlap == 0, f"{bad_overlap} overlaps in {checked} timelines")
    check("temporal: no gaps between eras", bad_gap == 0, f"{bad_gap} gaps in {checked} timelines")

    open_ended = g.run(
        f"MATCH (f:Fact) WHERE f.valid_to = {OPEN_ENDED} RETURN count(*) AS n"
    )[0]["n"]
    check("temporal: open-ended facts use sentinel", open_ended > 0, f"{open_ended} current facts")


def check_known_results(g: Graph) -> None:
    """The specific claims the project makes publicly."""
    tid = team_id("Barcelona")

    peak = g.fact_at(tid, "possession_share_pct", dt.date(2011, 6, 1).toordinal())
    check(
        "claim: Barcelona 2011 is the dominant possession era",
        bool(peak) and peak["band"] == "dominant" and peak["median_value"] > 66,
        f"{peak['band']} {peak['median_value']}% ({human(peak['valid_from'])} -> {human(peak['valid_to'])})"
        if peak else "no fact",
    )

    later = g.fact_at(tid, "possession_share_pct", dt.date(2018, 6, 1).toordinal())
    check(
        "claim: 2018 returns a different, lower era",
        bool(later) and later["band"] != (peak or {}).get("band"),
        f"{later['band']} {later['median_value']}%" if later else "no fact",
    )

    flat = g.flat_lookup(tid, "possession_share_pct")
    check(
        "claim: without-memory lookup erases the peak",
        bool(flat) and flat["band"] != "dominant",
        f"flat lookup says '{flat['band']}' from {flat['observations']} matches" if flat else "none",
    )

    press = g.timeline(tid, "press_height")
    check(
        "claim: Barcelona press height is NOT the story",
        len(press) <= 3,
        f"{len(press)} press eras (the landing page must not claim a big shift here)",
    )


def check_abstention(g: Graph) -> None:
    thin = team_id("Werder Bremen")
    evidence = g.evidence(thin, "possession_share_pct")
    check(
        "abstention: thin team stays below threshold",
        evidence < 6,
        f"Werder Bremen evidence={evidence}",
    )
    rich = g.evidence(team_id("Barcelona"), "possession_share_pct")
    check("abstention: rich team clears threshold", rich >= 6, f"Barcelona evidence={rich}")


def check_api() -> None:
    try:
        r = httpx.get(f"{API}/api/health", timeout=10)
        check("api: health", r.status_code == 200, r.text.strip()[:60])
    except Exception as exc:  # noqa: BLE001
        check("api: health", False, f"unreachable: {exc}")
        return

    try:
        c = httpx.get(
            f"{API}/api/compare/Barcelona",
            params={"dimension": "possession_share_pct", "at1": "2011-06-01", "at2": "2018-06-01"},
            timeout=20,
        ).json()
        bands = [a["fact"]["band"] for a in c.get("with_memory", []) if a.get("fact")]
        check("api: compare returns two different eras", len(set(bands)) == 2, f"bands={bands}")
        check("api: without-memory baseline present", bool(c.get("without_memory")), "")
    except Exception as exc:  # noqa: BLE001
        check("api: compare", False, str(exc)[:80])

    try:
        b = httpx.get(f"{API}/api/browse", params={"deficit_min": 2, "limit": 5}, timeout=20).json()
        check("api: browse returns matches", len(b.get("matches", [])) > 0, f"{len(b.get('matches', []))} cards")
    except Exception as exc:  # noqa: BLE001
        check("api: browse", False, str(exc)[:80])

    try:
        a = httpx.get(f"{API}/api/compare/Werder%20Bremen", timeout=20).json()
        check("api: abstains on thin team", a.get("abstained") is True, a.get("reason", "")[:60])
    except Exception as exc:  # noqa: BLE001
        check("api: abstention", False, str(exc)[:80])


def check_conversation(g: Graph) -> None:
    """A turn must round-trip with its citations intact.

    The claim the interface makes is that a source chip resolves to a real
    dated fact. This is the check that keeps that true: write a turn citing
    facts pulled out of the graph, read it back, and confirm the citations
    still point at nodes that exist and carry their dimension.
    """
    from .demo import team_id
    from .graph import date_ord

    from . import workspace

    tid = team_id(workspace.load().team)
    facts = [
        dict(r)
        for r in g.run(
            "MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) "
            "RETURN f.id AS id LIMIT 2",
            tid=tid,
        )
    ]
    if len(facts) < 2:
        check("conversation: fixture facts available", False, "need 2 facts")
        return

    cites = tuple(f["id"] for f in facts)
    # A fixed id range so repeated runs overwrite rather than accumulate.
    sid, base = 99_001, 99_001_00
    ordinal = date_ord("2026-08-15")

    g.start_session(tid, sid, ordinal)
    g.add_turn(sid, base, 0, "coach", "Are we still pressing high?", ordinal)
    g.add_turn(sid, base + 1, 1, "pep", "No — 5.5m lower than your norm.",
               ordinal, cites=cites, prev_turn_id=base)

    turns = g.session_turns(sid)
    check(
        "conversation: turns round-trip in order",
        len(turns) >= 2 and [t["seq"] for t in turns[:2]] == [0, 1],
        f"{len(turns)} turns, seq ordered",
    )

    cited = g.turn_citations(base + 1)
    check(
        "conversation: citations resolve to real facts",
        len(cited) == len(cites) and all(c.get("dimension") for c in cited),
        f"{len(cited)} facts, e.g. {cited[0]['dimension'] if cited else '—'}",
    )

    recalled = g.recall(tid, limit=5)
    check(
        "conversation: recall returns prior turns",
        len(recalled) >= 2,
        f"{len(recalled)} turns back",
    )


def main() -> int:
    g = Graph()
    try:
        check_graph(g)
        check_temporal_integrity(g)
        check_known_results(g)
        check_abstention(g)
        check_conversation(g)
    finally:
        g.close()
    check_api()

    width = max(len(n) for _, n, _ in results)
    for status, name, detail in results:
        print(f"  [{status:<4}] {name:<{width}}  {detail}")

    failed = [r for r in results if r[0] == FAIL]
    warned = [r for r in results if r[0] == WARN]
    print(f"\n{len(results) - len(failed) - len(warned)} passed, {len(warned)} warnings, {len(failed)} failed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
