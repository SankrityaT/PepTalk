"""Locating moments inside a highlights package by reading its clock.

Pure unit: the OCR itself is not exercised here, only the parsing, the outlier
rule and the mapping built on top of them. Those are where a misread turns
into a wrong clip, and they are what a regression would break silently.
"""

import pytest

from tacticbench.reel import Reading, drop_outliers, locate, parse_clock


class TestParseClock:
    """Strict on purpose: OCR returns junk as confidently as it returns a time."""

    @pytest.mark.parametrize(
        "text,expected",
        [
            ("10:28", 628.0),
            ("51:04", 3064.0),
            ("8:15", 495.0),
            ("  93:07  ", 5587.0),
        ],
    )
    def test_reads_a_real_clock(self, text, expected):
        assert parse_clock(text) == expected

    @pytest.mark.parametrize(
        "text",
        [
            "608121",     # digits ran together, seen on the LAFC reel
            "93:0746",    # trailing garbage from the scoreline beside it
            "",           # nothing legible
            "abc",
            "10:75",      # seconds out of range
            "999:12",     # minutes past anything a match can reach
        ],
    )
    def test_rejects_anything_that_is_not_a_clock(self, text):
        assert parse_clock(text) is None


class TestDropOutliers:
    def test_keeps_a_continuous_run(self):
        rs = [Reading(i * 2.0, 100.0 + i * 2) for i in range(6)]
        assert len(drop_outliers(rs)) == len(rs)

    def test_drops_a_reading_both_neighbours_reject(self):
        rs = [
            Reading(0.0, 100.0),
            Reading(2.0, 102.0),
            Reading(4.0, 9000.0),  # a misread digit
            Reading(6.0, 106.0),
            Reading(8.0, 108.0),
        ]
        kept = drop_outliers(rs)
        assert 9000.0 not in [r.match_s for r in kept]

    def test_keeps_a_genuine_cut(self):
        """A shot boundary disagrees with one neighbour, which is not a misread."""
        rs = [
            Reading(0.0, 100.0),
            Reading(2.0, 102.0),
            Reading(4.0, 3000.0),  # the reel jumps to the second half
            Reading(6.0, 3002.0),
            Reading(8.0, 3004.0),
        ]
        assert len(drop_outliers(rs)) == 5


class TestLocate:
    """The mapping. Getting this wrong is the bug the whole module exists for."""

    def _reel(self):
        # Two passages: 8:00-8:20 early in the reel, 50:00-50:20 later.
        return [Reading(20.0 + i * 2, 480.0 + i * 2) for i in range(11)] + [
            Reading(60.0 + i * 2, 3000.0 + i * 2) for i in range(11)
        ]

    def test_finds_a_moment_inside_a_passage(self):
        assert locate(self._reel(), 490.0) == pytest.approx(30.0, abs=1.0)

    def test_finds_a_moment_in_the_later_passage(self):
        assert locate(self._reel(), 3010.0) == pytest.approx(70.0, abs=1.0)

    def test_a_moment_the_reel_does_not_contain_returns_none(self):
        """The common case for a highlights package, and the honest answer."""
        assert locate(self._reel(), 1500.0) is None

    def test_never_interpolates_across_a_cut(self):
        """Between the two passages is a shot boundary, not a run of play.

        Interpolating there is exactly the error that put a 90th-minute corner
        under a first-half moment.
        """
        assert locate(self._reel(), 1800.0) is None

    def test_no_readings_locates_nothing(self):
        assert locate([], 500.0) is None
