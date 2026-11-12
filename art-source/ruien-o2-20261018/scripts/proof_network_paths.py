"""Measure every staged sweep and reject folded vaults before expensive relief exports."""
import json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
from kit.sweep import RoutePath,Section
stage=ROOT.parents[1]/'.scratch/ruien-complete'
sys.path.insert(0,str(ROOT.parents[1]/'tools/ruien'))
from plan_routes import compile_path
jobs=json.loads((stage/'layouts/routes.json').read_text())['jobs']
def simplify(points,tol):
    P=np.asarray(points,float)
    if len(P)<3:return P.tolist()
    ab=P[-1]-P[0];den=np.dot(ab,ab)
    t=np.clip((P-P[0])@ab/max(den,1e-10),0,1)
    d=np.linalg.norm(P-(P[0]+t[:,None]*ab),axis=1);i=int(np.argmax(d))
    if d[i]<=tol:return [points[0],points[-1]]
    return simplify(points[:i+1],tol)[:-1]+simplify(points[i:],tol)

def measure(points,sec):return RoutePath(points,r=sec.W*1.2)

results=[];repairs=[]
for rid,job in jobs.items():
    sec=Section(job['cls'],job['walkwaySide']);p=measure(job['pts'],sec)
    bad=p.min_radius<sec.hw+.25
    if bad and not job['retained']:
        c=job['construction'];best=None
        for tol in (.0,.5,1.5,3.0):
            original=simplify(c['originalPoints'],tol)
            for margin in (5,8,12,16):
                for lead in (2.5,4,5,6,8,10,12):
                    try:
                        candidate=compile_path(original,c['startBinding'],c['endBinding'],lead,margin)
                        if len(candidate)<2:continue
                        q=measure(candidate,sec)
                        if q.min_radius<sec.hw+.25:continue
                        # Shortest valid sweep keeps the route close to its traced corridor.
                        score=q.length+tol*.02
                        if best is None or score<best[0]:best=(score,candidate,q,lead,margin,tol)
                    except (ValueError,IndexError):pass
        if best:
            _,points,p,lead,margin,tol=best
            repairs.append(dict(route=rid,lead=lead,trimMargin=margin,simplify=tol))
            job['pts']=points
            (stage/'layouts/routes'/f'{rid}.json').write_text(json.dumps(job,indent=2)+'\n')
            bad=False
    sampled=np.concatenate([p.P[:-1:20],p.P[-1:]])
    results.append(dict(route=rid,length=round(p.length,3),minRadius=round(p.min_radius,3),halfWidth=sec.hw,fold=bool(bad),
                        path=np.round(sampled,6).tolist()))
report=dict(routes=results,repairs=repairs,failures=[r for r in results if r['fold']])
(stage/'path-proof.json').write_text(json.dumps(report,indent=2)+'\n')
inventory=json.loads((stage/'layouts/routes.json').read_text());inventory['jobs']=jobs;inventory['pathProof']=report
(stage/'layouts/routes.json').write_text(json.dumps(inventory,indent=2)+'\n')
print('NETWORK_PATH_PROOF',len(results),'routes',len(report['failures']),'folds')
for f in report['failures']:print(f)
