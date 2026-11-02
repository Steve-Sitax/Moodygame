"""The Stadspark's path gravel (#199): a raked, trodden path of fine river gravel in a sandy binder.
    python park_gravel.py <out folder>
Writes gravel_colour.png (1024 px, sRGB, RGBA) and gravel_relief.png (512 px, grey height) for one 2 m tile (the park
gravel mesh's uv runs 0.5 a metre), seamless. Original artwork: no third-party picture is used.

1873 park paths were laid with a sandy "grind": river gravel of 3 to 15 mm, packed in pale buff sand and rolled, so the
stones sit low in the binder with flat tops. The old picture drew 3 to 8 cm pebbles, domed and dark, that read as
cobbles from eye height.
"""
import sys, pathlib
import numpy as np
from PIL import Image

N = 1024                 # colour pixels over the 2 m tile: about 2 mm a pixel
TILE_M = 2.0
PX = TILE_M / N          # metres a pixel
rng = np.random.default_rng(1869)


def periodic_noise(n, cells, octaves, seed):
    """Tileable value noise in [0, 1]: bicubic-smoothed random grids that wrap."""
    r = np.random.default_rng(seed)
    out = np.zeros((n, n)); amp = 1.0; total = 0.0
    for o in range(octaves):
        c = cells * 2 ** o
        g = r.random((c, c))
        x = np.arange(n) * c / n
        i0 = np.floor(x).astype(int); f = x - i0
        f = f * f * (3 - 2 * f)
        i1 = (i0 + 1) % c
        a = g[i0][:, i0] * (1 - f)[None, :] + g[i0][:, i1] * f[None, :]
        b = g[i1][:, i0] * (1 - f)[None, :] + g[i1][:, i1] * f[None, :]
        out += amp * (a * (1 - f)[:, None] + b * f[:, None])
        total += amp; amp *= 0.5
    return out / total


def srgb(c):
    return np.array(c, float) / 255.0


# the binder: pale buff sand, a little greyer where trodden, damp-dark in soft patches
mottle = periodic_noise(N, 4, 4, 11)
fine = periodic_noise(N, 64, 3, 12)
grain = rng.random((N, N))
sand = srgb((146, 132, 108))
col = np.empty((N, N, 3))
k = 0.86 + 0.28 * (mottle - 0.5) + 0.10 * (fine - 0.5) + 0.10 * (grain - 0.5)
col[:] = sand[None, None, :] * k[..., None]
damp = np.clip((mottle - 0.62) / 0.2, 0, 1)
col *= (1 - 0.18 * damp)[..., None]
height = 0.18 + 0.10 * fine + 0.06 * (grain - 0.5)

# the stones: river gravel, rounded, flat-topped where rolled; sizes in metres (radius)
palette = [((150, 128, 96), 0.26), ((124, 112, 98), 0.20), ((190, 178, 156), 0.14), ((92, 86, 80), 0.10),
           ((170, 132, 92), 0.10), ((214, 206, 190), 0.07), ((128, 82, 60), 0.06), ((70, 66, 64), 0.07)]
pal = np.array([srgb(c) for c, _ in palette]); pw = np.array([w for _, w in palette]); pw /= pw.sum()


def stones(count, rmin, rmax, lift):
    global col, height
    radii = np.exp(rng.uniform(np.log(rmin), np.log(rmax), count)) / PX
    xs = rng.uniform(0, N, count); ys = rng.uniform(0, N, count)
    kinds = rng.choice(len(pal), count, p=pw)
    for x, y, r, kd in zip(xs, ys, radii, kinds):
        e = rng.uniform(0.65, 1.0)          # an elongated stone
        th = rng.uniform(0, np.pi)
        R = int(np.ceil(r)) + 2
        yy, xx = np.mgrid[-R:R + 1, -R:R + 1]
        u = (xx + (x - np.floor(x))) * np.cos(th) + (yy + (y - np.floor(y))) * np.sin(th)
        v = -(xx + (x - np.floor(x))) * np.sin(th) + (yy + (y - np.floor(y))) * np.cos(th)
        d = np.sqrt((u / r) ** 2 + (v / (r * e)) ** 2)
        inside = d < 1.0
        if not inside.any(): continue
        rows = (np.floor(y).astype(int) + yy) % N; cols = (np.floor(x).astype(int) + xx) % N
        # a rolled stone: a low dome, its top flattened, sitting in the binder
        dome = np.sqrt(np.clip(1 - d ** 2, 0, 1))
        h = lift * np.minimum(dome, 0.75) / 0.75 * (r * PX / 0.006) ** 0.5
        base = pal[kd] * rng.uniform(0.88, 1.12)
        shade = (0.80 + 0.26 * dome + 0.10 * np.clip(-(u + v) / (1.4 * r), -1, 1) * dome)[..., None]
        speck = (1 + 0.14 * (rng.random(d.shape) - 0.5))[..., None]
        c = np.clip(base[None, None, :] * shade * speck, 0, 1)
        m = inside & (h + 0.2 > height[rows, cols])
        height[rows[m], cols[m]] = np.maximum(height[rows[m], cols[m]], 0.2 + h[m])
        # the binder's sand on the stone's edge: its rim blends into the sand
        a = np.clip((1 - d) / 0.15, 0, 1)[..., None] * m[..., None]
        col[rows, cols] = col[rows, cols] * (1 - a) + c * a


# fine grit first, then the gravel, then a few larger stones
stones(60000, 0.0010, 0.0025, 0.20)
stones(45000, 0.0025, 0.0050, 0.40)
stones(12000, 0.0045, 0.0075, 0.55)
stones(300, 0.0080, 0.0120, 0.65)

# trodden: the binder packed between the stones in a few soft bands
height = np.clip(height, 0, 1)
# the contact shadow at a stone's foot, from the height: the sand round a proud stone a little darker
lo = sum(np.roll(np.roll(height, dx, 0), dy, 1) for dx in (-2, 0, 2) for dy in (-2, 0, 2)) / 9
col *= np.clip(1 - 0.5 * np.clip(lo - height, 0, 0.3), 0.8, 1)[..., None]

# (in the game's 13:00 sun the path read pale beside the lawn: the whole picture a fifth darker, a yellow-brown sand)
col *= np.array([0.82, 0.80, 0.76])[None, None, :]

out = pathlib.Path(sys.argv[1]); out.mkdir(parents=True, exist_ok=True)
rgba = np.dstack([np.clip(col * 255, 0, 255), np.full((N, N), 255)]).astype(np.uint8)
Image.fromarray(rgba, 'RGBA').save(out / 'gravel_colour.png')
h = Image.fromarray((np.clip(height, 0, 1) * 255).astype(np.uint8), 'L').resize((512, 512), Image.LANCZOS)
hg = np.asarray(h)
Image.fromarray(np.dstack([hg, hg, hg, np.full_like(hg, 255)]), 'RGBA').save(out / 'gravel_relief.png')
print('colour mean', (col.reshape(-1, 3).mean(0) * 255).round(1), 'height mean/std', round(float(height.mean()), 3), round(float(height.std()), 3))
