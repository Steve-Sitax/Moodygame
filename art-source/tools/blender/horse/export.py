"""The plain horse.glb: one node per part (named horse_<part>, its origin at its pivot), one material "horse" with an
8 px stand-in (the game puts its own pictures on), the gloss in the vertex colour's red, and on horse_body the extras
the game needs: every part's pivot on the standing horse and the points things hang on (game axes, metres)."""

import json
import os

import bpy
import numpy as np


def stand_in_material():
    mt = bpy.data.materials.get("horse")
    if mt is not None:
        return mt
    img = bpy.data.images.new("horse_stand_in", 8, 8, alpha=False)
    rgba = np.ones((8, 8, 4), np.float32)
    rgba[..., :3] = (0.36, 0.22, 0.14)
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    mt = bpy.data.materials.new("horse")
    mt.use_nodes = True
    nt = mt.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    mt.use_backface_culling = True
    return mt


def write(objs, path, points, pivots):
    mt = stand_in_material()
    keep = set()
    for name, ob in objs.items():
        ob.data.materials.clear()
        ob.data.materials.append(mt)
        keep.add(ob)
    for o in list(bpy.data.objects):
        if o not in keep:
            bpy.data.objects.remove(o)
    body = objs["body"]
    tris = {n: sum(len(p.vertices) - 2 for p in o.data.polygons) for n, o in objs.items()}
    body["horse"] = json.dumps(dict(pivots=pivots, points=points, triangles=tris), separators=(",", ":"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=path, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_extras=True, export_vertex_color="ACTIVE",
                              export_draco_mesh_compression_enable=False, export_image_format="AUTO", export_animations=False)
    print(f"[horse] -> {path} ({os.path.getsize(path) // 1024} KB)")
