"""Issue #244: the game's dirt maps from Codex's procedural sets (codex/, see README.md).

Usage: python -I build_dirt.py <this folder>
Writes maps/<set>_dry.png, maps/<set>_wet.png (RGBA, 8 bit) and maps/<set>_height.png (grey, 8 bit) at the size the
game uses; scripts/store-dirt.gd turns them into compressed, mipmapped textures in native-godot/assets/materials/dirt-20261028.

- dry: the albedo (sRGB) with the AO in alpha (the shader shades the hollows with it).
- wet: the wet albedo (sRGB) with the gloss (1 - wet roughness) in alpha.
- height: stretched so the lowest 0.3 % is 0.25 grey and the highest 0.3 % white (the shader's relief light darkens by
  height: from 0.25 up it does not go black); maps.json gives the metres from 0 to 1.
wet_mud is made deeper (Steve, 2026-10-28: "bump map the mud also"): ridges pushed up round the sole prints and pockets,
smeared lumps along the smear, a raised crust with fine cracks where it has begun to dry, and the tile's faint straight
rut lines taken out (real ruts follow the cart roads, not a tile). Its water pockets stay flat and lowest.
"""
import json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as nd

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(ROOT, 'codex'), os.path.join(ROOT, 'maps')
# Codex's README: metres = minimum + normalised height x range
RANGE = {'pit_soil': 0.03723516, 'wet_mud': 0.01148960}
# (dry_earth, grave_soil and yard_dirt were tried and not used: see README.md)
SIZE = {'pit_soil': 2048, 'wet_mud': 1024}


def load(name, mode=None):
    im = Image.open(os.path.join(SRC, name))
    a = np.array(im).astype(np.float64)
    return a / (65535.0 if a.max() > 255 else 255.0)


def wrap_blur(a, s):
    return nd.gaussian_filter(a, s, mode='wrap')


def noise(n, scale, seed, stretch=(1.0, 1.0)):
    """Tileable smooth noise: white noise blurred with wrap, sigma per axis (y, x) in pixels."""
    r = np.random.default_rng(seed).standard_normal((n, n))
    g = nd.gaussian_filter(r, (scale * stretch[0], scale * stretch[1]), mode='wrap')
    return (g - g.mean()) / (g.std() + 1e-9)


def stronger_mud(h, rough):
    """wet_mud's height (0..1 of 11.5 mm) made deeper; returns the new height in metres above its lowest point."""
    n = h.shape[0]
    zero = h <= 0.002
    lab, k = nd.label(zero)
    # (the label does not wrap: a piece cut by the tile's edge is judged by its part)
    sizes = nd.sum(np.ones_like(h), lab, range(1, k + 1))
    boxes = nd.find_objects(lab)
    keep = np.zeros(k + 1, bool)
    for i, (sz, b) in enumerate(zip(sizes, boxes), 1):
        hgt, wid = b[0].stop - b[0].start, b[1].stop - b[1].start
        # the sole prints and water pockets stay; specks and the tile's thin straight rut lines along x go
        keep[i] = sz > 1500 and not (hgt < 30 and wid > 3 * hgt)
    pocket = keep[lab]
    gone = zero & ~pocket
    # a gone speck or line takes the level of the mud round it (a blur that leaves the gone texels out)
    w = (~gone).astype(float)
    fill = wrap_blur(h * w, 6) / np.maximum(wrap_blur(w, 6), 1e-6)
    h = np.where(gone, fill, h)
    m = h * RANGE['wet_mud']
    low = pocket
    # ridges of pushed-up mud round every print and pocket: a ring 4-14 px (2-7 mm at 2048) out from its edge
    d = nd.distance_transform_edt(~low)
    ring = np.exp(-((d - 7.0) / 5.0) ** 2) * (d > 0)
    m += 0.009 * ring * (0.7 + 0.3 * noise(n, 6, 11))
    # smeared lumps, drawn out along the smear (x), 2-6 cm
    lumps = np.clip(noise(n, 22, 12, (0.8, 1.3)) * 0.6 + noise(n, 7, 13, (0.85, 1.2)) * 0.4, -2.5, 2.5)
    m += 0.0045 * lumps
    # where the mud stands highest it has begun to dry: a raised crust plateau with fine cracks between its plates
    top = wrap_blur(m, 24)
    crust = np.clip((top - np.percentile(top, 62)) / (np.percentile(top, 90) - np.percentile(top, 62)), 0, 1)
    crust = crust * crust * (3 - 2 * crust)
    pts = np.random.default_rng(14).random((n, n)) < 0.00035
    lab = nd.distance_transform_edt(~pts, return_indices=True)[1]
    cell = (lab[0] * 7919 + lab[1] * 104729) % 1013
    edge = (np.roll(cell, 1, 0) != cell) | (np.roll(cell, 1, 1) != cell)
    crack = wrap_blur(edge.astype(float), 1.2)
    crack = np.clip(crack / crack.max(), 0, 1)
    m += crust * (0.0035 - 0.006 * crack)
    # the water pockets stay level, the lowest of all
    m -= m[~pocket].min() if (~pocket).any() else m.min()
    floor = np.percentile(m[~pocket], 1.0) if (~pocket).any() else 0.0
    m = np.where(pocket, 0.0, np.maximum(m, floor * 0.6 + 0.0005))
    return m, crust, crack, pocket


def ao_of(m, rng):
    """Local hollows darker: how far each texel lies under its 1 and 4 cm surroundings (m in metres)."""
    a = wrap_blur(m, 10) - m
    b = wrap_blur(m, 40) - m
    return np.clip(1.0 - (np.maximum(a, 0) * 4.0 + np.maximum(b, 0) * 2.0) / max(rng, 1e-6), 0.35, 1.0)


def stretch(h):
    lo, hi = np.percentile(h, 0.3), np.percentile(h, 99.7)
    return np.clip((h - lo) / (hi - lo), 0, 1), lo, hi


def save_rgba(rgb, a, path, size):
    im = Image.fromarray(np.dstack([np.clip(rgb * 255 + 0.5, 0, 255), np.clip(a * 255 + 0.5, 0, 255)]).astype(np.uint8), 'RGBA')
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    im.save(path)


def save_grey(h, path, size):
    im = Image.fromarray(np.clip(h * 255 + 0.5, 0, 255).astype(np.uint8), 'L')
    if im.size[0] != size: im = im.resize((size, size), Image.LANCZOS)
    im.save(path)


def main():
    os.makedirs(OUT, exist_ok=True)
    info = {}
    for name, size in SIZE.items():
        alb = load(f'{name}_albedo.png')[..., :3]
        h = load(f'{name}_height.png')
        if h.ndim == 3: h = h[..., 0]
        if name == 'wet_mud':
            rough = load('wet_mud_roughness.png')
            if rough.ndim == 3: rough = rough[..., 0]
            m, crust, crack, pocket = stronger_mud(h, rough)
            span = float(m.max())
            hn = m / span
            ao0 = load('wet_mud_ao.png')
            ao = ao_of(m, span) * (ao0[..., 0] if ao0.ndim == 3 else ao0)
            # dry: the crust paler and greyer, the prints and the cracks darker (sRGB-ish multiply is enough at this range)
            dry = alb * (0.86 + 0.28 * hn[..., None]) * (1 - 0.35 * crack[..., None] * crust[..., None])
            dry = dry + crust[..., None] * (np.array([0.40, 0.37, 0.33]) - dry) * 0.22
            wet = alb * 0.9
            # gloss: the slick mud shines, the drying crust is matt, the pockets are still water
            gloss = np.clip(1 - rough, 0, 1) * (1 - 0.75 * crust)
            gloss = np.where(pocket, 0.95, gloss)
            hs, lo, hi = hn, 0.0, 1.0
            info[name] = {'size': size, 'metres': round(span, 5), 'water_level': 0.0, 'note': 'deepened: ridges, lumps, crust and cracks'}
        else:
            ao = load(f'{name}_ao.png')
            if ao.ndim == 3: ao = ao[..., 0]
            dry = alb
            wet = load(f'{name}_wet_albedo.png')[..., :3]
            wr = load(f'{name}_wet_roughness.png')
            if wr.ndim == 3: wr = wr[..., 0]
            gloss = 1 - wr
            hs, lo, hi = stretch(h)
            info[name] = {'size': size, 'metres': round(float((hi - lo) * RANGE[name]), 5),
                          'hollows_12pct': round(float(np.percentile(hs, 12)), 3)}
        if name == 'wet_mud': info[name]['hollows_12pct'] = round(float(np.percentile(hs[hs > 0.0], 6)), 3)
        # (0..1 of the stored height: 0.25 + 0.75 x the stretched one; the metres cover 0 to 1)
        info[name]['metres'] = round(info[name]['metres'] / 0.75, 5)
        info[name]['hollows_12pct'] = round(0.25 + 0.75 * info[name]['hollows_12pct'], 3)
        # (the shader's relief light darkens by height and its slope already: the AO only half, the height from a quarter up)
        ao = 1 - 0.5 * (1 - ao)
        hs = 0.25 + 0.75 * hs
        save_rgba(dry, ao, os.path.join(OUT, f'{name}_dry.png'), size)
        save_rgba(wet, gloss, os.path.join(OUT, f'{name}_wet.png'), size)
        save_grey(hs, os.path.join(OUT, f'{name}_height.png'), size)
        print(name, info[name])
    with open(os.path.join(OUT, 'maps.json'), 'w') as f: json.dump(info, f, indent=1)


if __name__ == '__main__':
    main()
