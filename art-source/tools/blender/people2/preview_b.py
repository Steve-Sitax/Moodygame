"""B's check pictures (docs/people.md "Faces, hands, hair"): faces at 1, 2 and 5 m by day and under a gas lamp,
the 40 seeded faces, the face shapes one by one, the jaw, blink and eyes, and the hands (views, a fist, grips round
handles of 2 to 4 cm with the depth any finger reaches into the handle). All in data/shots/people2/.

The game's picture scale: a 1080-line window 75 degrees high, so a head at 2 m is about 75 pixels tall. Tiles at 2
and 5 m are blown up 3x (nearest) to be looked at, pixel for pixel.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Quaternion, Vector

from . import B, SHOTS
from . import clips_legacy as cl
from . import face_paint as fp
from . import hands as hn
from . import head as hd
from . import preview as pv

PX_PER_M = 540 / math.tan(math.radians(37.5))
OLD = cl.old


def _light_day(scn):
    for o in list(bpy.data.objects):
        if o.get("p2_light"):
            bpy.data.objects.remove(o)
    w = bpy.data.worlds.get("p2w") or bpy.data.worlds.new("p2w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.30, 0.33, 0.37, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    scn.world = w
    for name, e, rot, col in (("sun", 3.0, (52, 0, -35), (1.0, 0.96, 0.90)), ("fill", 0.6, (70, 0, 150), (0.75, 0.82, 1.0))):
        ld = bpy.data.lights.new(name, "SUN")
        ld.energy = e
        ld.color = col
        ld.angle = math.radians(3)
        ld.use_shadow = False
        lo = bpy.data.objects.new(name, ld)
        lo["p2_light"] = 1
        lo["p2_stage"] = 1
        scn.collection.objects.link(lo)
        lo.rotation_euler = tuple(math.radians(a) for a in rot)


def _light_gas(scn, at):
    for o in list(bpy.data.objects):
        if o.get("p2_light"):
            bpy.data.objects.remove(o)
    w = bpy.data.worlds.get("p2w") or bpy.data.worlds.new("p2w")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.03, 0.03, 0.035, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    scn.world = w
    ld = bpy.data.lights.new("gas", "POINT")
    ld.energy = 60.0
    ld.color = (1.0, 0.70, 0.40)
    ld.shadow_soft_size = 0.05
    ld.use_shadow = False
    lo = bpy.data.objects.new("gas", ld)
    lo["p2_light"] = 1
    lo["p2_stage"] = 1
    scn.collection.objects.link(lo)
    lo.location = at


def _stage():
    cam = pv.scene(floor=False)
    for o in list(bpy.data.objects):
        if o.type == "LIGHT" and not o.get("p2_light"):
            bpy.data.objects.remove(o)
    return cam


def _shoot_head(cam, ao, dist, az, W, H, el=4.0, fov_scale=1.0, off=(0.0, 0.0, 0.0)):
    bpy.context.view_layer.update()
    hp = ao.matrix_world @ ao.pose.bones["head"].head + Vector((0, 0, 0.09)) + Vector(off)
    a = math.radians(az)
    loc = hp + Vector((dist * math.sin(a), -dist * math.cos(a), dist * math.tan(math.radians(el))))
    fov = 2 * math.atan(H / 2 / PX_PER_M) * fov_scale
    return pv.shoot(cam, os.path.join(SHOTS, "_tmp.png"), loc, hp, W, H, fov_y=fov)


def _blow(px, k):
    return np.repeat(np.repeat(px, k, axis=0), k, axis=1)


def _set_keys(mo, keys):
    sk = mo.data.shape_keys
    if not sk:
        return
    for kb in sk.key_blocks[1:]:
        kb.value = float(keys.get(kb.name, 0.0))


def _picture(mats, sex):
    mt = mats[sex]
    tex = next(n for n in mt.node_tree.nodes if n.type == "TEX_IMAGE" and n.image and not n.image.name.endswith("_n"))
    return tex.image


def _repaint(img, nimg, base_rgb, base_n, lk):
    rgb, _, nrm = fp.paint(lk, 512)
    size = img.size[0]
    a = fp.insert(base_rgb.copy(), rgb, size)
    n = fp.insert(base_n.copy(), nrm, size)
    for im, arr in ((img, a), (nimg, n)):
        rgba = np.ones((size, size, 4), np.float32)
        rgba[..., :3] = arr
        im.pixels.foreach_set(rgba.ravel())
        im.update()


def _image_arrays(img):
    s = img.size[0]
    a = np.array(img.pixels[:], np.float32).reshape(s, s, 4)[..., :3]
    return a


def faces(bodies, mats):
    """faces_close.png: man and woman at 1, 2, 5 m, by day and under a gas lamp, front and three-quarter;
    faces_moves.png: the jaw talking, a blink, the eyes turned; faces_shapes.png: every face shape at full."""
    cam = _stage()
    scn = bpy.context.scene
    tiles = []
    for nm in ("man_middling", "woman_middling", "old_man", "child_middling"):
        b = next((x for x in bodies if x["name"] == nm), None)
        if not b:
            continue
        pv.clear_stage()
        ao, mo = pv.clone(b)
        pv.place(ao, 0, 0, 0, 0)
        cl.set_pose(ao, {})
        row = []
        for light in ("day", "gas"):
            for dist, k in ((1.0, 1), (2.0, 3), (5.0, 3)):
                for az in (0, 35):
                    if light == "day":
                        _light_day(scn)
                    else:
                        bpy.context.view_layer.update()
                        hp = ao.matrix_world @ ao.pose.bones["head"].head
                        _light_gas(scn, hp + Vector((0.9 * math.sin(math.radians(az + 50)), -0.9, 1.1)))
                    Hh = int(PX_PER_M * 0.36 / dist) // 2 * 2
                    px = _shoot_head(cam, ao, dist, az, int(Hh * 0.8) // 2 * 2, Hh)
                    if k > 1:
                        px = _blow(px, k)
                    row.append(px)
        # equal tile size: pad each to the 1 m tile's size
        h0 = max(t.shape[0] for t in row)
        w0 = max(t.shape[1] for t in row)
        for t in row:
            pad = np.ones((h0, w0, 3), np.float32) * 0.05
            pad[(h0 - t.shape[0]) // 2:(h0 - t.shape[0]) // 2 + t.shape[0], (w0 - t.shape[1]) // 2:(w0 - t.shape[1]) // 2 + t.shape[1]] = t
            tiles.append(pad)
    pv.save(pv.grid(tiles, 12), os.path.join(SHOTS, "faces_close.png"))
    # big, to look at the painting: the man by day and by gas light from four sides
    tiles = []
    for nm, light in (("man_middling", "day"), ("man_middling", "gas"), ("woman_middling", "day"), ("old_man", "day"),
                      ("old_woman", "gas"), ("child_middling", "day")):
        b = next((x for x in bodies if x["name"] == nm), None)
        if b is None:
            continue
        pv.clear_stage()
        ao, mo = pv.clone(b)
        pv.place(ao, 0, 0, 0, 0)
        cl.set_pose(ao, {})
        for az in (0, 35, 80, 140):
            if light == "day":
                _light_day(scn)
            else:
                bpy.context.view_layer.update()
                hp = ao.matrix_world @ ao.pose.bones["head"].head
                _light_gas(scn, hp + Vector((0.9 * math.sin(math.radians(az + 50)), -0.9, 1.1)))
            tiles.append(_shoot_head(cam, ao, 1.0, az, 480, 600, fov_scale=0.45))
    pv.save(pv.grid(tiles, 4), os.path.join(SHOTS, "faces_big.png"))
    # moves
    b = bodies[0]
    _light_day(scn)
    tiles = []
    pv.clear_stage()
    ao, mo = pv.clone(b)
    pv.place(ao, 0, 0, 0, 0)
    for title, pose, keys in (("rest", {}, {}), ("talk", {"jaw": OLD.RX(6)}, {}), ("call", {"jaw": OLD.RX(14)}, {}),
                              ("blink half", {}, {"blink": 0.5}), ("blink", {}, {"blink": 1.0}),
                              ("look left", {"eyeL": OLD.RZ(25), "eyeR": OLD.RZ(25)}, {}),
                              ("look up", {"eyeL": OLD.RX(-15), "eyeR": OLD.RX(-15)}, {})):
        cl.set_pose(ao, pose)
        _set_keys(mo, keys)
        tiles.append(_shoot_head(cam, ao, 0.9, 20, 300, 380))
    _set_keys(mo, {})
    pv.save(pv.grid(tiles, 7), os.path.join(SHOTS, "faces_moves.png"))
    # every face shape at full, on the man and the woman
    tiles = []
    for nm in ("man_middling", "woman_middling"):
        b = next((x for x in bodies if x["name"] == nm), None)
        if not b:
            continue
        pv.clear_stage()
        ao, mo = pv.clone(b)
        pv.place(ao, 0, 0, 0, 0)
        cl.set_pose(ao, {})
        for name in ["(none)"] + hd.SHAPE_NAMES:
            _set_keys(mo, {name: 1.0})
            tiles.append(_shoot_head(cam, ao, 1.0, 25, 220, 280))
        _set_keys(mo, {})
    pv.save(pv.grid(tiles, 15), os.path.join(SHOTS, "faces_shapes.png"))


def _cards_object(b, ao, style, rgb):
    from . import hair as hr

    C = hr.cards(style, b["P"])
    if C is None:
        return None
    me = bpy.data.meshes.new("cards")
    V = np.array([B(*p)[:] for p in C["Vs"]])
    me.from_pydata(V.tolist(), [], C["T"].tolist())
    uvl = me.uv_layers.new(name="UVMap")
    uvl.data.foreach_set("uv", C["uv"].reshape(-1, 2).ravel())
    for p_ in me.polygons:
        p_.use_smooth = True
    ob = bpy.data.objects.new("cards", me)
    ob["p2_stage"] = 1
    bpy.context.scene.collection.objects.link(ob)
    me.materials.append(hr.card_material("p2_cards", rgb))
    groups = {}
    for i, wd in enumerate(C["weights"]):
        for n, x in wd.items():
            if n not in groups:
                groups[n] = ob.vertex_groups.new(name=n)
            groups[n].add([i], x, "REPLACE")
    ob.parent = ao
    m = ob.modifiers.new("rig", "ARMATURE")
    m.object = ao
    return ob


def hero(bodies, mats):
    """faces_hero.png: a named man's near copy: side parting, mutton chops and a walrus moustache, painted to match,
    with and without hair cards (the cards are a second material, for the named cast only)."""
    from . import hair as hr

    cam = _stage()
    scn = bpy.context.scene
    _light_day(scn)
    b = bodies[0]
    img = _picture(mats, "m")
    nimg = next(n for n in mats["m"].node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_n")).image
    base, base_n = _image_arrays(img), _image_arrays(nimg)
    style = dict(hair="side", beard="chops", moustache="walrus")
    lk = fp.look_for(4242, "m", 44, hairline="side", beard="chops", moustache="walrus", hair="dark",
                     hair_rgb=fp.HAIR["dark"], drinker=0.5, stubble=0.6)
    _repaint(img, nimg, base, base_n, lk)
    tiles = []
    for with_cards in (False, True):
        pv.clear_stage()
        ao, mo = pv.clone(b)
        pv.place(ao, 0, 0, 0, 0)
        cl.set_pose(ao, {})
        hr.add_to_clone(b, ao, mo, style, mats["m"])
        if with_cards:
            _cards_object(b, ao, style, lk["hair_rgb"])
        for az in (0, 40, 100):
            tiles.append(_shoot_head(cam, ao, 1.0, az, 480, 600, fov_scale=0.45))
    _repaint(img, nimg, base, base_n, fp.BASE_LOOKS["m"])
    pv.save(pv.grid(tiles, 3), os.path.join(SHOTS, "faces_hero.png"))


def sheet40(bodies, mats):
    """faces_40.png: 40 seeded people (man, woman, old, child bodies), each its own look, face mix (shape keys)
    and hair, at 5 m (the game's pixels, blown up 3x) and at 2 m. faces_40_shapesonly.png: the same mixes with one
    look, to see what the shape keys alone do."""
    cam = _stage()
    scn = bpy.context.scene
    _light_day(scn)
    pics = {}
    for sex in ("m", "f"):
        img = _picture(mats, sex)
        nimg = next(n for n in mats[sex].node_tree.nodes if n.type == "TEX_IMAGE" and n.image and n.image.name.endswith("_n")).image
        pics[sex] = (img, nimg, _image_arrays(img), _image_arrays(nimg))
    order = [("man_middling", "m", 30), ("man_slight", "m", 24), ("man_stout", "m", 45), ("woman_middling", "f", 30),
             ("woman_slight", "f", 22), ("woman_stout", "f", 44), ("old_man", "m", 68), ("old_woman", "f", 66),
             ("child_middling", "m", 10), ("man_middling", "m", 52)]
    tiles5, tiles2, tilesS = [], [], []
    from . import hair as hr
    for k in range(40):
        nm, sex, age = order[k % len(order)]
        b = next((x for x in bodies if x["name"] == nm), None)
        if not b:
            continue
        seed = 1873 + 97 * k
        rng = np.random.default_rng(seed)
        lk = fp.look_for(seed, sex, age + int(rng.integers(-6, 7)) if age > 15 else age)
        style = hr.style_for(seed, lk, b["P"])
        lk.update(style.get("paint", {}))
        img, nimg, base, base_n = pics[sex]
        _repaint(img, nimg, base, base_n, lk)
        pv.clear_stage()
        ao, mo = pv.clone(b)
        pv.place(ao, 0, 0, 0, 0)
        cl.set_pose(ao, {})
        hair_obs = hr.add_to_clone(b, ao, mo, style, mats[sex])
        mix = hd.face_mix(seed)
        _set_keys(mo, mix)
        for o in hair_obs:
            _set_keys(o, mix)
        for dist, kk, store in ((5.0, 3, tiles5), (2.0, 3, tiles2)):
            Hh = int(PX_PER_M * 0.42 / dist) // 2 * 2
            px = _shoot_head(cam, ao, dist, 20, int(Hh * 0.8) // 2 * 2, Hh)
            store.append(_blow(px, kk))
        # the same mix on the base look, no hair
        for o in hair_obs:
            o.hide_render = True
        _repaint(img, nimg, base, base_n, fp.BASE_LOOKS[sex])
        tilesS.append(_shoot_head(cam, ao, 1.0, 20, 200, 250))
        _set_keys(mo, {})
    for sex in ("m", "f"):
        img, nimg, base, base_n = pics[sex]
        _repaint(img, nimg, base, base_n, fp.BASE_LOOKS[sex])
    pv.save(pv.grid(tiles5, 10), os.path.join(SHOTS, "faces_40.png"))
    pv.save(pv.grid(tiles2, 10), os.path.join(SHOTS, "faces_40_2m.png"))
    pv.save(pv.grid(tilesS, 10), os.path.join(SHOTS, "faces_40_shapesonly.png"))


# ---------------------------------------------------------------- hands

def _hand_cam(cam, ao, S, off, look_off=(0, 0, 0), W=360, H=420, lens=70):
    bpy.context.view_layer.update()
    hp = ao.matrix_world @ ao.pose.bones["hand" + S].tail + Vector(look_off)
    return pv.shoot(cam, os.path.join(SHOTS, "_tmp.png"), hp + Vector(off), hp, W, H, lens=lens)


GRIP_UP = -0.010  # the same grasp axis below the MakeHuman knuckles as clips_work
GRIP_PALM = -0.003  # MakeHuman palm pad allowance; the same grasp axis as clips_work
GRIPS = [("rope 2 cm", 0.010), ("knife 2.6 cm", 0.013), ("baton 3.2 cm", 0.016), ("handle 4 cm", 0.020)]


def grip_pose(b, S, radius, off, thumb_k=1.0):
    """A hand closed round a handle: the fitted finger curls (hands.grip_fit) and a thumb over the fingers (closed
    by thumb_k of its full turn)."""
    from . import clips_idle as ci, clips_work as cw
    if "_grip_fam" not in b:
        family = ci.BODY_FAMILY.get(b["name"], "man")
        b["_grip_fam"] = ci.Fam(family, b, ci.STANCES[family])
    shape = cw.grip_shape(b["_grip_fam"], S, radius)
    fit = {f: (shape[f], 0) for f in ("index", "middle", "ring")}
    sg = 1 if S == "L" else -1
    pose = {}
    cl.finger_turns(pose, S, {f: fit[f][0] for f in ("index", "middle", "ring")}, cl.thumb_axes(b["J"]))
    flex, across = cl.thumb_axes(b["J"])[S]
    k = thumb_k
    a = shape["thumb"][0] * k
    pose["thumb1" + S] = Quaternion(across, math.radians(a * 0.6)) @ Quaternion(flex, math.radians(a * 0.4))
    pose["thumb2" + S] = Quaternion(flex, math.radians(shape["thumb"][1] * k))
    pose["thumb3" + S] = Quaternion(flex, math.radians(shape["thumb"][2] * k))
    fit["thumb"] = (round(a * 0.6, 1), round(a * 0.4, 1), round(shape["thumb"][1] * k, 1),
                    round(shape["thumb"][2] * k, 1))
    return pose, fit


def _grip_arm(pose, S):
    pose["armUp" + S] = OLD.limb(S, fwd=50)
    pose["armLow" + S] = OLD.RX(-40)
    return pose


def fit_grips(b):
    """For every grip size: the finger curls, a thumb closed as far as it goes without entering the handle, the
    deepest any vertex reaches into it, and where the handle's axis sits in gripL/gripR's own frame (for
    peopleRig.json: hang a handle of that size there, not at the socket's origin)."""
    out = {}
    for title, r in GRIPS:
        off = GRIP_PALM - r
        res = {"radius": r}
        for S in ("L", "R"):
            pv.clear_stage()
            ao, mo = pv.clone(b)
            pv.place(ao, 0, 0, 0, 0)
            for k in (1.0, 0.85, 0.7, 0.55, 0.4, 0.25, 0.1, 0.0, -0.3, -0.6, -0.9, -1.2, -1.5):
                pose, fit = grip_pose(b, S, r, off, thumb_k=k)
                cl.set_pose(ao, _grip_arm(pose, S))
                depth, n, parts = penetration(ao, mo, b, S, r, off, quiet=True)
                if "finger_thumb" + S not in parts:
                    break
            bpy.context.view_layer.update()
            c, ax = grip_axis(ao, S, off)
            m = ao.matrix_world @ ao.pose.bones["grip" + S].matrix
            local = m.inverted() @ c
            res["side" + S] = {"axisAt": [round(v, 4) for v in local], "deepest": round(depth, 4), "inside": n,
                               "thumbClose": k}
            res["curls"] = {f: [float(x) for x in v[0]] for f, v in fit.items() if f != "thumb"}
            res["thumb"] = [float(x) for x in fit["thumb"]]
        out[title.split(" ")[0]] = res
        print("[people2] grip %s: deepest into the handle %.1f / %.1f mm (L/R), thumb closed %.2f / %.2f" % (
            title, 1000 * res["sideL"]["deepest"], 1000 * res["sideR"]["deepest"], res["sideL"]["thumbClose"],
            res["sideR"]["thumbClose"]))
    pv.clear_stage()
    return out


def grip_axis(ao, S, off):
    """The handle's centre and axis in world space: gripS's head and +y, moved `off` toward the back of the hand
    and GRIP_UP toward the wrist (the socket's +z)."""
    sg = 1 if S == "L" else -1
    pb = ao.pose.bones["grip" + S]
    m = ao.matrix_world @ pb.matrix
    centre = m @ Vector((0, 0, 0))
    axis = (m.to_3x3() @ Vector((0, 1, 0))).normalized()
    ph = ao.pose.bones["hand" + S]
    R = ao.matrix_world.to_3x3() @ ph.matrix.to_3x3() @ ph.bone.matrix_local.to_3x3().inverted()
    out = (R @ Vector((sg, 0, 0))).normalized()
    wrist = (m.to_3x3() @ Vector((0, 0, 1))).normalized()
    return centre + out * off + wrist * GRIP_UP, axis


def world_stick(centre, axis, r, length, color=(0.35, 0.24, 0.14)):
    bpy.ops.mesh.primitive_cylinder_add(vertices=24, radius=r, depth=length, location=centre)
    s = bpy.context.object
    s["p2_stage"] = 1
    s.rotation_euler = axis.to_track_quat("Z", "Y").to_euler()
    m = bpy.data.materials.get("p2_stick") or bpy.data.materials.new("p2_stick")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
    s.data.materials.append(m)
    return s


def penetration(ao, mo, b, S, radius, off, quiet=False):
    """How deep the posed hand's vertices go into the handle (m; negative: they stay outside) and how many do."""
    bpy.context.view_layer.update()
    co = pv.evaluated(mo)
    pb = ao.pose.bones["grip" + S]
    m = ao.matrix_world @ pb.matrix
    sg = 1 if S == "L" else -1
    centre, axis = grip_axis(ao, S, off)
    vp = b["vparts"]
    idx = [i for i, p in enumerate(vp) if p and (p.endswith(S)) and (p.startswith("finger_") or p == "arm" + S)]
    P = co[idx] - np.array(centre)
    ax = np.array(axis)
    along = P @ ax
    radial = np.linalg.norm(P - along[:, None] * ax, axis=1)
    near = np.abs(along) < 0.06
    depth = radius - radial[near]
    if not len(depth):
        return -1.0, 0, []
    parts = np.array([vp[i] for i in idx])[near]
    inside = sorted(set(parts[depth > 0.0005].tolist()))
    if inside and not quiet:
        print("[people2] inside the handle:", inside)
    return float(depth.max()), int((depth > 0.0005).sum()), inside


def hands_sheet(bodies, mats):
    """hands.png: the left hand from the back, the palm, the thumb side; a fist; each grip round its stick, from two
    sides; the docker's hand. Prints the depth into each handle."""
    cam = _stage()
    scn = bpy.context.scene
    _light_day(scn)
    b = bodies[0]
    tiles = []
    lines = []
    pv.clear_stage()
    ao, mo = pv.clone(b)
    pv.place(ao, 0, 0, 0, 0)
    axes = cl.thumb_axes(b["J"])
    for shape in ("relaxed", "open", "fist"):
        p = {"armUpL": OLD.limb("L", out=28, fwd=8)}
        cl.hand_pose(p, "L", shape, axes)
        cl.set_pose(ao, p)
        for off in ((0.30, -0.06, 0.08), (-0.26, -0.14, -0.06), (0.06, -0.33, 0.02)):
            tiles.append(_hand_cam(cam, ao, "L", off, look_off=(0, 0, 0.02)))
    # grips: the forearm forward, the hand closed round a stick across the fist
    grips = fit_grips(b)
    for title, r in GRIPS:
        g = grips[title.split(" ")[0]]
        pv.clear_stage()
        ao, mo = pv.clone(b)
        pv.place(ao, 0, 0, 0, 0)
        off = GRIP_PALM - r
        pose, fit = grip_pose(b, "L", r, off, thumb_k=g["sideL"]["thumbClose"])
        cl.set_pose(ao, _grip_arm(pose, "L"))
        bpy.context.view_layer.update()
        c_, a_ = grip_axis(ao, "L", off)
        world_stick(c_, a_, r, 0.22)
        depth, n, _ = penetration(ao, mo, b, "L", r, off)
        lines.append("%s: curls %s, thumb %s, deepest vertex %.1f mm into it (%d vertices)" % (
            title, g["curls"], g["thumb"], 1000 * depth, n))
        for o2 in ((0.30, -0.12, 0.05), (-0.05, -0.32, -0.05)):
            tiles.append(_hand_cam(cam, ao, "L", o2, look_off=(0, 0, -0.02)))
    # the docker's hand
    pv.clear_stage()
    ao, mo = pv.clone(b)
    pv.place(ao, 0, 0, 0, 0)
    cl.set_pose(ao, {})
    for v in (0.0, 1.0):
        _set_keys(mo, {"hands_hard": v})
        tiles.append(_hand_cam(cam, ao, "L", (0.32, -0.08, 0.02), look_off=(0, 0, 0.02)))
    _set_keys(mo, {})
    pv.save(pv.grid(tiles, 6), os.path.join(SHOTS, "hands.png"))
    for ln in lines:
        print("[people2] " + ln)
    return lines


def run(bodies, mats, what=("faces", "hands", "sheet")):
    pv.hide_originals(bodies)
    if "faces" in what:
        faces(bodies, mats)
        hero(bodies, mats)
    if "hands" in what:
        hands_sheet(bodies, mats)
    if "sheet" in what:
        sheet40(bodies, mats)
    tmp = os.path.join(SHOTS, "_tmp.png")
    if os.path.exists(tmp):
        os.remove(tmp)
