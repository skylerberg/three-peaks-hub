"""What the importer refuses, and what it reads back."""

from __future__ import annotations

import copy
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import scenedoc  # noqa: E402
from scenedoc import (  # noqa: E402
    SceneError,
    frame_for_seconds,
    instances_for_target,
    load_scene,
    parse_scene,
    scene_frame_range,
    shot_end_seconds,
)


def scene_dict() -> dict:
    """A document with one of everything the parser has an opinion about."""
    return {
        'format': 'three-peaks-scene',
        'version': 1,
        'generated_at': '2026-08-27T12:00:00.000Z',
        'project_name': 'Harvest',
        'units': 'mm',
        'assets': [
            {
                'kind': 'glb',
                'id': 'asset-card',
                'path': 'assets/card.glb',
                'component': 'card',
                'label': 'Villager',
            },
            {
                'kind': 'library',
                'id': 'asset-die',
                'piece': 'd6',
                'color': '#c0392b',
                'size_mm': 16,
                'label': 'D6 die',
            },
        ],
        'instances': [
            {
                'id': 'card-1',
                'asset_id': 'asset-card',
                'label': 'Villager 1',
                'group': 'deck:villagers',
                'position_mm': [0, 0, 0],
                'rotation_deg': [0, 0, 0],
            },
            {
                'id': 'card-2',
                'asset_id': 'asset-card',
                'label': 'Villager 2',
                'group': 'deck:villagers',
                'position_mm': [0, 0, 0.32],
                'rotation_deg': [0, 0, 0],
            },
            {
                'id': 'die-1',
                'asset_id': 'asset-die',
                'label': 'Die',
                'group': None,
                'position_mm': [80, 0, 0],
                'rotation_deg': [0, 0, 0],
            },
        ],
        'shots': [
            {
                'id': 'shot-fan',
                'kind': 'fan',
                'target': 'deck:villagers',
                'start_s': 0,
                'duration_s': 1.2,
                'spread_deg': 40,
                'arc_radius_mm': 120,
                'stagger_s': 0.06,
            },
            {
                'id': 'shot-orbit',
                'kind': 'orbit',
                'target': 'scene',
                'start_s': 2,
                'duration_s': 8,
                'revolutions': 1,
                'radius_mm': 400,
                'height_mm': 220,
            },
        ],
        'camera': {
            'focal_length_mm': 50,
            'position_mm': [0, -420, 300],
            'target_mm': [0, 0, 0],
            'dof': {'enabled': True, 'focus_target': 'deck:villagers', 'f_stop': 2.8},
        },
        'lighting': {
            'preset': 'studio',
            'strength': 1,
            'background': 'transparent',
            'background_color': '#101418',
        },
        'surface': {
            'finish': 'wood',
            'color': '#6b4a2f',
            'width_mm': 1600,
            'depth_mm': 1200,
            'thickness_mm': 18,
            'sweep_height_mm': 500,
        },
        'render': {
            'engine': 'CYCLES',
            'resolution': [1920, 1080],
            'fps': 30,
            'samples': 128,
            'frame_range': [1, 301],
        },
    }


class ParsingAWholeDocument(unittest.TestCase):
    def test_reads_every_section(self) -> None:
        scene = parse_scene(scene_dict())
        self.assertEqual(scene.project_name, 'Harvest')
        self.assertEqual([asset.id for asset in scene.assets], ['asset-card', 'asset-die'])
        self.assertEqual(scene.assets[0].component, 'card')
        self.assertEqual(scene.assets[1].piece, 'd6')
        self.assertEqual(scene.assets[1].size_mm, 16.0)
        self.assertEqual(len(scene.instances), 3)
        self.assertIsNone(scene.instances[2].group)
        self.assertEqual([shot.kind for shot in scene.shots], ['fan', 'orbit'])
        self.assertEqual(scene.shots[0].spread_deg, 40.0)
        self.assertEqual(scene.camera.dof.focus_target, 'deck:villagers')
        self.assertEqual(scene.render.frame_range, (1, 301))
        self.assertEqual(scene.surface.finish, 'wood')
        self.assertEqual(scene.surface.sweep_height_mm, 500.0)

    def test_a_document_with_no_table_stands_on_nothing(self) -> None:
        # Every bundle written before there was a table to stand on says this,
        # and so does one exported without one. Both mean the same scene.
        data = scene_dict()
        del data['surface']
        self.assertIsNone(parse_scene(data).surface)

    def test_lengths_stay_in_millimetres(self) -> None:
        # The conversion belongs to whoever builds geometry. A parser that
        # converted would leave the document and the dataclasses disagreeing
        # about what a number means.
        scene = parse_scene(scene_dict())
        self.assertEqual(scene.instances[2].position_mm, (80.0, 0.0, 0.0))
        self.assertEqual(scene.camera.position_mm, (0.0, -420.0, 300.0))

    def test_reads_a_file(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scene.json'
            path.write_text(json.dumps(scene_dict()), encoding='utf-8')
            self.assertEqual(load_scene(path).project_name, 'Harvest')

    def test_a_file_that_is_not_json_says_so(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'scene.json'
            path.write_text('{ not json', encoding='utf-8')
            with self.assertRaises(SceneError) as caught:
                load_scene(path)
            self.assertIn('is not JSON', str(caught.exception))


class RefusingABadDocument(unittest.TestCase):
    def rejects(self, mutate, *expected: str) -> str:
        data = scene_dict()
        mutate(data)
        with self.assertRaises(SceneError) as caught:
            parse_scene(data)
        message = str(caught.exception)
        for fragment in expected:
            self.assertIn(fragment, message)
        return message

    def test_wrong_format(self) -> None:
        self.rejects(lambda data: data.__setitem__('format', 'blender'), 'format')

    def test_wrong_version(self) -> None:
        self.rejects(lambda data: data.__setitem__('version', 2), 'version', 'must be 1')

    def test_wrong_units(self) -> None:
        self.rejects(lambda data: data.__setitem__('units', 'cm'), 'units')

    def test_a_missing_field_names_itself(self) -> None:
        def drop(data: dict) -> None:
            del data['shots'][0]['spread_deg']

        self.rejects(drop, 'shots[0].spread_deg', 'is missing')

    def test_a_value_past_its_bound_names_the_bound(self) -> None:
        def widen(data: dict) -> None:
            data['shots'][0]['spread_deg'] = 400

        self.rejects(widen, 'shots[0].spread_deg', 'between 0 and 360', '400')

    def test_a_value_below_its_bound(self) -> None:
        def shrink(data: dict) -> None:
            data['shots'][0]['duration_s'] = 0.0

        self.rejects(shrink, 'shots[0].duration_s', '0.05')

    def test_not_a_number(self) -> None:
        def swap(data: dict) -> None:
            data['shots'][0]['spread_deg'] = '40'

        self.rejects(swap, 'shots[0].spread_deg', 'must be a number')

    def test_a_boolean_is_not_a_number(self) -> None:
        def swap(data: dict) -> None:
            data['shots'][0]['arc_radius_mm'] = True

        self.rejects(swap, 'shots[0].arc_radius_mm', 'must be a number')

    def test_an_unknown_shot_kind(self) -> None:
        def swap(data: dict) -> None:
            data['shots'][0]['kind'] = 'swoop'

        self.rejects(swap, 'shots[0].kind', 'swoop')

    def test_a_shot_target_that_names_nothing(self) -> None:
        def swap(data: dict) -> None:
            data['shots'][0]['target'] = 'deck:absent'

        self.rejects(swap, 'shots[0].target', 'deck:absent')

    def test_an_instance_naming_no_asset(self) -> None:
        def swap(data: dict) -> None:
            data['instances'][0]['asset_id'] = 'asset-gone'

        self.rejects(swap, 'instances[0].asset_id', 'asset-gone')

    def test_duplicate_instance_ids(self) -> None:
        def clone(data: dict) -> None:
            data['instances'][1]['id'] = data['instances'][0]['id']

        self.rejects(clone, 'instances[1].id', 'duplicates')

    def test_a_glb_path_that_climbs_out_of_the_bundle(self) -> None:
        def escape(data: dict) -> None:
            data['assets'][0]['path'] = 'assets/../../etc/passwd'

        self.rejects(escape, 'assets[0].path', 'assets/')

    def test_a_glb_path_outside_the_asset_directory(self) -> None:
        def escape(data: dict) -> None:
            data['assets'][0]['path'] = 'card.glb'

        self.rejects(escape, 'assets[0].path')

    def test_an_unknown_component_kind(self) -> None:
        def swap(data: dict) -> None:
            data['assets'][0]['component'] = 'token'

        self.rejects(swap, 'assets[0].component', 'token')

    def test_an_unknown_library_piece(self) -> None:
        def swap(data: dict) -> None:
            data['assets'][1]['piece'] = 'obelisk'

        self.rejects(swap, 'assets[1].piece', 'obelisk')

    def test_a_library_piece_too_large(self) -> None:
        def swap(data: dict) -> None:
            data['assets'][1]['size_mm'] = 900

        self.rejects(swap, 'assets[1].size_mm', 'between 1 and 500')

    def test_a_colour_that_is_not_hex(self) -> None:
        def swap(data: dict) -> None:
            data['assets'][1]['color'] = '#C0392B'

        self.rejects(swap, 'assets[1].color', 'colour')

    def test_a_position_with_two_axes(self) -> None:
        def swap(data: dict) -> None:
            data['instances'][0]['position_mm'] = [0, 0]

        self.rejects(swap, 'instances[0].position_mm', 'three numbers')

    def test_a_focus_target_that_names_nothing(self) -> None:
        def swap(data: dict) -> None:
            data['camera']['dof']['focus_target'] = 'deck:absent'

        self.rejects(swap, 'camera.dof.focus_target')

    def test_an_unknown_table_finish(self) -> None:
        def swap(data: dict) -> None:
            data['surface']['finish'] = 'marble'

        self.rejects(swap, 'surface.finish', 'wood')

    def test_a_table_cut_past_its_bound(self) -> None:
        def widen(data: dict) -> None:
            data['surface']['width_mm'] = 90000

        self.rejects(widen, 'surface.width_mm')

    def test_a_table_missing_a_field_it_needs(self) -> None:
        def drop(data: dict) -> None:
            del data['surface']['thickness_mm']

        self.rejects(drop, 'surface.thickness_mm', 'is missing')

    def test_an_unknown_render_engine(self) -> None:
        def swap(data: dict) -> None:
            data['render']['engine'] = 'BLENDER_EEVEE_NEXT'

        self.rejects(swap, 'render.engine', 'BLENDER_EEVEE_NEXT')

    def test_a_frame_range_that_ends_before_the_shots(self) -> None:
        def shrink(data: dict) -> None:
            data['render']['frame_range'] = [1, 60]

        self.rejects(shrink, 'render.frame_range', 'before the shots do')

    def test_fractional_frames(self) -> None:
        def swap(data: dict) -> None:
            data['render']['frame_range'] = [1, 301.5]

        self.rejects(swap, 'render.frame_range[1]', 'whole number')


class DealNeedsExactlyOneWayToLand(unittest.TestCase):
    def deal(self, **overrides) -> dict:
        data = scene_dict()
        shot = {
            'id': 'shot-deal',
            'kind': 'deal',
            'target': 'deck:villagers',
            'start_s': 0,
            'duration_s': 0.6,
            'to_positions_mm': None,
            'grid': {
                'columns': 4,
                'rows': 3,
                'spacing_x_mm': 70,
                'spacing_y_mm': 95,
                'origin_mm': [0, 0, 0],
            },
            'arc_height_mm': 60,
            'stagger_s': 0.12,
        }
        shot.update(overrides)
        data['shots'] = [shot]
        return data

    def test_a_grid_alone_is_read(self) -> None:
        scene = parse_scene(self.deal())
        self.assertEqual(scene.shots[0].grid.columns, 4)
        self.assertIsNone(scene.shots[0].to_positions_mm)

    def test_positions_alone_are_read(self) -> None:
        scene = parse_scene(self.deal(grid=None, to_positions_mm=[[0, 0, 0], [70, 0, 0]]))
        self.assertEqual(scene.shots[0].to_positions_mm, ((0.0, 0.0, 0.0), (70.0, 0.0, 0.0)))

    def test_both_is_refused(self) -> None:
        with self.assertRaises(SceneError) as caught:
            parse_scene(self.deal(to_positions_mm=[[0, 0, 0]]))
        self.assertIn('exactly one', str(caught.exception))

    def test_neither_is_refused(self) -> None:
        with self.assertRaises(SceneError) as caught:
            parse_scene(self.deal(grid=None))
        self.assertIn('exactly one', str(caught.exception))

    def test_a_grid_column_count_is_bounded(self) -> None:
        broken = self.deal()
        broken['shots'][0]['grid']['columns'] = 0
        with self.assertRaises(SceneError) as caught:
            parse_scene(broken)
        self.assertIn('shots[0].grid.columns', str(caught.exception))


class TimingRules(unittest.TestCase):
    def setUp(self) -> None:
        self.scene = parse_scene(scene_dict())

    def test_frames_round_the_way_the_exporter_rounded(self) -> None:
        # Python rounds a half to even; the browser rounded it up. Frame 1 is
        # t = 0, so these are the browser's answers.
        self.assertEqual(frame_for_seconds(0.0, 30), 1)
        self.assertEqual(frame_for_seconds(1.0, 30), 31)
        self.assertEqual(frame_for_seconds(0.5, 1), 2)
        self.assertEqual(frame_for_seconds(1.5, 1), 3)
        self.assertEqual(frame_for_seconds(2.5, 1), 4)

    def test_a_staggered_shot_outlives_its_duration(self) -> None:
        fan = self.scene.shots[0]
        self.assertAlmostEqual(shot_end_seconds(fan, 1), 1.2)
        self.assertAlmostEqual(shot_end_seconds(fan, 5), 1.2 + 0.06 * 4)

    def test_an_unstaggered_shot_does_not(self) -> None:
        orbit = self.scene.shots[1]
        self.assertAlmostEqual(shot_end_seconds(orbit, 1), 10.0)
        self.assertAlmostEqual(shot_end_seconds(orbit, 40), 10.0)

    def test_the_range_covers_the_last_shot(self) -> None:
        self.assertEqual(
            scene_frame_range(self.scene.shots, self.scene.instances, 30), (1, 301)
        )

    def test_a_scene_with_no_shots_is_one_frame(self) -> None:
        self.assertEqual(scene_frame_range([], self.scene.instances, 30), (1, 1))


class ResolvingATarget(unittest.TestCase):
    def setUp(self) -> None:
        self.scene = parse_scene(scene_dict())

    def test_the_scene_target_is_everything(self) -> None:
        found = instances_for_target(self.scene.instances, scenedoc.SCENE_TARGET)
        self.assertEqual(len(found), 3)

    def test_a_group_is_its_members_in_order(self) -> None:
        found = instances_for_target(self.scene.instances, 'deck:villagers')
        self.assertEqual([item.id for item in found], ['card-1', 'card-2'])

    def test_an_instance_id_is_itself(self) -> None:
        found = instances_for_target(self.scene.instances, 'die-1')
        self.assertEqual([item.id for item in found], ['die-1'])

    def test_a_name_nothing_carries_is_empty(self) -> None:
        self.assertEqual(instances_for_target(self.scene.instances, 'deck:absent'), [])


class CountsAreBounded(unittest.TestCase):
    def test_no_assets_at_all(self) -> None:
        data = scene_dict()
        data['assets'] = []
        data['instances'] = []
        with self.assertRaises(SceneError) as caught:
            parse_scene(data)
        self.assertIn('assets', str(caught.exception))

    def test_too_many_shots(self) -> None:
        data = scene_dict()
        template = data['shots'][0]
        data['shots'] = []
        for index in range(40):
            shot = copy.deepcopy(template)
            shot['id'] = f'shot-{index}'
            data['shots'].append(shot)
        with self.assertRaises(SceneError) as caught:
            parse_scene(data)
        self.assertIn('shots', str(caught.exception))


if __name__ == '__main__':
    unittest.main()
