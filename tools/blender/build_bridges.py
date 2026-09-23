"""Opening bridges over the Canal des Brasseurs and the Sint-Pietersvliet, 1873, by script.

    blender -b --factory-startup -P tools/blender/build_bridges.py
    blender -b --factory-startup -P tools/blender/build_bridges.py -- --preview

Writes client/public/models/bridges.glb (Draco). Period: the Brouwersvliet (our Canal des
Brasseurs) had an iron swing bridge ("draaibrug") from 1864-65; the inner canals had wooden
lifting bridges ("ophaalbruggen") with a balance: two long beams ("sprieten") coupled like a
scale, resting on a gallows frame (the "hamei") (sources in assets/ATTRIBUTION.md). Our own
models, built from code with the helpers and materials of build_boats.py / build_lock.py.

Objects (origin on the quay top, y = 0 in the game; Blender +X = game +x, Blender +Y = game -z):
  swing_canal   iron swing bridge for canal_mouth: span 18.5 m, tail 6 m, 8 m wide, carrying the
                quay railway (rails centred at Blender y = +2, i.e. game z = pivot z - 2)
  swing_vliet   the same for vliet_mouth: span 15 m, tail 5 m, 7 m wide, rails at y = -1.5
                (it is turned 180 degrees in the game, so that is game z = pivot z - 1.5)
  swing_pier    turntable ring and capstan by a swing bridge's pivot
  draw_leaf_6   a drawbridge leaf 6 m long, 7 m wide: origin on the hinge, the leaf along +X;
                it lifts by turning about Blender Y (the game's z axis)
  draw_beam_6   its balance: two beams on the gallows top, origin on their pivot, front along +X
  draw_leaf_8   / draw_beam_8: the same, 8 m (one leaf over the 8 m vliet)
  draw_frame    the gallows (hamei), the fixed deck on the quay and its railings: origin on the
                hinge; the beams' pivot is at (-1.2, 0, 5.9) in this frame

--preview renders data/shots/bridges_preview.png.
"""

import math
import os
import sys

import bpy

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boats as bb  # noqa: E402
import build_lock as bl  # noqa: E402
from build_boats import DARK, DECK, IRON, WHITE, WOOD, Mesh, V, to_object  # noqa: E402

OUT = os.path.join(bb.ROOT, "client", "public", "models", "bridges.glb")
SHOT = os.path.join(bb.ROOT, "data", "shots", "bridges_preview.png")

HALF = 3.5  # drawbridge half width
PIVOT = (-1.2, 5.9)  # balance pivot relative to the hinge (x, z)


def draw_leaf(L):
    """A timber lifting leaf: deck planks on two stringers and cross beams, white railings."""
    m = Mesh(ao=0.0)
    m.box((L / 2, 0, -0.02), (L, 2 * HALF, 0.14), DECK, tile=1.6, shade=0.95)
    for sy in (1, -1):
        m.beam((0.05, sy * 2.6, -0.26), (L - 0.05, sy * 2.6, -0.26), 0.25, 0.32, DARK, side=(0, 1, 0), shade=0.7)
    for x in [L * f for f in (0.08, 0.35, 0.65, 0.92)]:
        m.beam((x, -3.3, -0.22), (x, 3.3, -0.22), 0.18, 0.22, DARK, side=(1, 0, 0), shade=0.65)
    m.box((L - 0.12, 0, -0.1), (0.24, 2 * HALF, 0.3), DARK)  # the heavier nose beam
    for sy in (1, -1):
        y = sy * (HALF - 0.1)
        n = max(2, int(L / 1.5))
        for i in range(n + 1):
            m.box((0.15 + (L - 0.3) * i / n, y, 0.55), (0.1, 0.1, 1.0), WHITE)
        m.beam((0.1, y, 1.05), (L - 0.1, y, 1.05), 0.1, 0.08, WHITE, side=(0, 1, 0))
        m.beam((0.1, y, 0.55), (L - 0.1, y, 0.55), 0.06, 0.06, WHITE, side=(0, 1, 0))
        m.box((L / 2, y, 0.12), (L, 0.14, 0.18), DARK, shade=0.85)
        # an iron strap where the chain takes hold
        m.box((L - 0.3, sy * (HALF + 0.02), 0.0), (0.3, 0.05, 0.35), IRON)
    return m


def draw_beam(L):
    """The balance: two long beams coupled by cross ties, a ballast box at the land end."""
    m = Mesh(ao=0.0)
    rear = 0.72 * L
    for sy in (1, -1):
        y = sy * (HALF + 0.05)
        m.beam((-rear, y, 0), (L, y, 0), 0.26, 0.3, WHITE, side=(0, 1, 0), w2=0.16, h2=0.2)
        m.box((L - 0.05, y, -0.15), (0.12, 0.12, 0.3), IRON)  # chain eye
    for x in (-rear + 0.3, 0.0, L * 0.4, L * 0.8):
        m.beam((x, -(HALF + 0.05), 0), (x, HALF + 0.05, 0), 0.18, 0.2, WHITE, side=(1, 0, 0))
    # the ballast: a timber box full of stone and scrap across the land end
    m.box((-rear + 0.55, 0, -0.35), (1.1, 2 * HALF + 0.4, 0.7), DARK)
    return m


def draw_frame():
    """The gallows (two posts and the hamei crossbeam), the fixed deck on the quay, railings."""
    m = Mesh(ao=0.0)
    px, pz = PIVOT
    for sy in (1, -1):
        y = sy * (HALF + 0.45)
        m.beam((px, y, 0.0), (px, y, pz - 0.2), 0.32, 0.32, WHITE, side=(1, 0, 0))
        # braces from the posts down to the deck and back to the ground
        m.beam((px, y, pz - 1.8), (px + 1.1, y, 0.1), 0.16, 0.16, WHITE, side=(1, 0, 0))
        m.beam((px, y, pz - 1.8), (px - 1.4, y, 0.05), 0.16, 0.16, WHITE, side=(1, 0, 0))
        m.box((px, y, 0.1), (0.6, 0.6, 0.2), bb.STONE)
    m.beam((px, -(HALF + 0.75), pz - 0.05), (px, HALF + 0.75, pz - 0.05), 0.34, 0.3, WHITE, side=(1, 0, 0))
    # the fixed deck on the quay, 2 m, and short railings along it
    m.box((-1.0, 0, -0.02), (2.0, 2 * HALF, 0.14), DECK, tile=1.6, shade=0.95)
    for sy in (1, -1):
        y = sy * (HALF - 0.1)
        m.box((-1.0, y, 0.12), (2.0, 0.14, 0.18), DARK, shade=0.85)
    return m


def swing_pier():
    return bl.bridge_pier()


BUILDERS = [
    ("swing_canal", lambda: bl.swing_bridge(span=18.5, tail=6.0, half=4.0, rail_y=2.0)),
    ("swing_vliet", lambda: bl.swing_bridge(span=15.0, tail=5.0, half=3.5, rail_y=-1.5)),
    ("swing_pier", swing_pier),
    ("draw_leaf_6", lambda: draw_leaf(6.0)),
    ("draw_beam_6", lambda: draw_beam(6.0)),
    ("draw_leaf_8", lambda: draw_leaf(8.0)),
    ("draw_beam_8", lambda: draw_beam(8.0)),
    ("draw_frame", draw_frame),
]


def export():
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def preview(objs):
    """A double drawbridge half raised over a 12 m canal, and the canal swing bridge half open."""
    bb.preview_materials()
    bb.preview_lines(objs)
    cam = bb.stage()
    for o in bpy.context.scene.objects:
        if o.name.startswith("water"):
            o.location.z = -1.8
    bb.quay(-100, -82, -80, 0, top=0.0)
    bb.quay(-70, -50, -80, 0, top=0.0)

    def at(o, x, z, yaw=0.0, lift=0.0):
        o.location = (x, -z, 0)
        o.rotation_euler = (0, -lift, yaw)  # XYZ: lift about the leaf's own axis, then yaw

    a = math.radians(55)
    for side, hx, yaw in ((0, -82.0, 0.0), (1, -70.0, math.pi)):
        leaf = objs["draw_leaf_6"] if side == 0 else bb.dup(objs["draw_leaf_6"], (0, 0, 0), 0)
        beam = objs["draw_beam_6"] if side == 0 else bb.dup(objs["draw_beam_6"], (0, 0, 0), 0)
        frame = objs["draw_frame"] if side == 0 else bb.dup(objs["draw_frame"], (0, 0, 0), 0)
        at(leaf, hx, 69.5, yaw, a)
        at(frame, hx, 69.5, yaw)
        c, s = math.cos(yaw), math.sin(yaw)
        bx, bz = hx + PIVOT[0] * c, 69.5
        beam.location = (bx, -bz, PIVOT[1])
        beam.rotation_euler = (0, -a, yaw)
    at(objs["swing_canal"], -86.5, 30.0, math.radians(-40))
    at(objs["swing_pier"], -86.5, 30.0)
    for n in ("swing_vliet", "draw_leaf_8", "draw_beam_8"):
        objs[n].hide_render = True
    bpy.context.view_layer.update()
    bb.aim(cam, (-55, -48, 13), (-76, -64, 2), lens=30)
    bb.render(SHOT, (1600, 1000))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bb.make_materials()
    objs = {}
    for name, fn in BUILDERS:
        objs[name] = to_object(fn(), name)
    export()
    for n, o in objs.items():
        print(f"[build_bridges] {n:12s} {bb.tris(o):5d} tris")
    print(f"[build_bridges] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()
