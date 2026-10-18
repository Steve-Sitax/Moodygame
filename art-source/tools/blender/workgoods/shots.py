"""Preview pictures of the work goods (Eevee, daylight, a neutral grey ground): each model alone in a 3/4 view and a
close low view of an edge or corner, and a sheet of all of them at true scale beside a 1.75 m grey figure. The
preview material multiplies the atlas by the baked vertex colour, as the game does."""

import math
import os

import bpy
from mathutils import Vector

# per model: views as (direction from the target toward the camera, target as fractions of the bounding box,
# distance as a factor of the box's radius); Blender axes (front = -Y)
VIEWS = {
    "default": [((0.75, -1.0, 0.62), (0.5, 0.5, 0.45), 3.4), ((0.55, -1.0, 0.16), (0.92, 0.04, 0.22), 1.0)],
    "held_knife": [((1.0, -0.6, 0.35), (0.5, 0.5, 0.5), 3.3), ((1.0, 0.25, 0.25), (0.5, 0.5, 0.78), 1.0)],
    "held_fish": [((0.3, -1.0, 0.45), (0.5, 0.5, 0.5), 3.0), ((0.5, -1.0, 0.15), (0.82, 0.3, 0.5), 1.0)],
    "crab_winch": [((-0.9, 1.0, 0.55), (0.5, 0.5, 0.45), 3.3), ((0.9, -1.0, 0.5), (0.5, 0.5, 0.45), 3.3),
                   ((-0.6, 1.0, 0.3), (0.32, 0.5, 0.72), 1.1), ((-1.0, 0.2, 0.25), (0.2, 0.5, 0.82), 1.3)],
    "tub": [((0.75, -1.0, 0.9), (0.5, 0.5, 0.4), 3.4), ((0.55, -1.0, 0.16), (0.5, 0.06, 0.3), 1.0)],
    "featherbed": [((0.75, -1.0, 0.62), (0.5, 0.5, 0.45), 3.4), ((1.0, -0.6, 0.16), (0.95, 0.3, 0.35), 0.9)],
    "hides": [((0.75, -1.0, 0.75), (0.5, 0.5, 0.45), 3.4), ((0.55, -1.0, 0.16), (0.9, 0.06, 0.4), 0.9)],
}
LIFT = {"held_knife": 0.25, "held_fish": 0.15}


def _engine():
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"


def preview_material(mat):
    """The atlas times the vertex colour (only for the pictures: the exported material stays plain)."""
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    va = nt.nodes.new("ShaderNodeVertexColor")
    va.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mul.inputs[6])
    nt.links.new(va.outputs["Color"], mul.inputs[7])
    nt.links.new(mul.outputs[2], bsdf.inputs["Base Color"])


def stage():
    scn = bpy.context.scene
    scn.render.engine = _engine()
    try:
        scn.eevee.taa_render_samples = 48
    except AttributeError:
        pass
    scn.view_settings.view_transform = "Standard"
    scn.render.resolution_x, scn.render.resolution_y = 1100, 800
    scn.render.image_settings.file_format = "PNG"
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    bg = w.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.42, 0.47, 0.55, 1.0)
    bg.inputs["Strength"].default_value = 0.9
    scn.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.data.angle = math.radians(2.0)
    sun.rotation_euler = (math.radians(48), 0.0, math.radians(35))
    scn.collection.objects.link(sun)
    gm = bpy.data.materials.new("ground")
    gm.use_nodes = True
    g = gm.node_tree.nodes.get("Principled BSDF")
    g.inputs["Base Color"].default_value = (0.20, 0.20, 0.20, 1.0)
    g.inputs["Roughness"].default_value = 0.95
    me = bpy.data.meshes.new("ground")
    S = 30.0
    me.from_pydata([(-S, -S, 0), (S, -S, 0), (S, S, 0), (-S, S, 0)], [], [(0, 1, 2, 3)])
    me.materials.append(gm)
    ground = bpy.data.objects.new("ground", me)
    scn.collection.objects.link(ground)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 50
    cam.data.clip_start = 0.005
    scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def world_box(objs):
    pts = []
    for ob in objs:
        if ob.type != "MESH":
            continue
        pts += [ob.matrix_world @ Vector(c) for c in ob.bound_box]
    lo = Vector((min(p.x for p in pts), min(p.y for p in pts), min(p.z for p in pts)))
    hi = Vector((max(p.x for p in pts), max(p.y for p in pts), max(p.z for p in pts)))
    return lo, hi


def aim(cam, target, direction, dist):
    d = Vector(direction).normalized()
    cam.location = target + d * dist
    cam.rotation_euler = (target - cam.location).to_track_quat("-Z", "Y").to_euler()


def shoot(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def render_all(built, names, outdir, mat):
    preview_material(mat)
    cam = stage()
    tops = {n: built[n][0] for n in names}
    alls = {n: [built[n][0]] + list(built[n][1]) for n in names}
    for n in names:
        for ob in alls[n]:
            ob.hide_render = True
    for n in names:
        top = tops[n]
        lift = LIFT.get(n, 0.0)
        top.location.z += lift
        bpy.context.view_layer.update()
        for ob in alls[n]:
            ob.hide_render = False
        lo, hi = world_box(alls[n])
        rad = (hi - lo).length / 2
        for k, (d, f, df) in enumerate(VIEWS.get(n, VIEWS["default"])):
            tgt = Vector((lo.x + (hi.x - lo.x) * f[0], lo.y + (hi.y - lo.y) * f[1], lo.z + (hi.z - lo.z) * f[2]))
            aim(cam, tgt, d, max(0.12, rad * df))
            shoot(os.path.join(outdir, "%s_%d.png" % (n, k)))
        for ob in alls[n]:
            ob.hide_render = True
        top.location.z -= lift
        bpy.context.view_layer.update()
    # the sheet: all in a row at true scale, a 1.75 m figure at the left
    x = 0.0
    me = bpy.data.meshes.new("figure")
    import bmesh
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=24, radius1=0.17, radius2=0.17, depth=1.75)
    bmesh.ops.translate(bm, verts=bm.verts, vec=(0, 0, 0.875))
    bm.to_mesh(me)
    bm.free()
    fm = bpy.data.materials.new("figure")
    fm.use_nodes = True
    fm.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = (0.3, 0.3, 0.3, 1.0)
    me.materials.append(fm)
    fig = bpy.data.objects.new("figure", me)
    bpy.context.scene.collection.objects.link(fig)
    fig.location = (x, 0, 0)
    x += 0.45
    moved = []
    for n in names:
        lo, hi = world_box(alls[n])
        w = hi.x - lo.x
        top = tops[n]
        dx = x - lo.x
        top.location.x += dx
        top.location.z += LIFT.get(n, 0.0) * (0.0 if n not in LIFT else 1.0)
        moved.append((top, dx, LIFT.get(n, 0.0)))
        for ob in alls[n]:
            ob.hide_render = False
        x += w + 0.25
    bpy.context.view_layer.update()
    mid = Vector((x / 2, 0, 0.55))
    aim(cam, mid, (0.0, -1.0, 0.30), max(4.0, x * 1.42))
    bpy.context.scene.render.resolution_x, bpy.context.scene.render.resolution_y = 2000, 800
    shoot(os.path.join(outdir, "sheet.png"))
    for top, dx, lift in moved:
        top.location.x -= dx
        top.location.z -= lift
    bpy.context.view_layer.update()
