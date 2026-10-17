"""Blender: fit the detailed head to the full-size character, preserving source meshes."""
import bpy
import bmesh
import json
import sys
import math
from pathlib import Path
from mathutils import Vector

ROOT=Path(__file__).resolve().parent
textured='--textured' in sys.argv
tag='v07-blue-trousers' if textured else 'v07-clay'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def load(filename,name,height):
    bpy.ops.object.select_all(action='DESELECT')
    before=set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(ROOT/'source'/filename))
    objects=[o for o in set(bpy.data.objects)-before if o.type=='MESH']
    for o in objects: o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    obj=bpy.context.object
    obj.name=name
    bpy.ops.object.transform_apply(location=False,rotation=True,scale=True)
    vertices=obj.data.vertices
    lo=min(v.co.z for v in vertices); hi=max(v.co.z for v in vertices)
    xmin=min(v.co.x for v in vertices); xmax=max(v.co.x for v in vertices)
    ymin=min(v.co.y for v in vertices); ymax=max(v.co.y for v in vertices)
    factor=height/(hi-lo)
    for v in vertices:
        v.co=Vector(((v.co.x-(xmin+xmax)/2)*factor,(v.co.y-(ymin+ymax)/2)*factor,(v.co.z-lo)*factor))
    obj.location=(0,0,0)
    for p in obj.data.polygons: p.use_smooth=True
    for material in obj.data.materials:
        if material and material.use_nodes:
            bsdf=material.node_tree.nodes.get('Principled BSDF')
            if bsdf:
                bsdf.inputs['Metallic'].default_value=0
                bsdf.inputs['Roughness'].default_value=.76 if name=='Antigoon_body' else .63
    return obj

body_source='textured-v02.glb' if textured else ('shape-v01.glb' if '--body-v01' in sys.argv else 'shape-v02.glb')
body=load(body_source,'Antigoon_body',5.4)
neck_points=[v.co.copy() for v in body.data.vertices if 4.61<v.co.z<4.65]
neck_center=sum(neck_points,Vector())/max(1,len(neck_points))
bm=bmesh.new(); bm.from_mesh(body.data)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(0,0,4.30),plane_no=(0,0,1),clear_outer=True)
boundary=sorted([v for v in bm.verts if abs(v.co.z-4.30)<.00001],key=lambda v:math.atan2(v.co.x-neck_center.x,-(v.co.y-.225)))
# Rebuild the upper tunic continuously from its exact cut boundary to the neck.
cloth=bpy.data.materials.new('Upper tunic wool');cloth.use_nodes=True
cloth.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value=(.026,.019,.013,1)
cloth.node_tree.nodes.get('Principled BSDF').inputs['Roughness'].default_value=.94
body.data.materials.append(cloth)
previous=boundary
for row in range(1,17):
    t=row/16
    ring=[]
    for v in boundary:
        angle=math.atan2(v.co.x-neck_center.x,-(v.co.y-.225))
        target=Vector((neck_center.x+.173*math.sin(angle),.225-.145*math.cos(angle),4.59))
        co=v.co.lerp(target,t);co.z=4.30+.29*math.sin(t*math.pi/2)
        ring.append(bm.verts.new(co))
    for i in range(len(ring)):
        j=(i+1)%len(ring)
        face=bm.faces.new((previous[i],previous[j],ring[j],ring[i]));face.material_index=len(body.data.materials)-1
    previous=ring
bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
bm.to_mesh(body.data); bm.free()
def plain_material(name,color,rough):
    m=bpy.data.materials.new(name);m.use_nodes=True
    s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*color,1);s.inputs['Roughness'].default_value=rough
    body.data.materials.append(m)
    return len(body.data.materials)-1
wool_index=len(body.data.materials)-1
hose_index=plain_material('Muted blue trousers',(.025,.068,.16),.92)
leather_index=plain_material('Worn brown leather shoes',(.12,.052,.023),.78)
skin_index=plain_material('Hand skin',(.40,.27,.20),.72)
for p in body.data.polygons:
    center=sum((body.data.vertices[i].co for i in p.vertices),Vector())/len(p.vertices)
    x,y,z=center
    p.use_smooth=True
    if z<.37:p.material_index=leather_index
    elif abs(x)>.76:
        p.material_index=wool_index if z>2.74-.4*(abs(x)-1.0) else skin_index
    elif z>2.67:p.material_index=wool_index
    else:p.material_index=hose_index
head_file='textured-head-blond-v02.glb' if (ROOT/'source/textured-head-blond-v02.glb').exists() else 'textured-head-v01.glb'
head=load(head_file if textured else 'head-v01.glb','Antigoon_head',.96)
head.location=(neck_center.x,neck_center.y,4.44)
bpy.context.view_layer.update()

# Separate folded cloth collar: close-fitting neck opening, rounded front lobes,
# actual thickness and curved rim; lower outer edge overlaps the tunic opening.
verts=[]; faces=[]
rows=8; columns=64
for i in range(columns+1):
    angle=.045+(2*math.pi-.09)*i/columns
    front=max(0,math.cos(angle))
    for j in range(rows+1):
        t=j/rows
        rx=.178+(.34-.178)*t
        ry=.15+(.40-.15)*t if front>0 else .15+(.255-.15)*t
        x=neck_center.x+rx*math.sin(angle)
        y=.225-ry*math.cos(angle)
        inner_z=4.62-.025*front
        outer_z=4.56-.18*front
        z=inner_z*(1-t)+outer_z*t+.055*math.sin(math.pi*t)
        verts.append((x,y,z))
for i in range(columns):
    for j in range(rows):
        a=i*(rows+1)+j
        faces.append((a,a+1,a+rows+2,a+rows+1))
mesh=bpy.data.meshes.new('Folded collar surface');mesh.from_pydata(verts,[],faces);mesh.update()
collar=bpy.data.objects.new('Rounded folded collar',mesh);bpy.context.collection.objects.link(collar)
bpy.ops.object.select_all(action='DESELECT');collar.select_set(True);bpy.context.view_layer.objects.active=collar
bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.recalc_face_normals(bm,faces=bm.faces);bm.to_mesh(mesh);bm.free()
sub=collar.modifiers.new('Soft cloth fold','SUBSURF');sub.levels=1
bpy.ops.object.modifier_apply(modifier=sub.name)
solid=collar.modifiers.new('Cloth thickness','SOLIDIFY');solid.thickness=.012;solid.offset=0
bpy.ops.object.modifier_apply(modifier=solid.name)
bevel=collar.modifiers.new('Rounded cloth rim','BEVEL');bevel.width=.005;bevel.segments=3
bpy.ops.object.modifier_apply(modifier=bevel.name)
mat=bpy.data.materials.new('Dark folded wool');mat.use_nodes=True
shader=mat.node_tree.nodes.get('Principled BSDF');shader.inputs['Base Color'].default_value=(.029,.022,.015,1);shader.inputs['Roughness'].default_value=.94
collar.data.materials.append(mat)
for p in collar.data.polygons:p.use_smooth=True
for o in [body,head,collar]:
    o.select_set(True)
bpy.context.view_layer.objects.active=body
bpy.ops.object.join()
body.name='Antigoon'
bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source'/('antigoon-'+tag+'-asset.blend')))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'source'/('assembled-'+tag+'.glb')),export_format='GLB',use_selection=True,export_yup=True)
print('ASSEMBLED',tag,'neck',list(neck_center))
