"""The table and the sweep behind it: where its top is, and that it is a solid."""

from __future__ import annotations

import sys
import unittest
from collections import Counter
from pathlib import Path
from typing import Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import stage  # noqa: E402
from pieces import Mesh  # noqa: E402
from scenedoc import MM, SURFACE_LIMITS, SceneError, SurfaceSpec  # noqa: E402


def surface(**patch) -> SurfaceSpec:
    values = {
        'finish': 'wood',
        'color': '#6b4a2f',
        'width_mm': 1600.0,
        'depth_mm': 1200.0,
        'thickness_mm': 18.0,
        'sweep_height_mm': 500.0,
    }
    values.update(patch)
    return SurfaceSpec(**values)


def signed_volume(mesh: Mesh) -> float:
    """Positive for a closed mesh whose faces are wound outward."""
    total = 0.0
    for face in mesh.faces:
        first = mesh.vertices[face[0]]
        for index in range(1, len(face) - 1):
            second = mesh.vertices[face[index]]
            third = mesh.vertices[face[index + 1]]
            total += (
                first[0] * (second[1] * third[2] - second[2] * third[1])
                - first[1] * (second[0] * third[2] - second[2] * third[0])
                + first[2] * (second[0] * third[1] - second[1] * third[0])
            )
    return total / 6.0


def half_edges(mesh: Mesh) -> Counter:
    counted: Counter = Counter()
    for face in mesh.faces:
        for index in range(len(face)):
            counted[(face[index], face[(index + 1) % len(face)])] += 1
    return counted


def bounds(mesh: Mesh) -> Tuple[Tuple[float, float], ...]:
    return tuple(
        (
            min(vertex[axis] for vertex in mesh.vertices),
            max(vertex[axis] for vertex in mesh.vertices),
        )
        for axis in range(3)
    )


class TheTableIsASolid(unittest.TestCase):
    def test_a_swept_table_is_closed(self) -> None:
        counted = half_edges(stage.build_surface(surface()))
        for (start, end), times in counted.items():
            self.assertEqual(times, 1, f'{start}->{end} used twice the same way')
            self.assertEqual(counted[(end, start)], 1, f'{start}->{end} has no opposite')

    def test_a_flat_table_is_closed(self) -> None:
        counted = half_edges(stage.build_surface(surface(sweep_height_mm=0.0)))
        for (start, end), times in counted.items():
            self.assertEqual(times, 1)
            self.assertEqual(counted[(end, start)], 1)

    def test_every_face_points_outward(self) -> None:
        for height in (0.0, 500.0):
            with self.subTest(sweep_height_mm=height):
                self.assertGreater(signed_volume(stage.build_surface(surface(sweep_height_mm=height))), 0.0)

    def test_every_face_has_a_smooth_flag(self) -> None:
        mesh = stage.build_surface(surface())
        self.assertEqual(len(mesh.faces), len(mesh.smooth))

    def test_every_face_names_real_vertices(self) -> None:
        mesh = stage.build_surface(surface())
        for face in mesh.faces:
            self.assertEqual(len(set(face)), len(face))
            for index in face:
                self.assertLess(index, len(mesh.vertices))

    def test_no_two_points_of_the_profile_are_the_same(self) -> None:
        # A repeated vertex is a zero-length edge, and validate() removing one
        # slides every later smooth flag onto the wrong polygon.
        points, _ = stage.surface_profile(1.2, 0.018, 0.5)
        self.assertEqual(len(set(points)), len(points))


class WhereTheTableStands(unittest.TestCase):
    def test_the_top_is_the_plane_the_pieces_already_rest_on(self) -> None:
        # Everything in a scene sits on z = 0. A table whose base was there
        # would bury the lot of it one thickness deep.
        mesh = stage.build_surface(surface(sweep_height_mm=0.0))
        _, _, (low, high) = bounds(mesh)
        self.assertAlmostEqual(high, 0.0)
        self.assertAlmostEqual(low, -18.0 * MM)

    def test_a_sweep_rises_behind_the_scene_and_nowhere_else(self) -> None:
        mesh = stage.build_surface(surface(sweep_height_mm=500.0))
        (_, _), (near, far), (_, high) = bounds(mesh)
        self.assertAlmostEqual(high, 500.0 * MM)
        # Behind: the wall stands at the far edge, and the near edge is still
        # the tabletop's own front.
        self.assertAlmostEqual(near, -600.0 * MM)
        self.assertAlmostEqual(far, 600.0 * MM + 18.0 * MM)
        for x, y, z in mesh.vertices:
            if z > 1e-9:
                self.assertGreater(y, 0.0, f'{(x, y, z)} rises in front of the scene')

    def test_the_table_spans_the_millimetres_it_was_given(self) -> None:
        mesh = stage.build_surface(surface(width_mm=900.0, depth_mm=600.0, sweep_height_mm=0.0))
        (left, right), (near, far), _ = bounds(mesh)
        self.assertAlmostEqual(right - left, 900.0 * MM)
        self.assertAlmostEqual(far - near, 600.0 * MM)

    def test_it_is_centred_on_the_scene_it_stands_under(self) -> None:
        mesh = stage.build_surface(surface(sweep_height_mm=0.0))
        (left, right), (near, far), _ = bounds(mesh)
        self.assertAlmostEqual(left, -right)
        self.assertAlmostEqual(near, -far)

    def test_the_conversion_is_not_applied_twice_or_left_off(self) -> None:
        # A metre table cut in millimetres is a thousand times out, and the
        # importer is the only place that boundary is crossed.
        mesh = stage.build_surface(surface(width_mm=1000.0))
        (left, right), _, _ = bounds(mesh)
        self.assertAlmostEqual(right - left, 1.0)

    def test_the_fillet_stays_inside_the_table_it_turns_on(self) -> None:
        radius = stage.fillet_radius(10.0, 1.2)
        self.assertLessEqual(radius, 1.2 * 0.5)
        self.assertGreater(radius, 0.0)

    def test_a_flat_table_has_no_fillet_to_turn(self) -> None:
        self.assertEqual(stage.fillet_radius(0.0, 1.2), 0.0)


class WhatTheTableRefuses(unittest.TestCase):
    def test_a_table_cut_past_the_bound_is_named(self) -> None:
        high = SURFACE_LIMITS['width_mm'][1]
        with self.assertRaises(SceneError) as caught:
            stage.build_surface(surface(width_mm=high + 1))
        self.assertIn('width_mm', str(caught.exception))

    def test_a_table_with_no_thickness_is_named(self) -> None:
        with self.assertRaises(SceneError):
            stage.build_surface(surface(thickness_mm=0.0))


if __name__ == '__main__':
    unittest.main()
