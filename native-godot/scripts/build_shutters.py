"""Issue #176: the town's window shutters, one model per kind, made in code (numpy/scipy; our own work).
    python scripts/build_shutters.py <output folder>
Writes <name>.bin (rows of 16 floats per vertex: position, normal, uv, uv2, colour, custom0, as the wall-circuit format)
for each model and models.json (the models, their sizes and surfaces). scripts/build-shutters.gd turns them into the
game's meshes (assets/models/shutters), NativeShutters puts copies of them where the bake's flat shutters stood.

Model space: x across the leaf, y up from its foot, z out of the wall (toward the street). Sizes in metres.
- body_<kind>_<bucket>: a leaf without iron, centred on x = 0 and on z = 0 (its mid-plane), its foot at y = 0. Kinds:
  louvred (fixed slats at 45 degrees between a bottom, middle and top rail) and panelled (two fielded panels each side).
  Stiles and rails are separate pieces with chamfered arrises (3 mm; 1.5 mm on the slats), the rails' ends showing at
  the stiles; the leaf is the same seen from both sides across x, so a leaf hinged on the other side is the same model.
  Buckets: the widths and heights the bake's leaves come in (open: 0.32, 0.385 m wide, 1.815 m; shut, in the opening:
  0.45, 0.56, 0.70 m, 1.868 m); a copy is stretched at most about 10 % across.
- strap: a strap hinge (penture) on a leaf's face: 32 mm flat iron, 5 mm thick, tapering to a round end, three
  domed nail heads, rolled into an eye (the knuckle) at the leaf's edge. Origin: the knuckle's axis at the face.
- pintle: the iron pin (gond) the eye turns on, with its cap, on a square arm that runs back into the wall 4 cm deep.
  Origin: the pin's axis at the strap's height, 85 mm off the wall (the open leaf's face).
- holdback: the wall's pivoting shutter dog: a stem from the wall and a flat paddle over the open leaf's free edge.
  Origin: on the wall face.
Materials: "wood" (the shutter paint material: uv in the paint picture's left half, 0.6 m across one half, the grain
along v) and "iron" (the town's wall iron, metric uv). The colour is a shade (inner corners and the slats' undersides
darker); a copy's own colour (the house's paint, the iron's rust) multiplies it in the game.
"""
import json, math, pathlib, sys
import numpy as np
from scipy.spatial import ConvexHull

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(176)
HALF = 0.6  # metres of board across one half of the paint picture (and along its repeat)

class Mesh:
    def __init__(self): self.rows = {"wood": [], "iron": []}
    def tri(self, mat, ps, n, uvs, shade):
        a, b, c = (np.asarray(p, float) for p in ps)
        if np.linalg.norm(np.cross(b - a, c - a)) < 1e-12: return
        rows = [[*p, *n, *uv, 0.0, 0.0, shade, shade, shade, 1.0, 0.0, 0.0] for p, uv in zip((a, b, c), uvs)]
        # Godot's front faces wind clockwise seen from the front: (c - a) x (b - a) along the normal
        if np.dot(np.cross(c - a, b - a), n) < 0: rows[1], rows[2] = rows[2], rows[1]
        self.rows[mat] += rows

def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)

def hull_piece(m, mat, pts, grain, shade_fn, u_off=0.0, v_off=0.0, metric=None):
    """A convex piece from its corner points: flat faces, each with planar uvs (the grain along `grain`)."""
    pts = np.asarray(pts, float); h = ConvexHull(pts)
    centre = pts.mean(0)
    # merge the hull's triangles into planar faces by their plane equations
    faces = {}
    for simplex, eq in zip(h.simplices, h.equations):
        key = tuple(np.round(eq, 5)); faces.setdefault(key, []).append(simplex)
    g = unit(grain)
    for key, tris in faces.items():
        n = np.array(key[:3])
        # the face's own axes: v along the grain (or the closest in-plane direction), u across
        gv = g - n * np.dot(g, n)
        if np.linalg.norm(gv) < 0.2: gv = np.array([0.0, 1.0, 0.0]) - n * n[1]
        if np.linalg.norm(gv) < 0.2: gv = np.array([1.0, 0.0, 0.0]) - n * n[0]
        gv = unit(gv); gu = np.cross(n, gv)
        shade = shade_fn(n)
        for s in tris:
            ps = pts[s]
            if metric:
                uvs = [(np.dot(p, gu) / metric, np.dot(p, gv) / metric) for p in ps]
            else:
                uvs = [((np.dot(p - centre, gu) / HALF) * 0.5 + u_off, np.dot(p, gv) / HALF + v_off) for p in ps]
            m.tri(mat, ps, n, uvs, shade)

def chamfer_box(c, ax, half, ch):
    """The 24 corner points of a box (centre c, unit axes ax, half sizes) with every arris chamfered by ch."""
    c = np.asarray(c, float); out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                h = np.array(half)
                for k in range(3):
                    q = h.copy(); q[[j for j in range(3) if j != k]] -= ch
                    q = q * np.array([sx, sy, sz])
                    out.append(c + ax[0] * q[0] + ax[1] * q[1] + ax[2] * q[2])
    return out

X, Y, Z = np.eye(3)

def wood_shade(base):
    """Faces looking down or into the leaf's openings come darker (they see less sky); the arrises a touch lighter."""
    def f(n):
        k = base
        if n[1] < -0.5: k *= 0.72
        elif n[1] > 0.5: k *= 1.02
        if abs(n[0]) > 0.9: k *= 0.88  # (the rails' ends and the stiles' inner edges, in the openings)
        return k
    return f

def member(m, x0, x1, y0, y1, T, ch, grain, shade=1.0):
    """A stile or rail: a chamfered box from (x0, y0) to (x1, y1), T thick, centred on z = 0."""
    c = ((x0 + x1) / 2, (y0 + y1) / 2, 0.0)
    pts = chamfer_box(c, (X, Y, Z), ((x1 - x0) / 2, (y1 - y0) / 2, T / 2), ch)
    hull_piece(m, "wood", pts, grain, wood_shade(shade), u_off=float(rng.uniform(0.05, 0.3)), v_off=float(rng.uniform(0, 1)))

def slat(m, yc, x0, x1, wdir, tdir, chord, th, ch=0.0015):
    """A louvre slat: its section a rectangle with its four arrises chamfered, run from stile to stile (its ends are
    housed in the stiles: no end faces)."""
    a, b = chord / 2, th / 2
    sec = [(a, b - ch), (a - ch, b), (-a + ch, b), (-a, b - ch), (-a, -b + ch), (-a + ch, -b), (a - ch, -b), (a, -b + ch)]
    c = np.array([0.0, yc, 0.0]); uo = float(rng.uniform(0.05, 0.4)); vo = float(rng.uniform(0, 1))
    for i in range(8):
        p, q = sec[i], sec[(i + 1) % 8]
        e = np.array(q) - np.array(p); nn = unit(np.array([e[1], -e[0]]))  # (outward: the section runs anticlockwise)
        n = unit(wdir * nn[0] + tdir * nn[1])
        P = lambda x, s_: c + X * x + wdir * s_[0] + tdir * s_[1]
        k = 0.92 * (0.72 if n[1] < -0.5 else 1.0) * (0.85 if n[1] < -0.2 else 1.0)
        cu = lambda s_: (np.dot(np.array(s_), nn[::-1] * np.array([1, -1])) / HALF * 0.5 + uo)
        ps = (P(x0, p), P(x1, p), P(x1, q), P(x0, q))
        uvs = [(cu(p), x0 / HALF + vo), (cu(p), x1 / HALF + vo), (cu(q), x1 / HALF + vo), (cu(q), x0 / HALF + vo)]
        m.tri("wood", ps[:3], n, uvs[:3], k); m.tri("wood", (ps[0], ps[2], ps[3]), n, (uvs[0], uvs[2], uvs[3]), k)

def body(kind, W, H, T):
    m = Mesh()
    sw, rt, rb, rm = 0.072, 0.085, 0.125, 0.09   # stile width, top, bottom and middle rail heights
    ym = 0.44 * H                                  # the middle (lock) rail's middle
    member(m, -W / 2, -W / 2 + sw, 0, H, T, 0.003, Y)
    member(m, W / 2 - sw, W / 2, 0, H, T, 0.003, Y)
    xi0, xi1 = -W / 2 + sw, W / 2 - sw
    member(m, xi0, xi1, 0, rb, T * 0.96, 0.003, X)
    member(m, xi0, xi1, H - rt, H, T * 0.96, 0.003, X)
    member(m, xi0, xi1, ym - rm / 2, ym + rm / 2, T * 0.96, 0.003, X)
    openings = [(rb, ym - rm / 2), (ym + rm / 2, H - rt)]
    if kind == "louvred":
        chord, th, pitch, ang = 0.048, 0.010, 0.040, math.radians(45)
        # slat axes: across (x), its width tipped down toward the front (rain runs off outward), its thickness
        wdir = np.array([0.0, -math.sin(ang), math.cos(ang)]); tdir = np.cross(X, wdir)
        for y0, y1 in openings:
            n = max(1, int(round((y1 - y0 - 0.012) / pitch)))
            step = (y1 - y0) / n
            for i in range(n):
                yc = y0 + step * (i + 0.5)
                slat(m, yc, xi0 - 0.008, xi1 + 0.008, wdir, tdir, chord, th)
    else:
        # fielded panels, the same on both faces: a sunk margin round a raised field with bevelled sides
        for y0, y1 in openings:
            for side in (1, -1):
                zf, zm, zb = side * T * 0.5 * 0.78, side * T * 0.5 * 0.12, side * 0.003  # field, margin, panel's middle
                e, b = 0.006, 0.04                                                       # margin width, bevel width
                ring = [(xi0, y0), (xi1, y0), (xi1, y1), (xi0, y1)]
                mar = [(xi0 + e, y0 + e), (xi1 - e, y0 + e), (xi1 - e, y1 - e), (xi0 + e, y1 - e)]
                fld = [(xi0 + e + b, y0 + e + b), (xi1 - e - b, y0 + e + b), (xi1 - e - b, y1 - e - b), (xi0 + e + b, y1 - e - b)]
                nz = np.array([0, 0, side], float)
                def P(q, z): return np.array([q[0], q[1], z])
                span = (xi1 - xi0) / HALF * 0.5
                uo = float(rng.uniform(0.01, max(0.012, 0.49 - span))); vo = float(rng.uniform(0, 1))
                def uv(p): return ((p[0] - xi0) / HALF * 0.5 + uo, p[1] / HALF + vo)
                for k in range(4):
                    a0, a1 = ring[k], ring[(k + 1) % 4]; m0, m1 = mar[k], mar[(k + 1) % 4]; f0, f1 = fld[k], fld[(k + 1) % 4]
                    # the frame's inner arris down to the margin (a small chamfer), the margin, the field's bevel
                    for q in ((P(a0, side * T * 0.48), P(a1, side * T * 0.48), P(m1, zm), P(m0, zm)),
                              (P(m0, zm), P(m1, zm), P(f1, zf), P(f0, zf))):
                        n = unit(np.cross(q[1] - q[0], q[3] - q[0]))
                        if np.dot(n, nz) < 0: n = -n
                        sh = 0.84 if k == 2 else 0.95  # (the top edge's bevel looks down: in shade)
                        m.tri("wood", (q[0], q[1], q[2]), n, (uv(q[0]), uv(q[1]), uv(q[2])), sh)
                        m.tri("wood", (q[0], q[2], q[3]), n, (uv(q[0]), uv(q[2]), uv(q[3])), sh)
                q = [P(f, zf) for f in fld]
                m.tri("wood", (q[0], q[1], q[2]), nz, (uv(q[0]), uv(q[1]), uv(q[2])), 1.0)
                m.tri("wood", (q[0], q[2], q[3]), nz, (uv(q[0]), uv(q[2]), uv(q[3])), 1.0)
    return m

def iron_shade(n): return 0.95 if n[1] > -0.5 else 0.7

def cylinder_pts(c, axis, r, length, sides=10, bevel=0.0015):
    axis = unit(axis); a = unit(np.cross(axis, X if abs(axis[0]) < 0.9 else Y)); b = np.cross(axis, a)
    out = []
    for e, rr in ((-length / 2, r - bevel), (-length / 2 + bevel, r), (length / 2 - bevel, r), (length / 2, r - bevel)):
        for i in range(sides):
            t = 2 * math.pi * (i + 0.5) / sides
            out.append(np.asarray(c) + axis * e + (a * math.cos(t) + b * math.sin(t)) * rr)
    return out

def strap():
    """Along +x on the face (z 0..5 mm), its eye round the axis at x = -0.010, z = 0 (by the leaf's front corner)."""
    m = Mesh(); L, w0, w1, t = 0.23, 0.032, 0.026, 0.005
    # the strap in three tapering lengths, chamfered, then a round end
    xs = [0.0, 0.08, 0.16, L]
    for xa, xb in zip(xs, xs[1:]):
        wa, wb = w0 + (w1 - w0) * xa / L, w0 + (w1 - w0) * xb / L
        pts = []
        for x, w in ((xa, wa), (xb, wb)):
            for y in (-w / 2, w / 2):
                pts += [(x, y * 0.92, t), (x, y, t - 0.0012), (x, y, 0.0)]
        hull_piece(m, "iron", pts, X, iron_shade, metric=1.2)
    end = []
    for i in range(12):
        a = 2 * math.pi * i / 12
        end += [(L + 0.016 * math.cos(a), 0.016 * math.sin(a), 0.0), (L + 0.015 * math.cos(a), 0.015 * math.sin(a), t), (L + 0.016 * math.cos(a), 0.016 * math.sin(a), t - 0.0012)]
    hull_piece(m, "iron", end, X, iron_shade, metric=1.2)
    for x in (0.05, 0.13, L):  # domed nail heads
        dome = [(x + 0.006 * math.cos(a), 0.006 * math.sin(a), t) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)] + \
               [(x + 0.0035 * math.cos(a), 0.0035 * math.sin(a), t + 0.0022) for a in np.linspace(0, 2 * math.pi, 8, endpoint=False)]
        hull_piece(m, "iron", dome, X, iron_shade, metric=1.2)
    # the eye: the strap rolled round the pin at the leaf's edge, and the turn joining it to the strap
    hull_piece(m, "iron", cylinder_pts((-0.010, 0.0, 0.0), Y, 0.011, w0 * 1.1), Y, iron_shade, metric=1.2)
    hull_piece(m, "iron", [(-0.010, y, z) for y in (-w0 / 2, w0 / 2) for z in (0.005, -0.004)] + [(0.004, y, z) for y in (-w0 / 2, w0 / 2) for z in (0.0, t)], X, iron_shade, metric=1.2)
    return m

def pintle():
    """The pin (axis along y at the origin) above a square arm back into the wall, its foot leaded into the stone."""
    m = Mesh(); off = 0.085  # (the pin's axis is in the open leaf's face, 85 mm off the wall: the strap's eye)
    hull_piece(m, "iron", cylinder_pts((0, 0.0, 0), Y, 0.0065, 0.05, 8, 0.001), Y, iron_shade, metric=1.2)
    hull_piece(m, "iron", cylinder_pts((0, 0.027, 0), Y, 0.0085, 0.006, 8, 0.0015), Y, iron_shade, metric=1.2)  # its cap
    # the arm: under the eye (the eye rests on it), back into the wall
    y0 = -0.0175 - 0.008
    hull_piece(m, "iron", chamfer_box((0, y0, -(off + 0.04) / 2 + 0.006), (X, Y, Z), (0.008, 0.008, (off + 0.04) / 2 + 0.006), 0.0015), Z, iron_shade, metric=1.2)
    return m

def holdback():
    """A pivoting shutter dog on the wall beside an open leaf's free edge: a stem out of the wall and a flat paddle
    across the leaf's edge (its far end over the leaf). Origin on the wall face; -x is toward the leaf."""
    m = Mesh(); out = 0.094
    hull_piece(m, "iron", cylinder_pts((0, 0, (out - 0.03) / 2), Z, 0.009, out + 0.03, 8, 0.0015), Z, iron_shade, metric=1.2)
    hull_piece(m, "iron", cylinder_pts((0, 0, out - 0.002), Z, 0.013, 0.008, 10, 0.0015), Z, iron_shade, metric=1.2)
    d = unit((-0.035, 0.04, 0)); s = np.cross(Z, d)
    hull_piece(m, "iron", chamfer_box((0, 0, out + 0.004), (d, s, Z), (0.052, 0.011, 0.003), 0.0012), d, iron_shade, metric=1.2)
    for e in (-1, 1):  # (the paddle's rounded ends)
        hull_piece(m, "iron", cylinder_pts(np.array((0, 0, out + 0.004)) + d * 0.052 * e, Z, 0.011, 0.006, 10, 0.0012), Z, iron_shade, metric=1.2)
    return m

BUCKETS = {"open_a": (0.32, 1.815, 0.042), "open_b": (0.385, 1.815, 0.042),
           "shut_a": (0.45, 1.868, 0.030), "shut_b": (0.56, 1.868, 0.030), "shut_c": (0.70, 1.868, 0.030)}
models = {}
def save(name, m, info):
    files = {}
    for mat, rows in m.rows.items():
        if not rows: continue
        a = np.asarray(rows, np.float32); a.tofile(OUT / f"{name}-{mat}.bin"); files[mat] = {"file": f"{name}-{mat}.bin", "vertices": len(a)}
    models[name] = {**info, "surfaces": files, "triangles": sum(v["vertices"] for v in files.values()) // 3}

for kind in ("louvred", "panelled"):
    for b, (W, H, T) in BUCKETS.items():
        # (the panelled leaves are thinner than the louvred, whose slats need the depth)
        t = T if kind == "louvred" else min(T, 0.034)
        save(f"body_{kind}_{b}", body(kind, W, H, t), {"kind": kind, "bucket": b, "width": W, "height": H, "thickness": t})
save("strap", strap(), {}); save("pintle", pintle(), {}); save("holdback", holdback(), {})
(OUT / "models.json").write_text(json.dumps(models, indent=1))
for k, v in models.items(): print(k, v["triangles"])
