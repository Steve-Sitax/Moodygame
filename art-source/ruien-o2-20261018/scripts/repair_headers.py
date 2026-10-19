"""Export corrected reusable egg-drain headers from an original O2 blend, without rebuilding the masonry.
blender --background <original.blend> --python scripts/repair_headers.py -- --out <directory>
The full builder uses the same radial dimensions in rlib/gfeat.py.
"""
import bpy, sys, os, json, numpy as np
from mathutils import Vector
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import export_game as E
E.TEXD=os.path.join(os.path.dirname(bpy.data.filepath),'export','textures')
args = sys.argv[sys.argv.index('--') + 1:]
out = args[args.index('--out') + 1]
os.makedirs(out, exist_ok=True)
from rlib import gallery as G, gfeat as GF, drain_headers
import spec
coll = bpy.data.collections.new('REPAIRED_HEADERS'); bpy.context.scene.collection.children.link(coll)
obs=[]
for du,side in GF.DRAINS[1:]:  # the first mouth is now the keeper stair landing
    obs.extend(drain_headers.build(G.Path(spec.GAL_PATH_KEYS),du,side,GF.DRAIN_YB,bpy.data.materials['Brick_rib_side'],coll))
from types import SimpleNamespace
path=G.Path(spec.GAL_PATH_KEYS)
shaft=GF.shaft(SimpleNamespace(path=path,shaft_u=path.u_at_z(GF.SHAFT_Z)),
    {'iron':bpy.data.materials['Iron_cast'],'brick_vault':bpy.data.materials['Brick_gallery_vault'],'paving':bpy.data.materials['Paving_setts']},coll)
obs.extend(o for o in shaft if o.name.startswith(('ladder_','step_iron')))
drive=GF.penstock(SimpleNamespace(path=path),{'iron':bpy.data.materials['Iron_cast'],'wood':bpy.data.materials['Wood_debris']},coll)
obs.extend(o for o in drive if o.name.startswith('keeper_'))
E.setup_render()
baked = E.build_lod(0, obs)
manifest = {'files': {}}
E.export_chunks(baked, lambda p: __import__('numpy').full(len(p), 'headers'), lambda k: k, 0, out, 'ruien_o2_', manifest)
json.dump(manifest, open(os.path.join(out, 'manifest.json'), 'w'), indent=1)
