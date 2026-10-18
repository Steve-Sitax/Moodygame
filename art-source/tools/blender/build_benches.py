"""Street benches (#165): the cast-iron park bench and the plank bench, each fine and worn. Our own work.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \\
        -P art-source/tools/blender/build_benches.py -- --out .scratch/benches-plain/benches.glb \\
        --shots .scratch/benches-build/shots [--no-shots]

Writes a plain glTF binary like the work goods (one material "benches": one 2048 x 2048 base-colour atlas, metallic
0, roughness 1, no normal map; the baked occlusion in COLOR_0). Top-level nodes, each at the origin on the ground
under the middle of its seat, game axes (+Y up, the sitter's knees toward +Z), metres:

  bench_park_fine   cast-iron ends in fresh green paint, varnished oak slats (good quarters, parks)
  bench_park_worn   the same shape: paint flaking to rust, silvered slats, the middle back slat gone, initials cut
  bench_plank_fine  oak planks on square legs, black iron straps (quays, stops, church fronts)
  bench_plank_worn  the same shape: grey weathered pine with old paint, rusted straps, the lower back plank gone

Each node's extras give seat_y, length, depth, height and two sitting places.
"""

import importlib
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

from workgoods import kit, shots  # noqa: E402

for mod in ("workgoods.kit", "workgoods.paint", "workgoods.shots", "benches.models"):
    importlib.reload(importlib.import_module(mod))
from benches import models  # noqa: E402

ORDER = ["bench_park_fine", "bench_park_worn", "bench_plank_fine", "bench_plank_worn"]


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "benches-plain", "benches.glb"),
         "shots": os.path.join(ROOT, ".scratch", "benches-build", "shots"), "no_shots": False}
    i = 0
    while i < len(argv):
        if argv[i] in ("--out", "--shots"):
            o[argv[i][2:]] = argv[i + 1]
            i += 1
        elif argv[i] == "--no-shots":
            o["no_shots"] = True
        i += 1
    for k in ("out", "shots"):
        if not os.path.isabs(o[k]):
            o[k] = os.path.join(ROOT, o[k])
    return o


def material(img):
    m = bpy.data.materials.new("benches")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Linear"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    return m


def main():
    t0 = time.time()
    o = args()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit.OVER.clear()
    A = kit.Atlas(kit.SIZE)
    A.region("park_fine", 0, 0, 1024, 1024)
    A.region("park_worn", 1024, 0, 1024, 1024)
    A.region("plank_fine", 0, 1024, 1024, 1024)
    A.region("plank_worn", 1024, 1024, 1024, 1024)
    meshes = {
        "bench_park_fine": models.park(A, "park_fine", False),
        "bench_park_worn": models.park(A, "park_worn", True),
        "bench_plank_fine": models.plank(A, "plank_fine", False),
        "bench_plank_worn": models.plank(A, "plank_worn", True),
    }
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    img = A.to_image("benches", os.path.join(os.path.dirname(o["shots"]), "benches_atlas.png"))
    mat = material(img)
    built = {}
    for name in ORDER:
        ob = meshes[name].build(mat)
        kind = "park" if "park" in name else "plank"
        for k, v in models.EXTRAS[kind].items():
            ob[k] = v
        ob["finish"] = "worn" if name.endswith("worn") else "fine"
        built[name] = (ob, [ob])
    bpy.context.view_layer.update()
    for name in ORDER:
        kit.bake_shade(built[name][1], ground=True, reach=0.16)
    for name in ORDER:
        ob = built[name][0]
        fl = kit.flipped_edges(ob)
        print("[benches] %-17s %6d triangles%s" % (name, kit.tris_of(ob), "" if not fl else "  (%d edges wound against each other)" % fl))
    if kit.OVER:
        print("[benches] UV corners outside their cell:", kit.OVER)
    bpy.ops.export_scene.gltf(
        filepath=o["out"], export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_apply=False, use_selection=False, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
    print("[benches] -> %s (%d KB)" % (o["out"], os.path.getsize(o["out"]) // 1024))
    if not o["no_shots"]:
        shots.render_all(built, ORDER, o["shots"], mat)
    print("[benches] %.0f s" % (time.time() - t0))
    print("BENCHES BUILD COMPLETE %d models" % len(ORDER))


if __name__ == "__main__":
    main()
