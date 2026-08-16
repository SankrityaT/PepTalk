from tacticbench.score import aggregate, score_trial


def rec(**kw):
    base = {
        "shape_change": {"recommend": True, "to_formation": "3-5-2"},
        "personnel": {"substitutions_recommended": 1, "positions_to_replace": ["Right Back"]},
        "pressing_height": "higher",
        "width": "wider",
        "tempo": "more_direct",
    }
    base.update(kw)
    return base


def act(**kw):
    base = {
        "shape_change": {"status": "changed", "from_formation": "4-4-2", "to_formation": "3-5-2"},
        "personnel": {"halftime_substitutions": 1, "positions_replaced": ["Right Back"]},
        "pressing_height": "higher",
        "width": "wider",
        "tempo": "more_direct",
    }
    base.update(kw)
    return base


class TestDirectional:
    def test_exact_agreement_is_match(self):
        s = score_trial(rec(), act())
        assert s["verdicts"]["pressing_height"] == "match"
        assert s["alignment"] == 1.0

    def test_opposite_is_contradiction(self):
        s = score_trial(rec(pressing_height="higher"), act(pressing_height="lower"))
        assert s["verdicts"]["pressing_height"] == "contradicts"
        assert s["contradictions"] == 1

    def test_unchanged_vs_directional_is_no_match_not_contradiction(self):
        s = score_trial(rec(width="wider"), act(width="unchanged"))
        assert s["verdicts"]["width"] == "no_match"

    def test_unknown_actual_excluded(self):
        s = score_trial(rec(tempo="more_direct"), act(tempo="unknown"))
        assert s["verdicts"]["tempo"] == "excluded"
        assert s["scorable_dimensions"] == 4


class TestShape:
    def test_undetermined_shape_excluded_not_penalised(self):
        # The Istanbul case: StatsBomb logged no period-2 shift.
        s = score_trial(rec(), act(shape_change={"status": "undetermined"}))
        assert s["verdicts"]["shape_change"] == "excluded"
        assert s["scorable_dimensions"] == 4
        assert s["alignment"] == 1.0  # excluded dims must not drag the rate down

    def test_recommended_and_changed_is_match(self):
        s = score_trial(rec(), act())
        assert s["verdicts"]["shape_change"] == "match"

    def test_recommended_but_unchanged_contradicts(self):
        s = score_trial(rec(), act(shape_change={"status": "unchanged"}))
        assert s["verdicts"]["shape_change"] == "contradicts"

    def test_not_recommended_and_unchanged_is_match(self):
        s = score_trial(
            rec(shape_change={"recommend": False, "to_formation": None}),
            act(shape_change={"status": "unchanged"}),
        )
        assert s["verdicts"]["shape_change"] == "match"


class TestPersonnel:
    def test_both_substituting_is_match(self):
        s = score_trial(rec(), act())
        assert s["verdicts"]["personnel"] == "match"

    def test_recommended_none_but_sub_made_is_no_match(self):
        s = score_trial(
            rec(personnel={"substitutions_recommended": 0, "positions_to_replace": []}),
            act(),
        )
        assert s["verdicts"]["personnel"] == "no_match"

    def test_neither_substituting_is_match(self):
        s = score_trial(
            rec(personnel={"substitutions_recommended": 0, "positions_to_replace": []}),
            act(personnel={"halftime_substitutions": 0, "positions_replaced": []}),
        )
        assert s["verdicts"]["personnel"] == "match"


class TestAggregate:
    def test_separation_computed(self):
        trials = [
            {"group": "treatment", "alignment": 0.8},
            {"group": "treatment", "alignment": 0.6},
            {"group": "control", "alignment": 0.4},
        ]
        out = aggregate(trials)
        assert out["treatment"]["n"] == 2
        assert out["treatment"]["mean_alignment"] == 0.7
        assert out["control"]["mean_alignment"] == 0.4
        assert out["separation"] == 0.3

    def test_no_separation_when_groups_agree(self):
        trials = [
            {"group": "treatment", "alignment": 0.5},
            {"group": "control", "alignment": 0.5},
        ]
        assert aggregate(trials)["separation"] == 0.0

    def test_empty_group_handled(self):
        out = aggregate([{"group": "treatment", "alignment": 0.5}])
        assert out["control"]["n"] == 0
        assert out["separation"] is None
