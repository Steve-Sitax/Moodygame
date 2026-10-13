"""Build the dogs, cats and pigs of Scheldemist in Blender and export them for the game (package H, docs/plans/people.md).

    blender -b --factory-startup -P art-source/tools/blender/build_animals.py -- [--plain PATH] [--only mongrel,cat]
        [--preview] [--clips] [--out PATH]

Writes art-source/client/public/models/animals.glb (Draco) and, with --plain, an uncompressed copy outside git for the
native intake (docs/godot-people2.md: "Authoring and additive intake"). The kit is art-source/tools/blender/animals/:
anatomy.py (skeletons at true size and the kinds), body.py (the bodies as distance fields), mesh.py (meshing, ears,
eyes, claws, weights, UVs, the far copy), paint.py (the pictures), pose.py and clips.py (the clips), export.py and
slim.py (drops the clips' constant translation and scale channels from the written glb).

The kinds (the game's names): dog_brown, dog_black, dog_spotted, dog_grey (the street mongrel), dog_draught and
dog_draught_brindle (the cart dog), dog_schipperke, dog_terrier and dog_terrier_wheaten, cat_tabby, cat_black,
cat_ginger, cat_white, cat_tuxedo, cat_tortie, pig_pink and pig_spotted. Each is an armature with its near and far
skinned meshes and one material; each rig's clips (<rig>_<clip>) are keyed on its first kind.

--preview  check pictures in .scratch/animals-build/shots (every kind side, front, back, face; textured)
--clips    contact sheets of every clip of each rig (several frames), and the walk strip with the paw paths
--only     build only these rigs (trials)
"""

import json
import math
import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import animals  # noqa: E402
from animals import anatomy, body, clips, export, mesh, paint, pose, preview  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = animals.OUT
if "--out" in ARGS:
    OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1])
PLAIN = os.path.abspath(ARGS[ARGS.index("--plain") + 1]) if "--plain" in ARGS else None
if PLAIN:
    workspace = os.path.abspath(os.path.join(animals.ROOT, ".."))
    scratch = os.path.join(workspace, ".scratch")
    try:
        in_ws = os.path.normcase(os.path.commonpath([PLAIN, workspace])) == os.path.normcase(workspace)
        in_sc = os.path.normcase(os.path.commonpath([PLAIN, scratch])) == os.path.normcase(scratch)
    except ValueError:
        in_ws, in_sc = False, False
    if in_ws and not in_sc:
        raise ValueError("--plain must be outside git: use .scratch/animals-plain/animals.glb or an external directory")
ONLY = ARGS[ARGS.index("--only") + 1].split(",") if "--only" in ARGS else None
PREVIEW = "--preview" in ARGS
CLIPS = "--clips" in ARGS
NOGLB = "--no-glb" in ARGS

GRID = {"mongrel": 0.0028, "draught": 0.0034, "schipperke": 0.0019, "terrier": 0.0022, "cat": 0.0014, "pig": 0.004}
TRIS = {"mongrel": 8500, "draught": 9000, "schipperke": 8000, "terrier": 8000, "cat": 6500, "pig": 9000}


def harness_fit(Bd, J, H):
    """The cross-section of the chest just behind the forelegs: where a breast band sits."""
    z = J["elbowL"][2] - 0.06 * H
    ys = np.linspace(0.2 * H, 1.2 * H, 400)
    pts = np.stack([np.zeros_like(ys), ys, np.full_like(ys, z)], 1)
    inside = Bd.sdf(pts) < 0
    yy = ys[inside]
    top, bot = float(yy.max()), float(yy.min())
    yc = (top + bot) / 2
    xs = np.linspace(0, 0.6 * H, 300)
    pts = np.stack([xs, np.full_like(xs, yc), np.full_like(xs, z)], 1)
    half = float(xs[Bd.sdf(pts) < 0].max())
    return dict(bone="chest", centre=[0.0, round(yc, 4), round(z, 4)], radius=[round(half, 4), round((top - bot) / 2, 4)])


def build_rig(rig, variants, report):
    t0 = time.time()
    name = rig["name"]
    H = rig["H"]
    Bd = body.build(rig)
    first = variants[0]["name"]
    ob, parts, ear_j = mesh.build_rig_mesh(first, Bd, GRID[name], TRIS[name])
    for S_ in "LR":
        b0, b1, b2 = ear_j[S_]
        rig["J"]["ear" + S_] = tuple(b0)
        rig["J"]["earMid" + S_] = tuple(b1)
        rig["J"]["earTip" + S_] = tuple(b2)
        Bd.J["ear" + S_], Bd.J["earMid" + S_], Bd.J["earTip" + S_] = b0, b1, b2
    lod1 = mesh.far_copy(ob, parts, 1150 if name != "pig" else 1250)
    tris0, tris1 = mesh.tri_count(ob), mesh.tri_count(lod1)
    # the pictures
    coats = [v["coat"] for v in variants]
    if "--nopaint" in ARGS:
        pics = {c: np.full((animals.TEX, animals.TEX, 3), 0.6, np.float32) for c in coats}
        nmap = np.full((animals.TEX, animals.TEX, 3), (0.5, 0.5, 1.0), np.float32)
    else:
        pics, nmap, F = paint.paint_rig(ob, Bd, parts, rig, coats, size=animals.TEX)
    nimg = export.image(name + "_normal", nmap, colour=False)
    from animals import pictures
    png_hashes = {} if "--nopaint" in ARGS else {name + "_normal.png": pictures.write(name + "_normal", nmap, normal=True)}
    if "--nopaint" not in ARGS:
        for v in variants:
            png_hashes[v["name"] + "_colour.png"] = pictures.write(v["name"] + "_colour", pics[v["coat"]])
    # what the pictures are: a SHA-256 of each one's 8-bit pixels (top row first), for assets/ATTRIBUTION.md
    import hashlib
    hashes = {name + "_normal": hashlib.sha256((np.clip(nmap, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()).hexdigest()}
    for c_, img_ in pics.items():
        hashes[c_] = hashlib.sha256((np.clip(img_, 0, 1) * 255 + 0.5).astype(np.uint8).tobytes()).hexdigest()
    # the clips
    R = pose.Rig(rig)
    verts = mesh.game_co(ob)
    W = mesh.read_weights(ob)
    mask = np.array([p in clips.ground_parts() for p in parts])
    baked = []
    info = {}
    for gname, g in clips.gaits(R).items():
        design = {"walk": clips.design_walk, "trot": clips.design_trot, "run": clips.design_run}[gname](R, g)
        # one key every 1/30 s of clip time (the native glTF import resamples at 30 Hz): 60 keys a cycle, the
        # gallop's short stance 120
        poses, inf = clips.bake_gait(R, g, design, n=120 if gname == "run" else animals.FPS)
        baked.append((gname, poses, 2, dict(kind="gait", base="stand", loop=True, stride=round(g.stride, 4), cycle=round(g.secs, 4),
                                             duty=g.duty, phases=g.ph, speed=round(g.speed, 3), **inf)))
    for cname, fn, secs, kind, base in clips.clip_list(R):
        poses, inf = clips.bake_action(R, fn, secs, kind, verts, W, mask, fps=animals.FPS // 2, base=base)
        baked.append((cname, poses, 2, dict(kind="once" if cname in clips.ONCE else "pose", base=base, loop=cname not in clips.ONCE,
                                            secs=secs, **inf)))
    # the cart dog's harness (the draught rig): straps and tugs skinned to its chest and back, their own picture
    hz = None
    if rig["species"] == "dog" and name == "draught":
        from animals import harness
        hp_, tg_, hpts = harness.build(Bd)
        hpic = harness.picture()
        himg = export.image("harness_colour", hpic)
        from animals import pictures as pictures_
        png_hashes["harness_colour.png"] = pictures_.write("harness_colour", hpic)
        hmat = export.material("harness", himg, None, rough=0.7)
        hz = (hp_, tg_, hpts, hmat)
        if not bpy.data.objects.get("dog_trace"):
            tob = harness.to_object("dog_trace", harness.trace(), skinned=False)
            tob.data.materials.append(hmat)
    # the animals: an armature per kind, the meshes copied, one material each
    arms = []
    for i, v in enumerate(variants):
        ao = export.make_armature(v["name"], rig["J"])
        if i == 0:
            m0, m1 = ob, lod1
        else:
            m0 = ob.copy()
            m0.data = ob.data.copy()
            m1 = lod1.copy()
            m1.data = lod1.data.copy()
            bpy.context.scene.collection.objects.link(m0)
            bpy.context.scene.collection.objects.link(m1)
        m0.name = m0.data.name = v["name"] + "_lod0"
        m1.name = m1.data.name = v["name"] + "_lod1"
        cimg = export.image(v["name"] + "_colour", pics[v["coat"]])
        mat = export.material(v["name"], cimg, nimg, rough=0.85)
        sheen = paint.COATS[v["coat"]].get("sheen", 0.05 if rig["species"] != "pig" else 0.08)
        if hz is not None:
            from animals import harness
            for piece, suffix in ((hz[0], "_harness"), (hz[1], "_harness_tugs")):
                hob = harness.to_object(v["name"] + suffix, piece)
                hob.data.materials.append(hz[3])
                export.attach(hob, ao)
        for m in (m0, m1):
            m.data.materials.clear()
            m.data.materials.append(mat)
            export.attach(m, ao)
            # the coat's sheen in the shader's eye channel (vertex red: 0 dull, 0.45 the wet nose, 1 the eyes): the
            # glossy guard hairs of a black coat catch the light, so its shape reads in sun and under the lamps
            at = m.data.color_attributes.get("Col")
            if at is not None:
                c = np.zeros(len(at.data) * 4, np.float32)
                at.data.foreach_get("color", c)
                c = c.reshape(-1, 4)
                low = c[:, 0] < 0.3
                c[low, 0] = sheen
                at.data.foreach_set("color", c.ravel())
        arms.append(ao)
    rest = export.rest_mats(arms[0])
    clip_info = {}
    for cname, poses, step, inf in baked:
        act = export.key_poses(arms[0], name + "_" + cname, poses, rest, step=step)
        export.park(arms[0], act)
        inf["frames"] = len(poses) * step
        inf["secs"] = round(len(poses) * step / animals.FPS, 4)
        clip_info[cname] = inf
    J = rig["J"]
    contacts = {k: dict(bone=anatomy.LEGS[k][0][-1], rest=[round(float(c), 4) for c in J[anatomy.LEGS[k][1][-1]]]) for k in anatomy.LEGS}
    facts = dict(rig=name, species=rig["species"], H=H, clips=clip_info, contacts=contacts, bones=len(anatomy.NAMES),
                 triangles=[tris0, tris1])
    if rig["species"] == "dog":
        facts["harness"] = harness_fit(Bd, J, H)
        if hz is not None:
            bone_of = {"traceL": "chest", "traceR": "chest", "tugL": "spine", "tugR": "spine"}
            facts["harness"]["points"] = {k: dict(bone=bone_of[k], rest=[round(float(c), 4) for c in p]) for k, p in hz[2].items()}
    for ao in arms:
        export.set_extras(ao, dict(facts, kind=ao.name))
    report[name] = dict(triangles=[tris0, tris1], vertices=len(ob.data.vertices), secs=round(time.time() - t0, 1), pictures=hashes, pngs=png_hashes,
                        clips={k: {kk: vv for kk, vv in v.items() if kk in ("stance_miss_mm", "drop_mm", "wave_mm", "ik_miss_mm", "secs")}
                               for k, v in clip_info.items()})
    print(f"[animals] {name}: {tris0}/{tris1} triangles, {len(ob.data.vertices)} vertices, {len(clip_info)} clips, "
          f"{time.time() - t0:.1f} s")
    for k, v in clip_info.items():
        print(f"[animals]   {name}_{k}: " + ", ".join(f"{kk} {vv}" for kk, vv in v.items() if kk in ("stance_miss_mm", "drop_mm", "wave_mm", "ik_miss_mm", "secs", "stride")))
    return dict(rig=rig, Bd=Bd, arms=arms, R=R, baked=baked, ob=ob, parts=parts, verts=verts, W=W)


def shape_only(rigs):
    """--shape: the bodies alone, meshed as the game gets them, in plain clay views (.scratch/animals-build/shape)."""
    for rname, rig in rigs.items():
        if ONLY and rname not in ONLY:
            continue
        t0 = time.time()
        Bd = body.build(rig)
        if "--raw" in ARGS:
            verts, faces = mesh.surface(Bd, GRID[rname])
            ob = mesh.to_object(rname + "_raw", verts, faces)
            pcs = [mesh.ear(Bd, S_, rig["P"]["ears"])[0] for S_ in "LR"]
            pcs += [mesh.eyeball(c, look, r, shape=lids) for c, look, r, lids in Bd.marks.get("eyes", [])]
            if rig["species"] == "dog":
                pcs += mesh.claws(Bd, rig["H"])
            pob = mesh.pieces_object(rname + "_pieces", pcs)[0]
            mesh.select_only(ob)
            pob.select_set(True)
            bpy.ops.object.join()
            for p_ in ob.data.polygons:
                p_.use_smooth = True
        else:
            ob, parts, ear_j = mesh.build_rig_mesh(rname, Bd, GRID[rname], TRIS[rname])
        print(f"[animals] shape {rname}: {mesh.tri_count(ob)} triangles, {time.time() - t0:.1f} s")
        for o in bpy.data.objects:
            if o.type == "MESH" and o is not ob:
                o.hide_render = True
        ob.hide_render = False
        zs = [p_[2] for p_ in rig["J"].values()]
        preview.clay(rname, rig["H"], head=Bd.marks["head"], span=max(zs) - min(zs), mid_z=(max(zs) + min(zs)) / 2)
        ob.hide_render = True


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.scene.render.fps = animals.FPS
    rigs = anatomy.rigs()
    if "--shape" in ARGS:
        shape_only(rigs)
        return
    report = {}
    built = {}
    for rname, rig in rigs.items():
        if ONLY and rname not in ONLY:
            continue
        vs = [v for v in anatomy.VARIANTS if v["rig"] == rname]
        built[rname] = build_rig(rig, vs, report)
    os.makedirs(animals.SHOTS, exist_ok=True)
    with open(os.path.join(animals.SHOTS, "..", "build-report.json"), "w", encoding="utf-8") as f:
        json.dump(report, f, indent=1)
    if not NOGLB:
        from animals import slim
        if PLAIN:
            export.stand_ins(lambda: export.export_glb(PLAIN, plain=True))
            slim.slim(PLAIN)
            print(f"[animals] plain -> {PLAIN} ({os.path.getsize(PLAIN) // 1024} KB)")
        if not ONLY:
            export.stand_ins(lambda: export.export_glb(OUT, plain=False))
            slim.slim(OUT)
            print(f"[animals] -> {OUT} ({os.path.getsize(OUT) // 1024} KB)")
    if PREVIEW or CLIPS:
        from animals import checks
        checks.run(built, preview=PREVIEW, clips=CLIPS)
    if "--verify" in ARGS:
        from animals import checks
        checks.verify_keys(built)
        checks.dump_toes(built)
    if "--debug" in ARGS:
        from animals import checks
        checks.debug(built, ARGS[ARGS.index("--debug") + 1].split(","))


if __name__ == "__main__":
    main()
