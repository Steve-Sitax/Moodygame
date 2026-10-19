"""Preview pictures of the washing, the pegs and ring, the trough and the hatch (Eevee, daylight). The preview materials
multiply the picture by the baked occlusion and by a tint, as the game does with each copy's colour."""

import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Vector

TINTS = {"shirt": (0.86, 0.82, 0.72), "shift": (0.95, 0.94, 0.90), "trousers": (0.42, 0.30, 0.20), "apron": (0.30, 0.40, 0.58),
         "stockings": (0.40, 0.40, 0.38), "sheet": (0.93, 0.92, 0.88), "towel": (1, 1, 1)}


def tinted(mat, tint, name):
    m = mat.copy()
    m.name = name
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    t = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    va = nt.nodes.new("ShaderNodeVertexColor")
    va.layer_name = "Col"
    mul = nt.nodes.new("ShaderNodeMix")
    mul.data_type = "RGBA"
    mul.blend_type = "MULTIPLY"
    mul.inputs["Factor"].default_value = 1.0
    nt.links.new(t.outputs["Color"], mul.inputs[6])
    nt.links.new(va.outputs["Color"], mul.inputs[7])
    mul2 = nt.nodes.new("ShaderNodeMix")
    mul2.data_type = "RGBA"
    mul2.blend_type = "MULTIPLY"
    mul2.inputs["Factor"].default_value = 1.0
    nt.links.new(mul.outputs[2], mul2.inputs[6])
    mul2.inputs[7].default_value = (*tint, 1)
    nt.links.new(mul2.outputs[2], bsdf.inputs["Base Color"])
    return m


def stage():
    sc = bpy.context.scene
    ids = [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items]
    sc.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in ids else "BLENDER_EEVEE"
    sc.view_settings.view_transform = "Standard"
    sc.render.resolution_x, sc.render.resolution_y = 1000, 750
    w = bpy.data.worlds.new("sky")
    w.use_nodes = True
    w.node_tree.nodes["Background"].inputs[0].default_value = (0.45, 0.5, 0.58, 1)
    w.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    sc.world = w
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (math.radians(45), math.radians(15), math.radians(30))
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    cam.data.lens = 45
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def shoot(cam, path, eye, target, lens=45):
    cam.location = Vector(eye)
    cam.data.lens = lens
    cam.rotation_euler = (Vector(target) - cam.location).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)


def copy(ob, mat=None, M=Matrix.Identity(4)):
    c = ob.copy()
    c.data = ob.data.copy()
    if mat is not None:
        c.data.materials.clear()
        c.data.materials.append(mat)
    c.matrix_world = M
    bpy.context.scene.collection.objects.link(c)
    c.hide_render = False
    return c


def render(built, hatch, cloth_mats, kit_mat, rope_mat, out):
    cam = stage()
    for ob in list(built.values()) + [hatch]:
        ob.hide_render = True
    # each piece alone, front three-quarter and close
    for name, tint in TINTS.items():
        ob = built[name]
        m = tinted(ob.data.materials[0], tint, name + "_prev")
        c = copy(ob, m)
        d = max(1.0, ob["drop"]) * 1.25
        shoot(cam, os.path.join(out, name + "-front.png"), (0.5, -d * 1.6, -d * 0.35), (0, 0, -ob["drop"] * 0.45))
        shoot(cam, os.path.join(out, name + "-below.png"), (-0.4, -d * 0.8, -d * 1.6), (0, 0, -ob["drop"] * 0.5))
        bpy.data.objects.remove(c)
    # the hardware
    km = tinted(kit_mat, (1, 1, 1), "kit_prev")
    for name, eye, tgt in (("peg", (0.12, -0.16, 0.05), (0, 0, -0.01)), ("line_ring", (0.12, -0.22, 0.03), (0, -0.05, -0.04)),
                           ("trough", (1.6, -2.4, 1.5), (0, 0, 0.3))):
        c = copy(built[name], km)
        shoot(cam, os.path.join(out, name + ".png"), eye, tgt)
        if name == "trough":
            shoot(cam, os.path.join(out, name + "-close.png"), (0.9, -0.75, 0.85), (0.75, -0.3, 0.55))
        bpy.data.objects.remove(c)
    c = copy(hatch)
    shoot(cam, os.path.join(out, "hatch.png"), (0.4, -1.2, 0.9), (0, -0.22, 0))
    shoot(cam, os.path.join(out, "hatch-close.png"), (0.25, -0.5, 0.25), (0.1, -0.25, 0))
    bpy.data.objects.remove(c)
    # a line across a lane: rope sagging between two rings, the pieces on it with their pegs
    span, sag, y0 = 6.0, 0.35, 4.5
    def yat(x):
        t = (x + span / 2) / span
        return y0 - sag * 4 * t * (1 - t)
    pts = [(x, 0.0, yat(x)) for x in np.linspace(-span / 2, span / 2, 40)]
    from workgoods import kit
    rm = kit.Mesh("rope_line")
    rc = kit.Cell(0, 0, kit.SIZE, kit.SIZE, kit.SIZE / 0.088, "rope")
    kit.sweep(rm, pts, 0.005, 8, kit.Param(rc, k=(1.0, 0.088 / (2 * math.pi * 0.005))))
    rl = rm.build(rope_mat)
    rl.hide_render = False
    for sx in (-1, 1):
        copy(built["line_ring"], km, Matrix.Translation((sx * span / 2, 0, y0)) @ Matrix.Rotation(math.radians(-90 * sx), 4, "Z"))
    order = ["sheet", "shirt", "trousers", "stockings", "towel", "apron", "shift"]
    x = -span / 2 + 0.4
    for name in order:
        w = built[name]["line_width"]
        xc = x + w / 2
        if xc + w / 2 > span / 2 - 0.3:
            break
        slope = (yat(xc + 0.01) - yat(xc - 0.01)) / 0.02
        M = Matrix.Translation((xc, 0, yat(xc))) @ Matrix.Rotation(math.atan(slope), 4, "Y").inverted()
        copy(built[name], tinted(built[name].data.materials[0], TINTS[name], name + "_line"), M)
        for pu in built[name]["pegs"]:
            copy(built["peg"], km, M @ Matrix.Translation((pu, 0, 0)))
        x += w + 0.12
    shoot(cam, os.path.join(out, "line-street.png"), (0.8, -5.5, 1.65), (0.0, 0, 3.8), lens=32)
    shoot(cam, os.path.join(out, "line-close.png"), (-1.4, -2.0, 3.6), (-1.6, 0, 3.9), lens=40)
    print("[laundry] shots in", out)
