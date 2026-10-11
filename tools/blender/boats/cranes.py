"""The quay cranes: the portal crane with its turning jib, and the hand crane. Not boats, but they
share the boat materials and go into boats.glb. Not part of the boats' next update.

A crane's origin is the centre of its foot on the quay; its jib looks toward -Y at rest. The part
that turns is a child node ("jib", "hand_crane_jib") with its origin on its axis. Every build checks
the crane against railway.ts foldPortal / foldHook (fold_check). The --crane-views and --crane-zfight
switches of build_boats.py set CRANE_PREVIEW, CRANE_ZFIGHT and CRANE_ZFIGHT_AT here."""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


PORTAL_TOP = 5.8
JIB_ANGLE, JIB_LEN = math.radians(40), 12.5
# The walkable parts up on a portal crane (M3g part 4). client/src/world/railway.ts carries the same
# numbers (crane frame there: x = blender x, z = -blender y) for the walk areas, the ladder and the spots.
DECK_Z = 0.62  # the gallery floor, jib frame (world PORTAL_TOP + 0.62)
CAB_FLOOR = 0.74  # the cabin floor, one step up
CAB = (-1.25, 1.25, -1.5, 1.4)  # the cabin's outside: x0, x1, y0, y1
CAB_WALL, CAB_TOP = 0.08, 3.0
CAB_DOOR = (0.35, 1.1)  # the doorway in the +x wall, along y
LADDER_Y, LADDER_HALF = 3.05, 0.23  # the rungs' plane (portal frame), the stiles either side of x = 0
# The turning deck from above: square in front (the jib heel), the back corners cut off and a tongue
# at the back that meets the ladder head when the jib is at rest. Its farthest point stays 3.0 m from
# the axis and the ladder is 3.02 m off, so the deck clears the ladder as the crane slews.
DECK_OUTLINE = [(-2.0, -1.8), (2.0, -1.8), (2.0, 1.95), (0.9, 2.7), (0.32, 2.7), (0.32, 2.97), (-0.32, 2.97),
                (-0.32, 2.7), (-0.9, 2.7), (-2.0, 1.95)]
# the gallery rail, starboard side (the port side is its mirror), 4 cm in from the edge; open at the tongue
RAIL_RIGHT = [(1.29, -1.5), (1.29, -1.76), (1.96, -1.76), (1.96, 1.93), (0.88, 2.66), (0.28, 2.66), (0.28, 2.93)]


def bar(m, a, b, r, mat=IRON, sides=6):
    """A round iron bar, closed at both ends."""
    m.tube([Vector(a), Vector(b)], [r, r], sides, mat, smooth=False, cap0=True, cap1=True, urep=1, vscale=0.5)


def wall_box(m, c, size, mat, tile=0.8, shade=1.0, skip=()):
    """A box mapped like a wall: its upright faces u along the face (horizontal), v up, its top and
    bottom by x and y, all in metres / tile. Boards painted along v stand upright."""
    cx, cy, cz = c
    sx, sy, sz = size[0] / 2, size[1] / 2, size[2] / 2
    P = [V(cx + (sx if i & 1 else -sx), cy + (sy if i & 2 else -sy), cz + (sz if i & 4 else -sz)) for i in range(8)]
    for key, idx in bp.HEX_FACES.items():
        if key in skip:
            continue
        pts = [P[i] for i in idx]
        if key in ("-z", "+z"):
            uvs = [(p.x / tile, p.y / tile) for p in pts]
        else:
            n = bp.newell(pts)
            ua = V(-n.y, n.x, 0).normalized()
            uvs = [(p.dot(ua) / tile, p.z / tile) for p in pts]
        m.face([m.vert(p) for p in pts], uvs, mat, shade, local=pts)


def crane_wall(m, along, lo, hi, t0, t1, z0, z1, holes=(), mat=BOARDS, shade=1.0):
    """A wall with thickness, along x or y from lo to hi, t0..t1 across, z0..z1 tall, with openings
    (a0, a1, z_bottom, z_top): solid boxes round each opening, so the reveals are closed too. Mapped
    as a wall (wall_box): the cabin's boards stand upright."""

    def box(a0, a1, zb, zt):
        if a1 - a0 < 1e-3 or zt - zb < 1e-3:
            return
        ca, ct = (a0 + a1) / 2, (t0 + t1) / 2
        if along == "x":
            wall_box(m, (ca, ct, (zb + zt) / 2), (a1 - a0, t1 - t0, zt - zb), mat, shade=shade)
        else:
            wall_box(m, (ct, ca, (zb + zt) / 2), (t1 - t0, a1 - a0, zt - zb), mat, shade=shade)

    a = lo
    for a0, a1, zb, zt in sorted(holes):
        box(a, a0, z0, z1)
        box(a0, a1, z0, zb)
        box(a0, a1, zt, z1)
        a = a1
    box(a, hi, z0, z1)


def window_frame(m, along, a0, a1, t, zb, zt, bars=1):
    """A dark frame in a window opening (plane at t across), glazing bars, a sill outside."""
    def piece(p, q, w, h):
        if along == "x":
            m.beam(V(p[0], t, p[1]), V(q[0], t, q[1]), w, h, DARK, side=(0, 1, 0))
        else:
            m.beam(V(t, p[0], p[1]), V(t, q[0], q[1]), w, h, DARK, side=(1, 0, 0))

    k = 0.05
    piece((a0, zb + k / 2), (a1, zb + k / 2), 0.1, k)
    piece((a0, zt - k / 2), (a1, zt - k / 2), 0.1, k)
    piece((a0 + k / 2, zb), (a0 + k / 2, zt), 0.1, k)
    piece((a1 - k / 2, zb), (a1 - k / 2, zt), 0.1, k)
    for i in range(1, bars + 1):
        a = a0 + (a1 - a0) * i / (bars + 1)
        piece((a, zb), (a, zt), 0.04, 0.03)
    zm = zb + (zt - zb) * 0.55
    piece((a0, zm), (a1, zm), 0.04, 0.03)


def crane_roof(m, xa, xb, ya, yb, z1, rise, mat=IRON):
    """A shallow arched roof over (xa..xb, ya..yb) from the eaves at z1: four panels, the gable ends
    and a ceiling under it all (the soffit outside, the ceiling inside): a closed lid."""
    xs = [xa, xa + (xb - xa) * 0.25, (xa + xb) / 2, xa + (xb - xa) * 0.75, xb]
    zs = [z1, z1 + rise * 0.75, z1 + rise, z1 + rise * 0.75, z1]
    for i in range(4):
        pts = [V(xs[i], ya, zs[i]), V(xs[i + 1], ya, zs[i + 1]), V(xs[i + 1], yb, zs[i + 1]), V(xs[i], yb, zs[i])]
        m.poly(pts, mat, out=(xs[i] + xs[i + 1] - xa - xb, 0, 1), uvs=[(p.y / 1.2, p.x / 1.2) for p in pts])
    for yy, dy in ((ya, -1), (yb, 1)):
        m.poly([V(x, yy, z) for x, z in zip(xs, zs)] + [V(xb, yy, z1 - 0.01), V(xa, yy, z1 - 0.01)], mat,
               out=(0, dy, 0), shade=0.8)
    m.poly([V(xa, ya, z1 - 0.01), V(xb, ya, z1 - 0.01), V(xb, yb, z1 - 0.01), V(xa, yb, z1 - 0.01)], WOOD,
           out=(0, 0, -1), shade=0.55)
    for xx, dx in ((xa, -1), (xb, 1)):  # the eave edges
        m.poly([V(xx, ya, z1 - 0.01), V(xx, yb, z1 - 0.01), V(xx, yb, z1), V(xx, ya, z1)], mat, out=(dx, 0, 0), shade=0.8)

    def z_at(x):
        return table(list(zip(xs, zs)), x)

    return z_at


def gear(m, x0, x1, cy, cz, r, teeth, depth=0.04):
    """A spur gear in the y-z plane, from x0 to x1."""
    pts = []
    for i in range(2 * teeth):
        rr = r if i % 2 == 0 else r - depth
        a = math.pi * i / teeth
        pts.append(V(x0, cy + rr * math.cos(a), cz + rr * math.sin(a)))
    m.prism(pts, (x1 - x0, 0, 0), IRON)


def disc_x(m, x, cy, cz, r, half, mat=IRON, sides=10):
    """A short closed cylinder on an axis along x (a drum, a flange, a flywheel)."""
    with m.at(move(x, cy, cz) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(r, -half), (r, half)], sides, mat, smooth=False, cap0=True, cap1=True, cap_mat=IRON)


def railing(m, pts, z0, h=1.0, step=0.9):
    """Posts and two rails along a path of (x, y) at deck height z0."""
    P = [V(x, y, z0) for x, y in pts]
    posts = []
    for a, b in zip(P, P[1:]):
        n = max(1, math.ceil((b - a).length / step))
        posts += [a + (b - a) * (k / n) for k in range(n)]
    posts.append(P[-1])
    for p in posts:
        m.box((p.x, p.y, z0 + (h + 0.03) / 2), (0.05, 0.05, h + 0.03), IRON)
    for zz, s in ((z0 + h, 0.05), (z0 + h * 0.5, 0.035)):
        for a, b in zip(P, P[1:]):
            t = (b - a).normalized() * 0.025
            m.beam(V(a.x, a.y, zz) - t, V(b.x, b.y, zz) + t, s, s, IRON, side=(0, 0, 1))


def crane_ladder(m, top):
    """The iron ladder up the back of the portal: two flat stiles, round rungs 0.3 m apart, stays
    to the portal frame, and a cage of hoops over the upper part. The stiles run on 1.1 m above the
    gallery floor as hand holds; the deck's tongue meets it there (portal_jib)."""
    y, hw = LADDER_Y, LADDER_HALF
    z_hand = top + 1.1
    for sx in (1, -1):
        # flat bar stiles, 70 x 22 mm, the flat side facing the climber
        m.box((sx * hw, y, (0.15 + z_hand) / 2), (0.022, 0.07, z_hand - 0.15), IRON)
    for z in np.arange(0.35, top + 0.01, 0.3):  # (their ends inside the stiles: no caps needed)
        m.tube([V(-hw, y, z), V(hw, y, z)], [0.017, 0.017], 6, IRON, smooth=False, urep=1, vscale=0.5)
    # stays back to the portal: its bottom tie, the end plate, the end girder
    for z, to in ((2.4, 2.55), (4.3, 2.47), (5.4, 2.52)):
        for sx in (1, -1):
            m.beam((sx * hw, y - 0.02, z), (sx * hw, to, z), 0.05, 0.022, IRON, side=(0, 0, 1))
        m.beam((-hw, to + 0.04, z), (hw, to + 0.04, z), 0.05, 0.022, IRON, side=(0, 1, 0))
    # the cage: flat hoops round the climber's back, and five straps up them
    cy, R = y + 0.3, 0.382
    a0 = math.atan2(-0.3, hw)
    arc = [a0 + (math.pi - 2 * a0) * k / 8 for k in range(9)]
    hoops = [3.3 + 0.7 * i for i in range(7) if 3.3 + 0.7 * i <= z_hand + 0.01]
    for z in hoops:
        pts = [V(R * math.cos(a), cy + R * math.sin(a), z) for a in arc]
        for p, q in zip(pts, pts[1:]):
            t = (q - p).normalized() * 0.012
            m.beam(p - t, q + t, 0.016, 0.06, IRON, side=(q - p).cross(V(0, 0, 1)), caps=False)
    for k in (1, 3, 4, 5, 7):
        a = arc[k]
        p = V(R * math.cos(a), cy + R * math.sin(a), 0)
        m.beam((p.x, p.y, hoops[0] - 0.03), (p.x, p.y, hoops[-1] + 0.03), 0.05, 0.014, IRON,
               side=V(-math.sin(a), math.cos(a), 0))


# --- the crane's detail pass (docs/milestones/vehicle-detail.md, 2026-09-27): a riveted iron steam crane of
# the 1870s at true size, in the same envelope. Plates carry the riveted plate texture (PLATE: rivet rows along
# the edges of each face); angle irons, flat bars and rivet heads are geometry where they are seen close.


# where the hoist rope leaves the jib head (railway.ts TIP, R_HOOK; shared/cranes.ts HOOK_R, TIP_Y), jib frame
R_TIP, TIP_Z = 11.51, 8.62


def part(m, name):
    """Mark where a named part of the model starts (for the triangle count per part)."""
    m.parts.append((name, len(m.bm.faces)))


def folds(m, a):
    """Faces from index a to now are the ones the game folds away (railway.ts foldPortal, foldHook)."""
    m.fold.append((a, len(m.bm.faces)))


def _axes(a, b, side):
    a, b = Vector(a), Vector(b)
    t = (b - a).normalized()
    if side is None:
        s = Vector((0, 0, 1)).cross(t)
        if s.length < 1e-4:
            s = Vector((1, 0, 0))
    else:
        s = Vector(side)
        s = s - t * s.dot(t)
        if s.length < 1e-4:
            s = t.orthogonal()
    s.normalize()
    return a, b, t, s, s.cross(t)


def pbeam(m, a, b, w, h, mat=PLATE, side=None, w2=None, h2=None, caps=True, shade=1.0, strap=4.0):
    """A plated member from a to b (as Mesh.beam: w across `side`, h the other way, tapering to w2, h2).
    Each long face is mapped with v across it, 0..1 (the plate texture's rivet rows run along its edges),
    and u along it, one picture (with its butt strap) every `strap` face widths."""
    a, b, t, s, k = _axes(a, b, side)
    w2 = w if w2 is None else w2
    h2 = h if h2 is None else h2
    L = (b - a).length

    def c(end, i, j):
        base, ww, hh = (b, w2, h2) if end else (a, w, h)
        return base + s * (i * ww / 2) + k * (j * hh / 2)

    for n, (i0, j0), (i1, j1), fw in ((k, (-1, 1), (1, 1), (w + w2) / 2), (-k, (1, -1), (-1, -1), (w + w2) / 2),
                                      (s, (1, 1), (1, -1), (h + h2) / 2), (-s, (-1, -1), (-1, 1), (h + h2) / 2)):
        du = L / (strap * max(fw, 0.02))
        m.poly([c(0, i0, j0), c(0, i1, j1), c(1, i1, j1), c(1, i0, j0)], mat, out=n,
               uvs=[(0, 0), (0, 1), (du, 1), (du, 0)], shade=shade)
    if caps:
        for end, sg in ((0, -1), (1, 1)):
            m.poly([c(end, -1, -1), c(end, 1, -1), c(end, 1, 1), c(end, -1, 1)], mat, out=t * sg, shade=shade * 0.9)


def pslab(m, pts, thick, out, ua, va, v0, H, mat=PLATE, strap=4.0, shade=1.0):
    """A plate: the polygon pts is its outer face (looking along out), `thick` goes inward. Both faces
    carry the plate texture, v 0..1 over the height H from v0 (along va), u along ua; edges by position."""
    P = [Vector(p) for p in pts]
    o = Vector(out).normalized()
    Q = [p - o * thick for p in P]
    ua, va = Vector(ua), Vector(va)

    def uv(p):
        return (p.dot(ua) / (strap * H), (p.dot(va) - v0) / H)

    m.poly(P, mat, out=o, uvs=[uv(p) for p in P], shade=shade)
    m.poly(Q, mat, out=-o, uvs=[uv(p) for p in Q], shade=shade)
    c = sum(P, Vector()) / len(P)
    for i in range(len(P)):
        j = (i + 1) % len(P)
        m.poly([P[i], P[j], Q[j], Q[i]], mat, out=(P[i] + P[j]) / 2 - c, shade=shade * 0.85)


def angle_iron(m, a, b, n1, n2, w=0.07, t=0.012, mat=IRON, caps=True, shade=1.0):
    """An angle iron along a -> b: its heel on that line, one leg out along n1, the other along n2,
    each leg's thickness on the side of the other leg. The second leg starts past the first one's
    thickness: no two faces share the heel (they would flicker)."""
    a, b = Vector(a), Vector(b)
    n1, n2 = Vector(n1).normalized(), Vector(n2).normalized()
    o1, o2 = n1 * (w / 2) + n2 * (t / 2), n2 * ((w + t) / 2) + n1 * (t / 2)
    m.beam(a + o1, b + o1, w, t, mat, side=n1, caps=caps, shade=shade)
    m.beam(a + o2, b + o2, w - t, t, mat, side=n2, caps=caps, shade=shade)


def flat(m, a, b, w, t, inplane, mat=IRON, caps=False, shade=1.0):
    """A flat bar from a to b, w wide along `inplane`, t thick."""
    m.beam(a, b, w, t, mat, side=inplane, caps=caps, shade=shade)


def rivets(m, a, b, out, pitch=0.1, r=0.013, h=0.011, mat=IRON):
    """Snap-headed rivets along a -> b on a face looking along `out`: little four-sided domes, their
    base on the face (no base face: nothing to flicker)."""
    a, b, o = Vector(a), Vector(b), Vector(out).normalized()
    L = (b - a).length
    n = max(1, int(round(L / pitch)))
    t = (b - a).normalized() if L > 1e-6 else o.orthogonal().normalized()
    s = o.cross(t).normalized()
    for i in range(n + 1):
        p = a + (b - a) * (i / n)
        q = [p + t * r, p + s * r, p - t * r, p - s * r]
        top = p + o * h
        for j in range(4):
            m.poly([q[j], q[(j + 1) % 4], top], mat, out=o, uvs=[(0, 0), (0.1, 0), (0.05, 0.1)], shade=1.15)


def gear_local(m, r, teeth, z0, z1, depth=0.03, mat=IRON):
    """A spur gear about the local z axis, from z0 to z1 (place it with m.at)."""
    pts = []
    for i in range(2 * teeth):
        rr = r if i % 2 == 0 else r - depth
        a = math.pi * i / teeth
        pts.append(V(rr * math.cos(a), rr * math.sin(a), z0))
    m.prism(pts, (0, 0, z1 - z0), mat)


AXIS_X = Matrix.Rotation(math.pi / 2, 4, "Y")  # local z -> x
AXIS_Y = Matrix.Rotation(-math.pi / 2, 4, "X")  # local z -> y


def ring(m, r, z0, z1, sides=10, mat=IRON):
    """An open band about the local z axis (a hoop, a turn of rope): no ends."""
    m.lathe([(r, z0), (r, z1)], sides, mat, smooth=False)


def sheave(m, r, half, spokes=6, sides=12, groove=0.02, hub=0.06, mat=IRON):
    """A spoked sheave about the local z axis: a grooved rim, a hub, flat spokes."""
    ri = r - 0.05
    m.lathe([(r, -half), (r - groove, 0), (r, half), (ri, half), (ri, -half), (r, -half)], sides, mat, smooth=False)
    m.lathe([(hub, -half - 0.01), (hub, half + 0.01)], 8, mat, smooth=False, cap0=True, cap1=True)
    for i in range(spokes):
        a = 2 * math.pi * i / spokes + math.pi / spokes
        d = V(math.cos(a), math.sin(a), 0)
        m.beam(d * (hub - 0.01), d * (ri + 0.01), 0.035, half * 1.2, mat, side=V(-d.y, d.x, 0), caps=False)


def plate_prism(m, outline, z0, z1, bottom=IRON, side=PLATE, top=IRON, top_tile=0.6):
    """A plated platform over a counter-clockwise outline: its edge band carries the plate texture
    (rivet rows along the top and bottom), the top its own material."""
    P0 = [V(x, y, z0) for x, y in outline]
    P1 = [V(x, y, z1) for x, y in outline]
    m.poly(P0, bottom, out=(0, 0, -1), tile=1.2, shade=0.6)
    m.poly(P1, top, out=(0, 0, 1), tile=top_tile)
    H = z1 - z0
    acc = 0.0
    for i in range(len(outline)):
        a, b = outline[i], outline[(i + 1) % len(outline)]
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        u0, u1 = acc / (4 * H), (acc + L) / (4 * H)
        m.poly([V(a[0], a[1], z0), V(b[0], b[1], z0), V(b[0], b[1], z1), V(a[0], a[1], z1)], side,
               out=(b[1] - a[1], a[0] - b[0], 0), uvs=[(u0, 0), (u1, 0), (u1, 1), (u0, 1)])
        acc += L


def bogie(m, x, y):
    """A travelling bogie under a leg: two side frames (a top member, horn plates round the axle boxes,
    horn stays under them), end plates, a transom under the leg's shoe with its centre pin, rail guards
    ahead of the wheels. The wheels are the game's (railway.ts craneWheelGeometry): the model's own
    are folded away. Everything here keeps out of foldPortal's reach (the band |z| 2.47..2.73 in the
    game frame, 0.3 m round the wheel centres): only the rail guards come into the band, far enough
    from the wheels."""
    for side in (1, -1):
        yy = y + side * 0.16
        pbeam(m, (x - 0.735, yy, 0.66), (x + 0.735, yy, 0.66), 0.025, 0.16, side=(0, 1, 0))
        for wx in (x - 0.42, x + 0.42):
            for dx in (-0.12, 0.12):
                m.box((wx + dx, yy, 0.39), (0.05, 0.025, 0.42), IRON)
            m.box((wx, yy, 0.195), (0.19, 0.025, 0.04), IRON)  # the horn stay, between the horns
            m.box((wx, y + side * 0.18, 0.32), (0.19, 0.06, 0.2), IRON, shade=0.9)  # the axle box
            m.box((wx, y + side * 0.225, 0.32), (0.13, 0.03, 0.13), IRON, shade=1.1)  # its lid
            rivets(m, (wx - 0.05, y + side * 0.24, 0.37), (wx + 0.05, y + side * 0.24, 0.37), (0, side, 0), pitch=0.1)
    for ex in (-1, 1):
        m.box((x + ex * 0.7375, y, 0.595), (0.025, 0.345, 0.29), PLATE, shade=0.9)  # end plate
        m.box((x + ex * 0.745, y, 0.255), (0.02, 0.07, 0.41), IRON)  # rail guard, 3 cm over the rail
        rivets(m, (x + ex * 0.75, y - 0.12, 0.66), (x + ex * 0.75, y + 0.12, 0.66), (ex, 0, 0), pitch=0.08)
    m.box((x, y, 0.645), (0.3, 0.32, 0.17), IRON, shade=0.8)  # the transom
    with m.at(move(x, y, 0)):
        m.lathe([(0.13, 0.74), (0.13, 0.78)], 10, IRON, smooth=False, cap1=True)  # the centre pin's boss
    m.box((x, y, 0.81), (0.62, 0.5, 0.06), IRON)  # the leg's shoe


def travel_gear(m, x, y):
    """The hand travelling gear on one leg (+x, +y): a crank on a bracket, a pinion driving a spur
    wheel, a chain down to the sprocket under a guard on the axle box."""
    m.box((x + 0.27, y + 0.1, 0.92), (0.2, 0.06, 0.44), IRON)  # the bracket off the leg's face
    for cz, r, n in ((1.05, 0.07, 8), (0.79, 0.19, 22)):
        bar(m, (x + 0.3, y + 0.06, cz), (x + 0.3, y + 0.3 if cz > 1 else y + 0.27, cz), 0.022)
        with m.at(move(x + 0.3, y + 0.2, cz) @ AXIS_Y):
            gear_local(m, r, n, -0.015, 0.015, depth=0.025 if r < 0.1 else 0.03)
    with m.at(move(x + 0.3, y + 0.235, 0.79) @ AXIS_Y):
        gear_local(m, 0.075, 9, -0.01, 0.01, depth=0.02)  # the sprocket
    # the crank: an arm and its handle, pointing down and out
    m.beam((x + 0.3, y + 0.29, 1.05), (x + 0.47, y + 0.29, 0.9), 0.05, 0.02, IRON, side=(0, 1, 0))
    bar(m, (x + 0.47, y + 0.28, 0.9), (x + 0.47, y + 0.37, 0.9), 0.02, DARK)
    # the chain, two strands of flat links, and the guard over the lower sprocket
    for dx in (-0.075, 0.075):
        m.beam((x + 0.3 + dx, y + 0.235, 0.79), (x + 0.42 + dx * 0.8, y + 0.235, 0.4), 0.02, 0.012, IRON, side=(0, 1, 0), caps=False)
    m.box((x + 0.42, y + 0.25, 0.36), (0.26, 0.03, 0.2), IRON, shade=0.85)


# --crane-views: the pictures show the wheels the game draws (railway.ts craneWheelGeometry), and
# boats.glb is not written
CRANE_PREVIEW = False
# --crane-zfight: list the crane's faces that share a plane (coplanar_check)
CRANE_ZFIGHT = False
CRANE_ZFIGHT_AT = None  # -- --crane-zfight-at x,y,z: print the faces of the pairs there


def preview_wheel(m):
    """railway.ts craneWheelGeometry, for the pictures only: a double-flanged tyre, six spokes, the hub
    and the axle's ends (about the local z axis)."""
    m.lathe([(0.325, -0.062), (0.3, -0.045), (0.3, 0.045), (0.325, 0.062), (0.25, 0.062), (0.25, -0.062), (0.325, -0.062)], 12,
            IRON, smooth=False)
    m.lathe([(0.075, -0.06), (0.075, 0.06)], 6, IRON, smooth=False, cap0=True, cap1=True)
    m.lathe([(0.035, -0.2), (0.035, 0.2)], 5, IRON, smooth=False, cap0=True, cap1=True)
    for i in range(6):
        a = 2 * math.pi * i / 6
        dd = V(math.cos(a), math.sin(a), 0)
        m.beam(dd * 0.07, dd * 0.26, 0.04, 0.03, IRON, side=V(-dd.y, dd.x, 0))


def portal_crane():
    """The fixed part of a quay crane: a riveted iron portal on four legs standing on bogies on
    two crane rails, straddling a railway track, with a ladder. The turning part is portal_jib().
    Detail pass (2026-09-27): plated legs with angle irons at the corners and rivet heads low down,
    lattice knee ties, plate girders with flange angles and stiffeners, bogies with horn plates,
    axle boxes and rail guards, a hand travelling gear, the lower roller path with its toothed rack,
    the king pin's boss, a cast plate on each end."""
    m = Mesh(ao=0.0)
    m.parts, m.fold = [], []
    TOP = PORTAL_TOP
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

    def leg_c(sx, sy, z):
        f = (z - 0.72) / (TOP - 0.7 - 0.72)
        return V(sx * (2.2 - 1.05 * f), sy * (2.6 - 0.25 * f), z)

    # (no rails of its own: the crane runs on the quay's runway and railway, client/src/world/tracks.ts)
    part(m, "bogies")
    for sx in (1, -1):
        for sy in (1, -1):
            bogie(m, sx * 2.2, sy * 2.6)
    travel_gear(m, 2.2, 2.6)
    part(m, "model wheels")
    a0 = len(m.bm.faces)
    for sx in (1, -1):
        for sy in (1, -1):
            for dx in (-0.42, 0.42):
                with m.at(move(sx * 2.2 + dx, sy * 2.6, 0.32) @ Matrix.Rotation(math.pi / 2, 4, "X")):
                    if CRANE_PREVIEW:
                        preview_wheel(m)
                    else:
                        m.lathe([(0.3, -0.1), (0.3, 0.1)], 8, IRON, cap0=True, cap1=True, smooth=False)
    folds(m, a0)

    part(m, "legs")
    for sx in (1, -1):
        for sy in (1, -1):
            a, b = V(sx * 2.2, sy * 2.6, 0.72), V(sx * 1.15, sy * 2.35, TOP - 0.7)
            # the leg runs up into the top girder (no seam to see the sky through)
            pbeam(m, a, b, 0.44, 0.34, side=X, w2=0.34, h2=0.3)
            _, _, t, s, k = _axes(a, b, X)
            for i in (1, -1):
                for j in (1, -1):
                    ca = a + s * (i * 0.22) + k * (j * 0.17)
                    cb = b + s * (i * 0.17) + k * (j * 0.15)
                    heel = (s * i + k * j) * 0.012
                    angle_iron(m, ca + heel, cb + heel, -s * i, -k * j, w=0.065)
                    # rivet heads on the angles of the outer faces, low down where they are seen
                    lo, hi = ca + (cb - ca) * 0.02, ca + (cb - ca) * 0.4
                    if i == sx:
                        off = s * (i * 0.012) - k * (j * 0.02)
                        rivets(m, lo + off, hi + off, s * i, pitch=0.13)
                    if k.dot(Y) * j * sy > 0:
                        off = k * (j * 0.012) - s * (i * 0.02)
                        rivets(m, lo + off, hi + off, k * j, pitch=0.13)
            # four gusset plates from the shoe up the leg's faces
            for e, half, nrm in ((s, 0.22, k), (-s, 0.22, k), (k, 0.17, s), (-k, 0.17, s)):
                p0 = a + e * half + t * (0.12 / t.z)
                h = V(e.x, e.y, 0).normalized()
                pslab(m, [p0 + nrm * 0.007, p0 + h * 0.12 + nrm * 0.007, p0 + t * 0.3 + nrm * 0.007], 0.014, nrm, h, Z, 0.84, 0.3)

    part(m, "side frames")
    for sy in (1, -1):
        y = sy * 2.5
        out = Y * sy
        # the knee tie: a lattice girder of two channels, flat bars in a zigzag on both faces
        zb, zt = 2.26, 2.56
        xe = leg_c(1, sy, 2.41).x - 0.05
        for zc in (zb, zt):
            pbeam(m, (-xe, y, zc), (xe, y, zc), 0.08, 0.1, side=Y)
        n = 10
        xs = [-xe + 0.12 + (2 * xe - 0.24) * i / n for i in range(n + 1)]
        for face in (1, -1):
            for i in range(n):
                yy = y + face * (0.046 if i % 2 == 0 else 0.058)  # neighbours cross at the chords, one on the other
                z0_, z1_ = (zb, zt) if i % 2 == 0 else (zt, zb)
                flat(m, (xs[i], yy, z0_), (xs[i + 1], yy, z1_), 0.055, 0.012, X)
        for xv in (-0.23, 0.23, -xe + 0.06, xe - 0.06):  # posts: the ladder's stays end on the middle two
            m.box((xv, y, (zb + zt) / 2), (0.06, 0.14, zt - zb), IRON)
        # gussets joining the tie to the legs, riveted
        for sx in (1, -1):
            p = leg_c(sx, sy, 2.41)
            gx = p.x - sx * 0.2
            yo = y + sy * 0.08
            pts = [V(gx - sx * 0.02, yo, 2.12), V(gx - sx * 0.42, yo, 2.19), V(gx - sx * 0.42, yo, 2.63), V(gx - sx * 0.02, yo, 2.72)]
            pslab(m, pts, 0.014, out, X, Z, 2.12, 0.6)
            for zr in (2.23, 2.41, 2.59):
                rivets(m, (gx - sx * 0.08, yo, zr), (gx - sx * 0.36, yo, zr), out, pitch=0.09)
        # the braces from the tie's ends up to the middle of the web plate: double angles, back to back
        for sx in (1, -1):
            a = V(sx * (xe - 0.1), y, zt + 0.05)
            b = V(sx * 0.07, y, TOP - 2.03)
            d = (b - a).normalized()
            nrm = V(d.z, 0, -d.x) * (1 if sx > 0 else -1)
            for f in (1, -1):
                angle_iron(m, a + Y * f * 0.004, b + Y * f * 0.004, nrm, Y * f, w=0.08, t=0.012)
        # the web plate between the legs, flange angles along its foot, stiffeners, the end girder over it
        xa = leg_c(1, sy, TOP - 2.0).x
        web = [V(-xa, y, TOP - 2.0), V(xa, y, TOP - 2.0), V(1.15, y, TOP - 0.9), V(-1.15, y, TOP - 0.9)]
        pslab(m, web, 0.06, out, X, Z, TOP - 2.0, 1.1)
        for face, yy in ((1, y), (-1, y - out.y * 0.06)):
            angle_iron(m, (-xa + 0.12, yy, TOP - 2.0), (xa - 0.12, yy, TOP - 2.0), out * face, Z, w=0.08)
            for xv in ((-0.42, 0.42) if (sy > 0 and face > 0) else (-0.95, -0.42, 0.42, 0.95)):
                angle_iron(m, (xv, yy, TOP - 1.99), (xv, yy, TOP - 0.99), out * face, X, w=0.07)
        # gusset at the braces' head, riveted
        pslab(m, [V(-0.3, y + sy * 0.026, TOP - 2.08), V(0.3, y + sy * 0.026, TOP - 2.08), V(0.18, y + sy * 0.026, TOP - 1.72),
                  V(-0.18, y + sy * 0.026, TOP - 1.72)], 0.026, out, X, Z, TOP - 2.08, 0.36)
        rivets(m, (-0.2, y + sy * 0.026, TOP - 1.9), (0.2, y + sy * 0.026, TOP - 1.9), out, pitch=0.1)
        pbeam(m, (-1.1, y, TOP - 0.5), (1.1, y, TOP - 0.5), 0.16, 0.96, side=Y)  # the end girder
        angle_iron(m, (-1.1, y + sy * 0.08, TOP - 0.98), (1.1, y + sy * 0.08, TOP - 0.98), out, Z, w=0.08)
        # the cast plate: the town and the load, on a thin raised plate
        pw, ph, px, pz = (0.64, 0.32, 0.0, TOP - 1.45) if sy < 0 else (0.46, 0.23, -0.78, TOP - 1.4)
        m.box((px, y + sy * 0.015, pz), (pw, 0.03, ph), IRON, skip=("-y",) if sy < 0 else ("+y",))
        panel(m, (px, y + sy * 0.03, pz), (1, 0, 0) if sy < 0 else (-1, 0, 0), (0, 0, 1), pw, ph, CBOARD, off=0.0)

    part(m, "top girders")
    for sx in (1, -1):
        x = sx * 1.15
        pbeam(m, (x, -2.65, TOP - 0.51), (x, 2.65, TOP - 0.51), 0.36, 0.78, side=X)  # up to the top plate's underside
        m.box((x, 0, TOP - 0.915), (0.5, 5.3, 0.03), PLATE, shade=0.7)  # its bottom flange plate
        for face in (1, -1):
            xf = x + face * 0.18
            for yv in (-1.45, 0.0, 1.45):
                angle_iron(m, (xf, yv, TOP - 0.9), (xf, yv, TOP - 0.13), X * face, Y, w=0.07)
        for sy in (1, -1):
            pts = [(x, sy * 2.35, TOP - 2.3), (x, sy * 2.35, TOP - 0.915), (x, sy * 1.1, TOP - 0.915), (x, sy * 1.9, TOP - 1.4)]
            pslab(m, [V(*p) + X * sx * 0.025 for p in pts], 0.05, X * sx, Y, Z, TOP - 2.3, 1.4)
            # a flange along its free edge
            for p, q in ((pts[0], pts[3]), (pts[3], pts[2])):
                flat(m, V(*p), V(*q), 0.14, 0.014, X, caps=True)
    # the top plate, chequered where it shows past the turning deck
    m.box((0, 0, TOP - 0.06), (3.0, 5.3, 0.12), PLATE, skip=("+z",), shade=0.8)
    m.poly([V(-1.5, -2.65, TOP), V(1.5, -2.65, TOP), V(1.5, 2.65, TOP), V(-1.5, 2.65, TOP)], CHEQUER, out=(0, 0, 1), tile=0.6)
    # the king pin's boss under the top plate, its nut
    m.lathe([(0.09, TOP - 0.52), (0.09, TOP - 0.44), (0.2, TOP - 0.42), (0.3, TOP - 0.3), (0.3, TOP - 0.12)], 12, IRON,
            smooth=False, cap0=True)

    part(m, "roller path")
    # the lower roller path on the top plate, the toothed rack round its rim
    m.lathe([(1.4, 0.0 + TOP), (1.4, 0.1 + TOP), (1.15, 0.1 + TOP), (1.15, TOP), (1.4, TOP)], 24, IRON, smooth=False, urep=3)
    T = 48
    outer = [V((1.475 if i % 2 == 0 else 1.44) * math.cos(math.pi * i / T), (1.475 if i % 2 == 0 else 1.44) * math.sin(math.pi * i / T), 0)
             for i in range(2 * T)]
    for i in range(2 * T):
        p, q = outer[i], outer[(i + 1) % (2 * T)]
        pi_, qi = p.normalized() * 1.38, q.normalized() * 1.38
        m.poly([pi_ + Z * (TOP + 0.095), p + Z * (TOP + 0.095), q + Z * (TOP + 0.095), qi + Z * (TOP + 0.095)], IRON, out=(0, 0, 1))
        m.poly([p + Z * (TOP + 0.02), q + Z * (TOP + 0.02), q + Z * (TOP + 0.095), p + Z * (TOP + 0.095)], IRON, out=p + q, shade=0.85)

    part(m, "ladder")
    crane_ladder(m, TOP + DECK_Z)
    return m


def portal_jib():
    """The turning part of the portal crane, origin on the slewing axis at the portal top:
    slewing ring, the deck with a railed gallery round the driver's cabin (walkable: M3g part 4),
    the cabin with its winch, boiler and levers, the A-frame on its roof, lattice jib, ties,
    hoist rope and hook. Detail pass (2026-09-27): the upper roller path, its rollers and the slewing
    pinion; a plated deck with chequer plate and toe boards; a boarded cabin with battens, framed
    windows, a ledged door, a tarred roof with its ridge, a stove pipe with a cowl, a whistle and a
    lamp; the boiler's fittings; a jib of angle-iron chords and flat-bar lattice on all four faces,
    a spoked head sheave in cheek plates, tie bars with eyes and turnbuckles."""
    m = Mesh(ao=0.0)
    m.parts, m.fold = [], []
    D, F = DECK_Z, CAB_FLOOR
    X, Y, Z = V(1, 0, 0), V(0, 1, 0), V(0, 0, 1)

    part(m, "slewing ring")
    # the upper roller path, the rollers between the paths, the pinion on the rack and its shaft
    m.lathe([(1.4, 0.2), (1.4, 0.32), (1.15, 0.32), (1.15, 0.2), (1.4, 0.2)], 24, IRON, smooth=False, urep=3)
    for i in range(12):
        a = 2 * math.pi * i / 12 + math.pi / 12
        d = V(math.cos(a), math.sin(a), 0)
        bar(m, d * 1.2 + Z * 0.15, d * 1.36 + Z * 0.15, 0.05, IRON, sides=6)
    with m.at(move(0, 1.545, 0)):
        gear_local(m, 0.08, 9, 0.015, 0.1, depth=0.025)
    bar(m, (0, 1.545, 0.1), (0, 1.545, 0.31), 0.03)

    part(m, "deck")
    # the deck: a plated platform, chequer plate on top, girders under it outside the ring
    plate_prism(m, DECK_OUTLINE, 0.3, D, bottom=IRON, side=PLATE, top=CHEQUER)
    for y in (-1.6, 2.2):
        pbeam(m, (-(1.9 if y < 0 else 1.6), y, 0.245), ((1.9 if y < 0 else 1.6), y, 0.245), 0.16, 0.13, side=Y)
    for sx in (1, -1):
        pbeam(m, (sx * 1.8, -1.7, 0.245), (sx * 1.8, 1.9, 0.245), 0.15, 0.11, side=X)
    # the gallery rail, open at the tongue for the ladder; toe boards outside its posts
    railing(m, RAIL_RIGHT, D)
    railing(m, [(-x, y) for x, y in RAIL_RIGHT], D)
    for mir in (1, -1):
        pts = [(mir * x, y) for x, y in RAIL_RIGHT]
        for (ax, ay), (bx_, by_) in zip(pts, pts[1:]):
            dx, dy = bx_ - ax, by_ - ay
            L = math.hypot(dx, dy)
            nx, ny = dy / L * mir, -dx / L * mir  # away from the walk (it lies left of RAIL_RIGHT)
            o = V(nx, ny, 0) * 0.034
            e = V(dx, dy, 0) / L * 0.03
            flat(m, V(ax, ay, D + 0.055) + o - e, V(bx_, by_, D + 0.055) + o + e, 0.1, 0.01, Z, caps=True)

    part(m, "cabin")
    # --- the driver's cabin: boarded walls with thickness, a doorway, open windows, a floor a step up
    x0, x1, y0, y1 = CAB
    w = CAB_WALL
    m.box((0, (y0 + y1) / 2, (D + F) / 2), (x1 - x0 - 2 * w, y1 - y0 - 2 * w, F - D), DECK, tile=1.6)
    front_win = (-0.45, 0.45, 1.55, 2.5)
    side_win = (-1.05, -0.55, 1.6, 2.25)
    door = (CAB_DOOR[0], CAB_DOOR[1], D, D + 2.0)
    leaf = (CAB_DOOR[0] - 0.76, CAB_DOOR[0] - 0.01)  # the door stands open, flat against the wall
    crane_wall(m, "x", x0, x1, y0, y0 + w, D, CAB_TOP, [front_win])
    crane_wall(m, "x", x0, x1, y1 - w, y1, D, CAB_TOP)
    crane_wall(m, "y", y0 + w, y1 - w, x1 - w, x1, D, CAB_TOP, [side_win, door])
    crane_wall(m, "y", y0 + w, y1 - w, x0, x0 + w, D, CAB_TOP, [side_win])
    for cx in (x0, x1):
        for cy in (y0, y1):
            m.box((cx, cy, (D + CAB_TOP) / 2), (0.12, 0.12, CAB_TOP - D), DARK)
    window_frame(m, "x", front_win[0], front_win[1], y0 + w / 2, front_win[2], front_win[3])
    for sx in (1, -1):
        window_frame(m, "y", side_win[0], side_win[1], sx * (x1 - w / 2), side_win[2], side_win[3], bars=0)
        # the upper sash glazed, four panes (the lower one open)
        zm = side_win[2] + (side_win[3] - side_win[2]) * 0.55
        cyw = (side_win[0] + side_win[1]) / 2
        for o in (1, -1):
            panel(m, (sx * (x1 - w / 2) + o * 0.004, cyw, (zm + side_win[3]) / 2), (0, o, 0), (0, 0, 1),
                  side_win[1] - side_win[0] - 0.08, side_win[3] - zm - 0.05, WINDOW, off=0.0)

    # outside: skirting and frieze boards, battens over the joints, trims round the windows
    def outside(along, lo, hi, t, sgn, holes, skip=()):
        tt = t + sgn * 0.01

        def bx(a0, a1, zb, zt, th=0.02, shade=0.8):
            if a1 - a0 < 0.01 or zt - zb < 0.01:
                return
            ca = (a0 + a1) / 2
            c = (ca, tt + sgn * (th - 0.02) / 2, (zb + zt) / 2) if along == "x" else (tt + sgn * (th - 0.02) / 2, ca, (zb + zt) / 2)
            size = (a1 - a0, th, zt - zb) if along == "x" else (th, a1 - a0, zt - zb)
            wall_box(m, c, size, BOARDS, shade=shade)

        a = lo
        for s0, s1 in sorted(skip):
            bx(a, s0, D + 0.01, D + 0.2)
            a = s1
        bx(a, hi, D + 0.01, D + 0.2)
        bx(lo, hi, CAB_TOP - 0.17, CAB_TOP - 0.01)
        for p in np.arange(lo + 0.18, hi - 0.1, 0.36):
            if any(s0 - 0.03 < p < s1 + 0.03 for s0, s1 in skip):
                continue
            spans = [(D + 0.2, CAB_TOP - 0.17)]
            for a0, a1, zb, zt in holes:
                if a0 - 0.09 < p < a1 + 0.09:
                    spans = [(D + 0.2, zb - 0.07), (zt + 0.07, CAB_TOP - 0.17)]
            for zb, zt in spans:
                bx(p - 0.024, p + 0.024, zb, zt, 0.036, 0.72)
        for a0, a1, zb, zt in holes:  # trims
            bx(a0 - 0.07, a0, zb, zt + 0.07, 0.03, 0.62)
            bx(a1, a1 + 0.07, zb, zt + 0.07, 0.03, 0.62)
            bx(a0, a1, zt, zt + 0.07, 0.03, 0.62)
            bx(a0 - 0.1, a1 + 0.1, zb - 0.07, zb, 0.04, 0.55)

    outside("x", x0 + 0.06, x1 - 0.06, y0, -1, [front_win])
    outside("x", x0 + 0.06, x1 - 0.06, y1, 1, [])
    outside("y", y0 + 0.06, y1 - 0.06, x1, 1, [side_win], skip=[(leaf[0] - 0.02, CAB_DOOR[1] + 0.02)])
    outside("y", y0 + 0.06, y1 - 0.06, x0, -1, [side_win])
    # the doorway's frame and the ledged door, its ledges and braces toward the gallery
    for a in CAB_DOOR:
        m.box((x1 + 0.01, a, D + 1.0), (0.1, 0.05, 2.0), DARK)
    m.box((x1 + 0.01, sum(CAB_DOOR) / 2, D + 2.02), (0.1, CAB_DOOR[1] - CAB_DOOR[0] + 0.05, 0.05), DARK)
    wall_box(m, (x1 + 0.0145, sum(leaf) / 2, D + 1.0), (0.025, leaf[1] - leaf[0], 1.96), BOARDS, shade=0.9)
    xd = x1 + 0.035
    for zl in (D + 0.25, D + 1.0, D + 1.75):
        m.box((xd, sum(leaf) / 2, zl), (0.016, leaf[1] - leaf[0] - 0.06, 0.11), DARK, shade=0.85)
    for za, zb_ in ((D + 0.3, D + 0.95), (D + 1.05, D + 1.7)):
        m.beam((xd, leaf[1] - 0.07, za), (xd, leaf[0] + 0.07, zb_), 0.09, 0.016, DARK, side=(0, 0, 1), shade=0.8)
    for zh in (D + 0.25, D + 1.75):  # hinge knuckles on the doorway's edge, a latch on the free edge
        bar(m, (x1 + 0.03, CAB_DOOR[0] - 0.005, zh - 0.07), (x1 + 0.03, CAB_DOOR[0] - 0.005, zh + 0.07), 0.018)
    m.box((xd, leaf[0] + 0.08, D + 1.17), (0.018, 0.04, 0.14), IRON)
    # the roof: tarred, a roll on the ridge, barge boards along the gables
    xa_, xb_, ya_, yb_ = x0 - 0.14, x1 + 0.14, y0 - 0.14, y1 + 0.14
    z_roof = crane_roof(m, xa_, xb_, ya_, yb_, CAB_TOP, 0.4, mat=TAR)
    bar(m, (0, ya_ - 0.03, CAB_TOP + 0.42), (0, yb_ + 0.03, CAB_TOP + 0.42), 0.035, TAR, sides=6)
    rx = [xa_, xa_ + (xb_ - xa_) * 0.25, 0.0, xa_ + (xb_ - xa_) * 0.75, xb_]
    for yy, sg in ((ya_, -1), (yb_, 1)):  # one bent board each (no two pieces meeting in one plane)
        path = [V(x_, yy + sg * 0.016, z_roof(x_) - 0.035) for x_ in rx]
        path = [path[0] + (path[0] - path[1]).normalized() * 0.02] + path[1:-1] + [path[-1] + (path[-1] - path[-2]).normalized() * 0.02]
        m.tube(path, [(0.015 * math.sqrt(2), 0.055 * math.sqrt(2))] * len(path), 4, DARK, side=(0, 1, 0), rot=math.pi / 4,
               smooth=False, cap0=True, cap1=True, shade=0.8)

    part(m, "machinery")
    # --- the machinery (the left half of the cabin; the aisle runs down the +x side to the front)
    dy, dz = -0.2, 1.25  # the winch drum's axis
    disc_x(m, -0.325, dy, dz, 0.28, 0.5, ROPE)  # the drum, wound with the hoisting rope
    with m.at(move(-0.325, dy, dz) @ AXIS_X):
        for k in range(7):  # the turns of rope proud of the drum
            zc = -0.42 + 0.14 * k
            ring(m, 0.295, zc - 0.035, zc + 0.035, 10, ROPE)
    for x in (-0.845, 0.195):
        disc_x(m, x, dy, dz, 0.38, 0.02)  # its flanges
    bar(m, (-1.0, dy, dz), (0.42, dy, dz), 0.05)
    for x in (-0.93, 0.28):  # the cast-iron cheeks
        m.slab([(x, -0.62, F), (x, 0.55, F), (x, 0.45, 1.85), (x, -0.5, 1.62)], 0.05, IRON, out=(1, 0, 0))
        rivets(m, (x + 0.001, -0.5, F + 0.08), (x + 0.001, 0.45, F + 0.08), (1, 0, 0), pitch=0.19)
    gear(m, 0.32, 0.38, dy, dz, 0.46, 20)  # the great wheel on the drum
    py, pz = 0.33, 1.55  # the crankshaft
    gear(m, 0.32, 0.38, py, pz, 0.14, 8, depth=0.03)
    bar(m, (-1.12, py, pz), (0.42, py, pz), 0.035)
    with m.at(move(-1.07, py, pz) @ AXIS_X):
        sheave(m, 0.36, 0.03, spokes=6, sides=14, groove=0.0, hub=0.07)  # the flywheel
    disc_x(m, 0.12, py, pz, 0.12, 0.025)  # the crank disc
    # the engine: a steam cylinder lying fore and aft, its rod to the crank
    with m.at(move(0.12, 0.95, pz) @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.12, -0.23), (0.12, 0.23)], 8, IRON, smooth=False, cap0=True, cap1=True)
        m.lathe([(0.14, -0.25), (0.14, -0.21)], 8, IRON, smooth=False, cap0=True, cap1=True)
        m.lathe([(0.14, 0.21), (0.14, 0.25)], 8, IRON, smooth=False, cap0=True, cap1=True)
    bar(m, (0.12, 0.72, pz), (0.12, py + 0.02, pz + 0.08), 0.022)
    m.box((0.12, 0.95, F + (pz - 0.12 - F) / 2), (0.3, 0.4, pz - 0.12 - F), IRON, shade=0.8)
    # the vertical boiler in the back corner, lagging bands, its fittings; the stove pipe through the roof
    bx, by = -0.55, 0.85
    with m.at(move(bx, by, 0)):
        m.lathe([(0.4, F), (0.4, 2.35), (0.3, 2.52), (0.1, 2.6)], 10, IRON, smooth=False, cap1=True, urep=2)
        for zb in (1.3, 1.8, 2.25):
            ring(m, 0.41, zb - 0.02, zb + 0.02, 10)
    m.box((bx + 0.4, by, 1.05), (0.05, 0.28, 0.26), DARK)  # the firehole door
    m.box((bx + 0.43, by, 1.05), (0.02, 0.06, 0.03), IRON)
    # the gauge glass with its cocks, the pressure gauge on its siphon, the safety valve and its weight
    gy = by - 0.19
    bar(m, (-0.12, gy, 1.46), (-0.12, gy, 1.74), 0.013, GLASS, sides=6)
    for zc in (1.44, 1.76):
        m.box((-0.15, gy, zc), (0.1, 0.035, 0.035), COPPER)
    bar(m, (-0.16, by + 0.1, 1.95), (-0.1, by + 0.1, 2.0), 0.01, COPPER, sides=4)
    disc_x(m, -0.09, by + 0.1, 2.06, 0.075, 0.012, COPPER, sides=10)
    m.poly([V(-0.07, by + 0.1 + 0.06 * math.cos(2 * math.pi * i / 8), 2.06 + 0.06 * math.sin(2 * math.pi * i / 8)) for i in range(8)],
           WHITE, out=(1, 0, 0), tile=0.2, shade=1.1)
    m.box((-0.068, by + 0.1, 2.08), (0.004, 0.006, 0.05), DARK)  # its hand
    with m.at(move(bx, by - 0.2, 0)):
        m.lathe([(0.035, 2.53), (0.035, 2.7), (0.05, 2.7), (0.05, 2.74)], 8, COPPER, smooth=False, cap1=True)
    m.beam((bx, by - 0.2, 2.78), (bx, by - 0.58, 2.78), 0.025, 0.02, IRON, side=(1, 0, 0))
    m.box((bx, by - 0.55, 2.74), (0.07, 0.07, 0.09), IRON)
    with m.at(move(bx, by, 2.58)):  # the stove pipe, its flashing, a cowl on three straps
        zr = z_roof(bx) - 2.58
        m.lathe([(0.085, 0.0), (0.085, zr + 0.95)], 8, IRON, smooth=False)
        m.lathe([(0.17, zr - 0.02), (0.09, zr + 0.1)], 8, IRON, smooth=False)
        m.lathe([(0.21, zr + 1.02), (0.05, zr + 1.18)], 8, IRON, smooth=False, cap0=True)
        for i in range(3):
            a = 2 * math.pi * i / 3
            d = V(math.cos(a), math.sin(a), 0)
            m.beam(d * 0.085 + Z * (zr + 0.9), d * 0.15 + Z * (zr + 1.04), 0.02, 0.008, IRON, side=V(-d.y, d.x, 0))
    ptop = V(bx, by, z_roof(bx) + 0.7)
    for ex, ey in ((0.75, 0.3), (-0.62, 0.35)):
        m.line(ptop + V(0.085 if ex > 0 else -0.085, 0, 0), V(bx + ex, by + ey, z_roof(bx + ex)))
    bar(m, (bx + 0.25, by, 2.3), (0.12, 0.95, 2.3), 0.03)  # the steam pipe to the engine, its stop valve
    bar(m, (0.12, 0.95, 2.33), (0.12, 0.95, pz + 0.1), 0.03)
    with m.at(move(-0.08, 0.915, 2.36)):
        ring(m, 0.055, -0.008, 0.008, 8, DARK)
        bar(m, (0, 0, -0.06), (0, 0, 0.0), 0.012)
    # the whistle on the roof, by the stove pipe
    wx_, wy_ = -0.2, 0.62
    zw = z_roof(wx_)
    bar(m, (wx_, wy_, zw - 0.02), (wx_, wy_, zw + 0.2), 0.016, COPPER, sides=6)
    with m.at(move(wx_, wy_, 0)):
        m.lathe([(0.03, zw + 0.2), (0.03, zw + 0.33), (0.012, zw + 0.37)], 8, COPPER, smooth=False, cap0=True, cap1=True)
    m.beam((wx_, wy_, zw + 0.24), (wx_ + 0.13, wy_, zw + 0.27), 0.012, 0.012, IRON)
    # a coal box by the boiler
    m.box((-1.08, -0.42, F + 0.14), (0.16, 0.62, 0.28), IRON, shade=0.8)
    m.box((-1.08, -0.42, F + 0.27), (0.12, 0.58, 0.04), DARK, shade=0.35)
    # the brake: a band over the left flange, and the driver's three levers on their quadrant plate
    arc = [math.radians(a) for a in range(-40, 225, 33)]
    pts = [V(-0.845, dy + 0.405 * math.cos(a), dz + 0.405 * math.sin(a)) for a in arc]
    for p, q in zip(pts, pts[1:]):
        m.beam(p, q, 0.05, 0.014, IRON, side=(1, 0, 0))
    m.box((-0.36, -0.71, F + 0.03), (0.72, 0.1, 0.06), IRON)
    for x in (-0.62, -0.36, -0.1):
        m.slab([(x, -0.66, F), (x, -0.78, F), (x, -0.76, F + 0.2), (x, -0.66, F + 0.2)], 0.02, IRON, out=(1, 0, 0))
        m.beam((x + 0.02, -0.7, F + 0.05), (x + 0.02, -0.79, F + 1.0), 0.04, 0.025, IRON, side=(1, 0, 0))
        m.box((x + 0.02, -0.795, F + 1.03), (0.05, 0.05, 0.08), DARK)
    bar(m, (-0.6, -0.72, F + 0.45), (-0.845, dy - 0.3, dz - 0.28), 0.018)
    # the driver's bench: a locker in the front corner
    m.box((-0.985, -1.11, F + 0.21), (0.33, 0.54, 0.42), DARK, shade=0.85)
    m.box((-0.98, -1.11, F + 0.44), (0.37, 0.58, 0.04), WOOD)
    # a lamp on a bracket by the front window (no light of its own: the game's lamps are elsewhere)
    lantern(m, (-0.85, y0 - 0.19, 2.5), 0)
    m.extras.pop("lamps", None)
    m.beam((-0.85, y0 - 0.01, 2.8), (-0.85, y0 - 0.19, 2.8), 0.025, 0.02, IRON)
    m.beam((-0.85, y0 - 0.01, 2.65), (-0.85, y0 - 0.12, 2.8), 0.02, 0.015, IRON)

    part(m, "a-frame and ties")
    # --- the A-frame on the roof, the lattice jib, its ties
    apex = V(0, 1.0, 5.6)
    for sx in (1, -1):
        f = V(sx * 1.1, 1.25, z_roof(sx * 1.1) - 0.05)
        pbeam(m, f, apex + V(sx * 0.07, 0, -0.08), 0.18, 0.18, side=X)
        m.box((f.x, f.y, f.z + 0.04), (0.3, 0.3, 0.05), IRON)
    f = V(0, 1.5, z_roof(0) - 0.05)
    pbeam(m, f, apex + V(0, 0.05, -0.08), 0.16, 0.16)
    m.box((f.x, f.y, f.z + 0.05), (0.28, 0.28, 0.05), IRON)
    m.box(apex + V(0, 0.02, -0.02), (0.3, 0.26, 0.2), IRON)  # the head casting
    bar(m, apex + V(-0.2, -0.1, 0.0), apex + V(0.2, -0.1, 0.0), 0.04)  # the ties' pin
    foot = V(0, -1.65, 0.7)
    d = V(0, -math.cos(JIB_ANGLE), math.sin(JIB_ANGLE))
    n = V(0, math.sin(JIB_ANGLE), math.cos(JIB_ANGLE))
    tip = foot + d * JIB_LEN
    head = tip + n * 0.1
    tie_top = tip + n * 0.32
    for sx in (1, -1):
        a = apex + V(sx * 0.14, -0.1, 0)
        b = tie_top + V(sx * 0.2, 0, 0)
        u = (b - a).normalized()
        for e, o in ((a, u), (b, -u)):  # forged eyes on the pins
            m.beam(e - o * 0.05, e + o * 0.12, 0.1, 0.03, IRON, side=V(0, -u.z, u.y))
        mid = (a + b) / 2
        bar(m, a + u * 0.1, mid - u * 0.2, 0.032, IRON, sides=6)
        bar(m, mid + u * 0.2, b - u * 0.1, 0.032, IRON, sides=6)
        m.tube([mid - u * 0.2, mid - u * 0.14, mid + u * 0.14, mid + u * 0.2], [0.03, 0.05, 0.05, 0.03], 6, IRON,
               smooth=False, cap0=True, cap1=True)  # the turnbuckle

    part(m, "jib")

    def jw(s):
        return 0.45 - 0.27 * s

    def jh(s):
        return 0.5 + 0.5 * math.sin(math.pi * s) - 0.2 * s

    N = 18  # bays of the lattice; the chords run straight over two

    def node(sx, k, s):
        return foot + d * JIB_LEN * s + X * sx * jw(s) + n * k * jh(s) / 2

    ss = [i / N for i in range(N + 1)]
    # the four chords: angle irons, their heels at the corners, the legs in the faces
    for sx in (1, -1):
        for k in (1, -1):
            for i in range(0, N, 2):
                pa, pb = node(sx, k, ss[i]), node(sx, k, ss[i + 2])
                angle_iron(m, pa, pb, -X * sx, -n * k, w=0.085, t=0.013, caps=(i == 0))
    # flat-bar lattice on all four faces, in a zigzag, and a batten across at every chord joint
    for i in range(N):
        s0, s1 = ss[i], ss[i + 1]
        z0_, z1_ = (-1, 1) if i % 2 == 0 else (1, -1)
        dd = -0.033 if i % 2 == 0 else -0.046  # (the bars of neighbouring bays cross at the nodes at two depths)
        for sx in (1, -1):  # the two sides (in the plane of the jib's depth)
            inset = X * sx * dd
            flat(m, node(sx, z0_, s0) + inset, node(sx, z1_, s1) + inset, 0.06, 0.012, n)
        for k in (1, -1):  # top and bottom
            inset = n * k * dd
            flat(m, node(z0_, k, s0) + inset, node(z1_, k, s1) + inset, 0.06, 0.012, X)
    for i in range(0, N + 1, 2):
        s = ss[i]
        for sx in (1, -1):
            inset = X * sx * -0.02
            flat(m, node(sx, -1, s) + inset, node(sx, 1, s) + inset, 0.07, 0.012, d)
        for k in (1, -1):
            inset = n * k * -0.02
            flat(m, node(-1, k, s) + inset, node(1, k, s) + inset, 0.07, 0.012, d)
    # the heel: cast shoes on the deck and the heel pin through the chords
    for sx in (1, -1):
        m.box(foot + V(sx * 0.5, 0.07, -0.1), (0.14, 0.5, 0.5), IRON)
        rivets(m, foot + V(sx * 0.571, -0.05, -0.22), foot + V(sx * 0.571, 0.25, -0.22), (sx, 0, 0), pitch=0.1)
    bar(m, foot + V(-0.6, 0, 0), foot + V(0.6, 0, 0), 0.05)
    for sx in (1, -1):  # gussets over the chords' feet
        g = [node(sx, -1, 0.0), node(sx, -1, 0.07), node(sx, 1, 0.07), node(sx, 1, 0.0)]
        pslab(m, [p + X * sx * 0.014 for p in g], 0.012, X * sx, d, n, (foot - n * 0.3).dot(n), 0.6)
    # the head: cheek plates over the chords' ends, the spoked sheave on its pin with distance pieces,
    # lugs for the ties' pin, and the crosshead where the falls are made fast
    for sx in (1, -1):
        g = [head + d * dd + n * nn for dd, nn in ((-0.62, -0.2), (-0.62, 0.22), (0.0, 0.2), (0.13, 0.08), (0.13, -0.08),
                                                     (0.0, -0.18))]
        pslab(m, [p + X * sx * 0.16 for p in g], 0.016, X * sx, d, n, (head - n * 0.2).dot(n), 0.42)
        rivets(m, head + X * sx * 0.161 - d * 0.55 - n * 0.12, head + X * sx * 0.161 - d * 0.25 - n * 0.12, X * sx, pitch=0.1)
        rivets(m, head + X * sx * 0.161 - d * 0.55 + n * 0.14, head + X * sx * 0.161 - d * 0.25 + n * 0.14, X * sx, pitch=0.1)
        lug = [tip + n * 0.1 + X * sx * 0.2 - d * 0.12, tip + n * 0.1 + X * sx * 0.2 + d * 0.1, tie_top + X * sx * 0.2 + d * 0.06,
               tie_top + X * sx * 0.2 - d * 0.06]
        pslab(m, lug, 0.02, X * sx, d, n, (tip + n * 0.1).dot(n), 0.3)
    bar(m, tie_top - X * 0.25, tie_top + X * 0.25, 0.035)
    with m.at(move(*head) @ AXIS_X):
        sheave(m, 0.35, 0.045, spokes=6, sides=14, groove=0.025, hub=0.07)
        m.lathe([(0.03, -0.19), (0.03, 0.19)], 6, IRON, smooth=False, cap0=True, cap1=True)  # the pin
        for sg in (1, -1):
            m.lathe([(0.05, sg * 0.05), (0.05, sg * 0.14)], 8, IRON, smooth=False)  # distance pieces
    cross = V(0, -R_TIP, TIP_Z + 0.045)
    for sx in (1, -1):
        m.beam(head + X * sx * 0.165, cross + X * sx * 0.165, 0.05, 0.012, IRON, side=d)
    bar(m, cross - X * 0.18, cross + X * 0.18, 0.026)
    # the hoisting rope: off the drum, out under the front window to a lead sheave at the jib heel (in
    # two brackets), up the jib and over the head sheave
    lead = V(0, -1.82, 0.95)
    with m.at(move(*lead) @ AXIS_X):
        sheave(m, 0.14, 0.025, spokes=4, sides=10, groove=0.012, hub=0.035)
    bar(m, lead - X * 0.42, lead + X * 0.42, 0.022)
    rig(m, (-0.1, dy - 0.28, dz - 0.05), lead + V(0, 0, 0.14), 0.025, IRON)
    rig(m, lead + V(0, 0, 0.14), head + n * 0.35, 0.025, IRON)

    part(m, "model hook")
    # the model's own hook, falls and sling (folded away in the game: railway.ts draws its own)
    a0, l0 = len(m.bm.faces), len(m.lines)
    hang = tip + V(0, -0.28, -0.1)
    HOOK_Z = -3.4
    for dx in (-0.08, 0.08):
        rig(m, hang + V(dx, 0, 0), V(hang.x + dx, hang.y, HOOK_Z + 0.55), 0.022, IRON)
    m.box((0, hang.y, HOOK_Z + 0.35), (0.26, 0.34, 0.48), IRON)
    hook = [V(0, hang.y, HOOK_Z + 0.1), V(0, hang.y, HOOK_Z - 0.25), V(0, hang.y + 0.12, HOOK_Z - 0.4),
            V(0, hang.y + 0.24, HOOK_Z - 0.28), V(0, hang.y + 0.24, HOOK_Z - 0.12)]
    m.tube(hook, [0.05, 0.05, 0.045, 0.04, 0.03], 4, IRON, side=(1, 0, 0), smooth=False, cap0=True, cap1=True)
    # a sling of rope under the hook
    rope_path(m, [V(-0.3, hang.y + 0.12, HOOK_Z - 1.0), V(0, hang.y + 0.12, HOOK_Z - 0.38),
                  V(0.3, hang.y + 0.12, HOOK_Z - 1.0)], 0.03, ROPE)
    folds(m, a0)
    m.fold_lines = (l0, len(m.lines))
    return m




def fold_check(m, name):
    """The game folds vertices of the crane away by where they are (railway.ts foldPortal for the
    portal, foldHook for the jib; the game frame is x, z, -y of this one). Check the model against
    those rules: every face (and rigging line) meant to fold folds whole, nothing else folds, and
    no other vertex lies within 5 mm of a rule's edge. Returns a list of problems."""
    wheels = [sx * 2.2 + dx for sx in (1, -1) for dx in (-0.42, 0.42)]

    def portal_rule(p, eps=0.0):
        x, y, z = p.x, p.z, -p.y
        if y < 0.075 + eps and abs(x) > 4.4 - eps:
            return True
        if y < 0.66 + eps and abs(abs(z) - 2.6) < 0.13 + eps:
            for wx in wheels:
                r = math.hypot(x - wx, y - 0.32)
                if abs(r - 0.3) < 0.015 + eps or r < 0.01 + eps:
                    return True
        return False

    def jib_rule(p, eps=0.0):
        x, y, z = p.x, p.z, -p.y
        return z > 10.6 - eps and abs(x) < 0.65 + eps and y < 7.9 + eps

    rule = portal_rule if name == "portal" else jib_rule
    expect = set()
    for a, b in m.fold:
        expect.update(range(a, b))
    m.bm.faces.ensure_lookup_table()
    m.bm.faces.index_update()
    bad = []
    for f in m.bm.faces:
        flags = [rule(v.co) for v in f.verts]
        near = [rule(v.co, 0.005) for v in f.verts]
        if f.index in expect:
            if not all(flags):
                bad.append(f"{name}: face {f.index} of a part the game folds does not fold whole")
        elif any(near):
            c = sum((v.co for v in f.verts), Vector()) / len(f.verts)
            bad.append(f"{name}: face {f.index} at ({c.x:.2f}, {c.y:.2f}, {c.z:.2f}) folds or lies within 5 mm of the rule")
    la, lb = getattr(m, "fold_lines", (0, 0))
    for i, (a, b) in enumerate(m.lines):
        f = rule(a) or rule(b)  # railway.ts foldHook folds a rigging line whole when one end folds
        if (la <= i < lb) != f:
            bad.append(f"{name}: rigging line {i} ({'folds' if f else 'stays'}) {tuple(round(c, 2) for c in a)}")
    return bad


def coplanar_check(m, name, one=0.005, gap=0.02, min_area=0.0004):
    """--crane-zfight: faces of the crane that lie in one plane (within `one`) or as a thin layer (within
    `gap`) facing the same way and overlap by more than min_area: they would flicker (the game's
    zfight() leaves the moving cranes out). Folded faces do not count. Returns (fights, thin) lists."""
    expect = set()
    for a, b in m.fold:
        expect.update(range(a, b))
    m.bm.faces.ensure_lookup_table()
    m.bm.faces.index_update()
    m.bm.normal_update()
    buckets = {}
    info = []
    for f in m.bm.faces:
        if f.index in expect or f.calc_area() < 1e-6:
            info.append(None)
            continue
        n = f.normal.normalized()
        p0 = f.verts[0].co
        d = n.dot(p0)
        u = n.orthogonal().normalized()
        v = n.cross(u)
        poly = [(q.co.dot(u), q.co.dot(v)) for q in f.verts]
        info.append((n, d, u, v, poly))
        key = (round(n.x * 40), round(n.y * 40), round(n.z * 40))
        buckets.setdefault(key, []).append(f.index)

    def clip(subject, clipper):
        def inside(p, a, b):
            return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0

        def inter(p, q, a, b):
            x1, y1, x2, y2, x3, y3, x4, y4 = *p, *q, *a, *b
            den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(den) < 1e-12:
                return q
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

        out = subject
        for i in range(len(clipper)):
            a, b = clipper[i], clipper[(i + 1) % len(clipper)]
            inp, out = out, []
            if not inp:
                break
            s = inp[-1]
            for e in inp:
                if inside(e, a, b):
                    if not inside(s, a, b):
                        out.append(inter(s, e, a, b))
                    out.append(e)
                elif inside(s, a, b):
                    out.append(inter(s, e, a, b))
                s = e
        return out

    def area(poly):
        return 0.5 * abs(sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1]
                             for i in range(len(poly))))

    def ccw(poly):
        s = sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly)))
        return poly if s > 0 else poly[::-1]

    fights, thin = [], []
    for key, idx in buckets.items():
        idx.sort(key=lambda i: info[i][1])
        for a_i, ia in enumerate(idx):
            na, da, ua, va, _ = info[ia]
            for ib in idx[a_i + 1:]:
                nb, db, _, _, _ = info[ib]
                if db - da > gap + 0.05:
                    break
                if na.dot(nb) < 0.9998:
                    continue
                fa, fb = m.bm.faces[ia], m.bm.faces[ib]
                pa = ccw([(q.co.dot(ua), q.co.dot(va)) for q in fa.verts])
                pb = ccw([(q.co.dot(ua), q.co.dot(va)) for q in fb.verts])
                if (max(p[0] for p in pa) < min(p[0] for p in pb) or max(p[0] for p in pb) < min(p[0] for p in pa) or
                        max(p[1] for p in pa) < min(p[1] for p in pb) or max(p[1] for p in pb) < min(p[1] for p in pa)):
                    continue
                ov = clip(pa, pb) if len(pb) >= 3 else []
                ar = area(ov) if len(ov) >= 3 else 0.0
                if ar < min_area:
                    continue
                # the gap over the overlap: face b's plane measured from face a's, at the overlap's middle
                oc = (sum(p[0] for p in ov) / len(ov), sum(p[1] for p in ov) / len(ov))
                pa3 = ua * oc[0] + va * oc[1] + na * da
                t_ = nb.dot(fb.verts[0].co - pa3) / max(nb.dot(na), 1e-6)
                if abs(t_) > gap:
                    continue
                da_, db = 0.0, abs(t_)
                c = fa.calc_center_median()
                item = (round(ar, 4), round(db, 4), tuple(round(x, 2) for x in c), MATS[fa.material_index], MATS[fb.material_index],
                        tuple(round(x, 1) for x in na))
                (fights if db <= one else thin).append(item)
                if CRANE_ZFIGHT_AT and db <= one and (c - Vector(CRANE_ZFIGHT_AT)).length < 0.15:
                    for f in (fa, fb):
                        print(f"[build_boats]     face {f.index} {MATS[f.material_index]} n {tuple(round(x, 2) for x in f.normal)} "
                              f"verts {[tuple(round(x, 3) for x in q.co) for q in f.verts]}")
    return fights, thin


def part_counts(m):
    """Triangles per named part (Mesh.parts), from the faces' corners."""
    m.bm.faces.ensure_lookup_table()
    marks = m.parts + [("end", len(m.bm.faces))]
    out = []
    for (name, a), (_, b) in zip(marks, marks[1:]):
        out.append((name, sum(len(m.bm.faces[i].verts) - 2 for i in range(a, b))))
    return out


HAND_PIVOT = 0.55


def hand_crane():
    """The fixed part of an older cast-iron hand crane: a stone block and the iron post."""
    m = Mesh(ao=0.0)
    m.box((0, 0, 0.275), (1.8, 1.8, 0.55), STONE, tile=1.0)
    m.lathe([(0.42, 0.55), (0.42, 0.62), (0.3, 0.7), (0.24, 1.3), (0.27, 1.35)], 10, IRON, smooth=False, cap1=True, urep=2)
    for a in range(4):
        c = V(0.62 * math.cos(math.pi / 4 + a * math.pi / 2), 0.62 * math.sin(math.pi / 4 + a * math.pi / 2), 0.59)
        m.box(c, (0.1, 0.1, 0.08), IRON)
    return m


def hand_jib():
    """The turning part of the hand crane (origin on the post axis, 0.55 m up): side cheeks,
    winch drum, spur gear, cranks, counterweight, a swan-neck jib of two curved iron ribs."""
    m = Mesh(ao=0.0)
    m.lathe([(0.5, 0.75), (0.5, 0.86)], 10, IRON, smooth=False, cap0=True, cap1=True, urep=2)
    for sx in (1, -1):
        m.slab([(sx * 0.36, 0.95, 0.3), (sx * 0.36, -0.55, 0.3), (sx * 0.36, -0.25, 1.95), (sx * 0.36, 0.5, 1.95)], 0.04,
               IRON, out=(sx, 0, 0))
    for y, z in ((0.45, 1.9), (-0.4, 0.4), (0.85, 0.4), (-0.25, 1.9)):
        m.beam((-0.34, y, z), (0.34, y, z), 0.06, 0.06, IRON, side=(0, 1, 0))
    m.box((0, 0.2, 0.36), (0.72, 1.4, 0.1), IRON)
    with m.at(move(0, 0.15, 1.3) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.2, -0.32), (0.2, 0.32)], 10, DARK, smooth=False, cap0=True, cap1=True, cap_mat=IRON)
    teeth = [(0.42, 0.15 + (0.48 if i % 2 == 0 else 0.43) * math.cos(math.pi * i / 12),
              1.3 + (0.48 if i % 2 == 0 else 0.43) * math.sin(math.pi * i / 12)) for i in range(24)]
    m.prism([V(*p) for p in teeth], (0.05, 0, 0), IRON)
    with m.at(move(0, 0.65, 0.95) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.03, -0.55), (0.03, 0.55)], 5, IRON, smooth=False, cap0=True, cap1=True)
        m.lathe([(0.11, 0.42), (0.11, 0.48)], 8, IRON, smooth=False, cap0=True, cap1=True)
    for sx in (1, -1):
        m.beam((sx * 0.54, 0.65, 0.95), (sx * 0.54, 0.65, 0.55), 0.05, 0.03, IRON, side=(0, 1, 0))
        m.beam((sx * 0.54, 0.65, 0.57), (sx * 0.8, 0.65, 0.57), 0.045, 0.045, DARK, side=(0, 1, 0))
    m.box((0, 1.15, 0.75), (0.8, 0.45, 0.9), IRON)
    P0, P1, P2 = V(0, -0.35, 0.45), V(0, -0.5, 4.3), V(0, -3.8, 5.25)
    path = []
    for k in range(9):
        t = k / 8
        path.append((1 - t) ** 2 * P0 + 2 * (1 - t) * t * P1 + t * t * P2)
    for sx in (1, -1):
        radii = [(0.035, 0.24 - 0.12 * k / 8) for k in range(9)]
        m.tube([p + V(sx * 0.17, 0, 0) for p in path], radii, 4, IRON, side=(1, 0, 0), smooth=False, cap0=True, cap1=True,
               urep=1, vscale=0.5)
    for k in (1, 3, 5, 7):
        m.beam(path[k] - V(0.2, 0, 0), path[k] + V(0.2, 0, 0), 0.06, 0.06, IRON, side=(0, 1, 0))
    m.beam((0, 0.45, 1.9), path[3], 0.08, 0.08, IRON)
    head = P2 + V(0, -0.12, 0.05)
    with m.at(move(*head) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.22, -0.05), (0.22, 0.05)], 8, IRON, smooth=False, cap0=True, cap1=True)
    rig(m, (0, 0.0, 1.45), path[4] + V(0, 0.1, 0), 0.02, IRON)
    hang = head + V(0, -0.2, -0.05)
    hz = 1.2
    rig(m, hang, V(0, hang.y, hz + 0.4), 0.022, IRON)
    m.box((0, hang.y, hz + 0.25), (0.14, 0.2, 0.3), IRON)
    hook = [V(0, hang.y, hz + 0.1), V(0, hang.y, hz - 0.15), V(0, hang.y + 0.1, hz - 0.27), V(0, hang.y + 0.19, hz - 0.15)]
    m.tube(hook, [0.04, 0.04, 0.035, 0.03], 4, IRON, side=(1, 0, 0), smooth=False, cap0=True, cap1=True)
    return m


def crane_checks(m, name):
    """The portal crane's parts: triangles per part, and the fold check against railway.ts (a problem
    stops the build: the game would fold a part it should not, or leave a piece of the old hook)."""
    if not hasattr(m, "fold"):
        return
    counts = part_counts(m)
    print(f"[build_boats] {name} parts: " + ", ".join(f"{k} {v}" for k, v in counts))
    if CRANE_ZFIGHT:
        fights, thin = coplanar_check(m, name)
        print(f"[build_boats] {name} coplanar: {len(fights)} in one plane, {len(thin)} thin layers")
        for it in sorted(fights, reverse=True)[:60]:
            print(f"[build_boats]   fight {it}")
    if CRANE_PREVIEW:
        return
    bad = fold_check(m, "portal" if name == "portal_crane" else "jib")
    for b in bad[:40]:
        print(f"[build_boats] FOLD {b}")
    if bad:
        raise SystemExit(f"[build_boats] {len(bad)} fold problems on {name}")
