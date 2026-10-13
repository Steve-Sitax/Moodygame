"""Check pictures of the MakeHuman people (docs/people.md "Checks"), from the built objects and their pictures.

- types: the 22 face types (each its mean face, a face picture and hair of the type), front and three-quarter at
  0.6 m and 2 m;
- crowd: 40 people from face_for (the four dressed kinds and the base bodies), at 2 m and 5 m;
- lineup: the ten bodies front, side and back, and the far copies;
- poses: arms up, out and forward, a squat, a fist, the clips' first frames, on the man and the woman;
- hands: relaxed, fist and grip, from three sides;
- kinds: the four dressed kinds close (upper body front, three-quarter, back at 1.1 m; whole figure at 2.6 m).
Everything is drawn as the game draws it: each person's sliders set on the near copy and the hair pieces (Blender's
shape keys), the face picture by the face flag (mhskin.preview_material). Pictures go to SHOTS/mh/.
"""

import json
import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import ROOT, SHOTS
from . import face_types as ft
from . import sliders as sl

PICS = os.path.join(ROOT, "..", "native-godot", "assets", "people2-pictures")
OUT = os.path.join(SHOTS, "mh")
_MATS = {}
_IMGS = {}


def _img(name, noncolor=False):
    if name not in _IMGS:
        im = bpy.data.images.load(os.path.join(PICS, name + ".png"), check_existing=True)
        if noncolor:
            im.colorspace_settings.name = "Non-Color"
        _IMGS[name] = im
    return _IMGS[name]


def material(clothes, cell, tone=(1.0, 1.0, 1.0)):
    """The game's people2 look in Blender: the clothes layer (colour, normal) and a face picture, by the face flag;
    the body's skin toned to the face (zone 5 in the colour's alpha)."""
    key = (clothes, cell, tuple(round(t, 3) for t in tone))
    if key in _MATS:
        return _MATS[key]
    m = bpy.data.materials.new("p2prev_%s_%s" % (clothes, cell))
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    tb = nt.nodes.new("ShaderNodeTexImage")
    tb.image = _img(clothes + "_colour")
    tbn = nt.nodes.new("ShaderNodeTexImage")
    tbn.image = _img(clothes + "_normal", True)
    tf = nt.nodes.new("ShaderNodeTexImage")
    tf.image = _img(cell + "_face_colour")
    tfn = nt.nodes.new("ShaderNodeTexImage")
    tfn.image = _img(cell + "_face_normal", True)
    for t in (tb, tbn, tf, tfn):
        t.interpolation = "Linear"
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "picture_flags"
    sep = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(ca.outputs["Color"], sep.inputs[0])
    # the body's skin (alpha 5/5 = skin) takes the face's tone
    skin = nt.nodes.new("ShaderNodeMath")
    skin.operation = "GREATER_THAN"
    skin.inputs[1].default_value = 0.9
    nt.links.new(tb.outputs["Alpha"], skin.inputs[0])
    tone_mix = nt.nodes.new("ShaderNodeMix")
    tone_mix.data_type = "RGBA"
    tone_mix.blend_type = "MULTIPLY"
    nt.links.new(skin.outputs[0], tone_mix.inputs["Factor"])
    nt.links.new(tb.outputs["Color"], tone_mix.inputs[6])
    tone_mix.inputs[7].default_value = (*tone, 1)
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(sep.outputs["Green"], mix.inputs["Factor"])
    nt.links.new(tone_mix.outputs[2], mix.inputs[6])
    nt.links.new(tf.outputs["Color"], mix.inputs[7])
    nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
    mixn = nt.nodes.new("ShaderNodeMix")
    mixn.data_type = "RGBA"
    nt.links.new(sep.outputs["Green"], mixn.inputs["Factor"])
    nt.links.new(tbn.outputs["Color"], mixn.inputs[6])
    nt.links.new(tfn.outputs["Color"], mixn.inputs[7])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(mixn.outputs[2], nm.inputs["Color"])
    nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = 0.62
    bsdf.inputs["Specular IOR Level"].default_value = 0.25
    # the eyes: glossy (red flag in the game's shader; here the eye's picture corner)
    m.use_backface_culling = True
    _MATS[key] = m
    return m


def _rig():
    with open(os.path.join(ROOT, "shared", "peopleRig.json"), encoding="utf-8") as f:
        return json.load(f)


def _faces_json():
    with open(os.path.join(ROOT, "shared", "faceTypes.json"), encoding="utf-8") as f:
        return json.load(f)


def base_of(name, rig):
    if name in rig.get("kinds", {}):
        return rig["kinds"][name]["body"]
    return name


def person(src, face, x=0.0, z=0.0, yaw=0.0, lod=0, rig=None, cells=None):
    """A posable copy of a body or kind (`src`: its armature's name) with a face: sliders, face picture, hair."""
    rig = rig or _rig()
    cells = cells or _faces_json()["cells"]
    base = base_of(src, rig)
    ao0 = bpy.data.objects[src]
    ao = ao0.copy()
    ao.animation_data_clear()
    ao["p2_stage"] = 1
    bpy.context.scene.collection.objects.link(ao)
    names = [src + "_lod%d" % lod]
    for kind, st in (("hair", face.get("hair")), ("beard", face.get("beard")), ("mous", face.get("moustache"))):
        if st:
            names.append("%s_%s_%s_lod%d" % (base, kind, st, lod))
    weights = sl.key_values(face.get("sliders", {}))
    hands = rig.get("kinds", {}).get(src, {}).get("shapeKeys", {}).get("hands_hard", 0.0)
    if hands:
        weights["hands_hard"] = hands
    tone = cells.get(face["cell"], {}).get("bodyTone", (1, 1, 1))
    mat = material(src, face["cell"], tone)
    meshes = []
    for n in names:
        if n not in bpy.data.objects:
            continue
        mo = bpy.data.objects[n].copy()
        mo.data = bpy.data.objects[n].data.copy()
        mo["p2_stage"] = 1
        mo.parent = ao
        mo.modifiers["rig"].object = ao
        bpy.context.scene.collection.objects.link(mo)
        mo.matrix_parent_inverse.identity()
        mo.data.materials.clear()
        mo.data.materials.append(mat)
        if mo.data.shape_keys:
            for kb in mo.data.shape_keys.key_blocks:
                kb.value = 0.0
                if kb.name in weights:
                    kb.slider_min, kb.slider_max = -2.0, 2.0
                    kb.value = weights[kb.name]
        mo.hide_render = False
        meshes.append(mo)
    ao.location = Vector((x, -z, 0.0))
    ao.rotation_euler = (0, 0, math.radians(yaw))
    ao.hide_render = False
    return ao, meshes


def clear():
    for o in list(bpy.data.objects):
        if o.get("p2_stage") or o.name.startswith("p2cam"):
            bpy.data.objects.remove(o)


def hide_all():
    for o in bpy.data.objects:
        if o.type in ("MESH", "ARMATURE") and not o.get("p2_stage"):
            o.hide_render = True


def stage(res=(1600, 900), floor=True, sky=(0.42, 0.44, 0.47)):
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE"
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    try:
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.look = "None"
    except Exception:  # noqa: BLE001
        pass
    if sc.world is None:
        sc.world = bpy.data.worlds.new("p2w")
    sc.world.use_nodes = True
    bg = sc.world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (*sky, 1)
    bg.inputs[1].default_value = 1.0
    if not any(o.get("p2_stage") and o.type == "LIGHT" for o in sc.objects):
        for rot, en, col in (((52, 0, 35), 3.2, (1.0, 0.96, 0.9)), ((70, 0, 210), 0.9, (0.8, 0.86, 1.0))):
            ld = bpy.data.lights.new("p2sun", "SUN")
            ld.energy = en
            ld.color = col
            ld.angle = math.radians(4)
            lo = bpy.data.objects.new("p2sun", ld)
            lo.rotation_euler = [math.radians(a) for a in rot]
            lo["p2_stage"] = 1
            sc.collection.objects.link(lo)
        if floor:
            bpy.ops.mesh.primitive_plane_add(size=60, location=(0, 0, 0))
            fl = bpy.context.object
            fl["p2_stage"] = 1
            fm = bpy.data.materials.new("p2floor")
            fm.use_nodes = True
            fm.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.30, 0.29, 0.27, 1)
            fl.data.materials.append(fm)


def camera(loc, look, lens=50):
    sc = bpy.context.scene
    cam = sc.camera
    if cam is None or not cam.name.startswith("p2cam"):
        cd = bpy.data.cameras.new("p2cam")
        cam = bpy.data.objects.new("p2cam", cd)
        sc.collection.objects.link(cam)
        sc.camera = cam
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.02


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def sheet(paths, cols, out, w=480, labels=None):
    """A contact sheet from rendered pictures (Blender images, no other tools)."""
    ims = []
    for p in paths:
        im = bpy.data.images.load(p, check_existing=False)
        ims.append(im)
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
    out_im = bpy.data.images.new("p2sheet", cols * w, rows * h)
    out_im.pixels.foreach_set(big.ravel())
    out_im.filepath_raw = out
    out_im.file_format = "PNG"
    out_im.save()
    bpy.data.images.remove(out_im)


# ---------------------------------------------------------------- the sheets

def type_face(tname):
    """A type's own face: its means, its first fitting picture, its likeliest hair, beard and moustache."""
    t = ft.TYPES[tname]
    sex = "f" if t["sex"] == "f" else "m"
    age = {"c": 9}.get(t["sex"], 66 if tname in ("shrunken_old", "heavy_old_man") else 36)
    vals = {s.name: 0.0 for s in sl.SLIDERS}
    for n, (m, _) in t["sliders"].items():
        vals[n] = m
    for n, (m, _) in t["body"].items():
        vals[n] = m
    vals["face_age"] = max(-0.6, min(1.0, (age - 40) / 35.0)) if age >= 15 else -0.3
    hair = max(t["hair"].items(), key=lambda kv: kv[1])[0]
    if sex == "f" and hair not in ("bun", "plaits", "coronet", "undercap"):
        hair = "bun"
    cells = ft._cells_for(t, sex, age, "", hair)
    beard = max(t["beard"].items(), key=lambda kv: kv[1])[0] if sex == "m" and age >= 18 else None
    mous = max(t["moustache"].items(), key=lambda kv: kv[1])[0] if sex == "m" else None
    body = "child_middling" if age < 15 else ("old_man" if sex == "m" else "old_woman") if age >= 58 else \
        ("woman_middling" if sex == "f" else "man_middling")
    if tname == "shrunken_old":
        body, hair, cells = "old_woman", "bun", [c for c in cells if c.startswith("of_")] or cells
    if body == "child_middling":
        hair = "crop"
    return body, dict(type=tname, sliders=vals, cell=cells[0], hair=hair, beard=beard, moustache=mous)


def types_sheet():
    """The 22 types' own faces: front and three-quarter, at 0.6 m (the head) and 2 m."""
    clear()
    hide_all()
    stage(res=(560, 640))
    rig, cells = _rig(), _faces_json()["cells"]
    tiles = {"06": [], "2": []}
    for k, tname in enumerate(ft.TYPES):
        body, face = type_face(tname)
        ao, ms = person(body, face, x=k * 3.0, rig=rig, cells=cells)
        bpy.context.view_layer.update()
        eye = ao.matrix_world @ ao.pose.bones["eyeL"].head
        for dist, lens, tag in ((0.6, 70, "06"), (2.0, 70, "2")):
            for yaw in (0, 35):
                tgt = Vector((ao.location.x, eye.y + 0.02, eye.z - (0.03 if tag == "06" else 0.25)))
                a = math.radians(yaw)
                camera(tgt + Vector((math.sin(a) * dist, -math.cos(a) * dist, 0.02)), tgt, lens)
                p = os.path.join(OUT, "types", "%02d_%s_%s_%d.png" % (k, tname, tag, yaw))
                render(p)
                tiles[tag].append(p)
        for o in [ao] + ms:
            o.hide_render = True
    for tag, ps in tiles.items():
        sheet(ps, 8, os.path.join(OUT, "types_%sm.png" % tag), w=280)
    return tiles


CROWD_KINDS = ["docker_a", "docker_a", "docker_a", "fishwife_a", "fishwife_a", "police", "police", "sooi",
               ("man_middling", "sailor"), ("man_middling", "clerk"), ("man_stout", "publican"),
               ("man_slight", "porter"), ("woman_middling", "wife_a"), ("woman_slight", "maid"),
               ("woman_stout", "milk_woman"), ("child_middling", "boy"), ("child_slight", "girl"),
               ("old_man", "old_man"), ("old_woman", "old_woman"), ("man_middling", "gentleman")]


def crowd_faces(n=40, seed=1873):
    out = []
    rng = np.random.default_rng(seed)
    for k in range(n):
        kd = CROWD_KINDS[k % len(CROWD_KINDS)]
        src, kind = (kd, kd) if isinstance(kd, str) else kd
        rig = _rig()
        base = base_of(src, rig)
        sex = "f" if "woman" in base or kind in ("girl", "maid", "wife_a", "milk_woman", "fishwife_a") else "m"
        age = 9 if base.startswith("child") else 68 if base.startswith("old") else int(rng.integers(18, 56))
        face = ft.face_for(1000 + k, kind, sex, age)
        if base.startswith("child") and sex == "m":
            face["hair"] = "crop"
        out.append((src, face))
    return out


def crowd_sheet():
    """40 people: the four dressed kinds and the base bodies, each with their own face (face_for), at 2 m and 5 m."""
    clear()
    hide_all()
    stage(res=(1920, 1080))
    rig, cells = _rig(), _faces_json()["cells"]
    people = crowd_faces()
    for k, (src, face) in enumerate(people):
        row, col = k // 10, k % 10
        person(src, face, x=(col - 4.5) * 0.62 + (0.31 if row % 2 else 0), z=row * 1.1, yaw=0, rig=rig, cells=cells)
    camera((0, -(5.0 + 0.0), 1.55), (0, 1.0, 1.25), 42)
    render(os.path.join(OUT, "crowd_5m.png"))
    camera((-1.2, -2.0, 1.55), (-1.2, 0.2, 1.45), 45)
    render(os.path.join(OUT, "crowd_2m.png"))
    camera((1.5, -2.0, 1.55), (1.5, 0.2, 1.45), 45)
    render(os.path.join(OUT, "crowd_2m_b.png"))
    return people


def kinds_sheet():
    """The four dressed kinds close: the upper body front, three-quarter and back at 1.1 m, the whole figure front
    and back at 2.6 m (the clothes' fit, layers and edges, with the sliders of a face of the kind)."""
    clear()
    hide_all()
    stage(res=(900, 1000))
    rig, cells = _rig(), _faces_json()["cells"]
    ps = []
    for k, kind in enumerate(("docker_a", "fishwife_a", "police", "sooi")):
        sex = "f" if kind == "fishwife_a" else "m"
        face = ft.face_for(2000 + k, kind, sex, 40)
        ao, ms = person(kind, face, rig=rig, cells=cells)
        bpy.context.view_layer.update()
        top = max((o.matrix_world @ Vector(c)).z for o in ms for c in o.bound_box)
        for tag, yaw, dist, h, lens in (("front", 0, 1.1, top - 0.32, 50), ("q", 35, 1.1, top - 0.32, 50),
                                         ("back", 180, 1.1, top - 0.32, 50), ("full", 0, 2.6, top * 0.52, 40),
                                         ("fullback", 180, 2.6, top * 0.52, 40)):
            a = math.radians(yaw)
            camera((math.sin(a) * dist, -math.cos(a) * dist, h + 0.05), (0, 0, h), lens)
            p = os.path.join(OUT, "kinds", "%s_%s.png" % (kind, tag))
            render(p)
            ps.append(p)
        bpy.data.objects.remove(ao)
        for m in ms:
            bpy.data.objects.remove(m)
    sheet(ps, 5, os.path.join(OUT, "kinds.png"), w=360)


def lineup():
    """The ten bodies with their default faces and hair: front, side, back, and the far copies."""
    clear()
    hide_all()
    stage(res=(2400, 1000))
    rig, cells = _rig(), _faces_json()["cells"]
    from . import body as bd
    defaults = {"man": ("m_mid_brown", "crop"), "woman": ("f_fair_brown", "bun"), "child": ("c_boy_brown", "crop"),
                "old_man": ("om_grey", "bald"), "old_woman": ("of_grey", "bun")}
    for lod in (0, 1):
        objs = []
        for k, (name, base, build) in enumerate(bd.BODIES):
            cell, hair = defaults[base]
            face = dict(sliders={}, cell=cell, hair=hair, beard=None, moustache=None)
            ao, ms = person(name, face, x=(k - 4.5) * 0.62, lod=lod, rig=rig, cells=cells)
            objs += [ao] + ms
        for tag, yaw in (("front", 0), ("side", 90), ("back", 180)):
            if lod == 1 and tag != "front":
                continue
            for o in objs:
                if o.type == "ARMATURE":
                    o.rotation_euler = (0, 0, math.radians(yaw))
            camera((0, -11, 0.95), (0, 0, 0.85), 50)
            render(os.path.join(OUT, "bodies_%s%s.png" % (tag, "_lod1" if lod else "")))
        for o in objs:
            bpy.data.objects.remove(o)


def poses():
    """Arms up, out and forward, a squat and the clips' poses, on the man and the woman (the shoulders' and the
    elbows' bends)."""
    from . import clips_legacy as cl
    from .clips_legacy import set_pose
    import sys
    sys.path.insert(0, os.path.join(ROOT, "tools", "blender"))
    from build_people import RX, RY, RZ, limb  # noqa: E402
    clear()
    hide_all()
    stage(res=(700, 900))
    rig, cells = _rig(), _faces_json()["cells"]
    tests = {
        "arms_up": {"armUpL": limb("L", out=170), "armUpR": limb("R", out=170)},
        "arms_out": {"armUpL": limb("L", out=90), "armUpR": limb("R", out=90)},
        "arms_fwd": {"armUpL": limb("L", fwd=90), "armUpR": limb("R", fwd=90), "armLowL": RX(-20), "armLowR": RX(-20)},
        "reach_up": {"armUpL": limb("L", fwd=170), "armUpR": limb("R", out=60, fwd=40), "armLowR": RX(-90)},
        "squat": {"legUpL": RX(-110), "legUpR": RX(-110), "legLowL": RX(120), "legLowR": RX(120), "footL": RX(-10),
                  "footR": RX(-10), "spine": RX(20)},
        "elbows": {"armUpL": limb("L", fwd=20), "armUpR": limb("R", fwd=20), "armLowL": RX(-120), "armLowR": RX(-120)},
    }
    ps = []
    for src, cell, hair in (("man_middling", "m_mid_brown", "crop"), ("woman_middling", "f_fair_brown", "bun")):
        face = dict(sliders={}, cell=cell, hair=hair, beard=None, moustache=None)
        for tag, pose in tests.items():
            ao, ms = person(src, face, rig=rig, cells=cells)
            pose = cl.shoulder_rule(dict(pose))
            set_pose(ao, pose)
            bpy.context.view_layer.update()
            for yaw in (25, 120):
                a = math.radians(yaw)
                tgt = Vector((0, 0, 1.15 if tag != "squat" else 0.7))
                camera(tgt + Vector((math.sin(a) * 2.6, -math.cos(a) * 2.6, 0.25)), tgt, 50)
                p = os.path.join(OUT, "poses", "%s_%s_%d.png" % (src, tag, yaw))
                render(p)
                ps.append(p)
            bpy.data.objects.remove(ao)
            for m in ms:
                bpy.data.objects.remove(m)
    sheet(ps, 6, os.path.join(OUT, "poses.png"), w=300)


def hands():
    """The hand relaxed, in a fist and round a grip, from three sides (the man's near copy)."""
    from . import clips_legacy as cl
    clear()
    hide_all()
    stage(res=(600, 600))
    rig, cells = _rig(), _faces_json()["cells"]
    ps = []
    for shape in ("relaxed", "fist", "grip", "open"):
        face = dict(sliders={}, cell="m_mid_brown", hair="crop", beard=None, moustache=None)
        ao, ms = person("man_middling", face, rig=rig, cells=cells)
        J = {b.name: (np.array((b.head_local.x, b.head_local.z, -b.head_local.y)),
                      np.array((b.tail_local.x, b.tail_local.z, -b.tail_local.y))) for b in ao.data.bones}
        pose = {}
        cl.hand_pose(pose, "L", shape, cl.thumb_axes(J))
        cl.set_pose(ao, pose)
        bpy.context.view_layer.update()
        # aimed at the middle of the hand: between the wrist and the middle finger's second joint
        hand = ao.matrix_world @ ((ao.pose.bones["handL"].head + ao.pose.bones["middle2L"].tail) * 0.5)
        for yaw in (90, 20, 160):
            a = math.radians(yaw)
            camera(hand + Vector((math.sin(a) * 0.30, -math.cos(a) * 0.30, 0.02)), hand, 70)
            p = os.path.join(OUT, "hands", "%s_%d.png" % (shape, yaw))
            render(p)
            ps.append(p)
        bpy.data.objects.remove(ao)
        for m in ms:
            bpy.data.objects.remove(m)
    sheet(ps, 3, os.path.join(OUT, "hands.png"), w=400)


def run(checks):
    out = []
    if "types" in checks:
        types_sheet()
    if "crowd" in checks:
        crowd_sheet()
    if "kinds" in checks:
        kinds_sheet()
    if "lineup" in checks:
        lineup()
    if "poses" in checks:
        poses()
    if "hands" in checks:
        hands()
    clear()
    return out
