# The pit trees' root flare (#248), one model for every pit tree. Run headless:
#   blender --background --factory-startup --python make_root_flare.py -- <out folder>
# Writes root_flare.glb (the model) and root_flare.blend (to look at) into the folder, and prints a report.
#
# Shape: the trunk's foot swelling into five to seven uneven roots, the big ones forked, each sinking into the earth
# (the shape NativeTreePits.RootModel built in code since #239/#243, now one authored model). A height field over rings
# round a round trunk of radius R0; the game scales it to each trunk's radius and turns it to the trunk's bark seam.
#
# UVs (the smear of #248: the code laid the bark's picture by angle round the trunk and path length out from it, so on
# the roots' steep sides and the swell's flanks one texel ran over several centimetres). The surface is cut into one
# wedge per root, the cuts in the low valleys between the roots (mostly under the earth), and each wedge is unwrapped
# on its own with Blender's minimum-stretch unwrap, scaled back to true size (metres both ways), then turned (or
# mirrored) and moved onto the trunk's own picture (round the trunk by angle, down it by height), fitted most closely
# near the trunk, so the flare goes on from the bark; a wedge is moved to stay inside the bark's one turn of picture
# (its atlas holds two barks side by side). The grain runs down the trunk and out along each root.
# UV stored: u = turns round the trunk (0-1), v = metres down from the join (Join - height on the trunk's own scale);
# NativeTreePits maps them onto each bark's own picture.
import bpy, bmesh, math, random, sys, os, json
from mathutils import Vector

args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
out = args[0] if args else os.path.dirname(os.path.abspath(__file__))
os.makedirs(out, exist_ok=True)
# (an empty scene: the factory start has a cube, a light and a camera)
for o in list(bpy.data.objects):
    bpy.data.objects.remove(o, do_unlink=True)

R0 = 0.32                # trunk radius the model is built for
SINK = 0.022             # the pit's earth lies this far under the paving (NativeTreePits.Sink)
BED = -0.03 - SINK       # the roots' ends lie under the earth
JOIN = 0.2               # where the flare leaves the trunk
RJ = 0.84 * R0           # it starts inside the trunk's foot (lumpy trunks: no lip where the trunk is thinner)
REACH = min(0.72, R0 + 0.46)
ROUND, RINGS = 144, 26
rng = random.Random(1873248)

def line(p0, h0, bend, length, top, half, sink, steps=14):
    ph = rng.random() * 10
    pts, p = [], Vector(p0)
    for i in range(steps + 1):
        t = i / steps
        h = h0 + bend * t * t + 0.1 * math.sin(t * 4.1 + ph)
        y = BED + (top - BED) * (1 - t) ** sink + 0.008 * math.sin(t * 11 + ph) * (1 - t)
        w = half * (1 - 0.72 * t) * (1 + 0.5 * (1 - t) ** 4)
        pts.append((p.copy(), y, w))
        p += Vector((math.cos(h), math.sin(h))) * (length / steps)
    return pts

roots, mains = [], []
count = 6
turn = rng.random() * math.tau
big = rng.randrange(count)
big2 = (big + 2 + rng.randrange(count - 3)) % count

def fork(ln, length, depth):
    at = 3 + rng.randrange(6)
    p, y, w = ln[at]
    d = ln[at + 1][0] - ln[at][0]
    h = math.atan2(d.y, d.x)
    side = -1 if rng.random() < 0.5 else 1
    rest = length * (1 - at / 14)
    br = line(p, h + side * (0.4 + 0.55 * rng.random()), -side * 0.5 * rng.random(), rest * (0.55 + 0.45 * rng.random()), y,
              w * (0.5 + 0.2 * rng.random()), 0.9 + 0.3 * rng.random())
    roots.append(br)
    if depth < 1 and rng.random() < 0.4:
        fork(br, rest * 0.7, depth + 1)

for r in range(count):
    a = turn + r * math.tau / count + (rng.random() - 0.5) * 0.6
    mains.append(a)
    size = 1.0 if r == big else 0.8 if r == big2 else 0.3 + 0.4 * rng.random()
    start = Vector((math.cos(a), math.sin(a))) * R0 * 0.92
    length = (0.55 + 0.45 * size) * (REACH - R0 * 0.9) + 0.06
    top, half = 0.04 + 0.1 * size, 0.035 + 0.05 * size
    ln = line(start, a, (rng.random() - 0.5) * 1.3, length, top, half, 0.85 + 0.4 * rng.random())
    roots.append(ln)
    if size > 0.6 or rng.random() < 0.3:
        fork(ln, length, 0 if size > 0.9 else 1)
    if size > 0.9 and rng.random() < 0.6:
        fork(ln, length, 1)

def smax(a, b, k):
    h = min(max(0.5 + 0.5 * (b - a) / k, 0), 1)
    return a + (b - a) * h + k * h * (1 - h)

def noise2(x, z):
    def H(i, j):
        h = (i * 374761393 + j * 668265263) & 0xFFFFFFFF
        h = ((h ^ (h >> 13)) * 1274126177) & 0xFFFFFFFF
        return (h ^ (h >> 16)) / 0xFFFFFFFF
    ix, iz = math.floor(x), math.floor(z)
    fx, fz = x - ix, z - iz
    ux, uz = fx * fx * (3 - 2 * fx), fz * fz * (3 - 2 * fz)
    a = H(ix, iz) + (H(ix + 1, iz) - H(ix, iz)) * ux
    b = H(ix, iz + 1) + (H(ix + 1, iz + 1) - H(ix, iz + 1)) * ux
    return a + (b - a) * uz

def height(q, rho):
    if rho < RJ:
        return JOIN + (RJ - rho) * 2.5
    h = BED + (JOIN - BED) * math.exp(-(rho - RJ) / 0.045)
    for ln in roots:
        best, bt, bw = 1e9, 0, 0
        for i in range(len(ln) - 1):
            a, ta, wa = ln[i]
            b, tb, wb = ln[i + 1]
            ab = b - a
            l2 = ab.length_squared
            t = min(max((q - a).dot(ab) / l2, 0), 1) if l2 > 1e-9 else 0
            d = (q - (a + ab * t)).length
            if d < best:
                best, bt, bw = d, ta + (tb - ta) * t, wa + (wb - wa) * t
        if best >= bw:
            continue
        x = best / bw
        bt = BED + (bt - BED) * min(max((REACH - 0.03 - rho) / 0.1, 0), 1)
        h = smax(h, BED + (bt - BED) * (1 - x * x) ** 0.7, 0.02)
    return h + 0.004 * (noise2(q.x * 23 + 3, q.y * 23) - 0.5) * min(max((h - BED) / 0.05, 0), 1)

rho0 = RJ - 0.03
def rho_at(j):
    return rho0 + (REACH - rho0) * (j / RINGS) ** 1.6

grid = {}
for i in range(ROUND + 1):
    th = math.tau * i / ROUND
    d = Vector((math.cos(th), math.sin(th)))
    for j in range(RINGS + 1):
        rho = rho_at(j)
        q = d * rho
        grid[i, j] = Vector((q.x, q.y, height(q, rho)))

# smooth normals over the whole field (before it is cut into wedges: no light seam at a cut)
def face_up(a, b, c):
    f = (b - a).cross(c - a)
    return f if f.z >= 0 else -f
vn = {}
quads = []
for i in range(ROUND):
    for j in range(RINGS):
        q = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
        ps = [grid[k] for k in q]
        if max(p.z for p in ps) < -0.004 - SINK:
            continue  # all under the earth
        # (a steep face against the trunk, inside its foot: not drawn)
        mid = sum(ps, Vector()) / 4
        f = face_up(ps[0], ps[1], ps[2]) + face_up(ps[0], ps[2], ps[3])
        if abs(f.z) < 0.2 * f.length and Vector((mid.x, mid.y)).length < RJ + 0.02:
            continue
        quads.append(q)
        for k in q:
            kk = (k[0] % ROUND, k[1])
            vn[kk] = vn.get(kk, Vector()) + f

# the wedges: cut in the valley between two neighbouring main roots (the lowest column there), and at the trunk's seam
def col_of(a):
    return int(round((a % math.tau) / math.tau * ROUND)) % ROUND
order = sorted(m % math.tau for m in mains)
cuts = set([0])
for k in range(len(order)):
    a0, a1 = order[k], order[(k + 1) % len(order)] + (math.tau if k == len(order) - 1 else 0)
    c0, c1 = col_of(a0), col_of(a1)
    span = [(c0 + s) % ROUND for s in range(1, (c1 - c0) % ROUND)]
    # the lowest column (its mean height over the outer rings)
    best = min(span, key=lambda c: sum(grid[c, j].z for j in range(RINGS // 3, RINGS + 1)))
    cuts.add(best)
cuts = sorted(cuts)
wedges = []
for k, c in enumerate(cuts):
    e = cuts[k + 1] if k + 1 < len(cuts) else ROUND
    wedges.append((c, e))

mesh = bpy.data.meshes.new("root_flare")
bm = bmesh.new()
uvl = bm.loops.layers.uv.new("UVMap")
col = bm.loops.layers.color.new("Col")
normals = []
report = {"wedges": [], "R0": R0, "join": JOIN}
for wi, (c0, c1) in enumerate(wedges):
    verts = {}
    def V(i, j):
        if (i, j) not in verts:
            p = grid[i, j]
            verts[i, j] = bm.verts.new(p)
            n = vn.get((i % ROUND, j))
            verts[i, j].normal = (n.normalized() if n is not None and n.length > 1e-9 else Vector((0, 0, 1)))
        return verts[i, j]
    faces = []
    for q in quads:
        i = q[0][0]
        if c0 <= i < c1:
            # (front faces anticlockwise seen from above, z up: round the angle one way, out the other)
            q = [q[0], q[3], q[2], q[1]]
            vs = [V(*k) for k in q]
            try:
                f = bm.faces.new(vs)
            except ValueError:
                continue
            faces.append((f, q))
    bm.verts.ensure_lookup_table()
    for f, q in faces:
        for loop, k in zip(f.loops, q):
            i, j = k
            p = grid[i, j]
            k_dark = 0.72 + 0.28 * min(max((p.z + SINK - 0.005) / 0.07, 0), 1)
            loop[col] = (k_dark, k_dark, k_dark, 1.0)
            # (pins: the top ring on the trunk's picture; along the trunk's seam its own column)
            th = math.tau * i / ROUND
            loop[uvl].uv = (th * R0, JOIN - p.z)
            loop[uvl].pin_uv = False
    report["wedges"].append({"from": c0, "to": c1, "faces": len(faces)})

# normals before the cut: each vertex its field normal (set below as custom normals)
bm.to_mesh(mesh)
bm.free()
obj = bpy.data.objects.new("root_flare", mesh)
bpy.context.scene.collection.objects.link(obj)
bpy.context.view_layer.objects.active = obj
obj.select_set(True)
for poly in mesh.polygons:
    poly.use_smooth = True
vpos = {tuple(round(c, 6) for c in grid[k]): k for k in grid}
bpy.ops.object.mode_set(mode="EDIT")
bpy.ops.mesh.select_all(action="SELECT")
bpy.ops.uv.select_all(action="SELECT")
bpy.ops.uv.unwrap(method="MINIMUM_STRETCH", margin=0.0, correct_aspect=False)
bpy.ops.object.mode_set(mode="OBJECT")
# each wedge laid on the trunk's picture: turned (and mirrored if need be) and moved, at true size, so that round the
# trunk is u and down and out is v, fitted most closely near the trunk (Procrustes), then kept inside one turn
uv = mesh.uv_layers["UVMap"].data
import numpy as np
start = 0
lo, hi = 9.0, -9.0
for w in report["wedges"]:
    polys = mesh.polygons[start:start + w["faces"]]
    start += w["faces"]
    lis = [li for p in polys for li in p.loop_indices]
    src, dst, wt = [], [], []
    for li in lis:
        k = vpos.get(tuple(round(c, 6) for c in mesh.vertices[mesh.loops[li].vertex_index].co))
        i, j = k
        p = grid[i, j]
        rho = Vector((p.x, p.y)).length
        src.append(uv[li].uv[:])
        dst.append((math.tau * i / ROUND * R0, (JOIN - p.z) + max(rho - R0, 0.0)))
        wt.append(1.0 / (1.0 + 4.0 * j / RINGS))
    S, D, W = np.array(src), np.array(dst), np.array(wt)[:, None]
    # (the unwrap packs its islands into one square: back to true size by the wedge's own area)
    a3 = sum(p.area for p in polys)
    a2 = 0.0
    for p in polys:
        pts = [Vector(uv[li].uv) for li in p.loop_indices]
        for t in range(1, len(pts) - 1):
            a2 += abs((pts[t] - pts[0]).cross(pts[t + 1] - pts[0])) / 2
    S = S * math.sqrt(a3 / a2)
    ms, md = (S * W).sum(0) / W.sum(), (D * W).sum(0) / W.sum()
    H = ((S - ms) * W).T @ (D - md)
    U_, _, Vt = np.linalg.svd(H)
    Rm = (U_ @ Vt).T
    T = (S - ms) @ Rm.T + md
    u = T[:, 0] / (math.tau * R0)
    shift = 0.0
    if u.min() < 0.0: shift = -u.min() + 0.002
    if u.max() + shift > 1.0: shift = 1.0 - 0.002 - u.max()
    w["shift_turns"] = float(shift)
    w["mirrored"] = bool(np.linalg.det(Rm) < 0)
    for n, li in enumerate(lis):
        uv[li].uv = (float(u[n] + shift), float(T[n, 1]))
    lo, hi = min(lo, float(u.min() + shift)), max(hi, float(u.max() + shift))
report["u_range"] = [lo, hi]
# smooth field normals as custom normals (no lighting seam at the cuts)
cn = []
for v in mesh.vertices:
    k = vpos.get(tuple(round(c, 6) for c in v.co))
    n = vn.get((k[0] % ROUND, k[1])) if k else None
    cn.append(tuple(n.normalized()) if n is not None and n.length > 1e-9 else (0, 0, 1))
mesh.normals_split_custom_set_from_vertices(cn)

# stretch check: texel area against true area per face (1 = true size)
import statistics
ratios = []
uv = mesh.uv_layers["UVMap"].data
for poly in mesh.polygons:
    a3 = poly.area
    pts = [Vector(uv[li].uv) for li in poly.loop_indices]
    a2 = 0
    for t in range(1, len(pts) - 1):
        a2 += abs((pts[t] - pts[0]).cross(pts[t + 1] - pts[0])) / 2
    a2 *= (math.tau * R0)  # back to square metres (u was divided)
    if a3 > 1e-7:
        ratios.append(a2 / a3)
ratios.sort()
report["area_ratio_p5_p50_p95"] = [ratios[len(ratios) // 20], statistics.median(ratios), ratios[-len(ratios) // 20]]
report["faces"] = len(mesh.polygons)
report["verts"] = len(mesh.vertices)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, "root_flare.blend"))
bpy.ops.export_scene.gltf(filepath=os.path.join(out, "root_flare.glb"), export_format="GLB", use_selection=True,
                          export_normals=True, export_texcoords=True, export_vertex_color="ACTIVE", export_apply=False)
print("ROOTFLARE " + json.dumps(report))
