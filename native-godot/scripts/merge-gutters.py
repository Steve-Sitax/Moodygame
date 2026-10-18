"""Issue #163: join the per-chunk outputs of repair-gutters.py into one candidate: manifest.json (meshes), ruien.json
(the new inlets) and summary.json (every house and what it got). Usage: python scripts/merge-gutters.py <candidate folder>"""
import json, pathlib, sys
from collections import Counter
folder = pathlib.Path(sys.argv[1])
manifest, inlets, houses = {}, [], []
totals = Counter()
for f in sorted(folder.glob('manifest-*.json')):
    part = json.loads(f.read_text())
    for k in part:
        if k in manifest: raise SystemExit(f'{k} is in two chunks')
    manifest.update(part)
    chunk = f.stem[len('manifest-'):]
    inlets += json.loads((folder / f'ruien-{chunk}.json').read_text())
    r = json.loads((folder / f'report-{chunk}.json').read_text())
    houses += r['houses']
    for k in ('ironTriangles', 'decalTriangles', 'standInTriangles', 'oldBoxTriangles', 'oldStandInTriangles', 'inlets'):
        totals[k] += r.get(k, 0)
ids = Counter(i['id'] for i in inlets)
if any(n > 1 for n in ids.values()): raise SystemExit('inlet ids repeat: ' + ', '.join(k for k, n in ids.items() if n > 1))
(folder / 'manifest.json').write_text(json.dumps(manifest, indent=1))
(folder / 'ruien.json').write_text(json.dumps(inlets, indent=1))
done = [h for h in houses if h.get('gutters') or h.get('heads')]
summary = {'meshes': len(manifest), 'houses': len(houses), 'housesWithDrainage': len(done),
           'gutters': sum(len(h.get('gutters', [])) for h in houses), 'pipes': sum(len(h.get('pipes', [])) for h in houses) + sum(1 for h in houses for x in h.get('heads', []) if x and x.get('head')),
           'heads': sum(1 for h in houses for x in h.get('heads', []) if x and x.get('head')), 'brokenGaps': sum(len(g['gaps']) for h in houses for g in h.get('gutters', [])),
           'bareSpouts': sum(1 for h in houses for x in h.get('heads', []) if x and x.get('broken')), **totals}
(folder / 'summary.json').write_text(json.dumps({'summary': summary, 'houses': houses}, indent=1))
print(json.dumps(summary, indent=1))
