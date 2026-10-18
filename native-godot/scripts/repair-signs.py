"""Issue #175: the town's street name plates, shop boards, painted lettering and hanging trade signs, rebuilt. Usage:
    python scripts/sign_art.py <art>; python scripts/repair-signs.py <audit folder> <art> <candidate folder>
The audit is audit-facades.gd's export of the streetlife root (suffixes 0,1: each block's solid and wall-decal meshes).
The bake drew a plate as a 16 mm box with a 11-texel picture of its name on the front (cell plate_i of the streetlife
atlas), a shop board as a 50 mm box with the trade's 11- or 20-texel picture and two trims, lettering on plaster as one
quad of the decal atlas. Each is found by its front's atlas cell (the bake's streetlife meta lists the cells), taken out
with the trims and iron of its box, and built again at the same place and size:
- a plate: pressed enamelled iron, a rolled rim 8 mm proud with rounded corners, the face 5 mm off the wall, two domed
  screws through the holes at its ends; the name in sharp capitals from sign_art.py's picture, chipped to rust at the rim
  and the screws;
- a board: a 25 mm painted panel on the wall, the lettering from sign_art.py, a moulded cornice over it with a weathered
  top (a drip edge), a bead under it and returned ends, in the board's own ground colour, a gilt bead on a gilt board;
- painted lettering: the same quad, its picture from sign_art.py (letters.png), on a copy of the wall-decal material.
The hanging signs (wrought-iron bracket and the trade's sign: boot, pretzel, key, tankard, basin, hat) come from
build_signs.py (see there) and are placed where the bake's stood.
Writes manifest.json (each changed mesh as rows, world space, and its new surfaces), report.json and signs.json (every
sign: kind, text, place)."""
import collections, json, math, pathlib, sys
import numpy as np

AUD, ART, OUT = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2]), pathlib.Path(sys.argv[3])
OUT.mkdir(parents=True, exist_ok=True)
ROOT = pathlib.Path(__file__).resolve().parents[1]
META = json.loads(json.loads((ROOT / "assets/game-models/streetlife.extras.json").read_text())["streetlife_meta"]["meta"])
LAY = json.loads((ART / "layout.json").read_text())
SIGNS_MAT = "res://assets/materials/town-facades-20261018/signs.tres"
LETTERS_MAT = "res://assets/materials/town-facades-20261018/letters.tres"
NAMES = META["streetNames"][:META["plates"]]
TRADES = {t["sign"]: t for t in META["trades"]}
GILT = set()  # boards whose letters are gilt get a gilt bead (sign_art.py: fg brighter than 1.9 in sum)

def cellmap(at):
    W, H = at["size"]; return [(n, x / W, y / H, (x + w) / W, (y + h) / H) for n, (x, y, w, h) in at["cells"].items()]
SOL, DEC = cellmap(META["solid"]), cellmap(META["decal"])
def which(cells, uv):
    u, v = uv.mean(0)
    for name, x0, y0, x1, y1 in cells:
        if x0 <= u <= x1 and y0 <= v <= y1: return name
    return None
def unit(v): v = np.asarray(v, float); return v / np.linalg.norm(v)

class Rows:
    def __init__(self): self.rows = []
    def tri(self, a, b, c, n, uvs, shade=1.0):
        if np.linalg.norm(np.cross(b - a, c - a)) < 1e-12: return
        rows = [[*p, *n, *uv, 0.0, 0.0, shade, shade, shade, 1.0, 0.0, 0.0] for p, uv in zip((a, b, c), uvs)]
        if np.dot(np.cross(c - a, b - a), n) < 0: rows[1], rows[2] = rows[2], rows[1]
        self.rows += rows
    def quad(self, p, n, uvs, shade=1.0):
        self.tri(p[0], p[1], p[2], n, uvs[:3], shade); self.tri(p[0], p[2], p[3], n, (uvs[0], uvs[2], uvs[3]), shade)

def cell_uv(name, u, v, lay=LAY):
    x0, y0, x1, y1 = lay["cells"][name]
    return (x0 + (x1 - x0) * min(max(u, 0), 1), y0 + (y1 - y0) * (1 - min(max(v, 0), 1)))

def frame_of(q, uv):
    """A front quad's corners from its cell-local uv: origin (u 0, v 0, the lower left seen from the street), along, up."""
    u, v = uv[:, 0], uv[:, 1]
    # (atlas v runs down: the picture's bottom row is the larger v)
    c00 = q[np.argmin((u - u.min()) ** 2 + (v - v.max()) ** 2)]; c10 = q[np.argmin((u - u.max()) ** 2 + (v - v.max()) ** 2)]
    c01 = q[np.argmin((u - u.min()) ** 2 + (v - v.min()) ** 2)]
    return c00, c10 - c00, c01 - c00

# ------------------------------------------------------------------ the new pieces (local: x along, y up, z out of the wall)
def rounded_rect(L, H, r, seg=4):
    pts = []
    for cx, cy, a0 in ((L - r, r, -90), (L - r, H - r, 0), (r, H - r, 90), (r, r, 180)):
        for k in range(seg + 1):
            a = math.radians(a0 + 90 * k / seg); pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def plate(out, P, L, H, i):
    """Enamelled iron plate: rolled rim, flat face, two screws. P(x, y, z) -> world; out: Rows."""
    name = f"plate_{i}"
    def uvp(x, y): return cell_uv(name, x / L, y / H)
    # rings: (inset, z) from the wall to the face: the rim rolls up 8 mm and down to the 5 mm face
    rings = [(0.0, 0.0015), (0.0, 0.006), (0.0035, 0.0085), (0.008, 0.0065), (0.012, 0.005)]
    outlines = []
    for inset, z in rings:
        pts = rounded_rect(L - 2 * inset, H - 2 * inset, max(0.004, 0.014 - inset))
        outlines.append([(x + inset, y + inset, z) for x, y in pts])
    for a, b in zip(outlines, outlines[1:]):
        for k in range(len(a)):
            p0, p1, q1, q0 = a[k], a[(k + 1) % len(a)], b[(k + 1) % len(a)], b[k]
            W = [P(*p) for p in (p0, p1, q1, q0)]
            n = unit(np.cross(W[1] - W[0], W[3] - W[0]))
            ctr = P(L / 2, H / 2, -0.05)
            if np.dot(n, (W[0] + W[2]) / 2 - ctr) < 0: n = -n
            if a is outlines[0]:  # the edge: plain enamel
                uvs = [cell_uv("enamel_white", 0.2, 0.2), cell_uv("enamel_white", 0.8, 0.2), cell_uv("enamel_white", 0.8, 0.8), cell_uv("enamel_white", 0.2, 0.8)]
            else:
                uvs = [uvp(p[0], p[1]) for p in (p0, p1, q1, q0)]
            out.quad(W, n, uvs, 0.92 if a is outlines[0] else 1.0)
    face = outlines[-1]; nf = unit(P(0, 0, 1) - P(0, 0, 0))
    c = (L / 2, H / 2, rings[-1][1])
    for k in range(len(face)):
        p0, p1 = face[k], face[(k + 1) % len(face)]
        out.tri(P(*c), P(*p0), P(*p1), nf, (uvp(c[0], c[1]), uvp(p0[0], p0[1]), uvp(p1[0], p1[1])))
    # the screws: low domes with a slot, at the holes 0.045 H from each end
    for sx in (0.045 * H, L - 0.045 * H):
        ring0 = [(sx + 0.0065 * math.cos(a), H / 2 + 0.0065 * math.sin(a), 0.005) for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
        ring1 = [(sx + 0.0045 * math.cos(a), H / 2 + 0.0045 * math.sin(a), 0.0075) for a in np.linspace(0, 2 * math.pi, 9)[:-1]]
        top = (sx, H / 2, 0.0085)
        iu = [cell_uv("iron_black", 0.3, 0.3), cell_uv("iron_black", 0.7, 0.3), cell_uv("iron_black", 0.7, 0.7), cell_uv("iron_black", 0.3, 0.7)]
        for k in range(8):
            W = [P(*ring0[k]), P(*ring0[(k + 1) % 8]), P(*ring1[(k + 1) % 8]), P(*ring1[k])]
            n = unit(np.cross(W[1] - W[0], W[3] - W[0]));
            if np.dot(n, W[0] - P(sx, H / 2, 0.0)) < 0: n = -n
            out.quad(W, n, iu, 0.9)
            out.tri(P(*top), P(*ring1[k]), P(*ring1[(k + 1) % 8]), nf, iu[:3], 0.8 if k in (0, 4) else 1.0)

def extrude(out, P, prof, x0, x1, cellname, shade=1.0, caps=True):
    """A moulding: profile [(z, y)] (from the wall out and round) run along x from x0 to x1, its ends closed."""
    uv = lambda u, v: cell_uv(cellname, u, v)
    for (za, ya), (zb, yb) in zip(prof, prof[1:]):
        W = [P(x0, ya, za), P(x1, ya, za), P(x1, yb, zb), P(x0, yb, zb)]
        n = unit(np.cross(W[1] - W[0], W[3] - W[0]))
        mid = np.array([0.0, (ya + yb) / 2, (za + zb) / 2]); d = np.array([0.0, yb - ya, zb - za]); nl = np.array([0.0, d[2], -d[1]])
        # (outward: away from the profile's own centre)
        cz, cy = np.mean([p[0] for p in prof]), np.mean([p[1] for p in prof])
        if np.dot(nl, mid - np.array([0.0, cy, cz])) < 0: pass
        if np.dot(n, P(0, (ya + yb) / 2, (za + zb) / 2) - P(0, cy, cz)) < 0: n = -n
        k = 0.75 if n[1] < -0.5 else 1.0
        out.quad(W, n, [uv(0.1, 0.1), uv(0.9, 0.1), uv(0.9, 0.9), uv(0.1, 0.9)], shade * k)
    if caps:
        for x, s in ((x0, -1), (x1, 1)):
            n = unit(P(s, 0, 0) - P(0, 0, 0)); cz, cy = np.mean([p[0] for p in prof]), np.mean([p[1] for p in prof])
            for (za, ya), (zb, yb) in zip(prof, prof[1:]):
                out.tri(P(x, cy, cz), P(x, ya, za), P(x, yb, zb), n, (uv(0.5, 0.5), uv(0.2, 0.2), uv(0.8, 0.8)), shade * 0.9)

def board(out, P, L, H, key, gilt):
    """The shop board: the lettered panel, a cornice over it, a bead under it, returned ends."""
    sign, frame = f"board_{key}", f"frame_{key}"
    zf, zb = 0.06, 0.035  # the panel's face and back off the wall
    out.quad([P(0, 0, zf), P(L, 0, zf), P(L, H, zf), P(0, H, zf)], unit(P(0, 0, 1) - P(0, 0, 0)),
             [cell_uv(sign, 0, 0), cell_uv(sign, 1, 0), cell_uv(sign, 1, 1), cell_uv(sign, 0, 1)])
    for y in (0.0, H):  # the panel's top and bottom edges (the mouldings hide most of them)
        pass
    e = 0.05
    cornice = [(0.0, H), (zf + 0.005, H), (zf + 0.012, H + 0.012), (zf + 0.042, H + 0.022), (zf + 0.046, H + 0.034),
               (zf + 0.040, H + 0.040), (0.0, H + 0.062)]
    extrude(out, P, cornice, -e, L + e, frame, 1.0)
    bead = [(0.0, 0.0), (zf + 0.004, 0.0), (zf + 0.018, -0.008), (zf + 0.02, -0.022), (zf + 0.008, -0.034), (0.0, -0.034)]
    extrude(out, P, bead, -e, L + e, "gilt" if gilt else frame, 1.0)
    for xa, xb in ((-e, 0.0), (L, L + e)):  # the returned ends: a plain upright between the mouldings
        prof = [(0.0, 0.0), (zf + 0.012, 0.0), (zf + 0.012, H), (0.0, H)]
        for (za, ya), (zz, yy) in zip(prof, prof[1:]):
            pass
        W = [P(xa, 0, zf + 0.012), P(xb, 0, zf + 0.012), P(xb, H, zf + 0.012), P(xa, H, zf + 0.012)]
        out.quad(W, unit(P(0, 0, 1) - P(0, 0, 0)), [cell_uv(frame, 0.1, 0.1), cell_uv(frame, 0.9, 0.1), cell_uv(frame, 0.9, 0.9), cell_uv(frame, 0.1, 0.9)])
        xo = xa if xa < 0 else xb
        s = -1 if xa < 0 else 1
        W = [P(xo, 0, 0), P(xo, 0, zf + 0.012), P(xo, H, zf + 0.012), P(xo, H, 0)]
        out.quad(W, unit(P(s, 0, 0) - P(0, 0, 0)), [cell_uv(frame, 0.1, 0.1), cell_uv(frame, 0.9, 0.1), cell_uv(frame, 0.9, 0.9), cell_uv(frame, 0.1, 0.9)], 0.85)
        xi = xb if xa < 0 else xa  # the inner face toward the panel
        W = [P(xi, 0, zf), P(xi, 0, zf + 0.012), P(xi, H, zf + 0.012), P(xi, H, zf)]
        out.quad(W, unit(P(-s, 0, 0) - P(0, 0, 0)), [cell_uv(frame, 0.1, 0.1), cell_uv(frame, 0.9, 0.1), cell_uv(frame, 0.9, 0.9), cell_uv(frame, 0.1, 0.9)], 0.8)

IRON_MAT = "res://world/town/resources/r000615.res"
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import build_signs
HANG = {k: build_signs.hanging(k) for k in build_signs.SIGNS}

def add_hang(signs_rows, iron_rows, P, kind):
    """The hanging sign's parts into the block's rows: the iron (metric uv) on the wall iron, the rest on the signs picture."""
    o = P(0, 0, 0)
    for mat, tris in HANG[kind].tris.items():
        for ps, ns, uvs in tris:
            W = [P(*p) for p in ps]; N = [unit(P(*(p + n)) - P(*p)) for p, n in zip(ps, ns)]
            if mat == "iron": uv = [tuple(u) for u in uvs]
            else: uv = [cell_uv(mat, 0.2 + 0.6 * (abs(u[0]) % 1.0), 0.2 + 0.6 * (abs(u[1] * 3) % 1.0)) for u in uvs]
            rows = iron_rows if mat == "iron" else signs_rows
            if np.linalg.norm(np.cross(W[1] - W[0], W[2] - W[0])) < 1e-12: continue
            r = [[*w, *n, *t, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0] for w, n, t in zip(W, N, uv)]
            fn = np.cross(W[2] - W[0], W[1] - W[0])
            if np.dot(fn, N[0] + N[1] + N[2]) < 0: r[1], r[2] = r[2], r[1]
            rows.rows += r

# ------------------------------------------------------------------ the bake's signs, and their replacement
SIGN_GILT = json.loads((ART / "gilt.json").read_text()) if (ART / "gilt.json").exists() else {}
audit = json.loads((AUD / "audit.json").read_text())
METAL = ("iron", "gold", "pewter", "brass", "black", "red_paint")

def find_hangs(signs):
    """The bake's hanging signs: a cluster of metal 0.35-1.12 m off a sign's wall, within 14 m of it along the wall and
    1.3 m of its height; its kind from its colours (pewter: a tankard; brass: a basin; red paint: a hat; a little black: a
    boot; much gilt: a pretzel; else a key). Returns {mesh: [(triangle indices, frame)]}."""
    out, seen = collections.defaultdict(list), []
    for rec in audit:
        if not rec["node"].endswith(",0"): continue
        for s in rec["surfaces"]:
            T = np.fromfile(AUD / "source" / s["file"], dtype=np.float32).reshape(-1, 3, 16)
            names = [which(SOL, t[:, 6:8]) for t in T]
            metal = np.array([n in METAL for n in names]); C = T[:, :, :3].mean(1)
            for sg in signs:
                if sg["kind"] == "plate": continue
                nrm, ex, foot = np.array(sg["wall"]), np.array(sg["along"]), np.array(sg["foot"])
                rel = C - foot; a, up, o = rel @ ex, C[:, 1] - foot[1], rel @ nrm
                sel = metal & (o > 0.35) & (o < 1.12) & (np.abs(a - sg["size"][0] / 2) < 14) & (np.abs(up) < 1.3)
                idx = np.where(sel)[0]
                if not len(idx): continue
                idx = idx[np.argsort(a[idx])]; groups = [[idx[0]]]
                for i in idx[1:]:
                    (groups[-1].append(i) if a[i] - a[groups[-1][-1]] < 0.3 else groups.append([i]))
                for g in groups:
                    g = np.array(g)
                    cells = collections.Counter(names[i] for i in g)
                    if len(g) < 20 or not cells.get("gold") and not cells.get("pewter") and not cells.get("brass"): continue
                    sa = float(np.median(a[g])); centre = foot + ex * sa
                    if any(np.linalg.norm(centre - c) < 0.5 for c in seen): continue
                    seen.append(centre)
                    top, low = float(up[g].max()), float(up[g].min())
                    kind = ("tankard" if cells.get("pewter", 0) > 50 else "basin" if cells.get("brass", 0) > 50 else "hat" if cells.get("red_paint")
                            else "boot" if cells.get("black") else "pretzel" if cells.get("gold", 0) >= 240 else "key")
                    box = metal & (np.abs(a - sa) < 0.32) & (up > low - 0.06) & (up < top + 0.1) & (o > -0.012) & (o < 1.16)
                    out[rec["mesh"]].append((np.where(box)[0], {"kind": kind, "s": sa, "top": top - 0.008, "foot": foot, "ex": ex, "n": nrm, "near": sg.get("key")}))
    return out

def build(hangs):
  manifest, report, signs = {}, collections.Counter(), []
  for rec in audit:
      solid = rec["node"].endswith(",0")
      surfs, new, iron = [], Rows(), Rows()
      for s in rec["surfaces"]:
          T = np.fromfile(AUD / "source" / s["file"], dtype=np.float32).reshape(-1, 3, 16)
          names = [which(SOL if solid else DEC, t[:, 6:8]) for t in T]
          centre = T[:, :, :3].mean(1)
          drop = np.zeros(len(T), bool)
          fronts = collections.defaultdict(list)
          for k, n in enumerate(names):
              if n and (n.startswith("plate_") or n.startswith("board_") or n.startswith("letters_")): fronts[n].append(k)
          for n, ks in fronts.items():
              # pair the front triangles into quads (two with one normal sharing two corners)
              left = list(ks)
              while left:
                  k = left.pop(0)
                  share = [j for j in left if np.dot(T[j, 0, 3:6], T[k, 0, 3:6]) > 0.999 and sum(np.min(np.linalg.norm(T[j, :, :3] - p[:3], axis=1)) < 1e-3 for p in T[k]) >= 2]
                  if not share: report["unpaired " + n.split("_")[0]] += 1; continue
                  j = share[0]; left.remove(j)
                  pts = np.concatenate([T[k], T[j]]); q = np.unique(np.round(pts[:, :3], 4), axis=0)
                  uvq = np.array([pts[np.argmin(np.linalg.norm(pts[:, :3] - p, axis=1)), 6:8] for p in q])
                  o, along, up = frame_of(q, uvq)
                  L, H = float(np.linalg.norm(along)), float(np.linalg.norm(up)); ex, ey = along / L, up / H
                  nrm = unit(T[k, 0, 3:6])
                  depth = 0.016 if n.startswith("plate_") else 0.07 if n.startswith("board_") else 0.0
                  wall = o - nrm * depth
                  P = lambda x, y, z, wall=wall, ex=ex, ey=ey, nrm=nrm: wall + ex * x + ey * y + nrm * z
                  # take out the box: its front, sides, back and trims (plate: iron; board: dark wood or gilt trims)
                  rel = centre - wall
                  a, b, c = rel @ ex, rel @ ey, rel @ nrm
                  if n.startswith("plate_"):
                      box = (a > -0.004) & (a < L + 0.004) & (b > -0.004) & (b < H + 0.004) & (c > -0.004) & (c < 0.02)
                      ok = np.array([m in (n, "iron") for m in names])
                  elif n.startswith("board_"):
                      box = (a > -0.06) & (a < L + 0.06) & (b > -0.07) & (b < H + 0.07) & (c > -0.004) & (c < 0.1)
                      ok = np.array([m in (n, "wood_dark", "gold") for m in names])
                  else:
                      box = np.zeros(len(T), bool); box[[k, j]] = True; ok = box
                  drop |= box & ok
                  if n.startswith("plate_"):
                      plate(new, P, L, H, int(n.split("_")[1])); report["plates"] += 1
                      signs.append({"kind": "plate", "text": NAMES[int(n.split("_")[1])], "at": [round(float(x), 2) for x in P(L / 2, H / 2, 0)], "size": [round(L, 3), round(H, 3)]})
                  elif n.startswith("board_"):
                      key = n[len("board_"):]
                      board(new, P, L, H, key, SIGN_GILT.get(key, False)); report["boards"] += 1
                      signs.append({"kind": "board", "key": key, "at": [round(float(x), 2) for x in P(L / 2, H / 2, 0)], "size": [round(L, 3), round(H, 3)], "wall": [round(float(x), 4) for x in nrm], "along": [round(float(x), 4) for x in ex], "foot": [round(float(x), 3) for x in P(0, 0, 0)]})
                  else:
                      lay = LAY["letters"]; W4 = [P(0, 0, 0.0), P(L, 0, 0.0), P(L, H, 0.0), P(0, H, 0.0)]
                      new.quad(W4, nrm, [cell_uv(n, 0, 0, lay), cell_uv(n, 1, 0, lay), cell_uv(n, 1, 1, lay), cell_uv(n, 0, 1, lay)])
                      report["letters"] += 1
                      signs.append({"kind": "letters", "key": n[len("letters_"):], "at": [round(float(x), 2) for x in P(L / 2, H / 2, 0)], "size": [round(L, 3), round(H, 3)], "wall": [round(float(x), 4) for x in nrm], "along": [round(float(x), 4) for x in ex], "foot": [round(float(x), 3) for x in P(0, 0, 0)]})
          for tri_idx, h in hangs.get(rec["mesh"], []) if solid else []:
              drop[tri_idx] = True
              P = lambda x, y, z, h=h: h["foot"] + h["ex"] * (h["s"] + x) + np.array([0.0, 1.0, 0.0]) * (h["top"] + y) + h["n"] * z
              add_hang(new, iron, P, h["kind"]); report["hanging " + h["kind"]] += 1
              signs.append({"kind": "hanging", "sign": h["kind"], "near": h["near"], "at": [round(float(x), 2) for x in P(0, 0, 0.5)], "along": [round(float(x), 4) for x in h["ex"]], "wall": [round(float(x), 4) for x in h["n"]]})
          if not drop.any() and not new.rows: continue
          report["triangles removed"] += int(drop.sum())
          f = f"{pathlib.Path(rec['mesh']).stem}-{s['index']}.bin"
          T[~drop].reshape(-1).astype(np.float32).tofile(OUT / f)
          surfs.append({"file": f, "material": s["material"], "custom0": s["custom0"], "vertices": int((~drop).sum() * 3)})
      if not new.rows: continue
      if iron.rows:
          inf = f"{pathlib.Path(rec['mesh']).stem}-signs-iron.bin"
          np.asarray(iron.rows, np.float32).tofile(OUT / inf)
          surfs.append({"file": inf, "material": IRON_MAT, "custom0": False, "vertices": len(iron.rows), "noCollision": True})
      nf = f"{pathlib.Path(rec['mesh']).stem}-signs.bin"
      np.asarray(new.rows, np.float32).tofile(OUT / nf)
      surfs.append({"file": nf, "material": SIGNS_MAT if solid else LETTERS_MAT, "custom0": False, "vertices": len(new.rows), "noCollision": True})
      report["new triangles"] += len(new.rows) // 3
      manifest[rec["mesh"]] = {"node": rec["node"], "sourceHash": rec["meshHash"], "surfaces": surfs}
  return manifest, report, signs

_, _, found = build({})
manifest, report, signs = build(find_hangs(found))
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=1))
(OUT / "signs.json").write_text(json.dumps(signs, indent=0))
(OUT / "report.json").write_text(json.dumps(dict(report), indent=1))
print(dict(report))
