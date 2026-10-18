"""Clothes for the people2 kinds (package C; docs/people.md "Kinds and clothes").

A garment is a Piece: a quad cage in game space at rest (x the person's left, y up, z forward, metres), with bone
weights per vertex, UV seams and creased edges. It goes through the same two steps as A's bodies: subdivided once
(Catmull-Clark on the limit surface) it is the near copy, moved onto its limit surface it is the far copy. Every
garment is closed cloth with a real thickness: thicken() gives an open outer surface an inside (all of it, or a
facing a few centimetres deep where the inside is never seen past it) and a rim along every open edge; the rim's
edges are creased a little, so a hem is a rounded edge as thick as the cloth, not a blade.

Ways to make a garment's outer surface:
- from_cage(): the body's own cage faces, pushed out along their normals by an ease (shirts, smocks, tunics,
  trousers, sleeves): the garment has the body's topology there, its edge loops at the joints, and the body's
  weights vertex for vertex, so it bends exactly as the body under it;
- hang(): rings below an open loop that fall from it, pushed out to clear the legs and hips below (skirts, the
  smock's skirt, coat skirts, aprons): weighted to the hips, the legs by side and height, and the spring bones;
- grid(): any grid of points (caps, collars, belts, straps, clogs); snap() lays points onto the body or a garment.

The body under a garment is cut away (covered()): what nobody can see costs nothing and cannot poke through.
Hats are part of the kind's mesh (one draw), placed on the head's crown (the headTop socket) and weighted to the head.

Pictures: every garment is painted in 3D through a position map (paint.position_map), as A paints the skin:
colour, weave, folds, seams, buttons, patches, wear, mud at the hems, tar and coal dust; a height field painted with
it becomes the normal map (hands.normal_from_height). See paint_cloth() and the Cloth looks.
"""

import heapq
import math
import os

import numpy as np

from . import B, G
from . import body as bd
from . import weights as wt
from .paint import _noise3
from .rig import NAMES

IDX = wt.INDEX
HEAD_ONLY = {"head": 1.0}


def starts(arr, prefixes):
    """np.char.startswith for one prefix or a tuple of them."""
    if isinstance(prefixes, str):
        return np.char.startswith(arr, prefixes)
    out = np.zeros(np.shape(arr), bool)
    for p in prefixes:
        out |= np.char.startswith(arr, p)
    return out


def sm(e0, e1, x):
    """Smoothstep (vectorised; e1 < e0 runs backwards)."""
    t = np.clip((np.asarray(x, np.float64) - e0) / (e1 - e0), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def norm(v):
    v = np.asarray(v, np.float64)
    n = np.linalg.norm(v, axis=-1, keepdims=True)
    return v / np.maximum(n, 1e-12)


def wnorm(w):
    """A weight dict: at most 4 bones, normalised."""
    items = sorted(((k, float(v)) for k, v in w.items() if v > 1e-5), key=lambda kv: -kv[1])[:4]
    t = sum(v for _, v in items) or 1.0
    return {k: v / t for k, v in items}


def wmix(a, b, t):
    """(1 - t) a + t b of two weight dicts."""
    out = {}
    for k, v in a.items():
        out[k] = out.get(k, 0.0) + v * (1 - t)
    for k, v in b.items():
        out[k] = out.get(k, 0.0) + v * t
    return out


# ---------------------------------------------------------------- the body a kind is dressed on

class Fit:
    """What the clothes need to know of one body: its cage at rest with normals and weights, its near copy's
    surface (for clearances and nearest weights), its joints and its head."""

    def __init__(self, b):
        import bpy
        from mathutils.kdtree import KDTree

        self.b = b
        self.P = P = b["P"]
        self.C = C = b["C"]
        self.J = b["J"]
        self.Y = lambda f: bd.Y(P, f)
        self.rest = np.array(C.rest, np.float64)
        # the cage's vertex normals at rest (a throwaway mesh: Blender orients the faces outward)
        ob = bd.to_mesh(C, "_fit_normals", use_rest=True)
        self.N = np.array([G(v.normal) for v in ob.data.vertices], np.float64)
        bpy.data.objects.remove(ob)
        self.N = norm(self.N)
        self.Wc = wt.cage_weights(C, P)
        # the near copy's surface at rest: points, parts, weights (before anything is cut away)
        lod0 = b["lod0"]
        self.S = np.array([G(v.co) for v in lod0.data.vertices], np.float64)
        self.Spart = np.array([p or "" for p in b["vparts"]])
        self.SN = norm(np.array([G(v.normal) for v in lod0.data.vertices], np.float64))
        self.SW = wt.read(lod0)
        self.kd = KDTree(len(self.S))
        for i, p in enumerate(self.S):
            self.kd.insert(p, i)
        self.kd.balance()
        from mathutils.bvhtree import BVHTree
        tris = []
        for poly in lod0.data.polygons:
            vs = list(poly.vertices)
            for k in range(1, len(vs) - 1):
                tris.append((vs[0], vs[k], vs[k + 1]))
        self.tris = np.array(tris)
        self.bvh = BVHTree.FromPolygons([tuple(p) for p in self.S], [tuple(t) for t in tris])
        self.hip_y = float(self.J["legUpL"][0][1])
        self.knee_y = float(self.J["legLowL"][0][1])
        self.hip_x = float(self.J["legUpL"][0][0])

    # -- cage lookups
    def tag(self, i):
        return self.C.tag[i]

    def part(self, i):
        return self.C.part[i]

    def row(self, r):
        """The 16 cage vertices of trunk row r (-1 where the arm holes are), by column."""
        out = [-1] * 16
        for i, (pt, tg) in enumerate(zip(self.C.part, self.C.tag)):
            if pt == "torso" and tg.get("row") == r and tg.get("col", -1) >= 0:
                out[tg["col"]] = i
        return out

    def cage_w(self, i):
        w = self.Wc[i]
        return {NAMES[k]: float(w[k]) for k in np.nonzero(w > 1e-4)[0]}

    def near_w(self, p, parts=None, k=4):
        """Bone weights at a point near the body: the nearest near-copy vertices (of the given parts), by inverse
        distance."""
        if parts is None:
            hits = self.kd.find_n(p, k)
        else:
            hits = [h for h in self.kd.find_n(p, 40) if self.Spart[h[1]].startswith(parts)][:k]
            if not hits:
                hits = self.kd.find_n(p, k)
        acc = np.zeros(len(NAMES))
        tot = 0.0
        for _, i, d in hits:
            g = 1.0 / (d + 0.004) ** 2
            acc += self.SW[i] * g
            tot += g
        acc /= max(tot, 1e-12)
        return wnorm({NAMES[k_]: float(acc[k_]) for k_ in np.nonzero(acc > 1e-4)[0]})

    def surface(self, p, parts=None):
        """The nearest body point and its outward normal (from the near copy's vertices)."""
        if parts is None:
            _, i, _ = self.kd.find(p)
        else:
            hits = [h for h in self.kd.find_n(p, 40) if self.Spart[h[1]].startswith(parts)]
            i = hits[0][1] if hits else self.kd.find(p)[1]
        return self.S[i], self.SN[i]

    def snap(self, p, d, parts=None):
        """A point d metres out from the body surface nearest to p (the true surface of the near copy)."""
        loc, nrm, fi, _ = self.bvh.find_nearest(tuple(p))
        if loc is None:
            return np.asarray(p)
        n = np.array(nrm)
        if np.dot(n, np.asarray(p) - np.array(loc)) < 0 and np.linalg.norm(np.asarray(p) - np.array(loc)) > 0.03:
            n = -n
        return np.array(loc) + n * d

    def support(self, c, dirs, y0, y1, parts=("leg", "torso")):
        """How far the body reaches from point c (game space) along each horizontal direction in dirs (n, 3), for the
        body's points between heights y0 and y1 of the given parts: the radius a ring must clear."""
        m = (self.S[:, 1] >= y0) & (self.S[:, 1] <= y1) & starts(self.Spart, parts)
        if not m.any():
            return np.zeros(len(dirs))
        d = self.S[m] - np.asarray(c)
        d[:, 1] = 0.0
        return (d @ np.asarray(dirs).T).max(axis=0)


# ---------------------------------------------------------------- a garment piece

class Piece:
    """One garment piece: quads (or a few triangles) over vertices with weights; `inner` marks the inside (lining,
    facings) for the painter and the texel density."""

    def __init__(self, name, cloth, scale=1.0, hat=False):
        self.name = name
        self.cloth = cloth
        self.scale = scale  # texel density factor of the outer surface
        self.hat = hat  # follows the face shapes (head-fitted pieces)
        self.V = []
        self.W = []
        self.inner = []
        self.zone = []  # where on the body each vertex comes from (trunk, arm, leg, skirt...), for the painter
        self.F = []
        self.seams = set()
        self.crease = {}
        self.meta = {}
        self.relief = None  # relief(ctx) -> metres along the cloth's outward direction (clothes_build.relief)
        self.fabric = None  # {vertex: (u, v)}: the cloth's own coordinates, metres along warp and weft (cloth_detail)

    def add(self, p, w, inner=False, zone=""):
        self.V.append(np.asarray(p, np.float64))
        self.W.append(dict(w))
        self.inner.append(inner)
        self.zone.append(zone)
        return len(self.V) - 1

    def face(self, vs):
        self.F.append(tuple(int(v) for v in vs))

    def seam(self, a, b):
        self.seams.add((min(a, b), max(a, b)))

    def set_crease(self, a, b, c):
        self.crease[(min(a, b), max(a, b))] = c

    def grid(self, pts, weights, closed=False, flip=False, seam_col=None):
        """Quads over a grid of points (rows, cols, 3) with weights (rows, cols) (dicts or a function of the point).
        closed: the columns wrap. Returns the vertex ids (rows, cols)."""
        pts = np.asarray(pts, np.float64)
        R, Nc = pts.shape[:2]
        ids = np.zeros((R, Nc), np.int64)
        for i in range(R):
            for j in range(Nc):
                w = weights(pts[i, j]) if callable(weights) else weights[i][j]
                ids[i, j] = self.add(pts[i, j], w)
        self.grid_faces(ids, closed, flip)
        if seam_col is not None:
            for i in range(R - 1):
                self.seam(ids[i, seam_col], ids[i + 1, seam_col])
        return ids

    def grid_faces(self, ids, closed=False, flip=False):
        R, Nc = ids.shape
        for i in range(R - 1):
            for j in range(Nc if closed else Nc - 1):
                j2 = (j + 1) % Nc
                f = (ids[i, j], ids[i, j2], ids[i + 1, j2], ids[i + 1, j])
                self.face(f[::-1] if flip else f)

    def normals(self):
        V = np.array(self.V)
        Nv = np.zeros_like(V)
        for f in self.F:
            p = V[list(f)]
            n = np.zeros(3)
            for k in range(len(f)):  # Newell
                a, b = p[k], p[(k + 1) % len(f)]
                n += np.cross(a, b)
            for v in f:
                Nv[v] += n
        return norm(Nv)

    def orient(self, out, start=0):
        """Turn every face (from face `start` on) so its normal agrees with out(centroid) (a direction, or a function
        of the point)."""
        V = np.array(self.V)
        for k, f in enumerate(self.F):
            if k < start:
                continue
            p = V[list(f)]
            n = np.zeros(3)
            for j in range(len(f)):
                n += np.cross(p[j], p[(j + 1) % len(f)])
            c = p.mean(0)
            o = out(c) if callable(out) else np.asarray(out)
            if np.dot(n, o) < 0:
                self.F[k] = tuple(reversed(f))

    def consistent(self):
        """Make the winding agree across every edge (each connected part turned to the way most of its faces already
        face): the orient() rules decide face by face and can disagree where two rules meet (a smock's skirt under
        its body), and thicken() would take such an edge for an open one and give it a rim. Returns faces turned."""
        ef = {}
        for k, f in enumerate(self.F):
            for j in range(len(f)):
                a, b = f[j], f[(j + 1) % len(f)]
                ef.setdefault((min(a, b), max(a, b)), []).append(k)
        seen = [False] * len(self.F)
        turned = 0
        for s0 in range(len(self.F)):
            if seen[s0]:
                continue
            flip = {s0: False}
            seen[s0] = True
            queue = [s0]
            while queue:
                k = queue.pop()
                f = self.F[k][::-1] if flip[k] else self.F[k]
                for j in range(len(f)):
                    a, b = f[j], f[(j + 1) % len(f)]
                    for m in ef[(min(a, b), max(a, b))]:
                        if m == k or seen[m]:
                            continue
                        g = self.F[m]
                        # agreeing neighbours run the shared edge the other way (b, a)
                        same = any(g[i] == a and g[(i + 1) % len(g)] == b for i in range(len(g)))
                        flip[m] = same
                        seen[m] = True
                        queue.append(m)
            n_flip = sum(flip.values())
            invert = n_flip > len(flip) - n_flip
            for k, fl in flip.items():
                if fl != invert:
                    self.F[k] = tuple(reversed(self.F[k]))
                    turned += 1
        return turned

    def loops(self):
        """The open edge loops (ordered vertex ids, in the faces' winding)."""
        de = {}
        for f in self.F:
            for k in range(len(f)):
                de[(f[k], f[(k + 1) % len(f)])] = True
        nxt = {}
        for (a, b) in de:
            if (b, a) not in de:
                nxt[a] = b
        loops = []
        seen = set()
        for s in list(nxt):
            if s in seen:
                continue
            lp = [s]
            seen.add(s)
            c = nxt[s]
            while c != s and c in nxt and c not in seen:
                lp.append(c)
                seen.add(c)
                c = nxt[c]
            loops.append(lp)
        return loops


def thicken(pc, thick, depth=0.06, crease=0.08, rim_seam=True, skip=None):
    """Give the open outer surface of pc a thickness: an inside offset inward by `thick` over the faces within
    `depth` metres of an open edge (None: all of it), and a rim along every open edge (both its edges creased).
    The outer faces must already face outward (orient; their winding is made consistent here). skip: loops (lists of
    vertex ids) that get no rim (where a piece is joined to another one)."""
    pc.consistent()
    V = np.array(pc.V)
    Nv = pc.normals()
    F0 = list(pc.F)
    de = {}
    for f in F0:
        for k in range(len(f)):
            de[(f[k], f[(k + 1) % len(f)])] = True
    bnd = [(a, b) for (a, b) in de if (b, a) not in de]
    skipv = set()
    for lp in skip or []:
        skipv.update(lp)
    bnd = [(a, b) for (a, b) in bnd if not (a in skipv and b in skipv)]
    bverts = {a for a, b in bnd} | {b for a, b in bnd}
    if depth is None:
        sel = F0
    else:
        # how far along the surface from the open edges (Dijkstra over the edges); depth may be a function of the
        # open edge's point (a deep facing at a hem, a shallow one at a cuff)
        nb = {}
        for (a, b) in de:
            nb.setdefault(a, set()).add(b)
            nb.setdefault(b, set()).add(a)
        lim = {v: (depth(V[v]) if callable(depth) else depth) for v in bverts}
        key = {v: 0.0 for v in bverts}
        src = dict(lim)
        hq = [(0.0, v) for v in bverts]
        heapq.heapify(hq)
        while hq:
            k, v = heapq.heappop(hq)
            if k > key.get(v, 1e9) or k > 1.5:
                continue
            for u in nb.get(v, ()):
                nk = k + float(np.linalg.norm(V[u] - V[v])) / max(src[v], 1e-6)
                if nk < key.get(u, 1e9):
                    key[u] = nk
                    src[u] = src[v]
                    heapq.heappush(hq, (nk, u))
        sel = [f for f in F0 if max(key.get(v, 1e9) for v in f) <= 1.0 or any(v in bverts for v in f)]
    inn = {}
    # where a facing stops inside the garment its free edge sinks a little deeper: the outside shrinks onto its
    # limit surface over a curve (a shoulder, the hips) and would otherwise let that edge show through
    sel_edges = {}
    for f in sel:
        for k in range(len(f)):
            e = (min(f[k], f[(k + 1) % len(f)]), max(f[k], f[(k + 1) % len(f)]))
            sel_edges[e] = sel_edges.get(e, 0) + 1
    free = set()
    for (a, b), cnt in sel_edges.items():
        if cnt == 1 and (a, b) in de and (b, a) in de:  # the facing ends here, inside the garment
            free.update((a, b))
    free -= bverts
    for f in sel:
        for v in f:
            if v not in inn:
                d = thick + (0.008 if v in free else 0.0)
                inn[v] = pc.add(V[v] - Nv[v] * d, pc.W[v], inner=True, zone=pc.zone[v])
    for f in sel:
        pc.face(tuple(inn[v] for v in reversed(f)))
    if pc.fabric:
        for v, iv in inn.items():
            if v in pc.fabric:
                pc.fabric[iv] = pc.fabric[v]
    # the inside is cut where the outside is (a tube's facing is a ring: without a cut it cannot be laid flat), and
    # so is the rim where a cut meets the open edge
    for (a, b) in list(pc.seams):
        if a in inn and b in inn:
            pc.seam(inn[a], inn[b])
        for v in (a, b):
            if v in bverts and v in inn:
                pc.seam(v, inn[v])
    for (a, b) in bnd:
        if a not in inn or b not in inn:
            continue
        pc.face((b, a, inn[a], inn[b]))
        pc.set_crease(a, b, crease)
        pc.set_crease(inn[a], inn[b], crease)
        if rim_seam:
            # the rim belongs to the outside's island (the picture runs on over the hem's edge as the cloth does);
            # the inside is cut off at the rim's inner edge
            pc.seam(inn[a], inn[b])
    return inn


# ---------------------------------------------------------------- outer surfaces

def from_cage(fit, pc, allow, ease):
    """The body cage faces whose vertices all pass allow(i), pushed out along the rest normals by ease(i) metres,
    with the body's weights and its UV seams. Returns {cage vertex: piece vertex}."""
    C = fit.C
    vmap = {}
    for f in C.faces:
        if not all(allow(i) for i in f):
            continue
        for i in f:
            if i not in vmap:
                pt = fit.C.part[i]
                zone = "arm" if pt.startswith("arm") else "leg" if pt.startswith("leg") else pt
                vmap[i] = pc.add(fit.rest[i] + fit.N[i] * ease(i), fit.cage_w(i), zone=zone)
        pc.face([vmap[i] for i in f])
    for a, b in C.seams:
        if a in vmap and b in vmap:
            pc.seam(vmap[a], vmap[b])
    # outward: the body's own normals at the face's corners
    inv = {v: k for k, v in vmap.items()}
    Nb = fit.N
    pc.orient(lambda c, _V=None: _nearest_normal(c, pc, inv, Nb))
    return vmap


def _nearest_normal(c, pc, inv, Nb):
    # the outward direction at a face centroid: the mean body normal of the piece vertices nearest to it
    V = np.array(pc.V)
    d = np.linalg.norm(V - c, axis=1)
    ks = np.argsort(d)[:4]
    n = np.zeros(3)
    for k in ks:
        if int(k) in inv:
            n += Nb[inv[int(k)]]
    return n


def ring_dirs(pts, c):
    d = np.asarray(pts, np.float64) - np.asarray(c)
    d[:, 1] = 0.0
    return norm(d)


def hang_weights(fit, p, front_legs=1.0, back_legs=0.35, spring=0.0, springs=("skirt",), knee_share=0.65,
                 knee_band=(0.12, 0.22)):
    """Bone weights of a point of cloth hanging below the hips: the hips, the legs by side (all of it in front,
    `back_legs` behind) and by height (the shin below the knee), and a share for the spring bones (moved by the
    games), more toward the hem and behind."""
    x, y, z = p
    # left or right by the angle round the body: half and half in front and behind, so the cloth between the legs
    # stretches evenly instead of parting down the middle; by x close to the legs
    s_ang = 0.5 + 0.5 * math.sin(math.atan2(x, z))
    s_x = float(sm(-0.6 * fit.hip_x, 0.6 * fit.hip_x, x))
    near = float(sm(fit.hip_y - 0.02, fit.hip_y - 0.20, y))
    sL = s_x * (1 - near) + s_ang * near
    ang = math.degrees(math.atan2(abs(x), z))  # 0 in front, 180 behind
    legs = front_legs + (back_legs - front_legs) * float(sm(60.0, 130.0, ang))
    a = float(sm(fit.hip_y + 0.07, fit.hip_y - 0.10, y)) * legs
    # below the knee the cloth goes with the shin: seated, a skirt lies on the lap and falls from the knees
    k = float(sm(fit.knee_y + knee_band[0], fit.knee_y - knee_band[1], y)) * knee_share
    w = {"hips": 1.0 - a}
    for S, s in (("L", sL), ("R", 1.0 - sL)):
        w["legUp" + S] = a * s * (1 - k)
        w["legLow" + S] = a * s * k
    if spring > 0:
        sp = spring * float(sm(fit.hip_y + 0.05, fit.knee_y - 0.1, y)) * (0.5 + 0.5 * float(sm(40.0, 140.0, ang)))
        if "skirt" in springs:
            th = math.atan2(x, z)
            parts = {"skirtF": max(0.0, math.cos(th)) ** 2, "skirtB": max(0.0, -math.cos(th)) ** 2,
                     "skirtL": max(0.0, math.sin(th)) ** 2, "skirtR": max(0.0, -math.sin(th)) ** 2}
        else:
            parts = {"coatTailL": sL, "coatTailR": 1.0 - sL} if ang > 90 else {}
        tot = sum(parts.values())
        if tot > 0 and parts:
            w = {kk: v * (1 - sp) for kk, v in w.items()}
            for kk, v in parts.items():
                w[kk] = w.get(kk, 0.0) + sp * v / tot
    return wnorm(w)


def hang(fit, pc, loop, heights, clear=0.02, flare=0.0, folds=None, wfn=None, centre=None, parts=("leg", "torso"),
         seam_at=None, closed=True, push=None):
    """Rings that fall from an open loop of pc (vertex ids, in order round the body) down to each of `heights`
    (game y, top to bottom). Each ring point drops straight down from the one above it, pushed out to clear the
    body below by `clear` and flared by `flare` (radius gained per metre of drop); folds(j, depth) adds a radial
    ripple (metres) at column j, depth below the loop. Weights from wfn(point) (default: hang_weights). Returns
    the vertex ids (rings, cols), the loop first."""
    V = np.array(pc.V)
    top = V[loop]
    c = np.array(centre if centre is not None else (0.0, 0.0, top[:, 2].mean()))
    dirs = ring_dirs(top, c)
    r = ((top - c) * dirs).sum(1)
    y_top = top[:, 1].mean()
    rows = [np.array(loop)]
    prev_y = top[:, 1].copy()
    for hk, y in enumerate(heights):
        blend = 1.0 - (hk + 1) / len(heights)
        ys = np.full(len(loop), y) + (top[:, 1] - y_top) * blend
        need = fit.support(c, dirs, y - 0.05, max(prev_y.max(), y + 0.05), parts) + clear
        r = np.maximum(r * (1 + flare * float(np.mean(prev_y - ys))), need)
        # smooth round the ring so a dent between the legs does not show
        if closed:
            r = np.maximum(r, (np.roll(r, 1) + np.roll(r, -1)) / 2 * 0.985)
        rr = r.copy()
        if folds is not None:
            rr = rr + np.array([folds(j, y_top - y) for j in range(len(loop))])
        pts = c + dirs * rr[:, None]
        pts[:, 1] = ys
        if push is not None:
            pts = np.array([push(j, p, y_top - y) for j, p in enumerate(pts)])
        ids = []
        for p in pts:
            ids.append(pc.add(p, wfn(p) if wfn else hang_weights(fit, p), zone="skirt"))
        rows.append(np.array(ids))
        prev_y = ys
    ids = np.stack(rows)
    nF = len(pc.F)
    pc.grid_faces(ids, closed=closed)
    # outward from the axis
    cc = c.copy()
    for k in range(nF, len(pc.F)):
        f = pc.F[k]
        p = np.array([pc.V[v] for v in f])
        n = np.zeros(3)
        for j in range(4):
            n += np.cross(p[j], p[(j + 1) % 4])
        o = p.mean(0) - cc
        o[1] = 0
        if np.dot(n, o) < 0:
            pc.F[k] = tuple(reversed(f))
    if seam_at is not None:
        for i in range(len(rows) - 1):
            pc.seam(ids[i, seam_at], ids[i + 1, seam_at])
    return ids



# ---------------------------------------------------------------- the head

def head_axis(fit):
    """The head's vertical axis (x = 0, z through the middle of the skull) and its crown height, from the built near
    copy's head and hair vertices (not from the head's field: hats fit whatever head the face package makes)."""
    if getattr(fit, "_haxis", None) is None:
        m = np.isin(fit.Spart, ("head", "hair"))
        H = fit.S[m]
        top = H[:, 1].max()
        sk = H[H[:, 1] > top - 0.06]
        zc = 0.5 * (sk[:, 2].max() + sk[:, 2].min())
        fit._haxis = (np.array((0.0, 0.0, zc)), float(top))
    return fit._haxis


def head_support(fit, y, phis, band=0.007, parts=("head", "hair")):
    """How far the head (and its hair) reaches from the head's axis at height y (game) toward each azimuth in phis
    (radians, 0 in front, + to the left): the radius a cap must clear there."""
    c, _ = head_axis(fit)
    m = np.isin(fit.Spart, parts) & (np.abs(fit.S[:, 1] - y) < band)
    phis = np.asarray(phis, np.float64)
    if not m.any():
        return np.zeros(len(phis))
    d = fit.S[m] - c
    d[:, 1] = 0.0
    dirs = np.stack([np.sin(phis), np.zeros_like(phis), np.cos(phis)], -1)
    proj = d @ dirs.T
    # only the vertices near each direction (a support function would cut corners round the back of the skull)
    ang = np.arctan2(d[:, 0], d[:, 2])[:, None] - phis[None, :]
    ang = np.abs((ang + np.pi) % (2 * np.pi) - np.pi)
    near = np.where(ang < math.radians(28), proj, -1.0).max(axis=0)
    # where no vertex lies near that direction in the band (above the crown, thin bands): the plain support
    return np.where(near > 0, near, np.maximum(proj.max(axis=0), 0.0))



# ---------------------------------------------------------------- Blender

def build_objects(pieces, name):
    """All pieces of a kind as one cage object (vertex groups: the bones, part_<piece>, part_in_<piece> for the
    insides; UV seams; edge creases). Returns the object and the weight matrix."""
    import bpy

    verts, faces, W, parts, zones = [], [], [], [], []
    seams, creases = [], []
    for pc in pieces:
        pc.consistent()  # one winding across every edge (pieces not thickened: boots, soles, buttons)
        base = len(verts)
        verts += [B(*p) for p in pc.V]
        faces += [tuple(v + base for v in f) for f in pc.F]
        for w, inner in zip(pc.W, pc.inner):
            row = np.zeros(len(NAMES))
            for k, v in wnorm(w).items():
                row[IDX[k]] = v
            W.append(row)
            parts.append(("in_" if inner else "") + pc.name)
        zones += list(pc.zone)
        seams += [(a + base, b + base) for a, b in pc.seams]
        creases += [((a + base, b + base), c) for (a, b), c in pc.crease.items()]
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], [], faces)
    me.update()
    me.uv_layers.new(name="UVMap")
    # the cloth's own coordinates (cloth_detail: a check on the threads), carried per corner through the subdivision
    # and the reduction in a second UV layer, removed after the paint
    fab = np.zeros((len(verts), 2), np.float32)
    base = 0
    for pc in pieces:
        if pc.fabric:
            for v, uv in pc.fabric.items():
                fab[base + v] = uv
        base += len(pc.V)
    fl = me.uv_layers.new(name="fabric")
    lv = np.zeros(len(me.loops), np.int64)
    me.loops.foreach_get("vertex_index", lv)
    fl.data.foreach_set("uv", fab[lv].ravel())
    me.uv_layers.active = me.uv_layers["UVMap"]
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ek = {tuple(sorted(e.vertices)): e.index for e in me.edges}
    for a, b in seams:
        k = ek.get((min(a, b), max(a, b)))
        if k is not None:
            me.edges[k].use_seam = True
    ca = me.attributes.get("crease_edge") or me.attributes.new("crease_edge", "FLOAT", "EDGE")
    for (a, b), c in creases:
        k = ek.get((min(a, b), max(a, b)))
        if k is not None:
            ca.data[k].value = c
    for p in me.polygons:
        p.use_smooth = True
    groups = {}
    for i, pn in enumerate(parts):
        groups.setdefault(pn, []).append(i)
    for pn, idx in groups.items():
        ob.vertex_groups.new(name="part_" + pn).add(idx, 1.0, "REPLACE")
    zg = {}
    for i, z in enumerate(zones):
        if z:
            zg.setdefault(z, []).append(i)
    for z, idx in zg.items():
        ob.vertex_groups.new(name="zone_" + z).add(idx, 1.0, "REPLACE")
    Wm = np.array(W)
    wt.apply(ob, Wm, limit=0)
    return ob, Wm


def to_limit_keep_creases(ob):
    """lod.to_limit, but vertices on creased edges keep their place (a hem stays as thick as the cloth)."""
    from . import lod

    me = ob.data
    keep = set()
    ca = me.attributes.get("crease_edge")
    if ca is not None:
        for e in me.edges:
            if ca.data[e.index].value > 0:
                keep.update(e.vertices)
    co = np.array([v.co[:] for v in me.vertices])
    lod.to_limit(ob)
    for i in keep:
        me.vertices[i].co = co[i]
    me.update()


CUT_REACH = {"neck": 0.06, "arm": 0.06, "torso": 0.25, "leg": 0.30}


def cut_body(ob, covered, over=None, reach=None, tilt=30.0):
    """Remove the body faces nobody can see: every face whose vertices are all covered(point, part) (game space
    at rest, part name) and, given the garments (`over`, in the same space), lie under one of them: a ray out along
    the skin's normal meets a garment within the part's reach (CUT_REACH: 6 cm on the neck and arms, where a
    sleeve or collar is close, 30 cm on the legs under a skirt) and so do four rays tilted `tilt` degrees (so the
    skin just inside a cuff or a collar's edge stays: it is in sight when the limb bends), or the skin pokes out
    through a garment just there (a ray in meets it within 3 cm). The cover rules were drawn for the cage bodies;
    on the MakeHuman bodies a rule alone cut a hole at the nape that no collar covered. Head, eyes and hair stay,
    and so do the hands (MakeHuman's hand islands and the fingers): nothing covers them, and the old 30 cm reach cut
    faces of a hand hanging beside a smock."""
    import bmesh

    reach = dict(CUT_REACH, **(reach or {})) if not isinstance(reach, float) else {k: reach for k in CUT_REACH}
    vparts = wt.parts(ob)
    me = ob.data
    co = np.array([G(v.co) for v in me.vertices])
    hand = np.zeros(len(co), bool)
    isl = me.attributes.get("mh_island")
    if isl is not None:
        fi = np.zeros(len(me.polygons), np.int32)
        isl.data.foreach_get("value", fi)
        for p in me.polygons:
            if fi[p.index] in (1, 2):  # handL, handR (mhbody.ISLAND_NAMES)
                hand[list(p.vertices)] = True
    cov = np.array([(not str(p).startswith(("head", "eye", "hair", "finger"))) and not hand[i] and
                    bool(covered(co[i], p or "")) for i, p in enumerate(vparts)])
    if over is not None:
        from mathutils.bvhtree import BVHTree
        tree = BVHTree.FromPolygons([tuple(v.co) for v in over.data.vertices],
                                    [tuple(f.vertices) for f in over.data.polygons])
        ca, sa = math.cos(math.radians(tilt)), math.sin(math.radians(tilt))
        for i in np.nonzero(cov)[0]:
            v = me.vertices[int(i)]
            p = vparts[int(i)] or ""
            r = next((x for k, x in reach.items() if p.startswith(k)), 0.06)
            n = v.normal
            o = v.co + n * 0.0005
            # poking out through a garment just there (a ray in meets it): cut
            if tree.ray_cast(v.co, -n, 0.03)[0] is not None:
                continue
            if tree.ray_cast(o, n, r)[0] is None:
                cov[i] = False
                continue
            t = n.orthogonal().normalized()
            bt = n.cross(t)
            miss = 0
            for k in range(4):
                ph = k * math.pi / 2
                if tree.ray_cast(o, n * ca + (t * math.cos(ph) + bt * math.sin(ph)) * sa, r * 1.5)[0] is None:
                    miss += 1
            # one tilted ray may leave through an opening (the neck over a shoulder's top); two: the edge is near
            if miss > 1:
                cov[i] = False
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bm.verts.ensure_lookup_table()
    gone = [f for f in bm.faces if all(cov[v.index] for v in f.verts)]
    bmesh.ops.delete(bm, geom=gone, context="FACES_ONLY")
    loose = [v for v in bm.verts if not v.link_faces]
    bmesh.ops.delete(bm, geom=loose, context="VERTS")
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()
    return len(gone)


def _piece_of(parts):
    return [(p or "").removeprefix("in_") for p in parts]


def _outer_bvh(ob, parts, name):
    """A BVH of one piece's outer faces (not its lining), in the object's own (Blender) space."""
    from mathutils.bvhtree import BVHTree
    me = ob.data
    vs = [tuple(v.co) for v in me.vertices]
    faces = [tuple(f.vertices) for f in me.polygons if parts[f.vertices[0]] == name]
    if not faces:
        return None
    return BVHTree.FromPolygons(vs, faces)


def layer_order(ob):
    """Which piece lies over which, read on the full garments before they are reduced: from every outer vertex of a
    piece a ray out along its normal; a hit on another piece within 15 mm is a vote that the other lies over it.
    Returns {(under, over)} for the pairs whose votes agree."""
    from mathutils import Vector
    me = ob.data
    raw = wt.parts(ob)
    piece = _piece_of(raw)
    # fringes and buttons hang on whatever is next to them: they take no part in the layers
    names = sorted({p for p in piece if p and not p.endswith("fringe") and not p.startswith("button")})
    bvh = {n: _outer_bvh(ob, raw, n) for n in names}
    votes = {}
    for v in me.vertices:
        a = piece[v.index]
        if not a or raw[v.index] != a or a not in bvh:
            continue
        o = v.co + v.normal * 0.0003
        for b, tree in bvh.items():
            if b == a or tree is None:
                continue
            hit = tree.ray_cast(o, v.normal, 0.015)
            if hit[0] is not None:
                votes[(a, b)] = votes.get((a, b), 0) + 1
    return {(a, b) for (a, b), n in votes.items() if n >= 5 and n > 2 * votes.get((b, a), 0)}


def clear_layers(ob, body, order, clearance=0.002, passes=2, body_clearance=0.004):
    """After the reduction: a reduced piece's flat triangles cut under the round piece beneath it, which then shows
    through (the bodice through the shawl). For every pair (under, over) of layer_order, and for the body's skin
    under any piece: each point of the lower layer lies at least `clearance` under the upper layer's outer surface,
    and each point of the upper layer at least `clearance` over the lower layer's (both along the point's own
    normal; all shape keys move with it). Returns how many points moved."""
    from mathutils.bvhtree import BVHTree
    moved = 0

    def shift(target, i, d):
        me = target.data
        me.vertices[i].co = me.vertices[i].co + d
        if me.shape_keys:
            for kb in me.shape_keys.key_blocks:
                kb.data[i].co = kb.data[i].co + d

    for _ in range(passes):
        raw = wt.parts(ob)
        piece = _piece_of(raw)
        names = sorted({p for p in piece if p})
        outer = {n: _outer_bvh(ob, raw, n) for n in names}
        idx_of = {n: [i for i, p in enumerate(piece) if p == n] for n in names}
        # 1. the lower layer under the upper one (rays from 6 mm under each point, out along its normal)
        jobs = [(ob, idx_of[a], [b for (u, b) in order if u == a]) for a in names]
        if body is not None:
            jobs.append((body, list(range(len(body.data.vertices))), names))
        for target, idx, overs in jobs:
            trees = [outer[b] for b in overs if outer.get(b) is not None]
            if not trees or not idx:
                continue
            me = target.data
            for i in idx:
                v = me.vertices[i]
                n = v.normal.copy()
                o = v.co - n * 0.006
                best = None
                for tree in trees:
                    hit = tree.ray_cast(o, n, 0.02)
                    if hit[0] is not None and (best is None or hit[3] < best):
                        best = hit[3]
                cl = body_clearance if target is body else clearance
                if best is not None and best - 0.006 < cl:
                    shift(target, i, n * (best - 0.006 - cl))
                    moved += 1
            me.update()
        # 2. the upper layer over the lower one (rays from 6 mm over each point, in along its normal): a reduced
        # upper piece's points that dipped under the lower piece's flat triangles
        me = ob.data
        vs = [tuple(v.co) for v in me.vertices]
        for (u, b) in sorted(order):
            fu = [tuple(f.vertices) for f in me.polygons if raw[f.vertices[0]] == u]
            if not fu:
                continue
            tree = BVHTree.FromPolygons(vs, fu)
            for i in idx_of.get(b, []):
                if raw[i] != b:  # the upper piece's outer points only
                    continue
                v = me.vertices[i]
                n = v.normal.copy()
                o = v.co + n * 0.006
                hit = tree.ray_cast(o, -n, 0.02)
                # its height over the lower piece: the hit's distance less the 6 mm the ray started out
                if hit[0] is not None and hit[3] - 0.006 < clearance:
                    shift(ob, i, n * (clearance - (hit[3] - 0.006)))
                    moved += 1
        me.update()
    return moved


def follow_face_shapes(ob, hat_parts):
    """Head-fitted pieces (hats, caps) move with the face shapes of the head under them: each of their vertices
    takes the shape-key moves of its nearest head vertices."""
    from mathutils.kdtree import KDTree

    me = ob.data
    if not me.shape_keys:
        return
    vparts = wt.parts(ob)
    co = np.array([v.co[:] for v in me.vertices])
    head = [i for i, p in enumerate(vparts) if p in ("head", "hair")]
    hats = [i for i, p in enumerate(vparts) if p in hat_parts or (p or "").replace("in_", "", 1) in hat_parts]
    if not head or not hats:
        return
    kd = KDTree(len(head))
    for k, i in enumerate(head):
        kd.insert(co[i], k)
    kd.balance()
    near = []
    for i in hats:
        hits = kd.find_n(co[i], 6)
        w = np.array([1.0 / (d + 0.002) ** 2 for _, _, d in hits])
        near.append(([head[k] for _, k, _ in hits], w / w.sum()))
    basis = me.shape_keys.reference_key
    bco = np.array([d.co[:] for d in basis.data])
    for kb in me.shape_keys.key_blocks:
        if kb == basis:
            continue
        kco = np.array([d.co[:] for d in kb.data])
        off = kco - bco
        for i, (idx, w) in zip(hats, near):
            kco[i] = bco[i] + (off[idx] * w[:, None]).sum(0)
        kb.data.foreach_set("co", kco.ravel())


# ---------------------------------------------------------------- the paint

class Cloth:
    """A cloth's look: colour (sRGB), the weave and how it wears. kind: linen, cotton, wool, felt, corduroy, leather,
    wood, metal."""

    def __init__(self, rgb, kind="wool", wear=0.4, mud=0.0, dust=0.0, tar=0.0, coal=0.0, sheen=0.0, lining=None,
                 folds=1.0, extra=None, mud_h=0.32):
        self.rgb = np.array(rgb, np.float32)
        self.kind = kind
        self.wear = wear
        self.mud = mud
        self.dust = dust
        self.tar = tar
        self.coal = coal
        self.sheen = sheen
        self.lining = np.array(lining if lining is not None else np.array(rgb) * 0.75, np.float32)
        self.folds = folds
        self.extra = extra  # extra(ctx) paints on top: buttons, stripes, seams, patches
        self.mud_h = mud_h  # how high the mud reaches (metres over the ground)


def hexrgb(h):
    return ((h >> 16 & 255) / 255.0, (h >> 8 & 255) / 255.0, (h & 255) / 255.0)


WEAVE = {
    # (scale of the threads, strength in colour, strength in height, slub lines)
    "linen": (900.0, 0.05, 0.00004, 0.6),
    "cotton": (1100.0, 0.035, 0.00003, 0.3),
    "wool": (700.0, 0.04, 0.00005, 0.0),
    "felt": (300.0, 0.03, 0.00003, 0.0),
    "corduroy": (0.0, 0.06, 0.00012, 0.0),
    "leather": (180.0, 0.05, 0.00006, 0.0),
    "wood": (0.0, 0.10, 0.00008, 0.0),
    "metal": (0.0, 0.0, 0.0, 0.0),
}


def undershirt(ctx, rgb, top, zone=2, bottom=None, covers=None, skip=()):
    """The body's skin painted as the cloth worn under a garment, on the trunk and the neck below `top` (metres)
    and, given the kind's cover rule, wherever that rule says a garment covers the skin: where a reduced garment's
    neckline leaves the skin of the shoulders in sight, or a slider's broader shoulders push the skin through the
    cloth, a shirt or a lining shows there, not bare skin. zone: the detail zone (pictures.ZONES: 1 wool, 2 linen)."""
    m = starts(ctx.part, ("torso", "neck")) & (ctx.y < top)
    if covers is not None:
        pts = np.stack((ctx.x, ctx.y, ctx.z), -1)
        never = ("head", "eye", "finger") + tuple(skip)  # skip: parts the kind paints itself (stockings)
        # (#138) the trunk's skin above the neck's lowest point is judged as the neck (its rule is by height): the
        # trunk/neck part edge runs along triangles, and a rule by part painted saw teeth of cloth on the skin above
        # a neckline
        parts = np.asarray(ctx.part).astype(str)
        neck = np.char.startswith(parts, "neck")
        neck_lo = float(ctx.y[neck].min()) if neck.any() else np.inf
        near_neck = np.abs(ctx.x) < 0.085  # (round the neck only: the shoulders' tops keep the trunk's rule)
        as_part = np.where(np.char.startswith(parts, "torso") & (ctx.y > neck_lo) & near_neck, "neck", parts)
        m |= np.array([bool(covers(pts[i], p or "")) and not str(p).startswith(never)
                       for i, p in enumerate(as_part)])
    if bottom is not None:
        m &= ctx.y > bottom
    n = 0.5 + 0.5 * _noise3(np.stack((ctx.x, ctx.y, ctx.z), -1), 140.0, 5)
    col = np.asarray(rgb, np.float32)[None] * (0.93 + 0.10 * n)[:, None]
    ctx.rgb[m] = col[m]
    ctx.h[m] += 0.0001 * n[m]
    if hasattr(ctx, "detail_zone"):
        ctx.detail_zone[m] = zone


class Ctx:
    """What a painter sees of its texels: pos, nrm (game space at rest), inner (inside cloth), the piece, the
    figure (P, J), and rgb, h (colour and height, changed in place)."""

    def __init__(self, pos, nrm, inner, piece, fit, rgb, h, seed):
        self.pos, self.nrm, self.inner, self.piece, self.fit = pos, nrm, inner, piece, fit
        self.rgb, self.h = rgb, h
        self.seed = seed
        self.x, self.y, self.z = pos[:, 0], pos[:, 1], pos[:, 2]
        self.zone = np.full(len(pos), "", dtype=object)

    def mix(self, w, col):
        w = np.clip(np.asarray(w, np.float32), 0, 1)[:, None]
        self.rgb[:] = self.rgb * (1 - w) + np.asarray(col, np.float32) * w

    def mul(self, w, k):
        w = np.clip(np.asarray(w, np.float32), 0, 1)[:, None]
        self.rgb[:] = self.rgb * (1 - w + w * np.asarray(k, np.float32))

    def bump(self, w, amount):
        self.h += np.asarray(w, np.float64) * amount


def paint_cloth(ctx):
    """The common paint of a cloth: colour with its weave, the folds, wear on the edges and high spots, mud at the
    hems, dust, tar and coal; the inside darker (the lining)."""
    cl = ctx.piece.cloth
    p = ctx.pos
    n = len(p)
    seed = ctx.seed
    base = np.broadcast_to(cl.rgb, (n, 3)).copy()
    base[ctx.inner] = cl.lining
    sc, cs, hs, slub = WEAVE.get(cl.kind, WEAVE["wool"])
    n1 = _noise3(p, 6.0, seed)
    n2 = _noise3(p, 30.0, seed + 1)
    n3 = _noise3(p, 140.0, seed + 2)
    col = base * (1 + 0.05 * n1 + 0.035 * n2 + 0.025 * n3)[:, None]
    h = np.zeros(n)
    if cl.kind in ("linen", "cotton", "wool", "felt", "leather"):
        f = _noise3(p, sc, seed + 3)
        col *= (1 + cs * f)[:, None]
        h += hs * f
        if slub:
            # slubs: thicker threads in a linen weave, running along and across
            s1 = _noise3(p * np.array((1.0, 30.0, 1.0)), 60.0, seed + 4)
            s2 = _noise3(p * np.array((30.0, 1.0, 30.0)), 60.0, seed + 5)
            sl = np.clip(np.maximum(s1, s2) - 0.55, 0, 1) * 2.2 * slub
            col *= (1 + 0.08 * sl)[:, None]
            h += 0.00005 * sl
    if cl.kind == "corduroy":
        # wales running down the leg: ribs about 3 mm apart round the body
        ang = np.arctan2(p[:, 0] - np.sign(p[:, 0]) * 0.09, p[:, 2])
        rib = np.cos(ang * 0.06 / 0.003 * 2) * 0.5 + 0.5
        col *= (0.96 + 0.06 * rib)[:, None]
        h += 0.00010 * rib
    if cl.kind == "leather":
        crack = np.clip(np.abs(_noise3(p, 90.0, seed + 6)) * 8 - 7.0, 0, 1)
        col *= (1 - 0.18 * crack)[:, None]
        h -= 0.00008 * crack
    # folds: soft long ripples (hanging cloth folds run down, bent joints crease across)
    if cl.folds > 0 and cl.kind not in ("wood", "metal"):
        fv = _noise3(p * np.array((1.0, 0.18, 1.0)), 22.0, seed + 7)
        fh = _noise3(p * np.array((0.25, 1.0, 0.25)), 26.0, seed + 8)
        hang = np.clip(-ctx.nrm[:, 1] * 0.0 + 1.0, 0, 1)
        h += cl.folds * (0.0009 * fv * hang + 0.0005 * fh)
        col *= (1 + 0.035 * cl.folds * fv)[:, None]
    # wear: lighter, thinner where cloth rubs (edges are painted by the pieces' own extras); mottled fading
    fade = np.clip(_noise3(p, 4.0, seed + 9) * 0.5 + 0.5, 0, 1)
    col = col * (1 - 0.12 * cl.wear * fade[:, None]) + np.array((0.55, 0.53, 0.50)) * 0.12 * cl.wear * fade[:, None]
    ctx.rgb[:] = col
    ctx.h[:] = h
    if cl.extra is not None:
        cl.extra(ctx)
    grime(ctx, cl)


def grime(ctx, cl):
    """Mud at the bottom (by height over the ground), dust, tar, coal."""
    p = ctx.pos
    seed = ctx.seed
    y = p[:, 1]
    if cl.mud > 0:
        splat = np.clip(_noise3(p, 55.0, seed + 11) * 1.6 + 0.2, 0, 1) * (0.6 + 0.4 * np.clip(_noise3(p, 260.0, seed + 16) * 2, 0, 1))
        m = cl.mud * sm(cl.mud_h, 0.03 * cl.mud_h / 0.32, y) * (0.35 + 0.65 * splat)
        ctx.mix(m * 0.85, (0.24, 0.21, 0.17))
        ctx.bump(m, 0.0002)
    if cl.dust > 0:
        d = cl.dust * np.clip(_noise3(p, 9.0, seed + 12) * 0.6 + 0.6, 0, 1)
        ctx.mix(d * 0.25, (0.58, 0.55, 0.50))
    if cl.tar > 0:
        t = np.clip(_noise3(p, 18.0, seed + 13) * 2.4 - 1.2, 0, 1) * cl.tar
        t = np.maximum(t, np.clip(_noise3(p, 70.0, seed + 14) * 3.0 - 2.2, 0, 1) * cl.tar)
        ctx.mix(t * 0.9, (0.06, 0.055, 0.05))
        ctx.bump(t, 0.0001)
    if cl.coal > 0:
        c = cl.coal * np.clip(_noise3(p, 12.0, seed + 15) * 0.7 + 0.5, 0, 1)
        ctx.mix(c * 0.45, (0.10, 0.10, 0.10))


# -- extras the pieces use

def seam_line(ctx, dist, width=0.0012, depth=0.00012, shade=0.82, stitches=True):
    """A sewn seam where dist (metres from the seam line, per texel) is near zero: a groove and a row of stitches."""
    g = np.exp(-(np.asarray(dist) / width) ** 2)
    ctx.bump(g, -depth)
    ctx.mul(g, shade)
    if stitches:
        s = np.exp(-((np.abs(dist) - 0.0035) / 0.0007) ** 2)
        along = 0.5 + 0.5 * np.cos(ctx.pos[:, 1] * 2 * math.pi / 0.004 + ctx.pos[:, 0] * 1500.0)
        ctx.bump(s * along, 0.00005)


def button(ctx, centre, r=0.008, rgb=(0.20, 0.17, 0.14), metal=False, normal_dir=None):
    """A round button at a point (game space at rest): raised, two holes or a shank, a rim."""
    d = np.linalg.norm(ctx.pos - np.asarray(centre), axis=1)
    m = d < r
    if not m.any():
        return
    t = d[m] / r
    ctx.h[m] += 0.0016 * np.sqrt(np.clip(1 - t * t, 0, 1))
    col = np.asarray(rgb, np.float32)
    shade = 1.0 + (0.35 if metal else 0.08) * (1 - t) - 0.25 * (t > 0.82)
    ctx.rgb[m] = col * shade[:, None]
    if not metal:
        for dx in (-0.25, 0.25):
            hole = np.linalg.norm(ctx.pos[m] - (np.asarray(centre) + np.array((dx * r, 0, 0))), axis=1) < 0.12 * r
            ctx.rgb[np.nonzero(m)[0][hole]] *= 0.4
    ctx.mix(np.exp(-((d - r) / 0.0012) ** 2) * (d > r) * 0.5, (0.05, 0.05, 0.05))


def patch(ctx, centre, half, rgb, along=(0, 1, 0)):
    """A sewn-on patch: a rectangle round a point (half sizes across and along, metres), a different cloth, raised a
    little, its edge stitched."""
    c = np.asarray(centre)
    d = ctx.pos - c
    a = np.asarray(along, np.float64)
    a /= np.linalg.norm(a)
    nrm = ctx.nrm
    across = norm(np.cross(nrm, a))
    u = (d * across).sum(1)
    v = d @ a
    inside = (np.abs(u) < half[0]) & (np.abs(v) < half[1]) & (np.linalg.norm(d, axis=1) < max(half) * 2.0)
    if not inside.any():
        return
    ctx.rgb[inside] = np.asarray(rgb, np.float32) * (1 + 0.05 * _noise3(ctx.pos[inside], 300.0, 77))[:, None]
    ctx.h[inside] += 0.0004
    edge = inside & ((half[0] - np.abs(u) < 0.003) | (half[1] - np.abs(v) < 0.003))
    ctx.mul(edge, 0.85)
    ctx.bump(edge, -0.00015)


# ---------------------------------------------------------------- garments

ARM_SEQ = ["d1", "d2", "a2", "a3", "a4", "e1", "e2", "e3", "f1", "f2", "w1", "w2", "p0"]
LEG_SEQ = ["l1", "l2", "l3", "k1", "k2", "k3", "c1", "c2", "c3", "t1", "t2", "heel", "f1", "f2", "f3", "toe"]


def info(fit, i):
    """(part, row or ring, column) of a cage vertex; arm and leg rings by name."""
    part, tg = fit.C.part[i], fit.C.tag[i]
    return part, tg.get("row", tg.get("ring")), tg.get("col", -1)


def upper(fit, pc, rows=(0, 9), neck=None, sleeve="w1", ease=None, open_front=None, keep=None):
    """A garment over the trunk: cage rows rows[0]..rows[1], the neck rings up to `neck` (None, 0 or 1) and both arms
    down to the arm ring `sleeve` (None: sleeveless; the arm holes then get hems). ease(i) gives each cage vertex's
    ease in metres. open_front=(left_x(y), right_x(y), lift): the garment opens down the front (column 0): the
    wearer's left front edge moves to x = left_x(y), the right one to right_x(y); the left edge is lifted out by
    `lift` (it lies over the right one where they overlap). keep(i): a further test per cage vertex (a V neck).
    Returns ({cage vertex: piece vertex}, {cage vertex: the
    right front edge's copy})."""
    arm_ok = set(ARM_SEQ[:ARM_SEQ.index(sleeve) + 1]) if sleeve else set()

    def allow(i):
        part, tg = fit.C.part[i], fit.C.tag[i]
        if keep is not None and not keep(i):
            return False
        if part == "torso":
            if tg.get("crotch"):
                return False
            return rows[0] <= tg["row"] <= rows[1]
        if part == "neck":
            return neck is not None and tg["ring"] <= neck
        if part.startswith("arm"):
            return tg.get("ring") in arm_ok and "w" not in tg
        return False

    vmap = from_cage(fit, pc, allow, ease or (lambda i: 0.01))
    dup = {}
    if open_front is not None:
        lx, rx, lift = open_front
        inv = {v: k for k, v in vmap.items()}
        Nv = pc.normals()
        for k, f in enumerate(pc.F):
            cs = [inv.get(v) for v in f]
            cols = [fit.C.tag[c].get("col", -1) if c is not None else -1 for c in cs]
            parts = [fit.C.part[c] if c is not None else "" for c in cs]
            if 15 in cols and 0 in cols and all(p in ("torso", "neck") for p in parts):
                nf = []
                for v, c, col in zip(f, cs, cols):
                    if col == 0:
                        if c not in dup:
                            dup[c] = pc.add(pc.V[v].copy(), pc.W[v])
                        nf.append(dup[c])
                    else:
                        nf.append(v)
                pc.F[k] = tuple(nf)
        for c, v in vmap.items():
            if c in dup:
                p = pc.V[v]
                pc.V[v] = np.array((lx(p[1]), p[1], p[2])) + Nv[v] * lift
                q = pc.V[dup[c]]
                pc.V[dup[c]] = np.array((rx(q[1]), q[1], q[2])) - Nv[v] * lift * 0.5
    return vmap, dup


def row_loop(fit, vmap, r, dup=None):
    """The piece vertices of trunk row r round the body (column 0 first, round the left side and the back); with an
    open front the right edge's copy of column 0 closes it as the last point."""
    row = fit.row(r)
    lp = [vmap[i] for i in row if i >= 0 and i in vmap]
    if dup and row[0] in dup:
        lp.append(dup[row[0]])
    return lp


def leg_centres(fit):
    """The centre of every leg ring of the cage: (side, ring) -> point."""
    acc = {}
    for i, (part, tg) in enumerate(zip(fit.C.part, fit.C.tag)):
        if part.startswith("leg") and "ring" in tg:
            acc.setdefault((tg["side"], tg["ring"]), []).append(fit.rest[i])
    return {k: np.mean(v, axis=0) for k, v in acc.items()}


def trousers(fit, pc, top_row=3, hem="t2", ease=None):
    """Trousers: the trunk rows 0..top_row with the crotch, and both legs down to the leg ring `hem`."""
    leg_ok = set(LEG_SEQ[:LEG_SEQ.index(hem) + 1])

    def allow(i):
        part, tg = fit.C.part[i], fit.C.tag[i]
        if part == "torso":
            return tg.get("crotch", False) or tg["row"] <= top_row
        if part.startswith("leg"):
            return tg.get("ring") in leg_ok
        return False

    return from_cage(fit, pc, allow, ease or (lambda i: 0.012))


def straight_leg(fit, radius, below):
    """For trouser legs that fall straight: f(i, ease) -> ease, below height `below` a leg vertex is pushed out to
    `radius` (cage metres) from its ring's centre."""
    cen = leg_centres(fit)

    def f(i, e):
        part, tg = fit.C.part[i], fit.C.tag[i]
        if not part.startswith("leg") or "ring" not in tg or fit.rest[i][1] > below + 0.08:
            return e
        c = cen[(tg["side"], tg["ring"])]
        d = fit.rest[i] - c
        d[1] = 0
        r = float(np.linalg.norm(d))
        k = float(sm(below + 0.08, below - 0.04, fit.rest[i][1]))
        return max(e, e + (radius - r) * k)
    return f



def loft_z(pc, stations, n, weights, cx=0.0, power=3.2, power_bottom=6.0, caps=True, crease_cols=(), crease=0.08):
    """A closed shape lofted along z (forward): stations (z, half width, bottom y, top y, x shift); n points round
    each cross-section, from the top round the outside (+x) to the bottom. Ends closed by a point each. Returns
    the vertex ids (stations, n)."""
    rows = []
    for z, hw, yb, yt, xs in stations:
        ym, hh = (yb + yt) / 2, (yt - yb) / 2
        row = []
        for j in range(n):
            a = 2 * math.pi * j / n
            s, c = math.sin(a), math.cos(a)
            p_ = power if c >= 0 else power_bottom
            x = cx + xs + hw * math.copysign(abs(s) ** (2 / p_), s)
            y = ym + hh * math.copysign(abs(c) ** (2 / p_), c)
            row.append((x, y, z))
        rows.append(row)
    pts = np.array(rows)
    ids = pc.grid(pts, lambda p: weights(p), closed=True, seam_col=n // 2)
    if caps:
        for end, k in ((0, 0), (-1, len(stations) - 1)):
            c = pts[k].mean(0)
            c[2] += -0.006 if end == 0 else 0.006
            cv = pc.add(c, weights(c))
            for j in range(n):
                a, b = ids[k, j], ids[k, (j + 1) % n]
                pc.face((cv, b, a) if end == 0 else (cv, a, b))
                pc.seam(a, b)  # each end its own island: the tube and its caps lie flat apart
    for j in crease_cols:
        for i in range(len(stations) - 1):
            pc.set_crease(ids[i, j], ids[i + 1, j], crease)
    return ids


def clogs(fit, pc, side, length=1.0):
    """A carved wooden clog (the Flemish klomp) round one foot: a flat sole with a slight rocker, a high heel collar,
    a roomy instep and a toe drawn out to a blunt, upturned point. Weighted to the foot (the toe end partly to the
    toe bone, so it rolls instead of digging into the ground at toe off)."""
    P = fit.P
    s = P["w"] * P["f"]["foot"]
    sg = 1 if side == "L" else -1
    lx = fit.hip_x
    cx = sg * (lx - 0.003 * s)
    st = [(-0.070, 0.026, 0.012, 0.055, 0.0), (-0.056, 0.040, 0.0, 0.070, 0.0), (-0.022, 0.046, 0.0, 0.078, 0.0),
          (0.040, 0.050, 0.0, 0.096, 0.002), (0.100, 0.055, 0.0, 0.091, 0.004), (0.160, 0.053, 0.002, 0.080, 0.004),
          (0.212, 0.042, 0.012, 0.070, 0.002), (0.250, 0.022, 0.032, 0.062, 0.0)]
    stations = [(z * s * length, hw * s, yb, yt, sg * xs) for z, hw, yb, yt, xs in st]

    def w(p):
        t = float(sm(0.13 * s, 0.26 * s, p[2])) * 0.6
        return wnorm({"foot" + side: 1 - t, "toe" + side: t})
    ids = loft_z(pc, stations, 12, w, cx=cx, power=2.6, power_bottom=9.0, crease_cols=(4, 8), crease=0.06)
    pc.orient(lambda c: np.array((c[0] - cx, c[1] - 0.045, c[2] - 0.09)))
    return ids


def hat_weights(p):
    return dict(HEAD_ONLY)


def flat_cap(fit, pc, peak, n=16, band=0.020, margin=0.011, puff=0.012, fwd=0.012, tilt=0.024):
    """The workman's cloth cap of the docks: a band round the head above the ears (lower at the back), a soft, low
    crown a little wider than the band and pulled forward over a short stiff peak (its own piece), its top nearly
    flat. Fitted to the head and hair of the built body; weighted to the head."""
    P = fit.P
    chin = bd.Y(P, 0.870)
    hs = P["hs"]
    c, top = head_axis(fit)
    phis = 2 * math.pi * np.arange(n) / n
    front = 0.5 + 0.5 * np.cos(phis)
    lift = 0.010 if "mh" in P else 0.0  # MakeHuman's head: the band sits on the forehead, not on the brows
    y0 = chin + hs * (0.116 + lift + tilt * front + 0.004 * np.cos(2 * phis))
    sup = lambda yy: np.array([head_support(fit, yy[j], phis[j:j + 1])[0] for j in range(n)])
    r0 = sup(y0) + margin
    r1 = np.maximum(sup(y0 + band) + margin + 0.001, r0 - 0.002)
    ov = puff + 0.008 * front
    rings = [(y0, r0, 0.0), (y0 + band, r1, 0.0),
             (0.5 * (y0 + band) + 0.5 * (top - 0.012), r1 + 0.7 * ov, 0.5 * fwd * front),
             (top - 0.006 - 0.004 * front, r1 + ov, fwd * front),
             (top + 0.005 - 0.003 * front, r1 + ov - 0.016, fwd * front),
             (top + 0.008 - 0.003 * front, (r1 + ov) * 0.5, 0.6 * fwd * front)]
    pts = np.array([np.stack([c[0] + r * np.sin(phis), y, c[2] + r * np.cos(phis) + f], -1) for y, r, f in rings])
    ids = pc.grid(pts, hat_weights, closed=True, seam_col=n // 2)
    cv = pc.add(pts[-1].mean(0) + np.array((0, 0.001, 0)), dict(HEAD_ONLY))
    for j in range(n):
        pc.face((ids[-1, j], ids[-1, (j + 1) % n], cv))
    pc.seam(ids[-1, n // 2], cv)
    pc.orient(lambda q: q - np.array((c[0], q[1] - 0.06, c[2])))
    # the peak: a stiff plate curving round the band's front, out 5 cm and down, tucked under the crown
    pa = np.linspace(-1.0, 1.0, 7)
    rows = []
    y_front = chin + hs * (0.116 + lift + tilt) + 0.004
    for out, dy in ((-0.003, 0.0), (0.024, -0.009), (0.050, -0.020)):
        rr = np.array([head_support(fit, y_front, [a])[0] for a in pa]) + margin + 0.003
        rr = rr + out * np.cos(pa) ** 0.7
        y = y_front + dy * np.cos(pa) ** 0.5 - 0.004 * (1 - np.cos(pa))
        rows.append(np.stack([c[0] + rr * np.sin(pa), y, c[2] + rr * np.cos(pa)], -1))
    pk = peak.grid(np.array(rows), hat_weights)
    peak.orient((0, 1, 0.2))
    return ids, pk


def neck_rings(fit):
    C = fit.C
    out = []
    for ring in (0, 1):
        idx = [i for i, (p, t) in enumerate(zip(C.part, C.tag)) if p == "neck" and t.get("ring") == ring]
        idx.sort(key=lambda i: C.tag[i]["col"])
        out.append(idx)
    return out


def neckerchief(fit, pc, knot=True, ease=0.018, tails=None, tail_d=0.016, onto=None):
    """A cotton neckerchief, folded into a band and rolled round the neck over the collar, knotted in front; two
    short ends hang from the knot (tails: a second piece for them, laid on the chest `tail_d` out from the body)."""
    n0, n1 = neck_rings(fit)
    rows = []
    # a rolled band: tucked in at its edges, full in the middle
    for t, e in ((-0.25, 0.4), (0.1, 0.95), (0.5, 0.85), (0.75, 0.3)):
        pts = []
        for a, b in zip(n0, n1):
            p = fit.rest[a] * (1 - t) + fit.rest[b] * t
            n_ = norm(fit.N[a] * (1 - t) + fit.N[b] * t)
            pts.append(p + n_ * ease * e)
        rows.append(pts)
    pts = np.array(rows)
    wf = lambda p: fit.near_w(p, ("neck", "torso"))
    ids = pc.grid(pts, wf, closed=True, seam_col=8)
    pc.orient(lambda q: q - np.array((0.0, q[1], -0.01)))
    if not knot:
        return ids
    f0 = pts[1, 0]
    kc = f0 + np.array((0.0, -0.012, 0.010))
    rx, ry, rz = 0.017, 0.014, 0.011
    rings = []
    for a in np.linspace(-1.15, 1.15, 4):
        rings.append([kc + np.array((rx * math.cos(a) * math.sin(b), ry * math.sin(a), rz * math.cos(a) * math.cos(b)))
                      for b in np.linspace(0, 2 * math.pi, 6, endpoint=False)])
    kid = pc.grid(np.array(rings), wf, closed=True, seam_col=3)
    for end in (0, 3):
        cv = pc.add(np.mean([pc.V[v] for v in kid[end]], axis=0), pc.W[kid[end][0]])
        for j in range(6):
            a, b = kid[end][j], kid[end][(j + 1) % 6]
            pc.face((cv, b, a) if end == 0 else (cv, a, b))
        pc.seam(cv, kid[end][3])
    pc.orient(lambda q: q - np.array((0.0, q[1], -0.01)))
    if tails is not None:
        for sg in (1, -1):
            path = [kc + np.array((sg * 0.006, -0.008, -0.004)), kc + np.array((sg * 0.016, -0.038, -0.010)),
                    kc + np.array((sg * 0.026, -0.068, -0.016))]
            strap_grid(fit, tails, path, [0.030, 0.024, 0.005], tail_d, wfn=wf, parts=("torso", "neck"), cols=3,
                       onto=onto)
    return ids


class Onto:
    """The outer surface of pieces already made, as they will be after the subdivision: snap(p, d) puts a point d
    metres out from it (a pad on a smock, a belt on a tunic, a shawl on a bodice)."""

    def __init__(self, pieces, skip_zones=()):
        import bpy
        from mathutils.bvhtree import BVHTree

        verts, faces = [], []
        for pc in pieces:
            base = len(verts)
            verts += [tuple(B(*v)) for v in pc.V]
            faces += [tuple(v + base for v in f) for f in pc.F
                      if not any(pc.inner[v] or pc.zone[v] in skip_zones for v in f)]
        me = bpy.data.meshes.new("_onto")
        me.from_pydata(verts, [], faces)
        me.update()
        ob = bpy.data.objects.new("_onto", me)
        bpy.context.scene.collection.objects.link(ob)
        m = ob.modifiers.new("subd", "SUBSURF")
        m.levels = 1
        m.use_limit_surface = True
        dg = bpy.context.evaluated_depsgraph_get()
        self.bvh = BVHTree.FromObject(ob, dg)
        bpy.data.objects.remove(ob)
        bpy.data.meshes.remove(me)
        # the pieces' own weights, so a thing laid on them moves with them (an apron with its skirt)
        from mathutils.kdtree import KDTree
        self.WV, self.WW = [], []
        for pc in pieces:
            for p, w, inner, z in zip(pc.V, pc.W, pc.inner, pc.zone):
                if not inner and z not in skip_zones:
                    self.WV.append(p)
                    self.WW.append(w)
        self.kd = KDTree(len(self.WV))
        for i, p in enumerate(self.WV):
            self.kd.insert(p, i)
        self.kd.balance()

    def weights(self, p, k=4):
        acc = {}
        tot = 0.0
        for _, i, d in self.kd.find_n(tuple(p), k):
            g = 1.0 / (d + 0.004) ** 2
            tot += g
            for b, x in self.WW[i].items():
                acc[b] = acc.get(b, 0.0) + x * g
        return wnorm({b: x / tot for b, x in acc.items()})

    def find(self, p):
        loc, nrm, _, _ = self.bvh.find_nearest(tuple(B(*p)))
        return np.array(G(loc)), norm(np.array(G(nrm)))

    def snap(self, p, d):
        loc, n = self.find(p)
        return loc + n * d


def strap_grid(fit, pc, path, widths, d, wfn=None, parts=None, cols=4, onto=None, rows=None):
    """A band laid on the body along `path` (points near the body), `widths` across (one per point, or one), each
    point snapped `d` metres out from the body. Returns ids (len(path), cols)."""
    path = np.asarray(path, np.float64)
    widths = np.broadcast_to(np.asarray(widths, np.float64), (len(path),)).copy()
    if rows and rows > len(path):
        # more rows along the band (a curved surface under it: flat quads between few points would sink in)
        L = np.concatenate([[0.0], np.cumsum(np.linalg.norm(np.diff(path, axis=0), axis=1))])
        t = np.linspace(0, L[-1], rows)
        path = np.stack([np.interp(t, L, path[:, k]) for k in range(3)], -1)
        widths = np.interp(t, L, widths)
    m = len(path)
    rows = []
    us = np.linspace(-0.5, 0.5, cols)
    snap = onto.snap if onto is not None else fit.snap
    for k in range(m):
        t = path[min(k + 1, m - 1)] - path[max(k - 1, 0)]
        t = t / np.linalg.norm(t)
        n = onto.find(path[k])[1] if onto is not None else fit.surface(path[k], parts)[1]
        a = np.cross(n, t)
        a = a / np.linalg.norm(a)
        rows.append([snap(path[k] + a * widths[k] * u, d) for u in us])
    pts = np.array(rows)
    ids = pc.grid(pts, wfn or (onto.weights if onto is not None else (lambda p: fit.near_w(p, parts))))
    pc.orient(lambda q: snap(q, 0.05) - snap(q, 0.0))
    return ids


def smooth_weights(pc, iters=3, mask=None, amount=0.5):
    """Spread a piece's weights over its surface (cloth does not crease as sharply as skin at a knee or an elbow):
    each pass moves every masked vertex's weights `amount` of the way to its neighbours' mean."""
    nb = {}
    for f in pc.F:
        for k in range(len(f)):
            a, b = f[k], f[(k + 1) % len(f)]
            nb.setdefault(a, set()).add(b)
            nb.setdefault(b, set()).add(a)
    for _ in range(iters):
        new = list(pc.W)
        for v, ns in nb.items():
            if mask is not None and not mask(pc.V[v]):
                continue
            acc = {}
            for u in ns:
                for k_, x in pc.W[u].items():
                    acc[k_] = acc.get(k_, 0.0) + x / len(ns)
            new[v] = wnorm(wmix(pc.W[v], acc, amount))
        pc.W = new


def unwrap(ob, scales, margin=0.004):
    """UVs for a clothes cage: Blender's angle-based unwrap along the seams, then every island checked (one that did
    not flatten is projected on its own best plane), scaled to one texel density times its piece's factor
    (scales: part name -> factor; part names part_<piece>, part_in_<piece>), turned to its smallest box and packed
    in shelves into the unit square."""
    import bpy

    bpy.context.view_layer.objects.active = ob
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ob.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.unwrap(method="ANGLE_BASED", margin=margin)
    bpy.ops.object.mode_set(mode="OBJECT")
    me = ob.data
    uvd = me.uv_layers["UVMap"].data
    uv = np.zeros(len(uvd) * 2)
    uvd.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    co = np.array([v.co[:] for v in me.vertices])
    vparts = [p or "" for p in wt.parts(ob)]
    seam = {tuple(sorted(e.vertices)) for e in me.edges if e.use_seam}
    parent = list(range(len(me.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a
    ef = {}
    for p in me.polygons:
        vs = list(p.vertices)
        for i in range(len(vs)):
            k = tuple(sorted((vs[i], vs[(i + 1) % len(vs)])))
            if k not in seam:
                ef.setdefault(k, []).append(p.index)
    for fs in ef.values():
        for f in fs[1:]:
            ra, rb = find(fs[0]), find(f)
            if ra != rb:
                parent[rb] = ra
    islands = {}
    for p in me.polygons:
        islands.setdefault(find(p.index), []).append(p)
    boxes = []
    for polys in islands.values():
        loops = np.array([li for p in polys for li in p.loop_indices])
        lv = np.array([me.loops[li].vertex_index for li in loops])
        a3 = sum(p.area for p in polys)
        q = uv[loops].copy()
        a2 = 0.0
        for p in polys:
            t = uv[list(p.loop_indices)]
            a2 += 0.5 * abs(np.dot(t[:, 0], np.roll(t[:, 1], -1)) - np.dot(t[:, 1], np.roll(t[:, 0], -1)))
        bad = (not np.isfinite(q).all()) or a2 < 1e-9 or a3 < 1e-12
        if not bad:
            # the island must lie flat: no face turned over, no far-flung spike
            sg = []
            for p in polys:
                t = uv[list(p.loop_indices)]
                sg.append(np.dot(t[:, 0], np.roll(t[:, 1], -1)) - np.dot(t[:, 1], np.roll(t[:, 0], -1)))
            sg = np.array(sg)
            flipped = min((sg > 0).sum(), (sg < 0).sum())
            ext = q.max(0) - q.min(0)
            bad = ext.max() > 50 * math.sqrt(a2) or flipped > max(1, 0.02 * len(sg))
        if bad:
            P = co[lv]
            c = P.mean(0)
            u_, s_, vt = np.linalg.svd(P - c, full_matrices=False)
            q = (P - c) @ vt[:2].T
            a2 = 0.0
            at = {li: k_ for k_, li in enumerate(loops)}
            for p in polys:
                t = q[[at[li] for li in p.loop_indices]]
                a2 += 0.5 * abs(np.dot(t[:, 0], np.roll(t[:, 1], -1)) - np.dot(t[:, 1], np.roll(t[:, 0], -1)))
        # rims and insides (any vertex inside) at the insides' density (dress.build: the same as the outside)
        vp = [vparts[v] for p in polys for v in p.vertices]
        part = next((x for x in vp if x.startswith("in_")), vp[0])
        k = scales.get(part, 1.0)
        s = math.sqrt(a3 / max(a2, 1e-12)) * k
        q = q * s
        best = None
        for deg in range(0, 90, 3):
            r = math.radians(deg)
            R = np.array([[math.cos(r), -math.sin(r)], [math.sin(r), math.cos(r)]])
            qq = q @ R.T
            e = qq.max(0) - qq.min(0)
            if best is None or e[0] * e[1] < best[0]:
                best = (e[0] * e[1], qq)
        qq = best[1]
        qq -= qq.min(0)
        if qq[:, 1].max() > qq[:, 0].max():
            qq = np.stack([qq[:, 1], -qq[:, 0]], -1)  # lie down (a turn, not a mirror): shelves pack long islands better
            qq -= qq.min(0)
        if os.environ.get("PEOPLE2_DEBUG_UV"):
            print("[uv] island %-16s faces %4d bad %d a3 %.4f box %.3f x %.3f" % (
                part, len(polys), bad, a3, qq[:, 0].max(), qq[:, 1].max()))
        boxes.append((loops, qq))
    total = sum(np.prod(q.max(0)) for _, q in boxes)
    boxes.sort(key=lambda b: -b[1][:, 1].max())
    for trial in range(60):
        width = math.sqrt(total) * (1.05 + trial * 0.03)
        width = max(width, max(q[:, 0].max() for _, q in boxes))
        pad = width * margin * 2
        x = y = row_h = 0.0
        placed = []
        for loops, q in boxes:
            w_, h_ = q.max(0)
            if x + w_ > width:
                x, y, row_h = 0.0, y + row_h + pad, 0.0
            placed.append((loops, q + (x, y)))
            x += w_ + pad
            row_h = max(row_h, h_)
        height = y + row_h
        if height <= width:
            break
    side = max(width, height)
    for loops, q in placed:
        uv[loops] = (q + pad / 2) / (side + pad)
    uvd.foreach_set("uv", uv.ravel())
    me.update()
    return side


# ---------------------------------------------------------------- more garments (bands, skirts, hats, collars)

def band(fit, pc, onto, y, width, d=0.003, n=24, wfn=None, front_gap=0.0, rows=3, tilt=0.0):
    """A closed band round the body at height y (a belt, an apron's waistband): `rows` rows over `width`, laid on
    the surface `onto` (an Onto) `d` metres out. tilt: how much lower it sits in front (metres). front_gap: an open
    gap in front (metres), or 0 for a closed ring. Returns ids (rows, n)."""
    th = 2 * math.pi * np.arange(n) / n
    if front_gap > 0:
        g = front_gap / 0.3
        th = np.linspace(g / 2, 2 * math.pi - g / 2, n)
    pts = []
    for k in range(rows):
        dy = width * (k / (rows - 1) - 0.5)
        row = []
        for t in th:
            yy = y + dy - tilt * max(0.0, math.cos(t))
            p = np.array((math.sin(t) * 0.4, yy, math.cos(t) * 0.4))
            # from outside in: the nearest point of the surface at this height and angle
            q = onto.snap(p, 0.0)
            for _ in range(3):
                q = onto.snap(np.array((q[0], yy, q[2])), 0.0)
            row.append(q + onto.find(q)[1] * d)
        pts.append(row)
    pts = np.array(pts)
    ids = pc.grid(pts, wfn or onto.weights, closed=front_gap <= 0, seam_col=n // 2)
    pc.orient(lambda q: q - np.array((0.0, q[1], 0.0)))
    return ids


def ring_at(fit, rowsel, ease, n, rows_y=None):
    """A ring of n points round the trunk at cage row r (resampled from its 16 columns by angle), `ease` out."""
    row = fit.row(rowsel)
    P = np.array([fit.rest[i] + fit.N[i] * ease for i in row if i >= 0])
    ang = np.arctan2(P[:, 0], P[:, 2])
    o = np.argsort(ang)
    ang, P = ang[o], P[o]
    ang = np.concatenate([ang - 2 * math.pi, ang, ang + 2 * math.pi])
    P = np.concatenate([P, P, P])
    t = 2 * math.pi * np.arange(n) / n
    t = np.where(t > math.pi, t - 2 * math.pi, t)
    return np.stack([np.interp(t, ang, P[:, k]) for k in range(3)], -1)


def skirt(fit, pc, top_row, hem_y, n=24, ease=0.012, hip_rows=(2, 1), clear=0.035, flare=0.18, folds=8,
          fold_depth=0.020, spring=0.2, waist_y=None, back_legs=0.45):
    """A full skirt, its own tube: the waistband at cage row top_row, close over the hips (hip_rows), then falling
    free and flaring to the hem at hem_y, with `folds` real folds deepening toward the hem. Weighted to the hips,
    the legs by side and height (it sits, it walks) and the four skirt spring bones. Returns ids (rings, n)."""
    rings = [ring_at(fit, top_row, ease, n)]
    if waist_y is not None:
        rings[0][:, 1] = waist_y
    for r in hip_rows:
        rings.append(ring_at(fit, r, ease + 0.006, n))
    loop_ids = []
    for k, R in enumerate(rings):
        ids = [pc.add(p, fit.near_w(p, ("torso",)) if k == 0 else hang_weights(fit, p, spring=spring * 0.3),
                      zone="skirt") for p in R]
        loop_ids.append(ids)
    pc.grid_faces(np.array(loop_ids), closed=True)
    y_top = rings[-1][:, 1].mean()
    nh = 4
    hs = [y_top + (hem_y - y_top) * (k + 1) / nh for k in range(nh)]

    def fold(j, depth):
        a = min(1.0, max(0.0, depth / max(y_top - hem_y, 1e-3)))
        ph = 0.6 * math.sin(j * 1.7)
        return fold_depth * a ** 1.2 * math.cos(2 * math.pi * folds * j / n + ph)
    ids = hang(fit, pc, loop_ids[-1], hs, clear=clear, flare=flare, folds=fold if folds else None,
               wfn=lambda p: hang_weights(fit, p, front_legs=1.0, back_legs=back_legs, spring=spring,
                                          knee_share=1.0, knee_band=(0.04, 0.10)), seam_at=n // 2)
    for i in range(len(loop_ids) - 1):
        pc.seam(loop_ids[i][n // 2], loop_ids[i + 1][n // 2])
    pc.orient(lambda q: q - np.array((0.0, q[1], 0.0)))
    return ids


def kepi(fit, pc, peak, n=16, margin=0.011, height=0.075, slope=0.022, taper=0.010, tilt=0.03):
    """The police kepi: a stiff drum on a band round the head, narrowing a little to its flat top, which slopes
    down to the front; a short black leather peak, near flat. Weighted to the head."""
    P = fit.P
    chin = bd.Y(P, 0.870)
    hs = P["hs"]
    c, top = head_axis(fit)
    phis = 2 * math.pi * np.arange(n) / n
    front = 0.5 + 0.5 * np.cos(phis)
    y0 = chin + hs * (0.118 + tilt * front)
    sup = lambda yy: np.array([head_support(fit, yy[j], phis[j:j + 1])[0] for j in range(n)])
    r0 = sup(y0) + margin
    r1 = np.maximum(sup(y0 + 0.02) + margin, r0)
    rb = np.maximum(r0, r1)
    ytop = np.maximum(top + 0.020, y0 + height) - slope * front  # clear of the hair pieces under it
    rings = [(y0, r0), (y0 + 0.02, rb), (y0 + 0.5 * (ytop - y0), rb - 0.5 * taper),
             (ytop - 0.004, rb - taper), (ytop, rb - taper - 0.006), (ytop + 0.001, (rb - taper) * 0.55)]
    pts = np.array([np.stack([c[0] + r * np.sin(phis), y, c[2] + r * np.cos(phis)], -1) for y, r in rings])
    ids = pc.grid(pts, hat_weights, closed=True, seam_col=n // 2)
    cv = pc.add(pts[-1].mean(0) + np.array((0, 0.0005, 0)), dict(HEAD_ONLY))
    for j in range(n):
        pc.face((ids[-1, j], ids[-1, (j + 1) % n], cv))
    pc.seam(ids[-1, n // 2], cv)
    for j in range(n):
        pc.set_crease(ids[3, j], ids[3, (j + 1) % n], 0.05)  # the top's edge
    pc.orient(lambda q: q - np.array((c[0], q[1] - 0.06, c[2])))
    pa = np.linspace(-1.05, 1.05, 7)
    rows = []
    y_front = y0[0] + 0.004
    for out, dy in ((-0.003, 0.0), (0.024, -0.006), (0.048, -0.014)):
        rr = np.array([head_support(fit, y_front, [a])[0] for a in pa]) + margin + 0.003
        rr = rr + out * np.cos(pa) ** 0.7
        y = y_front + dy * np.cos(pa) ** 0.5 - 0.003 * (1 - np.cos(pa))
        rows.append(np.stack([c[0] + rr * np.sin(pa), y, c[2] + rr * np.cos(pa)], -1))
    pk = peak.grid(np.array(rows), hat_weights)
    peak.orient((0, 1, 0.2))
    return ids, pk


def head_hit(fit, centre, dirs, margin):
    """Points `margin` out from the head and hair along directions from a centre inside the head (rays cast from
    outside in, on the built near copy)."""
    out = []
    for d in dirs:
        d = np.asarray(d) / np.linalg.norm(d)
        o = np.asarray(centre) + d * 0.35
        loc, nrm, _, _ = fit.bvh.ray_cast(tuple(o), tuple(-d), 0.4)
        p = np.array(loc) if loc is not None else np.asarray(centre) + d * 0.1
        out.append(p + d * margin)
    return np.array(out)


def hood_cap(fit, pc, frill=None, margin=0.006, front=-18.0, back=112.0, side=112.0, cols=13, rows=8):
    """A close white linen cap (the women's everyday cap): it covers the crown, the back of the head and the ears,
    its front edge running over the head from ear to ear behind the hairline; with `frill` a goffered frill
    standing round that edge. Built on arcs from ear to ear over the head, tipped from the front edge (`front`
    degrees, forward of straight up) to the nape (`back`); weighted to the head."""
    c, top = head_axis(fit)
    P = fit.P
    chin = bd.Y(P, 0.870)
    centre = np.array((0.0, chin + P["hs"] * 0.115, c[2] - 0.004))
    us = np.radians(np.linspace(-side, side, cols))
    vs = np.radians(np.linspace(front, back, rows))
    grid = []
    for v in vs:
        dirs = []
        for u in us:
            # the arc from ear to ear over the top, tipped back about the left-right axis by v
            dirs.append(np.array((math.sin(u), math.cos(u) * math.cos(v), -math.cos(u) * math.sin(v))))
        grid.append(head_hit(fit, centre, dirs, margin))
    pts = np.array(grid)
    ids = pc.grid(pts, hat_weights, closed=False, seam_col=None)
    pc.orient(lambda q: q - centre)
    if frill is not None:
        edge = pts[0]
        n_ = len(edge)
        fr = []
        for k, (o, h) in enumerate(((0.0, 0.0), (0.009, 0.003), (0.017, 0.006))):
            row = []
            for j in range(n_):
                p = edge[j]
                d = p - centre
                d /= np.linalg.norm(d)
                fwd = np.array((0.0, 0.1, 1.0))
                fwd /= np.linalg.norm(fwd)
                ripple = 0.004 * math.sin(j * 2.3) * (k / 2)
                row.append(p + d * (0.8 * o + h + ripple) + fwd * 0.35 * o)
            fr.append(row)
        frill.grid(np.array(fr), hat_weights)
        frill.orient(lambda q: q - centre + np.array((0, 0, 0.05)))
    return ids


def collar(fit, pc, lo, hi, ease_lo, ease_hi, rows=3, front_gap=0.0, fold=None):
    """A band round the neck from height fraction lo to hi of the neck (0 at the cage's ring n0, 1 at n1; below 0
    runs toward the shoulders' top row), `ease` out (a shirt collar, a stand collar). front_gap: an opening in
    front (metres). fold: (out, down) to turn the top edge over (a turn-down collar). Returns ids."""
    n0, n1 = neck_rings(fit)
    r9 = fit.row(9)
    rws = []
    for k in range(rows):
        t = lo + (hi - lo) * k / (rows - 1)
        e = ease_lo + (ease_hi - ease_lo) * k / (rows - 1)
        pts = []
        for a, b, c_ in zip(r9, n0, n1):
            if t >= 0:
                p = fit.rest[b] * (1 - t) + fit.rest[c_] * t
                n_ = norm(fit.N[b] * (1 - t) + fit.N[c_] * t)
            else:
                p = fit.rest[b] * (1 + t) + fit.rest[a] * (-t)
                n_ = norm(fit.N[b] * (1 + t) + fit.N[a] * (-t))
            pts.append(p + n_ * e)
        rws.append(pts)
    if fold is not None:
        out, down = fold
        last = np.array(rws[-1])
        c = last.mean(0)
        d = last - c
        d[:, 1] = 0
        d = norm(d)
        rws.append(last + d * out * 0.5 + np.array((0, 0.004, 0)))
        rws.append(last + d * out + np.array((0, -down, 0)))
    pts = np.array(rws)
    if front_gap > 0:
        # open in front: drop column 0 and split there
        order = list(range(1, 16)) + [0]
        pts = pts[:, order]
        pts[:, 0, 0] = np.maximum(pts[:, 0, 0], front_gap / 2)
        pts[:, -1, 0] = -front_gap / 2
    ids = pc.grid(pts, lambda p: fit.near_w(p, ("neck", "torso")), closed=front_gap <= 0,
                  seam_col=8 if front_gap <= 0 else None)
    pc.orient(lambda q: q - np.array((0.0, q[1], -0.01)))
    return ids


def shoe(fit, pc, sole, side, women=False, shaft=0.130, toe_len=1.0):
    """An ankle boot round one foot, made on its own last (not the body's foot): a rounded heel and a shaft round the
    ankle (under the trousers or the skirt), the instep falling to a rounded toe box; and its sole (the piece
    `sole`): a slab 3 mm proud of the upper all round, a built-up heel behind. Weighted to the foot, the toe bone
    under the toes (it bends at the ball as the foot does) and the shin at the shaft's top."""
    P = fit.P
    s = P["w"] * P["f"]["foot"] * (0.92 if women else 1.0)
    sg = 1 if side == "L" else -1
    cx = sg * (fit.hip_x - 0.002)
    up = [(-0.066, 0.024, 0.006, shaft - 0.012, 0.0), (-0.056, 0.033, 0.002, shaft, 0.0),
          (-0.030, 0.036, 0.002, shaft + 0.002, 0.0), (0.002, 0.037, 0.002, shaft - 0.004, 0.0),
          (0.036, 0.040, 0.002, 0.098, -0.002), (0.080, 0.046, 0.002, 0.071, -0.004),
          (0.130, 0.049, 0.002, 0.056, -0.006), (0.178, 0.045, 0.004, 0.047, -0.006),
          (0.214, 0.034, 0.008, 0.041, -0.005), (0.236, 0.018, 0.013, 0.035, -0.004)]
    st = [(z * s * (toe_len if z > 0.1 else 1.0), hw * s, yb, yt, sg * xs * s / 0.06 * 0.06) for z, hw, yb, yt, xs in up]

    def w(p):
        t = float(sm(0.10 * s, 0.17 * s, p[2])) * 0.75
        a = float(sm(0.085, shaft, p[1])) * 0.7 * float(sm(0.05 * s, 0.0, p[2]))
        return wnorm({"foot" + side: (1 - t) * (1 - a), "toe" + side: t * (1 - a), "legLow" + side: a})
    loft_z(pc, st, 10, w, cx=cx, power=2.4, power_bottom=6.0)
    pc.orient(lambda c: np.array((c[0] - cx, c[1] - 0.05, c[2] - 0.08 * s)))
    heel = 0.022 if not women else 0.030
    so = [(z, hw + 0.003, -0.0005, (heel if z < -0.02 * s else 0.012 if z < 0.02 * s else 0.011), xs)
          for z, hw, yb, yt, xs in st]
    so[-1] = (so[-1][0] + 0.002, so[-1][1], 0.004, 0.016, so[-1][4])
    so[0] = (so[0][0] - 0.002, so[0][1] + 0.002, -0.0005, heel, so[0][4])
    nf = len(sole.F)
    so = [so[k] for k in (0, 1, 2, 4, 6, 7, 8, 9)]
    loft_z(sole, so, 8, w, cx=cx, power=8.0, power_bottom=8.0, crease_cols=(1, 3, 5, 7), crease=0.06)
    sole.orient(lambda c: np.array((c[0] - cx, c[1] - 0.006, c[2] - 0.08 * s)), start=nf)
