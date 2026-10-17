import bpy
from pathlib import Path
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-v13-highres-keeper-fit-game.blend'))
for o in bpy.context.scene.objects:
 if o.type=='MESH':
  print(o.name,'smooth',sum(p.use_smooth for p in o.data.polygons),len(o.data.polygons),flush=True)
  for m in o.data.materials:
   print(m.name,[(n.type,n.image.filepath if n.type=='TEX_IMAGE' and n.image else '') for n in m.node_tree.nodes],flush=True)
with bpy.data.libraries.load(str(R/'source/antigoon-v13-highres-keeper-fit-asset.blend')) as (data,to):print('SOURCE MATERIALS',data.materials,flush=True)
