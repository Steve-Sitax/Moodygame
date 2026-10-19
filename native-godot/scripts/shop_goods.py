"""Issue #174: the goods in the town's shop windows, one model per good, and their picture, made in code (numpy, Pillow;
our own work).
    python scripts/shop_goods.py <output folder>
Writes goods.png (2048 x 2048, sRGB) and goods-height.png (1024 x 1024: the relief for the shader's bump): one cell per
surface (crust, wax, glass, leather, felt, cloth, paper, brass, ...), and the price cards' faces; <name>-goods.bin (rows of
16 floats per vertex, as build_shopfronts.py) for each model and models.json (the models: size, triangles, the trades that
show them). scripts/build-shopfronts.gd turns them into assets/models/shopgoods; NativeShopFronts dresses each window by
its trade (world/town/facades/shopfronts.json).

Model space: x across, y up from the model's foot (its base on y = 0), z toward the street; sizes in metres at real size.
Every surface reads the one goods picture (uv inside its cell); the colour is a shade (undersides darker), a copy's own
colour (a little variety) multiplies it in the game.
"""
import json, math, pathlib, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parents[1]
rng = np.random.default_rng(1874)
S = 2048; G = 128                     # the picture and its cells (16 x 16)
atlas = np.zeros((S, S, 3)); height = np.full((S, S), 0.5); cells = {}

def lin(c): c = np.asarray(c, float); return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
def srgb(c):
    c = np.clip(np.asarray(c, float), 0, 1); return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)
def noise(h, w, scale, seed, oct=4):
    g = np.random.default_rng(seed); out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(oct):
        s = max(1, int(scale / 2 ** o)); small = g.standard_normal((h // s + 2, w // s + 2))
        im = Image.fromarray(small.astype(np.float32)).resize((w + 2 * s, h + 2 * s), Image.BICUBIC)
        out += np.asarray(im)[s:s + h, s:s + w] * amp; tot += amp; amp *= 0.5
    return out / tot

slot = [0]
def cell(name, rgb, hgt=None):
    """Put a G x G picture (linear rgb, 0..1) and its height into the next cell."""
    i = slot[0]; slot[0] += 1; x, y = (i % 16) * G, (i // 16) * G
    atlas[y:y + G, x:x + G] = rgb
    if hgt is not None: height[y:y + G, x:x + G] = hgt
    # (2 texels in: a cell's edge never samples its neighbour, mipmaps included up to a 16-texel cell)
    cells[name] = [(x + 3) / S, (y + 3) / S, (x + G - 3) / S, (y + G - 3) / S]

def plain(name, rgb, var=0.08, scale=10, seed=0, hv=0.06):
    n = noise(G, G, scale, 500 + seed, 3)
    cell(name, lin(rgb) * (1 + var * n[..., None]), 0.5 + hv * n)

# ------------------------------------------------------------------ the pictures
seed = [0]
def sd(): seed[0] += 1; return seed[0]
yy, xx = np.mgrid[0:G, 0:G] / G
# bread: crust with flour dust and darker scoring, rye darker
for nm, base in (("crust", (0.72, 0.46, 0.2)), ("crust_dark", (0.42, 0.26, 0.12)), ("crust_pale", (0.84, 0.66, 0.38))):
    n1, n2 = noise(G, G, 14, sd()), noise(G, G, 3, sd())
    c = lin(base) * (1 + 0.18 * n1[..., None]); flour = np.clip(n2 * 1.3 - 0.7, 0, 1)
    c = c * (1 - flour[..., None] * 0.5) + lin((0.95, 0.92, 0.85)) * flour[..., None] * 0.5
    cell(nm, c, 0.5 + 0.12 * n1 + 0.05 * n2)
n1 = noise(G, G, 6, sd()); cell("crumb", lin((0.93, 0.86, 0.68)) * (1 + 0.1 * n1[..., None]) * (1 - 0.35 * (noise(G, G, 2, sd()) > 0.9)[..., None]), 0.5 + 0.1 * n1)
n1 = noise(G, G, 8, sd()); cell("tart", lin((0.55, 0.12, 0.12)) * (1 + 0.25 * n1[..., None]), 0.5 + 0.2 * n1)       # cherries in syrup
n1 = noise(G, G, 12, sd()); cell("gingerbread", lin((0.45, 0.24, 0.1)) * (1 + 0.1 * n1[..., None]), 0.5 + 0.04 * n1)
plain("almond", (0.85, 0.75, 0.55), 0.1, 3, sd(), 0.15)
# cheese and wax
plain("wax_red", (0.62, 0.06, 0.05), 0.05, 20, sd(), 0.02); plain("rind", (0.86, 0.66, 0.24), 0.12, 10, sd(), 0.08)
n1 = noise(G, G, 4, sd()); holes = (noise(G, G, 6, sd()) > 1.25)
cell("cheese", lin((0.95, 0.83, 0.45)) * (1 + 0.05 * n1[..., None]) * (1 - 0.4 * holes[..., None]), 0.5 - 0.3 * holes)
# paper, tins, labels (a printed band with a few lines of fine "lettering")
def label(name, ground, ink, band):
    n1 = noise(G, G, 30, sd()); c = np.ones((G, G, 3)) * lin(ground) * (1 + 0.04 * n1[..., None])
    b0, b1 = band; c[int(b0 * G):int(b1 * G)] = lin((0.93, 0.9, 0.8))
    for k in range(3):  # (lines of tiny print)
        y = int((b0 + (b1 - b0) * (0.3 + 0.2 * k)) * G); x0 = int(0.18 * G + 4 * k); x1 = int(0.82 * G - 6 * k)
        c[y:y + 2, x0:x1] = lin(ink)
    c[int(b0 * G):int(b0 * G) + 2] = lin(ink); c[int(b1 * G) - 2:int(b1 * G)] = lin(ink)
    cell(name, c, 0.5 + 0.02 * n1)
label("paper_blue", (0.12, 0.2, 0.42), (0.1, 0.1, 0.12), (0.62, 0.8))
label("tin_red", (0.55, 0.08, 0.06), (0.15, 0.08, 0.05), (0.35, 0.68)); label("tin_green", (0.12, 0.3, 0.16), (0.08, 0.1, 0.06), (0.35, 0.68))
label("tin_black", (0.06, 0.06, 0.07), (0.7, 0.55, 0.2), (0.35, 0.68))
label("jar_label", (0.5, 0.18, 0.12), (0.1, 0.06, 0.04), (0.4, 0.75))
plain("paper_white", (0.88, 0.86, 0.8), 0.04, 30, sd(), 0.02); plain("paper_brown", (0.55, 0.4, 0.25), 0.08, 20, sd(), 0.03)
# glass: dark bottle green, brown, the globes' coloured waters (a bright streak of the window down one side)
def glassc(name, base):
    c = np.ones((G, G, 3)) * lin(base); streak = np.exp(-((xx - 0.3) / 0.06) ** 2) * 0.9 + np.exp(-((xx - 0.72) / 0.03) ** 2) * 0.35
    c = c + streak[..., None] * lin((0.7, 0.75, 0.75)) * 0.5; cell(name, c, np.full((G, G), 0.5))
glassc("glass_green", (0.06, 0.16, 0.08)); glassc("glass_brown", (0.2, 0.09, 0.03)); glassc("glass_clear", (0.42, 0.5, 0.5))
glassc("water_red", (0.55, 0.04, 0.06)); glassc("water_green", (0.06, 0.42, 0.16)); glassc("water_blue", (0.06, 0.16, 0.55))
# delft: blue brushwork on white glaze
c = np.ones((G, G, 3)) * lin((0.9, 0.9, 0.86)); n1 = noise(G, G, 5, sd())
brush = (np.abs(np.sin(xx * 18 + n1 * 2) * np.cos(yy * 14 + n1)) > 0.75) | (np.abs(yy - 0.2) < 0.02) | (np.abs(yy - 0.85) < 0.02)
c[brush] = lin((0.12, 0.2, 0.55)); cell("delft", c, np.full((G, G), 0.5))
# leather, felt, cloth
for nm, base in (("leather_black", (0.06, 0.05, 0.05)), ("leather_brown", (0.32, 0.17, 0.08)), ("leather_tan", (0.55, 0.33, 0.16))):
    n1 = noise(G, G, 2, sd()); n2 = noise(G, G, 16, sd())
    cell(nm, lin(base) * (1 + 0.12 * n1[..., None] + 0.18 * n2[..., None]), 0.5 + 0.1 * n1)
for nm, base in (("felt_black", (0.05, 0.05, 0.055)), ("felt_brown", (0.3, 0.2, 0.12)), ("felt_grey", (0.42, 0.42, 0.4))):
    n1 = noise(G, G, 1, sd(), 2); cell(nm, lin(base) * (1 + 0.15 * n1[..., None]), 0.5 + 0.05 * n1)
def weave(name, a, b, kind):
    n1 = noise(G, G, 1, sd(), 2)
    if kind == "check": m = ((np.floor(xx * 8) + np.floor(yy * 8)) % 2)[..., None]
    elif kind == "stripe": m = (np.floor(xx * 12) % 3 == 0)[..., None].astype(float)
    elif kind == "tweed": m = (noise(G, G, 2, sd(), 2) > 0.2)[..., None].astype(float)
    else: m = (np.sin(xx * 40) * np.sin(yy * 40) > 0.6)[..., None].astype(float)  # a small print
    c = lin(a) * (1 - m) + lin(b) * m; c *= (1 + 0.12 * n1[..., None] + 0.06 * (np.sin(xx * G * 2.5)[..., None]))
    cell(name, c, 0.5 + 0.06 * n1)
weave("cloth_check", (0.15, 0.2, 0.35), (0.6, 0.55, 0.45), "check"); weave("cloth_stripe", (0.5, 0.45, 0.38), (0.3, 0.08, 0.06), "stripe")
weave("cloth_tweed", (0.3, 0.26, 0.2), (0.45, 0.4, 0.32), "tweed"); weave("cloth_print", (0.75, 0.68, 0.55), (0.45, 0.12, 0.15), "print")
plain("cloth_wool", (0.22, 0.24, 0.3), 0.1, 1, sd(), 0.05); plain("cloth_linen", (0.8, 0.76, 0.66), 0.08, 1, sd(), 0.04)
plain("velvet_red", (0.32, 0.03, 0.04), 0.12, 6, sd(), 0.02); plain("velvet_green", (0.04, 0.18, 0.08), 0.12, 6, sd(), 0.02)
# woods, metals, sacking, rope, beans, grain
for nm, base in (("mahogany", (0.3, 0.1, 0.05)), ("pine", (0.62, 0.45, 0.26)), ("oak", (0.45, 0.32, 0.18))):
    n1 = noise(G, G, 3, sd()); g = np.sin((xx * 3 + n1 * 0.6) * 40) * 0.5 + 0.5
    cell(nm, lin(base) * (0.85 + 0.25 * g[..., None]), 0.5 + 0.05 * g)
plain("brass", (0.72, 0.55, 0.24), 0.1, 6, sd(), 0.02); plain("pewter", (0.5, 0.51, 0.5), 0.08, 6, sd(), 0.02)
plain("iron", (0.12, 0.12, 0.12), 0.15, 4, sd(), 0.04); plain("copper", (0.6, 0.3, 0.16), 0.1, 6, sd(), 0.02)
c = np.ones((G, G, 3)) * lin((0.6, 0.49, 0.32)); wv = (0.5 + 0.5 * np.sin(xx * 2 * math.pi * 24) * np.sin(yy * 2 * math.pi * 24))[..., None]
slub = (0.5 + 0.5 * np.sin(yy * 2 * math.pi * 9 + 3 * noise(G, G, 3, sd())))[..., None]  # (jute's uneven threads: lighter and darker bands)
cell("sacking", c * (0.8 + 0.25 * wv) * (0.9 + 0.2 * slub) * (1 + 0.12 * noise(G, G, 8, sd())[..., None]), 0.5 + 0.15 * wv[..., 0])
tw = (np.sin((xx + yy) * 50) * 0.5 + 0.5)[..., None]; cell("rope", lin((0.6, 0.5, 0.33)) * (0.75 + 0.35 * tw), 0.5 + 0.25 * tw[..., 0])
bn = (noise(G, G, 2, sd(), 2) > -0.1)[..., None]; cell("beans", lin((0.22, 0.11, 0.05)) * (0.7 + 0.5 * bn), 0.5 + 0.25 * bn[..., 0])
gr = (noise(G, G, 1, sd(), 2) > 0)[..., None]; cell("grain", lin((0.8, 0.65, 0.35)) * (0.8 + 0.3 * gr), 0.5 + 0.2 * gr[..., 0])
n1 = noise(G, G, 8, sd()); cell("ham", lin((0.5, 0.2, 0.1)) * (1 + 0.2 * n1[..., None]), 0.5 + 0.1 * n1)
n1 = noise(G, G, 4, sd()); fat = (noise(G, G, 10, sd()) > 0.6)[..., None]
cell("meat", lin((0.55, 0.1, 0.1)) * (1 - fat) * (1 + 0.15 * n1[..., None]) + lin((0.9, 0.85, 0.75)) * fat, 0.5 + 0.08 * n1)
plain("sausage", (0.45, 0.16, 0.1), 0.15, 3, sd(), 0.08); plain("marble", (0.85, 0.85, 0.82), 0.06, 20, sd(), 0.01)
plain("scales_fish", (0.6, 0.62, 0.6), 0.1, 1, sd(), 0.05); plain("ice", (0.8, 0.86, 0.88), 0.05, 4, sd(), 0.06)
plain("brass_dark", (0.42, 0.3, 0.12), 0.1, 6, sd(), 0.02); plain("black", (0.04, 0.04, 0.04), 0.05, 6, sd(), 0.02)
plain("white_china", (0.9, 0.89, 0.86), 0.03, 10, sd(), 0.01); plain("lampglass", (0.9, 0.86, 0.72), 0.02, 10, sd(), 0.0)
plain("candle", (0.92, 0.88, 0.75), 0.03, 10, sd(), 0.01)

# the clock face: white enamel, black numerals round, the hands (drawn bigger, then reduced)
def font(size, slab=False):
    return ImageFont.truetype(str(ROOT / ("fonts/alfa-slab-one-latin-400-normal.woff2" if slab else "fonts/old-standard-tt-latin-700-normal.woff2")), size)
big = Image.new("RGB", (G * 4, G * 4), (232, 228, 214)); d = ImageDraw.Draw(big); cx = cy = G * 2
d.ellipse([10, 10, G * 4 - 10, G * 4 - 10], outline=(40, 34, 30), width=10)
f = font(52)
for h in range(1, 13):
    a = math.radians(h * 30 - 90); s = ["I", "II", "III", "IIII", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII"][h - 1]
    x, y = cx + 196 * math.cos(a), cy + 196 * math.sin(a); d.text((x, y), s, fill=(25, 22, 20), font=f, anchor="mm")
d.line([cx, cy, cx + 90, cy - 100], fill=(15, 12, 10), width=10); d.line([cx, cy, cx - 20, cy - 180], fill=(15, 12, 10), width=7)
cell("clockface", lin(np.asarray(big.resize((G, G), Image.LANCZOS)) / 255.0))
# the price cards: white card, a black border, the price written large (centimes and francs)
PRICES = ["4 c.", "12 c.", "25 c.", "60 c.", "1 fr.", "2 fr. 50"]
for i, p in enumerate(PRICES):
    big = Image.new("RGB", (G * 4, G * 4), (236, 232, 220)); d = ImageDraw.Draw(big)
    d.rectangle([14, 90, G * 4 - 14, G * 4 - 90], outline=(30, 25, 22), width=8)
    d.text((G * 2, G * 2), p, fill=(25, 20, 18), font=font(150 if len(p) < 6 else 104, slab=True), anchor="mm")
    cell(f"price_{i}", lin(np.asarray(big.resize((G, G), Image.LANCZOS)) / 255.0))

# ------------------------------------------------------------------ the models
class Mesh:
    def __init__(self): self.rows = []
    def tri(self, ps, n, uvs, shade=1.0):
        a, b, c = (np.asarray(p, float) for p in ps)
        if np.linalg.norm(np.cross(b - a, c - a)) < 1e-14: return
        n = np.asarray(n, float); n = n / (np.linalg.norm(n) + 1e-12)
        if n[1] < -0.5: shade *= 0.7
        rows = [[*p, *n, *uv, 0.0, 0.0, shade, shade, shade, 1.0, 0.0, 0.0] for p, uv in zip((a, b, c), uvs)]
        if np.dot(np.cross(c - a, b - a), n) < 0: rows[1], rows[2] = rows[2], rows[1]
        self.rows += rows
    def trin(self, ps, ns, uvs, shade=1.0):
        """A triangle with a normal per corner (smooth shading)."""
        a, b, c = (np.asarray(p, float) for p in ps)
        if np.linalg.norm(np.cross(b - a, c - a)) < 1e-14: return
        ns = [np.asarray(n, float) / (np.linalg.norm(n) + 1e-12) for n in ns]
        rows = [[*p, *n, *uv, 0.0, 0.0, shade * (0.7 if n[1] < -0.5 else 1.0), shade * (0.7 if n[1] < -0.5 else 1.0), shade * (0.7 if n[1] < -0.5 else 1.0), 1.0, 0.0, 0.0] for p, n, uv in zip((a, b, c), ns, uvs)]
        fn = np.cross(c - a, b - a)
        if np.dot(fn, ns[0] + ns[1] + ns[2]) < 0: rows[1], rows[2] = rows[2], rows[1]
        self.rows += rows
    def add(self, o, M=np.eye(3), t=(0, 0, 0)):
        r = np.asarray(o.rows, float).copy()
        if len(r):
            r[:, 0:3] = r[:, 0:3] @ np.asarray(M).T + t
            n = r[:, 3:6] @ np.linalg.inv(np.asarray(M))  # (normals by the inverse transpose)
            r[:, 3:6] = n / np.linalg.norm(n, axis=1, keepdims=True)
            self.rows += r.tolist()

def cuv(name, u, v):
    """uv inside a cell; u and v in 0..1 (clamped)."""
    x0, y0, x1, y1 = cells[name]; u = min(max(u, 0.0), 1.0); v = min(max(v, 0.0), 1.0)
    return (x0 + (x1 - x0) * u, y0 + (y1 - y0) * (1 - v))

def rot(axis, a):
    axis = np.asarray(axis, float); axis /= np.linalg.norm(axis); x, y, z = axis; c, s = math.cos(a), math.sin(a); C = 1 - c
    return np.array([[c + x * x * C, x * y * C - z * s, x * z * C + y * s], [y * x * C + z * s, c + y * y * C, y * z * C - x * s], [z * x * C - y * s, z * y * C + x * s, c + z * z * C]])

def lathe(m, prof, mat, sides=16, uvmode="wrap", smooth=True, rows=None):
    """A turned body round y: profile [(r, y)] from the foot up; uv: u round, v up the profile's length (inside its cell).
    rows: a profile index -> cell name map to change the cell part way (a label band)."""
    L = np.concatenate([[0], np.cumsum([math.hypot(prof[i + 1][0] - prof[i][0], prof[i + 1][1] - prof[i][1]) for i in range(len(prof) - 1)])]); L = L / max(L[-1], 1e-9)
    def P(r, y, i): a = 2 * math.pi * i / sides; return np.array((r * math.cos(a), y, r * math.sin(a)))
    def N(k, i):
        # the profile's normal at k (averaged over its two segments), turned to angle i
        def seg(j):
            (r0, y0), (r1, y1) = prof[j], prof[j + 1]; d = np.array((r1 - r0, y1 - y0)); return np.array((d[1], -d[0])) / (np.linalg.norm(d) + 1e-12)
        nn = seg(min(k, len(prof) - 2)) if k in (0, len(prof) - 1) or not smooth else (seg(k - 1) + seg(k)) / 2
        a = 2 * math.pi * i / sides; return np.array((nn[0] * math.cos(a), nn[1], nn[0] * math.sin(a)))
    for k in range(len(prof) - 1):
        name = (rows or {}).get(k, mat)
        (r0, y0), (r1, y1) = prof[k], prof[k + 1]
        if abs(r0 - r1) < 1e-9 and abs(y0 - y1) < 1e-9: continue
        for i in range(sides):
            q = [P(r0, y0, i), P(r0, y0, i + 1), P(r1, y1, i + 1), P(r1, y1, i)]
            uv = [cuv(name, i / sides, L[k]), cuv(name, (i + 1) / sides, L[k]), cuv(name, (i + 1) / sides, L[k + 1]), cuv(name, i / sides, L[k + 1])]
            if smooth:
                ns = [N(k, i), N(k, i + 1), N(k + 1, i + 1), N(k + 1, i)]
                if r0 < 1e-9: m.trin((q[1], q[2], q[3]), (ns[1], ns[2], ns[3]), (uv[1], uv[2], uv[3]))
                elif r1 < 1e-9: m.trin((q[0], q[1], q[2]), (ns[0], ns[1], ns[2]), (uv[0], uv[1], uv[2]))
                else: m.trin(q[:3], ns[:3], uv[:3]); m.trin((q[0], q[2], q[3]), (ns[0], ns[2], ns[3]), (uv[0], uv[2], uv[3]))
            else:
                n = np.cross(q[1] - q[0], q[3] - q[0]) if r0 > 1e-9 else np.cross(q[2] - q[1], q[3] - q[1])
                mid = (q[0] + q[2]) / 2; n = n if np.dot(n, mid - np.array((0, (y0 + y1) / 2, 0))) >= 0 else -n
                m.tri(q[:3], n, uv[:3]); m.tri((q[0], q[2], q[3]), n, (uv[0], uv[2], uv[3]))

def blob(m, mat, rx, ry, rz, segs=(14, 9), squash=None, rough=0.0, seed=0, flat=0.25):
    """A soft rounded body (a loaf, a cheese, a ham): an ellipsoid on y = 0, its bottom flattened (`flat` of its height),
    `squash`(u, v) -> radial scale; normals from the shape. uv: u round, v up."""
    g = np.random.default_rng(seed); nu, nv = segs; ph = g.uniform(0, 6.28, 4)
    def S(u, v):
        th = 2 * math.pi * u; phi = math.pi * v - math.pi / 2  # v 0 bottom .. 1 top
        k = 1.0 + rough * (0.5 * math.sin(3 * th + ph[0]) * math.cos(2 * phi + ph[1]) + 0.3 * math.sin(5 * th + ph[2]))
        if squash: k *= squash(u, v)
        x, y, z = rx * math.cos(phi) * math.cos(th) * k, ry * (math.sin(phi) + 1), rz * math.cos(phi) * math.sin(th) * k
        return np.array((x, max(y, ry * flat * 2) if v < 0.5 else y, z))
    P = [[S(i / nu, j / nv) for i in range(nu + 1)] for j in range(nv + 1)]
    def N(i, j):
        a = P[j][(i + 1) % nu] - P[j][(i - 1) % nu]; b = P[min(j + 1, nv)][i % nu] - P[max(j - 1, 0)][i % nu]
        n = np.cross(b, a); c = P[j][i] - np.array((0, ry, 0))
        return n if np.dot(n, c) >= 0 else -n
    for j in range(nv):
        for i in range(nu):
            q = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i]]; ns = [N(i, j), N(i + 1, j), N(i + 1, j + 1), N(i, j + 1)]
            uv = [cuv(mat, i / nu, j / nv), cuv(mat, (i + 1) / nu, j / nv), cuv(mat, (i + 1) / nu, (j + 1) / nv), cuv(mat, i / nu, (j + 1) / nv)]
            if j == 0: ns[0] = ns[1] = np.array((0, -1.0, 0))
            m.trin(q[:3], ns[:3], uv[:3]); m.trin((q[0], q[2], q[3]), (ns[0], ns[2], ns[3]), (uv[0], uv[2], uv[3]))

def box(m, mat, lo, hi, ch=0.003, faces=None):
    """A box with chamfered arrises (8 corners cut): uv per face in its cell (or faces: {axis+sign: cell})."""
    lo, hi = np.asarray(lo, float), np.asarray(hi, float); c, h = (lo + hi) / 2, (hi - lo) / 2
    for ax in range(3):
        for s in (-1, 1):
            n = np.zeros(3); n[ax] = s; u_ax, v_ax = [a for a in range(3) if a != ax]
            if ax == 1: u_ax, v_ax = 0, 2
            name = (faces or {}).get(("xyz"[ax], s), mat)
            corners = []
            for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                p = c.copy(); p[ax] += s * h[ax]; p[u_ax] += du * (h[u_ax] - ch); p[v_ax] += dv * (h[v_ax] - ch); corners.append(p)
            uv = [cuv(name, (du + 1) / 2, (dv + 1) / 2) for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
            m.tri(corners[:3], n, uv[:3]); m.tri((corners[0], corners[2], corners[3]), n, (uv[0], uv[2], uv[3]))
    if ch > 0:  # the chamfers (12 edges as quads, 8 corner triangles)
        for ax in range(3):
            a1, a2 = [a for a in range(3) if a != ax]
            for s1 in (-1, 1):
                for s2 in (-1, 1):
                    q = []
                    for e in (-1, 1):
                        p1 = c.copy(); p1[ax] += e * (h[ax] - ch); p1[a1] += s1 * h[a1]; p1[a2] += s2 * (h[a2] - ch)
                        p2 = c.copy(); p2[ax] += e * (h[ax] - ch); p2[a1] += s1 * (h[a1] - ch); p2[a2] += s2 * h[a2]
                        q += [p1, p2]
                    n = np.zeros(3); n[a1] = s1; n[a2] = s2
                    uv = [cuv(mat, 0.5, 0.5)] * 3
                    m.tri((q[0], q[1], q[3]), n, uv); m.tri((q[0], q[3], q[2]), n, uv)
        for sx in (-1, 1):
            for sy in (-1, 1):
                for sz in (-1, 1):
                    s = np.array((sx, sy, sz)); ps = []
                    for ax in range(3):
                        p = c + s * h; p[ax] -= s[ax] * ch; ps.append(p)
                    m.tri(ps, s, [cuv(mat, 0.5, 0.5)] * 3)

def card_face(m, name, w, h, at, tilt=0.25):
    """A price card standing on a little fold-back foot, its face to +z, leaning back by `tilt`."""
    R = rot((1, 0, 0), -tilt); t = np.asarray(at, float)
    q = [np.array(p) for p in ((-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, h, 0), (-w / 2, h, 0))]
    q = [R @ p + t for p in q]; n = R @ np.array((0, 0, 1.0))
    uv = [cuv(name, 0, 0), cuv(name, 1, 0), cuv(name, 1, 1), cuv(name, 0, 1)]
    m.tri(q[:3], n, uv[:3]); m.tri((q[0], q[2], q[3]), n, (uv[0], uv[2], uv[3]))
    b = [R @ np.array(p) + t for p in ((-w / 2, 0, -0.001), (w / 2, 0, -0.001), (w / 2, h, -0.001), (-w / 2, h, -0.001))]
    uvb = [cuv("paper_white", 0, 0), cuv("paper_white", 1, 0), cuv("paper_white", 1, 1), cuv("paper_white", 0, 1)]
    m.tri(b[:3], -n, uvb[:3]); m.tri((b[0], b[2], b[3]), -n, (uvb[0], uvb[2], uvb[3]))
    # the foot folded back
    f0, f1 = R @ np.array((-w / 2, 0, -0.001)) + t, R @ np.array((w / 2, 0, -0.001)) + t
    f2, f3 = np.array((w / 2, 0.0, -0.035)) + t, np.array((-w / 2, 0.0, -0.035)) + t
    m.tri((f0, f1, f2), (0, 1, 0), uvb[:3]); m.tri((f0, f2, f3), (0, 1, 0), (uvb[0], uvb[2], uvb[3]))

def sub(m, fn, R=np.eye(3), t=(0, 0, 0)):
    """Build a part in its own mesh and add it turned by R and moved by t."""
    p = Mesh(); fn(p); m.add(p, R, t)

M = {}
def model(name, trades, fn, **info):
    m = Mesh(); fn(m); M[name] = (m, trades, info)

# bread
def loaf_round(m):
    blob(m, "crust", 0.11, 0.065, 0.11, (16, 9), rough=0.04, seed=1)
    for k in range(3):  # the cuts across the top: shallow dark grooves (thin strips of darker crust)
        z = (k - 1) * 0.045
        for i in range(8):
            x0, x1 = -0.07 + 0.0175 * i, -0.07 + 0.0175 * (i + 1)
            y0 = 0.13 - 40 * (x0 ** 2 + z ** 2) * 0.13; y1 = 0.13 - 40 * (x1 ** 2 + z ** 2) * 0.13
            q = [np.array((x0, y0 + 0.002, z - 0.004)), np.array((x1, y1 + 0.002, z - 0.004)), np.array((x1, y1 + 0.003, z + 0.004)), np.array((x0, y0 + 0.003, z + 0.004))]
            m.tri(q[:3], (0, 1, 0), [cuv("crust_dark", 0.3, 0.3)] * 3, 0.8); m.tri((q[0], q[2], q[3]), (0, 1, 0), [cuv("crust_dark", 0.3, 0.3)] * 3, 0.8)
def loaf_long(m):
    blob(m, "crust_pale", 0.24, 0.045, 0.055, (18, 8), squash=lambda u, v: 1 - 0.15 * abs(math.cos(2 * math.pi * u)) ** 6, rough=0.03, seed=2)
    for k in range(4):  # the slashes along it
        x = -0.15 + 0.1 * k
        for s in range(2):
            a = np.array((x - 0.035, 0.088 + 0.003 * s, -0.012)); b = np.array((x + 0.035, 0.088 + 0.003 * s, 0.012))
            q = [a, b, b + (0.0, 0.0, 0.01), a + (0.0, 0.0, 0.01)]
            m.tri(q[:3], (0, 1, 0), [cuv("crumb", 0.5, 0.5)] * 3, 0.95); m.tri((q[0], q[2], q[3]), (0, 1, 0), [cuv("crumb", 0.5, 0.5)] * 3, 0.95)
def loaf_tin(m):
    box(m, "crust", (-0.11, 0.0, -0.06), (0.11, 0.09, 0.06), 0.012, faces={("y", 1): "crust_pale"})
    sub(m, lambda p: blob(p, "crust_pale", 0.11, 0.03, 0.062, (14, 6), seed=3, flat=0.0), t=(0, 0.06, 0))
def tart(m):
    lathe(m, [(0.0, 0.0), (0.12, 0.0), (0.125, 0.012), (0.128, 0.03), (0.118, 0.034), (0.11, 0.026), (0.0, 0.026)], "crust", 20,
          rows={4: "tart", 5: "tart"})
    for k in range(-3, 4):  # the lattice
        box(m, "crust_pale", (k * 0.03 - 0.005, 0.026, -0.105 * math.sqrt(max(0, 1 - (k * 0.03 / 0.11) ** 2))), (k * 0.03 + 0.005, 0.031, 0.105 * math.sqrt(max(0, 1 - (k * 0.03 / 0.11) ** 2))), 0.0)
def gingerbread(m):
    box(m, "gingerbread", (-0.14, 0.0, -0.05), (0.14, 0.045, 0.05), 0.008)
    for i in range(6): box(m, "almond", (-0.11 + 0.044 * i, 0.045, -0.012), (-0.09 + 0.044 * i, 0.05, 0.012), 0.002)
model("loaf_round", ["bakery"], loaf_round); model("loaf_long", ["bakery"], loaf_long); model("loaf_tin", ["bakery"], loaf_tin)
model("tart", ["bakery"], tart); model("gingerbread", ["bakery", "grocer"], gingerbread)
# grocer, coffee, corn
def cheese_ball(m): blob(m, "wax_red", 0.07, 0.065, 0.07, (14, 9), seed=4, flat=0.12)
def cheese_wheel(m): lathe(m, [(0.0, 0.0), (0.15, 0.0), (0.168, 0.02), (0.172, 0.05), (0.168, 0.08), (0.15, 0.1), (0.0, 0.1)], "rind", 20)
def cheese_cut(m):
    # a wedge: the rind round its back, the cut faces showing the paste
    a = math.radians(50); r, h = 0.17, 0.1
    for j in range(6):
        t0, t1 = -a / 2 + a * j / 6, -a / 2 + a * (j + 1) / 6
        p0, p1 = np.array((r * math.cos(t0), 0, r * math.sin(t0))), np.array((r * math.cos(t1), 0, r * math.sin(t1)))
        q = [p0, p1, p1 + (0, h, 0), p0 + (0, h, 0)]; n = (p0 + p1) / 2
        m.tri(q[:3], n, [cuv("rind", j / 6, 0), cuv("rind", (j + 1) / 6, 0), cuv("rind", (j + 1) / 6, 1)]); m.tri((q[0], q[2], q[3]), n, [cuv("rind", j / 6, 0), cuv("rind", (j + 1) / 6, 1), cuv("rind", j / 6, 1)])
        for y, ny in ((0.0, -1), (h, 1)):
            m.tri((np.array((0, y, 0)), p0 + (0, y, 0), p1 + (0, y, 0)), (0, ny, 0), [cuv("cheese", 0.5, 0.0), cuv("cheese", 0, 1), cuv("cheese", 1, 1)])
    for t in (-a / 2, a / 2):
        p = np.array((r * math.cos(t), 0, r * math.sin(t))); n = np.array((-math.sin(t), 0, math.cos(t))) * (1 if t > 0 else -1)
        q = [np.zeros(3), p, p + (0, h, 0), np.array((0, h, 0))]
        m.tri(q[:3], n, [cuv("cheese", 0, 0), cuv("cheese", 1, 0), cuv("cheese", 1, 1)]); m.tri((q[0], q[2], q[3]), n, [cuv("cheese", 0, 0), cuv("cheese", 1, 1), cuv("cheese", 0, 1)])
def sugarloaf(m): lathe(m, [(0.0, 0.0), (0.075, 0.0), (0.072, 0.03), (0.05, 0.18), (0.025, 0.28), (0.0, 0.31)], "paper_blue", 14)
def canister(m, cellname="tin_red"):
    lathe(m, [(0.0, 0.0), (0.06, 0.0), (0.062, 0.004), (0.062, 0.16), (0.064, 0.165), (0.064, 0.185), (0.05, 0.19), (0.0, 0.19)], cellname, 18,
          rows={0: "black", 4: "black", 5: "black", 6: "black"})
def jar(m):
    lathe(m, [(0.0, 0.0), (0.05, 0.0), (0.055, 0.01), (0.056, 0.1), (0.046, 0.12), (0.04, 0.13), (0.045, 0.135), (0.046, 0.15), (0.0, 0.152)], "glass_brown", 16,
          rows={2: "jar_label", 5: "cloth_check", 6: "cloth_check", 7: "cloth_check"})
def sack_small(m, fill="beans"):
    """A small sack stood open: soft sides near straight (a little belly at the foot, where the weight sits), creased up its
    height, squashed a little out of round; the cloth rolled down in a thick lumpy roll round a wide mouth, the beans or
    grain heaped inside."""
    prof = [(0.0, 0.0), (0.1, 0.0), (0.122, 0.008), (0.133, 0.035), (0.132, 0.08), (0.126, 0.14), (0.121, 0.185), (0.119, 0.2)]
    body = Mesh(); lathe(body, prof, "sacking", 24)
    r = np.asarray(body.rows); th = np.arctan2(r[:, 2], r[:, 0]); up = r[:, 1] / 0.2
    # (creases run up the sides, deeper toward the mouth where the cloth gathers; the whole leans and squashes a little)
    k = 1 + 0.045 * np.sin(th * 5 + 0.7) * (0.35 + up) + 0.025 * np.sin(th * 11 + 1.9) * up - 0.03 * np.abs(np.sin(th * 3)) * up ** 2
    r[:, 0] *= k * 1.07; r[:, 2] *= k * 0.93; r[:, 0] += 0.012 * up ** 2; body.rows = r.tolist(); m.add(body)
    rim = Mesh(); lathe(rim, [(0.112, 0.196), (0.132, 0.2), (0.146, 0.214), (0.142, 0.232), (0.124, 0.238), (0.108, 0.226)], "sacking", 24)
    r = np.asarray(rim.rows); th = np.arctan2(r[:, 2], r[:, 0])
    k = 1 + 0.06 * np.sin(th * 4 + 0.3) + 0.03 * np.sin(th * 9 + 2.2)  # (a rolled roll of cloth is never even)
    r[:, 0] *= k * 1.07; r[:, 2] *= k * 0.93; r[:, 0] += 0.012; r[:, 1] += 0.008 * np.sin(th * 3 + 1.1); rim.rows = r.tolist(); m.add(rim)
    heap = Mesh(); lathe(heap, [(0.0, 0.252), (0.05, 0.248), (0.09, 0.236), (0.116, 0.222)], fill, 24)
    r = np.asarray(heap.rows); r[:, 0] = r[:, 0] * 1.07 + 0.012; r[:, 2] *= 0.93; heap.rows = r.tolist(); m.add(heap)
def coffee_mill(m):
    box(m, "mahogany", (-0.07, 0.0, -0.07), (0.07, 0.13, 0.07), 0.006); box(m, "brass", (-0.03, 0.04, 0.07), (0.03, 0.07, 0.085), 0.002)
    lathe(m, [(0.0, 0.13), (0.06, 0.13), (0.065, 0.15), (0.04, 0.17), (0.012, 0.18), (0.0, 0.18)], "brass", 14)
    box(m, "iron", (-0.004, 0.18, -0.004), (0.004, 0.2, 0.004), 0.0); box(m, "iron", (0.0, 0.196, -0.004), (0.09, 0.204, 0.004), 0.0)
    sub(m, lambda p: lathe(p, [(0.0, 0.2), (0.012, 0.2), (0.012, 0.24), (0.0, 0.24)], "mahogany", 8), t=(0.09, 0, 0))
def measure(m):  # a wooden bushel measure, bound in iron, heaped with grain
    lathe(m, [(0.0, 0.004), (0.14, 0.004), (0.15, 0.0), (0.15, 0.16), (0.14, 0.165), (0.135, 0.15), (0.0, 0.15)], "oak", 18, rows={1: "iron", 2: "oak"})
    sub(m, lambda p: blob(p, "grain", 0.135, 0.02, 0.135, (14, 5), seed=8, flat=0.0), t=(0, 0.15, 0))
model("cheese_ball", ["grocer"], cheese_ball); model("cheese_wheel", ["grocer"], cheese_wheel); model("cheese_cut", ["grocer"], cheese_cut)
model("sugarloaf", ["grocer", "coffee"], sugarloaf); model("canister_red", ["grocer", "coffee", "chandler"], lambda m: canister(m, "tin_red"))
model("canister_green", ["grocer", "coffee", "tobacco"], lambda m: canister(m, "tin_green")); model("canister_black", ["coffee", "chandler"], lambda m: canister(m, "tin_black"))
model("jar_preserve", ["grocer"], jar); model("sack_beans", ["coffee", "grocer"], lambda m: sack_small(m, "beans"))
model("sack_grain", ["corn"], lambda m: sack_small(m, "grain")); model("coffee_mill", ["coffee"], coffee_mill); model("measure", ["corn"], measure)
# chemist, wine, taverns
def globe(m, water):
    lathe(m, [(0.0, 0.0), (0.06, 0.0), (0.06, 0.02), (0.02, 0.05), (0.02, 0.07), (0.1, 0.12), (0.13, 0.2), (0.12, 0.3), (0.06, 0.36), (0.03, 0.4), (0.04, 0.44), (0.0, 0.46)], "brass", 18,
          rows={4: water, 5: water, 6: water, 7: water, 8: "glass_clear", 9: "glass_clear", 10: "glass_clear"})
def albarello(m):
    lathe(m, [(0.0, 0.0), (0.05, 0.0), (0.055, 0.02), (0.045, 0.06), (0.044, 0.15), (0.055, 0.19), (0.04, 0.21), (0.042, 0.22), (0.03, 0.235), (0.0, 0.24)], "delft", 16)
def bottle(m, cellname="glass_green", h=0.3):
    lathe(m, [(0.0, 0.0), (0.035, 0.0), (0.037, 0.01), (0.037, h * 0.62), (0.03, h * 0.72), (0.014, h * 0.82), (0.013, h * 0.96), (0.016, h * 0.98), (0.015, h), (0.0, h)], cellname, 14,
          rows={2: "paper_white" if cellname != "glass_brown" else cellname, 7: "black", 8: "black"})
def demijohn(m): lathe(m, [(0.0, 0.0), (0.1, 0.0), (0.15, 0.08), (0.16, 0.18), (0.14, 0.26), (0.05, 0.33), (0.025, 0.36), (0.028, 0.4), (0.0, 0.4)], "sacking", 16, rows={4: "glass_green", 5: "glass_green", 6: "glass_green", 7: "glass_green"})
def keg(m):
    lathe(m, [(0.0, 0.0), (0.1, 0.0), (0.112, 0.02), (0.125, 0.13), (0.112, 0.24), (0.1, 0.26), (0.0, 0.26)], "oak", 18, rows={0: "iron"})
    for y in (0.035, 0.225): lathe(m, [(0.116 + 0.002, y - 0.012), (0.12 + 0.003, y), (0.116 + 0.002, y + 0.012)], "iron", 18)
    # on its side on a cradle
    R = rot((0, 0, 1), math.pi / 2); body = Mesh(); body.rows = m.rows; m.rows = []; m.add(body, R, (0.13, 0.13, 0))
    for x in (-0.09, 0.09): box(m, "oak", (x - 0.02, 0.0, -0.12), (x + 0.02, 0.05, 0.12), 0.004)
def tankard(m): lathe(m, [(0.0, 0.0), (0.045, 0.0), (0.048, 0.01), (0.044, 0.13), (0.048, 0.14), (0.0, 0.14)], "pewter", 14); box(m, "pewter", (0.044, 0.03, -0.006), (0.075, 0.11, 0.006), 0.002)
model("globe_red", ["chemist"], lambda m: globe(m, "water_red")); model("globe_green", ["chemist"], lambda m: globe(m, "water_green"))
model("globe_blue", ["chemist"], lambda m: globe(m, "water_blue")); model("albarello", ["chemist", "tobacco"], albarello)
model("bottle_med", ["chemist"], lambda m: bottle(m, "glass_brown", 0.16)); model("bottle_wine", ["wine", "tavern"], lambda m: bottle(m, "glass_green", 0.31))
model("demijohn", ["wine"], demijohn); model("keg", ["wine", "tavern", "cooper"], keg); model("tankard", ["tavern"], tankard)
# tobacco
def cigar_box(m):
    box(m, "mahogany", (-0.11, 0.0, -0.07), (0.11, 0.05, 0.07), 0.003, faces={("y", 1): "tin_black"})
    lid = Mesh(); box(lid, "mahogany", (-0.11, 0.0, -0.002), (0.11, 0.14, 0.004), 0.002, faces={("z", 1): "jar_label"})
    m.add(lid, rot((1, 0, 0), -0.35), (0, 0.05, -0.07))
    for i in range(7):  # (the cigars lie side by side in the box)
        sub(m, lambda p: lathe(p, [(0.0, 0.0), (0.008, 0.0), (0.008, 0.2), (0.0, 0.2)], "leather_tan", 8), rot((0, 0, 1), math.pi / 2), (0.1, 0.045, -0.054 + 0.018 * i))
def pipe_rack(m):
    box(m, "oak", (-0.12, 0.0, -0.04), (0.12, 0.02, 0.04), 0.003); box(m, "oak", (-0.12, 0.02, -0.04), (0.12, 0.2, -0.025), 0.003)
    for i in range(5):  # clay pipes hung from the rack: bowl and long stem
        x = -0.09 + 0.045 * i
        sub(m, lambda p: lathe(p, [(0.0, 0.0), (0.009, 0.0), (0.011, 0.03), (0.009, 0.034), (0.0, 0.034)], "white_china", 10), t=(x, 0.03, 0.03))
        box(m, "white_china", (x - 0.003, 0.03, -0.022), (x + 0.003, 0.034, 0.03), 0.0)
model("cigar_box", ["tobacco"], cigar_box); model("pipe_rack", ["tobacco"], pipe_rack)
# clockmaker
def mantel_clock(m):
    box(m, "mahogany", (-0.12, 0.0, -0.06), (0.12, 0.03, 0.06), 0.005)
    R = rot((1, 0, 0), math.pi / 2)  # (the drum lies on its side, its face to the street)
    sub(m, lambda p: lathe(p, [(0.0, 0.0), (0.1, 0.0), (0.1, 0.2), (0.0, 0.2)], "mahogany", 20, smooth=False), R, (0, 0.13, -0.05))
    sub(m, lambda p: lathe(p, [(0.0, 0.0), (0.085, 0.0), (0.09, 0.006), (0.0, 0.006)], "brass", 20), R, (0, 0.13, 0.15))
    q = [np.array(p) for p in ((-0.075, 0.055, 0.157), (0.075, 0.055, 0.157), (0.075, 0.205, 0.157), (-0.075, 0.205, 0.157))]
    uv = [cuv("clockface", 0, 0), cuv("clockface", 1, 0), cuv("clockface", 1, 1), cuv("clockface", 0, 1)]
    m.tri(q[:3], (0, 0, 1), uv[:3]); m.tri((q[0], q[2], q[3]), (0, 0, 1), (uv[0], uv[2], uv[3]))
def pocket_watch(m):
    box(m, "velvet_green", (-0.06, 0.0, -0.04), (0.06, 0.03, 0.04), 0.004)
    box(m, "brass", (-0.003, 0.03, -0.003), (0.003, 0.12, 0.003), 0.0)
    sub(m, lambda p: lathe(p, [(0.0, 0.0), (0.024, 0.0), (0.026, 0.004), (0.024, 0.009), (0.0, 0.009)], "brass", 16), rot((1, 0, 0), math.pi / 2 - 0.15), (0, 0.09, 0.006))
    q = [np.array(p) for p in ((-0.02, 0.071, 0.017), (0.02, 0.071, 0.017), (0.02, 0.111, 0.011), (-0.02, 0.111, 0.011))]
    uv = [cuv("clockface", 0, 0), cuv("clockface", 1, 0), cuv("clockface", 1, 1), cuv("clockface", 0, 1)]
    m.tri(q[:3], (0, 0.15, 1), uv[:3]); m.tri((q[0], q[2], q[3]), (0, 0.15, 1), (uv[0], uv[2], uv[3]))
model("mantel_clock", ["clockmaker"], mantel_clock); model("pocket_watch", ["clockmaker"], pocket_watch)
# boots, hats, cloth
def boot(m, leather="leather_black"):
    # the foot: a rounded sole and vamp, the shaft up to the calf
    sub(m, lambda p: blob(p, leather, 0.13, 0.045, 0.045, (14, 7), squash=lambda u, v: 1.0 - 0.25 * (math.cos(2 * math.pi * u) < -0.3), seed=9, flat=0.1), t=(0.05, 0, 0))
    lathe(m, [(0.0, 0.02), (0.05, 0.02), (0.052, 0.08), (0.046, 0.2), (0.05, 0.26), (0.052, 0.27), (0.0, 0.27)], leather, 14)
    box(m, "black", (-0.07, 0.0, -0.05), (0.19, 0.012, 0.05), 0.004)  # the sole and heel
    box(m, "black", (-0.06, 0.0, -0.04), (0.0, 0.03, 0.04), 0.004)
def top_hat(m): lathe(m, [(0.0, 0.0), (0.16, 0.0), (0.165, 0.008), (0.15, 0.012), (0.09, 0.012), (0.088, 0.02), (0.092, 0.17), (0.095, 0.175), (0.0, 0.176)], "felt_black", 22, rows={4: "black", 5: "black"})
def bowler(m): lathe(m, [(0.0, 0.0), (0.145, 0.0), (0.15, 0.012), (0.12, 0.016), (0.095, 0.02), (0.095, 0.04), (0.09, 0.09), (0.06, 0.125), (0.0, 0.135)], "felt_brown", 22, rows={4: "black"})
def hatbox(m):
    lathe(m, [(0.0, 0.0), (0.17, 0.0), (0.17, 0.2), (0.0, 0.2)], "cloth_stripe", 22, smooth=False)
    lathe(m, [(0.0, 0.18), (0.176, 0.18), (0.176, 0.215), (0.0, 0.215)], "paper_brown", 22, smooth=False)
def bolt(m, cloth):
    box(m, "pine", (-0.22, 0.0, -0.01), (0.22, 0.32, 0.01), 0.002)  # the board inside, its ends showing
    box(m, cloth, (-0.2, 0.002, -0.035), (0.2, 0.318, 0.035), 0.02)
def folded(m, cloth):
    for i in range(4): box(m, cloth, (-0.17, 0.035 * i, -0.12), (0.17, 0.035 * (i + 1) - 0.003, 0.12), 0.012)
model("boot_black", ["bootmaker"], boot); model("boot_brown", ["bootmaker"], lambda m: boot(m, "leather_brown"))
model("top_hat", ["hatter"], top_hat); model("bowler", ["hatter"], bowler); model("hatbox", ["hatter"], hatbox)
for c in ("cloth_check", "cloth_stripe", "cloth_tweed", "cloth_print", "cloth_wool"):
    model("bolt_" + c[6:], ["draper"], lambda m, c=c: bolt(m, c))
model("folded_linen", ["draper"], lambda m: folded(m, "cloth_linen")); model("folded_wool", ["draper"], lambda m: folded(m, "cloth_wool"))
# butcher, fish, chandler, locksmith, cooper
def ham(m):
    blob(m, "ham", 0.08, 0.14, 0.07, (14, 9), squash=lambda u, v: 0.6 + 0.6 * (1 - v), seed=10, flat=0.0)
    body = Mesh(); body.rows = m.rows; m.rows = []; m.add(body, np.diag((1.0, -1.0, -1.0)), (0, 0.32, 0))  # (hung upside down from its hook)
    box(m, "rope", (-0.004, 0.32, -0.004), (0.004, 0.42, 0.004), 0.0)
def sausages(m):
    for i in range(5):
        sub(m, lambda p: lathe(p, [(0.0, 0.0), (0.012, 0.01), (0.014, 0.05), (0.014, 0.25), (0.012, 0.29), (0.0, 0.3)], "sausage", 10), t=(-0.06 + 0.03 * i, 0.02 * (i % 2) - 0.02, 0))
    box(m, "iron", (-0.09, 0.3, -0.004), (0.09, 0.312, 0.004), 0.0)
def joint(m):
    lathe(m, [(0.0, 0.0), (0.15, 0.0), (0.152, 0.012), (0.0, 0.012)], "white_china", 20)
    sub(m, lambda p: blob(p, "meat", 0.11, 0.05, 0.08, (14, 8), seed=11, flat=0.15), t=(0, 0.012, 0))
def slab(m):  # a fishmonger's marble slab on the bed, crushed ice on it
    box(m, "marble", (-0.3, 0.0, -0.12), (0.3, 0.03, 0.12), 0.006)
    sub(m, lambda p: blob(p, "ice", 0.27, 0.012, 0.1, (12, 4), seed=12, flat=0.0, rough=0.2), t=(0, 0.03, 0))
def lantern(m):
    lathe(m, [(0.0, 0.0), (0.07, 0.0), (0.07, 0.02), (0.06, 0.03), (0.06, 0.2), (0.07, 0.21), (0.05, 0.26), (0.02, 0.29), (0.025, 0.31), (0.0, 0.32)], "copper", 12, rows={4: "lampglass"})
    for a in range(4): box(m, "copper", (0.058 * math.cos(a * math.pi / 2) - 0.004, 0.03, 0.058 * math.sin(a * math.pi / 2) - 0.004), (0.058 * math.cos(a * math.pi / 2) + 0.004, 0.2, 0.058 * math.sin(a * math.pi / 2) + 0.004), 0.0)
def keys(m):
    box(m, "oak", (-0.16, 0.0, -0.012), (0.16, 0.3, 0.0), 0.004)
    for i in range(10):  # keys hung on pins: bow, shank, bit
        x, y = -0.13 + 0.065 * (i % 5), 0.22 - 0.13 * (i // 5)
        box(m, "brass" if i % 3 else "iron", (x - 0.003, y - 0.06, 0.004), (x + 0.003, y, 0.008), 0.0)
        sub(m, lambda p, i=i: lathe(p, [(0.008, 0.0), (0.014, 0.0), (0.014, 0.004), (0.008, 0.004)], "brass" if i % 3 else "iron", 8), rot((1, 0, 0), math.pi / 2), (x, y + 0.012, 0.004))
        box(m, "brass" if i % 3 else "iron", (x + 0.003, y - 0.06, 0.004), (x + 0.012, y - 0.045, 0.008), 0.0)
def padlock(m):
    box(m, "iron", (-0.035, 0.0, -0.012), (0.035, 0.06, 0.012), 0.006)
    sub(m, lambda p: lathe(p, [(0.02, 0.0), (0.028, 0.0), (0.028, 0.006), (0.02, 0.006)], "iron", 10), rot((1, 0, 0), math.pi / 2), (0, 0.06, 0.003))
def coil(m):
    for k in range(4):  # a flat coil of rope, turn on turn
        lathe(m, [(0.06 + 0.03 * k, 0.0), (0.075 + 0.03 * k, 0.012), (0.08 + 0.03 * k, 0.025), (0.075 + 0.03 * k, 0.038), (0.06 + 0.03 * k, 0.045)], "rope", 18)
def bucket(m):
    lathe(m, [(0.0, 0.0), (0.09, 0.0), (0.11, 0.18), (0.105, 0.18), (0.086, 0.01), (0.0, 0.01)], "oak", 16, smooth=False, rows={1: "oak"})
    for y in (0.03, 0.15): lathe(m, [(0.093 + y * 0.11, y - 0.008), (0.097 + y * 0.11, y), (0.093 + y * 0.11, y + 0.008)], "iron", 16)
model("ham", ["butcher"], ham); model("sausages", ["butcher"], sausages); model("joint", ["butcher"], joint); model("slab", ["fish", "butcher"], slab)
model("lantern", ["chandler"], lantern); model("rope_coil", ["chandler", "ropemaker"], coil); model("key_board", ["locksmith"], keys)
model("padlock", ["locksmith"], padlock); model("bucket", ["cooper"], bucket)
# the price cards and the window's lamp (its glass the lamp's light at night)
for i, p in enumerate(PRICES):
    model(f"price_{i}", ["all"], lambda m, i=i: card_face(m, f"price_{i}", 0.09, 0.064, (0, 0.0, 0.03)), price=p)
def lamp(m):
    """A shop's hanging oil lamp: brass font and burner, a glass chimney under a white shade, hung from the ceiling on a rod."""
    lathe(m, [(0.0, 0.0), (0.03, 0.005), (0.06, 0.03), (0.065, 0.06), (0.05, 0.085), (0.02, 0.1), (0.022, 0.12), (0.0, 0.12)], "brass", 12)
    m.glow = Mesh(); lathe(m.glow, [(0.018, 0.12), (0.024, 0.14), (0.026, 0.2), (0.02, 0.26), (0.0, 0.26)], "lampglass", 12)  # (its own surface: it glows)
    lathe(m, [(0.03, 0.18), (0.13, 0.23), (0.14, 0.24), (0.04, 0.28), (0.035, 0.27)], "white_china", 12)
    box(m, "brass", (-0.004, 0.26, -0.004), (0.004, 0.6, 0.004), 0.0)
model("lamp", ["all"], lamp)

# ------------------------------------------------------------------ write
Image.fromarray((srgb(atlas) * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / "goods.png")
# the display cloth (a light wool, dyed by each copy's colour; it repeats) and the shop glass (clear, a little dust and
# streaks of the window cleaner's leather; its alpha is how much of the glass shows)
C = 256; cy_, cx_ = np.mgrid[0:C, 0:C] / C
wool = 0.75 + 0.1 * np.sin(cx_ * 2 * math.pi * 64) * np.sin(cy_ * 2 * math.pi * 64) + 0.08 * noise(C, C, 6, 991)
fold = 0.85 + 0.15 * np.sin(cx_ * 2 * math.pi * 3 + noise(C, C, 40, 992) * 0.8)
Image.fromarray((srgb(np.clip(wool * fold, 0, 1)[..., None].repeat(3, -1)) * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / "cloth.png")
dust = np.clip(0.012 + 0.012 * noise(C, C, 20, 993) + 0.015 * np.clip(np.sin((cx_ + cy_ * 0.3) * 2 * math.pi * 2 + noise(C, C, 30, 994) * 2), 0, 1), 0, 0.05)
g = np.dstack([np.full((C, C), 0.62), np.full((C, C), 0.66), np.full((C, C), 0.64), dust])
Image.fromarray((np.clip(g, 0, 1) * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / "glass.png")
Image.fromarray((np.clip(height, 0, 1) * 255 + 0.5).astype(np.uint8), "L").resize((S // 2, S // 2), Image.BOX).save(OUT / "goods-height.png")
info = {}
for name, (m, trades, extra) in M.items():
    a = np.asarray(m.rows, np.float32); surfs = {"goods": {"file": f"{name}-goods.bin", "vertices": len(a)}}
    a.tofile(OUT / f"{name}-goods.bin")
    if hasattr(m, "glow"):
        g = np.asarray(m.glow.rows, np.float32); g.tofile(OUT / f"{name}-glow.bin"); surfs["glow"] = {"file": f"{name}-glow.bin", "vertices": len(g)}
        a = np.concatenate([a, g])
    lo, hi = a[:, 0:3].min(0), a[:, 0:3].max(0)
    info[name] = {"trades": trades, "triangles": len(a) // 3, "size": (hi - lo).round(4).tolist(), "min": lo.round(4).tolist(), "surfaces": surfs, **extra}
(OUT / "models.json").write_text(json.dumps({"cells": cells, "models": info}, indent=1))
print(len(info), "goods,", slot[0], "cells;", sum(v["triangles"] for v in info.values()), "triangles in all")
for k, v in info.items(): print(f"  {k}: {v['triangles']} tris, {v['size']}")
