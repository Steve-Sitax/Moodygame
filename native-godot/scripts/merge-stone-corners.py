"""Issue #157: join the per-chunk manifests of repair-stone-corners.py into one candidate manifest.json.
Usage: python scripts/merge-stone-corners.py <candidate folder>"""
import json, pathlib, sys
from collections import Counter
folder = pathlib.Path(sys.argv[1])
manifest = {'materials': {'candidate:dressed_stone': {
    'base': 'res://world/town/resources/r000209.res',
    'shader': 'res://assets/materials/stone-corners-20261017/dressed-stone.gdshader',
    'params': {'stone_tex': 'res://assets/materials/environment-20261013/stair-stone-texture.res'}}}}
built, kept, added, removed = Counter(), Counter(), 0, 0
for f in sorted(folder.glob('manifest-*.json')):
    part = json.loads(f.read_text())
    for k in part:
        if k in manifest: raise SystemExit(f'{k} is in two chunks')
    manifest.update(part)
    r = json.loads((folder / f.name.replace('manifest-', 'report-')).read_text())['summary']
    built.update(r['built']); kept.update(r['kept']); added += sum(r['added'].values()); removed += sum(r['removed'].values())
(folder / 'manifest.json').write_text(json.dumps(manifest, indent=1))
summary = {'meshes': len(manifest) - 1, 'built': dict(built), 'kept': dict(kept), 'addedTriangles': added, 'removedTriangles': removed}
(folder / 'summary.json').write_text(json.dumps(summary, indent=1))
print(json.dumps(summary, indent=1))
