"""Compile the authored Ruien plan into a complete, auditable construction inventory.

This never activates an incomplete network. Generated assets are staged outside world/ruien;
installation requires every planned component and its geometry/route acceptance evidence.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from collections import Counter, defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLAN = ROOT / 'docs/plans/ruien/ruien-routes.json'
ENTRANCES = ROOT / 'native-godot/world/ruien/entrances.json'
AREAS = ROOT / 'native-godot/world/ruien/areas.json'


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def distance(a, b):
    return math.dist(a, b)


def nearest_on_path(point, path):
    best = None
    along = 0.0
    for i, (a, b) in enumerate(zip(path, path[1:])):
        dx, dz = b[0]-a[0], b[1]-a[1]
        length = math.hypot(dx, dz)
        if length < 1e-8:
            continue
        t = max(0., min(1., ((point[0]-a[0])*dx+(point[1]-a[1])*dz)/(length*length)))
        q = [a[0]+t*dx, a[1]+t*dz]
        candidate = (distance(point, q), along+t*length, q, i)
        if best is None or candidate[0] < best[0]:
            best = candidate
        along += length
    if best is None:
        raise ValueError('Path has no nonzero segment')
    return best


def contains(rect, point, margin=0.):
    return rect[0]-margin <= point[0] <= rect[2]+margin and rect[1]-margin <= point[1] <= rect[3]+margin


def compile_plan():
    authored = load(PLAN)
    areas = load(AREAS)['areas']
    entrances = load(ENTRANCES)['entrances']
    routes = authored['routes']
    rooms = authored['rooms']
    gates = authored['gates']
    nodes = []

    # Merge only endpoints within the same 0.30 m construction tolerance used by the kit.
    # Never use rounded grid keys: points on opposite sides of a grid cell can still meet.
    for rid, route in routes.items():
        for endpoint in (0, -1):
            point = route['pts'][endpoint]
            candidates = [n for n in nodes if distance(n['at'], point) <= .30]
            if len(candidates) > 1:
                raise ValueError(f'Ambiguous endpoint cluster: {rid} {point}')
            if candidates:
                node = candidates[0]
            else:
                node = dict(id=f'J{len(nodes)+1:03}', at=point, ends=[])
                nodes.append(node)
            other = route['pts'][1 if endpoint == 0 else -2]
            dx, dz = other[0]-point[0], other[1]-point[1]
            length = math.hypot(dx, dz)
            if length < .01:
                raise ValueError(f'Zero-length terminal segment: {rid}')
            node['ends'].append(dict(route=rid, cls=route['class'], end='start' if endpoint==0 else 'end', toward=[dx/length,dz/length]))

    for node in nodes:
        point = node['at']
        named = [room['id'] for room in rooms if contains(room['rect'], point, .6)]
        gate = [g['id'] for g in gates if distance(point, g['at']) < 1.0]
        ends = node['ends']
        classes = ''.join(sorted(e['cls'] for e in ends))
        if named:
            kind = 'named-room'
        elif gate:
            kind = 'gate'
        elif len(ends) == 1:
            # A line may end in the middle of another line rather than at its endpoint.
            host = []
            for rid, route in routes.items():
                if rid == ends[0]['route']:
                    continue
                d, u, q, segment = nearest_on_path(point, route['pts'])
                if d <= .30:
                    host.append(dict(route=rid, cls=route['class'], along=u, at=q))
            node['hosts'] = host
            kind = 'interior-join' if host else 'terminal'
        elif len(ends) == 2:
            a, b = [e['toward'] for e in ends]
            dot = sum(x*y for x,y in zip(a,b))
            kind = 'through' if classes in ('GG','MM') and dot < -.94 else 'transition' if classes=='GM' and dot < -.94 else 'bend-junction'
        else:
            # The existing Tee is specifically an M branch at a straight G host.
            giant = [e for e in ends if e['cls']=='G']
            dot = sum(a*b for a,b in zip(giant[0]['toward'],giant[1]['toward'])) if len(giant)==2 else 1.
            kind = 'tee' if classes=='GGM' and dot < -.94 else 'branch-junction'
        node.update(kind=kind, classes=classes, rooms=named, gates=gate)
        node['surfaceAccess'] = 'none; underground construction only'

    # Explicit incidences make graph coverage testable, including side-entry line endpoints.
    graph = {rid:set() for rid in routes}
    for node in nodes:
        ids = [e['route'] for e in node['ends']] + [h['route'] for h in node.get('hosts',[])]
        for rid in ids:
            graph[rid].update(set(ids)-{rid})
    for room in rooms:
        ids = {e['route'] for n in nodes if room['id'] in n['rooms'] for e in n['ends']}
        for rid in ids:
            graph[rid].update(ids-{rid})
    components = []
    pending = set(routes)
    while pending:
        queue=[min(pending)]; found=set()
        while queue:
            rid=queue.pop()
            if rid in found:
                continue
            found.add(rid); queue.extend(graph[rid]-found)
        pending -= found
        components.append(sorted(found))

    inventory=[]
    for rid, route in routes.items():
        inventory.append(dict(id=rid, kind='route', cls=route['class'], length=route['lengthM'],
                              path=route['pts'], neighbours=sorted(graph[rid]), lods=[0,1], status='planned'))
    for room in rooms:
        inventory.append(dict(id=room['id'], kind='hall' if room['class']=='G' else 'junction-room', cls=room['class'], rect=room['rect'], status='installed' if room['id'] in ('R1','C2') else 'planned'))
    for node in nodes:
        if node['kind'] in ('branch-junction','bend-junction','interior-join','transition'):
            inventory.append(dict(id=node['id'], kind=node['kind'], at=node['at'], ends=node['ends'], status='planned'))
    inventory.extend(dict(id=g['id'],kind='gate',at=g['at'],cls=g['class'],policy='closed boat door; no outlet' if g['id']=='P1' else 'flush inlet' if g['id']=='F1' else 'tidal outlet',status='installed' if g['id']=='O2' else 'planned') for g in gates)
    for i, drain in enumerate(authored['sideDrains']):
        inventory.append(dict(id=f'D{i+1:04}',kind='side-drain',path=drain,status='planned'))
    inventory.extend(dict(id=e['id'],kind='entrance-link',line=e.get('line'),door=e['door'],status='installed' if e.get('closure')=='open' else 'planned',surface='retain surveyed entrance and permanent ID') for e in entrances if e.get('enabled',True))
    source_hash=hashlib.sha256(b'\0'.join(p.read_bytes() for p in (PLAN,ENTRANCES,AREAS))).hexdigest()
    return dict(version=1,sourceHash=source_hash,policy=authored['surfaceAccessPolicy'],
                installedAreas=[a['id'] for a in areas],preserve=['O2 authored geometry','R1 room and sample placements','all entrance IDs','cellars and foundations','unsaved editor work'],
                summary=dict(routes=len(routes),routeMetres=sum(r['lengthM'] for r in routes.values()),rooms=len(rooms),gates=len(gates),sideDrains=len(authored['sideDrains']),nodes=dict(Counter(n['kind'] for n in nodes)),components=len(components)),
                components=components,nodes=nodes,inventory=inventory,
                acceptance=['both LODs and content hashes','closed masonry and matched mouth seams','human and upright giant routes','safe surface/underground entrance continuity','gully-to-drain connections','native day/rain/night visual review','startup proof and uncached equivalence','desktop icon smoke test'])


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out',type=Path,default=ROOT/'.scratch/ruien-complete/construction.json')
    args=parser.parse_args()
    result=compile_plan()
    args.out.parent.mkdir(parents=True,exist_ok=True)
    args.out.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(result['summary'],indent=2))
    print(args.out)


if __name__=='__main__':
    main()
