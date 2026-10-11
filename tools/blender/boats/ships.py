"""The ocean ships: the brig Anna Maria, the topsail schooner, the barque (and under sail), the cargo
steamer and the liner."""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ ships


def brig():
    """The Anna Maria: a brig of about 38 m (1873), the game's own ship at the Quai Tavernier.
    Black hull with a painted port band, copper below, two masts square-rigged with the sails
    furled, a gaff and boom on the main. Her waist is flat (walkable at 2.4 m above the water),
    a gangway port in the bulwark on her starboard side (Blender -x, the quay side as she lies),
    an open main hatch over a real hold (walls, floor, ceiling: empty, for later) and a cabin aft
    with a doorway and an inside. The walk rectangle and the things in the way go in her extras."""
    m = Mesh(ao=0.0)
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
    ts = [0, 0.02, 0.05, 0.1, 0.18, 0.3, 0.4, G0, G1, 0.5, 0.6, 0.7, 0.8, 0.88, 0.93, 0.97, 1.0]
    levels = [keel, lambda t: keel(t) + 0.8, lambda t: -1.4, lambda t: 0.15, lambda t: sheer(t) - 1.45,
              lambda t: sheer(t) - 0.75, sheer]
    mats = [(COPPER, 0), (COPPER, 0), (COPPER, 0), (TAR, 0), (BAND, 5.0), (TAR, 0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 2.5) / 5.5))

    def gap(sx, k, ta, tb):
        return sx < 0 and ta >= G0 - 1e-6 and tb <= G1 + 1e-6 and k in (5, -1)

    hull.outer(m, skip=gap)

    def zd(t):
        return sheer(t) - 1.0

    TH = 0.15  # bulwark thickness

    def w(t):
        return hull.hb(t, zd(t)) - 0.12

    # deck, with the main hatch left open over the hold
    H0, H1, CW = 0.5, 0.6, 1.3
    hull.deck(m, zd, 0, H0, 0.12, DECK)
    hull.deck(m, zd, H1, 1, 0.12, DECK)
    Th = hull.span(H0, H1)
    for ta, tb in zip(Th, Th[1:]):
        for sx in (1, -1):
            pts = [V(sx * CW, hull.y(ta, zd(ta)), zd(ta)), V(sx * w(ta), hull.y(ta, zd(ta)), zd(ta)),
                   V(sx * w(tb), hull.y(tb, zd(tb)), zd(tb)), V(sx * CW, hull.y(tb, zd(tb)), zd(tb))]
            m.poly(pts, DECK, out=(0, 0, 1), shade=0.95, uvs=[(-p.y / 1.6, p.x / 1.6) for p in pts])
    hull.rail(m, zd, sheer, 0, 1, TH, WHITE, DARK, skip=gap)
    # the gangway port: a low sill where the top strake is cut away, and a post each side
    yg0, yg1 = hull.y(G1, zd(G1)), hull.y(G0, zd(G0))
    xg = -(hull.hb(0.447, zd(0.447)) - TH / 2)
    m.box((xg, (yg0 + yg1) / 2, zd(0.447) + 0.13), (TH, yg1 - yg0, 0.26), DARK)
    for y in (yg0, yg1):
        m.box((xg, y, zd(0.447) + 0.5), (0.22, 0.14, 1.0), DARK)
    # the hatch coaming, open, and the hold below: plank walls, a floor, the deck's underside
    ya, yb = hull.y(H0, zd(H0)), hull.y(H1, zd(H1))
    zw = zd(0.55)
    for sx in (1, -1):
        m.box((sx * (CW + 0.075), (ya + yb) / 2, zw + 0.25), (0.15, ya - yb + 0.3, 0.5), DARK)
    for y in (ya + 0.075, yb - 0.075):
        m.box((0, y, zw + 0.25), (2 * CW + 0.3, 0.15, 0.5), DARK)
    zf = KZ + 1.3
    hold0, hold1 = H0 - 0.04, H1 + 0.04
    hull.inner(m, [lambda t: zf, lambda t: zd(t) - 0.05], hold0, hold1, 0.25, WOOD, DECK)
    for t0_, t1_, full in ((hold0, H0, True), (H0, H1, False), (H1, hold1, True)):
        T2 = hull.span(t0_, t1_)
        for ta, tb in zip(T2, T2[1:]):
            za, zb_ = zd(ta) - 0.04, zd(tb) - 0.04
            wa, wb = w(ta) - 0.15, w(tb) - 0.15
            parts = [(-wa, wa, -wb, wb)] if full else [(CW, wa, CW, wb), (-wa, -CW, -wb, -CW)]
            for a0, a1, b0, b1 in parts:
                pts = [V(a0, hull.y(ta, za), za), V(a1, hull.y(ta, za), za), V(b1, hull.y(tb, zb_), zb_), V(b0, hull.y(tb, zb_), zb_)]
                m.poly(pts, DECK, out=(0, 0, -1), shade=0.5, uvs=[(-p.y / 1.6, p.x / 1.6) for p in pts])
    # a ladder down into the hold, and some dunnage on its floor
    ly = ya - 0.4
    for x in (-0.3, 0.3):
        m.beam((x, ly, zf), (x, ly - 0.5, zw), 0.06, 0.08, DARK, side=(1, 0, 0))
    for k in range(1, 8):
        f = k / 8
        rig(m, (-0.3, ly - 0.5 * f, zf + (zw - zf) * f), (0.3, ly - 0.5 * f, zf + (zw - zf) * f), 0.04, WOOD)
    for x in (-1.0, 0.0, 1.0):
        m.box((x, (ya + yb) / 2, zf + 0.03), (0.2, (ya - yb) * 0.9, 0.05), WOOD, shade=0.7)

    # the cabin aft: walls with a doorway forward, an inside (walls, ceiling), a table and a bunk
    c0, c1 = 0.07, 0.19
    cy0, cy1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    zb0 = zd(c1) - 0.05
    ztop = zd(c1) + 2.2
    CX, WT = 2.4, 0.12
    hh = ztop - zb0
    m.box((0, cy1 - WT / 2, (zb0 + ztop) / 2), (2 * CX, WT, hh), WHITE)
    for sx in (1, -1):
        m.box((sx * (CX - WT / 2), (cy0 + cy1) / 2, (zb0 + ztop) / 2), (WT, cy1 - cy0, hh), WHITE)
    DW, DH = 1.0, 1.95
    for sx in (1, -1):
        m.box((sx * (DW / 2 + (CX - DW / 2) / 2), cy0 + WT / 2, (zb0 + ztop) / 2), (CX - DW / 2, WT, hh), WHITE)
    m.box((0, cy0 + WT / 2, (zb0 + DH + ztop) / 2), (DW, WT, ztop - zb0 - DH), WHITE)
    m.box((0, (cy0 + cy1) / 2, ztop + 0.06), (2 * CX + 0.3, cy1 - cy0 + 0.3, 0.12), DARK, shade=0.85)
    m.box((0, (cy0 + cy1) / 2 + 0.6, ztop + 0.35), (1.2, 1.0, 0.45), DARK)
    m.box((0, (cy0 + cy1) / 2 + 0.6, ztop + 0.6), (1.1, 0.9, 0.06), WINDOW)
    with m.at(move(-DW / 2, cy0 + WT, zb0) @ rot_z(1.75)):
        m.box((DW / 2, 0.03, DH / 2), (DW, 0.06, DH), DARK)
    for sx in (1, -1):
        for f in (0.35, 0.7):
            y = cy0 + (cy1 - cy0) * f
            panel(m, (sx * CX, y, zb0 + 1.45), (0, -sx, 0), (0, 0, 1), 0.5, 0.45, WINDOW, off=0.02)
            panel(m, (sx * (CX - WT), y, zb0 + 1.45), (0, sx, 0), (0, 0, 1), 0.5, 0.45, WINDOW, off=0.02)
    m.box((0, (cy0 + cy1) / 2, zd(0.13) + 0.4), (1.4, 0.9, 0.05), WOOD, shade=0.8)
    for x in (-0.6, 0.6):
        m.box((x, (cy0 + cy1) / 2, zd(0.13) + 0.2), (0.08, 0.08, 0.4), DARK)
    m.box((CX - 0.6, (cy0 + cy1) / 2, zd(0.13) + 0.45), (0.9, cy1 - cy0 - 0.6, 0.12), WOOD, shade=0.8)
    chimney(m, -1.5, cy1 - 0.8, ztop + 0.12, 0.7, 0.1)

    # masts and rig
    def plan(t, h1, h2, h3, rake, r):
        return MastPlan(hull.y(t, zd(t)), zd(t), zd(t) + h1, zd(t) + h2, zd(t) + h3, rake, r)

    fore = plan(0.70, 12.5, 21.0, 28.0, 0.025, 0.3)
    main = plan(0.33, 13.5, 22.5, 30.0, 0.04, 0.32)
    for mp in (fore, main):
        mp.build(m, top_w=2.5, top_d=1.8)
    for mp, s_ in ((fore, 0.95), (main, 1.0)):
        h1, h2, h3 = mp.h1, mp.h2, mp.h3
        spec = [(h1 - 1.5, 15.5, 0.22, 0.38), (h1 + 0.6, 13.5, 0.18, 0.3), (h1 + (h2 - h1) * 0.55, 12.0, 0.15, 0.26),
                (h2 + 0.9, 9.0, 0.12, 0.2), (h2 + (h3 - h2) * 0.62, 6.5, 0.09, 0.14)]
        for i, (z, ln, r, sr) in enumerate(spec):
            c = mp.at(z) + V(0, -0.5 - (0.45 if i >= 2 else 0) - (0.3 if i >= 3 else 0), 0)
            lift = mp.at(z + (1.6 if i < 3 else 1.1)) + V(0, -0.5, 0)
            yard(m, c, ln * s_, r, sr, lifts_to=lift if i < 4 else None)
            if i < 2:
                for sx in (1, -1):
                    t_to = 0.12 if mp is main else 0.42
                    rig(m, c + V(sx * ln * s_ / 2 * 0.95, 0, 0), hull.P(t_to, sheer(t_to), sx) + V(0, 0, 0.1), 0.016)
    # the main's gaff and boom (the brig's "brigsail"), brailed up
    g0 = main.at(main.h1 - 1.2)
    g1 = g0 + V(0, 8.0 * math.cos(0.45), 8.0 * math.sin(0.45))
    spar(m, g0, g1, 0.14, 0.09)
    b0 = main.at(main.zd + 3.3)
    b1 = b0 + V(0, 14.0, 0.3)
    spar(m, b0, b1, 0.16, 0.1)
    bundle(m, g0 + V(0, 0.6, -0.3), g1 + V(0, -0.8, -0.3), 0.28, CANVAS, n=5)
    bundle(m, b0 + V(0, 0.8, 0.28), b1 + V(0, -1.2, 0.25), 0.22, CANVAS, n=4)
    rig(m, g1, b1, 0.018)
    rig(m, main.top(2) - V(0, 0, 0.5), g1)
    rig(m, main.top(2) - V(0, 0, 0.3), b1)
    flag(m, g1 + V(0, 0.05, -0.1), 1.8, 1.2, along=(0, 0.2, -1), kind="belgian")
    flag(m, main.top(3) + V(0, -0.8, 0.9), 1.1, 0.75, along=(0, 1, 0))
    spar(m, main.top(3) + V(0, -0.8, 0), main.top(3) + V(0, -0.8, 1.0), 0.04, 0.03)
    pennant(m, fore.top(3) + V(0, -0.8, 0.25), 4.0, h=0.3)
    # bowsprit and jibboom with the headsails furled
    stem_top = V(0, hull.y(1.0, sheer(1.0)), sheer(1.0))
    a = math.radians(13)
    dv = V(0, -math.cos(a), math.sin(a))
    heel = stem_top + V(0, 2.6, -0.3)
    bs_end = heel + dv * 9.0
    spar(m, heel, bs_end, 0.3, 0.22)
    jb0, jb1 = heel + dv * 6.0, heel + dv * 16.0
    spar(m, jb0, jb1, 0.17, 0.08)
    m.box(bs_end + V(0, 0.15, 0.05), (0.5, 0.3, 0.5), DARK)
    bundle(m, heel + dv * 9.8 + V(0, 0, 0.2), heel + dv * 15.4 + V(0, 0, 0.13), 0.2, CANVAS, n=4)
    striker = bs_end + V(0, 0.2, -1.9)
    spar(m, bs_end + V(0, 0.2, -0.2), striker, 0.06, 0.05)
    rig(m, bs_end, V(0, hull.y(1.0, 0.4) + 0.4, 0.4), 0.035)
    rig(m, jb1, striker)
    rig(m, striker, V(0, hull.y(1.0, 1.3) + 0.3, 1.3))
    fs = [(fore.top(1), heel + dv * 5.0), (fore.top(2), jb0 + dv * 4.5), (fore.top(3) - V(0, 0, 1.2), jb1)]
    ms = [(main.top(1), fore.at(fore.zd + 1.2) + V(0, 0.6, 0)), (main.top(2), fore.top(1)), (main.top(3) - V(0, 0, 1.2), fore.top(2))]
    for a_, b_ in fs + ms:
        rig(m, a_, b_, 0.03)
    for mp, tm in ((fore, 0.70), (main, 0.33)):
        wch = hull.hb(tm, mp.zd + 0.4)
        for sx in (1, -1):
            m.box((sx * (wch + 0.18), mp.y + 0.2, mp.zd + 0.35), (0.4, 3.2, 0.12), DARK)
            shroud_quad(m, (sx * (wch + 0.34), mp.y - 1.3, mp.zd + 0.4), (sx * (wch + 0.34), mp.y + 1.6, mp.zd + 0.4),
                        mp.at(mp.h1 - 0.7) + V(sx * 0.32, 0.35, 0), mp.at(mp.h1 - 0.7) + V(sx * 0.32, -0.35, 0))
            shroud_quad(m, mp.at(mp.h1 + 0.1) + V(sx * 1.15, -0.6, 0), mp.at(mp.h1 + 0.1) + V(sx * 1.15, 0.8, 0),
                        mp.top(2) + V(sx * 0.2, 0.15, -0.6), mp.top(2) + V(sx * 0.2, -0.15, -0.6))
            shroud_quad(m, mp.top(2) + V(sx * 0.9, -0.2, 0.05), mp.top(2) + V(sx * 0.9, 0.4, 0.05),
                        mp.top(3) + V(sx * 0.1, 0.05, -2.8), mp.top(3) + V(sx * 0.1, -0.05, -2.8))
            for lvl, dy in ((2, 3.0), (3, 4.0)):
                rig(m, mp.top(lvl) - V(0, 0, 0.4), V(sx * (wch + 0.3), mp.y + dy, mp.zd + 0.4), 0.02)
    # deck fittings: fife rails, coils, windlass, catheads and anchors, wheel, casks, pump
    obstacles = []
    for mp in (fore, main):
        c = mp.at(mp.zd)
        for (ax, ay), (bx, by) in (((-0.8, -0.8), (0.8, -0.8)), ((0.8, -0.8), (0.8, 0.8)), ((0.8, 0.8), (-0.8, 0.8)),
                                   ((-0.8, 0.8), (-0.8, -0.8))):
            m.beam(c + V(ax, ay, 0.72), c + V(bx, by, 0.72), 0.1, 0.08, DARK, side=(0, 0, 1))
        for ax, ay in ((-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8)):
            m.box(c + V(ax, ay, 0.36), (0.12, 0.12, 0.72), DARK)
        coil(m, c + V(0.35, 1.2, 0), 0.28)
        obstacles.append([-0.95, 0.95, c.y - 0.95, c.y + 0.95])
    windlass(m, 0, hull.y(0.925, zd(0.925)), zd(0.925) + 0.4, w=2.0, r=0.22)
    for sx in (1, -1):
        cat = hull.P(0.95, sheer(0.95) + 0.2, sx) + V(sx * 0.55, 0, 0)
        m.beam(hull.P(0.95, sheer(0.95) + 0.1, sx, 0.4), cat, 0.28, 0.28, DARK, side=(0, 1, 0))
        with m.at(move(cat.x + sx * 0.1, cat.y, cat.z - 0.3)):
            anchor(m, V(0, 0, 0), side=(1, 0, 0), size=0.8)
    zq = zd(0.035)
    m.box((0, hull.y(0.035, zq), zq + 0.4), (0.9, 0.6, 0.8), DARK)
    wheel_helm(m, V(0, hull.y(0.035, zq) - 0.5, zq + 1.05), 0.5)
    casks = [(1.8, 0.27), (2.4, 0.29), (1.9, 0.63)]
    for i, (x, t) in enumerate(casks):
        barrel_lo(m, (x, hull.y(t, zd(t)), zd(t)), yaw=i * 0.9)
        obstacles.append([x - 0.4, x + 0.4, hull.y(t, zd(t)) - 0.4, hull.y(t, zd(t)) + 0.4])
    m.box((-1.9, hull.y(0.36, zd(0.36)), zd(0.36) + 0.5), (0.25, 0.25, 1.0), DARK)  # the pump
    obstacles.append([-2.1, -1.7, hull.y(0.36, zd(0.36)) - 0.2, hull.y(0.36, zd(0.36)) + 0.2])
    # the main hatch and the cabin are in the way too (the hold and the cabin are not walkable yet)
    obstacles.append([-(CW + 0.15), CW + 0.15, yb - 0.15, ya + 0.15])
    obstacles.append([-CX - 0.1, CX + 0.1, cy0 - 0.1, cy1 + 0.1])
    # names: the transom and the bows
    zt0 = sheer(0.0)

    def on_transom(z, x, w_, h, row=None):
        y = hull.y(0.0, z)
        dy = (hull.y(0.0, z + 0.3) - hull.y(0.0, z - 0.3)) / 0.6
        up = V(0, dy, 1).normalized()
        if row is None:
            panel(m, (x, y, z), (-1, 0, 0), up, w_, h, WINDOW, off=0.06)
        else:
            name_board(m, (x, y, z), (-1, 0, 0), up, w_, h, row, off=0.07, mat=NAMES2)

    wn = hull.hb(0.0, zt0 - 0.5) * 1.55
    on_transom(zt0 - 0.45, 0, wn, wn / 8, 0)
    on_transom(zt0 - 0.9, 0, wn * 0.75, wn * 0.75 / 8, 1)
    for x in (-0.9, 0.0, 0.9):
        on_transom(zt0 - 1.5, x, 0.45, 0.5)
    hull_name(m, hull, 0.905, sheer(0.905) - 0.42, 3.2, 0.32, 0, mat=NAMES2)
    # where to walk: the flat waist between the cabin and the forecastle
    t0w, t1w = 0.21, 0.79
    hw = hull.hb(0.5, zd(0.5)) - 0.25
    m.extras["deck"] = {
        "y": round(zd(0.5), 3),
        "rect": [round(-hw, 3), round(hw, 3), round(hull.y(t1w, zd(t1w)), 3), round(hull.y(t0w, zd(t0w)), 3)],
        "obstacles": [[round(v, 3) for v in r] for r in obstacles],
        "gangway": [round(-hull.hb(0.447, zd(0.447)), 3), round((yg0 + yg1) / 2, 3)],
    }
    # M7 boats: her riding light on the forestay, lit at night
    lantern(m, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 3.2), 0)
    return m


def schooner():
    """A two-masted topsail schooner of the 1870s, ~26 m, under sail: fore and main gaff sails,
    a square fore topsail, two jibs, all set. Black hull, a white sheer strake, coppered."""
    m = Mesh(ao=0.0)
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

    ts = [0, 0.03, 0.08, 0.16, 0.3, 0.45, 0.6, 0.72, 0.82, 0.9, 0.95, 0.98, 1.0]
    levels = [keel, lambda t: keel(t) + 0.6, lambda t: -1.0, lambda t: 0.1, lambda t: sheer(t) - 0.35, sheer]
    hull = Hull(L, ts, levels, hb, [(COPPER, 0), (COPPER, 0), (COPPER, 0), (TAR, 0), (WHITE, 3.0)], yfn=yfn,
                shade=lambda p: 0.5 + 0.5 * sm((p.z + 2.2) / 4.5))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 0.75

    hull.deck(m, zd, 0, 1, 0.1, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.1, WHITE, DARK)
    # masts, raked aft
    yf, ym_ = hull.y(0.68, zd(0.68)), hull.y(0.38, zd(0.38))
    zf, zm_ = zd(0.68), zd(0.38)
    rk = 0.08
    ftop = V(0, yf + rk * 17.0, zf + 17.0)
    mtop = V(0, ym_ + rk * 19.0, zm_ + 19.0)
    spar(m, (0, yf, zf - 0.3), ftop, 0.24, 0.12, cap=True)
    spar(m, (0, ym_, zm_ - 0.3), mtop, 0.26, 0.12, cap=True)

    def on(y0, z0, z):
        return V(0, y0 + rk * (z - z0), z)

    # fore: gaff foresail and the square topsail above it
    fg0 = on(yf, zf, zf + 10.5)
    fg1 = fg0 + V(0, 5.5 * math.cos(0.5), 5.5 * math.sin(0.5))
    spar(m, fg0, fg1, 0.1, 0.07)
    ffoot0, ffoot1 = on(yf, zf, zf + 1.6) + V(0, 0.3, 0), V(0, ym_ - 1.2, zf + 1.8)
    sail(m, fg0 + V(0, 0.25, -0.15), fg1 + V(0, -0.15, -0.1), ffoot0, ffoot1, V(0.9, 0, 0), nu=3, nv=4)
    ty = on(yf, zf, zf + 15.8) + V(0, -0.4, 0)
    by = on(yf, zf, zf + 12.2) + V(0, -0.4, 0)
    yard(m, ty, 8.5, 0.12, 0)
    yard(m, by, 10.5, 0.14, 0)
    sail(m, ty + V(-3.9, -0.1, -0.1), ty + V(3.9, -0.1, -0.1), by + V(-4.8, -0.15, 0.2), by + V(4.8, -0.15, 0.2),
         V(0, -0.5, 0), nu=4, nv=2)
    # main: gaff mainsail on a long boom over the stern
    mg0 = on(ym_, zm_, zm_ + 12.5)
    mg1 = mg0 + V(0, 7.0 * math.cos(0.55), 7.0 * math.sin(0.55))
    spar(m, mg0, mg1, 0.11, 0.07)
    mb0 = on(ym_, zm_, zm_ + 1.8)
    mb1 = mb0 + V(0, 11.5, 0.4)
    spar(m, mb0, mb1, 0.14, 0.09)
    sail(m, mg0 + V(0, 0.25, -0.15), mg1 + V(0, -0.15, -0.1), mb0 + V(0, 0.3, 0.2), mb1 + V(0, -0.4, 0.2), V(1.2, 0, 0),
         nu=4, nv=4)
    # bowsprit and jibboom, two jibs set, stays and shrouds
    stem_top = V(0, hull.y(1.0, sheer(1.0)), sheer(1.0))
    a = math.radians(12)
    dv = V(0, -math.cos(a), math.sin(a))
    heel = stem_top + V(0, 1.8, -0.2)
    spar(m, heel, heel + dv * 7.0, 0.22, 0.15)
    spar(m, heel + dv * 4.5, heel + dv * 12.0, 0.12, 0.06)
    for k, (tk, hd) in enumerate(((6.5, 0.62), (11.5, 0.7))):
        tack = heel + dv * tk
        stay_top = ftop - V(0, 0, 3.5 if k == 0 else 0.4)
        rig(m, stay_top, tack, 0.025)
        head = tack.lerp(stay_top, hd)
        sail(m, head, head, tack + V(0, 0.1, 0.1), V(1.2, yf - 3.0 - 2.5 * k, zf + 1.4 + 0.5 * k), V(0.8, 0, 0), nu=2,
             nv=3)
    rig(m, mtop - V(0, 0, 0.6), ftop - V(0, 0, 3.0))
    rig(m, heel + dv * 7.0, V(0, hull.y(1.0, 0.3) + 0.2, 0.3))
    for y0, z0, top_ in ((yf, zf, ftop), (ym_, zm_, mtop)):
        for sx in (1, -1):
            t0 = 0.68 if top_ is ftop else 0.38
            w = hull.hb(t0, sheer(t0))
            shroud_quad(m, (sx * w, y0 - 0.8, sheer(t0)), (sx * w, y0 + 1.3, sheer(t0)), top_ - V(0, 0, 4.5) + V(sx * 0.2, 0.2, 0),
                        top_ - V(0, 0, 4.5) + V(sx * 0.2, -0.2, 0), n=3)
            rig(m, top_ - V(0, 0, 0.8), V(sx * w, y0 + 4.5, sheer(t0)))
    # peak halyards and a sheet, deckhouse, wheel, flag at the main peak
    rig(m, ftop - V(0, 0, 1.0), fg1)
    rig(m, mtop - V(0, 0, 0.8), mg1)
    rig(m, mb1, hull.P(0.02, sheer(0.02), 1) + V(0, 0, 0.2))
    y0, y1 = hull.y(0.56, zd(0.56)), hull.y(0.47, zd(0.47))
    house(m, -1.5, 1.5, y0, y1, zd(0.5) - 0.05, zd(0.5) + 1.3, wall=WOOD, roof=DARK, over=0.1,
          windows=[("+x", (y0 + y1) / 2, zd(0.5) + 0.9), ("-x", (y0 + y1) / 2, zd(0.5) + 0.9)])
    zq = zd(0.08)
    m.box((0, hull.y(0.08, zq), zq + 0.35), (0.8, 0.6, 0.7), DARK)
    wheel_helm(m, V(0, hull.y(0.08, zq) - 0.5, zq + 1.0), 0.5)
    windlass(m, 0, hull.y(0.93, zd(0.93)), zd(0.93) + 0.35, w=1.4, r=0.17)
    for t, x in ((0.6, 1.2), (0.3, -1.3)):
        coil(m, (x, hull.y(t, zd(t)), zd(t)), 0.28)
    flag(m, mg1 + V(0, 0.05, -0.05), 1.5, 1.0, along=(0, 0.2, -1), kind="dutch")
    pennant(m, ftop + V(0, 0, 0.2), 2.5, h=0.25)
    hull_name(m, hull, 0.9, sheer(0.9) - 0.3, 2.2, 0.275, 7)
    # M7 boats: her riding light on the forestay
    lantern(m, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 2.8), 0)
    return m


class MastPlan:
    """A raked mast: lower mast, topmast, topgallant pole; axis point at any height."""

    def __init__(self, y, zd, h1, h2, h3, rake, r=0.34):
        self.y, self.zd, self.h1, self.h2, self.h3, self.rake, self.r = y, zd, h1, h2, h3, rake, r

    def at(self, z):
        return V(0, self.y + self.rake * (z - self.zd), z)

    def build(self, m, top_w=2.8, top_d=2.0):
        r = self.r
        spar(m, self.at(self.zd - 0.3), self.at(self.h1 + 0.4), r, r * 0.82)
        spar(m, self.at(self.h1 - 2.2) + V(0, -0.5, 0), self.at(self.h2 + 0.3) + V(0, -0.5, 0), r * 0.62, r * 0.46)
        if self.h3 > self.h2:
            spar(m, self.at(self.h2 - 1.8) + V(0, -0.8, 0), self.at(self.h3) + V(0, -0.8, 0), r * 0.36, r * 0.16, cap=True)
        # the top (a platform), the cap, crosstrees
        m.box(self.at(self.h1) + V(0, 0.1, 0), (top_w, top_d, 0.14), DARK, shade=0.8)
        m.box(self.at(self.h1 + 0.45) + V(0, -0.25, 0), (0.5, 1.0, 0.25), DARK)
        c = self.at(self.h2) + V(0, -0.5, 0)
        m.beam(c + V(-1.1, 0, 0), c + V(1.1, 0, 0), 0.1, 0.1, DARK, side=(0, 1, 0))
        m.beam(c + V(0, -0.5, 0), c + V(0, 0.5, 0), 0.1, 0.1, DARK)

    def top(self, level):
        """Axis point of the lower mast (1), topmast (2) or topgallant (3) head."""
        z = (self.h1, self.h2, self.h3)[level - 1]
        return self.at(z) + V(0, (0, -0.5, -0.8)[level - 1], 0)


def barque(sailing=False):
    """A three-masted barque of the 1870s, ~48 m: black hull with a painted port band,
    copper below the waterline, square yards on fore and main with the sails furled,
    fore-and-aft mizzen, bowsprit and jibboom, deckhouse with a boat on it."""
    m = Mesh(ao=0.0)
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
            p = max(p, 0.55 * sm((u - 0.5) / 0.5) * (1 - t / 0.32) + p * 0)
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -3.0 * u ** 1.3 * sm((t - 0.9) / 0.1) + 2.2 * u ** 2 * sm((0.06 - t) / 0.06)

    ts = [0, 0.02, 0.05, 0.1, 0.18, 0.3, 0.45, 0.6, 0.7, 0.8, 0.88, 0.93, 0.97, 1.0]
    levels = [keel, lambda t: keel(t) + 0.9, lambda t: -1.8, lambda t: 0.15, lambda t: sheer(t) - 1.6,
              lambda t: sheer(t) - 0.8, sheer]
    mats = [(COPPER, 0), (COPPER, 0), (COPPER, 0), (TAR, 0), (BAND, 5.0), (TAR, 0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 3.5) / 6.5))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 1.1

    hull.deck(m, zd, 0, 1, 0.12, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.15, WHITE, DARK)

    # masts
    def plan(t, h1, h2, h3, rake, r):
        return MastPlan(hull.y(t, zd(t)), zd(t), zd(t) + h1, zd(t) + h2, zd(t) + h3, rake, r)

    fore = plan(0.77, 14.5, 25.0, 33.0, 0.02, 0.34)
    main = plan(0.52, 15.5, 27.0, 36.0, 0.035, 0.36)
    mizz = plan(0.27, 12.5, 21.5, 21.5, 0.05, 0.28)
    for mp in (fore, main, mizz):
        mp.build(m, top_w=2.8 if mp is not mizz else 2.2)
    # yards with furled sails, fore and main (under sail: all square sails set and drawing)
    for mp, s in ((fore, 0.93), (main, 1.0)):
        h1, h2, h3 = mp.h1, mp.h2, mp.h3
        spec = [(h1 - 1.6, 18.5, 0.24, 0.42), (h1 + 0.7, 16.0, 0.2, 0.34), (h1 + (h2 - h1) * 0.55, 14.0, 0.17, 0.3),
                (h2 + 1.0, 10.5, 0.13, 0.22), (h2 + (h3 - h2) * 0.62, 7.5, 0.1, 0.16)]
        heads = []
        for i, (z, ln, r, sr) in enumerate(spec):
            c = mp.at(z) + V(0, -0.55 - (0.5 if i >= 2 else 0) - (0.3 if i >= 3 else 0), 0)
            lift = mp.at(z + (1.8 if i < 3 else 1.2)) + V(0, -0.5, 0)
            yard(m, c, ln * s, r, 0 if sailing else sr, lifts_to=lift if i < 4 else None)
            heads.append((c, ln * s * 0.92))
        if sailing:
            for i, (c, w) in enumerate(heads):
                if i == 0:
                    fc, fw = V(c.x, c.y - 1.0, mp.zd + 3.0), w * 1.02
                else:
                    pc, pw = heads[i - 1]
                    fc, fw = pc + V(0, -0.1, 0.25), pw
                hgt = (c.z - fc.z)
                sail(m, c + V(-w / 2, -0.12, -0.12), c + V(w / 2, -0.12, -0.12), fc + V(-fw / 2, -0.2, 0),
                     fc + V(fw / 2, -0.2, 0), V(0, -0.13 * hgt, 0), nu=4, nv=3)
            if i < 2:
                # braces: from the yardarms aft to the rail
                for sx in (1, -1):
                    t_to = 0.36 if mp is main else 0.6
                    rig(m, c + V(sx * ln * s / 2 * 0.95, 0, 0), hull.P(t_to, sheer(t_to), sx) + V(0, 0, 0.1), 0.016)
    # mizzen: gaff and boom with the spanker brailed up
    g0 = mizz.at(mizz.h1 - 1.3)
    g1 = g0 + V(0, 9.0 * math.cos(0.45), 9.0 * math.sin(0.45))
    spar(m, g0, g1, 0.16, 0.1)
    b0 = mizz.at(mizz.zd + 2.3)
    b1 = b0 + V(0, 13.0, 0.4)
    spar(m, b0, b1, 0.18, 0.12)
    if sailing:
        sail(m, g0 + V(0, 0.35, -0.25), g1 + V(0, -0.3, -0.2), b0 + V(0, 0.4, 0.25), b1 + V(0, -0.8, 0.25),
             V(1.3, 0, 0), nu=4, nv=3)
    else:
        bundle(m, g0 + V(0, 0.6, -0.35), g1 + V(0, -0.8, -0.3), 0.3, CANVAS, n=5)
        bundle(m, mizz.at(mizz.zd + 3.2) + V(0, 0.4, 0), g0 + V(0, 0.4, -0.6), 0.28, CANVAS, n=3)
    rig(m, g1, b1, 0.018)
    rig(m, mizz.top(2) - V(0, 0, 0.5), g1)
    rig(m, mizz.top(2) - V(0, 0, 0.3), b1)
    flag(m, g1 + V(0, 0.05, -0.1), 2.0, 1.3, along=(0, 0.2, -1), kind="belgian")
    # bowsprit, jibboom, headsails furled on the boom
    tb = 1.0
    stem_top = V(0, hull.y(tb, sheer(tb)), sheer(tb))
    a = math.radians(13)
    dv = V(0, -math.cos(a), math.sin(a))
    heel = stem_top + V(0, 3.0, -0.3)
    bs_end = heel + dv * 11.0
    spar(m, heel, bs_end, 0.36, 0.26)
    jb0, jb1 = heel + dv * 7.5, heel + dv * 19.0
    spar(m, jb0, jb1, 0.2, 0.09)
    m.box(bs_end + V(0, 0.15, 0.05), (0.6, 0.35, 0.6), DARK)
    if not sailing:
        bundle(m, heel + dv * 11.8 + V(0, 0, 0.22), heel + dv * 18.3 + V(0, 0, 0.14), 0.22, CANVAS, n=4)
    striker = bs_end + V(0, 0.2, -2.2)
    spar(m, bs_end + V(0, 0.2, -0.2), striker, 0.07, 0.06)
    rig(m, bs_end, V(0, hull.y(1.0, 0.4) + 0.4, 0.4), 0.035)
    rig(m, jb1, striker, 0.022)
    rig(m, striker, V(0, hull.y(1.0, 1.3) + 0.3, 1.3), 0.022)
    for sx in (1, -1):
        rig(m, bs_end + V(sx * 0.25, 0, 0), hull.P(0.95, sheer(0.95) - 0.9, sx), 0.022)
    # figurehead under the bowsprit
    fh = [V(0, hull.y(1.0, sheer(1.0) - 1.6) + 0.35, sheer(1.0) - 1.6), V(0, hull.y(1.0, sheer(1.0) - 1.0) - 0.2, sheer(1.0) - 1.0),
          V(0, hull.y(1.0, sheer(1.0) - 0.4) - 0.55, sheer(1.0) - 0.45)]
    m.tube(fh, [0.18, 0.26, 0.15], 5, WHITE, smooth=False, cap0=True, cap1=True, side=(1, 0, 0))
    # stays
    fs = [(fore.top(1), heel + dv * 6.0), (fore.top(2), jb0 + dv * 5.0), (fore.top(3) - V(0, 0, 1.2), jb1)]
    ms = [(main.top(1), fore.at(fore.zd + 1.2) + V(0, 0.6, 0)), (main.top(2), fore.top(1)), (main.top(3) - V(0, 0, 1.2), fore.top(2))]
    zs = [(mizz.top(1), main.at(main.h1 - 3.5)), (mizz.top(2), main.top(1) + V(0, 0, 0.4))]
    for a_, b_ in fs + ms + zs:
        rig(m, a_, b_, 0.03)
    if sailing:
        # the headsails set on the fore stays: staysail, inner jib, outer jib
        for k, (top_, low_) in enumerate(fs):
            tack = Vector(low_)
            head = tack.lerp(Vector(top_), 0.72 - 0.08 * k)
            clew = V(1.5, stem_top.y + 3.5 - 2.2 * k, sheer(1.0) + 1.6 + 0.6 * k)
            sail(m, head, head, tack + V(0, 0.2, 0.1), clew, V(1.0, 0, 0), nu=2, nv=3)
    # shrouds (with ratlines), channels, backstays
    for mp, tm in ((fore, 0.77), (main, 0.52), (mizz, 0.27)):
        ym = mp.y
        wch = hull.hb(tm, mp.zd + 0.4)
        for sx in (1, -1):
            m.box((sx * (wch + 0.18), ym + 0.2, mp.zd + 0.35), (0.4, 3.6, 0.12), DARK)
            shroud_quad(m, (sx * (wch + 0.34), ym - 1.5, mp.zd + 0.4), (sx * (wch + 0.34), ym + 1.8, mp.zd + 0.4),
                        mp.at(mp.h1 - 0.7) + V(sx * 0.34, 0.35, 0), mp.at(mp.h1 - 0.7) + V(sx * 0.34, -0.35, 0))
            tw = 1.3 if mp is not mizz else 1.0
            shroud_quad(m, mp.at(mp.h1 + 0.1) + V(sx * tw, -0.7, 0), mp.at(mp.h1 + 0.1) + V(sx * tw, 0.9, 0),
                        mp.top(2) + V(sx * 0.2, 0.15, -0.6), mp.top(2) + V(sx * 0.2, -0.15, -0.6))
            if mp.h3 > mp.h2:
                shroud_quad(m, mp.top(2) + V(sx * 1.0, -0.2, 0.05), mp.top(2) + V(sx * 1.0, 0.4, 0.05),
                            mp.top(3) + V(sx * 0.1, 0.05, -3.0), mp.top(3) + V(sx * 0.1, -0.05, -3.0))
            for lvl, dy in ((2, 3.4), (3, 4.4)):
                if lvl == 3 and mp.h3 <= mp.h2:
                    continue
                rig(m, mp.top(lvl) - V(0, 0, 0.4), V(sx * (wch + 0.3), ym + dy, mp.zd + 0.4), 0.02)
    # deckhouse with the ship's boat on it, galley chimney
    y0, y1 = hull.y(0.68, zd(0.68)), hull.y(0.585, zd(0.585))
    z0 = zd(0.63) - 0.05
    house(m, -2.1, 2.1, y0, y1, z0, z0 + 2.2, wall=WHITE, roof=DARK, over=0.12,
          windows=[("+x", y0 + 1.3, z0 + 1.4), ("+x", y1 - 1.3, z0 + 1.4), ("-x", y0 + 1.3, z0 + 1.4), ("-x", y1 - 1.3, z0 + 1.4),
                   ("-y", 1.0, z0 + 1.4)], door=("-y", -0.8, 0.8, 1.8))
    chimney(m, 1.3, y1 - 0.8, z0 + 2.3, 0.8, 0.12)
    for dy in (-1.6, 1.6):
        m.box((0, (y0 + y1) / 2 + dy, z0 + 2.38), (1.2, 0.2, 0.2), DARK)
    ships_boat(m, (0, (y0 + y1) / 2, z0 + 2.48), 5.6, 1.7, 0.75, yaw=0.0, mat=WHITE, cover=CANVAS)
    # hatches with tarpaulins, casks, pumps, windlass, anchors, wheel and skylight
    for t0_, t1_ in ((0.405, 0.455), (0.705, 0.74)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        zc = zd((t0_ + t1_) / 2)
        m.box((0, (ya + yb) / 2, zc + 0.3), (2.8, yb - ya, 0.6), DARK, shade=0.9)
        m.box((0, (ya + yb) / 2, zc + 0.64), (2.95, yb - ya + 0.15, 0.08), TARP, shade=0.95)
    for i, dx in enumerate((-1.3, -0.6)):
        barrel_lo(m, (dx, main.y + 1.6, zd(0.5)), yaw=i * 1.3)
    for sx in (1, -1):
        m.box((sx * 0.6, main.y + 1.0, zd(0.52) + 0.55), (0.25, 0.25, 1.1), DARK)
    windlass(m, 0, hull.y(0.925, zd(0.925)), zd(0.925) + 0.4, w=2.2, r=0.25)
    for sx in (1, -1):
        cat = hull.P(0.95, sheer(0.95) + 0.2, sx) + V(sx * 0.6, 0, 0)
        m.beam(hull.P(0.95, sheer(0.95) + 0.1, sx, 0.4), cat, 0.3, 0.3, DARK, side=(0, 1, 0))
        with m.at(move(cat.x + sx * 0.1, cat.y, cat.z - 0.3)):
            anchor(m, V(0, 0, 0), side=(1, 0, 0), size=0.9)
    zq = zd(0.05)
    m.box((0, hull.y(0.06, zq), zq + 0.4), (1.0, 0.7, 0.8), DARK)
    wheel_helm(m, V(0, hull.y(0.06, zq) - 0.55, zq + 1.1), 0.55)
    m.box((0, hull.y(0.13, zd(0.13)), zd(0.13) + 0.35), (1.6, 1.3, 0.7), DARK)
    m.box((0, hull.y(0.13, zd(0.13)), zd(0.13) + 0.74), (1.5, 1.2, 0.08), WINDOW)
    m.box((1.4, hull.y(0.2, zd(0.2)), zd(0.2) + 0.5), (1.0, 1.2, 1.0), DARK)
    # house flag at the main truck, a long pennant at the fore
    flag(m, main.top(3) + V(0, -0.8, 0.9), 1.3, 0.9, along=(0, 1, 0))
    spar(m, main.top(3) + V(0, -0.8, 0), main.top(3) + V(0, -0.8, 1.0), 0.04, 0.03)
    pennant(m, fore.top(3) + V(0, -0.8, 0.25), 5.0, h=0.35)
    # the stern: name board, port of registry, four stern windows (on the raked transom)
    def on_transom(z, x, w, h, row=None):
        y = hull.y(0.0, z)
        dy = (hull.y(0.0, z + 0.3) - hull.y(0.0, z - 0.3)) / 0.6
        up = V(0, dy, 1).normalized()
        if row is None:
            panel(m, (x, y, z), (-1, 0, 0), up, w, h, WINDOW, off=0.06)
        else:
            name_board(m, (x, y, z), (-1, 0, 0), up, w, h, row, off=0.07)

    zt0 = sheer(0.0)
    wn = hull.hb(0.0, zt0 - 0.5) * 1.55
    on_transom(zt0 - 0.45, 0, wn, wn / 8, 0)
    on_transom(zt0 - 0.9, 0, wn * 0.75, wn * 0.75 / 8, 1)
    for x in (-1.3, -0.45, 0.45, 1.3):
        on_transom(zt0 - 1.55, x, 0.5, 0.55)
    hull_name(m, hull, 0.905, sheer(0.905) - 0.42, 3.0, 0.375, 0)
    # head rails from the catheads down to the figurehead
    for sx in (1, -1):
        a = hull.P(0.95, sheer(0.95) - 0.2, sx)
        b = V(sx * 0.55, hull.y(1.0, sheer(1.0) - 0.9) - 0.5, sheer(1.0) - 1.0)
        c = V(sx * 0.14, fh[1].y - 0.2, fh[1].z + 0.1)
        m.tube([a, b, c], [0.07, 0.06, 0.05], 4, WHITE, smooth=False, side=(0, 0, 1))
    # boats in davits on the quarters
    for sx in (1, -1):
        tq = 0.1
        xb = sx * (hull.hb(tq, sheer(tq)) + 0.95)
        yb_ = hull.y(tq, 0)
        zb_ = sheer(tq) - 0.7
        ships_boat(m, (xb, yb_, zb_), 5.0, 1.5, 0.62, mat=WHITE, cover=CANVAS)
        for dy in (-1.8, 1.8):
            base = hull.P(tq, zd(tq), sx, 0.3) + V(0, dy, 0)
            top = V(xb, yb_ + dy, zb_ + 2.0)
            m.tube([base, base + V(0, 0, 2.0), base.lerp(top, 0.75) + V(0, 0, 0.35), top], [0.07, 0.065, 0.06, 0.055], 4, IRON,
                   smooth=False, side=(0, 1, 0))
            rig(m, top, V(xb, yb_ + dy * 0.85, zb_ + 0.7))
    # fife rails round the masts with coils of the running rigging at their feet
    for mp in (fore, main, mizz):
        c = mp.at(mp.zd)
        for (ax, ay), (bx, by) in (((-0.8, -0.8), (0.8, -0.8)), ((0.8, -0.8), (0.8, 0.8)), ((0.8, 0.8), (-0.8, 0.8)),
                                   ((-0.8, 0.8), (-0.8, -0.8))):
            m.beam(c + V(ax, ay, 0.72), c + V(bx, by, 0.72), 0.1, 0.08, DARK, side=(0, 0, 1))
        for ax, ay in ((-0.8, -0.8), (0.8, -0.8), (0.8, 0.8), (-0.8, 0.8)):
            m.box(c + V(ax, ay, 0.36), (0.12, 0.12, 0.72), DARK)
        coil(m, c + V(0.35, 1.25, 0), 0.3)
        coil(m, c + V(-0.4, -1.2, 0), 0.26)
    ycap = hull.y(0.34, zd(0.34))
    with m.at(move(0, ycap, zd(0.34))):
        m.lathe([(0.45, 0.0), (0.36, 0.2), (0.3, 0.75), (0.48, 0.82), (0.48, 0.95), (0.2, 1.02)], 8, DARK, smooth=False,
                cap1=True, urep=2)
    m.box((1.9, hull.y(0.2, zd(0.2)) - 1.5, zd(0.2) + 0.35), (0.7, 1.8, 0.7), WOOD)  # hen coop
    for i, (x, t) in enumerate(((-1.6, 0.66), (-1.1, 0.665), (1.5, 0.45))):
        barrel_lo(m, (x, hull.y(t, zd(t)), zd(t)), yaw=0.7 * i)
    crate_lo(m, (1.6, hull.y(0.7, zd(0.7)), zd(0.7)), yaw=0.2)
    coil(m, (0.9, hull.y(0.92, zd(0.92)), zd(0.92)), 0.34)
    # M7 boats: a riding light at anchor; under way the red and green side lights
    if sailing:
        for sx, kind in ((1, 1), (-1, 2)):
            lantern(m, hull.P(0.72, sheer(0.72) + 0.4, sx, -0.1), kind, bail=False)
    else:
        lantern(m, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 3.4), 0)
    return m


def steamer():
    """An iron screw steamer of the 1870s, ~56 m: plumb stem, counter stern, black hull with
    portholes, red below the waterline, one funnel, two masts with yards and cargo derricks,
    a midship house with an open bridge, boats in davits, cowl ventilators."""
    m = Mesh(ao=0.0)
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

    ts = [0, 0.015, 0.035, 0.07, 0.12, 0.2, 0.3, 0.45, 0.6, 0.7, 0.8, 0.88, 0.94, 0.975, 1.0]
    levels = [keel, lambda t: keel(t) + 0.8, lambda t: -1.4, lambda t: -0.02, lambda t: 1.2, lambda t: sheer(t) - 2.0,
              lambda t: sheer(t) - 1.45, lambda t: sheer(t) - 0.2, sheer]
    mats = [(REDLEAD, 0), (REDLEAD, 0), (REDLEAD, 0), (IRONHULL, 0), (IRONHULL, 0), (PORTS, 8.0), (IRONHULL, 0),
            (WHITE, 4.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 3.0) / 6.0))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 1.0

    hull.deck(m, zd, 0, 1, 0.1, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.1, WHITE, DARK, shade=0.9)
    # midship house, its roof deck with rails, the bridge across the ship
    zh = zd(0.5)
    hy0, hy1 = hull.y(0.61, zh), hull.y(0.4, zh)
    HH = 2.4
    wins = []
    for f in (0.12, 0.3, 0.5, 0.7, 0.88):
        a = hy0 + (hy1 - hy0) * f
        wins += [("+x", a, zh + 1.5), ("-x", a, zh + 1.5)]
    house(m, -2.6, 2.6, hy0, hy1, zh - 0.05, zh + HH, wall=WOOD, roof=DECK, over=0.25, windows=wins,
          door=("-y", 0.0, 0.8, 1.9))
    zr = zh + HH + 0.1
    for sx in (1, -1):
        rig(m, (sx * 2.8, hy0 + 1.5, zr + 0.9), (sx * 2.8, hy1 + 0.2, zr + 0.9), 0.03, IRON)
        for y in np.linspace(hy0 + 1.5, hy1 + 0.2, 7):
            rig(m, (sx * 2.8, y, zr), (sx * 2.8, y, zr + 0.95), 0.025, IRON)
    rig(m, (-2.8, hy1 + 0.2, zr + 0.9), (2.8, hy1 + 0.2, zr + 0.9), 0.03, IRON)
    # bridge: platform across the whole beam, rails, canvas dodger, wheelhouse, binnacle
    by0, by1 = hy0 - 0.25, hy0 + 1.4
    zb = zr + 0.9
    m.box((0, (by0 + by1) / 2, zb), (B + 0.6, by1 - by0, 0.12), DECK, tile=1.6)
    for sx in (1, -1):
        for y in (by0 + 0.1, by1 - 0.1):
            m.beam((sx * 3.1, y, zd(0.61)), (sx * 3.1, y, zb - 0.06), 0.1, 0.1, IRON, side=(1, 0, 0))
    for y in (by0, by1):
        rig(m, (-(B / 2 + 0.25), y, zb + 1.0), ((B / 2 + 0.25), y, zb + 1.0), 0.03, IRON)
        for x in np.linspace(-(B / 2 + 0.25), B / 2 + 0.25, 9):
            rig(m, (x, y, zb + 0.06), (x, y, zb + 1.0), 0.025, IRON)
    m.poly([V(-(B / 2 + 0.25), by0 - 0.02, zb + 0.08), V(B / 2 + 0.25, by0 - 0.02, zb + 0.08),
            V(B / 2 + 0.25, by0 - 0.02, zb + 0.95), V(-(B / 2 + 0.25), by0 - 0.02, zb + 0.95)], CANVAS,
           uvs=[(0, 0), (6, 0), (6, 0.6), (0, 0.6)])
    house(m, -1.0, 1.0, by0 + 0.15, by1 - 0.1, zb + 0.06, zb + 2.0, wall=WHITE, roof=DARK, over=0.1,
          windows=[("-y", -0.45, zb + 1.35), ("-y", 0.45, zb + 1.35), ("+x", (by0 + by1) / 2, zb + 1.35),
                   ("-x", (by0 + by1) / 2, zb + 1.35)])
    # funnel, raked aft, with its steam pipe and guys
    fy = hull.y(0.505, zr)
    FH = 8.5
    rake = 0.11
    with m.at(move(0, fy, zr) @ Matrix.Rotation(-rake, 4, "X")):
        m.lathe([(0.98, -0.3), (0.98, FH), (1.04, FH + 0.05), (1.04, FH + 0.2)], 10, FUNNEL, urep=2, vscale=1 / FH,
                smooth=False)
        spar(m, V(0, -1.12, 0), V(0, -1.12, FH + 0.7), 0.1, 0.1, IRON, sides=5, cap=True)
    top_ring = FH * 0.72
    ftop = V(0, fy + math.sin(rake) * top_ring, zr + math.cos(rake) * top_ring)
    for dx, dy in ((2.6, 2.5), (-2.6, 2.5), (2.6, -1.0), (-2.6, -1.0)):
        rig(m, ftop, (dx, fy + dy, zr + 0.05), 0.02)
    # cowl ventilators
    def cowl(x, y, z, h, r, face):
        path = [V(x, y, z), V(x, y, z + h * 0.75), V(x, y + face * r * 0.4, z + h * 0.95),
                V(x, y + face * r * 1.1, z + h + r * 0.4)]
        m.tube(path, [r * 0.7, r * 0.7, r * 0.85, (r * 1.3, r * 1.3)], 6, WHITE, smooth=False, urep=2, vscale=0.5)
        m.tube([path[-1], path[-1] + V(0, face * 0.02, 0.01)], [r * 1.3, r * 0.5], 6, DARK, smooth=False, cap1=True)
    for sx in (1, -1):
        cowl(sx * 1.6, fy - 1.9, zr, 2.0, 0.42, -1)
        cowl(sx * 1.7, hull.y(0.72, zd(0.72)), zd(0.72), 1.6, 0.35, -1)
    # boats in davits along the house
    for sx in (1, -1):
        for bc in (hy0 + 2.9, hy1 - 2.6):
            ships_boat(m, (sx * 3.55, bc, zd(0.5) + 1.7), 5.2, 1.6, 0.72, mat=WHITE, cover=CANVAS)
            for dy in (-2.0, 2.0):
                base = V(sx * 4.0, bc + dy, zd(0.5))
                path = [base, base + V(0, 0, 3.0), base + V(-sx * 0.15, 0, 3.8), base + V(-sx * 0.55, 0, 4.1)]
                m.tube(path, [0.08, 0.075, 0.065, 0.06], 4, WHITE, smooth=False, side=(0, 1, 0), urep=1)
                rig(m, path[-1], V(sx * 3.55, bc + dy * 0.85, zd(0.5) + 1.7 + 0.8), 0.02)
    # masts, yards, gaff, derricks
    fore = MastPlan(hull.y(0.8, zd(0.8)), zd(0.8), zd(0.8) + 14.0, zd(0.8) + 24.0, zd(0.8) + 24.0, 0.07, 0.3)
    main = MastPlan(hull.y(0.27, zd(0.27)), zd(0.27), zd(0.27) + 13.0, zd(0.27) + 21.0, zd(0.27) + 21.0, 0.07, 0.28)
    for mp in (fore, main):
        mp.build(m, top_w=2.0, top_d=1.4)
    yard(m, fore.at(fore.h1 - 1.2) + V(0, -0.5, 0), 13.0, 0.2, 0.34, lifts_to=fore.at(fore.h1 + 0.5))
    yard(m, fore.at(fore.h1 + 3.6) + V(0, -1.0, 0), 10.5, 0.16, 0.27, lifts_to=fore.top(2) + V(0, 0, -1.0))
    yard(m, fore.at(fore.h1 + 7.4) + V(0, -1.0, 0), 7.5, 0.12, 0.18)
    g0 = main.at(main.h1 - 1.0)
    g1 = g0 + V(0, 7.0 * math.cos(0.5), 7.0 * math.sin(0.5))
    spar(m, g0, g1, 0.14, 0.09)
    b0, b1 = main.at(main.zd + 2.4), main.at(main.zd + 2.4) + V(0, 9.0, 0.3)
    spar(m, b0, b1, 0.15, 0.1)
    bundle(m, b0 + V(0, 0.5, 0.3), b1 + V(0, -0.6, 0.28), 0.3, CANVAS, n=4)
    rig(m, g1, b1, 0.018)
    rig(m, main.top(2) - V(0, 0, 0.4), g1)
    flag(m, g1 + V(0, 0.05, -0.05), 1.6, 1.05, along=(0, 0.25, -1))
    for mp, face, t_h in ((fore, 1, 0.69), (main, -1, 0.35)):
        for sx in (1, -1):
            heel = mp.at(mp.zd + 1.4) + V(sx * 0.35, face * 0.35, 0)
            head = heel + V(sx * 1.4, face * 7.0, 6.2)
            spar(m, heel, head, 0.14, 0.08)
            rig(m, head, mp.at(mp.h1 - 0.4), 0.025)
            rig(m, head, head - V(0, 0, 3.0 + 0.8 * sx), 0.02, IRON)
            m.box(head - V(0, 0, 3.1 + 0.8 * sx), (0.14, 0.16, 0.22), IRON)
        rig(m, mp.at(mp.zd + 1.4) + V(0, face * 0.5, 0), hull.P(t_h, zd(t_h), 1, 1.5) + V(0, 0, 0.3), 0.03, ROPE)
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.3, sheer(1.0))
    rig(m, fore.top(1), stem, 0.03)
    rig(m, fore.top(2), stem + V(0, 0.2, 0.2), 0.025)
    rig(m, main.top(1), ftop + V(0, 0.6, 0.6), 0.025)
    rig(m, main.top(2), fore.top(2) - V(0, 0, 1.0), 0.022)
    for mp, tm in ((fore, 0.8), (main, 0.27)):
        w = hull.hb(tm, sheer(tm))
        for sx in (1, -1):
            shroud_quad(m, (sx * (w - 0.05), mp.y - 0.9, sheer(tm)), (sx * (w - 0.05), mp.y + 1.6, sheer(tm)),
                        mp.at(mp.h1 - 0.6) + V(sx * 0.3, 0.3, 0), mp.at(mp.h1 - 0.6) + V(sx * 0.3, -0.3, 0))
            shroud_quad(m, mp.at(mp.h1 + 0.1) + V(sx * 1.0, -0.5, 0), mp.at(mp.h1 + 0.1) + V(sx * 1.0, 0.7, 0),
                        mp.top(2) + V(sx * 0.15, 0.1, -0.6), mp.top(2) + V(sx * 0.15, -0.1, -0.6))
            rig(m, mp.top(2) - V(0, 0, 0.4), V(sx * (w - 0.05), mp.y + 3.2, sheer(tm)), 0.02)
    # hatches, windlass, anchors, skylight, wheel aft, flagstaff
    for t0_, t1_ in ((0.66, 0.72), (0.32, 0.37)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        zc = zd((t0_ + t1_) / 2)
        m.box((0, (ya + yb) / 2, zc + 0.3), (3.4, yb - ya, 0.6), DARK, shade=0.9)
        m.box((0, (ya + yb) / 2, zc + 0.64), (3.55, yb - ya + 0.15, 0.08), TARP, shade=0.95)
    windlass(m, 0, hull.y(0.93, zd(0.93)), zd(0.93) + 0.4, w=2.0, r=0.22)
    for sx in (1, -1):
        cat = hull.P(0.93, sheer(0.93) + 0.15, sx) + V(sx * 0.5, 0, 0)
        m.beam(hull.P(0.93, sheer(0.93) + 0.05, sx, 0.4), cat, 0.25, 0.25, IRON, side=(0, 1, 0))
        with m.at(move(cat.x + sx * 0.1, cat.y, cat.z - 0.3)):
            anchor(m, V(0, 0, 0), side=(1, 0, 0), size=0.8)
    m.box((0, hull.y(0.2, zd(0.2)), zd(0.2) + 0.4), (1.8, 1.4, 0.8), DARK)
    m.box((0, hull.y(0.2, zd(0.2)), zd(0.2) + 0.84), (1.7, 1.3, 0.08), WINDOW)
    zq = zd(0.1)
    m.box((0, hull.y(0.1, zq), zq + 0.4), (1.0, 0.7, 0.8), DARK)
    wheel_helm(m, V(0, hull.y(0.1, zq) - 0.55, zq + 1.1), 0.6)
    fs0 = V(0, hull.y(0.0, sheer(0.0)) - 0.4, zd(0.0))
    spar(m, fs0, fs0 + V(0, 0.4, 4.5), 0.06, 0.04, cap=True)
    flag(m, fs0 + V(0, 0.45, 4.4), 1.7, 1.1, along=(0, 1, -0.15), kind="belgian")
    pennant(m, fore.top(2) + V(0, 0, 0.3), 3.5, h=0.3)
    m.smoke.append(V(0, fy + math.sin(rake) * (FH + 0.3), zr + math.cos(rake) * (FH + 0.3)))
    hull_name(m, hull, 0.92, sheer(0.92) - 0.62, 3.4, 0.425, 2)
    hull_name(m, hull, 0.1, sheer(0.1) - 0.62, 3.2, 0.4, 2)
    hull_name(m, hull, 0.1, sheer(0.1) - 1.1, 2.6, 0.325, 1)
    # lifebuoys on the bridge rail, coils and cargo on deck
    for sx in (1, -1):
        c = V(sx * 3.4, by0 - 0.06, zb + 0.55)
        ring = [c + V(0.3 * math.cos(2 * math.pi * i / 8), 0, 0.3 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
        m.tube(ring, [0.07] * 8, 4, WHITE, side=(0, 1, 0), closed_path=True, smooth=False)
    for t, x, r in ((0.95, -1.4, 0.34), (0.95, 1.4, 0.34), (0.25, 1.8, 0.3), (0.06, -1.2, 0.3)):
        coil(m, (x, hull.y(t, zd(t)), zd(t)), r)
    zc = zd(0.69)
    for i, (x, dy, sz) in enumerate(((-0.9, 0.0, (1.1, 0.9, 0.8)), (0.4, 0.3, (1.0, 1.0, 0.9)), (-0.3, -0.2, (0.8, 0.7, 0.6)))):
        crate_lo(m, (x, hull.y(0.69, zc) + dy, zc + 0.68 + (0.8 if i == 2 else 0)), size=sz, yaw=0.15 * i)
    for i, x in enumerate((-2.2, -1.5, 2.1)):
        barrel_lo(m, (x, hull.y(0.34, zd(0.34)), zd(0.34)), yaw=i)
    # propeller and rudder under the counter
    py = L / 2 - 0.9
    with m.at(move(0, py, -2.3) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.25, -0.4), (0.3, 0.0), (0.2, 0.4)], 6, IRON, smooth=False, cap0=True, cap1=True)
    for k in range(4):
        a = math.pi / 2 * k + 0.4
        d = V(math.cos(a), 0, math.sin(a))
        s = V(-math.sin(a), 0.35, math.cos(a)).normalized()
        c = V(0, py, -2.3)
        m.slab([c + d * 0.25 - s * 0.35, c + d * 0.25 + s * 0.35, c + d * 1.5 + s * 0.3, c + d * 1.5 - s * 0.25], 0.05, IRON,
               out=(0, -1, 0))
    rud = [V(0, L / 2 + 0.15, KZ + 0.9), V(0, L / 2 + 1.6, KZ + 0.9), V(0, L / 2 + 1.6, 0.4), V(0, L / 2 + 0.15, 0.9)]
    m.prism([p + V(-0.08, 0, 0) for p in rud], (0.16, 0, 0), IRON, tile=2.0)
    # M7 boats: a riding light forward
    lantern(m, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 3.0), 0)
    return m


def liner():
    """An ocean steamer of the Antwerp - New York line, 1873, ~97 m, built after what is known of
    the Red Star Line's first ships, the Vaderland and the Nederland (Palmers, Jarrow, 1872-73:
    iron, single screw, 320 ft by 38 ft 6 in, one funnel, three masts). Clipper bow with a
    bowsprit, elliptical counter, black hull with two rows of ports, red below the waterline,
    long low deckhouses, an open bridge, a black funnel with a white band and a red star,
    barque rig (square yards on fore and main, gaffs on all three), six boats in davits.
    She lies at anchor: the port anchor is down (its chain runs from the hawse forward into the
    water), a derrick is swung out over the port side (+X) for the lighters, the accommodation
    ladder is down on that side forward. The name is our own (KEMPENLAND), not a real ship."""
    m = Mesh(ao=0.0)
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

    ts = [0, 0.012, 0.03, 0.06, 0.1, 0.16, 0.24, 0.34, 0.46, 0.58, 0.68, 0.77, 0.85, 0.91, 0.95, 0.98, 1.0]
    levels = [keel, lambda t: keel(t) + 1.0, lambda t: -2.6, lambda t: -0.02, lambda t: 1.1, lambda t: 1.65,
              lambda t: sheer(t) - 2.2, lambda t: sheer(t) - 1.65, lambda t: sheer(t) - 0.22, sheer]
    mats = [(REDLEAD, 0), (REDLEAD, 0), (REDLEAD, 0), (IRONHULL, 0), (PORTS, 8.0), (IRONHULL, 0), (PORTS, 8.0),
            (IRONHULL, 0), (WHITE, 4.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 4.5) / 9.0))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 1.1

    hull.deck(m, zd, 0, 1, 0.12, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.12, WHITE, DARK, shade=0.9)
    PORT = 1  # +X: the side the lighters come to (the town side, as she lies)

    # the midship house (saloon and engine casing), rails on its roof
    zh = zd(0.5)
    hy0, hy1 = hull.y(0.64, zh), hull.y(0.40, zh)
    HH, HW = 2.4, 3.8
    wins = []
    for k in range(8):
        a = hy0 + (hy1 - hy0) * (k + 0.5) / 8
        wins += [("+x", a, zh + 1.5), ("-x", a, zh + 1.5)]
    house(m, -HW, HW, hy0, hy1, zh - 0.05, zh + HH, wall=WOOD, roof=DECK, over=0.25, windows=wins,
          door=("+y", 0.0, 0.9, 1.9))
    zr = zh + HH + 0.1
    for sx in (1, -1):
        rig(m, (sx * (HW + 0.2), hy0 + 1.6, zr + 0.9), (sx * (HW + 0.2), hy1 + 0.2, zr + 0.9), 0.03, IRON)
        for y in np.linspace(hy0 + 1.6, hy1 + 0.2, 9):
            rig(m, (sx * (HW + 0.2), y, zr), (sx * (HW + 0.2), y, zr + 0.95), 0.025, IRON)
    rig(m, (-(HW + 0.2), hy1 + 0.2, zr + 0.9), (HW + 0.2, hy1 + 0.2, zr + 0.9), 0.03, IRON)
    # the bridge across the ship at the front of the house: platform, rails, dodger, wheelhouse
    by0, by1 = hy0 - 0.3, hy0 + 1.5
    zb = zr + 1.0
    WB = B / 2 + 0.3
    m.box((0, (by0 + by1) / 2, zb), (2 * WB, by1 - by0, 0.12), DECK, tile=1.6)
    for sx in (1, -1):
        for y in (by0 + 0.1, by1 - 0.1):
            m.beam((sx * (WB - 0.3), y, zd(0.64)), (sx * (WB - 0.3), y, zb - 0.06), 0.1, 0.1, IRON, side=(1, 0, 0))
    for y in (by0, by1):
        rig(m, (-WB, y, zb + 1.0), (WB, y, zb + 1.0), 0.03, IRON)
        for x in np.linspace(-WB, WB, 11):
            rig(m, (x, y, zb + 0.06), (x, y, zb + 1.0), 0.025, IRON)
    m.poly([V(-WB, by0 - 0.02, zb + 0.08), V(WB, by0 - 0.02, zb + 0.08), V(WB, by0 - 0.02, zb + 0.95),
            V(-WB, by0 - 0.02, zb + 0.95)], CANVAS, uvs=[(0, 0), (8, 0), (8, 0.6), (0, 0.6)])
    house(m, -1.3, 1.3, by0 + 0.15, by1 - 0.1, zb + 0.06, zb + 2.1, wall=WHITE, roof=DARK, over=0.1,
          windows=[("-y", -0.6, zb + 1.4), ("-y", 0.6, zb + 1.4), ("+x", (by0 + by1) / 2, zb + 1.4),
                   ("-x", (by0 + by1) / 2, zb + 1.4)])
    for sx in (1, -1):
        c = V(sx * (WB - 0.9), by0 - 0.06, zb + 0.55)
        ring = [c + V(0.32 * math.cos(2 * math.pi * i / 8), 0, 0.32 * math.sin(2 * math.pi * i / 8)) for i in range(8)]
        m.tube(ring, [0.07] * 8, 4, WHITE, side=(0, 1, 0), closed_path=True, smooth=False)
    # the funnel: black, white band, red star; raked aft, steam pipe, guys
    fy = hull.y(0.53, zr)
    FH, FR, rake = 13.5, 1.45, 0.1
    with m.at(move(0, fy, zr) @ Matrix.Rotation(-rake, 4, "X")):
        m.lathe([(FR, -0.3), (FR, FH), (FR + 0.07, FH + 0.05), (FR + 0.07, FH + 0.25)], 12, FUNNEL_STAR, urep=2,
                vscale=1 / FH, smooth=False)
        spar(m, V(0, -FR - 0.18, 0), V(0, -FR - 0.18, FH + 0.9), 0.13, 0.13, IRON, sides=5, cap=True)
    ring_h = FH * 0.75
    ftop = V(0, fy + math.sin(rake) * ring_h, zr + math.cos(rake) * ring_h)
    for dx, dy in ((3.4, 3.2), (-3.4, 3.2), (3.4, -1.5), (-3.4, -1.5)):
        rig(m, ftop, (dx, fy + dy, zr + 0.05), 0.02)
    m.smoke.append(V(0, fy + math.sin(rake) * (FH + 0.4), zr + math.cos(rake) * (FH + 0.4)))

    def cowl(x, y, z, h, r, face):
        path = [V(x, y, z), V(x, y, z + h * 0.75), V(x, y + face * r * 0.4, z + h * 0.95),
                V(x, y + face * r * 1.1, z + h + r * 0.4)]
        m.tube(path, [r * 0.7, r * 0.7, r * 0.85, (r * 1.3, r * 1.3)], 6, WHITE, smooth=False, urep=2, vscale=0.5)
        m.tube([path[-1], path[-1] + V(0, face * 0.02, 0.01)], [r * 1.3, r * 0.5], 6, DARK, smooth=False, cap1=True)

    for sx in (1, -1):
        cowl(sx * 2.2, fy - 2.6, zr, 2.6, 0.5, -1)
        cowl(sx * 2.2, fy + 3.0, zr, 2.2, 0.45, -1)
        cowl(sx * 2.0, hull.y(0.79, zd(0.79)), zd(0.79), 1.8, 0.38, -1)
    # engine-room skylight aft of the funnel
    m.box((0, fy + 5.2, zr + 0.35), (2.2, 3.0, 0.7), DARK)
    m.box((0, fy + 5.2, zr + 0.74), (2.1, 2.9, 0.08), WINDOW)
    # boats in davits: two each side along the house, one each side on the quarters
    for sx in (1, -1):
        for bc, zb_ in ((hy0 + 4.0, zd(0.55)), (hy1 - 4.0, zd(0.45)), (hull.y(0.25, 0), zd(0.25))):
            ships_boat(m, (sx * 5.05, bc, zb_ + 1.8), 7.0, 1.9, 0.8, mat=WHITE, cover=CANVAS)
            for dy in (-2.7, 2.7):
                base = V(sx * 5.55, bc + dy, zb_)
                path = [base, base + V(0, 0, 3.2), base + V(-sx * 0.15, 0, 4.0), base + V(-sx * 0.5, 0, 4.3)]
                m.tube(path, [0.09, 0.085, 0.075, 0.07], 4, WHITE, smooth=False, side=(0, 1, 0), urep=1)
                rig(m, path[-1], V(sx * 5.05, bc + dy * 0.85, zb_ + 1.8 + 0.9), 0.02)
    # the galley house forward, its chimney; the saloon house aft with its skylight
    ga0, ga1 = hull.y(0.745, zd(0.72)), hull.y(0.69, zd(0.72))
    zg = zd(0.72) - 0.05
    house(m, -2.2, 2.2, ga0, ga1, zg, zg + 2.1, wall=WHITE, roof=DARK, over=0.12,
          windows=[("+x", (ga0 + ga1) / 2, zg + 1.4), ("-x", (ga0 + ga1) / 2, zg + 1.4)], door=("-y", 0.0, 0.8, 1.8))
    chimney(m, 1.2, (ga0 + ga1) / 2, zg + 2.2, 1.0, 0.14)
    sa0, sa1 = hull.y(0.155, zd(0.1)), hull.y(0.065, zd(0.1))
    zs = zd(0.1) - 0.05
    sw = []
    for k in range(3):
        a = sa0 + (sa1 - sa0) * (k + 0.5) / 3
        sw += [("+x", a, zs + 1.4), ("-x", a, zs + 1.4)]
    house(m, -3.0, 3.0, sa0, sa1, zs, zs + 2.2, wall=WOOD, roof=DECK, over=0.2, windows=sw, door=("-y", 0.0, 0.9, 1.9))
    m.box((0, (sa0 + sa1) / 2, zs + 2.45), (2.0, 3.0, 0.5), DARK)
    m.box((0, (sa0 + sa1) / 2, zs + 2.72), (1.9, 2.9, 0.08), WINDOW)
    # wheel and steering house right aft, flagstaff with the Belgian ensign
    zq = zd(0.03)
    m.box((0, hull.y(0.03, zq), zq + 0.45), (1.2, 0.8, 0.9), DARK)
    wheel_helm(m, V(0, hull.y(0.03, zq) - 0.6, zq + 1.2), 0.7)
    fs0 = V(0, hull.y(0.0, sheer(0.0)) - 0.5, zd(0.0))
    spar(m, fs0, fs0 + V(0, 0.5, 5.5), 0.07, 0.045, cap=True)
    flag(m, fs0 + V(0, 0.55, 5.4), 2.4, 1.6, along=(0, 1, -0.15), kind="belgian")

    # masts: barque rig, square yards on fore and main (sails furled), a gaff on each
    def plan(t, h1, h2, h3, rake_, r):
        return MastPlan(hull.y(t, zd(t)), zd(t), zd(t) + h1, zd(t) + h2, zd(t) + h3, rake_, r)

    fore = plan(0.83, 16.0, 27.0, 34.0, 0.05, 0.42)
    main = plan(0.37, 16.5, 28.0, 35.0, 0.05, 0.42)
    mizz = plan(0.21, 14.0, 24.0, 24.0, 0.06, 0.34)
    for mp in (fore, main, mizz):
        mp.build(m, top_w=3.0 if mp is not mizz else 2.4, top_d=2.0)
    for mp in (fore, main):
        spec = [(mp.h1 - 1.6, 20.0, 0.26, 0.42), (mp.h1 + (mp.h2 - mp.h1) * 0.5, 16.0, 0.2, 0.32),
                (mp.h2 + (mp.h3 - mp.h2) * 0.55, 11.0, 0.13, 0.2)]
        for i, (z, ln, r, sr) in enumerate(spec):
            c = mp.at(z) + V(0, -0.55 - (0.5 if i >= 1 else 0) - (0.3 if i >= 2 else 0), 0)
            lift = mp.at(z + 1.8) + V(0, -0.5 - (0.5 if i >= 1 else 0), 0)
            yard(m, c, ln, r, sr, lifts_to=lift if i < 2 else None)
            if i == 0:
                for sx in (1, -1):
                    t_to = 0.3 if mp is main else 0.74
                    rig(m, c + V(sx * ln / 2 * 0.95, 0, 0), hull.P(t_to, sheer(t_to), sx) + V(0, 0, 0.1), 0.016)
    for mp, glen, blen in ((fore, 6.0, 0.0), (main, 6.5, 0.0), (mizz, 8.0, 10.0)):
        g0 = mp.at(mp.h1 - 1.2)
        g1 = g0 + V(0, glen * math.cos(0.5), glen * math.sin(0.5))
        spar(m, g0, g1, 0.15, 0.09)
        rig(m, mp.top(2) - V(0, 0, 0.5), g1)
        if blen:
            b0 = mp.at(mp.zd + 2.4)
            b1 = b0 + V(0, blen, 0.3)
            spar(m, b0, b1, 0.17, 0.11)
            bundle(m, b0 + V(0, 0.5, 0.3), b1 + V(0, -0.6, 0.28), 0.3, CANVAS, n=4)
            bundle(m, g0 + V(0, 0.5, -0.3), g1 + V(0, -0.6, -0.3), 0.26, CANVAS, n=4)
            rig(m, g1, b1, 0.018)
        else:
            bundle(m, mp.at(mp.zd + 3.0) + V(0, 0.5, 0), g0 + V(0, 0.5, -0.5), 0.28, CANVAS, n=3)
    # the house flag (white, red star) at the main truck, a pennant at the fore
    spar(m, main.top(3), main.top(3) + V(0, 0, 1.0), 0.04, 0.03)
    flag(m, main.top(3) + V(0, 0, 0.95), 1.6, 1.1, along=(0, 1, 0), kind="house")
    pennant(m, fore.top(3) + V(0, 0, 0.3), 5.0, h=0.35)
    # bowsprit and jibboom over the clipper stem, the jib furled; trailboards and a scroll
    stem_top = V(0, hull.y(1.0, sheer(1.0)), sheer(1.0))
    a = math.radians(12)
    dv = V(0, -math.cos(a), math.sin(a))
    heel = stem_top + V(0, 2.6, -0.3)
    bs_end = heel + dv * 10.0
    spar(m, heel, bs_end, 0.38, 0.28)
    jb0, jb1 = heel + dv * 7.0, heel + dv * 17.5
    spar(m, jb0, jb1, 0.2, 0.09)
    m.box(bs_end + V(0, 0.15, 0.05), (0.6, 0.35, 0.6), DARK)
    bundle(m, heel + dv * 10.8 + V(0, 0, 0.22), heel + dv * 16.8 + V(0, 0, 0.14), 0.22, CANVAS, n=4)
    striker = bs_end + V(0, 0.2, -2.2)
    spar(m, bs_end + V(0, 0.2, -0.2), striker, 0.07, 0.06)
    rig(m, bs_end, V(0, hull.y(1.0, 0.6) + 0.4, 0.6), 0.035)
    rig(m, jb1, striker, 0.022)
    rig(m, striker, V(0, hull.y(1.0, 1.8) + 0.3, 1.8), 0.022)
    for sx in (1, -1):
        rig(m, bs_end + V(sx * 0.25, 0, 0), hull.P(0.96, sheer(0.96) - 1.0, sx), 0.022)
    sc = [V(0, hull.y(1.0, sheer(1.0) - 1.9) + 0.3, sheer(1.0) - 1.9), V(0, hull.y(1.0, sheer(1.0) - 1.1) - 0.2, sheer(1.0) - 1.1),
          V(0, hull.y(1.0, sheer(1.0) - 0.4) - 0.5, sheer(1.0) - 0.45)]
    m.tube(sc, [0.16, 0.22, 0.13], 5, WHITE, smooth=False, cap0=True, cap1=True, side=(1, 0, 0))
    for sx in (1, -1):
        a_ = hull.P(0.96, sheer(0.96) - 0.3, sx)
        b_ = V(sx * 0.5, hull.y(1.0, sheer(1.0) - 1.0) - 0.4, sheer(1.0) - 1.1)
        m.tube([a_, b_, V(sx * 0.12, sc[1].y - 0.2, sc[1].z + 0.1)], [0.07, 0.06, 0.05], 4, WHITE, smooth=False, side=(0, 0, 1))
    # stays (the main stay goes to the funnel: steamers did)
    for a_, b_ in ((fore.top(1), heel + dv * 5.5), (fore.top(2), jb0 + dv * 5.0), (fore.top(3) - V(0, 0, 1.2), jb1),
                   (main.top(1), ftop + V(0, 0.7, 0.7)), (main.top(2), fore.top(2) - V(0, 0, 1.0)),
                   (main.top(3) - V(0, 0, 1.2), fore.top(3) - V(0, 0, 1.4)),
                   (mizz.top(1), main.at(main.h1 - 3.5)), (mizz.top(2), main.top(1) + V(0, 0, 0.4))):
        rig(m, a_, b_, 0.03)
    # shrouds with ratlines, backstays
    for mp, tm in ((fore, 0.83), (main, 0.37), (mizz, 0.21)):
        w = hull.hb(tm, sheer(tm))
        for sx in (1, -1):
            shroud_quad(m, (sx * (w - 0.05), mp.y - 1.2, sheer(tm)), (sx * (w - 0.05), mp.y + 2.0, sheer(tm)),
                        mp.at(mp.h1 - 0.7) + V(sx * 0.35, 0.35, 0), mp.at(mp.h1 - 0.7) + V(sx * 0.35, -0.35, 0))
            shroud_quad(m, mp.at(mp.h1 + 0.1) + V(sx * 1.4, -0.7, 0), mp.at(mp.h1 + 0.1) + V(sx * 1.4, 0.9, 0),
                        mp.top(2) + V(sx * 0.2, 0.15, -0.6), mp.top(2) + V(sx * 0.2, -0.15, -0.6))
            for lvl, dy in ((2, 4.0), (3, 5.2)):
                if lvl == 3 and mp.h3 <= mp.h2:
                    continue
                rig(m, mp.top(lvl) - V(0, 0, 0.4), V(sx * (w - 0.05), mp.y + dy, sheer(tm)), 0.02)
    # fife rails round the masts
    for mp in (fore, main, mizz):
        c = mp.at(mp.zd)
        for (ax, ay), (bx, by) in (((-0.9, -0.9), (0.9, -0.9)), ((0.9, -0.9), (0.9, 0.9)), ((0.9, 0.9), (-0.9, 0.9)),
                                   ((-0.9, 0.9), (-0.9, -0.9))):
            m.beam(c + V(ax, ay, 0.72), c + V(bx, by, 0.72), 0.1, 0.08, DARK, side=(0, 0, 1))
        coil(m, c + V(0.4, 1.3, 0), 0.3)
    # derricks: two resting forward at the foremast; at the mainmast one swung out over the
    # port side, a sling of cargo on its fall, over where the lighters lie
    for sx in (1, -1):
        dh = fore.at(fore.zd + 1.4) + V(sx * 0.4, 0.4, 0)
        dt = dh + V(sx * 1.5, 7.5, 6.5)
        spar(m, dh, dt, 0.15, 0.09)
        rig(m, dt, fore.at(fore.h1 - 0.5), 0.025)
    dh = main.at(main.zd + 1.4) + V(PORT * 0.45, 0.45, 0)
    dt = dh + V(PORT * 9.2, 1.8, 5.8)
    spar(m, dh, dt, 0.17, 0.1)
    rig(m, dt, main.at(main.h1 - 0.4), 0.025)
    for tg in (0.32, 0.42):
        rig(m, dt, hull.P(tg, sheer(tg), PORT) + V(0, 0, 0.1), 0.018)
    sling = dt - V(0, 0, 4.2)
    rig(m, dt, sling + V(0, 0, 0.9), 0.02, IRON)
    for dx, dy in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
        rig(m, sling + V(0, 0, 0.9), sling + V(dx * 0.9, dy * 1.1, 0.0))
    crate_lo(m, sling + V(0, 0, -0.62), size=(1.1, 1.3, 0.62))
    # hatches with tarpaulins
    for t0_, t1_ in ((0.88, 0.915), (0.772, 0.808), (0.295, 0.34)):
        ya, yb = hull.y(t1_, 0), hull.y(t0_, 0)
        zc = zd((t0_ + t1_) / 2)
        m.box((0, (ya + yb) / 2, zc + 0.3), (4.0, yb - ya, 0.6), DARK, shade=0.9)
        m.box((0, (ya + yb) / 2, zc + 0.64), (4.15, yb - ya + 0.15, 0.08), TARP, shade=0.95)
    # windlass; the starboard anchor at its cathead; the port hawse, and the port anchor's chain
    # from the windlass to the hawse and out of it, forward and down into the river
    yw = hull.y(0.94, zd(0.94))
    windlass(m, 0, yw, zd(0.94) + 0.45, w=2.6, r=0.26)
    cat = hull.P(0.955, sheer(0.955) + 0.15, -PORT) + V(-PORT * 0.6, 0, 0)
    m.beam(hull.P(0.955, sheer(0.955) + 0.05, -PORT, 0.4), cat, 0.3, 0.3, IRON, side=(0, 1, 0))
    with m.at(move(cat.x - PORT * 0.12, cat.y, cat.z - 0.3)):
        anchor(m, V(0, 0, 0), side=(1, 0, 0), size=1.1)
    hz = sheer(0.97) - 1.3
    hawse = hull.P(0.97, hz, PORT) + V(PORT * 0.05, 0, 0)
    m.box(hawse, (0.18, 0.6, 0.6), IRON)
    deck_hawse = hull.P(0.965, zd(0.965), PORT, 0.5) + V(0, 0, 0.05)
    m.line(V(PORT * 0.9, yw, zd(0.94) + 0.5), deck_hawse)
    ahead, drop = 18.0, hz + 5.0
    prev = hawse + V(PORT * 0.12, 0, 0)
    for k in range(1, 9):
        s_ = k / 8
        p = hawse + V(PORT * (0.12 + 0.8 * s_), -ahead * s_, -drop * (1 - (1 - s_) ** 2))
        m.line(prev, p)
        prev = p
    m.extras["hawse"] = [round(hawse.x, 3), round(hawse.y, 3), round(hawse.z, 3)]
    # the accommodation ladder, down the port side forward of the lighters
    lt, lb_ = hull.P(0.79, zd(0.79), PORT), hull.P(0.835, 0.7, PORT)
    top = lt + V(PORT * 0.35, 0, 0.05)
    low = lb_ + V(PORT * 1.3, 0, 0)
    m.beam(top, low, 0.8, 0.12, WOOD, side=(1, 0, 0))
    m.box(low + V(0, -0.7, -0.05), (1.3, 1.4, 0.12), WOOD)
    for dx in (-0.4, 0.4):
        rig(m, top + V(dx, 0, 1.0), low + V(dx, 0, 1.0), 0.02)
        rig(m, low + V(dx, 0, 0), low + V(dx, 0, 1.0), 0.02)
    rig(m, top + V(0, 0, 3.5), low + V(0, 0, 0.1), 0.02)
    # names: on both bows, and on the quarters with the port of registry
    hull_name(m, hull, 0.935, sheer(0.935) - 0.75, 4.2, 0.525, 0, mat=NAMES3)
    hull_name(m, hull, 0.06, sheer(0.06) - 0.7, 4.0, 0.5, 0, mat=NAMES3)
    hull_name(m, hull, 0.06, sheer(0.06) - 1.25, 3.4, 0.425, 1, mat=NAMES3)
    # cargo and gear on deck
    for t, x, r in ((0.95, -1.6, 0.36), (0.95, 1.6, 0.36), (0.3, 2.4, 0.32), (0.05, -1.6, 0.3)):
        coil(m, (x, hull.y(t, zd(t)), zd(t)), r)
    for i, x in enumerate((-3.0, -2.3, 2.8)):
        barrel_lo(m, (x, hull.y(0.28, zd(0.28)), zd(0.28)), yaw=i)
    zc = zd(0.86)
    for i, (x, dy, sz) in enumerate(((-1.4, 0.0, (1.1, 0.9, 0.8)), (1.6, 0.3, (1.0, 1.0, 0.9)))):
        crate_lo(m, (x, hull.y(0.86, zc) + dy, zc), size=sz, yaw=0.15 * i)
    # propeller and rudder under the counter
    py = L / 2 - 1.4
    with m.at(move(0, py, -3.6) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.4, -0.6), (0.45, 0.0), (0.3, 0.6)], 6, IRON, smooth=False, cap0=True, cap1=True)
    for k in range(4):
        a_ = math.pi / 2 * k + 0.4
        d = V(math.cos(a_), 0, math.sin(a_))
        s_ = V(-math.sin(a_), 0.35, math.cos(a_)).normalized()
        c = V(0, py, -3.6)
        m.slab([c + d * 0.4 - s_ * 0.5, c + d * 0.4 + s_ * 0.5, c + d * 2.3 + s_ * 0.45, c + d * 2.3 - s_ * 0.35], 0.06, IRON,
               out=(0, -1, 0))
    rud = [V(0, L / 2 + 0.2, KZ + 1.3), V(0, L / 2 + 2.4, KZ + 1.3), V(0, L / 2 + 2.4, 0.3), V(0, L / 2 + 0.2, 0.9)]
    m.prism([p + V(-0.1, 0, 0) for p in rud], (0.2, 0, 0), IRON, tile=2.0)
    # M7 boats: riding lights forward and aft (at anchor in the roads)
    lantern(m, V(0, hull.y(0.9, sheer(0.9)), sheer(0.9) + 4.0), 0)
    lantern(m, V(0, hull.y(0.04, sheer(0.04)), sheer(0.04) + 2.5), 0)
    return m
