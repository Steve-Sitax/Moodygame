"""Build the people2 kit: the 62-bone skeleton, the base bodies with B's faces, hands and hair, and the dressed
kinds of package C (docs/people.md).

    blender -b --factory-startup -P art-source/tools/blender/build_people2.py [-- --preview] [--cast] [--out PATH] [--only a,b]
        [--kinds a,b | --nokinds] [--dress] [--no-move] [--fast]

Writes client/public/models/people2.glb (ten base bodies and the kinds, each an armature with a near and a far
skinned mesh; the held things; the clips keyed on the first body; one material over one picture atlas) and
shared/peopleRig.json (bones, sockets, grab marks, the Godot BoneMap, every body's joints and figures, the kinds,
the atlas). people.glb is not touched: the games switch later (packages E and F).

--preview  data/shots/people2/bodies_front.png, _side, _back, _closeups (every body, lit, no fog)
--cast     the checks, in data/shots/people2/: turntable_3m.png and turntable_10m.png (in the game's fog),
           clips_<body>.png (every old clip on the body, a contact sheet), bends.png (knees and elbows at 120 degrees,
           shoulders up, a body lying and dragged), sockets.png (a stick in each socket), grab.png (two people: a
           grab from behind), and the bend measures printed.
--move     the motion checks (package D1), in data/shots/people2/move/: contact sheets and turntables of every
           locomotion clip, climbs, carries, starts, stops, turns, and the speed blend (pictures and a film)
--faces    B's faces at 1, 2 and 5 m by day and gas light, the jaw, blink and eyes, every face shape
--hands    B's hands: views, a fist, grips round 2 to 4 cm handles (and how deep any vertex goes into them)
--sheet    B's 40 seeded faces at 5 m and 2 m
--only     build only these bodies (trials; the glb then has only them, and only the kinds on them)
--out      write the glb somewhere else (trials)
--plain    also write a non-Draco GLB with dense morphs outside art-source for native intake
--kinds    build only these kinds (package C; default: every kind in people2/kinds_*.py); --nokinds: none
--dress    C's check pictures, in data/shots/people2/kinds/: each kind front, side, back at 3 m and 10 m in the
           game's fog, close views at 1 and 2 m, the clips on each kind (a contact sheet), the held things
--no-move  skip D1's locomotion clips (trials only: the glb then lacks them)
--fast     paint the pictures at the cell size, not twice it (trials only)
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import people2  # noqa: E402
from people2 import body as bd  # noqa: E402
from people2 import clips_legacy, clips_move, export, lod, paint, rig, weights  # noqa: E402
from people2 import face_paint as fp  # noqa: E402
from people2 import hair  # noqa: E402
from people2 import hands  # noqa: E402
from people2 import head as hd  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = people2.OUT
if "--out" in ARGS:
    OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1])
    export.RIG_JSON = os.path.splitext(OUT)[0] + "_rig.json"  # trials leave shared/peopleRig.json alone
PLAIN = os.path.abspath(ARGS[ARGS.index("--plain") + 1]) if "--plain" in ARGS else None
if PLAIN:
    workspace = os.path.abspath(os.path.join(people2.ROOT, ".."))
    scratch = os.path.join(workspace, ".scratch")
    try:
        in_workspace = os.path.normcase(os.path.commonpath([PLAIN, workspace])) == os.path.normcase(workspace)
        in_scratch = os.path.normcase(os.path.commonpath([PLAIN, scratch])) == os.path.normcase(scratch)
    except ValueError:  # A different drive is outside this repository.
        in_workspace, in_scratch = False, False
    if in_workspace and not in_scratch:
        raise ValueError("--plain must be outside git: use .scratch/people2-plain/people2.glb or an external directory")
ONLY = ARGS[ARGS.index("--only") + 1].split(",") if "--only" in ARGS else None
KINDS_ONLY = ARGS[ARGS.index("--kinds") + 1].split(",") if "--kinds" in ARGS else None
TEX = 1024 if "--fast" in ARGS else 2048
# the pictures (B): one per group of bodies, each with its own face (the old grey, the boys without stubble)
PICTURES = [("m", "man_middling"), ("f", "woman_middling"), ("boy", "child_middling"), ("old_m", "old_man"),
            ("old_f", "old_woman")]


def picture_of(P):
    if P["child"]:
        return "boy"
    if P["old"]:
        return "old_f" if P["female"] else "old_m"
    return "f" if P["female"] else "m"
UV_SCALE = {"head": 2.7, "finger_": 1.15}


def make_body(name, base, build, ref_uv, style=None):
    """One body (A's cage, weights, near and far copies; B's head, hair and hands) under the name `name`: a base body,
    or a kind's own copy of one (package C, people2/dress.py) with the kind's hair style."""
    P = bd.params(base, build)
    C = bd.build(P)
    cage = bd.to_mesh(C, name + "_lod1")
    # A's placeholder head is kept for the subdivision (the neck keeps its shape) and replaced after it (head.py)
    for poly, fp in zip(cage.data.polygons, C.fpart):
        if fp == "head":
            poly.material_index = 1
    W = weights.cage_weights(C, P)
    weights.apply(cage, W, limit=0)
    if ref_uv is None:
        lod.uv_unwrap(cage, UV_SCALE)
        hd.reserve_head_rect(cage)
        ref_uv = np.array([l.uv[:] for l in cage.data.uv_layers.active.data])
    else:
        if not cage.data.uv_layers:
            cage.data.uv_layers.new(name="UVMap")
        uv = cage.data.uv_layers.active.data
        assert len(uv) == len(ref_uv), "every body must have the same topology"
        uv.foreach_set("uv", ref_uv.ravel())
    lod0 = lod.subdivide(cage, name + "_lod0")
    J = rig.joints(P)
    Jg = {n: (h, t) for n, (h, t) in J.items()}
    # sharpen the fingers on the near copy
    vparts = weights.parts(lod0)
    co = np.array([people2.G(v.co) for v in lod0.data.vertices])
    fparts = [p if p and p.startswith("finger_") else None for p in vparts]
    W0 = weights.read(lod0)
    for i, wd in weights.finger_rule(co, fparts, Jg, P).items():
        W0[i] = 0.0
        for k, v in wd.items():
            W0[i, weights.INDEX[k]] = v
    for vg in list(lod0.vertex_groups):
        if not vg.name.startswith("part_"):
            lod0.vertex_groups.remove(vg)
    weights.apply(lod0, W0, limit=4)
    Wc = weights.read(cage)
    for vg in list(cage.vertex_groups):
        if not vg.name.startswith("part_"):
            cage.vertex_groups.remove(vg)
    weights.apply(cage, Wc, limit=4)
    lod.to_limit(cage)
    hd.attach(lod0, P, 0)
    hd.attach(cage, P, 1)
    # B: the base hair (hair.base_style), joined in
    hair.attach(lod0, P, 0, style or hair.base_style(P))
    hair.attach(cage, P, 1, style or hair.base_style(P))
    vparts = weights.parts(lod0)
    cparts = weights.parts(cage)
    # B: the docker's hand as a shape key of the near copy
    co0 = np.array([people2.G(v.co) for v in lod0.data.vertices])
    off = hands.hard_offsets(co0, vparts, J, P)
    sk = lod0.shape_key_add(name="hands_hard", from_mix=False)
    sk.data.foreach_set("co", np.array([v.co[:] for v in lod0.data.vertices]).ravel() +
                        np.array([people2.B(*d)[:] for d in off]).ravel())
    ao = rig.build_armature(name, J)
    for ob in (lod0, cage):
        ob.parent = ao
        m = ob.modifiers.new("rig", "ARMATURE")
        m.object = ao
    ao["people2"] = {"base": base, "build": build, "height": round(P["H"], 3), "female": P["female"],
                     "scaleToOld": round(float(J["hips"][0][1]) / 0.95, 4)}
    zs = [v.co.z for v in lod0.data.vertices]
    counts = {"lod0": lod.tris(lod0), "lod1": lod.tris(cage), "bones": len(ao.data.bones),
              "top": round(max(zs), 3), "bottom": round(min(zs), 3)}
    bpy.context.view_layer.update()
    counts["girths"] = {k: round(v, 3) for k, v in bd.girths(lod0, P, vparts).items()}
    return dict(name=name, P=P, C=C, ao=ao, lod0=lod0, lod1=cage, J=J, counts=counts, vparts=vparts,
                cparts=cparts), ref_uv


def grips_json(g):
    return {"note": "hands closed round a handle across the fist (art-source/tools/blender/people2/preview_b.py fit_grips): "
                    "curls are MCP, PIP, DIP degrees per finger (the little finger rides on the ring bones), the thumb "
                    "(across, flex at the base, MCP, IP); axisAt is the handle's axis in the grip socket's own frame "
                    "(metres): put a handle of that radius there, along the socket's +y",
            "sizes": g}


def all_kinds():
    """Every kind of package C, from the group files (people2/kinds_*.py), in a fixed order."""
    from people2 import kinds_cast, kinds_uniform, kinds_women, kinds_workers
    out = []
    for mod in (kinds_workers, kinds_women, kinds_uniform, kinds_cast):
        out += mod.KINDS
    return out


def clear_stage():
    """Remove what the check pictures left (lights, floor, camera, posed copies) and show the bodies again."""
    for o in list(bpy.data.objects):
        if o.get("p2_stage") or o.name.startswith("p2cam"):
            bpy.data.objects.remove(o)
    for o in bpy.data.objects:
        o.hide_render = False
        o.hide_viewport = False


def head_cache():
    """Trials only (PEOPLE2_HEADCACHE=path): keep B's reference head between runs (it takes a minute to mesh)."""
    path = os.environ.get("PEOPLE2_HEADCACHE")
    if not path:
        return
    import pickle
    if os.path.exists(path):
        with open(path, "rb") as f:
            hd._REF.update(pickle.load(f))
    else:
        hd.reference()
        with open(path, "wb") as f:
            pickle.dump(dict(hd._REF), f)


def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    head_cache()
    ref_uv = None
    bodies = []
    for name, base, build in bd.BODIES:
        if ONLY and name not in ONLY and name != "man_middling":
            continue
        b, ref_uv = make_body(name, base, build, ref_uv)
        bodies.append(b)
        print(f"[people2] {name}: {b['counts']['lod0']} / {b['counts']['lod1']} triangles, {b['counts']['bones']} bones, "
              f"{b['counts']['bottom']} to {b['counts']['top']} m, girths {b['counts']['girths']}")
    # the pictures: one for the men and boys, one for the women, painted on the middling bodies
    os.makedirs(people2.SHOTS, exist_ok=True)
    mats = {}
    skins = {}
    present = {b["name"] for b in bodies}
    for sex, ref in PICTURES:
        if sex not in ("m", "f") and ref not in present:
            continue
        src = next((b for b in bodies if b["name"] == ref), bodies[0])
        pos, nrm, part, names = paint.position_map(src["lod0"], TEX, src["vparts"])
        # the body's own occlusion (armpits, crotch, under the chin, between the fingers), baked into the picture
        occ = paint.vertex_occlusion(src["lod0"], src["vparts"], src["P"])
        aom = paint.vertex_map(src["lod0"], TEX, occ)
        rgb = paint.paint_skin(pos, nrm, part, names, src["P"], female=src["P"]["female"], ao=aom)
        # B: the hands' nails, creases and knuckles, and their normal map
        hgt = np.zeros(rgb.shape[:2], np.float32)
        rgb, hgt = hands.paint_hands(rgb, hgt, pos, part, names, src["P"])
        rgb = paint.dilate(rgb, part >= 0)
        hn_map = hands.normal_from_height(hgt, pos, part >= 0)
        # B: the head's square (face, scalp, ears, eyeball) from the face painter, and the normal map
        frgb, _, fnrm = fp.paint(fp.BASE_LOOKS[sex], 512)
        rgb = fp.insert(rgb, frgb, TEX)
        nmap = fp.insert(hn_map, fnrm, TEX)
        skins[sex] = (rgb, nmap)
        img = paint.to_image("people2_skin_" + sex, rgb, os.path.join(people2.SHOTS, "skin_%s.png" % sex))
        nimg = paint.to_image("people2_skin_%s_n" % sex, nmap, os.path.join(people2.SHOTS, "skin_%s_n.png" % sex))
        nimg.colorspace_settings.name = "Non-Color"
        mats[sex] = export.material("people2_skin_" + sex, img, nimg)
    for b in bodies:
        for ob in (b["lod0"], b["lod1"]):
            ob.data.materials.clear()
            ob.data.materials.append(mats.get(picture_of(b["P"]), mats["f" if b["P"]["female"] else "m"]))
    actions = clips_legacy.make_actions(bodies[0]["ao"], bodies[0]["J"])
    # D1: locomotion (docs/people.md "Locomotion"), keyed on the same armature
    move_clips = []
    move_meta = {}
    if "--no-move" not in ARGS:
        move_actions, move_meta, move_clips = clips_move.make_all(bodies, bodies[0]["ao"])
        actions += move_actions
    # B: the grips (curls and where a handle of each size sits in gripL/gripR), fitted on the first body
    from people2 import preview_b
    grips = preview_b.fit_grips(bodies[0])
    # A, B and D1 check pictures look at the base bodies with their own pictures (before the atlas)
    b_checks = [k for k in ("faces", "hands", "sheet") if "--" + k in ARGS]
    if b_checks:
        preview_b.run(bodies, mats, b_checks)
    if "--preview" in ARGS or "--cast" in ARGS:
        from people2 import preview
        if "--preview" in ARGS:
            preview.bodies_sheet(bodies, mats)
        if "--cast" in ARGS:
            preview.cast(bodies, mats, actions)
    if "--move" in ARGS:
        from people2 import preview_move
        for ln in preview_move.cast_move(move_clips, bodies):
            print("[people2] " + ln)
    clear_stage()
    # C: the kinds, and one picture atlas and one material for everybody (docs/people.md "Kinds and clothes")
    from people2 import atlas as at
    from people2 import dress, held
    kinds = [] if "--nokinds" in ARGS else [k for k in all_kinds()
                                            if (not KINDS_ONLY or k.name in KINDS_ONLY) and k.body in present]
    layout = at.cells([(k.name, k.hero) for k in kinds])
    atl = at.Atlas(layout)
    for sex, (rgb, nmap) in skins.items():
        atl.put("skin_" + sex, rgb, nmap)
    for b in bodies:
        sex = picture_of(b["P"]) if picture_of(b["P"]) in skins else ("f" if b["P"]["female"] else "m")
        for ob in (b["lod0"], b["lod1"]):
            at.remap_uv(ob, layout["skin_" + sex])
    dressed = []
    for k in kinds:
        dressed.append(dress.build(k, make_body, ref_uv, layout, atl, tex=TEX))
    held_obs = held.build_all(kinds, layout, atl, tex=TEX)
    img, nimg = atl.images(people2.SHOTS)
    mat = export.material("people2_atlas", img, nimg)
    for b in bodies + dressed:
        for ob in (b["lod0"], b["lod1"]):
            ob.data.materials.clear()
            ob.data.materials.append(mat)
    if os.environ.get("PEOPLE2_SAVE_BLEND"):  # trials: keep the scene to look into
        bpy.ops.wm.save_as_mainfile(filepath=os.environ["PEOPLE2_SAVE_BLEND"], copy=True)
    for b in bodies + dressed:
        for ob in (b["lod0"], b["lod1"]):
            for vg in list(ob.vertex_groups):
                if vg.name.startswith(("part_", "zone_")) and vg.name != "part_hair":  # (not a bone: never exported)
                    ob.vertex_groups.remove(vg)
    for ob in held_obs:
        ob.data.materials.clear()
        ob.data.materials.append(mat)
    for m in list(bpy.data.materials):
        if m != mat and m.users == 0:
            bpy.data.materials.remove(m)
    export.export_glb(OUT)
    if "--plain" in ARGS:
        plain = PLAIN
        # The decoded intake stays outside git; art geometry and styling are unchanged.
        export.export_glb(plain, plain=True)
        print(f"[people2] plain native intake -> {plain}")
    from people2 import glb_slim
    if not os.environ.get("PEOPLE2_NO_SLIM"):  # trials: PEOPLE2_NO_SLIM=1 keeps Blender's file as it is
        c0, c1, b0, b1 = glb_slim.slim(OUT)
        print(f"[people2] slimmed: {c0} -> {c1} animation channels, {b0 // 1024} -> {b1 // 1024} KB")
        if "--plain" in ARGS:
            c0, c1, b0, b1 = glb_slim.slim(plain)
            print(f"[people2] plain slimmed: {c0} -> {c1} animation channels, {b0 // 1024} -> {b1 // 1024} KB")
    hips_base = [round(float(c), 4) for c in people2.G(bodies[0]["ao"].data.bones["hips"].head_local)]
    loco = {"about": "package D1 clips (art-source/tools/blender/people2/clips_move.py, docs/people.md 'Locomotion'). Loops are "
                     "two strides, in place: move the node at their speed. Clips that travel move the hips: move the "
                     "node by their travel at the end. Hips translation tracks are the clip's own body's offset from "
                     "its rest, added to man_middling's hips rest (trackBase).",
            "trackBase": hips_base, "blend": clips_move.BLEND_RULE, "stairs": clips_move.STAIR,
            "slopeDeg": clips_move.SLOPE, "loads": clips_move.LOADS, "clips": move_meta}
    export.rig_json([(b["name"], b["P"], b["ao"], b["counts"]) for b in bodies],
                    {"clips": [a.name for a in actions], "grips": grips_json(grips),
                     "shapeKeys": {"face": hd.SHAPE_NAMES, "blink": "blink", "hands": "hands_hard",
                                   "note": "morph targets of each <body>_lod0 and <kind>_lod0, positions only: face "
                                           "shapes mixed per person by seed (head.face_mix; a kind has its own mix "
                                           "baked in and the keys add to it), blink 0..1, hands_hard 1 on dockers"},
                     "lod": {"lod1From": 15.0, "note": "LOD1 also for the mirrors and the lantern shadow"},
                     "heightFactor": {"min": 0.96, "max": 1.04, "sd": 0.02,
                                      "note": "per person, from the person's seed (a normal draw, sd 0.02, clamped to "
                                              "min..max): scale the person's top node uniformly by f. Locomotion: "
                                              "every clip's stride, speed and travel times f (the speed blend works "
                                              "on stride*f; the foot lock takes out the rest); sockets, marks, grips "
                                              "and the hips tracks follow the node. (docs/people.md 'Builds')"},
                     "oldStance": {"clips": {n: n + "_old" for n in clips_legacy.OLD_CLIPS},
                                   "thighFwdDeg": clips_legacy.OLD_STANCE["thigh"],
                                   "kneeDeg": clips_legacy.OLD_STANCE["knee"],
                                   "footDeg": clips_legacy.OLD_STANCE["thigh"] - clips_legacy.OLD_STANCE["knee"],
                                   "hipsDrop": clips_legacy.OLD_STANCE["drop"],
                                   "note": "bodies with stoopDeg > 0: play <clip>_old where it exists; for any other "
                                           "standing clip add per leg legUp RX(-thighFwdDeg), legLow RX(kneeDeg), "
                                           "foot RX(footDeg) (pose convention, before the clip's own turn) and lower "
                                           "the hips by hipsDrop m (docs/people.md 'The old')"},
                     "locomotion": loco,
                     "atlas": dress.atlas_json(layout),
                     "held": held.json_all(kinds),
                     "kinds": {b["name"]: dress.kind_json(b) for b in dressed}})
    kb = os.path.getsize(OUT) // 1024
    print(f"[people2] {len(bodies)} bodies, {len(dressed)} kinds, {len(rig.NAMES)} bones, {len(actions)} clips, "
          f"{len(bpy.data.materials)} material(s) -> {OUT} ({kb} KB) in {time.time() - t0:.0f} s")
    if "--dress" in ARGS:
        from people2 import preview_c
        for ln in preview_c.cast(dressed, bodies, actions, move_clips, held_obs):
            print("[people2] " + ln)


if __name__ == "__main__":
    main()
