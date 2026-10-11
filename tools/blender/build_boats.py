"""Boats, ships and quay cranes of Antwerp, 1873: the driver of the boat builder.

This file holds the list of models (BUILDERS), the build (build_all), the export and the
previews. The models themselves are built by the package tools/blender/boats/: common.py (the
mesh, the hull loft, the painters and materials, small parts), ships.py (liner, steamer, barque,
brig, schooner), inland.py (Rhine barge, hengst, sloop, lighters, pontoon), tugs.py (tug,
paddle tug), small.py (the nine small boats) and cranes.py (portal and hand crane). Every name
of the package is re-exported here, so `import build_boats as bb` works as before. The rules
every boat model keeps (origin, axes, caps, name zones, budgets) are in docs/boats.md.

    blender -b --factory-startup -P tools/blender/build_boats.py
    blender -b --factory-startup -P tools/blender/build_boats.py -- --preview
    blender -b --factory-startup -P tools/blender/build_boats.py -- --closeup barque,steamer out.png [azimuth] [elevation]
    blender -b --factory-startup -P tools/blender/build_boats.py -- --crane-views data/shots [whole,bogie,...]
    blender -b --factory-startup -P tools/blender/build_boats.py -- --crane-zfight [--crane-zfight-at x,y,z]

--crane-views renders the portal crane from CRANE_VIEWS (crane_bl_<view>.png) with the wheels the game
draws, and does not write boats.glb. --crane-zfight lists the crane's faces that share a plane. Every
build checks the crane against railway.ts foldPortal / foldHook (fold_check) and prints its triangles
per part.

Writes client/public/models/boats.glb (Draco). One node per object. A vessel's
origin is the centre of its waterline, bow toward -Y in Blender (+Z in the game),
real scale in metres. A crane's origin is the centre of its foot on the quay;
its jib looks toward -Y at rest. The part of a crane that turns (cabin, jib,
hook) is a child node named "jib" (portal crane) or "hand_crane_jib", with its
origin on the axis it turns about.

Everything here is our own work: the shapes are built from code, the textures
are painted by the functions in boats/common.py (32x32 to 128x128). Period
photographs and engravings of the Antwerp quays were looked at for proportions
only; nothing was copied (see assets/ATTRIBUTION.md). The mesh helpers and the
twelve street-prop materials come from build_props.py.

The vertex colour "Col" carries a baked shade (darker toward the keel and under
things); the game multiplies it into the texture, as in props.glb.

--preview renders a line-up of all objects (data/shots/boats_preview.png) and a
quay scene (data/shots/boats_harbour.png).
"""


import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
# Every name of the package is re-exported here: build_ferry, build_lock, build_bridges and build_wall
# import this file as `bb` and use its helpers, painters and materials.
from boats.common import *  # noqa: E402,F401,F403
from boats.ships import *  # noqa: E402,F401,F403
from boats.inland import *  # noqa: E402,F401,F403
from boats.tugs import *  # noqa: E402,F401,F403
from boats.small import *  # noqa: E402,F401,F403
from boats.cranes import *  # noqa: E402,F401,F403
from boats import cranes  # noqa: E402  (its CRANE_* switches are set by main)


# ------------------------------------------------------------------ build


BUILDERS = [
    ("barque", barque),
    ("steamer", steamer),
    ("rhine_barge", lambda: barge("rhine")),
    ("hengst", lambda: barge("hengst")),
    ("lighter", lambda: lighter(False)),
    ("lighter_loaded", lambda: lighter(True)),
    ("lighter_coal", lambda: lighter("coal")),
    ("lighter_sand", lambda: lighter("sand")),
    ("lighter_timber", lambda: lighter("timber")),
    ("tug", lambda: tug(False)),
    ("paddle_tug", lambda: tug(True)),
    ("sloop", sloop),
    ("barque_sail", lambda: barque(True)),
    ("brig", brig),
    ("schooner", schooner),
    ("sloop_sail", lambda: sloop(True)),
    ("hengst_sail", lambda: barge("hengst", True)),
    ("rowboat", rowboat),
    ("punt", punt),
    # M7 boats: more kinds of small boat, every one of them can be taken and rowed
    ("workboat", workboat),
    ("dinghy", dinghy),
    ("shipsboat", shipsboat),
    ("gig", gig),
    ("bumboat", bumboat),
    ("eelboat", eelboat),
    ("oldboat", oldboat),
    ("pontoon_section", pontoon_section),
    ("portal_crane", portal_crane),
    ("hand_crane", hand_crane),
    ("liner", liner),
]
CHILDREN = {"portal_crane": ("jib", portal_jib, (0, 0, PORTAL_TOP)), "hand_crane": ("hand_crane_jib", hand_jib, (0, 0, HAND_PIVOT))}


def tris(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def hull_parts(m, name, ob, objs):
    """A hull's children: the water cap over its rail (<name>_cap) and the parts laid in (<name>_stow).
    Returns the triangles of the stowed parts (the cap is not drawn)."""
    hull = m.hulls[0] if getattr(m, "hulls", None) else None
    if hull is not None:
        cap_object(hull, f"{name}_cap", ob)
    # B1-B4 (docs/boats.md): a builder's further children in m.children, by suffix: "walk", "block", "far",
    # "name_bow_p" ...; the drawn ones (the name zones) count in the model's triangles, the far copy is printed apart
    drawn = 0
    for suffix, part in (getattr(m, "children", None) or {}).items():
        if part is None or not len(part.bm.faces):
            continue
        ch = to_object(part, f"{name}_{suffix}", parent=ob)
        objs[f"{name}_{suffix}"] = ch
        if suffix == "far":
            print(f"[build_boats] {name}_far {tris(ch):5d} tris")
        elif suffix.startswith("name_"):
            drawn += tris(ch)
    stow = getattr(m, "stow", None)
    if stow is None or not len(stow.bm.faces):
        return drawn
    # M7 boats: the oars (and a dinghy's mast) laid in: their own node, hidden while the boat is rowed
    ch = to_object(stow, f"{name}_stow", parent=ob)
    objs[f"{name}_stow"] = ch
    return drawn + tris(ch)


def build_all():
    objs, counts = {}, {}
    for name, fn in BUILDERS:
        CUR[0] = name
        m = fn()
        CUR[0] = None
        if name in SACK_SOCKETS:
            NO_SACKS[0] = True
            try:
                bm_ = fn()
                bare = to_object(bm_, name + "_bare")
                objs[name + "_bare"] = bare
                # the copy the game draws in place of the model (game/sackModel.ts) keeps its water cap and its
                # stowed oars: <name>_bare_cap, <name>_bare_stow (docs/boats.md)
                hull_parts(bm_, name + "_bare", bare, objs)
            finally:
                NO_SACKS[0] = False
        crane_checks(m, name)
        ob = to_object(m, name)
        objs[name] = ob
        counts[name] = tris(ob) + hull_parts(m, name, ob, objs)
        if name in CHILDREN:
            cname, cfn, loc = CHILDREN[name]
            cm = cfn()
            crane_checks(cm, cname)
            ch = to_object(cm, cname, parent=ob, loc=loc)
            objs[cname] = ch
            counts[name] += tris(ch)
    p = objs["pontoon_section"]
    p["deck_top"] = PONTOON_DECK
    p["half_width"] = PONTOON_HALF
    p["length"] = PONTOON_LEN
    with open(os.path.join(ROOT, "client", "src", "world", "boats_sack_sockets.json"), "w", encoding="utf-8") as f:
        json.dump(SACK_SOCKETS, f, separators=(",", ":"))
    return objs, counts


def export():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


# ------------------------------------------------------------------ preview


def stage(water=True):
    sc = bpy.context.scene
    for o in list(sc.collection.objects):
        if o.name.split(".")[0] in ("water", "sun", "cam", "quay"):
            bpy.data.objects.remove(o)
    try:
        sc.render.engine = "BLENDER_EEVEE"
    except TypeError:
        sc.render.engine = "BLENDER_WORKBENCH"
    world = bpy.data.worlds.new("fog")
    try:
        bg = world.node_tree.nodes.get("Background")
        bg.inputs[0].default_value = (0.42, 0.45, 0.47, 1)
        bg.inputs[1].default_value = 0.8
    except AttributeError:
        world.color = (0.42, 0.45, 0.47)
    sc.world = world
    if water:
        me = bpy.data.meshes.new("water")
        bm = bmesh.new()
        for p in [(-400, -400, 0), (400, -400, 0), (400, 400, 0), (-400, 400, 0)]:
            bm.verts.new(p)
        bm.faces.new(bm.verts)
        bm.to_mesh(me)
        wm = bpy.data.materials.new("water_prev")
        b = wm.node_tree.nodes.get("Principled BSDF")
        b.inputs["Base Color"].default_value = (0.12, 0.14, 0.12, 1)
        b.inputs["Roughness"].default_value = 0.35
        me.materials.append(wm)
        w = bpy.data.objects.new("water", me)
        sc.collection.objects.link(w)
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.0
    sun.rotation_euler = (math.radians(52), math.radians(8), math.radians(-30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.clip_end = 2000
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def quay(x0, x1, y0, y1, top=1.8):
    me = bpy.data.meshes.new("quay")
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bm.to_mesh(me)
    q = bpy.data.objects.new("quay", me)
    q.scale = (x1 - x0, y1 - y0, top + 3)
    q.location = ((x0 + x1) / 2, (y0 + y1) / 2, (top - 3) / 2)
    qm = bpy.data.materials.new("quay_prev")
    qm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.3, 0.29, 0.27, 1)
    me.materials.append(qm)
    bpy.context.scene.collection.objects.link(q)
    return q


def root_of(o):
    while o.parent is not None:
        o = o.parent
    return o


def preview_lines(objs):
    """Blender renders no loose edges: give each object's rigging lines thin tubes, preview only."""
    for o in list(objs.values()):
        if "rig" not in o:
            continue
        flat = json.loads(o["rig"])
        m = Mesh(ao=0.0)
        for i in range(0, len(flat), 6):
            a, b = V(*flat[i:i + 3]), V(*flat[i + 3:i + 6])
            if (b - a).length > 1e-4:
                m.tube([a, b], [0.022, 0.022], 3, RIG, smooth=False)
        m.lines = []
        to_object(m, o.name + "_rigprev", parent=o)


def preview_materials():
    bp.preview_materials()
    for mt in bpy.data.materials:
        if mt.name in THIN:
            mt.use_backface_culling = False


def aim(cam, loc, target, lens=35):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens


def render(path, res):
    sc = bpy.context.scene
    for o in sc.objects:
        if "_cap" in o.name:
            o.hide_render = True
    sc.render.resolution_x, sc.render.resolution_y = res
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.filepath = path
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    print(f"[build_boats] preview -> {path}")


def dup(ob, loc, rz):
    """A linked copy of an object and its children, for the harbour scene."""
    c = ob.copy()
    bpy.context.scene.collection.objects.link(c)
    c.location = loc
    c.rotation_euler = (0, 0, rz)
    c.hide_render = False
    for ch in ob.children:
        cc = ch.copy()
        bpy.context.scene.collection.objects.link(cc)
        cc.parent = c
        cc.hide_render = False
    return c


def preview_lineup(objs):
    """All objects side by side, broadside to the camera, bows to the left."""
    cam = stage()
    for o in objs.values():
        o.hide_render = False
    rows = [(0.0, ["barque", "steamer"]), (-45.0, ["rhine_barge", "hengst", "tug", "paddle_tug"]),
            (-80.0, ["lighter", "lighter_loaded", "sloop", "rowboat", "punt", "pontoon_section", "portal_crane", "hand_crane"])]
    for y, names in rows:
        x = 0.0
        for n in names:
            o = objs[n]
            rz = math.pi / 2 if n not in ("portal_crane", "hand_crane") else math.radians(-60)
            o.rotation_euler = (0, 0, rz)
            bpy.context.view_layer.update()
            pts = [o.matrix_world @ Vector(c) for c in o.bound_box]
            for ch in o.children:
                pts += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
            lo = min(p.x for p in pts)
            hi = max(p.x for p in pts)
            o.location = (x - lo, y, 0)
            x += hi - lo + 4.0
        for n in names:
            objs[n].location.x -= x / 2
    bpy.context.view_layer.update()
    aim(cam, (0, -175, 62), (0, -35, 6), lens=30)
    render(os.path.join(SHOTS, "boats_preview.png"), (1920, 1080))


def preview_harbour(objs):
    """A stretch of quay (top 1.8 m above the water) with ships moored along it, cranes on it,
    a pontoon walkway going out with barges alongside, small boats about."""
    cam = stage()
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name not in ("water", "quay"):
            o.hide_render = True
    quay(-120, 120, 0, 40)
    R = math.pi / 2
    pl = [("steamer", (-55, -4.6, 0), -R), ("barque", (18, -5.0, 0), R), ("barque", (18, -15.0, 0), R),
          ("rhine_barge", (-62, -14.0, 0), R), ("lighter_loaded", (-40, -13.0, 0), -R), ("tug", (-20, -12.0, 0), R + 0.3),
          ("hengst", (62, -3.0, 0), -R), ("lighter", (62, -8.8, 0), -R), ("sloop", (84, -2.4, 0), R),
          ("rowboat", (46, -2.0, 0), R + 0.2), ("punt", (40, -1.4, 0), R - 0.1), ("paddle_tug", (-5, -30, 0), R - 0.4),
          ("portal_crane", (-50, 6.0, 1.8), 0.4), ("portal_crane", (10, 6.0, 1.8), -0.2), ("hand_crane", (36, 2.2, 1.8), 0.6)]
    for n, loc, rz in pl:
        dup(objs[n], loc, rz)
    for i in range(3):
        dup(objs["pontoon_section"], (-8, -5 - 10 * i, 0), 0)
    dup(objs["rhine_barge"], (-8 - 2.35 - 0.3 - 3.1, -19, 0), 0.0)
    dup(objs["lighter"], (-8 + 2.35 + 0.3 + 2.2, -16, 0), math.pi)
    bpy.context.view_layer.update()
    aim(cam, (-10, -95, 22), (0, -5, 5), lens=26)
    render(os.path.join(SHOTS, "boats_harbour.png"), (1920, 1080))


def closeup(objs, names, path, az=-35.0, el=0.35):
    cam = stage()
    sel = [objs[n] for n in names]
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name not in ("water", "quay"):
            o.hide_render = root_of(o) not in sel
    x = 0.0
    for o in sel:
        o.location = (x, 0, 0)
        bpy.context.view_layer.update()
        x += max(o.dimensions) * 0.6 + 4
    bpy.context.view_layer.update()
    pts = []
    for o in sel:
        pts += [o.matrix_world @ Vector(c) for c in o.bound_box]
        for ch in o.children:
            pts += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    c = (lo + hi) / 2
    r = (hi - lo).length / 2
    a = math.radians(az)
    d = r * 2.1
    aim(cam, (c.x + d * math.sin(a), c.y - d * math.cos(a), c.z + d * el), c, lens=35)
    render(path, (1600, 1000))


def closeups_each(objs, names, outdir, views=((-35.0, 0.45), (150.0, 0.3))):
    """M7 boats: one close picture per object and view (azimuth, elevation), the object alone at the origin."""
    cam = stage()
    for n in names:
        ob = objs[n]
        for o in bpy.context.scene.objects:
            if o.type == "MESH" and o.name not in ("water", "quay"):
                o.hide_render = root_of(o) is not ob
        ob.location = (0, 0, 0)
        ob.rotation_euler = (0, 0, 0)
        bpy.context.view_layer.update()
        pts = [ob.matrix_world @ Vector(c) for c in ob.bound_box]
        for ch in ob.children:
            pts += [ch.matrix_world @ Vector(c) for c in ch.bound_box]
        lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
        hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
        c = (lo + hi) / 2
        c.z = min(c.z, 1.5)
        r = max(hi.x - lo.x, hi.y - lo.y, 2.0) / 2
        for k, (az, el) in enumerate(views):
            a = math.radians(az)
            d = r * 1.9 + 1.0
            aim(cam, (c.x + d * math.sin(a), c.y - d * math.cos(a), max(0.6, c.z + d * el)), c, lens=35)
            render(os.path.join(outdir, f"{n}_{k}.png"), (960, 600))


# ------------------------------------------------------------------ main


CRANE_VIEWS = [
    # name, camera, target, lens: the crane at the origin, its jib at rest along -y, the ladder at +y
    ("whole", (15, -14, 9), (0, -3.5, 7.0), 28),
    ("whole_back", (-12, 14, 5), (0, 0, 6.5), 28),
    ("side", (18, 1, 5), (0, -2, 6.5), 30),
    ("bogie", (3.9, 4.6, 1.0), (2.2, 2.6, 0.45), 35),
    ("bogie_in", (1.0, 1.4, 0.7), (2.2, 2.6, 0.45), 35),
    ("leg", (4.7, 5.0, 2.4), (1.9, 2.5, 2.3), 35),
    ("knee", (1.4, 6.8, 2.2), (0, 2.5, 3.2), 35),
    ("frame_front", (1.5, -8.0, 3.5), (0, -2.5, 4.2), 35),
    ("ring", (5.2, -1.2, 6.0), (0, 0, 5.95), 35),
    ("under", (0.4, -1.2, 1.6), (0, 0.4, 5.6), 28),
    ("cab_out", (4.4, -3.6, 8.2), (0, -0.2, 7.7), 35),
    ("cab_back", (-3.6, 5.4, 8.3), (0, 0.8, 7.9), 35),
    ("cab_in", (0.85, -1.1, 8.15), (-0.5, 0.5, 7.4), 26),
    ("cab_in2", (0.8, 1.2, 8.1), (-0.5, -0.4, 7.2), 26),
    ("jib_head", (2.2, -9.9, 15.4), (0, -11.2, 14.5), 35),
    ("jib_mid", (3.4, -4.5, 11.6), (0, -6, 10.4), 35),
    ("gallery", (1.62, 1.6, 8.0), (1.6, -1.8, 6.9), 30),
    ("roof", (2.8, 2.6, 11.2), (0, 0.4, 9.4), 35),
]


def preview_crane(objs, outdir, only=None):
    """Close pictures of the portal crane from CRANE_VIEWS (crane_bl_<view>.png), for the detail work."""
    cam = stage(water=False)
    quay(-30, 30, -30, 30, top=0.0)
    ob = objs["portal_crane"]
    for o in bpy.context.scene.objects:
        if o.type == "MESH" and o.name not in ("water", "quay"):
            o.hide_render = root_of(o) is not ob
    ob.location = (0, 0, 0)
    ob.rotation_euler = (0, 0, 0)
    bpy.context.view_layer.update()
    for name, loc, tgt, lens in CRANE_VIEWS:
        if only and name not in only:
            continue
        aim(cam, loc, tgt, lens)
        render(os.path.join(outdir, f"crane_bl_{name}.png"), (960, 600))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # the crane's switches live in boats/cranes.py, where its builders and checks read them
    cranes.CRANE_PREVIEW = "--crane-views" in argv
    cranes.CRANE_ZFIGHT = "--crane-zfight" in argv or "--crane-zfight-at" in argv
    if "--crane-zfight-at" in argv:
        cranes.CRANE_ZFIGHT_AT = tuple(float(v) for v in argv[argv.index("--crane-zfight-at") + 1].split(","))
    make_materials()
    objs, counts = build_all()
    if cranes.CRANE_PREVIEW:
        print("[build_boats] --crane-views: the game's wheels drawn on the crane, boats.glb not written")
    else:
        export()
    for n, c in counts.items():
        print(f"[build_boats] {n:16s} {c:5d} tris")
    print(f"[build_boats] {len(counts)} objects, {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv or "--closeup" in argv or "--harbour" in argv:
        preview_materials()
        preview_lines(objs)
    if "--preview" in argv:
        preview_lineup(objs)
    if "--harbour" in argv or "--preview" in argv:
        preview_harbour(objs)
    if "--each" in argv:
        i = argv.index("--each")
        preview_materials()
        preview_lines(objs)
        closeups_each(objs, argv[i + 1].split(","), os.path.abspath(os.path.join(ROOT, argv[i + 2])))
    if "--crane-views" in argv:  # -- --crane-views data/shots [view,view]
        i = argv.index("--crane-views")
        preview_materials()
        preview_lines(objs)
        only = argv[i + 2].split(",") if len(argv) > i + 2 and not argv[i + 2].startswith("--") else None
        preview_crane(objs, os.path.abspath(os.path.join(ROOT, argv[i + 1])), only)
    if "--closeup" in argv:
        i = argv.index("--closeup")
        names = argv[i + 1].split(",")
        az = float(argv[i + 3]) if len(argv) > i + 3 else -35.0
        el = float(argv[i + 4]) if len(argv) > i + 4 else 0.35
        closeup(objs, names, os.path.abspath(os.path.join(ROOT, argv[i + 2])), az, el)


if __name__ == "__main__":
    main()
