import bpy
from pathlib import Path
R=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(R/'source/antigoon-playable.blend'))
r=bpy.data.objects['AntigoonRig'];h=bpy.data.objects['Antigoon_head_high']
for o in bpy.context.scene.objects:
 for data in [o,o.data.shape_keys if o.type=='MESH' else None]:
  if data and data.animation_data:
   for tr in data.animation_data.nla_tracks:tr.mute=True
for name in ['idle','laugh']:
 r.animation_data.action=bpy.data.actions[name]
 h.data.shape_keys.animation_data.action=bpy.data.actions[h.name+'_'+name]
 bpy.context.scene.frame_set(9)
 ev=h.evaluated_get(bpy.context.evaluated_depsgraph_get())
 print(name,'BOUNDS',[(min(v.co[i] for v in ev.data.vertices),max(v.co[i] for v in ev.data.vertices)) for i in range(3)])
 print('KEYS',[(k.name,k.value, max((k.data[i].co-h.data.shape_keys.key_blocks[0].data[i].co).length for i in range(len(k.data)))) for k in h.data.shape_keys.key_blocks])
 print('BONES',[(p.name,list(p.location),list(p.rotation_euler)) for p in r.pose.bones if p.name in ['root','pelvis','neck','head']])
