# H5 paving layout: for any ground point, which patch lays it (edge course, a street's field, hidden) and its uv.
# Streets: rows of setts across the street, following its smoothed centre line (fanned round bends: a conformal
# map, so a stone grows a little on the outside of a bend but is never stretched one way or sheared). A through
# street claims the junction; a side street stops at the line of the through street's kerb (a straight joint).
# Edge course: one row of setts laid along every street edge (kerb, wall foot, a pump's base), turning round a
# kerb's corner (a fan) and mitred in an inside corner.
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import json, math, numpy as np, cv2, shapely
from scipy.spatial import cKDTree
from scipy.ndimage import gaussian_filter1d, minimum_filter1d
from shapely.geometry import Polygon, MultiPolygon, LineString


def mask_polygons(mask, X0, Z0, R, simplify=0.03, min_area=2.0, line=False):
    """The mask's regions as shapely polygons with holes (world metres), on the pixel edges. line: the street's general
    line for its edge course (a step, a pilaster's foot or a post under 90 cm across filled; a recess under 60 cm wide
    left out), the paviour's line, not every stone of the wall's foot."""
    m = mask.astype(np.uint8)
    if line:
        kc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (19, 19)); ko = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (13, 13))
        m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_CLOSE, kc), cv2.MORPH_OPEN, ko)
        simplify = 0.06
    # kerbs and wall feet are straight: no notch or bump under 15 cm (a drain plate's frame, a step's nosing)
    # (a slot under 20 cm between a kerb and a wall is no street; a post, a bollard or a lamp's foot under 45 cm across
    # gets no edge course of its own: the setts butt against it)
    ko = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)); kc = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))
    m = cv2.morphologyEx(cv2.morphologyEx(m, cv2.MORPH_OPEN, ko), cv2.MORPH_CLOSE, kc)
    from skimage.morphology import remove_small_holes
    m = remove_small_holes(m.astype(bool), max_size=int(1.5 / (R * R))).astype(np.uint8)
    cs, hier = cv2.findContours(m, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_NONE)
    hier = hier[0] if hier is not None else []
    def world(c):
        c = c[:, 0, :].astype(float)
        # the pixel staircase smoothed along the outline (10 cm): a slanting kerb becomes one straight line
        if len(c) > 12:
            c = np.stack([gaussian_filter1d(c[:, 0], 2.0, mode='wrap'), gaussian_filter1d(c[:, 1], 2.0, mode='wrap')], 1)
        return np.stack([X0 + (c[:, 0] + 0.5) * R, Z0 + (c[:, 1] + 0.5) * R], 1)
    polys = []
    for i, c in enumerate(cs):
        if hier[i][3] != -1 or len(c) < 4: continue
        holes = []
        j = hier[i][2]
        while j != -1:
            if len(cs[j]) >= 4: holes.append(world(cs[j]))
            j = hier[j][0]
        p = Polygon(world(c), [h for h in holes])
        if not p.is_valid: p = p.buffer(0)
        polys.append(p)
    mp = shapely.union_all(polys)
    # the contour runs on the boundary pixels' centres: the edge is half a pixel further out
    mp = mp.buffer(R * 0.5, join_style='mitre', mitre_limit=2.0).simplify(simplify)
    mp = shapely.make_valid(mp)
    # a kerb, a wall's foot: long straight pieces (the outline's small turns, under 5 degrees and 3 cm off, taken out)
    def straight(poly):
        if poly.geom_type != 'Polygon': return poly
        tt, tl = (6.0, 0.05) if line else (5.0, 0.03)
        ext = merge_straight(np.asarray(poly.exterior.coords)[:-1], tt, tl)
        holes = [merge_straight(np.asarray(h.coords)[:-1], tt, tl) for h in poly.interiors]
        q = Polygon(ext, [h for h in holes if len(h) >= 3])
        return q if q.is_valid else shapely.make_valid(q)
    mp = shapely.union_all([straight(g) for g in getattr(mp, 'geoms', [mp])])
    parts = [g for g in getattr(mp, 'geoms', [mp]) if g.geom_type == 'Polygon' and g.area >= min_area]
    return MultiPolygon(parts)

class Edges:
    """Signed distance to the street's edge, and the edge course's midline (its uv along the kerb)."""
    def __init__(self, area, band, ring_quads=12):
        self.area = area; self.band = band
        segs = []
        for poly in area.geoms:
            for ring in [poly.exterior] + list(poly.interiors):
                c = np.asarray(ring.coords)
                segs.append(np.stack([c[:-1], c[1:]], 1))
        self.seg = np.concatenate(segs)
        self.tree = shapely.STRtree(shapely.linestrings(self.seg))
        mid = area.buffer(-band / 2, quad_segs=ring_quads, join_style='round').simplify(0.003)
        msegs = []; u0 = []; ring_id = []
        rid = 0
        for poly in getattr(mid, 'geoms', [mid]):
            if poly.geom_type != 'Polygon': continue
            for ring in [poly.exterior] + list(poly.interiors):
                c = merge_straight(np.asarray(ring.coords)[:-1])
                if len(c) < 3: continue
                # start the ring at its sharpest corner (a mitre hides the wrap)
                d1 = c - np.roll(c, 1, 0); d2 = np.roll(c, -1, 0) - c
                a = np.abs(np.arctan2(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0], (d1 * d2).sum(1)))
                k = int(np.argmax(a)); c = np.roll(c, -k, 0); c = np.vstack([c, c[:1]])
                L = np.hypot(*np.diff(c, axis=0).T)
                msegs.append(np.stack([c[:-1], c[1:]], 1)); u0.append(np.r_[0, np.cumsum(L)[:-1]]); ring_id.append(np.full(len(L), rid)); rid += 1
        self.mseg = np.concatenate(msegs); self.mu0 = np.concatenate(u0); self.mring = np.concatenate(ring_id)
        d = self.mseg[:, 1] - self.mseg[:, 0]; self.mlen = np.hypot(*d.T); self.mdir = d / np.maximum(self.mlen, 1e-9)[:, None]
        self.mtree = shapely.STRtree(shapely.linestrings(self.mseg))

    def signed(self, p):
        pts = shapely.points(p)
        i, j = self.tree.query_nearest(pts, return_distance=False, all_matches=False)
        a = self.seg[j, 0]; b = self.seg[j, 1]
        d = _segdist(p[i], a, b)
        out = np.empty(len(p)); out[i] = d
        inside = shapely.contains_xy(self.area, p[:, 0], p[:, 1])
        return np.where(inside, out, -out)

    def course(self, p):
        """Nearest midline segment and the uv's along-kerb metres there."""
        pts = shapely.points(p)
        i, j = self.mtree.query_nearest(pts, return_distance=False, all_matches=False)
        seg = np.empty(len(p), int); seg[i] = j
        a = self.mseg[seg, 0]
        along = self.mu0[seg] + ((p - a) * self.mdir[seg]).sum(1)
        return seg, along

    def segdist(self, p, seg):
        return _segdist(p, self.mseg[seg, 0], self.mseg[seg, 1])

def merge_straight(c, turn=3.0, tol=0.005):
    """A closed ring's corners where it hardly turns (each under `turn` degrees, all within `tol` of the chord) taken
    out: a kerb is a few long straight pieces; a fan's arc (7.5 degrees a corner) keeps every corner."""
    n = len(c)
    if n < 4: return c
    d1 = c - np.roll(c, 1, 0); d2 = np.roll(c, -1, 0) - c
    ang = np.degrees(np.abs(np.arctan2(d1[:, 0] * d2[:, 1] - d1[:, 1] * d2[:, 0], (d1 * d2).sum(1))))
    sharp = np.nonzero(ang >= turn)[0]
    start = int(sharp[0]) if len(sharp) else int(np.argmax(ang))
    c = np.roll(c, -start, 0); ang = np.roll(ang, -start)
    keep = [0]; a = 0
    for b in range(1, n + 1):
        j = b % n
        # can the piece a..b be one straight line?
        if b - a >= 2:
            pa, pb = c[a], c[j]
            mid = c[a + 1:b]
            ab = pb - pa; L = np.hypot(*ab)
            dev = np.abs((mid[:, 0] - pa[0]) * ab[1] - (mid[:, 1] - pa[1]) * ab[0]) / max(L, 1e-9)
            if dev.max() > tol or ang[a + 1:b].max() >= turn:
                keep.append(b - 1); a = b - 1
    out = c[[k % n for k in keep]]
    return out

def _segdist(p, a, b):
    ab = b - a; L2 = (ab * ab).sum(1)
    t = np.clip(((p - a) * ab).sum(1) / np.maximum(L2, 1e-12), 0, 1)
    q = a + ab * t[:, None]
    return np.hypot(*(p - q).T)

class Chain:
    def __init__(self, idx, pts, w, ends):
        self.idx = idx
        p = np.asarray(pts, float); w = np.asarray(w, float)
        # resample at 0.25 m
        d = np.r_[0, np.cumsum(np.hypot(*np.diff(p, axis=0).T))]
        keep = np.r_[True, np.diff(d) > 1e-6]; p, w, d = p[keep], w[keep], d[keep]
        n = max(2, int(d[-1] / 0.25) + 1); s = np.linspace(0, d[-1], n)
        p = np.stack([np.interp(s, d, p[:, 0]), np.interp(s, d, p[:, 1])], 1); w = np.interp(s, d, w)
        # the street's half width: the narrow parts (a junction or a corner widens the open ground, not the street)
        k = max(1, int(6.0 / 0.25))
        hw = minimum_filter1d(w, 2 * k + 1, mode='nearest')
        hw = gaussian_filter1d(hw, 8, mode='nearest')
        # the skeleton bends into a junction or a corner: its last stretch there is dropped and the street runs on
        # straight from where it is still a street (the extension below)
        # each end's direction: a line fitted to the street just short of the junction, over three widths
        def fit_dir(pp, ss, a, b, outward):
            m = (ss >= a) & (ss <= b)
            if m.sum() < 4: m = np.ones(len(ss), bool)
            q = pp[m] - pp[m].mean(0); u = np.linalg.svd(q, full_matrices=False)[2][0]
            return u if np.dot(u, outward) > 0 else -u
        cut0 = min(2.0 * hw[0] + 2.0, s[-1] * 0.3); cut1 = min(2.0 * hw[-1] + 2.0, s[-1] * 0.3)
        span0 = max(10.0, 5.0 * hw[0]); span1 = max(10.0, 5.0 * hw[-1])
        self.dir0 = fit_dir(p, s, cut0, min(s[-1], cut0 + span0), p[0] - p[-1])
        self.dir1 = fit_dir(p, s, max(0, s[-1] - cut1 - span1), s[-1] - cut1, p[-1] - p[0])
        if len(s) > 8:
            keep = (s >= cut0) & (s <= s[-1] - cut1)
            if keep.sum() >= 4:
                p, w, hw = p[keep], w[keep], hw[keep]; s = s[keep] - s[keep][0]
        self.hw_med = float(np.median(hw)); self.length = float(s[-1])
        # a paviour's line: the skeleton's wobbles (a step, a jog in a frontage) taken out, the real bends kept
        line = LineString(p).simplify(max(0.25, 0.15 * self.hw_med))
        q = np.asarray(line.coords); dq = np.r_[0, np.cumsum(np.hypot(*np.diff(q, axis=0).T))]
        n = max(2, int(dq[-1] / 0.25) + 1); s2 = np.linspace(0, dq[-1], n)
        hw = np.interp(s2 * (s[-1] / max(dq[-1], 1e-9)), s, hw)
        p = np.stack([np.interp(s2, dq, q[:, 0]), np.interp(s2, dq, q[:, 1])], 1); s = s2
        sig = float(np.clip(3.0 * self.hw_med, 4.0, 12.0)) / 0.25
        # extend both ends straight on (so the smoothing keeps the ends' direction and the corridor reaches past)
        ext = [self._ext(p, e, hw) for e in (0, 1)]
        def tan(q, at_end, L=4.0):
            q = q[::-1] if at_end else q; dd = np.r_[0, np.cumsum(np.hypot(*np.diff(q, axis=0).T))]
            j = min(int(np.searchsorted(dd, L)), len(q) - 1); v = q[0] - q[j]; return v / max(np.hypot(*v), 1e-9)
        t0, t1 = self.dir0, self.dir1
        n0, n1 = int(ext[0] / 0.25), int(ext[1] / 0.25)
        pre = p[0] + t0 * (np.arange(n0, 0, -1)[:, None] * 0.25); post = p[-1] + t1 * (np.arange(1, n1 + 1)[:, None] * 0.25)
        P = np.vstack([pre, p, post]); HW = np.r_[np.full(n0, hw[0]), hw, np.full(n1, hw[-1])]
        pad = int(3 * sig)
        Pp = np.vstack([P[0] + (P[0] - P[1]) * np.arange(pad, 0, -1)[:, None], P, P[-1] + (P[-1] - P[-2]) * np.arange(1, pad + 1)[:, None]])
        Ps = np.stack([gaussian_filter1d(Pp[:, 0], sig), gaussian_filter1d(Pp[:, 1], sig)], 1)[pad:-pad]
        dd = np.r_[0, np.cumsum(np.hypot(*np.diff(Ps, axis=0).T))]
        T = np.gradient(Ps, dd, axis=0); T /= np.maximum(np.hypot(*T.T), 1e-9)[:, None]
        N = np.stack([-T[:, 1], T[:, 0]], 1)
        ang = np.unwrap(np.arctan2(T[:, 1], T[:, 0]))
        kap = gaussian_filter1d(np.gradient(ang, dd), max(2.0, sig / 2))
        # never so tight that the inner edge folds: |kappa| * (hw + 1 m) <= 0.35
        lim = 0.35 / (HW + 1.0)
        kap = np.clip(kap, -lim, lim)
        self.P, self.T, self.N, self.kap, self.hw, self.s = Ps, T, N, kap, HW, dd
        self.hwL = HW.copy(); self.hwR = HW.copy()
        if Chain.MASK is not None:
            self.hwL = self._side(+1, HW); self.hwR = self._side(-1, HW)
        self.s_lo, self.s_hi = 0.0, float(dd[-1])
        self.tree = cKDTree(Ps)
        self.box = (Ps.min(0) - HW.max() - 2, Ps.max(0) + HW.max() + 2)
        self.ends = ends

    MASK = None  # (mask, X0, Z0, R): the street's own outline, for each side's width
    def _side(self, sign, HW):
        m, X0, Z0, R = Chain.MASK
        steps = np.arange(0.0, 25.0, 0.025)
        d = np.full(len(self.P), np.nan)
        for j in range(len(self.P)):
            q = self.P[j][None, :] + sign * self.N[j][None, :] * steps[:, None]
            c = ((q[:, 0] - X0) / R).astype(int); r = ((q[:, 1] - Z0) / R).astype(int)
            ok = (c >= 0) & (c < m.shape[1]) & (r >= 0) & (r < m.shape[0])
            inside = np.zeros(len(q), bool); inside[ok] = m[r[ok], c[ok]]
            if not inside[0]: continue
            out = np.nonzero(~inside)[0]
            d[j] = steps[out[0]] if len(out) else steps[-1]
        # an opening (a side street, a yard gate) is bridged from the street's width either side of it
        med = np.nanmedian(d) if np.isfinite(d).any() else float(np.median(HW))
        base = minimum_filter1d(np.where(np.isfinite(d), d, 1e9), 41, mode='nearest')
        base = np.where(base > 1e8, med, base)
        open_ = ~np.isfinite(d) | (d > 1.35 * base + 0.6)
        idx = np.arange(len(d))
        if (~open_).sum() >= 2: d = np.interp(idx, idx[~open_], d[~open_])
        else: d = np.full(len(d), med)
        return gaussian_filter1d(d, 4, mode='nearest')

    @staticmethod
    def _ext(p, e, hw):
        h = hw[0] if e == 0 else hw[-1]
        return float(min(2.4 * h + 3.0, 12.0))

    def local(self, p):
        """s, t, kappa, hw at the nearest centre-line sample (refined along its tangent)."""
        dist, i = self.tree.query(p)
        dp = p - self.P[i]
        s = self.s[i] + (dp * self.T[i]).sum(1)
        t = (dp * self.N[i]).sum(1)
        return s, t, self.kap[i], self.hw[i], i

    def claim(self, p, margin=0.3):
        s, t, k, hw, i = self.local(p)
        inside = (i > 0) & (i < len(self.P) - 1)
        side = np.where(t >= 0, self.hwL[i], self.hwR[i])
        return np.where(inside, side + margin - np.abs(t), -1e9), s, t, k

    def uv_m(self, s, t, k):
        """Metres across (u) and along (v): a conformal fan, -ln(1 - k t) / k across and the arc length along."""
        kt = np.clip(k * t, -0.6, 0.6)
        safe = np.abs(k) > 1e-5
        U = np.where(safe, -np.log1p(-kt) / np.where(safe, k, 1.0), t)
        return U, s

def split_sharp(pts, w, turn=35.0):
    """A street that turns a corner (a sharp turn on its simplified line) is two streets meeting there."""
    p = np.asarray(pts, float); w = np.asarray(w, float)
    hw = float(np.median(w))
    q = np.asarray(LineString(p).simplify(max(0.4, 0.25 * hw)).coords)
    cuts = []
    for j in range(1, len(q) - 1):
        a = q[j] - q[j - 1]; b = q[j + 1] - q[j]
        ang = math.degrees(abs(math.atan2(a[0] * b[1] - a[1] * b[0], a @ b)))
        if ang > turn: cuts.append(int(np.argmin(np.hypot(*(p - q[j]).T))))
    pieces = []; prev = 0
    for c in cuts + [len(p) - 1]:
        if c - prev >= 3: pieces.append((p[prev:c + 1], w[prev:c + 1]))
        prev = c
    return pieces or [(p, w)]

def load_chains(kind='cobble'):
    C = json.load(open(W + f'chains-{kind}.json'))
    out = []
    for i, c in enumerate(C):
        for pp, ww in split_sharp(c['pts'], c['w']):
            L = float(np.hypot(*np.diff(pp, axis=0).T).sum())
            # (a stub of the skeleton in a wide place is no street: its corridor would lay a stray patch)
            if L < max(4.0, 1.5 * float(np.median(ww))): continue
            out.append(Chain(len(out), pp, ww, None))
    # priority: wide first, then long (a through street wins its junctions)
    for c in out: c.prio = c.hw_med * 2.0 + min(c.length, 200) / 25.0
    out.sort(key=lambda c: -c.prio)
    for i, c in enumerate(out): c.idx = i
    return out

class Layout:
    HIDDEN = -1
    SQUARE = 2_000_000
    def __init__(self, kind, area, chains, tile, band, hidden_margin=0.5, line=None, along=False, squares=None):
        self.kind, self.area, self.chains, self.tile, self.band = kind, area, chains, tile, band
        self.line = line if line is not None else area
        # along: the picture's rows run along the street (flagstone courses on a quay's pavement), not across
        self.along = along
        # squares: (polygon, angle, origin): courses straight along the square's main frontage
        self.squares = squares or []
        self.sq_polys = [q[0] for q in self.squares]
        self.edges = Edges(self.line, band) if band > 0 else None
        self.hidden_margin = hidden_margin
        b = np.array([[c.box[0][0], c.box[0][1], c.box[1][0], c.box[1][1]] for c in chains])
        self.cbox = b
        # where a street's rows fan (its uv is not flat): the mesh needs a fine grid there
        cur = []
        for c in chains:
            w = np.maximum(c.hwL, c.hwR) + 1.0
            m = np.abs(c.kap) * w > 0.004
            if m.any():
                q = c.P[m]; r = w[m].max() + 0.5
                cur.append(shapely.buffer(shapely.linestrings(q) if len(q) > 1 else shapely.points(q[0]), r))
        self.curved = shapely.union_all(cur) if cur else shapely.Polygon()

    def classify(self, p):
        """label per point: -1 hidden, 0..M-1 edge course segment (as 1_000_000 + seg), else chain index."""
        D = self.edges.signed(p) if self.edges is not None else np.full(len(p), 1e3)
        lab = np.full(len(p), self.HIDDEN, np.int64)
        # (every visible point off the field is the edge course's, a recess behind the line included; the mesher
        # leaves what is out of sight to the old picture)
        band = D < self.band
        if band.any():
            seg, _ = self.edges.course(p[band]); lab[band] = 1_000_000 + seg
        field = D >= self.band
        for qi, poly in enumerate(self.sq_polys):
            m = field & shapely.contains_xy(poly, p[:, 0], p[:, 1])
            lab[m] = self.SQUARE + qi; field = field & ~m
        if field.any():
            q = p[field]; best = np.full(len(q), -1, np.int64); bestc = np.full(len(q), -1e9)
            near = np.full(len(q), -1, np.int64); nearc = np.full(len(q), -1e9)
            for c in self.chains:
                inb = (q[:, 0] >= c.box[0][0]) & (q[:, 0] <= c.box[1][0]) & (q[:, 1] >= c.box[0][1]) & (q[:, 1] <= c.box[1][1])
                if not inb.any(): continue
                ii = np.nonzero(inb)[0]
                cl, s, t, k = c.claim(q[ii])
                take = (cl >= 0) & (best[ii] < 0)
                best[ii[take]] = c.idx
                better = cl > nearc[ii]
                nearc[ii[better]] = cl[better]; near[ii[better]] = c.idx
            best = np.where(best >= 0, best, near)
            lab[field] = best
        return lab, D

    def uv(self, p, lab, D=None):
        """uv (texture units) for points p laid by patch lab."""
        out = np.zeros((len(p), 2))
        if D is None: D = self.edges.signed(p) if self.edges is not None else np.full(len(p), 1e3)
        sq = lab >= self.SQUARE
        for qi in np.unique(lab[sq]):
            m = lab == qi; poly, ang, o = self.squares[qi - self.SQUARE]
            d = p[m] - o; ca, sa = math.cos(ang), math.sin(ang)
            out[m, 0] = (d[:, 0] * ca + d[:, 1] * sa) / self.tile; out[m, 1] = (-d[:, 0] * sa + d[:, 1] * ca) / self.tile
        h = lab == self.HIDDEN
        out[h] = p[h] / self.tile
        b = (lab >= 1_000_000) & (lab < self.SQUARE)
        if b.any():
            seg = lab[b] - 1_000_000
            a = self.edges.mseg[seg, 0]
            along = self.edges.mu0[seg] + ((p[b] - a) * self.edges.mdir[seg]).sum(1)
            out[b, 0] = along / self.tile; out[b, 1] = D[b] / self.tile
        f = (lab >= 0) & (lab < 1_000_000)
        for ci in np.unique(lab[f]):
            m = lab == ci; c = self.chains[ci]
            s, t, k, hw, i = c.local(p[m])
            U, V = c.uv_m(s, t, k)
            if self.along: U, V = V, -U
            out[m, 0] = U / self.tile; out[m, 1] = V / self.tile
        return out

def find_squares(area, core_half=6.0, min_core=300.0, chains=None):
    """A square: the wide part of a region (what a 12 m box laid along its main frontage still covers), its courses
    straight along that frontage (the longest edge direction, all edges counted modulo a right angle). The strips
    round it (a quay's pavement, the paths round a church) keep their own courses along their line. A small region
    with no street of its own is a square too."""
    from shapely import affinity
    out = []
    for poly in area.geoms:
        e = np.asarray(poly.exterior.coords); d = np.diff(e, axis=0); L = np.hypot(*d.T)
        ang = np.mod(np.arctan2(d[:, 1], d[:, 0]), np.pi / 2)
        hist, edges_ = np.histogram(ang, bins=90, range=(0, np.pi / 2), weights=L)
        k = int(np.argmax(np.convolve(np.r_[hist[-2:], hist, hist[:2]], np.ones(5), 'valid')))
        m = (ang >= edges_[max(k - 2, 0)]) & (ang <= edges_[min(k + 3, 90)])
        th = float(np.average(ang[m], weights=L[m])) if m.any() else float(edges_[k])
        best = max(range(len(d)), key=lambda i: L[i])
        # of the frontage's two right-angled ways, the courses keep the one nearer the old picture's (world x): a
        # square that is square to the world (the Grote Markt along the town hall, the Vismarkt along the quay)
        # keeps its courses; an oblique one turns to its own frontage
        if abs(math.cos(th)) < abs(math.sin(th)): th -= math.pi / 2
        o = (0.0, 0.0)
        r = affinity.rotate(poly, -th, origin=o, use_radians=True)
        core = r.buffer(-core_half, join_style='mitre').buffer(core_half, join_style='mitre').intersection(r)
        core = affinity.rotate(core, th, origin=o, use_radians=True)
        has_chain = chains is not None and any(poly.buffer(-0.5).intersects(LineString(c.P)) for c in chains if len(c.P) > 1)
        if not has_chain:
            out.append((poly, th, np.asarray(e[best]))); continue
        for g in getattr(core, 'geoms', [core]):
            if g.geom_type == 'Polygon' and g.area >= min_core:
                g = g.simplify(0.01)
                out.append((g, th, np.asarray(e[best])))
    return out
