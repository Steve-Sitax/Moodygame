"""Read a hand-painted Ruien plan (a ruien-plan.png painted over in its own colours) back into lines and chambers.

python -I tools/ruien/trace.py <painted.png> <out.json> <city.json> <walk.png>

The picture must have ruien-plan.png's frame: 2 px per metre, north up, top edge x 340, left edge z -80.
Red (176,32,58) is a giant gallery, blue (31,95,168) a rui. Thick patches of either colour are rooms; a patch within 8 m of water is a gate.
Out: {"lines": [{"class": "G"|"M", "pts": [[x, z], ...]}], "chambers": [{"class", "centre", "rect"}]} in world metres."""
import json, sys
import numpy as np
from PIL import Image
from scipy import ndimage

S, X1, Z0 = 2, 340, -80
a = np.array(Image.open(sys.argv[1]).convert("RGB")).astype(int)[:, :1100]
near = lambda c, t=18: np.abs(a - np.array(c)).sum(-1) < t
red, blue = near((176, 32, 58)), near((31, 95, 168))
paint = red | blue
paint = ndimage.binary_closing(paint, np.ones((3, 3)), iterations=3) | paint  # bridge the gaps left by labels
walk = json.load(open(sys.argv[3]))["walk"] if len(sys.argv) > 3 else None
WX0, WZ0, WR = (walk["x0"], walk["z0"], walk["res"]) if walk else (0, 0, 1)
water = (np.array(Image.open(sys.argv[4]))[..., 1] > 0) if len(sys.argv) > 4 else np.zeros((1, 1), bool)
world = lambda r, c: [round(float(X1 - r / S), 1), round(float(c / S + Z0), 1)]

# ---- chambers: patches much thicker than a stroke ----
edt = ndimage.distance_transform_edt(paint)
cores, n = ndimage.label(edt >= 4.5)
chambers, blob = [], np.zeros_like(paint)
for i in range(1, n + 1):
    core = cores == i
    if core.sum() < 10: continue
    thick = edt[core].max(); top = np.unravel_index(np.argmax(np.where(core, edt, 0)), edt.shape)
    inner, _ = ndimage.label(edt >= 0.6 * thick); inner = inner == inner[top]
    body = ndimage.binary_dilation(inner, iterations=max(1, int(0.6 * thick))) & paint
    region = ndimage.binary_dilation(body, iterations=3) & paint
    rr, cc = np.nonzero(body)
    h_, w_ = np.ptp(rr) + 1, np.ptp(cc) + 1
    kind = "G" if red[region].mean() > blue[region].mean() else "M"
    cr, cc_ = rr.mean(), cc.mean(); wx, wz = X1 - cr / S, cc_ / S + Z0
    wet = water[max(0, int((wx - WX0) / WR) - 16):int((wx - WX0) / WR) + 17, max(0, int((wz - WZ0) / WR) - 16):int((wz - WZ0) / WR) + 17].any()
    gate = bool(wet or wz < 6)
    lean = max(h_, w_) > 3 * min(h_, w_) or body.sum() < 0.4 * h_ * w_
    if lean and not (kind == "M" and thick >= 6): continue  # two red strokes side by side, not a room (blue strokes are too thin for that)
    if kind == "G" and thick < 6.5 and not gate: continue  # where red strokes cross or overlap
    blob |= region
    chambers.append({"class": kind, "gate": gate, "centre": world(rr.mean(), cc.mean()),
                     "rect": [world(rr.max(), cc.min())[0], world(rr.max(), cc.min())[1], world(rr.min(), cc.max())[0], world(rr.min(), cc.max())[1]],
                     "_mask": region})

# ---- strokes: thin to one pixel (Zhang-Suen) ----
def thin(img):
    img = img.copy().astype(np.uint8)
    while True:
        changed = False
        for step in (0, 1):
            p = np.pad(img, 1)
            P2, P3, P4, P5 = p[:-2, 1:-1], p[:-2, 2:], p[1:-1, 2:], p[2:, 2:]
            P6, P7, P8, P9 = p[2:, 1:-1], p[2:, :-2], p[1:-1, :-2], p[:-2, :-2]
            nb = [P2, P3, P4, P5, P6, P7, P8, P9]
            B = sum(nb)
            A = sum(((nb[k] == 0) & (nb[(k + 1) % 8] == 1)) for k in range(8))
            c1 = (P2 * P4 * P6 == 0) if step == 0 else (P2 * P4 * P8 == 0)
            c2 = (P4 * P6 * P8 == 0) if step == 0 else (P2 * P6 * P8 == 0)
            kill = (img == 1) & (B >= 2) & (B <= 6) & (A == 1) & c1 & c2
            if kill.any(): img[kill] = 0; changed = True
        if not changed: return img.astype(bool)

sk = thin(paint)
nbr = lambda r, c: [(r + dr, c + dc) for dr in (-1, 0, 1) for dc in (-1, 0, 1) if (dr or dc) and 0 <= r + dr < sk.shape[0] and 0 <= c + dc < sk.shape[1] and sk[r + dr, c + dc]]
pix = set(zip(*np.nonzero(sk)))
in_blob = lambda p: blob[p]
ring = [(-1, 0), (-1, 1), (0, 1), (1, 1), (1, 0), (1, -1), (0, -1), (-1, -1)]
def crossings(r, c):  # 2 on a plain stroke, 1 at an end, 3 or more at a junction
    v = [(r + dr, c + dc) in pix for dr, dc in ring]
    return sum(v[k] and not v[(k + 1) % 8] for k in range(8))
nodes = {p for p in pix if crossings(*p) != 2 or in_blob(p)}
lines, done = [], set()
for s in nodes:
    for q in nbr(*s):
        if q in done and q not in nodes: continue
        path = [s, q]
        while path[-1] not in nodes:
            done.add(path[-1])
            nxt = [t for t in nbr(*path[-1]) if t not in path and (t not in done or t in nodes)]
            if not nxt: break
            nxt.sort(key=lambda t: (t not in nodes, abs(t[0] - path[-1][0]) + abs(t[1] - path[-1][1])))
            path.append(nxt[0])
        if all(in_blob(p) for p in path): continue
        key = frozenset((path[0], path[-1], len(path)))
        if key in done: continue
        done.add(key); lines.append(path)

def simplify(pts, tol):
    if len(pts) < 3: return pts
    a_, b_ = np.array(pts[0], float), np.array(pts[-1], float); ab = b_ - a_; L = np.hypot(*ab) or 1
    d = [abs(ab[0] * (p[1] - a_[1]) - ab[1] * (p[0] - a_[0])) / L for p in pts]
    k = int(np.argmax(d))
    if d[k] <= tol: return [pts[0], pts[-1]]
    return simplify(pts[:k + 1], tol)[:-1] + simplify(pts[k:], tol)

def centre_of(p):
    for ch in chambers:
        if ch["_mask"][p]: return ch
    return None

d_red, d_blue = ndimage.distance_transform_edt(~red), ndimage.distance_transform_edt(~blue)
out = []
for path in lines:
    core = [p for p in path if not in_blob(p)]
    if len(core) < 8: continue  # spurs and label crumbs
    ix = tuple(np.array(core).T)
    lab_ = (d_red[ix] <= d_blue[ix]).astype(float)  # 1 where the nearest paint is red
    lab_ = ndimage.median_filter(lab_, size=9, mode="nearest") > 0.5
    runs, start = [], 0
    for k in range(1, len(core) + 1):
        if k == len(core) or lab_[k] != lab_[start]: runs.append((start, k)); start = k
    merged = []  # a run under 6 px joins its neighbour; the joined run takes the colour of most of its pixels
    for r0, r1 in runs:
        if merged and (r1 - r0 < 6 or merged[-1][1] - merged[-1][0] < 6): merged[-1] = (merged[-1][0], r1)
        else: merged.append((r0, r1))
    merged = [(r0, r1, bool(lab_[r0:r1].mean() > 0.5)) for r0, r1 in merged]
    for j, (r0, r1, is_red) in enumerate(merged):
        seg = core[max(0, r0 - 1):r1]
        pts = [world(r, c) for r, c in simplify(seg, 1.5)]
        if j == 0 and in_blob(path[0]) and centre_of(path[0]): pts.insert(0, centre_of(path[0])["centre"])
        if j == len(merged) - 1 and in_blob(path[-1]) and centre_of(path[-1]): pts.append(centre_of(path[-1])["centre"])
        out.append({"class": "G" if is_red else "M", "pts": pts})
def samples(pts, step=2.0):
    for p, q in zip(pts, pts[1:]):
        L = max(np.hypot(q[0] - p[0], q[1] - p[1]), 1e-6)
        for t in np.arange(0, L, step): yield np.array(p) + (np.array(q) - np.array(p)) * t / L
def gap(pt, pts):
    best = 1e9
    for p, q in zip(pts, pts[1:]):
        p, q = np.array(p), np.array(q); ab = q - p
        t = np.clip(np.dot(pt - p, ab) / max(np.dot(ab, ab), 1e-9), 0, 1); best = min(best, float(np.hypot(*(pt - p - t * ab))))
    return best
giants = [l["pts"] for l in out if l["class"] == "G"]
def shadowed(l):  # an old blue line left beside a red one painted over it
    sm = list(samples(l["pts"]))
    return l["class"] == "M" and sm and np.mean([min(gap(p_, g) for g in giants) < 5 for p_ in sm]) > 0.7
out = [l for l in out if not shadowed(l)]
for ch in chambers: ch.pop("_mask")
json.dump({"_about": f"Traced from {sys.argv[1].replace(chr(92), '/').split('/')[-1]} by tools/ruien/trace.py", "lines": out, "chambers": chambers},
          open(sys.argv[2], "w"), indent=1)
print(len(out), "lines", sum(l["class"] == "G" for l in out), "giant;", len(chambers), "patches")
for c in chambers: print(" ", c["class"], "gate" if c["gate"] else "room", c["centre"], c["rect"])
