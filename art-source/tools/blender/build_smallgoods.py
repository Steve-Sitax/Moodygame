"""Small goods (#180): the fish market's cod and plaice (beside the work goods' herring) and the emigrant mothers'
swaddled baby. Our own work: every texture is painted by workgoods/paint.py, nothing downloaded.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \\
        -P art-source/tools/blender/build_smallgoods.py -- --out .scratch/smallgoods-plain/smallgoods.glb \\
        --shots .scratch/smallgoods-build/shots [--only cod,plaice] [--no-shots]

Writes a plain glTF binary like the work goods' (one material "smallgoods", one 2048 x 2048 base-colour atlas,
metallic 0, roughness 1, no normal map, the baked shade and occlusion in COLOR_0). Each model is a top-level node
at the origin, in game axes (+Y up), real scale in metres:

  cod      a 52 cm cod, its middle at the origin, head +X, back +Y (as held_fish)
  plaice   a 31 cm plaice, eyed side up (+Y), head +X, its middle at the origin
  baby     a swaddled infant, the bundle's middle at the origin, lying along +Z with the head at +Z, face up
"""

import importlib
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import workgoods  # noqa: E402,F401
from workgoods import kit  # noqa: E402

for mod in ("kit", "paint", "catch", "infant", "shots", "verify"):
    importlib.reload(importlib.import_module("workgoods." + mod))
from workgoods import catch, infant, shots, verify  # noqa: E402

ORDER = ["cod", "plaice", "baby"]
# reach of the occlusion rays (metres) and whether the model stands on the ground
SHADE = {"cod": (0.04, False), "plaice": (0.03, False), "baby": (0.06, False)}
SIZES = {"cod": (0.52, None, None), "plaice": (0.354, None, None), "baby": (None, None, 0.475)}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "smallgoods-plain", "smallgoods.glb"),
         "shots": os.path.join(ROOT, ".scratch", "smallgoods-build", "shots"), "only": None, "no_shots": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a in ("--out", "--shots"):
            o[a[2:]] = argv[i + 1]
            i += 1
        elif a == "--only":
            o["only"] = argv[i + 1].split(",")
            i += 1
        elif a == "--no-shots":
            o["no_shots"] = True
        i += 1
    for k in ("out", "shots"):
        if not os.path.isabs(o[k]):
            o[k] = os.path.join(ROOT, o[k])
    return o


def atlas():
    A = kit.Atlas(kit.SIZE)
    A.region("catch", 0, 0, 2048, 1024)
    A.region("infant", 0, 1024, 2048, 1024)
    return A


def material(img):
    m = bpy.data.materials.new("smallgoods")
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
    A = atlas()
    names = [n for n in ORDER if o["only"] is None or n in o["only"]]
    meshes = {}
    for name in names:
        meshes[name] = [catch.cod(A) if name == "cod" else catch.plaice(A) if name == "plaice" else infant.baby(A)]
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    img = A.to_image("smallgoods", os.path.join(os.path.dirname(o["shots"]), "smallgoods_atlas.png"))
    mat = material(img)
    built = {}
    for name in names:
        obs = [m.build(mat) for m in meshes[name]]
        built[name] = (obs[0], obs)
    bpy.context.view_layer.update()
    for name in names:
        reach, ground = SHADE[name]
        kit.bake_shade(built[name][1], ground=ground, reach=reach)
    for name in names:
        tr = sum(kit.tris_of(ob) for ob in built[name][1])
        fl = sum(kit.flipped_edges(ob) for ob in built[name][1])
        if fl:
            print("[smallgoods] %s: %d edges between faces wound against each other" % (name, fl))
        print("[smallgoods] %-8s %5d triangles" % (name, tr))
    if kit.OVER:
        print("[smallgoods] UV corners outside their cell:", kit.OVER)
    bpy.ops.export_scene.gltf(
        filepath=o["out"], export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_apply=False, use_selection=False, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
    print("[smallgoods] -> %s (%d KB)" % (o["out"], os.path.getsize(o["out"]) // 1024))
    verify.SIZES.update(SIZES)
    verify.MATERIAL = "smallgoods"
    ok = verify.check(o["out"], names)
    if not o["no_shots"]:
        # (their middles are at the origin: lift them clear of the pictures' ground)
        shots.LIFT.update({"cod": 0.06, "plaice": 0.02, "baby": 0.10})
        shots.VIEWS.update({"baby": [((0.75, -1.0, 0.62), (0.5, 0.5, 0.45), 3.0), ((0.2, -1.0, 0.7), (0.5, 0.05, 0.6), 1.2)],
                            "cod": [((0.3, -1.0, 0.45), (0.5, 0.5, 0.5), 3.0), ((0.5, -1.0, 0.15), (0.85, 0.3, 0.5), 1.0)],
                            "plaice": [((0.5, -1.0, 0.8), (0.5, 0.5, 0.5), 3.0), ((0.7, -1.0, 0.25), (0.85, 0.5, 0.5), 1.0)]})
        shots.render_all(built, names, o["shots"], mat)
    print("[smallgoods] %.0f s" % (time.time() - t0))
    if not ok:
        raise SystemExit("verification failed")
    print("SMALLGOODS BUILD COMPLETE %d models" % len(names))


if __name__ == "__main__":
    main()
