"""Apply a staged drain reroute only after its actual native foundation proof passes."""
import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
from construction import load, nearest_on_path
from native_layout import STAGE


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest().upper()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--candidate', type=Path, required=True)
    parser.add_argument('--native-proof', type=Path, required=True)
    parser.add_argument('--raw-routes', type=Path, required=True)
    parser.add_argument('--smooth-proof', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    candidate = load(args.candidate)
    original = load(STAGE / 'native-drainage.json')
    proof = load(args.native_proof)
    if proof['networkSha256'] != sha(args.candidate) or proof['errors']:
        raise ValueError('Native entrance/drain proof is stale or failed')
    if (proof['Entrances'], proof['Heads'], proof['Collectors'], proof['Inlets']) != (26, 572, 844, 918):
        raise ValueError('Native proof must cover the whole drainage network and all entrances')
    for scene in proof['scenes']:
        if sha(Path(scene['path'])) != scene['sha256']:
            raise ValueError('Proven entrance scene changed: ' + scene['path'])
    changed = {}
    for key in ('heads', 'collectors', 'inlets'):
        if [v['id'] for v in original[key]] != [v['id'] for v in candidate[key]]:
            raise ValueError('Drainage identifiers or ordering changed: ' + key)
        changed[key] = {old['id'] for old, new in zip(original[key], candidate[key]) if old != new}
    if not any(changed.values()):
        print('Drain foundation repair already applied')
        return
    for old, new in zip(original['inlets'], candidate['inlets']):
        if old['fromPoint'] != new['fromPoint'] or old['diameter'] != new['diameter'] or old['collector'] != new['collector']:
            raise ValueError('Surveyed outlet or its connection identity changed: ' + old['id'])
    for old, new in zip(original['collectors'], candidate['collectors']):
        for field in ('sourceIndex', 'sourcePath'):
            if old.get(field) != new.get(field):
                raise ValueError('Collector survey changed: ' + old['id'])
        if (old['destination']['kind'], old['destination']['id']) != (new['destination']['kind'], new['destination']['id']):
            raise ValueError('Collector graph changed: ' + old['id'])
    heads = {h['id']: h for h in candidate['heads']}
    done = {}
    for c in candidate['collectors']:
        dest = c['destination']
        if dest['kind'] == 'head':
            target = heads[dest['id']]
            gap = math.dist(c['path'][-1], target['seam'])
            invert = target['invert']
        else:
            parent = done[dest['id']]
            gap, u, _, _ = nearest_on_path(c['path'][-1], parent['path'])
            invert = parent['invertStart'] + (parent['invertEnd'] - parent['invertStart']) * u / parent['length']
        if gap > .005 or abs(invert - c['invertEnd']) > .005:
            raise ValueError('Unjoined collector: ' + c['id'])
        done[c['id']] = c
    smooth = load(args.smooth_proof)
    if smooth['failures']:
        raise ValueError('Collector sweep proof failed')
    curves = {v['id']: v for v in smooth['paths']}
    if changed['collectors'] != set(curves) or any(v['minRadius'] < .55 for v in curves.values()):
        raise ValueError('Every changed collector must have a valid full-width sweep')
    raw = {c['id']: c for c in load(args.raw_routes)['collectors']}
    construction = load(STAGE / 'drainage-construction.json')
    for key in changed:
        replacement = {v['id']: v for v in candidate[key] if v['id'] in changed[key]}
        construction[key] = [copy.deepcopy(replacement.get(v['id'], v)) for v in construction[key]]
    for c in construction['collectors']:
        if c['id'] in changed['collectors']:
            c['path'] = raw[c['id']]['path']
            c['length'] = sum(math.dist(a, b) for a, b in zip(c['path'], c['path'][1:]))
    construction['summary']['collectorMetres'] = round(sum(c['length'] for c in construction['collectors']), 1)
    path_proof = load(STAGE / 'drainage-path-proof.json')
    for row in path_proof['paths']:
        if row['id'] not in changed['collectors']:
            continue
        c = done[row['id']]
        row.update(path=c['path'], length=c['length'], invertStart=c['invertStart'], invertEnd=c['invertEnd'], minRadius=curves[row['id']]['minRadius'])
    path_proof['foundationRepair'] = dict(networkSha256=sha(args.candidate), nativeProof=str(args.native_proof), changed=sorted(changed['collectors']))
    report = dict(beforeSha256=sha(STAGE / 'native-drainage.json'), afterSha256=sha(args.candidate),
                  changed={k: sorted(v) for k, v in changed.items()}, nativeProof=str(args.native_proof))
    print(json.dumps(report, indent=2))
    if not args.apply:
        return
    for name, data in (('native-drainage.json', candidate), ('drainage-construction.json', construction), ('drainage-path-proof.json', path_proof)):
        path = STAGE / name
        backup = path.with_name(path.stem + '-before-foundation-repair.json')
        if not backup.exists():
            backup.write_bytes(path.read_bytes())
        temp = path.with_suffix('.repair.tmp')
        if name == 'native-drainage.json':
            temp.write_bytes(args.candidate.read_bytes())
        else:
            temp.write_text(json.dumps(data, indent=2) + '\n')
        temp.replace(path)
    (STAGE / 'drain-foundation-repair.json').write_text(json.dumps(report, indent=2) + '\n')


if __name__ == '__main__':
    main()
