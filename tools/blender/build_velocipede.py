"""The velocipede of 1873 (the "boneshaker"), modelled and painted by this script.

    blender -b --factory-startup -P tools/blender/build_velocipede.py
    blender -b --factory-startup -P tools/blender/build_velocipede.py -- --preview

Writes client/public/models/velocipede.glb (Draco). A Michaux-style velocipede as
sold in Paris and Brussels from 1867: a wrought-iron serpentine backbone, wooden
wheels with iron tyres (front 0.92 m, rear 0.76 m), the pedals fixed to the front
hub (no chain: one turn of the pedals is one turn of the wheel), a leather saddle
on a long leaf spring, a straight handlebar with wooden grips, and a spoon brake
on the rear tyre worked by a cord from the handlebar. Real scale in metres. The
front of the machine looks toward -Y in Blender, which is +Z in the game.

Four nodes, so the game can move the parts:
  velocipede               the frame (backbone, rear fork, spring, saddle, brake);
                           origin on the ground about under the saddle.
    velocipede_steer       fork, head, handlebar; turns about the steering axis
                           (vertical, through the front axle).
      velocipede_front     the front wheel with its cranks and pedals; spins about
                           the axle (game x). Origin at the axle.
    velocipede_rear        the rear wheel; spins about its axle. Origin at the axle.

Extras on the root: "front_axle" and "rear_axle" (game x, y, z), "saddle" (the
seat top), "wheel_r" (front, rear radius). About 1.3k triangles in all.

Everything here is our own work, built from code with the helpers and the prop
materials of build_props.py (wood_dark, iron, leather, wood); no downloaded models
or images. --preview renders a sheet to data/shots/velocipede_preview.png.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True  # no __pycache__ next to the scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_props as bp  # noqa: E402
from build_props import Mesh  # noqa: E402
from build_props import DARK, IRON, LEATHER, WOOD  # noqa: E402

ROOT = bp.ROOT
OUT = os.path.join(ROOT, "client", "public", "models", "velocipede.glb")
SHOT = os.path.join(ROOT, "data", "shots", "velocipede_preview.png")

# ------------------------------------------------------------------ dimensions (Blender: front = -Y, up = +Z)

RF, RR = 0.46, 0.38  # wheel radii
FY, RY = -0.56, 0.62  # axle positions along the machine
HEAD_Z0, HEAD_Z1 = 0.9, 1.02  # the steering head
BAR_Z = 1.1  # handlebar height
SADDLE = (0.0, 0.02, 0.97)  # top of the seat
CRANK = 0.13  # crank length


def wheel(m, r, spokes, segs, w=0.036):
    """A velocipede wheel about its own axle (X): iron tyre, wooden felloe, turned spokes, iron-bound hub."""
    bp.wheel(m, (0, 0, 0), r, w, spokes, segs, fel=0.04, hub=0.055, spoke=0.017)


def front_wheel():
    m = Mesh(ao=0)
    wheel(m, RF, 12, 20)
    # the axle and a crank each side, the pedals (weighted, so they hang foot-up)
    m.beam((-0.075, 0, 0), (0.075, 0, 0), 0.022, 0.022, IRON, side=(0, 0, 1))
    for sx, a in ((-1, 0.0), (1, math.pi)):
        x = sx * 0.085
        end = Vector((x, math.sin(a) * CRANK, -math.cos(a) * CRANK))
        m.beam((x, 0, 0), tuple(end), 0.016, 0.03, IRON, side=(1, 0, 0), w2=0.014, h2=0.022)
        # the pedal: an iron spindle with a wooden block, and a lead weight under it
        px = x + sx * 0.06
        m.beam(tuple(end), (px + sx * 0.04, end.y, end.z), 0.012, 0.012, IRON, side=(0, 0, 1))
        m.box((px, end.y, end.z + 0.01), (0.085, 0.05, 0.024), WOOD)
        m.box((px, end.y, end.z - 0.028), (0.05, 0.04, 0.03), IRON)
    return m


def rear_wheel():
    m = Mesh(ao=0)
    wheel(m, RR, 10, 18)
    m.beam((-0.06, 0, 0), (0.06, 0, 0), 0.02, 0.02, IRON, side=(0, 0, 1))
    return m


def steer():
    """Fork, head, handlebar. Built round the front axle at the origin; the head is above it."""
    m = Mesh(ao=0)
    zh0, zh1 = HEAD_Z0 - RF, HEAD_Z1 - RF
    # the head: a turned socket the backbone hangs on
    m.lathe([(0.026, zh0 - 0.02), (0.034, zh0), (0.034, zh1), (0.026, zh1 + 0.02)], 8, IRON, cap0=True, cap1=True, smooth=False)
    # the fork: two flat blades from the crown down to the axle ends, a crown across
    for sx in (-1, 1):
        m.tube([(sx * 0.03, 0.0, zh0 - 0.02), (sx * 0.055, 0.0, zh0 - 0.2), (sx * 0.068, 0.0, 0.04), (sx * 0.068, 0.0, -0.02)],
               [(0.012, 0.02), (0.012, 0.019), (0.011, 0.016), (0.011, 0.016)], 6, IRON, side=(1, 0, 0), smooth=False)
        # the footrests on the fork, for coasting downhill with the feet up
        m.beam((sx * 0.06, 0.0, 0.2), (sx * 0.16, -0.02, 0.2), 0.014, 0.014, IRON, side=(0, 0, 1))
    m.beam((-0.075, 0, zh0 - 0.03), (0.075, 0, zh0 - 0.03), 0.03, 0.022, IRON, side=(0, 0, 1))
    # the stem and the bar, pulled back toward the rider, wooden grips
    zb = BAR_Z - RF
    m.beam((0, 0, zh1 + 0.02), (0, 0.03, zb), 0.024, 0.024, IRON, side=(1, 0, 0))
    bar = [(-0.33, 0.1, zb - 0.01), (-0.18, 0.05, zb), (0.0, 0.03, zb), (0.18, 0.05, zb), (0.33, 0.1, zb - 0.01)]
    m.tube(bar, [0.011] * len(bar), 6, IRON, side=(0, 0, 1), smooth=False)
    for sx in (-1, 1):
        m.tube([(sx * 0.3, 0.09, zb - 0.008), (sx * 0.42, 0.13, zb - 0.02)], [0.019, 0.017], 6, WOOD, side=(0, 0, 1), cap0=True, cap1=True, smooth=False)
    # the brake handle: turning the bar pulls the cord (a small drum on the right of the stem)
    m.box((0.05, 0.035, zb - 0.02), (0.03, 0.03, 0.04), IRON)
    return m


def frame():
    m = Mesh(ao=0.25)
    # the serpentine backbone: from the head, a long S down to the rear axle
    back = [(0, FY + 0.06, HEAD_Z1 - 0.01), (0, FY + 0.2, 0.98), (0, -0.12, 0.9), (0, 0.12, 0.8), (0, 0.34, 0.69), (0, 0.5, 0.6)]
    m.tube(back, [(0.02, 0.024), (0.021, 0.026), (0.02, 0.025), (0.019, 0.023), (0.018, 0.022), (0.017, 0.02)], 6, IRON, side=(1, 0, 0),
           cap0=True, smooth=True)
    # the collar round the head
    m.lathe([(0.042, HEAD_Z0 + 0.03), (0.042, HEAD_Z1 - 0.03)], 8, IRON, smooth=False)
    # rear fork: the backbone splits round the rear wheel to the axle ends
    for sx in (-1, 1):
        m.tube([(0, 0.48, 0.61), (sx * 0.035, 0.53, 0.55), (sx * 0.055, RY - 0.02, RR + 0.02), (sx * 0.058, RY + 0.02, RR)],
               [0.015, 0.014, 0.012, 0.012], 5, IRON, side=(0, 0, 1), smooth=False)
    # the saddle spring: a long leaf from over the head to the backbone's middle, bolted at both ends
    spring = [(0, FY + 0.12, 1.0), (0, -0.25, 0.975), (0, -0.05, 0.955), (0, 0.18, 0.93), (0, 0.3, 0.81)]
    m.tube(spring, [(0.03, 0.006)] * len(spring), 4, IRON, side=(1, 0, 0), smooth=False)
    m.box((0, FY + 0.12, 1.0), (0.05, 0.03, 0.03), IRON)
    m.box((0, 0.3, 0.805), (0.05, 0.03, 0.03), IRON)
    # the saddle: a leather seat, broad at the back, a nose to the front, on a small iron pan
    sx0, sy0, sz0 = SADDLE
    ring = [(-0.1, 0.1), (-0.11, 0.02), (-0.07, -0.08), (-0.025, -0.15), (0.025, -0.15), (0.07, -0.08), (0.11, 0.02), (0.1, 0.1)]
    lo = [(sx0 + x * 0.95, sy0 + y, sz0 - 0.05) for x, y in ring]
    hi = [(sx0 + x, sy0 + y, sz0) for x, y in ring]
    m.grid([lo, hi], LEATHER, closed=True, smooth=False, cap1=True)
    m.poly(lo, IRON, out=(0, 0, -1))
    m.box((sx0, sy0 + 0.1, sz0 - 0.03), (0.2, 0.02, 0.03), IRON)  # the cantle bar
    for sx in (-1, 1):
        m.box((sx * 0.06, sy0 + 0.11, sz0 - 0.07), (0.012, 0.012, 0.045), IRON)  # coil springs, a hint
    # the spoon brake on the rear tyre, hung from the backbone, with its cord forward along the frame
    m.beam((0, 0.52, 0.6), (0, RY - 0.12, RR + RR * 0.93), 0.014, 0.014, IRON, side=(1, 0, 0))
    m.box((0, RY - 0.15, RR + RR * 0.95), (0.05, 0.08, 0.018), IRON)
    cord = [(0.03, FY + 0.12, 1.05), (0.03, -0.1, 0.93), (0.02, 0.3, 0.72), (0.012, 0.52, 0.62)]
    m.tube(cord, [0.004] * len(cord), 3, DARK, side=(0, 0, 1), smooth=False)
    return m


def to_object(m, name, loc=(0, 0, 0), parent=None):
    ob = m.to_object(name)
    ob.location = loc
    if parent is not None:
        ob.parent = parent
    return ob


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bp.make_materials()
    root = to_object(frame(), "velocipede")
    st = to_object(steer(), "velocipede_steer", (0, FY, RF), root)
    fw = to_object(front_wheel(), "velocipede_front", (0, 0, 0), st)
    rw = to_object(rear_wheel(), "velocipede_rear", (0, RY, RR), root)
    # extras in the game frame (x, y up, z = -Blender y)
    root["front_axle"] = json.dumps([0, RF, -FY])
    root["rear_axle"] = json.dumps([0, RR, -RY])
    root["saddle"] = json.dumps([SADDLE[0], SADDLE[2], -SADDLE[1]])
    root["wheel_r"] = json.dumps([RF, RR])
    counts = {o.name: bp.tris(o) for o in (root, st, fw, rw)}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)
    for n, c in counts.items():
        print(f"[build_velocipede] {n:24s} {c:5d} tris")
    print(f"[build_velocipede] {sum(counts.values())} tris -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        bp.preview_materials()
        preview([root, st, fw, rw])


def preview(objs):
    cam = bp.stage()
    sc = bpy.context.scene
    try:
        sc.eevee.taa_render_samples = 16
    except AttributeError:
        pass
    views = [((2.6, 0.3, 1.0), (0, 0.0, 0.6), 50), ((1.5, -1.9, 1.5), (0, 0, 0.6), 45), ((-0.6, 1.3, 1.95), (0, -0.5, 0.7), 40), ((0.0, -2.4, 0.9), (0, 0, 0.6), 50)]
    import numpy as np
    import tempfile
    tmp = os.path.join(tempfile.gettempdir(), "velo_panels")
    os.makedirs(tmp, exist_ok=True)
    pw, ph = 800, 560
    sheet = np.zeros((ph * 2, pw * 2, 4), dtype=np.float32)
    for i, (loc, target, lens) in enumerate(views):
        bp.aim(cam, loc, target, lens)
        path = os.path.join(tmp, f"p{i}.png")
        sc.render.resolution_x, sc.render.resolution_y = pw, ph
        sc.render.resolution_percentage = 100
        sc.render.image_settings.file_format = "PNG"
        sc.render.filepath = path
        bpy.ops.render.render(write_still=True)
        img = bpy.data.images.load(path)
        buf = np.empty(pw * ph * 4, dtype=np.float32)
        img.pixels.foreach_get(buf)
        bpy.data.images.remove(img)
        r, c = divmod(i, 2)
        sheet[ph * (1 - r):ph * (2 - r), c * pw:(c + 1) * pw] = buf.reshape(ph, pw, 4)
    sheet[..., 3] = 1
    out = bpy.data.images.new("velo_sheet", pw * 2, ph * 2, alpha=False)
    out.pixels.foreach_set(sheet.ravel())
    out.filepath_raw = SHOT
    out.file_format = "PNG"
    os.makedirs(os.path.dirname(SHOT), exist_ok=True)
    out.save()
    print(f"[build_velocipede] preview -> {SHOT}")


if __name__ == "__main__":
    main()
