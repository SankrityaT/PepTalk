"""Tests for the graph layer's pure logic.

Anything touching a live HydraDB node is deliberately excluded — these run
without Docker.
"""

from tacticbench.graph import MatchMetrics, date_ord, facts_for_team
from tacticbench.temporal import OPEN_ENDED


def mm(match_id, date, **metrics):
    base = {
        "press_height": 50.0,
        "defensive_action_height": 50.0,
        "team_width": 20.0,
        "pass_forward_ratio": 0.5,
        "possession_share_pct": 50.0,
    }
    base.update(metrics)
    return MatchMetrics(
        match_id=match_id, date=date, competition="Test League",
        label=f"A 1-0 B ({match_id})", metrics=base,
    )


class TestDateOrd:
    def test_monotonic(self):
        assert date_ord("2011-03-01") < date_ord("2021-03-01")

    def test_tolerates_timestamp_suffix(self):
        assert date_ord("2011-03-01T20:45:00") == date_ord("2011-03-01")


class TestFactsForTeam:
    def _series(self, values, dim="press_height"):
        return [
            mm(i, f"2010-{1 + i // 28:02d}-{1 + i % 28:02d}", **{dim: v})
            for i, v in enumerate(values)
        ]

    def test_below_minimum_history_yields_no_facts(self):
        out = facts_for_team(self._series([50.0] * 5))
        assert "press_height" not in out

    def test_stable_team_yields_single_open_era(self):
        out = facts_for_team(self._series([50.0] * 20))
        facts = out["press_height"]
        assert len(facts) == 1
        assert facts[0].valid_to == OPEN_ENDED

    def test_sustained_shift_produces_multiple_eras(self):
        # Thresholds are quantile-derived, so a genuine two-regime series splits.
        out = facts_for_team(self._series([65.0] * 15 + [35.0] * 15))
        facts = out["press_height"]
        assert len(facts) >= 2
        assert facts[0].band != facts[-1].band
        assert facts[-1].valid_to == OPEN_ENDED

    def test_eras_are_contiguous(self):
        out = facts_for_team(self._series([65.0] * 15 + [35.0] * 15))
        facts = out["press_height"]
        for a, b in zip(facts, facts[1:]):
            assert a.valid_to == b.valid_from

    def test_none_metrics_are_skipped(self):
        series = self._series([50.0] * 20)
        for m in series[:5]:
            m.metrics["press_height"] = None
        out = facts_for_team(series)
        assert sum(f.observations for f in out["press_height"]) == 15

    def test_all_dimensions_attempted(self):
        out = facts_for_team(self._series([50.0] * 20))
        # Constant series still produce one era per dimension.
        assert set(out) == {
            "press_height", "defensive_action_height", "team_width",
            "pass_forward_ratio", "possession_share_pct",
        }
