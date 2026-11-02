"""Printed bills pasted on the church squares' bared walls (#226): a picture of eight bills of October 1873, aged.
    python bill_posters.py <out folder>
then   godot --headless --path native-godot -s scripts/build-bill-posters.gd -- <out folder>
Writes <out>/bills.png (1024 x 1024: two rows of four cells, each 256 x 512 = a bill 0.45 x 0.9 m at most) and bills.json
(each bill's cell and its own size in metres). Plain English; Dutch only in names (Rijnkaai, De Zwarte Kat, Sint-Jacob).
The type is the town's own Old Standard TT (SIL Open Font License, native-godot/fonts). The bills have hung a few weeks:
the paper yellowed and grey with soot, the ink faded unevenly, rain runs and damp from the foot, an older bill's scrap
showing under one. Torn edges are cut in the bills' own outline (NativeSquareDressing.Bills), not in this picture.
"""
import sys, json, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parents[1]
FONT = str(ROOT / 'fonts/old-standard-tt-latin-400-normal.woff2')
FONT_B = str(ROOT / 'fonts/old-standard-tt-latin-700-normal.woff2')
CW, CH = 256, 512

# (lines: (text, size, bold, colour)); size in pixels of the cell's 256 across; w, h: the bill's size in metres
INK, RED, BLUE = (24, 22, 20), (150, 30, 24), (30, 40, 90)
BILLS = [
    dict(id='sale', w=0.651, h=0.961, paper=(222, 210, 178), lines=[
        ('PUBLIC SALE', 30, True, INK), ('', 8, False, INK),
        ('of the materials of', 15, False, INK), ('the houses pulled down', 15, False, INK), ('round Sint-Jacob', 15, False, INK),
        ('', 8, False, INK), ('BRICKS, BEAMS,', 19, True, INK), ('DOORS & LEAD', 19, True, INK), ('', 8, False, INK),
        ('Monday 3 November 1873', 14, False, INK), ('at ten o\'clock, on the ground', 13, False, INK), ('', 10, False, INK),
        ('By order of the City', 12, False, INK)]),
    dict(id='ground', w=0.62, h=0.868, paper=(214, 205, 182), lines=[
        ('BUILDING', 30, True, INK), ('GROUND', 30, True, INK), ('TO BE SOLD', 22, True, RED), ('', 10, False, INK),
        ('several plots lately', 14, False, INK), ('cleared beside the church', 14, False, INK), ('', 10, False, INK),
        ('Apply at the Stadhuis,', 14, False, INK), ('office of the City works', 14, False, INK)]),
    dict(id='redstar', w=0.682, h=1.023, paper=(226, 218, 196), lines=[
        ('RED STAR LINE', 26, True, RED), ('', 6, False, INK), ('ANTWERP', 22, True, INK), ('to', 14, False, INK), ('NEW YORK', 24, True, INK),
        ('', 10, False, INK), ('by the steamers', 14, False, INK), ('VADERLAND', 18, True, BLUE), ('NEDERLAND', 18, True, BLUE), ('', 10, False, INK),
        ('Steerage and cabin', 14, False, INK), ('Apply at the office,', 13, False, INK), ('Rijnkaai', 15, True, INK)]),
    dict(id='theatre', w=0.558, h=1.085, paper=(208, 196, 168), lines=[
        ('THEATRE', 24, True, INK), ('ROYAL', 30, True, RED), ('', 10, False, INK), ('This evening', 15, False, INK), ('at seven o\'clock', 15, False, INK),
        ('', 12, False, INK), ('LA FILLE DE', 18, True, INK), ('MADAME', 22, True, INK), ('ANGOT', 26, True, INK), ('', 10, False, INK),
        ('opera bouffe', 14, False, INK), ('in three acts', 14, False, INK), ('', 12, False, INK), ('Pit 75 centimes', 13, False, INK)]),
    dict(id='lost', w=0.345, h=0.46, paper=(232, 226, 210), lines=[
        ('LOST', 34, True, INK), ('', 8, False, INK), ('a brown dog with', 15, False, INK), ('a white chest,', 15, False, INK), ('answers to Bello', 15, False, INK),
        ('', 10, False, INK), ('REWARD', 22, True, INK), ('at De Zwarte Kat', 14, False, INK)]),
    dict(id='notice', w=0.589, h=0.775, paper=(218, 214, 200), lines=[
        ('NOTICE', 30, True, INK), ('', 10, False, INK), ('No bills to be', 16, False, INK), ('posted on this wall', 16, False, INK), ('', 10, False, INK),
        ('Offenders will be', 14, False, INK), ('fined 500 centimes', 14, False, INK), ('', 12, False, INK), ('The Police', 13, False, INK)]),
    dict(id='wanted', w=0.527, h=0.744, paper=(210, 204, 186), lines=[
        ('WANTED', 30, True, INK), ('', 8, False, INK), ('Strong labourers', 15, False, INK), ('for the new docks', 15, False, INK), ('', 10, False, INK),
        ('2 francs 50', 18, True, INK), ('a day', 15, False, INK), ('', 10, False, INK), ('Apply at the works', 13, False, INK)]),
    dict(id='scrap', w=0.62, h=0.899, paper=(196, 186, 160), old=True, lines=[
        ('SALE', 34, True, INK), ('', 10, False, INK), ('of furniture', 15, False, INK), ('and bedding', 15, False, INK), ('', 16, False, INK),
        ('Thursday', 15, False, INK), ('at the house', 14, False, INK)]),
]


def noise(rng, h, w, cells):
    g = rng.random((cells + 1, cells + 1))
    y = np.linspace(0, cells, h); x = np.linspace(0, cells, w)
    y0 = np.floor(y).astype(int).clip(0, cells - 1); x0 = np.floor(x).astype(int).clip(0, cells - 1)
    fy = (y - y0)[:, None]; fx = (x - x0)[None, :]
    fy = fy * fy * (3 - 2 * fy); fx = fx * fx * (3 - 2 * fx)
    a = g[y0][:, x0]; b = g[y0][:, x0 + 1]; c = g[y0 + 1][:, x0]; d = g[y0 + 1][:, x0 + 1]
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy


def bill(b, rng):
    W, H = CW, int(CH * min(1.0, (b['h'] / b['w']) / (CH / CW)))
    # (the cell keeps the bill's own shape: 256 across, its height by its proportion, at most 512)
    H = min(CH, int(round(CW * b['h'] / b['w'])))
    img = Image.new('RGB', (W, H), b['paper'])
    d = ImageDraw.Draw(img)
    # a ruled border, as the printers set them
    d.rectangle((8, 8, W - 9, H - 9), outline=INK, width=2)
    d.rectangle((13, 13, W - 14, H - 14), outline=INK, width=1)
    total = sum(s + 6 for _, s, _, _ in b['lines'])
    y = max(20, (H - total) // 2)
    for text, size, bold, col in b['lines']:
        if text:
            f = ImageFont.truetype(FONT_B if bold else FONT, size)
            tw = d.textlength(text, font=f)
            if tw > W - 34:
                f = ImageFont.truetype(FONT_B if bold else FONT, int(size * (W - 34) / tw)); tw = d.textlength(text, font=f)
            d.text(((W - tw) / 2, y), text, font=f, fill=col)
        y += size + 6
    a = np.asarray(img).astype(float) / 255
    # aged: yellowed and greyed, the ink faded in patches, rain runs, damp at the foot, soot, a crease or two
    fade = noise(rng, H, W, 6)
    ink = a.mean(-1, keepdims=True) < 0.45
    paper = np.array(b['paper'], float) / 255
    a = np.where(ink, a + (paper - a) * (0.15 + 0.45 * fade[..., None]), a)
    grime = noise(rng, H, W, 10) * 0.6 + noise(rng, H, W, 40) * 0.4
    a *= (0.82 + 0.2 * grime)[..., None]
    runs = np.clip((noise(rng, 4, W, 9)[0][None, :] - 0.72) * 5, 0, 1) * np.linspace(0.1, 1, H)[:, None] * (0.7 + 0.3 * noise(rng, H, W, 20))
    a *= (1 - 0.18 * runs)[..., None]
    damp = np.clip((np.arange(H)[:, None] / H - 0.78) / 0.22, 0, 1) * (0.6 + 0.4 * noise(rng, H, W, 8))
    a = a * (1 - 0.35 * damp[..., None]) + np.array([0.33, 0.29, 0.22]) * 0.35 * damp[..., None]
    for _ in range(rng.integers(1, 3)):
        yy = rng.integers(H // 5, H - H // 5)
        a[max(0, yy - 1):yy + 1] *= 0.86
    if b.get('old'):
        a = a * 0.85 + np.array([0.45, 0.42, 0.36]) * 0.15
    a = np.clip(a, 0, 1)
    return Image.fromarray((a * 255 + 0.5).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.4)), H


def make(out):
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(1873)
    atlas = Image.new('RGB', (1024, 1024), (180, 170, 150))
    meta = []
    for i, b in enumerate(BILLS):
        im, h = bill(b, rng)
        cx, cy = (i % 4) * CW, (i // 4) * CH
        atlas.paste(im, (cx, cy))
        meta.append(dict(id=b['id'], w=b['w'], h=b['h'], u0=cx / 1024, v0=cy / 1024, u1=(cx + CW) / 1024, v1=(cy + h) / 1024))
    atlas.save(out / 'bills.png')
    (out / 'bills.json').write_text(json.dumps(meta, indent=1))
    return meta


if __name__ == '__main__':
    print(len(make(sys.argv[1])), 'bills')
