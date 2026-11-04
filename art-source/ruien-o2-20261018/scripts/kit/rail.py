# R2, the iron edge rail of the rui walkway (Steve, #272, 2026-11-03). Plain round iron posts with two rails
# along the walkway's water edge. Each post stands in a cast mounting shoe bolted to the coping's channel face,
# so the walkway keeps its full 0.8 m clear width. Posts stand radial and the rails follow the bend's offset
# line (sampled every 10 cm, no kinks). The rail breaks at the shaft ladders (with escape irons down to the
# water) and stops short of the mouths, with heavier dressed end posts; at a drain crossing two posts flank
# the lip stone and the rails run on. Rust and drip stains run down from every shoe. Collision: one slab per
# run, so the player cannot walk into the water except through a ladder gap; the bars themselves carry none.
import numpy as np
import bpy
from rlib import util as U
from . import fitlib as FL

def _runs(L, cfg, shafts_u, ends=('open', 'open'), zones=()):
    """Rail runs: from mouth to mouth, broken at the shaft ladders and at junction zones. A 'through' end runs on to
    the seam (the next route's rail continues it)."""
    a0 = 0.0 if ends[0] == 'through' else cfg['mouthClear']
    b0 = L if ends[1] == 'through' else L - cfg['mouthClear']
    cuts = sorted([(u - cfg['ladderGap'] / 2, u + cfg['ladderGap'] / 2) for u in shafts_u] +
                  [(za - cfg['mouthClear'], zb + cfg['mouthClear']) for za, zb in zones])
    runs, a = [], a0
    for (ca, cb) in cuts:
        if cb < a or ca > b0:
            continue
        if ca - a > 0.5:
            runs.append([a, ca])
        a = max(a, cb)
    if b0 - a > 0.5:
        runs.append([a, b0])
    return runs

def dome(name, centre, axis, r, h, mat, coll, n=12):
    """Dome-headed bolt or finial cap on an axis."""
    axis = np.asarray(axis, float); axis /= np.linalg.norm(axis)
    a = np.cross(axis, [0, 1.0, 0]) if abs(axis[1]) < 0.9 else np.cross(axis, [1.0, 0, 0]); a /= np.linalg.norm(a)
    b = np.cross(axis, a)
    prof = [(r, 0.0), (r, 0.15 * h)] + [(r * np.cos(t), 0.15 * h + 0.85 * h * np.sin(t)) for t in np.linspace(0.25, 1.35, 4)]
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    V = [np.asarray(centre) + axis * y + (a * np.cos(t) + b * np.sin(t)) * rr for (rr, y) in prof for t in ang]
    V.append(np.asarray(centre) + axis * h)
    m = len(prof)
    F = [[i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j] for i in range(m - 1) for j in range(n)]
    F += [[(m - 1) * n + j, (m - 1) * n + (j + 1) % n, m * n] for j in range(n)]
    F += [list(range(n))[::-1]]                       # closed base against the plate
    ob = U.mesh_from_faces(name, np.array(V), F, coll_=coll, mat=mat)
    p = ob.data.polygons[n]
    if np.dot(np.array(p.normal), np.array(p.center) - U.g2b(np.asarray(centre) + axis * h * 0.3)) < 0:
        ob.data.flip_normals()
    return ob

def ball(name, centre, r, mat, coll, n=12):
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    lat = np.linspace(-np.pi / 2, np.pi / 2, 8)[1:-1]
    V = [np.asarray(centre) + r * np.array([np.cos(p) * np.cos(t), np.sin(p), np.cos(p) * np.sin(t)]) for p in lat for t in ang]
    V += [np.asarray(centre) - [0, r, 0], np.asarray(centre) + [0, r, 0]]
    m = len(lat); s0, s1 = m * n, m * n + 1
    F = [[i * n + j, i * n + (j + 1) % n, (i + 1) * n + (j + 1) % n, (i + 1) * n + j] for i in range(m - 1) for j in range(n)]
    F += [[s0, (j + 1) % n, j] for j in range(n)] + [[s1, (m - 1) * n + j, (m - 1) * n + (j + 1) % n] for j in range(n)]
    ob = U.mesh_from_faces(name, np.array(V), F, coll_=coll, mat=mat)
    p = ob.data.polygons[0]
    if np.dot(np.array(p.normal), np.array(p.center) - U.g2b(centre)) < 0:
        ob.data.flip_normals()
    return ob

def build(g, sec, mats, coll, info, crossings, cfg, rng, col_coll, log=print, ends=('open', 'open'), zones=()):
    """Rail along the walkway edge of a rui. Returns (objects, collision proxies)."""
    path = g.path
    side = sec.sides[0]
    lo, hi = sec.channel_edges()
    edge = hi if side > 0 else lo
    y0 = sec.ledge_y
    s_face = edge - side * 0.04                         # the coping's channel face
    sx, sy, st = cfg['shoe']
    rp, re_, rr = cfg['postRadius'], cfg['endPostRadius'], cfg['railRadius']
    s_post = s_face - side * (st + cfg['standoff'] + rp)
    iron = mats['iron']
    shafts = [p['u'] for p in info['placements'] if p['piece'] == 'grate_shaft_parametric']
    rings = [p['u'] for p in info['placements'] if p['piece'] == 'mooring_ring']
    flank = [c['u'] for c in crossings if c['kind'] == 'crossing']
    runs = _runs(path.length, cfg, shafts, ends, zones)
    seam = lambda u: (ends[0] == 'through' and u < 1e-3) or (ends[1] == 'through' and u > path.length - 1e-3)
    uu = np.arange(0, path.length + 1e-6, 0.02)
    Pr = path.world(uu, np.full(len(uu), s_post), np.zeros(len(uu)))
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(Pr, axis=0), axis=1))]
    A = lambda u: np.interp(u, uu, arc)
    Ainv = lambda a: np.interp(a, arc, uu)
    def P(u, s, y):
        return path.world(np.array(u), np.array(s), np.array(y))
    obs, proxies, posts = [], [], []
    hs = cfg['railHeights']
    for ri, (a, b) in enumerate(runs):
        fixed = [a] + sorted(sum(([c - cfg['crossingFlank'], c + cfg['crossingFlank']] for c in flank if a + 0.3 < c < b - 0.3), [])) + [b]
        us = []
        for p, q in zip(fixed[:-1], fixed[1:]):
            n = max(1, int(np.ceil((A(q) - A(p)) / cfg['postSpacing'] - 1e-6)))
            if any(abs((p + q) / 2 - c) < 0.1 for c in flank):
                n = 1                                     # the span over a drain lip
            us += list(Ainv(np.linspace(A(p), A(q), n + 1)[:-1]))
        us.append(b)
        # keep clear of the mooring rings' staples on the same face
        for i in range(1, len(us) - 1):
            for rgu in rings:
                if abs(us[i] - rgu) < 0.16 and not any(abs(us[i] - (c + d)) < 1e-6 for c in flank for d in (-cfg['crossingFlank'], cfg['crossingFlank'])):
                    us[i] = rgu + (0.16 if us[i] >= rgu else -0.16)
        top = y0 + hs[-1]
        rail_ends = (us[0], us[-1])
        us = [u for u in us if not seam(u)]
        for i, u in enumerate(us):
            end = (i == 0 and not seam(rail_ends[0])) or (i == len(us) - 1 and not seam(rail_ends[1]))
            r_ = re_ if end else rp
            px, pz, tx, tz, nx, nz = path.frame(np.array(u))
            t3 = np.array([float(tx), 0, float(tz)]); n3 = side * np.array([float(nx), 0, float(nz)])   # n3: into the walkway
            # post, standing radial; a dome cap, or a ball finial on a dressed end post
            yb, yt = y0 - cfg['postBelow'], top + (0.05 if end else 0.035)
            obs.append(FL.rod('rail_post', [P(u, s_post, yb), P(u, s_post, (yb + yt) / 2), P(u, s_post, yt)], r_, iron, coll, chamfer=0.003))
            if end:
                obs.append(ball('rail_finial', P(u, s_post, yt + 0.028), 0.03, iron, coll))
                obs.append(FL.rod('rail_finial_neck', [P(u, s_post, yt - 0.004), P(u, s_post, yt + 0.004), P(u, s_post, yt + 0.012)], r_ + 0.004, iron, coll, chamfer=0.003))
            else:
                obs.append(dome('rail_cap', P(u, s_post, yt), [0, 1.0, 0], r_ + 0.003, 0.02, iron, coll))
            dome_low = FL.rod('rail_foot', [P(u, s_post, yb - 0.012), P(u, s_post, yb), P(u, s_post, yb + 0.02)], r_ + 0.002, iron, coll, chamfer=0.004)
            obs.append(dome_low)
            for h in hs:                                   # knuckles where the rails pass
                obs.append(FL.rod('rail_knuckle', [P(u, s_post, y0 + h - 0.032), P(u, s_post, y0 + h), P(u, s_post, y0 + h + 0.032)], r_ + 0.009, iron, coll, chamfer=0.004))
            # the shoe: a plate on the coping face, two lugs with collars round the post, two dome bolts
            C = np.array([P(u + (sx / 2 if j & 1 else -sx / 2), s_face - side * (st if j & 4 else -0.002), y0 - 0.03 - (sy if not (j & 2) else 0)) for j in range(8)])
            obs.append(U.block_object('rail_shoe', C, iron, coll, r=0.003, res=0.02, chips=0, wobble=0.0002))
            for (ya, yb_) in ((y0 - 0.215, y0 - 0.175), (y0 - 0.085, y0 - 0.045)):
                C = np.array([P(u + (0.013 if j & 1 else -0.013), s_face - side * (st - 0.002 if not (j & 4) else st + cfg['standoff'] + rp * 0.5), ya if not (j & 2) else yb_) for j in range(8)])
                obs.append(U.block_object('rail_lug', C, iron, coll, r=0.002, res=0.015, chips=0, wobble=0.0001))
                obs.append(FL.rod('rail_collar', [P(u, s_post, ya), P(u, s_post, (ya + yb_) / 2), P(u, s_post, yb_)], r_ + 0.008, iron, coll, chamfer=0.003))
            for du in (-0.033, 0.033):
                obs.append(dome('rail_bolt', P(u + du, s_face - side * st, y0 - 0.125), -n3, 0.011, 0.008, iron, coll, n=10))
            posts.append(dict(u=float(u), end=end))
            # rust from the shoe down the coping face and the brick below; a wet drip line under the post foot
            L1 = rng.uniform(0.18, 0.55) * (1.4 if end else 1.0)
            ys = np.r_[np.arange(y0 - 0.235, y0 - 0.25, -0.01), np.arange(y0 - 0.26, max(y0 - 0.25 - L1, sec.water + 0.03), -0.02)]
            ss = np.where(ys > y0 - 0.25, s_face - side * 0.0005, edge - side * 0.0005)
            ph = rng.uniform(0, 6)
            Pp = np.array([P(u + 0.008 * np.sin(y * 13 + ph), s_, y) for s_, y in zip(ss, ys)])
            obs.append(FL.stain('rail_rust', Pp, np.broadcast_to(-n3, Pp.shape), np.linspace(0.07, 0.04, len(ys)), mats['iron_trail'], coll))
            # (not a lime run-off: rust leaves no lime halo on the brick)
        # rails: through the knuckles, from end post to end post, on the bend's own offset line
        ra, rb = rail_ends
        ur = np.arange(ra, rb, 0.1)
        ur = np.r_[ur, rb]
        for h in hs:
            pts = path.world(ur, np.full(len(ur), s_post), np.full(len(ur), y0 + h))
            obs.append(FL.rod('rail_bar', pts, rr, iron, coll, chamfer=0.003, n=12, ends=(not seam(ra), not seam(rb))))
        # one collision slab per run, 5 cm thick, from the walkway to above the top rail
        ucol = np.r_[np.arange(ra, rb, 0.25), rb]
        cs = np.array([s_post + side * 0.025, s_post - side * 0.025, s_post - side * 0.025, s_post + side * 0.025])
        cy = np.array([y0 - 0.02, y0 - 0.02, y0 + cfg['collisionHeight'], y0 + cfg['collisionHeight']])
        Uu = np.broadcast_to(ucol[:, None], (len(ucol), 4))
        Pc = path.world(Uu, np.broadcast_to(cs, Uu.shape), np.broadcast_to(cy, Uu.shape))
        F = [list(f) for f in U.grid_faces(len(ucol), 4, closed_v=True)]
        nn = len(ucol)
        F += [[0, 1, 2, 3][::-1], [(nn - 1) * 4 + k for k in (0, 1, 2, 3)]]
        proxies.append(U.mesh_from_faces('rail_col_%d' % ri, Pc.reshape(-1, 3), F, coll_=col_coll, smooth=False))
    # escape irons down the channel face in every ladder gap, staggered
    escapes = []
    for su in shafts:
        if not any(a - 0.1 <= su <= b + 0.1 for a, b in runs) and 0.3 < su < path.length - 0.3:
            ys = np.arange(y0 - 0.3, sec.water - 0.35, -0.28)
            for k, y in enumerate(ys):
                off = 0.1 if k % 2 else -0.1
                pts = [P(su + off - 0.13, edge + side * 0.05, y), P(su + off - 0.13, edge - side * 0.11, y),
                       P(su + off + 0.13, edge - side * 0.11, y), P(su + off + 0.13, edge + side * 0.05, y)]
                o = U.tube('escape_iron', pts, 0.014, n=8, coll_=coll, mat=mats['iron_wet'])
                obs.append(o)
            escapes.append(dict(u=round(float(su), 2), top=[round(float(v), 3) for v in P(su, edge + side * 0.2, y0)],
                                bottom=[round(float(v), 3) for v in P(su, edge - side * 0.4, sec.water)]))
    FL.no_collision([o for o in obs if not o.name.startswith('escape_iron')])
    info['placements'].append(dict(piece='edge_rail', posts=len(posts), end_posts=sum(p['end'] for p in posts), runs=[[round(a, 2), round(b, 2)] for a, b in runs],
                                   spacing=cfg['postSpacing'], heights=hs, s_post=round(float(s_post), 3)))
    for e in escapes:
        info['placements'].append(dict(piece='escape_irons', **e))
    log('rail: %d runs, %d posts (%d dressed ends), %d escape iron flights' % (len(runs), len(posts), sum(p['end'] for p in posts), len(escapes)))
    return obs, proxies
