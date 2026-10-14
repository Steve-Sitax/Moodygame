"""Export git-sized parts from the saved, already-built people2 scene; never rebuild anatomy or paint.

blender -b .scratch/batch1-people.blend --disable-autoexec -P art-source/tools/blender/split_people2.py
The plain full intake remains in .scratch. Only the core part carries the shared clips.
"""
import json
import sys
import shutil
from pathlib import Path

import bpy

sys.path.insert(0, str(Path(__file__).resolve().parent))
from people2 import export, glb_slim, face_types, glb_animations

def main(animation_source=None):
    destination = Path(__file__).resolve().parents[2] / 'client/public/models'
    rig_data = json.loads((Path(__file__).resolve().parents[2] / 'shared/peopleRig.json').read_text())
    thin = set(rig_data['idles']['clips']) | set(rig_data['work']['clips'])
    roots = [o for o in bpy.data.objects if o.type == 'ARMATURE' or o.name == 'people2_held']
    index = {}
    groups = {}
    for root in roots:
        if root.name not in ('man_middling', 'people2_held'):
            group = rig_data['kinds'].get(root.name, {}).get('group')
            key = group or root.name
            groups.setdefault(key, []).append(root)
    batches = [('people2', [bpy.data.objects['man_middling']])]
    for group, members in groups.items():
        for i in range(0, len(members), 3):
            suffix = str(i // 3 + 1) if group in {k['group'] for k in rig_data['kinds'].values()} else ''
            batches.append(('people2_' + group + suffix, members[i:i+3]))
    for name, members in batches:
        bpy.ops.object.select_all(action='DESELECT')
        for root in members:
            for o in [root, *root.children_recursive]:
                o.select_set(True)
        core = name == 'people2'
        if core:
            held = bpy.data.objects.get('people2_held')
            if held:
                for o in [held, *held.children_recursive]:
                    o.select_set(True)
        path = destination / (name + '.glb')
        export.export_glb(str(path), selected=True, animations=core and animation_source is None)
        if core and animation_source is not None:
            glb_animations.copy_into(str(path), str(animation_source))
        glb_slim.slim(str(path), thin=thin if core and animation_source is None else None)
        if path.stat().st_size >= 20_000_000:
            raise RuntimeError('People part exceeds 20 MB: ' + name)
        for root in members:
            index[root.name] = {'part': name, 'bytes': path.stat().st_size}
        print('PEOPLE PART', name, path.stat().st_size)
    (destination / 'people2_parts.json').write_text(json.dumps(index, indent=2) + '\n')
    active = {row['part'] + '.glb' for row in index.values()}
    backup = Path(__file__).resolve().parents[3] / '.scratch/people2-previous-parts'
    for path in destination.glob('people2_*.glb'):
        if path.name not in active:
            backup.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup / path.name)
            path.unlink()
    # Refresh reference vectors after the age-safe bald selector repair, without repainting or rebuilding.
    faces = Path(__file__).resolve().parents[2] / 'shared/faceTypes.json'
    face_types.to_json(str(faces), json.loads(faces.read_text())['cells'])


if __name__ == "__main__":
    main()
