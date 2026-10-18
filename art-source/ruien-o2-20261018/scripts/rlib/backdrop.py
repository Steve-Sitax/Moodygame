# Render-only street backdrop beyond the vliet head: stepped-gable brick houses, a gas lamp.
import numpy as np
from . import util as U

def facade(name, x0, x1, z, h, mats, c, rng, facing=-1, steps=5, gable_h=4.5, lit=None):
    """Brick house front in the plane z (facing -z when facing=-1), with a stepped gable."""
    w = x1 - x0
    pts = [(x0, 0.0), (x1, 0.0), (x1, h)]
    sw = w / (2 * steps + 1)
    sh = gable_h / steps
    # right side steps up, left side steps down
    for k in range(steps):
        pts.append((x1 - sw * k, h + sh * k))
        pts.append((x1 - sw * (k + 1), h + sh * k))
    pts.append((x1 - sw * steps, h + gable_h)); pts.append((x0 + sw * steps, h + gable_h))
    for k in range(steps - 1, -1, -1):
        pts.append((x0 + sw * (k + 1), h + sh * k))
        pts.append((x0 + sw * k, h + sh * k))
    pts.append((x0, h))
    # drop duplicates
    clean = []
    for p in pts:
        if not clean or np.hypot(p[0] - clean[-1][0], p[1] - clean[-1][1]) > 1e-6:
            clean.append(p)
    V = [(px, py, z) for (px, py) in clean]
    face = list(range(len(V)))
    if facing < 0:
        face = face[::-1]
    uv = [(px, py) for (px, py) in clean]
    uvl = [uv[i] for i in face]
    obs = [U.mesh_from_faces(name, V, [face], uv=uvl, coll_=c, mat=mats['house'], smooth=False)]
    # pitched roof behind the gable and two chimneys, silhouette only
    rv = [(x0 + 0.02, h, z - facing * 0.1), (x1 - 0.02, h, z - facing * 0.1), (x1 - 0.02, h, z - facing * 9.0), (x0 + 0.02, h, z - facing * 9.0),
          ((x0 + x1) / 2, h + gable_h * 0.95, z - facing * 0.1), ((x0 + x1) / 2, h + gable_h * 0.95, z - facing * 9.0)]
    obs.append(U.mesh_from_faces(name + '_roof', rv, [[0, 4, 5, 3], [1, 2, 5, 4], [0, 1, 4], [3, 5, 2]], coll_=c, mat=mats['house'], smooth=False))
    for k in range(2):
        cx = x0 + w * rng.uniform(0.2, 0.8)
        cz = z - facing * rng.uniform(2.5, 7.0)
        Cc = U.box_corners(cx - 0.3, cx + 0.3, h + gable_h * 0.5, h + gable_h * 1.25, cz - 0.4, cz + 0.4)
        obs.append(U.mesh_from_faces(name + '_chimney', Cc, U.BOX_FACES, coll_=c, mat=mats['house'], smooth=False))
    # house body behind the front
    Cc = U.box_corners(x0 + 0.02, x1 - 0.02, 0, h + 0.01, z - facing * 0.05, z - facing * 9.0)
    F = [[0, 2, 3, 1], [4, 5, 7, 6], [0, 1, 5, 4], [2, 6, 7, 3], [0, 4, 6, 2], [1, 3, 7, 5]]
    obs.append(U.mesh_from_faces(name + '_body', Cc, F, coll_=c, mat=mats['house'], smooth=False))
    if lit:
        for (wx, wy) in lit:
            q = [(wx - 0.4, wy, z + facing * 0.01), (wx + 0.4, wy, z + facing * 0.01), (wx + 0.4, wy + 1.5, z + facing * 0.01), (wx - 0.4, wy + 1.5, z + facing * 0.01)]
            f = [0, 1, 2, 3] if facing < 0 else [3, 2, 1, 0]
            obs.append(U.mesh_from_faces(name + '_win', q, [f], coll_=c, mat=mats['window'], smooth=False))
    return obs

def build(mats, c, rng):
    obs = []
    x = -164.0
    k = 0
    while x < -128.0:
        w = rng.uniform(5.0, 7.5)
        h = rng.uniform(8.5, 12.5)
        lit = [(x + w * 0.55, h * 0.55)] if k in (2, 5) else None
        obs += facade('backdrop_house_%d' % k, x, x + w, 88.0, h, mats, c, rng, facing=-1, steps=int(rng.integers(4, 7)), gable_h=rng.uniform(3.5, 5.5), lit=lit)
        x += w + 0.05
        k += 1
    return obs
