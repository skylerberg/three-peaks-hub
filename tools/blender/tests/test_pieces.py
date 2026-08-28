"""The parametric pieces: shape, size, and which way the faces point."""

from __future__ import annotations

import math
import sys
import unittest
from collections import Counter
from pathlib import Path
from typing import Dict, List, Sequence, Tuple

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pieces  # noqa: E402
from pieces import BODY_MATERIAL, PIP_MATERIAL, Mesh, build_piece, meeple_outline  # noqa: E402
from scenedoc import LIBRARY_PIECES, SceneError  # noqa: E402

Vec2 = Tuple[float, float]


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


def segments_cross(a: Vec2, b: Vec2, c: Vec2, d: Vec2) -> bool:
    def turn(origin: Vec2, first: Vec2, second: Vec2) -> float:
        return (first[0] - origin[0]) * (second[1] - origin[1]) - (first[1] - origin[1]) * (
            second[0] - origin[0]
        )

    return (turn(c, d, a) > 0) != (turn(c, d, b) > 0) and (turn(a, b, c) > 0) != (
        turn(a, b, d) > 0
    )


class EveryPieceIsASolid(unittest.TestCase):
    def meshes(self, size_mm: float = 16.0) -> List[Tuple[str, Mesh]]:
        return [
            (piece, mesh) for piece in LIBRARY_PIECES for mesh in build_piece(piece, size_mm)
        ]

    def test_the_library_is_complete(self) -> None:
        for piece in LIBRARY_PIECES:
            with self.subTest(piece):
                self.assertTrue(build_piece(piece, 16.0))

    def test_every_mesh_is_closed(self) -> None:
        for piece, mesh in self.meshes():
            with self.subTest(piece=piece, mesh=mesh.name):
                counted = half_edges(mesh)
                for (start, end), times in counted.items():
                    self.assertEqual(times, 1, f'{start}->{end} used twice the same way')
                    self.assertEqual(counted[(end, start)], 1, f'{start}->{end} has no opposite')

    def test_every_face_points_outward(self) -> None:
        for piece, mesh in self.meshes():
            with self.subTest(piece=piece, mesh=mesh.name):
                self.assertGreater(signed_volume(mesh), 0.0)

    def test_every_face_has_a_smooth_flag(self) -> None:
        for piece, mesh in self.meshes():
            with self.subTest(piece=piece, mesh=mesh.name):
                self.assertEqual(len(mesh.faces), len(mesh.smooth))

    def test_every_face_names_real_vertices(self) -> None:
        for piece, mesh in self.meshes():
            with self.subTest(piece=piece, mesh=mesh.name):
                for face in mesh.faces:
                    self.assertGreaterEqual(len(face), 3)
                    self.assertEqual(len(set(face)), len(face))
                    for index in face:
                        self.assertLess(index, len(mesh.vertices))

    def test_every_body_stands_on_the_ground(self) -> None:
        for piece, mesh in self.meshes():
            if mesh.material != BODY_MATERIAL:
                continue
            with self.subTest(piece=piece, mesh=mesh.name):
                self.assertAlmostEqual(bounds(mesh)[2][0], 0.0, places=12)

    def test_nothing_else_reaches_far_below_the_ground(self) -> None:
        # A die's down-face pips stand proud of it and so dip under the table.
        # By a fifth of a millimetre on a 16 mm die, which is the trade for
        # having pips at all without a boolean.
        for piece in LIBRARY_PIECES:
            floor = min(bounds(mesh)[2][0] for mesh in build_piece(piece, 16.0))
            self.assertGreater(floor, -0.0005, msg=f'{piece} sinks into the table')

    def test_every_piece_is_centred_on_its_own_axis(self) -> None:
        for piece in LIBRARY_PIECES:
            with self.subTest(piece):
                meshes = build_piece(piece, 16.0)
                for axis in (0, 1):
                    low = min(bounds(mesh)[axis][0] for mesh in meshes)
                    high = max(bounds(mesh)[axis][1] for mesh in meshes)
                    self.assertAlmostEqual(low, -high, places=12)

    def test_the_same_size_builds_the_same_piece_twice(self) -> None:
        for piece in LIBRARY_PIECES:
            with self.subTest(piece):
                self.assertEqual(build_piece(piece, 22.0), build_piece(piece, 22.0))


class SizesAreMillimetresInAndMetresOut(unittest.TestCase):
    def test_a_sixteen_millimetre_cube_measures_sixteen_thousandths(self) -> None:
        (cube,) = build_piece('cube', 16.0)
        for axis in range(3):
            low, high = bounds(cube)[axis]
            self.assertAlmostEqual(high - low, 0.016, places=12)

    def test_the_conversion_is_not_applied_twice_or_left_off(self) -> None:
        (cube,) = build_piece('cube', 16.0)
        width = bounds(cube)[0][1] - bounds(cube)[0][0]
        self.assertNotAlmostEqual(width, 16.0)
        self.assertNotAlmostEqual(width, 0.000016)

    def test_a_disc_spends_its_size_on_its_diameter(self) -> None:
        (disc,) = build_piece('disc', 22.0)
        (low_x, high_x), _, (low_z, high_z) = bounds(disc)
        self.assertAlmostEqual(high_x - low_x, 0.022, places=4)
        self.assertAlmostEqual(high_z - low_z, 0.022 * 0.15, places=12)

    def test_a_cylinder_spends_its_size_on_its_height(self) -> None:
        (cylinder,) = build_piece('cylinder', 20.0)
        (low_x, high_x), _, (low_z, high_z) = bounds(cylinder)
        self.assertAlmostEqual(high_z - low_z, 0.020, places=12)
        self.assertAlmostEqual(high_x - low_x, 0.010, places=4)

    def test_a_meeple_spends_its_size_on_its_height(self) -> None:
        (meeple,) = build_piece('meeple', 16.0)
        (low_x, high_x), (low_y, high_y), (low_z, high_z) = bounds(meeple)
        self.assertAlmostEqual(high_z - low_z, 0.016, places=12)
        # The widest point of the arm falls between two arc samples unless one
        # happens to land on it, so this is the outline's resolution rather
        # than a proportion that drifted.
        self.assertAlmostEqual(high_x - low_x, 0.016 * 0.9, places=5)
        self.assertAlmostEqual(high_y - low_y, 0.016 * 0.45, places=12)

    def test_a_size_outside_the_documents_bounds_is_refused(self) -> None:
        for size in (0.0, 900.0, float('nan')):
            with self.subTest(size=size):
                with self.assertRaises(SceneError):
                    build_piece('cube', size)

    def test_an_unknown_piece_is_refused(self) -> None:
        with self.assertRaises(SceneError) as caught:
            build_piece('obelisk', 16.0)
        self.assertIn('obelisk', str(caught.exception))


class TheDie(unittest.TestCase):
    def setUp(self) -> None:
        self.size = 16.0
        self.body, self.pips = build_piece('d6', self.size)
        self.half = self.size * 0.001 / 2.0

    def test_it_comes_in_two_parts(self) -> None:
        self.assertEqual(self.body.material, BODY_MATERIAL)
        self.assertEqual(self.pips.material, PIP_MATERIAL)

    def test_it_measures_its_own_size(self) -> None:
        for axis in range(3):
            low, high = bounds(self.body)[axis]
            self.assertAlmostEqual(high - low, 0.016, places=12)

    def test_its_corners_are_rounded(self) -> None:
        centre = (0.0, 0.0, self.half)
        sharp = self.half * math.sqrt(3.0)
        furthest = max(
            math.dist(vertex, centre) for vertex in self.body.vertices
        )
        self.assertLess(furthest, sharp * 0.98)
        self.assertGreater(furthest, self.half)

    def test_it_is_shaded_smooth(self) -> None:
        self.assertTrue(all(self.body.smooth))

    def domes(self) -> List[Sequence[Tuple[float, float, float]]]:
        per_dome = 1 + pieces._DOME_RINGS * pieces._DOME_SEGMENTS
        self.assertEqual(len(self.pips.vertices) % per_dome, 0)
        return [
            self.pips.vertices[start : start + per_dome]
            for start in range(0, len(self.pips.vertices), per_dome)
        ]

    def sphere_centres(self) -> List[Tuple[float, float, float]]:
        return [
            tuple(sum(v[axis] for v in block) / len(block) for axis in range(3))
            for block in self.domes()
        ]

    def test_it_carries_twenty_one_pips(self) -> None:
        self.assertEqual(len(self.sphere_centres()), 21)

    def test_opposite_faces_add_up_to_seven(self) -> None:
        counts = self.face_values()
        self.assertEqual(len(counts), 6)
        self.assertEqual(sorted(counts.values()), [1, 2, 3, 4, 5, 6])
        for axis in range(3):
            self.assertEqual(counts[(axis, 1)] + counts[(axis, -1)], 7)

    def face_values(self) -> Dict[Tuple[int, int], int]:
        counts: Dict[Tuple[int, int], int] = {}
        for centre in self.sphere_centres():
            local = (centre[0], centre[1], centre[2] - self.half)
            axis = max(range(3), key=lambda index: abs(local[index]))
            key = (axis, 1 if local[axis] > 0 else -1)
            counts[key] = counts.get(key, 0) + 1
        return counts

    def test_it_is_a_right_handed_die(self) -> None:
        normals = {value: key for key, value in self.face_values().items()}

        def unit(value: int) -> Tuple[float, float, float]:
            axis, sign = normals[value]
            return tuple(float(sign) if index == axis else 0.0 for index in range(3))

        one, two, three = unit(1), unit(2), unit(3)
        cross = (
            one[1] * two[2] - one[2] * two[1],
            one[2] * two[0] - one[0] * two[2],
            one[0] * two[1] - one[1] * two[0],
        )
        self.assertGreater(sum(cross[axis] * three[axis] for axis in range(3)), 0.0)

    def test_every_pip_sits_on_the_flat_of_its_face(self) -> None:
        radius = self.size * 0.001 * pieces._D6_PIP_RADIUS_RATIO
        inner = self.half - self.size * 0.001 * pieces._D6_CORNER_RATIO
        for centre in self.sphere_centres():
            local = (centre[0], centre[1], centre[2] - self.half)
            axis = max(range(3), key=lambda index: abs(local[index]))
            for other in range(3):
                if other == axis:
                    continue
                self.assertLess(abs(local[other]) + radius, inner)

    def dome_reach(self) -> List[Tuple[float, float]]:
        """How far each dome's apex and rim sit from the centre of the die."""
        out = []
        for block, centre in zip(self.domes(), self.sphere_centres()):
            local_centre = (centre[0], centre[1], centre[2] - self.half)
            axis = max(range(3), key=lambda index: abs(local_centre[index]))
            sign = 1.0 if local_centre[axis] > 0 else -1.0
            reach = [(vertex[axis] - (self.half if axis == 2 else 0.0)) * sign for vertex in block]
            out.append((max(reach), min(reach)))
        return out

    def test_a_pip_stands_proud_by_the_dome_it_was_given(self) -> None:
        proud = self.size * 0.001 * (pieces._D6_PIP_DOME_RATIO - pieces._D6_PIP_BURY_RATIO)
        for apex, _ in self.dome_reach():
            self.assertAlmostEqual(apex, self.half + proud, places=12)

    def test_a_pip_barely_stands_proud_at_all(self) -> None:
        # It has to show, and it has to not put the die on stilts when the face
        # it is on is the one resting on the table.
        for apex, _ in self.dome_reach():
            self.assertGreater(apex - self.half, self.size * 0.001 * 0.005)
            self.assertLess(apex - self.half, self.size * 0.001 * 0.018)

    def test_a_pip_keeps_its_rim_inside_the_body(self) -> None:
        # A rim landing on the face plane is two coplanar surfaces, which is a
        # flickering ring around every pip.
        for _, rim in self.dome_reach():
            self.assertLess(rim, self.half - self.size * 0.001 * 0.001)


class TheMeeple(unittest.TestCase):
    def setUp(self) -> None:
        self.outline = meeple_outline()

    def test_the_outline_is_symmetric_about_its_own_axis(self) -> None:
        mirrored = {(round(-x, 12), round(y, 12)) for x, y in self.outline}
        original = {(round(x, 12), round(y, 12)) for x, y in self.outline}
        self.assertEqual(mirrored, original)

    def test_it_stands_a_unit_high_and_is_the_width_of_a_meeple(self) -> None:
        self.assertAlmostEqual(max(y for _, y in self.outline), 1.0, places=12)
        self.assertAlmostEqual(min(y for _, y in self.outline), 0.0, places=12)
        self.assertAlmostEqual(max(x for x, _ in self.outline) * 2.0, 0.9, places=3)

    def test_it_is_wound_counter_clockwise(self) -> None:
        self.assertGreater(pieces._signed_area(self.outline), 0.0)

    def test_the_edge_never_crosses_itself(self) -> None:
        count = len(self.outline)
        for first in range(count):
            for second in range(first + 2, count):
                if first == 0 and second == count - 1:
                    continue
                with self.subTest(first=first, second=second):
                    self.assertFalse(
                        segments_cross(
                            self.outline[first],
                            self.outline[(first + 1) % count],
                            self.outline[second],
                            self.outline[(second + 1) % count],
                        )
                    )

    def test_it_has_a_neck(self) -> None:
        # The head is wider above the notch than the silhouette is at it, which
        # is the whole difference between a meeple and a chess pawn.
        head = self.width_at(0.90)
        neck = self.width_at(0.70)
        shoulders = self.width_at(0.55)
        self.assertLess(neck, head)
        self.assertLess(neck, shoulders * 0.5)

    def test_it_has_two_legs(self) -> None:
        self.assertEqual(len(self.spans_at(0.05)), 2)
        self.assertEqual(len(self.spans_at(0.55)), 1)

    def test_the_arms_are_the_widest_part(self) -> None:
        widest = max(x for x, _ in self.outline)
        self.assertAlmostEqual(self.width_at(0.475) / 2.0, widest, places=3)

    def spans_at(self, height: float) -> List[Tuple[float, float]]:
        crossings: List[float] = []
        count = len(self.outline)
        for index in range(count):
            (x0, y0) = self.outline[index]
            (x1, y1) = self.outline[(index + 1) % count]
            if (y0 > height) != (y1 > height):
                crossings.append(x0 + (height - y0) * (x1 - x0) / (y1 - y0))
        crossings.sort()
        return list(zip(crossings[0::2], crossings[1::2]))

    def width_at(self, height: float) -> float:
        return sum(high - low for low, high in self.spans_at(height))


if __name__ == '__main__':
    unittest.main()
