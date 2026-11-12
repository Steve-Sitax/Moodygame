"""Resolve every planned collector and surveyed gully into one gravity drainage graph.

The traced green lines share downstream branches; their ends must not each receive
a sealed study barrel. All output is staged until native geometry proofs pass.
"""
from __future__ import annotations
import json,math,bisect
from pathlib import Path
from construction import ROOT,load,nearest_on_path
from native_layout import STAGE,make
from buried_clearance import Grid,main_grid

def length(path):return sum(math.dist(a,b) for a,b in zip(path,path[1:]))
def unit(v):
    n=math.hypot(*v)
    return [x/n for x in v]
def add(a,b,k=1):return [a[i]+b[i]*k for i in (0,1)]
_frames={}
def frame(path,u):
    key=id(path)
    if key not in _frames:
        along=[0.]
        for a,b in zip(path,path[1:]):along.append(along[-1]+math.dist(a,b))
        _frames[key]=(path,along)
    along=_frames[key][1];i=max(0,min(len(path)-2,bisect.bisect_left(along,u)-1));a,b=path[i],path[i+1];d=math.dist(a,b)
    if d<1e-8:return a,[1.,0.]
    return add(a,unit([b[k]-a[k]for k in (0,1)]),max(0,min(d,u-along[i]))),unit([b[k]-a[k]for k in (0,1)])

def clean(points):
    result=[]
    for p in points:
        if not result or math.dist(p,result[-1])>.01:result.append(p)
    return result

class Index:
    def __init__(self,rows,cell=10):
        self.rows=rows;self.cell=cell;self.grid={}
        for key,row in rows.items():
            for i,(a,b) in enumerate(zip(row['path'],row['path'][1:])):
                for x in range(math.floor(min(a[0],b[0])/cell),math.floor(max(a[0],b[0])/cell)+1):
                    for z in range(math.floor(min(a[1],b[1])/cell),math.floor(max(a[1],b[1])/cell)+1):self.grid.setdefault((x,z),set()).add(key)
    def nearby(self,p,radius=2):
        x,z=[math.floor(v/self.cell) for v in p];ids=set()
        for i in range(x-radius,x+radius+1):
            for j in range(z-radius,z+radius+1):ids.update(self.grid.get((i,j),()))
        return ids

def main():
    plan=load(STAGE/'layouts/plan.json');areas=make()['areas'];branches=plan['sideDrains']
    def actual_path(zone):
        keys=zone['path'];curves=zone.get('curve',[])
        if not any(curves):return keys
        result=[keys[0]]
        for i,(a,b) in enumerate(zip(keys,keys[1:])):
            if i<len(curves) and curves[i] and i>0 and i+2<len(keys):
                h=zone.get('handle',3.2);t0=unit([a[k]-keys[i-1][k]for k in (0,1)]);t1=unit([keys[i+2][k]-b[k]for k in (0,1)]);b1=add(a,t0,h);b2=add(b,t1,-h)
                for j in range(1,41):
                    t=j/40;u=1-t;result.append([u**3*a[k]+3*u*u*t*b1[k]+3*u*t*t*b2[k]+t**3*b[k]for k in (0,1)])
            else:
                count=max(1,math.ceil(math.dist(a,b)/.5))
                result += [[a[k]+(b[k]-a[k])*j/count for k in (0,1)]for j in range(1,count+1)]
        return result
    # Full stretches and retained authored sample strips provide genuine wall faces.
    hosts={}
    for area in areas:
        for zone in area['zones']:
            p=actual_path(zone) if zone.get('path') else None
            if p is None or length(p)<10 or zone.get('id','').startswith('R1_'):continue
            cls=zone['cls'];key=area['id']+'/'+zone['id']
            hosts[key]=dict(area=area['id'],zone=zone['id'],cls=cls,path=p,length=length(p),walkwaySide=zone.get('walkwaySide',0 if cls=='G' else 1))
    # Buried chambers also have real bearing walls. Give their unused bays flat
    # drain heads, keeping clear of every route mouth and masonry corner.
    synthetic={}
    ml=load(STAGE/'layouts/layouts.json');hl=load(STAGE/'layouts/halls.json')
    room_specs={r['id']:r for r in plan['rooms']}
    bindings={rid:load(STAGE/'layouts/bindings'/f'{rid}.json')['layout'] for rid in ml['layouts'] if rid!='R1'}
    bindings.update({r['room']['id']:load(STAGE/'layouts/bindings'/f"{r['room']['id']}.json")['layout'] for r in hl['halls']})
    for rid,b in bindings.items():
        room=room_specs[rid];rect=room['rect'];cls=room['class'];hw=3 if cls=='G' else 1.8
        for wall in ('x0','x1','z0','z1'):
            if wall=='x0':p=[[rect[0]+hw,rect[3]],[rect[0]+hw,rect[1]]]
            elif wall=='x1':p=[[rect[2]-hw,rect[1]],[rect[2]-hw,rect[3]]]
            elif wall=='z0':p=[[rect[0],rect[1]+hw],[rect[2],rect[1]+hw]]
            else:p=[[rect[2],rect[3]-hw],[rect[0],rect[3]-hw]]
            L=length(p)
            if L<4.5:continue
            area='network_'+rid.lower();zone='drain_wall_'+wall;key=area+'/'+zone;reserved=[]
            for m in b['mouths']:
                if m.get('wall')==wall or (wall=='x0' and m['dir']==[-1,0]) or (wall=='x1' and m['dir']==[1,0]) or (wall=='z0' and m['dir']==[0,-1]) or (wall=='z1' and m['dir']==[0,1]):
                    _,u,_,_=nearest_on_path(m.get('at',m['end']),p)
                    reserved.append((u,(6 if m.get('cls')=='G' else 3.6)/2+1.0))
            # Hall brackets follow this spacing; finished native source markers
            # add any additional authored lamps to the same clearance list.
            if cls=='G':reserved += [(u,.9) for u in [1.2+5.5*k for k in range(math.ceil(L/5.5))] if u<L]
            else:reserved.append((L/2,.8))
            for a in areas:
                if a['id']!=area:continue
                marker=STAGE/'resources'/rid/'markers.json'
                if marker.exists():
                    for lamp in load(marker).get('sources',[]):
                        if lamp['kind']!='lamp':continue
                        q=[lamp['at'][0],lamp['at'][2]];_,u,at,_=nearest_on_path(q,p)
                        wall_distance=abs(math.dist(q,at)-hw)
                        if wall_distance<.5:reserved.append((u,.9))
            host=dict(area=area,zone=zone,cls=cls,path=p,length=L,walkwaySide=0 if cls=='G' else 1,flat=True,minFromEnd=2,reserved=reserved)
            if cls=='M':
                runs=[r for r in ml['layouts'][rid]['runs'] if r['wall']==wall]
                host['walkRuns']=[([L-r['tb'],L-r['ta']] if wall in ('x0','z1') else [r['ta'],r['tb']]) for r in runs]
            hosts[key]=host;synthetic[key]=host
    index=Index(hosts)
    for key,host in hosts.items():
        if host.get('flat'):continue
        reserved=[]
        for point in plan['grates']+plan['lamps']:
            dist,u,_,_=nearest_on_path(point,host['path'])
            if dist<4:reserved.append((u,1.5))
        original=next((a for a in areas if a['id']==host['area']),{})
        for spill in original.get('spills',[]):
            q=spill['at'];_,u,_,_=nearest_on_path([q[0],q[2]],host['path']);reserved.append((u,1.5))
        for d in original.get('drains',[])+original.get('sealedDrains',[]):
            if d['zone']==host['zone']:reserved.append((d['u'],2.0))
        if host['area']=='o2' and host['zone']=='vlietrui':reserved.append((7.5,8.5))
        marker=Path(original.get('export','').replace('res://',str(ROOT/'native-godot')+'/'))/'markers.json'
        if marker.exists():
            for source in load(marker).get('sources',[]):
                if source['kind']not in ('lamp','grate','shaft'):continue
                q=[source['at'][0],source['at'][2]];d,u,_,_=nearest_on_path(q,host['path'])
                if d<4:reserved.append((u,1.0 if source['kind']=='lamp'else 1.5))
        host['reserved']=reserved
    survey=load(STAGE/'native-town-survey.json')
    connections=load(STAGE/'entrance-connections.json')['connections'] if(STAGE/'entrance-connections.json').exists()else[]
    passage_paths=[c['path']for c in connections]
    clearance=main_grid(areas,survey['cellars'],passage_paths)
    # The collector's free seam alone does not prove its masonry head fits.
    # Reserve passage lining plus the head's half-width along the whole elbow.
    entrance_clearance=Grid(.25)
    for path in passage_paths:entrance_clearance.line(path,2.45)
    heads=[];drains=[];failures=[];main_routes=plan['routes'];head_roots={}
    def closest_original(p):return min(nearest_on_path(p,r['pts'])[0] for r in main_routes.values())
    def main_head(end,previous,source_points=None,excluded=()):
        choices=[]
        catchment=clearance.component(clearance.nearest(source_points[0] if source_points else previous))
        angle=math.radians(70);du=1.05*(1-math.cos(angle))+.9*math.sin(angle);depth=.9+1.05*math.sin(angle)+.9*math.cos(angle)
        def proposed(host,u,side,bend):
            q,qt=frame(host['path'],u+side*bend*du);qn=[qt[1]*side,-qt[0]*side];hw=3 if host['cls']=='G'else 1.8
            seam=add(q,qn,hw+depth);tangent=unit([qt[i]*side*bend*math.sin(angle)+qn[i]*math.cos(angle)for i in(0,1)])
            return seam,tangent
        def free_end(host,u,side,bend):
            seam,tangent=proposed(host,u,side,bend)
            hw=3 if host['cls']=='G'else 1.8
            for k in range(17):
                theta=angle*k/16
                along=1.05*(1-math.cos(theta))
                radial=hw+.9+1.05*math.sin(theta)
                q,t=frame(host['path'],u+side*bend*along)
                if entrance_clearance.blocked(add(q,[t[1]*side,-t[0]*side],radial)):return False
            q,t=frame(host['path'],u)
            mouth=add(q,[t[1]*side,-t[0]*side],hw)
            if entrance_clearance.blocked(mouth):return False
            return not clearance.blocked(seam)and clearance.component(seam)==catchment and clearance.clear(seam,add(seam,tangent,1.5))
        def straight(host,u):
            # A full masonry head and its bent barrel need a straight bearing bay.
            # Keep the original detailed kit in metric proportions rather than
            # stretching it round a tight bend or intersecting the inner vault.
            axis=unit([frame(host['path'],u+1)[0][i]-frame(host['path'],u-1)[0][i] for i in (0,1)])
            origin=frame(host['path'],u)[0]
            for offset in (-3,-2,-1,1,2,3):
                q=frame(host['path'],u+offset)[0]
                if abs((q[0]-origin[0])*axis[1]-(q[1]-origin[1])*axis[0])>.025:return False
            return True
        for key in index.nearby(end,4):
            host=hosts[key];d,u,_,_=nearest_on_path(end,host['path'])
            margin=host.get('minFromEnd',4)
            u=max(margin,min(host['length']-margin,u))
            safe=[max(margin,min(host['length']-margin,u+shift)) for shift in [0]+[s*k*.5 for k in range(1,17) for s in (-1,1)]]
            safe=[v for v in safe if all(abs(v-r)>pad for r,pad in host['reserved'])]
            def unfolds(v,chosen_side=None):
                if host.get('flat'):return True
                p,t=frame(host['path'],v);n=[t[1],-t[0]]
                side=chosen_side if chosen_side is not None else(1 if sum((previous[i]-p[i])*n[i] for i in (0,1))>=0 else -1)
                def tangent(at):
                    a=frame(host['path'],max(0,at-.14))[0];b=frame(host['path'],min(host['length'],at+.14))[0]
                    return unit([b[i]-a[i] for i in (0,1)])
                # The whole head spans several metres of wall. Its deep barrel
                # must stay outside the inner bend's centre of curvature.
                radial=(3 if host['cls']=='G' else 1.8)+3.0
                for delta in (-2.5,-2,-1.5,-1,-.5,0,.5,1,1.5,2,2.5):
                    a,b=tangent(v+delta-.15),tangent(v+delta+.15)
                    curvature=math.atan2(a[0]*b[1]-a[1]*b[0],sum(a[i]*b[i]for i in (0,1)))/.3
                    if 1+curvature*side*radial<=.4:return False
                return True
            safe=[v for v in safe if any(unfolds(v,s)for s in(-1,1))]
            if not safe:continue
            for v in safe:
                at,t=frame(host['path'],v);normal=[t[1],-t[0]]
                preferred=1 if sum((previous[i]-at[i])*normal[i]for i in(0,1))>=0 else-1
                for side in([1]if host.get('flat')else[preferred,-preferred]):
                    if (key,round(v,3),side)in excluded:continue
                    if unfolds(v,side)and any(free_end(host,v,side,b)for b in(-1,1)):
                        choices.append((math.dist(end,at)+(0 if side==preferred else 2)+(0 if straight(host,v)else 1),key,v,at,t,side))
        if not choices:raise ValueError('No physical main wall within the collector neighborhood')
        d,key,u,at,t,side=min(choices)
        if d>60:raise ValueError(f'Collector needs a {d:.1f} m main connection')
        main_head.chosen=(key,round(u,3),side)
        host=hosts[key];normal=[t[1],-t[0]]
        for h in heads:
            if h['host']==key and h['side']==side and abs(h['u']-u)<2.2:return h
        walk=host['cls']=='G' or (any(a+.65<=u<=b-.65 for a,b in host['walkRuns']) if host.get('flat') else host['walkwaySide']==side)
        template='g_crossing' if host['cls']=='G' else ('m_crossing' if walk else 'm_mouth')
        invert=-3.8 if host['cls']=='G' else (-4.1 if walk else -4.26)
        hw=3 if host['cls']=='G' else 1.8
        bend=1 if sum((previous[i]-at[i])*t[i]*side for i in (0,1))>=0 else -1
        a,R,c,angle=.9,1.05,.9,math.radians(70)
        du=R*(1-math.cos(angle))+c*math.sin(angle);depth=a+R*math.sin(angle)+c*math.cos(angle)
        def ending(b):
            q,qt=frame(host['path'],u+side*b*du);qn=[qt[1]*side,-qt[0]*side]
            seam=add(q,qn,hw+depth)
            tangent=unit([qt[i]*side*b*math.sin(angle)+qn[i]*math.cos(angle) for i in (0,1)])
            return seam,tangent
        if source_points:
            options=[]
            for b in (-1,1):
                if not free_end(host,u,side,b):continue
                se,ta=ending(b)
                outside=[p for p in source_points[:-1] if nearest_on_path(p,host['path'])[0]>hw+.7 and math.dist(p,se)>3]
                radius=1.2
                if outside:
                    approach=add(se,ta,1.5);inc=unit([approach[i]-outside[-1][i] for i in (0,1)])
                    turn=math.acos(max(-1,min(1,-sum(inc[i]*ta[i] for i in (0,1)))))
                    if turn>.001:radius=min(1.2,.995*min(math.dist(outside[-1],approach),1.5)/math.tan(turn/2))
                options.append((radius,b))
            bend=max(options)[1]
        elif not free_end(host,u,side,bend):bend=-bend
        seam,tangent=ending(bend)
        head=dict(id=f'H{len(heads)+1:04}',host=key,area=host['area'],zone=host['zone'],cls=host['cls'],u=u,flat=host.get('flat',False),curved=not straight(host,u),
                  side=side,bend=bend,template=template,invert=invert,at=at,tangent=t,normal=[x*side for x in normal],
                  seam=seam,seamTangent=tangent,sourceDistance=d)
        heads.append(head);return head
    # The planner's predecessor tree creates branches in upstream order: a later
    # line may terminate on any earlier line, including an interior point thinned
    # by up to 0.8 m. Match those junctions before assigning a new main head.
    for i,points in enumerate(branches):
        rid=f'D{i+1:04}';end=points[-1]
        main_gap=closest_original(end)
        prior=[]
        for j,p in enumerate(branches[:i]):
            d,u,q,_=nearest_on_path(end,p)
            if d<1.35:prior.append((d,j,u,q))
        parent=min(prior) if prior else None
        if parent:
            _,j,_,_=parent;_,_,q,_=nearest_on_path(end,drains[j]['path'])
            if clearance.component(clearance.nearest(points[0]))!=clearance.component(q):parent=None
        if parent and parent[0]<=main_gap+.3:
            _,j,_,_=parent;down=drains[j]
            _,u,q,_=nearest_on_path(end,down['path'])
            t=frame(down['path'],u)[1]
            y=down['invertStart']+(down['invertEnd']-down['invertStart'])*u/max(down['length'],.001)
            path=clean(points[:-1]+[q]);destination=dict(kind='collector',id=down['id'],u=u,at=q)
        else:
            # The free earth is one connected body wherever the vaults leave a way round, however long. The
            # nearest wall may lie across a vault from the collector: when no buried way reaches a head, take
            # the next nearest (D0333 chose the far wall of L110 once the Vestrui no longer parted the ground).
            excluded=set();routed=None
            while routed is None:
                made=len(heads)
                try:h=main_head(end,points[-2],points,excluded)
                except ValueError as e:raise ValueError(f'{rid} at {end}: {e}') from e
                # The open head's final straight is the seam, not a hidden cap. Avoid
                # routing the new collector through the occupied main vault volume.
                outside=[];host=hosts[h['host']];hw=3 if h['cls']=='G' else 1.8
                for p in points[:-1]:
                    if nearest_on_path(p,host['path'])[0]>hw+.7:outside.append(p)
                if h['id'] in head_roots:
                    down=head_roots[h['id']];_,u,q,_=nearest_on_path(end,down['path'])
                    path=clean(outside+[q])
                    if len(path)<2:
                        tangent=frame(down['path'],u)[1];path=[add(q,[tangent[1],-tangent[0]],1.2),q]
                    y=down['invertStart']+(down['invertEnd']-down['invertStart'])*u/max(down['length'],.001)
                    destination=dict(kind='collector',id=down['id'],u=u,at=q)
                else:
                    outside=[p for p in outside if math.dist(p,h['seam'])>3]
                    path=clean(outside+[add(h['seam'],h['seamTangent'],1.5),h['seam']])
                    y=h['invert'];destination=dict(kind='head',id=h['id'],at=h['seam'])
                try:routed=clearance.route(path,rid)
                except ValueError:
                    excluded.add(main_head.chosen)
                    if len(heads)>made:heads.pop()
                    if len(excluded)>12:raise
            path=routed
        if parent and parent[0]<=main_gap+.3:path=clearance.route(path,rid)
        L=length(path);up=min(-2.7,y+.008*L)
        if up<y-.001:failures.append(dict(id=rid,reason='Collector rises downstream'))
        drains.append(dict(id=rid,path=path,length=L,invertStart=up,invertEnd=y,egg=[1.,1.6],destination=destination,
                           sourceIndex=i,sourcePath=points))
        if destination['kind']=='head':head_roots[destination['id']]=drains[-1]
    # Every surveyed inlet, including later entrance roof drains, joins this same
    # physical network. Its existing ID, outlet and authored placement are kept.
    raw=load(ROOT/'native-godot/world/town/drainage/ruien-inlets.json')
    surface=load(STAGE/'surface-drainage.json'if(STAGE/'surface-drainage.json').exists()else ROOT/'native-godot/world/ruien/surface-drainage.json')
    for e in surface.get('inlets',[]):
        raw.append(dict(id=e['connectionId'],world=e['inlet'],undergroundConnection=[e['inlet'][0],e['invert'],e['inlet'][2]],diameterMetres=e.get('pipeDiameter',.1)))
    drain_rows={d['id']:d for d in drains};di=Index(drain_rows);drops=[]
    by_head={d['destination']['id']:d for d in drains if d['destination']['kind']=='head'}
    for inlet in raw:
        p=[inlet['world'][0],inlet['world'][2]];choices=[]
        for key in di.nearby(p):
            d,u,q,_=nearest_on_path(p,drain_rows[key]['path'])
            if inlet['undergroundConnection'][1]<-.8 and clearance.component(clearance.nearest(p))!=clearance.component(clearance.nearest(q)):continue
            choices.append((d,key,u,q))
        d,key,u,q=min(choices)if choices else (math.inf,None,0,None)
        line=drain_rows.get(key)
        near_main=min((nearest_on_path(p,hosts[k]['path'])[0] for k in index.nearby(p)),default=1e9)
        if not choices or d>3 and near_main<d-1:
            h=main_head(p,p)
            line=by_head.get(h['id'])
            if line is None:
                path=[add(h['seam'],h['seamTangent'],1.5),h['seam']]
                line=dict(id=f'S{len(by_head)+1:04}',path=path,length=1.5,invertStart=h['invert']+.012,invertEnd=h['invert'],
                          egg=[1.,1.6],destination=dict(kind='head',id=h['id'],at=h['seam']),sourceIndex=None,
                          purpose='closed gully sump; short direct connection omitted by the traced green-line simplification')
                drains.append(line);drain_rows[line['id']]=line;by_head[h['id']]=line
            key=line['id'];u=max(0,line['length']-1.5);q=frame(line['path'],u)[0];d=math.dist(p,q)
        y=line['invertStart']+(line['invertEnd']-line['invertStart'])*u/max(line['length'],.001)
        if d>20:failures.append(dict(id=inlet['id'],reason=f'Inlet branch is {d:.1f} m from a collector'))
        drops.append(dict(id=inlet['id'],fromPoint=inlet['undergroundConnection'],diameter=inlet.get('diameterMetres',.15),
                          collector=key,u=u,toPoint=[q[0],y+1.57,q[1]],horizontalDistance=d))
        if inlet['undergroundConnection'][1]<-.8:
            routed=clearance.route([p,q],'inlet_'+inlet['id'])
            drops[-1]['horizontalPath']=[p]+routed[1:-1]+[q]
    result=dict(schema=1,heads=heads,collectors=drains,inlets=drops,failures=failures,syntheticHosts=synthetic,
                nativeHosts=hosts,summary=dict(heads=len(heads),collectors=len(drains),collectorMetres=round(sum(d['length'] for d in drains),1),inlets=len(drops),failures=len(failures)))
    (STAGE/'drainage-construction.json').write_text(json.dumps(result,indent=2)+'\n')
    (STAGE/'drainage-detours.json').write_text(json.dumps(clearance.detours,indent=2)+'\n')
    print('DRAINAGE_CONSTRUCTION',result['summary'])
    for f in failures[:20]:print(f)

if __name__=='__main__':main()
