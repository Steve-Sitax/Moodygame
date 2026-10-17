"""Issue #157: dressed corner stones, door and window surrounds, sills, heads and plinths for the town's houses.
Run with Blender, one city chunk at a time:
  blender -b -P scripts/repair-stone-corners.py -- <audit folder> <chunk, e.g. city_-2_0> <brick beds json> <candidate folder> [x0 x1 z0 z1]
Input is the world-space export of audit-stone-corners.gd (16 floats per vertex). Output is a review candidate in the
wall-circuit format (manifest-<chunk>.json + .bin rows); the game builds it in memory (NativeStoneCornersProof) and
the promotion saves it. Scene nodes, transforms, permanent ids and every other triangle stay as they are: only the old
stone boxes are replaced. Each stone finds its wall in the brick or plaster face behind it; on brick its joints sit on
that wall's bed joints. The optional box limits the repair to one house (the first review: Steenplein 1).
"""
import array, hashlib, json, math, pathlib, random, sys
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
audit_dir, chunk, beds_path, out_dir = pathlib.Path(args[0]), args[1], pathlib.Path(args[2]), pathlib.Path(args[3])
limit = [float(x) for x in args[4:8]] if len(args) >= 8 else None
out_dir.mkdir(parents=True, exist_ok=True)
audit = json.loads((audit_dir / 'audit.json').read_text())
BEDS = {int(k): v for k, v in json.loads(beds_path.read_text()).items()}
UP = Vector((0, 1, 0))
DRESSED = 'candidate:dressed_stone'
STONE, FACADE, DECAL = 'res://world/town/resources/r000209.res', 'res://world/town/resources/r000195.res', 'res://world/town/resources/r000221.res'
report = {'chunk': chunk, 'items': [], 'kept': [], 'removedTriangles': {}, 'addedTriangles': {}}
rng = random.Random(int(hashlib.sha256(chunk.encode()).hexdigest()[:8], 16))
CUR = {'wear': 0.26}

class Front:
    """A wall's frame: s along it, y up, d out of it (d = 0 on the wall's face). layer: its wall picture."""
    def __init__(self, origin, t, n, layer=-1):
        self.a, self.t, self.n, self.layer = origin, t.normalized(), n.normalized(), layer
    def world(self, s, y, d): return self.a + self.t * s + UP * y + self.n * d
    def local(self, p): q = p - self.a; return q.dot(self.t), p.y, q.dot(self.n)
    def bed(self, y):
        """The nearest bed joint of this wall's brick; plaster and stone walls keep the height."""
        b = BEDS.get(int(round(self.layer)))
        if b is None or self.layer > 4.5: return y
        return b['bed0'] + round((y - b['bed0']) / b['pitch']) * b['pitch']

def load(name):
    a = array.array('f'); a.frombytes((audit_dir / 'source' / name).read_bytes())
    return [list(a[i:i + 16]) for i in range(0, len(a), 16)]
def write(name, rows):
    (out_dir / name).write_bytes(array.array('f', (x for r in rows for x in r)).tobytes())

GROUP = ['']  # the mesh the next pieces go to: the near-only detail, or the base mesh for the door
class Piece:
    """One stone being built: a bmesh in world space and the face codes the shader reads (UV2.x)."""
    def __init__(self, kind, blue=False):
        self.bm = bmesh.new(); self.kind = kind; self.blue = blue; self.rand = rng.random(); self.rand2 = rng.random()
        self.group = GROUP[0]; self.wear = CUR['wear']
        self.code = self.bm.faces.layers.int.new('code'); self.bev = self.bm.faces.layers.int.new('bevel')
        self.hidden = Hidden(self)

class Hidden:
    """Faces nobody sees (against the wall, on the pavement): a face layer, so it survives the bevel's rebuilt faces."""
    def __init__(self, p): self.p = p; self.layer = p.bm.faces.layers.int.new('hidden')
    def add(self, f):
        if f.is_valid: f[self.layer] = 1
    def update(self, faces):
        for f in faces: self.add(f)
    def __iter__(self): return iter([f for f in self.p.bm.faces if f[self.layer]])
    def __contains__(self, f): return f.is_valid and bool(f[self.layer])

# ---------------------------------------------------------------- geometry kit
def box(p, front, s0, s1, y0, y1, d0, d1):
    """A closed block in a front's frame; returns its faces by name."""
    bm = p.bm
    v = {}
    for i, s in enumerate((s0, s1)):
        for j, y in enumerate((y0, y1)):
            for k, d in enumerate((d0, d1)):
                v[i, j, k] = bm.verts.new(front.world(s, y, d))
    F = lambda *k: bm.faces.new([v[x] for x in k])
    faces = {'front': F((0, 0, 1), (1, 0, 1), (1, 1, 1), (0, 1, 1)), 'back': F((0, 0, 0), (0, 1, 0), (1, 1, 0), (1, 0, 0)),
             'top': F((0, 1, 0), (0, 1, 1), (1, 1, 1), (1, 1, 0)), 'bottom': F((0, 0, 0), (1, 0, 0), (1, 0, 1), (0, 0, 1)),
             'start': F((0, 0, 0), (0, 0, 1), (0, 1, 1), (0, 1, 0)), 'end': F((1, 0, 0), (1, 1, 0), (1, 1, 1), (1, 0, 1))}
    bmesh.ops.recalc_face_normals(bm, faces=list(faces.values()))
    return faces

def prism(p, outline, y0, y1, hidden_sides):
    """A plan outline (world xz points, counter-clockwise seen from above) extruded from y0 to y1."""
    bm = p.bm; lo = [bm.verts.new((x, y0, z)) for x, z in outline]; hi = [bm.verts.new((x, y1, z)) for x, z in outline]
    n = len(outline); sides = []
    for i in range(n):
        j = (i + 1) % n; sides.append(bm.faces.new([lo[i], lo[j], hi[j], hi[i]]))
    top = bm.faces.new(hi); bottom = bm.faces.new(list(reversed(lo)))
    bmesh.ops.recalc_face_normals(bm, faces=sides + [top, bottom])
    for i in hidden_sides: p.hidden.add(sides[i])
    return sides, top, bottom

def bevel(p, edges, offset, segments=2):
    edges = list(dict.fromkeys(e for e in edges if e.is_valid and len(e.link_faces) == 2))
    if not edges: return
    res = bmesh.ops.bevel(p.bm, geom=edges, offset=offset, segments=segments, profile=0.5, affect='EDGES', clamp_overlap=True)
    for f in res['faces']: f[p.bev] = 1

def visible_edges(p, faces):
    hid = {f for f in p.hidden if f.is_valid}
    return [e for f in faces if f.is_valid for e in f.edges if not any(g in hid for g in e.link_faces)]

def main_face(p, normal):
    """After a bevel the old face handle may be gone: the largest unbevelled face facing this way."""
    faces = [f for f in p.bm.faces if f.is_valid and not f[p.bev] and f.normal.dot(normal) > 0.99]
    return max(faces, key=lambda f: f.calc_area()) if faces else None

def dress(p, face, margin=0.022, proud=0.003, step=0.0018):
    """A drafted margin round a face and a tooled field standing a little proud of it. face: a face or its normal."""
    if isinstance(face, Vector) or not face.is_valid: face = main_face(p, face if isinstance(face, Vector) else Vector())
    if face is None: return
    face[p.code] = 4
    res = bmesh.ops.inset_individual(p.bm, faces=[face], thickness=margin, depth=0.0, use_even_offset=True)
    n = face.normal.copy()
    for f in res['faces']:
        # the margin's tooling runs across the band: a band along a level edge has upright strokes
        edge = max(f.edges, key=lambda e: e.calc_length())
        dirn = (edge.verts[1].co - edge.verts[0].co).normalized()
        f[p.code] = 2 if abs(dirn.y) < 0.5 else 3
    res2 = bmesh.ops.inset_individual(p.bm, faces=[face], thickness=step, depth=proud, use_even_offset=True)
    for f in res2['faces']: f[p.code] = 4
    face[p.code] = 1

def chips(p, count, size=(0.006, 0.016)):
    """Broken arrises: a few corners knocked in, never the same on two stones; more and bigger on a worn house."""
    count = count + int(round(p.wear * 3 * rng.random())); size = (size[0] * (1 + 0.6 * p.wear), size[1] * (1 + 0.8 * p.wear))
    # only the arrises' own vertices move: a moved corner of a flat face would bend the whole face
    movable = [v for v in p.bm.verts if v.link_faces and all(f[p.bev] for f in v.link_faces)]
    corners = [v for v in movable if len(v.link_faces) >= 3]
    if not corners: return
    for _ in range(count):
        c = rng.choice(corners).co.copy(); r = rng.uniform(*size)
        inward = sum((f.normal for f in p.bm.faces if not f in p.hidden and (f.calc_center_median() - c).length < 0.2), Vector()).normalized()
        for v in movable:
            dist = (v.co - c).length
            if dist < r: v.co -= inward * (r - dist) * 0.55

def finish(p, front_like=None):
    # outward normals while the stone is still closed; once its hidden faces are gone it is open and the
    # recalculation could turn a whole region inside out (a reveal face lit from behind, black)
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)
    gone = list(p.hidden)
    if gone: bmesh.ops.delete(p.bm, geom=gone, context='FACES_ONLY')

pieces = []

def dressed_block(front, s0, s1, y0, y1, d0, d1, kind, blue=False, arris=0.008, under=False, ends=True, top=True, margin=True, chip=2):
    p = Piece(kind, blue); f = box(p, front, s0, s1, y0, y1, d0, d1)
    p.hidden.add(f['back'])
    if not under: p.hidden.add(f['bottom'])
    if not ends: p.hidden.update((f['start'], f['end']))
    if not top: p.hidden.add(f['top'])
    for k, face in f.items(): face[p.code] = 4
    # rounded (two facets) within reach of hands and eyes, one chamfer facet higher up
    bevel(p, visible_edges(p, [f['front'], f['top'], f['bottom'], f['start'], f['end']]), arris * rng.uniform(0.8, 1.25), 2 if y0 < 2.2 else 1)
    if margin: dress(p, front.n.copy())
    chips(p, chip)
    finish(p); pieces.append(p); return p

def profile_stone(front, s0, s1, prof, kind, blue=False, arris=0.006):
    """A moulded stone (a sill, a hood): a profile [(d, y)] round its section, run from s0 to s1, ends closed."""
    p = Piece(kind, blue); bm = p.bm
    a = [bm.verts.new(front.world(s0, y, d)) for d, y in prof]; b = [bm.verts.new(front.world(s1, y, d)) for d, y in prof]
    n = len(prof); sides = []
    for i in range(n):
        j = (i + 1) % n; f = bm.faces.new([a[i], a[j], b[j], b[i]]); f[p.code] = 4; sides.append(f)
    ca = bm.faces.new(list(reversed(a))); cb = bm.faces.new(b); ca[p.code] = cb[p.code] = 4
    bmesh.ops.recalc_face_normals(bm, faces=sides + [ca, cb])
    # the face against the wall is hidden (the profile's first side runs up the wall)
    p.hidden.add(sides[-1])
    bevel(p, visible_edges(p, [ca, cb]), arris, 1)
    bmesh.ops.triangulate(bm, faces=[f for f in (ca, cb) if f.is_valid])
    chips(p, 1, (0.004, 0.01))
    finish(p); pieces.append(p); return p

def shop_surround(fr, s0, s1, y0, y1):
    """The stone architrave round a shop window, over the painted one: jambs, a head on the brick beds, a sill."""
    W, P = 0.14, 0.035
    sill_top = y0; head0 = y1
    profile_stone(fr, s0 - W - 0.05, s1 + W + 0.05, [(-0.012, sill_top - 0.12), (P + 0.03, sill_top - 0.12), (P + 0.036, sill_top - 0.114),
                  (P + 0.036, sill_top - 0.02), (P + 0.03, sill_top - 0.012), (0.0, sill_top), (-0.012, sill_top)], 'shop sill')
    for a, b in ((s0 - W, s0), (s1, s1 + W)):
        dressed_block(fr, a, b, sill_top + 0.004, head0 - 0.005, -0.03, P, 'shop jamb', arris=0.006, under=True, chip=1)
    dressed_block(fr, s0 - W - 0.02, s1 + W + 0.02, head0 + 0.005, fr.bed(head0 + 0.19), -0.03, P + 0.008, 'shop head', under=True, arris=0.007)

def plinth(fr, s0, s1, y0, y1, d1):
    """Blue stone plinth blocks on the pavement, a weathered top that sheds the rain, joints every 0.6-0.9 m."""
    top = fr.bed(y1)
    n = max(1, round((s1 - s0) / 0.75)); cuts = [s0] + sorted(s0 + (s1 - s0) * (i + rng.uniform(-0.12, 0.12)) / n for i in range(1, n)) + [s1]
    for a, b in zip(cuts, cuts[1:]):
        p = Piece('plinth', blue=True); f = box(p, fr, a + 0.005, b - 0.005, y0, top, -0.012, d1)
        p.hidden.update((f['back'], f['bottom']))
        for face in f.values(): face[p.code] = 4
        # the weathering: the top's front arris cut back at 45 degrees, 22 mm
        bevel(p, [e for e in f['top'].edges if all(v.co.y > top - 1e-4 for v in e.verts) and e in f['front'].edges], 0.022, 1)
        bevel(p, visible_edges(p, [f['front'], f['start'], f['end']] + ([f['top']] if f['top'].is_valid else [])), 0.007 * rng.uniform(0.8, 1.3))
        dress(p, fr.n.copy(), margin=0.02, proud=0.002)
        chips(p, 2, (0.006, 0.018)); finish(p); pieces.append(p)
        if b < s1 - 1e-4:
            m = Piece('mortar'); g = box(m, fr, b - 0.005, b + 0.005, y0, top - 0.004, -0.012, d1 - 0.007)
            m.hidden.update((g['back'], g['bottom'], g['start'], g['end']))
            for face in g.values(): face[m.code] = 15
            finish(m); pieces.append(m)

def sill(fr, s0, s1, y0, y1, d1):
    """A window sill: its top falls to the front, a rounded nose, a drip groove under it, its ends seen."""
    t = 0.012
    prof = [(-0.012, y0), (d1 - 0.034, y0), (d1 - 0.034, y0 + 0.007), (d1 - 0.024, y0 + 0.007), (d1 - 0.024, y0), (d1 - 0.006, y0),
            (d1, y0 + 0.006), (d1, y1 - t - 0.008), (d1 - 0.004, y1 - t - 0.002), (d1 - 0.010, y1 - t), (0.0, y1), (-0.012, y1)]
    profile_stone(fr, s0 - 0.01, s1 + 0.01, prof, 'window sill')

def keystone(fr, s0, s1, y0, y1, d1):
    """The key: a wedge, wider at the top, dressed like the head it stands in."""
    p = dressed_block(fr, s0, s1, y0, y1, -0.012, d1, 'keystone', under=True, arris=0.006)
    mid = (s0 + s1) / 2
    for v in p.bm.verts:
        s, y, d = fr.local(v.co); k = (y - y0) / (y1 - y0)
        v.co = fr.world(mid + (s - mid) * (0.86 + 0.24 * k), y, d)

def lintel(fr, s0, s1, y0, y1, d1):
    # one stone over the door, through the reveal: its underside is the reveal's soffit
    dressed_block(fr, s0, s1, y0 - 0.003, y1, -0.198, d1, 'door lintel', under=True, arris=0.009)

def hood(fr, s0, s1, y0, y1, d1):
    """The drip moulding over the lintel: a sloped top, an ovolo, a throat under it."""
    h = y1 - y0; prof = [(-0.012, y0), (d1 - 0.05, y0), (d1 - 0.05, y0 + 0.008), (d1 - 0.04, y0 + 0.008), (d1 - 0.04, y0)]
    r = 0.028
    for i in range(5):
        a = math.pi * 0.5 * i / 4
        prof.append((d1 - r + r * math.sin(a), y0 + r - r * math.cos(a)))
    prof += [(d1, y1 - 0.016), (d1 - 0.008, y1 - 0.01), (0.0, y1 + 0.006), (-0.012, y1 + 0.006)]
    profile_stone(fr, s0, s1, prof, 'door hood')

def step(fr, s0, s1, y0, y1, d0, d1):
    """The door step: one blue stone, its tread worn hollow in the middle."""
    p = Piece('door step', blue=True); f = box(p, fr, s0, s1, y0, y1, d0, d1)
    p.hidden.update((f['back'], f['bottom']))
    for face in f.values(): face[p.code] = 4
    bevel(p, visible_edges(p, [f['front'], f['start'], f['end'], f['top']]), 0.010, 2)
    top = [fc for fc in p.bm.faces if fc.normal.y > 0.95 and fc[p.bev] == 0]
    if top:
        res = bmesh.ops.subdivide_edges(p.bm, edges=list({e for fc in top for e in fc.edges}), cuts=4, use_grid_fill=True)
        mid = (s0 + s1) / 2
        for v in p.bm.verts:
            s, y, d = fr.local(v.co)
            if y > y1 - 1e-4:
                u = 1 - min(1, abs(s - mid) / ((s1 - s0) * 0.42)); w = 1 - min(1, abs(d - (d0 + d1) / 2) / ((d1 - d0) * 0.6))
                v.co.y -= (0.004 + 0.008 * p.wear) * (u * u * (3 - 2 * u)) * w  # (a poor house's step: worn deeper)
    chips(p, 1, (0.006, 0.014)); finish(p); pieces.append(p)

def door(fr, rows, idx):
    """The jambs: through-stones (front and reveal), three a side on the brick beds, the arris worn at the hand."""
    fronts_at = sorted({round(fr.local(Vector(rows[i + k][:3]))[0], 3) for i in idx for k in range(3)})
    pts = [fr.local(Vector(rows[i + k][:3])) for i in idx for k in range(3)]
    s0, s1 = min(p[0] for p in pts), max(p[0] for p in pts); ys = max(p[1] for p in pts); P = max(p[2] for p in pts); R = -min(p[2] for p in pts)
    # the jambs' widths: the front faces at d = P
    xs = sorted({round(p[0], 3) for p in pts if abs(p[2] - P) < 1e-3})
    J = xs[1] - xs[0] if len(xs) >= 4 else 0.2
    beds = [0.0, fr.bed(ys / 3), fr.bed(2 * ys / 3), ys]
    # the inner faces stand 3 mm into the opening: the game's own doorway pieces lie in the old reveal's plane
    for a, b in ((s0, s0 + J + 0.003), (s1 - J - 0.003, s1)):
        inner_left = a > s0 + 1e-3
        for k, (y0, y1) in enumerate(zip(beds, beds[1:])):
            p = dressed_block(fr, a, b, y0 + (0.005 if k else 0), y1 - (0.005 if k < 2 else 0), -R, P, 'door jamb', arris=0.009, top=True, under=k > 0, chip=1)
            # hands and shoulders have rounded the arris by the opening between 0.8 and 1.7 m
            edge_s = a if inner_left else b
            for v in p.bm.verts:
                s, y, d = fr.local(v.co)
                if 0.8 < y < 1.7 and abs(s - edge_s) < 0.03 and d > P - 0.03:
                    k2 = math.sin(math.pi * (y - 0.8) / 0.9) * (1 - abs(s - edge_s) / 0.03) * (1 - (P - d) / 0.03)
                    v.co -= fr.n * 0.004 * k2
            if k < 2:
                m = Piece('mortar'); g = box(m, fr, a + 0.001, b - 0.001, y1 - 0.0055, y1 + 0.0055, -R + 0.003, P - 0.004)  # (in front of the old reveal plane)
                m.hidden.update((g['back'], g['top'], g['bottom']))
                for face in g.values(): face[m.code] = 5
                finish(m); pieces.append(m)


# ---------------------------------------------------------------- the chunk's walls
records = [r for r in audit if r['node'] == chunk or r['node'].startswith(chunk + '_')]
def surfaces_of(material):
    return [(r, s) for r in records for s in r['surfaces'] if s['material'] == material]
stone_meshes = [(pathlib.Path(r['mesh']).stem, s) for r, s in surfaces_of(STONE)]

# every upright facade triangle, by 2 m cell, with its plane and its wall picture (CUSTOM0.x)
walls, wall_tris = {}, []
for r, s in surfaces_of(FACADE):
    rows = load(s['file'])
    for i in range(0, len(rows), 3):
        tri = rows[i:i + 3]; a, b, c = (Vector(x[:3]) for x in tri)
        wall_tris.append((a, b, c))
        n = sum((Vector(x[3:6]) for x in tri), Vector())
        if n.length < 1e-6 or abs(n.normalized().y) > 0.2: continue
        n.y = 0; n.normalize()
        lo = Vector((min(a.x, b.x, c.x), min(a.y, b.y, c.y), min(a.z, b.z, c.z))); hi = Vector((max(a.x, b.x, c.x), max(a.y, b.y, c.y), max(a.z, b.z, c.z)))
        w = (n, (a + b + c).dot(n) / 3, lo, hi, tri[0][14])
        for cx in range(math.floor((lo.x - 0.7) / 2), math.floor((hi.x + 0.7) / 2) + 1):
            for cz in range(math.floor((lo.z - 0.7) / 2), math.floor((hi.z + 0.7) / 2) + 1):
                walls.setdefault((cx, cz), []).append(w)

def wall_at(p, n, reach=0.35):
    """The facade plane facing n nearest behind or in front of point p: (offset along n, wall picture) or None."""
    best = None
    for wn, off, lo, hi, layer in walls.get((math.floor(p.x / 2), math.floor(p.z / 2)), []):
        if wn.dot(n) < 0.995: continue
        gap = p.dot(wn) - off
        if abs(gap) > reach: continue
        if not (lo.x - 0.7 < p.x < hi.x + 0.7 and lo.z - 0.7 < p.z < hi.z + 0.7 and lo.y - 1.5 < p.y < hi.y + 1.5): continue
        if best is None or abs(gap) < abs(best[0]): best = (gap, off, layer, wn)
    return None if best is None else (best[1], best[2], best[3])

def front_for(n, off, layer):
    return Front(n * off, Vector((-n.z, 0, n.x)), n, layer)

def components(rows):
    """The stone triangles welded within 1 mm and split into connected pieces (each old box or group of boxes)."""
    parent = {}
    def F(a):
        while parent.setdefault(a, a) != a: a = parent[a]
        return a
    def inside(tri):
        if limit is None: return True
        c = sum((Vector(r[:3]) for r in tri), Vector()) / 3
        return limit[0] < c.x < limit[1] and limit[2] < c.z < limit[3]
    tris = [i for i in range(0, len(rows), 3) if inside(rows[i:i + 3])]
    key = lambda r: (round(r[0] * 1000), round(r[1] * 1000), round(r[2] * 1000))
    for i in tris:
        ks = [key(r) for r in rows[i:i + 3]]
        for k in ks[1:]: parent[F(k)] = F(ks[0])
    groups = {}
    for i in tris: groups.setdefault(F(key(rows[i])), []).append(i)
    return list(groups.values())

def normals_of(rows, idx):
    """Area-weighted horizontal normals of a piece's upright faces, by direction."""
    cl = {}
    for i in idx:
        a, b, c = (Vector(rows[i + k][:3]) for k in range(3)); area = (b - a).cross(c - a).length / 2
        n = sum((Vector(rows[i + k][3:6]) for k in range(3)), Vector())
        if area < 1e-9 or n.length < 1e-6: continue
        n.normalize()
        if abs(n.y) > 0.3: continue
        n.y = 0; n.normalize(); k = (round(n.x, 1), round(n.z, 1))
        e = cl.setdefault(k, [Vector(), 0.0]); e[0] += n * area; e[1] += area
    return sorted(((v.normalized(), a) for v, a in cl.values()), key=lambda x: -x[1])

def local_box(rows, idx, fr):
    pts = [fr.local(Vector(rows[i + k][:3])) for i in idx for k in range(3)]
    return [min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts), min(p[2] for p in pts), max(p[2] for p in pts)]

removed = {}
def take(mesh, idx): removed.setdefault(mesh, set()).update(idx)
corners = []

def ell(fa, fb, corner, la, lb, pr, e):
    """The plan of one quoin course: the arris, along B's face, into the wall, the inner corner, out along A's face."""
    pts = [corner + fa.n * pr + fb.n * pr, corner + fb.t * lb + fb.n * pr, corner + fb.t * lb - fb.n * e,
           corner - fa.n * e - fb.n * e, corner + fa.t * la - fa.n * e, corner + fa.t * la + fa.n * pr]
    out = [(w.x, w.z) for w in pts]
    area = sum(out[i][0] * out[(i + 1) % 6][1] - out[(i + 1) % 6][0] * out[i][1] for i in range(6))
    return out if area < 0 else list(reversed(out))

def quoin_corner(fa, fb, corner, courses, mesh):
    """One corner's courses: each an L of stone round the corner, long and short in turn, on the brick beds."""
    joint, e = 0.010, 0.012
    courses.sort(key=lambda c: c[0])
    pitch_raw = (courses[1][0] - courses[0][0]) if len(courses) > 1 else courses[0][1] - courses[0][0] + 0.02
    GROUP[0] = mesh
    for k, (y0, y1, la, lb, pr, idx, wear) in enumerate(courses):
        take(mesh, idx); CUR['wear'] = wear
        c0 = fa.bed(y0) + joint / 2; c1 = fa.bed(y0 + pitch_raw) - joint / 2
        if not 0.12 < c1 - c0 < 0.6: c0, c1 = y0, y1
        p = Piece('quoin')
        sides, top, bottom = prism(p, ell(fa, fb, corner, la, lb, pr, e), c0, c1, [])
        p.hidden.update([f for f in sides if f.normal.dot(fa.n) < -0.9 or f.normal.dot(fb.n) < -0.9])
        for f in p.bm.faces: f[p.code] = 4
        bevel(p, visible_edges(p, sides + [top, bottom]), 0.009 * rng.uniform(0.8, 1.3), 2 if c0 < 2.2 else 1)
        dress(p, fa.n.copy()); dress(p, fb.n.copy())
        # the lower courses at a street corner take the knocks of wheels and loads
        chips(p, 3 if c0 < 1.6 else 1, (0.008, 0.022) if c0 < 1.6 else (0.005, 0.012))
        finish(p); pieces.append(p)
        if k + 1 < len(courses):
            m = Piece('mortar')
            ms, mt, mb = prism(m, ell(fa, fb, corner, min(la, courses[k + 1][2]), min(lb, courses[k + 1][3]), pr - 0.008, e), c1 - 0.001, c1 + joint + 0.001, [])
            m.hidden.update([mt, mb] + [f for f in ms if f.normal.dot(fa.n) < -0.9 or f.normal.dot(fb.n) < -0.9])
            for f in m.bm.faces: f[m.code] = 5
            finish(m); pieces.append(m)
    report['items'].append({'kind': 'quoin corner', 'courses': len(courses), 'corner': [round(corner.x, 3), round(corner.z, 3)], 'layer': fa.layer,
                            'n': [round((fa.n + fb.n).normalized().x, 3), round((fa.n + fb.n).normalized().z, 3)], 'top': round(courses[-1][1], 2)})

def plane_corner(fa, fb):
    """Where two wall faces meet (in plan)."""
    det = fa.n.x * fb.n.z - fa.n.z * fb.n.x
    o1, o2 = fa.a.dot(fa.n), fb.a.dot(fb.n)
    return Vector(((o1 * fb.n.z - o2 * fa.n.z) / det, 0, (fa.n.x * o2 - fb.n.x * o1) / det))

def classify_and_build():
    plinths, shops, heads = [], [], []
    for mesh, s in stone_meshes:
        GROUP[0] = mesh
        rows = load(s['file']); groups = components(rows)
        report['pieces_' + mesh] = len(groups)
        quoin_groups, singles = {}, []
        for idx in groups:
            GROUP[0] = mesh
            pts = [Vector(rows[i + k][:3]) for i in idx for k in range(3)]
            lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts))); hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
            c = (lo + hi) / 2; wear = rows[idx[0]][13]
            item = {'mesh': mesh, 'at': [round(c.x, 2), round(c.y, 2), round(c.z, 2)], 'triangles': len(idx), 'wear': round(wear, 2)}
            ns = normals_of(rows, idx)
            # a quoin course: two faces at right angles, both outward, one course high, round one corner
            strong = [x for x in ns if x[1] > 0.02]
            pair = next(((a, b) for i, a in enumerate(strong) for b in strong[i + 1:] if abs(a[0].dot(b[0])) < 0.05 and (a[0] + b[0]).length > 1.3), None)
            if pair and 0.2 < hi.y - lo.y < 0.45 and (Vector((hi.x - lo.x, hi.z - lo.z))).length < 1.2 and lo.y > 0.3:
                (na, _), (nb, _) = sorted(pair, key=lambda x: math.atan2(x[0].z, x[0].x))
                if abs(math.atan2(na.z, na.x) - math.atan2(nb.z, nb.x)) > math.pi: na, nb = nb, na  # (the pair across the -x axis)
                wa, wb = wall_at(c, na, 0.6), wall_at(c, nb, 0.6)
                if wa and wb:
                    na, nb = wa[2], wb[2]
                    fa0 = Front(na * wa[0], Vector((-na.z, 0, na.x)), na, wa[1]); fb0 = Front(nb * wb[0], Vector((-nb.z, 0, nb.x)), nb, wb[1])
                    corner = plane_corner(fa0, fb0)
                    key = (round(corner.x * 20), round(corner.z * 20), round(na.x, 1), round(na.z, 1), round(nb.x, 1), round(nb.z, 1))
                    fa = Front(corner, -nb, na, wa[1]); fb = Front(corner, -na, nb, wb[1])
                    la = max(fa.local(p)[0] for p in pts); lb = max(fb.local(p)[0] for p in pts)
                    pr = max(max(fa.local(p)[2] for p in pts), max(fb.local(p)[2] for p in pts))
                    if 0.1 < la < 0.8 and 0.1 < lb < 0.8 and 0.03 < pr < 0.15:
                        quoin_groups.setdefault(key, (fa, fb, corner, []))[3].append((lo.y, hi.y, la, lb, pr, idx, wear))
                        continue
            # the piece's front: the area-weighted outward normal of its upright faces
            tot = sum((n * a for n, a in ns), Vector())
            n = None
            if tot.length > 1e-3: n = tot.normalized()
            elif ns:
                # a reveal: its sides cancel; its mouth lies in the wall it goes into
                side = ns[0][0]
                for cand in (Vector((side.z, 0, -side.x)), Vector((-side.z, 0, side.x))):
                    w = wall_at(c, cand, 0.4)
                    if w and -0.02 < max(p.dot(w[2]) for p in pts) - w[0] < 0.02 and min(p.dot(w[2]) for p in pts) - w[0] < -0.1: n = cand; break
            if n is None: report['kept'].append(dict(item, kind='no front')); continue
            w = wall_at(c, n, 0.45)
            if not w and abs(abs(n.x) - abs(n.z)) > 0.3:
                cand = Vector((round(n.x), 0, round(n.z))).normalized(); w = wall_at(c, cand, 0.45)
            if not w: report['kept'].append(dict(item, kind='no wall')); continue
            fr = front_for(w[2], w[0], w[1]); s0, s1, y0, y1, d0, d1 = local_box(rows, idx, fr)
            wd, h = s1 - s0, y1 - y0
            item.update(box=[round(x, 3) for x in (s0, s1, y0, y1, d0, d1)], layer=w[1], n=[round(fr.n.x, 3), round(fr.n.z, 3)])
            CUR['wear'] = wear
            kind = None
            if abs(y0 - 0.12) < 0.05 and 0.3 < h < 0.45 and -0.02 < d0 and d1 < 0.08 and wd > 0.15:
                plinths.append((fr, s0, s1, y0, y1, d1, mesh, idx, wear)); kind = 'plinth'
            elif 0.12 < h < 0.19 and 0.08 < d1 < 0.12 and wd > 0.6 and d0 > -0.02:
                sill(fr, s0, s1, y0, y1, d1); kind = 'window sill'
            elif 0.15 < h < 0.25 and 0.06 < d1 < 0.09 and wd > 0.6 and d0 > -0.02:
                dressed_block(fr, s0 + 0.004, s1 - 0.004, y0, y1, -0.012, d1, 'window head', under=True, arris=0.007); kind = 'window head'
                heads.append((fr, s0, s1, y0))
            elif 0.12 < wd < 0.2 and 0.22 < h < 0.38 and 0.11 < d1 < 0.15 and d0 > -0.02:
                keystone(fr, s0, s1, y0, y1, d1); kind = 'keystone'
            elif 0.12 < h < 0.16 and 0.06 < d1 < 0.09 and wd > 0.6 and d0 > -0.02:
                dressed_block(fr, s0, s1, y0, y1, -0.012, d1, 'frieze', under=True, arris=0.006, margin=False); kind = 'frieze'
            elif 0.08 < h < 0.12 and 0.13 < d1 < 0.17 and wd > 0.6 and d0 > -0.02 and y0 > 1.0:
                hood(fr, s0, s1, y0, y1, d1); kind = 'hood'
            elif 0.15 < wd < 0.45 and 0.25 < h < 0.4 and 0.06 < d1 < 0.1 and d0 > -0.02 and y0 > 0.3:
                # half of a quoin course whose two halves were made as separate boxes: paired below
                singles.append((fr, s0, s1, y0, y1, d1, idx, wear, pts)); continue
            elif d0 < -0.15 and h > 2.0 and wd < 1.9 and 0.05 < d1 < 0.1 and y0 < 0.05:
                ys_front = {round(fr.local(Vector(rows[i + k][:3]))[1], 2) for i in idx for k in range(3) if abs(fr.local(Vector(rows[i + k][:3]))[2] - d1) < 1e-3}
                if len(ys_front) <= 6: door(fr, rows, idx); kind = 'door surround'
            elif -0.25 < d0 < -0.15 and abs(d1) < 0.01 and 1.4 < h < 2.8 and 1.0 < wd < 2.8 and y0 > 0.4:
                shops.append((fr, s0, s1, y0, y1, mesh, wear)); report['kept'].append(dict(item, kind='shop window reveal')); continue
            elif d0 < -0.15 and h < 0.25 and y0 < 0.05 and wd < 1.8 and d1 < 0.15:
                step(fr, s0, s1, y0, y1, d0, d1); kind = 'door step'
            elif 0.25 < h < 0.35 and 0.07 < d1 < 0.11 and y0 > 2.0 and d0 > -0.02:
                lintel(fr, s0, s1, y0, y1, d1); kind = 'door lintel'
            elif h < 0.1 and 0.15 < d1 < 0.2 and y0 > 2.0 and d0 > -0.02:
                hood(fr, s0, s1, y0, y1, d1); kind = 'door hood'
            if kind is None: report['kept'].append(dict(item, kind='unclassified')); continue
            if kind == 'plinth': continue  # (built, taken and reported with its corner below)
            take(mesh, idx); item['kind'] = kind; report['items'].append(item)
        # the halves of one course meet at a corner: one L stone round it, as on the welded corners
        used = set()
        for i, (fr, s0, s1, y0, y1, d1, idx, wear, pts) in enumerate(singles):
            if i in used: continue
            for j in range(i + 1, len(singles)):
                fr2, t0, t1, z0, z1, e1, idx2, wear2, pts2 = singles[j]
                if j in used or abs(fr.n.dot(fr2.n)) > 0.05 or abs(y0 - z0) > 0.02 or abs(y1 - z1) > 0.02: continue
                corner = plane_corner(fr, fr2); sc, tc = fr.local(corner)[0], fr2.local(corner)[0]
                if not (s0 - 0.12 < sc < s1 + 0.12 and t0 - 0.12 < tc < t1 + 0.12): continue
                # A's face runs away from the corner, opposite B's outward normal, and the other way round
                fa = Front(corner, -fr2.n, fr.n, fr.layer); fb = Front(corner, -fr.n, fr2.n, fr2.layer)
                both = pts + pts2
                la = max(fa.local(p)[0] for p in both); lb = max(fb.local(p)[0] for p in both)
                pr = max(max(fa.local(p)[2] for p in both), max(fb.local(p)[2] for p in both))
                if not (0.1 < la < 0.8 and 0.1 < lb < 0.8): continue
                key = (round(corner.x * 20), round(corner.z * 20), round(fa.n.x, 1), round(fa.n.z, 1), round(fb.n.x, 1), round(fb.n.z, 1))
                alt = (key[0], key[1], key[4], key[5], key[2], key[3])
                if alt in quoin_groups:  # (the same corner seen the other way round)
                    fa, fb = fb, fa; la, lb = lb, la; key = alt
                quoin_groups.setdefault(key, (fa, fb, corner, []))[3].append((min(y0, z0), max(y1, z1), la, lb, pr, idx + idx2, wear))
                used.update((i, j)); break
        for i, (fr, s0, s1, y0, y1, d1, idx, wear, pts) in enumerate(singles):
            if i in used: continue
            # a quoin whose other face is no front: one dressed stone on the brick beds
            CUR['wear'] = wear; a0, a1 = fr.bed(y0) + 0.005, fr.bed(y1 + 0.02) - 0.005
            if not 0.15 < a1 - a0 < 0.5: a0, a1 = y0, y1
            dressed_block(fr, s0, s1, a0, a1, -0.012, d1, 'quoin', arris=0.009, chip=2); take(mesh, idx)
            report['items'].append({'mesh': mesh, 'kind': 'single quoin', 'at': [round(x, 2) for x in fr.world((s0 + s1) / 2, y0, 0)], 'n': [round(fr.n.x, 3), round(fr.n.z, 3)]})
        for fa, fb, corner, courses in quoin_groups.values():
            corners.append(corner); quoin_corner(fa, fb, corner, courses, mesh)
    # plinths: at an outer corner one front's stone wraps round it and the other's butts against it
    ends = {}
    for k, (fr, s0, s1, *_a) in enumerate(plinths):
        for j, (fr2, t0, t1, *_b) in enumerate(plinths):
            if j <= k or k in ends or j in ends or abs(fr.n.dot(fr2.n)) > 0.05 or (fr.n + fr2.n).length < 1.3: continue
            corner = plane_corner(fr, fr2); sc, tc = fr.local(corner)[0], fr2.local(corner)[0]
            if min(abs(s0 - sc), abs(s1 - sc)) < 0.15 and min(abs(t0 - tc), abs(t1 - tc)) < 0.15 and abs(corner.x - (fr.world(sc, 0, 0)).x) < 0.01:
                ends[k] = ('wrap', sc, 0 if abs(s0 - sc) < abs(s1 - sc) else 1); ends[j] = ('butt', tc, 0 if abs(t0 - tc) < abs(t1 - tc) else 1)
    for k, (fr, s0, s1, y0, y1, d1, mesh, idx, wear) in enumerate(plinths):
        GROUP[0] = mesh; CUR['wear'] = wear
        if k in ends:
            mode, sc, which = ends[k]
            if which == 0: s0 = sc - (d1 if mode == 'wrap' else 0.0)
            else: s1 = sc + (d1 if mode == 'wrap' else 0.0)
        plinth(fr, s0, s1, y0, y1, d1); take(mesh, idx)
        report['items'].append({'mesh': mesh, 'kind': 'plinth', 'corner': ends.get(k, [None])[0]})
    # a shop window's painted surround gets a stone architrave, unless it already has a stone head
    for fr, s0, s1, y0, y1, mesh, wear in shops:
        if any(h[0].n.dot(fr.n) > 0.999 and abs(h[0].a.dot(fr.n) - fr.a.dot(fr.n)) < 0.05 and fr.local(h[0].world(h[1], 0, 0))[0] < s1 and fr.local(h[0].world(h[2], 0, 0))[0] > s0 and 0 < h[3] - y1 < 0.4 for h in heads): continue
        GROUP[0] = mesh; CUR['wear'] = wear
        shop_surround(fr, s0, s1, y0, y1)
        report['items'].append({'kind': 'shop architrave', 'at': [round(x, 2) for x in fr.world((s0 + s1) / 2, y0, 0)]})

classify_and_build()

# ---------------------------------------------------------------- rows for the game
for p in pieces: bmesh.ops.triangulate(p.bm, faces=p.bm.faces[:]); p.bm.normal_update(); p.bm.verts.index_update()
# occluders for the bake: the new stone, the walls and the stone that stays (pavement aprons, cornices, steps)
verts, polys = [], []
for p in pieces:
    base = len(verts); verts += [v.co.copy() for v in p.bm.verts]
    polys += [[base + v.index for v in f.verts] for f in p.bm.faces]
for a, b, c in wall_tris:
    base = len(verts); verts += [a, b, c]; polys.append([base, base + 1, base + 2])
for mesh, s in stone_meshes:
    rows = load(s['file']); gone = removed.get(mesh, set())
    for i in range(0, len(rows), 3):
        if i in gone: continue
        base = len(verts); verts += [Vector(rows[i + k][:3]) for k in range(3)]; polys.append([base, base + 1, base + 2])
tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
golden = math.pi * (3 - math.sqrt(5))
dirs = [(lambda y, i: Vector((math.cos(golden * i) * math.sqrt(1 - y * y), y, math.sin(golden * i) * math.sqrt(1 - y * y))))(1 - 2 * (i + 0.5) / 64, i) for i in range(64)]
cache = {}
def occlusion(co, n):
    """(how open the point is to the sky's light within 0.3 m, how open it is to the falling rain within 2.5 m)"""
    key = (round(co.x, 3), round(co.y, 3), round(co.z, 3), round(n.x, 1), round(n.y, 1), round(n.z, 1))
    if key in cache: return cache[key]
    o = co + n * 0.002; hit = tot = 0.0; rain = raintot = 0
    for d in dirs:
        c = d.dot(n)
        if c <= 0.05: continue
        tot += c
        # (the mason's 3 mm steps are not shade: only what stands more than 8 mm off counts)
        at = tree.ray_cast(o, d, 0.30)
        if at[0] is not None and at[3] > 0.008: hit += c
        if d.y > 0.64:  # rain falling within 50 degrees of the vertical
            raintot += 1
            if tree.ray_cast(o, d, 2.5)[0] is None: rain += 1
    res = (1 - hit / max(tot, 1e-6), rain / raintot if raintot else 0.0)
    cache[key] = res; return res

def bake_rows(group):
    """Triangles in the wall-circuit row format: normals rounded on the bevels only, metric UVs (1.2 m picture),
    the face code and the stone's dice in UV2, sky light in COLOR.rgb, the house's wear in COLOR.a, rain in CUSTOM0.x."""
    rows = []
    for p in (p for p in pieces if p.group == group):
        bm = p.bm
        def loop_normal(f, v):
            """Flat on the stone's faces, rounded across a bevel's facets (and onto the faces they join)."""
            if not f[p.bev]: return f.normal.copy()
            acc = Vector()
            for g in v.link_faces:
                if g.normal.dot(f.normal) > math.cos(math.radians(50)): acc += g.normal * g.calc_area()
            return acc.normalized() if acc.length > 1e-12 else f.normal.copy()
        ou, ov = p.rand * 0.731, p.rand2 * 0.613
        for f in bm.faces:
            n = f.normal; code = f[p.code]
            if p.kind == 'mortar': code = code if code in (5, 15) else 5
            elif p.blue: code += 10
            tri = []
            for v in f.verts:
                co, nn = v.co, loop_normal(f, v)
                if abs(n.y) > 0.7: u, v = co.x / 1.2, co.z / 1.2
                else:
                    across = Vector((n.z, 0, -n.x)).normalized(); u, v = co.dot(across) / 1.2, -co.y / 1.2
                ao, rain = occlusion(co, nn)
                tri.append([co.x, co.y, co.z, nn.x, nn.y, nn.z, u + ou, v + ov, float(code), p.rand, ao, ao, ao, p.wear, rain, p.rand2])
            # Godot's front faces wind clockwise: (p2 - p0) x (p1 - p0) along the face normal
            if (Vector(tri[2][:3]) - Vector(tri[0][:3])).cross(Vector(tri[1][:3]) - Vector(tri[0][:3])).dot(n) < 0: tri[1], tri[2] = tri[2], tri[1]
            # integer tile offsets keep the picture's phase and the small faces' UVs precise
            off = [math.floor(sum(r[6] for r in tri) / 3), math.floor(sum(r[7] for r in tri) / 3)]
            for r in tri: r[6] -= off[0]; r[7] -= off[1]
            rows += tri
    return rows

new_rows = {mesh: bake_rows(mesh) for mesh, _ in stone_meshes}

# ---------------------------------------------------------------- the manifest: whole meshes, old stone removed
manifest = {}
for rec in records:
    mesh = pathlib.Path(rec['mesh']).stem
    touched = mesh in new_rows or any(s['material'] == DECAL for s in rec['surfaces'])
    if not touched: continue
    surfaces = []
    for s in rec['surfaces']:
        rows = load(s['file'])
        gone = removed.get(mesh, set()) if s['material'] == STONE else set()
        if s['material'] == DECAL:
            # the flat grime strips glued down a wall corner, now inside or beside the new quoins
            def corner_strip(tri):
                c = sum((Vector(r[:3]) for r in tri), Vector()) / 3
                return min(r[1] for r in tri) < 0.05 and max(r[1] for r in tri) > 2.0 and any((Vector((c.x, 0, c.z)) - k).length < 0.6 for k in corners)
            gone = {i for i in range(0, len(rows), 3) if corner_strip(rows[i:i + 3])}
        if not gone and s['material'] == DECAL: surfaces = None; break
        kept = [r for i in range(0, len(rows), 3) if i not in gone for r in rows[i:i + 3]]
        name = f'{mesh}-{s["index"]}.bin'; write(name, kept)
        surfaces.append({'file': name, 'material': s['material'], 'custom0': s['custom0'], 'vertices': len(kept)})
        report['removedTriangles'][mesh] = report['removedTriangles'].get(mesh, 0) + len(gone)
    if surfaces is None: continue
    entry = {'surfaces': surfaces, 'sourceHash': rec['meshHash'], 'node': rec['node']}
    if new_rows.get(mesh):
        write(f'{mesh}-dressed.bin', new_rows[mesh])
        surfaces.append({'file': f'{mesh}-dressed.bin', 'material': DRESSED, 'custom0': True, 'vertices': len(new_rows[mesh])})
        report['addedTriangles'][mesh] = len(new_rows[mesh]) // 3
        # collision keeps the simple boxes the dressed stones replaced (Solid: native_solid_skip / native_solid_stand_in)
        old = load(next(s['file'] for r2, s in surfaces_of(STONE) if pathlib.Path(r2['mesh']).stem == mesh))
        stand = array.array('f', (x for i in sorted(removed.get(mesh, ())) for k in range(3) for x in old[i + k][:3]))
        (out_dir / f'{mesh}-standin.bin').write_bytes(stand.tobytes())
        entry.update(standIn=f'{mesh}-standin.bin', skipSurface=len(surfaces) - 1)
    manifest[rec['mesh']] = entry
(out_dir / f'manifest-{chunk}.json').write_text(json.dumps(manifest, indent=1))
from collections import Counter
summary = {'chunk': chunk, 'built': dict(Counter(i.get('kind') for i in report['items'])), 'kept': dict(Counter(i.get('kind') for i in report['kept'])),
           'added': report['addedTriangles'], 'removed': report['removedTriangles']}
report['summary'] = summary
(out_dir / f'report-{chunk}.json').write_text(json.dumps(report, indent=1))
print('Stone corners candidate:', json.dumps(summary))
