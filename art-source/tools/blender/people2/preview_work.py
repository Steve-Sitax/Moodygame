"""Check pictures for the work clips (package D3; docs/people.md "Work"). In .scratch/people2-build/shots/work/.

- strip_<clip>.png: twelve frames across the clip from the front three-quarter (top row) and the side (bottom
  row), with stand-ins for what the clip moves (a sack, a broom, a cask, a rope, a winch's crank) and the props it
  works at (a pile, a table, a rail, a seat);
- seq_<clip>.png: frames 0.25 s apart from a near three-quarter view (a film read frame by frame);
- feet_<clip>.png: the feet's contact points over the clip seen from above (a planted foot is one dot).
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import B, FPS, SHOTS
from . import motion as mo
from . import preview as pv
from . import preview_move as pm

OUT = os.path.join(SHOTS, "work")
TMP = os.path.join(OUT, "_tmp.png")


def _mat(name, rgb, rough=0.8):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    bsdf = m.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*rgb, 1)
    bsdf.inputs["Roughness"].default_value = rough
    return m


def _obj(o, mat):
    o["p2_stage"] = 1
    o.data.materials.append(mat)
    return o


def box(m, size, mat, bevel=0.0):
    """A box of `size` (x, y, z) at matrix m (armature axes, centred)."""
    bpy.ops.mesh.primitive_cube_add(size=1)
    o = bpy.context.object
    o.matrix_world = m @ Matrix.Diagonal((*size, 1.0))
    if bevel > 0:
        mod = o.modifiers.new("bevel", "BEVEL")
        mod.width = bevel
        mod.segments = 3
        mod.affect = "EDGES"
        o.data.update()
    return _obj(o, mat)


def ball(m, size, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.5, segments=24, ring_count=12)
    o = bpy.context.object
    o.matrix_world = m @ Matrix.Diagonal((*size, 1.0))
    return _obj(o, mat)


def rod(a, b, r, mat, verts=10):
    a, b = Vector(a), Vector(b)
    if (b - a).length < 1e-5:
        return None
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=(b - a).length, vertices=verts)
    o = bpy.context.object
    o.location = (a + b) / 2
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    return _obj(o, mat)


def cyl(m, r, length, mat, verts=16):
    """A cylinder along the matrix's x axis, centred."""
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=length, vertices=verts)
    o = bpy.context.object
    o.matrix_world = m @ Matrix.Rotation(math.pi / 2, 4, "Y")
    return _obj(o, mat)


MATS = {}


def mats():
    if not MATS:
        MATS.update(sack=_mat("p2w_sack", (0.52, 0.43, 0.3)), wood=_mat("p2w_wood", (0.3, 0.2, 0.11)),
                    pile=_mat("p2w_pile", (0.42, 0.35, 0.25)), iron=_mat("p2w_iron", (0.1, 0.1, 0.11), 0.5),
                    rope=_mat("p2w_rope", (0.55, 0.47, 0.33)), twigs=_mat("p2w_twigs", (0.35, 0.27, 0.16)),
                    fish=_mat("p2w_fish", (0.62, 0.64, 0.66), 0.35), stone=_mat("p2w_stone", (0.36, 0.36, 0.38)),
                    oak=_mat("p2w_oak", (0.38, 0.26, 0.15)), cloth=_mat("p2w_cloth", (0.75, 0.74, 0.68)))
    return MATS


def thing(name, info, m, size=None):
    """A stand-in for a thing of the clip at its matrix (armature axes, the thing's own frame: x its length)."""
    mt = mats()
    model = info.get("model", name)
    if model == "sack":
        s = size or info.get("size") or (0.86, 0.44, 0.26)
        box(m, s, mt["sack"], bevel=min(0.09, 0.4 * min(s)))
    elif model == "broom":
        # x along the handle from the head up; the head (birch twigs) at x 0 .. 0.42
        rod(m @ Vector((0.42, 0, 0)), m @ Vector((1.5, 0, 0)), 0.018, mt["wood"])
        bpy.ops.mesh.primitive_cone_add(radius1=0.12, radius2=0.035, depth=0.42, vertices=10)
        o = bpy.context.object
        o.matrix_world = m @ Matrix.Translation((0.21, 0, 0)) @ Matrix.Rotation(math.pi / 2, 4, "Y")
        _obj(o, mt["twigs"])
    elif model == "cask":
        cyl(m, info.get("radius", 0.33), info.get("length", 0.88), mt["oak"], 20)
    elif model == "brush":
        box(m, (0.2, 0.08, 0.05), mt["wood"])
    elif model == "knife":
        rod(m @ Vector((-0.05, 0, 0)), m @ Vector((0.06, 0, 0)), 0.011, mt["wood"])
        box(m @ Matrix.Translation((0.13, 0, 0)), (0.13, 0.004, 0.022), mt["iron"])
    elif model == "fish":
        ball(m, (0.36, 0.07, 0.09), mt["fish"])
    elif model == "pipe":
        rod(m @ Vector((0.0, 0, 0)), m @ Vector((0.16, 0, 0)), 0.004, mt["iron"])
        rod(m @ Vector((0.16, 0, -0.01)), m @ Vector((0.16, 0, 0.035)), 0.012, mt["wood"])
    elif model == "crank":
        # the winch: the crank arm from the shaft (x 0) and the handle along the shaft's axis (y)
        r = info.get("radius", 0.34)
        rod(m @ Vector((0, 0, 0)), m @ Vector((r, 0, 0)), 0.02, mt["iron"])
        rod(m @ Vector((r, -0.04, 0)), m @ Vector((r, info.get("handle", 0.36), 0)), 0.02, mt["wood"])
    elif model == "oar":
        rod(m @ Vector((0, 0, 0)), m @ Vector((2.2, 0, 0)), 0.02, mt["wood"])
    elif model == "rifle":
        rod(m @ Vector((0, 0, 0)), m @ Vector((1.2, 0, 0)), 0.02, mt["wood"])
    elif model == "book":
        box(m, (0.22, 0.30, 0.03), mt["cloth"])
    else:
        box(m, info.get("box", (0.1, 0.1, 0.1)), mt["wood"])


def props(clip):
    """The props a clip works at (meta _props: (kind, matrix, size) in the node's frame)."""
    mt = mats()
    for p in clip.meta.get("_props", []):
        kind, m, size = p[0], p[1], p[2]
        if kind == "rope":
            pass
        elif kind == "cyl":
            cyl(m, size[0], size[1], mt.get(p[3] if len(p) > 3 else "wood", mt["wood"]))
        else:
            box(m, size, mt.get(p[3] if len(p) > 3 else "pile", mt["pile"]))


def ropes(clip, i, pose, tr):
    """A rope from its anchor through the fists to its tail on the ground (meta _rope), and the held things at
    their sockets (meta held: a knife on gripR)."""
    from . import clips_work as cw
    sk = clip.skel
    ps = sk.fk(pose, tr)
    rp = clip.meta.get("_rope")
    if rp:
        a = rp["anchor"]
        g = [cw.grip_point(ps, S, rp["r"]) for S in "LR"]
        d = (a - (g[0] + g[1]) / 2).normalized()
        g.sort(key=lambda p: -p.dot(d))
        pts = [a, g[0], g[1], rp["tail"]]
        for x, y in zip(pts, pts[1:]):
            rod(x, y, rp["r"], mats()["rope"], 8)
    for h in clip.meta.get("held", []) or []:
        S = h["socket"][-1]
        m = Matrix.Translation(ps.P[h["socket"]]) @ (ps.D[h["socket"]] @ sk.restq[h["socket"]]).to_matrix().to_4x4()
        thing(h["model"], h, m @ Matrix.Rotation(math.pi / 2, 4, "Z"))


def scene_at(clip, b, t):
    pv.clear_stage()
    pose, tr = clip.sample(t)
    pm.figure(b, pose, tr, (Vector(), 0.0))
    if clip.meta.get("_partner"):
        other, (lx, lf, lyaw) = clip.meta["_partner"]
        po, to = other.sample(t)
        pm.figure(b, po, to, (B(lx, 0.0, lf), lyaw), name="partner")
    i = min(clip.frames - 1, int(round(t * FPS)))
    fr = clip.meta.get("_things") or []
    tm = clip.meta.get("_thingMeta", {})
    if fr:
        for name, (m, size) in fr[i].items():
            if tm.get(name, {}).get("hidden"):
                continue
            thing(name, tm.get(name, {}), m, size)
    props(clip)
    ropes(clip, i, pose, tr)


def _hide_rest():
    for o in bpy.data.objects:
        if not o.get("p2_stage") and o.type in ("MESH", "ARMATURE", "EMPTY"):
            o.hide_render = True


def views(b, clip):
    Hh = b["P"]["H"]
    lo = clip.meta.get("view", "stand")
    h = {"stand": 0.52, "low": 0.36, "kneel": 0.3, "sit": 0.4}.get(lo, 0.52) * Hh
    d = 2.6 * Hh / 1.67
    c = Vector(clip.meta.get("viewAt", (0.0, 0.25, 0.0)))
    at = B(c.x, h, c.y)
    return {"front": (B(0.55 * d + c.x, h + 0.25 * Hh, 0.85 * d + c.y), at),
            "rside": (B(-d + c.x, h + 0.1 * Hh, 0.35 + c.y), at),
            "side": (B(d + c.x, h + 0.1 * Hh, 0.2 + c.y), at),
            "back": (B(-0.6 * d + c.x, h + 0.25 * Hh, -0.85 * d + c.y), at),
            "near": (B(0.5 * d + c.x, h + 0.22 * Hh, 0.75 * d + c.y), at)}


def strip(clip, b, fn, n=12, W=300, H=440, rows=("front", "side")):
    cam = pm.stage(24)
    _hide_rest()
    tiles = []
    vs = views(b, clip)
    for row in rows:
        for k in range(n):
            t = clip.seconds * k / n if clip.loop else clip.seconds * k / (n - 1)
            scene_at(clip, b, t)
            eye, at = vs[row]
            tiles.append(pv.shoot(cam, TMP, eye, at, W, H, lens=35))
    pv.save(pv.grid(tiles, n), fn)


def seq(clip, b, fn, every=None, n=12, W=420, H=520, view="near"):
    cam = pm.stage(24)
    _hide_rest()
    tiles = []
    vs = views(b, clip)
    every = every or max(0.25, clip.seconds / (n - 1))
    for k in range(n):
        t = min(clip.seconds, k * every)
        scene_at(clip, b, t)
        eye, at = vs[view]
        tiles.append(pv.shoot(cam, TMP, eye, at, W, H, lens=32))
    pv.save(pv.grid(tiles, 6), fn)


def feet(clip, fn, W=600, H=600, scale=900.0):
    """The heel, ball and tip of both feet at every frame, from above (white: planted, grey: lifted): a planted
    foot that slides draws a smear."""
    img = np.zeros((H, W, 3), np.float32) + 0.06
    sk = clip.skel
    for i in range(clip.frames):
        pose, tr = clip.poses[i], clip.trans[i]
        ps = sk.fk(pose, tr)
        for S, col in (("L", (0.95, 0.75, 0.4)), ("R", (0.45, 0.75, 0.95))):
            for p in mo.contacts(ps, sk, S).values():
                on = p.z < 0.004
                x = int(W / 2 + p.x * scale)
                y = int(H / 2 + p.y * scale)
                if 0 <= x < W and 0 <= y < H:
                    img[H - 1 - y, x] = col if on else (0.3, 0.3, 0.3)
    pv.save(img, fn)


def run(clips, bodies, only=None):
    os.makedirs(OUT, exist_ok=True)
    pv.hide_originals(bodies)
    lines = []
    for c, b in clips:
        if only and c.name not in only:
            continue
        strip(c, b, os.path.join(OUT, "strip_%s.png" % c.name), rows=c.meta.get("rows", ("front", "side")))
        if not c.loop or c.meta.get("seq"):
            seq(c, b, os.path.join(OUT, "seq_%s.png" % c.name))
        feet(c, os.path.join(OUT, "feet_%s.png" % c.name))
        lines.append("work pictures: %s" % c.name)
    pv.clear_stage()
    if os.path.exists(TMP):
        os.remove(TMP)
    return lines
