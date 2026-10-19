"""The washing on the town's lines (#164), the pegs and wall rings that hold it, the blue-stone horse trough (#160) and
the pavement cellar hatch (#149). Our own work.

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 \\
        -P art-source/tools/blender/build_laundry.py -- --out .scratch/laundry-plain --shots .scratch/laundry-build/shots

Writes, in --out:
  laundry.glb       the pack the game reads (ModelLibrary "laundry"): top-level nodes in game axes (+Y up, +Z out of the
                    wall or the line's front), metres, the baked occlusion in COLOR_0:
                      shirt shift trousers apron stockings sheet towel   one model per piece of washing; the line runs
                          along X through the origin, the piece hangs below it (a sheet and a towel down both sides).
                          Materials laundry_cloth_linen / _twill / _ticking / _towel: near-white tiling cloth pictures,
                          each copy tinted by the game. extras: line_width, drop, pegs (along X), draped.
                      peg        the wooden peg; origin on the line, the slot across Z
                      wash_pole  an ash pole out of a window (the old wash pole's frame: its foot at the origin, out +Z)
                      line_ring  the iron eye bolt and ring at the wall, the line's end knotted on; origin on the wall
                                 face; extras: attach (where the line leaves the knot)
                      rope_sample  a metre of the line (material laundry_rope, a tiling picture the game repeats)
                      ticking_sample  a scrap of laundry_cloth_ticking (the striped aprons' and mattress ticks' material)
                      trough     the horse trough; origin on the ground under its middle, long side along X
  cellar_hatch.glb  the pavement cellar hatch (one plain material, no vertex colour): its origin on the wall face at its
                    middle, on the paving's top, out of the wall +Z
  laundry.json      the facts above for the placement plan (scripts/plan_street_furniture.py)
and, unless --no-shots, preview pictures in --shots.
"""

import importlib
import json
import math
import os
import sys
import time

import bpy
import numpy as np
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))

for mod in ("workgoods.kit", "laundry.tex", "laundry.cloth", "laundry.hardware"):
    importlib.reload(importlib.import_module(mod))
from workgoods import kit  # noqa: E402
from laundry import cloth, hardware, tex  # noqa: E402


def args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    o = {"out": os.path.join(ROOT, ".scratch", "laundry-plain"), "shots": os.path.join(ROOT, ".scratch", "laundry-build", "shots"), "no_shots": False}
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


def image(name, arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)[::-1]
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    img.pack()
    return img


def material(name, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Linear"
    t.extension = "REPEAT"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Metallic"].default_value = 0.0
    bsdf.inputs["Roughness"].default_value = 1.0
    return m


def cell_painter(fn, **kw):
    return lambda w, h, ppm: fn(w, h, ppm, **kw)


def main():
    t0 = time.time()
    o = args()
    os.makedirs(o["out"], exist_ok=True)
    os.makedirs(o["shots"], exist_ok=True)
    pics = os.path.join(o["out"], "pictures")
    os.makedirs(pics, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    kit.OVER.clear()
    facts = {"pieces": {}, "models": {}}

    # ---------------------------------------------------------------- the cloth
    cloth_mats = {
        "linen": material("laundry_cloth_linen", image("laundry_linen", tex.linen(1024, 1024, 21), os.path.join(pics, "linen.png"))),
        "twill": material("laundry_cloth_twill", image("laundry_twill", tex.twill(1024, 1024, 22), os.path.join(pics, "twill.png"))),
        "ticking": material("laundry_cloth_ticking", image("laundry_ticking", tex.ticking(1024, 1024, 23), os.path.join(pics, "ticking.png"))),
        "towel": material("laundry_cloth_towel", image("laundry_towel", tex.towel(512, 1024, 24), os.path.join(pics, "towel.png"))),
    }
    which = {"shirt": "linen", "shift": "linen", "trousers": "twill", "apron": "linen", "stockings": "twill", "sheet": "linen", "towel": "towel"}
    built = {}
    for make in cloth.PIECES:
        p = make()
        uv_of = None
        if p.name == "towel":
            uv_of = lambda u, s: ((u + 0.24) / 0.48, (s + 0.475) / 0.95 * -1 + 1)
        ob = cloth.hang(p, cloth_mats[which[p.name]], uv_of)
        built[p.name] = ob
        facts["pieces"][p.name] = {"line_width": ob["line_width"], "drop": ob["drop"], "pegs": list(ob["pegs"]), "draped": bool(ob["draped"]),
                                   "material": "laundry_cloth_" + which[p.name], "triangles": kit.tris_of(ob)}

    # the ticking's material on a hand's breadth of cloth (the game gives it to the striped aprons and the mattress ticks)
    tq = kit.Mesh("ticking_sample")
    tcell = kit.Cell(0, 0, kit.SIZE, kit.SIZE, kit.SIZE / 0.5, "ticking")
    tq.face([tq.vid((0, 0, 0)), tq.vid((0.1, 0, 0)), tq.vid((0.1, 0, -0.1)), tq.vid((0, 0, -0.1))],
            [(0, 0, 0), (0.1, 0, 0), (0.1, 0, -0.1), (0, 0, -0.1)], kit.Param(tcell), st=[(0, 0), (0.1, 0), (0.1, 0.1), (0, 0.1)], out=(0, -1, 0))
    built["ticking_sample"] = tq.build(cloth_mats["ticking"])

    # ---------------------------------------------------------------- the pegs, the ring, the trough: one atlas
    A = kit.Atlas(kit.SIZE)
    A.region("wood", 0, 0, 1024, 512)
    A.region("iron", 1024, 0, 1024, 512)
    A.region("hemp", 0, 512, 1024, 256)
    A.region("stone", 0, 1024, 2048, 1024)
    A.region("water", 1024, 512, 512, 512)
    beech = A.cell("wood", 0.20, 0.20, 2400, lambda w, h, ppm: tex.beech(w, h, ppm, 31), "beech")
    iron = A.cell("iron", 0.30, 0.15, 2400, lambda w, h, ppm: tex.iron(w, h, ppm, 32, rust=0.45), "iron")
    hemp = A.cell("hemp", 0.36, 0.08, 2400, lambda w, h, ppm: tex.rope(w, h, 33), "hemp")
    stone = A.cell("stone", 2.40, 1.20, 800, lambda w, h, ppm: tex.bluestone(w, h, ppm, 34), "stone")
    water = A.cell("water", 0.60, 0.60, 700, lambda w, h, ppm: tex.water(w, h, 35), "water")
    kit_img = A.to_image("laundry_wood", os.path.join(pics, "laundry_wood_atlas.png"))
    kit_mat = material("laundry_wood", kit_img)
    built["peg"] = hardware.peg(A, beech).build(kit_mat)
    built["wash_pole"] = hardware.wash_pole(A, beech).build(kit_mat)
    ring_mesh, attach = hardware.ring(A, iron, hemp)
    built["line_ring"] = ring_mesh.build(kit_mat)
    built["line_ring"]["attach"] = list(attach)
    facts["models"]["line_ring"] = {"attach": list(attach)}
    built["trough"] = hardware.trough(A, stone, water).build(kit_mat)
    facts["models"]["trough"] = {"size": [2.04, 0.62, 0.74]}

    # the line itself: a metre of laid hemp with its own tiling picture (the game sweeps it along each line)
    rope_img = image("laundry_rope", tex.rope(512, 128, 36), os.path.join(pics, "rope.png"))
    rope_mat = material("laundry_rope", rope_img)
    rm = kit.Mesh("rope_sample")
    rcell = kit.Cell(0, 0, kit.SIZE, kit.SIZE, kit.SIZE / 0.088, "rope")  # (the uv is set below: u along / 0.088 m)
    kit.sweep(rm, [(x, 0.0, 0.0) for x in np.linspace(0, 1, 12)], cloth.LINE_R, 8, kit.Param(rcell, k=(1.0, 0.088 / (2 * math.pi * cloth.LINE_R))))
    built["rope_sample"] = rm.build(rope_mat)

    # ---------------------------------------------------------------- the cellar hatch: its own plain material
    H = kit.Atlas(kit.SIZE)
    H.region("oak", 0, 0, 2048, 1024)
    H.region("iron", 0, 1024, 2048, 1024)
    H.region("dark", 0, 1900, 256, 140)
    oak = H.cell("oak", 1.10, 0.48, 1700, lambda w, h, ppm: tex.oak_planks(w, h, ppm, 41, along_v=False), "oak")
    hiron = H.cell("iron", 1.15, 0.48, 1700, lambda w, h, ppm: tex.iron(w, h, ppm, 42, rust=0.5), "iron")
    dark = H.cell("dark", 0.1, 0.1, 1000, lambda w, h, ppm: np.full((h, w, 3), 0.025, np.float32), "dark")
    hatch_img = H.to_image("cellar_hatch", os.path.join(pics, "cellar_hatch_atlas.png"))
    hatch_mat = material("cellar_hatch", hatch_img)
    hatch = hardware.hatch(H, oak, hiron, dark).build(hatch_mat)
    facts["models"]["cellar_hatch"] = {"size": [1.10, 0.053, 0.44], "top": 0.003}

    bpy.context.view_layer.update()
    for name, ob in built.items():
        if name in ("rope_sample", "ticking_sample"):
            continue
        kit.bake_shade([ob], ground=(name == "trough"), reach=0.12 if name in ("peg", "line_ring") else 0.25, strength=0.6 if name in facts["pieces"] else 0.75)
    for name, ob in list(built.items()) + [("cellar_hatch", hatch)]:
        facts["models"].setdefault(name, {})["triangles"] = kit.tris_of(ob)
        print("[laundry] %-13s %6d triangles" % (name, kit.tris_of(ob)))
    if kit.OVER:
        print("[laundry] UV corners outside their cell:", kit.OVER)

    def export(path, objs):
        for ob in bpy.context.scene.objects:
            ob.select_set(ob in objs)
        bpy.ops.export_scene.gltf(
            filepath=path, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
            export_tangents=False, export_materials="EXPORT", export_image_format="AUTO", export_vertex_color="ACTIVE",
            export_all_vertex_colors=False, export_active_vertex_color_when_no_material=True, export_extras=True,
            export_apply=False, use_selection=True, export_draco_mesh_compression_enable=False, export_try_sparse_sk=False,
            export_animations=False, export_skins=False, export_morph=False, export_cameras=False, export_lights=False)
        print("[laundry] -> %s (%d KB)" % (path, os.path.getsize(path) // 1024))

    export(os.path.join(o["out"], "laundry.glb"), list(built.values()))
    # the hatch: no vertex colour (the town's plain prop material, as the kit's other street props)
    for ob in bpy.context.scene.objects:
        ob.select_set(ob is hatch)
    bpy.ops.export_scene.gltf(
        filepath=os.path.join(o["out"], "cellar_hatch.glb"), export_format="GLB", export_yup=True, export_texcoords=True,
        export_normals=True, export_tangents=False, export_materials="EXPORT", export_image_format="AUTO",
        export_vertex_color="NONE", export_extras=True, export_apply=False, use_selection=True,
        export_draco_mesh_compression_enable=False, export_animations=False, export_skins=False, export_morph=False,
        export_cameras=False, export_lights=False)
    with open(os.path.join(o["out"], "laundry.json"), "w") as f:
        json.dump(facts, f, indent=1)
    if not o["no_shots"]:
        from laundry import shots
        importlib.reload(shots)
        shots.render(built, hatch, cloth_mats, kit_mat, rope_mat, o["shots"])
    print("[laundry] %.0f s" % (time.time() - t0))
    print("LAUNDRY BUILD COMPLETE")


if __name__ == "__main__":
    main()
