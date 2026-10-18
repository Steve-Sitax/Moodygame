"""Work goods: things people work with and carry (the knife and herring in a fishwife's hands, a building site's
crab winch, an emigrant's trunk, bundle, rolled featherbed and wicker hamper, a wash tub, a stack of dried hides,
a brown-paper parcel). Our own work: every texture is painted by workgoods/paint.py, nothing downloaded.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \\
        -P art-source/tools/blender/build_workgoods.py -- --out .scratch/workgoods-plain/workgoods.glb \\
        --shots .scratch/workgoods-build/shots [--only trunk,tub] [--no-shots]

Writes a plain glTF binary (no Draco, no sparse accessors, the atlas embedded as PNG): one material "workgoods"
(one 2048 x 2048 base-colour atlas, metallic 0, roughness 1, no normal map), the baked shade and occlusion in
COLOR_0. Each model is a top-level node at the origin, in game axes (+Y up, its front toward +Z), real scale in
metres:

  held_knife   grip at the origin, handle and blade along +Y, edge toward -Z (people2's held frame)
  held_fish    a herring, its middle at the origin, head +X, back +Y
  crab_winch   an empty on the ground; children winch_frame, winch_drum (origin on the drum axle), winch_crank
               (origin on the crank axle at (0, 1.02, 0)); both turn about their local X; extras give the axles,
               the crank radius, the gear ratio and where the rope leaves the drum
  trunk, bundle, featherbed, basket, tub, hides, parcel   origin at the middle of the base
  ledger_open  a clerk's open account book lying flat, pages up (+Y): the right page's centre at the origin, the
               spine at x = +0.115, the left page toward +X, the pages' 0.30 m along Z (their tops toward +Z)

Pictures of every model (a 3/4 view and a close low view of an edge) and a sheet of all of them beside a 1.75 m
figure go to --shots.
"""

import importlib
import math
import os
import sys
import time

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

import workgoods  # noqa: E402
from workgoods import kit  # noqa: E402

for mod in ("kit", "paint", "small", "winch", "luggage", "goods", "shots", "verify"):
    importlib.reload(importlib.import_module("workgoods." + mod))
from workgoods import goods, luggage, shots, small, verify, winch  # noqa: E402

ORDER = ["held_knife", "held_fish", "crab_winch", "trunk", "bundle", "featherbed", "basket", "tub", "hides", "parcel", "ledger_open"]
# reach of the occlusion rays (metres) and whether the model stands on the ground
SHADE = {"held_knife": (0.02, False), "held_fish": (0.03, False), "crab_winch": (0.20, True), "trunk": (0.12, True),
         "bundle": (0.14, True), "featherbed": (0.14, True), "basket": (0.08, True), "tub": (0.14, True),
         "hides": (0.10, True), "parcel": (0.06, True),
         "ledger_open": (0.03, True)}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "workgoods-plain", "workgoods.glb"),
         "shots": os.path.join(ROOT, ".scratch", "workgoods-build", "shots"), "only": None, "no_shots": False}
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--out":
            o["out"] = argv[i + 1]
            i += 1
        elif a == "--shots":
            o["shots"] = argv[i + 1]
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
    A.region("trunk", 0, 0, 1024, 640)
    A.region("featherbed", 1024, 0, 1024, 640)
    A.region("winch", 0, 640, 1024, 704)
    A.region("bundle", 1024, 640, 512, 704)
    A.region("hides", 1536, 640, 512, 704)
    A.region("tub", 0, 1344, 512, 704)
    A.region("basket", 512, 1344, 512, 704)
    A.region("parcel", 1024, 1344, 512, 352)
    A.region("ledger", 1024, 1696, 512, 352)
    A.region("small", 1536, 1344, 512, 704)
    return A


def material(img):
    m = bpy.data.materials.new("workgoods")
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
    built = {}  # name -> (top object, [mesh objects])
    meshes = {}
    for name in names:
        if name == "held_knife":
            meshes[name] = [small.knife(A)]
        elif name == "held_fish":
            meshes[name] = [small.fish(A)]
        elif name == "crab_winch":
            meshes[name] = list(winch.build(A))
        elif name in ("trunk", "bundle", "featherbed", "basket"):
            meshes[name] = [getattr(luggage, name)(A)]
        elif name == "ledger_open":
            meshes[name] = [goods.ledger(A)]
        else:
            meshes[name] = [getattr(goods, name)(A)]
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    img = A.to_image("workgoods", os.path.join(os.path.dirname(o["shots"]), "workgoods_atlas.png"))
    mat = material(img)
    for name in names:
        obs = [m.build(mat) for m in meshes[name]]
        if name == "crab_winch":
            root = bpy.data.objects.new("crab_winch", None)
            bpy.context.scene.collection.objects.link(root)
            fr, dr, cr = obs
            for ob in obs:
                ob.parent = root
            dr.location = kit.G(*winch.DRUM)
            cr.location = kit.G(*winch.CRANK)
            for k, v in winch.extras().items():
                root[k] = v
            bpy.context.view_layer.update()
        else:
            root = obs[0]
        built[name] = (root, obs)
    bpy.context.view_layer.update()
    for name in names:
        reach, ground = SHADE[name]
        kit.bake_shade(built[name][1], ground=ground, reach=reach)
    report = {}
    for name in names:
        tr = sum(kit.tris_of(ob) for ob in built[name][1])
        report[name] = tr
        fl = sum(kit.flipped_edges(ob) for ob in built[name][1])
        if fl:
            print("[workgoods] %s: %d edges between faces wound against each other" % (name, fl))
        print("[workgoods] %-12s %5d triangles%s" % (name, tr, "" if len(built[name][1]) == 1 else
              "  (" + ", ".join("%s %d" % (ob.name, kit.tris_of(ob)) for ob in built[name][1]) + ")"))
    if kit.OVER:
        print("[workgoods] UV corners outside their cell:", kit.OVER)
    bpy.ops.export_scene.gltf(
        filepath=o["out"], export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_apply=False, use_selection=False, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
    print("[workgoods] -> %s (%d KB)" % (o["out"], os.path.getsize(o["out"]) // 1024))
    ok = verify.check(o["out"], names)
    if not o["no_shots"]:
        shots.render_all(built, names, o["shots"], mat)
    print("[workgoods] %.0f s" % (time.time() - t0))
    if not ok:
        raise SystemExit("verification failed")
    print("WORKGOODS BUILD COMPLETE %d models" % len(names))


if __name__ == "__main__":
    main()
