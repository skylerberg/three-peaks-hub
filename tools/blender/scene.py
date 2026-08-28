"""Turning a parsed scene document into a Blender scene.

This, lighting and materials are the only modules here that import bpy, and
between them they work nothing out. What a shot does over time comes from
shots.py, what a library piece is shaped like comes from pieces.py, and what the
document means comes from scenedoc.py -- all three of which run under plain
python3, which is what keeps the edit loop on the interesting half short.

So the job here is narrow: hand geometry to Blender, hand keys to Blender, and
choose the things only a scene has -- which datablock an instance shares, what
collection it lands in, which engine renders it. Both of those modules have
already converted to metres and radians, so nothing below scales or rotates
anything a second time.
"""

import math
import os

import bpy
from mathutils import Matrix, Vector

import lighting
import materials
import pieces
import shots
from scenedoc import MM, SceneError

# Blender's own spelling for each engine the document is allowed to name. The
# 4.2-4.5 name BLENDER_EEVEE_NEXT does not exist in 5.x and raises on
# assignment, and the enum introspects as a single value even where CYCLES
# assigns fine -- so this is a table rather than a lookup.
ENGINE_NAMES = {'CYCLES': 'CYCLES', 'EEVEE': 'BLENDER_EEVEE'}

# Blender opens on AgX, which is built to make rendered light look
# photographic and pulls saturation out of anything bright doing it. What comes
# through here is printed artwork, and a card that renders a shade off the ink
# is the one thing this whole path exists not to do -- so the film is the
# neutral one, in the order it has been spelled across versions.
_VIEW_TRANSFORMS = ('Khronos PBR Neutral', 'Standard')

# The parent collection, and the bucket for instances no group claimed. Two
# distinct names: Blender uniquifies a collision into 'Instances.001' rather
# than refusing it, which reads as a bug in the export.
_COMPONENTS = 'Components'
_UNGROUPED = 'Ungrouped'
_RIG = 'Rig'


class Built:
    """What the importer made, for whoever renders or inspects it next."""

    def __init__(self, scene, camera, instances):
        self.scene = scene
        self.camera = camera
        # Instance id -> the one object a shot animates.
        self.instances = instances


def reset():
    """Empty the file, default cube and all."""
    bpy.ops.wm.read_factory_settings(use_empty=True)


def _collection(name, parent=None):
    collection = bpy.data.collections.new(name)
    (parent or bpy.context.scene.collection).children.link(collection)
    return collection


# --- assets ------------------------------------------------------------------


class _Prototype:
    """The mesh data one asset contributes, what it is called, and where it sits.

    Held as datablocks rather than as objects because every instance shares
    them: a 52 card deck is 52 objects over one mesh, never 52 meshes.

    The name travels with each part because the exporter puts meaning in it --
    a folded board's panels are numbered in reading order, and the crease to
    turn about is between two neighbours. Blender uniquifies a repeat across
    instances, so the names are read off this rather than looked up in
    bpy.data.objects, where the second board's panels are not the ones asked
    for.
    """

    def __init__(self, parts):
        self.parts = parts


def _import_glb(path):
    before = set(bpy.data.objects)
    try:
        bpy.ops.import_scene.gltf(filepath=path)
    except RuntimeError as error:
        raise SceneError(f'{path}: Blender could not import this .glb ({error})') from error
    created = [ob for ob in bpy.data.objects if ob not in before]
    parts = [
        (ob.name, ob.data, ob.matrix_world.copy())
        for ob in created
        if ob.type == 'MESH' and len(ob.data.vertices) > 0
    ]
    # The mesh datablocks outlive the objects the importer made because parts
    # holds a reference to each. Those objects would only be a second copy of
    # the geometry sitting at the origin beside the instances.
    for ob in created:
        bpy.data.objects.remove(ob, do_unlink=True)
    if not parts:
        raise SceneError(f'{path}: imported without a single mesh')
    return parts


def _library_parts(asset):
    palette = materials.library_materials(asset.label or asset.piece, asset.color)
    parts = []
    for source in pieces.build_piece(asset.piece, asset.size_mm):
        mesh = bpy.data.meshes.new(f'{asset.id}.{source.name}')
        mesh.from_pydata(
            [list(vertex) for vertex in source.vertices],
            [],
            [list(face) for face in source.faces],
        )
        mesh.validate()
        mesh.update()
        # validate() may drop a degenerate face, which would slide every later
        # flag onto the wrong polygon; a piece that lost one is better flat than
        # wrongly creased.
        if len(mesh.polygons) == len(source.smooth):
            for polygon, smooth in zip(mesh.polygons, source.smooth):
                polygon.use_smooth = smooth
        mesh.materials.append(palette[source.material])
        parts.append((source.name, mesh, Matrix.Identity(4)))
    return parts


def _prototypes(document, bundle_root):
    built = {}
    for asset in document.assets:
        if asset.kind == 'glb':
            path = os.path.join(bundle_root, asset.path)
            if not os.path.isfile(path):
                raise SceneError(
                    f'assets: {asset.path} is named by the scene but not in the bundle'
                )
            parts = _import_glb(path)
            materials.upgrade([mesh for _, mesh, _ in parts], asset.component)
        else:
            parts = _library_parts(asset)
        built[asset.id] = _Prototype(parts)
    return built


# --- instances ---------------------------------------------------------------


def _is_identity(matrix):
    return all(
        abs(matrix[row][col] - (1.0 if row == col else 0.0)) < 1e-9
        for row in range(4)
        for col in range(4)
    )


def _place(instance, proto, collection):
    name = instance.label or instance.id
    if len(proto.parts) == 1 and _is_identity(proto.parts[0][2]):
        root = bpy.data.objects.new(name, proto.parts[0][1])
        collection.objects.link(root)
    else:
        # A multi-part asset -- a die and its pips, or a board that came in as
        # one mesh per panel -- animates as one thing, so the shot drives an
        # empty and the meshes ride it. Collapsing that away for the single-mesh
        # case is what keeps a deck's outliner readable.
        root = bpy.data.objects.new(name, None)
        root.empty_display_type = 'PLAIN_AXES'
        root.empty_display_size = 0.02
        collection.objects.link(root)
        for part_name, mesh, matrix in proto.parts:
            part = bpy.data.objects.new(f'{name}.{part_name}', mesh)
            collection.objects.link(part)
            part.parent = root
            part.matrix_parent_inverse = Matrix.Identity(4)
            part.matrix_basis = matrix

    root.location = Vector([axis * MM for axis in instance.position_mm])
    root.rotation_mode = 'XYZ'
    root.rotation_euler = [math.radians(axis) for axis in instance.rotation_deg]
    # The document's own names, kept on the object so a scene that has been
    # hand-edited can still be read back against the bundle it came from.
    root['instance_id'] = instance.id
    root['asset_id'] = instance.asset_id
    if instance.group:
        root['group'] = instance.group
    return root


def _instances(document, protos, parent):
    groups = {}
    placed = {}
    for instance in document.instances:
        proto = protos.get(instance.asset_id)
        if proto is None:
            raise SceneError(
                f'instances: {instance.id} names asset {instance.asset_id}, '
                f'which the scene has not got'
            )
        key = instance.group or _UNGROUPED
        if key not in groups:
            # One collection per group, so the thing a shot aims at is also the
            # thing that can be hidden, soloed or moved as a unit by hand.
            groups[key] = _collection(key, parent)
        placed[instance.id] = _place(instance, proto, groups[key])
    return placed


# --- animation ---------------------------------------------------------------


def _shape_curves(target, shapes):
    """Give each inserted key its interpolation, easing and a handle that holds.

    Blender 5 keeps keys in a slotted action, so Action.fcurves is gone: the
    curves are reached through the channelbag of the slot this object is bound
    to. AUTO_CLAMPED handles are the other half -- an automatic bezier handle
    overshoots through a hold, which on a card landing on a table reads as it
    dipping into the table and coming back.
    """
    animation = target.animation_data
    if animation is None or animation.action is None:
        return
    action = animation.action
    if not action.layers or not action.layers[0].strips:
        return
    bag = action.layers[0].strips[0].channelbag(animation.action_slot)
    if bag is None:
        return
    for curve in bag.fcurves:
        for key in curve.keyframe_points:
            shape = shapes.get((curve.data_path, curve.array_index, int(round(key.co[0]))))
            if shape is None:
                continue
            key.interpolation, key.easing = shape
            key.handle_left_type = 'AUTO_CLAMPED'
            key.handle_right_type = 'AUTO_CLAMPED'
        curve.update()


def _animate(target, tracks, fps):
    target.rotation_mode = 'XYZ'
    shapes = {}
    for track in tracks:
        for key in track.keys:
            frame = key.frame(fps)
            getattr(target, track.data_path)[track.index] = key.value
            target.keyframe_insert(data_path=track.data_path, index=track.index, frame=frame)
            shapes[(track.data_path, track.index, frame)] = (key.interpolation, key.easing)
    _shape_curves(target, shapes)


def _apply_plan(plan, placed, camera, fps):
    for instance_id, tracks in plan.objects.items():
        target = placed.get(instance_id)
        if target is None:
            raise SceneError(
                f'shots: a track names instance {instance_id}, which is not in the scene'
            )
        _animate(target, tracks, fps)
    if plan.camera:
        _animate(camera, plan.camera, fps)


# --- camera ------------------------------------------------------------------


def _focus_object(document, placed, fallback):
    wanted = document.camera.dof.focus_target
    if not wanted:
        return fallback
    for instance in document.instances:
        if instance.id == wanted or instance.group == wanted:
            return placed[instance.id]
    return fallback


def _camera(document, placed, collection):
    spec = document.camera
    data = bpy.data.cameras.new('Camera')
    # Blender's lens is millimetres already: the one number in this document
    # that crosses unconverted.
    data.lens = spec.focal_length_mm
    data.clip_start = 0.001
    data.clip_end = 1000.0

    camera = bpy.data.objects.new('Camera', data)
    collection.objects.link(camera)
    position, rotation = shots.camera_rest_pose(spec)
    camera.location = position
    camera.rotation_mode = 'XYZ'
    camera.rotation_euler = rotation

    # Where the camera is pointed when nothing is moving it. An orbit keyframes
    # its own aim, so this is a handle rather than a constraint -- a Track To
    # would quietly win over every rotation key the planner wrote.
    target = bpy.data.objects.new('CameraTarget', None)
    target.empty_display_type = 'SPHERE'
    target.empty_display_size = 0.01
    collection.objects.link(target)
    target.location = Vector([axis * MM for axis in spec.target_mm])

    data.dof.use_dof = bool(spec.dof.enabled)
    data.dof.aperture_fstop = spec.dof.f_stop
    data.dof.focus_object = _focus_object(document, placed, target)
    bpy.context.scene.camera = camera
    return camera


# --- render ------------------------------------------------------------------


def _use_gpu(scene):
    """Point Cycles at whatever accelerator this machine has.

    Asked for rather than assumed: the first GPU render after an install
    compiles kernels, which on Metal is minutes of near-idle wall clock with
    nothing reported, and a smoke test that did that by default would look
    hung. The device enum introspects as empty the way the engine enum does, so
    the backend is found by assigning one and seeing whether devices appear.
    """
    try:
        preferences = bpy.context.preferences.addons['cycles'].preferences
    except KeyError:
        return False
    for backend in ('METAL', 'OPTIX', 'CUDA', 'HIP', 'ONEAPI'):
        try:
            preferences.compute_device_type = backend
        except TypeError:
            continue
        preferences.get_devices()
        if not any(device.type == backend for device in preferences.devices):
            continue
        for device in preferences.devices:
            device.use = device.type == backend
        scene.cycles.device = 'GPU'
        return True
    return False


def _view_transform(scene):
    for name in _VIEW_TRANSFORMS:
        try:
            scene.view_settings.view_transform = name
        except TypeError:
            continue
        return name
    return scene.view_settings.view_transform


def _render_settings(scene, document, overrides):
    spec = document.render
    engine = overrides.get('engine') or spec.engine
    samples = overrides.get('samples') or spec.samples

    render = scene.render
    render.engine = ENGINE_NAMES[engine]
    render.resolution_x, render.resolution_y = spec.resolution
    render.resolution_percentage = overrides.get('scale') or 100
    render.fps = spec.fps
    scene.frame_start, scene.frame_end = spec.frame_range
    scene.frame_current = spec.frame_range[0]
    render.film_transparent = document.lighting.background == 'transparent'
    render.image_settings.file_format = 'PNG'
    render.image_settings.color_depth = '8'
    render.image_settings.color_mode = 'RGBA' if render.film_transparent else 'RGB'
    _view_transform(scene)

    if render.engine == 'CYCLES':
        scene.cycles.samples = samples
        scene.cycles.use_adaptive_sampling = True
        scene.cycles.use_denoising = True
        if overrides.get('device') == 'GPU' and not _use_gpu(scene):
            print('import_scene: no GPU backend Cycles recognises; rendering on the CPU')
    else:
        scene.eevee.taa_render_samples = samples
    return engine


# --- the whole thing ---------------------------------------------------------


def build(document, bundle_root, overrides=None):
    reset()
    scene = bpy.context.scene

    protos = _prototypes(document, bundle_root)
    placed = _instances(document, protos, _collection(_COMPONENTS))

    rig = _collection(_RIG)
    camera = _camera(document, placed, rig)
    _apply_plan(shots.plan_scene(document), placed, camera, document.render.fps)

    engine = _render_settings(scene, document, overrides or {})
    lighting.apply(document.lighting, list(placed.values()), rig, engine)
    return Built(scene, camera, placed)


def render_still(built, output_path, frame=None):
    if frame is not None:
        built.scene.frame_set(frame)
    built.scene.render.filepath = output_path
    bpy.ops.render.render(write_still=True)


def render_animation(built, output_dir):
    built.scene.render.filepath = output_dir
    bpy.ops.render.render(animation=True)


def save_blend(path):
    bpy.ops.wm.save_as_mainfile(filepath=path)
