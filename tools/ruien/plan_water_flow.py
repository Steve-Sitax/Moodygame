"""Route visible currents along the built network to its gravity outlets.

This changes flow metadata only. Gates P1 (held basin) and F1 (flush supply)
are not drainage sinks. Water footprints, heights and permanent IDs stay fixed.
"""
import argparse
import copy
import heapq
import json
import math
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
STAGE = ROOT / '.scratch/ruien-complete'


def distance(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def plan(config):
    areas = config['areas']
    nodes, edges, area_nodes, guides, rooms = [], [], {}, {}, {}
    network = json.loads((ROOT / 'native-godot/world/ruien/network.json').read_text())
    named_rooms = {r['id']: r for r in network['rooms']}
    endpoint_lines = {}
    for line in network['lines']:
        for point in (line['pts'][0], line['pts'][-1]):
            endpoint_lines.setdefault(tuple(point), set()).add(line['id'])
    # Authored T-junctions include a side channel that cannot face both main ends.
    tees = [point for point, lines in endpoint_lines.items() if len(lines) >= 3]
    water_by_area = {}
    for area in areas:
        path = area['export']
        folder = ROOT / 'native-godot' / path[6:] if path.startswith('res://') else Path(path)
        markers = json.loads((folder / 'markers.json').read_text())
        water_by_area[area['id']] = area.get('water', markers.get('water', []))

    def node(area, point, label, outward=None):
        index = len(nodes)
        nodes.append(dict(area=area['id'], point=point, label=label,
                          level=area.get('waterMin', -4.6), outward=outward))
        edges.append([])
        area_nodes.setdefault(area['id'], []).append(index)
        return index

    def link(a, b, length=None):
        length = max(.001, distance(nodes[a]['point'], nodes[b]['point']) if length is None else length)
        # Water can descend into a deeper main; it cannot flow uphill out of it.
        if nodes[a]['level'] >= nodes[b]['level'] - .015:
            edges[a].append((b, length))
        if nodes[b]['level'] >= nodes[a]['level'] - .015:
            edges[b].append((a, length))

    for area in areas:
        zones = copy.deepcopy(area['zones'])
        for zone in zones:
            if 'room' in zone:
                zone['rect'] = named_rooms[zone['room']]['rect']
        # R1's retained short channels are described as rectangles rather than
        # path zones. Their water centre is offset by the single-sided ledge.
        for sheet in water_by_area[area['id']]:
            if sheet.get('line') and not any('path' in z and z['id'] == sheet['id'] for z in zones):
                rectangle = next((z.get('rect') for z in zones if z['id'] == sheet['id']), None)
                if rectangle:
                    path = sheet['line']
                    length = distance(path[0], path[-1])
                    across = [(path[-1][1] - path[0][1]) / length, -(path[-1][0] - path[0][0]) / length]
                    centre = [(rectangle[k] + rectangle[k + 2]) / 2 for k in (0, 1)]
                    shift = sum((centre[k] - path[0][k]) * across[k] for k in (0, 1))
                    zones.append(dict(id=sheet['id'], path=[[p[k] + across[k] * shift for k in (0, 1)] for p in path]))
        for zone in zones:
            if 'path' in zone:
                path = zone['path']
                if len(path) < 2:
                    continue
                def outward(a, b):
                    length = distance(a, b)
                    return [(a[k] - b[k]) / length for k in (0, 1)]
                start = node(area, path[0], zone['id'] + ':start', outward(path[0], path[1]))
                end = node(area, path[-1], zone['id'] + ':end', outward(path[-1], path[-2]))
                length = sum(distance(a, b) for a, b in zip(path, path[1:]))
                link(start, end, length)
                guides[(area['id'], zone['id'])] = (start, end, path, length)
            if 'rect' in zone:
                x0, z0, x1, z1 = zone['rect']
                wet = False
                for sheet in water_by_area[area['id']]:
                    points = sheet.get('outline') or sheet.get('line') or []
                    if points:
                        c = [sum(p[k] for p in points) / len(points) for k in (0, 1)]
                        wet |= x0 - .02 <= c[0] <= x1 + .02 and z0 - .02 <= c[1] <= z1 + .02
                if not wet:
                    continue
                centre = node(area, [(x0 + x1) / 2, (z0 + z1) / 2], zone['id'] + ':room')
                rooms.setdefault(area['id'], []).append((centre, zone['rect']))

    for area_id, entries in rooms.items():
        for centre, (x0, z0, x1, z1) in entries:
            for other in area_nodes[area_id]:
                p = nodes[other]['point']
                if other != centre and x0 - .02 <= p[0] <= x1 + .02 and z0 - .02 <= p[1] <= z1 + .02:
                    link(centre, other)
        # Retained side galleries share their hall's open water at a wall arch.
        for i, (a, ra) in enumerate(entries):
            for b, rb in entries[i + 1:]:
                overlap_x = min(ra[2], rb[2]) - max(ra[0], rb[0])
                overlap_z = min(ra[3], rb[3]) - max(ra[1], rb[1])
                if max(overlap_x, overlap_z) > 1 and min(overlap_x, overlap_z) >= -.65:
                    link(a, b)

    joins = []
    endpoints = [i for i, n in enumerate(nodes) if n['outward'] is not None]
    for n, a in enumerate(endpoints):
        for b in endpoints[n + 1:]:
            gap = distance(nodes[a]['point'], nodes[b]['point'])
            facing = sum(x * y for x, y in zip(nodes[a]['outward'], nodes[b]['outward']))
            tee = gap <= .02 and any(distance(nodes[a]['point'], p) <= .02 for p in tees)
            if gap <= .35 and (facing < -.5 or tee):
                link(a, b)
                joins.append(dict(a=nodes[a]['label'], b=nodes[b]['label'], gap=gap,
                                  kind='authored_tee' if tee and facing >= -.5 else 'facing_ends'))

    sinks = []
    for area in areas:
        for gate in area.get('gates', []):
            if gate['id'] in ('P1', 'F1'):
                continue
            closest = min(area_nodes[area['id']], key=lambda i: distance(nodes[i]['point'], gate['origin']))
            gap = distance(nodes[closest]['point'], gate['origin'])
            if gap > 3:
                raise ValueError(f"Outlet {gate['id']} is {gap:.3f} m from its channel")
            sink = node(area, gate['origin'], 'outlet:' + gate['id'])
            link(closest, sink)
            sinks.append(sink)

    reverse = [[] for _ in nodes]
    for a, links in enumerate(edges):
        for b, weight in links:
            reverse[b].append((a, weight))
    costs = [math.inf] * len(nodes)
    next_node = [None] * len(nodes)
    queue = []
    for sink in sinks:
        costs[sink] = 0
        heapq.heappush(queue, (0, sink))
    while queue:
        value, b = heapq.heappop(queue)
        if value != costs[b]:
            continue
        for a, length in reverse[b]:
            new = value + length
            if new < costs[a]:
                costs[a], next_node[a] = new, b
                heapq.heappush(queue, (new, a))

    unresolved = sorted({n['area'] for i, n in enumerate(nodes) if not math.isfinite(costs[i])})
    report = dict(nodes=len(nodes), links=sum(map(len, edges)), joins=joins,
                  outlets=[nodes[i]['label'] for i in sinks], unreachableAreas=unresolved,
                  directions=[], sheets=0)
    report['routeErrors'] = [nodes[i]['area'] + '/' + nodes[i]['label']
                             for i, target in enumerate(next_node) if target is not None
                             and (costs[target] >= costs[i] or nodes[target]['level'] > nodes[i]['level'] + .015)]
    result = copy.deepcopy(config)
    for area in result['areas']:
        water = copy.deepcopy(water_by_area[area['id']])
        for sheet in water:
            report['sheets'] += 1
            # Exported room portal sheets use the same ID with a _portal suffix.
            key = (area['id'], sheet.get('zone') or sheet['id'].removesuffix('_portal'))
            guide = guides.get(key)
            if guide is None and sheet.get('line'):
                guide = min((g for (owner, _), g in guides.items() if owner == area['id']),
                            key=lambda g: min(distance(sheet['line'][0], g[2][0]), distance(sheet['line'][0], g[2][-1])))
            speed = .04 if guide else .018
            if guide:
                start, end, points, length = guide
                if not math.isfinite(costs[start]) or not math.isfinite(costs[end]):
                    sheet['flow'] = [0, 0]
                    continue
                # The existing line is the channel centre, which may be offset from the zone centre.
                actual = sheet.get('line') or points
                if distance(actual[0], points[-1]) < distance(actual[0], points[0]):
                    start, end = end, start
                actual_length = sum(distance(a, b) for a, b in zip(actual, actual[1:]))
                ends = [costs[start], costs[end]]
                # Offset water centre lines and a hall overlap can have a different
                # length from the structural guide. Preserve a one-way drain;
                # otherwise that harmless difference creates a false divide.
                if ends[0] - ends[1] >= length - .01:
                    ends[0] = ends[1] + actual_length
                elif ends[1] - ends[0] >= length - .01:
                    ends[1] = ends[0] + actual_length
                sheet['flowGuide'] = actual
                sheet['flowEnds'] = ends
                sheet['flowSpeed'] = speed
                vector = [actual[-1][k] - actual[0][k] for k in (0, 1)]
                scale = speed / max(math.hypot(*vector), 1e-8) * (1 if costs[start] > costs[end] else -1)
                sheet['flow'] = [v * scale for v in vector]
                divide = (costs[end] + actual_length - costs[start]) / 2
                report['directions'].append(dict(area=area['id'], sheet=sheet['id'], start=costs[start], end=costs[end],
                                                  length=actual_length, divide=max(0, min(actual_length, divide))))
            else:
                outline = sheet['outline']
                sheet_centre = [sum(p[k] for p in outline) / len(outline) for k in (0, 1)]
                targets = []
                own_rooms = [(centre, rect) for centre, rect in rooms.get(area['id'], [])
                             if rect[0] <= sheet_centre[0] <= rect[2] and rect[1] <= sheet_centre[1] <= rect[3]]
                for centre, rect in own_rooms:
                    for other, _ in edges[centre]:
                        if math.isfinite(costs[other]) and next_node[other] != centre:
                            target = nodes[other]['point']
                            # A side gallery feeds through its shared wall arch, not
                            # diagonally through the wall toward the hall's centre.
                            adjacent = next((r for n, r in rooms[area['id']] if n == other), None)
                            if adjacent:
                                target = [(max(rect[k], adjacent[k]) + min(rect[k + 2], adjacent[k + 2])) / 2 for k in (0, 1)]
                            targets.append(target + [costs[other] + distance(target, nodes[other]['point'])])
                if not targets:
                    sheet['flow'] = [0, 0]
                    continue
                sheet['flowTargets'] = targets
                sheet['flowSpeed'] = speed
                target = min(targets, key=lambda p: distance(sheet_centre, p) + p[2])
                length = max(distance(sheet_centre, target), 1e-8)
                sheet['flow'] = [(target[k] - sheet_centre[k]) / length * speed for k in (0, 1)]
        area['water'] = water
    flow_keys = {'flow', 'flowGuide', 'flowEnds', 'flowSpeed', 'flowTargets'}
    for before, after in zip(config['areas'], result['areas']):
        strip = lambda sheet: {k: v for k, v in sheet.items() if k not in flow_keys}
        if [strip(s) for s in water_by_area[before['id']]] != [strip(s) for s in after['water']]:
            raise ValueError('Water footprint, height or ID changed: ' + before['id'])
        if {k: v for k, v in before.items() if k != 'water'} != {k: v for k, v in after.items() if k != 'water'}:
            raise ValueError('Non-water area data changed: ' + before['id'])
    report['geometryUnchanged'] = True
    report['stillSheets'] = [a['id'] + '/' + s['id'] for a in result['areas'] for s in a['water'] if s['flow'] == [0, 0]]
    report['graph'] = [dict(**n, distance=costs[i] if math.isfinite(costs[i]) else None,
                            next=nodes[next_node[i]]['label'] if next_node[i] is not None else None) for i, n in enumerate(nodes)]
    return result, report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    source = STAGE / 'native-conversion-areas.json'
    result, report = plan(json.loads(source.read_text()))
    (STAGE / 'water-flow-plan33.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps({k: v for k, v in report.items() if k not in ('graph', 'joins', 'directions')}, indent=2))
    if args.apply:
        if report['unreachableAreas'] or report['routeErrors']:
            raise ValueError('Resolve unreachable or uphill flow components before applying')
        source.write_text(json.dumps(result, indent=2) + '\n')


if __name__ == '__main__':
    main()
