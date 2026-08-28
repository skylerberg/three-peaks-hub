"""Build a Blender scene from an exported bundle.

    blender --background --python tools/blender/import_scene.py -- scene.json [options]

Blender consumes everything before the `--` itself, so the arguments below are
read from what follows it. Run with no arguments at all for the option list.
"""

import argparse
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import scene as scene_builder  # noqa: E402  (must follow the sys.path line)
from scenedoc import SceneError, load_scene  # noqa: E402


def _script_args(argv):
    if '--' not in argv:
        return []
    return argv[argv.index('--') + 1 :]


def _parse(argv):
    parser = argparse.ArgumentParser(
        prog='import_scene.py',
        description='Build a Blender scene from a three-peaks scene bundle.',
    )
    parser.add_argument('scene', help='path to scene.json inside the unpacked bundle')
    parser.add_argument('--render', metavar='DIR', help='render into DIR and exit')
    parser.add_argument('--frame', type=int, help='which frame to render (default: the first)')
    parser.add_argument(
        '--animation', action='store_true', help='render every frame instead of one'
    )
    parser.add_argument(
        '--engine', choices=('CYCLES', 'EEVEE'), help="override the document's engine"
    )
    parser.add_argument('--samples', type=int, help="override the document's sample count")
    parser.add_argument('--scale', type=int, help='render at this percentage of the resolution')
    parser.add_argument(
        '--device',
        choices=('CPU', 'GPU'),
        help='which Cycles device to render on (default: whatever Blender is set to)',
    )
    parser.add_argument('--blend', metavar='FILE', help='save the built scene as a .blend')
    return parser.parse_args(argv)


def _fail(message):
    print(f'import_scene: {message}', file=sys.stderr)
    sys.exit(1)


def _build(args):
    path = os.path.abspath(args.scene)
    if not os.path.isfile(path):
        _fail(f'{args.scene}: no such file')
    try:
        document = load_scene(path)
    except SceneError as error:
        _fail(f'{args.scene}: {error}')

    overrides = {
        'engine': args.engine,
        'samples': args.samples,
        'scale': args.scale,
        'device': args.device,
    }
    try:
        built = scene_builder.build(document, os.path.dirname(path), overrides)
    except SceneError as error:
        _fail(str(error))

    if args.blend:
        blend = os.path.abspath(args.blend)
        os.makedirs(os.path.dirname(blend) or '.', exist_ok=True)
        scene_builder.save_blend(blend)

    if args.render:
        target = os.path.abspath(args.render)
        os.makedirs(target, exist_ok=True)
        if args.animation:
            scene_builder.render_animation(built, os.path.join(target, ''))
        else:
            frame = args.frame if args.frame is not None else built.scene.frame_start
            scene_builder.render_still(built, os.path.join(target, f'frame_{frame:04d}'), frame)

    print(
        f'import_scene: built {len(document.instances)} instances from '
        f'{len(document.assets)} assets, {len(document.shots)} shots, frames '
        f'{built.scene.frame_start}-{built.scene.frame_end}'
    )


def main():
    argv = _script_args(sys.argv)
    if not argv:
        _fail(
            'no scene given.\n'
            '  usage: blender --background --python tools/blender/import_scene.py '
            '-- scene.json [--render DIR]\n'
            "  the `--` is what separates Blender's own arguments from these."
        )
    args = _parse(argv)
    try:
        _build(args)
    except SystemExit:
        raise
    except BaseException:
        # Blender runs a --python script for its side effects and exits 0 even
        # when one raises, so an importer that only let the traceback through
        # would fail silently and successfully. Everything lands here instead.
        traceback.print_exc()
        _fail('the scene could not be built; the traceback above is from Blender')


if __name__ == '__main__':
    main()
