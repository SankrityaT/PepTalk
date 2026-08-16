from tacticbench.temporal import Fact, merge_insignificant


def f(band, vf, vt, obs, median):
    return Fact(
        dimension="d", band=band, valid_from=vf, valid_to=vt,
        observations=obs, match_ids=list(range(obs)), median_value=median,
    )


class TestMergeInsignificant:
    def test_close_medians_merge(self):
        # 0.02 apart on a spread of 0.10 -> below the 0.35 separation floor.
        out = merge_insignificant([f("patient", 1, 5, 10, 0.60), f("mixed", 5, 9, 6, 0.62)], spread=0.10)
        assert len(out) == 1
        assert out[0].valid_from == 1 and out[0].valid_to == 9

    def test_distant_medians_survive(self):
        out = merge_insignificant([f("low", 1, 5, 10, 55.0), f("dominant", 5, 9, 20, 67.0)], spread=8.4)
        assert len(out) == 2

    def test_merged_era_keeps_band_of_larger_evidence(self):
        out = merge_insignificant([f("patient", 1, 5, 3, 0.60), f("mixed", 5, 9, 30, 0.62)], spread=0.10)
        assert out[0].band == "mixed"

    def test_merged_observations_are_summed(self):
        out = merge_insignificant([f("a", 1, 5, 10, 0.60), f("b", 5, 9, 6, 0.62)], spread=0.10)
        assert out[0].observations == 16

    def test_merged_median_is_evidence_weighted(self):
        out = merge_insignificant([f("a", 1, 5, 10, 0.60), f("b", 5, 9, 30, 0.64)], spread=0.20)
        # Weighted toward the era with more matches.
        assert out[0].median_value > 0.62

    def test_timeline_stays_contiguous_after_merge(self):
        out = merge_insignificant(
            [f("a", 1, 5, 8, 0.60), f("b", 5, 9, 8, 0.61), f("c", 9, 20, 8, 0.62)], spread=0.10
        )
        for a, b in zip(out, out[1:]):
            assert a.valid_to == b.valid_from
        assert out[0].valid_from == 1
        assert out[-1].valid_to == 20

    def test_chain_merge_collapses_gradual_drift(self):
        # Each step is small, so the whole run collapses rather than surviving
        # as a staircase of near-identical eras.
        facts = [f(str(i), i, i + 1, 5, 0.60 + i * 0.01) for i in range(5)]
        out = merge_insignificant(facts, spread=0.20)
        assert len(out) < len(facts)

    def test_single_fact_untouched(self):
        one = [f("a", 1, 9, 10, 0.60)]
        assert merge_insignificant(one, spread=0.1) == one

    def test_zero_spread_is_a_noop(self):
        pair = [f("a", 1, 5, 10, 0.60), f("b", 5, 9, 6, 0.62)]
        assert merge_insignificant(pair, spread=0.0) == pair

    def test_none_median_does_not_crash(self):
        pair = [f("a", 1, 5, 10, None), f("b", 5, 9, 6, 0.62)]
        assert len(merge_insignificant(pair, spread=0.1)) == 2
