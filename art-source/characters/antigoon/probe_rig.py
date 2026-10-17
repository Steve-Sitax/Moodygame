import bpy
from pathlib import Path
from mathutils import Vector
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-v13-highres-keeper-fit-game.blend'))
for o in bpy.context.scene.objects:
 if o.type!='MESH':continue
 print('MESH',o.name,len(o.data.vertices),list(o.location),[(min(v.co[i] for v in o.data.vertices),max(v.co[i] for v in o.data.vertices)) for i in range(3)])
h=bpy.data.objects['Antigoon_head_high']
for z in [4.72,4.76,4.80,4.84,4.88,4.92,4.96,5.00,5.04,5.08]:
 print('HEAD_ROW',z,[(x,list(h.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))[1])) for x in [-.13,-.08,0,.08,.13]])
b=bpy.data.objects['Antigoon_body_high']
for z in [.3,.8,1.4,1.8,2.3,2.7,3.0,3.4,3.9,4.15]:
 pts=[v.co for v in b.data.vertices if abs(v.co.z-z)<.01 and v.co.x>0]
 print('BODY_ROW',z,[(min(p[i] for p in pts),max(p[i] for p in pts)) for i in range(2)])
