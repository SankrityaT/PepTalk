"""HTTP API over the HydraDB memory graph.

    uv run uvicorn tacticbench.api:app --reload --port 8000

Every endpoint is a thin wrapper over a Cypher query so the frontend shows real
graph reads rather than precomputed JSON. `/compare` is the demo: one team, one
dimension, two dates, two answers — plus the flat lookup a system without
validity intervals would return instead.
"""

from __future__ import annotations

import datetime as dt

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from .coach import DIMENSION_LABELS, MIN_EVIDENCE, advise, format_advice, recall
from .demo import team_id
from .graph import Graph
from .temporal import OPEN_ENDED

app = FastAPI(title="Tactical Memory API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TEAMS = [
    "Barcelona",
    "Paris Saint-Germain",
    "Villarreal",
    "Manchester City WFC",
    "Arsenal WFC",
    "Werder Bremen",
]


def _graph() -> Graph:
    return Graph()


def human(o: int) -> str:
    return "present" if o >= OPEN_ENDED else dt.date.fromordinal(o).isoformat()


def _to_ord(iso: str) -> int:
    try:
        return dt.date.fromisoformat(iso).toordinal()
    except ValueError as exc:
        raise HTTPException(400, f"bad date {iso!r}, expected YYYY-MM-DD") from exc


def _decorate(f: dict | None) -> dict | None:
    if not f:
        return None
    return {
        **f,
        "valid_from_iso": human(f["valid_from"]),
        "valid_to_iso": human(f["valid_to"]),
        "open_ended": f["valid_to"] >= OPEN_ENDED,
    }


@app.get("/api/teams")
def teams():
    """Teams with their evidence depth, so the picker can show what is thin."""
    g = _graph()
    try:
        out = []
        for name in TEAMS:
            tid = team_id(name)
            rows = g.run(
                "MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) "
                "RETURN sum(f.observations) AS obs, count(*) AS facts",
                tid=tid,
            )
            obs = int(rows[0]["obs"] or 0) if rows else 0
            facts = int(rows[0]["facts"] or 0) if rows else 0
            out.append(
                {
                    "team": name,
                    "team_id": tid,
                    "facts": facts,
                    "observations": obs,
                    "sufficient": obs >= MIN_EVIDENCE and facts > 0,
                }
            )
        return {"teams": out, "threshold": MIN_EVIDENCE}
    finally:
        g.close()


@app.get("/api/dimensions")
def dimensions():
    return {"dimensions": [{"key": k, "label": v} for k, v in DIMENSION_LABELS.items()]}


@app.get("/api/timeline/{team}")
def timeline(team: str, dimension: str = "possession_share_pct"):
    g = _graph()
    try:
        tid = team_id(team)
        rows = [_decorate(r) for r in g.timeline(tid, dimension)]
        return {"team": team, "dimension": dimension, "eras": rows}
    finally:
        g.close()


@app.get("/api/compare/{team}")
def compare(
    team: str,
    dimension: str = "possession_share_pct",
    at1: str = "2011-06-01",
    at2: str = "2018-06-01",
):
    """The demo: same question, two dates, plus the no-memory baseline."""
    g = _graph()
    try:
        tid = team_id(team)
        evidence = g.evidence(tid, dimension)
        if evidence < MIN_EVIDENCE:
            return {
                "team": team,
                "dimension": dimension,
                "abstained": True,
                "reason": (
                    f"Insufficient history: {evidence} observations, "
                    f"threshold is {MIN_EVIDENCE}."
                ),
            }

        def answer(at: str):
            f = _decorate(g.fact_at(tid, dimension, _to_ord(at)))
            if not f:
                return {"at": at, "fact": None, "note": "outside observed history"}
            return {"at": at, "fact": f, "cited_matches": g.cited_matches(f["id"], limit=4)}

        return {
            "team": team,
            "dimension": dimension,
            "abstained": False,
            "evidence": evidence,
            "with_memory": [answer(at1), answer(at2)],
            "without_memory": g.flat_lookup(tid, dimension),
        }
    finally:
        g.close()


@app.get("/api/chain/{fact_id}")
def chain(fact_id: int, max_hops: int = 10):
    g = _graph()
    try:
        return {"fact_id": fact_id, "supersedes": [_decorate(s) for s in g.supersede_chain(fact_id, max_hops)]}
    finally:
        g.close()


@app.get("/api/memory/{team}")
def memory(team: str, as_of: str = "2011-06-01"):
    g = _graph()
    try:
        mem = recall(g, team, team_id(team), as_of)
        return {
            "team": team,
            "as_of": as_of,
            "sufficient": mem.sufficient,
            "total_evidence": mem.total_evidence,
            "facts": mem.facts,
        }
    finally:
        g.close()


@app.post("/api/advise/{team}")
def advise_endpoint(team: str, state: dict, as_of: str = "2011-06-01", model: str = "opus"):
    g = _graph()
    try:
        a = advise(g, team, team_id(team), as_of, state, model=model)
        return {
            "abstained": a.abstained,
            "reason": a.reason,
            "payload": a.payload,
            "uncited_claims": a.uncited_claims,
            "text": format_advice(a),
            "evidence": a.memory.total_evidence if a.memory else 0,
        }
    finally:
        g.close()


MATCH_CARD_FIELDS = (
    "m.statsbomb_id AS statsbomb_id, m.label AS label, m.date AS date, "
    "m.competition AS competition, m.season AS season, m.stage AS stage, "
    "m.ht_home AS ht_home, m.ht_away AS ht_away, m.ft_home AS ft_home, "
    "m.ft_away AS ft_away, m.ht_deficit AS ht_deficit, m.recovered AS recovered, "
    "m.possession_share_pct AS possession, m.xg AS xg, m.shots AS shots"
)


@app.get("/api/competitions")
def competitions():
    g = _graph()
    try:
        rows = g.run(
            "MATCH (m:Match) WHERE m.competition <> '' "
            "RETURN m.competition AS competition, count(*) AS matches "
            "ORDER BY matches DESC LIMIT 40"
        )
        return {"competitions": [dict(r) for r in rows]}
    finally:
        g.close()


@app.get("/api/browse")
def browse(
    competition: str = "",
    deficit_min: int = 0,
    comeback_only: bool = False,
    limit: int = 24,
    offset: int = 0,
):
    """Match cards for the visual picker.

    Judges pick by clicking a real fixture, not by typing an id. Being able to
    scroll thousands of matches and choose any of them is what makes the demo
    obviously not staged.

    Filters are expressed in HydraDB's Cypher subset: property comparisons with
    AND/OR only — no IN, no CONTAINS — hence STARTS WITH for competition.
    """
    clauses = ["m.ht_deficit >= $deficit_min"]
    params: dict = {"deficit_min": deficit_min}
    if competition:
        clauses.append("m.competition STARTS WITH $competition")
        params["competition"] = competition
    if comeback_only:
        clauses.append("m.recovered = true")

    g = _graph()
    try:
        rows = g.run(
            f"MATCH (m:Match) WHERE {' AND '.join(clauses)} "
            f"RETURN {MATCH_CARD_FIELDS} "
            f"ORDER BY date DESC SKIP {max(0, offset)} LIMIT {min(limit, 100)}",
            **params,
        )
        return {
            "filters": {
                "competition": competition,
                "deficit_min": deficit_min,
                "comeback_only": comeback_only,
            },
            "matches": [dict(r) for r in rows],
        }
    finally:
        g.close()


@app.get("/api/search/teams")
def search_teams(q: str = "", limit: int = 25):
    """Free-text team search over everything in the graph.

    Exists so a judge can look for a team we never mentioned. A demo that only
    works on a hand-picked list reads as staged even when it is not.
    """
    g = _graph()
    try:
        rows = g.run(
            "MATCH (t:Team)-[:HAS_FACT]->(f:Fact) "
            "RETURN t.id AS id, t.name AS name, count(*) AS facts "
            f"ORDER BY facts DESC LIMIT {min(limit * 6, 400)}"
        )
        needle = q.lower().strip()
        out = [dict(r) for r in rows if not needle or needle in (r["name"] or "").lower()]
        return {"query": q, "teams": out[:limit]}
    finally:
        g.close()


@app.get("/api/matches/{team}")
def team_matches(team: str, limit: int = 40):
    g = _graph()
    try:
        rows = g.run(
            "MATCH (t:Team {id: $tid})-[:PLAYED]->(m:Match) "
            "RETURN m.statsbomb_id AS statsbomb_id, m.label AS label, m.date AS date, "
            "m.competition AS competition, m.possession_share_pct AS possession, "
            "m.xg AS xg, m.shots AS shots "
            f"ORDER BY date DESC LIMIT {limit}",
            tid=team_id(team),
        )
        return {"team": team, "matches": [dict(r) for r in rows]}
    finally:
        g.close()


@app.get("/api/deviation/{team}/{statsbomb_id}")
def deviation(team: str, statsbomb_id: int):
    """One match against the norm that was valid on its date."""
    g = _graph()
    try:
        d = g.deviation(team_id(team), statsbomb_id)
        if not d:
            raise HTTPException(404, f"match {statsbomb_id} not in graph")
        d["highlights"] = g.highlights(statsbomb_id)
        return d
    finally:
        g.close()


@app.post("/api/ingest/match/{statsbomb_id}")
def ingest_match_live(statsbomb_id: int):
    """Fetch, derive and write one match to the graph, right now.

    This is the anti-hardcoding endpoint. Every step is timed and reported so
    the UI can show the data arriving from StatsBomb, being turned into state,
    and landing in HydraDB — for any match id, including ones we never chose.
    """
    import time

    import httpx as _httpx

    from . import data as _data
    from .graph import MATCH_ID_BASE
    from .state import _team_metrics

    steps = []

    def step(name: str, t0: float, **extra):
        steps.append({"step": name, "ms": round((time.perf_counter() - t0) * 1000), **extra})

    g = _graph()
    try:
        t = time.perf_counter()
        with _httpx.Client(timeout=90.0) as client:
            matches = {m["match_id"]: m for m in _data.all_matches(client)}
            meta = matches.get(statsbomb_id)
            if not meta:
                raise HTTPException(404, f"match {statsbomb_id} not in StatsBomb open data")
            step("resolve match", t, label=None)

            t = time.perf_counter()
            events = _data.events(client, statsbomb_id)
            step("fetch events from StatsBomb", t, events=len(events))

        home = meta["home_team"]["home_team_name"]
        away = meta["away_team"]["away_team_name"]
        label = f"{home} {meta['home_score']}-{meta['away_score']} {away}"

        t = time.perf_counter()
        derived = {
            side: _team_metrics(events, name, len(events))
            for side, name in (("home", home), ("away", away))
        }
        step("derive tactical state", t, teams=[home, away])

        t = time.perf_counter()
        written = 0
        for side, name in (("home", home), ("away", away)):
            met = derived[side]
            g.run(
                "CREATE (tm:Team {id: $tid, name: $name})-[:PLAYED]->"
                "(m:Match {id: $mid, statsbomb_id: $sbid, date: $date, date_ord: $dord, "
                "competition: $comp, label: $label, possession_share_pct: $poss, "
                "press_height: $press, defensive_action_height: $dah, team_width: $width, "
                "pass_forward_ratio: $pfr, shots: $shots, xg: $xg, source: 'event_data'})",
                tid=team_id(name), name=name, mid=MATCH_ID_BASE + statsbomb_id,
                sbid=statsbomb_id, date=meta["match_date"][:10],
                dord=_to_ord(meta["match_date"][:10]), comp=meta["competition"]["competition_name"],
                label=label,
                poss=float(met.get("possession_share_pct") or 0.0),
                press=float(met.get("press_height") or 0.0),
                dah=float(met.get("defensive_action_height") or 0.0),
                width=float(met.get("team_width") or 0.0),
                pfr=float(met.get("pass_forward_ratio") or 0.0),
                shots=int(met.get("shots") or 0), xg=float(met.get("xg") or 0.0),
            )
            written += 1
        step("write to HydraDB", t, nodes=written)

        t = time.perf_counter()
        verify = g.match(statsbomb_id)
        step("read back from HydraDB", t, found=bool(verify))

        return {
            "match": label,
            "statsbomb_id": statsbomb_id,
            "date": meta["match_date"][:10],
            "steps": steps,
            "total_ms": sum(s["ms"] for s in steps),
            "stored": verify,
        }
    finally:
        g.close()


@app.get("/api/scenario/{statsbomb_id}")
def scenario_endpoint(statsbomb_id: int):
    """A coherent halftime situation: match, trailing side, opponent, state."""
    from . import scenario as _scenario

    try:
        s = _scenario.build(statsbomb_id)
    except _scenario.NoDeficit as exc:
        raise HTTPException(422, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc

    g = _graph()
    try:
        mem = recall(g, s.opponent, s.opponent_id, s.date)
        return {
            "match_id": s.match_id,
            "label": s.label,
            "date": s.date,
            "competition": s.competition,
            "halftime": f"{s.ht_home}-{s.ht_away}",
            "fulltime": f"{s.ft_home}-{s.ft_away}",
            "deficit": s.deficit,
            "trailing_team": s.trailing_team,
            "opponent": s.opponent,
            "recovered": s.recovered,
            "summary": s.summary(),
            "state": s.state,
            "opponent_memory": {
                "sufficient": mem.sufficient,
                "total_evidence": mem.total_evidence,
                "facts": mem.facts,
            },
            "highlights": g.highlights(statsbomb_id),
        }
    finally:
        g.close()


@app.post("/api/scenario/{statsbomb_id}/advise")
def scenario_advise(statsbomb_id: int, model: str = "opus"):
    """Advise the trailing side, using the opponent's memory at that date.

    The scenario binds match, trailing team, opponent and date together so the
    state and the memory cannot come from different games — a mistake that is
    easy to make and produces fluent, cited nonsense.
    """
    from . import scenario as _scenario

    try:
        s = _scenario.build(statsbomb_id)
    except _scenario.NoDeficit as exc:
        raise HTTPException(422, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc

    g = _graph()
    try:
        a = advise(g, s.opponent, s.opponent_id, s.date, s.state, model=model)
        return {
            "scenario": s.summary(),
            "match_id": s.match_id,
            "trailing_team": s.trailing_team,
            "opponent": s.opponent,
            "actually_recovered": s.recovered,
            "abstained": a.abstained,
            "reason": a.reason,
            "payload": a.payload,
            "uncited_claims": a.uncited_claims,
            "text": format_advice(a),
        }
    finally:
        g.close()


@app.get("/api/health")
def health():
    g = _graph()
    try:
        n = g.run("MATCH (f:Fact) RETURN count(*) AS n")[0]["n"]
        return {"ok": True, "facts": n}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(503, f"graph unavailable: {exc}") from exc
    finally:
        g.close()
