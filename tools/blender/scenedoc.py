"""Reading scene.json.

The browser writes the document and packages/shared/src/scenes.ts owns its
shape; this module is the importer's half of that contract. It turns one into
plain dataclasses and refuses anything the exporter should not have emitted,
naming the field it refused. A bundle that opened with a quietly substituted
default would render, and nobody could explain what came out.

Nothing here imports bpy, so the whole front end of the importer is testable
with python3 alone.

Lengths stay in the document's millimetres all the way through parsing. ``MM``
is the single conversion to the metre glTF and Blender count in, and shots.py
and pieces.py apply it as they build -- never afterwards, by scaling a node.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, NoReturn, Optional, Sequence, Tuple, Union

MM = 0.001

Vec3 = Tuple[float, float, float]
Limit = Tuple[float, float]

SCENE_FORMAT = 'three-peaks-scene'
SCENE_VERSION = 1
SCENE_FILE_NAME = 'scene.json'
SCENE_ASSET_DIR = 'assets'

SCENE_ASSET_KINDS = ('glb', 'library')
LIBRARY_PIECES = ('d6', 'meeple', 'cube', 'disc', 'cylinder')
MODEL_KINDS = ('card', 'wood', 'box', 'board', 'punchboard')

SHOT_KINDS = ('turntable', 'fan', 'flip', 'deal', 'stack', 'parade', 'orbit', 'reveal')
CAMERA_SHOT_KINDS = ('orbit', 'reveal')
STAGGERED_SHOT_KINDS = ('fan', 'deal', 'stack')
FLIP_AXES = ('x', 'y')
SCENE_TARGET = 'scene'

LIGHTING_PRESETS = ('studio', 'softbox', 'dramatic', 'flat')
SCENE_BACKGROUNDS = ('transparent', 'solid', 'gradient')
SURFACE_FINISHES = ('wood', 'felt', 'slate', 'paper')
RENDER_ENGINES = ('CYCLES', 'EEVEE')

_START_S: Limit = (0, 600)
_DURATION_S: Limit = (0.05, 120)
_STAGGER_S: Limit = (0, 5)

# Mirrors SHOT_LIMITS in packages/shared/src/scenes.ts, keyed by field name for
# the same reason: one loop bounds every kind instead of a branch per kind.
SHOT_LIMITS: Dict[str, Dict[str, Limit]] = {
    'turntable': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'revolutions': (0.05, 20),
        'tilt_deg': (-89, 89),
    },
    'fan': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'spread_deg': (0, 360),
        'arc_radius_mm': (0, 2000),
        'stagger_s': _STAGGER_S,
    },
    'flip': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'hold_s': (0, 60),
    },
    'deal': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'arc_height_mm': (0, 1000),
        'stagger_s': _STAGGER_S,
    },
    'stack': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'drop_height_mm': (0, 1000),
        'stagger_s': _STAGGER_S,
    },
    'parade': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'spacing_mm': (0, 1000),
        'revolutions': (0, 20),
    },
    'orbit': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
        'revolutions': (0.05, 20),
        'radius_mm': (10, 5000),
        'height_mm': (-2000, 2000),
    },
    'reveal': {
        'start_s': _START_S,
        'duration_s': _DURATION_S,
    },
}

DEAL_GRID_LIMITS: Dict[str, Limit] = {
    'columns': (1, 64),
    'rows': (1, 64),
    'spacing_x_mm': (0, 2000),
    'spacing_y_mm': (0, 2000),
}

_MAX_DECK_CARDS = 500

SCENE_LIMITS: Dict[str, Limit] = {
    'assets': (1, _MAX_DECK_CARDS * 2),
    'instances': (1, _MAX_DECK_CARDS * 4),
    'shots': (0, 32),
    'position_mm': (-10000, 10000),
    'rotation_deg': (-3600, 3600),
    'library_size_mm': (1, 500),
}

CAMERA_LIMITS: Dict[str, Limit] = {'focal_length_mm': (8, 300), 'f_stop': (0.5, 128)}
LIGHTING_LIMITS: Dict[str, Limit] = {'strength': (0, 20)}
SURFACE_LIMITS: Dict[str, Limit] = {
    'width_mm': (50, 20000),
    'depth_mm': (50, 20000),
    'thickness_mm': (1, 400),
    'sweep_height_mm': (0, 5000),
}
RENDER_LIMITS: Dict[str, Limit] = {
    'resolution_px': (64, 7680),
    'fps': (1, 120),
    'samples': (1, 4096),
    'frame': (1, 100000),
}
SCENE_TEXT_LIMITS: Dict[str, Limit] = {
    'id': (1, 120),
    'label': (0, 200),
    'group': (1, 120),
    'project_name': (0, 200),
    'path': (1, 300),
    'generated_at': (1, 64),
}


class SceneError(ValueError):
    """A bundle Blender must not be asked to open, or a scene it cannot plan."""


# --- dataclasses --------------------------------------------------------------


@dataclass(frozen=True)
class GlbAsset:
    id: str
    path: str
    component: str
    label: str

    kind: str = 'glb'


@dataclass(frozen=True)
class LibraryAsset:
    id: str
    piece: str
    color: str
    size_mm: float
    label: str

    kind: str = 'library'


SceneAsset = Union[GlbAsset, LibraryAsset]


@dataclass(frozen=True)
class SceneInstance:
    id: str
    asset_id: str
    label: str
    group: Optional[str]
    position_mm: Vec3
    rotation_deg: Vec3


@dataclass(frozen=True)
class Shot:
    id: str
    kind: str
    target: str
    start_s: float
    duration_s: float


@dataclass(frozen=True)
class TurntableShot(Shot):
    revolutions: float = 1.0
    tilt_deg: float = 0.0


@dataclass(frozen=True)
class FanShot(Shot):
    spread_deg: float = 0.0
    arc_radius_mm: float = 0.0
    stagger_s: float = 0.0


@dataclass(frozen=True)
class FlipShot(Shot):
    axis: str = 'y'
    hold_s: float = 0.0


@dataclass(frozen=True)
class DealGrid:
    columns: int
    rows: int
    spacing_x_mm: float
    spacing_y_mm: float
    origin_mm: Vec3


@dataclass(frozen=True)
class DealShot(Shot):
    to_positions_mm: Optional[Tuple[Vec3, ...]] = None
    grid: Optional[DealGrid] = None
    arc_height_mm: float = 0.0
    stagger_s: float = 0.0


@dataclass(frozen=True)
class StackShot(Shot):
    drop_height_mm: float = 0.0
    stagger_s: float = 0.0


@dataclass(frozen=True)
class ParadeShot(Shot):
    spacing_mm: float = 0.0
    revolutions: float = 0.0


@dataclass(frozen=True)
class OrbitShot(Shot):
    revolutions: float = 1.0
    radius_mm: float = 0.0
    height_mm: float = 0.0


@dataclass(frozen=True)
class RevealShot(Shot):
    from_mm: Vec3 = (0.0, 0.0, 0.0)
    to_mm: Vec3 = (0.0, 0.0, 0.0)


@dataclass(frozen=True)
class CameraDof:
    enabled: bool
    focus_target: Optional[str]
    f_stop: float


@dataclass(frozen=True)
class CameraSpec:
    focal_length_mm: float
    position_mm: Vec3
    target_mm: Vec3
    dof: CameraDof


@dataclass(frozen=True)
class LightingSpec:
    preset: str
    strength: float
    background: str
    background_color: str


@dataclass(frozen=True)
class SurfaceSpec:
    finish: str
    color: str
    width_mm: float
    depth_mm: float
    thickness_mm: float
    sweep_height_mm: float


@dataclass(frozen=True)
class RenderSpec:
    engine: str
    resolution: Tuple[int, int]
    fps: int
    samples: int
    frame_range: Tuple[int, int]


@dataclass(frozen=True)
class SceneDocument:
    generated_at: str
    project_name: str
    assets: Tuple[SceneAsset, ...]
    instances: Tuple[SceneInstance, ...]
    shots: Tuple[Shot, ...]
    camera: CameraSpec
    lighting: LightingSpec
    render: RenderSpec
    # Absent in every bundle written before there was a table to stand things
    # on, and absent again in one exported without one. Both mean the same
    # scene the importer built then, so the default is not a substitution.
    surface: Optional[SurfaceSpec] = None

    def asset(self, asset_id: str) -> SceneAsset:
        for asset in self.assets:
            if asset.id == asset_id:
                return asset
        raise SceneError(f'no asset "{asset_id}"')


# --- reading fields -----------------------------------------------------------


def _fail(path: str, message: str) -> NoReturn:
    raise SceneError(f'{SCENE_FILE_NAME}: {path} {message}')


def _object(value: Any, path: str) -> Dict[str, Any]:
    if not isinstance(value, dict):
        _fail(path, 'must be an object')
    return value


def _array(value: Any, path: str) -> List[Any]:
    if not isinstance(value, list):
        _fail(path, 'must be an array')
    return value


def _field(data: Dict[str, Any], key: str, path: str) -> Any:
    if key not in data:
        _fail(f'{path}.{key}', 'is missing')
    return data[key]


def _number(value: Any, path: str, limits: Limit) -> float:
    # bool is an int in Python, and `true` where a number belongs is exactly the
    # sort of exporter slip this module exists to name.
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        _fail(path, 'must be a number')
    number = float(value)
    if not math.isfinite(number):
        _fail(path, 'must be a finite number')
    low, high = limits
    if number < low or number > high:
        _fail(path, f'must be between {low} and {high}, not {number}')
    return number


def _whole(value: Any, path: str, limits: Limit) -> int:
    number = _number(value, path, limits)
    if number != int(number):
        _fail(path, f'must be a whole number, not {number}')
    return int(number)


def _text(value: Any, path: str, limits: Limit) -> str:
    if not isinstance(value, str):
        _fail(path, 'must be a string')
    low, high = limits
    if len(value) < low or len(value) > high:
        _fail(path, f'must be {int(low)} to {int(high)} characters, not {len(value)}')
    return value


def _choice(value: Any, path: str, allowed: Sequence[str]) -> str:
    if not isinstance(value, str) or value not in allowed:
        _fail(path, f'must be one of {", ".join(allowed)}, not {value!r}')
    return value


def _flag(value: Any, path: str) -> bool:
    if not isinstance(value, bool):
        _fail(path, 'must be true or false')
    return value


def _color(value: Any, path: str) -> str:
    if not isinstance(value, str) or len(value) != 7 or not value.startswith('#'):
        _fail(path, 'must be a #rrggbb colour')
    for index, digit in enumerate(value[1:]):
        if digit not in '0123456789abcdef':
            _fail(path, f'must be a #rrggbb colour, and character {index + 2} is {digit!r}')
    return value


def _vec3(value: Any, path: str, limits: Limit) -> Vec3:
    items = _array(value, path)
    if len(items) != 3:
        _fail(path, f'must be three numbers, not {len(items)}')
    axes = [_number(item, f'{path}[{index}]', limits) for index, item in enumerate(items)]
    return (axes[0], axes[1], axes[2])


def _param(data: Dict[str, Any], path: str, field: str, limits: Dict[str, Limit]) -> float:
    return _number(_field(data, field, path), f'{path}.{field}', limits[field])


def _unique(ids: Sequence[str], path: str) -> None:
    seen = set()
    for index, value in enumerate(ids):
        if value in seen:
            _fail(f'{path}[{index}].id', f'duplicates "{value}"')
        seen.add(value)


# --- parsing ------------------------------------------------------------------


def is_scene_asset_path(path: str) -> bool:
    return (
        path.startswith(f'{SCENE_ASSET_DIR}/')
        and '..' not in path
        and '\\' not in path
        and '//' not in path
    )


def _parse_asset(value: Any, path: str) -> SceneAsset:
    data = _object(value, path)
    kind = _choice(_field(data, 'kind', path), f'{path}.kind', SCENE_ASSET_KINDS)
    asset_id = _text(_field(data, 'id', path), f'{path}.id', SCENE_TEXT_LIMITS['id'])
    label = _text(_field(data, 'label', path), f'{path}.label', SCENE_TEXT_LIMITS['label'])
    if kind == 'glb':
        relative = _text(_field(data, 'path', path), f'{path}.path', SCENE_TEXT_LIMITS['path'])
        if not is_scene_asset_path(relative):
            _fail(f'{path}.path', f'must sit under {SCENE_ASSET_DIR}/, not "{relative}"')
        component = _choice(_field(data, 'component', path), f'{path}.component', MODEL_KINDS)
        return GlbAsset(id=asset_id, path=relative, component=component, label=label)
    piece = _choice(_field(data, 'piece', path), f'{path}.piece', LIBRARY_PIECES)
    color = _color(_field(data, 'color', path), f'{path}.color')
    size_mm = _number(
        _field(data, 'size_mm', path), f'{path}.size_mm', SCENE_LIMITS['library_size_mm']
    )
    return LibraryAsset(id=asset_id, piece=piece, color=color, size_mm=size_mm, label=label)


def _parse_instance(value: Any, path: str) -> SceneInstance:
    data = _object(value, path)
    group_value = _field(data, 'group', path)
    group = (
        None
        if group_value is None
        else _text(group_value, f'{path}.group', SCENE_TEXT_LIMITS['group'])
    )
    return SceneInstance(
        id=_text(_field(data, 'id', path), f'{path}.id', SCENE_TEXT_LIMITS['id']),
        asset_id=_text(_field(data, 'asset_id', path), f'{path}.asset_id', SCENE_TEXT_LIMITS['id']),
        label=_text(_field(data, 'label', path), f'{path}.label', SCENE_TEXT_LIMITS['label']),
        group=group,
        position_mm=_vec3(
            _field(data, 'position_mm', path), f'{path}.position_mm', SCENE_LIMITS['position_mm']
        ),
        rotation_deg=_vec3(
            _field(data, 'rotation_deg', path), f'{path}.rotation_deg', SCENE_LIMITS['rotation_deg']
        ),
    )


def _parse_grid(value: Any, path: str) -> DealGrid:
    data = _object(value, path)
    return DealGrid(
        columns=_whole(
            _field(data, 'columns', path), f'{path}.columns', DEAL_GRID_LIMITS['columns']
        ),
        rows=_whole(_field(data, 'rows', path), f'{path}.rows', DEAL_GRID_LIMITS['rows']),
        spacing_x_mm=_number(
            _field(data, 'spacing_x_mm', path),
            f'{path}.spacing_x_mm',
            DEAL_GRID_LIMITS['spacing_x_mm'],
        ),
        spacing_y_mm=_number(
            _field(data, 'spacing_y_mm', path),
            f'{path}.spacing_y_mm',
            DEAL_GRID_LIMITS['spacing_y_mm'],
        ),
        origin_mm=_vec3(
            _field(data, 'origin_mm', path), f'{path}.origin_mm', SCENE_LIMITS['position_mm']
        ),
    )


def _parse_shot(value: Any, path: str) -> Shot:
    data = _object(value, path)
    kind = _choice(_field(data, 'kind', path), f'{path}.kind', SHOT_KINDS)
    limits = SHOT_LIMITS[kind]
    common = dict(
        id=_text(_field(data, 'id', path), f'{path}.id', SCENE_TEXT_LIMITS['id']),
        kind=kind,
        target=_text(_field(data, 'target', path), f'{path}.target', SCENE_TEXT_LIMITS['id']),
        start_s=_param(data, path, 'start_s', limits),
        duration_s=_param(data, path, 'duration_s', limits),
    )
    if kind == 'turntable':
        return TurntableShot(
            **common,
            revolutions=_param(data, path, 'revolutions', limits),
            tilt_deg=_param(data, path, 'tilt_deg', limits),
        )
    if kind == 'fan':
        return FanShot(
            **common,
            spread_deg=_param(data, path, 'spread_deg', limits),
            arc_radius_mm=_param(data, path, 'arc_radius_mm', limits),
            stagger_s=_param(data, path, 'stagger_s', limits),
        )
    if kind == 'flip':
        return FlipShot(
            **common,
            axis=_choice(_field(data, 'axis', path), f'{path}.axis', FLIP_AXES),
            hold_s=_param(data, path, 'hold_s', limits),
        )
    if kind == 'deal':
        positions_value = _field(data, 'to_positions_mm', path)
        grid_value = _field(data, 'grid', path)
        if (positions_value is None) == (grid_value is None):
            _fail(path, 'needs exactly one of to_positions_mm and grid')
        positions = None
        if positions_value is not None:
            items = _array(positions_value, f'{path}.to_positions_mm')
            positions = tuple(
                _vec3(item, f'{path}.to_positions_mm[{index}]', SCENE_LIMITS['position_mm'])
                for index, item in enumerate(items)
            )
        return DealShot(
            **common,
            to_positions_mm=positions,
            grid=None if grid_value is None else _parse_grid(grid_value, f'{path}.grid'),
            arc_height_mm=_param(data, path, 'arc_height_mm', limits),
            stagger_s=_param(data, path, 'stagger_s', limits),
        )
    if kind == 'stack':
        return StackShot(
            **common,
            drop_height_mm=_param(data, path, 'drop_height_mm', limits),
            stagger_s=_param(data, path, 'stagger_s', limits),
        )
    if kind == 'parade':
        return ParadeShot(
            **common,
            spacing_mm=_param(data, path, 'spacing_mm', limits),
            revolutions=_param(data, path, 'revolutions', limits),
        )
    if kind == 'orbit':
        return OrbitShot(
            **common,
            revolutions=_param(data, path, 'revolutions', limits),
            radius_mm=_param(data, path, 'radius_mm', limits),
            height_mm=_param(data, path, 'height_mm', limits),
        )
    bound = SCENE_LIMITS['position_mm']
    return RevealShot(
        **common,
        from_mm=_vec3(_field(data, 'from_mm', path), f'{path}.from_mm', bound),
        to_mm=_vec3(_field(data, 'to_mm', path), f'{path}.to_mm', bound),
    )


def _parse_camera(value: Any, path: str) -> CameraSpec:
    data = _object(value, path)
    dof_data = _object(_field(data, 'dof', path), f'{path}.dof')
    focus_value = _field(dof_data, 'focus_target', f'{path}.dof')
    focus = (
        None
        if focus_value is None
        else _text(focus_value, f'{path}.dof.focus_target', SCENE_TEXT_LIMITS['id'])
    )
    return CameraSpec(
        focal_length_mm=_number(
            _field(data, 'focal_length_mm', path),
            f'{path}.focal_length_mm',
            CAMERA_LIMITS['focal_length_mm'],
        ),
        position_mm=_vec3(
            _field(data, 'position_mm', path), f'{path}.position_mm', SCENE_LIMITS['position_mm']
        ),
        target_mm=_vec3(
            _field(data, 'target_mm', path), f'{path}.target_mm', SCENE_LIMITS['position_mm']
        ),
        dof=CameraDof(
            enabled=_flag(_field(dof_data, 'enabled', f'{path}.dof'), f'{path}.dof.enabled'),
            focus_target=focus,
            f_stop=_number(
                _field(dof_data, 'f_stop', f'{path}.dof'),
                f'{path}.dof.f_stop',
                CAMERA_LIMITS['f_stop'],
            ),
        ),
    )


def _parse_lighting(value: Any, path: str) -> LightingSpec:
    data = _object(value, path)
    return LightingSpec(
        preset=_choice(_field(data, 'preset', path), f'{path}.preset', LIGHTING_PRESETS),
        strength=_number(
            _field(data, 'strength', path), f'{path}.strength', LIGHTING_LIMITS['strength']
        ),
        background=_choice(
            _field(data, 'background', path), f'{path}.background', SCENE_BACKGROUNDS
        ),
        background_color=_color(
            _field(data, 'background_color', path), f'{path}.background_color'
        ),
    )


def _parse_surface(value: Any, path: str) -> SurfaceSpec:
    data = _object(value, path)
    return SurfaceSpec(
        finish=_choice(_field(data, 'finish', path), f'{path}.finish', SURFACE_FINISHES),
        color=_color(_field(data, 'color', path), f'{path}.color'),
        width_mm=_number(
            _field(data, 'width_mm', path), f'{path}.width_mm', SURFACE_LIMITS['width_mm']
        ),
        depth_mm=_number(
            _field(data, 'depth_mm', path), f'{path}.depth_mm', SURFACE_LIMITS['depth_mm']
        ),
        thickness_mm=_number(
            _field(data, 'thickness_mm', path),
            f'{path}.thickness_mm',
            SURFACE_LIMITS['thickness_mm'],
        ),
        sweep_height_mm=_number(
            _field(data, 'sweep_height_mm', path),
            f'{path}.sweep_height_mm',
            SURFACE_LIMITS['sweep_height_mm'],
        ),
    )


def _parse_render(value: Any, path: str) -> RenderSpec:
    data = _object(value, path)
    resolution = _array(_field(data, 'resolution', path), f'{path}.resolution')
    if len(resolution) != 2:
        _fail(f'{path}.resolution', f'must be two numbers, not {len(resolution)}')
    frames = _array(_field(data, 'frame_range', path), f'{path}.frame_range')
    if len(frames) != 2:
        _fail(f'{path}.frame_range', f'must be two numbers, not {len(frames)}')
    first = _whole(frames[0], f'{path}.frame_range[0]', RENDER_LIMITS['frame'])
    last = _whole(frames[1], f'{path}.frame_range[1]', RENDER_LIMITS['frame'])
    if last < first:
        _fail(f'{path}.frame_range', f'ends at {last}, before it starts at {first}')
    return RenderSpec(
        engine=_choice(_field(data, 'engine', path), f'{path}.engine', RENDER_ENGINES),
        resolution=(
            _whole(resolution[0], f'{path}.resolution[0]', RENDER_LIMITS['resolution_px']),
            _whole(resolution[1], f'{path}.resolution[1]', RENDER_LIMITS['resolution_px']),
        ),
        fps=_whole(_field(data, 'fps', path), f'{path}.fps', RENDER_LIMITS['fps']),
        samples=_whole(_field(data, 'samples', path), f'{path}.samples', RENDER_LIMITS['samples']),
        frame_range=(first, last),
    )


def _check_count(items: Sequence[Any], path: str, limits: Limit) -> None:
    low, high = limits
    if len(items) < low or len(items) > high:
        _fail(path, f'must hold {int(low)} to {int(high)} entries, not {len(items)}')


def parse_scene(data: Any) -> SceneDocument:
    """Turn a decoded scene.json into a document, or raise SceneError."""
    root = _object(data, 'document')
    if _field(root, 'format', 'document') != SCENE_FORMAT:
        _fail('format', f'must be "{SCENE_FORMAT}"')
    version = _field(root, 'version', 'document')
    if version != SCENE_VERSION:
        _fail('version', f'must be {SCENE_VERSION}, not {version!r}')
    if _field(root, 'units', 'document') != 'mm':
        _fail('units', 'must be "mm"')

    # The one optional block. Present and malformed is still refused: a table
    # nobody asked for is a scene nobody meant, and so is a table somebody asked
    # for in millimetres the importer cannot build.
    surface_raw = root.get('surface')

    assets_raw = _array(_field(root, 'assets', 'document'), 'assets')
    instances_raw = _array(_field(root, 'instances', 'document'), 'instances')
    shots_raw = _array(_field(root, 'shots', 'document'), 'shots')
    _check_count(assets_raw, 'assets', SCENE_LIMITS['assets'])
    _check_count(instances_raw, 'instances', SCENE_LIMITS['instances'])
    _check_count(shots_raw, 'shots', SCENE_LIMITS['shots'])

    assets = tuple(
        _parse_asset(item, f'assets[{index}]') for index, item in enumerate(assets_raw)
    )
    instances = tuple(
        _parse_instance(item, f'instances[{index}]') for index, item in enumerate(instances_raw)
    )
    shots = tuple(_parse_shot(item, f'shots[{index}]') for index, item in enumerate(shots_raw))
    _unique([asset.id for asset in assets], 'assets')
    _unique([instance.id for instance in instances], 'instances')
    _unique([shot.id for shot in shots], 'shots')

    scene = SceneDocument(
        generated_at=_text(
            _field(root, 'generated_at', 'document'),
            'generated_at',
            SCENE_TEXT_LIMITS['generated_at'],
        ),
        project_name=_text(
            _field(root, 'project_name', 'document'),
            'project_name',
            SCENE_TEXT_LIMITS['project_name'],
        ),
        assets=assets,
        instances=instances,
        shots=shots,
        camera=_parse_camera(_field(root, 'camera', 'document'), 'camera'),
        lighting=_parse_lighting(_field(root, 'lighting', 'document'), 'lighting'),
        render=_parse_render(_field(root, 'render', 'document'), 'render'),
        surface=None if surface_raw is None else _parse_surface(surface_raw, 'surface'),
    )

    asset_ids = {asset.id for asset in assets}
    for index, instance in enumerate(instances):
        if instance.asset_id not in asset_ids:
            _fail(f'instances[{index}].asset_id', f'names no asset ("{instance.asset_id}")')
    for index, shot in enumerate(shots):
        if not target_exists(scene, shot.target):
            _fail(f'shots[{index}].target', f'names nothing ("{shot.target}")')
    focus = scene.camera.dof.focus_target
    if focus is not None and not target_exists(scene, focus):
        _fail('camera.dof.focus_target', f'names nothing ("{focus}")')

    last = scene_frame_range(shots, instances, scene.render.fps)[1]
    if scene.render.frame_range[1] < last:
        _fail(
            'render.frame_range',
            f'ends at {scene.render.frame_range[1]}, before the shots do at {last}',
        )
    return scene


def load_scene(path: Union[str, Path]) -> SceneDocument:
    """Read one scene.json off disk. A file that is not JSON fails as loudly."""
    source = Path(path)
    try:
        raw = json.loads(source.read_text(encoding='utf-8'))
    except json.JSONDecodeError as error:
        raise SceneError(f'{source}: is not JSON ({error})') from error
    return parse_scene(raw)


# --- reading a parsed scene ---------------------------------------------------


def target_exists(scene: SceneDocument, target: str) -> bool:
    if target == SCENE_TARGET:
        return True
    return any(item.id == target or item.group == target for item in scene.instances)


def is_camera_shot(shot: Shot) -> bool:
    return shot.kind in CAMERA_SHOT_KINDS


def is_staggered_shot(shot: Shot) -> bool:
    return shot.kind in STAGGERED_SHOT_KINDS


def instances_for_target(
    instances: Sequence[SceneInstance], target: str
) -> List[SceneInstance]:
    if target == SCENE_TARGET:
        return list(instances)
    return [item for item in instances if item.group == target or item.id == target]


def shot_end_seconds(shot: Shot, target_count: int) -> float:
    """The pair with frame_for_seconds that scenes.ts states the rule for."""
    trailing = 0.0
    if is_staggered_shot(shot):
        trailing = float(getattr(shot, 'stagger_s')) * max(0, target_count - 1)
    return shot.start_s + trailing + shot.duration_s


def frame_for_seconds(seconds: float, fps: int) -> int:
    # floor(x + 0.5) rather than round(): Python rounds a half to even and the
    # exporter that derived render.frame_range rounded it half up, so round()
    # would put this module one frame under the browser's answer on every exact
    # half and reject a range that is right.
    return 1 + math.floor(seconds * fps + 0.5)


def scene_frame_range(
    shots: Sequence[Shot], instances: Sequence[SceneInstance], fps: int
) -> Tuple[int, int]:
    end = 0.0
    for shot in shots:
        count = 1 if is_camera_shot(shot) else len(instances_for_target(instances, shot.target))
        end = max(end, shot_end_seconds(shot, max(1, count)))
    return (1, max(1, frame_for_seconds(end, fps)))
