"""Exercise every room's production lamp siting before relief export."""
import json,sys
from pathlib import Path
from types import SimpleNamespace
import numpy as np
root=Path(__file__).resolve().parents[3];sys.path.insert(0,str(Path(__file__).parent))
from kit import junction_gen as JG
stage=root/'.scratch/ruien-complete';layouts=json.loads((stage/'layouts/layouts.json').read_text())['layouts']
plan=json.loads((stage/'layouts/plan.json').read_text());rooms={r['id']:r for r in plan['rooms']}
JG.REPAIR_LAMPS=True;anchors=[];checks=[];failures=[]
def bracket(name,at,d,length,mat,coll):
    anchors.append(dict(name=name,at=at.tolist()));return [],at+d*(length-.03)+np.array([0,-.065,0])
JG.PR.lamp_bracket=bracket;JG.PR.safety_lamp=lambda *a,**k:(SimpleNamespace(),None)
for rid,lay in layouts.items():
    if rid=='R1':continue
    anchors=[]
    try:
        lay=JG.plan_room(rooms[rid],plan['routes'],lambda *a,**k:True,json.loads((stage/'layouts'/f'{rid}.json').read_text()))
        room=JG.Room(lay)
        for m in room.mouths:
            c=JG.wpt(room.rect,m['wall'],m['t'],1.0);m['bay']=int(room.bay_of(np.array(c[0]),np.array(c[1])))
            m['through']=lay['bays']['n']>1 and((lay['bays']['along']=='z')==(m['wall']in('z0','z1')))
        JG.lamps(room,{'iron':None},None,None,{'placements':[]})
        checks.append(dict(id=rid,anchors=anchors))
    except Exception as e:failures.append(dict(id=rid,error=str(e)))
(stage/'lamp-siting-proof.json').write_text(json.dumps(dict(checks=checks,failures=failures),indent=2)+'\n')
print('LAMP SITING PROOF',len(checks),'rooms;',len(failures),'failures')
for f in failures:print(f)
if failures:raise ValueError('Unresolved lamp mounting stations')
