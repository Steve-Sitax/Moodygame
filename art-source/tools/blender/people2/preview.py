"""Check pictures for the people2 kit (docs/people.md "Checks"). All in data/shots/people2/.

Rendered with EEVEE, a cold key light and a warm fill, on a dark ground. The fog pictures put the game's linear fog
(3 to 25 m, the day colour) over the render by the camera's distance and add a fine grain, and use the game's
picture scale (a 1080-line window, 75 degrees high), so a figure has as many pixels as on screen.
"""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from . import B, FOG, FOG_FAR, FOG_NEAR, G, SHOTS
from . import body as bd
from . import clips_legacy as cl
from . import rig

OLD = cl.old


# ---------------------------------------------------------------- scene

def scene(world=(0.11, 0.12, 0.13), floor=True):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE"
    try:
        scn.eevee.taa_render_samples = 64
    except AttributeError:
        pass
    scn.view_settings.view_transform = "AgX"
    scn.render.film_transparent = False
    w = bpy.data.worlds.get("p2w") or bpy.data.worlds.new("p2w")
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs[0].default_value = (*world, 1)
    bg.inputs[1].default_value = 1.0
    scn.world = w
    for o in list(bpy.data.objects):
        if o.get("p2_stage"):
            bpy.data.objects.remove(o)

    def light(name, kind, energy, rot, color, size=1.0):
        ld = bpy.data.lights.new(name, kind)
        ld.energy = energy
        ld.color = color
        if kind == "SUN":
            ld.angle = math.radians(2)
        else:
            ld.size = size
        lo = bpy.data.objects.new(name, ld)
        lo["p2_stage"] = 1
        scn.collection.objects.link(lo)
        lo.rotation_euler = rot
        return lo

    light("key", "SUN", 3.2, (math.radians(52), 0, math.radians(-38)), (0.92, 0.95, 1.0))
    light("fill", "SUN", 0.9, (math.radians(70), 0, math.radians(140)), (1.0, 0.86, 0.7))
    light("rim", "SUN", 1.4, (math.radians(100), 0, math.radians(185)), (0.85, 0.9, 1.0))
    if floor:
        bpy.ops.mesh.primitive_plane_add(size=80, location=(0, 0, 0))
        f = bpy.context.object
        f["p2_stage"] = 1
        f["p2_floor"] = 1
        m = bpy.data.materials.get("p2_floor") or bpy.data.materials.new("p2_floor")
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.09, 0.085, 0.08, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.9
        f.data.materials.append(m)
    cam = bpy.data.objects.get("p2cam")
    if not cam:
        cam = bpy.data.objects.new("p2cam", bpy.data.cameras.new("p2cam"))
        scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def shoot(cam, path, loc, look, W, H, lens=None, fov_y=None, ortho=None):
    scn = bpy.context.scene
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(look) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cd = cam.data
    cd.clip_start = 0.05
    cd.clip_end = 200
    if ortho:
        cd.type = "ORTHO"
        cd.ortho_scale = ortho
    else:
        cd.type = "PERSP"
        if fov_y:
            cd.sensor_fit = "VERTICAL"
            cd.angle_y = fov_y
        else:
            cd.sensor_fit = "AUTO"
            cd.lens = lens or 50
    scn.render.resolution_x, scn.render.resolution_y = W, H
    scn.render.resolution_percentage = 100
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)
    img = bpy.data.images.load(path, check_existing=False)
    px = np.array(img.pixels[:], np.float32).reshape(H, W, 4)[..., :3]
    bpy.data.images.remove(img)
    return px


def save(arr, path):
    h, w = arr.shape[:2]
    im = bpy.data.images.new("p2save", w, h, alpha=False)
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(arr, 0, 1)
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = path
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)


def grid(tiles, cols, gap=4, bg=(0.05, 0.05, 0.05)):
    h = max(t.shape[0] for t in tiles)
    w = max(t.shape[1] for t in tiles)
    rows = (len(tiles) + cols - 1) // cols
    out = np.ones((rows * h + (rows - 1) * gap, cols * w + (cols - 1) * gap, 3), np.float32) * np.array(bg)
    for i, t in enumerate(tiles):
        r, c = divmod(i, cols)
        y0 = (rows - 1 - r) * (h + gap)  # image rows run from the bottom
        out[y0:y0 + t.shape[0], c * (w + gap):c * (w + gap) + t.shape[1]] = t
    return out


def label(arr, text_px):
    """A dark bar under a tile (no fonts in background Blender: the order is listed in docs/people.md)."""
    return arr


# ---------------------------------------------------------------- figures

def clone(b, lod="lod0", name=None):
    """A posable copy of a body: its own armature object (shared data) and meshes."""
    ao = b["ao"].copy()
    ao.name = name or (b["name"] + "_copy")
    ao.animation_data_clear()
    ao["p2_stage"] = 1
    bpy.context.scene.collection.objects.link(ao)
    mo = b[lod].copy()
    mo["p2_stage"] = 1
    mo.parent = ao
    mo.modifiers["rig"].object = ao
    bpy.context.scene.collection.objects.link(mo)
    mo.matrix_parent_inverse = Matrix()
    for o in (ao, mo):
        o.hide_render = False
        o.hide_viewport = False
    return ao, mo


def hide_originals(bodies):
    for b in bodies:
        for k in ("ao", "lod0", "lod1"):
            b[k].hide_render = True
            b[k].hide_viewport = True


LIFT = {"sit": "sit", "lace": "sit", "row": "row", "scrub": "kneel", "crouch": "crouch", "ride": "ride"}


def lift(b, clip):
    """How far the game raises or lowers a body for a clip (humans.ts motionLift, for the old 1.74 m layout)."""
    k = float(b["J"]["hips"][0][1]) / 0.95
    kind = LIFT.get(clip)
    if kind in ("sit", "row"):
        return 0.45 + 0.07 * k - 0.9 * k if kind == "sit" else 0.32 + 0.07 * k - 0.9 * k
    if kind == "kneel":
        return -OLD.KNEEL_DROP * k
    if kind == "crouch":
        return -OLD.CROUCH_DROP * k
    if kind == "ride":
        return OLD.RIDE_LIFT * k
    return 0.0


def place(ao, x, y_game, z, yaw_deg=0.0):
    ao.location = B(x, y_game, z)
    ao.rotation_euler = (0, 0, math.radians(yaw_deg))


def clip_pose(ao, b, clip, t):
    cl.pose_now(ao, clip, t, b["J"])


def seat(x, y, z, yaw, w=0.5, d=0.4, h=0.45):
    bpy.ops.mesh.primitive_cube_add(size=1, location=B(x, y + h / 2, z))
    s = bpy.context.object
    s.scale = (w, d, h)
    s.rotation_euler = (0, 0, math.radians(yaw))
    s["p2_stage"] = 1
    m = bpy.data.materials.get("p2_crate") or bpy.data.materials.new("p2_crate")
    m.diffuse_color = (0.28, 0.2, 0.13, 1)
    s.data.materials.append(m)
    return s


def clear_stage():
    for o in list(bpy.data.objects):
        if o.get("p2_stage") and not o.get("p2_floor") and o.type in ("ARMATURE", "MESH", "EMPTY"):
            bpy.data.objects.remove(o)


# ---------------------------------------------------------------- sheets

def bodies_sheet(bodies, mats):
    """Every body front, side, back (idle), and the heads and hands up close."""
    hide_originals(bodies)
    cam = scene()
    n = len(bodies)
    gap = 0.75
    for view, az in (("front", 0), ("side", 90), ("back", 180), ("threequarter", 35)):
        clear_stage()
        for i, b in enumerate(bodies):
            ao, _ = clone(b)
            place(ao, (i - (n - 1) / 2) * gap, 0, 0, az)
            clip_pose(ao, b, "idle_f" if b["P"]["female"] else "idle", 0.15)
        px = shoot(cam, os.path.join(SHOTS, "_tmp.png"), B(0, 0.9, 30), B(0, 0.9, 0), 3000, 1100,
                   ortho=max(n * gap + 0.4, 1.95 * 3000 / 1100))
        save(px, os.path.join(SHOTS, "bodies_%s.png" % view))
    # close: heads (three-quarter) and hands
    clear_stage()
    tiles = []
    for b in bodies:
        ao, _ = clone(b)
        place(ao, 0, 0, 0, 25)
        clip_pose(ao, b, "idle_f" if b["P"]["female"] else "idle", 0.15)
        bpy.context.view_layer.update()
        hp = ao.matrix_world @ ao.pose.bones["head"].head
        tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), hp + Vector((0.0, -0.75, 0.06)), hp + Vector((0, 0, 0.05)),
                           420, 520, lens=85))
        hp = ao.matrix_world @ ao.pose.bones["handL"].tail
        tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), hp + Vector((0.45, -0.35, 0.06)), hp + Vector((0, 0, 0.0)),
                           420, 520, lens=85))
        clear_stage()
    save(grid(tiles, 10), os.path.join(SHOTS, "bodies_closeups.png"))


def fog(px, dist, seed=0):
    f = min(1.0, max(0.0, (dist - FOG_NEAR) / (FOG_FAR - FOG_NEAR)))
    out = px * (1 - f) + np.array(FOG, np.float32) * f
    rng = np.random.default_rng(seed)
    g = rng.normal(0, 1, out.shape[:2]).astype(np.float32)[..., None]
    lum = out.mean(axis=2, keepdims=True)
    return np.clip(out + g * (0.008 + 0.01 * (1 - lum)), 0, 1)


def turntable(bodies, names, dist, lod="lod0", fn=None):
    """Each named body seen from 8 sides at `dist` in the game's fog, at the game's own picture scale."""
    cam = scene(world=FOG, floor=True)
    rows = []
    px_per = 540 / math.tan(math.radians(37.5))  # a 1080-line window, 75 degrees high
    Hc = int(px_per * 1.95 / dist) // 2 * 2
    Wc = int(Hc * 0.62) // 2 * 2
    fov = 2 * math.atan(Hc / 2 / px_per)
    for nm in names:
        b = next(x for x in bodies if x["name"] == nm)
        clear_stage()
        ao, _ = clone(b, lod)
        clip_pose(ao, b, "idle_f" if b["P"]["female"] else "idle", 0.15)
        tiles = []
        for k in range(8):
            ao.rotation_euler = (0, 0, math.radians(45 * k))
            px = shoot(cam, os.path.join(SHOTS, "_tmp.png"), B(0, 1.62, dist), B(0, 0.93, 0), Wc, Hc, fov_y=fov)
            tiles.append(fog(px, dist, seed=k))
        rows += tiles
    out = grid(rows, 8)
    if dist >= 8:
        out = np.repeat(np.repeat(out, 3, axis=0), 3, axis=1)  # blown up to look at, pixel for pixel
    save(out, fn)


CLIP_T = {"walk": 0.12, "walk_f": 0.12, "carry": 0.12, "walk_sack": 0.12, "push": 0.12, "rifle_walk": 0.12,
          "ride": 0.25, "row": 0.42, "cross": 0.2, "hop": 0.25, "smoke": 0.3, "point": 0.25}


def contact_sheet(bodies, name, clips, fn, cols=9):
    """Every clip on one body, three-quarter view, one tile a clip (the order of CLIPS)."""
    b = next(x for x in bodies if x["name"] == name)
    cam = scene()
    tiles = []
    for clip in clips:
        clear_stage()
        ao, _ = clone(b)
        place(ao, 0, lift(b, clip), 0, 30)
        if clip in ("sit", "lace"):
            seat(-0.02, 0, -0.12, 30)
        if clip == "row":
            seat(-0.02, 0, -0.1, 30, h=0.32)
        if clip == "lean":
            bpy.ops.mesh.primitive_cube_add(size=1, location=B(0.3, 1.0, 0.5))
            r = bpy.context.object
            r.scale = (1.4, 0.06, 0.06)
            r.rotation_euler = (0, 0, math.radians(30))
            r["p2_stage"] = 1
        clip_pose(ao, b, clip, CLIP_T.get(clip, 0.3))
        tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), B(1.15, 1.2, 3.0), B(0, 0.82, 0), 360, 520, lens=50))
    save(grid(tiles, cols), fn)


# ---------------------------------------------------------------- bends and measures

def evaluated(mo):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = mo.evaluated_get(dg)
    me = ev.to_mesh()
    co = np.array([mo.matrix_world @ v.co for v in me.vertices])
    rest = None
    ev.to_mesh_clear()
    return co


def section(co, edges, origin, normal, near, radius):
    """Convex hull area of a mesh cut by a plane, keeping points within `radius` of `near`."""
    a, b = co[edges[:, 0]], co[edges[:, 1]]
    da, db = (a - origin) @ normal, (b - origin) @ normal
    m = (da * db) < 0
    t = (da[m] / (da[m] - db[m]))[:, None]
    p = a[m] + (b[m] - a[m]) * t
    p = p[np.linalg.norm(p - near, axis=1) < radius]
    if len(p) < 3:
        return 0.0
    u = np.cross(normal, (0, 0, 1.0))
    if np.linalg.norm(u) < 1e-6:
        u = np.cross(normal, (1.0, 0, 0))
    u /= np.linalg.norm(u)
    v = np.cross(normal, u)
    q = np.stack([(p - origin) @ u, (p - origin) @ v], 1)
    pts = sorted(map(tuple, q))

    def cr(o, a_, b_):
        return (a_[0] - o[0]) * (b_[1] - o[1]) - (a_[1] - o[1]) * (b_[0] - o[0])
    lo, hi = [], []
    for s in pts:
        while len(lo) >= 2 and cr(lo[-2], lo[-1], s) <= 0:
            lo.pop()
        lo.append(s)
    for s in reversed(pts):
        while len(hi) >= 2 and cr(hi[-2], hi[-1], s) <= 0:
            hi.pop()
        hi.append(s)
    h = lo[:-1] + hi[:-1]
    return 0.5 * abs(sum(h[i][0] * h[(i + 1) % len(h)][1] - h[(i + 1) % len(h)][0] * h[i][1] for i in range(len(h))))


def bend_measure(b, joint="elbow", deg=120):
    """The limb's cross-section through a hinge bent `deg`, against the straight limb's: 1.0 keeps all, a collapse
    falls toward 0.5."""
    clear_stage()
    ao, mo = clone(b)
    place(ao, 0, 0, 0, 0)
    if joint == "elbow":
        parent, child, sign, part = "armUpL", "armLowL", -1, "armL"
    else:
        parent, child, sign, part = "legUpL", "legLowL", 1, "legL"
    vp = b["vparts"]
    edges = np.array([e.vertices[:] for e in mo.data.edges if vp[e.vertices[0]] == part and vp[e.vertices[1]] == part])
    cl.set_pose(ao, {})
    bpy.context.view_layer.update()
    co0 = evaluated(mo)
    j = np.array(ao.matrix_world @ ao.pose.bones[child].head)
    a0 = section(co0, edges, j, np.array((0, 0, 1.0)), j, 0.09)
    cl.set_pose(ao, {child: OLD.RX(sign * deg)})
    bpy.context.view_layer.update()
    co1 = evaluated(mo)
    up = np.array((0, 0, 1.0))
    fdir = np.array(ao.matrix_world.to_3x3() @ (ao.pose.bones[child].matrix.to_3x3() @ Vector((0, 1, 0))))
    fdir /= np.linalg.norm(fdir)
    # the plane that halves the angle between the parent (pointing down from the joint: -up) and the child
    n = up - fdir
    n /= np.linalg.norm(n)
    a1 = section(co1, edges, j, n, j, 0.09)
    rigid = 1.0 / math.cos(math.radians(deg / 2))  # what two rigid tubes would show in that plane
    return a1 / a0 / rigid if a0 else 0.0


def bends(bodies):
    """Knees and elbows at 120 degrees, arms up and over the head, a fist, a turned hand, a body lying and dragged."""
    cam = scene()
    tiles = []
    lines = []
    for nm in ("man_middling", "woman_middling", "man_stout", "child_middling"):
        b = next((x for x in bodies if x["name"] == nm), None)
        if not b:
            continue
        r_el = bend_measure(b, "elbow", 120)
        r_kn = bend_measure(b, "knee", 120)
        lines.append("%s: bent 120 degrees, the elbow keeps %.0f%% of the section two rigid tubes would have, the knee %.0f%%"
                     % (nm, 100 * r_el, 100 * r_kn))
    b = bodies[0]
    poses = [
        ("elbows 120", {"armLowL": OLD.RX(-120), "armLowR": OLD.RX(-120), "armUpL": OLD.limb("L", fwd=10, out=8),
                        "armUpR": OLD.limb("R", fwd=10, out=8)}, 30, 0.0),
        ("knees 120", {"legUpL": OLD.RX(-60), "legLowL": OLD.RX(120), "legUpR": OLD.RX(20), "legLowR": OLD.RX(30),
                       "footL": OLD.RX(-60)}, 90, 0.0),
        ("deep squat", {"legUpL": OLD.limb("L", fwd=110, out=14), "legLowL": OLD.RX(135), "footL": OLD.RX(-25),
                        "legUpR": OLD.limb("R", fwd=110, out=14), "legLowR": OLD.RX(135), "footR": OLD.RX(-25),
                        "spine": OLD.RX(30), "armUpL": OLD.limb("L", fwd=40), "armUpR": OLD.limb("R", fwd=40),
                        "armLowL": OLD.RX(-60), "armLowR": OLD.RX(-60)}, 40, None),
        ("arms up", {"armUpL": OLD.limb("L", fwd=170, out=8), "armUpR": OLD.limb("R", fwd=170, out=8),
                     "clavicleL": OLD.RY(-13), "clavicleR": OLD.RY(13)}, 30, 0.0),
        ("arms out", {"armUpL": OLD.limb("L", out=90), "armUpR": OLD.limb("R", out=90), "clavicleL": OLD.RY(-6),
                      "clavicleR": OLD.RY(6)}, 0, 0.0),
        ("hand turned", {"armUpR": OLD.limb("R", fwd=60), "armLowR": OLD.RX(-30), "handR": OLD.RZ(-80),
                         "armTwistR": Quaternion((0, 0, 1), math.radians(-48))}, 20, 0.0),
    ]
    for title, pose, yaw, y in poses:
        clear_stage()
        ao, mo = clone(b)
        place(ao, 0, 0, 0, yaw)
        p = dict(pose)
        cl.hand_pose(p, "L", "relaxed", cl.thumb_axes(b["J"]))
        cl.hand_pose(p, "R", "fist" if title != "hand turned" else "open", cl.thumb_axes(b["J"]))
        cl.set_pose(ao, p)
        bpy.context.view_layer.update()
        if y is None:
            # stand the squat on its feet
            co = evaluated(mo)
            ao.location.z -= co[:, 2].min()
        tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), B(1.5, 1.2, 3.3), B(0, 0.85, 0), 520, 640, lens=45))
    # up close: the elbow and the knee bent, a fist (seen from the person's left)
    clear_stage()
    ao, mo = clone(b)
    place(ao, 0, 0, 0, 0)
    p = {"armLowL": OLD.RX(-120), "legUpL": OLD.RX(-60), "legLowL": OLD.RX(120), "footL": OLD.RX(-50)}
    cl.hand_pose(p, "L", "fist", cl.thumb_axes(b["J"]))
    cl.set_pose(ao, p)
    bpy.context.view_layer.update()
    for bone, off in (("armLowL", Vector((0.62, -0.18, 0.05))), ("legLowL", Vector((0.85, -0.25, 0.08))),
                      ("handL", Vector((0.42, -0.30, 0.10)))):
        jp = ao.matrix_world @ ao.pose.bones[bone].head
        tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), jp + off, jp, 520, 640, lens=60))
    # a body lying on its back, dragged by the wrists
    clear_stage()
    ao, mo = clone(b)
    ao.location = B(0, 0.13, 0)
    ao.rotation_euler = (math.radians(-90), 0, 0)  # lying on the back, the head toward -z
    p = {"armUpL": OLD.limb("L", fwd=165, out=12), "armUpR": OLD.limb("R", fwd=165, out=12), "head": OLD.RX(-15),
         "legUpL": OLD.limb("L", out=6), "legUpR": OLD.limb("R", out=4), "clavicleL": OLD.RY(-12),
         "clavicleR": OLD.RY(12)}
    cl.hand_pose(p, "L", "relaxed", cl.thumb_axes(b["J"]))
    cl.hand_pose(p, "R", "relaxed", cl.thumb_axes(b["J"]))
    cl.set_pose(ao, p)
    bpy.context.view_layer.update()
    co = evaluated(mo)
    ao.location.z -= co[:, 2].min() - 0.002
    bpy.context.view_layer.update()
    c = Vector(np.mean(evaluated(mo), axis=0))
    tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), c + Vector((1.6, -1.2, 1.5)), c, 520, 640, lens=32))
    save(grid(tiles, 5), os.path.join(SHOTS, "bends.png"))
    return lines


# ---------------------------------------------------------------- sockets and grabs

def stick(name, length, radius, color, bone_ao, bone, offset=0.0):
    """A test stick on a socket: along the socket's +y (its bone direction), from `offset` to `offset + length`."""
    bpy.ops.mesh.primitive_cylinder_add(vertices=12, radius=radius, depth=length)
    s = bpy.context.object
    s.name = name
    s["p2_stage"] = 1
    # the cylinder runs along its own z; turn it onto the bone's y, start at the bone's head
    s.data.transform(Matrix.Translation((0, 0, length / 2 + offset)))
    s.data.transform(Matrix.Rotation(math.radians(-90), 4, "X"))
    s.parent = bone_ao
    s.parent_type = "BONE"
    s.parent_bone = bone
    pb = bone_ao.pose.bones[bone]
    # parent_type BONE puts the child at the bone's tail: move it back to the head
    s.matrix_parent_inverse = Matrix()
    s.location = (0, -pb.bone.length, 0)
    m = bpy.data.materials.get("p2_" + name) or bpy.data.materials.new("p2_" + name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (*color, 1)
    s.data.materials.append(m)
    return s


def sockets(bodies):
    """Each socket with a stick: a baton in the right fist, a knife in the left, a scabbard on the hip, a load on
    the back, a hat on the head; at rest, walking, talking, in a guard."""
    cam = scene()
    tiles = []
    for nm in ("man_middling", "woman_middling", "child_middling", "old_man"):
        b = next((x for x in bodies if x["name"] == nm), None)
        if not b:
            continue
        for clip, t, yaw in (("idle", 0.15, 20), ("walk", 0.12, 70), ("guard", 0.0, 35), ("talk", 0.4, 160)):
            clear_stage()
            ao, mo = clone(b)
            place(ao, 0, 0, 0, yaw)
            if clip == "guard":
                p = {"armUpR": OLD.limb("R", fwd=55, out=10, twist=20), "armLowR": OLD.RX(-95),
                     "armUpL": OLD.limb("L", fwd=40, out=14, twist=10), "armLowL": OLD.RX(-80),
                     "handR": OLD.RX(-20), "handL": OLD.RX(10), "spine": OLD.RX(6)}
                p = cl.derive(p, "guard", 0.0, cl.thumb_axes(b["J"]))
                cl.set_pose(ao, p)
            else:
                cl.pose_now(ao, clip, t, b["J"])
            p = {pb.name: None for pb in ao.pose.bones}
            # fists round the handles
            pose = {}
            for pb in ao.pose.bones:
                r = pb.bone.matrix_local.to_quaternion()
                pose[pb.name] = r @ pb.rotation_quaternion @ r.inverted()
            cl.hand_pose(pose, "R", "grip", cl.thumb_axes(b["J"]))
            cl.hand_pose(pose, "L", "grip", cl.thumb_axes(b["J"]))
            cl.set_pose(ao, pose)
            stick("baton", 0.55, 0.017, (0.32, 0.2, 0.1), ao, "gripR", -0.1)
            stick("knife", 0.2, 0.008, (0.75, 0.75, 0.78), ao, "gripL", 0.02)
            stick("scabbard", 0.75, 0.016, (0.08, 0.08, 0.08), ao, "hipL", 0.0)
            box = stick("load", 0.35, 0.12, (0.5, 0.42, 0.3), ao, "back", -0.15)
            stick("hat", 0.11, 0.1, (0.12, 0.1, 0.09), ao, "headTop", -0.03)
            bpy.context.view_layer.update()
            tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), B(1.3, 1.25, 3.0), B(0, 0.9, 0), 420, 600, lens=45))
            if clip == "guard" and nm == "man_middling":
                for S, off in (("R", Vector((-0.25, -0.3, 0.05))), ("L", Vector((0.3, -0.25, 0.05)))):
                    hp = ao.matrix_world @ ao.pose.bones["grip" + S].head
                    tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), hp + off, hp, 420, 600, lens=70))
    save(grid(tiles, 9), os.path.join(SHOTS, "sockets.png"))


def arm_ik(ao, pose, S, target_world, pole_world):
    """Two-bone IK in the pose convention: set pose["armUp"+S] and pose["armLow"+S] so the wrist reaches
    target_world, the elbow toward pole_world. The rest of the pose must be set on ao already (and is kept)."""
    cl.set_pose(ao, pose)
    bpy.context.view_layer.update()
    inv = ao.matrix_world.inverted()
    T = inv @ Vector(target_world)
    Pp = inv @ Vector(pole_world)
    pc = ao.pose.bones["clavicle" + S]
    Qp = pc.matrix.to_quaternion() @ pc.bone.matrix_local.to_quaternion().inverted()
    pu, pl, ph = ao.pose.bones["armUp" + S], ao.pose.bones["armLow" + S], ao.pose.bones["hand" + S]
    S0 = pu.head.copy()
    L1 = (pl.bone.head_local - pu.bone.head_local).length
    L2 = (ph.bone.head_local - pl.bone.head_local).length
    d = T - S0
    D = min(max(d.length, 0.05), L1 + L2 - 1e-3)
    dh = d.normalized()
    u = (Pp - S0) - dh * (Pp - S0).dot(dh)
    u.normalize()
    a = (L1 * L1 - L2 * L2 + D * D) / (2 * D)
    h = math.sqrt(max(0.0, L1 * L1 - a * a))
    E = S0 + dh * a + u * h
    e1 = (E - S0).normalized()
    e2 = (S0 + dh * D - E).normalized()
    X = -e1.cross(e2)
    if X.length < 1e-6:
        X = Qp @ Vector((1, 0, 0))
    X.normalize()
    Z = -e1
    Yv = Z.cross(X)
    R = Matrix((X, Yv, Z)).transposed().to_quaternion()
    pose["armUp" + S] = Qp.inverted() @ R
    bend = math.degrees(math.acos(max(-1.0, min(1.0, e1.dot(e2)))))
    pose["armLow" + S] = OLD.RX(-bend)
    cl.set_pose(ao, pose)
    bpy.context.view_layer.update()
    return pose


def mark_world(ao, b, mark):
    """A grab mark of a posed body, in Blender world space (from peopleRig.json's rule: bone frame + offset)."""
    p, bone = rig.marks(b["P"], b["J"])[mark]
    pb = ao.pose.bones[bone]
    rest_h = Vector(B(*b["J"][bone][0]))
    off = pb.bone.matrix_local.to_3x3().inverted() @ (Vector(B(*p)) - rest_h)
    return ao.matrix_world @ (pb.matrix @ Matrix.Translation(off)).translation


def grab(bodies):
    """Two people: a grab from behind (a hand over the mouth, a blade at the throat); a body dragged by the
    wrists. The attacker's arms reach the victim's marks by two-bone IK (arm_ik)."""
    cam = scene()
    v = next(x for x in bodies if x["name"] == "man_middling")
    a = next((x for x in bodies if x["name"] == "man_stout"), v)
    ax_v, ax_a = cl.thumb_axes(v["J"]), cl.thumb_axes(a["J"])
    tiles = []
    for yaw_cam in (35, 110, 205):
        clear_stage()
        vao, _ = clone(v, name="victim")
        place(vao, 0, 0, 0, 0)
        pv = {"head": OLD.RX(-16), "neck": OLD.RX(-8), "spine": OLD.RX(-7), "hips": OLD.RX(-3),
              "armUpL": OLD.limb("L", fwd=40, out=16, twist=40), "armLowL": OLD.RX(-95), "handL": OLD.RX(-20),
              "armUpR": OLD.limb("R", fwd=44, out=14, twist=40), "armLowR": OLD.RX(-92), "handR": OLD.RX(-20),
              "legUpL": OLD.RX(-8), "legLowL": OLD.RX(12)}
        pv = cl.derive(pv, "victim", 0, ax_v)
        cl.hand_pose(pv, "L", "grip", ax_v)
        cl.hand_pose(pv, "R", "grip", ax_v)
        cl.set_pose(vao, pv)
        aao, _ = clone(a, name="attacker")
        place(aao, 0.03, 0, -0.33, 0)
        pa = {"spine": OLD.RX(6), "neck": OLD.RX(4), "head": OLD.RX(8) @ OLD.RZ(-12), "legUpR": OLD.RX(10),
              "legLowR": OLD.RX(14), "legUpL": OLD.RX(-6)}
        pa = cl.derive(pa, "attacker", 0, ax_a)
        cl.hand_pose(pa, "L", "cup", ax_a)
        cl.hand_pose(pa, "R", "grip", ax_a)
        bpy.context.view_layer.update()
        mouth = mark_world(vao, v, "mouth")
        throat = mark_world(vao, v, "throat")
        # the wrist a hand's length short of the mark: the palm over the mouth, the fist with the blade by the throat
        pa["handL"] = OLD.RX(-30) @ OLD.RZ(-70)
        pa["handR"] = OLD.RX(-10) @ OLD.RZ(80)
        pa = arm_ik(aao, pa, "L", mouth + Vector((0.075, 0.03, -0.035)), mouth + Vector((0.45, 0.2, -0.5)))
        pa = arm_ik(aao, pa, "R", throat + Vector((-0.06, 0.06, -0.06)), throat + Vector((-0.5, 0.2, -0.5)))
        stick("knife", 0.2, 0.007, (0.8, 0.8, 0.82), aao, "gripR", 0.02)
        bpy.context.view_layer.update()
        a_ = math.radians(yaw_cam)
        loc = B(2.4 * math.sin(a_), 1.5, 2.4 * math.cos(a_))
        tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), loc, B(0, 1.2, -0.12), 640, 720, lens=50))
    # dragged by the wrists: the victim on his back, his arms up over his head; the other leans back and pulls
    clear_stage()
    vao, vmo = clone(v, name="victim")
    vao.location = B(0, 0.13, 0)
    vao.rotation_euler = (math.radians(-90), 0, 0)
    p = {"armUpL": OLD.limb("L", fwd=150, out=10), "armUpR": OLD.limb("R", fwd=150, out=10), "head": OLD.RX(-24),
         "neck": OLD.RX(-10), "legUpL": OLD.limb("L", out=5), "legUpR": OLD.limb("R", out=3),
         "legLowL": OLD.RX(8), "footL": OLD.RX(30), "footR": OLD.RX(34), "spine": OLD.RX(-6)}
    p = cl.derive(p, "victim", 0, ax_v)
    cl.set_pose(vao, p)
    bpy.context.view_layer.update()
    co = evaluated(vmo)
    vao.location.z -= co[:, 2].min() - 0.002
    bpy.context.view_layer.update()
    wl, wr = mark_world(vao, v, "wristL"), mark_world(vao, v, "wristR")
    mid = (wl + wr) / 2
    aao, amo = clone(a, name="attacker")
    aao.location = Vector((mid.x, mid.y + 0.55, 0.0))
    aao.rotation_euler = (0, 0, 0)  # he faces the body (toward -y, the person's forward)
    pa = {"hips": OLD.RX(-6), "spine": OLD.RX(24), "neck": OLD.RX(-14), "head": OLD.RX(-10),
          "legUpL": OLD.RX(-62), "legLowL": OLD.RX(80), "footL": OLD.RX(-18),
          "legUpR": OLD.RX(-18), "legLowR": OLD.RX(52), "footR": OLD.RX(-34)}
    pa = cl.derive(pa, "attacker", 0, ax_a)
    cl.hand_pose(pa, "L", "grip", ax_a)
    cl.hand_pose(pa, "R", "grip", ax_a)
    cl.set_pose(aao, pa)
    bpy.context.view_layer.update()
    co = evaluated(amo)
    aao.location.z -= co[:, 2].min()
    bpy.context.view_layer.update()
    pa = arm_ik(aao, pa, "L", wl + Vector((0, 0.02, 0.05)), wl + Vector((0.5, 0.3, -0.3)))
    pa = arm_ik(aao, pa, "R", wr + Vector((0, 0.02, 0.05)), wr + Vector((-0.5, 0.3, -0.3)))
    bpy.context.view_layer.update()
    c = (mid + Vector((0, 0.3, 0.45)))
    tiles.append(shoot(cam, os.path.join(SHOTS, "_tmp.png"), c + Vector((2.3, 0.6, 1.0)), c, 640, 720, lens=35))
    save(grid(tiles, 4), os.path.join(SHOTS, "grab.png"))


def cast(bodies, mats, actions):
    hide_originals(bodies)
    names = [b["name"] for b in bodies]
    four = [n for n in ("man_middling", "woman_middling", "child_middling", "old_man") if n in names]
    turntable(bodies, four, 3.0, fn=os.path.join(SHOTS, "turntable_3m.png"))
    turntable(bodies, four, 10.0, fn=os.path.join(SHOTS, "turntable_10m.png"))
    turntable(bodies, four[:2], 10.0, lod="lod1", fn=os.path.join(SHOTS, "turntable_10m_lod1.png"))
    clips = [c[0] for c in cl.CLIPS]
    contact_sheet(bodies, "man_middling", clips, os.path.join(SHOTS, "clips_man_middling.png"))
    if "woman_middling" in names:
        contact_sheet(bodies, "woman_middling", clips, os.path.join(SHOTS, "clips_woman_middling.png"))
    few = ["idle", "walk", "sit", "crouch", "hop", "beg", "behind", "walk_f", "push"]
    for nm in ("child_middling", "old_man", "old_woman", "man_stout"):
        if nm in names:
            contact_sheet(bodies, nm, few, os.path.join(SHOTS, "clips_%s.png" % nm), cols=9)
    lines = bends(bodies)
    for ln in lines:
        print("[people2] " + ln)
    sockets(bodies)
    grab(bodies)
    tmp = os.path.join(SHOTS, "_tmp.png")
    if os.path.exists(tmp):
        os.remove(tmp)
