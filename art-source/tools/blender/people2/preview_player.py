"""Check pictures of the player's kinds (docs/people.md "The player"), from a saved build scene:

    blender -b <scene saved with PEOPLE2_SAVE_BLEND> --python-exit-code 1 -P art-source/tools/blender/people2_sheets.py
        -- player [kinds=jef_m_shirt,...] [out=<absolute folder>] [what=views,close,builds,hair,hats]

with PEOPLE2_RIG / PEOPLE2_PICTURES_DIR for a trial build. Per kind, in out/:
- <kind>_views.png: front, side and back at 3 m (top row) and at 1 m (bottom row);
- <kind>_close.png: the sleeves and hands at 0.4 m: the left and right forearm and cuff from outside, from the front,
  from above as the player sees his own arm, the hand, a hand lifted;
- <kind>_builds.png: a slight, a stout and an old build (the sliders of the character screen), front and side at 2 m.
"""

import math
import os

import bpy
from mathutils import Vector

from . import face_types as ft
from . import preview_cloth as pc
from . import preview_mh as pm
from . import sliders as sl

FOV = math.radians(75.0)

SLIGHT = {"weight": -0.8, "muscle": -0.4, "shoulders": -0.5, "hips_wide": -0.3, "belly": -0.5, "bust": -0.6}
STOUT = {"weight": 0.9, "muscle": 0.1, "shoulders": 0.4, "hips_wide": 0.5, "belly": 0.7, "buttocks": 0.4, "bust": 0.6}
OLD = {"face_age": 0.9, "weight": 0.1, "belly": 0.4, "shoulders": -0.2, "muscle": -0.4}


def face_for_kind(kind, sliders=None, hair=None, beard=None, moustache=None, old=False):
    sex = "f" if "_w_" in kind else "m"
    cell = ("of_grey" if old else "f_fair_brown") if sex == "f" else ("om_grey" if old else "m_mid_brown")
    vals = {s.name: 0.0 for s in sl.SLIDERS}
    vals.update(sliders or {})
    return dict(type="player", sliders=vals, cell=cell, hair=hair or ("bun" if sex == "f" else "crop"),
                beard=beard, moustache=moustache)


def attach(ao, names, mat_cell="m_mid_brown"):
    """The player's held models (hats, shoes) on a posable copy: each copied back to the rest pose's world frame and
    skinned rigidly to its socket bone, so it follows the pose."""
    import numpy as np
    from . import B, G, export
    out = []
    for name in names:
        src = bpy.data.objects.get(name)
        if src is None:
            continue
        bone = "headTop" if name.startswith("jef_hat") else "foot" + name[-1]
        head, ax = export.bone_frame(ao, bone)
        head, ax = np.array(head), np.array(ax)
        ob = src.copy()
        ob.data = src.data.copy()
        ob["p2_stage"] = 1
        ob.parent = None
        for v in ob.data.vertices:
            g = head + ax.T @ np.array(G(v.co))
            v.co = B(*g)
        ob.data.update()
        for vg in list(ob.vertex_groups):
            ob.vertex_groups.remove(vg)
        ob.vertex_groups.new(name=bone).add(list(range(len(ob.data.vertices))), 1.0, "REPLACE")
        bpy.context.scene.collection.objects.link(ob)
        ao.data.bones[bone].use_deform = True  # headTop is a socket, not a deforming bone: the skinning needs it here
        ob.parent = ao
        ob.matrix_parent_inverse.identity()
        m = ob.modifiers.new("rig", "ARMATURE")
        m.object = ao
        ob.data.materials.clear()
        ob.data.materials.append(pm.material("held_jef", mat_cell))
        ob.hide_render = False
        out.append(ob)
    return out


def shoes(ao, kind, rig, cell):
    """The kind's default shoes (kinds.<kind>.held) on the copy: no player is ever drawn barefoot."""
    names = [h["model"] for h in rig.get("kinds", {}).get(kind, {}).get("held", []) if h["model"].startswith("jef_")]
    return attach(ao, names, cell)


def _cell_ok(face):
    if not os.path.exists(os.path.join(pm.PICS, face["cell"] + "_face_colour.png")):
        face["cell"] = "f_fair_brown" if face["cell"].startswith(("f", "of")) else "m_mid_brown"
    return face


def views(kind, out, face=None, tag="views"):
    rig, cells = pm._rig(), pm._faces_json()["cells"]
    face = _cell_ok(face or face_for_kind(kind))
    pm.clear()
    pm.hide_all()
    pm.stage(res=(720, 900))
    ao, ms = pm.person(kind, face, rig=rig, cells=cells)
    sex = "f" if "_w_" in kind else "m"
    pc.pose(ao, "idle_f" if sex == "f" else "idle", 0.15)
    shoes(ao, kind, rig, face["cell"])
    bpy.context.view_layer.update()
    top = max((o.matrix_world @ Vector(c)).z for o in ms for c in o.bound_box)
    ps = []
    for dist, hc, hl in ((3.0, 1.62, 0.92), (1.0, 1.58, top - 0.42)):
        for yaw in (0, 90, 180):
            a = math.radians(yaw)
            pc._shot(ps, out, "%s_%s_%d_%d" % (kind, tag, int(dist), yaw),
                     (math.sin(a) * dist, -math.cos(a) * dist, hc), (0, 0, hl), fov=math.radians(42 if dist > 2 else 60),
                     res=(720, 900))
    fn = os.path.join(out, "%s_%s.png" % (kind, tag))
    pm.sheet(ps, 3, fn, w=360)
    bpy.data.objects.remove(ao)
    for m in ms:
        bpy.data.objects.remove(m)
    return fn


def close(kind, out):
    """The sleeves and hands from 0.3 to 0.6 m: what the player sees of his own arm."""
    rig, cells = pm._rig(), pm._faces_json()["cells"]
    face = _cell_ok(face_for_kind(kind))
    pm.clear()
    pm.hide_all()
    pm.stage(res=(720, 720))
    ao, ms = pm.person(kind, face, rig=rig, cells=cells)
    sex = "f" if "_w_" in kind else "m"
    ps = []
    pc.pose(ao, "idle", 0.15)
    bpy.context.view_layer.update()
    hl = pc.world_of(ao, "handL", tail=True)
    hr = pc.world_of(ao, "handR", tail=True)
    el = pc.world_of(ao, "armLowL")
    er = pc.world_of(ao, "armLowR")
    fl = (hl + el) * 0.5
    fr = (hr + er) * 0.5
    neck = pc.world_of(ao, "neck")
    sh = pc.world_of(ao, "shoulderL", tail=True)
    views = [("collar", neck + Vector((0, 0, 0.02)), Vector((0.15, -1, 0.2)), 0.5),
             ("nape", neck + Vector((0, 0, 0.03)), Vector((-0.1, 1, 0.3)), 0.5),
             ("shoulder", sh, Vector((0.6, -0.5, 0.6)), 0.5),
             ("L_out", fl, Vector((1, -0.15, 0.1)), 0.45), ("R_out", fr, Vector((-1, -0.15, 0.1)), 0.45),
             ("L_front", fl, Vector((0.25, -1, 0.15)), 0.45), ("R_front", fr, Vector((-0.25, -1, 0.15)), 0.45),
             ("L_cuff", hl, Vector((0.7, -1, 0.35)), 0.35), ("R_back", fr, Vector((-0.5, 1, 0.3)), 0.4)]
    for name, look, dirn, dist in views:
        loc = look + dirn.normalized() * dist
        pc._shot(ps, out, "%s_close_%s" % (kind, name), loc, look, fov=math.radians(55), res=(720, 720))
    # the arms forward (what the player sees): the clip that holds both hands in front of the chest
    for clip, t in (("push", 0.3), ("carry", 0.3), ("hold", 0.3)):
        if bpy.data.actions.get(clip) is not None and pc.pose(ao, clip, t):
            bpy.context.view_layer.update()
            eye = (pc.world_of(ao, "eyeL") + pc.world_of(ao, "eyeR")) * 0.5 + Vector((0, -0.07, 0.02))
            hl = pc.world_of(ao, "handL", tail=True)
            hr = pc.world_of(ao, "handR", tail=True)
            look = (hl + hr) * 0.5
            pc._shot(ps, out, "%s_close_eye_%s" % (kind, clip), eye, look, fov=math.radians(75), res=(720, 720))
            pc._shot(ps, out, "%s_close_eyeL_%s" % (kind, clip), eye, pc.world_of(ao, "handL", tail=True),
                     fov=math.radians(60), res=(720, 720))
            break
    fn = os.path.join(out, "%s_close.png" % kind)
    pm.sheet(ps, 5, fn, w=300)
    bpy.data.objects.remove(ao)
    for m in ms:
        bpy.data.objects.remove(m)
    return fn


def builds(kind, out):
    rig, cells = pm._rig(), pm._faces_json()["cells"]
    sex = "f" if "_w_" in kind else "m"
    ps = []
    for label, sliders, old in (("slight", SLIGHT, False), ("stout", STOUT, False), ("old", OLD, True)):
        face = _cell_ok(face_for_kind(kind, sliders, old=old, beard="short" if (old and sex == "m") else None))
        pm.clear()
        pm.hide_all()
        pm.stage(res=(720, 900))
        ao, ms = pm.person(kind, face, rig=rig, cells=cells)
        pc.pose(ao, "idle_f" if sex == "f" else "idle", 0.15)
        shoes(ao, kind, rig, face["cell"])
        bpy.context.view_layer.update()
        for yaw in (0, 90, 180):
            a = math.radians(yaw)
            pc._shot(ps, out, "%s_build_%s_%d" % (kind, label, yaw),
                     (math.sin(a) * 2.6, -math.cos(a) * 2.6, 1.3), (0, 0, 0.88), fov=math.radians(42), res=(720, 900))
        bpy.data.objects.remove(ao)
        for m in ms:
            bpy.data.objects.remove(m)
    fn = os.path.join(out, "%s_builds.png" % kind)
    pm.sheet(ps, 3, fn, w=300)
    return fn


def accessories(kind, out):
    """Every hat of the sex on the kind (head close, front, side, back, from above) with the hair that goes under it,
    then the boots and the clogs (front, side, low, from above)."""
    from . import held_player as hp
    rig, cells = pm._rig(), pm._faces_json()["cells"]
    sex = "f" if "_w_" in kind else "m"
    ps = []
    for hat in hp.HATS[sex]:
        face = _cell_ok(face_for_kind(kind, hair="capped" if sex == "m" else "undercap"))
        pm.clear()
        pm.hide_all()
        pm.stage(res=(720, 720))
        ao, ms = pm.person(kind, face, rig=rig, cells=cells)
        pc.pose(ao, "idle", 0.15)
        bpy.context.view_layer.update()
        attach(ao, ["jef_hat_" + hat], face["cell"])
        bpy.context.view_layer.update()
        head = pc.world_of(ao, "head", tail=True)
        for name, d in (("f", (0, -1, 0.1)), ("s", (1, 0, 0.1)), ("b", (0, 1, 0.1)), ("t", (0.2, -0.6, 1.0))):
            pc._shot(ps, out, "%s_hat_%s_%s" % (kind, hat, name), head + Vector(d).normalized() * 0.75,
                     head + Vector((0, 0, -0.02)), fov=math.radians(35), res=(720, 720))
        bpy.data.objects.remove(ao)
    for sh in ("boots", "clogs"):
        face = _cell_ok(face_for_kind(kind))
        pm.clear()
        pm.hide_all()
        pm.stage(res=(720, 720))
        ao, ms = pm.person(kind, face, rig=rig, cells=cells)
        pc.pose(ao, "idle", 0.15)
        bpy.context.view_layer.update()
        attach(ao, ["jef_%s_%s_%s" % (sh, sex, S) for S in "LR"], face["cell"])
        bpy.context.view_layer.update()
        f = pc.world_of(ao, "footL")
        for name, d, dist in (("f", (0.1, -1, 0.5), 0.9), ("s", (1, 0, 0.15), 0.8), ("low", (0.5, -1, 0.05), 0.6),
                              ("t", (0.3, -0.4, 1.2), 0.9)):
            pc._shot(ps, out, "%s_%s_%s" % (kind, sh, name), f + Vector((0, 0, 0.1)) + Vector(d).normalized() * dist,
                     f + Vector((0, 0, 0.06)), fov=math.radians(40), res=(720, 720))
        bpy.data.objects.remove(ao)
    fn = os.path.join(out, "%s_accessories.png" % kind)
    pm.sheet(ps, 4, fn, w=330)
    return fn


HAIR_M = ["crop", "side", "long", "bald", "capped"]
BEARD_M = [None, "full", "short", "chops", "sideburns", "chin", "imperial"]
MOUS_M = [None, "walrus", "chevron", "handlebar"]
HAIR_F = ["bun", "plaits", "coronet", "undercap"]


def hair_sheet(kind, out):
    """Every hair style, beard and moustache the base body has, on the player's kind: head front and side at 0.7 m."""
    rig, cells = pm._rig(), pm._faces_json()["cells"]
    sex = "f" if "_w_" in kind else "m"
    combos = []
    if sex == "m":
        combos += [(h, None, None) for h in HAIR_M]
        combos += [("crop", b, None) for b in BEARD_M[1:]]
        combos += [("crop", None, m) for m in MOUS_M[1:]]
        combos += [("side", "short", "walrus")]
    else:
        combos += [(h, None, None) for h in HAIR_F]
    ps = []
    for hair, beard, mous in combos:
        face = _cell_ok(face_for_kind(kind, hair=hair, beard=beard, moustache=mous))
        pm.clear()
        pm.hide_all()
        pm.stage(res=(480, 560))
        ao, ms = pm.person(kind, face, rig=rig, cells=cells)
        pc.pose(ao, "idle", 0.15)
        bpy.context.view_layer.update()
        eye = (pc.world_of(ao, "eyeL") + pc.world_of(ao, "eyeR")) * 0.5
        for yaw in (0, 70):
            a = math.radians(yaw)
            tgt = eye + Vector((0, 0, -0.05))
            pc._shot(ps, out, "%s_hair_%s_%s_%s_%d" % (kind, hair, beard, mous, yaw),
                     tgt + Vector((math.sin(a) * 0.7, -math.cos(a) * 0.7, 0.03)), tgt, fov=math.radians(32),
                     res=(480, 560))
        bpy.data.objects.remove(ao)
    fn = os.path.join(out, "%s_hair.png" % kind)
    pm.sheet(ps, 6, fn, w=250)
    return fn


def run(args):
    out = os.path.join(pc.OUT, "player")
    kinds = None
    what = ["views", "close", "builds"]
    for a in args:
        if a.startswith("kinds="):
            kinds = a[6:].split(",")
        if a.startswith("out="):
            out = a[4:]
        if a.startswith("what="):
            what = a[5:].split(",")
    os.makedirs(os.path.join(out, "_t"), exist_ok=True)
    rig = pm._rig()
    kinds = kinds or [k for k in rig.get("kinds", {}) if k.startswith("jef_")]
    made = []
    for k in kinds:
        if k not in bpy.data.objects:
            continue
        if "views" in what:
            made.append(views(k, out))
        if "close" in what:
            made.append(close(k, out))
        if "builds" in what:
            made.append(builds(k, out))
        if "acc" in what:
            made.append(accessories(k, out))
        if "hair" in what:
            made.append(hair_sheet(k, out))
    print("[player] sheets: " + ", ".join(made))
    return made
