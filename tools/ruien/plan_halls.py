"""Fit gallery-level confluences to the existing groin-vaulted hall kit, without street openings."""
from __future__ import annotations
import copy,json,math
from pathlib import Path
from construction import ROOT,load,contains,distance

STAGE=ROOT/'.scratch/ruien-complete'


def edges(a,b,bay,phase=0):
    n=max(1,round((b-a)/bay))
    if phase:
        return [a]+[a+(b-a)*(i+phase)/n for i in range(n) if 0<i+phase<n]+[b]
    return [a+(b-a)*i/n for i in range(n+1)]


def exit_from(room, route):
    rect=room['rect']; pts=route['pts']
    start=contains(rect,pts[0],.6)
    if not start and not contains(rect,pts[-1],.6):return None
    seq=pts if start else pts[::-1]
    for a,b in zip(seq,seq[1:]):
        if contains(rect,b):continue
        if not contains(rect,a):a=room['centre']
        candidates=[]
        for wall,axis,value in [('x0',0,rect[0]),('x1',0,rect[2]),('z0',1,rect[1]),('z1',1,rect[3])]:
            delta=b[axis]-a[axis]
            if abs(delta)<1e-8:continue
            t=(value-a[axis])/delta
            q=[a[k]+(b[k]-a[k])*t for k in (0,1)]
            if t>0 and contains(rect,q,.001):candidates.append((t,wall,q))
        if candidates:
            _,wall,q=min(candidates)
            return wall,q,start
    return None


def main():
    plan=load(STAGE/'layouts/plan.json'); construction=load(STAGE/'construction.json')
    if plan['routes']['L18']['pts'][0]==[206.0,69.0]:
        plan['routes']['L18']['pts'].insert(0,[206.0,78.5])
    plan['constructionAdjustments']=[dict(id='noorder-head',route='L18',fromPoint=[206,69],toPoint=[206,78.5],
                                        reason='Join the traced Noorder outlet head to the adjacent L16/L19 confluence; the drawing stops 9.5 m short.')]
    plan['rooms']=[r for r in plan['rooms'] if r['class']!='G' or r['id'] in ('C1','C2','C3')]
    halls=[dict(r,baySize=7.5,pierPhaseX=.5) for r in plan['rooms'] if r['class']=='G' and r['id']!='C2']
    for node in construction['nodes']:
        if 'G' not in node['classes'] or (node['kind'] not in ('branch-junction','bend-junction') and node['id']!='J080' and not (node['kind']=='gate' and len(node['ends'])>1)):continue
        x,z=node['at']
        if node['id']=='J035':z=127.68 # match the preserved C2 western branch's exact seam
        rect=[x-11.25,z-7.5,x+11.25,z+7.5] if len(node['ends'])>=4 else [x-5,z-5,x+5,z+5]
        halls.append(dict(id=node['id'],name='Gallery confluence '+node['id'],**{'class':'G'},centre=[x,z],rect=rect,baySize=7.5 if len(node['ends'])>=4 else 20,requiredRoutes=[e['route'] for e in node['ends']]))
    # Adjacent confluences share one masonry chamber rather than intersecting two shells.
    # Named hall footprints are fixed and are never enlarged by this consolidation.
    changed=True
    while changed:
        changed=False
        for i,a in enumerate(halls):
            if not a.get('requiredRoutes'):continue
            for j in range(i+1,len(halls)):
                b=halls[j]
                if not b.get('requiredRoutes'):continue
                r,s=a['rect'],b['rect']
                overlaps=min(r[2],s[2])-max(r[0],s[0])>.01 and min(r[3],s[3])-max(r[1],s[1])>.01
                shared=set(a['requiredRoutes'])&set(b['requiredRoutes'])
                short_join=any(plan['routes'][rid]['class']=='G' and plan['routes'][rid]['lengthM']<25 for rid in shared)
                gap=math.hypot(max(r[0]-s[2],s[0]-r[2],0),max(r[1]-s[3],s[1]-r[3],0))
                # Separate 6 m vaults cannot bend sideways in a one-metre gap between
                # two stubs. Make one bearing hall, rather than folding their shells.
                if not overlaps and not (short_join and gap<8):continue
                aliases=sorted(set(a.get('nodeAliases',[a['id']])+b.get('nodeAliases',[b['id']])))
                rect=[min(r[0],s[0]),min(r[1],s[1]),max(r[2],s[2]),max(r[3],s[3])]
                halls[i]=dict(id='_'.join(aliases),name='Joined gallery confluence '+' / '.join(aliases),**{'class':'G'},rect=rect,
                              centre=[(rect[0]+rect[2])/2,(rect[1]+rect[3])/2],baySize=7.5,nodeAliases=aliases,
                              requiredRoutes=sorted(set(a['requiredRoutes']+b['requiredRoutes'])))
                del halls[j];changed=True;break
            if changed:break
    result=[];failures=[]
    for hall in halls:
        try:
            if hall.get('nodeAliases'):
                r=hall['rect'];cx,cz=hall['centre']
                width=math.ceil((r[2]-r[0])/7.5)*7.5; depth=math.ceil((r[3]-r[1])/7.5)*7.5
                hall['rect']=[cx-width/2,cz-depth/2,cx+width/2,cz+depth/2]
            # Fit buried rooms behind the actual native quay, preserving its
            # ladders. These are measured wall planes, not the drawing's bank.
            fitted={'J042':[-92.0032,106.9106,-82.0032,116.9106],
                    'J056':[-70.006,154.3,-47.506,169.3],
                    'J051_J059':[-81.4,204.9939,-58.9,219.9939]}
            if hall['id'] in fitted:
                hall['rect']=fitted[hall['id']];r=hall['rect'];hall['centre']=[(r[0]+r[2])/2,(r[1]+r[3])/2]
            rect=hall['rect']; xe=edges(rect[0],rect[2],hall['baySize'],hall.get('pierPhaseX',0));ze=edges(rect[1],rect[3],hall['baySize'])
            hall['grates']=[g for g in plan['grates'] if contains(rect,g)]
            mouths=[];used=set();absorbed=[]
            for rid,route in plan['routes'].items():
                if all(contains(rect,p) for p in route['pts']) or (hall['id']=='J051_J059' and rid in ('L40','L81')):
                    absorbed.append(rid);continue
                # Moving a bank room must retain its original logical joins.
                connection=route
                if rid in hall.get('requiredRoutes',[]) and not any(contains(rect,p,.6) for p in (route['pts'][0],route['pts'][-1])):
                    connection=copy.deepcopy(route)
                    k=min((0,-1),key=lambda i:distance(route['pts'][i],hall['centre']))
                    connection['pts'][k]=hall['centre']
                exiting=exit_from(hall,connection)
                if exiting is None:continue
                wall,q,start=exiting; axis=0 if wall[0]=='z' else 1; es=xe if axis==0 else ze
                bays=sorted(range(len(es)-1),key=lambda k:abs((es[k]+es[k+1])/2-q[axis]))
                width=6.0 if route['class']=='G' else 3.6
                free=[k for k in bays if (wall,k) not in used and es[k+1]-es[k]>=width+.68]
                if not free:raise ValueError(f'{rid}: multiple ports need the same wall bay {wall}')
                bay=free[0];used.add((wall,bay));tc=(es[bay]+es[bay+1])/2
                if tc-width/2-.34<es[0] or tc+width/2+.34>es[-1]:raise ValueError(f'{rid}: no bearing masonry beside mouth')
                normal={'x0':[-1,0],'x1':[1,0],'z0':[0,-1],'z1':[0,1]}[wall]
                onwall=[tc,rect[1] if wall=='z0' else rect[3]] if axis==0 else [rect[0] if wall=='x0' else rect[2],tc]
                legacy=hall['id']=='J035' and rid=='L56'
                length=1.45 if legacy else (1.7 if route['class']=='G' else .60)
                endpoint=[round(onwall[k]+normal[k]*length,3) for k in (0,1)]
                original_side=-1 if rid in ('L65','L100','L114') else 1
                ws=original_side if start else -original_side
                mouths.append(dict(route=rid,cls=route['class'],wall=wall,bay=bay,tc=tc,width=width,at=onwall,
                                   end=endpoint,dir=normal,walkway_side=ws,depth=length,legacyC2=legacy))
            gate_ports={'J042':('O4','x1',111.9106,3.0),'J056':('O7','x0',156.75,3.0),
                        'J051_J059':('O6','z0',-77.65,6.0)}
            if hall['id'] in gate_ports:
                gate,wall,tc,width=gate_ports[hall['id']]
                normal={'x0':[-1,0],'x1':[1,0],'z0':[0,-1],'z1':[0,1]}[wall]
                axis=0 if wall[0]=='z' else 1;es=xe if axis==0 else ze
                bay=next(k for k in range(len(es)-1) if es[k]<tc<es[k+1])
                if (wall,bay) in used:raise ValueError('Gate overlaps a passage bay: '+gate)
                at=[tc,rect[1] if wall=='z0' else rect[3]] if axis==0 else [rect[0] if wall=='x0' else rect[2],tc]
                mouths.append(dict(route='GATE_'+gate,cls='G',wall=wall,bay=bay,tc=tc,width=width,at=at,end=at,dir=normal,walkway_side=1,depth=0,gate=gate))
            if hall['id']=='J028':
                mouths.append(dict(route='FLUSH_F1',cls='M',wall='z1',bay=0,tc=-144.,width=3.6,at=[-144.,rect[3]],
                                   end=[-144.,rect[3]+.6],dir=[0,1],walkway_side=1,depth=.6))
            if not mouths:raise ValueError('No routes meet the hall')
            record=dict(room=hall,mouths=mouths,absorbedRoutes=absorbed)
            result.append(record)
            (STAGE/'layouts'/f"{hall['id']}-hall.json").write_text(json.dumps(record,indent=2)+'\n')
            (STAGE/'layouts/bindings'/f"{hall['id']}.json").write_text(json.dumps(dict(layout=dict(rect=rect,mouths=mouths)),indent=2)+'\n')
            if hall['id'] not in {r['id'] for r in plan['rooms']}:plan['rooms'].append(hall)
        except Exception as e:failures.append(dict(room=hall['id'],reason=str(e)))
    overlaps=[]
    all_rooms=[r for r in plan['rooms'] if r['id']!='C2']
    for i,a in enumerate(all_rooms):
        for b in all_rooms[i+1:]:
            r,s=a['rect'],b['rect']
            if min(r[2],s[2])-max(r[0],s[0])>.01 and min(r[3],s[3])-max(r[1],s[1])>.01:overlaps.append([a['id'],b['id']])
    (STAGE/'layouts/halls.json').write_text(json.dumps(dict(halls=result,failures=failures,overlaps=overlaps),indent=2)+'\n')
    tmp=STAGE/'layouts/plan.tmp'
    tmp.write_text(json.dumps(plan,indent=2)+'\n');tmp.replace(STAGE/'layouts/plan.json')
    print('HALL_LAYOUTS',len(result),'valid',len(failures),'failures',len(overlaps),'overlaps')
    for f in failures:print(f)
    for pair in overlaps:print('OVERLAP',pair)


if __name__=='__main__':main()
