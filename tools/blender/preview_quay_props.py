"""Close modelling review + actual triangle fixture. Does not overwrite any game GLB.

blender -b --factory-startup -P tools/blender/preview_quay_props.py
"""
import json
import math
import os
import sys
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(__file__))
import build_quaygoods as q

bpy.ops.wm.read_factory_settings(use_empty=True)
q.build_atlases()
q.make_materials()
selected = ["casks_pyramid", "cask_blue", "cask_big", "crate_a", "crate_b", "sacks_pallet"]
objects = {}
fixture = {}
for name, mesh in q.build_models():
    obj = mesh.to_object(name)
    obj.data.calc_loop_triangles()
    pts = []
    for tri in obj.data.loop_triangles:
        if obj.data.materials[tri.material_index].name != "qg_solid":
            continue
        for i in tri.vertices:
            v = obj.matrix_world @ obj.data.vertices[i].co
            pts.extend([round(v.x, 6), round(v.z, 6), round(-v.y, 6)])
    if pts:
        fixture[name] = pts
    if name in selected:
        objects[name] = obj
    else:
        bpy.data.objects.remove(obj, do_unlink=True)

os.makedirs(os.path.join(q.ROOT, "data"), exist_ok=True)
with open(os.path.join(q.ROOT, "data", "tight-assets-meshes.json"), "w") as f:
    json.dump(fixture, f, separators=(",", ":"))

cam = q.sl.stage((0.12, 0.13, 0.13))
for name, pos, yaw in [
    ("casks_pyramid", (-2.0, 0, 0), math.pi / 2),
    ("cask_blue", (-0.1, 0, 0), 0),
    ("cask_big", (0.9, 0.05, 0), 0),
    ("crate_a", (2.1, 0.05, 0), math.pi),
    ("crate_b", (3.0, 0.1, 0), math.pi),
    ("sacks_pallet", (1.5, 1.5, 0), 0),
]:
    objects[name].location = pos
    objects[name].rotation_euler.z = yaw
for mat in bpy.data.materials:
    if not mat.name.startswith("qg_"):
        continue
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    tex = next(n for n in nt.nodes if n.type == "TEX_IMAGE")
    vc = nt.nodes.new("ShaderNodeVertexColor")
    vc.layer_name = "Col"
    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MULTIPLY"
    mix.inputs[0].default_value = 1.0
    nt.links.new(tex.outputs["Color"], mix.inputs[1])
    nt.links.new(vc.outputs["Color"], mix.inputs[2])
    nt.links.new(mix.outputs[0], bsdf.inputs["Base Color"])
q.sl.aim(cam, (5, -8, 5), (0.3, 0.5, 0.6), lens=45)
q.sl.render(os.path.join(q.SHOTS, "tight-assets-models.png"), (1500, 900))
q.sl.aim(cam, (0.6, -2.1, 2.7), (0.45, 0.1, 0.6), lens=47)
q.sl.render(os.path.join(q.SHOTS, "tight-assets-cargo.png"), (1200, 900))
