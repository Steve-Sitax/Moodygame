import bpy
from pathlib import Path
from mathutils import Vector
ROOT=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-procedural.blend'))
o=bpy.data.objects['Antigoon_body_high']
for z in [3.10,3.20,3.30,3.40,3.50]:
    pts=[v.co for v in o.data.vertices if abs(v.co.z-z)<.015 and abs(v.co.x)<.65]
    print('SECTION',z,[(min(p[i] for p in pts),max(p[i] for p in pts)) for i in [0,1]])
    for x in [0,.2,.4]:
        hit,p,n,f=o.ray_cast(Vector((x,-1,z)),Vector((0,1,0)))
        print('FRONT',x,z,hit,list(p))
