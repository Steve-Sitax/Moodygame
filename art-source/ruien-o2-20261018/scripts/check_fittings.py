# Headless checks of the R2 rail and R3 drain pieces in a built stretch (.blend from build_stretch.py):
# blender --background <out>/<route>.blend --python scripts/check_fittings.py -- --route L105 [--walkway 1] [--report <json>]
import bpy, sys, os, json
import numpy as np
import bmesh
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(ROOT))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
def arg(k, d=None):
    return argv[argv.index(k) + 1] if k in argv else d
from kit import sweep as KS, fitlib as FL, drain_crossing as KD, arch_rim as AR
RID = arg('--route', 'L105')
r = json.load(open(os.path.join(REPO, 'docs', 'plans', 'ruien', 'ruien-routes.json')))['routes'][RID]
sec = KS.Section(r['class'], int(arg('--walkway', '1')))
path = KS.RoutePath([tuple(p) for p in r['pts']], r=sec.W * 1.2)
cfg = FL.data(r['class'])
side = sec.sides[0]
lo, hi = sec.channel_edges(); edge = hi if side > 0 else lo
y0 = sec.ledge_y
res = []
def check(name, ok, detail=''):
    res.append(dict(name=name, ok=bool(ok), detail=str(detail)))
    print('FITCHECK %s: %s %s' % (name, 'PASS' if ok else 'FAIL', detail), flush=True)
def local(P):
    """(u, s) of game points."""
    out = np.zeros((len(P), 2))
    for i, p in enumerate(P):
        u, _ = path.u_near(p[0], p[2])
        px, pz, tx, tz, nx, nz = path.frame(np.array(u))
        out[i] = (u, (p[0] - float(px)) * float(nx) + (p[2] - float(pz)) * float(nz))
    return out
def boundary_edges(o):
    bm = bmesh.new(); bm.from_mesh(o.data)
    n = sum(1 for e in bm.edges if e.is_boundary); bm.free(); return n
obs = [o for o in bpy.data.objects if o.type == 'MESH']
# ---- rail: every part stays on the channel side of the coping face above the walk: the 0.8 m stays clear
rail = [o for o in obs if o.name.startswith(('rail_', 'escape_iron'))]
worst = 1e9
for o in rail:
    P = FL.mesh_points(o)
    P = P[P[:, 1] > y0 - 0.01][::7]
    if len(P):
        S = local(P)[:, 1]
        worst = min(worst, float(np.min(side * (edge - 0.04) - side * S)) if not o.name.startswith('escape') else 1.0)
check('rail parts clear of the walkway (coping face) above the walk', worst >= -0.0025, 'closest %.4f m' % worst)
open_parts = [o.name for o in rail + [o for o in obs if o.name.endswith(('_grate_frame', '_grate_bar', '_grate_tie', '_rim', '_sill', '_kerb'))] if boundary_edges(o) > 0]
check('rail, grate, sill and arch rim pieces are closed solids (no see-through faces)', not open_parts, open_parts[:8])
nocol = [o.name for o in rail + [o for o in obs if o.name.endswith('_rim') or o.name.startswith('runoff_') or '_grate_' in o.name]
         if o.get('ruien_collision', True) and not o.name.startswith(('escape_iron', 'rail_col_', 'runoff_')) and not o.name.endswith('_col')]
check('thin ironwork, arch rims and stains carry no collision of their own', not nocol, nocol[:6])
# arch rims (kit/arch_rim.py): one solid each, no loose header bricks, charts within RuienUv's limits
rims = [o for o in obs if o.get('ruien_arch_rim')]
loose = [o.name for o in obs if o.name.endswith('_header')]
check('drain mouths use one arch rim each, no loose header bricks', len(rims) >= len([o for o in obs if o.name.endswith('_lining') and '_drain_' in o.name]) and not loose, loose[:4])
for o in rims:
    a, b, w = AR.uv_audit(o)
    check(o.name + ' charts within the UV audit (anisotropy <= 1.3, scale 0.6-1.7)', b < 1e-4, 'area %.2f m2, stretched %.5f m2, worst %.3f, %d tris' % (a, b, w, AR.triangles(o)))
# posts: spacing along the rail and radial standing
posts = [o for o in obs if o.name.startswith('rail_post')]
pc = np.array([FL.mesh_points(o).mean(0) for o in posts])
order = np.argsort(local(pc)[:, 0]); pc = pc[order]
pu = list(np.r_[0, np.cumsum(np.linalg.norm(np.diff(pc[:, [0, 2]], axis=0), axis=1))])
placements = None
# ---- collision proxies: the rail slabs leave a gap only at the shaft ladders
col = [o for o in obs if o.name.startswith('rail_col_')]
cu = [local(FL.mesh_points(o)[::4])[:, 0] for o in col]
spans = sorted((float(c.min()), float(c.max())) for c in cu)
gaps = [(a[1], b[0]) for a, b in zip(spans[:-1], spans[1:])]
shafts = [o for o in obs if o.name.startswith('ladder_stringer')]
su = sorted(set(round(float(x), 1) for x in local(np.array([FL.mesh_points(o).mean(0) for o in shafts]))[:, 0])) if shafts else []
gapw = cfg['rail']['ladderGap']
starts = spans and (spans[0][0] < cfg['rail']['mouthClear'] + 0.05 or any(abs(spans[0][0] - (s + gapw / 2)) < 0.4 for s in su))
ends = spans and (spans[-1][1] > path.length - cfg['rail']['mouthClear'] - 0.05 or any(abs(spans[-1][1] - (s - gapw / 2)) < 0.4 for s in su))
ends_ok = starts and ends
# a tee end stops the rail before the junction: accept an end within 1 m of the junction's pieces
tee = [o for o in obs if '_tee_' in o.name]
if not ends_ok and tee and spans:
    tu = np.concatenate([local(FL.mesh_points(o)[::50])[:, 0] for o in tee])
    near_ring = lambda u: min(abs(u - tu.min()), abs(u - tu.max())) < 1.0
    ends_ok = (starts or near_ring(spans[0][0])) and (ends or near_ring(spans[-1][1]))
check('rail collision runs from mouth to mouth (or to a ladder gap or tee ring at an end)', ends_ok, spans)
ok = all(any(g0 - 0.05 <= s <= g1 + 0.05 for (g0, g1) in gaps) or s > spans[-1][1] or s < spans[0][0] for s in su) and len(gaps) <= len(su)
check('rail collision gaps only at ladders', ok, 'gaps %s, shafts %s' % (gaps, su))
d = np.diff(pu)
d = d[d < cfg['rail']['ladderGap'] * 0.9] if False else d
check('post spacing along the rail within the data spacing', len(d) and d.max() <= cfg['rail']['postSpacing'] + 0.01, 'max %.3f m, min %.3f m' % (d.max(), d.min()))
bars = [o for o in obs if o.name.startswith('rail_bar')]
kinks = 0.0
for o in bars:
    me = o.data
    # the tube's first ring vertices follow the polyline; read centre line from loops of 12
    P = FL.mesh_points(o)
    n = 12; m = (len(P) - 2) // n
    C = P[:m * n].reshape(m, n, 3).mean(1)
    T = np.diff(C, axis=0); T /= np.linalg.norm(T, axis=1, keepdims=True)
    ang = np.degrees(np.arccos(np.clip((T[:-1] * T[1:]).sum(1), -1, 1)))
    kinks = max(kinks, float(ang[2:-2].max()) if len(ang) > 4 else 0)
check('rails bend smoothly (largest turn between 10 cm samples)', kinks < 4.0, '%.2f deg' % kinks)
# ---- drains
crossings = [o for o in obs if o.name.endswith('_kerb')]
shell = bpy.data.objects.get('%s_vault' % RID)
walk = bpy.data.objects.get('%s_walk_%s' % (RID, 'n' if side > 0 else 's'))
egg = KD.Egg(1.6, 1.0)
for o in [o for o in obs if o.name.endswith('_lining') and '_drain_' in o.name]:
    nm = o.name[:-len('_lining')]
    c = FL.mesh_points(o)
    # the lining's first ring sits on the face: its centre gives u and side
    k0 = len(egg.Q[::8])
    u, _ = path.u_near(*c[:k0].mean(0)[[0, 2]])
    s_c = local(c[:k0].mean(0)[None])[0, 1]
    sd = 1 if s_c > 0 else -1
    fr = FL.Frame(path, sec, u, sd)
    y_inv = c[:, 1].min()
    if shell is not None:
        me = shell.data
        F = np.array([p.center for p in me.polygons]); F = np.stack([F[:, 0], F[:, 2], -F[:, 1]], -1)
        near = F[np.abs(F[:, 0] - fr.W(0, 0, 0)[0]) + np.abs(F[:, 2] - fr.W(0, 0, 0)[2]) < 2.5]
        L = local(near)
        du = L[:, 0] - u; dd = sec.hw - sd * L[:, 1]
        inside = 0
        for k in range(len(near)):
            if abs(dd[k]) < 0.25:
                h = near[k, 1] - y_inv
                if 0.03 < h < 1.57 and abs(du[k]) < float(KD.G.egg_hw(h)) - 0.03:
                    inside += 1
        check(nm + ' host wall cut open inside the egg', inside == 0, '%d faces left in the opening' % inside)
    if o.name.replace('_lining', '_kerb') in bpy.data.objects and walk is not None:
        P = np.array([p.center for p in walk.data.polygons]); P = np.stack([P[:, 0], P[:, 2], -P[:, 1]], -1)
        P = P[np.hypot(P[:, 0] - fr.W(0, 0, 0)[0], P[:, 2] - fr.W(0, 0, 0)[2]) < 1.5]
        L = local(P)
        bad = int(np.sum(np.abs(L[:, 0] - u) < cfg['drainCrossing']['sillHalf'] - 0.01))
        check(nm + ' walkway cut under the sill (no paving under the stones)', bad == 0, '%d faces' % bad)
        cop = [q for q in obs if '_coping_' in q.name]
        over = 0
        for q in cop:
            Lq = local(FL.mesh_points(q)[::5])
            if np.sign(Lq[:, 1].mean()) == sd and np.any(np.abs(Lq[:, 0] - u) < cfg['drainCrossing']['sillHalf'] - 0.01):
                over += 1
        check(nm + ' coping re-laid round the lip stone', over == 0, '%d blocks overlap' % over)
        gp = [q for q in bpy.data.objects if q.name.startswith(nm + '_grate_col')]
        check(nm + ' grate walked on as a flush plate', len(gp) == 1)
out = arg('--report')
if out:
    json.dump(res, open(out, 'w'), indent=1)
print('FITCHECK total %d/%d' % (sum(r_['ok'] for r_ in res), len(res)))
