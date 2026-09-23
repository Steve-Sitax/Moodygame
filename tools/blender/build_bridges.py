"""Opening bridges over the Canal des Brasseurs and the Sint-Pietersvliet, 1873, by script.

    blender -b --factory-startup -P tools/blender/build_bridges.py
    blender -b --factory-startup -P tools/blender/build_bridges.py -- --preview

Writes client/public/models/bridges.glb (Draco). Period: the Brouwersvliet (our Canal des
Brasseurs) had an iron swing bridge ("draaibrug") from 1864-65; the inner canals had wooden
lifting bridges ("ophaalbruggen") with a balance: two long beams ("sprieten") coupled like a
scale, resting on a gallows frame (the "hamei") (sources in assets/ATTRIBUTION.md). Our own
models, built from code with the helpers and materials of build_boats.py / build_lock.py.

All five bridges and the lock bridge are lifting bridges: leaves hinged at the channel edge that
rise in place, so nothing sweeps over the quay but the balance beams, high up. The three the
quay railway crosses (lock_bridge, canal_mouth, vliet_mouth) carry its rails on the leaves and
on the fixed decks, flush with the quay (deck top +0.05).

Objects (origin on the quay top, y = 0 in the game; Blender +X = game +x, Blender +Y = game -z):
  draw_leaf_6 / _8   a leaf 6 or 8 m long, 7 m wide: origin on the hinge, the leaf along +X; it
                     lifts by turning about Blender Y (the game's z axis)
  draw_beam_6 / _8   its balance: two beams on the gallows top, origin on their pivot, front +X
  draw_frame         the gallows (hamei) and the fixed deck on the quay (x -2..0): origin on the
                     hinge; the beams' pivot is at (-1.2, 0, 5.9) in this frame
  with rails:        draw_leaf_lock / draw_frame_lock (rails on the centre line), draw_leaf_cm_w,
                     draw_leaf_cm_e, draw_frame_cm_w, draw_frame_cm_e, draw_beam_6w (8 m wide, for
                     canal_mouth, rails 2 m off centre), draw_leaf_vm, draw_frame_vm, deck_vm_w
                     (vliet_mouth: one 8 m leaf, rails 1.5 m off centre, a bare deck on the far side)

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


def rails(m, x0, x1, rail_y):
    """The quay railway on a deck: two rails on longitudinal sleepers, worn bright on top
    (gauge and rail size as client/src/world/tracks.ts; deck top at +0.05)."""
    for sy in (1, -1):
        y = rail_y + sy * (bl.RAIL_GAUGE / 2 + bl.RAIL_W / 2)
        c, ln = (x0 + x1) / 2, x1 - x0
        m.box((c, y, 0.03), (ln, 0.2, 0.06), DARK, shade=0.7)
        m.box((c, y, 0.06 + bl.RAIL_H / 2), (ln, bl.RAIL_W, bl.RAIL_H), IRON)
        m.box((c, y, 0.06 + bl.RAIL_H + 0.004), (ln, bl.RAIL_W * 0.6, 0.008), WHITE)


def draw_leaf(L, half=None, rail_y=None):
    """A timber lifting leaf: deck planks on two stringers and cross beams, white railings.
    rail_y: carry the quay railway, centred at this Blender y (game z = hinge z - y at yaw 0)."""
    HALF = half or globals()["HALF"]
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
    if rail_y is not None:
        rails(m, 0.0, L, rail_y)
    return m


def draw_beam(L, half=None):
    """The balance: two long beams coupled by cross ties, a ballast box at the land end."""
    HALF = half or globals()["HALF"]
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


def draw_frame(half=None, rail_y=None, gallows=True):
    """The gallows (two posts and the hamei crossbeam) and the fixed deck on the quay (2 m, from
    x -2 to the hinge). gallows=False: only the fixed deck, for the far side of a single leaf."""
    HALF = half or globals()["HALF"]
    m = Mesh(ao=0.0)
    px, pz = PIVOT
    for sy in ((1, -1) if gallows else ()):
        y = sy * (HALF + 0.45)
        m.beam((px, y, 0.0), (px, y, pz - 0.2), 0.32, 0.32, WHITE, side=(1, 0, 0))
        # braces from the posts down to the deck and back to the ground
        m.beam((px, y, pz - 1.8), (px + 1.1, y, 0.1), 0.16, 0.16, WHITE, side=(1, 0, 0))
        m.beam((px, y, pz - 1.8), (px - 1.4, y, 0.05), 0.16, 0.16, WHITE, side=(1, 0, 0))
        m.box((px, y, 0.1), (0.6, 0.6, 0.2), bb.STONE)
    if gallows:
        m.beam((px, -(HALF + 0.75), pz - 0.05), (px, HALF + 0.75, pz - 0.05), 0.34, 0.3, WHITE, side=(1, 0, 0))
    # the fixed deck on the quay, 2 m, and short railings along it
    m.box((-1.0, 0, -0.02), (2.0, 2 * HALF, 0.14), DECK, tile=1.6, shade=0.95)
    for sy in (1, -1):
        y = sy * (HALF - 0.1)
        m.box((-1.0, y, 0.12), (2.0, 0.14, 0.18), DARK, shade=0.85)
    if rail_y is not None:
        rails(m, -2.1, 0.0, rail_y)  # a hand past the rect onto the quay rails, so no gap shows
    return m


BUILDERS = [
    ("draw_leaf_6", lambda: draw_leaf(6.0)),
    ("draw_beam_6", lambda: draw_beam(6.0)),
    ("draw_leaf_8", lambda: draw_leaf(8.0)),
    ("draw_beam_8", lambda: draw_beam(8.0)),
    ("draw_frame", draw_frame),
    # the three bridges the quay railway crosses (rails centred on the track: see bridges.ts)
    ("draw_leaf_lock", lambda: draw_leaf(6.0, 3.5, 0.0)),
    ("draw_frame_lock", lambda: draw_frame(3.5, 0.0)),
    ("draw_leaf_cm_w", lambda: draw_leaf(6.0, 4.0, 2.0)),
    ("draw_leaf_cm_e", lambda: draw_leaf(6.0, 4.0, -2.0)),
    ("draw_beam_6w", lambda: draw_beam(6.0, 4.0)),
    ("draw_frame_cm_w", lambda: draw_frame(4.0, 2.0)),
    ("draw_frame_cm_e", lambda: draw_frame(4.0, -2.0)),
    ("draw_leaf_vm", lambda: draw_leaf(8.0, 3.5, -1.5)),
    ("draw_frame_vm", lambda: draw_frame(3.5, -1.5)),
    ("deck_vm_w", lambda: draw_frame(3.5, 1.5, gallows=False)),
]


def export():
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def preview(objs):
    """The lock bridge (with the railway) half lifted over its 12 m channel, and the vliet one."""
    bb.preview_materials()
    bb.preview_lines(objs)
    cam = bb.stage()
    for o in bpy.context.scene.objects:
        if o.name.startswith("water"):
            o.location.z = -1.8
    bb.quay(80, 104, -60, 0, top=0.0)
    bb.quay(116, 140, -60, 0, top=0.0)

    def at(o, x, z, yaw=0.0, lift=0.0, y=0.0):
        o.location = (x, -z, y)
        o.rotation_euler = (0, -lift, yaw)  # XYZ: lift about the leaf's own axis, then yaw

    a = math.radians(40)
    for side, hx, yaw in ((0, 104.0, 0.0), (1, 116.0, math.pi)):
        pick = lambda n: objs[n] if side == 0 else bb.dup(objs[n], (0, 0, 0), 0)  # noqa: E731
        leaf, beam, frame = pick("draw_leaf_lock"), pick("draw_beam_6"), pick("draw_frame_lock")
        at(leaf, hx, 17.5, yaw, a)
        at(frame, hx, 17.5, yaw)
        at(beam, hx + PIVOT[0] * math.cos(yaw), 17.5, yaw, a, PIVOT[1])
    for n, o in objs.items():
        if n not in ("draw_leaf_lock", "draw_beam_6", "draw_frame_lock") and not n.endswith("_rigprev"):
            o.hide_render = True
    bpy.context.view_layer.update()
    bb.aim(cam, (88, 2, 9), (110, -17.5, 1.5), lens=28)
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
