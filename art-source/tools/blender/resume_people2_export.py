"""Resume only export from PEOPLE2_SAVE_BLEND after a bounded full build.

blender -b .scratch/batch2-build/people.blend --disable-autoexec --python-exit-code 1
    -P art-source/tools/blender/resume_people2_export.py -- --plain .scratch/people2-plain/people2.glb
Anatomy, clothes, pictures, rig metadata and the shared clip bank are already built.
"""
import json
import sys
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from people2 import export, glb_animations, glb_slim
import split_people2

args = sys.argv[sys.argv.index('--')+1:]
plain = Path(args[args.index('--plain')+1]).resolve()
workspace = Path(__file__).resolve().parents[3]
if not plain.is_relative_to(workspace / '.scratch'):
    raise ValueError('Dense input must remain in this worktree\'s .scratch.')
material = bpy.data.materials['people2_atlas']
for ob in bpy.data.objects:
    if ob.type != 'MESH':
        continue
    for vg in list(ob.vertex_groups):
        if vg.name.startswith(('part_', 'zone_')) and vg.name != 'part_hair':
            ob.vertex_groups.remove(vg)
    if ob.name.startswith('held_'):
        ob.data.materials.clear()
        ob.data.materials.append(material)
for mt in list(bpy.data.materials):
    if mt != material and mt.users == 0:
        bpy.data.materials.remove(mt)
rig = json.loads((workspace / 'art-source/shared/peopleRig.json').read_text())
thin = set(rig['idles']['clips']) | set(rig['work']['clips'])
animation_source = args[args.index('--animations')+1] if '--animations' in args else None
if animation_source:
    old = json.loads((Path(animation_source).parent / 'animation-metadata.json').read_text())
    if not all(old[k] for k in ('bodies', 'clips', 'locomotion', 'idles', 'work', 'heightFactor', 'oldStance')):
        raise RuntimeError('Reference clips require unchanged bodies and motion metadata.')
split_people2.main(animation_source=animation_source)
export.export_glb(str(plain), plain=True, animations=False)
core = workspace / 'art-source/client/public/models/people2.glb'
copied = glb_animations.copy_into(str(plain), str(core))
if set(copied) != set(rig['clips']):
    raise RuntimeError('Resumed native export lost a shared clip.')
glb_slim.slim(str(plain), thin=thin)
print('RESUMED EXPORT COMPLETE', len(rig['bodies']), len(rig['kinds']), len(copied))
