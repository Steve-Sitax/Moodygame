"""Bake the O2 metric staff and its sliding float to a native scene. Run from the repository root.

Local y=0 is the O2 sill. Local +Z faces the water. The enamel lip is rolled, the guide and
fixings are turned, and the hollow copper float has a raised seam. Painted lines and letters
have no thickness. Geometry is visual only and stays on the channel side below the walkway.
"""
from base64 import b64encode
from collections import defaultdict
from pathlib import Path
import math
import struct

import numpy as np
from matplotlib.font_manager import FontProperties
from matplotlib.textpath import TextPath
from shapely import Polygon, constrained_delaunay_triangles, symmetric_difference_all


DEST = Path("native-godot/assets/models/ruien-gauge/o2-staff.tscn")
MATERIALS = {
    "Porcelain": ("ede1bc", .52, .01),
    "Indigo": ("182f41", .62, .03),
    "Brass": ("a67c49", .43, .44),
    "Copper": ("a44b2d", .46, .33),
    "Signal": ("c94c32", .48, .04),
}
parts = defaultdict(lambda: defaultdict(list))


def triangle(material, a, b, c, normal, part="Staff"):
    a, b, c, normal = np.array([a, b, c, normal], float)
    # Godot's front face is clockwise. Supply independent outward normals for the vault lighting.
    if np.cross(b-a, c-a) @ normal > 0:
        b, c = c, b
    parts[part][material].extend((p, normal) for p in (a, b, c))


def face(material, outline, z, part="Staff"):
    poly = Polygon(outline)
    for tri in constrained_delaunay_triangles(poly).geoms:
        triangle(material, *[(x,y,z) for x,y in list(tri.exterior.coords)[:3]], (0,0,1), part)


def rectangle(material, x0, y0, x1, y1, z, part="Staff"):
    face(material, [(x0,y0), (x1,y0), (x1,y1), (x0,y1)], z, part)


def letters(material, text, x, y, width, max_height, z):
    paths = TextPath((0,0), text, size=100, prop=FontProperties(family="DejaVu Sans", weight="bold")).to_polygons()
    outline = symmetric_difference_all([Polygon(path) for path in paths])
    x0,y0,x1,y1 = outline.bounds
    scale = min(width / (x1-x0), max_height / (y1-y0))
    for tri in constrained_delaunay_triangles(outline).geoms:
        coords = [(x+(px-(x0+x1)/2)*scale, y+(py-(y0+y1)/2)*scale, z)
                  for px,py in list(tri.exterior.coords)[:3]]
        triangle(material, *coords, (0,0,1))


def rounded(x0, y0, x1, y1, r):
    loops = [(x1-r,y1-r,0), (x0+r,y1-r,90), (x0+r,y0+r,180), (x1-r,y0+r,270)]
    return [(x+r*math.cos(math.radians(a+t)), y+r*math.sin(math.radians(a+t)))
            for x,y,a in loops for t in (0,22.5,45,67.5,90)]


def plate():
    rings=[]
    for inset,z in [(.002,-.003),(0,-.001),(0,.009),(.0025,.012),(.006,.013)]:
        ring=rounded(-.166+inset,-.042+inset,.166-inset,1.085-inset,.014-inset)
        rings.append([(x,y,z) for x,y in ring])
    for first,second in zip(rings,rings[1:]):
        for i,a in enumerate(first):
            j=(i+1)%len(first)
            b,c,d=first[j],second[j],second[i]
            n=np.cross(np.subtract(b,a),np.subtract(d,a)); n/=np.linalg.norm(n)
            triangle("Indigo",a,b,c,n); triangle("Indigo",a,c,d,n)
    face("Porcelain", [(x,y) for x,y,z in rings[-1]], .013)
    centre=(0,.57,rings[0][0][2])
    for i,a in enumerate(rings[0]):
        triangle("Indigo",centre,a,rings[0][(i+1)%len(rings[0])],(0,0,-1))


def turned(material, axis, centre, profile, part="Staff"):
    # Profiles (height, radius) include a chamfer or dome on every exposed rim.
    rings=[]
    for h,r in profile:
        ring=[]
        for i in range(16):
            angle=i*math.tau/16
            u,w=r*math.cos(angle),r*math.sin(angle)
            ring.append(np.add(centre, (u,h,w) if axis=="Y" else (u,w,h)))
        rings.append(ring)
    for i in range(len(rings)-1):
        for j in range(16):
            k=(j+1)%16
            a,b,c,d=rings[i][j],rings[i][k],rings[i+1][k],rings[i+1][j]
            n=np.cross(b-a,d-a)
            if axis=="Y": n=-n
            norm=np.linalg.norm(n)
            if norm<1.e-10: continue
            n/=norm
            triangle(material,a,b,c,n,part);triangle(material,a,c,d,n,part)
    for ring,(h,r),sign in [(rings[0],profile[0],-1),(rings[-1],profile[-1],1)]:
        n=np.array((0,sign,0) if axis=="Y" else (0,0,sign))
        mid=np.mean(ring,axis=0)
        for j in range(16): triangle(material,mid,ring[j],ring[(j+1)%16],n,part)


def staff():
    plate()
    face("Indigo",rounded(-.153,.920,.153,1.072,.009),.0135)
    letters("Porcelain","BINNENPEIL",0,1.037,.244,.042,.0143)
    letters("Porcelain","CM BOVEN",0,.990,.189,.028,.0143)
    letters("Porcelain","SLUISDREMPEL",0,.952,.252,.028,.0143)
    for cm in range(91):
        y=cm*.01
        major=cm%10==0
        length=.094 if major else (.062 if cm%5==0 else .033)
        half=.0028 if major else (.002 if cm%5==0 else .0013)
        rectangle("Indigo",-.115,y-half,-.115+length,y+half,.0138)
        if major:
            letters("Indigo",str(cm),.055,y if cm<90 else .889,.117,.051,.014)
    # Screws hold the casting through the wall-side bosses. A split guide carries the float.
    for x in (-.145,.145):
        for y in (-.023,1.054):
            turned("Brass","Z",(x,y,0),[(.012,.0065),(.014,.008),(.017,.0068),(.018,.0035)])
            rectangle("Indigo",x-.0033,y-.00075,x+.0033,y+.00075,.0182)
    x=-.141
    for y in (.03,.886):
        turned("Brass","Z",(x,y,0),[(.012,.013),(.016,.014),(.021,.008),(.049,.007),(.052,.006)])
    turned("Brass","Y",(x,0,.049),[(.022,.004),(.026,.005),(.895,.005),(.899,.0038)])
    turned("Copper","Y",(x,0,.049),[(-.032,.015),(-.029,.023),(-.015,.030),(-.003,.032),
                                    (0,.033),(.003,.032),(.021,.027),(.029,.018),(.032,.013)],"Float")
    face("Signal",[(x,-.008),(-.074,-.008),(-.055,0),(-.074,.008),(x,.008)],.084,"Float")
    face("Porcelain",[(x,-.0016),(-.064,-.0016),(-.057,0),(-.064,.0016),(x,.0016)],.0843,"Float")


def packed(data):
    return 'PackedByteArray("'+b64encode(data).decode("ascii")+'")'


def surface(material, rows):
    unique={}
    ids=[]
    for position, normal in rows:
        key=tuple(position.round(7))+tuple(normal.round(6))
        ids.append(unique.setdefault(key,len(unique)))
    pos=bytearray(); directions=bytearray(); attrs=bytearray()
    for x,y,z,nx,ny,nz in unique:
        pos+=struct.pack("<3f",x,y,z)
        length=abs(nx)+abs(ny)+abs(nz)
        u,v=nx/length,ny/length
        if nz<0:
            u,v=(1-abs(v))*(1 if u>=0 else -1),(1-abs(u))*(1 if v>=0 else -1)
        directions+=struct.pack("<2H",round((u+1)*32767.5),round((v+1)*32767.5))
        attrs+=struct.pack("<4B2f",25 if y<.50 else 3,0,6,0,x,y)
    vs=np.array(list(unique))[:,:3]
    bounds=', '.join(f"{v:.7f}" for v in (*vs.min(axis=0), *np.maximum(np.ptp(vs,axis=0),.00001)))
    return ('{\n"aabb": AABB('+bounds+'),\n"format": 34359742491,\n"primitive": 3,\n'
            f'"material": SubResource("{material}"),\n"vertex_count": {len(unique)},\n'
            f'"index_count": {len(ids)},\n"vertex_data": {packed(pos+directions)},\n'
            f'"attribute_data": {packed(attrs)},\n"index_data": {packed(np.asarray(ids,dtype="<u2").tobytes())}\n}}')


def save():
    lines=['[gd_scene format=4]', '[ext_resource type="Shader" path="res://shaders/ruien_masonry.gdshader" id="Vault"]']
    for name,(hexcol,rough,metal) in MATERIALS.items():
        colour=', '.join(str(int(hexcol[k:k+2],16)/255) for k in (0,2,4))
        lines.append(f'[sub_resource type="ShaderMaterial" id="{name}"]\nshader = ExtResource("Vault")\n'
                     f'shader_parameter/tint = Color({colour}, 1)\nshader_parameter/rough_k = {rough}\n'
                     f'shader_parameter/metal = {metal}\nshader_parameter/grit = 0.15\nshader_parameter/weather_k = 0.35\n'
                     'shader_parameter/normal_k = 0.0\nshader_parameter/pom = 0.0\nshader_parameter/moss_k = 0.0\n'
                     'shader_parameter/bake_k = 0.0\nshader_parameter/halo_k = 0.0')
    for part,mats in parts.items():
        meshes=', '.join(surface(m,r) for m,r in mats.items())
        lines.append(f'[sub_resource type="ArrayMesh" id="{part}Mesh"]\n_surfaces = [{meshes}]')
    lines.append('[node name="VlietruiStaff" type="Node3D"]')
    for part in parts:
        lines.append(f'[node name="{part}" type="MeshInstance3D" parent="."]\nlayers = 8192\nmesh = SubResource("{part}Mesh")')
    DEST.parent.mkdir(parents=True,exist_ok=True)
    DEST.write_text('\n\n'.join(lines)+'\n',encoding='utf-8')


if __name__=="__main__":
    staff()
    save()
