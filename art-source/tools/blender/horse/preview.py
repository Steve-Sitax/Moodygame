"""Check pictures of the horse from Blender (outside git, .scratch/horse-build/shots): clay (the shape alone) and
textured, the standing horse from the side, the front, low in front (the chest), behind, the head, the harness and
the legs."""

import math
import os

import bpy
from mathutils import Vector

from . import OUT_DIR

SHOTS = os.path.join(OUT_DIR, "shots")
VIEWS = {
    "side": ((-4.6, 0.2, 1.5), (0, 0.05, 1.15), 35),
    "front": ((-2.0, -3.8, 1.8), (0, -0.4, 1.25), 35),
    "chestlow": ((-0.35, -2.6, 0.45), (0, -0.7, 1.15), 35),
    "back": ((2.2, 3.9, 1.9), (0, 0.3, 1.1), 35),
    "head": ((-1.25, -2.4, 2.2), (0, -1.3, 1.85), 50),
    "harness": ((-2.3, -0.7, 2.4), (0, -0.2, 1.45), 40),
    "legs": ((-2.4, -1.1, 0.55), (0, 0.0, 0.45), 35),
    "hoof": ((-0.9, -1.4, 0.25), (-0.19, -0.67, 0.08), 50),
}


def camera():
    scn = bpy.context.scene
    cam = bpy.data.objects.get("cam")
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scn.collection.objects.link(cam)
    scn.camera = cam
    return cam


def aim(cam, loc, target, lens):
    cam.location = Vector(loc)
    cam.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat("-Z", "Y").to_euler()
    cam.data.lens = lens
    cam.data.clip_start = 0.02


def render(path, w=1000, h=760):
    scn = bpy.context.scene
    scn.render.resolution_x, scn.render.resolution_y = w, h
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)


def only(objs):
    for o in bpy.data.objects:
        if o.type == "MESH" and o.name != "floor":
            o.hide_render = o not in objs


def clay(objs):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_WORKBENCH"
    sh = scn.display.shading
    sh.light = "STUDIO"
    sh.color_type = "SINGLE"
    sh.single_color = (0.62, 0.55, 0.47)
    sh.show_cavity = True
    sh.cavity_type = "WORLD"
    sh.show_backface_culling = True
    scn.view_settings.view_transform = "Standard"
    if scn.world is None:
        scn.world = bpy.data.worlds.new("w")
    scn.world.color = (0.5, 0.5, 0.5)
    only(objs)
    cam = camera()
    os.makedirs(SHOTS, exist_ok=True)
    for name, (loc, target, lens) in VIEWS.items():
        aim(cam, loc, target, lens)
        render(os.path.join(SHOTS, f"clay_{name}.png"))


def textured(objs, standing, pics):
    """EEVEE, a sun and a sky, each coat's picture on the standing horse."""
    from animals.checks import eevee
    eevee()
    copies = standing(objs)
    only(copies)
    cam = camera()
    mats = pics["materials"]
    for coat, mat in mats.items():
        for o in copies:
            o.data.materials.clear()
            o.data.materials.append(mat)
        for name, (loc, target, lens) in VIEWS.items():
            if coat != "bay" and name not in ("side", "front", "head"):
                continue
            aim(cam, loc, target, lens)
            render(os.path.join(SHOTS, f"{coat}_{name}.png"))
    for o in copies:
        bpy.data.objects.remove(o)
