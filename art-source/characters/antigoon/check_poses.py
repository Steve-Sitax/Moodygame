import bpy,json
from pathlib import Path
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-playable.blend'))
rig=bpy.data.objects['AntigoonRig']
for tr in rig.animation_data.nla_tracks:tr.mute=True
for name,frames in [('attack',[0,10,15,19,25,40]),('death',[0,33,66])]:
 rig.animation_data.action=bpy.data.actions[name]
 for f in frames:
  bpy.context.scene.frame_set(f)
  print(name,f,{n:[round(v,3) for v in rig.pose.bones[n].head] for n in ['hand.R','head','foot.L','pelvis']},flush=True)
