"""The conversation schema.

These are unit tests over the Cypher the conversation layer emits, not an
integration test against a live node — `tacticbench.verify` covers the
round-trip. What matters here is that the statements keep obeying the
constraints HydraDB actually imposes, because every one of them was found by
breaking something:

* every node is born as one end of an edge, since `CREATE` rejects a bare node
* no `IS NULL` anywhere
* one statement per request, so no multi-stage `WITH` pipelines
"""

from __future__ import annotations

from tacticbench.graph import SESSION_ID_BASE, TURN_ID_BASE, Graph


class FakeGraph(Graph):
    """Captures statements instead of sending them."""

    def __init__(self):  # noqa: D107 - deliberately skips the driver
        self.calls: list[tuple[str, dict]] = []

    def run(self, query: str, **params):  # type: ignore[override]
        self.calls.append((query, params))
        return []


def test_session_and_turn_ids_do_not_collide_with_football() -> None:
    # Facts sit at 100_000_000 and matches at 10_000_000; conversation must
    # not land on either, or a citation would resolve to the wrong node.
    assert SESSION_ID_BASE > 100_000_000
    assert TURN_ID_BASE > SESSION_ID_BASE


def test_every_created_node_is_part_of_an_edge() -> None:
    g = FakeGraph()
    g.start_session(team_id=7, session_id=1, started_ord=100)
    g.add_turn(1, 1, 0, "coach", "why", 100, cites=(100_000_001,), prev_turn_id=None)

    for query, _ in g.calls:
        if query.lstrip().startswith("CREATE"):
            assert "]->" in query, f"bare node CREATE would be rejected: {query}"


def test_no_is_null_predicates() -> None:
    g = FakeGraph()
    g.start_session(1, 1, 10)
    g.add_turn(1, 1, 0, "pep", "text", 10, cites=(1,), prev_turn_id=None)
    g.session_turns(1)
    g.turn_citations(1)
    g.recall(1)

    for query, _ in g.calls:
        assert "IS NULL" not in query.upper()


def test_citations_are_one_statement_each() -> None:
    g = FakeGraph()
    g.add_turn(1, 1, 0, "pep", "text", 10, cites=(11, 22, 33))
    cites = [q for q, _ in g.calls if ":CITES]->" in q]
    assert len(cites) == 3
    assert all("UNWIND" not in q for q, _ in g.calls)


def test_turn_links_to_its_predecessor() -> None:
    g = FakeGraph()
    g.add_turn(1, 5, 1, "coach", "and then?", 10, prev_turn_id=4)
    nexts = [(q, p) for q, p in g.calls if ":NEXT]->" in q]
    assert len(nexts) == 1
    _, params = nexts[0]
    assert params["prev"] == TURN_ID_BASE + 4
    assert params["cur"] == TURN_ID_BASE + 5


def test_first_turn_has_no_next_edge() -> None:
    g = FakeGraph()
    g.add_turn(1, 0, 0, "coach", "hello", 10)
    assert not any(":NEXT]->" in q for q, _ in g.calls)


def test_turns_are_ordered_by_seq_not_scan_order() -> None:
    g = FakeGraph()
    g.session_turns(1)
    query = g.calls[-1][0]
    assert "ORDER BY t.seq" in query


def test_session_last_ord_advances_with_each_turn() -> None:
    g = FakeGraph()
    g.add_turn(1, 1, 0, "coach", "q", 555)
    sets = [(q, p) for q, p in g.calls if "SET s.last_ord" in q]
    assert len(sets) == 1
    assert sets[0][1]["ord"] == 555
    assert sets[0][1]["sid"] == SESSION_ID_BASE + 1


def test_recall_returns_oldest_first() -> None:
    """The query pulls newest-first to get the most recent window, then the
    method reverses it — a model reads context forwards."""
    g = FakeGraph()
    g.recall(1)
    assert "ORDER BY turn.ts_ord DESC" in g.calls[-1][0]
