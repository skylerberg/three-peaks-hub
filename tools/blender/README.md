# The Blender importer

Reads a scene bundle exported by the web app and builds the Blender scene it
describes: components placed and instanced, shots keyframed, camera, lights and
render settings set. What comes out is a starting point to finish by hand, not a
finished render.

## Installing Blender

[Download 5.2 LTS or newer](https://www.blender.org/download/). Nothing here is
a Blender add-on, so there is nothing to install into it.

The binary is not on `PATH` on macOS. Everything here looks at `$BLENDER` first,
then `/Applications/Blender.app/Contents/MacOS/Blender`, then `blender` on
`PATH`, so either set `BLENDER` or let the default find it:

```sh
export BLENDER=/Applications/Blender.app/Contents/MacOS/Blender
```

## Running it

Unpack the exported ZIP, then point the importer at the `scene.json` inside it.
Blender takes its own arguments first and everything after `--` reaches the
script:

```sh
"$BLENDER" --background --python tools/blender/import_scene.py -- path/to/scene.json
```

That builds the scene and exits, which is only useful with something else asked
of it:

| Option                   | What it does                                     |
| ------------------------ | ------------------------------------------------ |
| `--render DIR`           | render one frame into `DIR`                      |
| `--frame N`              | which frame (default: the first)                 |
| `--animation`            | render every frame instead of one                |
| `--blend FILE`           | save the built scene, to open and finish by hand |
| `--engine CYCLES\|EEVEE` | override the engine the document asked for       |
| `--samples N`            | override the sample count                        |
| `--scale N`              | render at N% of the resolution, for a fast look  |
| `--device CPU\|GPU`      | which Cycles device                              |

Drop `--background` to open the result in the GUI.

`--device GPU` is worth having for a real render and worth avoiding for a quick
one: the first GPU render after an install compiles kernels, which takes minutes
of near-idle wall clock before a single sample is traced.

A bundle it will not build is refused with the field it refused and a non-zero
exit, before Blender is asked to open anything.

### Checking it still works

```sh
pnpm run blender:smoke
```

Builds its own fixture, renders a frame, and interrogates the PNG that comes out
rather than trusting that one exists. Pass a `scene.json` to run it against a
real bundle instead — `SCENE_KEEP=DIR pnpm run check:scene` unpacks one for it,
straight from the export screen. `SMOKE_SAMPLES` and `SMOKE_ENGINE` trade
quality for time; `SMOKE_KEEP=DIR` keeps the image it rendered.

## What is in a bundle

```
scene.json          the whole scene: assets, instances, shots, camera, lighting,
                    the table it stands on, and render
assets/*.glb        one file per distinct component, however many instances use it
```

`packages/shared/src/scenes.ts` owns the document's shape and its bounds;
`scenedoc.py` is this end of that contract and refuses anything outside them.
No server holds a copy, so the bundle in your hands is the scene — keep it
beside the `.blend` it built.

Lengths are millimetres, angles degrees, times seconds. Axes are Blender's: +X
right, +Y away from the default camera, +Z up.

An **instance** is one component placed once; several of them share one asset,
and in Blender one mesh datablock. A **library piece** (`d6`, `meeple`, `cube`,
`disc`, `cylinder`) has no file at all; `pieces.py` builds it here from its name
and size.

A **shot** names a target — a group like `deck:villagers`, a single instance id,
or `scene` — and carries parameters rather than keyframes. `shots.py` expands
those into the curves.

The **surface** is the table, and it is neither an asset nor an instance: no
shot can be aimed at it and the light rig is not sized on it. `stage.py` builds
it from a finish, a colour and its millimetres, so it costs the bundle no bytes
either. Its top face is `z = 0`, the plane every instance already rests on, and
`sweep_height_mm` is how far it curves up into a seamless backdrop at the far
edge — `0` for a plain slab. A document without one is a scene standing on
nothing, which is what a transparent film for compositing wants.

## What the importer builds

```
Components/
  deck:villagers/   one collection per group, so a shot's target can be
  Ungrouped/        hidden, soloed or moved as a unit
Stage/
  Table             the surface, and the backdrop it sweeps up into
Rig/
  Camera            keyframed by an orbit or reveal; otherwise still
  CameraTarget      where the camera is aimed, and the default focus for DoF
  Key / Fill / Rim  area lights, aimed by Track To at LightTarget
  Floor             a shadow catcher, standing in for a table the scene has
                    not got, on an opaque film under Cycles only
```

Each instance object carries `instance_id`, `asset_id` and `group` as custom
properties, so a scene that has been worked on by hand can still be read back
against the bundle it came from.

## Editing a shot by hand

This is the point of the whole thing, so the output is built to be edited.

Keys are **sparse**, and each carries an interpolation and an easing. Select an
instance, open the Dope Sheet to slide the timing or the Graph Editor to change
the shape.

- **Retime a move**: drag its keys in the Dope Sheet. A staggered shot is one
  offset copy of the same pair of keys per instance, so box-select a column and
  drag it.
- **Change how a move feels**: select the key a segment _starts_ at and set
  `Key ▸ Interpolation`. A key governs the segment leaving it, not the one
  arriving.
- **Re-aim the camera**: move `CameraTarget`. That only holds where no shot has
  keyframed the camera — an orbit writes its own aim, and its rotation keys win.
- **Relight**: every lamp is aimed by a constraint, so drag one anywhere and it
  stays pointed at the subject. Wattages are set for the size of what was
  imported; change `strength` in the document to move all of them together. A
  backdrop is a wall, so a lamp that would have stood behind one is brought
  forward to it and raised by as much as keeps its distance — which is where a
  back light belongs on a sweep anyway.
- **Redress the set**: `Table` is an ordinary mesh with an ordinary material.
  Swap the material for a scanned one, or delete the object outright for a
  render on nothing.
- **Roll the camera**: `rotation_euler[1]` is deliberately left unkeyed, so a
  dutch angle added by hand survives a re-import of the same shot.

Re-running the importer builds the scene from scratch and keeps none of this, so
save to a `.blend` before spending real time in one.

## The modules

| File              |                                             |
| ----------------- | ------------------------------------------- |
| `import_scene.py` | the CLI                                     |
| `scenedoc.py`     | reads and checks `scene.json`               |
| `shots.py`        | shot parameters into keyframe tracks        |
| `pieces.py`       | parametric geometry for the library pieces  |
| `stage.py`        | the table's profile and the sweep behind it |
| `scene.py`        | builds the Blender scene                    |
| `lighting.py`     | the four lighting presets and the world     |
| `materials.py`    | the production pass over imported materials |

`scenedoc.py`, `shots.py`, `pieces.py` and `stage.py` import no `bpy` and run
under plain `python3`. `tests/` covers those four; run them with
`pnpm run check:scene-shots`.
