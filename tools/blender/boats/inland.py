"""Inland and harbour craft: the Rhine barge and the hengst (barge), the lighters, the Scheldt sloop
(hoogaars) and the pontoon section. Each builder returns a Mesh; build_boats.py turns it into the model,
its water cap and its stowed parts (docs/boats.md)."""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ barges


def leeboard(m, pivot, length, width, sx, angle=0.52):
    """A pear-shaped leeboard hung on the gunwale, swung up aft. angle: below horizontal."""
    pivot = Vector(pivot)
    d = V(0, math.cos(angle), -math.sin(angle))
    e = V(0, math.sin(angle), math.cos(angle))
    outline = [(0.0, -0.2), (0.35, -0.32), (length * 0.55, -width * 0.42), (length * 0.9, -width * 0.5),
               (length, -width * 0.2), (length, width * 0.2), (length * 0.9, width * 0.5), (length * 0.55, width * 0.42),
               (0.35, 0.32), (0.0, 0.2)]
    pts = [pivot + d * a + e * b for a, b in outline]
    m.prism(pts, (sx * 0.09, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.box(pivot + V(sx * 0.12, 0, 0), (0.1, 0.16, 0.16), IRON)


def barge(kind, sailing=False):
    """kind 'rhine': a big Rhine barge (Rijnaak), towed, short mast, hatch boards.
    kind 'hengst': a Flemish sailing barge, bluff and high-ended, tall mast, tarpaulins."""
    m = Mesh(ao=0.0)
    rh = kind == "rhine"
    L, B = (34.0, 6.2) if rh else (21.0, 5.3)
    D = 1.55 if rh else 1.35
    F, E, Eb = (0.85, 0.75, 0.25) if rh else (0.8, 0.95, 0.5)
    tb0, ts0 = (0.86, 0.12) if rh else (0.78, 0.16)

    def keel(t):
        return -D + 0.6 * D * sm((t - 0.9) / 0.1) + 0.35 * D * sm((0.07 - t) / 0.07)

    def sheer(t):
        return F + E * abs(2 * t - 1) ** 3 + Eb * max(0.0, (t - 0.8) / 0.2) ** 2

    def hb(t, z):
        u = cl((z + D) / (D + F))
        sec = 0.84 + 0.16 * sm(u / 0.3) + (0.0 if rh else 0.03 * u)
        if t > tb0:
            f = (t - tb0) / (1 - tb0)
            p = (1 - min(f, 1.0) ** 2.2) ** 0.5
        elif t < ts0:
            f = (ts0 - t) / ts0
            p = (1 - min(f, 1.0) ** 2.4) ** 0.5
        else:
            p = 1.0
        p = p ** (1 + 0.8 * (1 - u))
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z + D) / (D + F + E))
        return -(0.5 if rh else 0.9) * u * sm((t - 0.88) / 0.12) + 0.3 * u * sm((0.08 - t) / 0.08)

    ts = [0, 0.015, 0.04, 0.075, 0.12, 0.16, 0.25, 0.4, 0.55, 0.7, 0.78, 0.86, 0.9, 0.935, 0.965, 0.985, 1.0]
    levels = [keel, lambda t: keel(t) + 0.3, lambda t: -0.05, lambda t: sheer(t) - 0.24, sheer]
    mats = [(TAR, 0), (TAR, 0), (TAR, 0), (GREEN, 3.0)]
    mats = [(TARWEED, 0), (TARWEED, 0), (TAR, 0), (GREEN, 3.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    hull.outer(m)
    # M7 boats: heavy wales along her sides, rust run down from the hawse and the leeboard irons
    hull.wale(m, lambda t: sheer(t) - 0.22, 0.02, 0.98, h=0.16, out=0.08)
    hull.wale(m, lambda t: sheer(t) - 0.62, 0.05, 0.95, h=0.12, out=0.06)
    for sx in (1, -1):
        hull.decal(m, 0.95, sheer(0.95) - 0.3, 0.7, 1.0, sx)
        hull.decal(m, 0.6 if not rh else 0.63, sheer(0.62) - 0.35, 0.5, 0.7, sx, u=(0.5, 1.0))
        hull.decal(m, 0.25, sheer(0.25) - 0.3, 0.9, 0.6, sx, u=(0.0, 0.6))

    def zd(t):
        return sheer(t) - 0.28

    hull.deck(m, zd, 0, 1, 0.07, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, GREEN, DARK)

    # the hold: coaming and hatch covers (boards on the Rhine barge, tarpaulins on the hengst)
    h0, h1 = (0.2, 0.75) if rh else (0.26, 0.7)
    cw = 2.3 if rh else 1.95
    ztop = max(zd(h0), zd(h1)) + 0.4
    Th = hull.span(h0, h1)
    for ta, tb in zip(Th, Th[1:]):
        ya, yb = hull.y(ta, zd(ta)), hull.y(tb, zd(tb))
        for sx in (1, -1):
            pts = [V(sx * cw, ya, zd(ta) - 0.05), V(sx * cw, yb, zd(tb) - 0.05), V(sx * cw, yb, ztop), V(sx * cw, ya, ztop)]
            m.poly(pts, GREEN if rh else DARK, out=(sx, 0, 0), uvs=[(-p.y / 1.6, p.z / 1.6) for p in pts])
    ya, yb = hull.y(h0, zd(h0)), hull.y(h1, zd(h1))
    for t, y, dy in ((h0, ya, 1), (h1, yb, -1)):
        pts = [V(-cw, y, zd(t) - 0.05), V(cw, y, zd(t) - 0.05), V(cw, y, ztop), V(-cw, y, ztop)]
        m.poly(pts, GREEN if rh else DARK, out=(0, dy, 0), uvs=[(p.x / 1.6, p.z / 1.6) for p in pts])
    rise = 0.55 if rh else 0.7
    arch = [(cw * math.cos(math.pi * j / 6), ztop + rise * math.sin(math.pi * j / 6)) for j in range(7)]
    cover = HATCH if rh else TARP
    acc = [0.0]
    for j in range(6):
        acc.append(acc[-1] + math.hypot(arch[j + 1][0] - arch[j][0], arch[j + 1][1] - arch[j][1]))
    for j in range(6):
        (xa, za), (xb, zb) = arch[j], arch[j + 1]
        pts = [V(xa, ya + 0.05, za), V(xb, ya + 0.05, zb), V(xb, yb - 0.05, zb), V(xa, yb - 0.05, za)]
        uvs = [(-p.y / 1.6, a / 1.6) for p, a in zip(pts, (acc[j], acc[j + 1], acc[j + 1], acc[j]))]
        m.poly(pts, cover, out=((xa + xb) / 2, 0, (za + zb) / 2 - ztop + 0.3), uvs=uvs, shade=0.95)
    for y, dy in ((ya + 0.05, 1), (yb - 0.05, -1)):
        m.poly([V(x, y, z) for x, z in arch], cover, out=(0, dy, 0), shade=0.75)
    if not rh:
        # the tarpaulin's lashings, and the battens along its foot
        for f in (0.12, 0.3, 0.5, 0.7, 0.88):
            y = ya + (yb - ya) * f
            rope_path(m, [V(x * 1.01, y, z + 0.02) for x, z in arch], 0.025, ROPE)
        for sx in (1, -1):
            m.beam((sx * (cw + 0.03), ya, ztop - 0.08), (sx * (cw + 0.03), yb, ztop - 0.08), 0.06, 0.1, DARK)
    else:
        # a ridge plank along the hatch boards, a gangplank to walk on
        m.beam((0, ya - 0.1, ztop + rise + 0.03), (0, yb + 0.1, ztop + rise + 0.03), 0.3, 0.05, DARK)
        m.box((-0.8, (ya + yb) / 2 + 3, ztop + rise * 0.93 + 0.06), (0.5, 7.5, 0.05), WOOD, shade=0.9)
        # the barge's dinghy, carried on the hatches aft
        ships_boat(m, (0.7, ya - 3.4, ztop + rise * 0.8), 4.0, 1.35, 0.55, yaw=0.05, mat=CLINKER, cover=WOOD)

    # the roef: the skipper's cabin aft
    c0, c1 = (0.045, 0.14) if rh else (0.055, 0.17)
    cabw = 1.9 if rh else 1.55
    y0, y1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    zb = min(zd(c0), zd(c1)) - 0.1
    zt = max(zd(c0), zd(c1)) + (1.25 if rh else 1.1)
    house(m, -cabw, cabw, y0, y1, zb, zt, wall=GREEN, roof=TAR, over=0.1, roof_rise=0.18,
          windows=[("+x", y0 + (y1 - y0) * 0.3, zt - 0.5), ("+x", y0 + (y1 - y0) * 0.7, zt - 0.5),
                   ("-x", y0 + (y1 - y0) * 0.3, zt - 0.5), ("-x", y0 + (y1 - y0) * 0.7, zt - 0.5),
                   ("-y", -0.6, zt - 0.5)],
          door=("-y", 0.55, 0.7, zt - zb - 0.35))
    chimney(m, cabw * 0.5, (y0 + y1) / 2 + 0.4, zt + 0.15, 0.8, 0.09)
    m.stove((cabw * 0.5, (y0 + y1) / 2 + 0.4, zt + 1.18))
    # M7 boats: her lantern on the cabin roof, fenders over the side, her home port on the quarters
    lantern(m, V(-cabw + 0.3, y1 - 0.3, zt + 0.18 + 0.16), 0)
    for sx in (1, -1):
        for t in (0.3, 0.5, 0.7):
            fender(m, hull.P(t, sheer(t), sx, 0.04), sx, drop=0.55, r=0.14)
    stern_name(m, hull, 0.06, sheer(0.06) - 0.45, 2.0 if rh else 1.7, 0.26 if rh else 0.22, 0 if rh else 2)
    # rudder and tiller
    ys = L / 2
    zr = sheer(0)
    k0 = keel(0.0)
    rud = [V(0, ys, k0 + 0.15), V(0, ys + (1.5 if rh else 1.3), k0 + 0.15), V(0, ys + (1.7 if rh else 1.45), 0.1),
           V(0, ys + 1.0, zr - 0.35), V(0, ys + 0.3, zr + 0.25), V(0, ys, zr + 0.25)]
    m.prism([p + V(-0.07, 0, 0) for p in rud], (0.14, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.beam((0, ys + 0.15, zr + 0.18), (0, ys - 1.6, zr + 0.45), 0.1, 0.12, DARK)
    m.beam((0, ys - 1.6, zr + 0.45), (0, ys - 3.0, zr + 0.5), 0.1, 0.1, DARK, w2=0.07, h2=0.07)
    # flagstaff at the stern
    spar(m, (0.4, ys - 0.2, zr - 0.1), (0.4, ys + 0.1, zr + 2.2), 0.04, 0.03)
    # mast in its tabernacle, boom, gaff and the furled sail
    tm = 0.8 if rh else 0.755
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    H = 11.0 if rh else 16.5
    for sx in (1, -1):
        m.box((sx * 0.22, ym, zm + 0.8), (0.14, 0.34, 1.6), DARK)
    spar(m, (0, ym, zm), (0, ym + 0.3, zm + H), 0.17 if rh else 0.2, 0.08, DARK, cap=True)
    top = V(0, ym + 0.3, zm + H)
    m.box(top + V(0, 0, 0.08), (0.2, 0.2, 0.16), DARK)
    pennant(m, top + V(0, 0, 0.3), 1.6 if rh else 2.4, h=0.28)
    zbm = ztop + rise + (0.55 if rh else 0.7)
    blen = 9.0 if rh else 10.5
    boom_a, boom_b = V(0, ym + 0.25, zbm), V(0, ym + blen, zbm + 0.35)
    spar(m, boom_a, boom_b, 0.11, 0.08)
    if sailing:
        gaff_a = V(0, ym + 0.4, zm + H * 0.7)
        gaff_b = gaff_a + V(0, blen * 0.62 * math.cos(0.55), blen * 0.62 * math.sin(0.55))
    else:
        gaff_a, gaff_b = V(0, ym + 0.35, zbm + 0.5), V(0, ym + blen * 0.72, zbm + 0.72)
    spar(m, gaff_a, gaff_b, 0.09, 0.06)
    if sailing:
        sail(m, gaff_a + V(0, 0.25, -0.15), gaff_b + V(0, -0.2, -0.15), boom_a + V(0, 0.35, 0.2), boom_b + V(0, -0.4, 0.2),
             V(1.1, 0, 0), nu=4, nv=4, mat=CANVAS if rh else TAN)
    else:
        bundle(m, boom_a.lerp(gaff_a, 0.5) + V(0, 0.4, 0.05), boom_b.lerp(gaff_b, 0.4) + V(0, -0.8, 0.12),
               0.32 if rh else 0.4, CANVAS if rh else TAN, n=5)
    # the peak halyard and topping lift from the masthead
    rig(m, top - V(0, 0, 0.5), gaff_b)
    rig(m, top - V(0, 0, 0.3), boom_b)
    # forestay with the foresail bundled at its foot, shrouds, running backstays
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.25, sheer(1.0) + 0.1)
    rig(m, top - V(0, 0, 0.4), stem, 0.028)
    if sailing:
        head = stem.lerp(top - V(0, 0, 0.4), 0.66)
        sail(m, head, head, stem + V(0, 0.3, 0.15), V(1.6, stem.y + 5.5, sheer(0.8) + 0.9), V(0.8, 0, 0), nu=2, nv=3,
             mat=CANVAS if rh else TAN)
    else:
        bundle(m, stem + V(0, 0.3, 0.25), stem.lerp(top, 0.2) + V(0, 0.4, -0.3), 0.22, CANVAS if rh else TAN, n=3)
    for sx in (1, -1):
        for dt in ((0.01, -0.02) if rh else (0.012, -0.012, -0.035)):
            t = tm + dt
            rig(m, top - V(0, 0, 0.9), hull.P(t, sheer(t), sx) + V(0, 0, 0.05), 0.022)
        t = tm - (0.12 if rh else 0.2)
        rig(m, top - V(0, 0, 0.6), hull.P(t, sheer(t), sx, 0.05) + V(0, 0, 0.05), 0.018)
    # leeboards, swung up
    tl = 0.63 if rh else 0.6
    for sx in (1, -1):
        piv = hull.P(tl, sheer(tl) - 0.12, sx) + V(sx * 0.05, 0, 0)
        ang = 0.5 if rh else 0.62
        ln = 4.6 if rh else 4.3
        leeboard(m, piv, ln, 1.8 if rh else 1.7, sx, angle=ang)
        foot = piv + V(sx * 0.1, math.cos(ang) * ln * 0.9, -math.sin(ang) * ln * 0.9)
        rig(m, foot, hull.P(tl - 0.08, sheer(tl - 0.08), sx) + V(0, 0, 0.2), 0.02)
    # foredeck: windlass, bitts, an anchor stowed; aft: bitts and a water cask
    tw = 0.93 if rh else 0.905
    windlass(m, 0, hull.y(tw, zd(tw)), zd(tw) + 0.35, w=1.3 if rh else 1.1, r=0.17)
    for t in (0.975, 0.02):
        for sx in (1, -1):
            bitts(m, sx * 0.5, hull.y(t, zd(t)), zd(t))
    ta = 0.885 if rh else 0.85
    with m.at(move(1.0, hull.y(ta, zd(ta)), zd(ta) + 0.12) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        anchor(m, V(0, 0, 0), side=(0, 1, 0), size=0.6)
    barrel_lo(m, (-cabw * 0.6, y0 - 0.6, zd(c1 + 0.01)), yaw=0.4)
    if not rh:
        # the hengst's sweep lying on the tarpaulin
        m.beam((cw * 0.4, ya - 1.5, ztop + rise * 0.9 + 0.08), (cw * 0.2, ya - 7.5, ztop + rise * 0.95 + 0.08), 0.08, 0.08,
               WOOD)
    # her name on the bow, the flag at the stern, washing out to dry over the aft deck
    tn = 0.925 if rh else 0.9
    hull_name(m, hull, tn, sheer(tn) - 0.42, 2.6 if rh else 2.2, 0.3 if rh else 0.26, 5 if rh else 4)
    flag(m, (0.4, ys + 0.1, zr + 2.15), 1.2, 0.75, along=(0, 1, -0.1), kind="dutch" if rh else "belgian")
    pole = V(cabw - 0.1, y0 + 0.1, zt)
    spar(m, pole, pole + V(0, 0, 1.9), 0.04, 0.03)
    if not sailing:
        washing_line(m, (0.4, ys + 0.05, zr + 2.0), pole + V(0, 0, 1.85), seed=3 if rh else 5, n=5 if rh else 4)
    for t, x, r in ((0.97, -0.8, 0.3), (0.955, 0.7, 0.26), (0.03, 0.9, 0.28)):
        coil(m, (x, hull.y(t, zd(t)), zd(t)), r)
    barrel_lo(m, (cabw * 0.7, y0 - 0.7, zd(c1 + 0.01)), yaw=1.1)
    return m


# ------------------------------------------------------------------ lighters (open boats with a hold)


def heap(m, hull, t0, t1, zf, H, mat, inset=0.25, nu=8, nv=5, seed=1):
    """M7 boats: a heap of loose cargo (coal, sand) filling the hold from t0 to t1, H high in the middle."""
    rnd = random.Random(seed)
    P = []
    for j in range(nu + 1):
        t = t0 + (t1 - t0) * j / nu
        w = hull.hb(t, zf + 0.3) - inset
        row = []
        for i in range(nv + 1):
            u = i / nv
            x = -w + 2 * w * u
            h = H * math.sin(math.pi * j / nu) ** 0.6 * math.sin(math.pi * u) ** 0.7
            if 0 < i < nv and 0 < j < nu:
                h += rnd.uniform(-0.08, 0.08)
            row.append(V(x, hull.y(t, zf), zf + max(0.02, h)))
        P.append(row)
    for j in range(nu):
        for i in range(nv):
            q = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]
            m.poly(q, mat, out=(0, 0, 1), uvs=[(p.x / 1.2, -p.y / 1.2) for p in q], shade=0.85 + 0.15 * (i % 2))


def lighter(loaded):
    """A Scheldt lighter: an open cargo boat, towed or poled, bluff ends, small decks.
    M7 boats: loaded is False (empty), True (sacks and casks), "coal", "sand" or "timber"."""
    m = Mesh(ao=0.0)
    L, B, D = 17.0, 4.4, 0.8

    def keel(t):
        return -D + 0.4 * sm((t - 0.88) / 0.12) + 0.22 * sm((0.08 - t) / 0.08)

    def sheer(t):
        return 1.0 + 0.35 * abs(2 * t - 1) ** 3 + 0.12 * max(0.0, (t - 0.8) / 0.2) ** 2

    def hb(t, z):
        u = cl((z + D) / (D + 1.0))
        sec = 0.86 + 0.14 * sm(u / 0.3)
        if t > 0.84:
            p = (1 - min(1.0, (t - 0.84) / 0.16) ** 2.2) ** 0.5
        elif t < 0.1:
            p = (1 - min(1.0, (0.1 - t) / 0.1) ** 2.4) ** 0.5
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p ** (1 + 0.7 * (1 - u)))

    ts = [0, 0.02, 0.05, 0.1, 0.2, 0.35, 0.5, 0.65, 0.8, 0.84, 0.88, 0.92, 0.96, 0.985, 1.0]
    levels = [keel, lambda t: keel(t) + 0.2, lambda t: -0.05, lambda t: sheer(t) - 0.2, sheer]
    hull = Hull(L, ts, levels, hb, [(TARWEED, 0), (TARWEED, 0), (TAR, 0), (DARK, 2.0)],
                yfn=lambda t, z: -0.35 * cl((z + D) / 1.8) * sm((t - 0.9) / 0.1),
                shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    hull.outer(m)
    # M7 boats: a wale, rust runs, fenders; her port on the quarters
    hull.wale(m, lambda t: sheer(t) - 0.18, 0.03, 0.97, h=0.14, out=0.07)
    for sx in (1, -1):
        hull.decal(m, 0.93, sheer(0.93) - 0.25, 0.6, 0.8, sx)
        for t in (0.3, 0.62):
            fender(m, hull.P(t, sheer(t), sx, 0.04), sx, drop=0.5, r=0.13)
    stern_name(m, hull, 0.05, sheer(0.05) - 0.42, 1.5, 0.2, 3 if loaded in (True, "coal") else 1)
    zf = 0.24  # the hold floor sits above the game's water sheet (waves reach about 0.2 m)
    tf0, tf1 = 0.1, 0.86
    hull.inner(m, [lambda t: zf, lambda t: zf + 0.35, sheer], tf0, tf1, 0.08, WOOD, DECK)
    hull.cap(m, sheer, tf0, tf1, 0.08, DARK)

    def zd(t):
        return sheer(t) - 0.2

    hull.deck(m, zd, tf1, 1.0, 0.07, DECK)
    hull.deck(m, zd, 0.0, tf0, 0.07, DECK)
    hull.rail(m, zd, sheer, tf1, 1.0, 0.08, DARK, DARK, end0=False)
    hull.rail(m, zd, sheer, 0.0, tf0, 0.08, DARK, DARK, end0=True)
    # cross beams over the hold, a mast stump, the forepeak with its chimney
    for t in (0.36, 0.62):
        y = hull.y(t, 0)
        w = hb(t, sheer(t) - 0.12) - 0.08
        m.beam((-w, y, sheer(t) - 0.12), (w, y, sheer(t) - 0.12), 0.16, 0.14, DARK, side=(0, 1, 0))
    ym = hull.y(0.8, 0)
    spar(m, (0, ym, zf), (0, ym, 4.6), 0.12, 0.09, DARK, cap=True)
    pennant(m, (0, ym, 4.75), 0.9, h=0.2)
    rig(m, (0, ym, 4.4), (0, hull.y(1, sheer(1)) + 0.2, sheer(1) + 0.05))
    chimney(m, 0.7, hull.y(0.94, zd(0.94)), zd(0.94), 0.55, 0.07)
    m.stove((0.7, hull.y(0.94, zd(0.94)), zd(0.94) + 0.77))
    lantern(m, V(0.18, ym, 3.1), 0)
    m.box((-0.3, hull.y(0.92, zd(0.92)), zd(0.92) + 0.12), (0.7, 0.6, 0.25), DARK)
    # rudder and tiller
    ys = L / 2
    k0, zr = keel(0), sheer(0)
    rud = [V(0, ys, k0 + 0.1), V(0, ys + 0.95, k0 + 0.1), V(0, ys + 1.05, 0.1), V(0, ys + 0.35, zr + 0.2), V(0, ys, zr + 0.2)]
    m.prism([p + V(-0.06, 0, 0) for p in rud], (0.12, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.beam((0, ys + 0.1, zr + 0.12), (0.3, ys - 2.1, zr + 0.35), 0.08, 0.1, DARK)
    for t in (0.975, 0.03):
        for sx in (1, -1):
            bitts(m, sx * 0.45, hull.y(t, zd(t)), zd(t), 0.45, 0.16)
    # a long sweep lying along the gunwale
    m.beam((1.6, hull.y(0.2, 0), sheer(0.2) + 0.06), (1.7, hull.y(0.7, 0), sheer(0.7) + 0.06), 0.07, 0.07, WOOD)
    if loaded == "coal":
        heap(m, hull, 0.14, 0.82, zf, 1.15, COAL, seed=3)
        m.beam((0.8, hull.y(0.5, 0), zf + 0.9), (1.6, hull.y(0.62, 0), sheer(0.62) + 0.05), 0.05, 0.05, WOOD)  # a shovel
    elif loaded == "sand":
        heap(m, hull, 0.14, 0.82, zf, 0.95, SAND, seed=4)
    elif loaded == "timber":
        # squared baulks stowed fore and aft, three tiers, chocked
        for k, z in enumerate((zf, zf + 0.3, zf + 0.6)):
            n = 6 - k
            for i in range(n):
                x = (i - (n - 1) / 2) * 0.34
                a, b = hull.y(0.16 + 0.02 * k, 0), hull.y(0.8 - 0.02 * k, 0)
                m.box((x, (a + b) / 2, z + 0.14), (0.28, abs(a - b), 0.28), WOOD, shade=0.8 + 0.05 * (i % 3), mode="fit")
        for t in (0.3, 0.6):
            rope_path(m, [hull.P(t, sheer(t), 1, 0.1), V(0, hull.y(t, 0), zf + 0.95), hull.P(t, sheer(t), -1, 0.1)], 0.02, ROPE)
    elif loaded:
        k = 0
        for t in (0.58, 0.64, 0.7, 0.76):
            y = hull.y(t, 0)
            for x in (-1.0, -0.35, 0.3, 0.95):
                sack_lo(m, (x + 0.04 * ((k * 7) % 3 - 1), y, zf), yaw=math.pi / 2 + 0.08 * ((k * 5) % 3 - 1))
                k += 1
            for x in (-0.65, 0.0, 0.65):
                sack_lo(m, (x, y + 0.1, zf + 0.25), yaw=math.pi / 2 + 0.1 * ((k * 3) % 3 - 1), lift=0.04)
                k += 1
        for i, (x, t) in enumerate([(-0.9, 0.24), (-0.2, 0.25), (0.5, 0.24), (1.15, 0.26), (-0.55, 0.31), (0.15, 0.31),
                                    (0.85, 0.3)]):
            barrel_lo(m, (x, hull.y(t, 0), zf), yaw=i * 0.7)
        barrel_lo(m, (-0.2, hull.y(0.42, 0), zf), lying=True, yaw=0.1)
        barrel_lo(m, (0.6, hull.y(0.45, 0), zf), lying=True, yaw=-0.2)
        crate_lo(m, (-0.8, hull.y(0.46, 0), zf), yaw=0.2)
        crate_lo(m, (-0.75, hull.y(0.46, 0), zf + 0.65), size=(0.7, 0.55, 0.5), yaw=-0.3)
    else:
        # dunnage boards in the empty hold
        for x in (-1.2, -0.4, 0.4, 1.2):
            m.box((x, hull.y(0.48, 0), zf + 0.03), (0.22, 7.5, 0.05), WOOD, shade=0.8)
    hull_name(m, hull, 0.9, sheer(0.9) - 0.4, 1.9, 0.24, 7)
    coil(m, (-0.5, hull.y(0.95, zd(0.95)), zd(0.95)), 0.26)
    return m


# ------------------------------------------------------------------ the Scheldt sloop


def sloop(sailing=False):
    """A hoogaars-type Scheldt fishing sloop: flat bottom, hard chine, raked straight stem,
    leeboards, one mast with the gaff sail furled on the boom (tanned sails)."""
    m = Mesh(ao=0.0)
    L, B = 12.5, 3.9

    def keel(t):
        return -0.75 + 0.62 * sm((t - 0.62) / 0.38) ** 1.4 + 0.1 * sm((0.08 - t) / 0.08)

    def sheer(t):
        return 0.78 + 0.95 * max(0.0, (t - 0.55) / 0.45) ** 2 + 0.25 * max(0.0, (0.3 - t) / 0.3) ** 2

    def hb(t, z):
        u = cl((z + 0.75) / 1.55)
        sec = 0.7 + 0.1 * sm(u / 0.06) + 0.2 * u
        if t > 0.5:
            f = (t - 0.5) / 0.5
            p = (1 - min(f, 1.0) ** 1.8) ** (0.65 + 0.4 * (1 - u))
        elif t < 0.12:
            p = 0.62 + 0.38 * sm(t / 0.12)
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z - keel(t)) / max(0.2, sheer(t) - keel(t)))
        return -1.7 * u * sm((t - 0.8) / 0.2) + 0.4 * u * sm((0.1 - t) / 0.1)

    ts = [0, 0.05, 0.12, 0.25, 0.4, 0.55, 0.68, 0.78, 0.86, 0.92, 0.96, 1.0]
    levels = [keel, lambda t: keel(t) + 0.05, lambda t: 0.0, lambda t: sheer(t) - 0.2, sheer]
    hull = Hull(L, ts, levels, hb, [(TARWEED, 0), (TARWEED, 0), (TAR, 0), (GREEN, 2.0)], yfn=yfn,
                shade=lambda p: 0.55 + 0.45 * sm((p.z + 0.75) / 1.6))
    hull.outer(m)
    # M7 boats: a wale, her name on the bow and her port on the quarters
    hull.wale(m, lambda t: sheer(t) - 0.16, 0.03, 0.97, h=0.12, out=0.06)
    hull_name(m, hull, 0.88, sheer(0.88) - 0.35, 1.5, 0.2, 7)
    stern_name(m, hull, 0.05, sheer(0.05) - 0.3, 1.1, 0.16, 4)
    for sx in (1, -1):
        hull.decal(m, 0.9, sheer(0.9) - 0.2, 0.5, 0.7, sx)

    def zd(t):
        return sheer(t) - 0.14

    tw = 0.45
    hull.deck(m, zd, tw, 1.0, 0.06, DECK)
    hull.rail(m, zd, sheer, tw, 1.0, 0.07, GREEN, DARK, end0=False)
    hull.inner(m, [lambda t: 0.2, lambda t: 0.45, sheer], 0.0, tw, 0.06, WOOD, DECK, end1=True)
    hull.cap(m, sheer, 0.0, tw, 0.06, DARK)
    th = 0.62
    m.box((0, hull.y(th, zd(th)), zd(th) + 0.12), (1.1, 0.9, 0.26), DARK)
    m.box((0, hull.y(0.3, 0), 0.62), (2 * hb(0.3, 0.62) - 0.14, 0.3, 0.05), WOOD, shade=0.9)
    tm = 0.58
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    top = V(0, ym + 0.4, zm + 10.0)
    spar(m, (0, ym, zm), top, 0.14, 0.07, DARK, cap=True)
    pennant(m, top + V(0, 0, 0.2), 1.4, h=0.22)
    boom_a, boom_b = V(0, ym + 0.2, zm + 1.1), V(0, ym + 7.2, zm + 1.25)
    spar(m, boom_a, boom_b, 0.09, 0.07)
    if sailing:
        gaff_a = V(0, ym + 0.35, zm + 8.2)
        gaff_b = gaff_a + V(0, 3.6 * math.cos(1.0), 3.6 * math.sin(1.0))
    else:
        gaff_a, gaff_b = V(0, ym + 0.3, zm + 1.55), V(0, ym + 3.6, zm + 1.9)
    spar(m, gaff_a, gaff_b, 0.07, 0.05)
    if sailing:
        sail(m, gaff_a + V(0, 0.2, -0.1), gaff_b + V(0, -0.1, -0.15), boom_a + V(0, 0.3, 0.15), boom_b + V(0, -0.3, 0.15),
             V(0.8, 0, 0), nu=3, nv=4, mat=TAN)
    else:
        bundle(m, boom_a + V(0, 0.4, 0.3), boom_b + V(0, -0.5, 0.25), 0.3, TAN, n=5)
    rig(m, top - V(0, 0, 0.3), boom_b)
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.15, sheer(1.0) + 0.05)
    rig(m, top - V(0, 0, 0.3), stem, 0.024)
    if sailing:
        head = stem.lerp(top - V(0, 0, 0.3), 0.7)
        sail(m, head, head, stem + V(0, 0.25, 0.1), V(1.1, stem.y + 3.4, sheer(0.8) + 0.7), V(0.5, 0, 0), nu=2, nv=3, mat=TAN)
    else:
        bundle(m, stem + V(0, 0.25, -0.05), stem + V(0, 2.0, -0.35), 0.18, TAN, n=3)
    for sx in (1, -1):
        rig(m, top - V(0, 0, 0.8), hull.P(tm - 0.02, sheer(tm - 0.02), sx) + V(0, 0, 0.05), 0.02)
        piv = hull.P(0.55, sheer(0.55) - 0.1, sx) + V(sx * 0.05, 0, 0)
        leeboard(m, piv, 2.9, 1.25, sx, angle=0.75)
    ys = hull.y(0, 0)
    k0, zr = keel(0), sheer(0)
    rud = [V(0, ys, k0 + 0.05), V(0, ys + 0.9, k0 + 0.05), V(0, ys + 1.0, 0.3), V(0, ys + 0.7, zr + 0.25),
           V(0, ys + 0.3, zr + 0.3)]
    m.prism([p + V(-0.05, 0, 0) for p in rud], (0.1, 0, 0), TAR, tile=2.0, side_mat=DARK)
    m.beam((0, ys + 0.35, zr + 0.2), (0, ys - 1.8, zr + 0.4), 0.07, 0.08, DARK)
    with m.at(move(0.6, hull.y(0.2, 0), 0.2)):
        m.lathe([(0.2, 0), (0.28, 0.35), (0.3, 0.4)], 7, ROPE, smooth=False, cap0=True, urep=2)
    barrel_lo(m, (-0.7, hull.y(0.18, 0), 0.2), yaw=0.3)
    # M7 boats: the stove in the fore cuddy, fish baskets, a net hung from the boom to dry, a lantern
    chimney(m, 0.35, hull.y(th, zd(th)), zd(th) + 0.25, 0.45, 0.06)
    m.stove((0.35, hull.y(th, zd(th)), zd(th) + 0.25 + 0.66))
    for k, (x, t) in enumerate([(-0.9, 0.3), (-0.4, 0.34), (0.9, 0.36)]):
        basket(m, (x, hull.y(t, 0), 0.2), 0.24, 0.32)
    if not sailing:
        a = boom_a.lerp(boom_b, 0.3) - V(0, 0, 0.1)
        b = boom_a.lerp(boom_b, 0.62) - V(0, 0, 0.1)
        m.poly([a + V(0.05, 0, 0), b + V(0.05, 0, 0), b + V(0.4, 0, -0.9), a + V(0.3, 0, -1.1)], NET, out=(1, 0, 0),
               uvs=[(0, 0), (3, 0), (3, 1.8), (0, 2.2)])
        lantern(m, V(0.2, ym - 0.15, zm + 3.2), 0)
    else:
        for sx, kind in ((1, 1), (-1, 2)):  # port (+x) red, starboard green
            lantern(m, hull.P(0.7, sheer(0.7) + 0.2, sx, -0.05), kind, bail=False)
    return m


# ------------------------------------------------------------------ pontoon

PONTOON_DECK = 1.8  # deck top above the waterline: level with the quay (quay 1.8 m above the water)
PONTOON_LEN = 10.0
PONTOON_HALF = 2.05  # walkable half width between the railings


def pontoon_section():
    """10 m of floating walkway: a plank deck on stringers and trestles, two tarred floats
    with rounded ends under it, railings both sides. Open at both ends so sections chain."""
    m = Mesh(ao=0.0)
    m.shadefn = lambda p: 0.55 + 0.45 * sm((p.z + 0.8) / 2.6)
    for sx in (1, -1):
        cx = sx * 1.35
        out = []
        for j in range(5):
            a = math.pi * j / 4
            out.append(V(cx + 0.75 * math.cos(a), 4.3 + 0.5 * math.sin(a), -0.8))
        for j in range(5):
            a = math.pi + math.pi * j / 4
            out.append(V(cx + 0.75 * math.cos(a), -4.3 + 0.5 * math.sin(a), -0.8))
        m.prism(out, (0, 0, 1.4), TAR, tile=2.0)
        m.box((cx, 0, 0.62), (1.3, 7.6, 0.05), DARK)  # a walking board on the float
        for y in (-3.6, 0.0, 3.6):
            m.beam((cx, y, 0.6), (cx, y, 1.5), 0.2, 0.2, DARK, side=(1, 0, 0))
    m.shadefn = None
    for y in (-3.0, 3.0):
        m.beam((-1.35, y, 0.65), (1.35, y, 1.45), 0.12, 0.12, DARK, side=(0, 1, 0))
        m.beam((1.35, y, 0.65), (-1.35, y, 1.45), 0.12, 0.12, DARK, side=(0, 1, 0))
    for x in (-2.15, -1.35, 1.35, 2.15):
        m.beam((x, -5.0, 1.52), (x, 5.0, 1.52), 0.2, 0.2, DARK, shade=0.75)
    for y in np.linspace(-4.5, 4.5, 7):
        m.beam((-2.3, y, 1.66), (2.3, y, 1.66), 0.14, 0.12, DARK, side=(0, 1, 0), shade=0.7)
    m.box((0, 0, PONTOON_DECK - 0.04), (4.5, PONTOON_LEN, 0.08), DECK, tile=1.6, shade=0.95)
    # railings: posts every 2.5 m, top and middle rails, a kick board
    for sx in (1, -1):
        x = sx * 2.17
        for y in (-3.75, -1.25, 1.25, 3.75):
            m.box((x, y, PONTOON_DECK + 0.55), (0.1, 0.1, 1.1), DARK)
        for z, w, h in ((1.08, 0.08, 0.09), (0.55, 0.06, 0.06)):
            m.beam((x, -5.0, PONTOON_DECK + z), (x, 5.0, PONTOON_DECK + z), w, h, DARK)
        m.box((x, 0, PONTOON_DECK + 0.08), (0.04, PONTOON_LEN, 0.16), WOOD, shade=0.85)
        # fender posts and mooring cleats on the outside
        for y in (-4.6, 0.0, 4.6):
            m.box((sx * 2.33, y, 0.9), (0.14, 0.2, 1.8), DARK, shade=0.8)
        m.box((sx * 2.0, 2.5, PONTOON_DECK + 0.08), (0.14, 0.4, 0.14), IRON)
    return m
