"""Check pictures for the kinds of package C (docs/people.md "Kinds and clothes"), in data/shots/people2/kinds/.

- cast_3m.png, cast_10m.png: every kind front, side, back and three-quarter in the game's fog at the game's own
  pixel size (a 1080-line window, 75 degrees high; the 10 m sheet blown up 3x); cast_10m_lod1.png the far copies;
- studio_<kind>.png: the kind big and clear, four sides (no fog), to judge shapes and pictures;
- close_<kind>.png: at 1 m and 2 m at the game's pixel size, by day and under a gas lamp: the face and cap, the
  hands and cuffs, the hems and feet, the hip (the sabre);
- clips_<kind>.png: the old clips idle, talk, walk, sit, lean, push, crouch and the new walk (D1) from the front
  three-quarter and the side, to see that no cloth passes through the legs;
- held.png: the held things alone and on their sockets.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import B, FOG, SHOTS
from . import preview as pv

OUT = os.path.join(SHOTS, "kinds")
TMP = os.path.join(OUT, "_tmp%d.png" % os.getpid())
PX_PER_M = 540 / math.tan(math.radians(37.5))


def _idle(ao, b, t=0.15):
    pv.clip_pose(ao, b, "idle_f" if b["P"]["female"] else "idle", t)


def _gas(at):
    """A gas lamp's warm light near a point (Blender space), the day lights dimmed."""
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.get("p2_stage"):
            o.data.energy *= 0.12
    ld = bpy.data.lights.new("gas", "POINT")
    ld.energy = 140.0
    ld.color = (1.0, 0.72, 0.42)
    ld.shadow_soft_size = 0.08
    lo = bpy.data.objects.new("gas", ld)
    lo["p2_stage"] = 1
    bpy.context.scene.collection.objects.link(lo)
    lo.location = at
    return lo


def _shoot_scaled(cam, loc, look, dist, w_m, h_m, fog=True, seed=0):
    """A picture at the game's pixel size for a camera `dist` metres away: w_m x h_m metres at that distance."""
    W = max(64, int(PX_PER_M * w_m / dist) // 2 * 2)
    H = max(64, int(PX_PER_M * h_m / dist) // 2 * 2)
    fov = 2 * math.atan(H / 2 / PX_PER_M)
    px = pv.shoot(cam, TMP, loc, look, W, H, fov_y=fov)
    return pv.fog(px, dist, seed=seed) if fog else px


def cast_sheet(dressed, dist, fn, lod="lod0"):
    cam = pv.scene(world=FOG, floor=True)
    tiles = []
    for b in dressed:
        for yaw in (0, 90, 180, 35):
            pv.clear_stage()
            ao, _ = pv.clone(b, lod)
            _idle(ao, b)
            ao.rotation_euler = (0, 0, math.radians(yaw))
            tiles.append(_shoot_scaled(cam, B(0, 1.62, dist), B(0, 0.93, 0), dist, 1.2, 1.95, seed=yaw))
    out = pv.grid(tiles, 4)
    if dist >= 8:
        out = np.repeat(np.repeat(out, 3, axis=0), 3, axis=1)
    pv.save(out, fn)


def studio(b, fn):
    cam = pv.scene()
    tiles = []
    for yaw in (0, 35, 90, 180):
        pv.clear_stage()
        ao, _ = pv.clone(b)
        _idle(ao, b)
        ao.rotation_euler = (0, 0, math.radians(yaw))
        tiles.append(pv.shoot(cam, TMP, B(0, 1.05, 4.2), B(0, 0.9, 0), 520, 1000, lens=50))
    pv.save(pv.grid(tiles, 4), fn)


def _bone_world(ao, bone, tail=False):
    pb = ao.pose.bones[bone]
    return ao.matrix_world @ (pb.tail if tail else pb.head)


def close(b, fn):
    """Close views at the game's pixel size: 1 m and 2 m, day and gas light."""
    cam = pv.scene(world=FOG, floor=True)
    tiles = []
    for gas in (False, True):
        pv.clear_stage()
        for o in list(bpy.data.objects):
            if o.name.startswith("gas"):
                bpy.data.objects.remove(o)
        cam = pv.scene(world=FOG, floor=True)
        ao, _ = pv.clone(b)
        _idle(ao, b)
        ao.rotation_euler = (0, 0, math.radians(20))
        bpy.context.view_layer.update()
        head = _bone_world(ao, "head") + Vector((0, 0, 0.09))
        if gas:
            _gas(head + Vector((0.9, -1.4, 0.9)))
        chest = _bone_world(ao, "upperChest")
        handL = _bone_world(ao, "handL", tail=True)
        hip = _bone_world(ao, "hipL") + Vector((0, 0, -0.15))
        feet = (_bone_world(ao, "footL") + _bone_world(ao, "footR")) / 2 + Vector((0, -0.05, 0.12))
        shots = [(head, 1.0, 0.5, 0.5, Vector((0.1, -1, 0.05))), (head + Vector((0, 0, -0.25)), 2.0, 0.9, 0.9, Vector((0.3, -1, 0.05))),
                 (handL, 1.0, 0.45, 0.5, Vector((0.6, -1, 0.1))), (hip, 1.0, 0.6, 0.7, Vector((0.9, -0.6, 0.1))),
                 (feet, 1.0, 0.7, 0.55, Vector((0.25, -1, 0.35))), (chest, 1.5, 0.8, 0.9, Vector((-0.6, 1, 0.1)))]
        for look, d, w, h, dirn in shots:
            loc = look + dirn.normalized() * d
            tiles.append(_shoot_scaled(cam, loc, look, d, w, h, fog=True, seed=int(d * 10)))
    hmax = max(t.shape[0] for t in tiles)
    tiles = [np.pad(t, ((0, hmax - t.shape[0]), (0, 0), (0, 0)), constant_values=0.05) for t in tiles]
    pv.save(pv.grid(tiles, 6), fn)


def detail(b, fn, gas=False):
    """Big, clear close views to judge the work: the head from the front and behind, the neck and chest, a hand
    and its cuff, the hem and the knees, the feet, the left shoulder, the left hip."""
    cam = pv.scene()
    pv.clear_stage()
    ao, _ = pv.clone(b)
    _idle(ao, b)
    bpy.context.view_layer.update()
    if gas:
        _gas(_bone_world(ao, "head") + Vector((0.8, -1.2, 0.6)))
    head = _bone_world(ao, "head") + Vector((0, 0, 0.08))
    neck = _bone_world(ao, "neck") + Vector((0, 0, -0.04))
    hand = _bone_world(ao, "handL", tail=True)
    knee = (_bone_world(ao, "legLowL") + _bone_world(ao, "legLowR")) / 2
    foot = (_bone_world(ao, "footL") + _bone_world(ao, "footR")) / 2 + Vector((0, -0.06, -0.03))
    shL = _bone_world(ao, "armUpL")
    hip = _bone_world(ao, "hipL") + Vector((0, 0, -0.18))
    views = [(head, Vector((0.35, -1, 0.05)), 0.55), (head, Vector((-0.6, 1, 0.15)), 0.55),
             (neck, Vector((0.15, -1, 0.1)), 0.7), (hand, Vector((0.8, -0.7, 0.15)), 0.55),
             (knee + Vector((0, 0, 0.12)), Vector((0.5, -1, 0.1)), 1.2), (foot, Vector((0.55, -1, 0.45)), 0.75),
             (shL, Vector((0.7, -0.2, 0.5)), 0.8), (hip, Vector((1, -0.35, 0.05)), 0.95)]
    tiles = []
    for look, d, dist in views:
        tiles.append(pv.shoot(cam, TMP, look + d.normalized() * dist, look, 520, 520, lens=60))
    pv.save(pv.grid(tiles, 4), fn)


WALKS = {"man_middling": "man_walk", "man_slight": "man_walk", "man_stout": "stout_walk",
         "woman_middling": "woman_walk", "woman_slight": "woman_walk", "woman_stout": "woman_walk",
         "old_man": "old_walk", "old_woman": "old_walk", "child_middling": "child_walk", "child_slight": "child_walk"}


def clips_sheet(b, move_clips, fn):
    """Each check clip from the front three-quarter (top row) and the side (bottom row)."""
    from . import preview_move as pm

    cam = pv.scene()
    fem = b["P"]["female"]
    items = [("idle_f" if fem else "idle", 0.15), ("talk_f" if fem else "talk", 0.4), ("walk_f" if fem else "walk", 0.12),
             ("walk_f" if fem else "walk", 0.62), ("sit", 0.3), ("lean", 0.3), ("push", 0.12), ("crouch", 0.3)]
    new = next((c for c, _ in move_clips if c.name == WALKS.get(b["kind"].body)), None)
    if new is not None:
        items += [(new, 0.0), (new, 0.125), (new, 0.25)]
    tiles = {30: [], 95: []}
    for yaw in (30, 95):
        for clip, t in items:
            pv.clear_stage()
            ao, _ = pv.clone(b)
            if isinstance(clip, str):
                pv.place(ao, 0, pv.lift(b, clip), 0, yaw)
                if clip in ("sit",):
                    pv.seat(-0.02, 0, -0.12, yaw)
                if clip == "lean":
                    bpy.ops.mesh.primitive_cube_add(size=1, location=B(0.3, 1.0, 0.5))
                    r = bpy.context.object
                    r.scale = (1.4, 0.06, 0.06)
                    r.rotation_euler = (0, 0, math.radians(yaw))
                    r["p2_stage"] = 1
                pv.clip_pose(ao, b, clip, t)
            else:
                pose, tr = clip.sample(clip.seconds * t)
                pm.apply(ao, pose, tr)
                ao.rotation_euler = (0, 0, math.radians(yaw))
            tiles[yaw].append(pv.shoot(cam, TMP, B(1.0, 1.15, 2.9), B(0, 0.8, 0), 330, 500, lens=50))
    pv.save(pv.grid(tiles[30] + tiles[95], len(items)), fn)


def cast(dressed, bodies, actions, move_clips, held_obs):
    os.makedirs(OUT, exist_ok=True)
    lines = []
    if not dressed:
        return lines
    only = os.environ.get("PEOPLE2_DRESS_SHOTS", "cast,studio,close,detail,clips,held").split(",")
    for b in bodies + dressed:
        for k in ("ao", "lod0", "lod1"):
            b[k].hide_render = True
    for o in held_obs:
        o.hide_render = True
    if "cast" in only:
        cast_sheet(dressed, 3.0, os.path.join(OUT, "cast_3m.png"))
        cast_sheet(dressed, 10.0, os.path.join(OUT, "cast_10m.png"))
        cast_sheet(dressed, 10.0, os.path.join(OUT, "cast_10m_lod1.png"), lod="lod1")
    for b in dressed:
        if "studio" in only:
            studio(b, os.path.join(OUT, "studio_%s.png" % b["name"]))
        if "close" in only:
            close(b, os.path.join(OUT, "close_%s.png" % b["name"]))
        if "detail" in only:
            detail(b, os.path.join(OUT, "detail_%s.png" % b["name"]))
            detail(b, os.path.join(OUT, "detail_gas_%s.png" % b["name"]), gas=True)
        if "clips" in only:
            clips_sheet(b, move_clips, os.path.join(OUT, "clips_%s.png" % b["name"]))
    if "held" in only and held_obs:
        from . import held
        held.sheet(dressed, held_obs, os.path.join(OUT, "held.png"))
    pv.clear_stage()
    if os.path.exists(TMP):
        os.remove(TMP)
    for b in dressed:
        lines.append("kind %-12s %6d / %5d triangles (near / far)" % (b["name"], b["counts"]["lod0"], b["counts"]["lod1"]))
    return lines
