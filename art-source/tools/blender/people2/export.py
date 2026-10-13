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


# shape-key normals: always in the plain copy (the game bakes each person's sliders into their mesh, normals too);
# in the compressed art master only on request (they cost several times the file size there)
MORPH_NORMALS = os.environ.get("PEOPLE2_MORPH_NORMALS", "0") == "1"


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


def export_glb(path, plain=False, selected=False, animations=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    for ob in bpy.data.objects:
        if ob.type == "MESH" and ob.name.startswith("held_") and not ob.data.materials:
            # Saved authoring scenes precede build_people2's final held-material assignment.
            placeholder = bpy.data.materials.get("people2_atlas")
            if placeholder is not None:
                ob.data.materials.append(placeholder)
        if ob.type == "MESH" and "_lod" in ob.name:
            if not ob.get("people2_occlusion_baked"):
                bake_occlusion(ob)
            if ob.name.endswith("_lod0") and "head" in ob.vertex_groups and not any(k in ob.name for k in ("_hair_", "_beard_", "_mous_")):
                live_expressions(ob)
    bpy.ops.export_scene.gltf(
        filepath=path, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
        export_materials="EXPORT", export_vertex_color="ACTIVE", use_selection=selected, export_skins=True, export_animations=animations,
        export_animation_mode="ACTIONS", export_force_sampling=True, export_image_format="AUTO",
        export_jpeg_quality=88, export_image_quality=88, export_extras=True, export_influence_nb=4,
        export_draco_mesh_compression_enable=not plain, export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14, export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12, export_rest_position_armature=True, export_def_bones=False,
        export_morph_normal=MORPH_NORMALS or plain, export_try_sparse_sk=not plain)


def bake_occlusion(ob, blockers=None, reach=0.18, samples=12):
    """Bake hemisphere visibility into vertex BLUE (1 open, >=.22 occluded).
    Preserve red eye flag, green picture flag and alpha hair coverage. Call after
    reduction; blockers are sibling garments/hair in the same rest coordinate frame.
    This is indirect occlusion only: do not paint albedo or attenuate direct lamps.
    """
    from mathutils.bvhtree import BVHTree
    me = ob.data
    vertices = [tuple(v.co) for v in me.vertices]
    faces = [tuple(p.vertices) for p in me.polygons]
    for other in blockers or ():
        offset = len(vertices)
        transform = ob.matrix_world.inverted() @ other.matrix_world
        vertices.extend(tuple(transform @ v.co) for v in other.data.vertices)
        faces.extend(tuple(offset + i for i in p.vertices) for p in other.data.polygons)
    tree = BVHTree.FromPolygons(vertices, faces)
    visibility = np.ones(len(me.vertices), np.float32)
    for v in me.vertices:
        n = v.normal.normalized()
        tangent = n.cross(Vector((0, 0, 1)))
        if tangent.length < .01:
            tangent = n.cross(Vector((0, 1, 0)))
        tangent.normalize()
        bitangent = n.cross(tangent)
        blocked = 0.0
        for k in range(samples):
            z = ((k + .5) / samples) ** .5
            r = (1 - z*z) ** .5
            angle = k * 2.39996323
            direction = n*z + tangent*(r*np.cos(angle)) + bitangent*(r*np.sin(angle))
            hit, _, _, distance = tree.ray_cast(v.co + n*.0015, direction, reach)
            if hit is not None:
                blocked += (1 - distance/reach) * .9
        visibility[v.index] = max(.22, 1 - blocked/samples)
    attr = me.color_attributes.active_color
    if attr is None:
        attr = me.color_attributes.new(name="picture_flags", type="FLOAT_COLOR", domain="CORNER")
        rgba = np.zeros((len(me.loops), 4), np.float32); rgba[:, 3] = 1
    else:
        rgba = np.empty((len(attr.data), 4), np.float32)
        attr.data.foreach_get("color", rgba.ravel())
    rgba[:, 2] = visibility[[l.vertex_index for l in me.loops]] if attr.domain == "CORNER" else visibility
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr
    ob["people2_occlusion_baked"] = True


def live_expressions(ob):
    """Three restrained near-copy expressions, in metres, on head/lid skin only.
    The eye bones supply each fitted eye centre; dense slider keys remain separate.
    """
    if ob.data.shape_keys and "blink" in ob.data.shape_keys.key_blocks:
        return
    if not ob.data.shape_keys:
        ob.shape_key_add(name="Basis", from_mix=False)
    ao = next((m.object for m in ob.modifiers if m.type == "ARMATURE"), None)
    if ao is None:
        return
    co = np.array([G(v.co) for v in ob.data.vertices])
    eye = [np.array(G(ao.data.bones["eye"+side].head_local)) for side in "LR"]
    # build_people2 strips part_* authoring groups before export; bone groups survive.
    head_group = ob.vertex_groups["head"].index
    mask = np.array([any(g.group == head_group and g.weight > .5 for g in v.groups) for v in ob.data.vertices])
    opening = ob.data.shape_keys.key_blocks.get("s_eyes_open_neg")
    lid_support = mask.copy()
    if opening:
        opening_co = np.array([G(v.co) for v in opening.data])
        lid_support &= np.linalg.norm(opening_co-co, axis=1) > .00001
    moves = {name: np.zeros_like(co) for name in ("blink", "brow_raise", "smile")}
    for centre in eye:
        d = co-centre
        # Only the fitted opening, with a soft shoulder in the surrounding skin.
        width = np.clip((.025-np.abs(d[:, 0]))/.009, 0, 1)
        width = width*width*(3-2*width)
        front = (d[:, 2] > .002) & (d[:, 2] < .027) & mask
        vertical = np.clip((.021-np.abs(d[:, 1]))/.007, 0, 1)
        lid = width * vertical*vertical*(3-2*vertical) * front * lid_support
        moves["blink"][:, 1] -= d[:, 1] * lid
        # Lids stay outside the eye sphere as they close.
        radius = .0155
        dest_y = d[:, 1]*(1-lid)
        surface = np.sqrt(np.maximum(radius**2-d[:, 0]**2-dest_y**2, 0)) + .001
        moves["blink"][:, 2] += np.maximum(0, surface-d[:, 2]) * lid
        brow = np.exp(-(d[:, 0]/.026)**4-((d[:, 1]-.022)/.012)**2)*front
        moves["brow_raise"][:, 1] += .004*brow
    mid = (eye[0]+eye[1])*.5
    d = co-mid
    mouth = np.exp(-((np.abs(d[:, 0])-.023)/.013)**2-((d[:, 1]+.055)/.018)**2) * mask * (d[:, 2] > .018)
    moves["smile"][:, 1] += .0035*mouth
    moves["smile"][:, 0] += np.sign(d[:, 0])*.002*mouth
    if opening:
        raw = opening_co-co
        moves["blink"] = raw*np.where(raw[:, 1] < 0, 8.0, 4.0)[:, None]*mask[:, None]
        # Carry MakeHuman's own smooth lid motion around the cornea, rather than
        # pulling the whole orbital skin into a flat seam.
        strength = np.clip(np.linalg.norm(moves["blink"], axis=1)/.001, 0, 1)
        for centre in eye:
            d = co-centre
            orbital = (np.abs(d[:, 0]) < .026) & (np.abs(d[:, 1]) < .022) & (d[:, 2] > -.002)
            closing = orbital & (raw[:, 1] != 0)
            target_y = centre[1]-.002
            top = closing & (co[:, 1] > target_y)
            bottom = closing & ~top
            moves["blink"][top, 1] = np.maximum(moves["blink"][top, 1], target_y-co[top, 1])
            moves["blink"][bottom, 1] = np.minimum(moves["blink"][bottom, 1], target_y-co[bottom, 1])
            q = co + moves["blink"] - centre
            surface = np.sqrt(np.maximum(.016**2-q[:, 0]**2-q[:, 1]**2, 0)) + .0015
            contact = (np.abs(q[:, 0]) < .018) & (np.abs(q[:, 1]) < .016) & (q[:, 2] > -.002) & (q[:, 2] < .027)
            moves["blink"][:, 2] += np.maximum(0, surface-q[:, 2])*contact*strength
    for name, move in moves.items():
        key = ob.shape_key_add(name=name, from_mix=False); key.value = 0
        target = co + move
        key.data.foreach_set("co", np.stack((target[:, 0], -target[:, 2], target[:, 1]), 1).ravel())


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
        "about": "people2 skeleton (art-source/tools/blender/build_people2.py, docs/people.md). Game axes: x the person's left, "
                 "y up, z forward (the person faces +z), metres. Bone frames are the glTF nodes' rest frames: local +y "
                 "runs along the bone.",
        "file": "art-source/client/public/models/people2.glb",
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
