"""Adapt gate IDs to measured quay faces, leaving authored steps and ladders in place."""
import json,math
from construction import ROOT,load
STAGE=ROOT/'.scratch/ruien-complete'

# Wall-mounted decoration belongs to the wall being opened. Keep the surrounding
# quay, fenders, pier timbers and ladder placements; remove only the part within
# each new aperture. These native decal chunks have no collision stand-ins.
QUAY_DECALS={
    'O10':['quayfurniture_3,0,1'], 'P1':['quayfurniture_2,1,1'],
    'O9':['quayfurniture_0,0,1','quayfurniture_1,0,1'], 'O8':['quayfurniture_0,0,1'],
    'O7':['quayfurniture_-2,2,1'], 'O6':['quayfurniture_-2,3,1'],
    'O4':['quayfurniture_-2,1,1'],
    'O1':['quayfurniture_-4,0,1','quayfurniture_-4,-1,1'],
}

def aperture_clear(gid):
    if gid=='F1':return []
    clear=['outfall_stones','outfall_dark','outfall_runs']+QUAY_DECALS[gid]
    # The old small arched outlets have bars merged into the quay iron mesh.
    if gid in ('O4','O6','O7'):clear.append('quay_iron2')
    return clear

def main():
    plan=load(STAGE/'layouts/plan.json');halls=load(STAGE/'layouts/halls.json')['halls']
    positions={'O10':([205.,-.0027],[0,-1],'g_narrow'),
               'P1':([153.8,109.9986],[0,-1],'m'),
               'O9':([66.75,-.0027],[0,-1],'m_narrow'),
               'O8':([13.,-.0027],[0,-1],'m'),
               'O1':([-209.5,-.0027],[0,-1],'g'),
               'F1':([-146.79681,370.2555],[-.043606136,.99904877],'flush')}
    chamber={}
    for rec in halls:
        for m in rec['mouths']:
            if m.get('gate'):
                positions[m['gate']]=(m['at'],m['dir'],'g_narrow'if m['width']<4 else'g')
                chamber[m['gate']]=rec['room']['id']
    rows=[];bindings=[]
    for gate in plan['gates']:
        gid=gate['id']
        if gid=='O2':continue # installed study, including its permanent gate IDs
        p,n,variant=positions[gid];cls=gate['class'];width={'g':6,'g_narrow':3,'m':3.6,'m_narrow':3,'flush':1}[variant]
        sill=-1.55 if variant=='flush'else(-5.05 if cls=='G'else-4.85)
        bed=-6.1 if cls=='G'else-4.9;channel={'g':3,'g_narrow':2.1,'m':2,'m_narrow':2,'flush':1}[variant]
        owner='network_'+chamber[gid].lower() if gid in chamber else None
        routes=[(rid,k)for rid,r in plan['routes'].items()for k in(0,-1)if math.dist(r['pts'][k],gate['at'])<.7]
        if not owner and routes:owner='network_'+routes[0][0].lower()
        origin=[round(v,5)for v in p];normal=[round(v,8)for v in n]
        row=dict(id=gid,name=gate['name'],origin=origin,normal=normal,variant=variant,
                 kit='res://world/ruien/gate-kit/'+variant,area=owner or'network_flush_f1',width=width,
                 sill=sill,bed=bed,channel=channel,incomingChannel=3 if cls=='G'else 2.8,water=-4.6 if cls=='G'else-4.4,
                 incomingOffset=-.4 if cls=='M'else 0,held=gid=='P1',flush=gid=='F1',planned=gate['at'],
                 reason='Measured native quay plane; full door surround and sweep clear existing steps and ladders.')
        outer=width/2+.78;row['cut']=dict(id=gid,origin=origin,normal=normal,depth=1.2,sill=sill,channel=channel,outletWidth=channel,
            opening=[[-outer,sill-.35],[outer,sill-.35],[outer,-.285],[-outer,-.285]],meshes=['quay_walls'])
        if aperture_clear(gid):row['cut']['clear']=aperture_clear(gid)
        if gid=='F1':row['cut']['opening']=[[-.54,-1.57],[.54,-1.57],[.54,-.95],[-.54,-.95]]
        rows.append(row)
        if gid in chamber or gid=='F1':continue
        for rid,k in routes:
            end=[p[i]-n[i]*1.2 for i in(0,1)];at=gate['at']
            rect=[min(at[0],end[0])-.7,min(at[1],end[1])-.7,max(at[0],end[0])+.7,max(at[1],end[1])+.7]
            bindings.append(dict(id='GATE_'+gid,rect=rect,mouth=dict(route=rid,end=end,dir=[-v for v in n],walkway_side=1 if k==0 else-1),gate=gid))
    (STAGE/'network-gates.json').write_text(json.dumps(dict(gates=rows),indent=2)+'\n')
    (STAGE/'layouts/gate-bindings.json').write_text(json.dumps(bindings,indent=2)+'\n')
    print('NATIVE_GATE_PLAN',len(rows),'new gates',len(bindings),'route bindings')

if __name__=='__main__':main()
