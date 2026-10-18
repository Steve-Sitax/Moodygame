"""Issue #28: the Steen's windows over parts with no inside (the gatehouse's upper storeys and gable, the river range's
great hall, the towers and turrets) were opaque leaded panes flush with the wall's face, their picture painted with
reflections: a flat dark picture. Steve stopped the big Blender build of those rooms (2026-09-29) and asked for a cheap
outside fix: closed shutters, or dark glass with a hint of the room behind. Now each pane is set back in a real reveal:
- the glass moves 12 cm into the wall (less where a wall behind leaves less room: rays inward stop 5 cm short), and the
  reveal's four sides join it to the wall's face, in the Steen's sandstone, in shade;
- the glass's picture is clean dark crown glass in diamond cames (each quarry its own shade, a faint ring), no painted
  reflection, on a copy of the Steen's own glass material (the same shader: no new kind; dark at night as before).
  An iron grille in front of a window stays where it was, now clear of the glass.
    python scripts/repair-steen-windows.py <audit folder: audit-facades.gd ... all steen> <candidate folder>
The Steen's two museum boards (the Dutch and French name over the door, the English board with the hours) were 5 x 7
pixel letters in its 256-texel atlas: the atlas is drawn again at 2048 texels, the boards' lettering in Old Standard TT
(SIL OFL, native-godot/fonts), the rest of it the old picture enlarged; a copy of the atlas material carries it.
Writes the candidate (manifest.json: the glass mesh, the glass moved back, the reveals as a second surface; the atlas
mesh on its new material), the glass picture (steen-glass.png) and the atlas (steen-atlas.png, from <old atlas png>).
    python scripts/repair-steen-windows.py <audit folder> <candidate folder> <old atlas png (r001703)>"""
import collections, json, math, pathlib, sys
import numpy as np
from PIL import Image

AUD, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]); OUT.mkdir(parents=True, exist_ok=True)
GLASS_MESH = "res://world/town/resources/r001699.res"
GLASS_MAT = "res://assets/materials/town-facades-20261018/steen-glass.tres"
RECESS = 0.12
ROOM_MAT = "res://world/town/resources/r001672.res"   # steen_sand

def unit(v): v = np.asarray(v, float); n = np.linalg.norm(v); return v / n if n > 1e-12 else v

# ------------------------------------------------------------------ the glass picture (512 px a tile, as the old one's uv)
S = 512
y, x = np.mgrid[0:S, 0:S] / S
u, v = (x + y) * 4, (x - y) * 4               # four diamonds a tile each way
fu, fv = u - np.floor(u), v - np.floor(v)
came = np.minimum(np.minimum(fu, 1 - fu), np.minimum(fv, 1 - fv)) < 0.028
cell = (np.floor(u).astype(int) * 7 + np.floor(v).astype(int) * 13) % 17
tint = 0.75 + 0.5 * (cell / 16.0)
rgb = np.stack([0.035 * tint, 0.05 * tint, 0.047 * tint], -1)
# crown glass: a faint ring and seed bubbles in each quarry
ring = np.sin(np.hypot(fu - 0.5, fv - 0.5) * 30) * 0.08
rgb *= (1 + ring)[..., None]
alpha = np.ones_like(came, dtype=float)
rgb = np.where(came[..., None], np.array([0.06, 0.06, 0.065]), rgb)
srgb = np.where(rgb <= 0.0031308, rgb * 12.92, 1.055 * np.power(np.clip(rgb, 0, 1), 1 / 2.4) - 0.055)
Image.fromarray((np.concatenate([srgb, alpha[..., None]], -1) * 255 + 0.5).astype(np.uint8), "RGBA").save(OUT / "steen-glass.png")

# ------------------------------------------------------------------ the windows and the walls behind them
glass = np.fromfile(AUD / "source/r001699-0.bin", dtype=np.float32).reshape(-1, 3, 16)
# the building's surfaces (not the glass, the window lights or the iron bars in front of the windows)
walls = np.concatenate([np.fromfile(f, dtype=np.float32).reshape(-1, 3, 16)[:, :, :3] for f in sorted((AUD / "source").glob("*.bin"))
                        if not any(k in f.name for k in ("r001699", "r001693", "r001701", "r001715", "r001717"))])
# the brick's uv scale (texture units per metre), from its own triangles
brick = np.fromfile(AUD / "source/r001673-0.bin", dtype=np.float32).reshape(-1, 3, 16)
d_uv = np.linalg.norm(brick[:, 1, 6:8] - brick[:, 0, 6:8], axis=1); d_p = np.linalg.norm(brick[:, 1, :3] - brick[:, 0, :3], axis=1)
UVK = float(np.median(d_uv[d_p > 0.05] / d_p[d_p > 0.05]))

def ray_hits(o, d, tri):
    """Distances along d from o to the triangles (Moller-Trumbore), inf where none."""
    e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
    p = np.cross(d, e2); det = np.einsum("ij,ij->i", e1, p)
    ok = np.abs(det) > 1e-9; inv = np.where(ok, 1 / np.where(ok, det, 1), 0)
    s = o - tri[:, 0]; uu = np.einsum("ij,ij->i", s, p) * inv
    q = np.cross(s, e1); vv = (q @ d) * inv; t = np.einsum("ij,ij->i", e2, q) * inv
    hit = ok & (uu >= 0) & (vv >= 0) & (uu + vv <= 1) & (t > 1e-4)
    return np.where(hit, t, np.inf)

# windows: glass triangles grouped by plane and touching
key = lambda t: (tuple(np.round(t[0, 3:6], 2)), round(float(np.dot(t[0, :3], t[0, 3:6])), 2))
groups = collections.defaultdict(list)
for i, t in enumerate(glass): groups[key(t)].append(i)
windows = []
for k, idx in groups.items():
    left = set(idx)
    while left:
        seed = left.pop(); comp = [seed]; stack = [seed]
        while stack:
            a = stack.pop()
            for b in list(left):
                if min(np.linalg.norm(glass[a, i, :3] - glass[b, j, :3]) for i in range(3) for j in range(3)) < 1e-3:
                    left.remove(b); comp.append(b); stack.append(b)
        windows.append(comp)

rows_room, report = [], collections.Counter()
def tri(rows, ps, n, uvs, shade):
    a, b, c = ps
    if np.linalg.norm(np.cross(b - a, c - a)) < 1e-10: return
    r = [[*p, *n, *t, 0.0, 0.0, shade, shade, shade, 1.0, 0.0, 0.0] for p, t in zip(ps, uvs)]
    if np.dot(np.cross(c - a, b - a), n) < 0: r[1], r[2] = r[2], r[1]
    rows += r
for comp in windows:
    T = glass[comp]; n = unit(T[0, 0, 3:6])  # (the glass faces out of the building)
    pts = T[:, :, :3].reshape(-1, 3)
    up = np.array([0.0, 1.0, 0.0]); ax = unit(np.cross(up, n))
    # the window's outline in its plane: the boundary edges of its triangles
    edges = collections.Counter()
    P = {}
    for t in T:
        ks = [tuple(np.round(p[:3], 4)) for p in t]
        for a, b in ((0, 1), (1, 2), (2, 0)):
            e = tuple(sorted((ks[a], ks[b]))); edges[e] += 1
    border = [e for e, c in edges.items() if c == 1]
    if not border: continue
    centre = pts.mean(0)
    w = max(np.ptp(pts @ ax), 0.05); h = max(np.ptp(pts[:, 1]), 0.05)
    # how deep the room may go: rays inward from the window's centre and corners, 5 cm short of the first wall
    probes = [centre] + [np.array(p) * 0.85 + centre * 0.15 for e in border[:: max(1, len(border) // 6)] for p in e[:1]]
    depth = RECESS + 0.07
    for o in probes:
        t = ray_hits(np.asarray(o) - n * 0.02, -n, walls).min()
        depth = min(depth, t - 0.07)
    depth -= 0.07
    if depth < 0.04: report["too thin a wall: left flush"] += 1; continue
    report["windows"] += 1
    back = -n * depth
    for (a, b) in border:
        a, b = np.array(a), np.array(b)
        # the reveal: from the glass edge back to the room's back wall, facing into the opening
        q = [a, b, b + back, a + back]
        fn = unit(np.cross(q[1] - q[0], q[3] - q[0]))
        mid = (a + b) / 2
        if np.dot(fn, centre - mid) < 0: fn = -fn
        floor = fn[1] > 0.5
        sh = 0.55 if floor else 0.42
        uvs = [(np.dot(p, ax) * UVK, p[1] * UVK + np.dot(p, n) * UVK) for p in q]
        tri(rows_room, (q[0], q[1], q[2]), fn, uvs[:3], sh); tri(rows_room, (q[0], q[2], q[3]), fn, (uvs[0], uvs[2], uvs[3]), sh)
    # the glass itself, moved back
    for i in comp: glass[i, :, :3] += back
    report["recess cm"] += round(depth * 100)

glass.reshape(-1).astype(np.float32).tofile(OUT / "r001699-glass.bin")
np.asarray(rows_room, np.float32).tofile(OUT / "r001699-rooms.bin")
surfs = [{"file": "r001699-glass.bin", "material": GLASS_MAT, "custom0": False, "vertices": len(glass) * 3},
         {"file": "r001699-rooms.bin", "material": ROOM_MAT, "custom0": False, "vertices": len(rows_room), "noCollision": True}]
src_hash = json.loads((AUD / "audit.json").read_text()) if (AUD / "audit.json").stat().st_size > 10 else []
h = next((r["meshHash"] for r in src_hash if r["mesh"] == GLASS_MESH), None)
manifest = {GLASS_MESH: {"node": "steen_glass", "sourceHash": h, "surfaces": surfs}}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
print(dict(report), "stone uv per metre", round(UVK, 3), "reveal triangles", len(rows_room) // 3)

# ------------------------------------------------------------------ the museum boards, sharp
from PIL import ImageDraw, ImageFont
FONT = str(pathlib.Path(__file__).resolve().parents[1] / "fonts/old-standard-tt-latin-700-normal.woff2")
old = Image.open(sys.argv[3]).convert("RGB")
K = 8
big = old.resize((256 * K, 256 * K), Image.BICUBIC)
d = ImageDraw.Draw(big)
def board(box, lines, fg, bg, rule=None):
    x0, y0, x1, y1 = [v * K for v in box]
    d.rectangle((x0 + 3 * K, y0 + 3 * K, x1 - 3 * K, y1 - 3 * K), fill=bg)
    n = len(lines); lh = (y1 - y0 - 6 * K) / (n + 0.25)
    for i, (text, size) in enumerate(lines):
        f = ImageFont.truetype(FONT, int(lh * size))
        w = d.textlength(text, font=f)
        while w > (x1 - x0) * 0.92 or f.getbbox("H")[3] - f.getbbox("H")[1] > lh * 0.78: f = ImageFont.truetype(FONT, int(f.size * 0.95)); w = d.textlength(text, font=f)
        bb = f.getbbox("H"); y = y0 + 3 * K + lh * (i + 0.12) + (lh - (bb[3] - bb[1])) / 2 - bb[1]
        d.text(((x0 + x1 - w) / 2, y), text, font=f, fill=fg)
    if rule: d.line((x0 + (x1 - x0) * 0.3, y0 + rule * K, x1 - (x1 - x0) * 0.3, y0 + rule * K), fill=fg, width=max(2, K // 2))
px = lambda c: tuple(int(v) for v in np.asarray(old.getpixel(c)))
board((96, 0, 224, 24), [("MUSEUM VAN OUDHEDEN", 1.45), ("MUSÉE D'ANTIQUITÉS", 1.45)], px((100, 12)) if False else (40, 36, 30), px((98, 2)))
board((96, 24, 224, 88), [("MUSEUM OF", 1.1), ("ANTIQUITIES", 1.1), ("OPEN 10 - 4", 0.95)], (225, 222, 205), (24, 38, 30), rule=None)
big.save(OUT / "steen-atlas.png")
audit = json.loads((AUD / "audit.json").read_text())
ra = next(r for r in audit if r["node"] == "steen_atlas")
rows = np.fromfile(AUD / "source" / ra["surfaces"][0]["file"], dtype=np.float32)
rows.tofile(OUT / "r001707-atlas.bin")
manifest[ra["mesh"]] = {"node": "steen_atlas", "sourceHash": ra["meshHash"], "surfaces": [{"file": "r001707-atlas.bin", "material": "res://assets/materials/town-facades-20261018/steen-atlas.tres", "custom0": ra["surfaces"][0]["custom0"], "vertices": len(rows) // 16}]}
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
print("museum boards drawn")
