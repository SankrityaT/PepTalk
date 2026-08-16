from tacticbench.scenario import Scenario


def scn(ht_home, ht_away, ft_home, ft_away, home="Milan", away="Liverpool"):
    return Scenario(
        match_id=1, label=f"{home} {ft_home}-{ft_away} {away}", date="2005-05-25",
        competition="Champions League", home=home, away=away,
        ht_home=ht_home, ht_away=ht_away, ft_home=ft_home, ft_away=ft_away,
        trailing_team=home if ht_home < ht_away else away,
        opponent=away if ht_home < ht_away else home,
        state={},
    )


class TestTrailingAndOpponent:
    def test_away_trailing(self):
        s = scn(3, 0, 3, 3)
        assert s.trailing_team == "Liverpool"
        assert s.opponent == "Milan"

    def test_home_trailing(self):
        s = scn(0, 2, 2, 2)
        assert s.trailing_team == "Milan"
        assert s.opponent == "Liverpool"

    def test_deficit_is_absolute(self):
        assert scn(3, 0, 3, 3).deficit == 3
        assert scn(0, 3, 3, 3).deficit == 3


class TestRecovered:
    def test_draw_from_behind_counts_as_recovered(self):
        # Istanbul: Liverpool 0-3 down, finished 3-3.
        assert scn(3, 0, 3, 3).recovered is True

    def test_win_from_behind_recovered(self):
        assert scn(2, 0, 2, 3).recovered is True

    def test_still_losing_not_recovered(self):
        assert scn(3, 0, 4, 1).recovered is False

    def test_home_side_recovery_tracked_separately(self):
        s = scn(0, 2, 2, 2)  # home trailed, drew
        assert s.trailing_team == "Milan"
        assert s.recovered is True

    def test_home_side_failed_recovery(self):
        s = scn(0, 2, 1, 3)
        assert s.trailing_team == "Milan"
        assert s.recovered is False


class TestSummary:
    def test_summary_names_all_four_bindings(self):
        text = scn(3, 0, 3, 3).summary()
        assert "Liverpool trail by 3" in text
        assert "advising against Milan" in text
        assert "2005-05-25" in text
