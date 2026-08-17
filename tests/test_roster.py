"""Minutes on the pitch, when the match clock cannot be trusted.

Regression for a real defect. StatsBomb's lineup feed carries
`positions[].from/to`, which is the obvious source for minutes played and is
wrong for any match that reaches a shootout. Messi's entry for the 2022 final
reads:

    Right Wing          00:00  -> 115:32   periods 1 -> 4
    Right Center Fwd    115:32 -> 28:11    periods 4 -> 1
    Right Wing          28:19 -> None      period  1

Summing those intervals credits 87 minutes to a man who played all 120, and the
per-90 rates built on top are then inflated by 40%. Events carry a continuous
match clock and a complete on/off record, so the roster reads those instead.
"""

from tacticbench.roster import minutes_from_events

TEAM = "Argentina"


def starting_xi(names, team=TEAM):
    return {
        "type": {"name": "Starting XI"},
        "period": 1,
        "minute": 0,
        "second": 0,
        "team": {"name": team},
        "tactics": {"lineup": [{"player": {"name": n}} for n in names]},
    }


def sub(off, on, minute, team=TEAM):
    return {
        "type": {"name": "Substitution"},
        "period": 2,
        "minute": minute,
        "second": 0,
        "team": {"name": team},
        "player": {"name": off},
        "substitution": {"replacement": {"name": on}},
    }


def tick(minute, period=1, team=TEAM):
    return {
        "type": {"name": "Pass"},
        "period": period,
        "minute": minute,
        "second": 0,
        "team": {"name": team},
    }


def test_starter_gets_the_whole_match():
    events = [starting_xi(["Messi"]), tick(94, period=2)]
    assert minutes_from_events(events, TEAM) == {"Messi": 94.0}


def test_substitute_is_credited_from_when_they_came_on():
    events = [starting_xi(["Di Maria"]), sub("Di Maria", "Acuna", 64), tick(92, period=2)]
    mins = minutes_from_events(events, TEAM)
    assert mins["Di Maria"] == 64.0
    assert mins["Acuna"] == 28.0


def test_extra_time_counts_and_the_shootout_does_not():
    """The defect this module exists for.

    Period 4 ends at 124 minutes; period 5 is the shootout. A starter played
    124, not 129, and certainly not the 87 the lineup feed reports.
    """
    events = [
        starting_xi(["Messi"]),
        tick(124, period=4),
        tick(129, period=5),
    ]
    assert minutes_from_events(events, TEAM) == {"Messi": 124.0}


def test_a_red_card_ends_the_match_like_a_substitution():
    events = [
        starting_xi(["Montiel"]),
        {
            "type": {"name": "Bad Behaviour"},
            "period": 2,
            "minute": 70,
            "second": 0,
            "team": {"name": TEAM},
            "player": {"name": "Montiel"},
            "bad_behaviour": {"card": {"name": "Red Card"}},
        },
        tick(90, period=2),
    ]
    assert minutes_from_events(events, TEAM) == {"Montiel": 70.0}


def test_a_yellow_card_does_not():
    events = [
        starting_xi(["Otamendi"]),
        {
            "type": {"name": "Bad Behaviour"},
            "period": 2,
            "minute": 70,
            "second": 0,
            "team": {"name": TEAM},
            "player": {"name": "Otamendi"},
            "bad_behaviour": {"card": {"name": "Yellow Card"}},
        },
        tick(90, period=2),
    ]
    assert minutes_from_events(events, TEAM) == {"Otamendi": 90.0}


def test_the_other_side_is_not_on_our_roster():
    events = [
        starting_xi(["Messi"]),
        starting_xi(["Mbappe"], team="France"),
        tick(90, period=2),
    ]
    assert set(minutes_from_events(events, TEAM)) == {"Messi"}


def test_the_clock_runs_on_the_opponents_events_too():
    """The final whistle is the last event of the match, whoever played it."""
    events = [starting_xi(["Messi"]), tick(95, period=2, team="France")]
    assert minutes_from_events(events, TEAM) == {"Messi": 95.0}


# ── the surname a clip is filed under ──────────────────────────────────

from tacticbench.roster import display_surname


def test_a_collapsed_compound_surname_is_repaired():
    """The defect this exists for.

    StatsBomb records Alexis Mac Allister's nickname as "Alexis MacAllister".
    The roster filed him under MacAllister and the clips under Mac Allister, so
    his footage stopped joining to his card. Nothing errored; he simply had no
    clips, which is indistinguishable from a player who genuinely has none.
    """
    assert display_surname("Alexis Mac Allister", "Alexis MacAllister") == "Mac Allister"


def test_a_maternal_surname_does_not_override_the_broadcast_name():
    """Why the blunter rule could not be reused.

    Rejecting the nickname whenever it disagrees with the full name turns
    Messi into Cuccittini and Di Maria into Hernandez, because the heuristic
    reads the last word of a Spanish full name as the surname.
    """
    assert display_surname("Lionel Andrés Messi Cuccittini", "Lionel Messi") == "Messi"
    assert display_surname("Ángel Fabián Di María Hernández", "Ángel Di María") == "Di María"


def test_agreement_is_left_alone():
    assert display_surname("Nicolás Hernán Otamendi", "Nicolás Otamendi") == "Otamendi"


def test_no_nickname_falls_back_to_the_full_name():
    assert display_surname("Nicolás Hernán Otamendi", None) == "Otamendi"
