"""Issue #175: the hanging trade signs, made in code (numpy; our own work). Imported by repair-signs.py.
Model space: x along the wall, y up (0 = the bracket arm's top, as the bake's), z out of the wall (0 = the wall's face).
A sign hangs in the y-z plane, so it is seen from up and down the street; its thickness runs along x.
- the bracket (wrought iron, the town's wall iron): a flat wall plate with two bolts, a square arm 1.04 m out with a gilt
  ball, a round stay under it and two C-scrolls filling the triangle, two rings on the arm, short chains to the sign;
- the signs (gilt, pewter, brass or black paint, from the signs picture): a pretzel (a gilt rope knot), a key (bow, shaft,
  collars and a warded bit), a lidded pewter tankard, a black boot with a gilt band, a top hat with a red band, a barber's
  brass basin with its neck notch.
Edges: the iron's arrises chamfered 1.5 mm, round bars and tubes faceted 8 round; the gilt and pewter turned shapes in
16 facets with smooth normals."""
import math
import numpy as np

def unit(v): v = np.asarray(v, float); n = np.linalg.norm(v); return v / n if n > 1e-12 else v

class Part:
    """Triangles per material ('iron' metric uv; others a cell of the signs picture: 'gilt', 'pewter', ...)."""
    def __init__(self): self.tris = {}
    def tri(self, mat, ps, ns, uvs):
        self.tris.setdefault(mat, []).append((np.array(ps, float), np.array(ns, float), uvs))

def tube(part, mat, path, r, sides=8, closed=False, caps=True, rect=None):
    """A bar swept along a polyline: round (r) or a rectangle rect=(w, t) (w across the path's bend, t through it)."""
    path = [np.asarray(p, float) for p in path]
    n = len(path)
    frames = []
    for i in range(n):
        t = unit(path[(i + 1) % n] - path[i - 1]) if closed else unit(path[min(i + 1, n - 1)] - path[max(i - 1, 0)])
        ref = np.array([1.0, 0, 0]) if abs(t[0]) < 0.9 else np.array([0, 1.0, 0])
        if frames:
            ref = frames[-1][1]
        u = unit(ref - t * np.dot(ref, t)); v = np.cross(t, u)
        frames.append((t, u, v))
    if rect:
        w, th = rect; sec = [(-w / 2, -th / 2), (w / 2, -th / 2), (w / 2, th / 2), (-w / 2, th / 2)]
        secn = [(0, -1), (1, 0), (0, 1), (-1, 0)]
    else:
        sec = [(r * math.cos(2 * math.pi * k / sides), r * math.sin(2 * math.pi * k / sides)) for k in range(sides)]
        secn = [(math.cos(2 * math.pi * k / sides), math.sin(2 * math.pi * k / sides)) for k in range(sides)]
    rings = [[p + f[1] * a + f[2] * b for a, b in sec] for p, f in zip(path, frames)]
    norms = [[unit(f[1] * a + f[2] * b) for a, b in secn] for f in frames]
    segs = range(n if closed else n - 1)
    m = len(sec); L = 0.0
    for i in segs:
        j = (i + 1) % n; L2 = L + np.linalg.norm(path[j] - path[i])
        for k in range(m):
            k2 = (k + 1) % m
            a, b, c, d = rings[i][k], rings[i][k2], rings[j][k2], rings[j][k]
            if rect:
                fn = unit(np.cross(b - a, d - a)); mid = (a + c) / 2
                if np.dot(fn, mid - path[i]) < 0: fn = -fn
                na = nb = nc = nd = fn
            else:
                na, nb, nc, nd = norms[i][k], norms[i][k2], norms[j][k2], norms[j][k]
            uv = [(k / m, L), ((k + 1) / m, L), ((k + 1) / m, L2), (k / m, L2)]
            part.tri(mat, (a, b, c), (na, nb, nc), (uv[0], uv[1], uv[2])); part.tri(mat, (a, c, d), (na, nc, nd), (uv[0], uv[2], uv[3]))
        L = L2
    if caps and not closed:
        for idx, sgn in ((0, -1), (n - 1, 1)):
            cn = frames[idx][0] * sgn; c = path[idx]
            for k in range(m):
                part.tri(mat, (c, rings[idx][k], rings[idx][(k + 1) % m]), (cn, cn, cn), ((0.5, 0.5), (0, 0), (1, 1)))

def lathe(part, mat, prof, centre, axis, seg=16, arc=None):
    """A turned shape: profile [(radius, height)] round the axis through centre; smooth normals."""
    axis = unit(axis); a = unit(np.cross(axis, [1, 0, 0] if abs(axis[0]) < 0.9 else [0, 1, 0])); b = np.cross(axis, a)
    a0, a1 = arc if arc else (0.0, 2 * math.pi)
    angs = np.linspace(a0, a1, seg + 1)
    pts = [[np.asarray(centre) + axis * h + (a * math.cos(t) + b * math.sin(t)) * r for t in angs] for r, h in prof]
    for i in range(len(prof) - 1):
        (r0, h0), (r1, h1) = prof[i], prof[i + 1]
        slope = unit([h1 - h0, -(r1 - r0)])  # (radial, axial) of the profile's outward normal
        for k in range(seg):
            t0, t1 = angs[k], angs[k + 1]
            rad0 = a * math.cos(t0) + b * math.sin(t0); rad1 = a * math.cos(t1) + b * math.sin(t1)
            n0 = unit(rad0 * slope[0] + axis * slope[1]); n1 = unit(rad1 * slope[0] + axis * slope[1])
            p00, p01, p11, p10 = pts[i][k], pts[i][k + 1], pts[i + 1][k + 1], pts[i + 1][k]
            uv = [(k / seg, h0), ((k + 1) / seg, h0), ((k + 1) / seg, h1), (k / seg, h1)]
            part.tri(mat, (p00, p01, p11), (n0, n1, n1), (uv[0], uv[1], uv[2])); part.tri(mat, (p00, p11, p10), (n0, n1, n0), (uv[0], uv[2], uv[3]))

def cbox(part, mat, c, ax, half, ch=0.0015):
    """A chamfered box (centre, unit axes, half sizes): its hull's faces, flat."""
    from scipy.spatial import ConvexHull
    pts = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                for k in range(3):
                    q = np.array(half, float); q[[j for j in range(3) if j != k]] -= ch; q *= (sx, sy, sz)
                    pts.append(np.asarray(c) + ax[0] * q[0] + ax[1] * q[1] + ax[2] * q[2])
    pts = np.array(pts); h = ConvexHull(pts)
    for s, eq in zip(h.simplices, h.equations):
        n = eq[:3]; ps = pts[s]
        u = unit(np.cross(n, [0, 1, 0] if abs(n[1]) < 0.9 else [1, 0, 0])); v = np.cross(n, u)
        part.tri(mat, ps, (n, n, n), [(np.dot(p, u) / 1.2, np.dot(p, v) / 1.2) for p in ps])

def prism(part, mat, side_mat, outline, x0, x1, ch=0.004):
    """An outline [(z, y)] (anticlockwise seen from +x) cut from a board x0..x1 thick, its edges chamfered."""
    o = [np.array(p, float) for p in outline]
    nO = len(o)
    # the outline pulled in by the chamfer, for the two faces
    def inset(k):
        p, a, b = o[k], o[k - 1], o[(k + 1) % nO]
        e1, e2 = unit(p - a), unit(b - p)
        n1, n2 = np.array([e1[1], -e1[0]]), np.array([e2[1], -e2[0]])
        bis = unit(n1 + n2); return p - bis * ch / max(0.3, np.dot(bis, n1))
    inn = [inset(k) for k in range(nO)]
    P = lambda x, q: np.array([x, q[1], q[0]])
    cz, cy = np.mean([p[0] for p in o]), np.mean([p[1] for p in o])
    for x, sgn, ring in ((x0, -1, inn), (x1, 1, inn)):
        n = np.array([sgn, 0.0, 0.0])
        for k in range(nO):
            part.tri(mat, (P(x, (cz, cy)), P(x, ring[k]), P(x, ring[(k + 1) % nO])), (n, n, n), ((0.5, 0.5), (0.1, 0.1), (0.9, 0.9)))
    xs = [(x0, inn), (x0 + ch, o), (x1 - ch, o), (x1, inn)]
    for (xa, ra), (xb, rb) in zip(xs, xs[1:]):
        for k in range(nO):
            k2 = (k + 1) % nO
            a, b, c, d = P(xa, ra[k]), P(xa, ra[k2]), P(xb, rb[k2]), P(xb, rb[k])
            n = unit(np.cross(b - a, d - a)); mid = (a + c) / 2
            if np.dot(n[1:], [mid[1] - cy, mid[2] - cz]) < 0: n = -n
            part.tri(side_mat if ra is o and rb is o else mat, (a, b, c), (n, n, n), ((0, 0), (1, 0), (1, 1)))
            part.tri(side_mat if ra is o and rb is o else mat, (a, c, d), (n, n, n), ((0, 0), (1, 1), (0, 1)))

X, Y, Z = np.eye(3)

def bracket(part, hang_z=(0.47, 0.77)):
    """The wrought-iron arm and its stay and scrolls; rings at hang_z for the sign's chains."""
    cbox(part, "iron", (0, -0.16, 0.006), (X, Y, Z), (0.026, 0.25, 0.006), 0.0015)   # the wall plate
    for yb in (-0.36, 0.05):
        cbox(part, "iron", (0, yb, 0.015), (X, Y, Z), (0.009, 0.009, 0.004), 0.0025)  # its bolts' heads
    cbox(part, "iron", (0, -0.011, 0.53), (X, Y, Z), (0.011, 0.011, 0.52), 0.0015)   # the arm, 22 mm square
    lathe(part, "gilt", [(0.0, -0.024), (0.016, -0.02), (0.024, -0.005), (0.023, 0.01), (0.012, 0.022), (0.0, 0.025)], (0, -0.011, 1.075), Z, 12)
    tube(part, "iron", [(0, -0.38, 0.012), (0, -0.25, 0.25), (0, -0.12, 0.47), (0, -0.03, 0.64)], 0.008)  # the stay
    # two C-scrolls of flat bar between the arm and the stay
    for cz, cy, R, turns in ((0.17, -0.13, 0.085, 1.35), (0.40, -0.075, 0.05, 1.25)):
        path = []
        for k in range(28):
            t = turns * 2 * math.pi * k / 27
            r = R * (1 - 0.6 * k / 27)
            path.append((0, cy + r * math.sin(t), cz + r * math.cos(t)))
        tube(part, "iron", path, 0, rect=(0.012, 0.006))
    for z in hang_z:  # rings round the arm
        ring = [(0.017 * math.sin(a), -0.011 - 0.017 * math.cos(a) + 0.0, z) for a in np.linspace(0, 2 * math.pi, 13)[:-1]]
        tube(part, "iron", ring, 0.0035, 6, closed=True)

def chain(part, top, bottom, link=0.03):
    """Oval links from top to bottom (alternately turned)."""
    top, bottom = np.asarray(top, float), np.asarray(bottom, float)
    L = np.linalg.norm(bottom - top); n = max(1, int(L / link))
    d = (bottom - top) / n
    for i in range(n):
        c = top + d * (i + 0.5); a = X if i % 2 else Z
        pts = [c + unit(d) * (link * 0.6) * math.sin(t) + a * 0.008 * math.cos(t) for t in np.linspace(0, 2 * math.pi, 9)[:-1]]
        tube(part, "iron", pts, 0.0025, 4, closed=True)

def pretzel(part, top):
    """A gilt pretzel: one rope of dough from one end round both lobes and the bottom loop, twisted once at the top
    middle, both ends laid on the loop (a Catmull-Rom curve through the knot's points)."""
    cz, cy = 0.62, top - 0.26
    k = [(-0.10, -0.06), (-0.03, 0.05), (0.03, 0.09), (0.10, 0.14), (0.18, 0.12), (0.21, 0.02), (0.17, -0.10), (0.07, -0.17),
         (-0.07, -0.17), (-0.17, -0.10), (-0.21, 0.02), (-0.18, 0.12), (-0.10, 0.14), (-0.03, 0.09), (0.03, 0.05), (0.10, -0.06)]
    k = [np.array(q) * 1.1 for q in k]
    pts = []
    for i in range(len(k) - 1):
        p0, p1, p2, p3 = k[max(i - 1, 0)], k[i], k[i + 1], k[min(i + 2, len(k) - 1)]
        for t in np.linspace(0, 1, 5, endpoint=False):
            q = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3)
            pts.append(q)
    pts.append(k[-1])
    n = len(pts)
    path = []
    for i, q in enumerate(pts):
        # over and under at the twist: the first pass in front, the second behind
        f = i / (n - 1)
        x = 0.014 * math.exp(-((f - 0.14) / 0.06) ** 2) - 0.014 * math.exp(-((f - 0.86) / 0.06) ** 2)
        path.append((x, cy + q[1], cz + q[0]))
    tube(part, "gilt", path, 0.024, 10)
    for z in (cz - 0.12, cz + 0.12): chain(part, (0, -0.03, z), (0, cy + 0.15, z))

def key(part, top):
    cz = 0.62
    bow = [(0.0, top - 0.12 + 0.1 * math.sin(a), cz + 0.1 * math.cos(a)) for a in np.linspace(0, 2 * math.pi, 25)[:-1]]
    tube(part, "gilt", bow, 0.022, 10, closed=True)
    lathe(part, "gilt", [(0.024, 0.0), (0.024, 0.55), (0.0, 0.56)], (0, top - 0.78, cz), Y, 12)  # the shaft
    for yc in (top - 0.25, top - 0.31):
        lathe(part, "gilt", [(0.024, -0.012), (0.036, -0.008), (0.038, 0.0), (0.036, 0.008), (0.024, 0.012)], (0, yc, cz), Y, 12)
    # the warded bit: a plate on the shaft's foot with two notches
    for (yc, h, zc, w) in ((top - 0.70, 0.07, cz + 0.07, 0.10), (top - 0.62, 0.035, cz + 0.05, 0.06), (top - 0.76, 0.03, cz + 0.045, 0.05)):
        cbox(part, "gilt", (0, yc, zc), (X, Y, Z), (0.014, h / 2, w / 2), 0.003)
    chain(part, (0, -0.03, cz), (0, top, cz))

def tankard(part, top):
    cz = 0.62; base = top - 0.40
    lathe(part, "pewter", [(0.0, 0.0), (0.135, 0.0), (0.145, 0.012), (0.13, 0.03), (0.122, 0.07), (0.12, 0.29), (0.13, 0.31), (0.132, 0.33)], (0, base, cz), Y, 16)
    lathe(part, "pewter", [(0.132, 0.33), (0.14, 0.335), (0.12, 0.36), (0.06, 0.385), (0.0, 0.39)], (0, base, cz), Y, 16)  # the lid
    lathe(part, "gilt", [(0.123, 0.13), (0.127, 0.14), (0.123, 0.15)], (0, base, cz), Y, 16)
    hdl = [(0.0, base + 0.29 - 0.22 * t, cz - 0.12 - 0.09 * math.sin(math.pi * t)) for t in np.linspace(0, 1, 10)]
    tube(part, "pewter", hdl, 0.016, 8)
    cbox(part, "pewter", (0, base + 0.37, cz - 0.13), (X, Y, Z), (0.012, 0.012, 0.02), 0.003)  # the thumb-piece
    for z in (cz - 0.09, cz + 0.09): chain(part, (0, -0.03, z), (0, base + 0.37 + 0.005, z))

def boot(part, top):
    s, cz = 0.95, 0.62; base = top - 0.55 * s
    out = [(-0.12, 0.56), (-0.13, 0.40), (-0.14, 0.20), (-0.15, 0.08), (-0.152, -0.04), (-0.04, -0.04), (-0.03, -0.005),
           (0.15, -0.005), (0.25, -0.04), (0.33, -0.04), (0.37, -0.012), (0.365, 0.03), (0.30, 0.085), (0.18, 0.14),
           (0.09, 0.22), (0.07, 0.36), (0.09, 0.56)]
    # (anticlockwise seen from +x: z right, y up)
    prism(part, "black_paint", "black_paint", [(cz + a * s, base + (b + 0.03) * s) for a, b in out], -0.035, 0.035, 0.005)
    cbox(part, "gilt", (0, base + 0.53 * s, cz - 0.02 * s), (X, Y, Z), (0.037, 0.02, 0.125 * s), 0.003)  # the gilt band at the top
    cbox(part, "gilt", (0, base + 0.03 * s - 0.04 * s + 0.004, cz + 0.29 * s), (X, Y, Z), (0.037, 0.006, 0.05 * s), 0.002)  # the sole's welt at the toe
    for z in (cz - 0.11, cz + 0.07): chain(part, (0, -0.03, z), (0, top, z))

def hat(part, top):
    cz = 0.62; base = top - 0.36
    lathe(part, "black_paint", [(0.0, 0.0), (0.2, 0.0), (0.225, 0.018), (0.2, 0.034), (0.112, 0.04)], (0, base, cz), Y, 20)
    lathe(part, "black_paint", [(0.112, 0.04), (0.104, 0.26), (0.116, 0.30), (0.0, 0.31)], (0, base, cz), Y, 20)
    lathe(part, "red_paint", [(0.1085, 0.05), (0.108, 0.095)], (0, base, cz), Y, 20)
    chain(part, (0, -0.03, cz), (0, base + 0.31, cz))

def basin(part, top):
    cz = 0.62
    lathe(part, "brass", [(0.0, -0.01), (0.14, 0.01), (0.2, 0.05), (0.26, 0.06), (0.265, 0.07), (0.2, 0.062), (0.14, 0.024), (0.0, 0.004)],
          (0, top - 0.3, cz), X, 24, arc=(0.35 + math.pi / 2, 2 * math.pi - 0.35 + math.pi / 2))
    for z in (cz - 0.15, cz + 0.15): chain(part, (0, -0.03, z), (0, top - 0.06, z))

SIGNS = {"pretzel": pretzel, "key": key, "tankard": tankard, "boot": boot, "hat": hat, "basin": basin}

def hanging(kind):
    p = Part()
    bracket(p)
    SIGNS[kind](p, -0.18)
    return p
