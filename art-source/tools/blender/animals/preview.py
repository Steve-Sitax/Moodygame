"""Check pictures from Blender (outside git, in .scratch/animals-build/shots): side, front, back, top and three
quarter views of each animal, lit or textured, and contact sheets of its clips."""

import math
import os

import bpy
from mathutils import Vector

from . import B, SHOTS


def setup(textured=False, eevee=False, bg=0.42):
    scn = bpy.context.scene
    if eevee:
        scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    else:
        scn.render.engine = "BLENDER_WORKBENCH"
        sh = scn.display.shading
        sh.light = "STUDIO"
        sh.color_type = "TEXTURE" if textured else "SINGLE"
        sh.single_color = (0.62, 0.55, 0.47)
        sh.show_backface_culling = True
        sh.show_specular_highlight = False
        try:
            sh.studiolight_rotate_z = math.radians(70)
        except AttributeError:
            pass
        sh.show_cavity = not textured
        sh.cavity_type = "WORLD"
    scn.view_settings.view_transform = "Standard"
    if scn.world is None:
        scn.world = bpy.data.worlds.new("w")
    scn.world.color = (bg, bg, bg)
    cam = bpy.data.objects.get("cam")
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        scn.collection.objects.link(cam)
    scn.camera = cam
    os.makedirs(SHOTS, exist_ok=True)
    return cam


def shoot(path, eye_game, at_game, lens=50, w=1200, h=800, ortho=None, frame=None):
    scn = bpy.context.scene
    cam = scn.camera
    if frame is not None:
        scn.frame_set(frame)
    loc = B(*eye_game)
    cam.location = loc
    cam.rotation_euler = (B(*at_game) - loc).to_track_quat("-Z", "Y").to_euler()
    if ortho:
        cam.data.type = "ORTHO"
        cam.data.ortho_scale = ortho
    else:
        cam.data.type = "PERSP"
        cam.data.lens = lens
    cam.data.clip_start = 0.01
    scn.render.resolution_x = w
    scn.render.resolution_y = h
    scn.render.filepath = path
    bpy.ops.render.render(write_still=True)


def views(prefix, H, centre=(0, 0, 0), size=None, textured=False):
    """Side, front, back, top, three-quarter views of whatever is at the centre."""
    setup(textured)
    cx, cy, cz = centre
    s = size or 2.6 * H
    d = 6 * H
    mid = (cx, cy + 0.55 * H, cz)
    for name, eye in (("side", (cx + d, cy + 0.55 * H, cz)), ("front", (cx, cy + 0.6 * H, cz + d)),
                      ("back", (cx, cy + 0.6 * H, cz - d)), ("top", (cx + 0.001, cy + d, cz)),
                      ("low", (cx + 0.5 * d, cy + 0.05 * H, cz - 0.5 * d))):
        shoot(os.path.join(SHOTS, f"{prefix}_{name}.png"), eye, mid, ortho=s if name != "low" else None, lens=60,
              w=1000, h=760)
    shoot(os.path.join(SHOTS, f"{prefix}_34.png"), (cx + 2.2 * H, cy + 1.1 * H, cz + 2.6 * H), (cx, cy + 0.5 * H, cz + 0.1 * H),
          lens=45, w=1000, h=760)
    shoot(os.path.join(SHOTS, f"{prefix}_face.png"), (cx + 0.5 * H, cy + 1.2 * H, cz + 1.9 * H), (cx, cy + 1.05 * H, cz + 0.8 * H),
          lens=60, w=900, h=760)
    shoot(os.path.join(SHOTS, f"{prefix}_paw.png"), (cx + 0.9 * H, cy + 0.35 * H, cz + 1.0 * H), (cx + 0.14 * H, cy + 0.06 * H, cz + 0.45 * H),
          lens=60, w=900, h=760)
