# The arch rim (Steve, #272, 2026-11-03): one reusable piece for every arched opening the generators make.
# A closed solid band follows the opening's outline (egg, round, or an arch on jambs), one brick wide on its face and
# standing a little proud of the host wall, with rounded worn arrises. Its inner edge stands back from the clear
# opening, so the eye looks past the rim into a one-brick-deep brick reveal (a real step in the geometry) before the
# tunnel or drain lining continues. No separate brick boxes: the voussoirs come from the header-bond texture, charted
# radially (texture courses run round the arch, header heads run outwards), at the true brick size.
#
#   rim(name, outline, host, mat, coll, width=, step=, depth=, proud=, back=, arris=, closed=, masks=, seed=)
#
# outline: (n, 2) points (x, y) of the CLEAR opening in the opening's section plane, in either order. An open outline
#          (an arch on two jambs) ends at the feet, which get rounded arrises; a closed one goes all round.
# host:    the host wall: host.point(x, y, t) -> game points. t runs along the opening's axis from the host face into
#          the wall; t < 0 stands proud of the face. RouteWall (a rui or gallery side wall) and PlaneWall (a flat
#          wall) are below; kit/meet.py adapts a gallery's curved side for tees and throats.
# The band's section at every outline point, in (r outward from the clear outline, t):
#
#      t = -proud      C ______________ B      face: r = step .. step + width, proud of the host face
#                       |              |
#      t = depth    E___|D             |       reveal: rim soffit C-D, then the step face D-E (one header end)
#                   |                  |
#      t = back     F__________________A       hidden back; the lining continues inward from F
#                  r=0  r=step       r=step+width
#
# width and step may be arrays (one per outline point): a ring may thin where its host turns over.
# Charts: U runs round the section (header heads, 0.1 m pitch, outwards across the face and on round the arris into
# the soffit), V along the outline (one texture course, about 6 cm, per voussoir) measured at the face's middle, so
# the joints stand square to the outline. The step face and the back have their own V line (seams in the concave
# reveal corner and the hidden back), which keeps every face within the audit's 1.3 anisotropy for outline radii
# down to about 0.45 m (the 1.0 m egg's crown); use an open outline above a sill where an opening is tighter.
import numpy as np
import bmesh
from mathutils import Vector, geometry
from rlib import util as U
from . import fitlib as FL

WIDTH = 0.23      # face: two rowlock header ends (one brick length), the size of the old pair of header rings
STEP = 0.11       # the reveal step: one header end, so the lining's end course reads as a recessed brick ring
DEPTH = 0.11      # the reveal: one brick deep behind the host face
PROUD = 0.03      # face 3 cm out of the wall: a clear shadow line, and room for a 10 mm round arris on a flat face
BACK = 0.24       # hidden back of the band (a header's length into the wall)
ARRIS = 0.010     # worn brick arris (KIT.md: 8-12 mm)
RELIEF = 0.0      # export relief bake on the rim (wxB alpha). The rim is exported as built (ruien_keep_mesh: no
                  # subdivision, displacement or decimation: edge-collapse decimation skews the narrow faces' charts);
                  # its rounded arrises and reveal are geometry, the mortar relief (under 1 cm) is in the maps
ROW = 0.04        # row spacing along the clear outline
SPACING = [0.06, 0.045, 0.045, 0.04, 0.06, 0.07]   # straight edges leaving A..F: outer side, face, soffit, step, inner soffit, back

class RouteWall:
    """A gallery or rui side wall at route u0 (fitlib.Frame), in true metres: x along the wall, y up, t into the wall
    from its face. In a bend the route's u is not a metre along the wall (it scales with the lateral offset), so x is
    mapped to u at each depth d; W(x, y, d) is the same metric frame for the pieces round the rim (lining, cuts)."""
    def __init__(self, fr, span=2.0, du_step=0.005, d_range=(-2.6, 1.0), d_step=0.05):
        self.fr, self.path, self.sec = fr, fr.path, fr.sec
        # arc length along the wall at each depth d, measured on the route's own world mapping
        self.g = np.arange(-span, span + 1e-9, du_step)
        self.dg = np.arange(d_range[0], d_range[1] + 1e-9, d_step)
        self.X = np.zeros((len(self.dg), len(self.g)))
        for i, d in enumerate(self.dg):
            P = fr.W(self.g, np.zeros_like(self.g), np.full_like(self.g, d))
            X = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
            self.X[i] = X - np.interp(0.0, self.g, X)
    def du(self, x, d):
        """Route du for x metres along the wall at depth d."""
        x, d = np.broadcast_arrays(np.asarray(x, float), np.asarray(d, float))
        f = np.clip((d - self.dg[0]) / (self.dg[1] - self.dg[0]), 0, len(self.dg) - 1.000001)
        i = np.floor(f).astype(int); w = f - i
        out = np.zeros(x.shape)
        for k in np.unique(i):
            m = i == k
            a = np.interp(x[m], self.X[k], self.g); b = np.interp(x[m], self.X[k + 1], self.g)
            out[m] = a * (1 - w[m]) + b * w[m]
        return out
    def W(self, x, y, d):
        x, y, d = np.broadcast_arrays(np.asarray(x, float), np.asarray(y, float), np.asarray(d, float))
        return self.fr.W(self.du(x, d), y, d)
    def d_face(self, y):
        return self.fr.d_face(y)
    def into(self):
        return self.fr.into()
    def along(self):
        return self.fr.along()
    def point(self, x, y, t):
        x, y, t = np.broadcast_arrays(np.asarray(x, float), np.asarray(y, float), np.asarray(t, float))
        return self.W(x, y, self.fr.d_face(y) - t)

class PlaneWall:
    """A flat wall: `origin` on the face, unit horizontal `across` (x) and `into` (t) vectors, y up (game coordinates)."""
    def __init__(self, origin, across, into):
        self.o, self.a, self.n = (np.asarray(v, float) for v in (origin, across, into))
    def point(self, x, y, t):
        x, y, t = np.broadcast_arrays(np.asarray(x, float), np.asarray(y, float), np.asarray(t, float))
        return self.o + x[..., None] * self.a + y[..., None] * np.array([0.0, 1.0, 0.0]) + t[..., None] * self.n

# ------------------------------------------------------------------ outline
def resample(Q, step, closed, values=()):
    """Even spacing along the outline; values (one per input point) are carried along."""
    Q = np.asarray(Q, float)
    Qc = np.vstack([Q, Q[:1]]) if closed else Q
    L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Qc, axis=0), axis=1))]
    n = max(4, int(np.ceil(L[-1] / step)) + (0 if closed else 1))
    a = np.linspace(0, L[-1], n, endpoint=not closed)
    out = np.stack([np.interp(a, L, Qc[:, 0]), np.interp(a, L, Qc[:, 1])], -1)
    if not values:
        return out
    vals = []
    for v in values:
        v = np.asarray(v, float)
        if v.ndim == 0:
            vals.append(np.full(n, float(v)))
        else:
            vals.append(np.interp(a, L, np.r_[v, v[:1]] if closed else v))
    return out, vals

def normals(Q, closed):
    """Unit normals pointing away from the opening, for an outline in either winding."""
    T = (np.roll(Q, -1, 0) - np.roll(Q, 1, 0)) if closed else np.gradient(Q, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    N = np.stack([T[:, 1], -T[:, 0]], -1)
    P = Q if closed else np.vstack([Q, Q[:1]])            # an open outline closes across its feet
    if FL.area2(P) < 0:
        N = -N
    return N

def surface_normals(Q, N, host, closed, eps=0.005, min_scale=0.0):
    """Outward directions that stand square to the outline ON the host face, one metre long there. A host face that
    lies oblique to the opening's axis (a gallery vault over a tee) stretches the section plane's own normals and
    shears them against the outline; these are the host-metric normals (G-orthogonal to the tangent, G = J^T J of the
    face mapping). On a face square to the axis they equal N. min_scale keeps them at least that long in the section
    plane (a host cut sized in the section plane stays covered). Returns (directions, their section-plane length)."""
    T = (np.roll(Q, -1, 0) - np.roll(Q, 1, 0)) if closed else np.gradient(Q, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    z = np.zeros(len(Q))
    Jx = (host.point(Q[:, 0] + eps, Q[:, 1], z) - host.point(Q[:, 0] - eps, Q[:, 1], z)) / (2 * eps)
    Jy = (host.point(Q[:, 0], Q[:, 1] + eps, z) - host.point(Q[:, 0], Q[:, 1] - eps, z)) / (2 * eps)
    gxx = np.sum(Jx * Jx, 1); gxy = np.sum(Jx * Jy, 1); gyy = np.sum(Jy * Jy, 1)
    gT = np.stack([gxx * T[:, 0] + gxy * T[:, 1], gxy * T[:, 0] + gyy * T[:, 1]], -1)
    D = np.stack([gT[:, 1], -gT[:, 0]], -1)
    D *= np.sign(np.sum(D * N, 1))[:, None]
    L = np.sqrt(gxx * D[:, 0] ** 2 + 2 * gxy * D[:, 0] * D[:, 1] + gyy * D[:, 1] ** 2)
    D /= L[:, None]
    sc = np.linalg.norm(D, axis=1)
    if min_scale > 0:
        D *= (np.maximum(sc, min_scale) / sc)[:, None]
        sc = np.maximum(sc, min_scale)
    return D, sc

def outer_outline(outline, offset, closed, row=ROW):
    """The clear outline pushed out by `offset` (for the host cut: step + width less a few mm)."""
    Q = resample(outline, row, closed)
    return Q + normals(Q, closed) * offset

# ------------------------------------------------------------------ section
G_EDGE = [4, 0, 0, 1, 1, 2]     # group of the edge leaving corner A, B, C, D, E, F: 4 outer side, 0 face, 1 reveal step, 2-3 back
                                # (the back is split in its middle: group 3 runs on round A, so each half keeps its own V line)

class Section:
    """The band's section with a fixed vertex count for every row (corners filleted, straight edges split evenly)."""
    def __init__(self, step, width, depth, proud, back, arris, seg=3, spacing=SPACING):
        self.depth, self.proud, self.back, self.arris, self.seg = depth, proud, back, arris, seg
        self.R = [0.005, arris, arris, 0.006, arris, 0.005]   # A, F hidden (5 mm); D concave (a mortar fillet)
        Q = self.corners(step, width)
        P = FL.fillet_polygon(Q, self.R, n=seg + 1)
        k, m = len(Q), seg + 1
        self.counts = [max(2, int(np.ceil(np.linalg.norm(P[((i + 1) % k) * m] - P[i * m + seg]) / spacing[i]))) for i in range(k)]

    def corners(self, step, width):
        W = step + width
        return np.array([(W, self.back), (W, -self.proud), (step, -self.proud), (step, self.depth), (0.0, self.depth), (0.0, self.back)])

    def build(self, step, width):
        Q = self.corners(step, width)
        m = self.seg + 1
        P = FL.fillet_polygon(Q, self.R, n=m)
        pts, grp, tag = [], [], {}
        for i in range(len(Q)):
            c = P[i * m:(i + 1) * m]
            for j, p in enumerate(c):
                if j == m // 2:
                    tag['ABCDEF'[i]] = len(pts)
                pts.append(p); grp.append(0 if i == 1 else (G_EDGE[i - 1] if j < m // 2 else G_EDGE[i]))   # the face's arris B stays with the face
            a, b = c[-1], P[((i + 1) % len(Q)) * m]
            cnt = self.counts[i]
            for f in np.linspace(0, 1, cnt + 1)[1:-1]:
                if abs(f - 0.5) < 0.5 / cnt:
                    tag['ABCDEF'[i] + '>'] = len(pts)       # the middle of the edge leaving this corner
                for q_, nm_ in ((0.25, 'F<'), (0.75, 'A<')):
                    if i == 5 and abs(f - q_) < 0.5 / cnt:
                        tag[nm_] = len(pts)                 # quarter points of the back: its two V lines
                pts.append(a + (b - a) * f); grp.append(3 if (i == 5 and f > 0.5) else G_EDGE[i])
        grp = [3 if (g_ == 2 and k_ < m // 2) else g_ for k_, g_ in enumerate(grp)]   # A's first half: the back's far half
        return np.array(pts), np.array(grp), tag

def _aniso(P, T):
    """RuienUv's measure of one triangle: max(singular ratio, 1/min scale, max scale) (1 = isometric)."""
    e = P[1] - P[0]; f = P[2] - P[0]; x = np.linalg.norm(e); h = np.linalg.norm(np.cross(e, f)) / max(x, 1e-9)
    if x * h < 1e-10:
        return 1.0
    u = (T[1] - T[0]) / x; v = ((T[2] - T[0]) - u * np.dot(f, e / x)) / h
    aa, bb, ab = u @ u, v @ v, u @ v; d = np.sqrt((aa - bb) ** 2 + 4 * ab * ab)
    mx = np.sqrt(max(0, (aa + bb + d) / 2)); mn = np.sqrt(max(0, (aa + bb - d) / 2))
    return max(mx / max(mn, 1e-5), 1 / max(mn, 1e-5), mx)

def _split(V4, U4):
    """The quad's diagonal with the better charts: (0,1,2)+(0,2,3) or (0,1,3)+(1,2,3)."""
    a = max(_aniso(V4[[0, 1, 2]], U4[[0, 1, 2]]), _aniso(V4[[0, 2, 3]], U4[[0, 2, 3]]))
    b = max(_aniso(V4[[0, 1, 3]], U4[[0, 1, 3]]), _aniso(V4[[1, 2, 3]], U4[[1, 2, 3]]))
    return ((0, 1, 2), (0, 2, 3)) if a <= b else ((0, 1, 3), (1, 2, 3))

def _inward(S):
    N = FL.inward(S)
    return N if FL.area2(S) > 0 else -N

# ------------------------------------------------------------------ the piece
def rim(name, outline, host, mat, coll, width=WIDTH, step=STEP, depth=DEPTH, proud=PROUD, back=BACK, arris=ARRIS,
        closed=False, masks=None, seed=0, row=ROW, end_arris=0.004, relief=RELIEF, min_scale=0.0):
    """Build the rim: one closed, smooth-shaded solid with radial brick charts, a 'rnd' brick phase and wxA/wxB/wxC
    masks (masks(P game points, dict of (n,4) arrays) edits them, as fitlib.edit_masks). No collision of its own."""
    Q, (wv, sv) = resample(outline, row, closed, values=(width, step))
    n = len(Q)
    N, _ = surface_normals(Q, normals(Q, closed), host, closed, min_scale=min_scale)
    sec = Section(float(sv.max()), float(wv.max()), depth, proud, back, arris)
    # rows: (outline index, section inset, shift along the outline): open outlines round off at both feet
    rows = [(i, 0.0, 0.0) for i in range(n)]
    T = {}
    if not closed:
        # the feet stand on a sill or step (hidden mating faces): a 4 mm chamfer keeps the smooth shading off the face
        T[0] = (Q[1] - Q[0]) / np.linalg.norm(Q[1] - Q[0])
        T[n - 1] = (Q[-1] - Q[-2]) / np.linalg.norm(Q[-1] - Q[-2])
        e = end_arris
        rows = [(0, e, 0.0), (0, 0.0, e)] + [(i, 0.0, 0.0) for i in range(1, n - 1)] + [(n - 1, 0.0, -e), (n - 1, e, 0.0)]
    nr = len(rows)
    S0, grp, tag = sec.build(float(sv[0]), float(wv[0]))
    m = len(S0)
    PV = np.zeros((nr, m, 3))
    # the reveal runs square to the rim: where the host face lies oblique to the axis (a tee on a vault), the axis
    # has a part along the outline; that part is taken out of every point behind the face (t > 0)
    z = np.zeros(n)
    F0 = host.point(Q[:, 0], Q[:, 1], z)
    T3 = (np.roll(F0, -1, 0) - np.roll(F0, 1, 0)) if closed else np.gradient(F0, axis=0)
    T3 /= np.linalg.norm(T3, axis=1, keepdims=True) + 1e-12
    AX = host.point(Q[:, 0], Q[:, 1], z + 0.01) - F0; AX /= np.linalg.norm(AX, axis=1, keepdims=True)
    a_par = np.sum(AX * T3, 1)
    for k, (i, inset, shift) in enumerate(rows):
        S, _, _ = sec.build(float(sv[i]), float(wv[i]))
        if inset > 0:
            S = S + _inward(S) * inset
        base = Q[i] + (T[i] * shift if shift else 0.0)
        xy = base[None, :] + S[:, 0:1] * N[i][None, :]
        PV[k] = host.point(xy[:, 0], xy[:, 1], S[:, 1]) - (np.maximum(S[:, 1], 0.0) * a_par[i])[:, None] * T3[i][None, :]
    # ---- charts (metres): U round the section from each group's anchor, V along the rows on the group's reference line
    seg = np.linalg.norm(np.roll(PV, -1, axis=1) - PV, axis=2)                       # edge j -> j+1 (wraps)
    cum = np.c_[np.zeros(nr), np.cumsum(seg, 1)]                                        # (nr, m+1); cum[:, m] = loop length
    anchor = {0: tag['C'], 1: tag['E'], 2: tag['F'], 3: tag['A'], 4: tag['A>']}
    ref = {0: tag['B>'], 1: tag['D>'], 2: tag['F<'], 3: tag['A<'], 4: tag['A>']}
    halfA = (sec.seg + 1) // 2                                                          # A's fillet start belongs to the back
    def cu(kk, jj, g):
        c = cum[kk, jj]
        if g == 3 and jj <= halfA:
            c = c + cum[kk, m]
        return c
    Vg = {}
    for g in (0, 1, 2, 3, 4):
        L = np.r_[0, np.cumsum(np.linalg.norm(np.diff(PV[:, ref[g]], axis=0), axis=1))]
        if closed:
            L = np.r_[L, L[-1] + np.linalg.norm(PV[0, ref[g]] - PV[-1, ref[g]])]
        Vg[g] = L
    def uv_of(kk, jj, g, kv=None):
        return np.array([cu(kk, jj, g) - cu(kk, anchor[g], g), Vg[g][kk if kv is None else kv]])
    def chamfer(kc, kb, j, j1, jj1, g):
        # a quad of the foot chamfer: the row-kb edge keeps its chart, the cap row is laid flat at true size from it
        ua, ub = uv_of(kb, j, g), uv_of(kb, jj1, g)
        a, b = PV[kb, j], PV[kb, j1]
        e1 = b - a; L = np.linalg.norm(e1); e1 /= max(L, 1e-9)
        d1 = (ub - ua) / max(np.linalg.norm(ub - ua), 1e-9)
        d2 = np.array([-d1[1], d1[0]])
        if np.dot(d2, np.array([0.0, 1.0 if kc > kb else -1.0])) < 0:
            d2 = -d2
        def lay(p):
            w = p - a; x = np.dot(w, e1); y = np.linalg.norm(w - x * e1)
            return ua + d1 * x + d2 * y
        return {kb: (ua, ub), kc: (lay(PV[kc, j]), lay(PV[kc, j1]))}
    faces, uvs = [], []
    nq = nr if closed else nr - 1
    for k in range(nq):
        k1 = (k + 1) % nr
        kv1 = k + 1                                                                     # V index (nr = wrapped first row)
        for j in range(m):
            j1 = (j + 1) % m
            g = grp[j] if grp[j] == grp[j1] or (grp[j] == 4 and grp[j1] == 0) else grp[j1]
            jj1 = m if j1 == 0 else j1
            f = [k * m + j, k1 * m + j, k1 * m + j1, k * m + j1]
            if not closed and k in (0, nr - 2):
                kc, kb = (0, 1) if k == 0 else (nr - 1, nr - 2)
                c_ = chamfer(kc, kb, j, j1, jj1, g)
                u4 = [c_[k][0], c_[k1][0], c_[k1][1], c_[k][1]]
            else:
                u4 = [uv_of(k, j, g), uv_of(k1, j, g, kv1), uv_of(k1, jj1, g, kv1), uv_of(k, jj1, g)]
            V4 = PV.reshape(-1, 3)[f]; U4 = np.array(u4, float)
            for tri in _split(V4, U4):
                faces.append([f[t] for t in tri]); uvs += [u4[t] for t in tri]
    if not closed:
        # the feet: ear-clipped caps with a metric chart in the cap's plane
        for kk in (0, nr - 1):
            P0 = PV[kk]
            c = P0.mean(0)
            e1 = P0[tag['B']] - P0[tag['F']]; e1 /= np.linalg.norm(e1)
            nn = np.cross(P0[tag['B']] - c, P0[tag['E']] - c); nn /= np.linalg.norm(nn)
            e2 = np.cross(nn, e1)
            pl = [Vector((float(np.dot(p - c, e1)), float(np.dot(p - c, e2)), 0.0)) for p in P0]
            for tri in geometry.tessellate_polygon([pl]):
                faces.append([kk * m + t for t in tri])
                uvs += [(pl[t].x, pl[t].y) for t in tri]
    ob = U.mesh_from_faces(name, PV.reshape(-1, 3), faces, uv=np.array(uvs), coll_=coll, mat=mat, smooth=True)
    bm = bmesh.new(); bm.from_mesh(ob.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(ob.data); bm.free()
    me = ob.data
    # recalc_face_normals points a closed solid outward; check on the face's middle row anyway
    kc = nr // 2
    p = me.polygons[2 * (kc * m + ref[0])]
    probe = host.point(*(Q[rows[kc][0]] + (sv[rows[kc][0]] + wv[rows[kc][0]] / 2) * N[rows[kc][0]]), np.array([-1.0, 0.0]))
    if np.dot(np.array(p.normal), U.g2b(probe[0]) - U.g2b(probe[1])) < 0:
        me.flip_normals()
    rng = np.random.default_rng(seed)
    r = me.attributes.new('rnd', 'FLOAT', 'POINT')
    r.data.foreach_set('value', np.full(len(me.vertices), float(rng.uniform(0, 1)), np.float32))
    def _masks(P, M):
        M['wxB'][:, 3] = relief                       # displacement fade of the export's relief bake
        if masks is not None:
            masks(P, M)
    FL.edit_masks(ob, _masks)
    ob['ruien_collision'] = False
    ob['ruien_keep_mesh'] = True
    ob['ruien_arch_rim'] = '%d rows x %d section points; width %.3f, step %.3f, depth %.3f, proud %.3f' % (nr, m, wv.max(), sv.max(), depth, proud)
    U.add_adaptive(ob)
    return ob

def triangles(ob):
    return int(sum(len(p.vertices) - 2 for p in ob.data.polygons))

def uv_audit(ob, tile=None):
    """RuienUv.Audit's metric on a Blender object (game metres, UVs in metres): (area, stretched area, worst ratio)."""
    me = ob.data
    V = np.array([v.co[:] for v in me.vertices])
    uvl = me.uv_layers['UVMap'].data
    area = bad = worst = 0.0
    for p in me.polygons:
        li = list(p.loop_indices); vi = list(p.vertices)
        for t in range(1, len(vi) - 1):
            a, b, c = (0, t, t + 1)
            P = V[[vi[a], vi[b], vi[c]]]; T = np.array([uvl[li[a]].uv[:], uvl[li[b]].uv[:], uvl[li[c]].uv[:]])
            e = P[1] - P[0]; f = P[2] - P[0]
            x = np.linalg.norm(e); h = np.linalg.norm(np.cross(e, f)) / max(x, 1e-8); w = x * h * 0.5
            if w < 1e-9:
                continue
            u = (T[1] - T[0]) / max(x, 1e-8)
            vv = ((T[2] - T[0]) - u * np.dot(f, e / x)) / h
            aa, bb, ab = u @ u, vv @ vv, u @ vv
            disc = np.sqrt((aa - bb) ** 2 + 4 * ab * ab)
            mx = np.sqrt(max(0, (aa + bb + disc) / 2)); mn = np.sqrt(max(0, (aa + bb - disc) / 2))
            ratio = mx / max(mn, 1e-5)
            area += w
            if ratio > 1.3 or mn < 0.6 or mx > 1.7:
                bad += w
            worst = max(worst, ratio)
    return area, bad, worst
