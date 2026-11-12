"""Compile route-specific joins and unique lighting ownership before exporting any stretches.

This writes staging data only. Unresolved joins remain explicit blockers, never dark-card
substitutes for a completed passage. Existing O2 and R1 geometry is retained in place.
"""
from __future__ import annotations
import copy,json,math
from pathlib import Path
from construction import ROOT,load,contains,nearest_on_path

STAGE=ROOT/'.scratch/ruien-complete'

def add(a,b,k=1):return [a[i]+k*b[i] for i in (0,1)]
def sub(a,b):return [a[i]-b[i] for i in (0,1)]
def unit(v):
    n=math.hypot(*v)
    if n<1e-8:raise ValueError('Coincident path points')
    return [x/n for x in v]
def length(pts):return sum(math.dist(a,b) for a,b in zip(pts,pts[1:]))
def dot(a,b):return sum(x*y for x,y in zip(a,b))

def compile_path(points,start,end,lead_override=None,margin=5):
    """Preserve the traced middle, with straight, square approaches at both binding planes."""
    points=copy.deepcopy(points)
    def outside(p,bind):return not contains(bind['rect'],p,margin)
    middle=[p for p in points if (start is None or outside(p,start)) and (end is None or outside(p,end))]
    if start and end:
        a,b=start['mouth'],end['mouth'];dist=math.dist(a['end'],b['end'])
        lead=min(2.5,dist*.22)
        if dist<.001:return []
        delta=unit(sub(b['end'],a['end']))
        if not middle and (dot(delta,a['dir'])<=0 or dot(delta,b['dir'])>=0):
            if dist<12:raise ValueError('Room stubs overlap or leave insufficient space for a turn')
            lead=min(8,dist*.2)
        if not middle and dot(a['dir'],delta)>.999 and dot(b['dir'],delta)<-.999:
            return [a['end'],b['end']]
    else:lead=2.5
    if lead_override is not None:lead=lead_override
    if start is None and (not middle or middle[0]!=points[0]):middle.insert(0,points[0])
    if end is None and (not middle or middle[-1]!=points[-1]):middle.append(points[-1])
    result=([start['mouth']['end'],add(start['mouth']['end'],start['mouth']['dir'],lead)] if start else [])+middle
    if end:result += [add(end['mouth']['end'],end['mouth']['dir'],lead),end['mouth']['end']]
    clean=[]
    for p in result:
        if not clean or math.dist(p,clean[-1])>.001:clean.append(p)
    if len(clean)<2:raise ValueError('Route is entirely inside a chamber or its portal')
    return [[round(v,5) for v in p] for p in clean]

def main():
    plan=load(STAGE/'layouts/plan.json');ml=load(STAGE/'layouts/layouts.json');hl=load(STAGE/'layouts/halls.json')
    if ml['failures'] or hl['failures'] or ml['overlaps'] or hl['overlaps']:raise ValueError('Room layouts are unresolved')
    binds=[];absorbed={}
    for rid in ml['layouts']:
        b=load(STAGE/'layouts/bindings'/f'{rid}.json')['layout']
        binds.append(dict(id=rid,**b))
        for line,r in plan['routes'].items():
            if all(contains(b['rect'],p) for p in r['pts']):absorbed[line]=rid
    for r in hl['halls']:
        rid=r['room']['id'];b=load(STAGE/'layouts/bindings'/f'{rid}.json')['layout']
        binds.append(dict(id=rid,**b))
        for line in r['absorbedRoutes']:absorbed[line]=rid
    # The three authored C2 branches are already built. Their removable end walls
    # give exact connection planes; no original mesh, placement or permanent ID moves.
    for rid,end,direction in [('L14',[-135.28,113.75],[1,0]),('L56',[-168.55,127.68],[-1,0]),('L90',[-143.1,147.05],[0,1])]:
        binds.append(dict(id='C2_'+rid,rect=[-159,110,-140,138],mouths=[dict(route=rid,end=end,dir=direction,walkway_side=1)],installed=True))
    gate_bindings=STAGE/'layouts/gate-bindings.json'
    if gate_bindings.exists():
        for b in load(gate_bindings):binds.append(dict(id=b['id'],rect=b['rect'],mouths=[b['mouth']]))
    areas=load(ROOT/'native-godot/world/ruien/areas.json')['areas']
    def unbound_end(point):
        if any(math.dist(point,g['at'])<.6 for g in plan['gates']):return 'through'
        node=next((n for n in load(STAGE/'construction.json')['nodes'] if math.dist(point,n['at'])<.6),None)
        return 'cap' if node and node['kind']=='terminal' else 'auto'
    jobs={};failures=[];coverage={'L13':dict(kind='installed',area='o2')}
    for rid,route in plan['routes'].items():
        if rid=='L13':continue
        if rid in absorbed:
            coverage[rid]=dict(kind='chamber',area=absorbed[rid]);continue
        try:
            candidates=[]
            for b in binds:
                for m in b['mouths']:
                    if m['route']==rid:candidates.append(dict(id=b['id'],rect=b['rect'],mouth=m,installed=b.get('installed',False)))
            start=end=None
            for b in candidates:
                # C2's hand-built footprint differs from the 2D rectangle; it always
                # owns the original central-hall end of these three traced routes.
                owned=[k for k in (0,-1) if contains(b['rect'],route['pts'][k],.6)]
                side=0 if b['installed'] else (owned[0] if len(owned)==1 else min((0,-1),key=lambda k:math.dist(route['pts'][k],b['mouth']['end'])))
                if side==0:
                    if start:raise ValueError('Multiple rooms claim the start: '+start['id']+'/'+b['id'])
                    start=b
                else:
                    if end:raise ValueError('Multiple rooms claim the end: '+end['id']+'/'+b['id'])
                    end=b
            if start and end is None and math.dist(start['mouth']['end'],route['pts'][-1])<.25:
                coverage[rid]=dict(kind='portal-terminal',area=start['id'],at=start['mouth']['end'],direction=start['mouth']['dir'],cls=route['class']);continue
            if end and start is None and math.dist(end['mouth']['end'],route['pts'][0])<.25:
                coverage[rid]=dict(kind='portal-terminal',area=end['id'],at=end['mouth']['end'],direction=end['mouth']['dir'],cls=route['class']);continue
            pts=compile_path(route['pts'],start,end)
            if not pts:
                coverage[rid]=dict(kind='joined-portals',areas=[start['id'],end['id']]);continue
            ws=-1 if rid in ('L65','L100','L114') else 1
            # Tail starts on the exact final tangent of the installed R1 proof piece.
            retained=None
            if rid in ('L65','L100','L114'):
                old=next(a for a in areas if a['id']=='r1_'+rid.lower())
                oldpath=old['zones'][0]['path'];at=oldpath[-1]
                closing=next(e for e in old.get('channelEnds',old.get('retiredChannelEnds',[])) if e['id']==rid+'_stub')
                direction=unit([closing['axis'][0],closing['axis'][2]])
                # Orient the new tail away from R1, preserving the old strip entirely.
                if end and end['id']=='R1':pts=pts[::-1];start,end=end,start;ws=-ws
                _,u,_,_=nearest_on_path(at,pts)
                remaining=[];acc=0
                for a,b in zip(pts,pts[1:]):
                    acc+=math.dist(a,b)
                    if acc>u+2.5:remaining.append(b)
                pts=[at,add(at,direction,2.5)]+remaining
                retained=dict(area=old['id'],metres=round(length(oldpath),3),removeChannelEnd=rid+'_stub')
            if start and not retained and ws!=start['mouth']['walkway_side']:raise ValueError('Start walkway changes side')
            if end and ws!=-end['mouth']['walkway_side']:raise ValueError('Far walkway changes side')
            jobs[rid]=dict(id=rid,cls=route['class'],name=route.get('name',rid),pts=pts,walkwaySide=ws,
                           start='room' if start else unbound_end(route['pts'][0]),end='room' if end else unbound_end(route['pts'][-1]),
                           joins=[b['id'] if b else None for b in (start,end)],retained=retained,grates=[],lamps=[])
            jobs[rid]['construction']=dict(originalPoints=route['pts'],startBinding=start,endBinding=end)
            coverage[rid]=dict(kind='stretch',job=rid,retained=retained)
        except Exception as e:failures.append(dict(route=rid,reason=str(e)))
    # The drawing's flush marker stops short of the native moat. Its utility
    # connection runs from the unused bay of J028 to the measured bank sluice.
    gate_file=STAGE/'network-gates.json'
    if gate_file.exists():
        gate=next(g for g in load(gate_file)['gates'] if g['id']=='F1')
        hall=next(r for r in hl['halls'] if r['room']['id']=='J028')
        mouth=next(m for m in hall['mouths'] if m['route']=='FLUSH_F1')
        start=dict(id='J028',rect=hall['room']['rect'],mouth=mouth)
        p=gate['origin'];n=gate['normal'];end_at=[p[i]-n[i]*1.2 for i in (0,1)]
        end=dict(id='GATE_F1',rect=[p[0]-.7,p[1]-.7,p[0]+.7,p[1]+.7],mouth=dict(end=end_at,dir=[-v for v in n],walkway_side=-1))
        original=[hall['room']['centre'],p];pts=compile_path(original,start,end)
        extended=copy.deepcopy(plan);extended['routes']['FLUSH_F1']=dict(id='FLUSH_F1',name='Kipdorp flush connection',**{'class':'M'},pts=original,lengthM=round(length(pts),1))
        override=STAGE/'layouts/flush-plan.json';override.write_text(json.dumps(extended,indent=2)+'\n')
        jobs['FLUSH_F1']=dict(id='FLUSH_F1',cls='M',name='Kipdorp flush connection',pts=pts,walkwaySide=1,start='room',end='through',joins=['J028','GATE_F1'],
            retained=None,grates=[],lamps=[],planOverride=override.as_posix(),construction=dict(originalPoints=original,startBinding=start,endBinding=end))
    # A plan grate belongs to a chamber first, otherwise exactly one nearest route.
    ownership=[]
    for kind in ('grates','lamps'):
        for p in plan[kind]:
            rooms=[b['id'] for b in binds if not b.get('installed') and contains(b['rect'],p)]
            if rooms:ownership.append(dict(kind=kind,point=p,owner=rooms[0]));continue
            choices=[]
            for rid,job in jobs.items():
                distance,_,_,_=nearest_on_path(p,job['pts'])
                if distance<4:choices.append((distance,rid))
            if choices:
                _,rid=min(choices);jobs[rid][kind].append(p);ownership.append(dict(kind=kind,point=p,owner=rid))
            else:ownership.append(dict(kind=kind,point=p,owner=None))
    out=STAGE/'layouts/routes';out.mkdir(exist_ok=True)
    for rid,job in jobs.items():(out/f'{rid}.json').write_text(json.dumps(job,indent=2)+'\n')
    result=dict(jobs=jobs,coverage=coverage,failures=failures,ownership=ownership,adjustments=plan.get('constructionAdjustments',[]))
    (STAGE/'layouts/routes.json').write_text(json.dumps(result,indent=2)+'\n')
    print('ROUTE_JOBS',len(jobs),'covered',len(coverage),'failures',len(failures))
    for f in failures:print(f)

if __name__=='__main__':main()
