"""Add exact continuation rings to an existing validated drain-kit export, without rebaking meshes."""
import json,sys
from pathlib import Path
import numpy as np
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT/'scripts'))
from kit import drain_crossing as KD,sweep as KS,fitlib as FL,arch_rim as AR
folder=ROOT.parents[1]/'.scratch/ruien-complete/drain-kit';file=folder/'manifest.json'
data=json.loads(file.read_text());C,T=KD.barrel_line(FL.data('M')['drainCrossing'],1)
profile=KD.Egg(1.6,1.).Q[::8];across=np.array([-T[-1,1],T[-1,0]])
for name,item in data['templates'].items():
    sec=KS.Section(item['cls'],-1 if name=='m_mouth' else 1)
    frame=AR.RouteWall(FL.Frame(KS.RoutePath([[-5,0],[5,0]]),sec,5,1))
    item['eggProfile']=profile.tolist()
    item.update(spring=sec.spring,crown=sec.crown)
    item['seamRing']=[frame.W(C[-1,0]+across[0]*q[0],item['invert']+q[1],C[-1,1]+across[1]*q[0]).tolist() for q in profile]
file.write_text(json.dumps(data,indent=2)+'\n')
native=ROOT.parents[1]/'.scratch/ruien-complete/resources/drain-kit/templates.json'
native.write_text(json.dumps(data['templates'],indent=2)+'\n')
print('DRAIN_KIT_RINGS',len(data['templates']),len(profile),'vertices each')
