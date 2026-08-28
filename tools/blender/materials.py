"""The production pass over the materials the glTF importer already made.

glTF carries base colour, metallic and roughness and nothing else, so every
imported component arrives as flat plastic. What is added here is the part a
manufacturer's sample has and a spec sheet does not: the varnish on a printed
card, the roughness drift across a wooden token, the dead matte of a laminated
box lid.

It is deliberately an adjustment rather than a rebuild. The importer's node tree
already wires up whatever textures came in the file, so every socket set below
is skipped when something is plugged into it -- artwork always wins, and a
component that turns up with an unexpected node graph degrades to no change at
all rather than to a blank grey.

Socket names are Blender 5's. There is no Clearcoat, Specular, Subsurface or
Transmission input any more; asking for one raises KeyError.
"""

import bpy

import pieces

# The four MODEL_KINDS, plus the library pieces, which have no imported material
# and get one built from their own colour.
_PROFILES = {
    'card': {
        'Roughness': 0.34,
        'Metallic': 0.0,
        'Specular IOR Level': 0.5,
        'Coat Weight': 0.28,
        'Coat Roughness': 0.06,
        'Coat IOR': 1.5,
    },
    'wood': {
        'Roughness': 0.55,
        'Metallic': 0.0,
        'Sheen Weight': 0.06,
        'Sheen Roughness': 0.4,
    },
    'box': {
        'Roughness': 0.62,
        'Metallic': 0.0,
        'Coat Weight': 0.06,
        'Coat Roughness': 0.38,
    },
    'board': {
        'Roughness': 0.48,
        'Metallic': 0.0,
        'Coat Weight': 0.12,
        'Coat Roughness': 0.22,
    },
}

# A painted wooden piece, which is what a library asset is meant to read as.
_LIBRARY_PROFILE = {
    'Roughness': 0.42,
    'Metallic': 0.0,
    'Specular IOR Level': 0.5,
    'Coat Weight': 0.1,
    'Coat Roughness': 0.25,
}

# A pip has to read against whatever colour the body was given, so it is picked
# off the body rather than fixed: white pips vanish on a white die.
_PIP_ON_DARK = (0.85, 0.85, 0.83)
_PIP_ON_LIGHT = (0.04, 0.04, 0.045)
_PIP_CONTRAST_PIVOT = 0.2

# How far the grain moves roughness either side of the profile's value.
_WOOD_ROUGHNESS_DRIFT = 0.13


def hex_to_linear(value):
    """'#rrggbb' as the linear triple every Blender colour socket wants.

    A hex colour is written the way a browser reads it, which is sRGB. Handing
    those bytes straight to a socket is the standard way a render comes out
    washed out and a shade too bright.
    """
    text = value.lstrip('#')
    if len(text) != 6:
        return (0.5, 0.5, 0.5)
    channels = []
    for index in range(0, 6, 2):
        srgb = int(text[index : index + 2], 16) / 255.0
        channels.append(srgb / 12.92 if srgb <= 0.04045 else ((srgb + 0.055) / 1.055) ** 2.4)
    return tuple(channels)


def _principled(material):
    if not material or not material.use_nodes or not material.node_tree:
        return None
    for node in material.node_tree.nodes:
        if node.bl_idname == 'ShaderNodeBsdfPrincipled':
            return node
    return None


def _set(node, name, value):
    """Set one socket, unless the imported graph has something plugged into it."""
    socket = node.inputs.get(name)
    if socket is None or socket.is_linked:
        return
    socket.default_value = value


def _wood_grain(material, node, base_roughness):
    """Drift roughness across the piece, so the whole face does not flash at once.

    The grain is stretched hard along one axis because a plank's is: an
    unstretched noise reads as damp stone. Object coordinates rather than UVs,
    so a token with no unwrap still gets it.
    """
    tree = material.node_tree
    coord = tree.nodes.new('ShaderNodeTexCoord')
    coord.location = (-900, -320)
    mapping = tree.nodes.new('ShaderNodeMapping')
    mapping.location = (-720, -320)
    mapping.inputs['Scale'].default_value = (1.0, 26.0, 1.0)
    noise = tree.nodes.new('ShaderNodeTexNoise')
    noise.location = (-540, -320)
    noise.inputs['Scale'].default_value = 14.0
    noise.inputs['Detail'].default_value = 5.0
    noise.inputs['Roughness'].default_value = 0.6
    ramp = tree.nodes.new('ShaderNodeMapRange')
    ramp.location = (-340, -320)
    # Map Range repeats every socket name once per data type, so these are
    # reached by index: Value, From Min, From Max, To Min, To Max.
    ramp.inputs[1].default_value = 0.0
    ramp.inputs[2].default_value = 1.0
    ramp.inputs[3].default_value = max(base_roughness - _WOOD_ROUGHNESS_DRIFT, 0.05)
    ramp.inputs[4].default_value = min(base_roughness + _WOOD_ROUGHNESS_DRIFT, 1.0)
    tree.links.new(coord.outputs['Object'], mapping.inputs['Vector'])
    tree.links.new(mapping.outputs['Vector'], noise.inputs['Vector'])
    tree.links.new(noise.outputs['Factor'], ramp.inputs[0])
    tree.links.new(ramp.outputs['Result'], node.inputs['Roughness'])


def upgrade(meshes, component):
    """Apply `component`'s profile to every material on `meshes`."""
    profile = _PROFILES.get(component)
    if profile is None:
        return
    seen = set()
    for mesh in meshes:
        for material in mesh.materials:
            if material is None or material.name in seen:
                continue
            seen.add(material.name)
            node = _principled(material)
            if node is None:
                continue
            for name, value in profile.items():
                _set(node, name, value)
            if component == 'wood' and not node.inputs['Roughness'].is_linked:
                _wood_grain(material, node, profile['Roughness'])


def _library_material(name, rgb):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = _principled(material)
    if node is None:
        return material
    _set(node, 'Base Color', (*rgb, 1.0))
    for socket, value in _LIBRARY_PROFILE.items():
        _set(node, socket, value)
    return material


def library_materials(label, color):
    """Materials for a piece the importer built rather than imported.

    Keyed by the names pieces.py puts on its meshes, so a die's pips arrive as
    their own material and can be recoloured without touching the body.
    """
    body = hex_to_linear(color)
    luminance = 0.2126 * body[0] + 0.7152 * body[1] + 0.0722 * body[2]
    pip = _PIP_ON_DARK if luminance < _PIP_CONTRAST_PIVOT else _PIP_ON_LIGHT
    return {
        pieces.BODY_MATERIAL: _library_material(f'{label} body', body),
        pieces.PIP_MATERIAL: _library_material(f'{label} pip', pip),
    }
