"""The washing (#164): each piece is cut as a flat pattern on a grid, hung on the line and let fall by Blender's cloth
simulation (gravity, pinned where the pegs hold it), then given its thickness. Our own work.

Blender axes while building: Z up; the line runs along X through the origin; the cloth hangs down -Z on the line's
front (-Y) side; a draped piece (a sheet, a towel) hangs down both sides. The glTF export turns this into the game's
axes: +X along the line, +Y up, the front toward +Z.

A pattern is a set of cells (i across, k down) of `step` metres, each cell belonging to a part (the body, a sleeve, a
leg, a tie); neighbouring cells of different parts that lie side by side are cut apart below `join` metres (a sleeve
hangs free of the body, joined at the shoulder). `s` is metres down from the line; a draped piece also has negative
`s`, down the back.
"""

import math

import bmesh
import bpy
import numpy as np

LINE_R = 0.005  # the line's radius (the game draws the same rope)


class Pattern:
    def __init__(self, name, step, u0, u1, s0, s1, part, join=0.05, pegs=(), drape=False, warp=None, thick=0.0025,
                 bend=0.25, mass=0.004, tile=0.5, pleat=1.0, seed=1):
        self.name, self.step, self.u0, self.u1, self.s0, self.s1 = name, step, u0, u1, s0, s1
        self.part, self.join, self.pegs, self.drape, self.warp = part, join, list(pegs), drape, warp
        self.thick, self.bend, self.mass, self.tile, self.pleat, self.seed = thick, bend, mass, tile, pleat, seed


def _cells(p):
    cells = {}
    ni = int(round((p.u1 - p.u0) / p.step))
    k0 = int(math.floor(p.s0 / p.step + 1e-6))
    k1 = int(math.ceil(p.s1 / p.step - 1e-6))
    for i in range(ni):
        u = p.u0 + (i + 0.5) * p.step
        for k in range(k0, k1):
            s = (k + 0.5) * p.step
            part = p.part(u, s)
            if part is not None:
                cells[(i, k)] = part
    return cells


def hang(p, mat, uv_of=None):
    """The pattern simulated hanging on its line; returns the finished object (thickness applied, UVs from the flat
    pattern, extras: width along the line, drop below it, the pegs' places along it)."""
    sc = bpy.context.scene
    cells = _cells(p)
    keys = sorted(cells)
    vid = {}
    V = []
    for (i, k) in keys:
        for di, dk in ((0, 0), (1, 0), (1, 1), (0, 1)):
            q = (i + di, k + dk)
            if q not in vid:
                vid[q] = len(V)
                V.append(q)
    rng = np.random.default_rng(p.seed)
    # a few broad vertical folds whose phase wanders a little down the cloth (no fine ripples: those read as melting)
    folds = [(rng.uniform(0.007, 0.015), rng.uniform(0.12, 0.30), rng.uniform(0, 2 * math.pi), rng.uniform(-2.0, 2.0)) for _ in range(3)]

    def pleat(u, s):
        d = min(1.0, max(0.0, abs(s) / 0.15))
        return d * p.pleat * sum(A * math.sin(u * 2 * math.pi / L + ph + B * abs(s)) for A, L, ph, B in folds)

    bm = bmesh.new()
    flat = []
    bv = []
    for (i, k) in V:
        u = p.u0 + i * p.step
        s = k * p.step
        uu, ss = (p.warp(u, s) if p.warp else (u, s))
        flat.append((u, s))
        if p.drape:
            side = -1.0 if s < 0 else 1.0
            if abs(s) < 1e-6:
                y, z = 0.0, LINE_R + p.thick
            else:
                y = side * (LINE_R + p.thick + 0.022 * min(1.0, abs(s) / 0.5)) + side * abs(pleat(uu, s))
                z = -abs(ss) + LINE_R * 0.5
        else:
            y = -(LINE_R + p.thick + 0.002) - pleat(uu, s)
            z = -ss + LINE_R * 0.4
        gather = 1 - 0.05 * min(1.0, abs(s) / 0.3)
        bv.append(bm.verts.new((uu * gather, y, z)))
    faces = {}
    for (i, k) in keys:
        f = bm.faces.new([bv[vid[(i + di, k + dk)]] for di, dk in ((0, 0), (1, 0), (1, 1), (0, 1))])
        faces[f] = (i, k)
    # cut the parts apart where they lie side by side, below the join
    cut = []
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        a, b = faces[lf[0]], faces[lf[1]]
        if cells[a] != cells[b] and a[1] == b[1] and min(abs(a[1]), abs(b[1])) * p.step >= p.join:
            cut.append(e)
    if cut:
        bmesh.ops.split_edges(bm, edges=cut)
    # the flat pattern's place of every (split) vertex, for the UVs
    uvl = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        i, k = faces[f]
        for lp in f.loops:
            # the loop's grid corner: the nearest of the face's four corners in the flat pattern
            co = lp.vert.co
            best = None
            for di, dk in ((0, 0), (1, 0), (1, 1), (0, 1)):
                q = vid[(i + di, k + dk)]
                d = (bv[q].co - co).length
                if best is None or d < best[0]:
                    best = (d, flat[q])
            u, s = best[1]
            lp[uvl].uv = uv_of(u, s) if uv_of else (u / p.tile, -s / p.tile)
    me = bpy.data.meshes.new(p.name + "_flat")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(p.name + "_sim", me)
    sc.collection.objects.link(ob)
    vg = ob.vertex_groups.new(name="pin")
    for v in me.vertices:
        u, y, z = v.co
        held = False
        if p.drape:
            held = z > LINE_R * 0.9 or (z > -0.03 and any(abs(u - q) < 0.022 for q in p.pegs))
        else:
            held = z > -0.032 and any(abs(u - q) < 0.022 for q in p.pegs)
        if held:
            vg.add([v.index], 1.0, "REPLACE")
    cl = ob.modifiers.new("cloth", "CLOTH")
    cs = cl.settings
    cs.quality = 10
    cs.mass = p.mass
    cs.air_damping = 3.0
    cs.tension_stiffness = 15
    cs.compression_stiffness = 1.5
    cs.shear_stiffness = 5
    cs.bending_stiffness = p.bend
    cs.vertex_group_mass = "pin"
    cl.collision_settings.use_collision = False
    if p.drape:
        cl.collision_settings.use_self_collision = True
        cl.collision_settings.self_distance_min = 0.004
    sc.frame_start = 1
    sc.frame_end = 160
    cl.point_cache.frame_start = 1
    cl.point_cache.frame_end = 160
    for f in range(1, 161):
        sc.frame_set(f)
    dg = bpy.context.evaluated_depsgraph_get()
    me2 = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    sc.frame_set(1)
    bpy.data.objects.remove(ob)
    out = bpy.data.objects.new(p.name, me2)
    sc.collection.objects.link(out)
    so = out.modifiers.new("thick", "SOLIDIFY")
    so.thickness = p.thick
    so.offset = 0.0
    so.use_rim = True
    so.use_even_offset = True
    bpy.context.view_layer.objects.active = out
    with bpy.context.temp_override(object=out, active_object=out):
        bpy.ops.object.modifier_apply(modifier="thick")
    for poly in out.data.polygons:
        poly.use_smooth = True
    if mat is not None:
        out.data.materials.append(mat)
    co = np.array([v.co[:] for v in out.data.vertices])
    out["line_width"] = float(co[:, 0].max() - co[:, 0].min())
    out["drop"] = float(-co[:, 2].min())
    out["pegs"] = list(p.pegs)
    out["draped"] = bool(p.drape)
    return out


# ------------------------------------------------------------------ the pieces (sizes in metres)


def _shirt(name, body_w, body_l, sleeve_w, sleeve_l, flare=0.0, tail=0.0, seed=1, pegs=None):
    hw = body_w / 2

    def part(u, s):
        if abs(u) <= hw and s <= body_l + tail * math.cos(math.pi * u / body_w) - tail:
            return "body"
        if hw < abs(u) <= hw + sleeve_w and s <= sleeve_l:
            return "sleeve_l" if u < 0 else "sleeve_r"
        return None

    def warp(u, s):
        if abs(u) > hw:
            u = u + math.copysign(0.018 * min(1.0, s / 0.1), u)
        return u * (1 + flare * max(0.0, s - 0.15)), s

    span = hw + sleeve_w + 0.05
    return Pattern(name, 0.025, -span, span, 0.0, body_l + 0.01, part, join=0.05, pegs=pegs or (-hw + 0.06, hw - 0.06),
                   warp=warp, seed=seed)


def shirt():
    """A man's linen work shirt hung by the shoulders: the body, its shirt-tails rounded, the sleeves hanging beside."""
    p = _shirt("shirt", 0.56, 0.80, 0.19, 0.58, tail=0.08, seed=11)
    return p


def shift():
    """A woman's long linen shift (chemise), widening to the hem, short sleeves."""
    return _shirt("shift", 0.60, 1.00, 0.14, 0.26, flare=0.18, seed=12)


def trousers():
    """Trousers hung by the waistband: the seat to 0.32 m, the legs apart below, narrowing to the turn-ups."""
    hw = 0.22

    def part(u, s):
        if abs(u) > hw:
            return None
        if s <= 0.32:
            return "seat"
        if abs(u) < 0.012:
            return None
        return "leg_l" if u < 0 else "leg_r"

    def warp(u, s):
        k = 1 - 0.20 * max(0.0, min(1.0, (s - 0.32) / 0.68))
        c = math.copysign(0.11, u) if s > 0.32 else 0.0
        return (c + (u - c) * k) if s > 0.32 else u, s

    return Pattern("trousers", 0.025, -hw - 0.025, hw + 0.025, 0.0, 1.0, part, join=0.33, pegs=(-0.17, 0.17), warp=warp,
                   thick=0.0035, bend=0.5, mass=0.006, seed=13)


def apron():
    """A work apron hung by its waistband, the ties hanging from its ends."""
    def part(u, s):
        if abs(u) <= 0.31 and s <= 0.74:
            return "body"
        if 0.31 < abs(u) <= 0.336 and s <= 0.44:
            return "tie_l" if u < 0 else "tie_r"
        return None

    return Pattern("apron", 0.026, -0.39, 0.39, 0.0, 0.75, part, join=0.04, pegs=(-0.25, 0.25), seed=14)


def stockings():
    """A pair of knitted stockings hung by their tops, each leg ending in a foot turned out sideways."""
    cs = (-0.20, 0.06)

    def part(u, s):
        for n, c in enumerate(cs):
            leg = abs(u - c) <= 0.05 and s <= 0.50
            foot = c + 0.05 < u <= c + 0.19 - max(0.0, (s - 0.44)) * 0.0 and 0.38 <= s <= 0.50 - max(0.0, u - (c + 0.15)) * 0.9
            if leg or foot:
                return "stocking%d" % n
        return None

    return Pattern("stockings", 0.02, -0.26, 0.28, 0.0, 0.51, part, join=0.0, pegs=cs, thick=0.004, bend=0.15, mass=0.003,
                   seed=15, pleat=0.6)


def sheet():
    """A linen sheet thrown over the line, hanging down both sides."""
    def part(u, s):
        return "sheet" if abs(u) <= 0.70 and abs(s) <= 0.95 else None

    return Pattern("sheet", 0.05, -0.70, 0.70, -0.95, 0.95, part, join=9, pegs=(-0.62, 0.0, 0.62), drape=True, bend=0.4,
                   mass=0.006, seed=16)


def towel():
    """A linen hand towel over the line, red stripes near its ends."""
    def part(u, s):
        return "towel" if abs(u) <= 0.24 and abs(s) <= 0.475 else None

    return Pattern("towel", 0.025, -0.24, 0.24, -0.475, 0.475, part, join=9, pegs=(-0.19, 0.19), drape=True, bend=0.35,
                   seed=17)


PIECES = [shirt, shift, trousers, apron, stockings, sheet, towel]
