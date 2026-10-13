"""Check sheets of the people2 hair, beards and moustaches (docs/people.md "Hair"), straight from mhhair (no full
build needed): every style on its base body with a face picture of its kind, front, three-quarter, side and back at
0.6 m and 2 m, with the piece's alpha fade as the game's shader keeps it (picture alpha + vertex alpha > 1).

    set BLENDER_USER_RESOURCES=<worktree>/.scratch/blender-user
    blender -b --factory-startup --python-exit-code 1 -P art-source/tools/blender/people2_hair_sheets.py
        -- [--only tag,tag] [--out DIR] [--close]

Writes DIR/<tag>.png (one sheet per style: 0.6 m in the top row, 2 m below; --close adds a row of close views)
and DIR/hair_counts.json (triangles per piece). DIR defaults to .scratch/people2-build/shots/hair.
"""

import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402
from mathutils import Vector  # noqa: E402

import people2  # noqa: E402
from people2 import B, mh, mhbody, mhface  # noqa: E402
from people2 import face_types as ft  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1]) if "--out" in ARGS else os.path.join(people2.SHOTS, "hair")
ONLY = ARGS[ARGS.index("--only") + 1].split(",") if "--only" in ARGS else None
CLOSE = "--close" in ARGS

# (tag, base, build, face picture, pieces)
SETS = [
    ("crop", "man", "middling", "m_mid_brown", ["hair:crop"]),
    ("side", "man", "middling", "m_fair_brown", ["hair:side"]),
    ("long", "man", "middling", "m_weather_brown", ["hair:long"]),
    ("capped", "man", "middling", "m_mid_dark", ["hair:capped"]),
    ("bald_sideburns", "old_man", "stooped", "om_bald_grey", ["hair:bald", "beard:sideburns"]),
    ("full_walrus", "man", "middling", "m_mid_dark", ["hair:crop", "beard:full", "mous:walrus"]),
    ("short_chevron", "man", "middling", "m_fair_fair", ["hair:side", "beard:short", "mous:chevron"]),
    ("chops_walrus", "man", "stout", "m_weather_brown", ["hair:crop", "beard:chops", "mous:walrus"]),
    ("chin", "man", "middling", "m_fair_red", ["hair:long", "beard:chin"]),
    ("imperial_handlebar", "man", "middling", "m_olive_black", ["hair:side", "beard:imperial", "mous:handlebar"]),
    ("old_side_full", "old_man", "stooped", "om_white_weather", ["hair:side", "beard:full", "mous:walrus"]),
    ("bun", "woman", "middling", "f_fair_brown", ["hair:bun"]),
    ("plaits", "woman", "middling", "f_red_freckled", ["hair:plaits"]),
    ("coronet", "woman", "middling", "f_fair_fair", ["hair:coronet"]),
    ("undercap", "woman", "stout", "f_weather_ruddy", ["hair:undercap"]),
    ("old_bun", "old_woman", "stooped", "of_grey", ["hair:bun"]),
    ("boy_crop", "child", "middling", "c_boy_brown", ["hair:crop"]),
    ("girl_plaits", "child", "middling", "c_girl_fair", ["hair:plaits"]),
    ("african_crop", "man", "middling", "m_dark_black", ["hair:crop", "mous:chevron"]),
]


def image(name, a, noncolor=False):
    im = bpy.data.images.new(name, a.shape[1], a.shape[0], alpha=True)
    rgba = np.ones((a.shape[0], a.shape[1], 4), np.float32)
    rgba[..., :a.shape[2]] = a
    im.pixels.foreach_set(rgba.ravel())
    if noncolor:
        im.colorspace_settings.name = "Non-Color"
    im.alpha_mode = "STRAIGHT"
    return im


def material(name, rgb, nm, skin):
    """The face picture by the face flag (vertex green), the body a plain skin; a face-flag fragment is kept where
    picture alpha + vertex alpha > 1 (the hair's fade, docs/people.md "Hair"); hair (picture alpha < 1) a little
    glossier than skin."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    try:
        m.surface_render_method = "DITHERED"
    except Exception:  # noqa: BLE001 (older Blender)
        pass
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tf = nt.nodes.new("ShaderNodeTexImage")
    tf.image = image(name + "_face", rgb)
    tf.interpolation = "Linear"
    tfn = nt.nodes.new("ShaderNodeTexImage")
    tfn.image = image(name + "_face_n", nm, True)
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "picture_flags"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(ca.outputs["Color"], sep.inputs[0])
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(sep.outputs["Green"], mix.inputs["Factor"])
    mix.inputs[6].default_value = (*skin, 1)
    nt.links.new(tf.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    nmn = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tfn.outputs["Color"], nmn.inputs["Color"])
    nt.links.new(nmn.outputs["Normal"], bsdf.inputs["Normal"])
    add = nt.nodes.new("ShaderNodeMath")
    add.operation = "ADD"
    nt.links.new(tf.outputs["Alpha"], add.inputs[0])
    nt.links.new(ca.outputs["Alpha"], add.inputs[1])
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 1.0
    nt.links.new(add.outputs[0], gt.inputs[0])
    am = nt.nodes.new("ShaderNodeMix")
    am.data_type = "FLOAT"
    nt.links.new(sep.outputs["Green"], am.inputs["Factor"])
    am.inputs[2].default_value = 1.0
    nt.links.new(gt.outputs[0], am.inputs[3])
    nt.links.new(am.outputs[0], bsdf.inputs["Alpha"])
    hr = nt.nodes.new("ShaderNodeMath")
    hr.operation = "LESS_THAN"
    hr.inputs[1].default_value = 0.99
    nt.links.new(tf.outputs["Alpha"], hr.inputs[0])
    for socket, a, b in (("Roughness", 0.6, 0.5), ("Specular IOR Level", 0.3, 0.07)):
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = "FLOAT"
        nt.links.new(hr.outputs[0], mx.inputs["Factor"])
        mx.inputs[2].default_value = a
        mx.inputs[3].default_value = b
        nt.links.new(mx.outputs[0], bsdf.inputs[socket])
    m.use_backface_culling = True
    return m


def stage():
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = 560, 640
    sc.render.resolution_percentage = 100
    sc.view_settings.view_transform = "Standard"
    sc.world = sc.world or bpy.data.worlds.new("w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.42, 0.44, 0.47, 1)
    for rot, en, col in (((52, 0, 35), 3.2, (1.0, 0.96, 0.9)), ((70, 0, 210), 0.9, (0.8, 0.86, 1.0))):
        ld = bpy.data.lights.new("sun", "SUN")
        ld.energy, ld.color, ld.angle = en, col, math.radians(4)
        lo = bpy.data.objects.new("sun", ld)
        lo.rotation_euler = [math.radians(a) for a in rot]
        sc.collection.objects.link(lo)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.clip_start = 0.02


def shoot(loc, look, path, lens=70):
    cam = bpy.context.scene.camera
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sheet(paths, cols, out, w=280):
    ims = [bpy.data.images.load(p, check_existing=False) for p in paths]
    h = int(w * ims[0].size[1] / ims[0].size[0])
    rows = (len(ims) + cols - 1) // cols
    big = np.zeros((rows * h, cols * w, 4), np.float32)
    big[..., 3] = 1
    for k, im in enumerate(ims):
        iw, ih = im.size
        px = np.empty(iw * ih * 4, np.float32)
        im.pixels.foreach_get(px)
        px = px.reshape(ih, iw, 4)
        ys = (np.arange(h) * ih / h).astype(int)
        xs = (np.arange(w) * iw / w).astype(int)
        r, c = k // cols, k % cols
        big[(rows - 1 - r) * h:(rows - r) * h, c * w:(c + 1) * w] = px[ys][:, xs]
        bpy.data.images.remove(im)
    o = bpy.data.images.new("sheet", cols * w, rows * h)
    o.pixels.foreach_set(big.ravel())
    o.filepath_raw = out
    o.file_format = "PNG"
    o.save()
    bpy.data.images.remove(o)


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mh.ensure_mpfb()
    os.makedirs(OUT, exist_ok=True)
    stage()
    faces, bodies, counts = {}, {}, {}
    t0 = time.time()
    for tag, base, build, cell, pieces in SETS:
        if ONLY and tag not in ONLY:
            continue
        key = (base, build)
        if key not in bodies:
            body = mhbody.get_body(base, build)
            ob, _ = mhbody.build_mesh("hs_%s_%s" % key, 0, body, body.joints())
            bodies[key] = (body, ob, {})
        body, ob, made = bodies[key]
        if cell not in faces:
            rgb, nm = mhface.paint(ft.CELL[cell])
            faces[cell] = material("hs_" + cell, rgb, nm, (0.62, 0.45, 0.36))
        mat = faces[cell]
        shown = [ob]
        counts[tag] = {}
        for pc in pieces:
            if pc not in made:
                kind, style = pc.split(":")
                made[pc] = mhbody.hair_mesh("hs_%s_%s_%s" % (base, kind, style), body, kind, style, 0)
            po = made[pc]
            shown.append(po)
            counts[tag][pc] = sum(len(p.vertices) - 2 for p in po.data.polygons)
        for o in bpy.context.scene.objects:
            if o.type == "MESH":
                o.hide_render = o not in shown
        for o in shown:
            o.data.materials.clear()
            o.data.materials.append(mat)
        eyes = (body.Pf[body.b.vsets["joint-l-eye"]].mean(0) + body.Pf[body.b.vsets["joint-r-eye"]].mean(0)) / 2
        c = B(*(eyes + np.array((0, 0.0, -0.05))))
        views = [(d, yaw, 0.05 if d < 1 else 0.10, -0.02, 70) for d in (0.6, 2.0) for yaw in (0, 35, 90, 160)]
        if CLOSE:
            views += [(0.32, 20, 0.12, 0.05, 50), (0.32, 55, -0.06, -0.07, 50), (0.36, 150, 0.22, 0.04, 50),
                      (0.32, 100, 0.0, 0.0, 50)]
        paths = []
        for k, (d, yaw, up, dz, lens) in enumerate(views):
            a = math.radians(yaw)
            tgt = c + Vector((0, 0, dz))
            p = os.path.join(OUT, "parts", "%s_%02d.png" % (tag, k))
            os.makedirs(os.path.dirname(p), exist_ok=True)
            shoot(tgt + Vector((math.sin(a) * d, -math.cos(a) * d, up)), tgt, p, lens)
            paths.append(p)
        sheet(paths, 4, os.path.join(OUT, tag + ".png"))
        print("[hair sheets] %s: %s" % (tag, counts[tag]))
    with open(os.path.join(OUT, "hair_counts.json"), "w", encoding="utf-8") as f:
        json.dump(counts, f, indent=1)
    print("[hair sheets] %d sets in %.0f s -> %s" % (len(counts), time.time() - t0, OUT))


main()
