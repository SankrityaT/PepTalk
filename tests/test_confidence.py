from tacticbench.temporal import Fact, era_confidence


def f(median, obs=20):
    return Fact(dimension="d", band="b", valid_from=1, valid_to=2, observations=obs,
                match_ids=[], median_value=median)


class TestEraConfidence:
    def test_single_era_is_not_scored(self):
        out = era_confidence([f(60.0)], [59.0, 60.0, 61.0])
        assert out["tier"] == "single_era"
        assert out["confidence"] is None

    def test_empty_is_not_scored(self):
        assert era_confidence([], [1.0, 2.0])["tier"] == "single_era"

    def test_wide_separation_scores_high(self):
        vals = [50.0, 51.0, 49.0, 70.0, 71.0, 69.0]
        out = era_confidence([f(50.0), f(70.0)], vals)
        assert out["tier"] == "high"
        assert out["separation"] == 20.0

    def test_separation_small_against_noise_scores_low(self):
        # Eras 1 apart, but the series swings over 40.
        vals = [10.0, 50.0, 20.0, 60.0, 30.0, 70.0]
        out = era_confidence([f(40.0), f(41.0)], vals)
        assert out["tier"] == "low"

    def test_zero_noise_is_unknown_not_infinite(self):
        out = era_confidence([f(1.0), f(2.0)], [5.0, 5.0, 5.0])
        assert out["tier"] == "unknown"
        assert out["confidence"] is None

    def test_separation_reported_in_native_units(self):
        # The number a human judges practical significance on: possession moves
        # 5 percentage points, directness 0.024. The ratio cannot tell them
        # apart; these raw values can.
        poss = era_confidence([f(61.7), f(67.0)], [58.0, 62.0, 67.0, 63.0])
        assert abs(poss["separation"] - 5.3) < 1e-6

    def test_missing_medians_handled(self):
        out = era_confidence([f(None), f(None)], [1.0, 2.0, 3.0])
        assert out["tier"] == "unknown"

    def test_multi_era_averages_the_steps(self):
        out = era_confidence([f(10.0), f(20.0), f(24.0)], [10.0, 20.0, 24.0, 15.0])
        # Steps of 10 and 4 -> mean 7.
        assert abs(out["separation"] - 7.0) < 1e-6
