"""The hiring board on the Rijnkaai (#153): a better model at our detail level. Our own work.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \
        -P art-source/tools/blender/build_workboard.py -- --out .scratch/workboard-plain/workboard.glb \
        --shots .scratch/workboard-build/shots [--no-shots]

Writes a plain glTF binary like the work goods (one material "workboard": one 2048 x 2048 base-colour atlas,
metallic 0, roughness 1, no normal map; the baked occlusion in COLOR_0). One top-level node, hiring_board, at the
origin on the ground under the middle of the board, game axes (+Y up, its face toward +Z), metres. Its extras give
the face's z and the eight places where the game pins the notes.
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

for mod in ("workgoods.kit", "workgoods.paint", "workgoods.shots", "benches.models", "benches.board"):
    importlib.reload(importlib.import_module(mod))
from benches import board  # noqa: E402

ORDER = ["hiring_board"]


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "workboard-plain", "workboard.glb"),
         "shots": os.path.join(ROOT, ".scratch", "workboard-build", "shots"), "no_shots": False}
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
    m = bpy.data.materials.new("workboard")
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
    A.region("board", 0, 0, 2048, 2048)
    meshes = {"hiring_board": board.build(A, "board")}
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    img = A.to_image("workboard", os.path.join(os.path.dirname(o["shots"]), "workboard_atlas.png"))
    mat = material(img)
    built = {}
    for name in ORDER:
        ob = meshes[name].build(mat)
        for k, v in board.EXTRAS.items():
            ob[k] = v
        built[name] = (ob, [ob])
    bpy.context.view_layer.update()
    for name in ORDER:
        kit.bake_shade(built[name][1], ground=True, reach=0.20)
    for name in ORDER:
        ob = built[name][0]
        fl = kit.flipped_edges(ob)
        print("[workboard] %-17s %6d triangles%s" % (name, kit.tris_of(ob), "" if not fl else "  (%d edges wound against each other)" % fl))
    if kit.OVER:
        print("[workboard] UV corners outside their cell:", kit.OVER)
    bpy.ops.export_scene.gltf(
        filepath=o["out"], export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_apply=False, use_selection=False, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
    print("[workboard] -> %s (%d KB)" % (o["out"], os.path.getsize(o["out"]) // 1024))
    if not o["no_shots"]:
        # a straight look at the face from a step away, and the header under its roof
        shots.VIEWS["hiring_board"] = [((0.0, -1.0, 0.12), (0.5, 0.5, 0.62), 1.9), ((0.35, -1.0, -0.05), (0.5, 0.5, 0.90), 0.75),
                                       ((0.75, -1.0, 0.62), (0.5, 0.5, 0.45), 3.0), ((-0.6, 1.0, 0.3), (0.5, 0.5, 0.5), 2.6)]
        shots.render_all(built, ORDER, o["shots"], mat)
    print("[workboard] %.0f s" % (time.time() - t0))
    print("WORKBOARD BUILD COMPLETE %d models" % len(ORDER))


if __name__ == "__main__":
    main()
