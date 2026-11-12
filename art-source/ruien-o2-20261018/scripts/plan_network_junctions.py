"""Compile detailed junction mouth/walkway layouts before expensive mesh exports.

Runs in Blender for the kit's math dependencies, but creates no scene geometry and writes
only the requested staging folder. Ordinary junctions have no street hatch or stair.
"""
import copy
import json
import os
import sys
from pathlib import Path
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from kit import junction_gen as JG

args = sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
out = Path(args[args.index('--out')+1])
out.mkdir(parents=True,exist_ok=True)
source = json.loads((REPO/'docs/plans/ruien/ruien-routes.json').read_text())
construction = json.loads((REPO/'.scratch/ruien-complete/construction.json').read_text())
plan = copy.deepcopy(source)
rooms = [r for r in plan['rooms'] if r['class']=='M']
for node in construction['nodes']:
    if node['kind'] not in ('branch-junction','bend-junction') or set(node['classes'])!={'M'}:
        continue
    x,z = node['at']; half=3.4
    room=dict(id=node['id'],name='Buried confluence '+node['id'],**{'class':'M'},centre=[x,z],rect=[x-half,z-half,x+half,z+half])
    rooms.append(room); plan['rooms'].append(room)

# Very short links between ordinary confluences belong inside one bearing chamber.
# Named authored rooms retain their footprints and identities.
changed=True
while changed:
    changed=False
    for i,a in enumerate(rooms):
        if not a['id'].startswith('J'):continue
        for j,b in enumerate(rooms[i+1:],i+1):
            if not b['id'].startswith('J'):continue
            short=any(r['class']=='M' and r['lengthM']<=15 and
                      ((JG.inside(r['pts'][0],a['rect'],.6) and JG.inside(r['pts'][-1],b['rect'],.6)) or
                       (JG.inside(r['pts'][-1],a['rect'],.6) and JG.inside(r['pts'][0],b['rect'],.6))) for r in plan['routes'].values())
            if not short:continue
            r,s=a['rect'],b['rect'];rect=[min(r[0],s[0]),min(r[1],s[1]),max(r[2],s[2]),max(r[3],s[3])]
            aliases=sorted(a.get('nodeAliases',[a['id']])+b.get('nodeAliases',[b['id']]))
            rooms[i]=dict(id='_'.join(aliases),name='Joined buried confluence '+' / '.join(aliases),**{'class':'M'},rect=rect,
                          centre=[(rect[0]+rect[2])/2,(rect[1]+rect[3])/2],nodeAliases=aliases)
            del rooms[j];changed=True;break
        if changed:break
plan['rooms']=[r for r in plan['rooms'] if not r['id'].startswith('J')]+[r for r in rooms if r['id'].startswith('J')]

layouts={}; failures=[]; overlaps=[]
for room in rooms:
    rid=room['id']
    cfg=ROOT/'config'/f'{rid}.json'
    over=json.loads(cfg.read_text()) if cfg.exists() else {'stair':{'kind':'network','wall':'z0','end':'lo','t':.6},'crown_grate':False}
    if rid=='J064':over['L51']={'t':3.9}
    if rid!='R1':
        r=room['rect']
        # Keep every authored ventilation location that falls in this chamber. These are
        # closed grates, not access hatches; a buried junction must not silently swallow them.
        over['grates']=[g for g in source['grates'] if r[0]<=g[0]<=r[2] and r[1]<=g[1]<=r[3]]
    try:
        layout=JG.plan_room(room,plan['routes'],lambda *_:False,over)
        if not layout['mouths']:
            raise ValueError('No plan route reaches this room')
        if rid != 'R1':
            # One physical walkway side per authored route, at both of its ends. R1's three
            # existing pieces fix their original-plan side at -1; other new routes use +1.
            # The walk solver adds bridges rather than silently moving a far-end walkway.
            for mouth in layout['mouths']:
                route=plan['routes'][mouth['route']]
                forward=1 if JG.inside(route['pts'][0],room['rect'],.6) else -1
                _,tv,n,_=JG.wall_frame(room['rect'],mouth['wall'])
                normal=np.array([n[1],-n[0]])
                physical=-1 if mouth['route'] in ('L65','L100','L114') else 1
                side=int(np.sign(np.dot(tv,normal)))*forward*physical
                over.setdefault(mouth['route'],{})['side']=side
            layout=JG.plan_room(room,plan['routes'],lambda *_:False,over)
        # A dark card belongs only at a deliberate network terminus. Every room mouth is joined.
        for m in layout['mouths']:
            m['joined']=True
        # Mouths must have masonry between them; overlapping openings cannot be accepted as two joins.
        for i,a in enumerate(layout['mouths']):
            for b in layout['mouths'][i+1:]:
                if a['wall']==b['wall'] and abs(a['t']-b['t']) < 2*(JG.P['hw']+JG.P['ring_w'])+.10:
                    raise ValueError(f"Overlapping mouths {a['route']} and {b['route']} on {a['wall']}")
        layouts[rid]=layout
        (out/f'{rid}.json').write_text(json.dumps(over,indent=2)+'\n')
        mouths=[]
        for m in layout['mouths']:
            _,tv,n,_=JG.wall_frame(room['rect'],m['wall'])
            end=JG.wpt(room['rect'],m['wall'],m['t'],-(JG.P['wall']+JG.P['stub']))
            mouths.append(dict(route=m['route'],end=[round(float(v),3) for v in end],dir=n.tolist(),
                               walkway_side=int(np.sign(np.dot(tv*m['side'],np.array([n[1],-n[0]]))))))
        bindings=out/'bindings';bindings.mkdir(exist_ok=True)
        (bindings/f'{rid}.json').write_text(json.dumps(dict(layout=dict(rect=room['rect'],mouths=mouths)),indent=2)+'\n')
    except Exception as e:
        failures.append(dict(room=rid,rect=room['rect'],reason=str(e)))
for i,a in enumerate(rooms):
    for b in rooms[i+1:]:
        r,s=a['rect'],b['rect']
        if min(r[2],s[2])-max(r[0],s[0])>.01 and min(r[3],s[3])-max(r[1],s[1])>.01:
            overlaps.append([a['id'],b['id']])
def encode(x):
    return x.tolist() if hasattr(x,'tolist') else float(x)
temporary=out/'plan.tmp'
temporary.write_text(json.dumps(plan,indent=2)+'\n');temporary.replace(out/'plan.json')
(out/'layouts.json').write_text(json.dumps(dict(layouts=layouts,failures=failures,overlaps=overlaps),indent=2,default=encode)+'\n')
print('JUNCTION_LAYOUTS:',len(layouts),'valid;',len(failures),'failures;',len(overlaps),'overlapping room footprints',flush=True)
for failure in failures:print('JUNCTION_LAYOUT_FAILURE:',failure,flush=True)
