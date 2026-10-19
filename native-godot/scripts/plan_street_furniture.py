"""Issues #149 #160 #164: where the new street furniture stands, from the old pieces found in the bake and the real town
measured round them. Usage:
    python scripts/plan_street_furniture.py <work folder> <laundry.json> <out folder> [<survey2.json>]
The work folder holds the audits of the street-life and clutter roots (audit-facades.gd ... all streetlife / clutter), the
prototypes' rows (dump-scene.gd of assets/game-models/streetlife.scn and clutter.scn), the copies found in the chunks
(extract.py, find_protos.py), the lines (lines.py), the court pumps' transforms (churches root) and survey1/survey.json
(NativeStreetFurnitureSurvey: the walls and the ground round every piece, the old pieces themselves passed through).
Writes street-furniture.json (the game's plan, world/town/furniture/), report.json and rays2.json (the check survey:
every new footprint's ground and anything standing on it, nothing passed through).

- Pumps (#160): every old pump, the street-life ones (cast-iron and blue-stone pillar pumps) and the courts' pumps (churches
  root), becomes the street-props kit's cast-iron pump with its stone basin, at the old pump's place and facing; moved out
  from the wall only where its footprint would stand on a kerb. Each street-life trough becomes the new blue-stone trough.
- Hatches (#149): each old hatch (centred on its window bay, but laid on the plan's wall line, in the gutter and under the
  pavement) is set against its house: the frame's back at the front's face (the plinth where there is one), its top 3 mm
  over the paving (the pavement's top, or the street's where the house stands on the street).
- Lines (#164): each old line's ends are moved onto the wall faces it was tied to (a ring at each), the line sags as before,
  and its pieces keep their kind, colour and order along it; the new pieces are wider, so they are spaced again from the
  old middles (at least 6 cm apart), and any piece that would hang below the clearance there is changed for a shorter kind
  of the same wash (or left off when none fits).
"""
import json, math, pathlib, sys, collections
import numpy as np

W = pathlib.Path(sys.argv[1]); FACTS = json.loads(pathlib.Path(sys.argv[2]).read_text()); OUT = pathlib.Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
S2 = {r["id"]: r for r in json.loads(pathlib.Path(sys.argv[4]).read_text())["results"]} if len(sys.argv) > 4 else None
S = {r["id"]: r for r in json.load(open(W / "survey1/survey.json"))["results"]}
items = {i["id"]: i for i in json.load(open(W / "items.json"))}
report = collections.defaultdict(list)

def hit(id, s=S):
    r = s.get(id); return r["hit"] if r and r["hit"] else None
def yaw_of(o): return float(math.atan2(o[0], o[1]))  # the model's +Z (out of the wall) along o (x, z)
def r3(v): return [round(float(x), 4) for x in v]

# ------------------------------------------------------------------ pumps and troughs
KIT_PUMP = {"x": (-0.33, 0.33), "z": (-0.33, 0.78)}
pumps, troughs = [], []
def ground_under(id, offs, span):
    """The ground samples of an old piece's down rays (old pieces passed): (d, a, y)."""
    out = []
    for a in offs:
        for d in np.arange(-0.3, 1.81, 0.05):
            h = hit(f"{id}/down/{a}/{d:.2f}")
            if h: out.append((round(float(d), 2), a, h["at"][1]))
    return out
for id, it in items.items():
    if it["kind"] not in ("pump", "trough"): continue
    p = np.array([it["pos"][0], it["pos"][2]]); o = np.array(it["out"]); t = np.array(it["along"])
    if it["kind"] == "pump":
        g = ground_under(id, (-0.35, 0.0, 0.35), None)
        z0, z1 = KIT_PUMP["z"]
    else:
        g = ground_under(id, (-1.2, -0.6, 0.0, 0.6, 1.2), None)
        z0, z1 = -0.37, 0.37
    base = float(np.median([y for d, a, y in g if 0 <= d <= 0.6]))
    shift = 0.0
    for d, a, y in sorted(g):
        if z0 + shift <= d <= z1 + shift and y > base + 0.04: shift = max(shift, d - z0 + 0.03)
    if shift > 0.6: report["pumpTooClose"].append(id)
    at = p + o * shift
    ys = [y for d, a, y in g if z0 + shift <= d <= z1 + shift]
    rec = {"id": f"street-{it['kind']}-{len(pumps) if it['kind'] == 'pump' else len(troughs)}", "old": it["proto"], "at": r3([at[0], float(np.max(ys)) if ys else base, at[1]]),
           "yaw": round(yaw_of(o), 5), "movedOut": round(shift, 3), "ground": [round(min(ys), 3), round(max(ys), 3)] if ys else None, "chunk": it["node"]}
    (pumps if it["kind"] == "pump" else troughs).append(rec)
for id, it in items.items():
    if it["kind"] != "court": continue
    o = np.array(it["out"]); p = np.array([it["pos"][0], it["pos"][2]])
    ys = []
    for a in (-0.4, 0.0, 0.4):
        for d in np.arange(-0.5, 1.01, 0.1):
            if -0.33 <= d <= 0.78:
                h = hit(f"{id}/down/{a}/{d:.2f}")
                if h: ys.append(h["at"][1])
    walls = [h for ang in range(0, 360, 45) if (h := hit(f"{id}/round/{ang}"))]
    near = min((math.dist([h["at"][0], h["at"][2]], p) for h in walls), default=9)
    pumps.append({"id": "court-pump-" + it["node"][4:] if it["node"] != "pump" else "court-pump-1", "old": "court pump " + it["node"], "sourceIndex": it["index"],
                  "at": r3([p[0], float(np.max(ys)) if ys else 0.0, p[1]]), "yaw": round(yaw_of(o), 5), "movedOut": 0.0,
                  "ground": [round(min(ys), 3), round(max(ys), 3)] if ys else None, "nearestWall": round(near, 2)})

# ------------------------------------------------------------------ hatches
HATCH_D, HATCH_HW = 0.44, 0.55
fit = {}
DS = [round(float(d), 2) for d in np.arange(-0.3, 1.81, 0.05)]
def profile(id, a):
    return [(d, (hit(f"{id}/down/{a}/{d:.2f}") or {"at": [0, None, 0]})["at"][1]) for d in DS]
hatches = []
for id, it in items.items():
    if it["kind"] != "hatch": continue
    p = np.array([it["pos"][0], it["pos"][2]]); o = np.array(it["out"]); t = np.array(it["along"])
    fronts, tops, kerbs, street = [], [], [], []
    for a in (-0.35, 0.0, 0.35):
        P = profile(id, a)
        front = None; top = None; start = None; kerb = None
        for d, y in P:
            if y is None: continue
            if y > 0.25: front = d; top = start = kerb = None; continue
            if front is None and d < -0.05:
                continue
            if y > 0.07:
                if top is None: top, start = y, d
            elif top is not None and kerb is None: kerb = d
            if front is not None and top is None and y <= 0.07 and kerb is None and start is None:
                street.append(y)
        fronts.append(front if front is not None else -0.05)
        if top is not None: tops.append(top); kerbs.append(kerb if kerb is not None else 9)
    # the front's face where the frame's back meets it: the wall rays 0.35 and 0.9 m up (the plinth, else the wall), over
    # the hatch's middle; a side's face counts too when it stands at most 15 cm further out (a jamb, not a doorstep)
    def face(a):
        ds = []
        for hh in (0.35, 0.9):
            h = hit(f"{id}/wall/{a}/{hh}")
            if h:
                d = float((np.array([h["at"][0], h["at"][2]]) - p - t * a) @ o)
                # (the house's face is near the plan's wall line, where the old hatch lay; a hit far out is a cart or a stall)
                if -0.4 <= d <= 0.5: ds.append(d)
        return max(ds) if ds else None
    mid = face(0.0)
    if mid is None:
        # (no wall ray: the ground rays' last high sample before the paving, near the plan's wall line; one far out is the
        # house across a narrow lane)
        near = [f for f in fronts if f <= 0.45]
        mid = (max(near) if near else -0.05) + 0.05; report["hatchFaceFromGround"].append(id)
    sides = [f for f in (face(-0.6), face(0.6)) if f is not None and mid < f <= mid + 0.15]
    front = max([mid] + sides)
    back = front + 0.008
    if tops:
        y = float(np.median(tops)); kerb = min(kerbs)
        room = kerb - back
        kind = "pavement"
    else:
        # (on the setts: the frame meets the stones' tops; their relief stands about 2 cm over the street's plane)
        y = 0.02; kerb = None; room = 9; kind = "street"
    if room < HATCH_D + 0.02:
        report["hatchNarrowPavement"].append({"id": id, "room": round(room, 2)})
    at = p + o * back
    hid = "cellar-hatch-" + id[5:]
    if S2 is not None:
        low = [r for k, r in S2.items() if k.startswith(hid + "/") and r["hit"] and (r["hit"]["at"][1] - y < -0.05 or ("city/" in r["hit"]["name"] and 0.06 < r["hit"]["at"][1] - y < 0.3))]
        if low:
            report["hatchLeftOut"].append({"id": hid, "why": "its footprint runs off the pavement or onto a step"}); continue
    hatches.append({"id": hid, "at": r3([at[0], y, at[1]]), "yaw": round(yaw_of(o), 5), "on": kind,
                    "front": round(front, 2), "kerbRoom": round(room, 2) if kind == "pavement" else None, "chunk": it["node"]})

# ------------------------------------------------------------------ washing lines
lines = json.load(open(W / "lines.json"))
garments = []
for pack in ("streetlife", "clutter"):
    for f in json.load(open(W / f"found-{pack}.json")):
        if f["proto"].startswith("cloth_"): garments.append({"pack": pack, "proto": f["proto"], "pos": f["pos"], "L": f["L"]})
# (partial copies the exact search missed: the robust search's, when not already in)
for name in ("ex-sl-cloth.json", "ex-cl.json"):
    for f in json.load(open(W / name)):
        if not f["proto"].startswith("cloth_"): continue
        if any(g["proto"] == f["proto"] and math.dist(g["pos"], f["pos"]) < 0.02 for g in garments): continue
        garments.append({"pack": "streetlife" if name.startswith("ex-sl") else "clutter", "proto": f["proto"], "pos": f["pos"], "L": f["L"]})
KIND = {"shirt": "shirt", "shift": "shift", "trousers": "trousers", "apron": "apron", "stockings": "stockings", "sheet": "sheet", "towel": "towel"}
# the wash of a working Antwerp street, 1873: undyed and bleached linen, indigo work cotton, brown and grey wool (linear tints)
PALETTE = {
    "shirt": [(0.80, 0.76, 0.66), (0.90, 0.89, 0.85), (0.30, 0.40, 0.58)],
    "shift": [(0.90, 0.89, 0.85), (0.80, 0.76, 0.66)],
    "trousers": [(0.40, 0.29, 0.20), (0.24, 0.31, 0.46), (0.44, 0.43, 0.40)],
    "apron": [(0.27, 0.36, 0.55), (1.0, 1.0, 1.0)],  # the second: blue-striped ticking
    "stockings": [(0.36, 0.36, 0.34), (0.16, 0.15, 0.15)],
    "sheet": [(0.92, 0.91, 0.87), (1.0, 1.0, 1.0)],  # the second: a ticking tick (a straw mattress's cover)
    "towel": [(1.0, 1.0, 1.0), (0.93, 0.91, 0.86)],
}
TICKING = {("apron", 1), ("sheet", 1)}
SHORTER = ["trousers", "shift", "sheet", "shirt", "apron", "stockings", "towel"]
BUS = [np.array(r, float) for r in [
    [(-305, 29.5), (-305, 8.3), (-158, 8.3), (-152, 7.6), (-140, 7.6), (-134, 8.3), (-90, 8.3), (-84, 7.8), (-68, 7.8), (-62, 8.3), (66, 8.3), (76, 15), (76, 37), (-54, 37), (-58, 33), (-58, 12), (-62, 8.3), (-134, 8.3), (-140, 7.6), (-152, 7.6), (-158, 8.3), (-204, 8.3), (-204, 29.5)],
    [(-84.5, 20), (-96, 20), (-96, 38), (-88.8, 45), (-88.8, 114), (-149, 114), (-149, 126.2), (-238, 126.2), (-238, 70), (-280, 70), (-280, 132), (-307.8, 132), (-307.8, 150.5), (-356.5, 149.8), (-361, 214), (-358, 249), (-304.5, 245.5), (-304.5, 139), (-275, 139), (-265, 129.8), (-145, 129.8), (-145, 208.5), (-84.5, 208.5)],
    [(-148, 159), (-145, 175), (-145, 344.5), (-102, 344.5), (-98, 347), (-60, 349), (19, 344), (63, 342.5), (60, 290), (40, 245.5), (-19.5, 197), (-60, 168), (-68.5, 152), (-84, 154), (-89.5, 146.5), (-98, 147), (-118, 155), (-129, 156.5), (-136, 159)]]]
def seg_dist(p, a, b):
    ab = b - a; t = np.clip(np.dot(p - a, ab) / max(1e-9, ab @ ab), 0, 1); return float(np.linalg.norm(p - a - ab * t))
def near_bus(a, b):
    best = 9e9
    for route in BUS:
        for i in range(len(route) - 1):
            for f in np.linspace(0, 1, 9):
                q = a + (b - a) * f
                best = min(best, seg_dist(q, route[i], route[i + 1]))
    return best
ATTACH = np.array(FACTS["models"]["line_ring"]["attach"])  # (game axes: x along the wall, y up, z out of the wall)
plan_lines = []
used = set()
for li, l in enumerate(lines):
    id = f"line{li}"; a = np.array(l["a"]); b = np.array(l["b"]); d2 = (b - a)[[0, 2]]; L = float(np.linalg.norm(d2)); u = d2 / L
    ends = []
    for end, p, s in (("a", a, -1), ("b", b, 1)):
        hs = [h for dh in (-0.25, 0.0, 0.25) for off in (-0.3, 0.0, 0.3) if (h := hit(f"{id}/{end}/{dh}/{off}"))]
        if not hs:
            report["lineNoWall"].append(f"{id}/{end}"); ends.append(None); continue
        # the face: the hits' median distance along the line from the old end; its normal (horizontal) the ring's out
        ds = [float((np.array([h["at"][0], h["at"][2]]) - p[[0, 2]]) @ (u * s)) for h in hs]
        k = int(np.argsort(ds)[len(ds) // 2]); h = hs[k]
        n = np.array([h["normal"][0], h["normal"][2]]); n = n / (np.linalg.norm(n) or 1)
        if n @ (u * s) > 0: n = -n
        wall = p[[0, 2]] + u * s * ds[k]
        ends.append({"wall": wall, "normal": n, "y": float(p[1]), "moved": ds[k], "name": h["name"]})
    if None in ends:
        report["lineTiedToRazedHouse"].append(id); continue
    # (#164) a line over the omnibus's street hangs one storey higher where both houses go up that far (the check survey)
    lift = 0.0
    if S2 is not None and all((hit(f"line-{l['pack']}-{li}/up/{e}/{dh}", S2) is not None) for e in "ab" for dh in ("3.0", "3.7")):
        lift = 3.0
    for e in ends:
        e["y"] += lift
    rings = []
    for e in ends:
        n = e["normal"]; yaw = yaw_of(n)
        # the ring's attach point in the world: rotate (x along the wall, z out) by the wall's facing
        c, s_ = math.cos(yaw), math.sin(yaw)
        ax = np.array([ATTACH[0] * c + ATTACH[2] * s_, -ATTACH[0] * s_ + ATTACH[2] * c])
        at = e["wall"] + ax
        rings.append({"at": r3([e["wall"][0], e["y"] - ATTACH[1], e["wall"][1]]), "yaw": round(yaw, 5), "attach": r3([at[0], e["y"], at[1]])})
    A = np.array(rings[0]["attach"]); B = np.array(rings[1]["attach"]); span = float(np.linalg.norm((B - A)[[0, 2]]))
    sag = (0.15 + 0.035 * span) if l["pack"] == "streetlife" else (0.12 + 0.04 * span)
    def y_at(t): return A[1] + (B[1] - A[1]) * t - sag * 4 * t * (1 - t)
    bus = near_bus(A[[0, 2]], B[[0, 2]])
    if lift: report["lineRaisedOverOmnibus"].append(id)
    clear = 3.7 if bus < 2.5 else (2.6 if l["pack"] == "streetlife" else 2.15)
    # this line's old pieces: on the old line (within 25 cm of it in plan, and between its ends)
    pieces = []
    for gi, g in enumerate(garments):
        if gi in used: continue
        q = np.array(g["pos"]); tq = float((q[[0, 2]] - a[[0, 2]]) @ u) / L
        if not (-0.05 <= tq <= 1.05): continue
        if seg_dist(q[[0, 2]], a[[0, 2]], b[[0, 2]]) > 0.25 or abs(q[1] - (a[1] + (b[1] - a[1]) * tq)) > 0.6: continue
        used.add(gi)
        base, var = g["proto"][6:].rsplit("_", 1)
        Lg = np.array(g["L"]); xg = Lg @ [1, 0, 0]; facing = 1 if (np.array([xg[0], xg[2]]) @ u) >= 0 else -1
        zg = Lg @ [0, 0, 1]
        pieces.append({"kind": KIND[base], "var": int(var), "t": tq, "flip": facing < 0, "front": 1 if (np.cross([u[0], 0, u[1]], [zg[0], 0, zg[2]])[1] > 0) else 0})
    pieces.sort(key=lambda q: q["t"])
    # new widths; the clearance: change a piece too long for it for a shorter kind, or leave it off
    placed = []
    for q in pieces:
        kind = q["kind"]
        def bottom(k, t): return y_at(t) - FACTS["pieces"][k]["drop"]
        if bottom(kind, q["t"]) < clear:
            alt = next((k for k in sorted(FACTS["pieces"], key=lambda k: -FACTS["pieces"][k]["drop"]) if bottom(k, q["t"]) >= clear), None)
            report["pieceShortened" if alt else "pieceLeftOff"].append({"line": id, "kind": kind, "to": alt, "clear": clear})
            if not alt: continue
            q = dict(q, kind=alt, var=min(q["var"], len(PALETTE[alt]) - 1))
        placed.append(q)
    # space them again along the line from their old middles, 6 cm apart, 30 cm clear of each ring
    m0, m1 = 0.30, span - 0.30
    xs = [q["t"] * span for q in placed]; ws = [FACTS["pieces"][q["kind"]]["line_width"] for q in placed]
    for i in range(len(xs)):
        lo = (xs[i - 1] + ws[i - 1] / 2 + 0.06 + ws[i] / 2) if i else m0 + ws[i] / 2
        xs[i] = max(xs[i], lo)
    for i in range(len(xs) - 1, -1, -1):
        hi = (xs[i + 1] - ws[i + 1] / 2 - 0.06 - ws[i] / 2) if i < len(xs) - 1 else m1 - ws[i] / 2
        xs[i] = min(xs[i], hi)
    keep = [i for i in range(len(xs)) if xs[i] - ws[i] / 2 >= m0 - 1e-6 and (i == 0 or xs[i] - ws[i] / 2 >= xs[i - 1] + ws[i - 1] / 2 + 0.059)]
    dropped = len(xs) - len(keep)
    if dropped: report["pieceNoRoom"].append({"line": id, "dropped": dropped})
    out = []
    for i in keep:
        q = placed[i]; t = xs[i] / span
        col = PALETTE[q["kind"]][min(q["var"], len(PALETTE[q["kind"]]) - 1)]
        out.append({"kind": q["kind"], "cloth": "ticking" if (q["kind"], q["var"]) in TICKING else None, "t": round(t, 4), "flip": q["flip"],
                    "tint": r3(col), "bottom": round(y_at(t) - FACTS["pieces"][q["kind"]]["drop"], 2)})
    plan_lines.append({"id": f"line-{l['pack']}-{li}", "pack": l["pack"], "rings": rings, "sag": round(sag, 3), "span": round(span, 3), "clear": clear,
                       "busRoute": round(bus, 1), "pieces": out, "wallMoved": [round(e["moved"], 2) for e in ends]})
# ------------------------------------------------------------------ wash poles out of windows (streetlife washpole_0..2)
POLE_KINDS = [["shirt", "towel", "stockings"], ["trousers", "shirt"], ["shift", "apron", "towel"]]
poles = []
seen = []
for name in ("found-streetlife.json", "ex-sl-cloth.json"):
    for f in json.load(open(W / name)):
        if not f["proto"].startswith("washpole_") or any(math.dist(f["pos"], q) < 0.05 for q in seen): continue
        seen.append(f["pos"])
        k = int(f["proto"][-1]); Lm = np.array(f["L"]); o = np.array(f["pos"])
        foot = o + Lm @ np.array([0, 0, -0.05]); tip = o + Lm @ np.array([0, 0.288, 1.70])
        d = tip - foot; length = float(np.linalg.norm(d)); u = d / length
        avail0, avail1 = 0.12 * length, 0.97 * length
        x = avail0; out = []
        for i, kind in enumerate(POLE_KINDS[k]):
            w = FACTS["pieces"][kind]["line_width"]
            if x + w > avail1: report["polePieceNoRoom"].append(f"{f['proto']} {kind}"); continue
            c = x + w / 2; at = foot + u * c - np.array([0, 0.024, 0])
            bottom = float(at[1] - FACTS["pieces"][kind]["drop"])
            if bottom < 2.3: report["polePieceTooLow"].append(kind); continue
            col = PALETTE[kind][(i + k) % len(PALETTE[kind])]
            out.append({"kind": kind, "cloth": None, "at": r3(at), "tint": r3(col), "bottom": round(bottom, 2)})
            x += w + 0.04
        poles.append({"id": f"wash-pole-{len(poles)}", "at": r3(o), "basis": [r3(Lm[:, 0]), r3(Lm[:, 1]), r3(Lm[:, 2])], "dir": r3(u), "pieces": out, "chunk": f["node"]})
report["garmentsFound"] = len(garments); report["garmentsOnLines"] = len(used); report["garmentsOff"] = [g["proto"] + " " + str(r3(g["pos"])) for gi, g in enumerate(garments) if gi not in used]
plan = {"note": "Issues #149 #160 #164: the new street furniture (scripts/plan_street_furniture.py); NativeStreetFurniture.cs places it.",
        "pumps": pumps, "troughs": troughs, "hatches": hatches, "lines": plan_lines, "poles": poles}
(OUT / "street-furniture.json").write_text(json.dumps(plan, indent=1))
rep = {k: (v if not isinstance(v, list) or len(v) < 40 else {"count": len(v), "first": v[:40]}) for k, v in report.items()}
rep["counts"] = {"pumps": len(pumps), "troughs": len(troughs), "hatches": len(hatches), "lines": len(plan_lines), "pieces": sum(len(l["pieces"]) for l in plan_lines), "poles": len(poles), "polePieces": sum(len(q["pieces"]) for q in poles)}
(OUT / "report.json").write_text(json.dumps(rep, indent=1))
print(json.dumps(rep["counts"]), {k: (len(v) if isinstance(v, list) else v) for k, v in report.items() if k != "garmentsOff"})

# ------------------------------------------------------------------ the check survey: each new footprint, nothing passed
rays = []
def fp(id, at, yaw, xs, zs, top=2.5):
    c, s = math.cos(yaw), math.sin(yaw)
    for x in xs:
        for z in zs:
            px = at[0] + x * c + z * s; pz = at[2] - x * s + z * c
            rays.append({"id": f"{id}/{x:.2f}/{z:.2f}", "from": [px, at[1] + top, pz], "to": [px, at[1] - 0.6, pz], "skip": []})
for p in pumps: fp(p["id"], p["at"], p["yaw"], np.linspace(-0.3, 0.3, 4), np.linspace(-0.3, 0.75, 6))
for p in troughs: fp(p["id"], p["at"], p["yaw"], np.linspace(-0.98, 0.98, 6), np.linspace(-0.34, 0.34, 4))
for h in hatches: fp(h["id"], h["at"], h["yaw"], np.linspace(-0.52, 0.52, 5), np.linspace(0.03, 0.41, 4))
(OUT / "rays2.json").write_text(json.dumps(rays))
print(len(rays), "check rays")
