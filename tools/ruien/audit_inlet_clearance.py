"""Check inlet pipe envelopes against main-tunnel air and existing cellars."""
import argparse,json,math
from pathlib import Path
from construction import ROOT,load,nearest_on_path
from native_layout import STAGE,make
from plan_drains import Index

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--network',type=Path,default=STAGE/'native-drainage.json')
    parser.add_argument('--areas',type=Path)
    parser.add_argument('--out',type=Path,default=STAGE/'inlet-clearance-audit.json')
    args=parser.parse_args()
    net=load(args.network);areas=(load(args.areas) if args.areas else make())['areas'];lines={};rooms=[]
    for area in areas:
        for z in area['zones']:
            row=dict(z,area=area['id'])
            if z.get('path'):lines[area['id']+'/'+z['id']]=row
            elif z.get('rect'):rooms.append(row)
    index=Index(lines);cellars=load(STAGE/'native-town-survey.json')['cellars'];conflicts=[]
    for inlet in net['inlets']:
        a,b=inlet['fromPoint'],inlet['toPoint'];shallow=min(-.55,a[1]-.23);radius=inlet['diameter']/2+.012
        via=inlet.get('horizontalPath',[])
        raw=[a,[a[0],shallow,a[2]]]+[[p[0],shallow,p[1]]for p in via[1:-1]]+[[b[0],shallow,b[2]],b]
        hits={}
        for start,end in zip(raw,raw[1:]):
            n=max(1,math.ceil(math.dist(start,end)/.15))
            for k in range(n+1):
                p=[start[j]+(end[j]-start[j])*k/n for j in range(3)];xy=[p[0],p[2]]
                for key in index.nearby(xy,1):
                    z=lines[key];hw=3 if z['cls']=='G'else 1.8;bed=-6.1 if z['cls']=='G'else-4.9
                    spring=z.get('spring',-3.1 if z['cls']=='G'else-2.7)
                    if p[1]+radius<bed or p[1]-radius>=-.9:continue
                    shell=hw*math.sqrt(max(0,1-(max(0,p[1]-spring)/(-.9-spring))**2))
                    if nearest_on_path(xy,z['path'])[0]<shell+radius:hits.setdefault(key,dict(at=p,kind='main air'))
                for room in rooms:
                    x0,z0,x1,z1=room['rect'];bed=-6.1 if room['cls']=='G'else-4.9
                    if bed-radius<p[1]<-.9+radius and x0-radius<p[0]<x1+radius and z0-radius<p[2]<z1+radius:
                        hits.setdefault(room['area'],dict(at=p,kind='chamber envelope'))
                for room in cellars:
                    lo,hi=room['min'],room['max']
                    if all(lo[j]-radius<p[j]<hi[j]+radius for j in range(3)):hits.setdefault(room['id'],dict(at=p,kind='cellar envelope'))
        if hits:conflicts.append(dict(id=inlet['id'],hits=hits))
    result=dict(inlets=len(net['inlets']),conflicts=conflicts,note='Pipe and socket envelope; chamber/cellar bounds are conservative.')
    args.out.write_text(json.dumps(result,indent=2)+'\n')
    print('INLET_CLEARANCE_AUDIT',len(conflicts),'conflicts of',len(net['inlets']))
    for c in conflicts:print(c['id'],c['hits'])
    if conflicts:raise ValueError('Inspect inlet clearance conflicts')

if __name__=='__main__':main()
