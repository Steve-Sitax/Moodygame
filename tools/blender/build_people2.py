"""Build the people2 kit: the 60-bone skeleton and the base bodies (docs/people.md).

    blender -b --factory-startup -P tools/blender/build_people2.py [-- --preview] [--cast] [--out PATH] [--only a,b]

Writes client/public/models/people2.glb (ten base bodies, each an armature with a near and a far skinned mesh,
and the 36 old clips keyed on the new rig) and shared/peopleRig.json (bones, sockets, grab marks, the Godot BoneMap,
every body's joints and figures). people.glb is not touched: the games switch later (packages E and F).

--preview  data/shots/people2/bodies_front.png, _side, _back, _closeups (every body, lit, no fog)
--cast     the checks, in data/shots/people2/: turntable_3m.png and turntable_10m.png (in the game's fog),
           clips_<body>.png (every old clip on the body, a contact sheet), bends.png (knees and elbows at 120 degrees,
           shoulders up, a body lying and dragged), sockets.png (a stick in each socket), grab.png (two people: a
           grab from behind), and the bend measures printed.
--only     build only these bodies (trials; the glb then has only them)
--out      write the glb somewhere else (trials)
"""

import os
import sys
import time

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
import numpy as np  # noqa: E402

import people2  # noqa: E402
from people2 import body as bd  # noqa: E402
from people2 import clips_legacy, export, lod, paint, rig, weights  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
OUT = people2.OUT
if "--out" in ARGS:
    OUT = os.path.abspath(ARGS[ARGS.index("--out") + 1])
ONLY = ARGS[ARGS.index("--only") + 1].split(",") if "--only" in ARGS else None
TEX = 2048
UV_SCALE = {"head": 2.7, "finger_": 1.15}


def make_body(name, base, build, ref_uv):
    P = bd.params(base, build)
    C = bd.build(P)
    cage = bd.to_mesh(C, name + "_lod1")
    W = weights.cage_weights(C, P)
    weights.apply(cage, W, limit=0)
    if ref_uv is None:
        lod.uv_unwrap(cage, UV_SCALE)
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
    cparts = weights.parts(cage)
    Wc = weights.read(cage)
    for vg in list(cage.vertex_groups):
        if not vg.name.startswith("part_"):
            cage.vertex_groups.remove(vg)
    weights.apply(cage, Wc, limit=4)
    lod.to_limit(cage)
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


def main():
    t0 = time.time()
    bpy.ops.wm.read_factory_settings(use_empty=True)
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
    for sex, ref in (("m", "man_middling"), ("f", "woman_middling")):
        src = next((b for b in bodies if b["name"] == ref), bodies[0])
        pos, nrm, part, names = paint.position_map(src["lod0"], TEX, src["vparts"])
        rgb = paint.paint_skin(pos, nrm, part, names, src["P"], female=(sex == "f"))
        img = paint.to_image("people2_skin_" + sex, rgb, os.path.join(people2.SHOTS, "skin_%s.png" % sex))
        mats[sex] = export.material("people2_skin_" + sex, img)
    for b in bodies:
        for ob in (b["lod0"], b["lod1"]):
            ob.data.materials.clear()
            ob.data.materials.append(mats["f" if b["P"]["female"] else "m"])
            for vg in list(ob.vertex_groups):
                if vg.name.startswith("part_"):
                    ob.vertex_groups.remove(vg)
    actions = clips_legacy.make_actions(bodies[0]["ao"], bodies[0]["J"])
    export.export_glb(OUT)
    export.rig_json([(b["name"], b["P"], b["ao"], b["counts"]) for b in bodies],
                    {"clips": [a.name for a in actions],
                     "lod": {"lod1From": 15.0, "note": "LOD1 also for the mirrors and the lantern shadow"}})
    kb = os.path.getsize(OUT) // 1024
    print(f"[people2] {len(bodies)} bodies, {len(rig.NAMES)} bones, {len(actions)} clips -> {OUT} ({kb} KB) "
          f"in {time.time() - t0:.0f} s")
    if "--preview" in ARGS or "--cast" in ARGS:
        from people2 import preview
        if "--preview" in ARGS:
            preview.bodies_sheet(bodies, mats)
        if "--cast" in ARGS:
            preview.cast(bodies, mats, actions)


if __name__ == "__main__":
    main()
