import pytest

from tacticbench.temporal import (
    OPEN_ENDED,
    Observation,
    bucket,
    build_facts,
    fact_at,
    quantile_thresholds,
    rolling_median,
)

NAMES = ("deep", "mid", "high")
EDGES = (45.0, 55.0)


def series(values, start_ord=100):
    return [Observation(match_id=i, date_ord=start_ord + i, value=v) for i, v in enumerate(values)]


class TestRollingMedian:
    def test_uses_partial_window_at_start(self):
        assert rolling_median([1.0, 3.0, 5.0], window=3) == [1.0, 2.0, 3.0]

    def test_smooths_single_spike(self):
        out = rolling_median([10.0, 10.0, 100.0, 10.0, 10.0], window=3)
        assert max(out) < 50.0  # the spike never dominates

    def test_window_one_is_identity(self):
        assert rolling_median([1.0, 9.0, 4.0], window=1) == [1.0, 9.0, 4.0]

    def test_rejects_zero_window(self):
        with pytest.raises(ValueError):
            rolling_median([1.0], window=0)


class TestBucketing:
    def test_bands(self):
        assert bucket(40.0, EDGES, NAMES) == "deep"
        assert bucket(50.0, EDGES, NAMES) == "mid"
        assert bucket(60.0, EDGES, NAMES) == "high"

    def test_edges_inclusive_toward_outer_bands(self):
        assert bucket(45.0, EDGES, NAMES) == "deep"
        assert bucket(55.0, EDGES, NAMES) == "high"

    def test_quantile_thresholds_default_to_quartiles(self):
        # Quartiles, not terciles: edges sit where the data is sparse so a team
        # near a boundary does not flip band on ordinary noise.
        lo, hi = quantile_thresholds([float(i) for i in range(100)])
        assert lo < hi
        assert 23 <= lo <= 27
        assert 73 <= hi <= 77

    def test_quantile_thresholds_accept_explicit_quantiles(self):
        lo, hi = quantile_thresholds([float(i) for i in range(100)], 1 / 3, 2 / 3)
        assert 30 <= lo <= 36
        assert 63 <= hi <= 69

    def test_quantile_rejects_empty(self):
        with pytest.raises(ValueError):
            quantile_thresholds([])


class TestBuildFacts:
    def test_stable_team_yields_one_open_fact(self):
        facts = build_facts(series([60.0] * 12), "press_height", EDGES, NAMES)
        assert len(facts) == 1
        assert facts[0].band == "high"
        assert facts[0].is_open
        assert facts[0].valid_to == OPEN_ENDED

    def test_sustained_change_opens_a_second_fact(self):
        # Long enough for the production defaults (window=15, min_run=8).
        facts = build_facts(series([60.0] * 30 + [35.0] * 30), "press_height", EDGES, NAMES)
        assert [f.band for f in facts] == ["high", "deep"]
        assert facts[0].valid_to == facts[1].valid_from  # intervals abut, no gap
        assert facts[1].is_open

    def test_short_regime_ignored_under_default_hysteresis(self):
        # Ten matches is not a new era at production settings. This is what
        # stopped Barcelona's 531 matches resolving into 54 spurious "eras".
        facts = build_facts(series([60.0] * 30 + [35.0] * 5), "press_height", EDGES, NAMES)
        assert len(facts) == 1

    def test_single_outlier_does_not_flip_identity(self):
        # One aberrant match in an otherwise high-pressing season.
        facts = build_facts(series([60.0] * 8 + [20.0] + [60.0] * 8), "press_height", EDGES, NAMES)
        assert len(facts) == 1
        assert facts[0].band == "high"

    def test_brief_dip_below_min_run_ignored(self):
        facts = build_facts(
            series([60.0] * 8 + [30.0, 30.0] + [60.0] * 8),
            "press_height", EDGES, NAMES, window=1, min_run=3,
        )
        assert len(facts) == 1

    def test_dip_meeting_min_run_is_recorded(self):
        facts = build_facts(
            series([60.0] * 8 + [30.0] * 6 + [60.0] * 8),
            "press_height", EDGES, NAMES, window=1, min_run=3,
        )
        assert [f.band for f in facts] == ["high", "deep", "high"]

    def test_intervals_are_contiguous_and_ordered(self):
        facts = build_facts(
            series([60.0] * 10 + [30.0] * 10 + [60.0] * 10),
            "press_height", EDGES, NAMES, window=1, min_run=3,
        )
        for a, b in zip(facts, facts[1:]):
            assert a.valid_to == b.valid_from
            assert a.valid_from < a.valid_to

    def test_only_final_fact_is_open(self):
        facts = build_facts(
            series([60.0] * 10 + [30.0] * 10), "press_height", EDGES, NAMES, window=1, min_run=3
        )
        assert [f.is_open for f in facts] == [False, True]

    def test_observations_and_match_ids_recorded(self):
        facts = build_facts(series([60.0] * 6), "press_height", EDGES, NAMES)
        assert facts[0].observations == 6
        assert facts[0].match_ids == list(range(6))

    def test_empty_input(self):
        assert build_facts([], "press_height", EDGES, NAMES) == []

    def test_unsorted_input_is_ordered_first(self):
        obs = [
            Observation(2, 300, 60.0),
            Observation(0, 100, 60.0),
            Observation(1, 200, 60.0),
        ]
        facts = build_facts(obs, "press_height", EDGES, NAMES)
        assert facts[0].valid_from == 100


class TestFactAt:
    def test_returns_era_appropriate_fact(self):
        facts = build_facts(
            series([60.0] * 10 + [30.0] * 10, start_ord=1000),
            "press_height", EDGES, NAMES, window=1, min_run=3,
        )
        early = fact_at(facts, 1002)
        late = fact_at(facts, 1018)
        assert early.band == "high"
        assert late.band == "deep"
        assert early is not late

    def test_open_fact_covers_far_future(self):
        facts = build_facts(series([60.0] * 6, start_ord=1000), "press_height", EDGES, NAMES)
        assert fact_at(facts, 900_000).band == "high"

    def test_before_first_observation_returns_none(self):
        facts = build_facts(series([60.0] * 6, start_ord=1000), "press_height", EDGES, NAMES)
        assert fact_at(facts, 500) is None
