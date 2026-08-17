"""The checks have to be able to fail.

An eval that passes everything is indistinguishable from an eval that measures
nothing, and the difference only shows up on the day it matters. Each check here
is fed a planted violation and has to catch it, and a clean answer and has to
let it through.

The fixture answers are written by hand rather than generated, so these run in
milliseconds and never depend on a model being reachable.
"""

from tacticbench.evals import Case, abstention, cited, grounded, resolution, supported

RETRIEVED = [
    {"id": 1, "kind": "this match", "text": "pressing height in this game: 51.67"},
    {"id": 2, "kind": "team norm", "text": "Argentina pressing height: 57.18 (mid), holding since 2018-06-21 across 16 games"},
]


def result(answer, memory=True, player=None, retrieved=RETRIEVED):
    return {"answer": answer, "memory": memory, "retrieved": retrieved, "player": player}


# ── grounded ────────────────────────────────────────────────────────────

def test_grounded_passes_when_every_number_was_retrieved():
    assert grounded(result("You pressed at 51.67 [1], against a norm of 57.18 [2].")).passed


def test_grounded_catches_an_invented_number():
    """The check that matters most: a figure from nowhere."""
    c = grounded(result("You pressed at 51.67 [1], your lowest in 43 matches."))
    assert not c.passed
    assert "43" in c.detail


def test_grounded_catches_arithmetic():
    """Right answer, forbidden method.

    5.5 is 57.18 minus 51.67 and is correct. It still fails, because the
    prompt forbids calculation: a coach cannot check a number that appears in
    no fact, and a model willing to do arithmetic here is willing to do it
    when it is wrong.
    """
    c = grounded(result("You pressed 5.5 below your norm [2]."))
    assert not c.passed
    assert "5.5" in c.detail


def test_grounded_ignores_years():
    assert grounded(result("It has held since 2018 [2].")).passed


# ── cited ───────────────────────────────────────────────────────────────

def test_cited_catches_a_number_with_no_id():
    c = cited(result("You pressed at 51.67 and that is low."))
    assert not c.passed


def test_cited_allows_prose_with_no_numbers():
    assert cited(result("Your midfield is where the waste lives.")).passed


# ── supported ───────────────────────────────────────────────────────────

def test_supported_catches_a_citation_to_nothing():
    c = supported(result("You pressed at 51.67 [9]."))
    assert not c.passed
    assert "9" in c.detail


# ── resolution ──────────────────────────────────────────────────────────

def test_resolution_catches_the_wrong_player():
    c = resolution(result("...", player="Lionel Messi"), Case("how is De Paul", "Rodrigo De Paul"))
    assert not c.passed


def test_resolution_catches_a_player_conjured_from_nowhere():
    c = resolution(result("...", player="Lionel Messi"), Case("were we pressing high", None))
    assert not c.passed


def test_resolution_is_not_applicable_without_memory():
    c = resolution(result("...", memory=False), Case("how is De Paul", "Rodrigo De Paul"))
    assert c.passed


# ── abstention ──────────────────────────────────────────────────────────

def test_abstention_catches_history_claimed_without_facts():
    c = abstention(result("He usually presses higher than this.", memory=False))
    assert not c.passed
    assert "usually" in c.detail


def test_abstention_catches_a_dated_claim():
    c = abstention(result("He has been doing this since 2022.", memory=False))
    assert not c.passed


def test_abstention_allows_saying_you_cannot_compare():
    """The correct behaviour, which must not be scored as a violation."""
    assert abstention(
        result("I cannot tell you whether that is usual for you.", memory=False)
    ).passed
    assert abstention(
        result("Without a baseline I have no norm to compare against.", memory=False)
    ).passed


def test_abstention_allows_causal_since():
    """The false positive this distinction exists for.

    "since narrow attacks congest passing lanes" is a conjunction, not a claim
    about history, and flagging it failed an answer that had already said it
    had no baselines.
    """
    assert abstention(
        result(
            "Width sat at 23.44 [6], which I would look at first, since narrow "
            "attacks let opponents congest the lanes.",
            memory=False,
        )
    ).passed


def test_abstention_is_not_applicable_with_memory_on():
    assert abstention(result("He usually presses higher [2].", memory=True)).passed


# ── the two false positives these rules were tightened for ─────────────

def test_abstention_allows_a_negation_earlier_in_the_same_sentence():
    """A real answer that a fixed character window wrongly failed.

    "cannot" governs "usual" here; it just sits seventy characters back
    instead of sixty. Scope is a sentence, not a byte count.
    """
    assert abstention(
        result(
            "I can tell you the team's pressing height sat at 51.67 [4], but "
            "without player-level breakdowns or historical norms, I cannot say "
            "what that means for Messi specifically or whether any of it is usual.",
            memory=False,
        )
    ).passed


def test_abstention_still_catches_a_disclaimer_stapled_on_afterwards():
    """The case the sentence rule must not let through.

    The negation comes after the claim, so it does not govern it. This is the
    difference between abstaining and asserting with a hedge.
    """
    c = abstention(
        result("He usually presses higher than this, though I cannot be certain.", memory=False)
    )
    assert not c.passed
    assert "usually" in c.detail


def test_a_scoreline_is_not_a_claim():
    """Naming the match is not making a measurement.

    "Argentina 3-3 France" failed the citation check because its digits read as
    two uncited numbers, which is the eval misreading a label as a claim.
    """
    assert cited(result("I can describe team numbers from Argentina 3-3 France if that helps.")).passed


def test_a_measurement_beside_a_scoreline_is_still_a_claim():
    """Ignoring scorelines must not create a hole to hide numbers in."""
    assert not cited(
        result("In the 3-3 with France your width was 23.44 and that is the problem.")
    ).passed


# ── vocabulary of the disclaimer vs vocabulary of the claim ────────────

def test_naming_what_is_missing_is_not_a_claim():
    """Two real answers this rule wrongly failed.

    An assistant saying it has no baseline, or that a baseline is what would be
    needed, is doing the right thing. Flagging the noun punished the honesty it
    was written to enforce.
    """
    assert abstention(result("To answer that we would need his off-the-ball baseline.", memory=False)).passed
    assert abstention(result("I have no season norm in front of me.", memory=False)).passed


def test_a_subjunctive_about_this_match_is_not_history():
    """"could have been pushed higher" is judgement about the game on screen."""
    assert abstention(
        result("The block could have been pushed a good few metres further up.", memory=False)
    ).passed


def test_asserted_habituality_is_still_caught():
    """The rule must keep its teeth after both loosenings."""
    assert not abstention(result("His block has been higher than this all season.", memory=False)).passed
    assert not abstention(result("They typically press higher.", memory=False)).passed
    assert not abstention(result("That is below his average.", memory=False)).passed
