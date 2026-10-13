"""Build the people2 kit: the 64-bone skeleton, the base bodies (MakeHuman's CC0 base mesh and targets) with their
faces, sliders and hair, and the dressed kinds of package C (docs/people.md, docs/makehuman.md).

REQUIRED AUTHORING TOOL: MPFB 2.0.18 (the MakeHuman add-on for Blender, GPL-3.0 code, CC0 data), installed the
isolated way so the owner's Blender settings stay untouched (docs/makehuman.md "MPFB"):

    set BLENDER_USER_RESOURCES=<worktree>/.scratch/blender-user
    blender -b --command extension install-file -r user_default --enable add-on-mpfb-v2.0.18.zip

and the same BLENDER_USER_RESOURCES for every build. The game never needs MakeHuman or MPFB.

    blender -b --factory-startup -P art-source/tools/blender/build_people2.py [-- --preview] [--cast] [--out PATH] [--only a,b]
        [--kinds a,b | --nokinds] [--dress] [--no-move] [--fast]

Writes client/public/models/people2.glb (ten base bodies and the kinds, each an armature with a near and a far
skinned mesh; the held things; the clips keyed on the first body; one material over layered clothes and face pictures) and
shared/peopleRig.json (bones, sockets, grab marks, the Godot BoneMap, every body's joints and figures, the kinds,
the picture manifest). people.glb is not touched: the games switch later (packages E and F).

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
--idle     D2's check pictures, in .scratch/people2-build/shots/idle/: every idle, talk and sitting clip as a contact
           sheet per family and a strip per clip, and the clips on the dressed kinds
--no-idle  skip D2's idles, talk and sitting (trials only)
--work     D3's check pictures, in .scratch/people2-build/shots/work/: every work clip as a strip (front and side)
           with stand-ins for what it moves, a frame sequence 0.25 s apart and the feet from above
--no-work  skip D3's work clips (trials only); --work-only a,b makes only these work clips (trials)
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
from people2 import clips_idle, clips_legacy, clips_move, clips_work, export, lod, paint, rig, weights  # noqa: E402
from people2 import face_paint as fp  # noqa: E402
from people2 import hair, pictures  # noqa: E402
from people2 import face_types as ft  # noqa: E402
from people2 import mh, mhface, mhskin, sliders  # noqa: E402
import json  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = people2.OUT
if "--out" in ARGS:
    OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1])
    export.RIG_JSON = os.path.splitext(OUT)[0] + "_rig.json"  # trials leave shared/peopleRig.json alone
# the layered pictures: the game's folder, or beside a trial's glb (trials leave the game's pictures alone)
PICTURES_DIR = os.environ.get("PEOPLE2_PICTURES_DIR") or (
    os.path.join(os.path.dirname(OUT), "people2-pictures") if "--out" in ARGS
    else os.path.join(people2.ROOT, "..", "native-godot", "assets", "people2-pictures"))
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
# the face picture a base body shows by default (the game gives every person their own: face_types.face_for)
DEFAULT_CELLS_OF = {"m": "m_mid_brown", "f": "f_fair_brown", "boy": "c_boy_brown", "old_m": "om_grey",
                    "old_f": "of_grey"}
DEFAULT_CELLS = set(DEFAULT_CELLS_OF.values())
FAST_FACES = "--fast" in ARGS and os.environ.get("PEOPLE2_ALL_FACES") is None  # trials: only the default faces
WORK_ONLY = ARGS[ARGS.index("--work-only") + 1].split(",") if "--work-only" in ARGS else None


def picture_of(P):
    if P["child"]:
        return "boy"
    if P["old"]:
        return "old_f" if P["female"] else "old_m"
    return "f" if P["female"] else "m"
def make_body(name, base, build, ref_uv=None, style=None, pieces=False):
    """One body (people2/mhbody.py: MakeHuman's CC0 base mesh, our skeleton, the sliders as shape keys) under the name
    `name`: a base body (with every hair, beard and moustache piece it can wear: pieces=True), or a kind's own copy
    of one (package C, people2/dress.py)."""
    from people2 import mhbody
    return mhbody.make_body(name, base, build, ref_uv, style=style, pieces=pieces)


def grips_json(g):
    return {"note": "hands closed round a handle across the fist (art-source/tools/blender/people2/preview_b.py fit_grips): "
                    "curls are MCP, PIP, DIP degrees per finger (the little finger rides on the ring bones), the thumb "
                    "(across, flex at the base, MCP, IP); axisAt is the handle's axis in the grip socket's own frame "
                    "(metres): put a handle of that radius there, along the socket's +y",
            "sizes": g}


def all_kinds():
    """Every kind of package C, from the group files (people2/kinds_*.py), in a fixed order."""
    from people2 import kinds_cast, kinds_cast2, kinds_uniform, kinds_women, kinds_workers
    out = []
    for mod in (kinds_workers, kinds_women, kinds_uniform, kinds_cast, kinds_cast2):
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


def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ref_uv = None
    bodies = []
    mh.ensure_mpfb()
    for name, base, build in bd.BODIES:
        if ONLY and name not in ONLY and name != "man_middling":
            continue
        b, ref_uv = make_body(name, base, build, ref_uv, pieces=True)
        bodies.append(b)
        print(f"[people2] {name}: {b['counts']['lod0']} / {b['counts']['lod1']} triangles, {b['counts']['bones']} bones, "
              f"{b['counts']['bottom']} to {b['counts']['top']} m, cage fit {b['counts']['cageFitMm']} mm, "
              f"girths {b['counts']['girths']}, pieces {b['counts']['pieces']}")
    present = {b["name"] for b in bodies}
    os.makedirs(people2.SHOTS, exist_ok=True)
    # the face pictures (face_types.CELLS on MakeHuman's skins) and their tone for the body's skin
    face_pics = {}
    cells_meta = {}
    for cname, lk in (ft.CELLS if not FAST_FACES else ft.CELLS[:1] + [c for c in ft.CELLS if c[0] in DEFAULT_CELLS]):
        if cname in face_pics:
            continue
        t1 = time.time()
        frgb, fnrm = mhface.paint(lk)
        face_pics[cname] = (frgb, fnrm)
        cells_meta[cname] = mhskin.cell_meta(cname, lk, frgb)
        print(f"[people2] face picture {cname}: {time.time() - t1:.1f} s")
    # the base bodies' pictures: MakeHuman's skin with the linen drawers and vest
    mats = {}
    skins = {}
    for b in bodies:
        grp = picture_of(b["P"])
        rgb, nmap, zones = mhskin.body_picture(b, grp, size=1024)
        skins[b["name"]] = (rgb, nmap, zones)
        cell = DEFAULT_CELLS_OF[grp]
        mats[b["name"]] = mhskin.preview_material("people2_" + b["name"], rgb, nmap, *face_pics[cell])
        for ob in [b["lod0"], b["lod1"]] + b["hair_pieces"]:
            ob.data.materials.clear()
            ob.data.materials.append(mats[b["name"]])
        paint.to_image("people2_skin_" + b["name"], rgb, os.path.join(people2.SHOTS, "skin_%s.png" % b["name"]))
    actions = clips_legacy.make_actions(bodies[0]["ao"], bodies[0]["J"])
    # D1: locomotion (docs/people.md "Locomotion"), keyed on the same armature
    move_clips = []
    move_meta = {}
    if "--no-move" not in ARGS:
        move_actions, move_meta, move_clips = clips_move.make_all(bodies, bodies[0]["ao"])
        actions += move_actions
    # D2: idles, talk and sitting (docs/people.md "Idles, talk and sitting"), keyed on the same armature
    idle_meta, idle_clips = {}, []
    if "--no-idle" not in ARGS:
        idle_actions, idle_meta, idle_clips = clips_idle.make_all(bodies, bodies[0]["ao"])
        actions += idle_actions
    # D3: work (docs/people.md "Work"), keyed on the same armature
    work_meta, work_clips = {}, []
    if "--no-work" not in ARGS:
        work_actions, work_meta, work_clips = clips_work.make_all(bodies, bodies[0]["ao"], names=WORK_ONLY)
        actions += work_actions
    # B: the grips (curls and where a handle of each size sits in gripL/gripR), fitted on the first body
    from people2 import preview_b
    grips = preview_b.fit_grips(bodies[0])
    # A, B and D1 check pictures look at the base bodies with their own pictures (before layered UV mapping)
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
    # C: the kinds, and independent picture layers and one native material for everybody (docs/people.md "Kinds and clothes")
    from people2 import pictures as at
    from people2 import dress, held
    kinds = [] if "--nokinds" in ARGS else [k for k in all_kinds()
                                            if (not KINDS_ONLY or k.name in KINDS_ONLY) and k.body in present]
    layout = at.cells([(k.name, k.hero) for k in kinds])
    atl = at.Pictures(layout)
    for b in bodies:
        rgb, nmap, zones = skins[b["name"]]
        atl.put("body_" + b["name"], rgb, nmap, placed=True)
        atl.clothes_zones("body_" + b["name"], zones)
    for cname, (frgb, fnrm) in face_pics.items():
        atl.face(cname, frgb, fnrm)
    dressed = []
    from people2 import kinds_cast2, garments_cast
    # A dressed old_man and its undressed base share a recipe name, but need unique GLB roots.
    for b in bodies:
        if any(k.name == b["name"] for k in kinds):
            for key in ("ao", "lod0", "lod1"):
                b[key].name = "base_" + b[key].name
    for k in kinds:
        if k in kinds_cast2.KINDS:
            dressed.append(garments_cast.build(k, make_body, ref_uv, layout, atl, tex=TEX,
                                               base_body=next(b for b in bodies if b["name"] == k.body)))
        else:
            dressed.append(dress.build(k, make_body, ref_uv, layout, atl, tex=TEX))
    from people2 import held_cast
    held_cast.register()
    held_obs = held.build_all(kinds, layout, atl, tex=TEX)
    def default_face(b):
        if "face" in b and b["face"]["cell"] in face_pics:
            return b["face"]["cell"]
        return DEFAULT_CELLS_OF[picture_of(b["P"])]
    picture_manifest = atl.write(bodies, dressed, PICTURES_DIR, default_face)
    # Tiny intake placeholder; native load replaces it with one layered material.
    img = paint.to_image("people2_placeholder", np.ones((4,4,3), np.float32))
    nimg = paint.to_image("people2_placeholder_n", np.tile((.5,.5,1.), (4,4,1)))
    mat = export.material("people2_atlas", img, nimg)  # retained intake label; images are tiny placeholders
    for b in bodies + dressed:
        for ob in [b["lod0"], b["lod1"]] + b.get("hair_pieces", []):
            ob.data.materials.clear()
            ob.data.materials.append(mat)
    if os.environ.get("PEOPLE2_SAVE_BLEND"):  # trials: keep the scene to look into
        bpy.ops.wm.save_as_mainfile(filepath=os.environ["PEOPLE2_SAVE_BLEND"], copy=True)
    for b in bodies + dressed:
        for ob in [b["lod0"], b["lod1"]] + b.get("hair_pieces", []):
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
        c0, c1, b0, b1 = glb_slim.slim(OUT, thin=set(idle_meta) | set(work_meta))
        print(f"[people2] slimmed: {c0} -> {c1} animation channels, {b0 // 1024} -> {b1 // 1024} KB")
        if "--plain" in ARGS:
            c0, c1, b0, b1 = glb_slim.slim(plain, thin=set(idle_meta) | set(work_meta))
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
                     "shapeKeys": {"sliders": "shared/peopleSliders.json", "hands": "hands_hard",
                                   "pieces": {b["name"]: sorted(b["counts"]["pieces"]) for b in bodies},
                                   "note": "morph targets of <body>_lod0, <kind>_lod0 and the hair pieces "
                                           "(<body>_<hair|beard|mous>_<style>_lod0): MakeHuman's targets as sliders "
                                           "(peopleSliders.json), set once per person at spawn from faceTypes.json's "
                                           "face_for; the far copies carry the body sliders. hands_hard 1 on dockers "
                                           "(kinds.<kind>.shapeKeys)."},
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
                     "pictures": picture_manifest,
                     "idles": clips_idle.rig_json(idle_meta),
                     "work": clips_work.rig_json(work_meta),
                     "held": held_cast.json_all(kinds),
                     "kinds": {b["name"]: dress.kind_json(b) for b in dressed}})
    shared = os.path.dirname(export.RIG_JSON)
    with open(os.path.join(shared, "peopleSliders.json" if export.RIG_JSON.endswith("peopleRig.json")
                           else os.path.basename(export.RIG_JSON).replace("_rig.json", "_sliders.json")), "w",
              encoding="utf-8") as f:
        json.dump(sliders.to_json(), f, indent=1)
    ft.to_json(os.path.join(shared, "faceTypes.json" if export.RIG_JSON.endswith("peopleRig.json")
                            else os.path.basename(export.RIG_JSON).replace("_rig.json", "_faces.json")), cells_meta)
    if not ONLY and not KINDS_ONLY:  # a full build: the MakeHuman files it read (third_party/makehuman/SOURCES.json)
        mh.write_used(os.path.join(mh.THIRD, "USED.json"))
    checked, differ = mh.check_mpfb_copies()
    print(f"[people2] MakeHuman files: {len(mh._USED)} read, {checked} compared with MPFB {mh.MPFB_VERSION}'s own, "
          f"{len(differ)} differ{': ' + ', '.join(differ[:5]) if differ else ''}")
    kb = os.path.getsize(OUT) // 1024
    print(f"[people2] {len(bodies)} bodies, {len(dressed)} kinds, {len(rig.NAMES)} bones, {len(actions)} clips, "
          f"{len(bpy.data.materials)} material(s) -> {OUT} ({kb} KB) in {time.time() - t0:.0f} s")
    if "--dress" in ARGS:
        from people2 import preview_c
        for ln in garments_cast.proof(dressed, bodies, actions, move_clips, held_obs, PICTURES_DIR, export.RIG_JSON):
            print("[people2] " + ln)
    if "--work" in ARGS and work_clips:
        from people2 import preview_work
        for ln in preview_work.run(work_clips, bodies):
            print("[people2] " + ln)
    if "--idle" in ARGS and idle_clips:
        from people2 import preview_idle
        for ln in preview_idle.run(idle_clips, bodies, dressed, kinds=True):
            print("[people2] " + ln)


if __name__ == "__main__":
    main()
