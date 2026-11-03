# Ruien kit: junction room (Steve's J1, a shallow brick dome) from a room rectangle in docs/plans/ruien/ruien-routes.json.
#
# Form: a sail vault (pendentives and cap in one sphere through the four corners), pierced by lunettes over the
# rui mouths. A rectangle suits pendentives: the sphere circumscribes any rectangle, the four wall arches are
# segmental arches of their own rise, and the corner triangles are the pendentives. Squinches would first turn the
# rectangle into an irregular octagon and need a drum above them; the 0.9 m street cover leaves no height for that.
# The crown may not rise above -0.9 and the rui vaults already reach -0.9, so every mouth is a lunette (a short
# elliptic barrel cut into the dome under a bonded header ring), never an arch below the dome's springing.
# Rooms too long for one shallow dome get equal bays with transverse header arches on bluestone bearing blocks.
#
# Everything is derived from the room rectangle, the plan's lines that end in the room and the street mask; a few
# choices can be overridden (mouth position, walkway side, stair wall). All random detail is seeded from the room id.
import math
import zlib
import numpy as np
import bpy
from mathutils import Vector, geometry as MG
from rlib import util as U, gallery as G, props as PR, wax as WX, chosen as CH
from rlib import hall as H
from kit.sweep import Section
from kit import arch_rim as AR

SEC = Section('M', 1)
P = dict(
    wall=0.5,            # room wall thickness (two bricks)
    walk=0.8,            # walkway width, as the rui's
    cope=0.4,            # bluestone coping width (0.04 over the water)
    corner_y=-2.1,       # sail vault springing in the corners: 2 m head room over the walkway beside them
    apex_y=-0.9,         # crown: 0.9 m under the street
    lun_crown=-0.93,     # lunette (elliptic barrel) crown over a mouth
    ring_crown=-0.945,   # mouth ring intrados crown: the giant's 3.86 m capsule keeps 2 cm at its shoulder 0.4 m off the centre line
    ring_w=0.24, ring_proud=0.06,   # ring_w spaces the mouths in the plan; ring_proud sets the imposts (the rim is AR.PROUD)
    hole=0.2,            # (#292) the wall's hole round an arch rim: inside the rim's 0.11-0.34 m face, behind it
    spring=-2.7, hw=1.8, rui_wall=0.36, stub=1.2,
    rui_walk_in=1.0,     # rui walkway edge, measured from the rui axis (channel 2.8 m, walkway 0.8 m)
    oculus=0.42,         # hole in the crown under the D1 shaft (its flare covers 0.6 m)
    stair_w=1.3, stair_spring=-2.55, landing=1.0, going=0.27, riser_max=0.18, headroom=2.4, street=0.0,   # 2.4 m over the nosings: Jef's 0.32 m disk rests on the next step and reaches back under the slope
    max_flat=14.0,       # full diagonal / rise of one bay at most
    min_arch=1 / 12.5,   # transverse arch rise / span at least
    max_aspect=1.6,
    grid=0.08, fine=0.025, wstep=0.025,
)
BED_BOT = SEC.bed - 0.15
WALL_OVER = 0.12            # walls rise this far behind the vault, the vault runs 0.12 m out behind the walls
WALK_BOT = BED_BOT          # walls run down to the bed behind the walkways too (no open joint under the setts)

def seed(room_id, k=0):
    return zlib.crc32(('%s/%d' % (room_id, k)).encode()) & 0x7fffffff

def smax(a, b, k=0.012):
    h = np.clip(k - np.abs(a - b), 0, None) / k
    return np.maximum(a, b) + h * h * k * 0.25

def f32(a):
    return np.asarray(a, np.float32).astype(np.float64)

# ------------------------------------------------------------------ plan: walls, mouths, bays, stair, walkways
def wall_frame(rect, w):
    x0, z0, x1, z1 = rect
    return {'z0': (np.array([x0, z0]), np.array([1.0, 0]), np.array([0, -1.0]), x1 - x0),
            'z1': (np.array([x0, z1]), np.array([1.0, 0]), np.array([0, 1.0]), x1 - x0),
            'x0': (np.array([x0, z0]), np.array([0, 1.0]), np.array([-1.0, 0]), z1 - z0),
            'x1': (np.array([x1, z0]), np.array([0, 1.0]), np.array([1.0, 0]), z1 - z0)}[w]

def wpt(rect, w, t, d=0.0):
    """Plan point on wall w at t, d metres into the room."""
    p0, tv, n, L = wall_frame(rect, w)
    return p0 + tv * np.asarray(t, float)[..., None] - n * np.asarray(d, float)[..., None]

RING = [('z0', 1), ('x1', 1), ('z1', -1), ('x0', -1)]   # walls in perimeter order and the t direction walked

def inside(p, rect, m=0.0):
    return rect[0] - m <= p[0] <= rect[2] + m and rect[1] - m <= p[1] <= rect[3] + m

def exit_point(a, b, rect):
    """Where the segment a (inside) to b leaves the rectangle: (wall, t, point)."""
    a, b = np.asarray(a, float), np.asarray(b, float); d = b - a
    best = None
    for w, ax, val in (('x0', 0, rect[0]), ('x1', 0, rect[2]), ('z0', 1, rect[1]), ('z1', 1, rect[3])):
        if abs(d[ax]) < 1e-9:
            continue
        s = (val - a[ax]) / d[ax]
        if s <= 1e-6:
            continue
        p = a + d * s
        if inside(p, rect, 1e-6) and (best is None or s < best[0]):
            t = p[0] - rect[0] if w in ('z0', 'z1') else p[1] - rect[1]
            best = (s, w, t, p)
    return best[1:] if best else None

def find_mouths(room, routes):
    rect = room['rect']; out = []
    for rid, r in routes.items():
        if r.get('class') != 'M':
            continue
        pts = [tuple(p) for p in r['pts']]
        for end in (0, -1):
            if not inside(pts[end], rect, 0.6):
                continue
            seq = pts if end == 0 else pts[::-1]
            for a, b in zip(seq, seq[1:]):
                if not inside(b, rect):
                    e = exit_point(a if inside(a, rect) else ((rect[0] + rect[2]) / 2, (rect[1] + rect[3]) / 2), b, rect)
                    if e:
                        out.append(dict(route=rid, wall=e[0], t_line=float(e[1]), name=r.get('name', rid), toward=list(b)))
                    break
    return out

def plan_bays(rect):
    """Equal bays along the long side: the fewest whose dome is not too flat and whose transverse arch is not too flat."""
    W, Lz = rect[2] - rect[0], rect[3] - rect[1]
    along = 'z' if Lz >= W else 'x'
    long_, short = (Lz, W) if along == 'z' else (W, Lz)
    rise = P['apex_y'] - P['corner_y']
    for n in range(1, 9):
        bl = long_ / n
        d = math.hypot(bl / 2, short / 2)
        R = (d * d + rise * rise) / (2 * rise)
        flat_ok = 2 * d / rise <= P['max_flat'] and max(bl, short) / min(bl, short) <= P['max_aspect'] + (0.0 if n > 1 else 0.4)
        # transverse arch: the bay's wall arch on the boundary plane, from the corner springing up
        arch_top = P['apex_y'] - (R - math.sqrt(max(R * R - (bl / 2) ** 2, 0)))
        arch_ok = n == 1 or (arch_top - P['corner_y']) / short >= P['min_arch']
        if flat_ok and arch_ok:
            break
    edges = [(rect[1] if along == 'z' else rect[0]) + long_ * k / n for k in range(n + 1)]
    bays = []
    for k in range(n):
        r = [rect[0], edges[k], rect[2], edges[k + 1]] if along == 'z' else [edges[k], rect[1], edges[k + 1], rect[3]]
        cx, cz = (r[0] + r[2]) / 2, (r[1] + r[3]) / 2
        d = math.hypot((r[2] - r[0]) / 2, (r[3] - r[1]) / 2)
        R = (d * d + rise * rise) / (2 * rise)
        bays.append(dict(rect=r, c=(cx, cz), R=R, yc=P['apex_y'] - R))
    return dict(along=along, n=n, bays=bays, edges=edges)

def mouth_span(m):
    return m['t'] - P['hw'], m['t'] + P['hw']

def walk_part(m):
    a, b = mouth_span(m)
    return (m['t'] + P['rui_walk_in'], b) if m['side'] > 0 else (a, m['t'] - P['rui_walk_in'])

def channel_part(m):
    a, b = mouth_span(m)
    return (a, m['t'] + P['rui_walk_in']) if m['side'] > 0 else (m['t'] - P['rui_walk_in'], b)

def fit_mouths(rect, mouths, bays, over):
    """Mouth centre on its wall where the plan's line crosses it, clear of corners and bay boundaries."""
    for m in mouths:
        p0, tv, n, L = wall_frame(rect, m['wall'])
        t = over.get(m['route'], {}).get('t', m['t_line'])
        lo, hi = P['hw'] + P['ring_w'] + 0.25, L - P['hw'] - P['ring_w'] - 0.25
        m['t'] = float(np.clip(t, lo, hi)) if lo <= hi else L / 2
        # on a long wall of a several-bay room: inside one bay
        if bays['n'] > 1 and ((bays['along'] == 'z') == (m['wall'] in ('x0', 'x1'))):
            off = rect[1] if bays['along'] == 'z' else rect[0]
            for e in bays['edges'][1:-1]:
                e -= off
                if abs(m['t'] - e) < P['hw'] + P['ring_w'] + 0.4:
                    m['t'] = e - (P['hw'] + P['ring_w'] + 0.4) if m['t'] < e else e + (P['hw'] + P['ring_w'] + 0.4)
        m['side'] = over.get(m['route'], {}).get('side', 0)
    return mouths

def stair_numbers():
    rise_total = P['street'] - SEC.ledge_y
    nr = int(math.ceil(rise_total / P['riser_max']))
    rise = rise_total / nr
    a0 = P['wall'] + 0.5                         # flight foot: the landing runs through the wall and 0.5 m on
    slope = rise / P['going']
    a_top = a0 + (nr - 1) * P['going']           # last riser, up to the street
    # the inclined barrel's crown stays under the street cover; beyond, the stairwell is open under the hatch
    crown0 = P['stair_spring'] + P['stair_w'] / 2
    a_h = a0 + (P['apex_y'] - P['headroom'] - SEC.ledge_y) / slope
    return dict(nr=nr, rise=rise, a0=a0, slope=slope, a_top=a_top, a_hatch=a_h, crown0=crown0)

def connected_lines(rect, mouths, routes):
    """Every rui line near the room as the stretch will run it: lines that end in the room start at their mouth's
    stub end and pick up the plan's line 5 m from the room."""
    lines = []
    ids = {m['route']: m for m in mouths}
    for rid, r in routes.items():
        pts = np.array(r['pts'], float)
        if rid in ids:
            m = ids[rid]
            seq = pts if inside(pts[0], rect, 0.6) else pts[::-1]
            far = [p for p in seq if not inside(p, rect, 5.0)]
            start = wpt(rect, m['wall'], m['t'], -(P['wall'] + P['stub']))
            lines.append(np.array([wpt(rect, m['wall'], m['t'], 0.0), start] + far[:1]))
        else:
            lines.append(pts)
    return lines

def stair_fits(rect, c, mouths, routes, on_street):
    """Street exit in the street, the whole flight clear of the rui vaults round it."""
    flight = stair_numbers()
    p0, tv, n, L = wall_frame(rect, c['wall'])
    under = 0; n_s = 0; ok = True
    for a in np.arange(0.0, flight['a_top'] + 0.5, 0.25):
        for l in np.linspace(-P['stair_w'] / 2 - 0.3, P['stair_w'] / 2 + 0.3, 5):
            q = wpt(rect, c['wall'], c['t'] + l) + n * a
            n_s += 1
            if on_street(q[0], q[1]):
                under += 1
            elif a >= flight['a_hatch'] - 0.4:
                ok = False
    clear = P['hw'] + P['rui_wall'] + P['stair_w'] / 2 + 0.3
    for pts in connected_lines(rect, mouths, routes):
        for a in np.arange(P['wall'], flight['a_top'] + 0.3, 0.25):
            q = wpt(rect, c['wall'], c['t']) + n * a
            for s0, s1 in zip(pts[:-1], pts[1:]):
                ab = s1 - s0; tt = np.clip(np.dot(q - s0, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
                if np.linalg.norm(q - s0 - ab * tt) < clear:
                    ok = False
    return ok, under / max(n_s, 1)

def plan_stair(rect, mouths, routes, on_street, over):
    """Try every wall end for the corner arch; a mouth on the same wall may move up to 3 m off its line to make room."""
    tried = []
    for w, _ in RING:
        p0, tv, n, L = wall_frame(rect, w)
        for end in ('lo', 'hi'):
            if 'stair' in over and (over['stair']['wall'], over['stair']['end']) != (w, end):
                continue
            t = 0.3 + P['stair_w'] / 2 if end == 'lo' else L - 0.3 - P['stair_w'] / 2
            c = dict(wall=w, end=end, t=t)
            span = (t - P['stair_w'] / 2 - 0.2, t + P['stair_w'] / 2 + 0.2)
            keep = {id(m): m['t'] for m in mouths}
            good = True; moves = 0
            for m in mouths:
                if m['wall'] != w:
                    continue
                if mouth_span(m)[1] + P['ring_w'] + 0.3 < span[0] or mouth_span(m)[0] - P['ring_w'] - 0.3 > span[1]:
                    continue
                need = P['stair_w'] / 2 + 0.2 + 0.3 + P['ring_w'] + P['hw']
                nt = (t + need) if end == 'lo' else (t - need)
                if P['hw'] + P['ring_w'] + 0.25 <= nt <= L - P['hw'] - P['ring_w'] - 0.25 and abs(nt - m['t_line']) < 3.0:
                    m['t'] = nt; moves += 1
                else:
                    good = False
            ok, share = stair_fits(rect, c, mouths, routes, on_street) if good else (False, 0)
            tried.append((not ok, moves, -share, w, end, c, {id(m): m['t'] for m in mouths}))
            for m in mouths:
                m['t'] = keep[id(m)]
    tried.sort(key=lambda x: x[:3])
    if not tried or tried[0][0]:
        raise RuntimeError('no corner of %s gives a stair that ends in the street: %s' % (rect, [(x[3], x[4]) for x in tried]))
    best = tried[0]
    for m in mouths:
        m['t'] = best[6][id(m)]
    c = best[5]; c.update(stair_numbers())
    return c

def perimeter(rect):
    """Perimeter coordinate: (wall, direction, p_start, length) in RING order."""
    segs = []; p = 0.0
    for w, d in RING:
        L = wall_frame(rect, w)[3]
        segs.append((w, d, p, L)); p += L
    return segs, p

def to_p(rect, w, t):
    for (ww, d, p0, L) in perimeter(rect)[0]:
        if ww == w:
            return p0 + (t if d > 0 else L - t)

def plan_walks(rect, mouths, stair, over):
    """Choose each rui's walkway side and the fewest footbridges so the walkway joins every rui walkway and the
    stair. Returns mouths (with side), walk intervals on the perimeter, bridges (inlets crossed)."""
    segs, total = perimeter(rect)
    ps = to_p(rect, stair['wall'], stair['t'])
    best = None
    free = [m for m in mouths if not m['side']]
    for k in range(2 ** len(free)):
        for i, m in enumerate(free):
            m['side'] = 1 if (k >> i) & 1 else -1
        inl = []
        for i, m in enumerate(mouths):
            a, b = channel_part(m); pa, pb = sorted((to_p(rect, m['wall'], a), to_p(rect, m['wall'], b)))
            wa, wb = walk_part(m); pw = to_p(rect, m['wall'], (wa + wb) / 2)
            inl.append((pa, pb, i, pw))
        inl.sort()
        n = len(inl)
        # segment j runs from inlet j's end to inlet j+1's start (cyclic)
        def seg_of(p):
            for j in range(n):
                a = inl[j][1]; b = inl[(j + 1) % n][0] + (total if j == n - 1 else 0)
                q = p if p >= a else p + total
                if a <= q <= b:
                    return j
            return None
        need = {seg_of(ps)} | {seg_of(x[3]) for x in inl}
        need = sorted(j for j in need if j is not None)
        # gaps between consecutive needed segments, counted in inlets; leave the largest gap open
        gaps = []
        for i, j in enumerate(need):
            nj = need[(i + 1) % len(need)]
            c = (nj - j) % n if len(need) > 1 else 0
            gaps.append((c, j, nj))
        if len(need) > 1:
            open_gap = max(gaps, key=lambda g: (g[0], -g[1]))
            bridged = [g for g in gaps if g is not open_gap]
        else:
            bridged = []
        cost = sum(g[0] for g in bridged)
        walk_segs = set(need)
        bridges = []
        for c, j, nj in bridged:
            q = j
            while q != nj:
                bridges.append(inl[(q + 1) % n][2]); q = (q + 1) % n; walk_segs.add(q)
        key = (cost, k)
        if best is None or key < best[0]:
            best = (key, {id(m): m['side'] for m in free}, sorted(walk_segs), bridges, inl)
    for m in free:
        m['side'] = best[1][id(m)]
    _, _, walk_segs, bridges, inl = best
    n = len(inl)
    intervals = []
    for j in walk_segs:
        a = inl[j][1]; b = inl[(j + 1) % n][0]
        if b <= a:
            b += total
        intervals.append((a, b))
    return intervals, [mouths[i] for i in bridges]

def runs_from_intervals(rect, intervals):
    """Walkway runs along single walls from perimeter intervals: (wall, ta, tb, end kinds)."""
    segs, total = perimeter(rect)
    runs = []
    for (a, b) in intervals:
        for (w, d, p0, L) in segs:
            for off in (0.0, total):
                lo, hi = max(a, p0 + off), min(b, p0 + L + off)
                if hi - lo > 1e-6:
                    q0, q1 = lo - p0 - off, hi - p0 - off
                    t0, t1 = (q0, q1) if d > 0 else (L - q1, L - q0)
                    runs.append(dict(wall=w, ta=t0, tb=t1))
    return runs

def plan_room(room, routes, on_street, over=None):
    over = over or {}
    rect = room['rect']
    bays = plan_bays(rect)
    mouths = fit_mouths(rect, find_mouths(room, routes), bays, over)
    stair = plan_stair(rect, mouths, routes, on_street, over)
    intervals, bridges = plan_walks(rect, mouths, stair, over)
    runs = runs_from_intervals(rect, intervals)
    grates = [tuple(g) for g in over.get('grates', [])]
    if not grates and over.get('crown_grate', True):
        # a crown shaft's flared rim hangs to -1.05, so it keeps 1.4 m off the giant's through barrels
        axes = []
        if bays['n'] > 1:
            for m in mouths:
                if (bays['along'] == 'z') == (m['wall'] in ('z0', 'z1')):
                    axes.append(wpt(rect, m['wall'], m['t'])[0 if bays['along'] == 'z' else 1])
        for b in bays['bays']:
            c = np.array(b['c'], float); k = 0 if bays['along'] == 'z' else 1
            if axes and min(abs(c[k] - a) for a in axes) < 1.4:
                cands = sorted([a - 1.4 for a in axes] + [a + 1.4 for a in axes], key=lambda v: abs(v - c[k]))
                lo_, hi_ = (rect[0], rect[2]) if k == 0 else (rect[1], rect[3])
                ok = [v for v in cands if min(abs(v - a) for a in axes) >= 1.4 - 1e-6 and lo_ + 1.2 < v < hi_ - 1.2]
                ok = [v for v in ok if on_street(*(c * (1 - np.eye(2)[k]) + np.eye(2)[k] * v))]
                if not ok:
                    continue
                c[k] = ok[0]
            if on_street(c[0], c[1]):
                grates.append((float(c[0]), float(c[1])))
    return dict(room=room['id'], name=room.get('name', room['id']), rect=rect, bays=bays, mouths=mouths, stair=stair,
                runs=runs, bridges=bridges, grates=grates)

# ------------------------------------------------------------------ the surfaces
class Room:
    def __init__(self, lay):
        self.lay = lay
        self.rect = lay['rect']
        self.bays = lay['bays']['bays']
        self.mouths = lay['mouths']
        rl = P['lun_crown'] - P['spring']
        th = np.linspace(0, np.pi, 4001)
        es, ey = P['hw'] * np.cos(th), rl * np.sin(th)
        arc = np.r_[0, np.cumsum(np.hypot(np.diff(es), np.diff(ey)))]
        self._ell_s, self._ell_v = es[::-1], (arc - arc[2000])[::-1]   # s ascending, v from the crown

    def bay_of(self, x, z):
        x = np.clip(x, self.rect[0], self.rect[2]); z = np.clip(z, self.rect[1], self.rect[3])
        k = np.zeros(np.shape(x), int)
        for i, b in enumerate(self.bays):
            r = b['rect']
            k = np.where((x >= r[0] - 1e-9) & (z >= r[1] - 1e-9), np.where((x <= r[2] + 1e-9) & (z <= r[3] + 1e-9), i, k), k)
        return k

    def sphere(self, i, x, z):
        b = self.bays[i]
        r2 = (x - b['c'][0]) ** 2 + (z - b['c'][1]) ** 2
        return b['yc'] + np.sqrt(np.maximum(b['R'] ** 2 - r2, 0))

    def mouth_local(self, m, x, z):
        p0, tv, n, L = wall_frame(self.rect, m['wall'])
        q = np.stack([x, z], -1) - p0
        return q @ tv - m['t'], q @ (-n)            # lateral s, depth a into the room

    def lunette(self, m, x, z):
        s, a = self.mouth_local(m, x, z)
        rl = P['lun_crown'] - P['spring']
        y = P['spring'] + rl * np.sqrt(np.clip(1 - (s / P['hw']) ** 2, 0, 1))
        bx, bz = self.mouth_bay_centre(m)
        # a mouth on a short wall of a several-bay room runs on as a barrel through every bay (the giant's way)
        ok = (np.abs(s) < P['hw']) & ((self.bay_of(x, z) == m['bay']) | m.get('through', False))
        return np.where(ok, y, -9.0)

    def mouth_bay_centre(self, m):
        return self.bays[m['bay']]['c']

    def ceil(self, x, z):
        """Ceiling height, the surface on top (0.. bays, then 100+ mouths) and the gap to the next one."""
        x = np.asarray(x, float); z = np.asarray(z, float)
        k = self.bay_of(x, z)
        hs = np.choose(k, [self.sphere(i, x, z) for i in range(len(self.bays))]) if len(self.bays) > 1 else self.sphere(0, x, z)
        Hs = [hs] + [self.lunette(m, x, z) for m in self.mouths]
        S = np.stack(Hs)
        order = np.argsort(-S, axis=0)
        top = np.take_along_axis(S, order[:1], 0)[0]
        second = np.take_along_axis(S, order[1:2], 0)[0] if len(Hs) > 1 else np.full(top.shape, -9.0)
        h = Hs[0]
        for L_ in Hs[1:]:
            h = smax(h, L_)
        dom = np.where(order[0] == 0, k, 100 + order[0] - 1)
        return h, dom, top - second

    def ell_v(self, s):
        return np.interp(s, self._ell_s, self._ell_v)

# ------------------------------------------------------------------ meshing helpers
def pip(P2, poly):
    """Even-odd point in polygon, vectorised."""
    x, y = P2[:, 0], P2[:, 1]; c = np.zeros(len(P2), bool)
    px, py = poly[:, 0], poly[:, 1]; qx, qy = np.roll(px, -1), np.roll(py, -1)
    for i in range(len(poly)):
        cond = ((py[i] > y) != (qy[i] > y))
        xi = (qx[i] - px[i]) * (y - py[i]) / np.where(qy[i] - py[i] == 0, 1e-12, qy[i] - py[i]) + px[i]
        c ^= cond & (x < xi)
    return c

def seg_dist(P2, poly, closed=True):
    A = poly; B = np.roll(poly, -1, 0) if closed else poly[1:]
    if not closed:
        A = poly[:-1]
    out = np.full(len(P2), 9e9)
    for s in range(0, len(A), 512):
        a, b = A[s:s + 512], B[s:s + 512]; ab = b - a
        l2 = np.maximum(np.sum(ab * ab, 1), 1e-12)
        t = np.clip(((P2[:, None, :] - a[None]) * ab[None]).sum(-1) / l2[None], 0, 1)
        d = np.linalg.norm(P2[:, None, :] - (a[None] + t[..., None] * ab[None]), axis=2).min(1)
        out = np.minimum(out, d)
    return out

def clean_poly(poly, eps=1e-5):
    poly = np.asarray(poly, float)
    keep = [0]
    for i in range(1, len(poly)):
        if np.linalg.norm(poly[i] - poly[keep[-1]]) > eps:
            keep.append(i)
    poly = poly[keep]
    if len(poly) > 2 and np.linalg.norm(poly[0] - poly[-1]) < eps:
        poly = poly[:-1]
    return poly

def densify(poly, step):
    out = []
    for a, b in zip(poly, np.roll(poly, -1, 0)):
        n = max(1, int(np.ceil(np.linalg.norm(b - a) / step)))
        out += [a + (b - a) * k / n for k in range(n)]
    return np.array(out)

def cdt(polys, holes=(), steiner=None, spacing=0.1):
    """Constrained Delaunay of polygons (outer boundaries) minus holes, with interior points; boundary edges are
    cut to the point spacing so no sliver runs along a border. Returns (V2, F)."""
    polys = [densify(clean_poly(p), spacing * 1.2) for p in polys]; holes = [densify(clean_poly(h), spacing * 1.2) for h in holes]
    verts, edges = [], []
    for poly in list(polys) + list(holes):
        b = len(verts); n = len(poly)
        verts += [tuple(p) for p in poly]; edges += [(b + i, b + (i + 1) % n) for i in range(n)]
    nb = len(verts)
    if steiner is not None and len(steiner):
        S = np.asarray(steiner, float)
        inn = np.zeros(len(S), bool)
        for poly in polys:
            inn |= pip(S, poly)
        for h in holes:
            inn &= ~pip(S, h)
        S = S[inn]
        if len(S):
            d = np.min([seg_dist(S, p) for p in list(polys) + list(holes)], 0)
            S = S[d > spacing * 0.35]
        verts += [tuple(p) for p in S]
    out = MG.delaunay_2d_cdt([Vector(v) for v in verts], edges, [], 0, 1e-7)
    V = np.array([tuple(v) for v in out[0]], float)
    orig = out[3]
    for i, o in enumerate(orig):
        if len(o) and o[0] < len(verts):
            V[i] = verts[o[0]]
    F = np.array([f for f in out[2] if len(f) == 3], np.int64)
    C = V[F].mean(1)
    keep = np.zeros(len(F), bool)
    for poly in polys:
        keep |= pip(C, poly)
    for h in holes:
        keep &= ~pip(C, h)
    F = F[keep]
    used = np.unique(F)
    remap = -np.ones(len(V), np.int64); remap[used] = np.arange(len(used))
    return V[used], remap[F]

def grid_points(lo, hi, step, jitter=0.0, rng=None):
    xs = np.arange(lo[0] + step / 2, hi[0], step); ys = np.arange(lo[1] + step / 2, hi[1], step)
    X, Y = np.meshgrid(xs, ys, indexing='ij')
    Q = np.stack([X.ravel(), Y.ravel()], -1)
    if jitter and rng is not None:
        Q = Q + rng.uniform(-jitter, jitter, Q.shape) * step
    return Q

def orient(V3, F, want):
    """Flip triangles whose normal points against want(centroid, normal) < 0."""
    a, b, c = V3[F[:, 0]], V3[F[:, 1]], V3[F[:, 2]]
    n = np.cross(b - a, c - a)
    flip = want((a + b + c) / 3, n) < 0
    F = F.copy(); F[flip] = F[flip][:, ::-1]
    return F

def weather(V, seed_, kind):
    A, B, C = H.hall_weather(V, seed_ % 100000, kind)
    return A, B, C

def mesh(name, V, F, uvl, coll, mat, attrs=None, adaptive=True):
    ob = U.mesh_from_faces(name, V, [list(f) for f in F], uv=uvl, attrs=attrs, coll_=coll, mat=mat)
    if adaptive:
        U.add_adaptive(ob)
    return ob

# ------------------------------------------------------------------ build
def build_room(lay, mats, coll, rng):
    room = Room(lay)
    rect = lay['rect']; rid = lay['room']
    for m in room.mouths:
        c = wpt(rect, m['wall'], m['t'], 1.0)
        m['bay'] = int(room.bay_of(np.array(c[0]), np.array(c[1])))
        along = lay['bays']['along']
        m['through'] = lay['bays']['n'] > 1 and ((along == 'z') == (m['wall'] in ('z0', 'z1')))
    obs, col = [], []
    info = dict(room=rid, placements=[], mouths=[], bridges=[], stair=None)
    T = wall_samples(room)
    obs += ceiling(room, T, mats, coll, rng, col)
    obs += walls(room, T, mats, coll, rng, col)
    for m in room.mouths:
        obs += mouth(room, m, mats, coll, rng, col, info)
    obs += corner_springers(room, mats, coll, rng)
    if len(room.bays) > 1:
        obs += transverse_arches(room, mats, coll, rng)
    obs += walkways(room, mats, coll, rng, col, info)
    obs += stair(room, mats, coll, rng, col, info)
    obs += bridges(room, mats, coll, rng, info)
    obs += bed(room, mats, coll, rng, col)
    obs += shafts(room, mats, coll, info)
    obs += lamps(room, mats, coll, rng, info)
    obs += dressing(room, mats, coll, rng)
    return obs, col, info, room

# ---- wall samples shared by walls and ceiling
def hole_top(room, w, t):
    """Top of the openings in wall w at t (-9 where none): mouth arch rings and the stair arch, offset into the ring."""
    y = np.full(np.shape(t), -9.0)
    for m in room.mouths:
        if m['wall'] != w:
            continue
        s = t - m['t']; rr = P['ring_crown'] - P['spring'] + P['hole']; hh = P['hw'] - 0.01 + P['hole']
        e = P['spring'] + rr * np.sqrt(np.clip(1 - (s / hh) ** 2, 0, 1))
        y = np.where(np.abs(s) < hh, np.maximum(e, P['spring']), y)       # (#292) beside the feet too: the reveal stays open
    st = room.lay['stair']
    if st['wall'] == w:
        s = t - st['t']; r = P['stair_w'] / 2 - 0.012 + P['hole']
        e = P['stair_spring'] + np.sqrt(np.clip(r * r - s * s, 0, None))
        y = np.where(np.abs(s) < r, np.maximum(e, P['stair_spring']), y)
    return y

def walk_covers(room, w, t):
    on = np.zeros(np.shape(t), bool)
    for r in room.lay['runs']:
        if r['wall'] == w:
            on |= (t > r['ta'] - 1e-6) & (t < r['tb'] + 1e-6)
    for m in room.mouths:
        if m['wall'] == w:
            a, b = walk_part(m)
            on |= (t > a - 1e-6) & (t < b + 1e-6)
    st = room.lay['stair']
    if st['wall'] == w:
        on |= np.abs(t - st['t']) < P['stair_w'] / 2 + 1e-6
    return on

def wall_breaks(room, w):
    b = []
    for m in room.mouths:
        if m['wall'] == w:
            b += [m['t'] - P['hw'], m['t'] + P['hw']] + list(walk_part(m))
            b += [m['t'] - P['hw'] + 0.01 - P['hole'], m['t'] + P['hw'] - 0.01 + P['hole']]
    st = room.lay['stair']
    if st['wall'] == w:
        b += [st['t'] - P['stair_w'] / 2, st['t'] + P['stair_w'] / 2]
        b += [st['t'] - P['stair_w'] / 2 + 0.012 - P['hole'], st['t'] + P['stair_w'] / 2 - 0.012 + P['hole']]
    for r in room.lay['runs']:
        if r['wall'] == w:
            b += [r['ta'], r['tb']]
    if len(room.bays) > 1:
        along = room.lay['bays']['along']
        if (along == 'z') == (w in ('x0', 'x1')):
            off = room.rect[1] if along == 'z' else room.rect[0]
            b += [e - off for e in room.lay['bays']['edges'][1:-1]]
    return b

def wall_samples(room):
    T = {}
    for w, _ in RING:
        p0, tv, n, L = wall_frame(room.rect, w)
        t = list(np.arange(0, L, P['wstep'])) + [L] + [x for x in wall_breaks(room, w) if 0 <= x <= L]
        t = np.unique(np.round(np.array(t), 5))
        # where an opening's ring rises through the ceiling: add the exact crossing
        tf = np.linspace(0, L, int(L / 0.002) + 1)
        g = hole_top(room, w, tf) - ceil_at(room, w, tf) - WALL_OVER
        cross = np.nonzero((np.sign(g[1:]) != np.sign(g[:-1])) & (hole_top(room, w, tf[1:]) > -8.9) & (hole_top(room, w, tf[:-1]) > -8.9))[0]
        extra = []
        for i in cross:
            a, b = tf[i], tf[i + 1]
            for _ in range(40):
                mid = (a + b) / 2
                gm = hole_top(room, w, np.array([mid]))[0] - ceil_at(room, w, np.array([mid]))[0] - WALL_OVER
                ga = hole_top(room, w, np.array([a]))[0] - ceil_at(room, w, np.array([a]))[0] - WALL_OVER
                a, b = (a, mid) if np.sign(gm) != np.sign(ga) else (mid, b)
            extra.append((a + b) / 2)
        t = np.unique(np.r_[t, extra])
        # merge near duplicates, keeping breaks and crossings
        keep = np.r_[True, np.diff(t) > 0.004]
        T[w] = t[keep]
        T[w + '_cross'] = np.array(extra)
    return T

def ceil_at(room, w, t):
    q = f32(wpt(room.rect, w, t))
    return room.ceil(q[..., 0], q[..., 1])[0]

# ---- ceiling
def ceiling(room, T, mats, coll, rng, col):
    rect = room.rect
    e = 0.12
    bound = f32(np.array([[rect[0] - e, rect[1] - e], [rect[2] + e, rect[1] - e], [rect[2] + e, rect[3] + e], [rect[0] - e, rect[3] + e]]))
    holes = []
    for (gx, gz) in room.lay['grates']:
        a = np.linspace(0, 2 * np.pi, 72, endpoint=False)
        holes.append(np.stack([gx + P['oculus'] * np.cos(a), gz + P['oculus'] * np.sin(a)], -1))
    lo, hi = np.array(rect[:2]) - 0.12, np.array(rect[2:]) + 0.12
    S = grid_points(lo, hi, P['grid'], 0.15, np.random.default_rng(seed(room.lay['room'], 3)))
    Fq = grid_points(lo, hi, P['fine'])
    h, dom, gap = room.ceil(Fq[:, 0], Fq[:, 1])
    Fq = Fq[gap < 0.04]
    # bay boundaries carry their crease on mesh edges
    extra = []
    for e in room.lay['bays']['edges'][1:-1]:
        if room.lay['bays']['along'] == 'z':
            xs = np.arange(rect[0] + 0.02, rect[2], 0.025); extra += [np.stack([xs, np.full(len(xs), e)], -1)]
        else:
            zs = np.arange(rect[1] + 0.02, rect[3], 0.025); extra += [np.stack([np.full(len(zs), e), zs], -1)]
    pts = np.concatenate([S, Fq] + extra)
    V2, F = cdt([bound], holes, pts, P['fine'])
    V2 = f32(V2)
    y, dom, gap = room.ceil(V2[:, 0], V2[:, 1])
    V = np.stack([V2[:, 0], y, V2[:, 1]], -1)
    F = orient(V, F, lambda c, n: -n[:, 1])
    # charts: dome ring courses in 20 gores; lunettes follow their barrel; one chart per face, by its centroid
    C = V[F].mean(1)
    _, fdom, _ = room.ceil(C[:, 0], C[:, 2])
    uv = np.zeros((F.size, 2))
    Lv = V[F.ravel()]; ld = np.repeat(fdom, 3)
    for i, b in enumerate(room.bays):
        m_ = ld == i
        if not m_.any():
            continue
        dx, dz = Lv[m_, 0] - b['c'][0], Lv[m_, 2] - b['c'][1]
        r = np.hypot(dx, dz); th = np.arctan2(dz, dx)
        fth = np.repeat(np.arctan2(C[:, 2] - b['c'][1], C[:, 0] - b['c'][0]), 3)[m_]
        ng = 20; g = np.floor((fth + np.pi) / (2 * np.pi / ng)); tc = -np.pi + (g + 0.5) * 2 * np.pi / ng
        dth = (th - tc + np.pi) % (2 * np.pi) - np.pi
        uv[m_, 0] = r * dth + g * 0.37
        uv[m_, 1] = b['R'] * np.arcsin(np.clip(r / b['R'], 0, 1))
    for k, m in enumerate(room.mouths):
        m_ = ld == 100 + k
        if not m_.any():
            continue
        s, a = room.mouth_local(m, Lv[m_, 0], Lv[m_, 2])
        uv[m_, 0] = -a
        uv[m_, 1] = room.ell_v(s)
    # relief fades to nothing along the groins and at the wall line, so the joints stay closed
    edge_d = np.minimum.reduce([V2[:, 0] - rect[0], rect[2] - V2[:, 0], V2[:, 1] - rect[1], rect[3] - V2[:, 1]])
    fade = U.smoothstep(0.0, 0.035, gap) * U.smoothstep(0.0, 0.03, edge_d)
    for e in room.lay['bays']['edges'][1:-1]:
        fade *= U.smoothstep(0.0, 0.05, np.abs((V2[:, 1] if room.lay['bays']['along'] == 'z' else V2[:, 0]) - e))
    for (gx, gz) in room.lay['grates']:
        fade *= U.smoothstep(P['oculus'], P['oculus'] + 0.08, np.hypot(V2[:, 0] - gx, V2[:, 1] - gz))
    A, B, Cc = weather(V, seed(room.lay['room'], 5), 'vault')
    B[:, 3] = fade; B[:, 2] = 0.5
    ob = mesh('%s_dome' % room.lay['room'], V, F, uv, coll, mats['brick_hallvault'], {'wxA': A, 'wxB': B, 'wxC': Cc})
    # collision: the same surface on a coarse grid (the dome is smooth; groins within a centimetre)
    Sg = grid_points(lo, hi, 0.15)
    V2c, Fc = cdt([bound[::4]], holes, np.concatenate([Sg, Fq[::6]]), 0.15)
    yc, _, _ = room.ceil(V2c[:, 0], V2c[:, 1])
    col.append(('dome', np.stack([V2c[:, 0], yc, V2c[:, 1]], -1), Fc))
    return [ob]

# ---- walls
def walls(room, T, mats, coll, rng, col):
    obs = []
    rect = room.rect
    for w, _ in RING:
        p0, tv, n, L = wall_frame(rect, w)
        t = T[w]
        top = ceil_at(room, w, t) + WALL_OVER
        breaks = sorted(set([0.0, L] + [round(b, 5) for b in wall_breaks(room, w) if 0 < b < L]))
        bottom = []  # (t, y) with steps at the breaks
        for a, b in zip(breaks[:-1], breaks[1:]):
            mid = np.array([(a + b) / 2])
            ts = t[(t >= a - 1e-6) & (t <= b + 1e-6)]
            ybot = WALK_BOT if walk_covers(room, w, mid)[0] else BED_BOT
            ht = hole_top(room, w, ts)
            inhole = hole_top(room, w, mid)[0] > -8.9
            lo_ = np.maximum(ybot, ht) if inhole else np.full(len(ts), ybot)
            bottom += list(zip(ts, lo_, np.interp(ts, t, top)))
        # the walls run 3 cm on behind the next wall at each corner, so no hairline opens in the corner
        if bottom and bottom[0][0] < 1e-6:
            bottom.insert(0, (-0.03,) + tuple(bottom[0][1:]))
        if bottom and bottom[-1][0] > L - 1e-6:
            bottom.append((L + 0.03,) + tuple(bottom[-1][1:]))
        t = np.r_[-0.03, t, L + 0.03]; top = np.r_[top[0], top, top[-1]]
        # split into pieces where the wall exists (bottom below top); a piece starts/ends at its cusp
        pieces, cur, prev = [], [], None
        for e in bottom:
            ex = e[1] < e[2] - 1e-4
            if ex:
                if not cur and prev is not None:
                    cur = [(prev[0], prev[2], prev[2])]
                cur.append(e)
            elif cur:
                cur.append((e[0], e[2], e[2])); pieces.append(cur); cur = []
            prev = e
        if cur:
            pieces.append(cur)
        k = 0
        for pc in pieces:
            if len(pc) < 2:
                continue
            bot = [(a, b) for a, b, c in pc]
            tops = []
            for a, b, c in pc[::-1]:
                if not tops or abs(tops[-1][0] - a) > 1e-7:
                    tops.append((a, c))
            poly = np.array(bot + tops, float)
            if len(clean_poly(poly)) < 3:
                continue
            lo, hi = poly.min(0), poly.max(0)
            # 5.5 cm points: mean edge under 0.07 m, so the bake subdivides once (C2's density), not twice
            S = grid_points(lo, hi, 0.055, 0.15, np.random.default_rng(seed(room.lay['room'], 50 + k)))
            V2, F = cdt([poly], (), S, 0.055)
            tt, yy = V2[:, 0], V2[:, 1]
            q = f32(wpt(rect, w, tt))
            V = np.stack([q[:, 0], yy, q[:, 1]], -1)
            F = orient(V, F, lambda c, nn: -(nn[:, 0] * n[0] + nn[:, 2] * n[1]))
            uv = np.stack([tt, yy], -1)[F.ravel()]
            topi = np.interp(tt, t, top)
            fade = U.smoothstep(0.0, 0.03, topi - yy) * U.smoothstep(0.0, 0.03, tt) * U.smoothstep(0.0, 0.03, L - tt)
            A, B, Cc = weather(V, seed(room.lay['room'], 60 + k), 'wall')
            B[:, 3] = fade
            obs.append(mesh('%s_wall_%s_%d' % (room.lay['room'], w, k), V, F, uv, coll, mats['brick_hallvault'], {'wxA': A, 'wxB': B, 'wxC': Cc}))
            col.append(('wall_%s_%d' % (w, k), V, F))
            k += 1
        # (#292) beside each opening the wall's hole reaches past the jamb line, so the arch rim's reveal stays open
        # down to its feet; below the springing the wall goes on behind the imposts and jambs
        spans = [(m['t'], P['hw'], P['hw'] - 0.01 + P['hole'], P['spring']) for m in room.mouths if m['wall'] == w]
        st = room.lay['stair']
        if st['wall'] == w:
            spans.append((st['t'], P['stair_w'] / 2, P['stair_w'] / 2 - 0.012 + P['hole'], P['stair_spring']))
        for tc, h0, h1, ys in spans:
            for sd in (-1, 1):
                a, b = sorted((tc + sd * h0, tc + sd * h1))
                a, b = max(a, -0.03), min(b, L + 0.03)
                if b - a < 1e-3:
                    continue
                poly = np.array([(a, BED_BOT), (b, BED_BOT), (b, ys), (a, ys)])
                S = grid_points(poly.min(0), poly.max(0), 0.055, 0.15, np.random.default_rng(seed(room.lay['room'], 50 + k)))
                V2, F = cdt([poly], (), S, 0.055)
                tt, yy = V2[:, 0], V2[:, 1]
                q = f32(wpt(rect, w, tt))
                V = np.stack([q[:, 0], yy, q[:, 1]], -1)
                F = orient(V, F, lambda c, nn: -(nn[:, 0] * n[0] + nn[:, 2] * n[1]))
                uv = np.stack([tt, yy], -1)[F.ravel()]
                A, B, Cc = weather(V, seed(room.lay['room'], 60 + k), 'wall')
                B[:, 3] = U.smoothstep(0.0, 0.03, ys - yy)
                obs.append(mesh('%s_wall_%s_%d' % (room.lay['room'], w, k), V, F, uv, coll, mats['brick_hallvault'], {'wxA': A, 'wxB': B, 'wxC': Cc}))
                col.append(('wall_%s_%d' % (w, k), V, F))
                k += 1
    return obs

# ---- mouths: header ring, bluestone imposts and jambs, the rui's first metres with its walkway
def ring_solid(name, origin, across, inward, cs, cy, nrm, width, depth, mat, coll, radius=0.011):
    """Closed bonded ring along an intrados polyline (cs, cy) with outward normals nrm: front, back, extrados, soffit."""
    pts = []
    for s, y, nv in zip(cs, cy, nrm):
        for r, d in ((0, 0), (width, 0), (width, -depth), (0, -depth)):
            q = np.array([s, y]) + nv * r
            pts.append(origin + across * q[0] + np.array([0, q[1], 0]) + inward * d)
    pts = np.asarray(pts); count = len(cs) - 1; faces = []; uv = []; along = 0
    for i in range(count):
        length = np.linalg.norm(pts[4 * (i + 1)] - pts[4 * i])
        for j in range(4):
            k = (j + 1) % 4; faces.append([4 * i + j, 4 * (i + 1) + j, 4 * (i + 1) + k, 4 * i + k])
            span = width if j % 2 == 0 else depth
            uv.extend([(along, 0), (along + length, 0), (along + length, span), (along, span)])
        along += length
    for i in (0, count):
        faces.append([4 * i + j for j in range(4)]); uv.extend([(0, 0), (width, 0), (width, depth), (0, depth)])
    return CH.solid(name, pts, faces, uv, mat, coll, radius)

def arch_rim(room, name, origin, across, into, cs, cy, mats, coll, rng, width=AR.WIDTH):
    """(#292) The kit's arch rim (kit/arch_rim.py) round an opening in a room wall: (cs, cy) is the clear intrados as the
    old header ring had it (the giant's and Jef's head room stay), the face AR.PROUD proud of the wall plane at origin,
    the 11 cm reveal step behind it and the clear reveal through the whole wall (back = the wall's thickness), where the
    rui or stair vault goes on. It is the opening's collision too (its name holds '_ring': build_junction keeps it exact)."""
    host = AR.PlaneWall(origin, across, into)
    sd_ = zlib.crc32(name.encode())                        # its own brick phase; the room's random stream is left alone
    def masks(Pm, M):
        A, B, Cc = weather(Pm, sd_, 'wall')                # the wall's soot, damp and grime
        M['wxA'][:] = A; M['wxB'][:, :3] = B[:, :3]; M['wxC'][:] = Cc
    return AR.rim(name, np.stack([cs, cy], -1), host, mats['brick_rib'], coll, width=width, back=P['wall'], masks=masks,
                  seed=sd_)

def ellipse_curve(hw, spring, rise, n=150):
    th = np.linspace(np.pi, 0, n + 1)
    cs, cy = hw * np.cos(th), spring + rise * np.sin(th)
    nv = np.stack([np.cos(th) / hw, np.sin(th) / rise], -1); nv /= np.linalg.norm(nv, axis=1, keepdims=True)
    return cs, cy, nv

def stone(name, C, mat, coll, rng, r=None, chips=(4, 9), wear=0.0):
    return U.block_object(name, C, mat, coll, r=r or rng.uniform(0.008, 0.012), res=0.05, seed=int(rng.integers(1e6)),
                          chips=int(rng.integers(*chips)), chip_size=(0.015, 0.05), wear_top=wear, corners=int(rng.integers(0, 2)), wobble=0.0008)

def frame3(room, w, t, d, y):
    """3D point on wall w: t along, d into the room, height y."""
    q = wpt(room.rect, w, t, d)
    return np.array([q[0], y, q[1]])

def box_on_wall(room, w, t0, t1, d0, d1, y0, y1):
    C = np.zeros((8, 3))
    for j in range(8):
        C[j] = frame3(room, w, t1 if j & 1 else t0, d1 if j & 4 else d0, y1 if j & 2 else y0)
    return C

def mouth(room, m, mats, coll, rng, col, info):
    obs = []
    rect = room.rect; w = m['wall']
    p0, tv, n, L = wall_frame(rect, w)
    o3 = frame3(room, w, m['t'], 0, 0)
    across = np.array([tv[0], 0, tv[1]]); r_in = np.array([-n[0], 0, -n[1]])
    cs, cy, nv = ellipse_curve(P['hw'] - 0.01, P['spring'], P['ring_crown'] - P['spring'])
    obs.append(arch_rim(room, '%s_mouth_ring_%s' % (room.lay['room'], m['route']), o3, across, -r_in, cs, cy, mats, coll, rng))
    # bluestone imposts under the ring, jamb stones below them (rounded arrises; the reveal side 1 cm proud)
    for sd in (-1, 1):
        ts = m['t'] + sd * P['hw']
        a, b = sorted((ts - sd * 0.01, ts + sd * 0.36))
        obs.append(stone('%s_impost_%s_%d' % (room.lay['room'], m['route'], sd), box_on_wall(room, w, a, b, -P['wall'] + 0.02, P['ring_proud'] + 0.01, P['spring'] - 0.26, P['spring']), mats['bluestone_quoin'], coll, rng, chips=(3, 6)))
        foot = SEC.ledge_y if walk_covers(room, w, np.array([ts + sd * 0.15]))[0] or (walk_part(m)[0] - 1e-6 <= ts - sd * 0.05 <= walk_part(m)[1] + 1e-6) else BED_BOT + 0.05
        y = foot; k = 0
        top_j = P['spring'] - 0.26
        while y < top_j - 0.01:
            hgt = 0.32 if top_j - y > 0.32 + 0.12 else top_j - y
            ln = 0.42 if k % 2 == 0 else 0.26
            a, b = sorted((ts - sd * 0.01, ts + sd * ln))
            dd = 0.38 if k % 2 == 0 else 0.24
            obs.append(stone('%s_jamb_%s_%d_%d' % (room.lay['room'], m['route'], sd, k), box_on_wall(room, w, a, b, -dd, 0.012, y, y + hgt - 0.002), mats['bluestone_quoin'], coll, rng, chips=(3, 7)))
            y += hgt; k += 1
    obs += stub(room, m, mats, coll, rng, col, info)
    return obs

def stub(room, m, mats, coll, rng, col, info):
    """The rui's first metres outside the wall: section shell, walkway, channel face, bed and a dark end card."""
    obs = []
    rect = room.rect; w = m['wall']; rid = room.lay['room']
    p0, tv, n, L = wall_frame(rect, w)
    length = P['wall'] + P['stub']
    sd = m['side']
    sec = Section('M', sd)
    sec.foot_y = lambda side: sec.bed - 0.15     # both feet to the bed: nothing open under the stub walkway
    s_p, y_p, v_p, vt = sec.profile(0.055)      # source edges under 0.07 m: one relief level in the bake, as C2
    aa = np.r_[-0.01, np.linspace(0, length, int(length / 0.06) + 1)]
    A_, Vv = np.meshgrid(aa, np.arange(len(s_p)), indexing='ij')
    # (#292) above the springing the vault starts behind the arch rim's reveal step, which it would otherwise cover
    a0 = AR.DEPTH + 0.005
    vault = (y_p[Vv] > P['spring'] + 1e-4)
    A_ = np.where(vault, a0 + (A_ - aa[0]) * (length - a0) / (length - aa[0]), A_)
    def pt(a, s, y):
        q = wpt(rect, w, m['t'] + s, -a)
        return np.stack([q[..., 0], y, q[..., 1]], -1)
    Pp = pt(A_, s_p[Vv], y_p[Vv])
    inside = pt(np.array(length / 2), np.array(0.0), np.array(-2.5))
    att = weather(Pp.reshape(-1, 3), seed(rid, 70), 'wall')
    att[1][:, 3] = U.smoothstep(0.0, 0.06, A_.ravel()) * U.smoothstep(0.0, 0.06, length - A_.ravel())
    ob = U.grid_mesh('%s_stub_%s' % (rid, m['route']), Pp, np.stack([-A_, v_p[Vv]], -1),
                     attrs={'wxA': att[0].reshape(*Pp.shape[:2], 4), 'wxB': att[1].reshape(*Pp.shape[:2], 4), 'wxC': att[2].reshape(*Pp.shape[:2], 4)},
                     flip=G.orient_check(Pp, inside), coll_=coll, mat=mats['brick_vault'])
    U.add_adaptive(ob); obs.append(ob)
    col.append(('stub_' + m['route'], Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    # dark card where the stretch continues
    Pv = pt(np.full(len(s_p), length - 0.03), s_p * 1.04, -2.9 + (y_p + 2.9) * 1.04)
    Pc = pt(np.array(length - 0.03), np.array(0.0), np.array(-2.9))
    nv_ = len(Pv)
    obs.append(U.mesh_from_faces('%s_stub_%s_void' % (rid, m['route']), np.r_[Pv, Pc[None]], [[i, i + 1, nv_] for i in range(nv_ - 1)] + [[nv_ - 1, 0, nv_]],
                                 coll_=coll, mat=mats['soot_black'], smooth=False))
    # walkway in the stub: setts and coping, the channel face below the coping
    wa, wb = walk_part(m)
    edge = (wa if sd > 0 else wb) - m['t']        # lateral of the water edge
    info['mouths'].append(dict(route=m['route'], wall=w, t=round(m['t'], 3), side=sd,
                               end=[round(float(v), 3) for v in wpt(rect, w, m['t'], -length)], dir=[float(n[0]), float(n[1])],
                               walkway_side=int(np.sign(np.dot(tv * sd, np.array([n[1], -n[0]])))), arch_crown=P['ring_crown']))
    m['edge'] = edge
    return obs

# ---- walkways: setts in rows along the path, bluestone coping, raised seam stones where directions meet
def sett_field(name, poly, frame, mats, coll, rng, wear_line=None):
    """Worn setts in a planar polygon (plan coords). frame(P2) -> (u along the rows, w across).
    Courses 0.11 m wide along u, setts 0.16-0.24 m long, joints 12 mm, crowns 9-14 mm, a dished wear line."""
    lo, hi = poly.min(0), poly.max(0)
    S = grid_points(lo, hi, 0.028)
    V2, F = cdt([poly], (), S, 0.028)            # sett shapes in the geometry; relief under 1 cm is the normal map's
    u, ww = frame(V2)
    cw = 0.11
    row = np.floor(ww / cw)
    rs = (zlib.crc32(name.encode()) % 997) * 0.013
    off = (row * 0.37 + rs) % 1.0
    lens = 0.16 + 0.08 * ((np.sin(row * 12.9898 + rs) * 43758.5453) % 1.0)
    uu = u / lens + off
    k = np.floor(uu)
    fu, fw = uu - k, ww / cw - row
    du = np.minimum(fu, 1 - fu) * lens; dw = np.minimum(fw, 1 - fw) * cw
    jd = np.minimum(du, dw)
    hsh = (np.sin(k * 78.233 + row * 12.9898 + rs * 7) * 43758.5453) % 1.0
    # gentle flanks (at most 1:1.7) keep the stone chart within metric tolerance; the normal map adds the grain
    crown = 0.005 + 0.004 * hsh
    tilt = (hsh - 0.5) * 0.003
    prof = U.smoothstep(0.0, 1.0, jd / 0.03)
    y = SEC.ledge_y - 0.006 + (crown + 0.006) * prof + tilt * (fu - 0.5)
    if wear_line is not None:
        y -= 0.004 * np.exp(-((ww - wear_line) / 0.12) ** 2)
    V = np.stack([V2[:, 0], y, V2[:, 1]], -1)
    F = orient(V, F, lambda c, nn: nn[:, 1])
    uv = np.stack([u, ww], -1)[F.ravel()]
    return mesh(name, V, F, uv, coll, mats['bluestone'], adaptive=False)

def coping_line(name, a, b, out, mats, coll, rng, ends=(True, True)):
    """Bluestone coping blocks from plan point a to b along the water edge; out = plan normal towards the water.
    The blocks are 0.4 m wide (0.04 over the water) and 0.25 m deep, 0.7 to 1.1 m long."""
    obs = []
    a, b, out = np.asarray(a, float), np.asarray(b, float), np.asarray(out, float)
    L = np.linalg.norm(b - a); d = (b - a) / L
    pos = 0.0; k = 0
    while pos < L - 0.02:
        bl = min(rng.uniform(0.7, 1.1), L - pos)
        if L - pos - bl < 0.3:
            bl = L - pos
        q0 = a + d * (pos + 0.003); q1 = a + d * (pos + bl - 0.003)
        C = np.zeros((8, 3))
        for j in range(8):
            q = (q1 if j & 1 else q0) + out * (0.04 if j & 4 else -(P['cope'] - 0.04))
            C[j] = [q[0], SEC.ledge_y if j & 2 else SEC.ledge_y - 0.25, q[1]]
        obs.append(U.block_object('%s_%02d' % (name, k), C, mats['bluestone'], coll, r=rng.uniform(0.008, 0.012), res=0.055,
                                  seed=int(rng.integers(1e6)), chips=int(rng.integers(6, 12)), chip_size=(0.02, 0.07), wear_top=0.012,
                                  corners=int(rng.integers(0, 3)), wobble=0.0009))
        pos += bl; k += 1
    return obs

def channel_face(name, pts, water_pt, mats, coll, room, col):
    """Brick face of a walkway from the bed to under its coping along a plan polyline; corners stay one surface,
    rounded over 12 mm, so no joint opens there after the relief bake."""
    pts = [np.asarray(q, float) for q in pts]
    us = [pts[0]]
    for i in range(1, len(pts)):
        a, b = pts[i - 1], pts[i]; L = np.linalg.norm(b - a); d = (b - a) / L
        ts = list(np.arange(0.06, L, 0.06))
        if i > 1:
            ts = [0.012] + [t for t in ts if t > 0.05]
        if i < len(pts) - 1:
            ts = [t for t in ts if t < L - 0.05] + [L - 0.012]
        us += [a + d * t for t in ts] + [b]
    Q = np.array(us)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Q, axis=0), axis=1))]
    yy = np.linspace(BED_BOT, SEC.ledge_y - 0.24, 16)
    Pp = np.stack([np.broadcast_to(Q[:, None, 0], (len(Q), 16)), np.broadcast_to(yy[None], (len(Q), 16)), np.broadcast_to(Q[:, None, 1], (len(Q), 16))], -1).copy()
    A_, Y_ = np.meshgrid(arc, yy, indexing='ij')
    att = weather(Pp.reshape(-1, 3), zlib.crc32(name.encode()), 'wall')
    att[1][:, 3] = (U.smoothstep(0.0, 0.03, np.minimum(A_, arc[-1] - A_)) * U.smoothstep(0.0, 0.03, SEC.ledge_y - 0.24 - Y_)).ravel()
    mid = len(Q) // 2
    o = U.grid_mesh(name, Pp, np.stack([A_, Y_], -1), attrs={k: v.reshape(*Pp.shape[:2], 4) for k, v in zip(('wxA', 'wxB', 'wxC'), att)},
                    flip=G.orient_check(Pp, np.array([water_pt[0], -4.6, water_pt[1]])), coll_=coll, mat=mats['brick_channel'])
    U.add_adaptive(o)
    col.append((name, Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    return [o]

def seam_stones(name, a, b, mats, coll, rng, width=0.12):
    """Dressed bluestone bond across a change of direction, its top 10 mm above the sett crowns."""
    obs = []
    a, b = np.asarray(a, float), np.asarray(b, float)
    L = np.linalg.norm(b - a); d = (b - a) / L; nrm = np.array([-d[1], d[0]])
    nst = max(1, int(round(L / 0.45)))
    for k in range(nst):
        q0 = a + d * (L * k / nst + 0.004); q1 = a + d * (L * (k + 1) / nst - 0.004)
        C = np.zeros((8, 3))
        for j in range(8):
            q = (q1 if j & 1 else q0) + nrm * (width / 2 if j & 4 else -width / 2)
            C[j] = [q[0], SEC.ledge_y + 0.019 if j & 2 else SEC.ledge_y - 0.12, q[1]]
        obs.append(U.block_object('%s_%d' % (name, k), C, mats['bluestone'], coll, r=0.009, res=0.045, seed=int(rng.integers(1e6)),
                                  chips=int(rng.integers(2, 5)), chip_size=(0.01, 0.03), wear_top=0.006, wobble=0.0006))
    return obs

def walkways(room, mats, coll, rng, col, info):
    obs = []
    rect = room.rect; rid = room.lay['room']; W = P['walk']; cin = P['cope'] - 0.04; ws = W - cin   # setts 0.44, coping 0.36 + 0.04 over
    runs = room.lay['runs']
    def has_run(w, t):
        return any(r['wall'] == w and r['ta'] - 1e-4 <= t <= r['tb'] + 1e-4 for r in runs)
    corner_of = {('z0', 'lo'): ('x0', 'lo'), ('z0', 'hi'): ('x1', 'lo'), ('z1', 'lo'): ('x0', 'hi'), ('z1', 'hi'): ('x1', 'hi'),
                 ('x0', 'lo'): ('z0', 'lo'), ('x0', 'hi'): ('z1', 'lo'), ('x1', 'lo'): ('z0', 'hi'), ('x1', 'hi'): ('z1', 'hi')}
    def joined_at(w, t):
        """A rui walkway that turns into the room run at this run end (its water edge is the run end)."""
        for m in room.mouths:
            if m['wall'] == w:
                wa, wb = walk_part(m)
                if abs((wa if m['side'] > 0 else wb) - t) < 1e-4:
                    return m
        return None
    for i, r in enumerate(runs):
        w = r['wall']; p0, tv, n, L = wall_frame(rect, w)
        zwall = w in ('z0', 'z1')
        ends = []
        for which, t in (('lo', r['ta']), ('hi', r['tb'])):
            at_corner = (t < 1e-4) if which == 'lo' else (t > L - 1e-4)
            if at_corner:
                ow, oe = corner_of[(w, which)]
                oL = wall_frame(rect, ow)[3]
                ends.append('mitre' if has_run(ow, 0.0 if oe == 'lo' else oL) else 'wall')
            else:
                ends.append('join' if joined_at(w, t) else 'water')
        r['ends'] = ends
        # setts: (t, d) polygon, mitred at corners, stopped behind the coping returns, cut by the rui junction mitre
        def tl(d, k):
            t = r['ta'] if k == 0 else r['tb']; e = ends[k]; sg = 1 if k == 0 else -1
            if e == 'mitre':
                return t + sg * d
            if e == 'water':
                return t + sg * cin
            return t
        poly = np.array([(tl(-0.01, 0), -0.01), (tl(-0.01, 1), -0.01), (tl(ws + 0.01, 1), ws + 0.01), (tl(ws + 0.01, 0), ws + 0.01)], float)
        for k, e in enumerate(ends):
            if e == 'join':
                m = joined_at(w, r['ta'] if k == 0 else r['tb']); wa, wb = walk_part(m)
                poly = clip_half(poly, (lambda q, wb=wb: q[:, 0] - (wb - q[:, 1])) if m['side'] > 0 else (lambda q, wa=wa: (wa + q[:, 1]) - q[:, 0]))
        plan = wpt(rect, w, poly[:, 0], poly[:, 1])
        frame = lambda V2, p0=p0, tv=tv, n=n: (((V2 - p0) @ tv), ((V2 - p0) @ (-n)))
        if len(plan) >= 3:
            obs.append(sett_field('%s_setts_%s_%d' % (rid, w, i), plan, frame, mats, coll, rng, wear_line=0.22))
        # coping along d = W: z-wall runs cover the corner squares, x-wall runs stop short of them
        c0 = r['ta'] + ((cin if zwall else W + 0.04) if ends[0] == 'mitre' else (-0.04 if ends[0] in ('water', 'join') else 0.0))
        c1 = r['tb'] - ((cin if zwall else W + 0.04) if ends[1] == 'mitre' else (-0.04 if ends[1] in ('water', 'join') else 0.0))
        obs += coping_line('%s_coping_%s_%d' % (rid, w, i), wpt(rect, w, c0, W), wpt(rect, w, c1, W), -n, mats, coll, rng)
        # the water edge as one face: returns at water ends, the joined rui walkway's edge, 3 cm into concave corners
        TD = []
        for k, e in enumerate(ends):
            t = r['ta'] if k == 0 else r['tb']; sg = 1 if k == 0 else -1
            if e == 'water':
                q = [(t, -0.03), (t, W)]
            elif e == 'join':
                q = [(t, -(P['wall'] + P['stub'])), (t, W)]
            elif e == 'mitre':
                q = [(t + sg * (W - 0.03), W)]
            else:
                q = [(t - sg * 0.03, W)]
            TD += q if k == 0 else q[::-1]
        TD = np.array(TD, float)
        wp_ = wpt(rect, w, (r['ta'] + r['tb']) / 2, W + 0.6)
        obs += channel_face('%s_walkface_%s_%d' % (rid, w, i), list(wpt(rect, w, TD[:, 0], TD[:, 1])), wp_, mats, coll, room, col)
        for k, e in enumerate(ends):
            t = r['ta'] if k == 0 else r['tb']; sg = -1 if k == 0 else 1
            if e == 'water':
                obs += coping_line('%s_copend_%s_%d_%d' % (rid, w, i, k), wpt(rect, w, t, 0.0), wpt(rect, w, t, ws), tv * sg, mats, coll, rng)
            if e == 'mitre' and zwall:
                obs += seam_stones('%s_seam_%s_%d_%d' % (rid, w, i, k), wpt(rect, w, t - sg * 0.02, 0.02), wpt(rect, w, t - sg * ws, ws), mats, coll, rng)
        col.append(('walk_%s_%d' % (w, i), *flat_quad(rect, w, r['ta'], r['tb'], 0, W)))
    # rui walkways in the stubs, turned into the room run through the mitre
    for m in room.mouths:
        w = m['wall']; p0, tv, n, L = wall_frame(rect, w)
        wa, wb = walk_part(m); length = P['wall'] + P['stub']
        sd = m['side']
        edge_t = wa if sd > 0 else wb; jamb_t = wb if sd > 0 else wa
        cope_in = edge_t + sd * (cin - 0.01)
        jamb_t = jamb_t + sd * 0.01
        if sd > 0:
            poly_td = np.array([(cope_in, -length), (jamb_t, -length), (jamb_t, 0.0), (cope_in, ws)])
        else:
            poly_td = np.array([(jamb_t, -length), (cope_in, -length), (cope_in, ws), (jamb_t, 0.0)])
        plan = wpt(rect, w, poly_td[:, 0], poly_td[:, 1])
        frame = lambda V2, p0=p0, n=n, tv=tv, jt=jamb_t: (((V2 - p0) @ (-n)), np.abs((V2 - p0) @ tv - jt))
        obs.append(sett_field('%s_setts_stub_%s' % (rid, m['route']), plan, frame, mats, coll, rng, wear_line=0.22))
        obs += seam_stones('%s_seam_stub_%s' % (rid, m['route']), wpt(rect, w, jamb_t - sd * 0.02, 0.02), wpt(rect, w, cope_in, ws), mats, coll, rng)
        obs += coping_line('%s_coping_stub_%s' % (rid, m['route']), wpt(rect, w, edge_t, -length), wpt(rect, w, edge_t, ws), -tv * sd, mats, coll, rng)
        col.append(('walk_stub_' + m['route'], *flat_quad(rect, w, min(edge_t, jamb_t), max(edge_t, jamb_t), -length, 0.0)))
    return obs

def clip_half(poly, f):
    """Keep the part of a convex polygon with f(points) >= 0."""
    out = []
    n = len(poly)
    fv = f(poly)
    for i in range(n):
        a, b = poly[i], poly[(i + 1) % n]; fa, fb = fv[i], fv[(i + 1) % n]
        if fa >= 0:
            out.append(a)
        if (fa >= 0) != (fb >= 0):
            t = fa / (fa - fb); out.append(a + (b - a) * t)
    return np.array(out)

def flat_quad(rect, w, t0, t1, d0, d1, y=None):
    y = SEC.ledge_y if y is None else y
    q = [wpt(rect, w, t0, d0), wpt(rect, w, t1, d0), wpt(rect, w, t1, d1), wpt(rect, w, t0, d1)]
    V = np.array([[p[0], y, p[1]] for p in q])
    F = np.array([[0, 1, 2], [0, 2, 3]])
    return V, F

# ---- stair: corner arch, setts landing, dark worn bluestone flight, lined vault, open stairwell under a hatch
def stair(room, mats, coll, rng, col, info):
    obs = []
    st = room.lay['stair']; rect = room.rect; rid = room.lay['room']
    w = st['wall']; p0, tv, n, L = wall_frame(rect, w)
    hw = P['stair_w'] / 2
    def pt(a, l, y):
        q = wpt(rect, w, st['t'] + np.asarray(l, float), -np.asarray(a, float))
        return np.stack([q[..., 0], np.asarray(y, float) + 0 * q[..., 0], q[..., 1]], -1)
    nr, rise, a0, slope, a_top, a_h = st['nr'], st['rise'], st['a0'], st['slope'], st['a_top'], st['a_hatch']
    def floor_y(a):
        a = np.asarray(a, float)
        k = np.clip(np.floor((a - a0) / P['going']) + 1, 0, nr - 1)
        return np.where(a < a0, SEC.ledge_y, SEC.ledge_y + k * rise)
    def crown(a):
        return np.maximum(P['stair_spring'] + hw, SEC.ledge_y + P['headroom'] + (np.asarray(a, float) - a0) * slope - 0.0)
    a_v = a_h  # end of the vault
    # arch ring in the room wall, bluestone imposts and jambs
    across = np.array([tv[0], 0, tv[1]]); r_in = np.array([-n[0], 0, -n[1]])
    cs, cy, nv = ellipse_curve(hw - 0.012, P['stair_spring'], hw - 0.012, 64)
    # (#292) the kit's arch rim, its face 0.2 m (it stands on the 0.3 m imposts)
    obs.append(arch_rim(room, '%s_stair_ring' % rid, pt(0, 0, 0), across, -r_in, cs, cy, mats, coll, rng, width=0.2))
    for sd in (-1, 1):
        ts = st['t'] + sd * hw
        a, b = sorted((ts - sd * 0.01, ts + sd * 0.3))
        obs.append(stone('%s_stair_impost_%d' % (rid, sd), box_on_wall(room, w, a, b, -P['wall'] + 0.02, P['ring_proud'] + 0.01, P['stair_spring'] - 0.22, P['stair_spring']), mats['bluestone_quoin'], coll, rng, chips=(3, 6)))
        y = SEC.ledge_y; k = 0
        top_j = P['stair_spring'] - 0.22
        while y < top_j - 0.01:
            hgt = 0.3 if top_j - y > 0.3 + 0.12 else top_j - y
            ln = 0.36 if k % 2 == 0 else 0.22
            a, b = sorted((ts - sd * 0.01, ts + sd * ln))
            obs.append(stone('%s_stair_jamb_%d_%d' % (rid, sd, k), box_on_wall(room, w, a, b, -(0.34 if k % 2 == 0 else 0.22), 0.012, y, y + hgt - 0.002), mats['bluestone_quoin'], coll, rng, chips=(3, 7)))
            y += hgt; k += 1
    # lining walls: level courses, from below the treads to the vault springing or the street
    for part, (pa, pb) in enumerate(((-0.01, a_v), (a_v, a_top + 0.3))):
        aa = np.r_[np.arange(pa, pb, 0.06), pb]
        spr = crown(aa) - hw if part == 0 else np.full(len(aa), P['street'])
        for sd in (-1, 1):
            yy = np.linspace(0, 1, max(4, int(np.max(spr - (floor_y(aa) - rise - 0.12)) / 0.06) + 1))
            A_, Q = np.meshgrid(aa, yy, indexing='ij')
            ybot = np.where(aa < a0 + 0.3, BED_BOT, floor_y(aa) - rise - 0.12)   # closed under the landing
            Y = ybot[:, None] + (spr - ybot)[:, None] * Q
            Pp = pt(A_, np.full(A_.shape, sd * hw), Y)
            att = weather(Pp.reshape(-1, 3), seed(rid, 80 + sd + 3 * part), 'wall')
            att[1][:, 3] = (U.smoothstep(0.0, 0.04, np.minimum(A_ - pa, pb - A_)) * U.smoothstep(0.0, 0.04, (1 - Q) * (spr - ybot)[:, None])).ravel()
            ob = U.grid_mesh('%s_stair_wall_%d_%d' % (rid, part, sd), Pp, np.stack([A_, Y], -1), attrs={k: v.reshape(*Pp.shape[:2], 4) for k, v in zip(('wxA', 'wxB', 'wxC'), att)},
                             flip=G.orient_check(Pp, pt(1.0, 0.0, -3.0) if part == 0 else pt(a_v + 1.0, 0.0, -1.0)), coll_=coll, mat=mats['brick_hallwall'])
            U.add_adaptive(ob); obs.append(ob)
            col.append(('stair_wall_%d_%d' % (part, sd), Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    # vault: level over the landing, inclined over the flight, ending under the hatch's low end
    av = np.r_[np.arange(AR.DEPTH + 0.005, a_v, 0.05), a_v]   # (#292) from behind the arch rim's reveal step
    th = np.linspace(np.pi, 0, 41)
    A_, TH = np.meshgrid(av, th, indexing='ij')
    Y = (crown(A_) - hw) + hw * np.sin(TH)
    Pp = pt(A_, hw * np.cos(TH), Y)
    att = weather(Pp.reshape(-1, 3), seed(rid, 85), 'vault')
    att[1][:, 3] = (U.smoothstep(0.0, 0.04, np.minimum(A_ - av[0], a_v - A_)) * U.smoothstep(0.0, 0.08, np.minimum(TH, np.pi - TH))).ravel()
    ob = U.grid_mesh('%s_stair_vault' % rid, Pp, np.stack([A_, TH * hw], -1), attrs={k: v.reshape(*Pp.shape[:2], 4) for k, v in zip(('wxA', 'wxB', 'wxC'), att)},
                     flip=G.orient_check(Pp, pt(1.0, 0.0, -3.0)), coll_=coll, mat=mats['brick_hallvault'])
    U.add_adaptive(ob); obs.append(ob)
    col.append(('stair_vault', Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    # the vault's end: a rowlock ring and the brick face above it, up to the street
    cs2, cy2, nv2 = ellipse_curve(hw - 0.012, 0.0, hw - 0.012, 48)
    yb = crown(a_v) - hw
    obs.append(ring_solid('%s_stair_end_ring' % rid, pt(a_v, 0, 0.0), across, -r_in, cs2, cy2 + yb, nv2, 0.115, 0.23, mats['brick_rib_side'], coll, 0.009))
    ll = np.linspace(-hw - 0.03, hw + 0.03, 35)
    yv = yb + np.sqrt(np.clip(hw * hw - ll * ll, 0, None)) + 0.05
    Yq = np.linspace(0, 1, 12)
    Lg, Qg = np.meshgrid(ll, Yq, indexing='ij')
    Y = yv[:, None] + (P['street'] - yv[:, None]) * Qg
    Pp = pt(np.full(Lg.shape, a_v - 0.002), Lg, Y)
    ob = U.grid_mesh('%s_stair_endwall' % rid, Pp, np.stack([Lg, Y], -1), flip=G.orient_check(Pp, pt(a_v + 1.0, 0.0, -0.5)), coll_=coll, mat=mats['brick_hallwall'])
    U.add_adaptive(ob); obs.append(ob)
    col.append(('stair_endwall', Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    # under the street beyond the last tread: a brick end face closes the stair's top end
    Lg2, Qg2 = np.meshgrid(np.linspace(-hw - 0.03, hw + 0.03, 8), np.linspace(0, 1, 4), indexing='ij')
    Pe = pt(np.full(Lg2.shape, a_top + 0.3), Lg2, -rise - 0.12 + (rise + 0.12) * Qg2)
    obs.append(U.grid_mesh('%s_stair_topend' % rid, Pe, np.stack([Lg2, Pe[..., 1]], -1), flip=G.orient_check(Pe, pt(a_top, 0.0, -0.1)), coll_=coll, mat=mats['soot_black']))
    # landing: setts from the room walkway through the arch to the flight foot, a seam stone at the wall line
    poly_al = np.array([(-0.01, -hw - 0.01), (a0 + 0.02, -hw - 0.01), (a0 + 0.02, hw + 0.01), (-0.01, hw + 0.01)])
    plan = wpt(rect, w, st['t'] + poly_al[:, 1], -poly_al[:, 0])
    frame = lambda V2: (((V2 - p0) @ n), (V2 - p0) @ tv - st['t'] + hw)
    obs.append(sett_field('%s_setts_landing' % rid, plan, frame, mats, coll, rng, wear_line=hw))
    obs += seam_stones('%s_seam_landing' % rid, wpt(rect, w, st['t'] - hw, 0.0), wpt(rect, w, st['t'] + hw, 0.0), mats, coll, rng)
    col.append(('landing', *flat_quad(rect, w, st['t'] - hw, st['t'] + hw, -a0, 0.0)))
    # the bed under the landing closes its hollow (the room's silt ends at the wall)
    Ab, Lb = np.meshgrid(np.linspace(-0.02, a0 + 0.32, 8), np.linspace(-hw - 0.02, hw + 0.02, 6), indexing='ij')
    Pb = pt(Ab, Lb, np.full(Ab.shape, SEC.bed))
    obs.append(U.grid_mesh('%s_stair_bed' % rid, Pb, np.stack([Ab, Lb], -1), flip=G.orient_check(Pb, Pb[2, 2] + np.array([0, 1.0, 0])), coll_=coll, mat=mats['soot_black']))
    obs.append(skirt('%s_stair_bed_skirt' % rid, Pb, mats, coll))
    # and a cross wall from the bed to the first steps closes the hollow under the flight
    Lc, Qc = np.meshgrid(np.linspace(-hw - 0.03, hw + 0.03, 8), np.linspace(0, 1, 10), indexing='ij')
    Pc = pt(np.full(Lc.shape, a0 + 0.3), Lc, BED_BOT + (SEC.ledge_y + rise - 0.15 - BED_BOT) * Qc)
    obs.append(U.grid_mesh('%s_stair_underwall' % rid, Pc, np.stack([Lc, Pc[..., 1]], -1), flip=G.orient_check(Pc, pt(0.3, 0.0, -4.5)), coll_=coll, mat=mats['soot_black']))
    # flight: one dark worn bluestone block a step, nosing worn round, the middle dished
    for k in range(1, nr):
        y1 = SEC.ledge_y + k * rise
        aa0 = a0 + (k - 1) * P['going']; aa1 = aa0 + P['going'] + 0.04 if k < nr - 1 else a_top + 0.32
        C = np.zeros((8, 3))
        for j in range(8):
            C[j] = pt(aa1 if j & 1 else aa0, (hw + 0.01) if j & 4 else -(hw + 0.01), y1 if j & 2 else y1 - rise - 0.1)   # into the lining: no slot at the sides
        obs.append(U.block_object('%s_step_%02d' % (rid, k), C, mats['bluestone_step'], coll, r=rng.uniform(0.016, 0.026), res=0.06, seed=seed(rid, 900 + k),
                                  chips=int(rng.integers(4, 8)), chip_size=(0.015, 0.05), wear_top=0.016 if k < nr - 4 else 0.009, corners=1, wobble=0.0015))
        col.append(('step_%d' % k, *box_faces(C)))
    # a wall handrail on brackets, 0.9 m over the nosings
    rs = 1 if st['end'] == 'lo' else -1
    lr = -rs * (hw - 0.07)
    rail = [pt(a0 - 0.6, lr, SEC.ledge_y + 0.9)] + [pt(a, lr, SEC.ledge_y + (a - a0) * slope + 0.9 + rise) for a in np.linspace(a0, a_top - 0.2, 8)] + [pt(a_top + 0.1, lr, P['street'] - 0.08)]
    obs.append(U.tube('%s_stair_rail' % rid, rail, 0.02, n=10, coll_=coll, mat=mats['iron'], flat=0.85))
    for a in np.linspace(a0 - 0.4, a_top - 0.4, 5):
        y = SEC.ledge_y + max(a - a0, 0) * slope + 0.9 + (rise if a > a0 else 0)
        obs.append(U.tube('%s_rail_bracket' % rid, [pt(a, -rs * hw - rs * 0.02, y - 0.06), pt(a, lr - rs * 0.0, y - 0.06), pt(a, lr, y - 0.02)], 0.011, n=8, coll_=coll, mat=mats['iron']))
    bottom = pt(0.3, 0.0, SEC.ledge_y); top = pt(a_top + 0.3, 0.0, P['street'])
    h0 = pt(a_h, -hw, 0.0); h1 = pt(a_top + 0.02, hw, 0.0)
    hatch = [min(h0[0], h1[0]), max(h0[0], h1[0]), min(h0[2], h1[2]), max(h0[2], h1[2])]
    info['stair'] = dict(bottom=[float(v) for v in bottom], top=[float(v) for v in top], hatch=[round(float(v), 3) for v in hatch],
                         wall=w, t=st['t'], risers=nr, rise=round(rise, 4), going=P['going'], vault_end=round(float(a_v), 3))
    return obs

def box_faces(C):
    F = np.array(U.BOX_FACES)
    tris = []
    for f in F:
        tris += [[f[0], f[1], f[2]], [f[0], f[2], f[3]]]
    return C, np.array(tris)

# ---- footbridges (cast iron) where the walkway has to cross a rui channel
def bridges(room, mats, coll, rng, info):
    obs = []
    rect = room.rect; rid = room.lay['room']
    for m in room.lay['bridges']:
        w = m['wall']; p0, tv, n, L = wall_frame(rect, w)
        a, b = channel_part(m)
        t0, t1 = a - 0.25, b + 0.25          # bearings on the coping returns
        d0, d1 = 0.06, P['walk'] + 0.08              # rails outside Jef's 0.64 m body on the 0.47 m line
        y = SEC.ledge_y + 0.025                       # the deck lies on the coping returns
        def C3(ta, tb, da, db, ya, yb):
            return box_on_wall(room, w, ta, tb, da, db, ya, yb)
        for d in (d0, d1):
            obs.append(U.block_object('%s_bridge_girder' % rid, C3(t0, t1, d - 0.012, d + 0.012, y - 0.26, y - 0.025), mats['iron'], coll, r=0.003, res=0.05, chips=0))
            obs.append(U.block_object('%s_bridge_flange' % rid, C3(t0, t1, d - 0.05, d + 0.05, y - 0.045, y - 0.025), mats['iron'], coll, r=0.003, res=0.05, chips=0))
        obs.append(U.block_object('%s_bridge_deck' % rid, C3(t0 + 0.05, t1 - 0.05, d0 - 0.04, d1 + 0.04, y - 0.025, y - 0.003), mats['iron'], coll, r=0.003, res=0.05, chips=0))
        for tt in np.linspace(t0 + 0.12, t1 - 0.12, 6):
            obs.append(U.block_object('%s_bridge_tie' % rid, C3(tt - 0.03, tt + 0.03, d0, d1, y - 0.2, y - 0.05), mats['iron'], coll, r=0.002, res=0.05, chips=0))
        # rails both sides: posts and two flat rails (the R2 rail's parts)
        for d in (d0, d1):
            posts = np.linspace(a + 0.05, b - 0.05, 4)          # rails over the channel only: the walkway ends stay free
            for tt in posts:
                obs.append(U.tube('%s_bridge_post' % rid, [frame3(room, w, tt, d, y - 0.03), frame3(room, w, tt, d, y + 1.0)], 0.016, n=8, coll_=coll, mat=mats['iron']))
            for hy in (0.55, 1.0):
                obs.append(U.tube('%s_bridge_rail' % rid, [frame3(room, w, a + 0.05, d, y + hy), frame3(room, w, b - 0.05, d, y + hy)], 0.016, n=8, coll_=coll, mat=mats['iron'], flat=0.6))
        info['bridges'].append(dict(route=m['route'], wall=w, t=[round(t0, 3), round(t1, 3)], note='cast-iron footbridge over the rui channel; it closes this mouth to Antigoon'))
    return obs

# ---- bed: silt over the room floor and the stub channels, thin along the mouths' centre lines
def skirt(name, Pp, mats, coll):
    """Vertical silt strips from a grid's border down below the bed."""
    rim = np.concatenate([Pp[0, :], Pp[1:, -1], Pp[-1, ::-1][1:], Pp[::-1, 0][1:]])
    G2 = np.stack([rim, rim * np.array([1, 0, 1]) + np.array([0, BED_BOT - 0.1, 0])], 1)
    return U.grid_mesh(name, G2, np.stack([np.r_[0, np.cumsum(np.linalg.norm(np.diff(rim, axis=0), axis=1))][:, None].repeat(2, 1), G2[..., 1]], -1),
                       coll_=coll, mat=mats['soot_black'], smooth=False)      # hidden closer: no relief bake

def bed(room, mats, coll, rng, col):
    rect = room.rect; rid = room.lay['room']
    x = np.arange(rect[0] - 0.05, rect[2] + 0.051, 0.1); z = np.arange(rect[1] - 0.05, rect[3] + 0.051, 0.1)
    X, Z = np.meshgrid(x, z, indexing='ij')
    edge = np.minimum.reduce([X - rect[0], rect[2] - X, Z - rect[1], rect[3] - Z])
    n1 = U.fbm3(np.stack([X, np.zeros_like(X), Z], -1).reshape(-1, 3), seed(rid, 9) % 1000, 2.0).reshape(X.shape)
    y = SEC.bed + 0.01 + 0.10 * U.smoothstep(1.4, 0.0, edge) * (0.5 + n1)
    for m in room.mouths:
        s, a = room.mouth_local(m, X, Z)
        y = np.where(np.abs(s + m['side'] * 0.4) < 0.9, np.minimum(y, SEC.bed + 0.005), y)
        # the channel's silt runs on into the room without a step at the wall line
        stub_y = SEC.bed + 0.005 + 0.06 * U.smoothstep(0.9, 1.4, np.abs(s + m['side'] * 0.4))
        k = U.smoothstep(0.9, 0.3, a) * (np.abs(s) < P['hw'] + 0.1)
        y = y * (1 - k) + np.minimum(y, stub_y) * k
    Pp = np.stack([X, y, Z], -1)
    ob = U.grid_mesh('%s_silt' % rid, Pp, np.stack([X, Z], -1), flip=G.orient_check(Pp, Pp[3, 3] + np.array([0, 1.0, 0])), coll_=coll, mat=mats['silt'])
    U.add_adaptive(ob)
    col.append(('silt', Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    obs = [ob, skirt('%s_silt_skirt' % rid, Pp, mats, coll)]
    for m in room.mouths:
        w = m['wall']; length = P['wall'] + P['stub']
        lo_t, hi_t = channel_part(m)
        # the whole stub floor, under its walkway too (closes the hollow below the setts)
        aa = np.linspace(-length - 0.02, 0.06, int(length / 0.1) + 2); tt = np.linspace(m['t'] - P['hw'] - 0.05, m['t'] + P['hw'] + 0.05, 38)
        A_, T_ = np.meshgrid(aa, tt, indexing='ij')
        q = wpt(rect, w, T_, A_)
        s = T_ - m['t']
        yy = SEC.bed + 0.005 + 0.06 * U.smoothstep(0.9, 1.4, np.abs(s + m['side'] * 0.4))
        Pp = np.stack([q[..., 0], yy, q[..., 1]], -1)
        o = U.grid_mesh('%s_silt_stub_%s' % (rid, m['route']), Pp, np.stack([q[..., 0], q[..., 1]], -1), flip=G.orient_check(Pp, Pp[2, 2] + np.array([0, 1.0, 0])), coll_=coll, mat=mats['silt'])
        U.add_adaptive(o); obs.append(o); obs.append(skirt('%s_silt_stub_skirt_%s' % (rid, m['route']), Pp, mats, coll))
        col.append(('silt_stub_' + m['route'], Pp.reshape(-1, 3), U.grid_faces(*Pp.shape[:2])))
    # the water (Blender renders only; the game draws its own sheet from the markers)
    V = np.array([[rect[0], SEC.water, rect[1]], [rect[2], SEC.water, rect[1]], [rect[2], SEC.water, rect[3]], [rect[0], SEC.water, rect[3]]])
    obs.append(U.mesh_from_faces('%s_water' % rid, V, [[0, 1, 2, 3]] if True else [], coll_=coll, mat=mats['water'], smooth=False))
    return obs

# ---- the crown grate's shaft (D1): closed brick shell with a flared lower rim
def shafts(room, mats, coll, info):
    """D1 crown shafts: the closed brick shell of rlib/chosen.light_shaft, its flared rim lowered with the vault where
    the shaft stands off the crown."""
    obs = []
    profile = [(.30, -.025), (.30, -.64), (.32, -.79), (.36, -.91), (.43, -1.01), (.52, -1.055),
               (.58, -1.05), (.60, -1.02), (.60, -.94), (.51, -.86), (.48, -.74), (.48, -.025)]
    for i, (gx, gz) in enumerate(room.lay['grates']):
        dy = float(room.ceil(np.array([gx]), np.array([gz]))[0][0]) - P['apex_y']
        prof = [(r, y + dy * U.smoothstep(-0.5, -0.94, y)) for r, y in profile]
        n = 128; pts = []
        for radius, y in prof:
            for k in range(n):
                a = k * 2 * np.pi / n; pts.append([gx + radius * np.cos(a), y, gz + radius * np.sin(a)])
        faces = []; uv = []; down = 0
        for j, (radius, y) in enumerate(prof):
            k2 = (j + 1) % len(prof); r1, y1 = prof[k2]; step = math.hypot(r1 - radius, y1 - y)
            for k in range(n):
                a = k * 2 * np.pi / n; b = (k + 1) * 2 * np.pi / n
                faces.append([j * n + k, j * n + (k + 1) % n, k2 * n + (k + 1) % n, k2 * n + k])
                uv.extend([(a * radius, down), (b * radius, down), (b * r1, down + step), (a * r1, down + step)])
            down += step
        obs.append(CH.solid('%s_crown_shaft_%d' % (room.lay['room'], i), pts, faces, uv, mats['brick_hallvault'], coll, .007))
        info['placements'].append(dict(piece='round_grate_d1', pos=[gx, 0.005, gz], rim=round(-0.92 + dy, 3)))
    return obs

def lamps(room, mats, coll, rng, info):
    """Two safety lamps on wall brackets: one beside the stair arch, one across the room, both over a walkway."""
    obs = []
    rect = room.rect; st = room.lay['stair']
    spots = []
    w = st['wall']; L = wall_frame(rect, w)[3]
    side = 1 if st['end'] == 'lo' else -1
    spots.append((w, st['t'] + side * (P['stair_w'] / 2 + 0.55)))
    for r in sorted(room.lay['runs'], key=lambda r: -(r['tb'] - r['ta'])):
        if r['wall'] != w and r['tb'] - r['ta'] > 1.2:
            spots.append((r['wall'], (r['ta'] + r['tb']) / 2)); break
    for k, (w, t) in enumerate(spots):
        p0, tv, n, L = wall_frame(rect, w)
        yw = -2.0                     # the lantern hangs above head height over the walkway
        wall_pt = frame3(room, w, t, 0.0, yw)
        parts, hook = PR.lamp_bracket('%s_lamp_bracket_%d' % (room.lay['room'], k), wall_pt, np.array([-n[0], 0, -n[1]]), 0.24, mats['iron'], coll)
        lo, ll = PR.safety_lamp('%s_lamp_%d' % (room.lay['room'], k), mats, coll, light_power=150.0)
        lo.location = U.gv(*hook)
        obs += parts + [lo]
        info['placements'].append(dict(piece='lamp_bracket_safety_lamp', wall=w, t=round(t, 3), pos=[round(float(v), 3) for v in hook]))
    return obs

def corner_springers(room, mats, coll, rng):
    """Bluestone springing blocks where the vault rises from the corners (and the bay corners on the long walls)."""
    obs = []
    rect = room.rect; rid = room.lay['room']
    corners = [(rect[0], rect[1], 1, 1), (rect[2], rect[1], -1, 1), (rect[2], rect[3], -1, -1), (rect[0], rect[3], 1, -1)]
    for k, (x, z, sx, sz) in enumerate(corners):
        y1 = P['corner_y']; y0 = y1 - 0.26
        C = U.box_corners(min(x, x + sx * 0.15), max(x, x + sx * 0.15), y0, y1, min(z, z + sz * 0.15), max(z, z + sz * 0.15))   # clear of a walker's head on the corner
        C[:, 0] = np.where(np.isclose(C[:, 0], x), x - sx * 0.02, C[:, 0]); C[:, 2] = np.where(np.isclose(C[:, 2], z), z - sz * 0.02, C[:, 2])
        obs.append(stone('%s_springer_%d' % (rid, k), C, mats['bluestone_quoin'], coll, rng, chips=(3, 6)))
    return obs

def transverse_arches(room, mats, coll, rng):
    """Header arch on the boundary between two bays, its soffit just under the bays' shared wall arch."""
    obs = []
    rect = room.rect; rid = room.lay['room']; along = room.lay['bays']['along']
    for i, e in enumerate(room.lay['bays']['edges'][1:-1]):
        if along == 'z':
            w0, l0, l1 = 'z0', rect[0], rect[2]
            ll = np.linspace(l0 + 0.002, l1 - 0.002, 121)
            yy = room.ceil(ll, np.full(len(ll), e))[0]
            origin = np.array([0.0, 0, e]); across = np.array([1.0, 0, 0]); inward = np.array([0, 0, 1.0])
        else:
            ll = np.linspace(rect[1] + 0.002, rect[3] - 0.002, 121)
            yy = room.ceil(np.full(len(ll), e), ll)[0]
            origin = np.array([e, 0, 0.0]); across = np.array([0, 0, 1.0]); inward = np.array([1.0, 0, 0])
        drop = 0.1 * U.smoothstep(P['corner_y'], P['corner_y'] + 0.4, yy)
        cy = yy - drop
        g = np.gradient(cy, ll); nv = np.stack([-g, np.ones_like(g)], -1); nv /= np.linalg.norm(nv, axis=1, keepdims=True)
        # the arch stops where a through barrel passes (the barrel stays clear for the giant)
        keep = yy < -1.12
        runs_, cur = [], []
        for k_, kp in enumerate(keep):
            if kp:
                cur.append(k_)
            elif cur:
                runs_.append(cur); cur = []
        if cur:
            runs_.append(cur)
        for j_, idx in enumerate(r_ for r_ in runs_ if len(r_) > 3):
            obs.append(ring_solid('%s_transverse_%d_%d' % (rid, i, j_), origin + inward * 0.18, across, inward, ll[idx], cy[idx], nv[idx], 0.3, 0.36, mats['brick_rib_side'], coll))
        for x_ in (ll[0], ll[-1]):
            sgn = 1 if x_ < (ll[0] + ll[-1]) / 2 else -1
            C = np.zeros((8, 3))
            for j in range(8):
                l = x_ - sgn * 0.02 + (sgn * 0.08 if j & 1 else 0)          # a pad stone 6 cm proud: head room on the walkway
                C[j] = origin + across * l + inward * (0.24 if j & 4 else -0.24) + np.array([0, P['corner_y'] if j & 2 else P['corner_y'] - 0.3, 0])
            obs.append(stone('%s_bearing_%d_%d' % (rid, i, sgn), C, mats['bluestone_quoin'], coll, rng, chips=(3, 6)))
    return obs

def dressing(room, mats, coll, rng):
    """A calcite curtain where the wall meets the water, floating planks and straw."""
    obs = []
    rect = room.rect; rid = room.lay['room']
    # the longest stretch of wall without a walkway (water to the wall) gets a seep and its curtain
    best = None
    for w, _ in RING:
        p0, tv, n, L = wall_frame(rect, w)
        tt = np.linspace(0.3, L - 0.3, 200)
        free = ~walk_covers(room, w, tt) & (hole_top(room, w, tt) < -8.9)
        if free.any():
            idx = np.nonzero(free)[0]
            t_mid = tt[idx[len(idx) // 2]]
            if best is None or free.sum() > best[2]:
                best = (w, t_mid, free.sum())
    if best:
        w, t, _ = best
        p0, tv, n, L = wall_frame(rect, w)
        y_top = ceil_at(room, w, np.array([t]))[0] - 0.12
        def host(a_m, d_m, w=w, t=t, y_top=y_top):
            q = wpt(rect, w, t + a_m, 0.0)
            return np.array([q[0], y_top - d_m, q[1]]), np.array([-n[0], 0, -n[1]])
        W0 = 0.38
        obs.append(WX.wax_curtain('%s_calcite' % rid, host, W0, (y_top - SEC.water) * 0.4, mats, coll, rng, T=0.016, taper=0.7, relief=0.5, Lend=y_top - SEC.water - 0.01))
    for k in range(5):
        x = rng.uniform(rect[0] + 1.2, rect[2] - 1.2); z = rng.uniform(rect[1] + 1.2, rect[3] - 1.2)
        o = PR.plank('%s_plank_%d' % (rid, k), rng.uniform(0.3, 0.9), rng.uniform(0.06, 0.14), 0.025, mats['wood_wet'], coll, seed=int(rng.integers(1e6)))
        o.location = U.gv(x, SEC.water - 0.01, z); o.rotation_euler = (0, 0, rng.uniform(0, 6.28)); obs.append(o)
    return obs

# ------------------------------------------------------------------ export helpers
def markers(room, sources, info):
    """Gameplay anchors in the stretch marker schema (RuienImport.Markers)."""
    out = {k: [] for k in ('lamps', 'flames', 'daylight_openings', 'beams', 'mist', 'water', 'ladders', 'stairs')}
    for o in sources:
        fl = [i for i, slot in enumerate(o.material_slots) if slot.material and slot.material.name.startswith('Lamp_flame')]
        pts = [o.matrix_world @ o.data.vertices[v].co for face in o.data.polygons if face.material_index in fl for v in face.vertices]
        if not pts:
            continue
        c = sum(pts, Vector()) / len(pts)
        pos = [float(c.x), float(c.z), float(-c.y)]
        out['flames'].append(dict(name=o.name, pos=pos, color=[1.0, 0.74, 0.52], glow_radius_m=0.12))
        out['lamps'].append(dict(name=o.name, pos=pos, color=[1.0, 0.74, 0.52], power_w=150.0, range_m=11.0, kind='point'))
    for i, (gx, gz) in enumerate(room.lay['grates']):
        yv = float(room.ceil(np.array([gx]), np.array([gz]))[0][0])
        out['daylight_openings'].append(dict(name='crown_%d' % i, kind='round_shaft', centre=[gx, -0.005, gz], radius_m=0.3,
                                             vault_opening=[gx, yv - 0.05, gz]))
    s = info['stair']
    out['daylight_openings'].append(dict(name='stair_hatch', kind='hatch', centre=[(s['hatch'][0] + s['hatch'][1]) / 2, 0.0, (s['hatch'][2] + s['hatch'][3]) / 2],
                                         size_m=[s['hatch'][1] - s['hatch'][0], s['hatch'][3] - s['hatch'][2]]))
    out['stairs'].append(dict(name='%s_stair' % room.lay['room'], bottom=s['bottom'], top=s['top'], hatch=s['hatch']))
    rect = room.rect
    out['water'].append(dict(name=room.lay['room'], height=SEC.water, outline=[[rect[0], rect[1]], [rect[2], rect[1]], [rect[2], rect[3]], [rect[0], rect[3]]]))
    for m in room.mouths:
        lo_t, hi_t = channel_part(m); length = P['wall'] + P['stub']
        tm = (lo_t + hi_t) / 2
        a = wpt(rect, m['wall'], tm, 0.3); b = wpt(rect, m['wall'], tm, -length)
        out['water'].append(dict(name='%s_%s' % (room.lay['room'], m['route']), height=SEC.water,
                                 centre_line=[[float(a[0]), float(a[1])], [float(b[0]), float(b[1])]], width=hi_t - lo_t))
    out['mist'].append(dict(name='rot_mist_room', min=[rect[0], SEC.water, rect[1]], max=[rect[2], SEC.water + 0.6, rect[3]], density_peak=0.055))
    return out

def key_of(room, C):
    """Export keys: the room, each mouth's stub, the stair passage."""
    rect = room.rect; keys = np.full(len(C), 'room', dtype=object)
    st = room.lay['stair']; p0, tv, n, L = wall_frame(rect, st['wall'])
    q = C[:, [0, 2]] - p0
    a = q @ n; l = q @ tv - st['t']
    keys[(a > 0.05) & (np.abs(l) < 1.2)] = 'stair'
    for m in room.mouths:
        p0, tv, n, L = wall_frame(rect, m['wall'])
        q = C[:, [0, 2]] - p0
        a = q @ n; l = q @ tv - m['t']
        keys[(a > P['wall'] * 0.5) & (np.abs(l) < 2.6)] = 'mouth_' + m['route']
    return keys
