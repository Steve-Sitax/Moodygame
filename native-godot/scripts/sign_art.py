"""Issue #175: the pictures of the town's street name plates, shop boards and lettering painted on plaster, made in code.
    python scripts/sign_art.py <output folder>
Writes signs.png (4096 x 4096, sRGB): every street and square name on its enamel plate's face, every trade's board face,
and plain cells (enamel blue for a plate's rim and edges, the board's frame paint, gilt, pewter, brass, black paint, bare
iron); signs-height.png (2048 x 2048, grey: the relief for the shader's bump: chipped enamel, the board's grain, raised
gilt); letters.png (2048 x 1024, RGBA: the lettering painted on plaster, faded); layout.json (each cell's uv rectangle).
The letters are set in Old Standard TT (the plates, the names on boards) and Alfa Slab One (the trades), both SIL Open
Font License fonts in native-godot/fonts; the plates, boards and paint are our own work.
Texts: build_streetlife.py's street and square names and trades (plain English; names stay Dutch), read from the bake's
streetlife meta (assets/game-models/streetlife.extras.json)."""
import json, math, pathlib, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

OUT = pathlib.Path(sys.argv[1]); OUT.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parents[1]
META = json.loads(json.loads((ROOT / "assets/game-models/streetlife.extras.json").read_text())["streetlife_meta"]["meta"])
SRC = (ROOT.parent / "art-source/tools/blender/build_streetlife.py").read_text()
FONT_SERIF = str(ROOT / "fonts/old-standard-tt-latin-700-normal.woff2")
FONT_SLAB = str(ROOT / "fonts/alfa-slab-one-latin-400-normal.woff2")
rng = np.random.default_rng(175)

# the trades' colours and lines (build_streetlife.py TRADES; the meta keeps only keys and sizes)
import ast, re
body = SRC[SRC.index("TRADES = ["):SRC.index("STREET_NAMES")]
TRADES = []
for m in re.finditer(r"dict\((.*?)\),?\n", body, re.S):
    d = {}
    for k, v in re.findall(r"(\w+)=((?:\[[^\]]*\])|(?:\([^)]*\))|(?:\"[^\"]*\")|(?:[\w.]+))", m.group(1)):
        try: d[k] = ast.literal_eval(v)
        except Exception: d[k] = v
    TRADES.append(d)
assert len(TRADES) == len(META["trades"]), (len(TRADES), len(META["trades"]))

def lin(c): return np.where(np.asarray(c) <= 0.04045, np.asarray(c) / 12.92, ((np.asarray(c) + 0.055) / 1.055) ** 2.4)
def srgb(c):
    c = np.clip(np.asarray(c, float), 0, 1)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * np.power(c, 1 / 2.4) - 0.055)

def noise(h, w, scale, seed, oct=4):
    g = np.random.default_rng(seed); out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(oct):
        s = max(1, int(scale / 2 ** o))
        small = g.standard_normal((h // s + 2, w // s + 2))
        im = Image.fromarray(small.astype(np.float32)).resize((w + 2 * s, h + 2 * s), Image.BICUBIC)
        out += np.asarray(im)[s:s + h, s:s + w] * amp; tot += amp; amp *= 0.5
    return out / tot

def text_mask(lines, fonts, W, H, fill=0.62, track=0.04, gap=0.18):
    """The lines centred in a W x H box, as large as fits (each line its own font); returns a float mask 0..1."""
    big = 4  # (drawn 4x larger, then reduced: smooth sharp edges)
    img = Image.new("L", (W * big, H * big), 0); d = ImageDraw.Draw(img)
    n = len(lines); lh = H * big * fill / (n + gap * (n - 1))
    ys = [(H * big - (n * lh + (n - 1) * gap * lh)) / 2 + i * (1 + gap) * lh for i in range(n)]
    for line, font, y in zip(lines, fonts, ys):
        size = int(lh * 1.3)
        for _ in range(30):
            f = ImageFont.truetype(font, size)
            bb = f.getbbox("H")  # cap height
            capH = bb[3] - bb[1]
            widths = [f.getlength(ch) for ch in line]
            total = sum(widths) + track * capH * (len(line) - 1)
            if capH <= lh and total <= W * big * 0.9: break
            size = int(size * min(0.97, lh / max(capH, 1), W * big * 0.9 / max(total, 1)))
        x = (W * big - total) / 2
        for ch, wd in zip(line, widths):
            d.text((x, y - bb[1] + (lh - capH) / 2), ch, font=f, fill=255)
            x += wd + track * capH
    return np.asarray(img.resize((W, H), Image.LANCZOS)).astype(float) / 255

# ---------------------------------------------------------------- the faces
def plate_face(name, W, H, seed):
    """White enamel, a blue line inside the rim, the name in blue capitals; chips with rust at the edges and holes."""
    y, x = np.mgrid[0:H, 0:W] / max(W, H)
    base = lin((0.93, 0.93, 0.89)) * (1 + 0.02 * noise(H, W, 40, seed)[..., None])
    blue = lin((0.08, 0.16, 0.40))
    img = np.ones((H, W, 3)) * base
    b = int(H * 0.09); t = max(3, int(H * 0.035))  # the line: inset, thickness
    line = np.zeros((H, W), bool)
    line[b:b + t, b:W - b] = line[H - b - t:H - b, b:W - b] = True
    line[b:H - b, b:b + t] = line[b:H - b, W - b - t:W - b] = True
    img[line] = blue
    m = text_mask([name], [FONT_SERIF], W - 2 * (b + t) - int(H * 0.1), H - 2 * (b + t) - int(H * 0.08), fill=0.78, track=0.06)
    full = np.zeros((H, W)); oy, ox = (H - m.shape[0]) // 2, (W - m.shape[1]) // 2
    full[oy:oy + m.shape[0], ox:ox + m.shape[1]] = m
    img = img * (1 - full[..., None]) + blue * full[..., None]
    # chips: near the edges and at the four screw holes, dark iron with a rust halo
    ch = noise(H, W, 6, seed + 1, 3); edge = np.minimum(np.minimum(x * max(W, H) / W, 1 - x * max(W, H) / W) * W, np.minimum(y * max(W, H) / H, 1 - y * max(W, H) / H) * H)
    holes = np.zeros((H, W))
    for hx, hy in ((0.045 * H, 0.5 * H), (W - 0.045 * H, 0.5 * H)):
        holes = np.maximum(holes, np.exp(-(((x * max(W, H) - hx) ** 2 + (y * max(W, H) - hy) ** 2) / (0.05 * H) ** 2)))
    score = ch * 0.7 + np.exp(-edge / (0.035 * H)) * 1.1 + holes * 1.5
    chip = score > 1.45
    halo = score > 1.2
    img[halo & ~chip] = img[halo & ~chip] * 0.55 + lin((0.42, 0.22, 0.10)) * 0.45
    img[chip] = lin((0.16, 0.10, 0.07)) * (1 + 0.3 * ch[chip, None])
    hgt = np.where(chip, 0.35, 0.6) + 0.04 * full
    return img, hgt

def board_face(trade, W, H, seed):
    """Painted wood: the ground colour, a fine line of the letter colour inside the edge, the lettering with a dark shadow
    to the lower right (sign-writer's relief), gilt letters shading from light at the top to deeper at the foot."""
    bg = lin(trade["bg"]); fg = lin(trade["fg"])
    grain = noise(H, W, 3, seed, 3) * 0.5 + noise(H, W, 30, seed + 7, 2) * 0.5
    img = np.ones((H, W, 3)) * bg * (1 + 0.06 * grain[..., None])
    b = int(H * 0.08); t = max(2, int(H * 0.022))
    line = np.zeros((H, W), bool)
    line[b:b + t, b:W - b] = line[H - b - t:H - b, b:W - b] = True
    line[b:H - b, b:b + t] = line[b:H - b, W - b - t:W - b] = True
    img[line] = fg * 0.85
    lines = trade["lines"]
    fonts = [FONT_SERIF if (len(lines) == 2 and i == 0) or l.startswith("IN ") else FONT_SLAB for i, l in enumerate(lines)]
    m = text_mask(lines, fonts, W - 2 * (b + t) - int(H * 0.12), H - 2 * (b + t) - int(H * 0.1), fill=0.74, track=0.05)
    full = np.zeros((H, W)); oy, ox = (H - m.shape[0]) // 2, (W - m.shape[1]) // 2
    full[oy:oy + m.shape[0], ox:ox + m.shape[1]] = m
    sh = int(max(2, H * 0.018))
    shadow = np.zeros_like(full); shadow[sh:, sh:] = full[:-sh, :-sh]
    img = img * (1 - 0.65 * shadow[..., None]) + 0.02 * shadow[..., None]
    gilt = sum(trade["fg"]) > 1.9
    yy = np.linspace(1.15, 0.8, H)[:, None, None]
    letter = fg * (yy if gilt else 1.0)
    img = img * (1 - full[..., None]) + letter * full[..., None]
    # weather: the paint faded and crazed toward the top, a little flaking
    craze = noise(H, W, 2, seed + 3, 2) > 1.6
    img[craze] *= 0.85
    hgt = 0.5 + 0.05 * grain + 0.08 * full - 0.05 * craze
    return img, hgt

def letters_face(trade, W, H, seed):
    """Lettering painted on the plaster: alpha only where the paint is, faded and patchy."""
    fg = lin(trade["fg"])
    fonts = [FONT_SERIF if l.startswith("IN ") else FONT_SLAB for l in trade["lines"]]
    m = text_mask(trade["lines"], fonts, W, H, fill=0.8, track=0.05)
    fade = np.clip(0.75 + 0.35 * noise(H, W, 18, seed, 3), 0.25, 1.0)
    rgba = np.zeros((H, W, 4)); rgba[..., :3] = fg; rgba[..., 3] = m * fade
    return rgba

# ---------------------------------------------------------------- the atlas
S = 4096; atlas = np.zeros((S, S, 3)); height = np.full((S, S), 0.5); layout = {"size": [S, S], "cells": {}}
shelf = {"x": 0, "y": 0, "h": 0}
def place(name, img, hgt=None):
    h, w = img.shape[:2]
    if shelf["x"] + w > S: shelf["x"] = 0; shelf["y"] += shelf["h"] + 8; shelf["h"] = 0
    x, y = shelf["x"], shelf["y"]
    if y + h > S: raise SystemExit("atlas full at " + name)
    atlas[y:y + h, x:x + w] = img[..., :3]
    if hgt is not None: height[y:y + h, x:x + w] = hgt
    # (half a texel in, so a cell's edge never samples its neighbour)
    layout["cells"][name] = [(x + 0.5) / S, (y + 0.5) / S, (x + w - 0.5) / S, (y + h - 0.5) / S]
    shelf["x"] += w + 8; shelf["h"] = max(shelf["h"], h)

PLATE_PX = 520  # texels per metre on a plate (a 0.21 m field: 110 texels)
BOARD_PX = 400
names = META["streetNames"][:META["plates"]]  # (the plates: the street names, then the squares)
cells = META["solid"]["cells"]
for i, name in enumerate(names):
    x, y, w, h = cells[f"plate_{i}"]
    L, H = w * 0.022, h * 0.022
    img, hgt = plate_face(name, int(L * PLATE_PX), int(H * PLATE_PX), 100 + i)
    place(f"plate_{i}", img, hgt)
for t, tm in zip(TRADES, META["trades"]):
    if not tm["sign"].startswith("board_"): continue
    x, y, w, h = cells[tm["sign"]]
    L, H = w * 0.036, h * 0.036
    img, hgt = board_face(t, int(L * BOARD_PX), int(H * BOARD_PX), 300 + len(layout["cells"]))
    place(tm["sign"], img, hgt)
# plain cells: 128 x 128 each
def plain(name, rgb, var=0.06, seed=0, hval=0.5, metal=False):
    n = noise(128, 128, 12, 900 + seed, 3)
    img = np.ones((128, 128, 3)) * lin(rgb) * (1 + var * n[..., None])
    if metal: img *= (1 + 0.08 * noise(128, 128, 2, 950 + seed, 2))[..., None]
    place(name, img, np.full((128, 128), hval) + 0.05 * n)
plain("enamel_blue", (0.08, 0.16, 0.40), 0.05, 1)
plain("enamel_white", (0.93, 0.93, 0.89), 0.03, 2)
plain("iron_black", (0.09, 0.09, 0.10), 0.15, 3, metal=True)
plain("rust", (0.40, 0.22, 0.11), 0.25, 4)
plain("gilt", (0.83, 0.64, 0.27), 0.10, 5, metal=True)
plain("pewter", (0.55, 0.56, 0.57), 0.08, 6, metal=True)
plain("brass", (0.72, 0.56, 0.26), 0.10, 7, metal=True)
plain("black_paint", (0.05, 0.05, 0.05), 0.08, 8)
plain("red_paint", (0.45, 0.07, 0.05), 0.08, 9)
for t, tm in zip(TRADES, META["trades"]):
    if tm["sign"].startswith("board_"):
        plain("frame_" + tm["key"], t["bg"], 0.07, 20 + len(layout["cells"]))
plain("frame_dark", (0.10, 0.08, 0.06), 0.08, 11)
used_h = shelf["y"] + shelf["h"]
print("signs atlas used", used_h, "of", S, "rows;", len(layout["cells"]), "cells")
Image.fromarray((srgb(atlas) * 255 + 0.5).astype(np.uint8), "RGB").save(OUT / "signs.png")
Image.fromarray((np.clip(height, 0, 1) * 255 + 0.5).astype(np.uint8), "L").resize((S // 2, S // 2), Image.BOX).save(OUT / "signs-height.png")
# the painted lettering on plaster: its own picture (the wall decal material is see-through)
L2 = np.zeros((1024, 2048, 4)); dl = {"size": [2048, 1024], "cells": {}}; px = py = ph = 0
dcells = META["decal"]["cells"]
for t, tm in zip(TRADES, META["trades"]):
    if not tm["sign"].startswith("letters_"): continue
    x, y, w, h = dcells[tm["sign"]]
    L, H = w * 0.036, h * 0.036
    img = letters_face(t, int(L * 300), int(H * 300), 500 + len(dl["cells"]))
    hh, ww = img.shape[:2]
    if px + ww > 2048: px = 0; py += ph + 8; ph = 0
    L2[py:py + hh, px:px + ww] = img
    dl["cells"][tm["sign"]] = [(px + 0.5) / 2048, (py + 0.5) / 1024, (px + ww - 0.5) / 2048, (py + hh - 0.5) / 1024]
    px += ww + 8; ph = max(ph, hh)
rgba = np.concatenate([srgb(L2[..., :3]), L2[..., 3:]], -1)
Image.fromarray((rgba * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / "letters.png")
layout["letters"] = dl
(OUT / "layout.json").write_text(json.dumps(layout, indent=1))
(OUT / "gilt.json").write_text(json.dumps({tm["key"]: sum(t["fg"]) > 1.9 for t, tm in zip(TRADES, META["trades"])}))
