"""Run the production route-join resolver without constructing or exporting meshes."""
import contextlib,io,json,sys
from pathlib import Path

root=Path(__file__).resolve().parents[3]
stage=root/'.scratch/ruien-complete'
builder=Path(__file__).with_name('build_stretch.py')
code=compile(builder.read_text().split('def near_route(')[0],str(builder),'exec')
jobs=json.loads((stage/'layouts/routes.json').read_text())['jobs']
checks=[];failures=[]
actual='--compiled-paths'in sys.argv
if actual:
    code=compile(builder.read_text().split('def near_route(')[0].replace("R_ALL = routes['routes']","R_ALL = {k:dict(routes['routes'].get(k,{}),**v)for k,v in __compiled_routes.items()}"),str(builder),'exec')
compiled={rid:dict(pts=json.loads((stage/'layouts/routes'/f'{rid}.json').read_text())['pts'],**{'class':j['cls']})for rid,j in jobs.items()}
for rid in jobs:
    sys.argv=[str(builder),'--','--route',rid,'--plan',jobs[rid].get('planOverride',str(stage/'layouts/plan.json')),
              '--job',str(stage/'layouts/routes'/f'{rid}.json'),'--out',str(stage/'end-proof'/rid),
              '--walkways','L65=-1,L100=-1,L114=-1']
    scope={'__file__':str(builder),'__name__':'__main__','__compiled_routes':compiled};log=io.StringIO()
    try:
        with contextlib.redirect_stdout(log):exec(code,scope)
        row=dict(route=rid,start=scope['START'],end=scope['END'],walkStartU=0.,walkEndU=scope['path_of'](rid).length,
                 tees=[dict(branch=t.branch_id,end=t.which,hosts=t.host_ids)for t in scope['TEES']],walkJoins=[],
                 geometrySignature=[{**{k:(v.tolist()if hasattr(v,'tolist')else v)for k,v in vars(t).items()if k not in ('bpath','hsec','bsec')},'hostSection':vars(t.hsec),'branchSection':vars(t.bsec)}for t in scope['TEES']])
        for t in scope['TEES']:
            if t.branch_id!=rid or type(t).__name__!='Tee':continue
            b=t.bsec;lat=b.sides[0]*(b.hw-b.ledge_w+.335);q0=float(t.q_wall(lat))+.65;q1=float(t.q_wall(lat))-.2
            if t.which=='start':row['walkStartU']=float(t.u_of_q(q1))
            else:row['walkEndU']=float(t.u_of_q(q1))
            row['walkJoins'].append(dict(name=rid+'_'+t.which,areas=[rid,*t.host_ids],
                **{'from':t.world(q0,lat,b.ledge_y).tolist(),'to':t.world(q1,lat,t.hsec.ledge_y).tolist()}))
        checks.append(row)
    except Exception as e:failures.append(dict(route=rid,error=str(e),log=log.getvalue()))
(stage/('end-proof-actual.json'if actual else'end-proof.json')).write_text(json.dumps(dict(checks=checks,failures=failures),indent=2)+'\n')
print('NETWORK_END_PROOF',len(checks),'routes',len(failures),'failures')
for f in failures:print(f)
if failures:raise RuntimeError('Unresolved route ends')
