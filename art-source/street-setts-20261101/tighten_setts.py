"""Issues #238 and #223: the town's street setts (city/ground_cobble, the town's material r000024) with tight joints
and the reflectance of porphyry setts.

The three maps (colour r000019 1024 px, relief r000021 and stone ids r000023 512 px, one 3 m tile) drew joints about a
third of a course wide (6 to 7 cm at 3 m a tile), brown and deep, and the colour reflected about 7 % (sRGB mean 92, 76,
68): with the relief light's darkening the setts drew near black in the shade and dark even in the sun. Quenast and
Lessines porphyry setts reflect about 12 to 15 %; laid on sand their joints show 1.5 to 3 cm at the top.

Here every stone grows outward by up to GROW px of the 1024 px tile, leaving every joint at least 2 x HMIN px (all three maps the same, the relief and ids now at 1024
px, so the edges are sharper): the ids take the nearest stone's, the colour is mirrored across the old edge into the
stone (no smear), the relief's crowns keep their grain out to the new edge, where a worn arris of about 1.5 cm falls to the joint. Then
the stones' colour is lifted in linear light (x1.75 in the darks, less in the pale grains, a soft shoulder) and the
joints' sand and dirt a little less (x1.3). Nothing else of the pictures changes.

    python tighten_setts.py <colour.png> <relief.png> <ids.png> <out dir>
"""
import sys
import numpy as np
from PIL import Image
from scipy import ndimage

GROW = 7          # px of 1024 (3 m: 2.1 mm a px at the 1.4 uv scale the material now has): at most 1.5 cm a side
HMIN = 5          # px: every joint keeps at least 2 x 5 px, about 2 cm
cpath, rpath, ipath, out = sys.argv[1:5]
col = np.asarray(Image.open(cpath).convert('RGB')).astype(np.float64) / 255.0
N = col.shape[0]
rel = np.asarray(Image.open(rpath).convert('RGB').resize((N, N), Image.BICUBIC)).astype(np.float64)[:, :, 0] / 255.0
ids = np.asarray(Image.open(ipath).convert('RGBA').resize((N, N), Image.NEAREST)).copy()
stone = ids[:, :, 1] > 127

# distances and nearest stone pixel across the tile's wrap (3 x 3 tiles, keep the middle)
big = np.tile(~stone, (3, 3))
dist, (iy, ix) = ndimage.distance_transform_edt(big, return_indices=True)
sl = slice(N, 2 * N)
dist, iy, ix = dist[sl, sl], iy[sl, sl] % N, ix[sl, sl] % N
yy, xx = np.mgrid[0:N, 0:N]
# each joint's half width here (its ridge's distance nearby); a stone grows into it only as far as leaves HMIN
halfw = ndimage.maximum_filter(dist, size=2 * GROW + 3, mode='wrap')
reach = np.clip(halfw - HMIN, 0, GROW)
grow = (~stone) & (dist <= reach)

# ids: the nearest stone's
ids2 = ids.copy()
ids2[grow] = ids[iy[grow], ix[grow]]
# colour: mirrored across the old edge into the stone
my = (2 * iy - yy) % N
mx = (2 * ix - xx) % N
col2 = col.copy()
col2[grow] = col[my[grow], mx[grow]]
# relief: each stone's crown grain carried out to its new edge (the nearest pixel at least INNER px inside the old
# edge), then a worn arris drawn from the new edge (EDGE px, about 1.5 cm, rounded); the joints' sand as it was, low
INNER, EDGE = 6, 7
def inside(mask):
    return ndimage.distance_transform_edt(np.tile(mask, (3, 3)))[sl, sl]
core = stone & (inside(stone) >= INNER)
_, (cy, cx) = ndimage.distance_transform_edt(np.tile(~core, (3, 3)), return_indices=True)
cy, cx = cy[sl, sl] % N, cx[sl, sl] % N
crown = rel[cy, cx]
stone2 = ids2[:, :, 1] > 127
t = np.clip(inside(stone2) / EDGE, 0, 1)
arris = 1.0 - (1.0 - t) ** 2
floor_ = np.minimum(rel, 0.12)
rel2 = np.where(stone2, np.maximum(floor_, crown * arris), floor_)

# the reflectance of porphyry: stones x1.75 in the darks (soft shoulder), the joints' sand and dirt x1.3
lin = np.where(col2 <= 0.04045, col2 / 12.92, ((col2 + 0.055) / 1.055) ** 2.4)
st2 = (ids2[:, :, 1] > 127)[:, :, None]
lit_st = lin * 1.9 / (1.0 + 0.6 * lin)
lit_jt = lin * 1.3
lin = np.clip(np.where(st2, lit_st, lit_jt), 0, 1)
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)

Image.fromarray(np.round(srgb * 255).astype(np.uint8)).save(f'{out}/setts_colour.png', optimize=True)
r8 = np.round(np.clip(rel2, 0, 1) * 255).astype(np.uint8)
Image.fromarray(np.dstack([r8, r8, r8])).save(f'{out}/setts_relief.png', optimize=True)
Image.fromarray(ids2, 'RGBA').save(f'{out}/setts_ids.png', optimize=True)
j0, j1 = (~stone).mean(), (~(ids2[:, :, 1] > 127)).mean()
print(f'joint share {j0:.3f} -> {j1:.3f}; stone colour mean linear {lin[st2[:, :, 0]].mean(0).round(3)}')
