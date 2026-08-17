"""Who a question is about, and what the model is allowed to know.

Name resolution decides which player's facts get retrieved, so getting it wrong
does not produce an error: it produces a confident, well-cited answer about the
wrong footballer. This squad contains three Martínez, two of whom played the
same final, which is the case that breaks a naive substring match.
"""

from tacticbench.ask import resolve_player, retrieve

SQUAD = [
    {
        "id": 1,
        "name": "Damián Emiliano Martínez",
        "nickname": "Emiliano Martínez",
        "position": "Goalkeeper",
        "appearances": 13,
        "minutes": 1335.0,
    },
    {
        "id": 2,
        "name": "Lautaro Javier Martínez",
        "nickname": "Lautaro Martínez",
        "position": "Center Forward",
        "appearances": 9,
        "minutes": 420.0,
    },
    {
        "id": 3,
        "name": "Lionel Andrés Messi Cuccittini",
        "nickname": "Lionel Messi",
        "position": "Right Wing",
        "appearances": 16,
        "minutes": 1561.0,
    },
    {
        "id": 4,
        "name": "Ángel Fabián Di María Hernández",
        "nickname": "Ángel Di María",
        "position": "Right Midfield",
        "appearances": 11,
        "minutes": 872.0,
    },
]


class FakeGraph:
    """Only the two calls retrieval makes before it needs real facts."""

    def __init__(self, squad=SQUAD):
        self.squad = squad

    def players_for_team(self, team_id):
        return self.squad

    def player_ranking(self, team_id, dimension, at, limit=5):
        return []

    def player_fact_at(self, player_id, dimension, at):
        return None

    def player_timeline(self, player_id, dimension):
        return []

    def fact_at(self, team_id, dimension, at):
        return None


def who(question):
    got = resolve_player(FakeGraph(), 1, question)
    return got["nickname"] if got else None


def test_a_surname_is_enough():
    assert who("how is Messi doing") == "Lionel Messi"


def test_the_longest_match_wins():
    """The case this function exists for.

    "Martinez" alone is ambiguous between a goalkeeper and a centre forward.
    Given the full name, the longer match has to win, or the answer arrives
    citing the wrong man's norms with total confidence.
    """
    assert who("what about Lautaro Martinez") == "Lautaro Martínez"
    assert who("how did Emiliano Martinez play") == "Emiliano Martínez"


def test_accents_are_not_required():
    assert who("tell me about Di Maria") == "Ángel Di María"
    assert who("tell me about Ángel Di María") == "Ángel Di María"


def test_case_does_not_matter():
    assert who("MESSI was quiet") == "Lionel Messi"


def test_nobody_named_resolves_to_nobody():
    assert who("were we pressing high enough") is None


def test_a_short_fragment_does_not_match():
    """Guards against a two or three letter substring pulling in a player.

    Without the length floor, "did we press" contains "ess", and a squad with a
    player whose name is three letters long would start answering unrelated
    questions.
    """
    assert who("did we press") is None


def test_this_match_survives_memory_being_off():
    """The switch removes history, not eyesight.

    Everything measured off the game in front of the coach was measured without
    a graph, so it has to reach the model either way. An assistant that answers
    "I have nothing" about a match it just watched is describing a bug.
    """
    match = {"the game": "Argentina 3-3 France", "pressing height in this game": 51.67}
    got = retrieve(FakeGraph(), "Argentina", "how did we press", at=738_000, memory=False, match=match)
    texts = [f["text"] for f in got.facts]
    assert "the game: Argentina 3-3 France" in texts
    assert "pressing height in this game: 51.67" in texts
    assert all(f["kind"] == "this match" for f in got.facts)


def test_ids_are_contiguous_from_one():
    """The model cites by id, so a gap is a citation pointing at nothing."""
    match = {"a": 1, "b": 2, "c": 3}
    got = retrieve(FakeGraph(), "Argentina", "anything", at=738_000, memory=False, match=match)
    assert [f["id"] for f in got.facts] == [1, 2, 3]
