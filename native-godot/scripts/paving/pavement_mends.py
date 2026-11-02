"""The old pavements' broken ends on the razed plots (#234, Sint-Carolus lower left).
    python pavement_mends.py <pavement dump> <out pavement-mends.json> [<plan png>]
<pavement dump>: dump-pavements.gd of the INSTALLED town (the razed houses baked out, 20 floats a corner).
A razed house's front kept its raised pavement (the kerb flags and the kerb, 12 cm up), but where two fronts met at an
angle the pieces were cut along the house's own outline: a wedge of street showed between them, a flag end hung open
over nothing (black under it, from the street) and a cut piece of the next front's flags and kerb lay over the end.
Writes, for the plots of the razed houses only (their outlines and 0.8 m round, where no wall hides it now):
- "fills": the wedges and notches under 0.8 m wide between the raised tops, laid as the flags (the pavement's top,
  its height from the flags beside it): the corner closed as one pavement;
- "covers": where two cut pieces lie one over the other at one height (they flicker), the flags laid over both, 3 mm up;
- "sides": every edge of the closed pavement that stands open (no face under it): a kerb stone's face from its top
  down under the street, so the pavement ends square and solid wherever it stops in the open.
NativeSquareDressing.Mend lays them in the flags' and the kerb's own materials. The razed cut is not changed.
(#199) Joins also take whole strips away: a razed row's old pavement left standing free across a church square (a
join with cuts and no flags); the strips carried no collision of their own, so walking is unchanged.
"""
import sys, json, math, pathlib
import numpy as np, shapely
from shapely.geometry import Polygon, LineString, Point, MultiPolygon
from shapely.strtree import STRtree

REPO = pathlib.Path(__file__).resolve().parents[3]
FLAGS, KERB = 'res://world/town/resources/r000016.res', 'res://world/town/resources/r000209.res'
CLOSE = 0.4           # a gap under twice this wide between raised tops is closed (on the street's side of the old fronts)
ZONE = 0.8            # how far round a razed house's outline the open pavement is mended
TOP_MIN, TOP_MAX = 0.05, 0.4
FOOT = -0.02          # a new face's foot, under the street's setts
GUTTER_LOW, GUTTER_HIGH, GUTTER_WIDTH = -0.006, 0.009, 0.3
GROUND_INSET = 0.012  # the street's ground goes from under a join's gutter (its relief drew over it), this far in from its edge
CUT_TOP = 0.4         # a join's cut takes the flags' and kerbs' triangles wholly under this height (tops, faces, gutters)


def meet(l1, l2):
    """Where two lines (each two plan points) cross."""
    (a, b), (c, d) = np.array(l1, float), np.array(l2, float)
    r, s = b - a, d - c
    x2 = lambda u, v: u[0] * v[1] - u[1] * v[0]
    t = x2(c - a, s) / x2(r, s)
    return (a + t * r).tolist()


def along(line, t):
    """A point on a line (two plan points), t in the line's own length from its first point (negative: behind it)."""
    a, b = np.array(line, float)
    d = (b - a) / np.linalg.norm(b - a)
    return (a + d * t).tolist()


def joins():
    """(#247, #242) Breaks too wide or too crooked for the closing: two fronts' pieces met at an angle with a cut piece of a
    third between them, or lay one over the other along a stretch. Each join is built anew from the kerb lines measured
    on the installed town (dump-pavements.gd): 'cuts' (convex, plan) take the old flags', kerbs' and gutters' triangles
    there away at load (NativeSquareDressing.Mend, before collision and the walk map read the town); 'flags' and
    'gutter' (plan polygons) are what the corner should be, laid where nothing of it stands after the cuts. The open
    edges get their kerb faces as every mend's do."""
    out = []
    # Sint-Carolus, the lower left (#247): the east piece of the west front (A) and the south-east front (B) met at a
    # 103-degree turn of the kerb; a 0.25 m2 cut piece of a third front (#242) lay in the street between them with its
    # own gutter stones, B's head ended in an angled cut over A's gutter and the gutters ran into the gap.
    a_front = [(-100.592, 165.058), (-101.983, 165.429)]
    a_gutter = [(-100.224, 165.279), (-102.193, 165.804)]
    b_front = [(-101.023, 166.160), (-100.327, 167.476)]
    b_back = [(-100.413, 165.840), (-99.719, 167.156)]
    b_gutter = [(-101.244, 166.403), (-100.608, 167.622)]
    f, g, fg = meet(a_front, b_front), meet(a_front, b_back), meet(a_gutter, b_gutter)
    piece = [(-101.333, 165.962), (-101.063, 166.200), (-100.618, 165.667), (-100.898, 165.436)]
    b_head = [(-101.023, 166.160), (-100.413, 165.840)]
    out.append(dict(
        name='carolus-lower-left',
        cuts=[[f, g, b_head[1], b_head[0]] + piece,
              # (the cut piece's gutter stones and the gutters' ends at the turn, street side of B's kerb line only)
              [f, along(b_front, 0.40), along(b_gutter, 0.15), fg, along(a_gutter, 1.75)]],
        # (B's own top too: the first cut's hull takes a sliver of its head)
        flags=[[f, g, b_head[1], b_head[0]], [(-101.023, 166.160), (-100.327, 167.476), (-100.174, 167.014), (-99.719, 167.156), (-100.413, 165.840)]],
        gutter=[[f, fg, along(a_gutter, 1.9), along(a_front, 1.35)], [f, along(b_front, 0.9), along(b_gutter, 0.6), fg],
                # (and the notch between the west front's two pieces' gutters, where it turns at x -102.2)
                [(-102.297, 165.752), (-102.193, 165.804), (-102.264, 165.520), (-102.255, 165.452)]]))
    # Sint-Paulus' razed row, x 107-109 (no issue): the next front's pieces ran on 2.2 m under this front's, their kerb
    # line 9 cm behind it; two gutters lay one over the other (the dark stones flickered) and the kerb stepped back at the
    # front's end. The stretch is laid again as one: its kerb line eases over from the one front's to the other's.
    p1_front = [(104.061, 300.612), (109.159, 299.380)]
    p1_back = [(103.900, 299.948), (106.999, 299.199)]
    p1_gutter = [(104.133, 300.920), (109.235, 299.687)]
    p2_front = [(109.141, 299.293), (113.947, 298.133)]
    p2_back = [(106.975, 299.100), (113.788, 297.469)]
    p2_gutter = [(109.212, 299.593), (114.019, 298.443)]
    w, e = 2.75, 5.30                       # the stretch along the first front's kerb line (it ends at 5.245), from its first point
    def cross(t):
        """The plan line across both fronts at t along the first front's kerb."""
        p = np.array(along(p1_front, t)); d = np.array(p1_front[1]) - np.array(p1_front[0]); d /= np.linalg.norm(d)
        n = np.array([d[1], -d[0]])
        return [(p - n).tolist(), (p + n).tolist()]
    cw, ce = cross(w), cross(e)
    fw, fe = meet(cw, p1_front), meet(ce, p2_front)
    gw, ge = meet(cw, p1_gutter), meet(ce, p2_gutter)
    bw, be = meet(cw, p1_back), meet(ce, p2_back)
    jog = [(106.999, 299.199), (106.975, 299.100)]
    out.append(dict(
        name='paulus-row-107',
        # (from 0.55 m out in the street, past both gutters, to 1 m into the plot, past both backs)
        cuts=[[along(cw, 0.45), along(ce, 0.45), along(ce, 2.0), along(cw, 2.0)]],
        flags=[[bw, jog[0], jog[1], be, fe, fw]],
        gutter=[[fw, fe, ge, gw]]))
    # Sint-Paulus' north side, x 129-131.5 (#242): a 2.3 m wedge of a cut front's flags ran out from the long piece's end
    # along the gutter, and the closing's fills round it drew an irregular outline. The wedge goes; the long piece ends
    # square at its own end (faced as every open end), the gutter course runs on along the square as it does further west.
    g_inner = [(129.386, 287.386), (131.793, 288.074)]
    end = [(131.484, 287.897), (131.681, 288.562)]
    x = meet(g_inner, end)
    out.append(dict(
        name='paulus-north-129',
        cuts=[[along(g_inner, -0.25), x, along(end, 1.2), (129.0, 289.0)]],
        flags=[], gutter=[]))
    # (#199) The razed rows' old pavements that now stand free in the open squares: a raised strip with its kerb and gutter
    # running across the square along fronts that are gone. A repaved 1873 square keeps none: the strip goes whole (the
    # street's ground lies under it, drawn and solid), and where it met a pavement that stays, that one's end is faced.
    # Sint-Carolus (Conscienceplein), the west spur: from the church's railing course north and west round the razed
    # plot's corner (x -131 to -125, z 158 to 167.5), up to 6 m from any wall.
    out.append(dict(
        name='carolus-west-spur',
        cuts=[[(-131.6, 158.0), (-125.2, 157.6), (-124.6, 159.3), (-125.5, 160.3), (-130.3, 160.95), (-131.3, 160.95)],
              [(-126.3, 159.6), (-124.6, 159.4), (-125.6, 166.2), (-126.0, 167.45), (-127.2, 167.45), (-127.4, 165.9), (-126.4, 160.4)]],
        flags=[], gutter=[]))
    # Sint-Paulusplaats, the razed row's back pavement along the church (x 64.5 to 139): a 0.7 m strip, its gutter on the
    # church's side, swinging out to 4 m from the church where the houses stood further back (x 92 to 112), and its hook
    # round the church's south-east corner (x 139 to 142.5, z 281.5 to 289.5), which ended there.
    out.append(dict(
        name='paulus-church-strip',
        cuts=[[(64.5, 285.2), (139.0, 285.2), (139.0, 290.3), (64.5, 290.3)],
              [(138.5, 280.8), (143.2, 280.8), (143.2, 289.9), (138.5, 289.9)]],
        flags=[], gutter=[]))
    return out


def polys(geom):
    if geom.is_empty: return []
    return list(geom.geoms) if hasattr(geom, 'geoms') else [geom]


def outside_pieces(tri, poly):
    """The parts of a triangle (3 x 20 attributes, world corners first) outside a convex plan polygon, as triangles; None
    when it is not wholly under CUT_TOP or nothing of it lies inside (keep it whole). Each edge's outer half-plane, inside
    the edges before it (Sutherland-Hodgman, every attribute carried linearly; a point on an edge counts as outside); the
    start's Mend cuts the same way."""
    if tri[:, 1].max() > CUT_TOP: return None
    x0, z0 = poly.min(0); x1, z1 = poly.max(0)
    if tri[:, 0].max() <= x0 or tri[:, 0].min() >= x1 or tri[:, 2].max() <= z0 or tri[:, 2].min() >= z1: return None
    # (the polygon turned counter-clockwise in x, z: inside is left of each edge)
    area = sum(poly[i - 1][0] * poly[i][1] - poly[i][0] * poly[i - 1][1] for i in range(len(poly)))
    if area < 0: poly = poly[::-1]
    EPS = 1e-7
    def side(k, p):
        a, b = poly[k], poly[(k + 1) % len(poly)]
        return (b[0] - a[0]) * (p[2] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) - EPS   # > 0 inside (left)
    def clip(rows, f):
        out = []
        for i in range(len(rows)):
            p, q = rows[i], rows[(i + 1) % len(rows)]
            sp, sq = f(p), f(q)
            if sp >= 0: out.append(p)
            if (sp >= 0) != (sq >= 0):
                t = sp / (sp - sq); out.append(p + (q - p) * t)
        return out
    def area3(rows):
        r = np.array(rows)[:, :3]
        return 0.5 * np.linalg.norm(sum(np.cross(r[i] - r[0], r[i + 1] - r[0]) for i in range(1, len(r) - 1))) if len(r) >= 3 else 0.0
    rest = list(tri); pieces = []
    for k in range(len(poly)):
        part = clip(rest, lambda p, k=k: -side(k, p) - 2 * EPS)
        for i in range(1, len(part) - 1):
            if area3([part[0], part[i], part[i + 1]]) > 1e-10: pieces.append(np.array([part[0], part[i], part[i + 1]]))
        rest = clip(rest, lambda p, k=k: side(k, p))
        if len(rest) < 3: return None
    return pieces if area3(rest) > 1e-9 else None


def cut_triangles(T, M, cuts):
    """The joins' cuts on the dumped triangles (a vertical face is cut along its plan line as a top is)."""
    if not cuts: return T, M
    keep_t, keep_m = [], []
    for t, m in zip(T, M):
        tri = t
        pieces = [tri]
        for poly in cuts:
            nxt = []
            for q in pieces:
                r = outside_pieces(q, poly)
                nxt.extend([q] if r is None else r)
            pieces = nxt
        for q in pieces:
            keep_t.append(q); keep_m.append(m)
    return np.array(keep_t), np.array(keep_m, object)


def main():
    dump, out = sys.argv[1], sys.argv[2]
    R = np.fromfile(pathlib.Path(dump) / 'pavements.f32', np.float32).reshape(-1, 20).astype(float)
    info = json.load(open(pathlib.Path(dump) / 'pavements.json'))
    mat = np.empty(len(R), object)
    for s in info: mat[s['first']:s['first'] + s['corners']] = s['material']
    T = R.reshape(-1, 3, 20); M = mat[::3]
    # the joins' cuts first, as the start makes them (NativeSquareDressing.Mend): what stands after them is mended
    JOINS = joins()
    cuts = []
    for j in JOINS:
        for c in j['cuts']:
            hull = shapely.convex_hull(shapely.MultiPoint(c)).normalize()
            cuts.append(np.array(hull.exterior.coords[:-1]))
    T, M = cut_triangles(T, M, cuts)
    P = T[:, :, :3]
    cb = json.load(open(REPO / 'native-godot/world/data/shared/city_build.json'))
    razed = [Polygon(h['fp']).buffer(0) for h in cb['houses'] if h.get('razed') and len(h.get('fp', [])) >= 3]
    standing = shapely.union_all([Polygon(h['fp']).buffer(0) for h in cb['houses'] if not h.get('gone') and len(h.get('fp', [])) >= 3])
    # (the plots and round them, but not where a standing house's wall still hides the pavement's end)
    zone = shapely.union_all([r.buffer(ZONE) for r in razed]).difference(standing.buffer(-0.05))
    n = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0]); L = np.linalg.norm(n, axis=1) + 1e-12; ny = n[:, 1] / L
    box = zone.buffer(1.5).bounds
    near = (P[:, :, 0].max(1) > box[0]) & (P[:, :, 0].min(1) < box[2]) & (P[:, :, 2].max(1) > box[1]) & (P[:, :, 2].min(1) < box[3])
    up = near & (np.abs(ny) > 0.8) & (L > 2e-6) & (P[:, :, 1].min(1) > TOP_MIN) & (P[:, :, 1].max(1) < TOP_MAX)
    side = near & (np.abs(ny) < 0.5) & (P[:, :, 1].max(1) > TOP_MIN)
    tops = [Polygon(t[:, [0, 2]]) for t in P[up]]
    # (the gutters and low steps: the kerbs' own faces at the street's height, which a fill must leave)
    low = near & (np.abs(ny) > 0.8) & (L > 2e-6) & (P[:, :, 1].max(1) <= TOP_MIN)
    lows = shapely.union_all([p for p in (Polygon(t[:, [0, 2]]) for t in P[low]) if p.is_valid and p.area > 1e-7])
    keep = [i for i, p in enumerate(tops) if p.is_valid and p.area > 1e-7 and p.intersects(zone.buffer(1.0))]
    ti = np.flatnonzero(up)[keep]; tops = [tops[i] for i in keep]
    U = shapely.union_all([p.buffer(0.0005) for p in tops]).buffer(-0.0005)
    tree = STRtree(tops)
    # the joins' corners: their flags where nothing stands after the cuts (the closing and the faces see them as laid)
    J = shapely.union_all([Polygon(q).buffer(0) for j in JOINS for q in j['flags']]).difference(U)
    joined = [g for g in polys(J.buffer(-0.002, join_style='mitre').buffer(0.002, join_style='mitre')) if g.area > 1e-3]
    U = shapely.union_all([U.buffer(0.0005)] + [g.buffer(0.0005) for g in joined]).buffer(-0.0005)
    # (a join owns its corner: no closing's fill of its own there)
    owned = shapely.union_all([Polygon(c).buffer(0.1) for c in cuts]) if cuts else Polygon()
    # the raised tops' corners (height, flags or kerb, the corner's whole row: tangent, colour, custom)
    corners = T[ti].reshape(-1, 20)
    cmat = np.repeat(M[ti], 3)
    def look(x, z, want=None):
        d = (corners[:, 0] - x) ** 2 + (corners[:, 2] - z) ** 2
        if want is not None: d = np.where(cmat == want, d, 1e9)
        k = int(np.argmin(d))
        return corners[k], cmat[k]
    # what stands under an edge already: the faces that go up from the street (their plan, a line)
    faces = []
    for t in P[side]:
        q = t[:, [0, 2]]
        a, b = max(((i, j) for i in range(3) for j in range(i + 1, 3)), key=lambda ij: np.linalg.norm(q[ij[0]] - q[ij[1]]))
        if np.linalg.norm(q[a] - q[b]) > 1e-3 and t[:, 1].max() > 0.07: faces.append(LineString([q[a], q[b]]).buffer(0.02))
    faced = shapely.union_all(faces) if faces else Polygon()

    # 1. fills: the gaps the closing takes in, inside the zone
    closed = U.buffer(CLOSE, join_style='mitre', mitre_limit=2.5).buffer(-CLOSE, join_style='mitre', mitre_limit=2.5)
    # (only in front of the old fronts, where the pavement ran: never into a plot, which is the square's now)
    F = closed.difference(U).intersection(zone).difference(shapely.union_all(razed).buffer(0.002)).difference(lows.buffer(0.005))
    F = F.buffer(-0.004, join_style='mitre').buffer(0.004, join_style='mitre')
    # (no fill under the squares' things: a bench, a pile of bricks or a guard stone stands on the street as it is)
    sq = json.load(open(REPO / 'native-godot/world/town/squares.json'))
    dressing = json.load(open(REPO / 'native-godot/world/town/square-dressing.json'))
    things = [Point(t['x'], t['z']).buffer(1.0) for t in sq['trees'] if 'pit' in t] + [Point(b['x'], b['z']).buffer(1.1) for b in sq['benches']]
    things += [Point(t['at']).buffer((max(t['size'][0], t['size'][2]) / 2 if t.get('size') else 0.3) + 0.3) for t in dressing['things'] if not t['kind'].startswith('move:')]
    blocked = shapely.union_all(things)
    fills = []
    for g in polys(F):
        if g.area < 0.004 or g.intersects(blocked) or g.intersects(owned): continue
        # (a thread of a gap along an edge is no gap)
        if g.area / max(g.length, 1e-6) < 0.012: continue
        fills.append(g)
    # 2. covers: two tops one over the other at one height
    overlaps = []
    for i, p in enumerate(tops):
        if not p.intersects(zone): continue
        for j in tree.query(p):
            if j <= i: continue
            o = p.intersection(tops[j])
            if o.area < 5e-4: continue
            yi, yj = P[ti[i]][:, 1].mean(), P[ti[j]][:, 1].mean()
            # (two kerbs crossing at a corner: their tops are one stone's; a flag over another or over a kerb flickers)
            if abs(yi - yj) < 0.012 and FLAGS in (M[ti[i]], M[ti[j]]): overlaps.append(o)
    O = shapely.union_all(overlaps).intersection(zone) if overlaps else Polygon()
    covers = [g for g in polys(O.buffer(0.01, join_style='mitre')) if g.area > 1e-3]

    out_tops = []
    # (the flags' courses follow their own uv as well as the world's: a new piece goes on with the nearest flag's,
    # its uv carried on from that triangle's own)
    flag_i = [k for k, i in enumerate(ti) if M[i] == FLAGS]
    flag_mid = np.array([tops[k].centroid.coords[0] for k in flag_i])
    def lay(g, kind, lift):
        tris = shapely.constrained_delaunay_triangles(g)
        for t in polys(tris):
            c = np.array(t.exterior.coords[:3])
            if Polygon(c).area < 1e-7: continue
            m = c.mean(0)
            src = T[ti[flag_i[int(np.argmin(((flag_mid - m) ** 2).sum(1)))]]]
            A = np.c_[src[:, [0, 2]], np.ones(3)]
            uv = np.linalg.lstsq(A, src[:, 6:8], rcond=None)[0]
            ys = [look(x, z)[0][1] + lift for x, z in c]
            out_tops.append(dict(kind=kind, corners=[[round(x, 4), round(y, 4), round(z, 4)] for (x, z), y in zip(c, ys)],
                                 uv=[[round(float(v), 4) for v in np.array([x, z, 1.0]) @ uv] for x, z in c],
                                 tangent=[round(float(v), 4) for v in src[0, 16:20]], colour=[round(float(v), 4) for v in src[0, 10:14]]))
    for g in joined: lay(g, 'join', 0)
    for g in fills: lay(g, 'fill', 0)
    for g in covers: lay(g, 'cover', 0.003)

    # 3. sides: the closed pavement's open edges in the zone
    N = shapely.union_all([U] + fills)
    # the joins' gutters: the gutter stones' course where none lies after the cuts, outside the closed pavement, laid in the
    # kerbs' material at the gutters' height with the nearest gutter stone's picture carried on (its uv, colour and custom)
    # (#199: each of a join's gutter pieces kept apart, so each carries on the one old stone it meets: one picture over the
    # piece, no seam inside it; the pieces of a corner meet at the corner's joint as two stones do)
    gutter_new = []
    for j in JOINS:
        for q in j['gutter']:
            G = Polygon(q).buffer(0).difference(lows).difference(N)
            for prev in gutter_new: G = G.difference(prev)
            gutter_new += [g for g in polys(G.buffer(-0.002, join_style='mitre').buffer(0.002, join_style='mitre')) if g.area > 1e-3]
    lowi = np.flatnonzero(low & (M == KERB))
    low_mid = P[lowi].mean(1)[:, [0, 2]]
    low_rows = T[lowi].reshape(-1, 20)
    out_gutters = []
    kerbs = N.boundary
    low_tris = P[lowi]
    def gutter_y(x, z):
        # (where it meets an old gutter stone, that stone's own height there, so no step opens a crack between them)
        q = Point(x, z)
        best = None
        for k in np.flatnonzero((np.abs(low_mid[:, 0] - x) < 3) & (np.abs(low_mid[:, 1] - z) < 3)):
            t = low_tris[k]; d = Polygon(t[:, [0, 2]]).distance(q)
            if d < 0.015 and (best is None or d < best[0]): best = (d, t)
        if best is not None:
            t = best[1]; A = np.c_[t[:, [0, 2]], np.ones(3)]
            try: return float(np.array([x, z, 1.0]) @ np.linalg.solve(A, t[:, 1]))
            except np.linalg.LinAlgError: pass
        return GUTTER_LOW + (GUTTER_HIGH - GUTTER_LOW) * min(1.0, kerbs.distance(q) / GUTTER_WIDTH)
    # (the street's ground under them: its drawn triangles only, in convex pieces held a little in from the gutter's edge)
    # (#199: the pieces grown together first, so a hairline between two of them is no strip of street left standing in
    # the joint, drawn over the stones as a pale line)
    inner = shapely.union_all([g.buffer(0.003, join_style='mitre') for g in gutter_new]).buffer(-0.003 - GROUND_INSET, join_style='mitre') if gutter_new else Polygon()
    ground_cuts = [[[round(float(x), 4), round(float(z), 4)] for x, z in np.array(t.exterior.coords[:3])]
                   for t in polys(shapely.constrained_delaunay_triangles(inner)) if t.area > 1e-5] if not inner.is_empty else []
    low_corners = low_rows.reshape(-1, 20)
    def gutter_source(g):
        """The old gutter stone a new piece carries on: of the stones it touches, the one it meets along the longest edge
        (else the nearest); its picture runs on over the whole piece."""
        near_k = np.flatnonzero((np.abs(low_mid[:, 0] - g.centroid.x) < 4) & (np.abs(low_mid[:, 1] - g.centroid.y) < 4))
        best, best_len = None, 0.0
        for k in near_k:
            p = Polygon(low_tris[k][:, [0, 2]])
            if not p.is_valid or p.area < 1e-7 or p.distance(g) > 0.015: continue
            touch = p.buffer(0.01).intersection(g.boundary).length
            if touch > best_len: best, best_len = k, touch
        if best is None: best = int(np.argmin(((low_mid - np.array(g.centroid.coords[0])) ** 2).sum(1)))
        return T[lowi[best]]
    def gutter_colour(x, z, src):
        """A corner's colour: the old gutter stones' own at the nearest of their corners within 3 cm (so the new stone
        meets the old one without a step in its tone), else the source stone's."""
        d = (low_corners[:, 0] - x) ** 2 + (low_corners[:, 2] - z) ** 2
        k = int(np.argmin(d))
        row = low_corners[k] if d[k] < 0.03 ** 2 else src.mean(0)
        return [round(float(v), 4) for v in row[10:14]]
    for g in gutter_new:
        src = gutter_source(g)
        A = np.c_[src[:, [0, 2]], np.ones(3)]
        uv = np.linalg.lstsq(A, src[:, 6:8], rcond=None)[0]
        for t in polys(shapely.constrained_delaunay_triangles(g)):
            c = np.array(t.exterior.coords[:3])
            if Polygon(c).area < 1e-7: continue
            # (the gutter's fall: 6 mm under the street at the kerb, 9 mm over it a course out, as the old gutters lie)
            ys = [gutter_y(x, z) for x, z in c]
            out_gutters.append(dict(corners=[[round(x, 4), round(y, 4), round(z, 4)] for (x, z), y in zip(c, ys)],
                                    uv=[[round(float(v), 4) for v in np.array([x, z, 1.0]) @ uv] for x, z in c],
                                    tangent=[round(float(v), 4) for v in src[0, 16:20]], colour=[round(float(v), 4) for v in src[0, 10:14]],
                                    colours=[gutter_colour(x, z, src) for x, z in c],
                                    custom=[round(float(v), 4) for v in src[0, 14:16]]))
    sides = []
    # (a new face takes the look of the nearest of the kerbs' own upright faces: its colour and picture)
    krow = T[side].reshape(-1, 20); kmat = np.repeat(M[side], 3)
    krow = krow[(kmat == KERB) & (np.abs(krow[:, 4]) < 0.2)]
    def kerb_look(x, z):
        k = int(np.argmin((krow[:, 0] - x) ** 2 + (krow[:, 2] - z) ** 2))
        return [round(float(v), 4) for v in krow[k, 10:14]], [round(float(v), 4) for v in krow[k, 14:16]]
    for poly in polys(N):
        for ring in [poly.exterior] + list(poly.interiors):
            c = np.array(ring.coords)
            for a, b in zip(c[:-1], c[1:]):
                seg = LineString([a, b])
                if seg.length < 0.01 or not seg.intersects(zone): continue
                # open stretches: sampled every 2 cm
                k = max(2, int(seg.length / 0.02))
                pts = [seg.interpolate(s, normalized=True) for s in np.linspace(0, 1, k + 1)]
                inz = [zone.contains(p) for p in pts]
                open_ = [z and not faced.contains(p) for p, z in zip(pts, inz)]
                s0 = None
                for s in range(len(pts) + 1):
                    if s < len(pts) and open_[s]:
                        if s0 is None: s0 = s
                        continue
                    if s0 is not None and s - 1 > s0:
                        p0, p1 = pts[s0], pts[s - 1]
                        d = np.array([p1.x - p0.x, p1.y - p0.y]); d /= np.linalg.norm(d)
                        ow = np.array([d[1], -d[0]])
                        mid = np.array([(p0.x + p1.x) / 2, (p0.y + p1.y) / 2])
                        if N.contains(Point(mid + ow * 0.01)): ow = -ow
                        y0, y1 = look(p0.x, p0.y)[0][1], look(p1.x, p1.y)[0][1]
                        colour, custom = kerb_look(mid[0], mid[1])
                        sides.append(dict(a=[round(p0.x, 4), round(y0, 4), round(p0.y, 4)], b=[round(p1.x, 4), round(y1, 4), round(p1.y, 4)],
                                          out=[round(ow[0], 4), round(ow[1], 4)], colour=colour, custom=custom))
                    s0 = None
    data = dict(note="NativeSquareDressing.Mend: the old pavements' broken ends on the razed plots closed and squared "
                     "(scripts/paving/pavement_mends.py, #234). tops: triangles in the flags' material (fill: a gap closed; cover: "
                     "two cut pieces one over the other); sides: an open edge's face from its top to the foot, in the kerb's.",
                foot=FOOT, flags=FLAGS, kerb=KERB,
                tops=out_tops, sides=sides,
                groundCuts=ground_cuts, cutTop=CUT_TOP, cuts=[[[round(float(x), 4), round(float(z), 4)] for x, z in c] for c in cuts], gutters=out_gutters)
    json.dump(data, open(out, 'w'), separators=(',', ':'))
    print('joins', len(JOINS), 'cuts', len(cuts), 'join flags', len(joined), round(sum(g.area for g in joined), 3), 'm2; join gutters',
          len(gutter_new), round(sum(g.area for g in gutter_new), 3), 'm2 in', len(out_gutters), 'triangles')
    for g in sorted(fills, key=lambda g: -g.area)[:30]:
        print('  fill %.3f m2 at %.1f, %.1f' % (g.area, g.centroid.x, g.centroid.y))
    print('fills', len(fills), round(sum(g.area for g in fills), 3), 'm2; covers', len(covers), round(sum(g.area for g in covers), 3),
          'm2; top triangles', len(out_tops), '; open edges', len(sides), round(sum(math.dist(s['a'][::2], s['b'][::2]) for s in sides), 2), 'm')
    if len(sys.argv) > 3:
        import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
        from matplotlib.collections import PolyCollection
        for name, (x0, x1, z0, z1) in json.loads(sys.argv[4]).items() if len(sys.argv) > 4 else [('all', zone.bounds[0::2] + zone.bounds[1::2])]:
            fig, ax = plt.subplots(figsize=(12, 9))
            ax.add_collection(PolyCollection([np.array(p.exterior.coords) for p in tops], facecolor='#f4a', alpha=0.25, edgecolor='k', lw=0.15))
            ax.add_collection(PolyCollection([np.array(p.exterior.coords) for p in polys(lows)], facecolor='#888', alpha=0.3, edgecolor='none'))
            for g in fills: ax.fill(*g.exterior.xy, color='g', alpha=0.7)
            for g in joined: ax.fill(*g.exterior.xy, color='c', alpha=0.7)
            for g in gutter_new: ax.fill(*g.exterior.xy, color='orange', alpha=0.7)
            for c in cuts: ax.plot(*np.vstack([c, c[:1]]).T, 'b:', lw=1)
            for g in covers: ax.fill(*g.exterior.xy, color='b', alpha=0.6)
            for s in sides: ax.plot([s['a'][0], s['b'][0]], [s['a'][2], s['b'][2]], 'r-', lw=1.5)
            for r in razed: ax.plot(*r.exterior.xy, 'k--', lw=0.5)
            ax.set_xlim(x0, x1); ax.set_ylim(z1, z0); ax.set_aspect('equal')
            plt.savefig(sys.argv[3].replace('.png', f'_{name}.png'), dpi=110); plt.close(fig)


if __name__ == '__main__':
    main()
