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

# A closed jacket replaces only the blouse arm panels. The blouse front and
# the coat's own arm/trunk weights and identity shapes must remain intact.
jacket = planes("jef_w_jacket_fixture", [
    (0, 0.3, "bodice", "armLowL"), (0.002, 0.3, "bodice", "armLowR"),
    (0.003, 0.2, "coat", "handL"), (0.003, 0.2, "coat", "hips"),
    (0, 0.3, "bodice", "chest")])
jacket.vertex_groups.new(name="zone_arm").add(list(range(12)), 1, "REPLACE")
jacket.shape_key_add(name="Basis")
jacket_shape = jacket.shape_key_add(name="identity")
for i in range(8, 12):
    jacket_shape.data[i].co += Vector((0.01, 0.02, 0.03))
fit.bind_apron(jacket)
assert len(jacket.data.polygons) == 3
raw, zones = wt.parts(jacket), cb.zones_of(jacket)
assert sum(p == "bodice" for p in raw) == 4
for i, (part, zone) in enumerate(zip(raw, zones)):
    if part == "coat" and zone == "arm":
        assert jacket.vertex_groups["handL"].weight(i) > .999
        assert (jacket_shape.data[i].co - jacket.data.vertices[i].co
                - Vector((0.01, 0.02, 0.03))).length < 1e-6
blouse_only = planes("blouse_only", [(0, .3, "bodice", "armLowL")])
blouse_only.vertex_groups.new(name="zone_arm").add(list(range(4)), 1, "REPLACE")
fit.covered_blouse_sleeves(blouse_only)
assert len(blouse_only.data.polygons) == 1

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

# A nearer sleeve must not steal a hand's weights during far-LOD transfer.
from people2.motion import match_lod_weights
source = planes("part_weight_source", [
    (0, 0.3, "armL", "handL"), (0.004, 0.3, "coat", "armLowL")])
target = planes("part_weight_target", [(0.003, 0.2, "armL", "armUpL")])
match_lod_weights(source, target)
result = wt.read(target)
assert np.all(result[:, NAMES.index("handL")] > 0.999)
assert np.all(result[:, NAMES.index("armLowL")] < 1e-6)
print("PASS: far skin weights come from the same part, never adjacent cloth")

# Joining a rebuilt apron introduces an apron-only cage mask. It cannot be
# reused as a deletion mask for the already finished blouse and skirt.
from people2.cloth_lod import from_near
source = planes("finished_cloth", [
    (0, 0.3, "bodice", "chest"), (0.2, 0.3, "skirt", "hips"),
    (0.3, 0.2, "apron", "hips")])
source.data.uv_layers.new(name="UVMap")
mask = source.data.attributes.new("cloth_outer", "INT", "FACE")
mask.data[2].value = 1
target = planes("far_cloth", [(0, 0.3, "bodice", "chest")])
from_near(target, source, 30)
assert set(wt.parts(target)) == {"bodice", "skirt", "apron"}
assert cb.tris(target) == 6
assert target.data.uv_layers.get("UVMap") is not None
print("PASS: distant clothes retain all garments and UVs after an apron rebuild")

# A far forearm face spans the cuff. Clip its covered portion, interpolating
# both its skin weights and its identity shape instead of removing the hand.
from people2.cloth_lod import clip_cuffs
armature = bpy.data.objects.new("cuff_rig", bpy.data.armatures.new("cuff_rig"))
bpy.context.scene.collection.objects.link(armature)
bpy.context.view_layer.objects.active = armature
armature.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
bone = armature.data.edit_bones.new("armLowL")
bone.head, bone.tail = (0, 0, 1), (0, 0, 0)
bpy.ops.object.mode_set(mode="OBJECT")
skin = planes("long_forearm", [(0, 0.1, "armL", "armLowL")])
skin.parent = armature
for i, v in enumerate(skin.data.vertices):
    v.co.y = 0
    v.co.z = 0 if i < 2 else 1
skin.shape_key_add(name="Basis")
identity = skin.shape_key_add(name="identity")
for v in identity.data:
    v.co.x += 0.02
cuff = planes("cuff", [(0.25, 0.12, "coat", "armLowL")])
cuff.vertex_groups.new(name="zone_arm").add(list(range(4)), 1, "REPLACE")
clip_cuffs(skin, cuff)
assert len(skin.data.polygons) == 1
assert max(v.co.z for v in skin.data.vertices) <= 0.27001
assert min(v.co.z for v in skin.data.vertices) == 0
basis, identity = skin.data.shape_keys.key_blocks
assert all(abs((b.co - a.co).x - 0.02) < 1e-6 for a, b in zip(basis.data, identity.data))
assert np.all(wt.read(skin)[:, NAMES.index("armLowL")] > 0.999)
print("PASS: cuff clipping keeps exposed hands and interpolates identity shapes and weights")

# Closely overlapping folds must retain their own rig and identity motion,
# even when the other fold is nearer than their original 3 mm facing depth.
folds = planes("crossing_folds", [(0, .3, "apron", "hips"), (-.002, .3, "apron", "chest")])
folds.vertex_groups.new(name="part_in_apron")
fit.line(folds)
folds.shape_key_add(name="Basis")
identity = folds.shape_key_add(name="identity")
pair = folds.data.attributes["_facing_pair"]
raw = wt.parts(folds)
outer = {pair.data[i].value: i for i, part in enumerate(raw) if part == "apron"}
for i in outer.values():
    identity.data[i].co.x += .01 if i < 4 else -.02
fit.fit_linings(folds)
weights = wt.read(folds)
for i, part in enumerate(raw):
    if part != "in_apron":
        continue
    j = outer[pair.data[i].value]
    assert np.max(np.abs(weights[i] - weights[j])) < 1e-6
    assert abs((identity.data[i].co - folds.data.vertices[i].co).x
               - (identity.data[j].co - folds.data.vertices[j].co).x) < 1e-6
print("PASS: exact facing pairs keep overlapping folds' own weights and identity offsets")

# A shirt needs the same mixed shoulder coverage as a closed blouse.
shoulder = planes("shirt_shoulder", [(0, .2, "armL", "armUpL")])
shoulder.vertex_groups["part_armL"].remove([0])
shoulder.vertex_groups.new(name="part_neck").add([0], 1, "REPLACE")
shirt = planes("closed_shirt", [(1, .3, "shirt", "chest")])
assert ck.cut_body(shoulder, lambda p, n: n.startswith("arm"), shirt) == 1
print("PASS: closed shirts remove mixed neck/arm shoulder fragments")

# Knee-row cuts must not interpolate lining IDs into unrelated skirt folds.
from people2.cloth_drape import skirt_bends
from types import SimpleNamespace
skirt = planes("bisected_skirt", [(0, .3, "skirt", "hips"), (.05, .2, "apron", "hips")])
for v in skirt.data.vertices:
    v.co = Vector((v.co.x, v.co.z, v.co.y + .5))
skirt.data.update()
for part in ("skirt", "apron"):
    skirt.vertex_groups.new(name="part_in_" + part)
fit.line(skirt)
skirt_bends(skirt, SimpleNamespace(knee_y=.5))
raw = wt.parts(skirt)
pair = skirt.data.attributes["_facing_pair"]
outer = {(part, pair.data[i].value): i for i, part in enumerate(raw) if not part.startswith("in_")}
for i, part in enumerate(raw):
    if not part.startswith("in_"):
        continue
    j = outer[(part[3:], pair.data[i].value)]
    assert abs((skirt.data.vertices[i].co - skirt.data.vertices[j].co).length - .003) < 1e-6
print("PASS: skirt knee cuts rebuild exact facing pairs without crossing folds")

# Garment coverage owns a closed shoulder even where a coarse torso ray misses.
shoulder = planes("torso_shoulder", [(0, .2, "torso", "chest")])
shoulder.vertex_groups["part_torso"].remove([0])
shoulder.vertex_groups.new(name="part_armL").add([0], 1, "REPLACE")
assert ck.cut_body(shoulder, lambda p, n: n == "armL", bodice) == 1
print("PASS: closed shoulder coverage survives coarse torso ray misses")

# A child's hat changes only the hair pick, preserving the seeded face and RNG draw order.
from people2 import face_types as ft, mhhair
before = ft.face_for(1873, "test_hatted_child", "m", 9)
ft.register_hats([SimpleNamespace(name="test_hatted_child", hats=("cap",), face={"sex":"m"})])
after = ft.face_for(1873, "test_hatted_child", "m", 9)
assert before["sliders"] == after["sliders"] and before["cell"] == after["cell"]
assert after["hair"] == "capped" and "capped" in mhhair.styles_for("child")[0]
print("PASS: child hat recipes preserve seeded faces and use an available capped mesh")

# A shoulder pad clipped from the shirt shares exact body shapes and skinning.
from people2.cloth_drape import pad_surface, carry_apron
panel = planes("supported_pad", [(0, .3, "shirt", "chest"), (.03, .2, "pad", "shoulderL")])
for v in panel.data.vertices:
    x, y, z = v.co
    v.co = Vector((x if v.index < 4 else .05 + (x + .2) * .375, -z, y + .6 if v.index < 4 else y + .8))
panel.data.update()
assert pad_surface(panel)
raw = wt.parts(panel)
assert min(v.co.z for v in panel.data.vertices if raw[v.index] == "pad") >= .5999
assert max(v.co.x for v in panel.data.vertices if raw[v.index] == "pad") >= .2999
panel.shape_key_add(name="Basis")
identity = panel.shape_key_add(name="identity")
for i, part in enumerate(raw):
    if part == "shirt":
        identity.data[i].co.x += .02
assert carry_apron(panel, "pad", "shirt")
w = wt.read(panel)
for i, part in enumerate(raw):
    if part in ("pad", "in_pad"):
        assert abs(w[i, NAMES.index("chest")] - 1) < 1e-6
        assert abs((identity.data[i].co - panel.data.vertices[i].co).x - .02) < 1e-6
print("PASS: fitted shoulder pads share shirt triangles, weights and identity shapes")

# A sewn fringe follows the same boundary after fitting, animation and identity changes.
wrap = planes("sewn_fringe", [(0, .2, "shawl", "chest"), (0, .2, "shawl_fringe", "hips")])
for i, point in enumerate(((-.2,0,.4),(.2,0,.4),(.2,0,.6),(-.2,0,.6),
                           (-.2,-.004,.404),(.2,-.004,.404),(.2,-.004,.35),(-.2,-.004,.35))):
    wrap.data.vertices[i].co = Vector(point)
wrap.data.update()
wrap.shape_key_add(name="Basis")
identity = wrap.shape_key_add(name="identity")
sew = fit.fringe_binding(wrap)
for i in range(4):
    wrap.data.vertices[i].co.x += .1
    wrap.data.shape_keys.reference_key.data[i].co.x += .1
    identity.data[i].co.x += .1
    identity.data[i].co.y += .02
sew()
w = wt.read(wrap)
for i in range(4,8):
    assert abs(w[i, NAMES.index("chest")] - 1) < 1e-6
    assert abs((identity.data[i].co - wrap.data.vertices[i].co).y - .02) < 1e-6
    assert abs(wrap.data.vertices[i].co.x - (-.1 if i in (4,7) else .3)) < 1e-6
print("PASS: sewn fringe retains its edge's fitting, weights and identity offsets")

# A bonnet's authored full back survives reduction instead of becoming an edge strip.
hat = ck.Piece('bonnet_fixture', ck.Cloth((.5,.5,.5)), hat=True)
hat.grid(np.array([[ (x, y, 0) for x in np.linspace(-.2,.2,5)] for y in np.linspace(-.2,.2,5)]), lambda p: {'head':1})
ck.thicken(hat, .003, depth=None)
bonnet, _ = ck.build_objects([hat], 'full_bonnet_fixture')
fit.strip(bonnet)
import bmesh
bm = bmesh.new(); bm.from_mesh(bonnet.data)
jobs = list(fit.plans(bonnet, bm))
assert len(jobs) == 1 and len(jobs[0][3]) == len(jobs[0][1]) == 16
bm.free()
print('PASS: authored full bonnet backs remain complete after shell reduction')

# A coarse neck triangle straddling the bodice must keep only the exposed part.
from people2.cloth_masks import skin_below_neckline
neck_mesh = planes('neck_fixture_lod1', [(1, .05, 'bodice', 'chest'), (1, .04, 'neck', 'neck')])
for i, point in enumerate(((-.04,0,.8),(.04,0,.8),(.04,0,1.2),(-.04,0,1.2)), 4):
    neck_mesh.data.vertices[i].co = Vector(point)
neck_mesh.shape_key_add(name='Basis')
identity = neck_mesh.shape_key_add(name='identity')
for v in identity.data:
    v.co.x += .01
arm = bpy.data.armatures.new('neck_fixture_rig')
arm_ob = bpy.data.objects.new('neck_fixture_rig', arm)
bpy.context.scene.collection.objects.link(arm_ob)
bpy.context.view_layer.objects.active = arm_ob
arm_ob.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
bone = arm.edit_bones.new('neck')
bone.head, bone.tail = (0,0,1), (0,0,1.2)
bpy.ops.object.mode_set(mode='OBJECT')
neck_mesh.parent = arm_ob
skin_below_neckline(neck_mesh)
raw = wt.parts(neck_mesh)
neck_points = [v for v in neck_mesh.data.vertices if raw[v.index] == 'neck']
assert neck_points and min(v.co.z for v in neck_points) >= .97999
assert max(v.co.z for v in neck_points) >= 1.19999
basis, identity = neck_mesh.data.shape_keys.key_blocks
for v in neck_points:
    assert abs((identity.data[v.index].co - basis.data[v.index].co).x - .01) < 1e-6
print('PASS: neckline clipping preserves exposed neck and interpolated identity shapes')

# The coarse shawl must remain a broad panel, not collapse into a narrow cord.
far_wrap = planes('wrap_fixture_lod1', [(1, .2, 'shawl', 'chest')])
fit.soften_wrap(far_wrap)
span = max(v.co.x for v in far_wrap.data.vertices) - min(v.co.x for v in far_wrap.data.vertices)
assert span >= .30, ('far shawl lost its width', span)
print('PASS: far shawl relaxation preserves its panel width')


# Hidden scalp is cut only below a full brim; a partial peak keeps the head intact.
from people2.cloth_masks import covered_hat_scalp
import math
for full in (False, True):
    verts, faces = [], []
    for z in (.9, 1.2):
        verts.extend((.08*math.cos(a), .08*math.sin(a), z) for a in np.arange(16)*2*math.pi/16)
    faces.extend((j,(j+1)%16,(j+1)%16+16,j+16) for j in range(16))
    angles = np.arange(16)*2*math.pi/16 if full else np.linspace(-.7,.7,16)
    for radius in (.12, .18):
        verts.extend((radius*math.cos(a),radius*math.sin(a),1.0) for a in angles)
    faces.extend((32+j,32+(j+1)%16,48+(j+1)%16,48+j) for j in range(16 if full else 15))
    mesh=bpy.data.meshes.new('scalp_fixture');mesh.from_pydata(verts,[],faces);mesh.update()
    scalp=bpy.data.objects.new('scalp_fixture',mesh);bpy.context.scene.collection.objects.link(scalp)
    scalp.vertex_groups.new(name='part_head').add(list(range(32)),1,'REPLACE')
    scalp.vertex_groups.new(name='part_cap_peak').add(list(range(32,64)),1,'REPLACE')
    scalp.shape_key_add(name='Basis');identity=scalp.shape_key_add(name='identity')
    for v in identity.data:v.co.x+=.01
    scalp.parent=arm_ob
    bpy.context.view_layer.objects.active=arm_ob
    bpy.ops.object.mode_set(mode='EDIT')
    if 'head' not in arm.edit_bones:
        bone=arm.edit_bones.new('head');bone.head=(0,0,.9);bone.tail=(0,0,1.2)
    bpy.ops.object.mode_set(mode='OBJECT')
    covered_hat_scalp(scalp,('cap','cap_peak'))
    raw=wt.parts(scalp)
    top=max(v.co.z for v in mesh.vertices if raw[v.index]=='head')
    assert abs(top-(.994 if full else 1.2))<1e-6, (full,top)
    basis,identity=mesh.shape_keys.key_blocks
    for i in range(len(mesh.vertices)):
        assert abs((identity.data[i].co-basis.data[i].co).x-.01)<1e-6
print('PASS: full-brim scalp coverage preserves exposed heads, peaks and identity interpolation')

# A drooping rain brim must not remove the face beneath its crown. Keep the
# eye envelope even if an unusually low crown would otherwise overlap it.
for crown in (1.10, 1.02):
    verts, faces = [], []
    for z in (.9, 1.2):
        verts.extend((.08*math.cos(a), .08*math.sin(a), z) for a in np.arange(16)*2*math.pi/16)
    faces.extend((j,(j+1)%16,(j+1)%16+16,j+16) for j in range(16))
    for radius,z in ((.12,crown),(.18,.95)):
        verts.extend((radius*math.cos(a),radius*math.sin(a),z) for a in np.arange(16)*2*math.pi/16)
    faces.extend((32+j,32+(j+1)%16,48+(j+1)%16,48+j) for j in range(16))
    mesh=bpy.data.meshes.new('rain_hat_fixture');mesh.from_pydata(verts,[],faces);mesh.update()
    scalp=bpy.data.objects.new('rain_hat_fixture',mesh);bpy.context.scene.collection.objects.link(scalp)
    scalp.vertex_groups.new(name='part_head').add(list(range(32)),1,'REPLACE')
    scalp.vertex_groups.new(name='part_hat_brim').add(list(range(32,64)),1,'REPLACE')
    scalp.parent=arm_ob
    bpy.context.view_layer.objects.active=arm_ob
    bpy.ops.object.mode_set(mode='EDIT')
    bone=arm.edit_bones.get('eyeL') or arm.edit_bones.new('eyeL')
    bone.head=(0,0,1.03);bone.tail=(0,0,1.04)
    bpy.ops.object.mode_set(mode='OBJECT')
    covered_hat_scalp(scalp,('hat_brim',))
    raw=wt.parts(scalp)
    top=max(v.co.z for v in mesh.vertices if raw[v.index]=='head')
    assert abs(top-max(crown-.006,1.035))<1e-6, (crown,top)
print('PASS: sloping rain brim retains the forehead and eye envelope')

# Final shawl cleanup must keep a broad panel while removing small alternating ridges.
pc=ck.Piece('shawl',ck.Cloth((.5,.5,.5)))
points=np.array([[(x,y,.006*(-1)**j if 0<j<24 else 0) for j,x in enumerate(np.linspace(-.3,.3,25))] for y in np.linspace(-.1,.1,9)])
pc.grid(points,lambda p:{'chest':1})
wrap,_=ck.build_objects([pc],'finish_wrap_fixture_lod0')
count=len(wrap.data.polygons)
fit.finish_wrap(wrap)
xs=[v.co.x for v in wrap.data.vertices];ys=[v.co.z for v in wrap.data.vertices]
assert max(xs)-min(xs)>.5 and max(ys)-min(ys)>.15
assert len(wrap.data.polygons)==count
assert max(abs(v.co.y) for v in wrap.data.vertices)<.003
print('PASS: final shawl cleanup removes ridges while preserving panel width and triangle count')

# A closed cape's neckline smooths locally; its hanging lower edge stays authored.
pc=ck.Piece('shawl',ck.Cloth((.5,.5,.5)))
angles=np.arange(32)*2*math.pi/32
points=np.array([[(.2*math.cos(a),height+(.012*(-1)**j if k==2 else 0),.15*math.sin(a)) for j,a in enumerate(angles)] for k,height in enumerate((.8,.9,1.0))])
pc.grid(points,lambda p:{'chest':1},closed=True)
cape,_=ck.build_objects([pc],'cape_rim_fixture_lod0')
cape.shape_key_add(name='Basis');identity=cape.shape_key_add(name='identity')
for v in identity.data:v.co.x+=.02
bottom=[v.co.copy() for v in cape.data.vertices[:32]]
fit.finish_cape_rim(cape)
assert max(v.co.z for v in cape.data.vertices[64:96])-min(v.co.z for v in cape.data.vertices[64:96])<.003
assert all((cape.data.vertices[i].co-bottom[i]).length<1e-7 for i in range(32))
for a,b in zip(cape.data.shape_keys.reference_key.data,identity.data):assert abs((b.co-a.co).x-.02)<1e-6
print('PASS: closed cape neckline keeps its hem and identity offsets')
