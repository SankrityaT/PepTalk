"""Ingesting a team twice must leave the graph as if it had happened once.

These are the only tests here that need a live HydraDB, so they skip when one
is not listening rather than failing. The rest of the suite stays runnable
without Docker, which is the convention `test_graph.py` sets.

They earn the exception because the bug they cover is invisible to pure logic:
nothing about `ingest_team` reads wrongly, and every individual write it makes
succeeds. The damage only appears in what the *store* is left holding after the
second call, which is the one thing a unit test cannot see.
"""

from __future__ import annotations

import pytest

from tacticbench.graph import Graph
from tacticbench.temporal import Fact

#: A team id nobody's crc32 reaches, so these tests cannot touch real history.
PROBE = 999_999


def _graph():
    try:
        g = Graph()
        g.run("MATCH (t:Team) WHERE t.id = -1 RETURN t.id AS id")
        return g
    except Exception:
        return None


@pytest.fixture
def graph():
    g = _graph()
    if g is None:
        pytest.skip("no HydraDB listening on bolt://127.0.0.1:7687")
    g.clear_team_facts(PROBE)
    yield g
    g.clear_team_facts(PROBE)
    g.close()


def eras(n: int) -> dict[str, list[Fact]]:
    """`n` consecutive eras on one dimension, chained oldest to newest."""
    return {
        "press_height": [
            Fact(
                dimension="press_height",
                band=f"b{i}",
                valid_from=20_000 + i * 100,
                valid_to=20_000 + (i + 1) * 100,
                observations=5,
                median_value=float(i),
                match_ids=[],
            )
            for i in range(n)
        ]
    }


def survey(g: Graph, team_id: int) -> tuple[int, int]:
    facts = g.run(
        "MATCH (t:Team)-[:HAS_FACT]->(f:Fact) WHERE t.id = $t RETURN f.id AS id", t=team_id
    )
    links = g.run(
        "MATCH (a:Fact)-[:SUPERSEDED_BY]->(b:Fact) WHERE a.team_id = $t RETURN a.id AS a",
        t=team_id,
    )
    return len(facts), len(links)


class TestReingest:
    def test_fewer_eras_leaves_no_stale_facts(self, graph):
        """The case that broke it.

        Adding a match re-segments the whole history, and re-segmentation can
        yield fewer eras than last time. Ids are handed out sequentially as the
        write loop runs, so the shorter run overwrites the low ids and abandons
        the high ones. Those orphans keep the *old* validity intervals, which
        overlap the new ones, so `fact_at` starts matching two facts for a
        single date and returns whichever the engine reaches first.
        """
        graph.ingest_team("Probe FC", PROBE, [], eras(8))
        assert survey(graph, PROBE) == (8, 7)

        graph.ingest_team("Probe FC", PROBE, [], eras(6))
        facts, _ = survey(graph, PROBE)
        assert facts == 6, "an era from the longer run survived the shorter one"

    def test_supersession_chain_does_not_double(self, graph):
        """`CREATE` upserts a node keyed by id. It does not upsert an edge."""
        graph.ingest_team("Probe FC", PROBE, [], eras(6))
        graph.ingest_team("Probe FC", PROBE, [], eras(6))
        _, links = survey(graph, PROBE)
        assert links == 5, f"the chain was written twice: {links} edges for 6 eras"

    def test_replace_false_keeps_what_is_there(self, graph):
        graph.ingest_team("Probe FC", PROBE, [], eras(4))
        out = graph.ingest_team("Probe FC", PROBE, [], eras(4), replace=False)
        assert out["cleared"] == 0

    def test_clearing_a_team_spares_its_players(self, graph):
        """The reason this is scoped through the edge and not `f.team_id`.

        A player's fact carries `team_id` as well, so the property alone
        reaches the whole squad. Against the live graph that is 10 team facts
        and 170 player facts under one team id, and clearing on the property
        takes all 180. The roster does not come back either, because
        `ingest_team` does not write player facts.

        Synthetic on both sides so the test cannot damage a real squad, which
        is exactly the accident it exists to prevent.
        """
        player_fact = 700_000_000 + PROBE
        graph.run(
            "MERGE (p:Player {id: $pid, team_id: $t})-[:HAS_FACT]->"
            "(f:Fact {id: $fid, player_id: $pid, team_id: $t, dimension: 'turnovers', "
            "band: 'high', valid_from: 20000, valid_to: 20100, observations: 5, "
            "median_value: 1.0})",
            pid=600_000_000 + PROBE, fid=player_fact, t=PROBE,
        )
        try:
            graph.ingest_team("Probe FC", PROBE, [], eras(4))
            graph.clear_team_facts(PROBE)

            survived = graph.run(
                "MATCH (f:Fact) WHERE f.id = $fid RETURN f.id AS id", fid=player_fact
            )
            assert survived, "clearing the team took its players' facts with it"
        finally:
            graph.run("MATCH (f:Fact) WHERE f.id = $fid DETACH DELETE f", fid=player_fact)
            graph.run("MATCH (p:Player) WHERE p.id = $pid DETACH DELETE p", pid=600_000_000 + PROBE)
