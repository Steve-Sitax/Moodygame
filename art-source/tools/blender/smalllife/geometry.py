"""Metre-scale rounded lofts, feather vanes and smooth skin weights; game axes x/y/z, +z forward."""
import math
import numpy as np


class Mesh:
    def __init__(self):
        self.v, self.f, self.uv, self.weights, self.eye = [], [], [], [], []

    def vertex(self, p, uv, tile, weights, eye=0.04):
        i = len(self.v)
        self.v.append(tuple(p))
        self.uv.append(((tile % 4 + .04 + .92 * uv[0]) / 4,
                        1 - (tile // 4 + .04 + .92 * uv[1]) / 4))
        self.weights.append(weights)
        self.eye.append(eye)
        return i

    def loft(self, rings, tile=0, weights=None, sides=24, eye=.04):
        # rings: centre, lateral radius, vertical radius. Closed rounded tips, never a hard cylinder cap.
        if sides>=32 and len(rings)<=10 and not isinstance(weights,list):
            # Long body contours use a smooth longitudinal spline as well as round cross-sections.
            controls=np.array([[*c,rx,ry] for c,rx,ry in rings]);dense=[]
            for j in range(len(controls)-1):
                p0,p1,p2,p3=[controls[min(max(k,0),len(controls)-1)] for k in (j-1,j,j+1,j+2)]
                for t in np.linspace(0,1,5,endpoint=False):
                    q=.5*((2*p1)+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t)
                    dense.append((q[:3],max(.00002,q[3]),max(.00002,q[4])))
            dense.append(rings[-1]);rings=dense
        # Rounded terminal rings close exposed ends. Even a small open rear body ring reads as a hole
        # from below; normals alone cannot repair it. Neck roots remain overlapped inside the torso.
        first,last=rings[0],rings[-1]
        def end_rings(edge,near,sign):
            c=np.array(edge[0]);d=c-np.array(near[0]);d/=max(np.linalg.norm(d),1e-9)
            depth=min(edge[1],edge[2])
            return [(tuple(c+d*depth*.7),edge[1]*.65,edge[2]*.65),
                    (tuple(c+d*depth),.000001,.000001)]
        front=end_rings(first,rings[1],-1);back=end_rings(last,rings[-2],1)
        rings=list(reversed(front))+list(rings)+back
        if isinstance(weights,list):weights=[weights[0],weights[0]]+weights+[weights[-1],weights[-1]]
        ids = []
        for j, (c, rx, ry) in enumerate(rings):
            w = weights[j] if isinstance(weights, list) else weights or {'body': 1}
            tangent=np.array(rings[min(j+1,len(rings)-1)][0])-np.array(rings[max(0,j-1)][0])
            tangent/=max(np.linalg.norm(tangent),1e-9)
            lateral=np.array([1.,0,0]);vertical=np.cross(tangent,lateral)
            vertical/=max(np.linalg.norm(vertical),1e-9)
            ids.append([self.vertex(np.array(c)+lateral*rx*math.cos(a)+vertical*ry*math.sin(a),
                                    (k / sides, j / (len(rings)-1)), tile, w, eye)
                        for k in range(sides+1) for a in [k / sides * math.tau]])
        for j in range(len(ids)-1):
            for k in range(sides):
                a,b,c,d=ids[j][k],ids[j][k+1],ids[j+1][k+1],ids[j+1][k]
                self.f.extend([(a,b,c),(a,c,d)])
        for edge,reverse in ((0,True),(-1,False)):
            w=weights[edge] if isinstance(weights,list) else weights or {'body':1}
            centre=self.vertex(rings[edge][0],(.5,0 if edge==0 else 1),tile,w,eye)
            for k in range(sides):
                a,b=ids[edge][k],ids[edge][k+1]
                self.f.append((centre,b,a) if reverse else (centre,a,b))

    def oval(self, centre, size, tile=0, weight=None, sides=24, rows=16, eye=.04):
        rings=[]
        for j in range(rows+1):
            a=math.pi*j/rows
            rings.append(((centre[0],centre[1],centre[2]-size[2]*math.cos(a)),
                          max(.00002,size[0]*math.sin(a)),max(.00002,size[1]*math.sin(a))))
        self.loft(rings,tile,weight,sides,eye)

    def tube(self, points, radii, tile=8, weight=None, sides=12):
        ids=[]
        pts=np.array(points)
        for j,p in enumerate(pts):
            d=pts[min(j+1,len(pts)-1)]-pts[max(0,j-1)]
            d=d/np.linalg.norm(d)
            ref=np.array([1.,0,0]) if abs(d[0])<.9 else np.array([0.,1,0])
            u=np.cross(d,ref);u/=np.linalg.norm(u);v=np.cross(d,u)
            w=weight[j] if isinstance(weight,list) else weight or {'body':1}
            ids.append([self.vertex(p+radii[j]*(u*math.cos(a)+v*math.sin(a)),(k/sides,j/(len(pts)-1)),tile,w)
                        for k in range(sides+1) for a in [k/sides*math.tau]])
        for j in range(len(ids)-1):
            for k in range(sides):
                a,b,c,d=ids[j][k],ids[j][k+1],ids[j+1][k+1],ids[j+1][k]
                self.f.extend([(a,b,c),(a,c,d)])
        for edge,reverse in ((0,True),(-1,False)):
            w=weight[edge] if isinstance(weight,list) else weight or {'body':1}
            centre=self.vertex(pts[edge],(.5,0 if edge==0 else 1),tile,w)
            for k in range(sides):
                a,b=ids[edge][k],ids[edge][k+1]
                self.f.append((centre,b,a) if reverse else (centre,a,b))

    def feather(self, start, end, width, tile, bone, bend=.006, thickness=.0001):
        # A lens-shaped, closed vane, curved through its length, with a rounded rachis ridge.
        p=np.array(start);d=np.array(end)-p
        side=np.cross(d,[0,1,0]);side/=max(np.linalg.norm(side),1e-8)
        ids=[]
        for j in range(9):
            t=j/8;w=width*(math.sin(math.pi*t)**.55+.002)
            row=[]
            for k in range(5):
                s=(k-2)/2
                q=p+d*t+side*w*s+np.array([0,bend*math.sin(math.pi*t)*(1-s*s),0])
                row.append(self.vertex(q,((s+1)/2,t),tile,{bone:1}))
            ids.append(row)
        for j in range(8):
            for k in range(4):
                a,b,c,d=ids[j][k],ids[j+1][k],ids[j+1][k+1],ids[j][k+1]
                self.f.extend([(c,b,a),(d,c,a)])
        # Separate underside vertices keep finite, opposing normals; 0.1 mm vane thickness.
        back={i:self.vertex(np.array(self.v[i])+[0,-thickness,0],
                           ((self.uv[i][0]*4-tile%4-.04)/.92,
                            ((1-self.uv[i][1])*4-tile//4-.04)/.92),tile,{bone:1})
              for row in ids for i in row}
        for j in range(8):
            for k in range(4):
                a,b,c,d=[back[i] for i in (ids[j][k],ids[j+1][k],ids[j+1][k+1],ids[j][k+1])]
                self.f.extend([(a,b,c),(a,c,d)])
        if thickness>.001:
            # Cartilage has a closed semicircular rim; feather vanes retain their natural thin lip.
            edge=ids[0][:]+[row[-1] for row in ids[1:]]+list(reversed(ids[-1][:-1]))+[row[0] for row in reversed(ids[1:-1])]
            rings=[];radius=thickness*.5;length=max(np.linalg.norm(np.array(end)-p),.001)
            for step in range(9):
                angle=step*math.pi/8;row=[]
                for j,i in enumerate(edge):
                    before=np.array(self.v[edge[(j-1)%len(edge)]]);after=np.array(self.v[edge[(j+1)%len(edge)]])
                    outward=np.cross(after-before,[0,1,0]);outward/=max(np.linalg.norm(outward),1e-9)
                    uv=np.array([(self.uv[i][0]*4-tile%4-.04)/.92,((1-self.uv[i][1])*4-tile//4-.04)/.92])
                    uv+=np.array([0,thickness/length*step/8])
                    q=np.array(self.v[i])+outward*radius*math.sin(angle)+[0,-radius*(1-math.cos(angle)),0]
                    row.append(self.vertex(q,uv,tile,{bone:1}))
                rings.append(row)
            for step in range(8):
                for j in range(len(edge)):
                    k=(j+1)%len(edge);a,b,c,d=rings[step][j],rings[step+1][j],rings[step+1][k],rings[step][k]
                    self.f.extend([(a,b,c),(a,c,d)])

    def normals(self):
        p=np.array(self.v);f=np.array(self.f);n=np.zeros_like(p)
        cross=np.cross(p[f[:,1]]-p[f[:,0]],p[f[:,2]]-p[f[:,0]])
        for k in range(3):np.add.at(n,f[:,k],cross)
        n/=np.maximum(np.linalg.norm(n,axis=1)[:,None],1e-9)
        return n
