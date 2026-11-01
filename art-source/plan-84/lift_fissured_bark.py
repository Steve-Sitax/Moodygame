"""Issue #246: the fissured bark (the bark atlas's left half: lime, elm and the bare tree) was a dark, mossy oak scan,
about 7 % reflectance (sRGB mean 89, 76, 61); a lime's grey furrowed bark reflects about 15 to 20 %. With the trunk's
vertex tone (0.82) the shaded side of every street tree drew near black, and at night it was gone. This lifts that half
in linear light by about 2.2 in the darks, less in the pale lichen (a soft shoulder, so the ridges keep their contrast),
and greys it a little (the scan's moss is greener than a town lime's). The plane's half (right) is left as it is.

    python lift_fissured_bark.py <bark_atlas_colour.png in> <out.png>
"""
import sys
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
im = np.asarray(Image.open(src).convert('RGB')).astype(np.float64) / 255.0
lin = np.where(im <= 0.04045, im / 12.92, ((im + 0.055) / 1.055) ** 2.4)
h, w, _ = lin.shape
half = lin[:, : w // 2]
lum = (half * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2, keepdims=True)
half = lum + (half - lum) * 0.82                 # a little greyer
half = half * 2.4 / (1.0 + 1.1 * half)           # x2.2 in the darks, x1.6 in the pale lichen
lin[:, : w // 2] = np.clip(half, 0.0, 1.0)
srgb = np.where(lin <= 0.0031308, lin * 12.92, 1.055 * lin ** (1 / 2.4) - 0.055)
Image.fromarray(np.round(np.clip(srgb, 0, 1) * 255).astype(np.uint8)).save(out, optimize=True)
l2 = lin[:, : w // 2].reshape(-1, 3).mean(axis=0)
print('fissured half mean linear', np.round(l2, 3))
