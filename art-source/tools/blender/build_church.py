"""The cathedral's furniture (#198, workgoods/church.py): the confessional, the pulpit and the side altars' fittings.
Our own work: every texture is painted by workgoods/paint.py and church.py, nothing downloaded.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \
        -P art-source/tools/blender/build_church.py -- --out .scratch/church-plain/church.glb \
        --shots .scratch/church-build/shots [--no-shots] [--only confessional,pulpit]

Writes a plain glTF binary like the fittings' (one material "church", one 2048 x 2048 base-colour atlas, the baked
shade in COLOR_0): top-level nodes confessional, pulpit, altar_frame, altar_capital, altar_crown, altar_dressing,
altar_saint and altar_marble, each standing on its origin facing game +Z (church.py says where each origin is), game
axes, metres.
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

for mod in ("kit", "paint", "hallstair", "carving", "church", "shots", "verify"):
    importlib.reload(importlib.import_module("workgoods." + mod))
from workgoods import church, shots, verify  # noqa: E402

ORDER = ["confessional", "pulpit", "pulpit_dove", "pulpit_urn", "altar_frame", "altar_capital", "altar_crown", "altar_dressing", "altar_cloth", "altar_saint", "altar_marble", "lamp_stand"]
# reach of the occlusion rays (metres) and whether the model stands on the ground
SHADE = {"confessional": (0.30, True), "pulpit": (0.30, True), "pulpit_dove": (0.05, False), "pulpit_urn": (0.06, True), "altar_cloth": (0.08, False), "lamp_stand": (0.05, False), "altar_frame": (0.12, False), "altar_capital": (0.06, False),
         "altar_crown": (0.10, False), "altar_dressing": (0.10, False), "altar_saint": (0.10, True), "altar_marble": (0.30, True)}
SIZES = {"confessional": (None, None, None), "pulpit": (None, None, None), "pulpit_dove": (None, None, None), "pulpit_urn": (None, None, None),
         "altar_cloth": (None, None, None), "lamp_stand": (None, None, None), "altar_frame": (None, None, None), "altar_capital": (None, None, None),
         "altar_crown": (None, None, None), "altar_dressing": (None, None, None), "altar_saint": (None, 1.49, None), "altar_marble": (None, None, None)}
GROUNDED = {"confessional", "pulpit", "altar_saint", "altar_marble"}


def build(name, A):
    out = [getattr(church, name)(A)]
    if hasattr(church, name + "_hull"):
        out.append(getattr(church, name + "_hull")(A))
    return out


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "church-plain", "church.glb"),
         "shots": os.path.join(ROOT, ".scratch", "church-build", "shots"), "only": None, "no_shots": False}
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


def material(img):
    m = bpy.data.materials.new("church")
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
    names = [n for n in ORDER if (o["only"] is None or n in o["only"]) and hasattr(church, n)]
    meshes = {name: build(name, A) for name in names}
    os.makedirs(os.path.dirname(o["out"]), exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    img = A.to_image("church", os.path.join(os.path.dirname(o["shots"]), "church_atlas.png"))
    mat = material(img)
    built = {}
    hulls = {}
    for name in names:
        obs = [m.build(mat) for m in meshes[name]]
        for ob in obs[1:]:
            # the collision hull: a child of the model, hidden in the pictures
            ob.parent = obs[0]
            ob.hide_render = True
        built[name] = (obs[0], obs[:1])
        hulls[name] = obs[1:]
    bpy.context.view_layer.update()
    for name in names:
        reach, ground = SHADE[name]
        kit.bake_shade(built[name][1], ground=ground, reach=reach)
        if hulls[name]:
            kit.bake_shade(hulls[name], ground=False, reach=0.01)
    for name in names:
        tr = sum(kit.tris_of(ob) for ob in built[name][1])
        fl = sum(kit.flipped_edges(ob) for ob in built[name][1])
        if fl:
            print("[church] %s: %d edges between faces wound against each other" % (name, fl))
        print("[church] %-14s %6d triangles" % (name, tr))
    if kit.OVER:
        print("[church] UV corners outside their cell:", kit.OVER)
    bpy.ops.export_scene.gltf(
        filepath=o["out"], export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
        export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
        export_apply=False, use_selection=False, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
        export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
    print("[church] -> %s (%d KB)" % (o["out"], os.path.getsize(o["out"]) // 1024))
    verify.SIZES.update(SIZES)
    verify.MATERIAL = "church"
    verify.GROUNDED = GROUNDED
    ok = verify.check(o["out"], names)
    if not o["no_shots"]:
        shots.VIEWS.update({
            "confessional": [((0.45, -1.0, 0.25), (0.5, 0.5, 0.5), 1.25), ((0.2, -1.0, 0.1), (0.5, 0.2, 0.55), 0.45),
                             ((0.35, -1.0, 0.05), (0.62, 0.15, 0.15), 0.32), ((0.3, -1.0, 0.2), (0.5, 0.2, 0.68), 0.34),
                             ((1.0, -0.5, 0.15), (0.95, 0.4, 0.4), 0.55), ((0.0, -1.0, 0.0), (0.5, 0.5, 0.88), 0.30)],
            "pulpit": [((0.6, -1.0, 0.25), (0.5, 0.5, 0.5), 1.3), ((-1.0, -0.5, 0.2), (0.3, 0.5, 0.3), 0.7), ((0.3, -1.0, 0.0), (0.5, 0.3, 0.45), 0.35),
                       ((0.5, -1.0, -0.3), (0.5, 0.5, 0.72), 0.45)],
            "altar_frame": [((0.3, -1.0, 0.1), (0.5, 0.5, 0.5), 1.4), ((0.6, -1.0, 0.2), (0.95, 0.5, 0.95), 0.25)],
            "altar_dressing": [((0.4, -1.0, 0.3), (0.5, 0.5, 0.5), 1.5), ((0.3, -1.0, 0.1), (0.5, 0.5, 0.8), 0.25)],
            "lamp_stand": [((0.6, -1.0, 0.2), (0.5, 0.5, 0.5), 1.4), ((0.5, -1.0, 0.1), (0.5, 0.5, 0.9), 0.25)],
            "altar_capital": [((0.5, -1.0, 0.3), (0.5, 0.5, 0.5), 1.8)],
            "altar_crown": [((0.3, -1.0, 0.1), (0.5, 0.5, 0.5), 1.6)],
            "altar_cloth": [((0.5, -1.0, 0.5), (0.5, 0.5, 0.5), 1.4), ((0.2, -1.0, 0.0), (0.7, 0.1, 0.1), 0.3)],
            "altar_saint": [((0.3, -1.0, 0.1), (0.5, 0.5, 0.5), 1.6), ((0.2, -1.0, 0.05), (0.5, 0.15, 0.85), 0.35)],
            "altar_marble": [((0.45, -1.0, 0.2), (0.5, 0.5, 0.5), 1.4), ((0.3, -1.0, 0.1), (0.15, 0.2, 0.5), 0.4)],
        })
        shots.render_all(built, names, o["shots"], mat)
    print("[church] %.0f s" % (time.time() - t0))
    if not ok:
        raise SystemExit("verification failed")
    print("CHURCH BUILD COMPLETE %d models" % len(names))


if __name__ == "__main__":
    main()
