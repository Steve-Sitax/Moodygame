"""Combine proven collector curves with exact native host sections and surveyed drops."""
import json,math
from construction import ROOT,load,nearest_on_path
from native_layout import STAGE,make
from plan_drains import length,frame

def main():
    data=load(STAGE/'drainage-construction.json');proof=load(STAGE/'drainage-path-proof.json')
    if data['failures'] or proof['failures']:raise ValueError('Resolve drainage geometry failures before native construction')
    curves={p['id']:p for p in proof['paths']};done={}
    for d in data['collectors']:
        curve=curves[d['id']];d['path']=curve['path'];d['invertEnd']=curve['invertEnd']
        dest=d['destination']
        if dest['kind']=='collector':
            parent=done[dest['id']];gap,u,q,_=nearest_on_path(d['path'][-1],parent['path'])
            if gap>.05:raise ValueError(f"Unjoined collector {d['id']}: {gap} m")
            d['path'][-1]=q;dest.update(u=u,at=q)
            d['invertEnd']=parent['invertStart']+(parent['invertEnd']-parent['invertStart'])*u/parent['length']
        d['length']=length(d['path']);d['invertStart']=min(-2.7,d['invertEnd']+.008*d['length'])
        done[d['id']]=d
    for inlet in data['inlets']:
        d=done[inlet['collector']];_,u,q,_=nearest_on_path([inlet['toPoint'][0],inlet['toPoint'][2]],d['path'])
        y=d['invertStart']+(d['invertEnd']-d['invertStart'])*u/d['length']
        inlet.update(u=u,toPoint=[q[0],y+1.57,q[1]])
    hosts=dict(data.pop('nativeHosts',data.get('syntheticHosts',{})));data.pop('syntheticHosts',None)
    for area in make()['areas']:
        for zone in area['zones']:
            key=area['id']+'/'+zone['id']
            if any(h['host']==key for h in data['heads']):hosts[key]={'area':area['id'],**zone,**hosts.get(key,{})}
    data['hosts']=hosts
    data['templates']='res://world/ruien/drain-kit'
    data['sourceCounts']=dict(plannedCollectors=741,surveyedStreetGullies=904,entranceDrainagePoints=14)
    data['summary']['collectorMetres']=round(sum(d['length'] for d in data['collectors']),1)
    out=STAGE/'native-drainage.json';out.write_text(json.dumps(data,indent=2)+'\n')
    print('NATIVE_DRAINAGE_MANIFEST',len(hosts),'hosts',data['summary'])

if __name__=='__main__':main()
