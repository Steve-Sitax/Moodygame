"""Keep the dense master and export a lighter close-view mesh with the same 4K maps."""
import bpy,json
from pathlib import Path
ROOT=Path(__file__).resolve().parent
bpy.ops.wm.open_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-asset.blend'))
report={'rigged':False,'texture_resolution':4096,'objects':[]}
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH':continue
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    dec=obj.modifiers.new('Close-view export density','DECIMATE')
    dec.ratio=.25 if 'head' in obj.name else .40
    bpy.ops.object.modifier_apply(modifier=dec.name)
    report['objects'].append({'name':obj.name,'triangles':sum(len(p.vertices)-2 for p in obj.data.polygons)})
bpy.ops.object.select_all(action='SELECT')
bpy.ops.wm.save_as_mainfile(filepath=str(ROOT/'source/antigoon-v09-highres-game.blend'))
bpy.ops.export_scene.gltf(filepath=str(ROOT/'source/assembled-v09-highres-game.glb'),export_format='GLB',use_selection=True,export_yup=True)
report['triangles']=sum(o['triangles'] for o in report['objects'])
(ROOT/'source/mesh-v09-highres-game.json').write_text(json.dumps(report,indent=2))
print('HIGHRES_GAME_EXPORT',json.dumps(report))
