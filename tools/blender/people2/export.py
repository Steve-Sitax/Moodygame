"""Write people2.glb and shared/peopleRig.json (docs/people.md "The file").

The glb: one armature per body (named after the body, e.g. man_middling) with its two skinned meshes
<body>_lod0 and <body>_lod1, the 36 clips keyed on the first armature only (rotations; the games bind them by
bone name onto every body, as with people.glb), Draco meshes, JPEG pictures, the body's figures in the armature's
extras (people2: base, build, height, hip height, scale).
"""

import json
import os

import bpy
import numpy as np
from mathutils import Vector

from . import G, RIG_JSON
from . import body as bd
from . import rig


MORPH_NORMALS = os.environ.get("PEOPLE2_MORPH_NORMALS", "0") == "1"  # B: shape-key normals cost 7x the file size


def material(name, img, normal=None):
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    nt = mt.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.78
    if normal is not None:
        nt_ = nt.nodes.new("ShaderNodeTexImage")
        nt_.image = normal
        nt_.interpolation = "Linear"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(nt_.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mt.use_backface_culling = True
    return mt


def export_glb(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", use_selection=False, export_skins=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="JPEG",
        export_jpeg_quality=88, export_image_quality=88, export_extras=True, export_influence_nb=4,
        export_draco_mesh_compression_enable=True, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_rest_position_armature=True, export_def_bones=False,
        export_morph_normal=MORPH_NORMALS, export_try_sparse_sk=True)


def bone_frame(ao, n):
    """A bone's rest head and its local axes, in game space (= the glTF node's frame)."""
    b = ao.data.bones[n]
    m = b.matrix_local
    head = G(m.translation)
    ax = [G(Vector(m.col[i][:3]).normalized()) for i in range(3)]
    return head, ax


def r4(v):
    return [round(float(c), 4) for c in v]


def rig_json(bodies, extra):
    """bodies: list of (name, P, ao, counts). extra: dict merged in (clips, notes)."""
    ref = bodies[0]
    out = {
        "about": "people2 skeleton (tools/blender/build_people2.py, docs/people.md). Game axes: x the person's left, "
                 "y up, z forward (the person faces +z), metres. Bone frames are the glTF nodes' rest frames: local +y "
                 "runs along the bone.",
        "file": "client/public/models/people2.glb",
        "bones": [],
        "boneMap": {"profile": "SkeletonProfileHumanoid (Godot 4.7)", "map": {v: k for k, v in rig.GODOT.items()},
                    "unmapped": ["LeftLittleProximal", "LeftLittleIntermediate", "LeftLittleDistal",
                                 "RightLittleProximal", "RightLittleIntermediate", "RightLittleDistal", "Root"],
                    "note": "The little finger is weighted to the ring chain (ring1-3), so it curls with the ring "
                            "finger. eyeL and eyeR are leaves of head that turn the eyeballs (code, never clips)."},
        "legacy": rig.LEGACY,
        "keyed": rig.KEYED,
        "eyes": ["eyeL", "eyeR"],
        "sockets": {},
        "marks": {n: {"bone": b, "for": d} for n, b, d in rig.MARKS},
        "bodies": {},
    }
    ao = ref[2]
    for n in rig.NAMES:
        head, ax = bone_frame(ao, n)
        out["bones"].append({"name": n, "parent": rig.PARENT[n], "kind": rig.KIND[n],
                             "deform": rig.KIND[n] != "socket", "legacy": n in rig.LEGACY,
                             "dir": r4(ax[1])})
    sock_note = {
        "gripR": "the right fist's grip: a handle runs along local +y through the closed fist (forward when the arm "
                 "hangs); local +z points to the wrist, so a blade's edge points along -z (the little finger side). "
                 "Model a held thing with its grip at the origin and its tip along +y.",
        "gripL": "the same for the left fist.",
        "hipL": "the left hip at the belt: a scabbard or sheath hangs from here along local +y (down).",
        "back": "the middle of the upper back on the skin: a slung load; local +y up the back, local +z out of the "
                "back (behind the person).",
        "headTop": "the crown: a hat sits here; local +y up.",
    }
    for s, note in sock_note.items():
        head, ax = bone_frame(ao, s)
        out["sockets"][s] = {"bone": s, "parent": rig.PARENT[s], "note": note,
                             "rest": {"head": r4(head), "x": r4(ax[0]), "y": r4(ax[1]), "z": r4(ax[2])}}
    for name, P, ab, counts in bodies:
        J = rig.joints(P)
        bj = {}
        for n in rig.NAMES:
            head, ax = bone_frame(ab, n)
            tail = G(ab.data.bones[n].tail_local)
            bj[n] = {"head": r4(head), "tail": r4(tail)}
        mk = {}
        for mname, (p, bone) in rig.marks(P, J).items():
            head, ax = bone_frame(ab, bone)
            d = np.array(p) - np.array(head)
            mk[mname] = {"bone": bone, "offset": r4([np.dot(d, a) for a in ax]), "rest": r4(p)}
        out["bodies"][name] = {
            "base": P["base"], "build": P["build"], "female": P["female"], "height": round(P["H"], 3),
            "hipJoint": round(bd.Y(P, 0.52), 4), "hipsBone": round(float(J["hips"][0][1]), 4),
            "scaleToOld": round(float(J["hips"][0][1]) / 0.95, 4), "stoopDeg": P["f"]["stoop"],
            "triangles": counts, "joints": bj, "marks": mk}
    out.update(extra)
    with open(RIG_JSON, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=1)
