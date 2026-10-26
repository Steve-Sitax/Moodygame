"""The window geranium atlas (Steve, 2026-10-26: the pot flowers were very low poly): drawn here, no outside picture.
    python make_geranium_atlas.py <out folder>
1024 x 1280 RGBA (cut out by alpha), and its height (grey):
  row 0 (y 0-512):    two zonal geranium leaves (round, scalloped, the darker horseshoe band, veins, a stalk stub)
  row 1 (y 512-1024): a scarlet umbel and a pink-and-white umbel (five-petalled florets in a ball, buds)
  row 2 (y 1024-1280): terracotta (0-512), potting soil (512-768), green stalk (768-1024), opaque.
Drawn at twice the size and scaled down (smooth edges). Fixed seed: the same picture every run.
"""
import sys, math, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

S = 2                      # drawn at twice the size
W, H = 1024 * S, 1280 * S
rng = np.random.default_rng(1873)

def noise(w, h, scale, octaves=4):
    out = np.zeros((h, w))
    amp = 1.0
    for o in range(octaves):
        g = rng.random((int(h / scale) + 2, int(w / scale) + 2))
        im = Image.fromarray((g * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC)
        out += np.asarray(im, float) / 255 * amp
        amp *= 0.5; scale = max(scale / 2, 1)
    return out / out.max()

def leaf(img, cx, cy, R, turn, seed):
    r = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    pts = []
    for k in range(360):
        t = math.radians(k)
        # scalloped round leaf, a notch where the stalk meets it (at the bottom)
        rr = R * (1 + 0.05 * math.sin(11 * t + seed) + 0.025 * math.sin(23 * t))
        notch = math.exp(-((((t - math.pi / 2) + math.pi) % (2 * math.pi) - math.pi) / 0.18) ** 2)
        rr *= 1 - 0.35 * notch
        a = t + turn
        pts.append((cx + rr * math.cos(a), cy + rr * math.sin(a)))
    mask = Image.new('L', img.size, 0); ImageDraw.Draw(mask).polygon(pts, fill=255)
    yy, xx = np.mgrid[0:img.size[1], 0:img.size[0]]
    dist = np.hypot(xx - cx, yy - cy) / R
    base = np.array([62, 108, 44], float)
    col = np.zeros((img.size[1], img.size[0], 3))
    n = noise(img.size[0], img.size[1], 60)
    shade = 0.82 + 0.25 * (1 - dist) + 0.12 * (n - 0.5)
    col[:] = base
    col *= shade[..., None]
    # the zone: a dark bronze horseshoe band
    zone = np.exp(-((dist - 0.55) / 0.09) ** 2)
    col = col * (1 - 0.45 * zone[..., None]) + np.array([70, 48, 30]) * 0.25 * zone[..., None]
    # veins: lighter lines out from the stalk's point
    ang = np.arctan2(yy - cy, xx - cx) - turn
    vein = np.zeros_like(dist)
    for k in range(9):
        va = -math.pi / 2 + (k - 4) * 0.62 + math.pi
        dv = np.abs(((ang - va + math.pi) % (2 * math.pi)) - math.pi) * dist * R
        vein = np.maximum(vein, np.exp(-(dv / (2.2 * S)) ** 2) * (dist < 0.95))
    col = col * (1 + 0.28 * vein[..., None])
    # the edge a little darker
    col *= (1 - 0.25 * np.clip((dist - 0.85) / 0.15, 0, 1))[..., None]
    a = np.asarray(mask, float)
    rgba = np.dstack([np.clip(col, 0, 255), a])
    layer = Image.fromarray(rgba.astype(np.uint8), 'RGBA')
    img.alpha_composite(layer)
    # the stalk stub, from the notch down to the cell's foot
    sx, sy = cx + R * 0.62 * math.cos(math.pi / 2 + turn), cy + R * 0.62 * math.sin(math.pi / 2 + turn)
    d.line([(cx, cy), (sx, sy + R * 0.5)], fill=(70, 110, 50, 255), width=7 * S)

def floret(d, x, y, r, col, rr):
    a0 = rr.uniform(0, 2 * math.pi)
    for k in range(5):
        a = a0 + k * 2 * math.pi / 5
        px, py = x + r * 0.55 * math.cos(a), y + r * 0.55 * math.sin(a)
        c = tuple(int(np.clip(v * rr.uniform(0.85, 1.1), 0, 255)) for v in col) + (255,)
        d.ellipse([px - r * 0.55, py - r * 0.55, px + r * 0.55, py + r * 0.55], fill=c)
    d.ellipse([x - r * 0.18, y - r * 0.18, x + r * 0.18, y + r * 0.18], fill=(120, 30, 40, 255))

def umbel(img, cx, cy, R, cols, seed):
    rr = np.random.default_rng(seed)
    d = ImageDraw.Draw(img)
    # the pedicels: green threads from the foot of the cell into the ball
    for k in range(14):
        a = rr.uniform(-1.2, 1.2)
        d.line([(cx, cy + R * 1.05), (cx + R * 0.8 * math.sin(a), cy + R * 0.3 - R * 0.6 * math.cos(a))], fill=(78, 112, 52, 255), width=3 * S)
    pts = []
    for k in range(60):
        a = rr.uniform(0, 2 * math.pi); q = math.sqrt(rr.uniform(0, 1)) * R * 0.85
        pts.append((cx + q * math.cos(a), cy - R * 0.1 + q * math.sin(a) * 0.85, q))
    pts.sort(key=lambda p: -p[2])            # the outer ones first, the middle on top
    for x, y, q in pts:
        col = cols[int(rr.integers(len(cols)))]
        k = 0.75 + 0.35 * (1 - q / R)
        floret(d, x, y, R * rr.uniform(0.22, 0.3), tuple(v * k for v in col), rr)
    for k in range(6):                       # buds
        a = rr.uniform(0, 2 * math.pi); q = R * rr.uniform(0.75, 0.95)
        x, y = cx + q * math.cos(a), cy - R * 0.1 + q * math.sin(a) * 0.85
        d.ellipse([x - 6 * S, y - 9 * S, x + 6 * S, y + 9 * S], fill=(150, 40, 35, 255))

def main():
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    img = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    c = 512 * S
    leaf(img, c * 0.5, c * 0.47, c * 0.4, 0.0, 3)
    leaf(img, c * 1.5, c * 0.47, c * 0.38, 0.25, 7)
    umbel(img, c * 0.5, c * 1.5, c * 0.36, [(205, 32, 28), (220, 45, 35), (185, 25, 30)], 11)
    umbel(img, c * 1.5, c * 1.5, c * 0.36, [(240, 150, 170), (250, 235, 235), (230, 120, 150)], 13)
    # row 2: terracotta, soil, stalk
    h2 = 256 * S
    n = noise(c, h2, 40)
    terra = np.array([168, 88, 58]) * (0.85 + 0.25 * n[..., None]) * (1 - 0.15 * noise(c, h2, 6)[..., None])
    soil = np.array([58, 42, 30]) * (0.6 + 0.7 * noise(c, h2, 5)[..., None])
    stalk = np.array([72, 110, 50]) * (0.85 + 0.25 * noise(c, h2, 30)[..., None])
    for x0, arr in ((0, terra), (c, soil)):
        img.paste(Image.fromarray(np.dstack([np.clip(arr, 0, 255), np.full(arr.shape[:2], 255)]).astype(np.uint8), 'RGBA'), (x0, c * 2))
    st = Image.fromarray(np.dstack([np.clip(stalk, 0, 255), np.full(stalk.shape[:2], 255)]).astype(np.uint8), 'RGBA')
    img.paste(st.crop((0, 0, c // 2, h2)), (int(c * 1.5), c * 2))
    img = img.resize((W // S, H // S), Image.LANCZOS)
    a = np.asarray(img)
    # alpha hard enough for a cut-out, colour bled under the cut so the edges do not go dark
    rgb = Image.fromarray(a[..., :3]); bled = rgb.filter(ImageFilter.MaxFilter(5))
    m = a[..., 3] > 8
    rgbn = np.where(m[..., None], a[..., :3], np.asarray(bled))
    img = Image.fromarray(np.dstack([rgbn, a[..., 3]]).astype(np.uint8), 'RGBA')
    img.save(out / 'geranium.png')
    lum = np.asarray(img.convert('L'), float)
    blur = np.asarray(img.convert('L').filter(ImageFilter.GaussianBlur(6)), float)
    h = np.clip(128 + (lum - blur) * 1.6, 0, 255).astype(np.uint8)
    Image.fromarray(h, 'L').save(out / 'geranium-height.png')
    print('atlas', img.size)

if __name__ == '__main__':
    main()
