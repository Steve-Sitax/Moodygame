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


def polys(geom):
    if geom.is_empty: return []
    return list(geom.geoms) if hasattr(geom, 'geoms') else [geom]


def main():
    dump, out = sys.argv[1], sys.argv[2]
    R = np.fromfile(pathlib.Path(dump) / 'pavements.f32', np.float32).reshape(-1, 20).astype(float)
    info = json.load(open(pathlib.Path(dump) / 'pavements.json'))
    mat = np.empty(len(R), object)
    for s in info: mat[s['first']:s['first'] + s['corners']] = s['material']
    T = R.reshape(-1, 3, 20); M = mat[::3]
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
        if g.area < 0.004 or g.intersects(blocked): continue
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
    for g in fills: lay(g, 'fill', 0)
    for g in covers: lay(g, 'cover', 0.003)

    # 3. sides: the closed pavement's open edges in the zone
    N = shapely.union_all([U] + fills)
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
                tops=out_tops, sides=sides)
    json.dump(data, open(out, 'w'), separators=(',', ':'))
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
            for g in covers: ax.fill(*g.exterior.xy, color='b', alpha=0.6)
            for s in sides: ax.plot([s['a'][0], s['b'][0]], [s['a'][2], s['b'][2]], 'r-', lw=1.5)
            for r in razed: ax.plot(*r.exterior.xy, 'k--', lw=0.5)
            ax.set_xlim(x0, x1); ax.set_ylim(z1, z0); ax.set_aspect('equal')
            plt.savefig(sys.argv[3].replace('.png', f'_{name}.png'), dpi=110); plt.close(fig)


if __name__ == '__main__':
    main()
