"""Issue #157: dressed corner stones, door and window surrounds, sills, heads and plinths for the town's houses.
Run with Blender, one city chunk at a time:
  blender -b -P scripts/repair-stone-corners.py -- <audit folder> <chunk, e.g. city_-2_0> <brick beds json> <candidate folder> [x0 x1 z0 z1]
Input is the world-space export of audit-stone-corners.gd (16 floats per vertex). Output is a review candidate in the
wall-circuit format (manifest-<chunk>.json + .bin rows); the game builds it in memory (NativeStoneCornersProof) and
the promotion saves it. Scene nodes, transforms, permanent ids and every other triangle stay as they are: only the old
stone boxes are replaced. Each stone finds its wall in the brick or plaster face behind it; on brick its joints sit on
that wall's bed joints. The optional box limits the repair to one house (the first review: Steenplein 1).
Pass 2 (#173, #171, 2026-10-18): ground-floor quoins beside shop fronts (measured from the stone's own face when its
middle lies nearer the shop window's reveal), and the rest of the stone: bands, cornices, heads and sills cut into stones
with joints, pilasters and strips in courses on the beds, mullions as long stones, arched heads as voussoirs, panels
and fanlight bars as single bevelled stones; every other stone piece keeps its shape on the dressed stone with its
sharp arrises chamfered (pavement aprons stay on the old stone). Each new stone keeps its old stone's colour.
STONE_157_ONLY=1 builds the first pass only.
"""
import array, hashlib, json, math, os, pathlib, random, sys
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
# the house's own stone colour (#171): the old stone's vertex colour, kept on the new stone relative to the town's common
# sandstone (the dressed shader's light stone); TINT by (mesh, first triangle) for the pieces built after the loop
REF_TINT = (1.0, 1.0, 1.0)
TINT = {}
def tint_of(rows, idx):
    cols = sorted((tuple(rows[i + k][10:13]) for i in idx for k in range(3)), key=lambda c: c[0] + c[1] + c[2])
    return cols[int(len(cols) * 0.8)] if cols else REF_TINT
# #171: also dress the stone #157 left as it was (bands, cornices, pilasters, arched heads, panels); STONE_157_ONLY=1: not
DRESS_REST = os.environ.get('STONE_157_ONLY') != '1'

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
        self.group = GROUP[0]; self.wear = CUR['wear']; self.tint = CUR.get('tint', REF_TINT)
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
    # above 3 m a 3 mm step cannot be seen from the street: the shader's tooling carries it there
    if min(v.co.y for v in face.verts) > 3.0: face[p.code] = 1; return
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

def arch_stone(fr, poly, d0, d1, kind, arris=0.008, chip=1):
    """A stone whose face is a polygon [(s, y)] in the wall, run from d0 (in the reveal) to d1 (its face)."""
    p = Piece(kind); bm = p.bm
    front = [bm.verts.new(fr.world(s, y, d1)) for s, y in poly]; back = [bm.verts.new(fr.world(s, y, d0)) for s, y in poly]
    n = len(poly); sides = []
    for i in range(n):
        j = (i + 1) % n; f = bm.faces.new([front[i], front[j], back[j], back[i]]); f[p.code] = 4; sides.append(f)
    ff = bm.faces.new(front); fb = bm.faces.new(list(reversed(back))); ff[p.code] = fb[p.code] = 4
    bmesh.ops.recalc_face_normals(bm, faces=sides + [ff, fb])
    p.hidden.add(fb)
    bevel(p, visible_edges(p, [ff] + sides), arris * rng.uniform(0.8, 1.25), 2 if min(y for _, y in poly) < 2.2 else 1)
    dress(p, fr.n.copy())
    chips(p, chip)
    finish(p); pieces.append(p); return p

def circle_fit(pts):
    """Least-squares circle through points [(s, y)]: centre and radius."""
    import numpy as np
    A = np.array([[2 * s, 2 * y, 1.0] for s, y in pts]); bb = np.array([s * s + y * y for s, y in pts])
    (cx, cy, k), *_ = np.linalg.lstsq(A, bb, rcond=None)
    return cx, cy, math.sqrt(max(k + cx * cx + cy * cy, 1e-9))

def mortar_ring(fr, cx, cy, r0, r1, j0, j1, d0, d1):
    """The mortar of one radial joint of an arch, set back from the stone faces."""
    ring = [(cx + r0 * math.cos(j0), cy + r0 * math.sin(j0)), (cx + r0 * math.cos(j1), cy + r0 * math.sin(j1)),
            (cx + r1 * math.cos(j1), cy + r1 * math.sin(j1)), (cx + r1 * math.cos(j0), cy + r1 * math.sin(j0))]
    m = Piece('mortar'); bm = m.bm
    fv = [bm.verts.new(fr.world(s, y, d1)) for s, y in ring]; bv = [bm.verts.new(fr.world(s, y, d0)) for s, y in ring]
    fs = [bm.faces.new([fv[q], fv[(q + 1) % 4], bv[(q + 1) % 4], bv[q]]) for q in range(4)] + [bm.faces.new(fv), bm.faces.new(list(reversed(bv)))]
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    for f in bm.faces: f[m.code] = 5
    m.hidden.add(fs[-1]); finish(m); pieces.append(m)

def door(fr, rows, idx):
    """A door's surround, flat or arched, single or double, or a coach gate's: jambs of through-stones (front and
    reveal) on the brick beds, worn at the hand; over a flat door the lintel (a stone of its own), over an arched one
    a ring of voussoirs that follows the curve, its soffit through the reveal, a key at the crown if there was one."""
    pts = [fr.local(Vector(rows[i + k][:3])) for i in idx for k in range(3)]
    s0, s1 = min(p[0] for p in pts), max(p[0] for p in pts); R = -min(p[2] for p in pts)
    # the surround's face: the proud plane most of its points lie in, within 5 mm (a key stands further out)
    proud = [p[2] for p in pts if p[2] > 0.03]
    P = max(proud, key=lambda d: sum(1 for e in proud if abs(e - d) < 0.005))
    P = sum(e for e in proud if abs(e - P) < 0.005) / sum(1 for e in proud if abs(e - P) < 0.005)
    # the opening's own edges: the reveal's back corners low down; each jamb runs from the surround's edge to them
    low = [p[0] for p in pts if abs(p[2] + R) < 0.006 and p[1] < 1.0]
    o0, o1 = (min(low), max(low)) if len(low) >= 2 else (s0 + 0.2, s1 - 0.2)
    JL, JR = o0 - s0, s1 - o1
    if not (0.08 < JL < 0.5 and 0.08 < JR < 0.5): JL = JR = 0.2; o0, o1 = s0 + 0.2, s1 - 0.2
    J = (JL + JR) / 2
    # the opening's back edge: level over a flat door, a curve over an arched one
    inner = [(p[0], p[1]) for p in pts if abs(p[2] + R) < 0.006 and o0 + 0.01 < p[0] < o1 - 0.01 and p[1] > 1.2]
    ys_flat = max((p[1] for p in pts if abs(p[0] - o0) < 0.006 and abs(p[2] + R) < 0.006), default=max(p[1] for p in pts))
    arched = len(inner) >= 3 and max(y for _, y in inner) - min(y for _, y in inner) > 0.05
    if arched:
        cx, cy, rin = circle_fit(inner)
        dx = o0 - cx
        spring = cy + math.sqrt(max(rin * rin - dx * dx, 0.0))
        rout = rin + J
        ys = spring
    else:
        ys = ys_flat
    beds = [0.0] + [fr.bed(ys * k / 3) for k in (1, 2)] + [ys]
    # the inner faces stand 3 mm into the opening: the game's own doorway pieces lie in the old reveal's plane
    for a, b in ((s0, o0 + 0.003), (o1 - 0.003, s1)):
        inner_left = a > s0 + 1e-3
        for k, (y0, y1) in enumerate(zip(beds, beds[1:])):
            top = y1 - (0.005 if k < 2 or arched else 0)
            p = dressed_block(fr, a, b, y0 + (0.005 if k else 0), top, -R, P, 'door jamb', arris=0.009, top=True, under=k > 0, chip=1)
            # hands and shoulders have rounded the arris by the opening between 0.8 and 1.7 m
            edge_s = a if inner_left else b
            for v in p.bm.verts:
                s, y, d = fr.local(v.co)
                if 0.8 < y < 1.7 and abs(s - edge_s) < 0.03 and d > P - 0.03:
                    k2 = math.sin(math.pi * (y - 0.8) / 0.9) * (1 - abs(s - edge_s) / 0.03) * (1 - (P - d) / 0.03)
                    v.co -= fr.n * 0.004 * k2
            if k < 2 or arched:
                m = Piece('mortar'); g = box(m, fr, a + 0.001, b - 0.001, y1 - 0.0055, y1 + 0.0055, -R + 0.003, P - 0.004)  # (in front of the old reveal plane)
                m.hidden.update((g['back'], g['top'], g['bottom']))
                for face in g.values(): face[m.code] = 5
                finish(m); pieces.append(m)
    if not arched: return 'flat'
    # the ring: an odd number of voussoirs, each about a quarter metre round the middle of the ring, radial joints
    t0 = math.atan2(spring - cy, o0 - cx); t1 = math.atan2(spring - cy, o1 - cx)
    if t0 < t1: t0 += 2 * math.pi
    span = t0 - t1; rmid = (rin + rout) / 2
    count = max(5, int(round(span * rmid / 0.26)) | 1)
    half = 0.005 / rmid
    ri = rin - 0.003
    # a segmental arch springs from skewbacks: the jamb's top stone cut to the ring's first radial joint
    for side, t, sj, so in ((0, t0, o0 + 0.003, s0), (1, t1, o1 - 0.003, s1)):
        ox, oy = cx + rout * math.cos(t), cy + rout * math.sin(t)
        ix, iy = cx + ri * math.cos(t), cy + ri * math.sin(t)
        if oy - spring < 0.02: continue
        # (the inner corner is the jamb's own: the ring springs from there)
        poly = [(so, spring + 0.005), (sj, spring + 0.005), (ox, oy), (so, oy)]
        arch_stone(fr, poly, -R, P, 'skewback')
    for i in range(count):
        a0 = t0 - span * i / count - (half if i else 0); a1 = t0 - span * (i + 1) / count + (half if i < count - 1 else 0)
        steps = 3
        arc_in = [(cx + ri * math.cos(a0 + (a1 - a0) * k / steps), cy + ri * math.sin(a0 + (a1 - a0) * k / steps)) for k in range(steps + 1)]
        arc_out = [(cx + rout * math.cos(a1 - (a1 - a0) * k / steps), cy + rout * math.sin(a1 - (a1 - a0) * k / steps)) for k in range(steps + 1)]
        arch_stone(fr, arc_in + arc_out, -R, P, 'voussoir')
        if i < count - 1:
            # (flush with the soffit, a hair behind the stones' faces: a fine joint, not a bright streak)
            mortar_ring(fr, cx, cy, ri + 0.0015, rout - 0.004, a1 - half, a1 + half, -R + 0.003, P - 0.004)
    # the key at the crown, where the old surround had one
    key = [p for p in pts if p[2] > P + 0.03]
    if key:
        k0, k1 = min(p[0] for p in key), max(p[0] for p in key); ky0, ky1 = min(p[1] for p in key), max(p[1] for p in key); kd = max(p[2] for p in key)
        kp = dressed_block(fr, k0, k1, ky0, ky1, -0.012, kd, 'keystone', under=True, arris=0.006)
        mid = (k0 + k1) / 2
        for v in kp.bm.verts:
            s, y, d = fr.local(v.co); q = (y - ky0) / max(ky1 - ky0, 1e-6)
            v.co = fr.world(mid + (s - mid) * (0.86 + 0.24 * q), y, d)
    return 'arched'

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
        take(mesh, idx); CUR['wear'] = wear; CUR['tint'] = TINT.get((mesh, idx[0]), REF_TINT)
        # (each course to the next one's bed: a ground floor's courses beside a shop front can be set closer, #173)
        pitch = courses[k + 1][0] - y0 if k + 1 < len(courses) and 0.12 < courses[k + 1][0] - y0 < 0.6 else pitch_raw
        c0 = fa.bed(y0) + joint / 2; c1 = fa.bed(y0 + pitch) - joint / 2
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

# ---------------------------------------------------------------- #171: the rest of the stone, by its section
def section_loop(tris, axis, tol=0.0015):
    """If a piece is a prism along one axis of its front (0 s, 1 y, 2 d: every vertex at one of its two ends), its
    section as an ordered loop of points in the other two axes, its ends, and whether the loop is open (a face left out
    against the wall). None when it is no prism, or its section is no single loop."""
    vals = [p[axis] for t in tris for p in t]
    a0, a1 = min(vals), max(vals)
    if a1 - a0 < 0.01 or any(min(abs(v - a0), abs(v - a1)) > tol for v in vals): return None
    o = [k for k in range(3) if k != axis]
    key = lambda p: (round(p[o[0]] * 1000), round(p[o[1]] * 1000))
    adj = {}
    for t in tris:
        lo = [p for p in t if abs(p[axis] - a0) <= tol]
        if len(lo) != 2: continue
        ka, kb = key(lo[0]), key(lo[1])
        if ka == kb or kb in adj.get(ka, ()): continue
        adj.setdefault(ka, []).append(kb); adj.setdefault(kb, []).append(ka)
    if len(adj) < 3 or any(len(v) > 2 for v in adj.values()): return None
    ends = [k for k, v in adj.items() if len(v) == 1]
    if len(ends) not in (0, 2): return None
    start = ends[0] if ends else min(adj)
    loop, prev, cur = [start], None, start
    while True:
        nxt = [k for k in adj[cur] if k != prev]
        if not nxt or nxt[0] == start: break
        prev, cur = cur, nxt[0]; loop.append(cur)
    if len(loop) != len(adj): return None
    return [(k[0] / 1000, k[1] / 1000) for k in loop], (a0, a1), bool(ends)

def simplify(loop, closed):
    """Drop points on a straight run (the old meshes split faces at windows and joints)."""
    out = list(loop)
    changed = True
    while changed and len(out) > 3:
        changed = False
        n = len(out)
        for i in range(n):
            if not closed and (i == 0 or i == n - 1): continue
            a, b, c = Vector(out[i - 1]), Vector(out[i]), Vector(out[(i + 1) % n])
            u, w = b - a, c - b
            if u.length < 1e-6 or w.length < 1e-6 or abs(u.x * w.y - u.y * w.x) < 1e-4 * u.length * w.length and u.dot(w) > 0:
                del out[i]; changed = True; break
    return out

def wall_profile(loop, open_, back_index):
    """The section ordered so that its last edge (last point to first) lies against the wall, the wall side pushed
    12 mm into the wall like every other stone. back_index: which coordinate is d. None: no side lies on the wall."""
    dmin = min(p[back_index] for p in loop)
    on = lambda p: p[back_index] < dmin + 0.004
    if open_:
        if not (on(loop[0]) and on(loop[-1])): return None
        prof = loop
    else:
        n = len(loop)
        i = next((i for i in range(n) if on(loop[i]) and on(loop[(i + 1) % n])), None)
        if i is None: return None
        prof = loop[i + 1:] + loop[:i + 1]
        # (a straight back made of several points: keep its two ends)
        while len(prof) > 3 and on(prof[0]) and on(prof[1]): prof = prof[1:]
        while len(prof) > 3 and on(prof[-1]) and on(prof[-2]): prof = prof[:-1]
    prof = [tuple(min(v, -0.012) if k == back_index and on(p) else v for k, v in enumerate(p)) for p in prof]
    return prof

def chamfer_profile(prof, c0, back_index):
    """Small chamfers on the section's convex arrises (not on the wall side): the long arrises of a band or a strip."""
    n = len(prof); area = sum(prof[i][0] * prof[(i + 1) % n][1] - prof[(i + 1) % n][0] * prof[i][1] for i in range(n))
    out = []
    for i in range(n):
        p, a, b = Vector(prof[i]), Vector(prof[i - 1]), Vector(prof[(i + 1) % n])
        if i == 0 or i == n - 1: out.append(prof[i]); continue
        u, w = p - a, b - p
        cross = u.x * w.y - u.y * w.x
        if u.length < 1e-4 or w.length < 1e-4 or cross * area <= 0 or u.normalized().dot(w.normalized()) > 0.94: out.append(prof[i]); continue
        c = min(c0, 0.3 * u.length, 0.3 * w.length)
        out += [tuple(p - u.normalized() * c), tuple(p + w.normalized() * c)]
    return out

def extruded_stone(fr, sec, axis, a0, a1, kind, arris=0.007, margin=True, chip=1, code=4):
    """One stone: a section run from a0 to a1. axis 's': sec is [(d, y)], run along the wall; 'y': sec is [(s, d)],
    run upwards. The section's last side lies against the wall (hidden); both ends closed, their arrises chamfered."""
    W = (lambda u, v, a: fr.world(a, v, u)) if axis == 's' else (lambda u, v, a: fr.world(u, a, v))
    p = Piece(kind); bm = p.bm
    A = [bm.verts.new(W(u, v, a0)) for u, v in sec]; B = [bm.verts.new(W(u, v, a1)) for u, v in sec]
    n = len(sec); sides = []
    for i in range(n):
        j = (i + 1) % n; f = bm.faces.new([A[i], A[j], B[j], B[i]]); f[p.code] = code; sides.append(f)
    ca = bm.faces.new(list(reversed(A))); cb = bm.faces.new(B); ca[p.code] = cb[p.code] = code
    bmesh.ops.recalc_face_normals(bm, faces=sides + [ca, cb])
    p.hidden.add(sides[-1])
    if code == 4:
        low = min(v.co.y for v in bm.verts) < 2.2
        bevel(p, visible_edges(p, [ca, cb]), arris * rng.uniform(0.8, 1.25), 2 if low else 1)
        if margin:
            across = (max(v for _, v in sec) - min(v for _, v in sec)) if axis == 's' else (max(u for u, _ in sec) - min(u for u, _ in sec))
            dress(p, fr.n.copy(), margin=min(0.022, 0.2 * min(a1 - a0, across)))
        chips(p, chip, (0.004, 0.01))
    finish(p); pieces.append(p); return p

def mortar_section(sec, back_index):
    """The mortar of a joint across a section: set back 6 mm from every visible face."""
    dmin = min(p[back_index] for p in sec); o = 1 - back_index
    lo, hi = min(p[o] for p in sec), max(p[o] for p in sec); mid = (lo + hi) / 2
    k = max(0.0, 1 - 0.012 / max(hi - lo, 0.02))
    out = []
    for p in sec:
        q = list(p)
        if p[back_index] > dmin + 0.004: q[back_index] = max(dmin, p[back_index] - 0.006)
        q[o] = mid + (p[o] - mid) * k
        out.append(tuple(q))
    return out

def arch_fit(poly):
    """A segmental arch band: its outline's points on two concentric circles (intrados, extrados). (cx, cy, rin, rout,
    t0, t1) or None."""
    if len(poly) < 8: return None
    cx, cy, r = circle_fit(poly)
    rs = sorted(math.hypot(s - cx, y - cy) for s, y in poly)
    gaps = [(rs[i + 1] - rs[i], i) for i in range(len(rs) - 1)]
    g, i = max(gaps)
    if g < 0.06: return None
    inner = [(s, y) for s, y in poly if math.hypot(s - cx, y - cy) <= rs[i] + 1e-6]
    outer = [(s, y) for s, y in poly if math.hypot(s - cx, y - cy) > rs[i] + 1e-6]
    if len(inner) < 4 or len(outer) < 4: return None
    ci, co_ = circle_fit(inner), circle_fit(outer)
    if math.hypot(ci[0] - co_[0], ci[1] - co_[1]) > 0.04: return None
    if max(abs(math.hypot(s - ci[0], y - ci[1]) - ci[2]) for s, y in inner) > 0.012: return None
    if max(abs(math.hypot(s - co_[0], y - co_[1]) - co_[2]) for s, y in outer) > 0.012: return None
    if not 0.06 < co_[2] - ci[2] < 0.6 or ci[1] > max(y for _, y in poly): return None
    ang = [math.atan2(y - ci[1], s - ci[0]) for s, y in inner]
    return ci[0], ci[1], ci[2], co_[2], max(ang), min(ang)

def ground_slab(rows, idx):
    """Pavement aprons, kerbs and door-step tops: mostly faces looking up below 0.8 m. They keep the old stone's slab
    picture (its shader lays the pavement's slabs in world metres there)."""
    up = tot = 0.0
    for i in idx:
        a, b, c = (Vector(rows[i + k][:3]) for k in range(3)); ar = (b - a).cross(c - a).length / 2
        tot += ar
        if sum(rows[i + k][4] for k in range(3)) / 3 > 0.7 and max(a.y, b.y, c.y) < 0.8: up += ar
    return tot <= 0 or up > 0.6 * tot

def reskin(rows, idx, kind='old stone'):
    """A stone piece with no clean section (a scroll, a capital, a cornice's return, a reveal's lining): its own shape
    on the dressed stone, smooth across shallow angles, its sharp arrises chamfered, so a front never shows two stones
    side by side."""
    p = Piece(kind); bm = p.bm; vmap = {}
    for i in idx:
        vs = []
        for k in range(3):
            co = tuple(round(x, 5) for x in rows[i + k][:3])
            if co not in vmap: vmap[co] = bm.verts.new(co)
            vs.append(vmap[co])
        if len(set(vs)) < 3: continue
        try: f = bm.faces.new(vs)
        except ValueError: continue
        old = sum((Vector(rows[i + k][3:6]) for k in range(3)), Vector())
        if f.normal.dot(old) < 0: f.normal_flip()
        f[p.code] = 4
    p.normals = None; p.smooth = True
    # its sharp arrises (faces meeting at over 40 degrees) get a small chamfer, where the old mesh is closed there
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=0.0005)
    sharp = [e for e in bm.edges if len(e.link_faces) == 2 and e.calc_face_angle(0.0) > math.radians(40) and e.calc_length() > 0.02]
    if sharp:
        try: bevel(p, sharp, 0.004, 1)
        except Exception: pass
    pieces.append(p); return p

def arc_sweep(tris):
    """An arched hood or head: one section swept round an arc in the wall's plane. (cx, cy, profile [(r, d)] as a
    loop, first angle, last angle) or None."""
    pts = {(round(p[0], 4), round(p[1], 4), round(p[2], 4)) for t in tris for p in t}
    if len(pts) < 12: return None
    cx, cy, _ = circle_fit([(s, y) for s, y, _ in pts])
    key = lambda p: (round(math.hypot(p[0] - cx, p[1] - cy) * 400), round(p[2] * 400))
    ang = lambda p: math.atan2(p[1] - cy, p[0] - cx)
    angs = {}
    for p in pts: angs.setdefault(key(p), []).append(ang(p))
    if not 3 <= len(angs) <= 24 or any(len(v) < 3 for v in angs.values()): return None
    a_lo, a_hi = min(min(v) for v in angs.values()), max(max(v) for v in angs.values())
    if a_hi - a_lo < 0.35 or a_hi - a_lo > math.pi + 0.2: return None
    if any(min(v) - a_lo > 0.15 or a_hi - max(v) > 0.15 for v in angs.values()): return None
    # the section's edges: the ones that come back at every ring (a cap's diagonals only at the ends)
    count = {}
    for t in tris:
        for i in range(3):
            p, q = t[i], t[(i + 1) % 3]
            if abs(ang(p) - ang(q)) > 0.012: continue
            kp, kq = key(p), key(q)
            if kp == kq: continue
            e = (min(kp, kq), max(kp, kq)); count[e] = count.get(e, 0) + 1
    adj = {}
    for (kp, kq), n in count.items():
        if n < 3: continue
        adj.setdefault(kp, []).append(kq); adj.setdefault(kq, []).append(kp)
    if len(adj) != len(angs) or any(len(v) != 2 for v in adj.values()): return None
    start = min(adj); loop, prev, cur = [start], None, start
    while True:
        nxt = [k for k in adj[cur] if k != prev]
        if not nxt or nxt[0] == start: break
        prev, cur = cur, nxt[0]; loop.append(cur)
    if len(loop) != len(adj): return None
    return cx, cy, [(k[0] / 400, k[1] / 400) for k in loop], a_lo, a_hi

def swept_stone(fr, cx, cy, prof, a0, a1, kind, code=4, arris=0.006):
    """One stone of an arched hood: the section [(r, d)] (its last side against the wall) swept from angle a0 to a1."""
    p = Piece(kind); bm = p.bm; steps = max(2, int(math.ceil((a1 - a0) * max(r for r, _ in prof) / 0.06)))
    rings = [[bm.verts.new(fr.world(cx + r * math.cos(a0 + (a1 - a0) * k / steps), cy + r * math.sin(a0 + (a1 - a0) * k / steps), d)) for r, d in prof] for k in range(steps + 1)]
    n = len(prof); faces = []; walls = []
    for k in range(steps):
        for i in range(n):
            j = (i + 1) % n; f = bm.faces.new([rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]]); f[p.code] = code; faces.append(f)
            if i == n - 1: walls.append(f)
    ca = bm.faces.new(list(reversed(rings[0]))); cb = bm.faces.new(rings[-1]); ca[p.code] = cb[p.code] = code
    bmesh.ops.recalc_face_normals(bm, faces=faces + [ca, cb])
    p.hidden.update(walls)
    if code == 4:
        bevel(p, visible_edges(p, [ca, cb]), arris * rng.uniform(0.8, 1.25), 1)
        chips(p, 1, (0.004, 0.01))
    finish(p); pieces.append(p); return p

def front_arch(tris):
    """A segmental arched head seen from the front: the faces in its most proud plane outline a band whose lower and
    upper edges are two arcs round one centre. (cx, cy, rin, rout, t_left, t_right, front d) or None."""
    # the face's plane: the level most of the forward-facing area lies in (a rosette or a key stands further out)
    area = {}
    for t in tris:
        if max(p[2] for p in t) - min(p[2] for p in t) > 0.002: continue
        a, b, c = (Vector(p) for p in t); area[round(t[0][2] * 200)] = area.get(round(t[0][2] * 200), 0) + (b - a).cross(c - a).length / 2
    if not area: return None
    d1 = max(area, key=area.get) / 200
    front = [t for t in tris if all(abs(p[2] - d1) < 0.006 for p in t)]
    if len(front) < 6: return None
    pts = sorted({(round(p[0], 4), round(p[1], 4)) for t in front for p in t})
    s0, s1 = pts[0][0], pts[-1][0]; w = s1 - s0
    if w < 0.5: return None
    def inside(q):
        for t in front:
            (ax, ay), (bx, by), (cx_, cy_) = ((p[0], p[1]) for p in t)
            d = (by - cy_) * (ax - cx_) + (cx_ - bx) * (ay - cy_)
            if abs(d) < 1e-12: continue
            l1 = ((by - cy_) * (q[0] - cx_) + (cx_ - bx) * (q[1] - cy_)) / d; l2 = ((cy_ - ay) * (q[0] - cx_) + (ax - cx_) * (q[1] - cy_)) / d
            if l1 >= -1e-6 and l2 >= -1e-6 and l1 + l2 <= 1 + 1e-6: return True
        return False
    # the lower edge (face above, none below) and the upper edge, the vertical end cuts left out
    lower = [(x, y) for x, y in pts if s0 + 0.03 < x < s1 - 0.03 and inside((x, y + 0.01)) and not inside((x, y - 0.01))]
    upper = [(x, y) for x, y in pts if s0 + 0.03 < x < s1 - 0.03 and inside((x, y - 0.01)) and not inside((x, y + 0.01))]
    if len(lower) < 4: return None
    if max(y for _, y in lower) - min(y for _, y in lower) < 0.04: return None  # (a flat head)
    cx, cy, rin = circle_fit(lower)
    if not 0.3 < rin < 8.0 or cy > min(y for _, y in pts): return None
    # the face's own outline: its edges used by one face only, in one loop (no hole)
    cnt = {}
    for t in front:
        ks = [(round(p[0] * 2000), round(p[1] * 2000)) for p in t]
        for i in range(3):
            e = tuple(sorted((ks[i], ks[(i + 1) % 3])))
            if e[0] != e[1]: cnt[e] = cnt.get(e, 0) + 1
    adj = {}
    for (ka, kb), c in cnt.items():
        if c == 1: adj.setdefault(ka, []).append(kb); adj.setdefault(kb, []).append(ka)
    if len(adj) < 6 or any(len(v) != 2 for v in adj.values()): return None
    start = min(adj); loop, prev, cur = [start], None, start
    while True:
        nxt = [k for k in adj[cur] if k != prev]
        if not nxt or nxt[0] == start: break
        prev, cur = cur, nxt[0]; loop.append(cur)
    if len(loop) != len(adj): return None
    outline = [(k[0] / 2000, k[1] / 2000) for k in loop]
    angs = [math.atan2(y - cy, x - cx) for x, y in outline]
    if max(angs) - min(angs) > math.pi - 0.05: return None
    return cx, cy, outline, max(angs), min(angs), d1

def clip_wedge(poly, cx, cy, ta, tb):
    """The part of a polygon between two rays from (cx, cy) at angles ta > tb (Sutherland-Hodgman, two half-planes)."""
    def clip(pts, ux, uy, keep_left):
        out = []
        side = lambda p: (ux * (p[1] - cy) - uy * (p[0] - cx)) * (1 if keep_left else -1)
        for i in range(len(pts)):
            p, q = pts[i], pts[(i + 1) % len(pts)]
            sp, sq = side(p), side(q)
            if sp >= 0: out.append(p)
            if (sp >= 0) != (sq >= 0):
                k = sp / (sp - sq); out.append((p[0] + (q[0] - p[0]) * k, p[1] + (q[1] - p[1]) * k))
        return out
    pts = clip(poly, math.cos(tb), math.sin(tb), True)
    if len(pts) >= 3: pts = clip(pts, math.cos(ta), math.sin(ta), False)
    return pts if len(pts) >= 3 else None

def extrude_poly(fr, poly, d0, d1, kind, code):
    """A plain extrusion of a wall-plane polygon (the mortar of an arch's joint), its back hidden."""
    p = Piece(kind); bm = p.bm
    fv = [bm.verts.new(fr.world(x, y, d1)) for x, y in poly]; bv = [bm.verts.new(fr.world(x, y, d0)) for x, y in poly]
    n = len(poly); fs = [bm.faces.new([fv[i], fv[(i + 1) % n], bv[(i + 1) % n], bv[i]]) for i in range(n)]
    ff = bm.faces.new(fv); fb = bm.faces.new(list(reversed(bv))); fs += [ff, fb]
    bmesh.ops.recalc_face_normals(bm, faces=fs)
    for f in bm.faces: f[p.code] = code
    p.hidden.add(fb); finish(p); pieces.append(p)

def dress_section(fr, rows, idx, item):
    """Bands, string courses and cornices (cut into stones with joints), pilasters and strips (cut into courses on the
    brick beds), arched window heads (a ring of voussoirs) and other single stones (panels, blocks): any stone piece
    that is a prism. None: kept as it was."""
    tris = [[fr.local(Vector(rows[i + k][:3])) for k in range(3)] for i in idx]
    s0, s1, y0, y1, d0, d1 = item['box']; wd, h = s1 - s0, y1 - y0
    if min(wd, h, d1 - d0) < 0.008: return None
    inside = d1 < 0.01  # (in an opening's reveal: a fanlight's bars, a mullion set back)
    if inside and d0 > -0.03: return None
    if y0 < 0.05 and h < 0.15 and d1 > 0.25: return None  # (a pavement apron, not a stone of the wall)
    if sum(CUR['tint']) / 3 < 0.45: return None  # (a black or tarred front keeps its own look)
    S, Y, D = (section_loop(tris, a) for a in (0, 1, 2))
    order = []
    if wd >= max(1.2, 2.5 * h): order = [('s', S), ('d', D), ('y', Y)]
    elif h >= max(0.9, 2.5 * wd): order = [('y', Y), ('d', D), ('s', S)]
    else: order = [('d', D), ('s', S), ('y', Y)]
    if inside: order = [('d', D)]
    for axis, sec in order:
        if sec is None: continue
        loop, (a0, a1), open_ = sec
        if axis == 's':
            prof = wall_profile(simplify([(d, y) for y, d in loop], not open_), open_, 0)
            if prof is None or len(prof) < 3: continue
            prof = chamfer_profile(prof, 0.007, 0)
            n = 1 if a1 - a0 <= 1.7 else max(2, round((a1 - a0) / 1.15))
            cuts = [a0] + sorted(a0 + (a1 - a0) * (k + rng.uniform(-0.1, 0.1)) / n for k in range(1, n)) + [a1]
            for k, (a, b) in enumerate(zip(cuts, cuts[1:])):
                extruded_stone(fr, prof, 's', a + (0.005 if k else 0), b - (0.005 if k < n - 1 else 0), 'band')
                if k < n - 1: extruded_stone(fr, mortar_section(prof, 0), 's', b - 0.0055, b + 0.0055, 'mortar', code=5)
            return 'cornice' if d1 - d0 > 0.18 and h > 0.25 else ('band' if wd > 1.7 else 'head or sill')
        if axis == 'y':
            prof = wall_profile(simplify([(s, d) for s, d in loop], not open_), open_, 1)
            if prof is None or len(prof) < 3: continue
            prof = chamfer_profile(prof, 0.008, 1)
            # a mullion or a narrow jamb: long stones; a pilaster or a wide strip: courses on the beds
            n = max(1, math.ceil((a1 - a0) / 1.6)) if wd < 0.2 else max(1, round((a1 - a0) / 0.42))
            cuts = [a0] + [fr.bed(a0 + (a1 - a0) * k / n) for k in range(1, n)] + [a1]
            cuts = [c for k, c in enumerate(cuts) if k == 0 or c - cuts[k - 1] > 0.12]
            if cuts[-1] < a1 - 1e-4: cuts[-1] = a1
            for k, (a, b) in enumerate(zip(cuts, cuts[1:])):
                extruded_stone(fr, prof, 'y', a + (0.005 if k else 0), b - (0.005 if k < len(cuts) - 2 else 0), 'pilaster course')
                if k < len(cuts) - 2: extruded_stone(fr, mortar_section(prof, 1), 'y', b - 0.0055, b + 0.0055, 'mortar', code=5)
            return 'pilaster' if h > 2.0 else 'strip'
        if axis == 'd':
            if open_: continue
            poly = simplify(loop, True)
            if len(poly) < 3: continue
            back = min(a0, -0.012)
            arch = arch_fit(poly)
            if arch:
                cx, cy, rin, rout, t0, t1 = arch
                span = t0 - t1; rmid = (rin + rout) / 2
                count = max(3, int(round(span * rmid / 0.24)) | 1); half = 0.005 / rmid
                for i in range(count):
                    b0 = t0 - span * i / count - (half if i else 0); b1 = t0 - span * (i + 1) / count + (half if i < count - 1 else 0)
                    arc_in = [(cx + rin * math.cos(b0 + (b1 - b0) * q / 3), cy + rin * math.sin(b0 + (b1 - b0) * q / 3)) for q in range(4)]
                    arc_out = [(cx + rout * math.cos(b1 - (b1 - b0) * q / 3), cy + rout * math.sin(b1 - (b1 - b0) * q / 3)) for q in range(4)]
                    arch_stone(fr, arc_in + arc_out, back, a1, 'arched head voussoir', arris=0.006)
                    if i < count - 1: mortar_ring(fr, cx, cy, rin + 0.0015, rout - 0.004, b1 - half, b1 + half, back + 0.003, a1 - 0.004)
                return 'arched head'
            area = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
            if area < 0: poly = list(reversed(poly))
            thin = min(max(p[0] for p in poly) - min(p[0] for p in poly), max(p[1] for p in poly) - min(p[1] for p in poly))
            arch_stone(fr, poly, back if not inside else a0, a1, 'fanlight bar' if inside else 'panel stone', arris=min(0.007, 0.25 * (a1 - (back if not inside else a0)), 0.2 * thin))
            return 'fanlight bar' if inside else 'panel stone'
    if inside: return None
    # a segmental arched head: a ring of voussoirs from its back in the reveal to its face, radial joints
    fa = front_arch(tris)
    if fa:
        cx, cy, outline, t0, t1, df = fa
        back = min(d0, -0.012); span = t0 - t1
        rmid = sum(math.hypot(x - cx, y - cy) for x, y in outline) / len(outline)
        count = max(5, int(round(span * rmid / 0.24)) | 1); half = 0.005 / rmid
        area = sum(outline[i][0] * outline[(i + 1) % len(outline)][1] - outline[(i + 1) % len(outline)][0] * outline[i][1] for i in range(len(outline)))
        if area < 0: outline = list(reversed(outline))
        stones = []
        for i in range(count):
            b0 = t0 - span * i / count - (half if i else 0); b1 = t0 - span * (i + 1) / count + (half if i < count - 1 else 0)
            poly = clip_wedge(outline, cx, cy, b0 + (0.01 if i == 0 else 0), b1 - (0.01 if i == count - 1 else 0))
            if poly is None: return None
            stones.append((poly, b1))
        for i, (poly, b1) in enumerate(stones):
            arch_stone(fr, simplify(poly, True), back, df, 'voussoir', arris=0.006)
            if i < count - 1:
                joint = clip_wedge(outline, cx, cy, b1, b1 - 2 * half)
                if joint: extrude_poly(fr, joint, back + 0.003, df - 0.004, 'mortar', 5)
        return 'arched head'
    # an arched hood or head over a window: its section swept round the arch, cut into stones with radial joints
    sw = arc_sweep(tris)
    if sw:
        cx, cy, loop, t_lo, t_hi = sw
        prof = wall_profile(simplify(loop, True), False, 1)
        if prof and len(prof) >= 3:
            prof = chamfer_profile(prof, 0.006, 1)
            rmid = sum(r for r, _ in prof) / len(prof); span = t_hi - t_lo
            count = max(3, int(round(span * rmid / 0.32)) | 1); half = 0.005 / rmid
            for i in range(count):
                b0 = t_lo + span * i / count + (half if i else 0); b1 = t_lo + span * (i + 1) / count - (half if i < count - 1 else 0)
                swept_stone(fr, cx, cy, prof, b0, b1, 'arched hood stone')
                if i < count - 1: swept_stone(fr, cx, cy, mortar_section(prof, 1), b1, b1 + 2 * half, 'mortar', code=5)
            return 'arched head'
    return None

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
            c = (lo + hi) / 2; wear = rows[idx[0]][13]; CUR['tint'] = TINT[(mesh, idx[0])] = tint_of(rows, idx)
            item = {'mesh': mesh, 'at': [round(c.x, 2), round(c.y, 2), round(c.z, 2)], 'triangles': len(idx), 'wear': round(wear, 2)}
            ns = normals_of(rows, idx)
            # a quoin course: two faces at right angles, both outward, one course high, round one corner
            strong = [x for x in ns if x[1] > 0.02]
            pair = next(((a, b) for i, a in enumerate(strong) for b in strong[i + 1:] if abs(a[0].dot(b[0])) < 0.05 and (a[0] + b[0]).length > 1.3), None)
            if pair and 0.2 < hi.y - lo.y < 0.45 and (Vector((hi.x - lo.x, hi.z - lo.z))).length < 1.2 and lo.y > 0.3:
                (na, _), (nb, _) = sorted(pair, key=lambda x: math.atan2(x[0].z, x[0].x))
                if abs(math.atan2(na.z, na.x) - math.atan2(nb.z, nb.x)) > math.pi: na, nb = nb, na  # (the pair across the -x axis)
                # #173: a ground-floor quoin beside a shop front runs 0.2 m into the wall (it lines the shop window's
                # reveal), so its middle lies nearer the reveal's plane than the wall's face: the first try measures from
                # the middle (as #157 did), the second from the stone's own face, a few centimetres proud of the wall
                tries = [(c, c)] + [(c + na * (max(p.dot(na) for p in pts) - c.dot(na) - 0.07), c + nb * (max(p.dot(nb) for p in pts) - c.dot(nb) - 0.07))]
                placed = False
                for ca, cb in tries:
                    wa, wb = wall_at(ca, na, 0.6), wall_at(cb, nb, 0.6)
                    if not (wa and wb): continue
                    ma, mb = wa[2], wb[2]
                    fa0 = Front(ma * wa[0], Vector((-ma.z, 0, ma.x)), ma, wa[1]); fb0 = Front(mb * wb[0], Vector((-mb.z, 0, mb.x)), mb, wb[1])
                    corner = plane_corner(fa0, fb0)
                    key = (round(corner.x * 20), round(corner.z * 20), round(ma.x, 1), round(ma.z, 1), round(mb.x, 1), round(mb.z, 1))
                    fa = Front(corner, -mb, ma, wa[1]); fb = Front(corner, -ma, mb, wb[1])
                    la = max(fa.local(p)[0] for p in pts); lb = max(fb.local(p)[0] for p in pts)
                    pr = max(max(fa.local(p)[2] for p in pts), max(fb.local(p)[2] for p in pts))
                    if 0.1 < la < 0.8 and 0.1 < lb < 0.8 and 0.03 < pr < 0.15:
                        quoin_groups.setdefault(key, (fa, fb, corner, []))[3].append((lo.y, hi.y, la, lb, pr, idx, wear))
                        placed = True; break
                if placed: continue
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
            if n is None:
                if DRESS_REST and not ground_slab(rows, idx): reskin(rows, idx); take(mesh, idx); report['items'].append(dict(item, kind='reskinned (no front)')); continue
                report['kept'].append(dict(item, kind='no front')); continue
            w = wall_at(c, n, 0.45)
            if not w and abs(abs(n.x) - abs(n.z)) > 0.3:
                cand = Vector((round(n.x), 0, round(n.z))).normalized(); w = wall_at(c, cand, 0.45)
            if not w:
                if DRESS_REST and not ground_slab(rows, idx): reskin(rows, idx); take(mesh, idx); report['items'].append(dict(item, kind='reskinned (no wall)')); continue
                report['kept'].append(dict(item, kind='no wall')); continue
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
            elif -0.3 < d0 < -0.15 and h > 2.0 and wd < 3.8 and 0.05 < d1 < 0.2 and y0 < 0.05:
                # a door or a coach gate: flat or arched, single or double (a passage through the house goes deeper)
                kind = 'door surround (' + door(fr, rows, idx) + ')'
            elif -0.25 < d0 < -0.15 and abs(d1) < 0.01 and 1.4 < h < 2.8 and 1.0 < wd < 2.8 and y0 > 0.4:
                shops.append((fr, s0, s1, y0, y1, mesh, wear)); report['kept'].append(dict(item, kind='shop window reveal')); continue
            elif -0.3 < d0 < -0.15 and h < 0.25 and y0 < 0.05 and wd < 3.5 and d1 < 0.15:
                step(fr, s0, s1, y0, y1, d0, d1); kind = 'door step'
            elif 0.25 < h < 0.35 and 0.07 < d1 < 0.11 and y0 > 2.0 and d0 > -0.02:
                lintel(fr, s0, s1, y0, y1, d1); kind = 'door lintel'
            elif h < 0.1 and 0.15 < d1 < 0.2 and y0 > 2.0 and d0 > -0.02:
                hood(fr, s0, s1, y0, y1, d1); kind = 'door hood'
            if kind is None and DRESS_REST: kind = dress_section(fr, rows, idx, item)
            if kind is None and DRESS_REST and not ground_slab(rows, idx): reskin(rows, idx); kind = 'reskinned'
            if kind is None: report['kept'].append(dict(item, kind='unclassified')); continue
            if kind == 'plinth': continue  # (built, taken and reported with its corner below)
            take(mesh, idx); item['kind'] = kind; item['tint'] = [round(x, 3) for x in CUR['tint']]; report['items'].append(item)
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
            CUR['wear'] = wear; CUR['tint'] = TINT.get((mesh, idx[0]), REF_TINT); a0, a1 = fr.bed(y0) + 0.005, fr.bed(y1 + 0.02) - 0.005
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
            """Flat on the stone's faces, rounded across a bevel's facets (and onto the faces they join); a reskinned
            piece keeps the old mesh's normals."""
            if getattr(p, 'smooth', False):
                acc = Vector()
                for g in v.link_faces:
                    if g.normal.dot(f.normal) > math.cos(math.radians(35)): acc += g.normal * g.calc_area()
                return acc.normalized() if acc.length > 1e-12 else f.normal.copy()
            if not f[p.bev]: return f.normal.copy()
            acc = Vector()
            for g in v.link_faces:
                if g.normal.dot(f.normal) > math.cos(math.radians(50)): acc += g.normal * g.calc_area()
            return acc.normalized() if acc.length > 1e-12 else f.normal.copy()
        ou, ov = p.rand * 0.731, p.rand2 * 0.613
        # (COLOR = sky light, the stone's colour as brightness and warmth, the house's wear)
        lum = sum(p.tint) / 3; warm = (p.tint[0] - p.tint[2]) / max(lum, 0.05)
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
                tri.append([co.x, co.y, co.z, nn.x, nn.y, nn.z, u + ou, v + ov, float(code), p.rand, ao, lum, warm, p.wear, rain, p.rand2])
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
