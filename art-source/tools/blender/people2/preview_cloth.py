"""Check pictures of the dressed kinds' clothes (docs/people.md "Clothes: high detail"), from a saved build scene:

    blender -b <scene saved with PEOPLE2_SAVE_BLEND> --python-exit-code 1 -P art-source/tools/blender/people2_sheets.py
        -- cloth [kinds=docker_a,fishwife_a] [out=<folder>]

with PEOPLE2_RIG / PEOPLE2_PICTURES_DIR for a trial build. Per kind, in SHOTS/cloth/ (or out=):
- <kind>_3m.png: front, side, back and three-quarter at 3 m (the game's 75 degree view);
- <kind>_1m.png: the same four at 1 m (head to the knees);
- <kind>_sit.png: seated on a bench (the family's D2 clip, or the old sit), front, three-quarter, side, back at 2 m;
- <kind>_walk.png: walking at two moments, three-quarter and side at 2.5 m;
- <kind>_close.png: close views (0.45 m): the collar front and back (the nape), a cuff and hand, the waist, the
  hem, the left shoulder, the feet from the front and the side, the cap;
- <kind>_low.png: the feet and hems from low, front and back, at 1 m.
Day light (a sun and the sky); `gas` adds the same at 19:30 under a gas lamp for the close sheet.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Vector

from . import SHOTS
from . import face_types as ft
from . import preview_mh as pm

OUT = os.path.join(SHOTS, "cloth")
FOV = math.radians(75.0)
SIT = {"docker_a": "man_sit_crate", "police": "man_sit_bench", "sooi": "stout_sit_bench",
       "fishwife_a": "wstout_sit_bench"}
SEAT = {"man_sit_crate": (0.40, 0.42, 0.55), "man_sit_bench": (0.45, 0.36, 1.4), "stout_sit_bench": (0.45, 0.36, 1.4),
        "wstout_sit_bench": (0.45, 0.36, 1.4), "woman_sit_bench": (0.45, 0.36, 1.4)}
WALK = {"fishwife_a": "walk_f"}


def pose(ao, clip, t):
    """The copy in a clip's pose at loop fraction t (the build's actions)."""
    act = bpy.data.actions.get(clip)
    if act is None:
        return False
    for pb in ao.pose.bones:  # channels a clip does not key keep the last clip's values otherwise
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.rotation_euler = (0, 0, 0)
    ad = ao.animation_data or ao.animation_data_create()
    ad.action = act
    if getattr(act, "slots", None) and len(act.slots):
        try:
            ad.action_slot = act.slots[0]
        except Exception:  # noqa: BLE001
            pass
    f0, f1 = act.frame_range
    bpy.context.scene.frame_set(int(round(f0 + (f1 - f0) * t)))
    bpy.context.view_layer.update()
    return True


def cam(loc, look, fov=FOV, res=(960, 540)):
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = res
    pm.camera(loc, look)
    c = sc.camera
    c.data.sensor_fit = "VERTICAL"
    c.data.angle_y = fov


def seat_box(h, d, w, edge=0.16):
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, -(edge - d / 2), h / 2))
    s = bpy.context.object
    s.scale = (w, d, h)
    s["p2_stage"] = 1
    m = bpy.data.materials.get("p2_bench") or bpy.data.materials.new("p2_bench")
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.24, 0.17, 0.11, 1)
    s.data.materials.append(m)
    return s


def gas_light(on):
    for o in bpy.data.objects:
        if o.type == "LIGHT" and o.get("p2_stage") and not o.name.startswith("p2gas"):
            o.data.energy = o.get("p2_day", o.data.energy) * (0.08 if on else 1.0)
            o["p2_day"] = o.get("p2_day", o.data.energy)
    g = bpy.data.objects.get("p2gas")
    if on and g is None:
        ld = bpy.data.lights.new("p2gas", "POINT")
        ld.energy = 160.0
        ld.color = (1.0, 0.72, 0.42)
        ld.shadow_soft_size = 0.06
        g = bpy.data.objects.new("p2gas", ld)
        g["p2_stage"] = 1
        bpy.context.scene.collection.objects.link(g)
        g.location = (1.1, -1.3, 2.6)
    if g is not None:
        g.hide_render = not on


def world_of(ao, bone, tail=False):
    pb = ao.pose.bones[bone]
    return ao.matrix_world @ (pb.tail if tail else pb.head)


def _shot(paths, out, name, loc, look, fov=FOV, res=(960, 540)):
    cam(loc, look, fov, res)
    p = os.path.join(out, "_t", name + ".png")
    pm.render(p)
    paths.append(p)


def around(ao, dist, h_cam, h_look, yaws=(0, 90, 180, 35)):
    out = []
    for yaw in yaws:
        a = math.radians(yaw)
        out.append(((math.sin(a) * dist, -math.cos(a) * dist, h_cam), (0, 0, h_look)))
    return out


def kind_sheets(kind, out, gas=False):
    rig, cells = pm._rig(), pm._faces_json()["cells"]
    sex = "f" if rig["kinds"][kind]["sex"] == "f" else "m"
    face = ft.face_for(2000 + len(kind), kind, sex, 40)
    if not os.path.exists(os.path.join(pm.PICS, face["cell"] + "_face_colour.png")):
        face["cell"] = "f_fair_brown" if sex == "f" else "m_mid_brown"  # a trial build has the default faces only
    pm.clear()
    pm.hide_all()
    pm.stage(res=(960, 540))
    ao, ms = pm.person(kind, face, rig=rig, cells=cells)
    fam_idle = "idle_f" if sex == "f" else "idle"
    pose(ao, fam_idle, 0.15)
    bpy.context.view_layer.update()
    top = max((o.matrix_world @ Vector(c)).z for o in ms for c in o.bound_box)
    made = []
    # 3 m and 1 m, four sides
    for tag, dist, hc, hl, res in (("3m", 3.0, 1.62, 0.92, (720, 900)), ("1m", 1.0, 1.58, top - 0.42, (720, 900))):
        ps = []
        for k, (loc, look) in enumerate(around(ao, dist, hc, hl)):
            _shot(ps, out, "%s_%s_%d" % (kind, tag, k), loc, look, res=res)
        fn = os.path.join(out, "%s_%s.png" % (kind, tag))
        pm.sheet(ps, 4, fn, w=360)
        made.append(fn)
    # walking
    ps = []
    walk = WALK.get(kind, "walk")
    for t in (0.2, 0.45):
        if pose(ao, walk, t):
            for loc, look in around(ao, 2.5, 1.5, 0.85, yaws=(35, 90)):
                _shot(ps, out, "%s_walk_%d_%d" % (kind, int(t * 100), len(ps)), loc, look, res=(720, 900))
    if ps:
        fn = os.path.join(out, "%s_walk.png" % kind)
        pm.sheet(ps, 4, fn, w=360)
        made.append(fn)
    # seated
    ps = []
    clip = SIT.get(kind)
    if clip and bpy.data.actions.get(clip) is not None:
        h, d, w = SEAT[clip]
        pose(ao, clip, 0.3)
    else:
        clip, (h, d, w) = "sit", (0.45, 0.36, 1.4)
        pose(ao, "sit", 0.3)
        hips = rig["kinds"][kind]["hipsBone"]
        k = hips / 0.95
        ao.location.z = 0.45 + 0.07 * k - 0.9 * k
    bench = seat_box(h, d, w)
    for loc, look in around(ao, 2.0, 1.2, 0.55, yaws=(0, 35, 90, 180)):
        _shot(ps, out, "%s_sit_%d" % (kind, len(ps)), loc, look, res=(720, 720))
    fn = os.path.join(out, "%s_sit.png" % kind)
    pm.sheet(ps, 4, fn, w=360)
    made.append(fn)
    bpy.data.objects.remove(bench)
    ao.location.z = 0.0
    # close views, standing
    pose(ao, fam_idle, 0.15)
    bpy.context.view_layer.update()
    neck = world_of(ao, "neck")
    head = world_of(ao, "head")
    hand = world_of(ao, "handL", tail=True)
    hips = world_of(ao, "hips")
    sh = world_of(ao, "shoulderL", tail=True)
    footL = world_of(ao, "footL")
    hem_y = 0.40 if sex == "m" else 0.12
    views = [("collar", neck + Vector((0, 0, 0.02)), Vector((0.15, -1, 0.15))),
             ("nape", neck + Vector((0, 0, 0.03)), Vector((-0.1, 1, 0.25))),
             ("cuff", hand + Vector((0, 0, 0.06)), Vector((0.7, -1, 0.1))),
             ("waist", hips + Vector((0, 0, 0.12)), Vector((0.8, -0.6, 0.05))),
             ("hem", Vector((0.0, 0, hem_y)), Vector((0.35, -1, 0.1))),
             ("shoulder", sh + Vector((0, 0, 0.0)), Vector((0.6, -0.5, 0.55))),
             ("feet", footL + Vector((-0.08, -0.05, -0.03)), Vector((0.2, -1, 0.35))),
             ("feetside", footL + Vector((0.0, -0.04, -0.03)), Vector((1, -0.15, 0.2))),
             ("cap", head + Vector((0, 0, 0.12)), Vector((0.5, -1, 0.35))),
             ("back_hem", Vector((0.0, 0, hem_y + 0.05)), Vector((-0.2, 1, 0.1)))]
    for light in ((False, True) if gas else (False,)):
        gas_light(light)
        ps = []
        for name, look, dirn in views:
            loc = look + dirn.normalized() * 0.45
            _shot(ps, out, "%s_close_%s_%d" % (kind, name, light), loc, look, fov=math.radians(50), res=(640, 640))
        fn = os.path.join(out, "%s_close%s.png" % (kind, "_gas" if light else ""))
        pm.sheet(ps, 5, fn, w=360)
        made.append(fn)
    gas_light(False)
    # low views of the feet and hems
    ps = []
    for yaw in (0, 35, 180, 215):
        a = math.radians(yaw)
        _shot(ps, out, "%s_low_%d" % (kind, yaw), (math.sin(a) * 1.0, -math.cos(a) * 1.0, 0.18), (0, 0, 0.25),
              res=(720, 540))
    fn = os.path.join(out, "%s_low.png" % kind)
    pm.sheet(ps, 4, fn, w=360)
    made.append(fn)
    bpy.data.objects.remove(ao)
    for m in ms:
        bpy.data.objects.remove(m)
    return made


def run(args):
    kinds = ["docker_a", "fishwife_a", "police", "sooi"]
    out = OUT
    gas = False
    for a in args:
        if a.startswith("kinds="):
            kinds = a[6:].split(",")
        if a.startswith("out="):
            out = a[4:]
        if a == "gas":
            gas = True
    os.makedirs(os.path.join(out, "_t"), exist_ok=True)
    rig = pm._rig()
    made = []
    for k in kinds:
        if k in rig.get("kinds", {}) and k in bpy.data.objects:
            made += kind_sheets(k, out, gas=gas)
    print("[cloth] sheets: " + ", ".join(made))
    return made
