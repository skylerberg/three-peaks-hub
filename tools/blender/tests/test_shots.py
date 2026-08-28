"""The shot maths: where a piece goes, when, and on what curve."""

from __future__ import annotations

import math
import sys
import unittest
from pathlib import Path
from typing import List, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import shots as shotlib  # noqa: E402
from scenedoc import (  # noqa: E402
    MM,
    CameraDof,
    CameraSpec,
    DealGrid,
    LightingSpec,
    DealShot,
    FanShot,
    FlipShot,
    OrbitShot,
    ParadeShot,
    RenderSpec,
    RevealShot,
    SceneDocument,
    SceneError,
    SceneInstance,
    StackShot,
    TurntableShot,
    is_camera_shot,
    shot_end_seconds,
)
from shots import Key, ShotPlan, Track, look_at_euler, plan_scene, plan_shot  # noqa: E402

CAMERA = CameraSpec(
    focal_length_mm=50,
    position_mm=(0.0, -420.0, 300.0),
    target_mm=(0.0, 0.0, 0.0),
    dof=CameraDof(enabled=True, focus_target=None, f_stop=2.8),
)


def cards(count: int, group: str = 'deck') -> List[SceneInstance]:
    return [
        SceneInstance(
            id=f'card-{index}',
            asset_id='asset-card',
            label=f'Card {index}',
            group=group,
            position_mm=(0.0, 0.0, index * 0.32),
            rotation_deg=(0.0, 0.0, 0.0),
        )
        for index in range(count)
    ]


def centre_of(instances: Sequence[SceneInstance]) -> Tuple[float, float, float]:
    """Where a camera shot aims: the centroid of its targets, in metres."""
    count = float(len(instances))
    return tuple(
        sum(item.position_mm[axis] for item in instances) / count * MM for axis in range(3)
    )


def channel(tracks: Sequence[Track], data_path: str, index: int) -> Track:
    for track in tracks:
        if track.data_path == data_path and track.index == index:
            return track
    raise AssertionError(f'no {data_path}[{index}] track in {[t.data_path for t in tracks]}')


def has_channel(tracks: Sequence[Track], data_path: str, index: int) -> bool:
    return any(track.data_path == data_path and track.index == index for track in tracks)


def every_kind() -> List:
    """One shot of every kind, at the parameters scenes.ts hands out."""
    return [
        TurntableShot('t', 'turntable', 'deck', 0.0, 6.0, revolutions=1.0, tilt_deg=15.0),
        FanShot('f', 'fan', 'deck', 0.0, 1.2, spread_deg=40.0, arc_radius_mm=120.0, stagger_s=0.06),
        FlipShot('l', 'flip', 'deck', 0.0, 1.2, axis='y', hold_s=0.3),
        DealShot(
            'd',
            'deal',
            'deck',
            0.0,
            0.6,
            to_positions_mm=None,
            grid=DealGrid(4, 3, 70.0, 95.0, (0.0, 0.0, 0.0)),
            arc_height_mm=60.0,
            stagger_s=0.12,
        ),
        StackShot('s', 'stack', 'deck', 0.0, 0.5, drop_height_mm=80.0, stagger_s=0.08),
        ParadeShot('p', 'parade', 'deck', 0.0, 8.0, spacing_mm=90.0, revolutions=0.5),
        OrbitShot(
            'o', 'orbit', 'deck', 0.0, 8.0, revolutions=1.0, radius_mm=400.0, height_mm=220.0
        ),
        RevealShot(
            'r', 'reveal', 'deck', 0.0, 5.0,
            from_mm=(0.0, -700.0, 320.0), to_mm=(0.0, -260.0, 140.0),
        ),
    ]


def all_tracks(plan: ShotPlan) -> List[Track]:
    return [track for tracks in plan.objects.values() for track in tracks] + list(plan.camera)


class EveryKindKeepsTheContract(unittest.TestCase):
    def setUp(self) -> None:
        self.instances = cards(5)

    def test_every_kind_has_a_planner(self) -> None:
        for shot in every_kind():
            with self.subTest(shot.kind):
                plan = plan_shot(shot, self.instances, CAMERA)
                self.assertTrue(all_tracks(plan), f'{shot.kind} planned nothing')

    def test_a_camera_shot_moves_the_camera_and_nothing_else(self) -> None:
        for shot in every_kind():
            with self.subTest(shot.kind):
                plan = plan_shot(shot, self.instances, CAMERA)
                if is_camera_shot(shot):
                    self.assertEqual(plan.objects, {})
                    self.assertTrue(plan.camera)
                else:
                    self.assertEqual(plan.camera, ())
                    self.assertEqual(len(plan.objects), len(self.instances))

    def test_keys_run_forwards_and_stay_inside_the_shot(self) -> None:
        for shot in every_kind():
            window_end = shot_end_seconds(shot, len(self.instances))
            plan = plan_shot(shot, self.instances, CAMERA)
            for track in all_tracks(plan):
                with self.subTest(kind=shot.kind, channel=(track.data_path, track.index)):
                    times = [key.time_s for key in track.keys]
                    self.assertEqual(times, sorted(times))
                    self.assertEqual(len(times), len(set(times)))
                    self.assertGreaterEqual(min(times), shot.start_s - 1e-9)
                    self.assertLessEqual(max(times), window_end + 1e-9)

    def test_every_track_ends_on_a_smooth_key(self) -> None:
        # The last key governs the gap to whatever the next shot does, so a
        # LINEAR terminator would drift the piece between shots.
        for shot in every_kind():
            plan = plan_shot(shot, self.instances, CAMERA)
            for track in all_tracks(plan):
                with self.subTest(kind=shot.kind, channel=(track.data_path, track.index)):
                    self.assertEqual(track.keys[-1].interpolation, 'BEZIER')
                    self.assertEqual(track.keys[-1].easing, 'EASE_IN_OUT')

    def test_nothing_is_baked(self) -> None:
        # Twelve a revolution for the orbit is the ceiling anything here emits.
        for shot in every_kind():
            plan = plan_shot(shot, self.instances, CAMERA)
            for track in all_tracks(plan):
                with self.subTest(kind=shot.kind):
                    self.assertLessEqual(len(track.keys), 16)

    def test_a_target_naming_nothing_plans_nothing(self) -> None:
        shot = TurntableShot('t', 'turntable', 'absent', 0.0, 6.0, revolutions=1.0, tilt_deg=15.0)
        self.assertEqual(plan_shot(shot, self.instances, CAMERA).objects, {})


class UnitsCrossOnce(unittest.TestCase):
    def test_a_card_sized_position_arrives_in_metres(self) -> None:
        instances = cards(1)
        shot = DealShot(
            'd',
            'deal',
            'deck',
            0.0,
            0.6,
            to_positions_mm=((63.0, 88.0, 0.0),),
            grid=None,
            arc_height_mm=0.0,
            stagger_s=0.0,
        )
        tracks = plan_shot(shot, instances, CAMERA).objects['card-0']
        self.assertAlmostEqual(channel(tracks, 'location', 0).keys[-1].value, 0.063, places=12)
        self.assertAlmostEqual(channel(tracks, 'location', 1).keys[-1].value, 0.088, places=12)

    def test_degrees_arrive_in_radians(self) -> None:
        instances = cards(1)
        shot = TurntableShot('t', 'turntable', 'deck', 0.0, 6.0, revolutions=1.0, tilt_deg=15.0)
        tracks = plan_shot(shot, instances, CAMERA).objects['card-0']
        self.assertAlmostEqual(
            channel(tracks, 'rotation_euler', 0).keys[0].value, math.radians(15.0)
        )
        self.assertAlmostEqual(channel(tracks, 'rotation_euler', 2).keys[-1].value, math.tau)


class Turntable(unittest.TestCase):
    def setUp(self) -> None:
        self.shot = TurntableShot(
            't', 'turntable', 'deck', 1.0, 6.0, revolutions=2.5, tilt_deg=-20.0
        )
        self.tracks = plan_shot(self.shot, cards(1), CAMERA).objects['card-0']

    def test_it_turns_exactly_the_revolutions_asked_for(self) -> None:
        spin = channel(self.tracks, 'rotation_euler', 2)
        self.assertAlmostEqual(spin.keys[0].value, 0.0)
        self.assertAlmostEqual(spin.keys[-1].value, 2.5 * math.tau)
        self.assertAlmostEqual(spin.keys[0].time_s, 1.0)
        self.assertAlmostEqual(spin.keys[-1].time_s, 7.0)

    def test_it_does_not_ease(self) -> None:
        self.assertEqual(channel(self.tracks, 'rotation_euler', 2).keys[0].interpolation, 'LINEAR')

    def test_the_tilt_is_one_held_key(self) -> None:
        tilt = channel(self.tracks, 'rotation_euler', 0)
        self.assertEqual(len(tilt.keys), 1)
        self.assertAlmostEqual(tilt.keys[0].value, math.radians(-20.0))


class Fan(unittest.TestCase):
    def setUp(self) -> None:
        self.count = 7
        self.shot = FanShot(
            'f', 'fan', 'deck', 0.5, 1.2, spread_deg=42.0, arc_radius_mm=120.0, stagger_s=0.06
        )
        self.instances = cards(self.count)
        self.plan = plan_shot(self.shot, self.instances, CAMERA)

    def landing(self, index: int) -> Tuple[float, float, float]:
        tracks = self.plan.objects[f'card-{index}']
        return tuple(channel(tracks, 'location', axis).keys[-1].value for axis in range(3))

    def test_the_hand_is_symmetric_about_its_middle(self) -> None:
        for index in range(self.count // 2):
            left = self.landing(index)
            right = self.landing(self.count - 1 - index)
            self.assertAlmostEqual(left[0], -right[0], places=12)
            self.assertAlmostEqual(left[1], right[1], places=12)

    def test_the_middle_card_sits_on_the_anchor(self) -> None:
        middle = self.landing(self.count // 2)
        self.assertAlmostEqual(middle[0], 0.0, places=12)
        self.assertAlmostEqual(middle[1], 0.0, places=12)

    def test_every_card_sits_on_the_arc(self) -> None:
        radius_m = self.shot.arc_radius_mm * MM
        pivot_y = -radius_m
        for index in range(self.count):
            x, y, _ = self.landing(index)
            self.assertAlmostEqual(math.hypot(x - 0.0, y - pivot_y), radius_m, places=12)

    def test_the_spread_is_the_spread_asked_for(self) -> None:
        first = self.landing(0)
        last = self.landing(self.count - 1)
        radius_m = self.shot.arc_radius_mm * MM
        angle_first = math.atan2(first[0], first[1] + radius_m)
        angle_last = math.atan2(last[0], last[1] + radius_m)
        self.assertAlmostEqual(angle_last - angle_first, math.radians(42.0), places=12)

    def test_each_card_faces_along_its_radius(self) -> None:
        radius_m = self.shot.arc_radius_mm * MM
        for index in range(self.count):
            x, y, _ = self.landing(index)
            yaw = channel(self.plan.objects[f'card-{index}'], 'rotation_euler', 2).keys[-1].value
            self.assertAlmostEqual(yaw, -math.atan2(x, y + radius_m), places=12)

    def test_the_cards_cascade(self) -> None:
        starts = [
            channel(self.plan.objects[f'card-{index}'], 'location', 0).keys[0].time_s
            for index in range(self.count)
        ]
        self.assertEqual(starts, sorted(starts))
        self.assertAlmostEqual(starts[0], 0.5)
        self.assertAlmostEqual(starts[-1] - starts[0], 0.06 * (self.count - 1))

    def test_they_are_layered_so_they_do_not_z_fight(self) -> None:
        heights = [self.landing(index)[2] for index in range(self.count)]
        self.assertEqual(heights, sorted(heights))
        self.assertGreater(heights[-1] - heights[0], 0.0)

    def test_one_card_stays_where_it_is(self) -> None:
        alone = plan_shot(self.shot, cards(1), CAMERA)
        tracks = alone.objects['card-0']
        self.assertAlmostEqual(channel(tracks, 'location', 0).keys[-1].value, 0.0)
        self.assertAlmostEqual(channel(tracks, 'rotation_euler', 2).keys[-1].value, 0.0)


class Flip(unittest.TestCase):
    def setUp(self) -> None:
        self.shot = FlipShot('l', 'flip', 'deck', 0.0, 1.2, axis='y', hold_s=0.3)
        self.tracks = plan_shot(self.shot, cards(1), CAMERA).objects['card-0']

    def test_it_turns_on_the_axis_it_names(self) -> None:
        self.assertTrue(has_channel(self.tracks, 'rotation_euler', 1))
        self.assertFalse(has_channel(self.tracks, 'rotation_euler', 0))
        tumble = FlipShot('l', 'flip', 'deck', 0.0, 1.2, axis='x', hold_s=0.3)
        turned = plan_shot(tumble, cards(1), CAMERA).objects['card-0']
        self.assertTrue(has_channel(turned, 'rotation_euler', 0))

    def test_it_comes_back_to_the_pose_it_started_in(self) -> None:
        keys = channel(self.tracks, 'rotation_euler', 1).keys
        self.assertAlmostEqual(keys[0].value, 0.0)
        self.assertAlmostEqual(keys[-1].value, math.tau)

    def test_the_hold_sits_in_the_middle_at_a_half_turn(self) -> None:
        keys = channel(self.tracks, 'rotation_euler', 1).keys
        self.assertEqual(len(keys), 4)
        self.assertAlmostEqual(keys[1].value, math.pi)
        self.assertAlmostEqual(keys[2].value, math.pi)
        self.assertAlmostEqual(keys[2].time_s - keys[1].time_s, 0.3)

    def test_no_hold_is_three_keys(self) -> None:
        shot = FlipShot('l', 'flip', 'deck', 0.0, 1.2, axis='y', hold_s=0.0)
        tracks = plan_shot(shot, cards(1), CAMERA).objects['card-0']
        keys = channel(tracks, 'rotation_euler', 1).keys
        self.assertEqual(len(keys), 3)

    def test_a_hold_longer_than_the_shot_still_turns(self) -> None:
        shot = FlipShot('l', 'flip', 'deck', 0.0, 1.0, axis='y', hold_s=60.0)
        tracks = plan_shot(shot, cards(1), CAMERA).objects['card-0']
        keys = channel(tracks, 'rotation_euler', 1).keys
        times = [key.time_s for key in keys]
        self.assertEqual(times, sorted(times))
        self.assertEqual(len(times), len(set(times)))
        self.assertAlmostEqual(times[-1], 1.0)


class Deal(unittest.TestCase):
    def setUp(self) -> None:
        self.shot = DealShot(
            'd',
            'deal',
            'deck',
            0.0,
            0.6,
            to_positions_mm=None,
            grid=DealGrid(3, 2, 70.0, 95.0, (0.0, 0.0, 0.0)),
            arc_height_mm=60.0,
            stagger_s=0.12,
        )
        self.plan = plan_shot(self.shot, cards(6), CAMERA)

    def landing(self, index: int) -> Tuple[float, float, float]:
        tracks = self.plan.objects[f'card-{index}']
        return tuple(channel(tracks, 'location', axis).keys[-1].value for axis in range(3))

    def test_the_grid_is_centred_on_its_origin(self) -> None:
        xs = [self.landing(index)[0] for index in range(6)]
        ys = [self.landing(index)[1] for index in range(6)]
        self.assertAlmostEqual(sum(xs), 0.0, places=12)
        self.assertAlmostEqual(sum(ys), 0.0, places=12)

    def test_the_grid_is_filled_row_by_row(self) -> None:
        self.assertAlmostEqual(self.landing(0)[0], -0.070, places=12)
        self.assertAlmostEqual(self.landing(1)[0], 0.0, places=12)
        self.assertAlmostEqual(self.landing(2)[0], 0.070, places=12)
        self.assertAlmostEqual(self.landing(3)[0], -0.070, places=12)
        self.assertAlmostEqual(self.landing(0)[1], 0.0475, places=12)
        self.assertAlmostEqual(self.landing(3)[1], -0.0475, places=12)

    def test_the_card_flies_over_an_arc(self) -> None:
        keys = channel(self.plan.objects['card-0'], 'location', 2).keys
        self.assertEqual(len(keys), 3)
        self.assertAlmostEqual(keys[1].value, 0.060, places=9)
        self.assertGreater(keys[1].value, keys[0].value)
        self.assertGreater(keys[1].value, keys[2].value)
        self.assertEqual(keys[0].easing, 'EASE_OUT')
        self.assertEqual(keys[1].easing, 'EASE_IN')

    def test_a_flat_deal_is_two_keys(self) -> None:
        flat = DealShot(
            'd', 'deal', 'deck', 0.0, 0.6,
            to_positions_mm=((0.0, 0.0, 0.0),), grid=None, arc_height_mm=0.0, stagger_s=0.0,
        )
        keys = channel(plan_shot(flat, cards(1), CAMERA).objects['card-0'], 'location', 2).keys
        self.assertEqual(len(keys), 2)

    def test_the_in_flight_turn_settles_flat(self) -> None:
        keys = channel(self.plan.objects['card-0'], 'rotation_euler', 2).keys
        self.assertEqual(len(keys), 3)
        self.assertAlmostEqual(keys[0].value, 0.0)
        self.assertNotAlmostEqual(keys[1].value, 0.0)
        self.assertAlmostEqual(keys[2].value, 0.0)
        self.assertEqual((keys[1].interpolation, keys[1].easing), ('BACK', 'EASE_OUT'))

    def test_neighbours_turn_opposite_ways(self) -> None:
        first = channel(self.plan.objects['card-0'], 'rotation_euler', 2).keys[1].value
        second = channel(self.plan.objects['card-1'], 'rotation_euler', 2).keys[1].value
        self.assertAlmostEqual(first, -second, places=12)

    def test_a_grid_too_small_for_the_hand_is_refused(self) -> None:
        with self.assertRaises(SceneError) as caught:
            plan_shot(self.shot, cards(7), CAMERA)
        self.assertIn('3x2', str(caught.exception))

    def test_too_few_positions_are_refused(self) -> None:
        shot = DealShot(
            'd', 'deal', 'deck', 0.0, 0.6,
            to_positions_mm=((0.0, 0.0, 0.0),), grid=None, arc_height_mm=0.0, stagger_s=0.0,
        )
        with self.assertRaises(SceneError) as caught:
            plan_shot(shot, cards(3), CAMERA)
        self.assertIn('3 pieces', str(caught.exception))


class Stack(unittest.TestCase):
    def setUp(self) -> None:
        self.shot = StackShot('s', 'stack', 'deck', 0.0, 0.5, drop_height_mm=80.0, stagger_s=0.08)
        self.plan = plan_shot(self.shot, cards(4), CAMERA)

    def test_the_card_starts_the_drop_above_where_it_lands(self) -> None:
        keys = channel(self.plan.objects['card-1'], 'location', 2).keys
        rest = 1 * 0.32 * MM
        self.assertAlmostEqual(keys[0].value, rest + 0.080, places=12)
        self.assertAlmostEqual(keys[-1].value, rest, places=12)

    def test_gravity_is_a_bounce_rather_than_a_bake(self) -> None:
        keys = channel(self.plan.objects['card-0'], 'location', 2).keys
        self.assertEqual(len(keys), 2)
        self.assertEqual((keys[0].interpolation, keys[0].easing), ('BOUNCE', 'EASE_OUT'))

    def test_it_settles_out_of_a_small_turn(self) -> None:
        keys = channel(self.plan.objects['card-0'], 'rotation_euler', 2).keys
        self.assertNotAlmostEqual(keys[0].value, 0.0)
        self.assertAlmostEqual(keys[-1].value, 0.0)
        self.assertEqual((keys[0].interpolation, keys[0].easing), ('BACK', 'EASE_OUT'))

    def test_nothing_moves_sideways(self) -> None:
        tracks = self.plan.objects['card-0']
        self.assertFalse(has_channel(tracks, 'location', 0))
        self.assertFalse(has_channel(tracks, 'location', 1))

    def test_the_cards_land_one_after_another(self) -> None:
        starts = [
            channel(self.plan.objects[f'card-{index}'], 'location', 2).keys[0].time_s
            for index in range(4)
        ]
        self.assertAlmostEqual(starts[3] - starts[0], 0.08 * 3)


class Parade(unittest.TestCase):
    def setUp(self) -> None:
        self.count = 4
        self.shot = ParadeShot('p', 'parade', 'deck', 0.0, 8.0, spacing_mm=90.0, revolutions=0.5)
        self.plan = plan_shot(self.shot, cards(self.count), CAMERA)

    def test_the_line_is_evenly_spaced(self) -> None:
        starts = [
            channel(self.plan.objects[f'card-{index}'], 'location', 0).keys[0].value
            for index in range(self.count)
        ]
        for earlier, later in zip(starts, starts[1:]):
            self.assertAlmostEqual(later - earlier, 0.090, places=12)

    def test_the_pass_is_centred_on_what_the_camera_is_pointed_at(self) -> None:
        # Not the line at rest: the middle of the move is what the frame holds,
        # so a pass that started composed would end with the frame empty.
        middles = [
            (
                channel(self.plan.objects[f'card-{index}'], 'location', 0).keys[0].value
                + channel(self.plan.objects[f'card-{index}'], 'location', 0).keys[-1].value
            )
            / 2.0
            for index in range(self.count)
        ]
        self.assertAlmostEqual(sum(middles), 0.0, places=12)

    def test_the_pass_can_be_looped(self) -> None:
        # Each piece finishes where the piece one line-length behind it began,
        # so the same shot laid end to end joins up.
        first_start = channel(self.plan.objects['card-0'], 'location', 0).keys[0].value
        first_end = channel(self.plan.objects['card-0'], 'location', 0).keys[-1].value
        self.assertAlmostEqual(first_end - first_start, self.count * 0.090, places=12)

    def test_it_turns_at_a_constant_rate(self) -> None:
        keys = channel(self.plan.objects['card-0'], 'rotation_euler', 2).keys
        self.assertEqual(keys[0].interpolation, 'LINEAR')
        self.assertAlmostEqual(keys[-1].value, 0.5 * math.tau)


class AimingACamera(unittest.TestCase):
    def test_the_default_blender_pose(self) -> None:
        pitch, roll, yaw = look_at_euler((7.36, -6.93, 4.96), (0.0, 0.0, 0.0))
        self.assertAlmostEqual(math.degrees(pitch), 63.87, places=1)
        self.assertEqual(roll, 0.0)
        self.assertAlmostEqual(math.degrees(yaw), 46.72, places=1)

    def test_looking_straight_down(self) -> None:
        pitch, _, _ = look_at_euler((0.0, 0.0, 1.0), (0.0, 0.0, 0.0))
        self.assertAlmostEqual(pitch, 0.0)

    def test_looking_along_the_horizon(self) -> None:
        pitch, _, yaw = look_at_euler((0.0, -1.0, 0.0), (0.0, 0.0, 0.0))
        self.assertAlmostEqual(pitch, math.pi / 2.0)
        self.assertAlmostEqual(yaw, 0.0)

    def test_a_camera_on_top_of_its_target(self) -> None:
        self.assertEqual(look_at_euler((1.0, 2.0, 3.0), (1.0, 2.0, 3.0)), (0.0, 0.0, 0.0))


class Orbit(unittest.TestCase):
    def setUp(self) -> None:
        self.shot = OrbitShot(
            'o', 'orbit', 'deck', 1.0, 8.0, revolutions=1.0, radius_mm=400.0, height_mm=220.0
        )
        self.instances = cards(3)
        self.centre = centre_of(self.instances)
        self.tracks = plan_shot(self.shot, self.instances, CAMERA).camera

    def poses(self) -> List[Tuple[float, Tuple[float, float, float], Tuple[float, float]]]:
        location = [channel(self.tracks, 'location', axis).keys for axis in range(3)]
        pitch = channel(self.tracks, 'rotation_euler', 0).keys
        yaw = channel(self.tracks, 'rotation_euler', 2).keys
        return [
            (
                location[0][index].time_s,
                (location[0][index].value, location[1][index].value, location[2][index].value),
                (pitch[index].value, yaw[index].value),
            )
            for index in range(len(pitch))
        ]

    def test_it_samples_the_circle_rather_than_every_frame(self) -> None:
        self.assertEqual(len(channel(self.tracks, 'location', 0).keys), 13)

    def test_every_pose_is_on_the_circle(self) -> None:
        for _, (x, y, z), _ in self.poses():
            self.assertAlmostEqual(
                math.hypot(x - self.centre[0], y - self.centre[1]), 0.400, places=12
            )
            self.assertAlmostEqual(z - self.centre[2], 0.220, places=12)

    def test_the_circle_is_centred_on_the_target_rather_than_the_world(self) -> None:
        moved = [
            SceneInstance(item.id, item.asset_id, item.label, item.group, (300.0, 200.0, 0.0),
                          item.rotation_deg)
            for item in self.instances
        ]
        tracks = plan_shot(self.shot, moved, CAMERA).camera
        x = channel(tracks, 'location', 0).keys
        y = channel(tracks, 'location', 1).keys
        for index in range(len(x)):
            self.assertAlmostEqual(
                math.hypot(x[index].value - 0.300, y[index].value - 0.200), 0.400, places=12
            )

    def test_it_starts_where_the_camera_already_is(self) -> None:
        _, (x, y, _), _ = self.poses()[0]
        bearing = math.atan2(y - self.centre[1], x - self.centre[0])
        self.assertAlmostEqual(bearing, math.atan2(-0.420, 0.0), places=9)

    def test_it_stays_aimed_at_the_target(self) -> None:
        for _, position, (pitch, yaw) in self.poses():
            wanted = look_at_euler(position, self.centre)
            self.assertAlmostEqual(pitch, wanted[0], places=12)
            self.assertAlmostEqual(math.cos(yaw), math.cos(wanted[2]), places=12)
            self.assertAlmostEqual(math.sin(yaw), math.sin(wanted[2]), places=12)

    def test_the_yaw_does_not_wrap_back_on_itself(self) -> None:
        yaws = [pose[2][1] for pose in self.poses()]
        steps = [later - earlier for earlier, later in zip(yaws, yaws[1:])]
        self.assertTrue(all(step > 0 for step in steps) or all(step < 0 for step in steps))
        self.assertAlmostEqual(abs(yaws[-1] - yaws[0]), math.tau, places=9)

    def test_the_roll_is_left_for_a_human(self) -> None:
        self.assertFalse(has_channel(self.tracks, 'rotation_euler', 1))

    def test_it_spans_the_whole_shot(self) -> None:
        times = [key.time_s for key in channel(self.tracks, 'location', 0).keys]
        self.assertAlmostEqual(times[0], 1.0)
        self.assertAlmostEqual(times[-1], 9.0)

    def test_more_revolutions_take_more_samples(self) -> None:
        faster = OrbitShot(
            'o', 'orbit', 'deck', 0.0, 8.0, revolutions=3.0, radius_mm=400.0, height_mm=0.0
        )
        tracks = plan_shot(faster, cards(3), CAMERA).camera
        self.assertEqual(len(channel(tracks, 'location', 0).keys), 37)


class Reveal(unittest.TestCase):
    def setUp(self) -> None:
        self.shot = RevealShot(
            'r', 'reveal', 'deck', 0.0, 5.0,
            from_mm=(0.0, -700.0, 320.0), to_mm=(0.0, -260.0, 140.0),
        )
        self.instances = cards(3)
        self.centre = centre_of(self.instances)
        self.tracks = plan_shot(self.shot, self.instances, CAMERA).camera

    def test_it_flies_the_line_it_was_given(self) -> None:
        for axis, (start, end) in enumerate(((0.0, 0.0), (-0.700, -0.260), (0.320, 0.140))):
            keys = channel(self.tracks, 'location', axis).keys
            self.assertAlmostEqual(keys[0].value, start, places=12)
            self.assertAlmostEqual(keys[-1].value, end, places=12)

    def test_the_middle_aim_is_taken_from_the_middle_of_the_move(self) -> None:
        pitch = channel(self.tracks, 'rotation_euler', 0).keys
        self.assertEqual(len(pitch), 3)
        wanted = look_at_euler((0.0, -0.480, 0.230), self.centre)
        self.assertAlmostEqual(pitch[1].value, wanted[0], places=12)

    def test_the_aim_changes_across_the_move(self) -> None:
        pitch = [key.value for key in channel(self.tracks, 'rotation_euler', 0).keys]
        self.assertNotAlmostEqual(pitch[0], pitch[-1])

    def test_a_camera_move_is_smooth(self) -> None:
        keys = channel(self.tracks, 'location', 1).keys
        self.assertEqual((keys[0].interpolation, keys[0].easing), ('BEZIER', 'EASE_IN_OUT'))


class KeysCheckTheirOwnEnums(unittest.TestCase):
    def test_a_misspelt_interpolation_is_refused(self) -> None:
        with self.assertRaises(SceneError):
            Key(0.0, 0.0, 'BEZIER_SMOOTH', 'EASE_OUT')

    def test_a_misspelt_easing_is_refused(self) -> None:
        with self.assertRaises(SceneError):
            Key(0.0, 0.0, 'BEZIER', 'EASE')

    def test_the_verified_blender_names_are_all_accepted(self) -> None:
        for interpolation in shotlib.INTERPOLATIONS:
            for easing in shotlib.EASINGS:
                Key(0.0, 0.0, interpolation, easing)

    def test_a_track_running_backwards_is_refused(self) -> None:
        with self.assertRaises(SceneError):
            shotlib._track('location', 0, [Key(1.0, 0.0), Key(0.5, 1.0)])

    def test_a_frame_is_the_time_the_exporter_would_have_computed(self) -> None:
        self.assertEqual(Key(2.0, 0.0).frame(30), 61)


class PlanningAWholeScene(unittest.TestCase):
    def scene(self, shots_list) -> SceneDocument:
        return SceneDocument(
            generated_at='2026-08-27T12:00:00.000Z',
            project_name='Harvest',
            assets=(),
            instances=tuple(cards(3)),
            shots=tuple(shots_list),
            camera=CAMERA,
            lighting=LightingSpec('studio', 1.0, 'transparent', '#101418'),
            render=RenderSpec('CYCLES', (1920, 1080), 30, 128, (1, 301)),
        )

    def test_two_shots_on_one_object_share_one_curve(self) -> None:
        first = TurntableShot('a', 'turntable', 'deck', 0.0, 2.0, revolutions=1.0, tilt_deg=0.0)
        second = TurntableShot('b', 'turntable', 'deck', 4.0, 2.0, revolutions=1.0, tilt_deg=0.0)
        plan = plan_scene(self.scene([first, second]))
        spin = channel(plan.objects['card-0'], 'rotation_euler', 2)
        self.assertEqual([key.time_s for key in spin.keys], [0.0, 2.0, 4.0, 6.0])

    def test_a_camera_shot_and_an_object_shot_do_not_collide(self) -> None:
        spin = TurntableShot('a', 'turntable', 'deck', 0.0, 2.0, revolutions=1.0, tilt_deg=0.0)
        orbit = OrbitShot(
            'b', 'orbit', 'deck', 0.0, 4.0, revolutions=1.0, radius_mm=400.0, height_mm=100.0
        )
        plan = plan_scene(self.scene([spin, orbit]))
        self.assertEqual(set(plan.objects), {'card-0', 'card-1', 'card-2'})
        self.assertTrue(plan.camera)

    def test_the_range_is_the_document_s(self) -> None:
        plan = plan_scene(self.scene([]))
        self.assertEqual(plan.frame_range, (1, 301))
        self.assertEqual(plan.objects, {})


if __name__ == '__main__':
    unittest.main()
