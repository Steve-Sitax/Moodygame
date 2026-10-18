"""The Ruien plan for the native game: docs/plans/ruien/ruien-routes.json and ruien-network.json, the parts the game
reads, written to native-godot/world/ruien/network.json (the game never reads docs/). Run from the repo root:

    python -I tools/ruien/godot_network.py

The areas the game draws (native-godot/world/ruien/areas.json) name lines, rooms, gates, grates and stairs of this file.
"""
import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLAN = os.path.join(ROOT, 'docs', 'plans', 'ruien')
OUT = os.path.join(ROOT, 'native-godot', 'world', 'ruien', 'network.json')


def main():
    routes = json.load(open(os.path.join(PLAN, 'ruien-routes.json'), encoding='utf-8'))
    net = json.load(open(os.path.join(PLAN, 'ruien-network.json'), encoding='utf-8'))
    classes = {}
    for k, c in net['classes'].items():
        keep = {key: c[key] for key in ('name', 'innerWidth', 'bedToCrown', 'channelWidth', 'ledgeWidth', 'ledgeAboveBed', 'wall', 'bed') if key in c}
        if 'bed' in keep and 'bedToCrown' in keep:
            keep['crown'] = round(keep['bed'] + keep['bedToCrown'], 3)
        classes[k] = keep
    out = {
        'about': 'Made by tools/ruien/godot_network.py from docs/plans/ruien (ruien-routes.json, ruien-network.json). Do not edit.',
        'levels': net['levels'],
        'classes': classes,
        'lines': [dict(id=k, cls=r['class'], name=r.get('name', ''), pts=r['pts']) for k, r in routes['routes'].items()],
        'rooms': [dict(id=r['id'], cls=r['class'], name=r.get('name', ''), rect=r['rect']) for r in routes['rooms']],
        'gates': [dict(id=g['id'], name=g.get('name', ''), at=g['at'], into=g.get('into', ''), cls=g.get('class', ''), door=g.get('door', False)) for g in routes['gates']],
        'grates': routes['grates'],
        'stairs': [dict(id=s['id'], name=s.get('name', ''), at=s['at']) for s in routes['stairs']],
        'lamps': routes['lamps'],
        'access': [dict(id=a['id'], kind=a['kind'], name=a.get('name', ''), at=a['at']) for a in routes['access']],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(out, f, indent=1)
        f.write('\n')
    print('wrote', OUT, len(out['lines']), 'lines', len(out['rooms']), 'rooms', len(out['gates']), 'gates', len(out['grates']), 'grates')


if __name__ == '__main__':
    sys.exit(main())
