"""Check pictures for the motion clips (docs/people.md "Locomotion", checks). In data/shots/people2/move/.

- strip: one clip as a row of frames from the side (the camera rides along), so the shape of the cycle shows;
- chrono: one clip as a chronophotograph: the frames drawn where they happen along the ground, side by side in one
  picture (as Muybridge and Marey shot walkers), so a foot that slides shows as smeared feet and a planted foot as
  one sharp foot shared by several figures;
- turntable: one frame of a clip from eight sides;
- blend: a walker speeding up from a stroll to a run (and a sprint) by blending the loops as the games will, in one
  chronophotograph and one strip.
The renders use preview.py's stage (lights, ground, camera) and EEVEE.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Quaternion, Vector

from . import B, FPS, SHOTS
from . import motion as mo
from . import preview as pv

OUT = os.path.join(SHOTS, "move")
TMP = os.path.join(OUT, "_tmp.png")


def apply(ao, pose, tr):
    bones = ao.data.bones
    for pb in ao.pose.bones:
        q = pose.get(pb.name, Quaternion())
        r = bones[pb.name].matrix_local.to_quaternion()
        pb.rotation_mode = "QUATERNION"
        pb.rotation_quaternion = r.inverted() @ q @ r
        pb.location = Vector()
    ao.pose.bones["hips"].location = bones["hips"].matrix_local.to_3x3().inverted() @ Vector(tr)


def stage(samples=16):
    cam = pv.scene()
    try:
        bpy.context.scene.eevee.taa_render_samples = samples
    except AttributeError:
        pass
    return cam


def ground_marks(length=12.0, step=0.5, stairs=None, slope=0.0, x0=-2.0):
    """Light lines across the ground every `step` m (to read distances), or stairs, or a slope."""
    mat = bpy.data.materials.get("p2_mark") or bpy.data.materials.new("p2_mark")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.35, 0.33, 0.3, 1)
    if stairs:
        for o in bpy.data.objects:
            if o.get("p2_floor"):
                o.hide_render = True
        rise, going, n, sgn = stairs
        for k in range(-2, n):
            bpy.ops.mesh.primitive_cube_add(size=1)
            o = bpy.context.object
            z_top = sgn * k * rise
            o.scale = (1.4, going, 3.0)
            o.location = (0, -(k + 0.5) * going, z_top - 1.5)
            o["p2_stage"] = 1
            o.data.materials.append(mat)
        return
    if slope:
        bpy.ops.mesh.primitive_plane_add(size=1)
        o = bpy.context.object
        o.scale = (1.6, length, 1)
        o.rotation_euler = (-math.radians(slope), 0, 0)
        o.location = (0, -length / 2 + 1, (length / 2 - 1) * math.tan(math.radians(slope)))
        o["p2_stage"] = 1
        o.data.materials.append(mat)
        return
    k = 0
    f = x0
    while f < length:
        bpy.ops.mesh.primitive_plane_add(size=1, location=(0, -f, 0.0005))
        o = bpy.context.object
        o.scale = (1.2, 0.008, 1)
        o["p2_stage"] = 1
        o.data.materials.append(mat)
        f += step
        k += 1


def figure(b, pose, tr, at=(Vector(), 0.0), lod="lod0", name=None):
    ao, mesh = pv.clone(b, lod, name)
    apply(ao, pose, tr)
    ao.location = Vector(at[0])
    ao.rotation_euler = (0, 0, math.radians(at[1]))
    return ao, mesh


def strip(clip, b, n=8, fn=None, side=True, W=300, H=460, follow=True):
    """n frames of the clip from the side, the camera riding with the person (with its hips, for clips that
    travel)."""
    cam = stage()
    tiles = []
    for k in range(n):
        t = clip.seconds * k / n
        pose, tr = clip.sample(t)
        pv.clear_stage()
        figure(b, pose, tr, (Vector(), 0.0))
        h = 0.85 * b["P"]["H"] / 1.67
        c = Vector((0.0, tr.y, 0.0)) if follow else Vector()
        eye = (B(3.2, h + 0.15, 0.0) if side else B(1.6, h + 0.3, 2.8)) + c
        tiles.append(pv.shoot(cam, TMP, eye, B(0, h - 0.05, 0.0) + c, W, H, lens=40))
    pv.save(pv.grid(tiles, n), fn)


def video(clip, b, path, W=640, H=400, ortho=None, every=1):
    """The clip as a film from the side (the camera rides with the node and the hips), ground lines every half
    metre so the ground is seen to pass; frames into a folder, then an mp4 by ffmpeg if it is installed."""
    import shutil
    import subprocess

    cam = stage()
    pv.clear_stage()
    d = os.path.splitext(path)[0] + "_frames"
    os.makedirs(d, exist_ok=True)
    ground_marks(length=60.0, step=0.5, x0=-3.0)
    h = 0.85 * b["P"]["H"] / 1.67
    k = 0
    for f in range(0, clip.frames, every):
        for o in [o for o in bpy.data.objects if o.get("p2_stage") and o.type in ("ARMATURE",) or
                  (o.get("p2_stage") and o.type == "MESH" and o.parent is not None)]:
            bpy.data.objects.remove(o)
        t = f / FPS
        pose, tr = clip.sample(t)
        ap, ay = clip.root(t)
        figure(b, pose, tr, (ap, ay))
        c = Vector((ap.x, ap.y + tr.y, 0.0))
        pv.shoot(cam, os.path.join(d, "f%04d.png" % k), B(3.6, h + 0.2, 0.0) + c, B(0, h - 0.1, 0.0) + c, W, H, lens=35)
        k += 1
    ff = shutil.which("ffmpeg")
    if ff:
        subprocess.run([ff, "-y", "-loglevel", "error", "-framerate", str(FPS // every), "-i", os.path.join(d, "f%04d.png"),
                        "-pix_fmt", "yuv420p", "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2", path], check=False, timeout=300)
        shutil.rmtree(d, ignore_errors=True)


def chrono(clip, b, n=None, fn=None, every=2, W=1800, H=520, stairs=None, slope=0.0, spread=None):
    """The clip's frames side by side where they happen (in-place loops are moved by their root)."""
    cam = stage()
    pv.clear_stage()
    frames = list(range(0, clip.frames, every))
    if n:
        frames = frames[:n]
    pts = []
    for f in frames:
        t = f / FPS
        pose, tr = clip.sample(t)
        ap, ay = clip.root(t)
        if spread:
            ap = ap + Vector((0, -spread * f / FPS, 0))
        figure(b, pose, tr, (ap, ay), lod="lod1")
        pts.append(ap + Vector(tr) + b["ao"].data.bones["hips"].head_local)
    ground_marks(stairs=stairs, slope=slope)
    ys = [p.y for p in pts]
    zs = [p.z for p in pts]
    cy = (min(ys) + max(ys)) / 2
    cz = (min(zs) + max(zs)) / 2 - 0.1
    span = max(1.0, max(ys) - min(ys)) + 1.2
    pv.save(pv.shoot(cam, TMP, (6.0, cy, cz + 0.3), (0, cy, cz), W, H, ortho=max(span, 2.2 * W / H)), fn)


def turntable(clip, b, t, fn, W=300, H=460):
    cam = stage()
    tiles = []
    pose, tr = clip.sample(t)
    for k in range(8):
        pv.clear_stage()
        figure(b, pose, tr, (Vector(), 45.0 * k))
        h = 0.85 * b["P"]["H"] / 1.67
        tiles.append(pv.shoot(cam, TMP, B(0, h + 0.4, 3.6), B(0, h - 0.05, 0), W, H, lens=40))
    pv.save(pv.grid(tiles, 8), fn)


def feet_plot(clip, fn, W=900, H=300):
    """Each foot's heel and ball height (y) and forward position against time, drawn into a picture: stance shows
    as flat lines on the ground."""
    sk = clip.skel
    img = np.ones((H, W, 3), np.float32) * 0.08
    n = clip.frames
    cols = {("L", "heel"): (1, 0.4, 0.3), ("L", "ball"): (1, 0.8, 0.3), ("R", "heel"): (0.3, 0.6, 1),
            ("R", "ball"): (0.4, 1, 0.8)}
    for i in range((n - 1) * 4 + 1):
        t = i / (4 * FPS)
        pose, tr = clip.sample(t)
        ps = sk.fk(pose, tr)
        x = int((W - 1) * t / max(1e-6, clip.seconds))
        for S in "LR":
            c = mo.contacts(ps, sk, S)
            for k in ("heel", "ball"):
                p = c[k]
                y = int(H * 0.1 + (H * 0.8) * min(1.0, max(0.0, p.z / 0.5)))
                img[min(H - 1, y), x] = cols[(S, k)]
    pv.save(img, fn)


def sheet(items, fn, phases=(0.0, 0.125, 0.25, 0.375), front=(0.0, 0.25), W=260, H=380):
    """A contact sheet: one row per clip (items: (clip, body)), side views at the given shares of the clip, then
    views from ahead (three-quarter) at the `front` shares."""
    cam = stage()
    tiles = []
    for clip, b in items:
        h = 0.85 * b["P"]["H"] / 1.67
        for k, ph in enumerate(list(phases) + list(front)):
            pv.clear_stage()
            pose, tr = clip.sample(clip.seconds * ph)
            figure(b, pose, tr)
            if k < len(phases):
                eye, at = B(3.0, h + 0.1, 0.0), B(0, h - 0.08, 0.0)
            else:
                eye, at = B(1.4, h + 0.25, 2.9), B(0, h - 0.08, 0.0)
            tiles.append(pv.shoot(cam, TMP, eye, at, W, H, lens=38))
    pv.save(pv.grid(tiles, len(phases) + len(front)), fn)


def _mat(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*rgb, 1)
    return m


def _rod(a, b, r, mat):
    a, b = Vector(a), Vector(b)
    bpy.ops.mesh.primitive_cylinder_add(radius=r, depth=(b - a).length, vertices=10)
    o = bpy.context.object
    o.location = (a + b) / 2
    o.rotation_euler = (b - a).to_track_quat("Z", "Y").to_euler()
    o["p2_stage"] = 1
    o.data.materials.append(mat)
    return o


def stand_in(kind, sk, pose, tr, at=(Vector(), 0.0)):
    """Plain stand-ins for the things a clip holds (the real models are props.glb's): a sack on the shoulder, a
    crate, the handcart's shafts and wheels, the sack truck's frame. Placed from the clip's own pose, so the
    hands can be checked on them."""
    from . import clips_move as cm

    ps = sk.fk(pose, tr)
    M = mo.Matrix.Translation(Vector(at[0])) @ mo.Matrix.Rotation(math.radians(at[1]), 4, "Z")
    wood, sack, iron = _mat("p2_wood", (0.33, 0.22, 0.12)), _mat("p2_sack", (0.55, 0.46, 0.32)), _mat("p2_iron", (0.12, 0.12, 0.13))
    L = cm.LOADS["crate" if kind == "carry" else kind]
    if kind == "sack":
        c = ps.point("upperChest", sk.rest["armUpL"] + mo.V(*L["centre"]))
        bpy.ops.mesh.primitive_uv_sphere_add(radius=1, location=M @ c)
        o = bpy.context.object
        o.scale = (0.13, 0.44, 0.13)
        o.rotation_euler = (M.to_quaternion() @ ps.D["upperChest"]).to_euler()
        o["p2_stage"] = 1
        o.data.materials.append(sack)
    elif kind == "carry":
        c = ps.point("chest", sk.rest["chest"] + mo.V(*L["centre"]))
        bpy.ops.mesh.primitive_cube_add(size=1, location=M @ c)
        o = bpy.context.object
        o.scale = (0.55, 0.34, 0.42)
        o.rotation_euler = (M.to_quaternion() @ ps.D["chest"]).to_euler()
        o["p2_stage"] = 1
        o.data.materials.append(wood)
    else:
        hs = [mo.V(*h) for h in L["handles"]]
        if kind == "cart_push":
            for h in hs:
                _rod(M @ h, M @ (h + mo.V(h.x * 0.25, 2.0, -0.04)), 0.025, wood)
            for sx in (1, -1):
                bpy.ops.mesh.primitive_cylinder_add(radius=0.57, depth=0.06, vertices=24,
                                                    location=M @ mo.V(0.64 * sx, 2.1, 0.57), rotation=(0, math.pi / 2, 0))
                bpy.context.object["p2_stage"] = 1
                bpy.context.object.data.materials.append(wood)
        elif kind == "cart_pull":
            for h in hs:
                _rod(M @ (h + mo.V(0, 0.25, 0)), M @ (h + mo.V(h.x * 0.25, -1.8, -0.04)), 0.025, wood)
            for sx in (1, -1):
                bpy.ops.mesh.primitive_cylinder_add(radius=0.57, depth=0.06, vertices=24,
                                                    location=M @ mo.V(0.64 * sx, -1.9, 0.57), rotation=(0, math.pi / 2, 0))
                bpy.context.object["p2_stage"] = 1
                bpy.context.object.data.materials.append(wood)
        else:
            ahead = 1 if kind == "truck_push" else -1
            wheel = mo.V(0, 0.98 * ahead + hs[0].y * 0.0, 0.15) if ahead > 0 else mo.V(0, -0.95, 0.15)
            wheel = mo.V(0, hs[0].y + 0.85 * ahead, 0.15)
            for h in hs:
                foot = mo.V(h.x * 0.86, wheel.y, 0.05)
                _rod(M @ h, M @ foot, 0.022, wood)
            _rod(M @ mo.V(-0.3, wheel.y, 0.15), M @ mo.V(0.3, wheel.y, 0.15), 0.15, iron)


def carry_sheet(items, fn, phases=(0.0, 0.25), W=320, H=440):
    """Carried things: per clip side and three-quarter views at two phases, with the stand-ins."""
    cam = stage()
    tiles = []
    for clip, b, kind in items:
        sk = clip.skel
        hgt = 0.85 * b["P"]["H"] / 1.67
        for ph in phases:
            for eye in (B(3.2, hgt + 0.2, 0.0), B(1.9, hgt + 0.5, 2.6), B(-1.9, hgt + 0.6, -2.4)):
                pv.clear_stage()
                pose, tr = clip.sample(clip.seconds * ph)
                figure(b, pose, tr)
                stand_in(kind, sk, pose, tr)
                tiles.append(pv.shoot(cam, TMP, eye, B(0, hgt - 0.1, 0.25), W, H, lens=34))
    pv.save(pv.grid(tiles, 3 * len(phases)), fn)


def turntables(items, fn, W=200, H=300):
    """A turntable per clip: one row per clip, the frame at a quarter of the clip seen from eight sides."""
    cam = stage()
    tiles = []
    for clip, b in items:
        pose, tr = clip.sample(clip.seconds * 0.25)
        h = 0.85 * b["P"]["H"] / 1.67
        c = Vector((0.0, tr.y, 0.0))
        for k in range(8):
            pv.clear_stage()
            figure(b, pose, tr, (Vector(), 45.0 * k))
            cc = mo.Matrix.Rotation(math.radians(45.0 * k), 3, "Z") @ c
            tiles.append(pv.shoot(cam, TMP, B(0, h + 0.45, 3.4) + cc, B(0, h - 0.05, 0) + cc, W, H, lens=40))
    pv.save(pv.grid(tiles, 8), fn)


def cast_move(clips, bodies):
    """The D1 check pictures (data/shots/people2/move/), from the clips make_all made: (clip, body) pairs.
    Returns the speed-blend measures as lines to print."""
    from . import clips_move as cm

    os.makedirs(OUT, exist_ok=True)
    pv.hide_originals(bodies)
    by = {c.name: (c, b) for c, b in clips}

    def floor_on():
        for o in bpy.data.objects:
            if o.get("p2_floor"):
                o.hide_render = False

    for style, st in cm.STYLES.items():
        items = [by[n] for n in ["%s_%s" % (style, s) for s in st["speeds"]] if n in by]
        if items:
            sheet(items, os.path.join(OUT, "sheet_%s.png" % style))
            turntables(items, os.path.join(OUT, "turntable_%s.png" % style))
    for style in ("man", "woman"):
        for nm in ("slope_up", "slope_down", "stairs_up", "stairs_down"):
            n = "%s_%s" % (style, nm)
            if n not in by:
                continue
            c, b = by[n]
            m = c.meta.get("stairs")
            st = (m["rise"], m["going"], 14, 1 if m["up"] else -1) if m else None
            chrono(c, b, fn=os.path.join(OUT, "chrono_%s.png" % n), every=3, stairs=st, slope=c.meta.get("slope", 0.0))
            floor_on()
            strip(c, b, n=8, fn=os.path.join(OUT, "strip_%s.png" % n), follow=False)
        items = [by[n] for n in ("%s_slope_up" % style, "%s_slope_down" % style, "%s_stairs_up" % style,
                                 "%s_stairs_down" % style) if n in by]
        if items:
            turntables(items, os.path.join(OUT, "turntable_%s_climbs.png" % style))
    pairs = (("sack", "sack_walk"), ("carry", "crate_walk"), ("cart_push", "cart_push"), ("cart_pull", "cart_pull"),
             ("truck_push", "truck_push"), ("truck_pull", "truck_pull"))
    walks = [(by[n][0], by[n][1], k) for k, n in pairs if n in by]
    if walks:
        carry_sheet(walks, os.path.join(OUT, "carries.png"))
        turntables([(c, b) for c, b, _ in walks], os.path.join(OUT, "turntable_carries.png"))
    holds = [(by[n][0], by[n][1], k) for k, n in ((k, cm.HOLD_NAMES[k] + "_hold") for k, _ in pairs) if n in by]
    if holds:
        carry_sheet(holds, os.path.join(OUT, "holds.png"), phases=(0.0,))
    for style in ("man", "woman"):
        trans = [n for n in by if n.startswith(style + "_start") or n.startswith(style + "_stop")]
        for n in trans:
            c, b = by[n]
            strip(c, b, n=10, fn=os.path.join(OUT, "strip_%s.png" % n))
        items = [by[n] for n in trans]
        if items:
            turntables(items, os.path.join(OUT, "turntable_%s_startstop.png" % style))
        turns = [by[n] for n in by if n.startswith(style + "_turn")]
        if turns:
            cam = stage()
            tiles = []
            for c, b in turns:
                for k in range(8):
                    pose, tr = c.sample(c.seconds * k / 7)
                    pv.clear_stage()
                    figure(b, pose, tr)
                    tiles.append(pv.shoot(cam, TMP, (1.2, -3.4, 2.4), (0, 0, 0.7), 240, 320, lens=38))
            pv.save(pv.grid(tiles, 8), os.path.join(OUT, "turns_%s.png" % style))
    # the speed blend: stroll to the fastest loop in one take, with the feet locked as the games should
    lines = []
    for style in ("man", "woman", "child"):
        names = ["%s_%s" % (style, s) for s in cm.STYLES[style]["speeds"]]
        if not all(n in by for n in names):
            continue
        loops = [by[n][0] for n in names]
        b = by[names[0]][1]
        lo, hi = loops[0].meta["speed"], loops[-1].meta["speed"]
        secs = 8.0
        c = cm.blend_by_speed(loops, lambda t, lo=lo, hi=hi: lo + (hi - lo) * mo.smoothstep(t / secs), secs,
                              "blend_" + style)
        raw = mo.slide(c)
        hit = cm.hitches(c)
        mo.lock_feet(c)
        lk = mo.slide(c)
        own = max(cm.hitches(lp)[0] for lp in loops)
        lines.append("blend %s %.1f to %.1f m/s in %.0f s: stance slip %.1f mm with the feet locked (%.1f mm "
                     "without), sharpest change %.1f deg/frame^2 (the loops' own up to %.1f)" % (
                         style, lo, hi, secs, 1000 * max(v["keys"] for v in lk.values()),
                         1000 * max(v["keys"] for v in raw.values()), hit[0], own))
        cam = stage()
        tiles = []
        h = 0.85 * b["P"]["H"] / 1.67
        for k in range(16):
            t = secs * k / 15
            pose, tr = c.sample(t)
            pv.clear_stage()
            ap, ay = c.root(t)
            figure(b, pose, tr, (ap, ay))
            cc = Vector((0, ap.y, 0))
            tiles.append(pv.shoot(cam, TMP, Vector((3.2, 0, h + 0.15)) + cc, Vector((0, 0, h)) + cc, 240, 380, lens=40))
        pv.save(pv.grid(tiles, 8), os.path.join(OUT, "blend_%s.png" % style))
        if style == "man":
            video(c, b, os.path.join(OUT, "blend_man.mp4"))
    if os.path.exists(TMP):
        os.remove(TMP)
    return lines
