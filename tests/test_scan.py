from tacticbench.scan import Goal, classify, extract_goals, score_at_halftime


def shot_goal(period, minute, team):
    return {
        "type": {"name": "Shot"},
        "period": period,
        "minute": minute,
        "second": 0,
        "team": {"name": team},
        "shot": {"outcome": {"name": "Goal"}},
    }


def shot_saved(period, minute, team):
    return {
        "type": {"name": "Shot"},
        "period": period,
        "minute": minute,
        "second": 0,
        "team": {"name": team},
        "shot": {"outcome": {"name": "Saved"}},
    }


def own_goal_pair(period, minute, conceding, benefiting):
    return [
        {
            "type": {"name": "Own Goal Against"},
            "period": period,
            "minute": minute,
            "second": 0,
            "team": {"name": conceding},
        },
        {
            "type": {"name": "Own Goal For"},
            "period": period,
            "minute": minute,
            "second": 0,
            "team": {"name": benefiting},
        },
    ]


class TestExtractGoals:
    def test_counts_only_scoring_shots(self):
        ev = [shot_goal(1, 10, "A"), shot_saved(1, 20, "B"), shot_goal(2, 60, "B")]
        assert [(g.period, g.minute, g.team) for g in extract_goals(ev)] == [
            (1, 10, "A"),
            (2, 60, "B"),
        ]

    def test_own_goal_credited_to_beneficiary_once(self):
        ev = own_goal_pair(1, 30, conceding="A", benefiting="B")
        goals = extract_goals(ev)
        assert len(goals) == 1
        assert goals[0].team == "B"

    def test_sorted_chronologically_across_periods(self):
        ev = [shot_goal(2, 50, "B"), shot_goal(1, 5, "A"), shot_goal(1, 40, "A")]
        assert [g.minute for g in extract_goals(ev)] == [5, 40, 50]

    def test_ignores_non_shot_events(self):
        ev = [{"type": {"name": "Pass"}, "period": 1, "minute": 3, "team": {"name": "A"}}]
        assert extract_goals(ev) == []


class TestScoreAtHalftime:
    def test_second_half_goals_excluded(self):
        goals = [
            Goal(1, 10, 0, "A"),
            Goal(1, 20, 0, "A"),
            Goal(2, 60, 0, "B"),
            Goal(2, 70, 0, "B"),
        ]
        assert score_at_halftime(goals, "A", "B") == (2, 0)

    def test_goalless_first_half(self):
        assert score_at_halftime([Goal(2, 60, 0, "A")], "A", "B") == (0, 0)


class TestClassify:
    def test_istanbul_shape_is_treatment(self):
        # 0-3 down at the break, level at full time.
        out = classify(ht=(0, 3), ft=(3, 3), min_deficit=2)
        assert out["trailing_side"] == "home"
        assert out["ht_deficit"] == 3
        assert out["recovered"] is True
        assert out["group"] == "treatment"

    def test_failed_comeback_is_control(self):
        out = classify(ht=(0, 2), ft=(1, 3), min_deficit=2)
        assert out["group"] == "control"
        assert out["final_margin"] == -2

    def test_deficit_below_threshold_rejected(self):
        assert classify(ht=(0, 1), ft=(0, 1), min_deficit=2) is None

    def test_away_team_trailing_detected(self):
        out = classify(ht=(2, 0), ft=(2, 2), min_deficit=2)
        assert out["trailing_side"] == "away"
        assert out["recovered"] is True

    def test_level_at_full_time_counts_as_recovered(self):
        out = classify(ht=(0, 2), ft=(2, 2), min_deficit=2)
        assert out["final_margin"] == 0
        assert out["recovered"] is True

    def test_level_at_halftime_never_selected(self):
        assert classify(ht=(1, 1), ft=(3, 1), min_deficit=1) is None
