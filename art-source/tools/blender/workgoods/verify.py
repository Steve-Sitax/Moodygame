"""Checks of the exported workgoods.glb from its JSON chunk alone (runs in Blender or plain Python):

    python art-source/tools/blender/workgoods/verify.py .scratch/workgoods-plain/workgoods.glb

node names and parents, the winch's child origins on their axles and its extras, no Draco, no sparse accessors, one
material without a normal map, images embedded as PNG, COLOR_0 on every primitive, and each model's bounding box
against its intended size (game axes, metres)."""

import json
import math
import struct
import sys

# intended sizes (x, y, z) in game axes; None: not checked
SIZES = {
    "held_knife": (None, 0.214, None),
    "held_fish": (0.25, None, None),
    "trunk": (0.90, 0.50, 0.52),
    "bundle": (0.75, 0.55, 0.45),
    "featherbed": (1.10, 0.55, 0.55),
    "basket": (0.55, 0.32, 0.38),
    "tub": (0.62, None, 0.62),
    "hides": (0.90, 0.28, 0.70),
    "parcel": (0.45, 0.30, 0.35),
    "crab_winch": (None, None, None),
    "ledger_open": (0.46, None, None),
}
TOL = 0.02
MATERIAL = "workgoods"  # the one material's name (build_smallgoods.py sets its own)
GROUNDED = {"ledger_open", "crab_winch", "trunk", "bundle", "featherbed", "basket", "tub", "hides", "parcel"}


def load(path):
    with open(path, "rb") as f:
        data = f.read()
    magic, ver, length = struct.unpack_from("<III", data, 0)
    assert magic == 0x46546C67, "not a glb"
    clen, ctype = struct.unpack_from("<II", data, 12)
    assert ctype == 0x4E4F534A
    return json.loads(data[20:20 + clen].decode("utf-8")), data


def qrot(q, v):
    x, y, z, w = q
    vx, vy, vz = v
    # v' = v + 2 w (q x v) + 2 q x (q x v)
    cx, cy, cz = y * vz - z * vy, z * vx - x * vz, x * vy - y * vx
    cx2, cy2, cz2 = y * cz - z * cy, z * cx - x * cz, x * cy - y * cx
    return (vx + 2 * (w * cx + cx2), vy + 2 * (w * cy + cy2), vz + 2 * (w * cz + cz2))


def xform(node, p):
    s = node.get("scale", [1, 1, 1])
    p = (p[0] * s[0], p[1] * s[1], p[2] * s[2])
    if "rotation" in node:
        p = qrot(node["rotation"], p)
    t = node.get("translation", [0, 0, 0])
    return (p[0] + t[0], p[1] + t[1], p[2] + t[2])


def corners(lo, hi):
    return [(x, y, z) for x in (lo[0], hi[0]) for y in (lo[1], hi[1]) for z in (lo[2], hi[2])]


def node_box(J, ni, chain=()):
    """The bounding box of a node and its children, in its parent's frame."""
    node = J["nodes"][ni]
    pts = []
    if "mesh" in node:
        for prim in J["meshes"][node["mesh"]]["primitives"]:
            acc = J["accessors"][prim["attributes"]["POSITION"]]
            pts += corners(acc["min"], acc["max"])
    for c in node.get("children", []):
        lo, hi = node_box(J, c)
        if lo is not None:
            pts += corners(lo, hi)
    if not pts:
        return None, None
    pts = [xform(node, p) for p in pts]
    lo = [min(p[k] for p in pts) for k in range(3)]
    hi = [max(p[k] for p in pts) for k in range(3)]
    return lo, hi


def check(path, names=None, out=print):
    J, data = load(path)
    ok = True

    def bad(msg):
        nonlocal ok
        ok = False
        out("[verify] FAIL " + msg)

    names = names or list(SIZES)
    roots = J["scenes"][J.get("scene", 0)]["nodes"]
    byname = {J["nodes"][i].get("name"): i for i in range(len(J["nodes"]))}
    rootnames = [J["nodes"][i].get("name") for i in roots]
    out("[verify] top-level nodes: %s" % rootnames)
    for n in names:
        if n not in rootnames:
            bad("missing top-level node %s" % n)
    extra = [n for n in rootnames if n not in names]
    if extra:
        bad("unexpected top-level nodes %s" % extra)
    used = J.get("extensionsUsed", []) + J.get("extensionsRequired", [])
    out("[verify] extensions used: %s" % used)
    if any("draco" in e.lower() for e in used):
        bad("Draco extension present")
    sparse = [i for i, a in enumerate(J["accessors"]) if "sparse" in a]
    if sparse:
        bad("sparse accessors %s" % sparse)
    mats = J.get("materials", [])
    out("[verify] materials: %s" % [m.get("name") for m in mats])
    if len(mats) != 1 or mats[0].get("name") != MATERIAL:
        bad("expected one material '%s'" % MATERIAL)
    else:
        m = mats[0]
        pbr = m.get("pbrMetallicRoughness", {})
        if "normalTexture" in m:
            bad("material has a normal map")
        if "baseColorTexture" not in pbr:
            bad("material has no base colour texture")
        mf, rf = pbr.get("metallicFactor", 1.0), pbr.get("roughnessFactor", 1.0)
        out("[verify] metallic %s roughness %s" % (mf, rf))
        if mf != 0 or rf != 1:
            bad("metallic/roughness not 0/1")
    imgs = J.get("images", [])
    for im in imgs:
        if "bufferView" not in im or im.get("mimeType") != "image/png" or "uri" in im:
            bad("image not embedded as PNG: %s" % im)
    out("[verify] images: %s" % [(im.get("name"), im.get("mimeType")) for im in imgs])
    for mi, me in enumerate(J["meshes"]):
        for prim in me["primitives"]:
            if "COLOR_0" not in prim["attributes"]:
                bad("mesh %s has no COLOR_0" % me.get("name"))
            if "extensions" in prim:
                bad("mesh %s primitive extensions %s" % (me.get("name"), list(prim["extensions"])))
    tris = {}
    for n in names:
        if n not in byname:
            continue
        ni = byname[n]
        lo, hi = node_box(J, ni)
        size = [hi[k] - lo[k] for k in range(3)]
        want = SIZES.get(n, (None, None, None))
        flags = []
        for k, ax in enumerate("xyz"):
            if want[k] is not None and abs(size[k] - want[k]) > TOL:
                flags.append("%s %.3f (want %.2f)" % (ax, size[k], want[k]))
        ground = ""
        if n in GROUNDED:
            if abs(lo[1]) > 0.004:
                flags.append("base at y %.4f" % lo[1])
            cx, cz = (lo[0] + hi[0]) / 2, (lo[2] + hi[2]) / 2
            ground = " centre x %.3f z %.3f" % (cx, cz)
        out("[verify] %-12s size %.3f x %.3f x %.3f  min (%.3f, %.3f, %.3f) max (%.3f, %.3f, %.3f)%s%s" %
            (n, size[0], size[1], size[2], lo[0], lo[1], lo[2], hi[0], hi[1], hi[2], ground,
             ("  OUT: " + "; ".join(flags)) if flags else ""))
        if flags and n != "crab_winch":
            bad("%s size" % n)
    if "crab_winch" in names and "crab_winch" in byname:
        w = J["nodes"][byname["crab_winch"]]
        kids = [J["nodes"][c].get("name") for c in w.get("children", [])]
        out("[verify] crab_winch children: %s" % kids)
        if sorted(kids) != ["winch_crank", "winch_drum", "winch_frame"]:
            bad("crab_winch children")
        ex = w.get("extras", {})
        out("[verify] crab_winch extras: %s" % json.dumps(ex))
        for k in ("crank_axle", "crank_radius", "drum_axle", "gear_ratio", "rope_leaves"):
            if k not in ex:
                bad("extra %s missing" % k)
        for c in w.get("children", []):
            nd = J["nodes"][c]
            t = nd.get("translation", [0, 0, 0])
            out("[verify]   %-12s translation (%.4f, %.4f, %.4f) rotation %s" % (nd["name"], t[0], t[1], t[2], nd.get("rotation")))
            if nd["name"] == "winch_crank" and max(abs(a - b) for a, b in zip(t, ex.get("crank_axle", [9, 9, 9]))) > 1e-4:
                bad("winch_crank origin not on the crank axle")
            if nd["name"] == "winch_drum":
                da = ex.get("drum_axle", [9, 9, 9])
                if abs(t[1] - da[1]) > 1e-4 or abs(t[2] - da[2]) > 1e-4:
                    bad("winch_drum origin not on the drum axle")
            if nd["name"] == "winch_frame" and max(abs(a) for a in t) > 1e-6:
                bad("winch_frame not at the root origin")
            if "rotation" in nd or "scale" in nd:
                bad("%s has a rotation/scale (its local x must be the axle)" % nd["name"])
    for n in names:
        if n not in byname:
            continue
        nd = J["nodes"][byname[n]]
        if any(abs(v) > 1e-6 for v in nd.get("translation", [0, 0, 0])) or "rotation" in nd:
            bad("%s top-level node not at the origin" % n)
    out("[verify] %s" % ("ALL CHECKS PASSED" if ok else "CHECKS FAILED"))
    return ok


if __name__ == "__main__":
    sys.exit(0 if check(sys.argv[1]) else 1)
