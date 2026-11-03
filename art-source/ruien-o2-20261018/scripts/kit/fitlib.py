# Shared helpers for the stretch fittings (rail.py, drain_crossing.py): a local frame on the route,
# chamfered iron rods and bevelled boxes, notched stones with rounded arrises, exact boolean cuts of
# the swept host surfaces, mask edits and transparent stain ribbons. Game coordinates throughout.
import json, os
import numpy as np
import bpy
from rlib import util as U, gallery as G, wax as WX

HERE = os.path.dirname(os.path.abspath(__file__))

def data(cls):
    """Fitting numbers for a section class from kit/fittings.json."""
    d = json.load(open(os.path.join(HERE, 'fittings.json')))
    return {k: v.get(cls) for k, v in d.items() if isinstance(v, dict)}

class Frame:
    """W(du, y, d): du along the route from u0, d from the wall face of `side` towards the channel
    (d = 0 on the upright wall plane, negative into the wall)."""
    def __init__(self, path, sec, u0, side):
        self.path, self.sec, self.u0, self.side = path, sec, float(u0), side

    def W(self, du, y, d):
        du, y, d = np.broadcast_arrays(np.asarray(du, float), np.asarray(y, float), np.asarray(d, float))
        return self.path.world(self.u0 + du, self.side * (self.sec.hw - d), y)

    def d_face(self, y):
        """The inside face at height y (curved above the springing)."""
        return self.sec.hw - self.sec.wall_s_at_y(y)

    def into(self):
        """Unit vector into the wall at u0 (horizontal)."""
        px, pz, tx, tz, nx, nz = self.path.frame(np.array(self.u0))
        return self.side * np.array([float(nx), 0.0, float(nz)])

    def along(self):
        px, pz, tx, tz, nx, nz = self.path.frame(np.array(self.u0))
        return np.array([float(tx), 0.0, float(tz)])

def rod(name, pts, r, mat, coll, chamfer=0.002, n=12, ends=(True, True)):
    """Round bar along a polyline with 1-3 mm chamfered ends (no sharp cut rim)."""
    pts = np.asarray(pts, float)
    t0 = pts[1] - pts[0]; t0 /= np.linalg.norm(t0)
    t1 = pts[-1] - pts[-2]; t1 /= np.linalg.norm(t1)
    P, R = [], []
    if ends[0]:
        P += [pts[0], pts[0] + t0 * chamfer]; R += [r - chamfer, r]
    else:
        P += [pts[0]]; R += [r]
    P += list(pts[1:-1]); R += [r] * (len(pts) - 2)
    if ends[1]:
        P += [pts[-1] - t1 * chamfer, pts[-1]]; R += [r, r - chamfer]
    else:
        P += [pts[-1]]; R += [r]
    return U.tube(name, np.array(P), np.array(R), n=n, coll_=coll, mat=mat)

def basis_box(name, centre, ex, ey, ez, size, mat, coll, r=0.002, res=0.02, chips=0, seed=0, chip_size=(0.004, 0.01)):
    """Rounded box of size (sx, sy, sz) along unit axes ex, ey, ez about centre."""
    V, F = U.chipped_block(size[0], size[1], size[2], r=r, res=res, seed=seed, chips=chips, chip_size=chip_size, wobble=0.0002)
    E = np.stack([ex, ey, ez], 0)
    P = np.asarray(centre) + V @ E
    if np.dot(np.cross(ex, ey), ez) < 0:
        F = F[:, ::-1]
    return U.mesh_from_faces(name, P, F, uv=U.box_uv(P, F), coll_=coll, mat=mat)

def frame_box(name, fr, du0, du1, y0, y1, d0, d1, mat, coll, r=0.002, res=0.02, chips=0, seed=0):
    """Box with corners on the frame (follows the route's bend); index = du + 2*y + 4*d."""
    C = np.array([fr.W(du1 if i & 1 else du0, y1 if i & 2 else y0, d1 if i & 4 else d0) for i in range(8)])
    return U.block_object(name, C, mat, coll, r=r, res=res, chips=chips, seed=seed, wobble=0.0002)

# ------------------------------------------------------------------ 2D outlines
def fillet_polygon(Q, radii, n=5):
    """Closed polygon Q (k,2) with a fillet radius per corner (0 = sharp). Returns dense points."""
    Q = np.asarray(Q, float); k = len(Q); out = []
    for i in range(k):
        a, b, c = Q[i - 1], Q[i], Q[(i + 1) % k]
        r = radii[i]
        if r <= 0:
            out.append(b); continue
        d0 = (b - a) / np.linalg.norm(b - a); d1 = (c - b) / np.linalg.norm(c - b)
        ang = np.arccos(np.clip(np.dot(-d0, d1), -1, 1))
        t = r / np.tan(ang / 2)
        t = min(t, np.linalg.norm(b - a) * 0.45, np.linalg.norm(c - b) * 0.45)
        p0, p1 = b - d0 * t, b + d1 * t
        for q in np.linspace(0, 1, n):  # quadratic Bezier through the corner: tangent at both ends
            out.append((1 - q) ** 2 * p0 + 2 * (1 - q) * q * b + q * q * p1)
    return np.array(out)

def resample_closed(Q, step):
    Q = np.asarray(Q, float)
    Qc = np.vstack([Q, Q[:1]])
    seg = np.linalg.norm(np.diff(Qc, axis=0), axis=1)
    L = np.r_[0, np.cumsum(seg)]
    out = []
    for i in range(len(Q)):
        out.append(Q[i])
        m = int(seg[i] / step)
        for j in range(1, m):
            out.append(Q[i] + (Qc[i + 1] - Q[i]) * j / m)
    return np.array(out)

def inward(Q):
    """Unit inward normals of a counter-clockwise closed polygon."""
    T = np.roll(Q, -1, 0) - np.roll(Q, 1, 0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    return np.stack([-T[:, 1], T[:, 0]], -1)

def area2(Q):
    x, y = Q[:, 0], Q[:, 1]
    return 0.5 * np.sum(x * np.roll(y, -1) - np.roll(x, -1) * y)

def notched_stone(name, fr, prof, d0, d1, mat, coll, r_end=(0.009, 0.009), step=0.05, wear=0.0, seed=0, attrs_fn=None):
    """A stone whose section prof (closed CCW polygon in (du, y), arrises already filleted) runs from d0 to d1.
    Both ends get rounded arrises of radius r_end (0 for a hidden mating end). UVs are metric: arc length
    round the section by distance along d on the sides, (du, y) on the ends."""
    Q = np.asarray(prof, float)
    if area2(Q) < 0:
        Q = Q[::-1]
    N = inward(Q)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(np.vstack([Q, Q[:1]]), axis=0), axis=1))][:-1]
    rng = np.random.default_rng(seed)
    st = []  # (d, inset)
    K = 4
    if r_end[0] > 0:
        st += [(d0 + r_end[0] - r_end[0] * np.sin(t), r_end[0] * (1 - np.cos(t))) for t in np.linspace(np.pi / 2, 0, K + 1)]
    else:
        st += [(d0, 0.0)]
    nmid = max(1, int((d1 - d0 - r_end[0] - r_end[1]) / step))
    st += [(dd, 0.0) for dd in np.linspace(d0 + r_end[0], d1 - r_end[1], nmid + 1)[1:-1]]
    if r_end[1] > 0:
        st += [(d1 - r_end[1] + r_end[1] * np.sin(t), r_end[1] * (1 - np.cos(t))) for t in np.linspace(0, np.pi / 2, K + 1)]
    else:
        st += [(d1, 0.0)]
    n = len(Q); m = len(st)
    V = np.zeros((m, n, 3)); UV = np.zeros((m, n, 2))
    wob = 0.0006 * np.sin(Q[:, 0] * 61 + seed) * np.sin(Q[:, 1] * 47 + 1.3 * seed)
    ytop = Q[:, 1].max()
    for j, (dd, e) in enumerate(st):
        q = Q + N * e
        y = q[:, 1] + wob * (1 if 0 < j < m - 1 else 0)
        if wear > 0:
            dish = wear * np.exp(-(q[:, 0] / 0.3) ** 2) * (q[:, 1] > ytop - 1e-4) * np.sin(np.pi * np.clip((dd - d0) / (d1 - d0), 0, 1))
            y = y - dish
        V[j] = fr.W(q[:, 0], y, np.full(n, dd))
        UV[j, :, 0] = arc; UV[j, :, 1] = dd
    F = list(U.grid_faces(m, n, closed_v=True))
    Vf = V.reshape(-1, 3)
    uvl = [UV.reshape(-1, 2)[f] for f in F]
    # end caps: one n-gon each (the section may be concave; Blender triangulates it correctly)
    for j, rev in ((0, True), (m - 1, False)):
        f = [j * n + i for i in range(n)]
        if rev:
            f = f[::-1]
        F.append(f)
        q = Q + N * st[j][1]
        uvl.append(np.stack([q[:, 0], q[:, 1]], -1)[[i - j * n for i in f]])
    # orient: the first side quad must face away from the section centre
    ob = U.mesh_from_faces(name, Vf, F, uv=np.concatenate(uvl), coll_=coll, mat=mat)
    me = ob.data
    c0 = fr.W(np.mean(Q[:, 0]), np.mean(Q[:, 1]), (d0 + d1) / 2)
    p = me.polygons[m // 2 * n if m > 2 else 0]
    cen = np.array(p.center); nn = np.array(p.normal)
    if np.dot(nn, cen - U.g2b(c0)) < 0:
        me.flip_normals()
    if attrs_fn is not None:
        attrs_fn(ob)
    return ob

# ------------------------------------------------------------------ host edits
def signed_volume(V, F):
    V = np.asarray(V, float); vol = 0.0
    for f in F:
        a = V[f[0]]
        for i in range(1, len(f) - 1):
            vol += np.dot(a, np.cross(V[f[i]], V[f[i + 1]]))
    return vol / 6.0

def boolean_cut(ob, cutter_V, cutter_F, coll):
    """Cut a swept host surface with a closed cutter (game coords). Keeps UVs and point attributes.
    The cutter is turned outward first: a frame on the other wall is mirrored and would invert it."""
    cutter_F = [list(f) for f in cutter_F]
    # game -> Blender is a proper rotation, so the sign carries over
    if signed_volume(cutter_V, cutter_F) < 0:
        cutter_F = [f[::-1] for f in cutter_F]
    if ob.get('ruien_level_edge') is None:
        me0 = ob.data
        co = np.zeros(len(me0.vertices) * 3); me0.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        lv = np.zeros(len(me0.loops), np.int64); me0.loops.foreach_get('vertex_index', lv)
        ps = np.zeros(len(me0.polygons), np.int64); me0.polygons.foreach_get('loop_start', ps)
        pt = np.zeros(len(me0.polygons), np.int64); me0.polygons.foreach_get('loop_total', pt)
        nxt = np.arange(len(lv)) + 1; ends = ps + pt - 1; nxt[ends] = ps
        ob['ruien_level_edge'] = float(np.mean(np.linalg.norm(co[lv] - co[lv[nxt]], axis=1)))  # as export_game.mean_edge
    cut = U.mesh_from_faces('__cutter', cutter_V, cutter_F, coll_=coll, smooth=False)
    mods = [(m.name, m.type) for m in ob.modifiers]
    adaptive = any(t == 'SUBSURF' for _, t in mods)
    ob.modifiers.clear()
    bm = ob.modifiers.new('cut', 'BOOLEAN')
    bm.operation = 'DIFFERENCE'; bm.solver = 'EXACT'; bm.object = cut
    bm.use_hole_tolerant = True; bm.use_self = False
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    old = ob.data
    keep = list(old.materials)
    ob.modifiers.clear()
    ob.data = me
    # the cutter has no material: keep the host's own slots only (a relief group bakes one material)
    me.materials.clear()
    for m_ in keep:
        me.materials.append(m_)
    if len(keep) <= 1:
        me.polygons.foreach_set('material_index', np.zeros(len(me.polygons), np.int32))
    while len(ob.material_slots) > len(keep):
        ob.data.materials.pop()
    if old.users == 0:
        bpy.data.meshes.remove(old)
    cm = cut.data; bpy.data.objects.remove(cut); bpy.data.meshes.remove(cm)
    if adaptive:
        U.add_adaptive(ob)
    return ob

def prism(outline, fr, y0, d0, d1):
    """Closed prism: outline (k,2) in (du, y - y0) swept along d from d0 to d1."""
    k = len(outline)
    A = fr.W(outline[:, 0], y0 + outline[:, 1], np.full(k, d0))
    B = fr.W(outline[:, 0], y0 + outline[:, 1], np.full(k, d1))
    V = np.vstack([A, B])
    F = [[i, (i + 1) % k, k + (i + 1) % k, k + i] for i in range(k)] + [list(range(k))[::-1], [k + i for i in range(k)]]
    return V, F

def box_cutter(fr, du0, du1, y0, y1, d0, d1):
    C = np.array([fr.W(du1 if i & 1 else du0, y1 if i & 2 else y0, d1 if i & 4 else d0) for i in range(8)])
    return C, U.BOX_FACES

def mesh_points(ob):
    me = ob.data
    co = np.zeros(len(me.vertices) * 3, np.float32); me.vertices.foreach_get('co', co)
    co = co.reshape(-1, 3) @ np.array(ob.matrix_world)[:3, :3].T + np.array(ob.matrix_world)[:3, 3]
    return np.stack([co[:, 0], co[:, 2], -co[:, 1]], -1)

def edit_masks(ob, fn):
    """fn(P game points, dict of (n,4) arrays) edits wxA/wxB/wxC in place."""
    me = ob.data
    P = mesh_points(ob)
    arrs = {}
    for k in ('wxA', 'wxB', 'wxC'):
        a = me.color_attributes.get(k)
        if a is None:
            a = me.color_attributes.new(k, 'FLOAT_COLOR', 'POINT')
            z = np.zeros((len(P), 4), np.float32)
            if k == 'wxB':
                z[:, 3] = 1
            a.data.foreach_set('color', z.ravel())
        buf = np.zeros(len(P) * 4, np.float32); a.data.foreach_get('color', buf)
        arrs[k] = buf.reshape(-1, 4)
    fn(P, arrs)
    for k, v in arrs.items():
        me.color_attributes[k].data.foreach_set('color', np.clip(v, 0, 1).astype(np.float32).ravel())

def stain(name, pts, nrms, widths, mat, coll, off=0.003):
    """Transparent stain lying on a surface: no plate, no collision (named runoff_*)."""
    ob = WX._ribbon('runoff_' + name, np.asarray(pts), np.asarray(nrms), np.asarray(widths), np.full(len(pts), off), mat, coll, ncross=5)
    ob['ruien_collision'] = False
    return ob

def no_collision(obs):
    for o in obs:
        o['ruien_collision'] = False
    return obs
