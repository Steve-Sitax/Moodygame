"""The harbour tugs: the screw tug and the paddle tug (tug(paddle=True)). The ferry St. Anna is
built by tools/blender/build_ferry.py into ferry.glb."""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ tugs


def tug(paddle=False):
    """A harbour tug, ~19 m: iron hull, a tall thin funnel, engine casing with a small
    wheelhouse, towing arch aft, fenders. paddle=True: a paddle tug with paddle boxes."""
    m = Mesh(ao=0.0)
    L, B, KZ, SZ = 19.0, 4.6 if not paddle else 4.3, -2.1, 1.25

    def keel(t):
        return KZ + 0.4 * sm((t - 0.93) / 0.07) + (0.0 if paddle else 0.7) * sm((0.08 - t) / 0.08)

    def sheer(t):
        return SZ + 0.8 * max(0.0, (t - 0.6) / 0.4) ** 2 + 0.2 * max(0.0, (0.3 - t) / 0.3) ** 2

    SEC = [(0, 0.45), (0.15, 0.85), (0.35, 0.98), (1, 1.0)]

    def uz(z):
        return cl((z - KZ) / (SZ - KZ))

    def hb(t, z):
        u = uz(z)
        sec = table(SEC, u)
        if t > 0.6:
            f = (t - 0.6) / 0.4
            p = (1 - min(f, 1.0) ** 1.8) ** (0.8 + 0.5 * (1 - u))
        elif t < 0.35:
            f = (0.35 - t) / 0.35
            p = (1 - min(f, 1.0) ** 2) ** (0.4 + 1.5 * (1 - u))
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -0.3 * u * sm((t - 0.9) / 0.1) + 1.4 * u ** 2 * sm((0.08 - t) / 0.08)

    ts = [0, 0.03, 0.08, 0.15, 0.25, 0.4, 0.55, 0.68, 0.8, 0.88, 0.94, 0.98, 1.0]
    levels = [keel, lambda t: keel(t) + 0.6, lambda t: -0.8, lambda t: 0.0, lambda t: sheer(t) - 0.35, sheer]
    mats = [(REDLEAD, 0), (REDLEAD, 0), (REDLEAD, 0), (IRONHULL, 0), (WHITE, 3.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 1.8) / 3.2))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 0.75

    hull.deck(m, zd, 0, 1, 0.08, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, DARK, DARK)
    # engine casing and wheelhouse
    z0 = zd(0.45)
    cy0, cy1 = hull.y(0.64, z0), hull.y(0.3, z0)
    house(m, -1.45, 1.45, cy0, cy1, z0 - 0.05, z0 + 1.7, wall=WHITE, roof=DARK, over=0.1,
          windows=[("+x", cy0 + 1.2, z0 + 1.2), ("+x", cy1 - 1.2, z0 + 1.2), ("-x", cy0 + 1.2, z0 + 1.2),
                   ("-x", cy1 - 1.2, z0 + 1.2)], door=("+y", 0.0, 0.7, 1.5))
    zw = z0 + 1.8
    house(m, -1.15, 1.15, cy0 + 0.15, cy0 + 1.6, zw, zw + 1.75, wall=WOOD, roof=DARK, over=0.12,
          windows=[("-y", -0.55, zw + 1.2), ("-y", 0.0, zw + 1.2), ("-y", 0.55, zw + 1.2), ("+x", cy0 + 0.9, zw + 1.2),
                   ("-x", cy0 + 0.9, zw + 1.2)])
    # skylight on the casing, lifebuoys
    m.box((0, cy1 - 1.4, zw + 0.2), (1.2, 1.6, 0.4), DARK)
    m.box((0, cy1 - 1.4, zw + 0.42), (1.1, 1.5, 0.06), WINDOW)
    for sx in (1, -1):
        with m.at(move(sx * 1.47, cy0 + 2.6, z0 + 1.0) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
            pts = [V(0.3 * math.cos(2 * math.pi * i / 8), 0.3 * math.sin(2 * math.pi * i / 8), 0) for i in range(8)]
            m.tube(pts, [0.07] * 8, 4, WHITE, side=(0, 0, 1), closed_path=True, smooth=False)
    # the tall funnel
    fy = hull.y(0.5, zw)
    FH = 6.4
    with m.at(move(0, fy, zw) @ Matrix.Rotation(-0.06, 4, "X")):
        m.lathe([(0.52, -0.2), (0.52, FH), (0.56, FH + 0.05), (0.56, FH + 0.18)], 8, FUNNEL, urep=2, vscale=1 / FH,
                smooth=False)
        spar(m, V(0, -0.62, 0), V(0, -0.62, FH + 0.5), 0.06, 0.06, IRON, sides=4, cap=True)
    ft = V(0, fy + 0.25, zw + FH * 0.75)
    for dx, dy in ((1.5, 1.5), (-1.5, 1.5), (1.5, -1.8), (-1.5, -1.8)):
        rig(m, ft, (dx, fy + dy, zw - 0.05), 0.018)
    # mast forward, towing arch aft, towing hook, bitts
    tm = 0.84
    ym = hull.y(tm, zd(tm))
    spar(m, (0, ym, zd(tm)), (0, ym + 0.2, zd(tm) + 7.5), 0.1, 0.06, DARK, cap=True)
    m.box((0, ym + 0.05, zd(tm) + 5.0), (0.25, 0.25, 0.35), IRON)
    rig(m, (0, ym + 0.2, zd(tm) + 7.2), (0, hull.y(1, sheer(1)) + 0.2, sheer(1) + 0.05))
    pennant(m, (0, ym + 0.2, zd(tm) + 7.7), 1.2, h=0.2)
    if not paddle:
        lantern(m, V(0, ym - 0.18, zd(tm) + 5.6), 0)
    ta = 0.2
    wa = hull.hb(ta, sheer(ta)) - 0.1
    ya = hull.y(ta, zd(ta))
    arch = [V(wa * math.cos(math.pi * j / 6), ya, sheer(ta) + 1.0 * math.sin(math.pi * j / 6)) for j in range(7)]
    m.tube(arch, [0.07] * 7, 4, IRON, side=(0, 1, 0), smooth=False)
    m.box((0, hull.y(0.3, zd(0.3)) + 0.9, zd(0.3) + 0.5), (0.3, 0.3, 1.0), IRON)
    for t in (0.06, 0.95):
        for sx in (1, -1):
            bitts(m, sx * 0.55, hull.y(t, zd(t)), zd(t), 0.5, 0.18)
    with m.at(move(0.6, hull.y(0.1, zd(0.1)), zd(0.1))):
        m.lathe([(0.35, 0), (0.4, 0.12), (0.3, 0.2)], 8, ROPE, smooth=False, cap1=True, urep=3)
    # fenders: a fat rope pad at the stem, a few hanging over the side
    stem = V(0, hull.y(1.0, sheer(1.0) - 0.3), sheer(1.0) - 0.3)
    m.tube([stem + V(-0.5, 0.25, 0), stem + V(0, -0.15, 0), stem + V(0.5, 0.25, 0)], [0.18, 0.22, 0.18], 5, ROPE,
           side=(0, 0, 1), smooth=False, cap0=True, cap1=True)
    for sx in (1, -1):
        for t in (0.35, 0.55, 0.72):
            p = hull.P(t, 0.55, sx) + V(sx * 0.12, 0, 0)
            m.tube([p + V(0, 0, 0.25), p - V(0, 0, 0.3)], [0.14, 0.14], 5, ROPE, smooth=False, cap0=True, cap1=True)
    m.smoke.append(V(0, fy + math.sin(0.06) * (FH + 0.25), zw + math.cos(0.06) * (FH + 0.25)))
    fs = V(0, hull.y(0.0, sheer(0.0)) - 0.35, zd(0.0))
    spar(m, fs, fs + V(0, 0.2, 3.2), 0.045, 0.03, cap=True)
    flag(m, fs + V(0, 0.25, 3.1), 1.2, 0.8, along=(0, 1, -0.1), kind="belgian")
    if not paddle:
        hull_name(m, hull, 0.86, sheer(0.86) - 0.28, 2.4, 0.3, 3)
    coil(m, (-0.7, hull.y(0.93, zd(0.93)), zd(0.93)), 0.26)
    if paddle:
        yc = hull.y(0.47, 0)
        for sx in (1, -1):
            x0 = sx * hull.hb(0.47, 0.5)
            prof = [V(x0, yc + 2.0 * math.cos(math.pi * j / 8), 0.3 + 1.9 * math.sin(math.pi * j / 8)) for j in range(9)]
            m.prism(prof, (sx * 1.1, 0, 0), DARK, tile=1.2, side_mat=WHITE)
            m.box((sx * (abs(x0) + 0.55), yc, zd(0.47) + 0.05), (1.1, 5.2, 0.1), DECK)
            name_board(m, (sx * (abs(x0) + 1.1), yc, 1.15), (0, sx, 0), (0, 0, 1), 2.8, 0.35, 6, off=0.02)
    else:
        py = L / 2 - 0.55
        with m.at(move(0, py, -1.3) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            m.lathe([(0.15, -0.25), (0.18, 0.0), (0.12, 0.25)], 6, IRON, smooth=False, cap0=True, cap1=True)
        for k in range(4):
            a = math.pi / 2 * k + 0.3
            d = V(math.cos(a), 0, math.sin(a))
            s = V(-math.sin(a), 0.35, math.cos(a)).normalized()
            c = V(0, py, -1.3)
            m.slab([c + d * 0.15 - s * 0.22, c + d * 0.15 + s * 0.22, c + d * 0.85 + s * 0.2, c + d * 0.85 - s * 0.15], 0.04,
                   IRON, out=(0, -1, 0))
        rud = [V(0, L / 2 - 0.1, KZ + 0.8), V(0, L / 2 + 0.9, KZ + 0.8), V(0, L / 2 + 0.9, 0.2), V(0, L / 2 - 0.1, 0.5)]
        m.prism([p + V(-0.06, 0, 0) for p in rud], (0.12, 0, 0), IRON, tile=2.0)
    return m
