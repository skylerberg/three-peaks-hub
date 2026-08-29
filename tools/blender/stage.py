"""The table the components stand on, and the sweep that rises behind it.

Geometry only, and no bpy, for the reason pieces.py has none: a profile is worth
arguing about with python3 and a print statement rather than by opening Blender.
scene.py hands what comes back to from_pydata the same way it hands it a library
piece.

The whole thing is one closed solid, extruded across the table's width from a
profile drawn in the y-z plane. Reading that profile from the front edge
backwards: the tabletop runs flat at z = 0, curves up through a fillet, and
stands vertically to the sweep's height -- one continuous surface, which is what
a photographer's sweep is and why the corner behind a product never shows. The
material has a thickness, so the far side of that surface comes back the same
way one thickness out, and the two ends close it.

**The top is z = 0, not the base.** Every instance already rests on that plane,
so a scene that gains a table moves nothing that was standing in it.
"""

from __future__ import annotations

import math
from typing import List, Sequence, Tuple

from pieces import Mesh
from scenedoc import MM, SURFACE_LIMITS, SceneError, SurfaceSpec

Vec2 = Tuple[float, float]

SURFACE_MATERIAL = 'surface'
SURFACE_MESH_NAME = 'Table'

# Segments across the fillet. Enough that its silhouette is a curve rather than
# a chamfer; it is shaded smooth, so the count only has to hold up in outline.
_FILLET_SEGMENTS = 12

# How much of the sweep's height the fillet spends turning the corner, and how
# much of the table's depth it is allowed to eat. A tight radius reads as
# skirting rather than as a sweep; one deeper than the table is a ramp.
_FILLET_OF_HEIGHT = 0.55
_FILLET_OF_DEPTH = 0.3


def _arc(centre: Vec2, radius: float, start_deg: float, end_deg: float) -> List[Vec2]:
    """Points along an arc, the first included and the last left out.

    Left out because each arc here runs into a point the caller writes down
    itself, and a repeated vertex is a zero-length edge -- which validate() then
    removes, sliding every later smooth flag onto the wrong polygon.
    """
    start = math.radians(start_deg)
    span = math.radians(end_deg - start_deg)
    return [
        (
            centre[0] + radius * math.cos(start + span * step / _FILLET_SEGMENTS),
            centre[1] + radius * math.sin(start + span * step / _FILLET_SEGMENTS),
        )
        for step in range(_FILLET_SEGMENTS)
    ]


def fillet_radius(sweep_height_m: float, depth_m: float) -> float:
    if sweep_height_m <= 0.0:
        return 0.0
    return min(sweep_height_m * _FILLET_OF_HEIGHT, depth_m * _FILLET_OF_DEPTH)


def surface_profile(
    depth_m: float, thickness_m: float, sweep_height_m: float
) -> Tuple[List[Vec2], List[bool]]:
    """The closed outline in (y, z), and whether each edge belongs to the fillet.

    Counterclockwise: the underside runs towards +y and the tabletop comes back,
    which is what points every face outwards once the profile is extruded. It is
    written in that direction rather than reversed afterwards, so each edge's
    smooth flag stays beside the point it leaves from.
    """
    half = depth_m / 2.0
    radius = fillet_radius(sweep_height_m, depth_m)

    if radius <= 0.0:
        # A plain slab. Not a special case for its own sake: a sweep of no
        # height has no corner to turn, and an arc of no radius is a fan of
        # coincident points where the back edge should be.
        return (
            [(-half, -thickness_m), (half, -thickness_m), (half, 0.0), (-half, 0.0)],
            [False, False, False, False],
        )

    centre = (half - radius, radius)
    points: List[Vec2] = [(-half, -thickness_m)]
    smooth: List[bool] = [False]

    # Round the back of the slab and up the outside of the wall, one thickness
    # out from the fillet the tabletop turns through.
    outer = _arc(centre, radius + thickness_m, -90.0, 0.0)
    points.extend(outer)
    smooth.extend([True] * len(outer))

    for point in ((half + thickness_m, radius), (half + thickness_m, sweep_height_m)):
        points.append(point)
        smooth.append(False)
    # Over the top of the wall and back down its face, to where the fillet
    # begins.
    points.append((half, sweep_height_m))
    smooth.append(False)

    inner = _arc(centre, radius, 0.0, -90.0)
    points.extend(inner)
    smooth.extend([True] * len(inner))

    # The tabletop, and the front edge closing the loop.
    for point in ((half - radius, 0.0), (-half, 0.0)):
        points.append(point)
        smooth.append(False)
    return points, smooth


def _extrude_profile(
    name: str, width_m: float, points: Sequence[Vec2], smooth: Sequence[bool]
) -> Mesh:
    half = width_m / 2.0
    count = len(points)
    vertices = [(-half, y, z) for y, z in points] + [(half, y, z) for y, z in points]

    # Built in lockstep, which is what makes a face and its smooth flag agree
    # without a second list to keep in order.
    faces: List[Tuple[int, ...]] = []
    flags: List[bool] = []
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
        flags.append(bool(smooth[index]))

    # The near cap runs the profile backwards so its normal leaves the solid;
    # the far one keeps the counterclockwise order it was written in.
    faces.append(tuple(reversed(range(count))))
    flags.append(False)
    faces.append(tuple(range(count, 2 * count)))
    flags.append(False)
    return Mesh(name, SURFACE_MATERIAL, tuple(vertices), tuple(faces), tuple(flags))


def build_surface(spec: SurfaceSpec) -> Mesh:
    """The table as one closed solid, in metres, with its top face on z = 0."""
    for field in ('width_mm', 'depth_mm', 'thickness_mm', 'sweep_height_mm'):
        value = getattr(spec, field)
        low, high = SURFACE_LIMITS[field]
        if not math.isfinite(value) or value < low or value > high:
            raise SceneError(f'surface {field} is {value}, outside {low} to {high}')

    points, smooth = surface_profile(
        spec.depth_mm * MM, spec.thickness_mm * MM, spec.sweep_height_mm * MM
    )
    return _extrude_profile(SURFACE_MESH_NAME, spec.width_mm * MM, points, smooth)
