"""The small boats, every one of them can be taken and rowed: rowboat, dinghy, ship's boat, water
police gig, bumboat, old boat, punt, work boat (vlet) and eel boat. The open boat's hull (boat_hull) and
the ship's boat carried on deck (ships_boat) live in common.py, since barges and ships carry them too."""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ open boats


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


def round_boat(L, B, D, mats, stern_w=0.55, thwarts=(0.42, 0.66), seat=0, sheets=0.1, ribs_at=None, inner=WOOD,
               floor=DECK, cap=DARK, transom=False, tholes=True, boards=True):
    """M7 boats: an open round-bilged boat (rowing boat, dinghy, ship's boat, gig, bumboat): the hull,
    its inside with frames, bottom boards, thwarts, stern sheets, thole pins, a painter at the stem."""
    m = Mesh(ao=0.0)
    m.stow = Mesh(ao=0.0)
    hull, keel, sheer = boat_hull(L, B, D, mats, stern_w=stern_w)
    hull.outer(m)

    def fl(t):
        return max(keel(t) + 0.1, 0.16)

    hull.inner(m, [fl, lambda t: 0.5 * (keel(t) + sheer(t)) + 0.1, sheer], 0.0, 1.0, 0.035, inner, floor, end0=transom, end1=False)
    hull.cap(m, sheer, 0.0, 1.0, 0.035, cap)
    # the keel under her, and a rubbing strake along the sheer
    m.beam((0, hull.y(0.02, keel(0.02)), keel(0.02) - 0.03), (0, hull.y(0.9, keel(0.9)), keel(0.9) - 0.03), 0.06, 0.06, DARK)
    hull.wale(m, lambda t: sheer(t) - 0.03, 0.03, 0.97, h=0.05, out=0.025, mat=cap)
    ribs(m, hull, ribs_at or [0.12 + k * 0.1 for k in range(8)], fl, sheer, 0.035, w=0.035)
    if boards:
        for x in (-0.22, 0.0, 0.22):
            a, b = hull.y(0.12, 0), hull.y(0.86, 0)
            m.box((x * B / 1.55, (a + b) / 2, max(fl(0.5), 0.16) + 0.02), (0.18, abs(a - b), 0.025), WOOD, shade=0.7)
    for t in thwarts:
        z = sheer(t) - 0.2
        w = hull.hb(t, z) - 0.03
        m.box((0, hull.y(t, z), z), (2 * w, 0.24, 0.04), WOOD, shade=0.9)
        for sx in (1, -1):  # the knees that hold the thwart to the side
            m.beam(hull.P(t, z + 0.02, sx, 0.05), hull.P(t, z + 0.17, sx, 0.04), 0.04, 0.06, DARK, side=(0, 1, 0))
    if sheets:
        z = sheer(sheets) - 0.22
        w = hull.hb(sheets, z) - 0.03
        m.box((0, hull.y(sheets, z), z), (2 * w, 0.5, 0.04), WOOD, shade=0.9)
    ts = thwarts[seat]
    tp = ts + 0.68 / L
    if tholes:
        for sx in (1, -1):
            thole(m, hull.P(tp, sheer(tp) + 0.01, sx, 0.02))
    stem = V(0, hull.y(1, sheer(1)), sheer(1) - 0.05)
    m.box(stem + V(0, 0.06, 0), (0.05, 0.05, 0.05), IRON)
    rope_path(m, [stem + V(0, 0.02, 0), stem + V(0, 0.25, -0.12), stem + V(0.1, 0.55, sheer(0.85) - sheer(1) - 0.02)], 0.018, ROPE)
    row_info(m, hull, sheer, ts, sheer(ts) - 0.2 + 0.02, tp)
    return m, hull, keel, sheer


def rudder_tiller(m, hull, keel, sheer, tiller=0.9):
    """A rudder hung on the transom by pintles, and its tiller over the stern sheets."""
    ys = hull.y(0, sheer(0))
    k0, zr = keel(0.0), sheer(0)
    rud = [V(0, ys + 0.03, k0 + 0.02), V(0, ys + 0.35, k0 + 0.05), V(0, ys + 0.38, zr - 0.25), V(0, ys + 0.12, zr + 0.12),
           V(0, ys + 0.03, zr + 0.12)]
    m.prism([p + V(-0.025, 0, 0) for p in rud], (0.05, 0, 0), DARK, tile=1.0)
    for z in (k0 + 0.25, zr - 0.2):
        m.box((0, ys + 0.02, z), (0.07, 0.06, 0.04), IRON)
    m.beam((0, ys + 0.1, zr + 0.1), (0, ys - tiller, zr + 0.2), 0.035, 0.04, WOOD)


def rowboat():
    """The waterman's clinker rowing boat (M3j), with the M7 detail: frames, bottom boards, knees,
    thole pins, a bailer, the painter, a basket, oars laid in (a child node: hidden while rowed)."""
    m, hull, keel, sheer = round_boat(5.4, 1.55, 0.8, [(TARWEED, 0), (CLINKER, 0), (CLINKER, 0)])
    a = V(0.0, hull.y(0.12, 0), sheer(0.42) - 0.12)
    b = V(0.0, hull.y(0.95, 0), sheer(0.66) - 0.1)
    oars_stowed(m.stow, a, b, blade_at_b=False)
    # a bailer and a basket in the stern, a grapnel and its line forward
    with m.at(move(0.3, hull.y(0.2, 0), 0.2)):
        m.lathe([(0.07, 0.0), (0.1, 0.08), (0.1, 0.1)], 6, WOOD, smooth=False, cap0=True)
    basket(m, (-0.3, hull.y(0.24, 0), 0.19), 0.17, 0.2)
    g = V(0.1, hull.y(0.86, 0), 0.25)
    m.beam(g, g + V(0, -0.35, 0.02), 0.03, 0.03, IRON)
    for k in range(4):
        a4 = math.pi / 2 * k
        m.beam(g + V(0, -0.35, 0), g + V(0.14 * math.cos(a4), -0.45, 0.14 * math.sin(a4) + 0.02), 0.025, 0.025, IRON)
    coil(m, (-0.15, hull.y(0.88, 0), 0.2), 0.14)
    return m


def dinghy():
    """A jol: a small beamy clinker dinghy with a transom, her stubby mast unstepped and laid along
    the thwarts with the tanned spritsail furled round it; a rudder and tiller."""
    m, hull, keel, sheer = round_boat(4.3, 1.62, 0.78, [(TARWEED, 0), (CLINKER, 0), (GREEN, 0)], stern_w=0.72,
                                      thwarts=(0.46, 0.78), sheets=0.12, transom=True)
    rudder_tiller(m, hull, keel, sheer, tiller=0.8)
    # the mast and sprit laid in, the sail rolled round them; the mast thwart's iron band
    a = V(-0.35, hull.y(0.95, 0), sheer(0.8) - 0.05)
    b = V(-0.3, hull.y(0.05, 0) + 0.3, sheer(0.2) - 0.02)
    spar(m.stow, a, b, 0.05, 0.035, DARK)
    bundle(m.stow, a.lerp(b, 0.12) + V(0.03, 0, 0.06), a.lerp(b, 0.8) + V(0.03, 0, 0.06), 0.12, TAN, n=4)
    oars_stowed(m.stow, V(0.35, hull.y(0.2, 0), sheer(0.46) - 0.1), V(0.3, hull.y(0.92, 0), sheer(0.78) - 0.1), blade_at_b=False)
    t = 0.78
    with m.at(move(0, hull.y(t, 0), sheer(t) - 0.17)):
        m.lathe([(0.06, 0.0), (0.06, 0.03)], 6, IRON, smooth=False)
    stern_name(m, hull, 0.08, sheer(0.08) - 0.2, 0.8, 0.13, 4, both=True)
    return m


def shipsboat():
    """A sloep: a ship's boat, carvel, white topsides and a black sheer strake, tarred bottom,
    three thwarts, stern sheets with a back board, a rudder with a yoke, a boat hook."""
    m, hull, keel, sheer = round_boat(6.3, 1.9, 0.86, [(TARWEED, 0), (WHITE, 0), (WHITE, 0)], stern_w=0.62,
                                      thwarts=(0.5, 0.3, 0.72), sheets=0.1, transom=True, cap=DARK)
    rudder_tiller(m, hull, keel, sheer, tiller=0.5)
    ys = hull.y(0, sheer(0))
    m.beam((-0.45, ys - 0.05, sheer(0) + 0.14), (0.45, ys - 0.05, sheer(0) + 0.14), 0.05, 0.05, WOOD)  # the yoke
    z = sheer(0.1)
    m.box((0, hull.y(0.04, z), z - 0.02), (2 * hull.hb(0.04, z) - 0.1, 0.05, 0.3), WOOD, shade=0.8)
    oars_stowed(m.stow, V(-0.4, hull.y(0.15, 0), sheer(0.3) - 0.12), V(-0.35, hull.y(0.92, 0), sheer(0.72) - 0.12), blade_at_b=False)
    m.beam((0.45, hull.y(0.15, 0), sheer(0.3) - 0.14), (0.4, hull.y(0.9, 0), sheer(0.72) - 0.14), 0.035, 0.035, WOOD)
    m.beam((0.4, hull.y(0.9, 0), sheer(0.72) - 0.14), (0.4, hull.y(0.95, 0), sheer(0.72) - 0.1), 0.03, 0.03, IRON)
    stern_name(m, hull, 0.06, sheer(0.06) - 0.18, 1.0, 0.14, 0, both=True)
    return m


def gig():
    """A gig of the water police: long and narrow for speed, black with a varnished sheer strake,
    four thwarts, a rudder with a yoke, a flagstaff with the Belgian colours, a lantern in the bow."""
    m, hull, keel, sheer = round_boat(7.4, 1.38, 0.72, [(TARWEED, 0), (IRONHULL, 0), (VARNISH, 0)], stern_w=0.5,
                                      thwarts=(0.52, 0.3, 0.72, 0.86), sheets=0.1, transom=True, cap=VARNISH)
    rudder_tiller(m, hull, keel, sheer, tiller=0.35)
    ys = hull.y(0, sheer(0))
    m.beam((-0.4, ys - 0.05, sheer(0) + 0.14), (0.4, ys - 0.05, sheer(0) + 0.14), 0.04, 0.04, WOOD)
    fs = V(0, ys - 0.1, sheer(0) - 0.05)
    spar(m, fs, fs + V(0, 0.1, 1.4), 0.025, 0.018, WOOD, cap=True)
    flag(m, fs + V(0, 0.12, 1.38), 0.6, 0.4, along=(0, 1, -0.1), kind="belgian")
    name_board(m, (0, ys + 0.06, sheer(0) - 0.1), (-1, 0, 0), (0, 0, 1), 0.56, 0.08, 7, off=0.02, mat=NAMES4)
    bow = V(0, hull.y(0.95, sheer(0.95)), sheer(0.95))
    lantern(m, bow + V(0, 0.15, 0.16), 0, bail=True)
    oars_stowed(m.stow, V(-0.25, hull.y(0.12, 0), sheer(0.3) - 0.1), V(-0.22, hull.y(0.94, 0), sheer(0.86) - 0.1), blade_at_b=False)
    oars_stowed(m.stow, V(0.25, hull.y(0.12, 0), sheer(0.3) - 0.07), V(0.22, hull.y(0.94, 0), sheer(0.86) - 0.07), blade_at_b=False)
    return m


def bumboat():
    """A bumboat: a beamy boat that sells to the ships in the roads, a canvas hood on hoops over
    her after half and the goods under it: bread, a crate of bottles, a cask, baskets of greens."""
    m, hull, keel, sheer = round_boat(5.0, 1.95, 0.82, [(TARWEED, 0), (CLINKER, 0), (GREEN, 0)], stern_w=0.7,
                                      thwarts=(0.62, 0.84), sheets=0.08, transom=True)
    # the hood: hoops from gunwale to gunwale, the canvas over them (t 0.06 .. 0.44)
    arcs = []
    for t in (0.06, 0.18, 0.31, 0.44):
        w = hull.hb(t, sheer(t)) - 0.04
        y = hull.y(t, sheer(t))
        z0 = sheer(t)
        arc = [V(w * math.cos(math.pi * j / 6), y, z0 + 0.85 * math.sin(math.pi * j / 6)) for j in range(7)]
        m.tube(arc, [0.02] * 7, 3, WOOD, side=(0, 1, 0), smooth=False)
        arcs.append(arc)
    for a, b in zip(arcs, arcs[1:]):
        for j in range(6):
            pts = [a[j] + V(0, 0, 0.02), a[j + 1] + V(0, 0, 0.02), b[j + 1] + V(0, 0, 0.02), b[j] + V(0, 0, 0.02)]
            m.poly(pts, HOOD, out=((a[j].x + a[j + 1].x) / 2, 0, 1), uvs=[(j / 3, 0), ((j + 1) / 3, 0), ((j + 1) / 3, 1), (j / 3, 1)],
                   shade=0.8)
    # the goods under the hood
    z = 0.2
    for x, t in [(-0.45, 0.14), (0.45, 0.16), (-0.4, 0.32), (0.42, 0.3)]:
        basket(m, (x, hull.y(t, 0), z), 0.2, 0.26)
    for k in range(5):
        sack_lo(m, (-0.45 + 0.05 * (k % 2), hull.y(0.14, 0) + 0.08 * k - 0.16, z + 0.26), yaw=math.pi / 2 + 0.2 * k)
    cy = hull.y(0.24, 0)
    crate_lo(m, (0.0, cy, z), size=(0.5, 0.36, 0.26))
    for i in range(6):
        with m.at(move(-0.15 + 0.15 * (i % 3), cy - 0.08 + 0.16 * (i // 3), z + 0.26)):
            m.lathe([(0.035, 0.0), (0.035, 0.18), (0.015, 0.24), (0.012, 0.3)], 5, GLASS, smooth=False, cap1=True)
    # a small keg of gin on its side
    with m.at(move(0.4, hull.y(0.4, 0), z + 0.18) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.14, -0.22), (0.18, 0.0), (0.14, 0.22)], 7, BARREL, cap0=True, cap1=True, smooth=False)
    lantern(m, V(0, hull.y(0.44, sheer(0.44)) + 0.05, sheer(0.44) + 0.62), 0)
    oars_stowed(m.stow, V(-0.55, hull.y(0.5, 0), sheer(0.62) - 0.08), V(-0.45, hull.y(0.96, 0), sheer(0.84) - 0.08), blade_at_b=True)
    return m


def oldboat():
    """An old clinker boat nobody owns any more: grey and worn, a sheet of tin nailed over a split
    strake, one thwart cracked and sagging, bilge water standing in her; a pair of old oars."""
    m, hull, keel, sheer = round_boat(4.9, 1.5, 0.78, [(TARWEED, 0), (CLINKER, 0), (CLINKER, 0)], thwarts=(0.44, 0.7),
                                      inner=DARK, floor=DARK, boards=False)
    # bilge water inside (a flat sheet over the floor)
    zb = 0.24
    T = hull.span(0.12, 0.9)
    for ta, tb in zip(T, T[1:]):
        a, b = hull.P(ta, zb, 1, 0.06), hull.P(tb, zb, 1, 0.06)
        pts = [mirror(a, -1), a, b, mirror(b, -1)]
        m.poly(pts, BILGE, out=(0, 0, 1), uvs=[(-p.y, p.x) for p in pts])
    # the tin patch over the split strake; rust and weather running down the other side
    p = hull.P(0.58, 0.28, 1) + V(0.012, 0, 0)
    m.box(p, (0.02, 0.55, 0.22), IRON)
    hull.decal(m, 0.35, sheer(0.35) - 0.06, 0.5, 0.45, -1)
    # the cracked thwart sags (drawn over the whole one)
    t = 0.7
    z = sheer(t) - 0.2
    m.beam((-0.55, hull.y(t, z), z + 0.03), (0.02, hull.y(t, z) + 0.02, z - 0.06), 0.24, 0.045, WOOD, side=(0, 1, 0))
    oars_stowed(m.stow, V(0.2, hull.y(0.14, 0), sheer(0.44) - 0.1), V(0.25, hull.y(0.9, 0), sheer(0.7) - 0.12), blade_at_b=False)
    return m


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


def punt():
    """A flat-bottomed rowing punt with raked flat ends, as in the canals (M3j), with the M7 detail:
    frames across the bottom, bottom boards, iron pins for the oars, the painter, a bucket, the
    quant pole, a washerwoman's basket; a pair of oars laid in (child node, hidden while rowed)."""
    m = Mesh(ao=0.0)
    m.stow = Mesh(ao=0.0)
    L, B = 5.2, 1.35
    hull, sheer, hb = flat_boat(L, B, mats=[(TAR, 0), (TAR, 0)])
    hull.outer(m)
    hull.inner(m, [lambda t: 0.14, sheer], 0.0, 1.0, 0.04, WOOD, DECK)
    hull.cap(m, sheer, 0, 1, 0.04, DARK)
    hull.wale(m, lambda t: sheer(t) - 0.02, 0.02, 0.98, h=0.05, out=0.025)
    for t in (0.3, 0.72):
        m.box((0, hull.y(t, 0), 0.36), (B * 0.86, 0.26, 0.04), WOOD, shade=0.9)
    for t in (0.12, 0.2, 0.4, 0.5, 0.6, 0.82, 0.9):
        w = hb(t, 0.15) - 0.06
        m.box((0, hull.y(t, 0), 0.155), (2 * w, 0.05, 0.03), DARK, shade=0.7)
        for sx in (1, -1):
            m.beam(hull.P(t, 0.16, sx, 0.05), hull.P(t, sheer(t) - 0.05, sx, 0.045), 0.035, 0.05, DARK, side=(0, 1, 0), shade=0.7)
    for x in (-0.25, 0.0, 0.25):
        m.box((x, hull.y(0.5, 0), 0.18), (0.18, 3.4, 0.02), WOOD, shade=0.75)
    m.beam((0.25, hull.y(0.05, 0), 0.45), (0.35, hull.y(1.0, 0) - 1.2, 0.58), 0.05, 0.05, WOOD)  # the quant pole
    tp = 0.26 + 0.68 / L
    for sx in (1, -1):
        m.box(hull.P(tp, sheer(tp) + 0.05, sx, 0.02), (0.04, 0.04, 0.12), IRON)
    stem = V(0, hull.y(1, sheer(1)), sheer(1) - 0.05)
    m.box(stem + V(0, 0.05, 0), (0.06, 0.06, 0.06), IRON)
    rope_path(m, [stem, stem + V(0, 0.3, -0.12), stem + V(-0.1, 0.6, -0.2)], 0.018, ROPE)
    with m.at(move(-0.35, hull.y(0.1, 0), 0.16)):
        m.lathe([(0.13, 0.0), (0.15, 0.26), (0.16, 0.27)], 7, WOOD, smooth=False, cap0=True, urep=2)
    basket(m, (0.3, hull.y(0.86, 0), 0.16), 0.24, 0.24)
    oars_stowed(m.stow, V(-0.3, hull.y(0.34, 0), 0.43), V(-0.25, hull.y(0.95, 0), 0.43), blade_at_b=False)
    # rower on the after thwart, the pins 0.68 m forward
    row_info(m, hull, sheer, 0.26, 0.36, tp, speed=0.9)
    return m


def workboat():
    """A vlet: the harbour's flat-bottomed work boat, bigger and heavier than a punt: tarred sides
    with a green top strake, a transom at each end, frames, a sculling notch in the stern, a
    boat hook and a coil of rope, a grapnel; worked with oars or a single sculling oar."""
    m = Mesh(ao=0.0)
    m.stow = Mesh(ao=0.0)
    L, B = 6.0, 1.85
    hull, sheer, hb = flat_boat(L, B, bottom=-0.16, rise=0.1, flare=0.16, bow_rake=0.75, stern_rake=0.4, bow_rise=0.1)
    hull.outer(m)
    hull.inner(m, [lambda t: 0.14, sheer], 0.0, 1.0, 0.045, WOOD, DECK)
    hull.cap(m, sheer, 0, 1, 0.045, DARK)
    hull.wale(m, lambda t: sheer(t) - 0.02, 0.02, 0.98, h=0.14, out=0.03, mat=GREEN, shade=0.9)
    for t in (0.1, 0.2, 0.3, 0.42, 0.54, 0.66, 0.78, 0.9):
        for sx in (1, -1):
            m.beam(hull.P(t, 0.16, sx, 0.055), hull.P(t, sheer(t) - 0.05, sx, 0.05), 0.04, 0.055, DARK, side=(0, 1, 0), shade=0.7)
    ts, tf = 0.36, 0.7
    for t in (ts, tf):
        m.box((0, hull.y(t, 0), sheer(t) - 0.2), (2 * hb(t, sheer(t) - 0.2) - 0.1, 0.26, 0.045), WOOD, shade=0.9)
    m.box((0, hull.y(0.06, 0), sheer(0.06) - 0.22), (2 * hb(0.06, 0.4) - 0.1, 0.5, 0.045), WOOD, shade=0.9)
    ys = hull.y(0, sheer(0))
    m.box((0, ys - 0.04, sheer(0) + 0.02), (0.12, 0.1, 0.06), DARK)  # the sculling notch's chock
    for x in (-0.3, 0.0, 0.3):
        m.box((x, hull.y(0.5, 0), 0.17), (0.2, 4.0, 0.025), WOOD, shade=0.75)
    tp = ts + 0.68 / L
    for sx in (1, -1):
        thole(m, hull.P(tp, sheer(tp) + 0.01, sx, 0.02))
    m.beam((0.55, hull.y(0.1, 0), 0.3), (0.6, hull.y(0.95, 0), 0.35), 0.035, 0.035, WOOD)  # the boat hook
    m.beam((0.6, hull.y(0.95, 0), 0.35), (0.6, hull.y(0.97, 0), 0.4), 0.03, 0.03, IRON)
    coil(m, (-0.3, hull.y(0.86, 0), 0.17), 0.22)
    coil(m, (0.35, hull.y(0.15, 0), 0.17), 0.18)
    stem = V(0, hull.y(1, sheer(1)), sheer(1) - 0.05)
    m.box(stem + V(0, 0.05, 0), (0.07, 0.07, 0.07), IRON)
    rope_path(m, [stem, stem + V(0, 0.35, -0.1), stem + V(0.15, 0.7, -0.25)], 0.02, ROPE)
    stern_name(m, hull, 0.04, sheer(0.04) - 0.2, 1.0, 0.14, 1, both=True)
    oars_stowed(m.stow, V(-0.45, hull.y(0.12, 0), sheer(ts) - 0.12), V(-0.4, hull.y(0.94, 0), sheer(tf) - 0.12), blade_at_b=False)
    row_info(m, hull, sheer, ts, sheer(ts) - 0.18, tp, speed=0.85)
    return m


def eelboat():
    """An aalschuit, the eel fisherman's boat: flat-bottomed and tarred, a wet well amidships (a
    box through which the river runs, pierced with holes), eel traps (fykes) forward, baskets."""
    m = Mesh(ao=0.0)
    m.stow = Mesh(ao=0.0)
    L, B = 6.2, 2.0
    hull, sheer, hb = flat_boat(L, B, bottom=-0.16, rise=0.12, flare=0.18, bow_rake=0.9, stern_rake=0.45, bow_rise=0.18)
    hull.outer(m)
    hull.inner(m, [lambda t: 0.14, sheer], 0.0, 1.0, 0.045, TAR, DECK)
    hull.cap(m, sheer, 0, 1, 0.045, DARK)
    hull.wale(m, lambda t: sheer(t) - 0.03, 0.02, 0.98, h=0.08, out=0.03)
    # the wet well: a box across the boat, its lid in two halves, holes in its side
    w0, w1 = 0.42, 0.62
    ya, yb = hull.y(w0, 0), hull.y(w1, 0)
    wz = sheer(0.5) - 0.08
    ww = hb(0.5, wz) - 0.06
    m.box((0, (ya + yb) / 2, (0.14 + wz) / 2), (2 * ww, abs(ya - yb), wz - 0.14), WOOD, shade=0.8)
    for x in (-ww / 2, ww / 2):
        m.box((x, (ya + yb) / 2, wz + 0.02), (ww - 0.04, abs(ya - yb) - 0.06, 0.03), DARK)
        m.box((x * 0.4, (ya + yb) / 2, wz + 0.05), (0.14, 0.05, 0.03), IRON)
    for i in range(6):
        for j in range(2):
            m.box((-ww + 0.3 + i * (2 * ww - 0.6) / 5, ya + 0.005, 0.26 + 0.12 * j), (0.05, 0.02, 0.04), BILGE)
    ts = 0.3
    m.box((0, hull.y(ts, 0), sheer(ts) - 0.2), (2 * hb(ts, 0.4) - 0.1, 0.26, 0.045), WOOD, shade=0.9)
    tp = ts + 0.68 / L
    for sx in (1, -1):
        thole(m, hull.P(tp, sheer(tp) + 0.01, sx, 0.02))
    # two fykes forward; baskets aft; a net hung over the gunwale to dry
    eel_trap(m, V(-0.45, hull.y(0.68, 0), 0.45), V(-0.3, hull.y(0.95, 0) + 0.3, 0.3), 0.28)
    eel_trap(m, V(0.4, hull.y(0.7, 0), 0.42), V(0.25, hull.y(0.92, 0) + 0.2, 0.3), 0.26)
    basket(m, (-0.45, hull.y(0.12, 0), 0.16), 0.22, 0.3)
    basket(m, (0.4, hull.y(0.16, 0), 0.16), 0.2, 0.28)
    a = hull.P(0.2, sheer(0.2), -1) + V(-0.03, 0, 0)
    b = hull.P(0.36, sheer(0.36), -1) + V(-0.03, 0, 0)
    m.poly([a, b, b + V(-0.05, 0, -0.45), a + V(-0.05, 0, -0.35)], NET, out=(-1, 0, 0), uvs=[(0, 0), (3, 0), (3, 1.5), (0, 1.2)])
    stem = V(0, hull.y(1, sheer(1)), sheer(1) - 0.05)
    m.box(stem + V(0, 0.05, 0), (0.07, 0.07, 0.07), IRON)
    rope_path(m, [stem, stem + V(0, 0.35, -0.12), stem + V(-0.12, 0.7, -0.25)], 0.02, ROPE)
    stern_name(m, hull, 0.04, sheer(0.04) - 0.2, 1.0, 0.14, 3, both=True)
    oars_stowed(m.stow, V(0.6, hull.y(0.1, 0), sheer(ts) - 0.1), V(0.62, hull.y(0.4, 0), sheer(0.4) + 0.06), blade_at_b=False)
    row_info(m, hull, sheer, ts, sheer(ts) - 0.18, tp, speed=0.85)
    return m
