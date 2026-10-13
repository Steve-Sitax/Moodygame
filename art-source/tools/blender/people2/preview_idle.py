"""Check pictures for the idles, talk and sitting (package D2; docs/people.md "Idles, talk and sitting"). In
.scratch/people2-build/shots/idle/.

- sheet_<family>.png: every clip of a family, a row each: six moments across the clip from the front three-quarter
  and one from the side;
- strip_<clip>.png: one clip as twelve frames (every twelfth of it) from the front three-quarter: the motion read
  like a film strip;
- kinds_<clip>.png: the clip on the dressed kinds (smocks, skirts, aprons, the tunic) at two moments, front and back;
- sit_<family>.png: the seated clips with a stand-in seat of their height (bench, crate, chair with a back, a step).
"""

import math
import os

import bpy
from mathutils import Vector

from . import B, SHOTS
from . import preview as pv
from . import preview_move as pm

OUT = os.path.join(SHOTS, "idle")
TMP = os.path.join(OUT, "_tmp.png")


def _seat(clip, at=Vector(), yaw=0.0):
    """A stand-in seat under a seated clip (its height and kind from the clip's meta), and a back for a chair."""
    m = clip.meta
    if "seat" not in m:
        return
    h = m["seat"]
    kind = m.get("seatKind", "bench")
    d = {"bench": 0.36, "crate": 0.42, "chair": 0.42, "step": 0.32}.get(kind, 0.38)
    w = {"bench": 1.4, "crate": 0.55, "chair": 0.45, "step": 1.6}.get(kind, 0.5)
    back = m.get("seatBack", 0.0)
    # the seat's front edge is `edge` m ahead of the hips (the root); its depth runs back from there
    edge = m.get("seatEdge", 0.16)
    c = B(0.0, h / 2, edge - d / 2)
    bpy.ops.mesh.primitive_cube_add(size=1, location=c)
    s = bpy.context.object
    s.scale = (w, d, h)
    s["p2_stage"] = 1
    mt = bpy.data.materials.get("p2_crate") or bpy.data.materials.new("p2_crate")
    mt.use_nodes = True
    mt.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.26, 0.18, 0.11, 1)
    s.data.materials.append(mt)
    if kind == "chair":
        bpy.ops.mesh.primitive_cube_add(size=1, location=B(0.0, h + 0.4, edge - d + 0.015))
        bk = bpy.context.object
        bk.scale = (w, 0.03, 0.8)
        bk["p2_stage"] = 1
        bk.data.materials.append(mt)
    if kind == "step":
        # the step above, behind (a stoop of two steps)
        bpy.ops.mesh.primitive_cube_add(size=1, location=B(0.0, h * 1.5, edge - d - 0.15))
        st = bpy.context.object
        st.scale = (w, 0.3, h * 3)
        st["p2_stage"] = 1
        st.data.materials.append(mt)


def _figure(b, clip, t, yaw=0.0):
    pose, tr = clip.sample(t)
    ao, mesh = pm.figure(b, pose, tr, (Vector(), yaw))
    return ao


def _hide_rest():
    """Hide everything that is not a posed copy or the stage (the bodies, the kinds, the held things)."""
    for o in bpy.data.objects:
        if not o.get("p2_stage") and o.type in ("MESH", "ARMATURE", "EMPTY"):
            o.hide_render = True


def _eye(b, sit, view="front"):
    H = b["P"]["H"]
    h = (0.5 if not sit else 0.36) * H
    d = 2.35 * H / 1.67
    if view == "front":
        return B(0.42 * d, h + 0.18 * H, d), B(0, h, 0.06)
    if view == "side":
        return B(d, h + 0.1 * H, 0.15), B(0, h, 0.12)
    if view == "back":
        return B(-0.5 * d, h + 0.2 * H, -d), B(0, h, 0.0)
    raise KeyError(view)


def strip(clip, b, fn, n=12, W=300, H=520, view="front"):
    """n frames across the clip from the front three-quarter."""
    cam = pv.scene()
    _hide_rest()
    tiles = []
    sit = "seat" in clip.meta
    for k in range(n):
        t = clip.seconds * k / n if clip.loop else clip.seconds * k / (n - 1)
        pv.clear_stage()
        _figure(b, clip, t)
        _seat(clip)
        eye, at = _eye(b, sit, view)
        tiles.append(pv.shoot(cam, TMP, eye, at, W, H, lens=35))
    pv.save(pv.grid(tiles, 6), fn)


def sheet(items, fn, W=220, H=380, n=6):
    """A row per clip: n moments from the front three-quarter and one from the side."""
    cam = pv.scene()
    _hide_rest()
    tiles = []
    for clip, b in items:
        sit = "seat" in clip.meta
        for k in range(n + 1):
            t = clip.seconds * min(k, n - 1) / n if clip.loop else clip.seconds * min(k, n - 1) / (n - 1)
            pv.clear_stage()
            _figure(b, clip, t)
            _seat(clip)
            eye, at = _eye(b, sit, "front" if k < n else "side")
            tiles.append(pv.shoot(cam, TMP, eye, at, W, H, lens=35))
    pv.save(pv.grid(tiles, n + 1), fn)


def kinds_sheet(clip, dressed, fn, phases=(0.3, 0.7), W=230, H=380):
    """The clip on the dressed kinds of its sex (and all for the men's clips' build checks): front and back."""
    cam = pv.scene()
    _hide_rest()
    tiles = []
    for b in dressed:
        sit = "seat" in clip.meta
        for ph in phases:
            for view in ("front", "back"):
                pv.clear_stage()
                _figure(b, clip, clip.seconds * ph)
                _seat(clip)
                eye, at = _eye(b, sit, view)
                tiles.append(pv.shoot(cam, TMP, eye, at, W, H, lens=35))
    pv.save(pv.grid(tiles, 2 * len(phases)), fn)


def close(clip, b, fn, phases=(0.2, 0.45, 0.7), W=360, H=360, focus="hands"):
    """Close views (hands at the body, a scratch, folded arms): three moments, front and side."""
    cam = pv.scene()
    _hide_rest()
    tiles = []
    h = {"hands": 0.62, "head": 0.9, "lap": 0.38}[focus] * b["P"]["H"]
    for ph in phases:
        for eye in (B(0.45, h + 0.15, 1.3), B(1.35, h + 0.1, 0.25), B(-0.9, h + 0.15, -1.0)):
            pv.clear_stage()
            _figure(b, clip, clip.seconds * ph)
            _seat(clip)
            tiles.append(pv.shoot(cam, TMP, eye, B(0, h, 0.05), W, H, lens=45))
    pv.save(pv.grid(tiles, 3 * len(phases) if len(phases) < 3 else 3), fn)


def arms(clip, b, fn, t=0.3, W=420, H=420):
    """The arms close: from the front, the front three-quarter, above the shoulder, the side, behind, below."""
    cam = pv.scene()
    _hide_rest()
    tiles = []
    H_ = b["P"]["H"]
    h = 0.64 * H_
    for eye in (B(0.0, h + 0.05, 1.0), B(0.65, h + 0.1, 0.8), B(0.25, h + 0.75, 0.55), B(1.0, h, 0.05),
                B(-0.6, h + 0.1, -0.9), B(0.3, h - 0.55, 0.75)):
        pv.clear_stage()
        _figure(b, clip, clip.seconds * t)
        _seat(clip)
        tiles.append(pv.shoot(cam, TMP, eye, B(0, h, 0.0), W, H, lens=40))
    pv.save(pv.grid(tiles, 3), fn)


def run(clips, bodies, dressed, only=None, kinds=False):
    """The D2 pictures for the clips made ((clip, body) pairs): a sheet per family, a strip per clip, and (kinds)
    each clip on the dressed kinds of its sex (the men's on all four: the builds' check)."""
    os.makedirs(OUT, exist_ok=True)
    pv.hide_originals(bodies + dressed)
    fams = {}
    for c, b in clips:
        fams.setdefault(c.meta.get("family", "?"), []).append((c, b))
    lines = []
    for fam, items in fams.items():
        sel = [(c, b) for c, b in items if not only or c.name in only]
        if not sel:
            continue
        sheet(sel, os.path.join(OUT, "sheet_%s.png" % fam))
        for c, b in sel:
            strip(c, b, os.path.join(OUT, "strip_%s.png" % c.name))
            if kinds and dressed and c.meta.get("family") in ("man", "woman", "stout", "wstout"):
                ks = [k for k in dressed if k["P"]["female"]] if c.meta.get("female") else dressed
                kinds_sheet(c, ks or dressed, os.path.join(OUT, "kinds_%s.png" % c.name))
        lines.append("idle pictures: %s, %d clips" % (fam, len(sel)))
    pv.clear_stage()
    if os.path.exists(TMP):
        os.remove(TMP)
    return lines
