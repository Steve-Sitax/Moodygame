"""Connect existing safe stair landings to actual built ledges, without moving street entrances."""
import copy,json,math
from construction import ROOT,load,nearest_on_path
from native_layout import STAGE,make

def sub(a,b):return[a[i]-b[i]for i in(0,1)]
def add(a,b,k=1):return[a[i]+b[i]*k for i in(0,1)]
def dot(a,b):return sum(x*y for x,y in zip(a,b))
def cross(a,b):return a[0]*b[1]-a[1]*b[0]
def unit(a):
    d=math.hypot(*a);return[x/d for x in a]

def main():
    areas=make()['areas'];ml=load(STAGE/'layouts/layouts.json');hl=load(STAGE/'layouts/halls.json')
    fitted=load(STAGE/'access-connections.json')
    frames=load(STAGE/'entrance-frames.json');plan=load(STAGE/'layouts/plan.json');rooms={r['id']:r for r in plan['rooms']}
    spans=[]
    def span(area,zone,cls,a,b,inside,lines):
        if math.dist(a,b)>.08:spans.append(dict(area=area,zone=zone,cls=cls,a=a,b=b,inside=inside,lines=lines,walk=-3.6 if cls=='G'else-3.9))
    for area in areas:
        if not area['id'].startswith('network_'):continue
        for z in area['zones']:
            if 'path'not in z or len(z['path'])<2:continue
            p=z['path'];cls=z['cls'];hw=3 if cls=='G'else 1.8;w=1.5 if cls=='G'else .8
            lengths=[0]
            for a,b in zip(p,p[1:]):lengths.append(lengths[-1]+math.dist(a,b))
            # A body's radius must clear a terminal cap and the masonry at a
            # chamber seam; a point inside a ledge is not sufficient clearance.
            if lengths[-1]>3:
                from plan_drains import frame
                p=[frame(p,1.05)[0]]+[q for q,u in zip(p,lengths)if 1.05<u<lengths[-1]-1.05]+[frame(p,lengths[-1]-1.05)[0]]
            for side in(-1,1) if cls=='G'else(z.get('walkwaySide',1),):
                for a,b in zip(p,p[1:]):
                    t=unit(sub(b,a));n=[t[1]*side,-t[0]*side]
                    offset=hw-w+.36
                    span(area['id'],z['id'],cls,add(a,n,offset),add(b,n,offset),[-v for v in n],[z['id']])
    for rid,r in ml['layouts'].items():
        if rid=='R1':continue
        rect=r['rect'];lines=[m['route']for m in r['mouths']]
        for run in r['runs']:
            wall=run['wall'];a,b=run['ta'],run['tb']
            if wall[0]=='x':aa=[rect[0]+.4 if wall=='x0'else rect[2]-.4,rect[1]+a];bb=[aa[0],rect[1]+b]
            else:aa=[rect[0]+a,rect[1]+.4 if wall=='z0'else rect[3]-.4];bb=[rect[0]+b,aa[1]]
            inward={'x0':[1,0],'x1':[-1,0],'z0':[0,1],'z1':[0,-1]}[wall]
            span('network_'+rid.lower(),rid,'M',aa,bb,inward,lines)
    for rec in hl['halls']:
        r=rec['room'];rid=r['id'];x0,z0,x1,z1=r['rect'];lines=[m['route']for m in rec['mouths']]+rec['absorbedRoutes']
        for wall,a,b,n in [('x0',[x0+1.1,z0+1.2],[x0+1.1,z1-1.2],[1,0]),('x1',[x1-1.1,z0+1.2],[x1-1.1,z1-1.2],[-1,0]),
                           ('z0',[x0+1.2,z0+1.1],[x1-1.2,z0+1.1],[0,1]),('z1',[x0+1.2,z1-1.1],[x1-1.2,z1-1.1],[0,-1])]:
            span('network_'+rid.lower(),rid,'G',a,b,n,lines)
    connections=[];failures=[];original=load(ROOT/'native-godot/world/ruien/entrances.json');entries={e['id']:e for e in original['entrances']}
    held=[]
    for row in frames:
        if row['closure']=='open':continue
        if row['id'] in fitted:
            fix=fitted[row['id']];entry=entries[row['id']];entry.update(fix)
            option=next(o for o in row['options']if o['side']==fix['closureSide'])
            p=option['at'];n=option['dir'];length=fix['connectLength']
            end=fix['connectPath'][-1]if'connectPath'in fix else[p[0]+n[0]*length,p[1],p[2]+n[1]*length]
            path=fix.get('connectPath',[p,end])
            connections.append(dict(id=row['id'],line=row['line'],area=fix['connectArea'],zone=fix['connectArea'][8:].upper(),
                side=fix['closureSide'],length=length,fromPoint=p,toPoint=end,normal=n,path=[[q[0],q[2]]for q in path]))
            continue
        choices=[]
        for option in row['options']:
            origin=[option['at'][0],option['at'][2]];direction=option['dir']
            for sp in spans:
                if abs(sp['walk']-row['depth'])>.31:continue
                a,b=sp['a'],sp['b'];d,u,q,_=nearest_on_path(origin,[a,b])
                if d>35:continue
                ab=sub(b,a);den=cross(direction,ab)
                intended=any(line==row['line']or line.endswith('_'+row['line'])for line in sp['lines'])
                preference=(0 if intended else 40)+(0 if option['side']==row['originalSide']else .15)+abs(sp['walk']-row['depth'])*10
                if abs(den)>1e-5:
                    delta=sub(a,origin);distance=cross(delta,ab)/den;along=cross(delta,direction)/den
                    if .15<distance<35 and -.001<=along<=1.001 and dot(direction,sp['inside'])>.5:
                        endpoint=add(origin,direction,distance)
                        choices.append((distance+preference,distance,option,sp,[origin,endpoint]))
                if not intended or d>24:continue
                n=sp['inside'];tangent=unit(ab)
                if math.dist(a,b)>1.8:
                    _,u,q,_=nearest_on_path(origin,[a,b]);u=max(.8,min(math.dist(a,b)-.8,u));q=add(a,tangent,u)
                for lead in(1.5,2,3,4,5):
                    path=[origin,add(origin,direction,lead),add(q,n,-lead),q]
                    clean=[path[0]]
                    for point in path[1:]:
                        if math.dist(point,clean[-1])>.05:clean.append(point)
                    if len(clean)<3:continue
                    okay=True;turn=0
                    for i in range(1,len(clean)-1):
                        inc=unit(sub(clean[i],clean[i-1]));out=unit(sub(clean[i+1],clean[i]));angle=math.acos(max(-1,min(1,dot(inc,out))))
                        if angle>math.radians(135):okay=False;break
                        cut=1.05*math.tan(angle/2)
                        if min(math.dist(clean[i],clean[i-1]),math.dist(clean[i+1],clean[i]))<cut*2+.08:okay=False;break
                        turn+=angle
                    if not okay:continue
                    distance=sum(math.dist(a,b)for a,b in zip(clean,clean[1:]))
                    choices.append((distance+preference+turn*.8,distance,option,sp,clean))
        if not choices:
            failures.append(dict(id=row['id'],reason='No straight landing-to-ledge connection; requires a routed passage'))
            continue
        _,distance,option,sp,path=min(choices,key=lambda v:v[0])
        entry=entries[row['id']];entry.update(closure='open',closureSide=option['side'],connectArea=sp['area'],connectLength=round(distance,5))
        if len(path)>2 or abs(sp['walk']-row['depth'])>.01:
            lengths=[0]
            for a,b in zip(path,path[1:]):lengths.append(lengths[-1]+math.dist(a,b))
            entry['connectPath']=[[round(p[0],5),round(row['depth']+(sp['walk']-row['depth'])*u/lengths[-1],5),round(p[1],5)]for p,u in zip(path,lengths)]
        connections.append(dict(id=row['id'],line=row['line'],area=sp['area'],zone=sp['zone'],side=option['side'],length=distance,
                                fromPoint=option['at'],toPoint=[path[-1][0],sp['walk'],path[-1][1]],normal=option['dir'],path=path))
    surface=STAGE/'surface-drainage.json'
    if surface.exists():
        for inlet in load(surface)['inlets']:
            if inlet.get('previousReservedInvert')is not None:
                entry=entries[inlet['entrance']]
                entry['roofDrainLeft'if inlet['connectionId'].endswith('_L')else'roofDrainRight']=inlet['invert']-entry.get('street',0)
    (STAGE/'connected-entrances.json').write_text(json.dumps(original,indent=2)+'\n')
    (STAGE/'entrance-connections.json').write_text(json.dumps(dict(connections=connections,failures=failures,held=held),indent=2)+'\n')
    print('ENTRANCE_CONNECTIONS',len(connections),'connected',len(failures),'unresolved',len(held),'held closed')
    for f in failures:print(f)
    for c in connections:print(c['id'],c['area'],round(c['length'],2),c['side'])

if __name__=='__main__':main()
