# Ruien kit: throats, end walls and side galleries, moved here from scripts/build.py (O2 calls them with its own
# numbers and stays mesh-identical). annulus() is the brick end wall of a gallery round a smaller opening;
# throat() a short gallery with a mouth section through a wall; side_gallery() a stub gallery with an end wall.
# kit/meet.py Throat uses annulus() for a giant gallery that ends where a rui begins.
import numpy as np
from rlib import util as U, gallery as G

def annulus(name, path, u, hm, face_sign, c, mats, spring, crown_in, outer_hw, outer_rise, ledge_y, k_in=None, k_out=None, lower=True, mat=None):
    """Brick end wall in the plane at path u, between an inner opening and the outer gallery section, rays from
    the springing centre (0, spring). Inner: ellipse (hm, crown_in - spring) or k_in(d) (distance along unit
    direction d); outer: ellipse (outer_hw + 0.04, outer_rise + 0.04) or k_out(d). lower: the two strips from
    the ledge top to the springing between the opening's jambs and the gallery walls (O2 throats)."""
    th = np.linspace(np.pi, 0, 90)
    rad = np.linspace(0, 1, 9)
    W2 = outer_hw
    a_in, b_in = hm, crown_in - spring
    a_out, b_out = W2 + 0.04, outer_rise + 0.04
    pts = np.zeros((len(th), len(rad), 2))
    for i, t in enumerate(th):
        d = np.array([np.cos(t), np.sin(t)])
        # ray from the springing centre to each ellipse
        ki = 1 / np.sqrt((d[0] / a_in) ** 2 + (d[1] / b_in) ** 2) if k_in is None else k_in(d)
        ko = 1 / np.sqrt((d[0] / a_out) ** 2 + (d[1] / b_out) ** 2) if k_out is None else k_out(d)
        for j, r in enumerate(rad):
            k = ki + (ko - ki) * r
            pts[i, j] = (d[0] * k, spring + d[1] * k)
    S_, Y_ = pts[..., 0], pts[..., 1]
    P = path.world(np.full(S_.shape, u), S_, Y_)
    UV = np.stack([S_, Y_], -1)
    A = np.zeros((*P.shape[:2], 4), np.float32); B = np.zeros((*P.shape[:2], 4), np.float32); B[..., 3] = 1
    A[..., 1] = 0.25; A[..., 0] = 0.3 * U.smoothstep(-2.5, -1.2, Y_)
    px, pz, tx, tz, nx, nz = path.frame(np.array(u))
    want = P[45, 4] + face_sign * np.array([float(tx), 0, float(tz)])
    obs = [U.grid_mesh(name, P, UV, attrs={'wxA': A, 'wxB': B}, flip=G.orient_check(P, want), coll_=c, mat=mat or mats['brick_vault'])]
    # lower strips between the throat jambs and the gallery walls, ledge top to springing
    for side in ((-1, 1) if lower else ()):
        ss = side * np.linspace(hm, W2 + 0.04, 6)
        yy = np.linspace(ledge_y - 0.05, spring, 8)
        Ss, Yy = np.meshgrid(ss, yy, indexing='ij')
        P = path.world(np.full(Ss.shape, u), Ss, Yy)
        A = np.zeros((*P.shape[:2], 4), np.float32); B = np.zeros((*P.shape[:2], 4), np.float32); B[..., 3] = 1
        A[..., 2] = 0.4; A[..., 3] = 0.4
        want = P[2, 3] + face_sign * np.array([float(tx), 0, float(tz)])
        obs.append(U.grid_mesh(name + '_jamb', P, np.stack([Ss, Yy], -1), attrs={'wxA': A, 'wxB': B}, flip=G.orient_check(P, want), coll_=c, mat=mat or mats['brick_vault']))
    for o in obs:
        U.add_adaptive(o)
    return obs

def throat(name, hm, profile, origin_xz, out_dir, depth, mats, c, seed):
    """A short gallery of half width hm and section profile through a wall of thickness depth."""
    k0 = np.array(origin_xz, float)
    k1 = k0 + np.array(out_dir, float) * depth
    tg = G.Gallery(name, [tuple(k0), tuple(k1)], mats, c, u0=0.0, seed=seed, profile=profile, hw=hm, du=0.1)
    tg.build_shell()
    tg.build_lower()
    tg.build_coping()
    return tg, hm

def side_gallery(name, start_xz, dir_xz, length, hm, mats, c, rng, seed, endwall, floor_y, crown_y, outer_hw, straws=None):
    """A stub gallery: its seeps, shell, ledges and coping, the end wall round the throat (endwall(path) -> objects)
    and a dark card where it is lost in the fog. straws(gallery): optional lime straws under its seeps."""
    k0 = np.array(start_xz, float)
    k1 = k0 + np.array(dir_xz, float) * length
    sg = G.Gallery(name, [tuple(k0), tuple(k1)], mats, c, u0=0.0, seed=seed)
    sg.seeps = [(rng.uniform(0.5, length), sg.profile(0.06)[3] / 2 + rng.normal(0, 0.9), rng.uniform(0.3, 0.9)) for _ in range(8)]
    sg.build_shell()
    sg.build_lower()
    sg.build_coping()
    endwall(sg.path)
    # far end: dark cap, lost in fog
    W2 = outer_hw
    Pc = sg.path.world(np.full((2, 2), length), np.array([[-W2 - 0.1, -W2 - 0.1], [W2 + 0.1, W2 + 0.1]]), np.array([[floor_y - 0.2, crown_y + 0.2], [floor_y - 0.2, crown_y + 0.2]]))
    U.grid_mesh(name + '_void', Pc, np.zeros((2, 2, 2)), coll_=c, mat=mats['soot_black'], smooth=False)
    if straws is not None and hasattr(sg, 'seeps'):
        straws(sg)
    return sg
