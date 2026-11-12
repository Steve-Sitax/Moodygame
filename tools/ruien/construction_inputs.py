"""Preserve or restore the final editable Ruien construction inputs, without caches."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / 'art-source/ruien-o2-20261018/complete-network'
DEFAULT_STAGE = ROOT / '.scratch/ruien-complete'
CONFIGS = (
    'construction.json', 'drainage-construction.json',
    'native-conversion-areas.json', 'connected-entrances.json',
    'network-gates.json', 'native-drainage.json', 'surface-drainage.json',
    'entrance-connections.json',
)


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def encode(value):
    return (json.dumps(value, indent=2, ensure_ascii=False) + '\n').encode('utf-8')


def mapped(value, substitutions):
    if isinstance(value, dict):
        return {key: mapped(item, substitutions) for key, item in value.items()}
    if isinstance(value, list):
        return [mapped(item, substitutions) for item in value]
    if isinstance(value, str):
        for source, target in substitutions:
            if value == source or value.startswith(source + '/'):
                return target + value[len(source):]
    return value


def inputs(stage):
    layouts = stage / 'layouts'
    rooms = read(layouts / 'layouts.json')['layouts']
    halls = [h['room']['id'] for h in read(layouts / 'halls.json')['halls']]
    routes = read(layouts / 'routes.json')['jobs']
    files = set(CONFIGS)
    files.update('layouts/' + name for name in (
        'layouts.json', 'halls.json', 'routes.json', 'plan.json',
        'compiled-network-plan.json', 'flush-plan.json', 'gate-bindings.json',
    ))
    files.update(f'layouts/{rid}.json' for rid in rooms)
    files.update(f'layouts/{rid}-hall.json' for rid in halls)
    files.update(f'layouts/routes/{rid}.json' for rid in routes)
    files.update(f'layouts/bindings/{rid}.json' for rid in set(rooms) | set(halls))
    missing = [name for name in files if not (stage / name).is_file()]
    if missing:
        raise ValueError('Missing construction inputs: ' + ', '.join(sorted(missing)))
    return sorted(files)


def snapshot(stage):
    files = inputs(stage)
    substitutions = [(stage.as_posix(), '${RUIEN_STAGE}'), (ROOT.as_posix(), '${PROJECT_ROOT}')]
    encoded = {name: encode(mapped(read(stage / name), substitutions)) for name in files}
    # The directory owns only this inventory; obsolete layouts are never retained.
    existing = set()
    manifest_path = ARCHIVE / 'inventory.json'
    if manifest_path.exists():
        existing = set(read(manifest_path)['files'])
    for name, data in encoded.items():
        target = ARCHIVE / 'inputs' / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    for name in existing - encoded.keys():
        target = (ARCHIVE / 'inputs' / name).resolve()
        if not target.is_relative_to((ARCHIVE / 'inputs').resolve()):
            raise ValueError('Invalid old inventory path: ' + name)
        target.unlink(missing_ok=True)
    generators = list((ROOT / 'art-source/ruien-o2-20261018/scripts').rglob('*.py'))
    generators += list((ROOT / 'art-source/ruien-o2-20261018/scripts/kit').glob('*.json'))
    generators += list((ROOT / 'tools/ruien').glob('*.py'))
    inventory = dict(
        format=1,
        about='Editable construction inputs only. Geometry, proof results and caches are not acceptance records here.',
        files={name: hashlib.sha256(data).hexdigest() for name, data in encoded.items()},
        generators={p.relative_to(ROOT).as_posix(): hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(set(generators))},
    )
    manifest_path.write_bytes(encode(inventory))
    print(f'Preserved {len(encoded)} inputs, {sum(map(len, encoded.values())):,} bytes')


def restore(stage):
    if stage == ROOT or stage.is_relative_to(ARCHIVE) or stage.is_relative_to(ROOT / 'native-godot/world'):
        raise ValueError('Restore into a new staging directory')
    inventory = read(ARCHIVE / 'inventory.json')
    substitutions = [('${RUIEN_STAGE}', stage.as_posix()), ('${PROJECT_ROOT}', ROOT.as_posix())]
    prepared = []
    for name, expected in inventory['files'].items():
        source = (ARCHIVE / 'inputs' / name).resolve()
        target = (stage / name).resolve()
        if not source.is_relative_to((ARCHIVE / 'inputs').resolve()) or not target.is_relative_to(stage):
            raise ValueError('Invalid inventory path: ' + name)
        data = source.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected:
            raise ValueError('Changed archived input: ' + name)
        if target.exists():
            raise ValueError('Refusing to overwrite existing construction input: ' + str(target))
        prepared.append((target, encode(mapped(json.loads(data), substitutions))))
    for target, data in prepared:
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    print(f'Restored {len(prepared)} inputs into {stage}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=('snapshot', 'restore'))
    parser.add_argument('--stage', type=Path, default=DEFAULT_STAGE)
    args = parser.parse_args()
    (snapshot if args.action == 'snapshot' else restore)(args.stage.resolve())


if __name__ == '__main__':
    main()
