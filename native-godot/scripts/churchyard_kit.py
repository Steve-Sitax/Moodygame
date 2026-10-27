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
        self.tint = {}          # mat -> function(P, N) -> colours (n,3,4)

    def add(self, mat, P, N, UV, C=None):
        P = np.asarray(P, float).reshape(-1, 3, 3); N = np.asarray(N, float).reshape(-1, 3, 3)
        UV = np.asarray(UV, float).reshape(-1, 3, 2)
        # winding: (b - a) x (c - a) against the corners' mean normal
        cr = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
        flip = (cr * N.mean(1)).sum(1) > 0
        for A in (P, N, UV) + ((C,) if C is not None else ()):
            A[flip] = A[flip][:, [0, 2, 1]]
        keep = np.linalg.norm(cr, axis=1) > 1e-12
        self.tris.setdefault(mat, []).append((P[keep], N[keep], UV[keep], None if C is None else C[keep]))

    def box(self, lo, hi, yaw=0.0):
        lo, hi = np.asarray(lo, float), np.asarray(hi, float)
        self.boxes.append([*((lo + hi) / 2).round(4).tolist(), *(hi - lo).round(4).tolist(), round(yaw, 4)])

    def rows(self, mat):
        out = []
        for P, N, UV, C in self.tris.get(mat, []):
            if C is None: C = np.ones(P.shape[:2] + (4,))
            out.append(np.concatenate([P, N, UV, np.zeros(P.shape[:2] + (2,)), C, np.zeros(P.shape[:2] + (2,))], axis=2))
        return np.concatenate(out).astype(np.float32) if out else np.zeros((0, 3, 16), np.float32)

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

def rbox(m, mat, lo, hi, r, step=0.15, R=None, t=(0, 0, 0), taper=None, skip=((1, 0),), uv=STONE_UV, uvo=(0.0, 0.0), k=2, sag=None):
    """A block with every edge rounded (radius r): a box's faces in a grid, pushed out round the inner box.
    taper: (fx, fz) the top's size against the bottom's (an obelisk's shaft); skip: faces left out, (axis, side);
    sag: function(P) -> dy, a worn top."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float)
    r = min(r, 0.49 * float((hi - lo).min()))
    ilo, ihi = lo + r, hi - r
    co = [axis_coords(lo[i], hi[i], r, step, k) for i in range(3)]
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
            Pt, Nt = xform(Pt, Nt, R, t)
            m.add(mat, Pt, Nt, Ut)


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
    ring_pts = []
    for z, d, wz, wxy in rings:
        q = inset(o, d)
        P = np.concatenate([q, np.full((n, 1), z)], 1)
        N = np.concatenate([vn * wxy, np.full((n, 1), wz)], 1)
        ring_pts.append((P, N, z))
    Q = np.stack([np.concatenate([p, p[:1]]) for p, _, _ in ring_pts], 1)       # (n+1, rings, 3)
    Nn = np.stack([np.concatenate([nn, nn[:1]]) for _, nn, _ in ring_pts], 1)
    UVq = np.stack([np.stack([s / uv, np.full(n + 1, z / uv)], -1) for _, _, z in ring_pts], 1) + np.asarray(uvo)
    Pt, Nt, Ut = grid_tris(Q, Nn, UVq)
    Pt, Nt = xform(Pt, Nt, R, t)
    m.add(mat, Pt, Nt, Ut)
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

def weather_stone(P, N, seed, age=1.0, tone=1.0, top=None):
    """Belgian blue stone outdoors for a century or two: soil splash and damp at the foot, moss on the low and level
    faces and in the low corners, pale lichen spots on the tops and fronts, dark rain runs under the top's edges."""
    y = P[..., 1]
    base = np.array([0.93, 0.95, 0.97]) * tone
    c = np.broadcast_to(base, P.shape).copy()
    g = fbm(P, 3.0, seed)
    # soil and damp at the foot (to 0.3 m), uneven
    # (below the ground, a vault stair's walls and steps: damp and dark, not more so the deeper)
    foot = np.clip(1 - (y - 0.0) / (0.28 + 0.12 * g), 0, 1) ** 1.6
    c *= (1 - 0.42 * foot * age)[..., None] * np.array([1.0, 0.97, 0.92]) ** foot[..., None]
    # moss: on level and low faces, in patches
    up = np.clip(N[..., 1], 0, 1)
    moss_w = np.clip(np.clip((fbm(P, 6.0, seed + 7) - 0.52) * 4, 0, 1) * (0.35 * up + 0.65 * np.clip(1 - y / 0.6, 0, 1)) * age, 0, 1)
    moss = np.array([0.50, 0.60, 0.33])
    c = c * (1 - 0.75 * moss_w[..., None]) + moss * 0.75 * moss_w[..., None]
    # rain runs below the top edge
    if top is not None:
        runs = np.clip((vnoise(P * np.array([1, 0.08, 1]), 14.0, seed + 3) - 0.55) * 3, 0, 1) * np.clip((top - y) / 0.6, 0, 1) * np.clip(1 - (top - y) / 1.6, 0, 1)
        c *= (1 - 0.22 * runs * age)[..., None]
    # pale lichen spots on the tops and fronts
    lich = np.clip(np.clip((vnoise(P, 22.0, seed + 11) - 0.78) * 6, 0, 1) * (0.5 + 0.5 * up) * age, 0, 1) * (y > 0)
    c = c * (1 - 0.6 * lich[..., None]) + np.array([0.99, 0.98, 0.88]) * 0.6 * lich[..., None]
    c *= (0.94 + 0.08 * g)[..., None]
    return np.concatenate([np.clip(c, 0, 1), np.ones(P.shape[:-1] + (1,))], -1)

def weather_iron(P, N, seed, paint=(0.26, 0.26, 0.26), age=1.0):
    """Painted wrought or cast iron: the paint's colour, rust breaking through low down and on the tops."""
    y = P[..., 1]
    c = np.broadcast_to(np.asarray(paint, float), P.shape).copy()
    rust_w = np.clip((fbm(P, 9.0, seed) - 0.5 + 0.25 * np.clip(1 - y / 0.4, 0, 1) + 0.15 * np.clip(N[..., 1], 0, 1)) * 2.5, 0, 1) * age
    rust = np.array([0.62, 0.42, 0.30])
    c = c * (1 - rust_w[..., None]) + rust * rust_w[..., None]
    foot = np.clip(1 - y / 0.15, 0, 1)
    c *= (1 - 0.3 * foot)[..., None]
    return np.concatenate([np.clip(c, 0, 1), np.ones(P.shape[:-1] + (1,))], -1)
