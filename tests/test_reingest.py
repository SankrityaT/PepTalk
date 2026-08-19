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


def _wipe(g: Graph) -> None:
    """Leave nothing behind, including the Team node itself.

    Clearing only the facts is not enough. `ingest_team` creates the Team as
    one end of the HAS_FACT edge, so a run of these tests left "Probe FC"
    standing in the live graph and the count of sides went up by one. That is
    a test writing itself into the data the product reports on.
    """
    g.clear_team_facts(PROBE)
    g.run("MATCH (t:Team) WHERE t.id = $t DETACH DELETE t", t=PROBE)


@pytest.fixture
def graph():
    g = _graph()
    if g is None:
        pytest.skip("no HydraDB listening on bolt://127.0.0.1:7687")
    _wipe(g)
    yield g
    _wipe(g)
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


#: Another id nobody's crc32 reaches, for the conversation tests.
PROBE_SESSION = 998_001


class TestConversationMemory:
    """Turns accumulate across sessions, and recall reads them back.

    This is the half of the memory layer the product never exercised: the
    schema and the queries existed and shipped, and nothing on the live path
    ever wrote a turn. These pin the behaviour now that it does.
    """

    def _wipe(self, g):
        for t in g.session_turns(PROBE_SESSION, limit=1000):
            g.run("MATCH (t:Turn) WHERE t.id = $i DETACH DELETE t", i=t["id"])
        g.run("MATCH (s:Session) WHERE s.id = $i DETACH DELETE s", i=400_000_000 + PROBE_SESSION)

    def test_turns_keep_their_order_across_appends(self, graph):
        """Sequence comes from the store, not from a counter in the process.

        A second tab, a restarted server and a resumed session all have to
        continue the same thread rather than start again at zero and write
        over the beginning of it.
        """
        self._wipe(graph)
        try:
            for i, (role, text) in enumerate(
                [("coach", "first"), ("pep", "second"), ("coach", "third")]
            ):
                graph.append_turn(PROBE, PROBE_SESSION, role, text, 739_100 + i)

            turns = graph.session_turns(PROBE_SESSION, limit=50)
            assert [t["seq"] for t in turns] == [0, 1, 2]
            assert [t["text"] for t in turns] == ["first", "second", "third"]
        finally:
            self._wipe(graph)

    def test_a_turn_cites_real_fact_nodes(self, graph):
        """The citation has to reach a fact that exists, or the chip is a lie."""
        self._wipe(graph)
        graph.clear_team_facts(PROBE)
        try:
            graph.ingest_team("Probe FC", PROBE, [], eras(3))
            facts = graph.run(
                "MATCH (t:Team)-[:HAS_FACT]->(f:Fact) WHERE t.id = $t RETURN f.id AS id",
                t=PROBE,
            )
            ids = tuple(int(f["id"]) for f in facts)
            assert ids

            tid = graph.append_turn(
                PROBE, PROBE_SESSION, "pep", "you press high", 739_100, cites=ids
            )
            cited = graph.turn_citations(tid - 500_000_000)
            assert {int(c["id"]) for c in cited} == set(ids)
        finally:
            self._wipe(graph)
            graph.clear_team_facts(PROBE)

    def test_recall_returns_each_turn_once(self, graph):
        """Duplicate HAS_TURN edges must not eat the recall limit.

        Sessions written before that edge became a MERGE still sit in the
        graph with the same turn reachable several times over. A repeated turn
        pushes real history out of the window, which fails by forgetting
        rather than by erroring.
        """
        self._wipe(graph)
        try:
            graph.append_turn(PROBE, PROBE_SESSION, "coach", "only once", 739_100)
            # Forge the duplication the old CREATE-based writer produced.
            turn = graph.session_turns(PROBE_SESSION, limit=1)[0]
            for _ in range(3):
                graph.run(
                    "CREATE (s:Session {id: $sid})-[:HAS_TURN]->(t:Turn {id: $tid})",
                    sid=400_000_000 + PROBE_SESSION, tid=turn["id"],
                )

            texts = [t["text"] for t in graph.recall(PROBE, limit=12)]
            assert texts.count("only once") == 1, texts
        finally:
            self._wipe(graph)
