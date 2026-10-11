"""The small boats, every one of them can be taken and rowed: rowboat, dinghy, ship's boat, water
police gig, bumboat, old boat, punt, work boat (vlet) and eel boat. The open boat's hull (boat_hull) and
the ship's boat carried on deck (ships_boat) live in common.py, since barges and ships carry them too.

B4 (2026-10-11, Steve: "Remodel all boats in high detail, good textures, different names and names correctly
on boats ... no water in the boats themselves ... More differentiation"; "jump from quay and land in them, press
key to use them"). Each hull is built plank by plank from the lines of its kind (the same keel, sheer and
breadths as before, so the rowing numbers, the extra "row" and shared/smallBoats.ts HULLS stay as they were):

- the skin in strakes: clinker lands that stand proud and cast their line (rowboat, dinghy, bumboat, old boat,
  the flat boats' sides), or smooth carvel (ship's boat, gig, punt); each strake its own paint, the lands of the
  texture on the lands of the planks (one strake a board of the picture);
- inside: the same strakes with their lands, steamed frames, the hog and keelson, risers, thwarts on the risers
  with hanging knees, stern sheets, a breasthook and quarter knees, bottom boards in loose panels (the after
  ones wet: the only bilge water drawn, never the river), the inwale and capping, a rubbing strake outside;
- the gear of each kind: thole pins in chocks or iron crutches, oars laid in (the "_stow" node), a painter from
  the stem ring, fenders, a bailer, and what the kind carries (the eel boat's well and fykes, the bumboat's hood
  and goods, the old boat's rot and patches, the gig's flag and lantern, the dinghy's mast and sail);
- the nodes of the boat contract (docs/boats.md): "_cap" (the water cap on the rail, from m.hulls), "_walk"
  (the bottom boards, thwarts and sheets as triangles), "_block" (boxes a walker cannot pass), "_far" (the far
  copy, about a fifth), "_name_bow_p", "_name_bow_s", "_name_stern" (the name zones on small dark boards, UVs
  0..1, winding outward; the root's extra "name_zones" gives their sizes, each 4:1 like the names atlas cells).

Everything here is our own work, built from code.
"""

from contextlib import contextmanager

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ the rowing numbers


def row_info(m, hull, sheer, t_seat, z_seat, t_pin, beam_k=0.93, half_k=0.98, speed=1.0, bow_t=1.0, stern_t=0.0):
    """M7 boats: what the game needs to row this boat (game frame: x across, y up, z toward the bow),
    stored as the glTF extra "row" and checked against shared/smallBoats.ts by the boat check."""
    def yz(t, z):
        return -hull.y(t, z)  # Blender -y is the game's +z

    zp = sheer(t_pin) + 0.06
    stem = hull.P(bow_t, sheer(bow_t), 1)
    tail = hull.P(stern_t, sheer(stern_t), 1)
    m.extras["row"] = {
        "half": round(hull.L / 2 * half_k, 3),
        "beam": round(max(hull.hb(t, sheer(t)) for t in hull.ts) * beam_k, 3),
        "seatZ": round(yz(t_seat, z_seat), 3),
        "seatY": round(z_seat + 0.02, 3),
        "pin": [round(hull.hb(t_pin, sheer(t_pin)) + 0.02, 3), round(zp, 3), round(yz(t_pin, zp), 3)],
        "len": round(hull.L, 3),
        "speed": speed,
        # the painter's ring at the stem and the stern's ring: where the mooring ropes are made fast
        "bow": [0.0, round(sheer(bow_t) - 0.05, 3), round(-stem.y, 3)],
        "stern": [0.0, round(sheer(stern_t) - 0.05, 3), round(-tail.y, 3)],
    }


# ------------------------------------------------------------------ paint, planks and lines

# boards a picture tile holds across (the painters in common.py): a strake maps onto one board of its picture,
# so the painted seams and lands fall on the planks' own edges
BOARDS = {TAR: 8, TARWEED: 8, CLINKER: 8, VARNISH: 8, WHITE: 4, GREEN: 2, WOOD: 4, DECK: 10, IRONHULL: 2}
TH = 0.016   # plank thickness
LAP = 0.014  # how far a clinker strake's lower edge stands proud of the one below

# paint over the white and the wood (the vertex colour multiplies the picture; docs/boats.md)
RED = (0.62, 0.27, 0.19)
OCHRE = (0.92, 0.72, 0.38)
BLUE = (0.36, 0.5, 0.68)
PALE_BLUE = (0.66, 0.78, 0.86)
OXBLOOD = (0.5, 0.2, 0.15)
BLACK = (0.32, 0.31, 0.31)
GREY = (0.82, 0.82, 0.8)
WEATHER = (0.86, 0.88, 0.84)
MOSS = (0.62, 0.74, 0.5)
CREAM = (1.0, 0.95, 0.82)


@contextmanager
def paint(m, rgb=None, water=False):
    """Faces drawn inside take this colour cast (and the waterline's slime) in their vertex colour."""
    old = m.tintfn
    if rgb is None and not water:
        m.tintfn = None
    else:
        r0, g0, b0 = rgb or (1.0, 1.0, 1.0)

        def fn(p):
            if water:
                r, g, b = waterline_tint(p)
                return (r0 * r, g0 * g, b0 * b)
            return (r0, g0, b0)
        m.tintfn = fn
    try:
        yield
    finally:
        m.tintfn = old


def sheet(m, P, UV, mat, out, smooth=True, shade=1.0):
    """Quads over a grid of points P[i][j] (i along the hull, j across it), sharing their corners (smooth
    planks); each face looks along out(centre)."""
    vs = [[m.vert(p) for p in row] for row in P]
    for i in range(len(P) - 1):
        for j in range(len(P[0]) - 1):
            idx = [(i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)]
            pts = [P[a][b] for a, b in idx]
            n = (pts[2] - pts[0]).cross(pts[3] - pts[1])
            c = sum(pts, Vector()) / 4
            if n.length < 1e-10:
                continue
            if n.dot(out(c)) < 0:
                idx = idx[::-1]
                pts = pts[::-1]
            m.face([vs[a][b] for a, b in idx], [UV[a][b] for a, b in idx], mat, shade, smooth, local=pts)


def uv_of(mat, p, row, across):
    """A strake's texture place: u along the hull in metres a tile, v one board of the picture."""
    nb = BOARDS.get(mat, 0)
    tile = TILE.get(mat, 2.0)
    if nb:
        return (-p.y / tile, (row % nb + across) / nb)
    return (-p.y / tile, p.z / tile)


class Lines:
    """The lines of a small hull: each station's section from the keel's rabbet (or the chine) up to the sheer,
    measured along its girth, so strakes can be laid by girth fractions (wide amidships, narrow at the ends)."""

    def __init__(self, hull, low, sheer, nz=28):
        self.h, self.low, self.sheer, self.nz = hull, low, sheer, nz
        self._sec = {}

    def section(self, t):
        s = self._sec.get(t)
        if s is None:
            k, top = self.low(t), self.sheer(t)
            pts = [self.h.P(t, k + (top - k) * (j / self.nz), 1) for j in range(self.nz + 1)]
            g = [0.0]
            for a, b in zip(pts, pts[1:]):
                g.append(g[-1] + math.hypot(b.x - a.x, b.z - a.z) + 1e-7)
            s = self._sec[t] = (pts, g)
        return s

    def _find(self, t, f):
        pts, g = self.section(t)
        s = cl(f) * g[-1]
        j = 0
        while j < len(g) - 2 and g[j + 1] < s:
            j += 1
        w = (s - g[j]) / max(g[j + 1] - g[j], 1e-9)
        return pts[j], pts[j + 1], cl(w)

    def normal(self, t, f, sx=1):
        a, b, _ = self._find(t, f)
        d = b - a
        n = V(d.z, 0, -d.x)
        if n.length < 1e-9:
            n = V(1, 0, 0)
        n.normalize()
        return V(n.x * sx, 0, n.z)

    def at(self, t, f, sx=1, off=0.0):
        a, b, w = self._find(t, f)
        p = a.lerp(b, w)
        q = p + self.normal(t, f, 1) * off
        return V(q.x * sx, q.y, q.z)

    def f_of_z(self, t, z):
        pts, g = self.section(t)
        if z <= pts[0].z:
            return 0.0
        for j in range(len(pts) - 1):
            if pts[j + 1].z >= z:
                w = (z - pts[j].z) / max(pts[j + 1].z - pts[j].z, 1e-9)
                return (g[j] + w * (g[j + 1] - g[j])) / g[-1]
        return 1.0

    def at_z(self, t, z, sx=1, off=0.0):
        return self.at(t, self.f_of_z(t, z), sx, off)


def skin(m, ln, T, F, mats, lap=LAP, inner=False, inner_mat=WOOD, inner_tint=None, smooth=True, shade=None):
    """The planking: strake k runs between the girth fractions F[k] and F[k + 1] at every station of T, its paint
    mats[k] = (material, tint). lap > 0: clinker (each strake's lower edge proud of the one below, and the edge
    of the plank drawn); inner: the inside of the same planks, facing in, with the lands as ledges."""
    N = len(F) - 1
    for sx in (1, -1):
        for k in range(N):
            if inner:
                mat, tint = inner_mat, inner_tint
                o_lo, o_hi = (lap - TH if (lap and k > 0) else -TH), -TH
            else:
                mat, tint = mats[k]
                o_lo, o_hi = (lap if k > 0 else 0.0), 0.0
            P = [[ln.at(t, F[k], sx, o_lo), ln.at(t, F[k + 1], sx, o_hi)] for t in T]
            UV = [[uv_of(mat, p, k, a) for p, a in zip(row, (0.0, 1.0))] for row in P]
            sgn = -1 if inner else 1

            def out(c, sx=sx, sgn=sgn):
                return V(c.x - 0.0, 0, c.z - (ln.sheer(0.5) + 0.6)) * sgn if abs(c.x) > 1e-4 else V(sx * sgn, 0, 0)

            with paint(m, tint, water=not inner):
                m.shadefn = shade
                sheet(m, P, UV, mat, out, smooth=smooth)
                m.shadefn = None
                if lap and k > 0:
                    # the plank's edge (outside) or the ledge of the land (inside)
                    if inner:
                        Q = [[ln.at(t, F[k], sx, -TH), ln.at(t, F[k], sx, lap - TH)] for t in T]
                    else:
                        Q = [[ln.at(t, F[k], sx, 0.0), ln.at(t, F[k], sx, lap)] for t in T]
                    QU = [[uv_of(mat, row[0], k, 0.0), uv_of(mat, row[1], k, 0.03)] for row in Q]
                    t_mid = T[len(T) // 2]
                    down = ln.at(t_mid, F[k] - 0.04, sx) - ln.at(t_mid, F[k], sx)
                    edge_out = (-down if inner else down)
                    sheet(m, Q, QU, mat, lambda c, e=edge_out: e, smooth=False, shade=0.55 if not inner else 0.9)


def flat_part(m, ln, T, mat, off, up, tint=None, shade=0.8, water=True):
    """The middle of the bottom between the two garboards (the hog, or a flat boat's bottom): at offset `off`
    (0 the outside, -TH the inside), facing down (up=False) or up."""
    P = [[ln.at(t, 0.0, -1, off), ln.at(t, 0.0, 1, off)] for t in T]
    tile = TILE.get(mat, 2.0)
    UV = [[(-p.y / tile, p.x / tile) for p in row] for row in P]
    with paint(m, tint, water=water):
        sheet(m, P, UV, mat, lambda c: V(0, 0, 1 if up else -1), smooth=False, shade=shade)


def end_board(m, ln, t, mat, tint=None, thick=0.03, out_y=1, shade=0.85, water=True, inside_mat=None):
    """A flat end of the hull (a transom, a punt's raked ends): the section at t closed by a board, its outer face
    toward out_y (+1 astern, -1 ahead), planked across."""
    side = [ln.at(t, j / 12, 1, 0.0) for j in range(13)]
    poly = [mirror(p, -1) for p in reversed(side)] + (side if abs(side[0].x) > 0.02 else side[1:])
    tile = TILE.get(mat, 1.6)
    with paint(m, tint, water=water):
        m.poly(poly, mat, out=(0, out_y, 0.0), shade=shade, uvs=[(p.x / tile, p.z / tile) for p in poly])
        iside = [ln.at(t, j / 12, 1, -TH) for j in range(13)]
        ipoly = [mirror(p, -1) for p in reversed(iside)] + (iside if abs(iside[0].x) > 0.02 else iside[1:])
        inner = [p + V(0, -out_y * thick, 0) for p in ipoly]
        im = inside_mat if inside_mat is not None else mat
        m.poly(inner, im, out=(0, -out_y, 0.0), shade=shade * 0.8, uvs=[(p.x / tile, p.z / tile) for p in inner])
    return poly


def gunwale(m, ln, T, cap_mat=DARK, cap_tint=None, rub_mat=DARK, rub_tint=None, rub=True, w_in=0.045, cap_h=0.024,
            rub_h=0.05, rub_out=0.03, inwale_h=0.055):
    """The capping on the sheer (its top and outer edge), the inwale under it inside, and a rubbing strake (outwale)
    a little below the sheer outside."""
    for sx in (1, -1):
        def top(t, off):
            p = ln.at(t, 1.0, sx, off)
            return V(p.x, p.y, ln.sheer(t) + cap_h)

        P = [[top(t, 0.012), top(t, -TH - w_in)] for t in T]
        UV = [[(-p.y / 1.2, j * 0.1) for j, p in enumerate(row)] for row in P]
        with paint(m, cap_tint):
            sheet(m, P, UV, cap_mat, lambda c: V(0, 0, 1), smooth=False, shade=1.0)
            # the outer edge of the capping, down to the sheer strake
            P = [[top(t, 0.012), ln.at(t, 1.0, sx, 0.012) - V(0, 0, 0.004)] for t in T]
            UV = [[(-p.y / 1.2, 0.2 + 0.04 * j) for j, p in enumerate(row)] for row in P]
            sheet(m, P, UV, cap_mat, lambda c: V(sx, 0, 0), smooth=False, shade=0.8)
            # the inwale: its inner face and its underside
            P = [[top(t, -TH - w_in), top(t, -TH - w_in) - V(0, 0, cap_h + inwale_h)] for t in T]
            UV = [[(-p.y / 1.2, 0.4 + 0.06 * j) for j, p in enumerate(row)] for row in P]
            sheet(m, P, UV, cap_mat, lambda c: V(-sx, 0, 0), smooth=False, shade=0.75)
            P = [[top(t, -TH - w_in) - V(0, 0, cap_h + inwale_h), ln.at_z(t, ln.sheer(t) - inwale_h, sx, -TH)] for t in T]
            UV = [[(-p.y / 1.2, 0.5 + 0.04 * j) for j, p in enumerate(row)] for row in P]
            sheet(m, P, UV, cap_mat, lambda c: V(0, 0, -1), smooth=False, shade=0.5)
        if not rub:
            continue
        with paint(m, rub_tint):
            def rp(t, dz, off):
                p = ln.at_z(t, ln.sheer(t) - 0.012 - dz, sx, 0.0)
                return p + ln.normal(t, ln.f_of_z(t, p.z), sx) * off
            for dz0, dz1, o0, o1, outv, sh in ((0.0, rub_h, rub_out, rub_out, V(sx, 0, 0), 0.85),
                                               (0.0, 0.0, 0.0, rub_out, V(0, 0, 1), 1.0),
                                               (rub_h, rub_h, 0.0, rub_out, V(0, 0, -1), 0.45)):
                P = [[rp(t, dz0, o0), rp(t, dz1, o1)] for t in T[1:-1]]
                UV = [[(-p.y / 1.2, 0.6 + 0.03 * j) for j, p in enumerate(row)] for row in P]
                sheet(m, P, UV, rub_mat, lambda c, o=outv: o, smooth=False, shade=sh)


def frames(m, ln, ts, f_top=0.97, w=0.036, d=0.022, mat=WOOD, fs=(0.03, 0.17, 0.36, 0.6, 0.97), shade=0.72):
    """Steamed frames (timbers) inside, from the hog up to the inwale, lying on the inner planking."""
    for t in ts:
        for sx in (1, -1):
            pts = [ln.at(t, min(f, f_top), sx, -TH - d / 2 - 0.002) for f in fs]
            for a, b in zip(pts, pts[1:]):
                m.beam(a, b, w, d, mat, side=(0, 1, 0), shade=shade, caps=False)


def riser(m, ln, t0, t1, zfn, T, w=0.022, h=0.06, mat=WOOD):
    """A riser (the stringer the thwarts sit on) along the inside of each side at height zfn(t)."""
    span = [t0] + [t for t in T if t0 < t < t1] + [t1]
    for sx in (1, -1):
        pts = [ln.at_z(t, zfn(t), sx, -TH - w / 2) for t in span]
        for a, b in zip(pts, pts[1:]):
            m.beam(a, b, w, h, mat, side=(sx, 0, 0), shade=0.7, caps=False)


def half_in(ln, t, z, off=-TH):
    """Half the breadth inside the planking at station t, height z."""
    return abs(ln.at_z(t, z, 1, off).x)


def thwart(m, walk, ln, hull, t, z, width=0.22, th=0.035, mat=WOOD, tint=None, knees=True, pillar=False, hole=False):
    """A thwart across the boat, its top at z + th / 2, its ends on the risers; hanging knees up to the inwale."""
    y = hull.y(t, z)
    w = half_in(ln, t, z - th / 2) - 0.006
    with paint(m, tint):
        if hole:
            # the mast thwart: two halves round the mast's hole, an iron clamp over it
            for s in (1, -1):
                m.box((s * (w + 0.06) / 2, y, z), (w - 0.06, width, th), mat, shade=0.95)
            for dy in (-1, 1):
                m.box((0, y + dy * (width / 2 - 0.035), z), (0.12, 0.07, th), mat, shade=0.95)
            with m.at(move(0, y, z + th / 2)):
                m.lathe([(0.075, 0.0), (0.075, 0.012), (0.062, 0.012)], 8, IRON, smooth=False)
        else:
            m.box((0, y, z), (2 * w, width, th), mat, shade=0.95)
    top_quad(walk, -w, w, y - width / 2, y + width / 2, z + th / 2)
    if knees:
        for sx in (1, -1):
            a = V(sx * (w - 0.18), y, z + th / 2)
            b = ln.at_z(t, z + th / 2, sx, -TH - 0.004)
            c = ln.at_z(t, ln.sheer(t) - 0.06, sx, -TH - 0.004)
            mid = b.lerp(c, 0.35) + V(-sx * 0.07, 0, -0.02)
            pts = [a, b, c, mid]
            m.prism([p + V(0, -0.02, 0) for p in pts], (0, 0.04, 0), DARK, shade=0.75)
    if pillar:
        zb = ln.low(t) + 0.02
        m.beam(V(0, y, zb), V(0, y, z - th / 2), 0.045, 0.045, DARK, shade=0.6)


def top_quad(walk, x0, x1, y0, y1, z):
    """A walkable rectangle (the "_walk" node), facing up."""
    if walk is None:
        return
    walk.poly([V(x0, y0, z), V(x1, y0, z), V(x1, y1, z), V(x0, y1, z)], WOOD, out=(0, 0, 1))


def block_box(block, c, size):
    """A box a walker cannot pass (the "_block" node)."""
    if block is not None:
        block.box(c, size, DARK)


def sheets_seat(m, walk, ln, hull, t0, t1, z, th=0.035, mat=WOOD, tint=None, back=False, sides_to=None):
    """The stern sheets: a seat across the stern from t0 to t1 shaped to the hull at height z (and side benches
    forward to sides_to); a backboard against the transom when back."""
    T = [t0 + (t1 - t0) * k / 4 for k in range(5)]
    sp = [ln.at_z(t, z, 1, -TH - 0.004) for t in T]
    poly = sp + [mirror(p, -1) for p in reversed(sp)]
    top = [V(p.x, p.y, z + th / 2) for p in poly]
    with paint(m, tint):
        m.poly(top, mat, out=(0, 0, 1), shade=0.95, uvs=[(p.x / 1.2, -p.y / 1.2) for p in top])
        a, b = top[len(sp) - 1], top[len(sp)]
        m.poly([a, b, b - V(0, 0, th), a - V(0, 0, th)], mat, out=(0, -1, 0), shade=0.7)
        m.poly([V(p.x, p.y, z - th / 2) for p in poly], mat, out=(0, 0, -1), shade=0.4)
    if walk is not None:
        walk.poly(top, WOOD, out=(0, 0, 1))
    if sides_to:
        for sx in (1, -1):
            T2 = [t1 + (sides_to - t1) * k / 4 for k in range(5)]
            outer = [ln.at_z(t, z, sx, -TH - 0.004) for t in T2]
            inner = [p - V(sx * 0.2, 0, 0) for p in outer]
            pts = [V(p.x, p.y, z + th / 2) for p in outer + list(reversed(inner))]
            with paint(m, tint):
                m.poly(pts, mat, out=(0, 0, 1), shade=0.95, uvs=[(-p.y / 1.2, p.x / 1.2) for p in pts])
                for p, q in zip(inner, inner[1:]):
                    m.poly([V(p.x, p.y, z + th / 2), V(q.x, q.y, z + th / 2), V(q.x, q.y, z - th / 2), V(p.x, p.y, z - th / 2)],
                           mat, out=(-sx, 0, 0), shade=0.7)
            if walk is not None:
                walk.poly(pts, WOOD, out=(0, 0, 1))
    if back:
        ys = hull.y(0.0, z + 0.12) - 0.06
        wb = half_in(ln, 0.03, z + 0.06) - 0.03
        wt = half_in(ln, 0.03, z + 0.17) - 0.03
        with paint(m, tint):
            m.slab([V(-wb, ys, z + 0.03), V(wb, ys, z + 0.03), V(wt, ys + 0.03, z + 0.19), V(-wt, ys + 0.03, z + 0.19)],
                   0.025, mat, out=(0, -1, 0.15), shade=0.9)


def bottom_boards(m, walk, ln, hull, panels, z_of, plank=0.11, gap=0.014, mat=WOOD, wet=(), shade=0.78):
    """Bottom boards in loose panels: each panel (t0, t1) planks lengthwise at the height z_of(t) of its middle,
    as wide as the hull lets them; the planks in `wet` (panel, plank) are wet with bilge water (BILGE)."""
    for pi, (t0, t1) in enumerate(panels):
        tm = (t0 + t1) / 2
        z = z_of(tm)
        w = min(half_in(ln, t, z + 0.01) for t in (t0, tm, t1)) - 0.035
        n = max(2, int((2 * w + gap) / (plank + gap)))
        pw = (2 * w - (n - 1) * gap) / n
        y0, y1 = hull.y(t0, z), hull.y(t1, z)
        for k in range(n):
            x = -w + pw / 2 + k * (pw + gap)
            mt = BILGE if (pi, k) in wet else mat
            m.box((x, (y0 + y1) / 2, z + 0.0125), (pw, abs(y1 - y0), 0.025), mt, shade=shade)
        # the cleats under each panel
        for yy in (y0 - 0.06 * (1 if y0 > y1 else -1), y1 + 0.06 * (1 if y0 > y1 else -1)):
            m.box((0, yy, z - 0.012), (2 * w - 0.04, 0.05, 0.022), DARK, shade=0.4)
        top_quad(walk, -w, w, min(y0, y1), max(y0, y1), z + 0.025)


SQ2 = math.sqrt(2.0)


def rtube(m, path, w, d, mat, side=(1, 0, 0), **kw):
    """A square-cut timber bent along a path: w across `side`, d the other way."""
    m.tube(path, [(w / 2 * SQ2, d / 2 * SQ2)] * len(path), 4, mat, side=side, rot=math.pi / 4, smooth=False, **kw)


def stem_post(m, hull, keel, sheer, t=1.0, w=0.06, d=0.075, mat=DARK, tint=None, rise=0.07, z0=None, band=True):
    """The stem: a timber up the bow's profile from the forefoot to a little over the sheer, an iron band on its face."""
    z0 = keel(t) - 0.02 if z0 is None else z0
    z1 = sheer(t) + rise
    zs = [z0 + (z1 - z0) * k / 5 for k in range(6)]
    path = [V(0, hull.y(t, z) - d * 0.1, z) for z in zs]
    with paint(m, tint, water=True):
        rtube(m, path, w, d, mat, urep=1, vscale=0.6, cap1=True)
    if band:
        bp_ = [p + V(0, -d / 2 - 0.004, 0) for p in path]
        rtube(m, bp_, 0.022, 0.008, IRON)
    return path


def keel_timber(m, hull, keel, t0=0.0, t1=0.97, w=0.065, d=0.05, mat=DARK, n=8):
    """The keel under her, from the sternpost to the forefoot: 3 cm under the planking (her draft in HULLS)."""
    ts = [t0 + (t1 - t0) * k / n for k in range(n + 1)]
    path = [V(0, hull.y(t, keel(t)), keel(t) - d / 2 + 0.02) for t in ts]
    with paint(m, None, water=True):
        rtube(m, path, w, d, mat, urep=1, vscale=0.6)


def breasthook(m, ln, hull, sheer, t0=0.93, t1=0.995, mat=DARK):
    """The breasthook: a knee across the bow under the capping."""
    z = sheer(t0) - 0.05
    a, b = ln.at_z(t0, z, 1, -TH), ln.at_z(t0, z, -1, -TH)
    c = V(0, hull.y(t1, z) + 0.02, z)
    m.prism([b, a, c], (0, 0, 0.05), mat, shade=0.8)


def quarter_knees(m, ln, hull, sheer, mat=DARK):
    """Knees joining the transom to the gunwales."""
    for sx in (1, -1):
        z = sheer(0.02) - 0.06
        a = ln.at_z(0.02, z, sx, -TH)
        b = ln.at_z(0.09, z, sx, -TH)
        c = V(a.x - sx * 0.2, a.y - 0.04, z)
        m.prism([a, b, c], (0, 0, 0.05), mat, shade=0.8)


def thole_pins(m, p, sx, gap=0.11, mat=WOOD):
    """Thole pins in a chock on the capping: the oar works between them."""
    p = Vector(p)
    m.box(p + V(0, 0, 0.012), (0.07, 0.3, 0.03), DARK, shade=0.8)
    for dy in (-gap / 2, gap / 2):
        with m.at(move(p.x, p.y + dy, p.z + 0.025)):
            m.lathe([(0.017, 0.0), (0.016, 0.13), (0.011, 0.15)], 5, mat, smooth=False, cap1=True)


def crutch(m, p, sx, socket_only=False):
    """An iron crutch (rowlock) in its socket on the capping."""
    p = Vector(p)
    m.box(p + V(0, 0, 0.004), (0.06, 0.12, 0.012), IRON, shade=0.9)
    if socket_only:
        return
    m.beam(p, p + V(0, 0, 0.05), 0.018, 0.018, IRON)
    arc = [p + V(0, 0.055 * math.cos(math.pi * k / 4), 0.1 - 0.05 * math.sin(math.pi * k / 4)) for k in range(5)]
    m.tube(arc, [0.009] * 5, 3, IRON, side=(1, 0, 0), smooth=False)


def oar(m, a, b, blade_at_b=True, r=0.023, blade_w=0.13, blade_l=0.6, mat=WOOD, blade_mat=None, tint=None, blade_tint=None):
    """An oar lying from a to b: a round loom, a leather where it works in the rowlock, a blade with its spine."""
    a, b = Vector(a), Vector(b)
    if not blade_at_b:
        a, b = b, a
    d = (b - a)
    L = d.length
    d.normalize()
    s = d.cross(V(0, 0, 1))
    if s.length < 1e-4:
        s = V(1, 0, 0)
    s.normalize()
    root = b - d * blade_l
    with paint(m, tint):
        m.tube([a, a + d * 0.12, root], [r * 0.8, r, r * 0.75], 6, mat, side=(0, 0, 1), smooth=True, cap0=True, urep=1, vscale=0.4)
    lp = a + d * (0.36 * L)
    m.tube([lp, lp + d * 0.22], [r + 0.004, r + 0.004], 6, ROPE, side=(0, 0, 1), smooth=False)
    q = [root + s * 0.012, root - s * 0.012, b - s * blade_w / 2, b + s * blade_w / 2]
    with paint(m, blade_tint):
        m.slab([p + V(0, 0, 0.006) for p in q], 0.012, blade_mat if blade_mat is not None else mat, out=(0, 0, 1), shade=0.9)
    m.beam(root, b - d * 0.05, 0.022, 0.016, mat, side=(0, 0, 1), shade=0.85)


def oars_laid(m, a, b, blade_at_b=False, gap=0.09, **kw):
    """A pair of oars laid in along the thwarts."""
    a, b = Vector(a), Vector(b)
    for dx in (-gap, gap):
        oar(m, a + V(dx, 0, 0), b + V(dx * 0.9, 0, 0.005), blade_at_b=blade_at_b, **kw)


def painter(m, stem, coil_at, r=0.016):
    """The painter: from the stem ring down into a coil on the bow boards (the game ties its lines to this ring)."""
    with m.at(move(stem.x, stem.y, stem.z) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.03, -0.008), (0.04, 0.0), (0.03, 0.008)], 6, IRON, smooth=False)
    c = Vector(coil_at)
    rope_path(m, [stem + V(0, 0.01, -0.02), stem + V(0, 0.12, -0.1), c + V(0.02, -0.1, 0.12), c + V(0.06, 0, 0.06)], r, ROPE)
    coil(m, c, 0.12)


def fender_on(m, ln, t, sx, drop=0.32, r=0.065):
    """A rope fender hung over the side from the gunwale by its lanyard: moved toward the nearer end until it stands
    no further out than the rubbing strake amidships (the beam of the contract, docs/boats.md, stays as it was)."""
    wide = max(abs(ln.at(q, 1.0, 1).x) for q in ln.h.ts) + 0.035
    step = 0.01 if t > 0.5 else -0.01
    while 0.03 < t < 0.97 and abs(ln.at_z(t, ln.sheer(t) - 0.08, 1, 0.0).x) + 0.03 + 2 * r > wide:
        t += step
    top = ln.at(t, 1.0, sx, 0.015) + V(0, 0, 0.024)
    a = ln.at_z(t, ln.sheer(t) - 0.08, sx, r + 0.03)
    m.tube([top + V(-sx * 0.02, 0, 0), top + V(sx * 0.02, 0, 0.01), a + V(0, 0, 0.02)], [0.008] * 3, 3, ROPE, smooth=False)
    m.tube([a, a - V(0, 0, drop * 0.5), a - V(0, 0, drop)], [(r * 0.75, r * 0.75), (r, r), (r * 0.75, r * 0.75)], 6, ROPE,
           side=(0, 1, 0), smooth=True, cap0=True, cap1=True, urep=2, vscale=2.0)


def scoop(m, c, yaw=0.0, mat=WOOD):
    """A bailer: a wooden scoop with its handle."""
    with m.at(move(*Vector(c)) @ rot_z(yaw)):
        m.box((0, 0, 0.005), (0.16, 0.2, 0.01), mat, shade=0.8)
        for sx in (1, -1):
            m.poly([V(sx * 0.08, -0.1, 0.0), V(sx * 0.08, 0.1, 0.0), V(sx * 0.09, 0.1, 0.08), V(sx * 0.085, -0.04, 0.05)], mat, out=(sx, 0, 0), shade=0.85)
        m.poly([V(-0.09, 0.1, 0.08), V(0.09, 0.1, 0.08), V(0.08, 0.1, 0.0), V(-0.08, 0.1, 0.0)], mat, out=(0, 1, 0), shade=0.8)
        m.beam(V(0, 0.1, 0.06), V(0, 0.26, 0.09), 0.025, 0.025, mat)


def tin_can(m, c, mat=IRON):
    """A rusty tin used as a bailer."""
    with m.at(move(*Vector(c))):
        m.lathe([(0.0, 0.0), (0.07, 0.0), (0.07, 0.15), (0.064, 0.15), (0.064, 0.012)], 7, mat, smooth=False)


def bucket(m, c, r=0.13, h=0.26):
    """A wooden bucket with two iron hoops and a rope handle."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.82, 0.0), (r, h), (r * 0.94, h), (r * 0.78, 0.02)], 8, BARREL, smooth=False, cap0=True, urep=2)
        for z in (0.05, h - 0.05):
            m.lathe([(r * (0.84 + 0.16 * z / h) + 0.004, z), (r * (0.84 + 0.16 * (z + 0.03) / h) + 0.004, z + 0.03)], 8, IRON, smooth=False)
        arc = [V(r * math.cos(math.pi * k / 4), 0, h + 0.12 * math.sin(math.pi * k / 4)) for k in range(5)]
        m.tube(arc, [0.008] * 5, 3, ROPE, smooth=False)


def grapnel(m, c, yaw=0.0):
    """A small four-armed grapnel lying with its line."""
    with m.at(move(*Vector(c)) @ rot_z(yaw)):
        m.beam(V(0, 0, 0.03), V(0, -0.36, 0.03), 0.025, 0.025, IRON)
        with m.at(move(0, 0.0, 0.03) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            m.lathe([(0.025, -0.006), (0.035, 0.0), (0.025, 0.006)], 6, IRON, smooth=False)
        for k in range(4):
            a4 = math.pi / 2 * k + 0.4
            m.tube([V(0, -0.36, 0.03), V(0.09 * math.cos(a4), -0.4, 0.03 + 0.09 * math.sin(a4) * 0.4),
                    V(0.12 * math.cos(a4), -0.33, 0.03 + 0.12 * math.sin(a4) * 0.4)], [0.012] * 3, 4, IRON, smooth=False)


def boat_hook(m, a, b):
    """A boat hook: an ash pole with its iron hook and spike."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    m.tube([a, b], [0.018, 0.018], 6, WOOD, side=(0, 0, 1), smooth=True, cap0=True)
    m.tube([b, b + d * 0.12], [0.02, 0.01], 5, IRON, side=(0, 0, 1), smooth=False, cap1=True)
    s = d.cross(V(0, 0, 1)).normalized()
    m.tube([b + d * 0.04, b + d * 0.04 + s * 0.07, b + d * 0.0 + s * 0.09 - d * 0.05], [0.01] * 3, 4, IRON, smooth=False)


def name_strip(part, ln, t_c, z, sx, w, h, off=0.034, n=3):
    """A bow name zone on its own mesh: a strip of n quads along the side at height z, centred at station t_c,
    w long and h high, winding outward, UVs 0..1 (u from the reader's left: the bow on the port side)."""
    L = ln.h.L
    # port: the bow (high t) at the reader's left; starboard: the stern
    ts = sorted((t_c + (k / n - 0.5) * w / L for k in range(n + 1)), reverse=sx > 0)
    base = []
    for t in ts:
        f = ln.f_of_z(t, z)
        p = ln.at(t, f, sx, off)
        a_, b_ = ln._find(t, f)[:2]
        up = V((b_.x - a_.x) * sx, 0, b_.z - a_.z).normalized()
        base.append((p, up))
    acc = [0.0]
    for (p, _), (q, _) in zip(base, base[1:]):
        acc.append(acc[-1] + (q - p).length)
    for k in range(n):
        (p, up), (q, uq) = base[k], base[k + 1]
        u0, u1 = acc[k] / acc[-1], acc[k + 1] / acc[-1]
        pts = [p - up * h / 2, q - uq * h / 2, q + uq * h / 2, p + up * h / 2]
        part.face([part.vert(x) for x in pts], [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], DARK, 1.0)
    return base


def board_behind(m, base, h, sx, border=0.016, back=0.014):
    """The small dark name board behind a zone strip: its face 8 mm under the zone, its top and bottom edges back
    toward the hull, a border round the zone."""
    hh = h / 2 + border
    n = V(sx, 0, 0)
    pts = []
    for k, (p, up) in enumerate(base):
        if k == 0:
            p = p + (base[0][0] - base[1][0]).normalized() * border
        elif k == len(base) - 1:
            p = p + (base[-1][0] - base[-2][0]).normalized() * border
        f = p - n * 0.008
        pts.append((f - up * hh, f + up * hh, f - n * back - up * hh, f - n * back + up * hh))
    for a, b in zip(pts, pts[1:]):
        m.poly([a[0], b[0], b[1], a[1]], DARK, out=n, shade=0.9)
        m.poly([a[1], b[1], b[3], a[3]], DARK, out=(0, 0, 1), shade=1.0)
        m.poly([a[0], b[0], b[2], a[2]], DARK, out=(0, 0, -1), shade=0.5)
    for a in (pts[0], pts[-1]):
        m.poly([a[0], a[1], a[3], a[2]], DARK, out=(a[0] - pts[len(pts) // 2][0]), shade=0.7)


def stern_zone(part, m, hull, zc, w, h, off=0.03, t=0.0, board=True):
    """The stern name zone on the transom (or a flat stern): a quad facing aft, u from port (+X, the reader's left
    standing astern) to starboard, on a small dark board."""
    z1, z2 = zc - h / 2, zc + h / 2
    y1, y2 = hull.y(t, z1), hull.y(t, z2)
    d = V(0, y2 - y1, z2 - z1).normalized()
    n = V(0, d.z, -d.y)
    if n.y < 0:
        n = -n
    c = V(0, hull.y(t, zc), zc)
    r = V(-1, 0, 0)
    q = [c + n * off - r * w / 2 - d * h / 2, c + n * off + r * w / 2 - d * h / 2, c + n * off + r * w / 2 + d * h / 2,
         c + n * off - r * w / 2 + d * h / 2]
    part.face([part.vert(p) for p in q], [(0, 0), (1, 0), (1, 1), (0, 1)], DARK, 1.0)
    if board:
        bw, bh = w / 2 + 0.016, h / 2 + 0.016
        cb = c + n * (off - 0.008)
        f = [cb - r * bw - d * bh, cb + r * bw - d * bh, cb + r * bw + d * bh, cb - r * bw + d * bh]
        m.slab(f, off - 0.008 + 0.006, DARK, out=n, shade=0.9)


def zones_extra(m, bow, stern):
    m.extras["name_zones"] = {"bow_p": [round(bow[0], 3), round(bow[1], 3)], "bow_s": [round(bow[0], 3), round(bow[1], 3)],
                              "stern": [round(stern[0], 3), round(stern[1], 3)]}


def new_parts(m):
    """The hidden and the name nodes of the contract (docs/boats.md), each a Mesh in m.children: the driver
    (build_boats.py hull_parts) makes each one a child of the model, named <kind>_<key>."""
    m.children = {k: Mesh(ao=0.0) for k in ("walk", "block", "far", "name_bow_p", "name_bow_s", "name_stern")}
    return m.children


def bow_zones(m, ln, t_c, z, w, h):
    for sx, key in ((1, "name_bow_p"), (-1, "name_bow_s")):
        base = name_strip(m.children[key], ln, t_c, z, sx, w, h)
        board_behind(m, base, h, sx)


# ------------------------------------------------------------------ the far copy


def far_hull(f, ln, T, bands, inner_mat, cap_mat=DARK, cap_tint=None, thwarts=(), floor_z=None, hull=None, flat=False,
             bottom_mat=TARWEED, ends=(True, False), end_mat=WOOD, end_tint=None, inner_tint=None, oars=None):
    """The far copy (past 60 m): the outer skin in a few bands, the inside, the capping, the thwarts; a fifth of
    the triangles. bands: [(f0, f1, material, tint)]."""
    for sx in (1, -1):
        for f0, f1, mat, tint in bands:
            P = [[ln.at(t, f0, sx), ln.at(t, f1, sx)] for t in T]
            UV = [[uv_of(mat, p, 0, a) for p, a in zip(row, (0.0, 1.0))] for row in P]
            with paint(f, tint, water=True):
                sheet(f, P, UV, mat, lambda c, sx=sx: V(c.x, 0, c.z - 1.2) if abs(c.x) > 1e-4 else V(sx, 0, 0), smooth=True)
        P = [[ln.at(t, 0.0, sx, -TH), ln.at(t, 0.5, sx, -TH), ln.at(t, 1.0, sx, -TH)] for t in T]
        UV = [[uv_of(inner_mat, p, 0, a) for p, a in zip(row, (0.0, 0.5, 1.0))] for row in P]
        with paint(f, inner_tint):
            sheet(f, P, UV, inner_mat, lambda c, sx=sx: V(-sx, 0, 0.3), smooth=True, shade=0.85)
        P = [[ln.at(t, 1.0, sx, 0.01) + V(0, 0, 0.024), ln.at(t, 1.0, sx, -0.06) + V(0, 0, 0.024)] for t in T]
        with paint(f, cap_tint):
            sheet(f, P, [[(-p.y, j) for j, p in enumerate(r)] for r in P], cap_mat, lambda c: V(0, 0, 1), smooth=False)
    flat_part(f, ln, T, bottom_mat, 0.0, False)
    flat_part(f, ln, T, inner_mat, -TH, True, water=False, shade=0.55)
    if hull is not None:
        for t, on, oy in ((T[0], ends[0], 1), (T[-1], ends[1], -1)):
            if on:
                end_board(f, ln, t, end_mat, end_tint, out_y=oy)
        for t, z in thwarts:
            w = half_in(ln, t, z)
            f.box((0, hull.y(t, z), z), (2 * w, 0.22, 0.035), WOOD, shade=0.95)
        if floor_z is not None:
            t0, t1 = 0.12, 0.86
            z = floor_z
            w = min(half_in(ln, t, z) for t in (t0, 0.5, t1)) - 0.04
            f.box((0, (hull.y(t0, z) + hull.y(t1, z)) / 2, z + 0.012), (2 * w, abs(hull.y(t1, z) - hull.y(t0, z)), 0.025), WOOD, shade=0.75)
    if oars is not None:
        a, b = oars
        for dx in (-0.09, 0.09):
            f.beam(a + V(dx, 0, 0), b + V(dx, 0, 0), 0.05, 0.03, WOOD, side=(1, 0, 0), caps=False)


# ------------------------------------------------------------------ the round-bilged boats

T_ROUND = [0.0, 0.03, 0.07, 0.12, 0.18, 0.25, 0.33, 0.41, 0.49, 0.57, 0.65, 0.72, 0.78, 0.83, 0.875, 0.915, 0.95, 0.975,
           0.99, 1.0]
T_FAR = [0.0, 0.1, 0.3, 0.5, 0.7, 0.85, 0.95, 1.0]


def round_boat(L, B, D, strakes, stern_w=0.55, thwarts=(0.42, 0.66), seat=0, sheets=0.1, clinker=True, inner=CLINKER,
               inner_tint=None, rib_mat=WOOD, rib_step=0.24, cap_mat=DARK, cap_tint=None, rub_mat=DARK, rub_tint=None,
               transom_mat=WOOD, transom_tint=None, thwart_mat=WOOD, thwart_tint=None, boards=True, wet=((0, 2), (0, 3)),
               tholes=True, back=False, side_benches=None, keel_mat=DARK, F=None, hole=None, far_bands=None, pillar=None,
               bow_zone=(0.44, 0.11), stern_zone_wh=(0.5, 0.125), zone_z=None, rudder=False):
    """An open round-bilged boat built plank by plank (rowing boat, dinghy, ship's boat, gig, bumboat, old boat):
    the lines of boat_hull (common.py), the skin in strakes (`strakes` from the garboard up: (material, tint)),
    the inside, the frames, thwarts, sheets, boards, rowlocks, the stem, keel and transom, the name zones and the
    contract's nodes. Returns (m, hull, keel, sheer, ln)."""
    m = Mesh(ao=0.0)
    m.stow = Mesh(ao=0.0)
    parts = new_parts(m)
    walk, block = parts["walk"], parts["block"]
    base, keel, sheer = boat_hull(L, B, D, [(TARWEED, 0)] * 3, stern_w=stern_w)
    # the lines, at more stations (the same shape): the cap follows the rail through them
    hull = Hull(L, T_ROUND, base.levels, base.hbf, base.mats, yfn=base.yfn, shade=base.shade)
    m.hulls.append(hull)
    ln = Lines(hull, keel, sheer)
    N = len(strakes)
    F = F or [k / N for k in range(N + 1)]
    kz = keel(0.5)
    sz = sheer(0.5)

    def sh_out(p):
        return 0.72 + 0.28 * sm((p.z - kz) / (sz - kz))

    def sh_in(p):
        return 0.62 + 0.33 * sm((p.z - kz) / (sz - kz))

    skin(m, ln, T_ROUND, F, strakes, lap=LAP if clinker else 0.0, smooth=True, shade=sh_out)
    skin(m, ln, T_ROUND, F, strakes, lap=LAP if clinker else 0.0, inner=True, inner_mat=inner, inner_tint=inner_tint,
         smooth=True, shade=sh_in)
    flat_part(m, ln, T_ROUND, strakes[0][0], 0.0, False, tint=strakes[0][1])
    flat_part(m, ln, T_ROUND, inner, -TH, True, tint=inner_tint, water=False, shade=0.4)
    keel_timber(m, hull, keel, mat=keel_mat)
    stem = stem_post(m, hull, keel, sheer, mat=keel_mat)
    tp_ = end_board(m, ln, 0.0, transom_mat, transom_tint, thick=0.028, out_y=1, water=True, inside_mat=inner)
    # the transom's capping and the sternpost
    zt = sheer(0.0)
    wt = abs(ln.at(0.0, 1.0, 1).x)
    yt = hull.y(0.0, zt)
    with paint(m, cap_tint):
        m.box((0, yt - 0.01, zt + 0.012), (2 * wt + 0.03, 0.06, 0.024), cap_mat, shade=0.95)
    swid, shgt = stern_zone_wh
    zs = sheer(0.0) - shgt / 2 - 0.045
    swid = min(swid, 1.6 * abs(ln.at_z(0.0, zs - shgt / 2, 1).x))
    shgt = swid / 4  # (the names atlas cells are 4:1)
    zs = sheer(0.0) - shgt / 2 - 0.045
    # (without a rudder the sternpost stops under the stern's name board)
    zp = zt - 0.08 if rudder else zs - shgt / 2 - 0.035
    with paint(m, None, water=True):
        m.beam(V(0, hull.y(0.0, keel(0.0)) + 0.03, keel(0.0) - 0.04), V(0, hull.y(0.0, zp) + 0.035, zp), 0.06, 0.05, keel_mat,
               side=(1, 0, 0))
    gunwale(m, ln, T_ROUND, cap_mat=cap_mat, cap_tint=cap_tint, rub_mat=rub_mat, rub_tint=rub_tint)
    # inside: the keelson, the frames, risers, breasthook, quarter knees
    ts = [t for t in T_ROUND if 0.1 < t < 0.9]
    kp = [V(0, hull.y(t, keel(t)), keel(t) + TH + 0.025) for t in [0.05] + ts + [0.93]]
    rtube(m, kp, 0.07, 0.05, DARK)
    nrib = max(8, int(L * 0.86 / rib_step))
    frames(m, ln, [0.07 + 0.86 * k / (nrib - 1) for k in range(nrib)], mat=rib_mat)
    zth = [sheer(t) - 0.2 for t in thwarts]
    riser(m, ln, 0.08, 0.9, lambda t: sheer(t) - 0.2 - 0.035 - 0.017, T_ROUND)
    breasthook(m, ln, hull, sheer)
    quarter_knees(m, ln, hull, sheer)
    # the thwarts, the sheets, the boards
    for k, (t, z) in enumerate(zip(thwarts, zth)):
        thwart(m, walk, ln, hull, t, z, mat=thwart_mat, tint=thwart_tint, hole=(hole == k), pillar=(pillar == k))
    if sheets:
        z = sheer(sheets) - 0.22
        sheets_seat(m, walk, ln, hull, 0.025, sheets + 0.06, z, mat=thwart_mat, tint=thwart_tint, back=back, sides_to=side_benches)

    def fl(t):
        return keel(t) + 0.15
    m.floor_top = lambda t: fl(t) + 0.025
    if boards:
        bottom_boards(m, walk, ln, hull, [(0.13, 0.36), (0.37, 0.62), (0.63, 0.85)], fl, wet=wet)
    ts_ = thwarts[seat]
    tpin = ts_ + 0.68 / L
    if tholes == "crutch":
        for sx in (1, -1):
            crutch(m, ln.at(tpin, 1.0, sx, -0.01) + V(0, 0, 0.024), sx)
    elif tholes:
        for sx in (1, -1):
            thole_pins(m, ln.at(tpin, 1.0, sx, -0.012) + V(0, 0, 0.024), sx)
    ring = V(0, hull.y(1.0, sheer(1.0) - 0.05) - 0.045, sheer(1.0) - 0.05)
    row_info(m, base, sheer, ts_, sheer(ts_) - 0.2 + 0.02, tpin)
    # the name zones: both bows, the transom
    bw, bh = bow_zone
    zb = zone_z if zone_z is not None else sheer(0.86) - 0.085
    bow_zones(m, ln, 0.86, zb, bw, bh)
    stern_zone(parts["name_stern"], m, hull, zs, swid, shgt)
    zones_extra(m, (bw, bh), (swid, shgt))
    # the far copy
    far = parts["far"]
    fl_ = Lines(hull, keel, sheer, nz=10)
    bands = far_bands or [(0.0, F[2], strakes[0][0], strakes[0][1]), (F[2], F[-2], strakes[N // 2][0], strakes[N // 2][1]),
                          (F[-2], 1.0, strakes[-1][0], strakes[-1][1])]
    far_hull(far, fl_, T_FAR, bands, inner, cap_mat, cap_tint, thwarts=list(zip(thwarts, zth)), floor_z=fl(0.5) if boards else None,
             hull=hull, ends=(True, False), end_mat=transom_mat, end_tint=transom_tint, inner_tint=inner_tint,
             oars=(V(0, hull.y(0.14, 0), sheer(thwarts[0]) - 0.15), V(0, hull.y(0.92, 0), sheer(thwarts[-1]) - 0.14)))
    stem_post(far, hull, keel, sheer, mat=keel_mat, band=False)
    return m, hull, keel, sheer, ln, ring


def rudder(m, hull, keel, sheer, tiller=0.9, yoke=False, mat=DARK, tint=None):
    """A rudder hung on the transom by its pintles and gudgeons, and its tiller over the stern sheets (or a yoke)."""
    ys = hull.y(0, sheer(0))
    k0, zr = keel(0.0), sheer(0)
    yk = hull.y(0, k0)
    rud = [V(0, yk + 0.04, k0 + 0.02), V(0, yk + 0.38, k0 + 0.03), V(0, yk + 0.42, k0 + 0.2), V(0, ys + 0.3, zr - 0.2),
           V(0, ys + 0.1, zr + 0.14), V(0, ys + 0.035, zr + 0.14)]
    with paint(m, tint, water=True):
        m.prism([p + V(-0.022, 0, 0) for p in rud], (0.044, 0, 0), mat, tile=1.0)
    for z in (k0 + 0.18, zr - 0.18):
        y = hull.y(0, z)
        m.box((0, y + 0.03, z), (0.07, 0.07, 0.035), IRON)
    if yoke:
        m.beam((-0.4, ys + 0.06, zr + 0.13), (0.4, ys + 0.06, zr + 0.13), 0.045, 0.045, mat)
        for sx in (1, -1):
            m.tube([V(sx * 0.38, ys + 0.06, zr + 0.13), V(sx * 0.42, ys - 0.5, zr + 0.02), V(sx * 0.4, ys - 1.0, zr - 0.04)],
                   [0.008] * 3, 3, ROPE, smooth=False)
    else:
        m.beam((0, ys + 0.12, zr + 0.12), (0, ys - tiller, zr + 0.2), 0.035, 0.045, WOOD)


# ------------------------------------------------------------------ the kinds: round boats


def rowboat():
    """The waterman's clinker rowing boat: oiled strakes, tarred to the waterline, a blue strake under a red-brown
    sheer strake, a black rubbing strake, a blue transom; two thwarts and stern sheets, thole pins in chocks, oars laid in (hidden while rowed), a
    bailer, a basket and a coiled line, a grapnel, the painter from the stem ring, two fenders."""
    strakes = [(TARWEED, None), (TARWEED, None), (TAR, None), (CLINKER, None), (CLINKER, None), (WHITE, BLUE), (WHITE, RED)]
    m, hull, keel, sheer, ln, ring = round_boat(5.4, 1.55, 0.8, strakes, inner=WOOD, inner_tint=(0.86, 0.78, 0.66),
                                                cap_mat=DARK, rub_mat=TAR, rub_tint=BLACK, transom_mat=WHITE, transom_tint=BLUE,
                                                pillar=0)
    oars_laid(m.stow, V(0.0, hull.y(0.1, 0), sheer(0.42) - 0.15), V(0.0, hull.y(0.96, 0), sheer(0.66) - 0.13), blade_at_b=False)
    ft = m.floor_top
    scoop(m, (0.32, hull.y(0.22, 0), ft(0.22)), yaw=0.4)
    basket(m, (-0.3, hull.y(0.25, 0), ft(0.25)), 0.17, 0.2)
    grapnel(m, (0.12, hull.y(0.8, 0), ft(0.8)), yaw=0.2)
    coil(m, (-0.18, hull.y(0.78, 0), ft(0.78)), 0.14)
    painter(m, ring, (0.16, hull.y(0.84, 0), ft(0.84)))
    for t in (0.4, 0.7):
        fender_on(m, ln, t, 1)
        fender_on(m, ln, t + 0.04, -1)
    b = m.children["block"]
    block_box(b, (-0.3, hull.y(0.25, 0), ft(0.25) + 0.1), (0.36, 0.36, 0.2))
    return m


def dinghy():
    """A jol: a small beamy clinker dinghy with a transom; a green sheer strake and a white transom, a mast thwart
    with its iron clamp, the stubby mast unstepped and laid in with the tanned spritsail furled round it, a rudder
    and tiller, a bucket and a scoop, the painter."""
    strakes = [(TARWEED, None), (TARWEED, None), (CLINKER, None), (CLINKER, None), (CLINKER, None), (CLINKER, None), (GREEN, None)]
    m, hull, keel, sheer, ln, ring = round_boat(4.3, 1.62, 0.78, strakes, stern_w=0.72, thwarts=(0.46, 0.78), sheets=0.12,
                                                inner=WOOD, inner_tint=(0.9, 0.84, 0.72), cap_mat=WHITE, cap_tint=CREAM,
                                                rub_mat=GREEN, transom_mat=WHITE, transom_tint=CREAM, hole=1, rib_step=0.22,
                                                bow_zone=(0.4, 0.1), stern_zone_wh=(0.48, 0.12), rudder=True)
    rudder(m, hull, keel, sheer, tiller=0.8, mat=WHITE, tint=CREAM)
    # the mast and sprit laid in, the sail rolled round them
    a = V(-0.33, hull.y(0.95, 0), sheer(0.8) - 0.04)
    b = V(-0.3, hull.y(0.05, 0) + 0.3, sheer(0.2) - 0.02)
    spar(m.stow, a, b, 0.05, 0.035, WOOD)
    spar(m.stow, a + V(0.1, 0.1, -0.02), b + V(0.12, 0.2, -0.03), 0.03, 0.022, WOOD)
    bundle(m.stow, a.lerp(b, 0.12) + V(0.04, 0, 0.05), a.lerp(b, 0.82) + V(0.04, 0, 0.05), 0.11, TAN, n=5, sides=6)
    oars_laid(m.stow, V(0.33, hull.y(0.18, 0), sheer(0.46) - 0.12), V(0.3, hull.y(0.93, 0), sheer(0.78) - 0.12), blade_at_b=False,
              gap=0.07, blade_tint=CREAM)
    ft = m.floor_top
    bucket(m, (0.3, hull.y(0.28, 0), ft(0.28)))
    scoop(m, (-0.05, hull.y(0.3, 0), ft(0.3)), yaw=-0.3)
    painter(m, ring, (-0.1, hull.y(0.84, 0), ft(0.84)))
    for t in (0.35, 0.62):
        fender_on(m, ln, t, 1, drop=0.26)
        fender_on(m, ln, t, -1, drop=0.26)
    blk = m.children["block"]
    block_box(blk, (a.lerp(b, 0.5).x, a.lerp(b, 0.5).y, a.lerp(b, 0.5).z), (0.25, abs(a.y - b.y), 0.2))
    return m


def shipsboat():
    """A sloep: a ship's boat, carvel built, white topsides and a black sheer strake, a varnished capping, the bottom
    tarred and fouled; three thwarts, stern sheets with side benches and a backboard, a rudder with its yoke and
    lines, iron crutches, a boat hook, a water breaker, the cover rolled in the bow, fenders; her ship's name on the
    transom."""
    strakes = [(TARWEED, None), (TARWEED, None), (WHITE, None), (WHITE, None), (WHITE, None), (TAR, BLACK)]
    F = [0.0, 0.18, 0.34, 0.52, 0.7, 0.86, 1.0]
    m, hull, keel, sheer, ln, ring = round_boat(6.3, 1.9, 0.86, strakes, stern_w=0.62, thwarts=(0.5, 0.3, 0.72), sheets=0.1,
                                                clinker=False, F=F, inner=WHITE, inner_tint=(0.86, 0.85, 0.8), cap_mat=VARNISH,
                                                rub_mat=TAR, rub_tint=BLACK, transom_mat=WHITE, transom_tint=None,
                                                thwart_mat=WHITE, thwart_tint=(0.9, 0.89, 0.85), tholes="crutch", back=True,
                                                side_benches=0.24, rib_mat=WHITE, rib_step=0.26, pillar=0,
                                                bow_zone=(0.5, 0.125), stern_zone_wh=(0.64, 0.16), wet=((0, 2),), rudder=True)
    rudder(m, hull, keel, sheer, yoke=True, mat=WHITE)
    for t in (0.3, 0.72):  # the other rowlocks' sockets
        for sx in (1, -1):
            crutch(m, ln.at(t + 0.68 / 6.3, 1.0, sx, -0.01) + V(0, 0, 0.024), sx, socket_only=True)
    oars_laid(m.stow, V(-0.36, hull.y(0.14, 0), sheer(0.3) - 0.14), V(-0.32, hull.y(0.93, 0), sheer(0.72) - 0.14), blade_at_b=False,
              gap=0.07, blade_tint=(0.9, 0.9, 0.86))
    ft = m.floor_top
    boat_hook(m, V(0.42, hull.y(0.14, 0), sheer(0.3) - 0.16), V(0.38, hull.y(0.9, 0), sheer(0.72) - 0.15))
    # a water breaker on its side under the after thwart
    with m.at(move(0.25, hull.y(0.3, 0), ft(0.3) + 0.15) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.12, -0.2), (0.15, 0.0), (0.12, 0.2)], 8, BARREL, cap0=True, cap1=True, smooth=False)
    # the boat's cover rolled up in the bow
    bundle(m, V(-0.25, hull.y(0.84, 0), ft(0.84) + 0.09), V(0.25, hull.y(0.84, 0), ft(0.84) + 0.09), 0.1, CANVAS, n=4, sides=6)
    painter(m, ring, (0.15, hull.y(0.8, 0), ft(0.8)))
    for t in (0.36, 0.64):
        for sx in (1, -1):
            fender_on(m, ln, t, sx, drop=0.3)
    blk = m.children["block"]
    block_box(blk, (0.25, hull.y(0.3, 0), ft(0.3) + 0.15), (0.3, 0.4, 0.3))
    block_box(blk, (0, hull.y(0.84, 0), ft(0.84) + 0.1), (0.55, 0.25, 0.2))
    return m


def gig():
    """The water police's gig: long and narrow for speed, carvel, black with a varnished sheer strake and capping;
    four thwarts, iron crutches (four oars laid in), stern sheets with a blue cushion and a backboard, a rudder with
    its yoke, the flagstaff with the Belgian colours, a lantern on the bow, a boat hook; POLITIE on her boards."""
    strakes = [(TARWEED, None), (TAR, BLACK), (TAR, BLACK), (TAR, BLACK), (TAR, BLACK), (VARNISH, None)]
    F = [0.0, 0.2, 0.37, 0.53, 0.69, 0.84, 1.0]
    m, hull, keel, sheer, ln, ring = round_boat(7.4, 1.38, 0.72, strakes, stern_w=0.5, thwarts=(0.52, 0.3, 0.72, 0.86),
                                                sheets=0.1, clinker=False, F=F, inner=VARNISH, inner_tint=(0.85, 0.8, 0.75),
                                                cap_mat=VARNISH, rub_mat=VARNISH, transom_mat=VARNISH, thwart_mat=VARNISH,
                                                tholes="crutch", back=True, side_benches=0.2, rib_mat=VARNISH, rib_step=0.24,
                                                bow_zone=(0.48, 0.12), stern_zone_wh=(0.52, 0.13), wet=((0, 1),), rudder=True)
    rudder(m, hull, keel, sheer, yoke=True, mat=VARNISH)
    for t in (0.3, 0.72, 0.86):
        for sx in (1, -1):
            crutch(m, ln.at(t + 0.68 / 7.4, 1.0, sx, -0.01) + V(0, 0, 0.024), sx, socket_only=True)
    ys = hull.y(0, sheer(0))
    # the cushion on the stern sheets
    z = sheer(0.1) - 0.22 + 0.02
    with paint(m, (0.3, 0.36, 0.55)):
        m.box((0, hull.y(0.08, z), z + 0.03), (0.75, 0.32, 0.05), HOOD, shade=0.9)
    fs = V(0, ys - 0.08, sheer(0) - 0.05)
    spar(m, fs, fs + V(0, 0.08, 1.45), 0.025, 0.017, VARNISH, cap=True)
    flag(m, fs + V(0, 0.1, 1.42), 0.6, 0.4, along=(0, 1, -0.1), kind="belgian")
    bow = V(0, hull.y(0.95, sheer(0.95)), sheer(0.95))
    lantern(m, bow + V(0, 0.15, 0.16), 0, bail=True)
    oars_laid(m.stow, V(-0.22, hull.y(0.12, 0), sheer(0.3) - 0.12), V(-0.2, hull.y(0.95, 0), sheer(0.86) - 0.12), blade_at_b=False,
              gap=0.06, mat=VARNISH, r=0.021)
    oars_laid(m.stow, V(0.22, hull.y(0.12, 0), sheer(0.3) - 0.09), V(0.2, hull.y(0.95, 0), sheer(0.86) - 0.09), blade_at_b=False,
              gap=0.06, mat=VARNISH, r=0.021)
    ft = m.floor_top
    boat_hook(m, V(0.24, hull.y(0.2, 0), ft(0.2) + 0.02), V(0.22, hull.y(0.82, 0), ft(0.82) + 0.02))
    painter(m, ring, (0.1, hull.y(0.84, 0), ft(0.84)))
    for t in (0.4, 0.6):
        for sx in (1, -1):
            fender_on(m, ln, t, sx, drop=0.28, r=0.06)
    block_box(m.children["block"], (0, fs.y - 0.05, sheer(0) + 0.5), (0.1, 0.1, 1.0))
    return m


def loaf(m, c, r=0.09, tint=(0.8, 0.55, 0.3)):
    with paint(m, tint):
        with m.at(move(*Vector(c))):
            m.lathe([(r * 0.9, 0.0), (r, 0.03), (r * 0.8, 0.08), (0.0, 0.1)], 7, CRATE, smooth=True, cap0=True)


def cabbage(m, c, r=0.08):
    with paint(m, (0.55, 0.8, 0.45)):
        with m.at(move(*Vector(c))):
            m.lathe([(0.0, 0.0), (r * 0.8, 0.02), (r, r * 0.8), (r * 0.7, r * 1.5), (0.0, r * 1.7)], 6, HOOD, smooth=True)


def bumboat():
    """A bumboat that sells to the ships in the roads: beamy, clinker, tarred, a yellow sheer strake over a green one,
    a red rubbing strake and cream capping, a green transom; a canvas hood on hoops over her after half, the goods under it: sacks on a bench (the sack swap), a
    crate of bottles, a keg of gin, baskets of bread and cabbages, a steelyard hung from a hoop, a lantern; her
    trade on her bow boards (BROOD - BIER)."""
    strakes = [(TARWEED, None), (TARWEED, None), (TAR, None), (TAR, None), (CLINKER, None), (CLINKER, None), (GREEN, None),
               (WHITE, OCHRE)]
    m, hull, keel, sheer, ln, ring = round_boat(5.0, 1.95, 0.82, strakes, stern_w=0.7, thwarts=(0.62, 0.84), sheets=0.08,
                                                inner=WOOD, inner_tint=(0.8, 0.74, 0.64), cap_mat=WHITE, cap_tint=CREAM,
                                                rub_mat=WHITE, rub_tint=RED, transom_mat=GREEN, rib_step=0.23,
                                                bow_zone=(0.56, 0.14), stern_zone_wh=(0.6, 0.15), wet=((1, 3), (1, 4)))
    blk = m.children["block"]
    # the hood: hoops from gunwale to gunwale, the canvas over them (t 0.06 .. 0.44)
    arcs = []
    for t in (0.06, 0.18, 0.31, 0.44):
        w = abs(ln.at(t, 1.0, 1, -0.03).x)
        y = hull.y(t, sheer(t))
        z0 = sheer(t) + 0.02
        arc = [V(w * math.cos(math.pi * j / 8), y, z0 + 0.85 * math.sin(math.pi * j / 8)) for j in range(9)]
        m.tube(arc, [0.018] * 9, 4, WOOD, side=(0, 1, 0), smooth=False)
        arcs.append(arc)
    for a, b in zip(arcs, arcs[1:]):
        for j in range(8):
            pts = [a[j] + V(0, 0, 0.02), a[j + 1] + V(0, 0, 0.02), b[j + 1] + V(0, 0, 0.02), b[j] + V(0, 0, 0.02)]
            sag = V(0, 0, -0.025)
            pts = [pts[0], pts[1], pts[2] + sag * 0.0, pts[3]]
            m.poly(pts, HOOD, out=((a[j].x + a[j + 1].x) / 2, 0, 1), uvs=[(j / 4, 0), ((j + 1) / 4, 0), ((j + 1) / 4, 1), (j / 4, 1)],
                   shade=0.8)
    # the hood's lashings down the side
    for arc in arcs:
        for sx in (0, 8):
            p = arc[sx]
            m.tube([p, p + V(0, 0, -0.1)], [0.007, 0.007], 3, ROPE, smooth=False)
    # the goods under the hood
    z = 0.2
    ft = m.floor_top
    f0 = ft(0.25)
    yb = hull.y(0.14, 0)
    # the bench under the sacks: a stall of boards on two trestles, from the bottom boards up
    m.box((-0.45, yb, z + 0.24), (0.52, 0.6, 0.04), WOOD, shade=0.8)
    for dy in (-0.24, 0.24):
        m.box((-0.45, yb + dy, (f0 + z + 0.22) / 2), (0.46, 0.05, z + 0.22 - f0), DARK, shade=0.6)
    for k in range(5):
        sack_lo(m, (-0.45 + 0.05 * (k % 2), hull.y(0.14, 0) + 0.08 * k - 0.16, z + 0.26), yaw=math.pi / 2 + 0.2 * k)
    for x, t in [(0.45, 0.16), (-0.4, 0.33)]:
        basket(m, (x, hull.y(t, 0), ft(t)), 0.2, 0.26)
    for k in range(4):
        loaf(m, (0.45 + 0.08 * math.cos(k * 1.7), hull.y(0.16, 0) + 0.08 * math.sin(k * 1.7), ft(0.16) + 0.2 + 0.02 * k))
    for k in range(4):
        cabbage(m, (-0.4 + 0.08 * math.cos(k * 1.9), hull.y(0.33, 0) + 0.08 * math.sin(k * 1.9), ft(0.33) + 0.2))
    cy = hull.y(0.25, 0)
    crate_lo(m, (0.02, cy, f0), size=(0.5, 0.36, 0.3))
    for i in range(6):
        with m.at(move(-0.15 + 0.15 * (i % 3) + 0.02, cy - 0.08 + 0.16 * (i // 3), f0 + 0.3)):
            m.lathe([(0.035, 0.0), (0.035, 0.18), (0.015, 0.24), (0.012, 0.3)], 6, GLASS, smooth=True, cap1=True)
    # a small keg of gin on its side
    with m.at(move(0.42, hull.y(0.4, 0), ft(0.4) + 0.18) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.14, -0.22), (0.18, 0.0), (0.14, 0.22)], 8, BARREL, cap0=True, cap1=True, smooth=False)
        for zz in (-0.15, 0.13):
            m.lathe([(0.166, zz), (0.17, zz + 0.03)], 8, IRON, smooth=False)
    # the steelyard hung from the forward hoop
    hp = arcs[-1][4] + V(0, 0, -0.02)
    m.tube([hp, hp - V(0, 0, 0.25)], [0.006, 0.006], 3, ROPE, smooth=False)
    m.beam(hp - V(0.25, 0, 0.25), hp + V(0.12, 0, -0.25), 0.02, 0.02, IRON)
    with m.at(move(hp.x + 0.12, hp.y, hp.z - 0.38)):
        m.lathe([(0.04, 0.0), (0.04, 0.08), (0.0, 0.12)], 6, IRON, smooth=False, cap0=True)
    lantern(m, arcs[-1][4] + V(0.0, -0.05, -0.12), 0)
    oars_laid(m.stow, V(-0.5, hull.y(0.5, 0), sheer(0.62) - 0.1), V(-0.42, hull.y(0.96, 0), sheer(0.84) - 0.1), blade_at_b=True,
              gap=0.07)
    painter(m, ring, (0.2, hull.y(0.84, 0), ft(0.84)))
    for t in (0.5, 0.72):
        for sx in (1, -1):
            fender_on(m, ln, t, sx, drop=0.3, r=0.07)
    # what a walker cannot pass: the goods and the hood over them
    block_box(blk, (0, hull.y(0.25, 0), 0.6), (1.5, abs(hull.y(0.06, 0) - hull.y(0.44, 0)), 0.8))
    # the far copy's hood
    far = m.children["far"]
    for a, b in zip(arcs, arcs[1:]):
        for j in range(0, 8, 2):
            pts = [a[j], a[j + 2], b[j + 2], b[j]]
            far.poly(pts, HOOD, out=((a[j].x + a[j + 2].x) / 2, 0, 1), uvs=[(j / 4, 0), ((j + 2) / 4, 0), ((j + 2) / 4, 1), (j / 4, 1)],
                     shade=0.8)
    return m


def oldboat():
    """An old clinker boat nobody owns any more: grey and worn, the paint gone, moss on the capping, a sheet of tin
    nailed over a split strake and a fresh plank let into another, the rubbing strake sprung at the bow, one thwart
    cracked and sagging, rot black at the ends, bilge water standing in her bottom (part of her, not the river);
    a pair of old oars, one with a split blade, and a rusty tin for a bailer; her old name half scraped off."""
    strakes = [(TARWEED, (0.8, 0.86, 0.76)), (WOOD, (0.66, 0.68, 0.62)), (WOOD, (0.84, 0.86, 0.86)), (WOOD, (0.76, 0.78, 0.78)),
               (WOOD, (0.88, 0.88, 0.86)), (WOOD, (0.74, 0.77, 0.77))]
    m, hull, keel, sheer, ln, ring = round_boat(4.9, 1.5, 0.78, strakes, thwarts=(0.44, 0.7), inner=WOOD,
                                                inner_tint=(0.6, 0.62, 0.58), cap_mat=WOOD, cap_tint=MOSS, rub_mat=WOOD,
                                                rub_tint=(0.6, 0.62, 0.6), transom_mat=WOOD, transom_tint=(0.78, 0.8, 0.8), rib_mat=DARK,
                                                rib_step=0.27, boards=False, thwart_mat=WOOD, thwart_tint=(0.72, 0.74, 0.72),
                                                keel_mat=DARK, bow_zone=(0.44, 0.11), stern_zone_wh=(0.48, 0.12))
    walk, blk = m.children["walk"], m.children["block"]
    # bilge water standing in the bottom (its own flat face, the old boat's, never the river)
    zb = keel(0.5) + 0.09
    T = [0.08, 0.16, 0.26, 0.38, 0.5, 0.62, 0.72]
    for ta, tb in zip(T, T[1:]):
        a, b = ln.at_z(ta, zb, 1, -TH - 0.005), ln.at_z(tb, zb, 1, -TH - 0.005)
        pts = [mirror(a, -1), a, b, mirror(b, -1)]
        m.poly(pts, BILGE, out=(0, 0, 1), uvs=[(-p.y, p.x) for p in pts], shade=0.8)
    # two planks thrown in to stand on (her bottom boards are gone)
    for x, t0, t1, z0, z1 in ((-0.13, 0.2, 0.62, -0.075, -0.06), (0.15, 0.3, 0.75, -0.06, -0.05)):
        y0, y1 = hull.y(t0, 0), hull.y(t1, 0)
        with paint(m, (0.75, 0.75, 0.7)):
            m.beam(V(x, y0, z0), V(x + 0.03, y1, z1), 0.16, 0.025, WOOD, side=(1, 0, 0), shade=0.7)
        top_quad(walk, x - 0.08, x + 0.08, min(y0, y1), max(y0, y1), max(z0, z1) + 0.0125)
    # the tin patch over the split strake; a fresh plank let in; rust and weather down her sides
    p = ln.at_z(0.58, 0.2, 1, LAP + 0.004)
    m.slab([p + V(0, -0.27, -0.1), p + V(0, 0.27, -0.1), p + V(0.01, 0.27, 0.11), p + V(0.01, -0.27, 0.11)], 0.004, IRON,
           out=(1, 0, 0), shade=0.8)
    for k in range(8):
        m.box(p + V(0.006, -0.25 + k * 0.071, 0.095), (0.012, 0.012, 0.012), IRON)
        m.box(p + V(0.006, -0.25 + k * 0.071, -0.085), (0.012, 0.012, 0.012), IRON)
    q = ln.at_z(0.3, 0.33, -1, LAP + 0.002)
    with paint(m, (1.1, 1.0, 0.85)):
        m.slab([q + V(0, 0.4, -0.05), q + V(0, -0.4, -0.05), q + V(-0.005, -0.4, 0.05), q + V(-0.005, 0.4, 0.05)], 0.006, WOOD,
               out=(-1, 0, 0), shade=0.85)
    hull.decal(m, 0.35, sheer(0.35) - 0.04, 0.6, 0.45, -1)
    hull.decal(m, 0.75, sheer(0.75) - 0.04, 0.5, 0.4, 1, u=(1.0, 0.0))
    # rot at her ends: black, soft, the capping broken short
    for t, sx in ((0.04, 1), (0.95, -1), (0.06, -1)):
        hull.decal(m, t, sheer(t) - 0.02, 0.35, 0.3, sx, u=(0.2, 0.7))
    # the rubbing strake sprung loose at the bow, hanging
    a = ln.at_z(0.82, sheer(0.82) - 0.04, 1, 0.03)
    m.beam(a, a + V(0.06, -0.55, -0.22), 0.035, 0.04, DARK, side=(1, 0, 0))
    # the cracked thwart sags (drawn over the whole one), a split across it
    t = 0.7
    z = sheer(t) - 0.2
    m.beam((-0.55, hull.y(t, z), z + 0.03), (0.02, hull.y(t, z) + 0.02, z - 0.06), 0.24, 0.045, DARK, side=(0, 1, 0))
    oar(m.stow, V(0.2, hull.y(0.12, 0), sheer(0.44) - 0.15), V(0.25, hull.y(0.9, 0), sheer(0.7) - 0.15), blade_at_b=False,
        mat=DARK, tint=WEATHER)
    oar(m.stow, V(0.36, hull.y(0.16, 0), sheer(0.44) - 0.13), V(0.33, hull.y(0.86, 0), sheer(0.7) - 0.13), blade_at_b=False,
        mat=DARK, tint=GREY, blade_l=0.42, blade_w=0.08)
    tin_can(m, (-0.25, hull.y(0.22, 0), zb - 0.04))
    rope_path(m, [ring + V(0, 0.01, -0.02), ring + V(0.05, 0.2, -0.25), V(0.1, hull.y(0.9, 0), keel(0.9) + 0.12),
                  V(-0.1, hull.y(0.82, 0), keel(0.82) + 0.1)], 0.015, ROPE)
    return m


# ------------------------------------------------------------------ the flat-bottomed boats


def flat_boat(L, B, bottom=-0.12, rise=0.06, flare=0.12, bow_rake=0.55, stern_rake=0.45, mats=None, bow_rise=0.0):
    """M7 boats: a flat-bottomed boat with raked flat ends (punt, vlet, eel boat): the hull."""
    def sheer(t):
        return 0.52 + rise * abs(2 * t - 1) ** 2 + bow_rise * max(0.0, (t - 0.7) / 0.3) ** 2

    def hb(t, z):
        u = cl((z - bottom) / (0.52 - bottom))
        p = 1 - 0.3 * abs(2 * t - 1) ** 3
        return B / 2 * (1 - flare + flare * u) * p

    def yfn(t, z):
        u = cl((z - bottom + 0.02) / 0.5)
        return -bow_rake * u * sm((t - 0.9) / 0.1) + stern_rake * u * sm((0.1 - t) / 0.1)

    hull = Hull(L, [0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0], [lambda t: bottom, lambda t: 0.0, sheer], hb,
                mats or [(TARWEED, 0), (TAR, 0)], yfn=yfn, shade=lambda p: 0.65 + 0.35 * sm((p.z - bottom) / 0.5))
    return hull, sheer, hb


T_FLAT = [0.0, 0.03, 0.06, 0.1, 0.16, 0.24, 0.33, 0.42, 0.5, 0.58, 0.67, 0.76, 0.84, 0.9, 0.94, 0.97, 1.0]
T_FLAT_FAR = [0.0, 0.1, 0.3, 0.5, 0.7, 0.9, 1.0]


def flat_build(L, B, strakes, bottom=-0.12, rise=0.06, flare=0.12, bow_rake=0.55, stern_rake=0.45, bow_rise=0.0, clinker=True,
               inner=WOOD, inner_tint=None, cap_mat=DARK, cap_tint=None, rub_mat=DARK, rub_tint=None, end_mat=TAR, end_tint=None,
               F=None, knee_ts=None, rocker=0.05, bow_zone=(0.44, 0.11), stern_zone_wh=(0.56, 0.14), floor=0.065):
    """A flat-bottomed boat built plank by plank: the bottom planked lengthwise, its swim rising at both ends, the
    sides in strakes from the chine (clinker or carvel), raked flat end boards, the chine logs, the floors across
    the bottom and the knees up the sides, the capping and rubbing strake, the bottom boards; the name zones and
    the contract's nodes. Returns (m, hull, sheer, hb, ln, ring, base)."""
    m = Mesh(ao=0.0)
    m.stow = Mesh(ao=0.0)
    parts = new_parts(m)
    walk = parts["walk"]
    base, sheer, hb = flat_boat(L, B, bottom=bottom, rise=rise, flare=flare, bow_rake=bow_rake, stern_rake=stern_rake,
                                bow_rise=bow_rise)

    def low(t):
        e = abs(2 * t - 1)
        return bottom + rocker * max(0.0, (e - 0.55) / 0.45) ** 2

    hull = Hull(L, T_FLAT, [low, lambda t: 0.0, sheer], hb, base.mats, yfn=base.yfn, shade=base.shade)
    m.hulls.append(hull)
    ln = Lines(hull, low, sheer, nz=16)
    N = len(strakes)
    F = F or [k / N for k in range(N + 1)]

    def sh_out(p):
        return 0.66 + 0.34 * sm((p.z - bottom) / 0.6)

    skin(m, ln, T_FLAT, F, strakes, lap=LAP if clinker else 0.0, smooth=True, shade=sh_out)
    skin(m, ln, T_FLAT, F, strakes, lap=LAP if clinker else 0.0, inner=True, inner_mat=inner, inner_tint=inner_tint,
         smooth=True, shade=lambda p: 0.55 + 0.3 * sm((p.z - bottom) / 0.6))
    flat_part(m, ln, T_FLAT, TARWEED, 0.0, False)
    flat_part(m, ln, T_FLAT, inner, -TH, True, tint=inner_tint, water=False, shade=0.45)
    end_board(m, ln, 0.0, end_mat, end_tint, thick=0.03, out_y=1, inside_mat=inner)
    end_board(m, ln, 1.0, end_mat, end_tint, thick=0.03, out_y=-1, inside_mat=inner)
    # the end boards' cappings
    for t in (0.0, 1.0):
        z = sheer(t)
        w = abs(ln.at(t, 1.0, 1).x)
        y = hull.y(t, z)
        with paint(m, cap_tint):
            m.box((0, y + (-0.012 if t == 0 else 0.012), z + 0.012), (2 * w + 0.03, 0.06, 0.024), cap_mat, shade=0.95)
    gunwale(m, ln, T_FLAT, cap_mat=cap_mat, cap_tint=cap_tint, rub_mat=rub_mat, rub_tint=rub_tint, w_in=0.05)
    # the chine logs, the floors and the knees
    for sx in (1, -1):
        pts = [ln.at(t, 0.04, sx, -TH - 0.03) for t in T_FLAT[1:-1]]
        for a, b in zip(pts, pts[1:]):
            m.beam(a, b, 0.05, 0.05, DARK, side=(sx, 0, 0), shade=0.55, caps=False)
    for t in (knee_ts or [0.1 + 0.8 * k / 9 for k in range(10)]):
        z = low(t) + TH
        w = half_in(ln, t, z + 0.02) - 0.04
        m.box((0, hull.y(t, z), z + 0.02), (2 * w, 0.06, 0.04), DARK, shade=0.55)
        for sx in (1, -1):
            a = ln.at(t, 0.06, sx, -TH - 0.025)
            b = ln.at(t, 0.92, sx, -TH - 0.025)
            m.beam(a, b, 0.05, 0.035, DARK, side=(0, 1, 0), shade=0.6, caps=False)
            m.prism([a + V(-sx * 0.02, -0.02, 0.0), a + V(-sx * 0.16, -0.02, -0.0), a + V(-sx * 0.0, -0.02, 0.16)], (0, 0.04, 0), DARK,
                    shade=0.6)
    m.floor_top = lambda t: low(t) + floor + 0.025
    bottom_boards(m, walk, ln, hull, [(0.1, 0.34), (0.35, 0.62), (0.63, 0.88)], lambda t: low(t) + floor, plank=0.13,
                  wet=((0, 2), (1, 3)))
    ring = V(0, hull.y(1.0, sheer(1.0) - 0.05) - 0.035, sheer(1.0) - 0.05)
    # the name zones: both bows, the stern board
    bw, bh = bow_zone
    bow_zones(m, ln, 0.84, sheer(0.84) - 0.16, bw, bh)
    sw, shh = stern_zone_wh
    zs = sheer(0.0) - shh / 2 - 0.05
    sw = min(sw, 1.5 * abs(ln.at_z(0.0, zs - shh / 2, 1).x))
    shh = sw / 4
    zs = sheer(0.0) - shh / 2 - 0.05
    stern_zone(parts["name_stern"], m, hull, zs, sw, shh)
    zones_extra(m, (bw, bh), (sw, shh))
    # the far copy
    far = parts["far"]
    fl_ = Lines(hull, low, sheer, nz=6)
    bands = [(0.0, F[-2], strakes[0][0], strakes[0][1]), (F[-2], 1.0, strakes[-1][0], strakes[-1][1])]
    far_hull(far, fl_, T_FLAT_FAR, bands, inner, cap_mat, cap_tint, floor_z=bottom + floor, hull=hull, bottom_mat=TARWEED,
             ends=(True, True), end_mat=end_mat, end_tint=end_tint)
    return m, hull, sheer, hb, ln, ring, base


def punt():
    """A flat-bottomed rowing punt with raked flat ends, as in the canals: carvel sides, tarred, a pale blue top
    plank, floors and knees, bottom boards, two thwarts, iron pins for the oars, the quant pole, a bucket and a
    washerwoman's basket; a pair of oars laid in (hidden while rowed)."""
    strakes = [(TAR, None), (TAR, None), (WHITE, PALE_BLUE)]
    m, hull, sheer, hb, ln, ring, base = flat_build(5.2, 1.35, strakes, clinker=False, F=[0.0, 0.45, 0.78, 1.0], inner=WOOD,
                                                    inner_tint=(0.82, 0.78, 0.7), cap_mat=WHITE, cap_tint=PALE_BLUE, rub_mat=TAR,
                                                    end_mat=TAR, knee_ts=[0.12, 0.2, 0.4, 0.5, 0.6, 0.82, 0.9], rocker=0.06,
                                                    bow_zone=(0.4, 0.1), stern_zone_wh=(0.52, 0.13))
    walk, blk = m.children["walk"], m.children["block"]
    L, B = 5.2, 1.35
    for t in (0.3, 0.72):
        z = 0.36
        thwart(m, walk, ln, hull, t, z, width=0.26, th=0.04, knees=False)
    # the quant pole: a long ash pole with an iron shoe and a wooden crutch, along the starboard side
    a, b = V(-0.42, hull.y(0.02, 0) + 0.25, 0.5), V(-0.38, hull.y(1.0, 0) - 1.0, 0.56)
    m.tube([a, b], [0.024, 0.024], 6, WOOD, side=(0, 0, 1), smooth=True, cap0=True, cap1=True)
    m.tube([b, b + (b - a).normalized() * 0.14], [0.028, 0.012], 5, IRON, side=(0, 0, 1), smooth=False, cap1=True)
    m.tube([a, a - (b - a).normalized() * 0.1 + V(0.08, 0, 0), a - (b - a).normalized() * 0.1 - V(0.08, 0, 0)], [0.016] * 3, 4, WOOD,
           smooth=False)
    tp = 0.26 + 0.68 / L
    for sx in (1, -1):
        with m.at(move(*(ln.at(tp, 1.0, sx, -0.01) + V(0, 0, 0.024)))):
            m.lathe([(0.016, 0.0), (0.016, 0.1), (0.022, 0.1), (0.022, 0.112)], 6, IRON, smooth=False, cap1=True)
    ft = m.floor_top
    bucket(m, (-0.32, hull.y(0.14, 0), ft(0.14)))
    basket(m, (0.28, hull.y(0.84, 0), ft(0.84)), 0.24, 0.24)
    with paint(m, (1.0, 0.98, 0.94)):
        bundle(m, V(0.18, hull.y(0.82, 0), ft(0.84) + 0.24), V(0.4, hull.y(0.88, 0), ft(0.84) + 0.24), 0.08, CANVAS, n=3, sides=5)
    # the washerwoman's kneeling box with its sack cushion, her washboard against the fore thwart, a scoop
    kb = V(-0.25, hull.y(0.9, 0), ft(0.9))
    m.box(kb + V(0, 0, 0.09), (0.42, 0.32, 0.18), WOOD, shade=0.8)
    with paint(m, (0.9, 0.85, 0.75)):
        m.box(kb + V(0, 0, 0.2), (0.38, 0.28, 0.05), SACK, shade=0.9)
    wy = hull.y(0.72, 0.34) - 0.16
    w0 = V(0.05, wy, ft(0.7) + 0.01)
    m.slab([w0 + V(-0.2, 0, 0), w0 + V(0.2, 0, 0), w0 + V(0.2, 0.12, 0.5), w0 + V(-0.2, 0.12, 0.5)], 0.02, WOOD, out=(0, -1, 0.25),
           shade=0.9)
    for k in range(7):
        q = w0 + V(0, 0.03 + 0.012 * k, 0.12 + 0.05 * k)
        m.beam(q - V(0.17, 0.004, 0), q + V(0.17, -0.004, 0), 0.012, 0.012, WOOD, side=(0, 0, 1), shade=0.8)
    scoop(m, (0.25, hull.y(0.2, 0), ft(0.2)), yaw=2.6)
    oars_laid(m.stow, V(0.0, hull.y(0.36, 0), 0.43), V(0.02, hull.y(0.95, 0), 0.42), blade_at_b=False, gap=0.08)
    painter(m, ring, (-0.15, hull.y(0.84, 0), ft(0.84)))
    block_box(blk, kb + V(0, 0, 0.12), (0.42, 0.32, 0.24))
    block_box(blk, (0.28, hull.y(0.84, 0), ft(0.84) + 0.15), (0.5, 0.5, 0.3))
    # rower on the after thwart, the pins 0.68 m forward
    row_info(m, base, sheer, 0.26, 0.36, tp, speed=0.9)
    far = m.children["far"]
    far.tube([a, b], [0.024, 0.024], 4, WOOD, side=(0, 0, 1), smooth=False)
    for t in (0.3, 0.72):
        w = half_in(ln, t, 0.34)
        far.box((0, hull.y(t, 0.34), 0.34), (2 * w, 0.26, 0.04), WOOD, shade=0.95)
    return m


def workboat():
    """A vlet: the harbour's flat-bottomed work boat, bigger and heavier than a punt: three tarred clinker strakes and
    a green top strake, an end board at each end, heavy floors and knees, two thwarts and a stern bench, a
    sculling notch in the stern, a boat hook and two coils of rope, a grapnel, a tarpaulin folded; her home port on
    the stern."""
    strakes = [(TAR, None), (TAR, None), (TAR, None), (GREEN, None)]
    L, B = 6.0, 1.85
    m, hull, sheer, hb, ln, ring, base = flat_build(L, B, strakes, bottom=-0.16, rise=0.1, flare=0.16, bow_rake=0.75, stern_rake=0.4,
                                                    bow_rise=0.1, clinker=True, F=[0.0, 0.3, 0.55, 0.78, 1.0], inner=WOOD,
                                                    inner_tint=(0.7, 0.66, 0.6), cap_mat=DARK, rub_mat=GREEN, end_mat=TAR,
                                                    knee_ts=[0.1, 0.2, 0.3, 0.42, 0.54, 0.66, 0.78, 0.9], rocker=0.05,
                                                    bow_zone=(0.48, 0.12), stern_zone_wh=(0.64, 0.16))
    walk, blk = m.children["walk"], m.children["block"]
    ts, tf = 0.36, 0.7
    for t in (ts, tf):
        z = sheer(t) - 0.2
        thwart(m, walk, ln, hull, t, z, width=0.26, th=0.045, knees=True)
    z = sheer(0.06) - 0.22
    sheets_seat(m, walk, ln, hull, 0.025, 0.1, z, th=0.045)
    ys = hull.y(0, sheer(0))
    # the sculling notch in the stern board's capping, lined with leather
    m.box((0.12, ys - 0.03, sheer(0) + 0.04), (0.08, 0.1, 0.05), DARK)
    m.box((0.0, ys - 0.03, sheer(0) + 0.05), (0.06, 0.1, 0.03), ROPE)
    tp = ts + 0.68 / L
    for sx in (1, -1):
        thole_pins(m, ln.at(tp, 1.0, sx, -0.012) + V(0, 0, 0.024), sx)
    ft = m.floor_top
    boat_hook(m, V(0.55, hull.y(0.1, 0), sheer(0.1) - 0.12), V(0.6, hull.y(0.92, 0), sheer(0.92) - 0.1))
    coil(m, (-0.3, hull.y(0.84, 0), ft(0.84)), 0.22)
    coil(m, (0.35, hull.y(0.16, 0), ft(0.16)), 0.18)
    grapnel(m, (-0.35, hull.y(0.22, 0), ft(0.22)), yaw=-0.5)
    # a tarpaulin folded on the fore boards
    with paint(m, (0.9, 0.9, 0.9)):
        m.box((0.1, hull.y(0.78, 0), ft(0.78) + 0.04), (0.6, 0.45, 0.08), TARP, shade=0.85)
    oars_laid(m.stow, V(-0.45, hull.y(0.12, 0), sheer(ts) - 0.12), V(-0.4, hull.y(0.94, 0), sheer(tf) - 0.12), blade_at_b=False,
              gap=0.08, r=0.026, blade_w=0.15)
    painter(m, ring, (0.2, hull.y(0.86, 0), ft(0.86)))
    for t in (0.45, 0.62):
        for sx in (1, -1):
            fender_on(m, ln, t, sx, drop=0.34, r=0.075)
    block_box(blk, (0.1, hull.y(0.78, 0), ft(0.78) + 0.06), (0.6, 0.45, 0.12))
    row_info(m, base, sheer, ts, sheer(ts) - 0.18, tp, speed=0.85)
    return m


def eel_spear(m, a, b):
    """An eel spear (aalgeer): a long pole with a flat comb of iron tines."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    s = d.cross(V(0, 0, 1)).normalized()
    m.tube([a, b], [0.018, 0.018], 5, WOOD, side=(0, 0, 1), smooth=False, cap0=True)
    for k in range(5):
        o = s * (-0.08 + 0.04 * k)
        m.beam(b + o * 0.3, b + d * 0.26 + o, 0.008, 0.012, IRON)
    m.beam(b - s * 0.09, b + s * 0.09, 0.02, 0.02, IRON, side=(0, 0, 1))


def eelboat():
    """An aalschuit, the eel fisherman's boat: flat-bottomed, tarred clinker sides with an oxblood top strake, the
    bow raised; a wet well amidships (a box across the boat, its lid shut in two halves with iron hasps, holes in
    its sides: the river runs through it, but the lid keeps it out of sight), eel traps (fykes) forward, baskets
    aft, a net hung over the gunwale to dry, an eel spear; her home port on the stern."""
    strakes = [(TAR, None), (TAR, None), (TAR, None), (WHITE, OXBLOOD)]
    L, B = 6.2, 2.0
    m, hull, sheer, hb, ln, ring, base = flat_build(L, B, strakes, bottom=-0.16, rise=0.12, flare=0.18, bow_rake=0.9,
                                                    stern_rake=0.45, bow_rise=0.18, clinker=True, F=[0.0, 0.3, 0.55, 0.8, 1.0],
                                                    inner=TAR, inner_tint=(0.9, 0.88, 0.85), cap_mat=DARK, rub_mat=TAR,
                                                    rub_tint=BLACK, end_mat=TAR, knee_ts=[0.1, 0.2, 0.3, 0.68, 0.78, 0.88],
                                                    rocker=0.05, bow_zone=(0.48, 0.12), stern_zone_wh=(0.64, 0.16))
    walk, blk = m.children["walk"], m.children["block"]
    # the wet well: a box across the boat, its lid in two halves, holes in its side
    w0, w1 = 0.42, 0.62
    ya, yb = hull.y(w0, 0), hull.y(w1, 0)
    wz = sheer(0.5) - 0.08
    ft = m.floor_top
    z0 = ft(0.5) - 0.025
    ww = min(half_in(ln, t, z0 + 0.01) for t in (w0, w1)) - 0.03
    m.box((0, ya - 0.02, (z0 + wz) / 2), (2 * ww, 0.04, wz - z0), WOOD, shade=0.8)
    m.box((0, yb + 0.02, (z0 + wz) / 2), (2 * ww, 0.04, wz - z0), WOOD, shade=0.8)
    for x in (-ww / 2, ww / 2):
        m.box((x, (ya + yb) / 2, wz + 0.02), (ww - 0.04, abs(ya - yb) - 0.02, 0.03), DARK)
        m.box((x * 0.4, (ya + yb) / 2, wz + 0.045), (0.14, 0.05, 0.02), IRON)
        for dy in (-1, 1):
            m.box((x, (ya + yb) / 2 + dy * (abs(ya - yb) / 2 - 0.07), wz + 0.04), (ww - 0.1, 0.04, 0.02), DARK)
    for i in range(6):
        for j in range(2):
            m.box((-ww + 0.25 + i * (2 * ww - 0.5) / 5, ya + 0.002, z0 + 0.12 + 0.12 * j), (0.05, 0.004, 0.04), TAR, shade=0.15)
            m.box((-ww + 0.25 + i * (2 * ww - 0.5) / 5, yb - 0.002, z0 + 0.12 + 0.12 * j), (0.05, 0.004, 0.04), TAR, shade=0.15)
    top_quad(walk, -ww, ww, min(ya, yb), max(ya, yb), wz + 0.035)
    ts = 0.3
    thwart(m, walk, ln, hull, ts, sheer(ts) - 0.2, width=0.26, th=0.045, knees=True)
    z = sheer(0.06) - 0.22
    sheets_seat(m, walk, ln, hull, 0.025, 0.1, z, th=0.045)
    tp = ts + 0.68 / L
    for sx in (1, -1):
        thole_pins(m, ln.at(tp, 1.0, sx, -0.012) + V(0, 0, 0.024), sx)
    # two fykes forward; baskets aft; a net hung over the gunwale to dry; the spear
    eel_trap(m, V(-0.42, hull.y(0.7, 0), ft(0.7) + 0.28), V(-0.3, hull.y(0.95, 0) + 0.3, ft(0.9) + 0.15), 0.28)
    eel_trap(m, V(0.38, hull.y(0.72, 0), ft(0.72) + 0.26), V(0.25, hull.y(0.92, 0) + 0.2, ft(0.9) + 0.15), 0.26)
    basket(m, (-0.45, hull.y(0.15, 0), ft(0.15)), 0.22, 0.3)
    basket(m, (0.4, hull.y(0.18, 0), ft(0.18)), 0.2, 0.28)
    a = ln.at(0.2, 1.0, -1, 0.02) + V(0, 0, 0.03)
    b = ln.at(0.36, 1.0, -1, 0.02) + V(0, 0, 0.03)
    m.poly([a, b, b + V(-0.05, 0, -0.45), a + V(-0.05, 0, -0.35)], NET, out=(-1, 0, 0), uvs=[(0, 0), (3, 0), (3, 1.5), (0, 1.2)])
    m.poly([a, b, b + V(0.12, 0, -0.3), a + V(0.1, 0, -0.25)], NET, out=(1, 0, 0.3), uvs=[(0, 0), (3, 0), (3, 1.0), (0, 0.8)])
    eel_spear(m, V(0.62, hull.y(0.08, 0) - 0.1, 0.48), V(0.6, hull.y(0.62, 0), 0.5))
    painter(m, ring, (0.05, hull.y(0.86, 0), ft(0.86) + 0.05))
    oars_laid(m.stow, V(0.55, hull.y(0.1, 0), sheer(ts) - 0.1), V(0.57, hull.y(0.4, 0), sheer(0.4) + 0.06), blade_at_b=False,
              gap=0.06, r=0.025)
    for t in (0.22, 0.78):
        fender_on(m, ln, t, 1, drop=0.3, r=0.075)
    block_box(blk, (0, hull.y(0.8, 0), ft(0.8) + 0.28), (1.2, abs(hull.y(0.68, 0) - hull.y(0.97, 0)), 0.56))
    block_box(blk, (0, hull.y(0.16, 0), ft(0.16) + 0.16), (1.2, 0.45, 0.32))
    row_info(m, base, sheer, ts, sheer(ts) - 0.18, tp, speed=0.85)
    far = m.children["far"]
    far.box((0, (ya + yb) / 2, (z0 + wz) / 2 + 0.02), (2 * ww, abs(ya - yb), wz - z0 + 0.04), WOOD, shade=0.75)
    return m
