"""Check and sample the complete lining width of the existing stairs' new passages."""
import argparse,json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from kit.sweep import RoutePath
stage=ROOT.parents[1]/'.scratch/ruien-complete'
parser=argparse.ArgumentParser();parser.add_argument('--input',type=Path,default=stage/'connected-entrances.json');parser.add_argument('--out',type=Path,default=stage/'entrance-path-proof.json')
args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]if'--'in sys.argv else[])
file=args.input;data=json.loads(file.read_text());checks=[];failures=[]
for entry in data['entrances']:
    points=entry.get('connectPath')
    if not points:continue
    p=np.array(points);route=RoutePath(p[:,[0,2]],r=1.05)
    if route.min_radius<.93:
        failures.append(dict(id=entry['id'],radius=float(route.min_radius)));continue
    u=np.linspace(0,route.length,max(2,int(np.ceil(route.length/.16))+1))
    q=np.stack([np.interp(u,route.u,route.P[:,0]),np.interp(u,[0,route.length],[p[0,1],p[-1,1]]),np.interp(u,route.u,route.P[:,1])],-1)
    entry['connectPath']=q.tolist();entry['connectionRadius']=1.05
    checks.append(dict(id=entry['id'],length=float(route.length),minRadius=float(route.min_radius),samples=len(q)))
args.out.write_text(json.dumps(dict(checks=checks,failures=failures),indent=2)+'\n')
if failures:raise ValueError(failures)
file.write_text(json.dumps(data,indent=2)+'\n')
print('ENTRANCE_PATH_PROOF',len(checks),'curved/graded connections',len(failures),'folds')
