"""The mesh kit of the churchyard models (churchyard.py): rounded stone blocks, bevelled extrusions, lathes, rings, iron
bars and beams, the lettered panels; vertex-colour weathering. Every corner is 16 floats (build-churchyard.gd): position,
normal, uv, 0 0, colour rgba, 0 0. Godot's front face winds clockwise: (b - a) x (c - a) points into the solid.
Lengths in metres; the stone's picture covers STONE_UV metres, the iron's IRON_UV.
"""
import math
import numpy as np
from scipy.spatial import Delaunay

STONE_UV = 1.2
IRON_UV = 0.5


class Model:
    """Triangles per material, collision boxes, ground holes (all in the model's own frame)."""
    def __init__(self, name, seed):
        self.name = name; self.seed = seed
        self.tris = {}          # mat -> list of (P (n,3,3), N (n,3,3), UV (n,3,2), C (n,3,4) or None)
        self.boxes = []         # [cx, cy, cz, sx, sy, sz, yaw]
        self.holes = []         # [x0, z0, x1, z1] in the model frame (yaw 0 or pi only)
        self.tint = {}          # mat -> function(P, N, E, AO) -> colours (n,3,4)
        self.occ = []           # the solids that shade one another: oriented boxes (centre, axes 3x3, half sizes)
        self.edge = {}          # mat -> per-corner arris weight (0 a face, 1 on a rounded arris), with the triangles

    def add(self, mat, P, N, UV, C=None, E=None):
        P = np.asarray(P, float).reshape(-1, 3, 3); N = np.asarray(N, float).reshape(-1, 3, 3)
        UV = np.asarray(UV, float).reshape(-1, 3, 2)
        E = np.zeros(P.shape[:2]) if E is None else np.asarray(E, float).reshape(-1, 3).copy()
        # winding: (b - a) x (c - a) against the corners' mean normal
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        flip = (cr * N.mean(1)).sum(1) > 0
        for A in (P, N, UV, E) + ((C,) if C is not None else ()):
            A[flip] = A[flip][:, [0, 2, 1]]
        keep = np.linalg.norm(cr, axis=1) > 1e-12
        self.tris.setdefault(mat, []).append((P[keep], N[keep], UV[keep], None if C is None else C[keep]))
        self.edge.setdefault(mat, []).append(E[keep])

    def occluder(self, lo, hi, R=None, t=(0, 0, 0), shrink=0.0):
        """A solid block that shades its neighbours (the AO bake): the box lo..hi, turned by R and moved by t."""
        lo, hi = np.asarray(lo, float) + shrink, np.asarray(hi, float) - shrink
        if (hi - lo).min() <= 0.004 or (hi - lo).max() < 0.05: return
        R = np.eye(3) if R is None else np.asarray(R, float)
        self.occ.append((R @ ((lo + hi) / 2) + np.asarray(t, float), R.copy(), (hi - lo) / 2))

    def box(self, lo, hi, yaw=0.0):
        lo, hi = np.asarray(lo, float), np.asarray(hi, float)
        self.boxes.append([*((lo + hi) / 2).round(4).tolist(), *(hi - lo).round(4).tolist(), round(yaw, 4)])

    def rows(self, mat):
        """The corners as 16 floats; the arris weight rides in float 8 until the tint has read it."""
        out = []
        for (P, N, UV, C), E in zip(self.tris.get(mat, []), self.edge.get(mat, [])):
            if C is None: C = np.ones(P.shape[:2] + (4,))
            out.append(np.concatenate([P, N, UV, E[..., None], np.zeros(P.shape[:2] + (1,)), C, np.zeros(P.shape[:2] + (2,))], axis=2))
        return np.concatenate(out).astype(np.float32) if out else np.zeros((0, 3, 16), np.float32)

    def transform(self, R):
        """Turns everything (a leaning stone): triangles, normals and the occluders."""
        for mat, lst in self.tris.items():
            self.tris[mat] = [(P @ R.T, N @ R.T, U, C) for P, N, U, C in lst]
        self.occ = [(R @ c, R @ A, h) for c, A, h in self.occ]

    def count(self):
        return sum(len(t[0]) for v in self.tris.values() for t in v)


# ---------------------------------------------------------------- transforms
def rot_y(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])

def rot_x(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])

def rot_z(a):
    c, s = math.cos(a), math.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])

def xform(P, N, R=None, t=(0, 0, 0)):
    if R is not None: P = P @ R.T; N = N @ R.T
    return P + np.asarray(t, float), N


def grid_tris(Q, Nq, UVq):
    """A (nu, nv) grid of points into triangles."""
    a, b, c, d = (slice(None, -1), slice(None, -1)), (slice(1, None), slice(None, -1)), (slice(1, None), slice(1, None)), (slice(None, -1), slice(1, None))
    def take(A, s): return A[s].reshape(-1, A.shape[-1])
    P = np.stack([np.concatenate([take(Q, a), take(Q, a)]), np.concatenate([take(Q, b), take(Q, c)]), np.concatenate([take(Q, c), take(Q, d)])], 1)
    N = np.stack([np.concatenate([take(Nq, a), take(Nq, a)]), np.concatenate([take(Nq, b), take(Nq, c)]), np.concatenate([take(Nq, c), take(Nq, d)])], 1)
    U = np.stack([np.concatenate([take(UVq, a), take(UVq, a)]), np.concatenate([take(UVq, b), take(UVq, c)]), np.concatenate([take(UVq, c), take(UVq, d)])], 1)
    return P, N, U


# ---------------------------------------------------------------- rounded block
def axis_coords(lo, hi, r, step, k=3):
    if r <= 1e-5:
        return np.linspace(lo, hi, max(1, int(math.ceil((hi - lo) / step))) + 1)
    th = np.radians(np.linspace(45, 0, k + 1))
    a = lo + r - r * np.tan(th)
    n = max(1, int(math.ceil((hi - lo - 2 * r) / step)))
    mid = np.linspace(lo + r, hi - r, n + 1)
    b = hi - r + r * np.tan(th[::-1])
    return np.concatenate([a[:-1], mid, b[1:]])

STONES = ('stone', 'letters', 'ashlar', 'carved', 'carved_hi')

def rbox(m, mat, lo, hi, r, step=0.15, R=None, t=(0, 0, 0), taper=None, skip=((1, 0),), uv=STONE_UV, uvo=(0.0, 0.0), k=2, sag=None,
         wear=None, chips=None, occlude=True):
    """A block with every edge rounded (radius r): a box's faces in a grid, pushed out round the inner box.
    taper: (fx, fz) the top's size against the bottom's (an obelisk's shaft); skip: faces left out, (axis, side);
    sag: function(P) -> dy, a worn top.
    Stone wears unevenly (AGENTS.md: worn arrises 5 to 15 mm, occasional chips): `wear` (m, stone 0.005) eats into the
    rounded arris by a noise along it, so the radius wanders between r and r + wear; `chips` (stone 0.3) is the chance that a
    corner has lost a 15 to 30 mm piece. Iron keeps its even cast or forged edge."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    stone = mat in STONES
    if wear is None: wear = 0.007 if stone else 0.0
    if chips is None: chips = 0.45 if stone else 0.0
    r = min(r, 0.49 * float((hi - lo).min()))
    ilo, ihi = lo + r, hi - r
    # where a worn arris runs, the grid is finer along it (wear needs points to show)
    step_e = min(step, 0.05) if wear > 0 else step
    co = [axis_coords(lo[i], hi[i], r, step_e if (hi[i] - lo[i]) < 0.7 else step, k) for i in range(3)]
    seed = int(abs(hash((round(float(lo.sum()), 4), round(float(hi.sum()), 4), m.seed))) % 100000)
    g = np.random.default_rng(seed)
    corners = [(np.array([hi[0] if a else lo[0], hi[1] if b else lo[1], hi[2] if c else lo[2]]), g.uniform(0.015, 0.035))
               for a in (0, 1) for b in (0, 1) for c in (0, 1) if g.random() < chips]
    if occlude: m.occluder(lo, hi, R, t, shrink=r * 0.8)
    for a in range(3):
        u, v = [(1, 2), (2, 0), (0, 1)][a]
        for s in (0, 1):
            if (a, s) in skip: continue
            U, V = np.meshgrid(co[u], co[v], indexing='ij')
            P = np.zeros(U.shape + (3,)); P[..., a] = hi[a] if s else lo[a]; P[..., u] = U; P[..., v] = V
            C = np.clip(P, ilo, ihi); D = P - C
            L = np.linalg.norm(D, axis=-1, keepdims=True)
            Nn = np.where(L > 1e-9, D / np.maximum(L, 1e-12), 0.0)
            Nn[..., a] = np.where(L[..., 0] > 1e-9, Nn[..., a], 1.0 if s else -1.0)
            Q = C + max(r, 0.0) * Nn if r > 1e-5 else P.copy()
            # the arris: how far round the rounding the point lies (0 on a face, 1 in the middle of the arris)
            E = np.clip((1 - np.abs(Nn[..., a])) / 0.293, 0, 1) if r > 1e-5 else np.zeros(U.shape)
            if wear > 0 and r > 1e-5:
                # the arris worn back unevenly: deepest in patches, along the arris
                n1 = vnoise(P * np.array([1.0, 1.0, 1.0]), 9.0, seed)
                n2 = vnoise(P, 31.0, seed + 5)
                eat = wear * np.clip(1.4 * n1 + 0.5 * n2 - 0.35, 0, 1.6) * E
                Q = Q - Nn * eat[..., None]
            for c0, size in corners:
                d = np.linalg.norm(P - c0, axis=-1)
                bite = np.clip(1 - d / size, 0, 1) ** 1.5 * size * 0.55
                towards = (lo + hi) / 2 - c0; towards /= np.linalg.norm(towards)
                Q = Q + towards * bite[..., None]
                E = np.maximum(E, np.clip(1 - d / size, 0, 1))
            # the picture laid flat on each face (top and bottom: x, z)
            if a == 1: UVq = np.stack([P[..., 0], P[..., 2]], -1)
            elif a == 0: UVq = np.stack([P[..., 2] * (1 if s else -1), -P[..., 1]], -1)
            else: UVq = np.stack([P[..., 0] * (-1 if s else 1), -P[..., 1]], -1)
            UVq = UVq / uv + np.asarray(uvo)
            if taper is not None:
                cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
                h = hi[1] - lo[1]
                fy = (Q[..., 1] - lo[1]) / h
                fx = 1 + (taper[0] - 1) * fy; fz = 1 + (taper[1] - 1) * fy
                dx = (Q[..., 0] - cx); dz = (Q[..., 2] - cz)
                Q2 = Q.copy(); Q2[..., 0] = cx + dx * fx; Q2[..., 2] = cz + dz * fz
                # normal: inverse transpose of the map's Jacobian
                dfx, dfz = (taper[0] - 1) / h, (taper[1] - 1) / h
                n = Nn.copy()
                nx = n[..., 0] / fx; nz = n[..., 2] / fz
                ny = n[..., 1] - nx * dx * dfx - nz * dz * dfz
                Nn = np.stack([nx, ny, nz], -1); Nn /= np.linalg.norm(Nn, axis=-1, keepdims=True)
                Q = Q2
            if sag is not None:
                Q = Q.copy(); Q[..., 1] += sag(Q)
            Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
            Et = grid_tris(np.repeat(E[..., None], 3, -1), Nn, UVq)[0][..., 0]
            Pt, Nt = xform(Pt, Nt, R, t)
            m.add(mat, Pt, Nt, Ut, E=Et)


# ---------------------------------------------------------------- outlines and extrusions
def fillet(outline, rad, n=4):
    """Rounds every corner of a convex outline (counter-clockwise, x y)."""
    o = np.asarray(outline, float); out = []
    for i in range(len(o)):
        p0, p1, p2 = o[i - 1], o[i], o[(i + 1) % len(o)]
        a = p0 - p1; b = p2 - p1
        la, lb = np.linalg.norm(a), np.linalg.norm(b)
        if la < 1e-9 or lb < 1e-9: continue
        a /= la; b /= lb
        cosang = np.clip((a * b).sum(), -1, 1); ang = math.acos(cosang)
        if ang > math.radians(175) or rad <= 0:
            out.append(p1); continue
        d = min(rad / math.tan(ang / 2), 0.45 * la, 0.45 * lb)
        rr = d * math.tan(ang / 2)
        s, e = p1 + a * d, p1 + b * d
        bis = (a + b) / np.linalg.norm(a + b); c = p1 + bis * rr / math.sin(ang / 2)
        t0, t1 = math.atan2(*(s - c)[::-1]), math.atan2(*(e - c)[::-1])
        dt = (t1 - t0 + math.pi) % (2 * math.pi) - math.pi
        for j in range(n + 1):
            tt = t0 + dt * j / n
            out.append(c + rr * np.array([math.cos(tt), math.sin(tt)]))
    return np.array(out)

def densify(o, step):
    o = np.asarray(o, float); out = []
    for i in range(len(o)):
        p, q = o[i], o[(i + 1) % len(o)]
        n = max(1, int(math.ceil(np.linalg.norm(q - p) / step)))
        for j in range(n): out.append(p + (q - p) * j / n)
    return np.array(out)

def vnormals(o):
    """Outward normals at the outline's corners (counter-clockwise outline)."""
    e = np.roll(o, -1, 0) - o
    en = np.stack([e[:, 1], -e[:, 0]], 1); en /= np.linalg.norm(en, axis=1, keepdims=True)
    vn = en + np.roll(en, 1, 0); vn /= np.linalg.norm(vn, axis=1, keepdims=True)
    cosh = (vn * en).sum(1)
    return vn, cosh

def inset(o, d):
    vn, cosh = vnormals(o)
    return o - vn * (d / np.maximum(cosh, 0.3))[:, None]

def cap(o, step):
    """Triangles filling a convex outline: a grid inside it and its edge points."""
    x0, y0 = o.min(0); x1, y1 = o.max(0)
    gx = np.arange(x0 + step / 2, x1, step); gy = np.arange(y0 + step / 2, y1, step)
    G = np.array(np.meshgrid(gx, gy)).reshape(2, -1).T if len(gx) and len(gy) else np.zeros((0, 2))
    if len(G):
        e = np.roll(o, -1, 0) - o
        inside = np.all((G[:, None, 0] - o[None, :, 0]) * e[None, :, 1] - (G[:, None, 1] - o[None, :, 1]) * e[None, :, 0] < -step * 0.35, axis=1)
        G = G[inside]
    pts = np.concatenate([o, G]); _, keep = np.unique(np.round(pts, 5), axis=0, return_index=True); pts = pts[np.sort(keep)]
    tri = Delaunay(pts).simplices
    return pts, tri

def prism(m, mat, outline, z0, z1, r, step=0.06, R=None, t=(0, 0, 0), k=3, uv=STONE_UV, uvo=(0.0, 0.0), back=True, front=True):
    """A convex outline (x y, counter-clockwise, corners already filleted) extruded from z0 to z1 with its front and
    back arrises rounded (radius r)."""
    o = densify(np.asarray(outline, float), step)
    vn, _ = vnormals(o)
    s = np.concatenate([[0], np.cumsum(np.linalg.norm(np.roll(o, -1, 0) - o, axis=1))])
    n = len(o)
    # side wall from back ring to front ring, with the bevel rings
    phis = np.linspace(0, math.pi / 2, k + 1)
    rings = []   # (z, inset, normal-z weight, xy weight)
    for ph in phis[::-1]:   # back bevel: from the back cap's edge to the wall
        rings.append((z0 + r - r * math.sin(ph), r * (1 - math.cos(ph)), -math.sin(ph), math.cos(ph)))
    nz = max(1, int(math.ceil((z1 - z0 - 2 * r) / step)))
    for j in range(1, nz):
        rings.append((z0 + r + (z1 - z0 - 2 * r) * j / nz, 0.0, 0.0, 1.0))
    for ph in phis:
        rings.append((z1 - r + r * math.sin(ph), r * (1 - math.cos(ph)), math.sin(ph), math.cos(ph)))
    if not back: rings = [g for g in rings if g[2] >= 0]
    if not front: rings = [g for g in rings if g[2] <= 0]
    ob = np.asarray(outline, float)
    lo2, hi2 = ob.min(0), ob.max(0)
    area = 0.5 * abs(np.dot(ob[:, 0], np.roll(ob[:, 1], 1)) - np.dot(ob[:, 1], np.roll(ob[:, 0], 1)))
    f = math.sqrt(min(1.0, area / max((hi2 - lo2).prod(), 1e-9)))
    mid = ob.mean(0) if f < 0.9 else (lo2 + hi2) / 2
    lo2, hi2 = mid - (mid - lo2) * f, mid + (hi2 - mid) * f
    m.occluder((lo2[0], lo2[1], z0), (hi2[0], hi2[1], z1), R, t, shrink=r)
    ring_pts = []
    for z, d, wz, wxy in rings:
        q = inset(o, d)
        P = np.concatenate([q, np.full((n, 1), z)], 1)
        N = np.concatenate([vn * wxy, np.full((n, 1), wz)], 1)
        ring_pts.append((P, N, z))
    Q = np.stack([np.concatenate([p, p[:1]]) for p, _, _ in ring_pts], 1)       # (n+1, rings, 3)
    Nn = np.stack([np.concatenate([nn, nn[:1]]) for _, nn, _ in ring_pts], 1)
    UVq = np.stack([np.stack([s / uv, np.full(n + 1, z / uv)], -1) for _, _, z in ring_pts], 1) + np.asarray(uvo)
    Eq = np.stack([np.full(n + 1, min(1.0, abs(wz) / 0.7)) for _, _, wz, _ in rings], 1)
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    Et = grid_tris(np.repeat(Eq[..., None], 3, -1), Nn, UVq)[0][..., 0]
    Pt, Nt = xform(Pt, Nt, R, t)
    m.add(mat, Pt, Nt, Ut, E=Et)
    for zc, sgn, on in ((z1, 1, front), (z0, -1, back)):
        if not on: continue
        q = inset(o, r)
        pts, tri = cap(q, step)
        P = np.concatenate([pts, np.full((len(pts), 1), zc)], 1)[tri]
        N = np.tile([0, 0, sgn], P.shape[:2] + (1,)).astype(float)
        U = P[..., :2] * np.array([sgn, -1]) / uv + np.asarray(uvo)
        P, N = xform(P, N, R, t)
        m.add(mat, P, N, U)


# ---------------------------------------------------------------- lathes, rings, iron
def lathe(m, mat, prof, seg=16, R=None, t=(0, 0, 0), uv=STONE_UV, uvo=(0.0, 0.0)):
    """A turned solid: prof [(radius, y)] from the bottom up; smooth normals from the profile."""
    pr = np.asarray(prof, float)
    rm_ = pr[:, 0].max()
    if R is None: m.occluder((-rm_ * 0.75, pr[:, 1].min(), -rm_ * 0.75), (rm_ * 0.75, pr[:, 1].max(), rm_ * 0.75), None, t)
    d = np.gradient(pr, axis=0); d /= np.maximum(np.linalg.norm(d, axis=1, keepdims=True), 1e-9)
    nr, ny = d[:, 1], -d[:, 0]            # outward normal of the profile (radius, y)
    th = np.linspace(0, 2 * math.pi, seg + 1)
    ct, st = np.cos(th), np.sin(th)
    Q = np.stack([pr[None, :, 0] * ct[:, None], np.broadcast_to(pr[None, :, 1], (seg + 1, len(pr))), pr[None, :, 0] * st[:, None]], -1)
    Nn = np.stack([nr[None, :] * ct[:, None], np.broadcast_to(ny[None, :], (seg + 1, len(pr))), nr[None, :] * st[:, None]], -1)
    arc = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pr, axis=0), axis=1))])
    rm = max(pr[:, 0].mean(), 0.02)
    UVq = np.stack([np.broadcast_to(th[:, None] * rm / uv, Q.shape[:2]), np.broadcast_to(-arc[None, :] / uv, Q.shape[:2])], -1) + np.asarray(uvo)
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    Pt, Nt = xform(Pt, Nt, R, t)
    m.add(mat, Pt, Nt, Ut)

def torus(m, mat, Rr, r, seg=16, sides=8, R=None, t=(0, 0, 0), uv=IRON_UV):
    """A ring lying in the x z plane."""
    a = np.linspace(0, 2 * math.pi, seg + 1); b = np.linspace(0, 2 * math.pi, sides + 1)
    A, B = np.meshgrid(a, b, indexing='ij')
    Nn = np.stack([np.cos(A) * np.cos(B), np.sin(B), np.sin(A) * np.cos(B)], -1)
    Q = np.stack([np.cos(A) * Rr, np.zeros_like(A), np.sin(A) * Rr], -1) + Nn * r
    UVq = np.stack([A * Rr / uv, B * r / uv], -1)
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    Pt, Nt = xform(Pt, Nt, R, t)
    m.add(mat, Pt, Nt, Ut)

def section(w, h, ch):
    """A rectangle w x h with its corners chamfered by ch: eight corners round its middle, counter-clockwise."""
    a, b = w / 2, h / 2
    return np.array([[a, -b + ch], [a, b - ch], [a - ch, b], [-a + ch, b], [-a, b - ch], [-a, -b + ch], [-a + ch, -b], [a - ch, -b]])

def beam(m, mat, a, b, w, h, ch=0.002, uv=IRON_UV, segs=None, ends=True):
    """A chamfered bar from a to b; its section w (sideways, level) x h (up)."""
    a, b = np.asarray(a, float), np.asarray(b, float)
    d = b - a; L = np.linalg.norm(d); f = d / L
    up = np.array([0, 1.0, 0]) if abs(f[1]) < 0.9 else np.array([1.0, 0, 0])
    side = np.cross(up, f); side /= np.linalg.norm(side); up2 = np.cross(f, side)
    m.occluder((-w / 2, -h / 2, 0), (w / 2, h / 2, L), np.stack([side, up2, f], 1), a)
    sec = section(w, h, ch); n = len(sec)
    vn, _ = vnormals(sec)
    segs = segs or max(1, int(math.ceil(L / 0.25)))
    ts = np.linspace(0, 1, segs + 1)
    Q = a[None, None, :] + ts[None, :, None] * d[None, None, :] + sec[:, None, 0:1] * side + sec[:, None, 1:2] * up2
    Nn = np.broadcast_to((vn[:, None, 0:1] * side + vn[:, None, 1:2] * up2), Q.shape)
    perim = np.concatenate([[0], np.cumsum(np.linalg.norm(np.roll(sec, -1, 0) - sec, axis=1))])[:n]
    UVq = np.stack([np.broadcast_to(ts[None, :] * L / uv, (n, segs + 1)), np.broadcast_to(perim[:, None] / uv, (n, segs + 1))], -1)
    Q = np.concatenate([Q, Q[:1]]); Nn = np.concatenate([Nn, Nn[:1]]); UVq = np.concatenate([UVq, UVq[:1] + [0, (perim[-1] + np.linalg.norm(sec[0] - sec[-1])) / uv]])
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    m.add(mat, Pt, Nt, Ut)
    if ends:
        for p, sg in ((a, -1), (b, 1)):
            c = sec[:, 0:1] * side + sec[:, 1:2] * up2 + p
            P = np.stack([np.broadcast_to(p, (n, 3)), c, np.roll(c, -1, 0)], 1)
            N = np.broadcast_to(f * sg, P.shape)
            U = np.stack([np.zeros((n, 2)), sec / uv, np.roll(sec, -1, 0) / uv], 1)
            m.add(mat, P, N.copy(), U)

def bar(m, mat, x, z, y0, y1, w=0.016, tip=0.04, R=None, t=(0, 0, 0), ch=0.003):
    """An upright square bar with chamfered arrises and a pointed top (tip: the point's height; 0 flat)."""
    sec = section(w, w, ch); n = len(sec)
    vn, _ = vnormals(sec)
    ys = np.linspace(y0, y1, max(2, int(math.ceil((y1 - y0) / 0.3)) + 1))
    Q = np.stack([np.stack([sec[:, 0] + x, np.full(n, y), sec[:, 1] + z], -1) for y in ys], 1)
    Nn = np.broadcast_to(np.stack([vn[:, 0], np.zeros(n), vn[:, 1]], -1)[:, None, :], Q.shape)
    perim = np.arange(n) * w / 2
    UVq = np.stack([np.broadcast_to(perim[:, None] / IRON_UV, Q.shape[:2]), np.broadcast_to(-ys[None, :] / IRON_UV, Q.shape[:2])], -1)
    Q = np.concatenate([Q, Q[:1]]); Nn = np.concatenate([Nn, Nn[:1]]); UVq = np.concatenate([UVq, UVq[:1] + [4 * w / IRON_UV, 0]])
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    Pt, Nt = xform(Pt, Nt, R, t)
    m.add(mat, Pt, Nt, Ut)
    top = np.array([x, y1 + tip, z]); ring = np.stack([sec[:, 0] + x, np.full(n, y1), sec[:, 1] + z], -1)
    P = np.stack([np.broadcast_to(top, (n, 3)), ring, np.roll(ring, -1, 0)], 1)
    cn = (ring + np.roll(ring, -1, 0)) / 2 - np.array([x, y1, z]); cn /= np.linalg.norm(cn, axis=1, keepdims=True)
    slope = (w / 2) / max(tip, 1e-3)
    N = cn.copy(); N[:, 1] = slope; N /= np.linalg.norm(N, axis=1, keepdims=True)
    N = np.broadcast_to(N[:, None, :], P.shape).copy()
    U = P[..., [0, 1]] / IRON_UV
    P, N = xform(P, N, R, t)
    m.add(mat, P, N, U)

def spear(m, mat, x, z, y, w=0.016, h=0.07):
    """A cast spear head on a bar's top at (x, y, z): a small collar and a leaf-shaped point."""
    lathe(m, mat, [(0.0, y - 0.004), (w * 0.75, y - 0.003), (w * 0.85, y + 0.006), (w * 0.55, y + 0.012), (w * 1.25, y + 0.03),
                   (w * 1.1, y + 0.045), (w * 0.4, y + h * 0.9), (0.0, y + h)], seg=8, t=(x, 0, z), uv=IRON_UV)


# ---------------------------------------------------------------- lettered panels
def panel(m, rect, centre, right, up, w, h, step=0.05, R=None, t=(0, 0, 0)):
    """A lettered face: the atlas rectangle (u0, v0, u1, v1) on a w x h rectangle; its normal is right x up."""
    centre, right, up = (np.asarray(v, float) for v in (centre, right, up))
    nu, nv = max(1, int(math.ceil(w / step))), max(1, int(math.ceil(h / step)))
    U, V = np.meshgrid(np.linspace(0, 1, nu + 1), np.linspace(0, 1, nv + 1), indexing='ij')
    Q = centre + (U[..., None] - 0.5) * w * right + (V[..., None] - 0.5) * h * up
    nrm = np.cross(right, up); nrm /= np.linalg.norm(nrm)
    Nn = np.broadcast_to(nrm, Q.shape)
    u0, v0, u1, v1 = rect
    UVq = np.stack([u0 + U * (u1 - u0), v1 - V * (v1 - v0)], -1)
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    Pt, Nt = xform(Pt, Nt, R, t)
    m.add('letters', Pt, Nt, Ut)

def frame(m, centre, right, up, w, h, bead=0.02, proud=0.008, r=0.004, R=None, t=(0, 0, 0)):
    """A raised moulded border round a lettered panel."""
    centre, right, up = (np.asarray(v, float) for v in (centre, right, up))
    nrm = np.cross(right, up); nrm /= np.linalg.norm(nrm)
    B = np.stack([right, up, nrm], 1)          # local x y z -> world
    for (cx, cy, sx, sy) in ((0, (h + bead) / 2, w + 2 * bead, bead), (0, -(h + bead) / 2, w + 2 * bead, bead),
                             ((w + bead) / 2, 0, bead, h), (-(w + bead) / 2, 0, bead, h)):
        lo = np.array([cx - sx / 2, cy - sy / 2, -0.01]); hi = np.array([cx + sx / 2, cy + sy / 2, proud])
        RR = B if R is None else R @ B
        tt = centre if R is None else R @ centre + np.asarray(t)
        rbox(m, 'stone', lo, hi, r, step=0.12, R=RR, t=tt, k=2, skip=((2, 0),))


# ---------------------------------------------------------------- the shade of the solids round a point (AO)
def _hemisphere(n):
    """n directions over a hemisphere round +z, cosine weighted (a fixed spiral: the same every run)."""
    k = np.arange(n) + 0.5
    r = np.sqrt(k / n); phi = k * math.pi * (3 - math.sqrt(5))
    return np.stack([r * np.cos(phi), r * np.sin(phi), np.sqrt(1 - r * r)], -1)

def bake_ao(P, N, occ, ground=True, holes=(), reach=0.6, rays=40, chunk=384):
    """How much of the sky a point does not see within `reach` m, 0 open to 1 shut: rays over the point's hemisphere against
    the occluders (oriented boxes) and the ground (y 0, open over `holes`: x0 z0 x1 z1). A ray that starts inside a box (the
    point's own block) does not count it. Near hits count more (1 - t / reach)."""
    P = np.asarray(P, float); N = np.asarray(N, float)
    out = np.zeros(len(P))
    if len(P) == 0: return out
    H = _hemisphere(rays)
    C = np.array([o[0] for o in occ]) if occ else np.zeros((0, 3))
    A = np.array([o[1] for o in occ]) if occ else np.zeros((0, 3, 3))
    Hh = np.array([o[2] for o in occ]) if occ else np.zeros((0, 3))
    rad = np.linalg.norm(Hh, axis=1) if occ else np.zeros(0)
    order = np.lexsort((np.round(P[:, 2] / 0.5), np.round(P[:, 0] / 0.5), np.round(P[:, 1] / 0.5)))
    for s0 in range(0, len(P), chunk):
        idx = order[s0:s0 + chunk]
        p, n = P[idx], N[idx]
        # a frame round each normal
        a = np.where(np.abs(n[:, 1:2]) < 0.9, np.array([[0, 1.0, 0]]), np.array([[1.0, 0, 0]]))
        tx = np.cross(a, n); tx /= np.linalg.norm(tx, axis=1, keepdims=True); ty = np.cross(n, tx)
        D = H[None, :, 0:1] * tx[:, None] + H[None, :, 1:2] * ty[:, None] + H[None, :, 2:3] * n[:, None]   # (c, r, 3)
        O = p + n * 0.006
        best = np.zeros(D.shape[:2])
        if len(C):
            lo, hi = O.min(0) - reach, O.max(0) + reach
            near = np.all((C + rad[:, None] >= lo) & (C - rad[:, None] <= hi), axis=1)
            for b in np.nonzero(near)[0]:
                o = (O - C[b]) @ A[b]                      # (c, 3) in the box's frame
                d = D @ A[b]                               # (c, r, 3)
                with np.errstate(divide='ignore', invalid='ignore'):
                    inv = 1.0 / np.where(np.abs(d) < 1e-9, 1e-9, d)
                    t1 = (-Hh[b] - o[:, None]) * inv; t2 = (Hh[b] - o[:, None]) * inv
                tmin = np.minimum(t1, t2).max(-1); tmax = np.maximum(t1, t2).min(-1)
                hit = (tmax >= tmin) & (tmin > 0) & (tmin < reach)
                best = np.maximum(best, np.where(hit, 1 - tmin / reach, 0))
        if ground:
            up = O[:, 1:2]
            with np.errstate(divide='ignore', invalid='ignore'):
                t = np.where(D[..., 1] < -1e-6, up / -D[..., 1], np.inf)
            hit = (up > -0.001) & (t < reach)
            if len(holes):
                X = O[:, None, 0] + D[..., 0] * np.where(np.isfinite(t), t, 0); Z = O[:, None, 2] + D[..., 2] * np.where(np.isfinite(t), t, 0)
                for h in holes:
                    hit &= ~((X > h[0]) & (X < h[2]) & (Z > h[1]) & (Z < h[3]))
            best = np.maximum(best, np.where(hit, 1 - np.clip(t, 0, reach) / reach, 0))
        out[idx] = best.mean(1)
    return out

def corner_ao(R, occ, ground=True, holes=(), reach=0.6):
    """bake_ao for the rows of a material (n, 3, 16): once per distinct point and normal."""
    P = R[:, :, 0:3].reshape(-1, 3).astype(float); N = R[:, :, 3:6].reshape(-1, 3).astype(float)
    key = np.round(np.concatenate([P * 2000, N * 50], 1)).astype(np.int64)
    _, first, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    ao = bake_ao(P[first], N[first], occ, ground, holes, reach)
    return ao[inv.reshape(-1)].reshape(R.shape[:2])


# ---------------------------------------------------------------- weathering
def _hash(ix, iy, iz, seed):
    n = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791) ^ (seed * 2654435761)
    n = (n ^ (n >> 13)) * 1274126177
    n = n ^ (n >> 16)
    return (n & 0xffff) / 65535.0

def vnoise(P, freq, seed):
    p = P * freq + seed * 0.731
    i = np.floor(p).astype(np.int64); f = p - i; w = f * f * (3 - 2 * f)
    out = 0
    for dx in (0, 1):
        for dy in (0, 1):
            for dz in (0, 1):
                h = _hash(i[..., 0] + dx, i[..., 1] + dy, i[..., 2] + dz, seed)
                out = out + h * np.where(dx, w[..., 0], 1 - w[..., 0]) * np.where(dy, w[..., 1], 1 - w[..., 1]) * np.where(dz, w[..., 2], 1 - w[..., 2])
    return out

def fbm(P, freq, seed, oct=3):
    s, a, tot = 0, 1.0, 0
    for o in range(oct):
        s = s + a * vnoise(P, freq * 2 ** o, seed + o * 31); tot += a; a *= 0.5
    return s / tot

def srgb_lin(c):
    c = np.asarray(c, float)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)

# The churchyard's own stone and iron materials have their albedo raised (build-churchyard.gd: STONE_GAIN, IRON_GAIN, linear),
# so the vertex colour can lighten as well as darken: a worn arris or a pale lichen colony is lighter than the stone round it.
# A colour below is the sRGB the surface should show on the picture's average; tint() gives the vertex colour for it.
STONE_GAIN = 4.0
IRON_GAIN = 8.0
STONE_AVG = srgb_lin(0.392) * srgb_lin(np.array([0.74, 0.78, 0.84])) * STONE_GAIN    # the stair stone's picture x guard stone
IRON_AVG = srgb_lin(0.175) * srgb_lin(np.array([0.85, 0.83, 0.80])) * IRON_GAIN      # the iron picture x barrel iron

def stone_col(hexrgb):
    return np.clip(srgb_lin(np.array([int(hexrgb[i:i + 2], 16) / 255 for i in (0, 2, 4)])) / STONE_AVG, 0, 1)

def iron_col(rgb):
    rgb = np.array([int(rgb[i:i + 2], 16) / 255 for i in (0, 2, 4)]) if isinstance(rgb, str) else np.asarray(rgb, float)
    return np.clip(srgb_lin(rgb) / IRON_AVG, 0, 1)

DRY = stone_col('596168'); WORN = stone_col('737A7D'); RECESS = stone_col('3B4447'); DIRT = stone_col('343B39')
DAMP = stone_col('303A32'); DAMP_DEEP = stone_col('34423B'); MOSS = stone_col('414D32'); MOSS_DARK = stone_col('35402A')
LICHEN = stone_col('8B9180'); LICHEN_Y = stone_col('A59C78'); SEDIMENT = stone_col('514A3B')

def _mix(c, col, w):
    w = np.clip(w, 0, 1)[..., None]
    return c * (1 - w) + np.asarray(col) * w

def weather_stone(P, N, E, AO, seed, age=1.0, tone=1.0, top=None, ground=0.0):
    """Belgian blue stone outdoors for a century or two, as AGENTS.md has weathering follow its causes:
    - the stone's own tone drifting over 0.3 to 1 m; dirt and shade in its recesses and joints (the AO bake);
    - worn arrises lifted toward fresh stone where hands, feet and weather rub them, unevenly, never as an outline;
    - damp and soil splash at the foot, 100 to 250 mm high and uneven; rain runs from under the top's edge down to the ground;
    - moss in damp joints and on low level faces (10 to 40 mm), clustered lichen colonies (20 to 100 mm) on the open, upper faces;
    - below the ground (a vault stair): damp, moss in the corners, the treads' noses rubbed lighter by feet.
    `ground`: the height of the ground at the stone's foot (a ledger flush in the grass: 0)."""
    y = P[..., 1] - ground
    up = np.clip(N[..., 1], 0, 1)
    AO = np.clip(AO, 0, 1)
    c = np.broadcast_to(DRY * tone, P.shape).copy()
    # below the ground (a stair well) the whole well is shaded: its AO is the well's, not a joint's
    under = np.clip(-(y + 0.03) / 0.12, 0, 1)
    AOj = np.clip(AO - 0.45 * under, 0, 1)
    # the bed's tone over 0.3 to 1 m, and a finer drift
    big = fbm(P, 1.3, seed + 41)
    c *= (0.86 + 0.28 * big)[..., None] * (0.96 + 0.08 * vnoise(P, 6.0, seed + 43))[..., None]
    # recesses: shade and the dirt that settles where rain does not wash
    c = _mix(c, DIRT, 0.75 * AOj ** 0.8)
    c *= (1 - 0.35 * AOj)[..., None]
    # rain runs from under the top's edge, down to the foot
    if top is not None:
        runs = np.clip((vnoise(P * np.array([1, 0.05, 1]), 16.0, seed + 3) - 0.5) * 3.2, 0, 1) * np.clip((top - y) / 0.25, 0, 1) * (1 - up) * age
        c = _mix(c, DAMP, 0.45 * runs)
    # the foot: damp and soil splash, 100 to 250 mm, uneven
    h = 0.10 + 0.15 * fbm(P * np.array([1, 0, 1]), 2.2, seed + 9)
    foot = np.clip(1 - y / h, 0, 1) ** 1.4 * (y > -0.03)
    c = _mix(c, DAMP, 0.62 * foot * age)
    c = _mix(c, SEDIMENT, 0.25 * foot * np.clip(1 - y / 0.05, 0, 1) * age)
    # worn arrises: lighter, patchy, more on the upper, open ones
    rub = np.clip(E, 0, 1) * (1 - AO) * np.clip((vnoise(P, 11.0, seed + 17) - 0.25) * 1.8, 0, 1) * (0.45 + 0.55 * np.clip(y / 0.8, 0, 1))
    c = _mix(c, WORN * tone, 0.7 * rub)
    # moss: in damp joints and corners, and on low level faces, in small patches
    patch = np.clip((vnoise(P, 28.0, seed + 7) - 0.42) * 4, 0, 1)
    joint = np.clip((AOj - 0.18) * 3.2, 0, 1) * np.clip(1 - y / 0.9, 0.15, 1)
    # (below the ground the treads and landing are swept: moss keeps to their joints and back corners)
    low = up * np.clip(1 - y / 0.45, 0, 1) * np.clip((fbm(P, 3.0, seed + 8) - 0.45) * 3, 0, 1) * (y > -0.03)
    moss_w = np.clip(patch * (0.9 * joint + 0.8 * low) * age, 0, 1)
    c = _mix(c, np.where((vnoise(P, 60.0, seed + 2) > 0.5)[..., None], MOSS, MOSS_DARK), 0.85 * moss_w)
    # lichen: colonies in some areas only, on the open upper faces above the splash
    area = np.clip((fbm(P, 1.7, seed + 21) - 0.42) * 4.5, 0, 1)
    colony = np.clip((vnoise(P, 15.0, seed + 11) - 0.6) * 6, 0, 1) * np.clip((vnoise(P, 40.0, seed + 12) - 0.25) * 3, 0, 1)
    open_ = (1 - AO) ** 2 * (0.35 + 0.65 * up) * np.clip((y - 0.2) / 0.3, 0, 1)
    lich = np.clip(area * colony * open_ * age, 0, 1)
    yellow = np.clip((vnoise(P, 5.0, seed + 13) - 0.7) * 5, 0, 1)
    c = _mix(c, LICHEN * (1 - yellow[..., None]) + LICHEN_Y * yellow[..., None], 0.8 * lich)
    # below the ground: damp, darker with the depth; the treads' noses rubbed by feet
    if under.any():
        deep = np.clip(-y / 0.9, 0, 1)
        c = _mix(c, DAMP_DEEP, under * (0.45 + 0.3 * deep) * (1 - up))
        c = _mix(c, DRY * 1.1, under * up * 0.55)
        c = _mix(c, WORN * 0.95, under * np.clip(E, 0, 1) * 0.8)
    return np.concatenate([np.clip(c, 0, 1), np.ones(P.shape[:-1] + (1,))], -1)

def weather_iron(P, N, E, AO, seed, paint='292B2B', age=1.0, polish=None):
    """Painted wrought or cast iron: its paint, rubbed back to worn dark metal on its arrises and where hands go
    (`polish`: function(P, N) -> 0..1), restrained rust where water lies (low down, on the tops, in the corners)."""
    y = P[..., 1]
    up = np.clip(N[..., 1], 0, 1)
    c = np.broadcast_to(iron_col(paint), P.shape).copy()
    c *= (0.9 + 0.2 * fbm(P, 4.0, seed + 1))[..., None]
    # (restrained: rust breaks through in spots and streaks where water lies, the paint holds elsewhere)
    rust_w = np.clip((fbm(P, 9.0, seed) - 0.64 + 0.2 * np.clip(1 - y / 0.3, 0, 1) + 0.08 * up + 0.2 * np.clip(AO - 0.3, 0, 1)) * 2.0, 0, 0.55) * age
    c = _mix(c, iron_col('674A36'), rust_w)
    worn = np.clip(E, 0, 1) * 0.5 * np.clip((vnoise(P, 20.0, seed + 4) - 0.3) * 2, 0, 1)
    if polish is not None: worn = np.maximum(worn, polish(P, N))
    c = _mix(c, iron_col('555650'), worn)
    c *= (1 - 0.4 * np.clip(AO, 0, 1))[..., None]
    foot = np.clip(1 - y / 0.12, 0, 1) * (y > -0.05)
    c *= (1 - 0.25 * foot)[..., None]
    return np.concatenate([np.clip(c, 0, 1), np.ones(P.shape[:-1] + (1,))], -1)
