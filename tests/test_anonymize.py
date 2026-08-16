import pytest

from tacticbench.anonymize import (
    LeakError,
    anonymize,
    assert_clean,
    find_leaks,
    forbidden_terms,
)


def make_state():
    return {
        "home": {
            "formation": "4-1-2-1-2",
            "players": [
                {
                    "position": "Goalkeeper",
                    "avg_x": 12.0,
                    "avg_y": 40.0,
                    "touches": 20,
                    "player_name": "Nelson de Jesus da Silva",  # must be dropped
                    "jersey_number": 1,  # must be dropped
                }
            ],
            "metrics": {"xg": 1.303, "shots": 7, "secret_field": "AC Milan"},
        },
        "away": {
            "formation": "4-4-1-1",
            "players": [],
            "metrics": {"xg": 0.229, "shots": 5},
        },
    }


class TestAnonymize:
    def test_teams_relabelled(self):
        out = anonymize(make_state(), (3, 0))
        assert set(out["teams"]) == {"Team A", "Team B"}
        assert out["halftime_score"] == {"Team A": 3, "Team B": 0}

    def test_player_name_and_jersey_dropped(self):
        out = anonymize(make_state(), (3, 0))
        player = out["teams"]["Team A"]["players"][0]
        assert set(player) == {"position", "avg_x", "avg_y", "touches"}

    def test_unlisted_metric_dropped(self):
        out = anonymize(make_state(), (3, 0))
        assert "secret_field" not in out["teams"]["Team A"]["metrics"]
        assert out["teams"]["Team A"]["metrics"]["xg"] == 1.303

    def test_formation_preserved(self):
        out = anonymize(make_state(), (3, 0))
        assert out["teams"]["Team A"]["formation"] == "4-1-2-1-2"


class TestForbiddenTerms:
    def test_collects_players_and_teams(self):
        events = [
            {"player": {"name": "Steven Gerrard"}, "type": {"name": "Pass"}},
            {
                "type": {"name": "Starting XI"},
                "tactics": {"lineup": [{"player": {"name": "Jerzy Dudek"}}]},
            },
        ]
        terms = forbidden_terms(events, "Liverpool", "AC Milan", "Champions League", "2004/2005")
        assert "Liverpool" in terms
        assert "Steven Gerrard" in terms
        assert "Gerrard" in terms  # surname split out
        assert "Dudek" in terms

    def test_short_fragments_excluded(self):
        terms = forbidden_terms([], "AC Milan", "Ajax", "X", "Y")
        assert "AC" not in terms  # too short to match safely
        assert "Milan" in terms

    def test_competition_not_fragmented(self):
        # Regression: "Champions League" split into "League", which then matched
        # any guess naming any league and failed the canary on a clean payload.
        terms = forbidden_terms([], "AC Milan", "Liverpool", "Champions League", "2004/2005")
        assert "Champions League" in terms
        assert "League" not in terms
        assert "Champions" not in terms

    def test_generic_club_words_not_identifying(self):
        terms = forbidden_terms([], "Manchester United", "Real Madrid", "Premier League", "2019")
        assert "Manchester" in terms
        assert "Madrid" in terms
        assert "United" not in terms
        assert "Real" not in terms

    def test_wrong_league_guess_does_not_fail_canary(self):
        terms = forbidden_terms([], "AC Milan", "Liverpool", "Champions League", "2004/2005")
        guess = {"guess": "Bayern Munich vs Werder Bremen, Bundesliga 2018-19"}
        assert find_leaks(guess, terms) == []

    def test_correct_identification_still_caught(self):
        terms = forbidden_terms([], "AC Milan", "Liverpool", "Champions League", "2004/2005")
        guess = {"guess": "AC Milan vs Liverpool, Champions League 2004/2005"}
        assert set(find_leaks(guess, terms)) >= {"Milan", "Liverpool", "Champions League"}


class TestFindLeaks:
    def test_detects_plain_leak(self):
        payload = {"teams": {"Team A": {"note": "Liverpool were pressing"}}}
        assert find_leaks(payload, {"Liverpool"}) == ["Liverpool"]

    def test_accent_insensitive(self):
        payload = {"note": "Smicer scored"}
        assert find_leaks(payload, {"Šmicer"}) == ["Šmicer"]

    def test_substring_does_not_false_positive(self):
        # "Ajax" must not match inside "Ajaxian" style substrings.
        payload = {"note": "the ajaxian pattern"}
        assert find_leaks(payload, {"Ajax"}) == []

    def test_clean_payload_has_no_leaks(self):
        out = anonymize(make_state(), (3, 0))
        assert find_leaks(out, {"Liverpool", "Milan", "Gerrard"}) == []

    def test_assert_clean_raises_on_leak(self):
        with pytest.raises(LeakError):
            assert_clean({"x": "Liverpool"}, {"Liverpool"})

    def test_assert_clean_passes_on_clean(self):
        assert_clean(anonymize(make_state(), (3, 0)), {"Liverpool", "Milan"})
