"""The ocean ships (B1, 2026-10-11, docs/boats.md): the brig Anna Maria, the topsail schooner, the Norwegian timber
barque, the German grain barque (and under sail), the British collier, the Belgian line steamer and the liner
Kempenland.

Every ship is built by one function at three levels of detail through a Ship: 0 the model, 1 its far copy (about a
fifth of the triangles, drawn past 60 m) and 2 the farthest (under a tenth, past 150 m: the liner, the barques and the
steamers). The model also gets its walk deck (`_walk`: decks and hatch tops as triangles), its blocks (`_block`: boxes
for masts, houses, hatches, winches) and its name zones (`_name_bow_p`, `_name_bow_s`, `_name_stern`: strips that
follow the planking, u 0..1 from the reader's left, facing out). Names are never painted on: the game points each zone
at the vessel's cell of the names atlas (W5). The water cap follows the rail as before (common.py cap_object).

Lengths, beams and keels are the game's (docs/boats.md "Sizes"); the brig keeps her deck at 2.4 m and her gangway
port (rijnkaai.ts DECK and RAMP). Shapes after the ships of the 1860s and 70s; nothing copied, all our own.
"""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ the ship kit


class Ship:
    """One build of a ship: its mesh, and with the model (d 0) the walk deck, the blocks and the name zones."""

    def __init__(self, d=0):
        self.d = d
        self.m = Mesh(ao=0.0)
        self.walk = Mesh(ao=0.0) if d == 0 else None
        self.block = Mesh(ao=0.0) if d == 0 else None
        self.zones, self.sizes = {}, {}
        self.rects = []

    @property
    def fine(self):
        return self.d == 0

    @property
    def near(self):
        return self.d <= 1

    def n(self, k):
        """Sides of a round part: k in the model, fewer far off."""
        return (k, max(4, (k + 1) // 2), max(3, k // 3))[self.d]

    def spar(self, a, b, r0, r1, mat=DARK, sides=8, cap=False):
        spar(self.m, a, b, r0, r1, mat, sides=self.n(sides), cap=cap)

    def blk(self, c, size):
        if self.block is not None:
            self.block.box(c, size, DARK)
            self.rects.append((c[0] - size[0] / 2, c[0] + size[0] / 2, c[1] - size[1] / 2, c[1] + size[1] / 2,
                               c[2] - size[2] / 2, c[2] + size[2] / 2))

    def obstacles(self, rect, z):
        """The blocks standing on a deck at height z inside rect [x0, x1, y0, y1] (for the brig's deck extra)."""
        out = []
        for x0, x1, y0, y1, z0, z1 in self.rects:
            if z1 < z + 0.15 or z0 > z + 1.6 or x1 < rect[0] or x0 > rect[1] or y1 < rect[2] or y0 > rect[3]:
                continue
            out.append([round(x0, 3), round(x1, 3), round(y0, 3), round(y1, 3)])
        return out

    def wlk(self, pts):
        if self.walk is not None:
            self.walk.poly(pts, DECK, out=(0, 0, 1))

    def finish(self, build, levels=1):
        """The model's children (docs/boats.md, build_boats.py hull_parts reads m.children): walk, block, the name
        zones and the far copy built by `build(1)`."""
        m = self.m
        if self.d:
            return m
        parts = {"walk": self.walk, "block": self.block}
        for k, z in self.zones.items():
            parts["name_" + k] = z
        f = build(1)
        f.lines, f.smoke, f.extras = [], [], {}
        parts["far"] = f
        m.children = parts
        m.extras["name_zones"] = self.sizes
        return m


def dense(n, must=()):
    """Hull stations 0..1, closer together toward the ends; the stations in `must` are kept exactly."""
    ts = []
    for i in range(n + 1):
        x = i / n
        ts.append(0.45 * x + 0.55 * (0.5 - 0.5 * math.cos(math.pi * x)))
    for t in must:
        ts = [s for s in ts if abs(s - t) > 0.006 or s in (0.0, 1.0)]
    return sorted(set(round(t, 5) for t in ts + list(must)))


def loft(S, L, must, levels, mats, hb, yfn, shade, keep, skip=None, n=(46, 18, 9)):
    """The hull at S's detail: `keep` gives the levels kept far off (indices into levels, first and last included)."""
    ts = dense(n[S.d], must)
    if S.d:
        k = keep[min(S.d, len(keep)) - 1]
        levels, mats = [levels[i] for i in k], [mats[i] for i in k[:-1]]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=shade)
    hull.outer(S.m, skip=skip if S.fine else None)
    return hull


def along(hull, zfn, t0, t1, step, first=0.5, n=400):
    """Stations from t0 to t1 every `step` metres along the side at height zfn(t) (the first half a step in)."""
    ts = [t0 + (t1 - t0) * i / n for i in range(n + 1)]
    pts = [hull.P(t, zfn(t), 1) for t in ts]
    out, acc, nxt = [], 0.0, step * first
    for i in range(1, n + 1):
        d = (pts[i] - pts[i - 1]).length
        while acc + d >= nxt and d > 0:
            out.append(ts[i - 1] + (ts[i] - ts[i - 1]) * (nxt - acc) / d)
            nxt += step
        acc += d
    return out


def frame_at(hull, t, z, sx, e=0.003):
    """The side's tangent (toward the bow end), up direction and outward normal at (t, z)."""
    tan = (hull.P(min(1.0, t + e), z, sx) - hull.P(max(0.0, t - e), z, sx))
    if tan.length < 1e-6:
        tan = V(0, -1, 0)
    tan.normalize()
    up = (hull.P(t, z + 0.15, sx) - hull.P(t, z - 0.15, sx)).normalized()
    nrm = tan.cross(up).normalized()
    if nrm.x * sx < 0:
        nrm = -nrm
    return tan, up, nrm


def deck(S, hull, zfn, t0, t1, inset=0.1, mat=DECK, walk=True):
    hull.deck(S.m, zfn, t0, t1, inset, mat)
    if walk and S.walk is not None:
        T = hull.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            a, b = hull.P(ta, zfn(ta), 1, inset + 0.05), hull.P(tb, zfn(tb), 1, inset + 0.05)
            S.wlk([mirror(a, -1), a, b, mirror(b, -1)])


def bulwark(S, hull, zlo, ztop, t0, t1, thick=0.14, inner=WHITE, cap=DARK, step=1.15, skip=None, end0=True, end1=False,
            stanch=None):
    """The bulwark's inside from the deck up, a moulded cap rail over it and stanchions inside every `step` m."""
    hull.rail(S.m, zlo, ztop, t0, t1, thick, inner, cap, end0, end1, skip=skip)
    if S.d == 2:
        return
    T = hull.span(t0, t1)
    up, dn = V(0, 0, 0.09), V(0, 0, -0.035)
    for ta, tb in zip(T, T[1:]):
        for sx in (1, -1):
            if skip and skip(sx, -1, ta, tb):
                continue
            oa, ob = hull.P(ta, ztop(ta), sx, -0.05), hull.P(tb, ztop(tb), sx, -0.05)
            ia, ib = hull.P(ta, ztop(ta), sx, thick + 0.05), hull.P(tb, ztop(tb), sx, thick + 0.05)
            q = [oa + up, ob + up, ib + up, ia + up]
            S.m.poly(q, cap, out=(0, 0, 1), uvs=[(-p.y / 1.2, p.x / 1.2) for p in q])
            for a, b, o in ((oa, ob, sx), (ia, ib, -sx)):
                q = [a + dn, b + dn, b + up, a + up]
                S.m.poly(q, cap, out=(o, 0, 0), shade=0.8, uvs=[(-p.y / 1.2, p.z / 1.2) for p in q])
            q = [oa + dn, ob + dn, ib + dn, ia + dn]
            S.m.poly(q, cap, out=(0, 0, -1), shade=0.5, uvs=[(-p.y / 1.2, p.x / 1.2) for p in q])
    for t, on in ((t0, end0), (t1, end1)):
        if on and hull.hb(t, ztop(t)) > 0.3:
            z = ztop(t)
            S.m.beam(hull.P(t, z, 1, thick / 2) + V(0, 0, 0.03), hull.P(t, z, -1, thick / 2) + V(0, 0, 0.03), 0.12,
                     thick + 0.1, cap, side=(0, 0, 1))
    if S.fine and step:
        for t in along(hull, ztop, t0, t1, step):
            for sx in (1, -1):
                if skip and skip(sx, -1, t - 1e-4, t + 1e-4):
                    continue
                if stanch and not stanch(t, sx):
                    continue
                tan, _, _ = frame_at(hull, t, ztop(t), sx)
                a = hull.P(t, zlo(t) + 0.01, sx, thick + 0.065)
                b = hull.P(t, ztop(t) - 0.03, sx, thick + 0.065)
                S.m.beam(a, b, 0.13, 0.1, inner, side=tan, shade=0.85, caps=False)


def side_quads(S, hull, ts, zc, w, h, mat, off=0.012, sides=(1, -1), shade=1.0):
    """Flat pictures laid on the side (painted ports, port lids, scuttles) at stations ts."""
    for t in ts:
        for sx in sides:
            tan, up, nrm = frame_at(hull, t, zc, sx)
            c = hull.P(t, zc, sx) + nrm * off
            q = [c - tan * w / 2 - up * h / 2, c + tan * w / 2 - up * h / 2, c + tan * w / 2 + up * h / 2, c - tan * w / 2 + up * h / 2]
            S.m.poly(q, mat, out=nrm, shade=shade, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])


def _arc(pts):
    acc = [0.0]
    for a, b in zip(pts, pts[1:]):
        acc.append(acc[-1] + (b - a).length)
    return acc


def _at(pts, acc, a):
    a = cl(a, 0.0, acc[-1])
    for i in range(1, len(acc)):
        if acc[i] >= a:
            f = (a - acc[i - 1]) / max(acc[i] - acc[i - 1], 1e-9)
            return pts[i - 1].lerp(pts[i], f), (pts[i] - pts[i - 1]).normalized()
    return pts[-1], (pts[-1] - pts[-2]).normalized()


# the name zones are drawn as a dark board until the game points them at the names atlas (W5)
ZONE = DARK


def _strip(mesh, rows, nrms, mat, off, shade=1.0):
    """Quads between rows of points (bottom row first, each from the reader's left), pushed out along nrms (one a
    column); u by arc length along the middle row, v 0 at the bottom row to 1 at the top."""
    mid = rows[len(rows) // 2]
    acc = _arc(mid)
    nv = len(rows) - 1
    for r in range(nv):
        bot, top = rows[r], rows[r + 1]
        for i in range(len(bot) - 1):
            q = [bot[i] + nrms[i] * off, bot[i + 1] + nrms[i + 1] * off, top[i + 1] + nrms[i + 1] * off, top[i] + nrms[i] * off]
            u0, u1 = acc[i] / acc[-1], acc[i + 1] / acc[-1]
            v0, v1 = r / nv, (r + 1) / nv
            mesh.poly(q, mat, out=nrms[i] + nrms[i + 1], shade=shade, uvs=[(u0, v0), (u1, v0), (u1, v1), (u0, v1)])


def _nv(h):
    return max(2, int(math.ceil(h / 0.16)))


def side_zone(S, hull, key, sx, tc, zc, w, h, off=0.03, n=6, board=None):
    """A name zone on the side, centred at (tc, zc), w m along the planking and h high: a strip of quads that follows
    the planking. With `board`: a painted board (that material, a gilt edge) behind it in the model."""
    ts = [i / 400 for i in range(401)]
    mid = [hull.P(t, zc, sx) for t in ts]
    acc = _arc(mid)
    i = min(range(len(ts)), key=lambda j: abs(ts[j] - tc))

    def t_at(a):
        a = cl(a, 0.0, acc[-1])
        for j in range(1, len(acc)):
            if acc[j] >= a:
                return ts[j - 1] + (ts[j] - ts[j - 1]) * (a - acc[j - 1]) / max(acc[j] - acc[j - 1], 1e-9)
        return 1.0

    def rows(ww, hh):
        tt = [t_at(acc[i] - ww / 2 + ww * k / n) for k in range(n + 1)]
        nv = _nv(hh)
        out = [[hull.P(t, zc - hh / 2 + hh * r / nv, sx) for t in tt] for r in range(nv + 1)]
        nr = [frame_at(hull, t, zc, sx)[2] for t in tt]
        if sx > 0:  # the port side reads from the bow (high t) aft
            out, nr = [row[::-1] for row in out], nr[::-1]
        return out, nr

    if board is not None and S.near:
        rs, nr = rows(w * 1.08, h * 1.4)
        _strip(S.m, rs, nr, board, off * 0.5)
        if S.fine:
            for row in (rs[0], rs[-1]):
                S.m.tube([p + q * (off * 0.8) for p, q in zip(row, nr)], [0.022] * len(row), 4, VARNISH, smooth=False)
    if S.fine:
        z = Mesh(ao=0.0)
        _strip(z, *rows(w, h), ZONE, off, shade=0.32)
        S.zones[key] = z
        S.sizes[key] = [round(w, 2), round(h, 2)]


def stern_zone(S, hull, key, zc, w, h, tmax=0.1, off=0.035, n=10, board=TAR, scroll=True):
    """The name and port on the stern: a strip round the transom or counter at height zc, w along it, h high,
    on a painted board with a gilt edge and carved scrolls at its ends."""

    def curve(z):
        k = 60
        pts = [hull.P(tmax * (1 - j / k), z, 1) for j in range(k + 1)] + [hull.P(tmax * j / k, z, -1) for j in range(k + 1)]
        return pts, _arc(pts)

    def rows(ww, hh):
        nv = _nv(hh)
        out = []
        for r in range(nv + 1):
            pts, acc = curve(zc - hh / 2 + hh * r / nv)
            c = acc[-1] / 2
            out.append([_at(pts, acc, c - ww / 2 + ww * k / n) for k in range(n + 1)])
        nr = []
        for (p, tg), (q, _) in zip(out[0], out[-1]):
            nm = tg.cross((q - p).normalized()).normalized()
            if nm.y < 0:
                nm = -nm
            nr.append(nm)
        return [[p for p, _ in row] for row in out], nr

    if S.near and board is not None:
        rs, nr = rows(w * 1.06, h * 1.3)
        _strip(S.m, rs, nr, board, off * 0.5)
        b, t_ = rs[0], rs[-1]
        if S.fine:
            for row in (b, t_):
                S.m.tube([p + q * (off * 0.8) for p, q in zip(row, nr)], [0.026] * len(row), 4, VARNISH, smooth=False)
            if scroll:
                for j, k in ((0, 1), (-1, -2)):
                    p = (b[j] + t_[j]) / 2 + nr[j] * off
                    ab = (b[j] - b[k]).normalized()
                    upv = (t_[j] - b[j]).normalized()
                    ring = [p + ab * (0.1 + 0.1 * math.cos(a)) + upv * (h * 0.45 * math.sin(a)) for a in
                            [2 * math.pi * q / 8 for q in range(8)]]
                    S.m.tube(ring, [0.045] * 8, 4, VARNISH, closed_path=True, smooth=False, side=nr[j])
    if S.fine:
        z = Mesh(ao=0.0)
        _strip(z, *rows(w, h), ZONE, off, shade=0.32)
        S.zones[key] = z
        S.sizes[key] = [round(w, 2), round(h, 2)]


# ---- deck fittings


def hatch(S, c, w, l, h=0.6, cover=TARP, coaming=DARK, walk=True):
    """A hatch: its coaming, and the tarpaulin over the boards, its flaps down the sides, battened and wedged."""
    x, y, z = c
    S.m.box((x, y, z + h / 2), (w, l, h), coaming, shade=0.9, skip=("+z",) if cover else ())
    top = z + h
    if cover:
        cr = 0.07
        a, b = V(x - w / 2 - 0.03, 0, top), V(x + w / 2 + 0.03, 0, top)
        ridge = V(x, 0, top + cr)
        for p0, p1 in ((a, ridge), (ridge, b)):
            q = [V(p0.x, y - l / 2 - 0.03, p0.z), V(p1.x, y - l / 2 - 0.03, p1.z), V(p1.x, y + l / 2 + 0.03, p1.z),
                 V(p0.x, y + l / 2 + 0.03, p0.z)]
            S.m.poly(q, cover, out=(0, 0, 1), uvs=[(p.x / 1.5, p.y / 1.5) for p in q])
        if S.near:
            fl = 0.2
            for sx in (1, -1):
                xx = x + sx * (w / 2 + 0.03)
                q = [V(xx, y - l / 2 - 0.03, top - fl), V(xx, y + l / 2 + 0.03, top - fl), V(xx, y + l / 2 + 0.03, top),
                     V(xx, y - l / 2 - 0.03, top)]
                S.m.poly(q, cover, out=(sx, 0, 0), shade=0.85, uvs=[(p.y / 1.5, p.z / 1.5) for p in q])
            for sy in (1, -1):
                yy = y + sy * (l / 2 + 0.03)
                q = [V(x - w / 2 - 0.03, yy, top - fl), V(x + w / 2 + 0.03, yy, top - fl), V(x + w / 2 + 0.03, yy, top),
                     V(x - w / 2 - 0.03, yy, top)]
                S.m.poly(q, cover, out=(0, sy, 0), shade=0.85, uvs=[(p.x / 1.5, p.z / 1.5) for p in q])
        if S.fine:
            # battens round the coaming, cleats and wedges, a locking bar across
            for sx in (1, -1):
                S.m.box((x + sx * (w / 2 + 0.06), y, top - 0.12), (0.03, l, 0.07), IRON)
                for k in range(max(2, int(l / 0.7))):
                    yy = y - l / 2 + (k + 0.5) * l / max(2, int(l / 0.7))
                    S.m.box((x + sx * (w / 2 + 0.09), yy, top - 0.13), (0.06, 0.12, 0.09), WOOD, shade=0.8)
            for sy in (1, -1):
                S.m.box((x, y + sy * (l / 2 + 0.06), top - 0.12), (w, 0.03, 0.07), IRON)
            for f in (0.3, 0.7):
                S.m.box((x, y - l / 2 + l * f, top + cr + 0.02), (w + 0.12, 0.08, 0.04), IRON)
    S.blk((x, y, z + h / 2), (w + 0.2, l + 0.2, h))
    if walk:
        S.wlk([V(x - w / 2, y - l / 2, top + 0.03), V(x + w / 2, y - l / 2, top + 0.03), V(x + w / 2, y + l / 2, top + 0.03),
               V(x - w / 2, y + l / 2, top + 0.03)])


def capstan(S, c, r=0.42, h=1.0, mat=DARK):
    with S.m.at(move(*c)):
        S.m.lathe([(r * 1.25, 0.0), (r * 1.2, 0.1), (r * 0.72, 0.2), (r * 0.62, h * 0.66), (r * 1.08, h * 0.74), (r * 1.08, h * 0.9),
                   (r * 0.9, h * 0.95), (r * 0.3, h)], S.n(12), mat, smooth=False, cap1=True, urep=2)
        if S.fine:
            for k in range(8):
                a = 2 * math.pi * k / 8
                d = V(math.cos(a), math.sin(a), 0)
                S.m.beam(d * (r * 0.62) + V(0, 0, 0.22), d * (r * 0.62) + V(0, 0, h * 0.64), 0.1, 0.12, mat,
                         side=V(-d.y, d.x, 0), caps=False, w2=0.1, h2=0.05)
                q = [d * (r * 1.085) + V(0, 0, h * 0.78) + V(-d.y, d.x, 0) * s * 0.06 for s in (-1, 1)]
                S.m.poly([q[0], q[1], q[1] + V(0, 0, 0.1), q[0] + V(0, 0, 0.1)], TAR, out=d, shade=0.4)
    S.blk((c[0], c[1], c[2] + h / 2), (2 * r + 0.3, 2 * r + 0.3, h))


def windlass_gear(S, x, y, z, w=2.0, r=0.24):
    """The anchor windlass: its barrel between the carrick bitts, the pawl bitt in the middle, the pump-brake
    levers over it."""
    windlass(S.m, x, y, z, w=w, r=r)
    if S.near:
        S.m.box((x, y + 0.05, z + 0.25), (0.3, 0.32, 1.3), DARK)
    if S.fine:
        top = V(x, y + 0.05, z + 0.95)
        for sx in (1, -1):
            S.m.beam(top + V(sx * 0.2, 0, 0), top + V(sx * 1.1, 0.0, -0.35), 0.08, 0.08, DARK, side=(0, 1, 0))
            S.m.beam(top + V(sx * 1.1, 0.0, -0.35), top + V(sx * 1.1, -1.1, -0.15), 0.06, 0.06, DARK, side=(1, 0, 0))
        S.m.beam(V(x - w / 2 - 0.1, y - 0.15, z - 0.5), V(x + w / 2 + 0.1, y - 0.15, z - 0.5), 0.12, 0.12, DARK)
    S.blk((x, y, z), (w + 0.5, 0.9, 1.1))


def brake_pump(S, c, gap=0.8):
    """A pair of ship's pumps with the brake (the handle that works them) across."""
    x, y, z = c
    for dx in (-gap / 2, gap / 2):
        with S.m.at(move(x + dx, y, z)):
            S.m.lathe([(0.16, 0.0), (0.14, 0.06), (0.13, 1.0), (0.17, 1.05), (0.15, 1.15)], S.n(8), IRON, smooth=False,
                      cap1=True)
        if S.fine:
            S.m.beam(V(x + dx, y, z + 0.85), V(x + dx, y - 0.32, z + 0.82), 0.06, 0.06, IRON)
    if S.near:
        S.m.box((x, y + 0.05, z + 0.75), (0.16, 0.16, 1.5), DARK)
        S.m.beam(V(x - 1.3, y + 0.05, z + 1.45), V(x + 1.3, y + 0.05, z + 1.45), 0.07, 0.07, DARK)
    S.blk((x, y, z + 0.7), (gap + 0.6, 0.6, 1.4))


def windmill_pump(S, c, yaw=0.0):
    """The Norwegian timber ship's windmill pump: a frame on deck, four canvas sails on their arms, a vane behind."""
    x, y, z = c
    H = 4.2
    for dx, dy in ((-0.35, -0.35), (0.35, -0.35), (0.35, 0.35), (-0.35, 0.35)):
        S.m.beam(V(x + dx, y + dy, z), V(x + dx * 0.3, y + dy * 0.3, z + H), 0.09, 0.09, DARK)
    if S.fine:
        for zz in (1.2, 2.6):
            f = 1 - 0.7 * zz / H
            for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
                S.m.beam(V(x + ax * 0.35 * f, y + ay * 0.35 * f, z + zz), V(x + bx * 0.35 * f, y + by * 0.35 * f, z + zz), 0.05,
                         0.05, DARK)
    hub = V(x, y - 0.35, z + H)
    S.m.box(V(x, y, z + H), (0.3, 0.7, 0.3), DARK)
    for k in range(4):
        a = math.pi / 4 + math.pi / 2 * k + yaw
        d = V(math.cos(a), 0, math.sin(a))
        s = V(-math.sin(a), 0, math.cos(a))
        S.m.beam(hub, hub + d * 1.9, 0.06, 0.06, DARK, side=(0, 1, 0))
        q = [hub + d * 0.5, hub + d * 1.9, hub + d * 1.9 + s * 0.55 + V(0, 0.06, 0), hub + d * 0.5 + s * 0.4 + V(0, 0.06, 0)]
        S.m.poly(q, CANVAS, uvs=[(0, 0), (1, 0), (1, 0.4), (0, 0.4)])
    tail = V(x, y + 1.6, z + H)
    S.m.beam(V(x, y, z + H), tail, 0.05, 0.05, DARK)
    S.m.poly([tail + V(0, 0, -0.4), tail + V(0, 0.6, -0.3), tail + V(0, 0.6, 0.35), tail + V(0, 0, 0.45)], WOOD)
    if S.fine:
        S.m.beam(V(x, y, z + 1.1), V(x, y, z + H), 0.04, 0.04, IRON)
    S.blk((x, y, z + 1.0), (0.9, 0.9, 2.0))


def helm(S, x, y, z, r=0.55, box=True):
    """The wheel with its steering gear box behind it and the binnacle before it."""
    if box:
        S.m.box((x, y + 0.25, z + 0.45), (1.0, 0.6, 0.9), DARK, shade=0.9)
        if S.near:
            S.m.box((x, y + 0.25, z + 0.92), (1.06, 0.66, 0.06), VARNISH)
    if S.near:
        S.m.box((x, y - 0.12, z + 0.55), (0.18, 0.18, 1.1), DARK)
        wheel_helm(S.m, V(x, y - 0.25, z + 0.55 + r + 0.05), r)
        if S.fine:
            for k in range(8):
                a = 2 * math.pi * (k + 0.5) / 8
                d = V(math.cos(a), 0, math.sin(a))
                S.m.beam(V(x, y - 0.25, z + 0.6 + r) + d * (r + 0.02), V(x, y - 0.25, z + 0.6 + r) + d * (r + 0.2), 0.035, 0.035,
                         VARNISH, side=(0, 1, 0))
    with S.m.at(move(x, y - 1.3, z)):
        S.m.lathe([(0.22, 0.0), (0.17, 0.1), (0.14, 0.9), (0.24, 1.0), (0.26, 1.15), (0.22, 1.3), (0.06, 1.38)], S.n(10), VARNISH,
                  smooth=False, cap1=True)
    S.blk((x, y - 0.4, z + 0.6), (1.2, 2.3, 1.2))


def skylight(S, c, w, l, h=0.55, frame=VARNISH):
    """A skylight: its trunk, the glazed lids sloping either side, brass bars over the glass."""
    x, y, z = c
    S.m.box((x, y, z + h / 2), (w, l, h), frame, skip=("+z",))
    ridge = z + h + 0.3
    for sx in (1, -1):
        q = [V(x + sx * w / 2, y - l / 2, z + h), V(x, y - l / 2, ridge), V(x, y + l / 2, ridge), V(x + sx * w / 2, y + l / 2, z + h)]
        S.m.poly(q, WINDOW, out=(sx, 0, 1), uvs=[(0, 0), (0, 1), (2, 1), (2, 0)])
        if S.fine:
            for k in range(1, 5):
                a = q[0].lerp(q[3], k / 5)
                b = q[1].lerp(q[2], k / 5)
                S.m.beam(a + V(sx * 0.01, 0, 0.012), b + V(0, 0, 0.012), 0.02, 0.02, IRON, side=(0, 1, 0))
    for sy in (1, -1):
        S.m.poly([V(x - w / 2, y + sy * l / 2, z + h), V(x + w / 2, y + sy * l / 2, z + h), V(x, y + sy * l / 2, ridge)], frame,
                 out=(0, sy, 0))
    S.blk((x, y, z + h / 2), (w + 0.2, l + 0.2, h + 0.3))


def companion(S, c, w=0.9, l=1.1, h=0.9, mat=VARNISH, face=-1):
    """A companion hatchway: a hood with a sliding top, its doors toward `face` (-1 forward)."""
    x, y, z = c
    S.m.box((x, y, z + h / 2), (w, l, h), mat)
    S.m.box((x, y + face * 0.1, z + h + 0.05), (w + 0.08, l * 0.7, 0.08), DARK)
    panel(S.m, (x, y + face * l / 2, z + h * 0.45), (-face, 0, 0), (0, 0, 1), w * 0.7, h * 0.8, DARK, off=0.015)
    S.blk((x, y, z + h / 2), (w + 0.2, l + 0.2, h))


def deckhouse(S, x0, x1, y0, y1, z0, z1, wall=WHITE, roof=DECK, trim=VARNISH, windows=(), door=None, roof_rise=0.12, walk=False):
    house(S.m, x0, x1, y0, y1, z0, z1, wall=wall, roof=roof, over=0.12, windows=windows if S.near else (),
          door=door if S.near else None, roof_rise=roof_rise if S.near else 0.0)
    if S.fine and trim is not None:
        for xx in (x0, x1):
            for yy in (y0, y1):
                S.m.box((xx, yy, (z0 + z1) / 2), (0.09, 0.09, z1 - z0), trim)
        for xx, yy, ww, ll in (((x0 + x1) / 2, y0, x1 - x0, 0.06), ((x0 + x1) / 2, y1, x1 - x0, 0.06), (x0, (y0 + y1) / 2, 0.06, y1 - y0),
                               (x1, (y0 + y1) / 2, 0.06, y1 - y0)):
            S.m.box((xx, yy, z0 + 0.12), (ww + 0.02, ll + 0.02, 0.22), trim, shade=0.8)
            S.m.box((xx, yy, z1 - 0.06), (ww + 0.02, ll + 0.02, 0.1), trim, shade=0.9)
    S.blk(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0 + 0.2, y1 - y0 + 0.2, z1 - z0))
    if walk:
        S.wlk([V(x0, y0, z1 + 0.1), V(x1, y0, z1 + 0.1), V(x1, y1, z1 + 0.1), V(x0, y1, z1 + 0.1)])


def boat_on_chocks(S, c, L, B, D, yaw=0.0, mat=WHITE):
    """A ship's boat under her cover, upright in chocks (on a house top or on skids)."""
    if S.d == 2:
        S.m.box((c[0], c[1], c[2] + D / 2), (B * 0.8, L * 0.9, D), mat)
        return
    ships_boat(S.m, c, L, B, D, yaw=yaw, mat=mat, cover=CANVAS)
    if S.fine:
        for dy in (-L * 0.28, L * 0.28):
            S.m.box((c[0], c[1] + dy, c[2] + 0.12), (B * 0.9, 0.18, 0.24), DARK)
        for dy in (-L * 0.15, L * 0.15):
            S.m.line(V(c[0] - B / 2, c[1] + dy, c[2] + D * 0.9), V(c[0] + B / 2, c[1] + dy, c[2] + D * 0.9))


def davit_pair(S, hull, t, zfoot, sx, L, B, D, hang, span=None, mat=WHITE):
    """A boat hung in a pair of curved iron davits over the side at station t."""
    yb = hull.y(t, zfoot)
    xb = sx * (hull.hb(t, zfoot + 1.0) + B / 2 + 0.25)
    span = span or L * 0.72
    boat_on = (xb, yb, zfoot + hang)
    if S.d == 2:
        S.m.box((xb, yb, zfoot + hang + D / 2), (B * 0.8, L * 0.9, D), mat)
        return
    ships_boat(S.m, boat_on, L, B, D, mat=mat, cover=CANVAS)
    for dy in (-span / 2, span / 2):
        base = hull.P(t, zfoot, sx, 0.25) + V(0, dy, 0)
        top = V(xb, yb + dy, zfoot + hang + D + 1.3)
        path = [base, base + V(0, 0, hang + D * 0.7), base.lerp(top, 0.8) + V(0, 0, 0.35), top]
        S.m.tube(path, [0.075, 0.07, 0.06, 0.055], S.n(6), IRON, smooth=False, side=(0, 1, 0))
        S.m.line(top, V(xb, yb + dy * 0.82, zfoot + hang + D * 0.8))
        if S.fine:
            S.m.box(top - V(0, 0, 0.22), (0.12, 0.08, 0.3), WOOD)
    if S.fine:
        for dy in (-span * 0.3, span * 0.3):
            S.m.line(V(xb - sx * B / 2, yb + dy, zfoot + hang + D * 0.6), V(xb + sx * B * 0.1, yb + dy, zfoot + hang - 0.1))


def coils(S, pts, r=0.3):
    if S.fine:
        for p in pts:
            coil(S.m, p, r)


def casks(S, pts, lying=False):
    if S.near:
        for i, p in enumerate(pts):
            barrel_lo(S.m, p, lying=lying, yaw=0.7 * i)
    for p in pts:
        S.blk((p[0], p[1], p[2] + 0.45), (0.75, 0.75, 0.9))


def fife_rail(S, c, w=1.7, d=1.7, h=0.75, pins=True):
    """The rail round a mast's foot, on its stanchions, with belaying pins and the running gear coiled on them."""
    x, y, z = c
    if not S.near:
        return
    for (ax, ay), (bx, by) in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
        S.m.beam(V(x + ax * w / 2, y + ay * d / 2, z + h), V(x + bx * w / 2, y + by * d / 2, z + h), 0.12, 0.08, VARNISH,
                 side=(0, 0, 1))
    for ax, ay in ((-1, -1), (1, -1), (1, 1), (-1, 1), (0, -1), (0, 1)):
        S.m.box((x + ax * w / 2, y + ay * d / 2, z + h / 2), (0.1, 0.1, h), DARK)
    if S.fine and pins:
        for sx in (-1, 1):
            for k in range(5):
                yy = y - d / 2 + (k + 0.5) * d / 5
                S.m.box((x + sx * w / 2, yy, z + h + 0.1), (0.035, 0.035, 0.22), DARK)
        coil(S.m, V(x + w * 0.2, y + d / 2 + 0.35, z), 0.26)
        coil(S.m, V(x - w * 0.25, y - d / 2 - 0.35, z), 0.24)
    S.blk((x, y, z + h / 2), (w + 0.2, d + 0.2, h + 0.3))


def lanterns(S, *a, **k):
    if S.fine:
        lantern(S.m, *a, **k)


# ---- masts and rigging


class Mast:
    """A mast stepped at hull station t: lower mast, topmast and topgallant (a royal pole above), raked aft.
    h1 the top (platform), h2 the topmast crosstrees, h3 the topgallant's head, above the deck zd."""

    def __init__(self, hull, t, zd, h1, h2, h3, rake=0.03, r=0.33, top=(2.6, 1.9), pole=2.4, square=True):
        self.t, self.y, self.zd = t, hull.y(t, zd), zd
        self.h1, self.h2, self.h3 = zd + h1, zd + h2, zd + h3
        self.rake, self.r, self.top_wd, self.pole, self.square = rake, r, top, pole, square
        self.head1, self.head2 = 2.0 * r / 0.33, 1.4 * r / 0.33

    def at(self, z, fwd=0.0):
        return V(0, self.y + self.rake * (z - self.zd) - fwd, z)

    def dt(self, lvl):
        """How far forward of the lower mast's axis each mast stands (the doublings)."""
        return (0.0, self.r * 1.75, self.r * 2.6)[lvl - 1]

    def head(self, lvl):
        """Axis point at the head of the lower mast (1), topmast (2), topgallant (3)."""
        z = (self.h1, self.h2, self.h3)[lvl - 1]
        return self.at(z, self.dt(lvl))

    def build(self, S, hoops=False):
        r, m = self.r, S.m
        S.spar(self.at(self.zd - 0.3), self.at(self.h1 + self.head1), r, r * 0.84, DARK, sides=10)
        S.spar(self.at(self.h1 - 0.1, self.dt(2)), self.at(self.h2 + self.head2, self.dt(2)), r * 0.6, r * 0.45, DARK, sides=8)
        if self.h3 > self.h2 + 1:
            S.spar(self.at(self.h2 - 0.1, self.dt(3)), self.at(self.h3 + self.pole, self.dt(3)), r * 0.36, r * 0.14, DARK,
                   sides=6, cap=True)
            tz = self.h3 + self.pole
            tl = self.at(tz, self.dt(3))
        else:
            tz = self.h2 + self.head2
            tl = self.at(tz, self.dt(2))
        if S.near:
            with m.at(move(*tl)):
                m.lathe([(0.0, 0.0), (r * 0.42, 0.0), (r * 0.42, 0.1), (0.0, 0.12)], S.n(8), DARK, smooth=False)
        # the top: a platform round in front, its rim, the trestletrees and crosstrees under it
        tw, td = self.top_wd
        c = self.at(self.h1)
        pts = []
        for k in range(9):
            a = math.pi * k / 8
            pts.append(c + V(-tw / 2 * math.cos(a), -td * 0.3 - td * 0.42 * math.sin(a), 0))
        pts += [c + V(tw / 2, td * 0.32, 0), c + V(-tw / 2, td * 0.32, 0)]
        m.prism(pts, (0, 0, 0.12), DARK, shade=0.8)
        if S.near:
            for sx in (1, -1):
                m.beam(c + V(sx * r * 0.7, -td * 0.7, -0.1), c + V(sx * r * 0.7, td * 0.4, -0.1), 0.12, 0.18, DARK, side=(1, 0, 0))
            m.box(self.at(self.h1 + self.head1 + 0.12, self.dt(2) / 2), (r * 2.2, self.dt(2) + r * 2.4, 0.26), DARK)
        if S.fine:
            for a, b in zip(pts[:9], pts[1:9]):
                m.beam(a + V(0, 0, 0.12), b + V(0, 0, 0.12), 0.05, 0.12, DARK, side=(0, 0, 1))
            for sx in (1, -1):  # the hounds, cheeks under the trestletrees
                m.box(self.at(self.h1 - 0.7) + V(sx * r * 0.95, 0, 0), (0.12, r * 1.6, 1.2), DARK)
            for z in np.linspace(self.zd + 1.5, self.h1 - 1.6, 5):
                with m.at(move(*self.at(z))):
                    m.lathe([(r * 0.98, -0.04), (r * 1.06, 0.0), (r * 1.06, 0.06), (r * 0.98, 0.1)], 10, IRON, smooth=False)
            if hoops:
                for z in np.linspace(self.zd + 2.0, self.h1 - 1.5, 8):
                    with m.at(move(*self.at(z))):
                        m.lathe([(r * 1.25, -0.04), (r * 1.25, 0.04)], 10, WOOD, smooth=False)
        # the topmast's crosstrees and cap
        c2 = self.at(self.h2, self.dt(2))
        if S.near:
            m.beam(c2 + V(-1.2, -0.1, 0), c2 + V(1.2, -0.1, 0), 0.1, 0.1, DARK, side=(0, 1, 0))
            for sy in (-0.35, 0.35):
                m.beam(c2 + V(-1.1, sy, 0.02), c2 + V(1.1, sy, 0.02), 0.08, 0.08, DARK, side=(0, 1, 0))
            m.box(self.at(self.h2 + self.head2 + 0.1, (self.dt(2) + self.dt(3)) / 2), (r * 1.4, self.dt(3) - self.dt(2) + r * 1.4, 0.2),
                  DARK)
        S.blk(self.at(self.zd + 0.9), (r * 2 + 0.3, r * 2 + 0.3, 1.8))

    def shrouds(self, S, hull, sheer, chain_z, n=(5, 3, 2), aft=True, channel=True):
        """Lower, topmast and topgallant shrouds on both sides, with ratlines; channels, deadeyes and chain plates
        at the foot of the lower ones; futtock shrouds; backstays to the channels' after end."""
        m = S.m
        tw, td = self.top_wd
        for sx in (1, -1):
            w = hull.hb(self.t, chain_z)
            spread = 0.75 * n[0]
            feet = [V(sx * (w + (0.36 if channel else 0.1)), self.y - spread * 0.55 + spread * k / max(1, n[0] - 1), chain_z + 0.55) for k in range(n[0])]
            tops = [self.at(self.h1 - 0.15) + V(sx * self.r * 0.95, 0.25 - 0.5 * k / max(1, n[0] - 1), 0) for k in range(n[0])]
            for a, b in zip(feet, tops):
                m.line(a, b)
            ratlines(m, feet, tops)
            # the channel, deadeyes, chain plates
            if S.near and channel:
                y0, y1 = feet[0].y - 0.6, feet[-1].y + 1.0
                S.m.slab([V(sx * (w - 0.05), y0, chain_z + 0.06), V(sx * (w + 0.5), y0, chain_z + 0.06),
                          V(sx * (w + 0.5), y1, chain_z + 0.06), V(sx * (w - 0.05), y1, chain_z + 0.06)], 0.12, DARK, out=(0, 0, 1))
            if S.fine:
                for p in feet:
                    lo = p - V(0, 0, 0.5)
                    for q in (lo, p):
                        with m.at(move(*q) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
                            m.lathe([(0.0, -0.06), (0.12, -0.06), (0.14, 0.0), (0.12, 0.06), (0.0, 0.06)], 6, DARK, smooth=False)
                    for dz in (-0.04, 0.04):
                        m.line(lo + V(0, -0.05, 0.06), p + V(0, -0.05, -0.06))
                        m.line(lo + V(0, 0.05, 0.06), p + V(0, 0.05, -0.06))
                    ty = hull_t_at(hull, p.y, chain_z)
                    foot = hull.P(ty, chain_z - 1.4, sx)
                    m.beam(lo - V(0, 0, 0.08), foot + V(sx * 0.03, 0, 0), 0.07, 0.025, IRON, side=(0, 1, 0))
            # topmast shrouds from the top's rim, futtock shrouds under it
            rim = [self.at(self.h1 + 0.1) + V(sx * tw * 0.47, -0.55 + 1.1 * k / max(1, n[1] - 1), 0) for k in range(n[1])]
            t2 = [self.head(2) + V(sx * self.r * 0.6, 0.15 - 0.3 * k / max(1, n[1] - 1), -0.6) for k in range(n[1])]
            for a, b in zip(rim, t2):
                m.line(a, b)
                m.line(a, self.at(self.h1 - 1.2) + V(sx * self.r, 0, 0))
            ratlines(m, rim, t2)
            if self.h3 > self.h2 + 1:
                ct = [self.at(self.h2, self.dt(2)) + V(sx * 1.15, -0.1 + 0.2 * k, 0) for k in range(n[2])]
                t3 = [self.head(3) + V(sx * 0.12, 0, -1.5) for _ in range(n[2])]
                for a, b in zip(ct, t3):
                    m.line(a, b)
            # backstays
            if aft:
                for lvl, dy in ((2, 3.2), (3, 4.4)):
                    if lvl == 3 and self.h3 <= self.h2 + 1:
                        continue
                    m.line(self.head(lvl) - V(0, 0, 0.3), V(sx * (w + 0.4), self.y + dy, chain_z + 0.4))


def hull_t_at(hull, y, z):
    """The station t where the hull's side is at y (height z)."""
    lo, hi = 0.0, 1.0
    for _ in range(30):
        mid = (lo + hi) / 2
        if hull.y(mid, z) > y:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


def ratlines(m, feet, tops, gap=0.55):
    """Ratlines across a set of shrouds (from feet to tops), every `gap` metres up."""
    b0, b1, t0, t1 = feet[0], feet[-1], tops[0], tops[-1]
    h = ((b0 + b1) / 2 - (t0 + t1) / 2).length
    k = 1
    while k * gap < h * 0.92:
        f = k * gap / h
        pts = [a.lerp(b, f) for a, b in zip(feet, tops)]
        for a, b in zip(pts, pts[1:]):
            m.line(a, b)
        k += 1


def yard_full(S, c, length, r, furl=0.0, lifts_to=None, foot=True, mat=DARK):
    """A yard across the mast at c: an octagonal spar tapering to its arms, the truss at the middle, the sail furled
    on top (furl: its thickness, 0 none), footropes under it with stirrups, the jackstay along its top, lifts."""
    c = Vector(c)
    m = S.m
    for sx in (1, -1):
        S.spar(c, c + V(sx * length / 2, 0, 0), r, r * 0.45, mat, sides=8)
        if S.fine:
            m.box(c + V(sx * (length / 2 - 0.25), 0, 0), (0.08, r * 1.6, r * 1.6), mat)
    if S.near:
        m.box(c + V(0, 0.18, 0), (r * 3.0, 0.35, r * 2.2), DARK)
    if furl > 0:
        bundle(m, c + V(-length / 2 * 0.86, -0.04, r + furl * 0.45), c + V(length / 2 * 0.86, -0.04, r + furl * 0.45), furl,
               CANVAS, n=6 if S.fine else 3, sides=S.n(6))
    if foot:
        for sx in (1, -1):
            pts = [c + V(sx * (0.6 + (length / 2 - 0.4) * f), 0.25, -0.75 - 0.25 * math.sin(math.pi * f)) for f in
                   np.linspace(0, 1, 5)]
            for a, b in zip(pts, pts[1:]):
                m.line(a, b)
        m.line(c + V(-length / 2 * 0.92, -0.05, r + 0.02), c + V(length / 2 * 0.92, -0.05, r + 0.02))
    if lifts_to is not None:
        for sx in (1, -1):
            m.line(c + V(sx * length / 2 * 0.96, 0, 0), Vector(lifts_to))


def square_sails(S, yards, foot_c, foot_w, belly=0.14):
    """Square sails set and drawing between the yards (lowest first), the course's foot at foot_c."""
    for i, (c, w) in enumerate(yards):
        if i == 0:
            fc, fw = foot_c, foot_w
        else:
            pc, pw = yards[i - 1]
            fc, fw = pc + V(0, -0.1, 0.25), pw
        hgt = c.z - fc.z
        sail(S.m, c + V(-w / 2, -0.15, -0.15), c + V(w / 2, -0.15, -0.15), fc + V(-fw / 2, -0.25, 0), fc + V(fw / 2, -0.25, 0),
             V(0, -belly * hgt, 0), nu=6 if S.fine else 3, nv=4 if S.fine else 2)
        if S.fine:
            for sx in (1, -1):
                S.m.line(fc + V(sx * fw / 2, -0.25, 0), fc + V(sx * fw * 0.3, 0.6, -1.2 if i == 0 else 0))


def figurehead(S, base, look, mat=WHITE, gilt=VARNISH, s=1.0):
    """A figurehead on the stem head at `base`, leaning out along `look` (forward and up): a woman's figure in a
    draped gown, arms folded, on a gilt scroll."""
    m = S.m
    base = Vector(base)
    f = Vector(look).normalized()
    up = V(0, 0, 1)
    side = f.cross(up).normalized()
    up2 = side.cross(f).normalized()

    def P(a, b, c=0.0):
        return base + f * (a * s) + up2 * (b * s) + side * (c * s)

    if not S.near:
        m.beam(P(0, 0), P(1.4, 0.35), 0.3 * s, 0.35 * s, mat)
        return
    body = [P(0.0, -0.05), P(0.35, 0.05), P(0.7, 0.18), P(1.0, 0.28), P(1.22, 0.36), P(1.36, 0.42)]
    rad = [(0.2, 0.24), (0.24, 0.28), (0.18, 0.22), (0.2, 0.22), (0.16, 0.17), (0.07, 0.07)]
    m.tube(body, [(a * s, b * s) for a, b in rad], S.n(8), mat, side=side, smooth=False, cap0=True)
    with m.at(Matrix.Translation(P(1.55, 0.5))):
        m.lathe([(0.0, -0.13 * s), (0.1 * s, -0.11 * s), (0.13 * s, 0.0), (0.1 * s, 0.1 * s), (0.0, 0.14 * s)], S.n(8), mat, smooth=False)
    if S.fine:
        for c in (-1, 1):
            m.tube([P(1.18, 0.38, c * 0.18), P(1.02, 0.42, c * 0.22), P(0.98, 0.48, -c * 0.05)], [0.06 * s, 0.055 * s, 0.05 * s], 5, mat,
                   smooth=False, side=up2)
        m.tube([P(1.42, 0.62), P(1.3, 0.72), P(1.12, 0.6)], [0.09 * s, 0.07 * s, 0.03 * s], 5, gilt, smooth=False, side=side)
    m.tube([P(-0.1, -0.25), P(0.2, -0.3), P(0.45, -0.18), P(0.4, 0.02)], [0.12 * s, 0.13 * s, 0.1 * s, 0.05 * s], S.n(6), gilt,
           smooth=False, side=side)


def head_knee(S, hull, z_lo, z_hi, base, out=1.0, thick=0.32, ground=TAR, gilt=VARNISH):
    """The knee of the head: the cutwater carried forward of the stem from z_lo up under the figurehead at `base`,
    its sides the trailboards (dark, with gilt scrollwork)."""
    base = Vector(base)
    s0, s1 = hull.P(1.0, z_lo, 1), hull.P(1.0, z_hi, 1)
    prof = [V(0, s0.y + 0.05, z_lo), V(0, s1.y + 0.05, z_hi), V(0, base.y + 0.3, base.z + 0.15), V(0, base.y - 0.15, base.z - 0.05),
            V(0, base.y - 0.25 * out, base.z - 0.6), V(0, (s0.y + base.y) / 2 - 0.35 * out, (z_lo + base.z) / 2 - 0.3),
            V(0, s0.y - 0.25, z_lo + 0.15)]
    S.m.prism([p - V(thick / 2, 0, 0) for p in prof], (thick, 0, 0), ground)
    if S.fine:
        for sx in (1, -1):
            path = [prof[0].lerp(prof[1], 0.4), prof[5].lerp(prof[1], 0.3), prof[4].lerp(prof[2], 0.5), prof[3]]
            S.m.tube([p + V(sx * (thick / 2 + 0.01), 0, 0) for p in path], [0.03, 0.04, 0.035, 0.02], 4, gilt, smooth=False,
                     side=(1, 0, 0))
            c = prof[5].lerp(prof[2], 0.45) + V(sx * (thick / 2 + 0.01), 0, 0)
            ring = [c + V(0, 0.2 * math.cos(a), 0.15 * math.sin(a)) for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
            S.m.tube(ring, [0.028] * 8, 3, gilt, closed_path=True, smooth=False, side=(1, 0, 0))



def rudder(S, hull, KZ, ytop_z, chord=0.95, iron=False, thick=0.22):
    """The rudder hung on the sternpost: its blade, the pintles and gudgeons, the rudder head going up into the hull."""
    y0 = hull.y(0.0, KZ + 0.3)
    yt = hull.y(0.0, 0.8)
    pts = [V(0, y0, KZ + 0.25), V(0, y0 + chord, KZ + 0.35), V(0, yt + chord * 0.8, 0.9), V(0, yt, 1.0)]
    S.m.prism([p + V(-thick / 2, 0.02, 0) for p in pts], (thick, 0, 0), IRON if iron else TAR)
    if S.fine:
        for z in np.linspace(KZ + 0.8, 0.6, 4):
            yy = y0 + (yt - y0) * (z - KZ) / (1.0 - KZ)
            S.m.box((0, yy + 0.08, z), (thick + 0.08, 0.35, 0.1), COPPER if not iron else IRON)
    S.m.box((0, yt + 0.12, (1.0 + ytop_z) / 2), (0.3, 0.3, ytop_z - 1.0), DARK)


def screw(S, y, z, R=1.4, hub=0.3):
    """A four-bladed screw on its shaft."""
    with S.m.at(move(0, y, z) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        S.m.lathe([(hub * 0.8, -hub * 1.4), (hub, 0.0), (hub * 0.7, hub * 1.3), (0.0, hub * 1.6)], S.n(10), IRON, smooth=False,
                  cap0=True)
    for k in range(4):
        a = math.pi / 2 * k + 0.4
        d = V(math.cos(a), 0, math.sin(a))
        s = V(-math.sin(a), 0.4, math.cos(a)).normalized()
        c = V(0, y, z)
        if S.near:
            q = [c + d * hub - s * hub * 1.2, c + d * hub + s * hub * 1.3, c + d * R * 0.75 + s * R * 0.34, c + d * R + s * R * 0.08,
                 c + d * R * 0.9 - s * R * 0.18]
            S.m.prism([p - V(0, 0.03, 0) for p in q], (0, 0.06, 0), IRON)
        else:
            S.m.slab([c + d * hub - s * 0.3, c + d * hub + s * 0.3, c + d * R + s * 0.2, c + d * R - s * 0.2], 0.05, IRON, out=(0, -1, 0))


def cowl(S, x, y, z, h, r, face=-1, mat=WHITE):
    """A cowl ventilator: its pipe, the bend and the bell mouth (red inside), turned to face."""
    if not S.near:
        S.m.box((x, y, z + h / 2), (r * 1.4, r * 1.4, h), mat)
        return
    path = [V(x, y, z), V(x, y, z + h * 0.72), V(x, y + face * r * 0.35, z + h * 0.92), V(x, y + face * r * 1.0, z + h + r * 0.3),
            V(x, y + face * r * 1.25, z + h + r * 0.38)]
    S.m.tube(path, [r * 0.62, r * 0.62, r * 0.72, (r * 1.15, r * 1.15), (r * 1.3, r * 1.3)], S.n(10), mat, smooth=False, urep=2,
             vscale=0.5)
    m0 = path[-1]
    S.m.tube([m0 + V(0, -face * 0.02, -0.01), m0 + V(0, -face * 0.35, -0.12)], [r * 1.2, r * 0.5], S.n(10), REDLEAD, smooth=False,
             cap1=True)
    S.blk((x, y, z + h / 2), (r * 1.6, r * 1.6, h))


def funnel(S, x, y, z, R, H, rake, mat=FUNNEL, vmax=1.0, bands=(), top_mat=None, guys=True, deck_pts=None):
    """A raked funnel with its casing ring, the bell top, painted bands (fraction of H, height fraction, material),
    the steam pipe and whistle aft, guys to the deck. Returns the top (smoke) point and a ring point for stays."""
    m = S.m
    M = move(x, y, z) @ Matrix.Rotation(-rake, 4, "X")
    with m.at(M):
        m.lathe([(R, -0.3), (R, H), (R + 0.06, H + 0.04), (R + 0.06, H + 0.22), (R - 0.02, H + 0.26)], S.n(16), mat, urep=2,
                vscale=vmax / H, smooth=False)
        if S.near:
            m.lathe([(R + 0.25, 0.0), (R + 0.22, 0.35), (R + 0.02, 0.5)], S.n(16), IRON, smooth=False)
            for f0, fh, bm in bands:
                m.lathe([(R + 0.015, H * f0), (R + 0.015, H * (f0 + fh))], S.n(16), bm, smooth=False, urep=2)
            if top_mat is not None:
                m.lathe([(R + 0.016, H * 0.86), (R + 0.016, H)], S.n(16), top_mat, smooth=False)
            S.spar(V(0, R + 0.18, 0), V(0, R + 0.18, H + 0.8), 0.11, 0.11, IRON, sides=6, cap=True)
            if S.fine:
                S.spar(V(0, R + 0.18, H * 0.7), V(0, R + 0.18, H * 0.7 + 0.6), 0.08, 0.13, IRON, sides=8, cap=True)
                for f in (0.35, 0.72):
                    m.lathe([(R + 0.035, H * f), (R + 0.035, H * f + 0.08)], 16, IRON, smooth=False)
    top = M @ V(0, 0, H + 0.3)
    ring = M @ V(0, 0, H * 0.74)
    m.smoke.append(top)
    if guys and deck_pts:
        for p in deck_pts:
            m.line(ring, p)
    S.blk((x, y, z + 1.0), (2 * R + 0.6, 2 * R + 0.6, 2.0))
    return top, ring


def steam_winch(S, c, yaw=0.0):
    """A steam winch: two cylinders and the crank shaft on a bedplate, the warping drums at the ends."""
    if not S.near:
        S.m.box((c[0], c[1], c[2] + 0.45), (1.6, 1.0, 0.9), IRON)
        return
    with S.m.at(move(*c) @ rot_z(yaw)):
        S.m.box((0, 0, 0.08), (1.5, 1.0, 0.16), IRON, shade=0.8)
        for sx in (-0.45, 0.45):
            S.m.box((sx, 0.0, 0.5), (0.14, 0.9, 0.7), IRON)
        with S.m.at(Matrix.Translation((0, 0, 0.62)) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
            S.m.lathe([(0.12, -0.9), (0.24, -0.82), (0.24, -0.55), (0.1, -0.5), (0.1, 0.5), (0.24, 0.55), (0.24, 0.82),
                       (0.12, 0.9)], S.n(10), IRON, smooth=False, cap0=True, cap1=True)
            S.m.lathe([(0.3, -0.35), (0.3, 0.35)], S.n(10), DARK, smooth=False)
        if S.fine:
            for dy in (-0.25, 0.25):
                with S.m.at(Matrix.Translation((0.0, dy + 0.3, 0.2))):
                    S.m.lathe([(0.13, 0.0), (0.13, 0.55), (0.15, 0.6), (0.05, 0.65)], 8, IRON, smooth=False, cap1=True)
            S.m.tube([V(0, 0.55, 0.8), V(0, 0.8, 1.1), V(0, 0.8, 1.8)], [0.04, 0.04, 0.04], 5, IRON, smooth=False)
    S.blk((c[0], c[1], c[2] + 0.45), (2.0, 1.2, 0.9))


def pipe_rail(S, pts, h=1.0, step=1.4, mat=IRON):
    """An iron pipe rail on stanchions along a polyline (on a raised deck or a bridge)."""
    pts = [Vector(p) for p in pts]
    for a, b in zip(pts, pts[1:]):
        S.m.line(a + V(0, 0, h), b + V(0, 0, h))
        S.m.line(a + V(0, 0, h * 0.5), b + V(0, 0, h * 0.5))
        n = max(1, int((b - a).length / step))
        for k in range(n + 1):
            p = a.lerp(b, k / n)
            if S.fine:
                S.m.beam(p, p + V(0, 0, h), 0.04, 0.04, mat, caps=False)
            else:
                S.m.line(p, p + V(0, 0, h))


def square_yards(S, mast, spec, furled=True, scale=1.0):
    """The yards of a square-rigged mast. spec: (height over the deck, length, radius, furled sail's thickness, which
    mast it hangs on: 1 lower, 2 top, 3 topgallant). Returns [(centre, width)] for setting sails."""
    out = []
    for i, (h, ln, r, fr, lvl) in enumerate(spec):
        z = mast.zd + h
        fwd = mast.dt(lvl) + mast.r * (1.0, 0.6, 0.36)[lvl - 1] + r + 0.05
        c = mast.at(z, fwd)
        lift = mast.at(z + (1.7 if lvl == 1 else 1.2), mast.dt(lvl))
        yard_full(S, c, ln * scale, r, fr if furled else 0.0, lifts_to=lift if i < len(spec) - 1 else None, foot=lvl < 3 or S.fine)
        out.append((c, ln * scale * 0.92))
    return out


def braces(S, yards, hull, sheer, ts):
    """Braces from each yardarm aft to the rail (one station per yard, or the same for all)."""
    for k, (c, w) in enumerate(yards):
        t = ts[min(k, len(ts) - 1)]
        for sx in (1, -1):
            S.m.line(c + V(sx * w / 2 * 1.04, 0.1, 0), hull.P(t, sheer(t), sx) + V(0, 0, 0.1))


def bowsprit_rig(S, hull, sheer, angle, heel_back, bs_len, jb0, jb1, r_bs=0.3, r_jb=0.17, furled=True, striker=1.9):
    """Bowsprit and jibboom over the stem, its cap, the dolphin striker, bobstays, guys and footropes; jibs furled
    along the boom. Returns (heel, dv, bs_end, jb_start, jb_end)."""
    m = S.m
    stem_top = V(0, hull.y(1.0, sheer(1.0)), sheer(1.0))
    a = math.radians(angle)
    dv = V(0, -math.cos(a), math.sin(a))
    heel = stem_top + V(0, heel_back, -0.3)
    bs_end = heel + dv * bs_len
    S.spar(heel, bs_end, r_bs, r_bs * 0.72, DARK, sides=10)
    jbs, jbe = heel + dv * jb0, heel + dv * jb1
    S.spar(jbs, jbe, r_jb, r_jb * 0.45, DARK, sides=8)
    m.box(bs_end + V(0, 0.12, 0.06), (r_bs * 2.1, r_bs * 1.3, r_bs * 2.4), DARK)
    st = bs_end + V(0, 0.25, -striker)
    S.spar(bs_end + V(0, 0.25, -0.15), st, 0.07, 0.05, DARK, sides=6)
    if S.near:
        m.box(heel + dv * 0.2 + V(0, 0.2, -0.1), (r_bs * 3.2, 0.45, 0.9), DARK)
    if furled:
        bundle(m, heel + dv * (bs_len + 0.8) + V(0, 0, r_jb + 0.06), jbe - dv * 0.8 + V(0, 0, r_jb * 0.8), r_jb + 0.06, CANVAS,
               n=5 if S.fine else 3, sides=S.n(6))
    if S.fine:
        q = Vector(dv).to_track_quat("Z", "Y").to_matrix().to_4x4()
        for k in range(4):
            ring = heel + dv * (1.0 + 0.25 * k)
            with m.at(move(*ring) @ q):
                m.lathe([(r_bs * 1.06, -0.04), (r_bs * 1.06, 0.04)], 8, ROPE, smooth=False)
    for p, q in ((bs_end, V(0, hull.y(1.0, 0.4) + 0.3, 0.4)), (jbe, st), (st, V(0, hull.y(1.0, 1.3) + 0.25, 1.3)),
                 (bs_end - dv * 1.2, V(0, hull.y(1.0, 0.9) + 0.25, 0.9))):
        m.line(p, q)
    for sx in (1, -1):
        m.line(bs_end + V(sx * 0.2, 0, 0), hull.P(0.955, sheer(0.955) - 0.8, sx))
        m.line(jbe, hull.P(0.94, sheer(0.94), sx) + V(sx * 0.4, 0, 0.1))
        pts = [heel + dv * (bs_len * f) + V(sx * 0.45, 0, -0.75) for f in (0.35, 0.65, 1.0)]
        pts += [heel + dv * (jb0 + (jb1 - jb0) * f) + V(sx * 0.4, 0, -0.65) for f in (0.6, 0.9)]
        for a_, b_ in zip(pts, pts[1:]):
            m.line(a_, b_)
    return heel, dv, bs_end, jbs, jbe


def cathead_anchor(S, hull, sheer, t, sx, size=0.85, out=0.55):
    cat = hull.P(t, sheer(t) + 0.2, sx) + V(sx * out, 0, 0)
    S.m.beam(hull.P(t, sheer(t) + 0.1, sx, 0.4), cat, 0.28, 0.28, DARK, side=(0, 1, 0))
    if S.fine:
        S.m.box(cat + V(sx * 0.02, 0, 0.0), (0.06, 0.3, 0.3), IRON)
    with S.m.at(move(cat.x + sx * 0.1, cat.y, cat.z - 0.3)):
        if S.near:
            anchor(S.m, V(0, 0, 0), side=(1, 0, 0), size=size)
        else:
            S.m.beam(V(0, 0, 0), V(0, 0, -1.8 * size), 0.15, 0.15, IRON)
    S.m.line(cat, cat + V(sx * 0.1, 0, -0.3))
    return cat


def flagstaff(S, base, h=4.0, kind="belgian", w=1.7, fh=1.1):
    S.spar(base, base + V(0, 0.35, h), 0.06, 0.04, DARK, sides=6, cap=True)
    flag(S.m, base + V(0, 0.4, h - 0.1), w, fh, along=(0, 1, -0.15), kind=kind)


# ------------------------------------------------------------------ the brig


def brig(d=0):
    """The Anna Maria: a brig of about 38 m (1873), the game's own ship at the Quai Tavernier (Belgian, of Antwerp).
    Black hull with a white band of painted ports and a gilt line, copper below; green bulwarks inside with a
    varnished cap rail. Two masts square-rigged with the sails furled, the brigsail (a gaff and boom on the main)
    brailed up. Her waist is flat (walkable at 2.4 m above the water), a gangway port in the bulwark on her starboard
    side (Blender -x, the quay side as she lies), an open main hatch over a real hold and a cabin aft with a doorway
    and an inside. A woman's figure at the head, carved trailboards, a carved stern board. The walk rectangle and the
    things in the way go in her extra `deck`, as before."""
    S = Ship(d)
    m = S.m
    L, B, KZ, SZ = 38.0, 9.0, -3.0, 3.4

    def keel(t):
        return KZ + 1.1 * sm((t - 0.92) / 0.08) ** 1.5 + 0.25 * sm((0.04 - t) / 0.04)

    def sheer(t):
        return SZ + 1.1 * max(0.0, (t - 0.78) / 0.22) ** 2 + 0.7 * max(0.0, (0.2 - t) / 0.2) ** 2

    SEC = [(0, 0.22), (0.12, 0.7), (0.3, 0.9), (0.55, 0.99), (0.8, 1.0), (1.0, 0.96)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        if t > 0.62:
            f = (t - 0.62) / 0.38
            p = (1 - min(f, 1.0) ** 2) ** (0.7 + 1.0 * (1 - u))
        elif t < 0.3:
            f = (0.3 - t) / 0.3
            p = (1 - min(f, 1.0) ** 2.2) ** (0.5 + 1.4 * (1 - u))
            p = max(p, 0.55 * sm((u - 0.5) / 0.5) * (1 - t / 0.3))
        else:
            p = 1.0
        return max(0.03, B / 2 * table(SEC, u) * p)

    def yfn(t, z):
        u = uz(z)
        return -2.2 * u ** 1.3 * sm((t - 0.9) / 0.1) + 1.4 * u ** 2 * sm((0.06 - t) / 0.06)

    G0, G1 = 0.434, 0.461  # the gangway port (game x -42.5..-41.5 as she lies)
    levels = [keel, lambda t: keel(t) + 0.35, lambda t: keel(t) + 0.85, lambda t: -2.0, lambda t: -1.2, lambda t: -0.5,
              lambda t: 0.25, lambda t: 1.0, lambda t: sheer(t) - 1.5, lambda t: sheer(t) - 0.75, lambda t: sheer(t) - 0.25, sheer]
    mats = [(COPPER, 0)] * 6 + [(TAR, 0), (TAR, 0), (WHITE, 0), (TAR, 0), (TAR, 0)]

    def gap(sx, k, ta, tb):
        return sx < 0 and ta >= G0 - 1e-6 and tb <= G1 + 1e-6 and k in (9, 10, -1)

    hull = loft(S, L, (G0, G1, 0.5, 0.6, 0.07, 0.19), levels, mats, hb, yfn, lambda p: 0.5 + 0.5 * sm((p.z + 2.5) / 5.5),
                [[0, 2, 4, 6, 8, 9, 11]], skip=gap)

    def zd(t):
        return sheer(t) - 1.0

    TH = 0.15
    if S.near:
        hull.wale(m, lambda t: 1.18, 0.02, 0.985, h=0.32, out=0.06, mat=TAR, shade=0.75)
    if S.fine:
        hull.wale(m, lambda t: sheer(t) - 1.47, 0.03, 0.97, h=0.05, out=0.025, mat=VARNISH, shade=1.0)
        # the painted ports along the band (none at the gangway)
        for t in along(hull, lambda t: sheer(t) - 1.12, 0.1, 0.84, 2.05):
            sides = (1,) if G0 - 0.025 < t < G1 + 0.025 else (1, -1)
            side_quads(S, hull, [t], sheer(t) - 1.12, 0.46, 0.44, TAR, sides=sides, shade=0.6)
        # the stem bar
        stem = [hull.P(1.0, z, 1) for z in np.linspace(keel(1.0), sheer(1.0) - 0.1, 7)]
        S.m.tube([V(0, p.y - 0.06, p.z) for p in stem], [(0.14, 0.12)] * 7, 4, COPPER, smooth=False)

    # deck, with the main hatch left open over the hold
    H0, H1, CW = 0.5, 0.6, 1.3
    if S.fine:
        deck(S, hull, zd, 0, H0, 0.12)
        deck(S, hull, zd, H1, 1, 0.12)

        def w(t):
            return hull.hb(t, zd(t)) - 0.12

        Th = hull.span(H0, H1)
        for ta, tb in zip(Th, Th[1:]):
            for sx in (1, -1):
                pts = [V(sx * CW, hull.y(ta, zd(ta)), zd(ta)), V(sx * w(ta), hull.y(ta, zd(ta)), zd(ta)),
                       V(sx * w(tb), hull.y(tb, zd(tb)), zd(tb)), V(sx * CW, hull.y(tb, zd(tb)), zd(tb))]
                m.poly(pts, DECK, out=(0, 0, 1), shade=0.95, uvs=[(-p.y / 1.6, p.x / 1.6) for p in pts])
                S.wlk(pts)
    else:
        deck(S, hull, zd, 0, 1, 0.12)
    bulwark(S, hull, zd, sheer, 0, 1, TH, GREEN, VARNISH, step=1.1, skip=gap)
    # the gangway port: a low sill where the top strake is cut away, and a post each side
    yg0, yg1 = hull.y(G1, zd(G1)), hull.y(G0, zd(G0))
    xg = -(hull.hb(0.447, zd(0.447)) - TH / 2)
    if S.near:
        m.box((xg, (yg0 + yg1) / 2, zd(0.447) + 0.13), (TH, yg1 - yg0, 0.26), DARK)
        for y in (yg0, yg1):
            m.box((xg, y, zd(0.447) + 0.5), (0.22, 0.14, 1.0), VARNISH)
    # the open hatch's coaming, and the hold below: plank walls, a floor, the deck's underside
    ya, yb = hull.y(H0, zd(H0)), hull.y(H1, zd(H1))
    zw = zd(0.55)
    for sx in (1, -1):
        m.box((sx * (CW + 0.075), (ya + yb) / 2, zw + 0.25), (0.15, ya - yb + 0.3, 0.5), DARK)
    for y in (ya + 0.075, yb - 0.075):
        m.box((0, y, zw + 0.25), (2 * CW + 0.3, 0.15, 0.5), DARK)
    zf = KZ + 1.3
    if S.fine:
        hold0, hold1 = H0 - 0.04, H1 + 0.04
        hull.inner(m, [lambda t: zf, lambda t: zd(t) - 0.05], hold0, hold1, 0.25, WOOD, DECK)
        for t0_, t1_, full in ((hold0, H0, True), (H0, H1, False), (H1, hold1, True)):
            T2 = hull.span(t0_, t1_)
            for ta, tb in zip(T2, T2[1:]):
                za, zb_ = zd(ta) - 0.04, zd(tb) - 0.04
                wa, wb = hull.hb(ta, za) - 0.27, hull.hb(tb, zb_) - 0.27
                parts = [(-wa, wa, -wb, wb)] if full else [(CW, wa, CW, wb), (-wa, -CW, -wb, -CW)]
                for a0, a1, b0, b1 in parts:
                    pts = [V(a0, hull.y(ta, za), za), V(a1, hull.y(ta, za), za), V(b1, hull.y(tb, zb_), zb_), V(b0, hull.y(tb, zb_), zb_)]
                    m.poly(pts, DECK, out=(0, 0, -1), shade=0.5, uvs=[(-p.y / 1.6, p.x / 1.6) for p in pts])
        # a ladder down into the hold, dunnage on its floor, the beams under the deck
        ly = ya - 0.4
        for x in (-0.3, 0.3):
            m.beam((x, ly, zf), (x, ly - 0.5, zw), 0.06, 0.08, DARK, side=(1, 0, 0))
        for k in range(1, 8):
            f = k / 8
            rig(m, (-0.3, ly - 0.5 * f, zf + (zw - zf) * f), (0.3, ly - 0.5 * f, zf + (zw - zf) * f), 0.04, WOOD)
        for x in (-1.0, 0.0, 1.0):
            m.box((x, (ya + yb) / 2, zf + 0.03), (0.2, (ya - yb) * 0.9, 0.05), WOOD, shade=0.7)
        for y in (ya + 0.25, yb - 0.25):
            m.box((0, y, zw - 0.18), (2 * (hull.hb(0.55, zw) - 0.3), 0.2, 0.22), WOOD, shade=0.45)
    else:
        m.box((0, (ya + yb) / 2, zw + 0.02), (2 * CW, ya - yb, 0.02), TAR, shade=0.3)
    S.blk((0, (ya + yb) / 2, zw + 0.25), (2 * CW + 0.3, ya - yb + 0.3, 0.5))

    # the cabin aft: walls with a doorway forward, an inside (walls, ceiling), a table and a bunk; a skylight on top
    c0, c1 = 0.07, 0.19
    cy0, cy1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    zb0 = zd(c1) - 0.05
    ztop = zd(c1) + 2.2
    CX, WT = 2.4, 0.12
    hh = ztop - zb0
    if S.fine:
        m.box((0, cy1 - WT / 2, (zb0 + ztop) / 2), (2 * CX, WT, hh), WHITE)
        for sx in (1, -1):
            m.box((sx * (CX - WT / 2), (cy0 + cy1) / 2, (zb0 + ztop) / 2), (WT, cy1 - cy0, hh), WHITE)
        DW, DH = 1.0, 1.95
        for sx in (1, -1):
            m.box((sx * (DW / 2 + (CX - DW / 2) / 2), cy0 + WT / 2, (zb0 + ztop) / 2), (CX - DW / 2, WT, hh), WHITE)
        m.box((0, cy0 + WT / 2, (zb0 + DH + ztop) / 2), (DW, WT, ztop - zb0 - DH), WHITE)
        with m.at(move(-DW / 2, cy0 + WT, zb0) @ rot_z(1.75)):
            m.box((DW / 2, 0.03, DH / 2), (DW, 0.06, DH), VARNISH)
        for sx in (1, -1):
            for f in (0.35, 0.7):
                y = cy0 + (cy1 - cy0) * f
                panel(m, (sx * CX, y, zb0 + 1.45), (0, -sx, 0), (0, 0, 1), 0.5, 0.45, WINDOW, off=0.02)
                panel(m, (sx * (CX - WT), y, zb0 + 1.45), (0, sx, 0), (0, 0, 1), 0.5, 0.45, WINDOW, off=0.02)
        m.box((0, (cy0 + cy1) / 2, zd(0.13) + 0.4), (1.4, 0.9, 0.05), WOOD, shade=0.8)
        for x in (-0.6, 0.6):
            m.box((x, (cy0 + cy1) / 2, zd(0.13) + 0.2), (0.08, 0.08, 0.4), DARK)
        m.box((CX - 0.6, (cy0 + cy1) / 2, zd(0.13) + 0.45), (0.9, cy1 - cy0 - 0.6, 0.12), WOOD, shade=0.8)
        for sx in (1, -1):
            for y in (cy0, cy1):
                m.box((sx * CX, y, (zb0 + ztop) / 2), (0.1, 0.1, hh), VARNISH)
            m.box((sx * CX, (cy0 + cy1) / 2, ztop - 0.06), (0.08, cy1 - cy0, 0.12), VARNISH)
    else:
        m.box((0, (cy0 + cy1) / 2, (zb0 + ztop) / 2), (2 * CX, cy1 - cy0, hh), WHITE, skip=("-z",))
    m.box((0, (cy0 + cy1) / 2, ztop + 0.06), (2 * CX + 0.3, cy1 - cy0 + 0.3, 0.12), DECK, shade=0.85)
    S.blk((0, (cy0 + cy1) / 2, (zb0 + ztop) / 2), (2 * CX + 0.2, cy1 - cy0 + 0.2, hh))
    S.wlk([V(-CX, cy0, ztop + 0.12), V(CX, cy0, ztop + 0.12), V(CX, cy1, ztop + 0.12), V(-CX, cy1, ztop + 0.12)])
    if S.near:
        skylight(S, (0, (cy0 + cy1) / 2 + 0.6, ztop + 0.12), 1.2, 1.1, 0.4)
        chimney(m, -1.5, cy1 - 0.8, ztop + 0.12, 0.7, 0.1)
        if S.fine:
            m.stove(V(-1.5, cy1 - 0.8, ztop + 1.0))
            for sx in (1, -1):  # a rail round the cabin top
                m.line(V(sx * (CX + 0.1), cy0, ztop + 0.9), V(sx * (CX + 0.1), cy1, ztop + 0.9))
                for y in np.linspace(cy0, cy1, 4):
                    m.line(V(sx * (CX + 0.1), y, ztop + 0.12), V(sx * (CX + 0.1), y, ztop + 0.9))

    # masts and rig
    fore = Mast(hull, 0.70, zd(0.70), 12.5, 21.0, 28.0, 0.025, 0.3, top=(2.5, 1.8))
    main = Mast(hull, 0.33, zd(0.33), 13.5, 22.5, 30.0, 0.04, 0.32, top=(2.6, 1.9))
    for mp in (fore, main):
        mp.build(S)
        mp.shrouds(S, hull, sheer, sheer(mp.t) - 0.35, n=(5, 3, 2) if S.fine else (3, 2, 1))
    yards = {}
    for mp, s_ in ((fore, 0.95), (main, 1.0)):
        h1, h2, h3 = mp.h1 - mp.zd, mp.h2 - mp.zd, mp.h3 - mp.zd
        spec = [(h1 - 1.5, 15.5, 0.22, 0.38, 1), (h1 + 0.6, 13.5, 0.18, 0.3, 2), (h1 + (h2 - h1) * 0.55, 12.0, 0.15, 0.26, 2),
                (h2 + 0.9, 9.0, 0.12, 0.2, 3), (h2 + (h3 - h2) * 0.62, 6.5, 0.09, 0.14, 3)]
        yards[mp] = square_yards(S, mp, spec, True, s_)
    braces(S, yards[fore], hull, sheer, [0.42, 0.45, 0.47, 0.33, 0.35])
    braces(S, yards[main], hull, sheer, [0.12, 0.1, 0.08, 0.06, 0.05])
    # the main's gaff and boom (the brig's "brigsail"), brailed up
    g0 = main.at(main.h1 - 1.2)
    g1 = g0 + V(0, 8.0 * math.cos(0.45), 8.0 * math.sin(0.45))
    S.spar(g0, g1, 0.14, 0.09)
    b0 = main.at(main.zd + 3.3)
    b1 = b0 + V(0, 14.0, 0.3)
    S.spar(b0, b1, 0.16, 0.1)
    bundle(m, g0 + V(0, 0.6, -0.3), g1 + V(0, -0.8, -0.3), 0.28, CANVAS, n=5, sides=S.n(6))
    bundle(m, b0 + V(0, 0.8, 0.28), b1 + V(0, -1.2, 0.25), 0.22, CANVAS, n=4, sides=S.n(6))
    if S.near:
        m.box(b1 - V(0, 1.0, 0.95), (0.14, 0.14, 1.6), DARK)  # the boom's crutch
    for a_, b_ in ((g1, b1), (main.head(2) - V(0, 0, 0.5), g1), (main.head(2) - V(0, 0, 0.3), b1), (b1, b1 + V(0, 0.2, -1.0))):
        m.line(a_, b_)
    flag(m, g1 + V(0, 0.05, -0.1), 1.8, 1.2, along=(0, 0.2, -1), kind="belgian")
    flag(m, main.head(3) + V(0, 0, main.pole + 0.95), 1.1, 0.75, along=(0, 1, 0))
    pennant(m, fore.head(3) + V(0, 0, fore.pole + 0.25), 4.0, h=0.3)
    # bowsprit and jibboom with the headsails furled; the figurehead, trailboards, head rails
    heel, dv, bs_end, jbs, jbe = bowsprit_rig(S, hull, sheer, 13, 2.6, 9.0, 6.0, 16.0, 0.3, 0.17)
    fs = [(fore.head(1), heel + dv * 5.0), (fore.head(2), jbs + dv * 4.5), (fore.head(3) - V(0, 0, 1.2), jbe)]
    ms = [(main.head(1), fore.at(fore.zd + 1.2) + V(0, 0.6, 0)), (main.head(2), fore.head(1)), (main.head(3) - V(0, 0, 1.2), fore.head(2))]
    for a_, b_ in fs + ms:
        m.line(a_, b_)
    zf0 = sheer(1.0) - 1.55
    figurehead(S, V(0, hull.y(1.0, zf0) - 0.35, zf0 + 0.05), dv + V(0, -0.3, 0.55), WHITE, VARNISH, 0.95)
    fb = V(0, hull.y(1.0, zf0) - 0.05, zf0)
    head_knee(S, hull, 0.9, zf0 - 0.2, fb, out=0.5)
    if S.near:
        for sx in (1, -1):
            a = hull.P(0.955, sheer(0.955) - 0.35, sx)
            b = V(sx * 0.45, hull.y(1.0, sheer(1.0) - 1.0) - 0.45, sheer(1.0) - 1.1)
            c = V(sx * 0.15, fb.y - 0.2, zf0 + 0.1)
            m.tube([a, b, c], [0.06, 0.055, 0.045], 4, DARK, smooth=False, side=(0, 0, 1))
    # deck fittings: fife rails, windlass, catheads and anchors, capstan, pumps, galley, hatches, wheel, casks, boat
    for mp in (fore, main):
        fife_rail(S, mp.at(mp.zd), 1.6, 1.6)
    windlass_gear(S, 0, hull.y(0.925, zd(0.925)), zd(0.925) + 0.4, w=2.0, r=0.22)
    for sx in (1, -1):
        cathead_anchor(S, hull, sheer, 0.95, sx, 0.8)
    hatch(S, (0, hull.y(0.645, zd(0.645)), zd(0.645)), 2.2, 1.6, 0.55)
    deckhouse(S, -1.0, 1.0, hull.y(0.79, zd(0.79)), hull.y(0.745, zd(0.745)), zd(0.77) - 0.03, zd(0.77) + 1.9, wall=WHITE,
              roof=DARK, windows=[("+x", hull.y(0.77, 0), zd(0.77) + 1.3), ("-x", hull.y(0.77, 0), zd(0.77) + 1.3)],
              door=("+y", 0.0, 0.7, 1.7))
    if S.near:
        chimney(m, 0.5, hull.y(0.77, 0), zd(0.77) + 2.0, 0.8, 0.1)
        if S.fine:
            m.stove(V(0.5, hull.y(0.77, 0), zd(0.77) + 2.95))
    brake_pump(S, (0, main.y + 1.7, zd(0.31)), 0.9)
    capstan(S, (0, hull.y(0.235, zd(0.235)), zd(0.235)), 0.4, 0.95)
    hatch(S, (0, hull.y(0.27, zd(0.27)), zd(0.27)), 1.4, 1.2, 0.5)
    zq = zd(0.035)
    helm(S, 0, hull.y(0.035, zq) - 0.1, zq, 0.5)
    casks(S, [(1.8, hull.y(0.27, zd(0.27)), zd(0.27)), (2.4, hull.y(0.29, zd(0.29)), zd(0.29)), (1.9, hull.y(0.62, zd(0.62)), zd(0.62))])
    if S.fine:
        m.box((-1.9, hull.y(0.2, zd(0.2)) - 1.4, zd(0.2) + 0.35), (0.7, 1.6, 0.7), WOOD)  # the hen coop
    S.blk((-1.9, hull.y(0.2, zd(0.2)) - 1.4, zd(0.2) + 0.35), (0.8, 1.7, 0.7))
    coils(S, [(1.2, hull.y(0.86, zd(0.86)), zd(0.86)), (-1.4, hull.y(0.5, zd(0.5)) + 0.0, zd(0.5)),
              (2.2, hull.y(0.12, zd(0.12)), zd(0.12))], 0.3)
    # a quarter boat in davits on the port side (away from the quay), spare spars along the waist
    davit_pair(S, hull, 0.13, sheer(0.13) - 0.25, 1, 5.2, 1.55, 0.65, 0.4, span=3.6)
    if S.near:
        for x in (2.9, 3.1):
            S.spar(V(x, hull.y(0.38, zd(0.38)), zd(0.38) + 0.15), V(x, hull.y(0.56, zd(0.56)), zd(0.56) + 0.15), 0.1, 0.08, WOOD, sides=6)
    # the stern: windows under the carved board with her name and port, the rudder
    zt0 = sheer(0.0)
    for x in (-0.9, 0.0, 0.9):
        y = hull.y(0.0, zt0 - 1.5)
        dy = (hull.y(0.0, zt0 - 1.2) - hull.y(0.0, zt0 - 1.8)) / 0.6
        panel(m, (x, y, zt0 - 1.5), (-1, 0, 0), V(0, dy, 1).normalized(), 0.45, 0.5, WINDOW, off=0.06)
    stern_zone(S, hull, "stern", zt0 - 0.56, 3.5, 0.62, tmax=0.06)
    rudder(S, hull, KZ, zd(0.0) + 0.5)
    side_zone(S, hull, "bow_p", 1, 0.905, sheer(0.905) - 0.43, 3.2, 0.4)
    side_zone(S, hull, "bow_s", -1, 0.905, sheer(0.905) - 0.43, 3.2, 0.4)
    # where to walk: the flat waist between the cabin and the forecastle
    if S.fine:
        t0w, t1w = 0.21, 0.79
        hw = hull.hb(0.5, zd(0.5)) - 0.25
        rect = [round(-hw, 3), round(hw, 3), round(hull.y(t1w, zd(t1w)), 3), round(hull.y(t0w, zd(t0w)), 3)]
        m.extras["deck"] = {
            "y": round(zd(0.5), 3),
            "rect": rect,
            "obstacles": S.obstacles(rect, zd(0.5)),
            "gangway": [round(-hull.hb(0.447, zd(0.447)), 3), round((yg0 + yg1) / 2, 3)],
        }
    # M7 boats: her riding light on the forestay, lit at night
    lanterns(S, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 3.2), 0)
    return S.finish(brig)


# ------------------------------------------------------------------ the barques


def break_front(S, hull, t, z_lo, z_hi, inset, mat=WHITE, doors=(), windows=(), face=1, trim=VARNISH):
    """The end of a raised deck at station t, looking forward (face -1) or aft (face 1): a bulkhead across the ship
    from z_lo to z_hi, with doors and windows (x positions), a moulding along its top."""
    w0, w1 = hull.hb(t, z_lo) - inset, hull.hb(t, z_hi) - inset
    y = hull.y(t, z_hi)
    fy = face
    pts = [V(-w0, y, z_lo), V(w0, y, z_lo), V(w1, y, z_hi), V(-w1, y, z_hi)]
    S.m.poly(pts, mat, out=(0, fy, 0), shade=0.9, uvs=[(p.x / 1.6, p.z / 1.6) for p in pts])
    if S.near:
        for x in doors:
            panel(S.m, (x, y, z_lo + 0.95), (-fy, 0, 0), (0, 0, 1), 0.75, 1.75, DARK, off=0.02)
        for x in windows:
            panel(S.m, (x, y, z_lo + 1.15), (-fy, 0, 0), (0, 0, 1), 0.45, 0.4, WINDOW, off=0.02)
    if S.fine and trim is not None:
        S.m.box((0, y + fy * 0.04, z_hi - 0.05), (2 * w1, 0.08, 0.1), trim)


def deal_stack(S, x0, x1, y0, y1, z, h, seed=1):
    """A deck load of deals (sawn Scandinavian boards) stacked in tiers, the ends uneven, chained down."""
    rnd = random.Random(seed)
    n = max(1, int(h / 0.24))
    for k in range(n if S.near else 1):
        zz = z + (k + 0.5) * (h / n if S.near else h)
        hh = (h / n if S.near else h) - 0.012
        if S.near:
            dy0, dy1 = rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12)
            parts = 2 if S.fine else 1
            for j in range(parts):
                xa = x0 + (x1 - x0) * j / parts + 0.01
                xb = x0 + (x1 - x0) * (j + 1) / parts - 0.01
                S.m.box(((xa + xb) / 2, (y0 + y1) / 2 + (dy0 + dy1) / 2, zz), (xb - xa, y1 - y0 + dy1 - dy0, hh), WOOD,
                        shade=0.85 + 0.15 * rnd.random(), tile=1.2)
        else:
            S.m.box(((x0 + x1) / 2, (y0 + y1) / 2, zz), (x1 - x0, y1 - y0, hh), WOOD, tile=1.2)
    if S.fine:
        for y in np.linspace(y0 + 0.4, y1 - 0.4, max(2, int((y1 - y0) / 1.6))):
            S.m.line(V(x0 - 0.02, y, z), V(x0 - 0.02, y, z + h + 0.02))
            S.m.line(V(x0 - 0.02, y, z + h + 0.02), V(x1 + 0.02, y, z + h + 0.02))
            S.m.line(V(x1 + 0.02, y, z + h + 0.02), V(x1 + 0.02, y, z))
    S.blk(((x0 + x1) / 2, (y0 + y1) / 2, z + h / 2), (x1 - x0, y1 - y0, h))
    S.wlk([V(x0, y0, z + h), V(x1, y0, z + h), V(x1, y1, z + h), V(x0, y1, z + h)])


def barque(sailing=False, variant=None, d=0):
    """A three-masted barque of the 1870s, ~48 m: square yards on fore and main, a gaff spanker on the mizzen,
    bowsprit and jibboom, a half-poop aft and a topgallant forecastle, the deckhouse between the fore and main masts
    with a boat on its roof, boats in davits on the quarters.
    variant "timber" (the default at anchor): a Norwegian timber barque, older and worked hard: black with a white
    sheer strake, tarred and weedy below (no copper), loading ports in her bows, a deck load of deals in the waist,
    the windmill pump abaft the mainmast, Norwegian colours.
    variant "grain" (and under sail): a German grain barque, kept smart: a white band of painted ports, copper below,
    a gilt figurehead, boats on skids, the German merchant flag."""
    variant = variant or ("grain" if sailing else "timber")
    timber = variant == "timber"
    S = Ship(d)
    m = S.m
    L, B, KZ, SZ = 48.0, 9.2, -4.2, 2.9

    def keel(t):
        return KZ + 1.3 * sm((t - 0.93) / 0.07) ** 1.5 + 0.3 * sm((0.04 - t) / 0.04)

    def sheer(t):
        return SZ + 1.5 * max(0.0, (t - 0.5) / 0.5) ** 2 + 1.0 * max(0.0, (0.4 - t) / 0.4) ** 2

    SEC = [(0, 0.22), (0.12, 0.7), (0.3, 0.9), (0.55, 0.99), (0.8, 1.0), (1.0, 0.95)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.6:
            f = (t - 0.6) / 0.4
            p = (1 - min(f, 1.0) ** 2) ** (0.7 + 1.0 * (1 - u))
        elif t < 0.32:
            f = (0.32 - t) / 0.32
            p = (1 - min(f, 1.0) ** 2.2) ** (0.5 + 1.4 * (1 - u))
            p = max(p, 0.55 * sm((u - 0.5) / 0.5) * (1 - t / 0.32))
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -3.0 * u ** 1.3 * sm((t - 0.9) / 0.1) + 2.2 * u ** 2 * sm((0.06 - t) / 0.06)

    levels = [keel, lambda t: keel(t) + 0.4, lambda t: keel(t) + 0.9, lambda t: -2.8, lambda t: -1.8, lambda t: -0.8,
              lambda t: 0.3, lambda t: 1.0, lambda t: sheer(t) - 1.6, lambda t: sheer(t) - 0.8, lambda t: sheer(t) - 0.25, sheer]
    below = TARWEED if timber else COPPER
    mats = [(below, 0)] * 6 + [(TAR, 0), (TAR, 0), (TAR if timber else WHITE, 0), (TAR, 0), (WHITE if timber else TAR, 0)]
    TP, TF = 0.14, 0.9  # the poop's front, the forecastle's after end
    hull = loft(S, L, (TP, TF, 0.27, 0.52, 0.77), levels, mats, hb, yfn, lambda p: 0.5 + 0.5 * sm((p.z + 3.5) / 6.5),
                [[0, 2, 4, 6, 8, 9, 11], [0, 3, 6, 8, 11]])

    def zd(t):
        return sheer(t) - 1.1

    def zp(t):
        return sheer(t) - 0.15

    if S.near:
        hull.wale(m, lambda t: 1.2, 0.02, 0.985, h=0.34, out=0.07, mat=TAR, shade=0.75)
    if S.fine:
        if not timber:
            hull.wale(m, lambda t: sheer(t) - 1.57, 0.03, 0.97, h=0.05, out=0.025, mat=VARNISH)
            for t in along(hull, lambda t: sheer(t) - 1.2, 0.08, 0.88, 2.2):
                side_quads(S, hull, [t], sheer(t) - 1.2, 0.5, 0.48, TAR, shade=0.6)
        else:
            # the bow ports the deals went in by: square lids with their hinges and bars
            side_quads(S, hull, [0.935], 1.5, 0.8, 0.75, DARK, off=0.03, shade=0.7)
            side_quads(S, hull, [0.935], 1.5, 0.95, 0.9, TAR, off=0.015, shade=0.5)
        stem = [hull.P(1.0, z, 1) for z in np.linspace(keel(1.0), sheer(1.0) - 0.1, 7)]
        S.m.tube([V(0, p.y - 0.06, p.z) for p in stem], [(0.16, 0.14)] * 7, 4, below, smooth=False)

    # decks: the waist, the half-poop and the topgallant forecastle, with their fronts and ladders
    deck(S, hull, zd, TP, TF, 0.12)
    deck(S, hull, zp, 0, TP, 0.12)
    deck(S, hull, zp, TF, 1, 0.12)
    bulwark(S, hull, zd, sheer, TP, TF, 0.15, WHITE if not timber else GREEN, VARNISH if not timber else DARK, step=1.2,
            end0=False, end1=False)
    for t0_, t1_, e0, e1 in ((0, TP, True, False), (TF, 1, False, False)):
        bulwark(S, hull, zp, sheer, t0_, t1_, 0.15, WHITE, VARNISH if not timber else DARK, step=0, end0=e0, end1=e1)
        if S.near:
            T = [t for t in hull.span(t0_, t1_)]
            for sx in (1, -1):
                pipe_rail(S, [hull.P(t, sheer(t) + 0.08, sx, 0.08) for t in T], 0.8, 1.6, DARK)
    break_front(S, hull, TP, zd(TP) - 0.02, zp(TP), 0.15, WHITE, doors=(-1.6, 1.6), windows=(-0.6, 0.6), face=-1)
    break_front(S, hull, TF, zd(TF) - 0.02, zp(TF), 0.15, WHITE, doors=(-1.4, 1.4), face=1)
    if S.near:
        for x in (-2.6, 2.6):
            for t, sgn in ((TP, -1), (TF, 1)):
                yb = hull.y(t, zd(t)) + sgn * 0.6
                m.beam(V(x, yb, zd(t)), V(x, hull.y(t, zp(t)), zp(t)), 0.6, 0.08, DARK, side=(1, 0, 0))
    # masts
    fore = Mast(hull, 0.77, zd(0.77), 14.5, 25.0, 33.0, 0.02, 0.34, top=(2.8, 2.0))
    main = Mast(hull, 0.52, zd(0.52), 15.5, 27.0, 36.0, 0.035, 0.36, top=(2.9, 2.1))
    mizz = Mast(hull, 0.27, zd(0.27), 12.5, 21.5, 21.5, 0.05, 0.28, top=(2.2, 1.6), square=False)
    for mp in (fore, main, mizz):
        mp.build(S, hoops=mp is mizz)
        mp.shrouds(S, hull, sheer, sheer(mp.t) - 0.35, n=((5, 3, 2) if mp is not mizz else (4, 3, 0)) if S.fine else (3, 2, 1))
    yards = {}
    for mp, s_ in ((fore, 0.93), (main, 1.0)):
        h1, h2, h3 = mp.h1 - mp.zd, mp.h2 - mp.zd, mp.h3 - mp.zd
        spec = [(h1 - 1.6, 18.5, 0.24, 0.42, 1), (h1 + 0.7, 16.0, 0.2, 0.34, 2), (h1 + (h2 - h1) * 0.55, 14.0, 0.17, 0.3, 2),
                (h2 + 1.0, 10.5, 0.13, 0.22, 3), (h2 + (h3 - h2) * 0.62, 7.5, 0.1, 0.16, 3)]
        yards[mp] = square_yards(S, mp, spec, not sailing, s_)
        if sailing:
            c0, w0 = yards[mp][0]
            square_sails(S, yards[mp], V(c0.x, c0.y - 1.0, mp.zd + 3.0), w0 * 1.02)
    braces(S, yards[fore], hull, sheer, [0.6, 0.6, 0.55, 0.52, 0.5])
    braces(S, yards[main], hull, sheer, [0.36, 0.33, 0.3, 0.28, 0.27])
    # mizzen: gaff and boom with the spanker
    g0 = mizz.at(mizz.h1 - 1.3)
    g1 = g0 + V(0, 9.0 * math.cos(0.45), 9.0 * math.sin(0.45))
    S.spar(g0, g1, 0.16, 0.1)
    b0 = mizz.at(mizz.zd + 2.3)
    b1 = b0 + V(0, 13.0, 0.4)
    S.spar(b0, b1, 0.18, 0.12)
    if sailing:
        sail(m, g0 + V(0, 0.35, -0.25), g1 + V(0, -0.3, -0.2), b0 + V(0, 0.4, 0.25), b1 + V(0, -0.8, 0.25), V(1.3, 0, 0),
             nu=6 if S.fine else 3, nv=4 if S.fine else 2)
    else:
        bundle(m, g0 + V(0, 0.6, -0.35), g1 + V(0, -0.8, -0.3), 0.3, CANVAS, n=5, sides=S.n(6))
        bundle(m, mizz.at(mizz.zd + 3.2) + V(0, 0.4, 0), g0 + V(0, 0.4, -0.6), 0.28, CANVAS, n=3, sides=S.n(6))
    for a_, b_ in ((g1, b1), (mizz.head(2) - V(0, 0, 0.5), g1), (mizz.head(2) - V(0, 0, 0.3), b1)):
        m.line(a_, b_)
    flag(m, g1 + V(0, 0.05, -0.1), 2.0, 1.3, along=(0, 0.2, -1), kind="norwegian" if timber else "german")
    flag(m, main.head(3) + V(0, 0, main.pole + 0.9), 1.3, 0.9, along=(0, 1, 0), kind="house" if not timber else "red")
    pennant(m, fore.head(3) + V(0, 0, fore.pole + 0.25), 5.0, h=0.35)
    # bowsprit, jibboom, headsails; figurehead, the knee of the head, head rails
    heel, dv, bs_end, jbs, jbe = bowsprit_rig(S, hull, sheer, 13, 3.0, 11.0, 7.5, 19.0, 0.36, 0.2, furled=not sailing, striker=2.2)
    fs = [(fore.head(1), heel + dv * 6.0), (fore.head(2), jbs + dv * 5.0), (fore.head(3) - V(0, 0, 1.2), jbe)]
    ms = [(main.head(1), fore.at(fore.zd + 1.2) + V(0, 0.6, 0)), (main.head(2), fore.head(1)), (main.head(3) - V(0, 0, 1.2), fore.head(2))]
    zs = [(mizz.head(1), main.at(main.h1 - 3.5)), (mizz.head(2), main.head(1) + V(0, 0, 0.4))]
    for a_, b_ in fs + ms + zs:
        m.line(a_, b_)
    if sailing:
        stem_top = V(0, hull.y(1.0, sheer(1.0)), sheer(1.0))
        for k, (top_, low_) in enumerate(fs):
            tack = Vector(low_)
            head = tack.lerp(Vector(top_), 0.72 - 0.08 * k)
            clew = V(1.5, stem_top.y + 3.5 - 2.2 * k, sheer(1.0) + 1.6 + 0.6 * k)
            sail(m, head, head, tack + V(0, 0.2, 0.1), clew, V(1.0, 0, 0), nu=2, nv=3 if S.fine else 2)
    zf0 = sheer(1.0) - 1.7
    fb = V(0, hull.y(1.0, zf0) - 0.05, zf0)
    head_knee(S, hull, 0.6, zf0 - 0.2, fb, out=0.6)
    figurehead(S, V(0, hull.y(1.0, zf0) - 0.4, zf0 + 0.05), dv + V(0, -0.3, 0.55), WHITE if timber else VARNISH,
               VARNISH if timber else WHITE, 1.1)
    if S.near:
        for sx in (1, -1):
            a = hull.P(0.955, sheer(0.955) - 0.35, sx)
            b = V(sx * 0.5, hull.y(1.0, sheer(1.0) - 1.1) - 0.5, sheer(1.0) - 1.2)
            c = V(sx * 0.16, fb.y - 0.2, zf0 + 0.1)
            m.tube([a, b, c], [0.07, 0.06, 0.05], 4, DARK, smooth=False, side=(0, 0, 1))
    for sx in (1, -1):
        cathead_anchor(S, hull, sheer, 0.95, sx, 0.9, 0.6)
    # the forecastle: capstan, bitts; the windlass under its front
    capstan(S, (0, hull.y(0.95, zp(0.95)), zp(0.95)), 0.45, 1.0)
    windlass_gear(S, 0, hull.y(TF - 0.012, zd(TF)), zd(TF) + 0.4, w=2.4, r=0.25)
    # the deckhouse with a boat on its roof, galley chimney
    y0, y1 = hull.y(0.68, zd(0.68)), hull.y(0.585, zd(0.585))
    z0 = zd(0.63) - 0.05
    deckhouse(S, -2.1, 2.1, y0, y1, z0, z0 + 2.2, wall=VARNISH if timber else WHITE, roof=DECK,
              windows=[("+x", y0 + 1.3, z0 + 1.4), ("+x", y1 - 1.3, z0 + 1.4), ("-x", y0 + 1.3, z0 + 1.4), ("-x", y1 - 1.3, z0 + 1.4),
                       ("-y", 1.0, z0 + 1.4)], door=("-y", -0.8, 0.8, 1.8), trim=WHITE if timber else VARNISH)
    if S.near:
        chimney(m, 1.3, y1 - 0.8, z0 + 2.3, 0.8, 0.12)
        if S.fine:
            m.stove(V(1.3, y1 - 0.8, z0 + 3.3))
        for dy in (-1.6, 1.6):
            m.box((0, (y0 + y1) / 2 + dy, z0 + 2.38), (1.2, 0.2, 0.2), DARK)
    boat_on_chocks(S, (0, (y0 + y1) / 2, z0 + 2.48), 5.6, 1.7, 0.75, mat=WHITE)
    # hatches, fife rails, pumps
    for t0_, t1_ in ((0.405, 0.455), (0.705, 0.74), (0.195, 0.225)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        tc = (t0_ + t1_) / 2
        hatch(S, (0, (ya + yb) / 2, zd(tc)), 2.8, yb - ya, 0.6)
    for mp in (fore, main, mizz):
        fife_rail(S, mp.at(mp.zd), 1.7, 1.7)
    if timber:
        windmill_pump(S, (0, main.y + 2.4, zd(0.47)))
        # the deck load: deals stacked along both sides of the waist, a lane left down the middle
        for sx in (1, -1):
            for ta, tb, k in ((0.29, 0.39, 1), (0.47, 0.5, 2), (0.555, 0.58, 3), (0.685, 0.73, 4), (0.745, 0.765, 5)):
                ya, yb = hull.y(tb, zd(tb)), hull.y(ta, zd(ta))
                w_in = 1.75
                w_out = min(hull.hb(ta, zd(ta)), hull.hb(tb, zd(tb))) - 0.35
                if w_out - w_in < 0.6:
                    continue
                x0, x1 = (w_in, w_out) if sx > 0 else (-w_out, -w_in)
                deal_stack(S, x0, x1, ya + 0.1, yb - 0.1, zd((ta + tb) / 2), 1.25, seed=k * 7 + (sx > 0))
    else:
        brake_pump(S, (0, main.y + 1.9, zd(0.48)), 0.9)
        casks(S, [(-1.6, hull.y(0.66, zd(0.66)), zd(0.66)), (-1.1, hull.y(0.665, zd(0.665)), zd(0.665)),
                  (1.5, hull.y(0.45, zd(0.45)), zd(0.45))])
        if S.near:
            crate_lo(m, (1.6, hull.y(0.7, zd(0.7)), zd(0.7)), yaw=0.2)
        S.blk((1.6, hull.y(0.7, zd(0.7)), zd(0.7) + 0.33), (1.0, 0.8, 0.66))
    coils(S, [(0.9, hull.y(0.86, zd(0.86)), zd(0.86)), (-1.2, hull.y(0.3, zd(0.3)), zd(0.3)), (1.3, hull.y(0.6, zd(0.6)), zd(0.6))], 0.32)
    # the poop: wheel, skylight, companion, hen coop; boats in davits on the quarters
    zq = zp(0.04)
    helm(S, 0, hull.y(0.04, zq) - 0.1, zq, 0.55)
    skylight(S, (0, hull.y(0.09, zp(0.09)), zp(0.09)), 1.5, 1.4, 0.5)
    companion(S, (1.4, hull.y(0.115, zp(0.115)), zp(0.115)), face=-1)
    if S.near:
        m.box((-1.9, hull.y(0.06, zp(0.06)), zp(0.06) + 0.35), (0.7, 1.6, 0.7), WOOD)
    S.blk((-1.9, hull.y(0.06, zp(0.06)), zp(0.06) + 0.35), (0.8, 1.7, 0.7))
    for sx in (1, -1):
        davit_pair(S, hull, 0.09, sheer(0.09) - 0.1, sx, 5.0, 1.5, 0.62, 0.3, span=3.6)
    # the stern: windows under the carved board with her name and port, the rudder
    zt0 = sheer(0.0)
    for x in (-1.3, -0.45, 0.45, 1.3):
        y = hull.y(0.0, zt0 - 1.55)
        dy = (hull.y(0.0, zt0 - 1.25) - hull.y(0.0, zt0 - 1.85)) / 0.6
        panel(m, (x, y, zt0 - 1.55), (-1, 0, 0), V(0, dy, 1).normalized(), 0.5, 0.55, WINDOW, off=0.06)
    stern_zone(S, hull, "stern", zt0 - 0.6, 4.2, 0.72, tmax=0.06)
    rudder(S, hull, KZ, zp(0.0) + 0.3, chord=1.0)
    side_zone(S, hull, "bow_p", 1, 0.905, sheer(0.905) - 0.45, 3.4, 0.42)
    side_zone(S, hull, "bow_s", -1, 0.905, sheer(0.905) - 0.45, 3.4, 0.42)
    # M7 boats: a riding light at anchor; under way the red and green side lights in the fore rigging
    if sailing:
        for sx, kind in ((1, 1), (-1, 2)):
            lanterns(S, hull.P(0.72, sheer(0.72) + 0.4, sx, -0.1), kind, bail=False)
    else:
        lanterns(S, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 3.4), 0)
    return S.finish(lambda dd: barque(sailing, variant, dd), levels=1)


# ------------------------------------------------------------------ the schooner


def schooner(d=0):
    """A Baltic topsail schooner of the 1870s (Danish, of Marstal), ~26 m, under sail: the gaff foresail and mainsail,
    a square topsail and topgallant on the fore, a gaff topsail over the main, three headsails. Dark green topsides
    with a white sheer strake and a varnished rail, the bottom tarred; a cabin trunk aft with a skylight, the galley
    companion forward, a boat hung in davits over the stern. Danish colours."""
    S = Ship(d)
    m = S.m
    L, B, KZ, SZ = 26.0, 6.6, -2.6, 1.8

    def keel(t):
        return KZ + 0.9 * sm((t - 0.9) / 0.1) ** 1.5 + 0.2 * sm((0.05 - t) / 0.05)

    def sheer(t):
        return SZ + 0.9 * max(0.0, (t - 0.5) / 0.5) ** 2 + 0.5 * max(0.0, (0.4 - t) / 0.4) ** 2

    SEC = [(0, 0.22), (0.15, 0.72), (0.35, 0.92), (0.6, 0.99), (1.0, 0.96)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        if t > 0.58:
            f = (t - 0.58) / 0.42
            p = (1 - min(f, 1.0) ** 2) ** (0.7 + 1.0 * (1 - u))
        elif t < 0.3:
            f = (0.3 - t) / 0.3
            p = (1 - min(f, 1.0) ** 2.2) ** (0.5 + 1.4 * (1 - u))
            p = max(p, 0.5 * sm((u - 0.5) / 0.5) * (1 - t / 0.3))
        else:
            p = 1.0
        return max(0.03, B / 2 * table(SEC, u) * p)

    def yfn(t, z):
        u = uz(z)
        return -1.6 * u ** 1.3 * sm((t - 0.9) / 0.1) + 1.0 * u ** 2 * sm((0.06 - t) / 0.06)

    levels = [keel, lambda t: keel(t) + 0.3, lambda t: keel(t) + 0.7, lambda t: -1.5, lambda t: -0.8, lambda t: 0.15,
              lambda t: 0.8, lambda t: sheer(t) - 0.38, lambda t: sheer(t) - 0.12, sheer]
    mats = [(TARWEED, 0)] * 5 + [(GREEN, 0), (GREEN, 0), (WHITE, 0), (GREEN, 0)]
    hull = loft(S, L, (0.38, 0.68), levels, mats, hb, yfn, lambda p: 0.5 + 0.5 * sm((p.z + 2.2) / 4.5), [[0, 2, 4, 5, 7, 9]],
                n=(40, 16, 9))

    def zd(t):
        return sheer(t) - 0.75

    if S.near:
        hull.wale(m, lambda t: 0.92, 0.02, 0.985, h=0.2, out=0.05, mat=TAR, shade=0.75)
    if S.fine:
        stem = [hull.P(1.0, z, 1) for z in np.linspace(keel(1.0), sheer(1.0) - 0.1, 6)]
        S.m.tube([V(0, p.y - 0.05, p.z) for p in stem], [(0.11, 0.1)] * 6, 4, TAR, smooth=False)
    deck(S, hull, zd, 0, 1, 0.1)
    bulwark(S, hull, zd, sheer, 0, 1, 0.11, WHITE, VARNISH, step=1.0)
    # masts: the fore with a top and a topmast for the square sails, the main with its topmast
    fore = Mast(hull, 0.68, zd(0.68), 10.8, 17.0, 17.0, 0.08, 0.24, top=(1.7, 1.2), pole=0.0)
    main = Mast(hull, 0.38, zd(0.38), 12.5, 19.0, 19.0, 0.08, 0.26, top=(1.5, 1.1), pole=0.0, square=False)
    for mp in (fore, main):
        mp.build(S, hoops=True)
        mp.shrouds(S, hull, sheer, sheer(mp.t) - 0.05, n=(3, 2, 0) if S.fine else (2, 1, 0), channel=False)
    nu, nv = (5, 4) if S.fine else (3, 2)
    # fore: the gaff foresail, the square topsail and topgallant above it
    fg0 = fore.at(fore.zd + 10.0)
    fg1 = fg0 + V(0, 5.5 * math.cos(0.5), 5.5 * math.sin(0.5))
    S.spar(fg0, fg1, 0.1, 0.07)
    ffoot0, ffoot1 = fore.at(fore.zd + 1.6) + V(0, 0.3, 0), V(0, main.y - 1.2, fore.zd + 1.8)
    sail(m, fg0 + V(0, 0.25, -0.15), fg1 + V(0, -0.15, -0.1), ffoot0, ffoot1, V(0.9, 0, 0), nu=nu, nv=nv)
    yards = square_yards(S, fore, [(10.8 - 1.0, 10.5, 0.14, 0.0, 1), (10.8 + 2.9, 8.6, 0.12, 0.0, 2), (17.0 + 0.6, 6.4, 0.09, 0.0, 2)],
                         furled=False)
    square_sails(S, yards[1:], yards[0][0] + V(0, -0.05, 0.1), yards[0][1], belly=0.12)
    braces(S, yards, hull, sheer, [0.45, 0.42, 0.4])
    # main: the gaff mainsail on a long boom over the stern, the gaff topsail above
    mg0 = main.at(main.zd + 12.0)
    mg1 = mg0 + V(0, 7.0 * math.cos(0.55), 7.0 * math.sin(0.55))
    S.spar(mg0, mg1, 0.11, 0.07)
    mb0 = main.at(main.zd + 1.8)
    mb1 = mb0 + V(0, 11.5, 0.4)
    S.spar(mb0, mb1, 0.14, 0.09)
    sail(m, mg0 + V(0, 0.25, -0.15), mg1 + V(0, -0.15, -0.1), mb0 + V(0, 0.3, 0.2), mb1 + V(0, -0.4, 0.2), V(1.2, 0, 0), nu=nu, nv=nv)
    mtop = main.head(2) + V(0, 0, main.head2)
    sail(m, mtop - V(0, -0.1, 0.4), mtop - V(0, -0.1, 0.4), mg0 + V(0, 0.4, 0.3), mg1 + V(0, -0.3, 0.2), V(0.5, 0, 0), nu=2,
         nv=3 if S.fine else 2)
    # bowsprit and jibboom with three headsails set, stays
    heel, dv, bs_end, jbs, jbe = bowsprit_rig(S, hull, sheer, 12, 1.8, 7.0, 4.5, 12.0, 0.22, 0.12, furled=False, striker=1.4)
    ftop = fore.head(2) + V(0, 0, fore.head2)
    for k, (tk, hd, top_) in enumerate(((5.0, 0.6, fore.head(1)), (6.8, 0.66, ftop - V(0, 0, 3.0)), (11.5, 0.7, ftop - V(0, 0, 0.4)))):
        tack = heel + dv * tk
        m.line(top_, tack)
        head = tack.lerp(top_, hd)
        sail(m, head, head, tack + V(0, 0.1, 0.1), V(1.2, fore.y - 2.6 - 2.3 * k, fore.zd + 1.6 + 0.5 * k), V(0.8, 0, 0), nu=2,
             nv=3 if S.fine else 2)
    m.line(main.head(1), fore.at(fore.zd + 1.2) + V(0, 0.4, 0))
    m.line(mtop - V(0, 0, 0.6), ftop - V(0, 0, 0.8))
    for a_, b_ in ((ftop - V(0, 0, 1.0), fg1), (mtop - V(0, 0, 0.8), mg1), (mb1, hull.P(0.02, sheer(0.02), 1) + V(0, 0, 0.2)),
                   (mb1, hull.P(0.02, sheer(0.02), -1) + V(0, 0, 0.2))):
        m.line(a_, b_)
    zf0 = sheer(1.0) - 0.8
    head_knee(S, hull, 0.4, zf0 - 0.15, V(0, hull.y(1.0, zf0) - 0.3, zf0), out=0.6, thick=0.24)
    if S.near:
        with m.at(move(0, hull.y(1.0, zf0) - 0.55, zf0 + 0.1)):
            m.lathe([(0.0, -0.15), (0.12, -0.12), (0.16, 0.0), (0.12, 0.12), (0.0, 0.15)], S.n(8), VARNISH, smooth=False)
    for sx in (1, -1):
        cathead_anchor(S, hull, sheer, 0.94, sx, 0.6, 0.4)
    # deck: windlass, galley companion and chimney, hatches, pumps, cabin trunk with skylight, wheel
    windlass_gear(S, 0, hull.y(0.92, zd(0.92)), zd(0.92) + 0.35, w=1.5, r=0.18)
    companion(S, (0, hull.y(0.835, zd(0.835)), zd(0.835)), 0.8, 0.9, 0.75, VARNISH, face=1)
    if S.near:
        chimney(m, 0.7, hull.y(0.82, zd(0.82)), zd(0.82), 1.1, 0.09)
        if S.fine:
            m.stove(V(0.7, hull.y(0.82, zd(0.82)), zd(0.82) + 1.3))
    hatch(S, (0, hull.y(0.725, zd(0.725)), zd(0.725)), 1.4, 1.2, 0.45)
    hatch(S, (0, hull.y(0.53, zd(0.53)), zd(0.53)), 2.0, 2.4, 0.55)
    for mp in (fore, main):
        fife_rail(S, mp.at(mp.zd), 1.2, 1.1, h=0.65)
    brake_pump(S, (0, main.y + 1.3, zd(0.34)), 0.7)
    c0, c1 = 0.07, 0.21
    cy0, cy1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    deckhouse(S, -1.5, 1.5, cy0, cy1, zd(0.14) - 0.04, zd(0.14) + 0.85, wall=VARNISH, roof=DECK, trim=WHITE,
              windows=[("+x", cy0 + 1.0, zd(0.14) + 0.5), ("+x", cy1 - 1.0, zd(0.14) + 0.5), ("-x", cy0 + 1.0, zd(0.14) + 0.5),
                       ("-x", cy1 - 1.0, zd(0.14) + 0.5)], roof_rise=0.1, walk=True)
    skylight(S, (0, (cy0 + cy1) / 2 + 0.3, zd(0.14) + 0.95), 0.9, 0.9, 0.3)
    companion(S, (0, cy0 - 0.55, zd(0.2)), 0.8, 0.9, 0.85, VARNISH, face=-1)
    zq = zd(0.035)
    helm(S, 0, hull.y(0.035, zq), zq, 0.45, box=True)
    casks(S, [(1.6, hull.y(0.6, zd(0.6)), zd(0.6)), (-1.6, hull.y(0.6, zd(0.6)), zd(0.6))])
    coils(S, [(1.2, hull.y(0.62, zd(0.62)), zd(0.62)), (-1.3, hull.y(0.3, zd(0.3)), zd(0.3)), (0.9, hull.y(0.9, zd(0.9)), zd(0.9))], 0.26)
    # the boat in davits over the stern, athwartships
    if S.d < 2:
        yb = hull.y(0.0, sheer(0.0)) + 0.9
        zb = sheer(0.0) + 0.1
        ships_boat(m, (0, yb, zb), 4.2, 1.4, 0.55, yaw=math.pi / 2, mat=WHITE, cover=CANVAS)
        for sx in (1, -1):
            base = hull.P(0.03, sheer(0.03), sx, 0.25)
            top = V(sx * 1.5, yb, zb + 1.3)
            S.m.tube([base, base + V(0, 0, 0.7), top - V(0, 0.4, 0.15), top], [0.06, 0.055, 0.05, 0.045], S.n(6), IRON, smooth=False,
                     side=(1, 0, 0))
            m.line(top, V(sx * 1.5, yb, zb + 0.5))
    # the stern: her name and port; the rudder; flags
    zt0 = sheer(0.0)
    stern_zone(S, hull, "stern", zt0 - 0.42, 2.5, 0.48, tmax=0.06, scroll=False)
    rudder(S, hull, KZ, zd(0.0) + 0.6, chord=0.8, thick=0.18)
    side_zone(S, hull, "bow_p", 1, 0.9, sheer(0.9) - 0.3, 2.3, 0.32)
    side_zone(S, hull, "bow_s", -1, 0.9, sheer(0.9) - 0.3, 2.3, 0.32)
    flag(m, mg1 + V(0, 0.05, -0.05), 1.5, 1.0, along=(0, 0.2, -1), kind="danish")
    pennant(m, ftop + V(0, 0, 0.2), 3.0, h=0.25)
    # M7 boats: her riding light on the forestay
    lanterns(S, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 2.8), 0)
    return S.finish(schooner)


# ------------------------------------------------------------------ the steamers


def derrick(S, mast, side, face, length=7.0, rise=6.0, out=1.4, to=None):
    """A cargo derrick from the mast's foot out over a hatch: its gooseneck, the topping lift to the masthead and the
    runner down to the winch."""
    heel = mast.at(mast.zd + 1.4) + V(side * 0.35, face * 0.35, 0)
    head = heel + V(side * out, face * length, rise)
    S.spar(heel, head, 0.14, 0.08, DARK, sides=6)
    if S.fine:
        S.m.box(heel, (0.25, 0.25, 0.3), IRON)
    S.m.line(head, mast.at(mast.h1 - 0.4))
    hook = head - V(0, 0, 2.6 + 0.6 * side)
    S.m.line(head, hook)
    if S.near:
        S.m.box(hook - V(0, 0, 0.1), (0.14, 0.16, 0.22), IRON)
    if to is not None:
        S.m.line(head, to)
    return head


def bridge(S, y0, y1, z, half, rail=1.0, house=True, wh=(1.0, 1.4), dodger=True, screens=True):
    """An open bridge across the ship at z: its deck on iron pillars, the rails, a canvas dodger along the front, the
    wheelhouse in the middle, the binnacle and the engine telegraph, side-light screens at the wings."""
    m = S.m
    m.box((0, (y0 + y1) / 2, z), (2 * half, y1 - y0, 0.12), DECK, tile=1.6)
    S.wlk([V(-half, y0, z + 0.06), V(half, y0, z + 0.06), V(half, y1, z + 0.06), V(-half, y1, z + 0.06)])
    for y in (y0, y1):
        m.line(V(-half, y, z + rail), V(half, y, z + rail))
        m.line(V(-half, y, z + rail * 0.5), V(half, y, z + rail * 0.5))
        for x in np.linspace(-half, half, 9 if S.fine else 4):
            if S.fine:
                m.beam(V(x, y, z + 0.06), V(x, y, z + rail), 0.04, 0.04, IRON, caps=False)
            else:
                m.line(V(x, y, z + 0.06), V(x, y, z + rail))
    if dodger and S.near:
        m.poly([V(-half, y0 - 0.02, z + 0.08), V(half, y0 - 0.02, z + 0.08), V(half, y0 - 0.02, z + rail * 0.95),
                V(-half, y0 - 0.02, z + rail * 0.95)], CANVAS, uvs=[(0, 0), (half, 0), (half, 0.6), (0, 0.6)])
    if house:
        hw, hl = wh
        deckhouse(S, -hw, hw, y0 + 0.15, y0 + 0.15 + hl, z + 0.06, z + 2.0, wall=WHITE, roof=DARK, trim=VARNISH,
                  windows=[("-y", -hw * 0.45, z + 1.35), ("-y", hw * 0.45, z + 1.35), ("+x", y0 + 0.15 + hl / 2, z + 1.35),
                           ("-x", y0 + 0.15 + hl / 2, z + 1.35)], door=("+y", 0.0, 0.7, 1.75), roof_rise=0.06)
    if S.fine:
        with m.at(move(hw + 0.8 if house else 0.0, y0 + 0.6, z + 0.06)):
            m.lathe([(0.2, 0.0), (0.15, 0.1), (0.12, 0.85), (0.2, 0.95), (0.22, 1.1), (0.08, 1.2)], 10, VARNISH, smooth=False, cap1=True)
        with m.at(move(-(hw + 0.8) if house else 0.8, y0 + 0.5, z + 0.06)):
            m.lathe([(0.12, 0.0), (0.09, 0.1), (0.08, 0.8), (0.2, 0.9), (0.2, 1.15), (0.0, 1.2)], 10, IRON, smooth=False)
    if screens and S.near:
        for sx, kind in ((1, 1), (-1, 2)):
            c = V(sx * (half - 0.05), y0 + 0.8, z + 1.0)
            m.box(c + V(0, 0, 0.45), (0.05, 1.2, 0.9), GREEN if kind == 2 else REDLEAD, shade=0.8)
    # lifebuoys on the front rail
    if S.fine:
        for sx in (1, -1):
            c = V(sx * (half - 1.2), y0 - 0.06, z + 0.55)
            ring = [c + V(0.3 * math.cos(2 * math.pi * i / 10), 0, 0.3 * math.sin(2 * math.pi * i / 10)) for i in range(10)]
            m.tube(ring, [0.07] * 10, 5, WHITE, side=(0, 1, 0), closed_path=True, smooth=False)


def steamer(variant="collier", d=0):
    """An iron screw steamer of the 1870s, ~56 m: plumb stem, counter stern, a raised forecastle, a bridge deck
    amidships and a short poop, with the two well decks between them; red below the waterline, the hatches with
    their steam winches and derricks, the midship house with an open bridge, boats in davits, cowl ventilators.
    variant "collier" (at anchor): a British collier, all black, a short broad funnel with a white band, two pole
    masts with one yard on the fore, two boats, the red ensign.
    variant "line": a Belgian line steamer, kept for passengers: a row of ports, a white sheer strake, a long white
    house, a tall funnel black and red, yards on the fore, four boats, the Belgian colours."""
    line = variant == "line"
    S = Ship(d)
    m = S.m
    L, B, KZ, SZ = 56.0, 8.4, -3.8, 3.4

    def keel(t):
        return KZ + 0.5 * sm((t - 0.96) / 0.04) + 0.9 * sm((0.05 - t) / 0.05)

    def sheer(t):
        return SZ + 1.3 * max(0.0, (t - 0.62) / 0.38) ** 2 + 0.6 * max(0.0, (0.3 - t) / 0.3) ** 2

    SEC = [(0, 0.6), (0.08, 0.9), (0.2, 0.99), (1, 1.0)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.68:
            f = (t - 0.68) / 0.32
            p = (1 - min(f, 1.0) ** 1.9) ** (0.8 * (1 + 0.6 * (1 - u)))
        elif t < 0.3:
            f = (0.3 - t) / 0.3
            p = (1 - min(f, 1.0) ** 2) ** (0.45 + 1.6 * (1 - u))
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -0.9 * u * sm((t - 0.94) / 0.06) + 3.0 * u ** 2.2 * sm((0.06 - t) / 0.06)

    TP, TB0, TB1, TF = 0.13, 0.42, 0.6, 0.885
    levels = [keel, lambda t: keel(t) + 0.4, lambda t: keel(t) + 0.8, lambda t: -2.6, lambda t: -1.6, lambda t: -0.6,
              lambda t: -0.02, lambda t: 0.6, lambda t: 1.2, lambda t: sheer(t) - 2.0, lambda t: sheer(t) - 1.45,
              lambda t: sheer(t) - 0.2, sheer]
    mats = [(REDLEAD, 0)] * 6 + [(IRONHULL, 0), (IRONHULL, 0), (IRONHULL, 0), (PORTS, 8.0) if line else (IRONHULL, 0),
                                 (IRONHULL, 0), (WHITE, 0) if line else (IRONHULL, 0)]
    hull = loft(S, L, (TP, TB0, TB1, TF), levels, mats, hb, yfn, lambda p: 0.5 + 0.5 * sm((p.z + 3.0) / 6.0),
                [[0, 2, 4, 6, 8, 10, 12], [0, 3, 6, 9, 12]])

    def zd(t):
        return sheer(t) - 1.15

    def zr(t):
        return sheer(t) - 0.12

    if S.fine:
        stem = [hull.P(1.0, z, 1) for z in np.linspace(keel(1.0), sheer(1.0) - 0.05, 6)]
        S.m.tube([V(0, p.y - 0.04, p.z) for p in stem], [(0.09, 0.08)] * 6, 4, IRON, smooth=False)
        # rubbing strake and the plating's landings
        hull.wale(m, lambda t: sheer(t) - 1.47, 0.02, 0.99, h=0.1, out=0.04, mat=IRONHULL, shade=0.7)
        if not line:
            side_quads(S, hull, [0.45, 0.5, 0.55, 0.06, 0.09], 1.85, 0.32, 0.32, PORTS, off=0.01)
    # decks: the two wells, the forecastle, the bridge deck, the poop; the breaks between
    for t0_, t1_ in ((TP, TB0), (TB1, TF)):
        deck(S, hull, zd, t0_, t1_, 0.12)
        bulwark(S, hull, zd, sheer, t0_, t1_, 0.12, WHITE if line else IRONHULL, VARNISH, step=1.3, end0=False, end1=False)
    for t0_, t1_ in ((0, TP), (TB0, TB1), (TF, 1)):
        deck(S, hull, zr, t0_, t1_, 0.08)
        bulwark(S, hull, zr, sheer, t0_, t1_, 0.1, IRONHULL, VARNISH, step=0, end0=t0_ == 0, end1=False)
        if S.near:
            T = hull.span(t0_, t1_)
            for sx in (1, -1):
                pipe_rail(S, [hull.P(t, sheer(t) + 0.08, sx, 0.06) for t in T], 0.9, 1.5)
    wall = WHITE if line else IRONHULL
    break_front(S, hull, TP, zd(TP), zr(TP), 0.12, wall, doors=(-1.5, 1.5), windows=(-0.5, 0.5) if line else (), face=-1)
    break_front(S, hull, TB0, zd(TB0), zr(TB0), 0.12, wall, doors=(-1.6, 1.6), face=1)
    break_front(S, hull, TB1, zd(TB1), zr(TB1), 0.12, wall, doors=(-1.6, 1.6), windows=(-0.6, 0.6), face=-1)
    break_front(S, hull, TF, zd(TF), zr(TF), 0.12, wall, doors=(-1.4, 1.4), face=1)
    if S.near:
        for x in (-2.5, 2.5):
            for t, sgn in ((TP, -1), (TB0, 1), (TB1, -1), (TF, 1)):
                yb = hull.y(t, zd(t)) + sgn * 0.7
                m.beam(V(x, yb, zd(t)), V(x, hull.y(t, zr(t)), zr(t)), 0.6, 0.08, IRON, side=(1, 0, 0))
    # the midship house on the bridge deck, its roof, the bridge across its front
    zh = zr(0.5)
    hy0, hy1 = hull.y(TB1 - 0.012, zh), hull.y(TB0 + 0.03, zh)
    HH, HW = 2.3, 2.5 if not line else 2.9
    wins = []
    for f in ((0.12, 0.3, 0.5, 0.7, 0.88) if not line else (0.08, 0.2, 0.32, 0.44, 0.56, 0.68, 0.8, 0.92)):
        a = hy0 + (hy1 - hy0) * f
        wins += [("+x", a, zh + 1.4), ("-x", a, zh + 1.4)]
    deckhouse(S, -HW, HW, hy0, hy1, zh - 0.03, zh + HH, wall=WHITE if line else VARNISH, roof=DECK, windows=wins,
              door=("-y", 0.0, 0.8, 1.9), trim=VARNISH if line else WHITE, walk=True)
    zrf = zh + HH + 0.1
    if S.near:
        for sx in (1, -1):
            pipe_rail(S, [V(sx * (HW + 0.05), hy0 + 1.6, zrf), V(sx * (HW + 0.05), hy1 + 0.1, zrf)], 0.9, 1.4)
        pipe_rail(S, [V(-(HW + 0.05), hy1 + 0.1, zrf), V(HW + 0.05, hy1 + 0.1, zrf)], 0.9, 1.4)
    by0, by1 = hy0 - 0.3, hy0 + 1.5
    zb = zrf + 0.9
    bridge(S, by0, by1, zb, B / 2 + 0.3, wh=(1.0, 1.35))
    if S.near:
        for sx in (1, -1):
            for y in (by0 + 0.1, by1 - 0.1):
                m.beam((sx * (B / 2 - 0.1), y, zr(TB1)), (sx * (B / 2 - 0.1), y, zb - 0.06), 0.1, 0.1, IRON, side=(1, 0, 0))
        for sx in (1, -1):
            m.beam(V(sx * 1.4, by1 + 0.3, zrf), V(sx * 1.4, by1 - 0.6, zb), 0.55, 0.06, IRON, side=(1, 0, 0))
    # the funnel and its steam pipe, the engine-room skylight, cowls
    fy = hull.y(0.505, zrf)
    if line:
        top, ring = funnel(S, 0, fy, zrf, 1.0, 9.5, 0.11, FUNNEL, 1.0, deck_pts=[(2.6, fy + 2.5, zrf), (-2.6, fy + 2.5, zrf),
                                                                                    (2.6, fy - 1.2, zrf), (-2.6, fy - 1.2, zrf)])
    else:
        top, ring = funnel(S, 0, fy, zrf, 1.15, 6.4, 0.08, FUNNEL, 0.52, bands=[(0.62, 0.11, WHITE)],
                           deck_pts=[(2.4, fy + 2.4, zrf), (-2.4, fy + 2.4, zrf), (2.4, fy - 1.2, zrf), (-2.4, fy - 1.2, zrf)])
    skylight(S, (0, fy + 3.1, zrf), 1.8, 2.2, 0.55)
    for sx in (1, -1):
        cowl(S, sx * 1.6, fy - 1.9, zrf, 2.0, 0.42, -1)
        cowl(S, sx * 1.7, hull.y(0.7, zd(0.7)) - 1.2, zd(0.7), 1.6, 0.33, -1)
        cowl(S, sx * 1.5, hull.y(0.25, zd(0.25)) + 1.4, zd(0.25), 1.5, 0.3, 1)
    # boats in davits on the bridge deck
    for sx in (1, -1):
        bts = (0.455, 0.56) if line else (0.46,)
        for tb in bts:
            davit_pair(S, hull, tb, zr(tb), sx, 5.2, 1.6, 0.72, 1.2, span=3.8)
    # masts, yards, gaffs, derricks; hatches and winches in the wells
    fore = Mast(hull, 0.775, zd(0.775), 13.0, 22.0, 22.0, 0.07, 0.3, top=(2.0, 1.4), pole=0.0)
    main = Mast(hull, 0.27, zd(0.27), 12.0, 19.5, 19.5, 0.07, 0.28, top=(1.8, 1.3), pole=0.0, square=False)
    for mp in (fore, main):
        mp.build(S, hoops=True)
        mp.shrouds(S, hull, sheer, sheer(mp.t) - 0.3, n=(4, 2, 0) if S.fine else (2, 1, 0))
    if line:
        yards = square_yards(S, fore, [(13.0 - 1.2, 13.0, 0.2, 0.34, 1), (13.0 + 3.6, 10.5, 0.16, 0.27, 2), (22.0 + 0.4, 7.5, 0.12, 0.18, 2)])
    else:
        yards = square_yards(S, fore, [(13.0 - 1.2, 12.0, 0.19, 0.32, 1)])
    braces(S, yards, hull, sheer, [0.62, 0.62, 0.62])
    g0 = main.at(main.h1 - 1.0)
    g1 = g0 + V(0, 7.0 * math.cos(0.5), 7.0 * math.sin(0.5))
    S.spar(g0, g1, 0.14, 0.09)
    b0, b1 = main.at(main.zd + 2.4), main.at(main.zd + 2.4) + V(0, 8.0, 0.3)
    S.spar(b0, b1, 0.15, 0.1)
    bundle(m, b0 + V(0, 0.5, 0.3), b1 + V(0, -0.6, 0.28), 0.3, CANVAS, n=4, sides=S.n(6))
    bundle(m, g0 + V(0, 0.5, -0.3), g1 + V(0, -0.6, -0.3), 0.24, CANVAS, n=4, sides=S.n(6))
    fg0 = fore.at(fore.h1 - 1.6)
    fg1 = fg0 + V(0, 5.0 * math.cos(0.5), 5.0 * math.sin(0.5))
    S.spar(fg0, fg1, 0.12, 0.08)
    bundle(m, fore.at(fore.zd + 2.6) + V(0, 0.4, 0), fg0 + V(0, 0.4, -0.5), 0.26, CANVAS, n=3, sides=S.n(6))
    for a_, b_ in ((g1, b1), (main.head(2) - V(0, 0, 0.4), g1), (fore.head(2) - V(0, 0, 0.4), fg1)):
        m.line(a_, b_)
    flag(m, g1 + V(0, 0.05, -0.05), 1.6, 1.05, along=(0, 0.25, -1), kind="belgian" if line else "red")
    for mp, face, hatches in ((fore, -1, ((0.81, 0.855), (0.665, 0.71))), (main, 1, ((0.31, 0.355), (0.175, 0.22)))):
        for k, (t0_, t1_) in enumerate(hatches):
            ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
            tc = (t0_ + t1_) / 2
            hatch(S, (0, (ya + yb) / 2, zd(tc)), 3.4, yb - ya, 0.7, coaming=IRONHULL)
            sx = 1 if k == 0 else -1
            head = derrick(S, mp, sx, face * (1 if k == 0 else -1), length=abs((ya + yb) / 2 - mp.y) + 0.4, rise=6.0, out=0.9)
        wy = mp.y + face * 1.6
        steam_winch(S, (0, wy, mp.zd), 0.0)
        steam_winch(S, (0, mp.y - face * 1.7, mp.zd), math.pi)
        fife_rail(S, mp.at(mp.zd), 1.4, 1.3, h=0.7)
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.3, sheer(1.0))
    m.line(fore.head(1), stem)
    m.line(fore.head(2), stem + V(0, 0.2, 0.2))
    m.line(main.head(1), ring + V(0, 0.6, 0.6))
    m.line(main.head(2), fore.head(2) - V(0, 0, 1.0))
    # the forecastle: windlass, catheads and anchors, bitts; the poop: wheel, skylight, flagstaff
    windlass_gear(S, 0, hull.y(0.94, zr(0.94)), zr(0.94) + 0.4, w=2.0, r=0.22)
    for sx in (1, -1):
        cathead_anchor(S, hull, sheer, 0.935, sx, 0.8, 0.5)
        if S.near:
            for t in (0.9, 0.06):
                bitts(m, sx * 2.2, hull.y(t, zr(t)), zr(t), 0.6, 0.25)
    zq = zr(0.07)
    helm(S, 0, hull.y(0.07, zq), zq, 0.6)
    skylight(S, (0, hull.y(0.105, zr(0.105)), zr(0.105)), 1.6, 1.3, 0.5)
    flagstaff(S, V(0, hull.y(0.0, sheer(0.0)) - 0.4, zr(0.0)), 4.5, "belgian" if line else "british")
    # cargo and gear on deck
    coils(S, [(1.4, hull.y(0.95, zr(0.95)), zr(0.95)), (-1.4, hull.y(0.95, zr(0.95)), zr(0.95)), (1.8, hull.y(0.25, zd(0.25)), zd(0.25)),
              (-1.2, hull.y(0.04, zr(0.04)), zr(0.04))], 0.32)
    if not line:
        casks(S, [(-2.2, hull.y(0.34, zd(0.34)), zd(0.34)), (-1.5, hull.y(0.34, zd(0.34)), zd(0.34))])
    else:
        zc = zd(0.69)
        for i, (x, dy, sz) in enumerate(((-2.4, 0.0, (1.1, 0.9, 0.8)), (2.5, 0.3, (1.0, 1.0, 0.9)))):
            if S.near:
                crate_lo(m, (x, hull.y(0.69, zc) + dy, zc), size=sz, yaw=0.15 * i)
            S.blk((x, hull.y(0.69, zc) + dy, zc + sz[2] / 2), (sz[0] + 0.3, sz[1] + 0.3, sz[2]))
    # the screw and the rudder under the counter
    screw(S, L / 2 - 0.9, -2.3, 1.5, 0.3)
    if S.near:
        m.box((0, L / 2 - 0.15, KZ + 0.55), (0.25, 3.0, 0.3), IRON)
    rud = [V(0, L / 2 + 0.15, KZ + 0.9), V(0, L / 2 + 1.6, KZ + 0.9), V(0, L / 2 + 1.6, 0.4), V(0, L / 2 + 0.15, 0.9)]
    m.prism([p + V(-0.08, 0, 0) for p in rud], (0.16, 0, 0), IRON, tile=2.0)
    # names: on both bows; the name and the port round the counter
    side_zone(S, hull, "bow_p", 1, 0.92, sheer(0.92) - 0.62, 3.6, 0.45)
    side_zone(S, hull, "bow_s", -1, 0.92, sheer(0.92) - 0.62, 3.6, 0.45)
    stern_zone(S, hull, "stern", sheer(0.0) - 0.75, 3.6, 0.62, tmax=0.07, board=None)
    # M7 boats: a riding light forward
    lanterns(S, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 3.0), 0)
    return S.finish(lambda dd: steamer(variant, dd), levels=1)


# ------------------------------------------------------------------ the liner


def liner(d=0):
    """The Kempenland (our own name, not a real ship): an ocean steamer of the Antwerp - New York line, 1873, ~97 m,
    after what is known of the line's first ships (Palmers, Jarrow, 1872-73: iron, single screw, 320 ft by 38 ft
    6 in). Clipper bow with a bowsprit, a gilt scroll at the head and on the knee, an elliptical counter with the gilt
    board of her name and port; black hull with two rows of brass-rimmed ports, a white sheer strake, red below the
    waterline. Long low deckhouses with skylights and cowls, an open bridge before the funnel (black, a white band
    with the line's red star), four masts: square yards on the fore and main, gaffs on all four; eight boats in
    davits. She lies at anchor: the port anchor is down (its chain runs from the hawse forward into the water), a
    derrick at the mizzen is swung out over the port side (+X, the town side) with a sling for the lighters, the
    accommodation ladder is down on that side forward."""
    S = Ship(d)
    m = S.m
    L, B, KZ, SZ = 97.0, 11.7, -6.0, 4.6

    def keel(t):
        return KZ + 0.6 * sm((t - 0.95) / 0.05) + 1.3 * sm((0.05 - t) / 0.05)

    def sheer(t):
        return SZ + 1.5 * max(0.0, (t - 0.6) / 0.4) ** 2 + 0.8 * max(0.0, (0.3 - t) / 0.3) ** 2

    SEC = [(0, 0.55), (0.08, 0.88), (0.2, 0.98), (1, 1.0)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.64:
            f = (t - 0.64) / 0.36
            p = (1 - min(f, 1.0) ** 1.8) ** (0.75 * (1 + 0.7 * (1 - u)))
        elif t < 0.28:
            f = (0.28 - t) / 0.28
            p = (1 - min(f, 1.0) ** 2) ** (0.4 + 1.8 * (1 - u))
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -5.0 * u ** 1.6 * sm((t - 0.9) / 0.1) + 3.4 * u ** 2.2 * sm((0.06 - t) / 0.06)

    levels = [keel, lambda t: keel(t) + 0.5, lambda t: keel(t) + 1.0, lambda t: -4.2, lambda t: -2.6, lambda t: -1.2,
              lambda t: -0.02, lambda t: 0.6, lambda t: 1.1, lambda t: 1.65, lambda t: sheer(t) - 2.2, lambda t: sheer(t) - 1.65,
              lambda t: sheer(t) - 0.22, sheer]
    mats = [(REDLEAD, 0)] * 6 + [(IRONHULL, 0), (IRONHULL, 0), (PORTS, 8.0), (IRONHULL, 0), (PORTS, 8.0), (IRONHULL, 0), (WHITE, 0)]
    hull = loft(S, L, (0.4, 0.64, 0.97), levels, mats, hb, yfn, lambda p: 0.5 + 0.5 * sm((p.z + 4.5) / 9.0),
                [[0, 2, 4, 6, 8, 9, 10, 11, 13], [0, 3, 6, 10, 13]], n=(64, 22, 10))

    def zd(t):
        return sheer(t) - 1.1

    PORT = 1  # +X: the side the lighters come to (the town side, as she lies)
    if S.fine:
        hull.wale(m, lambda t: sheer(t) - 1.62, 0.02, 0.99, h=0.12, out=0.05, mat=IRONHULL, shade=0.7)
        hull.wale(m, lambda t: sheer(t) - 0.24, 0.02, 0.985, h=0.05, out=0.03, mat=VARNISH, shade=1.0)
    deck(S, hull, zd, 0, 1, 0.12)
    bulwark(S, hull, zd, sheer, 0, 1, 0.12, WHITE, VARNISH, step=1.4)
    # the midship house (saloon and engine casing), rails on its roof
    zh = zd(0.5)
    hy0, hy1 = hull.y(0.64, zh), hull.y(0.40, zh)
    HH, HW = 2.4, 3.8
    wins = []
    for k in range(12):
        a = hy0 + 1.6 + (hy1 - hy0 - 2.4) * (k + 0.5) / 12
        wins += [("+x", a, zh + 1.5), ("-x", a, zh + 1.5)]
    deckhouse(S, -HW, HW, hy0, hy1, zh - 0.05, zh + HH, wall=WHITE, roof=DECK, windows=wins, door=("+y", 0.0, 0.9, 1.9),
              trim=VARNISH, walk=True)
    zr = zh + HH + 0.1
    if S.near:
        for sx in (1, -1):
            pipe_rail(S, [V(sx * (HW + 0.05), hy0 + 1.6, zr), V(sx * (HW + 0.05), hy1 + 0.2, zr)], 0.95, 1.6)
        pipe_rail(S, [V(-(HW + 0.05), hy1 + 0.2, zr), V(HW + 0.05, hy1 + 0.2, zr)], 0.95, 1.6)
    # the bridge across the ship at the front of the house
    by0, by1 = hy0 - 0.3, hy0 + 1.5
    zb = zr + 1.0
    bridge(S, by0, by1, zb, B / 2 + 0.3, wh=(1.3, 1.45))
    if S.near:
        for sx in (1, -1):
            for y in (by0 + 0.1, by1 - 0.1):
                m.beam((sx * (B / 2), y, zd(0.64)), (sx * (B / 2), y, zb - 0.06), 0.1, 0.1, IRON, side=(1, 0, 0))
            m.beam(V(sx * 1.8, by1 + 0.4, zr), V(sx * 1.8, by1 - 0.5, zb), 0.6, 0.06, IRON, side=(1, 0, 0))
    # the funnel: black, white band, red star; raked aft, steam pipe, guys; skylights and cowls
    fy = hull.y(0.53, zr)
    top, ring = funnel(S, 0, fy, zr, 1.45, 13.5, 0.1, FUNNEL_STAR, 1.0,
                       deck_pts=[(3.4, fy + 3.2, zr), (-3.4, fy + 3.2, zr), (3.4, fy - 1.5, zr), (-3.4, fy - 1.5, zr)])
    for sx in (1, -1):
        cowl(S, sx * 2.2, fy - 2.6, zr, 2.6, 0.5, -1)
        cowl(S, sx * 2.2, fy + 3.0, zr, 2.2, 0.45, -1)
        cowl(S, sx * 2.0, hull.y(0.79, zd(0.79)), zd(0.79), 1.8, 0.38, -1)
        cowl(S, sx * 1.8, hull.y(0.25, zd(0.25)), zd(0.25), 1.6, 0.34, 1)
    skylight(S, (0, fy + 5.2, zr), 2.2, 3.0, 0.6)
    skylight(S, (0, fy + 9.5, zr), 2.0, 2.4, 0.5)
    if S.near:
        chimney(m, 2.6, fy - 4.0, zr, 1.2, 0.16)
        if S.fine:
            m.stove(V(2.6, fy - 4.0, zr + 1.45))
    # boats in davits: three each side along the house, one each side on the quarters
    for sx in (1, -1):
        for tb in (0.455, 0.53, 0.605, 0.25):
            davit_pair(S, hull, tb, zd(tb), sx, 7.0, 1.9, 0.8, 1.8, span=5.2)
    # the saloon house aft with its skylight, the wheel and steering house, the flagstaff
    sa0, sa1 = hull.y(0.155, zd(0.1)), hull.y(0.065, zd(0.1))
    zs = zd(0.1) - 0.05
    sw = []
    for k in range(5):
        a = sa0 + (sa1 - sa0) * (k + 0.5) / 5
        sw += [("+x", a, zs + 1.4), ("-x", a, zs + 1.4)]
    deckhouse(S, -3.0, 3.0, sa0, sa1, zs, zs + 2.2, wall=VARNISH, roof=DECK, windows=sw, door=("-y", 0.0, 0.9, 1.9), trim=WHITE,
              walk=True)
    skylight(S, (0, (sa0 + sa1) / 2, zs + 2.3), 2.0, 3.0, 0.5)
    if S.near:
        pipe_rail(S, [V(-3.05, sa0, zs + 2.3), V(-3.05, sa1, zs + 2.3), V(3.05, sa1, zs + 2.3), V(3.05, sa0, zs + 2.3)], 0.9, 1.6)
    zq = zd(0.03)
    helm(S, 0, hull.y(0.03, zq), zq, 0.7)
    flagstaff(S, V(0, hull.y(0.0, sheer(0.0)) - 0.5, zd(0.0)), 5.5, "belgian", 2.4, 1.6)
    # masts: four; square yards on the fore and main (furled), gaffs on all
    fore = Mast(hull, 0.855, zd(0.855), 16.0, 27.0, 34.0, 0.05, 0.42, top=(3.0, 2.0))
    main = Mast(hull, 0.745, zd(0.745), 16.5, 28.0, 35.0, 0.05, 0.42, top=(3.0, 2.0))
    mizz = Mast(hull, 0.36, zd(0.36), 15.0, 25.0, 25.0, 0.06, 0.36, top=(2.4, 1.7), pole=0.0, square=False)
    jigg = Mast(hull, 0.21, zd(0.21), 13.0, 21.0, 21.0, 0.06, 0.32, top=(2.0, 1.5), pole=0.0, square=False)
    for mp in (fore, main, mizz, jigg):
        mp.build(S, hoops=mp in (mizz, jigg))
        mp.shrouds(S, hull, sheer, sheer(mp.t) - 0.4, n=((5, 3, 2) if mp in (fore, main) else (4, 2, 0)) if S.fine else (3, 2, 1))
    for mp, bt in ((fore, [0.8, 0.79, 0.78]), (main, [0.66, 0.66, 0.66])):
        h1, h2, h3 = mp.h1 - mp.zd, mp.h2 - mp.zd, mp.h3 - mp.zd
        ys = square_yards(S, mp, [(h1 - 1.6, 20.0, 0.26, 0.42, 1), (h1 + (h2 - h1) * 0.5, 16.0, 0.2, 0.32, 2),
                                  (h2 + (h3 - h2) * 0.55, 11.0, 0.13, 0.2, 3)])
        braces(S, ys, hull, sheer, bt)
    for mp, glen, blen in ((fore, 6.0, 0.0), (main, 6.5, 0.0), (mizz, 8.0, 0.0), (jigg, 8.0, 10.0)):
        g0 = mp.at(mp.h1 - 1.2)
        g1 = g0 + V(0, glen * math.cos(0.5), glen * math.sin(0.5))
        S.spar(g0, g1, 0.15, 0.09)
        m.line(mp.head(2) - V(0, 0, 0.5), g1)
        if blen:
            b0 = mp.at(mp.zd + 2.4)
            b1 = b0 + V(0, blen, 0.3)
            S.spar(b0, b1, 0.17, 0.11)
            bundle(m, b0 + V(0, 0.5, 0.3), b1 + V(0, -0.6, 0.28), 0.3, CANVAS, n=4, sides=S.n(6))
            bundle(m, g0 + V(0, 0.5, -0.3), g1 + V(0, -0.6, -0.3), 0.26, CANVAS, n=4, sides=S.n(6))
            m.line(g1, b1)
        else:
            bundle(m, mp.at(mp.zd + 3.0) + V(0, 0.5, 0), g0 + V(0, 0.5, -0.5), 0.28, CANVAS, n=3, sides=S.n(6))
    # the house flag (white, red star) at the main truck, pennant at the fore
    flag(m, main.head(3) + V(0, 0, main.pole + 0.95), 1.6, 1.1, along=(0, 1, 0), kind="house")
    pennant(m, fore.head(3) + V(0, 0, fore.pole + 0.3), 5.0, h=0.35)
    # bowsprit and jibboom over the clipper stem, the jib furled; the knee of the head with its gilt scroll
    heel, dv, bs_end, jbs, jbe = bowsprit_rig(S, hull, sheer, 12, 2.6, 10.0, 7.0, 17.5, 0.38, 0.2, striker=2.2)
    zf0 = sheer(1.0) - 1.6
    fb = V(0, hull.y(1.0, zf0) - 0.05, zf0)
    head_knee(S, hull, 1.2, zf0 - 0.2, fb, out=0.9, thick=0.36)
    if S.near:
        sc = [fb + V(0, 0.15, -0.3), fb + V(0, -0.35, 0.15), fb + V(0, -0.7, 0.7), fb + V(0, -0.45, 1.05), fb + V(0, -0.2, 0.85)]
        m.tube(sc, [0.2, 0.22, 0.17, 0.12, 0.06], S.n(6), VARNISH, smooth=False, cap0=True, cap1=True, side=(1, 0, 0))
        for sx in (1, -1):
            a_ = hull.P(0.96, sheer(0.96) - 0.35, sx)
            b_ = V(sx * 0.5, hull.y(1.0, sheer(1.0) - 1.0) - 0.4, sheer(1.0) - 1.1)
            m.tube([a_, b_, fb + V(sx * 0.16, -0.25, 0.1)], [0.07, 0.06, 0.05], 4, VARNISH, smooth=False, side=(0, 0, 1))
    # stays (the main stay goes to the funnel: steamers did)
    for a_, b_ in ((fore.head(1), heel + dv * 5.5), (fore.head(2), jbs + dv * 5.0), (fore.head(3) - V(0, 0, 1.2), jbe),
                   (main.head(1), fore.at(fore.zd + 1.4) + V(0, 0.6, 0)), (main.head(2), fore.head(2) - V(0, 0, 1.0)),
                   (main.head(3) - V(0, 0, 1.2), fore.head(3) - V(0, 0, 1.4)),
                   (mizz.head(1), ring + V(0, 0.7, 0.7)), (mizz.head(2), main.head(2) - V(0, 0, 0.6)),
                   (jigg.head(1), mizz.at(mizz.h1 - 3.0)), (jigg.head(2), mizz.head(1) + V(0, 0, 0.4))):
        m.line(a_, b_)
    # fife rails; derricks resting at the fore and main; at the mizzen one swung out over the port side, a sling of
    # cargo on its fall, over where the lighters lie
    for mp in (fore, main, mizz, jigg):
        fife_rail(S, mp.at(mp.zd), 1.8, 1.8)
    for mp in (fore, main):
        for sx in (1, -1):
            dh = mp.at(mp.zd + 1.4) + V(sx * 0.45, -0.45, 0)
            dt = dh + V(sx * 1.2, -7.0, 6.2)
            S.spar(dh, dt, 0.15, 0.09)
            m.line(dt, mp.at(mp.h1 - 0.5))
    dh = mizz.at(mizz.zd + 1.4) + V(PORT * 0.45, -0.45, 0)
    dt = dh + V(PORT * 9.2, -2.2, 5.8)
    S.spar(dh, dt, 0.17, 0.1)
    m.line(dt, mizz.at(mizz.h1 - 0.4))
    for tg in (0.33, 0.43):
        m.line(dt, hull.P(tg, sheer(tg), PORT) + V(0, 0, 0.1))
    sling = dt - V(0, 0, 4.2)
    m.line(dt, sling + V(0, 0, 0.9))
    for dx, dy in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
        m.line(sling + V(0, 0, 0.9), sling + V(dx * 0.9, dy * 1.1, 0.0))
    if S.near:
        crate_lo(m, sling + V(0, 0, -0.62), size=(1.1, 1.3, 0.62))
    # hatches with tarpaulins; winches
    for t0_, t1_ in ((0.89, 0.92), (0.79, 0.825), (0.67, 0.705), (0.29, 0.33)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        tc = (t0_ + t1_) / 2
        hatch(S, (0, (ya + yb) / 2, zd(tc)), 4.0, yb - ya, 0.7, coaming=IRONHULL)
    for mp, f in ((fore, 1), (main, 1), (mizz, -1)):
        steam_winch(S, (0, mp.y + f * 1.8, mp.zd), 0.0 if f > 0 else math.pi)
    # the windlass; the starboard anchor at its cathead; the port hawse, and the port anchor's chain from the
    # windlass to the hawse and out of it, forward and down into the river
    yw = hull.y(0.945, zd(0.945))
    windlass_gear(S, 0, yw, zd(0.945) + 0.45, w=2.6, r=0.26)
    cathead_anchor(S, hull, sheer, 0.955, -PORT, 1.1, 0.6)
    hz = sheer(0.97) - 1.3
    hawse = hull.P(0.97, hz, PORT) + V(PORT * 0.05, 0, 0)
    m.box(hawse, (0.18, 0.6, 0.6), IRON)
    if S.near:
        m.box(hull.P(0.962, hz - 0.9, PORT) + V(PORT * 0.08, 0, 0), (0.12, 2.2, 1.6), IRONHULL)  # the bill board
    deck_hawse = hull.P(0.965, zd(0.965), PORT, 0.5) + V(0, 0, 0.05)
    m.line(V(PORT * 0.9, yw, zd(0.945) + 0.5), deck_hawse)
    ahead, drop = 18.0, hz + 5.0
    prev = hawse + V(PORT * 0.12, 0, 0)
    for k in range(1, 9):
        s_ = k / 8
        p = hawse + V(PORT * (0.12 + 0.8 * s_), -ahead * s_, -drop * (1 - (1 - s_) ** 2))
        m.line(prev, p)
        prev = p
    if S.fine:
        m.extras["hawse"] = [round(hawse.x, 3), round(hawse.y, 3), round(hawse.z, 3)]
    # the accommodation ladder, down the port side forward of the lighters
    lt, lb_ = hull.P(0.79, zd(0.79), PORT), hull.P(0.835, 0.7, PORT)
    top_ = lt + V(PORT * 0.35, 0, 0.05)
    low = lb_ + V(PORT * 1.3, 0, 0)
    m.beam(top_, low, 0.8, 0.12, WOOD, side=(1, 0, 0))
    m.box(low + V(0, -0.7, -0.05), (1.3, 1.4, 0.12), WOOD)
    if S.fine:
        for k in range(1, 14):
            p = top_.lerp(low, k / 14)
            m.box(p + V(0, 0, 0.07), (0.78, 0.18, 0.04), DARK)
    for dx in (-0.4, 0.4):
        m.line(top_ + V(dx, 0, 1.0), low + V(dx, 0, 1.0))
        m.line(low + V(dx, 0, 0), low + V(dx, 0, 1.0))
    m.line(top_ + V(0, 0, 3.5), low + V(0, 0, 0.1))
    # names: on both bows; the name and the port round the counter on a gilt-edged board
    side_zone(S, hull, "bow_p", 1, 0.935, sheer(0.935) - 0.75, 4.6, 0.55)
    side_zone(S, hull, "bow_s", -1, 0.935, sheer(0.935) - 0.75, 4.6, 0.55)
    stern_zone(S, hull, "stern", sheer(0.0) - 0.85, 4.6, 0.75, tmax=0.08)
    # cargo and gear on deck
    coils(S, [(-1.6, hull.y(0.95, zd(0.95)), zd(0.95)), (1.6, hull.y(0.95, zd(0.95)), zd(0.95)), (2.4, hull.y(0.3, zd(0.3)), zd(0.3)),
              (-1.6, hull.y(0.05, zd(0.05)), zd(0.05))], 0.36)
    casks(S, [(-3.0, hull.y(0.27, zd(0.27)), zd(0.27)), (-2.3, hull.y(0.27, zd(0.27)), zd(0.27)), (2.8, hull.y(0.27, zd(0.27)), zd(0.27))])
    # the screw and the rudder under the counter
    screw(S, L / 2 - 1.4, -3.6, 2.3, 0.45)
    if S.near:
        m.box((0, L / 2 - 0.3, KZ + 0.85), (0.3, 3.8, 0.35), IRON)
    rud = [V(0, L / 2 + 0.2, KZ + 1.3), V(0, L / 2 + 2.4, KZ + 1.3), V(0, L / 2 + 2.4, 0.3), V(0, L / 2 + 0.2, 0.9)]
    m.prism([p + V(-0.1, 0, 0) for p in rud], (0.2, 0, 0), IRON, tile=2.0)
    # M7 boats: riding lights forward and aft (at anchor in the roads)
    lanterns(S, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 4.0), 0)
    lanterns(S, V(0, hull.y(0.04, sheer(0.04)), sheer(0.04) + 2.5), 0)
    return S.finish(liner, levels=1)
