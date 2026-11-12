"""Write the isolated native conversion layout. This does not install staged areas."""
from __future__ import annotations
import copy,json,math
from construction import ROOT,load

STAGE=ROOT/'.scratch/ruien-complete'

def area_id(rid):return 'network_'+rid.lower()

def gate_walk(area,gate):
    """Keep the crossing behind the quay arch, on capped masonry abutments."""
    if 'rect' not in area['zones'][0]:return
    rid=area['id'][8:].upper();manifest=STAGE/'exports'/rid/'manifest.json'
    spans=load(manifest)['markers'].get('bridges',[])
    bridge=next((copy.deepcopy(b) for b in spans if '_GATE_'+gate['id']+'_bridge' in b['id']),None)
    if bridge is None:return
    p=gate['origin'];n=[-v for v in gate['normal']];t=[n[1],-n[0]]
    depth=1.85
    for end in ('a','b'):
        bridge[end][0]+=n[0]*1.35;bridge[end][2]+=n[1]*1.35
        area.setdefault('openBridgeHeels',[]).append(bridge['id']+'/'+end)
    area.setdefault('bridges',[]).append(bridge)
    for run in area['walkProof']:
        for end in ('from','to'):
            q=run[end];delta=[q[0]-p[0],q[2]-p[1]]
            lateral=sum(delta[i]*t[i] for i in(0,1));d=sum(delta[i]*n[i] for i in(0,1))
            if abs(lateral)<gate['width']/2+.95 and d<depth:
                q[0]+=n[0]*(depth-d);q[2]+=n[1]*(depth-d)
    x0,z0,x1,z1=area['zones'][0]['rect']
    limits=sorted((sum((q[i]-p[i])*t[i] for i in(0,1)) for q in ([x0,z0],[x1,z1])))
    def at(l,d,y):return [p[0]+t[0]*l+n[0]*d,y,p[1]+t[1]*l+n[1]*d]
    for sign in(-1,1):
        lo=gate['channel']/2;hi=min(gate['width']/2+.8,(limits[1] if sign>0 else -limits[0])-.03)
        count=math.ceil((hi-lo)/.6)
        for i in range(count):
            a=lo+(hi-lo)*i/count;b=lo+(hi-lo)*(i+1)/count
            # Separate bluestone flags bear on the brick pier down to the bed.
            for y,height,is_brick in [(-4.97,2.26,True),(-3.72,.24,False)]:
                area.setdefault('landingBlocks',[]).append(dict(at=at(sign*(a+b)/2,1.84,y),
                    size=[b-a+.002 if is_brick else b-a-.003,height,1.04],across=t,along=n,brick=is_brick))
        # End the rail where the platform joins the existing perimeter ledge.
        edge=min(hi,(limits[1] if sign>0 else -limits[0])-1.53)
        if edge>lo+.1:
            area.setdefault('landingRails',[]).append({'from':at(sign*lo,2.32,-3.6),'to':at(sign*edge,2.32,-3.6)})

def make():
    plan=load(STAGE/'layouts/plan.json');ml=load(STAGE/'layouts/layouts.json');hl=load(STAGE/'layouts/halls.json');rl=load(STAGE/'layouts/routes.json')
    result=copy.deepcopy(load(ROOT/'native-godot/world/ruien/areas.json'))
    result['areas']=[a for a in result['areas']if not a['id'].startswith('network_')]
    measured={r['route']:r['path'] for r in load(STAGE/'path-proof.json')['routes'] if 'path' in r}
    rooms={r['id']:r for r in plan['rooms']}
    def base(rid,name,cls):
        return dict(id=area_id(rid),name=name,export=(STAGE/'resources'/rid).as_posix(),streetGrates='ventilation',
                    waterMin=-4.6 if cls=='G' else -4.4,waterRise=0,zones=[])
    for rid in ml['layouts']:
        if rid=='R1':continue
        room=rooms[rid];a=base(rid,room['name'],'M');rect=room['rect']
        a['zones'].append(dict(id=rid,cls='M',rect=rect,wall=.5))
        binding=load(STAGE/'layouts/bindings'/f'{rid}.json')['layout']
        for m in binding['mouths']:
            e,n=m['end'],m['dir'];start=[e[i]-n[i]*1.85 for i in (0,1)]
            a['zones'].append(dict(id=rid+'_'+m['route'],cls='M',path=[start,e],walkwaySide=m['walkway_side'],wall=.5))
        runs=[]
        for run in ml['layouts'][rid]['runs']:
            x0,z0,x1,z1=rect;wall=run['wall'];lo,hi=run['ta'],run['tb']
            # The walker keeps the footbridges' centre line (0.5 m off the wall): their rails leave 6 cm either side.
            if wall in ('z0','z1'):start=[x0+max(lo+.05,.5),-3.9,(z0+.5 if wall=='z0'else z1-.5)];end=[x0+min(hi-.05,x1-x0-.5),-3.9,start[2]]
            else:start=[x0+.5 if wall=='x0'else x1-.5,-3.9,z0+max(lo+.05,.5)];end=[start[0],-3.9,z0+min(hi-.05,z1-z0-.5)]
            if sum((start[i]-end[i])**2 for i in(0,2))>.01:runs.append(dict(name=wall,**{'from':start,'to':end}))
        a['walkProof']=runs
        # A footbridge pivot less than a body's width (plus play) from the corner wall beyond it.
        manifest=STAGE/'exports'/rid/'manifest.json'
        if manifest.exists():
            x0,z0,x1,z1=rect;heels=[]
            for bridge in load(manifest)['markers'].get('bridges',[]):
                for end,other in (('a','b'),('b','a')):
                    p,q=bridge[end],bridge[other]
                    if abs(p[2]-q[2])>abs(p[0]-q[0]):reach=p[2]-z0 if p[2]<q[2] else z1-p[2]
                    else:reach=p[0]-x0 if p[0]<q[0] else x1-p[0]
                    if reach<1.15:heels.append(bridge['id']+'/'+end)
            if heels:a['openBridgeHeels']=heels
        result['areas'].append(a)
    for rec in hl['halls']:
        room=rec['room'];rid=room['id'];a=base(rid,room['name'],'G')
        a['zones'].append(dict(id=rid,cls='G',rect=room['rect'],wall=1.2))
        for m in rec['mouths']:
            e,n=m['end'],m['dir'];start=[m['at'][i]-n[i]*.15 for i in (0,1)]
            z=dict(id=rid+'_'+m['route'],cls=m['cls'],path=[start,e],walkwaySide=m['walkway_side'] if m['cls']=='M' else 0,wall=.5)
            if m.get('legacyC2'):z['spring']=-3.4
            if m['width']!=(6 if m['cls']=='G'else 3.6):z.update(width=m['width'],channelWidth=m['width']-.9)
            a['zones'].append(z)
        # Along each wall on the broad ledge; at a mouth the walker moves in to the footbridge's centre
        # line (0.5 m off the wall, between its rails and clear of the gear box beside its pivot).
        x0,z0,x1,z1=room['rect'];d=1.13;near=.5;proof=[]
        manifest=STAGE/'exports'/rid/'manifest.json'
        spans=load(manifest)['markers'].get('bridges',[])if manifest.exists()else[]
        for wall,fixed,lo,hi in [('z0',z0,x0,x1),('z1',z1,x0,x1),('x0',x0,z0,z1),('x1',x1,z0,z1)]:
            k=0 if wall[0]=='z'else 2;inward=1 if wall[1]=='0'else-1
            def at(t,off):return [t,-3.6,fixed+inward*off]if k==0 else[fixed+inward*off,-3.6,t]
            mine=sorted(sorted((b['a'][k],b['b'][k]))for b in spans if abs(b['a'][2-k]-(fixed+inward*near))<.05 and abs(b['b'][2-k]-(fixed+inward*near))<.05)
            points=[at(lo+d,d)]
            for pa,pb in mine:points += [at(pa-1.0,d),at(pa-.5,near),at(pb+.5,near),at(pb+1.0,d)]
            points.append(at(hi-d,d))
            for start,end in zip(points,points[1:]):
                if sum((start[i]-end[i])**2 for i in(0,2))>.01:proof.append(dict(name=wall,**{'from':start,'to':end}))
        a['walkProof']=proof
        # A rui walkway climbs two risers to the hall ledge between the footbridge's rail end and the portal's
        # haunch. With rails from the hinge that left a centimetre of play; this pivot's rails start further out.
        heels=[rid+'_'+m['route']+'_bridge/'+('b'if m['walkway_side']>0 else'a')for m in rec['mouths']if m['cls']=='M'and not m.get('gate')]
        if heels:a['openBridgeHeels']=heels
        result['areas'].append(a)
    for rid,job in rl['jobs'].items():
        a=base(rid,job['name'],job['cls'])
        a['zones'].append(dict(id=rid,cls=job['cls'],path=measured.get(rid,job['pts']),walkwaySide=job['walkwaySide'] if job['cls']=='M' else 0,wall=.6))
        # A rui walkway meets the gallery ledge beside its tee footbridge's walkway-side pivot ('b').
        manifest=STAGE/'exports'/rid/'manifest.json'
        if manifest.exists():
            heels=[bridge['id']+'/b'for bridge in load(manifest)['markers'].get('bridges',[])if bridge['id'].endswith('_tee')]
            if heels:a['openBridgeHeels']=heels
        result['areas'].append(a)
    # A traced line that ends at its room's mouth has no stretch of its own: the open stub looked into the
    # void. The shared brick infill (RuienEnd) closes it a little inside the stub's last ring.
    for line,cover in rl['coverage'].items():
        if cover.get('kind')!='portal-terminal':continue
        p,n=cover['at'],cover['direction']
        area=next(a for a in result['areas'] if a['id']==area_id(cover['area']))
        area.setdefault('channelEnds',[]).append(dict(id=line+'_stub',at=[p[0]-n[0]*.15,0,p[1]-n[1]*.15],axis=[n[0],0,n[1]],
            half=2.7,bottom=-5.2,top=-.75,culvert=1.0,spring=-4.3,water=True))
    gates=STAGE/'network-gates.json'
    if gates.exists():
        for gate in load(gates)['gates']:
            area=next((a for a in result['areas'] if a['id']==gate['area']),None)
            if area is None:continue
            area['gates']=[gate['cut']]
            gate_walk(area,gate)
            p,n=gate['origin'],gate['normal']
            area['sources']=[dict(id='gate_'+gate['id'],kind='outlet',always=True,at=[p[0],(gate['sill']-.9)/2,p[1]],
                dir=[-n[0],0,-n[1]],size=[gate['width']-.1,max(.4,-.9-gate['sill'])],power=.04 if gate['held']or gate['flush']else .4,range=14,beam=0)]
    # Crown shafts have no access ladder marker. Register their closed street
    # grates explicitly so paving, the surround and collision share the opening.
    for a in result['areas']:
        if not a['id'].startswith('network_'):continue
        rid=a['id'][8:].upper();manifest=STAGE/'exports'/rid/'manifest.json'
        if not manifest.exists():continue
        source=load(manifest)
        for opening in source['markers'].get('daylight_openings',[]):
            if not opening.get('kind','').startswith('round'):continue
            p=opening['centre'];radius=opening.get('radius_m',.3)
            a.setdefault('grates',[]).append(dict(id=opening['name'],at=[p[0],.005,p[2]],size=radius*2,round=True))
    # Raise only the M portal shoulders beside the 30 cm higher G landing. Apply
    # one identical loft to both exports: the lining, rim, host cut and collision
    # remain coincident. The ordinary M barrel and its crown stay unchanged.
    by_id={a['id']:a for a in result['areas']}
    def portal(ids,at,direction,before,plateau_before,plateau_after,length):
        profile=dict(at=at,direction=direction,spring=-2.1,length=length,portal=True,
                     before=before,plateauBefore=plateau_before,plateauAfter=plateau_after)
        for rid in ids:
            by_id[area_id(rid)].setdefault('seamProfiles',[]).append(copy.deepcopy(profile))
    for rec in hl['halls']:
        for m in rec['mouths']:
            if m['cls']=='M' and not m.get('gate'):
                portal([rec['room']['id'],m['route']],m['at'],m['dir'],1.8,.6,.7,2.2)
    ends=STAGE/'end-proof-actual.json'
    seen=set()
    if ends.exists():
        for row in load(ends)['checks']:
            a=by_id[area_id(row['route'])]
            a['walkRange']=[1.,max(1.,sum(((p[0]-q[0])**2+(p[1]-q[1])**2)**.5 for p,q in zip(a['zones'][0]['path'],a['zones'][0]['path'][1:]))-1.)]
            for t in row.get('geometrySignature',[]):
                if t['branch_id']==row['route']:
                    lat=t['l_we']+t['ws']*.37
                    qwall=0 if 'gc' in t else (t['sigma']*t['hostSection']['hw']-lat*t['k'])/t['c']
                    boundary=qwall+.65
                    a['walkRange'][0 if t['which']=='start' else 1]=boundary if t['which']=='start' else t['L']-boundary
                key=(t['branch_id'],t['which'])
                if key in seen:continue
                seen.add(key)
                q=0 if 'gc' in t else t['sigma']*t['hostSection']['hw']/t['c']
                at=[t['O'][i]+q*t['tb'][i]for i in (0,1)]
                portal([t['branch_id'],*t['host_ids']],at,t['tb'],3 if q else 1.2,2.4 if q else .4,.6,1.8)
                if 'gc_w' in t:
                    # Extend the higher landing over the end coping so a person
                    # can cross the arch before turning onto the wider G ledge.
                    lo,hi=sorted((t['l_we']-.04*t['ws'],t['gc_w']+.02*t['ws']))
                    centre=[t['O'][i]-.16*t['tb'][i]+(lo+hi)/2*t['Nb'][i]for i in(0,1)]
                    by_id[area_id(t['branch_id'])].setdefault('landingBlocks',[]).append(dict(
                        at=[centre[0],-3.75,centre[1]],size=[hi-lo,.32,.52],across=t['Nb'],along=t['tb']))
                branch=by_id[area_id(t['branch_id'])];lat=t['l_we']+t['ws']*.37
                def world(q,l,y):return [t['O'][0]+q*t['tb'][0]+l*t['Nb'][0],y,t['O'][1]+q*t['tb'][1]+l*t['Nb'][1]]
                qw=0 if 'gc' in t else (t['sigma']*t['hostSection']['hw']-lat*t['k'])/t['c']
                points=[world(qw+.65,lat,-3.9),world(qw-.4,lat,-3.6)]
                if 'gc'in t:points.append(world(-.4,t['gc_w']+t['ws']*.37,-3.6))
                else:points.append(world((t['sigma']*(t['ch']+.4)-lat*t['k'])/t['c'],lat,-3.6))
                branch.setdefault('joinProof',[]).append(dict(name=t['which'],points=points))
                channel=(t['l_we']+t['l_far'])/2
                if 'gc'in t:bed_points=[world(.65,channel,-4.9),world(.12,channel,-4.9),world(-.25,channel,-5.5),world(-.8,channel,-6.1)]
                else:
                    wall=(t['sigma']*t['hostSection']['hw']-channel*t['k'])/t['c']
                    edge=(t['sigma']*t['ch']-channel*t['k'])/t['c']
                    bed_points=[world(wall+.65,channel,-4.9),world(edge+.2,channel,-4.9),world(edge-.25,channel,-5.5),world(edge-.8,channel,-6.1)]
                branch.setdefault('bedJoinProof',[]).append(dict(name=t['which'],points=bed_points))
    for rec in hl['halls']:
        for m in rec['mouths']:
            if m['cls']!='M' or m.get('gate'):continue
            n=m['dir'];across=[n[1],-n[0]];lat=m['walkway_side']*1.33  # the rui's edge rail keeps him 1.26 m out, the portal's haunch within 1.39 m
            def world(q,y):return [m['at'][0]+q*n[0]+lat*across[0],y,m['at'][1]+q*n[1]+lat*across[1]]
            by_id[area_id(rec['room']['id'])].setdefault('joinProof',[]).append(dict(name=m['route'],points=[world(m.get('depth',.6)+.4,-3.9),world(-.25,-3.6)]))
    # Test the complete through seam, including the metre omitted by ordinary
    # route sampling to avoid unrelated terminal caps and junction construction.
    checked=set()
    resolved={row['route']:row for row in load(ends)['checks']}if ends.exists()else{}
    for rid,job in rl['jobs'].items():
        for end,slot in [('start',0),('end',-1)]:
            if resolved.get(rid,job)[end]!='through':continue
            P=by_id[area_id(rid)]['zones'][0]['path'];at=P[slot]
            for other,j in rl['jobs'].items():
                if other==rid or j['cls']!=job['cls']:continue
                Q=by_id[area_id(other)]['zones'][0]['path']
                for e,k in [('start',0),('end',-1)]:
                    if resolved.get(other,j)[e]!='through'or sum((at[i]-Q[k][i])**2 for i in(0,1))>.0001:continue
                    key=tuple(sorted((rid,other)))
                    if key in checked:continue
                    checked.add(key)
                    def locations(path,index,side):
                        a,b=(path[0],path[1])if index==0 else(path[-2],path[-1])
                        dx,dz=b[0]-a[0],b[1]-a[1];L=(dx*dx+dz*dz)**.5;dx/=L;dz/=L
                        sign=1 if index==0 else-1;off=(1.87 if job['cls']=='G'else 1.37)*side
                        return [path[index][0]+sign*.8*dx+off*dz,-3.6 if job['cls']=='G'else-3.9,path[index][1]+sign*.8*dz-off*dx]
                    for side in(-1,1)if job['cls']=='G'else(job['walkwaySide'],):
                        a=locations(P,slot,side)
                        candidates=[locations(Q,k,s)for s in((-1,1)if j['cls']=='G'else(j['walkwaySide'],))]
                        b=min(candidates,key=lambda b:sum((a[i]-b[i])**2 for i in(0,2)))
                        by_id[area_id(rid)].setdefault('joinProof',[]).append(dict(name='through_'+other+'_'+str(side),points=[a,b]))
                    a=locations(P,slot,0);b=locations(Q,k,0);a[1]=b[1]=-6.1 if job['cls']=='G'else-4.9
                    by_id[area_id(rid)].setdefault('bedJoinProof',[]).append(dict(name=other,points=[a,b]))
    # Remove only the temporary study caps whose full continuations now exist.
    for a in result['areas']:
        if a['id'] in('r1','r1_l65','r1_l100','r1_l114'):
            a['repairLampClearance']=True
            if a['id']=='r1':a['lampHooks']=['R1_lamp_0','R1_lamp_1']
        if a['id'] in ('o2','r1_l65','r1_l100','r1_l114') and a.get('channelEnds'):
            a['retiredChannelEnds']=a.pop('channelEnds')
        if a['id']=='o2':
            a['water']=[w for w in a['water'] if not w['id'].endswith('_culvert')]
            for w in a['water']:
                if w['id']=='side_e':w['outline']=[[x,min(z,147.05)]for x,z in w['outline']]
                elif w['id']=='side_ne':w['outline']=[[min(x,-135.28),z]for x,z in w['outline']]
                elif w['id']=='side_sw':w['outline']=[[max(x,-168.55),z]for x,z in w['outline']]
        if a['id'] in ('network_l14','network_l90'):
            path=a['zones'][0]['path'];length=((path[1][0]-path[0][0])**2+(path[1][1]-path[0][1])**2)**.5
            a['seamProfiles']=[dict(at=path[0],direction=[(path[1][i]-path[0][i])/length for i in (0,1)],spring=-3.4,length=1.2)]
        if a['id'].startswith('network_'):
            z=a['zones'][0]
            if z.get('path'):
                p,q=z['path'][0],z['path'][1];dx,dz=q[0]-p[0],q[1]-p[1];length=(dx*dx+dz*dz)**.5
                side=z.get('walkwaySide',1) or 1;offset=(2.25 if z['cls']=='G' else 1.4)*side
                a['devEntry']=[p[0]+dx/length*.6+dz/length*offset,-3.6 if z['cls']=='G' else -3.9,p[1]+dz/length*.6-dx/length*offset,0]
            else:
                x0,z0,x1,z1=z['rect'];a['devEntry']=[*a['walkProof'][0]['from'],0]if a.get('walkProof')else[(x0+x1)/2,-3.6 if z['cls']=='G'else -3.9,z0+.5,0]
    from network_access import repair_access
    connections=repair_access(result['areas'],STAGE)
    (STAGE/'access-connections.json').write_text(json.dumps(connections,indent=2)+'\n')
    out=STAGE/'native-conversion-areas.json';temporary=out.with_suffix('.tmp')
    temporary.write_text(json.dumps(result,indent=2)+'\n');temporary.replace(out)
    print('NATIVE_CONVERSION_LAYOUT',len(result['areas']),'areas',out)
    return result

if __name__=='__main__':make()
