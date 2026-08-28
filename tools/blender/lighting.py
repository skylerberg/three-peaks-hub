"""Light rigs and world shaders, one per preset the document may name.

A rig is sized off what is actually in the scene rather than off numbers in the
document, because the document says nothing about how big a selection turned out
to be: the same 'studio' preset has to light one 16 mm meeple and a 500 mm board.
Everything below is therefore written in multiples of the subject's own radius,
and the wattages follow the inverse square law out to wherever that puts a lamp.

Every lamp is aimed by a Track To constraint at one empty. That is what makes
the rig grabbable afterwards -- drag a light anywhere and it stays pointed at the
subject, which is the first thing anyone does to a preset they nearly like.
"""

import bpy
from mathutils import Vector

from materials import hex_to_linear

# Wattage for a key lamp one metre from the subject. An area light's power is
# spread over the hemisphere, so the irradiance reaching the subject is roughly
# P / (4 pi d squared) and every rig below scales by d squared -- which is what
# makes one preset read the same on a 16 mm die as on a 500 mm board.
#
# The value is what puts a mid albedo surface near the middle of the exposure
# under the view transform scene.py chooses. It was tuned by rendering, not
# derived: three stops brighter and a #c0392b die comes out pale salmon.
_WATTS_AT_ONE_METRE = 18.0

# Lamps sit this many subject-radii out. Close enough that an area light of a
# comparable size is a genuinely soft source rather than a distant point.
_STANDOFF = 3.2

# A rig for something very small still needs somewhere to stand.
_MIN_RADIUS = 0.015

# How many frames across the range the subject is measured at.
_BOUNDS_SAMPLES = 5


class _Lamp:
    def __init__(self, name, offset, size, watts, color=(1.0, 1.0, 1.0)):
        self.name = name
        # In standoff units, from the subject's centre. +X right, +Y away from
        # the camera, +Z up.
        self.offset = Vector(offset)
        # In subject radii. A source wider than its subject wraps the light
        # around it; a narrow one cuts a hard edge, which is the whole
        # difference between the softbox preset and the dramatic one.
        self.size = size
        self.watts = watts
        self.color = color


# Warm key, cooler fill: the split is what stops a render reading as one flat
# lamp, and it survives being handed to somebody who then moves everything.
_WARM = (1.0, 0.94, 0.86)
_COOL = (0.84, 0.9, 1.0)

_RIGS = {
    'studio': [
        _Lamp('Key', (-0.85, -0.85, 0.95), 2.4, 1.0, _WARM),
        _Lamp('Fill', (1.05, -0.6, 0.2), 3.6, 0.3, _COOL),
        _Lamp('Rim', (0.45, 1.05, 0.85), 1.4, 0.75, (1.0, 0.97, 0.92)),
    ],
    'softbox': [
        _Lamp('Softbox Key', (-0.25, -0.75, 1.05), 6.5, 1.0, (1.0, 0.97, 0.94)),
        _Lamp('Softbox Fill', (0.85, -0.85, 0.15), 6.5, 0.5, _COOL),
        _Lamp('Softbox Rim', (0.0, 1.1, 0.55), 3.0, 0.28, (1.0, 1.0, 1.0)),
    ],
    'dramatic': [
        _Lamp('Key', (-1.0, -0.45, 1.15), 0.7, 1.35, (1.0, 0.9, 0.78)),
        _Lamp('Rim', (0.95, 0.95, 0.6), 0.5, 1.1, (0.78, 0.86, 1.0)),
        _Lamp('Fill', (0.9, -0.9, 0.1), 4.0, 0.06, _COOL),
    ],
    'flat': [
        _Lamp('Left', (-1.15, -0.75, 0.25), 6.0, 0.6, (1.0, 1.0, 1.0)),
        _Lamp('Right', (1.15, -0.75, 0.25), 6.0, 0.6, (1.0, 1.0, 1.0)),
        _Lamp('Top', (0.0, -0.15, 1.25), 6.0, 0.6, (1.0, 1.0, 1.0)),
    ],
}

# How much of the picture the world itself lights. A dramatic key wants almost
# none of it; a flat preset is mostly this.
_AMBIENT = {'studio': 0.28, 'softbox': 0.5, 'dramatic': 0.05, 'flat': 1.1}


def _sampled_frames(scene):
    if scene.frame_end <= scene.frame_start:
        return [scene.frame_start]
    span = scene.frame_end - scene.frame_start
    steps = range(_BOUNDS_SAMPLES)
    return sorted(
        {scene.frame_start + round(span * step / (_BOUNDS_SAMPLES - 1)) for step in steps}
    )


def _bounds(objects, scene):
    """What the rig has to cover, over the whole shot rather than at one frame.

    Sampled across the range because a deal starts as a stack off the edge of
    the table and ends spread across it: a rig sized on either pose alone lights
    the other one from the wrong distance. frame_set is also what makes
    matrix_world current -- an object that was only just placed still reports
    the matrix it was created with.
    """
    corners = []
    original = scene.frame_current
    for frame in _sampled_frames(scene):
        scene.frame_set(frame)
        for root in objects:
            for ob in [root] + list(root.children_recursive):
                if ob.type != 'MESH':
                    continue
                corners.extend(ob.matrix_world @ Vector(corner) for corner in ob.bound_box)
    scene.frame_set(original)
    if not corners:
        return Vector((0.0, 0.0, 0.0)), _MIN_RADIUS, 0.0
    low = Vector((min(c.x for c in corners), min(c.y for c in corners), min(c.z for c in corners)))
    high = Vector((max(c.x for c in corners), max(c.y for c in corners), max(c.z for c in corners)))
    return (low + high) * 0.5, max((high - low).length * 0.5, _MIN_RADIUS), low.z


def _lift(color, amount):
    """Move a colour toward white, in the linear space the socket is read in.

    Small numbers go a long way here: a near-black backdrop lifted by even a
    quarter comes back as mid grey once the view transform has had it.
    """
    return tuple(channel + (1.0 - channel) * amount for channel in color)


def _world(spec, preset):
    world = bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.use_nodes = True
    tree = world.node_tree
    tree.nodes.clear()

    output = tree.nodes.new('ShaderNodeOutputWorld')
    output.location = (400, 0)
    strength = max(spec.strength, 0.0)

    ambient = tree.nodes.new('ShaderNodeBackground')
    ambient.location = (0, 140)
    ambient.inputs['Color'].default_value = (0.42, 0.46, 0.52, 1.0)
    ambient.inputs['Strength'].default_value = _AMBIENT[preset] * strength

    if spec.background == 'transparent':
        # Nothing sees the world down the camera ray once the film is
        # transparent, so the only job left is the bounce light.
        tree.links.new(ambient.outputs['Background'], output.inputs['Surface'])
        return world

    base = hex_to_linear(spec.background_color)
    visible = tree.nodes.new('ShaderNodeBackground')
    visible.location = (0, -160)
    visible.inputs['Color'].default_value = (*base, 1.0)
    visible.inputs['Strength'].default_value = 1.0

    if spec.background == 'gradient':
        coord = tree.nodes.new('ShaderNodeTexCoord')
        coord.location = (-620, -160)
        split = tree.nodes.new('ShaderNodeSeparateXYZ')
        split.location = (-440, -160)
        ramp = tree.nodes.new('ShaderNodeValToRGB')
        ramp.location = (-260, -160)
        ramp.color_ramp.elements[0].position = 0.0
        ramp.color_ramp.elements[0].color = (*base, 1.0)
        ramp.color_ramp.elements[1].position = 1.0
        ramp.color_ramp.elements[1].color = (*_lift(base, 0.16), 1.0)
        tree.links.new(coord.outputs['Window'], split.inputs['Vector'])
        tree.links.new(split.outputs['Y'], ramp.inputs['Fac'])
        tree.links.new(ramp.outputs['Color'], visible.inputs['Color'])

    # The backdrop the camera sees and the light the scene gets are separate
    # jobs. Tying them together is what makes a dark background go black and a
    # bright one blow the subject out.
    light_path = tree.nodes.new('ShaderNodeLightPath')
    light_path.location = (0, 380)
    mix = tree.nodes.new('ShaderNodeMixShader')
    mix.location = (220, 0)
    tree.links.new(light_path.outputs['Is Camera Ray'], mix.inputs['Fac'])
    tree.links.new(ambient.outputs['Background'], mix.inputs[1])
    tree.links.new(visible.outputs['Background'], mix.inputs[2])
    tree.links.new(mix.outputs['Shader'], output.inputs['Surface'])
    return world


def _floor(spec, center, radius, floor_z, collection, engine):
    """A shadow catcher under the subject, so it sits on something.

    Only under Cycles, which is the engine carrying the flag, and only over an
    opaque film. A catcher on a transparent one writes its shadow into the alpha,
    and the plate that footage gets composited over is not there to be shadowed
    yet -- so all it would do is punch a dark patch through the gameplay behind.
    """
    if engine != 'CYCLES' or spec.background == 'transparent':
        return None
    mesh = bpy.data.meshes.new('Floor')
    extent = max(radius * 24.0, 0.5)
    mesh.from_pydata(
        [
            (-extent, -extent, 0.0),
            (extent, -extent, 0.0),
            (extent, extent, 0.0),
            (-extent, extent, 0.0),
        ],
        [],
        [(0, 1, 2, 3)],
    )
    mesh.update()
    floor = bpy.data.objects.new('Floor', mesh)
    collection.objects.link(floor)
    floor.location = (center.x, center.y, floor_z)
    floor.is_shadow_catcher = True
    return floor


def apply(spec, subjects, collection, engine):
    """Light `subjects`, putting the rig in `collection`."""
    preset = spec.preset
    center, radius, floor_z = _bounds(subjects, bpy.context.scene)
    standoff = max(radius * _STANDOFF, 0.12)
    strength = max(spec.strength, 0.0)

    _world(spec, preset)
    _floor(spec, center, radius, floor_z, collection, engine)

    aim = bpy.data.objects.new('LightTarget', None)
    aim.empty_display_type = 'PLAIN_AXES'
    aim.empty_display_size = radius * 0.5
    collection.objects.link(aim)
    aim.location = center

    for lamp in _RIGS[preset]:
        data = bpy.data.lights.new(lamp.name, type='AREA')
        data.shape = 'SQUARE'
        data.size = max(radius * lamp.size, 0.02)
        data.color = lamp.color
        position = center + lamp.offset * standoff
        distance = max((position - center).length, 0.05)
        data.energy = _WATTS_AT_ONE_METRE * lamp.watts * strength * distance * distance
        light = bpy.data.objects.new(lamp.name, data)
        collection.objects.link(light)
        light.location = position
        track = light.constraints.new('TRACK_TO')
        track.target = aim
        track.track_axis = 'TRACK_NEGATIVE_Z'
        track.up_axis = 'UP_Y'
    return aim
