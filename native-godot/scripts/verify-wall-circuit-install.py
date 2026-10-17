"""Read-only installed-resource, placement and rendered-image verification."""
import hashlib,json,pathlib,sys
import numpy as np
from PIL import Image

p=pathlib.Path(sys.argv[1]); root=p.parents[1]; failures=[]
promotion=json.loads((p/'promotion.json').read_text())
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
for name,expected in promotion['installedHashes'].items():
 if sha(root/name.removeprefix('res://'))!=expected:failures.append('Resource changed: '+name)
for name,expected in json.loads((p/'scene-hashes-before.json').read_text()).items():
 if sha(pathlib.Path(name))!=expected:failures.append('Placement scene changed: '+name)
views=json.loads((p/'coverage.json').read_text())['views']; records=[]
for view in views:
 for weather in (['day','rain','night'] if view['weather'] else ['day']):
  name=view['name']+'-'+weather+'.png'
  if not all((p/mode/name).exists() for mode in ['candidate','installed']):
   failures.append('Missing capture: '+name);continue
  # Caption differs by mode; all scene pixels below its 60-pixel band are compared.
  a=np.asarray(Image.open(p/'candidate'/name).convert('RGB'))[60:].astype(np.int16)
  b=np.asarray(Image.open(p/'installed'/name).convert('RGB'))[60:].astype(np.int16)
  delta=np.abs(a-b);maximum=int(delta.max());mean=float(delta.mean())
  records.append(dict(image=name,maxChannelDifference=maximum,meanChannelDifference=mean))
  if maximum:failures.append('Render differs: '+name)
report=dict(passed=not failures,resources=len(promotion['installedHashes']),placementScenes=2,images=len(records),excludedCaptionRows=60,failures=failures,comparisons=records)
(p/'installed-verification.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:v for k,v in report.items() if k!='comparisons'},indent=2));sys.exit(bool(failures))
