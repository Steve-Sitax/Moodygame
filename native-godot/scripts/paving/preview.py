# H5: top-down preview of a layout: the street picture laid through the layout's uv (2 cm a pixel).
import os as _os, sys as _sys
_HERE = _os.path.dirname(_os.path.abspath(__file__)); _sys.path.insert(0, _HERE)
ROOT = _os.path.dirname(_os.path.dirname(_os.path.dirname(_HERE)))  # the repository
W = _os.path.join(_os.environ['PAVE_WORK'], '').replace(_os.sep, '/')  # the work folder (outside the repository)
import sys, json, time, math, numpy as np, shapely
from PIL import Image
import layout as L
TEX = ROOT + '/art-source/client/public/textures/'
g = json.load(open(W + 'grid.json')); X0, Z0, R = g['X0'], g['Z0'], g['R']
KINDS = {'cobble': dict(tile=3.0, band=3.0 / 13, along=False, squares=False, tex='street_cobble'),
         'quay': dict(tile=2.5, band=2.5 / 12, along=False, squares=False, tex='quay_setts'),
         'flags': dict(tile=4.0, band=0.0, along=True, squares=True, tex='bluestone_flags')}
def build(kind='cobble', tile=None, band=None):
    t0 = time.time()
    k = KINDS[kind]; tile = tile or k['tile']; band = k['band'] if band is None else band
    mask = np.load(W + f'ground_{kind}-street.npy')
    area = L.mask_polygons(mask, X0, Z0, R)
    line = L.mask_polygons(mask, X0, Z0, R, line=True)
    L.Chain.MASK = (mask, X0, Z0, R)
    chains = L.load_chains(kind)
    L.Chain.MASK = None
    squares = L.find_squares(area, chains=chains) if k['squares'] else []
    lay = L.Layout(kind, area, chains, tile, band, line=line, along=k['along'], squares=squares)
    print('squares', [(round(q[0].area), round(math.degrees(q[1]), 1)) for q in squares])
    print('layout', kind, len(area.geoms), 'polys', len(chains), 'chains', len(lay.edges.mseg) if lay.edges else 0, 'course segments', round(time.time() - t0, 1), 's')
    return lay
def render(lay, x0, z0, x1, z1, res, name, texname='street_cobble'):
    col = np.asarray(Image.open(TEX + texname + '.jpg').convert('RGB')).astype(float) / 255
    hgt = np.asarray(Image.open(TEX + texname + '_h.png').convert('L').resize(col.shape[1::-1])).astype(float) / 255
    xs = np.arange(x0, x1, res) + res / 2; zs = np.arange(z0, z1, res) + res / 2
    X, Z = np.meshgrid(xs, zs); p = np.stack([X.ravel(), Z.ravel()], 1)
    lab, D = lay.classify(p); uv = lay.uv(p, lab, D)
    n = col.shape[0]
    iu = (np.mod(uv[:, 0], 1) * n).astype(int) % n; iv = (np.mod(uv[:, 1], 1) * n).astype(int) % n
    c = col[iv, iu] * (0.55 + 0.6 * hgt[iv, iu])[:, None]
    vis = shapely.contains_xy(lay.area.buffer(0.02), p[:, 0], p[:, 1]); c[~vis] *= 0.25
    rng = np.random.default_rng(1); pal = rng.uniform(0.3, 1, (4096, 3))
    tint = pal[np.where(lab >= 1_000_000, (lab - 1_000_000) % 4096 + 0, lab % 4096) % 4096]
    img = (np.clip(c, 0, 1).reshape(len(zs), len(xs), 3) * 255).astype(np.uint8)
    Image.fromarray(img).save(name + '.png')
    lb = (tint * np.where(lab[:, None] == -1, 0.1, np.where(lab[:, None] >= 1_000_000, 0.5, 1.0))).reshape(len(zs), len(xs), 3)
    Image.fromarray((lb * 255).astype(np.uint8)).save(name + '-labels.png')
if __name__ == '__main__':
    lay = build()
    import pickle
    for nm, box in {'bendS': (-205, 280, -165, 320), 'junction': (-162, 210, -132, 240), 'straight': (-160, 255, -130, 285), 'lower': (-60, 220, -20, 260)}.items():
        t0 = time.time(); render(lay, *box, 0.03, W + 'pv-' + nm); print(nm, round(time.time() - t0, 1), 's')
