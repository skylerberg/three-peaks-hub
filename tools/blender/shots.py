"""Turning a declarative shot into keyframe tracks.

This is the shot maths, and it is the point of the whole export: the browser
picks components and names a shot; everything about how that shot moves is
decided here, in pure Python, where it can be iterated on with one file and one
command and no Blender in the loop.

Two things govern how the output is shaped.

**Sparse keys, and let Blender interpolate.** Blender has thirteen
interpolation modes and three easings; every one of them is a curve a person
can grab in the graph editor and retime. A baked per-frame channel is not
editable by anybody, and finishing the shot by hand in Blender is exactly what
this feature exists to make possible. So a move here is two or three keys
carrying an interpolation and an easing, never a sampled curve. The one
sanctioned exception is a path no interpolation mode can describe -- a circle --
and the orbit planner says so where it samples one.

**A key's interpolation describes the segment that starts at it**, which is why
the settle on a landing card is written on the key before the landing and not
on the landing itself. The final key of every track carries BEZIER/EASE_IN_OUT,
because in a scene with two shots on one object it governs the gap to whatever
the next shot does, and a linear drift across that gap is the one thing nobody
asks for.

Millimetres and degrees come in, because that is what the document holds.
Metres and radians go out, because that is what Blender counts in. The
conversion is scenedoc.MM, applied exactly once as each value is written.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Sequence, Tuple

from scenedoc import (
    MM,
    CameraSpec,
    DealShot,
    FanShot,
    FlipShot,
    OrbitShot,
    ParadeShot,
    RevealShot,
    SceneDocument,
    SceneError,
    SceneInstance,
    Shot,
    StackShot,
    TurntableShot,
    frame_for_seconds,
    instances_for_target,
    is_camera_shot,
)

TAU = math.tau

Vec3 = Tuple[float, float, float]

INTERPOLATIONS = (
    'CONSTANT',
    'LINEAR',
    'BEZIER',
    'SINE',
    'QUAD',
    'CUBIC',
    'QUART',
    'QUINT',
    'EXPO',
    'CIRC',
    'BACK',
    'BOUNCE',
    'ELASTIC',
)
EASINGS = ('EASE_IN', 'EASE_OUT', 'EASE_IN_OUT')
DATA_PATHS = ('location', 'rotation_euler', 'scale')

LOCATION = 'location'
ROTATION = 'rotation_euler'

# The segment after the last key of a track, which belongs to whatever comes
# next rather than to this shot.
_TERMINAL = ('BEZIER', 'EASE_IN_OUT')
# A piece arriving where it was thrown: past the mark, then back onto it.
_SETTLE = ('BACK', 'EASE_OUT')
# A camera move, and any segment whose speed should be shaped by its handles.
_SMOOTH = ('BEZIER', 'EASE_IN_OUT')

# A fanned hand is a stack laid over, not a set of coplanar cards; without a
# little lift per card they z-fight wherever they overlap.
_FAN_LAYER_MM = 0.35
# The yaw a dealt or dropped card carries in and settles out of. Alternating by
# index rather than drawn from a generator, so two exports of one scene match.
_DEAL_SPIN_DEG = 24.0
_STACK_SPIN_DEG = 6.0
# Samples per revolution of an orbit. Twelve is a circle to the eye and still a
# curve with grabbable keys; per-frame would be neither.
_ORBIT_SAMPLES_PER_REV = 12


@dataclass(frozen=True)
class Key:
    """One keyframe on one channel.

    ``value`` is metres on a location channel and radians on a rotation one.
    ``interpolation`` and ``easing`` are Blender's own enum spellings, checked
    here because a typo would otherwise surface as an enum error inside Blender
    with nothing to say which planner wrote it.
    """

    time_s: float
    value: float
    interpolation: str = 'BEZIER'
    easing: str = 'EASE_IN_OUT'

    def __post_init__(self) -> None:
        if self.interpolation not in INTERPOLATIONS:
            raise SceneError(f'unknown interpolation "{self.interpolation}"')
        if self.easing not in EASINGS:
            raise SceneError(f'unknown easing "{self.easing}"')

    def frame(self, fps: int) -> int:
        return frame_for_seconds(self.time_s, fps)


@dataclass(frozen=True)
class Track:
    """One fcurve: a data path, an array index, and the keys along it."""

    data_path: str
    index: int
    keys: Tuple[Key, ...]


@dataclass(frozen=True)
class ShotPlan:
    shot_id: str
    kind: str
    objects: Dict[str, Tuple[Track, ...]] = field(default_factory=dict)
    camera: Tuple[Track, ...] = ()


@dataclass(frozen=True)
class ScenePlan:
    objects: Dict[str, Tuple[Track, ...]]
    camera: Tuple[Track, ...]
    frame_range: Tuple[int, int]


# --- small helpers ------------------------------------------------------------


def _track(data_path: str, index: int, keys: Sequence[Key]) -> Track:
    if data_path not in DATA_PATHS:
        raise SceneError(f'unknown data path "{data_path}"')
    if not 0 <= index <= 2:
        raise SceneError(f'array index {index} is not an axis')
    if not keys:
        raise SceneError(f'{data_path}[{index}] was planned with no keys')
    for earlier, later in zip(keys, keys[1:]):
        if later.time_s <= earlier.time_s:
            raise SceneError(
                f'{data_path}[{index}] keys run backwards at {later.time_s}s'
            )
    return Track(data_path=data_path, index=index, keys=tuple(keys))


def _radians3(degrees: Vec3) -> Vec3:
    return (math.radians(degrees[0]), math.radians(degrees[1]), math.radians(degrees[2]))


def _metres3(millimetres: Vec3) -> Vec3:
    return (millimetres[0] * MM, millimetres[1] * MM, millimetres[2] * MM)


def _centroid(instances: Sequence[SceneInstance], fallback: Vec3) -> Vec3:
    if not instances:
        return fallback
    count = float(len(instances))
    return (
        sum(item.position_mm[0] for item in instances) / count,
        sum(item.position_mm[1] for item in instances) / count,
        sum(item.position_mm[2] for item in instances) / count,
    )


def look_at_euler(position_m: Vec3, target_m: Vec3) -> Vec3:
    """The XYZ euler that aims a Blender camera from one point at another.

    A camera at rest looks down its own -Z with +Y up, so with no roll the pose
    is a pitch about X and a yaw about Z: rotating (0, 0, -1) by Rz*Rx gives
    (-sin(rx)sin(rz), sin(rx)cos(rz), -cos(rx)), and matching that to the
    direction of travel inverts to the two lines below.
    """
    dx = target_m[0] - position_m[0]
    dy = target_m[1] - position_m[1]
    dz = target_m[2] - position_m[2]
    distance = math.sqrt(dx * dx + dy * dy + dz * dz)
    if distance == 0.0:
        return (0.0, 0.0, 0.0)
    pitch = math.acos(max(-1.0, min(1.0, -dz / distance)))
    yaw = math.atan2(-dx, dy)
    return (pitch, 0.0, yaw)


def _unwrap(angles: Sequence[float]) -> List[float]:
    """Keep a yaw continuous across keys.

    Sampled about a full turn, atan2 comes back inside one lap and Blender
    interpolates between the values it is given -- so an unwrapped track spins
    the camera the long way back at every wrap.
    """
    out: List[float] = []
    previous = 0.0
    for index, angle in enumerate(angles):
        if index == 0:
            out.append(angle)
            previous = angle
            continue
        turns = round((previous - angle) / TAU)
        value = angle + turns * TAU
        out.append(value)
        previous = value
    return out


def _pair(
    data_path: str,
    index: int,
    start_s: float,
    start_value: float,
    end_s: float,
    end_value: float,
    shape: Tuple[str, str],
) -> Track:
    return _track(
        data_path,
        index,
        [Key(start_s, start_value, *shape), Key(end_s, end_value, *_TERMINAL)],
    )


# --- one shot per kind --------------------------------------------------------


def _plan_turntable(
    shot: TurntableShot, targets: Sequence[SceneInstance]
) -> Dict[str, Tuple[Track, ...]]:
    end_s = shot.start_s + shot.duration_s
    plans: Dict[str, Tuple[Track, ...]] = {}
    for instance in targets:
        base = _radians3(instance.rotation_deg)
        plans[instance.id] = (
            # The tilt is the pose the piece spins in rather than a move, so it
            # is one key: a constant channel a person can raise without hunting
            # for its partner.
            _track(ROTATION, 0, [Key(shot.start_s, base[0] + math.radians(shot.tilt_deg))]),
            # A turntable is the one shot that must not ease. Easing it puts a
            # stall at both ends, and a stall is exactly what shows when the
            # loop repeats.
            _pair(
                ROTATION,
                2,
                shot.start_s,
                base[2],
                end_s,
                base[2] + shot.revolutions * TAU,
                ('LINEAR', 'EASE_IN_OUT'),
            ),
        )
    return plans


def _fan_angles(count: int, spread_rad: float) -> List[float]:
    if count <= 1:
        return [0.0]
    step = spread_rad / (count - 1)
    return [-spread_rad / 2.0 + index * step for index in range(count)]


def _plan_fan(shot: FanShot, targets: Sequence[SceneInstance]) -> Dict[str, Tuple[Track, ...]]:
    anchor = _centroid(targets, (0.0, 0.0, 0.0))
    angles = _fan_angles(len(targets), math.radians(shot.spread_deg))
    radius = shot.arc_radius_mm
    plans: Dict[str, Tuple[Track, ...]] = {}
    for index, instance in enumerate(targets):
        angle = angles[index]
        # The pivot sits one radius behind the anchor, so the middle card lands
        # on the anchor and the fan is symmetric about it whatever the count.
        x = anchor[0] + radius * math.sin(angle)
        y = anchor[1] + radius * (math.cos(angle) - 1.0)
        z = anchor[2] + index * _FAN_LAYER_MM
        start_s = shot.start_s + index * shot.stagger_s
        end_s = start_s + shot.duration_s
        rest = instance.position_mm
        base = _radians3(instance.rotation_deg)
        plans[instance.id] = (
            _pair(LOCATION, 0, start_s, rest[0] * MM, end_s, x * MM, _SETTLE),
            _pair(LOCATION, 1, start_s, rest[1] * MM, end_s, y * MM, _SETTLE),
            _pair(LOCATION, 2, start_s, rest[2] * MM, end_s, z * MM, _SETTLE),
            # Turned to face along the radius, so the fan reads as one hand
            # rather than a row of cards translated onto a curve.
            _pair(ROTATION, 2, start_s, base[2], end_s, base[2] - angle, _SETTLE),
        )
    return plans


def _plan_flip(shot: FlipShot, targets: Sequence[SceneInstance]) -> Dict[str, Tuple[Track, ...]]:
    axis = 0 if shot.axis == 'x' else 1
    # hold_s and duration_s are bounded independently, so a document may ask to
    # hold longer than the whole shot. A turn of no length is not a curve, so
    # the turn keeps a tenth of the shot at each end and the hold takes the
    # rest.
    turn_s = max(shot.duration_s * 0.1, (shot.duration_s - shot.hold_s) / 2.0)
    hold_s = max(0.0, shot.duration_s - 2.0 * turn_s)
    plans: Dict[str, Tuple[Track, ...]] = {}
    for instance in targets:
        base = _radians3(instance.rotation_deg)[axis]
        first = shot.start_s + turn_s
        keys = [Key(shot.start_s, base, 'CUBIC', 'EASE_IN_OUT')]
        if hold_s > 0.0:
            keys.append(Key(first, base + math.pi, 'LINEAR', 'EASE_IN_OUT'))
            keys.append(Key(first + hold_s, base + math.pi, 'CUBIC', 'EASE_IN_OUT'))
        else:
            keys.append(Key(first, base + math.pi, 'CUBIC', 'EASE_IN_OUT'))
        # Carrying on to a full turn rather than unwinding: the piece ends in
        # the pose it started in, and the second half reads as the same move
        # continuing instead of the first half played backwards.
        keys.append(Key(shot.start_s + shot.duration_s, base + TAU, *_TERMINAL))
        plans[instance.id] = (_track(ROTATION, axis, keys),)
    return plans


def _deal_slots(shot: DealShot, count: int) -> List[Vec3]:
    if shot.to_positions_mm is not None:
        if len(shot.to_positions_mm) < count:
            raise SceneError(
                f'shot "{shot.id}" deals {count} pieces into '
                f'{len(shot.to_positions_mm)} positions'
            )
        return list(shot.to_positions_mm[:count])
    grid = shot.grid
    if grid is None:
        raise SceneError(f'shot "{shot.id}" has neither to_positions_mm nor a grid')
    if grid.columns * grid.rows < count:
        raise SceneError(
            f'shot "{shot.id}" deals {count} pieces into a '
            f'{grid.columns}x{grid.rows} grid'
        )
    slots: List[Vec3] = []
    for index in range(count):
        row, column = divmod(index, grid.columns)
        slots.append(
            (
                # Centred on origin_mm rather than started at it, so a template
                # that changes the count stays composed instead of drifting off
                # to one side.
                grid.origin_mm[0] + (column - (grid.columns - 1) / 2.0) * grid.spacing_x_mm,
                grid.origin_mm[1] + ((grid.rows - 1) / 2.0 - row) * grid.spacing_y_mm,
                grid.origin_mm[2],
            )
        )
    return slots


def _plan_deal(shot: DealShot, targets: Sequence[SceneInstance]) -> Dict[str, Tuple[Track, ...]]:
    slots = _deal_slots(shot, len(targets))
    plans: Dict[str, Tuple[Track, ...]] = {}
    for index, instance in enumerate(targets):
        rest = instance.position_mm
        slot = slots[index]
        start_s = shot.start_s + index * shot.stagger_s
        end_s = start_s + shot.duration_s
        mid_s = start_s + shot.duration_s / 2.0
        base = _radians3(instance.rotation_deg)
        tracks = [
            # Flicked away and arriving soft, which is EASE_OUT: Blender's
            # easing names the end the shaping happens at.
            _pair(LOCATION, 0, start_s, rest[0] * MM, end_s, slot[0] * MM, ('QUAD', 'EASE_OUT')),
            _pair(LOCATION, 1, start_s, rest[1] * MM, end_s, slot[1] * MM, ('QUAD', 'EASE_OUT')),
        ]
        if shot.arc_height_mm > 0.0:
            apex = max(rest[2], slot[2]) + shot.arc_height_mm
            # Two half-sines make the throw: out of the hand fast and slowing
            # to the apex, then away from it slow and gathering speed. Three
            # keys, and the shape is a human's to move.
            tracks.append(
                _track(
                    LOCATION,
                    2,
                    [
                        Key(start_s, rest[2] * MM, 'SINE', 'EASE_OUT'),
                        Key(mid_s, apex * MM, 'SINE', 'EASE_IN'),
                        Key(end_s, slot[2] * MM, *_TERMINAL),
                    ],
                )
            )
        else:
            tracks.append(
                _pair(LOCATION, 2, start_s, rest[2] * MM, end_s, slot[2] * MM, ('QUAD', 'EASE_OUT'))
            )
        spin = math.radians(_DEAL_SPIN_DEG * (1.0 if index % 2 == 0 else -1.0))
        tracks.append(
            _track(
                ROTATION,
                2,
                [
                    Key(start_s, base[2], 'SINE', 'EASE_IN_OUT'),
                    Key(mid_s, base[2] + spin, *_SETTLE),
                    Key(end_s, base[2], *_TERMINAL),
                ],
            )
        )
        plans[instance.id] = tuple(tracks)
    return plans


def _plan_stack(shot: StackShot, targets: Sequence[SceneInstance]) -> Dict[str, Tuple[Track, ...]]:
    plans: Dict[str, Tuple[Track, ...]] = {}
    for index, instance in enumerate(targets):
        rest = instance.position_mm
        base = _radians3(instance.rotation_deg)
        start_s = shot.start_s + index * shot.stagger_s
        end_s = start_s + shot.duration_s
        spin = math.radians(_STACK_SPIN_DEG * (1.0 if index % 2 == 0 else -1.0))
        plans[instance.id] = (
            # The whole fall and its settle in two keys: BOUNCE with the
            # shaping at the arriving end is the gravity curve, and baking it
            # would buy nothing Blender does not already draw.
            _pair(
                LOCATION,
                2,
                start_s,
                (rest[2] + shot.drop_height_mm) * MM,
                end_s,
                rest[2] * MM,
                ('BOUNCE', 'EASE_OUT'),
            ),
            _pair(ROTATION, 2, start_s, base[2] + spin, end_s, base[2], _SETTLE),
        )
    return plans


def _plan_parade(
    shot: ParadeShot, targets: Sequence[SceneInstance]
) -> Dict[str, Tuple[Track, ...]]:
    count = len(targets)
    anchor = _centroid(targets, (0.0, 0.0, 0.0))
    end_s = shot.start_s + shot.duration_s
    # The line crosses by exactly its own length, so the piece at one end
    # finishes where its neighbour began and the pass can be looped.
    travel = count * shot.spacing_mm
    # And it crosses *through* the anchor rather than away from it: a pass that
    # begins composed ends a whole line-length to one side, which is a frame
    # with nothing in it. Starting half a travel back puts the middle of the
    # move where the camera was pointed, and costs the loop nothing.
    origin = anchor[0] - travel / 2.0
    steady = ('LINEAR', 'EASE_IN_OUT')
    plans: Dict[str, Tuple[Track, ...]] = {}
    for index, instance in enumerate(targets):
        base = _radians3(instance.rotation_deg)
        x = origin + (index - (count - 1) / 2.0) * shot.spacing_mm
        plans[instance.id] = (
            _pair(LOCATION, 0, shot.start_s, x * MM, end_s, (x + travel) * MM, steady),
            _pair(
                ROTATION,
                2,
                shot.start_s,
                base[2],
                end_s,
                base[2] + shot.revolutions * TAU,
                steady,
            ),
        )
    return plans


def _camera_tracks(
    times: Sequence[float], positions: Sequence[Vec3], centre_m: Vec3, shape: Tuple[str, str]
) -> Tuple[Track, ...]:
    """Location and aim for a camera moving through a set of sampled poses."""
    eulers = [look_at_euler(position, centre_m) for position in positions]
    yaws = _unwrap([euler[2] for euler in eulers])
    tracks: List[Track] = []
    for axis in range(3):
        keys = [
            Key(time, positions[index][axis], *(shape if index < len(times) - 1 else _TERMINAL))
            for index, time in enumerate(times)
        ]
        tracks.append(_track(LOCATION, axis, keys))
    pitches = [euler[0] for euler in eulers]
    for axis, values in ((0, pitches), (2, yaws)):
        keys = [
            Key(time, values[index], *(shape if index < len(times) - 1 else _TERMINAL))
            for index, time in enumerate(times)
        ]
        tracks.append(_track(ROTATION, axis, keys))
    # rotation_euler[1] is left unkeyed on purpose: roll is never what aiming
    # decides, so a dutch angle added by hand survives the import.
    return tuple(tracks)


def _plan_orbit(shot: OrbitShot, centre_mm: Vec3, camera: CameraSpec) -> Tuple[Track, ...]:
    # A circle is the one path no interpolation mode describes, so this is the
    # sanctioned sampled channel: twelve poses a revolution, evenly in both
    # angle and time. Easing the angle instead would bunch the samples where
    # the move is fastest, and a sampled circle is only as round as its samples
    # are even -- the human eases it by moving keys, which is cheap, where
    # un-bunching a lumpy circle is not.
    samples = max(2, int(math.ceil(shot.revolutions * _ORBIT_SAMPLES_PER_REV)))
    start_angle = math.atan2(
        camera.position_mm[1] - centre_mm[1], camera.position_mm[0] - centre_mm[0]
    )
    centre_m = _metres3(centre_mm)
    times: List[float] = []
    positions: List[Vec3] = []
    for step in range(samples + 1):
        fraction = step / samples
        angle = start_angle + fraction * shot.revolutions * TAU
        times.append(shot.start_s + fraction * shot.duration_s)
        positions.append(
            (
                (centre_mm[0] + shot.radius_mm * math.cos(angle)) * MM,
                (centre_mm[1] + shot.radius_mm * math.sin(angle)) * MM,
                (centre_mm[2] + shot.height_mm) * MM,
            )
        )
    return _camera_tracks(times, positions, centre_m, _SMOOTH)


def _plan_reveal(shot: RevealShot, centre_mm: Vec3) -> Tuple[Track, ...]:
    centre_m = _metres3(centre_mm)
    mid_mm = tuple((shot.from_mm[axis] + shot.to_mm[axis]) / 2.0 for axis in range(3))
    # Three aim keys, not two. A camera given only its endpoints interpolates
    # its aim and drifts off the piece in between; EASE_IN_OUT is symmetric, so
    # the halfway time really is the halfway point and aiming from it is exact.
    times = [shot.start_s, shot.start_s + shot.duration_s / 2.0, shot.start_s + shot.duration_s]
    positions = [
        _metres3(shot.from_mm),
        _metres3((mid_mm[0], mid_mm[1], mid_mm[2])),
        _metres3(shot.to_mm),
    ]
    return _camera_tracks(times, positions, centre_m, _SMOOTH)


# --- the entry points ---------------------------------------------------------


def plan_shot(
    shot: Shot, instances: Sequence[SceneInstance], camera: CameraSpec
) -> ShotPlan:
    """Expand one shot into the tracks it writes, in metres and radians."""
    targets = instances_for_target(instances, shot.target)
    if is_camera_shot(shot):
        centre_mm = _centroid(targets, camera.target_mm)
        if isinstance(shot, OrbitShot):
            return ShotPlan(shot.id, shot.kind, {}, _plan_orbit(shot, centre_mm, camera))
        assert isinstance(shot, RevealShot)
        return ShotPlan(shot.id, shot.kind, {}, _plan_reveal(shot, centre_mm))
    if not targets:
        return ShotPlan(shot.id, shot.kind, {}, ())
    if isinstance(shot, TurntableShot):
        objects = _plan_turntable(shot, targets)
    elif isinstance(shot, FanShot):
        objects = _plan_fan(shot, targets)
    elif isinstance(shot, FlipShot):
        objects = _plan_flip(shot, targets)
    elif isinstance(shot, DealShot):
        objects = _plan_deal(shot, targets)
    elif isinstance(shot, StackShot):
        objects = _plan_stack(shot, targets)
    elif isinstance(shot, ParadeShot):
        objects = _plan_parade(shot, targets)
    else:
        raise SceneError(f'shot "{shot.id}" has no planner for kind "{shot.kind}"')
    return ShotPlan(shot.id, shot.kind, objects, ())


def _merge(into: Dict[Tuple[str, int], List[Key]], tracks: Sequence[Track]) -> None:
    for track in tracks:
        into.setdefault((track.data_path, track.index), []).extend(track.keys)


def _collect(channels: Dict[Tuple[str, int], List[Key]]) -> Tuple[Track, ...]:
    out: List[Track] = []
    for (data_path, index), keys in sorted(channels.items()):
        # Sorted rather than refused: two shots aimed at one object is a
        # composition the document cannot see is a mistake, and a curve out of
        # order is one Blender would not draw at all.
        out.append(Track(data_path, index, tuple(sorted(keys, key=lambda key: key.time_s))))
    return tuple(out)


def plan_scene(scene: SceneDocument) -> ScenePlan:
    """Every shot in the document, merged onto one curve per channel."""
    objects: Dict[str, Dict[Tuple[str, int], List[Key]]] = {}
    camera: Dict[Tuple[str, int], List[Key]] = {}
    for shot in scene.shots:
        plan = plan_shot(shot, scene.instances, scene.camera)
        for instance_id, tracks in plan.objects.items():
            _merge(objects.setdefault(instance_id, {}), tracks)
        _merge(camera, plan.camera)
    return ScenePlan(
        objects={key: _collect(value) for key, value in objects.items()},
        camera=_collect(camera),
        frame_range=scene.render.frame_range,
    )


def camera_rest_pose(camera: CameraSpec) -> Tuple[Vec3, Vec3]:
    """Where the camera sits before any shot moves it: metres, then radians."""
    position = _metres3(camera.position_mm)
    return position, look_at_euler(position, _metres3(camera.target_mm))
