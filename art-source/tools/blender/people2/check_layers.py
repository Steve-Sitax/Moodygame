"""Blender regression for cloth layering: run with --background --factory-startup --python-exit-code 1 -P this_file.
The lower garment's inward lining must follow its outer surface, never cross the garment above it.
"""
import os
import sys

import bpy
from mathutils import Matrix, Vector

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from people2 import clothes_kit as ck
from people2 import clothes_build as cb


def fixture(turn):
    verts, faces = [], []
    labels = ("lower", "in_lower", "upper", "in_upper")
    for k, (z, radius) in enumerate(((0, .2), (-.003, .2), (.002, .3), (-.001, .3))):
        verts.extend(turn @ Vector(p) for p in ((-radius, -radius, z), (radius, -radius, z),
                                               (radius, radius, z), (-radius, radius, z)))
        faces.append(tuple(4 * k + j for j in ((0, 1, 2, 3) if k % 2 == 0 else (3, 2, 1, 0))))
    mesh = bpy.data.meshes.new("layer_fixture")
    mesh.from_pydata(verts, [], faces)
    mesh.update()
    ob = bpy.data.objects.new("layer_fixture", mesh)
    bpy.context.scene.collection.objects.link(ob)
    for k, name in enumerate(labels):
        ob.vertex_groups.new(name="part_" + name).add(list(range(k * 4, k * 4 + 4)), 1, "REPLACE")
    ob.vertex_groups.new(name="hips").add(list(range(16)), 1, "REPLACE")
    ob.shape_key_add(name="Basis")
    shape = ob.shape_key_add(name="test_offset")
    offset = turn @ Vector((.012, -.008, .005))
    for v in shape.data:
        v.co += offset
    return ob, offset


def check(ob, turn, offset):
    mesh = ob.data
    inv = turn.inverted()
    co = [inv @ v.co for v in mesh.vertices]
    for i in range(4):
        assert co[i].z <= -.001999, ("lower outer clearance", i, co[i].z)
        assert abs(co[i].z - co[i + 4].z - .003) < 1e-6, ("lower thickness", i)
        assert abs(co[i + 8].z - co[i + 12].z - .003) < 1e-6, ("upper thickness", i)
        assert co[i + 8].z - co[i].z >= .005999, ("layer order", i)
    basis, shape = mesh.shape_keys.key_blocks
    for i, v in enumerate(mesh.vertices):
        assert (v.co - basis.data[i].co).length < 1e-6, ("Basis", i)
        assert (shape.data[i].co - basis.data[i].co - offset).length < 1e-6, ("shape offset", i)


for turn in (Matrix.Identity(3), Matrix.Rotation(.73, 3, 'X') @ Matrix.Rotation(-.41, 3, 'Y')):
    ob, offset = fixture(turn)
    before = [v.co.copy() for v in ob.data.vertices]
    ck.bind_linings(ob)()
    assert max((a - b.co).length for a, b in zip(before, ob.data.vertices)) < 1e-6
    ck.clear_layers(ob, None, {("lower", "upper")}, clearance=.006, passes=3)
    check(ob, turn, offset)
    cb.tuck(ob, None, {("lower", "upper")}, lambda *_: False)
    check(ob, turn, offset)
    bpy.data.objects.remove(ob, do_unlink=True)
# The outer triangle turns after binding; the lining follows its frame, not only its translation.
ob, offset = fixture(Matrix.Identity(3))
before = [v.co.copy() for v in ob.data.vertices]
carry = ck.bind_linings(ob)
turn = Matrix.Rotation(.63, 3, 'X') @ Matrix.Rotation(.28, 3, 'Z')
for i in list(range(4)) + list(range(8, 12)):
    delta = turn @ before[i] - before[i]
    ob.data.vertices[i].co += delta
    for key in ob.data.shape_keys.key_blocks:
        key.data[i].co += delta
carry()
for i, v in enumerate(ob.data.vertices):
    assert (v.co - turn @ before[i]).length < 1e-6, ("lining frame rotation", i)
    basis, shape = ob.data.shape_keys.key_blocks
    assert (shape.data[i].co - basis.data[i].co - offset).length < 1e-6
bpy.data.objects.remove(ob, do_unlink=True)

# A folded-back panel faces away from this layer. It must not attract its neighbour through itself.
ob, offset = fixture(Matrix.Identity(3))
for f in ob.data.polygons:
    if f.index >= 2:
        f.flip()
ob.data.update()
before = [v.co.copy() for v in ob.data.vertices]
ck.clear_layers(ob, None, {("lower", "upper")}, clearance=.006, passes=3)
assert max((a - b.co).length for a, b in zip(before, ob.data.vertices)) < 1e-6, "opposite panel moved cloth"
bpy.data.objects.remove(ob, do_unlink=True)
print("PASS: rotated layers, signed thickness, opposite folds, Basis and shape-key offsets")
