"""Issue #163: rainwater drainage for the town's houses: half-round cast-iron gutters, downpipes, shoes, pavement
channels and street gullies joined to the Ruien inlets. Run with Blender, one city chunk at a time:
  blender -b -P scripts/repair-gutters.py -- <audit folder> <chunk, e.g. city_-1_2> <candidate folder> [house,house,...]
Input is the export of audit-gutters.gd (world space). Output is a review candidate in the wall-circuit format
(manifest-<chunk>.json + .bin rows, 16 floats per vertex) that NativeStoneCornersProof builds in memory and
gutters-promote saves; ruien-<chunk>.json (the new inlets) and report-<chunk>.json (every house: what it got, or why not).

Where the water goes, house by house (city_build.json, the plan the town was built from, measured against the real
meshes):
- a roof whose eave runs along a street or yard (ridge along the street, and the alley cottages): a gutter hung under
  the eave's edge, falling 1:250 to its outlet; a downpipe from the outlet with a swan neck back to the wall;
- a hipped or flat roof behind a cornice: the gutter hung on the cornice's front edge, the water running off the
  cornice top into it;
- a gable to the street: the valley between two gables drains through the wall at the gable's foot into a rainwater
  head on the front, one head and pipe for both houses; a gable house's side eave on a street gets its own gutter;
- at a pipe's foot on a raised pavement: an iron channel plate across the pavement to the kerb, a mouth in the kerb
  face and a grated gully in the street gutter; elsewhere a grated gully under the shoe. Every gully is a Ruien inlet.
- where the game's broken-gutter streams fall (alive_gutter_stains, Gutters.cs) the gutter has a broken gap, or a
  gable's outlet has a bare spout and no pipe, so the water falls where the stream is.
A pipe line must be clear wall from the eaves to the pavement: no window, door, sign, lamp or deep moulding in the
way (rays against every mesh near the chunk); else the next place along the wall is tried. The old flat stone gutter
boxes (in the hidden near-detail stone mesh) and their collision stand-ins are removed. The new iron goes into
the chunk's visible stone mesh as one surface on the iron material of the 2026-10-13 junction repair
(rain darkens and glosses it); its collision is a plain box per pipe run, gutter and foot. The rust, damp streaks and
damp streaks are triangles on the chunk's visible grime decal mesh. Each new vertex carries its house's colour alpha,
so a house razed later loses its drainage with it (NativeRazedHouses).
"""
import array, hashlib, json, math, pathlib, random, sys
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
audit_dir, chunk, out_dir = pathlib.Path(args[0]), args[1], pathlib.Path(args[2])
ONLY = {int(x) for x in args[3].split(',')} if len(args) > 3 and args[3] else None
out_dir.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parents[1]
PLAN = json.loads((ROOT / 'world/data/shared/city_build.json').read_text())
HOUSES = PLAN['houses']
CX, CZ = (int(v) for v in chunk.split('_')[1:3])
IRON = 'res://world/town/resources/r000615.res'
DECAL = 'res://world/town/resources/r000221.res'
UP = Vector((0, 1, 0))
rng = random.Random(int(hashlib.sha256(chunk.encode()).hexdigest()[:8], 16))
report = {'chunk': chunk, 'houses': [], 'notes': []}
KERB_H = 0.12

# ---------------------------------------------------------------- the town near the chunk
env = json.loads((audit_dir / 'env.json').read_text())
raw = array.array('f'); raw.frombytes((audit_dir / 'env.bin').read_bytes())
SKIP = ('_d_', 'halo', 'glow', 'window_light', 'alive_', 'lit_', 'cloud_sky', 'countryside')
verts, polys = [], []
for part in env['parts']:
    if any(k in part['node'] for k in SKIP) or all(m == DECAL for m in part['materials']): continue
    for i in range(part['start'], part['start'] + part['count'] - 2, 3):
        b = len(verts)
        for k in range(3): verts.append(Vector(raw[(i + k) * 3:(i + k) * 3 + 3]))
        polys.append((b, b + 1, b + 2))
TREE = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
del raw
print('env triangles', len(polys))

def ray(o, d, dist):
    """Distance to the first surface from o along d within dist, or None."""
    h = TREE.ray_cast(o, d, dist)
    return h[3] if h[0] is not None else None

def down(x, z, y0, depth=4.0):
    """Height of the first surface under (x, y0, z), or None."""
    h = ray(Vector((x, y0, z)), Vector((0, -1, 0)), depth)
    return None if h is None else y0 - h

# each house's own colour alpha (NativeRazedHouses cuts a razed house by it): the most common alpha on its walls
tags_raw = array.array('f')
if (audit_dir / 'facade.bin').exists(): tags_raw.frombytes((audit_dir / 'facade.bin').read_bytes())  # (a chunk with no walls has no houses)
TAGS = [(tags_raw[i], tags_raw[i + 1], tags_raw[i + 2], tags_raw[i + 3]) for i in range(0, len(tags_raw), 4)]
del tags_raw

def inside(poly, x, z):
    c = False
    for i in range(len(poly)):
        (x1, z1), (x2, z2) = poly[i], poly[i - 1]
        if (z1 > z) != (z2 > z) and x < (x2 - x1) * (z - z1) / (z2 - z1) + x1: c = not c
    return c

def house_alpha(h):
    from collections import Counter
    fp = h['fp']; xs = [p[0] for p in fp]; zs = [p[1] for p in fp]
    box = (min(xs) - 0.5, max(xs) + 0.5, min(zs) - 0.5, max(zs) + 0.5)
    votes = Counter()
    for x, y, z, a in TAGS:
        if box[0] < x < box[1] and box[2] < z < box[3] and y > 1.0:
            # a wall vertex on this house's outline (within 5 cm of an edge)
            for i in range(len(fp)):
                (ax, az), (bx, bz) = fp[i], fp[(i + 1) % len(fp)]
                L = math.hypot(bx - ax, bz - az) or 1
                t = ((x - ax) * (bx - ax) + (z - az) * (bz - az)) / (L * L)
                if -0.01 < t < 1.01 and abs((x - ax) * (bz - az) - (z - az) * (bx - ax)) / L < 0.05:
                    votes[round(a, 4)] += 1; break
    return votes.most_common(1)[0][0] if votes else None

# the broken-gutter streams: per stream two quads (12 vertices), the wall streak first
st = array.array('f'); st.frombytes((audit_dir / 'stains.bin').read_bytes()) if (audit_dir / 'stains.bin').exists() else None
STREAMS = []
for i in range(0, len(st) // 3 - 11, 12):
    pts = [Vector(st[(i + k) * 3:(i + k) * 3 + 3]) for k in range(12)]
    top = max(pts[:6], key=lambda p: p.y)
    tops = [p for p in pts[:6] if abs(p.y - top.y) < 1e-3]
    c = sum(tops, Vector()) / len(tops)
    STREAMS.append(Vector((c.x, top.y, c.z)))

# ---------------------------------------------------------------- the kit: rows for the game
class Out:
    """Triangles in the wall-circuit row format for one material."""
    def __init__(self): self.rows = []
    def tri(self, a, b, c, na, nb, nc, ua, ub, uc, col):
        n = (b - a).cross(c - a)
        if n.length < 1e-12: return
        rows = [[*a, *na, *ua, 0.0, 0.0, *col, 0.0, 0.0], [*b, *nb, *ub, 0.0, 0.0, *col, 0.0, 0.0], [*c, *nc, *uc, 0.0, 0.0, *col, 0.0, 0.0]]
        # Godot's front faces wind clockwise: (p2 - p0) x (p1 - p0) along the face normal
        if (c - a).cross(b - a).dot(na + nb + nc) < 0: rows[1], rows[2] = rows[2], rows[1]
        self.rows += rows

iron, decal = Out(), Out()
STAND = []  # collision stand-in triangles (world space)
CUR = {'col': (1, 1, 1, 1)}

def colour(k=1.0, rust=0.0, a=None):
    """The iron's tint: k its brightness, rust how far toward a rust brown; a the house's alpha."""
    base = CUR['tint']
    r = (base[0] * (1 + 0.55 * rust), base[1] * (1 + 0.12 * rust), base[2] * (1 - 0.25 * rust))
    return (r[0] * k, r[1] * k, r[2] * k, CUR['alpha'] if a is None else a)

def frames(path):
    """Rotation-minimising frames (tangent, u, v) along a polyline."""
    out = []
    t0 = (path[1] - path[0]).normalized()
    ref = UP if abs(t0.dot(UP)) < 0.9 else Vector((1, 0, 0))
    u = (ref - t0 * ref.dot(t0)).normalized()
    for i, p in enumerate(path):
        if i == 0: t = t0
        elif i == len(path) - 1: t = (path[-1] - path[-2]).normalized()
        else: t = ((path[i + 1] - path[i]).normalized() + (path[i] - path[i - 1]).normalized()).normalized()
        u = (u - t * u.dot(t)).normalized(); v = t.cross(u)
        out.append((t, u, v))
    return out

def sweep(profile, path, col, closed=True, uv_around=True, cap0=False, cap1=False, frame=None, scale_mitre=False, clip=None):
    """A profile [(x, y, nx, ny)] (in the frame's u, v; normals for smooth shading, a repeated point for a crease)
    run along a path. uv_around: u around the profile, v along the path (metres / 1.2), else swapped."""
    fr = frame or frames(path)
    profiles = profile if isinstance(profile[0], list) else [profile] * len(path)
    profile = profiles[0]
    rings = []
    along = 0.0
    for i, p in enumerate(path):
        t, u, v = fr[i]
        prof_i = profiles[i]
        k = 1.0
        if scale_mitre and 0 < i < len(path) - 1:
            a = (path[i] - path[i - 1]).normalized(); b = (path[i + 1] - path[i]).normalized()
            k = 1.0 / max(0.5, math.cos(a.angle(b) / 2))
        if i: along += (path[i] - path[i - 1]).length
        ring = []
        around = 0.0
        for j, (x, y, nx, ny) in enumerate(prof_i):
            if j: around += math.hypot(x - prof_i[j - 1][0], y - prof_i[j - 1][1])
            off = u * x + v * y
            if k != 1.0:
                # stretch across the mitre: the part of the offset in the bend's plane grows
                bis = (path[i + 1] - path[i]).normalized() - (path[i] - path[i - 1]).normalized()
                if bis.length > 1e-6:
                    bis.normalize(); off = off + bis * off.dot(bis) * (k - 1)
            q = p + off
            if clip and clip.get(i):
                # a mitred end: the ring slid along the path onto the mitre's plane
                cp, cn = clip[i]
                q = q - t * ((q - cp).dot(cn) / t.dot(cn))
            ring.append((q, (u * nx + v * ny).normalized(), (around / 1.2, along / 1.2) if uv_around else (along / 1.2, around / 1.2)))
        rings.append(ring)
    n = len(profile)
    for a, b in zip(rings, rings[1:]):
        for j in range(n if closed else n - 1):
            k = (j + 1) % n
            if (a[j][0] - a[k][0]).length < 1e-7 and (b[j][0] - b[k][0]).length < 1e-7: continue  # a crease point pair
            for tri in ((a[j], b[j], b[k]), (a[j], b[k], a[k])):
                iron_tri(tri, col)
    for cap, ring, sgn in ((cap0, rings[0], -1), (cap1, rings[-1], 1)):
        if not cap: continue
        t = fr[0][0] if sgn < 0 else fr[-1][0]
        c = sum((r[0] for r in ring), Vector()) / n
        nn = t * sgn
        for j in range(n):
            k = (j + 1) % n
            if (ring[j][0] - ring[k][0]).length < 1e-7: continue
            pts = [(c, nn, (0, 0)), (ring[j][0], nn, (0, 0)), (ring[k][0], nn, (0, 0))]
            iron_tri(planar_uv(pts, nn), col)
    return rings

def planar_uv(pts, n):
    """Metric UVs for a flat face: projected on the face's own plane."""
    a = Vector((n.z, 0, -n.x)) if abs(n.y) < 0.9 else Vector((1, 0, 0))
    a.normalize(); b = n.cross(a).normalized()
    return [(p, nn, (p.dot(a) / 1.2, p.dot(b) / 1.2)) for p, nn, _ in pts]

PARTS = {}
def iron_tri(tri, col):
    PARTS[CUR.get('part', 'other')] = PARTS.get(CUR.get('part', 'other'), 0) + 1
    (a, na, ua), (b, nb, ub), (c, nc, uc) = tri
    iron.tri(a, b, c, na, nb, nc, ua, ub, uc, col)

def hull(points, col, smooth=40.0):
    """A convex piece (a bracket's ear, a bobbin, a grate's bar): its hull, flat faces, the bevels' facets smooth."""
    bm = bmesh.new()
    for p in points: bm.verts.new(p)
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    bmesh.ops.dissolve_limit(bm, angle_limit=math.radians(1.0), verts=bm.verts[:], edges=bm.edges[:])
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.normal_update()
    lim = math.cos(math.radians(smooth))
    for f in bm.faces:
        pts = []
        for v in f.verts:
            acc = Vector()
            for g in v.link_faces:
                if g.normal.dot(f.normal) > lim: acc += g.normal * g.calc_area()
            nn = acc.normalized() if acc.length > 1e-12 else f.normal.copy()
            pts.append((v.co.copy(), nn, (0, 0)))
        iron_tri(planar_uv(pts, f.normal), col)
    bm.free()

def rbox(c, ax, size, r, seg=2):
    """Points of a box with rounded edges: centre, axes (3 unit vectors), full size, edge radius."""
    pts = []
    hs = [max(size[i] / 2 - r, 1e-4) for i in range(3)]
    for sx in (-1, 1):
        for sy in (-1, 1):
            for sz in (-1, 1):
                core = c + ax[0] * sx * hs[0] + ax[1] * sy * hs[1] + ax[2] * sz * hs[2]
                for i in range(seg + 1):
                    for j in range(seg + 1):
                        a, b = math.pi / 2 * i / seg, math.pi / 2 * j / seg
                        d = ax[0] * sx * math.cos(a) * math.cos(b) + ax[1] * sy * math.sin(a) + ax[2] * sz * math.cos(a) * math.sin(b)
                        pts.append(core + d * r)
    return pts

def lug_pts(c, ax, size, r):
    """A flat cast lug: its back flat on the spacer, the arris round its front face chamfered."""
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    pts = [c + ax[0] * x + ax[1] * y - ax[2] * hz for x in (-hx, hx) for y in (-hy, hy)]
    pts += [c + ax[0] * x + ax[1] * y + ax[2] * (hz - r) for x in (-hx, hx) for y in (-hy, hy)]
    pts += [c + ax[0] * x + ax[1] * y + ax[2] * hz for x in (-hx + r, hx - r) for y in (-hy + r, hy - r)]
    return pts

def top_chamfer_box(c, ax, size, r):
    """A bar: a box whose two long top arrises are chamfered."""
    hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
    pts = []
    for z in (-hz, hz):
        pts += [c + ax[0] * x + ax[1] * y + ax[2] * z for x, y in ((-hx, -hy), (hx, -hy), (hx, hy - r), (hx - r, hy), (-hx + r, hy), (-hx, hy - r))]
    return pts

def cyl_pts(c, axis, radius, length, sides=8, bevel=0.0):
    axis = axis.normalized(); ref = UP if abs(axis.dot(UP)) < 0.9 else Vector((1, 0, 0))
    u = (ref - axis * ref.dot(axis)).normalized(); v = axis.cross(u)
    pts = []
    rings_ = ((-length / 2, 0), (length / 2, 0)) if bevel <= 0 else ((-length / 2, bevel), (-length / 2 + bevel, 0), (length / 2 - bevel, 0), (length / 2, bevel))
    for e, inset in rings_:
        for k in range(sides):
            a = 2 * math.pi * k / sides
            pts.append(c + axis * e + (u * math.cos(a) + v * math.sin(a)) * (radius - inset))
    return pts

def stand_box(c, ax, size):
    """A collision stand-in box (12 triangles)."""
    h = [s / 2 for s in size]
    P = lambda i, j, k: c + ax[0] * h[0] * i + ax[1] * h[1] * j + ax[2] * h[2] * k
    q = [((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)), ((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1)),
         ((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)), ((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1)),
         ((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1)), ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1))]
    for f in q:
        a, b, cc, d = (P(*x) for x in f)
        STAND.extend([a, b, cc, a, cc, d])

# ---------------------------------------------------------------- decals (the town's grime decal cells)
RUST, SOOT, DAMP, BLOB = (0, 0), (1, 0), (2, 0), (0, 1)
# Dark tints: the town's grime decal shader is unshaded (its colour does not follow the light on the wall), so a stain
# lighter than a wall in shade would glow there. These stay darker than the wall in sun and in shade.
GRIME_TINT = {RUST: (0.022, 0.009, 0.004), DAMP: (0.006, 0.007, 0.005), BLOB: (0.004, 0.004, 0.003)}

def stain(p0, right, up, w, h, cell, alpha, normal):
    """A decal quad: p0 its top middle, right/up unit vectors in its plane, w x h; the cell's top at the top."""
    a = p0 - right * (w / 2); b = p0 + right * (w / 2); c = b - up * h; d = a - up * h
    t = GRIME_TINT[cell]
    alpha = CUR['alpha']  # the house's own alpha: its wear (how strong the town's grime shows) and its tag
    rows = []
    for p, uv in ((a, (0.01, 0.99)), (b, (0.99, 0.99)), (c, (0.99, 0.01)), (d, (0.01, 0.01))):
        rows.append([p.x, p.y, p.z, normal.x, normal.y, normal.z, uv[0], uv[1], float(cell[0]), float(cell[1]), *t, alpha, 1.002, 1.0])
    for i, j, k in ((0, 1, 2), (0, 2, 3)):
        tri = [rows[i], rows[j], rows[k]]
        pa, pb, pc = (Vector(r[:3]) for r in tri)
        if (pc - pa).cross(pb - pa).dot(normal) < 0: tri[1], tri[2] = tri[2], tri[1]
        decal.rows += tri
    report['decals'] = report.get('decals', 0) + 1

# ---------------------------------------------------------------- a wall's frame
class Wall:
    """s along the wall from a, y up, d out of it (the wall's face at d = 0)."""
    def __init__(self, a, b, out):
        self.a = Vector((a[0], 0, a[1])); bb = Vector((b[0], 0, b[1]))
        self.L = (bb - self.a).length; self.t = (bb - self.a) / self.L
        self.n = Vector((out[0], 0, out[1])).normalized()
    def P(self, s, y, d): return self.a + self.t * s + UP * y + self.n * d
    def local(self, p): q = p - self.a; return q.dot(self.t), p.y, q.dot(self.n)

def face_depth(w, s, y, reach=0.7):
    """How far the first thing in front of the wall stands out of it at (s, y): 0 on a plain wall, < 0 in an
    opening, > 0 on a moulding, sill or sign; None when nothing is there."""
    h = ray(w.P(s, y, reach), -w.n, reach + 0.6)
    return None if h is None else reach - h

def eave_profile(w, s, ytop, reach=0.9):
    """The eave's edge at s: the furthest d from the wall where the roof or cornice still stands near the eaves'
    height, its top there, whether that top is flat (a cornice) and the height under it."""
    last = None; prev = None
    # (from 4 cm inside the wall's line: an eave with no overhang ends exactly over the wall's face)
    for k in range(-4, int(reach * 100) + 1, 1):
        d = k / 100.0
        y = down(w.P(s, 0, d).x, w.P(s, 0, d).z, ytop + 2.5, 5.0)
        if y is None or y < ytop - 2.2: break
        if prev is not None and abs(y - prev) > 0.35: break
        last = (d, y); prev = y
    if last is None: return None
    d, y = last
    y2 = down(w.P(s, 0, d - 0.08).x, w.P(s, 0, d - 0.08).z, ytop + 2.5, 5.0)
    flat = y2 is not None and abs(y2 - y) < 0.02
    under = ray(w.P(s, y - 1.5, d - 0.01), UP, 1.6)
    yu = y - 1.5 + under if under is not None else y
    return {'d': d, 'y': y, 'flat': flat, 'under': min(yu, y)}

# ---------------------------------------------------------------- the pieces
GUT_T = 0.004  # cast iron, 4 mm

def gutter_profile(R):
    """The half-round gutter's section in (u = out from the wall, v = up), centred on its axis: the outer shell, a
    rolled bead on the front lip, the inner shell and a rounded back rim. Smooth round the shell, creased at the rims."""
    pr = []
    n = 10
    for k in range(n + 1):  # outer shell, back rim (angle 0) round under to the front lip
        a = math.pi * k / n
        pr.append((-math.cos(a) * R, -math.sin(a) * R, -math.cos(a), -math.sin(a)))
    rb = 0.0055  # the bead: a round over the front lip
    bc = (R - GUT_T / 2 + 0.0015, 0.0012)
    for k in range(4):
        a = -0.35 + (math.pi + 0.7) * k / 3
        pr.append((bc[0] + math.cos(a) * rb, bc[1] + math.sin(a) * rb, math.cos(a), math.sin(a)))
    ri = R - GUT_T
    for k in range(n, -1, -1):  # inner shell back from the lip
        a = math.pi * k / n
        pr.append((-math.cos(a) * ri, -math.sin(a) * ri, math.cos(a), math.sin(a)))
    pr.append((-R + GUT_T / 2, GUT_T * 0.6, 0, 1))  # the back rim, rounded over its thickness (closes the outline)
    return pr

def shell_section(R, grow, n=8):
    """A sleeve over the shell (a joint's socket): the outer half-round grown by `grow`, lapping over the bead.
    Open along its inside, which lies on the shell; its ends taper onto the shell (a profile with grow ~ 0)."""
    pr = []
    ro = R + grow
    for k in range(n + 1):
        a = math.pi * k / n
        pr.append((-math.cos(a) * ro, -math.sin(a) * ro, -math.cos(a), -math.sin(a)))
    pr.append((ro + 0.0035 - grow * 0.4, 0.0045, 0.5, 0.86))
    return pr

class Run:
    """A gutter along a wall: s0..s1, its axis at d = dc, the rim's top at y_rim at the high end."""
    def __init__(self, w, s0, s1, dc, y_rim, R, kind, edge):
        self.w, self.s0, self.s1, self.dc, self.y_rim, self.R, self.kind, self.edge = w, s0, s1, dc, y_rim, R, kind, edge
        self.outlets = []  # s of each outlet
        self.gaps = []     # s of each broken gap
        self.mitre = [None, None]  # (point, plane normal) where the start / end meets the next wall's gutter
        self.open = [False, False]  # an end that runs on into the neighbour's gutter (no stop end there)
        self.virtual = set()        # outlets that are the neighbour's: the fall runs there, no nozzle of its own
    def axis_y(self, s):
        """The axis' height at s: falling 1:250 toward the nearest outlet."""
        if not self.outlets: return self.y_rim
        far = max(min(abs(e - o) for o in self.outlets) for e in (self.s0, self.s1))
        near = min(abs(s - o) for o in self.outlets)
        return self.y_rim - (far - near) / 250.0

def build_run(run):
    """The gutter: shell pieces between joints, sockets, stop ends, hangers, outlets and broken gaps."""
    w, R = run.w, run.R
    prof = gutter_profile(R)
    # joint every 1.83 m (6 ft lengths) from the outlet; gaps cut pieces
    cuts = set()
    o = run.outlets[0] if run.outlets else run.s0
    k = o
    while k > run.s0 + 0.3: k -= 1.83; cuts.add(round(k, 3))
    k = o
    while k < run.s1 - 0.3: k += 1.83; cuts.add(round(k, 3))
    joints = sorted(c for c in cuts if run.s0 + 0.25 < c < run.s1 - 0.25)
    gaps = [(g - 0.16, g + 0.16) for g in run.gaps]
    pieces = [(run.s0, run.s1)]
    for g0, g1 in gaps:
        nxt = []
        for a, b in pieces:
            if g1 <= a or g0 >= b: nxt.append((a, b)); continue
            if g0 - a > 0.2: nxt.append((a, g0))
            if b - g1 > 0.2: nxt.append((g1, b))
        pieces = nxt
    P = lambda s: w.P(s, run.axis_y(s), run.dc)
    CUR['part'] = 'gutter'
    for a, b in pieces:
        stops = sorted({a, b, *[j for j in joints if a < j < b], *[x for x in run.outlets if a < x < b]})
        path = [P(s) for s in stops]
        fr = [(w.t, w.n, UP)] * len(path)
        clip = {}
        if a == run.s0 and run.mitre[0]: clip[0] = run.mitre[0]
        if b == run.s1 and run.mitre[1]: clip[len(path) - 1] = run.mitre[1]
        sweep(prof, path, colour(), closed=True, uv_around=False, frame=fr, clip=clip)
        # stop ends (not at a broken gap: there the shell just ends, cracked; not at a mitre)
        for s, sgn in ((a, -1), (b, 1)):
            if any(abs(s - g) < 0.2 for g in run.gaps): continue
            if (s == run.s0 and run.mitre[0]) or (s == run.s1 and run.mitre[1]): continue
            if (s == run.s0 and run.open[0]) or (s == run.s1 and run.open[1]): continue
            c = P(s) + w.t * sgn * 0.002
            pts = []
            for kk in range(9):
                ang = math.pi * kk / 8
                for e in (-0.003, 0.003):
                    pts.append(c + w.t * e + w.n * (-math.cos(ang) * (R + 0.002)) - UP * math.sin(ang) * (R + 0.002))
            pts += [c + w.t * e + w.n * x + UP * 0.003 for e in (-0.003, 0.003) for x in (-R - 0.002, R + 0.002)]
            CUR['part'] = 'stop end'; hull(pts, colour(0.95, 0.3)); CUR['part'] = 'gutter'
    # sockets at the joints, a little rustier (they leak)
    sock, flush = shell_section(R, 0.0045), shell_section(R, 0.0006); CUR['part'] = 'gutter socket'
    for j in joints:
        if any(abs(j - g) < 0.25 for g in run.gaps): continue
        path = [P(j - 0.035), P(j - 0.03), P(j + 0.03), P(j + 0.035)]
        sweep([flush, sock, sock, flush], path, colour(1.0, 0.55 + 0.3 * CUR['wear']), closed=False, uv_around=False, frame=[(w.t, w.n, UP)] * 4)
        # the joint's bolt under the shell
        hull(cyl_pts(w.P(j, run.axis_y(j) - R - 0.006, run.dc), UP, 0.006, 0.008, 6, 0.0015), colour(1.0, 0.6))
    # hangers about every metre: a strap round the shell, hooked over the bead, its tail fixed back on the eave
    k = run.s0 + 0.25
    while k < run.s1 - 0.2:
        if not any(abs(k - j) < 0.12 for j in joints) and not any(abs(k - x) < 0.15 for x in run.outlets):
            hanger(run, k)
        k += 1.0
    for x in run.outlets:
        if x in run.virtual: continue
        nozzle(run, x)
        if getattr(run, 'spout', None) == x: gutter_spout(run, x)
    # collision: the old gutter box's size, as before
    mid = (run.s0 + run.s1) / 2
    stand_box(w.P(mid, run.axis_y(mid) - R / 2, run.dc), (w.t, UP, w.n), (run.s1 - run.s0, R + 0.01, 2 * R))

def hanger(run, s):
    w, R = run.w, run.R; CUR['part'] = 'hanger'
    y = run.axis_y(s); rr = R + 0.0025
    path = []
    if run.kind == 'wall':
        # a bracket spiked into the wall's joint under the eave
        e = run.edge
        path += [w.P(s, y + 0.004, e['d'] - 0.03), w.P(s, y + 0.004, run.dc - rr)]
    elif run.kind == 'cornice':
        # the tail lies on the cornice's top, a spike at its end
        e = run.edge
        path += [w.P(s, e['y'] + 0.0025, e['d'] - 0.12), w.P(s, e['y'] + 0.0025, e['d'] + 0.002), w.P(s, y + 0.004, run.dc - rr)]
        hull(cyl_pts(w.P(s, e['y'] + 0.008, e['d'] - 0.115), UP, 0.006, 0.012, 6, 0.002), colour(1.0, 0.4))
    else:
        # the tail runs up under the eave's edge and back along it, nailed out of sight
        yu = run.edge['under']
        path += [w.P(s, yu - 0.004, run.dc - R - 0.07), w.P(s, yu - 0.004, run.dc - rr), w.P(s, y + 0.004, run.dc - rr)]
    for kk in range(1, 6):
        a = math.pi * kk / 5
        path.append(w.P(s, y - math.sin(a) * rr, run.dc - math.cos(a) * rr))
    path.append(w.P(s, y + 0.006, run.dc + R + 0.004)); path.append(w.P(s, y + 0.004, run.dc + R - 0.006))
    # a strap 22 mm wide, 4 mm thick: flat faces, its narrow edges shaded round (a rolled sheet edge)
    W2, T2, r2 = 0.011, 0.002, 0.7071
    prof = [(-W2, -T2, 0, -1), (W2, -T2, 0, -1), (W2, -T2, r2, -r2), (W2, T2, r2, r2), (W2, T2, 0, 1), (-W2, T2, 0, 1), (-W2, T2, -r2, r2), (-W2, -T2, -r2, -r2)]
    fr = []
    for i in range(len(path)):
        t = ((path[min(i + 1, len(path) - 1)] - path[max(i - 1, 0)])).normalized()
        fr.append((t, w.t, t.cross(w.t).normalized()))
    sweep(prof, path, colour(1.0, 0.45), closed=True, uv_around=True, frame=fr, cap0=True, cap1=True)

def crease(prof):
    """A polygon profile with flat sides: each side's two points carry that side's normal."""
    pts = [(x, y) for x, y, _, _ in prof[::2]]
    out = []
    n = len(pts)
    for i in range(n):
        a, b = pts[i], pts[(i + 1) % n]
        nx, ny = b[1] - a[1], -(b[0] - a[0])
        L = math.hypot(nx, ny) or 1
        out += [(a[0], a[1], nx / L, ny / L), (b[0], b[1], nx / L, ny / L)]
    # winding: outward normals for a counter-clockwise outline
    area = sum(pts[i][0] * pts[(i + 1) % n][1] - pts[(i + 1) % n][0] * pts[i][1] for i in range(n))
    if area < 0: out = [(x, y, -nx, -ny) for x, y, nx, ny in out]
    return out

PIPE_R, PIPE_T = 0.0375, 0.004

def ring_profile(r, sides=10):
    return [(math.cos(2 * math.pi * k / sides) * r, math.sin(2 * math.pi * k / sides) * r, math.cos(2 * math.pi * k / sides), math.sin(2 * math.pi * k / sides)) for k in range(sides)]

def nozzle(run, s):
    """The outlet: a short drop tube from the gutter's bottom, the dark hole seen from above."""
    w = run.w; y = run.axis_y(s); CUR['part'] = 'outlet'
    top, bot = w.P(s, y - run.R + 0.01, run.dc), w.P(s, y - run.R - 0.07, run.dc)
    sweep(ring_profile(PIPE_R + 0.005), [top, bot], colour(1.0, 0.5), frame=[(-UP, w.t, w.n)] * 2)
    # the hole in the shell: a dark disc just over the inner bottom
    c = w.P(s, y - run.R + GUT_T + 0.0015, run.dc)
    for k in range(10):
        a0, a1 = 2 * math.pi * k / 10, 2 * math.pi * (k + 1) / 10
        p0 = c + (w.t * math.cos(a0) + w.n * math.sin(a0)) * (PIPE_R - 0.004)
        p1 = c + (w.t * math.cos(a1) + w.n * math.sin(a1)) * (PIPE_R - 0.004)
        iron_tri([(c, UP, (0, 0)), (p0, UP, (0, 0)), (p1, UP, (0, 0))], colour(0.08))

def gutter_spout(run, s):
    """A short cast spout from the outlet, bent out and down, its mouth open: the water falls clear to the street."""
    w = run.w; y = run.axis_y(s) - run.R - 0.07
    pts = [w.P(s, y + 0.01, run.dc), w.P(s, y - 0.06, run.dc), w.P(s, y - 0.2, run.dc + 0.28)]
    CUR['part'] = 'spout'
    pipe(w, pts, [], [], 0.0)

def bend_path(points, radius=0.09, steps=3):
    """A polyline with its corners rounded (a cast bend), as a dense path."""
    out = [points[0]]
    for i in range(1, len(points) - 1):
        a, p, b = points[i - 1], points[i], points[i + 1]
        da, db = (p - a).normalized(), (b - p).normalized()
        ang = da.angle(db)
        if ang < 1e-3: out.append(p); continue
        trim = min(radius * math.tan(ang / 2), (p - a).length * 0.45, (b - p).length * 0.45)
        p0, p1 = p - da * trim, p + db * trim
        for k in range(steps + 1):
            t = k / steps
            out.append(p0 * (1 - t) * (1 - t) + p * 2 * t * (1 - t) + p1 * t * t)
    out.append(points[-1])
    return out

def pipe(w, pts, sockets, ears, base, mouth=True):
    """The downpipe along pts (from the top down): an open hollow mouth at the foot, sockets with ears every
    1.5-2 m nailed to the wall on bobbins."""
    path = bend_path(pts)
    CUR['part'] = 'pipe'
    sweep(ring_profile(PIPE_R), path, colour())
    if mouth:
        # the mouth: the bore's dark inside 12 cm up, and the rim
        a, b = path[-1], path[-2]
        t = (a - b).normalized()
        inner = [a - t * 0.12, a]
        sweep([(x, y, -nx, -ny) for x, y, nx, ny in ring_profile(PIPE_R - PIPE_T)], inner, colour(0.14))
        ring_a = [a + q for q in ring_offsets(t, PIPE_R)]; ring_b = [a + q for q in ring_offsets(t, PIPE_R - PIPE_T)]
        for k in range(10):
            j = (k + 1) % 10
            iron_tri([(ring_a[k], t, (0, 0)), (ring_b[k], t, (0, 0)), (ring_b[j], t, (0, 0))], colour(0.8))
            iron_tri([(ring_a[k], t, (0, 0)), (ring_b[j], t, (0, 0)), (ring_a[j], t, (0, 0))], colour(0.8))
    CUR['part'] = 'pipe socket'
    for p, t in sockets:
        hull(socket_pts(p, t), colour(1.0, 0.35 + 0.4 * CUR['wear']), smooth=50)
    CUR['part'] = 'ears'
    for p, d_axis in ears:
        # two lugs cast on the socket's back, a bobbin behind each to the wall, a nail head on each
        for sgn in (-1, 1):
            c = p + w.t * sgn * (PIPE_R + 0.022) - w.n * (PIPE_R * 0.55)
            wall = c - w.n * (w.local(c)[2] - base)
            # the lug (4.4 x 5 cm, 8 mm, its arrises rounded 2 mm) and the spacer behind it down to the wall
            hull(lug_pts(c, (w.t, UP, w.n), (0.044, 0.05, 0.008), 0.002) + [wall + w.t * x + UP * y for x in (-0.011, 0.011) for y in (-0.011, 0.011)], colour(1.0, 0.45))

def socket_pts(p, t, sides=10):
    """A pipe socket: 75 mm long, 7 mm proud, its top arris chamfered 3 mm; the bottom sits on the pipe."""
    pts = []
    for e, r in ((0.0, PIPE_R + 0.007), (0.072, PIPE_R + 0.007), (0.075, PIPE_R + 0.004)):
        pts += [p + t * e + q for q in ring_offsets(t, r, sides)]
    return pts

def ring_offsets(t, r, sides=10):
    ref = UP if abs(t.dot(UP)) < 0.9 else Vector((1, 0, 0))
    u = (ref - t * ref.dot(t)).normalized(); v = t.cross(u)
    return [(u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides)) * r for k in range(sides)]

def head(w, s, y_top, d_axis):
    """A rainwater head: a box flared at the top with a moulded rim, open (dark) on top, the pipe's socket under it."""
    yb = y_top - 0.24; CUR['part'] = 'head'
    hull(rbox(w.P(s, y_top - 0.11, d_axis), (w.t, UP, w.n), (0.26, 0.2, 0.17), 0.006, 2) + rbox(w.P(s, yb + 0.04, d_axis), (w.t, UP, w.n), (0.11, 0.04, 0.1), 0.006, 1), colour(1.0, 0.3))
    hull(rbox(w.P(s, y_top - 0.012, d_axis), (w.t, UP, w.n), (0.30, 0.024, 0.21), 0.005, 2), colour(1.0, 0.4))
    # the dark inside, a shade under the rim
    c = w.P(s, y_top + 0.0005, d_axis)
    q = [c + w.t * x + w.n * z for x, z in ((-0.125, -0.085), (0.125, -0.085), (0.125, 0.085), (-0.125, 0.085))]
    iron_tri([(q[0], UP, (0, 0)), (q[1], UP, (0, 0)), (q[2], UP, (0, 0))], colour(0.06))
    iron_tri([(q[0], UP, (0, 0)), (q[2], UP, (0, 0)), (q[3], UP, (0, 0))], colour(0.06))
    stand_box(w.P(s, y_top - 0.12, d_axis), (w.t, UP, w.n), (0.3, 0.24, 0.21))
    return yb

def gully(c, ax_s, ax_d, label, ground):
    """A grated gully on the ground (a Ruien inlet): a frame, bars along the flow, the dark sump under them."""
    up = UP; CUR['part'] = 'gully'
    for sg in (-1, 1):
        hull(top_chamfer_box(c + ax_s * sg * 0.14 + up * 0.005, (ax_s, up, ax_d), (0.028, 0.014, 0.30), 0.003), colour(1.0, 0.5))
        hull(top_chamfer_box(c + ax_d * sg * 0.135 + up * 0.005, (ax_d, up, ax_s), (0.026, 0.014, 0.30), 0.003), colour(1.0, 0.5))
    for k in range(6):
        x = -0.1 + k * 0.04
        hull(top_chamfer_box(c + ax_s * x + up * 0.006, (ax_s, up, ax_d), (0.014, 0.012, 0.25), 0.003), colour(1.08, 0.35))
    q = [c + ax_s * x + ax_d * z + up * 0.0015 for x, z in ((-0.13, -0.125), (0.13, -0.125), (0.13, 0.125), (-0.13, 0.125))]
    iron_tri([(q[0], up, (0, 0)), (q[1], up, (0, 0)), (q[2], up, (0, 0))], colour(0.05))
    iron_tri([(q[0], up, (0, 0)), (q[2], up, (0, 0)), (q[3], up, (0, 0))], colour(0.05))
    INLETS.append({'id': label, 'world': [c.x, c.y, c.z], 'undergroundConnection': [c.x, c.y - 0.55, c.z], 'diameterMetres': 0.15,
                   'network': 'Ruien', 'status': 'inlet modelled; underground connection reserved'})

INLETS = []
STREET_GULLIES = []  # (centre, kerb's outward normal or None) of every street gully built, and the inlets there already
# drainage already built by the 2026-10-13 junction repair (art-source/environment-20261013/junction): its house-east
# gutter (x 200.46, z 4..44, y 10.14 falling to 10.11) and downpipe at z 43.74; that eave is not done again
EXISTING_GUTTERS = [(Vector((200.46, 10.14, 4.0)), Vector((200.46, 10.11, 44.0)), 'the 2026-10-13 junction repair')]
EXISTING_PIPES = [Vector((200.17, 0, 43.74))]
for e in json.loads((ROOT / 'world/town/drainage/ruien-inlets.json').read_text()):
    STREET_GULLIES.append((Vector(e['world']), None))

def channel(w, s, y0, dk, yg, label):
    """A covered channel across the pavement (a cast-iron plate, ribbed, slightly proud), a receiver at the wall under
    the shoe, a mouth in the kerb's face and a gully in the street gutter beyond it."""
    L = dk - 0.03; CUR['part'] = 'channel'
    c = w.P(s, y0 + 0.004, 0.03 + L / 2)
    hull(rbox(c, (w.t, UP, w.n), (0.19, 0.014, L), 0.0035, 1), colour(1.12, 0.25))
    # cast ribs across the plate (a foot's grip), about every 25 cm
    nr = max(2, int(L / 0.25))
    for k in range(nr):
        hull(top_chamfer_box(w.P(s, y0 + 0.0115, 0.03 + L * (k + 0.5) / nr), (w.n, UP, w.t), (0.012, 0.004, 0.15), 0.0015), colour(1.2, 0.1))
    # the receiver under the shoe: a low box, a grated opening on top
    r = w.P(s, y0 + 0.03, 0.12)
    hull(rbox(r, (w.t, UP, w.n), (0.22, 0.06, 0.2), 0.004, 1), colour(1.0, 0.45))
    q = [w.P(s + x, y0 + 0.0605, 0.12 + z) for x, z in ((-0.08, -0.07), (0.08, -0.07), (0.08, 0.07), (-0.08, 0.07))]
    iron_tri([(q[0], UP, (0, 0)), (q[1], UP, (0, 0)), (q[2], UP, (0, 0))], colour(0.05))
    iron_tri([(q[0], UP, (0, 0)), (q[2], UP, (0, 0)), (q[3], UP, (0, 0))], colour(0.05))
    for x in (-0.03, 0.03):
        hull(rbox(w.P(s + x, y0 + 0.062, 0.12), (w.t, UP, w.n), (0.012, 0.006, 0.15), 0.002, 1), colour(1.05, 0.3))
    # the mouth in the kerb's face
    face = w.P(s, (y0 + yg) / 2, dk + 0.004)
    hull(rbox(face, (w.t, UP, w.n), (0.2, max(0.05, y0 - yg - 0.01), 0.008), 0.002, 1), colour(1.0, 0.5))
    m = [w.P(s + x, yy, dk + 0.0085) for x, yy in ((-0.06, yg + 0.025), (0.06, yg + 0.025), (0.06, yg + 0.06), (-0.06, yg + 0.06))]
    for tri in ((0, 1, 2), (0, 2, 3)):
        iron_tri([(m[i], w.n, (0, 0)) for i in tri], colour(0.05))
    stand_box(r, (w.t, UP, w.n), (0.22, 0.06, 0.2))
    g = w.P(s, yg, dk + 0.17)
    near = [q for q, n in STREET_GULLIES if (n is None or (n.dot(w.n) > 0.95 and abs((q - g).dot(w.n)) < 0.4)) and (q - g).length < 10.0]
    if near: return 'channel to the street gutter (a gully %.1f m along it)' % min((q - g).length for q in near)
    gully(g, w.t, w.n, label, yg)
    STREET_GULLIES.append((g.copy(), w.n.copy()))
    return 'channel to a street gully'

# ---------------------------------------------------------------- pipe lines
PIPES = [(Vector((1, 0, 0)), q) for q in EXISTING_PIPES]  # (wall normal, foot) of every pipe: the next keeps its distance

def clear_line(w, s, y_foot, y_top):
    """Can a pipe run up the wall at s? (standoff of its axis, or None) Rays at the pipe's middle and both its
    sides every 4 cm: no opening, no thing standing out more than 6 cm (bands and sills under that it clears)."""
    base = face_depth(w, s, (y_foot + y_top) / 2)
    if base is None: return None
    worst = 0.0
    y = y_foot
    while y < y_top:
        for ds in (-0.055, 0.0, 0.055):
            d = face_depth(w, s + ds, y)
            if d is None: return None
            d -= base
            if d < -0.03: return None   # an opening, a passage, a recess
            worst = max(worst, d)
        y += 0.04
    if worst > 0.06: return None
    d_axis = base + max(0.072, worst + PIPE_R + 0.012)
    span = y_top - y_foot
    for ds, dd in ((-0.045, 0.0), (0.045, 0.0), (0.0, -0.045), (0.0, 0.045), (0.0, 0.0)):
        if ray(w.P(s + ds, y_top, d_axis + dd), -UP, span) is not None: return None
    y = y_foot
    while y < y_top:
        for dd in (-0.03, 0.0, 0.03):
            if ray(w.P(s - 0.09, y, d_axis + dd), w.t, 0.18) is not None: return None
        y += 0.06
    return d_axis, base

def far_from_pipes(w, s):
    p = w.P(s, 0, 0)
    gap = CUR.get('pipe_gap', 0.9)
    # (any wall: two pipes either side of a corner look as doubled as two on one wall)
    return all((Vector((p.x, 0, p.z)) - q).length > (gap if n.dot(w.n) > 0.9 else 0.9) for n, q in PIPES)

def foot_kind(w, s, d_axis):
    """What the pipe's foot stands on: ('channel', pavement y, kerb d, street-gutter y), ('gully', ground y) or
    ('bare', ground y)."""
    ys = []
    for k in range(3, 161, 2):
        d = k / 100.0
        p = w.P(s, 0, d)
        y = down(p.x, p.z, 1.6, 3.0)
        ys.append((d, y))
    if ys[0][1] is None: return None
    y0 = ys[0][1]
    for d, y in ys:
        if y is None: return ('bare', y0)
        if y > y0 + 0.04: return ('bare', y0)  # something stands on the pavement in the way
        if y < y0 - 0.06:
            if 0.3 < d < 1.3:
                yg = down(w.P(s, 0, d + 0.15).x, w.P(s, 0, d + 0.15).z, 1.6, 3.0)
                if yg is not None and y0 - 0.25 < yg < y0 - 0.05:
                    # the plate's line must be free across its width too
                    for ds in (-0.1, 0.1):
                        for dd in (0.1, d * 0.5, d - 0.05):
                            q = w.P(s + ds, 0, dd); yy = down(q.x, q.z, 1.6, 3.0)
                            if yy is None or abs(yy - y0) > 0.03: return ('bare', y0)
                    return ('channel', y0, d - 0.01, yg)
            return ('bare', y0)
    # flat ground all the way: a gully under the shoe, if the ground round it is level
    for ds in (-0.18, 0.18):
        for dd in (0.05, 0.4):
            q = w.P(s + ds, 0, d_axis + dd); yy = down(q.x, q.z, 1.6, 3.0)
            if yy is None or abs(yy - y0) > 0.025: return ('bare', y0)
    return ('gully', y0)

def downpipe(w, s, y_from, d_from, label, need_neck=True, d_min=None):
    """Find and build the pipe from an outlet at (s, y_from, d_from) down the wall. Returns a description or None."""
    p = w.P(s, 0, 0.1)
    yg0 = down(p.x, p.z, 1.6, 3.0)
    if yg0 is None: return None
    top = y_from - (0.62 if need_neck else 0.05)
    cl = clear_line(w, s, yg0 + 0.12, top)
    if cl is None or not far_from_pipes(w, s): return None
    d_axis, base = cl
    if d_min is not None: d_axis = max(d_axis, d_min)
    fk = foot_kind(w, s, d_axis)
    if fk is None: return None
    y0 = fk[1]
    pts = []
    if need_neck:
        # the swan neck: down from the outlet, a cast offset back toward the wall, down; lowered past anything in its way
        drop = 0.06
        while drop < 0.6:
            a = w.P(s, y_from, d_from); b = w.P(s, y_from - drop, d_from)
            run_ = d_from - d_axis
            c = w.P(s, y_from - drop - run_ * 1.1, d_axis)
            ok = True
            for q0, q1 in ((a, b), (b, c)):
                seg = q1 - q0
                for off in ring_offsets(seg.normalized(), PIPE_R + 0.01, 6):
                    if ray(q0 + off, seg.normalized(), seg.length) is not None: ok = False; break
                if not ok: break
            if ok: break
            drop += 0.08
        if drop >= 0.6: return None
        pts = [a, b, c]
        y_vert = c.y
    else:
        pts = [w.P(s, y_from, d_axis)]
        y_vert = y_from
    kind = fk[0]
    if kind == 'channel':
        pts += [w.P(s, y0 + 0.24, d_axis), w.P(s, y0 + 0.11, d_axis + 0.05), w.P(s, y0 + 0.085, 0.12)]
    elif kind == 'gully':
        pts += [w.P(s, y0 + 0.26, d_axis), w.P(s, y0 + 0.12, d_axis + 0.06), w.P(s, y0 + 0.07, d_axis + 0.14)]
    else:
        pts += [w.P(s, y0 + 0.24, d_axis), w.P(s, y0 + 0.11, d_axis + 0.06), w.P(s, y0 + 0.06, d_axis + 0.16)]
    # sockets every 1.5-2 m on the straight drop, ears on them
    straight_top, straight_bot = y_vert - 0.05, y0 + 0.34
    n = max(1, math.ceil((straight_top - straight_bot) / 1.83))
    step = (straight_top - straight_bot) / n
    sockets, ears = [], []
    for i in range(n + 1):
        y = straight_top - i * step
        q = w.P(s, y - 0.075, d_axis)
        sockets.append((q, UP)); ears.append((w.P(s, y - 0.03, d_axis), d_axis))
        # rust from the ears' nails down the wall, more on a worn house
        for sg in (-1, 1):
            stain(w.P(s + sg * (PIPE_R + 0.022), y - 0.04, base + 0.006), w.t, UP, 0.07, 0.42 + 0.25 * CUR['wear'], RUST, 0, w.n)
    if need_neck: sockets.append((pts[2] - (pts[2] - pts[1]).normalized() * 0.02, (pts[1] - pts[2]).normalized()))
    pipe(w, pts, sockets, ears, base)
    # damp down the wall behind the pipe from the neck's joint, and splash at its foot
    stain(w.P(s, y_vert, base + 0.006), w.t, UP, 0.34, min(2.4, y_vert - y0 - 0.3), DAMP, 0, w.n)
    stain(w.P(s, y0 + 0.9, base + 0.006), w.t, UP, 0.55, 0.9, DAMP, 0, w.n)
    # collision: the pipe as a square column, the shoe as a box
    stand_box(w.P(s, (y_vert + y0 + 0.2) / 2, d_axis), (w.t, UP, w.n), (2 * PIPE_R + 0.01, y_vert - y0 - 0.2, 2 * PIPE_R + 0.01))
    if kind == 'channel': kind = channel(w, s, y0, fk[2], fk[3], label)
    elif kind == 'gully': gully(w.P(s, y0, d_axis + 0.14), w.t, w.n, label, y0)
    PIPES.append((w.n.copy(), Vector((w.P(s, 0, 0).x, 0, w.P(s, 0, 0).z))))
    f = w.P(s, y0, d_axis)
    return {'s': round(s, 2), 'standoff': round(d_axis - base, 3), 'foot': kind.split(' ')[0], 'footDetail': kind, 'top': round(y_from, 2),
            'at': [round(f.x, 3), round(f.y, 3), round(f.z, 3)], 'out': [round(w.n.x, 4), round(w.n.z, 4)], 'along': [round(w.t.x, 4), round(w.t.z, 4)]}

def run_on(run):
    """A gutter whose end meets a neighbour's on the same eave line, at the same height, with the neighbour's outlet near
    that end, runs on into it: one gutter, one pipe. Returns a description or None."""
    w = run.w
    for q in MITRES:
        if q is run or q.R != run.R or q.w.n.dot(w.n) < 0.99 or abs((q.w.a - w.a).dot(w.n)) > 0.05 or abs(q.dc - run.dc) > 0.04: continue
        if not q.outlets or any(x in q.virtual for x in q.outlets): continue
        for e, se in ((0, run.s0), (1, run.s1)):
            p = w.P(se, 0, 0)
            for qe, qs in ((0, q.s0), (1, q.s1)):
                if q.open[qe] or (p - q.w.P(qs, 0, 0)).length > 0.3: continue
                if min(abs(qs - o) for o in q.outlets) > 1.2: continue
                yq = q.axis_y(qs)
                run.outlets = [se]; run.virtual = {se}
                far = run.s1 - run.s0
                y_rim = yq + far / 250.0
                if y_rim > run.y_rim + 0.005 or y_rim < run.y_rim - 0.06: run.outlets = []; run.virtual = set(); continue
                # the two gutters meet end to end (a row's walls may stop a little short of each other)
                sq = (q.w.P(qs, 0, 0) - w.a).dot(w.t)
                if e == 0: run.s0 = sq
                else: run.s1 = sq
                run.outlets = [sq]; run.virtual = {sq}
                run.y_rim = y_rim; run.open[e] = True; q.open[qe] = True
                return {'s': round(se, 2), 'foot': 'joined', 'note': 'runs on into the neighbour\'s gutter and its pipe'}
    return None

def gable_neighbour(p):
    """Is there a gable-to-the-street house whose front wall ends at this point (its valley drains there)?"""
    for h in HOUSES:
        if h.get('gone') or not h.get('rect') or h['roof'] != 'front' or 'o' not in h or not h['street'][0]: continue
        (ox, oz), (ux, uz), (nx, nz) = h['o'], h['u'], h['n']; t0 = h['t'][0]
        for se in h['s']:
            if math.hypot(ox + ux * se + nx * t0 - p.x, oz + uz * se + nz * t0 - p.z) < 0.3: return True
    return False

def place_pipe(w, run, prefer, label):
    """Try pipe lines along the wall from the preferred end inward; the outlet goes over the first clear one."""
    g0, g1 = gable_neighbour(w.P(0, 0, 0)), gable_neighbour(w.P(w.L, 0, 0))
    if g1 and not g0: prefer = -1
    elif g0 and not g1: prefer = 1
    # not beside a pipe already there (a neighbour's at the party line): the other end first
    gap_ = CUR.get('pipe_gap', 0.9); CUR['pipe_gap'] = 0.9
    near0, near1 = not far_from_pipes(w, run.s0 + 0.22), not far_from_pipes(w, run.s1 - 0.22)
    CUR['pipe_gap'] = gap_
    if near1 and not near0: prefer = -1
    elif near0 and not near1: prefer = 1
    # (1 m clear of a gable neighbour's party line: its valley's head and pipe go there)
    jn = getattr(run, 'joined', (False, False))
    m0, m1 = (1.0 if g0 or jn[0] else 0.22), (1.0 if g1 or jn[1] else 0.22)
    order = []
    span = run.s1 - run.s0
    for k in range(0, int(max(span - 0.4, 0.05) / 0.05)):
        order.append(run.s1 - m1 - k * 0.05 if prefer > 0 else run.s0 + m0 + k * 0.05)
    for k in range(0, int(max(span - 0.4, 0.05) / 0.05)):
        order.append(run.s0 + m0 + k * 0.05 if prefer > 0 else run.s1 - m1 - k * 0.05)
    order = [x for x in order if run.s0 + 0.2 < x < run.s1 - 0.2]
    for s in order:
        if any(abs(s - g) < 0.6 for g in run.gaps): continue
        run.outlets = [s]
        y_out = run.axis_y(s) - run.R - 0.07
        got = downpipe(w, s, y_out, run.dc, label)
        if got: return got
    run.outlets = []
    return None

# ---------------------------------------------------------------- house by house
def chunk_of(h):
    fp = h['fp']; cx = sum(p[0] for p in fp) / len(fp); cz = sum(p[1] for p in fp) / len(fp)
    return (math.floor(cx / 100.0), math.floor(cz / 100.0))

def streams_on(w, s0, s1, y, reach):
    """The broken-gutter streams that fall from this eave: their s."""
    out = []
    for p in STREAMS:
        s, _, d = w.local(p)
        if s0 - 0.2 < s < s1 + 0.2 and abs(d - reach) < 0.5 and abs(p.y - y) < 1.0: out.append(s)
    return out

def eave_run(w, s0, s1, H, R, label, prefer=1, gutter_kind=None, joined=(False, False), pipe=True):
    """Gutters under a measured eave from s0 to s1, each with its pipe: [(run, description)], or [(None, reason)].
    The eave is measured every 1.5 m and taken at its lowest (a hoist loft or dormer at the eave line is not the eave);
    where something stands on the gutter's line (a loft, a dormer cheek, a taller neighbour's wall) the gutter stops,
    and each free stretch is its own gutter."""
    samples = []
    n_ = max(3, int((s1 - s0) / 1.5))
    for k in range(n_):
        e = eave_profile(w, s0 + (s1 - s0) * (k + 0.5) / n_, H)
        if e and -0.05 < e['d'] < 0.85 and e['y'] > 2.5: samples.append(e)
    if not samples: return [(None, 'no eave found')]
    e = min(samples, key=lambda e: (round(e['y'], 1), e['d']))
    if e['d'] < 0.05:
        kind = 'wall'; dc = e['d'] + 0.012 + R; y_rim = e['y'] - 0.015
    elif e['flat']:
        kind = 'cornice'; dc = e['d'] + 0.004 + R; y_rim = e['y'] - 0.012
    else:
        kind = 'eave'; dc = e['d'] + R / 3; y_rim = min(e['under'], e['y']) - 0.018
    # an eave another repair has already drained
    for a_, b_, who in EXISTING_GUTTERS:
        mid = w.P((s0 + s1) / 2, y_rim, dc); ax_ = (b_ - a_); t_ = max(0.0, min(1.0, (mid - a_).dot(ax_) / ax_.length_squared))
        q_ = a_ + ax_ * t_
        if Vector((mid.x - q_.x, 0, mid.z - q_.z)).length < 0.3 and abs(mid.y - q_.y) < 0.6: return [(None, 'drained already by ' + who)]
    # the free stretches of the gutter's line: short rays along it at its section's back, bottom, front and rim
    step = 0.1
    free = []
    k = s0 + 0.012
    while k < s1 - 0.012 - 1e-6:
        L_ = min(step, s1 - 0.012 - k)
        blocked = False
        for dd, yy in ((-R * 0.85, -0.01), (0.0, -R * 0.9), (R * 0.85, -0.01), (0.0, -0.005)):
            if ray(w.P(k, y_rim + yy, dc + dd), w.t, L_) is not None: blocked = True; break
        free.append((k, k + L_, blocked))
        k += L_
    spans = []
    for a_, b_, bl in free:
        if bl: spans.append(None); continue
        if spans and spans[-1] is not None and abs(spans[-1][1] - a_) < 1e-6: spans[-1] = (spans[-1][0], b_)
        else: spans.append((a_, b_))
    spans = [sp for sp in spans if sp is not None and sp[1] - sp[0] >= (1.0 if pipe else 0.5)]
    if not spans: return [(None, 'gutter line blocked')]
    out = []
    for si, (a_, b_) in enumerate(spans):
        run = Run(w, a_, b_, dc, y_rim, R, kind, e)
        if len(spans) > 1:
            # (a gutter cut short by something on the line ends 1 cm off it)
            if si > 0: run.s0 += 0.01
            if si < len(spans) - 1: run.s1 -= 0.01
        run.gaps = [g for g in streams_on(w, run.s0, run.s1, y_rim, dc) if run.s0 + 0.3 < g < run.s1 - 0.3]
        run.joined = (joined[0] and abs(a_ - (s0 + 0.012)) < 0.05, joined[1] and abs(b_ - (s1 - 0.012)) < 0.05)
        run.cur = {k_: CUR[k_] for k_ in ('tint', 'alpha', 'wear')}
        MITRES.append(run)
        lab = label if len(spans) == 1 else f'{label}-{si}'
        got = None
        if pipe or b_ - a_ >= 2.0:
            got = run_on(run)
            if not got: got = place_pipe(w, run, prefer, lab)
            if not got:
                se = run.s1 - 0.2 if prefer > 0 else run.s0 + 0.2
                run.outlets = [se]; run.spout = se
                got = {'s': round(se, 2), 'foot': 'spout', 'note': 'no clear wall for a pipe: a spout throws the water clear'}
        else: got = {'joined': 'drains into the next gutter at the corner'}
        RUNS_LATE.append(run)
        out.append((run, got))
    return out

MITRES, RUNS_LATE = [], []

def finish_runs():
    """Mitre the joined corners (each pair of a hipped house's cornice gutters meeting at a corner), then build."""
    for r in MITRES:
        if not getattr(r, 'joined', (False, False))[1]: continue
        # the next wall's run starts at this run's end corner
        corner = r.w.P(r.w.L, 0, 0)
        nxt = next((q for q in MITRES if q is not r and getattr(q, 'joined', (False, False))[0] and (q.w.P(0, 0, 0) - corner).length < 0.05 and q.s0 < 0.1), None)
        if nxt is None: continue
        # where the two gutters' axes meet
        a1, d1 = r.w.P(0, 0, r.dc), r.w.t; a2, d2 = nxt.w.P(0, 0, nxt.dc), nxt.w.t
        den = d1.x * d2.z - d1.z * d2.x
        if abs(den) < 1e-6: continue
        t1 = ((a2.x - a1.x) * d2.z - (a2.z - a1.z) * d2.x) / den
        m = a1 + d1 * t1
        sm1 = (m - r.w.a).dot(r.w.t); sm2 = (m - nxt.w.a).dot(nxt.w.t)
        if abs(sm1 - r.w.L) > 0.6 or abs(sm2) > 0.6: continue
        # (both runs fall away from the corner, so both are at their rim's full height there)
        r.s1, nxt.s0 = sm1, sm2
        pn = (d1 + d2).normalized()
        r.mitre[1] = (Vector((m.x, 0, m.z)), pn); nxt.mitre[0] = (Vector((m.x, 0, m.z)), pn)
        report['mitres'] = report.get('mitres', 0) + 1
    for r in RUNS_LATE:
        CUR.update(r.cur)
        build_run(r)

def do_house(i, h):
    CUR['wear'] = 0.5; CUR['pipe_gap'] = 0.9
    alpha = house_alpha(h)
    CUR['alpha'] = alpha if alpha is not None else 0.6
    CUR['wear'] = min(1.0, max(0.0, CUR['alpha']))
    hr = random.Random(h['seed'] * 7 + 163)
    k = 0.92 + 0.12 * hr.random()
    CUR['tint'] = (k, k, k)
    rec = {'house': i, 'roof': h['roof'], 'kind': ('cottage ' if h.get('alley') else '') + ('rect' if h.get('rect') else 'poly'), 'gutters': [], 'pipes': [], 'heads': [], 'notes': []}
    H = h['h']
    if h.get('rect') and 'o' in h:
        (ox, oz), (ux, uz), (nx, nz) = h['o'], h['u'], h['n']
        s0, s1 = h['s']; t0, t1 = h['t']
        P = lambda s, t: (ox + ux * s + nx * t, oz + uz * s + nz * t)
        street = h['street']; yard = h.get('yard') or [0, 0, 0, 0]
        cottage = bool(h.get('alley')) and h['roof'] == 'side'
        R = 0.05 if cottage else (0.075 if h.get('store') else 0.0625)
        CUR['pipe_gap'] = 0.5 if cottage else 0.9
        if h['roof'] in ('side',):
            for side, (a, b, out, on) in enumerate(((P(s0, t0), P(s1, t0), (-nx, -nz), street[0] or yard[0]), (P(s1, t1), P(s0, t1), (nx, nz), street[2] or yard[2]))):
                if not on: continue
                w = Wall(a, b, out)
                label = f'gutter-{i}-{"front" if side == 0 else "back"}'
                if h.get('store') and w.L > 14:
                    # a long storehouse: two gutters falling to both ends, a pipe at each
                    for half, (q0, q1, pref) in enumerate(((0, w.L / 2, -1), (w.L / 2, w.L, 1))):
                        for run, got in eave_run(w, q0, q1, H, R, f'{label}-{half}', pref): log(rec, run, got)
                else:
                    for run, got in eave_run(w, 0, w.L, H, R, label, 1 if (i + side) % 2 == 0 else -1): log(rec, run, got)
        elif h['roof'] == 'front':
            # the side eaves: on a street their own gutter; between houses the valley drains to a head on the front
            for e, se, out, on in ((0, s0, (-ux, -uz), street[3]), (1, s1, (ux, uz), street[1])):
                if on:
                    a, b = (P(se, t0), P(se, t1)) if e == 1 else (P(se, t1), P(se, t0))
                    w = Wall(a, b, out)
                    for run, got in eave_run(w, 0, w.L, H, 0.0625, f'gutter-{i}-side{e}', -1 if e == 1 else 1): log(rec, run, got)
                elif street[0]:
                    front = Wall(P(s0, t0), P(s1, t0), (-nx, -nz))
                    s = 0.0 if e == 0 else front.L
                    key = (round(P(se, t0)[0] * 4) / 4, round(P(se, t0)[1] * 4) / 4)
                    if key in HEADS: rec['heads'].append({'shared': True, 's': s}); continue
                    got = gable_head(front, s, H, f'head-{i}-{e}', e)
                    HEADS[key] = got
                    rec['heads'].append(got or {'s': s, 'note': 'no clear line'})
        elif h['roof'] == 'flat':
            rec['notes'].append('flat roof rect: parapet')
    else:
        # a hipped house behind a cornice: a gutter on each street wall's cornice, mitred where two meet
        fp = h['fp']; n = len(fp)
        area = sum(fp[k][0] * fp[(k + 1) % n][1] - fp[(k + 1) % n][0] * fp[k][1] for k in range(n))
        walls = {}
        for k in range(n):
            if not h['street'][k]: continue
            a, b = fp[k], fp[(k + 1) % n]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L < 0.6: continue
            ox_, oz_ = (b[1] - a[1]) / L, -(b[0] - a[0]) / L
            if area < 0: ox_, oz_ = -ox_, -oz_
            walls[k] = Wall(a, b, (ox_, oz_))
        joins = {}
        for k, w in walls.items():
            k2 = (k + 1) % n
            if k2 in walls and 15 < math.degrees(w.t.angle(walls[k2].t)) < 100: joins[k] = k2
        # a short wall (a cut corner) carries a gutter only between two others it joins
        for k in [k for k, w in walls.items() if w.L < 2.0]:
            if not (((k - 1) % n) in joins and k in joins):
                walls.pop(k); joins.pop(k, None); joins.pop((k - 1) % n, None)
        runs = {}
        for k, w in walls.items():
            ends = (((k - 1) % n) in joins and joins[(k - 1) % n] == k, k in joins)
            pref = -1 if ends[1] and not ends[0] else 1 if ends[0] and not ends[1] else (1 if k % 2 else -1)
            for run, got in eave_run(w, 0, w.L, H, 0.0625, f'gutter-{i}-{k}', pref, joined=ends, pipe=w.L >= 2.0): log(rec, run, got)
    report['houses'].append(rec)

HEADS = {}

def gable_head(front, s, H, label, e):
    """The valley's outlet at a gable's foot: a short spout through the wall into a rainwater head, a pipe down."""
    # try the party line, then a little into this house
    for off in (0.0, 0.12, 0.2, 0.3):
        ss = s + off if e == 0 else s - off
        y_top = H - 0.14
        if face_depth(front, ss, y_top - 0.1) is None: continue
        # broken: a stream falls here, so a bare spout and no head or pipe
        if any(abs(front.local(p)[0] - ss) < 0.6 and abs(front.local(p)[2] - 0.18) < 0.5 for p in STREAMS):
            spout(front, ss, H - 0.06)
            return {'s': round(ss, 2), 'broken': 'bare spout, no pipe (a broken-gutter stream falls here)'}
        cl = clear_line(front, ss, 0.3, y_top - 0.3)
        if cl is None or not far_from_pipes(front, ss): continue
        d_axis = max(cl[0], cl[1] + 0.11)
        got = downpipe(front, ss, y_top - 0.24, d_axis, label, need_neck=False, d_min=d_axis)
        if got:
            spout(front, ss, y_top + 0.13, into=d_axis, base=cl[1])
            head(front, ss, y_top, d_axis)
        if got: return {'s': round(ss, 2), 'head': True, **got}
    ss = s + 0.12 if e == 0 else s - 0.12
    if face_depth(front, ss, H - 0.2) is not None:
        spout(front, ss, H - 0.06)
        return {'s': round(ss, 2), 'spout': 'no clear wall for a pipe: a bare spout throws the water clear'}
    return None

def spout(w, s, y, into=None, base=0.0):
    """A lead spout out of the wall: into a head below it, or a bare one throwing the water clear."""
    reach = (into or 0.25 + base); CUR['part'] = 'spout'
    pts = [w.P(s, y + 0.02, base - 0.02), w.P(s, y, (base + reach) * 0.5), w.P(s, y - 0.05, reach)]
    sweep(ring_profile(0.032, 10), bend_path(pts, 0.05, 3), colour(0.8, 0.1))
    a, b = pts[-1], pts[-2]
    t = (a - b).normalized()
    sweep([(x, yy, -nx, -ny) for x, yy, nx, ny in ring_profile(0.026, 10)], [a - t * 0.06, a], colour(0.15))

def log(rec, run, got):
    if run is None:
        rec['notes'].append(got if isinstance(got, str) else 'no gutter'); return
    a, b = run.w.P(run.s0, run.y_rim, run.dc), run.w.P(run.s1, run.y_rim, run.dc)
    rec['gutters'].append({'from': round(run.s0, 2), 'to': round(run.s1, 2), 'kind': run.kind, 'radius': run.R, 'gaps': [round(g, 2) for g in run.gaps],
                           'ends': [[round(a.x, 3), round(a.y, 3), round(a.z, 3)], [round(b.x, 3), round(b.y, 3), round(b.z, 3)]], 'out': [round(run.w.n.x, 4), round(run.w.n.z, 4)]})
    if got: rec['pipes'].append(got)
    else: rec['notes'].append('no clear pipe line: gutter without pipe')

# pipes and gable heads already built by the chunks done before (a party line on a chunk's edge gets one head)
SHARED = out_dir / 'shared-state.json'
if SHARED.exists():
    st_ = json.loads(SHARED.read_text())
    PIPES += [(Vector(n), Vector(q)) for n, q in st_['pipes']]
    for k in st_['heads']: HEADS[tuple(k)] = {'other chunk': True}
    STREET_GULLIES += [(Vector(q), Vector(n)) for q, n in st_.get('gullies', []) if n is not None]
for i, h in enumerate(HOUSES):
    if h.get('gone') or chunk_of(h) != (CX, CZ): continue
    if ONLY is not None and i not in ONLY: continue
    try: do_house(i, h)
    except Exception as ex:
        import traceback; traceback.print_exc()
        report['houses'].append({'house': i, 'error': str(ex)})
finish_runs()

# ---------------------------------------------------------------- the old gutter boxes (hidden near-detail stone)
audit = json.loads((audit_dir / 'audit.json').read_text())

def old_box_hits(cen, lum):
    """Which triangle centres lie in an old flat gutter box: under each ridge-along-the-street eave, and the dark
    ledge on each hipped house's cornice."""
    gone = set()
    for i, h in enumerate(HOUSES):
        if h.get('gone') or chunk_of(h) != (CX, CZ): continue
        if ONLY is not None and i not in ONLY: continue
        boxes = []
        if h.get('rect') and h['roof'] == 'side' and h['street'][0] and not h.get('alley') and 'o' in h:
            (ox, oz), (ux, uz), (nx, nz) = h['o'], h['u'], h['n']; s0, s1 = h['s']; t0 = h['t'][0]
            drop = 0.4 * math.tan(math.radians(h['pitch']))
            sm, t = (s0 + s1) / 2, t0 - 0.43
            boxes.append(((ox + ux * sm + nx * t, oz + uz * sm + nz * t), (ux, uz), (nx, nz), (s1 - s0) / 2 + 0.02, 0.09, h['h'] - drop - 0.05, 0.08))
        if not h.get('rect'):
            fp = h['fp']; n = len(fp)
            area = sum(fp[k][0] * fp[(k + 1) % n][1] - fp[(k + 1) % n][0] * fp[k][1] for k in range(n))
            for k in range(n):
                if not h['street'][k]: continue
                a, b = fp[k], fp[(k + 1) % n]; L = math.hypot(b[0] - a[0], b[1] - a[1]) or 1
                ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                ox_, oz_ = uz, -ux
                if area < 0: ox_, oz_ = -ox_, -oz_
                m = ((a[0] + b[0]) / 2 + ox_ * 0.30, (a[1] + b[1]) / 2 + oz_ * 0.30)
                boxes.append((m, (ux, uz), (-ox_, -oz_), L / 2 + 0.4, 0.075, h['h'] + 0.05, 0.07))
        for (mx, mz), (ux, uz), (nx, nz), hs, ht, yc, hy in boxes:
            for idx, c in enumerate(cen):
                if lum is not None and lum[idx] > 0.33: continue
                dx, dz = c[0] - mx, c[2] - mz
                if abs(dx * ux + dz * uz) < hs and abs(dx * nx + dz * nz) < ht and abs(c[1] - yc) < hy: gone.add(idx)
    return gone

manifest = {}
for rec in audit:
    stem = pathlib.Path(rec['mesh']).stem
    if rec['role'] == 'old':
        surf = rec['surfaces'][0]
        a = array.array('f'); a.frombytes((audit_dir / 'source' / surf['file']).read_bytes())
        ntri = len(a) // 48
        cen = [((a[t * 48] + a[t * 48 + 16] + a[t * 48 + 32]) / 3, (a[t * 48 + 1] + a[t * 48 + 17] + a[t * 48 + 33]) / 3, (a[t * 48 + 2] + a[t * 48 + 18] + a[t * 48 + 34]) / 3) for t in range(ntri)]
        lum = [a[t * 48 + 11] for t in range(ntri)]
        gone = old_box_hits(cen, lum)
        kept = array.array('f')
        for t in range(ntri):
            if t not in gone: kept.extend(a[t * 48:(t + 1) * 48])
        (out_dir / f'{stem}-{surf["index"]}.bin').write_bytes(kept.tobytes())
        entry = {'node': rec['node'], 'sourceHash': rec['meshHash'],
                 'surfaces': [{'file': f'{stem}-{surf["index"]}.bin', 'material': surf['material'], 'custom0': surf['custom0'], 'vertices': len(kept) // 16}]}
        if 'native_solid_stand_in' in rec['meta']:
            sa = array.array('f'); sa.frombytes((audit_dir / 'source' / rec['meta']['native_solid_stand_in']).read_bytes())
            stri = len(sa) // 9
            scen = [((sa[t * 9] + sa[t * 9 + 3] + sa[t * 9 + 6]) / 3, (sa[t * 9 + 1] + sa[t * 9 + 4] + sa[t * 9 + 7]) / 3, (sa[t * 9 + 2] + sa[t * 9 + 5] + sa[t * 9 + 8]) / 3) for t in range(stri)]
            sgone = old_box_hits(scen, None)
            skept = array.array('f')
            for t in range(stri):
                if t not in sgone: skept.extend(sa[t * 9:(t + 1) * 9])
            (out_dir / f'{stem}-standin.bin').write_bytes(skept.tobytes())
            entry.update(standIn=f'{stem}-standin.bin', skip=[0])
            report['oldStandInTriangles'] = len(sgone)
        manifest[rec['mesh']] = entry
        report['oldBoxTriangles'] = len(gone)
    elif rec['role'] == 'stone' and iron.rows:
        (out_dir / f'{stem}-iron.bin').write_bytes(array.array('f', (x for r in iron.rows for x in r)).tobytes())
        surfaces = [{'keep': s['index'], 'material': s['material'], 'vertices': s['vertices']} for s in rec['surfaces']]
        surfaces.append({'file': f'{stem}-iron.bin', 'material': IRON, 'custom0': False, 'vertices': len(iron.rows)})
        st_bytes = array.array('f', (x for p in STAND for x in (p.x, p.y, p.z)))
        (out_dir / f'{stem}-standin-add.bin').write_bytes(st_bytes.tobytes())
        manifest[rec['mesh']] = {'node': rec['node'], 'sourceHash': rec['meshHash'], 'surfaces': surfaces,
                                 'standInAdd': f'{stem}-standin-add.bin', 'skipAdd': [len(surfaces) - 1]}
    elif rec['role'] == 'grime' and decal.rows:
        (out_dir / f'{stem}-decals.bin').write_bytes(array.array('f', (x for r in decal.rows for x in r)).tobytes())
        surfaces = [{'keep': s['index'], 'material': s['material'], 'vertices': s['vertices']} for s in rec['surfaces']]
        surfaces.append({'file': f'{stem}-decals.bin', 'material': DECAL, 'custom0': True, 'vertices': len(decal.rows)})
        manifest[rec['mesh']] = {'node': rec['node'], 'sourceHash': rec['meshHash'], 'surfaces': surfaces}
(out_dir / f'manifest-{chunk}.json').write_text(json.dumps(manifest, indent=1))
SHARED.write_text(json.dumps({'pipes': [[list(n), list(q)] for n, q in PIPES], 'heads': [list(k) for k in HEADS], 'gullies': [[list(q), list(n)] for q, n in STREET_GULLIES if n is not None]}))
(out_dir / f'ruien-{chunk}.json').write_text(json.dumps(INLETS, indent=1))
report['ironTriangles'] = len(iron.rows) // 3
report['decalTriangles'] = len(decal.rows) // 3
report['standInTriangles'] = len(STAND) // 3
report['inlets'] = len(INLETS)
report['ironTrianglesByPart'] = PARTS
(out_dir / f'report-{chunk}.json').write_text(json.dumps(report, indent=1))
print('Gutters candidate:', json.dumps({k: v for k, v in report.items() if k != 'houses'}), len(report['houses']), 'houses')
