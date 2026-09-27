"""The goods wagons of the quay railway (Antwerp, 1873), modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_wagons.py
    blender -b --factory-startup -P tools/blender/build_wagons.py -- --closeup wagon_open out.png [azimuth] [elevation] [distance]
    blender -b --factory-startup -P tools/blender/build_wagons.py -- --sheet [prefix]

Writes client/public/models/wagons.glb (Draco). One node per part the game instances
(client/src/world/railway.ts): wagon_open, wagon_flat, wagon_van, wheelset, coupling and the
goods units goods_sacks, goods_casks, goods_bales, goods_crates.

Frames are the game's (railway.ts): a wagon's origin is on the ground (y 0; the rail tops at
RAIL_TOP) at its middle, +z (the game's) toward the front, which is -Y in Blender; the wheel
set's origin is on its axle, the axle along x; the coupling is 1 m long along z, its ends at
z -0.5 and +0.5 (the game scales it to the gap between two draw hooks); a goods unit stands on
its origin. The numbers the game relies on are kept (docs/milestones/vehicle-detail.md): FLOOR,
L_BODY, L_BUF, WB, WHEEL_R, RAIL_TOP, the sides at x +-1.22, the open wagon's side height, the
draw hooks where the coupling ends (z +-3.0, y 0.98).

Four-wheeled wagons of about 1870 as the Belgian State lines ran them: oak solebars with bolt
heads, red headstocks, W-iron axle guards with grease axle boxes, leaf springs on shackles, a
hand-lever brake with its rack on one side, spring buffers on square plates, draw hooks and a
three-link coupling, iron spoked wheels with tyres and flanges. Painted lettering (ETAT BELGE,
a number, the load and the tare), no firm's marks.

Everything is our own work: shapes from code, textures painted here (64 px cells in a 4 x 4
atlas, nearest filter). The wagon parts use the atlas "wagons"; the goods units use the props'
goods atlas (tools/blender/build_props.py paint_atlas, material "goods"), so in the game they
share the props' material. No downloaded models or images.
"""

import math
import os
import sys
from contextlib import contextmanager

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_props as BP  # noqa: E402  (painters and the goods atlas's cells; its main() does not run)

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "wagons.glb")
SHOTS = os.path.join(ROOT, "data", "shots")

# --- the game's numbers (client/src/world/railway.ts)
WHEEL_R = 0.5
RAIL_TOP = 0.035
AXLE_Y = RAIL_TOP + WHEEL_R
FLOOR = 1.12
L_BODY = 5.4
L_BUF = 6.3
WB = 3.0
E = L_BODY / 2
SIDE_X = 1.22  # the sides' middle
SIDE_T = 0.07
OPEN_H = 0.82
VAN_H = 2.0
HOOK = (0.98, 3.0)  # y, z of the draw hook's throat (the coupling's end)
GAUGE = 1.435
WHEEL_X = 0.735  # a wheel's middle across (the tread runs over the rail at x 0.7175)
BOX_X = 1.135  # the axle boxes' middle (their face outboard of the axle guard, the spring on top)

S = 64
N = 4
MATS = ["wagons", "goods"]

# --- the wagon atlas: 4 x 4 cells of 64 px
CELLS = ["paint", "bare", "iron", "red", "strap", "sole", "l_open", "l_flat",
         "l_van", "canvas", "bright", "oak", "boxface", "door", "rust", "black"]
(PAINT, BARE, IRON, RED, STRAP, SOLE, L_OPEN, L_FLAT,
 L_VAN, CANVAS, BRIGHT, OAK, BOXFACE, DOOR, RUST, BLACK) = range(len(CELLS))
# the props' goods atlas (build_props.CELLS), as cells 100 + k
G = {name: 100 + k for k, name in enumerate(BP.CELLS)}

# colours
C_PAINT = (0.37, 0.33, 0.285)  # a warm brown-grey, the State's goods stock
C_RED = (0.56, 0.19, 0.12)  # red lead
C_INK = (0.86, 0.83, 0.74)  # the lettering

# ------------------------------------------------------------------ textures

GLYPHS = dict(BP.GLYPHS)
GLYPHS.update({
    "B": ["110", "101", "110", "101", "110"], "G": ["011", "100", "101", "101", "011"], "D": ["110", "101", "101", "101", "110"],
    "M": ["101", "111", "111", "101", "101"], "U": ["101", "101", "101", "101", "111"], "X": ["101", "101", "010", "101", "101"],
    "F": ["111", "100", "110", "100", "100"], "Y": ["101", "101", "010", "010", "010"], " ": ["000"] * 5,
})


def text(img, s, u0, v0, ink, sx=1, sy=2, wear=0.9, seed=0):
    """Letters on an array [v, u] (row 0 = the bottom): upright, left to right; glyphs 3 x 5, scaled sx, sy."""
    rng = np.random.default_rng(seed)
    h, w = img.shape[:2]
    u = u0
    for ch in s:
        g = GLYPHS.get(ch)
        if g:
            for gy, row in enumerate(g):
                for gx, bit in enumerate(row):
                    if bit != "1":
                        continue
                    for a in range(sy):
                        for b in range(sx):
                            vv = v0 + (4 - gy) * sy + a
                            uu = u + gx * sx + b
                            if 0 <= vv < h and 0 <= uu < w and rng.random() < wear:
                                img[vv, uu] = img[vv, uu] * 0.15 + np.array(ink) * 0.85
        u += 4 * sx
    return img


def text_w(s, sx=1):
    return len(s) * 4 * sx - sx


def paint_painted(seed, paint, boards=4):
    """Boards painted over: the paint's colour, the boards' seams and grain showing through, worn at the edges."""
    rng = np.random.default_rng(seed)
    wood = BP.paint_planks(seed, (0.45, 0.38, 0.29), boards=boards, seams=True, joints=True, knots=1)
    lum = wood.mean(-1, keepdims=True) / wood.mean()
    img = BP.col(paint) * (0.7 + 0.3 * lum)
    worn = np.clip((BP.vnoise(rng, S, 6, 10) - 0.68) * 5, 0, 1)[..., None]
    img = img * (1 - worn * 0.7) + wood * worn * 0.7
    grime = BP.vnoise(rng, S, 3, 4)[..., None]
    img *= 0.88 + 0.16 * grime
    return BP.speckle(img, rng, 0.03, 0.7, 0.95)


def paint_red(seed):
    rng = np.random.default_rng(seed)
    img = BP.col(C_RED) * (0.85 + 0.25 * BP.vnoise(rng, S, 8, 8))[..., None]
    grain = BP.vnoise(rng, S, 2, 24)
    img *= (0.9 + 0.15 * grain)[..., None]
    dirt = np.clip((BP.vnoise(rng, S, 5, 5) - 0.55) * 3, 0, 1)[..., None]
    img = img * (1 - 0.5 * dirt) + BP.col((0.16, 0.12, 0.1)) * 0.5 * dirt
    return BP.speckle(img, rng, 0.05, 0.6, 0.9)


def paint_strap(seed):
    """A flat iron bar, 0.15 m of it: black, rust in patches, one round bolt head in the middle (the strap's uv is metric,
    0.15 m a tile along, and centred across, so the heads stay round and in a row down the middle)."""
    rng = np.random.default_rng(seed)
    img = BP.paint_iron(seed).copy() * 0.9
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    d = np.hypot(uu - 32, vv - 32)
    head = d < 7.5
    lit = np.clip(1.25 - ((uu - 29) + (vv - 35) * -1) * 0.03, 0.7, 1.4)
    img[head] = BP.col((0.2, 0.19, 0.18)) * lit[head][:, None]
    img[(d >= 7.5) & (d < 9.0)] *= 0.45
    return BP.speckle(img, rng, 0.04, 0.7, 0.9)


def paint_sole(seed):
    """The solebar's outer face: one painted timber (1.2 m a tile along, its height over v), a row of bolt heads
    near the top and the bottom every 0.3 m (a head 2 px along by 6 px up: round on the timber)."""
    rng = np.random.default_rng(seed)
    img = paint_painted(seed, C_PAINT, boards=1)
    img *= 0.9
    img[:2] *= 0.55
    img[-2:] *= 0.6
    for v in (10, 52):
        for u in range(8, S, 16):
            img[v - 3:v + 3, u:u + 2] = BP.col((0.12, 0.11, 0.1))
            img[v + 1:v + 3, u] = BP.col((0.22, 0.21, 0.2))
            img[v - 4, u:u + 2] *= 0.5
    return BP.speckle(img, rng, 0.02, 0.7, 0.95)


def paint_letters(seed, lines, base="paint"):
    """Painted boards (as the "paint" cell, so they carry on round it) with lettering, one line per board
    (4 boards of 16 px, the top board first). A line: (text, sx, sy)."""
    img = paint_painted(1, C_PAINT) if base == "paint" else paint_sole_band(seed)
    for k, (s, sx, sy) in enumerate(lines):
        if not s:
            continue
        v0 = (3 - k) * 16 + (16 - 5 * sy) // 2
        u0 = (S - text_w(s, sx)) // 2
        text(img, s, u0, v0, C_INK, sx, sy, seed=seed + k)
    return img


def paint_sole_band(seed):
    """Four bands of the solebar's face (a band = 16 px, mapped over the timber's height)."""
    band = paint_sole(5)[::4]  # the timber squeezed to 16 px, bolt rows kept
    return np.concatenate([band] * 4, axis=0)


def paint_canvas(seed):
    """The van's roof: canvas, painted a pale grey, the paint cracked and dirty, a seam every 32 px along v."""
    rng = np.random.default_rng(seed)
    img = BP.col((0.52, 0.52, 0.49)) * (0.82 + 0.3 * BP.vnoise(rng, S, 4, 4))[..., None]
    weave = np.where((np.add.outer(np.arange(S), np.arange(S)) % 2) == 0, 0.04, -0.03)
    img *= (1 + weave)[..., None]
    soot = BP.vnoise(rng, S, 3, 6)[..., None]
    img *= 0.8 + 0.25 * soot
    img[::32] *= 0.55
    img[1::32] *= 1.15
    cracks = rng.random((S, S)) < 0.03
    img[cracks] *= 0.6
    return img


def paint_bright(seed):
    rng = np.random.default_rng(seed)
    img = BP.col((0.36, 0.35, 0.34)) * (0.85 + 0.3 * BP.vnoise(rng, S, 16, 3))[..., None]
    return BP.speckle(img, rng, 0.08, 0.7, 0.9)


def paint_boxface(seed):
    """The axle box's face: cast iron, a raised round cover with a bolt, the maker's number cast in."""
    rng = np.random.default_rng(seed)
    img = BP.paint_iron(seed).copy()
    uu, vv = np.meshgrid(np.arange(S), np.arange(S))
    d = np.hypot(uu - 32, vv - 30)
    img[(d > 17) & (d < 20)] *= 1.7
    img[(d >= 20) & (d < 22)] *= 0.55
    img[d < 4] = BP.col((0.25, 0.24, 0.22))
    img[:3] *= 0.6
    img[-3:] *= 0.6
    img[:, :3] *= 0.6
    img[:, -3:] *= 0.6
    text(img, "EB", 26, 50, (0.3, 0.29, 0.27), 1, 1, seed=seed)
    return BP.speckle(img, rng, 0.03, 0.7, 0.9)


def paint_door(seed):
    """The van's sliding door: vertical boards (along v), painted, a diagonal brace's shadow left to the geometry."""
    img = np.transpose(paint_painted(seed, C_PAINT, boards=5), (1, 0, 2)).copy()
    return img


def paint_rust(seed):
    rng = np.random.default_rng(seed)
    n = BP.vnoise(rng, S, 8, 8)
    img = BP.col((0.3, 0.17, 0.1)) * (0.7 + 0.5 * n)[..., None]
    return BP.speckle(img, rng, 0.1, 0.5, 0.8)


def paint_black(seed):
    rng = np.random.default_rng(seed)
    img = BP.col((0.09, 0.09, 0.09)) * (0.85 + 0.3 * BP.vnoise(rng, S, 8, 8))[..., None]
    return BP.speckle(img, rng, 0.05, 0.6, 0.9)


def paint_wagon_atlas():
    cells = {
        "paint": paint_painted(1, C_PAINT),
        "bare": BP.paint_planks(2, (0.47, 0.41, 0.33), boards=4, seams=True, joints=True, knots=3),
        "iron": BP.paint_iron(3),
        "red": paint_red(4),
        "strap": paint_strap(6),
        "sole": paint_sole(5),
        "l_open": paint_letters(7, [("ETAT BELGE", 1, 2), ("N 3127", 1, 2), ("", 1, 1), ("10000 K  T 4850", 1, 1)]),
        "l_flat": paint_letters(8, [("ETAT BELGE 2214", 1, 2), ("10000 K T 4200", 1, 2), ("", 1, 1), ("", 1, 1)], base="sole"),
        "l_van": paint_letters(9, [("ETAT BELGE", 1, 2), ("N 812", 1, 2), ("", 1, 1), ("8000 K  T 5900", 1, 1)]),
        "canvas": paint_canvas(10),
        "bright": paint_bright(11),
        "oak": BP.paint_planks(12, (0.3, 0.24, 0.18), boards=2, seams=False, joints=False, knots=1),
        "boxface": paint_boxface(13),
        "door": paint_door(14),
        "rust": paint_rust(15),
        "black": paint_black(16),
    }
    out = np.zeros((S * N, S * N, 3))
    for k, name in enumerate(CELLS):
        c, r = k % N, k // N
        out[(N - 1 - r) * S:(N - r) * S, c * S:(c + 1) * S] = cells[name]
    return out


def image(name, arr):
    h, w, _ = arr.shape
    img = bpy.data.images.new(name, w, h, alpha=False)
    rgba = np.ones((h, w, 4), dtype=np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def make_materials():
    # the wagons' own atlas goes into the file; the goods material is the props' (the game uses props.glb's),
    # so it goes out without a picture (the preview gives it one)
    m = bpy.data.materials.new("wagons")
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = image("wagons_tex", paint_wagon_atlas())
    t.interpolation = "Closest"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 1.0
    g = bpy.data.materials.new("goods")
    g.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = 1.0


# ------------------------------------------------------------------ geometry


HEX_FACES = BP.HEX_FACES
newell = BP.newell


def metric_uv(pts, tile):
    return BP.planar_uv(pts, tile, "metric")


# game (x, y up, z front) -> Blender (x, -z, y)
GAME = Matrix.Rotation(math.pi / 2, 4, "X")


def move(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def rot(axis, a):
    return Matrix.Rotation(a, 4, axis)


TILE = {PAINT: 0.8, BARE: 0.8, IRON: 0.5, RED: 0.6, STRAP: 0.6, SOLE: 1.2, CANVAS: 1.2, BRIGHT: 0.3, OAK: 0.6,
        BOXFACE: 0.2, DOOR: 0.8, RUST: 0.5, BLACK: 0.5}


class Mesh:
    """bmesh builder; every face is an atlas face: material 0 (wagons) or 1 (goods), its cell in the uv set "Cell"."""

    def __init__(self, ao=0.35):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.cell = self.bm.loops.layers.uv.new("Cell")
        self.xf = GAME.copy()
        self.ao = ao
        self.mat = None

    @contextmanager
    def at(self, M):
        old = self.xf
        self.xf = old @ M
        try:
            yield
        finally:
            self.xf = old

    def vert(self, p):
        return self.bm.verts.new(self.xf @ Vector(p))

    def face(self, vs, uvs, cell, shade=1.0, smooth=False):
        try:
            f = self.bm.faces.new(vs)
        except ValueError:
            return None
        mi, k = (1, cell - 100) if cell >= 100 else (0, cell)
        if self.mat is None:
            self.mat = mi
        elif self.mat != mi:
            raise ValueError("a part is either wagon or goods, not both")
        f.material_index = mi
        f.smooth = smooth
        for loop, uv in zip(f.loops, uvs):
            loop[self.uv].uv = uv
            loop[self.cell].uv = (k % N, k // N)
            s = shade
            if self.ao > 0:
                s *= 0.55 + 0.45 * min(1.0, max(0.0, loop.vert.co.z / self.ao))
            loop[self.col] = (s, s, s, 1.0)
        return f

    def poly(self, pts, cell, out=None, shade=1.0, tile=None, uvs=None, uvf=None):
        pts = [Vector(p) for p in pts]
        if out is not None and newell(pts).dot(Vector(out)) < 0:
            pts = pts[::-1]
            if uvs:
                uvs = uvs[::-1]
        if uvf:
            uvs = [uvf(p) for p in pts]
        if not uvs:
            uvs = metric_uv(pts, tile or (TILE.get(cell, 1.0) if cell < 100 else 1.0))
        return self.face([self.vert(p) for p in pts], uvs, cell, shade)

    def hexa(self, P, cell, shade=1.0, tile=None, skip=(), cells=None, uvfs=None):
        P = [Vector(p) for p in P]
        vs = [self.vert(p) for p in P]
        for key, idx in HEX_FACES.items():
            if key in skip:
                continue
            pts = [P[i] for i in idx]
            c = (cells or {}).get(key, cell)
            uvf = (uvfs or {}).get(key)
            uvs = [uvf(p) for p in pts] if uvf else metric_uv(pts, tile or (TILE.get(c, 1.0) if c < 100 else 1.0))
            self.face([vs[i] for i in idx], uvs, c, shade)

    def box(self, x0, x1, y0, y1, z0, z1, cell, shade=1.0, tile=None, skip=(), cells=None, uvfs=None):
        """An axis-aligned box in the game's frame. skip/cells/uvfs by face: "-x", "+x", "-y" (down), "+y" (up), "-z", "+z" (front)."""
        # hexa's keys are in its own corner order (x + 2y + 4z); in the game frame y is up and z is along
        P = [(x1 if i & 1 else x0, y1 if i & 2 else y0, z1 if i & 4 else z0) for i in range(8)]
        self.hexa(P, cell, shade, tile, skip, cells, uvfs)

    def beam(self, a, b, w, h, cell, side=None, shade=1.0, tile=None, caps=True, w2=None, h2=None):
        a, b = Vector(a), Vector(b)
        t = (b - a).normalized()
        if side is None:
            s = Vector((0, 1, 0)).cross(t)
            if s.length < 1e-4:
                s = Vector((1, 0, 0))
        else:
            s = Vector(side)
            s = s - t * s.dot(t)
            if s.length < 1e-4:
                s = t.orthogonal()
        s.normalize()
        k = s.cross(t)
        w2 = w if w2 is None else w2
        h2 = h if h2 is None else h2
        P = []
        for i in range(8):
            base, ww, hh = (b, w2, h2) if i & 2 else (a, w, h)
            P.append(base + s * (ww / 2 if i & 1 else -ww / 2) + k * (hh / 2 if i & 4 else -hh / 2))
        self.hexa(P, cell, shade, tile, () if caps else ("-y", "+y"))

    def grid(self, rings, cell, closed=True, smooth=False, shade=1.0, cap0=False, cap1=False, urep=1.0, vscale=1.0,
             cells=None, closed_v=False, cap_cell=None, cap_tile=None, uvfn=None):
        rings = [[Vector(p) for p in r] for r in rings]
        n = len(rings[0])
        V = [[self.vert(p) for p in r] for r in rings]
        seq = list(range(len(rings))) + ([0] if closed_v else [])
        vv = [0.0]
        for a, b in zip(seq, seq[1:]):
            vv.append(vv[-1] + sum((rings[b][i] - rings[a][i]).length for i in range(n)) / n)
        for j in range(len(seq) - 1):
            ja, jb = seq[j], seq[j + 1]
            c = cells[j] if cells else cell
            for i in range(n if closed else n - 1):
                i1 = (i + 1) % n
                idx = [(ja, i), (ja, i1), (jb, i1), (jb, i)]
                if uvfn:
                    uvs = [uvfn(rings[a][b], a, b) for a, b in idx]
                else:
                    u0, u1 = i / n * urep, (i + 1) / n * urep
                    uvs = [(u0, vv[j] * vscale), (u1, vv[j] * vscale), (u1, vv[j + 1] * vscale), (u0, vv[j + 1] * vscale)]
                self.face([V[a][b] for a, b in idx], uvs, c, shade, smooth)
        cc = cell if cap_cell is None else cap_cell
        if cap0:
            c0, c1 = sum(rings[0], Vector()) / n, sum(rings[1], Vector()) / n
            self.poly(rings[0], cc, out=c0 - c1, shade=shade, tile=cap_tile)
        if cap1:
            c0, c1 = sum(rings[-1], Vector()) / n, sum(rings[-2], Vector()) / n
            self.poly(rings[-1], cc, out=c0 - c1, shade=shade, tile=cap_tile)

    def lathe(self, prof, sides, cell, rot=0.0, **kw):
        """Turned about the local +z axis; profile (r, z) up the outside (counter-clockwise in r-z)."""
        rings = [[(r * math.cos(rot + 2 * math.pi * i / sides), r * math.sin(rot + 2 * math.pi * i / sides), z)
                  for i in range(sides)] for r, z in prof]
        self.grid(rings, cell, **kw)

    def tube(self, path, radii, sides, cell, side=(1, 0, 0), rot=0.0, closed_path=False, **kw):
        path = [Vector(p) for p in path]
        n = len(path)
        rings = []
        for k, p in enumerate(path):
            if closed_path:
                t = path[(k + 1) % n] - path[(k - 1) % n]
            else:
                t = path[min(k + 1, n - 1)] - path[max(k - 1, 0)]
            t.normalize()
            s = Vector(side)
            s = s - t * s.dot(t)
            if s.length < 1e-4:
                s = t.orthogonal()
            s.normalize()
            b = t.cross(s)
            r = radii[k] if isinstance(radii, (list, tuple)) else radii
            rx, ry = r if isinstance(r, tuple) else (r, r)
            rings.append([p + s * rx * math.cos(rot + 2 * math.pi * i / sides) + b * ry * math.sin(rot + 2 * math.pi * i / sides)
                          for i in range(sides)])
        self.grid(rings, cell, closed_v=closed_path, **kw)

    def prism_x(self, pts_zy, x0, x1, cell, shade=1.0, tile=None, side_cell=None):
        """An outline in the z-y plane (points (z, y)) pushed from x0 to x1: a flat plate across."""
        c = sum((Vector((0, y, z)) for z, y in pts_zy), Vector()) / len(pts_zy)
        a = [Vector((x0, y, z)) for z, y in pts_zy]
        b = [Vector((x1, y, z)) for z, y in pts_zy]
        self.poly(a, cell, out=(-1, 0, 0), shade=shade, tile=tile)
        self.poly(b, cell, out=(1, 0, 0), shade=shade, tile=tile)
        sc = cell if side_cell is None else side_cell
        # each edge faces out of the outline by the outline's own turn (a thin curved band has its middle off the edges)
        n = len(pts_zy)
        area = sum(pts_zy[i][0] * pts_zy[(i + 1) % n][1] - pts_zy[(i + 1) % n][0] * pts_zy[i][1] for i in range(n))
        for i in range(n):
            j = (i + 1) % n
            du = pts_zy[j][0] - pts_zy[i][0]
            dv = pts_zy[j][1] - pts_zy[i][1]
            nu, nv = (dv, -du) if area > 0 else (-dv, du)
            self.poly([a[i], a[j], b[j], b[i]], sc, out=(0, nv, nu), shade=shade, tile=tile)

    def to_object(self, name):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in MATS:
            me.materials.append(bpy.data.materials[m])
        try:
            me.color_attributes.active_color = me.color_attributes["Col"]
            me.color_attributes.render_color_index = me.color_attributes.active_color_index
        except (KeyError, AttributeError):
            pass
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


# ------------------------------------------------------------------ small parts


def strap(m, a, b, w, out, t=0.012, bolts=True, shade=1.0, cell=STRAP):
    """A flat iron bar from a to b lying on a surface that looks along `out`: the outer face shows bolt heads."""
    a, b, out = Vector(a), Vector(b), Vector(out).normalized()
    d = b - a
    L = d.length
    along = d / L
    s = out.cross(along).normalized()
    P = [a - s * w / 2, b - s * w / 2, b + s * w / 2, a + s * w / 2]
    top = [p + out * t for p in P]
    rep = L / 0.15
    hv = w / 0.3
    uvs = [(0.0, 0.5 - hv), (rep, 0.5 - hv), (rep, 0.5 + hv), (0.0, 0.5 + hv)] if bolts else None
    m.poly(top, cell if bolts else IRON, out=out, shade=shade, uvs=uvs)
    for i in range(4):
        j = (i + 1) % 4
        mid = (P[i] + P[j]) / 2
        c = (P[0] + P[2]) / 2
        m.poly([P[i], P[j], top[j], top[i]], IRON, out=mid - c, shade=shade)


def bolt(m, p, out, r=0.018, h=0.012, shade=1.0):
    """A square bolt head (a nut) on a surface looking along out."""
    p, out = Vector(p), Vector(out).normalized()
    u = out.orthogonal().normalized()
    v = out.cross(u)
    P = [p + (u * (r if i & 1 else -r)) + (v * (r if i & 2 else -r)) for i in range(4)]
    Q = [q + out * h for q in P]
    m.poly([Q[0], Q[1], Q[3], Q[2]], IRON, out=out, shade=shade * 1.2)
    for i, j in ((0, 1), (1, 3), (3, 2), (2, 0)):
        mid = (P[i] + P[j]) / 2
        m.poly([P[i], P[j], Q[j], Q[i]], IRON, out=mid - p, shade=shade)


def cyl_z(m, x, y, z0, z1, r, sides, cell, cap0=True, cap1=True, shade=1.0, cells=None, r1=None):
    """A cylinder along the game's z."""
    r1 = r if r1 is None else r1
    with m.at(move(x, y, 0)):
        m.lathe([(r, z0), (r1, z1)], sides, cell, cap0=cap0, cap1=cap1, shade=shade)


def cyl_x(m, y, z, x0, x1, r, sides, cell, cap0=True, cap1=True, shade=1.0):
    """A cylinder along the game's x."""
    with m.at(move(0, y, z) @ rot("Y", math.pi / 2)):
        # local z -> game x
        m.lathe([(r, x0), (r, x1)], sides, cell, cap0=cap0, cap1=cap1, shade=shade)


# ------------------------------------------------------------------ the underframe


def solebar_uv(s):
    """The solebar's outer face: u along (reads left to right from outside), v over its height."""
    y0, y1 = 0.8, 1.07

    def f(p):
        return (-s * p.z / TILE[SOLE], 0.02 + 0.96 * (p.y - y0) / (y1 - y0))
    return f


SOLE_Y = (0.8, 1.07)


def solebar(m, s, kind):
    """Oak, painted, bolted; in pieces along z so the flat wagon's lettering is part of its face (bands of l_flat)."""
    x0, x1 = sorted((s * 0.99, s * 1.11))
    key = "+x" if s > 0 else "-x"
    y0, y1 = SOLE_Y
    z0, z1 = -E + 0.16, E - 0.16
    cuts = [(z0, -0.9, None), (-0.9, 0.9, 0), (0.9, z1, None)] if kind == "flat" else [(z0, z1, None)]
    for za, zb, band in cuts:
        if band is None:
            uvo, c = solebar_uv(s), SOLE
        else:
            v0 = 1 - (band + 1) * 0.25 + 0.004
            v1 = 1 - band * 0.25 - 0.004

            def uvo(p, za=za, zb=zb, v0=v0, v1=v1):
                t = (p.z - za) / (zb - za)
                u = 1 - t if s > 0 else t
                return (0.003 + 0.994 * u, v0 + (v1 - v0) * (p.y - y0) / (y1 - y0))
            c = L_FLAT
        skip = ["+y"]
        if za > z0:
            skip.append("-z")
        if zb < z1:
            skip.append("+z")
        m.box(x0, x1, y0, y1, za, zb, SOLE, shade=0.9, cells={key: c, "-y": OAK}, uvfs={key: uvo}, skip=tuple(skip))


def underframe(m, kind):
    UND = 0.62  # the shade under the floor
    for s in (-1, 1):
        solebar(m, s, kind)
    # headstocks (buffer beams): red lead, the floor boards' ends lie on them
    for s in (-1, 1):
        z0, z1 = sorted((s * (E - 0.16), s * E))
        m.box(-1.3, 1.3, 0.8, 1.07, z0, z1, RED, shade=0.95)
        for x in (-1.05, 1.05):
            for y in (0.87, 1.0):
                bolt(m, (x, y, s * E), (0, 0, s), r=0.018)
    # middle longitudinals (the draw gear runs between them), cross bearers, diagonal braces: under the floor
    for x in (-0.42, 0.42):
        m.box(x - 0.05, x + 0.05, 0.86, 1.07, -E + 0.16, E - 0.16, OAK, shade=UND, skip=("-z", "+z", "+y"))
    for z in (-0.75, 0.75):
        m.box(-0.99, 0.99, 0.9, 1.07, z - 0.05, z + 0.05, OAK, shade=UND, skip=("+y",))
    for sz in (-1, 1):
        for sx in (-1, 1):
            m.beam((sx * 0.94, 0.95, sz * (E - 0.2)), (sx * 0.47, 0.95, sz * 0.82), 0.08, 0.12, OAK, side=(0, 1, 0), shade=UND)
    # the floor: boards along, their ends on the headstocks
    m.box(-1.255, 1.255, 1.07, FLOOR, -E, E, BARE, shade=1.0, cells={"-y": OAK},
          uvfs={"+y": lambda p: (p.z / 0.8, p.x / 0.8)}, skip=("-y",))
    # axle guards (W-irons), axle boxes, springs with their shackles and hangers
    for s in (-1, 1):
        for za in (-WB / 2, WB / 2):
            axle_guard(m, s, za)
    # buffers and draw hooks
    for sz in (-1, 1):
        end_gear(m, sz)
    # corner steps
    for sz in (-1, 1):
        for s in (-1, 1):
            step(m, s, sz * (E - 0.42))
    brake(m)


def axle_guard(m, s, za):
    xo = s * 1.11  # the solebar's outer face
    t = 0.022
    xp = s * (1.11 + t)
    xs = sorted((xo, xp))
    # the plate bolted to the solebar
    m.box(xs[0], xs[1], 0.83, 0.95, za - 0.5, za + 0.5, IRON, skip=("-x" if s > 0 else "+x",))
    for dz in (-0.42, -0.21, 0.21, 0.42):
        bolt(m, (xp, 0.915, za + dz), (s, 0, 0), r=0.016)
        bolt(m, (xp, 0.865, za + dz), (s, 0, 0), r=0.016)
    # the legs (horns) either side of the box, the diagonals out to the plate's ends, the stay across below
    for sz in (-1, 1):
        m.beam((s * (1.11 + t / 2), 0.83, za + sz * 0.155), (s * (1.11 + t / 2), 0.36, za + sz * 0.155), t, 0.055, IRON,
               side=(1, 0, 0))
        m.beam((s * (1.11 + t / 2), 0.835, za + sz * 0.47), (s * (1.11 + t / 2), 0.42, za + sz * 0.215), t * 0.7, 0.06, IRON, side=(1, 0, 0))
    m.box(*sorted((s * 1.1, s * 1.142)), 0.34, 0.38, za - 0.2, za + 0.2, IRON)
    # the grease axle box: body, the grease well above with its hinged lid, the face with its cover
    bx0, bx1 = sorted((s * 1.03, s * 1.24))
    face_key = "+x" if s > 0 else "-x"
    m.box(bx0, bx1, 0.40, 0.60, za - 0.12, za + 0.12, IRON, cells={face_key: BOXFACE},
          uvfs={face_key: lambda p: (0.02 + 0.96 * ((-s * (p.z - za)) / 0.24 + 0.5), 0.02 + 0.96 * (p.y - 0.40) / 0.2)})
    m.beam((s * BOX_X, 0.60, za), (s * BOX_X, 0.635, za), 0.21, 0.24, IRON, side=(1, 0, 0))  # the well, a little wider
    lx0, lx1 = sorted((s * 1.06, s * 1.205))
    m.box(lx0, lx1, 0.635, 0.652, za - 0.11, za + 0.11, BRIGHT)  # the lid
    cyl_z(m, s * 1.05, 0.652, za - 0.07, za + 0.07, 0.014, 5, IRON)  # its hinge (inboard)
    m.box(*sorted((s * 1.24, s * 1.255)), 0.43, 0.57, za - 0.075, za + 0.075, IRON, skip=("-x" if s > 0 else "+x",))  # the cover
    # the leaf spring on the box, eyes to shackles, shackles to the hangers under the solebar
    spring(m, s, za)


def spring(m, s, za):
    leaves = 5
    th = 0.013
    y_mid = 0.665  # the lowest leaf's top in the middle (its underside on the box's lid)
    camber = 0.13
    half = 0.56
    w = 0.075
    xc = s * 1.18  # on the box, outboard of the axle guard's plate
    x0, x1 = xc - w / 2, xc + w / 2
    for k in range(leaves):
        L = half * (1 - k * 0.14)  # the top leaf (k 0) longest
        yb = y_mid + (leaves - 1 - k) * th
        segs = 4
        pts = [(za + L * (-1 + 2 * i / segs)) for i in range(segs + 1)]
        top = []
        for z in pts:
            dz = z - za
            y = yb + camber * dz * dz
            top.append((z, y))
        # a band: bottom edge = top edge - th
        outline = [(z, y) for z, y in top] + [(z, y - th) for z, y in reversed(top)]
        m.prism_x(outline, x0, x1, IRON, shade=0.9)
    # the buckle round the leaves over the box
    m.box(x0 - 0.008, x1 + 0.008, y_mid - th - 0.01, y_mid + leaves * th + 0.005, za - 0.07, za + 0.07, IRON)
    # the eyes, shackles and hangers
    ye = y_mid + (leaves - 1) * th + camber * half * half  # the top leaf's end
    for sz in (-1, 1):
        ze = za + sz * half
        cyl_x(m, ye + 0.004, ze, x0 - 0.01, x1 + 0.01, 0.018, 6, IRON)
        for xs in (x0 - 0.012, x1 + 0.012):
            m.beam((xs, ye, ze), (xs, 0.8, ze + sz * 0.02), 0.012, 0.03, IRON, side=(1, 0, 0))
        # the hanger (spring shoe) bolted to the solebar's face
        hx0, hx1 = sorted((s * 1.11, s * 1.235))
        m.box(hx0, hx1, 0.79, 0.86, ze + sz * 0.02 - 0.045, ze + sz * 0.02 + 0.045, IRON)
        bolt(m, (s * 1.235, 0.835, ze + sz * 0.02), (s, 0, 0), r=0.014)


def end_gear(m, sz):
    """The buffers and the draw hook at one end (sz +1 the front)."""
    zf = sz * E  # the headstock's face
    for bx in (-0.87, 0.87):
        # the square base plate with four bolts
        z0, z1 = sorted((zf, zf + sz * 0.025))
        m.box(bx - 0.15, bx + 0.15, 0.85, 1.15, z0, z1, IRON)
        for dx in (-0.11, 0.11):
            for dy in (-0.11, 0.11):
                bolt(m, (bx + dx, 1.0 + dy, zf + sz * 0.025), (0, 0, sz), r=0.02)
        # the casing, the plunger, the round head (its face at L_BUF / 2)
        with m.at(move(bx, 1.0, 0) @ (rot("X", math.pi) if sz < 0 else Matrix.Identity(4))):
            m.lathe([(0.115, E + 0.025), (0.115, E + 0.06), (0.095, E + 0.07), (0.085, E + 0.27), (0.1, E + 0.28)], 8, IRON,
                    cap1=False)
            m.lathe([(0.1, E + 0.28), (0.058, E + 0.285)], 8, IRON)
            m.lathe([(0.055, E + 0.28), (0.055, E + 0.39)], 8, BRIGHT, cap0=False)
            m.lathe([(0.06, E + 0.385), (0.175, E + 0.39), (0.18, E + 0.41), (0.17, E + 0.438), (0.1, L_BUF / 2), (0.0, L_BUF / 2)],
                    12, BRIGHT, cap0=True, cells=[IRON, IRON, BRIGHT, BRIGHT, BRIGHT])
    # the draw hook: through the headstock, the washer plate, the hook (its throat where the coupling hangs)
    z0, z1 = sorted((zf, zf + sz * 0.02))
    m.box(-0.1, 0.1, 0.9, 1.06, z0, z1, IRON)
    hy, hz = HOOK
    path = [(0, 0.985, sz * (E - 0.02)), (0, 0.985, sz * (hz - 0.09)), (0, 0.975, sz * (hz - 0.04)), (0, 0.955, sz * hz),
            (0, 0.96, sz * (hz + 0.045)), (0, 0.99, sz * (hz + 0.075)), (0, 1.035, sz * (hz + 0.085))]
    m.tube(path, [0.026, 0.026, 0.026, 0.028, 0.026, 0.022, 0.018], 6, IRON, side=(1, 0, 0), cap1=True)


def step(m, s, z):
    """A step iron below the solebar at a corner: two hangers and a tread."""
    x = s * 1.16
    for dz in (-0.12, 0.12):
        m.beam((s * 1.1, 0.82, z + dz), (x, 0.42, z + dz), 0.015, 0.04, IRON, side=(0, 0, 1))
    m.box(*sorted((s * 1.08, s * 1.3)), 0.40, 0.425, z - 0.15, z + 0.15, IRON)


def brake(m):
    """Blocks on the four wheels (the side toward the middle), beams across, rods to a cross-shaft, the hand
    lever along the -x solebar into its rack by the front headstock."""
    for za in (-WB / 2, WB / 2):
        sz = -1 if za > 0 else 1  # toward the middle
        a0, a1 = math.radians(-32), math.radians(32)
        zb = za + sz * 0.53
        for sx in (-1, 1):
            # the block, curved along the tread
            pts = []
            for i in range(4):
                a = a0 + (a1 - a0) * i / 3
                pts.append((za + sz * 0.505 * math.cos(a), AXLE_Y + 0.505 * math.sin(a)))
            outer = [(za + sz * 0.575 * math.cos(a0 + (a1 - a0) * i / 3), AXLE_Y + 0.575 * math.sin(a0 + (a1 - a0) * i / 3))
                     for i in range(4)]
            outline = pts + outer[::-1]
            m.prism_x(outline, sx * WHEEL_X - 0.045, sx * WHEEL_X + 0.045, OAK, shade=0.75)
            # the block's hanger up to the frame
            m.beam((sx * WHEEL_X, AXLE_Y + 0.06, zb + sz * 0.05), (sx * 0.47, 0.9, zb + sz * 0.1), 0.03, 0.02, IRON, shade=0.7)
        # the brake beam across
        m.beam((-WHEEL_X, AXLE_Y, zb + sz * 0.06), (WHEEL_X, AXLE_Y, zb + sz * 0.06), 0.06, 0.05, IRON, side=(0, 0, 1), shade=0.7)
        # the pull rod to the cross-shaft
        m.beam((0, AXLE_Y, zb + sz * 0.07), (-0.2, 0.63, -0.3), 0.025, 0.025, IRON, shade=0.7)
    # the cross-shaft under the frame, from the middle out to the lever
    cyl_x(m, 0.63, -0.3, -1.285, 0.1, 0.025, 6, IRON, shade=0.7)
    m.box(-1.13, -1.09, 0.58, 0.8, -0.36, -0.24, IRON)  # its bearing on the solebar
    # the hand lever: from the shaft forward along the solebar, a handle at its end
    lever_a = (-1.29, 0.63, -0.3)
    lever_b = (-1.29, 0.74, E - 0.12)
    m.beam(lever_a, lever_b, 0.028, 0.05, IRON, side=(1, 0, 0), w2=0.024, h2=0.035)
    m.beam(lever_b, (-1.29, 0.75, E + 0.1), 0.03, 0.03, BRIGHT, side=(1, 0, 0))
    # the rack: a toothed quadrant bolted to the solebar and the headstock, the lever held in a notch
    zr = E - 0.12
    teeth = []
    for i in range(7):
        y = 0.5 + i * 0.05
        teeth += [(zr + 0.07, y), (zr + 0.045, y + 0.025)]
    outline = [(zr - 0.07, 0.48), (zr + 0.07, 0.48)] + teeth + [(zr + 0.07, 0.83), (zr - 0.07, 0.83)]
    for x in (-1.26, -1.32):
        m.prism_x(outline, x - 0.008, x + 0.008, IRON)
    m.box(-1.335, -1.11, 0.77, 0.8, zr - 0.07, zr + 0.07, IRON)  # the bracket joining the plates to the frame


# ------------------------------------------------------------------ bodies


def side_uv(s, h0=FLOOR, vt=0.82, ut=1.0):
    """Outer face of a side at x = s: boards along z, 4 boards over vt metres from h0; u reads left to right."""
    def f(p):
        return (-s * p.z / ut, (p.y - h0) / vt)
    return f


def end_uv(sz, h0=FLOOR, vt=0.82, ut=1.0):
    def f(p):
        return (sz * p.x / ut, (p.y - h0) / vt)
    return f


def plank_side(m, s, z0, z1, y0, y1, cell=PAINT, vt=0.82, h0=FLOOR, inner=PAINT, end0=False, end1=False, letter=None):
    """A planked side at x = s * SIDE_X from z0 to z1. letter = (za, zb, ya, yb, cell): a lettered panel of the side's
    own outer face (the letter cell over it, 0..1), the side cut round it."""
    xi, xo = s * (SIDE_X - SIDE_T / 2), s * (SIDE_X + SIDE_T / 2)
    x0, x1 = sorted((xi, xo))
    out_key, in_key = ("+x", "-x") if s > 0 else ("-x", "+x")
    pieces = [(z0, z1, y0, y1, None)]
    if letter:
        la, lb, ly0, ly1, lc = letter
        pieces = [(z0, la, y0, y1, None), (la, lb, y0, ly0, None), (la, lb, ly0, ly1, lc), (la, lb, ly1, y1, None), (lb, z1, y0, y1, None)]
    for a, b, ya, yb, lc in pieces:
        if b - a < 1e-4 or yb - ya < 1e-4:
            continue
        uvo = side_uv(s, h0, vt)
        c = cell
        if lc is not None:
            c = lc

            def uvo(p, a=a, b=b, ya=ya, yb=yb):
                t = (p.z - a) / (b - a)
                u = 1 - t if s > 0 else t
                return (0.003 + 0.994 * u, 0.003 + 0.994 * (p.y - ya) / (yb - ya))
        skip = ["-y"]
        if yb < y1 - 1e-6:
            skip.append("+y")
        if not (end0 and abs(a - z0) < 1e-6):
            skip.append("-z")
        if not (end1 and abs(b - z1) < 1e-6):
            skip.append("+z")
        m.box(x0, x1, ya, yb, a, b, cell, cells={out_key: c, in_key: inner, "+y": OAK, "-z": OAK, "+z": OAK},
              uvfs={out_key: uvo, in_key: side_uv(-s, h0, vt), "+y": lambda p: (p.z / 0.6, p.x / 0.6)}, skip=tuple(skip))


def corner_plates(m, h_top, y0=FLOOR - 0.02, side=True):
    """Angle irons round the four body corners: a plate on the side and one on the end."""
    for s in (-1, 1):
        for sz in (-1, 1):
            xo = s * (SIDE_X + SIDE_T / 2)
            if side:
                strap(m, (xo, y0, sz * (E - 0.09)), (xo, h_top, sz * (E - 0.09)), 0.16, (s, 0, 0), t=0.01)
            strap(m, (s * (SIDE_X - 0.02), y0, sz * E), (s * (SIDE_X - 0.02), h_top, sz * E), 0.16, (0, 0, sz), t=0.01)


def open_body(m):
    h = OPEN_H
    top = FLOOR + h
    door = 0.6
    for s in (-1, 1):
        plank_side(m, s, -E, -door, FLOOR, top, end0=True, letter=(-2.1, -1.0, FLOOR, top, L_OPEN))
        plank_side(m, s, door, E, FLOOR, top, end1=True)
        door_pair(m, s, door, FLOOR, top)
        # the stanchions (iron knees) and the door posts, outside
        xo = s * (SIDE_X + SIDE_T / 2)
        for z in (-2.2, -0.9, 0.9, 2.2):
            strap(m, (xo, FLOOR - 0.05, z), (xo, top, z), 0.07, (s, 0, 0))
        for z in (-door - 0.03, door + 0.03):
            strap(m, (xo, FLOOR - 0.05, z), (xo, top, z), 0.06, (s, 0, 0), bolts=False, t=0.018)
        # the top capping, iron
        x0, x1 = sorted((s * (SIDE_X - SIDE_T / 2 - 0.01), s * (SIDE_X + SIDE_T / 2 + 0.012)))
        m.box(x0, x1, top, top + 0.025, -E - 0.012, E + 0.012, IRON, skip=("-y",))
        # the label clip right of the door: a small iron frame with a pale card in it
        xl = s * (SIDE_X + SIDE_T / 2)
        m.box(*sorted((xl, xl + s * 0.012)), top - 0.3, top - 0.16, 1.32, 1.5, CANVAS, cells={"+x" if s < 0 else "-x": IRON},
              uvfs={("+x" if s > 0 else "-x"): lambda p: (0.2 + p.z * 0.8, 0.3 + p.y * 0.8)}, skip=("-x" if s > 0 else "+x",))
        for ya, yb in ((top - 0.31, top - 0.29), (top - 0.17, top - 0.15)):
            m.box(*sorted((xl, xl + s * 0.018)), ya, yb, 1.31, 1.51, IRON, skip=("-x" if s > 0 else "+x",))
    # the ends
    for sz in (-1, 1):
        z0, z1 = sorted((sz * (E - SIDE_T), sz * E))
        out_key, in_key = ("+z", "-z") if sz > 0 else ("-z", "+z")
        m.box(-(SIDE_X - SIDE_T / 2), SIDE_X - SIDE_T / 2, FLOOR, top, z0, z1, PAINT, cells={"+y": OAK},
              uvfs={out_key: end_uv(sz), in_key: end_uv(-sz), "+y": lambda p: (p.x / 0.6, p.z / 0.6)}, skip=("-y", "-x", "+x"))
        xc = SIDE_X - SIDE_T / 2 - 0.01
        m.box(-xc, xc, top, top + 0.025, *sorted((sz * (E - SIDE_T - 0.01), sz * (E + 0.012))), IRON, skip=("-y",))
        for x in (-0.45, 0.45):
            strap(m, (x, FLOOR - 0.02, sz * E), (x, top, sz * E), 0.07, (0, 0, sz))
        strap(m, (-1.1, FLOOR + h * 0.5, sz * E), (1.1, FLOOR + h * 0.5, sz * E), 0.06, (0, 0, sz), t=0.022)
    corner_plates(m, top)
    # inside: knees at the stanchions, so the sides read as braced
    for s in (-1, 1):
        for z in (-2.2, -0.9, 0.9, 2.2):
            xi = s * (SIDE_X - SIDE_T / 2)
            m.beam((xi - s * 0.035, FLOOR, z), (xi - s * 0.012, FLOOR + 0.5, z), 0.05, 0.022, IRON, side=(0, 0, 1))


def door_pair(m, s, door, y0, y1):
    """Two side doors hinged at the posts, strap hinges, a latch at the meeting edge."""
    xo = s * (SIDE_X + SIDE_T / 2)
    for sz in (-1, 1):
        a, b = sorted((sz * 0.006, sz * door))
        plank_side(m, s, a, b, y0 + 0.012, y1 - 0.006, cell=PAINT, end0=True, end1=True)
        # the hinges: straps from the post across the leaf, knuckles on the post
        for y in (y0 + 0.17, y1 - 0.17):
            strap(m, (xo, y, sz * (door + 0.02)), (xo, y, sz * 0.07), 0.05, (s, 0, 0))
            cyl_z(m, xo + s * 0.022, y, *sorted((sz * (door - 0.03), sz * (door + 0.05))), 0.017, 5, IRON)
    # the latch: a bar across the meeting edge in its keeper, a handle
    y = (y0 + y1) / 2
    m.box(*sorted((xo + s * 0.005, xo + s * 0.03)), y - 0.025, y + 0.025, -0.16, 0.16, IRON)
    m.box(*sorted((xo + s * 0.005, xo + s * 0.04)), y - 0.05, y + 0.05, 0.13, 0.17, IRON)
    m.beam((xo + s * 0.03, y - 0.02, -0.12), (xo + s * 0.03, y - 0.14, -0.1), 0.02, 0.02, IRON, side=(0, 0, 1))


def flat_body(m):
    # low dropsides hinged at the bottom, stanchions in their pockets on the solebars, low ends
    hs = 0.14
    for s in (-1, 1):
        plank_side(m, s, -E, E, FLOOR, FLOOR + hs, vt=0.56, end0=True, end1=True)
        xo = s * (SIDE_X + SIDE_T / 2)
        for z in (-1.6, 0.0, 1.6):
            # hinge straps down the dropside onto the floor's edge, the knuckle below
            strap(m, (xo, FLOOR + hs - 0.02, z), (xo, FLOOR - 0.03, z), 0.05, (s, 0, 0))
            cyl_z(m, xo + s * 0.016, FLOOR - 0.025, z - 0.06, z + 0.06, 0.016, 5, IRON)
        for z in (-2.3, -0.78, 0.78, 2.3):
            xs = s * 1.29
            # the pockets on the solebar, the stanchion standing in them, a cap on its top
            for ya, yb in ((0.84, 0.9), (1.0, 1.06)):
                m.box(*sorted((s * 1.11, s * 1.33)), ya, yb, z - 0.055, z + 0.055, IRON)
            m.box(xs - 0.03, xs + 0.03, 0.8, FLOOR + 0.58, z - 0.03, z + 0.03, IRON, skip=("-y",))
            m.box(xs - 0.036, xs + 0.036, FLOOR + 0.58, FLOOR + 0.61, z - 0.036, z + 0.036, IRON, cells={"+y": BRIGHT}, skip=("-y",))
            # the drop latch holding the dropside to the stanchion
            m.box(*sorted((xo, xo + s * 0.018)), FLOOR + 0.06, FLOOR + 0.1, z - 0.09, z + 0.09, IRON, skip=("-x" if s > 0 else "+x",))
    for sz in (-1, 1):
        z0, z1 = sorted((sz * (E - SIDE_T), sz * E))
        out_key, in_key = ("+z", "-z") if sz > 0 else ("-z", "+z")
        m.box(-(SIDE_X - SIDE_T / 2), SIDE_X - SIDE_T / 2, FLOOR, FLOOR + hs, z0, z1, PAINT, cells={"+y": OAK},
              uvfs={out_key: end_uv(sz, vt=0.56), in_key: end_uv(-sz, vt=0.56)}, skip=("-y", "-x", "+x"))
        for s in (-1, 1):
            strap(m, (s * (SIDE_X - 0.05), FLOOR - 0.02, sz * E), (s * (SIDE_X - 0.05), FLOOR + hs, sz * E), 0.1, (0, 0, sz), t=0.01)


def van_body(m):
    h = VAN_H
    top = FLOOR + h
    vt = 0.8
    door0, door1 = -0.8, 0.8
    for s in (-1, 1):
        plank_side(m, s, -E, E, FLOOR, top, vt=vt, end0=True, end1=True, letter=(-1.9, -0.9, FLOOR, FLOOR + 0.8, L_VAN))
        xo = s * (SIDE_X + SIDE_T / 2)
        # the outside frame: corner posts, door posts, the waist rail, diagonal braces: timber, painted
        fw = 0.09
        ft = 0.035
        xf0, xf1 = sorted((xo, xo + s * ft))
        post_key = "+x" if s > 0 else "-x"
        for z in (-E + 0.05, E - 0.05, door0 - 0.06, door1 + 0.06, -1.95, 1.95):
            m.box(xf0, xf1, FLOOR - 0.02, top - 0.08, z - fw / 2, z + fw / 2, PAINT, cells={post_key: PAINT},
                  uvfs={post_key: lambda p: (p.y / 0.8, p.z / 0.8)}, skip=("-y",))
        # the waist rail in pieces between the posts (not through them: no faces in one plane)
        posts = sorted((-E + 0.05, E - 0.05, door0 - 0.06, door1 + 0.06, -1.95, 1.95))
        for za, zb in [(posts[i] + fw / 2, posts[i + 1] - fw / 2) for i in range(len(posts) - 1) if not (posts[i] < 0 < posts[i + 1])]:
            m.box(xf0, xf1, FLOOR + 0.93, FLOOR + 1.02, za, zb, PAINT, skip=("-y",))
        for z0, z1, up in ((-1.9, -1.0, 1), (1.0, 1.9, -1)):
            # a diagonal in each bay between the door and the middle posts (above the waist)
            ya, yb = (FLOOR + 1.02, top - 0.02) if up > 0 else (top - 0.02, FLOOR + 1.02)
            m.beam((xo + s * ft / 2, ya, z0), (xo + s * ft / 2, yb, z1), ft * 0.6, fw * 0.8, PAINT, side=(1, 0, 0), shade=0.95)
        # the cant rail along the top
        m.box(*sorted((xo, xo + s * 0.05)), top - 0.08, top, -E - 0.02, E + 0.02, PAINT, skip=("-x" if s > 0 else "+x",))
        sliding_door(m, s, door0, door1, top)
        # bolt heads along the solebar edge of the side (where the body is fastened)
        for z in np.arange(-2.5, 2.6, 0.5):
            if door0 - 0.1 < z < door1 + 0.1:
                continue
            bolt(m, (xo, FLOOR + 0.06, z), (s, 0, 0), r=0.014)
            bolt(m, (xo, top - 0.12, z), (s, 0, 0), r=0.014)
    # the ends: planks up into the roof's arch, iron straps, corner plates
    R = 3.4
    roof_top = top + 0.28
    for sz in (-1, 1):
        z0, z1 = sorted((sz * (E - SIDE_T), sz * E))
        out_key, in_key = ("+z", "-z") if sz > 0 else ("-z", "+z")
        m.box(-(SIDE_X - SIDE_T / 2), SIDE_X - SIDE_T / 2, FLOOR, top, z0, z1, PAINT,
              uvfs={out_key: end_uv(sz, vt=vt), in_key: end_uv(-sz, vt=vt)}, skip=("-y", "-x", "+x", "+y"))
        # the arch above the side's top: a flat plate (a fan) up to the roof
        n = 8
        arch = []
        for i in range(n + 1):
            x = -(SIDE_X + SIDE_T / 2) + 2 * (SIDE_X + SIDE_T / 2) * i / n
            a = math.asin(max(-1, min(1, x / R)))
            arch.append((x, roof_top - R * (1 - math.cos(a)) - 0.03))
        zf = sz * E
        pts = [(-(SIDE_X + SIDE_T / 2), top, zf)] + [(x, y, zf) for x, y in arch] + [(SIDE_X + SIDE_T / 2, top, zf)]
        m.poly(pts, PAINT, out=(0, 0, sz), uvf=lambda p, sz=sz: (sz * p.x / 1.0, (p.y - FLOOR) / vt))
        pts_in = [(p[0], p[1], zf - sz * SIDE_T) for p in pts]
        m.poly(pts_in, PAINT, out=(0, 0, -sz), uvf=lambda p, sz=sz: (-sz * p.x / 1.0, (p.y - FLOOR) / vt))
        for x in (-0.5, 0.5):
            strap(m, (x, FLOOR - 0.02, zf), (x, top + 0.2, zf), 0.07, (0, 0, sz))
        for y in (FLOOR + 0.9, top - 0.1):
            strap(m, (-1.1, y, zf), (1.1, y, zf), 0.06, (0, 0, sz), t=0.022)
        # hand rails (grab irons) at the corners, a step on the headstock, the lamp iron
        for s in (-1, 1):
            xh = s * 1.05
            zh = zf + sz * 0.06
            m.beam((xh, FLOOR + 0.35, zh), (xh, FLOOR + 1.5, zh), 0.022, 0.022, IRON)
            for y in (FLOOR + 0.35, FLOOR + 1.5):
                m.beam((xh, y, zf), (xh, y, zh + sz * 0.011), 0.02, 0.03, IRON, side=(1, 0, 0))
        m.box(-0.35, 0.35, 0.73, 0.76, *sorted((zf + sz * 0.02, zf + sz * 0.2)), IRON)  # the step on the headstock... below the buffers' line
        for x in (-0.3, 0.3):
            m.beam((x, 0.8, zf + sz * 0.02), (x, 0.745, zf + sz * 0.18), 0.03, 0.012, IRON, side=(1, 0, 0))
        # the lamp iron: a bracket on the end, high up in the middle, a spike for the tail lamp
        m.box(-0.05, 0.05, top + 0.02, top + 0.12, *sorted((zf, zf + sz * 0.03)), IRON)
        m.box(-0.02, 0.02, top + 0.05, top + 0.2, *sorted((zf + sz * 0.03, zf + sz * 0.07)), IRON)
    corner_plates(m, top, side=False)
    # the roof: canvas over an arch of boards, overhanging at the ends and the eaves; rain strips
    ncol = 9
    half = SIDE_X + SIDE_T / 2 + 0.07
    amax = math.asin(half / R)
    zr0, zr1 = -E - 0.09, E + 0.09
    rings_out = []
    for i in range(ncol + 1):
        a = -amax + 2 * amax * i / ncol
        rings_out.append((R * math.sin(a), roof_top - R * (1 - math.cos(a))))
    for i in range(ncol):
        (xa, ya), (xb, yb) = rings_out[i], rings_out[i + 1]
        # a strip of canvas over the boards (top face canvas, the underside boards)
        ta = Vector((xa, ya, 0))
        tb = Vector((xb, yb, 0))
        nrm = Vector((-(yb - ya), xb - xa, 0)).normalized()
        if nrm.y < 0:
            nrm = -nrm
        th = 0.035
        P = [(xa, ya, zr0), (xb, yb, zr0), (xb, yb, zr1), (xa, ya, zr1)]
        m.poly(P, CANVAS, out=(nrm.x, nrm.y, 0), uvf=lambda p: (p.x / 1.2 + 0.5, p.z / 1.2))
        Pb = [(x - nrm.x * th, y - nrm.y * th, z) for x, y, z in P]
        m.poly(Pb, OAK, out=(-nrm.x, -nrm.y, 0), shade=0.6)
        for zz in (zr0, zr1):
            m.poly([(xa, ya, zz), (xb, yb, zz), (xb - nrm.x * th, yb - nrm.y * th, zz), (xa - nrm.x * th, ya - nrm.y * th, zz)],
                   PAINT, out=(0, 0, 1 if zz > 0 else -1))
    for s in (-1, 1):
        # the eaves' edge
        x, y = rings_out[0 if s < 0 else -1]
        m.box(*sorted((x, x - s * 0.04)), y - 0.07, y + 0.005, zr0, zr1, PAINT, skip=())
        # rain strips: a batten along each side of the roof, bent down over the ends, and one over each door
        a = s * (amax - 0.07)
        xr, yr = R * math.sin(a), roof_top - R * (1 - math.cos(a))
        m.beam((xr, yr + 0.005, zr0 + 0.15), (xr, yr + 0.005, zr1 - 0.15), 0.03, 0.03, OAK, side=(1, 0, 0))
        a2 = s * (amax - 0.12)
        xr2, yr2 = R * math.sin(a2), roof_top - R * (1 - math.cos(a2))
        m.beam((xr2, yr2 + 0.01, door0 - 0.2), (xr2, yr2 + 0.01, door1 + 0.25), 0.03, 0.035, OAK, side=(1, 0, 0))
    # the end boards (the roof's arched ends), a little proud of the ends
    for sz in (-1, 1):
        zf = sz * (E + 0.02)
        z0, z1 = sorted((zf - sz * 0.02, zf + sz * 0.03))
        for i in range(ncol):
            (xa, ya), (xb, yb) = rings_out[i], rings_out[i + 1]
            outline = [(xa, ya - 0.035), (xb, yb - 0.035), (xb, yb - 0.17), (xa, ya - 0.17)]
            # (a plate across z: build it as a quad ring)
            q = [(x, y, z) for x, y in outline for z in (z0,)]
            q2 = [(x, y, z1) for x, y in outline]
            m.poly(q, PAINT, out=(0, 0, -1))
            m.poly(q2, PAINT, out=(0, 0, 1))
            m.poly([q[0], q[1], q2[1], q2[0]], PAINT, out=(0, 1, 0))
            m.poly([q[3], q[2], q2[2], q2[3]], PAINT, out=(0, -1, 0))


def sliding_door(m, s, z0, z1, top):
    xo = s * (SIDE_X + SIDE_T / 2)
    ft = 0.035
    xd0, xd1 = sorted((xo + s * 0.045, xo + s * 0.09))
    key = "+x" if s > 0 else "-x"
    y0, y1 = FLOOR + 0.03, top - 0.12

    def duv(p):
        return (-s * (p.z - z0) / 0.8, (p.y - y0) / 0.8)
    m.box(xd0, xd1, y0, y1, z0, z1, DOOR, cells={key: DOOR}, uvfs={key: duv})
    xs = xo + s * 0.09
    # the door's frame: top and bottom rails, the brace, iron corner straps
    for ya, yb in ((y0, y0 + 0.1), (y1 - 0.1, y1), ((y0 + y1) / 2 - 0.05, (y0 + y1) / 2 + 0.05)):
        m.box(*sorted((xs, xs + s * 0.025)), ya, yb, z0, z1, PAINT, skip=("-x" if s > 0 else "+x",))
    m.beam((xs + s * 0.0125, y0 + 0.1, z0 + 0.06), (xs + s * 0.0125, (y0 + y1) / 2 - 0.05, z1 - 0.06), 0.025, 0.09, PAINT, side=(1, 0, 0))
    m.beam((xs + s * 0.0125, (y0 + y1) / 2 + 0.05, z1 - 0.06), (xs + s * 0.0125, y1 - 0.1, z0 + 0.06), 0.025, 0.09, PAINT, side=(1, 0, 0))
    for z in (z0 + 0.04, z1 - 0.04):
        strap(m, (xs + s * 0.025, y0, z), (xs + s * 0.025, y1, z), 0.06, (s, 0, 0))
    # the rail it hangs from, over the door and on toward the front (the door slides that way), on brackets
    yr = top - 0.06
    xr0, xr1 = sorted((xo + s * 0.04, xo + s * 0.1))
    m.box(xr0, xr1, yr - 0.03, yr + 0.015, z0 - 0.15, z1 + 1.55, IRON)
    for z in (z0 - 0.1, 0.0, z1 + 0.7, z1 + 1.5):
        m.box(*sorted((xo + s * 0.05, xo + s * 0.092)), yr + 0.015, yr + 0.04, z - 0.04, z + 0.04, IRON)
    # the hangers with their rollers on the rail
    for z in (z0 + 0.25, z1 - 0.25):
        m.box(*sorted((xs - s * 0.02, xs + s * 0.02)), y1 - 0.02, yr + 0.02, z - 0.035, z + 0.035, IRON)
        cyl_x(m, yr + 0.035, z, *sorted((xr0 - 0.005, xr1 + 0.005)), 0.035, 6, IRON)
    # the bottom guide
    m.box(*sorted((xo, xo + s * 0.1)), FLOOR - 0.03, FLOOR + 0.0, z0 - 0.1, z1 + 1.5, IRON)
    # the handle and the hasp
    zh = z0 + 0.1
    m.beam((xs + s * 0.03, FLOOR + 0.8, zh), (xs + s * 0.03, FLOOR + 1.2, zh), 0.025, 0.025, BRIGHT)
    for y in (FLOOR + 0.8, FLOOR + 1.2):
        m.beam((xs, y, zh), (xs + s * 0.042, y, zh), 0.02, 0.02, IRON, side=(0, 0, 1))
    m.box(*sorted((xo, xs + s * 0.02)), FLOOR + 0.98, FLOOR + 1.06, z0 - 0.13, z0 + 0.03, IRON)


# ------------------------------------------------------------------ parts


def wagon(kind):
    m = Mesh()
    underframe(m, kind)
    {"open": open_body, "flat": flat_body, "van": van_body}[kind](m)
    return m


def wheel_one(m, sx):
    """An iron spoked wheel at x = sx * WHEEL_X: tyre with its flange inboard, rim, ten spokes, boss."""
    with m.at(move(sx * WHEEL_X, 0, 0) @ rot("Y", math.pi / 2 if sx > 0 else -math.pi / 2)):
        # local z points outward from the track's middle
        segs = 15
        prof = [(0.42, -0.035), (0.455, -0.035), (0.455, -0.075), (0.522, -0.075), (0.53, -0.068), (0.528, -0.058),
                (0.51, -0.045), (0.5017, -0.04), (0.4938, 0.065), (0.455, 0.065), (0.455, 0.035), (0.42, 0.035)]
        cells = [IRON, IRON, IRON, BRIGHT, BRIGHT, BRIGHT, BRIGHT, BRIGHT, IRON, IRON, IRON, RUST]
        m.lathe(prof, segs, IRON, closed_v=True, cells=cells, rot=math.pi / segs)
        # the boss round the axle
        m.lathe([(0.13, -0.06), (0.13, 0.05), (0.1, 0.085), (0.075, 0.09)], 8, IRON, cap1=True, cap_cell=BRIGHT)
        m.lathe([(0.075, -0.07), (0.13, -0.06)], 8, IRON)
        # spokes, flattened ovals, a little dished
        for k in range(10):
            a = 2 * math.pi * (k + 0.5) / 10
            d = Vector((math.cos(a), math.sin(a), 0))
            m.beam(d * 0.12 + Vector((0, 0, 0.012)), d * 0.43, 0.05, 0.032, IRON, side=Vector((-d.y, d.x, 0)), caps=False, w2=0.038,
                   h2=0.026)


def wheelset():
    m = Mesh(ao=0.0)
    cyl_x(m, 0, 0, -1.06, 1.06, 0.062, 8, IRON)
    for sx in (-1, 1):
        # the wheel seat, a collar outside the boss
        cyl_x(m, 0, 0, *sorted((sx * 0.84, sx * 0.87)), 0.075, 8, IRON)
        wheel_one(m, sx)
    return m


def link(m, zc, plane, L=0.4, W=0.13, r=0.02, sag=0.0):
    """One oval link along z centred at zc (outer length L, outer width W); plane "v" (standing) or "h" (lying)."""
    n = 8
    lc, wc = L / 2 - r, W / 2 - r
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        ca, sa = math.cos(a), math.sin(a)
        z = zc + lc * math.copysign(abs(ca) ** 0.55, ca)
        c = wc * math.copysign(abs(sa) ** 0.8, sa)
        pts.append((c, sag, z) if plane == "h" else (0, sag + c, z))
    m.tube(pts, r, 4, IRON, side=(0, 1, 0) if plane == "h" else (1, 0, 0), closed_path=True, rot=math.pi / 4)


def coupling():
    """The three-link coupling, 1 m along z (the game scales it to the gap): its end links reach z -0.5 and 0.5."""
    m = Mesh(ao=0.0)
    L = 0.42
    for k, zc in enumerate((-0.5 + L / 2, 0.0, 0.5 - L / 2)):
        link(m, zc, "v" if k != 1 else "h", L=L, W=0.12 if k != 1 else 0.14, r=0.02, sag=-0.03 if k == 1 else -0.012)
    return m


# ------------------------------------------------------------------ goods units (the props' goods atlas)


def unit_sacks():
    """Three sacks: two lying side by side, one on top. UNIT_H 0.56, footprint 1.0 x 0.95."""
    m = Mesh()
    for x, y, z, seed, L, W, H in ((-0.25, 0.0, 0.0, 1, 0.95, 0.5, 0.3), (0.25, 0.0, 0.02, 2, 0.93, 0.5, 0.3),
                                   (0.02, 0.25, 0.0, 3, 0.92, 0.52, 0.34)):
        sack(m, x, y, z, L, W, H, seed)
    return m


def sack(m, x0, y0, z0, L, W, H, seed):
    """A full jute sack lying along z, tied ends pinched flat; its flattened belly on y0, its top at y0 + 0.9 H."""
    rng = np.random.default_rng(seed)
    nz, na = 7, 10
    rings = []
    for k in range(nz):
        t = -1 + 2 * k / (nz - 1)
        f = 1 - abs(t) ** 3
        ring = []
        for i in range(na):
            a = 2 * math.pi * i / na
            ca, sa = math.cos(a), math.sin(a)
            rx = W / 2 * (0.35 + 0.65 * f) * (1 + rng.uniform(-0.04, 0.04))
            ry = H / 2 * (0.15 + 0.85 * f)
            yy = max(ry * sa, -0.4 * H)
            ring.append((x0 + rx * ca, y0 + 0.4 * H + yy, z0 + t * L / 2))
        rings.append(ring)
    m.grid(rings, G["grain"], closed=True, smooth=True, cap0=True, cap1=True, urep=2.0, vscale=1.0 / L)


def unit_casks():
    """A cask lying across (the game turns it along the wagon): its axis along x, 0.96 long, 0.74 high."""
    m = Mesh()
    prof = [(0.27, -0.455)]
    n = 8
    for i in range(n + 1):
        u = i / n
        prof.append((0.3 + 0.07 * math.sin(u * math.pi), -0.48 + 0.96 * u))
    prof.append((0.27, 0.455))
    with m.at(move(0, 0.37, 0) @ rot("Y", math.pi / 2)):
        # staves along the cask (v over its length: the hoops of the "cask" cell), heads of wood set in the chime
        m.lathe(prof, 12, G["cask"], smooth=True, urep=3.0, vscale=1.0 / 1.02)
        for z, sgn in ((-0.455, -1), (0.455, 1)):
            head = [(0.27 * math.cos(2 * math.pi * i / 12), 0.27 * math.sin(2 * math.pi * i / 12), z) for i in range(12)]
            m.poly(head, G["wood"], out=(0, 0, sgn), tile=0.6)
    return m


def unit_bales():
    """A cotton bale in bagging with iron bands: 0.8 x 0.78 x 1.0, the corners rounded."""
    m = Mesh()
    w, h, d = 0.8, 0.78, 1.0
    rings = []
    nz = 5
    for k in range(nz):
        t = -1 + 2 * k / (nz - 1)
        bulge = 1 + 0.04 * (1 - t * t)
        z = t * d / 2
        c = 0.08
        hw, hh = w / 2 * bulge, h / 2
        ring = [(hw - c, -hh), (hw, -hh + c), (hw, hh - c), (hw - c, hh), (-hw + c, hh), (-hw, hh - c), (-hw, -hh + c), (-hw + c, -hh)]
        rings.append([(x, y + h / 2, z) for x, y in ring])
    m.grid(rings, G["bale"], closed=True, cap0=True, cap1=True, uvfn=lambda p, j, i: ((p.z + 0.5) / 1.0, (p.x + p.y) / 0.8))
    return m


def unit_crates():
    """A packing crate 0.92 x 0.86 x 0.92: the marked boards on its four sides, battens round the edges."""
    m = Mesh()
    w, h = 0.92, 0.86
    c = G["crate_mark"]

    def f(u):
        return lambda p: (0.02 + 0.96 * u(p), 0.02 + 0.96 * p.y / h)
    m.box(-w / 2, w / 2, 0, h, -w / 2, w / 2, c,
          uvfs={"+x": f(lambda p: (w / 2 - p.z) / w), "-x": f(lambda p: (p.z + w / 2) / w),
                "+z": f(lambda p: (p.x + w / 2) / w), "-z": f(lambda p: (w / 2 - p.x) / w),
                "+y": lambda p: (p.x / 0.9, p.z / 0.9)},
          cells={"+y": G["wood"]}, skip=("-y",))
    # battens round the bottom and the top
    b = 0.05
    t = 0.02
    for y0 in (0.0, h - b):
        for s in (-1, 1):
            m.box(*sorted((s * w / 2, s * (w / 2 + t))), y0, y0 + b, -w / 2 - t, w / 2 + t, G["wood"],
                  skip=("-y", "-x" if s > 0 else "+x"))
            m.box(-w / 2, w / 2, y0, y0 + b, *sorted((s * w / 2, s * (w / 2 + t))), G["wood"], skip=("-y", "-z" if s > 0 else "+z"))
    return m


BUILDERS = [
    ("wagon_open", lambda: wagon("open")),
    ("wagon_flat", lambda: wagon("flat")),
    ("wagon_van", lambda: wagon("van")),
    ("wheelset", wheelset),
    ("coupling", coupling),
    ("goods_sacks", unit_sacks),
    ("goods_casks", unit_casks),
    ("goods_bales", unit_bales),
    ("goods_crates", unit_crates),
]


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


# ------------------------------------------------------------------ preview


def preview_materials():
    for mt in bpy.data.materials:
        if mt.name not in MATS:
            continue
        nt = mt.node_tree
        bsdf = nt.nodes.get("Principled BSDF")
        tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None)
        if tex is None:
            tex = nt.nodes.new("ShaderNodeTexImage")
            tex.image = image("goods_tex", BP.paint_atlas())
            tex.interpolation = "Closest"
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mix = nt.nodes.new("ShaderNodeMix")
        mix.data_type = "RGBA"
        mix.blend_type = "MULTIPLY"
        mix.inputs[0].default_value = 1.0
        nt.links.new(tex.outputs["Color"], mix.inputs[6])
        nt.links.new(vc.outputs["Color"], mix.inputs[7])
        nt.links.new(mix.outputs[2], bsdf.inputs["Base Color"])
        mt.use_backface_culling = True
        uv = nt.nodes.new("ShaderNodeUVMap")
        uv.uv_map = "UVMap"
        cell = nt.nodes.new("ShaderNodeUVMap")
        cell.uv_map = "Cell"
        fr = nt.nodes.new("ShaderNodeVectorMath")
        fr.operation = "FRACTION"
        nt.links.new(uv.outputs["UV"], fr.inputs[0])
        sf = nt.nodes.new("ShaderNodeSeparateXYZ")
        sc = nt.nodes.new("ShaderNodeSeparateXYZ")
        nt.links.new(fr.outputs["Vector"], sf.inputs[0])
        nt.links.new(cell.outputs["UV"], sc.inputs[0])

        def math_node(op, a, b):
            n = nt.nodes.new("ShaderNodeMath")
            n.operation = op
            for k, v in enumerate((a, b)):
                if isinstance(v, (int, float)):
                    n.inputs[k].default_value = v
                else:
                    nt.links.new(v, n.inputs[k])
            return n.outputs[0]

        u = math_node("DIVIDE", math_node("ADD", sc.outputs["X"], sf.outputs["X"]), N)
        row = math_node("SUBTRACT", N - 1, sc.outputs["Y"])
        v = math_node("DIVIDE", math_node("ADD", row, sf.outputs["Y"]), N)
        cmb = nt.nodes.new("ShaderNodeCombineXYZ")
        nt.links.new(u, cmb.inputs["X"])
        nt.links.new(v, cmb.inputs["Y"])
        nt.links.new(cmb.outputs["Vector"], tex.inputs["Vector"])


def g2b(x, y, z):
    return Vector((x, -z, y))


def place(objs, name, x, y, z, yaw=0.0, roll=0.0, scale=(1, 1, 1)):
    """A copy of a part at a game position; yaw about the game's y, roll (the wheels) about the part's x."""
    o = objs[name].copy()
    bpy.context.scene.collection.objects.link(o)
    o.hide_render = False
    M = Matrix.Translation(g2b(x, y, z)) @ rot("Z", yaw) @ rot("X", roll) @ Matrix.Diagonal((scale[0], scale[2], scale[1], 1.0))
    o.matrix_world = M
    return o


def train(objs, kinds=("open", "flat", "van"), goods=("sacks", "casks", None)):
    """Wagons in a row as the game puts them: axles, couplings between the hooks, a few goods."""
    placed = []
    z = 0.0
    step_ = L_BUF + 0.02
    ROWS = [1.55, 0, -1.55]
    ACROSS = [-0.56, 0.56]
    for i, k in enumerate(kinds):
        zc = -i * step_
        placed.append(place(objs, f"wagon_{k}", 0, 0, zc))
        for j, o in enumerate((WB / 2, -WB / 2)):
            placed.append(place(objs, "wheelset", 0, AXLE_Y, zc + o, roll=0.4 * i + j))
        g = goods[i] if i < len(goods) else None
        if g:
            for r in ROWS[:2]:
                for a in ACROSS:
                    placed.append(place(objs, f"goods_{g}", a, FLOOR, zc + r, yaw=math.pi / 2 if g == "casks" else 0))
        if i > 0:
            za = zc + E + 0.3
            zb = zc + step_ - E - 0.3
            L = zb - za
            o = objs["coupling"].copy()
            bpy.context.scene.collection.objects.link(o)
            o.hide_render = False
            o.matrix_world = Matrix.Translation(g2b(0, HOOK[0], (za + zb) / 2)) @ Matrix.Diagonal((1, L, 1, 1))
            placed.append(o)
    return placed


def closeup(objs, names, path, az=-35.0, el=0.45, dist=2.4, target=None, lens=35, res=(1280, 800)):
    cam = BP.stage()
    sel = [objs[n] for n in names if n in objs]
    for o in objs.values():
        o.hide_render = o not in sel
    bpy.context.view_layer.update()
    lo, hi = BP.bounds(sel)
    c = (lo + hi) / 2 if target is None else g2b(*target)
    r = (hi - lo).length / 2
    a = math.radians(az)
    d = r * dist
    BP.aim(cam, (c.x + d * math.sin(a), c.y - d * math.cos(a), c.z + d * el), c, lens=lens)
    BP.render(path, res)


def view(cam, frm, to, path, lens=35, res=(1280, 800)):
    BP.aim(cam, g2b(*frm), g2b(*to), lens=lens)
    BP.render(path, res)


def views(objs, spec):
    """Pictures from a JSON list [[name, [x, y, z], [tx, ty, tz], lens], ...] (game coordinates) of the train of three."""
    import json
    cam = BP.stage()
    for o in objs.values():
        o.hide_render = True
    train(objs)
    bpy.context.view_layer.update()
    for name, frm, to, lens in json.load(open(spec)):
        view(cam, frm, to, os.path.join(SHOTS, f"{name}.png"), lens=lens)


def sheet(objs, prefix):
    """The pictures to look at: each wagon side, 3/4, end, low, from above; a train of three; the parts."""
    cam = BP.stage()
    for o in objs.values():
        o.hide_render = True
    placed = train(objs)
    bpy.context.view_layer.update()
    p = lambda n: os.path.join(SHOTS, f"{prefix}{n}.png")  # noqa: E731
    step_ = L_BUF + 0.02
    for i, k in enumerate(("open", "flat", "van")):
        zc = -i * step_
        view(cam, (7.0, 1.6, zc), (0, 1.2, zc), p(f"{k}_side"), lens=30)
        view(cam, (4.2, 2.2, zc + 5.2), (0, 1.1, zc), p(f"{k}_34"), lens=30)
        view(cam, (-3.0, 0.45, zc + 1.6), (0, 0.6, zc + 1.2), p(f"{k}_low"), lens=28)
    view(cam, (0.6, 4.5, 2.6), (0, 1.1, -0.2), p("open_above"), lens=30)
    view(cam, (2.0, 1.5, -3.2 + 1.2), (0, 0.95, -3.16), p("coupling"), lens=35)
    view(cam, (2.3, 0.8, 1.5), (1.1, 0.6, 1.5), p("running_gear"), lens=35)
    view(cam, (-2.2, 0.9, 2.4), (-1.2, 0.7, 2.3), p("brake_rack"), lens=35)
    view(cam, (10.0, 3.0, -7.0), (0, 1.0, -6.4), p("train"), lens=24)
    for o in placed:
        o.hide_render = True
    goods = [n for n in objs if n.startswith("goods_")]
    x = -2.4
    ps = []
    for n in goods:
        ps.append(place(objs, n, x, 0, 0, yaw=0.5))
        x += 1.6
    bpy.context.view_layer.update()
    view(cam, (0, 2.0, 4.0), (0, 0.4, 0), p("goods"), lens=30)


# ------------------------------------------------------------------ main


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    make_materials()
    objs = {}
    for name, fn in BUILDERS:
        m = fn()
        ob = m.to_object(name)
        objs[name] = ob
    counts = {n: tris(o) for n, o in objs.items()}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_wagons] {n:14s} {c:5d} tris")
    print(f"[build_wagons] {len(objs)} parts, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--closeup" in argv or "--sheet" in argv or "--views" in argv:
        preview_materials()
    if "--views" in argv:
        views(objs, argv[argv.index("--views") + 1])
    if "--sheet" in argv:
        i = argv.index("--sheet")
        prefix = argv[i + 1] if len(argv) > i + 1 else "wagon_bl_"
        sheet(objs, prefix)
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = argv[i + 1].split(",")
        rest = [float(v) for v in argv[i + 3:i + 6]]
        az = rest[0] if len(rest) > 0 else -35.0
        el = rest[1] if len(rest) > 1 else 0.45
        dist = rest[2] if len(rest) > 2 else 2.4
        closeup(objs, names, argv[i + 2], az, el, dist)


if __name__ == "__main__":
    main()
