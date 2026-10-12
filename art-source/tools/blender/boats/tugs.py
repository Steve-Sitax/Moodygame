"""The harbour tugs: the screw tug (tug()) and the paddle tug (tug(paddle=True)). The ferry St. Anna is
built by tools/blender/build_ferry.py into ferry.glb.

B3, 2026-10-11 (Steve: "Remodel all boats in high detail, good textures, different names and names correctly on
boats ... no water in the boats themselves ... More differentiation"): two Scheldt harbour tugs of the 1870s.

  tug         a screw tug of an Antwerp towage company: a black riveted iron hull with a white line, a heavy
              timber fender belt and rope fenders, a bow pudding; a cream engine casing with panelled walls,
              portholes and doors, a varnished wheelhouse open behind (wheel, binnacle, telegraph inside, the
              side lights on screens at its sides), a tall thin raked funnel in the owner's colours (black, a
              red band between two white rings) with its steam pipe and whistle, cowl vents, the engine-room
              skylight with brass bars; a mast forward with the two white towing lights; the towing hook on its
              post at the casing's after end, two high towing bows over the after deck, a hawser flaked down,
              bitts and fairleads, the windlass and the anchor on its bill board, the screw and the rudder.
  paddle_tug  a side-wheel tug of another owner: paddle boxes with a fan of vent slots, a gilt moulding and
              the name carved round the box (its name zone), the wheels' arms and floats under them,
              sponsons with their guard beams, an open bridge across the boxes with the helm and the
              telegraphs, the shaft casing and the engine-room skylight between the boxes, one tall buff
              funnel with a black top, varnished deckhouses, a gold line on a black hull, green bulwarks.

The contract (docs/boats.md): the same length, beam, keel and height as before (within 0.1 m); the children
_cap (made by the driver from the hull), _walk (the decks), _block (what a walker cannot pass), _far (about 20%
of the triangles) and the name zones _name_bow_p, _name_bow_s, _name_stern (and _name_box_p, _name_box_s on
the paddle tug), each a strip of quads with uv 0..1, winding outward, 4:1. The zones are drawn dark here (the
ground of the names atlas) until the game points them at the vessel's cell (W5). Lanterns: the town's oil
lantern (lantern_kit); lamps kind 0 white, 1 red (port, +x), 2 green (starboard).
"""

import math
from contextlib import contextmanager

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ small helpers of the tugs


@contextmanager
def tinted(m, rgb):
    """Build a part with a colour cast multiplied into its vertex colour (a buff funnel from the cream paint)."""
    old = m.tintfn
    m.tintfn = lambda p: rgb
    try:
        yield
    finally:
        m.tintfn = old


def frame_at(c, n):
    """A matrix that puts local +z along n at c."""
    q = Vector(n).normalized().to_track_quat("Z", "Y")
    return Matrix.Translation(Vector(c)) @ q.to_matrix().to_4x4()


def side_normal(hull, t, z, sx):
    """The outward horizontal normal of the hull side at (t, z)."""
    a = hull.P(min(1.0, t + 0.01), z, sx)
    b = hull.P(max(0.0, t - 0.01), z, sx)
    tan = (b - a)
    n = V(-tan.y, tan.x, 0.0)
    if n.length < 1e-6:
        return V(sx, 0, 0)
    n.normalize()
    if n.x * sx < 0:
        n = -n
    return n


def porthole(m, c, n, r=0.11, sides=10):
    """A brass-rimmed porthole with its dark glass, its face along n."""
    with m.at(frame_at(c, n)):
        m.lathe([(r + 0.045, 0.0), (r + 0.045, 0.02), (r + 0.02, 0.035), (r, 0.03), (r, 0.0)], sides, COPPER,
                smooth=False)
        m.poly([V(r * math.cos(2 * math.pi * i / sides), r * math.sin(2 * math.pi * i / sides), 0.012)
                for i in range(sides)], GLASS, out=(0, 0, 1), shade=0.45)


def lifebuoy_ring(m, c, n, r=0.3, tube=0.06, segs=12):
    """A cork lifebuoy in painted canvas: four white and four red quarters, flat against a wall facing n."""
    c, n = Vector(c), Vector(n).normalized()
    a = n.orthogonal().normalized()
    b = n.cross(a)
    pts = [c + a * r * math.cos(2 * math.pi * i / segs) + b * r * math.sin(2 * math.pi * i / segs) for i in range(segs)]
    mats = [WHITE if (i // (segs // 8 or 1)) % 2 == 0 else REDLEAD for i in range(segs)]
    m.tube(pts, [tube] * segs, 5, WHITE, side=tuple(n), closed_path=True, smooth=False, mats=mats, urep=1, vscale=1.5)


def bitt_pair(m, x, y, z, along=(0, 1, 0), h=0.48, r=0.1, gap=0.36, sides=10):
    """Cast-iron mooring bitts: two posts with flared caps on a base plate, a cross bar between them."""
    a = Vector(along).normalized()
    c = V(x, y, z)
    m.box(c + V(0, 0, 0.025), (abs(a.x) * (gap + 0.3) + abs(a.y) * 0.32 + 0.0, abs(a.y) * (gap + 0.3) + abs(a.x) * 0.32,
                              0.05), IRON, shade=0.8)
    for s in (-gap / 2, gap / 2):
        with m.at(move(*(c + a * s))):
            m.lathe([(r * 1.15, 0.05), (r, 0.1), (r * 0.95, h * 0.8), (r * 1.35, h * 0.88), (r * 1.35, h),
                     (r * 0.5, h + 0.03)], sides, IRON, smooth=False, cap1=True)
    m.beam(c - a * (gap / 2) + V(0, 0, h * 0.55), c + a * (gap / 2) + V(0, 0, h * 0.55), 0.05, 0.05, IRON)


def cleat(m, c, along=(0, 1, 0), size=0.36):
    c, a = Vector(c), Vector(along).normalized()
    m.beam(c - a * size / 2 + V(0, 0, 0.07), c + a * size / 2 + V(0, 0, 0.07), 0.06, 0.05, IRON)
    for s in (-size * 0.2, size * 0.2):
        m.box(c + a * s + V(0, 0, 0.035), (0.05, 0.05, 0.07), IRON)


def fairlead(m, p, sx):
    """A fairlead on the rail cap: two cast horns the line runs between."""
    for dy in (-0.11, 0.11):
        m.beam(p + V(0, dy, 0), p + V(sx * 0.04, dy * 1.25, 0.13), 0.07, 0.06, IRON, side=(1, 0, 0))


def cowl(m, x, y, z, h=1.25, r=0.14, yaw=0.0, sides=10):
    """A cowl ventilator: a white pipe, its bell mouth turned forward, red inside."""
    with m.at(move(x, y, z)):
        m.lathe([(r * 1.4, 0.0), (r * 1.1, 0.06), (r, 0.12), (r, h)], sides, WHITE, smooth=False)
    with m.at(move(x, y, z + h) @ rot_z(yaw) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(r, -0.05), (r * 1.5, 0.1), (r * 2.2, 0.3), (r * 2.4, 0.42)], sides, WHITE, smooth=False)
        m.lathe([(r * 2.25, 0.41), (r * 2.05, 0.3), (r * 1.35, 0.12), (r * 0.85, -0.03)], sides, REDLEAD, smooth=False)


def whistle(m, c, sides=8):
    """The steam whistle: a brass bell on its stem, a small lever and its lanyard."""
    c = Vector(c)
    with m.at(move(*c)):
        m.lathe([(0.04, 0.0), (0.045, 0.06), (0.07, 0.09), (0.075, 0.32), (0.06, 0.36), (0.02, 0.4)], sides, COPPER,
                smooth=False, cap1=True)
        m.beam(V(0, 0, 0.07), V(0.18, 0, 0.1), 0.02, 0.02, IRON)
    m.line(c + V(0.18, 0, 0.1), c + V(0.18, 0.0, -3.0))


def window_pane(m, c, right, up, w, h, frame=VARNISH, glass=GLASS, bars=1, off=0.012):
    """A window: dark glass in a frame of four bars, `bars` sash bars across."""
    c, r, u = Vector(c), Vector(right).normalized(), Vector(up).normalized()
    n = r.cross(u)
    q = c + n * 0.002
    m.poly([q - r * w / 2 - u * h / 2, q + r * w / 2 - u * h / 2, q + r * w / 2 + u * h / 2, q - r * w / 2 + u * h / 2], glass,
           out=n, shade=0.3, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
    for s in (-1, 1):
        m.beam(c + n * off + u * s * h / 2 - r * (w / 2 + 0.03), c + n * off + u * s * h / 2 + r * (w / 2 + 0.03), 0.05,
               0.04, frame, side=n, caps=True)
        m.beam(c + n * off + r * s * w / 2 - u * h / 2, c + n * off + r * s * w / 2 + u * h / 2, 0.05, 0.04, frame, side=n)
    for k in range(1, bars + 1):
        f = k / (bars + 1) - 0.5
        m.beam(c + n * off + r * f * w - u * h / 2, c + n * off + r * f * w + u * h / 2, 0.025, 0.025, frame, side=n)


def panelled_wall(m, a, b, z0, z1, n, wall, trim, panels=3):
    """A wall face from a to b (horizontal), z0 to z1, looking along n: a plinth, a cornice and the stiles of its
    panels, raised on the face."""
    a, b, n = Vector(a), Vector(b), Vector(n).normalized()
    o = n * 0.02
    m.beam(a + o + V(0, 0, z0 + 0.09), b + o + V(0, 0, z0 + 0.09), 0.04, 0.16, trim, side=n)
    m.beam(a + o + V(0, 0, z1 - 0.05), b + o + V(0, 0, z1 - 0.05), 0.04, 0.1, trim, side=n)
    for k in range(panels + 1):
        p = a.lerp(b, k / panels) + o
        m.beam(p + V(0, 0, z0 + 0.17), p + V(0, 0, z1 - 0.1), 0.06, 0.035, trim, side=n.cross(V(0, 0, 1)))


def ladder_up(m, a, b, half=0.2, step=0.28, mat=IRON):
    """A steep iron ladder from a (foot) to b (top)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    s = d.cross(V(0, 0, 1))
    s = V(1, 0, 0) if s.length < 1e-4 else s.normalized()
    for k in (-half, half):
        m.beam(a + s * k, b + s * k + d.normalized() * 0.4, 0.04, 0.05, mat, side=s)
    n = int(d.length / step)
    for i in range(1, n + 1):
        p = a.lerp(b, i / (n + 1))
        m.beam(p - s * half, p + s * half, 0.03, 0.03, mat, caps=False)


# ---- the name zones (docs/boats.md): strips of quads with uv 0..1, left to right as their reader sees them


def zone(points_lo, points_hi, mat=DARK, shade=0.32):
    """A name zone from its bottom and top edges (reader's left to right): uv u by length along the middle,
    v 0 at the bottom, 1 at the top. Wound outward (right x up)."""
    z = Mesh(ao=0.0)
    mid = [(a + b) / 2 for a, b in zip(points_lo, points_hi)]
    acc = [0.0]
    for a, b in zip(mid, mid[1:]):
        acc.append(acc[-1] + (b - a).length)
    tot = acc[-1] or 1.0
    for i in range(len(mid) - 1):
        u0, u1 = acc[i] / tot, acc[i + 1] / tot
        pts = [points_lo[i], points_lo[i + 1], points_hi[i + 1], points_hi[i]]
        z.face([z.vert(p) for p in pts], [(u0, 0), (u1, 0), (u1, 1), (u0, 1)], mat, shade)
    return z


def bow_zone(hull, t, zc, w, h, sx, off=0.03, n=8):
    """A name on the bow, following the plating at height zc round station t: on the port bow from bow to stern,
    on the starboard bow from stern to bow (as a reader alongside sees it)."""
    def length(t0, t1):
        return (hull.P(t1, zc, sx) - hull.P(t0, zc, sx)).length
    lo_t, hi_t, acc = t, t, 0.0
    while acc < w / 2 and lo_t > 0.0:
        acc += length(lo_t - 0.002, lo_t)
        lo_t -= 0.002
    acc = 0.0
    while acc < w / 2 and hi_t < 1.0:
        acc += length(hi_t, hi_t + 0.002)
        hi_t += 0.002
    ts = [hi_t + (lo_t - hi_t) * k / n for k in range(n + 1)] if sx > 0 else [lo_t + (hi_t - lo_t) * k / n for k in range(n + 1)]
    lo, hi = [], []
    for tt in ts:
        nn = side_normal(hull, tt, zc, sx) * off
        lo.append(hull.P(tt, zc - h / 2, sx) + nn)
        hi.append(hull.P(tt, zc + h / 2, sx) + nn)
    return zone(lo, hi)


def stern_zone(hull, zc, w, h, tq=0.25, off=0.03, n=12):
    """The name and port round the counter: from the port quarter round the stern to the starboard quarter (the
    reader astern reads from port, +x, to starboard). Each edge is the hull's outline at its own height, the same
    length either side of the middle of the stern."""
    path = [(tq * (1 - k / 60), 1) for k in range(61)] + [(tq * k / 60, -1) for k in range(61)]

    def edge(z):
        pts = [hull.P(t, z, s_) for t, s_ in path]
        acc = [0.0]
        for a, b in zip(pts, pts[1:]):
            acc.append(acc[-1] + (b - a).length)
        mid = (acc[60] + acc[61]) / 2  # the middle of the stern (between the two sides' points at t 0)
        out = []
        for k in range(n + 1):
            L = mid - w / 2 + w * k / n
            for i in range(len(acc) - 1):
                if acc[i + 1] >= L or i == len(acc) - 2:
                    f = cl((L - acc[i]) / max(acc[i + 1] - acc[i], 1e-9))
                    out.append(pts[i].lerp(pts[i + 1], f))
                    break
        return out
    lo, hi = edge(zc - h / 2), edge(zc + h / 2)
    for k in range(n + 1):
        a, b = lo[max(0, k - 1)], lo[min(n, k + 1)]
        nn = (b - a).cross(V(0, 0, 1))
        nn = nn.normalized() if nn.length > 1e-6 else V(0, 1, 0)
        lo[k] = lo[k] + nn * off
        hi[k] = hi[k] + nn * off
    return zone(lo, hi)


def box_zone(x, yc, zc, r0, r1, sx, half_angle, n=12):
    """A name curved round a paddle box's face (x the face, the shaft at yc, zc): a band between radii r0 and r1,
    centred on the top, the letters standing out from the shaft. Port from bow to stern, starboard the other way."""
    a0, a1 = math.pi / 2 + half_angle, math.pi / 2 - half_angle
    if sx < 0:
        a0, a1 = a1, a0
    lo, hi = [], []
    for k in range(n + 1):
        a = a0 + (a1 - a0) * k / n
        c, s = math.cos(a), math.sin(a)
        lo.append(V(x, yc + r0 * c, zc + r0 * s))
        hi.append(V(x, yc + r1 * c, zc + r1 * s))
    return zone(lo, hi)


# ------------------------------------------------------------------ the tugs


def tug(paddle=False, far=False):
    """A harbour tug, ~19 m (docs/boats.md: 21.06 m over her fenders): iron hull, a tall thin funnel, the engine
    casing, towing gear aft, fenders. paddle=True: the paddle tug. far=True: her far copy (about a fifth of the
    triangles: the hull, houses, funnel, boxes and mast, no small gear)."""
    m = Mesh(ao=0.0)
    S = (lambda n: max(6, n // 2)) if far else (lambda n: n)
    L, B, KZ, SZ = 19.0, 4.6 if not paddle else 4.3, -2.1, 1.25
    walk, block = Mesh(ao=0.0), Mesh(ao=0.0)

    def blk(c, size):
        block.box(c, size, DARK)

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
            # an elliptical counter: broad up at the rail (the name and port of registry on it), fine below
            p = max(p, 0.6 * u ** 4 * min(1.0, 0.34 + 0.66 * math.sqrt(min(t, 0.09) / 0.09)) * (1 - t / 0.35) ** 0.5)
        else:
            p = 1.0
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = uz(z)
        return -0.3 * u * sm((t - 0.9) / 0.1) + 1.4 * u ** 2 * sm((0.08 - t) / 0.08)

    if far:
        ts = [0, 0.04, 0.1, 0.2, 0.35, 0.55, 0.72, 0.85, 0.94, 1.0]
        levels = [keel, lambda t: -0.9, lambda t: 0.0, lambda t: sheer(t) - 0.42, sheer]
        mats = [(REDLEAD, 0), (REDLEAD, 0), (IRONHULL, 0), (IRONHULL, 0)]
    else:
        ts = [0, 0.012, 0.025, 0.04, 0.06, 0.08, 0.105, 0.13, 0.16, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6,
              0.65, 0.7, 0.75, 0.8, 0.84, 0.88, 0.91, 0.94, 0.96, 0.98, 0.99, 1.0]
        levels = [keel, lambda t: keel(t) + 0.3, lambda t: keel(t) + 0.75, lambda t: -1.05, lambda t: -0.55,
                  lambda t: -0.08, lambda t: 0.3, lambda t: 0.75, lambda t: sheer(t) - 0.42, sheer]
        mats = [(REDLEAD, 0)] * 5 + [(IRONHULL, 0)] * 4
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.5 + 0.5 * sm((p.z + 1.8) / 3.2))
    hull.outer(m)

    def zd(t):
        return sheer(t) - 0.75

    inside = GREEN if paddle else WHITE
    hull.deck(m, zd, 0, 1, 0.08, DECK)
    hull.deck(walk, zd, 0, 1, 0.08, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, inside, VARNISH)

    # --- the hull's furniture: the white (gold) line, the fender belt with its iron strip, the lower rubbing
    # strake, bulwark stays, freeing ports, the bow pudding, portholes forward, the rudder and (screw) the screw
    line_tint = (1.0, 0.8, 0.42) if paddle else (1.05, 1.05, 1.05)
    with tinted(m, line_tint):
        hull.wale(m, lambda t: sheer(t) - 0.12, 0.03, 0.985, h=0.05, out=0.012, mat=WHITE, shade=1.0)
    hull.wale(m, lambda t: zd(t) + 0.05, 0.02, 0.97, h=0.26, out=0.13, mat=DARK, shade=0.75)
    if not far:
        hull.wale(m, lambda t: zd(t) - 0.04, 0.04, 0.95, h=0.06, out=0.16, mat=IRON, shade=0.8)
        hull.wale(m, lambda t: 0.48, 0.12, 0.88, h=0.13, out=0.07, mat=DARK, shade=0.7)
        for t in [0.06 + 0.035 * k for k in range(27)]:
            if t > 0.95:
                break
            for sx in (1, -1):
                a = hull.P(t, zd(t) + 0.02, sx, 0.1)
                b = hull.P(t, sheer(t) - 0.05, sx, 0.1)
                m.beam(a, b, 0.05, 0.1, inside, side=(0, 1, 0), shade=0.8)
        for t in (0.18, 0.26, 0.38, 0.5, 0.62, 0.72):
            for sx in (1, -1):
                p = hull.P(t, zd(t) + 0.16, sx)
                n = side_normal(hull, t, zd(t) + 0.16, sx)
                panel(m, p + n * 0.004, n.cross(V(0, 0, 1)) * -1, (0, 0, 1), 0.42, 0.18, IRON, off=0.0)
        for t in (0.8, 0.84, 0.88):
            for sx in (1, -1):
                z = zd(t) - 0.35
                porthole(m, hull.P(t, z, sx) + side_normal(hull, t, z, sx) * 0.01, side_normal(hull, t, z, sx), r=0.1,
                         sides=S(10))
    stem = V(0, hull.y(1.0, sheer(1.0) - 0.3), sheer(1.0) - 0.3)
    m.tube([stem + V(-0.55, 0.35, 0.02), stem + V(-0.25, 0.0, 0), stem + V(0, -0.17, 0), stem + V(0.25, 0.0, 0),
            stem + V(0.55, 0.35, 0.02)], [0.16, 0.22, 0.25, 0.22, 0.16], S(8), ROPE, side=(0, 0, 1), smooth=False,
           cap0=True, cap1=True, urep=3, vscale=2)
    if not far:
        # rope fenders hung over the side on their lanyards, and the stern's fender
        for sx in (1, -1):
            for t in (0.18, 0.33, 0.48, 0.63, 0.76):
                if paddle and 0.35 < t < 0.6:
                    continue
                p = hull.P(t, sheer(t), sx)
                fender(m, p + V(sx * 0.02, 0, -0.02), sx, drop=0.55, r=0.11)
        sp = hull.P(0.0, sheer(0.0) - 1.08, 1)
        m.tube([V(-0.75, sp.y - 0.25, sp.z), V(0, sp.y + 0.22, sp.z), V(0.75, sp.y - 0.25, sp.z)], [0.15, 0.18, 0.15], 6,
               ROPE, side=(0, 0, 1), smooth=False, cap0=True, cap1=True, urep=3, vscale=2)
    # the rudder on its post, and for the screw tug the four-bladed screw
    if paddle:
        rud = [V(0, L / 2 - 0.05, KZ + 0.25), V(0, L / 2 + 0.85, KZ + 0.3), V(0, L / 2 + 0.95, 0.1), V(0, L / 2 + 0.25, 0.45)]
    else:
        rud = [V(0, L / 2 - 0.05, KZ + 0.75), V(0, L / 2 + 0.9, KZ + 0.8), V(0, L / 2 + 1.0, 0.15), V(0, L / 2 + 0.25, 0.5)]
    m.prism([p + V(-0.07, 0, 0) for p in rud], (0.14, 0, 0), IRON, tile=2.0)
    if not far:
        spar(m, (0, L / 2 - 0.05, KZ + 0.6), (0, L / 2 + 0.25, sheer(0.0) - 0.15), 0.07, 0.07, IRON, sides=6)
        for z in (KZ + 1.2, -0.4, 0.3):
            m.box((0, L / 2 + 0.05, z), (0.2, 0.18, 0.08), IRON)
    if not paddle:
        py = L / 2 - 0.55
        pz = -1.3
        with m.at(move(0, py, pz) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            m.lathe([(0.12, -0.32), (0.19, -0.18), (0.2, 0.0), (0.16, 0.2), (0.08, 0.3)], S(10), IRON, smooth=False,
                    cap0=True, cap1=True)
        with m.at(move(0, py - 0.7, pz) @ Matrix.Rotation(math.pi / 2, 4, "X")):
            m.lathe([(0.24, 0.0), (0.24, 0.36), (0.17, 0.42)], S(10), IRON, smooth=False, cap0=True)
        for k in range(4):
            a = math.pi / 2 * k + 0.3
            d = V(math.cos(a), 0, math.sin(a))
            s = V(-math.sin(a), 0.0, math.cos(a))
            c = V(0, py, pz)
            root, tip = c + d * 0.17, c + d * 0.88
            mid = c + d * 0.55
            q = [root - s * 0.2 + V(0, -0.08, 0), root + s * 0.2 + V(0, 0.08, 0), mid + s * 0.3 + V(0, 0.12, 0),
                 tip + s * 0.14 + V(0, 0.06, 0), tip - s * 0.12 + V(0, -0.05, 0), mid - s * 0.24 + V(0, -0.1, 0)]
            m.prism(q, (0, 0.035, 0), IRON)

    # --- the decks' gear, and what a walker cannot pass
    S0 = 0.3 if not paddle else 0.28  # the casing's after end
    S1 = 0.64 if not paddle else 0.6  # its fore end
    z0 = zd(0.45)
    cy0, cy1 = hull.y(S1, z0), hull.y(S0, z0)
    zw = z0 + 1.8 if not paddle else z0 + 1.55
    if paddle:
        _paddle_parts(m, hull, walk, blk, zd, sheer, far, S)
    else:
        # the engine casing: cream panels, dark mouldings, portholes and a door each side, a railed top
        house(m, -1.45, 1.45, cy0, cy1, z0 - 0.05, zw - 0.1, wall=WHITE, roof=DECK, over=0.1)
        blk(((0), (cy0 + cy1) / 2, z0 + 0.9), (3.0, cy1 - cy0 + 0.1, 1.8))
        if not far:
            for sx in (1, -1):
                panelled_wall(m, (sx * 1.45, cy0, 0), (sx * 1.45, cy1, 0), z0 - 0.05, zw - 0.1, (sx, 0, 0), WHITE, DARK,
                              panels=6)
                for y in (cy0 + 1.1, cy0 + 2.2, cy1 - 1.7):
                    porthole(m, (sx * 1.47, y, z0 + 1.05), (sx, 0, 0), r=0.12, sides=S(10))
                door_y = cy1 - 0.75
                panel(m, (sx * 1.452, door_y, z0 + 0.82), (0, sx, 0), (0, 0, 1), 0.66, 1.5, VARNISH, off=0.006)
                for k in (-1, 1):
                    m.beam(V(sx * 1.47, door_y + k * 0.35, z0 - 0.02), V(sx * 1.47, door_y + k * 0.35, z0 + 1.6), 0.05,
                           0.04, DARK, side=(0, 1, 0))
                m.box((sx * 1.49, door_y - 0.22, z0 + 0.8), (0.04, 0.05, 0.05), COPPER)
                lifebuoy_ring(m, (sx * 1.5, cy0 + 1.65, z0 + 1.0), (sx, 0, 0), r=0.28, tube=0.06, segs=12)
            for y, dy in ((cy0, -1), (cy1, 1)):
                panelled_wall(m, (-1.45, y, 0), (1.45, y, 0), z0 - 0.05, zw - 0.1, (0, dy, 0), WHITE, DARK, panels=3)
            # the rail round the casing top
            pts = [V(-1.5, cy0 + 1.7, zw), V(-1.5, cy1 + 0.05, zw), V(1.5, cy1 + 0.05, zw), V(1.5, cy0 + 1.7, zw)]
            for a, b in zip(pts, pts[1:]):
                for f in (0.0, 0.25, 0.5, 0.75):
                    p = a.lerp(b, f)
                    m.box(p + V(0, 0, 0.38), (0.03, 0.03, 0.76), IRON)
                m.beam(a + V(0, 0, 0.76), b + V(0, 0, 0.76), 0.045, 0.045, VARNISH, caps=False)
                m.line(a + V(0, 0, 0.38), b + V(0, 0, 0.38))
        # the wheelhouse, open behind: varnished, three windows forward, one each side, the wheel inside
        wy0, wy1 = cy0 + 0.12, cy0 + 1.6
        wz1 = zw + 1.8
        m.slab([V(-1.15, wy0, zw), V(1.15, wy0, zw), V(1.15, wy0, wz1), V(-1.15, wy0, wz1)], 0.06, VARNISH, out=(0, -1, 0))
        for sx in (1, -1):
            m.slab([V(sx * 1.15, wy0, zw), V(sx * 1.15, wy1, zw), V(sx * 1.15, wy1, wz1), V(sx * 1.15, wy0, wz1)], 0.06,
                   VARNISH, out=(sx, 0, 0))
        m.slab([V(-1.3, wy0 - 0.18, wz1 + 0.08), V(1.3, wy0 - 0.18, wz1 + 0.08), V(1.3, wy1 + 0.25, wz1 + 0.08),
                V(-1.3, wy1 + 0.25, wz1 + 0.08)], 0.08, DARK, out=(0, 0, 1))
        if not far:
            for x in (-0.68, 0.0, 0.68):
                window_pane(m, (x, wy0 - 0.06, zw + 1.25), (1, 0, 0), (0, 0, 1), 0.52, 0.62, bars=0)
            for sx in (1, -1):
                window_pane(m, (sx * 1.21, (wy0 + wy1) / 2 - 0.15, zw + 1.25), (0, sx, 0), (0, 0, 1), 0.62, 0.62, bars=1)
                panelled_wall(m, (sx * 1.21, wy0, zw), (sx * 1.21, wy1, zw), 0.0, 0.85, (sx, 0, 0), VARNISH, DARK, panels=2)
            panelled_wall(m, (-1.15, wy0 - 0.06, zw), (1.15, wy0 - 0.06, zw), 0.0, 0.85, (0, -1, 0), VARNISH, DARK, panels=3)
            # inside: the wheel on its pedestal, the binnacle, the engine-room telegraph
            m.box((0, wy0 + 0.75, zw + 0.45), (0.22, 0.3, 0.9), DARK)
            wheel_helm(m, (0, wy0 + 0.58, zw + 1.0), r=0.48)
            with m.at(move(-0.6, wy0 + 0.45, zw)):
                m.lathe([(0.12, 0.0), (0.09, 0.9), (0.16, 0.95), (0.16, 1.12), (0.03, 1.2)], S(10), COPPER, smooth=False,
                        cap1=True)
            with m.at(move(0.65, wy0 + 0.4, zw)):
                m.lathe([(0.09, 0.0), (0.06, 0.85), (0.08, 0.88)], S(8), IRON, smooth=False)
            with m.at(move(0.65, wy0 + 0.4, zw + 1.0) @ Matrix.Rotation(math.pi / 2, 4, "X")):
                m.lathe([(0.16, -0.06), (0.16, 0.06), (0.02, 0.07)], S(10), COPPER, smooth=False, cap0=True, cap1=True,
                        cap_mat=WHITE)
            # the side lights on their screens, red to port, green to starboard
            for sx, kind in ((1, 1), (-1, 2)):
                sc = V(sx * 1.45, wy0 + 0.55, wz1 - 0.35)
                m.box(sc - V(sx * 0.17, 0, 0), (0.04, 0.95, 0.6), GREEN if sx < 0 else REDLEAD)
                m.box(sc - V(0, 0, 0.32), (0.4, 0.95, 0.05), DARK)
                m.beam(V(sx * 1.15, wy0 + 0.2, wz1 - 0.67), sc + V(-sx * 0.17, 0, -0.33), 0.04, 0.04, IRON)
                lantern(m, sc + V(0, 0.15, 0), kind, bail=False)
        # the funnel: tall, thin and raked, black with the owner's red band between two white rings
        fy = hull.y(0.5, zw)
        FH = 6.4
        R = 0.52
        rake = -0.06
        with m.at(move(0, fy, zw - 0.1) @ Matrix.Rotation(rake, 4, "X")):
            m.lathe([(R + 0.1, -0.02), (R + 0.04, 0.12), (R, 0.2)], S(16), IRON, smooth=False)
            m.lathe([(R, -0.1), (R, FH), (R + 0.04, FH + 0.04), (R + 0.04, FH + 0.18), (R - 0.02, FH + 0.2),
                     (R - 0.02, FH - 0.5)], S(16), FUNNEL, urep=2, vscale=1 / FH, smooth=not far)
            if not far:
                m.lathe([(R - 0.025, FH - 0.49), (0.05, FH - 0.55)], S(16), DARK, shade=0.15, smooth=False)
                for zb in (0.555 * FH - 0.16, 0.725 * FH - 0.06):
                    m.lathe([(R + 0.006, zb), (R + 0.006, zb + 0.16)], S(16), WHITE, smooth=True, urep=2)
                m.lathe([(R + 0.035, 0.78 * FH), (R + 0.035, 0.78 * FH + 0.07)], S(16), IRON, smooth=False)
                spar(m, V(0, R + 0.12, 0.1), V(0, R + 0.12, FH - 0.3), 0.055, 0.055, COPPER, sides=6)
                spar(m, V(0, R + 0.25, 0.1), V(0, R + 0.25, 9.2 - (zw - 0.1)), 0.045, 0.045, IRON, sides=5, cap=True)
                whistle(m, V(0, R + 0.12, FH - 0.3))
        if not far:
            ft = V(0, fy - math.sin(rake) * FH * 0.78, zw + FH * 0.78)
            for dx, dy in ((1.85, 1.6), (-1.85, 1.6), (1.85, -1.5), (-1.85, -1.5)):
                t_ = 0.5 - dy / L
                p = hull.P(t_, sheer(t_), 1 if dx > 0 else -1, 0.06)
                rig(m, ft, p + V(0, 0, 0.05), 0.018)
                m.box(p + V(0, 0, 0.08), (0.05, 0.05, 0.12), IRON)
            # cowls beside the funnel, the engine-room skylight aft of it
            for sx in (1, -1):
                cowl(m, sx * 0.95, fy - 0.85, zw, h=1.15, r=0.13, sides=S(10))
            sk = (0, cy1 - 1.4, zw)
            m.box((sk[0], sk[1], zw + 0.2), (1.3, 1.6, 0.4), VARNISH)
            for sx in (1, -1):
                pts = [V(sx * 0.65, sk[1] - 0.8, zw + 0.4), V(sx * 0.65, sk[1] + 0.8, zw + 0.4), V(0, sk[1] + 0.8, zw + 0.62),
                       V(0, sk[1] - 0.8, zw + 0.62)]
                m.poly(pts, GLASS, out=(sx, 0, 1), shade=0.28, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
                for k in range(6):
                    y = sk[1] - 0.7 + 1.4 * k / 5
                    m.beam(V(sx * 0.63, y, zw + 0.42), V(0.0, y, zw + 0.64), 0.02, 0.02, COPPER)
                m.beam(V(sx * 0.66, sk[1] - 0.8, zw + 0.41), V(sx * 0.66, sk[1] + 0.8, zw + 0.41), 0.05, 0.05, VARNISH)
            m.beam(V(0, sk[1] - 0.82, zw + 0.64), V(0, sk[1] + 0.82, zw + 0.64), 0.07, 0.05, VARNISH)
        else:
            m.box((0, cy1 - 1.4, zw + 0.25), (1.3, 1.6, 0.5), VARNISH)
        m.smoke.append(V(0, fy - math.sin(rake) * (FH + 0.25), zw + math.cos(rake) * (FH + 0.25)))

        # the towing gear: the hook on its post at the casing's after end, two high towing bows, the hawser
        hy = cy1 + 0.35
        m.box((0, hy, z0 + 0.65), (0.42, 0.42, 1.3), IRON)
        blk((0, hy, z0 + 0.65), (0.5, 0.5, 1.3))
        if not far:
            m.box((0, hy, z0 + 1.32), (0.5, 0.5, 0.06), IRON, shade=1.1)
            m.beam(V(0, hy, z0 + 1.0), V(0, hy + 0.55, z0 + 1.0), 0.14, 0.14, IRON)
            m.beam(V(0, hy + 0.2, z0 + 1.0), V(0, hy + 0.2, z0 + 0.3), 0.12, 0.12, IRON)  # the spring's housing
            hook = [V(0, hy + 0.55, z0 + 1.0), V(0, hy + 0.85, z0 + 0.95), V(0, hy + 1.0, z0 + 0.75), V(0, hy + 0.95, z0 + 0.55),
                    V(0, hy + 0.8, z0 + 0.5), V(0, hy + 0.72, z0 + 0.62)]
            m.tube(hook, [0.07, 0.075, 0.075, 0.07, 0.06, 0.05], 6, IRON, side=(1, 0, 0), smooth=False, cap1=True)
            m.box((0.0, hy + 0.98, z0 + 0.95), (0.06, 0.1, 0.06), IRON)  # the slip's tongue
        for ta in ((0.2, 0.11) if not far else (0.2,)):
            wa = hull.hb(ta, sheer(ta)) - 0.12
            ya = hull.y(ta, zd(ta))
            arch = [V(wa * math.cos(math.pi * j / 10), ya, sheer(ta) + 1.3 * math.sin(math.pi * j / 10)) for j in range(11)]
            m.tube(arch, [0.075] * 11, S(6), IRON, side=(0, 1, 0), smooth=False)
            for sx in (1, -1):
                blk((sx * wa, ya, zd(ta) + 0.6), (0.25, 0.25, 1.2))
        if not far:
            # the tow hawser flaked down on the after deck, a heaving line coiled on the casing
            c = V(-0.85, hull.y(0.15, zd(0.15)), zd(0.15))
            with m.at(move(*c)):
                m.lathe([(0.15, 0.0), (0.5, 0.0), (0.53, 0.12), (0.48, 0.22), (0.18, 0.2)], S(12), ROPE, smooth=False,
                        urep=6, vscale=2)
            blk(c + V(0, 0, 0.12), (1.06, 1.06, 0.24))
            coil(m, (1.05, cy1 - 0.4, zw), 0.22)
            # the after companion to the master's cabin, its skylight, the stove pipe
            ay = hull.y(0.07, zd(0.07))
            m.box((0, ay, zd(0.07) + 0.35), (1.0, 0.95, 0.7), VARNISH)
            m.slab([V(-0.55, ay - 0.5, zd(0.07) + 0.7), V(0.55, ay - 0.5, zd(0.07) + 0.7), V(0.55, ay + 0.5, zd(0.07) + 0.82),
                    V(-0.55, ay + 0.5, zd(0.07) + 0.82)], 0.05, DARK, out=(0, 0, 1))
            blk((0, ay, zd(0.07) + 0.4), (1.0, 0.95, 0.8))
            chimney(m, 0.45, ay + 0.3, zd(0.07) + 0.8, h=0.55, r=0.07)
            m.stove(V(0.45, ay + 0.3, zd(0.07) + 1.55))

    # --- the fore deck: the mast with its lights, the windlass, the anchor, bitts, the crew's companion
    tm = 0.84
    ym = hull.y(tm, zd(tm))
    zm = zd(tm)
    spar(m, (0, ym, zm), (0, ym + 0.2, zm + 7.5), 0.11, 0.06, DARK, sides=S(8), cap=True)
    blk((0, ym, zm + 0.5), (0.35, 0.35, 1.0))
    if not far:
        for h in (0.3, 2.5, 4.7):
            with m.at(move(0, ym + 0.2 * h / 7.5, zm + h)):
                m.lathe([(0.115 - 0.006 * h, 0.0), (0.115 - 0.006 * h, 0.06)], 8, IRON, smooth=False)
        m.box((0, ym + 0.03, zm + 0.12), (0.4, 0.4, 0.24), DARK)
        spar(m, (-0.95, ym + 0.15, zm + 6.1), (0.95, ym + 0.15, zm + 6.1), 0.035, 0.03, DARK, sides=5)
        for sx in (1, -1):
            for t in (tm - 0.02, tm + 0.03):
                p = hull.P(t, sheer(t), sx, 0.05)
                rig(m, (0, ym + 0.12, zm + 5.3), p + V(0, 0, 0.05))
                m.box(p + V(0, 0, 0.1), (0.06, 0.08, 0.14), DARK)
            rig(m, (sx * 0.9, ym + 0.15, zm + 6.1), (sx * 0.25, ym + 0.1, zm + 1.0), 0.012)
        rig(m, (0, ym + 0.2, zm + 7.2), (0, hull.y(1, sheer(1)) + 0.25, sheer(1) + 0.05))
        pennant(m, (0, ym + 0.2, zm + 7.7), 1.2, h=0.2)
        # two white steaming lights one over the other: the sign of a steamer with a tow
        for h in (4.6, 5.5):
            p = V(0, ym + 0.12 * h / 7.5 - 0.22, zm + h)
            m.box(p + V(0, 0.13, -0.27), (0.08, 0.28, 0.05), IRON)
            lantern(m, p, 0)
        # the windlass and the cable to the hawse pipes, the anchor on its bill board, bitts, fairleads, cleats
        tw = 0.925
        windlass(m, 0, hull.y(tw, zd(tw)), zd(tw) + 0.32, w=1.3, r=0.17)
        blk((0, hull.y(tw, zd(tw)), zd(tw) + 0.35), (1.7, 0.45, 0.7))
        for sx in (1, -1):
            hp = hull.P(0.965, sheer(0.965) - 0.25, sx)
            with m.at(frame_at(hp, side_normal(hull, 0.965, sheer(0.965) - 0.25, sx))):
                m.lathe([(0.17, -0.02), (0.17, 0.06), (0.1, 0.07), (0.1, -0.02)], 8, IRON, smooth=False)
            rig(m, (sx * 0.5, hull.y(tw, zd(tw)), zd(tw) + 0.32), hull.P(0.96, zd(0.96) + 0.05, sx, 0.25), 0.045, IRON)
        ap = hull.P(0.77, sheer(0.77) - 0.12, -1) + V(-0.2, 0, 0)
        m.slab([hull.P(0.745, zd(0.745) - 0.9, -1) + V(-0.15, 0, 0), hull.P(0.795, zd(0.795) - 0.9, -1) + V(-0.15, 0, 0),
                hull.P(0.795, zd(0.795) - 0.25, -1) + V(-0.15, 0, 0), hull.P(0.745, zd(0.745) - 0.25, -1) + V(-0.15, 0, 0)],
               0.04, DARK, out=(-1, 0, 0))
        m.beam(hull.P(0.77, sheer(0.77), -1, 0.05), ap + V(0, 0, 0.12), 0.1, 0.1, IRON)
        anchor(m, ap, side=(1, 0, 0), size=0.55)
        for t, along in ((0.955, (1, 0, 0)), (0.06, (1, 0, 0))):
            for sx in (1, -1):
                x = sx * min(0.6, hull.hb(t, zd(t)) - 0.4)
                bitt_pair(m, x, hull.y(t, zd(t)), zd(t), along=(0, 1, 0), sides=S(10))
                blk((x, hull.y(t, zd(t)), zd(t) + 0.25), (0.35, 0.75, 0.5))
        for t in (0.03, 0.12, 0.7, 0.9):
            for sx in (1, -1):
                fairlead(m, hull.P(t, sheer(t), sx, 0.04), sx)
        for t in (0.25, 0.55, 0.78):
            for sx in (1, -1):
                cleat(m, hull.P(t, zd(t), sx, 0.3), along=(0, 1, 0))
        # the crew's companion forward, with its stove pipe
        tc = 0.77
        cy = hull.y(tc, zd(tc))
        m.box((0, cy, zd(tc) + 0.4), (0.95, 0.85, 0.8), VARNISH)
        m.slab([V(-0.52, cy - 0.47, zd(tc) + 0.86), V(0.52, cy - 0.47, zd(tc) + 0.86), V(0.52, cy + 0.47, zd(tc) + 0.8),
                V(-0.52, cy + 0.47, zd(tc) + 0.8)], 0.05, DARK, out=(0, 0, 1))
        panel(m, (0, cy + 0.426, zd(tc) + 0.36), (-1, 0, 0), (0, 0, 1), 0.55, 0.62, DARK, off=0.01)
        blk((0, cy, zd(tc) + 0.45), (0.95, 0.85, 0.9))
        chimney(m, -0.32, cy - 0.2, zd(tc) + 0.85, h=0.45, r=0.06)
        m.stove(V(-0.32, cy - 0.2, zd(tc) + 1.45))
        coil(m, (-0.75, hull.y(0.89, zd(0.89)), zd(0.89)), 0.24)
        # the bell on the fore side of the mast
        with m.at(move(0, ym - 0.2, zm + 1.6)):
            m.lathe([(0.03, 0.22), (0.1, 0.18), (0.12, 0.05), (0.14, 0.0), (0.04, 0.02)], 10, COPPER, smooth=False, cap0=True)
        m.beam(V(0, ym - 0.08, zm + 1.82), V(0, ym - 0.2, zm + 1.82), 0.03, 0.03, IRON)
    # the ensign on its staff at the stern
    fs = V(0, hull.y(0.0, sheer(0.0)) - 0.35, zd(0.0))
    spar(m, fs, fs + V(0, 0.2, 3.2), 0.045, 0.03, sides=S(6), cap=True)
    if not far:
        flag(m, fs + V(0, 0.25, 3.1), 1.2, 0.8, along=(0, 1, -0.1), kind="belgian")

    # --- the name zones (docs/boats.md), 4:1
    if not far:
        parts = {"walk": walk, "block": block}
        zones = {}
        bw, bh = 2.2, 0.55
        for sx, key in ((1, "bow_p"), (-1, "bow_s")):
            parts[f"name_{key}"] = bow_zone(hull, 0.865, sheer(0.865) - 0.42, bw, bh, sx, off=0.03)
            zones[key] = [bw, bh]
        sw, sh = 1.8, 0.45
        parts["name_stern"] = stern_zone(hull, sheer(0.0) - 0.48, sw, sh, off=0.03)
        zones["stern"] = [sw, sh]
        if paddle:
            for sx, key in ((1, "box_p"), (-1, "box_s")):
                x = sx * (PB["xout"] + 0.02)
                parts[f"name_{key}"] = box_zone(x, PB["yc"], PB["za"], PB["r0"], PB["r1"], sx, PB["half"])
                zones[key] = [round(PB["w"], 2), round(PB["r1"] - PB["r0"], 2)]
        m.children = parts
        m.extras["name_zones"] = zones
        m.children["far"] = tug(paddle, far=True)
    return m


# the paddle tug's paddle box (set by _paddle_parts, read for the box name zones)
PB = {}


def _paddle_parts(m, hull, walk, blk, zd, sheer, far, S):
    """The paddle tug amidships: paddle boxes with fans, the name band and the wheels, sponsons, the bridge, the
    shaft casing, deckhouses fore and aft of the boxes, the engine-room skylight, the buff funnel, the side lights."""
    TP = 0.47
    yc = hull.y(TP, 0)
    ZA = 0.95  # the paddle shaft over the waterline
    RB = 1.95  # the box's radius
    xin = hull.hb(TP, 0.6) + 0.02
    xout = xin + 0.97
    zdk = zd(TP)
    r0, r1 = 1.38, 1.86
    half = 0.5 * 2.0 * 4 / ((r0 + r1) / 2) / 4  # (an arc of 2.0 m at the band's middle)
    w = (r0 + r1) / 2 * 2 * half
    # the band 4:1: its height (r1 - r0) a quarter of its length
    r1 = r0 + w / 4
    PB.update(yc=yc, za=ZA, xout=xout, r0=r0, r1=r1, half=half, w=w)
    sides = S(14)
    for sx in (1, -1):
        arc = [(yc + RB * math.cos(math.pi * j / sides), ZA + RB * math.sin(math.pi * j / sides)) for j in range(sides + 1)]
        prof = [(yc + RB, zdk - 0.15)] + arc + [(yc - RB, zdk - 0.15)]
        # the outer face, the inner face, the arched cover (riveted plate)
        for x, n in ((sx * xout, sx), (sx * xin, -sx)):
            pts = [V(x, y, z) for y, z in prof]
            m.poly(pts, IRONHULL if n == sx else inside_of(sx), out=(n, 0, 0),
                   uvs=[((y - yc) / 2.0, (z - zdk) / 2.0) for y, z in prof])
        for (ya, za), (yb, zb) in zip(prof, prof[1:]):
            pts = [V(sx * xin, ya, za), V(sx * xout, ya, za), V(sx * xout, yb, zb), V(sx * xin, yb, zb)]
            mid = V(0, (ya + yb) / 2 - yc, (za + zb) / 2 - ZA)
            m.poly(pts, IRONHULL, out=(0, mid.y, mid.z), uvs=[(p.x / 1.2, (p.y + p.z) / 1.6) for p in pts])
        xf = sx * (xout + 0.01)
        # the gilt half-round moulding round the face's edge and round the hub, the fan of vent slots (the far copy too)
        with tinted(m, (1.0, 0.82, 0.45)):
            for (ya, za), (yb, zb) in zip(arc, arc[1:]):
                m.beam(V(xf + sx * 0.03, ya, za), V(xf + sx * 0.03, yb, zb), 0.07, 0.07, WHITE, side=(1, 0, 0),
                       caps=False, shade=0.9)
            hub = [(yc + 0.42 * math.cos(math.pi * j / 8), ZA + 0.42 * math.sin(math.pi * j / 8)) for j in range(9)]
            for (ya, za), (yb, zb) in zip(hub, hub[1:]):
                m.beam(V(xf + sx * 0.03, ya, za), V(xf + sx * 0.03, yb, zb), 0.06, 0.06, WHITE, side=(1, 0, 0),
                       caps=False)
            m.beam(V(xf + sx * 0.03, yc - RB, zdk + 0.05), V(xf + sx * 0.03, yc + RB, zdk + 0.05), 0.08, 0.07, WHITE,
                   side=(0, 0, 1))
            # a carved shell on the boss
            fan_c = [V(xf, yc + 0.36 * math.cos(math.pi * j / 6), ZA + 0.36 * math.sin(math.pi * j / 6)) for j in range(7)]
            m.poly([V(xf, yc, ZA)] + fan_c, WHITE, out=(sx, 0, 0), shade=0.85)
        nslot = 11
        for k in range(nslot):
            a = math.pi * (k + 0.5) / nslot
            d = V(0, math.cos(a), math.sin(a))
            e = V(0, -math.sin(a), math.cos(a))
            p0, p1 = V(xf, yc, ZA) + d * 0.5, V(xf, yc, ZA) + d * 1.25
            # the dark slot, its cream frame
            m.poly([p0 - e * 0.07, p1 - e * 0.11, p1 + e * 0.11, p0 + e * 0.07], DARK, out=(sx, 0, 0), shade=0.15)
            m.beam(p0 + e * 0.1 + V(sx * 0.02, 0, 0), p1 + e * 0.15 + V(sx * 0.02, 0, 0), 0.05, 0.04, WHITE,
                   side=(1, 0, 0))
        if not far:
            # the box's rivet seams: thin strips across the cover
            for j in range(1, sides, 2):
                a = math.pi * j / sides
                p = V(0, yc + (RB + 0.01) * math.cos(a), ZA + (RB + 0.01) * math.sin(a))
                m.beam(V(sx * xin, p.y, p.z), V(sx * xout, p.y, p.z), 0.04, 0.012, IRONHULL, side=(0, -math.sin(a), math.cos(a)))
            # the wheel under the box: two rims, the arms, the floats, the hub on the shaft
            wx = sx * (xin + xout) / 2
            for dx in (-0.36, 0.36):
                ring = [V(wx + dx, yc + 1.72 * math.cos(2 * math.pi * i / 18), ZA + 1.72 * math.sin(2 * math.pi * i / 18))
                        for i in range(18)]
                m.tube(ring, [0.035] * 18, 4, IRON, side=(1, 0, 0), closed_path=True, smooth=False)
                for i in range(10):
                    a = 2 * math.pi * (i + 0.5) / 10
                    m.beam(V(wx + dx, yc, ZA), V(wx + dx, yc + 1.7 * math.cos(a), ZA + 1.7 * math.sin(a)), 0.045, 0.03, IRON)
            for i in range(10):
                a = 2 * math.pi * (i + 0.5) / 10
                c = V(wx, yc + 1.55 * math.cos(a), ZA + 1.55 * math.sin(a))
                d = V(0, math.cos(a), math.sin(a))
                m.beam(c - d * 0.2, c + d * 0.2, 0.95, 0.06, DARK, side=(1, 0, 0), shade=0.8)
            with m.at(move(wx, yc, ZA) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
                m.lathe([(0.2, -0.4), (0.26, -0.32), (0.26, 0.32), (0.2, 0.4)], 10, IRON, smooth=False, cap0=True, cap1=True)
            m.beam(V(sx * (xin - 0.3), yc, ZA), V(sx * (xin + 0.1), yc, ZA), 0.24, 0.24, IRON)
            # the side light on the fore end of the box, screened inboard; a lifebuoy on the box
            lp = V(sx * (xout - 0.3), yc - RB * 0.6, ZA + RB * 0.8 + 0.32)
            m.box(lp - V(sx * 0.2, 0, 0), (0.04, 0.85, 0.55), REDLEAD if sx > 0 else GREEN)
            m.box(lp - V(0, 0, 0.3), (0.45, 0.85, 0.05), DARK)
            lantern(m, lp, 1 if sx > 0 else 2, bail=False)
            lifebuoy_ring(m, (sx * (xout + 0.08), yc + RB * 0.78, ZA + 0.55), (sx, 0, 0), r=0.26, tube=0.055)
        # the sponsons fore and aft of the box, with their guard beams and a short rail
        for dy in (-1, 1):
            y0 = yc + dy * RB
            y1 = yc + dy * (RB + 2.0)
            z = zdk - 0.03
            tri = [V(sx * xin, y0, z), V(sx * xout, y0, z), V(sx * xin, y1, z)]
            m.prism([p - V(0, 0, 0.14) for p in tri], (0, 0, 0.14), DECK, side_mat=DARK)
            walk.poly(tri, DECK, out=(0, 0, 1))
            m.beam(V(sx * xout, y0, z - 0.1), V(sx * (xin + 0.03), y1, z - 0.1), 0.14, 0.22, DARK, side=(0, 0, 1), shade=0.8)
            m.beam(V(sx * xout, y0, z - 0.32), V(sx * (xin - 0.1), y1 + dy * 0.5, -0.1), 0.1, 0.1, DARK, side=(0, 0, 1),
                   shade=0.6)
            if not far:
                for f in (0.0, 0.5, 1.0):
                    p = V(sx * xout, y0, z).lerp(V(sx * (xin + 0.05), y1, z), f)
                    m.box((p.x, p.y, z + 0.45), (0.04, 0.04, 0.9), IRON)
                m.beam(V(sx * xout, y0, z + 0.9), V(sx * (xin + 0.05), y1, z + 0.9), 0.07, 0.06, VARNISH, side=(0, 0, 1))
        blk((sx * (xin + xout) / 2, yc, ZA), (xout - xin + 0.1, 2 * RB + 0.1, 2.0 * RB))
    # the shaft casing across the deck, and the bridge over the boxes with the helm and the telegraphs
    zb = ZA + RB + 0.06
    m.box((0, yc, zdk + 0.4), (2 * xin, 0.8, 0.8), VARNISH, skip=("-z",))
    blk((0, yc, zdk + 0.45), (2 * xin, 0.8, 0.9))
    m.box((0, yc, zb - 0.04), (2 * xout + 0.2, 1.3, 0.08), DECK, shade=1.0)
    walk.box((0, yc, zb - 0.04), (2 * xout + 0.2, 1.3, 0.08), DECK, skip=("-z", "-x", "+x", "-y", "+y"))
    for dy in (-0.62, 0.62):
        m.beam(V(-xout, yc + dy, zb - 0.16), V(xout, yc + dy, zb - 0.16), 0.12, 0.16, DARK, side=(0, 1, 0))
    if not far:
        for dy in (-0.64, 0.64):
            for k in range(11):
                x = -xout + 2 * xout * k / 10
                m.box((x, yc + dy, zb + 0.5), (0.035, 0.035, 1.0), IRON)
            m.beam(V(-xout - 0.05, yc + dy, zb + 1.0), V(xout + 0.05, yc + dy, zb + 1.0), 0.08, 0.06, VARNISH, side=(0, 1, 0))
            m.line(V(-xout, yc + dy, zb + 0.5), V(xout, yc + dy, zb + 0.5))
        m.poly([V(-1.8, yc - 0.66, zb + 0.1), V(1.8, yc - 0.66, zb + 0.1), V(1.8, yc - 0.66, zb + 0.95),
                V(-1.8, yc - 0.66, zb + 0.95)], CANVAS, out=(0, -1, 0))
        m.box((0, yc + 0.12, zb + 0.4), (0.26, 0.3, 0.8), DARK)
        wheel_helm(m, (0, yc - 0.05, zb + 1.0), r=0.45)
        with m.at(move(-0.8, yc - 0.25, zb)):
            m.lathe([(0.1, 0.0), (0.07, 0.9), (0.15, 0.95), (0.15, 1.12), (0.02, 1.18)], 10, COPPER, smooth=False, cap1=True)
        for sx in (1, -1):
            with m.at(move(sx * (xout - 0.4), yc, zb)):
                m.lathe([(0.08, 0.0), (0.05, 0.9), (0.07, 0.93)], 8, IRON, smooth=False)
            with m.at(move(sx * (xout - 0.4), yc, zb + 1.02) @ Matrix.Rotation(math.pi / 2, 4, "X")):
                m.lathe([(0.15, -0.05), (0.15, 0.05), (0.02, 0.06)], 10, COPPER, smooth=False, cap0=True, cap1=True,
                        cap_mat=WHITE)
            # ladders up from the deck aft of the boxes
            x = sx * 1.1
            ladder_up(m, V(x, yc + 0.66 + 1.3, zd(TP - 0.07)), V(x, yc + 0.66, zb), half=0.22)
    # the deckhouses: a varnished saloon aft of the boxes with the funnel through its roof, a small house forward
    ha0, ha1 = yc + RB + 0.3, hull.y(0.18, zdk)
    hz = zd(0.3)
    house(m, -1.35, 1.35, ha0, ha1, hz - 0.03, hz + 1.85, wall=VARNISH, roof=DARK, over=0.1, roof_rise=0.08)
    blk((0, (ha0 + ha1) / 2, hz + 0.9), (2.8, ha1 - ha0 + 0.1, 1.85))
    hf0, hf1 = hull.y(0.69, zdk), yc - RB - 0.3
    hzf = zd(0.62)
    house(m, -1.2, 1.2, hf0, hf1, hzf - 0.03, hzf + 1.7, wall=VARNISH, roof=DARK, over=0.1, roof_rise=0.06)
    blk((0, (hf0 + hf1) / 2, hzf + 0.85), (2.5, hf1 - hf0 + 0.1, 1.7))
    if not far:
        for sx in (1, -1):
            for y in [ha0 + 0.55 + k * 0.85 for k in range(int((ha1 - ha0 - 0.6) / 0.85))]:
                window_pane(m, (sx * 1.36, y, hz + 1.2), (0, sx, 0), (0, 0, 1), 0.48, 0.55, bars=1)
            panelled_wall(m, (sx * 1.35, ha0, 0), (sx * 1.35, ha1, 0), hz - 0.03, hz + 1.85, (sx, 0, 0), VARNISH, DARK,
                          panels=4)
            panelled_wall(m, (sx * 1.2, hf0, 0), (sx * 1.2, hf1, 0), hzf - 0.03, hzf + 1.7, (sx, 0, 0), VARNISH, DARK,
                          panels=2)
            window_pane(m, (sx * 1.21, (hf0 + hf1) / 2, hzf + 1.15), (0, sx, 0), (0, 0, 1), 0.5, 0.5, bars=1)
        panel(m, (0, ha1 + 0.005, hz + 0.88), (-1, 0, 0), (0, 0, 1), 0.7, 1.6, DARK, off=0.01)
        panel(m, (0, hf0 - 0.005, hzf + 0.82), (1, 0, 0), (0, 0, 1), 0.66, 1.5, DARK, off=0.01)
        for x in (-0.75, 0.75):
            window_pane(m, (x, hf0 - 0.06, hzf + 1.15), (1, 0, 0), (0, 0, 1), 0.42, 0.45, bars=0)
        # the engine-room skylight on the saloon's roof, cowls, a stove pipe forward
        sy = ha0 + 2.2
        m.box((0, sy, hz + 2.05), (1.1, 1.3, 0.35), VARNISH)
        for sx in (1, -1):
            pts = [V(sx * 0.55, sy - 0.65, hz + 2.22), V(sx * 0.55, sy + 0.65, hz + 2.22), V(0, sy + 0.65, hz + 2.42),
                   V(0, sy - 0.65, hz + 2.42)]
            m.poly(pts, GLASS, out=(sx, 0, 1), shade=0.28, uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
            for k in range(5):
                y = sy - 0.55 + 1.1 * k / 4
                m.beam(V(sx * 0.53, y, hz + 2.24), V(0.0, y, hz + 2.44), 0.02, 0.02, COPPER)
        for sx in (1, -1):
            cowl(m, sx * 0.85, ha0 + 0.5, hz + 1.9, h=0.8, r=0.12)
        chimney(m, 0.6, hf0 + 0.4, hzf + 1.75, h=0.5, r=0.07)
        m.stove(V(0.6, hf0 + 0.4, hzf + 2.45))
        for sx in (1, -1):
            lifebuoy_ring(m, (sx * 1.38, ha1 - 0.55, hz + 1.0), (sx, 0, 0), r=0.27, tube=0.055)
    # the funnel: tall and buff with a black top, raked, through the saloon's roof, its steam pipe and whistle
    fy = ha0 + 0.85
    fz = hz + 1.85
    FH = 6.3
    R = 0.55
    rake = -0.07
    with m.at(move(0, fy, fz) @ Matrix.Rotation(rake, 4, "X")):
        m.lathe([(R + 0.12, 0.0), (R + 0.05, 0.12), (R, 0.2)], S(16), IRON, smooth=False)
        with tinted(m, (1.0, 0.8, 0.5)):
            m.lathe([(R, 0.0), (R, FH * 0.8)], S(16), WHITE, urep=2, vscale=1 / FH, smooth=not far)
        m.lathe([(R, FH * 0.8), (R, FH), (R + 0.04, FH + 0.04), (R + 0.04, FH + 0.18), (R - 0.02, FH + 0.2),
                 (R - 0.02, FH - 0.5)], S(16), FUNNEL, urep=2, vscale=0.6 / FH, smooth=not far)
        if not far:
            m.lathe([(R - 0.025, FH - 0.49), (0.05, FH - 0.55)], S(16), DARK, shade=0.15, smooth=False)
            m.lathe([(R + 0.035, 0.62 * FH), (R + 0.035, 0.62 * FH + 0.07)], S(16), IRON, smooth=False)
            spar(m, V(0, R + 0.13, 0.1), V(0, R + 0.13, FH - 0.25), 0.055, 0.055, COPPER, sides=6)
            spar(m, V(0, R + 0.26, 0.1), V(0, R + 0.26, 9.2 - fz), 0.045, 0.045, IRON, sides=5, cap=True)
            whistle(m, V(0, R + 0.13, FH - 0.25))
    if not far:
        ft = V(0, fy - math.sin(rake) * FH * 0.62, fz + FH * 0.62)
        for dx, dy in ((1.9, 2.2), (-1.9, 2.2), (2.0, -0.4), (-2.0, -0.4)):
            t_ = (hull.L / 2 - (fy + dy)) / hull.L
            p = hull.P(t_, sheer(t_), 1 if dx > 0 else -1, 0.06)
            rig(m, ft, p + V(0, 0, 0.05), 0.018)
    m.smoke.append(V(0, fy - math.sin(rake) * (FH + 0.25), fz + math.cos(rake) * (FH + 0.25)))
    # the towing post aft and one high towing bow
    hy = ha1 + 0.9
    m.box((0, hy, zd(0.12) + 0.6), (0.4, 0.4, 1.2), DARK)
    blk((0, hy, zd(0.12) + 0.6), (0.5, 0.5, 1.2))
    if not far:
        m.box((0, hy, zd(0.12) + 1.22), (0.5, 0.5, 0.06), IRON)
        m.beam(V(-0.4, hy, zd(0.12) + 0.85), V(0.4, hy, zd(0.12) + 0.85), 0.1, 0.1, IRON)
        hook = [V(0, hy + 0.2, zd(0.12) + 0.95), V(0, hy + 0.5, zd(0.12) + 0.9), V(0, hy + 0.62, zd(0.12) + 0.7),
                V(0, hy + 0.55, zd(0.12) + 0.52), V(0, hy + 0.42, zd(0.12) + 0.6)]
        m.tube(hook, [0.065, 0.07, 0.07, 0.06, 0.05], 6, IRON, side=(1, 0, 0), smooth=False, cap1=True)
        c = V(0.85, hull.y(0.07, zd(0.07)), zd(0.07))
        with m.at(move(*c)):
            m.lathe([(0.15, 0.0), (0.45, 0.0), (0.48, 0.11), (0.43, 0.2), (0.16, 0.18)], 12, ROPE, smooth=False, urep=6,
                    vscale=2)
        blk(c + V(0, 0, 0.1), (0.96, 0.96, 0.2))


def inside_of(sx):
    """The paddle box's inner face: the green of the bulwarks."""
    return GREEN
