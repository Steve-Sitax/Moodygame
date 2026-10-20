"""Headwear fit on a saved people2 build (docs/people.md "Headwear fit"): every kind's hat against its head.

    blender -b <PEOPLE2_SAVE_BLEND file> --factory-startup --python-exit-code 1         -P art-source/tools/blender/people2/check_hats.py -- <checkout> <out.json> [--far]

Per kind (near copy, rest pose): hat width and length against the head's upper 7.5 cm, the crown's height over the
scalp, the gap from scalp (and the kind's under-hat hair) to the hat's inside along rays from the skull's middle,
and per head slider at full value (and all of the skull ones together) the deepest point of hair or scalp outside
the crown's inner surface (`visible`: deeper than 2.5 mm, through the cloth). Reports only; read it with the pictures.
"""
import bpy, json, math, sys, re
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

ARGS = sys.argv[sys.argv.index("--") + 1:]
ROOT, OUT = ARGS[0], ARGS[1]
sys.path.insert(0, ROOT + "/art-source/tools/blender")
rig = json.load(open(ROOT + "/art-source/shared/peopleRig.json", encoding="utf-8"))
HATWORDS = re.compile(r"(cap|hat|kepi|shako|bonnet|brim|peak|frill|coif|veil|wimple|kerchief|falie|lappet|pompom|plate|hood|ribbon|feather|scarf)")


def groups(ob):
    names = {g.index: g.name for g in ob.vertex_groups}
    out = {}
    for v in ob.data.vertices:
        for g in v.groups:
            n = names[g.group]
            if n.startswith("part_") and g.weight > 0.5:
                out.setdefault(n[5:], []).append(v.index)
    return out


def bvh_of(ob, vids):
    vs = set(vids)
    co = [v.co.copy() for v in ob.data.vertices]
    polys = [list(p.vertices) for p in ob.data.polygons if all(i in vs for i in p.vertices)]
    if not polys:
        return None
    return BVHTree.FromPolygons(co, polys)


def measure(ob, hats, hair_ob=None, body_ob=None):
    co = np.array([v.co[:] for v in ob.data.vertices])
    # up axis: blend meshes are Z-up (glTF Y-up converted)
    g = groups(ob)
    bg = groups(body_ob)
    head = bg.get("head", [])
    if not head:
        return None
    bco = np.array([v.co[:] for v in body_ob.data.vertices])
    kh = g.get("head", [])
    H = bco[head]
    top = H[:, 2].max()
    upper = H[H[:, 2] > top - 0.075]
    hx = upper[:, 0].max() - upper[:, 0].min()
    hy = upper[:, 1].max() - upper[:, 1].min()
    centre = np.array((0.5 * (upper[:, 0].max() + upper[:, 0].min()), 0.5 * (upper[:, 1].max() + upper[:, 1].min()), top - 0.085))
    hatparts = sorted(p for p in g if (p in hats or (p.startswith("in_") and p[3:] in hats)))
    if not hatparts:
        hatparts = sorted(p for p in g if HATWORDS.search(p))
    outer = sorted({i for p in hatparts if not p.startswith("in_") for i in g[p]})
    allhat = sorted({i for p in hatparts for i in g[p]})
    if not outer:
        return {"hatparts": hatparts, "missing": True}
    A = co[outer]
    res = {"hatparts": hatparts, "headWidth": hx, "headLength": hy, "scalpTop": top,
           "hatWidth": A[:, 0].max() - A[:, 0].min(), "hatLength": A[:, 1].max() - A[:, 1].min(),
           "hatTop": A[:, 2].max(), "hatBottom": A[:, 2].min()}
    res["widthRatio"] = res["hatWidth"] / hx
    res["lengthRatio"] = res["hatLength"] / hy
    res["crownAboveScalp"] = res["hatTop"] - top
    per = {}
    for p in hatparts:
        if p.startswith("in_"):
            continue
        P_ = co[g[p]]
        per[p] = {"w": round(P_[:, 0].max() - P_[:, 0].min(), 4), "l": round(P_[:, 1].max() - P_[:, 1].min(), 4),
                  "top": round(P_[:, 2].max() - top, 4), "bottom": round(P_[:, 2].min() - top, 4)}
    res["parts"] = per
    headbvh = bvh_of(body_ob, head)
    if kh:
        res["kindHeadTopMinusBase"] = float(co[kh][:, 2].max() - top)
    hatbvh = bvh_of(ob, allhat)
    hairbvh = None
    if hair_ob is not None:
        hco = [v.co.copy() for v in hair_ob.data.vertices]
        hairbvh = BVHTree.FromPolygons(hco, [list(p.vertices) for p in hair_ob.data.polygons])
    gaps = []
    for el in (90, 70, 50, 35, 20, 5):
        for az in range(0, 360, 30):
            if el == 90 and az:
                continue
            e, a = math.radians(el), math.radians(az)
            d = Vector((math.sin(a) * math.cos(e), -math.cos(a) * math.cos(e), math.sin(e)))  # az 0 = front (-y)
            c = Vector(centre)
            hh = headbvh.ray_cast(c + d * 0.4, -d, 0.4)
            if hh[0] is None:
                continue
            hd = (hh[0] - c).length
            th = hatbvh.ray_cast(c, d, 0.4) if hatbvh else (None,)
            if th[0] is None:
                continue
            td = (th[0] - c).length
            rec = {"el": el, "az": az, "gap": round(td - hd, 4)}
            if hairbvh is not None:
                hr = hairbvh.ray_cast(c + d * 0.4, -d, 0.4)
                if hr[0] is not None:
                    rec["hairGap"] = round(td - (hr[0] - c).length, 4)
            gaps.append(rec)
    res["gaps"] = gaps
    gv = np.array([r["gap"] for r in gaps]) if gaps else np.zeros(1)
    res["gapTop"] = next((r["gap"] for r in gaps if r["el"] == 90), None)
    res["gapMedian"] = float(np.median(gv))
    res["gapMin"] = float(gv.min())
    res["gapMax"] = float(gv.max())
    hg = [r["hairGap"] for r in gaps if "hairGap" in r]
    if hg:
        res["hairGapMin"] = float(min(hg))
        res["hairGapMedian"] = float(np.median(hg))
    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in res.items()}


from build_people2 import all_kinds  # noqa: E402
kinds = {k.name: k for k in all_kinds()}
CROWN = re.compile(r"^(in_)?(cap|hat|kepi|shako|coif|veil|kerchief|sack_hood|falie|bonnet)$")
MIXES = {"basis": {}, "tall": {"s_head_tall": 1}, "wide": {"s_head_wide": 1}, "long": {"s_skull_long": 1},
         "fat": {"s_face_fat": 1}, "age": {"s_face_age": 1}, "brow": {"s_brow_ridge": 1},
         "forehead": {"s_forehead_back": 1}, "forehead_neg": {"s_forehead_back_neg": 1},
         "all": {"s_head_tall": 1, "s_head_wide": 1, "s_skull_long": 1, "s_face_fat": 1}}


def mixed(ob, mix):
    me = ob.data
    co = np.array([v.co[:] for v in me.vertices])
    if not me.shape_keys:
        return co
    kb = me.shape_keys.key_blocks
    base = np.array([d.co[:] for d in me.shape_keys.reference_key.data])
    out = base.copy()
    for n, w in mix.items():
        if n in kb:
            out += w * (np.array([d.co[:] for d in kb[n].data]) - base)
    return out


def poke(ob, hair_ob):
    g = groups(ob)
    crown = sorted({i for p, ids in g.items() if CROWN.match(p) for i in ids})
    if not crown:
        return None
    cs = set(crown)
    polys = [list(p.vertices) for p in ob.data.polygons if all(i in cs for i in p.vertices)]
    head = g.get("head", [])
    res = {}
    for mname, mix in MIXES.items():
        co = mixed(ob, mix)
        bvh = BVHTree.FromPolygons([Vector(p) for p in co], polys)
        H = co[head]
        top = H[:, 2].max()
        upper = H[H[:, 2] > top - 0.075]
        c = np.array((0.5 * (upper[:, 0].max() + upper[:, 0].min()), 0.5 * (upper[:, 1].max() + upper[:, 1].min()), top - 0.085))
        pts = [("head", H)]
        if hair_ob is not None:
            pts.append(("hair", mixed(hair_ob, mix)))
        worst, count, n = 0.0, 0, 0
        where = None
        for label, P in pts:
            for p in P:
                d = p - c
                if d[2] < -0.04:
                    continue
                L = float(np.linalg.norm(d))
                hit = bvh.ray_cast(Vector(c), Vector(d / L), L + 0.002)
                if hit[0] is None:
                    continue
                n += 1
                depth = L - hit[3]
                if depth > 0.0025:
                    count += 1
                if depth > worst:
                    worst, where = depth, (label, [round(x, 3) for x in (p - c)])
        res[mname] = {"worst": round(worst, 4), "visible": count, "tested": n, "where": where}
    return res


out = {}
for name, spec in rig["kinds"].items():
    k = kinds.get(name)
    hats = tuple(spec.get("hats") or (k.hats if k else ()))
    for level in ("lod0", "lod1"):
        ob = bpy.data.objects.get(name + "_" + level)
        if ob is None:
            continue
        body = spec.get("body")
        hair = None
        female = body.startswith(("woman", "old_woman"))
        styles = ("bun",) if name == "tourist_lady" else ("undercap",) if female else ("capped",)
        for style in styles:
            hair = bpy.data.objects.get("%s_hair_%s_%s" % (body, style, level)) or hair
        m = measure(ob, hats, hair, bpy.data.objects[body + "_" + level])
        if m is None or m.get("missing") and not hats:
            continue
        m["hairObject"] = hair.name if hair else None
        if level == "lod0" or "--far" in ARGS:
            m["poke"] = poke(ob, hair)
        out.setdefault(name, {})[level] = m
json.dump(out, open(OUT, "w"), indent=1)
for name, lv in out.items():
    m = lv.get("lod0", {})
    if m.get("missing"):
        print("HAT", name, "no hat verts", m.get("hatparts"))
        continue
    print("HAT %-22s w %.3f/%.3f=%.2f l %.3f/%.3f=%.2f crown+%.3f bottom%+.3f gap top %s med %.3f min %.3f max %.3f hairmin %s %s" % (
        name, m["hatWidth"], m["headWidth"], m["widthRatio"], m["hatLength"], m["headLength"], m["lengthRatio"],
        m["crownAboveScalp"], m["hatBottom"] - m["scalpTop"], m["gapTop"], m["gapMedian"], m["gapMin"], m["gapMax"],
        m.get("hairGapMin"), m["hatparts"]))
    pk = m.get("poke") or {}
    print("POKE %-21s %s" % (name, " ".join("%s:%.1fmm/%d" % (k, v["worst"] * 1000, v["visible"]) for k, v in pk.items())))
print("MEASURE DONE", len(out))
