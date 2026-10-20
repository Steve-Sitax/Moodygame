"""Blender regressions for clothing fitting; run with --background --factory-startup --python-exit-code 1 -P."""

import os
import sys

import bpy
import numpy as np
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from people2 import cloth_fit as fit, clothes_build as cb, weights as wt


def planes(name, rows):
    vertices, faces = [], []
    for z, radius, part, bone in rows:
        start = len(vertices)
        vertices += [
            (-radius, -radius, z),
            (radius, -radius, z),
            (radius, radius, z),
            (-radius, radius, z),
        ]
        faces.append(tuple(start + i for i in range(4)))
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    ob = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(ob)
    for k, (_, _, part, bone) in enumerate(rows):
        for group in ("part_" + part, bone):
            vg = ob.vertex_groups.get(group) or ob.vertex_groups.new(name=group)
            vg.add(list(range(k * 4, k * 4 + 4)), 1, "REPLACE")
    return ob


# Trousers are closer than the sleeve. They must not pull an arm away from its sleeve.
cloth = planes(
    "cloth", [(0, 0.3, "sleeve", "armLowL"), (0.002, 0.3, "trousers", "hips")]
)
body = planes(
    "body",
    [
        (0.003, 0.2, "armL", "armLowL"),
        (0.003, 0.2, "armR", "armLowR"),
        (0.003, 0.2, "finger_thumbL", "thumb1L"),
    ],
)
body.shape_key_add(name="Basis")
key = body.shape_key_add(name="identity")
offset = Vector((0.002, -0.001, 0.004))
for vertex in key.data:
    vertex.co += offset
before = [v.co.copy() for v in body.data.vertices]
fit.tuck_skin(body, cloth)
for i, vertex in enumerate(body.data.vertices):
    if i < 4:
        assert abs(vertex.co.z + 0.008) < 1e-6, ("wrong limb selected", i, vertex.co)
    else:
        assert (vertex.co - before[i]).length < 1e-6, ("exposed skin moved", i)
    basis, shape = body.data.shape_keys.key_blocks
    assert (basis.data[i].co - vertex.co).length < 1e-6
    assert (shape.data[i].co - basis.data[i].co - offset).length < 1e-6

# An open sleeve edge must not attract exposed skin beside it.
edge = planes("edge", [(0.003, 0.4, "armL", "armLowL")])
before = [v.co.copy() for v in edge.data.vertices]
fit.tuck_skin(edge, cloth)
assert all((v.co - p).length < 1e-6 for v, p in zip(edge.data.vertices, before))

# Rebuild the facing from the final outer shell, retaining priorities and exact bone weights.
shell = planes(
    "fixture_clothes_lod0",
    [(0, 0.2, "coat", "armLowL"), (-0.02, 0.2, "in_coat", "hips")],
)
shell.data.polygons[1].flip()
shell.data.update()
priorities = np.arange(8, dtype=float) / 10
kept = fit.strip(shell, priorities)
assert np.array_equal(kept, priorities[:4]), ("priority remapping", kept)
fit.reduce_lined(shell, 20, cb._reduce_surface, weights=kept)
assert cb.tris(shell) == 12
raw = wt.parts(shell)
weights = wt.read(shell)
outer = [v for v in shell.data.vertices if raw[v.index] == "coat"]
for vertex in shell.data.vertices:
    if raw[vertex.index] != "in_coat":
        continue
    source = min(outer, key=lambda v: (v.co - vertex.co).length_squared)
    assert (source.co - vertex.co - Vector((0, 0, 0.003))).length < 1e-6
    assert np.max(np.abs(weights[source.index] - weights[vertex.index])) < 1e-6
# A hide mask must retain the cuff opening, but may remove skin well inside the sleeve.
sleeve = planes("open_sleeve", [(0, 0.2, "sleeve", "armLowL")])
arm = planes(
    "arm_mask", [(-0.008, 0.19, "armL", "armUpL"), (-0.008, 0.1, "armL", "armLowL")]
)
covered = np.ones(8, dtype=bool)
fit.protect_openings(arm, sleeve, covered)
assert not covered[:4].any() and covered[4:].all(), ("opening mask", covered)

# A cuff must bind to its own sleeve, even with a nearer coat tail beside it.
cuff = planes(
    "cuff_motion",
    [
        (0, 0.3, "coat", "armLowL"),
        (0.002, 0.3, "coat", "hips"),
        (0.003, 0.2, "cuffL", "handL"),
    ],
)
cuff.shape_key_add(name="Basis")
cuff_shape = cuff.shape_key_add(name="identity")
for i in range(4):
    cuff_shape.data[i].co += Vector((0.01, 0.02, 0.03))
fit.bind_layer(cuff, "cuffL", "coat", inset=True)
cw = wt.read(cuff)
for i in range(8, 12):
    assert abs(cuff.data.vertices[i].co.z + 0.012) < 1e-6
    assert np.max(np.abs(cw[i] - cw[0])) < 1e-6
    assert (
        cuff_shape.data[i].co - cuff.data.vertices[i].co - Vector((0.01, 0.02, 0.03))
    ).length < 1e-6

# A blouse sleeve uses the actual arm's weights and identity changes, without moving its trunk.
skin_arm = planes("blouse_skin", [(0, 0.3, "armL", "armLowL")])
skin_arm.shape_key_add(name="Basis")
skin_shape = skin_arm.shape_key_add(name="identity")
for vertex in skin_shape.data:
    vertex.co += Vector((0.01, 0.02, 0.03))
blouse = planes(
    "blouse_sleeve", [(0.003, 0.2, "bodice", "handL"), (0.003, 0.2, "bodice", "hips")]
)
blouse.shape_key_add(name="Basis")
blouse_shape = blouse.shape_key_add(name="identity")
fit.sleeve_binding(skin_arm)(blouse)
bw, sw = wt.read(blouse), wt.read(skin_arm)
for i in range(4):
    assert np.max(np.abs(bw[i] - sw[0])) < 1e-6
    assert abs(blouse.data.vertices[i].co.z - 0.014) < 1e-6
    assert (
        blouse_shape.data[i].co
        - blouse.data.vertices[i].co
        - Vector((0.01, 0.02, 0.03))
    ).length < 1e-6
assert abs(blouse.data.vertices[4].co.z - 0.003) < 1e-6

# A player jacket follows the blouse elbow, without pulling its skirt-facing
# trunk onto that blouse or borrowing the opposite arm's nearby weights.
jacket = planes(
    "jef_w_jacket_fixture",
    [
        (0, 0.3, "bodice", "armLowL"),
        (0.002, 0.3, "bodice", "armLowR"),
        (0.003, 0.2, "coat", "handL"),
        (0.003, 0.2, "coat", "hips"),
    ],
)
jacket.shape_key_add(name="Basis")
jacket_shape = jacket.shape_key_add(name="identity")
for i in range(4):
    jacket_shape.data[i].co += Vector((0.01, 0.02, 0.03))
fit.bind_apron(jacket)
jw = wt.read(jacket)
for i in range(8, 12):
    assert abs(jacket.data.vertices[i].co.z - 0.012) < 1e-6
    assert np.max(np.abs(jw[i] - jw[0])) < 1e-6
    assert (
        jacket_shape.data[i].co
        - jacket.data.vertices[i].co
        - Vector((0.01, 0.02, 0.03))
    ).length < 1e-6
assert abs(jacket.data.vertices[12].co.z - 0.003) < 1e-6

# A lining displaced outside its sleeve and still weighted to the hips must
# return inside and inherit the sleeve's identity displacement and elbow bend.
facing = planes(
    "posed_facing", [(0, 0.3, "coat", "armLowL"), (0.02, 0.2, "in_coat", "hips")]
)
facing.shape_key_add(name="Basis")
facing_shape = facing.shape_key_add(name="identity")
for i in range(4):
    facing_shape.data[i].co += Vector((0.01, 0.02, 0.03))
fit.fit_linings(facing)
fw = wt.read(facing)
for i in range(4, 8):
    assert abs(facing.data.vertices[i].co.z + 0.003) < 1e-6
    assert np.max(np.abs(fw[i] - fw[0])) < 1e-6
    assert (
        facing_shape.data[i].co
        - facing.data.vertices[i].co
        - Vector((0.01, 0.02, 0.03))
    ).length < 1e-6

# An apron retains its offset when a skirt bends and changes identity shape.
apron = planes(
    "apron_motion", [(0, 0.3, "skirt", "legUpL"), (0.04, 0.2, "apron", "hips")]
)
apron.shape_key_add(name="Basis")
seated = apron.shape_key_add(name="sit")
for i in range(4):
    seated.data[i].co += Vector((0.01, 0.02, -0.03))
fit.bind_apron(apron)
weights = wt.read(apron)
for i in range(4, 8):
    assert np.max(np.abs(weights[i] - weights[0])) < 1e-6
    assert (
        seated.data[i].co - apron.data.vertices[i].co - Vector((0.01, 0.02, -0.03))
    ).length < 1e-6
print(
    "PASS: limb isolation, opening masks, apron motion, shape offsets, priorities, facing thickness and weights"
)

# A long coat's sleeve may hang below hip height, but must never become a leg-weighted skirt.
from types import SimpleNamespace
from unittest.mock import patch
from people2 import garments_cast as cast

coat = SimpleNamespace(
    V=[np.array((0.2, 0.6, 0.0)), np.array((0.1, 0.6, 0.0))],
    W=[{"armLowL": 1.0}, {"hips": 1.0}],
    zone=["arm", "torso"],
    meta={"hem": 0.6},
)
with patch.object(cast.ck, "hang_weights", return_value={"legUpL": 1.0}) as hanging:
    cast.lengthen_coat(coat, SimpleNamespace(hip_y=0.9), 0.4)
assert coat.V[0][1] == 0.6 and coat.W[0] == {"armLowL": 1.0}
assert abs(coat.V[1][1] - 0.4) < 1e-6 and coat.W[1] == {"legUpL": 1.0}
assert hanging.call_count == 1
print("PASS: long-coat sleeves retain their coordinates and arm weights")


# A neck bone starts below the shoulders. A blouse cut at that joint left holes
# above both shoulders; the garment opening must instead clear their measured top.
from people2 import clothes_kit as ck
from people2.rig import NAMES

points, parts, triangles = [], [], []
for row, (height, radius, part) in enumerate(
    ((0.85, 0.18, "torso"), (1.30, 0.20, "torso"), (1.45, 0.05, "neck"))
):
    for col in range(8):
        angle = col * np.pi / 4
        points.append((radius * np.cos(angle), height, radius * np.sin(angle)))
        parts.append(part)
        if row:
            a = (row - 1) * 8 + col
            b = (row - 1) * 8 + (col + 1) % 8
            c = row * 8 + (col + 1) % 8
            d = row * 8 + col
            triangles.extend(((a, b, c), (a, c, d)))
co = np.asarray(points)
normals = co.copy()
normals[:, 1] = 0
normals /= np.linalg.norm(normals, axis=1)[:, None]
weights = np.zeros((len(points), len(NAMES)))
weights[:, NAMES.index("upperChest")] = 1
source = SimpleNamespace(
    S=co,
    SN=normals,
    SW=weights,
    Spart=np.asarray(parts),
    tris=np.asarray(triangles),
    rest=co,
    J={
        "neck": ((0, 1.27, 0), (0, 1.4, 0)),
        "handL": ((0.2, 0.7, 0), (0, 0, 0)),
        "handR": ((-0.2, 0.7, 0), (0, 0, 0)),
    },
    row=lambda _: list(range(8)),
)
blouse = ck.Piece("bodice", ck.Cloth((0.1, 0.1, 0.1)))
fit.skin_upper(source, blouse, (2, 9))
assert max(p[1] for p in blouse.V) > 1.30
edges = {}
for face in blouse.F:
    assert len(set(face)) == len(face) >= 3
    for a, b in zip(face, face[1:] + face[:1]):
        edge = tuple(sorted((a, b)))
        edges[edge] = edges.get(edge, 0) + 1
assert max(edges.values()) <= 2
print("PASS: measured shoulder coverage and manifold clipped blouse")


# Subdivision mixes part weights at a thin rim. Strip by authored face role,
# then rebuild without old rim fragments or interior tags on the outer shell.
from people2 import lod

sleeve = ck.Piece("coat", ck.Cloth((0.1, 0.1, 0.1)))
rings = np.array(
    [
        [(0.1 * np.cos(a), y, 0.1 * np.sin(a)) for a in np.arange(12) * np.pi / 6]
        for y in (0, 0.1, 0.2, 0.3)
    ]
)
sleeve.grid(rings, lambda _: {"armLowL": 1}, closed=True, seam_col=6)
sleeve.orient(lambda p: p - np.array((0, p[1], 0)))
ck.thicken(sleeve, 0.003, depth=0.035)
cage, _ = ck.build_objects([sleeve], "rim_fixture")
near = lod.subdivide(cage, "rim_fixture_clothes_lod0")
fit.strip(near)
assert not any((p or "").startswith("in_") for p in wt.parts(near))
inner_groups = {g.index for g in near.vertex_groups if g.name.startswith("part_in_")}
assert not any(
    g.group in inner_groups and g.weight > 0
    for v in near.data.vertices
    for g in v.groups
)
cb._reduce_surface(near, 120)
fit.line(near)
assert cb.island_census(near)[2] == 0
print(
    "PASS: subdivided rim roles survive stripping and relining without overlapping faces"
)

# Rebuilt facings must retain UV cuts. Projecting a joined outer/inner tube onto
# one plane paints lining triangles across the visible cloth.
ck.unwrap(near, {})
near.data.calc_loop_triangles()
raw = wt.parts(near)
uv = near.data.uv_layers["UVMap"].data
outer_uv, inner_uv = [], []
for triangle in near.data.loop_triangles:
    chart = np.array([uv[i].uv[:] for i in triangle.loops])
    parts = [raw[i] for i in triangle.vertices]
    if all(p == "coat" for p in parts):
        outer_uv.append(chart)
    elif all(p == "in_coat" for p in parts):
        inner_uv.append(chart)
for chart in outer_uv:
    centre = chart.mean(0)
    for inner in inner_uv:
        matrix = np.column_stack((inner[1] - inner[0], inner[2] - inner[0]))
        if abs(np.linalg.det(matrix)) < 1e-12:
            continue
        a, b = np.linalg.solve(matrix, centre - inner[0])
        assert not (a > 1e-5 and b > 1e-5 and a + b < 1 - 1e-5), (
            "Facing UV overlaps outer cloth"
        )
print("PASS: rebuilt facings unwrap separately from visible cloth")

# Adding the right boot must not reorient the left around the right boot's centre.
from people2 import garments_women as gw

feet = SimpleNamespace(P={"w": 1.0, "f": {"foot": 1.0}}, hip_x=0.10)
for build_boot in (gw.boots_light, ck.shoe):
    boots = ck.Piece("boots", ck.Cloth((0.1, 0.1, 0.1)))
    soles = ck.Piece("soles", ck.Cloth((0.1, 0.1, 0.1)))
    build_boot(feet, boots, soles, "L")
    left_faces = [tuple(f) for f in boots.F]
    build_boot(feet, boots, soles, "R")
    assert [tuple(f) for f in boots.F[: len(left_faces)]] == left_faces
print("PASS: adding the second boot preserves first-boot winding")

# The sole joins the boot at its edge; treating it as an enclosing layer crushes the toe.
boot_mesh, _ = ck.build_objects([boots, soles], "shoe_layer_fixture")
assert not any("soles" in pair for pair in ck.layer_order(boot_mesh))
# A lower garment beside an open edge must not be pulled down onto that edge.
edge_pair = planes(
    "edge_pair", [(0, 0.2, "upper", "hips"), (0.01, 0.21, "lower", "hips")]
)
before = [v.co.copy() for v in edge_pair.data.vertices]
cb.tuck(edge_pair, None, {("lower", "upper")}, lambda p, n: False)
assert all((v.co - p).length < 1e-6 for v, p in zip(edge_pair.data.vertices, before))
print("PASS: shoe welts and open garment edges are not enclosing layers")

# A closed boot replaces its covered foot; missing rays at the welt left skin spikes.
shod_foot = planes("shod_foot", [(0, 0.25, "legL", "footL")])
boot_cover = planes("boot_cover", [(0.005, 0.2, "boots", "footL")])
assert ck.cut_body(shod_foot, lambda p, n: True, boot_cover) == 1
bare_foot = planes("bare_foot", [(0, 0.25, "legL", "footL")])
assert ck.cut_body(bare_foot, lambda p, n: False, boot_cover) == 0
print("PASS: closed-boot coverage removes foot fragments while uncovered feet remain")

# A nearby fold must not steal the apron from its authored backing triangle.
from people2.cloth_drape import carry_apron
from people2.rig import NAMES

linked = planes(
    "linked_apron",
    [
        (0, 0.3, "skirt", "legUpL"),
        (0.02, 0.3, "skirt", "legLowR"),
        (0.025, 0.2, "apron", "hips"),
    ],
)
link = linked.data.attributes.new("_apron_under", "FLOAT_VECTOR", "POINT")
for i in range(8, 12):
    point = linked.data.vertices[i].co.copy()
    point.z = 0
    link.data[i].vector = point
linked.shape_key_add(name="Basis")
shape = linked.shape_key_add(name="sit")
for i in range(4):
    shape.data[i].co += Vector((0, 0, 0.1))
for i in range(4, 8):
    shape.data[i].co += Vector((0, 0.2, 0))
positions = [v.co.copy() for v in linked.data.vertices]
assert carry_apron(linked)
weights = wt.read(linked)
for i in range(8, 12):
    assert weights[i, NAMES.index("legUpL")] > 0.999
    assert (linked.data.vertices[i].co - positions[i]).length < 1e-6
    assert (shape.data[i].co - positions[i] - Vector((0, 0, 0.1))).length < 1e-6
print("PASS: the apron retains its authored skirt fold, pose offsets and geometry")

# Long reduced panels need knee rows before an apron is clipped from them.
# Otherwise a level apron hem inherits different thigh shares along each diagonal.
from people2.cloth_drape import skirt_bends, skirt_weights, apron_surface
from people2 import B, G

sk = ck.Piece("skirt", ck.Cloth((0.2, 0.2, 0.2)))
ap = ck.Piece("apron", ck.Cloth((0.8, 0.8, 0.8)))
for pc, low, high, z in ((sk, 0.1, 0.9, 0.2), (ap, 0.25, 0.8, 0.225)):
    for x, y in ((-0.2, low), (0.2, low), (0.2, high), (-0.2, high)):
        pc.add((x, y, z), {"hips": 1})
    pc.F.append((0, 1, 2, 3))
panel, _ = ck.build_objects([sk, ap], "knee_panel")
knee_fit = SimpleNamespace(hip_y=0.8, hip_x=0.1, knee_y=0.5)
skirt_bends(panel, knee_fit)
raw = wt.parts(panel)
for face in panel.data.polygons:
    if all(raw[i] == "skirt" for i in face.vertices):
        ys = [G(panel.data.vertices[i].co)[1] for i in face.vertices]
        for level in (0.25, 0.44, 0.5, 0.8):
            assert not (min(ys) < level - 1e-5 and max(ys) > level + 1e-5)
skirt_weights(panel, knee_fit)
assert apron_surface(panel)
assert carry_apron(panel)
raw = wt.parts(panel)
weights = wt.read(panel)
for i, p in enumerate(raw):
    if p == "apron" and G(panel.data.vertices[i].co)[1] < 0.26:
        assert (
            weights[i, NAMES.index("legUpL")] + weights[i, NAMES.index("legUpR")] < 1e-5
        )
print(
    "PASS: shared knee and hem rows prevent alternating thigh weights along the apron edge"
)

# A boundary quad can contain an uncovered neck corner and three covered arm
# corners. Keeping that whole quad leaves a skin wing through a closed blouse.
shoulder = planes("mixed_shoulder", [(0, 0.2, "armL", "armUpL")])
shoulder.vertex_groups["part_armL"].remove([0])
shoulder.vertex_groups.new(name="part_neck").add([0], 1, "REPLACE")
bodice = planes("closed_bodice", [(1, 0.3, "bodice", "chest")])
assert ck.cut_body(shoulder, lambda p, n: n.startswith("arm"), bodice) == 1
head = planes("visible_head", [(0, 0.2, "head", "head")])
assert ck.cut_body(head, lambda p, n: True, bodice) == 0
print("PASS: closed bodices remove mixed shoulder fragments while the head remains")
