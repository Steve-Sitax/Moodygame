"""The lock of the Petit Bassin (Bonapartedok), 1873: a swing bridge and mitre gates, by script.

    blender -b --factory-startup -P tools/blender/build_lock.py
    blender -b --factory-startup -P tools/blender/build_lock.py -- --preview

Writes client/public/models/lock.glb (Draco). The lock of 1811 had wooden mitre gates
("puntdeuren") hinged at the quay walls, closing at an obtuse angle of about 150 degrees,
opened and shut with capstans and chains, and a swing bridge over the lock that was also
turned by hand with capstans (Inventaris Onroerend Erfgoed, Bonapartesluis). Our own models,
built from code; the materials and helpers are those of build_boats.py.

Objects (origin on the quay top, y = 0 in the game; +X in Blender is +x in the game):
  swing_bridge  the turning leaf: origin on the pivot, the span along +X (17.5 m to the tip),
                the counterweighted tail along -X (6 m), 7 m wide, deck top at +0.05
  bridge_pier   the fixed turntable ring and the capstan that turns the bridge
  gate_leaf     one leaf of a mitre gate: origin on the heel post axis, the leaf along +X
                (6.0 m), top at +0.35, the balance beam back along -X over the quay
  gate_capstan  the capstan that works a gate leaf by chain

--preview renders data/shots/lock_preview.png.
"""

import math
import os
import sys

import bpy
from mathutils import Vector

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boats as bb  # noqa: E402
from build_boats import (DARK, DECK, IRON, IRONHULL, LATTICE, TAR, WHITE, WOOD, Mesh, V, chimney, rig,  # noqa: E402
                         to_object)

OUT = os.path.join(bb.ROOT, "client", "public", "models", "lock.glb")
SHOT = os.path.join(bb.ROOT, "data", "shots", "lock_preview.png")

SPAN, TAIL, HALF = 17.5, 6.0, 3.5  # bridge: pivot to tip, tail, half width
GATE_LEN = 6.0


RAIL_GAUGE, RAIL_W, RAIL_H = 1.435, 0.075, 0.035  # as client/src/world/tracks.ts


def swing_bridge(span=None, tail=None, half=None, rail_y=None, rail_over=0.2, lamps=True):
    """A swing bridge leaf: origin on the pivot, the span along +X, the tail along -X.
    rail_y: carry a railway track along the deck, centred at this Blender y (the game's z is -y)."""
    SPAN = span or globals()["SPAN"]
    TAIL = tail or globals()["TAIL"]
    HALF = half or globals()["HALF"]
    m = Mesh(ao=0.0)
    m.shadefn = lambda p: 0.55 + 0.45 * bb.sm((p.z + 1.4) / 1.5)

    def depth(x):
        # fish-bellied plate girders: deepest over the pivot
        if x >= 0:
            return 1.35 - 0.95 * (x / SPAN) ** 0.8
        return 1.35 - 0.45 * (-x / TAIL)

    xs = [-TAIL, -TAIL * 0.5, 0.0, SPAN * 0.2, SPAN * 0.45, SPAN * 0.7, SPAN]
    for sy in (1, -1):
        y = sy * 3.2
        outline = [V(x, y - 0.12, -0.04) for x in xs] + [V(x, y - 0.12, -0.04 - depth(x)) for x in reversed(xs)]
        m.prism(outline, (0, 0.24, 0), IRONHULL, tile=4.0, side_mat=IRON)
    m.shadefn = None
    for x in [-5.0, -2.5, 0.0] + [SPAN * f for f in (0.15, 0.3, 0.45, 0.6, 0.75, 0.9)]:
        m.beam((x, -3.1, -0.25), (x, 3.1, -0.25), 0.2, 0.35, IRON, side=(1, 0, 0), shade=0.6)
    m.box(((SPAN - TAIL) / 2, 0, -0.02), (SPAN + TAIL, 2 * HALF, 0.14), DECK, tile=1.6, shade=0.95)
    # the counterweight box under the tail, the pivot drum under the middle
    m.box((-TAIL + 1.6, 0, -0.75), (3.0, 5.6, 1.2), IRON, shade=0.6)
    with m.at(bb.move(0, 0, -1.45)):
        m.lathe([(1.5, 0.0), (1.5, 1.3)], 10, IRON, smooth=False, cap0=True, urep=3)
    # kerbs, iron railings with lattice panels, a lamp at each corner of the pivot end
    for sy in (1, -1):
        y = sy * (HALF - 0.08)
        m.box(((SPAN - TAIL) / 2, y, 0.12), (SPAN + TAIL, 0.16, 0.2), DARK, shade=0.85)
        posts = [(-TAIL + 0.2) + i * 1.5 for i in range(int((SPAN + TAIL - 0.4) / 1.5) + 1)]
        for x in posts:
            m.box((x, y, 0.62), (0.08, 0.08, 1.1), IRON)
        m.beam((-TAIL + 0.1, y, 1.15), (SPAN - 0.1, y, 1.15), 0.07, 0.06, IRON)
        m.beam((-TAIL + 0.1, y, 0.3), (SPAN - 0.1, y, 0.3), 0.05, 0.05, IRON)
        acc = 0.0
        for a, b in zip(posts, posts[1:]):
            pts = [V(a, y, 0.3), V(b, y, 0.3), V(b, y, 1.12), V(a, y, 1.12)]
            m.poly(pts, LATTICE, uvs=[(acc, 0), (acc + (b - a) / 1.4, 0), (acc + (b - a) / 1.4, 1), (acc, 1)])
            acc += (b - a) / 1.4
        if not lamps:
            continue
        lx = 0.6
        with m.at(bb.move(lx, y, 0.1)):
            m.lathe([(0.12, 0.0), (0.09, 0.3), (0.05, 0.4), (0.045, 2.9), (0.08, 2.95)], 6, IRON, smooth=False, urep=2)
            m.box((0, 0, 3.2), (0.32, 0.32, 0.45), bb.GLASS)
            m.lathe([(0.24, 3.42), (0.02, 3.62)], 4, IRON, smooth=False, rot=math.pi / 4)
    # the nose of the span that rests on the far quay
    m.box((SPAN - 0.2, 0, -0.3), (0.4, 2 * HALF - 0.3, 0.5), DARK)
    if rail_y is not None:
        # the quay railway carried across: two rails on longitudinal sleepers, laid on the deck
        for sy in (1, -1):
            y = rail_y + sy * (RAIL_GAUGE / 2 + RAIL_W / 2)
            m.box(((SPAN + rail_over - TAIL) / 2, y, 0.03), (SPAN + rail_over + TAIL, 0.2, 0.06), DARK, shade=0.7)
            m.box(((SPAN + rail_over - TAIL) / 2, y, 0.06 + RAIL_H / 2), (SPAN + rail_over + TAIL, RAIL_W, RAIL_H), IRON)
            # the running surface, worn bright by the wheels, as on the quay rails
            m.box(((SPAN + rail_over - TAIL) / 2, y, 0.06 + RAIL_H + 0.004), (SPAN + rail_over + TAIL, RAIL_W * 0.6, 0.008), WHITE)
    return m


def bridge_pier():
    m = Mesh(ao=0.0)
    with m.at(bb.move(0, 0, 0)):
        m.lathe([(2.3, -0.02), (2.3, 0.02)], 16, IRON, smooth=False, cap1=True, urep=4)
    # the capstan beside the bridge: a cast-iron barrel on a base, four bars
    cx, cy = -2.2, HALF + 1.6
    with m.at(bb.move(cx, cy, 0)):
        m.lathe([(0.45, 0.0), (0.45, 0.12), (0.28, 0.2), (0.24, 0.75), (0.34, 0.82), (0.34, 0.98), (0.18, 1.05)], 10, IRON,
                smooth=False, cap1=True, urep=2)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            d = V(math.cos(a), math.sin(a), 0)
            m.beam(d * 0.3 + V(0, 0, 0.9), d * 1.7 + V(0, 0, 0.92), 0.07, 0.07, WOOD, side=(0, 0, 1))
    # the rack the capstan pinion works in (a curved iron strip round the pivot)
    pts = [V(2.0 * math.cos(a), 2.0 * math.sin(a), 0.03) for a in [math.radians(d) for d in range(60, 181, 20)]]
    m.tube(pts, [0.06] * len(pts), 4, IRON, side=(0, 0, 1), smooth=False)
    return m


def gate_leaf():
    m = Mesh(ao=0.0)
    L, T = GATE_LEN, 0.45
    m.shadefn = lambda p: 0.5 + 0.5 * bb.sm((p.z + 2.5) / 2.9)
    m.box((L / 2, 0, -2.85), (L, T, 6.4), TAR, tile=2.0)
    m.shadefn = None
    for x in (0.0, L):
        m.box((x, 0, -2.6 if x else -2.45), (0.5, 0.55, 6.9 if not x else 6.3), DARK)
    for z in (-1.5, -0.7, 0.1):
        for sy in (1, -1):
            m.beam((0.2, sy * (T / 2 + 0.06), z), (L - 0.2, sy * (T / 2 + 0.06), z), 0.12, 0.2, DARK, side=(0, 1, 0))
    for sy in (1, -1):
        m.beam((0.3, sy * (T / 2 + 0.03), -1.7), (L - 0.3, sy * (T / 2 + 0.03), 0.3), 0.1, 0.03, IRON, side=(0, 1, 0))
    # walkway on top and a hand rail on the downstream side
    m.box((L / 2, 0, 0.38), (L + 0.2, 0.7, 0.06), DECK, tile=1.2)
    for x in (0.3, L / 2, L - 0.3):
        m.box((x, -0.3, 0.9), (0.06, 0.06, 1.0), IRON)
    rig(m, (0.3, -0.3, 1.38), (L - 0.3, -0.3, 1.38), 0.04, IRON)
    # balance beam back over the quay, on the heel post
    m.box((0, 0, 0.75), (0.5, 0.5, 0.8), DARK)
    m.beam((0.3, 0, 1.0), (-5.6, 0, 0.9), 0.4, 0.35, DARK, w2=0.3, h2=0.28, side=(0, 1, 0))
    m.box((-5.3, 0, 0.9), (0.45, 0.45, 0.45), IRON)  # iron shoe at the end
    # the chain from the leaf to its capstan
    rig(m, (L * 0.55, 0.3, 0.2), (L * 0.2, 1.4, 0.05))
    return m


def gate_capstan():
    m = Mesh(ao=0.0)
    m.lathe([(0.35, 0.0), (0.35, 0.1), (0.2, 0.18), (0.18, 0.6), (0.28, 0.66), (0.28, 0.8), (0.14, 0.86)], 8, IRON,
            smooth=False, cap1=True, urep=2)
    for k in range(2):
        a = k * math.pi / 2
        d = V(math.cos(a), math.sin(a), 0)
        m.beam(-d * 1.2 + V(0, 0, 0.74), d * 1.2 + V(0, 0, 0.74), 0.06, 0.06, WOOD, side=(0, 0, 1))
    return m


# the bridge over the lock is now a lifting bridge (build_bridges.py: draw_leaf_lock, draw_frame_lock);
# swing_bridge() and bridge_pier() stay for reference
BUILDERS = [("gate_leaf", gate_leaf),
            ("gate_capstan", gate_capstan)]


def export():
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_apply=False, use_selection=False, export_extras=True,
                              export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=12,
                              export_draco_color_quantization=8, export_draco_normal_quantization=8)


def preview(objs):
    """The lock as it stands in the game (channel x 104..116, bridge over z 14..21), bridge half open."""
    bb.preview_materials()
    bb.preview_lines(objs)
    cam = bb.stage()
    # quays either side of the channel, the water 1.8 m down (game x -> Blender x, game z -> Blender -y)
    bb.quay(80, 104.0, -60, 0, top=0.0)
    bb.quay(116.0, 140, -60, 0, top=0.0)
    for o in bpy.context.scene.objects:
        if o.name.startswith("water"):
            o.location.z = -1.8
    def at(o, x, z, yaw, y=0.0):
        o.location = (x, -z, y)
        o.rotation_euler = (0, 0, yaw)
    for zg, n in ((7.0, 0), (42.0, 1)):
        for side, (hx, closed) in enumerate(((104.3, -15.0), (115.7, 195.0))):
            o = objs["gate_leaf"] if (n, side) == (0, 0) else bb.dup(objs["gate_leaf"], (0, 0, 0), 0)
            ang = closed if n == 0 else (-90.0 if side == 0 else 270.0)
            # a game yaw theta and a Blender z rotation of the same angle turn +x the same way
            at(o, hx, zg, math.radians(ang), 0)
            o.scale = (5.75 / math.cos(math.radians(15)) / GATE_LEN, 1, 1)
    at(objs["gate_capstan"], 101.5, 3.5, 0)
    bpy.context.view_layer.update()
    bb.aim(cam, (82, 12, 16), (110, -24, -1), lens=30)
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
        print(f"[build_lock] {n:14s} {bb.tris(o):5d} tris")
    print(f"[build_lock] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if "--preview" in argv:
        preview(objs)


if __name__ == "__main__":
    main()
