"""Tests for the vision module's pure logic — no video, no model, no network."""

import numpy as np

from tacticbench.cv import (
    PITCH_LENGTH_M,
    PITCH_WIDTH_M,
    PlayerObservation,
    invert_homography,
    is_pitch_view,
    on_pitch,
    pitch_fraction,
    plausible_player_box,
    project_foot,
    tactical_state,
    torso_colours,
)


class TestPlausiblePlayerBox:
    def test_typical_player_accepted(self):
        # Median YOLO detection on 720p broadcast: 36 wide, 90 tall.
        assert plausible_player_box([100, 100, 136, 190])

    def test_wide_grass_box_rejected(self):
        # The 671px-wide MaskRCNN box from frame 344 that poisoned clustering.
        assert not plausible_player_box([100, 400, 771, 560])

    def test_wider_than_tall_rejected(self):
        assert not plausible_player_box([100, 100, 200, 140])

    def test_too_small_rejected(self):
        assert not plausible_player_box([100, 100, 104, 110])

    def test_zero_width_does_not_crash(self):
        assert not plausible_player_box([100, 100, 100, 190])


class TestOnPitch:
    def test_centre_is_on(self):
        assert on_pitch(0.0, 0.0)

    def test_corner_is_on(self):
        assert on_pitch(PITCH_LENGTH_M / 2 - 1, PITCH_WIDTH_M / 2 - 1)

    def test_far_outside_rejected(self):
        assert not on_pitch(200.0, 0.0)
        assert not on_pitch(0.0, 90.0)

    def test_small_margin_tolerated(self):
        # Touchline detections sit fractionally outside; that is real.
        assert on_pitch(PITCH_LENGTH_M / 2 + 2, 0.0)


class TestCoordinateConversion:
    def test_centre_maps_to_pitch_centre(self):
        o = PlayerObservation(frame=0, x_m=0.0, y_m=0.0)
        assert abs(o.x_sb - 60.0) < 1e-6
        assert abs(o.y_sb - 40.0) < 1e-6

    def test_own_goal_line_maps_to_zero(self):
        o = PlayerObservation(frame=0, x_m=-PITCH_LENGTH_M / 2, y_m=0.0)
        assert abs(o.x_sb - 0.0) < 1e-6

    def test_opposition_goal_line_maps_to_length(self):
        o = PlayerObservation(frame=0, x_m=PITCH_LENGTH_M / 2, y_m=0.0)
        assert abs(o.x_sb - 120.0) < 1e-6

    def test_monotonic_upfield(self):
        a = PlayerObservation(0, -20.0, 0.0).x_sb
        b = PlayerObservation(0, 20.0, 0.0).x_sb
        assert a < b


class TestHomography:
    def test_identity_inverts_to_identity(self):
        Hi = invert_homography([1, 0, 0, 0, 1, 0, 0, 0, 1])
        assert np.allclose(Hi, np.eye(3))

    def test_singular_returns_none(self):
        assert invert_homography([1, 1, 1, 1, 1, 1, 1, 1, 1]) is None

    def test_project_foot_uses_bottom_centre(self):
        # Identity transform: the projected point is the box's bottom centre.
        x, y = project_foot(np.eye(3), [100, 50, 140, 200])
        assert abs(x - 120.0) < 1e-6
        assert abs(y - 200.0) < 1e-6


class TestPitchView:
    def _solid(self, bgr):
        f = np.zeros((60, 80, 3), dtype=np.uint8)
        f[:, :] = bgr
        return f

    def test_green_frame_is_pitch(self):
        assert is_pitch_view(self._solid((60, 160, 70)))

    def test_white_frame_is_not_pitch(self):
        # The Premier League logo wipe that produced 18 phantom detections.
        assert not is_pitch_view(self._solid((250, 250, 250)))

    def test_dark_frame_is_not_pitch(self):
        assert not is_pitch_view(self._solid((10, 10, 10)))

    def test_fraction_between_zero_and_one(self):
        assert 0.0 <= pitch_fraction(self._solid((60, 160, 70))) <= 1.0


class TestTorsoColours:
    def test_samples_torso_not_whole_box(self):
        # Box [90,100]-[110,200]: w=20 h=100, so the sampled torso band is
        # y 115..145 (TORSO_TOP/BOTTOM) and x 96..104 (TORSO_INSET).
        frame = np.zeros((250, 250, 3), dtype=np.uint8)
        frame[:, :] = (0, 255, 0)              # grass everywhere
        frame[110:150, 94:106] = (255, 0, 0)   # blue kit covering the whole band
        out = torso_colours(frame, [[90, 100, 110, 200]])
        # Blue channel dominates green: we sampled kit, not pitch.
        assert out[0][0] > out[0][1]

    def test_whole_box_would_have_sampled_grass(self):
        # The same box with only a small torso patch stays grass-dominated,
        # which is what went wrong before the inset was added.
        frame = np.zeros((250, 250, 3), dtype=np.uint8)
        frame[:, :] = (0, 255, 0)
        frame[118:122, 99:101] = (255, 0, 0)
        out = torso_colours(frame, [[90, 100, 110, 200]])
        assert out[0][1] > out[0][0]

    def test_degenerate_box_returns_zeros(self):
        frame = np.zeros((50, 50, 3), dtype=np.uint8)
        out = torso_colours(frame, [[10, 10, 10, 10]])
        assert list(out[0]) == [0.0, 0.0, 0.0]


class TestTacticalState:
    def _obs(self, n, x=0.0, team=0):
        return [PlayerObservation(frame=i, x_m=x, y_m=float(i % 10 - 5), team=team) for i in range(n)]

    def test_too_few_observations_returns_empty(self):
        assert tactical_state(self._obs(3)) == {}

    def test_marks_source_as_cv(self):
        assert tactical_state(self._obs(30))["source"] == "cv"

    def test_filters_by_team(self):
        obs = self._obs(20, team=0) + self._obs(20, x=30.0, team=1)
        a = tactical_state(obs, team=0)
        b = tactical_state(obs, team=1)
        assert a["observations"] == 20 and b["observations"] == 20
        assert b["line_height_cv"] > a["line_height_cv"]
