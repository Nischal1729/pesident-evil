"""
Pesident Evil -- realistic prop builder entry point (Blender 5.2, headless).

    blender -b --factory-startup -P tools/props/build.py -- bike motorbike      # build some props
    blender -b --factory-startup -P tools/props/build.py -- all                 # everything
    ... -- bike --preview                                                       # + Cycles preview PNGs

Outputs public/models/props/<name>.glb (+ <name>_lod.glb) and previews in tools/blender/_renders/props2/.
See lib.py for the pipeline and docs/ARCHITECTURE.md (Props) for the contract.
"""
import os, sys, time, importlib
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import lib
importlib.reload(lib)

MODULES = ['two_wheelers', 'bus', 'car', 'auto', 'street', 'furniture']
REGISTRY = {}
for mname in MODULES:
    try:
        mod = importlib.import_module(mname)
        importlib.reload(mod)
    except ModuleNotFoundError as e:
        if e.name == mname:
            continue
        raise
    for k, fn in getattr(mod, 'PROPS', {}).items():
        REGISTRY[k] = fn


def main():
    argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    do_preview = '--preview' in argv
    names = [a for a in argv if not a.startswith('--')]
    if not names or names == ['all']:
        names = list(REGISTRY)
    stats = {}
    for n in names:
        if n not in REGISTRY:
            lib.log('unknown prop', n, 'known:', ', '.join(REGISTRY))
            continue
        t = time.time()
        lib.reset()
        lib.MATINFO.clear()
        stats[n] = REGISTRY[n]() or {}
        lib.log(f'== {n} done in {time.time() - t:.1f}s {stats[n]}')
        if do_preview:
            for suffix in ('', '_lod'):
                glb = os.path.join(lib.OUT, f'{n}{suffix}.glb')
                if os.path.exists(glb):
                    lib.preview(glb, os.path.join(lib.WORK, f'preview_{n}{suffix}.png'))
    for n, s in stats.items():
        sz = os.path.getsize(os.path.join(lib.OUT, f'{n}.glb')) / 1024
        lz = os.path.join(lib.OUT, f'{n}_lod.glb')
        lsz = os.path.getsize(lz) / 1024 if os.path.exists(lz) else 0
        lib.log(f'STAT {n}: {s} {sz:.0f} KB' + (f' + lod {lsz:.0f} KB' if lsz else ''))


main()
