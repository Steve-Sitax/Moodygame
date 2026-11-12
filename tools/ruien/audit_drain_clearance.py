"""Broad-phase clearance audit against the actual staged main vaults and chambers."""
import argparse,json,math
from pathlib import Path
from construction import load,nearest_on_path
from native_layout import STAGE,make
from plan_drains import Index

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network',type=Path,default=STAGE/'native-drainage.json')
    parser.add_argument('--areas',type=Path)
    parser.add_argument('--out',type=Path,default=STAGE/'drain-clearance-audit.json')
    args=parser.parse_args()
    net=load(args.network);areas=(load(args.areas) if args.areas else make())['areas'];lines={};rooms=[]
    for a in areas:
        for z in a['zones']:
            if z.get('path'):
                lines[a['id']+'/'+z['id']]=dict(path=z['path'],cls=z['cls'],area=a['id'])
            elif z.get('rect'):rooms.append(dict(area=a['id'],rect=z['rect'],cls=z['cls']))
    index=Index(lines);conflicts=[]
    for c in net['collectors']:
        L=sum(math.dist(a,b)for a,b in zip(c['path'],c['path'][1:]));u=0;hits={}
        for a,b in zip(c['path'],c['path'][1:]):
            length=math.dist(a,b);n=max(1,math.ceil(length/.4))
            for k in range(n):
                t=k/n;p=[a[i]+(b[i]-a[i])*t for i in(0,1)];y=c['invertStart']+(c['invertEnd']-c['invertStart'])*(u+length*t)/max(L,.001)
                for key in index.nearby(p,1):
                    host=lines[key];hw=3 if host['cls']=='G'else 1.8;d=nearest_on_path(p,host['path'])[0]
                    if d<hw+.35 and y<-.9 and y+1.6>(-6.1 if host['cls']=='G'else-4.9):
                        hits.setdefault(key,dict(at=p,invert=y,distance=d,halfWidth=hw))
                for room in rooms:
                    x0,z0,x1,z1=room['rect']
                    if x0-.35<p[0]<x1+.35 and z0-.35<p[1]<z1+.35:
                        hits.setdefault(room['area'],dict(at=p,invert=y,room=True))
            u+=length
        if hits:conflicts.append(dict(id=c['id'],destination=c['destination'],potentialIntersections=hits))
    result=dict(collectors=len(net['collectors']),potentialClashes=len(conflicts),conflicts=conflicts,
                note='Conservative 3D envelope broad phase; inspect roof haunches before treating a hit as an open-air intersection.')
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    print('DRAIN_CLEARANCE_AUDIT',len(conflicts),'potential clashes of',len(net['collectors']),'collectors')
    for c in conflicts[:12]:print(c['id'],list(c['potentialIntersections']))

if __name__=='__main__':main()
