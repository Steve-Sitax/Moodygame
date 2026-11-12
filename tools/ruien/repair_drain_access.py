"""Move two staged sump heads out of completed entrance passages, preserving IDs."""
import argparse
import copy
import json
import math
from construction import load
from native_layout import STAGE, make
from plan_drains import add, frame, unit
from buried_clearance import main_grid

# Native assembled collision found these heads in the Werf and Stadspark passages.
# Keep the surveyed inlets and the existing collector graph; move their short sumps.
STATIONS = {'H0519': 11.215193596882425, 'H0571': 36.24187737333677}


def repair(data, clearance):
    before = copy.deepcopy(data)
    hosts = data.get('nativeHosts', data.get('hosts'))
    changed = set()
    for head in data['heads']:
        if head['id'] not in STATIONS:
            continue
        host = hosts[head['host']]
        u = STATIONS[head['id']]
        if head['curved'] or not 4 < u < host['length'] - 4:
            raise ValueError('This repair requires the original straight bearing bay')
        at, tangent = frame(host['path'], u)
        normal = [tangent[1] * head['side'], -tangent[0] * head['side']]
        angle = math.radians(70)
        along = 1.05 * (1 - math.cos(angle)) + .9 * math.sin(angle)
        depth = .9 + 1.05 * math.sin(angle) + .9 * math.cos(angle)
        q, t = frame(host['path'], u + head['side'] * head['bend'] * along)
        n = [t[1] * head['side'], -t[0] * head['side']]
        seam = add(q, n, (3 if head['cls'] == 'G' else 1.8) + depth)
        direction = unit([t[i] * head['side'] * head['bend'] * math.sin(angle) + n[i] * math.cos(angle) for i in (0, 1)])
        end = add(seam, direction, 1.5)
        if not clearance.clear(seam, end):
            raise ValueError(head['id'] + ': relocated sump intersects an occupied envelope')
        head.update(u=u, at=at, tangent=tangent, normal=normal, seam=seam, seamTangent=direction)
        collectors = [c for c in data['collectors'] if c['destination'].get('id') == head['id']]
        if len(collectors) != 1 or collectors[0]['sourceIndex'] is not None:
            raise ValueError('Expected one closed gully sump for ' + head['id'])
        collector = collectors[0]
        if any(c['destination'].get('id') == collector['id'] for c in data['collectors']):
            raise ValueError('Do not move a sump with downstream tracing connections')
        collector.update(path=[end, seam], length=1.5, invertStart=head['invert'] + .012, invertEnd=head['invert'])
        collector['destination']['at'] = seam
        changed.add(collector['id'])
        for inlet in data['inlets']:
            if inlet['collector'] != collector['id']:
                continue
            p = [inlet['fromPoint'][0], inlet['fromPoint'][2]]
            inlet.update(u=0, toPoint=[end[0], collector['invertStart'] + 1.57, end[1]], horizontalDistance=math.dist(p, end))
            if inlet['fromPoint'][1] < -.8:
                route = clearance.route([p, end], 'inlet_' + inlet['id'])
                inlet['horizontalPath'] = [p] + route[1:-1] + [end]
    for key in ('heads', 'collectors', 'inlets'):
        assert [v['id'] for v in data[key]] == [v['id'] for v in before[key]]
        for old, new in zip(before[key], data[key]):
            affected = old['id'] in STATIONS if key == 'heads' else old['id'] in changed if key == 'collectors' else old['collector'] in changed
            if not affected:
                assert old == new
            if key == 'inlets':
                assert old['fromPoint'] == new['fromPoint']
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    passages = load(STAGE / 'entrance-connections.json')['connections']
    clearance = main_grid(make()['areas'], load(STAGE / 'native-town-survey.json')['cellars'], [c['path'] for c in passages])
    for name in ('drainage-construction', 'native-drainage'):
        source = STAGE / (name + '.json')
        target = source if args.apply else STAGE / (name + '-access-candidate.json')
        data = repair(load(source), clearance)
        if args.apply:
            backup = STAGE / (name + '-before-access-repair.json')
            if not backup.exists():
                backup.write_bytes(source.read_bytes())
        target.write_text(json.dumps(data, indent=2) + '\n')
        print(target)


if __name__ == '__main__':
    main()
