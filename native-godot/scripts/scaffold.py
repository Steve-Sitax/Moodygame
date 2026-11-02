"""A builder's putlog scaffold of 1873 against a bared party wall (#226: "a builder's scaffold at a half-cleared plot").
    python scripts/scaffold.py <out folder>
    godot --headless --path . -s scripts/build-scaffold.gd -- <out folder>
One reusable model (assets/models/scaffold-20261102/scaffold.tscn): two bays of a single-pole (putlog) scaffold as a
mason set it up to make good a wall:
- three standards: peeled fir poles 8 m long, 130 mm at the butt tapering to 95 mm, a little bowed, each stood on a
  sole board, 1.3 m out from the wall and 2.5 m apart; their sawn ends eased (12 mm);
- ledgers along the wall at each lift (1.95, 3.75, 5.55 m) and a top tie (7.1 m): 95 mm poles running 0.35 m past the
  end standards, on the wall side of the standards;
- putlogs: squared fir 75 x 90 mm, 1.55 m, one end resting on the ledger, the other set 110 mm into a putlog hole in the
  brick (the hole a little larger than the putlog, dark behind it), about 1.25 m apart, the edges chamfered 3 mm;
- boards: sawn deals 230 x 38 mm, 2.6 to 3.1 m, four abreast on the putlogs of the second and third lifts (their ends
  staggered and lapped over a putlog), two loose boards on the first; edges chamfered 2 mm;
- a guard rail pole 1 m over the top boards, a long brace across both bays' outer face, a pole ladder (split stiles,
  rungs 300 mm apart) leaning on the second lift;
- lashings: hemp rope, 12 mm, four turns round the standard above and below every ledger and the guard rail and round
  the ledger each side of the standard, and where the brace and the ladder cross.
Frame: x along the wall (0 at the first standard), y up from the street, z out of the wall's brick face (z 0).
Materials: the town's weathered board wood (barrels-20261026/barrel-wood.tres: the solid lit kind) and the rope picture
drawn here in the same material (scaffold-rope.tres: no new kind). Collision: a cylinder for every standard and the
brace's foot, a box for every sole board, the ladder and the boarded lifts.
Writes scaffold.json (both surfaces, the shapes) and rope.png / rope-height.png.
"""
import sys, json, math, pathlib
import numpy as np
from PIL import Image

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
rng = np.random.default_rng(1873_1102)
WOOD_U, WOOD_V = 1.5, 0.5          # the board picture's size in metres (2172 x 724)

class Surf:
    def __init__(self): self.v, self.n, self.uv = [], [], []
    def tri(self, a, b, c, na, nb, nc, ua, ub, uc):
        # (Godot's front face is clockwise seen from outside: emit a, c, b for a counter-clockwise outward triangle)
        for p, n, u in ((a, na, ua), (c, nc, uc), (b, nb, ub)):
            self.v.append([float(x) for x in p]); self.n.append([float(x) for x in n]); self.uv.append([float(u[0]), float(u[1])])
    def quad(self, a, b, c, d, na, nb, nc, nd, ua, ub, uc, ud):
        self.tri(a, b, c, na, nb, nc, ua, ub, uc); self.tri(a, c, d, na, nc, nd, ua, uc, ud)

wood, rope = Surf(), Surf()
shapes = []

def unit(v): v = np.asarray(v, float); return v / (np.linalg.norm(v) + 1e-12)
def frame(d):
    d = unit(d); a = np.array([0.0, 1.0, 0.0]) if abs(d[1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    e1 = unit(np.cross(d, a)); e2 = np.cross(d, e1); return d, e1, e2

def pole(p0, p1, r0, r1, sides=10, bow=0.0, ease=0.012, surf=None, seed_off=None):
    """A round pole from p0 to p1 (radius r0 to r1), bowed by bow metres at its middle, its sawn ends' arrises eased."""
    surf = surf or wood
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    d, e1, e2 = frame(p1 - p0); L = float(np.linalg.norm(p1 - p0))
    segs = max(2, int(L / 0.6))
    u0, v0 = rng.uniform(0, 1), rng.uniform(0, 1)
    bow_dir = e1 * math.cos(rng.uniform(0, 6.28)) + e2 * math.sin(rng.uniform(0, 6.28))
    def C(t): return p0 + d * L * t + bow_dir * bow * 4 * t * (1 - t)
    def R(t): return (r0 + (r1 - r0) * t) * (1 + 0.025 * math.sin(t * 17.0 + u0 * 6))
    rings = []
    ts = [0.0, ease / L] + [k / segs for k in range(1, segs)] + [1 - ease / L, 1.0]
    for i, t in enumerate(ts):
        r = R(t) * (1 - (0.0 if 0 < i < len(ts) - 1 else ease / max(R(t), 1e-3) * 0.9))
        c = C(t) + (d * ease * 0.6 if i == 0 else -d * ease * 0.6 if i == len(ts) - 1 else 0)
        ring = []
        for k in range(sides + 1):
            a = 2 * math.pi * k / sides
            n = e1 * math.cos(a) + e2 * math.sin(a)
            ring.append((c + n * r, n, (u0 + t * L / WOOD_U, v0 + a * r / WOOD_V)))
        rings.append(ring)
    for i in range(len(rings) - 1):
        for k in range(sides):
            a, b, c2, e = rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]
            # the eased ends: their faces lean toward the end
            na, nb, nc, ne = a[1], b[1], c2[1], e[1]
            if i == 0: na, nb = unit(na - d * 0.7), unit(nb - d * 0.7)
            if i == len(rings) - 2: nc, ne = unit(nc + d * 0.7), unit(ne + d * 0.7)
            surf.quad(a[0], b[0], c2[0], e[0], na, nb, nc, ne, a[2], b[2], c2[2], e[2])
    # the end discs (end grain: a small patch of the picture)
    for ring, nn, sgn in ((rings[0], -d, -1), (rings[-1], d, 1)):
        c = sum(q[0] for q in ring[:-1]) / sides
        for k in range(sides):
            a, b = ring[k][0], ring[k + 1][0]
            uva = (0.5 + (a - c) @ e1 * 2, 0.5 + (a - c) @ e2 * 2); uvb = (0.5 + (b - c) @ e1 * 2, 0.5 + (b - c) @ e2 * 2)
            if sgn > 0: surf.tri(c, a, b, nn, nn, nn, (0.5, 0.5), uva, uvb)
            else: surf.tri(c, b, a, nn, nn, nn, (0.5, 0.5), uvb, uva)
    return C

def cbox(centre, ax, ay, az, hx, hy, hz, k, surf=None, long_axis=0):
    """A box (half sizes hx, hy, hz along the unit axes ax, ay, az) with every edge chamfered k; the picture's grain
    along the long axis."""
    surf = surf or wood
    c = np.asarray(centre, float); A = [np.asarray(ax, float), np.asarray(ay, float), np.asarray(az, float)]; H = [hx, hy, hz]
    u0, v0 = rng.uniform(0, 1), rng.uniform(0, 1)
    def W(l): return c + A[0] * l[0] + A[1] * l[1] + A[2] * l[2]
    def UV(l, n):
        # grain along the long axis; across it the other axis the face spans
        la = long_axis; others = [i for i in range(3) if i != la]
        if abs(n[la]) > 0.9:            # end grain
            return (v0 + l[others[0]] / WOOD_V * 0.3, u0 + l[others[1]] / WOOD_V * 0.3)
        o = others[0] if abs(n[others[0]]) < 0.5 else others[1]
        return (u0 + l[la] / WOOD_U, v0 + l[o] / WOOD_V)
    def face(l4, nloc):
        n = unit(A[0] * nloc[0] + A[1] * nloc[1] + A[2] * nloc[2])
        P = [W(l) for l in l4]; U = [UV(l, nloc) for l in l4]
        # make the quad counter-clockwise seen from outside
        if np.cross(P[1] - P[0], P[2] - P[0]) @ n < 0: P, U = P[::-1], U[::-1]
        if len(P) == 4: surf.quad(*P, n, n, n, n, *U)
        else: surf.tri(*P, n, n, n, *U)
    for ax_ in range(3):
        for s in (-1, 1):
            i, j = [q for q in range(3) if q != ax_]
            l4 = []
            for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                l = [0, 0, 0]; l[ax_] = s * H[ax_]; l[i] = a * (H[i] - k); l[j] = b * (H[j] - k); l4.append(l)
            nl = [0, 0, 0]; nl[ax_] = s; face(l4, nl)
    for i in range(3):
        for j in range(i + 1, 3):
            m = 3 - i - j
            for si in (-1, 1):
                for sj in (-1, 1):
                    l4 = []
                    for sm, first in ((-1, True), (1, True), (1, False), (-1, False)):
                        l = [0, 0, 0]
                        if first: l[i] = si * H[i]; l[j] = sj * (H[j] - k)
                        else: l[i] = si * (H[i] - k); l[j] = sj * H[j]
                        l[m] = sm * (H[m] - k); l4.append(l)
                    nl = [0, 0, 0]; nl[i] = si; nl[j] = sj; face(l4, nl)
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                S = (sx, sy, sz)
                l3 = []
                for q in range(3):
                    l = [S[r] * (H[r] - k) for r in range(3)]; l[q] = S[q] * H[q]; l3.append(l)
                face(l3, list(S))

def lash_ring(c, d, R, t=0.006, segs=9, sides=4, tilt=0.0):
    """One turn of rope round an axis d at c (ring radius R to the rope's middle), tilted a little out of square."""
    c = np.asarray(c, float); d, e1, e2 = frame(d)
    dd = unit(d + e1 * tilt)
    _, f1, f2 = frame(dd)
    v0 = rng.uniform(0, 1)
    rings = []
    for i in range(segs + 1):
        a = 2 * math.pi * i / segs
        m = c + (f1 * math.cos(a) + f2 * math.sin(a)) * R
        rad = unit(f1 * math.cos(a) + f2 * math.sin(a))
        ring = []
        for k in range(sides + 1):
            b = 2 * math.pi * k / sides
            n = rad * math.cos(b) + dd * math.sin(b)
            ring.append((m + n * t, n, (k / sides * 0.75, v0 + a * R / 0.04)))
        rings.append(ring)
    for i in range(segs):
        for k in range(sides):
            a, b, cc, e = rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]
            rope.quad(a[0], e[0], cc[0], b[0], a[1], e[1], cc[1], b[1], a[2], e[2], cc[2], b[2])

def lashing(at, d_main, r_main, d_cross, r_cross, turns=3):
    """A square lashing: turns round the main pole either side of the crossing pole and round the crossing pole
    either side of the main one."""
    at = np.asarray(at, float); d_main = unit(d_main); d_cross = unit(d_cross)
    t = 0.0062
    for side in (-1, 1):
        for k in range(turns):
            off = side * (r_cross + t + 2 * t * k * 0.95)
            lash_ring(at + d_main * off, d_main, r_main + t * 0.9, t, tilt=0.08 * side)
            off2 = side * (r_main + t + 2 * t * k * 0.95)
            lash_ring(at + d_cross * off2 + 0 * d_main, d_cross, r_cross + t * 0.9, t, tilt=-0.08 * side)

def cyl_shape(p0, p1, r): shapes.append({'kind': 'cylinder', 'from': [float(x) for x in p0], 'to': [float(x) for x in p1], 'radius': r})
def box_shape(centre, ax, ay, az, size): shapes.append({'kind': 'box', 'centre': [float(x) for x in centre], 'basis': [[float(x) for x in ax], [float(x) for x in ay], [float(x) for x in az]], 'size': [float(x) for x in size]})

X, Y, Z = np.array([1.0, 0, 0]), np.array([0, 1.0, 0]), np.array([0, 0, 1.0])
OUTZ = 1.30                     # standards' axis out from the wall
BAY = 2.5
STD = [0.0, BAY, 2 * BAY]
TOP = 7.9
LIFTS = [1.95, 3.75, 5.55]
TIE = 7.1
R_STD0, R_STD1 = 0.065, 0.048
R_LED = 0.047
LED_Z = OUTZ - R_STD0 - R_LED + 0.004      # on the wall side, touching the standard

# standards on their sole boards
std_axis = {}
for x in STD:
    lean = rng.normal(0, 0.012)
    p0 = np.array([x, 0.05, OUTZ]); p1 = np.array([x + lean, TOP, OUTZ + rng.normal(0, 0.01)])
    pole(p0, p1, R_STD0, R_STD1, sides=12, bow=rng.uniform(0.01, 0.025))
    std_axis[x] = (p0, p1)
    cyl_shape(p0, p1, R_STD0)
    cbox([x + rng.normal(0, 0.03), 0.025, OUTZ], X, Y, Z, 0.27, 0.025, 0.115, 0.004, long_axis=0)
    box_shape([x, 0.025, OUTZ], X, Y, Z, [0.54, 0.05, 0.23])

def std_at(x, y):
    p0, p1 = std_axis[x]; t = (y - p0[1]) / (p1[1] - p0[1]); return p0 + (p1 - p0) * t

# ledgers and the top tie
for y in LIFTS + [TIE]:
    p0 = np.array([STD[0] - 0.35, y, LED_Z]); p1 = np.array([STD[-1] + 0.35, y + rng.normal(0, 0.02), LED_Z])
    pole(p0, p1, R_LED, R_LED * 0.92, sides=10, bow=0.012)
    for x in STD:
        c = std_at(x, y); c = np.array([c[0], y, c[2]])
        lashing(c + Z * 0.0, Y, R_STD0 * (1 - 0.3 * y / TOP), X, R_LED)

# putlogs (one end in the wall, the other on the ledger) and the boards on them
PUTLOG_X = [0.32, 1.25, 2.18, 2.82, 3.75, 4.68]
put_tops = {}
for li, y in enumerate(LIFTS):
    top = y + R_LED
    tops = []
    for px in PUTLOG_X:
        px2 = px + rng.normal(0, 0.03)
        hz = 0.775; cz = -0.11 + hz
        cbox([px2, top + 0.045, cz], X, Y, Z, 0.0375, 0.045, hz, 0.003, long_axis=2)
        # the putlog hole: its dark round the putlog where it goes into the brick
        hole = [np.array([px2 - 0.0495, top - 0.014, 0.003]), np.array([px2 + 0.0495, top - 0.014, 0.003]),
                np.array([px2 + 0.0495, top + 0.104, 0.003]), np.array([px2 - 0.0495, top + 0.104, 0.003])]
        rope.quad(hole[0], hole[1], hole[2], hole[3], Z, Z, Z, Z, (0.84, 0.1), (0.95, 0.1), (0.95, 0.9), (0.84, 0.9))
        tops.append((px2, top + 0.09))
    put_tops[y] = tops

def boards(y, rows, full=True):
    tops = put_tops[y]; ytop = tops[0][1]
    for r in range(rows):
        z0 = 0.06 + r * 0.24
        # runs of boards butted over a putlog (a 10 mm gap), the joints staggered row to row
        cuts = [STD[0] - 0.25, (2.82 if r % 2 == 0 else 2.18), STD[-1] + 0.25] if full else [0.9 + 0.35 * r, 3.6 + 0.3 * r]
        for i, (a, b) in enumerate(zip(cuts[:-1], cuts[1:])):
            a2 = a + (0.005 if i > 0 else 0); b2 = b - (0.005 if i < len(cuts) - 2 else 0)
            cbox([(a2 + b2) / 2, ytop + 0.019 + rng.normal(0, 0.0015), z0 + 0.115 + rng.normal(0, 0.006)], X, Y, Z, (b2 - a2) / 2, 0.019, 0.112, 0.002, long_axis=0)

boards(LIFTS[1], 4); boards(LIFTS[2], 4); boards(LIFTS[0], 2, full=False)
for y in LIFTS[1:]:
    ytop = put_tops[y][0][1]
    box_shape([STD[1], ytop + 0.019, 0.06 + 0.48], X, Y, Z, [2 * BAY + 0.5, 0.04, 0.96])
box_shape([2.25, put_tops[LIFTS[0]][0][1] + 0.019, 0.3], X, Y, Z, [2.5, 0.04, 0.48])

# the guard rail on the outer side of the standards, 1 m over the top boards
yr = put_tops[LIFTS[2]][0][1] + 1.0
p0 = np.array([STD[0] - 0.3, yr, OUTZ + R_STD0 + 0.04]); p1 = np.array([STD[-1] + 0.3, yr, OUTZ + R_STD0 + 0.04])
pole(p0, p1, 0.04, 0.037, sides=8, bow=0.015)
for x in STD:
    c = std_at(x, yr); lashing(np.array([c[0], yr, OUTZ + R_STD0 * 0.5]), Y, R_STD1 + 0.006, X, 0.04, turns=3)

# a long brace across both bays' outer face
b0 = np.array([STD[0] + 0.15, 0.08, OUTZ + R_STD0 + 0.045]); b1 = np.array([STD[-1] - 0.1, 6.6, OUTZ + R_STD0 + 0.045])
pole(b0, b1, 0.045, 0.036, sides=8, bow=0.02)
cyl_shape(b0, b0 + (b1 - b0) * 0.3, 0.045)
for x in STD[1:2]:
    t = (x - b0[0]) / (b1[0] - b0[0]); c = b0 + (b1 - b0) * t
    lashing(np.array([x, c[1], OUTZ + 0.06]), Y, R_STD0 * 0.85, unit(b1 - b0), 0.042, turns=3)

# the pole ladder leaning on the second lift in the second bay
lf = np.array([3.55, 0.0, OUTZ + 1.35]); lt = np.array([3.62, LIFTS[1] + 1.05, OUTZ + 0.06])
ld, le1, _ = frame(lt - lf); side = unit(np.cross(ld, Z)) if abs(ld @ Z) < 0.99 else X
side = X
for s in (-1, 1):
    pole(lf + side * s * 0.22, lt + side * s * 0.22, 0.036, 0.031, sides=8, bow=0.008)
L = float(np.linalg.norm(lt - lf)); n = int((L - 0.4) / 0.3)
for k in range(1, n + 1):
    c = lf + (lt - lf) * (k * 0.3 / L)
    pole(c - side * 0.25, c + side * 0.25, 0.018, 0.018, sides=6, ease=0.004)
up = unit(lt - lf); nrm = unit(np.cross(side, up))
box_shape((lf + lt) / 2, side, up, nrm, [0.52, L, 0.08])
lashing(np.array([lt[0] - 0.22, LIFTS[1] + 0.0, LED_Z + 0.0]), unit(lt - lf), 0.034, X, R_LED, turns=3)

# ---------------------------------------------------------------- the rope picture (hemp, three-strand, weathered)
def rope_picture(w=256, h=512):
    yy, xx = np.mgrid[0:h, 0:w].astype(float)
    u = xx / w; v = yy / h
    # three strands laid at 30 degrees: u round the rope (0..0.75 of the picture), v along it
    lay = (u / 0.75 * 3 + v * 6) % 1.0
    crown = np.sin(lay * math.pi) ** 0.6
    fib = np.random.default_rng(7).normal(0, 1, (h, w))
    from PIL import ImageFilter
    f = np.array(Image.fromarray(((fib - fib.min()) / np.ptp(fib) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8)), float) / 255
    streak = np.array(Image.fromarray((np.random.default_rng(8).random((h // 8, w)) * 255).astype(np.uint8)).resize((w, h), Image.BILINEAR), float) / 255
    base = np.array([0.50, 0.43, 0.33]); grey = np.array([0.46, 0.44, 0.40])
    k = (0.45 + 0.55 * crown)[..., None] * (0.85 + 0.3 * (f - 0.5))[..., None]
    col = (base * 0.65 + grey * 0.35) * k * (0.92 + 0.16 * streak[..., None])
    hgt = 0.15 + 0.75 * crown + 0.1 * (f - 0.5)
    # the putlog holes' cell (u 0.8..1): the dark of a hole in old brick
    hole = u >= 0.8
    col[hole] = np.array([0.045, 0.035, 0.03]) * (0.8 + 0.4 * f[hole])[..., None]
    hgt[hole] = 0.2
    # (stored as drawn: weathered hemp reads mid grey-brown in the town's light, as the board wood does)
    Image.fromarray((np.clip(col, 0, 1) * 255).astype(np.uint8)).save(OUT / 'rope.png')
    Image.fromarray((np.clip(hgt, 0, 1) * 255).astype(np.uint8)).save(OUT / 'rope-height.png')

rope_picture()
data = {'surfaces': [{'name': 'wood', 'v': wood.v, 'n': wood.n, 'uv': wood.uv}, {'name': 'rope', 'v': rope.v, 'n': rope.n, 'uv': rope.uv}],
        'shapes': shapes, 'size': [STD[-1] + 0.7, TOP, OUTZ + 1.4]}
(OUT / 'scaffold.json').write_text(json.dumps(data))
print('scaffold: wood', len(wood.v) // 3, 'triangles, rope', len(rope.v) // 3, 'triangles,', len(shapes), 'shapes')
