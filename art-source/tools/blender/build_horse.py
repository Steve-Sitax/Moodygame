"""Build the draught horse of Scheldemist as rigid parts with painted pictures, for the native game (package H,
docs/plans/people.md; the kit is art-source/tools/blender/horse/).

    blender -b --factory-startup -P art-source/tools/blender/build_horse.py -- --plain .scratch/horse-plain/horse.glb
        [--preview] [--nopaint] [--clay]

Writes a plain horse.glb (no Draco: the native intake needs plain geometry) with one node per part (origin at its
pivot, extras on horse_body: pivots and attachment points, game axes), and the pictures (each coat's colour and the
one normal picture, 2048 px PNG masters with their import presets) to native-godot/assets/horse-pictures. The glb
carries an 8 px stand-in; the game loads the pictures by name (Movers/HorseModel.cs).

--preview  textured renders of the standing horse (each coat; side, front, low front, back, head, harness, legs) in
           .scratch/horse-build/shots
--clay     the parts in plain clay (shape check), the same views
--nopaint  grey pictures (fast geometry trials)
"""

import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import horse  # noqa: E402
from horse import parts as HP_  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
PLAIN = os.path.abspath(ARGS[ARGS.index("--plain") + 1]) if "--plain" in ARGS else None
SHOTS = os.path.join(horse.OUT_DIR, "shots")

# texel density per region (the face and the brass get more, the coat's broad sides the base)
SCALE = {"eye": 2.2, "muzzle": 1.5, "white": 1.3, "brass": 1.6, "iron": 1.3, "leather": 1.2, "collar": 1.2, "hame": 1.3,
         "hoof": 1.3, "hair": 0.9, "cloth": 1.0, "coat": 1.0, "points": 1.0}
# the smart projection's angle per part (the smooth hide in big islands, the harness's hard edges kept)
ANGLE = {"body": 70, "neck": 66, "head": 72, "tail": 75, "ear_l": 70, "ear_r": 70, "leg_front": 75, "leg_front_lo": 66, "leg_hind": 75,
         "leg_hind_lo": 66, "rein": 60, "trace": 60}
# the shader's gloss channel (vertex red: 0 dull .. 0.45 wet; 1 the eyes)
GLOSS = {"eye": 1.0, "muzzle": 0.3, "brass": 0.42, "iron": 0.3, "leather": 0.16, "collar": 0.16, "hame": 0.2, "hoof": 0.14,
         "hair": 0.08, "coat": 0.035, "points": 0.035, "white": 0.03, "cloth": 0.0}


def select_only(ob):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def unwrap(objs):
    """Smart projection per part, every island at one density times its region's factor, all parts packed together
    into one picture (no stretched strips on the narrow faces: every face gets its own projection at the density of
    its material)."""
    from animals.mesh import uv_islands
    for ob in objs:
        select_only(ob)
        me = ob.data
        if not me.uv_layers:
            me.uv_layers.new(name="UVMap")
        me.uv_layers.active = me.uv_layers[0]
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=math.radians(ANGLE.get(ob.name[6:], 66)), island_margin=0.0, area_weight=0.0, correct_aspect=True,
                                 scale_to_bounds=False)
        bpy.ops.object.mode_set(mode="OBJECT")
    # one density over all the parts: scale each island by sqrt(area 3D / area uv), then by its region's factor
    for ob in objs:
        me = ob.data
        reg = HP_.regions_of(ob)
        uvd = me.uv_layers.active.data
        uv = np.zeros(len(uvd) * 2)
        uvd.foreach_get("uv", uv)
        uv = uv.reshape(-1, 2)
        co = np.array([v.co[:] for v in me.vertices])
        for faces in uv_islands(me):
            a3 = a2 = 0.0
            loops = []
            votes = {}
            for fi in faces:
                p = me.polygons[fi]
                li = list(p.loop_indices)
                loops += li
                q = uv[li]
                a2 += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
                P = co[list(p.vertices)]
                for k in range(1, len(P) - 1):
                    a3 += 0.5 * np.linalg.norm(np.cross(P[k] - P[0], P[k + 1] - P[0]))
                votes[reg[fi]] = votes.get(reg[fi], 0) + 1
            if a2 < 1e-12:
                continue
            k = math.sqrt(a3 / a2) * SCALE.get(max(votes, key=votes.get), 1.0)
            c = uv[loops].mean(0)
            uv[loops] = c + (uv[loops] - c) * k
        uvd.foreach_set("uv", uv.ravel())
        me.update()
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for ob in objs:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=0.0016, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def shading(ob):
    """Smooth across the hide and the hair; the harness keeps the flat faces its build gave it."""
    me = ob.data
    reg = HP_.regions_of(ob)
    for p, r in zip(me.polygons, reg):
        if r in ("coat", "points", "white", "muzzle", "hair", "eye", "hoof"):
            p.use_smooth = True


def gloss(ob):
    me = ob.data
    reg = HP_.regions_of(ob)
    if me.color_attributes.get("Col") is None:
        me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    at = me.color_attributes["Col"]
    if at.domain != "CORNER":
        me.color_attributes.remove(at)
        at = me.color_attributes.new("Col", "FLOAT_COLOR", "CORNER")
    c = np.zeros((len(me.loops), 4), np.float32)
    c[:, 3] = 1.0
    for p, r in zip(me.polygons, reg):
        for li in p.loop_indices:
            c[li, 0] = GLOSS.get(r, 0.06)
    at.data.foreach_set("color", c.ravel())
    me.color_attributes.active_color = at


def build():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    t0 = time.time()
    pv = HP_.pivots()
    objs = {}
    for name in HP_.PARTS:
        m = HP_.build_part(name)
        ob = HP_.to_object(m, "horse_" + name, pv[name])
        shading(ob)
        objs[name] = ob
    unwrap(list(objs.values()))
    tris = {n: sum(len(p.vertices) - 2 for p in o.data.polygons) for n, o in objs.items()}
    print(f"[horse] parts built in {time.time() - t0:.1f} s: " + ", ".join(f"{n} {t}" for n, t in tris.items()))
    return objs, tris


def standing(objs):
    """Copies of the parts on the standing horse (legs at their sides), for the painter and the previews."""
    out = []
    for name, ob in objs.items():
        if name in ("rein", "trace"):
            continue
        sides = (1, -1) if name.startswith("leg") else (0,)
        for sx in sides:
            o = ob.copy()
            o.data = ob.data
            bpy.context.scene.collection.objects.link(o)
            o.location = ob.location + Vector((sx * horse_x(name), 0, 0))
            out.append(o)
    return out


def horse_x(name):
    from build_props import HORSE_RIG
    return HORSE_RIG["front" if "front" in name else "hind"]["x"]


def main():
    objs, tris = build()
    # a whole horse: each part once, the four leg parts twice, the two reins
    report = dict(triangles=tris, total=sum(v for k, v in tris.items() if k != "trace") + tris["leg_front"] + tris["leg_front_lo"]
                  + tris["leg_hind"] + tris["leg_hind_lo"] + tris["rein"])
    if "--clay" in ARGS:
        from horse import preview
        preview.clay(standing(objs))
    pics = None
    if "--nopaint" not in ARGS and ("--plain" in ARGS or "--preview" in ARGS):
        from horse import paint
        pics = paint.paint(objs, standing)
        report["pictures"] = pics["hashes"]
    for ob in objs.values():
        gloss(ob)
    if PLAIN:
        from horse import export
        export.write(objs, PLAIN, HP_.points(), {n: HP_.G(p) for n, p in HP_.pivots().items()})
        report["glb"] = PLAIN
    if "--preview" in ARGS and pics is not None:
        from horse import preview
        preview.textured(objs, standing, pics)
    os.makedirs(horse.OUT_DIR, exist_ok=True)
    with open(os.path.join(horse.OUT_DIR, "build-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    print("[horse] " + json.dumps({k: v for k, v in report.items() if k != "pictures"}))


if __name__ == "__main__":
    main()
