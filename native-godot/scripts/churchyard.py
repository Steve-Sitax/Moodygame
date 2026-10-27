"""St James's churchyard made larger (Steve, 2026-10-27: "make the cemetery a bit bigger on one side and put premium graves in
for important people, maybe even sort of cellars like there were in the time").
    python churchyard.py <out folder>
then   godot --headless --path native-godot -s scripts/build-churchyard.gd -- <out folder>
Writes <out>/models.json and its triangles, <out>/letters.png and letters-height.png (the carved inscriptions), and
world/town/churchyard.json (where everything stands; NativeChurchyard sets it at load).

The yard (townplaces.json "stjacob_yard": two small railed plots south of the church) grows east over the plots of the razed
houses 459 to 461 (church-squares-20261027): x -94.6 to -76.0, z 334.4 to 343.4, 167 m2, its west rail with the old east plot
taken out so the two are one yard. A gravel walk runs east-west through both (on from the old plot's west gap) and one north
to a new gate in the south railing; the omnibus passes 2.7 m south of that railing (keizer line, z 346 to 348).
Antwerp's churchyards took their last burials before 1784; by 1873 the town buried at the Kiel. So these are old graves:
weathered Belgian blue stone (the town stairs' stone, guard-stone.tres) with moss, soil splash, lichen and rain runs.
- the important families: a chest tomb, an obelisk on a stepped base, a family plot in a cast-iron railing round its cross
  and two ledgers, and three burial vaults (grafkelders): a vault chapel with a stone roof and an iron door, a vault whose
  door lies at the foot of four steps down behind a locked gate (the ground cut away for its stair: NativeChurchyard), and a
  raised ledger with four lifting rings over a vault;
- plain headstones (round, segmental and gabled tops, one stone cross) and worn ledger slabs flush in the grass.
Inscriptions: invented families, Latin formulas, Old Standard TT (SIL Open Font License, native-godot/fonts) cut into the
stone's own picture (letters.png: the stair stone picture, the letters sunk, dirt in them, worn on the oldest).
Every stone arris is rounded 8 to 15 mm, iron 2 to 4 mm. Collision: boxes round each grave, vault and railing.
Fixed seed: the same yard every run.
"""
import sys, json, math, pathlib
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import churchyard_kit as K
from churchyard_kit import Model, rbox, prism, lathe, torus, beam, bar, spear, panel, frame, fillet, rot_y, rot_x

ROOT = pathlib.Path(__file__).resolve().parents[1]          # native-godot
ENV = ROOT / 'assets/materials/environment-20261013'
FONT = str(ROOT / 'fonts/old-standard-tt-latin-400-normal.woff2')
FONT_B = str(ROOT / 'fonts/old-standard-tt-latin-700-normal.woff2')
PLAN = ROOT / 'world/town/churchyard.json'

# the yard
X0, X1, Z0, Z1 = -94.6, -76.0, 334.4, 343.4
OLD_EAST_X = -94.6                     # the old east plot's east rail, taken out (z 334.4 to 340.6)
WALK = (336.8, 338.4)                  # the east-west walk (z), from the old plot's west gap (x -101.6) to the east kerb
WALK_X0 = -101.6
GATE_X = -84.9                         # the new gate's middle (south railing); its walk x -85.6 to -84.2
PATH2 = (-85.6, -84.2)
GRASS_Y, GRAVEL_Y = 0.04, 0.03
PAINT_RAIL = (0.17, 0.25, 0.19)        # the old railing's dark green paint (stjacob_yard_railing, albedo 0.10 0.16 0.13)
PAINT_BLACK = (0.17, 0.17, 0.17)

# ---------------------------------------------------------------------------------------------------------- inscriptions
PANELS = {
    # name: (width m, height m, lines, worn 0..1, bold, shield)
    'chest': (1.30, 0.62, ['D.O.M.', 'HIC JACET', 'CAROLUS VERSTRAETEN', 'MERCATOR IN HAC URBE', 'OBIIT XXIII NOVEMBRIS', 'MDCCLVIII', 'AETATIS SUAE LXIV', 'R.I.P.'], 0.25, False, False),
    'obelisk_front': (0.46, 0.50, ['D.O.M.', 'PETRUS JOSEPHUS', 'VAN LOON', 'MEDICINAE', 'DOCTOR', 'OBIIT', 'MDCCLXXXIII'], 0.15, False, False),
    'obelisk_east': (0.46, 0.50, ['ET', 'ANNA CATHARINA', 'SMOLDERS', 'EIUS UXOR', 'OBIIT', 'MDCCLXXIX'], 0.2, False, False),
    'obelisk_west': (0.46, 0.50, ['REQUIESCANT', 'IN PACE'], 0.2, False, False),
    'vault_ledger': (1.00, 0.70, ['SEPULTURA', '', '', 'FAMILIAE DE PAUW', 'MDCCXXXVIII'], 0.3, True, True),
    'chapel_lintel': (1.00, 0.15, ['SEPULTURA FAMILIAE MOENS'], 0.15, True, False),
    'chapel_plaque': (0.52, 0.40, ['HIC QUIESCUNT', 'JOANNES FRANCISCUS MOENS', 'SCABINUS ANTVERPIENSIS', 'OBIIT MDCCLXXI', 'ET MARIA THERESIA DE BOCK', 'EIUS UXOR', 'R.I.P.'], 0.15, False, False),
    'stairs_pediment': (0.86, 0.13, ['SEPULTURA VAN ERTVELDE'], 0.2, True, False),
    'stairs_date': (0.40, 0.09, ['MDCCXLII'], 0.2, True, False),
    'family_monument': (0.42, 0.48, ['D.O.M.', 'MONUMENTUM', 'FAMILIAE', 'CLAES', 'MDCCLXVII'], 0.2, False, False),
    'family_ledger_1': (0.56, 0.50, ['HIC JACET', 'GUILIELMUS', 'CLAES', 'OBIIT', 'MDCCLXVII'], 0.35, False, False),
    'family_ledger_2': (0.56, 0.50, ['HIC JACET', 'ISABELLA', 'CLAES', 'OBIIT', 'MDCCLXXX'], 0.3, False, False),
    'hs1': (0.42, 0.40, ['HIC JACET', 'ADRIANUS', 'WOUTERS', 'OBIIT', 'MDCCLII', 'R.I.P.'], 0.45, False, False),
    'hs2': (0.40, 0.36, ['R.I.P.', 'MARIA', 'JANSSENS', 'MDCCLXX'], 0.35, False, False),
    'hs3': (0.42, 0.38, ['HIC JACET', 'JACOBUS', 'DE WINTER', 'MDCCXXXIX'], 0.5, False, False),
    'hs4': (0.42, 0.40, ['D.O.M.', 'CORNELIUS', 'PEETERS', 'OBIIT', 'MDCCLXXVI'], 0.3, False, False),
    'hs5': (0.40, 0.38, ['HIC JACET', 'ELISABETH', 'MERTENS', 'MDCCIX'], 0.75, False, False),
    'hs6': (0.42, 0.42, ['ORATE', 'PRO ANIMA', 'HENRICI', 'VERMEULEN', 'MDCCLXIII'], 0.4, False, False),
    'hs7': (0.36, 0.16, ['J. B. NUYTS', 'MDCCLXXXI'], 0.4, False, False),
    'ledger1': (1.00, 0.55, ['HIC JACET', 'JOANNES DE RIDDER', 'OBIIT MDCCXXXIII', 'R.I.P.'], 0.7, False, False),
    'ledger2': (0.90, 0.50, ['HIC JACET', 'MARGARETA', 'VAN AKEN', 'MDCCXXVI'], 0.85, False, False),
}
PPM = 640            # atlas pixels a metre
ATLAS = 2048
STONE_PPM = 1254 / 1.2


def smooth_noise(h, w, scale, seed, oct=3):
    g = np.random.default_rng(seed); out = np.zeros((h, w)); amp = 1; tot = 0
    for o in range(oct):
        s = max(1, int(scale / 2 ** o))
        small = g.standard_normal((h // s + 2, w // s + 2)).astype(np.float32)
        im = Image.fromarray(small).resize((w + 2 * s, h + 2 * s), Image.BICUBIC)
        out += np.asarray(im)[s:s + h, s:s + w] * amp; tot += amp; amp *= 0.5
    return out / tot


def letter_mask(W, H, lines, bold, shield):
    """The lines centred in a W x H picture, each as large as fits (capitals about 0.7 of a line); 0..1."""
    big = 4
    img = Image.new('L', (W * big, H * big), 0); d = ImageDraw.Draw(img)
    n = len(lines); gap = 0.32
    lh = H * big * 0.86 / (n + gap * (n - 1))
    font = FONT_B if bold else FONT
    for i, line in enumerate(lines):
        if not line: continue
        y = (H * big - (n * lh + (n - 1) * gap * lh)) / 2 + i * (1 + gap) * lh
        size = int(lh * 1.25)
        while size > 6:
            f = ImageFont.truetype(font, size)
            bb = f.getbbox(line + ' ')
            if bb[2] - bb[0] <= W * big * 0.9: break
            size = int(size * 0.94)
        f = ImageFont.truetype(font, size); bb = f.getbbox(line)
        capH = f.getbbox('H')[3] - f.getbbox('H')[1]
        x = (W * big - (bb[2] - bb[0])) / 2 - bb[0]
        d.text((x, y + (lh - capH) / 2 - f.getbbox('H')[1]), line, font=f, fill=255)
    if shield:
        # a carved shield of arms between the lines: a heater shield, a chevron and three stars, cut as lines
        cx, cy = W * big / 2, H * big * 0.47; sw, sh = H * big * 0.20, H * big * 0.26
        pts = [(cx - sw, cy - sh)] + [(cx - sw * math.cos(a), cy - sh + sh * 1.45 * math.sin(a) ** 1.0) for a in np.linspace(0, math.pi / 2, 12)][1:]
        pts = pts + [(2 * cx - x, y) for x, y in pts[::-1]]
        lw = max(3, int(H * big * 0.012))
        d.line(pts + [pts[0]], fill=255, width=lw, joint='curve')
        d.line([(cx - sw * 0.85, cy + sh * 0.35), (cx, cy - sh * 0.25), (cx + sw * 0.85, cy + sh * 0.35)], fill=255, width=lw * 2)
        for sx, sy in ((cx - sw * 0.5, cy - sh * 0.62), (cx + sw * 0.5, cy - sh * 0.62), (cx, cy + sh * 0.62)):
            r0, r1 = sw * 0.16, sw * 0.065
            star = [(sx + (r0 if k % 2 == 0 else r1) * math.sin(k * math.pi / 5), sy - (r0 if k % 2 == 0 else r1) * math.cos(k * math.pi / 5)) for k in range(10)]
            d.polygon(star, fill=255)
    return np.asarray(img.resize((W, H), Image.LANCZOS)).astype(float) / 255


def build_atlas(out):
    stone = np.asarray(Image.open(ENV / 'stair-stone.png').convert('RGB')).astype(float) / 255
    sh = np.asarray(Image.open(ENV / 'stair-stone-height.png').convert('L')).astype(float) / 255
    atlas = np.zeros((ATLAS, ATLAS, 3)); height = np.zeros((ATLAS // 2, ATLAS // 2))
    atlas[:] = stone.reshape(-1, 3).mean(0); height[:] = sh.mean()
    rng = np.random.default_rng(1873)
    order = sorted(PANELS, key=lambda k: -PANELS[k][1])
    pad = 16; rects = {}; x = y = pad + 4; shelf = 0
    for k, name in enumerate(order):
        w, h, lines, worn, bold, shield = PANELS[name]
        W, H = int(round(w * PPM)), int(round(h * PPM))
        if x + W + pad + 4 > ATLAS: x = pad + 4; y += shelf + pad; shelf = 0
        assert y + H + pad + 4 <= ATLAS, 'letters atlas full'
        # the stone's picture at its own scale, from somewhere of its own (wrapped)
        ox, oy = rng.integers(0, stone.shape[1]), rng.integers(0, stone.shape[0])
        sw, shh = int(w * STONE_PPM) + 1, int(h * STONE_PPM) + 1
        crop = np.take(np.take(stone, np.arange(oy, oy + shh) % stone.shape[0], 0), np.arange(ox, ox + sw) % stone.shape[1], 1)
        bg = np.asarray(Image.fromarray((crop * 255).astype(np.uint8)).resize((W + 2 * pad, H + 2 * pad), Image.LANCZOS)).astype(float) / 255
        hs = 512 / 1.2
        hcrop = np.take(np.take(sh, np.arange(int(oy * 512 / 1254), int(oy * 512 / 1254) + int(h * hs) + 1) % 512, 0), np.arange(int(ox * 512 / 1254), int(ox * 512 / 1254) + int(w * hs) + 1) % 512, 1)
        hbg = np.asarray(Image.fromarray(hcrop.astype(np.float32)).resize(((W + 2 * pad) // 2, (H + 2 * pad) // 2), Image.BICUBIC))
        M = letter_mask(W, H, lines, bold, shield)
        # wear: the letters filled in and softened in patches (the oldest the most)
        E = smooth_noise(H, W, 40, 100 + k)
        E = (E - E.min()) / (E.max() - E.min() + 1e-9)
        M = M * np.clip(1 - worn * 1.5 * E - worn * 0.25, 0.05, 1)
        if worn > 0.3: M = np.asarray(Image.fromarray((M * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(worn * 1.6))).astype(float) / 255
        Mp = np.pad(M, pad)
        Mb = np.asarray(Image.fromarray((Mp * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))).astype(float) / 255
        gy = np.gradient(Mb, axis=0)
        # a V cut: in shade under its upper edge, lit along its lower; dirt and old damp in the cut
        shade = 1 - 0.38 * Mp - 2.2 * np.clip(gy, 0, None) + 1.4 * np.clip(-gy, 0, None)
        dirt = np.array([0.20, 0.22, 0.19])
        pic = bg * shade[..., None]
        pic = pic * (1 - 0.32 * Mp[..., None]) + dirt * 0.32 * Mp[..., None]
        atlas[y - pad:y + H + pad, x - pad:x + W + pad] = np.clip(pic, 0, 1)
        Mh = np.asarray(Image.fromarray((Mp * 255).astype(np.uint8)).resize(hbg.shape[::-1], Image.LANCZOS)).astype(float) / 255
        height[(y - pad) // 2:(y - pad) // 2 + hbg.shape[0], (x - pad) // 2:(x - pad) // 2 + hbg.shape[1]] = np.clip(hbg - 0.45 * Mh, 0, 1)
        rects[name] = ((x + 1) / ATLAS, (y + 1) / ATLAS, (x + W - 1) / ATLAS, (y + H - 1) / ATLAS)
        x += W + 2 * pad; shelf = max(shelf, H + pad)
    Image.fromarray((atlas * 255 + 0.5).astype(np.uint8), 'RGB').save(out / 'letters.png')
    Image.fromarray((height * 255 + 0.5).astype(np.uint8), 'L').save(out / 'letters-height.png')
    return rects


# ---------------------------------------------------------------------------------------------------------- models
def stone_tint(m, age=1.0, tone=1.0, top=None):
    f = lambda P, N: K.weather_stone(P, N, m.seed, age, tone, top)
    m.tint['stone'] = f; m.tint['letters'] = f; m.tint['ashlar'] = f

def iron_tint(m, paint, age=1.0):
    m.tint['iron'] = lambda P, N: K.weather_iron(P, N, m.seed + 5, paint, age)

def lean(m, R):
    for mat, lst in m.tris.items():
        m.tris[mat] = [(P @ R.T, N @ R.T, U, C) for P, N, U, C in lst]

def sunk_panel(m, rects, name, centre, right, up, bead=0.018):
    w, h = PANELS[name][:2]
    nrm = np.cross(right, up)
    panel(m, rects[name], np.asarray(centre) + 0.0015 * nrm, right, up, w, h)
    frame(m, centre, right, up, w, h, bead=bead, proud=0.007, r=0.004)


def headstone(rects, name, pname, seed, shape, w, h, t, tilt=(0.0, 0.0), sink=0.2, age=1.0):
    m = Model(name, seed)
    b = -sink
    if shape == 'round':
        arc = [(w / 2 * math.cos(a), h - w / 2 + w / 2 * math.sin(a)) for a in np.linspace(0, math.pi, 19)]
        o = [(-w / 2, b), (w / 2, b)] + arc[1:-1] + []
        o = [(-w / 2, b), (w / 2, b), (w / 2, h - w / 2)] + arc[1:-1] + [(-w / 2, h - w / 2)]
    elif shape == 'segment':
        rise = 0.11; R = (w * w / 4 + rise * rise) / (2 * rise); a0 = math.asin(w / 2 / R)
        arc = [(R * math.sin(a), h - rise + (R * math.cos(a) - (R - rise))) for a in np.linspace(a0, -a0, 13)]
        o = [(-w / 2, b), (w / 2, b)] + arc
    else:   # gable
        o = [(-w / 2, b), (w / 2, b), (w / 2, h - 0.13), (0, h), (-w / 2, h - 0.13)]
    o = fillet(np.array(o, float), 0.012, 3)
    prism(m, 'stone', o, -t / 2, t / 2, 0.010, step=0.05)
    pw, ph = PANELS[pname][:2]
    cy = (h - (0.30 if shape == 'round' else 0.18)) - ph / 2 - 0.02
    sunk_panel(m, rects, pname, (0, cy, t / 2), (1, 0, 0), (0, 1, 0))
    stone_tint(m, age, 0.97 + 0.06 * np.random.default_rng(seed).random(), top=h)
    lean(m, rot_x(tilt[0]) @ K.rot_z(tilt[1]))
    m.box((-w / 2, 0, -t / 2 - 0.02), (w / 2, h, t / 2 + 0.02))
    return m


def cross_stone(rects, seed):
    m = Model('headstone_cross', seed)
    rbox(m, 'stone', (-0.26, -0.15, -0.14), (0.26, 0.30, 0.14), 0.012)
    rbox(m, 'stone', (-0.22, 0.30, -0.11), (0.22, 0.36, 0.11), 0.010)
    rbox(m, 'stone', (-0.06, 0.36, -0.05), (0.06, 1.12, 0.05), 0.010)
    rbox(m, 'stone', (-0.23, 0.80, -0.05), (0.23, 0.92, 0.05), 0.010, skip=())
    sunk_panel(m, rects, 'hs7', (0, 0.15, 0.14), (1, 0, 0), (0, 1, 0), bead=0.012)
    stone_tint(m, 1.0, 0.98, top=1.12)
    lean(m, rot_x(-0.035) @ K.rot_z(0.02))
    m.box((-0.26, 0, -0.14), (0.26, 1.12, 0.14))
    return m


def ledger(rects, name, pname, seed, L=1.9, W=0.85, top=0.035, age=1.0):
    """An old ledger slab flush in the grass, worn hollow; long along z, read from its foot (+z)."""
    m = Model(name, seed)
    g = np.random.default_rng(seed)
    wear = lambda Q: -0.007 * K.vnoise(Q * np.array([1, 0, 1]), 2.5, seed) * (Q[..., 1] > top - 0.02)
    rbox(m, 'stone', (-W / 2, top - 0.14, -L / 2), (W / 2, top, L / 2), 0.014, step=0.1, sag=wear)
    sunk_panel(m, rects, pname, (0, top, 0), (1, 0, 0), (0, 0, -1), bead=0.02)
    stone_tint(m, age, 0.95 + 0.06 * g.random())
    lean(m, rot_x(0.006 * g.standard_normal()) @ K.rot_z(0.006 * g.standard_normal()))
    return m


def chest_tomb(rects):
    m = Model('chest_tomb', 1701)
    rbox(m, 'stone', (-1.06, -0.12, -0.53), (1.06, 0.14, 0.53), 0.014)
    rbox(m, 'stone', (-0.95, 0.14, -0.44), (0.95, 0.70, 0.44), 0.010)
    for sx in (-1, 1):
        for sz in (-1, 1):
            x0, x1 = sorted((sx * 0.86, sx * 1.0)); z0, z1 = sorted((sz * 0.35, sz * 0.49))
            rbox(m, 'stone', (x0, 0.14, z0), (x1, 0.70, z1), 0.010)
            rbox(m, 'stone', (x0 - 0.015, 0.14, z0 - 0.015), (x1 + 0.015, 0.22, z1 + 0.015), 0.010)
    for sz in (-1, 1):
        frame(m, (0, 0.42, sz * 0.44), (sz, 0, 0), (0, 1, 0), 1.42, 0.34, bead=0.03, proud=0.012, r=0.006)
    for sx in (-1, 1):
        frame(m, (sx * 0.95, 0.42, 0), (0, 0, -sx), (0, 1, 0), 0.50, 0.34, bead=0.03, proud=0.012, r=0.006)
    rbox(m, 'stone', (-1.01, 0.68, -0.48), (1.01, 0.75, 0.48), 0.02)
    rbox(m, 'stone', (-1.08, 0.75, -0.55), (1.08, 0.86, 0.55), 0.015, skip=())
    sunk_panel(m, rects, 'chest', (0, 0.86, 0), (1, 0, 0), (0, 0, -1), bead=0.025)
    stone_tint(m, 1.0, 1.0, top=0.86)
    m.box((-1.08, 0, -0.55), (1.08, 0.86, 0.55))
    return m


def obelisk(rects):
    m = Model('obelisk', 1783)
    rbox(m, 'stone', (-0.55, -0.12, -0.55), (0.55, 0.18, 0.55), 0.015)
    rbox(m, 'stone', (-0.43, 0.18, -0.43), (0.43, 0.40, 0.43), 0.013)
    rbox(m, 'stone', (-0.36, 0.40, -0.36), (0.36, 0.47, 0.36), 0.015)
    rbox(m, 'stone', (-0.31, 0.47, -0.31), (0.31, 1.12, 0.31), 0.009)
    rbox(m, 'stone', (-0.37, 1.12, -0.37), (0.37, 1.20, 0.37), 0.015, skip=())
    rbox(m, 'stone', (-0.33, 1.20, -0.33), (0.33, 1.25, 0.33), 0.010)
    rbox(m, 'stone', (-0.22, 1.25, -0.22), (0.22, 3.05, 0.22), 0.010, step=0.08, taper=(0.62, 0.62))
    rbox(m, 'stone', (-0.137, 3.05, -0.137), (0.137, 3.29, 0.137), 0.004, step=0.05, taper=(0.04, 0.04))
    sunk_panel(m, rects, 'obelisk_front', (0, 0.795, 0.31), (1, 0, 0), (0, 1, 0))
    sunk_panel(m, rects, 'obelisk_east', (0.31, 0.795, 0), (0, 0, -1), (0, 1, 0))
    sunk_panel(m, rects, 'obelisk_west', (-0.31, 0.795, 0), (0, 0, 1), (0, 1, 0))
    stone_tint(m, 0.9, 1.02, top=1.2)
    m.box((-0.55, 0, -0.55), (0.55, 0.40, 0.55)); m.box((-0.37, 0.40, -0.37), (0.37, 3.29, 0.37))
    return m


def lifting_ring(m, x, y, z, turn):
    rbox(m, 'iron', (x - 0.075, y - 0.012, z - 0.075), (x + 0.075, y + 0.003, z + 0.075), 0.004, step=0.08, k=1)
    for dx in (-0.032, 0.032):
        beam(m, 'iron', (x + dx, y, z - 0.03), (x + dx, y + 0.022, z - 0.03), 0.014, 0.014, 0.003, segs=1)
    torus(m, 'iron', 0.05, 0.009, seg=18, sides=8, R=rot_y(turn), t=(x, y + 0.012, z + 0.012))


def vault_ledger(rects):
    m = Model('vault_ledger', 1738)
    for (lo, hi) in (((-1.29, -0.12, -0.76), (1.29, 0.10, -0.62)), ((-1.29, -0.12, 0.62), (1.29, 0.10, 0.76)),
                     ((-1.29, -0.12, -0.615), (-1.155, 0.10, 0.615)), ((1.155, -0.12, -0.615), (1.29, 0.10, 0.615))):
        rbox(m, 'stone', lo, hi, 0.013)
    wear = lambda Q: -0.005 * K.vnoise(Q * np.array([1, 0, 1]), 3.0, 1738) * (Q[..., 1] > 0.2)
    rbox(m, 'stone', (-1.15, -0.10, -0.61), (1.15, 0.24, 0.61), 0.015, sag=wear)
    for sx in (-1, 1):
        for sz in (-1, 1):
            lifting_ring(m, sx * 0.88, 0.241, sz * 0.40, 0.4 * sx + 0.2 * sz)
    sunk_panel(m, rects, 'vault_ledger', (0, 0.24, 0), (1, 0, 0), (0, 0, -1), bead=0.025)
    stone_tint(m, 1.0, 0.98)
    iron_tint(m, (0.44, 0.36, 0.30), 1.2)
    m.box((-1.29, 0, -0.76), (1.29, 0.25, 0.76))
    return m


def iron_door(m, x0, x1, y0, y1, z, seed):
    """A plated vault door: plate, three straps with rivets, a ring handle and a keyhole plate."""
    rbox(m, 'iron', (x0, y0, z - 0.02), (x1, y1, z + 0.006), 0.004, step=0.1, k=1)
    for yy in np.linspace(y0 + 0.15, y1 - 0.15, 3):
        rbox(m, 'iron', (x0 + 0.02, yy - 0.025, z + 0.004), (x1 - 0.02, yy + 0.025, z + 0.014), 0.003, step=0.12, k=1)
        for xx in np.linspace(x0 + 0.06, x1 - 0.06, 6):
            rbox(m, 'iron', (xx - 0.009, yy - 0.009, z + 0.012), (xx + 0.009, yy + 0.009, z + 0.02), 0.004, step=0.02, k=1)
    hx = x1 - 0.13; hy = (y0 + y1) / 2 + 0.02
    rbox(m, 'iron', (hx - 0.035, hy - 0.06, z + 0.004), (hx + 0.035, hy + 0.06, z + 0.016), 0.004, step=0.05, k=1)
    torus(m, 'iron', 0.05, 0.007, seg=14, sides=6, R=rot_x(math.pi / 2) @ rot_y(0.0), t=(hx, hy - 0.05, z + 0.03))
    rbox(m, 'iron', (hx - 0.025, hy - 0.17, z + 0.004), (hx + 0.025, hy - 0.10, z + 0.014), 0.003, step=0.05, k=1)


def vault_chapel(rects):
    """A family vault chapel: a stone house on a plinth, pilasters, a cornice, a stone-slab roof with a cross, an iron door
    up two steps, the family's name on the lintel and an epitaph tablet on its side. Front +z."""
    m = Model('vault_chapel', 1771)
    rbox(m, 'stone', (-1.22, -0.12, -1.52), (1.22, 0.38, 1.40), 0.015)
    rbox(m, 'ashlar', (-1.10, 0.38, -1.40), (1.10, 2.30, 1.40), 0.012, step=0.2)
    for sx in (-1, 1):
        for sz in (-1, 1):
            x0, x1 = sorted((sx * 0.84, sx * 1.14)); z0, z1 = sorted((sz * 1.14, sz * 1.44))
            rbox(m, 'ashlar', (x0, 0.38, z0), (x1, 2.30, z1), 0.012, step=0.2)
            rbox(m, 'stone', (x0 - 0.02, 0.38, z0 - 0.02), (x1 + 0.02, 0.52, z1 + 0.02), 0.012)
            rbox(m, 'stone', (x0 - 0.02, 2.14, z0 - 0.02), (x1 + 0.02, 2.22, z1 + 0.02), 0.010, skip=())
    rbox(m, 'stone', (-1.24, 2.30, -1.56), (1.24, 2.40, 1.56), 0.018, skip=())
    rbox(m, 'stone', (-1.20, 2.40, -1.52), (1.20, 2.46, 1.52), 0.012)
    # the gables
    tri = fillet(np.array([(-1.20, 2.46), (1.20, 2.46), (0, 2.46 + 1.20 * math.tan(math.radians(32)))]), 0.012, 3)
    for z0, z1 in ((1.30, 1.50), (-1.50, -1.30)):
        prism(m, 'stone', tri, z0, z1, 0.010, step=0.08)
    # the roof: stone slabs at 32 degrees, four along each side with their joints, a ridge roll
    pitch = math.radians(32); Ls = 1.36 / math.cos(pitch) + 0.03
    for sx in (-1, 1):
        d = np.array([-sx * math.cos(pitch), math.sin(pitch), 0]); n = np.array([sx * math.sin(pitch), math.cos(pitch), 0])
        Rr = np.stack([d, n, [0, 0, 1]], 1)
        eave = np.array([sx * 1.36, 2.44 - 0.10 * math.cos(pitch), 0])
        for j, (za, zb) in enumerate(((-1.62, -0.815), (-0.809, -0.003), (0.003, 0.809), (0.815, 1.62))):
            rbox(m, 'stone', (0, 0, za), (Ls, 0.09, zb), 0.012, step=0.2, R=Rr, t=eave, skip=())
    ridge_y = 2.44 + 1.36 * math.tan(pitch) + 0.05
    beam(m, 'stone', (0, ridge_y, -1.63), (0, ridge_y, 1.63), 0.15, 0.10, 0.03, uv=K.STONE_UV)
    rbox(m, 'stone', (-0.10, ridge_y - 0.02, 1.36), (0.10, ridge_y + 0.13, 1.56), 0.012, skip=())
    rbox(m, 'stone', (-0.05, ridge_y + 0.13, 1.41), (0.05, ridge_y + 0.80, 1.51), 0.010)
    rbox(m, 'stone', (-0.20, ridge_y + 0.52, 1.41), (0.20, ridge_y + 0.62, 1.51), 0.010)
    # the door, its frame and lintel, the steps
    for x0, x1 in ((-0.58, -0.44), (0.44, 0.58)):
        rbox(m, 'stone', (x0, 0.38, 1.38), (x1, 1.98, 1.46), 0.010)
    rbox(m, 'stone', (-0.66, 1.98, 1.38), (0.66, 2.20, 1.47), 0.012, skip=())
    sunk_panel(m, rects, 'chapel_lintel', (0, 2.09, 1.47), (1, 0, 0), (0, 1, 0), bead=0.012)
    iron_door(m, -0.44, 0.44, 0.40, 1.98, 1.42, 1771)
    rbox(m, 'stone', (-0.80, -0.12, 1.36), (0.80, 0.38, 1.80), 0.014)
    rbox(m, 'stone', (-0.86, -0.12, 1.80), (0.86, 0.19, 2.16), 0.014)
    # the epitaph tablet on the east side (+x), on a small corbel
    rbox(m, 'stone', (1.10, 0.98, -0.34), (1.155, 1.52, 0.34), 0.010, skip=())
    rbox(m, 'stone', (1.10, 0.92, -0.10), (1.17, 0.98, 0.10), 0.010, skip=())
    sunk_panel(m, rects, 'chapel_plaque', (1.155, 1.25, 0), (0, 0, -1), (0, 1, 0), bead=0.014)
    stone_tint(m, 1.0, 1.0, top=2.3)
    iron_tint(m, (0.42, 0.40, 0.37), 1.1)
    m.box((-1.25, 0, -1.56), (1.25, 3.4, 1.56)); m.box((-0.86, 0, 1.56), (0.86, 0.38, 2.16))
    return m


def vault_stairs(rects):
    """A family vault whose door lies at the foot of four steps down: the stairwell (the ground cut away: holes), its
    parapets with copings, a locked gate across the top, the portal with its pediment, and the vault's barrel hood behind.
    Front +z; the stair runs down from z 1.4 to the door at z 0."""
    m = Model('vault_stairs', 1742)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.50, sx * 0.78))
        rbox(m, 'ashlar', (x0, -0.95, -0.05), (x1, 0.42, 1.48), 0.012, step=0.2)
        rbox(m, 'stone', (min(x0, x1) - 0.03, 0.42, -0.05), (max(x0, x1) + 0.03, 0.50, 1.53), 0.015, skip=())
    for i in range(3):
        top = -0.21 * (i + 1); za, zb = 1.40 - 0.35 * (i + 1), 1.40 - 0.35 * i
        wear = lambda Q, top=top, zb=zb: -0.012 * np.exp(-(Q[..., 0] / 0.22) ** 2) * np.clip(1 - np.abs(Q[..., 2] - (zb - 0.12)) / 0.2, 0, 1) * (Q[..., 1] > top - 0.003)
        rbox(m, 'stone', (-0.505, -0.95, za), (0.505, top, zb), 0.014, step=0.08, sag=wear)
    rbox(m, 'stone', (-0.505, -0.95, -0.02), (0.505, -0.84, 0.36), 0.010, step=0.06)
    rbox(m, 'stone', (-0.52, -0.21, 1.40), (0.52, 0.06, 1.58), 0.014)
    # the portal: wall, door frame, lintel, cornice, pediment
    rbox(m, 'ashlar', (-1.0, -0.95, -0.42), (1.0, 1.10, 0.0), 0.012, step=0.2)
    for x0, x1 in ((-0.50, -0.37), (0.37, 0.50)):
        rbox(m, 'stone', (x0, -0.84, -0.02), (x1, 0.70, 0.05), 0.010)
    rbox(m, 'stone', (-0.54, 0.70, -0.02), (0.54, 0.88, 0.06), 0.012, skip=())
    sunk_panel(m, rects, 'stairs_date', (0, 0.79, 0.06), (1, 0, 0), (0, 1, 0), bead=0.01)
    iron_door(m, -0.37, 0.37, -0.84, 0.70, 0.0, 1742)
    rbox(m, 'stone', (-1.08, 1.02, -0.46), (1.08, 1.12, 0.06), 0.015, skip=())
    ped = fillet(np.array([(-1.04, 1.12), (1.04, 1.12), (0, 1.58)]), 0.012, 3)
    prism(m, 'stone', ped, -0.40, 0.03, 0.010, step=0.07)
    sunk_panel(m, rects, 'stairs_pediment', (0, 1.25, 0.03), (1, 0, 0), (0, 1, 0), bead=0.01)
    # the hood over the vault: a plinth course and three courses of a barrel of stone
    rbox(m, 'stone', (-1.02, -0.12, -2.80), (1.02, 0.10, -0.36), 0.014, step=0.1)
    arch = [(0.92 * math.cos(a), 0.10 + 0.68 * math.sin(a)) for a in np.linspace(0, math.pi, 21)]
    hood = fillet(np.array([(-0.92, 0.0), (0.92, 0.0)] + arch[1:-1]), 0.01, 2)
    for za, zb in ((-2.72, -1.94), (-1.934, -1.16), (-1.154, -0.40)):
        prism(m, 'ashlar', hood, za, zb, 0.012, step=0.15)
    # the gate across the top step: frame, bars with spear heads, a padlock
    gy0, gy1 = 0.08, 0.92; gz = 1.50
    for xx in (-0.47, 0.47):
        beam(m, 'iron', (xx, gy0 - 0.02, gz), (xx, gy1 + 0.04, gz), 0.03, 0.03, 0.004)
    for yy in (gy0 + 0.03, 0.62, gy1 - 0.04):
        beam(m, 'iron', (-0.47, yy, gz), (0.47, yy, gz), 0.03, 0.012, 0.002)
    for xx in np.arange(-0.39, 0.40, 0.112):
        bar(m, 'iron', xx, gz, gy0, gy1, w=0.016, tip=0.0)
        spear(m, 'iron', xx, gz, gy1, w=0.016, h=0.075)
    for sx in (-1, 1):
        for yy in (0.25, 0.80):
            beam(m, 'iron', (sx * 0.47, yy, gz), (sx * 0.51, yy, gz), 0.02, 0.012, 0.002, segs=1)
    rbox(m, 'iron', (-0.03, 0.50, gz + 0.012), (0.03, 0.56, gz + 0.035), 0.004, step=0.03, k=1)
    torus(m, 'iron', 0.022, 0.004, seg=10, sides=5, R=rot_x(math.pi / 2), t=(0, 0.575, gz + 0.022))
    stone_tint(m, 1.0, 0.97, top=1.1)
    iron_tint(m, (0.42, 0.40, 0.37), 1.3)
    for sx in (-1, 1):
        x0, x1 = sorted((sx * 0.50, sx * 0.81)); m.box((x0, 0, -0.05), (x1, 0.95, 1.53))
    m.box((-1.08, 0, -2.80), (1.08, 1.58, 0.06)); m.box((-0.50, 0, 1.40), (0.50, 1.0, 1.58))
    m.holes.append([-0.52, -0.02, 0.52, 1.45])
    return m


def family_plot(rects):
    """A family plot: a stone kerb and a cast-iron railing (spear heads, urn finials) round the family's cross on its
    pedestal and two ledgers. Front +z (its closed gate)."""
    m = Model('family_plot', 1767)
    hx, hz = 2.0, 1.6
    for (lo, hi) in (((-hx - 0.11, -0.10, hz - 0.11), (hx + 0.11, 0.16, hz + 0.11)), ((-hx - 0.11, -0.10, -hz - 0.11), (hx + 0.11, 0.16, -hz + 0.11)),
                     ((-hx - 0.11, -0.10, -hz + 0.115), (-hx + 0.11, 0.16, hz - 0.115)), ((hx - 0.11, -0.10, -hz + 0.115), (hx + 0.11, 0.16, hz - 0.115))):
        rbox(m, 'stone', lo, hi, 0.014, step=0.2)
    y0, y1 = 0.16, 0.80
    def run(a, b, gate=None):
        a, b = np.asarray(a, float), np.asarray(b, float); L = np.linalg.norm(b - a); d = (b - a) / L
        for yy in (0.24, 0.70, 0.745):
            beam(m, 'iron', a + [0, yy, 0], b + [0, yy, 0], 0.028 if yy != 0.70 else 0.02, 0.012, 0.002)
        n = int(L / 0.11)
        for i in range(1, n):
            p = a + d * L * i / n
            bar(m, 'iron', p[0], p[2], y0, y1, w=0.018, tip=0.0)
            spear(m, 'iron', p[0], p[2], y1, w=0.018, h=0.085)
    corners = [(-hx, hz), (hx, hz), (hx, -hz), (-hx, -hz)]
    run((-hx, 0, hz), (-0.45, 0, hz)); run((0.45, 0, hz), (hx, 0, hz))
    run((hx, 0, hz), (hx, 0, -hz)); run((hx, 0, -hz), (-hx, 0, -hz)); run((-hx, 0, -hz), (-hx, 0, hz))
    # the gate (closed), hung on two posts
    run((-0.45, 0, hz), (0.45, 0, hz))
    for x, z in corners + [(-0.45, hz), (0.45, hz)] + [(0, -hz), (-hx, 0), (hx, 0)]:
        beam(m, 'iron', (x, y0 - 0.02, z), (x, 0.92, z), 0.055, 0.055, 0.004)
        lathe(m, 'iron', [(0.0, 0.92), (0.034, 0.92), (0.034, 0.935), (0.022, 0.945), (0.016, 0.955), (0.03, 0.985), (0.034, 1.01),
                          (0.026, 1.035), (0.012, 1.045), (0.012, 1.055), (0.02, 1.065), (0.0, 1.085)], seg=10, t=(x, 0, z), uv=K.IRON_UV)
    # the family's cross on its pedestal (the back), two ledgers before it
    rbox(m, 'stone', (-0.42, -0.10, -1.42), (0.42, 0.22, -0.80), 0.014)
    rbox(m, 'stone', (-0.28, 0.22, -1.27), (0.28, 0.95, -0.93), 0.010)
    rbox(m, 'stone', (-0.33, 0.95, -1.32), (0.33, 1.03, -0.88), 0.014, skip=())
    rbox(m, 'stone', (-0.07, 1.03, -1.17), (0.07, 1.95, -1.03), 0.010)
    rbox(m, 'stone', (-0.27, 1.53, -1.17), (0.27, 1.67, -1.03), 0.010, skip=())
    sunk_panel(m, rects, 'family_monument', (0, 0.585, -0.93), (1, 0, 0), (0, 1, 0), bead=0.014)
    for sx, pname in ((-1, 'family_ledger_1'), (1, 'family_ledger_2')):
        wear = lambda Q: -0.004 * K.vnoise(Q * np.array([1, 0, 1]), 3.0, 1767 + sx) * (Q[..., 1] > 0.0)
        rbox(m, 'stone', (sx * 0.95 - 0.36, -0.10, -0.72), (sx * 0.95 + 0.36, 0.05, 0.62), 0.013, sag=wear)
        sunk_panel(m, rects, pname, (sx * 0.95, 0.05, -0.05), (1, 0, 0), (0, 0, -1), bead=0.015)
    stone_tint(m, 1.0, 1.0, top=1.0)
    iron_tint(m, PAINT_BLACK, 1.0)
    for (lo, hi) in (((-hx - 0.11, 0, hz - 0.11), (hx + 0.11, 1.0, hz + 0.11)), ((-hx - 0.11, 0, -hz - 0.11), (hx + 0.11, 1.0, -hz + 0.11)),
                     ((-hx - 0.11, 0, -hz), (-hx + 0.11, 1.0, hz)), ((hx - 0.11, 0, -hz), (hx + 0.11, 1.0, hz))):
        m.box(lo, hi)
    m.box((-0.42, 0, -1.42), (0.42, 1.95, -0.80))
    return m


def gate():
    """The yard's new gate in its south railing: two blue-stone piers with caps and balls, two iron leaves standing open
    into the yard (front +z: the street)."""
    m = Model('gate', 1873)
    for sx in (-1, 1):
        cx = sx * 0.95
        rbox(m, 'stone', (cx - 0.22, -0.12, -0.22), (cx + 0.22, 0.20, 0.22), 0.014)
        rbox(m, 'stone', (cx - 0.20, 0.20, -0.20), (cx + 0.20, 1.25, 0.20), 0.012, step=0.15)
        rbox(m, 'stone', (cx - 0.25, 1.25, -0.25), (cx + 0.25, 1.33, 0.25), 0.016, skip=())
        rbox(m, 'stone', (cx - 0.21, 1.33, -0.21), (cx + 0.21, 1.42, 0.21), 0.012, taper=(0.55, 0.55))
        lathe(m, 'stone', [(0.0, 1.42), (0.07, 1.42), (0.075, 1.43), (0.05, 1.45), (0.045, 1.47)] +
              [(0.13 * math.cos(a), 1.60 + 0.13 * math.sin(a)) for a in np.linspace(-1.2, math.pi / 2, 12)], seg=20, t=(cx, 0, 0))
        # the leaf: hung on the pier's inner face, swung 72 degrees into the yard
        hinge = np.array([sx * 0.74, 0, -0.04]); turn = -sx * math.radians(72)
        Rl = rot_y(turn)
        def P(u, y): return hinge + Rl @ np.array([-sx * u, y, 0])
        W = 0.72
        for yy in (0.10, 0.55, 1.00):
            beam(m, 'iron', P(0.0, yy), P(W, yy), 0.03, 0.014 if yy != 0.55 else 0.012, 0.002)
        for uu in (0.015, W - 0.015):
            q0, q1 = P(uu, 0.07), P(uu, 1.04)
            beam(m, 'iron', q0, q1, 0.03, 0.03, 0.004)
        beam(m, 'iron', P(0.03, 0.12), P(W - 0.03, 0.98), 0.025, 0.010, 0.002)
        for uu in np.arange(0.10, W - 0.05, 0.11):
            q = P(uu, 0)
            bar(m, 'iron', q[0], q[2], 0.10, 1.00, w=0.016, tip=0.0)
            spear(m, 'iron', q[0], q[2], 1.00, w=0.016, h=0.075)
        for yy in (0.2, 0.9):
            beam(m, 'iron', hinge + [0, yy, 0], hinge + [sx * 0.035, yy, 0], 0.03, 0.015, 0.002, segs=1)
        a, b = P(0, 0), P(W, 0)
        m.box(np.minimum(a, b) - [0.02, 0, 0.02] + [0, 0.05, 0], np.maximum(a, b) + [0.02, 1.08, 0.02])
        m.box((cx - 0.25, 0, -0.25), (cx + 0.25, 1.73, 0.25))
    stone_tint(m, 0.8, 1.0, top=1.33)
    iron_tint(m, PAINT_RAIL, 0.9)
    return m


# ---------------------------------------------------------------------------------------------------------- the yard itself
OLD_RAILS = [[[-114.3, 334.4], [-109.6, 334.4]], [[-109.6, 334.4], [-109.6, 337.0]], [[-109.6, 338.4], [-109.6, 340.6]],
             [[-109.6, 340.6], [-114.3, 340.6]], [[-114.3, 340.6], [-114.3, 334.4]], [[-103.4, 334.4], [-94.6, 334.4]],
             [[-94.6, 340.6], [-103.4, 340.6]], [[-103.4, 340.6], [-103.4, 338.4]], [[-103.4, 337.0], [-103.4, 334.4]]]
PIER_IN = (GATE_X - 0.75, GATE_X + 0.75)
NEW_RAILS = [((-94.6, 334.4), (-76.0, 334.4)), ((-76.0, 334.4), (-76.0, 343.4)), ((-76.0, 343.4), (GATE_X + 1.15, 343.4)),
             ((GATE_X - 1.15, 343.4), (-94.6, 343.4)), ((-94.6, 343.4), (-94.6, 340.6))]
# the new railing meets the old one at these points: the old corner posts stand there
OLD_POSTS = [(-94.6, 334.4), (-94.6, 340.6)]


def kerb_run(m, a, b, rng, w=0.20, top=0.07, bottom=-0.10, seg=1.15, extend=(0.0, 0.0), k=2):
    a, b = np.asarray(a, float), np.asarray(b, float); d = (b - a) / np.linalg.norm(b - a)
    a = a - d * extend[0]; b = b + d * extend[1]; L = np.linalg.norm(b - a)
    n = max(1, int(round(L / seg))); cuts = np.linspace(0, L, n + 1)
    cuts[1:-1] += rng.uniform(-0.12, 0.12, n - 1)
    for i in range(n):
        s0, s1 = cuts[i] + (0.003 if i else 0), cuts[i + 1] - (0.003 if i < n - 1 else 0)
        yaw = math.atan2(d[0], d[1])
        c = a + d * (s0 + s1) / 2
        lo = (-w / 2, bottom, -(s1 - s0) / 2); hi = (w / 2, top + rng.uniform(-0.006, 0.006), (s1 - s0) / 2)
        rbox(m, 'stone', lo, hi, 0.012 if k > 1 else 0.008, step=0.3, R=rot_y(yaw), t=(c[0], 0, c[1]), uvo=tuple(rng.random(2)), k=k)


def rail_run(m, a, b, posts_at_ends=(True, True), paint=PAINT_RAIL):
    """The yard's railing as the old one stands: posts at most 2 m apart, square bars 0.13 m apart pointed at 0.62 m,
    flat rails at 0.10 and 0.545 m; on the kerb."""
    a, b = np.asarray(a, float), np.asarray(b, float); L = np.linalg.norm(b - a); d = (b - a) / L
    A3, B3 = np.array([a[0], 0, a[1]]), np.array([b[0], 0, b[1]])
    for y0, h in ((0.10, 0.03), (0.545, 0.03)):
        beam(m, 'iron', A3 + [0, y0 + h / 2, 0], B3 + [0, y0 + h / 2, 0], 0.012, h, 0.002)
    nb = int(L / 0.13)
    for i in range(1, nb):
        p = a + d * L * i / nb
        bar(m, 'iron', p[0], p[1], 0.07, 0.62, w=0.016, tip=0.04)
    npost = max(1, int(math.ceil(L / 2.0)))
    for i in range(npost + 1):
        if (i == 0 and not posts_at_ends[0]) or (i == npost and not posts_at_ends[1]): continue
        p = a + d * L * i / npost
        beam(m, 'iron', (p[0], 0.0, p[1]), (p[0], 0.70, p[1]), 0.05, 0.05, 0.004)
        rbox(m, 'iron', (p[0] - 0.034, 0.70, p[1] - 0.034), (p[0] + 0.034, 0.72, p[1] + 0.034), 0.004, step=0.07, k=1)
        lathe(m, 'iron', [(0.0, 0.72), (0.012, 0.72), (0.01, 0.73), (0.024, 0.745), (0.026, 0.76), (0.018, 0.775), (0.0, 0.782)], seg=10, t=(p[0], 0, p[1]), uv=K.IRON_UV)


KERBS = [((-103.4, 334.4), (-76.0, 334.4))] + [r for r in NEW_RAILS[1:]] + [tuple(map(tuple, r)) for r in OLD_RAILS if r != [[-103.4, 334.4], [-94.6, 334.4]]]


def enclosure():
    m = Model('enclosure', 1784)
    rng = np.random.default_rng(1784)
    ends = [p for ab in KERBS for p in ab]
    def corner(p, line):
        # another run (across this one) ends here
        return any(abs(q[0] - p[0]) < 1e-6 and abs(q[1] - p[1]) < 1e-6 for ab in KERBS if ab is not line for q in ab)
    for line in KERBS:
        a, b = line
        level = abs(a[1] - b[1]) < 1e-6
        ext = tuple((0.10 if level else -0.10) if corner(p, line) else 0.05 for p in (a, b))
        if a[1] == 343.4 and b[1] == 343.4: ext = (ext[0], 0.10) if abs(b[0] - (GATE_X + 1.15)) < 1e-6 else (0.10, ext[1])
        old = line not in NEW_RAILS and line != KERBS[0]
        kerb_run(m, a, b, rng, top=0.065 if old else 0.07, extend=ext)
    for a, b in NEW_RAILS:
        ends = tuple(not any(abs(p[0] - q[0]) < 1e-6 and abs(p[1] - q[1]) < 1e-6 for q in OLD_POSTS) for p in (a, b))
        if a[1] == 343.4 and b[1] == 343.4:
            # the runs to the gate end at its piers
            ends = (ends[0], False) if abs(b[0] - (GATE_X + 1.15)) < 1e-6 else (False, ends[1])
        rail_run(m, a, b, ends)
        lo = np.minimum(a, b); hi = np.maximum(a, b)
        m.box((lo[0] - 0.06, 0, lo[1] - 0.06), (hi[0] + 0.06, 0.75, hi[1] + 0.06))
    stone_tint(m, 0.9, 0.98)
    iron_tint(m, PAINT_RAIL, 0.8)
    return m


def ground():
    """The yard's grass and gravel walks (world x z), with stone edging along the walks."""
    m = Model('ground', 1786)
    rng = np.random.default_rng(1786)
    step = 0.2
    def cells(x0, x1, z0, z1):
        xs = np.arange(x0, x1 - 1e-6, step); zs = np.arange(z0, z1 - 1e-6, step)
        return [(x, z) for x in xs for z in zs]
    holes = []
    def in_walk(x, z):
        return (WALK[0] <= z + 1e-6 and z + step <= WALK[1] + 1e-6) or (PATH2[0] <= x + 1e-6 and x + step <= PATH2[1] + 1e-6 and z >= WALK[1] - 1e-6)
    def h_grass(P):
        x, z = P[..., 0], P[..., 2]
        ramp = np.where(z < 340.6 + 1e-6, np.clip((x - X0) / 0.4, 0, 1), 1.0)
        return GRASS_Y * ramp * (0.8 + 0.4 * K.vnoise(P, 1.3, 1786))
    grass, gravel = [], []
    for x, z in cells(X0, X1, Z0, Z1):
        if any(x < h[2] and x + step > h[0] and z < h[3] and z + step > h[1] for h in HOLES): continue
        (gravel if in_walk(x, z) else grass).append((x, z))
    for x, z in cells(WALK_X0, X0, WALK[0], WALK[1]):
        gravel.append((x, z))
    for lst, mat, scale, hf in ((grass, 'grass', 4.0, h_grass), (gravel, 'gravel', 2.0, lambda P: (GRAVEL_Y + 0.004 * K.vnoise(P, 4.0, 7)) * np.clip((P[..., 0] - WALK_X0) / 0.4, 0, 1))):
        C = np.array(lst)
        q = np.stack([C, C + [step, 0], C + [step, step], C + [0, step]], 1)        # (n, 4, 2)
        P = np.stack([q[..., 0], np.zeros(q.shape[:2]), q[..., 1]], -1)
        P[..., 1] = hf(P)
        tri = np.concatenate([P[:, [0, 1, 2]], P[:, [0, 2, 3]]])
        N = np.zeros_like(tri); N[..., 1] = 1
        U = tri[..., [0, 2]] / scale
        m.add(mat, tri, N, U)
    # edging stones along the walks
    edges = [((WALK_X0, WALK[0]), (X1 - 0.12, WALK[0])), ((WALK_X0, WALK[1]), (PATH2[0], WALK[1])), ((PATH2[1], WALK[1]), (X1 - 0.12, WALK[1])),
             ((PATH2[0], WALK[1]), (PATH2[0], Z1 - 0.12)), ((PATH2[1], WALK[1]), (PATH2[1], Z1 - 0.12))]
    for a, b in edges:
        kerb_run(m, a, b, rng, w=0.055, top=0.065, bottom=-0.06, seg=0.85, extend=(0.0, 0.0), k=1)
    stone_tint(m, 0.7, 0.96)
    return m


HOLES = []


def main():
    out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
    rects = build_atlas(out)
    g = np.random.default_rng(1873)
    items = []   # (model, x, z, yaw, far, label)
    models = {}
    def put(m, x, z, yaw, far=110.0):
        models[m.name] = m; items.append(dict(id='churchyard-' + m.name.replace('_', '-'), model=m.name, x=x, y=0.0, z=z, yaw=round(yaw, 4), far=far))
    PI = math.pi
    put(ledger(rects, 'ledger_1', 'ledger1', 11, L=1.95, W=0.9, top=0.03, age=1.2), -92.9, 335.6, PI / 2, 70)
    put(chest_tomb(rects), -89.6, 335.6, 0.0, 150)
    put(headstone(rects, 'headstone_1', 'hs1', 21, 'round', 0.62, 0.98, 0.12, (-0.03, 0.02)), -86.7, 335.0, 0.0)
    put(headstone(rects, 'headstone_2', 'hs2', 22, 'segment', 0.56, 0.84, 0.11, (0.02, -0.04)), -85.1, 335.05, 0.0)
    put(headstone(rects, 'headstone_3', 'hs3', 23, 'gable', 0.60, 0.92, 0.12, (-0.05, 0.03), age=1.2), -83.5, 334.95, 0.0)
    put(obelisk(rects), -81.0, 335.65, 0.0, 220)
    put(vault_ledger(rects), -78.2, 335.6, 0.0, 120)
    stairs = vault_stairs(rects)
    sx, sz = -80.8, 340.25
    for h in stairs.holes:     # (yaw pi: x -> -x, z -> -z)
        HOLES.append([sx - h[2], sz - h[3], sx - h[0], sz - h[1]])
    put(stairs, sx, sz, PI, 200)
    put(vault_chapel(rects), -92.6, 341.0, PI, 260)
    put(family_plot(rects), -88.4, 340.85, PI, 160)
    put(headstone(rects, 'headstone_4', 'hs4', 24, 'round', 0.60, 1.02, 0.13, (0.02, 0.0)), -83.4, 340.0, PI)
    put(headstone(rects, 'headstone_5', 'hs5', 25, 'segment', 0.56, 0.80, 0.12, (0.09, -0.05), sink=0.24, age=1.4), -83.3, 342.3, PI)
    put(headstone(rects, 'headstone_6', 'hs6', 26, 'gable', 0.62, 1.00, 0.12, (-0.02, -0.03)), -77.5, 339.4, PI)
    put(cross_stone(rects, 27), -77.5, 341.9, PI)
    put(ledger(rects, 'ledger_2', 'ledger2', 12, L=1.8, W=0.82, top=0.025, age=1.4), -77.6, 342.55, PI / 2, 70)
    put(gate(), GATE_X, 343.4, 0.0, 160)
    put(enclosure(), 0.0, 0.0, 0.0, 0)
    put(ground(), 0.0, 0.0, 0.0, 0)
    info = {}; total = 0
    for name, m in models.items():
        d = out / name; d.mkdir(exist_ok=True); surf = {}
        for mat in m.tris:
            R = m.rows(mat)
            if mat in m.tint:
                R[:, :, 10:14] = m.tint[mat](R[:, :, 0:3].astype(float), R[:, :, 3:6].astype(float))
            if mat in ('stone', 'iron', 'ashlar'):
                R[:, :, 6:8] += np.random.default_rng(m.seed).random(2).astype(np.float32) * ([1, 0] if mat == 'ashlar' else 1)
            R.astype(np.float32).tofile(d / f'{mat}.f32')
            surf[mat] = {'file': f'{name}/{mat}.f32'}
        info[name] = {'surfaces': surf, 'boxes': m.boxes}
        total += m.count(); print(f'{name:16s} {m.count():7d} triangles, {len(m.boxes)} boxes')
    (out / 'models.json').write_text(json.dumps(info, indent=1))
    plan = {
        'note': "NativeChurchyard: St James's churchyard made larger east over the razed houses' plots (scripts/churchyard.py). "
                "railCut: the old plots' dividing rail taken out of the baked railing (triangles whose middle lies in the box); "
                "holes: the ground cut away (world x0 z0 x1 z1) for the vault stair; clear: the street's litter, leaves and raised "
                "flags and floating plinth tops taken out of the new ground (x0 z0 x1 z1, under 1.2 m); cover: the paving's drawn faces cut under the new grass "
                "(its stand-in faces, what collides and is walked on, kept); sky: the old plots and the new ground, where the sky map "
                "still had houses' roofs (Psx.ClearRoofs); items: the models (assets/models/churchyard) "
                "with their collision boxes; far: how far each shows (0: always).",
        'area': [[X0, Z0], [X1, Z0], [X1, Z1], [X0, Z1]],
        'railCut': {'node': 'townplaces/place_stjacob_yard/stjacob_yard_railing', 'box': [OLD_EAST_X - 0.42, 334.55, OLD_EAST_X + 0.12, 340.45]},
        'holes': [[round(v, 3) for v in h] for h in HOLES],
        'clear': [X0 + 0.12, Z0 + 0.12, X1 - 0.12, Z1 - 0.12],
        'cover': [X0, Z0, X1, Z1],
        'sky': [-114.5, Z0 - 0.2, X1 + 0.2, Z1 + 0.2],
        'items': items,
    }
    PLAN.write_text(json.dumps(plan, indent=1) + '\n')
    print('triangles', total, 'items', len(items), 'holes', HOLES)


if __name__ == '__main__':
    main()
