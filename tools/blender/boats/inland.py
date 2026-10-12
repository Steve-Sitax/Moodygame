"""Inland and harbour craft of the Scheldt in the 1870s: the Rhine barge (Rijnaak), the Zeeland hengst (and under
sail), the Scheldt sloop or hoogaars (and under sail), the five Antwerp lighters (lichters) and the pontoon section.

B2, 2026-10-11 (Steve: "Remodel all boats in high detail, good textures, different names and names correctly on
boats ... no water in the boats themselves ... More differentiation"). Each builder returns a Mesh; build_boats.py
turns it into the model, its water cap and its stowed parts, and calls the Mesh's finish() for the rest of the
contract (docs/boats.md): <kind>_walk (the walkable deck, hidden), <kind>_block (boxes a walker cannot pass,
hidden), <kind>_far (the far copy, about a fifth of the triangles) and the name zones <kind>_name_bow_p, _bow_s,
_stern, with the root extra "name_zones" giving each zone's size in metres (the names atlas, lettering.py, lays its
cells out for those shapes).

What they are, from period photographs, plans and engravings of the craft (looked at for proportions only):
- the Rhine barge: a German riveted iron hull with timber rubbing wales, a long hold under arched hatch boards with
  a plank to walk the ridge, side decks, the skipper's roef aft (windows with curtains, a stovepipe, flower pots, a
  skylight, a dog's kennel and the washing out), the great tiller over the roef, a mast in its tabernacle and
  leeboards; a windlass, anchors and the crew's hatch forward;
- the hengst: a Zeeland fishing craft, round in the bow and stern, leeboards, a gaff rig of tanned sails with a
  bowsprit, the wet well (bun) amidships, the beam trawl with its iron heads along the rail, nets and baskets;
- the hoogaars: a flat-bottomed Scheldt boat with a hard chine, a straight raked stem, a short curved gaff,
  leeboards, a fore cuddy with a stove and an open well aft;
- the lighters: open harbour boats with a forepeak cuddy and stove, heavy wales, fenders, a derrick post, and each
  of the five in her own owner's colours, wear and load (empty, sacks and casks, coal, sand, timber);
- the pontoon: tarred floats under a plank deck with railings.
"""

from .common import *  # noqa: F401,F403  (the Mesh, the hull loft, the painters, the materials, the small parts)


# ------------------------------------------------------------------ the contract's children (docs/boats.md)


def _tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def far_copy(ob, name, ratio):
    """The far copy: the model's own mesh collapsed to about `ratio` of its triangles (Blender's Decimate)."""
    src = ob.data.copy()
    far = bpy.data.objects.new(name, src)
    bpy.context.scene.collection.objects.link(far)
    far.parent = ob
    mod = far.modifiers.new("far", "DECIMATE")
    mod.ratio = ratio
    mod.use_collapse_triangulate = True
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(far.evaluated_get(dg), preserve_all_data_layers=True, depsgraph=dg)
    far.modifiers.clear()
    far.data = me
    me.name = name
    bpy.data.meshes.remove(src)
    try:
        me.color_attributes.active_color = me.color_attributes["Col"]
        me.color_attributes.render_color_index = me.color_attributes.active_color_index
    except (KeyError, AttributeError):
        pass
    far.hide_render = True
    return far


def smooth_since(m, n0, angle=38.0):
    """Weld the faces made since face n0 (a hull's skin) and shade them smooth, with sharp edges where the skin turns
    more than `angle` degrees (a chine, the sheer, the stem): a round hull, not flat facets."""
    bm = m.bm
    bm.faces.ensure_lookup_table()
    faces = bm.faces[n0:]
    verts = list({v for f in faces for v in f.verts})
    bmesh.ops.remove_doubles(bm, verts=verts, dist=1e-4)
    bm.faces.ensure_lookup_table()
    faces = [f for f in bm.faces[n0:] if f.is_valid]
    lim = math.cos(math.radians(angle))
    for f in faces:
        f.smooth = True
    for e in {e for f in faces for e in f.edges}:
        lf = e.link_faces
        if len(lf) == 2 and lf[0].normal.dot(lf[1].normal) < lim:
            e.smooth = False


def hull_skin(m, hull, angle=38.0):
    """hull.outer, then smoothed."""
    m.bm.faces.ensure_lookup_table()
    n0 = len(m.bm.faces)
    hull.outer(m)
    smooth_since(m, n0, angle)


class Contract:
    """The hidden parts and the name zones of one model, collected while it is built; finish() makes them children
    of the model's object (called by build_boats.hull_parts, for the model and for its _bare copy)."""

    def __init__(self, m, far=0.2):
        self.walk = Mesh(ao=0.0)
        self.block = Mesh(ao=0.0)
        self.zones = {}
        self.sizes = {}
        self.cols = {}
        self.far = far
        m.finish = self.finish
        m.contract = self

    # walkable surfaces: faces looking up
    def floor(self, pts):
        self.walk.poly([Vector(p) for p in pts], DECK, out=(0, 0, 1))

    def deck(self, hull, zfn, t0, t1, inset=0.0, x0=None):
        """A strip of deck from t0 to t1 between the rails (or, with x0, only outside |x| > x0)."""
        T = hull.span(t0, t1)
        for ta, tb in zip(T, T[1:]):
            a, b = hull.P(ta, zfn(ta), 1, inset), hull.P(tb, zfn(tb), 1, inset)
            if x0 is None:
                self.floor([mirror(a, -1), a, b, mirror(b, -1)])
            else:
                if a.x <= x0 + 0.05 or b.x <= x0 + 0.05:
                    continue
                for sx in (1, -1):
                    pa, pb = mirror(a, sx), mirror(b, sx)
                    self.floor([V(sx * x0, pa.y, pa.z), pa, pb, V(sx * x0, pb.y, pb.z)])

    def top(self, c, size):
        """The top of a box (a hatch, a cabin roof) as a walkable face."""
        cx, cy, cz = c
        w, d = size[0] / 2, size[1] / 2
        self.floor([V(cx - w, cy - d, cz), V(cx + w, cy - d, cz), V(cx + w, cy + d, cz), V(cx - w, cy + d, cz)])

    # what a walker cannot pass
    def solid(self, c, size):
        self.block.box(c, size, DARK)

    def post(self, a, b, w):
        a, b = Vector(a), Vector(b)
        lo = V(min(a.x, b.x) - w / 2, min(a.y, b.y) - w / 2, min(a.z, b.z))
        hi = V(max(a.x, b.x) + w / 2, max(a.y, b.y) + w / 2, max(a.z, b.z))
        self.solid((lo + hi) / 2, hi - lo)

    # the name zones
    def _strip(self, key, cols, h, w):
        """A zone from columns of (bottom, top, outward normal), in reading order (u = 0 at the reader's left)."""
        zm = Mesh(ao=0.0)
        acc = [0.0]
        for (b0, _t0, _n0), (b1, _t1, _n1) in zip(cols, cols[1:]):
            acc.append(acc[-1] + (b1 - b0).length)
        tot = acc[-1] or 1.0
        for i in range(len(cols) - 1):
            (b0, t0, n0), (b1, t1, n1) = cols[i], cols[i + 1]
            u0, u1 = acc[i] / tot, acc[i + 1] / tot
            out = (n0 + n1).normalized()
            zm.poly([b0, b1, t1, t0], DARK, out=out, uvs=[(u0, 0), (u1, 0), (u1, 1), (u0, 1)])
        self.zones[key] = zm
        self.sizes[key] = (w, h)
        self.cols[key] = cols

    def plank(self, m, key, depth=0.06, margin=0.04, mat=TAR):
        """A plank behind a zone (the lighters' name boards), following it, a margin larger all round."""
        cols = self.cols[key]
        F, Bk = [], []
        for k, (b, t, n) in enumerate(cols):
            up = (t - b).normalized()
            along = (cols[min(k + 1, len(cols) - 1)][0] - cols[max(k - 1, 0)][0]).normalized()
            ext = along * (margin if k == len(cols) - 1 else -margin if k == 0 else 0.0)
            b2, t2 = b - up * margin + ext - n * 0.007, t + up * margin + ext - n * 0.007
            F.append((b2, t2))
            Bk.append((b2 - n * depth, t2 - n * depth))
        for k in range(len(cols) - 1):
            (fb0, ft0), (fb1, ft1) = F[k], F[k + 1]
            (bb0, bt0), (bb1, bt1) = Bk[k], Bk[k + 1]
            nrm = cols[k][2]
            m.poly([fb0, fb1, ft1, ft0], mat, out=nrm, shade=0.7)
            m.poly([ft0, ft1, bt1, bt0], mat, out=(ft0 - fb0), shade=0.8)
            m.poly([fb0, fb1, bb1, bb0], mat, out=(fb0 - ft0), shade=0.5)
        for k, s_ in ((0, -1), (len(cols) - 1, 1)):
            (fb, ft), (bb, bt) = F[k], Bk[k]
            a = (F[min(k + 1, len(F) - 1)][0] - F[max(k - 1, 0)][0]) * s_
            m.poly([fb, ft, bt, bb], mat, out=a, shade=0.6)

    def hull_board(self, key, hull, t_mid, zc, w, h, sx, off=0.03, n=16):
        """A name zone painted on the hull side round station t_mid, following the planking: w long, h high, its
        centre zc above the waterline. Port (+x) reads bow to stern, starboard stern to bow."""
        ta, tb = _span_by_length(hull, zc, sx, t_mid, w)
        ts = [ta + (tb - ta) * i / n for i in range(n + 1)]
        if sx > 0:
            ts = ts[::-1]  # port: from the bow (high t) aft
        cols = []
        for k, t in enumerate(ts):
            e = 0.004
            tan = hull.P(min(1.0, t + e), zc, sx) - hull.P(max(0.0, t - e), zc, sx)
            if sx > 0:
                tan = -tan
            bot, top = hull.P(t, zc - h / 2, sx), hull.P(t, zc + h / 2, sx)
            nrm = tan.cross(top - bot).normalized()
            cols.append((bot + nrm * off, top + nrm * off, nrm))
        self._strip(key, cols, h, w)

    def stern_board(self, key, hull, zc, w, h, off=0.03, n=16):
        """The stern zone wrapped round a round stern from the port quarter to the starboard quarter (a reader
        astern sees it left to right): w long round the curve, h high."""
        tq = _stern_reach(hull, zc, w)
        path = [(t, 1) for t in [tq * (1 - i / (n // 2)) for i in range(n // 2)]] + \
               [(t, -1) for t in [tq * i / (n // 2) for i in range(n // 2 + 1)]]
        cols = []
        pts = [hull.P(t, zc, sx) for t, sx in path]
        for k, (t, sx) in enumerate(path):
            a = pts[max(0, k - 1)]
            b = pts[min(len(pts) - 1, k + 1)]
            tan = b - a
            bot, top = hull.P(t, zc - h / 2, sx), hull.P(t, zc + h / 2, sx)
            nrm = tan.cross(top - bot).normalized()
            cols.append((bot + nrm * off, top + nrm * off, nrm))
        self._strip(key, cols, h, w)

    def flat_board(self, key, c, right, up, w, h, off=0.0):
        """A flat zone (a name plank): centre c, the reader's right and up."""
        c, r, u = Vector(c), Vector(right).normalized(), Vector(up).normalized()
        nrm = r.cross(u)
        c = c + nrm * off
        cols = [(c - r * w / 2 - u * h / 2, c - r * w / 2 + u * h / 2, nrm), (c + r * w / 2 - u * h / 2, c + r * w / 2 + u * h / 2, nrm)]
        self._strip(key, cols, h, w)

    def finish(self, name, ob, objs):
        n = 0
        for key, zm in self.zones.items():
            ch = to_object(zm, f"{name}_name_{key}", parent=ob)
            objs[ch.name] = ch
            n += _tris(ch)
        if self.sizes:
            ob["name_zones"] = {k: [round(w, 3), round(h, 3)] for k, (w, h) in self.sizes.items()}
        for suffix, mesh in (("walk", self.walk), ("block", self.block)):
            if len(mesh.bm.faces):
                bmesh.ops.triangulate(mesh.bm, faces=mesh.bm.faces[:])
                ch = to_object(mesh, f"{name}_{suffix}", parent=ob)
                ch.hide_render = True
                objs[ch.name] = ch
        if self.far:
            far = far_copy(ob, f"{name}_far", self.far)
            objs[far.name] = far
        return n


def _span_by_length(hull, z, sx, t_mid, w, dt=0.0004):
    def walk(d):
        t, s, p = t_mid, 0.0, hull.P(t_mid, z, sx)
        while s < w / 2 and 0.0 <= t + d * dt <= 1.0:
            q = hull.P(t + d * dt, z, sx)
            s += (q - p).length
            p, t = q, t + d * dt
        return t
    return walk(-1), walk(1)


def _stern_reach(hull, z, w, dt=0.0004):
    """The station on each quarter where a board w long, wrapped round the stern at height z, ends."""
    t, s, p = 0.0, 0.0, hull.P(0.0, z, 1)
    s = (p - hull.P(0.0, z, -1)).length / 2
    while s < w / 2 and t < 0.3:
        q = hull.P(t + dt, z, 1)
        s += (q - p).length
        p, t = q, t + dt
    return t


# ------------------------------------------------------------------ parts every craft here uses


def leeboard(m, pivot, length, width, sx, angle=0.52, mat=None):
    """A Dutch leeboard (zwaard) hung on the gunwale and swung up: a pear of planks, thicker at its head, with
    iron straps across it and an iron head plate on its pivot bolt. angle: below horizontal."""
    mat = TAR if mat is None else mat
    pivot = Vector(pivot)
    d = V(0, math.cos(angle), -math.sin(angle))
    e = V(0, math.sin(angle), math.cos(angle))
    o = V(sx, 0, 0)
    prof = []
    for k in range(13):
        f = k / 12
        a = length * f
        b = width * (0.12 + 0.38 * math.sin(math.pi * min(1.0, f * 1.08) / 2) ** 1.4) if f < 0.98 else width * 0.3
        prof.append((a, b))
    outline = [(a, -b) for a, b in prof] + [(a, b) for a, b in reversed(prof)]
    pts = [pivot + d * a + e * b for a, b in outline]
    th = 0.1
    m.prism(pts, o * th, mat, tile=2.0, side_mat=DARK)
    # the straps (iron bands across the boards) and the head plate round the pivot
    for f in (0.3, 0.58, 0.84):
        a = length * f
        b = width * (0.12 + 0.38 * math.sin(math.pi * min(1.0, f * 1.08) / 2) ** 1.4)
        p0, p1 = pivot + d * a - e * b, pivot + d * a + e * b
        m.beam(p0 + o * (th + 0.012), p1 + o * (th + 0.012), 0.07, 0.02, IRON, side=d)
    m.box(pivot + o * (th + 0.015) + d * 0.18, (0.03, 0.34, 0.3), IRON)
    with m.at(move(*(pivot + o * (th + 0.04))) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        m.lathe([(0.06, -0.03), (0.06, 0.03)], 6, IRON, smooth=False, cap1=True)
    return pivot + d * length * 0.92 + o * th


def rudder(m, ys, k0, ztop, chord, head, mat=TAR, straps=3, stock_r=0.09, rake=0.0, post=None, cap=None):
    """A Dutch outboard rudder hung on the sternpost: its blade from the keel up past the waterline, chord long at
    the foot, its after edge curving up to the head; thick at the post, thin aft; iron straps across it and the
    pintles round the post; the stock up to `head` with a painted cap. post(z): the sternpost's y at height z
    (default ys)."""
    post = post or (lambda z: ys)
    H = ztop - k0
    neck = max(0.22, stock_r * 3.2)
    prof = [(0.0, k0 + 0.02), (chord * 0.55, k0 + 0.02), (chord * 0.92, k0 + 0.05), (chord * 1.04, k0 + 0.25 * H),
            (chord * 1.0, k0 + 0.55 * H), (chord * 0.84, k0 + 0.8 * H), (chord * 0.55, ztop - 0.02),
            (neck * 1.25, ztop + 0.18), (neck, ztop + 0.3), (neck, head - 0.2), (0.0, head - 0.14)]

    def th(a):
        return 0.17 - 0.09 * min(1.0, a / max(chord, 0.1))

    L_, R_ = [], []
    for a, z in prof:
        y = post(z) + a
        L_.append(V(-th(a) / 2, y, z))
        R_.append(V(th(a) / 2, y, z))
    m.poly(L_, mat, out=(-1, 0, 0), uvs=[(p.y / 1.6, p.z / 1.6) for p in L_])
    m.poly(R_, mat, out=(1, 0, 0), uvs=[(-p.y / 1.6, p.z / 1.6) for p in R_])
    n = len(prof)
    for i in range(n):
        j = (i + 1) % n
        q = [L_[i], L_[j], R_[j], R_[i]]
        mid = (L_[i] + L_[j]) / 2
        c = V(0, post(mid.z) + chord * 0.45, k0 + H * 0.45)
        m.poly(q, DARK, out=mid - c, shade=0.7)
    # the stock: a square timber from the blade to the head, its painted cap
    z0 = head - 0.3
    m.beam((0, post(z0) + 0.1, z0), (0, post(z0) + 0.1 + rake, head), stock_r * 2, stock_r * 2, DARK)
    m.box((0, post(z0) + 0.1 + rake, head + 0.05), (stock_r * 2.4, stock_r * 2.4, 0.1), GREEN if cap is None else cap)
    m.box((0, post(z0) + 0.1 + rake, head + 0.11), (stock_r * 1.6, stock_r * 1.6, 0.04), WHITE)
    for k in range(straps):
        z = k0 + 0.15 + (H - 0.25) * (k + 0.5) / straps
        f = (z - k0) / H
        reach = chord * (1.0 - 0.45 * f)
        for sx in (1, -1):
            m.box((sx * (th(reach * 0.45) / 2 + 0.01), post(z) + reach * 0.45, z), (0.016, reach * 0.9, 0.06), IRON)
        m.box((0, post(z) - 0.04, z), (0.22, 0.12, 0.07), IRON)  # the pintle round the post


def put_over(m, y_axis, angle):
    """Turn what is built inside about the upright through the rudder stock (x 0, y y_axis): a moored craft lies with
    her helm lashed over a little, which also shows the name on her stern past the rudder."""
    return m.at(move(0, y_axis, 0) @ rot_z(angle) @ move(0, -y_axis, 0))


def tiller(m, a, b, w=0.12, droop=0.0, mat=DARK):
    """A tiller from the rudder head a forward to b, tapering, its end turned a little down."""
    a, b = Vector(a), Vector(b)
    mid = a.lerp(b, 0.7) + V(0, 0, 0.04)
    m.beam(a, mid, w, w * 1.15, mat, w2=w * 0.85, h2=w)
    m.beam(mid, b - V(0, 0, droop), w * 0.85, w, mat, w2=w * 0.6, h2=w * 0.7)


def window(m, c, right, w, h, curtain=0, frame=WHITE, off=0.02, shutters=None):
    """A cabin window on a wall: the glass in its frame, a curtain half drawn behind it (1 white, 2 checked), and
    shutters (their material) folded back against the wall."""
    c, r = Vector(c), Vector(right).normalized()
    u = V(0, 0, 1)
    nrm = r.cross(u)
    if shutters is not None:
        for s_ in (1, -1):
            sc = c + r * s_ * (w / 2 + 0.06 + w * 0.26) + nrm * (off + 0.012)
            m.box(sc, Vector((abs(r.x) * w * 0.5 + abs(nrm.x) * 0.025 + 0.0001, abs(r.y) * w * 0.5 + abs(nrm.y) * 0.025 + 0.0001,
                  h + 0.06)), shutters, shade=0.9)
            m.box(sc + u * 0.0 + nrm * 0.016, Vector((abs(r.x) * w * 0.42 + abs(nrm.x) * 0.012 + 0.0001,
                  abs(r.y) * w * 0.42 + abs(nrm.y) * 0.012 + 0.0001, 0.035)), frame)
    panel(m, c, r, u, w, h, WINDOW, off=off)
    if curtain:
        u0, u1 = (0.06, 0.44) if curtain == 1 else (0.56, 0.94)
        cc = c + nrm * (off + 0.006) - u * h * 0.2
        hw, hh = w * 0.44, h * 0.27
        m.poly([cc - r * hw - u * hh, cc + r * hw - u * hh, cc + r * hw + u * hh, cc - r * hw + u * hh], WASH, out=nrm,
               uvs=[(u0, 0.56), (u1, 0.56), (u1, 0.94), (u0, 0.94)])
    t = 0.05
    for s in (1, -1):
        m.box(c + nrm * (off + 0.01) + r * s * (w / 2 + t / 2), Vector((abs(r.x) * t + abs(nrm.x) * 0.04 + 0.0001,
              abs(r.y) * t + abs(nrm.y) * 0.04 + 0.0001, h + 2 * t)), frame)
        m.box(c + nrm * (off + 0.01) + u * s * (h / 2 + t / 2), Vector((abs(r.x) * (w + 2 * t) + abs(nrm.x) * 0.04 + 0.0001,
              abs(r.y) * (w + 2 * t) + abs(nrm.y) * 0.04 + 0.0001, t)), frame)


def flower_pot(m, c, r=0.11, seed=1):
    """A clay pot with a geranium in flower: the pot turned, the leaves a low dome, a few red heads."""
    rnd = random.Random(seed)
    c = Vector(c)
    with m.at(move(*c)):
        m.lathe([(r * 0.7, 0.0), (r, r * 1.3), (r * 1.12, r * 1.35), (r * 1.1, r * 1.5)], 7, REDLEAD, smooth=False, cap0=True)
        m.lathe([(r * 1.05, r * 1.42), (r * 1.5, r * 1.8), (r * 1.25, r * 2.4), (r * 0.5, r * 2.75), (0.0, r * 2.8)], 7, TARWEED,
                smooth=False, rot=rnd.uniform(0, 1))
    for k in range(4):
        a = rnd.uniform(0, 2 * math.pi)
        p = c + V(math.cos(a) * r * 0.9, math.sin(a) * r * 0.9, r * 2.5 + rnd.uniform(0, r * 0.4))
        m.box(p, (r * 0.6, r * 0.6, r * 0.5), FLAG, shade=0.9, mode="fit")


def kennel(m, c, yaw=0.0):
    """A dog's kennel: plank walls, a tarred roof, the dark door."""
    c = Vector(c)
    w, d, h = 0.62, 0.75, 0.5
    with m.at(move(*c) @ rot_z(yaw)):
        m.box((0, 0, h / 2), (w, d, h), WOOD, tile=1.0, skip=("+z",))
        for sx in (1, -1):
            m.poly([V(sx * (w / 2 + 0.06), -d / 2 - 0.05, h - 0.04), V(sx * (w / 2 + 0.06), d / 2 + 0.05, h - 0.04),
                    V(0, d / 2 + 0.05, h + 0.28), V(0, -d / 2 - 0.05, h + 0.28)], TAR, out=(sx, 0, 1))
        for dy in (1, -1):
            m.poly([V(-w / 2, dy * d / 2, h), V(w / 2, dy * d / 2, h), V(0, dy * d / 2, h + 0.26)], WOOD, out=(0, dy, 0))
        panel(m, (w / 2, 0, 0.2), (0, -1, 0), (0, 0, 1), 0.26, 0.32, DARK, off=0.005)


def tub(m, c, r=0.32, h=0.3):
    """A washing tub of staves with two ears, a scrubbing board leant in it."""
    c = Vector(c)
    with m.at(move(*c)):
        m.lathe([(r * 0.86, 0), (r, h), (r * 0.94, h), (r * 0.82, 0.04)], 9, BARREL, smooth=False, cap0=True, urep=2)
        m.lathe([(r * 0.9, h * 0.5), (r * 0.92, h * 0.56)], 9, IRON, smooth=False)
    m.box(c + V(0, 0, 0.05), (r * 1.6, r * 1.6, 0.01), BILGE)


def boathook(m, a, b):
    """A boathook or a quant pole lying on deck: a pole with an iron hook at b."""
    a, b = Vector(a), Vector(b)
    m.beam(a, b, 0.05, 0.05, WOOD, shade=0.9)
    d = (b - a).normalized()
    m.beam(b, b + d * 0.18, 0.035, 0.035, IRON)
    m.beam(b + d * 0.12, b + d * 0.12 + V(0, 0, 0.1), 0.03, 0.03, IRON)


def bollard_pair(m, x, y, z, h=0.5, w=0.18, gap=0.34, along=(0, 1, 0)):
    """A pair of bitts with a cross piece and iron caps."""
    a = Vector(along).normalized()
    for s in (1, -1):
        p = V(x, y, z) + a * s * gap / 2
        m.box(p + V(0, 0, h / 2), (w, w, h), DARK, shade=0.85)
        m.box(p + V(0, 0, h + 0.015), (w + 0.02, w + 0.02, 0.03), IRON)
    m.beam(V(x, y, z + h * 0.62) - a * gap / 2, V(x, y, z + h * 0.62) + a * gap / 2, 0.08, 0.07, DARK)


def cleat(m, p, along=(0, 1, 0), size=0.3):
    p, a = Vector(p), Vector(along).normalized()
    m.beam(p - a * size / 2 + V(0, 0, 0.06), p + a * size / 2 + V(0, 0, 0.06), 0.06, 0.05, DARK)
    for s in (0.25, -0.25):
        m.box(p + a * s * size + V(0, 0, 0.03), (0.06, 0.06, 0.06), DARK)


def chain(m, a, b, sag=0.15, r=0.03):
    """An anchor chain: a sagging bar of iron (a line in the distance)."""
    a, b = Vector(a), Vector(b)
    pts = []
    for k in range(7):
        f = k / 6
        pts.append(a.lerp(b, f) - V(0, 0, sag * math.sin(math.pi * f)))
    m.tube(pts, [r] * len(pts), 4, IRON, smooth=False, urep=1, vscale=2.0)


def fender_board(m, p, sx, h=1.0):
    """A timber fender plank hung down the side on two lanyards."""
    p = Vector(p)
    o = V(sx * 0.07, 0, 0)
    m.box(p + o - V(0, 0, h / 2), (0.06, 0.24, h), WOOD, shade=0.8)
    m.line(p + V(0, -0.08, 0.05), p + o + V(0, -0.08, -0.05))
    m.line(p + V(0, 0.08, 0.05), p + o + V(0, 0.08, -0.05))


def stovepipe(m, x, y, z, h=0.9, r=0.07):
    """A cabin's stovepipe: a pipe with a collar on the roof and a rain cap on top."""
    with m.at(move(x, y, z)):
        m.lathe([(r * 1.7, 0), (r * 1.7, 0.06), (r, 0.08), (r, h), (r * 1.15, h + 0.02), (r * 1.15, h + 0.06), (r, h + 0.06)],
                7, IRON, smooth=False)
        m.lathe([(r * 1.7, h + 0.12), (r * 1.8, h + 0.13), (r * 0.4, h + 0.2), (0.0, h + 0.21)], 7, IRON, smooth=False)
        for k in range(3):
            a = 2 * math.pi * k / 3
            m.beam((r * math.cos(a), r * math.sin(a), h + 0.05), (r * 1.4 * math.cos(a), r * 1.4 * math.sin(a), h + 0.13), 0.012,
                   0.012, IRON)
    return V(x, y, z + h + 0.12)


def hen_coop(m, c, yaw=0.0):
    """A hen coop as the barge families kept them: a slatted front, a sloping tarred lid, a little trough."""
    c = Vector(c)
    w, d, h = 0.95, 0.55, 0.5
    with m.at(move(*c) @ rot_z(yaw)):
        m.box((0, 0.06, h / 2), (w, d - 0.12, h), WOOD, tile=1.0, skip=("+z", "-y"))
        for k in range(9):
            x = -w / 2 + 0.03 + (w - 0.06) * k / 8
            m.box((x, -d / 2 + 0.03, h / 2), (0.025, 0.025, h), WOOD, shade=0.85)
        m.box((0, -d / 2 + 0.03, h - 0.03), (w, 0.04, 0.05), DARK)
        m.box((0, -d / 2 + 0.03, 0.03), (w, 0.04, 0.05), DARK)
        m.poly([V(-w / 2 - 0.04, -d / 2 - 0.06, h + 0.02), V(w / 2 + 0.04, -d / 2 - 0.06, h + 0.02),
                V(w / 2 + 0.04, d / 2 + 0.03, h + 0.14), V(-w / 2 - 0.04, d / 2 + 0.03, h + 0.14)], TAR, out=(0, -0.3, 1))
        m.box((0, -d / 2 - 0.12, 0.05), (w * 0.8, 0.1, 0.08), WOOD, shade=0.7)
        m.box((0, 0.06, 0.06), (w - 0.04, d - 0.14, 0.01), SAND)


def bucket(m, c, r=0.14, h=0.27, mat=None):
    """A wooden bucket with two iron hoops and its rope handle."""
    c = Vector(c)
    with m.at(move(*c)):
        m.lathe([(r * 0.82, 0), (r, h), (r * 0.94, h), (r * 0.8, 0.03)], 8, BARREL if mat is None else mat, smooth=False, cap0=True)
        for z in (0.06, h - 0.05):
            m.lathe([(r * (0.86 + 0.14 * z / h) + 0.006, z), (r * (0.86 + 0.14 * z / h) + 0.006, z + 0.025)], 8, IRON, smooth=False)
    m.line(c + V(-r, 0, h), c + V(0, 0, h + 0.16))
    m.line(c + V(0, 0, h + 0.16), c + V(r, 0, h))


def broom(m, foot, top):
    """A deck broom leaning on something: the stick and the bristles."""
    foot, top = Vector(foot), Vector(top)
    d = (top - foot).normalized()
    m.beam(foot + d * 0.12, top, 0.03, 0.03, WOOD)
    m.beam(foot, foot + d * 0.14, 0.32, 0.06, ROPE, side=(1, 0, 0))


def deck_pump(m, c, h=0.9):
    """A ship's hand pump: a square wooden trunk, an iron top, a spout and the long handle up."""
    c = Vector(c)
    m.box(c + V(0, 0, h / 2), (0.16, 0.16, h), WOOD, tile=1.0)
    m.box(c + V(0, 0, h + 0.03), (0.2, 0.2, 0.06), IRON)
    m.beam(c + V(0, -0.08, h * 0.7), c + V(0, -0.3, h * 0.62), 0.06, 0.06, WOOD)
    m.beam(c + V(0, 0.05, h + 0.06), c + V(0, 0.75, h + 0.42), 0.04, 0.04, IRON)
    m.box(c + V(0, 0.07, h + 0.12), (0.04, 0.04, 0.18), IRON)


def gangplank(m, a, b, w=0.4):
    """A gangplank laid along the deck: a long plank with cleats across it."""
    a, b = Vector(a), Vector(b)
    m.beam(a, b, w, 0.05, WOOD, side=(1, 0, 0), shade=0.9)
    n = int((b - a).length / 0.45)
    for k in range(1, n):
        p = a.lerp(b, k / n) + V(0, 0, 0.035)
        m.box(p, (w * 0.9, 0.04, 0.025), WOOD, shade=0.75)


def freeing_ports(m, hull, zd, ts, sx_list=(1, -1), w=0.28, h=0.1):
    """The freeing ports low in the bulwark, where the deck water runs out."""
    for t in ts:
        for sx in sx_list:
            p = hull.P(t, zd(t) + h / 2 + 0.02, sx) + V(sx * 0.012, 0, 0)
            tan = (hull.P(min(1.0, t + 0.01), zd(t), sx) - hull.P(max(0.0, t - 0.01), zd(t), sx)).normalized()
            panel(m, p, tan * (-sx), (0, 0, 1), w, h, DARK, off=0.0)


def dan_buoy(m, a, b):
    """A dan buoy lying on deck: a pole with a cork float and a black flag."""
    a, b = Vector(a), Vector(b)
    m.beam(a, b, 0.04, 0.04, WOOD)
    f = a.lerp(b, 0.3)
    with m.at(move(*f) @ Matrix.Rotation(math.atan2(b.y - a.y, b.x - a.x) - math.pi / 2, 4, "Z") @ Matrix.Rotation(math.pi / 2, 4, "X")):
        m.lathe([(0.0, -0.18), (0.16, -0.12), (0.18, 0.0), (0.16, 0.12), (0.0, 0.18)], 7, BARREL, smooth=False)
    d = (b - a).normalized()
    p = b - d * 0.05
    m.poly([p, p - d * 0.45, p - d * 0.45 + V(0, 0, 0.32), p + V(0, 0, 0.3)], TAR, out=(d.y, -d.x, 0))


def basket2(m, c, r=0.22, h=0.28, mat=None):
    """A round wicker basket with its inside and bottom (seen from the deck above)."""
    with m.at(move(*Vector(c))):
        m.lathe([(r * 0.75, 0.0), (r, h), (r * 1.03, h + 0.02), (r * 0.94, h + 0.02), (r * 0.7, 0.04)], 8,
                ROPE if mat is None else mat, smooth=False, cap0=True, urep=2, vscale=2)
        m.lathe([(r * 0.7, 0.04), (0.0, 0.04)], 8, ROPE if mat is None else mat, smooth=False, urep=2)


def block(m, p, r=0.07, along=(0, 0, 1)):
    """A rope block: a wooden shell with an iron strop, hung along `along`."""
    p, a = Vector(p), Vector(along).normalized()
    m.beam(p - a * r * 1.3, p + a * r * 1.3, r * 1.2, r * 0.8, WOOD, shade=0.8)
    m.beam(p + a * r * 1.3, p + a * r * 1.9, 0.02, 0.02, IRON)


def pin_rail(m, x0, x1, y, z, n=5, hang=True, seed=1):
    """A pin rail across the foot of the mast: a bar on two legs, belaying pins, the halyards' coils hung on them."""
    rnd = random.Random(seed)
    m.beam((x0, y, z), (x1, y, z), 0.07, 0.07, DARK)
    for x in (x0 + 0.06, x1 - 0.06):
        m.box((x, y, z / 2 + 0.2), (0.07, 0.07, z - 0.4 + 0.02), DARK)
    for k in range(n):
        x = x0 + (x1 - x0) * (k + 0.5) / n
        m.beam((x, y, z - 0.08), (x, y, z + 0.14), 0.025, 0.025, WOOD)
        if hang and rnd.random() > 0.25:
            c = V(x, y - 0.04, z - 0.18)
            m.tube([c + V(0, 0, 0.12), c + V(0.04, -0.01, 0.0), c + V(0, -0.02, -0.16)], [(0.09, 0.025)] * 3, 5, ROPE,
                   side=(1, 0, 0), smooth=False)


def mast_hoops(m, p0, p1, r, n=6):
    """Wooden hoops round the mast (the luff of the gaff sail), gathered low when the sail is furled."""
    p0, p1 = Vector(p0), Vector(p1)
    for k in range(n):
        c = p0.lerp(p1, k / max(1, n - 1))
        with m.at(move(*c)):
            m.lathe([(r + 0.03, -0.025), (r + 0.045, 0.0), (r + 0.03, 0.025), (r + 0.015, 0.0)], 8, WOOD, smooth=False,
                    closed_v=True)


def gaff_jaws(m, mast, gaff_a, gaff_b, r):
    """The gaff's jaws round the mast: two horns from the gaff's heel."""
    d = (gaff_b - gaff_a).normalized()
    for sx in (1, -1):
        m.beam(gaff_a + V(sx * (r + 0.04), 0, 0), gaff_a - d * (r + 0.18) + V(sx * (r + 0.04), 0, 0), 0.05, 0.08, DARK)


def hatch_boards(m, x0, x1, ya, yb, zt, rise, seed=1, board=0.62, X=None):
    """Hatch boards laid across a hold on its coaming, arched (zt at the sides, zt + rise on the ridge): one board at a
    time, a hand's gap between them, each a little different in tone and set; the walk plank on the ridge."""
    rnd = random.Random(seed)
    w = x1 - x0
    n_arc = 8
    arch = [(x0 + w * j / n_arc, zt + rise * math.sin(math.pi * j / n_arc)) for j in range(n_arc + 1)]
    n = max(2, int(round(abs(yb - ya) / board)))
    step = (yb - ya) / n
    th = 0.045
    for i in range(n):
        y0, y1 = ya + step * i + 0.008 * math.copysign(1, step), ya + step * (i + 1) - 0.008 * math.copysign(1, step)
        dz = rnd.uniform(-0.012, 0.012)
        mat = HATCH if rnd.random() > 0.18 else WOOD
        s = rnd.uniform(0.82, 1.0)
        u0 = rnd.uniform(0, 4)
        for j in range(n_arc):
            (xa, za), (xb, zb) = arch[j], arch[j + 1]
            za, zb = za + dz, zb + dz
            pts = [V(xa, y0, za), V(xb, y0, zb), V(xb, y1, zb), V(xa, y1, za)]
            m.poly(pts, mat, out=((xa + xb) / 2 - (x0 + x1) / 2, 0, 1.5), shade=s,
                   uvs=[(u0 + xa / 1.6, y0 / 1.6), (u0 + xb / 1.6, y0 / 1.6), (u0 + xb / 1.6, y1 / 1.6), (u0 + xa / 1.6, y1 / 1.6)])
            for yy, dy in ((y0, -math.copysign(1, step)), (y1, math.copysign(1, step))):
                m.poly([V(xa, yy, za), V(xb, yy, zb), V(xb, yy, zb - th), V(xa, yy, za - th)], DARK, out=(0, dy, 0), shade=0.6)
            if X is not None:
                X.floor([V(xa, y0, za), V(xb, y0, zb), V(xb, y1, zb), V(xa, y1, za)])
        # the iron handle on each board
        if i % 2 == 0:
            m.box(((x0 + x1) / 2 + w * 0.3, (y0 + y1) / 2, zt + rise * math.sin(math.pi * 0.8) + 0.03 + dz), (0.12, 0.03, 0.03), IRON)
    return arch


def coaming(m, hull, zd, h0, h1, cw, ztop, mat, X=None):
    """The hold's coaming: sides and ends standing up from the deck to ztop, an iron angle along its top."""
    ya, yb = hull.y(h0, zd(h0)), hull.y(h1, zd(h1))
    for sx in (1, -1):
        T = hull.span(h0, h1)
        for ta, tb in zip(T, T[1:]):
            y0, y1 = hull.y(ta, zd(ta)), hull.y(tb, zd(tb))
            pts = [V(sx * cw, y0, zd(ta) - 0.05), V(sx * cw, y1, zd(tb) - 0.05), V(sx * cw, y1, ztop), V(sx * cw, y0, ztop)]
            m.poly(pts, mat, out=(sx, 0, 0), uvs=[(-p.y / 1.6, p.z / 1.6) for p in pts])
        m.beam((sx * (cw + 0.03), ya, ztop - 0.02), (sx * (cw + 0.03), yb, ztop - 0.02), 0.06, 0.06, IRON)
        m.beam((sx * (cw + 0.04), ya, (ztop + zd(0.5)) / 2), (sx * (cw + 0.04), yb, (ztop + zd(0.5)) / 2), 0.04, 0.08, DARK)
    for t, y, dy in ((h0, ya, 1), (h1, yb, -1)):
        pts = [V(-cw, y, zd(t) - 0.05), V(cw, y, zd(t) - 0.05), V(cw, y, ztop), V(-cw, y, ztop)]
        m.poly(pts, mat, out=(0, -dy, 0), uvs=[(p.x / 1.6, p.z / 1.6) for p in pts])
        m.beam((-cw - 0.03, y - dy * 0.03, ztop - 0.02), (cw + 0.03, y - dy * 0.03, ztop - 0.02), 0.06, 0.06, IRON)
    return ya, yb


def roef(m, X, x0, x1, y0, y1, zb, zt, wall=GREEN, trim=WHITE, roof=TAR, rise=0.16, wins_side=2, curtain=2,
         door_side="-y", door_x=0.5, skylight=True, pots=3, seed=1, shutters=None):
    """The skipper's cabin (roef): walls with corner posts, windows with frames and curtains, a door with its step,
    an arched roof with a skylight and pots along its front edge. Returns (roof height at the ridge, the roof's z at
    its edge)."""
    w, d = x1 - x0, y1 - y0
    m.box(((x0 + x1) / 2, (y0 + y1) / 2, (zb + zt) / 2), (w, d, zt - zb), wall, tile=1.6, skip=("+z", "-z"))
    for x in (x0, x1):
        for y in (y0, y1):
            m.box((x, y, (zb + zt) / 2), (0.08, 0.08, zt - zb + 0.02), trim)
    m.beam((x0 - 0.03, y0 - 0.03, zt - 0.04), (x1 + 0.03, y0 - 0.03, zt - 0.04), 0.06, 0.08, trim)
    m.beam((x0 - 0.03, y1 + 0.03, zt - 0.04), (x1 + 0.03, y1 + 0.03, zt - 0.04), 0.06, 0.08, trim)
    for x in (x0, x1):
        m.beam((x, y0, zt - 0.04), (x, y1, zt - 0.04), 0.08, 0.06, trim)
    # the roof: arched across, overhanging, with a fascia board
    over = 0.1
    xa, xb, ya, yb = x0 - over, x1 + over, y0 - over, y1 + over
    n = 6
    xs = [xa + (xb - xa) * i / n for i in range(n + 1)]
    zs = [zt + rise * math.sin(math.pi * i / n) for i in range(n + 1)]
    for i in range(n):
        pts = [V(xs[i], ya, zs[i]), V(xs[i + 1], ya, zs[i + 1]), V(xs[i + 1], yb, zs[i + 1]), V(xs[i], yb, zs[i])]
        m.poly(pts, roof, out=(xs[i] + xs[i + 1] - xa - xb, 0, 1), uvs=[(p.y / 1.2, p.x / 1.2) for p in pts])
        X.floor(pts)
        for yy, dy in ((ya, -1), (yb, 1)):
            m.poly([V(xs[i], yy, zs[i]), V(xs[i + 1], yy, zs[i + 1]), V(xs[i + 1], yy, zs[i + 1] - 0.07), V(xs[i], yy, zs[i] - 0.07)],
                   trim, out=(0, dy, 0), shade=0.85)
    for yy, dy in ((ya, -1), (yb, 1)):
        m.poly([V(x, yy, z - 0.07) for x, z in zip(xs, zs)][::-1] + [V(xb, yy, zt - 0.07)], trim, out=(0, dy, 0), shade=0.7)
    m.poly([V(xa, ya, zt - 0.07), V(xb, ya, zt - 0.07), V(xb, yb, zt - 0.07), V(xa, yb, zt - 0.07)], DARK, out=(0, 0, -1), shade=0.5)
    for x, sx in ((xa, -1), (xb, 1)):
        m.poly([V(x, ya, zt), V(x, yb, zt), V(x, yb, zt - 0.07), V(x, ya, zt - 0.07)], trim, out=(sx, 0, 0), shade=0.85)
    X.solid(((x0 + x1) / 2, (y0 + y1) / 2, (zb + zt) / 2), (w, d, zt - zb))
    # windows: wins_side a side, one in the front wall
    for sx, x in ((1, x1), (-1, x0)):
        for k in range(wins_side):
            y = y0 + d * (k + 0.5) / wins_side
            window(m, (x, y, zt - 0.42), (0, sx, 0), 0.46, 0.4, curtain=curtain if (k + sx) % 3 else 1, frame=trim,
                   shutters=shutters)
    window(m, ((x0 + x1) / 2 - (w * 0.22 if door_side == "-y" else 0), y0, zt - 0.42), (1, 0, 0), 0.42, 0.38, curtain=1, frame=trim)
    # the door, its frame, a brass knob and a step
    if door_side:
        dy = -1 if door_side == "-y" else 1
        y = y0 if dy < 0 else y1
        dh = min(1.25, zt - zb - 0.2)
        dw = 0.62
        zc = zb + dh / 2 + 0.08
        dx = x0 + w * door_x
        panel(m, (dx, y, zc), (-dy, 0, 0), (0, 0, 1), dw, dh, BOARDS, off=0.015)
        for s in (1, -1):
            m.box((dx + s * (dw / 2 + 0.03), y + dy * 0.02, zc), (0.06, 0.05, dh + 0.06), trim)
        m.box((dx, y + dy * 0.02, zc + dh / 2 + 0.03), (dw + 0.12, 0.05, 0.06), trim)
        m.box((dx + dw * 0.32, y + dy * 0.04, zc), (0.04, 0.04, 0.04), IRON)
        m.box((dx, y + dy * 0.2, zb + 0.09), (dw + 0.1, 0.32, 0.12), DARK)
    # the skylight: a small hood with glass on the ridge
    if skylight:
        sy = y0 + d * 0.62
        sz = zt + rise
        m.box(((x0 + x1) / 2, sy, sz + 0.1), (0.7, 0.6, 0.2), wall, tile=1.0)
        for s in (1, -1):
            pts = [V((x0 + x1) / 2 + s * 0.36, sy - 0.32, sz + 0.2), V((x0 + x1) / 2 + s * 0.36, sy + 0.32, sz + 0.2),
                   V((x0 + x1) / 2, sy + 0.32, sz + 0.36), V((x0 + x1) / 2, sy - 0.32, sz + 0.36)]
            m.poly(pts, WINDOW, out=(s, 0, 1), uvs=[(0, 0), (1, 0), (1, 1), (0, 1)])
        for yy, dy in ((sy - 0.32, -1), (sy + 0.32, 1)):
            m.poly([V((x0 + x1) / 2 - 0.36, yy, sz + 0.2), V((x0 + x1) / 2 + 0.36, yy, sz + 0.2), V((x0 + x1) / 2, yy, sz + 0.36)],
                   wall, out=(0, dy, 0))
    # pots along the front edge of the roof, on a little rail
    rnd = random.Random(seed)
    for k in range(pots):
        x = x0 + w * (0.2 + 0.6 * k / max(1, pots - 1)) + rnd.uniform(-0.05, 0.05)
        flower_pot(m, (x, y0 + 0.05, zt + rise * 0.15 * (1 - abs(2 * (x - x0) / w - 1))), 0.09 + rnd.uniform(0, 0.03), seed=seed + k)
    if pots:
        m.beam((x0 + 0.2, y0 - 0.06, zt + 0.12), (x1 - 0.2, y0 - 0.06, zt + 0.12), 0.025, 0.025, trim)
    return zt + rise, zt


def heap(m, hull, t0, t1, zf, H, mat, inset=0.25, nu=14, nv=9, seed=1, lumps=0, X=None):
    """A heap of loose cargo (coal, sand) filling the hold from t0 to t1, H high in the middle, its top uneven."""
    rnd = random.Random(seed)
    P = []
    for j in range(nu + 1):
        t = t0 + (t1 - t0) * j / nu
        w = hull.hb(t, zf + 0.3) - inset
        row = []
        for i in range(nv + 1):
            u = i / nv
            x = -w + 2 * w * u
            h = H * math.sin(math.pi * j / nu) ** 0.55 * math.sin(math.pi * u) ** 0.65
            h *= 1.0 + 0.12 * math.sin(j * 1.7 + seed) * math.sin(math.pi * u)
            if 0 < i < nv and 0 < j < nu:
                h += rnd.uniform(-0.07, 0.07)
            row.append(V(x, hull.y(t, zf), zf + max(0.02, h)))
        P.append(row)
    for j in range(nu):
        for i in range(nv):
            q = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]
            m.poly(q, mat, out=(0, 0, 1), uvs=[(p.x / 1.2, -p.y / 1.2) for p in q], shade=0.8 + 0.2 * rnd.random())
            if X is not None:
                X.floor(q)
    for k in range(lumps):
        j, i = rnd.randint(1, nu - 1), rnd.randint(1, nv - 1)
        p = P[j][i]
        s = rnd.uniform(0.12, 0.26)
        with m.at(move(p.x, p.y, p.z + s * 0.25) @ rot_z(rnd.uniform(0, 3)) @ Matrix.Rotation(rnd.uniform(-0.5, 0.5), 4, "X")):
            m.box((0, 0, 0), (s, s * 0.8, s * 0.6), mat, shade=0.7)
    return P


# ------------------------------------------------------------------ the Rhine barge (Rijnaak)


RB = dict(L=34.0, B=6.2, D=1.55, F=0.85, E=0.75, Eb=0.25)


def rhine_barge():
    """A German iron Rhine barge of the 1870s: riveted plating, timber rubbing wales, a long hold under arched hatch
    boards, the roef aft with the great tiller over it, a mast in its tabernacle, leeboards. Deck and cabin as the
    life aboard reads them (Godot ShipLife.cs, game/lifeAboard.ts: deck = sheer - 0.28)."""
    m = Mesh(ao=0.0)
    X = Contract(m)
    L, B, D, F, E, Eb = RB["L"], RB["B"], RB["D"], RB["F"], RB["E"], RB["Eb"]
    tb0, ts0 = 0.86, 0.12

    def keel(t):
        return -D + 0.6 * D * sm((t - 0.9) / 0.1) + 0.35 * D * sm((0.07 - t) / 0.07)

    def sheer(t):
        return F + E * abs(2 * t - 1) ** 3 + Eb * max(0.0, (t - 0.8) / 0.2) ** 2

    def hb(t, z):
        u = cl((z + D) / (D + F))
        sec = 0.84 + 0.16 * sm(u / 0.3)
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
        return -0.5 * u * sm((t - 0.88) / 0.12) + 0.3 * u * sm((0.08 - t) / 0.08)

    ts = [0, 0.004, 0.01, 0.018, 0.028, 0.04, 0.055, 0.072, 0.092, 0.12, 0.16, 0.2, 0.26, 0.32, 0.38, 0.44, 0.5, 0.56,
          0.62, 0.68, 0.74, 0.8, 0.84, 0.865, 0.885, 0.905, 0.925, 0.943, 0.958, 0.971, 0.982, 0.991, 0.997, 1.0]
    wl = -0.05

    def lv(f):
        return lambda t: keel(t) + (wl - keel(t)) * f

    levels = [keel, lv(0.06), lv(0.16), lv(0.32), lv(0.55), lv(0.8), lambda t: wl, lambda t: 0.3, lambda t: sheer(t) - 0.44,
              lambda t: sheer(t) - 0.24, sheer]
    mats = [(IRONHULL, 0)] * 8 + [(IRONHULL, 0), (GREEN, 3.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    hull_skin(m, hull)
    # timber rubbing wales along her sides, a white line under the green top strake, rust runs
    hull.wale(m, lambda t: sheer(t) - 0.24, 0.015, 0.985, h=0.16, out=0.09)
    hull.wale(m, lambda t: 0.12 + 0.55 * (sheer(t) - F), 0.03, 0.97, h=0.13, out=0.07)
    hull.wale(m, lambda t: sheer(t) - 0.405, 0.03, 0.97, h=0.03, out=0.012, mat=WHITE, shade=1.0)
    for sx in (1, -1):
        hull.decal(m, 0.95, sheer(0.95) - 0.3, 0.7, 1.0, sx)
        hull.decal(m, 0.63, sheer(0.63) - 0.35, 0.5, 0.7, sx, u=(0.5, 1.0))
        hull.decal(m, 0.25, sheer(0.25) - 0.3, 0.9, 0.6, sx, u=(0.0, 0.6))
        hull.decal(m, 0.44, sheer(0.44) - 0.7, 0.6, 0.55, sx, u=(0.2, 0.7))

    def zd(t):
        return sheer(t) - 0.28

    hull.deck(m, zd, 0, 1, 0.07, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, GREEN, DARK)
    # stanchions inside the bulwark
    for t in [0.06 + 0.88 * k / 26 for k in range(27)]:
        for sx in (1, -1):
            p = hull.P(t, zd(t), sx, 0.12)
            m.box(p + V(0, 0, (sheer(t) - zd(t)) / 2), (0.06, 0.08, sheer(t) - zd(t)), GREEN, shade=0.75)

    # the hold: coaming, arched hatch boards, the plank along the ridge
    h0, h1 = 0.2, 0.75
    cw = 2.3
    ztop = max(zd(h0), zd(h1)) + 0.4
    rise = 0.55
    ya, yb = coaming(m, hull, zd, h0, h1, cw, ztop, GREEN)
    X.deck(hull, zd, h0, h1, 0.1, x0=cw + 0.06)
    hatch_boards(m, -cw - 0.04, cw + 0.04, ya - 0.04, yb + 0.04, ztop + 0.01, rise, seed=7, X=X)
    for y, dy in ((ya, 1), (yb, -1)):
        n = 8
        arch = [V(-cw + 2 * cw * j / n, y, ztop + rise * math.sin(math.pi * j / n)) for j in range(n + 1)]
        m.poly(arch, GREEN, out=(0, -dy, 0), shade=0.75)
    m.beam((0, ya - 0.1, ztop + rise + 0.05), (0, yb + 0.1, ztop + rise + 0.05), 0.34, 0.05, WOOD, shade=0.9)
    X.solid((0, (ya + yb) / 2, (zd(0.5) + ztop) / 2), (2 * cw, abs(yb - ya), ztop - zd(0.5)))
    # the barge's dinghy, carried on the hatches aft, and a long pushing pole on the hatch side
    ships_boat(m, (0.9, ya - 3.4, ztop + rise * 0.78), 4.0, 1.35, 0.55, yaw=0.05, mat=CLINKER, cover=WOOD)
    X.solid((0.9, ya - 3.4, ztop + rise + 0.3), (1.4, 4.0, 0.8))
    boathook(m, (-cw * 0.55, ya - 1.0, ztop + rise * 0.82), (-cw * 0.6, yb + 1.0, ztop + rise * 0.8))

    # the roef: the skipper's cabin aft
    c0, c1 = 0.045, 0.14
    cabw = 1.9
    y0, y1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    zb = min(zd(c0), zd(c1)) - 0.1
    zt = max(zd(c0), zd(c1)) + 1.25
    X.deck(hull, zd, 0.0, c0, 0.1)
    X.deck(hull, zd, c1, h0, 0.1)
    X.deck(hull, zd, c0, c1, 0.1, x0=cabw + 0.05)
    ridge, _ = roef(m, X, -cabw, cabw, y0, y1, zb, zt, wall=GREEN, trim=WHITE, roof=TAR, rise=0.18, wins_side=2,
                    curtain=2, door_side="-y", door_x=0.7, pots=4, seed=3, shutters=GREEN)
    xr0, xr1 = -cabw - 0.1, cabw + 0.1
    hen_coop(m, (-0.85, y0 + 0.75, zt + 0.12), yaw=0.0)
    X.solid((-0.85, y0 + 0.75, zt + 0.45), (1.0, 0.65, 0.65))
    broom(m, (cabw * 0.15 - 0.35, y0 - 0.12, zb + 0.1), (cabw * 0.15 - 0.3, y0 - 0.03, zb + 1.3))
    pipe_top = stovepipe(m, cabw * 0.5, (y0 + y1) / 2 + 0.5, zt + 0.12, 0.85, 0.075)
    m.stove(pipe_top)
    lantern(m, V(-cabw + 0.3, y1 - 0.3, zt + 0.18 + 0.16), 0)
    # the rudder, its stock, and the great tiller reaching forward over the roef
    ys = L / 2
    zr = sheer(0)
    head = ridge + 0.32
    with put_over(m, hull.y(0.0, zr) - 0.1, math.radians(14)):
        rudder(m, ys, keel(0.0) + 0.1, sheer(0) - 0.98, 1.6, head, mat=IRONHULL, straps=3, stock_r=0.1,
               post=lambda z: hull.y(0.0, z) + 0.02)
        tiller(m, (0, ys + 0.1, head - 0.06), (0.15, y0 - 0.4, head - 0.02), w=0.15, droop=0.12)
    X.post((0, ys + 0.1, zd(0.01)), (0, ys + 0.1, head), 0.3)
    # flagstaff at the stern, the house flag
    spar(m, (0.45, ys - 0.25, zr - 0.1), (0.45, ys - 0.05, zr + 2.3), 0.04, 0.03)
    flag(m, (0.45, ys - 0.03, zr + 2.25), 1.2, 0.75, along=(0, 1, -0.1), kind="house")
    # the washing out to dry, from the flagstaff to a pole on the roef
    pole = V(cabw - 0.1, y0 + 0.1, zt)
    spar(m, pole, pole + V(0, 0, 1.9), 0.04, 0.03)
    washing_line(m, (0.45, ys - 0.1, zr + 2.0), pole + V(0, 0, 1.85), seed=3, n=6)

    # the aft deck between roef and hold: the dog's kennel, a wash tub, water casks, a bench
    yk = (y0 + ya) / 2
    kennel(m, (0.3, yk + 0.35, zd(0.17)), yaw=math.pi / 2)
    X.solid((0.3, yk + 0.35, zd(0.17) + 0.4), (0.8, 0.7, 0.8))
    tub(m, (-1.85, yk - 0.3, zd(0.17)), 0.3)
    bucket(m, (-1.3, yk - 0.65, zd(0.17)))
    bucket(m, (1.95, yk - 0.2, zd(0.17)), r=0.13)
    deck_pump(m, (cw + 0.42, ya + 0.35, zd(h0)), 0.85)
    X.solid((cw + 0.42, ya + 0.35, zd(h0) + 0.45), (0.3, 0.3, 0.9))
    gangplank(m, (-(cw + 0.38), hull.y(0.3, 0), zd(0.3) + 0.03), (-(cw + 0.38), hull.y(0.47, 0), zd(0.47) + 0.03), 0.42)
    freeing_ports(m, hull, zd, [0.12 + 0.76 * k / 9 for k in range(10)])
    barrel_lo(m, (-cabw * 0.62, y0 - 0.55, zd(c1 + 0.01)), yaw=0.4)
    barrel_lo(m, (cabw * 0.72, y0 - 0.6, zd(c1 + 0.01)), yaw=1.1)
    for x in (-cabw * 0.62, cabw * 0.72):
        X.solid((x, y0 - 0.58, zd(c1) + 0.5), (0.7, 0.7, 1.0))
    m.box((-1.0, y0 - 0.25, zd(c1) + 0.42), (1.3, 0.32, 0.05), WOOD)
    for x in (-1.55, -0.45):
        m.box((x, y0 - 0.25, zd(c1) + 0.2), (0.06, 0.28, 0.4), DARK)

    # mast in its tabernacle, boom, gaff and the furled sail
    tm = 0.8
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    H = 11.0
    for sx in (1, -1):
        m.box((sx * 0.22, ym, zm + 0.8), (0.14, 0.42, 1.6), DARK)
        m.box((sx * 0.3, ym, zm + 1.3), (0.03, 0.2, 0.2), IRON)
    m.box((0, ym + 0.3, zm + 0.12), (0.6, 0.12, 0.24), DARK)
    spar(m, (0, ym, zm), (0, ym + 0.3, zm + H), 0.17, 0.08, DARK, cap=True, sides=8)
    X.post((0, ym, zm), (0, ym, zm + 2.0), 0.6)
    top = V(0, ym + 0.3, zm + H)
    m.box(top + V(0, 0, 0.08), (0.2, 0.2, 0.16), DARK)
    m.box(top - V(0, 0, 0.9), (0.42, 0.12, 0.08), DARK)  # the crosstrees for the shrouds
    pennant(m, top + V(0, 0, 0.3), 1.6, h=0.28)
    zbm = ztop + rise + 0.55
    blen = 9.0
    boom_a, boom_b = V(0, ym + 0.25, zbm), V(0, ym + blen, zbm + 0.35)
    spar(m, boom_a, boom_b, 0.11, 0.08)
    gaff_a, gaff_b = V(0, ym + 0.35, zbm + 0.5), V(0, ym + blen * 0.72, zbm + 0.72)
    spar(m, gaff_a, gaff_b, 0.09, 0.06)
    gaff_jaws(m, top, gaff_a, gaff_b, 0.13)
    bundle(m, boom_a.lerp(gaff_a, 0.5) + V(0, 0.4, 0.05), boom_b.lerp(gaff_b, 0.4) + V(0, -0.8, 0.12), 0.32, CANVAS, n=7, sides=6)
    for p in (top - V(0, 0, 0.5), top - V(0, 0, 0.3)):
        block(m, p + V(0, 0.16, -0.12), 0.07)
    block(m, boom_b + V(0, -0.15, 0.12), 0.06)
    pin_rail(m, -0.7, 0.7, ym + 0.55, zm + 0.85, n=5, seed=2)
    for f in (0.25, 0.45, 0.65, 0.85):
        p = boom_a.lerp(boom_b, f)
        rope_path(m, [p + V(0.3, 0, 0.1), p + V(0, 0, 0.55), p + V(-0.3, 0, 0.1)], 0.02, ROPE)
    rig(m, top - V(0, 0, 0.5), gaff_b)
    rig(m, top - V(0, 0, 0.3), boom_b)
    # the boom's crutch on the hatches
    for sx in (1, -1):
        m.beam((sx * 0.25, boom_b.y - 0.6, ztop + rise * 0.95), (0, boom_b.y - 0.6, boom_b.z - 0.08), 0.06, 0.06, DARK)
    stem = V(0, hull.y(1.0, sheer(1.0)) + 0.25, sheer(1.0) + 0.1)
    rig(m, top - V(0, 0, 0.4), stem, 0.028)
    bundle(m, stem + V(0, 0.3, 0.25), stem.lerp(top, 0.2) + V(0, 0.4, -0.3), 0.22, CANVAS, n=4, sides=5)
    for sx in (1, -1):
        for dt in (0.01, -0.02):
            t = tm + dt
            rig(m, top - V(0, 0, 0.9) + V(sx * 0.2, 0, 0), hull.P(t, sheer(t), sx) + V(0, 0, 0.05), 0.022)
            m.box(hull.P(t, sheer(t) - 0.15, sx) + V(sx * 0.1, 0, 0), (0.04, 0.12, 0.35), IRON)
        t = tm - 0.12
        rig(m, top - V(0, 0, 0.6), hull.P(t, sheer(t), sx, 0.05) + V(0, 0, 0.05), 0.018)
    # leeboards, swung up, with their winches on deck
    tl = 0.63
    for sx in (1, -1):
        piv = hull.P(tl, sheer(tl) - 0.12, sx) + V(sx * 0.05, 0, 0)
        foot = leeboard(m, piv, 4.6, 1.8, sx, angle=0.5)
        wp = hull.P(tl - 0.06, zd(tl - 0.06), sx, 0.45)
        windlass(m, wp.x, wp.y, wp.z + 0.32, w=0.5, r=0.09)
        X.solid((wp.x, wp.y, wp.z + 0.3), (0.8, 0.5, 0.6))
        rig(m, foot, wp + V(0, 0, 0.35), 0.02)
    # foredeck: the windlass with its chain to the hawse, anchors, bitts, the crew's hatch with its chimney
    X.deck(hull, zd, h1, 1.0, 0.1)
    tw = 0.93
    yw = hull.y(tw, zd(tw))
    windlass(m, 0, yw, zd(tw) + 0.35, w=1.3, r=0.17)
    for sx in (1, -1):
        m.beam((sx * 0.75, yw - 0.25, zd(tw) + 0.55), (sx * 0.75, yw + 0.35, zd(tw) + 0.85), 0.05, 0.05, IRON)  # the brake levers
        hp = hull.P(0.975, sheer(0.975) - 0.1, sx, 0.25)
        chain(m, V(sx * 0.35, yw, zd(tw) + 0.3), hp, sag=0.05)
        with m.at(move(*(hull.P(0.975, sheer(0.975) - 0.25, sx) + V(sx * 0.02, 0, 0))) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
            m.lathe([(0.11, -0.03), (0.13, 0.0), (0.13, 0.05)], 8, IRON, smooth=False)
    X.solid((0, yw, zd(tw) + 0.4), (1.8, 0.7, 0.8))
    ta = 0.885
    with m.at(move(1.0, hull.y(ta, zd(ta)), zd(ta) + 0.12) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        anchor(m, V(0, 0, 0), side=(0, 1, 0), size=0.6)
    anchor(m, hull.P(0.955, sheer(0.955) - 0.05, -1, -0.15), side=(1, 0, 0.3), size=0.55)
    for t in (0.975, 0.02):
        for sx in (1, -1):
            bollard_pair(m, sx * 0.62, hull.y(t, zd(t)), zd(t), 0.5)
            X.solid((sx * 0.62, hull.y(t, zd(t)), zd(t) + 0.25), (0.3, 0.6, 0.5))
    for t in (0.3, 0.5, 0.7):
        for sx in (1, -1):
            cleat(m, hull.P(t, zd(t), sx, 0.3))
    tf = 0.87
    yf = hull.y(tf, zd(tf))
    m.box((-0.9, yf, zd(tf) + 0.25), (0.8, 0.9, 0.5), GREEN, tile=1.0)
    m.box((-0.9, yf + 0.05, zd(tf) + 0.52), (0.9, 0.6, 0.05), DARK)
    X.solid((-0.9, yf, zd(tf) + 0.25), (0.8, 0.9, 0.5))
    chimney(m, -0.9, yf - 0.32, zd(tf) + 0.5, 0.45, 0.06)
    for t, x, r in ((0.97, -0.8, 0.3), (0.955, 0.8, 0.26), (0.03, 0.9, 0.28), (0.66, 1.9, 0.24)):
        coil(m, (x, hull.y(t, zd(t)), zd(t)), r)
    # a tarpaulin rolled on the foredeck, the towing line flaked down by the bitts
    bundle(m, (0.9, hull.y(0.79, zd(0.79)), zd(0.79) + 0.2), (1.8, hull.y(0.86, zd(0.86)), zd(0.86) + 0.2), 0.2, TARP, n=5, sides=6)
    coil(m, (-0.2, hull.y(0.955, zd(0.955)), zd(0.955)), 0.42)
    coil(m, (-0.2, hull.y(0.955, zd(0.955)), zd(0.955) + 0.1), 0.34)
    # fenders and fender planks over the side
    for sx in (1, -1):
        for t in (0.3, 0.5, 0.7):
            fender(m, hull.P(t, sheer(t), sx, 0.04), sx, drop=0.55, r=0.14)
        for t in (0.4, 0.6):
            fender_board(m, hull.P(t, sheer(t) - 0.02, sx), sx, 1.0)

    # her names: cream capitals on the bows, the owner and port round the stern (W3 names atlas; docs/boats.md)
    tn = 0.925
    for sx, key in ((1, "bow_p"), (-1, "bow_s")):
        X.hull_board(key, hull, tn, sheer(tn) - 0.66, 3.0, 0.4, sx, off=0.05)
    X.stern_board("stern", hull, sheer(0) - 0.68, 2.7, 0.5, off=0.05)
    return m


# ------------------------------------------------------------------ the Zeeland hengst


HG = dict(L=21.0, B=5.3, D=1.35, F=0.8, E=0.95, Eb=0.5)


def hengst(sailing=False):
    """A Zeeland hengst (Arnemuiden): a round-bowed fishing craft with leeboards and a gaff rig of tanned sails, the
    wet well (bun) amidships, the beam trawl along the rail, nets and baskets, a small roef aft (the family aboard,
    Godot ShipLife.cs: deck = sheer - 0.28)."""
    m = Mesh(ao=0.0)
    X = Contract(m)
    L, B, D, F, E, Eb = HG["L"], HG["B"], HG["D"], HG["F"], HG["E"], HG["Eb"]
    tb0, ts0 = 0.78, 0.16

    def keel(t):
        return -D + 0.6 * D * sm((t - 0.9) / 0.1) + 0.35 * D * sm((0.07 - t) / 0.07)

    def sheer(t):
        return F + E * abs(2 * t - 1) ** 3 + Eb * max(0.0, (t - 0.8) / 0.2) ** 2

    def hb(t, z):
        u = cl((z + D) / (D + F))
        sec = 0.8 + 0.2 * sm(u / 0.45) + 0.03 * u
        if t > tb0:
            f = (t - tb0) / (1 - tb0)
            p = (1 - min(f, 1.0) ** 1.9) ** 0.55
        elif t < ts0:
            f = (ts0 - t) / ts0
            p = (1 - min(f, 1.0) ** 2.0) ** 0.55
        else:
            p = 1.0
        p = p ** (1 + 0.9 * (1 - u))
        return max(0.03, B / 2 * sec * p)

    def yfn(t, z):
        u = cl((z + D) / (D + F + E))
        return -0.9 * u ** 1.4 * sm((t - 0.88) / 0.12) + 0.45 * u ** 1.3 * sm((0.09 - t) / 0.09)

    ts = [0, 0.004, 0.01, 0.02, 0.032, 0.048, 0.068, 0.092, 0.12, 0.16, 0.2, 0.26, 0.33, 0.4, 0.47, 0.54, 0.61, 0.68,
          0.74, 0.78, 0.81, 0.84, 0.87, 0.895, 0.918, 0.938, 0.955, 0.97, 0.982, 0.991, 0.997, 1.0]
    wl = -0.05

    def lv(f):
        return lambda t: keel(t) + (wl - keel(t)) * f

    levels = [keel, lv(0.07), lv(0.2), lv(0.4), lv(0.65), lambda t: wl, lambda t: 0.3, lambda t: sheer(t) - 0.4,
              lambda t: sheer(t) - 0.24, sheer]
    mats = [(TARWEED, 0)] * 5 + [(TAR, 0), (TAR, 0), (TAR, 0), (GREEN, 3.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=yfn, shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    hull_skin(m, hull)
    hull.wale(m, lambda t: sheer(t) - 0.24, 0.015, 0.985, h=0.15, out=0.08)
    hull.wale(m, lambda t: 0.1 + 0.5 * (sheer(t) - F), 0.04, 0.96, h=0.12, out=0.06)
    hull.wale(m, lambda t: sheer(t) - 0.26, 0.03, 0.97, h=0.03, out=0.09, mat=WHITE, shade=1.0)
    for sx in (1, -1):
        hull.decal(m, 0.95, sheer(0.95) - 0.3, 0.7, 1.0, sx)
        hull.decal(m, 0.6, sheer(0.6) - 0.35, 0.5, 0.7, sx, u=(0.5, 1.0))
        hull.decal(m, 0.25, sheer(0.25) - 0.3, 0.9, 0.6, sx, u=(0.0, 0.6))

    def zd(t):
        return sheer(t) - 0.28

    hull.deck(m, zd, 0, 1, 0.07, DECK)
    hull.rail(m, zd, sheer, 0, 1, 0.08, GREEN, DARK)
    for t in [0.05 + 0.9 * k / 18 for k in range(19)]:
        for sx in (1, -1):
            p = hull.P(t, zd(t), sx, 0.12)
            m.box(p + V(0, 0, (sheer(t) - zd(t)) / 2), (0.07, 0.08, sheer(t) - zd(t)), GREEN, shade=0.75)
    # the stem head standing above the bow, its knightheads
    stem_t = hull.y(1.0, sheer(1.0))
    m.beam((0, stem_t + 0.15, sheer(1.0) - 0.6), (0, stem_t - 0.05, sheer(1.0) + 0.55), 0.2, 0.22, DARK)
    m.box((0, stem_t - 0.03, sheer(1.0) + 0.6), (0.26, 0.26, 0.1), GREEN)

    # the roef aft: a low cabin with the stove (the family's)
    c0, c1 = 0.055, 0.17
    cabw = 1.55
    y0, y1 = hull.y(c1, zd(c1)), hull.y(c0, zd(c0))
    zb = min(zd(c0), zd(c1)) - 0.1
    zt = max(zd(c0), zd(c1)) + 1.05
    X.deck(hull, zd, 0.0, c0, 0.1)
    X.deck(hull, zd, c0, c1, 0.1, x0=cabw + 0.05)
    ridge, _ = roef(m, X, -cabw, cabw, y0, y1, zb, zt, wall=BOARDS, trim=GREEN, roof=TAR, rise=0.16, wins_side=1,
                    curtain=1, door_side="-y", door_x=0.68, skylight=False, pots=2, seed=5, shutters=GREEN)
    barrel_lo(m, (cabw * 0.75, y0 - 0.5, zd(c1 + 0.01)), yaw=0.6)
    bucket(m, (-cabw * 0.7, y0 - 0.45, zd(c1 + 0.01)))
    freeing_ports(m, hull, zd, [0.12 + 0.76 * k / 7 for k in range(8)])
    pipe_top = stovepipe(m, cabw * 0.45, (y0 + y1) / 2 + 0.3, zt + 0.1, 0.7, 0.065)
    m.stove(pipe_top)
    lantern(m, V(-cabw + 0.3, y1 - 0.3, zt + 0.18 + 0.16), 0)
    # the rudder and the long curved tiller
    ys = L / 2 + 0.2
    zr = sheer(0)
    with put_over(m, hull.y(0.0, zr) - 0.1, 0.0 if sailing else math.radians(24)):
        rudder(m, ys - 0.2, keel(0.0) + 0.1, sheer(0) - 0.85, 1.26, zr + 0.35, mat=TAR, straps=3, stock_r=0.09,
               post=lambda z: hull.y(0.0, z) + 0.02)
        tiller(m, (0, ys - 0.1, zr + 0.3), (0, y1 - 0.7, zr + 0.62), w=0.13, droop=0.05)
    X.post((0, ys - 0.1, zd(0.01)), (0, ys - 0.1, zr + 0.4), 0.3)
    spar(m, (0.4, ys - 0.45, zr - 0.1), (0.4, ys - 0.25, zr + 2.0), 0.04, 0.03)
    flag(m, (0.4, ys - 0.23, zr + 1.95), 1.1, 0.7, along=(0, 1, -0.1), kind="dutch")

    # the deck amidships: the wet well's hatch with its grating, the fish hatches, baskets and the nets
    X.deck(hull, zd, c1, 1.0, 0.1)
    tb_, tw0, tw1 = 0.3, 0.38, 0.54
    yw0, yw1 = hull.y(tw1, 0), hull.y(tw0, 0)
    zw = zd(0.46)
    m.box((0, (yw0 + yw1) / 2, zw + 0.18), (2.2, abs(yw1 - yw0), 0.36), GREEN, tile=1.0)
    m.box((0, (yw0 + yw1) / 2, zw + 0.37), (2.3, abs(yw1 - yw0) + 0.1, 0.04), DARK)
    for k in range(7):
        y = yw0 + (yw1 - yw0) * (k + 0.5) / 7
        m.box((0, y, zw + 0.41), (1.9, 0.12, 0.04), WOOD, shade=0.85)
    for k in range(4):
        x = -0.75 + 0.5 * k
        m.box((x, (yw0 + yw1) / 2, zw + 0.395), (0.05, abs(yw1 - yw0) - 0.1, 0.03), DARK)
    X.top((0, (yw0 + yw1) / 2, zw + 0.43), (2.3, abs(yw1 - yw0) + 0.1))
    for t in (tb_, 0.62):
        y = hull.y(t, 0)
        m.box((0, y, zd(t) + 0.12), (1.3, 1.1, 0.24), GREEN, tile=1.0)
        hatch_boards(m, -0.7, 0.7, y - 0.6, y + 0.6, zd(t) + 0.25, 0.08, seed=int(t * 100), board=0.4, X=X)
    # the beam trawl (kor) lashed along the starboard rail, its two iron heads standing on the deck
    ka, kb = 0.2, 0.68
    pa, pb = hull.P(ka, sheer(ka) + 0.08, -1, 0.05), hull.P(kb, sheer(kb) + 0.08, -1, 0.05)
    m.tube([pa, pb], [0.09, 0.09], 8, DARK, side=(0, 0, 1), smooth=False, urep=1, vscale=0.5, cap0=True, cap1=True)
    for p in (pa, pb):
        ring = []
        for k in range(9):
            a = math.pi * k / 8
            ring.append(p + V(0.05 + 0.4 * math.sin(a), 0, -0.55 * (1 - math.cos(a)) + 0.0))
        m.tube(ring, [0.03] * len(ring), 4, IRON, side=(0, 1, 0), smooth=False)
        m.box(p + V(0.3, 0, -1.08), (0.6, 0.14, 0.06), IRON)
    # the net bundled along the trawl beam, a second net hung to dry from the boom
    bundle(m, pa.lerp(pb, 0.08) + V(0.45, 0, 0.0), pa.lerp(pb, 0.92) + V(0.45, 0, 0.05), 0.24, NET, n=8, sides=6)
    rope_path(m, [pa + V(0.3, 0, 0.1), pa.lerp(pb, 0.5) + V(0.5, 0, 0.35), pb + V(0.3, 0, 0.1)], 0.02, ROPE)
    for t, x, k in ((0.25, 1.4, 0), (0.27, 1.75, 1), (0.6, 1.5, 2), (0.21, 1.6, 3)):
        basket2(m, (x, hull.y(t, 0), zd(t)), 0.25, 0.34)
    basket2(m, (1.55, hull.y(0.25, 0) + 0.15, zd(0.25) + 0.34), 0.24, 0.3)
    m.box((-1.4, hull.y(0.6, 0), zd(0.6) + 0.18), (0.7, 0.5, 0.36), CRATE, mode="fit")
    # the trawl warp flaked down by the mast, a dan buoy, fish boxes (bennen) stacked
    coil(m, (-1.2, hull.y(0.68, zd(0.68)), zd(0.68)), 0.45)
    coil(m, (-1.2, hull.y(0.68, zd(0.68)), zd(0.68) + 0.1), 0.38)
    dan_buoy(m, hull.P(0.33, zd(0.33) + 0.05, 1, 0.5), hull.P(0.5, zd(0.5) + 0.05, 1, 0.45))
    for k in range(3):
        m.box((-1.55, hull.y(0.44, 0), zd(0.44) + 0.12 + 0.25 * k), (0.6, 0.45, 0.24), WOOD, shade=0.8 + 0.06 * k, mode="fit")
    X.solid((-1.55, hull.y(0.44, 0), zd(0.44) + 0.4), (0.6, 0.45, 0.8))
    X.solid((1.5, hull.y(0.25, 0), zd(0.25) + 0.35), (1.0, 1.2, 0.7))
    # mast, boom over the stern, the curved gaff, bowsprit; furled or set
    tm = 0.72
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    H = 16.5
    for sx in (1, -1):
        m.box((sx * 0.24, ym, zm + 0.7), (0.14, 0.42, 1.4), DARK)
    spar(m, (0, ym, zm), (0, ym + 0.25, zm + H), 0.2, 0.09, DARK, cap=True, sides=8)
    X.post((0, ym, zm), (0, ym, zm + 2.0), 0.6)
    top = V(0, ym + 0.25, zm + H)
    m.box(top + V(0, 0, 0.08), (0.22, 0.22, 0.16), DARK)
    pennant(m, top + V(0, 0, 0.3), 2.4, h=0.28)
    zbm = zm + 1.55
    blen = 11.5
    boom_a, boom_b = V(0, ym + 0.25, zbm), V(0, ym + blen, zbm + 0.55)
    spar(m, boom_a, boom_b, 0.12, 0.08, sides=7)
    if sailing:
        gaff_a = V(0, ym + 0.4, zm + H * 0.68)
        g1 = gaff_a + V(0, 3.5 * math.cos(0.5), 3.5 * math.sin(0.5))
        gaff_b = g1 + V(0, 3.0 * math.cos(0.75), 3.0 * math.sin(0.75))
    else:
        gaff_a = V(0, ym + 0.35, zbm + 0.5)
        g1, gaff_b = V(0, ym + 3.8, zbm + 0.75), V(0, ym + 7.2, zbm + 0.95)
    spar(m, gaff_a, g1, 0.1, 0.08)
    spar(m, g1, gaff_b, 0.08, 0.05)
    gaff_jaws(m, top, gaff_a, g1, 0.15)
    for p in (top - V(0, 0, 0.5), top - V(0, 0, 0.3), top - V(0, 0, 0.7)):
        block(m, p + V(0, 0.18, -0.12), 0.07)
    block(m, boom_b + V(0, -0.15, 0.12), 0.06)
    pin_rail(m, -0.8, 0.8, ym + 0.6, zm + 0.8, n=6, seed=3)
    if sailing:
        mast_hoops(m, (0, ym + 0.05, zbm + 0.5), (0, ym + 0.2, zm + H * 0.66), 0.17, n=9)
    else:
        mast_hoops(m, (0, ym + 0.02, zbm + 0.35), (0, ym + 0.04, zbm + 1.0), 0.19, n=8)
    if sailing:
        sail(m, gaff_a + V(0, 0.25, -0.15), gaff_b + V(0, -0.2, -0.15), boom_a + V(0, 0.35, 0.2), boom_b + V(0, -0.4, 0.2),
             V(1.2, 0, 0), nu=6, nv=6, mat=TAN)
    else:
        bundle(m, boom_a.lerp(gaff_a, 0.5) + V(0, 0.4, 0.0), boom_b.lerp(gaff_b, 0.4) + V(0, -0.8, 0.08), 0.32, TAN, n=8, sides=7)
        for f in (0.2, 0.4, 0.6, 0.8):
            p = boom_a.lerp(boom_b, f)
            rope_path(m, [p + V(0.35, 0, 0.08), p + V(0, 0, 0.75), p + V(-0.35, 0, 0.08)], 0.02, ROPE)
        # a net hung over the boom to dry
        a = boom_a.lerp(boom_b, 0.28) - V(0, 0, 0.1)
        b = boom_a.lerp(boom_b, 0.55) - V(0, 0, 0.1)
        for sx in (1, -1):
            m.poly([a + V(sx * 0.08, 0, 0), b + V(sx * 0.08, 0, 0), b + V(sx * 0.5, 0, -1.0), a + V(sx * 0.4, 0, -1.25)], NET,
                   out=(sx, 0, 0), uvs=[(0, 0), (3, 0), (3, 1.8), (0, 2.2)])
    rig(m, top - V(0, 0, 0.5), gaff_b)
    rig(m, top - V(0, 0, 0.3), boom_b)
    rig(m, top - V(0, 0, 0.7), g1)
    # the bowsprit and the stays
    bs_a = V(0.25, stem_t + 0.6, 2.47)
    bs_b = V(0.25, stem_t - 4.8, 3.3)
    spar(m, bs_a, bs_b, 0.1, 0.06)
    m.box((0.25, stem_t + 0.15, sheer(1.0) + 0.02), (0.3, 0.3, 0.12), IRON)
    stem = V(0, stem_t - 0.05, sheer(1.0) + 0.45)
    rig(m, top - V(0, 0, 0.4), stem, 0.03)
    rig(m, top - V(0, 0, 0.2), bs_b, 0.024)
    if sailing:
        head = stem.lerp(top - V(0, 0, 0.4), 0.62)
        sail(m, head, head, stem + V(0, 0.3, 0.15), V(1.6, stem.y + 5.5, sheer(0.8) + 0.9), V(0.8, 0, 0), nu=3, nv=4, mat=TAN)
        jh = bs_b.lerp(top - V(0, 0, 0.2), 0.7)
        sail(m, jh, jh, bs_b + V(0, 0.3, 0.1), V(1.0, stem.y + 1.0, sheer(0.95) + 0.8), V(0.7, 0, 0), nu=3, nv=4, mat=TAN)
    else:
        bundle(m, stem + V(0, 0.3, 0.05), stem.lerp(top, 0.2) + V(0, 0.4, -0.3), 0.24, TAN, n=4, sides=5)
        bundle(m, bs_a.lerp(bs_b, 0.3) + V(0, 0, 0.12), bs_b + V(0, 0.4, 0.12), 0.14, TAN, n=4, sides=5)
    for sx in (1, -1):
        for dt in (0.012, -0.012, -0.035):
            t = tm + dt
            rig(m, top - V(0, 0, 0.9), hull.P(t, sheer(t), sx) + V(0, 0, 0.05), 0.022)
            m.box(hull.P(t, sheer(t) - 0.15, sx) + V(sx * 0.1, 0, 0), (0.04, 0.12, 0.35), IRON)
        t = tm - 0.2
        rig(m, top - V(0, 0, 0.6), hull.P(t, sheer(t), sx, 0.05) + V(0, 0, 0.05), 0.018)
    # leeboards, swung up
    tl = 0.6
    for sx in (1, -1):
        piv = hull.P(tl, sheer(tl) - 0.12, sx) + V(sx * 0.05, 0, 0)
        foot = leeboard(m, piv, 4.3, 1.55, sx, angle=0.62)
        rig(m, foot, hull.P(tl - 0.08, sheer(tl - 0.08), sx) + V(0, 0, 0.2), 0.02)
    # foredeck: the windlass, bitts, the anchor, the crew's hatch (vooronder) with a chimney
    tw = 0.9
    yw = hull.y(tw, zd(tw))
    windlass(m, 0, yw, zd(tw) + 0.35, w=1.1, r=0.17)
    X.solid((0, yw, zd(tw) + 0.4), (1.6, 0.7, 0.8))
    for sx in (1, -1):
        hp = hull.P(0.965, sheer(0.965) - 0.12, sx, 0.25)
        chain(m, V(sx * 0.3, yw, zd(tw) + 0.3), hp, sag=0.05)
    with m.at(move(0.95, hull.y(0.85, zd(0.85)), zd(0.85) + 0.12) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        anchor(m, V(0, 0, 0), side=(0, 1, 0), size=0.55)
    for t in (0.97, 0.025):
        for sx in (1, -1):
            bollard_pair(m, sx * 0.5, hull.y(t, zd(t)), zd(t), 0.45, w=0.16, gap=0.3)
    tf = 0.82
    yf = hull.y(tf, zd(tf))
    m.box((-0.75, yf, zd(tf) + 0.22), (0.75, 0.8, 0.44), GREEN, tile=1.0)
    m.box((-0.75, yf, zd(tf) + 0.46), (0.85, 0.55, 0.05), DARK)
    X.solid((-0.75, yf, zd(tf) + 0.22), (0.75, 0.8, 0.44))
    chimney(m, -0.75, yf - 0.3, zd(tf) + 0.45, 0.4, 0.06)
    for t, x, r in ((0.955, -0.7, 0.28), (0.035, 0.85, 0.26), (0.5, 1.6, 0.24)):
        coil(m, (x, hull.y(t, zd(t)), zd(t)), r)
    for sx in (1, -1):
        for t in (0.3, 0.5):
            fender(m, hull.P(t, sheer(t), sx, 0.04), sx, drop=0.55, r=0.14)
    # her names: cream shaded capitals on the round bows, her home port round the stern
    tn = 0.905
    for sx, key in ((1, "bow_p"), (-1, "bow_s")):
        X.hull_board(key, hull, tn, sheer(tn) - 0.62, 3.2, 0.42, sx, off=0.05)
    X.stern_board("stern", hull, sheer(0) - 0.62, 2.4, 0.38, off=0.05)
    return m


def barge(kind, sailing=False):
    """The builder by its old name: barge('rhine') is the Rhine barge, barge('hengst', sailing) the hengst."""
    return rhine_barge() if kind == "rhine" else hengst(sailing)


# ------------------------------------------------------------------ the lighters (lichters)


# each of the five in her owner's colours (docs/boats.md: the owners are on fleet.json), her wear and her sheer
LIGHTERS = {
    # empty: a Boom lighterman's, tarred with a white top strake and a red sheer line; well kept
    False: dict(top=WHITE, line=REDLEAD, rail=DARK, tint=(1.0, 1.0, 1.0), E=0.42, Eb=0.14, wear=0.35, seed=11),
    # sacks and casks: an Antwerp owner's, green top strake with a white line, varnished hatch beams
    True: dict(top=GREEN, line=WHITE, rail=DARK, tint=(1.0, 1.0, 1.0), E=0.35, Eb=0.12, wear=0.5, seed=12),
    # coal: black all over and sooty, old fender planks, the most worn
    "coal": dict(top=TAR, line=TAR, rail=TAR, tint=(0.82, 0.8, 0.78), E=0.28, Eb=0.08, wear=1.0, seed=13),
    # sand: a Rupel brickworks' boat, blue-grey top strake, sun-bleached planks
    "sand": dict(top=WHITE, line=WHITE, rail=WOOD, tint=(0.62, 0.74, 0.86), E=0.32, Eb=0.1, wear=0.8, seed=14),
    # timber: a Temse yard's, red-lead top strake with a white line, the ends higher for the deck load
    "timber": dict(top=REDLEAD, line=WHITE, rail=DARK, tint=(1.0, 1.0, 1.0), E=0.45, Eb=0.18, wear=0.6, seed=15),
}


def drape(m, hull, t0, t1, zf, seed=1, nu=10, nv=7):
    """A tarpaulin thrown over a stack of casks in the hold: high over the casks, sagging between them, hanging down
    to the floor at its edges."""
    rnd = random.Random(seed)
    P = []
    for j in range(nu + 1):
        t = t0 + (t1 - t0) * j / nu
        w = hull.hb(t, zf + 0.5) - 0.3
        row = []
        for i in range(nv + 1):
            u = i / nv
            x = -w + 2 * w * u
            e = min(u, 1 - u, j / nu, 1 - j / nu) * 2
            h = 1.12 - 0.1 * (0.5 + 0.5 * math.cos(x * 4.2)) * (0.5 + 0.5 * math.cos(j * 2.1))
            h = 0.35 + (h - 0.35) * min(1.0, e * 3.2) ** 0.7
            if 0 < i < nv and 0 < j < nu:
                h += rnd.uniform(-0.03, 0.03)
            row.append(V(x * (1.0 + 0.06 * (1 - min(1.0, e * 3))), hull.y(t, zf), zf + h))
        P.append(row)
    for j in range(nu):
        for i in range(nv):
            q = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]
            m.poly(q, TARP, out=(0, 0, 1), uvs=[(p.x / 1.6, p.y / 1.6) for p in q], shade=0.85 + 0.15 * rnd.random())
    for j in (2, 5, 8):
        rope_path(m, [P[j][0] + V(0, 0, 0.02), P[j][nv // 2] + V(0, 0, 0.03), P[j][nv] + V(0, 0, 0.02)], 0.015, ROPE)


def lighter(loaded):
    """An Antwerp lighter (lichter): an open cargo boat, towed or poled, bluff ends, a small deck at each end, the
    forepeak cuddy with its stove, heavy wales. loaded: False (empty), True (sacks and casks), "coal", "sand" or
    "timber"; each in her own owner's colours and wear (LIGHTERS)."""
    m = Mesh(ao=0.0)
    X = Contract(m)
    S = LIGHTERS[loaded]
    rnd = random.Random(S["seed"])
    L, B, D = 17.0, 4.4, 0.8

    def keel(t):
        return -D + 0.4 * sm((t - 0.88) / 0.12) + 0.22 * sm((0.08 - t) / 0.08)

    def sheer(t):
        return 1.0 + S["E"] * abs(2 * t - 1) ** 3 + S["Eb"] * max(0.0, (t - 0.8) / 0.2) ** 2

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

    ts = [0, 0.005, 0.012, 0.022, 0.035, 0.05, 0.07, 0.1, 0.15, 0.22, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.78, 0.84,
          0.865, 0.89, 0.912, 0.932, 0.95, 0.966, 0.979, 0.99, 0.997, 1.0]
    wl = -0.05
    levels = [keel, lambda t: keel(t) + (wl - keel(t)) * 0.1, lambda t: keel(t) + (wl - keel(t)) * 0.35,
              lambda t: keel(t) + (wl - keel(t)) * 0.7, lambda t: wl, lambda t: 0.4, lambda t: sheer(t) - 0.4,
              lambda t: sheer(t) - 0.2, sheer]
    mats = [(TARWEED, 0)] * 4 + [(TAR, 0), (TAR, 0), (S["top"], 2.0), (S["top"], 2.0)]
    hull = Hull(L, ts, levels, hb, mats, yfn=lambda t, z: -0.35 * cl((z + D) / 1.8) * sm((t - 0.9) / 0.1),
                shade=lambda p: 0.55 + 0.45 * sm((p.z + D) / (D + 1.2)))
    tint = S["tint"]
    if tint != (1.0, 1.0, 1.0):
        # the owner's colour laid over the painted strakes (the vertex colour multiplies the paint)
        def own_tint(p, base=waterline_tint):
            r, g, b = base(p)
            if p.z > 0.55:
                return (r * tint[0], g * tint[1], b * tint[2])
            return (r, g, b)
        hull.tint = False
        m.tintfn = own_tint
        hull_skin(m, hull)
        m.tintfn = None
    else:
        hull_skin(m, hull)
    # heavy wales, the owner's sheer line, rust and soot runs
    hull.wale(m, lambda t: sheer(t) - 0.18, 0.02, 0.98, h=0.16, out=0.09, mat=S["top"], shade=0.85)
    hull.wale(m, lambda t: sheer(t) + 0.01, 0.02, 0.98, h=0.06, out=0.04, mat=S["rail"], shade=0.8)
    hull.wale(m, lambda t: sheer(t) - 0.66, 0.04, 0.96, h=0.14, out=0.075)
    if S["line"] != S["top"]:
        hull.wale(m, lambda t: sheer(t) - 0.36, 0.03, 0.97, h=0.035, out=0.01, mat=S["line"], shade=1.0)
    for sx in (1, -1):
        hull.decal(m, 0.93, sheer(0.93) - 0.25, 0.6, 0.8, sx)
        for k in range(int(2 + 4 * S["wear"])):
            t = rnd.uniform(0.15, 0.85)
            hull.decal(m, t, sheer(t) - 0.3, rnd.uniform(0.4, 0.8), rnd.uniform(0.4, 0.8), sx, u=(rnd.uniform(0, 0.4), rnd.uniform(0.6, 1.0)))
        for t in (0.3, 0.62):
            fender(m, hull.P(t, sheer(t), sx, 0.04), sx, drop=0.5, r=0.13)
        if loaded in ("coal", "sand"):
            for t in (0.2, 0.45, 0.72):
                fender_board(m, hull.P(t, sheer(t) - 0.02, sx), sx, 0.85)
    zf = 0.24  # the hold floor sits above the game's water sheet (waves reach about 0.2 m)
    tf0, tf1 = 0.1, 0.86
    hull.inner(m, [lambda t: zf, lambda t: zf + 0.35, sheer], tf0, tf1, 0.08, WOOD, DECK)
    hull.cap(m, sheer, tf0, tf1, 0.08, DARK)
    ribs(m, hull, [tf0 + (tf1 - tf0) * (k + 0.5) / 14 for k in range(14)], lambda t: zf, lambda t: sheer(t) - 0.05, 0.08,
         w=0.1, mat=DARK)
    # the ceiling's stringer along the frames, and the limber boards over the keelson
    for sx in (1, -1):
        T = hull.span(tf0 + 0.01, tf1 - 0.01)
        for ta, tb in zip(T, T[1:]):
            m.beam(hull.P(ta, zf + 0.62, sx, 0.15), hull.P(tb, zf + 0.62, sx, 0.15), 0.06, 0.16, DARK, side=(0, 0, 1))

    def zd(t):
        return sheer(t) - 0.2

    hull.deck(m, zd, tf1, 1.0, 0.07, DECK)
    hull.deck(m, zd, 0.0, tf0, 0.07, DECK)
    hull.rail(m, zd, sheer, tf1, 1.0, 0.08, DARK, DARK, end0=False)
    hull.rail(m, zd, sheer, 0.0, tf0, 0.08, DARK, DARK, end0=True)
    X.deck(hull, zd, tf1, 1.0, 0.08)
    X.deck(hull, zd, 0.0, tf0, 0.08)
    # the hold's ends: the bulkheads under the decks
    for t, dy in ((tf0, -1), (tf1, 1)):
        y = hull.y(t, 0)
        w = hb(t, sheer(t)) - 0.1
        m.poly([V(-w, y, zf), V(w, y, zf), V(w, y, zd(t)), V(-w, y, zd(t))], WOOD, out=(0, -dy, 0), shade=0.7)
        m.beam((-w, y - dy * 0.05, zd(t) - 0.04), (w, y - dy * 0.05, zd(t) - 0.04), 0.1, 0.1, DARK)
    # cross beams over the hold, the derrick post, the forepeak cuddy with its stove
    beam_mat = WOOD if loaded is True else DARK
    for t in (0.36, 0.62):
        y = hull.y(t, 0)
        w = hb(t, sheer(t) - 0.12) - 0.08
        m.beam((-w, y, sheer(t) - 0.12), (w, y, sheer(t) - 0.12), 0.16, 0.14, beam_mat, side=(0, 1, 0))
        for sx in (1, -1):
            m.box((sx * (w - 0.05), y, sheer(t) - 0.24), (0.1, 0.3, 0.1), DARK)
    ym = hull.y(0.8, 0)
    spar(m, (0, ym, zf), (0, ym, 4.6), 0.12, 0.09, DARK, cap=True, sides=7)
    m.box((0, ym, zf + 0.6), (0.34, 0.34, 1.2), DARK)  # the mast's step and partners
    X.post((0, ym, zf), (0, ym, 2.0), 0.5)
    pennant(m, (0, ym, 4.75), 0.9, h=0.2)
    rig(m, (0, ym, 4.4), (0, hull.y(1, sheer(1)) + 0.2, sheer(1) + 0.05))
    for sx in (1, -1):
        rig(m, (0, ym, 4.2), hull.P(0.78, sheer(0.78), sx) + V(0, 0, 0.05), 0.02)
    # the derrick's boom lowered along the hold, its tackle hanging from the mast
    spar(m, (0, ym + 0.15, zf + 1.2), (0.2, ym + 4.2, sheer(0.62) + 0.1), 0.07, 0.05)
    rig(m, (0, ym, 4.1), (0.2, ym + 4.1, sheer(0.62) + 0.12))
    lantern(m, V(0.18, ym, 3.1), 0)
    tc = 0.93
    yc = hull.y(tc, zd(tc))
    m.box((0.55, yc, zd(tc) + 0.2), (0.8, 0.7, 0.4), S["top"] if S["top"] != TAR else DARK, tile=1.0)
    m.box((0.55, yc, zd(tc) + 0.42), (0.9, 0.8, 0.05), DARK)
    X.solid((0.55, yc, zd(tc) + 0.2), (0.8, 0.7, 0.4))
    pipe_top = stovepipe(m, 0.75, yc - 0.18, zd(tc) + 0.44, 0.42, 0.055)
    m.stove(pipe_top)
    windlass(m, -0.55, hull.y(0.905, zd(0.905)), zd(0.905) + 0.3, w=0.9, r=0.13)
    X.solid((-0.55, hull.y(0.905, zd(0.905)), zd(0.905) + 0.3), (1.2, 0.6, 0.6))
    # rudder and tiller
    ys = L / 2
    k0, zr = keel(0), sheer(0)
    with put_over(m, hull.y(0.0, zr) - 0.05, math.radians(20)):
        rudder(m, ys, k0 + 0.1, sheer(0) - 0.7, 1.0, zr + 0.25, mat=TAR, straps=2, stock_r=0.07, cap=S["top"],
               post=lambda z: hull.y(0.0, z) + 0.02)
        tiller(m, (0, ys + 0.1, zr + 0.2), (0.0, ys - 2.1, zr + 0.42), w=0.1)
    for t in (0.975, 0.03):
        for sx in (1, -1):
            bollard_pair(m, sx * 0.45, hull.y(t, zd(t)), zd(t), 0.45, w=0.16, gap=0.28, along=(1, 0, 0))
            X.solid((sx * 0.45, hull.y(t, zd(t)), zd(t) + 0.22), (0.5, 0.25, 0.45))
    # a long sweep and a quant pole along the gunwale
    m.beam((1.6, hull.y(0.2, 0), sheer(0.2) + 0.06), (1.7, hull.y(0.7, 0), sheer(0.7) + 0.06), 0.07, 0.07, WOOD)
    boathook(m, (-1.65, hull.y(0.25, 0), sheer(0.25) + 0.05), (-1.7, hull.y(0.75, 0), sheer(0.75) + 0.05))
    coil(m, (-0.5, hull.y(0.95, zd(0.95)), zd(0.95)), 0.26)
    coil(m, (0.6, hull.y(0.04, zd(0.04)), zd(0.04)), 0.24)
    bucket(m, (-0.9, hull.y(0.03, zd(0.03)), zd(0.03)), mat=TAR if loaded == "coal" else None)
    broom(m, (1.1, hull.y(0.09, zd(0.09)), zd(0.09)), (1.3, hull.y(0.085, zd(0.085)) - 0.05, zd(0.09) + 1.2))
    # the load
    if loaded == "coal":
        heap(m, hull, 0.13, 0.84, zf, 1.15, COAL, seed=3, lumps=26, X=X)
        m.beam((0.8, hull.y(0.5, 0), zf + 0.9), (1.6, hull.y(0.62, 0), sheer(0.62) + 0.05), 0.05, 0.05, WOOD)  # a shovel
        m.box((1.62, hull.y(0.62, 0), sheer(0.62) + 0.06), (0.26, 0.22, 0.03), IRON)
        for x, t in ((-1.1, 0.08), (-0.6, 0.06)):
            basket2(m, (x, hull.y(t, 0), zd(t)), 0.26, 0.36, mat=DARK)
        m.box((0.0, hull.y(0.5, 0), sheer(0.5) + 0.05), (3.9, 0.35, 0.05), WOOD, shade=0.7)  # a plank across
    elif loaded == "sand":
        heap(m, hull, 0.13, 0.84, zf, 0.95, SAND, seed=4, lumps=0, X=X)
        m.beam((-0.4, hull.y(0.3, 0), zf + 0.85), (-1.5, hull.y(0.2, 0), sheer(0.2) + 0.05), 0.05, 0.05, WOOD)
        m.box((-1.52, hull.y(0.2, 0), sheer(0.2) + 0.06), (0.26, 0.22, 0.03), IRON)
        # the wheeling plank and a barrow on the aft deck
        m.box((0.0, hull.y(0.12, 0), zd(0.08) + 0.04), (0.4, 1.4, 0.05), WOOD, shade=0.8)
        wb = V(-0.9, hull.y(0.05, 0), zd(0.05))
        m.box(wb + V(0, 0, 0.42), (0.6, 0.8, 0.3), WOOD, shade=0.75)
        for sx in (1, -1):
            m.beam(wb + V(sx * 0.25, 0.4, 0.3), wb + V(sx * 0.28, -0.85, 0.45), 0.05, 0.05, WOOD)
        with m.at(move(*(wb + V(0, 0.55, 0.2))) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
            m.lathe([(0.2, -0.04), (0.2, 0.04)], 8, IRON, smooth=False, cap0=True, cap1=True)
    elif loaded == "timber":
        # squared baulks stowed fore and aft in three tiers, chocked, chained down over the gunwales
        for k, z in enumerate((zf, zf + 0.3, zf + 0.6)):
            n = 6 - k
            for i in range(n):
                x = (i - (n - 1) / 2) * 0.34
                a, b = hull.y(0.16 + 0.02 * k + 0.01 * (i % 2), 0), hull.y(0.8 - 0.02 * k - 0.008 * (i % 3), 0)
                m.box((x, (a + b) / 2, z + 0.14), (0.28, abs(a - b), 0.28), WOOD, shade=0.75 + 0.06 * ((i + k) % 3), mode="fit")
                X.top((x, (a + b) / 2, z + 0.28), (0.28, abs(a - b)))
                m.box((x, a - 0.02, z + 0.14), (0.27, 0.02, 0.27), BARREL, shade=0.9)
        for t in (0.3, 0.6):
            chain(m, hull.P(t, sheer(t), 1, 0.05), V(0, hull.y(t, 0), zf + 0.92), sag=0.0, r=0.025)
            chain(m, V(0, hull.y(t, 0), zf + 0.92), hull.P(t, sheer(t), -1, 0.05), sag=0.0, r=0.025)
        for sx in (1, -1):
            for t in (0.2, 0.45, 0.7):
                m.box(hull.P(t, zf + 0.5, sx, 0.25), (0.16, 0.3, 0.6), DARK)  # the chocks
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
        # dunnage under the sacks, a tarpaulin folded back over the casks' end of the hold
        for x in (-1.2, -0.4, 0.4, 1.2):
            m.box((x, hull.y(0.67, 0), zf + 0.015), (0.18, 3.0, 0.03), WOOD, shade=0.75)
        drape(m, hull, 0.185, 0.335, zf, seed=S["seed"])
        X.floor([hull.P(tf0, zf, -1, 0.1), hull.P(tf0, zf, 1, 0.1), hull.P(tf1, zf, 1, 0.1), hull.P(tf1, zf, -1, 0.1)])
    else:
        # dunnage boards in the empty hold, a hand pump, a tarpaulin rolled on the aft deck
        for x in (-1.2, -0.4, 0.4, 1.2):
            m.box((x, hull.y(0.48, 0), zf + 0.03), (0.22, 7.5, 0.05), WOOD, shade=0.8)
        pp = hull.P(0.15, zf, 1, 0.45)
        with m.at(move(pp.x, pp.y, zf)):
            m.lathe([(0.1, 0), (0.1, 1.1), (0.13, 1.12), (0.13, 1.2)], 7, WOOD, smooth=False, cap1=True)
        m.beam(pp + V(0, 0, 1.15), pp + V(-0.7, 0.1, 1.35), 0.05, 0.05, DARK)
        m.beam(pp + V(0.05, 0, 0.95), pp + V(0.3, 0, 0.92), 0.06, 0.06, WOOD)
        bundle(m, (-1.3, hull.y(0.06, 0), zd(0.06) + 0.18), (1.3, hull.y(0.06, 0), zd(0.06) + 0.18), 0.18, TARP, n=5, sides=6)
        gangplank(m, (0.9, hull.y(0.2, 0), zf + 0.06), (0.9, hull.y(0.5, 0), zf + 0.06), 0.42)
        X.floor([hull.P(tf0, zf, -1, 0.1), hull.P(tf0, zf, 1, 0.1), hull.P(tf1, zf, 1, 0.1), hull.P(tf1, zf, -1, 0.1)])
    # her names: white block letters on a black plank at each bow, the owner and port on a plank across the stern
    tn = 0.9
    for sx, key in ((1, "bow_p"), (-1, "bow_s")):
        X.hull_board(key, hull, tn, sheer(tn) - 0.52, 2.4, 0.26, sx, off=0.06)
        X.plank(m, key, depth=0.06, margin=0.035)
    X.stern_board("stern", hull, sheer(0) - 0.52, 2.0, 0.26, off=0.06)
    X.plank(m, "stern", depth=0.06, margin=0.035)
    return m


# ------------------------------------------------------------------ the Scheldt sloop (hoogaars)


def sloop(sailing=False):
    """A hoogaars of the Scheldt: flat bottom, hard chine, a straight raked stem, a round stern with a big rudder,
    leeboards, one mast with a short curved gaff (tanned sails), a fore cuddy with its stove, an open well aft."""
    m = Mesh(ao=0.0)
    X = Contract(m)
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

    ts = [0, 0.012, 0.03, 0.06, 0.1, 0.15, 0.22, 0.3, 0.38, 0.46, 0.54, 0.61, 0.68, 0.74, 0.8, 0.85, 0.89, 0.925, 0.955,
          0.978, 0.993, 1.0]
    levels = [keel, lambda t: keel(t) + 0.04, lambda t: keel(t) + 0.12, lambda t: 0.5 * keel(t) - 0.02, lambda t: 0.0,
              lambda t: 0.4, lambda t: sheer(t) - 0.2, sheer]
    hull = Hull(L, ts, levels, hb, [(TARWEED, 0)] * 4 + [(TAR, 0), (TAR, 0), (GREEN, 2.0)], yfn=yfn,
                shade=lambda p: 0.55 + 0.45 * sm((p.z + 0.75) / 1.6))
    hull_skin(m, hull)
    hull.wale(m, lambda t: sheer(t) - 0.17, 0.03, 0.97, h=0.12, out=0.065)
    hull.wale(m, lambda t: sheer(t) - 0.2, 0.04, 0.96, h=0.025, out=0.075, mat=WHITE, shade=1.0)
    for sx in (1, -1):
        hull.decal(m, 0.9, sheer(0.9) - 0.2, 0.5, 0.7, sx)
        hull.decal(m, 0.4, sheer(0.4) - 0.2, 0.6, 0.5, sx, u=(0.3, 0.8))

    def zd(t):
        return sheer(t) - 0.14

    tw = 0.45
    hull.deck(m, zd, tw, 1.0, 0.06, DECK)
    hull.rail(m, zd, sheer, tw, 1.0, 0.07, GREEN, DARK, end0=False)
    hull.inner(m, [lambda t: 0.2, lambda t: 0.45, sheer], 0.0, tw, 0.06, WOOD, DECK, end1=True)
    hull.cap(m, sheer, 0.0, tw, 0.06, DARK)
    ribs(m, hull, [0.04 + 0.38 * k / 6 for k in range(7)], lambda t: 0.2, lambda t: sheer(t) - 0.03, 0.06, w=0.07, mat=DARK)
    X.deck(hull, zd, tw, 1.0, 0.07)
    X.floor([hull.P(0.01, 0.2, -1, 0.1), hull.P(0.01, 0.2, 1, 0.1), hull.P(tw, 0.2, 1, 0.1), hull.P(tw, 0.2, -1, 0.1)])
    # the stem head
    sy = hull.y(1.0, sheer(1.0))
    m.beam((0, sy + 0.56, sheer(1.0) - 0.7), (0, sy + 0.04, sheer(1.0) + 0.3), 0.16, 0.18, DARK)
    m.box((0, sy + 0.05, sheer(1.0) + 0.34), (0.2, 0.2, 0.08), GREEN)
    # the fore cuddy: a low hatch with a sliding lid, its stovepipe
    th = 0.62
    yh = hull.y(th, zd(th))
    m.box((0, yh, zd(th) + 0.13), (1.1, 0.9, 0.26), GREEN, tile=1.0)
    m.box((0, yh + 0.08, zd(th) + 0.28), (1.0, 0.6, 0.04), DARK)
    X.solid((0, yh, zd(th) + 0.13), (1.1, 0.9, 0.26))
    pipe_top = stovepipe(m, 0.38, yh - 0.3, zd(th) + 0.26, 0.46, 0.05)
    m.stove(pipe_top)
    # thwart and the bulkhead at the end of the well
    m.box((0, hull.y(0.3, 0), 0.62), (2 * hb(0.3, 0.62) - 0.14, 0.3, 0.05), WOOD, shade=0.9)
    yb_ = hull.y(tw, 0)
    m.poly([V(-hb(tw, 0.4) + 0.08, yb_, 0.2), V(hb(tw, 0.4) - 0.08, yb_, 0.2), V(hb(tw, zd(tw)) - 0.08, yb_, zd(tw)),
            V(-hb(tw, zd(tw)) + 0.08, yb_, zd(tw))], WOOD, out=(0, 1, 0), shade=0.7)
    # the mast, boom, the short curved gaff; furled or set
    tm = 0.58
    ym, zm = hull.y(tm, zd(tm)), zd(tm)
    top = V(0, ym + 0.4, zm + 10.0)
    spar(m, (0, ym, zm), top, 0.14, 0.07, DARK, cap=True, sides=7)
    m.box((0, ym, zm + 0.08), (0.36, 0.36, 0.16), DARK)
    X.post((0, ym, zm), (0, ym, zm + 2.0), 0.4)
    pennant(m, top + V(0, 0, 0.2), 1.4, h=0.22)
    boom_a, boom_b = V(0, ym + 0.2, zm + 1.1), V(0, ym + 7.2, zm + 1.25)
    spar(m, boom_a, boom_b, 0.09, 0.07)
    if sailing:
        gaff_a = V(0, ym + 0.35, zm + 8.2)
        g1 = gaff_a + V(0, 1.8 * math.cos(0.85), 1.8 * math.sin(0.85))
        gaff_b = g1 + V(0, 1.8 * math.cos(1.15), 1.8 * math.sin(1.15))
    else:
        gaff_a = V(0, ym + 0.3, zm + 1.55)
        g1, gaff_b = V(0, ym + 1.95, zm + 1.78), V(0, ym + 3.6, zm + 1.9)
    spar(m, gaff_a, g1, 0.07, 0.06)
    spar(m, g1, gaff_b, 0.06, 0.045)
    gaff_jaws(m, top, gaff_a, g1, 0.11)
    block(m, top - V(0, 0, 0.35) + V(0, 0.14, -0.1), 0.06)
    block(m, boom_b + V(0, -0.12, 0.1), 0.05)
    if sailing:
        mast_hoops(m, (0, ym + 0.05, zm + 1.6), (0, ym + 0.3, zm + 8.0), 0.12, n=8)
    else:
        mast_hoops(m, (0, ym + 0.02, zm + 1.35), (0, ym + 0.04, zm + 1.85), 0.14, n=7)
    if sailing:
        sail(m, gaff_a + V(0, 0.2, -0.1), gaff_b + V(0, -0.1, -0.15), boom_a + V(0, 0.3, 0.15), boom_b + V(0, -0.3, 0.15),
             V(0.8, 0, 0), nu=5, nv=6, mat=TAN)
    else:
        bundle(m, boom_a + V(0, 0.4, 0.24), boom_b + V(0, -0.5, 0.2), 0.24, TAN, n=7, sides=7)
        for f in (0.25, 0.5, 0.75):
            p = boom_a.lerp(boom_b, f)
            rope_path(m, [p + V(0.25, 0, 0.05), p + V(0, 0, 0.55), p + V(-0.25, 0, 0.05)], 0.018, ROPE)
    rig(m, top - V(0, 0, 0.3), boom_b)
    rig(m, top - V(0, 0, 0.4), gaff_b)
    stem = V(0, sy + 0.05, sheer(1.0) + 0.2)
    rig(m, top - V(0, 0, 0.3), stem, 0.024)
    if sailing:
        head = stem.lerp(top - V(0, 0, 0.3), 0.7)
        sail(m, head, head, stem + V(0, 0.25, 0.1), V(1.1, stem.y + 3.4, sheer(0.8) + 0.7), V(0.5, 0, 0), nu=3, nv=4, mat=TAN)
    else:
        bundle(m, stem + V(0, 0.25, -0.05), stem + V(0, 2.0, -0.35), 0.18, TAN, n=4, sides=5)
    for sx in (1, -1):
        rig(m, top - V(0, 0, 0.8), hull.P(tm - 0.02, sheer(tm - 0.02), sx) + V(0, 0, 0.05), 0.02)
        m.box(hull.P(tm - 0.02, sheer(tm - 0.02) - 0.12, sx) + V(sx * 0.08, 0, 0), (0.035, 0.1, 0.28), IRON)
        piv = hull.P(0.55, sheer(0.55) - 0.1, sx) + V(sx * 0.05, 0, 0)
        foot = leeboard(m, piv, 2.9, 1.25, sx, angle=0.75)
        rig(m, foot, hull.P(0.48, sheer(0.48), sx) + V(0, 0, 0.15), 0.02)
    # the rudder with its long tiller over the well
    ys = hull.y(0, 0)
    k0, zr = keel(0), sheer(0)
    with put_over(m, hull.y(0.0, zr) - 0.05, 0.0 if sailing else math.radians(15)):
        rudder(m, ys, k0 + 0.05, sheer(0) - 0.58, 0.86, zr + 0.3, mat=TAR, straps=2, stock_r=0.06,
               post=lambda z: hull.y(0.0, z) + 0.02)
        tiller(m, (0, ys + 0.25, zr + 0.25), (0, ys - 1.9, zr + 0.42), w=0.08)
    # the well's gear: a basket of mussels, fish baskets, a water cask, the anchor, a net hung from the boom
    with m.at(move(0.6, hull.y(0.2, 0), 0.2)):
        m.lathe([(0.2, 0), (0.28, 0.35), (0.3, 0.4)], 7, ROPE, smooth=False, cap0=True, urep=2)
    barrel_lo(m, (-0.7, hull.y(0.18, 0), 0.2), yaw=0.3)
    for k, (x, t) in enumerate([(-0.9, 0.3), (-0.4, 0.34), (0.9, 0.36)]):
        basket2(m, (x, hull.y(t, 0), 0.2), 0.24, 0.32)
    with m.at(move(-0.5, hull.y(0.8, zd(0.8)), zd(0.8) + 0.1) @ Matrix.Rotation(math.pi / 2, 4, "Y")):
        anchor(m, V(0, 0, 0), side=(0, 1, 0), size=0.42)
    for sx in (1, -1):
        bollard_pair(m, sx * 0.32, hull.y(0.94, zd(0.94)), zd(0.94), 0.36, w=0.12, gap=0.22)
        cleat(m, hull.P(0.2, sheer(0.2) - 0.02, sx, 0.12), size=0.24)
    coil(m, (0.35, hull.y(0.86, zd(0.86)), zd(0.86)), 0.22)
    bucket(m, (0.75, hull.y(0.12, 0), 0.2), r=0.12, h=0.24)
    boathook(m, (-1.2, hull.y(0.05, 0), sheer(0.05) + 0.04), (-1.25, hull.y(0.5, 0), sheer(0.5) + 0.05))
    if not sailing:
        a = boom_a.lerp(boom_b, 0.3) - V(0, 0, 0.1)
        b = boom_a.lerp(boom_b, 0.62) - V(0, 0, 0.1)
        m.poly([a + V(0.05, 0, 0), b + V(0.05, 0, 0), b + V(0.4, 0, -0.9), a + V(0.3, 0, -1.1)], NET, out=(1, 0, 0),
               uvs=[(0, 0), (3, 0), (3, 1.8), (0, 2.2)])
        lantern(m, V(0.2, ym - 0.15, zm + 3.2), 0)
    else:
        for sx, kind in ((1, 1), (-1, 2)):  # port (+x) red, starboard green
            lantern(m, hull.P(0.7, sheer(0.7) + 0.2, sx, -0.05), kind, bail=False)
    for t in (0.3,):
        for sx in (1, -1):
            fender(m, hull.P(t, sheer(t), sx, 0.04), sx, drop=0.4, r=0.11)
    # her name in small white letters on the bows, her home port round the stern
    tn = 0.88
    for sx, key in ((1, "bow_p"), (-1, "bow_s")):
        X.hull_board(key, hull, tn, sheer(tn) - 0.44, 1.9, 0.26, sx, off=0.05)
    X.stern_board("stern", hull, sheer(0) - 0.42, 1.4, 0.22, off=0.05)
    return m


# ------------------------------------------------------------------ pontoon

PONTOON_DECK = 1.8  # deck top above the waterline: level with the quay (quay 1.8 m above the water)
PONTOON_LEN = 10.0
PONTOON_HALF = 2.05  # walkable half width between the railings


def pontoon_section():
    """10 m of floating walkway: a plank deck on stringers and trestles, two tarred floats with rounded ends under
    it, railings both sides. Open at both ends so sections chain."""
    m = Mesh(ao=0.0)
    X = Contract(m, far=0)
    m.shadefn = lambda p: 0.55 + 0.45 * sm((p.z + 0.8) / 2.6)
    for sx in (1, -1):
        cx = sx * 1.35
        out = []
        for j in range(7):
            a = math.pi * j / 6
            out.append(V(cx + 0.75 * math.cos(a), 4.3 + 0.55 * math.sin(a), -0.8))
        for j in range(7):
            a = math.pi + math.pi * j / 6
            out.append(V(cx + 0.75 * math.cos(a), -4.3 + 0.55 * math.sin(a), -0.8))
        m.tintfn = waterline_tint
        m.prism(out, (0, 0, 1.4), TAR, tile=2.0)
        m.tintfn = None
        # the float's iron bands and its deck boards
        for y in (-3.0, -1.0, 1.0, 3.0):
            m.box((cx, y, -0.1), (1.54, 0.08, 1.42), IRON, shade=0.7)
        m.box((cx, 0, 0.62), (1.3, 7.6, 0.05), DARK)
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
    # the deck planks, each its own board with a gap
    n = 14
    for k in range(n):
        x0 = -2.25 + 4.5 * k / n
        m.box((x0 + 4.5 / n / 2, 0, PONTOON_DECK - 0.04), (4.5 / n - 0.015, PONTOON_LEN, 0.08), DECK, tile=1.6,
              shade=0.88 + 0.12 * ((k * 7) % 3) / 2)
    X.top((0, 0, PONTOON_DECK), (2 * PONTOON_HALF, PONTOON_LEN))
    # railings: posts every 2.5 m, top and middle rails, a kick board
    for sx in (1, -1):
        x = sx * 2.17
        for y in (-3.75, -1.25, 1.25, 3.75):
            m.box((x, y, PONTOON_DECK + 0.55), (0.1, 0.1, 1.1), DARK)
            m.box((x, y, PONTOON_DECK + 1.12), (0.13, 0.13, 0.04), DARK)
            X.solid((x, y, PONTOON_DECK + 0.55), (0.14, 0.14, 1.1))
        for z, w, h in ((1.08, 0.08, 0.09), (0.55, 0.06, 0.06)):
            m.beam((x, -5.0, PONTOON_DECK + z), (x, 5.0, PONTOON_DECK + z), w, h, DARK)
        m.box((x, 0, PONTOON_DECK + 0.08), (0.04, PONTOON_LEN, 0.16), WOOD, shade=0.85)
        X.solid((x, 0, PONTOON_DECK + 0.6), (0.1, PONTOON_LEN, 1.2))
        # fender posts and mooring cleats on the outside
        for y in (-4.6, 0.0, 4.6):
            m.box((sx * 2.33, y, 0.9), (0.14, 0.2, 1.8), DARK, shade=0.8)
        cleat(m, (sx * 2.0, 2.5, PONTOON_DECK), size=0.4)
        cleat(m, (sx * 2.0, -2.5, PONTOON_DECK), size=0.4)
    return m
