"""Check pictures and measures from the build (outside git): every kind lit and textured from the side, front, back
and at the face; each rig's clips frame by frame; the gaits' foot slide measured on the skinned mesh (the pad under
each paw, carried along at one stride per cycle as the game moves the animal: in stance it must not move)."""

import json
import math
import os

import bpy
import numpy as np

from . import B, FPS, SHOTS
from .anatomy import LEGS
from .clips import gaits, leg_state
from .pose import skin
from .preview import setup, shoot


def eevee():
    scn = bpy.context.scene
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"
    scn.view_settings.view_transform = "Standard"
    if scn.world is None:
        scn.world = bpy.data.worlds.new("w")
    scn.world.use_nodes = True
    bg = scn.world.node_tree.nodes.get("Background")
    if bg:
        bg.inputs[0].default_value = (0.45, 0.47, 0.5, 1)
        bg.inputs[1].default_value = 0.9
    if not bpy.data.objects.get("sun"):
        sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
        sun.data.energy = 3.2
        sun.rotation_euler = (math.radians(50), 0, math.radians(35))
        scn.collection.objects.link(sun)
    if not bpy.data.objects.get("floor"):
        bpy.ops.mesh.primitive_plane_add(size=40, location=(0, 0, 0))
        fl = bpy.context.object
        fl.name = "floor"
        m = bpy.data.materials.new("floor")
        m.diffuse_color = (0.25, 0.24, 0.22, 1)
        fl.data.materials.append(m)
    cam = bpy.data.objects.get("cam")
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scn.collection.objects.link(cam)
    scn.camera = cam


def use(ao, act):
    ad = ao.animation_data_create()
    for tr in ad.nla_tracks:
        tr.mute = True
    ad.action = act
    try:
        if len(act.slots):
            ad.action_slot = act.slots[0]
    except AttributeError:
        pass


def hide_all_but(keep):
    for o in bpy.data.objects:
        if o.type in ("MESH", "ARMATURE") and o.name not in ("floor",):
            o.hide_render = o not in keep


def kinds_pictures(built):
    eevee()
    for rname, b in built.items():
        H = b["rig"]["H"]
        for ao in b["arms"]:
            kids = [c for c in ao.children if c.name.endswith("_lod0")]
            hide_all_but([ao] + kids)
            ao.location = (0, 0, 0)
            act = bpy.data.actions.get(rname + "_idle")
            use(ao, act)
            bpy.context.scene.frame_set(1)
            n = ao.name
            d = 4.2 * H
            shoot(os.path.join(SHOTS, f"kind_{n}_side.png"), (d, 0.55 * H, 0), (0, 0.5 * H, 0), lens=50, w=900, h=640)
            shoot(os.path.join(SHOTS, f"kind_{n}_front.png"), (0.9 * H, 0.75 * H, d), (0, 0.55 * H, 0.1 * H), lens=50, w=900, h=640)
            shoot(os.path.join(SHOTS, f"kind_{n}_back.png"), (-1.2 * H, 0.9 * H, -d), (0, 0.5 * H, -0.1 * H), lens=50, w=900, h=640)
            hd = b["rig"]["J"]["head"]
            nose = b["rig"]["J"]["nose"]
            fc = (np.array(hd) + np.array(nose)) / 2
            shoot(os.path.join(SHOTS, f"kind_{n}_face.png"), (fc[0] + 0.45 * H, fc[1] + 0.12 * H, fc[2] + 0.8 * H), tuple(fc), lens=50, w=900, h=640)
        hide_all_but([])
    for o in bpy.data.objects:
        o.hide_render = False


def clip_frames(built, per=6):
    eevee()
    out = {}
    for rname, b in built.items():
        ao = b["arms"][0]
        kids = [c for c in ao.children if c.name.endswith("_lod0")]
        hide_all_but([ao] + kids)
        H = b["rig"]["H"]
        names = []
        for cname, poses, step, inf in b["baked"]:
            act = bpy.data.actions.get(rname + "_" + cname)
            use(ao, act)
            n = len(poses) * step
            for k in range(per):
                f = int(round(k * n / per))
                bpy.context.scene.frame_set(f)
                p = os.path.join(SHOTS, f"clip_{rname}_{cname}_{k}.png")
                shoot(p, (3.6 * H, 1.0 * H, 1.6 * H), (0, 0.42 * H, 0.05 * H), lens=40, w=520, h=400, frame=f)
                names.append(p)
        out[rname] = names
    for o in bpy.data.objects:
        o.hide_render = False
    return out


def slide(built):
    """Foot slide of each gait on the skinned mesh: per paw, the pad vertices' mean point while the foot stands."""
    res = {}
    for rname, b in built.items():
        R, verts, W, parts = b["R"], b["verts"], b["W"], b["parts"]
        gs = gaits(R)
        out = {}
        for cname, poses, step, inf in b["baked"]:
            if inf.get("kind") != "gait":
                continue
            g = gs[cname]
            n = len(poses)
            worst = {}
            for key in LEGS:
                toe = R.toe_rest(key)
                # the paw's pad: the lowest paw vertices nearest this toe
                d = np.linalg.norm(verts - toe, axis=1)
                from .anatomy import INDEX
                pb = INDEX[LEGS[key][0][-1]]
                cand = np.nonzero((d < 0.09 * R.H) & (W[:, pb] > 0.98))[0]
                cand = cand[np.argsort(verts[cand, 1])[:8]]
                track = []
                for i, ps in enumerate(poses):
                    t = i / n
                    _, _, _, _, u = leg_state(R, g, key, t)
                    if u is None:
                        track.append(None)
                        continue
                    v = skin(ps, verts[cand], W[cand])
                    world = v.mean(0) + np.array((0, 0, t * g.stride))
                    track.append(world)
                # stances are runs of consecutive frames (round the loop)
                runs, cur = [], []
                for i in range(2 * n):
                    w = track[i % n]
                    if w is None:
                        if cur:
                            runs.append(cur)
                        cur = []
                    else:
                        cur.append(w + np.array((0, 0, g.stride if i >= n else 0)))
                if cur:
                    runs.append(cur)
                m = 0.0
                for r in runs:
                    a = np.array(r)
                    # the flat part of the stance: before the heel lifts (the pad leaves the ground then)
                    a = a[: max(2, int(len(a) * 0.62))]
                    m = max(m, float(np.max(np.linalg.norm(a[:, [0, 2]] - a[0, [0, 2]], axis=1))))
                worst[key] = round(m * 1000, 2)
            out[cname] = worst
        res[rname] = out
    with open(os.path.join(SHOTS, "..", "slide.json"), "w", encoding="utf-8") as f:
        json.dump(res, f, indent=1)
    print("[animals] pad slide in stance (mm): " + json.dumps(res))
    return res


def run(built, preview=True, clips=False):
    slide(built)
    if preview:
        kinds_pictures(built)
    if clips:
        clip_frames(built)


def debug(built, names):
    """Close plain-shaded views of chosen clips (rig_clip:frame), from the left, the front-left and above."""
    from .preview import setup
    for rname, b in built.items():
        ao = b["arms"][0]
        kids = [c for c in ao.children if c.name.endswith("_lod0")]
        hide_all_but([ao] + kids)
        H = b["rig"]["H"]
        for nm in names:
            clip, _, fr = nm.partition(":")
            act = bpy.data.actions.get(rname + "_" + clip)
            if act is None:
                continue
            setup(textured=False)
            use(ao, act)
            f = int(fr or 1)
            for tag, eye, at in (("l", (2.6 * H, 0.45 * H, 0.0), (0, 0.35 * H, 0.05 * H)), ("fl", (1.8 * H, 0.9 * H, 2.0 * H), (0, 0.35 * H, 0.1 * H)),
                                 ("top", (0.3 * H, 3.2 * H, 0.0), (0, 0.2 * H, 0.0)), ("back", (-1.5 * H, 0.8 * H, -2.2 * H), (0, 0.35 * H, 0))):
                shoot(os.path.join(SHOTS, f"dbg_{rname}_{clip}_{f}_{tag}.png"), eye, at, lens=35, w=700, h=560, frame=f)


def verify_keys(built, clips=("walk", "trot", "run", "sit")):
    """The keyed Blender pose against the solver: every bone's tail, frame by frame (mm)."""
    from mathutils import Vector
    out = {}
    for rname, b in built.items():
        ao = b["arms"][0]
        for cname, poses, step, inf in b["baked"]:
            if cname not in clips:
                continue
            use(ao, bpy.data.actions.get(rname + "_" + cname))
            worst, where = 0.0, ""
            for i, ps in enumerate(poses[:: max(1, len(poses) // 12)]):
                k = poses.index(ps)
                bpy.context.scene.frame_set(k * step)
                bpy.context.view_layer.update()
                for bn in ("hpawL", "hpawR", "fpawL", "metaL", "shinL", "thighL", "hips", "forearmL"):
                    pb = ao.pose.bones[bn]
                    tb = ao.matrix_world @ pb.tail
                    got = np.array((tb.x, tb.z, -tb.y))
                    want = ps.h[bn] + ps.A[bn] @ (b["R"].tail0[bn] - b["R"].head0[bn])
                    e = float(np.linalg.norm(got - want))
                    if e > worst:
                        worst, where = e, f"{bn}@{k}"
            out[f"{rname}_{cname}"] = (round(worst * 1000, 2), where)
    print("[animals] keyed pose vs solver (mm): " + json.dumps(out))
    return out


def dump_toes(built, rname="mongrel", cname="walk"):
    b = built[rname]
    for c, poses, step, inf in b["baked"]:
        if c != cname:
            continue
        rows = []
        for ps in poses:
            t = ps.h["hpawL"] + ps.A["hpawL"] @ (b["R"].tail0["hpawL"] - b["R"].head0["hpawL"])
            f = ps.h["fpawL"] + ps.A["fpawL"] @ (b["R"].tail0["fpawL"] - b["R"].head0["fpawL"])
            rows.append([round(float(v), 5) for v in list(t) + list(ps.h["hips"]) + list(f) + list(ps.h["chest"]) + list(ps.h["scapulaL"]) + list(ps.h["humerusL"])])
        with open(os.path.join(SHOTS, "..", f"toes_{rname}_{cname}.json"), "w") as f:
            json.dump(rows, f)
