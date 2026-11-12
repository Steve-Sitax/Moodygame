"""Align compiled through-seam bearings without moving endpoints or retained pieces."""
import json,math
from pathlib import Path
from construction import ROOT,load
S=ROOT/'.scratch/ruien-complete'
inventory=load(S/'layouts/routes.json')
jobs={rid:load(S/'layouts/routes'/f'{rid}.json')for rid in inventory['jobs']}
pairs=[('L7','L73'),('L19','L96'),('L48','L92'),('L50','L115'),('L62','L115'),('L63','L67'),('L77','L111'),('L103','L104')]
def sub(a,b):return [a[i]-b[i]for i in(0,1)]
def length(a):return math.hypot(*a)
def unit(a):return [v/length(a)for v in a]
changed=[]
for a,b in pairs:
    A,B=jobs[a]['pts'],jobs[b]['pts']
    matches=[(i,k)for i in(0,-1)for k in(0,-1)if length(sub(A[i],B[k]))<.01]
    if len(matches)!=1:raise ValueError((a,b,matches))
    i,k=matches[0];O=A[i];ta=unit(sub(A[1 if i==0 else -2],O));tb=unit(sub(B[1 if k==0 else -2],O))
    if b=='L115':t=[-v for v in tb]
    else:t=unit(sub(ta,tb))
    for rid,P,end,d in [(a,A,i,t),(b,B,k,[-v for v in t])]:
        if rid=='L115':continue
        j=1 if end==0 else -2;dist=length(sub(P[j],O));lead=max(6.,min(dist,10.))
        q=[O[n]+lead*d[n]for n in(0,1)]
        if dist>lead+2:P.insert(1 if end==0 else len(P)-1,q)
        else:P[j]=q
        changed.append(rid)
dependents='L1 L7 L16 L17 L19 L25 L41 L42 L43 L48 L50 L59 L60 L62 L63 L66 L67 L68 L72 L73 L77 L79 L92 L96 L97 L103 L104 L111 L113 L114 L115'.split()
plan=load(S/'layouts/plan.json')
plan['routes']={rid:dict(plan['routes'].get(rid,{}),pts=j['pts'],**{'class':j['cls']})for rid,j in jobs.items()}
override=S/'layouts/compiled-network-plan.json'
override.write_text(json.dumps(plan,indent=2)+'\n')
for rid,j in jobs.items():
    if rid in dependents:j['planOverride']=override.as_posix()
    (S/'layouts/routes'/f'{rid}.json').write_text(json.dumps(j,indent=2)+'\n')
inventory['jobs']=jobs
(S/'layouts/routes.json').write_text(json.dumps(inventory,indent=2)+'\n')
print('ALIGNED_NETWORK_SEAMS',len(pairs),'pairs;',len(set(changed)),'paths;',len(dependents),'junction dependencies')
