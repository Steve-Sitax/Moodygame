# Game export of the Ruien O2 piece: baked relief geometry, vertex masks, collision, markers, GLB, manifest.
# Run: blender --background ruien-o2.blend --python scripts/export_game.py -- [--lod 0,1] [--dry]
# Needs export/textures from scripts/export_textures.py. Never saves the .blend.
import bpy, bmesh, sys, os, json, time, hashlib, math, zlib
import numpy as np
from mathutils import Vector, kdtree

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
import spec
from rlib import util as U, gallery as G, hall as H, vliet as VL, gfeat as GF

argv = sys.argv[sys.argv.index('--') + 1:] if ('--' in sys.argv and __name__ == '__main__') else []
LODS = [int(x) for x in (argv[argv.index('--lod') + 1].split(',') if '--lod' in argv else ['0', '1'])]
DRY = '--dry' in argv
EXP = os.path.join(ROOT, 'export')
TEXD = os.path.join(EXP, 'textures')
T0 = time.time()

def log(*a):
    print('[export %5.0fs]' % (time.time() - T0), *a, flush=True)

NEAR_T, FAR_T, SILT_T, CALC_T = 0.025, 0.065, 0.05, 0.025
MAX_TRIS = 200000
NEAR_Y = spec.LEDGE_Y + 2.0

# ===================================================================== mesh data in numpy
class MD:
    def __init__(self):
        self.V = np.zeros((0, 3)); self.lv = np.zeros(0, np.int64); self.ps = np.zeros(0, np.int64); self.pt = np.zeros(0, np.int64)
        self.uv = {}; self.pa = {}; self.mats = []; self.pm = np.zeros(0, np.int64)

    @property
    def tris(self):
        return int(np.sum(self.pt - 2))

    @staticmethod
    def from_object(o, dg=None, world=True):
        dg = dg or bpy.context.evaluated_depsgraph_get()
        ev = o.evaluated_get(dg)
        me = ev.to_mesh()
        md = MD()
        n = len(me.vertices)
        co = np.zeros(n * 3, np.float64); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
        if world:
            M = np.array(o.matrix_world)
            co = co @ M[:3, :3].T + M[:3, 3]
        md.V = co
        nl = len(me.loops)
        md.lv = np.zeros(nl, np.int64); me.loops.foreach_get('vertex_index', md.lv)
        P = len(me.polygons)
        md.ps = np.zeros(P, np.int64); me.polygons.foreach_get('loop_start', md.ps)
        md.pt = np.zeros(P, np.int64); me.polygons.foreach_get('loop_total', md.pt)
        md.pm = np.zeros(P, np.int64); me.polygons.foreach_get('material_index', md.pm)
        for ul in me.uv_layers:
            a = np.zeros(nl * 2, np.float32); ul.data.foreach_get('uv', a); md.uv[ul.name] = a.reshape(-1, 2).astype(np.float64)
        for ca in me.color_attributes:
            if ca.domain == 'POINT' and ca.data_type == 'FLOAT_COLOR':
                a = np.zeros(n * 4, np.float32); ca.data.foreach_get('color', a); md.pa[ca.name] = a.reshape(-1, 4)
        at = me.attributes.get('rnd')
        if at is not None and at.domain == 'POINT' and at.data_type == 'FLOAT':
            a = np.zeros(n, np.float32); at.data.foreach_get('value', a); md.pa['rnd'] = a.reshape(-1, 1)
        md.mats = [sl.material.name if sl.material else 'none' for sl in o.material_slots] or ['none']
        md.pm = np.clip(md.pm, 0, len(md.mats) - 1)
        ev.to_mesh_clear()
        return md

    def face_centroids(self):
        cs = np.add.reduceat(self.V[self.lv], self.ps, axis=0) if len(self.ps) else np.zeros((0, 3))
        return cs / self.pt[:, None]

    def subset(self, mask):
        out = MD()
        idx = np.nonzero(mask)[0]
        if len(idx) == 0:
            out.mats = list(self.mats); return out
        loops = np.repeat(self.ps[idx], self.pt[idx]) + (np.arange(int(self.pt[idx].sum())) - np.repeat(np.r_[0, np.cumsum(self.pt[idx])[:-1]], self.pt[idx]))
        lv = self.lv[loops]
        used, inv = np.unique(lv, return_inverse=True)
        out.V = self.V[used]; out.lv = inv.astype(np.int64)
        out.pt = self.pt[idx]; out.ps = np.r_[0, np.cumsum(out.pt)[:-1]].astype(np.int64)
        out.pm = self.pm[idx]; out.mats = list(self.mats)
        out.uv = {k: v[loops] for k, v in self.uv.items()}
        out.pa = {k: v[used] for k, v in self.pa.items()}
        return out

    @staticmethod
    def merge(mds):
        mds = [m for m in mds if len(m.pt)]
        out = MD()
        if not mds:
            return out
        names = []
        for m in mds:
            for n_ in m.mats:
                if n_ not in names:
                    names.append(n_)
        out.mats = names
        uvk = set().union(*[set(m.uv) for m in mds]); pak = {}
        for m in mds:
            for k, v in m.pa.items():
                pak[k] = v.shape[1]
        Vs, lvs, pts, pms = [], [], [], []
        uvs = {k: [] for k in uvk}; pas = {k: [] for k in pak}
        base = 0
        for m in mds:
            Vs.append(m.V); lvs.append(m.lv + base); pts.append(m.pt)
            remap = np.array([names.index(n_) for n_ in m.mats]); pms.append(remap[m.pm])
            nl = len(m.lv)
            for k in uvk:
                uvs[k].append(m.uv.get(k, np.zeros((nl, 2))))
            for k, w in pak.items():
                d = np.zeros((len(m.V), w), np.float32)
                if k == 'wxB':
                    d[:, 3] = 1
                uvs_ = m.pa.get(k)
                pas[k].append(uvs_ if uvs_ is not None else d)
            base += len(m.V)
        out.V = np.concatenate(Vs); out.lv = np.concatenate(lvs); out.pt = np.concatenate(pts)
        out.ps = np.r_[0, np.cumsum(out.pt)[:-1]].astype(np.int64); out.pm = np.concatenate(pms)
        out.uv = {k: np.concatenate(v) for k, v in uvs.items()}
        out.pa = {k: np.concatenate(v) for k, v in pas.items()}
        return out

    def to_object(self, name, coll, mat_lookup=None, smooth=True):
        me = bpy.data.meshes.new(name)
        me.vertices.add(len(self.V)); me.vertices.foreach_set('co', U.g2b(self.V).astype(np.float32).ravel() if False else self.V.astype(np.float32).ravel())
        me.loops.add(len(self.lv)); me.loops.foreach_set('vertex_index', self.lv.astype(np.int32))
        me.polygons.add(len(self.pt)); me.polygons.foreach_set('loop_start', self.ps.astype(np.int32))
        me.update(calc_edges=True)
        for k, v in self.uv.items():
            ul = me.uv_layers.new(name=k); ul.data.foreach_set('uv', v.astype(np.float32).ravel())
        for k, v in self.pa.items():
            if v.shape[1] == 4:
                a = me.color_attributes.new(k, 'FLOAT_COLOR', 'POINT'); a.data.foreach_set('color', v.astype(np.float32).ravel())
            else:
                a = me.attributes.new(k, 'FLOAT', 'POINT'); a.data.foreach_set('value', v[:, 0].astype(np.float32))
        for n_ in self.mats:
            m = (mat_lookup or bpy.data.materials.get)(n_)
            me.materials.append(m)
        me.polygons.foreach_set('material_index', self.pm.astype(np.int32))
        if smooth:
            me.polygons.foreach_set('use_smooth', np.ones(len(self.pt), bool))
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        return ob

def b2g(V):
    return np.stack([V[:, 0], V[:, 2], -V[:, 1]], -1)

# ===================================================================== source classification
sc = bpy.context.scene
src_root = bpy.data.collections.get('RUIEN_O2')
EXCL_PREFIX = ('street_', 'calcite_wax_TEST_none')
def exportable():
    out = []
    for c in src_root.children_recursive:
        for o in c.objects:
            if o.type != 'MESH' or o.get('ruien_export') is False:
                continue
            if o.name.startswith('street_'):
                continue
            out.append(o)
    return list(dict.fromkeys(out))

def kind_of(o):
    m = o.material_slots[0].material.name if o.material_slots and o.material_slots[0].material else ''
    if m.startswith('Water_sewer') or m.startswith('Water_river'):
        return 'water'
    if m.startswith('Brick_') and m != 'Brick_loose':
        return 'masonry'
    if m.startswith('Silt'):
        return 'silt'
    if m.startswith('Calcite'):
        return 'calcite'
    return 'static'

BOND = {'Brick_gallery_vault': 'stretcher', 'Brick_ledge_paving': 'stretcher', 'Brick_hall_vault': 'stretcher',
        'Brick_rib_headers': 'header', 'Brick_rib_soffit': 'header', 'Brick_rib_side': 'header'}

# ===================================================================== subdivision with seam fade
def subdivide(md, level, coll):
    if level <= 0:
        return md
    ob = md.to_object('__sub', coll, smooth=False)
    m = ob.modifiers.new('s', 'SUBSURF')
    m.subdivision_type = 'SIMPLE'; m.levels = level; m.render_levels = level; m.uv_smooth = 'NONE'
    out = MD.from_object(ob, world=False)
    me = ob.data
    bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    return out

def mean_edge(md):
    a = md.V[md.lv]
    nxt = np.arange(len(md.lv)) + 1
    ends = md.ps + md.pt - 1
    nxt[ends] = md.ps
    return float(np.mean(np.linalg.norm(a - md.V[md.lv[nxt]], axis=1)))

def level_for(md, target, lod):
    e = mean_edge(md)
    return int(np.clip(math.floor(math.log2(max(e / target, 1.0)) + 0.5) - lod, 0, 4))

def seam_edges(md, face_class):
    a = md.lv
    nxt = np.arange(len(a)) + 1; ends = md.ps + md.pt - 1; nxt[ends] = md.ps
    e = np.sort(np.stack([a, a[nxt]], 1), 1)
    fid = np.repeat(np.arange(len(md.pt)), md.pt)
    key = e[:, 0] * (len(md.V) + 1) + e[:, 1]
    order = np.argsort(key)
    ks, cls = key[order], face_class[fid[order]]
    segs = []
    same = np.nonzero(ks[1:] == ks[:-1])[0]
    for i in same:
        if cls[i] != cls[i + 1]:
            k = ks[i]
            segs.append((md.V[k // (len(md.V) + 1)], md.V[k % (len(md.V) + 1)]))
    return segs

def seam_fade(V, segs, width=0.1):
    """Displacement fade near the seam between near and far parts (vectorised point-to-segment distance)."""
    if not segs:
        return np.ones(len(V))
    A = np.array([q[0] for q in segs]); B = np.array([q[1] for q in segs]); AB = B - A
    L2 = np.maximum(np.sum(AB * AB, 1), 1e-12)
    lo, hi = np.minimum(A, B).min(0) - width, np.maximum(A, B).max(0) + width
    out = np.ones(len(V))
    cand = np.nonzero(np.all((V > lo) & (V < hi), 1))[0]
    for c0 in range(0, len(cand), 4000):
        ii = cand[c0:c0 + 4000]
        P = V[ii]
        best = np.full(len(ii), 9.0)
        for s0 in range(0, len(A), 256):
            a_, ab, l2 = A[s0:s0 + 256], AB[s0:s0 + 256], L2[s0:s0 + 256]
            t = np.clip(np.einsum('pk,sk->ps', P, ab) - np.sum(a_ * ab, 1)[None], 0, None) / l2[None]
            t = np.clip(t, 0, 1)
            Q = a_[None] + t[..., None] * ab[None]
            d = np.linalg.norm(P[:, None] - Q, axis=2).min(1)
            best = np.minimum(best, d)
        x = np.clip(best / width, 0, 1)
        out[ii] = x * x * (3 - 2 * x)
    return out

# ===================================================================== bake helpers
def bake_material(src, mode):
    """Copy of a material whose surface emits a packed bake value. mode: 'H' (height and two masks),
    'M2' (soot, moss, sand), 'M3' (stone, 0, 0), 'COL' (shaded base colour)."""
    m = src.copy(); m.name = '__bake_' + src.name + '_' + mode
    m.displacement_method = 'BUMP'
    nt = m.node_tree
    out = [n for n in nt.nodes if n.type == 'OUTPUT_MATERIAL'][0]
    for l in list(out.inputs['Displacement'].links):
        nt.links.remove(l)
    disp = [n for n in nt.nodes if n.type == 'DISPLACEMENT']
    hsock = disp[0].inputs['Height'].links[0].from_socket if disp and disp[0].inputs['Height'].links else None
    def tap(name):
        n = nt.nodes.get(name)
        return n.outputs[0] if n else None
    em = nt.nodes.new('ShaderNodeEmission'); em.inputs['Strength'].default_value = 1.0
    if mode == 'COL':
        c = nt.nodes.get('BAKE_COL')
        if c:
            nt.links.new(c.outputs[2], em.inputs['Color'])
        else:
            em.inputs['Color'].default_value = (0.3, 0.3, 0.3, 1)
    else:
        cc = nt.nodes.new('ShaderNodeCombineColor')
        if mode == 'H':
            chans = [None, tap('BAKE_WET'), tap('BAKE_LIME')]
            if hsock is not None:
                mul = nt.nodes.new('ShaderNodeMath'); mul.operation = 'MULTIPLY_ADD'
                nt.links.new(hsock, mul.inputs[0]); mul.inputs[1].default_value = 4.0; mul.inputs[2].default_value = 0.5
                nt.links.new(mul.outputs[0], cc.inputs[0])
            else:
                cc.inputs[0].default_value = 0.5
        elif mode == 'M2':
            chans = [tap('BAKE_SOOT'), tap('BAKE_MOSS'), tap('BAKE_SAND')]
        else:
            chans = [tap('BAKE_STONE'), None, None]
        for i, s in enumerate(chans):
            if mode == 'H' and i == 0:
                continue
            if s is not None:
                nt.links.new(s, cc.inputs[i])
        nt.links.new(cc.outputs[0], em.inputs['Color'])
    for l in list(out.inputs['Surface'].links):
        nt.links.remove(l)
    nt.links.new(em.outputs[0], out.inputs['Surface'])
    return m

def bake_vc(ob, kind, samples, mats=None):
    me = ob.data
    at = me.color_attributes.new('__bake', 'FLOAT_COLOR', 'POINT')
    me.color_attributes.active_color = at
    old = [s.material for s in ob.material_slots]
    if mats:
        for i, s in enumerate(ob.material_slots):
            s.material = mats[i]
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.context.view_layer.objects.active = ob
    sc.cycles.samples = samples
    bpy.ops.object.bake(type=kind, target='VERTEX_COLORS', use_clear=True)
    a = np.zeros(len(me.vertices) * 4, np.float32); at.data.foreach_get('color', a)
    me.color_attributes.remove(at)
    if mats:
        for i, s in enumerate(ob.material_slots):
            s.material = old[i]
        for m in mats:
            if m.name.startswith('__bake_'):
                bpy.data.materials.remove(m)
    return a.reshape(-1, 4)

def vertex_normals(ob):
    n = np.zeros(len(ob.data.vertices) * 3, np.float32); ob.data.vertices.foreach_get('normal', n)
    return n.reshape(-1, 3).astype(np.float64)

# ===================================================================== main pipeline per LOD
def setup_render():
    p = bpy.context.preferences.addons['cycles'].preferences
    p.compute_device_type = 'OPTIX'; p.get_devices()
    for d in p.devices:
        d.use = (d.type == 'OPTIX')
    sc.cycles.device = 'GPU'
    sc.render.engine = 'CYCLES'
    sc.render.bake.target = 'VERTEX_COLORS'
    sc.world.light_settings.distance = 0.6
    for cn in ('fog', 'lights_mood', 'lights_check', 'scale_figures', 'backdrop'):
        if bpy.data.collections.get(cn):
            bpy.data.collections[cn].hide_render = True

def build_lod(lod, objs, hide_coll=None):
    hide_coll = hide_coll or src_root
    work = bpy.data.collections.new('EXPORT_WORK_%d' % lod); sc.collection.children.link(work)
    groups = {}            # source material -> list of MD (to bake), for subdivided kinds
    statics = []           # MD without relief bake
    total_in = 0
    for o in objs:
        k = kind_of(o)
        if k == 'water':
            continue
        md = MD.from_object(o)
        total_in += md.tris
        if k == 'static':
            statics.append(md); continue
        mat = md.mats[0]
        if k == 'masonry':
            r = md.pa.pop('rnd', None)
            r = r[:, 0] if r is not None else np.zeros(len(md.V))
            # keep the raw UVs for the bake (the stone zones read them); carry the brick offset as a colour attribute
            # named 'rnd' (the shader's Attribute node reads it the same way) and apply it to the export UVs later
            md.pa['rnd'] = np.stack([r, r, r, np.ones(len(r))], -1).astype(np.float32)
            yc = b2g(md.face_centroids())[:, 1]
            cls = ((yc >= NEAR_Y) | (yc < spec.WATER_Y - 0.3)).astype(np.int64)
            segs = seam_edges(md, cls) if 0 < cls.sum() < len(cls) else []
            for c_ in (0, 1):
                part = md.subset(cls == c_)
                if not len(part.pt):
                    continue
                lvl = level_for(part, NEAR_T if c_ == 0 else FAR_T, lod)
                sp = subdivide(part, lvl, work)
                sp.pa['__fade'] = seam_fade(sp.V, segs).reshape(-1, 1).astype(np.float32) if segs else np.ones((len(sp.V), 1), np.float32)
                groups.setdefault(mat, []).append(sp)
        else:
            sp = subdivide(md, level_for(md, SILT_T if k == 'silt' else CALC_T, lod), work)
            sp.pa['__fade'] = np.ones((len(sp.V), 1), np.float32)
            groups.setdefault(mat, []).append(sp)
    est = sum(sum(m.tris for m in v) for v in groups.values()) + sum(m.tris for m in statics)
    log('LOD%d: source %d tris, after subdivision %d tris (%d relief groups, %d statics)' % (lod, total_in, est, len(groups), len(statics)))
    if DRY:
        for k, v in groups.items():
            log('   %-24s %9d' % (k, sum(m.tris for m in v)))
        return None
    # hide the sources: bakes and AO see the export geometry only
    hide_coll.hide_render = True
    baked = []
    for mat, lst in groups.items():
        md = MD.merge(lst)
        ob = md.to_object('__grp_' + mat, work)
        src = bpy.data.materials[mat]
        hb = bake_vc(ob, 'EMIT', 1, [bake_material(src, 'H')])
        h = (hb[:, 0] - 0.5) / 4.0
        nrm = vertex_normals(ob)
        V = md.V + nrm * (h * md.pa['__fade'][:, 0])[:, None]
        ob.data.vertices.foreach_set('co', V.astype(np.float32).ravel()); ob.data.update()
        md.V = V
        if kind_of_mat(mat) == 'masonry':
            m2 = bake_vc(ob, 'EMIT', 1, [bake_material(src, 'M2')])
            m3 = bake_vc(ob, 'EMIT', 1, [bake_material(src, 'M3')])
            col = bake_vc(ob, 'EMIT', 1, [bake_material(src, 'COL')])
            md.pa['Col'] = np.stack([hb[:, 1], hb[:, 2], m2[:, 0], m2[:, 1]], -1).astype(np.float32)
            md.pa['__sand'] = m2[:, 2:3]; md.pa['__stone'] = m3[:, 0:1]
            md.pa['_BAKECOL'] = np.c_[col[:, :3], np.ones(len(col))].astype(np.float32)
        else:
            y = b2g(V)[:, 1]
            wet = np.clip((spec.WATER_Y + 0.6 - y) / 0.6, 0, 1)
            md.pa['Col'] = np.stack([np.maximum(wet, 0.6 if mat.startswith('Silt') else 0.2), np.full(len(V), 0.9 if mat.startswith('Calc') else 0.0),
                                     np.full(len(V), 0.2), np.zeros(len(V))], -1).astype(np.float32)
        baked.append((mat, md, ob))
        log('  baked %-24s %9d tris' % (mat, md.tris))
    # statics: merged per material, default masks
    smd = {}
    for md in statics:
        for i, mn in enumerate(md.mats):
            part = md.subset(md.pm == i); part.mats = [mn]; part.pm[:] = 0
            if len(part.pt):
                smd.setdefault(mn, []).append(part)
    for mat, lst in smd.items():
        md = MD.merge(lst)
        if lod == 1 and md.tris > 2000:
            ob0 = md.to_object('__dec', work, smooth=False)
            dm = ob0.modifiers.new('d', 'DECIMATE'); dm.ratio = 0.3
            md2 = MD.from_object(ob0, world=False)
            me0 = ob0.data; bpy.data.objects.remove(ob0); bpy.data.meshes.remove(me0)
            md2.mats = md.mats
            md = md2
        y = b2g(md.V)[:, 1]
        wet = np.clip((-3.85 - y) / 0.3, 0, 1)
        md.pa['Col'] = np.stack([wet, np.zeros(len(y)), np.full(len(y), 0.2), np.zeros(len(y))], -1).astype(np.float32)
        ob = md.to_object('__st_' + mat, work)
        baked.append((mat, md, ob))
    # AO on everything, with all export geometry present
    for mat, md, ob in baked:
        ao = bake_vc(ob, 'AO', 24)
        md.pa['_AO'] = ao[:, 0:1].astype(np.float32)
    log('LOD%d AO done' % lod)
    for mat, md, ob in baked:
        me = ob.data; bpy.data.objects.remove(ob); bpy.data.meshes.remove(me)
    hide_coll.hide_render = False
    return baked

def kind_of_mat(m):
    if m.startswith('Brick_') and m != 'Brick_loose':
        return 'masonry'
    if m.startswith('Silt'):
        return 'silt'
    if m.startswith('Calcite'):
        return 'calcite'
    return 'static'

# ===================================================================== export materials and UVs
FAM_TEX = json.load(open(os.path.join(TEXD, 'texture_sets.json')))
def fam_of(mat):
    if mat in BOND or mat.startswith('Brick_') and mat != 'Brick_loose':
        return 'brick_' + BOND.get(mat, 'flemish')
    if mat.startswith('Bluestone'):
        return 'bluestone'
    if mat.startswith('Calcite') or mat == 'Lime_straw':
        return 'calcite'
    if mat.startswith('Oak'):
        return 'oak'
    if mat.startswith('Wood'):
        return 'oak_debris'
    if mat.startswith('Iron'):
        return 'iron'
    if mat.startswith('Silt'):
        return 'silt'
    if mat.startswith('Moss'):
        return 'moss'
    return None

MISC_COL = {'Brick_loose': (0.2, 0.09, 0.05), 'Brass_lamp': (0.32, 0.22, 0.09), 'Lamp_gauze': (0.05, 0.045, 0.04), 'Lamp_glass': (0.8, 0.78, 0.7),
            'Lamp_flame': (1.0, 0.6, 0.25), 'Soot_black': (0.008, 0.007, 0.006), 'Water_film': (0.6, 0.58, 0.5), 'Bone': (0.3, 0.25, 0.17),
            'Offal': (0.12, 0.02, 0.02), 'Sacking': (0.08, 0.06, 0.035), 'Weed_slime': (0.025, 0.03, 0.01), 'Rat_fur': (0.045, 0.04, 0.034),
            'Rat_skin': (0.24, 0.16, 0.14), 'Cork': (0.26, 0.18, 0.1), 'Straw_wet': (0.22, 0.17, 0.08), 'Glass_bottle': (0.03, 0.06, 0.03),
            'Rope_hemp': (0.14, 0.11, 0.07), 'Wicker': (0.11, 0.08, 0.045), 'Runoff_lime': (0.5, 0.48, 0.44), 'Runoff_wet': (0.02, 0.017, 0.012),
            'Runoff_iron': (0.13, 0.055, 0.02), 'Runoff_splash': (0.42, 0.4, 0.34), 'Water_drip_ring': (0.02, 0.02, 0.015)}
ALPHA = {'Runoff_lime': 0.55, 'Runoff_wet': 0.45, 'Runoff_iron': 0.4, 'Runoff_splash': 0.5, 'Water_drip_ring': 0.3, 'Lamp_glass': 0.25, 'Water_film': 0.4}

_occ_group = None
def occ_group():
    global _occ_group
    if _occ_group is None:
        ng = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
        ng.interface.new_socket(name='Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
        _occ_group = ng
    return _occ_group

_emats = {}
def export_material(fam_or_misc):
    if fam_or_misc in _emats:
        return _emats[fam_or_misc]
    name = 'ruien_' + fam_or_misc
    m = bpy.data.materials.new(name)
    nt = m.node_tree; nt.nodes.clear()
    out = nt.nodes.new('ShaderNodeOutputMaterial')
    b = nt.nodes.new('ShaderNodeBsdfPrincipled')
    nt.links.new(b.outputs[0], out.inputs['Surface'])
    fam = fam_or_misc if fam_or_misc in FAM_TEX else ('oak' if fam_or_misc == 'oak_debris' else None)
    if fam:
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
        def tex(suffix, data):
            im = bpy.data.images.load(os.path.join(TEXD, 'ruien_%s_%s.png' % (fam, suffix)), check_existing=True)
            if data:
                im.colorspace_settings.name = 'Non-Color'
            t = nt.nodes.new('ShaderNodeTexImage'); t.image = im
            nt.links.new(uvn.outputs[0], t.inputs['Vector'])
            return t
        nt.links.new(tex('albedo', False).outputs[0], b.inputs['Base Color'])
        nt.links.new(tex('roughness', True).outputs[0], b.inputs['Roughness'])
        nm = nt.nodes.new('ShaderNodeNormalMap')
        nt.links.new(tex('normal', True).outputs[0], nm.inputs['Color'])
        nt.links.new(nm.outputs[0], b.inputs['Normal'])
        g = nt.nodes.new('ShaderNodeGroup'); g.node_tree = occ_group()
        nt.links.new(tex('ao', True).outputs[0], g.inputs['Occlusion'])
        b.inputs['Metallic'].default_value = 0.3 if fam == 'iron' else 0.0
    else:
        c = MISC_COL.get(fam_or_misc.replace('misc_', ''), (0.2, 0.2, 0.2))
        b.inputs['Base Color'].default_value = (c[0], c[1], c[2], 1)
        b.inputs['Roughness'].default_value = 0.6
        a = ALPHA.get(fam_or_misc.replace('misc_', ''))
        if a is not None:
            b.inputs['Alpha'].default_value = a
            try:
                m.surface_render_method = 'BLENDED'
            except Exception:
                m.blend_method = 'BLEND'
        if 'flame' in fam_or_misc.lower():
            b.inputs['Emission Color'].default_value = (1.0, 0.6, 0.25, 1); b.inputs['Emission Strength'].default_value = 8.0
    m['ruien_family'] = fam_or_misc
    _emats[fam_or_misc] = m
    return m

def box_uv_loops(md, tile):
    Vf = md.V[md.lv]
    fid = np.repeat(np.arange(len(md.pt)), md.pt)
    # face normal from the first three loops
    a = md.V[md.lv[md.ps]]; b = md.V[md.lv[md.ps + 1]]; c = md.V[md.lv[md.ps + 2]]
    n = np.cross(b - a, c - a)
    ax = np.argmax(np.abs(n), 1)[fid]
    u = np.where(ax == 0, Vf[:, 1], Vf[:, 0]); v = np.where(ax == 2, Vf[:, 1], Vf[:, 2])
    return np.stack([u, v], -1) / tile

def finalize_uv_mats(mat, md):
    """Export UVs (one 'UVMap') and export material per face for one source-material group."""
    fam = fam_of(mat)
    fid = np.repeat(np.arange(len(md.pt)), md.pt)
    uv0 = md.uv.get('UVMap')
    if fam and fam.startswith('brick_'):
        tw, th = spec.BRICK_TILE
        rl = md.pa['rnd'][md.lv, 0][:, None] if 'rnd' in md.pa else 0.0
        uv0 = uv0 + rl * np.array([17.31, 9.13])
        uv = uv0 / np.array([tw, th])
        famf = np.full(len(md.pt), 0)
        fams = ['brick_' + BOND.get(mat, 'flemish'), 'sandstone', 'bluestone']
        sand = np.add.reduceat(md.pa['__sand'][md.lv, 0], md.ps) / md.pt
        stone = np.add.reduceat(md.pa['__stone'][md.lv, 0], md.ps) / md.pt
        famf[sand > 0.5] = 1; famf[stone > 0.5] = 2
        lf = famf[fid]
        uv = np.where((lf == 1)[:, None], (uv0 + np.array([3.7, 1.1])) / 1.6, uv)
        uv = np.where((lf == 2)[:, None], (uv0 - rl * np.array([17.31, 9.13])) / 2.4, uv)
        md.uv = {'UVMap': uv}
        md.mats = ['ruien_' + f for f in fams]; md.pm = famf
        for f in fams:
            export_material(f)
        md.pa = {k: v for k, v in md.pa.items() if k in ('Col', '_AO', '_BAKECOL')}
        return
    if fam == 'calcite' and uv0 is not None and mat.startswith('Calcite'):
        uv = uv0 / np.array([1.8, 2.6])
    elif fam == 'oak' and uv0 is not None:
        uv = uv0
    elif fam == 'silt':
        uv = b2g(md.V)[md.lv][:, [0, 2]] / 4.0
    elif fam == 'bluestone':
        uv = (uv0 / 2.4) if uv0 is not None else box_uv_loops(md, 2.4)
    elif fam in ('iron', 'oak_debris', 'moss', 'calcite'):
        uv = box_uv_loops(md, {'iron': 0.9, 'oak_debris': 1.0, 'moss': 0.6, 'calcite': 1.8}[fam])
    else:
        uv = uv0 if uv0 is not None else box_uv_loops(md, 1.0)
    md.uv = {'UVMap': uv}
    key = fam if fam else 'misc_' + mat.split('.')[0]
    export_material(key)
    md.mats = ['ruien_' + key]; md.pm[:] = 0
    md.pa = {k: v for k, v in md.pa.items() if k in ('Col', '_AO', '_BAKECOL')}

# ===================================================================== areas and chunks
PATH = G.Path(spec.GAL_PATH_KEYS)
def area_keys(Cg):
    x, z = Cg[:, 0], Cg[:, 2]
    outlet = z < 73.2
    gate = outlet & (np.abs(x - spec.GATE_X) < 3.9) & (z > 70.3)
    inhall = (x > spec.HALL_X0 - 1.25) & (x < spec.HALL_X1 + 1.25) & (z > spec.HALL_Z0 - 1.25) & (z < spec.HALL_Z1 + 1.25)
    bi = np.clip(np.searchsorted(spec.HALL_XL, x), 0, 2); bj = np.clip(np.searchsorted(spec.HALL_ZL, z), 0, 3)
    u = np.interp(z, PATH.P[:, 1], PATH.u)
    bay = np.array(['hall_bay%d%d' % (i, j) for i in range(3) for j in range(4)], dtype=object)[bi * 4 + bj]
    gal = np.array(['gallery_s%d' % k for k in range(4)], dtype=object)[np.clip((u // 10).astype(int), 0, 3)]
    keys = np.select([gate, outlet, inhall, (x > spec.HALL_X1 + 1.25) & (z < 120), x < spec.HALL_X0 - 1.25, z > spec.HALL_Z1 + 1.25],
                     ['outlet_gate', 'outlet_vliet', bay, 'hall_side_ne', 'hall_side_sw', 'hall_side_e'], gal)
    return keys

def split_max(md, maxt=MAX_TRIS):
    if md.tris <= maxt:
        return [md]
    C = md.face_centroids()
    ext = C.max(0) - C.min(0)
    ax = int(np.argmax(ext))
    med = np.median(C[:, ax])
    m = C[:, ax] < med
    if m.all() or (~m).all():
        return [md]
    return split_max(md.subset(m), maxt) + split_max(md.subset(~m), maxt)

def file_of(key):
    return 'outlet' if key.startswith('outlet') else ('gallery' if key.startswith('gallery') else 'hall')

# ===================================================================== water planes, collision, markers
def water_planes(coll):
    obs = []
    wm = export_material('misc_water')
    wm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.03, 0.035, 0.02, 1)
    wm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.08
    def plane(name, P):
        o = U.grid_mesh(name, P, P[..., [0, 2]], coll_=coll, mat=wm, smooth=False, flip=G.orient_check(P, P[0, 0] + np.array([0, 1.0, 0])))
        obs.append(o)
    plane('water_outlet', np.array([[[spec.VLIET_X0, spec.WATER_Y, spec.VLIET_Z0 - 1], [spec.VLIET_X0, spec.WATER_Y, 72.3]], [[spec.VLIET_X1, spec.WATER_Y, spec.VLIET_Z0 - 1], [spec.VLIET_X1, spec.WATER_Y, 72.3]]]))
    uu = np.arange(0.0, PATH.length + 0.01, 0.5)
    Uu, Ss = np.meshgrid(uu, np.array([-1.5, 1.5]), indexing='ij')
    plane('water_gallery', PATH.world(Uu, Ss, np.full(Uu.shape, spec.WATER_Y)))
    plane('water_hall', np.array([[[spec.HALL_X0, spec.WATER_Y, spec.HALL_Z0], [spec.HALL_X0, spec.WATER_Y, spec.HALL_Z1]], [[spec.HALL_X1, spec.WATER_Y, spec.HALL_Z0], [spec.HALL_X1, spec.WATER_Y, spec.HALL_Z1]]]))
    return obs

def collision(coll):
    cm = bpy.data.materials.new('col_surface')
    obs = []
    def boxes(name, lst):
        V, F = [], []
        for C in lst:
            b = len(V); V += list(C); F += [[b + i for i in f] for f in U.BOX_FACES]
        o = U.mesh_from_faces(name, np.array(V), F, coll_=coll, mat=cm, smooth=False); obs.append(o)
    def strip(name, P):
        obs.append(U.grid_mesh(name, P, P[..., [0, 2]], coll_=coll, mat=cm, smooth=False))
    uu = np.arange(0.0, PATH.length + 0.01, 1.0)
    for side, nm in ((1, 'n'), (-1, 's')):
        Uu, Ss = np.meshgrid(uu, side * np.array([1.47, 3.0]), indexing='ij')
        strip('col_gallery_ledge_' + nm, PATH.world(Uu, Ss, np.full(Uu.shape, spec.LEDGE_Y)))
        Uu, Yy = np.meshgrid(uu, np.array([spec.FLOOR_Y, spec.LEDGE_Y]), indexing='ij')
        strip('col_gallery_channelwall_' + nm, PATH.world(Uu, np.full(Uu.shape, side * 1.5), Yy))
    Uu, Ss = np.meshgrid(uu, np.array([-1.5, 1.5]), indexing='ij')
    bed = np.interp(Uu, [0, 1.6, 2.4, 1e3], [spec.GATE_SILL_Y - 0.02, spec.GATE_SILL_Y - 0.02, spec.FLOOR_Y, spec.FLOOR_Y])
    strip('col_gallery_channel_bed', PATH.world(Uu, Ss, bed))
    s_p, y_p, v_p, vt = G.shell_profile(0.6)
    Uu, Vv = np.meshgrid(uu, np.arange(len(s_p)), indexing='ij')
    strip('col_gallery_vault', PATH.world(Uu, s_p[Vv], y_p[Vv]))
    # hall: walkways, piers, walls, floor, stair treads
    boxes('col_hall_walkways', [U.box_corners(x0, x1, spec.FLOOR_Y, spec.LEDGE_Y, z0, z1) for (x0, x1, z0, z1, ws) in H.WALKS])
    boxes('col_hall_piers', [U.box_corners(x - H.PH - 0.24, x + H.PH + 0.24, spec.FLOOR_Y, H.S_PIER, z - H.PH - 0.24, z + H.PH + 0.24) for x in spec.HALL_XL for z in spec.HALL_ZL])
    X0, X1, Z0, Z1 = spec.HALL_X0, spec.HALL_X1, spec.HALL_Z0, spec.HALL_Z1
    boxes('col_hall_walls', [U.box_corners(X0 - 0.3, X0, spec.FLOOR_Y, -0.9, Z0, Z1), U.box_corners(X1, X1 + 0.3, spec.FLOOR_Y, -0.9, Z0, Z1),
                             U.box_corners(X0, X1, spec.FLOOR_Y, -0.9, Z0 - 0.3, Z0), U.box_corners(X0, X1, spec.FLOOR_Y, -0.9, Z1, Z1 + 0.3)])
    xx = np.arange(X0, X1 + 0.01, 1.0); zz = np.arange(Z0, Z1 + 0.01, 1.0)
    Xg, Zg = np.meshgrid(xx, zz, indexing='ij')
    strip('col_hall_floor', np.stack([Xg, np.full(Xg.shape, spec.FLOOR_Y + 0.25), Zg], -1))
    n_r = 19; rise = (spec.STREET_Y - 0.18 - spec.LEDGE_Y) / n_r; going = 0.27
    z_top = Z1 - 0.28; z_bot = z_top - (n_r - 1) * going
    boxes('col_stair_treads', [U.box_corners(H.STAIR['x0'], H.STAIR['x1'], spec.LEDGE_Y + i * rise, spec.LEDGE_Y + (i + 1) * rise, z_bot + (i - 1) * going if i else z_bot - 0.3, z_bot + i * going + 0.03 if i < n_r - 1 else Z1) for i in range(n_r)])
    # outlet: gate doors (open), sill, vliet bed and quay walls
    def leaf(side, deg):
        hs = side * (spec.GAL_W / 2 + 0.18); a = np.radians(deg) * side
        C = U.box_corners(0, side * (spec.GAL_W / 2 + 0.12), spec.GATE_SILL_Y, -1.0, -0.06, 0.06)
        ca, sa = np.cos(a), np.sin(a)
        X = C[:, 0] - 0.0; Z = C[:, 2]
        P = C.copy()
        P[:, 0] = spec.GATE_X + hs + (X - hs + hs) * ca - Z * sa - hs * ca + hs * 0
        P[:, 0] = spec.GATE_X + hs + ((spec.GATE_X + X) - (spec.GATE_X + hs)) * ca - (Z) * sa
        P[:, 2] = (72.0 - 0.2) + ((spec.GATE_X + X) - (spec.GATE_X + hs)) * sa + Z * ca
        return P
    boxes('col_gate', [leaf(1, spec.DOOR_OPEN_DEG), leaf(-1, spec.DOOR_OPEN_DEG * 0.82),
                       U.box_corners(spec.GATE_X - 1.5, spec.GATE_X + 1.5, spec.GATE_SILL_Y - 0.32, spec.GATE_SILL_Y, 71.45, 73.6)])
    xx = np.arange(spec.VLIET_X0, spec.VLIET_X1 + 0.01, 1.0); zz = np.arange(spec.VLIET_Z0, 72.01, 1.0)
    Xg, Zg = np.meshgrid(xx, zz, indexing='ij')
    strip('col_vliet_bed', np.stack([Xg, np.full(Xg.shape, -4.95), Zg], -1))
    boxes('col_vliet_walls', [U.box_corners(spec.VLIET_X0 - 0.4, spec.VLIET_X0, -5.5, 0, spec.VLIET_Z0 - 1, 72), U.box_corners(spec.VLIET_X1, spec.VLIET_X1 + 0.4, -5.5, 0, spec.VLIET_Z0 - 1, 72)])
    su = PATH.u_at_z(GF.SHAFT_Z)
    a = PATH.world(np.array(su), np.array(GF.SHAFT_S + GF.SHAFT_H - 0.14), np.array(spec.LEDGE_Y))
    boxes('col_shaft_ladder', [U.box_corners(a[0] - 0.22, a[0] + 0.22, spec.LEDGE_Y, -0.28, a[2] - 0.22, a[2] + 0.22)])
    return obs

def markers(coll):
    out = {'lamps': [], 'beams': [], 'mist': [], 'water': [], 'ladders': [], 'stairs': [], 'outlet': {}}
    def empty(name, pos_g, props, disp='PLAIN_AXES', size=0.3):
        e = bpy.data.objects.new(name, None); coll.objects.link(e)
        e.location = U.gv(*[float(q) for q in pos_g]); e.empty_display_type = disp; e.empty_display_size = size
        for k, v in props.items():
            v = np.asarray(v)
            e[k] = float(v) if v.ndim == 0 and v.dtype.kind in 'fi' else (v.astype(float).tolist() if v.dtype.kind in 'fi' else str(v))
        return e
    k = 0
    for o in bpy.data.collections['lights_mood'].all_objects:
        if o.type != 'LIGHT' or o.name.startswith('F_') or o.name in ('L_close_lantern', 'L_crown_lantern'):
            continue
        p = o.matrix_world.translation; pg = (p.x, p.z, -p.y)
        L = o.data
        col = [round(c, 3) for c in L.color]
        if L.type == 'SPOT':
            d = (o.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()
            dg = [round(d.x, 4), round(d.z, 4), round(-d.y, 4)]
            rec = dict(name=o.name, pos=[round(v, 3) for v in pg], dir=dg, color=col, power_w=round(L.energy, 1),
                       cone_deg=round(math.degrees(L.spot_size), 2), source_radius=round(L.shadow_soft_size, 3))
            out['beams'].append(rec)
            empty('mk_beam_%02d' % len(out['beams']), pg, dict(kind='beam', dir=dg, color=col, power_w=L.energy, cone_deg=math.degrees(L.spot_size)), 'SINGLE_ARROW')
        else:
            rng_m = float(np.clip(math.sqrt(max(L.energy, 1)) * 0.9, 3.0, 20.0))
            rec = dict(name=o.name, pos=[round(v, 3) for v in pg], color=col, power_w=round(L.energy, 1), range_m=round(rng_m, 1), kind='area' if L.type == 'AREA' else 'point')
            out['lamps'].append(rec)
            empty('mk_lamp_%02d' % len(out['lamps']), pg, dict(kind='lamp', color=col, power_w=L.energy, range_m=rng_m), 'SPHERE', 0.15)
    for o in bpy.data.collections['fog'].all_objects:
        bb = np.array([o.matrix_world @ Vector(c) for c in o.bound_box])
        g = np.stack([bb[:, 0], bb[:, 2], -bb[:, 1]], -1)
        lo, hi = g.min(0), g.max(0)
        if o.name == 'fog_volume':
            for nm, (x0, x1, z0, z1) in (('gallery', (-153, -142, 72, 110.5)), ('hall', (spec.HALL_X0, spec.HALL_X1, spec.HALL_Z0, spec.HALL_Z1)), ('vliet', (spec.VLIET_X0, spec.VLIET_X1, spec.VLIET_Z0, 72))):
                lo2, hi2 = [x0, spec.WATER_Y, z0], [x1, spec.WATER_Y + 0.6, z1]
                out['mist'].append(dict(name='rot_mist_' + nm, min=lo2, max=hi2, density_peak={'hall': 0.1, 'gallery': 0.055, 'vliet': 0.03}[nm], note='low mist hugging the water, thickest near the surface'))
            continue
        out['mist'].append(dict(name=o.name, min=[round(v, 3) for v in lo], max=[round(v, 3) for v in hi], density_peak=0.1 if 'beam' in o.name else 0.05, note='dust in a light shaft'))
    for m in out['mist']:
        c = (np.array(m['min']) + np.array(m['max'])) / 2
        e = empty('mk_mist_' + m['name'], c, dict(kind='mist', size=list(np.array(m['max']) - np.array(m['min'])), density_peak=m['density_peak']), 'CUBE', 1.0)
        e.scale = U.g2b(np.array([(m['max'][0] - m['min'][0]) / 2, (m['max'][1] - m['min'][1]) / 2, (m['max'][2] - m['min'][2]) / 2])) * np.array([1, -1, 1])
    out['water'] = [dict(name='vliet', height=spec.WATER_Y, outline=[[spec.VLIET_X0, spec.VLIET_Z0 - 1], [spec.VLIET_X1, spec.VLIET_Z0 - 1], [spec.VLIET_X1, 72.3], [spec.VLIET_X0, 72.3]]),
                    dict(name='gallery', height=spec.WATER_Y, centre_line=[[round(a, 3), round(b, 3)] for a, b in PATH.P[::100]], width=3.0),
                    dict(name='hall', height=spec.WATER_Y, outline=[[spec.HALL_X0, spec.HALL_Z0], [spec.HALL_X1, spec.HALL_Z0], [spec.HALL_X1, spec.HALL_Z1], [spec.HALL_X0, spec.HALL_Z1]])]
    for w in out['water']:
        pts = np.array(w.get('outline', w.get('centre_line')))
        empty('mk_water_' + w['name'], (pts[:, 0].mean(), spec.WATER_Y, pts[:, 1].mean()), dict(kind='water', height=spec.WATER_Y), 'PLAIN_AXES', 1.0)
    su = PATH.u_at_z(GF.SHAFT_Z)
    lb = PATH.world(np.array(su), np.array(GF.SHAFT_S + GF.SHAFT_H - 0.14), np.array(spec.LEDGE_Y))
    lt = PATH.world(np.array(su), np.array(GF.SHAFT_S), np.array(0.0))
    out['ladders'].append(dict(name='grate_shaft', bottom=[round(v, 3) for v in lb], top=[round(v, 3) for v in lt], grate_size_m=[0.66, 0.66]))
    empty('mk_ladder_bottom', lb, dict(kind='ladder_bottom')); empty('mk_ladder_top', lt, dict(kind='ladder_top'))
    n_r = 19; z_top = spec.HALL_Z1 - 0.28; z_bot = z_top - (n_r - 1) * 0.27
    sxm = (H.STAIR['x0'] + H.STAIR['x1']) / 2
    sb, st = (sxm, spec.LEDGE_Y, z_bot - 0.3), (sxm, 0.0, (H.STAIR['hatch_z0'] + H.STAIR['hatch_z1']) / 2)
    out['stairs'].append(dict(name='vleeshuis_hatch', bottom=list(sb), top=list(st), hatch=[H.STAIR['x0'], H.STAIR['x1'], H.STAIR['hatch_z0'], H.STAIR['hatch_z1']]))
    empty('mk_stair_bottom', sb, dict(kind='stair_bottom')); empty('mk_stair_top', st, dict(kind='stair_top'))
    # outlet: opening outline (the hole) and dressing outline (where our stone ends), plane z = 72
    W2, SP, RISE = spec.GAL_W / 2, spec.GAL_SPRING_Y, spec.GAL_RISE
    th = np.linspace(np.pi, 0, 33)
    hole = [[spec.GATE_X - W2, spec.GATE_SILL_Y]] + [[spec.GATE_X + W2 * np.cos(t), SP + RISE * np.sin(t)] for t in th] + [[spec.GATE_X + W2, spec.GATE_SILL_Y]]
    dres = [[spec.GATE_X - W2 - 0.5, spec.GATE_SILL_Y - 0.31]] + [[spec.GATE_X - W2 - 0.5, SP]] + \
           [[spec.GATE_X + (W2 + 0.55) * np.cos(t), SP + (RISE + 0.55) * np.sin(t)] for t in th] + [[spec.GATE_X + W2 + 0.5, SP], [spec.GATE_X + W2 + 0.5, spec.GATE_SILL_Y - 0.31]]
    out['outlet'] = dict(plane_z=72.0, head_wall_x=[spec.VLIET_X0, spec.VLIET_X1], head_wall_thickness=spec.HEADWALL_T,
                         opening_xy=[[round(a, 4), round(b, 4)] for a, b in hole], dressing_xy=[[round(a, 4), round(b, 4)] for a, b in dres],
                         note='x = game x, y = game height; the opening is the hole, the dressing outline is where the bluestone frame ends')
    for nm, poly in (('opening', hole), ('dressing', dres)):
        P = np.array([[a, b, 72.0 - 0.005] for a, b in poly])
        V = np.vstack([P, P + np.array([0, 0, -0.01])]); n = len(P)
        F = [[i, i + 1, n + i + 1, n + i] for i in range(n - 1)]
        U.mesh_from_faces('mk_outlet_' + nm, V, F, coll_=coll, mat=None, smooth=False)
    return out

# ===================================================================== export
def sha(p):
    h = hashlib.sha256()
    with open(p, 'rb') as f:
        for blk in iter(lambda: f.read(1 << 20), b''):
            h.update(blk)
    return h.hexdigest()

def gltf_export(path, objs):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    props = bpy.ops.export_scene.gltf.get_rna_type().properties.keys()
    kw = dict(filepath=path, export_format='GLB', use_selection=True, export_yup=True, export_extras=True, export_apply=False)
    if 'export_attributes' in props:
        kw['export_attributes'] = True
    if 'export_vertex_color' in props:
        kw['export_vertex_color'] = 'ACTIVE'
    if 'export_all_vertex_colors' in props:
        kw['export_all_vertex_colors'] = False
    if 'export_active_vertex_color_when_no_material' in props:
        kw['export_active_vertex_color_when_no_material'] = True
    if 'export_normals' in props:
        kw['export_normals'] = True
    if 'export_tangents' in props:
        kw['export_tangents'] = False
    if 'export_image_format' in props:
        # no embedded images: every piece shares export/textures (materials are named ruien_<family>)
        kw['export_image_format'] = 'AUTO' if os.environ.get('RUIEN_EMBED_IMAGES') else 'NONE'
    if 'export_lights' in props:
        kw['export_lights'] = False
    if 'export_cameras' in props:
        kw['export_cameras'] = False
    bpy.ops.export_scene.gltf(**kw)

def export_chunks(baked, keyfn, filefn, lod, outdir, prefix, manifest, offset=None):
    """Shared by O2, kit pieces and stretches: export UVs and family materials, cut into area chunks of at most
    MAX_TRIS triangles, one GLB per file key. offset: game-space vector subtracted (kit pivots)."""
    coll = bpy.data.collections.new('EXPORT_%s_LOD%d' % (prefix, lod)); sc.collection.children.link(coll)
    chunks = {}
    for mat, md, _ in baked:
        finalize_uv_mats(mat, md)
        keys = keyfn(b2g(md.face_centroids()))
        for kk in np.unique(keys):
            chunks.setdefault(kk, []).append(md.subset(keys == kk))
    files = {}
    for kk, lst in sorted(chunks.items()):
        md = MD.merge(lst)
        if offset is not None:
            md.V = md.V - U.g2b(np.asarray(offset, float))
        for i, piece in enumerate(split_max(md)):
            if not len(piece.pt):
                continue
            name = '%s%s_lod%d_%02d' % (prefix, kk, lod, i)
            ob = piece.to_object(name, coll, mat_lookup=lambda n_: bpy.data.materials.get(n_))
            me = ob.data
            if me.color_attributes.get('Col') is not None:
                me.color_attributes.active_color = me.color_attributes['Col']
                me.color_attributes.render_color_index = me.color_attributes.active_color_index
            files.setdefault(filefn(kk), []).append(ob)
    os.makedirs(outdir, exist_ok=True)
    for fn, obs in files.items():
        path = os.path.join(outdir, '%s%s_lod%d.glb' % (prefix, fn, lod))
        gltf_export(path, obs)
        manifest['files'][os.path.basename(path)] = dict(sha256=sha(path), bytes=os.path.getsize(path), lod=lod,
            objects=[dict(name=o.name, tris=sum(len(p.vertices) - 2 for p in o.data.polygons) if o.type == 'MESH' else 0,
                          materials=[m.name for m in o.data.materials]) for o in obs])
        log('wrote', path, sum(d['tris'] for d in manifest['files'][os.path.basename(path)]['objects']), 'tris')
    return files

def main():
    setup_render()
    objs = exportable()
    log('exportable objects', len(objs))
    manifest = dict(piece='ruien-o2-20261018', coordinates='glTF +Y up; glTF (x, y, z) = (game x, game y, game z); Blender (X, Y, Z) = (x, -z, y)',
                    normal_maps='OpenGL convention (+Y green up), tangent space', files={}, textures={}, vertex_data={
                        'COLOR_0': 'masks: R wetness/slime, G lime/halo/runnel/efflorescence, B soot/grime, A moss (0..1)',
                        '_AO': 'baked ambient occlusion, 0.6 m distance, 1 = open',
                        '_BAKECOL': 'baked render base colour of the masonry (linear RGB), for reference or as a tint',
                        'UVMap': 'tiling UVs: 1 unit = one texture tile of the family set'},
                    images='not embedded: material ruien_<family> uses export/textures/ruien_<family>_*.png (see textures below)')
    os.makedirs(EXP, exist_ok=True)
    for lod in LODS:
        baked = build_lod(lod, objs)
        if baked is None:
            continue
        export_chunks(baked, area_keys, file_of, lod, EXP, 'ruien_o2_', manifest)
        # water planes for gallery and hall go into their files at LOD0 only (added once above for outlet)
    # collision and markers
    cc = bpy.data.collections.new('EXPORT_COL'); sc.collection.children.link(cc)
    cobs = collision(cc)
    p = os.path.join(EXP, 'ruien_o2_collision.glb'); gltf_export(p, cobs)
    manifest['files']['ruien_o2_collision.glb'] = dict(sha256=sha(p), bytes=os.path.getsize(p),
        objects=[dict(name=o.name, tris=sum(len(q.vertices) - 2 for q in o.data.polygons)) for o in cobs])
    mc = bpy.data.collections.new('EXPORT_MK'); sc.collection.children.link(mc)
    mk = markers(mc)
    wobs = [o for o in water_planes(mc)]
    p = os.path.join(EXP, 'ruien_o2_markers.glb'); gltf_export(p, list(mc.objects))
    manifest['files']['ruien_o2_markers.glb'] = dict(sha256=sha(p), bytes=os.path.getsize(p), objects=[dict(name=o.name, type=o.type) for o in mc.objects])
    manifest['markers'] = mk
    tinfo = json.load(open(os.path.join(TEXD, 'texture_sets.json')))
    for fam, inf in tinfo.items():
        manifest['textures'][fam] = dict(tile_m=inf['tile_m'], relief_m=inf['relief_m'], note=inf.get('note', ''),
                                         files={f: sha(os.path.join(TEXD, f)) for f in inf['files']})
    manifest['materials'] = {m.name: m.get('ruien_family') for m in _emats.values()}
    json.dump(manifest, open(os.path.join(EXP, 'manifest.json'), 'w'), indent=1, default=lambda o: o.tolist() if hasattr(o, 'tolist') else float(o))
    log('manifest written')

if __name__ == '__main__':
    main()
