"""The one packing crate of the town (Steve 2026-10-11: "wooden boxes have a bunch of textures, I think we only need
one, and make it high detail"). shared/crateCatalog.ts holds its size, its size classes and the goods it is stencilled
for; tools/textures/crate_sheet.mjs paints its picture (tools/blender/art/crate/crate_sheet.jpg and the layout
crate_sheet.json this script reads).

    "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_crate.py [-- --preview]

Writes client/public/models/crate.glb (Draco, the picture as JPEG). Real scale in metres at class 1 (0.80 x 0.56 x
0.50 m), its foot at y 0, its front (the goods' stencil) toward +Z in the game (-Y in Blender), long along x.

The build of a crate of the 1870s: four pine boards a side, 18 mm thick, with gaps between them (the dark inside shows
through), the edges chamfered; the ends three upright boards in a frame of cleats; a lid of four boards with two
cleats across it; two skids under it for the slings and the hand trucks; bent iron straps over the lid's corners,
nailed; a rope becket on each end. An open crate: the lid off and leaning against its front, packing straw inside.

Nodes (each its own frame, one material "crate"):
  crate        the closed crate; its child "crate_marks" carries the front and back boards with the stencil
  crate_open   the open crate with its lid leaning against it; child "crate_open_marks"
Extras on each: crate_cells = [cell width, cell height (uv), columns, goods]: a crate of the goods k shows cell k:
its marks' uv moved by (k % columns * width, k // columns * height) (glTF uv: v down). Our own work.
"""

import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ART = os.path.join(ROOT, "tools", "blender", "art", "crate")
OUT = os.path.join(ROOT, "client", "public", "models", "crate.glb")
SHOT = os.path.join(ROOT, "data", "shots", "crate_preview.png")

LAY = json.load(open(os.path.join(ART, "crate_sheet.json"), encoding="utf-8"))
G = LAY["geometry"]
PPM = LAY["PPM"]
SW, SH = LAY["W"], LAY["H"]
L, D, H = G["L"], G["D"], G["H"]
T, GAP, SKID = G["t"], G["gap"], G["skid"]
CLEAT, CLEAT_T, LID_CT = G["cleat"], G["cleatT"], G["lidCleatT"]
LID_TOP, SIDE_TOP, HB, NB = G["lidTop"], G["sideTop"], G["hb"], G["boards"]
BX = G["bx"]  # the body's half length inside the end cleats
HY = D / 2
MARGIN = 3  # pixels kept off a region's edge (the mips)


class Builder:
    """Faces with their uv (sheet pixels) and a shade, in one bmesh per object. `shut`: a closed crate, whose faces
    turned toward its middle (the boards' inner sides, the lid's underside, the cleats against the boards) nobody sees:
    they are left out (the frame budget: about half the triangles)."""

    shut = False

    def __init__(self):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.col = self.bm.loops.layers.color.new("Col")
        self.marks = self.bm.faces.layers.int.new("marks")
        self.xf = Matrix.Identity(4)

    def face(self, pts, uvs, shade=1.0, marks=False, cull=False):
        if cull and self.shut:
            c = sum((Vector(p) for p in pts), Vector()) / len(pts)
            n = (Vector(pts[1]) - Vector(pts[0])).cross(Vector(pts[2]) - Vector(pts[0]))
            if n.length > 1e-12 and n.normalized().dot(Vector((0, 0, H / 2)) - c) > 0.02:
                return None
        vs = [self.bm.verts.new(self.xf @ Vector(p)) for p in pts]
        f = self.bm.faces.new(vs)
        for lp, (u, v) in zip(f.loops, uvs):
            lp[self.uv].uv = (u / SW, 1.0 - v / SH)
            z = lp.vert.co.z
            # a baked shade: darker low down (the setts' shadow), the given factor
            k = shade * (0.72 + 0.28 * min(1.0, max(0.0, z / 0.35)))
            lp[self.col] = (k, k, k, 1.0)
        f[self.marks] = 1 if marks else 0
        return f


def region_uv(p, axes, origin, flip=(False, False), lo=(0.0, 0.0)):
    """A point's sheet pixel: its coordinates along two axes (metres from lo), from the region's origin."""
    a = (p[axes[0]] - lo[0]) * PPM
    b = (p[axes[1]] - lo[1]) * PPM
    if flip[0]:
        a = -a
    if flip[1]:
        b = -b
    return (origin[0] + a, origin[1] + b)


def board(b, lo, hi, grain, plank, chamfer=0.003, outer=None, inner_y=None):
    """A board: a box lo..hi (Blender axes), its long edges chamfered. grain: the axis the grain runs along.
    plank: the sheet pixel origin of its plank strip. outer: (sign of y, 'front'/'back' strip origin) when its outer
    face is a side of the crate (the label strip: the stencil); inner faces of side boards read as sawn wood."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    c = chamfer
    # the box as 6 faces with chamfered edges along the grain: an octagonal section, flat ends
    other = [a for a in (0, 1, 2) if a != grain]
    a0, a1 = other
    lo_ = [x0, y0, z0]
    hi_ = [x1, y1, z1]
    # the section outline (8 points) in the two cross axes, walking round
    s0, s1 = lo_[a0], hi_[a0]
    t0, t1 = lo_[a1], hi_[a1]
    cc = min(c, (s1 - s0) * 0.3, (t1 - t0) * 0.3)
    sec = [(s0 + cc, t0), (s1 - cc, t0), (s1, t0 + cc), (s1, t1 - cc), (s1 - cc, t1), (s0 + cc, t1), (s0, t1 - cc), (s0, t0 + cc)]
    g0, g1 = lo_[grain], hi_[grain]

    def P(g, s, t):
        p = [0.0, 0.0, 0.0]
        p[grain] = g
        p[a0] = s
        p[a1] = t
        return tuple(p)

    ln = g1 - g0
    ends = LAY["regions"]["endgrain"]
    for i in range(8):
        sa, ta = sec[i]
        sb, tb = sec[(i + 1) % 8]
        # outward normal of this strip of the section
        nm = Vector((0, 0, 0))
        mid = ((sa + sb) / 2, (ta + tb) / 2)
        cs, ct = (s0 + s1) / 2, (t0 + t1) / 2
        n2 = Vector((mid[0] - cs, mid[1] - ct))
        dirn = Vector((tb - ta, -(sb - sa)))
        if dirn.dot(n2) < 0:
            dirn = -dirn
        quad = [P(g0, sa, ta), P(g1, sa, ta), P(g1, sb, tb), P(g0, sb, tb)]
        # winding: outward
        e1 = Vector(quad[1]) - Vector(quad[0])
        e2 = Vector(quad[3]) - Vector(quad[0])
        n3 = e1.cross(e2)
        nwant = [0.0, 0.0, 0.0]
        nwant[a0] = dirn.x
        nwant[a1] = dirn.y
        if n3.dot(Vector(nwant)) < 0:
            quad = quad[::-1]
        # which uv: the outer side of a crate wall (label strip), its inside, or the plank's own
        ny = nwant[1] / (Vector(nwant).length or 1)
        is_out = outer is not None and abs(ny) > 0.9 and (ny > 0) == (outer[0] > 0) and abs(dirn.length) > 0
        lo_pt = [0.0, 0.0, 0.0]
        if is_out:
            origin = outer[1]
            back = outer[0] > 0
            # u along x (front: left to right is +x; back seen from behind: -x), v down from the lid's foot
            uvs = []
            for q in quad:
                u = (q[0] + L / 2) * PPM if not back else (L / 2 - q[0]) * PPM
                v = (SIDE_TOP - q[2]) * PPM
                uvs.append((origin[0] + u, origin[1] + v))
            b.face(quad, uvs, marks=True)
            continue
        inside = inner_y is not None and abs(ny) > 0.9 and (ny > 0) != (inner_y > 0)
        org = LAY["regions"]["inside"][:2] if inside else plank
        # grain along u (from the board's start), the cross axis along v (from its low side), a margin off the edge
        uvs = []
        for q in quad:
            gu = (q[grain] - g0) * PPM + MARGIN
            # the face's width coordinate: the larger of the two cross extents of the strip
            w = (q[a0] - s0) if abs(sb - sa) >= abs(tb - ta) else (q[a1] - t0)
            uvs.append((org[0] + gu, org[1] + w * PPM + MARGIN))
        b.face(quad, uvs, cull=True)
    # the two ends: end grain
    for g, sgn in ((g0, -1), (g1, 1)):
        pts = [P(g, s, t) for s, t in sec]
        if sgn < 0:
            pts = pts[::-1]
        # winding check
        e1 = Vector(pts[1]) - Vector(pts[0])
        e2 = Vector(pts[2]) - Vector(pts[0])
        nw = [0.0, 0.0, 0.0]
        nw[grain] = sgn
        if e1.cross(e2).dot(Vector(nw)) < 0:
            pts = pts[::-1]
        uvs = [(ends[0] + MARGIN + (p[a0] - s0) * PPM * 4, ends[1] + MARGIN + (p[a1] - t0) * PPM * 4) for p in pts]
        b.face(pts, uvs, shade=0.9, cull=True)


def plate(b, lo, hi, region, shade=1.0):
    """A plain box (iron, the dark inside): every face projected onto its region."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    org = LAY["regions"][region]
    faces = [
        ([(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)], (0, 2)),
        ([(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)], (0, 2)),
        ([(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)], (1, 2)),
        ([(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)], (1, 2)),
        ([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], (0, 1)),
        ([(x0, y1, z0), (x1, y1, z0), (x1, y0, z0), (x0, y0, z0)], (0, 1)),
    ]
    lo_ = (x0, y0, z0)
    for pts, (ax, bx) in faces:
        uvs = [(org[0] + MARGIN + (p[ax] - lo_[ax]) * PPM, org[1] + MARGIN + (p[bx] - lo_[bx]) * PPM) for p in pts]
        b.face(pts, uvs, shade=shade)


def inner_box(b, lo, hi, top=True):
    """The dark inside seen through the gaps: faces turned out, toward the boards."""
    x0, y0, z0 = lo
    x1, y1, z1 = hi
    org = LAY["regions"]["dark"]
    uv4 = [(org[0] + 20, org[1] + 20), (org[0] + 100, org[1] + 20), (org[0] + 100, org[1] + 100), (org[0] + 20, org[1] + 100)]
    fs = [
        [(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
        [(x1, y1, z0), (x0, y1, z0), (x0, y1, z1), (x1, y1, z1)],
        [(x1, y0, z0), (x1, y1, z0), (x1, y1, z1), (x1, y0, z1)],
        [(x0, y1, z0), (x0, y0, z0), (x0, y0, z1), (x0, y1, z1)],
    ]
    if top:
        fs.append([(x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)])
    for pts in fs:
        b.face(pts, uv4, shade=0.6)


def tube(b, path, r, sides=6, region="rope"):
    """A rope along a path of points: rings of `sides`, uv along its length and round it."""
    org = LAY["regions"][region]
    rings = []
    total = 0.0
    lens = [0.0]
    for i in range(1, len(path)):
        total += (Vector(path[i]) - Vector(path[i - 1])).length
        lens.append(total)
    for i, p in enumerate(path):
        p = Vector(p)
        tng = (Vector(path[min(i + 1, len(path) - 1)]) - Vector(path[max(i - 1, 0)])).normalized()
        up = Vector((0, 0, 1)) if abs(tng.z) < 0.9 else Vector((1, 0, 0))
        n1 = tng.cross(up).normalized()
        n2 = tng.cross(n1).normalized()
        rings.append([p + (n1 * math.cos(2 * math.pi * k / sides) + n2 * math.sin(2 * math.pi * k / sides)) * r for k in range(sides + 1)])
    for i in range(len(path) - 1):
        for k in range(sides):
            pts = [rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]]
            uvs = [(org[0] + MARGIN + lens[i] * PPM * 2, org[1] + MARGIN + k / sides * 50), (org[0] + MARGIN + lens[i + 1] * PPM * 2, org[1] + MARGIN + k / sides * 50),
                   (org[0] + MARGIN + lens[i + 1] * PPM * 2, org[1] + MARGIN + (k + 1) / sides * 50), (org[0] + MARGIN + lens[i] * PPM * 2, org[1] + MARGIN + (k + 1) / sides * 50)]
            # outward winding
            e1 = pts[1] - pts[0]
            e2 = pts[3] - pts[0]
            mid = (pts[0] + pts[2]) / 2
            if e1.cross(e2).dot(mid - Vector(path[i])) < 0:
                pts = pts[::-1]
                uvs = uvs[::-1]
            b.face([tuple(q) for q in pts], uvs, shade=0.95)


def body(b, lid=True):
    """The crate in Blender axes: x along, y across (front -y), z up, its foot at z 0."""
    planks = LAY["planks"]
    pk = iter(range(len(planks)))
    nxt = lambda: planks[next(pk)]
    front, back = LAY["cells"][0]["front"], LAY["cells"][0]["back"]
    # skids: two runners along x
    for sy in (-1, 1):
        y = sy * (HY - 0.09)
        board(b, (-BX, y - 0.035, 0.0), (BX, y + 0.035, SKID), 0, planks[30 + (sy > 0)], chamfer=0.006)
    # the floor (seen only from below and inside an open crate)
    plate(b, (-BX + T, -HY + T, SKID), (BX - T, HY - T, SKID + T), "inside", shade=0.7)
    # the sides: four boards each, the full body's length; their outer faces carry the stencil
    for sy, strip in ((-1, front), (1, back)):
        for i in range(NB):
            ztop = SIDE_TOP - i * (HB + GAP)
            zb = ztop - HB
            y0, y1 = (-HY, -HY + T) if sy < 0 else (HY - T, HY)
            board(b, (-BX, y0, zb), (BX, y1, ztop), 0, nxt(), outer=(sy, strip), inner_y=sy)
    # the ends: three upright boards between the sides, in a frame of cleats
    wb = (D - 2 * T - 2 * GAP) / 3
    for sx in (-1, 1):
        x0, x1 = (BX - T, BX) if sx > 0 else (-BX, -BX + T)
        for k in range(3):
            y0 = -HY + T + k * (wb + GAP)
            board(b, (x0, y0, SKID), (x1, y0 + wb, SIDE_TOP), 2, nxt())
        xc0, xc1 = (BX, BX + CLEAT_T) if sx > 0 else (-BX - CLEAT_T, -BX)
        # the cleats across, top and foot, the full depth (over the sides' end grain)
        board(b, (xc0, -HY, SKID), (xc1, HY, SKID + CLEAT), 1, nxt(), chamfer=0.004)
        board(b, (xc0, -HY, SIDE_TOP - CLEAT), (xc1, HY, SIDE_TOP), 1, nxt(), chamfer=0.004)
        # the upright cleats at the corners, between them
        for sy in (-1, 1):
            ya, yb = (-HY, -HY + 0.06) if sy < 0 else (HY - 0.06, HY)
            board(b, (xc0, ya, SKID + CLEAT), (xc1, yb, SIDE_TOP - CLEAT), 2, nxt(), chamfer=0.004)
        # the rope becket through the end boards, hanging in a loop
        xr = sx * (BX + 0.002)
        zr = SKID + (SIDE_TOP - SKID) * 0.66
        path = [(xr - sx * 0.01, -0.13, zr), (xr + sx * 0.014, -0.12, zr - 0.02), (xr + sx * 0.036, -0.08, zr - 0.075),
                (xr + sx * 0.042, 0.0, zr - 0.095), (xr + sx * 0.036, 0.08, zr - 0.075), (xr + sx * 0.014, 0.12, zr - 0.02), (xr - sx * 0.01, 0.13, zr)]
        tube(b, path, 0.0105)
        # the knots where it comes through
        for y in (-0.13, 0.13):
            tube(b, [(xr - sx * 0.004, y, zr - 0.016), (xr + sx * 0.014, y, zr), (xr - sx * 0.004, y, zr + 0.016)], 0.016, sides=6)
    # the dark inside, seen through the gaps
    inner_box(b, (-BX + T + 0.004, -HY + T + 0.004, SKID + T), (BX - T - 0.004, HY - T - 0.004, SIDE_TOP - 0.004), top=lid)
    if lid:
        lid_boards(b, nxt)
    else:
        straw(b)


def lid_boards(b, nxt, z0=SIDE_TOP, on=True):
    """The lid: four boards along x over the whole top, two cleats across them, the corners strapped in iron."""
    wl = (D - 3 * GAP) / 4
    for k in range(4):
        y0 = -HY + k * (wl + GAP)
        board(b, (-L / 2, y0, z0), (L / 2, y0 + wl, z0 + T), 0, nxt())
    for sx in (-1, 1):
        xm = sx * (L / 2 - 0.11)
        board(b, (xm - CLEAT / 2, -HY + 0.004, z0 + T), (xm + CLEAT / 2, HY - 0.004, z0 + T + LID_CT), 1, nxt(), chamfer=0.004)
    # iron straps bent over the lid's ends, near the corners: on the lid, down the end
    th = 0.0025
    for sx in (-1, 1):
        for sy in (-1, 1):
            y = sy * (HY - 0.045)
            xa, xb = sorted((sx * (L / 2 - 0.07), sx * (L / 2 + th)))
            plate(b, (xa, y - 0.016, z0 + T), (xb, y + 0.016, z0 + T + th), "iron", shade=0.95)
            if not on:
                continue
            xe0, xe1 = sorted((sx * (L / 2), sx * (L / 2 + th)))
            plate(b, (xe0, y - 0.016, z0 + T - 0.12), (xe1, y + 0.016, z0 + T), "iron", shade=0.95)


def straw(b):
    """Packing straw inside an open crate, heaped a little in the middle, tufts over the rim."""
    org = LAY["regions"]["straw"]
    n = 6
    zs = SKID + (SIDE_TOP - SKID) * 0.8
    x0, x1 = -BX + T + 0.002, BX - T - 0.002
    y0, y1 = -HY + T + 0.002, HY - T - 0.002
    def z(i, j):
        if i in (0, n) or j in (0, n):
            return zs
        return zs + 0.035 * math.sin(i * 1.7 + j * 0.9) * 0.5 + 0.03 * (1 - abs(i - n / 2) / (n / 2)) * (1 - abs(j - n / 2) / (n / 2))
    for i in range(n):
        for j in range(n):
            pts = []
            uvs = []
            for (a, c) in ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1)):
                x = x0 + (x1 - x0) * a / n
                y = y0 + (y1 - y0) * c / n
                pts.append((x, y, z(a, c)))
                uvs.append((org[0] + MARGIN + (x - x0) * PPM * 0.65, org[1] + MARGIN + (y - y0) * PPM * 0.65))
            b.face(pts, uvs, shade=0.9)


def build(name, lid=True, leaning_lid=False):
    b = Builder()
    b.shut = lid
    body(b, lid=lid)
    if leaning_lid:
        # the lid off, leaning against an end: its long side on the setts, 72 degrees up, its cleats outward, the
        # stencilled front left to be read
        planks = LAY["planks"]
        it = iter(range(20, 30))
        phi = math.radians(72)
        xf = L / 2 + 0.004 + SIDE_TOP / math.tan(phi)
        R = Matrix(((0, -math.cos(phi), math.sin(phi), 0), (1, 0, 0, 0), (0, math.sin(phi), math.cos(phi), 0), (0, 0, 0, 1)))
        # (lid in its own frame: its foot edge on y 0, across to y D, its back face at z 0)
        b.xf = Matrix.Translation((xf, 0.0, 0.002)) @ R @ Matrix.Translation((0, HY, -SIDE_TOP))
        lid_boards(b, lambda: planks[next(it)], on=False)
        b.xf = Matrix.Identity(4)
    # split: the marks (the stencilled faces) into their own mesh
    out = []
    for part, keep in ((name, 0), (f"{name}_marks", 1)):
        bm2 = b.bm.copy()
        lay = bm2.faces.layers.int.get("marks")
        kill = [f for f in bm2.faces if f[lay] != keep]
        bmesh.ops.delete(bm2, geom=kill, context="FACES")
        bm2.faces.layers.int.remove(lay)
        me = bpy.data.meshes.new(part)
        bm2.to_mesh(me)
        bm2.free()
        me.materials.append(MAT)
        ob = bpy.data.objects.new(part, me)
        bpy.context.collection.objects.link(ob)
        out.append(ob)
    b.bm.free()
    out[1].parent = out[0]
    cw, ch = 432 / SW, 462 / SH
    out[0]["crate_cells"] = [cw, ch, SW // 432, len(LAY["cells"])]
    return out[0]


def make_material():
    img = bpy.data.images.load(os.path.join(ART, "crate_sheet.jpg"))
    img.name = "crate wood"
    m = bpy.data.materials.new("crate")
    nt = m.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = img
    t.interpolation = "Linear"
    nt.links.new(t.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.9
    return m


def preview(objs):
    scn = bpy.context.scene
    scn.render.engine = "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in [e.identifier for e in bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items] else "BLENDER_EEVEE"
    cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
    scn.collection.objects.link(cam)
    scn.camera = cam
    objs[0].location = (-0.6, 0, 0)
    objs[1].location = (0.6, 0.3, 0)
    cam.location = (1.4, -2.6, 1.5)
    d = Vector((0, 0, 0.3)) - cam.location
    cam.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    sun = bpy.data.objects.new("sun", bpy.data.lights.new("sun", "SUN"))
    sun.data.energy = 4
    sun.rotation_euler = (math.radians(50), 0, math.radians(30))
    scn.collection.objects.link(sun)
    scn.world = bpy.data.worlds.new("w")
    scn.world.color = (0.3, 0.3, 0.32)
    scn.render.resolution_x, scn.render.resolution_y = 1600, 1000
    scn.render.filepath = SHOT
    os.makedirs(os.path.dirname(SHOT), exist_ok=True)
    bpy.ops.render.render(write_still=True)
    objs[0].location = (0, 0, 0)
    objs[1].location = (0, 0, 0)


def main():
    global MAT
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    bpy.ops.wm.read_factory_settings(use_empty=True)
    MAT = make_material()
    objs = [build("crate"), build("crate_open", lid=False, leaning_lid=True)]
    if "--preview" in argv:
        preview(objs)
    for ob in objs:
        tris = sum(len(p.vertices) - 2 for p in ob.data.polygons) + sum(len(p.vertices) - 2 for c in ob.children for p in c.data.polygons)
        print(f"[build_crate] {ob.name}: {tris} tris")
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", export_image_format="JPEG", export_jpeg_quality=90, export_apply=False,
                              use_selection=False, export_extras=True, export_vertex_color="ACTIVE", export_all_vertex_colors=True,
                              export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                              export_draco_position_quantization=14, export_draco_texcoord_quantization=14,
                              export_draco_color_quantization=8, export_draco_normal_quantization=10)
    print(f"[build_crate] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")


if __name__ == "__main__":
    main()
