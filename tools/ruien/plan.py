"""Ruien plan (2D): lay the network of docs/plans/ruien/ruien-network.json under the town's streets and draw it.

python -I tools/ruien/plan.py <repo root>

Giant galleries are drawn by hand in the network file and routed under the widest street between their points.
The ruien and side drains are made here: every street gully (native-godot/world/town/drainage/ruien-inlets.json)
flows along the streets to the nearest rui gate, giant gallery or hall. A street that carries at least
`ruiFromGullies` gullies gets a rui; the rest get side drains.
Writes docs/plans/ruien/ruien-routes.json, ruien-plan.png and ruien-plan.html (self-contained, layers switch on and off).
World: +x north, +z east, metres. Pictures: north up, east right."""
import base64, io, json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage, sparse
from scipy.sparse.csgraph import dijkstra

ROOT = sys.argv[1] if len(sys.argv) > 1 else "."
J = lambda *p: os.path.join(ROOT, *p)
city = json.load(open(J("native-godot/world/data/shared/city.json")))
net = json.load(open(J("docs/plans/ruien/ruien-network.json")))
inlets = json.load(open(J("native-godot/world/town/drainage/ruien-inlets.json")))
OUT = J("docs/plans/ruien")

# ---- 1 m grid from the walk mask: row = x - x0, col = z - z0 ----
wk = city["walk"]; XW, ZW = wk["x0"], wk["z0"]
a = np.array(Image.open(J("native-godot/world/data/public/city/walk.png")))[::2, ::2]
free = (a[..., 0] == 0) & (a[..., 1] == 0) & (a[..., 2] == 0)
clear = ndimage.distance_transform_edt(free)  # half the street width, metres
lab, _ = ndimage.label(free, structure=np.ones((3, 3)))
free = lab == np.bincount(lab.ravel())[1:].argmax() + 1  # the street network; closed yards are left out
R, C = free.shape
cell = lambda x, z: (int(round(x - XW)), int(round(z - ZW)))
world = lambda r, c: (float(r + XW), float(c + ZW))

def graph():
    idx = np.arange(R * C).reshape(R, C); rows, cols, w = [], [], []
    cost = 1 + 4 / np.maximum(clear, 0.7) ** 2  # keeps to the middle of a street without long detours into squares
    for dr, dc in [(0, 1), (1, 0), (1, 1), (1, -1)]:
        a0 = free[max(0, -dr):R - max(0, dr), max(0, -dc):C - max(0, dc)]
        r0, c0 = np.nonzero(a0); r0 += max(0, -dr); c0 += max(0, -dc)
        r1, c1 = r0 + dr, c0 + dc; ok = free[r1, c1]
        r0, c0, r1, c1 = r0[ok], c0[ok], r1[ok], c1[ok]
        L = math.hypot(dr, dc); ww = L * (cost[r0, c0] + cost[r1, c1]) / 2
        rows += [idx[r0, c0], idx[r1, c1]]; cols += [idx[r1, c1], idx[r0, c0]]; w += [ww, ww]
    return sparse.csr_matrix((np.concatenate(w), (np.concatenate(rows), np.concatenate(cols))), shape=(R * C, R * C))

G = graph()
fr, fc = np.nonzero(free)

def snap(x, z):
    r, c = cell(x, z)
    if 0 <= r < R and 0 <= c < C and free[r, c]: return r, c
    k = np.argmin((fr - r) ** 2 + (fc - c) ** 2); return int(fr[k]), int(fc[k])

def route(a, b):
    s, t = snap(*a), snap(*b); si, ti = s[0] * C + s[1], t[0] * C + t[1]
    _, pred = dijkstra(G, indices=si, return_predecessors=True)
    path = [ti]
    while path[-1] != si:
        p = pred[path[-1]]
        if p < 0: raise SystemExit(f"no route {a} -> {b}")
        path.append(p)
    return [divmod(int(i), C) for i in path[::-1]]

def simplify(pts, tol=1.2):
    if len(pts) < 3: return pts
    a, b = np.array(pts[0]), np.array(pts[-1]); ab = b - a; n = np.hypot(*ab) or 1
    d = [abs(ab[0] * (p[1] - a[1]) - ab[1] * (p[0] - a[0])) / n for p in pts]
    k = int(np.argmax(d))
    if d[k] <= tol: return [pts[0], pts[-1]]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)

def stats(cells, kind):
    """Street width along the line, and how much of it is wider than the street (so it runs under house fronts)."""
    k = net["classes"][kind]; outer = k["innerWidth"] + 2 * k["wall"]
    w = np.array([2 * clear[r, c] for r, c in cells])
    return {"streetWidthMin": round(float(w.min()), 1), "streetWidthP10": round(float(np.percentile(w, 10)), 1),
            "underHousesShare": round(float((w < outer).mean()), 2)}
plen = lambda poly: sum(math.dist(p, q) for p, q in zip(poly, poly[1:]))
rnd = lambda poly: [[round(x, 1), round(z, 1)] for x, z in poly]
gate = {g["id"]: g for g in net["gates"]}

# ---- giant galleries ----
routes = {}
for ln in net["lines"]:
    cells = []
    for a_, b_ in zip(ln["pts"], ln["pts"][1:]):
        seg = route(a_, b_); cells += seg if not cells else seg[1:]
    poly = simplify([world(r, c) for r, c in cells]) + [tuple(map(float, gate[ln["gate"]]["at"]))]
    routes[ln["id"]] = {"name": ln["name"], "class": "G", "pts": rnd(poly), "lengthM": round(plen(poly)), **stats(cells, "G"),
                        "ends": "gate " + ln["gate"], "_cells": cells}

# ---- ruien and side drains ----
sinks = {}
for rid, r in routes.items():
    for rc in r.pop("_cells"): sinks[rc[0] * C + rc[1]] = rid
for ch in net["chambers"]:
    x0, z0, x1, z1 = ch["rect"]
    for x in range(int(x0), int(x1) + 1):
        for z in range(int(z0), int(z1) + 1):
            rc = cell(x, z)
            if free[rc]: sinks[rc[0] * C + rc[1]] = ch["id"]
for g in net["gates"]:
    if g.get("rui"): rc = snap(*g["at"]); sinks[rc[0] * C + rc[1]] = g["id"]
_, pred, origin = dijkstra(G, indices=np.array(sorted(sinks)), min_only=True, return_predecessors=True)
flow = np.zeros(R * C, np.int32); gully_cell = []
for it in inlets:
    r, c = snap(it["world"][0], it["world"][2]); i = r * C + c; gully_cell.append(i)
    while True:
        flow[i] += 1
        if i in sinks or pred[i] < 0: break
        i = int(pred[i])

def branches(lo, hi):
    """Paths of cells with lo <= flow < hi, each from a head down to a sink, a junction or the end of the band."""
    on = (flow >= lo) & (flow < hi); up = np.zeros(R * C, bool)
    on_idx = np.nonzero(on)[0]; p_ = pred[on_idx]; up[p_[p_ >= 0]] = True
    def reach(i):
        n = 0
        while i not in sinks and pred[i] >= 0 and on[i]: i = int(pred[i]); n += 1
        return n
    out, seen = [], set()
    for head in sorted(np.nonzero(on & ~up)[0], key=reach, reverse=True):  # longest first: a trunk runs on to its end
        path = [int(head)]
        while path[-1] not in sinks and pred[path[-1]] >= 0 and path[-1] not in seen:
            seen.add(path[-1]); path.append(int(pred[path[-1]]))
            if not on[path[-1]]: break
        if len(path) > 2: out.append(path)
    return out

T = net["ruiFromGullies"]; by_sink = {}
for path in branches(T, 10 ** 9):
    by_sink.setdefault(sinks.get(int(origin[path[-1]]), "?"), []).append(path)
for sink, paths in by_sink.items():
    paths.sort(key=len, reverse=True)
    base = gate[sink]["rui"] if sink in gate else routes[sink]["name"] + " feeder" if sink in routes else "Hall feeder"
    n_ = 0
    for path in paths:
        cells = [divmod(i, C) for i in path]
        poly = simplify([world(r, c) for r, c in cells])
        if path[-1] in sinks and sink in gate: poly.append(tuple(map(float, gate[sink]["at"])))
        if plen(poly) < 8: continue
        n_ += 1
        routes[f"{sink}.{n_}"] = {"name": base if n_ == 1 else f"{base}, branch {n_ - 1}", "class": "M", "pts": rnd(poly),
                                  "lengthM": round(plen(poly)), **stats(cells, "M"), "gullies": int(flow[path[-1]]),
                                  "ends": ("gate " + sink) if (sink in gate and path[-1] in sinks) else "joins " + (sink if path[-1] in sinks else "a larger rui")}
for nm in net.get("ruiNames", []):  # a name sticks to the rui that passes nearest its point
    p = np.array(nm["near"], float)
    def gap(pts):
        best = 1e9
        for a_, b_ in zip(pts, pts[1:]):
            a_, b_ = np.array(a_), np.array(b_); ab = b_ - a_
            t = np.clip(np.dot(p - a_, ab) / max(np.dot(ab, ab), 1e-9), 0, 1); best = min(best, float(np.hypot(*(p - a_ - t * ab))))
        return best
    best = min((rid for rid, r in routes.items() if r["class"] == "M"), key=lambda rid: gap(routes[rid]["pts"]))
    routes[best]["name"] = nm["name"]
side = [rnd(simplify([world(*divmod(i, C)) for i in path], 0.8)) for path in branches(1, T)]

# ---- levels: crowns 0.9 m under the street; rui beds rise 1:1000 from the sill ----
lv = net["levels"]; crown = lv["street"] - lv["crownBelowStreet"]
for rid, r in routes.items():
    k = net["classes"][r["class"]]
    if r["class"] == "G":
        r["bed"] = round(crown - k["bedToCrown"], 2); r["ledge"] = round(r["bed"] + k["ledgeAboveBed"], 2)
        r["crown"] = crown; r["sill"] = k["sill"]
    else:
        r["bedAtEnd"] = k["sill"]; r["bedAtHead"] = round(k["sill"] + lv["slope"] * r["lengthM"], 2)
        r["coverAtHeadM"] = round(lv["street"] - r["bedAtHead"] - k["bedToCrown"], 2)

# ---- gullies: distance to the nearest gallery or rui ----
segs = [(np.array(p), np.array(q)) for r in routes.values() for p, q in zip(r["pts"], r["pts"][1:])]
def nearest(p):
    best = 1e9
    for a_, b_ in segs:
        ab = b_ - a_; t = np.clip(np.dot(p - a_, ab) / max(np.dot(ab, ab), 1e-9), 0, 1)
        best = min(best, float(np.hypot(*(p - (a_ + t * ab)))))
    return best
drains = [{"id": it["id"], "at": [it["world"][0], it["world"][2]], "to": list(world(*divmod(gc, C))),
           "d": nearest(np.array([it["world"][0], it["world"][2]]))} for it, gc in zip(inlets, gully_cell)]
dd = np.array([d["d"] for d in drains])
coverage = {"gullies": len(drains), "within40": int((dd <= 40).sum()), "within80": int((dd <= 80).sum()),
            "over80": int((dd > 80).sum()), "maxM": round(float(dd.max()))}

# ---- manholes every N metres along galleries and ruien ----
manholes = []
for r in routes.values():
    acc = 0; step = net["manholeEvery"]
    for p, q in zip(r["pts"], r["pts"][1:]):
        L = math.dist(p, q); t = step - acc
        while t < L: manholes.append([p[0] + (q[0] - p[0]) * t / L, p[1] + (q[1] - p[1]) * t / L]); t += step
        acc = (acc + L) % step

json.dump({"_about": "Made by tools/ruien/plan.py from ruien-network.json. Do not edit; edit the network file.",
           "routes": routes, "sideDrains": side, "coverage": coverage, "manholes": rnd(manholes)},
          open(os.path.join(OUT, "ruien-routes.json"), "w"), indent=1)

# ---- base map raster (north up) ----
X0, X1, Z0, Z1 = -400, 340, -80, 470; S = 2
W, H = (Z1 - Z0) * S, (X1 - X0) * S
P = lambda x, z: ((z - Z0) * S, (X1 - x) * S)
im = Image.new("RGB", (W, H), (226, 214, 186)); d = ImageDraw.Draw(im)
def poly(pts, fill):
    if len(pts) > 2: d.polygon([P(x, z) for x, z in pts], fill=fill)
def tris(t, fill):
    for i in range(0, len(t) - 5, 6): poly([(t[i], t[i + 1]), (t[i + 2], t[i + 3]), (t[i + 4], t[i + 5])], fill)
g = city["ground"]
for k_, col in [("earth", (214, 200, 170)), ("grass", (196, 204, 165)), ("cobble", (240, 233, 214)), ("flags", (244, 238, 224)), ("quay", (226, 218, 200))]:
    for t in g.get(k_, []): tris(t, col)
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

# ---- SVG overlay ----
sx = lambda z: (z - Z0) * S; sy = lambda x: (X1 - x) * S
pl = lambda pts: " ".join(f"{sx(z):.1f},{sy(x):.1f}" for x, z in pts)
L = {k_: [] for k_ in ["grid", "drains", "gullies", "M", "G", "chambers", "gates", "access", "manholes", "labels", "places"]}
for x in range(-400, 341, 50):
    L["grid"].append(f'<line x1="0" y1="{sy(x)}" x2="{W}" y2="{sy(x)}"/><text x="3" y="{sy(x) - 3}">x {x}</text>')
for z in range(-50, 471, 50):
    L["grid"].append(f'<line x1="{sx(z)}" y1="0" x2="{sx(z)}" y2="{H}"/><text x="{sx(z) + 3}" y="12">z {z}</text>')
for sd in side: L["drains"].append(f'<polyline points="{pl(sd)}"/>')
for dr in drains:
    L["drains"].append(f'<line x1="{sx(dr["at"][1]):.1f}" y1="{sy(dr["at"][0]):.1f}" x2="{sx(dr["to"][1]):.1f}" y2="{sy(dr["to"][0]):.1f}"/>')
    col = "#3a9a5a" if dr["d"] <= 40 else "#d08a1a" if dr["d"] <= 80 else "#d0201a"
    L["gullies"].append(f'<circle cx="{sx(dr["at"][1]):.1f}" cy="{sy(dr["at"][0]):.1f}" r="1.8" fill="{col}"><title>{dr["id"]}: {dr["d"]:.0f} m to a rui</title></circle>')
for rid, r in routes.items():
    k = net["classes"][r["class"]]
    lv_txt = (f'bed {r["bed"]} m, ledges {r["ledge"]} m, crown {r["crown"]} m' if r["class"] == "G"
              else f'bed {r["bedAtEnd"]} to {r["bedAtHead"]} m, carries {r["gullies"]} gullies')
    tip = f'{rid} {r["name"]} ({k["name"]}): {r["lengthM"]} m, street {r["streetWidthMin"]} m at its narrowest, {lv_txt}, {r["ends"]}'
    L[r["class"]].append(f'<polyline points="{pl(r["pts"])}" stroke="{k["colour"]}" stroke-width="{k["stroke"]}"><title>{tip}</title></polyline>')
    if r["class"] == "G" or r["name"].find("branch") < 0:
        mid = r["pts"][len(r["pts"]) // 2]
        L["labels"].append(f'<text x="{sx(mid[1]) + 6:.0f}" y="{sy(mid[0]) - 6:.0f}" fill="{k["colour"]}">{r["name"]}</text>')
for ch in net["chambers"]:
    x0, z0, x1, z1 = ch["rect"]
    L["chambers"].append(f'<rect x="{sx(z0)}" y="{sy(x1)}" width="{(z1 - z0) * S}" height="{(x1 - x0) * S}"><title>{ch["id"]} {ch["name"]}: {ch["note"]}</title></rect>'
                         f'<text x="{sx(z0)}" y="{sy(x0) + 14}">{ch["id"]} hall</text>')
for gt in net["gates"]:
    x, z = gt["at"]; fill = "#6a1a7a" if gt.get("flush") else "#b0203a" if gt.get("giant") else "#1f5fa8"
    L["gates"].append(f'<rect x="{sx(z) - 6}" y="{sy(x) - 6}" width="12" height="12" fill="{fill}" stroke="#fff" stroke-width="1.5"><title>{gt["id"]} {gt["name"]}: into {gt["into"]}{" (giant size)" if gt.get("giant") else ""}</title></rect>'
                      f'<text x="{sx(z) + 9}" y="{sy(x) + 4}" fill="{fill}">{gt["id"]}</text>')
shape = {"stair": "#000", "hatch": "#444", "manhole": "#666", "cellar": "#7a4a1a", "air": "#2a7a9a", "collapse": "#d0201a"}
for ac in net["access"]:
    x, z = ac["at"]; col = shape[ac["kind"]]
    mark = (f'<polygon points="{sx(z)},{sy(x) - 8} {sx(z) + 7},{sy(x) + 5} {sx(z) - 7},{sy(x) + 5}" fill="{col}" stroke="#fff"/>' if ac["kind"] in ("stair", "collapse")
            else f'<circle cx="{sx(z)}" cy="{sy(x)}" r="5" fill="{col}" stroke="#fff"/>')
    L["access"].append(f'<g>{mark}<title>{ac["id"]} {ac["name"]}{": " + ac["note"] if ac.get("note") else ""}</title></g>'
                       f'<text x="{sx(z) + 8}" y="{sy(x) - 6}" fill="{col}">{ac["id"]}</text>')
for x, z in manholes:
    L["manholes"].append(f'<circle cx="{sx(z):.1f}" cy="{sy(x):.1f}" r="3" fill="#fff" stroke="#333"><title>Manhole and ladder</title></circle>')
for n, p in city["places"].items():
    L["places"].append(f'<text x="{sx(p["z"]):.0f}" y="{sy(p["x"]):.0f}">{n}</text>')

style = {"grid": 'stroke="#000" stroke-opacity=".12" fill="#555" font-size="10"', "drains": 'fill="none" stroke="#3a9a5a" stroke-width="1.2" stroke-opacity=".8"',
         "gullies": "", "M": 'fill="none" stroke-linecap="round" stroke-linejoin="round"', "G": 'fill="none" stroke-linecap="round" stroke-linejoin="round"',
         "chambers": 'fill="#b0203a" fill-opacity=".35" stroke="#b0203a" stroke-width="2" font-size="12" font-weight="bold"',
         "gates": 'font-size="11" font-weight="bold"', "access": 'font-size="10" font-weight="bold"', "manholes": "",
         "labels": 'font-size="11" font-weight="bold" paint-order="stroke" stroke="#fff" stroke-width="3"',
         "places": 'font-size="11" font-style="italic" fill="#3a2a1a" paint-order="stroke" stroke="#f4eee0" stroke-width="3"'}
names = {"grid": "Grid (50 m)", "drains": "Side drains", "gullies": "Street gullies", "M": "Ruien", "G": "Giant galleries",
         "chambers": "Hall", "gates": "Gates", "access": "Ways in and out", "manholes": "Manholes", "labels": "Rui names", "places": "Place names"}
svg_layers = "".join(f'<g id="L_{k_}" {style[k_]}>{"".join(v)}</g>' for k_, v in L.items())

# ---- cross-sections to scale ----
def section():
    m = 34; out = []; Wd, Hd = 1100, 330
    Y = lambda y: 30 + (0.5 - y) * m
    def lvl(y, label, col, dash=""):
        out.append(f'<line x1="10" y1="{Y(y):.0f}" x2="{Wd - 10}" y2="{Y(y):.0f}" stroke="{col}" stroke-width="1.2" {dash}/>'
                   f'<text x="{Wd - 14}" y="{Y(y) - 3:.0f}" text-anchor="end" fill="{col}" font-size="11">{label}</text>')
    lvl(0, "street 0 m", "#333")
    lvl(lv["highWater"], f"high water {lv['highWater']} m", "#1f5fa8", 'stroke-dasharray="6 4"')
    lvl(lv["lowWater"], f"low water {lv['lowWater']} m", "#1f5fa8", 'stroke-dasharray="6 4"')
    def person(cx, foot, h, col, label, bent=False):
        hd = h * .13; body = h - hd
        if bent:
            out.append(f'<path d="M{cx - .25 * m:.0f},{Y(foot):.0f} L{cx - .1 * m:.0f},{Y(foot + h * .48):.0f} L{cx + h * .42 * m:.0f},{Y(foot + h * .55):.0f}" '
                       f'stroke="{col}" stroke-width="{h * .09 * m:.0f}" fill="none" stroke-linecap="round"/>'
                       f'<circle cx="{cx + h * .5 * m:.0f}" cy="{Y(foot + h * .5):.0f}" r="{hd * m / 2:.0f}" fill="{col}"/>')
        else:
            out.append(f'<rect x="{cx - h * .07 * m:.0f}" y="{Y(foot + body):.0f}" width="{h * .14 * m:.0f}" height="{body * m:.0f}" rx="{h * .05 * m:.0f}" fill="{col}"/>'
                       f'<circle cx="{cx}" cy="{Y(foot + body + hd / 2):.0f}" r="{hd * m / 2:.0f}" fill="{col}"/>')
        if label: out.append(f'<text x="{cx}" y="{Y(foot) + 14:.0f}" text-anchor="middle" font-size="10" fill="{col}">{label}</text>')
    def vault(cx, wid, bed, top, ledge=None, ledgeW=0, two=False, water=None, title=""):
        r_ = wid / 2; spring = top - r_; x0, x1 = cx - r_ * m, cx + r_ * m
        out.append(f'<path d="M{x0 - 15},{Y(bed - .3):.0f} L{x0 - 15},{Y(spring):.0f} A{r_ * m + 15},{r_ * m + 15} 0 0 1 {x1 + 15},{Y(spring):.0f} L{x1 + 15},{Y(bed - .3):.0f} Z" fill="#a0584a"/>')
        out.append(f'<path d="M{x0},{Y(bed):.0f} L{x0},{Y(spring):.0f} A{r_ * m},{r_ * m} 0 0 1 {x1},{Y(spring):.0f} L{x1},{Y(bed):.0f} Z" fill="#2b2622"/>')
        if water is not None:
            out.append(f'<rect x="{x0:.0f}" y="{Y(water):.0f}" width="{x1 - x0:.0f}" height="{(water - bed) * m:.0f}" fill="#3a6a9a" fill-opacity=".6"/>')
        if ledge is not None:
            for lx0, lx1 in ([(x0, x0 + ledgeW * m), (x1 - ledgeW * m, x1)] if two else [(x0, x0 + ledgeW * m)]):
                out.append(f'<rect x="{lx0:.0f}" y="{Y(ledge):.0f}" width="{lx1 - lx0:.0f}" height="{(ledge - bed) * m:.0f}" fill="#7a6a5a"/>')
        out.append(f'<text x="{cx}" y="{Y(bed) + 28:.0f}" text-anchor="middle" font-size="12" font-weight="bold" fill="#222">{title}</text>')
    kG, kM = net["classes"]["G"], net["classes"]["M"]
    bedG = crown - kG["bedToCrown"]; ledG = bedG + kG["ledgeAboveBed"]
    vault(200, kG["innerWidth"], bedG, crown, ledG, kG["ledgeWidth"], True, kG["sill"], f'Giant gallery {kG["innerWidth"]:.0f} x {kG["bedToCrown"]:.0f} m')
    person(200, bedG, 5.4, "#e8c060", "")
    out.append(f'<text x="{200 + .45 * m:.0f}" y="{Y(bedG + 4.6):.0f}" font-size="11" fill="#e8c060">Antigoon 5.4 m, upright</text>'
               f'<text x="{200 + .45 * m:.0f}" y="{Y(bedG + 4.2):.0f}" font-size="10" fill="#e8c060">0.6 m to spare</text>')
    person(200 - 1.9 * m, ledG, 1.8, "#9ad0ff", "Jef")
    out.append(f'<text x="200" y="{Y(kG["sill"]) + 13:.0f}" text-anchor="middle" font-size="10" fill="#cfe4ff">water kept by the gate sill ({kG["sill"]} m)</text>')
    bedM = kM["sill"]
    vault(560, kM["innerWidth"], bedM, bedM + kM["bedToCrown"], bedM + kM["ledgeAboveBed"], kM["ledgeWidth"], title=f'Rui {kM["innerWidth"]:.0f} x {kM["bedToCrown"]:.0f} m')
    person(560 - 1.1 * m, bedM + kM["ledgeAboveBed"], 1.8, "#9ad0ff", "Jef")
    person(560 + .1 * m, bedM, 5.4, "#e8c060", "", bent=True)
    out.append(f'<text x="560" y="{Y(bedM) + 44:.0f}" text-anchor="middle" font-size="11" fill="#a06a10">Antigoon bent double needs about 3.3 m (estimate): he does not fit.</text>')
    vault(880, 3.0, -0.9 - 2.0, -0.9, title="Real smallest: 3 x 2 m")
    vault(1020, 1.0, -0.9 - 1.6, -0.9 - 0.6, title="Side drain 1 x 1.6 m")
    return f'<svg viewBox="0 0 {Wd} {Hd}" width="100%" style="background:#f4eee0;border:1px solid #ccc">{"".join(out)}</svg>'

main_rows = [(rid, r) for rid, r in routes.items() if r["class"] == "G" or r["lengthM"] >= 40]
rows = "".join(f'<tr><td>{rid}</td><td>{r["name"]}</td><td>{net["classes"][r["class"]]["name"]}</td><td>{r["lengthM"]}</td>'
               f'<td>{r["streetWidthMin"]} / {r["streetWidthP10"]}</td><td>{round(100 * r["underHousesShare"])}%</td><td>{r.get("gullies", "")}</td><td>{r["ends"]}</td></tr>' for rid, r in main_rows)
totG = sum(r["lengthM"] for r in routes.values() if r["class"] == "G"); totM = sum(r["lengthM"] for r in routes.values() if r["class"] == "M")
totS = round(sum(plen(s_) for s_ in side))
under = {c_: round(sum(r["lengthM"] * r["underHousesShare"] for r in routes.values() if r["class"] == c_)) for c_ in ("G", "M")}
checks = "".join(f'<label><input type="checkbox" checked data-l="{k_}"> {names[k_]}</label>' for k_ in L)
html = f"""<!doctype html><html><head><meta charset="utf-8"><title>Ruien plan</title><style>
body{{font:14px system-ui,sans-serif;margin:0;background:#efe8d8;color:#222}} header{{padding:10px 16px;background:#2b2622;color:#f4eee0}}
h1{{font-size:18px;margin:0}} h2{{font-size:16px}} .bar{{padding:6px 16px;display:flex;flex-wrap:wrap;gap:12px;background:#e2d8c2;position:sticky;top:0;z-index:2}}
.wrap{{padding:10px 16px}} .map{{position:relative;width:{W}px;max-width:100%}} .map img,.map svg{{width:100%;display:block}} .map svg{{position:absolute;inset:0}}
table{{border-collapse:collapse;font-size:13px}} td,th{{border:1px solid #c8bca4;padding:3px 7px;text-align:left}} .key span{{display:inline-block;width:22px;height:5px;vertical-align:middle;margin:0 4px 0 12px}}
</style></head><body><header><h1>Ruien plan, first draft (2D)</h1>North up, the Schelde on the left. Grid 50 m. Hover a line, gate or door for details.</header>
<div class="bar">{checks}</div><div class="wrap">
<div class="key"><span style="background:#b0203a;height:7px"></span>Giant gallery ({totG} m) <span style="background:#1f5fa8"></span>Rui ({totM} m)
<span style="background:#3a9a5a;height:2px"></span>Side drain ({totS} m). Gully dots: green within 40 m of a rui, orange 40-80 m, red over 80 m.<br>
Squares: gates (red = giant size, blue = normal, purple = flush sluice). Triangles: stairs (red = fallen vault). Dots: hatches, manholes (white), air shafts (blue).</div>
<div class="map"><img src="data:image/png;base64,{base64png}"><svg viewBox="0 0 {W} {H}">{svg_layers}</svg></div>
<h2>Sections to scale</h2>{section()}
<h2>Galleries and ruien (40 m or longer)</h2><table><tr><th>Id</th><th>Name</th><th>Kind</th><th>Length m</th><th>Street width m (min / 10%)</th><th>Under house fronts</th><th>Gullies</th><th>Ends</th></tr>{rows}</table>
<p>Wider than the street above (runs under house fronts, as the real ruien do): giant galleries {under['G']} m, ruien {under['M']} m.</p>
<p>Gullies: {coverage['gullies']}; within 40 m of a rui {coverage['within40']}; within 80 m {coverage['within80']}; over 80 m {coverage['over80']} (farthest {coverage['maxM']} m).</p>
</div><script>document.querySelectorAll('[data-l]').forEach(c=>c.onchange=()=>document.getElementById('L_'+c.dataset.l).style.display=c.checked?'':'none')</script></body></html>"""
open(os.path.join(OUT, "ruien-plan.html"), "w", encoding="utf-8").write(html)
open(os.path.join(OUT, "ruien-sections.svg"), "w", encoding="utf-8").write(section().replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ', 1).replace('width="100%"', 'width="1100" height="330"'))

# ---- flat PNG for quick looks ----
for sd in side: d.line([P(x, z) for x, z in sd], fill=(58, 154, 90), width=1)
for r in routes.values():
    k = net["classes"][r["class"]]; col = tuple(int(k["colour"][i:i + 2], 16) for i in (1, 3, 5))
    d.line([P(x, z) for x, z in r["pts"]], fill=col, width=k["stroke"], joint="curve")
for ch in net["chambers"]:
    x0, z0, x1, z1 = ch["rect"]; d.rectangle([P(x1, z0), P(x0, z1)], outline=(176, 32, 58), width=3)
for gt in net["gates"]:
    px, py = P(*gt["at"]); d.rectangle([px - 6, py - 6, px + 6, py + 6], fill=(106, 26, 122) if gt.get("flush") else (176, 32, 58) if gt.get("giant") else (31, 95, 168))
for ac in net["access"]:
    px, py = P(*ac["at"]); d.ellipse([px - 5, py - 5, px + 5, py + 5], fill=(0, 0, 0)); d.text((px + 7, py - 12), ac["id"], fill=(0, 0, 0))
for gt in net["gates"]:
    px, py = P(*gt["at"]); d.text((px + 8, py - 5), gt["id"], fill=(0, 0, 0))
for rid, r in routes.items():
    if r["class"] == "G" or "branch" not in r["name"] and r["lengthM"] >= 40:
        mid = r["pts"][len(r["pts"]) // 2]; px, py = P(*mid)
        for ox, oy in [(-1, 0), (1, 0), (0, -1), (0, 1)]: d.text((px + 6 + ox, py - 12 + oy), r["name"], fill=(255, 255, 255))
        d.text((px + 6, py - 12), r["name"], fill=(110, 10, 30) if r["class"] == "G" else (10, 40, 110))
im.save(os.path.join(OUT, "ruien-plan.png"))
for k_, v in routes.items():
    if v["class"] == "G" or v["lengthM"] >= 40: print(k_, v["name"], v["lengthM"], v["streetWidthMin"], v["streetWidthP10"], v["ends"], v.get("gullies", ""))
print("total G", totG, "M", totM, "S", totS, "under houses", under, coverage)
