"""Issue #193: the town's streets and the name on each street name plate. Usage:
    python scripts/town_streets.py <work folder> [<pipes.json>]
The bake named a plate by a hash of its wall's line (the browser's streetlife.ts streetName), so 9 of the 26 names went
round the town and most corners named another street. Here the streets come from the town itself:
- the open ground of the walk map (world/data/public/city/walk.png, 0.5 m cells) is thinned to its centre lines, cut into
  pieces at the junctions, short spurs dropped; pieces that run straight on through a junction (within 45 degrees), and
  the two halves of a street that jogs at a junction (ends within 9 m, in line within 35 degrees, under 3.5 m apart
  across), are one street;
- each plate (art-source/town-facades-20261018/signs-175.json: every plate the #175 repair built) stands on a house wall
  by a corner (the bake's streetlife meta walls and corners); its street is the one whose centre line runs along the wall
  in the band in front of it (to 15 m out, 10 m either way along, within 30 degrees);
- a plate that opens on a square or quay (wide open ground 6 m in front, near the place) names the square;
- names: the bake's twenty street names first (the plates by the Braderijstraat corner, x -207 z 130, keep theirs; the
  quay road is the Rijnkaai), then more names of old Antwerp streets; streets with more plates first. A plate whose new
  name would not fit its wall (clear of boards, painted lettering and hanging signs, short of the wall's end) has its
  street swap names with a shorter-named street. pipes.json (the downpipes' columns at plate height, {"pipes": [[x, z], ...]})
adds the drainage of #163 to that test: a longer plate must not run behind a pipe the old one was clear of.
Writes world/town/facades/streets.json (the names, each plate's name, each named street's centre line) into the project and
a map picture into the work folder. Needs numpy, scipy, scikit-image, Pillow."""
import collections, json, math, pathlib, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage
from scipy.spatial import cKDTree
from skimage.morphology import disk, opening, skeletonize

WORK = pathlib.Path(sys.argv[1]); WORK.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parents[1]
CITY = json.loads((ROOT.parent / "art-source/shared/city.json").read_text())
META = json.loads(json.loads((ROOT / "assets/game-models/streetlife.extras.json").read_text())["streetlife_meta"]["meta"])
SIGNS = json.loads((ROOT.parent / "art-source/town-facades-20261018/signs-175.json").read_text())
OUT = ROOT / "world/town/facades/streets.json"
OLD = META["streetNames"][:META["plates"]]  # the bake's 20 streets, then its 6 squares and quays
MORE = ["OUDE KOORNMARKT", "MELKMARKT", "LANGE NIEUWSTRAAT", "KORTE NIEUWSTRAAT", "WOLSTRAAT", "HOFSTRAAT", "KAMMENSTRAAT",
        "LOMBARDENVEST", "KIEKENSTRAAT", "GROTE PIETER POTSTRAAT", "KLEINE PIETER POTSTRAAT", "VLEESHOUWERSSTRAAT", "OUDELEEUWENRUI",
        "SINT-PAULUSSTRAAT", "SINT-JACOBSSTRAAT", "TWAALFMAANDENSTRAAT", "KORTE RIDDERSTRAAT", "LANGE RIDDERSTRAAT", "HAARSTRAAT",
        "VLEMINCKVELD", "EIERMARKT", "WISSELSTRAAT", "KOLVENIERSSTRAAT", "JEZUIETENRUI", "MINDERBROEDERSRUI", "KEIZERSTRAAT",
        "PRINSSTRAAT", "RODESTRAAT", "BLINDESTRAAT", "ZWARTZUSTERSTRAAT", "SINT-KATELIJNEVEST", "HESSENBRUG", "REYNDERSSTRAAT",
        "HEILIGE-GEESTSTRAAT", "NOSESTRAAT", "SINT-PIETERSVLIET", "KLAPDORP", "BRILSTRAAT", "KAASBRUG", "KIPDORP",
        "LANGE GASTHUISSTRAAT", "KORTE GASTHUISSTRAAT", "SCHOENMARKT", "HUIDEVETTERSSTRAAT", "LANGE KLARENSTRAAT",
        "KORTE KLARENSTRAAT", "STEENHOUWERSVEST", "KLOOSTERSTRAAT", "SINT-ANDRIESSTRAAT", "LANGE KOEPOORTSTRAAT",
        "KORTE KOEPOORTSTRAAT", "VRIJDAGMARKT", "LEGUIT", "HOPLAND", "WAPPER", "ARENBERGSTRAAT", "SINT-JACOBSMARKT", "FALCONRUI",
        "VERVERSRUI", "PAARDENMARKT", "MUTSAERTSTRAAT", "JEZUSSTRAAT", "SINT-JANSVLIET", "POTTENBRUG", "IJZERENWAAG", "ZILVERSMIDSTRAAT",
        "MUNTSTRAAT", "SINT-ROCHUSSTRAAT", "KRONENBURGSTRAAT", "SCHUTTERSHOFSTRAAT", "WIJNGAARDBRUG", "VINGERLINGSTRAAT",
        "KROMME ELLEBOOG", "EVERDIJSTRAAT", "GILDEKAMERSSTRAAT", "CONSCIENCEPLEIN", "SINT-JANSPLEIN", "LIJNWAADMARKT"]
SQUARE = {"GROTE MARKT": (-254, 94, 40), "VISMARKT": (-118, 30, 40), "STEENPLEIN": (-180, 20, 40), "HANDSCHOENMARKT": (-262, 132, 25),
          "WERF": (-270, 6, 40), "RIJNKAAI": (20, 20, 45), "CONSCIENCEPLEIN": (-116, 160, 25), "SINT-JANSPLEIN": (20, 296, 28),
          "LIJNWAADMARKT": (-213.1, 180, 22)}
KEEP = {(-200.0, 133.47): "BRADERIJSTRAAT", (-198.86, 132.0): "VLASMARKT"}  # plate at (x, z): its name stays
ANCHOR_PT = {"RIJNKAAI": (60.0, 17.0)}  # the street nearest this point gets the name

# ------------------------------------------------------------------ the open ground's centre lines
wk = CITY["walk"]; x0, z0, res = float(wk["x0"]), float(wk["z0"]), float(wk["res"])
im = np.asarray(Image.open(ROOT / "world/data/public/city/walk.png").convert("RGB")).astype(int)  # rows x, columns z
free = opening((im[:, :, 0] < 128) & (im[:, :, 1] < 128) & (im[:, :, 2] < 128), disk(2))
dist = ndimage.distance_transform_edt(free) * res
sk = skeletonize(free)
NB = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]
pts = set(zip(*np.nonzero(sk)))
deg = {p: sum((p[0] + a, p[1] + b) in pts for a, b in NB) for p in pts}
nodes = {p for p, d in deg.items() if d != 2}
E, seen = [], set()
for n in nodes:
    for a, b in NB:
        q = (n[0] + a, n[1] + b)
        if q not in pts or (n, q) in seen: continue
        path = [n, q]; seen.add((n, q)); prev, cur = n, q
        while cur not in nodes:
            nxt = [(cur[0] + a2, cur[1] + b2) for a2, b2 in NB if (cur[0] + a2, cur[1] + b2) in pts and (cur[0] + a2, cur[1] + b2) != prev and (cur[0] + a2, cur[1] + b2) not in path[-3:]]
            if not nxt: break
            prev, cur = cur, nxt[0]; path.append(cur)
        seen.add((path[-1], path[-2])); E.append(np.array(path))
def key(p): return (int(p[0]), int(p[1]))
def world(rc): return np.stack([x0 + rc[:, 0] * res, z0 + rc[:, 1] * res], 1)
for _ in range(4):  # spurs: a piece with a loose end, shorter than 6 m and a bit more on wide ground
    d = collections.Counter()
    for e in E: d[key(e[0])] += 1; d[key(e[-1])] += 1
    E = [e for e in E if not ((d[key(e[0])] == 1 or d[key(e[-1])] == 1) and len(e) * res < 6 + 1.5 * dist[tuple(e[len(e) // 2])])
         and not (key(e[0]) == key(e[-1]) and len(e) * res < 4)]
changed = True
while changed:  # pieces meeting at a node of two are one piece
    changed = False; at = collections.defaultdict(list)
    for i, e in enumerate(E): at[key(e[0])].append(i); at[key(e[-1])].append(i)
    for k, lst in at.items():
        if len(lst) == 2 and lst[0] != lst[1]:
            a, b = E[lst[0]], E[lst[1]]
            if key(a[-1]) != k: a = a[::-1]
            if key(b[0]) != k: b = b[::-1]
            E[lst[0]] = np.concatenate([a, b[1:]]); E.pop(lst[1]); changed = True; break
def end_dir(e, at_start):
    w = world(e); n = min(len(w) - 1, 16); v = (w[n] - w[0]) if at_start else (w[-1 - n] - w[-1])
    return v / (np.linalg.norm(v) + 1e-9)
N = len(E); up = list(range(N))
def find(i):
    while up[i] != i: up[i] = up[up[i]]; i = up[i]
    return i
def join(i, j): ri, rj = find(i), find(j); up[max(ri, rj)] = min(ri, rj)
J = collections.defaultdict(list)
for i, e in enumerate(E): J[key(e[0])].append((i, True)); J[key(e[-1])].append((i, False))
for k, lst in J.items():
    if len(lst) < 3: continue
    cand = sorted((float(np.dot(end_dir(E[i], si), end_dir(E[j], sj))), i, j) for a, (i, si) in enumerate(lst) for (j, sj) in lst[a + 1:] if i != j)
    used = set()
    for c, i, j in cand:
        if c > -0.7: break
        if i in used or j in used: continue
        used.update((i, j)); join(i, j)
def ends_of(idx):
    c = collections.Counter()
    for i in idx: c[key(E[i][0])] += 1; c[key(E[i][-1])] += 1
    return [(world(E[i][:1] if s else E[i][-1:])[0], end_dir(E[i], s)) for i in idx for s in (True, False) if c[key(E[i][0] if s else E[i][-1])] == 1]
for _ in range(3):
    groups = collections.defaultdict(list)
    for i in range(N): groups[find(i)].append(i)
    big = [r for r, idx in groups.items() if sum(len(E[i]) for i in idx) * res > 8]
    ends = {r: ends_of(groups[r]) for r in big}
    for a in range(len(big)):
        for b in range(a + 1, len(big)):
            ra, rb = big[a], big[b]
            if find(ra) == find(rb): continue
            if any(np.linalg.norm(pb - pa) <= 9 and np.dot(da, db) <= -0.82 and abs(np.dot(pb - pa, np.array([-da[1], da[0]]))) < 3.5
                   for pa, da in ends[ra] for pb, db in ends[rb]):
                join(ra, rb)
groups = collections.defaultdict(list)
for i in range(N): groups[find(i)].append(i)
streets = []
for sid, (_, idx) in enumerate(sorted(groups.items(), key=lambda kv: -sum(len(E[i]) for i in kv[1]))):
    streets.append({"id": sid, "pts": np.concatenate([world(E[i]) for i in idx]), "length": round(sum(len(E[i]) for i in idx) * res, 1),
                    "dirs": np.concatenate([np.array([(lambda a, b: (b - a) / (np.linalg.norm(b - a) + 1e-9))(world(E[i])[max(0, k - 5)], world(E[i])[min(len(E[i]) - 1, k + 5)]) for k in range(len(E[i]))]) for i in idx])})
allp = np.concatenate([s["pts"] for s in streets]); alld = np.concatenate([s["dirs"] for s in streets])
owner = np.concatenate([[s["id"]] * len(s["pts"]) for s in streets])
print(len(streets), "streets in the walk map")

# ------------------------------------------------------------------ each plate's wall and street
walls = [np.array(w[:6], float) for w in META["walls"]]
CORNERS = [np.array(c[:2], float) for c in META["corners"]]
others = [s for s in SIGNS if s["kind"] in ("board", "letters", "hanging")]
PIPES = np.array(json.loads(pathlib.Path(sys.argv[2]).read_text())["pipes"]) if len(sys.argv) > 2 else np.zeros((0, 2))
def wall_of(p):
    best = None
    for w in walls:
        a, b, o = w[0:2], w[2:4], w[4:6]; t = b - a; L = np.linalg.norm(t)
        if L < 0.3: continue
        t = t / L; s, d = np.dot(p - a, t), np.dot(p - a, o)
        if -0.05 <= s <= L + 0.05 and abs(d) < 0.15 and (best is None or abs(d) < best[0]): best = (abs(d), t, o, a, b, -d)
    return best
plates = []
for s in SIGNS:
    if s["kind"] != "plate": continue
    p = np.array([s["at"][0], s["at"][2]]); w = wall_of(p)
    if w is None: raise SystemExit(f"plate without a wall: {s}")
    plates.append({"old": s["text"], "at": s["at"], "size": s["size"], "p": p, "t": w[1], "o": w[2], "wall_off": w[5]})
tree = cKDTree(allp)
for pl in plates:
    p, t, o = pl["p"], pl["t"], pl["o"]; pl["street"] = None
    for dmax in (15.0, 22.0):
        rel = allp - p; out, along = rel @ o, rel @ t
        sel = (out > 0.8) & (out < dmax) & (np.abs(along) < 10) & (np.abs(alld @ t) > 0.86)
        if sel.any(): pl["street"] = int(collections.Counter(owner[sel].tolist()).most_common(1)[0][0]); break
    if pl["street"] is None: pl["street"] = int(owner[tree.query(p + o * 2.5)[1]])
def L_of(name): return (6 * len(name) + 7) * 0.022  # (the bake's plate: 6 letter cells of 22 mm, and 7 for its margins)
PLACED = {}
def place(pl, name):
    k = (id(pl), len(name))  # (only the name's length matters)
    if k not in PLACED: PLACED[k] = place_(pl, name)
    return PLACED[k]
def place_(pl, name):
    """Where on its wall the plate with this name goes: its end by the corner where the old one's was, or slid on away
    from the corner (up to 1.2 m, as the bake slid a plate past a sign) until it is short of the wall's end and clear of
    boards, lettering, hanging signs and downpipes (a pipe the old plate already crossed may stay). Returns the slide in
    metres, or None when there is no such place."""
    p, t, o = pl["p"], pl["t"], pl["o"]; Lo, Ln = L_of(pl["old"]), L_of(name)
    cn = min(CORNERS, key=lambda c: np.linalg.norm(c - p)); away = t if np.dot(p - cn, t) > 0 else -t
    s_old = np.dot(p - cn, away) - Lo / 2
    end, front = None, []
    for w in walls:
        a, b = w[0:2], w[2:4]; tt = (b - a) / max(np.linalg.norm(b - a), 1e-9)
        if abs(abs(np.dot(tt, t)) - 1) < 1e-3 and abs(np.dot(p - a, w[4:6])) < 0.15:
            s0, s1 = sorted([np.dot(a - cn, away), np.dot(b - cn, away)])
            if s0 - 0.1 <= np.dot(p - cn, away) <= s1 + 0.1: end = s1
    # a neighbour's front standing forward of the plate's own wall (3 cm to 1.5 m) hides what lies behind it (measured at the
    # plate; two houses' walls in one plane lie up to 2 cm apart in the meta, and the plate is on the front one)
    own = pl["wall_off"]
    for w in walls:
        a, b, wo = w[0:2], w[2:4], w[4:6]
        if np.dot(wo, o) > 0.99 and 0.03 < np.dot(a + (b - a) * np.clip(np.dot(p - a, b - a) / max(np.dot(b - a, b - a), 1e-9), 0, 1) - p, o) - own < 1.5:
            sa_, sb_ = sorted([np.dot(a - cn, away), np.dot(b - cn, away)])
            if sb_ - sa_ > 0.05 and not (sa_ < s_old + Lo - 0.04 and sb_ > s_old + 0.04): front.append((sa_, sb_))  # (one over the old plate already: not a front)
    pipes = [np.dot(q - cn, away) for q in PIPES if abs(np.dot(q - p, o)) < 0.35]
    pipes = [sq for sq in pipes if not (s_old + 0.04 < sq < s_old + Lo - 0.04)]
    near = []
    for s_ in others:
        q = np.array([s_["at"][0], s_["at"][2]])
        if abs(np.dot(q - p, o)) > 1.2 or abs(s_["at"][1] - pl["at"][1]) >= (0.45 if s_["kind"] != "hanging" else 0.4): continue
        half = s_["size"][0] / 2 if "size" in s_ else 0.15; sa = np.dot(q - cn, away); near.append((sa - half, sa + half))
    def clear(lo, hi):
        if end is not None and hi > max(end - 0.1, s_old + Lo + 0.005): return False  # (short of the wall's end, or no further than the old plate)
        if any(lo - 0.06 < sq < hi + 0.06 for sq in pipes): return False
        if any(a_ < hi and b_ > lo for a_, b_ in near): return False
        return not any(a_ < hi + 0.03 and b_ > lo - 0.03 for a_, b_ in front)
    for shift in np.arange(0.0, 1.21, 0.05):
        if clear(s_old + shift, s_old + shift + Ln): return float(shift), Ln
    # no room for the whole plate: a sign-writer's condensed letters, the plate down to 80 % of its length, in place
    for k in np.arange(0.97, 0.79, -0.03):
        if clear(s_old, s_old + Ln * k): return 0.0, Ln * k
    return None
def fits(pl, name): return place(pl, name) is not None

# ------------------------------------------------------------------ names
def open_width(q):
    r, c = int(round((q[0] - x0) / res)), int(round((q[1] - z0) / res))
    return float(dist[r, c]) if 0 <= r < dist.shape[0] and 0 <= c < dist.shape[1] else 0.0
for pl in plates:
    pl["name"] = None
    q = pl["p"] + pl["o"] * 6
    for nm, (x, z, r) in SQUARE.items():
        if math.hypot(q[0] - x, q[1] - z) < r and open_width(q) > 4.5: pl["name"] = nm; pl["why"] = "square"; break
on_street = collections.defaultdict(list)
for i, pl in enumerate(plates):
    if pl["name"] is None: on_street[pl["street"]].append(i)
taken = {}
for (x, z), nm in KEEP.items():
    pl = min(plates, key=lambda q: math.hypot(q["p"][0] - x, q["p"][1] - z))
    if pl["name"] is None: taken[pl["street"]] = nm
length = {s["id"]: s["length"] for s in streets}
for nm, (x, z) in ANCHOR_PT.items():
    sid = min(on_street, key=lambda s_: float(np.min(np.hypot(streets[s_]["pts"][:, 0] - x, streets[s_]["pts"][:, 1] - z))))
    taken.setdefault(sid, nm)
pool = [n for n in OLD[:20] + MORE if n not in taken.values() and n not in SQUARE]
order = sorted((s for s in on_street if s not in taken), key=lambda s: (-len(on_street[s]), -length[s]))
if len(order) > len(pool): raise SystemExit(f"{len(order)} streets with plates, {len(pool)} names")
taken.update(zip(order, pool))
fixed = {min(plates, key=lambda q: math.hypot(q["p"][0] - x, q["p"][1] - z))["street"] for (x, z) in KEEP} | {s for s, n in taken.items() if n in ANCHOR_PT}
for _ in range(20):
    bad = [s for s, nm in taken.items() if any(not fits(plates[i], nm) for i in on_street.get(s, []))]
    if not bad: break
    for s in bad:
        for other in sorted(taken, key=lambda k: len(taken[k])):
            if other == s or other in fixed: continue
            a, b = taken[s], taken[other]
            if all(fits(plates[i], b) for i in on_street.get(s, [])) and all(fits(plates[i], a) for i in on_street.get(other, [])):
                taken[s], taken[other] = b, a; break
unfit = [nm for s, nm in taken.items() if any(not fits(plates[i], nm) for i in on_street.get(s, []))]
if unfit: raise SystemExit(f"plates that do not fit: {unfit}")
for s, idx in on_street.items():
    for i in idx: plates[i]["name"] = taken[s]; plates[i]["why"] = "street"
for pl in plates:  # (the plate's new middle: its corner end kept, slid on where it must be)
    got = place(pl, pl["name"])
    if got is None and pl["why"] == "square": got = (0.0, L_of(pl["name"]))  # (a square's plate is as the bake placed it)
    if got is None: raise SystemExit(f"no room for the plate {pl['name']} at {pl['at']}")
    shift, Ln = got
    if shift is None: raise SystemExit(f"no room for the plate {pl['name']} at {pl['at']}")
    cn = min(CORNERS, key=lambda c: np.linalg.norm(c - pl["p"])); away = pl["t"] if np.dot(pl["p"] - cn, pl["t"]) > 0 else -pl["t"]
    mid = pl["p"] + away * (shift + (Ln - L_of(pl["old"])) / 2)
    pl["mid"] = [round(float(mid[0]), 3), pl["at"][1], round(float(mid[1]), 3)]; pl["length"] = round(float(Ln), 3)
used = collections.Counter(pl["name"] for pl in plates)
names = OLD + [n for n in MORE if n not in OLD and n in used]
OUT.write_text(json.dumps({
    "issue": 193, "about": "The town's named streets (centre lines from the walk map) and the name on each street name plate (scripts/town_streets.py).",
    "names": names,
    "plates": [{"at": pl["at"], "old": pl["old"], "name": pl["name"], "nameIndex": names.index(pl["name"]), "on": pl["why"],
                "middle": pl["mid"], "length": pl["length"]} for pl in plates],
    "streets": [{"name": nm, "length": length[s], "line": [[round(float(a), 1), round(float(b), 1)] for a, b in streets[s]["pts"][::6]]}
                for s, nm in sorted(taken.items(), key=lambda kv: kv[1])]}, separators=(",", ":")))
print(len(taken), "streets named,", len(used), "names on", len(plates), "plates; the most:", used.most_common(5))
img = Image.new("RGB", (1640, 1120), "white"); dr = ImageDraw.Draw(img)
X = lambda q: ((q[0] - x0) / res, (q[1] - z0) / res)
rng = np.random.default_rng(3)
for s, nm in taken.items():
    col = tuple(int(c) for c in rng.integers(20, 200, 3)); P_ = streets[s]["pts"]
    for q in P_[::2]: dr.point(X(q), fill=col)
    dr.text(X(P_[len(P_) // 2]), nm, fill=col)
for pl in plates:
    q = X(pl["p"]); dr.ellipse([q[0] - 2, q[1] - 2, q[0] + 2, q[1] + 2], fill=(0, 0, 0))
img.save(WORK / "streets-map.png")
