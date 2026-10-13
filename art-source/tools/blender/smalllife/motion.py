"""Skin-space clips with two-link IK. Stance contacts travel exactly one stride backwards per cycle."""
import math
import numpy as np

FRAMES=32


def rot(axis,a):
    c,s=math.cos(a),math.sin(a)
    if axis==0:return np.array([[1,0,0],[0,c,-s],[0,s,c]])
    if axis==1:return np.array([[c,0,s],[0,1,0],[-s,0,c]])
    return np.array([[c,-s,0],[s,c,0],[0,0,1]])


def align(a,b):
    a=a/np.linalg.norm(a);b=b/max(np.linalg.norm(b),1e-9)
    v=np.cross(a,b);c=np.dot(a,b)
    if c<-.999:return rot(0,math.pi)
    K=np.array([[0,-v[2],v[1]],[v[2],0,-v[0]],[-v[1],v[0],0]])
    return np.eye(3)+K+K@K/max(1+c,1e-9)


def transform(p,r=None):
    m=np.eye(4);m[:3,3]=p
    if r is not None:m[:3,:3]=r
    return m


def clips(kind,h):
    if kind=='goat':names=['idle','graze','chew','walk','butt','lie']
    elif kind in ('rat','squirrel'):names=['idle','peck','walk','scurry']
    elif kind in ('hen','cockerel'):names=['idle','peck','scratch','walk','run','flap','fly','takeoff']
    else:names=['idle','peck','walk','takeoff','fly','swim']
    stride=h*(.52 if kind=='goat' else .35 if kind=='rat' else .32)
    speed=.45 if kind=='goat' else .5 if kind in ('hen','cockerel') else h*1.7
    return {n:{'first':i*FRAMES,'frames':FRAMES,'seconds':stride/speed if n=='walk' else
               .32 if n in ('run','scurry') else (.75 if kind.startswith('swan') else .55 if kind=='goose' else
                  .10 if kind=='sparrow' else .12 if kind=='songbird' else .16 if kind=='pigeon' else .32 if kind in ('crow','jackdaw') else .26) if n=='fly' else .8 if n=='takeoff' else 2.,
               'stride':stride if n=='walk' else stride*1.4 if n in ('run','scurry') else 0.,
               'duty':.64 if n=='walk' else .42} for i,n in enumerate(names)}


def pose(kind,J,parents,contacts,h,name,phase,stride,duty):
    J={k:np.array(v) for k,v in J.items()}
    G={k:transform(p) for k,p in J.items()}
    q=phase*math.tau
    walking=name in ('walk','run','scurry');flying=name in ('fly','takeoff','flap')
    body=J['body'].copy()
    body[1]+=h*.005*math.sin(q) if not walking else h*.012*math.sin(q*2)
    if walking:body[1]-=h*.025
    peck=max(0,math.sin(q))**4 if name=='peck' else 0
    water=kind.startswith(('duck','swan')) or kind=='goose'
    rodent=kind in ('rat','squirrel')
    if peck:body[1]-=h*(.02 if rodent else .04 if water else .12)*peck
    if kind=='goat' and name=='graze':body[1]-=.14
    if name=='lie':body[1]*=.48
    G['body']=transform(body)
    def joint(n,r):
        par=parents[n]
        G[n]=G[par]@transform(J[n]-J[par],r)
    if kind=='goat':
        a=1.9+.06*math.sin(q) if name=='graze' else .35*math.sin(q) if name=='butt' else .016*math.sin(q)
        joint('neck',rot(0,a));joint('head',rot(0,-a*.26+(.018*math.sin(q*4) if name=='chew' else 0)))
        joint('jaw',rot(0,.028*math.sin(q*4))@rot(1,.035*math.sin(q*4)) if name=='chew' else np.eye(3))
    else:
        angle=.45 if rodent else 1.65 if kind.startswith('swan') or kind=='goose' else 1.2 if kind.startswith('duck') else 1.8
        joint('neck',rot(0,angle*peck));joint('head',rot(0,(.10 if rodent else .25)*peck-.025*math.sin(q)))
    joint('tail',rot(1,.09*math.sin(q)))
    if 'wingL' in J:
        open_=1 if name=='fly' else .5+.5*math.cos(q) if name=='flap' else math.sin(phase*math.pi/2) if name=='takeoff' else .26 if name=='run' else 0
        for s,side in [(-1,'L'),(1,'R')]:
            # Folded rearwards vanes open laterally before the downstroke.
            r=rot(2,s*open_*.7*math.sin(q))@rot(1,-s*open_*1.35)
            r=r@np.diag([1,1,1+open_*.40])
            joint('wing'+side,r)
    for i,(up,low,foot,hip,knee,toe) in enumerate(contacts):
        hip,knee,toe=map(np.array,(hip,knee,toe));p=toe.copy()
        hip=hip+(body-J['body'])
        if walking:
            # Four-foot walk has quarter-cycle phases; birds alternate, scurry/run use diagonal pairs.
            offset=i*.25 if len(contacts)==4 and name=='walk' else (0,.5,.5,0)[i] if len(contacts)==4 else i*.5
            f=(phase+offset)%1
            if f<duty:p[2]+=stride*(duty*.5-f)
            else:
                t=(f-duty)/(1-duty);s=t*t*(3-2*t)
                p[2]+=stride*duty*(-.5+s);p[1]+=h*.16*math.sin(t*math.pi)
        elif name=='scratch' and i==0:
            p[2]+=h*.20*math.sin(q);p[1]+=h*.16*max(0,math.cos(q))
        elif flying:
            p[1]+=h*.12;p[2]-=h*.16
        elif name=='lie':
            p[2]+=h*(.16 if i<2 else -.15)
        l1=np.linalg.norm(knee-np.array(J[up]));l2=np.linalg.norm(toe-np.array(J[low]))
        # The gait may shorten the leg but cannot stretch it. Keep the hip inside the feathered/furred
        # thigh and lower that joint slightly when needed, so the distal skin meets the locked foot.
        horizontal=np.linalg.norm((p-hip)[[0,2]])
        reach=l1+l2-1e-5
        if horizontal>=reach:raise ValueError('stride exceeds leg reach: '+kind+' '+name)
        hip[1]=min(hip[1],p[1]+math.sqrt(max(reach*reach-horizontal*horizontal,0)))
        d=p-hip;dist=min(np.linalg.norm(d),l1+l2-1e-5);direction=d/max(np.linalg.norm(d),1e-9)
        along=(l1*l1-l2*l2+dist*dist)/(2*max(dist,1e-8))
        bend=np.array([0.,0.,1. if kind!='goat' or i<2 else -1.]);bend-=direction*np.dot(direction,bend);bend/=max(np.linalg.norm(bend),1e-8)
        k=hip+direction*along+bend*math.sqrt(max(l1*l1-along*along,0))
        G[up]=transform(hip,align(J[low]-J[up],k-hip))
        G[low]=transform(k,align(J[foot]-J[low],p-k))
        G[foot]=transform(p)
    return G
