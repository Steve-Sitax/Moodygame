"""The horse's pictures: every part rasterised into the shared unwrap (one texel: where it is on the standing horse,
its normal, its region and its part), then painted per coat at 2048 px, with one normal picture for all coats.

The coat: hair lying the way it grows (back along the trunk and down its sides, down the neck from the crest, down the
face from the poll, down the legs), its strands drawn as streaks along that way; the back darker and the belly lighter;
soft dapples on a bay; the points (the lower legs, the mane and tail) dark; light caught where the shape is open and
dimmed in the folds (occlusion from the whole horse and its harness); the street's dirt up the legs and in the
feathers; damp, darker hair where the collar and the straps lie. Roan: single white hairs through a brown coat (never a
pink wash), the head and legs left dark. The harness: black leather with its grain and worn edges, the stuffed collar's
seams, oak hames, brass with tarnish in its hollows, iron, the red wool lining in a check; the hooves' horn in growth
lines. Everything is made here (no picture comes from elsewhere)."""

import hashlib
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

from animals import pictures as AP
from animals.paint import dilate, fbm, hexc, raster, smoothstep, strands, vnoise

from . import COATS, PICTURES, TEX
from .parts import HEAD_PIVOT, REGIONS, regions_of

# colours: the coat, its back (dorsal), its belly, the points, the long hair, the muzzle's skin
PALETTE = {
    "bay": dict(base=0x7a4527, back=0x5a3119, belly=0x9c6c4a, points=0x1d1714, hair=0x16110f, muzzle=0x2b2321, blaze=True, dapple=0.07),
    "chestnut": dict(base=0x9e5a2e, back=0x7e4420, belly=0xbf8556, points=0x80421f, hair=0xcdb68a, muzzle=0x3b2d28, blaze=True, socks=True,
                     dapple=0.05),
    "black": dict(base=0x1b1817, back=0x141211, belly=0x2b2623, points=0x131110, hair=0x0e0c0b, muzzle=0x221c1a, blaze=False, dapple=0.0,
                  tips=0x5a4f47),
    "roan": dict(base=0x6a4130, back=0x5a3626, belly=0x7d5540, points=0x2a1e18, hair=0x1d1613, muzzle=0x2a2220, blaze=True, roan=0.36,
                 white=0xc6bfb2, dapple=0.0),
    # a dark brown with tan flanks and muzzle and no white; a dapple grey on dark skin, the legs, mane and tail darker grey
    "brown": dict(base=0x4a2b1b, back=0x33190f, belly=0x80593a, points=0x15100d, hair=0x120d0b, muzzle=0x6e4f3c, blaze=False, dapple=0.05),
    "grey": dict(base=0x9b9993, back=0x817f7a, belly=0xb4b1aa, points=0x5f5c59, hair=0xb9b5ac, muzzle=0x3a3433, blaze=False, dapple=0.2),
}
HARNESS = dict(leather=0x221913, collar=0x1d1612, hame=0x6c4a2b, brass=0xb3893c, iron=0x3b3735, rust=0x6b3d24, cloth=0x6a1a12,
               check=0x23202a, hoof=0x2f2721, eye=0x170f0b, iris=0x3c2414)


def standing_copies(objs):
    """Each part once (the legs on the near side), its mesh moved to where it is on the standing horse."""
    from build_props import HORSE_RIG
    out = {}
    for name, ob in objs.items():
        o = ob.copy()
        o.data = ob.data.copy()
        bpy.context.scene.collection.objects.link(o)
        M = Matrix.Translation(ob.location)
        if name.startswith("leg"):
            M = Matrix.Translation(Vector((HORSE_RIG["front" if "front" in name else "hind"]["x"], 0, 0))) @ M
        o.data.transform(M)
        o.matrix_world = Matrix.Identity(4)
        out[name] = o
    return out


def vregions(ob):
    reg = regions_of(ob)
    v = ["coat"] * len(ob.data.vertices)
    for p, r in zip(ob.data.polygons, reg):
        for i in p.vertices:
            v[i] = r
    return v


def occlusion(copies, objs_for_rays):
    """Ambient occlusion per vertex of each copy (16 rays, 0.3 m reach) against the whole standing horse and its harness."""
    verts, polys = [], []
    for o in objs_for_rays:
        base = len(verts)
        mw = o.matrix_world
        verts += [tuple(mw @ v.co) for v in o.data.vertices]
        polys += [[base + i for i in p.vertices] for p in o.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    rng = np.random.default_rng(7)
    dirs = rng.normal(size=(16, 3))
    dirs /= np.linalg.norm(dirs, axis=1, keepdims=True)
    out = {}
    for name, o in copies.items():
        me = o.data
        vn = np.zeros((len(me.vertices), 3))
        for l in me.loops:
            vn[l.vertex_index] += np.array(l.normal[:])
        vn /= np.maximum(np.linalg.norm(vn, axis=1, keepdims=True), 1e-9)
        ao = np.ones(len(me.vertices))
        for i, v in enumerate(me.vertices):
            n = Vector(vn[i])
            p = v.co + n * 0.004
            hit = 0.0
            for d in dirs:
                dd = Vector(d)
                if dd.dot(n) < 0:
                    dd = -dd
                loc, nor, idx, dist = tree.ray_cast(p, dd, 0.3)
                if loc is not None:
                    hit += 1.0 - dist / 0.3
            ao[i] = 1.0 - 0.85 * hit / len(dirs)
        out[name] = ao
    return out


def flow_of(part, P, N):
    """The way the hair lies at each texel (game axes), by part."""
    n = len(P)
    d = np.zeros((n, 3))
    if part == "body":
        down = np.clip((1.62 - P[:, 1]) / 0.4, 0, 1)
        d[:, 2] = -1.0
        d[:, 1] = -0.75 * down
    elif part == "neck":
        d[:, 1] = -1.0
        d[:, 2] = -0.35
    elif part == "head":
        h0 = np.array((0, HEAD_PIVOT[1], HEAD_PIVOT[0]))
        from build_props import HEAD1
        h1 = np.array((0, HEAD1[1], HEAD1[0]))
        ax = (h1 - h0) / np.linalg.norm(h1 - h0)
        d[:] = ax
        d[:, 1] -= 0.25
    elif part in ("ear_l", "ear_r"):
        d[:, 1] = 1.0
    else:
        d[:, 1] = -1.0
    return d


def paint(objs, standing):
    t_start = __import__("time").time()
    copies = standing_copies(objs)
    names_order = list(copies.keys())
    size = TEX
    P = np.zeros((size, size, 3), np.float32)
    N = np.zeros((size, size, 3), np.float32)
    REG = -np.ones((size, size), np.int16)
    PART = -np.ones((size, size), np.int16)
    AO = np.ones((size, size), np.float32)
    rays_objs = [c for k, c in copies.items() if k not in ("rein", "trace")]
    # the far side's legs for the occlusion too (the belly and the inner legs are shaded by them)
    extra = []
    for name in ("leg_front", "leg_front_lo", "leg_hind", "leg_hind_lo"):
        o = copies[name].copy()
        o.data = copies[name].data.copy()
        bpy.context.scene.collection.objects.link(o)
        from build_props import HORSE_RIG
        x = HORSE_RIG["front" if "front" in name else "hind"]["x"]
        o.data.transform(Matrix.Translation(Vector((-2 * x, 0, 0))))
        extra.append(o)
    ao_v = occlusion({k: v for k, v in copies.items() if k not in ("rein", "trace")}, rays_objs + extra)
    for o in extra:
        bpy.data.objects.remove(o)
    for pi, name in enumerate(names_order):
        o = copies[name]
        vp = vregions(o)
        pos, nrm, part, names, vert = raster(o, size, vp)
        m = part >= 0
        P[m] = pos[m]
        N[m] = nrm[m]
        glob = np.array([REGIONS.index(nm) for nm in names], np.int16)
        REG[m] = glob[part[m]]
        PART[m] = pi
        if name in ao_v:
            a = ao_v[name][vert["tri"][m]]
            AO[m] = (a * vert["bary"][m]).sum(1)
    for o in copies.values():
        bpy.data.objects.remove(o)
    mask = REG >= 0
    idx = np.nonzero(mask.ravel())[0]
    Pf, Nf = P.reshape(-1, 3)[idx].astype(np.float64), N.reshape(-1, 3)[idx].astype(np.float64)
    Rf, Kf, Af = REG.ravel()[idx], PART.ravel()[idx], AO.ravel()[idx]
    reg = np.array(REGIONS)[Rf]
    part = np.array(names_order)[Kf]
    n = len(idx)
    print(f"[horse] raster {size}: {n} texels, {__import__('time').time() - t_start:.1f} s")
    # the hair's way and its strands: short coat hair, long hair in the mane, tail and feathers
    flow = np.zeros((n, 3))
    for nm in names_order:
        sel = part == nm
        if sel.any():
            flow[sel] = flow_of(nm, Pf[sel], Nf[sel])
    long_hair = reg == "hair"
    sv = np.zeros(n)
    # (the coat's strands a little wider than a texel, so they read as hair lying one way and not as grain)
    sv[~long_hair] = strands(Pf[~long_hair], flow[~long_hair], Nf[~long_hair], 0.0021, 0.03, taps=12, seed=1873)[0]
    if long_hair.any():
        sv[long_hair] = strands(Pf[long_hair], flow[long_hair], Nf[long_hair], 0.0024, 0.16, taps=16, seed=1874)[0]
    print(f"[horse] strands, {__import__('time').time() - t_start:.1f} s")
    up = Nf[:, 1]
    heights = None
    out = {}
    hashes = {}
    for coat in COATS:
        col, height = paint_coat(coat, Pf, Nf, reg, part, sv, Af, up)
        img = np.zeros((size, size, 3), np.float32)
        img.reshape(-1, 3)[idx] = col
        img = dilate(img, mask, steps=12)
        out[coat] = img
        if heights is None:
            heights = height
    hmap = np.zeros((size, size), np.float32)
    hmap.ravel()[idx] = heights
    from animals.paint import normal_map
    nm = normal_map(hmap, P, mask, 0.0016)
    nm = dilate(nm, mask, steps=12)
    # the pictures, the materials for the previews, the PNG masters (with their import presets)
    os.makedirs(PICTURES, exist_ok=True)
    mats = {}
    from animals import export as AE
    nimg = AE.image("horse_normal", nm, colour=False)
    hashes["horse_normal.png"] = write_png("horse_normal", nm, normal=True)
    for coat, img in out.items():
        cimg = AE.image("horse_" + coat + "_colour", img)
        hashes["horse_" + coat + "_colour.png"] = write_png("horse_" + coat + "_colour", img)
        mats[coat] = AE.material("horse_" + coat, cimg, nimg, rough=0.8)
    print(f"[horse] pictures done, {__import__('time').time() - t_start:.1f} s")
    return dict(materials=mats, hashes=hashes, images=out, normal=nm)


IMPORT_ROOT = "res://assets/horse-pictures/"


def write_png(name, rgb, normal=False):
    data = AP.png_bytes(rgb)
    path = os.path.join(PICTURES, name + ".png")
    with open(path, "wb") as f:
        f.write(data)
    imp = path + ".import"
    if not os.path.exists(imp):
        with open(imp, "w", encoding="utf-8", newline="\n") as f:
            f.write(AP.IMPORT.format(name=name + ".png", hq="false" if normal else "true", nm=1 if normal else 0)
                    .replace("res://assets/animal-pictures/", IMPORT_ROOT))
    return hashlib.sha256(data).hexdigest()


def paint_coat(coat, P, N, reg, part, sv, ao, up):
    c = PALETTE[coat]
    n = len(P)
    base, back, belly = hexc(c["base"]), hexc(c["back"]), hexc(c["belly"])
    col = np.tile(base, (n, 1))
    height = np.zeros(n)
    hide = np.isin(reg, ["coat", "points", "white", "muzzle"])
    # dorsal shading: the back and the top of the neck darker, the belly and the inside of the legs lighter
    dors = smoothstep(-0.1, 0.85, up) * smoothstep(1.2, 1.6, P[:, 1])
    vent = smoothstep(0.1, -0.85, up) * smoothstep(1.25, 0.95, P[:, 1]) * (part == "body")
    col = col * (1 - 0.7 * dors[:, None]) + back * 0.7 * dors[:, None]
    col = col * (1 - 0.55 * vent[:, None]) + belly * 0.55 * vent[:, None]
    # large slow variation, and dapples (soft rounds of lighter coat on the barrel and the quarters)
    col *= (0.9 + 0.2 * fbm(P, 3.0, 3, 11))[:, None]
    if c.get("dapple"):
        dap = vnoise(P, 16.0, 12) * 0.6 + vnoise(P, 32.0, 13) * 0.4
        ring = smoothstep(0.55, 0.68, dap) * (1 - smoothstep(0.72, 0.8, dap)) * (part == "body")
        col *= (1 + c["dapple"] * ring)[:, None]
    # the points: the lower legs (from the knees and hocks down) in the dark colour, soft at the edge
    pts = hexc(c["points"])
    legs = np.isin(part, ["leg_front_lo", "leg_hind_lo"]) | (np.isin(part, ["leg_front", "leg_hind"]) & (P[:, 1] < 0.62 + 0.06 * (fbm(P, 20.0, 2, 14) - 0.5)))
    pm = np.clip(legs * 1.0 + (reg == "points"), 0, 1) * smoothstep(0.72, 0.5, P[:, 1] + 0.05 * (fbm(P, 15.0, 2, 15) - 0.5))
    col = col * (1 - pm[:, None]) + pts * pm[:, None]
    # the head: darker round the eyes and down the face, the muzzle's skin
    head = part == "head"
    if head.any():
        h0 = np.array((0, HEAD_PIVOT[1], HEAD_PIVOT[0]))
        from build_props import HEAD1
        h1 = np.array((0, HEAD1[1], HEAD1[0]))
        L = np.linalg.norm(h1 - h0)
        ax = (h1 - h0) / L
        t = ((P - h0) @ ax) / L
        face_dir = np.array((0, ax[2], -ax[1]))  # forward and up, square to the head's axis
        face = (N @ face_dir) > 0.25
        mz = head & ((reg == "muzzle") | (t > 0.74))
        mzc = hexc(c["muzzle"])
        mot = smoothstep(0.55, 0.75, fbm(P, 60.0, 2, 16))
        skin = mzc * (0.85 + 0.25 * fbm(P, 120.0, 2, 17))[:, None]
        skin = skin * (1 - 0.35 * mot[:, None]) + hexc(0x6a5250) * 0.35 * mot[:, None]
        k = smoothstep(0.7, 0.8, t) * head
        col = col * (1 - k[:, None]) + skin * k[:, None]
        # whiskers' dark dots and the nostrils' inside
        dots = (vnoise(P, 900.0, 18) > 0.86) & mz
        col[dots] *= 0.45
        if c.get("blaze"):
            w = np.interp(t, [0.05, 0.15, 0.3, 0.5, 0.7, 0.82, 0.92], [0.0, 0.032, 0.022, 0.017, 0.022, 0.036, 0.0])
            bl = head & face & (np.abs(P[:, 0]) < w + 0.006 * (fbm(P, 40.0, 2, 19) - 0.5))
            soft = smoothstep(0.004, -0.002, np.abs(P[:, 0]) - w) * bl
            col = col * (1 - soft[:, None] * 0.92) + hexc(0xe4ded2) * soft[:, None] * 0.92
        eyes = head & (smoothstep(0.32, 0.2, np.abs(t - 0.235)) > 0) & (np.abs(P[:, 0]) > 0.1)
        col[eyes] *= 0.92
    # the ears: dark rims and tips, pale hair in the hollow
    ears = np.isin(part, ["ear_l", "ear_r"])
    col[ears & (reg == "hair")] = hexc(0x8a7a6a) * (0.6 + 0.6 * sv[ears & (reg == "hair")])[:, None]
    tip = ears & (P[:, 1] > 2.33)
    col[tip] = col[tip] * 0.6
    # socks on a chestnut's hind feet
    if c.get("socks"):
        sock = (part == "leg_hind_lo") & (P[:, 1] < 0.21 + 0.02 * (fbm(P, 30.0, 2, 20) - 0.5))
        col[sock] = hexc(0xe2dccf) * (0.92 + 0.1 * sv[sock])[:, None]
    # roan: white hairs one by one through the body's coat (the head and the lower legs stay dark)
    if c.get("roan"):
        body_coat = hide & ~legs & ~head & ~np.isin(part, ["ear_l", "ear_r"])
        hair_id = vnoise(P * np.array((1, 1, 1)), 1 / 0.0011, 21)
        # (thinning down the legs from the elbows and stifles; the head and the points keep the base colour)
        dens = c["roan"] * (0.75 + 0.5 * fbm(P, 4.0, 2, 22)) * smoothstep(0.62, 0.95, P[:, 1] + 0.3 * (part == "neck"))
        white = (hair_id < dens) & body_coat
        wc = hexc(c["white"])
        col[white] = col[white] * 0.15 + wc * 0.85 * (0.85 + 0.25 * sv[white])[:, None]
        mixk = (dens * 0.35 * body_coat)[:, None]
        col = col * (1 - mixk) + wc * 0.6 * mixk
    # the hair's streaks, glossy tips on a black coat
    hair_k = np.where(hide, 0.2, 0.0)
    col *= (1 - hair_k + 2 * hair_k * sv)[:, None] ** 1.0
    if "tips" in c:
        tk = (sv ** 3 * hide * 0.3)[:, None]
        col = col * (1 - tk) + hexc(c["tips"]) * tk
    height[hide] = 0.35 * sv[hide]
    # the long hair: mane, tail, forelock, feathers
    lh = (reg == "hair") & ~ears
    hc = hexc(c["hair"])
    lighter = smoothstep(0.75, 0.95, fbm(P, 40.0, 2, 23))
    # locks: dark partings between them, lighter hairs catching the light on their crowns
    locks = smoothstep(0.3, 0.7, fbm(P * np.array((1.0, 0.15, 1.0)), 45.0, 2, 26))
    col[lh] = hc * (0.35 + 1.0 * sv[lh] * (0.6 + 0.6 * locks[lh]))[:, None] * (1 + 0.45 * lighter[lh])[:, None]
    col[lh] = col[lh] + hexc(0x3a3028) * (0.25 * sv[lh] ** 3)[:, None]
    height[lh] = 1.0 * sv[lh] + 0.6 * locks[lh]
    eh = ears & (reg == "hair")
    height[eh] = 0.4 * sv[eh]
    # the street on the legs: dust and mud up to the knees and hocks, caked in the feathers
    dirt = smoothstep(0.42, 0.06, P[:, 1] + 0.1 * (fbm(P, 9.0, 2, 24) - 0.5)) * np.isin(part, ["leg_front_lo", "leg_hind_lo", "leg_front", "leg_hind"])
    dirt *= (0.45 + 0.55 * fbm(P, 25.0, 2, 25))
    dirt *= (reg != "hoof") & (reg != "iron")
    col = col * (1 - 0.6 * dirt[:, None]) + hexc(0x55493b) * 0.6 * dirt[:, None]
    # damp, darker hair where the harness lies (the occlusion of the straps and the collar on the hide)
    damp = np.clip((0.82 - ao) / 0.3, 0, 1) * hide * (P[:, 1] > 1.0)
    col *= (1 - 0.18 * damp)[:, None]
    # ---- the harness and the hooves
    H = HARNESS
    lea = np.isin(reg, ["leather"])
    grain = vnoise(P, 1 / 0.0012, 31) * 0.6 + vnoise(P, 1 / 0.004, 32) * 0.4
    worn = smoothstep(0.62, 0.8, fbm(P, 30.0, 3, 33))
    col[lea] = hexc(H["leather"]) * (0.8 + 0.35 * grain[lea])[:, None] * (1 + 0.6 * worn[lea])[:, None]
    height[lea] = 0.3 * grain[lea]
    cl = reg == "collar"
    from build_props import COLLAR_C, COLLAR_T, collar_frame
    C_, t_, s_, b_ = collar_frame()
    cg = np.array((C_.x, C_.z, -C_.y))
    sg = np.array((s_.x, s_.z, -s_.y))
    bg = np.array((b_.x, b_.z, -b_.y))
    ang = np.arctan2((P - cg) @ bg, (P - cg) @ sg)
    seam = smoothstep(0.92, 0.99, np.abs(np.sin(ang * 24)))
    col[cl] = hexc(H["collar"]) * (0.8 + 0.35 * grain[cl])[:, None] * (1 - 0.35 * seam[cl])[:, None] * (1 + 0.5 * worn[cl])[:, None]
    height[cl] = 0.3 * grain[cl] - 0.6 * seam[cl]
    hm = reg == "hame"
    wood = np.sin(P[:, 1] * 260 + 6 * fbm(P, 20.0, 2, 34)) * 0.5 + 0.5
    col[hm] = hexc(H["hame"]) * (0.75 + 0.35 * wood[hm])[:, None]
    height[hm] = 0.3 * wood[hm]
    br = reg == "brass"
    tarn = np.clip((0.95 - ao) / 0.3, 0, 1)
    col[br] = hexc(H["brass"]) * (0.85 + 0.3 * vnoise(P[br], 300.0, 35))[:, None] * (1 - 0.45 * tarn[br])[:, None]
    col[br] = col[br] * (1 - 0.3 * tarn[br])[:, None] + hexc(0x4a5a3c) * 0.3 * tarn[br][:, None]
    height[br] = 0.15 * vnoise(P[br], 800.0, 36)
    ir = reg == "iron"
    rust = smoothstep(0.6, 0.8, fbm(P, 80.0, 2, 37))
    col[ir] = hexc(H["iron"]) * (0.8 + 0.3 * vnoise(P[ir], 400.0, 38))[:, None]
    col[ir] = col[ir] * (1 - 0.6 * rust[ir])[:, None] + hexc(H["rust"]) * 0.6 * rust[ir][:, None]
    height[ir] = 0.25 * rust[ir]
    cloth = reg == "cloth"
    chk = (np.abs(np.sin(P[:, 0] * 200)) > 0.94) | (np.abs(np.sin(P[:, 2] * 200)) > 0.94)
    col[cloth] = hexc(H["cloth"]) * (0.8 + 0.4 * vnoise(P[cloth], 800.0, 39))[:, None]
    col[cloth & chk] = col[cloth & chk] * 0.4 + hexc(H["check"]) * 0.6
    height[cloth] = 0.5 * vnoise(P[cloth], 1 / 0.0015, 40)
    hf = reg == "hoof"
    lines = vnoise(P * np.array((1.0, 0.05, 1.0)), 1 / 0.0025, 41)
    pale = 0.5 * smoothstep(0.66, 0.8, vnoise(P * np.array((1.0, 0.1, 1.0)), 60.0, 42))
    col[hf] = hexc(H["hoof"]) * (0.7 + 0.5 * lines[hf])[:, None]
    col[hf] = col[hf] * (1 - pale[hf][:, None]) + hexc(0x6a5b48) * pale[hf][:, None] * (0.8 + 0.3 * lines[hf])[:, None]
    worn_bottom = smoothstep(0.03, 0.0, P[:, 1]) * hf
    col = col * (1 - 0.3 * worn_bottom[:, None]) + hexc(0x5a5048) * 0.3 * worn_bottom[:, None]
    height[hf] = 0.22 * lines[hf]
    ey = reg == "eye"
    col[ey] = hexc(H["eye"]) * (0.8 + 0.4 * vnoise(P[ey], 2000.0, 43))[:, None]
    # the occlusion over everything
    col *= (0.45 + 0.55 * ao)[:, None]
    return np.clip(col, 0, 1), height
