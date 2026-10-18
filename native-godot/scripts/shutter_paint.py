"""Issue #176: the painted-wood picture of the town's shutters, made in code (numpy; our own work, no pictures used).
    python scripts/shutter_paint.py <output folder>
Writes shutter-paint.png (2048 x 1024, sRGB) and shutter-paint-height.png (the same size, grey: the height for the wood
shader's bump). The left half is a kept house's paint (a few chips at the knots, brush marks along the grain); the right
half a worn house's (the paint flaking along the grain to grey weathered wood, the primer showing round the flakes).
Each half is 0.6 m of board across (u) and 0.6 m along the grain (v); the picture repeats along v without a seam, never
across a half. The paint is near white: its colour is the shutter's own (the vertex or copy colour multiplies it), so the
bare wood under it is a neutral grey that the paint colour only tints a little."""
import pathlib, sys
import numpy as np
from PIL import Image

W, H = 2048, 1024
rng = np.random.default_rng(176)

def field(shape, sx, sy, seed, octaves=4):
    """Noise that repeats over the picture (both ways), stretched sx across and sy along the grain (in pixels)."""
    g = np.random.default_rng(seed)
    out = np.zeros(shape); amp = 1.0; tot = 0.0
    for o in range(octaves):
        f = np.fft.fft2(g.standard_normal(shape))
        ky = np.fft.fftfreq(shape[0])[:, None]; kx = np.fft.fftfreq(shape[1])[None, :]
        lx, ly = sx / 2 ** o, sy / 2 ** o
        f *= np.exp(-((kx * lx) ** 2 + (ky * ly) ** 2) * 2)
        n = np.real(np.fft.ifft2(f)); n /= n.std() + 1e-9
        out += n * amp; tot += amp; amp *= 0.55
    return out / tot

def half(seed, worn):
    h, w = H, W // 2  # (v down the rows: the grain runs along the rows' axis 0)
    grain = field((h, w), 2.5, 160, seed)             # fine streaks along the grain
    rings = field((h, w), 14, 420, seed + 1, 3)       # the wider late-wood bands
    blot = field((h, w), 90, 260, seed + 2, 4)        # where the paint has gone
    fine = field((h, w), 6, 40, seed + 3, 3)          # flake edges
    brush = field((h, w), 3, 300, seed + 4, 2)        # brush marks in the paint
    # bare weathered oak/pine: silver grey, the late wood darker and raised, a little warm in the pores
    wood_v = 0.43 + 0.06 * rings + 0.05 * grain
    wood = np.stack([wood_v * 1.02, wood_v * 0.99, wood_v * 0.93], -1)
    # the paint: lead white with a little dirt, brush marks along the grain
    paint_v = 0.86 + 0.007 * brush + 0.008 * fine + 0.012 * rings
    paint = np.stack([paint_v, paint_v * 0.995, paint_v * 0.975], -1)
    primer = np.stack([np.full((h, w), 0.74), np.full((h, w), 0.70), np.full((h, w), 0.62)], -1)
    # flaking follows the grain: the mask is the broad blots cut by the streaks
    m = blot * 0.75 + fine * 0.35 + grain * 0.25
    gone = m > (1.25 if not worn else 0.35)
    halo = (m > (1.05 if not worn else 0.12)) & ~gone
    rgb = np.where(gone[..., None], wood, np.where(halo[..., None], primer, paint))
    # dirt settled in the grain and at the flake edges; a faint grime overall on the worn board
    rgb *= (1.0 - 0.06 * np.clip(-grain, 0, 2))[..., None]
    if worn: rgb *= (0.93 + 0.04 * blot)[..., None]
    height = np.where(gone, 0.36 + 0.07 * rings + 0.05 * grain, np.where(halo, 0.55, 0.62 + 0.006 * brush + 0.02 * rings))
    return np.clip(rgb, 0, 1), np.clip(height, 0, 1)

def main(out):
    out = pathlib.Path(out); out.mkdir(parents=True, exist_ok=True)
    kept, hk = half(11, False); worn, hw = half(29, True)
    rgb = np.concatenate([kept, worn], 1); hgt = np.concatenate([hk, hw], 1)
    srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(rgb, 1 / 2.4) - 0.055)
    # (the picture's values above are linear; the shader reads it as source_color)
    Image.fromarray((srgb * 255 + 0.5).astype(np.uint8), 'RGB').save(out / 'shutter-paint.png')
    Image.fromarray((hgt * 255 + 0.5).astype(np.uint8), 'L').save(out / 'shutter-paint-height.png')
    print('kept paint gone %.1f%%, worn %.1f%%' % ((hk < 0.5).mean() * 100, (hw < 0.5).mean() * 100))

if __name__ == '__main__':
    main(sys.argv[1])
