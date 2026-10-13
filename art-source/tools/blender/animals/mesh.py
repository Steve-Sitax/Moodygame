"""From the distance field to the game's meshes: surface nets on a fine grid, cut down by Blender's quadric
decimation (detail stays where the surface bends: paws, face, joints), pulled back onto the field with its exact
normals; then the parts made apart (eyeballs, ear flaps with real thickness, a dog's claws), the weights, the UVs
and the far copy.
"""

import math

import bmesh
import bpy
import numpy as np

from people2 import sdf as S

from . import B, G
from .anatomy import INDEX, NAMES
from .body import unit


# ---------------------------------------------------------------- the body surface

def bounds(Bd, pad):
    pts = np.array(list(Bd.J.values()))
    lo = pts.min(0) - pad
    hi = pts.max(0) + pad
    lo[1] = -0.01
    return lo, hi


def surface(Bd, h):
    lo, hi = bounds(Bd, 0.18 * Bd.H)
    d, lo, h = S.grid_eval(Bd.sdf, lo, hi, h, coarse=3 * h, band=3.6 * h)
    verts, faces = S.surface_nets(d, lo, h)
    return verts, faces


def to_object(name, verts_game, faces):
    vb = np.stack([verts_game[:, 0], -verts_game[:, 2], verts_game[:, 1]], 1)
    return S.to_blender(name, vb, faces)


def game_co(ob):
    me = ob.data
    v = np.zeros(len(me.vertices) * 3)
    me.vertices.foreach_get("co", v)
    v = v.reshape(-1, 3)
    return np.stack([v[:, 0], v[:, 2], -v[:, 1]], 1)


def set_game_co(ob, P):
    vb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
    ob.data.vertices.foreach_set("co", vb.ravel())
    ob.data.update()


def select_only(ob):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob


def decimate(ob, target, keep=None):
    """Quadric decimation to `target` triangles; keep (per vertex 0..1): how much a region may be cut (the face and
    the paws keep more of their detail, the barrel gives it)."""
    if keep is None:
        S.decimate(ob, target)
        return
    vg = ob.vertex_groups.new(name="_decimate")
    for i, w in enumerate(keep):
        vg.add([i], float(w), "REPLACE")
    ntri = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    m = ob.modifiers.new("dec", "DECIMATE")
    m.decimate_type = "COLLAPSE"
    m.ratio = min(1.0, target / max(ntri, 1))
    m.use_collapse_triangulate = True
    m.vertex_group = vg.name
    m.vertex_group_factor = 1.2
    select_only(ob)
    bpy.ops.object.modifier_apply(modifier=m.name)
    ob.vertex_groups.remove(ob.vertex_groups["_decimate"])


def settle(ob, Bd, steps=3):
    """Pull the decimated vertices back onto the surface."""
    P = game_co(ob)
    P = S.project(Bd.sdf, P, steps=steps, eps=1e-4)
    set_game_co(ob, P)
    return P


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ---------------------------------------------------------------- pieces made apart

class Piece:
    """Vertices (game space), faces, per-vertex weights {bone: w}, part, uv seeds."""

    def __init__(self, part):
        self.part = part
        self.P = []
        self.W = []
        self.F = []
        self.col = []

    def v(self, p, w, col=0.0):
        self.P.append(np.asarray(p, float))
        self.W.append(w)
        self.col.append(col)
        return len(self.P) - 1

    def f(self, *idx):
        self.F.append(tuple(idx))


def eyeball(c, look, r, seg=12, rings=8, bone="head", part="eye", shape=(1.0, 1.0)):
    """An eyeball: a sphere stretched wide (shape: side, up) so the skin it sinks into meets it in an almond."""
    pc = Piece(part)
    z = unit(look)
    x = unit(np.cross((0, 1, 0), z)) * shape[0]
    y = unit(np.cross(z, x)) * shape[1]
    grid = []
    for i in range(1, rings):
        t = math.pi * i / rings
        row = []
        for j in range(seg):
            a = 2 * math.pi * j / seg
            p = c + r * (math.cos(t) * z + math.sin(t) * (math.cos(a) * x + math.sin(a) * y))
            row.append(pc.v(p, {bone: 1.0}, 1.0))
        grid.append(row)
    top = pc.v(c + r * z, {bone: 1.0}, 1.0)
    bot = pc.v(c - r * z, {bone: 1.0}, 1.0)
    for j in range(seg):
        k = (j + 1) % seg
        pc.f(top, grid[0][k], grid[0][j])
        pc.f(bot, grid[-1][j], grid[-1][k])
        for i in range(len(grid) - 1):
            pc.f(grid[i][j], grid[i][k], grid[i + 1][k], grid[i + 1][j])
    return pc


def ear_shape(kind, H, L):
    """The ear's mid-line (points in the head frame, head units), widths and the way the flap faces, by kind."""
    if kind == "semi":  # up and out, the top third folded forward
        # the street dog's ear: up off the skull a little, then folding over forward and down beside the head
        spine = [(0.0, -0.03, 0.0), (0.05, 0.06, -0.005), (0.095, 0.085, 0.045), (0.12, 0.03, 0.10), (0.13, -0.05, 0.13)]
        width = [0.26, 0.31, 0.30, 0.24, 0.09]
        thick = 0.022
    elif kind == "drop":  # hanging flat by the cheek
        spine = [(0.0, -0.02, 0.0), (0.08, 0.03, 0.02), (0.14, -0.07, 0.05), (0.165, -0.20, 0.06), (0.17, -0.33, 0.05)]
        width = [0.26, 0.34, 0.36, 0.30, 0.12]
        thick = 0.02
    elif kind == "prick":  # small, erect, close set
        spine = [(0.0, -0.04, 0.0), (0.02, 0.08, 0.0), (0.035, 0.18, -0.01), (0.045, 0.27, -0.02), (0.05, 0.36, -0.03)]
        width = [0.34, 0.31, 0.23, 0.12, 0.02]
        thick = 0.03
    elif kind == "button":  # a V folded forward, the tip pointing to the eye
        spine = [(0.0, -0.03, 0.0), (0.06, 0.06, 0.0), (0.10, 0.11, 0.05), (0.12, 0.08, 0.12), (0.12, 0.02, 0.17)]
        width = [0.24, 0.27, 0.23, 0.14, 0.03]
        thick = 0.024
    elif kind == "cat":
        spine = [(0.0, -0.05, 0.0), (0.03, 0.07, -0.01), (0.065, 0.18, -0.02), (0.09, 0.28, -0.03), (0.11, 0.37, -0.04)]
        width = [0.42, 0.4, 0.3, 0.15, 0.02]
        thick = 0.028
    else:  # "lop": the pig's big ears, out and falling forward over the eyes
        spine = [(0.0, -0.02, 0.0), (0.08, 0.06, 0.04), (0.17, 0.06, 0.13), (0.24, -0.01, 0.23), (0.27, -0.08, 0.32)]
        width = [0.22, 0.32, 0.36, 0.30, 0.10]
        thick = 0.02
    return spine, width, thick


def ear(Bd, S_, kind, nu=8, nv=13):
    """A closed flap: front and back skins round a thin mid-surface, a rounded rim. Returns the piece and the
    joints for the two ear bones (base, middle, tip)."""
    J = Bd.J
    o, R, L = Bd.marks["head"]
    sg = 1.0 if S_ == "L" else -1.0
    base = J["ear" + S_]
    spine, width, thick = ear_shape(kind, Bd.H, L)
    sp = np.array([[sg * a, b, c] for a, b, c in spine]) * L
    sp = np.array([base + R @ q for q in sp])
    # resample the spine smoothly along its length
    seg = np.linalg.norm(np.diff(sp, axis=0), axis=1)
    s = np.concatenate([[0], np.cumsum(seg)])
    tot = s[-1]
    vs = np.linspace(0, 1, nv)
    pts = np.array([np.interp(vs * tot, s, sp[:, i]) for i in range(3)]).T
    wd = np.interp(vs * tot, s, np.array(width) * L)
    # a leaf: the outline rounds into the tip
    wd = wd * np.where(vs > 0.4, np.sqrt(np.clip(1 - ((vs - 0.4) / 0.62) ** 2, 0.03, 1)), 1.0)
    # across: perpendicular to the spine, roughly front-to-back of the head (a flap facing sideways/forward)
    fwd = R[:, 2]
    erect = kind in ("cat", "prick")
    # the way the flap faces: erect ears open forward (and a little out), flaps face out from the head
    n0 = unit(R @ np.array((sg * 0.35, 0.0, 1.0))) if erect else unit(R @ np.array((sg * 1.0, 0.25, 0.1)))
    pc = Piece("ear")
    tk = thick * L
    rows_f, rows_b = [], []
    for i, v in enumerate(vs):
        tang = unit(pts[min(i + 1, nv - 1)] - pts[max(i - 1, 0)])
        across = unit(np.cross(tang, n0))
        nrm = unit(np.cross(across, tang))
        rf, rb = [], []
        for j in range(nu):
            u = j / (nu - 1) - 0.5
            cup = -(u * u * 4 - 0.5) * wd[i] * (0.22 if erect else 0.08)
            t = tk * (1.0 - 0.55 * abs(u * 2) ** 2) * (1.0 - 0.45 * v) * (1.0 + 0.9 * (1 - v) ** 3)
            mid = pts[i] + across * u * wd[i] + nrm * cup
            wv = {"head": max(0.0, 1 - v / 0.12)} if v < 0.12 else {}
            share = 1.0 - sum(wv.values())
            b2 = float(np.clip((v - 0.35) / 0.3, 0, 1))
            wv["ear" + S_] = share * (1 - b2)
            wv["ear2" + S_] = share * b2
            rf.append(pc.v(mid + nrm * t * 0.5, dict(wv)))
            rb.append(pc.v(mid - nrm * t * 0.5, dict(wv)))
        rows_f.append(rf)
        rows_b.append(rb)
    for i in range(nv - 1):
        for j in range(nu - 1):
            pc.f(rows_f[i][j], rows_f[i + 1][j], rows_f[i + 1][j + 1], rows_f[i][j + 1])
            pc.f(rows_b[i][j], rows_b[i][j + 1], rows_b[i + 1][j + 1], rows_b[i + 1][j])
        # the rims along both edges
        pc.f(rows_f[i][0], rows_b[i][0], rows_b[i + 1][0], rows_f[i + 1][0])
        pc.f(rows_f[i][nu - 1], rows_f[i + 1][nu - 1], rows_b[i + 1][nu - 1], rows_b[i][nu - 1])
    # the tip and the root closed
    for j in range(nu - 1):
        pc.f(rows_f[-1][j], rows_b[-1][j], rows_b[-1][j + 1], rows_f[-1][j + 1])
        pc.f(rows_f[0][j], rows_f[0][j + 1], rows_b[0][j + 1], rows_b[0][j])
    mid_i = nv // 2
    joints = (pts[0], pts[mid_i], pts[-1])
    return pc, joints


def claws(Bd, H):
    """A dog's claws: a short curved cone off the front of each toe."""
    pcs = []
    for toes, f, bone in zip(Bd.marks.get("toes", []), Bd.marks.get("toe_dirs", []), Bd.marks.get("toe_bones", [])):
        for t in toes:
            pc = Piece("claw")
            r0, Lc = 0.0085 * H, 0.022 * H
            d0 = unit(f * 1.0 + np.array((0, -0.75, 0)))
            base = np.asarray(t) + np.array((0, -0.012 * H, 0))
            side = unit(np.cross((0, 1, 0), d0))
            up = np.cross(d0, side)
            n = 5
            rings = []
            for k, (s, rr) in enumerate(((0.0, r0), (0.5, r0 * 0.7))):
                d = unit(d0 + np.array((0, -0.6 * s, 0)))
                c = base + d0 * Lc * s + np.array((0, -0.25 * Lc * s * s, 0))
                row = [pc.v(c + rr * (math.cos(2 * math.pi * a / n) * side + math.sin(2 * math.pi * a / n) * up * 1.15), {bone: 1.0}) for a in range(n)]
                rings.append(row)
            tip = pc.v(base + d0 * Lc + np.array((0, -0.45 * Lc, 0)), {bone: 1.0})
            for a in range(n):
                b = (a + 1) % n
                pc.f(rings[0][a], rings[0][b], rings[1][b], rings[1][a])
                pc.f(rings[1][a], rings[1][b], tip)
            pcs.append(pc)
    return pcs


def pieces_object(name, pcs):
    allP, allF, allW, allC, parts = [], [], [], [], []
    off = 0
    for pc in pcs:
        allP += pc.P
        allW += pc.W
        allC += pc.col
        parts += [pc.part] * len(pc.P)
        allF += [tuple(i + off for i in f) for f in pc.F]
        off += len(pc.P)
    P = np.array(allP)
    vb = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
    me = bpy.data.meshes.new(name)
    me.from_pydata(vb.tolist(), [], allF)
    me.update()
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    # outward faces: every piece is closed (claws open at their base, inside the toe)
    me.validate()
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    me.update()
    return ob, allW, allC, parts


# ---------------------------------------------------------------- weights and parts

def weight_matrix(dicts):
    W = np.zeros((len(dicts), len(NAMES)))
    for i, d in enumerate(dicts):
        for k, v in d.items():
            W[i, INDEX[k]] += v
    return W


def limit(W, n=4):
    W = W.copy()
    if W.shape[1] > n:
        idx = np.argsort(W, axis=1)[:, :-n]
        np.put_along_axis(W, idx, 0.0, axis=1)
    W[W < 0.01] = 0.0
    s = W.sum(1, keepdims=True)
    s[s == 0] = 1
    return W / s


def apply_weights(ob, W):
    for vg in list(ob.vertex_groups):
        ob.vertex_groups.remove(vg)
    groups = {n: ob.vertex_groups.new(name=n) for n in NAMES}
    for b, n in enumerate(NAMES):
        idx = np.nonzero(W[:, b] > 0)[0]
        for i in idx:
            groups[n].add([int(i)], float(W[i, b]), "REPLACE")


def read_weights(ob):
    W = np.zeros((len(ob.data.vertices), len(NAMES)))
    names = {g.index: g.name for g in ob.vertex_groups}
    for v in ob.data.vertices:
        for g in v.groups:
            n = names[g.group]
            if n in INDEX:
                W[v.index, INDEX[n]] = g.weight
    return W


def set_colors(ob, col):
    me = ob.data
    if me.color_attributes.get("Col") is None:
        me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    at = me.color_attributes["Col"]
    c = np.zeros((len(col), 4), np.float32)
    c[:, 0] = col
    c[:, 3] = 1.0
    at.data.foreach_set("color", c.ravel())
    me.color_attributes.active_color = at


# ---------------------------------------------------------------- UVs

def uv_islands(me):
    """Face islands of the active UV map (faces joined by edges whose UVs agree on both sides)."""
    bm = bmesh.new()
    bm.from_mesh(me)
    uvl = bm.loops.layers.uv.active
    bm.faces.ensure_lookup_table()
    parent = list(range(len(bm.faces)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    for e in bm.edges:
        lf = e.link_faces
        if len(lf) != 2:
            continue
        f0, f1 = lf

        def uvs(f):
            out = {}
            for l in f.loops:
                out[l.vert.index] = tuple(round(c, 6) for c in l[uvl].uv)
            return out
        u0, u1 = uvs(f0), uvs(f1)
        if all(u0[v.index] == u1[v.index] for v in e.verts):
            ra, rb = find(f0.index), find(f1.index)
            if ra != rb:
                parent[rb] = ra
    isl = {}
    for f in bm.faces:
        isl.setdefault(find(f.index), []).append(f.index)
    bm.free()
    return list(isl.values())


def unwrap(ob, vparts, scale_parts, margin=0.006):
    """Smart projection, every island at the same texel density times its part's factor (the face gets more), then
    Blender's packer (islands turned to fit)."""
    select_only(ob)
    if not ob.data.uv_layers:
        ob.data.uv_layers.new(name="UVMap")
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=0.0, area_weight=0.0, correct_aspect=True,
                             scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.object.mode_set(mode="OBJECT")
    me = ob.data
    uvd = me.uv_layers.active.data
    uv = np.zeros(len(uvd) * 2)
    uvd.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    for faces in uv_islands(me):
        votes = {}
        loops = []
        for fi in faces:
            p = me.polygons[fi]
            loops += list(p.loop_indices)
            for vi in p.vertices:
                votes[vparts[vi]] = votes.get(vparts[vi], 0) + 1
        part = max(votes, key=votes.get)
        k = scale_parts.get(part, 1.0)
        if k != 1.0:
            c = uv[loops].mean(0)
            uv[loops] = c + (uv[loops] - c) * k
    uvd.foreach_set("uv", uv.ravel())
    me.update()
    select_only(ob)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=True, scale=True, margin=margin, shape_method="CONCAVE")
    bpy.ops.object.mode_set(mode="OBJECT")


def uv_usage(ob):
    me = ob.data
    uvd = me.uv_layers.active.data
    a = 0.0
    for p in me.polygons:
        q = np.array([uvd[i].uv[:] for i in p.loop_indices])
        a += 0.5 * abs(np.dot(q[:, 0], np.roll(q[:, 1], -1)) - np.dot(q[:, 1], np.roll(q[:, 0], -1)))
    return a


# ---------------------------------------------------------------- the whole model of a rig

SCALE_PARTS = {"head": 1.55, "muzzle": 1.75, "nose": 1.9, "jaw": 1.45, "eye": 2.2, "ear": 1.25, "beard": 1.4, "claw": 1.0,
               "paw": 1.15, "pad": 1.0, "hoof": 1.2}


def build_rig_mesh(name, Bd, h, target0=4400, verbose=True):
    """LOD0 (near) of one rig: the body surface, eyes, ears and claws joined; weights, parts, colours and UVs.
    Returns the object and its per-vertex parts and the ear joints."""
    H = Bd.H
    verts, faces = surface(Bd, h)
    body = to_object(name + "_body", verts, faces)
    n_quads = len(faces)
    # the pieces
    pcs = []
    ear_j = {}
    kind = Bd.rig["P"]["ears"]
    for S_ in "LR":
        pc, js = ear(Bd, S_, kind)
        pcs.append(pc)
        ear_j[S_] = js
    for c, look, r, lids in Bd.marks.get("eyes", []):
        pcs.append(eyeball(c, look, r, shape=lids))
    if Bd.rig["species"] == "dog":
        pcs += claws(Bd, H)
    extra_tris = sum(len(pc.F) for pc in pcs) * 2
    # where detail matters most: the face, then the paws and joints; the barrel least
    V0 = game_co(body)
    soft = Bd.parts(V0, 0.02 * H)
    weight = {"head": 0.3, "muzzle": 0.25, "nose": 0.2, "jaw": 0.3, "beard": 0.4, "paw": 0.55, "pad": 0.6, "hoof": 0.55,
              "leg": 0.85, "ruff": 0.95}
    keep = np.array([weight.get(p_, 1.0) for p_ in soft])
    decimate(body, max(1500, target0 - extra_tris), keep)
    P = settle(body, Bd)
    tau = 0.018 * H
    Wb = Bd.weights(P, tau)
    parts_b = Bd.parts(P, tau)
    # the wet nose: a sheen in the shader's eye channel
    colb = np.array([0.45 if p == "nose" else 0.0 for p in parts_b])
    pob, Wp, Cp, parts_p = pieces_object(name + "_pieces", pcs)
    W = np.vstack([Wb, weight_matrix(Wp)])
    parts = parts_b + parts_p
    col = np.concatenate([colb, np.array(Cp)])
    # join (the body first, so its vertices keep their indices)
    select_only(body)
    pob.select_set(True)
    bpy.context.view_layer.objects.active = body
    bpy.ops.object.join()
    ob = body
    ob.name = name + "_lod0"
    ob.data.name = name + "_lod0"
    # exact normals on the body from the field; the pieces keep their own
    me = ob.data
    for p in me.polygons:
        p.use_smooth = True
    nb = len(P)
    nrm = S.normals(Bd.sdf, P)
    Wl = limit(W)
    apply_weights(ob, Wl)
    set_colors(ob, col)
    # custom normals: the field's on the body, Blender's own on the pieces
    me.update()
    vn = np.array([v.normal[:] for v in me.vertices])
    vn[:nb] = np.stack([nrm[:, 0], -nrm[:, 2], nrm[:, 1]], 1)
    me.normals_split_custom_set_from_vertices([tuple(v) for v in vn])
    unwrap(ob, parts, SCALE_PARTS)
    if verbose:
        print(f"[animals] {name}: surface {n_quads} quads -> {tri_count(ob)} triangles, {len(me.vertices)} vertices, "
              f"UV use {uv_usage(ob):.2f}")
    return ob, parts, ear_j


def far_copy(ob, parts, target):
    """LOD1: the near copy without its claws, cut down to `target` triangles (UVs, weights and colours carried)."""
    lod1 = ob.copy()
    lod1.data = ob.data.copy()
    name = ob.name.replace("_lod0", "_lod1")
    lod1.name = name
    lod1.data.name = name
    bpy.context.scene.collection.objects.link(lod1)
    me = lod1.data
    bm = bmesh.new()
    bm.from_mesh(me)
    bm.verts.ensure_lookup_table()
    kill = [bm.verts[i] for i, p in enumerate(parts) if p == "claw"]
    bmesh.ops.delete(bm, geom=kill, context="VERTS")
    bm.to_mesh(me)
    bm.free()
    S.decimate(lod1, target)
    W = limit(read_weights(lod1))
    apply_weights(lod1, W)
    return lod1
