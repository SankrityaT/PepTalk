"""Tests for adding a game: alignment, footage sources, and re-ingest safety.

Pure unit, like the rest of the suite: nothing here touches Docker, StatsBomb,
ffmpeg or the Anthropic API. The subprocess calls are asserted on the command
that would have been run rather than by running it, because what matters is
that a local file takes the ffmpeg branch and a URL takes the yt-dlp one.
"""

import json
from pathlib import Path
from unittest.mock import patch

import pytest

from tacticbench import fetch_clips, snapshots
from tacticbench.find_offsets import BREAK_MAX_S, BREAK_MIN_S, check_offsets, offset_from
from tacticbench.workspace import Workspace


def ws(**kw) -> Workspace:
    base = dict(key="t", team="Argentina", label="Argentina 3-3 France", match_id=1)
    base.update(kw)
    return Workspace(**base)


class TestOffsetArithmetic:
    """The one number nobody can derive, so the arithmetic is worth pinning."""

    def test_worked_example_from_the_docs(self):
        # video 00:12:00 (721s) showed 10:25 (625s) -> 96s, near enough.
        assert offset_from("00:12:00", "10:25") == 95.0
        assert offset_from("01:02:01", "52:02") == 599.0

    def test_accepts_mmss_and_hhmmss(self):
        assert offset_from("12:00", "10:25") == offset_from("00:12:00", "10:25")

    def test_offset_is_video_minus_clock(self):
        assert offset_from("00:10:30", "10:00") == 30.0


class TestOffsetSanityCheck:
    """A misread digit costs sixty seconds of silent misalignment."""

    def test_a_real_pair_passes(self):
        assert check_offsets(96.0, 599.0) is None

    def test_swapped_readings_are_caught(self):
        assert "swapped" in check_offsets(599.0, 96.0)

    def test_break_too_short_is_caught(self):
        msg = check_offsets(96.0, 96.0 + BREAK_MIN_S - 1)
        assert msg and "too short" in msg

    def test_break_too_long_is_caught(self):
        msg = check_offsets(96.0, 96.0 + BREAK_MAX_S + 1)
        assert msg and "too long" in msg

    def test_the_bounds_themselves_pass(self):
        assert check_offsets(0.0, float(BREAK_MIN_S)) is None
        assert check_offsets(0.0, float(BREAK_MAX_S)) is None


class TestVideoSource:
    """An uploaded file and a YouTube id must travel the same path."""

    def test_local_path_is_local(self):
        assert fetch_clips._is_local("/tmp/match.mp4")

    def test_url_is_not_local(self):
        assert not fetch_clips._is_local("https://www.youtube.com/watch?v=x")

    def test_empty_is_not_local(self):
        assert not fetch_clips._is_local("")

    def test_workspace_prefers_the_local_file(self):
        w = ws(video_id="abc", video_path="/tmp/m.mp4")
        assert w.source == "/tmp/m.mp4"
        assert w.is_local

    def test_workspace_falls_back_to_the_url(self):
        w = ws(video_id="abc")
        assert w.source.endswith("watch?v=abc")
        assert not w.is_local

    def test_no_footage_at_all(self):
        assert ws().source == ""


class TestCutWindow:
    def test_local_file_uses_ffmpeg(self, tmp_path, monkeypatch):
        src = tmp_path / "match.mp4"
        src.write_bytes(b"x")
        dest = tmp_path / "out.mp4"
        # Long enough to contain the window; the real probe needs a real file.
        monkeypatch.setattr(fetch_clips, "_duration", lambda p: 600.0)

        with patch("subprocess.run") as run:
            run.return_value.returncode = 0
            dest.write_bytes(b"y")  # pretend ffmpeg produced it
            fetch_clips.cut_window(str(src), 10.0, 20.0, dest, force=True)

        cmd = run.call_args[0][0]
        assert cmd[0] == "ffmpeg"
        assert "-ss" in cmd and "10.00" in cmd
        assert "-to" in cmd and "20.00" in cmd

    def test_window_past_the_end_is_skipped(self, tmp_path, monkeypatch):
        """A ten second file cannot contain minute 45; better nothing than a
        zero-byte clip that renders as a broken player."""
        src = tmp_path / "short.mp4"
        src.write_bytes(b"x")
        monkeypatch.setattr(fetch_clips, "_duration", lambda p: 10.0)
        assert fetch_clips.cut_window(
            str(src), 2700.0, 2710.0, tmp_path / "o.mp4", force=True
        ) is None

    def test_negative_window_is_refused(self, tmp_path, monkeypatch):
        """A moment before the recording starts clamps to an empty window,
        which made ffmpeg abort with `-to value smaller than -ss`."""
        src = tmp_path / "m.mp4"
        src.write_bytes(b"x")
        monkeypatch.setattr(fetch_clips, "_duration", lambda p: 600.0)
        assert fetch_clips.cut_window(
            str(src), -20.0, -5.0, tmp_path / "o.mp4", force=True
        ) is None

    def test_url_uses_yt_dlp(self, tmp_path):
        dest = tmp_path / "out.mp4"

        with patch("subprocess.run") as run:
            run.return_value.returncode = 0
            dest.write_bytes(b"y")
            fetch_clips.cut_window(
                "https://www.youtube.com/watch?v=abc", 10.0, 20.0, dest, force=True
            )

        cmd = run.call_args[0][0]
        assert cmd[0] == "yt-dlp"
        assert "--download-sections" in cmd

    def test_missing_local_file_returns_none(self, tmp_path):
        got = fetch_clips.cut_window(
            str(tmp_path / "nope.mp4"), 0.0, 5.0, tmp_path / "o.mp4", force=True
        )
        assert got is None

    def test_existing_clip_is_reused(self, tmp_path):
        dest = tmp_path / "out.mp4"
        dest.write_bytes(b"already here")
        with patch("subprocess.run") as run:
            got = fetch_clips.cut_window("/tmp/x.mp4", 0.0, 5.0, dest)
        assert got == dest
        run.assert_not_called()


class TestPlanUsesWorkspaceOffsets:
    """Windows are planned against the workspace's own alignment.

    Offsets are looked up per match rather than passed in, so these stub the
    lookup instead of the argument: a squad clip can come from any fixture the
    workspace holds footage for, and each carries its own alignment.
    """

    @pytest.fixture
    def offsets(self, monkeypatch):
        """Pin the offsets `plan` will read for whatever match it is given."""

        def use(mapping):
            monkeypatch.setattr(
                fetch_clips.WS, "offsets_for_match", lambda match_id=None: mapping
            )

        return use

    def test_offsets_are_applied(self, offsets):
        offsets({1: 96.0})
        moments = [{"minute": 10, "second": 0}]
        [w] = fetch_clips.plan(moments)
        assert w.video_s == 10 * 60 + 96.0

    def test_period_without_an_offset_is_skipped(self, offsets):
        # Extra time has a second break, so period 2's offset does not carry.
        # Better no window than one minutes from the play it claims to show.
        offsets({1: 96.0, 2: 599.0})
        moments = [{"minute": 100, "second": 0}]
        assert fetch_clips.plan(moments) == []

    def test_overlapping_windows_merge(self, offsets):
        offsets({1: 96.0})
        moments = [{"minute": 10, "second": 0}, {"minute": 10, "second": 2}]
        assert len(fetch_clips.plan(moments)) == 1

    def test_separate_moments_stay_separate(self, offsets):
        offsets({1: 96.0})
        moments = [{"minute": 10, "second": 0}, {"minute": 40, "second": 0}]
        assert len(fetch_clips.plan(moments)) == 2


class TestWhoseGameItIs:
    """The report belongs to the bench that asked for it.

    Half the flagged moments in any match are the opponent's. Ranking purely
    on value hands the report to whichever side had the louder game — picking
    LAFC in a 1-3 loss returned six Inter Miami moments out of eight, every one
    of them worded "you had this on".
    """

    def _moments(self):
        # Theirs are more valuable, which is the case that broke.
        return [
            {"team": "Inter Miami", "missed": 0.30, "player": "A"},
            {"team": "Inter Miami", "missed": 0.28, "player": "B"},
            {"team": "Inter Miami", "missed": 0.26, "player": "C"},
            {"team": "Inter Miami", "missed": 0.24, "player": "D"},
            {"team": "LAFC", "missed": 0.10, "player": "E"},
            {"team": "LAFC", "missed": 0.09, "player": "F"},
            {"team": "LAFC", "missed": 0.08, "player": "G"},
            {"team": "LAFC", "missed": 0.07, "player": "H"},
        ]

    def test_the_coachs_own_side_leads(self):
        """Every moment they have, even when the opponent's are worth more.

        Only four of theirs exist here, so the most that can be shown is four;
        the failure this guards is taking the top eight by value, which gave
        the LAFC coach six Inter Miami moments and two of their own.
        """
        from tacticbench.bootstrap import _for_bench

        picked = _for_bench(self._moments(), "LAFC", 8)
        ours = sum(1 for m in picked if m["team"] == "LAFC")
        assert ours == 4, "all of the coach's own moments must survive"
        assert ours >= len(picked) - ours, "never fewer than the opponent's"

    def test_own_side_leads_when_there_are_enough_to_choose_from(self):
        from tacticbench.bootstrap import _for_bench

        ms = self._moments() + [
            {"team": "LAFC", "missed": 0.06, "player": "I"},
            {"team": "LAFC", "missed": 0.05, "player": "J"},
        ]
        picked = _for_bench(ms, "LAFC", 8)
        ours = sum(1 for m in picked if m["team"] == "LAFC")
        assert ours > len(picked) - ours, "the coach's own side must lead"

    def test_the_same_match_mirrors_for_the_other_bench(self):
        from tacticbench.bootstrap import _for_bench

        a = _for_bench(self._moments(), "LAFC", 8)
        b = _for_bench(self._moments(), "Inter Miami", 8)
        assert sum(1 for m in a if m["team"] == "LAFC") == sum(
            1 for m in b if m["team"] == "Inter Miami"
        )

    def test_the_opponent_is_never_dropped_entirely(self):
        """Their chances are the defensive half of the report, not noise."""
        from tacticbench.bootstrap import _for_bench

        picked = _for_bench(self._moments(), "LAFC", 8)
        assert any(m["team"] == "Inter Miami" for m in picked)

    def test_holds_for_any_split_of_any_match(self):
        """The invariants, over every shape a real fixture can take.

        Hand-picked cases pass easily; the ratio was quietly wrong at small
        `top` (round(4 * 0.625) == 2 split a four-moment report evenly) and the
        backfill double-counted, returning more moments than asked for. Both
        survived two hand-checked matches and fell over here.
        """
        import math
        import random

        from tacticbench.bootstrap import _for_bench

        rng = random.Random(11)
        for _ in range(3000):
            n_ours = rng.randint(0, 40)
            n_theirs = rng.randint(0, 40)
            top = rng.randint(1, 20)
            ms = [{"team": "US", "missed": rng.random()} for _ in range(n_ours)]
            ms += [{"team": "THEM", "missed": rng.random()} for _ in range(n_theirs)]
            ms.sort(key=lambda m: -m["missed"])

            picked = _for_bench(ms, "US", top)
            ours = sum(1 for m in picked if m["team"] == "US")
            theirs = len(picked) - ours
            avail = min(top, n_ours + n_theirs)
            case = f"{n_ours} ours / {n_theirs} theirs / top {top}"

            assert len(picked) == avail, f"wrong count: {case}"
            assert len(picked) == len({id(m) for m in picked}), f"duplicate: {case}"
            if n_ours >= top:
                assert ours > theirs, f"own side starved: {case}"
            # As many of ours as the share allows, given what exists.
            want = min(n_ours, max(1, math.ceil(top * 0.625)))
            want = min(n_ours, max(want, top - n_theirs))
            assert ours >= min(want, avail), f"dropped ours: {case}"

    def test_a_quiet_side_still_fills_the_report(self):
        from tacticbench.bootstrap import _for_bench

        only_theirs = [m for m in self._moments() if m["team"] == "Inter Miami"]
        assert len(_for_bench(only_theirs, "LAFC", 4)) == 4

    def test_opponent_moments_are_reworded(self):
        """"You had this on" addressed to the wrong bench is nonsense."""
        from tacticbench.bootstrap import _write_sides

        lines = [
            {
                "team": "Inter Miami",
                "line": "You had the ball in the box on.",
                "best_zone": "in the box",
                "best_defenders": 2,
                "best_completion": 0.7,
            },
            {"team": "LAFC", "line": "You had the ball in the box on.",
             "best_zone": "in the box", "best_defenders": 1, "best_completion": 0.8},
        ]
        out = _write_sides(lines, "LAFC")
        theirs = next(m for m in out if m["team"] == "Inter Miami")
        mine = next(m for m in out if m["team"] == "LAFC")

        assert theirs["side"] == "defending"
        assert theirs["line"].startswith("They had")
        assert "of yours" in theirs["line"]

        assert mine["side"] == "attacking"
        assert mine["line"].startswith("You had")


class TestFixturesOffered:
    """Only fixtures that can actually be analysed reach the picker.

    `match_available_360` is a competition-level flag and is not true of every
    match under it: AFCON carries it and 51 of its 52 fixtures 404 on the
    three-sixty feed. Offering one means a coach picks a game, waits, and is
    told it cannot be done.
    """

    def test_the_index_filters_out_matches_without_a_file(self, monkeypatch):
        from tacticbench import games

        monkeypatch.setattr(games, "_fixtures_cache", None)
        monkeypatch.setattr(games, "_matches_with_360", lambda: {1, 3})
        monkeypatch.setattr(
            games.data,
            "competitions",
            lambda c: [
                {
                    "competition_id": 9,
                    "season_id": 1,
                    "competition_name": "Test",
                    "season_name": "2023",
                    "match_available_360": True,
                }
            ],
        )
        monkeypatch.setattr(
            games.data,
            "matches",
            lambda c, ci, si: [
                {
                    "match_id": i,
                    "match_date": "2023-01-01",
                    "home_team": {"home_team_name": "A"},
                    "away_team": {"away_team_name": "B"},
                    "home_score": 1,
                    "away_score": 0,
                }
                for i in (1, 2, 3)
            ],
        )
        got = {f["match_id"] for f in games._fixtures()}
        assert got == {1, 3}, "match 2 has no 360 file and must not be offered"

    def test_an_unreachable_index_falls_back_rather_than_offering_nothing(
        self, monkeypatch
    ):
        from tacticbench import games

        monkeypatch.setattr(games, "_fixtures_cache", None)
        monkeypatch.setattr(games, "_matches_with_360", lambda: set())
        monkeypatch.setattr(
            games.data,
            "competitions",
            lambda c: [
                {
                    "competition_id": 9,
                    "season_id": 1,
                    "competition_name": "Test",
                    "season_name": "2023",
                    "match_available_360": True,
                }
            ],
        )
        monkeypatch.setattr(
            games.data,
            "matches",
            lambda c, ci, si: [
                {
                    "match_id": 7,
                    "match_date": "2023-01-01",
                    "home_team": {"home_team_name": "A"},
                    "away_team": {"away_team_name": "B"},
                    "home_score": 1,
                    "away_score": 0,
                }
            ],
        )
        assert len(games._fixtures()) == 1


class TestShortFootage:
    """Footage that is not a full match gets no clips, and says so.

    There was a "reel mode" that divided a highlights package evenly and gave
    each moment a slice. It was withdrawn: measured against the LAFC reel the
    overlay reads 08:12 at thirty seconds, 51:04 at ninety and 93:07 at four
    and a half minutes, so an even spread is right only by luck. It put a wide
    establishing shot under "Vela, 5:05".
    """

    def test_a_reel_yields_no_clips(self, monkeypatch, tmp_path):
        from tacticbench import bootstrap

        video = tmp_path / "reel.mp4"
        video.write_bytes(b"x")
        monkeypatch.setattr(bootstrap.fetch_clips, "_duration", lambda p: 300.0)
        got = bootstrap.cut_clips(
            ws(key="r", video_path=str(video)),
            [{"minute": 9, "second": 49, "player": "A B"}],
        )
        assert got == []

    def test_a_full_broadcast_still_cuts(self, monkeypatch, tmp_path):
        """The guard must not swallow the case it was never about."""
        from tacticbench import bootstrap

        video = tmp_path / "match.mp4"
        video.write_bytes(b"x")
        monkeypatch.setattr(bootstrap.fetch_clips, "_duration", lambda p: 2 * 60 * 60)
        monkeypatch.setattr(
            bootstrap.fetch_clips,
            "cut_window",
            lambda src, s, e, dest, force=False: dest,
        )
        monkeypatch.setattr(
            bootstrap.fetch_clips.WS, "offsets_for_match", lambda match_id=None: {1: 96.0}
        )
        got = bootstrap.cut_clips(
            ws(key="b", video_path=str(video), period_offset={1: 96.0}),
            [{"minute": 9, "second": 49, "player": "A B"}],
        )
        assert len(got) == 1

    def test_the_threshold_is_between_a_reel_and_a_match(self):
        from tacticbench.bootstrap import REEL_MAX_S

        assert 7 * 60 < REEL_MAX_S < 2 * 60 * 60


class TestMomentSeconds:
    """Seconds must survive into the written moment.

    The clip window is computed from minute AND second. Dropping the second
    rounds every moment to the top of its minute, so the cut lands up to 59
    seconds from the pass it claims to show — silently, with plausible-looking
    footage on screen. Exactly what the offsets exist to prevent.
    """

    def test_describe_keeps_the_second(self):
        from tacticbench.pep import describe

        moment = {
            "minute": 8,
            "second": 25,
            "player": "Rodrigo De Paul",
            "team": "Argentina",
            "played": {"x": 100.0, "y": 60.0, "xt_gain": 0.02, "completion": 0.8,
                       "defenders_in_lane": 1, "distance": 20.0},
            "best": {"x": 108.0, "y": 46.0, "xt_gain": 0.15, "completion": 0.83,
                     "defenders_in_lane": 1, "distance": 24.0},
            "missed": 0.104,
        }
        assert describe(moment)["second"] == 25

    def test_a_missing_second_is_zero_not_absent(self):
        from tacticbench.pep import describe

        moment = {
            "minute": 8,
            "player": "X Y",
            "team": "A",
            "played": {"x": 100.0, "y": 60.0, "xt_gain": 0.02, "completion": 0.8,
                       "defenders_in_lane": 1, "distance": 20.0},
            "best": {"x": 108.0, "y": 46.0, "xt_gain": 0.15, "completion": 0.83,
                     "defenders_in_lane": 1, "distance": 24.0},
            "missed": 0.104,
        }
        assert describe(moment)["second"] == 0


class TestSnapshots:
    def test_moment_without_footage_is_kept(self):
        """A failed download must not lose the moment; the freeze frame stands."""
        pep = {"moments": [{"id": 0, "minute": 10, "second": 0, "player": "Lionel Messi"}]}
        out = snapshots.clip_moments(ws(period_offset={1: 96.0}), pep, [])
        assert len(out["moments"]) == 1
        assert "clip" not in out["moments"][0]

    def test_moment_is_joined_to_its_clip(self):
        pep = {"moments": [{"id": 0, "minute": 10, "second": 0, "player": "Lionel Messi"}]}
        clips = [
            {
                "key": "010_00",
                "start": 690.0,
                "end": 700.0,
                "file": "/tmp/clips/t_010_00.mp4",
                "offset_in_clip": 6.0,
            }
        ]
        out = snapshots.clip_moments(ws(period_offset={1: 96.0}), pep, clips)
        m = out["moments"][0]
        # Namespaced by workspace, so an added game cannot overwrite the
        # committed example's footage.
        assert m["clip"] == "/clips/t/t_010_00.mp4"
        # video time is 10*60 + 96 = 696, six seconds into a window from 690.
        assert m["pass_at"] == 6.0

    def test_merged_window_still_finds_the_later_moment(self):
        """Two passes seconds apart share one clip, at different offsets."""
        pep = {
            "moments": [
                {"id": 0, "minute": 10, "second": 0, "player": "A B"},
                {"id": 1, "minute": 10, "second": 4, "player": "C D"},
            ]
        }
        clips = [
            {"key": "010_00", "start": 690.0, "end": 710.0,
             "file": "/tmp/c.mp4", "offset_in_clip": 6.0}
        ]
        out = snapshots.clip_moments(ws(period_offset={1: 96.0}), pep, clips)
        assert out["moments"][0]["pass_at"] == 6.0
        assert out["moments"][1]["pass_at"] == 10.0

    @pytest.mark.parametrize(
        "full,expected",
        [
            # Particles bind forward: "Paul" and "Muani" are the loudest
            # mistakes this page can make.
            ("Rodrigo De Paul", "De Paul"),
            ("Randal Kolo Muani", "Kolo Muani"),
            ("Virgil van Dijk", "van Dijk"),
            ("Ángel Di María", "Di María"),
            # Four tokens: a given name, a middle name and two surnames, so
            # the first of the pair is the one used.
            ("Lionel Andrés Messi Cuccittini", "Messi"),
            ("Randall Enrique Leal Arley", "Leal"),
            # Three is ambiguous between a double surname ("Alba Ramos") and an
            # ordinary middle name ("Emiliano Martínez"), and the middle name
            # wins three to nothing in the squads shipped here. Taking the last
            # token gets Martínez and Otamendi right and Alba wrong; a nickname
            # settles it wherever StatsBomb populates one.
            ("Jordi Alba Ramos", "Ramos"),
            ("Damián Emiliano Martínez", "Martínez"),
            ("Nicolás Hernán Otamendi", "Otamendi"),
            # A Catalan connective marks the name before it.
            ("Sergio Busquets i Burgos", "Busquets"),
            # Ordinary two-part names are untouched.
            ("Robert Taylor", "Taylor"),
            ("Emiliano Martínez", "Martínez"),
            ("DeAndre Yedlin", "Yedlin"),
            # Degenerate input must not raise.
            ("", ""),
            ("Pelé", "Pelé"),
        ],
    )
    def test_surname_is_what_a_coach_says(self, full, expected):
        assert snapshots.surname(full) == expected

    def test_dashboard_reports_the_coachs_side(self):
        metrics = {"Argentina": {"possession_share_pct": 53.8, "xg": 2.758, "shots": 20}}
        meta = {
            "home_team": {"home_team_name": "Argentina"},
            "away_team": {"away_team_name": "France"},
            "home_score": 3, "away_score": 3,
        }
        out = snapshots.dashboard(ws(), metrics, meta, "Argentina 3-3 France", "2022-12-18")
        assert out["team"] == "Argentina"
        assert out["matches"][0]["poss"] == 53.8
        assert out["matches"][0]["home"] is True

    def test_every_snapshot_names_its_producer(self):
        """The convention the committed snapshots set: say what made you."""
        metrics = {"Argentina": {}}
        meta = {
            "home_team": {"home_team_name": "Argentina"},
            "away_team": {"away_team_name": "France"},
            "home_score": 3, "away_score": 3,
        }
        assert snapshots.dashboard(ws(), metrics, meta, "l", "2022-12-18")["source"]
        assert snapshots.clip_moments(ws(), {"moments": []}, [])["source"]


class TestFreezeFrameGuard:
    """The failure that looks like a quiet game and is really a broken join.

    Some competitions publish a 360 file whose event_uuids match nothing in the
    match feed. Every lookup misses, every pass is skipped, and the run
    finishes cleanly with zero moments — which reads as "nothing happened"
    rather than "this data is unusable". Caught before the work, not after.
    """

    def _events(self, n: int, ids: list[str]) -> list[dict]:
        return [{"type": {"name": "Pass"}, "id": i} for i in ids] + [
            {"type": {"name": "Carry"}, "id": f"c{k}"} for k in range(n)
        ]

    def test_mismatched_uuids_are_refused(self, monkeypatch):
        from tacticbench import bootstrap

        monkeypatch.setattr(bootstrap, "has_360", lambda mid: True)
        monkeypatch.setattr(
            "tacticbench.pass_options.load_360",
            lambda mid: {f"frame{i}": {} for i in range(50)},
        )
        events = self._events(5, [f"pass{i}" for i in range(20)])

        with pytest.raises(bootstrap.BootstrapError) as exc:
            bootstrap.check_360(1, events)
        assert "does not line up" in str(exc.value)
        assert "0 of 20" in str(exc.value)

    def test_healthy_coverage_passes(self, monkeypatch):
        from tacticbench import bootstrap

        ids = [f"pass{i}" for i in range(20)]
        monkeypatch.setattr(bootstrap, "has_360", lambda mid: True)
        # 16 of 20, near the ~79% a real match carries.
        monkeypatch.setattr(
            "tacticbench.pass_options.load_360", lambda mid: {i: {} for i in ids[:16]}
        )
        out = bootstrap.check_360(1, self._events(5, ids))
        assert out["coverage"] == 0.8
        assert out["passes"] == 20

    def test_missing_360_is_refused_first(self, monkeypatch):
        from tacticbench import bootstrap

        monkeypatch.setattr(bootstrap, "has_360", lambda mid: False)
        with pytest.raises(bootstrap.BootstrapError) as exc:
            bootstrap.check_360(1, self._events(5, ["a"]))
        assert "no 360 data" in str(exc.value)


class TestLoadSeries:
    """Where a team's history is read from, which decides what gets replaced.

    `ingest_team` clears a team's facts before rewriting them, so a series
    that reads as empty when it is not would delete real history and put
    nothing back. Barcelona's 531 matches live only in `all_series.json`.
    """

    def test_an_unseen_side_raises_by_default(self, tmp_path, monkeypatch):
        """A norm built from an empty series is a confident wrong answer.

        So the caller has to say it expects nothing rather than being handed
        an empty list it might segment eras from.
        """
        from tacticbench import graph

        monkeypatch.setattr(graph, "RESULTS", tmp_path)
        with pytest.raises(FileNotFoundError):
            graph.load_series("Nobody FC")

    def test_adding_a_first_game_asks_for_the_empty_case(self, tmp_path, monkeypatch):
        """`bootstrap` passes missing_ok: a side nobody has ingested is normal."""
        from tacticbench import graph

        monkeypatch.setattr(graph, "RESULTS", tmp_path)
        assert graph.load_series("Nobody FC", missing_ok=True) == []

    def test_per_team_file_is_read(self, tmp_path, monkeypatch):
        from tacticbench import graph

        monkeypatch.setattr(graph, "RESULTS", tmp_path)
        (tmp_path / "series_real_madrid.json").write_text(
            json.dumps(
                [
                    {
                        "match_id": 1,
                        "date": "2011-01-01",
                        "competition": "La Liga",
                        "label": "A 1-0 B",
                        "metrics": {},
                    }
                ]
            )
        )
        assert len(graph.load_series("Real Madrid")) == 1

    def test_falls_back_to_the_combined_file(self, tmp_path, monkeypatch):
        """The bulk pass writes only all_series.json, and no per-team files."""
        from tacticbench import graph

        monkeypatch.setattr(graph, "RESULTS", tmp_path)
        (tmp_path / "all_series.json").write_text(
            json.dumps(
                {
                    "Barcelona": [
                        {
                            "match_id": i,
                            "date": f"2011-01-{i:02d}",
                            "competition": "La Liga",
                            "label": "A 1-0 B",
                            "metrics": {},
                        }
                        for i in range(1, 4)
                    ]
                }
            )
        )
        assert len(graph.load_series("Barcelona")) == 3
        assert graph.load_series("Nobody FC", missing_ok=True) == []


class TestWorkspacePaths:
    def test_snapshots_live_under_the_workspace(self):
        """Never in src/content/snapshots, which a fresh clone renders from."""
        assert ws(key="mls23").snapshots.name == "snapshots"
        assert ws(key="mls23").snapshots.parent.name == "mls23"


class TestClearTeamFactsCypher:
    """The Cypher must stay inside HydraDB's subset.

    Same approach as test_conversation.py: assert on the query strings, since
    the constraints are what break rather than the logic.
    """

    def _queries(self, fn) -> list[str]:
        seen: list[str] = []

        class FakeGraph:
            def run(self, query, **params):
                seen.append(query)
                return []

        from tacticbench.graph import Graph

        fn(Graph.clear_team_facts, FakeGraph())
        return seen

    def test_no_unsupported_clauses(self):
        queries = self._queries(lambda f, g: f(g, 42))
        assert queries, "expected at least the lookup query"
        for q in queries:
            assert " IN " not in q, "HydraDB rejects IN"
            assert "IS NULL" not in q, "HydraDB rejects IS NULL"
            assert "CONTAINS" not in q, "HydraDB rejects CONTAINS"
            assert "WITH " not in q, "WITH is pass-through only"
            assert ";" not in q, "one statement per request"

    def test_nodes_are_named_not_anonymous(self):
        # `MATCH (:Fact)` is rejected; nodes must carry a name.
        for q in self._queries(lambda f, g: f(g, 42)):
            assert "(:Fact" not in q

    def test_it_deletes_relationships_too(self):
        """DETACH takes the SUPERSEDED_BY chain and citations with it."""
        seen: list[str] = []

        class FakeGraph:
            def run(self, query, **params):
                seen.append(query)
                return [{"id": 1}] if "RETURN" in query else []

        from tacticbench.graph import Graph

        Graph.clear_team_facts(FakeGraph(), 42)
        assert any("DETACH DELETE" in q for q in seen)


class TestIngestReplacesByDefault:
    def test_facts_are_cleared_before_writing(self):
        """Re-adding a game must replace its facts, not lay a second chain."""
        from tacticbench.graph import Graph

        calls = {"cleared": 0}

        class FakeGraph:
            def clear_team_facts(self, team_id):
                calls["cleared"] += 1
                return 3

            def ingest_matches(self, team, team_id, series):
                return len(series)

            def run(self, query, **params):
                return []

        out = Graph.ingest_team(FakeGraph(), "Argentina", 1, [], {})
        assert calls["cleared"] == 1
        assert out["cleared"] == 3

    def test_replace_can_be_turned_off(self):
        from tacticbench.graph import Graph

        calls = {"cleared": 0}

        class FakeGraph:
            def clear_team_facts(self, team_id):
                calls["cleared"] += 1
                return 0

            def ingest_matches(self, team, team_id, series):
                return 0

            def run(self, query, **params):
                return []

        Graph.ingest_team(FakeGraph(), "Argentina", 1, [], {}, replace=False)
        assert calls["cleared"] == 0


class TestMomentsWithoutFootage:
    """A moment the video does not cover still has to render.

    On a highlights reel most moments are not in the footage at all — 21 of 26
    on the reel this was written against. The interface reads `frames.length`
    to decide how much tracking it has, so a moment missing the key entirely
    took the whole dashboard down with it rather than quietly showing no boxes.
    """

    def test_every_moment_carries_frames_with_no_clips(self):
        pep = {
            "moments": [
                {"minute": 5, "second": 5, "team": "LAFC", "missed": 0.2},
                {"minute": 88, "second": 0, "team": "LAFC", "missed": 0.1},
            ]
        }
        rows = snapshots.clip_moments(ws(key="lafc", team="LAFC"), pep, clips=[], tracks={})
        rows = rows.get("moments") if isinstance(rows, dict) else rows
        assert len(rows) == 2
        for row in rows:
            assert row["frames"] == []
            assert row["detections"] == 0
            # No footage means no clip to point at, rather than a dead link.
            assert "clip" not in row

    def test_a_tracked_moment_still_gets_its_frames(self):
        """The default must not shadow real tracking."""
        pep = {"moments": [{"minute": 13, "second": 2, "team": "LAFC", "missed": 0.3}]}
        clips = [{"key": "013_02", "file": "/tmp/lafc_013_02.mp4", "start": 1.0, "end": 9.0}]
        tracks = {"013_02": {"frames": [{"t": 0.0}, {"t": 1.5}], "detections": 7}}
        rows = snapshots.clip_moments(ws(key="lafc", team="LAFC"), pep, clips, tracks)
        rows = rows.get("moments") if isinstance(rows, dict) else rows
        assert len(rows[0]["frames"]) == 2
        assert rows[0]["detections"] == 7


class TestPublishingClips:
    """What is published is what this run stands behind, and nothing else."""

    def test_footage_from_an_earlier_run_is_removed(self, tmp_path, monkeypatch):
        published = tmp_path / "clips"
        monkeypatch.setattr(snapshots, "PUBLIC_CLIPS", published)
        stale = published / "lafc"
        stale.mkdir(parents=True)
        # Cut for a moment an earlier run found and this one did not.
        (stale / "lafc_095_11.mp4").write_bytes(b"old")

        src = tmp_path / "lafc_013_02.mp4"
        src.write_bytes(b"new")
        n = snapshots.publish_clips([{"key": "013_02", "file": str(src)}], "lafc")

        assert n == 1
        assert {p.name for p in stale.glob("*.mp4")} == {"lafc_013_02.mp4"}


class TestTrackedFrameFloor:
    """How few players a frame may hold and still be worth drawing.

    The floor used to be eight, which meant a camera tight on the build-up to
    a pass produced no boxes at all: on the 13:02 clip that silently discarded
    31 of 50 frames — every one of them real football — and the overlay stayed
    blank until the shot went wide, then snapped on. Two kits can be told apart
    from about four players, so four is the floor.
    """

    def test_the_floor_admits_a_tight_camera(self):
        from tacticbench.cv_video import MIN_TRACKED

        assert MIN_TRACKED <= 4, "a six-player frame is football, not noise"

    def test_team_clustering_agrees_with_the_floor(self):
        """A frame kept by the tracker must not be blanked by the clusterer.

        These are two separate gates on the same frames. When they disagree the
        tracker keeps a frame and the clusterer labels every box `OTHER`, which
        is dropped downstream — so the frame survives with nothing drawn on it,
        the most confusing of the three outcomes.
        """
        import inspect

        from tacticbench.cv import assign_teams_per_frame
        from tacticbench.cv_video import MIN_TRACKED

        floor = inspect.signature(assign_teams_per_frame).parameters["min_players"].default
        assert floor <= MIN_TRACKED

    def test_a_small_frame_still_gets_teams(self):
        import numpy as np

        from tacticbench.cv import OTHER, assign_teams_per_frame

        # Five players: three in a light kit, two in a dark one.
        colours = np.array(
            [[210.0, 210.0, 210.0], [205.0, 208.0, 212.0], [212.0, 205.0, 209.0],
             [30.0, 32.0, 35.0], [28.0, 30.0, 33.0]]
        )
        labels = assign_teams_per_frame([colours])[0]
        assert len(labels) == 5
        assert not (labels == OTHER).all(), "a five-player frame was blanked"
        assert set(labels.tolist()) >= {0, 1}, "both kits should be found"


class TestWhichGameOpens:
    """Argentina on open; an upload switches; the sidebar switches back.

    The built-in World Cup game is the front door. It is the only game that
    exists before anyone has uploaded anything, and it is what a first-time
    visitor is meant to meet. Adding a match moves the interface to it and the
    switcher moves back, but neither changes what a fresh start shows.
    """

    def test_loading_a_workspace_ignores_what_is_on_screen(self, monkeypatch, tmp_path):
        """A rebuild acts on what it was told, not on the last thing clicked.

        These are two different questions, and a version that answered them
        with one value made whichever game had been opened last into the
        default target for every later command.
        """
        from tacticbench import workspace as ws_mod

        pointer = tmp_path / ".active"
        pointer.write_text("some-uploaded-game\n")
        monkeypatch.setattr(ws_mod, "POINTER", pointer)
        monkeypatch.delenv(ws_mod.ENV_VAR, raising=False)

        assert ws_mod.showing() == "some-uploaded-game"
        assert ws_mod.load().key == ws_mod.DEFAULT

    def test_an_explicit_key_still_wins(self, monkeypatch, tmp_path):
        from tacticbench import workspace as ws_mod

        pointer = tmp_path / ".active"
        pointer.write_text("some-uploaded-game\n")
        monkeypatch.setattr(ws_mod, "POINTER", pointer)
        monkeypatch.setenv(ws_mod.ENV_VAR, ws_mod.DEFAULT)
        assert ws_mod.load().key == ws_mod.DEFAULT

    def test_no_pointer_is_not_an_error(self, monkeypatch, tmp_path):
        """A fresh clone has never activated anything."""
        from tacticbench import workspace as ws_mod

        monkeypatch.setattr(ws_mod, "POINTER", tmp_path / "nothing-here")
        assert ws_mod.showing() is None
        monkeypatch.delenv(ws_mod.ENV_VAR, raising=False)
        assert ws_mod.load().key == ws_mod.DEFAULT

    def test_the_start_script_opens_on_the_example(self):
        """The dev/build entry point must not consult the pointer at all."""
        script = Path("scripts/use-workspace.mjs").read_text()
        assert "wc2022" in script
        assert "lastUsed" not in script, "a restart must not reopen the last game"


class TestLandingAfterAddingAGame:
    """Finishing the pipeline puts the coach on their new game's dashboard.

    They uploaded a match to see it analysed. A summary screen in between is
    one more click before the thing they asked for, and the dashboard is where
    every other game is read.
    """

    def test_the_pipeline_activates_before_it_reports_ready(self):
        """Order matters: the redirect is only correct if `active/` is already
        pointed at the new game when the job says it is finished."""
        src = Path("src/tacticbench/bootstrap.py").read_text()
        activate_at = src.index("snapshots.activate(ws.key)")
        returns_at = src.index('return {\n        "workspace": ws.key', activate_at - 4000)
        assert activate_at < returns_at

    def test_finishing_sends_the_coach_to_the_dashboard(self):
        page = Path("src/app/dashboard/page.tsx").read_text()
        # Just the onDone handler, not the JSX around it.
        at = page.index("<Watching")
        block = page[at : page.index("onFailed={setError}", at)]
        assert "window.location.reload()" in block, (
            "a finished upload must land on the dashboard, not a summary screen"
        )
        # Deliberately a full document load, not a client-side push: the
        # snapshots are static imports, so a push would keep the current
        # bundle and render the previous game's data under the new game's
        # name. Asserting the absence of `router.push` is not possible here —
        # the comment in the source explaining that choice contains the words.
