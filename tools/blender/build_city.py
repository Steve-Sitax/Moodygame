"""Build the 1873 city houses in Blender and export them for the game.

    blender -b -P tools/blender/build_city.py

Reads shared/city_build.json (tools/city/plan.py) and writes
client/public/models/city.glb, one mesh per 100 m chunk, three materials:
  facade  - walls; UV0 in bays (3 m) and storeys, UV1 = atlas cell (style, part)
  roof    - roofs and flat tops; UV0 in metres / 3, UV1 = atlas cell (tile, slate)
  stone   - copings, gable steps, cornices, chimneys
The game swaps these materials for its own PS1 materials by name; the atlas
cells are drawn in client/src/world/cityTextures.ts. Vertex colour = tint and
grime (darker near the ground), a cheap stand-in for baked shadow.

Blender is Z-up; glTF export turns it to Y-up. A world point (x, y, z) of the
game is placed at Blender (x, -z, y).
"""

import json
import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "shared", "city_build.json")
OUT = os.path.join(ROOT, "client", "public", "models", "city.glb")
CHUNK = 100.0
BAY = 3.0

# atlas cells: facade atlas is 4 x 4, one row per style, columns ground / upper / blind / (spare)
STYLE_ROW = {"brick": 0, "plaster": 1, "plaster_grey": 2, "brick_dark": 3, "public": 1}
PART_COL = {"ground": 0, "upper": 1, "blind": 2, "door": 3}
ROOF_CELL = {"tile": (0, 0), "slate": (1, 0), "flat": (0, 1), "lead": (1, 1)}

MAT_FACADE, MAT_ROOF, MAT_STONE = 0, 1, 2


def B(x, y, z):
    """Game world (x, y up, z) -> Blender (x, -z, y)."""
    return Vector((x, -z, y))


class Builder:
    def __init__(self, ground_h, storey_h):
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.new("UVMap")
        self.cell = self.bm.loops.layers.uv.new("Cell")
        self.col = self.bm.loops.layers.float_color.new("Col")
        self.gh = ground_h
        self.sh = storey_h
        self.tint = (1, 1, 1)

    def face(self, pts, mat, uvs, cell, outward, shade=None):
        """pts: world points (x, y, z); outward: world vector the face must look along."""
        verts = [self.bm.verts.new(B(*p)) for p in pts]
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return None
        f.material_index = mat
        f.normal_update()
        want = B(*outward)
        if f.normal.dot(want) < 0:
            f.normal_flip()
            # flipping reverses the loop order; keep uv and points paired
            order = list(reversed(range(len(pts))))
        else:
            order = list(range(len(pts)))
        for loop in f.loops:
            i = verts.index(loop.vert)
            loop[self.uv].uv = uvs[i]
            loop[self.cell].uv = cell
            y = pts[i][1]
            g = shade if shade is not None else 0.66 + 0.34 * min(1.0, y / 9.0)
            loop[self.col] = (self.tint[0] * g, self.tint[1] * g, self.tint[2] * g, 1.0)
        return f

    # ---------------------------------------------------------------- walls

    def wall(self, a, b, y0, y1, style, street, facing, door=False):
        """A vertical wall from world (ax, az) to (bx, bz), y0..y1. Street walls get windows."""
        L = math.hypot(b[0] - a[0], b[1] - a[1])
        if L < 0.05 or y1 - y0 < 0.05:
            return
        row = STYLE_ROW[style]
        bays = max(1, round(L / BAY))
        if not street:
            cell = (PART_COL["blind"], row)
            self.face([(a[0], y0, a[1]), (b[0], y0, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], MAT_FACADE,
                      [(0, y0 / self.sh), (L / BAY, y0 / self.sh), (L / BAY, y1 / self.sh), (0, y1 / self.sh)], cell, facing)
            return
        # ground storey: one bay with the door (on the house front), the others with windows
        gy = min(y1, self.gh)
        if gy > y0:
            vt = (gy - y0) / self.gh
            spans = [(0, bays, "ground")]
            if door:
                d = bays // 2
                spans = [(0, d, "ground"), (d, d + 1, "door"), (d + 1, bays, "ground")]
            for k0, k1, part in spans:
                if k1 <= k0:
                    continue
                pa = (a[0] + (b[0] - a[0]) * k0 / bays, a[1] + (b[1] - a[1]) * k0 / bays)
                pb = (a[0] + (b[0] - a[0]) * k1 / bays, a[1] + (b[1] - a[1]) * k1 / bays)
                self.face([(pa[0], y0, pa[1]), (pb[0], y0, pb[1]), (pb[0], gy, pb[1]), (pa[0], gy, pa[1])], MAT_FACADE,
                          [(0, 0), (k1 - k0, 0), (k1 - k0, vt), (0, vt)], (PART_COL[part], row), facing)
        if y1 > self.gh:
            ya = max(y0, self.gh)
            v0, v1 = (ya - self.gh) / self.sh, (y1 - self.gh) / self.sh
            self.face([(a[0], ya, a[1]), (b[0], ya, b[1]), (b[0], y1, b[1]), (a[0], y1, a[1])], MAT_FACADE,
                      [(0, v0), (bays, v0), (bays, v1), (0, v1)], (PART_COL["upper"], row), facing)

    def box(self, cx, cy, cz, sx, sy, sz, ux, uz, mat=MAT_STONE, cell=(0, 0), shade=0.9):
        """An oriented box: centre, size along u (sx), up (sy), along n (sz); u = (ux, uz) on the ground."""
        nx, nz = -uz, ux
        hx, hy, hz = sx / 2, sy / 2, sz / 2
        def P(i, j, k):
            return (cx + ux * hx * i + nx * hz * k, cy + hy * j, cz + uz * hx * i + nz * hz * k)
        faces = [
            ([P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)], (-nx, 0, -nz)),
            ([P(1, -1, 1), P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1)], (nx, 0, nz)),
            ([P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1)], (-ux, 0, -uz)),
            ([P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)], (ux, 0, uz)),
            ([P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)], (0, 1, 0)),
        ]
        for pts, out in faces:
            self.face(pts, mat, [(0, 0), (sx / BAY, 0), (sx / BAY, sy / BAY), (0, sy / BAY)], cell, out, shade)

    # ---------------------------------------------------------------- houses

    def house(self, h, rng):
        t = h["tint"]
        self.tint = (t, t * rng.uniform(0.97, 1.02), t * rng.uniform(0.95, 1.02))
        if h["rect"]:
            self.rect_house(h, rng)
        else:
            self.poly_house(h, rng)

    def rect_house(self, h, rng):
        (ox, oz), (ux, uz), (nx, nz) = h["o"], h["u"], h["n"]
        s0, s1 = h["s"]
        t0, t1 = h["t"]
        H = h["h"]
        style = h["style"]
        W, D = s1 - s0, t1 - t0

        def P(s, t):
            return (ox + ux * s + nx * t, oz + uz * s + nz * t)

        c = [P(s0, t0), P(s1, t0), P(s1, t1), P(s0, t1)]
        outs = [(-nx, 0, -nz), (ux, 0, uz), (nx, 0, nz), (-ux, 0, -uz)]
        street = h["street"]
        for i in range(4):
            self.wall(c[i], c[(i + 1) % 4], 0, H, style, street[i], outs[i], door=(i == 0 and street[0]))
        roof_cell = ROOF_CELL[h["roofMat"]]
        pitch = math.radians(h["pitch"])
        if h["roof"] == "front":
            # ridge runs into the block; gable on the street front (and a plain one at the back)
            rise = min(W / 2 * math.tan(pitch), 9.0)
            sm = (s0 + s1) / 2
            over = 0.35
            for side in (-1, 1):
                se = s0 if side < 0 else s1
                a, b = P(se, t0 - 0.05), P(se, t1 + over)
                r0, r1 = P(sm, t0 - 0.05), P(sm, t1 + over)
                self.face([(a[0], H, a[1]), (b[0], H, b[1]), (r1[0], H + rise, r1[1]), (r0[0], H + rise, r0[1])], MAT_ROOF,
                          [(0, 0), (D / BAY, 0), (D / BAY, (W / 2) / math.cos(pitch) / BAY), (0, (W / 2) / math.cos(pitch) / BAY)],
                          roof_cell, (ux * side, 1.2, uz * side), shade=1.0)
            self.gable(h, P, s0, s1, t0, H, rise, front=True, street=street[0], style=style, rng=rng)
            self.gable(h, P, s0, s1, t1, H, rise, front=False, street=street[2], style=style, rng=rng)
            if rng.random() < 0.6:
                cs, ct = rng.uniform(s0 + 0.8, s1 - 0.8), rng.uniform(t0 + D * 0.5, t1 - 0.6)
                cx, cz = P(cs, ct)
                top = H + rise * (1 - abs(cs - sm) / (W / 2)) + 1.1
                self.box(cx, (H + top) / 2, cz, 0.6, top - H, 0.9, ux, uz, MAT_STONE, (1, 0))
        elif h["roof"] == "side":
            # ridge along the street; plain side gables are party walls
            rise = min(D / 2 * math.tan(pitch), 6.5)
            tm = (t0 + t1) / 2
            over = 0.4
            for side in (-1, 1):
                te = t0 - over if side < 0 else t1 + over
                a, b = P(s0, te), P(s1, te)
                r0, r1 = P(s0, tm), P(s1, tm)
                run = abs(te - tm)
                drop = over * math.tan(pitch)
                self.face([(a[0], H - drop, a[1]), (b[0], H - drop, b[1]), (r1[0], H + rise, r1[1]), (r0[0], H + rise, r0[1])], MAT_ROOF,
                          [(0, 0), (W / BAY, 0), (W / BAY, run / math.cos(pitch) / BAY), (0, run / math.cos(pitch) / BAY)],
                          roof_cell, (nx * side, 1.2, nz * side), shade=1.0)
            for se, out, flag in ((s0, (-ux, 0, -uz), street[3]), (s1, (ux, 0, uz), street[1])):
                a, b, r = P(se, t0), P(se, t1), P(se, tm)
                self.face([(a[0], H, a[1]), (b[0], H, b[1]), (r[0], H + rise, r[1])], MAT_FACADE,
                          [(0, 0), (D / BAY, 0), (D / 2 / BAY, rise / self.sh)], (PART_COL["blind"], STYLE_ROW[style]), out)
            # cornice along the street front, and dormers now and then
            if street[0]:
                cx, cz = P((s0 + s1) / 2, t0 - 0.15)
                self.box(cx, H - 0.2, cz, W, 0.35, 0.35, ux, uz, MAT_STONE, (0, 0), 0.85)
                if W > 5 and rng.random() < 0.55:
                    ds = rng.uniform(s0 + 1.4, s1 - 1.4)
                    dx_, dz_ = P(ds, t0 + 1.2)
                    self.dormer(dx_, H + 0.9, dz_, ux, uz, nx, nz, style)
            for _ in range(rng.choice([1, 2])):
                cs = rng.choice([s0 + 0.5, s1 - 0.5])
                cx, cz = P(cs, tm)
                self.box(cx, H + rise * 0.5 + 0.6, cz, 0.7, rise + 1.2, 0.7, ux, uz, MAT_STONE, (1, 0))
        else:
            self.flat_top([c[0], c[1], c[2], c[3]], H, street, outs, style)

    def dormer(self, x, y, z, ux, uz, nx, nz, style):
        """A small roof window facing the street."""
        w, hgt, d = 1.3, 1.6, 1.6
        fx, fz = x - nx * d / 2, z - nz * d / 2
        a = (fx - ux * w / 2, fz - uz * w / 2)
        b = (fx + ux * w / 2, fz + uz * w / 2)
        self.face([(a[0], y - 0.6, a[1]), (b[0], y - 0.6, b[1]), (b[0], y + hgt, b[1]), (a[0], y + hgt, a[1])], MAT_FACADE,
                  [(0.33, 0.1), (0.67, 0.1), (0.67, 0.9), (0.33, 0.9)], (PART_COL["upper"], STYLE_ROW[style]), (-nx, 0, -nz))
        self.box(x, y + hgt + 0.15, z, w + 0.3, 0.3, d, ux, uz, MAT_ROOF, ROOF_CELL["slate"], 0.9)

    def gable(self, h, P, s0, s1, t, H, rise, front, street, style, rng):
        """The wall triangle above the eaves, with its outline: stepped, bell (spout) or plain."""
        W = s1 - s0
        sm = (s0 + s1) / 2
        kind = h["gable"] if front else "plain"
        tt = t - 0.02 if front else t + 0.02
        if kind == "step":
            k = max(3, min(6, int(W / 1.3)))
            dw = (W / 2) / (k + 0.4)
            pts = [(s0, 0.0)]
            for i in range(k):
                x_in = s0 + (i + 1) * dw
                y_top = (x_in - s0) * rise / (W / 2) + 0.45
                pts += [(s0 + i * dw, y_top), (x_in, y_top)]
            top = rise + 1.0
            pts += [(sm - dw * 0.4, top), (sm + dw * 0.4, top)]
            right = [(s1 - (x - s0), y) for x, y in reversed(pts[1:-2])]
            pts += right + [(s1, 0.0)]
        elif kind == "spout":
            n = 7
            neck = W * 0.2
            pts = [(s0, 0.0)]
            for i in range(1, n + 1):
                f = i / n
                x = s0 + (sm - neck / 2 - s0) * (1 - (1 - f) ** 2)
                pts.append((x, rise * 0.78 * f + 0.25))
            pts += [(sm - neck / 2, rise * 1.02), (sm, rise * 1.18), (sm + neck / 2, rise * 1.02)]
            for i in range(n, 0, -1):
                f = i / n
                x = s1 - (s1 - (sm + neck / 2)) * (1 - (1 - f) ** 2)
                pts.append((x, rise * 0.78 * f + 0.25))
            pts.append((s1, 0.0))
        else:
            pts = [(s0, 0.0), (sm, rise + 0.18), (s1, 0.0)]
        out = (-h["n"][0], 0, -h["n"][1]) if front else (h["n"][0], 0, h["n"][1])
        world = []
        uvs = []
        for s, y in pts:
            wx, wz = P(s, tt)
            world.append((wx, H + y, wz))
            uvs.append(((s - s0) / BAY, (H - self.gh) / self.sh + y / self.sh))
        part = "upper" if street else "blind"
        cell = (PART_COL[part], STYLE_ROW[style])
        self.ngon(world, uvs, cell, out)
        # the back of the gable, so the steps do not vanish when seen from the roof side
        back = [(p[0] + h["n"][0] * 0.25 * (1 if front else -1), p[1], p[2] + h["n"][1] * 0.25 * (1 if front else -1)) for p in world]
        self.ngon(back, uvs, (PART_COL["blind"], STYLE_ROW[style]), (-out[0], 0, -out[2]))
        if kind == "step":
            # coping stones on each step
            for i in range(1, len(pts) - 1, 2):
                (sa, ya), (sb, yb) = pts[i], pts[i + 1]
                if abs(ya - yb) < 1e-3 and abs(sb - sa) > 0.1:
                    cx, cz = P((sa + sb) / 2, tt + (0.12 if front else -0.12))
                    self.box(cx, H + ya + 0.08, cz, abs(sb - sa) + 0.1, 0.16, 0.45, h["u"][0], h["u"][1], MAT_STONE, (0, 0), 0.95)

    def ngon(self, world, uvs, cell, out):
        verts = [self.bm.verts.new(B(*p)) for p in world]
        try:
            f = self.bm.faces.new(verts)
        except ValueError:
            return
        f.material_index = MAT_FACADE
        f.normal_update()
        if f.normal.dot(B(*out)) < 0:
            f.normal_flip()
        for loop in f.loops:
            i = verts.index(loop.vert)
            loop[self.uv].uv = uvs[i]
            loop[self.cell].uv = cell
            g = 0.66 + 0.34 * min(1.0, world[i][1] / 9.0)
            loop[self.col] = (self.tint[0] * g, self.tint[1] * g, self.tint[2] * g, 1.0)

    def flat_top(self, ring, H, street, outs, style):
        """Flat roof behind a low parapet: walls already built; a lip and a top."""
        top = [(x, H + 0.1, z) for x, z in ring]
        n = len(ring)
        uvs = [(x / BAY, z / BAY) for x, z in ring]
        self.face(top, MAT_ROOF, uvs, ROOF_CELL["flat"], (0, 1, 0), shade=0.9)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            self.wall(a, b, H, H + 0.6, style, False, outs[i] if i < len(outs) else (0, 0, 0))

    def poly_house(self, h, rng):
        fp = h["fp"]
        H = h["h"]
        n = len(fp)
        area = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n))
        outs = []
        lens = [math.hypot(fp[(i + 1) % n][0] - fp[i][0], fp[(i + 1) % n][1] - fp[i][1]) * h["street"][i] for i in range(n)]
        door_i = max(range(n), key=lambda i: lens[i])
        for i in range(n):
            a, b = fp[i], fp[(i + 1) % n]
            dx, dz = b[0] - a[0], b[1] - a[1]
            L = math.hypot(dx, dz) or 1
            ox, oz = dz / L, -dx / L
            if area < 0:
                ox, oz = -ox, -oz
            outs.append((ox, 0, oz))
            self.wall(a, b, 0, H, h["style"], h["street"][i], outs[-1], door=(i == door_i and lens[i] > 2))
        # a hipped roof: every eave edge slopes up to one point over the middle
        # (corner plots are odd shapes; old Antwerp had almost no flat roofs)
        cx = sum(p[0] for p in fp) / n
        cz = sum(p[1] for p in fp) / n
        rise = min(5.0, 0.45 * math.sqrt(abs(area) / 2))
        cell = ROOF_CELL[h["roofMat"]]
        for i in range(n):
            a, b = fp[i], fp[(i + 1) % n]
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            d = abs((b[0] - a[0]) * (cz - a[1]) - (b[1] - a[1]) * (cx - a[0])) / (L or 1)
            slope = math.hypot(d, rise)
            self.face([(a[0], H, a[1]), (b[0], H, b[1]), (cx, H + rise, cz)], MAT_ROOF,
                      [(0, 0), (L / BAY, 0), (L / 2 / BAY, slope / BAY)], cell, (outs[i][0], 1.0, outs[i][2]), shade=1.0)
        # a cornice under the eaves on the street sides
        for i in range(n):
            if h["street"][i]:
                a, b = fp[i], fp[(i + 1) % n]
                L = math.hypot(b[0] - a[0], b[1] - a[1])
                if L > 1:
                    ux, uz = (b[0] - a[0]) / L, (b[1] - a[1]) / L
                    mx, mz = (a[0] + b[0]) / 2 + outs[i][0] * 0.15, (a[1] + b[1]) / 2 + outs[i][2] * 0.15
                    self.box(mx, H - 0.2, mz, L, 0.35, 0.35, ux, uz, MAT_STONE, (0, 0), 0.85)

    def back(self, b):
        fp = b["fp"]
        H = b["h"]
        self.tint = (0.8, 0.78, 0.76)
        n = len(fp)
        area = sum(fp[i][0] * fp[(i + 1) % n][1] - fp[(i + 1) % n][0] * fp[i][1] for i in range(n))
        for i in range(n):
            a, c = fp[i], fp[(i + 1) % n]
            dx, dz = c[0] - a[0], c[1] - a[1]
            L = math.hypot(dx, dz) or 1
            ox, oz = dz / L, -dx / L
            if area < 0:
                ox, oz = -ox, -oz
            self.wall(a, c, 0, H, "brick_dark", False, (ox, 0, oz))
        verts = [self.bm.verts.new(B(x, H, z)) for x, z in fp]
        try:
            f = self.bm.faces.new(verts)
            f.material_index = MAT_ROOF
            f.normal_update()
            if f.normal.dot(B(0, 1, 0)) < 0:
                f.normal_flip()
            for loop in f.loops:
                i = verts.index(loop.vert)
                loop[self.uv].uv = (fp[i][0] / BAY, fp[i][1] / BAY)
                loop[self.cell].uv = ROOF_CELL["tile"]
                loop[self.col] = (0.7, 0.66, 0.64, 1)
        except ValueError:
            pass

    def to_object(self, name, mats):
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        return ob


def material(name, rgb):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    bsdf = m.node_tree.nodes.get("Principled BSDF")
    if bsdf:
        bsdf.inputs["Base Color"].default_value = (*rgb, 1)
        bsdf.inputs["Roughness"].default_value = 1.0
    return m


def main():
    data = json.load(open(SRC))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = [material("facade", (0.55, 0.35, 0.28)), material("roof", (0.35, 0.22, 0.18)), material("stone", (0.6, 0.58, 0.52))]
    chunks = {}

    def chunk_of(pts):
        cx = sum(p[0] for p in pts) / len(pts)
        cz = sum(p[1] for p in pts) / len(pts)
        key = (math.floor(cx / CHUNK), math.floor(cz / CHUNK))
        if key not in chunks:
            chunks[key] = Builder(data["ground_h"], data["storey_h"])
        return chunks[key]

    for h in data["houses"]:
        rng = random.Random(h["seed"])
        chunk_of(h["fp"]).house(h, rng)
    for b in data["backs"]:
        chunk_of(b["fp"]).back(b)
    count = 0
    for (i, j), bld in sorted(chunks.items()):
        bld.to_object(f"city_{i}_{j}", mats)
        count += 1
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    kwargs = dict(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                  export_materials="EXPORT", export_apply=False, use_selection=False,
                  export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
                  export_draco_position_quantization=16, export_draco_texcoord_quantization=12,
                  export_draco_color_quantization=8, export_draco_normal_quantization=8)
    try:
        bpy.ops.export_scene.gltf(**kwargs, export_vertex_color="ACTIVE", export_all_vertex_colors=True)
    except TypeError:
        bpy.ops.export_scene.gltf(**kwargs, export_colors=True)
    faces = sum(len(o.data.polygons) for o in bpy.context.scene.objects)
    print(f"[build_city] {len(data['houses'])} houses, {len(data['backs'])} backs, {count} chunks, {faces} faces -> {OUT} ({os.path.getsize(OUT)//1024} KB)")


if __name__ == "__main__":
    main()
