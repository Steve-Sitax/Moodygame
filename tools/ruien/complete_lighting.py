"""Recover omitted closed ventilation shafts and fill measured lighting gaps in staged jobs."""
import json,math
from pathlib import Path
from PIL import Image
from construction import ROOT,load,nearest_on_path
from native_layout import STAGE,make
from plan_drains import length,frame

def main():
    routes=load(STAGE/'layouts/routes.json');jobs=routes['jobs'];areas=make()['areas'];sources=[];skipped=[]
    paths={v['route']:v['path'] for v in load(STAGE/'path-proof.json')['routes']if 'path'in v}
    for a in areas:
        marker=Path(a['export'].replace('res://',str(ROOT/'native-godot')+'/'))/'markers.json'
        if marker.exists():sources += [dict(area=a['id'],**v)for v in load(marker).get('sources',[])]
    vents=[v['at']for v in sources if v['kind']in ('grate','shaft')]
    for rid in jobs:
        for v in load(STAGE/'exports'/rid/'manifest.json')['info'].get('skipped',[]):
            if 'grate'in v:skipped.append((rid,v['grate']))
    city=load(ROOT/'native-godot/world/data/shared/city.json');wk=city['walk'];im=Image.open(ROOT/'native-godot/world/data/public/city/walk.png').convert('RGB')
    def street(p):
        for dx in(-.60,0,.60):
            for dz in(-.60,0,.60):
                row=round((p[0]+dx-wk['x0'])*2);col=round((p[1]+dz-wk['z0'])*2)
                if not(0<=col<im.width and 0<=row<im.height)or im.getpixel((col,row))!=(0,0,0):return False
        return True
    records=[];changed=set()
    targets=[(rid,p,True)for rid,p in skipped]
    for o in routes['ownership']:
        if o['kind']=='grates' and o['owner']is None and min(math.dist(o['point'],[v[0],v[2]])for v in vents)>7:
            targets.append((None,o['point'],False))
    for preferred,original,replace in targets:
        candidates=[]
        for rid,job in jobs.items():
            if preferred and rid!=preferred:continue
            path=paths[rid];L=length(path);d,u,_,_=nearest_on_path(original,path)
            if d>25:continue
            for k in range(-30,31):
                v=max(6,min(L-6,u+k*.5))
                if L<13 or min(v,L-v)<5.9:continue
                p,t=frame(path,v);side=job['walkwaySide'];off=(2.35 if job['cls']=='G'else 1.36)*side
                top=[p[0]+t[1]*off,p[1]-t[0]*off]
                if not street(top)or any(math.dist(top,[x[0],x[2]])<5 for x in vents):continue
                candidates.append((math.dist(original,top),rid,p,top))
        if not candidates:raise ValueError('No clear closed-vent site for '+str(original))
        distance,rid,p,top=min(candidates);job=jobs[rid]
        if replace:job['grates'].remove(original)
        job['grates'].append(p);vents.append([top[0],0,top[1]]);sources.append(dict(kind='grate',at=[top[0],-1,top[1]]));changed.add(rid)
        records.append(dict(kind='vent',route=rid,original=original,at=top,metres=distance))
    lights=[v['at']for v in sources]
    for e in load(STAGE/'connected-entrances.json')['entrances']:
        if e.get('enabled',True):lights.append([e['door'][0],0,e['door'][1]])
    samples=[]
    for rid,path in paths.items():
        L=length(path)
        for u in range(6,math.floor(L)-5,2):samples.append((rid,*frame(path,u)[:1]))
    while samples:
        distance,rid,p=max((min(math.dist(p,[v[0],v[2]])for v in lights),rid,p)for rid,p in samples)
        if distance<=18.5:break
        jobs[rid]['lamps'].append(p);changed.add(rid);lights.append([p[0],-2.3,p[1]])
        records.append(dict(kind='lamp',route=rid,at=p,previousGap=distance))
    for rid in changed:
        f=STAGE/'layouts/routes'/f'{rid}.json';job=load(f)
        for key in('grates','lamps'):job[key]=jobs[rid][key]
        f.write_text(json.dumps(job,indent=2)+'\n')
    (STAGE/'layouts/routes.json').write_text(json.dumps(routes,indent=2)+'\n')
    (STAGE/'lighting-completion.json').write_text(json.dumps(dict(changed=sorted(changed),placements=records),indent=2)+'\n')
    print('LIGHTING COMPLETION',len(changed),'routes',len([v for v in records if v['kind']=='vent']),'vents',len([v for v in records if v['kind']=='lamp']),'lamps')
if __name__=='__main__':main()
