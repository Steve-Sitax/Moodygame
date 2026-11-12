"""Check the connected egg collectors at their actual width and record smooth native paths."""
import json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from kit.sweep import RoutePath
stage=ROOT.parents[1]/'.scratch/ruien-complete';file=stage/'drainage-construction.json'
sys.path.insert(0,str(ROOT.parents[1]/'tools/ruien'))
from buried_clearance import main_grid
from native_layout import make
survey=json.loads((stage/'native-town-survey.json').read_text())
connections=json.loads((stage/'entrance-connections.json').read_text())['connections']
clearance=main_grid(make()['areas'],survey['cellars'],[c['path']for c in connections])
data=json.loads(file.read_text());failures=[];rows=[]
resolved={};repairs=[]
for d in data['collectors']:
    try:
        points=d['path'];dest=d['destination'];end_y=d['invertEnd']
        if dest['kind']=='collector':
            parent=resolved[dest['id']];u,_=parent['route'].u_near(*points[-1]);q=parent['route'].world(np.array(u),np.array(0.),np.array(0.))
            points=points[:-1]+[[float(q[0]),float(q[2])]]
            end_y=parent['y0']+(parent['y1']-parent['y0'])*u/parent['route'].length
        # A relocated head can make the last old tracing vertex double back. The
        # swept collector takes the direct leg; the surveyed gully keeps its own drop.
        try:p=RoutePath(points,r=1.2)
        except ValueError:p=None
        if p is None or p.min_radius<.55:
            options=[];limit=len(points)-2 if dest['kind']=='head' else len(points)-1
            for i in range(1,limit):
                candidate=points[:i]+points[i+1:]
                if not clearance.clear(points[i-1],points[i+1]):continue
                try:q=RoutePath(candidate,r=1.2)
                except ValueError:continue
                if q.min_radius>=.55:options.append((q.length,candidate,q,i))
            if not options:
                for count in range(2,6):
                    for i in range(1,limit-count+1):
                        candidate=points[:i]+points[i+count:]
                        if not clearance.clear(points[i-1],points[i+count]):continue
                        try:q=RoutePath(candidate,r=1.2)
                        except ValueError:continue
                        if q.min_radius>=.55:options.append((q.length,candidate,q,dict(start=i,count=count)))
                    if options:break
            if not options and sum(np.linalg.norm(np.array(b)-a)for a,b in zip(points,points[1:]))<12:
                for count in range(1,len(points)-1):
                    candidate=points[count:]
                    if not all(clearance.clear(a,b)for a,b in zip(candidate,candidate[1:])):continue
                    try:q=RoutePath(candidate,r=1.2)
                    except ValueError:continue
                    if q.min_radius>=.55:options.append((q.length,candidate,q,-count))
            if options:
                _,points,p,i=min(options,key=lambda x:x[0]);repairs.append(dict(id=d['id'],removedTracingVertex=i))
        if p is None:raise ValueError('No collector of its full width fits this detour')
        if p.min_radius<.55:failures.append(dict(id=d['id'],radius=round(p.min_radius,3),path=points))
        start_y=min(-2.7,end_y+.008*p.length)
        resolved[d['id']]=dict(route=p,y0=start_y,y1=end_y)
        points=np.concatenate([p.P[:-1:20],p.P[-1:]])
        rows.append(dict(id=d['id'],length=round(p.length,4),minRadius=round(p.min_radius,4),path=np.round(points,6).tolist(),
                         invertStart=start_y,invertEnd=end_y))
    except ValueError as e:failures.append(dict(id=d['id'],reason=str(e)))
report=dict(paths=rows,repairs=repairs,failures=failures)
(stage/'drainage-path-proof.json').write_text(json.dumps(report,indent=2)+'\n')
print('DRAIN_PATH_PROOF',len(rows),'collectors',len(failures),'failures')
for f in failures[:20]:print(f)
