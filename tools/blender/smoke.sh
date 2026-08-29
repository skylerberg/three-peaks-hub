#!/usr/bin/env bash
# Renders one frame through the importer and proves a real picture came out.
#
# The failure this is built against is a check that measures nothing: a render
# that writes a black square, or an empty grey field, is a file on disk and an
# exit code of zero. So the PNG is decoded and interrogated -- it has to have
# structure, a plausible exposure, and a subject that differs from its
# background -- and before any of that the importer is handed a broken document
# and has to refuse it.
#
#   pnpm run blender:smoke              build a fixture and check the render
#   tools/blender/smoke.sh scene.json   render somebody's own bundle instead
#
# BLENDER overrides which binary is used. SMOKE_SAMPLES and SMOKE_ENGINE trade
# quality for time.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
samples="${SMOKE_SAMPLES:-24}"
engine="${SMOKE_ENGINE:-CYCLES}"
scene_arg="${1:-}"

die() {
  echo "smoke: $*" >&2
  exit 1
}

resolve_blender() {
  if [ -n "${BLENDER:-}" ]; then
    [ -x "$BLENDER" ] || die "\$BLENDER is set to '$BLENDER', which is not an executable"
    printf '%s' "$BLENDER"
    return
  fi
  local mac='/Applications/Blender.app/Contents/MacOS/Blender'
  if [ -x "$mac" ]; then
    printf '%s' "$mac"
    return
  fi
  if command -v blender >/dev/null 2>&1; then
    command -v blender
    return
  fi
  die "no Blender found.
  Looked at \$BLENDER, then $mac, then 'blender' on PATH.
  Install it from https://www.blender.org/download/ (5.2 LTS or newer), or set
  BLENDER to the binary inside an existing install -- on macOS that is the file
  above, not the .app directory."
}

blender="$(resolve_blender)"
echo "smoke: using $blender"
"$blender" --version | head -1

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# --- the importer has to refuse a document it cannot build -------------------

echo '{"format":"not-a-scene"}' >"$work/broken.json"
if "$blender" --background --factory-startup --python "$here/import_scene.py" -- \
  "$work/broken.json" >"$work/broken.log" 2>&1; then
  die "a malformed scene.json was accepted; the importer is not checking anything"
fi
echo 'smoke: a malformed scene.json is refused, as it should be'

# --- the bundle --------------------------------------------------------------

if [ -n "$scene_arg" ]; then
  [ -f "$scene_arg" ] || die "$scene_arg: no such file"
  scene="$scene_arg"
  fixture=0
else
  mkdir -p "$work/bundle/assets"
  # A component export stands in for the real thing: a card-sized slab carrying
  # a texture, upright and thin in Y, which is where a three.js XY-plane
  # extrusion lands once the glTF Y-up flip is undone on import.
  cat >"$work/make_asset.py" <<'PY'
import bpy, sys
out = sys.argv[sys.argv.index('--') + 1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(size=1.0)
card = bpy.context.active_object
card.name = 'Card'
card.scale = (0.063 / 2.0, 0.00032 / 2.0, 0.088 / 2.0)
bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
image = bpy.data.images.new('art', width=256, height=256)
image.generated_type = 'COLOR_GRID'
material = bpy.data.materials.new('CardArt')
material.use_nodes = True
tree = material.node_tree
bsdf = [n for n in tree.nodes if n.bl_idname == 'ShaderNodeBsdfPrincipled'][0]
texture = tree.nodes.new('ShaderNodeTexImage')
texture.image = image
tree.links.new(texture.outputs['Color'], bsdf.inputs['Base Color'])
card.data.materials.append(material)
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB')
PY
  "$blender" --background --factory-startup --python "$work/make_asset.py" -- \
    "$work/bundle/assets/card.glb" >"$work/asset.log" 2>&1 ||
    die "could not build the fixture .glb; see $work/asset.log"

  python3 - "$work/bundle/scene.json" <<'PY'
import json
import sys

# Written the way the exporter writes it, which is the whole point of feeding
# this to the importer: a card rests half its own thickness above the table and
# carries the quarter turn that lays a glTF component down, and a library piece
# stands on its own origin and needs neither.
THICKNESS_MM = 0.32
instances = [
    {
        'id': f'card-{index}',
        'asset_id': 'asset-card',
        'label': f'Villager {index + 1}',
        'group': 'deck:villagers',
        'position_mm': [0, 0, THICKNESS_MM / 2 + (4 - index) * THICKNESS_MM],
        'rotation_deg': [-90, 0, 0],
    }
    for index in range(5)
]
instances.append(
    {
        'id': 'die-1',
        'asset_id': 'asset-d6',
        'label': 'D6',
        'group': None,
        'position_mm': [95, -20, 0],
        'rotation_deg': [0, 0, 22],
    }
)
json.dump(
    {
        'format': 'three-peaks-scene',
        'version': 1,
        'generated_at': '1970-01-01T00:00:00.000Z',
        'project_name': 'Smoke',
        'units': 'mm',
        'assets': [
            {
                'kind': 'glb',
                'id': 'asset-card',
                'path': 'assets/card.glb',
                'component': 'card',
                'label': 'Villager card',
            },
            {
                'kind': 'library',
                'id': 'asset-d6',
                'piece': 'd6',
                'color': '#c0392b',
                'size_mm': 16,
                'label': 'D6 die',
            },
        ],
        'instances': instances,
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
            }
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
            'background': 'gradient',
            'background_color': '#101418',
        },
        'surface': {
            'finish': 'wood',
            'color': '#6b4a2f',
            'width_mm': 900,
            'depth_mm': 500,
            'thickness_mm': 18,
            'sweep_height_mm': 320,
        },
        'render': {
            'engine': 'CYCLES',
            'resolution': [640, 360],
            'fps': 30,
            'samples': 24,
            'frame_range': [1, 61],
        },
    },
    open(sys.argv[1], 'w'),
    indent=2,
)
PY
  scene="$work/bundle/scene.json"
  fixture=1
fi

# --- the render --------------------------------------------------------------

echo "smoke: rendering $scene"
"$blender" --background --factory-startup --python "$here/import_scene.py" -- \
  "$scene" --render "$work/out" --frame 40 --engine "$engine" --samples "$samples" ||
  die 'the importer exited non-zero'

png="$(find "$work/out" -name '*.png' -print -quit)"
[ -n "$png" ] || die "the importer wrote no PNG into $work/out"
cp "$png" "${SMOKE_KEEP:-$work}/smoke.png" 2>/dev/null || true

python3 - "$png" "$fixture" <<'PY'
import struct
import sys
import zlib

path, fixture = sys.argv[1], sys.argv[2] == '1'
blob = open(path, 'rb').read()
if len(blob) < 8192:
    sys.exit(f'smoke: {path} is only {len(blob)} bytes; nothing real rendered')
if blob[:8] != b'\x89PNG\r\n\x1a\n':
    sys.exit(f'smoke: {path} is not a PNG')

header, data, offset = None, b'', 8
while offset < len(blob):
    (length,) = struct.unpack('>I', blob[offset : offset + 4])
    kind = blob[offset + 4 : offset + 8]
    body = blob[offset + 8 : offset + 8 + length]
    if kind == b'IHDR':
        header = struct.unpack('>IIBBBBB', body)
    elif kind == b'IDAT':
        data += body
    offset += length + 12

width, height, depth, color, _, _, interlace = header
if depth != 8 or interlace != 0:
    sys.exit(f'smoke: unexpected PNG form (depth {depth}, interlace {interlace})')
channels = {0: 1, 2: 3, 4: 2, 6: 4}.get(color)
if channels is None:
    sys.exit(f'smoke: unexpected PNG colour type {color}')

raw = zlib.decompress(data)
stride = width * channels
rows, previous, cursor = [], bytearray(stride), 0
for _ in range(height):
    method = raw[cursor]
    line = bytearray(raw[cursor + 1 : cursor + 1 + stride])
    cursor += 1 + stride
    for index in range(stride):
        left = line[index - channels] if index >= channels else 0
        up = previous[index]
        upleft = previous[index - channels] if index >= channels else 0
        if method == 1:
            line[index] = (line[index] + left) & 255
        elif method == 2:
            line[index] = (line[index] + up) & 255
        elif method == 3:
            line[index] = (line[index] + (left + up) // 2) & 255
        elif method == 4:
            estimate = left + up - upleft
            da, db, dc = abs(estimate - left), abs(estimate - up), abs(estimate - upleft)
            best = left if da <= db and da <= dc else (up if db <= dc else upleft)
            line[index] = (line[index] + best) & 255
    rows.append(line)
    previous = line


def luminance(x, y):
    base = x * channels
    pixel = rows[y]
    if channels >= 3:
        return 0.2126 * pixel[base] + 0.7152 * pixel[base + 1] + 0.0722 * pixel[base + 2]
    return float(pixel[base])


def region(x0, x1, y0, y1):
    values = [luminance(x, y) for y in range(y0, y1) for x in range(x0, x1)]
    return sum(values) / max(len(values), 1)


# Only where the render put something. A transparent film is the default a
# trailer wants, and a frame that is mostly film averages the film -- so a
# correct wide shot of a small subject reads as black, and the one thing this
# is built to catch would be indistinguishable from it.
alpha = 3 if channels == 4 else (1 if channels == 2 else None)


def covered(x, y):
    return alpha is None or rows[y][x * channels + alpha] > 0


colours = set()
total, squares, count = 0.0, 0.0, 0
for y in range(height):
    line = rows[y]
    for x in range(width):
        if not covered(x, y):
            continue
        base = x * channels
        colours.add(bytes(line[base : base + min(channels, 3)]))
        value = luminance(x, y)
        total += value
        squares += value * value
        count += 1

problems = []
if count == 0:
    sys.exit('smoke: every pixel is clear film; nothing was drawn at all')

mean = total / count
deviation = max(squares / count - mean * mean, 0.0) ** 0.5

if len(colours) < 256:
    problems.append(f'only {len(colours)} distinct colours; this is close to a flat fill')
if deviation < 8.0:
    problems.append(f'luminance deviation is {deviation:.1f}; the frame has no structure in it')
if not 4.0 <= mean <= 248.0:
    problems.append(f'mean luminance is {mean:.1f}; what was drawn is black or blown out')

if fixture:
    centre = region(width * 2 // 5, width * 3 // 5, height * 2 // 5, height * 3 // 5)
    corner = region(0, width // 8, 0, height // 8)
    if abs(centre - corner) < 6.0:
        problems.append(
            f'the middle of the frame ({centre:.1f}) matches its corner ({corner:.1f}); '
            'nothing is standing in front of the background'
        )

if problems:
    sys.exit('smoke: ' + '\n       '.join(problems))

print(
    f'smoke: {width}x{height}, {count} pixels drawn on, {len(colours)} colours, '
    f'mean luminance {mean:.1f}, deviation {deviation:.1f} -- a real picture'
)
PY

echo 'smoke: ok. Re-run it with `pnpm run blender:smoke`; no check:* script will.'
