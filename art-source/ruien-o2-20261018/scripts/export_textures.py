# Game texture sets for the Ruien O2 export: one seamless tiling set per material family,
# 2048 px wide PNG: albedo (sRGB), normal (OpenGL, +Y green up), height (16 bit), roughness, AO.
# Run: python -I scripts/export_textures.py     (writes export/textures/)
import os, sys, json
import numpy as np
import cv2
from PIL import Image
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from texlib import *
import spec

ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, 'textures')
OUT = os.path.join(ROOT, 'export', 'textures')
os.makedirs(OUT, exist_ok=True)

def rd8(p):
    return load_srgb(os.path.join(SRC, p))

def rd16(p):
    a = np.asarray(Image.open(os.path.join(SRC, p)))
    return (a.astype(np.float32) / (65535.0 if a.dtype == np.uint16 else 255.0))

def rdgray(p):
    im = Image.open(os.path.join(SRC, p)).convert('L')
    return np.asarray(im).astype(np.float32) / 255.0

def resize(a, w, h):
    return cv2.resize(a, (w, h), interpolation=cv2.INTER_AREA if a.shape[1] > w else cv2.INTER_CUBIC)

def wrap_resize(a, w, h):
    """Resize a seamless tile and keep it seamless (pad by wrapping, resize, crop)."""
    p = 16
    big = np.pad(a, ((p, p), (p, p)) + ((0, 0),) * (a.ndim - 2), mode='wrap')
    sy, sx = h / a.shape[0], w / a.shape[1]
    r = cv2.resize(big, (int(round(big.shape[1] * sx)), int(round(big.shape[0] * sy))), interpolation=cv2.INTER_CUBIC if sx > 1 else cv2.INTER_AREA)
    oy, ox = int(round(p * sy)), int(round(p * sx))
    return np.ascontiguousarray(r[oy:oy + h, ox:ox + w])

def ao_from_height(h, metres_per_px, relief_m):
    """Cavity AO from a height map (periodic), values 0..1."""
    hm = h * relief_m
    ao = np.zeros_like(h)
    for r_m, wgt in ((0.004, 0.35), (0.012, 0.4), (0.04, 0.25)):
        s = max(r_m / metres_per_px, 0.8)
        ao += wgt * np.clip((blur_wrap(hm, s) - hm) / (r_m * 0.6), 0, 1)
    return np.clip(1 - ao, 0.15, 1.0)

def save_set(name, alb, hgt, tile_w_m, relief_m, rough, extra=None):
    H_, W_ = hgt.shape
    save_srgb(os.path.join(OUT, name + '_albedo.png'), alb)
    save_gray16(os.path.join(OUT, name + '_height.png'), hgt)
    mpp = tile_w_m / W_
    save_srgb(os.path.join(OUT, name + '_normal.png'), normal_from_height(hgt, relief_m / mpp))
    save_gray8(os.path.join(OUT, name + '_roughness.png'), rough)
    save_gray8(os.path.join(OUT, name + '_ao.png'), ao_from_height(hgt, mpp, relief_m))
    for k, v in (extra or {}).items():
        save_srgb(os.path.join(OUT, '%s_%s.png' % (name, k)), v)
    return dict(tile_m=[tile_w_m, tile_w_m * H_ / W_], relief_m=relief_m,
                files=[name + s for s in ('_albedo.png', '_normal.png', '_height.png', '_roughness.png', '_ao.png')] + ['%s_%s.png' % (name, k) for k in (extra or {})])

def main():
    info = {}
    W = 2048
    # brick, three bonds (2:1 tiles, 4.8 x 2.4 m)
    for bond in ('flemish', 'stretcher', 'header'):
        pre = 'gen/brick_%s_' % bond
        hgt = wrap_resize(rd16(pre + 'height.png'), W, W // 2)
        alb = wrap_resize(rd8(pre + 'dry.png'), W, W // 2)
        slime = wrap_resize(rd8(pre + 'slime.png'), W, W // 2)
        lime = wrap_resize(rd8(pre + 'lime.png'), W, W // 2)
        masks = np.asarray(Image.open(os.path.join(SRC, pre + 'masks.png'))).astype(np.float32) / 255.0
        mortar = wrap_resize(masks[..., 0], W, W // 2)
        rough = np.clip(0.84 + 0.1 * mortar + 0.04 * (fbm_wrap(W // 2, W, np.random.default_rng(3), 3, 8) ), 0, 1)
        info['brick_' + bond] = save_set('ruien_brick_' + bond, alb, hgt, spec.BRICK_TILE[0], spec.BRICK_HMAX - spec.BRICK_HMIN, rough,
                                         extra={'albedo_slime': slime, 'albedo_lime': lime})
    # bluestone (jointless dressed stone), darkened as in the render
    alb = rd8('gen/bluestone_plain.png') * 0.45
    hgt = rd16('gen/bluestone_plain_height.png')
    info['bluestone'] = save_set('ruien_bluestone', alb, hgt, 2.4, 0.003, np.clip(rdgray('gen/bluestone_plain_rough.png') * 0.9 + 0.05, 0, 1))
    # calcite flowstone: pale grey-white as in the render
    a = rd8('t09-flowstone_seamless.png')
    g = lum(a)[..., None]
    calc = np.clip((a * 0.3 + g * 0.7) * np.array([0.92, 0.9, 0.84]) * 0.95, 0, 1)
    info['calcite'] = save_set('ruien_calcite', wrap_resize(calc, W, W), wrap_resize(rd16('t09-flowstone_height.png'), W, W), 1.8, 0.012,
                               np.clip(wrap_resize(rdgray('t09-flowstone_rough.png'), W, W) * 0.5 + 0.45, 0, 1))
    # oak door planks: the atlas (8 plank columns, 5.4 m tall), dark wet oak
    oak = rd8('gen/oak_atlas.png') * np.array([0.62, 0.6, 0.56])
    oh = rd16('gen/oak_atlas_height.png')
    info['oak'] = save_set('ruien_oak', np.clip(oak, 0, 1), oh, spec.OAK_PLANK_W * spec.OAK_ATLAS_COLS, 0.006, np.clip(rdgray('gen/oak_atlas_rough.png') * 0.4 + 0.5, 0, 1))
    info['oak']['note'] = 'atlas: u = plank column, v = 0..5.4 m along the plank; not a 2D tile'
    # iron (rust), silt, sandstone, moss
    for fam, src, tile, relief, dark, rmul in (('iron', 't06-rust-iron', 0.9, 0.002, 0.42, (0.4, 0.55)),
                                              ('silt', 't04-silt-mud', 4.0, 0.03, 0.35, (0.5, 0.25)),
                                              ('sandstone', 't07-sandstone', 1.6, 0.02, 0.45, (0.3, 0.6)),
                                              ('moss', 't10-moss', 1.2, 0.01, 0.6, (0.2, 0.75))):
        a = wrap_resize(rd8(src + '_seamless.png'), W, W) * dark
        h = wrap_resize(rd16(src + '_height.png'), W, W)
        r = np.clip(wrap_resize(rdgray(src + '_rough.png'), W, W) * rmul[0] + rmul[1], 0, 1)
        info[fam] = save_set('ruien_' + fam, np.clip(a, 0, 1), h, tile, relief, r)
    json.dump(info, open(os.path.join(OUT, 'texture_sets.json'), 'w'), indent=1)
    print('texture sets:', ', '.join(info))

if __name__ == '__main__':
    main()
