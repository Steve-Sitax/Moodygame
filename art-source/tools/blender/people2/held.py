"""Things people hold or wear on a socket, each its own model (package C; docs/people.md "Sockets", "Kinds and
clothes"): one model per thing, never part of a body.

Frames (game axes, metres), as docs/people.md "Sockets" asks: a held thing has its grip at the origin and its tip
along +y (a handle runs along +y through the fist; a blade's edge points along -z, the little finger's side); a
thing that hangs (a scabbard on hipL) hangs along +y from its origin. Each is a cage subdivided once (rounded,
bevelled edges from the geometry: cast brass 1-3 mm, leather and wood 1-4 mm), painted in 3D like the clothes, in
the atlas's "held" cell. In people2.glb they are meshes under one node, people2_held: held_sabre, held_scabbard,
held_truncheon, held_basket.

- held_sabre: the police agent's short sabre (the briquet pattern): a ribbed brass grip with a knuckle bow and a
  cap, a slightly curved single-edged blade of 60 cm. Sheathed: in held_scabbard's frame at SHEATHED.
- held_scabbard: black leather with a brass locket (the stud that hooks into the belt's frog) and a brass chape.
- held_truncheon: a turned hardwood baton of 40 cm with a grip and a thong hole.
- held_basket: a fishwife's oval wicker basket with a bow handle, herring in it; the handle's top runs through
  the fist along +y, the basket hangs below the hand (-z when the arm hangs: away from the wrist).
"""

import math
import os

import numpy as np

from . import SHOTS
from . import clothes_kit as ck
from .clothes_kit import Cloth, sm

# the sabre in its scabbard: the sabre's own origin (the grip) in the scabbard's frame, axes the same
SHEATHED = {"offset": [0.0, -0.075, 0.0], "rotation": [0.0, 0.0, 0.0, 1.0],
            "note": "the sabre's grip 7.5 cm above the scabbard's mouth, blade down the scabbard (+y), edge -z"}
HANG = {"held_scabbard": {"tiltBackDeg": 28.0,
                          "note": "the frog lets the scabbard swing: hang it turned back about the socket's x by this "
                                  "much, the chape behind the heel"}}


def sweep(pc, path, rx, rz, n, caps=(True, True), up=(1.0, 0.0, 0.0)):
    """A tube along a curved path (points), its cross-section an ellipse rx by rz (per point) in frames carried
    along the path (parallel transport, starting from `up`). Returns ids."""
    path = np.asarray(path, np.float64)
    m = len(path)
    rx = np.broadcast_to(np.asarray(rx, np.float64), (m,))
    rz = np.broadcast_to(np.asarray(rz, np.float64), (m,))
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True)
    u = np.asarray(up, np.float64)
    u = u - T[0] * (u @ T[0])
    u /= np.linalg.norm(u)
    rows = []
    nF = len(pc.F)
    for k in range(m):
        if k > 0:
            u = u - T[k] * (u @ T[k])
            u /= np.linalg.norm(u)
        v = np.cross(T[k], u)
        a = 2 * math.pi * np.arange(n) / n
        rows.append(path[k] + np.outer(np.cos(a) * rx[k], u) + np.outer(np.sin(a) * rz[k], v))
    ids = pc.grid(np.array(rows), lambda p: {}, closed=True, seam_col=0)
    for end, k in ((0, 0), (1, m - 1)):
        if not caps[end]:
            continue
        cv = pc.add(path[k] + (-T[k] if end == 0 else T[k]) * min(rx[k], rz[k]) * 0.4, {})
        for j in range(n):
            a_, b_ = ids[k, j], ids[k, (j + 1) % n]
            pc.face((cv, a_, b_) if end == 0 else (cv, b_, a_))
        pc.seam(cv, ids[k, 0])

    def out(q):
        return q - path[int(np.argmin(np.linalg.norm(path - q, axis=1)))]
    pc.orient(out, start=nF)
    return ids



def _ring(y, cx, cz, rx, rz, n, power=2.0, phase=0.0):
    out = []
    for j in range(n):
        a = phase + 2 * math.pi * j / n
        s, c = math.sin(a), math.cos(a)
        out.append((cx + rx * math.copysign(abs(s) ** (2 / power), s), y,
                    cz + rz * math.copysign(abs(c) ** (2 / power), c)))
    return out


def loft_y(pc, stations, n, caps=(True, True), seam=0, crease_rings=()):
    """A closed shape along y: stations (y, cx, cz, rx, rz, power). Columns from +z round +x. Returns ids."""
    pts = np.array([_ring(y, cx, cz, rx, rz, n, pw) for y, cx, cz, rx, rz, pw in stations])
    nF = len(pc.F)
    ids = pc.grid(pts, lambda p: {}, closed=True, seam_col=seam)
    for end, k in ((0, 0), (1, len(stations) - 1)):
        if not caps[end]:
            continue
        c = pts[k].mean(0) + np.array((0, -0.002 if end == 0 else 0.002, 0))
        cv = pc.add(c, {})
        for j in range(n):
            a, b = ids[k, j], ids[k, (j + 1) % n]
            pc.face((cv, a, b) if end == 0 else (cv, b, a))
        pc.seam(cv, ids[k, seam])
    for k in crease_rings:
        for j in range(n):
            pc.set_crease(ids[k, j], ids[k, (j + 1) % n], 0.06)
    axis = np.array([[s[1], s[0], s[2]] for s in stations])
    pc.orient(lambda q: q - np.array((np.interp(q[1], axis[:, 1], axis[:, 0]), q[1],
                                      np.interp(q[1], axis[:, 1], axis[:, 2]))), start=nF)
    return ids


# ---------------------------------------------------------------- the models

def _brass(ctx):
    n = ck._noise3(ctx.pos, 300.0, 3)
    ctx.rgb[:] = np.array((0.62, 0.47, 0.20)) * (0.85 + 0.15 * n)[:, None]
    ctx.h[:] = 0.00002 * n


def sabre():
    """The sabre: pommel cap, ribbed grip, guard and knuckle bow, a curved blade of 60 cm."""
    grip = ck.Piece("sabre_hilt", Cloth((0.62, 0.47, 0.20), "metal", folds=0.0, extra=_sabre_hilt), scale=2.0)
    st = [(-0.068, 0.0, 0.0, 0.004, 0.004, 2.0), (-0.064, 0.0, 0.0, 0.012, 0.014, 2.2), (-0.056, 0.0, 0.0, 0.015, 0.017, 2.2),
          (-0.048, 0.0, 0.0, 0.0135, 0.0155, 2.2)]
    for k in range(9):
        y = -0.042 + k * 0.0105
        st.append((y, 0.0, 0.0, 0.0128 + 0.0012 * (k % 2), 0.0145 + 0.0012 * (k % 2), 2.2))
    st += [(0.050, 0.0, 0.0, 0.0135, 0.0155, 2.2), (0.054, 0.0, -0.004, 0.012, 0.030, 3.0),
           (0.062, 0.0, -0.004, 0.012, 0.031, 3.0), (0.066, 0.0, 0.0, 0.006, 0.016, 3.0)]
    loft_y(grip, st, 10)
    # the knuckle bow: a flat brass bar from the guard's -z end round to the pommel, outside the fingers
    bow = []
    for k in range(10):
        t = k / 9
        bow.append((0.0, 0.056 - t * 0.118, -0.030 - 0.018 * math.sin(math.pi * t) + 0.012 * t))
    sweep(grip, bow, 0.0035, 0.0022, 6, up=(1.0, 0.0, 0.0))
    blade = ck.Piece("sabre_blade", Cloth((0.72, 0.73, 0.74), "metal", folds=0.0, extra=_blade), scale=1.0)
    rows = []
    n = 6
    for k in range(13):
        t = k / 12
        y = 0.066 + t * 0.60
        w = 0.031 * (1 - 0.35 * t) if t < 0.93 else 0.031 * 0.65 * (1 - (t - 0.93) / 0.07 * 0.9)
        th = 0.0065 * (1 - 0.5 * t)
        cz = -0.035 * t * t  # the curve: the edge side bellies out a little
        # cross-section: the back (+z) thick and round, the edge (-z) thin
        sec = [(0.0, cz + w * 0.5), (th * 0.5, cz + w * 0.42), (th * 0.42, cz), (0.0006, cz - w * 0.5),
               (-th * 0.42, cz), (-th * 0.5, cz + w * 0.42)]
        rows.append([(x, y, z) for x, z in sec])
    ids = blade.grid(np.array(rows), lambda p: {}, closed=True, seam_col=3)
    tip = blade.add(np.array((0.0, 0.676, -0.035 - 0.004)), {})
    for j in range(n):
        blade.face((ids[-1, j], ids[-1, (j + 1) % n], tip))
    for i in range(len(rows) - 1):
        blade.set_crease(ids[i, 3], ids[i + 1, 3], 0.08)
    blade.orient(lambda q: q - np.array((0.0, q[1], -0.035 * ((q[1] - 0.066) / 0.6) ** 2 + 0.008)))
    return [grip, blade]


def _sabre_hilt(ctx):
    _brass(ctx)
    rib = np.cos(ctx.y * 2 * math.pi / 0.0105) * (np.abs(ctx.y) < 0.045)
    ctx.mul(0.5 + 0.5 * rib, 0.85)


def _blade(ctx):
    n = ck._noise3(ctx.pos * np.array((1.0, 0.1, 1.0)), 200.0, 4)
    ctx.rgb[:] = np.array((0.60, 0.62, 0.64)) * (0.9 + 0.1 * n)[:, None]
    edge = sm(-0.005, -0.012, ctx.z + 0.035 * ((ctx.y - 0.066) / 0.6) ** 2)
    ctx.mix(edge * 0.4, (0.80, 0.82, 0.84))


def scabbard():
    sc = ck.Piece("scabbard", Cloth((0.05, 0.045, 0.04), "leather", wear=0.3, folds=0.0, extra=_scabbard), scale=1.0)
    st = [(0.0, 0.0, 0.0, 0.010, 0.022, 2.6)]
    for k in range(1, 11):
        t = k / 10
        y = 0.005 + t * 0.60
        w = 0.022 * (1 - 0.35 * t)
        st.append((y, 0.0, -0.035 * t * t, 0.0085 * (1 - 0.3 * t), w, 2.6))
    st.append((0.615, 0.0, -0.037, 0.003, 0.008, 2.4))
    loft_y(sc, st, 8, caps=(True, True), crease_rings=(0,))
    # the locket at the mouth with its stud, and the chape at the tip: brass sleeves a hair proud
    lk = ck.Piece("scabbard_brass", Cloth((0.62, 0.47, 0.20), "metal", folds=0.0, extra=_brass_plain), scale=1.5)
    loft_y(lk, [(-0.004, 0.0, 0.0, 0.0115, 0.0235, 2.8), (0.065, 0.0, -0.0004, 0.0112, 0.0235, 2.8),
                (0.07, 0.0, -0.0004, 0.0098, 0.0225, 2.8)], 8, caps=(False, False), crease_rings=(0, 1))
    ck.thicken(lk, 0.0012, depth=None, crease=0.1)
    loft_y(lk, [(0.012, 0.0115, 0.0, 0.0, 0.0, 2.0), (0.014, 0.0175, 0.0, 0.004, 0.004, 2.0),
                (0.022, 0.0175, 0.0, 0.004, 0.004, 2.0), (0.024, 0.0115, 0.0, 0.0, 0.0, 2.0)], 6, caps=(False, False))
    loft_y(lk, [(0.52, 0.0, -0.025, 0.0090, 0.0170, 2.6), (0.60, 0.0, -0.036, 0.0066, 0.0150, 2.6),
                (0.622, 0.0, -0.038, 0.004, 0.009, 2.2)], 8, caps=(False, True), crease_rings=(0,))
    return [sc, lk]


def _scabbard(ctx):
    ctx.mix(np.abs(ctx.x) < 0.0005, (0.02, 0.02, 0.02))


def _brass_plain(ctx):
    _brass(ctx)


def truncheon():
    tr = ck.Piece("truncheon", Cloth((0.30, 0.18, 0.10), "wood", wear=0.3, folds=0.0, extra=_truncheon), scale=1.2)
    st = [(-0.085, 0.0, 0.0, 0.006, 0.006, 2.0), (-0.082, 0.0, 0.0, 0.014, 0.014, 2.0), (-0.074, 0.0, 0.0, 0.017, 0.017, 2.0),
          (-0.066, 0.0, 0.0, 0.0155, 0.0155, 2.0), (0.060, 0.0, 0.0, 0.0150, 0.0150, 2.0), (0.068, 0.0, 0.0, 0.0175, 0.0175, 2.0),
          (0.076, 0.0, 0.0, 0.0165, 0.0165, 2.0), (0.30, 0.0, 0.0, 0.0185, 0.0185, 2.0), (0.34, 0.0, 0.0, 0.0175, 0.0175, 2.0),
          (0.352, 0.0, 0.0, 0.010, 0.010, 2.0)]
    loft_y(tr, st, 10)
    return [tr]


def _truncheon(ctx):
    g = np.sin(ctx.y * 300 + 4 * np.sin(np.arctan2(ctx.x, ctx.z) * 2)) * 0.5 + 0.5
    ctx.mul(g, 0.88)
    grip = (ctx.y > -0.066) & (ctx.y < 0.06)
    ctx.mul(grip, 0.75)
    ctx.bump(grip * (np.cos(ctx.y * 2 * math.pi / 0.006) * 0.5 + 0.5), 0.0002)
    hole = np.hypot(ctx.y + 0.076, ctx.x) < 0.003
    ctx.mix(hole, (0.03, 0.02, 0.01))


def basket():
    """An oval wicker basket with a bow handle, the handle's top at the origin along +y; herring in it."""
    bk = ck.Piece("basket", Cloth((0.58, 0.47, 0.30), "wood", wear=0.2, folds=0.0, extra=_wicker), scale=1.0)
    n = 14
    depth = 0.17
    top_z = -0.22  # the rim this far below the hand (along -z: away from the wrist)
    rows = []
    for k, (zz, sc) in enumerate(((top_z - depth, 0.78), (top_z - depth * 0.75, 0.92), (top_z - depth * 0.3, 0.98),
                                   (top_z, 1.0), (top_z + 0.008, 1.02))):
        row = []
        for j in range(n):
            a = 2 * math.pi * j / n
            row.append((0.12 * sc * math.sin(a), 0.19 * sc * math.cos(a), zz))
        rows.append(row)
    pts = np.array(rows)
    ids = bk.grid(pts, lambda p: {}, closed=True, seam_col=n // 2)
    cv = bk.add(np.array((0.0, 0.0, top_z - depth - 0.006)), {})
    for j in range(n):
        bk.face((ids[0, (j + 1) % n], ids[0, j], cv))
    bk.seam(cv, ids[0, n // 2])
    bk.orient(lambda q: q - np.array((0.0, 0.0, top_z - depth * 0.4)))
    ck.thicken(bk, 0.008, depth=None, crease=0.08)
    # the bow handle: a round withy arc from one end of the rim, up through the fist, down to the other
    hd = ck.Piece("basket_handle", Cloth((0.55, 0.44, 0.28), "wood", folds=0.0, extra=_withy), scale=1.2)
    arc = []
    for k in range(13):
        a = math.pi * k / 12
        arc.append((0.0, -0.17 * math.cos(a), top_z + 0.004 + (0.0 - top_z - 0.004) * math.sin(a) ** 0.8))
    sweep(hd, arc, 0.0085, 0.0085, 8, up=(1.0, 0.0, 0.0))
    # herring: silver fish lying across the top, heads out
    fish = ck.Piece("herring", Cloth((0.62, 0.66, 0.68), "metal", folds=0.0, extra=_herring), scale=1.4)
    rng = np.random.default_rng(5)
    for f in range(6):
        x0 = -0.075 + f * 0.03 + rng.uniform(-0.005, 0.005)
        y0 = rng.uniform(-0.03, 0.03) + (0.02 if f % 2 else -0.02)
        ang = rng.uniform(-0.18, 0.18) + (0.0 if f % 2 else math.pi)
        z0 = top_z - 0.004 + rng.uniform(-0.003, 0.003)
        L = 0.24
        path, wx, wz = [], [], []
        for k in range(6):
            t = k / 5
            path.append((x0 + (t - 0.5) * L * math.sin(ang), y0 + (t - 0.5) * L * math.cos(ang), z0))
            body = math.sin(math.pi * min(1.0, 0.12 + 0.88 * t / 0.8)) if t < 0.8 else 0.3 + (t - 0.8) * 2.5
            wx.append(0.006 * body + 0.001)
            wz.append(0.018 * body + 0.002)
        sweep(fish, path, wz, wx, 5, up=(1.0, 0.0, 0.0))
    return [bk, hd, fish]


def _wicker(ctx):
    x, y, z = ctx.x, ctx.y, ctx.z
    ang = np.arctan2(x / 0.12, y / 0.19)
    weave = np.sin(ang * 40) * np.sin(z * 2 * math.pi / 0.012)
    ctx.bump(weave, 0.0008)
    ctx.mul(0.5 + 0.5 * weave, 0.85)
    rim = z > -0.225
    ctx.mul(rim, 0.9)
    ctx.mix(ctx.inner * 0.3, (0.30, 0.24, 0.16))


def _withy(ctx):
    tw = np.sin(np.arctan2(ctx.x, ctx.z) * 3 + ctx.y * 160)
    ctx.bump(tw, 0.0004)
    ctx.mul(0.5 + 0.5 * tw, 0.88)


def _herring(ctx):
    n = ck._noise3(ctx.pos, 400.0, 9)
    ctx.rgb[:] = np.array((0.58, 0.62, 0.64)) * (0.9 + 0.1 * n)[:, None]
    back = ctx.nrm[:, 2] > 0.6
    ctx.mix(back * 0.6, (0.22, 0.28, 0.32))


MODELS = {"held_sabre": sabre, "held_scabbard": scabbard, "held_truncheon": truncheon, "held_basket": basket}


def needed(kinds):
    out = []
    for k in kinds:
        for m, _, _ in k.held:
            if m in MODELS and m not in out:
                out.append(m)
    return out


def build_all(kinds, layout, atl, tex=2048):
    """Every held model the kinds name: built, painted into the atlas's held cell, under one empty node."""
    import bpy

    from . import atlas as at
    from . import dress, lod

    names = needed(kinds)
    if not names:
        return []
    root = bpy.data.objects.new("people2_held", None)
    bpy.context.scene.collection.objects.link(root)
    allp, obs = [], []
    groups = []
    for name in names:
        pieces = MODELS[name]()
        allp += pieces
        groups.append((name, pieces))
    cage, _ = ck.build_objects(allp, "_held_cage")
    ck.unwrap(cage, {pc.name: pc.scale for pc in allp} | {"in_" + pc.name: 0.4 for pc in allp}, margin=0.006)
    near = lod.subdivide(cage, "_held_near")
    bpy.data.objects.remove(cage)
    rgb, nrm = dress.paint_clothes(near, allp, None, tex)
    atl.put("held", rgb, nrm)
    if os.environ.get("PEOPLE2_SHOTS_CELLS"):
        from . import paint
        paint.to_image("held_cell", rgb, os.path.join(SHOTS, "held_cell.png"))
    at.remap_uv(near, layout["held"])
    # one object per model: split the near copy by its pieces' part groups
    import bmesh

    from . import weights as wt
    vparts = [(p or "").replace("in_", "", 1) for p in wt.parts(near)]
    for name, pieces in groups:
        keep = {pc.name for pc in pieces}
        ob = near.copy()
        ob.data = near.data.copy()
        ob.name = ob.data.name = name
        bpy.context.scene.collection.objects.link(ob)
        bm = bmesh.new()
        bm.from_mesh(ob.data)
        bm.verts.ensure_lookup_table()
        gone = [v for v in bm.verts if vparts[v.index] not in keep]
        bmesh.ops.delete(bm, geom=gone, context="VERTS")
        bm.to_mesh(ob.data)
        bm.free()
        for vg in list(ob.vertex_groups):
            ob.vertex_groups.remove(vg)
        ob.parent = root
        obs.append(ob)
    bpy.data.objects.remove(near)
    for ob in obs:
        print("[people2] held %-16s %5d triangles" % (ob.name, lod.tris(ob)))
    return obs


def json_all(kinds):
    names = needed(kinds)
    return {"node": "people2_held", "models": names,
            "frames": "game axes: a held thing's grip at the origin, its tip along +y (a blade's edge along -z); a "
                      "hanging thing hangs along +y from its origin; put the node on the socket's bone "
                      "(BoneAttachment3D / getObjectByName)",
            "sheathed": SHEATHED, "hang": HANG,
            "grips": {"held_sabre": "baton 3.2 cm", "held_truncheon": "baton 3.2 cm", "held_basket": "rope 2 cm"}}


def sheet(dressed, held_obs, fn):
    """The held things alone (big), and on their kinds' sockets."""
    import bpy
    from mathutils import Matrix, Vector

    from . import preview as pv
    from .preview_c import TMP

    cam = pv.scene()
    tiles = []
    for ob in held_obs:
        pv.clear_stage()
        c = ob.copy()
        c["p2_stage"] = 1
        c.parent = None
        c.hide_render = False
        bpy.context.scene.collection.objects.link(c)
        c.matrix_world = Matrix.Translation((0, 0, 1.0))
        bb = np.array([c.matrix_world @ Vector(v) for v in c.bound_box])
        ctr = Vector(bb.mean(0))
        size = float(np.linalg.norm(bb.max(0) - bb.min(0)))
        tiles.append(pv.shoot(cam, TMP, ctr + Vector((0.55, -1.0, 0.45)).normalized() * size * 1.6, ctr, 520, 520,
                              lens=50))
    for b in dressed:
        held = [(m, s) for m, s, _ in b["kind"].held]
        if not held:
            continue
        pv.clear_stage()
        ao, _ = pv.clone(b)
        pv.clip_pose(ao, b, "idle", 0.15)  # the arms hanging, so a held thing hangs from the fist
        bpy.context.view_layer.update()
        for m, s in held:
            src = next((o for o in held_obs if o.name == m), None)
            if src is None or (m == "held_truncheon"):
                continue
            c = src.copy()
            c["p2_stage"] = 1
            bpy.context.scene.collection.objects.link(c)
            c.hide_render = False
            c.parent = ao
            c.parent_type = "BONE"
            c.parent_bone = s
            pb = ao.pose.bones[s]
            loc = Matrix.Translation((0, -pb.bone.length, 0))
            # game axes to Blender's bone frame: the model was built in game axes (x, y, z) and the glb turns it to
            # Y up; in Blender its data sits in (x, -z, y), so turn it back before hanging it on the bone
            fix = Matrix.Rotation(math.radians(-90), 4, "X")
            tilt = Matrix.Rotation(math.radians(HANG.get(m, {}).get("tiltBackDeg", 0.0)), 4, "X")
            off = Matrix.Translation(SHEATHED["offset"]) if m == "held_sabre" else Matrix()
            c.matrix_parent_inverse = Matrix()
            c.matrix_basis = loc @ tilt @ off @ fix
        for yaw, dist in ((60, 1.6), (100, 1.0)):
            ao.rotation_euler = (0, 0, math.radians(yaw))
            hip = ao.matrix_world @ ao.pose.bones["hipL"].head
            tiles.append(pv.shoot(cam, TMP, hip + Vector((dist, -0.25 * dist, 0.15)), hip + Vector((0, 0, -0.2)), 520,
                                  520, lens=50))
    pv.save(pv.grid(tiles, 4), fn)
