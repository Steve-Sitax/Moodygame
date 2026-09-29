"""The Oostershuis (the Hanseatic House, 1564-68) with real windows and doors (issue #28, interiors are real).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_oostershuis.py

Writes client/public/models/oostershuis.glb (loaded by client/src/world/oostershuisShell.ts, which hides the older
Hanseatic House of landmarks.glb, build_landmarks.py hanzehuis) and shared/oostershuisShell.ts.

The older model painted every window and warehouse door in its atlas (hz_bay, hz_arch): three storeys of cross windows
with no room behind them, and fanlights painted over the warehouse doors of the hall inside. Here the building is the
same (four wings round a court, 64 by 38 m, the wings 10 deep, the eaves at 16.5, the classical gate under the clock,
the square tower over it, hipped slate roofs, chimneys), and every window is cut through:
  - the ground floor: an arched warehouse door in every bay of the four outer fronts, its oak leaves shut in the reveal
    (a door that never opens) and its fanlight over a stone transom, glazed: a window onto the warehouse behind;
  - the three storeys over it: a stone cross window with open oak shutters in every bay of the outer fronts and of the
    two long wings' court faces (the gate's two bays over the frontispiece only), onto the lofts behind;
  - the tower over the gate: two windows a face on each of its two stages, and the lantern's four openings.
Each is written twice: an empty "opening_<id>" in the glb and a row of shared/oostershuisShell.ts (world frame); the
panes go to a mesh of their own ("oostershuis_lit_glass", material landmark_glass_lit) that the game never draws:
world/landmarkWindows.ts lights a copy of it at night. The rooms behind are the game's (world/landmarkHalls.ts
buildOostershuis: the hall on the dock, the lofts and the warehouses of the other wings, the tower's rooms).
The roof dormers are hoist hatches (shut oak doors), not windows; the gate's tympanum carries the city's arms.

Materials are the landmarks' own (the game gives them their pictures: stone, slate, lead, brickband, gilt and the
landmarks' atlas for the clock, the arms and the tower's balustrade), plus oh_oak (shutters, leaves, hatches).
"""

import json
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402
from mathutils import geometry as mg  # noqa: E402

import build_landmarks as BL  # noqa: E402

ROOT = BL.ROOT
OUT = os.path.join(ROOT, "client", "public", "models", "oostershuis.glb")
SHELL_TS = os.path.join(ROOT, "shared", "oostershuisShell.ts")

STONE, SLATE, GLASS, BRICK, LEAD, ATLAS, GILT, OAK, LIT = range(9)
MAT_NAMES = BL.CATH_MATS + ["oh_oak", "landmark_glass_lit"]

# ---- the plan (the older model's outline and heights, kept: the hall inside and the walk map fit them)
U0, U1, V0, V1 = -32.0, 32.0, -19.0, 19.0
H = 16.5  # the eaves
D = 10.0  # the wings' depth
RISE = 5.2
DEP = 0.3  # every reveal's depth: the rooms' linings start there
GATE = 0.0
# the storeys (world y): the ground floor's boards (the hall's), then the three lofts' floors
FLOORS = [0.3, 4.5, 8.4, 12.1]
WIN = [(5.6, 7.9), (9.3, 11.6), (13.0, 15.3)]  # the cross windows of the storeys over the ground floor
WHW = 0.7  # half a cross window
DOOR_HW, DOOR_TOP, SPRING = 1.15, 2.8, 2.9  # the warehouse doors: half width, the leaves' top, the fanlight's springing
BAYS_LONG = [-30.0 + 4.0 * k for k in range(16)]
BAYS_SIDE = [-16.5, -11.5, -6.75, -2.25, 2.25, 6.75, 11.5, 16.5]  # the ends of the long wings and the side wing's bays
BAYS_COURT = [-20.0 + 4.0 * k for k in range(11)]
TU, TV, TH = GATE, V0 + 4.5, 3.7  # the tower over the gate
TOWER_WIN = [(22.0, 25.2, 0.6, False), (26.6, 29.8, 0.55, True)]  # its two stages' windows: bottom, top, half width, round head
LANTERN = (37.5, 39.3, 1.0)  # the lantern: bottom, top, half its side
LANTERN_WIN = (37.85, 38.95, 0.28)

OPENINGS = []


def wpt(p, d, o, s, e, y):
    return (p[0] + d[0] * s + o[0] * e, p[1] + d[1] * s + o[1] * e, y)


def quad(m, pts, mat, shade, out):
    f = m.poly(pts, mat, shade)
    m.orient(f, out)
    return f


def bar(m, p, d, o, s0, s1, e0, e1, y0, y1, mat, shade=1.0, caps=False):
    """A box against a wall: its four long sides (s along it, e out, y up); `caps`: its two ends too. The long way is
    the longest of its three sizes; ends left open never lie on the reveal they meet (no two faces in one plane)."""
    P = lambda s, e, y: wpt(p, d, o, s, e, y)  # noqa: E731
    ls, le, ly = s1 - s0, e1 - e0, y1 - y0
    oo = (o[0], o[1], 0)
    dd = (d[0], d[1], 0)
    if ly >= ls and ly >= le:  # upright: front, back, the two sides along s
        quad(m, [P(s0, e1, y0), P(s1, e1, y0), P(s1, e1, y1), P(s0, e1, y1)], mat, shade, oo)
        quad(m, [P(s0, e0, y0), P(s1, e0, y0), P(s1, e0, y1), P(s0, e0, y1)], mat, shade * 0.8, (-o[0], -o[1], 0))
        quad(m, [P(s0, e0, y0), P(s0, e1, y0), P(s0, e1, y1), P(s0, e0, y1)], mat, shade * 0.85, (-d[0], -d[1], 0))
        quad(m, [P(s1, e0, y0), P(s1, e1, y0), P(s1, e1, y1), P(s1, e0, y1)], mat, shade * 0.85, dd)
        if caps:
            quad(m, [P(s0, e0, y1), P(s1, e0, y1), P(s1, e1, y1), P(s0, e1, y1)], mat, shade * 1.05, (0, 0, 1))
            quad(m, [P(s0, e0, y0), P(s1, e0, y0), P(s1, e1, y0), P(s0, e1, y0)], mat, shade * 0.6, (0, 0, -1))
    else:  # along s: front, back, top, bottom
        quad(m, [P(s0, e1, y0), P(s1, e1, y0), P(s1, e1, y1), P(s0, e1, y1)], mat, shade, oo)
        quad(m, [P(s0, e0, y0), P(s1, e0, y0), P(s1, e0, y1), P(s0, e0, y1)], mat, shade * 0.8, (-o[0], -o[1], 0))
        quad(m, [P(s0, e0, y1), P(s1, e0, y1), P(s1, e1, y1), P(s0, e1, y1)], mat, shade * 1.05, (0, 0, 1))
        quad(m, [P(s0, e0, y0), P(s1, e0, y0), P(s1, e1, y0), P(s0, e1, y0)], mat, shade * 0.6, (0, 0, -1))
        if caps:
            quad(m, [P(s0, e0, y0), P(s0, e1, y0), P(s0, e1, y1), P(s0, e0, y1)], mat, shade * 0.85, (-d[0], -d[1], 0))
            quad(m, [P(s1, e0, y0), P(s1, e1, y0), P(s1, e1, y1), P(s1, e0, y1)], mat, shade * 0.85, dd)


def cut_face(m, p, d, o, s0, s1, y0, y1, notches=(), holes=(), mat=STONE, shade=0.95):
    """A wall face (s0..s1, y0..y1) with openings cut through: `notches` stand on its foot (outlines (s, y) from the
    left foot up, over the head and down to the right foot), `holes` are closed outlines inside it."""
    loop = [(s0, y0)]
    for n in sorted(notches, key=lambda q: q[0][0]):
        loop += n
    loop += [(s1, y0), (s1, y1), (s0, y1)]
    rings = [loop] + [list(h) for h in holes]
    flat = [q for r in rings for q in r]
    tris = mg.tessellate_polygon([[Vector((q[0], q[1], 0.0)) for q in r] for r in rings])
    area = lambda r: abs(sum(r[i][0] * r[(i + 1) % len(r)][1] - r[(i + 1) % len(r)][0] * r[i][1] for i in range(len(r)))) / 2  # noqa: E731
    want = area(loop) - sum(area(h) for h in holes)
    got = sum(area([flat[i] for i in t]) for t in tris)
    if abs(got - want) > 0.01 * max(1.0, want):
        print(f"[build_oostershuis] cut face at {wpt(p, d, o, (s0 + s1) / 2, 0, (y0 + y1) / 2)}: triangles {got:.2f} m2, want {want:.2f} m2")
    for t in tris:
        quad(m, [wpt(p, d, o, flat[i][0], 0.0, flat[i][1]) for i in t], mat, shade, (o[0], o[1], 0))


def reveal(m, p, d, o, ring, depth, closed=True, shade=0.62):
    """The sides of an opening from the face to `depth` in, each facing into the opening (a notch: no bottom)."""
    n = len(ring)
    cs = sum(q[0] for q in ring) / n
    cy = sum(q[1] for q in ring) / n
    for i in range(n if closed else n - 1):
        a, b = ring[i], ring[(i + 1) % n]
        if abs(a[0] - b[0]) + abs(a[1] - b[1]) < 1e-5:
            continue
        ms, my = (a[0] + b[0]) / 2, (a[1] + b[1]) / 2
        ns, ny = -(b[1] - a[1]), b[0] - a[0]
        if ns * (cs - ms) + ny * (cy - my) < 0:
            ns, ny = -ns, -ny
        quad(m, [wpt(p, d, o, a[0], 0.0, a[1]), wpt(p, d, o, b[0], 0.0, b[1]), wpt(p, d, o, b[0], -depth, b[1]), wpt(p, d, o, a[0], -depth, a[1])],
             STONE, shade, (d[0] * ns, d[1] * ns, ny))


def record(m, p, d, o, sc, ring, kind, label, glaze, arch=False):
    """A real opening for the markers and shared/oostershuisShell.ts (world frame): its middle on the face, the way along
    and out, its outline (u from its middle, world y), the reveal's depth."""
    x, _, z = m.f.w(*wpt(p, d, o, sc, 0.0, 0.0))
    tx, tz = BL._world_dir(m.f, d[0], d[1])
    nx, nz = BL._world_dir(m.f, o[0], o[1])
    poly = [(s - sc, y) for s, y in ring]
    OPENINGS.append(dict(kind=kind, part="oostershuis_body", label=label, glaze=glaze, shape="rect", x=x, z=z, tx=tx, tz=tz, nx=nx, nz=nz,
                         hw=max(abs(q[0]) for q in poly), yb=min(q[1] for q in poly), yt=max(q[1] for q in poly), arch=arch, depth=DEP, poly=poly))


def lit_pane(lit, p, d, o, ring):
    """The pane of a real window at the reveal's back, in the never-drawn mesh the night's glow copies."""
    quad(lit, [wpt(p, d, o, s, -DEP, y) for s, y in ring], LIT, 1.0, (o[0], o[1], 0))


def arc(sc, spring, r, a0, a1, n):
    return [(sc + r * math.cos(a0 + (a1 - a0) * k / n), spring + r * math.sin(a0 + (a1 - a0) * k / n)) for k in range(n + 1)]


# ---------------------------------------------------------------- a cross window with its shutters

def cross_window(m, lit, p, d, o, sc, yb, yt, hw, label, shutters=True, round_head=False):
    """A stone cross window cut through the face: its frame, lintel and sill on the face, the stone cross set back in
    the reveal, open oak shutters flat on the wall either side. Returns the hole's outline."""
    if round_head:
        ring = [(sc - hw, yb), (sc + hw, yb)] + arc(sc, yt - hw, hw, 0.0, math.pi, 8)
    else:
        ring = [(sc - hw, yb), (sc + hw, yb), (sc + hw, yt), (sc - hw, yt)]
    reveal(m, p, d, o, ring, DEP)
    fw = 0.14
    # the frame: jambs on the face, a lintel over, a sill under
    bar(m, p, d, o, sc - hw - fw, sc - hw, 0.0, 0.05, yb, yt, STONE, 1.08)
    bar(m, p, d, o, sc + hw, sc + hw + fw, 0.0, 0.05, yb, yt, STONE, 1.08)
    bar(m, p, d, o, sc - hw - 0.25, sc + hw + 0.25, 0.0, 0.1, yt, yt + 0.2, STONE, 1.1, caps=True)
    bar(m, p, d, o, sc - hw - 0.2, sc + hw + 0.2, 0.0, 0.14, yb - 0.12, yb, STONE, 1.05, caps=True)
    # the stone cross in the reveal (its ends open: they meet the reveal)
    ty = yt - 0.4 * (yt - yb) if not round_head else yt - hw - 0.3
    bar(m, p, d, o, sc - 0.06, sc + 0.06, -0.17, -0.05, yb + 0.002, (yt if not round_head else yt - hw * 0.35) - 0.002, STONE, 1.0)
    bar(m, p, d, o, sc - hw + 0.002, sc + hw - 0.002, -0.17, -0.05, ty - 0.06, ty + 0.06, STONE, 1.0)
    if shutters:
        for sg in (-1, 1):
            a = sc + sg * (hw + fw)
            b = sc + sg * (hw + fw + 0.62)
            s0, s1 = min(a, b), max(a, b)
            bar(m, p, d, o, s0, s1, 0.02, 0.06, yb, yt, OAK, 0.95, caps=True)
            # (its planks' joints: two grooves drawn as thin dark strips on its face)
            for f_ in (1 / 3, 2 / 3):
                sm = s0 + (s1 - s0) * f_
                quad(m, [wpt(p, d, o, sm - 0.012, 0.062, yb + 0.05), wpt(p, d, o, sm + 0.012, 0.062, yb + 0.05), wpt(p, d, o, sm + 0.012, 0.062, yt - 0.05), wpt(p, d, o, sm - 0.012, 0.062, yt - 0.05)], OAK, 0.45, (o[0], o[1], 0))
    lit_pane(lit, p, d, o, ring)
    record(m, p, d, o, sc, ring, "window", label, "lead", arch=round_head)
    return ring


# ---------------------------------------------------------------- an arched warehouse door with its fanlight

def warehouse_door(m, lit, p, d, o, sc, label):
    """An arched door standing on the foot of the face: shut oak leaves in the reveal up to a stone transom, the
    fanlight over it glazed (the room's glass) behind radial iron bars; a stone arch round it on the face, a step.
    Returns the notch's outline (for cut_face)."""
    hw = DOOR_HW
    notch = [(sc - hw, 0.0), (sc - hw, SPRING)] + arc(sc, SPRING, hw, math.pi, 0.0, 10)[1:-1] + [(sc + hw, SPRING), (sc + hw, 0.0)]
    reveal(m, p, d, o, notch, DEP, closed=False)
    # the step in the reveal, the leaves on it up to the transom (two leaves, a hair apart), the transom
    bar(m, p, d, o, sc - hw + 0.002, sc + hw - 0.002, -DEP + 0.002, 0.08, 0.0, FLOORS[0], STONE, 0.8, caps=False)
    for s0, s1 in ((sc - hw + 0.002, sc - 0.006), (sc + 0.006, sc + hw - 0.002)):
        bar(m, p, d, o, s0, s1, -DEP + 0.002, -DEP + 0.06, FLOORS[0] + 0.002, DOOR_TOP, OAK, 0.9, caps=False)
        # battens and iron straps on the street side
        for y in (0.9, 1.9):
            bar(m, p, d, o, s0 + 0.05, s1 - 0.05, -DEP + 0.06, -DEP + 0.085, y - 0.05, y + 0.05, LEAD, 0.7, caps=True)
    bar(m, p, d, o, sc - hw + 0.002, sc + hw - 0.002, -DEP + 0.002, -0.02, DOOR_TOP, SPRING, STONE, 1.0)
    # the fanlight's iron: a bar up the middle and four spokes from it
    for k in range(1, 6):
        a = math.pi * k / 6
        cx, cy = sc, SPRING
        ex, ey = sc + math.cos(a) * (hw - 0.01), SPRING + math.sin(a) * (hw - 0.01)
        nxs, nys = -math.sin(a) * 0.017, math.cos(a) * 0.017
        quad(m, [wpt(p, d, o, cx - nxs, -0.2, cy - nys), wpt(p, d, o, ex - nxs, -0.2, ey - nys), wpt(p, d, o, ex + nxs, -0.2, ey + nys), wpt(p, d, o, cx + nxs, -0.2, cy + nys)],
             LEAD, 0.6, (o[0], o[1], 0))
    # the arch round it on the face: voussoirs (a band 0.24 wide, 6 cm proud), imposts, a keystone
    ring_in = arc(sc, SPRING, hw, math.pi, 0.0, 10)
    ring_out = arc(sc, SPRING, hw + 0.24, math.pi, 0.0, 10)
    for i in range(len(ring_in) - 1):
        a, b, c, e_ = ring_in[i], ring_in[i + 1], ring_out[i + 1], ring_out[i]
        quad(m, [wpt(p, d, o, a[0], 0.06, a[1]), wpt(p, d, o, b[0], 0.06, b[1]), wpt(p, d, o, c[0], 0.06, c[1]), wpt(p, d, o, e_[0], 0.06, e_[1])], STONE, 1.08, (o[0], o[1], 0))
        mx, my = (c[0] + e_[0]) / 2 - sc, (c[1] + e_[1]) / 2 - SPRING
        quad(m, [wpt(p, d, o, e_[0], 0.0, e_[1]), wpt(p, d, o, c[0], 0.0, c[1]), wpt(p, d, o, c[0], 0.06, c[1]), wpt(p, d, o, e_[0], 0.06, e_[1])], STONE, 0.95, (d[0] * mx, d[1] * mx, my))
        quad(m, [wpt(p, d, o, a[0], 0.0, a[1]), wpt(p, d, o, b[0], 0.0, b[1]), wpt(p, d, o, b[0], 0.06, b[1]), wpt(p, d, o, a[0], 0.06, a[1])], STONE, 0.7, (-d[0] * mx, -d[1] * mx, -my))
    for sg in (-1, 1):
        s0, s1 = (sc + hw, sc + hw + 0.3) if sg > 0 else (sc - hw - 0.3, sc - hw)
        bar(m, p, d, o, s0, s1, 0.0, 0.08, SPRING - 0.16, SPRING, STONE, 1.1, caps=True)
    bar(m, p, d, o, sc - 0.14, sc + 0.14, 0.0, 0.1, SPRING + hw - 0.05, SPRING + hw + 0.3, STONE, 1.12, caps=True)
    # the openings: the door (shut for good) and the fanlight (a window)
    door_ring = [(sc - hw, FLOORS[0]), (sc + hw, FLOORS[0]), (sc + hw, DOOR_TOP), (sc - hw, DOOR_TOP)]
    record(m, p, d, o, sc, door_ring, "door", f"{label}, its warehouse door (shut)", "")
    # (from the left foot along the transom, then over the head back to the left)
    fan = [(sc - hw, SPRING), (sc + hw, SPRING)] + arc(sc, SPRING, hw, 0.0, math.pi, 10)[1:-1]
    lit_pane(lit, p, d, o, fan)
    record(m, p, d, o, sc, fan, "window", f"{label}, the fanlight over its warehouse door", "bars", arch=False)
    return notch


# ---------------------------------------------------------------- the building

def hatch_dormer(m, p, d, o, s, e_eave, y_eave, e_ridge, y_ridge, yb, w=1.2, hf=1.5):
    """A hoist dormer on a roof slope (BL._roof_dormer's shape): its front a shut oak hatch in a frame, no window."""
    def e_at(y):
        return e_eave + (y - y_eave) / (y_ridge - y_eave) * (e_ridge - e_eave)
    ef, e1, e2 = e_at(yb), e_at(yb + 0.62 * hf), e_at(yb + hf)
    P = lambda ss, ee, yy: wpt(p, d, o, ss, ee, yy)  # noqa: E731
    quad(m, [P(s - w / 2, ef, yb), P(s + w / 2, ef, yb), P(s + w / 2, ef, yb + 0.62 * hf), P(s, ef, yb + hf), P(s - w / 2, ef, yb + 0.62 * hf)], OAK, 0.85, (o[0], o[1], 0))
    # the hatch's two leaves and its hoist beam
    bar(m, p, d, o, s - w / 2 + 0.12, s - 0.01, ef, ef + 0.04, yb + 0.1, yb + 0.62 * hf - 0.06, OAK, 0.7, caps=True)
    bar(m, p, d, o, s + 0.01, s + w / 2 - 0.12, ef, ef + 0.04, yb + 0.1, yb + 0.62 * hf - 0.06, OAK, 0.7, caps=True)
    bar(m, p, d, o, s - 0.08, s + 0.08, ef - 0.2, ef + 0.6, yb + 0.62 * hf + 0.05, yb + 0.62 * hf + 0.2, OAK, 0.8, caps=True)
    for sg in (-1, 1):
        f = m.poly([P(s + sg * w / 2, ef, yb), P(s + sg * w / 2, ef, yb + 0.62 * hf), P(s + sg * w / 2, e1, yb + 0.62 * hf)], SLATE)
        m.orient(f, (d[0] * sg, d[1] * sg, 0))
        f = m.poly([P(s + sg * w / 2, ef, yb + 0.62 * hf), P(s, ef, yb + hf), P(s, e2, yb + hf), P(s + sg * w / 2, e1, yb + 0.62 * hf)], SLATE)
        m.orient(f, (d[0] * sg + o[0] * 0.3, d[1] * sg + o[1] * 0.3, 1))


def oostershuis(fr):
    m = BL.CMesh(fr)
    m.mats = MAT_NAMES
    lit = BL.CMesh(fr)
    lit.mats = MAT_NAMES
    # ---- the fronts: (name, p, d, o, s0, s1, bays, ground doors, which storeys; which wing is behind each bay)
    fronts = [
        ("the dock front", (0.0, V0), (1.0, 0.0), (0.0, -1.0), U0, U1, BAYS_LONG, True),
        ("the north front", (0.0, V1), (1.0, 0.0), (0.0, 1.0), U0, U1, BAYS_LONG, True),
        ("the west end", (U0, 0.0), (0.0, 1.0), (-1.0, 0.0), V0, V1, BAYS_SIDE, True),
        ("the east end", (U1, 0.0), (0.0, 1.0), (1.0, 0.0), V0, V1, BAYS_SIDE, True),
        ("the court, the front wing's side", (0.0, V0 + D), (1.0, 0.0), (0.0, 1.0), U0 + D, U1 - D, BAYS_COURT, False),
        ("the court, the back wing's side", (0.0, V1 - D), (1.0, 0.0), (0.0, -1.0), U0 + D, U1 - D, BAYS_COURT, False),
        ("the court, the west wing's side", (U0 + D, 0.0), (0.0, 1.0), (1.0, 0.0), V0 + D, V1 - D, [], False),
        ("the court, the east wing's side", (U1 - D, 0.0), (0.0, 1.0), (-1.0, 0.0), V0 + D, V1 - D, [], False),
    ]
    storey = ["first floor", "second floor", "third floor"]
    for name, p, d, o, s0, s1, bays, ground in fronts:
        dock = name == "the dock front"
        notches = []
        holes = []
        for k, sc in enumerate(bays):
            gate = dock and abs(sc - GATE) < 3.5
            bay = f"Oostershuis, {name}, bay {k + 1} of {len(bays)}"
            if ground and not gate:
                notches.append(warehouse_door(m, lit, p, d, o, sc, bay))
            for i, (yb, yt) in enumerate(WIN):
                if gate and i == 0:
                    continue  # (behind the frontispiece)
                holes.append(cross_window(m, lit, p, d, o, sc, yb, yt, WHW, f"{bay}, the {storey[i]}'s cross window"))
        if dock:
            # the gateway behind the gate's portal: through the wall up to the portal's lintel
            notches.append([(GATE - 1.3, 0.0), (GATE - 1.3, 3.9), (GATE + 1.3, 3.9), (GATE + 1.3, 0.0)])
            reveal(m, p, d, o, notches[-1], 0.3, closed=False)
        cut_face(m, p, d, o, s0, s1, 0.0, H, notches, holes)
        if o[0] * p[0] + o[1] * p[1] > 0 and ground:
            # the outer fronts: the plinth between the doors, the string course over the ground floor, the quoins
            spans = sorted([(sc - DOOR_HW - 0.05, sc + DOOR_HW + 0.05) for sc in bays if not (dock and abs(sc - GATE) < 3.5)] + ([(GATE - 3.45, GATE + 3.45)] if dock else []))
            a = s0 - 0.15
            for x0, x1 in spans + [(s1 + 0.15, s1 + 0.15)]:
                if x0 - a > 0.05:
                    BL._wbox(m, p, d, o, a, x0, 0, 0.4, 0, 0.5, STONE, 0.75)
                a = x1
            BL._wbox(m, p, d, o, s0 - 0.15, s1 + 0.15, 0, 0.3, 4.4, 4.8, STONE, 1.1)
            for sk in (s0, s1):
                BL._wbox(m, p, d, o, sk - 0.6 if sk == s1 else sk, sk if sk == s1 else sk + 0.6, 0, 0.12, 0.5, H, STONE, 1.12, top=False)
    # ---- the cornices: round the outside and round the court
    m.prism([(U0 - 0.35, V0 - 0.35), (U1 + 0.35, V0 - 0.35), (U1 + 0.35, V1 + 0.35), (U0 - 0.35, V1 + 0.35)], H, H + 0.6, STONE, top=False, shade=1.05)
    cr = [(U0 + D + 0.35, V0 + D + 0.35), (U1 - D - 0.35, V0 + D + 0.35), (U1 - D - 0.35, V1 - D - 0.35), (U0 + D + 0.35, V1 - D - 0.35)]
    for i in range(4):
        a, b = cr[i], cr[(i + 1) % 4]
        f = m.poly([(a[0], a[1], H), (b[0], b[1], H), (b[0], b[1], H + 0.6), (a[0], a[1], H + 0.6)], STONE, 1.0)
        m.orient(f, (-(a[0] + b[0]) / 2, -(a[1] + b[1]) / 2, 0))
    # ---- the roofs, hoist dormers on the outer slopes, chimneys
    wings = [(U0, U1, V0, V0 + D), (U0, U1, V1 - D, V1), (U0, U0 + D, V0 + D, V1 - D), (U1 - D, U1, V0 + D, V1 - D)]
    for a0, a1, b0, b1 in wings:
        m.hip_roof(a0 - 0.35, a1 + 0.35, b0 - 0.35, b1 + 0.35, H + 0.6, RISE, SLATE)
    walls = [((0, V0), (1, 0), (0, -1), U0, U1), ((0, V1), (1, 0), (0, 1), U0, U1), ((U0, 0), (0, 1), (-1, 0), V0, V1), ((U1, 0), (0, 1), (1, 0), V0, V1)]
    for wi, (p, d_, o, s0, s1) in enumerate(walls):
        n = round((s1 - s0) / 4.0)
        pe = BL._wpt(p, d_, o, 0, 0.35, 0)[:2]
        for k in range(max(2, n // 2)):
            s = s0 + (k + 0.5) * (s1 - s0) / max(2, n // 2)
            if wi == 0 and abs(s - GATE) < 5:
                continue
            if abs(s - s0) < D + 1 or abs(s1 - s) < D + 1:
                continue
            hatch_dormer(m, pe, d_, o, s, 0.0, H + 0.6, -(D / 2 + 0.35), H + 0.6 + RISE, H + 1.6)
    for cu, cv in ((-22, V0 + 3), (-8, V0 + 3), (8, V0 + 3), (22, V0 + 3), (-22, V1 - 3), (22, V1 - 3), (U0 + 3, 0), (U1 - 3, 0)):
        m.box(cu - 0.45, cu + 0.45, cv - 0.7, cv + 0.7, H + 2.0, H + RISE + 1.8, BRICK, shade=0.9)
    # ---- the gate: the projecting frontispiece, its round-arched portal (no leaves: the game hangs its own), the
    # city's arms in the tympanum, columns, entablature, pediment, the clock
    D0, O0 = (1, 0), (0, -1)
    PF = (0, V0 - 1.2)
    BL._holed_wall(m, PF, D0, O0, GATE - 3.4, GATE + 3.4, 0, 9.2, [(GATE, 1.6, 5.6, 0.6, True)], cell=None, mat=STONE, shade=1.1)
    for sg in (-1, 1):
        f = m.poly([(GATE + sg * 3.4, V0 - 1.2, 0), (GATE + sg * 3.4, V0, 0), (GATE + sg * 3.4, V0, 9.2), (GATE + sg * 3.4, V0 - 1.2, 9.2)], STONE, 0.95)
        m.orient(f, (sg, 0, 0))
        for sc in (GATE + sg * 2.2, GATE + sg * 3.0):
            ring = m.ngon(sc, V0 - 1.55, 0.26, 8)
            m.prism(ring, 0.6, 6.4, STONE, top=False, shade=1.15)
            m.box(sc - 0.36, sc + 0.36, V0 - 1.9, V0 - 1.2, 0, 0.6, STONE, shade=1.05)
    BL._portal(m, PF, D0, O0, GATE, 1.6, 1.3, 1.1, 5.6, 5.3, 0.6, 3.9, bands=2, rnd=True, tymp="arms", door="Oostershuis, gate", leaves=False)
    BL._wbox(m, PF, D0, O0, GATE - 3.6, GATE + 3.6, 0, 0.75, 6.4, 7.3, STONE, 1.1)
    f = m.poly([(GATE - 3.7, V0 - 1.95, 7.3), (GATE + 3.7, V0 - 1.95, 7.3), (GATE, V0 - 1.95, 9.6)], STONE, 1.1)
    m.orient(f, (0, -1, 0))
    f = m.poly([(GATE - 3.7, V0 - 1.95, 7.3), (GATE, V0 - 1.95, 9.6), (GATE, V0, 9.6), (GATE - 3.7, V0, 7.3)], LEAD)
    m.orient(f, (-1, 0, 1))
    f = m.poly([(GATE + 3.7, V0 - 1.95, 7.3), (GATE, V0 - 1.95, 9.6), (GATE, V0, 9.6), (GATE + 3.7, V0, 7.3)], LEAD)
    m.orient(f, (1, 0, 1))
    m.decal(PF, D0, O0, GATE - 0.85, GATE + 0.85, 7.45, 9.15, "clock", BL.DISC, off=0.8)
    # the gate's opening, where it passes the wing's front (the game's door: its leaves hang in world/hallInWorld.ts at
    # the portal's back, 10 cm before it)
    gate_ring = [(GATE - 1.3, 0.0), (GATE + 1.3, 0.0), (GATE + 1.3, 3.9), (GATE - 1.3, 3.9)]
    record(m, (0.0, V0), D0, O0, GATE, gate_ring, "door", "Oostershuis, the gate on the dock", "")
    # ---- the tower over the gate: square, two stages of windows, a gallery, the pyramid, the lantern
    tu, tv, th = TU, TV, TH
    tfaces = [("south", (tu, tv - th), (1, 0), (0, -1)), ("north", (tu, tv + th), (-1, 0), (0, 1)), ("west", (tu - th, tv), (0, -1), (-1, 0)), ("east", (tu + th, tv), (0, 1), (1, 0))]
    for fname, p2, d2, o2 in tfaces:
        holes = []
        for j, (yb, yt, hw, rnd) in enumerate(TOWER_WIN):
            for sc in (-1.4, 1.4):
                holes.append(cross_window(m, lit, p2, d2, o2, sc, yb, yt, hw, f"Oostershuis, the tower, the {fname} face, {'the lower' if j == 0 else 'the upper'} stage, the {'left' if sc < 0 else 'right'} window",
                                          shutters=False, round_head=rnd))
        cut_face(m, p2, d2, o2, -th, th, H, 31.0, (), holes, STONE, 1.0)
    m.box(tu - th - 0.3, tu + th + 0.3, tv - th - 0.3, tv + th + 0.3, 25.6, 26.2, STONE, shade=1.05)
    m.box(tu - th - 0.7, tu + th + 0.7, tv - th - 0.7, tv + th + 0.7, 31.0, 31.5, STONE, shade=1.05)
    m.balustrade_ring(BL._sq(tu, tv, th + 0.6), 31.5, 1.0, piece=2.5)
    for su_ in (-1, 1):
        for sv in (-1, 1):
            m.prism(m.ngon(tu + su_ * (th + 0.4), tv + sv * (th + 0.4), 0.22, 6), 31.5, 32.8, STONE, top=True)
    m.frustum(BL._sq(tu, tv, th + 0.1), 31.5, BL._sq(tu, tv, 1.1), 37.5, SLATE)
    # the lantern: four round-headed openings (no glass: a bell hangs in it)
    ly0, ly1, lh = LANTERN
    for fname, p2, d2, o2 in [("south", (tu, tv - lh), (1, 0), (0, -1)), ("north", (tu, tv + lh), (-1, 0), (0, 1)), ("west", (tu - lh, tv), (0, -1), (-1, 0)), ("east", (tu + lh, tv), (0, 1), (1, 0))]:
        yb, yt, hw = LANTERN_WIN
        ring = [(-hw, yb), (hw, yb), (hw, yt - hw)] + arc(0.0, yt - hw, hw, 0.0, math.pi, 6)[1:-1] + [(-hw, yt - hw)]
        reveal(m, p2, d2, o2, ring, 0.15)
        cut_face(m, p2, d2, o2, -lh, lh, ly0, ly1, (), [ring], STONE, 1.0)
        record(m, p2, d2, o2, 0.0, ring, "slit", f"Oostershuis, the tower's lantern, the {fname} opening (the bell)", "", arch=False)
        OPENINGS[-1]["depth"] = 0.15
    m.pyramid(m.ngon(tu, tv, 1.25, 8, math.pi / 8), ly1, 42.5, LEAD)
    m.prism(m.ngon(tu, tv, 0.22, 6), 42.4, 42.8, GILT, top=True)
    m.spike(tu, tv, 42.8, 44.3, 0.05, GILT)
    return m, lit


def markers():
    """Every real opening as an empty "opening_<id>" (dev/interiorcheck.ts reads them) and a row of shared/oostershuisShell.ts."""
    obs = []
    for i, o in enumerate(OPENINGS):
        o["id"] = f"oh_{i:03d}"
        ob = bpy.data.objects.new("opening_" + o["id"], None)
        ob.empty_display_size = max(0.2, o["hw"])
        ob.location = BL.B(o["x"], (o["yb"] + o["yt"]) / 2, o["z"])
        for k in ("kind", "label", "glaze", "shape", "part"):
            ob[k] = str(o[k])
        for k in ("hw", "yb", "yt", "nx", "nz", "tx", "tz", "depth"):
            ob[k] = float(o[k])
        ob["arch"] = 0
        bpy.context.scene.collection.objects.link(ob)
        obs.append(ob)
    f3 = lambda v: f"{v:.3f}".rstrip("0").rstrip(".") if abs(v) >= 5e-4 else "0"  # noqa: E731
    lines = [
        "// GENERATED by tools/blender/build_oostershuis.py (issue #28, interiors are real): do not edit. Every real opening",
        "// of the Oostershuis's shell (client/public/models/oostershuis.glb, whose empties opening_<id> are the same), in the",
        "// WORLD's frame (world/landmarkHalls.ts moves them into the hall's: shellOpening.ts inFrame). x, z: its middle on the",
        "// wall's outer face; (tx, tz) along it, (nx, nz) out of it; poly its outline where the reveal ends (u along from the",
        "// middle, world y); depth the reveal's depth into the wall.",
        "",
        'import type { ShellOpening } from "./shellOpening.js";',
        "",
        "export const SHELL_OPENINGS: ShellOpening[] = [",
    ]
    for o in OPENINGS:
        parts_ = []
        for k in ("id", "kind", "part", "label", "glaze", "shape", "x", "z", "tx", "tz", "nx", "nz", "hw", "yb", "yt", "arch", "depth"):
            v = o[k]
            parts_.append(f"{k}: {json.dumps(v) if isinstance(v, (str, bool)) else f3(float(v))}")
        parts_.append("poly: [" + ", ".join(f"[{f3(u)}, {f3(y)}]" for u, y in o["poly"]) + "]")
        lines.append("  { " + ", ".join(parts_) + " },")
    lines += ["];", ""]
    with open(SHELL_TS, "w", newline="\n") as f:
        f.write("\n".join(lines))
    kinds = {}
    for o in OPENINGS:
        kinds[o["kind"]] = kinds.get(o["kind"], 0) + 1
    print(f"[build_oostershuis] {len(obs)} real openings {kinds} -> {SHELL_TS}")
    return obs


def main():
    city = json.load(open(BL.CITY))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    # the landmarks' materials by name (the game gives them their pictures: world/oostershuisShell.ts); the atlas and the
    # gilt as plain stand-ins (the game uses landmarks.glb's own), so no second copy of the atlas goes into the file
    rgb = [(0.7, 0.68, 0.62), (0.25, 0.27, 0.3), (0.05, 0.06, 0.07), (0.55, 0.3, 0.22), (0.3, 0.31, 0.32), (0.55, 0.5, 0.42), (0.8, 0.55, 0.16), (0.3, 0.22, 0.15), (0.1, 0.12, 0.13)]
    for n, c in zip(MAT_NAMES, rgb):
        BL.material(n, c)
    f = dict(city["landmarks"]["hanzehuis"]["frame"])
    if f["open"] > 0:  # (build_landmarks.py frame(..., away=True))
        f["n"] = [-f["n"][0], -f["n"][1]]
    fr = BL.Frame(f)
    m, lit = oostershuis(fr)
    body = m.to_object("oostershuis_body")
    glass = lit.to_object("oostershuis_lit_glass")
    obs = [body, glass] + markers()
    for o in bpy.context.scene.objects:
        o.select_set(o in obs)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=True, export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7, export_extras=True)
    print(f"[build_oostershuis] body {m.tris} triangles, lit glass {lit.tris}; -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
