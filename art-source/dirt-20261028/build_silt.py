"""Issue #252: the river mud's maps from Codex's tidal silt (codex-silt/, its README.txt and LICENCES.txt).

Usage: python -I build_silt.py <this folder>
Writes maps/silt_wet.png, maps/silt_dry.png and maps/silt_relief.png (RGBA, 8 bit, 2048 px, one 2 m tile);
scripts/store-dirt.gd --silt turns them into compressed, mipmapped textures in native-godot/assets/materials/dirt-20261028.

- silt_wet: the wet silt (sRGB) with its gloss (1 - roughness) in alpha. The tile's own pools are filled: their beds
  take the drier set's ground (the sets share it), toned to the wet silt, and the silt's own gloss. Repeated every 2 m
  the pools read as a camouflage print (tiling_4x4_tidal_silt.png); the game lays its water in world space instead.
- silt_dry: the drier silt (sRGB, its AO multiplied in) with its gloss in alpha; for the band by the quay wall.
- silt_relief: the drier set's ground (it has the pool beds and the fine cracks): its normal's x and y in red and
  green (OpenGL, as delivered), its height in blue (stretched from the lowest to the highest 0.1 %), alpha 1.
  maps.json gives the height's metres.
"""
import json, os, sys
import numpy as np
from PIL import Image

ROOT = sys.argv[1] if len(sys.argv) > 1 else os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(ROOT, 'codex-silt'), os.path.join(ROOT, 'maps')


def load(name):
    a = np.array(Image.open(os.path.join(SRC, name))).astype(np.float64)
    return a / (65535.0 if a.max() > 255 else 255.0)


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def save(a, name):
    Image.fromarray(np.clip(np.round(a * 255.0), 0, 255).astype(np.uint8), 'RGBA').save(os.path.join(OUT, name))


os.makedirs(OUT, exist_ok=True)
wet, dry = srgb_to_lin(load('tidal_silt_albedo.png')), srgb_to_lin(load('tidal_silt_drier_albedo.png'))
wet_r, dry_r = load('tidal_silt_roughness.png'), load('tidal_silt_drier_roughness.png')
pool = load('tidal_silt_water_mask.png')
ao = load('tidal_silt_drier_ao.png')

# the wet silt's own tone and gloss, away from its pools
silt = pool < 0.02
tone = np.array([np.median(wet[..., i][silt]) / np.median(dry[..., i][silt]) for i in range(3)])
fill_r = np.median(wet_r[silt])
m = pool[..., None]
wet_filled = wet * (1 - m) + dry * tone * m
wet_r_filled = wet_r * (1 - pool) + np.clip(dry_r - np.median(dry_r[silt]) + fill_r, 0.2, 0.45) * pool
a = np.dstack([lin_to_srgb(wet_filled * ao[..., None] ** 0.5), 1 - wet_r_filled])
save(a, 'silt_wet.png')
save(np.dstack([lin_to_srgb(dry * ao[..., None] ** 0.5), 1 - dry_r]), 'silt_dry.png')

h = load('tidal_silt_drier_height.png')
lo, hi = np.percentile(h, 0.1), np.percentile(h, 99.9)
hn = np.clip((h - lo) / (hi - lo), 0, 1)
n = load('tidal_silt_drier_normal.png')
save(np.dstack([n[..., 0], n[..., 1], hn, np.ones_like(hn)]), 'silt_relief.png')

# Codex's README: metres = (code / 65535 - 0.5) * 0.050
meta_path = os.path.join(OUT, 'maps.json')
meta = json.load(open(meta_path)) if os.path.exists(meta_path) else {}
meta['tidal_silt'] = {'size': 2048, 'tile_m': 2.0, 'metres': round(float((hi - lo) * 0.050), 5), 'wet_tone': [round(float(t), 4) for t in tone],
                      'wet_fill_roughness': round(float(fill_r), 4), 'note': 'wet pools filled (the game lays water in world space); relief from the drier set'}
json.dump(meta, open(meta_path, 'w', newline='\r\n'), indent=1)
print('silt: tone', tone.round(3), 'fill roughness', round(float(fill_r), 3), 'height', round(float((hi - lo) * 50), 2), 'mm')
