"""Parametric geometry for the library pieces.

A library piece has no source file, no settings row and no bytes in the bundle:
scene.json names it and a size, and the importer builds it. That is what this
module is -- vertices and faces, no bpy, so the shape of a meeple can be argued
about with python3 rather than by opening Blender.

Sizes arrive in the document's millimetres and every mesh comes back in metres,
converted through scenedoc.MM as the vertices are written.

Two conventions hold for every piece, because a scene places them all the same
way. Each one **stands on z = 0 and is centred on x = y = 0**, so an instance's
position_mm is the spot on the table the piece occupies and a spin about the
object's own Z is the spin anyone means. And each face carries its own smooth
flag: Blender shades per face, so a disc's rim can be round while its lid stays
flat without a modifier or a split-normals pass.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Sequence, Tuple

from scenedoc import MM, SCENE_LIMITS, SceneError

Vec3 = Tuple[float, float, float]
Vec2 = Tuple[float, float]
Face = Tuple[int, ...]

BODY_MATERIAL = 'body'
PIP_MATERIAL = 'pip'

_TUBE_SEGMENTS = 48
_DISC_THICKNESS_RATIO = 0.15
_CYLINDER_DIAMETER_RATIO = 0.5

_D6_CORNER_RATIO = 0.13
_D6_EDGE_STEPS = 4
_D6_INNER_STEPS = 2
_D6_PIP_RADIUS_RATIO = 0.075
_D6_PIP_OFFSET_RATIO = 0.21
# A pip is a shallow spherical cap, not a ball half sunk into the face: a die
# rests on a table, and anything standing proud of the down face by more than a
# rounding error puts the whole piece on stilts. Only the top of the dome shows;
# the rest is buried, which is also what keeps its rim off the flat face where
# two coplanar surfaces would fight.
_D6_PIP_DOME_RATIO = 0.020
_D6_PIP_BURY_RATIO = 0.005
_DOME_RINGS = 4
_DOME_SEGMENTS = 12

_MEEPLE_THICKNESS_RATIO = 0.45
_MEEPLE_ARC_STEPS = 12


@dataclass(frozen=True)
class Mesh:
    """Plain mesh data, in metres, for the bpy layer to hand to from_pydata."""

    name: str
    material: str
    vertices: Tuple[Vec3, ...]
    faces: Tuple[Face, ...]
    smooth: Tuple[bool, ...]


def _mesh(
    name: str,
    material: str,
    vertices: Sequence[Vec3],
    faces: Sequence[Face],
    smooth: Sequence[bool],
) -> Mesh:
    if len(faces) != len(smooth):
        raise SceneError(f'mesh "{name}" has {len(faces)} faces and {len(smooth)} smooth flags')
    return Mesh(name, material, tuple(vertices), tuple(faces), tuple(smooth))


# --- primitives ---------------------------------------------------------------


def _box(name: str, width_m: float, depth_m: float, height_m: float) -> Mesh:
    half_w = width_m / 2.0
    half_d = depth_m / 2.0
    vertices: List[Vec3] = [
        (-half_w, -half_d, 0.0),
        (half_w, -half_d, 0.0),
        (half_w, half_d, 0.0),
        (-half_w, half_d, 0.0),
        (-half_w, -half_d, height_m),
        (half_w, -half_d, height_m),
        (half_w, half_d, height_m),
        (-half_w, half_d, height_m),
    ]
    faces: List[Face] = [
        (0, 3, 2, 1),
        (4, 5, 6, 7),
        (0, 1, 5, 4),
        (1, 2, 6, 5),
        (2, 3, 7, 6),
        (3, 0, 4, 7),
    ]
    return _mesh(name, BODY_MATERIAL, vertices, faces, [False] * len(faces))


def _tube(name: str, radius_m: float, height_m: float, segments: int) -> Mesh:
    vertices: List[Vec3] = []
    for level in (0.0, height_m):
        for step in range(segments):
            angle = step / segments * math.tau
            vertices.append((radius_m * math.cos(angle), radius_m * math.sin(angle), level))
    faces: List[Face] = [tuple(reversed(range(segments))), tuple(range(segments, 2 * segments))]
    smooth = [False, False]
    for step in range(segments):
        nxt = (step + 1) % segments
        faces.append((step, nxt, segments + nxt, segments + step))
        smooth.append(True)
    return _mesh(name, BODY_MATERIAL, vertices, faces, smooth)


def _dome_into(
    vertices: List[Vec3],
    faces: List[Face],
    smooth: List[bool],
    base: Vec3,
    normal: Vec3,
    across: Vec3,
    along: Vec3,
    base_radius: float,
    height: float,
    rings: int,
    segments: int,
) -> None:
    """A spherical cap standing on a flat disc, so the dome is a closed solid."""
    sphere_radius = (base_radius * base_radius + height * height) / (2.0 * height)
    cap = math.atan2(base_radius, sphere_radius - height)
    centre = tuple(base[axis] - normal[axis] * (sphere_radius - height) for axis in range(3))
    first = len(vertices)
    vertices.append(tuple(centre[axis] + normal[axis] * sphere_radius for axis in range(3)))
    for ring in range(1, rings + 1):
        polar = ring / rings * cap
        axial = sphere_radius * math.cos(polar)
        radial = sphere_radius * math.sin(polar)
        for step in range(segments):
            angle = step / segments * math.tau
            vertices.append(
                tuple(
                    centre[axis]
                    + normal[axis] * axial
                    + across[axis] * radial * math.cos(angle)
                    + along[axis] * radial * math.sin(angle)
                    for axis in range(3)
                )
            )

    def at(ring: int, step: int) -> int:
        return first + 1 + (ring - 1) * segments + (step % segments)

    for step in range(segments):
        faces.append((first, at(1, step), at(1, step + 1)))
        smooth.append(True)
    for ring in range(1, rings):
        for step in range(segments):
            faces.append(
                (at(ring, step), at(ring + 1, step), at(ring + 1, step + 1), at(ring, step + 1))
            )
            smooth.append(True)
    faces.append(tuple(reversed([at(rings, step) for step in range(segments)])))
    smooth.append(False)


# --- the d6 -------------------------------------------------------------------

# Normal, then the two in-plane axes, chosen so a x b == n and a face's grid is
# already wound outward.
_D6_FACE_BASES: Tuple[Tuple[Vec3, Vec3, Vec3], ...] = (
    ((1.0, 0.0, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)),
    ((-1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, 1.0, 0.0)),
    ((0.0, 1.0, 0.0), (0.0, 0.0, 1.0), (1.0, 0.0, 0.0)),
    ((0.0, -1.0, 0.0), (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)),
    ((0.0, 0.0, 1.0), (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)),
    ((0.0, 0.0, -1.0), (0.0, 1.0, 0.0), (1.0, 0.0, 0.0)),
)

# Opposite faces sum to seven, in the order _D6_FACE_BASES lists them -- and
# one, two, three run counter-clockwise around the corner they share, which is
# the right-handed arrangement every Western die is cut to. The mirror image is
# a real die too, just an Asian one, and it is not what a trailer wants.
_D6_FACE_VALUES = (2, 5, 3, 4, 1, 6)

_D6_PIP_LAYOUT: Dict[int, Tuple[Vec2, ...]] = {
    1: ((0.0, 0.0),),
    2: ((-1.0, -1.0), (1.0, 1.0)),
    3: ((-1.0, -1.0), (0.0, 0.0), (1.0, 1.0)),
    4: ((-1.0, -1.0), (-1.0, 1.0), (1.0, -1.0), (1.0, 1.0)),
    5: ((-1.0, -1.0), (-1.0, 1.0), (0.0, 0.0), (1.0, -1.0), (1.0, 1.0)),
    6: ((-1.0, -1.0), (-1.0, 0.0), (-1.0, 1.0), (1.0, -1.0), (1.0, 0.0), (1.0, 1.0)),
}


def _d6_axis_samples(half: float, radius: float) -> List[float]:
    """Where to cut the die along one axis, from -half to +half.

    Sampled evenly in *angle* around the fillet rather than evenly in distance:
    a uniform grid puts barely one cell in a corner that occupies a tenth of
    the side, and the die comes out with facets for corners.
    """
    inner = half - radius
    out: List[float] = []
    for step in range(_D6_EDGE_STEPS, 0, -1):
        out.append(-(inner + radius * math.tan(step / _D6_EDGE_STEPS * math.pi / 4.0)))
    for step in range(_D6_INNER_STEPS + 1):
        out.append(-inner + 2.0 * inner * step / _D6_INNER_STEPS)
    for step in range(1, _D6_EDGE_STEPS + 1):
        out.append(inner + radius * math.tan(step / _D6_EDGE_STEPS * math.pi / 4.0))
    return out


def _round_corner(point: Vec3, inner: float, radius: float) -> Vec3:
    """Pull a point on the cube onto the rounded box of the same size.

    The core is the point clamped into the box the fillet centres live on; the
    surface is one radius away from it, which leaves the flat middle of a face
    exactly where it was and bends only what overhangs.
    """
    core = tuple(max(-inner, min(inner, axis)) for axis in point)
    delta = (point[0] - core[0], point[1] - core[1], point[2] - core[2])
    length = math.sqrt(delta[0] ** 2 + delta[1] ** 2 + delta[2] ** 2)
    if length == 0.0:
        return point
    scale = radius / length
    return (core[0] + delta[0] * scale, core[1] + delta[1] * scale, core[2] + delta[2] * scale)


def _d6_body(size_m: float) -> Mesh:
    half = size_m / 2.0
    radius = size_m * _D6_CORNER_RATIO
    inner = half - radius
    samples = _d6_axis_samples(half, radius)
    vertices: List[Vec3] = []
    lookup: Dict[Tuple[float, float, float], int] = {}
    faces: List[Face] = []

    def index_of(point: Vec3) -> int:
        key = (round(point[0], 9), round(point[1], 9), round(point[2], 9))
        found = lookup.get(key)
        if found is not None:
            return found
        rounded = _round_corner(point, inner, radius)
        # Every piece stands on the ground, so the die is lifted by its own
        # half-height as it is built rather than by a transform later.
        vertices.append((rounded[0], rounded[1], rounded[2] + half))
        lookup[key] = len(vertices) - 1
        return lookup[key]

    for normal, axis_a, axis_b in _D6_FACE_BASES:
        def at(u: float, v: float) -> Vec3:
            return (
                normal[0] * half + axis_a[0] * u + axis_b[0] * v,
                normal[1] * half + axis_a[1] * u + axis_b[1] * v,
                normal[2] * half + axis_a[2] * u + axis_b[2] * v,
            )

        for i in range(len(samples) - 1):
            for j in range(len(samples) - 1):
                faces.append(
                    (
                        index_of(at(samples[i], samples[j])),
                        index_of(at(samples[i + 1], samples[j])),
                        index_of(at(samples[i + 1], samples[j + 1])),
                        index_of(at(samples[i], samples[j + 1])),
                    )
                )
    return _mesh('d6', BODY_MATERIAL, vertices, faces, [True] * len(faces))


def _d6_pips(size_m: float) -> Mesh:
    half = size_m / 2.0
    pip_radius = size_m * _D6_PIP_RADIUS_RATIO
    offset = size_m * _D6_PIP_OFFSET_RATIO
    dome = size_m * _D6_PIP_DOME_RATIO
    bury = size_m * _D6_PIP_BURY_RATIO
    vertices: List[Vec3] = []
    faces: List[Face] = []
    smooth: List[bool] = []
    for (normal, axis_a, axis_b), value in zip(_D6_FACE_BASES, _D6_FACE_VALUES):
        for u, v in _D6_PIP_LAYOUT[value]:
            base = (
                normal[0] * (half - bury) + axis_a[0] * u * offset + axis_b[0] * v * offset,
                normal[1] * (half - bury) + axis_a[1] * u * offset + axis_b[1] * v * offset,
                normal[2] * (half - bury) + axis_a[2] * u * offset + axis_b[2] * v * offset + half,
            )
            _dome_into(
                vertices,
                faces,
                smooth,
                base,
                normal,
                axis_a,
                axis_b,
                pip_radius,
                dome,
                _DOME_RINGS,
                _DOME_SEGMENTS,
            )
    return _mesh('d6_pips', PIP_MATERIAL, vertices, faces, smooth)


# --- the meeple ---------------------------------------------------------------

# The silhouette, in units of the piece's own height: head, arms and hips are
# circles, the notches between them are fillets tangent to both, and the legs
# are straight. Circles rather than hand-placed points, so the curves stay
# curves at any size and the whole outline is derived from nine numbers.
_MEEPLE_HEAD = ((0.0, 0.825), 0.175)
_MEEPLE_ARM = ((0.290, 0.475), 0.160)
_MEEPLE_HIP = ((0.170, 0.280), 0.130)
# Wide enough that the notch reaches down the head rather than nicking the
# shoulder: how deep the neck cuts is set by this radius, and a meeple without
# a neck reads as a chess pawn.
_MEEPLE_NECK_FILLET = 0.09
_MEEPLE_ARMPIT_FILLET = 0.05
_MEEPLE_FOOT_OUTER = 0.245
# Equal to the crotch radius on purpose: that is what makes the inner leg meet
# the notch tangentially instead of at a corner.
_MEEPLE_FOOT_INNER = 0.072
_MEEPLE_CROTCH = ((0.0, 0.200), 0.072)


def _angle_at(centre: Vec2, point: Vec2) -> float:
    return math.atan2(point[1] - centre[1], point[0] - centre[0])


def _towards(centre: Vec2, radius: float, point: Vec2) -> Vec2:
    dx = point[0] - centre[0]
    dy = point[1] - centre[1]
    span = math.hypot(dx, dy)
    if span == 0.0:
        raise SceneError('a tangent point was asked for at the centre of its own circle')
    return (centre[0] + radius * dx / span, centre[1] + radius * dy / span)


def _fillet_centre(
    first: Vec2, first_r: float, second: Vec2, second_r: float, fillet_r: float
) -> Vec2:
    """The centre of a circle of fillet_r touching both, left of first->second."""
    dx = second[0] - first[0]
    dy = second[1] - first[1]
    span = math.hypot(dx, dy)
    reach_a = first_r + fillet_r
    reach_b = second_r + fillet_r
    if span == 0.0 or span > reach_a + reach_b or span < abs(reach_a - reach_b):
        raise SceneError('no fillet of that radius touches both circles')
    along = (span * span + reach_a * reach_a - reach_b * reach_b) / (2.0 * span)
    across = math.sqrt(max(0.0, reach_a * reach_a - along * along))
    ux, uy = dx / span, dy / span
    return (first[0] + along * ux - across * uy, first[1] + along * uy + across * ux)


def _tangent_from(centre: Vec2, radius: float, point: Vec2) -> Vec2:
    """Where the outer tangent from an external point meets the circle."""
    dx = centre[0] - point[0]
    dy = centre[1] - point[1]
    span = math.hypot(dx, dy)
    if span <= radius:
        raise SceneError('a tangent was asked for from inside the circle')
    bearing = math.atan2(dy, dx) - math.asin(radius / span)
    reach = math.sqrt(span * span - radius * radius)
    return (point[0] + reach * math.cos(bearing), point[1] + reach * math.sin(bearing))


def _arc(centre: Vec2, radius: float, start: float, end: float, clockwise: bool) -> List[Vec2]:
    sweep = (end - start) % math.tau
    if clockwise:
        sweep -= math.tau
    steps = max(2, int(math.ceil(abs(sweep) / math.tau * 4 * _MEEPLE_ARC_STEPS)))
    return [
        (
            centre[0] + radius * math.cos(start + sweep * step / steps),
            centre[1] + radius * math.sin(start + sweep * step / steps),
        )
        for step in range(steps + 1)
    ]


def _extend(outline: List[Vec2], points: Sequence[Vec2]) -> None:
    for point in points:
        if outline and math.hypot(point[0] - outline[-1][0], point[1] - outline[-1][1]) < 1e-9:
            continue
        outline.append(point)


def meeple_outline() -> List[Vec2]:
    """The silhouette, closed and counter-clockwise, in units of its height.

    Built as one half from the crown down to the crotch and then mirrored, so
    the piece is symmetric by construction rather than by two lists agreeing.
    """
    head_c, head_r = _MEEPLE_HEAD
    arm_c, arm_r = _MEEPLE_ARM
    hip_c, hip_r = _MEEPLE_HIP
    crotch_c, crotch_r = _MEEPLE_CROTCH

    neck = _fillet_centre(head_c, head_r, arm_c, arm_r, _MEEPLE_NECK_FILLET)
    armpit = _fillet_centre(arm_c, arm_r, hip_c, hip_r, _MEEPLE_ARMPIT_FILLET)
    head_end = _towards(head_c, head_r, neck)
    arm_start = _towards(arm_c, arm_r, neck)
    arm_end = _towards(arm_c, arm_r, armpit)
    hip_start = _towards(hip_c, hip_r, armpit)
    hip_end = _tangent_from(hip_c, hip_r, (_MEEPLE_FOOT_OUTER, 0.0))

    half: List[Vec2] = []
    _extend(half, _arc(head_c, head_r, math.pi / 2.0, _angle_at(head_c, head_end), True))
    _extend(
        half,
        _arc(
            neck,
            _MEEPLE_NECK_FILLET,
            _angle_at(neck, head_end),
            _angle_at(neck, arm_start),
            False,
        ),
    )
    _extend(half, _arc(arm_c, arm_r, _angle_at(arm_c, arm_start), _angle_at(arm_c, arm_end), True))
    _extend(
        half,
        _arc(
            armpit,
            _MEEPLE_ARMPIT_FILLET,
            _angle_at(armpit, arm_end),
            _angle_at(armpit, hip_start),
            False,
        ),
    )
    _extend(half, _arc(hip_c, hip_r, _angle_at(hip_c, hip_start), _angle_at(hip_c, hip_end), True))
    _extend(half, [(_MEEPLE_FOOT_OUTER, 0.0), (_MEEPLE_FOOT_INNER, 0.0)])
    # The inner leg runs straight up to where it meets the crotch circle, which
    # is tangent there exactly because the leg and the radius are both
    # _MEEPLE_FOOT_INNER wide.
    _extend(half, _arc(crotch_c, crotch_r, 0.0, math.pi / 2.0, False))

    outline = list(half) + [(-x, y) for x, y in reversed(half[1:-1])]
    return outline if _signed_area(outline) > 0.0 else list(reversed(outline))


def _signed_area(outline: Sequence[Vec2]) -> float:
    total = 0.0
    for index, (x, y) in enumerate(outline):
        nx, ny = outline[(index + 1) % len(outline)]
        total += x * ny - nx * y
    return total / 2.0


def _extrude(name: str, outline: Sequence[Vec2], thickness_m: float) -> Mesh:
    """Turn a counter-clockwise (x, z) outline into a slab of the given depth.

    The silhouette stands up: the outline's second coordinate is world z, and
    the thickness runs along y, so the piece faces the camera the way it faces
    the reader.
    """
    count = len(outline)
    half = thickness_m / 2.0
    vertices: List[Vec3] = [(x, -half, z) for x, z in outline]
    vertices.extend((x, half, z) for x, z in outline)
    faces: List[Face] = [tuple(range(count)), tuple(reversed(range(count, 2 * count)))]
    smooth = [False, False]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, count + index, count + nxt, nxt))
        smooth.append(True)
    return _mesh(name, BODY_MATERIAL, vertices, faces, smooth)


# --- the entry point ----------------------------------------------------------


def build_piece(piece: str, size_mm: float) -> Tuple[Mesh, ...]:
    """Every mesh one library piece is made of, in metres.

    size_mm is the piece's longest dimension, which each kind spends
    differently: a die and a cube on their edge, a disc on its diameter, a
    cylinder and a meeple on their height.
    """
    low, high = SCENE_LIMITS['library_size_mm']
    if not math.isfinite(size_mm) or size_mm < low or size_mm > high:
        raise SceneError(f'library piece "{piece}" is {size_mm} mm, outside {low} to {high}')
    size_m = size_mm * MM
    if piece == 'cube':
        return (_box('cube', size_m, size_m, size_m),)
    if piece == 'disc':
        return (_tube('disc', size_m / 2.0, size_m * _DISC_THICKNESS_RATIO, _TUBE_SEGMENTS),)
    if piece == 'cylinder':
        return (
            _tube(
                'cylinder',
                size_m * _CYLINDER_DIAMETER_RATIO / 2.0,
                size_m,
                _TUBE_SEGMENTS,
            ),
        )
    if piece == 'd6':
        return (_d6_body(size_m), _d6_pips(size_m))
    if piece == 'meeple':
        outline = [(x * size_m, y * size_m) for x, y in meeple_outline()]
        return (_extrude('meeple', outline, size_m * _MEEPLE_THICKNESS_RATIO),)
    raise SceneError(f'no library piece named "{piece}"')
