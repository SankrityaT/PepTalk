"""Penalty shootouts must not count as open play.

Regression for a real defect: Istanbul 2005 reported 4.93 xG for Liverpool
because eight shootout penalties (6.27 xG across both sides) were being counted
as shots. Any match that went to penalties looked like a shooting gallery.
"""

from tacticbench.state import SHOOTOUT_PERIOD, _team_metrics, drop_shootout


def shot(period, team, xg, minute=10):
    return {
        "type": {"name": "Shot"},
        "period": period,
        "minute": minute,
        "second": 0,
        "team": {"name": team},
        "location": [100.0, 40.0],
        "shot": {"statsbomb_xg": xg, "outcome": {"name": "Goal"}},
    }


def a_pass(period, team):
    return {
        "type": {"name": "Pass"},
        "period": period,
        "minute": 5,
        "second": 0,
        "team": {"name": team},
        "location": [50.0, 40.0],
        "pass": {"end_location": [70.0, 40.0]},
    }


class TestDropShootout:
    def test_removes_only_period_five(self):
        ev = [a_pass(1, "A"), a_pass(3, "A"), shot(SHOOTOUT_PERIOD, "A", 0.76)]
        out = drop_shootout(ev)
        assert len(out) == 2
        assert all(e["period"] != SHOOTOUT_PERIOD for e in out)

    def test_extra_time_is_kept(self):
        # Periods 3 and 4 are extra time — real football, not a shootout.
        ev = [a_pass(3, "A"), a_pass(4, "A")]
        assert len(drop_shootout(ev)) == 2

    def test_empty_input(self):
        assert drop_shootout([]) == []


class TestMetricsExcludeShootout:
    def test_shootout_penalties_do_not_inflate_xg(self):
        ev = [a_pass(1, "A"), shot(2, "A", 0.15)] + [
            shot(SHOOTOUT_PERIOD, "A", 0.76) for _ in range(5)
        ]
        m = _team_metrics(ev, "A", len(ev))
        assert m["shots"] == 1
        assert abs(m["xg"] - 0.15) < 1e-6

    def test_open_play_shots_still_counted(self):
        ev = [a_pass(1, "A"), shot(1, "A", 0.2), shot(4, "A", 0.3)]
        m = _team_metrics(ev, "A", len(ev))
        assert m["shots"] == 2
        assert abs(m["xg"] - 0.5) < 1e-6

    def test_possession_share_recomputed_without_shootout(self):
        # Without exclusion, A's five shootout penalties would inflate its share.
        ev = [a_pass(1, "A"), a_pass(1, "B")] + [
            shot(SHOOTOUT_PERIOD, "A", 0.76) for _ in range(5)
        ]
        m = _team_metrics(ev, "A", len(ev))
        assert m["possession_share_pct"] == 50.0
