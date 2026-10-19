"""Room fittings: a tavern's open fireplace (#187: the Ankere's, the Schipke's and the Zwarte Kat's, workgoods/hearth.py)
the Vleeshuis's stair up to its theatre floor (#186, workgoods/hallstair.py) and the cathedral's stair and gallery up to
its organ loft (#192, workgoods/cathloft.py), and the carved oak angel and saint before the cathedral's confessional
(#196, workgoods/carving.py). Our own work: every texture is painted
by workgoods/paint.py, nothing downloaded.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \
        -P art-source/tools/blender/build_fittings.py -- --out .scratch/fittings-plain/fittings.glb \
        --shots .scratch/fittings-build/shots [--no-shots]

Writes a plain glTF binary like the work goods' (one material "fittings", one 2048 x 2048 base-colour atlas, the
baked shade in COLOR_0): top-level nodes fireplace_tavern (in the recovered piece's own frame), vleeshuis_stair and
cathedral_loft_stair (each in its hall plan's frame), confessional_angel and confessional_saint (each standing on the
origin, facing +Z), game axes, metres.
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

for mod in ("kit", "paint", "hearth", "hallstair", "cathloft", "carving", "shots", "verify"):
    importlib.reload(importlib.import_module("workgoods." + mod))
from workgoods import carving, cathloft, hallstair, hearth, shots, verify  # noqa: E402

ORDER = ["fireplace_tavern", "vleeshuis_stair", "cathedral_loft_stair", "confessional_angel", "confessional_saint"]
# reach of the occlusion rays (metres) and whether the model stands on the ground
SHADE = {"fireplace_tavern": (0.35, True), "vleeshuis_stair": (0.30, True), "cathedral_loft_stair": (0.30, True),
         "confessional_angel": (0.10, True), "confessional_saint": (0.10, True)}
SIZES = {"fireplace_tavern": (2.40, 2.90, None), "vleeshuis_stair": (15.24, None, None), "cathedral_loft_stair": (None, None, None),
         "confessional_angel": (None, None, None), "confessional_saint": (None, None, None)}
BUILD = {"fireplace_tavern": hearth.fireplace, "vleeshuis_stair": hallstair.stair, "cathedral_loft_stair": cathloft.stair,
         "confessional_angel": carving.angel, "confessional_saint": carving.saint}


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "fittings-plain", "fittings.glb"),
         "shots": os.path.join(ROOT, ".scratch", "fittings-build", "shots"), "only": None, "no_shots": False}
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
    A.region("hearth", 0, 0, 2048, 1536)
    A.region("stair", 0, 1536, 2048, 512)
    return A


def material(img):
    m = bpy.data.materials.new("fittings")
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
        meshes[name] = [BUILD[name](A)]
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    img = A.to_image("fittings", os.path.join(os.path.dirname(o["shots"]), "fittings_atlas.png"))
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
            print("[fittings] %s: %d edges between faces wound against each other" % (name, fl))
        print("[fittings] %-8s %5d triangles" % (name, tr))
    if kit.OVER:
        print("[fittings] UV corners outside their cell:", kit.OVER)
    bpy.ops.export_scene.gltf(
        filepath=o["out"], export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_apply=False, use_selection=False, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
    print("[fittings] -> %s (%d KB)" % (o["out"], os.path.getsize(o["out"]) // 1024))
    verify.SIZES.update(SIZES)
    verify.MATERIAL = "fittings"
    ok = verify.check(o["out"], names)
    if not o["no_shots"]:
        # (close views of the opening and the shelf's end)
        shots.VIEWS.update({"cathedral_loft_stair": [((0.6, -1.0, 0.45), (0.5, 0.5, 0.45), 1.3), ((-0.8, -1.0, 0.5), (0.2, 0.15, 0.85), 0.35),
                                                     ((0.9, 0.4, 0.35), (0.5, 0.5, 0.3), 0.6)],
                            "vleeshuis_stair": [((0.3, -1.0, 0.35), (0.5, 0.5, 0.4), 1.4), ((0.6, -1.0, 0.2), (0.95, 0.5, 0.05), 0.12),
                                                ((0.4, -1.0, 0.5), (0.5, 0.5, 0.5), 0.15)],
                            "confessional_angel": [((0.35, -1.0, 0.15), (0.5, 0.5, 0.5), 1.5), ((0.2, -1.0, 0.05), (0.5, 0.1, 0.86), 0.32),
                                                   ((1.0, 0.6, 0.3), (0.5, 0.6, 0.6), 1.4), ((0.6, -1.0, -0.1), (0.25, 0.1, 0.55), 0.4)],
                            "confessional_saint": [((0.35, -1.0, 0.15), (0.5, 0.5, 0.5), 1.5), ((0.2, -1.0, 0.0), (0.5, 0.15, 0.84), 0.32),
                                                   ((0.6, -1.0, -0.1), (0.5, 0.2, 0.68), 0.45)],
                            "fireplace_tavern": [((0.45, -1.0, 0.35), (0.5, 0.5, 0.45), 1.7), ((0.25, -1.0, 0.2), (0.5, 0.2, 0.2), 0.7),
                                                 ((-0.9, -1.0, 0.25), (0.15, 0.1, 0.45), 0.6)]})
        shots.render_all(built, names, o["shots"], mat)
    print("[fittings] %.0f s" % (time.time() - t0))
    if not ok:
        raise SystemExit("verification failed")
    print("FITTINGS BUILD COMPLETE %d models" % len(names))


if __name__ == "__main__":
    main()
