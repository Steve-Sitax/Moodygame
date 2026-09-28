"""Goods on the working quays (Steve 2026-09-25: "make the kaaien with better graphics and more
detail, more props. High quality is needed").

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_quaygoods.py [-- --preview]

Writes client/public/models/quaygoods.glb (Draco). One node per model, real scale in metres, built
with the helpers of build_streetlife.py (Blender Z up; the export turns it Y up; a thing's front
looks toward -Y, which is +Z in the game). Placed by client/src/world/quaygoods.ts in composed
heaps ("vignettes"), merged per chunk: two draw calls (solid, decal) per chunk in view.

  crates     framed crates (corner posts and rails 6 cm, iron-strapped ends, stencilled marks:
             ANTWERPEN, LIVERPOOL, H&V No 23, RIO), a long one, a small one, an open one with straw
             and its lid leaning on it, a tied stack of three
  casks      oak casks with four iron hoops and sunk heads, a blue painted petroleum cask, a keg,
             a cask lying on chocks, a pyramid of six, a standing group
  sacks      jute sacks (coffee, grain) lying, one slumped standing, a loose heap, a pallet of
             them in layers
  bales      cotton bales in iron bands, a stack of five
  tarps      two heaps under tarred tarpaulins, roped down to stones
  rope       a hawser coil, a loose rope end, a cable drum on chocks, a rope walk (trestles and
             three strands, the spinning jack at its head)
  wicker     baskets with handles, a stack of them, a hamper
  carts      a handcart resting on its shafts (empty, loaded), a sack truck with a sack
  timber     planks stacked on sticks, squared baulks on sleepers
  scale      a decimal weighing scale with its weights and a sack on it
  ground     decals: straw, spilt grain, an oil stain, trodden dirt

Faces: nothing lies in the ground plane (no bottoms on the stones), nothing rests on anything with
its face in the other's face (resting parts have no bottom), and the frames of the crates stand
6 cm proud of their boards with the boards cut back under them (the z-fight check, dev/zfight.ts).
The solid material is drawn front side only, so faces are wound outward; the few faces seen from
inside (an open crate, a basket, the sunk heads) are built facing in.

Materials: qg_solid (one painted atlas), qg_decal (ground decals, RGBA). Vertex colour "Col" carries
a baked shade (darker low down). All textures are painted by the functions below; the letters come
from the 5x7 font of build_streetlife.py. Our own work: nothing downloaded.
"""

import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector
import json

sys.path.insert(0, os.path.dirname(__file__))
import build_streetlife as sl  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "quaygoods.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

sl.SOLID_ATLAS = sl.Atlas(1024)
sl.DECAL_ATLAS = sl.Atlas(256)
sl.MAT_NAMES = ["qg_solid", "qg_decal", "qg_puddle", "qg_glow"]
SOLID, DECAL = sl.SOLID, sl.DECAL
Mesh = sl.Mesh
move = sl.move
rot = sl.rot
vnoise = sl.vnoise


class PMesh(sl.Mesh):
    """M8f goods pass 2: a heap whose casks, crates and sacks are each liftable goods of the server. Built as one
    mesh as before (the same faces, the same baked shade), every face tagged with the piece it belongs to; the
    export (main) writes each piece as its own node in its own frame ("<name>.<k>", extras qg_of, qg_k, qg_frame,
    qg_goods, qg_heavy) and what is not goods (chocks, a pallet) as "<name>.rest". The client puts the heap back
    together from them (world/quaygoods.ts), so it stands exactly where and as it stood."""

    def __init__(self, ao=0.0):
        super().__init__(ao)
        self.piece_layer = self.bm.faces.layers.int.new("piece")
        self.cur = -1
        self.pieces = []  # (goods kind, frame Matrix in the model's frame, heavy)

    def face(self, pts, cell, uvs=None, mat=SOLID, shade=1.0, out=None):
        f = super().face(pts, cell, uvs=uvs, mat=mat, shade=shade, out=out)
        if f is not None:
            f[self.piece_layer] = self.cur
        return f

    def piece(self, kind, M=None, heavy=False):
        """Faces made inside belong to a new piece; its frame is the current transform times M (its foot, its
        turn about Z): the piece is written in that frame."""
        m = self

        class Ctx:
            def __enter__(self_):
                self_.old = m.cur
                m.pieces.append((kind, m.xf @ (M if M is not None else Matrix.Identity(4)), heavy))
                m.cur = len(m.pieces) - 1
                return m.cur

            def __exit__(self_, *a):
                m.cur = self_.old

        return Ctx()

    def into(self, k):
        """Faces made inside go to piece k (-1: the rest, not goods)."""
        m = self

        class Ctx:
            def __enter__(self_):
                self_.old = m.cur
                m.cur = k

            def __exit__(self_, *a):
                m.cur = self_.old

        return Ctx()


def rest_of(m):
    """Chocks and pallets: the rest of a heap, not goods (a no-op for a plain Mesh)."""
    return m.into(-1) if isinstance(m, PMesh) else sl.Mesh.at(m, Matrix.Identity(4))


def as_piece(m, kind, M=None, heavy=False):
    """A new piece of a PMesh (a no-op context for a plain Mesh)."""
    return m.piece(kind, M, heavy) if isinstance(m, PMesh) else sl.Mesh.at(m, Matrix.Identity(4))


def split_pieces(name, pm):
    """Objects for a PMesh: one per piece in its own frame, and the rest. Returns [(object name, object)]."""
    import bmesh
    out = []
    layer = pm.piece_layer
    groups = list(range(len(pm.pieces))) + [-1]
    for k in groups:
        bm2 = pm.bm.copy()
        lay2 = bm2.faces.layers.int.get("piece")
        kill = [f for f in bm2.faces if f[lay2] != k]
        bmesh.ops.delete(bm2, geom=kill, context="FACES")
        loose = [v for v in bm2.verts if not v.link_faces]
        if loose:
            bmesh.ops.delete(bm2, geom=loose, context="VERTS")
        if not bm2.faces:
            bm2.free()
            continue
        if k >= 0:
            kind, F, heavy = pm.pieces[k]
            bmesh.ops.transform(bm2, matrix=F.inverted(), verts=bm2.verts)
        bm2.faces.layers.int.remove(lay2)
        sub = sl.Mesh()
        sub.bm.free()
        sub.bm = bm2
        oname = f"{name}.{k}" if k >= 0 else f"{name}.rest"
        ob = sub.to_object(oname)
        ob["qg_of"] = name
        ob["qg_k"] = k
        if k >= 0:
            t = F.to_translation()
            yaw = math.atan2(F[1][0], F[0][0])
            # Blender Z up -> the game's Y up (the export's +Y up: game x = x, y = z, z = -y); a turn about Z is the
            # same turn about the game's Y
            ob["qg_frame"] = [round(t.x, 5), round(t.z, 5), round(-t.y, 5), round(yaw, 6)]
            ob["qg_goods"] = kind
            ob["qg_heavy"] = 1 if heavy else 0
        out.append((oname, ob))
    pm.bm.free()
    return out

# ------------------------------------------------------------------ painting

INK = (0.07, 0.06, 0.05)
INK_BLUE = (0.10, 0.13, 0.22)
INK_RED = (0.36, 0.10, 0.07)


def rng_(seed):
    return np.random.default_rng(seed)


def base(seed, w, h, rgb, amt=0.16, cells=4):
    return sl.flat(seed, w, h, rgb, amt, cells)


def boards(seed, w, h, rgb, n, vertical=False, gap=0.32, nails=True, weather=0.0, dirt=0.25):
    """n boards across the cell (horizontal: stacked in v), grain along them, dark joints, nails,
    each board its own tone; grey weathering and dirt low down."""
    rng = rng_(seed)
    W, H = (h, w) if vertical else (w, h)
    grain = vnoise(rng, W, H, 3, max(2, H // 2)) * 0.55 + vnoise(rng, W, H, 9, H) * 0.45
    img = np.ones((H, W, 4))
    img[..., :3] = np.array(rgb) * (0.78 + 0.36 * grain)[..., None]
    edges = np.linspace(0, H, n + 1).round().astype(int)
    for k in range(n):
        a, b = edges[k], edges[k + 1]
        img[a:b, :, :3] *= rng.uniform(0.84, 1.14)
        # knots
        for _ in range(int(rng.integers(0, 2))):
            kx, ky = int(rng.integers(3, W - 3)), int(rng.integers(a, max(a + 1, b - 1)))
            img[max(0, ky - 1):ky + 1, kx - 1:kx + 2, :3] *= 0.6
        if k > 0:
            img[a, :, :3] *= gap
            if a + 1 < H:
                img[a + 1, :, :3] *= 0.8
        if nails and b - a >= 3:
            for nx in (2, W - 3):
                ny = (a + b) // 2
                img[ny, nx, :3] = (0.10, 0.09, 0.09)
    if weather > 0:
        n2 = vnoise(rng, W, H, 5, 5)
        grey = img[..., :3].mean(axis=2, keepdims=True)
        t = np.clip((n2 - 0.3) * weather * 2, 0, 1)[..., None]
        img[..., :3] = img[..., :3] * (1 - t) + grey * 1.08 * t
    if dirt > 0:
        k = max(2, H // 5)
        img[H - k:, :, :3] *= np.linspace(1.0, 1 - dirt, k)[:, None, None]
    if vertical:
        img = img.transpose(1, 0, 2).copy()
    return img


def stencil(img, text, cx, cy, ink=INK, scale=1, alpha=0.82, seed=0, drop=0.12):
    """Stencilled letters centred at (cx, cy) pixels: ink soaked into the boards, a few gaps."""
    rng = rng_(seed)
    tw = sl.text_width(text) * scale
    th = 7 * scale
    mask = np.zeros(img.shape[:2] + (4,))
    sl.draw_text(mask, text, int(cx - tw / 2), int(cy - th / 2), (1, 1, 1, 1), scale)
    m = mask[..., 0] > 0.5
    keep = rng.random(m.shape) > drop
    a = (m & keep).astype(float) * alpha * rng.uniform(0.75, 1.0, m.shape)
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + np.array(ink) * a[..., None]


def diamond(img, cx, cy, r, ink=INK, alpha=0.8):
    h, w = img.shape[:2]
    for y in range(h):
        for x in range(w):
            d = abs(x - cx) + abs(y - cy)
            if r - 1 <= d <= r:
                img[y, x, :3] = img[y, x, :3] * (1 - alpha) + np.array(ink) * alpha


def ring(img, cx, cy, r, ink=INK, alpha=0.8, width=1.2):
    h, w = img.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot(xx - cx, yy - cy)
    a = ((d > r - width) & (d < r + 0.2)).astype(float) * alpha
    img[..., :3] = img[..., :3] * (1 - a[..., None]) + np.array(ink) * a[..., None]


def crate_side(seed, w, h, rgb, marks):
    img = boards(seed, w, h, rgb, max(2, h // 12), weather=0.35)
    for mk in marks:
        kind = mk[0]
        if kind == "text":
            _, t, cx, cy, sc, ink = mk
            stencil(img, t, cx * w, cy * h, ink, sc, seed=seed + len(t))
        elif kind == "diamond":
            _, cx, cy, r, ink = mk
            diamond(img, cx * w, cy * h, r, ink)
        elif kind == "ring":
            _, cx, cy, r, ink = mk
            ring(img, cx * w, cy * h, r, ink)
    return img


def bar(seed, w, h, rgb, along_u=True, strap=0.12):
    """A frame rail: grain along it, iron strap plates with rivets at both ends."""
    rng = rng_(seed)
    img = boards(seed, w, h, rgb, 1, vertical=not along_u, nails=False, weather=0.3, dirt=0.0)
    L = w if along_u else h
    k = max(2, int(L * strap))
    iron = np.array((0.10, 0.09, 0.08))
    if not along_u:
        # rust runs from the corner caps down the post
        for x in range(w):
            if rng.random() < 0.5:
                L2 = int(rng.integers(k, min(h, k * 4) + 1))
                img[k:L2, x, :3] = img[k:L2, x, :3] * 0.55 + RUST * 0.45
    for sl_ in (slice(0, k), slice(L - k, L)):
        if along_u:
            seg = img[:, sl_, :3]
        else:
            seg = img[sl_, :, :3]
        n = rng.uniform(0.8, 1.2, seg.shape[:2])[..., None]
        seg[...] = iron * n
        rust = rng.random(seg.shape[:2]) < 0.55
        seg[rust] = RUST * rng.uniform(0.75, 1.1, (rust.sum(), 1))
    # rivets
    if along_u:
        for x in (k // 2, L - 1 - k // 2):
            img[h // 2, x, :3] = (0.32, 0.30, 0.28)
    else:
        for y in (k // 2, L - 1 - k // 2):
            img[y, w // 2, :3] = (0.32, 0.30, 0.28)
    return img


def staves(seed, w, h, rgb, n=16, paint=None):
    """Barrel staves: n boards round the cask (u), grain along v; paint worn through at the bilge."""
    rng = rng_(seed)
    img = boards(seed, w, h, rgb, n, vertical=True, gap=0.45, nails=False, weather=0.15, dirt=0.0)
    if paint is not None:
        n2 = vnoise(rng, w, h, 6, 6)
        worn = n2 > 0.72
        p = np.array(paint) * (0.85 + 0.3 * vnoise(rng, w, h, 3, 8))[..., None]
        img[..., :3] = np.where(worn[..., None], img[..., :3], p)
        for x in np.linspace(0, w, n + 1).round().astype(int)[1:-1]:
            img[:, x, :3] *= 0.55
    # tide-mark and grime toward both ends
    v = np.abs(np.linspace(-1, 1, h))
    img[..., :3] *= (1.0 - 0.18 * v ** 3)[:, None, None]
    return img


def chalk(img, seed, marks=("12", "X", "7")):
    """Chalk tallies and numbers scrawled on the staves by the tally clerk."""
    rng = rng_(seed)
    h, w = img.shape[:2]
    for t in marks:
        cx, cy = rng.uniform(0.15, 0.85) * w, rng.uniform(0.3, 0.7) * h
        stencil(img, t, cx, cy, (0.70, 0.68, 0.62), 1, alpha=0.45, seed=seed + len(t), drop=0.35)
    # smeared by hands and rain: each row dragged a pixel or two sideways
    sm = img.copy()
    for dx in (1, 2):
        sm[:, dx:, :3] = sm[:, dx:, :3] * 0.6 + img[:, :-dx, :3] * 0.4
    return sm


def strap_iron(seed, w, h):
    img = iron(seed, w, h, (0.10, 0.09, 0.08), 0.55)
    for y in range(2, h, 5):
        for x in range(2, w, 5):
            img[y, x, :3] = (0.30, 0.28, 0.26)
    return img


def head(seed, w, h, rgb, brand=None, ink=INK):
    """A cask head: three boards across, a burnt brand, a bung."""
    img = boards(seed, w, h, rgb, 3, gap=0.4, nails=False, weather=0.2, dirt=0.0)
    yy, xx = np.mgrid[0:h, 0:w]
    d = np.hypot((xx - w / 2 + 0.5) / (w / 2), (yy - h / 2 + 0.5) / (h / 2))
    img[d > 0.9, :3] *= 0.7
    if brand:
        stencil(img, brand, w / 2, h / 2 - 2, ink, 1, alpha=0.7, seed=seed)
        ring(img, w / 2, h / 2 - 1, w * 0.36, ink, 0.55)
    img[int(h * 0.78), int(w * 0.5), :3] = (0.12, 0.10, 0.08)
    img[int(h * 0.78), int(w * 0.5) + 1, :3] = (0.12, 0.10, 0.08)
    return img


def cargo_head(seed, rgb, owner, cargo, lot, ink=INK):
    """Worn shipping marks on the actual wood, shared atlas (no floating labels/materials).

    Art reference: assets/concepts/quay-props.png. Owner, contents and lot are distinct lines;
    the blue petroleum and wine variants carry only the cargo they are modeled for.
    """
    img = head(seed, 64, 64, rgb)
    for text, cy in ((owner, 19), (cargo, 32), (lot, 45)):
        stencil(img, text, 32, cy, ink, 1, alpha=0.86, seed=seed + cy, drop=0.08)
    return img


def jute(seed, w, h, rgb, text=None, ink=INK, star=False, coarse=1):
    """Jute weave (over-under threads), a seam down one side, a stencilled mark on the top."""
    rng = rng_(seed)
    img = base(seed, w, h, rgb, 0.14, 5)
    # (flat() darkens a few single pixels at random: on cloth they read as holes; smooth them back)
    img[..., :3] = np.maximum(img[..., :3], np.array(rgb)[None, None, :] * 0.84)
    yy, xx = np.mgrid[0:h, 0:w]
    weave = ((xx // coarse + yy // coarse) % 2).astype(float)
    img[..., :3] *= (0.9 + 0.12 * weave)[..., None]
    img[..., :3] *= (0.94 + 0.1 * rng.random((h, w)))[..., None]
    # slubs: thicker threads
    for _ in range(w // 3):
        y = int(rng.integers(0, h))
        x0 = int(rng.integers(0, w))
        img[y, x0:x0 + int(rng.integers(3, 9)), :3] *= 1.12
    # seam at u = 0 / 1 (under the sack) and grime low on it
    img[:, :2, :3] *= 0.7
    img[:, -2:, :3] *= 0.7
    n2 = vnoise(rng, w, h, 4, 4)
    img[..., :3] *= (0.86 + 0.18 * n2)[..., None]
    if text or star:
        # the mark runs along the sack (v, the rows) on its top (u 0.5): paint it across a turned
        # copy and turn it back
        t = img.transpose(1, 0, 2).copy()
        th, tw = t.shape[:2]
        if text:
            stencil(t, text, tw * 0.5 + (4 if star else 0), th * 0.5, ink, 1, alpha=0.78, seed=seed + 3, drop=0.15)
        if star:
            cx, cy = tw * 0.5 - sl.text_width(text or "") / 2 - 4, th * 0.5
            for dx, dy in ((0, 0), (1, 0), (-1, 0), (0, 1), (0, -1), (2, 0), (-2, 0), (0, 2), (0, -2)):
                t[int(cy + dy), int(cx + dx), :3] = ink
        img = t.transpose(1, 0, 2).copy()
    return img


def burlap_bale(seed, w, h):
    """A cotton bale: coarse grey burlap, cotton bursting at the seams, a shipper's mark."""
    rng = rng_(seed)
    img = jute(seed, w, h, (0.60, 0.50, 0.35), coarse=1)
    # the ends: cotton pressed out between the canvas flaps, a sewn seam across
    k = max(3, h // 7)
    for band in (slice(0, k), slice(h - k, h)):
        seg = img[band, :, :3]
        c = np.array((0.62, 0.59, 0.53)) * (0.85 + 0.2 * vnoise(rng, w, k, 8, 2))[..., None]
        mix = smooth01((vnoise(rng, w, k, 6, 2) - 0.35) * 2.5)[..., None]
        seg[...] = seg * (1 - mix) + c * mix
    for x in range(0, w, 3):
        img[k, x, :3] *= 0.6
        img[h - k - 1, x, :3] *= 0.6
    # the shipper's mark on the top, along the bale
    t = img.transpose(1, 0, 2).copy()
    stencil(t, "N.O", t.shape[1] * 0.5, t.shape[0] * 0.5, INK_BLUE, 1, alpha=0.7, seed=seed)
    diamond(t, t.shape[1] * 0.5, t.shape[0] * 0.5, 9, INK_BLUE, 0.6)
    return t.transpose(1, 0, 2).copy()


def tarp(seed, w, h, rgb):
    """Tarred canvas: folds and creases, a patch sewn on, dirt and pale wear on the ridges."""
    rng = rng_(seed)
    img = base(seed, w, h, rgb, 0.2, 6)
    folds = vnoise(rng, w, h, 3, 14) * 0.6 + vnoise(rng, w, h, 14, 3) * 0.4
    img[..., :3] *= (0.72 + 0.5 * folds)[..., None]
    for _ in range(3):
        x0, y0 = int(rng.integers(4, w - 24)), int(rng.integers(4, h - 20))
        pw, ph = int(rng.integers(10, 22)), int(rng.integers(8, 16))
        img[y0:y0 + ph, x0:x0 + pw, :3] *= rng.uniform(1.15, 1.35)
        img[y0, x0:x0 + pw, :3] *= 0.6
        img[y0 + ph - 1, x0:x0 + pw, :3] *= 0.6
        img[y0:y0 + ph, x0, :3] *= 0.6
        img[y0:y0 + ph, x0 + pw - 1, :3] *= 0.6
    # hem round the edge, grommets
    img[:2, :, :3] *= 0.65
    img[-2:, :, :3] *= 0.65
    img[:, :2, :3] *= 0.65
    img[:, -2:, :3] *= 0.65
    for x in range(6, w - 4, 16):
        img[3, x, :3] = (0.5, 0.45, 0.3)
        img[h - 4, x, :3] = (0.5, 0.45, 0.3)
    return img


def rope_tex(seed, w, h, rgb):
    """Laid rope: diagonal strands."""
    rng = rng_(seed)
    img = base(seed, w, h, rgb, 0.1, 3)
    yy, xx = np.mgrid[0:h, 0:w]
    s = ((xx * 2 + yy) % 6 < 2).astype(float)
    img[..., :3] *= (1.08 - 0.32 * s)[..., None]
    img[..., :3] *= (0.92 + 0.12 * rng.random((h, w)))[..., None]
    return img


def coil_tex(seed, w, h, rgb):
    """A hawser coil seen round and over: turns as ridges along v, strands across them."""
    rng = rng_(seed)
    img = base(seed, w, h, rgb, 0.1, 3)
    yy, xx = np.mgrid[0:h, 0:w]
    turn = np.sin(yy / h * math.pi * 2 * 7) * 0.5 + 0.5
    strand = ((xx + yy * 2) % 5 < 2).astype(float)
    img[..., :3] *= (0.62 + 0.45 * turn - 0.12 * strand)[..., None]
    img[..., :3] *= (0.92 + 0.12 * rng.random((h, w)))[..., None]
    return img


def wicker(seed, w, h, rgb):
    rng = rng_(seed)
    img = base(seed, w, h, rgb, 0.12, 3)
    yy, xx = np.mgrid[0:h, 0:w]
    over = (((xx // 3) + (yy // 2)) % 2).astype(float)
    img[..., :3] *= (0.78 + 0.3 * over)[..., None]
    img[yy % 2 == 0] *= 0.92
    for x in range(0, w, 6):
        img[:, x, :3] *= 0.65  # the stakes
    img[..., :3] *= (0.9 + 0.15 * rng.random((h, w)))[..., None]
    return img


def straw_solid(seed, w, h):
    rng = rng_(seed)
    img = base(seed, w, h, (0.70, 0.58, 0.30), 0.2, 4)
    for _ in range(w * h // 5):
        x, y = int(rng.integers(0, w)), int(rng.integers(0, h))
        L = int(rng.integers(2, 6))
        c = np.array(rng.choice([(0.86, 0.74, 0.40), (0.56, 0.44, 0.22), (0.78, 0.66, 0.36)]))
        if rng.random() < 0.5:
            img[y, x:x + L, :3] = c
        else:
            img[y:y + L, x, :3] = c
    return img


def end_grain(seed, w, h, rgb):
    img = base(seed, w, h, rgb, 0.1, 3)
    yy, xx = np.mgrid[0:h, 0:w]
    rng = rng_(seed)
    cx, cy = w * rng.uniform(0.3, 0.7), h * rng.uniform(0.2, 0.6)
    d = np.hypot(xx - cx, (yy - cy) * 1.2)
    img[..., :3] *= (0.85 + 0.2 * (np.sin(d * 1.6) * 0.5 + 0.5))[..., None]
    img[:1, :, :3] *= 0.7
    img[-1:, :, :3] *= 0.7
    img[:, :1, :3] *= 0.7
    img[:, -1:, :3] *= 0.7
    return img


def timber(seed, w, h, rgb):
    """A squared baulk: adze marks across the grain, bark left on the arrises (both long edges)."""
    rng = rng_(seed)
    img = boards(seed, w, h, rgb, 1, nails=False, weather=0.4, dirt=0.15)
    for x in range(0, w, 4):
        img[:, x, :3] *= rng.uniform(0.8, 0.95)
    k = max(1, h // 8)
    bark = np.array((0.22, 0.17, 0.12))
    for band in (slice(0, k), slice(h - k, h)):
        img[band, :, :3] = bark * rng.uniform(0.7, 1.2, img[band, :, :3].shape[:2])[..., None]
    return img


RUST = np.array((0.21, 0.11, 0.055))  # (a dark brown: nothing bright in the fog)


def iron(seed, w, h, rgb=(0.10, 0.09, 0.08), rust=0.5):
    """Wrought or cast iron after years on the quay: black gone brown, rust in scabs and runs (pass 3)."""
    rng = rng_(seed)
    img = base(seed, w, h, rgb, 0.25, 4)
    n = vnoise(rng, w, h, 4, 4) * 0.6 + vnoise(rng, w, h, 12, 12) * 0.4
    scab = n > 1 - rust
    img[scab, :3] = RUST * rng.uniform(0.7, 1.25, (scab.sum(), 1))
    speck = rng.random((h, w)) < rust * 0.4
    img[speck, :3] = RUST * rng.uniform(0.8, 1.2, (speck.sum(), 1))
    for _ in range(max(1, w // 4)):
        c = int(rng.integers(0, w))
        L = int(rng.integers(max(1, h // 3), h + 1))
        img[:L, c, :3] = img[:L, c, :3] * 0.4 + RUST * 0.6
    return img


def painted_wood(seed, w, h, rgb, wood=(0.36, 0.30, 0.22)):
    rng = rng_(seed)
    img = boards(seed, w, h, wood, 1, nails=False, weather=0.2, dirt=0.1)
    n2 = vnoise(rng, w, h, 5, 5)
    p = np.array(rgb) * (0.85 + 0.3 * vnoise(rng, w, h, 3, 3))[..., None]
    keep = n2 < 0.66
    img[..., :3] = np.where(keep[..., None], p, img[..., :3])
    return img


def scale_plate(seed, w, h):
    img = iron(seed, w, h, (0.16, 0.16, 0.15), 0.08)
    for y in range(0, h, 4):
        for x in range(0, w, 4):
            if (x // 4 + y // 4) % 2 == 0:
                img[y:y + 2, x:x + 2, :3] *= 1.35
    return img


def brass(seed, w, h):
    img = base(seed, w, h, (0.56, 0.44, 0.20), 0.2, 3)
    for x in range(2, w, 4):
        img[:, x, :3] *= 0.6  # the notches of the beam
    return img


# decals (RGBA)


def fish_cell(seed, w, h):
    """Herring and whiting packed head to tail in a fish crate: grey-silver bodies on dark, a red gill."""
    rng = rng_(seed)
    img = np.ones((h, w, 4))
    img[..., :3] = (0.06, 0.06, 0.05)
    for row in range(0, h - 4, 5):
        x = -int(rng.integers(0, 6))
        while x < w:
            L = int(rng.integers(8, 13))
            c = np.array((0.46, 0.48, 0.47)) * rng.uniform(0.7, 1.05)
            img[row + 1:row + 4, max(0, x):max(0, min(w, x + L)), :3] = c
            img[row + 1, max(0, x):max(0, min(w, x + L)), :3] = c * 0.7
            if 0 <= x + 1 < w:
                img[row + 2, x + 1, :3] = (0.34, 0.08, 0.06)
            x += L + 1
    return grime(img, seed, fade=0.1, dark=0.85, wet=0.2, mould=0.1, mud=0.0)


def muck_decal(seed, w, h):
    """A puddle of muck: black-green water with brown sludge round it."""
    rng = rng_(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    n = vnoise(rng, w, h, 5, 5)
    d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2)) + (n - 0.5) * 0.8
    img = np.zeros((h, w, 4))
    img[..., :3] = np.where((d < 0.55)[..., None], np.array((0.04, 0.05, 0.04)), np.array((0.14, 0.11, 0.07)))
    img[..., 3] = np.clip((0.95 - d) * 2.2, 0, 0.9)
    return img


def rotten_straw(seed, w, h):
    img = straw_decal(seed, w, h, 1.3)
    img[..., :3] = img[..., :3].mean(axis=2, keepdims=True) * np.array((0.8, 0.72, 0.55))
    return img


def straw_decal(seed, w, h, amount=1.0):
    """Loose straw and rope ends trodden into the setts: stalks, a few dark bits, soft edges."""
    rng = rng_(seed)
    img = np.zeros((h, w, 4))
    cols = [(0.50, 0.43, 0.25), (0.42, 0.34, 0.19), (0.55, 0.48, 0.30), (0.32, 0.26, 0.15)]
    n = int(w * h * 0.07 * amount)
    for _ in range(n):
        x, y = rng.normal(w / 2, w / 4.5), rng.normal(h / 2, h / 4.5)
        if not (1 < x < w - 2 and 1 < y < h - 2):
            continue
        ang = rng.uniform(0, math.pi)
        L = rng.uniform(2, 7)
        c = np.array(cols[int(rng.integers(len(cols)))]) * rng.uniform(0.8, 1.1)
        for t in np.linspace(0, L, int(L * 1.5) + 1):
            xx, yy = int(x + math.cos(ang) * t), int(y + math.sin(ang) * t)
            if 0 <= xx < w and 0 <= yy < h:
                img[yy, xx, :3] = c
                img[yy, xx, 3] = 0.95
    # a rope end in it
    x, y = w * 0.3, h * 0.6
    for t in range(int(w * 0.35)):
        xx, yy = int(x + t), int(y + math.sin(t * 0.3) * 2)
        if 0 <= xx < w and 0 <= yy < h:
            img[yy, xx, :3] = (0.46, 0.38, 0.26)
            img[yy, xx, 3] = 1
    return img


def spill_decal(seed, w, h, rgb, grain=True):
    rng = rng_(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    n = vnoise(rng, w, h, 5, 5)
    d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2)) + (n - 0.5) * 0.8
    img = np.zeros((h, w, 4))
    img[..., :3] = rgb
    a = np.clip((0.85 - d) * 2.5, 0, 1)
    if grain:
        a *= (rng.random((h, w)) < 0.35 + 0.6 * a)
        img[..., :3] *= rng.uniform(0.75, 1.15, (h, w, 1))
    img[..., 3] = a * 0.95
    return img


def stain_decal(seed, w, h, rgb=(0.05, 0.05, 0.04), alpha=0.55):
    rng = rng_(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    n = vnoise(rng, w, h, 4, 4)
    d = np.hypot((xx - w / 2) / (w / 2), (yy - h / 2) / (h / 2)) + (n - 0.5) * 0.7
    img = np.zeros((h, w, 4))
    img[..., :3] = rgb
    img[..., 3] = np.clip((0.95 - d) * 2.0, 0, alpha)
    return img


# crate kinds: size (W, D, H), wood, marks on the long sides (front -Y, back +Y)
CRATES = {
    "a": dict(size=(1.0, 0.7, 0.62), wood=(0.46, 0.38, 0.27),
              front=[("text", "ANTWERPEN", 0.5, 0.42, 1, INK), ("text", "NO 17", 0.5, 0.7, 1, INK)],
              back=[("text", "H&V", 0.5, 0.25, 1, INK), ("text", "GLASS", 0.5, 0.50, 1, INK), ("text", "FRAGILE", 0.5, 0.75, 1, INK)]),
    "b": dict(size=(0.82, 0.6, 0.56), wood=(0.42, 0.32, 0.23),
              front=[("text", "LIVERPOOL", 0.5, 0.4, 1, INK_BLUE), ("text", "23", 0.5, 0.7, 1, INK_BLUE)],
              back=[("text", "K & CO", 0.5, 0.3, 1, INK), ("text", "TOOLS", 0.5, 0.65, 1, INK)]),
    "c": dict(size=(1.36, 0.62, 0.5), wood=(0.40, 0.37, 0.32),
              front=[("text", "H&V", 0.28, 0.48, 2, INK), ("text", "RIO", 0.75, 0.48, 2, INK_RED)],
              back=[("text", "MACHINES", 0.5, 0.45, 1, INK)]),
    "s": dict(size=(0.56, 0.46, 0.42), wood=(0.47, 0.39, 0.28),
              front=[("text", "NO 7", 0.5, 0.5, 1, INK)],
              back=[("diamond", 0.5, 0.5, 7, INK_RED)]),
}
PX_M = 80  # texels per metre on the crate boards


def grime(img, seed, fade=0.4, dark=0.78, wet=0.5, mould=0.3, mud=0.25, tears=0.0, patches=0.0):
    """Weather a cell: fade toward the grey-brown of old wood and wet jute, darker overall, the lower
    rows wet and near black-green, mould in blotches, mud splashed up from the setts; for cloth: tears
    (dark holes with frayed rims) and sewn-on patches. v up in the cell: the last rows are the foot."""
    rng = rng_(seed)
    h, w = img.shape[:2]
    out = img.copy()
    grey = out[..., :3].mean(axis=2, keepdims=True) * np.array((1.02, 0.97, 0.88))
    out[..., :3] = out[..., :3] * (1 - fade) + grey * fade
    out[..., :3] *= dark
    # the wet foot: the last quarter, darkening and going green-black toward the bottom
    k = max(2, h // 4)
    t = np.linspace(0, 1, k)[:, None, None]
    foot = out[h - k:, :, :3]
    out[h - k:, :, :3] = foot * (1 - wet * t) + np.array((0.05, 0.07, 0.04)) * wet * t
    # mould and green stains
    n = vnoise(rng, w, h, 6, 6) * 0.7 + vnoise(rng, w, h, 17, 17) * 0.3
    m = n > 1 - mould * 0.6
    out[m, :3] = out[m, :3] * 0.55 + np.array((0.10, 0.14, 0.07)) * 0.45
    # mud splashed up: dark specks, thicker low down
    yy = np.arange(h)[:, None] / max(1, h - 1)
    sp = rng.random((h, w)) < mud * 0.35 * yy ** 2
    out[sp, :3] = np.array((0.12, 0.09, 0.06)) * rng.uniform(0.8, 1.3, (sp.sum(), 1))
    for _ in range(int(tears * 6)):
        cx, cy = rng.uniform(0.1, 0.9) * w, rng.uniform(0.2, 0.9) * h
        rx, ry = rng.uniform(1.5, 4.0), rng.uniform(1.0, 3.0)
        d = np.hypot((np.arange(w)[None, :] - cx) / rx, (np.arange(h)[:, None] - cy) / ry)
        out[d < 1.0, :3] = np.array((0.03, 0.03, 0.02))
        rim = (d >= 1.0) & (d < 1.5)
        out[rim, :3] = out[rim, :3] * 1.15
    for _ in range(int(patches * 3)):
        x0, y0 = int(rng.uniform(0.05, 0.75) * w), int(rng.uniform(0.1, 0.75) * h)
        pw, ph = int(rng.integers(6, 14)), int(rng.integers(5, 10))
        tone = rng.uniform(0.75, 1.2)
        out[y0:y0 + ph, x0:x0 + pw, :3] = out[y0:y0 + ph, x0:x0 + pw, :3] * 0.3 + np.array((0.32, 0.27, 0.19)) * tone * 0.7
        out[y0:y0 + ph:2, x0, :3] *= 0.5
        out[y0:y0 + ph:2, min(w - 1, x0 + pw - 1), :3] *= 0.5
        out[y0, x0:x0 + pw:2, :3] *= 0.5
    return out


def smooth01(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3 - 2 * x)


def cloth_grime(img, seed, tears=(0, 2), patch=0.5, fade=0.3, dark=0.76, damp=0.55):
    """Weather sackcloth or burlap as cloth wears (the lead, 2026-09-26: "it looks like cheese or leopard
    skin"): soft uneven stains in a few big blotches, damp soaked up from where it lies (u 0 and 1 are the
    underside of a sack or a bale: the section starts at the bottom), 0 to 2 tears as slits with a dark
    inside and pale frayed threads, now and then a square patch of another cloth sewn on. No dots."""
    rng = rng_(seed)
    h, w = img.shape[:2]
    out = img.copy()
    grey = out[..., :3].mean(axis=2, keepdims=True) * np.array((1.02, 0.97, 0.88))
    out[..., :3] = out[..., :3] * (1 - fade) + grey * fade
    out[..., :3] *= dark
    # stains: two octaves of low noise, eased, as a soft brown darkening
    n = vnoise(rng, w, h, 3, 3) * 0.65 + vnoise(rng, w, h, 6, 5) * 0.35
    st = smooth01((n - 0.5) * 2.5)[..., None] * 0.45
    out[..., :3] = out[..., :3] * (1 - st) + np.array((0.16, 0.12, 0.08)) * st
    # damp from the underside: toward u 0 and u 1, ragged by a little noise
    u = np.linspace(0, 1, w)[None, :]
    dist = np.minimum(u, 1 - u) + (vnoise(rng, w, h, 8, 4) - 0.5) * 0.08
    dm = (1 - smooth01(dist / 0.2))[..., None] * damp
    out[..., :3] = out[..., :3] * (1 - dm) + np.array((0.05, 0.06, 0.04)) * dm
    # a patch sewn on: another cloth, a darker or paler weave, stitched round
    if rng.random() < patch:
        pw, ph = int(rng.integers(7, 11)), int(rng.integers(6, 10))
        x0 = int(rng.uniform(0.3, 0.7) * w - pw / 2)
        y0 = int(rng.uniform(0.2, 0.8) * h - ph / 2)
        col = np.array((0.30, 0.28, 0.23)) if rng.random() < 0.5 else np.array((0.44, 0.38, 0.28))
        yy, xx = np.mgrid[0:ph, 0:pw]
        weave_ = (0.88 + 0.14 * ((xx + yy) % 2))[..., None]
        out[y0:y0 + ph, x0:x0 + pw, :3] = col * weave_ * rng.uniform(0.85, 1.0)
        thread = np.array((0.55, 0.50, 0.40))
        out[y0, x0:x0 + pw:2, :3] = thread
        out[y0 + ph - 1, x0:x0 + pw:2, :3] = thread
        out[y0:y0 + ph:2, x0, :3] = thread
        out[y0:y0 + ph:2, x0 + pw - 1, :3] = thread
    # tears: slits, mostly along the sack, a dark inside and pale frayed threads either side
    for _ in range(int(rng.integers(tears[0], tears[1] + 1))):
        cx, cy = rng.uniform(0.3, 0.7) * w, rng.uniform(0.2, 0.8) * h
        ang = math.pi / 2 + rng.uniform(-0.5, 0.5)
        L = rng.uniform(5, 10)
        for t in np.linspace(-L / 2, L / 2, int(L * 2) + 1):
            x = int(round(cx + math.cos(ang) * t))
            y = int(round(cy + math.sin(ang) * t))
            if 0 <= x < w and 0 <= y < h:
                out[y, x, :3] = (0.03, 0.025, 0.02)
                for side in (-1, 1):
                    if rng.random() < 0.55:
                        fx = int(round(x - math.sin(ang) * side))
                        fy = int(round(y + math.cos(ang) * side))
                        if 0 <= fx < w and 0 <= fy < h:
                            out[fy, fx, :3] = np.array((0.60, 0.53, 0.38)) * rng.uniform(0.8, 1.0)
    return out


def weather_all(A):
    """Pass 3: nothing clean or new on the quay. Each cell weathered by what it is."""
    items = []
    for i, (name, arr) in enumerate(A.items):
        sd = 9000 + i
        if name.startswith("crate_") and (name.endswith("_front") or name.endswith("_back") or name.endswith("_end") or name.endswith("_top")):
            arr = grime(arr, sd, fade=0.45, dark=0.72, wet=0.6, mould=0.35, mud=0.35)
        elif name.startswith("crate_") and ("_bar" in name):
            arr = grime(arr, sd, fade=0.35, dark=0.75, wet=0.4, mould=0.2, mud=0.2)
        elif name.startswith("stave") or name.startswith("head"):
            arr = grime(arr, sd, fade=0.3, dark=0.72, wet=0.45, mould=0.3, mud=0.2)
        elif name.startswith("sack"):
            arr = cloth_grime(arr, sd, tears=(0, 2), patch=0.5)
        elif name == "bale":
            arr = cloth_grime(arr, sd, tears=(1, 2), patch=0.7, fade=0.25)
        elif name.startswith("tarp"):
            # stained and sagging: soft blotches, no mould dots; water standing in two of the folds,
            # darker, its edge left by the noise (no ring)
            arr = cloth_grime(arr, sd, tears=(0, 1), patch=0.6, fade=0.15, dark=0.8, damp=0.35)
            rng = rng_(sd)
            h, w = arr.shape[:2]
            for _ in range(2):
                cx, cy = rng.uniform(0.25, 0.75) * w, rng.uniform(0.3, 0.7) * h
                rx, ry = rng.uniform(10, 18), rng.uniform(6, 10)
                n = vnoise(rng, w, h, 6, 6)
                d = np.hypot((np.arange(w)[None, :] - cx) / rx, (np.arange(h)[:, None] - cy) / ry) + (n - 0.5) * 0.6
                wet_ = (1 - smooth01((d - 0.6) / 0.5))[..., None] * 0.45
                arr[..., :3] = arr[..., :3] * (1 - wet_) + np.array((0.04, 0.05, 0.05)) * wet_
        elif name in ("planks", "planks_grey", "wood", "wood_grey", "pallet", "cart_bed", "baulk", "end_pine", "end_oak"):
            arr = grime(arr, sd, fade=0.5, dark=0.72, wet=0.5, mould=0.3, mud=0.3)
        elif name in ("wood_dark", "cart_red", "cart_green"):
            arr = grime(arr, sd, fade=0.3, dark=0.8, wet=0.4, mould=0.25, mud=0.3)
        elif name in ("rope", "rope_tar", "coil", "coil_tar"):
            arr = grime(arr, sd, fade=0.4, dark=0.7, wet=0.35, mould=0.15, mud=0.15)
        elif name in ("wicker", "wicker_dark", "straw"):
            arr = grime(arr, sd, fade=0.5, dark=0.68, wet=0.4, mould=0.35, mud=0.2)
        elif name in ("scale_plate", "brass"):
            arr = grime(arr, sd, fade=0.3, dark=0.7, wet=0.2, mould=0.1, mud=0.2)
        items.append((name, arr))
    A.items = items


def build_atlases():
    A = sl.SOLID_ATLAS
    D = sl.DECAL_ATLAS
    for k, c in CRATES.items():
        W, Dp, H = c["size"]
        b = 0.06
        pw, ph = int((W - 2 * b) * PX_M), int((H - 2 * b) * PX_M)
        A.add(f"crate_{k}_front", crate_side(1000 + ord(k), pw, ph, c["wood"], c["front"]))
        A.add(f"crate_{k}_back", crate_side(1100 + ord(k), pw, ph, c["wood"], c["back"]))
        ew = int((Dp - 2 * b) * PX_M)
        A.add(f"crate_{k}_end", crate_side(1200 + ord(k), ew, ph, c["wood"], []))
        A.add(f"crate_{k}_top", boards(1300 + ord(k), pw, ew, c["wood"], max(3, ew // 12), weather=0.5, dirt=0.0))
        dark = tuple(x * 0.82 for x in c["wood"])
        A.add(f"crate_{k}_barh", bar(1400 + ord(k), int(W * PX_M), 5, dark, True))
        A.add(f"crate_{k}_barv", bar(1500 + ord(k), 5, int(H * PX_M), dark, False))
    A.add("stave_oak", staves(2000, 128, 64, (0.40, 0.28, 0.17), n=18))
    A.add("stave_dark", staves(2001, 128, 64, (0.30, 0.21, 0.13), n=18))
    A.add("stave_blue", staves(2002, 128, 64, (0.36, 0.28, 0.18), n=18, paint=(0.20, 0.29, 0.40)))
    A.add("head_oak", cargo_head(2010, (0.44, 0.32, 0.20), "H&V", "ANTWERPEN", "NO 17"))
    A.add("head_dark", cargo_head(2011, (0.34, 0.25, 0.16), "M & CO", "ANTWERPEN", "NO 40"))
    A.add("head_blue", cargo_head(2012, (0.26, 0.32, 0.40), "H&V", "PETROLEUM", "NO 23", (0.70, 0.68, 0.60)))
    A.add("head_wine", cargo_head(2013, (0.40, 0.29, 0.18), "BORDEAUX", "VIN", "NO 12"))
    A.add("hoop", iron(2020, 16, 8, (0.10, 0.09, 0.08), 0.6))
    A.add("stave_chalk", chalk(staves(2003, 128, 64, (0.42, 0.30, 0.18), n=18), 2004))
    A.add("stave_chalk2", chalk(staves(2005, 128, 64, (0.36, 0.26, 0.16), n=18), 2006, ("40", "II")))
    A.add("strap", strap_iron(2021, 16, 16))
    A.add("sack_coffee", jute(2100, 112, 64, (0.64, 0.56, 0.40), "SANTOS", INK_BLUE, star=True))
    A.add("sack_grain", jute(2101, 112, 64, (0.56, 0.47, 0.32), "RIGA", INK))
    A.add("sack_plain", jute(2102, 112, 64, (0.50, 0.42, 0.29)))
    A.add("sack_red", jute(2103, 112, 64, (0.60, 0.52, 0.37), "BRAZIL", INK_RED))
    A.add("bale", burlap_bale(2110, 160, 96))
    A.add("band", iron(2111, 8, 8, (0.10, 0.09, 0.08), 0.6))
    A.add("tarp_green", tarp(2200, 192, 128, (0.19, 0.22, 0.17)))
    A.add("tarp_brown", tarp(2201, 192, 128, (0.34, 0.29, 0.22)))
    A.add("rope", rope_tex(2300, 8, 16, (0.56, 0.47, 0.32)))
    A.add("rope_tar", rope_tex(2301, 8, 16, (0.24, 0.20, 0.15)))
    A.add("coil", coil_tex(2302, 48, 32, (0.55, 0.46, 0.31)))
    A.add("coil_tar", coil_tex(2303, 48, 32, (0.26, 0.22, 0.16)))
    A.add("wicker", wicker(2400, 48, 24, (0.58, 0.45, 0.26)))
    A.add("wicker_dark", wicker(2401, 48, 24, (0.42, 0.32, 0.18)))
    A.add("straw", straw_solid(2410, 32, 32))
    A.add("planks", boards(2500, 64, 16, (0.62, 0.52, 0.36), 1, nails=False, weather=0.3, dirt=0.0))
    A.add("planks_grey", boards(2501, 64, 16, (0.46, 0.43, 0.38), 1, nails=False, weather=0.6, dirt=0.0))
    A.add("end_pine", end_grain(2502, 16, 16, (0.66, 0.54, 0.36)))
    A.add("end_oak", end_grain(2503, 16, 16, (0.50, 0.38, 0.24)))
    A.add("baulk", timber(2504, 96, 24, (0.46, 0.36, 0.24)))
    A.add("wood", boards(2505, 32, 32, (0.40, 0.31, 0.21), 1, nails=False, weather=0.3, dirt=0.0))
    A.add("wood_dark", boards(2506, 32, 32, (0.24, 0.18, 0.12), 1, nails=False, weather=0.2, dirt=0.0))
    A.add("wood_grey", boards(2507, 32, 32, (0.44, 0.40, 0.34), 1, nails=False, weather=0.6, dirt=0.0))
    A.add("pallet", boards(2508, 64, 64, (0.46, 0.40, 0.30), 6, weather=0.6, dirt=0.1))
    A.add("cart_red", painted_wood(2600, 32, 32, (0.40, 0.14, 0.09)))
    A.add("cart_green", painted_wood(2601, 32, 32, (0.14, 0.24, 0.17)))
    A.add("cart_bed", boards(2602, 64, 48, (0.44, 0.38, 0.28), 5, weather=0.5, dirt=0.0))
    A.add("iron", iron(2700, 16, 16))
    A.add("rust", iron(2701, 16, 16, (0.24, 0.12, 0.06), 0.7))
    A.add("scale_plate", scale_plate(2702, 32, 24))
    A.add("brass", brass(2703, 32, 8))
    A.add("stone", base(2704, 16, 16, (0.34, 0.35, 0.36), 0.25, 3))
    A.add("dark", base(2705, 8, 8, (0.06, 0.05, 0.05), 0.1, 2))
    D.add("straw_a", straw_decal(3000, 64, 48))
    D.add("straw_b", straw_decal(3001, 48, 32, 0.8))
    D.add("grain", spill_decal(3002, 32, 32, (0.55, 0.46, 0.27)))
    D.add("coffee", spill_decal(3003, 32, 32, (0.30, 0.20, 0.12)))
    D.add("oil", stain_decal(3004, 48, 48))
    D.add("dirt", stain_decal(3005, 48, 32, (0.16, 0.13, 0.09), 0.5))
    # pass 3: the debris round the heaps
    A.add("fish", fish_cell(2800, 32, 32))
    A.add("rat", base(2801, 16, 8, (0.20, 0.17, 0.14), 0.3, 3))
    A.add("rat_belly", base(2802, 8, 8, (0.36, 0.30, 0.26), 0.2, 2))
    D.add("muck", muck_decal(3006, 48, 40))
    D.add("tar", stain_decal(3007, 40, 40, (0.02, 0.02, 0.02), 0.8))
    D.add("straw_rot", rotten_straw(3008, 48, 40))
    D.add("rust_stain", stain_decal(3009, 32, 32, (0.26, 0.12, 0.05), 0.55))
    weather_all(A)
    A.pack()
    D.pack()


def make_materials():
    solid = sl.bl_image("qg_solid_tex", sl.SOLID_ATLAS.img, False)
    decal = sl.bl_image("qg_decal_tex", sl.DECAL_ATLAS.img, True)
    for name, img in zip(sl.MAT_NAMES, [solid, decal, decal, solid]):
        m = bpy.data.materials.new(name)
        nt = m.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.interpolation = "Closest"
        nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
        if img is decal:
            nt.links.new(t.outputs["Alpha"], bsdf.inputs["Alpha"])
        bsdf.inputs["Roughness"].default_value = 1.0


def save_surface_atlas():
    """R: shallow matching relief, G: rain absorption, B: sheen. Shipping ink is never a hole.

    Same cells and UVs as the colour atlas. Height is normalized within each material, not across
    unrelated atlas cells. Packed GLTF UVs are used directly (no psx atlas-cell remapping).
    """
    A = sl.SOLID_ATLAS
    image = np.ones_like(A.img)
    image[..., :3] = (0.5, 0.0, 0.0)
    for name, arr in A.items:
        x, y, w, h = A.cells[name]
        raw = arr
        if name.startswith("head_"):
            raw = head(2010 + ["oak", "dark", "blue", "wine"].index(name[5:]), w, h, (0.44, 0.32, 0.20))
        elif name.startswith("crate_") and name.split("_")[-1] in ("front", "back", "end"):
            kind, face = name.split("_")[1:]
            seed = {"front": 1000, "back": 1100, "end": 1200}[face] + ord(kind)
            raw = crate_side(seed, w, h, CRATES[kind]["wood"], [])
        elif name in ("stave_chalk", "stave_chalk2"):
            raw = staves(2003 if name == "stave_chalk" else 2005, w, h, (0.40, 0.28, 0.17), n=18)
        lum = raw[..., :3].mean(axis=2)
        lo, hi = np.quantile(lum, [0.08, 0.92])
        height = np.clip((lum - lo) / max(hi - lo, 0.03), 0, 1) * 0.4 + 0.3
        cloth = name.startswith(("sack", "bale", "rope", "coil", "tarp", "wicker"))
        metal = name in ("hoop", "strap", "band", "iron", "brass", "scale_plate")
        # Cloth's printed shipping marks are pigment. Its fine weave stays shallow and matte.
        if cloth:
            yy, xx = np.mgrid[0:h, 0:w]
            height = 0.5 + 0.035 * ((xx + yy) % 2)
        cell = image[y:y+h, x:x+w]
        cell[..., 0] = height
        cell[..., 1] = 0.25 if metal else 1.0 if cloth else 0.8
        cell[..., 2] = 0.65 if metal else 0.02 if cloth else 0.16
    img = sl.bl_image("quaygoods_surface", image, False)
    img.colorspace_settings.name = "Non-Color"
    img.filepath_raw = os.path.join(ROOT, "client", "public", "models", "quaygoods_surface.png")
    img.file_format = "PNG"
    img.save()


# ------------------------------------------------------------------ geometry helpers

UV4 = [(0, 0), (1, 0), (1, 1), (0, 1)]


def quad(m, cell, a, b, c, d, out, uvs=UV4, mat=SOLID, shade=1.0):
    m.face([a, b, c, d], cell, uvs=list(uvs), mat=mat, out=out, shade=shade)


def box(m, x0, x1, y0, y1, z0, z1, cell, skip=(), cells=None, shade=1.0):
    m.box(((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), cell, shade=shade, cells=cells, skip=skip)


def lathe(m, prof, sides, cells, M=None, rot0=0.0, cap=None, shade=1.0, inward=False):
    """A turned shape about +Z: prof [(r, z)], cells one per segment (or one name). Each face faces
    away from the profile's inside (to the right of the profile walked upward), so steps and
    sunk heads face the right way. cap: (cell, facing +1 / -1) closes the last ring."""
    if M is not None:
        with m.at(M):
            return lathe(m, prof, sides, cells, None, rot0, cap, shade, inward)
    if isinstance(cells, str):
        cells = [cells] * (len(prof) - 1)
    L = [0.0]
    for j in range(1, len(prof)):
        L.append(L[-1] + math.hypot(prof[j][0] - prof[j - 1][0], prof[j][1] - prof[j - 1][1]))
    tot = L[-1] or 1
    ang = [rot0 + 2 * math.pi * i / sides for i in range(sides + 1)]
    for j in range(len(prof) - 1):
        (r0, z0), (r1, z1) = prof[j], prof[j + 1]
        dr, dz = r1 - r0, z1 - z0
        if abs(dr) < 1e-7 and abs(dz) < 1e-7:
            continue
        for i in range(sides):
            a0, a1 = ang[i], ang[i + 1]
            am = (a0 + a1) / 2
            pts = [(r0 * math.cos(a0), r0 * math.sin(a0), z0), (r0 * math.cos(a1), r0 * math.sin(a1), z0),
                   (r1 * math.cos(a1), r1 * math.sin(a1), z1), (r1 * math.cos(a0), r1 * math.sin(a0), z1)]
            uvs = [(i / sides, L[j] / tot), ((i + 1) / sides, L[j] / tot), ((i + 1) / sides, L[j + 1] / tot), (i / sides, L[j + 1] / tot)]
            out = (math.cos(am) * dz, math.sin(am) * dz, -dr)
            if inward:
                out = tuple(-x for x in out)
            if r0 < 1e-6 or r1 < 1e-6:  # a point at the axis: a triangle
                if r0 < 1e-6:
                    tri = [pts[0], pts[2], pts[3]]
                    tuv = [uvs[0], uvs[2], uvs[3]]
                else:
                    tri = [pts[0], pts[1], pts[2]]
                    tuv = [uvs[0], uvs[1], uvs[2]]
                m.face(tri, cells[j], uvs=tuv, out=out, shade=shade)
            else:
                m.face(pts, cells[j], uvs=uvs, out=out, shade=shade)
    if cap:
        cell, facing = cap
        r, z = prof[-1]
        ring_ = [(r * math.cos(a), r * math.sin(a), z) for a in ang[:-1]]
        uvs = [(0.5 + 0.5 * math.cos(a - rot0), 0.5 + 0.5 * math.sin(a - rot0)) for a in ang[:-1]]
        m.face(ring_, cell, uvs=uvs, out=(0, 0, facing), shade=shade)


def tube(m, path, r, cell, closed=False, shade=1.0):
    """A four-sided tube: its faces stand at 45 degrees to the ground and to what it lies on, so
    none lies in another face's plane (z-fight check)."""
    m.tube(path, r, 4, cell, closed=closed, shade=shade)


def blob(m, L, Wd, Hh, cell, seed, cx=0.0, cy=0.0, z0=0.0, e1=0.55, e2=0.75, nu=10, nv=7, slump=0.18, noise=0.02,
         flat=True, M=None, shade=1.0):
    """A pillow along X (sack, bale): a superquadric L x Wd x Hh, its bottom pressed flat onto z0
    (those faces left out when z0 is the ground), the top slumped toward the sides, a little noise.
    uv: u round the section (0.5 on top), v along. Ends pinch to a point (fans)."""
    if M is not None:
        with m.at(M):
            return blob(m, L, Wd, Hh, cell, seed, cx, cy, z0, e1, e2, nu, nv, slump, noise, flat, None, shade)
    rng = rng_(seed)

    def sp(w, e):
        c = math.cos(w)
        return math.copysign(abs(c) ** e, c)

    def ss(w, e):
        s = math.sin(w)
        return math.copysign(abs(s) ** e, s)

    zc = z0 + Hh / 2
    rings = []
    for j in range(nv + 1):
        t = -math.pi / 2 + math.pi * j / nv
        x = cx + L / 2 * ss(t, e1)
        k = sp(t, e1)
        ring_ = []
        for i in range(nu):
            phi = 2 * math.pi * i / nu - math.pi / 2  # i = 0 at the bottom, nu/2 on top
            y = cy + Wd / 2 * k * sp(phi, e2)
            z = zc + Hh / 2 * k * ss(phi, e2)
            # slump: the top sags toward the long sides, the bulk spreads
            top = max(0.0, (z - zc) / (Hh / 2))
            z -= slump * Hh * top * (abs(y - cy) / (Wd / 2)) ** 2 * 0.6
            y += (y - cy) * slump * 0.25 * (1 - top)
            if 0 < j < nv:
                z += rng.normal(0, noise) * k
                y += rng.normal(0, noise) * k
            if flat and z < z0 + 0.004:
                z = z0
            ring_.append(Vector((x, y, z)))
        rings.append(ring_)
    tip0 = Vector((cx - L / 2 - 0.01, cy, zc - Hh * 0.12))
    tip1 = Vector((cx + L / 2 + 0.01, cy, zc - Hh * 0.12))
    for j in range(nv):
        for i in range(nu):
            i1 = (i + 1) % nu
            a, b, c, d = rings[j][i], rings[j][i1], rings[j + 1][i1], rings[j + 1][i]
            if flat and max(a.z, b.z, c.z, d.z) <= z0 + 1e-4:
                continue  # pressed on the ground: left out
            mid = (a + b + c + d) / 4
            axis = Vector((mid.x, cy, zc))
            uvs = [(i / nu, j / nv), ((i + 1) / nu, j / nv), ((i + 1) / nu, (j + 1) / nv), (i / nu, (j + 1) / nv)]
            m.face([a, b, c, d], cell, uvs=uvs, out=mid - axis, shade=shade)
    del tip0, tip1  # (the rings close to a point at t = +-pi/2 with e1 < 1: no fans needed)


def rope_line(a, b, sag, n=8, z_of=None):
    pts = []
    for k in range(n + 1):
        t = k / n
        x = a[0] + (b[0] - a[0]) * t
        y = a[1] + (b[1] - a[1]) * t
        z = a[2] + (b[2] - a[2]) * t - sag * math.sin(math.pi * t)
        pts.append((x, y, z))
    return pts


# ------------------------------------------------------------------ crates


def crate_geo(m, kind, lid=True, bottom_on_ground=True, shade=1.0, straw=False):
    """A framed crate W x D x H, its foot at z 0: corner posts and rails b = 6 cm square, the boards
    set back e = 2.5 cm between them (cut back where the frame is, so no board lies behind a rail)."""
    c = CRATES[kind]
    W, D, H = c["size"]
    b, e = 0.06, 0.025
    hx, hy = W / 2, D / 2
    bh, bv = f"crate_{kind}_barh", f"crate_{kind}_barv"
    # posts: iron corner caps top and foot (6 mm proud), oak between; the post's wood stops inside
    # them, so no face lies in another
    ci = 0.006
    ch = min(0.1, H * 0.18)
    for sx in (-1, 1):
        for sy in (-1, 1):
            x0, x1 = sorted((sx * hx, sx * (hx - b)))
            y0, y1 = sorted((sy * hy, sy * (hy - b)))
            box(m, x0, x1, y0, y1, ch, H - ch, bv, skip=("-z", "+z"), shade=shade)
            box(m, x0 - ci, x1 + ci, y0 - ci, y1 + ci, 0, ch, "strap", skip=("-z",), shade=shade)
            box(m, x0 - ci, x1 + ci, y0 - ci, y1 + ci, H - ch, H, "strap", shade=shade)
    for z0, z1, low in ((0, b, True), (H - b, H, False)):
        sk = ("-x", "+x", "-z") if low else ("-x", "+x")
        for sy in (-1, 1):
            y0, y1 = sorted((sy * hy, sy * (hy - b)))
            box(m, -hx + b, hx - b, y0, y1, z0, z1, bh, skip=sk, shade=shade)
        sk = ("-y", "+y", "-z") if low else ("-y", "+y")
        for sx in (-1, 1):
            x0, x1 = sorted((sx * hx, sx * (hx - b)))
            box(m, x0, x1, -hy + b, hy - b, z0, z1, bh, skip=sk, shade=shade)
    # boards
    xa, xb, ya, yb, za, zb = -hx + b, hx - b, -hy + b, hy - b, b, H - b
    fy, by_, ex = -hy + e, hy - e, hx - e
    quad(m, f"crate_{kind}_front", (xa, fy, za), (xb, fy, za), (xb, fy, zb), (xa, fy, zb), (0, -1, 0), shade=shade)
    quad(m, f"crate_{kind}_back", (xb, by_, za), (xa, by_, za), (xa, by_, zb), (xb, by_, zb), (0, 1, 0), shade=shade)
    quad(m, f"crate_{kind}_end", (ex, ya, za), (ex, yb, za), (ex, yb, zb), (ex, ya, zb), (1, 0, 0), shade=shade)
    quad(m, f"crate_{kind}_end", (-ex, yb, za), (-ex, ya, za), (-ex, ya, zb), (-ex, yb, zb), (-1, 0, 0), shade=shade)
    if lid:
        tz = H - e
        quad(m, f"crate_{kind}_top", (xa, ya, tz), (xb, ya, tz), (xb, yb, tz), (xa, yb, tz), (0, 0, 1), shade=shade)
        # two battens nailed across the lid
        for x in (xa + 0.1, xb - 0.1):
            # (5.5 cm over the boards: a layer nearer than 5 cm counts as "close" in the z-fight check)
            box(m, x - 0.04, x + 0.04, ya + 0.004, yb - 0.004, tz, tz + 0.055, bh, skip=("-z",), shade=shade * 0.95)
        if W > 0.75:
            # rope handles (beckets) on both ends
            for sx in (-1, 1):
                x = sx * (hx + 0.012)
                path = [(x - sx * 0.02, -0.12, H * 0.7), (x + sx * 0.03, -0.1, H * 0.6), (x + sx * 0.05, 0.0, H * 0.55),
                        (x + sx * 0.03, 0.1, H * 0.6), (x - sx * 0.02, 0.12, H * 0.7)]
                tube(m, path, 0.011, "rope")
    else:
        # open: the boards seen from inside, and straw (or the dark of it) at 3/4 height
        k = 0.8
        quad(m, f"crate_{kind}_end", (xa, fy, za), (xb, fy, za), (xb, fy, zb), (xa, fy, zb), (0, 1, 0), shade=shade * k)
        quad(m, f"crate_{kind}_end", (xb, by_, za), (xa, by_, za), (xa, by_, zb), (xb, by_, zb), (0, -1, 0), shade=shade * k)
        quad(m, f"crate_{kind}_end", (ex, ya, za), (ex, yb, za), (ex, yb, zb), (ex, ya, zb), (-1, 0, 0), shade=shade * k)
        quad(m, f"crate_{kind}_end", (-ex, yb, za), (-ex, ya, za), (-ex, ya, zb), (-ex, yb, zb), (1, 0, 0), shade=shade * k)
        # the rails' inner faces between the posts are there already (boxes); the straw fill
        zs = H * 0.72
        n = 5
        rng = rng_(int(W * 1000))
        grid = [[Vector((-ex + 0.004 + (2 * ex - 0.008) * i / n, -hy + e + 0.004 + (D - 2 * e - 0.008) * j / n,
                         zs + (rng.uniform(-0.03, 0.05) if 0 < i < n and 0 < j < n else 0.0))) for j in range(n + 1)] for i in range(n + 1)]
        for i in range(n):
            for j in range(n):
                quad(m, "straw" if straw else "dark", grid[i][j], grid[i + 1][j], grid[i + 1][j + 1], grid[i][j + 1], (0, 0, 1),
                     uvs=[(i / n, j / n), ((i + 1) / n, j / n), ((i + 1) / n, (j + 1) / n), (i / n, (j + 1) / n)])
    return W, D, H


def crate(kind):
    m = Mesh(ao=1.0)
    crate_geo(m, kind)
    m.goods = ("crates", kind in ("a", "c"))
    return m


def crate_roped():
    """A LIVERPOOL crate lashed both ways, the knot on top."""
    m = Mesh(ao=1.0)
    m.goods = ("crates", False)
    W, D, H = crate_geo(m, "b")
    o = 0.03
    hx, hy = W / 2 + o, D / 2 + o
    tube(m, [(-hx, 0.02, 0.08), (-hx, 0.02, H + o), (hx, 0.02, H + o), (hx, 0.02, 0.08)], 0.012, "rope")
    tube(m, [(0.05, -hy, 0.08), (0.05, -hy, H + o), (0.05, hy, H + o), (0.05, hy, 0.08)], 0.012, "rope")
    lathe(m, [(0.035, H + 0.02), (0.04, H + 0.05), (0.0, H + 0.07)], 6, "rope", M=move(0.05, 0.02, 0))
    tube(m, [(0.08, 0.04, H + o + 0.01), (0.16, 0.12, H + o), (0.2, 0.2, H + 0.01)], 0.01, "rope")
    return m


def lid_panel(m, kind, M):
    """A loose crate lid: boards and two battens across, lying in its own frame (x along, y across, z up)."""
    c = CRATES[kind]
    W, D, _ = c["size"]
    with m.at(M):
        t = 0.025
        # both faces: it leans, and is seen from behind as well
        box(m, -W / 2, W / 2, -D / 2, D / 2, 0.0, t, f"crate_{kind}_top")
        for x in (-W / 2 + 0.12, W / 2 - 0.12):
            box(m, x - 0.04, x + 0.04, -D / 2 + 0.03, D / 2 - 0.03, t, t + 0.055, f"crate_{kind}_barh", skip=("-z",))


def crate_open():
    """An open crate, straw inside, its lid leaning against the front, straw hanging over."""
    m = Mesh(ao=1.0)
    W, D, H = crate_geo(m, "b", lid=False, straw=True)
    # the lid leans on the front rail: its foot on the setts in front, its top edge against the crate,
    # 70 degrees up; its battens outward
    Dl = CRATES["b"]["size"][1]
    phi = math.radians(70)
    y0 = -D / 2 - 0.035 - Dl * math.cos(phi) - 0.03 * math.sin(phi)
    lid_panel(m, "b", move(0.05, y0, 0.003) @ rot("X", phi) @ move(0, Dl / 2, 0))
    # straw spilling over the rim: a few tufts (thin wedges)
    rng = rng_(77)
    for k in range(5):
        x = -W / 2 + 0.15 + k * (W - 0.3) / 4 + rng.uniform(-0.04, 0.04)
        y = D / 2 - 0.02
        quad(m, "straw", (x - 0.06, y, H + 0.03), (x + 0.06, y, H + 0.03), (x + 0.07, y + 0.07, H - 0.12), (x - 0.05, y + 0.07, H - 0.12), (0, 1, 0.4))
    return m


def crates_tied():
    """Two big crates side by side, a LIVERPOOL crate across them on top, two rope lashings over all."""
    m = PMesh(ao=1.4)
    Wa, Da, Ha = CRATES["a"]["size"]
    for M, sh in ((move(0, -Da / 2 - 0.015, 0), 1.0), (move(0.03, Da / 2 + 0.015, 0) @ rot("Z", math.pi + 0.02), 0.93)):
        with m.piece("crates", M, heavy=True), m.at(M):
            crate_geo(m, "a", shade=sh)
    M = move(0.02, 0.0, Ha) @ rot("Z", math.pi / 2 + 0.07)
    with m.piece("crates", M) as top, m.at(M):
        crate_geo(m, "b", shade=1.05)
    # lashings: over the top crate and down to the bottom rails, both sides (M8f: the loop over the top crate goes
    # with it when it is lifted; the ends down the big crates stay, lying on them)
    Wb, Db, Hb = CRATES["b"]["size"]
    for x in (-0.22, 0.22):
        o = 0.035
        path = [(x, -Da - 0.03 - o, 0.1), (x, -Da - 0.03 - o, Ha + o), (x, -Wb / 2 - o, Ha + o), (x, -Wb / 2 - o, Ha + Hb + o),
                (x, Wb / 2 + o, Ha + Hb + o), (x, Wb / 2 + o, Ha + o), (x, Da + 0.03 + o, Ha + o), (x, Da + 0.03 + o, 0.1)]
        with m.into(-1):
            tube(m, path[:3], 0.013, "rope")
            tube(m, path[5:], 0.013, "rope")
        with m.into(top):
            tube(m, path[2:6], 0.013, "rope")
    return m


def crate_column():
    """Three crates one on the other, each turned a little: the big one, the long one, the small one."""
    m = PMesh(ao=1.6)
    with m.piece("crates", None, heavy=True):
        _, _, Ha = crate_geo(m, "a")
    M = move(0.03, -0.02, Ha) @ rot("Z", 0.12)
    with m.piece("crates", M, heavy=True), m.at(M):
        _, _, Hc = crate_geo(m, "c", shade=0.95)
    M = move(-0.12, 0.04, Ha + Hc) @ rot("Z", -0.2)
    with m.piece("crates", M), m.at(M):
        crate_geo(m, "s", shade=1.06)
    return m


# ------------------------------------------------------------------ casks


def cask_profile(r_end, r_belly, h, hoops=(0.1, 0.3, 0.7, 0.9), chime=0.03, sink=0.03, foot=True, standing=True):
    """(r, z) up the cask, and a cell per segment: iron hoops stand 1.2 cm proud of the staves;
    the heads sit `sink` below the chime. standing: no bottom chime ring on the ground."""
    dh = 0.045  # hoop width
    zs = sorted(set([0.0, h] + [f * h - dh / 2 for f in hoops] + [f * h + dh / 2 for f in hoops]))

    def r_at(z):
        return r_end + (r_belly - r_end) * math.sin(math.pi * z / h)

    prof, cells = [], []
    if not standing:
        # the bottom head and chime, mirrored from the top
        rh = r_end - chime
        prof += [(0.0, sink), (rh, sink), (rh, 0.0)]
        cells += ["HEAD", "STAVE"]
    prof.append((r_end, 0.0))
    if not standing:
        cells.append("STAVE")
    hs = [(f * h - dh / 2, f * h + dh / 2) for f in hoops]
    for k in range(len(zs) - 1):
        z0, z1 = zs[k], zs[k + 1]
        inside = any(abs(z0 - a) < 1e-6 and abs(z1 - b) < 1e-6 for a, b in hs)
        if inside:
            r0, r1 = r_at(z0) + 0.012, r_at(z1) + 0.012
            prof.append((r0, z0))
            cells.append("hoop")  # the step out
            prof.append((r1, z1))
            cells.append("hoop")
            prof.append((r_at(z1), z1))
            cells.append("hoop")  # the step back
        else:
            prof.append((r_at(z1), z1))
            cells.append("STAVE")
    rh = r_end - chime
    prof += [(rh, h), (rh, h - sink)]
    cells += ["STAVE", "STAVE"]
    return prof, cells


def cask_geo(m, r_end=0.27, r_belly=0.33, h=0.88, stave="stave_oak", headc="head_oak", sides=12, M=None, standing=True, shade=1.0,
             hoops=(0.1, 0.3, 0.7, 0.9)):
    prof, cells = cask_profile(r_end, r_belly, h, hoops=hoops, standing=standing)
    cells = [stave if c == "STAVE" else headc if c == "HEAD" else c for c in cells]
    lathe(m, prof, sides, cells, M=M, cap=(headc, 1), shade=shade)
    # the bung, driven into the belly between two staves
    Mb = (M or Matrix.Identity(4)) @ rot("Z", math.pi / sides) @ move(r_belly * math.cos(math.pi / sides) - 0.004, 0, h * 0.5) @ rot("Y", math.pi / 2)
    lathe(m, [(0.034, 0.0), (0.032, 0.022), (0.0, 0.03)], 6, "wood_dark", M=Mb, shade=shade)
    if not standing:
        pass  # (the bottom head: the profile starts at the axis with it)


def cask(stave="stave_oak", headc="head_oak", r_end=0.27, r_belly=0.33, h=0.88):
    m = Mesh(ao=0.9)
    cask_geo(m, r_end, r_belly, h, stave, headc)
    m.goods = ("barrels", False)
    return m


def cask_big():
    """A hogshead: bigger, six hoops (two at each chime, two at the bilge)."""
    m = Mesh(ao=1.1)
    m.goods = ("barrels", True)
    cask_geo(m, 0.34, 0.42, 1.06, "stave_chalk2", "head_wine", sides=14, hoops=(0.07, 0.17, 0.4, 0.6, 0.83, 0.93))
    return m


def chock(m, x, y, z, along, size=0.12, M=None):
    """A wedge under a lying cask."""
    with m.at((M or Matrix.Identity(4)) @ move(x, y, z) @ rot("Z", along)):
        s = size
        P = [Vector(p) for p in [(-0.12, -s / 2, 0), (0.12, -s / 2, 0), (0.12, s / 2, 0), (-0.12, s / 2, 0), (-0.12, s / 2, s * 0.9), (0.12, s / 2, s * 0.9)]]
        m.face([P[0], P[1], P[5], P[4]], "wood_dark", out=(0, -1, 1))
        m.face([P[3], P[2], P[5], P[4]], "wood_dark", out=(0, 1, 0))
        m.face([P[0], P[3], P[4]], "wood_dark", out=(-1, 0, 0))
        m.face([P[1], P[5], P[2]], "wood_dark", out=(1, 0, 0))


def lying_cask(m, x, y, z, yaw=0.0, stave="stave_oak", headc="head_oak", r_end=0.27, r_belly=0.33, h=0.88, chocks=True, shade=1.0, sides=12):
    """A cask on its side along X (yaw turns it), centre of its length at (x, y), resting at z."""
    R = r_belly + 0.012
    # it rests on its belly (the hoops stand proud only where the cask is narrower)
    M = move(x, y, z + r_belly - 0.002) @ rot("Z", yaw) @ rot("Y", math.pi / 2) @ move(0, 0, -h / 2)
    cask_geo(m, r_end, r_belly, h, stave, headc, M=M, standing=False, shade=shade, sides=sides)
    if chocks:
        c, s = math.cos(yaw), math.sin(yaw)
        with rest_of(m):
            for sy in (-1, 1):
                # a wedge each side against the bilge
                px, py = x - s * sy * (R * 0.82), y + c * sy * (R * 0.82)
                chock(m, px, py, z, yaw + (math.pi if sy > 0 else 0), 0.13)


def cask_lying():
    m = PMesh(ao=0.8)
    with as_piece(m, "barrels"):
        lying_cask(m, 0, 0, 0)
    return m


def casks_pyramid(stave="stave_oak", headc="head_oak"):
    """Six casks on their sides: three, two in the hollows, one on top; chocks at the ends of the
    bottom row."""
    m = PMesh(ao=1.6)
    rb = 0.33
    w = 2 * rb + 0.03  # side by side, 3 cm between the bellies
    # a cask in a hollow touches the two below it: its axis 2 rb from theirs
    dz = math.sqrt((2 * rb) ** 2 - (w / 2) ** 2) - 0.004
    for k in range(3):
        st = "stave_chalk" if (stave == "stave_oak" and k == 0) else stave
        with m.piece("barrels", move(0, (k - 1) * w, 0)):
            lying_cask(m, 0, (k - 1) * w, 0, 0, st, headc, chocks=(k != 1), shade=1.0 - 0.04 * k)
    for k in range(2):
        with m.piece("barrels", move(0.03, (k - 0.5) * w, dz) @ rot("Z", 0.02)):
            lying_cask(m, 0.03, (k - 0.5) * w, dz, 0.02, stave, headc, chocks=False, shade=0.96 + 0.05 * k)
    with m.piece("barrels", move(-0.02, 0, 2 * dz) @ rot("Z", -0.03)):
        lying_cask(m, -0.02, 0, 2 * dz, -0.03, stave, headc, chocks=False, shade=1.04)
    return m


def casks_group():
    """Four casks standing close, one a darker old one, a keg on top of one."""
    m = PMesh(ao=1.0)
    rs = 0.345
    pts = [(-rs, -rs * 0.9, "stave_chalk", "head_oak"), (rs + 0.02, -rs * 0.8, "stave_dark", "head_dark"),
           (-rs * 0.2, rs * 0.95, "stave_oak", "head_oak"), (rs * 1.5, rs * 1.0, "stave_oak", "head_oak")]
    for k, (x, y, st, hd) in enumerate(pts):
        M = move(x, y, 0) @ rot("Z", k * 0.7)
        with m.piece("barrels", M):
            cask_geo(m, stave=st, headc=hd, M=M, shade=1.0 - 0.03 * k)
    M = move(-rs + 0.02, -rs * 0.9, 0.88 - 0.03 + 0.001) @ rot("Z", 0.4)
    with m.piece("barrels", M):
        cask_geo(m, 0.18, 0.22, 0.55, "stave_dark", "head_dark", sides=10, M=M)
    return m


# ------------------------------------------------------------------ sacks and bales


SACK_CELLS = ["sack_coffee", "sack_grain", "sack_plain", "sack_red"]


# Where the static sacks of a model are (2026-09-28: one sack model for every sack, client game/sackModel.ts): by
# model name, {k, m (the sack's matrix in the model's glTF frame, column-major), L, W, H}; written to
# client/src/world/quaygoods_sack_sockets.json. Only the models that hold sacks that are not goods of the server
# (the loaded handcart, the sack truck, the scale); their "_bare" copies are built without them.
QG_SOCKETS = {}
QG_CUR = [None]
QG_NO_SACKS = [False]


def tagged(name, fn):
    """Build the model with its sacks recorded under its name."""
    QG_CUR[0] = name
    try:
        return fn()
    finally:
        QG_CUR[0] = None


def bared(fn):
    """Build the model without its sacks (the game draws the one sack model in their place)."""
    QG_NO_SACKS[0] = True
    try:
        return fn()
    finally:
        QG_NO_SACKS[0] = False


def sack_geo(m, x, y, z, yaw, cell, seed, L=0.92, Wd=0.52, Hh=0.3, pitch=0.0, flat=True, slump=0.18):
    M = move(x, y, z) @ rot("Z", yaw) @ rot("Y", pitch)
    if QG_CUR[0] is not None and not QG_NO_SACKS[0]:
        C = Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1)))  # Blender (x, y, z) -> glTF (x, z, -y)
        g = C @ (m.xf @ M) @ C.inverted()
        QG_SOCKETS.setdefault(QG_CUR[0], []).append(dict(k="lying", m=[round(g[r][c], 4) for c in range(4) for r in range(4)],
                                                         L=round(L, 3), W=round(Wd, 3), H=round(Hh, 3)))
    if QG_NO_SACKS[0]:
        return
    blob(m, L, Wd, Hh, cell, seed, z0=0.0, e1=0.32, e2=0.92, nu=10, nv=6, slump=slump, noise=0.012, flat=flat, M=M)
    # the tied ears at both ends
    for sx in (-1, 1):
        with m.at(M @ move(sx * (L / 2 + 0.015), 0, Hh * 0.42)):
            lathe(m, [(0.045, 0.0), (0.02, 0.05), (0.0, 0.07)], 5, cell, M=rot("Y", sx * math.pi / 2))


def sack_lying():
    m = Mesh(ao=0.5)
    sack_geo(m, 0, 0, 0, 0, "sack_coffee", 1)
    m.goods = ("sacks", False)
    return m


def sack_standing():
    """A sack stood on end and slumped against itself: a squat blob, the top folded over, tied."""
    m = Mesh(ao=0.8)
    m.goods = ("sacks", False)
    blob(m, 0.46, 0.42, 0.74, "sack_grain", 5, z0=0.0, e1=0.8, e2=0.85, nu=10, nv=6, slump=0.05, noise=0.018,
         M=rot("Z", 0.3))
    lathe(m, [(0.09, 0.66), (0.06, 0.74), (0.1, 0.8), (0.03, 0.84)], 6, "sack_grain", M=move(0.03, 0.02, 0) @ rot("Y", 0.25))
    lathe(m, [(0.062, 0.715), (0.062, 0.745)], 6, "rope", M=move(0.03, 0.02, 0) @ rot("Y", 0.25))
    return m


def sacks_heap():
    """Five sacks thrown down: three below, two across them, one slumped off the end."""
    m = PMesh(ao=0.8)
    H = 0.28
    for k, (x, y, yaw) in enumerate([(-0.05, -0.55, 0.05), (0.0, 0.0, -0.04), (0.06, 0.55, 0.1)]):
        with m.piece("sacks", move(x, y, 0) @ rot("Z", yaw)):
            sack_geo(m, x, y, 0, yaw, SACK_CELLS[k % 3], 10 + k)
    for k, (x, y, yaw) in enumerate([(-0.22, -0.28, 1.5), (0.26, 0.26, 1.64)]):
        with m.piece("sacks", move(x, y, H - 0.05) @ rot("Z", yaw)):
            sack_geo(m, x, y, H - 0.05, yaw, SACK_CELLS[(k + 1) % 3], 20 + k, flat=False, slump=0.25)
    with m.piece("sacks", move(0.75, -0.3, 0.0) @ rot("Z", 0.55)):
        sack_geo(m, 0.75, -0.3, 0.0, 0.55, "sack_plain", 30, pitch=-0.12)
    return m


def pallet_geo(m, W=1.2, D=1.0, H=0.13):
    """A low pallet: three bearers, deck boards with gaps (no bottoms: they rest)."""
    bh = H - 0.06  # (the boards 6 cm thick: a layer nearer than 5 cm counts as "close" in the z-fight check)
    for y in (-D / 2 + 0.06, 0, D / 2 - 0.06):
        box(m, -W / 2, W / 2, y - 0.05, y + 0.05, 0, bh, "wood_dark", skip=("-z",))
    n = 6
    bw = (D - 0.02 * (n - 1)) / n
    for k in range(n):
        y0 = -D / 2 + k * (bw + 0.02)
        box(m, -W / 2 - 0.02, W / 2 + 0.02, y0, y0 + bw, bh, H, "planks_grey", skip=("-z",))
    return H


def sacks_pallet(cells=("sack_coffee", "sack_coffee", "sack_red")):
    """A pallet of coffee: four layers laid crosswise, the top one short, a sack slumped over the edge."""
    m = PMesh(ao=1.3)
    z = pallet_geo(m, 1.2, 1.0)
    H = 0.26
    k = 0
    for layer in range(4):
        cross = layer % 2 == 1
        if not cross:
            for y in (-0.25, 0.25):
                x, yaw = 0.02 * (layer - 1), 0.03 * (layer - 1.5)
                with m.piece("sacks", move(x, y, z) @ rot("Z", yaw)):
                    sack_geo(m, x, y, z, yaw, cells[k % len(cells)], 100 + k, L=1.1, Wd=0.5, Hh=H, flat=False)
                k += 1
        else:
            for x in (-0.3, 0.3):
                if layer == 3 and x > 0:
                    continue
                yaw = math.pi / 2 + 0.05 * (layer - 2)
                with m.piece("sacks", move(x, 0.0, z) @ rot("Z", yaw)):
                    sack_geo(m, x, 0.0, z, yaw, cells[k % len(cells)], 100 + k, L=0.95, Wd=0.55, Hh=H, flat=False)
                k += 1
        z += H - 0.05
    # one slumped over the top edge
    with m.piece("sacks", move(0.52, 0.1, z - 0.18) @ rot("Z", math.pi / 2 - 0.2)):
        sack_geo(m, 0.52, 0.1, z - 0.18, math.pi / 2 - 0.2, "sack_plain", 199, pitch=0.5, flat=False, slump=0.3)
    return m


def bale_geo(m, x, y, z, yaw, seed, L=1.25, Wd=0.62, Hh=0.68, flat=True, shade=1.0):
    M = move(x, y, z) @ rot("Z", yaw)
    blob(m, L, Wd, Hh, "bale", seed, z0=0.0, e1=0.24, e2=0.36, nu=10, nv=6, slump=0.04, noise=0.012, flat=flat, M=M, shade=shade)
    # iron bands round the section, 2 cm out; four-sided (corners to the canvas)
    for f in (-0.3, 0.0, 0.3):
        bx = f * L
        pts = []
        for i in range(12):
            phi = 2 * math.pi * i / 12  # (points at the corners too: a chord across a corner would cut the canvas)
            c, s = math.cos(phi), math.sin(phi)
            yy = (Wd / 2 + 0.02) * math.copysign(abs(c) ** 0.36, c)
            zz = Hh / 2 + (Hh / 2 + 0.02) * math.copysign(abs(s) ** 0.36, s)
            if flat and zz < 0.012:
                zz = 0.012
            pts.append((bx, yy, zz))
        with m.at(M):
            tube(m, pts, 0.01, "band", closed=True)


def bale():
    m = Mesh(ao=0.8)
    bale_geo(m, 0, 0, 0, 0, 7)
    return m


def bales_stack():
    """Five cotton bales: three side by side, two on top across the joints."""
    m = Mesh(ao=1.6)
    Wd, Hh = 0.62, 0.68
    for k in range(3):
        bale_geo(m, 0.02 * k, (k - 1) * (Wd + 0.04), 0, 0.02 * (k - 1), 40 + k, shade=1.0 - 0.03 * k)
    for k in range(2):
        bale_geo(m, 0.05, (k - 0.5) * (Wd + 0.06), Hh - 0.02, -0.03 + 0.05 * k, 50 + k, flat=False, shade=1.04)
    return m


# ------------------------------------------------------------------ tarpaulins


def tarp_heap(boxes, cell, seed, ropes=2, weights=True, casks=()):
    """A tarpaulin thrown over goods: a height field over the boxes (x0, x1, y0, y1, top) and casks
    lying along X (x0, x1, y, z of the axis, r), sagging between them, falling steeply to a hem a few
    cm above the setts; ropes over it to stones."""
    m = Mesh(ao=1.3)
    rng = rng_(seed)
    k = 2.6  # the drape: metres down per metre out
    ext = [(b[0], b[1], b[2], b[3], b[4]) for b in boxes] + [(c[0], c[1], c[2] - c[4], c[2] + c[4], c[3] + c[4]) for c in casks]
    top = max(e[4] for e in ext)
    X0 = min(e[0] for e in ext) - top / k
    X1 = max(e[1] for e in ext) + top / k
    Y0 = min(e[2] for e in ext) - top / k
    Y1 = max(e[3] for e in ext) + top / k

    def hgt(x, y):
        best = 0.0
        for x0, x1, y0, y1, t in boxes:
            dx = max(x0 - x, 0, x - x1)
            dy = max(y0 - y, 0, y - y1)
            d = math.hypot(dx, dy)
            # rounded shoulders
            v = t - (d * k if d > 0.06 else d * d * 8)
            best = max(best, v)
        for x0, x1, cy, cz, r in casks:
            # the cloth over a cask's round, then falling away from it
            dy = abs(y - cy)
            dx = max(x0 - x, 0, x - x1)
            v = cz + math.sqrt(max(0.0, r * r - min(dy, r) ** 2)) + 0.02
            if dy > r * 0.8:
                v = min(v, cz + r * 0.6 - (dy - r * 0.8) * k)
            v -= dx * k if dx > 0.05 else dx * dx * 8
            best = max(best, v)
        return best

    nx, ny = 14, 10
    G = [[None] * (ny + 1) for _ in range(nx + 1)]
    for i in range(nx + 1):
        for j in range(ny + 1):
            x = X0 + (X1 - X0) * i / nx
            y = Y0 + (Y1 - Y0) * j / ny
            z = hgt(x, y)
            edge = i in (0, nx) or j in (0, ny)
            if 0 < z:
                z += rng.normal(0, 0.018)
            z = max(z, 0.05 if edge else 0.06)
            if edge:
                z = 0.05 + rng.uniform(0, 0.04)
            G[i][j] = Vector((x + (rng.normal(0, 0.03) if edge else 0), y + (rng.normal(0, 0.03) if edge else 0), z))
    for i in range(nx):
        for j in range(ny):
            a, b, c, d = G[i][j], G[i + 1][j], G[i + 1][j + 1], G[i][j + 1]
            n = (b - a).cross(d - a)
            if n.z < 0:
                n = -n
            quad(m, cell, a, b, c, d, tuple(n), uvs=[(i / nx, j / ny), ((i + 1) / nx, j / ny), ((i + 1) / nx, (j + 1) / ny), (i / nx, (j + 1) / ny)])
    # the ropes: across the short way, 3 cm over the cloth, down to a stone each side
    for r in range(ropes):
        x = X0 + (X1 - X0) * (r + 1) / (ropes + 1) + rng.uniform(-0.1, 0.1)
        pts = []
        for j in range(ny + 1):
            y = Y0 + (Y1 - Y0) * j / ny
            y = Y0 - 0.12 + (Y1 - Y0 + 0.24) * j / ny
            pts.append((x, y, max(hgt(x, y), 0.02) + 0.035))
        pts[0] = (x, Y0 - 0.1, 0.12)
        pts[-1] = (x, Y1 + 0.1, 0.12)
        tube(m, pts, 0.014, "rope")
        if weights:
            for yy in (Y0 - 0.12, Y1 + 0.12):
                box(m, x - 0.14, x + 0.14, yy - 0.11, yy + 0.11, 0, 0.16, "stone", skip=("-z",))
    return m


def tarp_crates():
    return tarp_heap([(-0.9, 0.1, -0.5, 0.45, 1.05), (0.2, 1.0, -0.45, 0.4, 0.62), (-0.7, -0.1, 0.5, 0.8, 0.5)], "tarp_green", 61, ropes=3)


def tarp_casks():
    """Six casks standing under a brown tarpaulin, a keg on them: the cloth sags between their heads."""
    boxes = []
    for i in range(3):
        for j in range(2):
            x, y = (i - 1) * 0.72, (j - 0.5) * 0.72
            boxes.append((x - 0.29, x + 0.29, y - 0.29, y + 0.29, 0.9))
    boxes.append((-0.5, -0.1, -0.2, 0.2, 1.42))
    return tarp_heap(boxes, "tarp_brown", 62, ropes=3)


# ------------------------------------------------------------------ rope


def rope_coil(cell="coil"):
    """A hawser flaked down in a coil: a flat donut of turns, the end led out over the top."""
    m = Mesh(ao=0.5)
    prof = [(0.17, 0.0), (0.13, 0.07), (0.12, 0.2), (0.16, 0.3), (0.3, 0.335), (0.44, 0.3), (0.5, 0.19), (0.5, 0.07), (0.47, 0.0)]
    # inner hole first (profile walked from the inner foot up over the top to the outer foot: the
    # faces then face away from the donut's core)
    lathe(m, prof[::-1], 14, cell)
    rt = "rope" if cell == "coil" else "rope_tar"
    tube(m, [(0.28, 0.0, 0.33), (0.42, -0.14, 0.35), (0.55, -0.3, 0.2), (0.66, -0.42, 0.05), (0.8, -0.5, 0.022), (1.05, -0.56, 0.022), (1.3, -0.42, 0.022)], 0.022, rt)
    return m


def rope_loose():
    """A rope's end lying on the setts in a loose S."""
    m = Mesh()
    pts = [(-1.2 + 0.2 * k, 0.25 * math.sin(k * 0.7), 0.016) for k in range(13)]
    tube(m, pts, 0.016, "rope")
    return m


def cable_drum():
    """A cable drum on its edge (axis along X), rope wound on it, chocked both sides."""
    m = Mesh(ao=1.2)
    R, w = 0.62, 0.62
    M = move(0, 0, R) @ rot("Y", math.pi / 2)
    for sx in (-1, 1):
        z0 = sx * w / 2
        # a flange: a thick disc of boards
        with m.at(M):
            lathe(m, [(0.0, z0 - 0.03 * sx), (R, z0 - 0.03 * sx), (R, z0 + 0.03 * sx), (0.0, z0 + 0.03 * sx)] if sx > 0 else
                  [(0.0, z0 + 0.03), (R, z0 + 0.03), (R, z0 - 0.03), (0.0, z0 - 0.03)], 14, "wood_dark", inward=sx < 0)
    with m.at(M):
        lathe(m, [(0.44, -w / 2 + 0.03), (0.47, -w / 2 + 0.1), (0.47, w / 2 - 0.1), (0.44, w / 2 - 0.03)], 14, "coil")
        box(m, -0.06, 0.06, -0.06, 0.06, -w / 2 - 0.1, w / 2 + 0.1, "iron")
    for sy in (-1, 1):
        chock(m, 0, sy * 0.52, 0, math.pi if sy > 0 else 0, 0.14)
    return m


def trestle(m, x, y, h=1.0, span=0.9, cell="wood_grey"):
    """A rope walk trestle: a crossbar with pegs on splayed legs (bar across Y)."""
    box(m, x - 0.05, x + 0.05, y - span / 2, y + span / 2, h, h + 0.08, cell)
    for sy in (-1, 1):
        for sx in (-1, 1):
            m.beam((x + sx * 0.04, y + sy * (span / 2 - 0.1), h + 0.02), (x + sx * 0.28, y + sy * (span / 2 + 0.05), 0.0), 0.06, 0.06, cell)
    for yy in (-0.28, -0.0, 0.28):
        box(m, x - 0.015, x + 0.015, y + yy - 0.015, y + yy + 0.015, h + 0.08, h + 0.2, "wood_dark")
    m.beam((x - 0.2, y - span / 2, 0.35), (x - 0.2, y + span / 2, 0.35), 0.04, 0.04, cell)


def rope_jack(m, x, y):
    """The head of the rope walk: two posts, a spoked wheel with a crank, hooks the strands hang on."""
    for sy in (-1, 1):
        box(m, x - 0.07, x + 0.07, y + sy * 0.42 - 0.07, y + sy * 0.42 + 0.07, 0, 1.55, "wood_dark", skip=("-z",))
        m.beam((x - 0.5, y + sy * 0.42, 0.0), (x - 0.02, y + sy * 0.42, 0.9), 0.07, 0.07, "wood_dark")
    box(m, x - 0.07, x + 0.07, y - 0.35, y + 0.35, 1.3, 1.42, "wood_dark")
    # the wheel on the far side (-x), axle along X
    cx, cz, R = x - 0.25, 0.95, 0.55
    Mw = move(cx, y, cz) @ rot("Y", math.pi / 2)
    rim = [(R * math.cos(a), R * math.sin(a), 0.0) for a in np.linspace(0, 2 * math.pi, 16, endpoint=False)]
    with m.at(Mw):
        tube(m, rim, 0.035, "wood_dark", closed=True)
        for k in range(8):
            a = k * math.pi / 4
            m.beam((0.05 * math.cos(a), 0.05 * math.sin(a), 0), (R * math.cos(a), R * math.sin(a), 0), 0.035, 0.035, "wood")
        lathe(m, [(0.09, -0.08), (0.09, 0.08)], 8, "wood_dark", cap=("end_oak", 1))
    m.beam((x - 0.25, y, cz), (x + 0.12, y, cz), 0.05, 0.05, "iron")
    m.beam((x - 0.33, y, cz), (x - 0.33, y + 0.3, cz + 0.2), 0.04, 0.04, "iron")
    for yy in (-0.28, 0.0, 0.28):
        m.beam((x + 0.07, y + yy, 1.02), (x + 0.16, y + yy, 1.02), 0.03, 0.03, "iron")


def ropewalk(L=9.0, n=3):
    """A rope walk laid out on the quay: the jack at x 0, trestles every L/n, three strands running
    out to a weighted post at x L (picture 1)."""
    m = Mesh(ao=1.0)
    rope_jack(m, 0.0, 0.0)
    xs = [L * (k + 1) / (n + 1) for k in range(n)]
    for x in xs:
        trestle(m, x, 0.0, 1.0)
    # the post at the far end, braced, a stone on its foot board
    box(m, L - 0.07, L + 0.07, -0.07, 0.07, 0, 1.2, "wood_dark", skip=("-z",))
    box(m, L - 0.1, L + 0.5, -0.3, 0.3, 0, 0.05, "wood_grey", skip=("-z",))
    box(m, L + 0.1, L + 0.45, -0.22, 0.22, 0.05, 0.3, "stone", skip=("-z",))
    box(m, L - 0.2, L + 0.2, -0.3, 0.3, 1.05, 1.13, "wood_dark")
    stations = [0.16] + xs + [L]
    for yy in (-0.28, 0.0, 0.28):
        pts = []
        for k in range(len(stations) - 1):
            a = (stations[k], yy, 1.02 if k == 0 else 1.2)
            b = (stations[k + 1], yy, 1.2 if k + 1 < len(stations) - 1 else 1.1)
            seg = rope_line(a, b, 0.07, 6)
            pts += seg if not pts else seg[1:]
        tube(m, pts, 0.017, "rope")
    return m


# ------------------------------------------------------------------ wicker


def basket_geo(m, x, y, z0=0.0, r0=0.17, r1=0.25, h=0.36, cell="wicker", handles=True, M=None, shade=1.0, rim=True):
    Mb = (M or Matrix.Identity(4)) @ move(x, y, z0)
    with m.at(Mb):
        prof = [(r0, 0.0), (r0 + (r1 - r0) * 0.6, h * 0.55), (r1, h)]
        lathe(m, prof, 12, cell, shade=shade)
        # inside wall and floor, facing in
        pin = [(r0 - 0.02, 0.03), (r0 + (r1 - r0) * 0.6 - 0.02, h * 0.55), (r1 - 0.02, h - 0.005)]
        lathe(m, pin, 12, "wicker_dark", inward=True, shade=shade * 0.7)
        lathe(m, [(0.0, 0.03), (r0 - 0.02, 0.03)], 12, "wicker_dark", shade=shade * 0.5)
        if rim:
            tube(m, [((r1 - 0.01) * math.cos(a), (r1 - 0.01) * math.sin(a), h + 0.01) for a in np.linspace(0, 2 * math.pi, 14, endpoint=False)],
                 0.02, "wicker_dark", closed=True, shade=shade)
        if handles:
            for sx in (-1, 1):
                tube(m, [(sx * (r1 - 0.01), -0.07, h - 0.02), (sx * (r1 + 0.05), -0.05, h + 0.05), (sx * (r1 + 0.06), 0.0, h + 0.07),
                         (sx * (r1 + 0.05), 0.05, h + 0.05), (sx * (r1 - 0.01), 0.07, h - 0.02)], 0.013, "wicker_dark", shade=shade)


def baskets():
    """Two baskets side by side and a stack of three nested ones behind."""
    m = Mesh(ao=0.6)
    basket_geo(m, -0.3, 0.0)
    basket_geo(m, 0.28, 0.06, M=rot("Z", 0.5), shade=0.95)
    for k in range(3):
        basket_geo(m, 0.0, 0.55, 0.08 * k, handles=(k == 2), rim=True, shade=1.0 - 0.05 * (2 - k))
    return m


def basket_one():
    m = Mesh(ao=0.4)
    basket_geo(m, 0, 0)
    return m


def hamper():
    """A square hamper with its lid, two leather-ish straps (rope)."""
    m = Mesh(ao=0.6)
    W, D, H = 0.7, 0.48, 0.44
    box(m, -W / 2, W / 2, -D / 2, D / 2, 0, H, "wicker", skip=("-z",))
    box(m, -W / 2 - 0.02, W / 2 + 0.02, -D / 2 - 0.02, D / 2 + 0.02, H, H + 0.07, "wicker_dark")
    for x in (-0.18, 0.18):
        tube(m, [(x, -D / 2 - 0.05, 0.25), (x, -D / 2 - 0.05, H + 0.09), (x, D / 2 + 0.05, H + 0.09), (x, D / 2 + 0.05, 0.25)], 0.012, "rope")
    return m


# ------------------------------------------------------------------ carts


def spoked_wheel(m, M, R=0.45, spokes=10, rim_cell="wood_dark", tyre="iron"):
    with m.at(M):
        pts = [(R * math.cos(a), R * math.sin(a), 0.0) for a in np.linspace(0, 2 * math.pi, 18, endpoint=False)]
        tube(m, pts, 0.04, rim_cell, closed=True)
        tube(m, [((R + 0.03) * math.cos(a), (R + 0.03) * math.sin(a), 0.0) for a in np.linspace(0, 2 * math.pi, 18, endpoint=False)], 0.018, tyre, closed=True)
        for k in range(spokes):
            a = 2 * math.pi * k / spokes
            m.beam((0.07 * math.cos(a), 0.07 * math.sin(a), 0), ((R - 0.03) * math.cos(a), (R - 0.03) * math.sin(a), 0), 0.03, 0.03, "wood")
        lathe(m, [(0.1, -0.1), (0.11, 0.0), (0.08, 0.1)], 8, "wood_dark", cap=("end_oak", 1))


def handcart_geo(m, loaded=False, paint="cart_red"):
    """A two-wheeled handcart parked tipped forward, the shaft ends on the setts (front -Y).
    Bed 1.4 x 0.85 with side boards; spoked wheels 0.9 m."""
    R = 0.47
    Lb, Wb = 1.4, 0.85
    # The shafts extend 1.65 m from the axle, not 1.15 m. The old angle buried their
    # tips 14 cm into the setts. Rest the tips on the stones without lifting the wheels.
    tip = math.asin((R + 0.03 - 0.005) / (Lb / 2 + 0.95))
    axle = Vector((0, 0.25, R + 0.03))
    Mt = move(*axle) @ rot("X", tip)  # the cart's frame, turned about the axle
    with m.at(Mt):
        z0 = 0.06
        box(m, -Wb / 2, Wb / 2, -Lb / 2 - 0.1, Lb / 2 - 0.1, z0, z0 + 0.05, "cart_bed")
        for sx in (-1, 1):
            box(m, sx * Wb / 2 - (0.03 if sx > 0 else 0), sx * Wb / 2 + (0.0 if sx > 0 else 0.03), -Lb / 2 - 0.1, Lb / 2 - 0.1, z0 + 0.05, z0 + 0.3, paint)
        box(m, -Wb / 2 + 0.03, Wb / 2 - 0.03, Lb / 2 - 0.13, Lb / 2 - 0.1, z0 + 0.05, z0 + 0.3, paint)
        box(m, -Wb / 2 + 0.03, Wb / 2 - 0.03, -Lb / 2 - 0.1, -Lb / 2 - 0.07, z0 + 0.05, z0 + 0.22, paint)
        # the shafts: under the bed and out forward
        for sx in (-1, 1):
            m.beam((sx * 0.36, Lb / 2 - 0.1, z0 - 0.03), (sx * 0.33, -Lb / 2 - 0.95, z0 - 0.03), 0.06, 0.06, "wood")
        m.beam((-0.33, -Lb / 2 - 0.75, z0 - 0.03), (0.33, -Lb / 2 - 0.75, z0 - 0.03), 0.045, 0.045, "wood")
        box(m, -0.06, 0.06, -0.05, 0.05, -0.04, z0, "iron")
        if loaded:
            with m.at(move(0.0, 0.18, z0 + 0.05)):
                crate_geo(m, "b")
            with m.at(move(0.05, -0.43, z0 + 0.05)):
                sack_geo(m, 0, 0, 0, math.pi / 2 + 0.08, "sack_grain", 71, L=0.7, Wd=0.45, Hh=0.26, flat=False)
            for x in (-0.2, 0.2):
                tube(m, [(x, 0.47, z0 + 0.3), (x, 0.47, z0 + 0.62), (x, -0.13, z0 + 0.62), (x, -0.13, z0 + 0.35)], 0.012, "rope")
    for sx in (-1, 1):
        spoked_wheel(m, move(sx * (Wb / 2 + 0.1), axle.y, axle.z) @ rot("Y", math.pi / 2), R)
    m.beam((-Wb / 2 - 0.12, axle.y, axle.z), (Wb / 2 + 0.12, axle.y, axle.z), 0.05, 0.05, "iron")


def handcart():
    m = Mesh(ao=0.9)
    handcart_geo(m)
    return m


def handcart_loaded():
    m = Mesh(ao=1.1)
    handcart_geo(m, loaded=True, paint="cart_green")
    return m


def sack_truck():
    """A sack truck standing on its toe plate and wheels, a sack on it against the frame."""
    m = Mesh(ao=0.8)
    lean = 0.12
    with m.at(rot("X", -lean)):
        for sx in (-1, 1):
            box(m, sx * 0.2 - 0.025, sx * 0.2 + 0.025, 0.0, 0.05, 0.05, 1.3, "wood")
            m.beam((sx * 0.2, 0.02, 1.3), (sx * 0.24, 0.12, 1.42), 0.04, 0.04, "wood")
        for z in (0.35, 0.75, 1.1):
            box(m, -0.175, 0.175, 0.005, 0.045, z, z + 0.04, "wood_dark")
        box(m, -0.22, 0.22, -0.3, 0.02, 0.02, 0.05, "iron")
        # (stood on the toe plate: its middle half its length up; at 0.05 it went 0.35 m into the ground, the prop check)
        sack_geo(m, 0.0, -0.18, 0.05 + 0.4, 0.0, "sack_coffee", 81, L=0.8, Wd=0.42, Hh=0.3, pitch=-math.pi / 2 + 0.12, flat=False)
    for sx in (-1, 1):
        with m.at(move(sx * 0.27, 0.12, 0.14) @ rot("Y", math.pi / 2)):
            lathe(m, [(0.14, -0.03), (0.14, 0.03)], 10, "iron", cap=("iron", 1))
    m.beam((-0.29, 0.12, 0.14), (0.29, 0.12, 0.14), 0.03, 0.03, "iron")
    return m


# ------------------------------------------------------------------ timber, scale


def planks_stack():
    """Sawn planks stacked on sticks to dry: four layers of six on three bearers."""
    m = Mesh(ao=1.0)
    L, pw, pt, gap = 3.2, 0.2, 0.04, 0.025
    z = 0.0
    for x in (-1.3, 0.0, 1.3):
        box(m, x - 0.06, x + 0.06, -0.72, 0.72, 0, 0.1, "wood_dark", skip=("-z",), cells={"-y": "end_oak", "+y": "end_oak"})
    z = 0.1
    rng = rng_(91)
    for layer in range(4):
        n = 6 if layer < 3 else 4
        for k in range(n):
            y0 = -0.66 + k * (pw + gap)
            dx = rng.uniform(-0.08, 0.08)
            box(m, -L / 2 + dx, L / 2 + dx, y0, y0 + pw, z, z + pt, "planks" if (k + layer) % 3 else "planks_grey",
                skip=("-z",), cells={"-x": "end_pine", "+x": "end_pine"})
        z += pt
        if layer < 3:
            for x in (-1.3, 0.0, 1.3):
                box(m, x - 0.02, x + 0.02, -0.7, 0.7, z, z + 0.035, "wood_dark", skip=("-z",))
            z += 0.035
    return m


def baulks():
    """Squared timber baulks on two sleepers: three below, two on top in the hollows."""
    m = Mesh(ao=1.0)
    L, s = 4.2, 0.3
    for x in (-1.4, 1.4):
        box(m, x - 0.1, x + 0.1, -0.7, 0.7, 0, 0.12, "wood_dark", skip=("-z",))
    for k in range(3):
        y = (k - 1) * (s + 0.05)
        box(m, -L / 2 + 0.1 * k, L / 2 + 0.1 * k, y - s / 2, y + s / 2, 0.12, 0.12 + s, "baulk", skip=("-z",),
            cells={"-x": "end_oak", "+x": "end_oak", "+z": "baulk"})
    for k in range(2):
        y = (k - 0.5) * (s + 0.05)
        with m.at(move(0.15, y, 0.12 + s) @ rot("Z", 0.03 * (1 - 2 * k))):
            box(m, -L / 2 + 0.3, L / 2 - 0.2, -s / 2, s / 2, 0.0, s, "baulk", skip=("-z",), cells={"-x": "end_oak", "+x": "end_oak"})
    return m


def weigh_scale():
    """A decimal weighing scale: the platform on its iron frame, the column and the beam with its
    poise, weights stacked on the foot; a coffee sack on the platform."""
    m = Mesh(ao=1.0)
    box(m, -0.42, 0.42, -0.32, 0.32, 0.0, 0.14, "iron", skip=("-z",))
    box(m, -0.4, 0.4, -0.3, 0.3, 0.14, 0.2, "scale_plate", skip=("-z",))
    box(m, -0.06, 0.06, 0.32, 0.44, 0.0, 1.05, "iron", skip=("-z",))
    box(m, -0.34, 0.34, 0.35, 0.41, 1.05, 1.1, "brass")
    box(m, 0.12, 0.2, 0.34, 0.42, 1.0, 1.14, "iron")
    box(m, -0.4, -0.3, 0.33, 0.43, 0.98, 1.12, "iron")
    for k, (r, h) in enumerate([(0.09, 0.07), (0.075, 0.06), (0.06, 0.05)]):
        z = sum(hh for _, hh in [(0.09, 0.07), (0.075, 0.06), (0.06, 0.05)][:k])
        lathe(m, [(r, z), (r, z + h), (0.02, z + h + 0.012)], 8, "iron", M=move(0.55, 0.2, 0))
    sack_geo(m, 0.0, -0.02, 0.2, 0.08, "sack_coffee", 97, L=0.8, Wd=0.48, Hh=0.28, flat=False)
    return m


def pallet_empty():
    m = Mesh(ao=0.3)
    pallet_geo(m)
    return m


def ground_decal(cell, w, d):
    return sl.ground(cell, w, d)


# ------------------------------------------------------------------ build


# ------------------------------------------------------------------ debris (pass 3: rust, soot, clutter, dirt)


def slats_broken():
    """Slats torn off a crate lying about: none flat on the setts (each propped on the next, askew),
    one snapped in two, the nails still in them."""
    m = Mesh(ao=0.3)
    rng = rng_(801)
    specs = [(-0.2, 0.0, 0.3, 0.9, 0.0), (0.15, 0.25, -0.5, 0.75, 0.045), (0.3, -0.2, 1.2, 0.45, 0.0), (0.62, -0.05, 1.9, 0.38, 0.03)]
    for x, y, yaw, L, z0 in specs:
        pitch = rng.uniform(0.08, 0.16)
        roll = rng.uniform(0.12, 0.25)
        with m.at(move(x, y, z0 + math.sin(pitch) * L / 2 + 0.012) @ rot("Z", yaw) @ rot("Y", pitch) @ rot("X", roll)):
            box(m, -L / 2, L / 2, -0.05, 0.05, -0.009, 0.009, "crate_a_top")
            for nx in (-L / 2 + 0.04, L / 2 - 0.04):
                box(m, nx - 0.004, nx + 0.004, -0.004, 0.004, 0.009, 0.03, "rust")
    return m


def bucket_rusty():
    """A tin bucket rusted through at the foot, its handle down, left standing."""
    m = Mesh(ao=0.3)
    prof = [(0.12, 0.0), (0.135, 0.15), (0.15, 0.3)]
    lathe(m, prof, 10, "rust")
    lathe(m, [(0.11, 0.02), (0.125, 0.15), (0.14, 0.295)], 10, "iron", inward=True, shade=0.6)
    lathe(m, [(0.0, 0.02), (0.11, 0.02)], 10, "dark")
    tube(m, [(0.15 * math.cos(a), 0.15 * math.sin(a), 0.3) for a in np.linspace(0, 2 * math.pi, 10, endpoint=False)], 0.008, "rust", closed=True)
    tube(m, [(-0.15, 0, 0.27), (-0.1, -0.12, 0.2), (0.0, -0.17, 0.17), (0.1, -0.12, 0.2), (0.15, 0, 0.27)], 0.006, "iron")
    return m


def barrel_broken():
    """A cask stove in: the lower half standing open, staves sprung off lying round it, a hoop on the
    ground."""
    m = Mesh(ao=0.5)
    r0, r1, h = 0.27, 0.31, 0.42
    lathe(m, [(r0, 0.0), (r0 + 0.02, 0.12), (r1, h)], 12, "stave_dark")
    lathe(m, [(r0 - 0.025, 0.03), (r0 - 0.005, 0.12), (r1 - 0.025, h - 0.003)], 12, "stave_dark", inward=True, shade=0.55)
    lathe(m, [(r1, h), (r1 - 0.025, h)], 12, "stave_dark", shade=0.8)
    lathe(m, [(0.0, 0.03), (r0 - 0.025, 0.03)], 12, "dark")
    lathe(m, [(r0 + 0.012, 0.06), (r0 + 0.02, 0.1)], 12, "hoop")
    rng = rng_(802)
    for k in range(4):
        a = rng.uniform(0, 2 * math.pi)
        d = rng.uniform(0.45, 0.8)
        pitch = rng.uniform(0.1, 0.25)
        with m.at(move(d * math.cos(a), d * math.sin(a), 0.03 + math.sin(pitch) * 0.4) @ rot("Z", a + rng.uniform(-0.6, 0.6)) @ rot("Y", pitch) @ rot("X", 0.3)):
            box(m, -0.42, 0.42, -0.045, 0.045, -0.012, 0.012, "stave_dark")
    tube(m, [(0.62 + 0.3 * math.cos(a), -0.35 + 0.3 * math.sin(a), 0.012) for a in np.linspace(0, 2 * math.pi, 10, endpoint=False)], 0.012, "hoop", closed=True)
    return m


def fish_crate(m, x, y, z, yaw, shade=1.0, full=True):
    """A shallow slatted fish crate, 0.7 x 0.45 x 0.22, herring in it."""
    with m.at(move(x, y, z) @ rot("Z", yaw)):
        W, D, H = 0.7, 0.45, 0.22
        for sy in (-1, 1):
            box(m, -W / 2, W / 2, sy * D / 2 - 0.012, sy * D / 2 + 0.012, 0.0, H, "wood_grey", skip=("-z",), shade=shade)
        for sx in (-1, 1):
            box(m, sx * W / 2 - 0.012, sx * W / 2 + 0.012, -D / 2 + 0.012, D / 2 - 0.012, 0.0, H, "wood_grey", skip=("-z",), shade=shade)
        # the inside seen from above: the far walls from inside, the fish at 3/4 height
        quad(m, "fish" if full else "dark", (-W / 2 + 0.012, -D / 2 + 0.012, H * 0.7), (W / 2 - 0.012, -D / 2 + 0.012, H * 0.7),
             (W / 2 - 0.012, D / 2 - 0.012, H * 0.7), (-W / 2 + 0.012, D / 2 - 0.012, H * 0.7), (0, 0, 1), shade=shade)


def fish_crates():
    """Fish crates stacked by the fish market: two stacks of two and one on the setts, a crate knocked askew."""
    m = Mesh(ao=0.6)
    H = 0.22
    fish_crate(m, 0, 0, 0, 0.03)
    fish_crate(m, 0.02, 0.01, H, -0.05, full=True, shade=1.05)
    fish_crate(m, 0.78, 0.05, 0, -0.08)
    fish_crate(m, 0.4, 0.62, 0, 0.35, full=False, shade=0.9)
    return m


def rat_dead():
    """A dead rat on its side in the gutter, the tail out behind."""
    m = Mesh()
    blob(m, 0.2, 0.08, 0.07, "rat", 803, e1=0.7, e2=0.8, nu=6, nv=5, slump=0.1, noise=0.005, M=rot("Z", 0.4))
    tube(m, [(-0.09, -0.04, 0.01), (-0.2, -0.1, 0.008), (-0.28, -0.07, 0.008), (-0.34, -0.12, 0.008)], 0.006, "rat_belly")
    return m


def rope_end():
    """A frayed rope end dropped on the setts."""
    m = Mesh()
    pts = [(-0.35 + 0.09 * k, 0.12 * math.sin(k * 1.1), 0.014) for k in range(9)]
    tube(m, pts, 0.014, "rope_tar")
    return m


# ------------------------------------------------------------------ the big blocks (pass 2: the heaps of pictures 1-5)


def casks_pyramid4(stave="stave_oak", headc="head_oak"):
    """Ten casks on their sides, 4-3-2-1, 2.3 m high; chocks at the ends of the bottom row."""
    m = PMesh(ao=2.4)
    rb = 0.33
    w = 2 * rb + 0.03
    dz = math.sqrt((2 * rb) ** 2 - (w / 2) ** 2) - 0.004
    rng = rng_(len(stave) * 7)
    for row, n in enumerate((4, 3, 2, 1)):
        for k in range(n):
            y = (k - (n - 1) / 2) * w
            st = "stave_chalk" if (stave == "stave_oak" and rng.random() < 0.25) else stave
            x, yaw = rng.uniform(-0.04, 0.04), rng.uniform(-0.03, 0.03)
            with m.piece("barrels", move(x, y, row * dz) @ rot("Z", yaw)):
                lying_cask(m, x, y, row * dz, yaw, st, headc,
                           chocks=(row == 0 and k in (0, n - 1)), shade=0.94 + 0.1 * rng.random(), sides=10)
    return m


def sacks_mountain(cells=("sack_coffee", "sack_red", "sack_coffee", "sack_plain")):
    """Sacks piled without a pallet, five layers laid crosswise and stepping in: 2.8 x 2.2 m, 1.4 m high."""
    m = PMesh(ao=1.6)
    H = 0.27
    z = 0.0
    k = 0
    rng = rng_(301)
    for layer in range(5):
        inset = layer * 0.22
        if layer % 2 == 0:
            ny = max(1, 4 - layer // 2)
            span = 2.2 - 2 * inset
            for j in range(ny):
                y = -span / 2 + span * (j + 0.5) / ny
                for x in (-0.62 + inset * 0.3, 0.62 - inset * 0.3) if layer < 4 else (0.0,):
                    sx, syaw = x + rng.uniform(-0.05, 0.05), rng.uniform(-0.08, 0.08)
                    with m.piece("sacks", move(sx, y, z) @ rot("Z", syaw)):
                        sack_geo(m, sx, y, z, syaw, cells[k % len(cells)], 400 + k,
                                 L=1.15, Wd=span / ny + 0.04, Hh=H, flat=(layer == 0))
                    k += 1
        else:
            nx = max(1, 5 - layer)
            span = 2.6 - 2 * inset
            for j in range(nx):
                x = -span / 2 + span * (j + 0.5) / nx
                sy, syaw = rng.uniform(-0.05, 0.05), math.pi / 2 + rng.uniform(-0.08, 0.08)
                # (a long sack laid across, 1.1 to 2 m: heavy when over 1.5 m)
                with m.piece("sacks", move(x, sy, z) @ rot("Z", syaw), heavy=(2.0 - 2 * inset) > 1.5):
                    sack_geo(m, x, sy, z, syaw, cells[k % len(cells)], 400 + k,
                             L=2.0 - 2 * inset, Wd=span / nx + 0.04, Hh=H, flat=False)
                k += 1
        z += H - 0.06
    # two slumped off the side
    with m.piece("sacks", move(1.55, -0.4, 0.0) @ rot("Z", 1.3)):
        sack_geo(m, 1.55, -0.4, 0.0, 1.3, "sack_plain", 480, pitch=-0.15, slump=0.3)
    with m.piece("sacks", move(-1.4, 0.9, 0.0) @ rot("Z", 0.3)):
        sack_geo(m, -1.4, 0.9, 0.0, 0.3, cells[0], 481, slump=0.3)
    return m


def bales_wall(rows=1):
    """Cotton bales stacked three high against a wall (rows deep): 2.0 m wide, 2 m high."""
    m = Mesh(ao=2.2)
    Wd, Hh = 0.62, 0.68
    rng = rng_(500 + rows)
    for r_ in range(rows):
        for lvl in range(3):
            n = 3 if lvl < 2 else 2
            for k in range(n):
                y = (k - (n - 1) / 2) * (Wd + 0.04) + (0.0 if lvl < 2 else rng.uniform(-0.1, 0.1))
                x = r_ * 1.3 + rng.uniform(-0.04, 0.04)
                bale_geo(m, x, y, lvl * (Hh - 0.02), rng.uniform(-0.04, 0.04), 600 + r_ * 10 + lvl * 3 + k, flat=(lvl == 0),
                         shade=0.92 + 0.12 * rng.random())
    return m


def crates_block():
    """A block of crates two deep and three high, the top ragged: 3.2 x 1.5 m, about 1.9 m high."""
    m = PMesh(ao=2.2)
    rng = rng_(700)
    Wa, Da, Ha = CRATES["a"]["size"]
    Wb, Db, Hb = CRATES["b"]["size"]
    # bottom: three big crates along x, two rows
    for row, y in enumerate((-0.37, 0.37)):
        for k in range(3):
            M = move((k - 1) * (Wa + 0.04), y, 0) @ rot("Z", math.pi * (row % 2) + rng.uniform(-0.02, 0.02))
            with m.piece("crates", M, heavy=True), m.at(M):
                crate_geo(m, "a", shade=0.92 + 0.12 * rng.random())
    # middle: long crates across
    for k, x in enumerate((-0.75, 0.75)):
        M = move(x + rng.uniform(-0.05, 0.05), rng.uniform(-0.04, 0.04), Ha) @ rot("Z", math.pi / 2 + rng.uniform(-0.03, 0.03))
        with m.piece("crates", M, heavy=True), m.at(M):
            crate_geo(m, "c", shade=0.95 + 0.1 * rng.random())
    # top: two LIVERPOOL crates and a small one, not squared up
    Wc, Dc, Hc = CRATES["c"]["size"]
    for x, kind, yaw in ((-0.7, "b", 0.1), (0.55, "b", -0.08), (1.3, "s", 0.3)):
        M = move(x, rng.uniform(-0.1, 0.1), Ha + Wc * 0 + Hc) @ rot("Z", yaw)
        with m.piece("crates", M), m.at(M):
            crate_geo(m, kind, shade=1.0 + 0.06 * rng.random())
    return m


def tarp_big():
    """A big stack under a tarred tarpaulin: crates and casks, 3.4 x 1.9 m, 2 m high."""
    return tarp_heap([(-1.5, 1.5, -0.8, 0.8, 1.45), (-1.3, 0.2, -0.6, 0.6, 2.0), (0.4, 1.3, -0.5, 0.55, 1.75)], "tarp_green", 63, ropes=4)


def tarp_big_brown():
    return tarp_heap([(-1.4, 1.4, -0.75, 0.75, 1.3), (-0.6, 1.2, -0.55, 0.5, 1.9)], "tarp_brown", 64, ropes=3)


def build_models():
    return [
        ("crate_a", crate("a")), ("crate_b", crate("b")), ("crate_c", crate("c")), ("crate_s", crate("s")),
        ("crate_open", crate_open()), ("crates_tied", crates_tied()), ("crate_column", crate_column()),
        ("cask", cask("stave_chalk")), ("cask_dark", cask("stave_dark", "head_dark")), ("cask_blue", cask("stave_blue", "head_blue")),
        ("cask_big", cask_big()), ("crate_roped", crate_roped()),
        ("casks_pyramid4", casks_pyramid4()), ("casks_pyramid4_blue", casks_pyramid4("stave_blue", "head_blue")),
        ("sacks_mountain", sacks_mountain()), ("sacks_mountain_grain", sacks_mountain(("sack_grain", "sack_plain", "sack_grain"))),
        ("bales_wall", bales_wall(1)), ("bales_block", bales_wall(2)), ("crates_block", crates_block()),
        ("tarp_big", tarp_big()), ("tarp_big_brown", tarp_big_brown()),
        ("slats_broken", slats_broken()), ("bucket_rusty", bucket_rusty()), ("barrel_broken", barrel_broken()),
        ("fish_crates", fish_crates()), ("rat_dead", rat_dead()), ("rope_end", rope_end()),
        ("d_muck", ground_decal("muck", 1.4, 1.1)), ("d_tar", ground_decal("tar", 0.9, 0.9)),
        ("d_straw_rot", ground_decal("straw_rot", 1.5, 1.2)), ("d_rust", ground_decal("rust_stain", 0.8, 0.8)),
        ("keg", cask("stave_dark", "head_dark", 0.18, 0.22, 0.55)),
        ("cask_lying", cask_lying()), ("casks_pyramid", casks_pyramid()), ("casks_pyramid_blue", casks_pyramid("stave_blue", "head_blue")),
        ("casks_group", casks_group()),
        ("sack", sack_lying()), ("sack_standing", sack_standing()), ("sacks_heap", sacks_heap()),
        ("sacks_pallet", sacks_pallet()), ("sacks_pallet_grain", sacks_pallet(("sack_grain", "sack_plain", "sack_grain"))),
        ("bale", bale()), ("bales_stack", bales_stack()),
        ("tarp_crates", tarp_crates()), ("tarp_casks", tarp_casks()),
        ("rope_coil", rope_coil()), ("rope_coil_tar", rope_coil("coil_tar")), ("rope_loose", rope_loose()), ("cable_drum", cable_drum()),
        ("ropewalk", ropewalk()),
        ("baskets", baskets()), ("basket", basket_one()), ("hamper", hamper()),
        ("handcart", handcart()), ("handcart_loaded", tagged("handcart_loaded", handcart_loaded)), ("sack_truck", tagged("sack_truck", sack_truck)),
        ("planks_stack", planks_stack()), ("baulks", baulks()), ("weigh_scale", tagged("weigh_scale", weigh_scale)), ("pallet", pallet_empty()),
        ("handcart_loaded_bare", bared(handcart_loaded)), ("sack_truck_bare", bared(sack_truck)), ("weigh_scale_bare", bared(weigh_scale)),
        ("d_straw_a", ground_decal("straw_a", 1.8, 1.3)), ("d_straw_b", ground_decal("straw_b", 1.2, 0.8)),
        ("d_grain", ground_decal("grain", 0.9, 0.9)), ("d_coffee", ground_decal("coffee", 0.7, 0.7)),
        ("d_oil", ground_decal("oil", 1.3, 1.3)), ("d_dirt", ground_decal("dirt", 2.2, 1.4)),
    ]


def preview(objs):
    cam = sl.stage()
    names = list(objs)
    per = 9
    rows = [names[i:i + per] for i in range(0, len(names), per)]
    for r, row in enumerate(rows):
        x = 0.0
        for n in row:
            o = objs[n]
            o.location = (0, 0, 0)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            o.location = (x - lo, r * 4.5, 0)
            x += hi - lo + 0.5
        for n in row:
            objs[n].location.x -= x / 2
    bpy.context.view_layer.update()
    for mt in bpy.data.materials:
        if mt.name.startswith("qg_"):
            nt = mt.node_tree
            bsdf = nt.nodes.get("Principled BSDF")
            tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
            vc = nt.nodes.new("ShaderNodeVertexColor")
            vc.layer_name = "Col"
            mix = nt.nodes.new("ShaderNodeMix")
            mix.data_type = "RGBA"
            mix.blend_type = "MULTIPLY"
            mix.inputs[0].default_value = 1.0
            nt.links.new(tex.outputs["Color"], mix.inputs[6])
            nt.links.new(vc.outputs["Color"], mix.inputs[7])
            nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
            try:
                mt.surface_render_method = "DITHERED"
            except AttributeError:
                pass
    sl.aim(cam, (0, -14, 9), (0, 8, 0.8), lens=20)
    sl.render(os.path.join(SHOTS, "quaygoods_models.png"), (2200, 1300))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    build_atlases()
    save_surface_atlas()
    make_materials()
    objs = {}
    counts = {}
    pieces = 0
    models = build_models()
    with open(os.path.join(ROOT, "client", "src", "world", "quaygoods_sack_sockets.json"), "w", encoding="utf-8") as f:
        json.dump(QG_SOCKETS, f, separators=(",", ":"))
    for name, mesh in models:
        if isinstance(mesh, PMesh) and mesh.pieces:
            # M8f goods pass 2: each cask, crate and sack its own node in its own frame, and the rest
            for oname, ob in split_pieces(name, mesh):
                objs[oname] = ob
                counts[oname] = sl.tris(ob)
                pieces += 1
            continue
        goods = getattr(mesh, "goods", None)
        objs[name] = mesh.to_object(name)
        if goods:
            objs[name]["qg_goods"] = goods[0]
            objs[name]["qg_heavy"] = 1 if goods[1] else 0
        counts[name] = sl.tris(objs[name])
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_quaygoods] {n:20s} {c:5d} tris")
    print(f"[build_quaygoods] atlas {sl.SOLID_ATLAS.W}x{sl.SOLID_ATLAS.H}, decals {sl.DECAL_ATLAS.W}x{sl.DECAL_ATLAS.H}")
    print(f"[build_quaygoods] {len(objs)} models ({pieces} pieces of heaps), {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()
