# Reusable props. Meshes are built in local game axes unless noted.
import numpy as np
import bpy
from mathutils import Matrix, Vector
import spec
from . import util as U

def frame_matrix(loc, t, r, d):
    """Object matrix from game-space axis vectors (local X = t, local Y = r, local Z = d), for meshes built with game=False."""
    t, r, d = (np.asarray(v, np.float64) for v in (t, r, d))
    if np.dot(np.cross(t, r), d) < 0:
        t = -t
    cols = [U.g2b(v) for v in (t, r, d)]
    m = Matrix(((cols[0][0], cols[1][0], cols[2][0], 0), (cols[0][1], cols[1][1], cols[2][1], 0), (cols[0][2], cols[1][2], cols[2][2], 0), (0, 0, 0, 1)))
    m.translation = Vector(U.g2b(np.asarray(loc)))
    return m

def instance(mesh, name, coll_, matrix):
    ob = bpy.data.objects.new(name, mesh)
    coll_.objects.link(ob)
    ob.matrix_world = matrix
    return ob

def bevel_mod(ob, w=0.002, seg=2, angle=40):
    m = ob.modifiers.new('Bevel', 'BEVEL')
    m.width = w
    m.segments = seg
    m.limit_method = 'ANGLE'
    m.angle_limit = np.radians(angle)
    m.harden_normals = False
    return m

# ------------------------------------------------------------------ gears and racks (local: disc in XY, axis Z)
def gear(name, r, teeth, thick, mat, coll_, hub_r=None, spokes=0, rim=0.05):
    m = 2 * r / teeth
    ra, rd = r + m * 0.9, r - m * 1.15
    k = teeth * 4
    ang = []
    rad = []
    for i in range(teeth):
        a0 = 2 * np.pi * i / teeth
        da = 2 * np.pi / teeth
        for f, rr in ((0.0, rd), (0.18, ra), (0.5, ra), (0.68, rd)):
            ang.append(a0 + f * da); rad.append(rr)
    ang = np.array(ang); rad = np.array(rad)
    O = np.stack([rad * np.cos(ang), rad * np.sin(ang)], -1)
    ri = rd - rim if spokes else (hub_r or r * 0.25) * 0.5
    I = np.stack([ri * np.cos(ang), ri * np.sin(ang)], -1)
    V = []
    for z in (-thick / 2, thick / 2):
        V += [[p[0], p[1], z] for p in O]
    for z in (-thick / 2, thick / 2):
        V += [[p[0], p[1], z] for p in I]
    V = np.array(V)
    F = []
    for i in range(k):
        j = (i + 1) % k
        ob_, ot = i, k + i
        F.append([k + i, k + j, 3 * k + j, 3 * k + i])          # top annulus
        F.append([j, i, 2 * k + i, 2 * k + j])                  # bottom annulus
        F.append([i, j, k + j, k + i])                          # outer wall
        F.append([2 * k + j, 2 * k + i, 3 * k + i, 3 * k + j])  # inner wall
    parts = [(V, F)]
    hub = hub_r or r * 0.25
    # hub
    hv, hf = cyl_np(hub, thick * 1.6, 20)
    parts.append((hv, hf))
    if spokes:
        for s in range(spokes):
            a = 2 * np.pi * s / spokes
            L = ri + 0.01 - hub * 0.8
            c = (hub * 0.8 + L / 2)
            bv, bf = U.chipped_block(L, thick * 0.5, thick * 0.6, r=0.004, res=0.05, chips=0)
            ca, sa = np.cos(a), np.sin(a)
            bx = bv[:, 0] + c
            bv2 = np.stack([bx * ca - bv[:, 1] * sa, bx * sa + bv[:, 1] * ca, bv[:, 2]], -1)
            parts.append((bv2, bf))
    ob = merge_parts(name, parts, mat, coll_)
    bevel_mod(ob, 0.003, 2, 35)
    return ob

def cyl_np(r, h, n, z0=None):
    a = np.linspace(0, 2 * np.pi, n, endpoint=False)
    z0 = -h / 2 if z0 is None else z0
    V = np.concatenate([np.stack([r * np.cos(a), r * np.sin(a), np.full(n, z0)], -1),
                        np.stack([r * np.cos(a), r * np.sin(a), np.full(n, z0 + h)], -1),
                        [[0, 0, z0], [0, 0, z0 + h]]])
    F = []
    for i in range(n):
        j = (i + 1) % n
        F.append([i, j, n + j, n + i])
        F.append([2 * n, j, i])
        F.append([2 * n + 1, n + i, n + j])
    return V, F

def merge_parts(name, parts, mat, coll_):
    V, F, base = [], [], 0
    for v, f in parts:
        V.append(np.asarray(v))
        F += [list(np.asarray(ff) + base) for ff in f]
        base += len(v)
    V = np.concatenate(V)
    return U.mesh_from_faces(name, V, F, uv=U.box_uv(V, [np.asarray(f) for f in F]) if False else None, game=False, coll_=coll_, mat=mat)

def rack(name, length, pitch, mat, coll_, w=0.07, d=0.045):
    """Toothed bar along local Y, teeth on +X face."""
    parts = []
    bv, bf = U.chipped_block(d, length, w, r=0.003, res=0.06, chips=0)
    parts.append((bv, bf))
    n = int(length / pitch)
    for i in range(n):
        y = -length / 2 + (i + 0.5) * pitch
        tv = np.array([[d / 2, y - pitch * 0.32, -w / 2], [d / 2 + pitch * 0.45, y - pitch * 0.12, -w / 2], [d / 2 + pitch * 0.45, y + pitch * 0.12, -w / 2], [d / 2, y + pitch * 0.32, -w / 2]])
        tv = np.concatenate([tv, tv + [0, 0, w]])
        tf = [[0, 1, 2, 3], [7, 6, 5, 4], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]]
        parts.append((tv, tf))
    ob = merge_parts(name, parts, mat, coll_)
    bevel_mod(ob, 0.002, 1, 35)
    return ob

def chain(name, p0, p1, sag, links, mat, coll_, lr=0.035, wire=0.007):
    """Chain hanging between two game points as a catenary-like curve."""
    p0, p1 = np.asarray(p0, float), np.asarray(p1, float)
    obs = []
    t = np.linspace(0, 1, links)
    pts = p0[None] * (1 - t[:, None]) + p1[None] * t[:, None]
    pts[:, 1] -= sag * 4 * t * (1 - t)
    ring_v, ring_f = torus_np(lr, wire, 12, 6, elong=1.6)
    parts = []
    for i in range(links - 1):
        a, b = pts[i], pts[i + 1]
        c = (a + b) / 2
        tdir = (b - a) / (np.linalg.norm(b - a) + 1e-9)
        side = np.cross(tdir, [0, 1.0, 0]) if abs(tdir[1]) < 0.95 else np.cross(tdir, [1.0, 0, 0])
        side /= np.linalg.norm(side)
        if i % 2:
            side = np.cross(tdir, side)
        up = np.cross(side, tdir)
        R = np.stack([side, tdir, up], 1)  # local x->side, y->along, z->up
        v = ring_v @ R.T + c
        parts.append((v, ring_f))
    V, F, base = [], [], 0
    for v, f in parts:
        V.append(v); F += [list(np.asarray(ff) + base) for ff in f]; base += len(v)
    return U.mesh_from_faces(name, np.concatenate(V), F, coll_=coll_, mat=mat)

def torus_np(R, r, n1, n2, elong=1.0):
    u = np.linspace(0, 2 * np.pi, n1, endpoint=False)
    v = np.linspace(0, 2 * np.pi, n2, endpoint=False)
    U_, V_ = np.meshgrid(u, v, indexing='ij')
    x = (R + r * np.cos(V_)) * np.cos(U_)
    y = (R + r * np.cos(V_)) * np.sin(U_) * elong
    z = r * np.sin(V_)
    P = np.stack([x, y, z], -1).reshape(-1, 3)
    F = U.grid_faces(n1, n2, True, True)
    return P, [list(f) for f in F]

def ring_on_staple(name, loc, face_dir, mat, coll_, R=0.075, r=0.012, hang=0.0):
    """Iron mooring ring hanging from a staple set in a face. face_dir: outward normal (game)."""
    fd = np.asarray(face_dir, float); fd /= np.linalg.norm(fd)
    side = np.cross(fd, [0, 1.0, 0]); side /= np.linalg.norm(side)
    tv, tf = torus_np(R, r, 24, 8)
    # ring plane: contains up and the face normal, tilted a little off the wall
    tilt = 0.25
    ax_y = np.array([0, 1.0, 0]) * np.cos(tilt) + fd * np.sin(tilt)
    R_ = np.stack([fd * np.cos(tilt) - np.array([0, 1.0, 0]) * np.sin(tilt), ax_y, side], 1)
    c = np.asarray(loc) + fd * 0.05 - ax_y * R
    v = tv @ np.stack([R_[:, 0], R_[:, 1], R_[:, 2]], 1).T * 1.0
    v = (tv[:, 0:1] * R_[:, 0] + tv[:, 1:2] * R_[:, 1] + tv[:, 2:3] * R_[:, 2]) + c
    ring = U.mesh_from_faces(name, v, tf, coll_=coll_, mat=mat)
    st = U.tube(name + '_staple', [np.asarray(loc) - fd * 0.04 - side * 0.03, np.asarray(loc) + fd * 0.045 - side * 0.03,
                                   np.asarray(loc) + fd * 0.06, np.asarray(loc) + fd * 0.045 + side * 0.03, np.asarray(loc) - fd * 0.04 + side * 0.03], 0.012, n=8, coll_=coll_, mat=mat)
    return [ring, st]

# ------------------------------------------------------------------ oil safety lamp (local game axes, origin at the hanging ring)
def safety_lamp(name, mats, coll_, light_power=6.0, temp_col=(1.0, 0.74, 0.52), linear=False):
    obs = []
    # profile below the ring: hook ring, top cap, gauze, glass, oil pot
    cap = [(0.0, -0.045), (0.018, -0.045), (0.03, -0.06), (0.036, -0.075), (0.036, -0.085), (0.0, -0.085)]
    gauze = [(0.026, -0.085), (0.026, -0.155)]
    glass = [(0.031, -0.155), (0.032, -0.165), (0.032, -0.225), (0.031, -0.232)]
    pot = [(0.0, -0.232), (0.04, -0.232), (0.042, -0.24), (0.042, -0.29), (0.036, -0.3), (0.0, -0.3)]
    o = U.lathe(cap, 24, name + '_cap', coll_, mats['brass']); obs.append(o)
    o = U.lathe(gauze, 24, name + '_gauze', coll_, mats['gauze']); obs.append(o)
    o = U.lathe(glass, 24, name + '_glass', coll_, mats['glass']); obs.append(o)
    o = U.lathe(pot, 24, name + '_pot', coll_, mats['brass']); obs.append(o)
    # guard pillars around the glass
    for k in range(4):
        a = k * np.pi / 2 + 0.4
        p = np.array([0.038 * np.cos(a), 0, 0.038 * np.sin(a)])
        obs.append(U.tube(name + '_pillar', [p + [0, -0.085, 0], p + [0, -0.232, 0]], 0.0035, n=6, coll_=coll_, mat=mats['brass']))
    # ring and hook eye at the top
    tv, tf = torus_np(0.02, 0.0035, 16, 6)
    tv = tv[:, [0, 2, 1]] + [0, -0.025, 0]
    obs.append(U.mesh_from_faces(name + '_ring', tv, tf, coll_=coll_, mat=mats['brass']))
    obs.append(U.tube(name + '_stem', [[0, -0.045, 0], [0, -0.03, 0]], 0.004, n=6, coll_=coll_, mat=mats['brass']))
    # flame
    fl = U.lathe([(0.0, -0.205), (0.006, -0.2), (0.008, -0.19), (0.005, -0.178), (0.0, -0.168)], 12, name + '_flame', coll_, mats['flame'])
    obs.append(fl)
    lamp = U.join(obs, name)
    L = bpy.data.lights.new(name + '_light', 'POINT')
    L.energy = light_power
    L.color = temp_col
    L.shadow_soft_size = 0.012
    if linear:
        linear_falloff(L)
    lo = bpy.data.objects.new(name + '_light', L)
    coll_.objects.link(lo)
    lo.parent = lamp
    lo.location = U.gv(0, -0.19, 0)
    return lamp, lo

def linear_falloff(L, k=1.0):
    """Practical lamps use a 1/r falloff so their pools reach down the tunnels (a deliberate lighting cheat)."""
    L.use_nodes = True
    nt = L.node_tree
    em = [n for n in nt.nodes if n.type == 'EMISSION'][0]
    fo = nt.nodes.new('ShaderNodeLightFalloff')
    fo.inputs['Strength'].default_value = k
    nt.links.new(fo.outputs['Linear'], em.inputs['Strength'])
    return L

def lamp_bracket(name, wall_pt, out_dir, length, mat, coll_):
    """Wrought iron wall bracket with a hook at the end. Returns (object, hook point)."""
    w = np.asarray(wall_pt, float); d = np.asarray(out_dir, float); d /= np.linalg.norm(d)
    tip = w + d * length
    pts = [w - d * 0.08, w, w + d * length * 0.6, tip, tip + np.array([0, -0.04, 0]), tip + np.array([0, -0.07, 0]) - d * 0.02, tip + np.array([0, -0.06, 0]) - d * 0.04]
    arm = U.tube(name, pts, 0.011, n=8, coll_=coll_, mat=mat)
    # diagonal stay under the arm
    stay = U.tube(name + '_stay', [w + np.array([0, -0.3, 0]) - d * 0.05, w + np.array([0, -0.3, 0]), w + d * length * 0.55], 0.008, n=8, coll_=coll_, mat=mat)
    plate = U.block_object(name + '_plate', U.box_corners(-0.04, 0.04, -0.36, 0.06, -0.006, 0.006) @ np.eye(3) + 0, mat, coll_, r=0.002, res=0.03, chips=0)
    # orient plate on the wall: rebuild in world
    bpy.data.objects.remove(plate)
    side = np.cross(d, [0, 1.0, 0]); side /= np.linalg.norm(side)
    C = np.array([w + side * (-0.045 if not (j & 1) else 0.045) + np.array([0, -0.36 if not (j & 2) else 0.06, 0]) + d * (-0.004 if not (j & 4) else 0.01) for j in range(8)])
    plate = U.block_object(name + '_plate', C, mat, coll_, r=0.002, res=0.03, chips=0)
    return [arm, stay, plate], tip + np.array([0, -0.065, 0]) - d * 0.03

# ------------------------------------------------------------------ lime straws (stalactites), local game axes, top at origin
def straw_variants(mat, coll_, n=8, seed=7):
    rng = np.random.default_rng(seed)
    meshes = []
    for i in range(n):
        L = rng.uniform(0.6, 1.0)
        prof = [(0.0, 0.004), (0.014 + rng.uniform(0, 0.01), 0.004), (0.011, -0.02), (0.0065, -0.08)]
        y = -0.08
        r = 0.006
        while y > -L:
            y -= rng.uniform(0.03, 0.08)
            r = max(0.0022, r * rng.uniform(0.86, 1.0) + rng.normal(0, 0.0006))
            prof.append((r, y))
        prof.append((r * 0.8, -L - 0.006)); prof.append((0.0, -L - 0.012))
        ob = U.lathe(prof, 8, 'straw_v%d' % i, coll_, mat)
        # bend slightly
        me = ob.data
        co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        bend = rng.normal(0, 0.03)
        co[:, 0] += bend * (co[:, 2] ** 2)
        me.vertices.foreach_set('co', co.ravel()); me.update()
        meshes.append(me)
        bpy.data.objects.remove(ob)
    return meshes

def drop_mesh(mat, coll_):
    ob = U.lathe([(0.0, 0.0), (0.0025, -0.002), (0.003, -0.005), (0.002, -0.0075), (0.0, -0.0085)], 8, 'drop', coll_, mat)
    me = ob.data
    bpy.data.objects.remove(ob)
    return me

# ------------------------------------------------------------------ rubble bricks (local game axes, centred)
def brick_variants(mat, coll_, n=24, seed=21):
    rng = np.random.default_rng(seed)
    out = []
    for i in range(n):
        L = rng.choice([0.19, 0.15, 0.11, 0.09, 0.07, 0.05]) * rng.uniform(0.9, 1.05)
        wd = rng.choice([0.09, 0.07, 0.05]) * rng.uniform(0.9, 1.05)
        V, F = U.chipped_block(L, 0.05 * rng.uniform(0.7, 1.0), wd, r=rng.uniform(0.004, 0.012), res=0.015, seed=3000 + i, chips=rng.integers(5, 12), chip_size=(0.01, 0.045), corners=int(rng.integers(0, 3)), wobble=0.002)
        if rng.random() < 0.3:   # mortar still stuck to one face
            V[:, 1] += np.where(V[:, 1] > 0.015, rng.uniform(0.003, 0.008), 0)
        ob = U.mesh_from_faces('brickpiece_v%d' % i, V, F, uv=U.box_uv(V, F), coll_=coll_, mat=mat)
        out.append(ob.data)
        bpy.data.objects.remove(ob)
    return out

def scatter_instances(meshes, pts, rng, coll_, name, yaw=True, scale=(0.9, 1.1), tilt=0.15, settle=None):
    obs = []
    for i, p in enumerate(pts):
        me = meshes[rng.integers(len(meshes))]
        ob = bpy.data.objects.new('%s_%03d' % (name, i), me)
        coll_.objects.link(ob)
        ob.location = U.gv(*p)
        ob.rotation_euler = (rng.normal(0, tilt), rng.normal(0, tilt), rng.uniform(0, 2 * np.pi) if yaw else 0)
        s = rng.uniform(*scale)
        ob.scale = (s, s, s)
        obs.append(ob)
    return obs

# ------------------------------------------------------------------ wood: planks, crates, barrel, branches
def plank(name, L, w, t, mat, coll_, seed=0, broken=True):
    rng = np.random.default_rng(seed)
    V, F = U.chipped_block(L, t, w, r=0.003, res=0.03, seed=seed, chips=rng.integers(2, 6), chip_size=(0.01, 0.04))
    if broken:
        end = V[:, 0] > L / 2 - 0.06
        V[end, 0] -= np.abs(np.sin(V[end, 2] * 60 + seed)) * 0.05
    # warp
    V[:, 1] += 0.01 * np.sin(V[:, 0] / L * 3 + seed)
    return U.mesh_from_faces(name, V, F, uv=U.box_uv(V, F), coll_=coll_, mat=mat)

def barrel(name, mats, coll_, seed=0, h=0.75, r=0.27, staves=18, broken=0):
    rng = np.random.default_rng(seed)
    obs = []
    for i in range(staves):
        if broken and rng.random() < broken:
            continue
        a0 = 2 * np.pi * i / staves
        a1 = 2 * np.pi * (i + 0.94) / staves
        ys = np.linspace(-h / 2, h / 2, 9)
        rr = r * (0.86 + 0.14 * np.cos(ys / (h / 2) * np.pi / 2.2))
        P = []
        for yv, rv in zip(ys, rr):
            for a in np.linspace(a0, a1, 3):
                for th in (0, 0.02):
                    P.append([(rv - th) * np.cos(a), yv, (rv - th) * np.sin(a)])
        P = np.array(P).reshape(9, 3, 2, 3)
        outer = P[:, :, 0]; inner = P[:, :, 1]
        V = np.concatenate([outer.reshape(-1, 3), inner.reshape(-1, 3)])
        F = []
        n = 27
        for a in range(8):
            for b in range(2):
                q = a * 3 + b
                F.append([q, q + 3, q + 4, q + 1][::-1])
                F.append([n + q, n + q + 1, n + q + 4, n + q + 3][::-1])
        for a in range(8):
            for b in (0, 2):
                q = a * 3 + b
                F.append([q, n + q, n + q + 3, q + 3] if b == 0 else [q + 3, n + q + 3, n + q, q])
        for b in range(2):
            F.append([b, b + 1, n + b + 1, n + b])
            F.append([24 + b + 1, 24 + b, n + 24 + b, n + 24 + b + 1])
        obs.append(U.mesh_from_faces(name + '_stave', V, F, uv=U.box_uv(V, [np.asarray(f) for f in F]) if False else None, coll_=coll_, mat=mats['wood']))
    for yv in (-h * 0.38, -h * 0.18, h * 0.18, h * 0.38):
        rv = r * (0.86 + 0.14 * np.cos(yv / (h / 2) * np.pi / 2.2)) + 0.004
        a = np.linspace(0, 2 * np.pi, 33)
        pts = np.stack([rv * np.cos(a), np.full_like(a, yv), rv * np.sin(a)], -1)
        obs.append(U.tube(name + '_hoop', pts, 0.006, n=6, coll_=coll_, mat=mats['iron'], flat=3.0))
    return U.join(obs, name)

def crate(name, mats, coll_, seed=0, size=(0.6, 0.45, 0.45), broken=0.3):
    rng = np.random.default_rng(seed)
    sx, sy, sz = size
    obs = []
    k = 0
    for face in range(5):
        for j in range(3):
            if rng.random() < broken:
                continue
            w = sz / 3 - 0.01
            if face in (0, 1):       # long sides, boards along x
                p = plank('%s_b%d' % (name, k), sx, sy / 3 - 0.01, 0.018, mats['wood'], coll_, seed=seed * 50 + k, broken=rng.random() < 0.4)
                p.location = U.gv(0, -sy / 2 + (j + 0.5) * sy / 3, (sz / 2) * (1 if face else -1))
                p.rotation_euler = (np.pi / 2, 0, 0)
            elif face in (2, 3):     # ends
                p = plank('%s_b%d' % (name, k), sz, sy / 3 - 0.01, 0.018, mats['wood'], coll_, seed=seed * 50 + k, broken=rng.random() < 0.4)
                p.location = U.gv((sx / 2) * (1 if face == 3 else -1), -sy / 2 + (j + 0.5) * sy / 3, 0)
                p.rotation_euler = (np.pi / 2, 0, np.pi / 2)
            else:                    # bottom
                p = plank('%s_b%d' % (name, k), sx, sz / 3 - 0.01, 0.018, mats['wood'], coll_, seed=seed * 50 + k)
                p.location = U.gv(0, -sy / 2, -sz / 2 + (j + 0.5) * sz / 3)
            p.rotation_euler = tuple(np.array(p.rotation_euler) + rng.normal(0, 0.04, 3))
            obs.append(p)
            k += 1
    for o in obs:
        o.select_set(False)
    bpy.context.view_layer.update()
    for o in obs:
        mw = o.matrix_world.copy()
        o.data.transform(mw)
        o.matrix_world = Matrix.Identity(4)
    return U.join(obs, name)

def branch(name, mat, coll_, seed=0, L=1.4, r=0.025):
    rng = np.random.default_rng(seed)
    t = np.linspace(0, 1, 14)
    d = np.cumsum(rng.normal(0, 0.05, (14, 3)), 0)
    pts = np.stack([t * L, d[:, 1] * 0.5, d[:, 2]], -1)
    rad = r * (1 - 0.7 * t)
    parts = [U.tube(name, pts, rad, n=8, coll_=coll_, mat=mat)]
    for k in range(rng.integers(1, 4)):
        i = rng.integers(3, 11)
        dirn = np.array([0.5, rng.normal(0, 0.3), rng.choice([-1, 1]) * 0.8])
        dirn /= np.linalg.norm(dirn)
        ln = rng.uniform(0.15, 0.4)
        p2 = [pts[i], pts[i] + dirn * ln * 0.5 + rng.normal(0, 0.02, 3), pts[i] + dirn * ln]
        parts.append(U.tube(name + '_tw', p2, [rad[i] * 0.6, rad[i] * 0.4, rad[i] * 0.2], n=6, coll_=coll_, mat=mat))
    return U.join(parts, name)

# ------------------------------------------------------------------ bones and offal (local game axes)
def long_bone(name, mat, coll_, seed=0, L=0.4, r=0.022):
    rng = np.random.default_rng(seed)
    ys = np.linspace(0, L, 22)
    t = ys / L
    knob = 1 + 1.3 * np.exp(-((t - 0.04) / 0.07) ** 2) + 1.1 * np.exp(-((t - 0.96) / 0.07) ** 2)
    prof = [(0, -0.002)] + [(r * k * (0.9 + 0.1 * np.sin(i * 1.7 + seed)), y) for i, (k, y) in enumerate(zip(knob, ys))] + [(0, L + 0.004)]
    ob = U.lathe(prof, 12, name, coll_, mat)
    me = ob.data
    co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    # flatten the condyles and bend the shaft a little
    zr = co[:, 2] / L
    co[:, 0] *= 1 + 0.35 * (np.exp(-((zr - 0.04) / 0.08) ** 2) + np.exp(-((zr - 0.96) / 0.08) ** 2))
    co[:, 1] += 0.015 * np.sin(zr * np.pi) * rng.uniform(0.5, 1.5)
    me.vertices.foreach_set('co', co.ravel()); me.update()
    return ob

def rib(name, mat, coll_, seed=0):
    rng = np.random.default_rng(seed)
    a = np.linspace(0, rng.uniform(1.2, 1.8), 16)
    R = rng.uniform(0.25, 0.4)
    pts = np.stack([R * np.sin(a), np.zeros_like(a), R * (1 - np.cos(a))], -1)
    return U.tube(name, pts, np.linspace(0.011, 0.006, 16), n=6, coll_=coll_, mat=mat, flat=0.45)

def skull(name, mat, coll_, seed=0, kind='cow'):
    """Simplified cattle or pig skull: deformed sphere with a long snout, orbits, horn cores."""
    rng = np.random.default_rng(seed)
    nu, nv = 28, 18
    u = np.linspace(0, 2 * np.pi, nu, endpoint=False)
    v = np.linspace(0.05, np.pi - 0.05, nv)
    Uu, Vv = np.meshgrid(u, v, indexing='ij')
    x = np.sin(Vv) * np.cos(Uu); y = np.cos(Vv); z = np.sin(Vv) * np.sin(Uu)
    P = np.stack([x, y, z], -1)
    # long axis along +x (snout)
    L = 0.42 if kind == 'cow' else 0.3
    snout = np.clip(P[..., 0], 0, 1)
    P[..., 0] = P[..., 0] * (0.1 + 0.32 * snout) * (L / 0.42) + 0.0
    P[..., 1] *= 0.09 * (1 - 0.55 * snout)
    P[..., 2] *= 0.1 * (1 - 0.5 * snout)
    P[..., 1] -= 0.03 * snout ** 2
    # orbits: two dents
    for sgn in (-1, 1):
        c = np.array([0.05, 0.03, sgn * 0.085])
        d = np.linalg.norm(P - c, axis=-1)
        P += (np.clip(0.045 - d, 0, None) / 0.045)[..., None] * 0.03 * np.array([0, -0.4, -sgn])
    # nasal openings and noise
    n = np.sin(Uu * 7 + seed) * np.sin(Vv * 5) * 0.004
    P += n[..., None] * P / (np.linalg.norm(P, axis=-1, keepdims=True) + 1e-9)
    V = P.reshape(-1, 3)
    F = U.grid_faces(nu, nv, closed_u=True)
    top = len(V); V = np.vstack([V, [P[0, 0] * 0 + [0, 0.09, 0]], [[0, -0.09, 0]]])
    faces = [list(f) for f in F]
    for i in range(nu):
        j = (i + 1) % nu
        faces.append([top, j * nv, i * nv])
        faces.append([top + 1, i * nv + nv - 1, j * nv + nv - 1])
    parts = [U.mesh_from_faces(name, V, faces, coll_=coll_, mat=mat)]
    if kind == 'cow':
        for sgn in (-1, 1):
            base = np.array([-0.06, 0.05, sgn * 0.08])
            pts = [base, base + [-0.03, 0.03, sgn * 0.08], base + [-0.02, 0.09, sgn * 0.14]]
            parts.append(U.tube(name + '_horn', pts, [0.028, 0.02, 0.008], n=8, coll_=coll_, mat=mat))
    return U.join(parts, name)

def sack(name, mat, coll_, seed=0, size=(0.7, 0.32, 0.45), tied=True):
    rng = np.random.default_rng(seed)
    nu, nv = 24, 14
    u = np.linspace(0, 2 * np.pi, nu, endpoint=False)
    v = np.linspace(0.06, np.pi - 0.06, nv)
    Uu, Vv = np.meshgrid(u, v, indexing='ij')
    x = np.cos(Vv); y = np.sin(Vv) * np.cos(Uu); z = np.sin(Vv) * np.sin(Uu)
    P = np.stack([x * size[0] / 2, y * size[1] / 2, z * size[2] / 2], -1)
    # sag: flat bottom, slumped top, wrinkles
    P[..., 1] = np.maximum(P[..., 1], -size[1] * 0.38)
    P[..., 1] *= 1 - 0.25 * np.abs(np.cos(Vv))
    w = np.sin(Uu * 9 + Vv * 4 + seed) * np.sin(Vv * 11 + seed) * 0.008
    P += w[..., None] * np.array([0, 1, 1])
    if tied:
        neck = np.cos(Vv) > 0.85
        P[neck, 1] *= 0.35; P[neck, 2] *= 0.35
    V = P.reshape(-1, 3)
    F = U.grid_faces(nu, nv, closed_u=True)
    faces = [list(f) for f in F]
    c0 = len(V); V = np.vstack([V, [[size[0] / 2 + 0.02, 0, 0], [-size[0] / 2, 0, 0]]])
    for i in range(nu):
        j = (i + 1) % nu
        faces.append([c0, i * nv, j * nv])
        faces.append([c0 + 1, j * nv + nv - 1, i * nv + nv - 1])
    return U.mesh_from_faces(name, V, faces, coll_=coll_, mat=mat)

def weed_ribbons(name, base_pts, normals, mat, coll_, rng, length=(0.08, 0.35), width=(0.01, 0.03)):
    """Flat weed strands hanging down a wall from base points, lying close to the face."""
    V, F = [], []
    for p, nrm in zip(base_pts, normals):
        L = rng.uniform(*length); w = rng.uniform(*width)
        side = np.cross(nrm, [0, 1.0, 0]); side /= np.linalg.norm(side) + 1e-9
        k = 6
        b = len(V)
        sway = rng.normal(0, 0.03)
        for i in range(k):
            t = i / (k - 1)
            c = p + np.array([0, -L * t, 0]) + side * sway * t * t + nrm * (0.006 + 0.01 * np.sin(t * 3))
            ww = w * (1 - 0.7 * t)
            V.append(c - side * ww / 2); V.append(c + side * ww / 2)
        for i in range(k - 1):
            F.append([b + 2 * i, b + 2 * i + 1, b + 2 * i + 3, b + 2 * i + 2])
    if not V:
        return None
    return U.mesh_from_faces(name, np.array(V), F, coll_=coll_, mat=mat)


# ================================================================== round 2 props
def stave_barrel(name, mats, coll_, seed=0, h=0.78, r=0.29, staves=20, missing=1, split=3):
    """Barrel of real 3 cm staves with end grain, split and broken tops, chime grooves, heads and corroded hoops."""
    rng = np.random.default_rng(seed)
    obs = []
    t = 0.03
    lost = set(rng.choice(staves, missing, replace=False)) if missing else set()
    splits = set(rng.choice(staves, split, replace=False)) if split else set()
    for i in range(staves):
        if i in lost:
            continue
        a0 = 2 * np.pi * i / staves + 0.012
        a1 = 2 * np.pi * (i + 1) / staves - 0.012
        ny, na = 12, 3
        ys = np.linspace(-h / 2, h / 2, ny)
        top_cut = h / 2 - (rng.uniform(0.05, 0.25) if i in splits else 0.0)
        ys = np.minimum(ys, top_cut + 0.0)
        bulge = r * (0.86 + 0.14 * np.cos(ys / (h / 2) * np.pi / 2.2))
        V, F = [], []
        def vid(ii, jj, kk):
            return (ii * na + jj) * 2 + kk
        for ii, (yv, rv) in enumerate(zip(ys, bulge)):
            for jj, a in enumerate(np.linspace(a0, a1, na)):
                for kk, rr in enumerate((rv, rv - t)):
                    jag = 0.0
                    if i in splits and ii == ny - 1:
                        jag = rng.uniform(-0.04, 0.0)
                    V.append([rr * np.cos(a), yv + jag, rr * np.sin(a)])
        for ii in range(ny - 1):
            for jj in range(na - 1):
                F.append([vid(ii, jj, 0), vid(ii + 1, jj, 0), vid(ii + 1, jj + 1, 0), vid(ii, jj + 1, 0)])
                F.append([vid(ii, jj, 1), vid(ii, jj + 1, 1), vid(ii + 1, jj + 1, 1), vid(ii + 1, jj, 1)])
            F.append([vid(ii, 0, 0), vid(ii, 0, 1), vid(ii + 1, 0, 1), vid(ii + 1, 0, 0)])
            F.append([vid(ii, na - 1, 0), vid(ii + 1, na - 1, 0), vid(ii + 1, na - 1, 1), vid(ii, na - 1, 1)])
        for jj in range(na - 1):
            F.append([vid(0, jj, 0), vid(0, jj + 1, 0), vid(0, jj + 1, 1), vid(0, jj, 1)])
            F.append([vid(ny - 1, jj, 0), vid(ny - 1, jj, 1), vid(ny - 1, jj + 1, 1), vid(ny - 1, jj + 1, 0)])
        V = np.array(V)
        ob = U.mesh_from_faces(name + '_stave', V, F, uv=U.box_uv(V, np.array(F)), coll_=coll_, mat=mats['wood_wet'])
        obs.append(ob)
    # one head left in place, of three planks, slightly sunk
    for k in range(3):
        w = 2 * r * 0.86 / 3
        x0 = -r * 0.86 + k * w
        xs = np.linspace(x0 + 0.003, x0 + w - 0.003, 4)
        pts = []
        for xx in xs:
            zz = np.sqrt(max((r * 0.86 - 0.02) ** 2 - xx ** 2, 0.0004))
            pts.append((xx, zz))
        V = []
        for (xx, zz) in pts:
            for sz in (-zz, zz):
                for yy in (-h / 2 + 0.03, -h / 2 + 0.055):
                    V.append([xx, yy, sz])
        V = np.array(V)
        Cc = U.box_corners(x0 + 0.003, x0 + w - 0.003, -h / 2 + 0.03, -h / 2 + 0.055, -np.sqrt(max((r * 0.86 - 0.02) ** 2 - (x0 + w / 2) ** 2, 0.01)), np.sqrt(max((r * 0.86 - 0.02) ** 2 - (x0 + w / 2) ** 2, 0.01)))
        P_, F_, V_ = U.hexa_block(Cc, r=0.003, res=0.05, seed=seed * 7 + k, chips=2, chip_size=(0.01, 0.03))
        obs.append(U.mesh_from_faces(name + '_head', P_, F_, uv=U.box_uv(P_, F_), coll_=coll_, mat=mats['wood_wet']))
    for yv in (-h * 0.42, -h * 0.3, h * 0.3, h * 0.42):
        if yv > h / 2 - 0.1 and split:
            continue
        rv = r * (0.86 + 0.14 * np.cos(yv / (h / 2) * np.pi / 2.2)) + 0.004
        a = np.linspace(0, 2 * np.pi, 41)
        pts = np.stack([rv * np.cos(a), np.full_like(a, yv) + 0.004 * np.sin(a * 7 + seed), rv * np.sin(a)], -1)
        obs.append(U.tube(name + '_hoop', pts, 0.006, n=6, coll_=coll_, mat=mats['iron_rust'], flat=3.5))
    return U.join(obs, name)

def basket(name, mats, coll_, seed=0, r=0.22, h=0.35, broken=0.3):
    """Broken wicker basket: upright rods and woven rings, part of the side torn away."""
    rng = np.random.default_rng(seed)
    obs = []
    n = 16
    gap0 = rng.uniform(0, 2 * np.pi)
    for i in range(n):
        a = 2 * np.pi * i / n
        torn = (abs(((a - gap0 + np.pi) % (2 * np.pi)) - np.pi) < broken * np.pi)
        top = h * (rng.uniform(0.3, 0.7) if torn else 1.0)
        pts = [[r * 0.8 * np.cos(a), 0, r * 0.8 * np.sin(a)], [r * np.cos(a), top * 0.5, r * np.sin(a)], [r * 1.05 * np.cos(a), top, r * 1.05 * np.sin(a)]]
        obs.append(U.tube(name + '_rod', pts, 0.005, n=5, coll_=coll_, mat=mats['wicker']))
    for k, yy in enumerate(np.linspace(0.03, h - 0.02, 9)):
        a = np.linspace(0, 2 * np.pi, 48)
        rr = r * (0.8 + 0.25 * yy / h) + 0.004 * np.sin(a * n + k * np.pi)
        keep = np.abs(((a - gap0 + np.pi) % (2 * np.pi)) - np.pi) > broken * np.pi * (yy / h) * 1.6
        seg = np.stack([rr * np.cos(a), np.full_like(a, yy) + 0.006 * np.sin(a * n), rr * np.sin(a)], -1)
        run = []
        for p_, kp in zip(seg, keep):
            if kp:
                run.append(p_)
            elif len(run) > 2:
                obs.append(U.tube(name + '_weave', run, 0.006, n=5, coll_=coll_, mat=mats['wicker'], flat=0.6))
                run = []
            else:
                run = []
        if len(run) > 2:
            obs.append(U.tube(name + '_weave', run, 0.006, n=5, coll_=coll_, mat=mats['wicker'], flat=0.6))
    return U.join(obs, name)

def rope(name, pts, mat, coll_, r=0.012):
    return U.tube(name, pts, r, n=8, coll_=coll_, mat=mat)

def rope_coil(name, centre, mat, coll_, seed=0, R0=0.18, turns=5):
    rng = np.random.default_rng(seed)
    t = np.linspace(0, turns * 2 * np.pi, turns * 24)
    rr = R0 + 0.02 * np.sin(t * 0.5) + rng.normal(0, 0.004, len(t))
    pts = np.stack([rr * np.cos(t), 0.013 + 0.012 * (t / t[-1]) + 0.006 * np.sin(t * 3), rr * np.sin(t)], -1) + np.asarray(centre)
    tail = [pts[-1], pts[-1] + np.array([0.15, -0.005, 0.25]), pts[-1] + np.array([0.3, -0.01, 0.55])]
    return U.tube(name, np.vstack([pts, tail[1:]]), 0.012, n=8, coll_=coll_, mat=mat)

def rat(name, mats, coll_, seed=0):
    """A drowned rat: bloated body, head, limp tail and feet. Local game axes, lying on its side."""
    rng = np.random.default_rng(seed)
    body = U.lathe([(0.0, -0.11), (0.03, -0.1), (0.042, -0.05), (0.045, 0.0), (0.038, 0.05), (0.025, 0.08), (0.016, 0.11), (0.0, 0.125)], 14, name, coll_, mats['fur'])
    me = body.data
    co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    co[:, 0] *= 0.8
    me.vertices.foreach_set('co', co.ravel()); me.update()
    parts = [body]
    t = np.linspace(0, 1, 12)
    tail = np.stack([0.04 * np.sin(t * 3 + seed), -0.01 * t, -0.11 - 0.17 * t], -1)
    parts.append(U.tube(name + '_tail', tail, np.linspace(0.006, 0.0015, 12), n=6, coll_=coll_, mat=mats['skin_pale']))
    for (x, z) in ((0.03, 0.06), (-0.03, 0.06), (0.03, -0.06), (-0.03, -0.06)):
        parts.append(U.tube(name + '_leg', [[x, 0, z], [x * 1.6, -0.02, z + 0.01], [x * 1.9, -0.03, z + 0.02]], 0.005, n=5, coll_=coll_, mat=mats['skin_pale']))
    ob = U.join(parts, name)
    return ob

def cork(name, mat, coll_):
    return U.lathe([(0.0, 0.0), (0.011, 0.0), (0.012, 0.002), (0.014, 0.03), (0.0, 0.031)], 10, name, coll_, mat)

def straw_tuft(name, mat, coll_, seed=0, n=30, L=0.25):
    rng = np.random.default_rng(seed)
    parts = []
    for k in range(n):
        a = rng.uniform(0, np.pi)
        d = np.array([np.cos(a), rng.normal(0, 0.05), np.sin(a)])
        c = rng.normal(0, 0.04, 3) * np.array([1, 0.1, 1])
        l = L * rng.uniform(0.5, 1.2)
        parts.append(U.tube(name + '_s', [c - d * l / 2, c + d * l / 2 + rng.normal(0, 0.01, 3)], 0.0018, n=4, coll_=coll_, mat=mat, cap=False))
    return U.join(parts, name)

def bone_femur(name, mat, coll_, seed=0, L=0.42):
    """Cattle long bone: shaft with a ball head on a neck, a trochanter, two condyles at the far end."""
    rng = np.random.default_rng(seed)
    ys = np.linspace(0.06, L - 0.06, 18)
    r = 0.017 + 0.006 * ((ys - L / 2) / (L / 2)) ** 2
    shaft = U.lathe([(0.0, 0.05)] + [(rr, yy) for rr, yy in zip(r, ys)] + [(0.0, L - 0.05)], 12, name, coll_, mat)
    parts = [shaft]
    # proximal: ball head offset on a neck, trochanter knob
    def blob(c, rad, sc=(1, 1, 1)):
        o = U.lathe([(0.0, -rad), (rad * 0.7, -rad * 0.7), (rad, 0.0), (rad * 0.7, rad * 0.7), (0.0, rad)], 12, name + '_b', coll_, mat)
        me = o.data
        co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        co = co * np.array(sc)[[0, 2, 1]] + U.g2b(np.array(c))
        me.vertices.foreach_set('co', co.ravel()); me.update()
        return o
    parts.append(blob((0.028, L - 0.03, 0.0), 0.026))
    parts.append(U.tube(name + '_neck', [[0.0, L - 0.07, 0], [0.025, L - 0.035, 0]], 0.016, n=10, coll_=coll_, mat=mat))
    parts.append(blob((-0.022, L - 0.06, 0.0), 0.022, (1.0, 1.5, 0.9)))
    parts.append(blob((0.0, 0.035, 0.016), 0.024, (1.2, 0.9, 1.0)))
    parts.append(blob((0.0, 0.035, -0.016), 0.024, (1.2, 0.9, 1.0)))
    ob = U.join(parts, name)
    me = ob.data
    co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    co[:, 0] += 0.01 * np.sin(co[:, 2] / L * np.pi) * rng.uniform(0.5, 1.5)
    me.vertices.foreach_set('co', co.ravel()); me.update()
    return ob

def vertebra(name, mat, coll_, seed=0):
    rng = np.random.default_rng(seed)
    body = U.lathe([(0.0, -0.03), (0.026, -0.028), (0.022, 0.0), (0.026, 0.028), (0.0, 0.03)], 12, name, coll_, mat)
    parts = [body]
    parts.append(U.tube(name + '_spine', [[0, 0, 0.02], [0, rng.uniform(0.0, 0.02), 0.07], [0, 0.0, 0.11]], [0.012, 0.008, 0.005], n=6, coll_=coll_, mat=mat, flat=0.4))
    for sgn in (-1, 1):
        parts.append(U.tube(name + '_wing', [[0, 0, 0.0], [sgn * 0.05, 0, 0.01], [sgn * 0.07, 0.0, 0.0]], [0.009, 0.006, 0.004], n=6, coll_=coll_, mat=mat, flat=0.35))
    return U.join(parts, name)

def mandible(name, mat, coll_, seed=0):
    t = np.linspace(0, 1, 14)
    pts = np.stack([0.33 * t, 0.06 * np.clip((t - 0.75) / 0.25, 0, 1) ** 1.5 * 2.2, 0.03 * np.sin(t * np.pi)], -1)
    return U.tube(name, pts, np.linspace(0.012, 0.02, 14) * np.r_[np.ones(11), 1.4, 1.6, 1.2], n=8, coll_=coll_, mat=mat, flat=0.35)

def cow_skull(name, mat, coll_, seed=0):
    """Cattle skull: braincase, long tapering face, orbits standing out at the sides, horn cores."""
    rng = np.random.default_rng(seed)
    prof = [(0.0, -0.05), (0.06, -0.045), (0.085, -0.02), (0.09, 0.02), (0.075, 0.07), (0.06, 0.13), (0.05, 0.2), (0.042, 0.27), (0.035, 0.32), (0.0, 0.34)]
    o = U.lathe(prof, 18, name, coll_, mat)
    me = o.data
    co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    # lathe axis is Blender Z (game y): lay it along game x later; flatten top-bottom (Blender Y) less than side
    co[:, 1] *= 0.6
    me.vertices.foreach_set('co', co.ravel()); me.update()
    parts = [o]
    for sgn in (-1, 1):
        parts.append(U.tube(name + '_orbit', [[sgn * 0.07, 0.0, 0.07], [sgn * 0.095, 0.0, 0.09], [sgn * 0.085, 0.0, 0.12]], [0.022, 0.02, 0.012], n=8, coll_=coll_, mat=mat))
        parts.append(U.tube(name + '_horn', [[sgn * 0.06, 0.0, -0.03], [sgn * 0.13, 0.03, -0.04], [sgn * 0.18, 0.08, -0.01]], [0.024, 0.017, 0.006], n=8, coll_=coll_, mat=mat))
    return U.join(parts, name)

def flow_straw_variants(mat, coll_, n=12, seed=17):
    """Knobbly flowstone stalactites: thick lumpy root on the vault, rings of growth, a thin tip, some forked."""
    rng = np.random.default_rng(seed)
    meshes = []
    for i in range(n):
        L = 1.0
        r0 = rng.uniform(0.012, 0.03)
        prof = [(0.0, 0.006), (r0 * 1.6, 0.004), (r0 * 1.2, -0.03)]
        y = -0.03
        r = r0
        while y > -L:
            y -= rng.uniform(0.02, 0.06)
            r = max(0.0018, r * rng.uniform(0.8, 0.97))
            bump = 1.0 + (0.25 if rng.random() < 0.35 else 0.0)
            prof.append((r * bump, y))
        prof.append((r * 0.7, -L - 0.004)); prof.append((0.0, -L - 0.01))
        ob = U.lathe(prof, 10, 'flowstraw_v%d' % i, coll_, mat)
        me = ob.data
        co = np.zeros(len(me.vertices) * 3); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        ang = np.arctan2(co[:, 1], co[:, 0])
        lump = 1 + 0.18 * np.sin(ang * 3 + rng.uniform(0, 6)) * np.sin(co[:, 2] * 40 + rng.uniform(0, 6))
        co[:, 0] *= lump; co[:, 1] *= lump
        co[:, 0] += rng.normal(0, 0.03) * co[:, 2] ** 2
        me.vertices.foreach_set('co', co.ravel()); me.update()
        meshes.append(me)
        bpy.data.objects.remove(ob)
    return meshes

def ring_with_chain(name, loc, face_dir, mat, coll_, links=4, R=0.07):
    obs = ring_on_staple(name, loc, face_dir, mat, coll_, R=R)
    fd = np.asarray(face_dir, float); fd /= np.linalg.norm(fd)
    p0 = np.asarray(loc) + fd * 0.06 - np.array([0, 2 * R + 0.02, 0])
    obs.append(chain(name + '_chain', p0, p0 + np.array([0, -0.06 * links, 0]) + fd * 0.02, 0.01, links + 1, mat, coll_, lr=0.028, wire=0.007))
    return obs
