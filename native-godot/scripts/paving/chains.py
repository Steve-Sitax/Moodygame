# H5: street chains from the skeleton: contract 2-way nodes, merge straight-through pieces at junctions, smooth.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import json, math, collections, numpy as np, networkx as nx
from PIL import Image, ImageDraw
from scipy.ndimage import gaussian_filter1d
def load(kind):
    sk=json.load(open(W+f'skeleton-{kind}.json')) if kind!='cobble' else json.load(open(W+'skeleton.json'))
    return sk
def build(sk, snap=0.3):
    G=nx.MultiGraph()
    def nid(p): return (round(p[0]/snap),round(p[1]/snap))
    for i,e in enumerate(sk):
        a,b=nid(e['pts'][0]),nid(e['pts'][-1])
        G.add_node(a,pos=e['pts'][0]); G.add_node(b,pos=e['pts'][-1])
        G.add_edge(a,b,pts=[tuple(p) for p in e['pts']],w=list(e['width']))
    def length(d): p=np.array(d['pts']); return float(np.hypot(*np.diff(p,axis=0).T).sum()) if len(p)>1 else 0.0
    def contract2():
        changed=True
        while changed:
            changed=False
            for n in list(G.nodes):
                if n not in G or G.degree(n)!=2: continue
                es=list(G.edges(n,keys=True,data=True))
                if len(es)!=2: continue
                (u1,v1,k1,d1),(u2,v2,k2,d2)=es
                o1=v1 if u1==n else u1; o2=v2 if u2==n else u2
                if o1==n or o2==n: continue
                pn=G.nodes[n]['pos']
                p1=list(d1['pts']); w1=list(d1['w'])
                if np.hypot(*np.subtract(p1[0],pn))<np.hypot(*np.subtract(p1[-1],pn)): p1=p1[::-1]; w1=w1[::-1]
                p2=list(d2['pts']); w2=list(d2['w'])
                if np.hypot(*np.subtract(p2[0],pn))>np.hypot(*np.subtract(p2[-1],pn)): p2=p2[::-1]; w2=w2[::-1]
                G.remove_node(n); G.add_edge(o1,o2,pts=p1+p2[1:],w=w1+w2[1:]); changed=True
    def wnode(n):
        ws=[]
        for u,v,k,d in G.edges(n,keys=True,data=True):
            pts=d['pts']; i=0 if np.hypot(*np.subtract(pts[0],G.nodes[n]['pos']))<np.hypot(*np.subtract(pts[-1],G.nodes[n]['pos'])) else -1
            ws.append(d['w'][i])
        return max(ws) if ws else 0
    for it in range(12):
        contract2()
        before=G.number_of_edges()
        # spurs: a loose end shorter than the street is wide at its root
        for u,v,k,d in list(G.edges(keys=True,data=True)):
            if not G.has_edge(u,v,k): continue
            if u==v:
                if length(d)<12: G.remove_edge(u,v,k)
                continue
            du,dv=G.degree(u),G.degree(v)
            if (du==1)!=(dv==1):
                root=v if du==1 else u
                if length(d)<2.0+1.6*wnode(root): G.remove_edge(u,v,k)
        G.remove_nodes_from([n for n in list(G.nodes) if G.degree(n)==0])
        contract2()
        # junction clusters: a short piece between two junctions becomes one junction
        for u,v,k,d in sorted(G.edges(keys=True,data=True),key=lambda e:length(e[3])):
            if u==v or not G.has_edge(u,v,k): continue
            if G.degree(u)>=3 and G.degree(v)>=3 and length(d)<max(2.5,1.1*min(wnode(u),wnode(v))):
                pu,pv=np.array(G.nodes[u]['pos']),np.array(G.nodes[v]['pos']); mid=tuple((pu+pv)/2)
                G.remove_edge(u,v,k)
                for a,b,kk,dd in list(G.edges(v,keys=True,data=True)):
                    o=b if a==v else a
                    pts=list(dd['pts']); ws=list(dd['w'])
                    if np.hypot(*np.subtract(pts[0],pv))<np.hypot(*np.subtract(pts[-1],pv)): pts=[tuple(pu)]+pts
                    else: pts=pts+[tuple(pu)]
                    G.remove_edge(a,b,kk); G.add_edge(u,o if o!=v else u,pts=pts,w=ws[:1]+ws if pts[0]==tuple(pu) else ws+ws[-1:])
                G.remove_node(v)
        if G.number_of_edges()==before: break
    return G
def direction(pts, at_start, L=6.0):
    p=np.array(pts if at_start else pts[::-1]); d=np.cumsum(np.r_[0,np.hypot(*np.diff(p,axis=0).T)])
    j=min(np.searchsorted(d,L),len(p)-1); v=p[j]-p[0]; n=np.hypot(*v); return v/n if n>0 else v
def canon(u,v,k): return (u,v,k) if u<=v else (v,u,k)
def chains(G, max_turn=40):
    # at each junction pair the two most opposite arms (within max_turn of straight on), widest first
    used={}
    pairs={}
    for n in G.nodes:
        arms=[canon(u,v,k) for u,v,k in G.edges(n,keys=True)]
        if len(arms)<3: continue
        info=[]
        for (u,v,k) in arms:
            d=G.edges[u,v,k]; pts=d['pts']; start=np.hypot(*np.subtract(pts[0],G.nodes[n]['pos']))<np.hypot(*np.subtract(pts[-1],G.nodes[n]['pos']))
            info.append(((u,v,k),direction(pts,start),np.median(d['w']),sum(np.hypot(*np.diff(np.array(pts),axis=0).T))))
        cand=[]
        for i in range(len(info)):
            for j in range(i+1,len(info)):
                c=-float(np.dot(info[i][1],info[j][1]))
                ang=math.degrees(math.acos(max(-1,min(1,c))))
                if ang<=max_turn: cand.append((ang - 0.5*min(info[i][2],info[j][2]),i,j))
        cand.sort(); taken=set()
        for _,i,j in cand:
            if i in taken or j in taken: continue
            taken|={i,j}; pairs.setdefault(n,[]).append((info[i][0],info[j][0]))
    # walk chains
    E=[canon(u,v,k) for u,v,k in G.edges(keys=True)]
    link=collections.defaultdict(dict)
    for n,ps in pairs.items():
        for a,b in ps: link[n][a]=b; link[n][b]=a
    seen=set(); out=[]
    def other(e,n): return e[1] if e[0]==n else e[0]
    for e in E:
        if e in seen: continue
        # go back to a chain end
        seq=[e]; seen.add(e)
        for end in (0,1):
            cur=e; n=cur[end] if end==0 else cur[1]
            n=cur[0] if end==0 else cur[1]
            while n in link and cur in link[n] and link[n][cur] not in seen:
                nxt=link[n][cur]; seen.add(nxt)
                if end==0: seq.insert(0,nxt)
                else: seq.append(nxt)
                n=other(nxt,n); cur=nxt
        # stitch points in order
        pts=[];ws=[]
        for i,ed in enumerate(seq):
            d=G.edges[ed]; p=list(d['pts']); w=list(d['w'])
            if pts:
                if np.hypot(*np.subtract(p[0],pts[-1]))>np.hypot(*np.subtract(p[-1],pts[-1])): p=p[::-1]; w=w[::-1]
            elif len(seq)>1:
                d2=G.edges[seq[1]]; q=d2['pts']
                ends=[q[0],q[-1]]
                if min(np.hypot(*np.subtract(p[0],x)) for x in ends)<min(np.hypot(*np.subtract(p[-1],x)) for x in ends): p=p[::-1]; w=w[::-1]
            pts+=p if not pts else p[1:]; ws+=w if not ws else w[1:]
        out.append({'pts':pts,'w':ws,'edges':len(seq)})
    return out
if __name__=='__main__':
    import sys
    kind=sys.argv[1] if len(sys.argv)>1 else 'cobble'
    G=build(load(kind))
    deg=collections.Counter(dict(G.degree()).values()); print('nodes by degree',dict(deg))
    C=chains(G)
    print('chains',len(C))
    json.dump(C,open(W+f'chains-{kind}.json','w'))
    g=json.load(open(W+'grid.json')); X0,Z0=g['X0'],g['Z0']; S=4
    base=np.load(W+'street-25.npy') if kind=='cobble' else np.load(W+f'street25-{kind}.npy')
    im=Image.fromarray((base*60).astype(np.uint8)).convert('RGB'); im=im.resize((base.shape[1]*S//4,base.shape[0]*S//4))
    dr=ImageDraw.Draw(im); rng=np.random.default_rng(3)
    for c in C:
        col=tuple(int(x) for x in rng.integers(80,255,3))
        dr.line([((x-X0)*S,(z-Z0)*S) for x,z in c['pts']],fill=col,width=2)
    for n in G.nodes:
        if G.degree(n)>=3: x,z=G.nodes[n]['pos']; dr.ellipse([(x-X0)*S-3,(z-Z0)*S-3,(x-X0)*S+3,(z-Z0)*S+3],outline=(255,255,255))
    im.save(W+f'chains-{kind}.png')
