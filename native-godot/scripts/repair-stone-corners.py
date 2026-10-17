"""Issue #157: dressed corner stones, door and window surrounds and plinths for one town house.
Run with Blender:  blender -b -P scripts/repair-stone-corners.py -- <audit folder> <house spec json> <candidate folder>
Input is the world-space export of audit-stone-corners.gd (16 floats per vertex). Output is a review candidate in
the wall-circuit format (manifest.json + .bin rows); the game builds it in memory (NativeStoneCornersProof).
Scene nodes, transforms, permanent ids and every other triangle stay as they are; only the house's old stone boxes
are replaced. Stone joints sit on the house's brick bed joints.
"""
import array, hashlib, json, math, pathlib, random, sys
import bmesh
from mathutils import Vector
from mathutils.bvhtree import BVHTree

args = sys.argv[sys.argv.index('--') + 1:]
audit_dir, spec_path, out_dir = pathlib.Path(args[0]), pathlib.Path(args[1]), pathlib.Path(args[2])
out_dir.mkdir(parents=True, exist_ok=True)
spec = json.loads(spec_path.read_text())
audit = json.loads((audit_dir / 'audit.json').read_text())
UP = Vector((0, 1, 0))
DRESSED = 'candidate:dressed_stone'
report = {'house': spec['house'], 'items': [], 'kept': [], 'removedTriangles': {}, 'addedTriangles': {}}

# ---------------------------------------------------------------- the house's frame
class Front:
    def __init__(self, f):
        self.name = f['name']; a = Vector((f['a'][0], 0, f['a'][1])); b = Vector((f['b'][0], 0, f['b'][1]))
        self.a, self.length = a, (b - a).length
        self.t = (b - a).normalized(); self.n = Vector((f['out'][0], 0, f['out'][1])).normalized()
    def world(self, s, y, d): return self.a + self.t * s + UP * y + self.n * d
    def local(self, p): q = p - self.a; return q.dot(self.t), p.y, q.dot(self.n)
fronts = [Front(f) for f in spec['fronts']]
corner = Vector((spec['corner'][0], 0, spec['corner'][1]))
bed0, course = spec['brickBed'], spec['brickCourse']
def bed(y): return bed0 + round((y - bed0) / course) * course  # nearest brick bed joint
house_wear = spec.get('wear', 0.26)

# ---------------------------------------------------------------- rows in and out
def load(name):
    a = array.array('f'); a.frombytes((audit_dir / 'source' / name).read_bytes())
    return [list(a[i:i + 16]) for i in range(0, len(a), 16)]
def write(name, rows):
    (out_dir / name).write_bytes(array.array('f', (x for r in rows for x in r)).tobytes())

# ---------------------------------------------------------------- geometry kit
rng = random.Random(spec.get('seed', 1873))
GROUP = ['r000380']  # the mesh the next pieces go to: the near-only detail, or the base mesh for the door
class Piece:
    """One stone being built: a bmesh in world space and the face codes the shader reads (UV2.x)."""
    def __init__(self, kind, blue=False):
        self.bm = bmesh.new(); self.kind = kind; self.blue = blue; self.rand = rng.random(); self.rand2 = rng.random(); self.group = GROUP[0]
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
    """Broken arrises: a few corners knocked in, never the same on two stones."""
    verts = [v for v in p.bm.verts if len(v.link_faces) >= 3 and not any(f in p.hidden for f in v.link_faces)]
    if not verts: return
    for _ in range(count):
        c = rng.choice(verts).co.copy(); r = rng.uniform(*size)
        inward = sum((f.normal for f in p.bm.faces if not f in p.hidden and (f.calc_center_median() - c).length < 0.2), Vector()).normalized()
        for v in p.bm.verts:
            dist = (v.co - c).length
            if dist < r: v.co -= inward * (r - dist) * 0.55

def finish(p, front_like=None):
    gone = list(p.hidden)
    if gone: bmesh.ops.delete(p.bm, geom=gone, context='FACES_ONLY')
    bmesh.ops.recalc_face_normals(p.bm, faces=p.bm.faces)

pieces = []

def dressed_block(front, s0, s1, y0, y1, d0, d1, kind, blue=False, arris=0.008, under=False, ends=True, top=True, margin=True, chip=2):
    p = Piece(kind, blue); f = box(p, front, s0, s1, y0, y1, d0, d1)
    p.hidden.add(f['back'])
    if not under: p.hidden.add(f['bottom'])
    if not ends: p.hidden.update((f['start'], f['end']))
    if not top: p.hidden.add(f['top'])
    for k, face in f.items(): face[p.code] = 4
    bevel(p, visible_edges(p, [f['front'], f['top'], f['bottom'], f['start'], f['end']]), arris * rng.uniform(0.8, 1.25))
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

# ---------------------------------------------------------------- find the house's old stone
def components(rows, keep):
    """Triangles near the house's fronts, welded within 1 mm and split into connected pieces."""
    parent = {}
    def F(a):
        while parent.setdefault(a, a) != a: a = parent[a]
        return a
    tris = [i for i in range(0, len(rows), 3) if keep(rows[i:i + 3])]
    key = lambda r: (round(r[0] * 1000), round(r[1] * 1000), round(r[2] * 1000))
    for i in tris:
        ks = [key(r) for r in rows[i:i + 3]]
        for k in ks[1:]: parent[F(k)] = F(ks[0])
    groups = {}
    for i in tris: groups.setdefault(F(key(rows[i])), []).append(i)
    return list(groups.values())

def near_house(tri):
    c = sum((Vector(r[:3]) for r in tri), Vector()) / 3
    x0, x1, z0, z1, ymax = spec['box']
    if not (x0 < c.x < x1 and z0 < c.z < z1 and c.y < ymax): return False
    return any(abs(fr.local(c)[2]) < 0.6 and -0.6 < fr.local(c)[0] < fr.length + 0.6 for fr in fronts)

def local_box(rows, idx, fr):
    pts = [fr.local(Vector(rows[i + k][:3])) for i in idx for k in range(3)]
    return [min(p[0] for p in pts), max(p[0] for p in pts), min(p[1] for p in pts), max(p[1] for p in pts), min(p[2] for p in pts), max(p[2] for p in pts)]

def front_of(rows, idx):
    """The front a piece lies on: the one whose plane it stays closest to (a reveal's sides face the other front)."""
    reach = {fr.name: max(abs(fr.local(Vector(rows[i + k][:3]))[2]) for i in idx for k in range(3)) for fr in fronts}
    best = min(reach, key=reach.get)
    return next(fr for fr in fronts if fr.name == best), reach

# ---------------------------------------------------------------- rebuild
removed = {}
def take(mesh, rows, idx): removed.setdefault(mesh, set()).update(idx)

def ell(la, lb, pr, e):
    """The plan of one quoin course: the arris, along B's face, into the wall, the inner corner, out along A's face."""
    fa, fb = fronts
    pts = [corner + fa.n * pr + fb.n * pr, corner + fb.t * lb + fb.n * pr, corner + fb.t * lb - fb.n * e,
           corner - fa.n * e - fb.n * e, corner + fa.t * la - fa.n * e, corner + fa.t * la + fa.n * pr]
    out = [(w.x, w.z) for w in pts]
    # counter-clockwise seen from above (+y): x right, z towards the viewer
    area = sum(out[i][0] * out[(i + 1) % 6][1] - out[(i + 1) % 6][0] * out[i][1] for i in range(6))
    return out if area < 0 else list(reversed(out))

def quoins(rows, mesh, groups):
    """The corner's courses: each an L of stone round the corner, long and short in turn, on the brick beds."""
    fa, fb = fronts  # A runs away from the corner along its t, B likewise (both start at the corner)
    courses = []
    for idx in groups:
        pts = [Vector(rows[i + k][:3]) for i in idx for k in range(3)]
        if max((p - Vector((corner.x, p.y, corner.z))).length for p in pts) > 0.75: continue
        y0 = min(p.y for p in pts); y1 = max(p.y for p in pts)
        if not (0.2 < y1 - y0 < 0.45) or y0 < 0.4: continue
        la = max(fa.local(p)[0] for p in pts); lb = max(fb.local(p)[0] for p in pts)
        pr = max(max(fa.local(p)[2] for p in pts), max(fb.local(p)[2] for p in pts))
        courses.append((y0, y1, la, lb, pr, idx))
    courses.sort()
    if not courses: return
    pitch = round((courses[1][0] - courses[0][0]) / course) * course if len(courses) > 1 else 6 * course
    yb = bed(courses[0][0]); joint = 0.010; e = 0.012
    for k, (y0, y1, la, lb, pr, idx) in enumerate(courses):
        take(mesh, rows, idx)
        c0 = yb + k * pitch + joint / 2; c1 = yb + (k + 1) * pitch - joint / 2
        p = Piece('quoin')
        sides, top, bottom = prism(p, ell(la, lb, pr, e), c0, c1, [])
        bm = p.bm
        def facing(nv): return max(sides, key=lambda f: f.normal.dot(nv))
        front_a, front_b = facing(fa.n), facing(fb.n)
        inner = [f for f in sides if f.normal.dot(fa.n) < -0.9 or f.normal.dot(fb.n) < -0.9]
        p.hidden.update(inner)
        for f in bm.faces: f[p.code] = 4
        bevel(p, visible_edges(p, sides + [top, bottom]), 0.009 * rng.uniform(0.8, 1.3))
        dress(p, fa.n.copy()); dress(p, fb.n.copy())
        # the lower courses at a street corner take the knocks of wheels and loads
        chips(p, 3 if c0 < 1.6 else 1, (0.008, 0.022) if c0 < 1.6 else (0.005, 0.012))
        finish(p); pieces.append(p)
        # the mortar bed over this course, set back from the stone faces
        if k + 1 < len(courses):
            m = Piece('mortar')
            ms, mt, mb = prism(m, ell(min(la, courses[k + 1][2]), min(lb, courses[k + 1][3]), pr - 0.008, e), c1 - 0.001, c1 + joint + 0.001, [])
            m.hidden.update([mt, mb] + [f for f in ms if f.normal.dot(fa.n) < -0.9 or f.normal.dot(fb.n) < -0.9])
            for f in m.bm.faces: f[m.code] = 5
            finish(m); pieces.append(m)
    report['items'].append({'kind': 'quoin courses', 'count': len(courses), 'pitchMetres': pitch, 'firstBed': yb})

def classify_and_build():
    for mesh in ('r000377', 'r000380'):
        GROUP[0] = mesh
        rows = load(mesh + '-0.bin'); groups = components(rows, near_house)
        report['mesh_' + mesh] = len(groups)
        quoins(rows, mesh, groups) if mesh == 'r000380' else None
        for idx in groups:
            if mesh in removed and idx[0] in removed[mesh]: continue
            fr, score = front_of(rows, idx); s0, s1, y0, y1, d0, d1 = local_box(rows, idx, fr)
            w, h, d = s1 - s0, y1 - y0, d1 - d0
            item = {'mesh': mesh, 'front': fr.name, 'box': [round(x, 3) for x in (s0, s1, y0, y1, d0, d1)], 'triangles': len(idx)}
            if mesh == 'r000380' and abs(y0 - 0.12) < 0.03 and 0.3 < h < 0.45 and d1 < 0.08:
                plinth(fr, s0, s1, y0, y1, d1); item['kind'] = 'plinth'
            elif mesh == 'r000380' and 0.12 < h < 0.18 and 0.08 < d1 < 0.12 and w > 0.8:
                sill(fr, s0, s1, y0, y1, d1); item['kind'] = 'window sill'
            elif mesh == 'r000380' and 0.15 < h < 0.25 and 0.06 < d1 < 0.09 and w > 0.8:
                dressed_block(fr, s0 + 0.004, s1 - 0.004, y0, y1, -0.012, d1, 'window head', under=True, arris=0.007); item['kind'] = 'window head'
            elif mesh == 'r000380' and 0.12 < w < 0.2 and 0.22 < h < 0.32 and 0.11 < d1 < 0.15:
                keystone(fr, s0, s1, y0, y1, d1); item['kind'] = 'keystone'
            elif mesh == 'r000377' and d0 < -0.15 and h > 2.0 and w < 1.8 and 0.05 < d1 < 0.09:
                door(fr, rows, idx); item['kind'] = 'door surround'
            elif mesh == 'r000377' and -0.25 < d0 < -0.15 and abs(d1) < 0.01 and 1.6 < h < 2.6 and 1.2 < w < 2.6 and y0 > 0.5:
                shop_surround(fr, s0, s1, y0, y1); report['kept'].append(dict(item, kind='shop window reveal (kept, architrave added)')); continue
            elif mesh == 'r000377' and d0 < -0.15 and h < 0.25 and y0 < 0.05 and w < 1.6 and d1 < 0.15:
                step(fr, s0, s1, y0, y1, d0, d1); item['kind'] = 'door step'
            elif mesh == 'r000377' and 0.25 < h < 0.35 and 0.07 < d1 < 0.1 and y0 > 2.0:
                lintel(fr, s0, s1, y0, y1, d1); item['kind'] = 'door lintel'
            elif mesh == 'r000377' and h < 0.1 and 0.15 < d1 < 0.2 and y0 > 2.0:
                hood(fr, s0, s1, y0, y1, d1); item['kind'] = 'door hood'
            else:
                report['kept'].append(item); continue
            take(mesh, rows, idx); report['items'].append(item)

def shop_surround(fr, s0, s1, y0, y1):
    """The stone architrave round a shop window, over the painted one: jambs, a head on the brick beds, a sill."""
    W, P = 0.14, 0.035
    sill_top = y0; head0 = y1
    profile_stone(fr, s0 - W - 0.05, s1 + W + 0.05, [(-0.012, sill_top - 0.12), (P + 0.03, sill_top - 0.12), (P + 0.036, sill_top - 0.114),
                  (P + 0.036, sill_top - 0.02), (P + 0.03, sill_top - 0.012), (0.0, sill_top), (-0.012, sill_top)], 'shop sill')
    for a, b in ((s0 - W, s0), (s1, s1 + W)):
        dressed_block(fr, a, b, sill_top + 0.004, head0 - 0.005, -0.03, P, 'shop jamb', arris=0.006, under=True, chip=1)
    dressed_block(fr, s0 - W - 0.02, s1 + W + 0.02, head0 + 0.005, bed(head0 + 0.19), -0.03, P + 0.008, 'shop head', under=True, arris=0.007)

def plinth(fr, s0, s1, y0, y1, d1):
    """Blue stone plinth blocks on the pavement, a weathered top that sheds the rain, joints every 0.6-0.9 m."""
    top = bed(y1)
    # the corner: the first front's stone wraps round it, the second's butts against it (the old pieces left a gap)
    if s0 < 0.1: s0 = -d1 if fr is fronts[0] else 0.0
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
    dressed_block(fr, s0, s1, y0, y1, -0.198, d1, 'door lintel', under=True, arris=0.009)

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
                v.co.y -= 0.006 * (u * u * (3 - 2 * u)) * w
    chips(p, 1, (0.006, 0.014)); finish(p); pieces.append(p)

def door(fr, rows, idx):
    """The jambs: through-stones (front and reveal), three a side on the brick beds, the arris worn at the hand."""
    fronts_at = sorted({round(fr.local(Vector(rows[i + k][:3]))[0], 3) for i in idx for k in range(3)})
    pts = [fr.local(Vector(rows[i + k][:3])) for i in idx for k in range(3)]
    s0, s1 = min(p[0] for p in pts), max(p[0] for p in pts); ys = max(p[1] for p in pts); P = max(p[2] for p in pts); R = -min(p[2] for p in pts)
    # the jambs' widths: the front faces at d = P
    xs = sorted({round(p[0], 3) for p in pts if abs(p[2] - P) < 1e-3})
    J = xs[1] - xs[0] if len(xs) >= 4 else 0.2
    beds = [0.0, bed(ys / 3), bed(2 * ys / 3), ys]
    for a, b in ((s0, s0 + J), (s1 - J, s1)):
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
                m = Piece('mortar'); g = box(m, fr, a + 0.003, b - 0.003, y1 - 0.0055, y1 + 0.0055, -R + 0.003, P - 0.004)
                m.hidden.update((g['back'], g['top'], g['bottom']))
                for face in g.values(): face[m.code] = 5
                finish(m); pieces.append(m)

classify_and_build()

# ---------------------------------------------------------------- rows for the game
for p in pieces: bmesh.ops.triangulate(p.bm, faces=p.bm.faces[:]); p.bm.normal_update(); p.bm.verts.index_update()
# occluders for the bake: every new stone, the wall planes and the pavement
verts, polys = [], []
for p in pieces:
    base = len(verts); verts += [v.co.copy() for v in p.bm.verts]
    polys += [[base + v.index for v in f.verts] for f in p.bm.faces]
for fr in fronts:
    base = len(verts); verts += [fr.world(-0.5, -0.1, -0.002), fr.world(fr.length + 0.5, -0.1, -0.002), fr.world(fr.length + 0.5, 12, -0.002), fr.world(-0.5, 12, -0.002)]
    polys.append([base, base + 1, base + 2, base + 3])
base = len(verts); x0, x1, z0, z1, _ = spec['box']
verts += [Vector((x0 - 3, 0.119, z0 - 3)), Vector((x1 + 3, 0.119, z0 - 3)), Vector((x1 + 3, 0.119, z1 + 3)), Vector((x0 - 3, 0.119, z1 + 3))]
polys.append([base, base + 1, base + 2, base + 3])
tree = BVHTree.FromPolygons(verts, polys, epsilon=0.0)
golden = math.pi * (3 - math.sqrt(5))
dirs = [(lambda y, i: Vector((math.cos(golden * i) * math.sqrt(1 - y * y), y, math.sin(golden * i) * math.sqrt(1 - y * y))))(1 - 2 * (i + 0.5) / 96, i) for i in range(96)]
cache = {}
def occlusion(co, n):
    """(how open the point is to the sky's light within 0.3 m, how open it is to the falling rain within 2.5 m)"""
    key = (round(co.x, 4), round(co.y, 4), round(co.z, 4), round(n.x, 2), round(n.y, 2), round(n.z, 2))
    if key in cache: return cache[key]
    o = co + n * 0.002; hit = tot = 0.0; rain = raintot = 0
    for d in dirs:
        c = d.dot(n)
        if c <= 0.05: continue
        tot += c
        # (the mason's 3 mm steps are not shade: only what stands more than 8 mm off counts)
        hit_at = tree.ray_cast(o, d, 0.30)
        if hit_at[0] is not None and hit_at[3] > 0.008: hit += c
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
        bm = p.bm; loop_normal = {}
        for f in bm.faces:
            for l in f.loops:
                if f[p.bev]:
                    acc = Vector()
                    for g in l.vert.link_faces:
                        if g.normal.dot(f.normal) > math.cos(math.radians(50)): acc += g.normal * g.calc_area()
                    loop_normal[l] = acc.normalized() if acc.length > 1e-12 else f.normal.copy()
                else: loop_normal[l] = f.normal.copy()
        ou, ov = p.rand * 0.731, p.rand2 * 0.613
        for f in bm.faces:
            n = f.normal; code = f[p.code]
            if p.kind == 'mortar': code = code if code in (5, 15) else 5
            elif p.blue: code += 10
            tri = []
            for l in f.loops:
                co, nn = l.vert.co, loop_normal[l]
                if abs(n.y) > 0.7: u, v = co.x / 1.2, co.z / 1.2
                else:
                    across = Vector((n.z, 0, -n.x)).normalized(); u, v = co.dot(across) / 1.2, -co.y / 1.2
                ao, rain = occlusion(co, nn)
                tri.append([co.x, co.y, co.z, nn.x, nn.y, nn.z, u + ou, v + ov, float(code), p.rand, ao, ao, ao, house_wear, rain, p.rand2])
            # Godot's front faces wind clockwise: (p2 - p0) x (p1 - p0) along the face normal
            if (Vector(tri[2][:3]) - Vector(tri[0][:3])).cross(Vector(tri[1][:3]) - Vector(tri[0][:3])).dot(n) < 0: tri[1], tri[2] = tri[2], tri[1]
            # integer tile offsets keep the picture's phase and the small faces' UVs precise
            off = [math.floor(sum(r[6] for r in tri) / 3), math.floor(sum(r[7] for r in tri) / 3)]
            for r in tri: r[6] -= off[0]; r[7] -= off[1]
            rows += tri
    return rows

new_rows = {g: bake_rows(g) for g in ('r000377', 'r000380')}

# ---------------------------------------------------------------- the manifest: whole meshes, old stone removed
manifest = {'materials': {DRESSED: {'base': 'res://world/town/resources/r000209.res', 'shader': 'res://assets/materials/stone-corners-20261017/dressed-stone.gdshader',
                                    'params': {'stone_tex': 'res://assets/materials/environment-20261013/stair-stone-texture.res'}}}}
for rec in audit:
    mesh = pathlib.Path(rec['mesh']).stem
    if mesh not in ('r000377', 'r000380', 'r000378'): continue
    surfaces = []
    for s in rec['surfaces']:
        rows = load(s['file'])
        gone = removed.get(mesh, set())
        if mesh == 'r000378':
            # the flat grime strips glued to the wall down the corner, behind the new quoins
            def corner_strip(tri):
                c = sum((Vector(r[:3]) for r in tri), Vector()) / 3; ymin = min(r[1] for r in tri)
                return (Vector((c.x, 0, c.z)) - corner).length < 0.6 and ymin < 0.05
            gone = {i for i in range(0, len(rows), 3) if corner_strip(rows[i:i + 3])}
            removed['r000378'] = gone
        kept = [r for i in range(0, len(rows), 3) if i not in gone for r in rows[i:i + 3]]
        name = f'{mesh}-{s["index"]}.bin'; write(name, kept)
        surfaces.append({'file': name, 'material': s['material'], 'custom0': s['custom0'], 'vertices': len(kept)})
        report['removedTriangles'][mesh] = len(gone)
    if mesh in new_rows:
        write(f'{mesh}-dressed.bin', new_rows[mesh])
        surfaces.append({'file': f'{mesh}-dressed.bin', 'material': DRESSED, 'custom0': True, 'vertices': len(new_rows[mesh])})
        report['addedTriangles'][mesh] = len(new_rows[mesh]) // 3
    manifest[rec['mesh']] = surfaces
manifest['sourceHashes'] = {rec['mesh']: rec['meshHash'] for rec in audit}
(out_dir / 'manifest.json').write_text(json.dumps(manifest, indent=1))
(out_dir / 'geometry-report.json').write_text(json.dumps(report, indent=1))
print('Stone corners candidate:', json.dumps({'items': len(report['items']), 'kept': len(report['kept']), 'added': report['addedTriangles'], 'removed': report['removedTriangles']}))
