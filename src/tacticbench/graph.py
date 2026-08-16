"""HydraDB memory graph — ingest and retrieval.

Schema
------
    (:Team  {id, name})
    (:Match {id, date_ord, competition, label})
    (:Fact  {id, team_id, dimension, band, valid_from, valid_to,
             observations, median_value})

    (Team)-[:HAS_FACT]->(Fact)
    (Fact)-[:OBSERVED_IN]->(Match)
    (Fact)-[:SUPERSEDED_BY]->(Fact)

`SUPERSEDED_BY` is the point of the whole thing: a traversable chain of
overwrites. A vector index cannot represent "this claim replaced that one on
this date", which is exactly the query a coach needs.

HydraDB Cypher constraints discovered by probing a live node (v0.1.0), all of
which shape the code below:

* `CREATE` accepts **relationship paths only** — a standalone node cannot be
  created. Every node here is born as one end of an edge.
* `UNWIND` batches **cannot carry labels**, so writes are one statement per row.
  At our volume (hundreds of statements) that is a few seconds.
* `IS NULL` is rejected, so an open interval uses the `OPEN_ENDED` sentinel and
  every temporal predicate is `<=` / `>`.
* One statement per request; no multi-stage `WITH` pipelines.
"""

from __future__ import annotations

import datetime as dt
import json
from dataclasses import dataclass
from pathlib import Path

import httpx
import neo4j
from neo4j import GraphDatabase

from . import data
from .state import _team_metrics
from .temporal import (
    DIMENSIONS,
    OPEN_ENDED,
    Fact,
    Observation,
    build_facts,
    merge_insignificant,
    quantile_thresholds,
)

ROOT = Path(__file__).resolve().parents[2]
RESULTS = ROOT / "results"

BOLT_URI = "bolt://127.0.0.1:7687"
TOKEN = "local-development-token-32-bytes"

MATCH_ID_BASE = 10_000_000
FACT_ID_BASE = 100_000_000

# Evidence edges kept per fact. See ingest_team for why this is capped.
CITATIONS_PER_FACT = 12

# Video-derived matches live in their own id range: SoccerNet games are not
# StatsBomb games, so sharing the space would collide unrelated fixtures.
CV_MATCH_ID_BASE = 20_000_000


def team_id_for(name: str) -> int:
    """Deterministic team id, matching demo.team_id (crc32, not salted hash)."""
    import zlib

    from .demo import TEAM_IDS

    if name in TEAM_IDS:
        return TEAM_IDS[name]
    return zlib.crc32(name.encode()) % 90_000 + 100


def date_ord(iso: str) -> int:
    return dt.date.fromisoformat(iso[:10]).toordinal()


@dataclass
class MatchMetrics:
    match_id: int
    date: str
    competition: str
    label: str
    metrics: dict


def team_series(team: str, limit: int | None = None) -> list[MatchMetrics]:
    """Per-match full-match metrics for one team, chronological.

    Full match rather than first half: this describes a team's standing
    identity, not one halftime situation.
    """
    out: list[MatchMetrics] = []
    with httpx.Client(timeout=60.0) as client:
        rows = [
            m
            for m in data.all_matches(client)
            if team in (m["home_team"]["home_team_name"], m["away_team"]["away_team_name"])
        ]
        rows.sort(key=lambda m: m["match_date"])
        if limit:
            rows = rows[:limit]

        for i, m in enumerate(rows, 1):
            try:
                ev = data.events(client, m["match_id"])
            except Exception:
                continue
            home = m["home_team"]["home_team_name"]
            away = m["away_team"]["away_team_name"]
            out.append(
                MatchMetrics(
                    match_id=m["match_id"],
                    date=m["match_date"][:10],
                    competition=m["competition"]["competition_name"],
                    label=f"{home} {m['home_score']}-{m['away_score']} {away}",
                    metrics=_team_metrics(ev, team, len(ev)),
                )
            )
            if i % 50 == 0:
                print(f"  {i}/{len(rows)} matches")
    return out


def facts_for_team(series: list[MatchMetrics]) -> dict[str, list[Fact]]:
    """Derive dated facts per dimension from a team's match series."""
    out: dict[str, list[Fact]] = {}
    for dim, names in DIMENSIONS.items():
        obs = [
            Observation(m.match_id, date_ord(m.date), float(m.metrics[dim]))
            for m in series
            if m.metrics.get(dim) is not None
        ]
        if len(obs) < 6:
            continue
        values = [o.value for o in obs]
        edges = quantile_thresholds(values)
        facts = build_facts(obs, dim, edges, names)
        # Second pass: drop era boundaries that are statistically real but
        # tactically meaningless, scaled to each metric's own spread.
        out[dim] = merge_insignificant(facts, spread=edges[1] - edges[0])
    return out


class Graph:
    def __init__(self, uri: str = BOLT_URI, token: str = TOKEN):
        self.driver = GraphDatabase.driver(uri, auth=neo4j.bearer_auth(token))

    def close(self) -> None:
        self.driver.close()

    def run(self, query: str, **params):
        with self.driver.session() as s:
            return list(s.run(query, **params))

    # ---------------- ingest ----------------

    def ingest_matches(self, team: str, team_id: int, series: list[MatchMetrics]) -> int:
        """Every match as a first-class node carrying its own state.

        Two levels matter. A Fact says what was *normal* for a team over a
        period; a Match says what actually happened in one game. The gap between
        them is the insight a coach wants — "they usually sit deep, today they
        pushed up" — and that is only expressible if both are stored.

        Metrics are flattened onto the node because HydraDB properties are
        scalars, and this is also where CV-derived state will land once it
        exists: same node, same properties, different producer.
        """
        for m in series:
            met = m.metrics
            # Per-team metrics live on the PLAYED edge, not on the Match node.
            #
            # A match is one node but two teams point at it, and `CREATE`
            # upserts by id while preserving the first write. Writing metrics
            # onto the node therefore stored whichever team was ingested first
            # and served those numbers to both — which showed up as Argentina
            # and France each reporting 46.2% possession in the same match, a
            # figure that must sum to 100 across the two.
            #
            # Node properties stay for what genuinely belongs to the fixture:
            # date, competition, scoreline.
            self.run(
                "CREATE (t:Team {id: $tid, name: $name})-[:PLAYED "
                "{possession_share_pct: $poss, press_height: $press, "
                "defensive_action_height: $dah, team_width: $width, "
                "pass_forward_ratio: $pfr, shots: $shots, xg: $xg}]->"
                "(mt:Match {id: $mid, statsbomb_id: $sbid, date_ord: $dord, "
                "date: $date, competition: $comp, label: $label, "
                "possession_share_pct: $poss, press_height: $press, "
                "defensive_action_height: $dah, team_width: $width, "
                "pass_forward_ratio: $pfr, shots: $shots, xg: $xg, source: 'event_data'})",
                tid=team_id, name=team, mid=MATCH_ID_BASE + m.match_id,
                sbid=m.match_id, dord=date_ord(m.date), date=m.date,
                comp=m.competition, label=m.label,
                poss=float(met.get("possession_share_pct") or 0.0),
                press=float(met.get("press_height") or 0.0),
                dah=float(met.get("defensive_action_height") or 0.0),
                width=float(met.get("team_width") or 0.0),
                pfr=float(met.get("pass_forward_ratio") or 0.0),
                shots=int(met.get("shots") or 0),
                xg=float(met.get("xg") or 0.0),
            )
        return len(series)

    def ingest_team(
        self, team: str, team_id: int, series: list[MatchMetrics], facts: dict[str, list[Fact]]
    ) -> dict:
        matches = self.ingest_matches(team, team_id, series)

        fact_id = FACT_ID_BASE + team_id * 10_000
        written_facts = written_obs = written_links = 0

        for dim, flist in facts.items():
            previous_id: int | None = None
            for f in flist:
                fid = fact_id
                fact_id += 1

                # Node creation must ride on an edge; HAS_FACT births both ends.
                self.run(
                    "CREATE (t:Team {id: $tid, name: $name})-[:HAS_FACT]->"
                    "(f:Fact {id: $fid, team_id: $tid, dimension: $dim, band: $band, "
                    "valid_from: $vf, valid_to: $vt, observations: $obs, median_value: $med})",
                    tid=team_id, name=team, fid=fid, dim=dim, band=f.band,
                    vf=f.valid_from, vt=f.valid_to, obs=f.observations,
                    med=f.median_value if f.median_value is not None else 0.0,
                )
                written_facts += 1

                # Match nodes already exist with full state; CREATE upserts by
                # id, so referencing them here links without clobbering.
                #
                # Capped deliberately. Linking every match in an era is honest
                # but writes ~50k edges across the dataset one statement at a
                # time (HydraDB's UNWIND cannot carry labels), which turns a
                # full ingest into an hour. The UI only ever surfaces a handful
                # of citations per claim, and `observations` on the Fact still
                # records the true count, so nothing is misreported.
                for mid in f.match_ids[:CITATIONS_PER_FACT]:
                    self.run(
                        "CREATE (f:Fact {id: $fid})-[:OBSERVED_IN]->(m:Match {id: $mid})",
                        fid=fid, mid=MATCH_ID_BASE + mid,
                    )
                    written_obs += 1

                if previous_id is not None:
                    self.run(
                        "CREATE (a:Fact {id: $prev})-[:SUPERSEDED_BY]->(b:Fact {id: $cur})",
                        prev=previous_id, cur=fid,
                    )
                    written_links += 1
                previous_id = fid

        return {
            "matches": matches,
            "facts": written_facts,
            "observations": written_obs,
            "supersedes": written_links,
        }

    # ---------------- retrieval ----------------

    def fact_at(self, team_id: int, dimension: str, at: int) -> dict | None:
        """What was true for this team, on this date. The point-in-time query."""
        rows = self.run(
            "MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) "
            "WHERE f.dimension = $dim AND f.valid_from <= $at AND f.valid_to > $at "
            "RETURN f.id AS id, f.band AS band, f.valid_from AS valid_from, "
            "f.valid_to AS valid_to, f.observations AS observations, "
            "f.median_value AS median_value",
            tid=team_id, dim=dimension, at=at,
        )
        return dict(rows[0]) if rows else None

    def timeline(self, team_id: int, dimension: str) -> list[dict]:
        rows = self.run(
            "MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) "
            "WHERE f.dimension = $dim "
            "RETURN f.id AS id, f.band AS band, f.valid_from AS valid_from, "
            "f.valid_to AS valid_to, f.observations AS observations, "
            "f.median_value AS median_value "
            "ORDER BY valid_from",
            tid=team_id, dim=dimension,
        )
        return [dict(r) for r in rows]

    def supersede_chain(self, fact_id: int, max_hops: int = 10) -> list[dict]:
        """Traverse the overwrite chain forward from a fact."""
        rows = self.run(
            f"MATCH (a:Fact {{id: $fid}})-[:SUPERSEDED_BY*1..{max_hops}]->(b) "
            "RETURN b.id AS id, b.band AS band, b.valid_from AS valid_from, "
            "b.valid_to AS valid_to ORDER BY valid_from",
            fid=fact_id,
        )
        return [dict(r) for r in rows]

    def evidence(self, team_id: int, dimension: str) -> int:
        """Total observations backing a dimension — drives abstention."""
        rows = self.run(
            "MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) "
            "WHERE f.dimension = $dim RETURN sum(f.observations) AS n",
            tid=team_id, dim=dimension,
        )
        return int(rows[0]["n"] or 0) if rows else 0

    def flat_lookup(self, team_id: int, dimension: str) -> dict | None:
        """The 'without HydraDB' baseline.

        No validity intervals — just the single most-evidenced claim, the way a
        vector store would surface the dominant match. Averages across eras and
        describes neither.
        """
        rows = self.run(
            "MATCH (t:Team {id: $tid})-[:HAS_FACT]->(f:Fact) "
            "WHERE f.dimension = $dim "
            "RETURN f.band AS band, f.observations AS observations, "
            "f.valid_from AS valid_from, f.valid_to AS valid_to "
            "ORDER BY observations DESC LIMIT 1",
            tid=team_id, dim=dimension,
        )
        return dict(rows[0]) if rows else None

    def ingest_cv_match(
        self,
        cv_key: int,
        label: str,
        date: str,
        competition: str,
        teams: dict[str, dict],
    ) -> dict:
        """Write video-derived state as Match nodes tagged `source: 'cv'`.

        Kept in a separate id range from event-derived matches. SoccerNet games
        are not StatsBomb games — Burnley/Arsenal 2014-15 is not in the open
        dataset at all — so reusing the id space would silently collide two
        different matches under one node.

        The `source` property is the honest marker: CV `line_height_cv` is the
        mean position of players, while event `press_height` is the mean
        location of pressure events. Related, not interchangeable, and a query
        can filter on source to avoid mixing them.
        """
        written = 0
        for team_name, state in teams.items():
            if not state:
                continue
            self.run(
                "CREATE (t:Team {id: $tid, name: $name})-[:PLAYED]->"
                "(m:Match {id: $mid, cv_key: $key, date: $date, date_ord: $dord, "
                "competition: $comp, label: $label, source: 'cv', "
                "line_height_cv: $lh, team_width_cv: $tw, shape_depth_cv: $sd, "
                "cv_observations: $obs, cv_frames: $frames})",
                tid=team_id_for(team_name), name=team_name,
                mid=CV_MATCH_ID_BASE + cv_key * 10 + written,
                key=cv_key, date=date, dord=date_ord(date), comp=competition,
                label=label,
                lh=float(state.get("line_height_cv") or 0.0),
                tw=float(state.get("team_width_cv") or 0.0),
                sd=float(state.get("shape_depth_cv") or 0.0),
                obs=int(state.get("observations") or 0),
                frames=int(state.get("frames") or 0),
            )
            written += 1
        return {"cv_matches_written": written}

    def cv_matches(self) -> list[dict]:
        rows = self.run(
            "MATCH (m:Match) WHERE m.source = 'cv' "
            "RETURN m.label AS label, m.date AS date, m.competition AS competition, "
            "m.line_height_cv AS line_height, m.team_width_cv AS width, "
            "m.cv_observations AS observations, m.cv_frames AS frames "
            "ORDER BY label"
        )
        return [dict(r) for r in rows]

    def match(self, statsbomb_id: int) -> dict | None:
        rows = self.run(
            "MATCH (m:Match {id: $mid}) RETURN m.label AS label, m.date AS date, "
            "m.date_ord AS date_ord, m.competition AS competition, "
            "m.possession_share_pct AS possession_share_pct, m.press_height AS press_height, "
            "m.defensive_action_height AS defensive_action_height, m.team_width AS team_width, "
            "m.pass_forward_ratio AS pass_forward_ratio, m.shots AS shots, m.xg AS xg, "
            "m.source AS source",
            mid=MATCH_ID_BASE + statsbomb_id,
        )
        return dict(rows[0]) if rows else None

    def team_match_metrics(self, team_id: int, statsbomb_id: int) -> dict | None:
        """This team's own numbers for one match, read off the PLAYED edge."""
        rows = self.run(
            "MATCH (t:Team {id: $tid})-[r:PLAYED]->(m:Match {id: $mid}) "
            "RETURN r.possession_share_pct AS possession_share_pct, "
            "r.press_height AS press_height, "
            "r.defensive_action_height AS defensive_action_height, "
            "r.team_width AS team_width, r.pass_forward_ratio AS pass_forward_ratio, "
            "r.shots AS shots, r.xg AS xg",
            tid=team_id, mid=MATCH_ID_BASE + statsbomb_id,
        )
        return dict(rows[0]) if rows else None

    def deviation(self, team_id: int, statsbomb_id: int) -> dict | None:
        """How one match compared to what was normal for that team at the time.

        This is the product query. It needs both levels of the graph: what this
        team actually did in the match, and the Fact valid on that date for what
        was expected. Neither alone says anything interesting.

        Match values come from the PLAYED edge rather than the Match node, so
        each side gets its own numbers — see ingest_matches.
        """
        m = self.match(statsbomb_id)
        if not m:
            return None

        mine = self.team_match_metrics(team_id, statsbomb_id) or {}
        at = m["date_ord"]
        out = []
        for dim in DIMENSIONS:
            actual = mine.get(dim, m.get(dim))
            f = self.fact_at(team_id, dim, at)
            if actual is None or not f:
                continue
            norm = f["median_value"]
            out.append(
                {
                    "dimension": dim,
                    "normal_band": f["band"],
                    "normal_value": norm,
                    "match_value": round(actual, 2),
                    "delta": round(actual - norm, 2) if norm is not None else None,
                    "fact_id": f["id"],
                    "era_matches": f["observations"],
                }
            )
        return {"match": m, "deviations": out}

    def add_highlight(
        self, statsbomb_id: int, highlight_id: int, kind: str, minute: int,
        label: str, clip_url: str = "",
    ) -> None:
        """Attachment point for CV output.

        Populated now from event data so the path is exercised; the CV
        workstream writes into the same shape later without touching anything
        else in the schema.
        """
        self.run(
            "CREATE (m:Match {id: $mid})-[:HAS_HIGHLIGHT]->"
            "(h:Highlight {id: $hid, kind: $kind, minute: $minute, "
            "label: $label, clip_url: $url, source: 'event_data'})",
            mid=MATCH_ID_BASE + statsbomb_id, hid=highlight_id, kind=kind,
            minute=minute, label=label, url=clip_url,
        )

    def highlights(self, statsbomb_id: int) -> list[dict]:
        rows = self.run(
            "MATCH (m:Match {id: $mid})-[:HAS_HIGHLIGHT]->(h:Highlight) "
            "RETURN h.id AS id, h.kind AS kind, h.minute AS minute, "
            "h.label AS label, h.clip_url AS clip_url, h.source AS source "
            "ORDER BY minute",
            mid=MATCH_ID_BASE + statsbomb_id,
        )
        return [dict(r) for r in rows]

    def cited_matches(self, fact_id: int, limit: int = 5) -> list[dict]:
        rows = self.run(
            "MATCH (f:Fact {id: $fid})-[:OBSERVED_IN]->(m:Match) "
            "RETURN m.label AS label, m.date_ord AS date_ord, m.competition AS competition "
            f"ORDER BY date_ord LIMIT {limit}",
            fid=fact_id,
        )
        return [dict(r) for r in rows]


def save_series(team: str, series: list[MatchMetrics]) -> Path:
    RESULTS.mkdir(exist_ok=True)
    p = RESULTS / f"series_{team.replace(' ', '_').lower()}.json"
    p.write_text(
        json.dumps(
            [
                {"match_id": m.match_id, "date": m.date, "competition": m.competition,
                 "label": m.label, "metrics": m.metrics}
                for m in series
            ],
            indent=1,
        )
    )
    return p


def load_series(team: str) -> list[MatchMetrics]:
    p = RESULTS / f"series_{team.replace(' ', '_').lower()}.json"
    return [MatchMetrics(**row) for row in json.loads(p.read_text())]
