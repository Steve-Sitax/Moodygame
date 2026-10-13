"""Blender objects and the file: one armature per animal (named after the kind the game asks for, e.g. dog_brown)
with its near and far skinned meshes <kind>_lod0 and <kind>_lod1 and one material (a colour and a normal picture);
the clips of each rig keyed on the first animal of the rig, named <rig>_<clip>; the rig's facts (clip strides and
duties, the paws' contact points, the harness fit) in the armature's extras ("animal"), which the native intake keeps
in animals.extras.json.
"""

import json
import math
import os

import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

from . import B, FPS
from .anatomy import BONES, NAMES
from .pose import rest_ends

C = np.array(((1.0, 0, 0), (0, 0, -1.0), (0, 1.0, 0)))  # game -> Blender


def to_bl(A):
    return C @ A @ C.T


def make_armature(name, J):
    arm = bpy.data.armatures.new(name + "_rig")
    ao = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    for o in bpy.context.selected_objects:
        o.select_set(False)
    ao.select_set(True)
    bpy.ops.object.mode_set(mode="EDIT")
    head0, tail0 = rest_ends(J)
    for b, par, h, t in BONES:
        eb = arm.edit_bones.new(b)
        eb.head = B(*head0[b])
        eb.tail = B(*tail0[b])
        d = (eb.tail - eb.head).normalized()
        z = Vector((1, 0, 0)).cross(d)
        if z.length > 1e-4:
            eb.align_roll(z)
        eb.use_deform = True
    for b, par, h, t in BONES:
        if par:
            arm.edit_bones[b].parent = arm.edit_bones[par]
            arm.edit_bones[b].use_connect = False
    bpy.ops.object.mode_set(mode="OBJECT")
    for pb in ao.pose.bones:
        pb.rotation_mode = "QUATERNION"
    return ao


def attach(mesh_ob, ao):
    mesh_ob.parent = ao
    mod = mesh_ob.modifiers.new("rig", "ARMATURE")
    mod.object = ao


def rest_mats(ao):
    return {b.name: np.array(b.matrix_local.to_3x3()) for b in ao.data.bones}


def key_poses(ao, action_name, poses, rest, step=1):
    """Key the poses `step` frames apart from frame 0 (the clip starts at time 0 in the file and in the game), the
    last a copy of the first so the loop closes."""
    ad = ao.animation_data_create()
    act = bpy.data.actions.new(action_name)
    act.use_fake_user = True
    ad.action = act
    seq = list(poses) + [poses[0]]
    for f, ps in enumerate(seq):
        rel = ps.relative()
        for b in NAMES:
            R0 = rest[b]
            q = R0.T @ to_bl(rel[b]) @ R0
            pb = ao.pose.bones[b]
            pb.rotation_quaternion = Matrix(q.tolist()).to_quaternion()
            pb.keyframe_insert("rotation_quaternion", frame=f * step)
        R0 = rest["hips"]
        loc = R0.T @ (C @ ps.root)
        pbh = ao.pose.bones["hips"]
        pbh.location = Vector(loc.tolist())
        pbh.keyframe_insert("location", frame=f * step)
    # linear between the keys (the game samples them the same way)
    try:
        for fc in _fcurves(act):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    except Exception:  # noqa: BLE001
        pass
    return act


def _fcurves(act):
    if hasattr(act, "fcurves") and act.fcurves is not None:
        try:
            return list(act.fcurves)
        except Exception:  # noqa: BLE001
            pass
    out = []
    for layer in getattr(act, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                out += list(bag.fcurves)
    return out


def park(ao, act):
    ad = ao.animation_data_create()
    tr = ad.nla_tracks.new()
    tr.name = act.name
    st = tr.strips.new(act.name, 1, act)
    st.name = act.name
    tr.mute = True
    ad.action = None


def image(name, rgb, colour=True):
    h, w = rgb.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False, is_data=not colour)
    # (the colour space is set before the pixels: changing it afterwards regenerates a blank picture)
    if not colour:
        img.colorspace_settings.name = "Non-Color"
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.flipud(rgb)  # our pictures are top row first; Blender's pixels start at the bottom
    img.pixels.foreach_set(rgba.ravel())
    img.file_format = "PNG"
    img.pack()
    if float(np.asarray(img.pixels[: 4 * 64]).reshape(-1, 4)[:, :3].max()) <= 0.0 and float(rgb.max()) > 0.0:
        raise RuntimeError("picture " + name + " came out blank")
    return img


def material(name, col_img, nrm_img, rough=0.8):
    mt = bpy.data.materials.new(name)
    mt.use_nodes = True
    nt = mt.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = col_img
    tex.interpolation = "Linear"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = rough
    if nrm_img is not None:
        tn = nt.nodes.new("ShaderNodeTexImage")
        tn.image = nrm_img
        tn.interpolation = "Linear"
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tn.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs["Normal"], bsdf.inputs["Normal"])
    mt.use_backface_culling = True
    return mt


def set_extras(ao, data):
    ao["animal"] = json.dumps(data, separators=(",", ":"))


def export_glb(path, plain=False):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    scn = bpy.context.scene
    scn.render.fps = FPS
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", use_selection=False, export_skins=True, export_animations=True,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="AUTO",
        export_extras=True, export_influence_nb=4, export_vertex_color="ACTIVE",
        export_draco_mesh_compression_enable=not plain, export_draco_mesh_compression_level=7,
        export_rest_position_armature=True, export_def_bones=False, export_try_sparse_sk=False,
        export_anim_slide_to_zero=True, export_optimize_animation_size=False)
