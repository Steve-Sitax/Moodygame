"""Merge reviewed surface inlet reservations once, after wall-resource promotion."""
import hashlib,json,pathlib
p=pathlib.Path('native-godot/proof/wall-circuit')
archive=pathlib.Path('art-source/environment-20261013/wall-circuit')
target=pathlib.Path('native-godot/world/town/drainage/ruien-inlets.json')
promotion=json.loads((p/'promotion.json').read_text())
for name,digest in promotion['installedHashes'].items():
 assert hashlib.sha256((pathlib.Path('native-godot')/name.removeprefix('res://')).read_bytes()).hexdigest()==digest,name
original=json.loads((archive/'original-ruien-inlets.json').read_text())
assert json.loads(target.read_text())==original,'Ruien registry changed; do not overwrite or lower inlets twice'
for row in original:
 row['world'][1]-=.035
 row['undergroundConnection'][1]-=.035
merged=original+json.loads((p/'ruien-connections.json').read_text())
assert len(merged)==36 and len({r['id'] for r in merged})==36
target.write_text(json.dumps(merged,indent=2)+'\n')
print('Registered 36 surface inlets. Ruien routes and vertical drops remain reserved, not built.')
