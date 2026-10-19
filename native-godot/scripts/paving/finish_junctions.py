"""Regenerate #199 side-street joints from the H5 ORIGINAL ground dump and saved street layout.
python finish_junctions.py <original dump> <layout folder> <repo> <candidate>
Does not read installed geometry; installed hashes are only optimistic-concurrency guards.
"""
import os,sys,pathlib,json,pickle,hashlib
import numpy as np
os.environ.setdefault('PAVE_WORK','.')
import layout,mesher
from junction_phase import apply

dump,work,repo,out=map(pathlib.Path,sys.argv[1:5]);out.mkdir(parents=True,exist_ok=True)
source=json.load(open(dump/'ground.json'));entries=[];reports={}
for kind,rows in [('cobble',13),('quay',12)]:
    name='ground_'+kind;rec=source[name]
    lay=pickle.load(open(work/f'lay-{kind}.pkl','rb'))
    original=np.fromfile(dump/rec['surfaces'][0]['file'],dtype=np.float32).reshape(-1,16)
    T,labels,uv,y,G=mesher.build(lay,original)
    uv,report=apply(lay,T,labels,uv,rows);reports[kind]=report
    file=name+'.f32';mesher.rows_of(T,uv,y).tofile(out/file)
    path=rec['mesh'];current=repo/'native-godot'/path.removeprefix('res://')
    entries.append({'mesh':path,'nodePath':rec['node'],'sourceHash':hashlib.sha256(current.read_bytes()).hexdigest(),
                    'surfaces':[{'index':0,'file':file,'material':rec['surfaces'][0]['material'],'custom0':False}]})
(out/'manifest.json').write_text(json.dumps({'surfaceRepairs':entries},indent=2))
(out/'junction-report.json').write_text(json.dumps(reports,indent=2))
print({k:sum(r['boundarySegments'] for r in v) for k,v in reports.items()})
