"""Climbers on big blank house walls (#219: "use the new grown climbers to dress buildings with big empty walls").
    godot --headless --path native-godot --script res://scripts/paving/dump-near-any.gd -- <near> <points.json> 6 city_
    python scripts/paving/wall_climbers.py <sites json> <near> <out folder>
    godot --headless --path native-godot -s scripts/build-wall-climbers.gd -- <out folder>
<sites json>: world/town/wall-climbers.json. Each site is a blank wall chosen by its setting (a lane behind a church, a
wall over a square, a back alley; never a wall with a door, window, sign, lamp or shop front in the plants' reach): the
wall's foot at x, z on the brick's face line, the wall's way along and out, and the plants rooted along it, each a
colony grown by climbers.py's own grow() (its kind: 0 or 1 ivy, 2 Virginia creeper in red, 3 turning orange; where on
the wall, in metres from the site's point; its spread), so they are the town wall's plants: the same stems, rootlets,
tendrils and leaves, in the same material. The faces behind each plant are the dumped city meshes' (rays onto the real
brick, plinth and cornice). Writes <id>.f32 (22 floats a corner, as climbers.py's) and manifest.json.
"""
import sys, json, pathlib, hashlib
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import climbers as C

# (a house wall has no coping to run over: its top is the eaves; the leaders stop under them)
C.over_cap = lambda rng, face, s, h, sp_ivy: ([], sp_ivy)

def main():
    sites = json.load(open(sys.argv[1], encoding='utf-8'))['sites']
    near = pathlib.Path(sys.argv[2]); out = pathlib.Path(sys.argv[3]); out.mkdir(parents=True, exist_ok=True)
    T = np.fromfile(near / 'near.f32', np.float32).reshape(-1, 3, 3).astype(float)
    bmin, bmax = T.min(1), T.max(1)
    manifest, report = [], {}
    for site in sites:
        x, z = site['at']; along = np.array([site['along'][0], 0.0, site['along'][1]]); outn = np.array([site['out'][0], 0.0, site['out'][1]])
        along /= np.linalg.norm(along); outn /= np.linalg.norm(outn)
        # (climbers.py's own way along a wall: up crossed with out; the plants' places follow the site's way)
        way = np.cross(C.UP, outn); sign = 1.0 if way @ along >= 0 else -1.0; along = way
        rows, rep = [], dict(plants=0, cards=0, heights=[])
        for k, plant in enumerate(site['plants']):
            s0 = plant['at'] * sign
            foot = np.array([x, 0.0, z]) + along * s0
            # the wall's faces round the plant (by outline), facing out
            m = ((bmin[:, [0, 2]] - 5 <= foot[[0, 2]]) & (foot[[0, 2]] <= bmax[:, [0, 2]] + 5)).all(1)
            # (not the kerbs, steps and gutters at the wall's foot: only faces reaching 0.4 m up)
            Tn = T[m & (T[:, :, 1].max(1) > 0.4)]
            # its foot: the street's level there (the flat faces whose outline holds the plant's foot, under 1 m: the paving,
            # not a cellar's or a sill's)
            Tm = T[m]; nm = np.cross(Tm[:, 1] - Tm[:, 0], Tm[:, 2] - Tm[:, 0]); nm /= np.linalg.norm(nm, axis=1)[:, None] + 1e-12
            q = foot + outn * 0.3
            flat = Tm[(np.abs(nm[:, 1]) > 0.9) & (Tm.min(1)[:, 0] <= q[0]) & (Tm.max(1)[:, 0] >= q[0]) & (Tm.min(1)[:, 2] <= q[2]) & (Tm.max(1)[:, 2] >= q[2]) & (Tm[:, :, 1].max(1) < 1.0)]
            ground = float(np.median(flat[:, :, 1])) if len(flat) else 0.0
            base = foot.copy(); base[1] = ground + 0.25
            # the brick's face behind the plant: the plan's line is the house's outline; the drawn wall may stand a little
            # in front of it or behind it (its plinth, its render): the depth grid's middle at 1.5 to 4 m sets the foot on it
            face = C.Face(Tn, base, along, outn)
            mid = face.w[face.ns // 2 - 4: face.ns // 2 + 5, int((1.5 - face.h0) / C.G): int((4 - face.h0) / C.G)]
            # (only near the line: a face metres behind is another wall's, seen past this one's edge)
            mid = mid[np.isfinite(mid) & (np.abs(mid) < 0.3)]
            if mid.size or site.get('lift'):
                base = base + outn * (float(np.median(mid)) if mid.size else 0.0)
                face = C.Face(Tn, base, along, outn)
                # (lift: the stems off the brick by that much, over the coats drawn on it at load)
                face.w = face.w + site.get('lift', 0.0)
            # (a draw whose stems found no wall to start on, at its root's dice, is drawn again: the next seed)
            for again in range(6):
                seed = int(hashlib.sha256(f"{site['id']}:{k}".encode()).hexdigest()[:8], 16) + again
                rng = np.random.default_rng(seed)
                r, cards, H, caps, reached = C.grow(rng, base, along, outn, plant.get('width', 3.0), plant['kind'], face, seed, shift=0.0, spread=plant.get('spread', 1.0))
                if reached > 1.0: break
            if len(r): rows.append(r)
            print(' ', site['id'], k, 'street', round(ground, 3), 'reach', round(reached, 2), flush=True)
            rep['plants'] += 1; rep['cards'] += cards; rep['heights'].append(round(reached, 2))
        A = np.concatenate(rows).astype(np.float32)
        A.tofile(out / f"{site['id']}.f32")
        manifest.append({'id': site['id'], 'file': f"{site['id']}.f32", 'triangles': len(A) // 3})
        report[site['id']] = dict(rep, triangles=len(A) // 3)
        print(site['id'], len(A) // 3, 'triangles', rep, flush=True)
    (out / 'manifest.json').write_text(json.dumps({'climbers': manifest, 'material': C.MAT}, indent=1))
    (out / 'report.json').write_text(json.dumps(report, indent=1))

if __name__ == '__main__':
    main()
