"""Deterministic routing through earth, outside existing vault and cellar envelopes."""
import heapq,math
from collections import deque

class Grid:
    def __init__(self,cell=.5):self.cell=cell;self.occupied=set();self.detours=[];self.components={};self.next_component=0
    def component(self,p):
        key=self.key(p)
        if key in self.occupied:return-1
        if key in self.components:return self.components[key]
        if not hasattr(self,'bounds'):
            xs=[p[0]for p in self.occupied];zs=[p[1]for p in self.occupied]
            self.bounds=(min(xs)-200,min(zs)-200,max(xs)+200,max(zs)+200)
        x0,z0,x1,z1=self.bounds;self.next_component+=1;label=self.next_component
        queue=deque([key]);self.components[key]=label
        while queue:
            x,z=queue.popleft()
            for nx,nz in((x+1,z),(x-1,z),(x,z+1),(x,z-1)):
                at=(nx,nz)
                if not x0<=nx<=x1 or not z0<=nz<=z1 or at in self.occupied or at in self.components:continue
                self.components[at]=label;queue.append(at)
        return label
    def key(self,p):return(math.floor(p[0]/self.cell),math.floor(p[1]/self.cell))
    def point(self,k):return[(k[0]+.5)*self.cell,(k[1]+.5)*self.cell]
    def blocked(self,p):return self.key(p)in self.occupied
    def rectangle(self,rect,padding):
        x0,z0,x1,z1=rect;c=self.cell
        for x in range(math.floor((x0-padding)/c),math.ceil((x1+padding)/c)):
            for z in range(math.floor((z0-padding)/c),math.ceil((z1+padding)/c)):self.occupied.add((x,z))
    def line(self,path,radius):
        c=self.cell;r=radius+c/math.sqrt(2);r2=r*r
        for a,b in zip(path,path[1:]):
            dx,dz=b[0]-a[0],b[1]-a[1];den=dx*dx+dz*dz
            for x in range(math.floor((min(a[0],b[0])-r)/c),math.ceil((max(a[0],b[0])+r)/c)):
                for z in range(math.floor((min(a[1],b[1])-r)/c),math.ceil((max(a[1],b[1])+r)/c)):
                    p=self.point((x,z));t=max(0,min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dz)/max(den,1e-8)))
                    if(p[0]-a[0]-t*dx)**2+(p[1]-a[1]-t*dz)**2<=r2:self.occupied.add((x,z))
    def clear(self,a,b):
        count=max(1,math.ceil(math.dist(a,b)/(self.cell*.35)))
        return all(not self.blocked([a[i]+(b[i]-a[i])*k/count for i in(0,1)])for k in range(count+1))
    def nearest(self,p):
        if not self.blocked(p):return p
        key=self.key(p)
        for r in range(1,81):
            choices=[]
            for x in range(-r,r+1):
                for z in(-r,r):
                    k=(key[0]+x,key[1]+z)
                    if k not in self.occupied:choices.append((math.dist(p,self.point(k)),k))
            for z in range(-r+1,r):
                for x in(-r,r):
                    k=(key[0]+x,key[1]+z)
                    if k not in self.occupied:choices.append((math.dist(p,self.point(k)),k))
            if choices:return self.point(min(choices)[1])
        raise ValueError('No earth outside the occupied envelope within 40 m')
    def segment(self,a,b):
        if self.clear(a,b):return[a,b]
        start,end=self.key(a),self.key(b)
        if start in self.occupied or end in self.occupied:raise ValueError('Buried route endpoint is inside an existing vault')
        if self.component(a)!=self.component(b):raise ValueError('A main vault separates the collector endpoints; choose a head in the same catchment')
        queue=[(math.dist(start,end),0,start)];cost={start:0};previous={}
        directions=[(1,0),(-1,0),(0,1),(0,-1),(1,1),(1,-1),(-1,1),(-1,-1)]
        while queue:
            _,distance,at=heapq.heappop(queue)
            if distance!=cost.get(at):continue
            if at==end:break
            if len(cost)>200000:raise ValueError('Buried detour exceeds the bounded construction search')
            for dx,dz in directions:
                to=(at[0]+dx,at[1]+dz)
                if to in self.occupied or abs(to[0]-start[0])+abs(to[1]-start[1])>600:continue
                if dx and dz and((at[0]+dx,at[1])in self.occupied or(at[0],at[1]+dz)in self.occupied):continue
                value=distance+math.hypot(dx,dz)
                if value>=cost.get(to,math.inf):continue
                cost[to]=value;previous[to]=at;heapq.heappush(queue,(value+math.dist(to,end),value,to))
        if end not in cost:raise ValueError('No buried route outside the existing vault envelopes')
        keys=[end]
        while keys[-1]!=start:keys.append(previous[keys[-1]])
        points=[a]+[self.point(k)for k in keys[-2:0:-1]]+[b]
        # Remove grid steps only when the whole replacement lies in clear earth.
        result=[points[0]];at=0
        while at<len(points)-1:
            following=next(k for k in range(len(points)-1,at,-1)if self.clear(points[at],points[k]))
            result.append(points[following]);at=following
        return result
    def route(self,path,identity):
        free=[self.nearest(p)for p in path];component=self.component(free[0])
        if self.component(free[-1])!=component:raise ValueError('Collector endpoint belongs to another earth catchment: '+identity)
        free=[p for p in free if self.component(p)==component];result=[free[0]]
        for p in free[1:]:
            if math.dist(result[-1],p)<.01:continue
            result+=self.segment(result[-1],p)[1:]
        if result!=path:self.detours.append(dict(id=identity,original=path,path=result))
        return result

def main_grid(areas,cellars=(),passages=()):
    grid=Grid()
    for area in areas:
        for zone in area['zones']:
            cls=zone['cls'];half=3 if cls=='G'else 1.8
            if zone.get('path'):grid.line(zone['path'],half+1.)
            elif zone.get('rect'):grid.rectangle(zone['rect'],1.)
    for room in cellars:
        lo,hi=room['min'],room['max'];grid.rectangle([lo[0],lo[2],hi[0],hi[2]],1.)
    for path in passages:grid.line(path,1.65)
    return grid
