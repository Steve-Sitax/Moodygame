# Mesh and scene helpers. Geometry is written in game coordinates (x north, y up, z east)
# and converted to Blender (X = x, Y = -z, Z = y) when a mesh is made.
import bpy, bmesh
import numpy as np
from mathutils import Vector, Matrix

def g2b(p):
    p = np.asarray(p, np.float64)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], -1)

def gv(x, y, z):
    return Vector((x, -z, y))

def coll(name, parent=None):
    c = bpy.data.collections.get(name)
    if c is None:
        c = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(c)
    return c

def link(ob, c):
    for oc in list(ob.users_collection):
        oc.objects.unlink(ob)
    c.objects.link(ob)
    return ob

def mesh_from_faces(name, V, F, uv=None, attrs=None, smooth=True, game=True, coll_=None, mat=None, uv2=None):
    """V: (N,3) vertices (game coords if game=True). F: list/array of faces (index lists, any size).
    uv: per-loop (L,2) in face order. attrs: name -> per-vertex RGBA (N,4) float."""
    V = np.asarray(V, np.float64)
    if game:
        V = g2b(V)
    me = bpy.data.meshes.new(name)
    me.vertices.add(len(V))
    me.vertices.foreach_set('co', V.astype(np.float32).ravel())
    if isinstance(F, np.ndarray) and F.ndim == 2:
        sizes = np.full(len(F), F.shape[1], np.int64)
        flat = F.ravel()
    else:
        sizes = np.array([len(f) for f in F], np.int64)
        flat = np.concatenate([np.asarray(f, np.int64) for f in F]) if len(F) else np.zeros(0, np.int64)
    me.loops.add(len(flat))
    me.loops.foreach_set('vertex_index', flat.astype(np.int32))
    me.polygons.add(len(sizes))
    starts = np.r_[0, np.cumsum(sizes)[:-1]]
    me.polygons.foreach_set('loop_start', starts.astype(np.int32))
    me.update(calc_edges=True)
    if uv is not None:
        ul = me.uv_layers.new(name='UVMap')
        ul.data.foreach_set('uv', np.asarray(uv, np.float32).ravel())
    if uv2 is not None:
        ul = me.uv_layers.new(name='UV2')
        ul.data.foreach_set('uv', np.asarray(uv2, np.float32).ravel())
    if attrs:
        for an, av in attrs.items():
            a = me.color_attributes.new(an, 'FLOAT_COLOR', 'POINT')
            a.data.foreach_set('color', np.asarray(av, np.float32).ravel())
    me.validate(clean_customdata=False)
    if smooth:
        me.polygons.foreach_set('use_smooth', np.ones(len(me.polygons), bool))
    ob = bpy.data.objects.new(name, me)
    (coll_ or bpy.context.scene.collection).objects.link(ob)
    if mat is not None:
        me.materials.append(mat)
    return ob

def grid_faces(n, m, closed_u=False, closed_v=False, keep=None):
    """Quad faces for an n (u) x m (v) vertex grid indexed i*m+j. keep: (n-1 or n, m-1 or m) bool per cell."""
    nu = n if closed_u else n - 1
    nv = m if closed_v else m - 1
    i, j = np.meshgrid(np.arange(nu), np.arange(nv), indexing='ij')
    i1 = (i + 1) % n
    j1 = (j + 1) % m
    f = np.stack([i * m + j, i1 * m + j, i1 * m + j1, i * m + j1], -1)
    if keep is not None:
        f = f[keep[:nu, :nv]]
    return f.reshape(-1, 4)

def grid_mesh(name, P, UV, attrs=None, closed_u=False, closed_v=False, keep=None, flip=False, **kw):
    """P: (n,m,3) game coords, UV: (n,m,2) metres. Per-vertex UV copied to loops."""
    n, m = P.shape[:2]
    F = grid_faces(n, m, closed_u, closed_v, keep)
    if flip:
        F = F[:, ::-1]
    V = P.reshape(-1, 3)
    uvv = UV.reshape(-1, 2)
    uvl = uvv[F.ravel()]
    at = None
    if attrs:
        at = {k: v.reshape(-1, 4) for k, v in attrs.items()}
    ob = mesh_from_faces(name, V, F, uv=uvl, attrs=at, **kw)
    return ob

def remove_loose(ob):
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context='VERTS')
    bm.to_mesh(ob.data)
    bm.free()

def add_adaptive(ob, pixel=1.0):
    m = ob.modifiers.new('Displace detail', 'SUBSURF')
    m.subdivision_type = 'SIMPLE'
    m.levels = 0
    m.render_levels = 1
    m.use_adaptive_subdivision = True
    m.adaptive_space = 'PIXEL'
    m.adaptive_pixel_size = pixel
    return m

def set_hidden_from_export(ob):
    ob['ruien_export'] = False

def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

class Noise3:
    """Cheap smooth value noise in numpy for weather masks (deterministic)."""
    def __init__(self, seed, scale):
        self.rng = np.random.default_rng(seed)
        self.scale = scale
        self.t = self.rng.random((64, 64, 64)).astype(np.float32)
    def __call__(self, p):
        q = np.asarray(p, np.float64) / self.scale
        i = np.floor(q).astype(np.int64)
        f = q - i
        f = f * f * (3 - 2 * f)
        out = 0.0
        for dx in (0, 1):
            for dy in (0, 1):
                for dz in (0, 1):
                    w = (f[..., 0] if dx else 1 - f[..., 0]) * (f[..., 1] if dy else 1 - f[..., 1]) * (f[..., 2] if dz else 1 - f[..., 2])
                    out = out + w * self.t[(i[..., 0] + dx) % 64, (i[..., 1] + dy) % 64, (i[..., 2] + dz) % 64]
        return out

def fbm3(p, seed, scale, oct=4):
    v, a, tot = 0.0, 1.0, 0.0
    for o in range(oct):
        v = v + a * Noise3(seed + o, scale / (2 ** o))(p)
        tot += a
        a *= 0.5
    return v / tot

# ------------------------------------------------------------ stone blocks with worn arrises and chips
def rounded_box_points(sx, sy, sz, r, res):
    """Surface grid of a rounded box centred at 0 (local coords). Returns verts, quad faces, normals.
    Built as 6 face grids snapped onto a rounded-box SDF surface."""
    verts, faces = [], []
    hx, hy, hz = sx / 2, sy / 2, sz / 2
    base = 0
    for axis in range(3):
        for sign in (-1, 1):
            a1, a2 = [k for k in range(3) if k != axis]
            dims = [sx, sy, sz]
            n1 = max(2, int(np.ceil(dims[a1] / res)) + 1)
            n2 = max(2, int(np.ceil(dims[a2] / res)) + 1)
            t1 = np.linspace(-dims[a1] / 2, dims[a1] / 2, n1)
            t2 = np.linspace(-dims[a2] / 2, dims[a2] / 2, n2)
            # pack more rows near the arrises so the rounding has geometry
            t1 = np.sign(t1) * (np.abs(t1) / (dims[a1] / 2)) ** 0.8 * dims[a1] / 2
            t2 = np.sign(t2) * (np.abs(t2) / (dims[a2] / 2)) ** 0.8 * dims[a2] / 2
            g1, g2 = np.meshgrid(t1, t2, indexing='ij')
            P = np.zeros((n1, n2, 3))
            P[..., axis] = sign * dims[axis] / 2
            P[..., a1] = g1
            P[..., a2] = g2
            F = grid_faces(n1, n2)
            if sign < 0:
                F = F[:, ::-1]
            if axis == 1:
                F = F[:, ::-1]
            verts.append(P.reshape(-1, 3))
            faces.append(F + base)
            base += n1 * n2
    V = np.concatenate(verts)
    F = np.concatenate(faces)
    # merge duplicates along the box edges
    key = np.round(V / 1e-5).astype(np.int64)
    _, idx, inv = np.unique(key, axis=0, return_index=True, return_inverse=True)
    V = V[idx]
    F = inv.ravel()[F]
    # snap to rounded box
    h = np.array([hx, hy, hz])
    core = np.clip(V, -(h - r), h - r)
    d = V - core
    ln = np.linalg.norm(d, axis=1, keepdims=True)
    nrm = np.where(ln > 1e-9, d / np.maximum(ln, 1e-9), 0)
    V = core + nrm * r
    return V, F

def chipped_block(sx, sy, sz, r=0.008, res=0.03, seed=0, chips=6, chip_size=(0.02, 0.07), wear_top=0.0, exposed=None, corners=0, wobble=0.0012):
    """Local-space block (centre origin, game axes: x, y up, z). Rounded arrises plus chips along exposed edges.
    exposed: list of (axis_a, sign_a, axis_b, sign_b) edge selectors; default: all 12 edges."""
    rng = np.random.default_rng(seed)
    V, F = rounded_box_points(sx, sy, sz, r, res)
    h = np.array([sx / 2, sy / 2, sz / 2])
    edges = []
    for a in range(3):
        for b in range(a + 1, 3):
            for sa in (-1, 1):
                for sb in (-1, 1):
                    edges.append((a, sa, b, sb))
    if exposed is not None:
        edges = [e for e in edges if e in exposed or (e[2], e[3], e[0], e[1]) in exposed]
    disp = np.zeros(len(V))
    for k in range(chips):
        a, sa, b, sb = edges[rng.integers(len(edges))]
        c = np.zeros(3)
        c[a] = sa * h[a]
        c[b] = sb * h[b]
        free = 3 - a - b
        c[free] = rng.uniform(-h[free] * 0.9, h[free] * 0.9)
        rad = rng.uniform(*chip_size)
        sc = np.array([1.0, 1.0, 1.0])
        sc[free] = rng.uniform(1.0, 2.5)
        q = (V - c) / sc
        dist = np.linalg.norm(q, axis=1)
        pen = np.clip(rad - dist, 0, None)
        disp = np.maximum(disp, pen * rng.uniform(0.6, 1.0))
    # broken-off corners: a big conchoidal bite out of a few corners
    for k in range(corners):
        c = h * np.array([rng.choice([-1, 1]), rng.choice([-1, 1]) if rng.random() < 0.3 else 1, rng.choice([-1, 1])])
        rad = rng.uniform(0.05, 0.13) * min(1.0, min(sx, sy, sz) / 0.25 + 0.4)
        q = (V - c) / np.array([rng.uniform(0.8, 1.6), rng.uniform(0.6, 1.0), rng.uniform(0.8, 1.6)])
        dist = np.linalg.norm(q, axis=1)
        rough = 1 + 0.15 * np.sin(V[:, 0] * 80 + k) * np.sin(V[:, 2] * 70)
        disp = np.maximum(disp, np.clip(rad * rough - dist, 0, None) * 0.9)
    # irregularity everywhere: low waves along the arrises and fine grain
    p = V + seed * 3.17
    n1 = np.sin(p[:, 0] * 37.1 + np.sin(p[:, 2] * 23.3)) * np.sin(p[:, 1] * 41.7 + p[:, 0] * 11.0)
    n2 = np.sin(p[:, 0] * 9.3 + 1.7) * np.sin(p[:, 2] * 7.1 + 0.4) + 0.5 * np.sin(p[:, 1] * 11.0 + p[:, 2] * 5.0)
    disp = disp + wobble * (n1 + 1) + wobble * 1.5 * (n2 + 1.5)
    # worn (dished) top
    if wear_top > 0:
        top = V[:, 1] > h[1] - 1e-4 - r
        fall = np.exp(-((V[:, 0] / (h[0] * 0.8)) ** 2 + (V[:, 2] / (h[2] * 0.9)) ** 2))
        disp = disp + np.where(top, wear_top * fall, 0)
    # push along the rounded-box normal
    core = np.clip(V, -(h - r), h - r)
    d = V - core
    ln = np.linalg.norm(d, axis=1, keepdims=True)
    nrm = d / np.maximum(ln, 1e-9)
    V = V - nrm * disp[:, None]
    return V, F

def box_uv(V, F, scale=1.0):
    """Per-loop UV by dominant face axis (metres)."""
    uv = np.zeros((F.size, 2))
    Vf = V[F]
    n = np.cross(Vf[:, 1] - Vf[:, 0], Vf[:, 2] - Vf[:, 0])
    ax = np.argmax(np.abs(n), 1)
    k = 0
    for fi, f in enumerate(F):
        a = ax[fi]
        u_ax, v_ax = [(2, 1), (0, 2), (0, 1)][a]
        for vi in f:
            uv[k] = (V[vi, u_ax] * scale, V[vi, v_ax] * scale)
            k += 1
    return uv

def place(ob, loc_game, rot_y_deg=0.0, extra=None):
    """Place an object whose mesh is in local game axes converted to Blender (built with game=True at origin)."""
    ob.location = gv(*loc_game)
    # rotation about game y = Blender Z
    ob.rotation_euler = (0, 0, np.radians(rot_y_deg))
    return ob

def lathe(profile, n=24, name='lathe', coll_=None, mat=None, cap=True):
    """profile: list of (r, y) from bottom to top in game axes. Returns object at origin (game coords)."""
    prof = np.asarray(profile, np.float64)
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    P = np.zeros((len(prof), n, 3))
    P[..., 0] = prof[:, 0:1] * np.cos(ang)[None]
    P[..., 2] = prof[:, 0:1] * np.sin(ang)[None]
    P[..., 1] = prof[:, 1:2]
    UV = np.zeros((len(prof), n, 2))
    UV[..., 0] = (ang / (2 * np.pi))[None] * 2 * np.pi * max(prof[:, 0].max(), 0.01)
    UV[..., 1] = prof[:, 1:2]
    return grid_mesh(name, P, UV, closed_v=True, coll_=coll_, mat=mat, flip=False)

def hexa_block(C, r=0.008, res=0.04, seed=0, chips=5, chip_size=(0.02, 0.06), wear_top=0.0, corners=0, wobble=0.0012):
    """Stone with 8 arbitrary corners C (8,3, game coords) ordered like the unit cube
    (x,y,z) in {0,1}: index = x + 2*y + 4*z. Rounded arrises and chips are made on an
    equivalent box, then mapped trilinearly onto the corners."""
    C = np.asarray(C, np.float64)
    sx = np.mean([np.linalg.norm(C[i + 1] - C[i]) for i in (0, 2, 4, 6)])
    sy = np.mean([np.linalg.norm(C[i + 2] - C[i]) for i in (0, 1, 4, 5)])
    sz = np.mean([np.linalg.norm(C[i + 4] - C[i]) for i in (0, 1, 2, 3)])
    V, F = chipped_block(sx, sy, sz, r=r, res=res, seed=seed, chips=chips, chip_size=chip_size, wear_top=wear_top, corners=corners, wobble=wobble)
    t = (V + np.array([sx, sy, sz]) / 2) / np.array([sx, sy, sz])
    tx, ty, tz = t[:, 0:1], t[:, 1:2], t[:, 2:3]
    P = np.zeros_like(V)
    for i in range(8):
        bx, by, bz = i & 1, (i >> 1) & 1, (i >> 2) & 1
        w = (tx if bx else 1 - tx) * (ty if by else 1 - ty) * (tz if bz else 1 - tz)
        P += w * C[i]
    # keep winding outward if the corner frame is left handed
    e1, e2, e3 = C[1] - C[0], C[2] - C[0], C[4] - C[0]
    if np.dot(np.cross(e1, e2), e3) < 0:
        F = F[:, ::-1]
    return P, F, V

def block_object(name, C, mat, coll_, **kw):
    P, F, V = hexa_block(C, **kw)
    uv = box_uv(P, F)
    return mesh_from_faces(name, P, F, uv=uv, coll_=coll_, mat=mat)

def box_corners(x0, x1, y0, y1, z0, z1):
    return np.array([[x0 if not (i & 1) else x1, y0 if not (i & 2) else y1, z0 if not (i & 4) else z1] for i in range(8)], np.float64)

def tube(name, pts, radii, n=10, coll_=None, mat=None, cap=True, flat=1.0):
    """Tube along a polyline (game coords) with per-point radius. flat < 1 squashes the section vertically."""
    pts = np.asarray(pts, np.float64)
    radii = np.broadcast_to(np.asarray(radii, np.float64), (len(pts),))
    T = np.gradient(pts, axis=0)
    T /= np.linalg.norm(T, axis=1, keepdims=True) + 1e-12
    ref = np.array([0, 1.0, 0])
    P = np.zeros((len(pts), n, 3))
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    for i in range(len(pts)):
        a = np.cross(T[i], ref)
        if np.linalg.norm(a) < 1e-6:
            a = np.cross(T[i], np.array([1.0, 0, 0]))
        a /= np.linalg.norm(a)
        b = np.cross(a, T[i])
        P[i] = pts[i] + radii[i] * (np.cos(ang)[:, None] * a + flat * np.sin(ang)[:, None] * b)
    seg = np.r_[0, np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))]
    UV = np.stack(np.broadcast_arrays(seg[:, None], (ang / (2 * np.pi) * 2 * np.pi * radii.mean())[None, :]), -1)
    F = grid_faces(len(pts), n, closed_v=True)
    V = P.reshape(-1, 3)
    faces = [f for f in F]
    if cap:
        c0 = len(V); V = np.vstack([V, pts[0], pts[-1]])
        for j in range(n):
            faces.append([c0, (j + 1) % n, j])
            faces.append([c0 + 1, (len(pts) - 1) * n + j, (len(pts) - 1) * n + (j + 1) % n])
    uvl = np.concatenate([np.r_[UV.reshape(-1, 2), [[0, 0], [0, 0]]][np.asarray(f)] for f in faces])
    return mesh_from_faces(name, V, faces, uv=uvl, coll_=coll_, mat=mat)

def join(objs, name):
    """Merge mesh objects into one (world positions baked, materials kept). Pure data, no operators,
    so it stays fast in a scene with thousands of objects."""
    objs = [o for o in objs if o is not None and o.type == 'MESH']
    if not objs:
        return None
    Vs, Fs, UVs, mats, midx = [], [], [], [], []
    base = 0
    for o in objs:
        me = o.data
        nv = len(me.vertices)
        co = np.zeros(nv * 3, np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        M = np.array(o.matrix_world)
        co = co @ M[:3, :3].T + M[:3, 3]
        nl = len(me.loops)
        vi = np.zeros(nl, np.int32); me.loops.foreach_get('vertex_index', vi)
        np_ = len(me.polygons)
        ls = np.zeros(np_, np.int32); me.polygons.foreach_get('loop_start', ls)
        lt = np.zeros(np_, np.int32); me.polygons.foreach_get('loop_total', lt)
        mi = np.zeros(np_, np.int32); me.polygons.foreach_get('material_index', mi)
        if me.uv_layers:
            uv = np.zeros(nl * 2, np.float32); me.uv_layers[0].data.foreach_get('uv', uv); uv = uv.reshape(-1, 2)
        else:
            uv = np.zeros((nl, 2), np.float32)
        local = []
        for m_ in me.materials:
            if m_ not in mats:
                mats.append(m_)
            local.append(mats.index(m_))
        for k in range(np_):
            Fs.append(vi[ls[k]:ls[k] + lt[k]] + base)
            midx.append(local[mi[k]] if local else 0)
        UVs.append(uv)
        Vs.append(co)
        base += nv
    V = np.concatenate(Vs)
    coll_ = objs[0].users_collection[0]
    ob = mesh_from_faces(name, V, Fs, uv=np.concatenate(UVs), game=False, coll_=coll_, smooth=True)
    for m_ in mats:
        ob.data.materials.append(m_)
    ob.data.polygons.foreach_set('material_index', np.array(midx, np.int32))
    for o in objs:
        me = o.data
        bpy.data.objects.remove(o)
        if me.users == 0:
            bpy.data.meshes.remove(me)
    return ob

BOX_FACES = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]

def box_mesh(name, x0, x1, y0, y1, z0, z1, mat, coll_):
    return mesh_from_faces(name, box_corners(x0, x1, y0, y1, z0, z1), BOX_FACES, coll_=coll_, mat=mat, smooth=False)
