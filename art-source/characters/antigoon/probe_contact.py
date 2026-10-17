import bpy,json
from pathlib import Path
root=Path(r'D:/Code/MoodyGame/art-source/characters/antigoon')
bpy.ops.wm.open_mainfile(filepath=str(root/'source/antigoon-playable.blend'))
rig=bpy.data.objects['AntigoonRig'];body=bpy.data.objects['Antigoon_body_high']
scene=bpy.context.scene;scene.frame_set(0)
result={}
for side,sign in [('L',1),('R',-1)]:
 pts=[body.matrix_world@v.co for v in body.data.vertices if sign*v.co.x>0 and v.co.z<.65]
 result[side]={'minimum_z':min(v.z for v in pts),'maximum_z':max(v.z for v in pts),'count':len(pts)}
for b in ['root','thigh.L','shin.L','foot.L','toe.L','thigh.R','shin.R','foot.R','toe.R']:
 result[b]={'head':list(rig.data.bones[b].head_local),'tail':list(rig.data.bones[b].tail_local)}
(root/'logs/feet-analysis.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result),flush=True)
