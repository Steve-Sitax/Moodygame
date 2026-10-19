"""Issue #174: the town's wooden shop fronts, shop windows and front doors, one model per part, made in code (numpy/scipy;
our own work).
    python scripts/build_shopfronts.py <output folder> <shop_goods.py's models.json>
Writes <name>-<material>.bin (rows of 16 floats per vertex: position, normal, uv, uv2, colour, custom0) for each model and
models.json. scripts/build-shopfronts.gd turns them into the game's meshes (assets/models/shopfronts); NativeShopFronts
puts copies where the bake's flat fronts, painted glass and door leaves stood (world/town/facades/shopfronts.json).

Model space: x across (centred unless said), y up, z out of the wall toward the street; the wall's face is z = 0. A shop
window's sill top is y = 0 (the bake's window: 2.256 m of glass from 0.713 m up, the reveal 0.12 m deep, the glass at its
back); a door's sill top is y = 0 and its leaf hangs from its hinge edge at x = 0. Sizes in metres; buckets (W) are the
widths the bake's openings come in, a copy is stretched at most about 6 % across.
- pilaster: one front pilaster (0.13 m wide; a copy is fitted to the bake's 0.08-0.14): a plinth block with a moulded cap, a
  shaft with chamfered arrises and a sunk panel, a console capital under the fascia. From the pavement to the glass's top.
- head_<W>: the fascia over the window (from pilaster to pilaster) with an applied moulded border, bead under it, and the
  cornice: bed moulding, corona with a drip, cyma, a sloping weathered top; capped ends. To 3.44 m, under the sign band.
- stall_<W>: the stall riser under the glass: a plinth board, a frame of stiles, rails and muntins round fielded panels, and
  the sill with a rounded nose and a drip, its top falling toward the street, running back to the glass.
- sash_<W>: the window frame at the back of the reveal: frame, bottom and top rails, a transom with the fanlight's small
  panes over it, mullions (one to three); glass_<W>: the glass, one quad in the frame's rebate.
- display_<W>: the window's display behind the glass: the bed at the sill, two shelves on the back board, side boards, a
  back board and a ceiling; valance_<W>: a cloth valance behind the fanlight; cloth_<W>: the cloth over the bed.
- door_<W>_<H>: a panelled front door leaf (four panels; two on a narrow leaf of a pair), 50 mm, chamfered stiles and rails,
  bolection mouldings round fielded panels, a weathered bottom rail with a drip; knob: a brass knob on a rose with the
  keyhole's escutcheon under it; letterplate: a brass letter plate with its flap.
Materials: "paint" (the shutter paint material: uv in the paint picture's left half, 0.6 m across one half, the grain along
v), "brass" (the goods picture's brass cell; the uv is the cell's middle), "glass" (the shop glass material), "cloth" (metric
uv, 1 m a repeat). The colour is a shade (inner corners and under faces darker); a copy's own colour (the paint, the cloth's
dye) multiplies it in the game.
"""
import json, math, pathlib, sys
import numpy as np
from scipy.spatial import ConvexHull

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
GOODS_CELLS = json.loads(pathlib.Path(sys.argv[2]).read_text())["cells"] if len(sys.argv) > 2 else None
rng = np.random.default_rng(174)
HALF = 0.6
X, Y, Z = np.eye(3)
HG = 2.256          # the glass's height (the bake's shop window, 12/64 to 50/64 of the ground storey)
REVEAL = 0.12       # the glass stands this far back in the wall
FOOT = -0.593       # the pavement at the stall riser's foot (0.12 m up, the window's sill 0.713)
FASCIA, CORNICE, TOP = HG + 0.331, HG + 0.471, HG + 0.471  # the fascia's top (3.30 m), the cornice's top (3.44 m)
# the brass: the goods picture's brass cell, its middle (shop_goods.py's models.json, the second argument)
def _mid(name): c = GOODS_CELLS[name]; return ((c[0] + c[2]) / 2, (c[1] + c[3]) / 2)
GLASS_DARK_UV, STONE_UV, IRON_UV = (_mid("black"), _mid("marble"), _mid("iron")) if GOODS_CELLS else ((0.0, 0.0),) * 3
BRASS_UV = ((GOODS_CELLS["brass"][0] + GOODS_CELLS["brass"][2]) / 2, (GOODS_CELLS["brass"][1] + GOODS_CELLS["brass"][3]) / 2) if GOODS_CELLS else (0.0, 0.0)

class Mesh:
    def __init__(self): self.rows = {}
    def tri(self, mat, ps, n, uvs, shade):
        a, b, c = (np.asarray(p, float) for p in ps)
        if np.linalg.norm(np.cross(b - a, c - a)) < 1e-12: return
        rows = [[*p, *n, *uv, 0.0, 0.0, shade, shade, shade, 1.0, 0.0, 0.0] for p, uv in zip((a, b, c), uvs)]
        if np.dot(np.cross(c - a, b - a), n) < 0: rows[1], rows[2] = rows[2], rows[1]
        self.rows.setdefault(mat, []).extend(rows)
    def quad(self, mat, ps, n, uvs, shade):
        self.tri(mat, ps[:3], n, uvs[:3], shade); self.tri(mat, (ps[0], ps[2], ps[3]), n, (uvs[0], uvs[2], uvs[3]), shade)
    def add(self, other, off=(0, 0, 0)):
        for mat, rows in other.rows.items():
            r = np.asarray(rows, float).copy(); r[:, 0:3] += off
            self.rows.setdefault(mat, []).extend(r.tolist())
    def triangles(self): return sum(len(r) for r in self.rows.values()) // 3

def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)

def shade_of(n, base=1.0):
    k = base
    if n[1] < -0.5: k *= 0.7
    elif n[1] > 0.5: k *= 1.03
    return k

def hull_piece(m, mat, pts, grain, base=1.0, metric=None, uoff=None):
    """A convex piece from its corner points: flat faces, planar uvs with the grain along `grain`."""
    pts = np.asarray(pts, float); h = ConvexHull(pts); centre = pts.mean(0)
    faces = {}
    for simplex, eq in zip(h.simplices, h.equations): faces.setdefault(tuple(np.round(eq, 5)), []).append(simplex)
    g = unit(grain); uo = float(rng.uniform(0.03, 0.3)) if uoff is None else uoff; vo = float(rng.uniform(0, 1))
    for key, tris in faces.items():
        n = np.array(key[:3]); gv = g - n * np.dot(g, n)
        if np.linalg.norm(gv) < 0.2: gv = Y - n * n[1]
        if np.linalg.norm(gv) < 0.2: gv = X - n * n[0]
        gv = unit(gv); gu = np.cross(n, gv)
        for s in tris:
            ps = pts[s]
            if metric: uvs = [(np.dot(p, gu) / metric, np.dot(p, gv) / metric) for p in ps]
            elif mat == "brass": uvs = [BRASS_UV] * 3
            elif mat == "iron": uvs = [IRON_UV] * 3
            else: uvs = [((np.dot(p - centre, gu) / HALF) * 0.5 + uo, np.dot(p, gv) / HALF + vo) for p in ps]
            m.tri(mat, ps, n, uvs, shade_of(n, base))

def cbox(m, lo, hi, ch, grain, mat="paint", base=1.0, chz=None):
    """A box from corner lo to hi, every arris chamfered by ch (the front's by chz when given)."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float); c = (lo + hi) / 2; h = (hi - lo) / 2
    out = []
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                for k in range(3):
                    q = h.copy(); q[[j for j in range(3) if j != k]] -= ch
                    out.append(c + q * np.array([sx, sy, sz]))
    hull_piece(m, mat, out, grain, base)

def extrude(m, mat, prof, x0, x1, base=1.0, caps=True):
    """A moulding: profile [(z, y)] (out from the wall and round, ending back at the wall) run along x from x0 to x1."""
    cz, cy = np.mean([p[0] for p in prof]), np.mean([p[1] for p in prof])
    vo = float(rng.uniform(0, 1))
    for (za, ya), (zb, yb) in zip(prof, prof[1:]):
        if abs(za - zb) < 1e-9 and abs(ya - yb) < 1e-9: continue
        W = [np.array((x0, ya, za)), np.array((x1, ya, za)), np.array((x1, yb, zb)), np.array((x0, yb, zb))]
        n = unit(np.cross(W[1] - W[0], W[3] - W[0]))
        if np.dot(n, np.array((0, (ya + yb) / 2 - cy, (za + zb) / 2 - cz))) < 0: n = -n
        # (the grain along the run: v along x; u across the profile's length)
        u0 = 0.05 + 0.5 * (math.hypot(za, ya) % 0.4); du = math.hypot(zb - za, yb - ya) / HALF * 0.5
        m.quad(mat, W, n, [(u0, x0 / HALF + vo), (u0, x1 / HALF + vo), (u0 + du, x1 / HALF + vo), (u0 + du, x0 / HALF + vo)], shade_of(n, base))
    if caps:
        for x, s in ((x0, -1), (x1, 1)):
            n = np.array((s, 0.0, 0.0))
            for (za, ya), (zb, yb) in zip(prof, prof[1:]):
                m.tri(mat, ((x, cy, cz), (x, ya, za), (x, yb, zb)), n, [(0.1 + cz, cy), (0.1 + za, ya), (0.1 + zb, yb)], base * 0.85)

def panel(m, x0, x1, y0, y1, z_back, z_face, side=1, bolection=True):
    """A fielded panel in a frame opening x0..x1, y0..y1: a sunk margin, a bevel up to a raised field, and (bolection) a small
    moulding round the opening proud of the frame's face. side 1: faces +z."""
    e, b = 0.008, min(0.045, (x1 - x0) * 0.22, (y1 - y0) * 0.22)
    zm, zf = z_back + side * 0.006, z_back + side * 0.016
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]
    mar = [(x0 + e, y0 + e), (x1 - e, y0 + e), (x1 - e, y1 - e), (x0 + e, y1 - e)]
    fld = [(x0 + e + b, y0 + e + b), (x1 - e - b, y0 + e + b), (x1 - e - b, y1 - e - b), (x0 + e + b, y1 - e - b)]
    nz = np.array((0.0, 0.0, side))
    uo, vo = float(rng.uniform(0.02, 0.2)), float(rng.uniform(0, 1))
    def uv(p): return ((p[0] - x0) / HALF * 0.5 + uo, p[1] / HALF + vo)
    def P(q, z): return np.array((q[0], q[1], z))
    for k in range(4):
        a0, a1 = ring[k], ring[(k + 1) % 4]; m0, m1 = mar[k], mar[(k + 1) % 4]; f0, f1 = fld[k], fld[(k + 1) % 4]
        for q in ((P(a0, z_face), P(a1, z_face), P(m1, zm), P(m0, zm)), (P(m0, zm), P(m1, zm), P(f1, zf), P(f0, zf))):
            n = unit(np.cross(q[1] - q[0], q[3] - q[0]))
            if np.dot(n, nz) < 0: n = -n
            m.quad("paint", q, n, [uv(p) for p in q], 0.82 if k == 2 else 0.95)
    q = [P(f, zf) for f in fld]
    m.quad("paint", q, nz, [uv(p) for p in q], 1.0)
    if bolection:  # a quarter-round bead round the opening, on the frame's face
        r = 0.011
        for k in range(4):
            a0, a1 = np.array(ring[k]), np.array(ring[(k + 1) % 4])
            d = unit(a1 - a0); inward = np.array((-d[1], d[0]))
            prof = [(0.0, 0.0), (0.0, r * 0.5), (r * 0.5, r * 0.95), (r, r)]  # (out of the opening, off the face)
            pts = []
            for (o, zz) in prof:
                pts.append((a0 - inward * o, z_face + side * zz)); pts.append((a1 - inward * o, z_face + side * zz))
            for i in range(len(prof) - 1):
                (p0, z0), (p1, z1_), (p2, z2), (p3, z3) = pts[2 * i], pts[2 * i + 1], pts[2 * i + 3], pts[2 * i + 2]
                W = [P(p0, z0), P(p1, z1_), P(p2, z2), P(p3, z3)]
                n = unit(np.cross(W[1] - W[0], W[3] - W[0]))
                if np.dot(n, np.array((-inward[0], -inward[1], side * 0.5))) < 0: n = -n
                m.quad("paint", W, n, [uv(p) for p in W], 0.92)

# ------------------------------------------------------------------ the front
def pilaster(p0=0.13):
    m = Mesh(); h = p0 / 2
    cbox(m, (-h, FOOT, 0.0), (h, -0.36, 0.118), 0.004, Y)                        # the plinth block
    cbox(m, (-h - 0.008, -0.36, 0.0), (h + 0.008, -0.33, 0.128), 0.006, X, base=1.02)  # its cap (a chamfered fillet)
    cbox(m, (-h, -0.33, 0.0), (h, 2.02, 0.088), 0.0035, Y)                        # the shaft
    # the sunk panel on the shaft's face: a frame round a recessed field, its inner arris chamfered
    m2 = Mesh(); panel_ring(m2, -h + 0.024, h - 0.024, -0.25, 1.94, 0.088, -0.006); m.add(m2)
    cbox(m, (-h - 0.004, 2.02, 0.0), (h + 0.004, 2.05, 0.099), 0.004, X)          # the neck band
    # the console: an ogee from the neck out to the cap under the fascia
    prof = [(0.0, 2.05), (0.099, 2.05), (0.104, 2.08), (0.112, 2.12), (0.118, 2.16), (0.124, 2.195), (0.124, 2.21), (0.0, 2.21)]
    extrude(m, "paint", prof, -h - 0.004, h + 0.004)
    cbox(m, (-h - 0.012, 2.21, 0.0), (h + 0.012, HG, 0.136), 0.005, X, base=1.02)  # the console's cap
    return m

def panel_ring(m, x0, x1, y0, y1, z_face, depth):
    """A sunk panel: a chamfered step down into a recessed field (depth < 0 into the piece)."""
    e = 0.006
    ring = [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]; inner = [(x0 + e, y0 + e), (x1 - e, y0 + e), (x1 - e, y1 - e), (x0 + e, y1 - e)]
    vo = float(rng.uniform(0, 1))
    def uv(p): return ((p[0] - x0) / HALF * 0.5 + 0.1, p[1] / HALF + vo)
    def P(q, z): return np.array((q[0], q[1], z))
    for k in range(4):
        q = (P(ring[k], z_face + 0.0005), P(ring[(k + 1) % 4], z_face + 0.0005), P(inner[(k + 1) % 4], z_face + depth), P(inner[k], z_face + depth))
        n = unit(np.cross(q[1] - q[0], q[3] - q[0]))
        if n[2] < 0: n = -n
        m.quad("paint", q, n, [uv(p) for p in q], 0.8)
    q = [P(f, z_face + depth) for f in inner]
    m.quad("paint", q, Z, [uv(p) for p in q], 0.96)

def head(W, p0=0.13):
    m = Mesh(); L = W / 2 + p0
    cbox(m, (-L, HG, 0.0), (L, FASCIA, 0.112), 0.004, X)                         # the fascia board
    # an applied border on its face (a small half-round moulding, 26 mm in)
    for (xa, ya, xb, yb) in ((-L + 0.03, HG + 0.03, L - 0.03, HG + 0.045), (-L + 0.03, FASCIA - 0.045, L - 0.03, FASCIA - 0.03),
                             (-L + 0.03, HG + 0.045, -L + 0.045, FASCIA - 0.045), (L - 0.045, HG + 0.045, L - 0.03, FASCIA - 0.045)):
        cbox(m, (xa, ya, 0.112), (xb, yb, 0.121), 0.004, X if xb - xa > yb - ya else Y)
    bead = [(0.0, HG - 0.018), (0.104, HG - 0.018), (0.116, HG - 0.012), (0.12, HG - 0.004), (0.118, HG + 0.004), (0.112, HG + 0.008), (0.0, HG + 0.008)]
    extrude(m, "paint", bead, -L - 0.004, L + 0.004)                              # the bead under the fascia
    C = L + 0.04
    cornice = [(0.0, FASCIA), (0.118, FASCIA), (0.124, FASCIA + 0.012), (0.134, FASCIA + 0.024), (0.146, FASCIA + 0.03),  # bed moulding (a cove)
               (0.170, FASCIA + 0.034), (0.172, FASCIA + 0.036), (0.172, FASCIA + 0.078),                                # the corona
               (0.176, FASCIA + 0.082), (0.185, FASCIA + 0.096), (0.186, FASCIA + 0.112), (0.18, FASCIA + 0.124),         # the cyma
               (0.172, FASCIA + 0.128), (0.0, TOP)]                                                                       # the weathered top
    extrude(m, "paint", cornice, -C, C)
    # the drip under the corona: a small groove read as a shadow line (a thin under face)
    cbox(m, (-C + 0.01, FASCIA + 0.030, 0.150), (C - 0.01, FASCIA + 0.036, 0.168), 0.002, X, base=0.6)
    return m

def stall(W):
    m = Mesh(); h = W / 2
    cbox(m, (-h, FOOT, 0.0), (h, FOOT + 0.13, 0.082), 0.004, X)                  # the plinth board
    y0, y1 = FOOT + 0.13, -0.07                                                   # the riser's frame
    n = 2 if W < 1.6 else 3
    sw, rb, rt, mw = 0.07, 0.06, 0.06, 0.06
    cbox(m, (-h, y0, 0.0), (-h + sw, y1, 0.062), 0.003, Y); cbox(m, (h - sw, y0, 0.0), (h, y1, 0.062), 0.003, Y)
    cbox(m, (-h + sw, y0, 0.0), (h - sw, y0 + rb, 0.06), 0.003, X); cbox(m, (-h + sw, y1 - rt, 0.0), (h - sw, y1, 0.06), 0.003, X)
    xs = np.linspace(-h + sw, h - sw, n + 1)
    for x in xs[1:-1]: cbox(m, (x - mw / 2, y0 + rb, 0.0), (x + mw / 2, y1 - rt, 0.058), 0.003, Y)
    for a, b in zip(xs, xs[1:]):
        a2 = a + (mw / 2 if a > -h + sw + 1e-6 else 0); b2 = b - (mw / 2 if b < h - sw - 1e-6 else 0)
        panel(m, a2, b2, y0 + rb, y1 - rt, 0.03, 0.06)
    # the sill: a rounded nose with a drip under it, the top falling to the street, back to the glass
    sill = [(-REVEAL, -0.07), (0.098, -0.07), (0.098, -0.062), (0.104, -0.062), (0.104, -0.07),  # (the drip groove)
            (0.112, -0.066), (0.118, -0.056), (0.12, -0.04), (0.118, -0.026), (0.112, -0.018),     # the nose
            (0.06, -0.008), (-REVEAL, 0.012)]
    extrude(m, "paint", sill + [sill[0]], -h - 0.006, h + 0.006)
    return m

def sash(W):
    m = Mesh(); h = W / 2; zb, zf = -REVEAL - 0.045, -REVEAL + 0.035
    fw, rb, rt = 0.055, 0.085, 0.06
    cbox(m, (-h, 0.012, zb), (-h + fw, HG, zf), 0.004, Y); cbox(m, (h - fw, 0.012, zb), (h, HG, zf), 0.004, Y)
    cbox(m, (-h + fw, 0.012, zb), (h - fw, 0.012 + rb, zf + 0.01), 0.004, X)      # the bottom rail (a little proud: it sheds water)
    cbox(m, (-h + fw, HG - rt, zb), (h - fw, HG, zf), 0.004, X)                   # the top rail
    yt = HG - 0.47                                                                 # the transom
    cbox(m, (-h + fw, yt - 0.03, zb), (h - fw, yt + 0.03, zf + 0.006), 0.005, X)
    nm = 1 if W < 1.3 else 2 if W < 2.25 else 3
    xs = np.linspace(-h + fw, h - fw, nm + 2)
    for x in xs[1:-1]: cbox(m, (x - 0.022, 0.012 + rb, zb + 0.005), (x + 0.022, yt - 0.03, zf - 0.004), 0.006, Y)  # the mullions
    # the fanlight's panes over the transom: twice as many, thin moulded bars
    xf = np.linspace(-h + fw, h - fw, 2 * (nm + 1) + 1)
    for x in xf[1:-1]: cbox(m, (x - 0.011, yt + 0.03, -REVEAL - 0.012), (x + 0.011, HG - rt, -REVEAL + 0.022), 0.004, Y)
    return m

def glass(W):
    m = Mesh(); h = W / 2; z = -REVEAL
    q = [(-h + 0.03, 0.05, z), (h - 0.03, 0.05, z), (h - 0.03, HG - 0.03, z), (-h + 0.03, HG - 0.03, z)]
    m.quad("glass", [np.array(p) for p in q], Z, [(0, 0), (W, 0), (W, HG), (0, HG)], 1.0)
    return m

DEEP = 0.395  # (the display's back board stands just in front of the bake's backing wall, 0.4 m behind the front)
def display(W):
    m = Mesh(); h = W / 2 - 0.004; zf, zb = -REVEAL - 0.048, -DEEP
    cbox(m, (-h, 0.0, zb), (h, 0.058, zf), 0.003, X, base=0.95)                   # the bed
    for ys in (0.62, 1.12):                                                       # two shelves on the back board
        cbox(m, (-h, ys, zb), (h, ys + 0.025, zb + 0.11), 0.003, X)
        for x in (-h + 0.12, h - 0.12):                                           # their brackets
            hull_piece(m, "paint", [(x - 0.012, ys, zb), (x + 0.012, ys, zb), (x - 0.012, ys - 0.1, zb), (x + 0.012, ys - 0.1, zb),
                                    (x - 0.012, ys, zb + 0.09), (x + 0.012, ys, zb + 0.09)], Y, 0.8)
    # the back board in narrow matched boards (a V-joint every 0.12 m), the side boards and the ceiling
    nb = max(3, int(round(W / 0.12)))
    xs = np.linspace(-h, h, nb + 1)
    for a, b in zip(xs, xs[1:]):  # (plain boards: the V-joints are the gaps between them)
        hull_piece(m, "paint", [(x, y, z) for x in (a + 0.002, b - 0.002) for y in (0.058, HG) for z in (zb - 0.02, zb)], Y, 0.85)
    cbox(m, (-h - 0.004, 0.0, zb), (-h + 0.012, HG, zf), 0.003, Y, base=0.8); cbox(m, (h - 0.012, 0.0, zb), (h + 0.004, HG, zf), 0.003, Y, base=0.8)
    cbox(m, (-h, HG - 0.02, zb), (h, HG, zf), 0.003, X, base=0.7)
    return m

def valance(W):
    """A cloth valance hanging behind the fanlight: gathered in folds, its foot cut in scallops."""
    m = Mesh(); h = W / 2 - 0.02; z0 = -REVEAL - 0.075; top, drop = HG - 0.02, 0.36
    n = max(8, int(W / 0.045))
    xs = np.linspace(-h, h, n + 1)
    for i, (a, b) in enumerate(zip(xs, xs[1:])):
        za, zb_ = z0 - 0.012 * (i % 2), z0 - 0.012 * ((i + 1) % 2)
        ya = top - drop + 0.05 * abs(math.sin(math.pi * (a + h) / 0.3)); yb = top - drop + 0.05 * abs(math.sin(math.pi * (b + h) / 0.3))
        q = [np.array((a, ya, za)), np.array((b, yb, zb_)), np.array((b, top, zb_)), np.array((a, top, za))]
        nn = unit(np.cross(q[1] - q[0], q[3] - q[0]))
        if nn[2] < 0: nn = -nn
        m.quad("cloth", q, nn, [(a, ya), (b, yb), (b, top), (a, top)], 0.9 if i % 2 else 1.0)
    return m

def cloth(W):
    """The cloth over the bed: laid over it, up the back board a little, hanging over the bed's front edge in soft folds."""
    m = Mesh(); h = W / 2 - 0.02; zf, zb = -REVEAL - 0.05, -DEEP + 0.005
    xs = np.linspace(-h, h, max(6, int(W / 0.08)) + 1)
    prof = [(zb + 0.002, 0.16), (zb + 0.004, 0.064), (zb + 0.03, 0.062), (zf + 0.002, 0.062), (zf + 0.012, 0.045), (zf + 0.016, 0.0)]  # (z, y): up the back, the bed, the front edge
    for a, b in zip(xs, xs[1:]):
        fa, fb = 0.006 * math.sin(a * 41), 0.006 * math.sin(b * 41)
        for (za, ya), (zb2, yb) in zip(prof, prof[1:]):
            q = [np.array((a, ya + (fa if ya < 0.05 else 0), za + (fa if ya < 0.05 else 0))), np.array((b, ya + (fb if ya < 0.05 else 0), za + (fb if ya < 0.05 else 0))),
                 np.array((b, yb + (fb if yb < 0.05 else 0), zb2 + (fb if yb < 0.05 else 0))), np.array((a, yb + (fa if yb < 0.05 else 0), zb2 + (fa if yb < 0.05 else 0)))]
            nn = unit(np.cross(q[1] - q[0], q[3] - q[0]))
            if nn[1] + nn[2] < 0: nn = -nn
            m.quad("cloth", q, nn, [(a, za + ya), (b, za + ya), (b, zb2 + yb), (a, zb2 + yb)], 1.0)
    return m

# ------------------------------------------------------------------ the doors
def door(W, H, double):
    """A leaf hung at x = 0, from x = 0 to W, its back at z = 0 (the back of the reveal), its face at z = 0.05."""
    m = Mesh(); T = 0.05
    sw, rt, rl, rb = (0.11, 0.11, 0.16, 0.2) if W > 0.85 else (0.1, 0.1, 0.15, 0.19)
    yl = H * 0.42
    cbox(m, (0.0, 0.0, 0.0), (sw, H, T), 0.003, Y); cbox(m, (W - sw, 0.0, 0.0), (W, H, T), 0.003, Y)
    cbox(m, (sw, H - rt, 0.0), (W - sw, H, T * 0.97), 0.003, X)
    cbox(m, (sw, yl - rl / 2, 0.0), (W - sw, yl + rl / 2, T * 0.97), 0.003, X)    # the lock rail (the letter plate goes in it)
    cbox(m, (sw, 0.0, 0.0), (W - sw, rb, T * 0.97), 0.003, X)
    # the weathered bottom rail: a sloping weatherboard with a drip, across the foot
    wb = [(T, 0.012), (T + 0.03, 0.03), (T + 0.032, 0.04), (T + 0.008, 0.075), (T, 0.075)]
    extrude(m, "paint", wb + [wb[0]], 0.004, W - 0.004)
    mullion = not double and W > 0.85
    cols = [(sw, W / 2 - 0.045), (W / 2 + 0.045, W - sw)] if mullion else [(sw, W - sw)]
    if mullion:
        cbox(m, (W / 2 - 0.045, rb, 0.0), (W / 2 + 0.045, yl - rl / 2, T * 0.96), 0.003, Y)
        cbox(m, (W / 2 - 0.045, yl + rl / 2, 0.0), (W / 2 + 0.045, H - rt, T * 0.96), 0.003, Y)
    for a, b in cols:
        panel(m, a, b, yl + rl / 2, H - rt, T * 0.5, T * 0.96)                     # the tall upper panels
        panel(m, a, b, rb, yl - rl / 2, T * 0.5, T * 0.96)                         # the lower ones
    return m

def lathe(m, mat, prof, c, axis, sides=12, base=1.0):
    """A turned piece: profile [(r, t)] round `axis` through c."""
    axis = unit(axis); a = unit(np.cross(axis, X if abs(axis[0]) < 0.9 else Y)); b = np.cross(axis, a); c = np.asarray(c, float)
    ring = lambda r, t, i: c + axis * t + (a * math.cos(2 * math.pi * i / sides) + b * math.sin(2 * math.pi * i / sides)) * r
    inside = c + axis * float(np.mean([t for _, t in prof]))  # (normals point away from the turned body's middle)
    for (r0, t0), (r1, t1) in zip(prof, prof[1:]):
        for i in range(sides):
            q = [ring(r0, t0, i), ring(r0, t0, i + 1), ring(r1, t1, i + 1), ring(r1, t1, i)]
            n = np.cross(q[1] - q[0], q[3] - q[0])
            if np.linalg.norm(n) < 1e-12: n = np.cross(q[2] - q[1], q[3] - q[1])
            if np.linalg.norm(n) < 1e-12: continue
            n = unit(n)
            if np.dot(n, (q[0] + q[2]) / 2 - inside) < 0: n = -n
            m.quad(mat, q, n, [BRASS_UV] * 4 if mat == "brass" else [(i / sides, t0), ((i + 1) / sides, t0), ((i + 1) / sides, t1), (i / sides, t1)], base)

def knob():
    """The front door's brass knob on a round rose, 60 mm across, and the keyhole's escutcheon under it. Origin on the leaf's
    face at the knob's axis; +z out."""
    m = Mesh()
    lathe(m, "brass", [(0.0, 0.0), (0.03, 0.0), (0.032, 0.004), (0.026, 0.008), (0.009, 0.01), (0.008, 0.04), (0.018, 0.046), (0.03, 0.058), (0.032, 0.068), (0.026, 0.078), (0.012, 0.083), (0.0, 0.084)], (0, 0, 0), Z, 14)
    # the escutcheon: a small plate 0.12 m under, with a dark keyhole (an under face) in it
    hull_piece(m, "brass", [(x, y, z) for x in (-0.016, 0.016) for y in (-0.145, -0.095) for z in (0.0, 0.003)] +
               [(x, y, 0.0045) for x in (-0.013, 0.013) for y in (-0.142, -0.098)], Y)
    hull_piece(m, "paint", [(x, y, z) for x in (-0.0035, 0.0035) for y in (-0.128, -0.112) for z in (0.0046, 0.005)], Y, base=0.08)
    return m

def letterplate():
    """A brass letter plate on the lock rail: a frame round the slot and its hinged flap, 0.26 m by 0.07 m. Origin on the face."""
    m = Mesh()
    hull_piece(m, "brass", [(x, y, z) for x in (-0.13, 0.13) for y in (-0.035, 0.035) for z in (0.0, 0.002)] +
               [(x, y, 0.0035) for x in (-0.126, 0.126) for y in (-0.031, 0.031)], X)
    hull_piece(m, "brass", [(x, y, z) for x in (-0.11, 0.11) for y in (-0.018, 0.016) for z in (0.0035, 0.007)] + [(x, 0.018, 0.0055) for x in (-0.11, 0.11)], X)  # the flap
    for x in (-0.118, 0.118):  # the flap's knuckles
        lathe(m, "brass", [(0.0, -0.006), (0.004, -0.006), (0.004, 0.006), (0.0, 0.006)], (x, 0.017, 0.006), X, 8)
    return m

# ------------------------------------------------------------------ the Carolus (#28)
def church_door(W=0.95, H=4.1, meeting_right=True):
    """One leaf of a church's oak double door, from x = 0 to W: heavy stiles and rails round three rows of fielded panels
    (a tall upper, a square middle, a low one), a moulded meeting stile, an iron ring pull on it; 70 mm thick. The meeting
    stile is at x = W (the leaf on the left of the pair, seen from outside: church_door_r) or at x = 0 (church_door_l)."""
    m = Mesh(); T = 0.07; sw, rt, rb = 0.14, 0.16, 0.24
    rows = [(rb, 1.05), (1.21, 2.25), (2.41, H - rt)]
    cbox(m, (0.0, 0.0, 0.0), (sw, H, T + (0.0 if meeting_right else 0.008)), 0.005, Y); cbox(m, (W - sw, 0.0, 0.0), (W, H, T + (0.008 if meeting_right else 0.0)), 0.005, Y)  # (the meeting stile stands proud)
    cbox(m, (sw, H - rt, 0.0), (W - sw, H, T * 0.97), 0.005, X); cbox(m, (sw, 0.0, 0.0), (W - sw, rb, T * 0.97), 0.005, X)
    for a, b in zip(rows, rows[1:]): cbox(m, (sw, a[1], 0.0), (W - sw, b[0], T * 0.97), 0.005, X)
    for y0, y1 in rows: panel(m, sw, W - sw, y0, y1, T * 0.5, T * 0.97)
    wb = [(T, 0.015), (T + 0.035, 0.035), (T + 0.038, 0.05), (T + 0.01, 0.1), (T, 0.1)]
    extrude(m, "paint", wb + [wb[0]], 0.005, W - 0.005)
    # the ring pull: a back plate, a staple and a hanging ring, in wrought iron
    xr = W - 0.07 if meeting_right else 0.07
    hull_piece(m, "iron", [(xr + x, 1.15 + y, T + 0.008 + z) for x in (-0.05, 0.05) for y in (-0.05, 0.05) for z in (0.0, 0.006)], Y, metric=1.0)
    lathe(m, "iron", [(0.0, 0.0), (0.012, 0.0), (0.012, 0.03), (0.0, 0.03)], (xr, 1.15, T + 0.014), Z, 8)
    for i in range(16):  # the ring, a torus of 16 short pieces
        a0, a1 = 2 * math.pi * i / 16, 2 * math.pi * (i + 1) / 16; R, r = 0.065, 0.009
        c0 = np.array((xr + R * math.sin(a0), 1.15 - 0.065 + R * math.cos(a0), T + 0.05)); c1 = np.array((xr + R * math.sin(a1), 1.15 - 0.065 + R * math.cos(a1), T + 0.05))
        hull_piece(m, "iron", [c + d for c in (c0, c1) for d in ((r, 0, 0), (-r, 0, 0), (0, r, 0), (0, -r, 0), (0, 0, r), (0, 0, -r))], X, metric=1.0)
    return m

def fanlight(R=0.75):
    """An arched fanlight over a door: the frame round a half circle of radius R (its spring line at y = 0, its foot a
    transom), five glazing bars from a half-round hub and a ring half way out, dark glass behind; z 0 the back of the reveal."""
    m = Mesh(); z0, z1 = 0.0, 0.06
    def P(r, a, z): return np.array((r * math.cos(a), r * math.sin(a), z))
    n = 16
    for i in range(n):  # the frame: an arched band 70 mm wide
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        hull_piece(m, "paint", [P(r, a, z) for r in (R - 0.07, R) for a in (a0, a1) for z in (z0, z1)], (-math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2), 0))
    cbox(m, (-R, -0.05, z0), (R, 0.04, z1 + 0.01), 0.004, X)  # the transom
    hub = R * 0.22
    for i in range(8): hull_piece(m, "paint", [P(r, a, z) for r in (0.0, hub) for a in (math.pi * i / 8, math.pi * (i + 1) / 8) for z in (z0, z1 - 0.01)], Z)
    for k in range(1, 6):
        a = k * math.pi / 6; d = np.array((math.cos(a), math.sin(a), 0)); s_ = np.array((-math.sin(a), math.cos(a), 0)) * 0.012
        p0, p1 = d * hub, d * (R - 0.06)
        hull_piece(m, "paint", [p + s + np.array((0, 0, z)) for p in (p0, p1) for s in (s_, -s_) for z in (z0 + 0.01, z1 - 0.015)], d)
    for i in range(12):
        a0, a1 = math.pi * i / 12, math.pi * (i + 1) / 12
        hull_piece(m, "paint", [P(r, a, z) for r in (R * 0.6 - 0.012, R * 0.6 + 0.012) for a in (a0, a1) for z in (z0 + 0.01, z1 - 0.015)], (-math.sin((a0 + a1) / 2), math.cos((a0 + a1) / 2), 0))
    for i in range(n):  # the glass: dark, at the back
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        m.tri("glass_dark", (np.array((0, 0.04, z0 + 0.005)), P(R - 0.06, a0, z0 + 0.005), P(R - 0.06, a1, z0 + 0.005)), Z, [GLASS_DARK_UV] * 3, 1.0)
    return m

def oculus(r=0.2):
    """A round window's surround (a moulded stone ring standing 60 mm proud), its glass sunk 40 mm behind a cross of
    glazing bars: over a painted dark disc. Origin at the disc's middle on its face; z out."""
    m = Mesh()
    prof = [(r * 0.86, -0.04), (r * 0.86, 0.0), (r * 0.92, 0.035), (r * 1.0, 0.06), (r * 1.12, 0.062), (r * 1.2, 0.04), (r * 1.22, 0.0)]
    for i in range(20):
        a0, a1 = 2 * math.pi * i / 20, 2 * math.pi * (i + 1) / 20
        for (ra, za), (rb, zb) in zip(prof, prof[1:]):
            q = [np.array((ra * math.cos(a0), ra * math.sin(a0), za)), np.array((ra * math.cos(a1), ra * math.sin(a1), za)), np.array((rb * math.cos(a1), rb * math.sin(a1), zb)), np.array((rb * math.cos(a0), rb * math.sin(a0), zb))]
            nn = unit(np.cross(q[1] - q[0], q[3] - q[0]))
            mid = (q[0] + q[2]) / 2
            if np.dot(nn, np.array((mid[0], mid[1], 0.0)) * (1 if rb > ra else -1) + np.array((0, 0, 0.02))) < 0: nn = -nn
            m.quad("stone", q, nn, [(float(v[0]) * 2.0, float(v[1]) * 2.0 + float(v[2])) for v in q], 0.95)
    for d in (X, Y):  # the cross of bars
        side = np.cross(d, Z) * 0.012
        hull_piece(m, "paint", [c + sd + np.array((0, 0, z)) for c in (-d * r * 0.88, d * r * 0.88) for sd in (side, -side) for z in (-0.035, -0.01)], d)
    for i in range(20):
        a0, a1 = 2 * math.pi * i / 20, 2 * math.pi * (i + 1) / 20
        m.tri("glass_dark", (np.array((0, 0, -0.038)), np.array((r * 0.88 * math.cos(a0), r * 0.88 * math.sin(a0), -0.038)), np.array((r * 0.88 * math.cos(a1), r * 0.88 * math.sin(a1), -0.038))), Z, [GLASS_DARK_UV] * 3, 1.0)
    return m

def louvre(W=0.56, H=0.85):
    """A dormer's louvres: a frame and slats at 45 degrees shedding the rain outward, 60 mm deep. Origin at the bottom
    middle of the opening on its face; z out."""
    m = Mesh(); fw = 0.045
    cbox(m, (-W / 2, 0.0, -0.06), (-W / 2 + fw, H, 0.0), 0.004, Y); cbox(m, (W / 2 - fw, 0.0, -0.06), (W / 2, H, 0.0), 0.004, Y)
    cbox(m, (-W / 2, 0.0, -0.06), (W / 2, fw, 0.005), 0.004, X); cbox(m, (-W / 2, H - fw, -0.06), (W / 2, H, 0.0), 0.004, X)
    n = int((H - 2 * fw) / 0.07)
    for k in range(n):
        y = fw + (k + 0.5) * (H - 2 * fw) / n
        a = np.array((0, -0.035, 0.03)) / 2  # (each slat 45 mm wide, tipped down toward the outside)
        hull_piece(m, "paint", [np.array((x, y, -0.03)) + a * s + np.array((0, 0, 0)) + t for x in (-W / 2 + fw, W / 2 - fw) for s in (-1, 1) for t in (np.array((0, 0.005, 0.0)), np.array((0, -0.005, 0.0)))], X)
    return m

# ------------------------------------------------------------------ write
SHOP_W = [0.5, 0.75, 1.0, 1.25, 1.5, 1.7, 1.9, 2.1, 2.3, 2.6, 2.85]
DOORS = [(0.75, 2.15, True), (0.92, 1.95, False), (0.92, 2.15, False), (1.1, 2.15, False), (0.75, 2.62, True), (1.1, 1.95, False)]
models = {}
def save(name, m, info):
    files = {}
    for mat, rows in m.rows.items():
        if not rows: continue
        a = np.asarray(rows, np.float32); a.tofile(OUT / f"{name}-{mat}.bin"); files[mat] = {"file": f"{name}-{mat}.bin", "vertices": len(a)}
    models[name] = {**info, "surfaces": files, "triangles": sum(v["vertices"] for v in files.values()) // 3}

save("pilaster", pilaster(), {"width": 0.13})
for W in SHOP_W:
    k = f"{W:.2f}".replace(".", "")
    save(f"head_{k}", head(W), {"width": W}); save(f"stall_{k}", stall(W), {"width": W}); save(f"sash_{k}", sash(W), {"width": W})
    save(f"glass_{k}", glass(W), {"width": W}); save(f"display_{k}", display(W), {"width": W})
    save(f"valance_{k}", valance(W), {"width": W}); save(f"cloth_{k}", cloth(W), {"width": W})
for W, H, dbl in DOORS:
    save(f"door_{W:.2f}_{H:.2f}".replace(".", ""), door(W, H, dbl), {"width": W, "height": H, "double": dbl})
save("knob", knob(), {}); save("letterplate", letterplate(), {})
save("church_door_r", church_door(), {"width": 0.95, "height": 4.1}); save("church_door_l", church_door(meeting_right=False), {"width": 0.95, "height": 4.1}); save("fanlight", fanlight(), {"radius": 0.75})
save("oculus", oculus(), {"radius": 0.2}); save("louvre", louvre(), {"width": 0.56, "height": 0.85})
(OUT / "models.json").write_text(json.dumps(models, indent=1))
for k, v in models.items(): print(k, v["triangles"])
