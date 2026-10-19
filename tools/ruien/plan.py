"""Ruien plan (2D): Steve's drawn network, worked out, over the town map.

python -I tools/ruien/plan.py <repo root>

Input: docs/plans/ruien/ruien-network.json (sizes, levels, names, the drawn picture) and ruien-traced.json (the lines,
rooms and gates read from Steve's picture by tools/ruien/trace.py).
Adds: the side drains (every street gully, native-godot/world/town/drainage/ruien-inlets.json, flows along the streets
to the nearest rui), names, levels, ladders under grates, stairs and lamps.
Writes docs/plans/ruien/ruien-routes.json, ruien-plan.png, ruien-sections.svg and ruien-plan.html.
World: +x north, +z east, metres. Pictures: north up, east right."""
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, sparse
from scipy.sparse.csgraph import dijkstra

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
J = lambda *p: os.path.join(ROOT, *p)
OUT = J("docs/plans/ruien")
city = json.load(open(J("native-godot/world/data/shared/city.json")))
net = json.load(open(os.path.join(OUT, "ruien-network.json")))
drawn = json.load(open(os.path.join(OUT, net["drawn"]["traced"])))
inlets = json.load(open(J("native-godot/world/town/drainage/ruien-inlets.json")))
K, lv, sp = net["classes"], net["levels"], net["spacing"]
crown = lv["street"] - lv["crownBelowStreet"]

# ---- streets on a 1 m grid from the walk mask: row = x - x0, col = z - z0 ----
wk = city["walk"]; XW, ZW = wk["x0"], wk["z0"]
a = np.array(Image.open(J("native-godot/world/data/public/city/walk.png")))[::2, ::2]
free = (a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 0)
clear = ndimage.distance_transform_edt(free)  # half the street width, metres
lab, _ = ndimage.label(free, structure=np.ones((3, 3)))
free = lab == np.bincount(lab.ravel())[1:].argmax() + 1  # the street network; closed yards are left out
R, C = free.shape
cell = lambda x, z: (int(round(x - XW)), int(round(z - ZW)))
world = lambda r, c: (float(r + XW), float(c + ZW))
on_street = lambda x, z: 0 <= cell(x, z)[0] < R and 0 <= cell(x, z)[1] < C and free[cell(x, z)] and clear[cell(x, z)] >= 1.5

plen = lambda poly: sum(math.dist(p, q) for p, q in zip(poly, poly[1:]))
rnd = lambda poly: [[round(x, 1), round(z, 1)] for x, z in poly]
def gap(p, pts):
    p = np.asarray(p, float); best = 1e9
    for a_, b_ in zip(pts, pts[1:]):
        a_, b_ = np.asarray(a_, float), np.asarray(b_, float); ab = b_ - a_
        t = np.clip(np.dot(p - a_, ab) / max(np.dot(ab, ab), 1e-9), 0, 1); best = min(best, float(np.hypot(*(p - a_ - t * ab))))
    return best
def samples(pts, step=1.0):
    out = []
    for p, q in zip(pts, pts[1:]):
        L = math.dist(p, q)
        for t in np.arange(0, L, step): out.append((p[0] + (q[0] - p[0]) * t / L, p[1] + (q[1] - p[1]) * t / L))
    return out + [tuple(pts[-1])]
places = city["places"]
near_place = lambda p: min(places, key=lambda n: math.dist(p, (places[n]["x"], places[n]["z"])))

# ---- lines, rooms and gates from the drawing ----
routes = {}
for i, l in enumerate(drawn["lines"]):
    pts = [tuple(p) for p in l["pts"]]
    if plen(pts) < 2: continue
    w = np.array([2 * clear[cell(*p)] if 0 <= cell(*p)[0] < R and 0 <= cell(*p)[1] < C else 0 for p in samples(pts)])
    outer = K[l["class"]]["innerWidth"] + 2 * K[l["class"]]["wall"]
    routes[f"L{i + 1}"] = {"class": l["class"], "pts": rnd(pts), "lengthM": round(plen(pts)), "underHousesShare": round(float((w < outer).mean()), 2)}
for rid, r in routes.items():  # a name sticks to the lines nearest its point; the rest are named after the nearest place
    best = min(net["ruiNames"], key=lambda nm: gap(nm["near"], r["pts"]))
    r["name"] = best["name"] if gap(best["near"], r["pts"]) < 45 else f"rui by {near_place(r['pts'][len(r['pts']) // 2])}"
rooms, gates = [], []
for ch in drawn["chambers"]:
    if ch["gate"]:
        g = min(net["gates"], key=lambda g: math.dist(g["near"], ch["centre"]))
        gid, name, into = (g["id"], g["name"], g["into"]) if math.dist(g["near"], ch["centre"]) < 14 else (f"O{len(gates) + 20}", "Gate", "the water")
        gates.append({"id": gid, "name": name, "at": ch["centre"], "into": into, "class": ch["class"], "door": bool(g.get("door")) and gid == g["id"]})
    else:
        named = [rm for rm in net["rooms"] if math.dist(rm["near"], ch["centre"]) < 12]
        rid = named[0]["id"] if named else f"R{sum(r_['id'].startswith('R') for r_ in rooms) + 1}"
        name = named[0]["name"] if named else ("Hall" if ch["class"] == "G" else "Junction room") + f" {rid[1:]} by {near_place(ch['centre'])}"
        rooms.append({"id": rid, "name": name, "class": ch["class"], "centre": ch["centre"], "rect": ch["rect"]})
gates += [{"id": g["id"], "name": g["name"], "at": g["near"], "into": g["into"], "class": "M", "flush": True}
          for g in net["gates"] if g["id"] == "F1"]

# ---- side drains: each gully flows along the streets to the nearest rui ----
idx = np.arange(R * C).reshape(R, C); rows, cols, wts = [], [], []
cost = 1 + 4 / np.maximum(clear, 0.7) ** 2  # keeps to the middle of a street
for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
    a0 = free[max(0, -dr):R - max(0, dr), max(0, -dc):C - max(0, dc)]
    r0, c0 = np.nonzero(a0); r0 += max(0, -dr); c0 += max(0, -dc); r1, c1 = r0 + dr, c0 + dc; ok = free[r1, c1]
    r0, c0, r1, c1 = r0[ok], c0[ok], r1[ok], c1[ok]; ww = math.hypot(dr, dc) * (cost[r0, c0] + cost[r1, c1]) / 2
    rows += [idx[r0, c0], idx[r1, c1]]; cols += [idx[r1, c1], idx[r0, c0]]; wts += [ww, ww]
G = sparse.csr_matrix((np.concatenate(wts), (np.concatenate(rows), np.concatenate(cols))), shape=(R * C, R * C))
fr, fc = np.nonzero(free)
def snap(x, z):
    r, c = cell(x, z)
    if 0 <= r < R and 0 <= c < C and free[r, c]: return r, c
    k = np.argmin((fr - r) ** 2 + (fc - c) ** 2); return int(fr[k]), int(fc[k])
sinks = set()
for r in routes.values():
    for p in samples(r["pts"]):
        rc = cell(*p)
        if 0 <= rc[0] < R and 0 <= rc[1] < C and free[rc]: sinks.add(rc[0] * C + rc[1])
_, pred, _ = dijkstra(G, indices=np.array(sorted(sinks)), min_only=True, return_predecessors=True)
side, gully_to, done = [], [], set()
for it in inlets:
    r, c = snap(it["world"][0], it["world"][2]); i = r * C + c; path = [i]
    while path[-1] not in sinks and pred[path[-1]] >= 0 and path[-1] not in done: path.append(int(pred[path[-1]]))
    done.update(path); gully_to.append(world(r, c))
    if len(path) > 2: side.append(rnd([world(*divmod(j, C)) for j in path]))
def thin_out(poly, tol=0.8):
    if len(poly) < 3: return poly
    a_, b_ = np.array(poly[0]), np.array(poly[-1]); ab = b_ - a_; L = np.hypot(*ab) or 1
    d = [abs(ab[0] * (p[1] - a_[1]) - ab[1] * (p[0] - a_[0])) / L for p in poly]; k = int(np.argmax(d))
    return [poly[0], poly[-1]] if d[k] <= tol else thin_out(poly[:k + 1], tol)[:-1] + thin_out(poly[k:], tol)
side = [thin_out(s_) for s_ in side]
segs_all = [r["pts"] for r in routes.values()]
gully_gap = [min(gap((it["world"][0], it["world"][2]), pts) for pts in segs_all) for it in inlets]

# ---- ladders under grates, stairs, lamps ----
net_pts = [(rid, p) for rid, r in routes.items() for p in samples(r["pts"], 2.0)]
grates = []
for rid, r in routes.items():
    s_ = samples(r["pts"], 1.0); L = len(s_); step = sp["grateEvery"]
    for k in range(int(step / 2), L, int(step)):
        cand = [j for j in range(max(0, k - 12), min(L, k + 13)) if on_street(*s_[j])]
        if not cand: continue
        j = min(cand, key=lambda j: abs(j - k)); p = s_[j]
        if all(math.dist(p, g_) > step * 0.5 for g_ in grates): grates.append(p)
ends = {}
for r in routes.values():
    for p in (tuple(r["pts"][0]), tuple(r["pts"][-1])): ends[(round(p[0]), round(p[1]))] = ends.get((round(p[0]), round(p[1])), 0) + 1
for (x, z), n_ in ends.items():  # a grate over every junction that lies under a street
    if n_ >= 3 and on_street(x, z) and all(math.dist((x, z), g_) > 12 for g_ in grates): grates.append((float(x), float(z)))
stairs = [{"id": a_["id"], "name": a_["name"], "at": tuple(a_["at"]), "note": a_.get("note", "")} for a_ in net["access"] if a_["kind"] == "stair"]
for rm in rooms:
    stairs.append({"id": "S-" + rm["id"], "name": "Stair down into " + rm["name"][0].lower() + rm["name"][1:], "at": tuple(rm["centre"]), "note": ""})
while True:  # every point of the network within reach of a stair
    far = max(net_pts, key=lambda q: min(math.dist(q[1], s_["at"]) for s_ in stairs))
    if min(math.dist(far[1], s_["at"]) for s_ in stairs) <= sp["stairWithin"]: break
    s_ = samples(routes[far[0]]["pts"], 1.0); k = min(range(len(s_)), key=lambda j: math.dist(s_[j], far[1]))
    cand = [j for j in range(max(0, k - 25), min(len(s_), k + 26)) if on_street(*s_[j])] or [k]
    p = s_[min(cand, key=lambda j: abs(j - k))]
    stairs.append({"id": f"S{len(stairs) + 1}", "name": f"Sluice keeper's stair by {near_place(p)}", "at": p, "note": "A door in a small stair house on the street."})
lights = [g_ for g_ in grates] + [tuple(rm["centre"]) for rm in rooms] + [tuple(g["at"]) for g in gates] + [s_["at"] for s_ in stairs]
lamps = []
while True:  # dim lamps where no grate, room, gate or stair lights the way
    far = max(net_pts, key=lambda q: min(math.dist(q[1], l_) for l_ in lights + lamps))
    if min(math.dist(far[1], l_) for l_ in lights + lamps) <= sp["lightWithin"]: break
    lamps.append(far[1])
access = [a_ for a_ in net["access"] if a_["kind"] != "stair"]

json.dump({"_about": "Made by tools/ruien/plan.py. Do not edit; edit ruien-network.json or the drawing.",
           "routes": routes, "rooms": rooms, "gates": gates, "sideDrains": side,
           "grates": rnd(grates), "stairs": [{**s_, "at": rnd([s_["at"]])[0]} for s_ in stairs], "lamps": rnd(lamps), "access": access},
          open(os.path.join(OUT, "ruien-routes.json"), "w"), indent=1)

# ---- totals ----
tot = {c_: round(sum(r["lengthM"] for r in routes.values() if r["class"] == c_)) for c_ in ("G", "M")}
tot["S"] = round(sum(plen(s_) for s_ in side))
under = {c_: round(sum(r["lengthM"] * r["underHousesShare"] for r in routes.values() if r["class"] == c_)) for c_ in ("G", "M")}
by_name = {}
for r in routes.values():
    k_ = (r["name"], r["class"]); by_name[k_] = by_name.get(k_, 0) + r["lengthM"]
gg = np.array(gully_gap)

# ---- base map ----
X0, X1, Z0, Z1 = -400, 340, -80, 470; S = 2
W, H = (Z1 - Z0) * S, (X1 - X0) * S
P = lambda x, z: ((z - Z0) * S, (X1 - x) * S)
im = Image.new("RGB", (W, H), (226, 214, 186)); d = ImageDraw.Draw(im)
def poly(pts, fill):
    if len(pts) > 2: d.polygon([P(x, z) for x, z in pts], fill=fill)
def tris(t, fill):
    for i in range(0, len(t) - 5, 6): poly([(t[i], t[i + 1]), (t[i + 2], t[i + 3]), (t[i + 4], t[i + 5])], fill)
for k_, col in [("earth", (214, 200, 170)), ("grass", (196, 204, 165)), ("cobble", (240, 233, 214)), ("flags", (244, 238, 224)), ("quay", (226, 218, 200))]:
    for t in city["ground"].get(k_, []): tris(t, col)
for w in city["water"]: poly(w["outer"], (168, 190, 200))
for b in city["blocks"]: poly(b["outer"], (176, 150, 122))
for k_ in ["yards", "courts", "gardens"]:
    for q in city["alleys"].get(k_, []): poly(q, (205, 188, 156))
for q in city["alleys"]["lanes"]: poly(q, (240, 233, 214))
for q in city["alleys"]["passages"]: d.rectangle([P(q[2], q[1]), P(q[0], q[3])], fill=(240, 233, 214))
for q in city["alleys"]["gangs"]: d.line([P(x, z) for x, z in q], fill=(240, 233, 214), width=4)
for l in city["landmarks"].values(): poly(l["fp"], (140, 100, 85))
d.line([P(x, z) for x, z in city["decor"]["rampart"]["trace"]], fill=(120, 112, 100), width=12)
for q in city["quays"]: d.line([P(q[0], q[1]), P(q[2], q[3])], fill=(90, 90, 90), width=2)
for b in city["bridges"].values(): d.rectangle([P(b[2], b[1]), P(b[0], b[3])], fill=(150, 120, 90))
buf = io.BytesIO(); im.save(buf, "PNG"); base64png = base64.b64encode(buf.getvalue()).decode()

# ---- SVG layers ----
sx = lambda z: (z - Z0) * S; sy = lambda x: (X1 - x) * S
pl = lambda pts: " ".join(f"{sx(z):.1f},{sy(x):.1f}" for x, z in pts)
L = {k_: [] for k_ in ["grid", "drains", "gullies", "M", "G", "rooms", "gates", "lamps", "grates", "stairs", "access", "labels", "places"]}
for x in range(-400, 341, 50):
    L["grid"].append(f'<line x1="0" y1="{sy(x)}" x2="{W}" y2="{sy(x)}"/><text x="3" y="{sy(x) - 3}">x {x}</text>')
for z in range(-50, 471, 50):
    L["grid"].append(f'<line x1="{sx(z)}" y1="0" x2="{sx(z)}" y2="{H}"/><text x="{sx(z) + 3}" y="12">z {z}</text>')
for s_ in side: L["drains"].append(f'<polyline points="{pl(s_)}"/>')
for it, to, gg_ in zip(inlets, gully_to, gully_gap):
    x, z = it["world"][0], it["world"][2]
    L["drains"].append(f'<line x1="{sx(z):.1f}" y1="{sy(x):.1f}" x2="{sx(to[1]):.1f}" y2="{sy(to[0]):.1f}"/>')
    col = "#3a9a5a" if gg_ <= 40 else "#d08a1a" if gg_ <= 80 else "#d0201a"
    L["gullies"].append(f'<circle cx="{sx(z):.1f}" cy="{sy(x):.1f}" r="1.6" fill="{col}"><title>{it["id"]}: {gg_:.0f} m to a rui</title></circle>')
for rid, r in routes.items():
    k = K[r["class"]]
    lv_txt = (f'bed {k["bed"]} m, water about 1.5 m (at most 2.4), ledges {k["bed"] + k["ledgeAboveBed"]:.1f} m' if r["class"] == "G"
              else f'bed {k["bed"]} m, water about 0.5 m, walkway {k["bed"] + k["ledgeAboveBed"]:.1f} m')
    L[r["class"]].append(f'<polyline points="{pl(r["pts"])}" stroke="{k["colour"]}" stroke-width="{k["stroke"]}"><title>{r["name"]} ({k["name"]}, {rid}): {r["lengthM"]} m, {lv_txt}</title></polyline>')
seen = set()
for rid, r in sorted(routes.items(), key=lambda kv: -kv[1]["lengthM"]):
    if r["name"] in seen or r["name"].startswith("rui by"): continue
    seen.add(r["name"]); mid = r["pts"][len(r["pts"]) // 2]
    L["labels"].append(f'<text x="{sx(mid[1]) + 6:.0f}" y="{sy(mid[0]) - 6:.0f}" fill="{K[r["class"]]["colour"]}">{r["name"]}</text>')
for rm in rooms:
    x0, z0, x1, z1 = rm["rect"]; col = K[rm["class"]]["colour"]
    L["rooms"].append(f'<rect x="{sx(z0)}" y="{sy(x1)}" width="{(z1 - z0) * S}" height="{(x1 - x0) * S}" fill="{col}" stroke="{col}"><title>{rm["id"]} {rm["name"]}: {x1 - x0:.0f} x {z1 - z0:.0f} m</title></rect>'
                      f'<text x="{sx(z1) + 4}" y="{sy(x1) + 12}" fill="{col}">{rm["id"]}</text>')
for g in gates:
    x, z = g["at"]; fill = "#6a1a7a" if g.get("flush") else "#6a6a6a" if g.get("door") else K[g["class"]]["colour"]
    L["gates"].append(f'<rect x="{sx(z) - 6}" y="{sy(x) - 6}" width="12" height="12" fill="{fill}" stroke="#fff" stroke-width="1.5"><title>{g["id"]} {g["name"]}: into {g["into"]}{" (giant size)" if g["class"] == "G" else ""}</title></rect>'
                      f'<text x="{sx(z) + 9}" y="{sy(x) + 4}" fill="{fill}">{g["id"]}</text>')
for x, z in lamps:
    L["lamps"].append(f'<circle cx="{sx(z):.1f}" cy="{sy(x):.1f}" r="3.2" fill="#f0b030" stroke="#704000" stroke-width=".8"><title>Lamp on a hook (dim, for play)</title></circle>')
for x, z in grates:
    L["grates"].append(f'<rect x="{sx(z) - 3.5:.1f}" y="{sy(x) - 3.5:.1f}" width="7" height="7" fill="#fff" stroke="#222" stroke-width="1.2"><title>Ladder up through a street grate (lets light in)</title></rect>'
                       f'<line x1="{sx(z) - 3.5:.1f}" y1="{sy(x):.1f}" x2="{sx(z) + 3.5:.1f}" y2="{sy(x):.1f}" stroke="#222" stroke-width=".8"/>')
for s_ in stairs:
    x, z = s_["at"]
    L["stairs"].append(f'<g><polygon points="{sx(z):.1f},{sy(x) - 8:.1f} {sx(z) + 7:.1f},{sy(x) + 5:.1f} {sx(z) - 7:.1f},{sy(x) + 5:.1f}" fill="#000" stroke="#fff"/><title>{s_["id"]} {s_["name"]}{": " + s_["note"] if s_["note"] else ""}</title></g>')
shape = {"hatch": "#444", "cellar": "#7a4a1a", "air": "#2a7a9a", "collapse": "#d0201a"}
for ac in access:
    x, z = ac["at"]; col = shape[ac["kind"]]
    L["access"].append(f'<g><circle cx="{sx(z)}" cy="{sy(x)}" r="5" fill="{col}" stroke="#fff"/><title>{ac["id"]} {ac["name"]}{": " + ac["note"] if ac.get("note") else ""}</title></g>'
                       f'<text x="{sx(z) + 7}" y="{sy(x) - 6}" fill="{col}">{ac["id"]}</text>')
for n_, p in places.items():
    L["places"].append(f'<text x="{sx(p["z"]):.0f}" y="{sy(p["x"]):.0f}">{n_}</text>')
style = {"grid": 'stroke="#000" stroke-opacity=".12" fill="#555" font-size="10"', "drains": 'fill="none" stroke="#3a9a5a" stroke-width="1" stroke-opacity=".7"', "gullies": "",
         "M": 'fill="none" stroke-linecap="round" stroke-linejoin="round"', "G": 'fill="none" stroke-linecap="round" stroke-linejoin="round"',
         "rooms": 'fill-opacity=".45" stroke-width="2" font-size="11" font-weight="bold"', "gates": 'font-size="11" font-weight="bold"', "lamps": "", "grates": "", "stairs": "",
         "access": 'font-size="10" font-weight="bold"', "labels": 'font-size="11" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3"',
         "places": 'font-size="11" font-style="italic" fill="#3a2a1a" paint-order="stroke" stroke="#f4eee0" stroke-width="3"'}
names = {"grid": "Grid (50 m)", "drains": "Side drains", "gullies": "Street gullies", "M": "Ruien", "G": "Giant galleries", "rooms": "Halls and rooms",
         "gates": "Gates", "lamps": "Lamps", "grates": "Ladders and grates", "stairs": "Stairs", "access": "Hatches, shafts", "labels": "Rui names", "places": "Place names"}
svg_layers = "".join(f'<g id="L_{k_}" {style[k_]}>{"".join(v)}</g>' for k_, v in L.items())

# ---- sections to scale ----
def section():
    m = 30; out = []; Wd, Hd = 1180, 300
    Y = lambda y: 22 + (0.4 - y) * m
    def lvl(y, label, col, dash=""):
        out.append(f'<line x1="10" y1="{Y(y):.0f}" x2="{Wd - 10}" y2="{Y(y):.0f}" stroke="{col}" stroke-width="1.1" {dash}/>'
                   f'<text x="{Wd - 14}" y="{Y(y) - 3:.0f}" text-anchor="end" fill="{col}" font-size="11">{label}</text>')
    lvl(0, "street 0 m", "#333")
    lvl(lv["highWater"], f"river high water {lv['highWater']} m", "#1f5fa8", 'stroke-dasharray="6 4"')
    lvl(lv["lowestInsideWater"], f"lowest water inside {lv['lowestInsideWater']} m (the river at low tide)", "#1f5fa8", 'stroke-dasharray="6 4"')
    def figure(cx, foot, h, col, label="", lean=0.0):
        """A standing figure h tall; lean (degrees) tips it forward from the feet."""
        a_ = math.radians(lean); hx, hy = math.sin(a_) * h, math.cos(a_) * h
        out.append(f'<line x1="{cx:.0f}" y1="{Y(foot):.0f}" x2="{cx + hx * .87 * m:.0f}" y2="{Y(foot + hy * .87):.0f}" stroke="{col}" stroke-width="{h * .13 * m:.0f}" stroke-linecap="round"/>'
                   f'<circle cx="{cx + hx * .93 * m:.0f}" cy="{Y(foot + hy * .93):.0f}" r="{h * .07 * m:.0f}" fill="{col}"/>')
        if label: out.append(f'<text x="{cx + 14:.0f}" y="{Y(foot + h * .55):.0f}" font-size="10" fill="{col}">{label}</text>')
    def stoop(cx, foot, h, top, col, label=""):
        """Legs straight, back and neck bent forward until the head's crown is at `top`."""
        leg, back, head = .52 * h, .35 * h, .13 * h
        for deg in range(0, 90):
            t = math.radians(deg); hx, hy = cx + math.sin(t) * back * m, foot + leg + math.cos(t) * back
            if hy + head * math.cos(t * 1.3) <= top: break
        out.append(f'<polyline points="{cx:.0f},{Y(foot):.0f} {cx:.0f},{Y(foot + leg):.0f} {hx:.0f},{Y(hy):.0f}" fill="none" stroke="{col}" stroke-width="{h * .13 * m:.0f}" stroke-linecap="round" stroke-linejoin="round"/>'
                   f'<circle cx="{hx + math.sin(t * 1.3) * head * .6 * m:.0f}" cy="{Y(hy + math.cos(t * 1.3) * head * .55):.0f}" r="{head * .55 * m:.0f}" fill="{col}"/>')
        if label: out.append(f'<text x="{cx + 2.0 * m:.0f}" y="{Y(foot + 2.2):.0f}" font-size="10" fill="{col}">{label}</text>')
    def vault(cx, wid, bed, top, water=None, maxwater=None, ledges=(), title=""):
        r_ = wid / 2; spring = top - r_; x0, x1 = cx - r_ * m, cx + r_ * m
        out.append(f'<path d="M{x0 - 14},{Y(bed - .3):.0f} L{x0 - 14},{Y(spring):.0f} A{r_ * m + 14},{r_ * m + 14} 0 0 1 {x1 + 14},{Y(spring):.0f} L{x1 + 14},{Y(bed - .3):.0f} Z" fill="#a0584a"/>'
                   f'<path d="M{x0},{Y(bed):.0f} L{x0},{Y(spring):.0f} A{r_ * m},{r_ * m} 0 0 1 {x1},{Y(spring):.0f} L{x1},{Y(bed):.0f} Z" fill="#2b2622"/>')
        if water is not None:
            out.append(f'<rect x="{x0:.0f}" y="{Y(water):.0f}" width="{x1 - x0:.0f}" height="{(water - bed) * m:.0f}" fill="#3a6a9a" fill-opacity=".65"/>')
        if maxwater is not None:
            out.append(f'<line x1="{x0:.0f}" y1="{Y(maxwater):.0f}" x2="{x1:.0f}" y2="{Y(maxwater):.0f}" stroke="#9ac8ff" stroke-dasharray="4 3"/>')
        for lx, lw, ly in ledges:
            out.append(f'<rect x="{lx:.0f}" y="{Y(ly):.0f}" width="{lw * m:.0f}" height="{(ly - bed) * m:.0f}" fill="#7a6a5a"/>')
        out.append(f'<text x="{cx}" y="{Y(bed) + 26:.0f}" text-anchor="middle" font-size="12" font-weight="bold" fill="#222">{title}</text>')
    g, mm = K["G"], K["M"]; ah = lv["antigoonHeight"]
    # giant gallery
    cx = 250; r_ = g["innerWidth"] / 2; led = g["bed"] + g["ledgeAboveBed"]
    vault(cx, g["innerWidth"], g["bed"], crown, g["bed"] + 1.5, g["bed"] + g["maxWaterAboveBed"],
          [(cx - r_ * m, g["ledgeWidth"], led), (cx + r_ * m - g["ledgeWidth"] * m, g["ledgeWidth"], led)], f'Giant gallery {g["innerWidth"]:.0f} x {g["bedToCrown"]} m')
    figure(cx + .3 * m, g["bed"], ah, "#e8c060")
    out.append(f'<text x="{cx + .9 * m:.0f}" y="{Y(g["bed"] + 4.0):.0f}" font-size="10" fill="#e8c060">Antigoon {ah} m, upright</text>')
    figure(cx - (r_ - .5) * m, led, 1.8, "#9ad0ff", "Jef")
    out.append(f'<text x="{cx - r_ * m - 18:.0f}" y="{Y(g["bed"] + g["maxWaterAboveBed"]) + 4:.0f}" text-anchor="end" font-size="10" fill="#4a7ab0">at most 2.4 m</text>'
               f'<text x="{cx - r_ * m - 18:.0f}" y="{Y(g["bed"] + 1.5) + 14:.0f}" text-anchor="end" font-size="10" fill="#4a7ab0">usually 1.5 m</text>')
    # rui with a ladder shaft and grate
    cx = 620; r_ = mm["innerWidth"] / 2; led = mm["bed"] + mm["ledgeAboveBed"]
    out.append(f'<rect x="{cx - r_ * m + 2:.0f}" y="{Y(0):.0f}" width="{.8 * m:.0f}" height="{(0 - crown + .6) * m:.0f}" fill="#2b2622"/>'
               f'<line x1="{cx - r_ * m + 2:.0f}" y1="{Y(0):.0f}" x2="{cx - r_ * m + 2 + .8 * m:.0f}" y2="{Y(0):.0f}" stroke="#ddd" stroke-width="3" stroke-dasharray="2 2"/>'
               f'<text x="{cx - r_ * m - 6:.0f}" y="{Y(-.3):.0f}" text-anchor="end" font-size="10" fill="#333">ladder and grate</text>')
    for k_ in range(int((0 - led) / .3)):
        yy = led + .3 * (k_ + 1); out.append(f'<line x1="{cx - r_ * m + 6:.0f}" y1="{Y(yy):.0f}" x2="{cx - r_ * m + .8 * m - 2:.0f}" y2="{Y(yy):.0f}" stroke="#999"/>')
    vault(cx, mm["innerWidth"], mm["bed"], crown, mm["bed"] + .5, None, [(cx - r_ * m, mm["ledgeWidth"], led)], f'Rui {mm["innerWidth"]} x {mm["bedToCrown"]:.0f} m')
    figure(cx, mm["bed"], ah, "#e8c060", f"Antigoon {ah} m, upright")
    figure(cx - (r_ - .4) * m, led, 1.8, "#9ad0ff", "Jef")
    out.append(f'<text x="{cx + r_ * m + 20:.0f}" y="{Y(mm["bed"] + .5) + 4:.0f}" font-size="10" fill="#4a7ab0">water about 0.5 m</text>'
               f'<text x="{cx + r_ * m + 20:.0f}" y="{Y(led) + 4:.0f}" font-size="10" fill="#7a6a5a">walkway {led:.1f} m</text>')
    vault(890, 3.0, crown - 2.0, crown, title="Real smallest: 3 x 2 m")
    vault(1040, 1.0, crown - 2.1, crown - 0.5, crown - 2.0, title="Side drain 1 x 1.6 m")
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {Wd} {Hd}" width="{Wd}" height="{Hd}" style="background:#f4eee0">{"".join(out)}</svg>'

sect = section()
open(os.path.join(OUT, "ruien-sections.svg"), "w", encoding="utf-8").write(sect)
rows = "".join(f'<tr><td>{n_}</td><td>{K[c_]["name"]}</td><td>{L_}</td></tr>'
               for (n_, c_), L_ in sorted(by_name.items(), key=lambda kv: (kv[0][1], -kv[1])))
room_rows = "".join(f'<tr><td>{rm["id"]}</td><td>{rm["name"]}</td><td>{K[rm["class"]]["name"]}</td><td>{rm["rect"][2] - rm["rect"][0]:.0f} x {rm["rect"][3] - rm["rect"][1]:.0f}</td></tr>' for rm in rooms)
checks = "".join(f'<label><input type="checkbox" checked data-l="{k_}"> {names[k_]}</label>' for k_ in L)
html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Ruien plan</title><style>
body{{font:14px system-ui,sans-serif;margin:0;background:#efe8d8;color:#222}} header{{padding:10px 16px;background:#2b2622;color:#f4eee0}}
h1{{font-size:18px;margin:0}} h2{{font-size:16px}} .bar{{padding:6px 16px;display:flex;flex-wrap:wrap;gap:12px;background:#e2d8c2;position:sticky;top:0;z-index:2}}
.wrap{{padding:10px 16px}} .map{{position:relative;width:{W}px;max-width:100%}} .map img,.map svg{{width:100%;display:block}} .map svg{{position:absolute;inset:0}}
table{{border-collapse:collapse;font-size:13px;margin-bottom:12px}} td,th{{border:1px solid #c8bca4;padding:3px 7px;text-align:left}}
.key span{{display:inline-block;width:22px;height:5px;vertical-align:middle;margin:0 4px 0 12px}} .sect svg{{width:100%;height:auto}}
</style></head><body><header><h1>Ruien plan, second draft (2D, Steve's network)</h1>North up, the Schelde on the left. Grid 50 m. Hover anything for details.</header>
<div class="bar">{checks}</div><div class="wrap">
<div class="key"><span style="background:#b0203a;height:7px"></span>Giant gallery ({tot['G']} m) <span style="background:#1f5fa8"></span>Rui ({tot['M']} m)
<span style="background:#3a9a5a;height:2px"></span>Side drain ({tot['S']} m).
White squares: {len(grates)} ladders up through street grates (they let light in). Black triangles: {len(stairs)} stairs. Yellow dots: {len(lamps)} dim lamps.
Coloured squares: gates (red giant size, blue normal, grey a closed boat door, purple the flush sluice). Gully dots: green within 40 m of a rui, orange 40-80 m, red farther.</div>
<div class="map"><img src="data:image/png;base64,{base64png}"><svg viewBox="0 0 {W} {H}">{svg_layers}</svg></div>
<h2>Sections to scale</h2><div class="sect">{sect}</div>
<h2>Halls and rooms</h2><table><tr><th>Id</th><th>Name</th><th>Kind</th><th>Size m</th></tr>{room_rows}</table>
<h2>Lines by name</h2><table><tr><th>Name</th><th>Kind</th><th>Length m</th></tr>{rows}</table>
<p>Wider than the street above (runs under house fronts, as the real Ruien do): giant galleries {under['G']} m, ruien {under['M']} m.
Gullies: {len(inlets)}; within 40 m of a rui {int((gg <= 40).sum())}; farthest {gg.max():.0f} m.</p>
</div><script>document.querySelectorAll('[data-l]').forEach(c=>c.onchange=()=>document.getElementById('L_'+c.dataset.l).style.display=c.checked?'':'none')</script></body></html>"""
open(os.path.join(OUT, "ruien-plan.html"), "w", encoding="utf-8").write(html)

# ---- flat PNG ----
for s_ in side: d.line([P(x, z) for x, z in s_], fill=(58, 154, 90), width=1)
hexc = lambda h: tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))
for c_ in ("M", "G"):
    for r in routes.values():
        if r["class"] == c_: d.line([P(x, z) for x, z in r["pts"]], fill=hexc(K[c_]["colour"]), width=K[c_]["stroke"], joint="curve")
for rm in rooms:
    x0, z0, x1, z1 = rm["rect"]; d.rectangle([P(x1, z0), P(x0, z1)], fill=hexc(K[rm["class"]]["colour"]))
for g in gates:
    px, py = P(*g["at"]); d.rectangle([px - 6, py - 6, px + 6, py + 6], fill=(106, 26, 122) if g.get("flush") else (106, 106, 106) if g.get("door") else hexc(K[g["class"]]["colour"]), outline=(255, 255, 255))
for x, z in lamps:
    px, py = P(x, z); d.ellipse([px - 3, py - 3, px + 3, py + 3], fill=(240, 176, 48), outline=(112, 64, 0))
for x, z in grates:
    px, py = P(x, z); d.rectangle([px - 3, py - 3, px + 3, py + 3], fill=(255, 255, 255), outline=(30, 30, 30))
for s_ in stairs:
    px, py = P(*s_["at"]); d.polygon([(px, py - 7), (px + 6, py + 4), (px - 6, py + 4)], fill=(0, 0, 0), outline=(255, 255, 255))
for n_ in seen:
    r = max((r for r in routes.values() if r["name"] == n_), key=lambda r: r["lengthM"]); mid = r["pts"][len(r["pts"]) // 2]; px, py = P(*mid)
    for ox, oy in [(-1, 0), (1, 0), (0, -1), (0, 1)]: d.text((px + 6 + ox, py - 12 + oy), n_, fill=(255, 255, 255))
    d.text((px + 6, py - 12), n_, fill=(110, 10, 30) if r["class"] == "G" else (10, 40, 110))
im.save(os.path.join(OUT, "ruien-plan.png"))
print("lengths", tot, "under houses", under, "rooms", len(rooms), "gates", len(gates), "grates", len(grates), "stairs", len(stairs), "lamps", len(lamps),
      "gullies within 40 m", int((gg <= 40).sum()), "farthest", round(float(gg.max())))
for rm in rooms: print(" ", rm["id"], rm["name"])
for g in gates: print(" ", g["id"], g["name"], g["class"])
