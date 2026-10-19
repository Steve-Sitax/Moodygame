"""Issue #174: the town's shop fronts, shop windows and front doors, rebuilt; every face drawn twice round them taken out.
    python scripts/repair-shopfronts.py <city audit> <streetlife audit> <kit models.json> <goods models.json> <candidate folder> [<churches audit> [<Carolus room audit>]]
The audits are audit exports (world-space rows) of every city_X_Z_* mesh and every streetlife mesh. The bake drew:
- a shop window's glass as one quad of the facade atlas (cells 4-6, 1: a painted shelf of jars), 0.12 m back in the wall;
- a front door's leaf as one quad (cells 4-7, 4), 0.2 m back, on a stone sill;
- 893 of the 1758 shop windows with a painted wooden front: plain boxes in the block's city_X_Z_d_3 mesh (pilasters, stall
  riser, sill, fascia and cornice, the cornice's top at 3.44 m).
Writes into the candidate folder:
  shopfronts.json   every window (its frame, its wooden front's paint and wear, its trade, the goods in its display, its lit
                    hours) and every door leaf (installed as world/town/facades/shopfronts.json; NativeShopFronts places the
                    models of build_shopfronts.py and shop_goods.py)
  manifest.json, *.bin  each changed mesh as rows (world space): the glass and door quads and the old wooden fronts taken
                    out, the faces drawn twice cut (zfight_fix.py), and plain collision boxes (the fronts, the glass, the
                    doors) for the mesh's stand-in (standIn-*.bin)
  report.json       counts
With the churches' audit (#28), the Carolus's painted doors, its dome's four dark discs and its nave roof's four louvred
dormers get real parts ("parts" in shopfronts.json): oak double doors over the side doors and the front's east door, a
panelled double door under an arched fanlight in the Jesuit house's doorway, a moulded ring with glazing bars round each
disc, louvres in each dormer. Each is found by its painted picture's cell in church_carolus_5 and _9. The Carolus room's
shell (ROOM_carolus) stands a few cm in front of the painted doors: with its audit, each door comes forward to stand 1 cm
in front of the shell's face in its opening (the louvres and round windows come forward to stand on their painted face).
"""
import collections, hashlib, json, math, pathlib, sys
import numpy as np
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import zfight_fix

CITY, SL, KIT, GOODS, OUT = (pathlib.Path(a) for a in sys.argv[1:6])
CHURCH = pathlib.Path(sys.argv[6]) if len(sys.argv) > 6 else None
ROOM = pathlib.Path(sys.argv[7]) if len(sys.argv) > 7 else None
OUT.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parents[1]
SIGNS = json.loads((ROOT.parent / "art-source/town-facades-20261018/signs-175.json").read_text())
LIGHTS = json.loads((ROOT / "world/town/lights.json").read_text())
KITM = json.loads(KIT.read_text()); GM = json.loads(GOODS.read_text())["models"]
SHOP_W = sorted(v["width"] for k, v in KITM.items() if k.startswith("head_"))
DOORS = [(k, v) for k, v in KITM.items() if k.startswith("door_")]
SHOP, DOOR = {(4, 1), (5, 1), (6, 1)}, {(4, 4), (5, 4), (6, 4), (7, 4)}
REVEAL, HG = 0.12, 2.256
# paint: the bake's door cells (dark green, oxblood, brown, deep blue) and shop sash cells (cream, dark green, brown), as
# the paint picture's tint; the wooden fronts carry their own paint in their vertex colour (SHOP_PAINT x the face's shade)
DOOR_PAINT = {(4, 4): (0.16, 0.3, 0.2), (5, 4): (0.42, 0.1, 0.08), (6, 4): (0.33, 0.2, 0.11), (7, 4): (0.11, 0.17, 0.33)}
SASH_PAINT = {(4, 1): (0.86, 0.82, 0.68), (5, 1): (0.16, 0.3, 0.2), (6, 1): (0.33, 0.2, 0.11)}
PAINT_K = 0.34  # (the paint picture is light: brings a tint to the bake's tone, as the shutters' PAINT_K)
report = collections.Counter()

def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)
def h01(*a):  # a stable number 0..1 from a place
    return int(hashlib.md5(("%.2f/" * len(a) % a).encode()).hexdigest()[:8], 16) / 0xFFFFFFFF

# ------------------------------------------------------------------ the meshes
surfaces, meta = {}, {}
for folder in (CITY, SL):
    for rec in json.loads((folder / "audit.json").read_text()):
        meta[rec["node"]] = rec
        for s in rec["surfaces"]:
            surfaces[(rec["node"], s["index"])] = (s["name"], np.fromfile(folder / "source" / s["file"], dtype=np.float32).reshape(-1, 3, 16))

def quads(T, idx):
    key = lambda p: tuple(np.round(p[:3], 3))
    vmap = collections.defaultdict(list)
    for k in idx:
        for v in T[k]: vmap[key(v)].append(k)
    used, out = set(), []
    for k in idx:
        if k in used: continue
        mates = collections.Counter(j for v in T[k] for j in vmap[key(v)] if j != k and j not in used and np.dot(T[j, 0, 3:6], T[k, 0, 3:6]) > 0.999)
        mate = [j for j, c in mates.items() if c >= 2]
        if mate: used.update((k, mate[0])); out.append((k, mate[0]))
    return out

def frame(T, k, j):
    pts = np.concatenate([T[k], T[j]]); P = np.unique(np.round(pts[:, :3], 4), axis=0)
    uv = np.array([pts[np.argmin(np.linalg.norm(pts[:, :3] - p, axis=1)), 6:8] for p in P]); u, v = uv[:, 0], uv[:, 1]
    o = P[np.argmin((u - u.min()) ** 2 + (v - v.min()) ** 2)]; ou = P[np.argmin((u - u.max()) ** 2 + (v - v.min()) ** 2)]; ov = P[np.argmin((u - u.min()) ** 2 + (v - v.max()) ** 2)]
    return o.astype(float), ou - o, ov - o, unit(T[k, 0, 3:6])

drop = collections.defaultdict(set)  # (node, surface) -> triangles taken out
windows, doors, fronts = [], [], []
for (node, si), (name, T) in surfaces.items():
    if not node.startswith("city_"): continue
    cell = np.round(T[:, 0, 8:10]).astype(int)
    if name == "material_23" and "_d_" not in node and node.endswith("_1"):
        for kind, cells in (("shop", SHOP), ("door", DOOR)):
            for k, j in quads(T, [i for i in range(len(T)) if tuple(cell[i]) in cells]):
                o, a, u, n = frame(T, k, j); w, h = float(np.linalg.norm(a)), float(np.linalg.norm(u))
                rec = {"chunk": node[: node.rindex("_")], "node": node, "surface": si, "tris": (k, j), "cell": tuple(map(int, cell[k])), "o": o,
                       "along": a / w, "n": n, "w": w, "h": h, "col": T[k, 0, 10:14].astype(float)}
                (windows if kind == "shop" else doors).append(rec)
                drop[(node, si)].update((k, j))
    if name == "city_wood" and node.endswith("_d_3"):
        top = np.where((np.abs(T[:, :, 1] - 3.44).max(1) < 0.003) & (T[:, 0, 4] > 0.99))[0]
        for k, j in quads(T, list(top)):
            fronts.append({"node": node, "surface": si, "pts": np.unique(np.concatenate([T[k], T[j]])[:, :3].round(4), axis=0), "col": T[k, 0, 10:14].astype(float)})
report["shop windows"], report["door leaves"], report["wooden fronts"] = len(windows), len(doors), len(fronts)

print("·", 'the wooden fronts', flush=True)
# ------------------------------------------------------------------ the wooden fronts: matched to their windows, taken out
for wdw in windows:
    o, a, n = wdw["o"], wdw["along"], wdw["n"]; c = o + a * wdw["w"] / 2; wall = o + n * REVEAL
    for f in fronts:
        P = f["pts"]; mid = P.mean(0)
        if np.linalg.norm((mid - c)[[0, 2]]) > 2.0: continue
        sa = (P[:, [0, 2]] - c[[0, 2]]) @ a[[0, 2]]; da = (P[:, [0, 2]] - wall[[0, 2]]) @ n[[0, 2]]
        if sa.min() < -wdw["w"] / 2 - 0.05 and sa.max() > wdw["w"] / 2 + 0.05 and da.min() > -0.02 and da.max() < 0.25:
            wdw["front"] = {"p": float((sa.max() - sa.min() - 0.08 - wdw["w"]) / 2), "col": f["col"], "node": f["node"], "surface": f["surface"]}
            break
    if "front" in wdw:
        # every piece of the old front: the d_3 wood in the front's box (pilasters, riser, sill, fascia, cornice)
        fr = wdw["front"]; T = surfaces[(fr["node"], fr["surface"])][1]; C = T[:, :, :3].mean(1)
        s_ = (C - c) @ a; d_ = (C - wall) @ n
        box = (np.abs(s_) < wdw["w"] / 2 + fr["p"] + 0.05) & (C[:, 1] > 0.1) & (C[:, 1] < 3.445) & (d_ > -0.01) & (d_ < 0.19)
        drop[(fr["node"], fr["surface"])].update(np.where(box)[0].tolist()); report["old front triangles"] += int(box.sum())
report["windows with a wooden front"] = sum(1 for w in windows if "front" in w)

print("·", 'trades', flush=True)
# ------------------------------------------------------------------ trades: the shop board over the window's front
boards = [s for s in SIGNS if s["kind"] == "board"]
TRADE_OF = {"tavern_zwaan": "tavern", "tavern_schip": "tavern"}
PLAIN_TRADES = ["grocer"] * 3 + ["bakery"] * 2 + ["draper"] * 2 + ["tobacco"] * 2 + ["bootmaker"] * 2 + ["chemist", "hatter", "clockmaker", "coffee", "wine", "locksmith", "chandler"]
for wdw in windows:
    c = wdw["o"] + wdw["along"] * wdw["w"] / 2 + wdw["n"] * REVEAL; best = None
    for b in boards:
        foot, along, wn = np.array(b["foot"]), np.array(b["along"]), np.array(b["wall"])
        if np.dot(wn, wdw["n"]) < 0.98 or abs(np.dot(foot - c, wdw["n"])) > 0.2: continue
        mid = foot + along * b["size"][0] / 2; dist = abs(np.dot(mid - c, along)) - b["size"][0] / 2
        if dist < 3.0 and (best is None or dist < best[0]): best = (dist, b["key"])
    if best: wdw["trade"] = TRADE_OF.get(best[1], best[1]); wdw["tradeFrom"] = "board"
for wdw in windows:  # (a window with no board: its neighbour's on the same front, else the street's own mix)
    if "trade" in wdw: continue
    c = wdw["o"] + wdw["along"] * wdw["w"] / 2
    near = [v for v in windows if "trade" in v and v.get("tradeFrom") == "board" and np.linalg.norm((v["o"] - wdw["o"])[[0, 2]]) < 4.5 and np.dot(v["n"], wdw["n"]) > 0.98]
    wdw["trade"] = near[0]["trade"] if near else PLAIN_TRADES[int(h01(round(c[0] / 6), round(c[2] / 6)) * len(PLAIN_TRADES)) % len(PLAIN_TRADES)]
    wdw["tradeFrom"] = "neighbour" if near else "street"
report.update({f"trade {k}": v for k, v in collections.Counter(w["trade"] for w in windows).items()})

# ------------------------------------------------------------------ lit hours: the bake's lit pane over the window
panes = np.array([p[:15] for p in LIGHTS["panes"]], float); pmid = (panes[:, 3:6] + panes[:, 6:9]) / 2
from scipy.spatial import cKDTree
pt = cKDTree(pmid)
for wdw in windows:
    c = wdw["o"] + wdw["along"] * wdw["w"] / 2 + np.array((0, wdw["h"] / 2, 0))
    d, i = pt.query(c)
    if d < 0.35 and panes[i, 14] == 1 and panes[i, 9] < 90: wdw["lit"] = [round(float(panes[i, 9]), 3), round(float(panes[i, 10]), 3)]
report["windows lit in the evening"] = sum(1 for w in windows if "lit" in w)

print("·", 'the displays', flush=True)
# ------------------------------------------------------------------ the displays
SPOTS = {"bed": (0.064, -0.282, 0.2), "step": (0.645, -0.34, 0.1), "shelf": (1.145, -0.34, 0.1)}  # top y, middle z, depth ("step": the low shelf)
DISPLAY = {  # trade: [(spot, models to cycle through)]; hanging: models hung from the ceiling
    "bakery": [("bed", ["loaf_round", "loaf_long", "loaf_tin", "loaf_round"]), ("bed", ["tart"]), ("step", ["gingerbread", "tart", "loaf_round"]), ("shelf", ["loaf_tin", "loaf_round"])],
    "grocer": [("bed", ["cheese_wheel", "cheese_cut", "cheese_ball", "jar_preserve"]), ("step", ["sugarloaf", "canister_red", "canister_green", "sack_beans"]), ("shelf", ["jar_preserve", "canister_red", "jar_preserve"])],
    "coffee": [("bed", ["sack_beans", "coffee_mill", "canister_black"]), ("step", ["canister_red", "canister_green", "canister_black", "sugarloaf"]), ("shelf", ["canister_black", "canister_red"])],
    "corn": [("bed", ["sack_grain", "measure", "sack_grain"]), ("step", ["sack_grain"]), ("shelf", ["jar_preserve"])],
    "chemist": [("bed", ["globe_red", "globe_green", "globe_blue"]), ("step", ["albarello", "bottle_med", "albarello"]), ("shelf", ["bottle_med", "albarello", "bottle_med"])],
    "wine": [("bed", ["keg", "demijohn"]), ("step", ["bottle_wine", "bottle_wine", "bottle_wine"]), ("shelf", ["bottle_wine", "bottle_wine"])],
    "tavern": [("bed", ["keg", "tankard"]), ("step", ["bottle_wine", "tankard", "bottle_wine"]), ("shelf", ["tankard", "tankard"])],
    "tobacco": [("bed", ["cigar_box", "albarello", "cigar_box"]), ("step", ["pipe_rack", "canister_green"]), ("shelf", ["albarello", "canister_green"])],
    "clockmaker": [("bed", ["pocket_watch", "mantel_clock", "pocket_watch"]), ("step", ["mantel_clock", "pocket_watch"]), ("shelf", ["mantel_clock"])],
    "bootmaker": [("bed", ["boot_black", "boot_brown", "boot_black"]), ("step", ["boot_brown", "boot_black"]), ("shelf", ["boot_black"])],
    "hatter": [("bed", ["top_hat", "bowler"]), ("step", ["hatbox", "bowler"]), ("shelf", ["top_hat", "hatbox"])],
    "draper": [("bed", ["folded_linen", "folded_wool"]), ("step", ["bolt_check", "bolt_stripe", "bolt_tweed", "bolt_print", "bolt_wool"]), ("shelf", ["folded_wool", "folded_linen"])],
    "butcher": [("bed", ["slab", "joint"]), ("step", ["joint"]), ("shelf", [])],
    "fish": [("bed", ["slab"]), ("step", ["slab"]), ("shelf", [])],
    "chandler": [("bed", ["rope_coil", "lantern", "canister_black"]), ("step", ["canister_red", "lantern", "rope_coil"]), ("shelf", ["canister_black", "canister_red"])],
    "ropemaker": [("bed", ["rope_coil", "rope_coil"]), ("step", ["rope_coil", "rope_coil"]), ("shelf", ["rope_coil"])],
    "cooper": [("bed", ["keg", "bucket"]), ("step", ["bucket", "keg"]), ("shelf", ["bucket"])],
    "locksmith": [("bed", ["padlock", "padlock", "padlock"]), ("step", ["key_board"]), ("shelf", ["padlock", "padlock"])],
}
HANG = {"butcher": ["ham", "sausages", "ham"], "fish": [], "locksmith": [], "chandler": ["lantern"]}
FISH_ON_SLAB = ["cod", "plaice", "herring"]  # the market's own fish models (smallgoods, workgoods): NativeShopFronts places them
UPRIGHT = {"bolt_check", "bolt_stripe", "bolt_tweed", "bolt_print", "bolt_wool", "key_board", "pipe_rack", "mantel_clock", "pocket_watch", "cigar_box", "slab"}

def lay_out(wdw):
    W = wdw["w"]; usable = W - 0.12; items = []; g = np.random.default_rng(int(h01(*wdw["o"][[0, 2]]) * 1e9))
    for spot, names in DISPLAY[wdw["trade"]]:
        if not names: continue
        y, zc, depth = SPOTS[spot]
        cap = {"bed": 4, "step": 5, "shelf": 5}[spot]
        row, x = [], 0.0
        k = 0
        while len(row) < cap:
            nm = names[k % len(names)]; size = GM[nm]["size"]; wd = size[0] if nm in UPRIGHT else max(size[0], size[2]) * 0.92
            if x + wd > usable: break
            row.append((nm, wd)); x += wd + 0.03; k += 1
        if not row: continue
        # (spread over the window, an even gap between them and at the ends)
        gap = (usable - sum(wd for _, wd in row)) / (len(row) + 1)
        x = -usable / 2 + gap
        for nm, wd in row:
            size, lo = GM[nm]["size"], GM[nm]["min"]
            turn = 0.0 if nm in UPRIGHT else float(g.uniform(-0.6, 0.6))
            dz = float(g.uniform(-0.25, 0.25)) * max(0.0, depth - size[2]) / 2
            # (the model's own middle on the spot; its foot on the surface)
            items.append({"m": nm, "x": round(x + wd / 2 - (lo[0] + size[0] / 2), 4), "y": round(y - lo[1], 4), "z": round(zc + dz - (lo[2] + size[2] / 2), 4), "r": round(turn, 3)})
            x += wd + gap
    if wdw["trade"] in ("fish",):  # the fish on the slabs
        for s in [i for i in items if i["m"] == "slab"]:
            for f in range(3):
                items.append({"m": "fish:" + FISH_ON_SLAB[(f + int(s["x"] * 10)) % 3], "x": round(s["x"] - 0.18 + 0.18 * f, 4), "y": round(s["y"] + 0.045, 4), "z": round(s["z"], 4), "r": round(float(g.uniform(-0.3, 0.3)), 3)})
    hang = HANG.get(wdw["trade"], [])
    for i, nm in enumerate(hang):
        if (i + 1) * 0.3 > usable: break
        lo = GM[nm]["min"]; size = GM[nm]["size"]
        items.append({"m": nm, "x": round(-usable / 2 + 0.2 + i * (usable - 0.4) / max(1, len(hang) - 1) if len(hang) > 1 else 0.0, 4), "y": round(HG - 0.5 - size[1] - lo[1] + 0.05, 4), "z": round(-0.3 - lo[2] - size[2] / 2, 4), "r": 0.0})
    # price cards before the goods on the bed, and the lamp hung in the middle
    bed = [i for i in items if abs(i["y"] - (SPOTS["bed"][0] - GM.get(i["m"], {"min": [0, 0, 0]})["min"][1])) < 1e-3]
    for i, it in enumerate(bed[: max(1, min(3, int(W / 0.6)))]):
        items.append({"m": f"price_{int(g.integers(0, 6))}", "x": round(it["x"] + float(g.uniform(-0.05, 0.05)), 4), "y": SPOTS["bed"][0], "z": -0.195, "r": round(float(g.uniform(-0.15, 0.15)), 3)})
    items.append({"m": "lamp", "x": 0.0 if W < 1.2 else round(float(g.uniform(-0.15, 0.15)), 4), "y": round(HG - 0.6 - 0.015, 4), "z": -0.24, "r": 0.0})
    return items

# ------------------------------------------------------------------ the window and door records, the collision boxes
def bucket(w, choices): return min(choices, key=lambda b: abs(b - w))
stand = collections.defaultdict(list)  # node -> world triangles for its collision stand-in
def box_tris(c, ax, half):
    """A box's 12 triangles: centre c, unit axes ax (3), half sizes."""
    P = [c + ax[0] * half[0] * sx + ax[1] * half[1] * sy + ax[2] * half[2] * sz for sx in (-1, 1) for sy in (-1, 1) for sz in (-1, 1)]
    F = [(0, 1, 3), (0, 3, 2), (4, 6, 7), (4, 7, 5), (0, 4, 5), (0, 5, 1), (2, 3, 7), (2, 7, 6), (0, 2, 6), (0, 6, 4), (1, 5, 7), (1, 7, 3)]
    return [P[i] for f in F for i in f]
Y = np.array((0.0, 1.0, 0.0))
out_w, out_d = [], []
for wdw in windows:
    a, n, o = wdw["along"], wdw["n"], wdw["o"]
    x = a if np.dot(np.cross(a, Y), n) > 0 else -a  # (a right-handed frame: the models are the same both ways across)
    base = o + a * wdw["w"] / 2 + n * REVEAL  # the wall's face at the middle of the sill
    rec = {"chunk": wdw["chunk"], "at": base.round(4).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "w": round(wdw["w"], 4),
           "bucket": f"{bucket(wdw['w'], SHOP_W):.2f}".replace(".", ""), "wear": round(float(wdw["col"][3]), 3), "trade": wdw["trade"]}
    if "front" in wdw:
        tint = wdw["front"]["col"][:3] / 0.8  # (the pilaster's front face: shade 0.8 of the paint)
        rec["front"] = {"p": round(max(0.06, wdw["front"]["p"]), 4), "paint": (tint * PAINT_K).round(4).tolist(), "wear": round(float(wdw["front"]["col"][3]), 3)}
        rec["sash"] = rec["front"]["paint"]
        # collision: the pilasters, the stall riser and its sill, the fascia (the old boxes' places)
        fn = wdw["front"]["node"]; p = rec["front"]["p"]
        for sgn in (-1, 1): stand[fn] += box_tris(base + x * sgn * (wdw["w"] / 2 + p / 2) + Y * ((-0.593 + 2.256) / 2) + n * 0.05, (x, Y, n), (p / 2, (2.256 + 0.593) / 2, 0.05))
        stand[fn] += box_tris(base + Y * (-0.593 / 2) + n * 0.03, (x, Y, n), (wdw["w"] / 2, 0.593 / 2, 0.03))
        stand[fn] += box_tris(base + Y * (-0.035) + n * 0.0, (x, Y, n), (wdw["w"] / 2, 0.035, 0.12))
    else:
        rec["sash"] = (np.array(SASH_PAINT[wdw["cell"]]) * PAINT_K).round(4).tolist()
    # collision: the glass (the painted pane was the window's only face)
    stand[wdw["node"]] += box_tris(base - n * (REVEAL - 0.012) + Y * (HG / 2), (x, Y, n), (wdw["w"] / 2, HG / 2, 0.012))
    if "lit" in wdw: rec["lit"] = wdw["lit"]
    rec["goods"] = lay_out(wdw)
    out_w.append(rec)
# the doors: a double door's two leaves meet in the middle; the leaf whose hinge is on the left of the pair gets the knob
for d in doors:
    a, n, o = d["along"], d["n"], d["o"]
    x = a if np.dot(np.cross(a, Y), n) > 0 else -a
    W, H = d["w"], d["h"]
    pair = [e for e in doors if e is not d and np.linalg.norm(e["o"] + e["along"] * e["w"] - (o + a * W)) < 0.03 and np.dot(e["along"], a) < -0.99]
    name = min(DOORS, key=lambda kv: (kv[1]["double"] != bool(pair), abs(kv[1]["width"] - W) + abs(kv[1]["height"] - H)))[0]
    hinge = o + n * 0.0  # (the leaf's back at the back of the reveal, where the painted leaf was)
    rec = {"chunk": d["chunk"], "hinge": hinge.round(4).tolist(), "along": a.round(5).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "w": round(W, 4), "h": round(H, 4),
           "model": name, "paint": (np.array(DOOR_PAINT[d["cell"]]) * PAINT_K * min(1.0, float(d["col"][:3].mean()) / 0.85)).round(4).tolist(), "wear": round(float(d["col"][3]), 3)}
    first = not pair or np.dot(np.cross(a, Y), n) > 0
    rec["knob"] = bool(first); rec["letterplate"] = bool(not pair or not first)
    out_d.append(rec)
    stand[d["node"]] += box_tris(hinge + a * W / 2 + Y * H / 2 + n * 0.025, (x, Y, n), (W / 2, H / 2, 0.025))
report["door pairs"] = sum(1 for r in out_d if not r["knob"])

print("·", 'the faces drawn twice', flush=True)
# ------------------------------------------------------------------ the Carolus (#28)
parts = []
if CHURCH:
    def pieces(T, sel):
        idx = list(np.where(sel)[0]); up = {i: i for i in idx}
        def f(i):
            while up[i] != i: i = up[i]
            return i
        at = collections.defaultdict(list)
        for i in idx:
            for v in T[i, :, :3]: at[tuple(np.round(v, 3))].append(i)
        for l in at.values():
            for j in l[1:]: up[f(j)] = f(l[0])
        g = collections.defaultdict(list)
        for i in idx: g[f(i)].append(i)
        return list(g.values())
    def face_frame(T, g):
        P = T[g][:, :, :3].reshape(-1, 3).astype(float); n = unit(T[g[0], 0, 3:6]); x = np.cross(Y, n); x = unit(x)
        s_ = (P - P.mean(0)) @ x
        return P, n, x, P.mean(0) + x * (s_.min() + s_.max()) / 2, float(s_.max() - s_.min()), float(P[:, 1].min()), float(P[:, 1].max())
    OAK, LOUVRE, BARS = (0.24, 0.14, 0.08), (0.36, 0.34, 0.3), (0.14, 0.14, 0.14)
    shell = []  # the room shell's triangles (world rows), for the doors to come in front of
    if ROOM:
        for rec in json.loads((ROOM / "audit.json").read_text()):
            for si in rec["surfaces"]:
                T = np.fromfile(ROOM / "source" / si["file"], dtype=np.float32)
                if T.size % 48 == 0: shell.append(T.reshape(-1, 3, 16)[:, :, :6].astype(float))
    shell = np.concatenate(shell) if shell else np.zeros((0, 3, 6))
    def forward(mid, n, x, w, y0, y1):
        """How far in front of the painted face (mid, n) the room shell's faces across the opening stand: 1 cm more."""
        if not len(shell): return 0.0
        nt = shell[:, 0, 3:6]; P = shell[:, :, :3]
        d = (P - mid) @ n; s_ = (P - mid) @ x
        hit = (np.abs(nt @ n) > 0.95) & (d.min(1) > 0.0) & (d.max(1) < 0.4) & (s_.max(1) > -w / 2) & (s_.min(1) < w / 2) & (P[:, :, 1].max(1) > y0 + 0.1) & (P[:, :, 1].min(1) < y1 - 0.1)  # (not a step's riser at its foot)
        return float(d[hit].max()) + 0.01 if hit.any() else 0.0
    for rec in json.loads((CHURCH / "audit.json").read_text()):
        if rec["node"] not in ("church_carolus_5", "church_carolus_9"): continue
        for si in rec["surfaces"]:
            T = np.fromfile(CHURCH / "source" / si["file"], dtype=np.float32).reshape(-1, 3, 16)
            uv = T[:, :, 6:8].mean(1) * (256 if rec["node"] == "church_carolus_5" else 512)
            u, v = uv[:, 0], uv[:, 1]
            if rec["node"] == "church_carolus_5":
                kinds = {"door": (u >= 64) & (u < 128) & (v >= 160), "disc": (u >= 208) & (u < 216) & (v >= 120) & (v < 128), "dormer": (u >= 96) & (u < 128) & (v >= 48) & (v < 112)}
            else:
                kinds = {"door": (u >= 352) & (u < 416) & (v >= 384)}  # (its 512-texel picture's door cell)
            for kind, sel in kinds.items():
                for g in pieces(T, sel):
                    P, n, x, mid, w, y0, y1 = face_frame(T, g)
                    if kind == "door": mid = mid + n * forward(mid, n, x, w, y0, y1)
                    elif kind == "disc": mid = mid + n * 0.04  # (the round window's glass just in front of the painted disc)
                    else: mid = mid + n * 0.062  # (the louvres' frame on the dormer's painted opening)
                    foot = np.array((mid[0], y0, mid[2]))
                    if kind == "door" and y1 - y0 < 3.4:  # the Jesuit house: a door under an arched fanlight (its half circle w/2)
                        r = w / 2; spring = y1 - r
                        for sgn in (-1, 1):  # two leaves hung at the jambs, meeting in the middle
                            hinge = foot + x * sgn * r
                            parts.append({"model": "door_075_215", "at": (hinge - x * sgn * r / 2 + n * 0.0).round(4).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "sx": r / 0.75, "sy": (spring - y0) / 2.15, "paint": OAK, "centred": 0.375})
                        parts.append({"model": "fanlight", "at": (np.array((mid[0], spring, mid[2]))).round(4).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "sx": r / 0.75, "sy": r / 0.75, "paint": OAK})
                        report["carolus arched doors"] += 1
                    elif kind == "door":  # an oak double door, a leaf from each jamb
                        for sgn in (-1, 1):  # (x = up x n is right-handed: the leaf on +x has its meeting stile, and its ring, at its x = 0)
                            parts.append({"model": "church_door_l" if sgn > 0 else "church_door_r", "at": (foot + x * sgn * w / 4).round(4).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "sx": (w / 2) / 0.95, "sy": (y1 - y0) / 4.1, "paint": OAK, "centred": 0.475, "mirror": sgn})
                        report["carolus doors"] += 1
                    elif kind == "disc":
                        parts.append({"model": "oculus", "at": np.array((mid[0], (y0 + y1) / 2, mid[2])).round(4).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "sx": (w / 2) / 0.2 * 1.0, "sy": (w / 2) / 0.2, "paint": BARS})
                        report["carolus dome discs"] += 1
                    else:
                        parts.append({"model": "louvre", "at": foot.round(4).tolist(), "x": x.round(5).tolist(), "n": n.round(5).tolist(), "sx": w / 0.56, "sy": (y1 - y0) / 0.85, "paint": LOUVRE})
                        report["carolus dormers"] += 1
    for p_ in parts: p_["paint"] = (np.array(p_["paint"]) * PAINT_K).round(4).tolist(); p_.pop("mirror", None)

# ------------------------------------------------------------------ the faces drawn twice, round every front and door
import os
if os.environ.get("SHOPFRONTS_LIST_ONLY") == "1":  # (to work on the displays: only shopfronts.json)
    (OUT / "shopfronts.json").write_text(json.dumps({"issue": 174, "windows": out_w, "doors": out_d, "parts": parts}, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else o.tolist()))
    print(json.dumps(dict(report), indent=1, default=str)); sys.exit(0)
zones = [w["at"][0::2] for w in out_w] + [d["hinge"][0::2] for d in out_d]
work = {}
for key, (name, T) in surfaces.items():
    if key in drop:
        keep = np.ones(len(T), bool); keep[list(drop[key])] = False; work[key] = (name, T[keep])
    else: work[key] = (name, T)
fixed, zrep = zfight_fix.resolve(work, np.array(zones), radius=2.6, ymax=4.3)
report.update({"z-fight " + k: v for k, v in zrep.items() if k != "byKind"}); report["z-fight kinds"] = zrep["byKind"]
# (a cut can bring two other faces together, e.g. a cut piece still over a third face: again until none are left)
for again in range(2, 5):
    if not zrep["pairs"]: break
    more, zrep = zfight_fix.resolve({k: (n_, fixed.get(k, T)) for k, (n_, T) in work.items()}, np.array(zones), radius=2.6, ymax=4.3)
    fixed.update(more); report[f"z-fight pass {again} pairs"] = zrep["pairs"]
    print("·", f"pass {again}: {zrep['pairs']} pairs", flush=True)
changed = set(drop) | set(fixed)

print("·", 'write', flush=True)
# ------------------------------------------------------------------ write
manifest = {}
by_node = collections.defaultdict(list)
for key in changed: by_node[key[0]].append(key[1])
for node in sorted(set(by_node) | set(stand)):
    rec = meta[node]; surfs = []
    for s in rec["surfaces"]:
        key = (node, s["index"])
        T = fixed[key] if key in fixed else work[key][1]
        f = f"{pathlib.Path(rec['mesh']).stem}-{s['index']}.bin"
        T.reshape(-1).astype(np.float32).tofile(OUT / f)
        surfs.append({"file": f, "material": s["material"], "custom0": s["custom0"], "vertices": int(len(T) * 3)})
    entry = {"node": node, "sourceHash": rec["meshHash"], "surfaces": surfs}
    if stand.get(node):
        sf = f"standIn-{pathlib.Path(rec['mesh']).stem}.bin"; np.asarray(stand[node], np.float32).tofile(OUT / sf); entry["standInAdd"] = sf
    manifest[rec["mesh"]] = entry
    report["meshes changed"] += 1
manifest["install"] = {"res://world/town/facades/shopfronts.json": "shopfronts.json"}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
(OUT / "shopfronts.json").write_text(json.dumps({"issue": 174, "about": "The shop windows (their fronts, trades, goods and lit hours) and front doors of the town (scripts/repair-shopfronts.py).",
                                                  "windows": out_w, "doors": out_d, "parts": parts}, separators=(",", ":"), default=lambda o: o.item() if hasattr(o, "item") else o.tolist()))
(OUT / "report.json").write_text(json.dumps(dict(report), indent=1, default=str))
print(json.dumps(dict(report), indent=1, default=str))
