# People: the people2 kit (skeleton, base bodies, kinds)

Packages A, B and the first pass of C of the people plan (`docs/plans/people.md`, section 3); since 2026-10-13 the
bodies, faces and sliders come from MakeHuman's CC0 core assets ("Bodies from MakeHuman" below, tools and licences in
[makehuman.md](makehuman.md)). The native game's new people are built on this kit: one 64-bone skeleton for everybody, ten base bodies with faces, hands and hair (B), and
the dressed kinds (C, "Kinds and clothes" below). Clothes and kinds (C), motion
(D), the native Godot runtime (F), Jef (G), fight motion (J) and weapons (K) all build on it. The native runtime uses every dressed people2 kind by default; other kinds keep the original people scene.

## Build

```
blender -b --factory-startup -P art-source/tools/blender/build_people2.py -- [--preview] [--cast] [--move] [--faces] [--hands]
    [--sheet] [--only a,b] [--out PATH] [--plain .scratch/people2-plain/people2.glb] [--kinds a,b | --nokinds] [--dress] [--no-move]
    [--idle] [--no-idle] [--fast]
```

MPFB 2.0.18 must be installed the isolated way and `BLENDER_USER_RESOURCES` set for every build
([makehuman.md](makehuman.md)). A full build with every clip takes about 13 minutes (2026-10-13). Before MakeHuman:
Blender 5.2 (`C:/Program Files/Blender Foundation/Blender 5.2/blender.exe`), about 3 min (B's head is meshed once
per build: about 1 min); the four kinds add about 3 min; `--cast` adds about 4 min, `--move` (the motion checks)
about 2 min, `--faces --hands --sheet` about 4 min, `--dress` (C's checks) about 4 min, D2's clips about 3 min and
`--idle` (their pictures) about 12 min.

| Writes | What |
|---|---|
| `art-source/client/public/models/people2.glb`, `people2_<group><chunk>.glb`, `people2_parts.json` | Clothing-group parts (up to three kinds each), plus ten base bodies: 65 dressed kinds (51 town outfits and 14 player cuts), with near/far meshes and sparse shape keys. The core holds `man_middling`, `people2_held` and all 253 shared clips; each remaining group or base body loads on demand. Every art/native/morph file is below 20 MB. Pictures live in `native-godot/assets/people2-pictures`. |
| `art-source/shared/peopleRig.json` | the bones, sockets, grab marks, the Godot BoneMap, the grips and the shape keys, per body its joints, marks, figures and counts, `locomotion` (every D1 clip's speed, cycle, stride, travel and checks; the blend rule; the loads and handles), `idles` (D2 families, seats and clip checks), `heightFactor`, `oldStance`, and C's `kinds`, `held` and `pictures` manifest |
| `art-source/shared/peopleSliders.json`, `faceTypes.json` | the sliders and the face types, pictures, cast and face recipe ("Bodies from MakeHuman" below) |
| `art-source/third_party/makehuman/USED.json` | (full builds) the MakeHuman files the build read: nothing else is kept there |
| `.scratch/people2-build/shots/*.png` | the check pictures (not in git) |

Native intake replaces the retired Node decoder and model bake. `--plain` writes a second, dense-morph,
uncompressed-geometry GLB outside the art archive; the compressed art master remains in art-source.
Run `recovery/recover-game-models.tscn -- --source-models <plain-folder> --resume-intake yes --only people2`
through the bounded engine helper (see `docs/godot-people2.md`). It adds `native-godot/assets/game-models/people2.scn`,
its external resources and extras, preserving existing scenes and merging both intake manifests.
After rebuilding, `pwsh -File native-godot/scripts/replace-people2.ps1` replaces only people2, installs its matching rig
and prepares the native pack. It verifies all other model files and manifest entries; see `docs/godot-people2.md`.
Copy the authored rig to `native-godot/world/data/shared/peopleRig.json`, register `shared/peopleRig.json`
in the loose data manifest, then run `native-godot/scripts/prepare-native-package.ps1`. Future `faceTypes.json`
uses the same shared-data registration. `Paths.Shared` reads the extracted checksummed native pack.

The kit, `art-source/tools/blender/people2/`:

| File | Does |
|---|---|
| `__init__.py` | paths, the axis change `B()` (game to Blender) and `G()` (back) |
| `body.py` | the bodies: figures, landmarks, the quad cage, the stoop, `girths()` |
| `rig.py` | the 64 bones, their joints per body, the Godot names, the grab marks |
| `weights.py` | skin weights by rule; the finger sharpening |
| `lod.py` | UV unwrap and island layout, the subdivision (LOD0), the limit surface (LOD1) |
| `paint.py` | the position map, the occlusion bake and the base skin pictures |
| `clips_legacy.py` | the 36 old clips keyed on the new rig |
| `motion.py` | the motion tools (D1, for every clip package): FK, IK, holds, feet, curves, joining, foot lock, keying, checks |
| `clips_move.py` | the locomotion clips (D1): the gait maker, the walkers, climbs, carries, start, stop, turns, the speed blend |
| `clips_idle.py` | the idles, talk and sitting (D2): the standing and seated solver, arm places and tracks, gestures, the families' clips, sitting down and getting up |
| `clips_work.py` | the work (D3): the work stance, kneeling legs, fists on handles (the grip sockets), the things a clip moves (the sack, a broom, a cask), the sack lifted, held, set down and passed, and the old work clips re-made |
| `preview_work.py` | the work check pictures (`--work`) |
| `export.py` | the glb, the materials, `peopleRig.json` |
| `glb_slim.py` | after the export: drops the animation channels that never move (3 MB of JSON), thins D2's keys and repacks the buffer |
| `preview.py` | the check pictures |
| `preview_move.py` | the motion check pictures (`--move`) |
| `preview_idle.py` | the idle, talk and sitting check pictures (`--idle`) |
| `sdf.py` | (B) signed distance tools: shapes, soft blends, surface nets, decimation, pulling points onto a surface |
| `head.py` | (B) the head: its anatomy as a field, the one reference mesh, bodies and face shapes as moves of it, eyes, UVs, weights, the join to the neck |
| `face_paint.py` | (B) the face painter: the head's square of the picture and its normal map, from a look |
| `hands.py` | (B) the hands: palm, fingers, thumb in the cage; the docker's hand; grips; the hands' paint |
| `hair.py` | (B) hair styles, beards, moustaches; hair cards for the named cast |
| `preview_b.py` | (B) the face, hand and hair check pictures and the grip fit |
| `clothes_kit.py` | (C) the shared cloth functions: garments with thickness, their weights, the painter, the UVs |
| `dress.py` | (C) a kind's settings (`Kind`) and how a kind is made (`build`), its face (`face_of`) |
| `pictures.py` | Independent 1024 px clothes/face layers, detail zones, shared 512 px grain and a stable manifest |
| `atlas.py` | Historical atlas code; image resizing helpers remain shared |
| `held.py` | (C) held things, one model each: the sabre, its scabbard, the truncheon, the basket of herring |
| `kinds_workers.py`, `kinds_women.py`, `kinds_uniform.py`, `kinds_cast.py` | (C1-C4) the kinds, one group a file |
| `preview_c.py` | (C) the kinds' check pictures (`--dress`) |

## Bodies from MakeHuman (2026-10-13)

The owner's decision of 2026-10-13: the kit's own heads looked odd and alike, so the bodies, faces and their
sliders are now made from MakeHuman's CC0 core assets. What the tools are, their licences and how to install MPFB:
[makehuman.md](makehuman.md). The skeleton, sockets, grab marks, clips, clothes and export path stay the kit's.
Sections further down that describe the cage bodies' topology, UVs, weights, head, face painter, hands and hair
(`body.py`'s cage, `head.py`, `face_paint.py`, `hands.py`, `hair.py`) are the history of the first kit: the
build makes the bodies as below (the cage `C` is still made for every body and fitted onto its MakeHuman surface,
because the clothes are built on it).

| File | Does |
|---|---|
| `mh.py` | MakeHuman's files (read as data), MPFB's macro target stack (`macro_stack`), the targets as sparse moves, MakeHuman's CC0 weights summed onto our 64 bones, `Pose` (MakeHuman's A pose to our rest pose, one affine per vertex), `Binding` (the MakeClothes way of carrying any mesh on the base mesh), `MhAsset` (`.mhclo`/`.proxy`), the check of our copies against MPFB's |
| `mhbody.py` | `Body` (a base and build: the macro mix, the pose, the table height, the old stoop), `topology(lod)` (the near and far copies: one reduced topology each, bound to the base mesh), `make_body`, the shoulder and finger weight rules, the eyes, the hair pieces |
| `sliders.py` | the 51 sliders (`SLIDERS`), their shape keys and `shared/peopleSliders.json` |
| `face_types.py` | the 22 face types and the builds as slider presets, the 30 face pictures (`CELLS`), the named cast, `face_for` and `shared/faceTypes.json` |
| `mhskin.py` | MakeHuman's skins in our layouts, the body pictures (underwear for the base bodies, a kind's own paint), `bodyTone` |
| `mhface.py` | the face pictures: a MakeHuman skin plus our painter (tone, weathering, flush, a drinker's nose, pox, freckles, soot, stubble, scalp hair, MakeHuman's brows and lashes baked in, the eye), the hair swatches |
| `mhhair.py` | hair styles, beards and moustaches as shells and tubes on the head |
| `preview_mh.py`, `../people2_sheets.py` | the check sheets (below) |

### The bodies

Each body is MakeHuman's base mesh (hm08) with the macro setting of its base and build (gender, age, weight,
muscle; MPFB computes which macro targets mix and how much), turned from MakeHuman's A pose into our rest pose
(arms hanging, palms to the thighs, legs straight, feet forward: `mh.Pose`), scaled to the table heights above
(1.67, 1.57, 1.27, 1.64, 1.54 m) and, for the old, stooped by `body.stoop_fn`. Our skeleton's joints are measured on
that posed body (`rig.py` with `P["mh"]`); the bone directions and names stay the kit's, so every clip plays.

- **Near and far copies.** One reduced topology each, made once from the base mesh (`mhbody.topology`): the trunk,
  limbs, hands and feet halved both ways where MakeHuman's quads form a grid (every other loop kept), then each region
  collapsed to its budget (`LOD0`, `LOD1`); MakeHuman's face keeps its density. UV seams between islands and the cuts
  inside the trunk's and head's islands are never collapsed (a face across a cut showed a shard of stretched
  picture). Every copy vertex is bound to the base mesh (`mh.Binding`, binding error about 1e-7 m), so every body and
  every slider is the same topology moved.
- **Weights.** MakeHuman's own CC0 weights (MPFB's default rig), summed onto our bones (`mh.mh_to_ours`), then the
  kit's shoulder rule (the helpers take the armpit and the deltoid's round) and a finger rule (one bone per finger
  segment with a 3.5 mm blend at each joint, 9 mm at the thumb's root; the little finger follows the ring finger's
  bones but bends at its own joints). At most 4 bones a vertex.
- **Eyes.** MakeHuman's low-poly eyes on their helper, weighted to `eyeL`/`eyeR`, the eye picture in the face
  square's corner (its iris a little quieter than MakeHuman's).
- **Counts** (the same topology for every body): near copy about 8,790 triangles (face 2,682, scalp 289, ears 259,
  neck 241, trunk 1,342, arms 1,045, hands 1,130, legs 1,104, feet 698: bare feet keep their toes at their
  picture's density) plus the eyes 172; far copy 1,740 plus the eyes: 1,912. Hair pieces on top: see "Hair" below (round 4: about 1,500 to 3,900 near triangles a style).
- **Checks of the build** (2026-10-13, every body): skin triangles facing against their corners' normals 3 near and
  7 to 15 far at rest (up to 22 near with every slider at +1; 0 on the dressed kinds' skin); triangles whose UV winding
  is turned within their island about 130 near (MakeHuman's eyes, finger and toe slivers; 338 before the reduced faces
  turned over were read again from the base mesh) and 12 far; no degenerate triangles. The build compares its 234
  base files with MPFB's own: 0 differ.

### Sliders (`sliders.py`, `shared/peopleSliders.json`)

51 sliders, each one or two of MakeHuman's CC0 targets moved through the body's pose, scale and stoop: 44 for the
face and head (head height, width and depth; round, square, oval, fat; forehead, brow; eyes: size, spacing, height,
opening, hooded lids, slant, bags, fold; nose: length, width, projection, hump, hook, tip, bulb, nostrils; mouth
width, lips, mouth projection and corners; cheekbones, cheeks; chin projection, width, height; jaw width and height;
ears; neck; double chin; two origin sliders) and 7 for the body (weight, muscle, belly, shoulders, hips, buttocks,
bust; from MakeHuman's macro and body targets). A value runs from -1 to 1 (one-way sliders 0 to 1). A two-way slider
whose two targets mirror each other is one signed shape key `s_<name>`; otherwise two keys, `s_<name>` (plus side)
and `s_<name>_neg`. The near copies carry every slider; the far copies the body ones; hair, beard and moustache
pieces the ones that move them; the kinds' clothes carry the body sliders and the head ones under a hat (each
garment point takes the mean move of the skin round its nearest skin point, over a reach of 8 mm, or two thirds of
its distance from the skin: a cap's peak follows the forehead, not one small triangle of the nose).
`peopleSliders.json` lists for each: group, keys, signed, range, default (0), `player` and `playerRange` (the
character creator below), MakeHuman's targets and a description.

### Faces in the game

**Types and builds are presets.** Each of the 22 face types (`face_types.TYPES`: Flemish docker, fat publican,
Walloon, Dutch skipper, Scandinavian, German emigrant, British stoker, southern sailor, Levantine, African sailor,
Chinese cook, pale clerk, gentleman, gaunt porter and the women's, children's and old people's types) gives each
slider a mean and a spread (the old face axes, `AXIS_MIX`, turned into sliders, times `TYPE_GAIN` 1.35 so types read
apart at 5 m), its face pictures, hair, beard and moustache weights; the builds do the same for the body sliders.
`face_for(seed, kind, sex, age)` draws a person from their stable id: the type (by kind and origin), every slider
round its mean (Irwin-Hall normal, clamped to the slider's range), the face picture, hair (a kind's own hair under
its hat: `KIND_HAIR`), beard, moustache, a crooked nose. The named cast has fixed faces (`CAST`).
`shared/faceTypes.json` carries the tables, the random number recipe (FNV-1a of `<kind>:<seed>`, mulberry32) and
test vectors; the game's `People2Faces.FaceFor` is the same recipe in C# and checks itself against the vectors.

**Identity meshes and live faces (round 4).** Intake keeps authored sliders and expressions in the sparse
morph file. `People2.Make` copies the rig without constructing an identity mesh. `SetIdentity` queues the real
stable id; a single worker applies sliders, normal changes and merges the selected hair using managed arrays.
`People2Warmup` creates throwaway far/near meshes during loading. Its process uploads at most one mesh per frame
on the main thread: far first, near only within 15 m. Finished builds are shared by id/kind, with 128 completed
identities retained for respawns. A far template covers the short wait for the first finished far mesh.

Near meshes retain exactly `blink`, `brow_raise`, `smile`; far meshes have no blend shapes. `People2Eyes` closes
lids at varied 2.2–8 second intervals (occasional double blink), makes saccades, looks at a nearby speaker or
Jef within 6 m, and stops expressions/eyes beyond 15 m. Its update uses cached nodes and value types. Eye opening
is reduced in the baked recipe without changing the stable face slider contract. Young bald men keep an
age/sex-compatible picture when their group has no bald cell; they never borrow an old man's portrait.

### Indirect occlusion and wet surfaces

`export.bake_occlusion(ob, blockers=None, reach=.18, samples=12)` ray-samples the rest mesh after reduction,
writing hemisphere visibility to vertex blue: 1 open, minimum .22. Cloth/hair lanes can pass sibling blockers
in the same rest frame. Red (eye), green (face-picture selector) and alpha (coverage) are preserved. The final
export bakes each unbaked body's geometry; the shader multiplies only sky/indirect light by blue, keeping lamp
spill and direct light separate. Dry roughness: skin .76, wool .94, linen .87, canvas .91, leather .62, metal
fittings/zone zero .42, hair .48, eyeball .12. `psx_wet` darkens absorbent cloth and reduces roughness for wet
sheen in the existing shader; no shader kind or light is added. Base underwear has darker, uneven worn linen.

### Skin and face pictures

30 face pictures (`face_types.CELLS`, 1024 px colour and lossless normal in the face layer): MakeHuman's head island
over the full square, the inside of the mouth, the eye sockets, the eye's picture and two hair swatches (strands, a
plait's weave). Their base is one of nine MakeHuman skins (young, middle-aged and old; light, dark and East Asian
skinned; men and women) moved into our layout; our painter adds the rest. Toward the seam under the jaw and the nape
the face's own paint fades into its plain skin; `bodyTone` (per picture, in `faceTypes.json cells`) is that plain
skin over the body picture's skin along the seam, so the body's skin (times `body_tone` in the shader) meets the face
without a step. The body pictures: MakeHuman's skin of the body's group, the hands' weather, the base bodies' worn
linen drawers and vest (by height, not by part: a part's edge is a staircase of triangles), a kind's own paint
(stockings, chapped hands). Dressed skin keeps its skin colour: rest-pose `undershirt` and `under_cloth` paint
produced dark patches when a bent sleeve exposed the arm. Garment clearance is handled by geometry.

### Hair (`mhhair.py`, round 4)

Period styles of Antwerp in 1873, each one piece per base body (`<body>_hair|beard|mous_<style>_lod0/1`), bound to
the base mesh (they carry the face and body sliders) and merged into the person at spawn as before.

- **Men:** `crop` (a centimetre on top, short at the sides), `side` (a parting on the left, the top combed over in
  locks, oiled), `long` (a workman's hair over the ear tops and to the collar, locks from the crown, forelocks),
  `bald` (the crown bare, a fringe thinning up into it), `capped` (a crop under a cap or kepi: full below the hat's
  band, pressed to under 3 mm above it and gone 1 to 2 cm higher). The old man's body builds its styles with a
  receding line. Beards: `full`, `short`, `chops` (cheeks to the mouth's corners, the chin shaved round), `sideburns`,
  `chin` (a chin curtain), `imperial`; moustaches `walrus`, `chevron`, `handlebar` (waxed points). Beards never grow
  on the upper lip (the moustache's).
- **Women:** parted in the middle, smoothed over the top, brought down over the temples and the ear tops and drawn
  back to a knot low on the back of the head (`bun`); two plaits pinned round the back (`plaits`); plaits over the
  crown (`coronet`); under the linen cap (`undercap`: the front shows, behind the cap's edge it lies under 4.2 mm
  with a flat knot). The old woman's hair is thinner, the knot smaller. **Children:** boys `crop`, girls two plaits
  hanging behind the ears (weighted over to the neck and chest as they hang).
- **How a scalp style is made (`Shell`):** a fine sphere of directions from the head's middle; per direction the
  style's coverage (1 where its hair is full, to 0 past its hairline), thickness and flow (u round, v along the
  strands: from the crown's whorl, or into the knot for women), cut along coverage 0.02 and along the middle line
  (the strands' UVs mirror there), laid on the skull and neck (ears left out, MakeHuman's full head under the near
  copy) and out by the thickness, which grows over the whole fade band (no ledge); women's hair passes over the ear's
  top; reduced to its budget with the fade band's points kept. Fuzz layers (the same shell 1.5 to 2 mm further out,
  fewer strands) soften the silhouette; locks (`lock`: tapered three-point ribbons along the flow, sparser at their
  edges, faded wherever the style's own coverage fades) give the clumps, the parting and the sweep; knots and plaits
  are tubes with a fuzz tube round them.
- **Beards and moustaches (`SkinShell`):** MakeHuman's face cut along the beard's coverage, out by a thickness that is
  thin on the cheeks and long at the chin, with clumps, two fuzz layers and locks hanging up to 1.6 cm past the lower
  edge; moustaches are a small shell on the upper lip under fanned locks.
- **Pictures (`paint_swatches`, called by `mhface.paint`):** drawn strand by strand in the face picture's hair:
  `HAIR_RECT` shell strands, `BRAID_RECT` the weave, `LOCK_RECT` (0.815..0.985, 0.015..0.385) four locks root to
  tip (two fine, one coarse, one waxed point), `BEARD_RECT` (0.555..0.785, 0.805..0.990) coarse beard strands. Grey
  and white are pigment and white strands mixed one by one (`PIGMENT`); the African sailors' cells get tightly
  coiled hair. A bald crown is painted as clean skin from the forehead's colour (MakeHuman's old skins carry painted
  stubble there: the "ginger scalp"); the fringe takes the cell's mixed grey.
- **Under hats:** every dressed kind with authored headwear registers fitted hair in `KIND_HAIR`, including children;
  men use `capped`, women `undercap`, preserving explicit recipes such as the tourist lady's bun. The hats'
  lines in head angles are `CAP_EL` and `HOOD_EL` in mhhair (measured on the built kinds; change them with the hats).

**The fade contract (for the people2 shader):**

| Channel | Who writes it | Meaning |
|---|---|---|
| vertex colour alpha (`picture_flags.a`) | hair, beard and moustache pieces (1 on every other mesh) | the piece's coverage 0..1: 1 every strand drawn, 0 none (the faded hairline, beard edge, a lock's root, a fuzz layer's share) |
| face picture alpha | `mhhair.paint_swatches` | 1 everywhere but the hair swatches; there the strands' coverage 0.02..0.98, spread evenly so a vertex alpha a keeps about the share a of the strands (top strands first) |
| vertex colour blue | hair pieces | baked occlusion 0..1 (1 open), lower deep in the hair and at a lock's edges |

The rule: **a face-flag fragment is kept where picture alpha + vertex alpha > 1** (an alpha scissor, no blending, no
dither; skin has 1 + 1). Hair fragments are face-flag fragments with picture alpha < 0.99 (for a hair roughness). The
runtime must keep the pieces' vertex alpha when it captures them (`People2Faces.Capture` set it to 1).

**Counts (near / far copy, man_middling):** crop 2,280 / 266, side 2,240 / 266, long 2,426 / 273, bald about 2,150 /
254, capped 1,520 / 248; full beard 3,222 / 200, short 1,914, chops 2,004, chin 2,178, sideburns 740, imperial 84;
walrus 980, chevron 840, handlebar 696. Women's styles 3,100 to 3,900. Slider morphs of the pieces: about 3.4 MB per
men's body in `morphs.bin` (the morph file grows by roughly 15 MB).

### Clothes on the MakeHuman bodies

The garments use the cage's actual body/armature rest positions (`C.co`, including the old-age stoop).
The old woman's nearest-surface fit folded its shoulders and sleeves; her closed blouse instead follows the
measured skin topology, and her shawl bridges convex blouse sections (`cloth_fit.py`). The old cage retains its
measured landmarks for the remaining patterns. Since round 4
(2026-10-13) the near copy of a dressed kind has 14,000 triangles for body and clothes (16,000 for the named cast),
the far copy 2,500, and the clothes go through `clothes_build.py` (below, "Clothes: high detail"): garments reduced
together with their hems and seams protected, complete clothing layers retained, UVs and paint after the reduction, the skin under
the cloth chosen by rays, occlusion baked into vertex colour blue.

### Checks (`people2_sheets.py`)

```
set BLENDER_USER_RESOURCES=<worktree>/.scratch/blender-user
blender -b <the build's scene: PEOPLE2_SAVE_BLEND> --python-exit-code 1 -P art-source/tools/blender/people2_sheets.py
    -- [types] [crowd] [lineup] [poses] [hands] [kinds]
```

Pictures in `.scratch/people2-build/shots/mh/`: `types_06m.png`, `types_2m.png` (the 22 types, front and
three-quarter), `crowd_2m.png`, `crowd_5m.png` (40 people from `face_for`), `bodies_front/side/back.png` and
`bodies_front_lod1.png`, `poses.png`, `hands.png` (relaxed, fist, grip, open), `kinds.png` (the four kinds close).
A trial build (`--out x.glb`) writes its pictures beside the trial glb; the sheets read a trial with
`PEOPLE2_RIG=<x_rig.json>` and `PEOPLE2_PICTURES_DIR=<its people2-pictures>`.

### Cost (measured 2026-10-13)

Measured in the native game at the Vismarkt (crowd proof) and in the build:

| What | Measure |
|---|---|
| Art glb (Draco, 235 clips) | 16.8 MB |
| Plain intake glb (dense morphs; `.scratch` only) | 210 MB |
| `morphs.bin` (sparse half floats, 162 meshes, 1.19 million vertex moves) | 16.7 MB; the same as dense Godot blend shapes: over 100 MB |
| Bake at spawn, `People2Faces.Bake` (near and far mesh, hair merged) | 3.5 to 3.8 ms mean (crowd proof 97 bakes, routing proof 50); the first bake of a run about 65 ms (the code's first run) |
| Live Godot blend shapes for comparison: 50 static copies of man_middling's near mesh in view, 0 / 8 / 24 / 51 sliders live and moving (90 frames each) | GPU 1.12 / 1.14 / 1.14 / 1.15 ms; render thread 1.74 / 1.77 / 1.73 / 1.78 ms |
| People pictures in video memory (30 faces, 15 clothes layers, details; BC7/BC5 with mips) | 130 MB |
| People per frame (timing proof, the 1.5 ms gate; two runs, neither exclusive: other helpers' engines ran during 147 of 173 and 136 of 178 samples) | people and animals 1.27 / 1.15 ms mean at the Vismarkt (51 / 50 drawn), 0.87 / 1.02 ms at the Grote Markt (52 / 55 drawn): the gate passed in both |

So N = all 51: Godot's blend shapes would be cheap on this PC's GPU, but they cost their dense storage in every
near mesh (about 5 MB each for 51 keys) and a value per slider per person; the bake makes a person cost what a body
without sliders costs, every frame, and pays once at spawn instead. A town that spawns several people in one frame
pays about 3.5 ms each there (see the known limits).

### The native character creator (package G)

The native screen has a turning 3D preview, face-type presets and twenty curated MakeHuman controls, each within
its authored `playerRange`; age supplies `face_age`. Skin, hair, separate beard/moustache choices, clothes and
period colours are stored in the existing profile, with sparse slider overrides rounded to hundredths. The same
recipe drives the preview, first-person sleeves/hands and planar-reflection body. The separate Jef clothing intake
still supplies the final selectable cuts/hats; work clothes are the interim fallback. Runtime, geometry notes and
proof commands: [Jef in Godot](godot-jef.md).

The compact multiplayer appearance code and puppet packets stay unchanged. Other players keep the existing remote
look until [the proposed appearance message](jef-look-network.md) is approved and implemented.

### Known limits (2026-10-13)

- Fists and grips: the clips' hand shapes (`clips_legacy.HANDS`, motion packages) were set for the cage hands; on
  MakeHuman's shorter proximal finger joints a fist overshoots and the fingertips come through the back of the
  hand. The relaxed and open hands are right. The angles belong to the motion packages.
- Beard and hair edges still show small steps at 0.6 m; the far copies' hair is a coarse cap.
- A bake costs about 3.5 ms at spawn (the first one of a run about 65 ms); people who come into view together should
  be baked one per frame.

## Axes and units

Game space everywhere: x the person's left, y up, z forward (the person faces +z), metres. In the glb every bone
node's local frame is its Blender bone frame in game axes: local +y runs along the bone (head to tail). Bone rolls are
0. `peopleRig.json` gives every frame in these axes (checked against the glb: socket heads and axes agree to 0.04 mm).

## The skeleton (64 bones)

| Group | Bones (L and R where it applies) | Kind |
|---|---|---|
| trunk | hips, spine, chest, upperChest, neck, head, jaw | body |
| arms | clavicle, armUp, armLow, armTwist, hand | body |
| fingers | thumb1-3, index1-3, middle1-3, ring1-3 (the little finger is weighted to the ring chain) | body |
| legs | legUp, legLow, foot, toe | body |
| cloth | skirtF, skirtB, skirtL, skirtR, coatTailL, coatTailR | spring |
| sockets | gripR, gripL, hipL, back, headTop | socket |
| eyes (B) | eyeL, eyeR (leaves of head, at the eyeballs' centres, pointing forward) | eye |
| shoulder helpers | shoulderL, shoulderR (children of the clavicles, at the shoulder joint, armUp's own rest frame) | helper |

- **The 16 old bones** (hips, spine, neck, head, armUp/armLow/hand, legUp/legLow/foot) keep their names, rest
  directions and roll 0. New bones that sit between old ones (chest and upperChest between spine and neck, clavicles
  between upperChest and armUp) also point straight up with roll 0, so every old bone's rest turn relative to its
  parent is what it was. Measured: the 16 rest turns in `people2.glb` match `people.glb`'s (1 - |dot| under 1e-7).
  So **the old clips in `people.glb` play on these skeletons unchanged**, and so do the re-keyed ones here.
- Parents: hips > spine > chest > upperChest > neck > head > jaw; upperChest > clavicle > armUp > armLow > (armTwist,
  hand); hand > fingers; hips > legUp > legLow > foot > toe; hips > skirt, coat tails, hipL; upperChest > back;
  head > headTop; hand > grip.
- Directions: the trunk, neck, head and clavicles point up; arms, hands and fingers down (the thumb down, forward
  and across the palm); legs down; feet, toes and the jaw forward; skirt and coat bones down; sockets see below.
- Pivots: the elbow's (armLow head) sits 8 mm behind the arm's line and the knee's (legLow head) 8 mm in front of
  it, toward the round side of each hinge; directions are unchanged.
- **body** bones deform and are keyed by every clip (47 bones). **helper** bones (the two shoulder helpers) deform
  and are keyed by every clip too, but never posed by hand: their turn follows from armUp by a rule (below). The
  `keyed` list holds both: 51 bones. **spring** bones deform, but the
  base bodies have no weights on them: C weights skirts and coat tails to them, E and F move them with springs.
  **socket** bones never deform and are never moved by clips.
- No root bone: the armature node (the glb's top node per body) is the root. Clips key rotations; a fight or fall
  clip that must move the body keys `hips` translation (in the armature node's space), so E and F must keep hips
  position tracks (today's loaders keep quaternion tracks only).
- **eye** bones (`eyeL`, `eyeR`, B) deform the eyeballs only; clips never key them, code turns them to look
  (`RZ` turns both left and right, `RX` up and down, about 25 and 15 degrees at the most). They are appended after the
  sockets, so every other bone keeps its index.
- **helper** bones (`shoulderL`, `shoulderR`, 2026-10-12) are appended after the eyes, so every other bone keeps its
  index; see "Shoulder helpers".
- **BoneMap** to Godot's `SkeletonProfileHumanoid`: `peopleRig.json boneMap.map` (profile name to our name). The
  little fingers and Root are unmapped; the eyes map to LeftEye and RightEye. Use it to retarget licensed motion later.

### The pose convention (for D, J and code)

As in the old kit: a pose is a dict bone -> quaternion in armature axes (Blender: X the left, -Y forward, Z up),
each a turn relative to the parent's turned frame (Q_bone = Q_parent * q_bone); the key is `rest^-1 * q * rest`.
`clips_legacy.set_pose(ao, pose)` applies one. The old helpers work unchanged (`build_people.limb()`, `RX/RY/RZ`):
`RX(-a)` swings a hanging arm forward and bends an elbow, `RX(a)` bends a knee, `limb(S, out=a)` raises an arm
sideways. New bones:
- finger curl toward the palm: `RY(+a)` on the left hand's index/middle/ring bones, `RY(-a)` on the right;
- thumb: two axes per side from `clips_legacy.thumb_axes(J)` (flex toward the palm, and across the palm);
- clavicle: `RY(-a)` lifts the left shoulder (`RY(+a)` the right), `RZ(-a)` brings the left shoulder forward;
- jaw: `RX(+a)` opens the mouth;
- armTwist: a turn about the forearm (`RZ` in armature axes for a hanging arm).

### What the old clips get on the new rig (`clips_legacy.py`)

The 16 old bones get exactly the old rotations (the pose functions are imported from `build_people.py`, not copied).
From the same pose the new bones get: armTwist 0.6 of the hand's turn about the forearm (no wrung wrists); the
clavicle lifts when the arm is raised past 30 degrees (a quarter of the excess, at most 30 degrees: 4 cm at the
shoulder with the arm straight out, 8 cm with it straight up, `clips_legacy.shoulder_rule`) and goes forward with a
forward arm, the upper arm turned back by as much so it points as before; the shoulder helpers by their rule; a hand
shape per clip and hand (`HANDS`, `CLIP_HANDS`: relaxed, grip, fist, pinch, open, point, cup); the jaw talks in
talk, talk_f, rifle_talk and calls in call. chest, upperChest and toes stay at rest. Every clip keys the same 51
bones. The lifts the games add (sit, kneel, crouch, ride) are unchanged.

### Shoulder helpers (for E, F and anything that turns an arm in code)

A raised arm folded the shoulder: the skin round the arm hole was shared by the chest (still) and armUp (turned up
to 170 degrees), and linear skinning pulls such a blend toward the joint (the armpit puckered, the arm's root thinned
to a stalk). Now the rim of the arm hole, the armpit and the deltoid's round hang mostly on `shoulderL`/`shoulderR`,
which turn by half of the arm's swing; the chest blends into them and they blend into armUp, each step half the turn.
Measured on man_middling with the arm 170 degrees up: the ring at the arm's root keeps its radius within 4 mm (it fell
to under 3 cm before), forward, sideways and in the clips (point, call, reach).

- A helper sits at the shoulder joint, child of the clavicle, with armUp's own rest frame (pointing down, roll 0), so
  its rest is armUp's rest.
- **The rule** (pose convention; `motion.shoulder_helpers`): `q_shoulder = q_clav^-1 * slerp(1, swing(q_clav *
  q_armUp), 0.5)`, where `swing` drops the twist about the upper arm's rest axis (the arm hangs along -Z in Blender's
  armature axes, -y in game axes). Measured from the chest, so the half way turn follows the arm's own path (forward
  for a forward raise, out for a side raise) whatever the clavicle does.
- **Every clip in people2.glb keys the helpers** by this rule (`clips_legacy.derive`, `motion.key_clip`), so a plain
  player that plays all 51 rotation tracks needs nothing more.
- **The games must apply the rule themselves** whenever armUp or the clavicle get a turn that is not from a people2
  clip: code that aims an arm (IK on a handle, a look or a reach, a ragdoll), a blend that mixes clips per bone, and
  every old `people.glb` clip (they have no helper tracks: with the helper left at rest the shoulder's skin stays
  behind and tears). Each frame, per side, after the animation is applied and after any arm code (in Godot best as a
  `SkeletonModifier3D` after the AnimationMixer), in skeleton space:

  ```
  Quaternion Swing(Quaternion q, Vector3 axis) {          // q without its twist about axis
      var p = new Vector3(q.X, q.Y, q.Z).Dot(axis);
      var tw = new Quaternion(axis.X * p, axis.Y * p, axis.Z * p, q.W);
      return tw.LengthSquared() < 1e-12f ? q : q * tw.Normalized().Inverse();
  }
  // per side S, after the AnimationPlayer/AnimationTree and any arm code:
  Quaternion uc = skel.GetBoneGlobalPose(upperChest).Basis.GetRotationQuaternion();
  Quaternion ucRest = skel.GetBoneGlobalRest(upperChest).Basis.GetRotationQuaternion();
  Quaternion arm = skel.GetBoneGlobalPose(armUpS).Basis.GetRotationQuaternion();
  Quaternion armRest = skel.GetBoneGlobalRest(armUpS).Basis.GetRotationQuaternion();
  // the arm's turn from rest, seen from the chest (both measured against their rests)
  Quaternion d = (uc * ucRest.Inverse()).Inverse() * (arm * armRest.Inverse());
  Vector3 down = (armRest * Vector3.Up).Normalized();  // armUp's rest direction (bone +y) in skeleton space
  Quaternion half = Quaternion.Identity.Slerp(Swing(d, down), 0.5f);
  Quaternion want = (uc * ucRest.Inverse()) * half * armRest;   // the helper's global rotation
  Quaternion parent = skel.GetBoneGlobalPose(clavicleS).Basis.GetRotationQuaternion();
  skel.SetBonePoseRotation(shoulderS, parent.Inverse() * want);
  ```

  (three.js: the same with the bones' world quaternions and `bone.quaternion`.) It costs two slerps a person a frame;
  skip it for people beyond the near copy's range if it ever shows in the profile (the far copy has the same weights,
  so keep it on wherever arms move).
- The helpers carry no sockets or marks and are not in the BoneMap (Godot's humanoid profile has no such bone).

## Sockets

Each is a bone; hang a thing on its node (three.js: `getObjectByName`; Godot: a `BoneAttachment3D` or
`GetBoneGlobalPose`). Rest frames per body: `peopleRig.json bodies.<body>.joints`; the reference frames in `sockets`.

| Socket | Parent | Where | Frame |
|---|---|---|---|
| gripR, gripL | hand | where a handle runs through the closed fist, 2.2 cm past the knuckles, on the palm side | +y the handle's axis, forward when the arm hangs; +z toward the wrist; a blade's edge points along -z (the little finger's side) |
| hipL | hips | the left hip at the belt | +y down: a scabbard or sheath hangs along it |
| back | upperChest | the middle of the upper back, on the skin | +y up the back, +z out of the back |
| headTop | head | the crown | +y up |

Model a held thing with its grip at the origin and its tip along +y. The hand must make a fist round it: the `grip`
hand shape closes round a 3-4 cm handle (checked with sticks, `sockets.png`). One model per thing: the sack, the
handcart, planks, bottles and weapons are their own models on these sockets, never part of a body.

## Grab marks

For grabs, held victims, paired moves, hits and drags (the project owner's fight rules in `docs/plans/people.md` section 5): points
on the body given as an offset in a bone's rest frame. World point = the bone's posed global transform times the
offset. Per body in `peopleRig.json bodies.<body>.marks` (`bone`, `offset`, `rest`); what each is for in `marks`:
nape, collarBack, collarFront, mouth, throat, chest, belly, kidneyL/R, beltBack, wristL/R, upperArmL/R, armpitL/R,
ankleL/R, hair. `grab.png` shows a grab from behind (a hand over the mouth, a blade at the throat) and a body on its
back dragged by the wrists, both reached by plain two-bone IK onto these marks (`preview.arm_ik`).

## The bodies

| Body | Height | Build |
|---|---|---|
| man_middling, man_slight, man_stout | 1.67 m | middling, slight, stout (belly) |
| woman_middling, woman_slight, woman_stout | 1.57 m | the same |
| child_middling, child_slight | 1.27 m (about ten) | middling, slight |
| old_man | 1.64 m, stooped 17 degrees | a little slight, white hair, thinning crown |
| old_woman | 1.54 m, stooped 15 degrees | the same, grey hair |

The figures: heights from Quetelet's Belgian tables as summed up in *All the Year Round* vol. XII p. 490: "at ten
years old, four feet two; at fifteen years old, five feet; and at twenty years old, five feet six inches for young
men, and five feet two inches for young women", and a slight fall after fifty. Proportions from the textbook canon
(an adult head a 7.7th of the height, a child's a 6th; hip joint 0.52, knee 0.285, shoulder 0.818, elbow 0.63, wrist
0.485 of the height), girths of working people. Measured on the near copies (`peopleRig.json ... triangles.girths`):
man_middling chest 0.92, waist 0.78, hips 0.91, thigh 0.52, calf 0.35, upper arm 0.28, forearm 0.26, wrist 0.16 m;
woman_middling bust 0.81, waist 0.67, hips 0.90 m (uncorseted); man_stout chest 1.03, waist 0.92 m; man_slight chest
0.79, waist 0.66 m. Each body's armature has `extras.people2` (base, build, height, female, `scaleToOld` = hips
height / 0.95, the old kit's body scale).

**Builds** (`body.params`, 2026-10-12): meant to read apart at 10 m. Slight is narrow all through (girth factor 0.85,
shoulders 0.94, thin limbs, less muscle relief); stout is heavy in the limbs and the neck too (1.13 in arms, thighs and
neck, shoulders 1.06, softer muscle relief), not only round the belly. Shoulder widths (bideltoid): men 0.43 / 0.48 /
0.54 m, women 0.36 / 0.40 / 0.45 m (slight / middling / stout). A man's trunk tapers from the chest to the waist (the
chest rows 5% wider, the waist 3% narrower: `body.row_width`, half of it for the old man); a woman's hips swell from
the waist (the ring at the top of the pelvis takes the mean of the two) instead of standing out as a shelf.

**Height per person.** The ten bodies have the table heights; **E, F** vary each person by a factor `f` drawn from the
person's seed (a normal draw, sd 0.02, clamped to 0.96-1.04: `peopleRig.json heightFactor`) and scale the person's
top node uniformly by it. Everything on the skeleton follows (sockets, marks, grips, the hips tracks); locomotion
moves the node at `speed * f` and the speed blend uses `stride * f` (the foot lock takes out the rest); a collision
capsule and the eye height scale with it.

**The old** (`body.stoop_fn`, 2026-10-12). The stoop is one continuous bend made of small steps from the top down,
not a hinge at the waist: the upper back bends forward through 0.68-0.86 of the height (17 degrees for the old man,
15 for the old woman, about a line 7 cm inside the back), and the upper neck bends back by as much through
0.836-0.872 (about the neck's own line), so the head sits forward on a forward neck, moved but not turned, and still
looks ahead; the neck's top ring and the head's edge get nearly the same move, so the join does not fold. The upper
back rounds into a 1.5 cm hump and the shoulders come 2 cm forward (the arms with them, still hanging straight). The
bones keep their directions (their heads move). Every other part that follows the body (B's head and hair through
`head.stooped`, the sockets and marks) goes through the same function.

The old also stand on softly bent knees. The standing clips they use most have a variant for the stooped bodies:
`idle_old`, `idle_f_old`, `talk_old`, `talk_f_old` (`clips_legacy.OLD_CLIPS`): the thighs 5 degrees forward, the
knees bent 10, the feet turned 5 back so they stay flat, the hips lowered 3 mm (keyed). **E, F:** for a body with
`stoopDeg` > 0 play `<clip>_old` where it exists; for any other standing clip add the same three turns
(`peopleRig.json oldStance`); the D1 `old_*` walks already have bent knees.

**Base bodies are not kinds.** They wear painted linen drawers and a vest (a chemise for women) and a cropped head
of hair, so they can be looked at; C dresses them, B gives them faces, hands and hair.

### Topology (the same for every body)

One quad cage, 1,098 quads: a trunk tube of 16 columns from the crotch to the crown (closed by a 4 x 4 grid), arms of
8 columns from a 2 x 2 hole each side of the chest to a capped palm, legs of 10 columns from the crotch bending
forward into the feet, and 10 closed finger shells (4 columns) set into the palms. Three edge loops at the shoulder,
elbow, wrist, hip, knee and ankle. Column 0 of the trunk is the front middle, 4 the left side, 8 the back; arm
columns run from the front round the outside; the head joins the neck at the ring `neck[-1]` (B can replace the
head at that ring of 16 vertices). Because every body is made by the same code, vertex order is the same in every
body: shape keys, clothes fitting and weight transfer can rely on it.

**Limbs (2026-10-12).** The tables (`body.ARM`, `LEG`, `FOOT`) and the muscle bumps per ring and column (`ARM_BUMP`,
`LEG_BUMP`; `params()["f"]["muscle"]` scales them) give the limbs their anatomy instead of tubes, measured on
man_middling's near copy (plane sections; front view = width across, side view = depth):

| Where | Width x depth | Was |
|---|---|---|
| the forearm 7 cm below the elbow (the wedge: brachioradialis and extensors out, flexors in) | 8.2 x 8.6 cm | 7.2 x 8.5 |
| the elbow | 7.1 x 7.6 cm | 7.3 x 7.7 |
| the wrist (no ring: the palm's first ring follows it; the wrist rings get a smaller inflation, 1.12) | 3.9 x 5.5 cm | 4.1 x 7.2 (a bulge) |
| the calf at its widest, 0.22 H (the inner head lower than the outer) | 11.5 x 11.8 cm | 10.4 x 11.8 |
| the shin above the ankle, 0.09 H | 6.7 x 7.2 cm | 7.6 x 7.8 |

The knee has its kneecap, the hollow behind it and the inner bulge of the vastus above it; the elbow its inner bone
and its point; the ankle both ankle bones (the inner one higher). The foot: the instep falls from the ankle to the
ball, the big toe's knuckle stands up, the toes are thin and end in a rounded arc (the big toe longest, the little
toe 2.5 cm back), the inner sole lifts into an arch (1.5 cm at the middle of the foot, `FOOT_ARCH`, placed by where a
point lies across the foot: the foot rings' columns are turned to meet the crotch's loop) and the heel is a full
round 1 cm further back. Same topology and vertex order as before.

- **LOD0** (near, under 15 m): the cage subdivided once onto the limit surface: **8,784 triangles**.
- **LOD1** (far, from 15 m, and for the mirrors and the lantern shadow): the cage with its vertices moved onto the
  same limit surface (so the switch does not change the size): **2,196 triangles**. Same UVs, material, skeleton.
- Smooth shaded, outward normals, closed shells.

### UVs and pictures

Islands (seams marked in the cage): the trunk, the head, each arm with its hand, each leg with its foot, each
finger. They are unwrapped angle-based once on man_middling and the same UVs are given to every body, so a picture
painted for one fits all. Texel density is even, except the head (2.7 times the texels per metre) and the fingers (1.15 times). Two pictures:
`people2_skin_m` (men, boys, the old man) and `people2_skin_f` (women, the old woman), 2048 px, JPEG in the glb,
painted in 3D through a position map (`paint.position_map`: for every texel the body point it shows); islands are
grown outward by 12 px against mipmap bleeding. Linear, mipmapped in the games. In people2.glb these pictures are
painted at 2048 and put, halved, into the one atlas of package C ("Kinds and clothes"): a body's UVs are this unit
square moved into its cell.

What the body's paint carries (2026-10-12), so a body does not look like chalk even under a plain material:
- **Occlusion baked in** (`paint.vertex_occlusion`, `vertex_map`): rays over each vertex's hemisphere on the near
  copy at rest, 5 cm reach, rasterised into the picture: the armpits, the crotch, under the chin, between the fingers
  and in the webs (up to 55% darker on skin, 45% on cloth). Hits on a part that moves on its own do not count (the
  hanging arm against the chest below the armpit, the hands against the thighs, the thighs below the crotch), so the
  rest pose does not bake its own closeness into the skin. About 1 s a picture.
- **The weather on what work leaves bare** (`paint.TAN`): the hands and wrists (fading out up the forearm), the nape
  and the front of the neck down into the collar's V, browner and darker (women and children less); the neck fades
  back to the plain tone at the head's join, where the face painter's own weathering also fades out.
- **Worn linen** (`paint.LINEN`): washed-out and darker than new, grey grime at the hems, the seat and the knees,
  yellowed sweat under the arms and at the collar.
- **Bare toes** in paint (`paint.TOES`): the gaps between the toes from their tips back to where they join, soft nails,
  a little grime on the tips.
- The skin's mottling is one function, `paint._skin_mottle(pos)` (to be replaced by the shared `noise.skin_mottle` of
  the head and the body at the art2 merge).

### Weights

By rule, not Blender's bone heat (heat bleeds between a hanging arm and the chest beside it). From what the cage
knows about each vertex: trunk weights by height along the spine chain; shoulders shared by upperChest, clavicle
and armUp round the arm hole; hinges with a short blend on their round side (the back of the elbow, the front of the
knee) and a long one on the crease side; the forearm shared from armLow to armTwist toward the wrist; the jaw on
the lower face; legs and hips round the crotch. The subdivision carries them to LOD0; the fingers are then
sharpened on LOD0 by their position along each finger. At most 4 bones a vertex, normalised.

Measured at 120 degrees (`--cast` prints it): the section through the hinge keeps 65-87% (elbows) and 43-65%
(knees) of what two rigid tubes would show; the rest is the crease folding in, as flesh does. Shoulders hold with
the arms straight up and straight out; a deep squat, a fist and a body lying on its back hold (`bends.png`).

## Faces, hands, hair (package B)

### The head (`head.py`, `sdf.py`)

A's placeholder head stays in the cage for the subdivision (so the neck keeps its shape) and is then replaced in both
copies at A's neck ring (`head.attach`): a strip of triangles joins the head's open edge, 6 mm above, to the ring
(32 vertices near, 16 far), always in the same pattern.

- **Anatomy as a field.** The head is a signed distance field in a head frame for a reference head 0.214 m from chin
  to crown (x the left, t up from the bottom of the chin, z forward of the ear canal): a cranium and occiput, one
  face mass narrowing to the chin, cheek pads, cheek bones and arches, a jaw from the angle to the chin, a muzzle, two
  lips with a real mouth slit and a mouth inside it (so the jaw opens a dark mouth), a nose (bridge, tip, wings,
  nostrils), a brow ridge, sockets round separate eyeballs with modelled lids and an almond opening, ears (a cupped
  plate, the rolled rim, the groove inside it, the bowl, the tragus, the lobe) and the neck. Proportions from the
  textbook landmarks: eyes at half the height, the nose from the brows down about 5 cm, the mouth a third of the way
  from the nose to the chin, the ear from the brow line to the base of the nose.
- **One mesh for every head.** The reference man's field is meshed once per build (surface nets on a 0.8 mm grid,
  the neck cut and the hidden eye cavities removed, Blender's quadric decimation to 2,200 triangles with the face and
  ears weighted to keep more, a cut along the back's middle line for the UV seam, every vertex pulled back onto the
  surface, the lid margins put evenly back on the true margin). Every body (`FEMALE`, `CHILD`, `OLD_M`, `OLD_F`
  changes and A's head size `hs`, `hw`) and every face shape is that mesh moved: landmarks carry it (`warp`) and it is
  pulled onto that head's own surface. So all heads have one vertex order; the far copy has its own 330-triangle
  head (closed lids, no slit, plain ears) made the same way.
- **Eyes.** Each eyeball is its own little sphere (100 triangles, a low cornea bulge) weighted to `eyeL`/`eyeR`; the
  lids close over them by the `blink` shape key. The eye whites are dimmed (they glow in the fog otherwise).
- **Weights.** By rule: A's spine chain by height (neck to head), the jaw by a line from the mouth slit rising back to
  the jaw joint, sharp at the slit (upper lip with the head, lower lip with the jaw), shared under the chin.
- **Face shapes (shape keys of `_lod0`).** 14: long, broad, aquiline, snub, bulbous, square, weakchin, chin, gaunt,
  round, heavybrow, thinlips, fulllips, ears; and `blink`. `head.face_mix(seed)` gives a person two or three of them
  at 0.17-1.0 (never two opposites). Positions only (no shape-key normals: they cost 7 times the file size), moves
  under 0.25 mm dropped: about 60 KB a body. **E, F:** set the weights once when a person is made (three.js
  `morphTargetInfluences` per clone; Godot `set_blend_shape_value` per MeshInstance3D); the far copy has none. A kind
  mesh made by C from a body carries the same keys only if C copies them (about 60 KB a kind).

### The face painter (`face_paint.py`)

UVs: the head has its own square in the top right of a body's picture (`head.HEAD_RECT`, 512 px of 2048), the same in
every body: a chart round the head seen from a point inside it (more texels across the face), the ears' fronts and
backs, the eyeball, a dark patch for the inside of the mouth, and two swatches (strands, a plait's weave) for the
swept hair pieces. `face_paint.paint(look, size)` traces every texel back to the point of the reference head it shows
(once per size) and paints by position: skin tone (five, from fair Flemish to a dark-skinned sailor), mottling, the
weathering of outdoor people, the flush of cheeks, nose, chin and ears, lids, lashes and the lid crease, brows in hair
strokes, lips, the scalp's hair and the hairline of each style, sideburns, stubble, painted beard zones, wrinkles by
age (forehead lines, the frown, crow's feet, the fold from nose to mouth, the lines below the mouth, the neck), a
drinker's veined nose and cheeks, pox pits, freckles, soot, the eye (a dim white, the iris with its rays and a darker
ring, the pupil, the lid's shade) and the shade of the folds (from the field). A height field painted with it becomes
the tangent-space normal map (OpenGL green-up, as glTF wants). `look_for(seed, sex, age)` draws a look; `BASE_LOOKS`
are the base bodies' own. 1024 px for the named cast: `paint(look, 1024)` into the same square of a 4096 picture.

The base glb has five pictures, each with its own face: `m` (the men), `f` (the women), `boy` (the children), `old_m`,
`old_f`. A kind (C) paints its own face into its picture's head square.

### Hands (`hands.py`)

A's arm stops at its palm ring p0; from there one connected hand: a 10-column palm (six pentagons make the step from
8), four fingers grown from the palm's last loop with webs between them, the thumb out of a hole in the palm's thumb
side. The fingers follow A's finger bones (`body.hand_frame`, unchanged): rings at the joints (wider: the knuckles),
pads between them, the nail and the tip. Weights per vertex from the hand code; A's finger sharpening on the near
copy still applies; the thumb's blends over 9 mm at its root, so a closing thumb does not crack the skin where it
leaves the palm. The ball of the thumb fills the palm's thumb side, and the side of the thumb's first joint that faces
the index is drawn toward the index's knuckle (the web, `hands.WEB_PULL`; sideways only, or a fist folds it). At rest
a hand curls more toward the little finger, the thumb laid in along the index (`HANDS["relaxed"]`: index 16/24/11,
middle 21/31/14, ring and little 27/38/17, thumb 20/10/12). The paint (`paint_hands`): the hand about 9% darker and
redder than the arm, fading in over the wrist (`HAND_TINT`); shade where the fingers lie against each other and in the
webs at their roots; at every joint creases 18% darker (`CREASE`), on the back two or three short lines curving round
the knuckle, on the palm the joint's crease (a pair at the middle joint) and the one where the finger leaves the palm;
the three palm lines, curved, wandering and broken; nails as a plate with a pale moon, the cuticle line, the folds at
its sides and a pale free edge; red knuckles, tendons; all with the normal map. **Docker's hands**: the `hands_hard` shape key (fingers
a fifth thicker, bigger knuckles, a broader thicker palm); `paint_hands(hard=1)` paints calluses.

**Grips** (`peopleRig.json grips`, fitted every build by `preview_b.fit_grips`): for a 2 cm rope, a 2.6 cm knife
handle, a 3.2 cm baton and a 4 cm cart handle: the finger curls (MCP, PIP, DIP), a thumb closed as far as it goes
without entering the handle, and `axisAt`, where the handle's axis sits in gripL/gripR's own frame (about 2.2 cm
toward the wrist from the socket and r + a little into the palm: a real power grip, the knuckle joints closed too).
No vertex goes more than 0.4 mm into any of them. **D, J, K:** to hold a thing of radius r, pose the hand with these
curls and put the thing's axis at `axisAt` (along the socket's +y); A's socket origin itself stays where it was.

### Hair (`hair.py`)

Two kinds of piece, both carried to every body and every face shape: **shells** (the head's own triangles under the
hair, pushed out by a thickness that grows from the hairline, the rims on the skin; beards the same over the face)
that take the scalp's and the beard zone's paint, and **tubes** (bun, plaits pinned up, a coronet of plaits,
moustaches, an imperial tuft) swept along paths made from the head's landmarks and bound to the nearest head
vertices, over the strand and plait swatches. Styles: men crop, side (parting), bald (a fringe of hair), long (to the
collar); women bun, plaits, coronet, undercap (flat, for under a cap), with the curled fringe of the 1870s as a
variant; beards full, short, chops (mutton chops), sideburns, chin (a chin curtain), imperial; moustaches walrus,
handlebar, chevron. `hair.style_for(seed, look, P)` picks one by sex and age; `hair.attach(mesh, P, lod, style)` joins
it into a body mesh (same draw, same material). The base bodies wear `hair.base_style`: crop, bun, bald for the old
man. A shell costs 250-400 triangles, a bun 300.

**Hair cards** (`hair.cards`, `card_material`): alpha-tested strips over a shell for the named cast's near copy only
(a second material and draw; alpha MASK in glTF). Not in the base glb.

### Counts

| | Near copy (LOD0) | Far copy (LOD1) |
|---|---|---|
| man_middling (crop hair) | 10,356 triangles | 2,342 |
| woman_middling (bun) | 10,636 | 2,432 |
| of which the head, eyes, the join | about 2,500 | about 360 |
| of which both hands | about 2,000 | about 500 |

Over A's 6,000-9,000 for the crowd by 1,400-1,650 (the plan allows up to 12,000 for the named): the face and the
hands carry the look at talking range; the scalp under the hair is coarse. The file is 5.8 MB (2026-10-12; pictures 1.7 MB, shape
keys 0.8 MB, meshes 1.5 MB, clips 0.4 MB).

## Kinds and clothes (package C)

### C4 wide: cast and children (2026-10-13)

`kinds_cast2.py`, `garments_cast.py` and `held_cast.py` extend the cast without changing the four first-pass kinds.
Peeters keeps her black widow's clothes and account ledger; Tuur his navy jersey, russet knit cap and cold pipe;
Fientje her russet dress, checked shawl, blue-grey apron and shared herring basket; the Anna Maria sailor his
navy double-breasted pea jacket and knit cap. Roles come from `services/data/native-rules.json` and
`native-seed.json`; fixed faces remain in `shared/faceTypes.json CAST`, placements in `PostedPeople.cs`.
The second set adds the working sailor's ochre oilskins and long-brimmed sou'wester, the stranger's black
frock coat/top hat/gloves, the thief's repaired dark short coat and the foreman's brown coat/bowler/watch chain.
The recipient wears a blue-grey sack coat. The boy has a patched short jacket; the smaller urchin has rolled
linen sleeves. Both have knee breeches and bare feet. The stooped old man wears a long rust-brown coat and carries
a blackthorn stick. The undressed old-man root is prefixed `base_` to leave `old_man` for the dressed kind.
The C4 wrapper uses the shared 16,000/14,000 near and 2,500 far body-and-clothes budgets. Hair and beards remain
separate reusable meshes, as in the other families. Subtracting the largest hair and beard combination from that
budget left an entire old man's coat with 276 triangles. Near garments now use the shared reducer and rebuild
edge facings from the reduced outer triangles; far garments retain C4's per-piece reducer. Both use the shared
unwrap/paint pipeline and the existing kind's texture layer.
`--dress` uses the existing face-aware preview with the real pictures; unused original hair pieces are hidden.
The fitted C4 layers keep their authored clearance; the shared post-reduction correction is disabled only
inside the C4 wrapper, because it folds shoulder edges into the shawl. Fientje's cap includes her bun's envelope.
Coat wear uses each coat's own colour; only the thief, boy and old man's coats receive the separate repair painter.


Historical C4 counts from 2026-10-13 (default hair/beard included; props separate):

| Kind | Near | Far |
|---|---:|---:|
| peeters | 15995 | 2496 |
| tuur | 15998 | 2494 |
| fientje | 15989 | 2495 |
| sailor | 15991 | 2495 |
| sailor_b | 13611 | 2420 |
| stranger | 15984 | 2495 |
| thief | 15981 | 2496 |
| foreman | 15990 | 2496 |
| recipient | 15989 | 2496 |
| boy | 13267 | 2336 |
| urchin | 13273 | 2337 |
| old_man | 13193 | 2268 |

Period references (shape references only, no new downloaded artwork in the game):

- Jozef Israëls, [Children of the Sea, 1872](https://id.rijksmuseum.nl/200109406), Rijksmuseum SK-A-2382:
  worn children's tops, short trousers and bare feet; a regional comparison rather than Antwerp documentation.
- V&A [bonnet T.163-1923, 1870s](https://collections.vam.ac.uk/item/O233687/bonnet-unknown/):
  the small tied bonnet construction; Peeters' plain black version follows the game's existing widow description.
- The Met, [Death Becomes Her, gallery labels](https://libmma.contentdm.oclc.org/digital/api/collection/p16028coll12/id/18303/download),
  p. 7, mourning bonnet C.I.39.80.1, ca. 1870: matte black cloth and matching ties for Peeters' working version.
- New-York Historical Society [frock coat, 1870–1880](https://emuseum.nyhistory.org/objects/21304/frock-coat):
  full coat skirt, lapels and waist shaping for the stranger, foreman and old man.

Closed garment shells have 1.5–3.5 mm facings and rounded hems; felt brims 2.5–3 mm, doubled knitted cap bands
3 mm. Socket objects remain separate models. Ledger page lips are intentionally thin sheet edges; leather covers,
pipe wood, cane and metal ferrule have subdivision-rounded edges. No shader kinds, lights or wire motions added.

First pass (2026-10-12): four kinds, one from each group, so the owner sees the new people before C goes wide:
`docker_a` (workers), `fishwife_a` (women), `police` (uniforms), `sooi` (the cast). Each is its own armature in
people2.glb, named after the kind, with `<kind>_lod0` and `<kind>_lod1`, on the same 64 bones and the same rest pose
as its base body (`kinds.<kind>.body`), so every clip of that body plays on it unchanged.

### How a kind is made (`dress.build`)

1. The base body is made again under the kind's name (`build_people2.make_body`).
2. The face: the kind's default face (`face_of`); the game gives every person their own at spawn.
3. The garments: `Kind.dress(fit)` returns `clothes_kit.Piece`s; joined into one cage (`build_objects`: every piece's
   winding made consistent first), subdivided once (the near copy), moved onto its limit surface (the far copy).
4. `clothes_build.py`, in this order: relief (folds and bunching as geometry, near copy), the
   body cut (`clothes_kit.cut_body`), one reduction of all garments, layers cleared and tucked, the body cut again, the
   islands checked, the unwrap, the paint, the far copy's UVs, the body's picture with the skin under the cloth
   (`clothes_build` docstring and "Clothes: high detail" below).
5. UVs of the body into the kind's layer, the clothes joined into the body's two meshes, the body sliders carried onto
   the clothes (`clothes_keys`), occlusion baked over body and clothes.

### Garments (`clothes_kit.py`)

| Function | Makes |
|---|---|
| `upper` | anything over the trunk, from the body's own cage pushed out by an ease per vertex: shirts, smocks, tunics, bodices, waistcoats (sleeveless: hemmed arm holes; `keep` cuts a V neck), coats (`keep` leaves the front columns out: an open coat); `open_front` gives a buttoned front with the left edge over the right |
| `trousers`, `straight_leg` | trousers from the cage's trunk and legs; legs that fall straight below the knee |
| `hang` | rings that fall from an open edge, pushed out to clear the legs below: the smock's skirt, tunic and coat skirts, aprons (`push` lays them on another piece) |
| `skirt` | a full skirt: waistband, hips, real folds deepening to the hem |
| `band`, `strap_grid`, `Onto` | things laid on a garment that is already made (a belt, an apron's band, a shawl, a leather shoulder pad): `Onto` is the garment's surface after the subdivision; a piece laid on it takes its weights |
| `collar`, `neckerchief` | stand and turn-down collars, a rolled neckerchief with its knot and ends |
| `flat_cap`, `kepi`, `hood_cap` | the docks' cloth cap, the police kepi, the women's linen cap with its goffered frill: fitted to the built head and hair by slices and rays (not B's field), weighted to the head |
| `clogs`, `shoe` | wooden clogs; boots on their own last with a sole and a heel; soles stand on y = 0 |
| `thicken` | every piece's thickness: an inside (all of it, or a facing a few centimetres deep where the inside is never seen past it) and a rim on every open edge; the rim's edges are creased, so a hem is a rounded edge as thick as the cloth |
| `smooth_weights` | cloth does not crease like skin: trousers' knee weights spread over 30 cm |
| `unwrap` | UVs: angle based along the seams, islands checked, one texel density (insides and rims at 0.3), packed |

Weights: garments made from the cage carry the body's weights vertex for vertex. Hanging cloth (`hang_weights`):
the hips at the top; below the hips the legs, by side (in front fully, behind `back_legs`) and by height (the shin
below the knee), so skirts and aprons sit on the lap and fold down the shins, and walk with the legs; a share for the
spring bones toward the hem: `skirtF/B/L/R` for skirts and aprons, `coatTailL/R` behind for coat and tunic skirts. The
games move the spring bones (E, F); clips never key them. Pieces laid on others take their weights (`Onto.weights`).

### Pictures and the atlas

The cloth is painted like A's skin: through the position map every texel knows the point of the garment it shows,
its piece, whether it is inside, and where on the body it came from (`zone`: trunk, arm, leg, skirt). A `Cloth`
look gives the colour, the weave (linen, cotton, wool, felt, corduroy, leather, wood, metal), the folds, wear, mud
up to `mud_h` over the ground, dust, tar and coal; `extra` paints the rest (seams with stitches, buttons, patches,
stripes and checks, piping, badges, a wood grain). A height field painted with it becomes the normal map. Stripes and
checks are drawn with soft edges (no stair steps up close).

One native material, `people2_pictures`, samples four 1024 px Texture2DArrays: clothes colour/normal and
face colour/normal. `pictures.py` writes independent lossless PNGs plus `manifest.json` in
`native-godot/assets/people2-pictures`. Each base body and dressed kind has a stable layer; held models
share one extra layer. A dressed layer puts exposed body skin in its lower half and garments in its upper
half, with eight-pixel guards around both rectangles. Head islands use the whole face square, selected
by vertex green, while red remains the eye flag. The previous sixteen-cell atlas limit is removed.
Colour alpha carries a linear zone id divided by five: none, wool, linen, canvas, leather, skin.
Periodic 512 px colour/normal detail pairs add grain near the camera and fade out by 3.5 m.
Normal PNGs stay lossless; native imports use BC5/RGTC normals and BC7/BPTC colour, with mipmaps and
linear anisotropic filtering. Geometry, edge exceptions and the motion list remain unchanged.

### Held things (`held.py`)

One model each, under the node `people2_held` (`peopleRig.json held`): `held_sabre` (the police short sabre: ribbed
brass grip, knuckle bow, a curved 60 cm blade), `held_scabbard` (black leather, brass locket and chape; hangs on
`hipL`, turned back 28 degrees, `held.hang`), `held_truncheon` (a turned hardwood baton, 40 cm), `held_basket` (an oval
wicker basket with rounded structural withies, a bow handle and herring in it; carried upright on `hipL`). Grips at the origin, tips along +y, a blade's
edge along -z (docs above, "Sockets"); the sabre sits in its scabbard at `held.sheathed`. A kind lists what it holds
and where in `kinds.<kind>.held`.

### How to add a kind

1. In a group file (`kinds_*.py`, or a clothing group's own `kinds_*2.py` / `garments_*.py`) write
   `<kind>_dress(fit)` from the kit (`clothes_kit`: `upper`, `trousers`, `hang`, `skirt`, `band`, `strap_grid`,
   `collar`, `neckerchief`, `flat_cap`, `kepi`, `hood_cap`, `shoe`, `thicken`) and the shared detail set
   (`cloth_detail`: `hang_folds`, `bunch`, `bulge`, `band`, `creases` as `pc.relief`; `buttons`, `fringe`, `klomp`,
   `shawl`, `plaid`), its `Cloth` looks with their `extra` painters, and `<kind>_covers(point, part)`. Lay garments from
   the inside out: a piece laid on another (`Onto`) needs it made. Ease: each layer at least the one below plus its
   thickness plus 3 mm; a layer that must stay over another states it (`Kind.layers = [(under, over)]`); a piece that
   must never be cut as hidden (a shawl, a frill) goes in `Kind.keep_layers`.
2. Folds as geometry: at most one fold per six columns of the subdivided garment (`hang_folds(n=...)`: a smock or tunic
   on the 16-column cage takes 5, a skirt of 40 columns 12), or the hem shows teeth.
3. Add `Kind(name, group, body, face, hair, dress, covers, skin, hats, held, avoid, note)` to the file's `KINDS`.
   `skin` paints only what the kind shows of its body (stockings, socks, red hands): the skin under the clothes is
   painted by the ray test.
4. Trials: `blender -b --factory-startup --python-exit-code 1 -P art-source/tools/blender/build_people2.py -- --only
   <body> --kinds <kind> --no-move --no-work --fast --out .scratch/try/p2.glb` with `PEOPLE2_SAVE_BLEND`, then the
   sheets (`people2_sheets.py -- cloth kinds=<kind>`, "Clothes: high detail"). The build log prints per kind the
   islands, cuts, texel density and stretch; aim for 0 islands re-projected and under 2% of triangles over 2:1.
5. A full build with `--plain`, then `replace-people2.ps1` as described above.

### Check pictures (`--dress`, `.scratch/people2-build/shots/kinds/`)

`cast_3m.png`, `cast_10m.png` (each kind front, side, back, three-quarter in the game's fog at the game's pixel size;
10 m blown up 3x), `cast_10m_lod1.png`; `studio_<kind>.png` (big, no fog); `detail_<kind>.png` and
`detail_gas_<kind>.png` (head front and back, neck and chest, a hand and its cuff, the knees and hem, the feet, the left
shoulder, the left hip; by day and under a gas lamp); `close_<kind>.png` (at 1, 1.5 and 2 m at the game's pixel size);
`clips_<kind>.png` (idle, talk, walk at two phases, sit, lean, push, crouch, and D1's walk at three phases, from the
front three-quarter and the side); `held.png`. The build prints each kind's triangles.

### Counts (first pass)

| Kind | Body | Near copy (LOD0) | Far copy (LOD1) | of which clothes (near) |
|---|---|---|---|---|
| docker_a | man_middling | 18,404 triangles | 4,382 | 12,832 |
| fishwife_a | woman_stout | 22,284 | 5,364 | 15,488 |
| police | man_middling | 19,004 | 4,572 | 13,648 |
| sooi (named) | man_stout | 23,608 | 5,708 | 18,048 |

Held things: basket 3,600, sabre 2,516, scabbard 1,504, truncheon 840. One material, two 4096 px pictures (JPEG);
The historical art master was 6.8 MB with compressed geometry (10 bodies, 4 kinds, the held things, 98 clips), 12.3 MB as Godot's plain copy.

The plan (2.2) budgeted 6,000-9,000 near triangles for the crowd and 12,000 for the named; A and B's body alone is
10,400, and dressed kinds come to about twice the plan. The far copy (from 15 m, in the mirrors and the lantern
shadow) is about a quarter. With 12 people inside 15 m and 38 beyond (a busy view), that is about the 450,000
triangles a frame the plan estimated; draws stay one per person, materials go from 51 to 1.

### Clothing second pass (2026-10-13)

| Kind | Before near / far | After near / far | Clothes near / far |
|---|---:|---:|---:|
| docker_a | 18,112 / 4,306 | 8,899 / 2,098 | 3,331 / 886 |
| fishwife_a | 22,248 / 5,348 | 8,900 / 2,099 | 2,076 / 571 |
| police | 19,228 / 4,628 | 8,898 / 2,099 | 3,542 / 895 |
| sooi | 23,664 / 5,722 | 11,500 / 2,097 | 5,940 / 848 |

These before counts are the actual ported art3 master, rather than the older first-pass table.
After counts use the shipped plain GLB indices. Blender's pre-export far counters are 2,100 / 2,099 /
2,099 / 2,100; exporter validation removes two/three redundant far triangles from docker/Sooi.
The exported meshes have no zero-area triangles, finite positions/normals and four normalized joint weights.
All three crowd kinds meet 6–9k; named Sooi stays below 12k; far copies are about 2k.
Held props are counted separately: the basket is 2,000 triangles (was 3,600), with rounded structural
withies, a rim, an inward bow handle and six herring. Other held models retain their counts above.
The full rebuild prints every garment and prop piece; `kinds.<kind>.pieceTriangles` records the final
near/far garment breakdown in both authored and shipped peopleRig.json.

The fishwife carries the basket upright at her left hip. Its mesh is in hipL's downward frame:
local +y down, -z forward; its near side clears the full skirt, and its handle bows toward the forearm.
Idle, talk and walk no longer turn it like a plate with the hand. The apron has 18 mm clearance at the
band and 24–42 mm over the skirt, without the old inward wrinkle offset; its hidden full lining was
replaced by an edge facing. The flatter shawl panels use fewer rows and columns.
Clogs retain their rounded wooden geometry, with darker willow grain and dirt higher up the sides.

Near faces and hands retain their topology and morphs. Clothing is painted on the rounded surface,
then reduced with interpolated UVs and weights. Far clothing uses a separate reduction on its limit
surface. Edge exceptions remain thin cloth hems/creases, hidden garment interfaces and the sabre's
intentional cutting edge. Withies and the handle have geometric rounded sections; fine wicker strands
and wood grain use the height map. No shader kind, gameplay light or collision is added.

### Clothes: high detail (round 4, 2026-10-13)

| Kind | Near before / after | Far before / after | Clothes near before the reduction | Texel density | Over 2:1 |
|---|---:|---:|---:|---:|---:|
| docker_a | 8,899 / 13,979 | 2,099 / 2,488 | 13,892 | 297 px/m | 0.7% |
| fishwife_a | 8,889 / 13,968 | 2,100 / 2,490 | 18,820 | 209 px/m | 3.0% |
| police | 8,887 / 13,950 | 2,099 / 2,487 | 12,402 | 266 px/m | 0.7% |
| sooi | 11,500 / 15,958 | 2,100 / 2,477 | 15,562 | 242 px/m | 2.5% |

(Trial build figures; the full build prints its own, in `kinds.<kind>.clothChecks` of peopleRig.json.) Before, about
one garment triangle in five was stretched over 4:1 and the clothes had 2,000 to 6,000 near triangles.

- **Budget.** `dress.NEAR_CROWD, NEAR_HERO, FAR = 14000, 16000, 2500`. The cut body keeps 5,000 to 6,000 near
  triangles (MakeHuman's face, the hands), so the clothes get 8,000 to 10,000. Hair and facial hair are separate.
- **Clothing coverage.** Keep complete garments through reduction. Rest-pose occlusion cannot justify deleting
  clothing: a moving coat exposes the waistcoat underneath. Deleting it as well as the covered skin caused the
  see-through abdomen in #138. Explicit closed-panel masks may replace blouse sleeves, sides and backs beneath
  a coat (including shirt and waistcoat panels), and the bib backing beneath a veil; these preserve the visible front.
  The body cut remains separate; coarse neck triangles are clipped below a closed bodice's measured neckline.
- **The body cut** (`clothes_kit.cut_body`): never the head, eyes, hair or the hands (MakeHuman's hand islands and the
  fingers); reach by part (`CUT_REACH`: 6 cm neck and arms, 25 cm torso, 30 cm legs); three of four tilted rays must
  meet cloth, so the skin just inside a cuff or collar stays. It runs again after the reduction. Before each cut,
  `cloth_fit.tuck_skin` places skin behind nearby outer cloth on the same limb; an arm must never bind to trousers.
  Arm skin within 65 mm of a visible sleeve edge stays, including elbow-weighted vertices; a hidden cuff edge does not protect skin.
  Closed upper garments replace covered mixed shoulder faces even when a torso ray misses; bodices also replace covered neck skin.
  Skirts replace legs above their measured hems. The worker mask stops below the nape.
- **Layer motion.** Aprons, bibs and shawls take their backing garment's weights and shape deltas after reduction,
  retaining clearance and recessed facings. Short shirt cuffs follow their own coat sleeve, never a nearby coat tail.
  Blouse sleeves bind to the uncut arm's surface weights and identity shapes. Long-coat lengthening never changes sleeves.
  Aprons share the skirt's final triangles and retain rows at the knee and hem; their binding cannot jump to another fold.
  Keep that skirt continuous until the apron is made, then fit the apron outside any jacket worn beneath it.
  Shirt-mounted shoulder pads also share their support's triangles and motion, rather than independently snapped straps.
  A shawl fringe retains its sewn boundary through fitting and uses that edge's weights and identity offsets.
  Final open-wrap smoothing removes fold reversals without collapsing the panel; closed capes smooth only their neckline.
  Full brims mask hidden scalp at their inner crown rim after fitting, above the eyes; short peaks and tilted hats retain exposed scalp.
- **Headwear fit (2026-10-20, #82).** Hats sit snug, as in the period photographs: `clothes_kit.HAIR_ROOM`,
  `HOOD_ROOM` and `CROWN_CLEAR` set the room over the head. Linen caps and hoods stand about 1.2 cm off the scalp
  (the undercap hair is 2.6 mm; 3.2 cm made bowls of them and put the beguine's cap through her hood). The nun's coif
  keeps 2.5 cm (it covers the ears; closer, ear and hair came through), her veil 4.2 cm (was 5.5). Flat and
  knitted caps end about 1.7 cm over the crown of the head, kepis 1 cm over it in the middle of their slope; bowlers
  and toppers are seated on the brow, tipped back 1 cm (`tip_back`) so the forehead shows, with 11 mm over the band,
  3.5 cm brims (toppers 3.8, the sou'wester 3.5 in front to 8.5 behind, the priest 7.5) and 17 cm topper crowns; the
  shako stands 16 cm. Measure a change on the saved build (`PEOPLE2_SAVE_BLEND`): hat width and length against the
  head, crown height and inner gap over the scalp by rays from the skull's middle, and hair or scalp poking through
  the crown at the basis and at each head slider (`s_head_tall`, `s_head_wide`, `s_skull_long`, ...) at full value.
- **Reduction** (`reduce`): collapse outer garments together, then rebuild 3 mm edge facings from the final triangles
  with matching bone weights (`cloth_fit.py`), inside the same clothing budget. Authored face roles remove
  the old lining precisely; 12 cm facings close views down upper garments. Aprons, open caps and authored full-backed
  headwear retain complete backs, including after far reduction. Hat brims overlap their crowns beneath the seam.
  Exact facing pairs preserve each fold's own weights and identity motion; rebuild them after knee-row cuts, never interpolate their IDs.
  Thin stitched rims retain their cut line
  through subdivision (crease at least 0.6), preventing gaps at collars, waistbands and brims. Protect the rims,
  creases and UV seams (`protect_weights`). After it `clothes_kit.clear_layers` (rays, 3.5 mm, skin 5 mm)
  and `tuck` (nearest point: whatever pokes out from under a garment, however far, is pulled under it).
- **UVs after the reduction** (`fix_islands`, `unwrap`): every island a disk (a tube gets a cut), Blender's
  minimum-stretch unwrap along the seams, an island that will not lie flat halved and unwrapped again, every face at
  its cloth's density (insides, rims, hems, cuffs and brims too), islands turned so the cloth's up is the picture's up,
  packed bottom-left (skyline) into the kind's clothes rectangle with square texels (the old square pack was squashed
  2:1 into the rectangle). Rebuilt near facings inherit the outer seams and have separate rim charts; otherwise
  planar fallback can paint lining triangles across the outer cloth.
- **Paint** at twice the layer (2048 px) and filtered down; the painter also sees the distance to the piece's edge
  (`ctx.edge`) and the cloth's own thread coordinates (`ctx.fu`, `ctx.fv`, from `Piece.fabric`: the shawl's check runs
  at 45 degrees to its folded edge, as a square shawl folded on the diagonal does). Woven shawls carry the same yarn
  pattern on both faces.
- **The far copy** reduces the finished near cloth with its UV charts (`cloth_lod.from_near`), then rebuilds
  matching 3 mm facings within the existing triangle budget. Discard the cage's face mask after rebuilding an
  apron: that joined mask does not describe the other garments. Skinning transfers only between matching
  anatomical or garment parts, so a hand beside a sleeve cannot inherit the sleeve's elbow weights.
- **Skin paint.** Garment-coloured skin masks are disabled for dressed bodies; actual stockings and gloves remain.
- **Occlusion** (`bake_occlusion`) over body and clothes together in vertex colour blue, by the render lane's rule
  (1 open .. 0.22 closed; `AO_RULE`): 40 rays over 10 cm, an arm against the trunk below the armpit and a leg against
  the other below the crotch not counted. The mesh is flagged `people2_occlusion_baked` so export does not bake it
  again. Held things are baked the same way.
- **The shared detail set** (`cloth_detail.py`): geometry where it changes the silhouette (folds of hanging cloth
  deepening to the hem and moving the cloth across, not along the hem's normal; sleeves bunched above cuffs and pushed
  up; trousers bagged at the knee and broken over the shoe; cuffs standing proud; buttons; a shawl's fringe; the klomp),
  the normal map and paint otherwise (weave, plaid, seams, stitches, nail heads, knife facets).
- **The klomp** (`cloth_detail.klomp`): carved willow (sole, a heel cup 8 cm high, a toe box drawn out to a blunt
  upturned point, a ledge round the foot), a leather top made on the foot's own cage from the toes over the instep to a
  collar round the ankle at leg ring t1, above the trousers' hem (no gap at the ankle); the leather inside the wood is
  deleted as hidden. Knife facets and grain along the clog, nail heads where the leather meets the wood.
- **The fishwife's shawl** (`cloth_detail.shawl`): one sheet walked down the bodice from its folded edge along a
  spline over the shoulders: the point down the back, the ends crossed over the breast (the left one 2.4 cm out, over
  the right) and under the apron band; a woven check in a 2/2 twill; a fringe of twisted tassels along the back's edges.
- **Seated drape**: skirts and aprons go with the shin below the knee (`hang_weights(knee_share=1, knee_band=(4, 10
  cm))`), so seated they lie on the lap and fall from the knees instead of standing out like a shelf; nothing is needed
  from the runtime. A corrective `sit` shape key (driven by the seated clips' weight) would let the side panels fall
  over the seat's edge; not made.
- **Check sheets**: `blender -b <scene> -P art-source/tools/blender/people2_sheets.py -- cloth [kinds=a,b] [out=dir]
  [gas]` (`preview_cloth.py`): per kind front, side, back and three-quarter at 3 m and 1 m, walking, seated on a bench
  (the family's D2 clip), close views of the collar, nape, cuff, waist, hem, shoulder, feet and cap, and low views.

### Period sources

Worker expansion (`kinds_workers2.py`, `garments_workers.py`, `held_workers.py`):
- [War Heritage Institute, Belgian blue smock, 1825–1830](https://warheritage.be/en/belgian-smock-combat-outfit-civilian-guard-volunteer): surviving loose knee-length linen cut and buttons. Earlier than 1873; used for construction, not an exact natie uniform.
- [John Thomson, *Street Life in London*, 1877–1878, Rijksmuseum](https://www.rijksmuseum.nl/en/collection/object/Street-Life-in-London--d9eb89414ebab5cb4d04bb118b9deb8f) and [National Portrait Gallery, *The Temperance Sweep*, 1877](https://www.npg.org.uk/collections/interactives/room-21-street-life-london): worn street coats, caps and sweep equipment. Nearby period comparison; London is not evidence of an Antwerp trade regulation.
- The original kind palettes and the Antwerp sources below determine the dockers' kiel and shoulder pad. The coalman's cut-sack hood, porter's brass cap badge, grinder's leather apron and baker boy's flour distribution are reconstruction choices; no exact Antwerp 1873 pattern is claimed.

These twelve workers use 14,000 near / 2,500 far triangle ceilings. Garments are reduced and cleared of overlapping layers before their final unwrap and paint; the far copy reduces the finished near cloth with its UVs, and both copies contribute coverage to the shared picture. Near hems, cuffs, collars, brims and soles keep the outside's texel density. Hands are excluded from body cutting. Complete shirt panels remain behind waistcoats when they move. Replacement boots remove both inherited clog shells and their top pieces; each boot keeps its own outward face winding. Soles join the boot upper at the welt and are excluded from garment layering. Thin stitched cloth lips and hidden mating surfaces are edge exceptions; hat brims, boots and leather pads use rounded geometry.
The sack uses `work.loads.sack`; the handcart uses `PushCart` and the existing `props:tr_handcart`. The existing `quaygoods:sack_truck_bare` still needs a native two-grip attachment for the new porter: `People2Things.Has` does not support trucks. No second sack, truck or handcart is authored in a worker mesh. The chimney rods, brush and rope coil form one back-socket model shared by both sweeps.

The look follows public photographs, paintings and sculpture of Antwerp's working people of the 1860s-1880s:
- *Antwerpen: de oudste foto's 1847-1880* (1999) and *Antwerpen gefotografeerd in de 19de eeuw*
  (1976): dockers' long blue smocks, cloth caps and wooden clogs; fishwives' white caps, shawls and aprons;
- period paintings and the later *Le Débardeur* sculpture: the smock, cap and leather shoulder protection;
- the ModeMuseum Antwerpen kepi with a Belgian cockade (1870-1910, Europeana);
- identities from `art-source/tools/blender/build_people.py` and the original fictional personas.
The police tunic's exact cut, button metal, collar facing and docker's shoulder pad shape remain assumptions.

### C-wide uniforms and gentry (C3, 2026-10-13)

`kinds_uniform2.py`, `garments_uniform.py` and `held_uniform.py` add soldier, soldier_b,
sentry, customs, priest, gentleman, clerk, tourist, shopkeeper, publican and baker.
New kinds request 14,000 near / 2,500 far triangles; existing kinds retain their budgets.
Coat skirts and open-sided aprons follow thighs/shins when seated; hems, cuffs, collars,
hat brims and soles have real closed thickness. Thin cloth lips and hidden layer interfaces
are intentional sharp-edge exceptions. Buckles, cane tips and rifle fittings have rounded
sections; the bayonet's cutting edge and the rifle's open machined muzzle are intentional.
One socket model each supplies the rifle, cane, leather book and sheathed bayonet.
The sentry's rifle uses handR fitted to the exported rifle clip's hand frame, retaining visibility
in rifle work clips without changes to the network motion list or runtime source.

Period references inspected for this reconstruction:

- James Thiriar, *Infanterie: Officiers supérieurs et sergent, 1863* and
  *Soldats en tenue de sortie, 1900*, [illustrations](https://www.1579.be/armee-belge-thiriar.htm):
  shako, collar/cuff facings and tunic outline. These retrospective pictures bracket the date;
  they are not an inspected 1873 regulation. Red pompom and corporal stripes retain the old design.
- Musea Brugge, Beersmans-Pleek, *Belgisch Leger*, BMV.10468, dated 1866 in its
  [IIIF catalogue](https://collectie.museabrugge.be/en/collection/work/id/BMV_10468):
  ceremonial silhouettes only; this hand-coloured print does not establish service colours.
- [Australian War Memorial REL/19095](https://www.awm.gov.au/collection/REL:19095),
  Braendlin Albini rifle dated 1867, and Royal Army Museum Brussels photographs of
  [M1853/1867 on Littlegun](https://littlegun.be/arme%20belge/fusils%20reglementaires/1%201867%20albini%20braedlin%20gb.htm):
  walnut stock, external lock/hammer, barrel bands and cleaning rod; fixed bayonet reconstructed.
- Xavier Rauch/AHAD, [*L'uniforme et l'armement du douanier mobilisé, 1870–1871*](https://histoire-de-la-douane.org/luniforme-et-larmement-du-douanier-mobilise-1870-1871/),
  naming the French circular of 6 March 1852 and 1845 officer outerwear reform, with Ernest Fort's
  engravings. These are French regulations, not Belgian authority. Green customs cloth, silver
  buttons and kepi retain the game's design; Belgian 1873 colour/cut remain unconfirmed.
- Aberdeen Museums, [*Black Wool Frock Coat*, 1870–1900](https://emuseum.aberdeencity.gov.uk/objects/12823/black-wool-frock-coat),
  and FIT [*1870–1879*](https://fashionhistory.fitnyc.edu/1870-1879/): frock coat/top-hat pairing,
  contrasting waistcoats and travelling suits. Priest and shop-trade cuts retain the original
  PEOPLE descriptions; exact local cassock, cap and apron patterns remain reconstructions.

All geometry and garment/prop pictures are generated by our code. Reference pictures remain
in `.scratch/c3`, are not redistributed as game assets, and supply no new third-party mesh/texture.

Measured body + clothes triangles (props and interchangeable hair are separate):

| Kind | Near | Far |
|---|---:|---:|
| soldier | 13,981 | 2,499 |
| soldier_b | 13,981 | 2,499 |
| sentry | 13,982 | 2,500 |
| customs | 13,988 | 2,492 |
| priest | 13,983 | 2,487 |
| gentleman | 13,988 | 2,497 |
| clerk | 13,985 | 2,500 |
| tourist | 13,986 | 2,497 |
| shopkeeper | 13,979 | 2,492 |
| publican | 13,988 | 2,500 |
| baker | 13,993 | 2,482 |

Review evidence lives under `.scratch/c3`: 59 Blender sheets in `finalshots`, and
209 native pictures in `native-final` at quays, streets and market. Native states are
13:00 clear/rain and 19:30 clear at 3/8 m, plus side/top/low-back and four motion views.
`full/geometry.json` verifies finite vertices/UVs/morphs, normalized weights and zero
degenerate C3 faces. The unchanged old `held_scabbard` still has 24 degenerate faces.
`full/animation-preservation.json` records 235 clips, 12,220 channels and 1,822 unchanged
node/rest transforms. Close shoulder/collar reduction shards, skin paint at cuffs and
finger intersections remain visible in the shared cloth/hands kit; these are lead follow-ups.
The Forward+ project-resource shader audit passed 538 samples: 130 kinds, exactly one
people2 kind, no new variants or light-count changes, zero problems. Seven native content
identity checks passed. The packed-data audit startup exited before reporting; logs and
the accepted project-resource receipt are indexed in `.scratch/c3/REPORT.md`.
Period uncertainties above remain open; shader success alone is not art acceptance.

### For the runtimes (E, F)

- Load a kind as a body: its root node is its armature; `<kind>_lod0` and `<kind>_lod1` as for bodies; the kind's
  base body's clips and locomotion meta (`kinds.<kind>.body`). `kinds.<kind>.avoid` lists clips it should not play.
- One native material, `people2_pictures`: all people share the clothes, face and detail arrays.
- `hands_hard` is set per kind in `kinds.<kind>.shapeKeys`.
- Held things: the children of `people2_held`, put on the socket bones (`kinds.<kind>.held`); the scabbard turned
  back by `held.hang`, the sabre in it at `held.sheathed`. `people2_held` is not a person (skip it when listing kinds).
- Shoes stand on y = 0: no lift needed.

### Known limits (C, first pass)

- The native port preserves this artwork. Close views still show small gaps/dark patches at the police tunic's
  waist and the cast's layered clothes; the art helpers own those repairs. Shader-audit success is not art acceptance.
- Edge exceptions: thin garment rims retain creases limited by their authored thickness; hidden body/clothing
  interfaces retain their fitted edges. Visible silhouettes come from the existing subdivision/limit geometry,
  not normal maps. Day, rain and evening proofs include low rear views; no geometry was changed in the port.
- The historical first-pass counts above were over budget; the second-pass counts are under “Clothing second pass”.
- No cloth simulation: the legs drive skirts, aprons and smocks; in a wide stride a skirt divides a little between the
  legs, seated it drapes over the lap and down the shins; the spring bones add the swing in the games.
- Faces are B's until the face package's types arrive (`face_of`).
- Independent layers allow more kinds without resizing existing pictures.
- Hair is painted under the hats (B's scalp shells are not built at this commit: `hair.scalp_thickness` returns zero
  unless the style has a fringe), so caps were fitted with room for real hair to come.

### The women of 1873 (package C2: `kinds_women2.py`, `garments_women.py`, `held_women.py`)

Twelve kinds on the MakeHuman bodies, each within about 14,000 near and 2,500 far triangles (the budgets in
`dress.py`: 14,000 crowd, 16,000 named, 2,500 far):

| Kind | Body | Reads as |
|---|---|---|
| fishwife_b | woman_slight | older fishwife: red printed kerchief tied under the chin, grey knitted shawl crossed, near-black bodice, dark green skirt, grey canvas apron, clogs, basket of mussels |
| maid | woman_slight | navy dress, white collar and cuffs, small white cap set back with lappets, long white bib apron tied in a bow behind, basket under a cloth |
| wife_a | woman_middling | white linen cap with a pleated brim tied under the chin, red check shawl with a fringe, blue-grey dress, white apron, laced boots |
| wife_b | woman_middling | blue dotted kerchief knotted at the nape with its point hanging, dark knitted shawl crossed and tied, brown dress with elbow sleeves, clogs |
| shopwife | woman_stout | black dress with jet buttons, lace collar, lace cap with a double frill and lappets, white bib apron, keys at the waist |
| old_woman_dressed | old_woman | white cap with a deep goffered frill and black strings, dark check shawl with a fringe crossed over the breast, black dress |
| milk_woman | woman_middling | white frilled cap tied under the chin, red check neckerchief, sleeves to the elbow, wide blue apron, clogs, leather money pouch (the dog cart and its cans are the game's `dogcart_milk`) |
| girl | child_middling | brown dress to the calf, small knitted shawl crossed and tied behind, plaits, clogs |
| girl_b | child_slight | green plaid (a woven sett) dress, white collar, pinafore with straps over the shoulders, plaits, boots |
| nun | woman_slight | a Black Sister (Zwartzuster): black habit with wide sleeves and a leather belt, white coif, wimple and bib, black veil, rosary |
| beguine | woman_middling | black dress and small collar, the white cap framing the face under the falie (the long black hooded mantle, open in front), rosary |
| tourist_lady | woman_slight | English visitor: dark green walking dress of 1873, bustle and train, overskirt looped up at the hips and puffed behind with a sash bow, pleated flounce, basque bodice, white collar and cuffs, small plum hat with ribbon and feather over the chignon, cream kid gloves, chatelaine bag |

Each kind has its own headwear and hair under it (`kinds_women2.KIND_HAIR`, added to `face_types.KIND_HAIR` when the
file is read, so `faceTypes.json kindHair` carries it): the undercap under every cap and kerchief, the bun under the
lady's hat, plaits for the girls. The kind "old_woman" cannot be a dressed root of the same name (the base body's
armature is called old_woman): the dressed one is `old_woman_dressed`; the game reaches it with
`--people2-map old_woman=old_woman_dressed` until `People2.Body` maps it.

How the garments are made (`garments_women.py`, on clothes_kit): skirts are full tubes with real folds, flat in front
(the 1870s cut) with their fullness at the sides and behind, and below the knee the cloth follows the shin, so a
seated skirt and an apron fall from the knees instead of standing out like a plate; the lady's skirt has a bustle
pad, a train and a pleated flounce. Bodices are oriented by the cage's normals (a few faces at the breast came out
turned in, and their facing then lay outside the bodice, over the shawl) and pushed clear of MakeHuman's skin (the
cage-made sleeves let the upper arm's skin stand out by up to 3 cm). The old woman's measured-surface exception
is described under the MakeHuman garment fitting above. Shawls are one band round the neck (point down the back, ends hanging or
crossed), weighted to the bodice without the elbow; fringes hang straight down as one row of creased tassels.
Kerchiefs, caps with frills, ties, lappets and bows, the nun's coif, wimple and veil, the beguine's hood-and-mantle
and the lady's hat are fitted by rays on the built head. Held things (`held_women.py`) hang from hipL: the maid's
basket under a cloth, mussels, a rosary, keys, a money pouch, a chatelaine bag.

Period sources (women): Henri De Braekeleer's Antwerp interiors and street scenes of the 1860s-1880s and Henri Leys's
Antwerp genre pictures (caps, shawls, aprons, the jak); the photographs collected in *Antwerpen: de oudste foto's
1847-1880* (white caps, kerchiefs, clogs, the falie worn by Antwerp women to church); the Zwartzusters' and the
Antwerp beguines' habits as shown in 19th-century photographs of the Sint-Catharinabegijnhof and the order's own
history; for the visitor, the fashion plates of 1873 (*La Mode Illustree*, *The Englishwoman's Domestic Magazine*)
and James Tissot's pictures of 1873-1874. The exact Antwerp beguine cap and the milk women's headwear are assumptions.

Counts (full build of 2026-10-13, 1,298 s, 16 kinds, 235 clips): every C2 kind 13,974-13,996 near and 2,479-2,500 far triangles; held things basket under a cloth 2,180, mussels 2,072, rosary 3,104, keys 1,820, purse 804, bag 748. Native evidence (replaced with `replace-people2.ps1`, all other model files preserved): dress captures of all twelve kinds at the Vismarkt (1 and 3 m, low backs, feet and tops, 13:00 clear and rain, 19:30 under the lamp), three runs with `--people2-map` putting four kinds at a time in the fixture's four places (the fixture's faces then follow the place's kind); shader audit: one people2 kind, 29 programs, no new kind; content identity 7 checks.

Known limits (C2): the baskets, pouch and bag hang at hipL, so they do not follow the hand (the clips have no basket
arm yet); held things show the held layer's placeholder in Blender's sheets; the shawls' and kerchiefs' clearance is
checked in Blender poses, the folds of a seated skirt are skinning, not simulation.

### The player (`kinds_player.py`, `garments_player.py`, `held_player.py`, 2026-10-14)

Jef (or Mie) on the people2 kit, with every choice of the character screen (`godot/src/Menu/Character.cs`) kept.
Each clothing cut of the old player (`build_player.py`) is a dressed kind, a man's on `man_middling` and a woman's on
`woman_middling`; the women get period versions of the men's outer cuts (the old player had none):

| Kind | Character screen | Reads as |
|---|---|---|
| jef_m_shirt | coat none, apron none | linen shirt with buttoned cuffs, waistcoat, trousers |
| jef_m_jacket | coat jacket | short open jacket over shirt and waistcoat |
| jef_m_coat | coat coat | long open coat to the knee |
| jef_m_smock | coat smock | the blue kiel over trousers |
| jef_m_apron | coat none, apron | shirt and waistcoat under a long working apron |
| jef_m_jacket_apron | coat jacket, apron | jacket and apron (any other coat with an apron: show the coat's kind, see below) |
| jef_w_plain | coat no_shawl | bodice and full skirt, cream collar and cuffs |
| jef_w_apron | no_shawl, apron | bodice and skirt under a long apron |
| jef_w_shawl | shawl or check_shawl | fringed check shawl over the bodice |
| jef_w_shawl_apron | shawl or check_shawl, apron | shawl and apron |
| jef_w_jacket | (new) jacket | fitted short jacket over the bodice |
| jef_w_jacket_apron | (new) jacket, apron | jacket and apron |
| jef_w_coat | (new) coat | fitted long coat (a redingote) |
| jef_w_smock | (new) smock | loose linen smock to the knee over the skirt |

A man's coat or smock with an apron, and a woman's coat or smock with one, have no kind of their own (the old player
had none either): the runtime shows the coat's kind. Shawls stay a woman's garment, as on the screen.

**What the runtime needs** (`peopleRig.json player`, beside `kinds.<jef_*>`):

- **Kind:** `jef_<m|w>_<cut>` from sex, coat and apron (table above). Root, LODs, clips and locomotion as any kind
  (`kinds.<kind>.body`). Budgets: near 13,000 for body and clothes, far 2,300; the shoes and the hat come on top.
- **Build and age** are the base body's sliders, carried by the clothes (`dress.clothes_keys`): `slight` = weight -0.8,
  muscle -0.4, shoulders -0.5, hips -0.3, belly -0.5, bust -0.6; `stout` = weight 0.9, muscle 0.1, shoulders 0.4, hips
  0.5, belly 0.7, buttocks 0.4, bust 0.6 (`preview_player.SLIGHT`, `STOUT`); age 46-60 adds `face_age` (0.9 at 60) and
  a face cell of the old groups. Face sliders as the creator proposal above.
- **Skin and hair colour** come from the face cell (`faceTypes.json cells`: skin, hair, `bodyTone`) and
  `People2Material.Face`: pick the cell of the sex and age group whose `hairRgb` is nearest the chosen hair colour
  (flaxen and fair: `*_fair_fair`; red: `*_fair_red` / `f_red_freckled`; light and dark brown: `*_mid_brown`,
  `*_mid_dark`; black: `*_olive_black`; grey and white: the old cells) and shift `body_tone` toward the chosen skin.
  Slots 1 (skin) and 2 (hair) are never painted into a jef layer.
- **Hair, beard, moustache:** the base body's pieces (`<base>_hair|beard|mous_<style>`), merged as for townspeople.
  Screen to people2: short `crop` (or `side`), long `long`, balding `bald`; bun, plaits, coronet the same names;
  under any hat `capped` (men) or `undercap` (women). Facial hair: moustache `chevron`, whiskers `chops`, beard
  `short`, walrus `walrus`; light stubble and stubble are the stubble painted in the chosen face cell (no piece; the cells differ in it).
- **Hats and shoes** are rigid models under `people2_held`, one per thing, each in its socket bone's rest frame:
  `jef_hat_flatcap|knitcap|bowler|tophat` (men) and `jef_hat_bonnet|whitecap|headscarf` (women) on `headTop`;
  `jef_boots_<m|f>_<L|R>` and `jef_clogs_<m|f>_<L|R>` on `footL` / `footR`. Put the model on a BoneAttachment3D of the
  bone with no offset. They use the picture entry `people2_held_jef` (`People2.cs` picks it for every `jef_*` model).
  A kind's `held` lists its default shoes (boots for men, clogs for women), so the game shows a shod default; the
  runtime swaps them per profile. A hat follows the head sliders through `player.hatFit` (scale x/z and lift per unit
  of each head slider; the hat has no morphs). The kinds' feet are drawn in (`squash_feet`) to lie inside every shoe:
  never show a jef kind without shoes.
- **Colours (the tint pack):** each jef layer ships in Jef's or Mie's default colours (`player.kinds.<kind>.
  defaultPalette`). `assets/people2-pictures/jef-tint/<kind>_tint.png` (and `held_jef_tint.png`; lossless, no mips):
  red = T / 2, green = slot x 16 (1 skin, 2 hair, 3 hat, 4 coat or shawl or smock, 5 shirt or blouse or bodice,
  6 waistcoat, 7 trousers or skirt, 8 apron, 9 boots or clogs; 0 fixed: buttons, soles, the women's linen collar and
  cuffs), blue = the check shawl's bars. Per texel of a slot: `colour = layer + T * (chosen - default[slot])`, in the
  stored sRGB-encoded values (decode after the sum); a plain shawl on a check kind divides the layer by
  `1 - 0.5 * blue`. The kit's painters are linear in a cloth's colour, so this equals a repaint in that colour
  (`player.tint.checks`: mean error below 0.002 per channel).
- **First-person sleeves:** `player.kinds.<kind>.sleeves` names the pieces with forearm weight (the sleeve of the
  outermost garment, the shirt or smock cuffs `cuffL`/`cuffR`/`smock_cuffL`/`smock_cuffR`, the women's linen cuffs).
  Every cut ends its sleeve at the wrist in a closed, rounded cuff band (a shirt's stands 2 cm proud when it is the
  outer layer; under a jacket or coat 1 cm, with a sliver of linen showing at the coat's cuff). The forearm islands
  get 1.6 times the texel density of the rest (`SLEEVE_BOOST`). The hands are the body's MakeHuman hands
  (`hands_hard` 0.3 men, 0.15 women).

**How they are made** (`kinds_player.build_player` around `dress.build`): the garments are the townspeople's
(`clothes_kit`, `garments_women`), each tagged with its colour slot; the men's waistcoat buttons to a V and runs over
the shoulders in narrow straps to the neck's foot. Each kind states its layer order (`layers_of`: skirt under coat or
smock, bodice under coat, shirt under waistcoat and trousers), so the clearance does not depend on the rays' votes.
Under a jacket, coat or smock the skirt's faces above the outer hem are cut away (outside the open front), and every
body face that the cuts always hide (the trunk below the collar line, the shoulders' tops, the arms to 5 cm above the
wrist, the legs above the ankle or, under a skirt, the knee) is cut whatever the rays said: a posed shoulder pushed it
through the cloth. The near reduction keeps the forearms (weight at most 0.35) and the occlusion bake lets a ray go on
past a limb it does not count (`ao_through`), so a resting arm does not shield the cloth behind it. The women's hats get 5 mm
more room (10 mm at the back, over the knot of the hair) and more triangles than the men's.

Checks: `people2_sheets.py -- player [kinds=...] [what=views,close,builds,acc,hair] out=<dir>` (`preview_player.py`):
front, side and back at 3 m and 1 m; collar, nape, shoulder, forearms, cuffs and hands at 0.35-0.5 m and the arms
seen from the eyes; slight, stout and old builds; every hat with its hair, boots and clogs; every hair, beard and
moustache.

Counts (full build of 2026-10-14, 2,672 s, 65 kinds): the jef kinds 12,841-12,999 near and 2,284-2,299 far
triangles for body and clothes; shoes 559-560 each, hats 898 (flat cap), 1,298 (knitted cap), 1,598 (round and
tall hat), 1,500 (bonnet, headscarf), 1,698 (white cap): a dressed, shod and hatted player 14,000-15,800 near.
Texel density 230-350 px/m for the clothes (forearms 1.6 times that), 393 / 479 px/m for the men's / women's hats and
shoes. The tint pack reproduces a direct repaint in other colours within a mean 0.0003-0.0007 per channel (99th
percentile 0). Parts `people2_player1..5.glb` (2.6-3.9 MB); 5.4 MB of tint pictures. Native: replaced with
`replace-people2.ps1` (all other model files preserved); `--people2-map` dress captures of seven cuts in the
fixture's places (13:00, rain, 19:30; 1 m, 3 m, low backs, feet, tops) with their default boots on the foot bones.
The fixture gives each place its own face recipe, so a woman's kind in a man's place gets his face and no hair: map
women's kinds to `fishwife_a`.
Known limits: the forearm and its cuff are still the clothes layer's texels (with the detail layers' weave) at 0.3 m;
the idle_f clasped hands meet the front of a long coat; the pose-time armpit occlusion shows as a soft dark mark at
the front of the shoulder when the arms come forward; on a stout woman (belly slider) the skirt shows through the
jacket's open front edges at the belly.

## Checks

`--preview` and `--cast` write to `.scratch/people2-build/shots/`:

| Picture | Shows |
|---|---|
| `bodies_front/side/back/threequarter.png` | all ten bodies, idle |
| `bodies_closeups.png` | each body's head and left hand |
| `turntable_3m.png`, `turntable_10m.png` | man, woman, child, old man from 8 sides at 3 m and 10 m in the game's fog, at a 1080-line window's pixel size (10 m blown up 3x); `turntable_10m_lod1.png` the far copy |
| `clips_man_middling.png`, `clips_woman_middling.png` | every old clip (in the order of `CLIPS`, rows of 9) |
| `clips_child_middling.png`, `clips_old_man.png`, `clips_old_woman.png`, `clips_man_stout.png` | idle, walk, sit, crouch, hop, beg, behind, walk_f, push |
| `bends.png` | elbows and knees at 120, a deep squat, arms up and out, a turned hand, close-ups, a body lying |
| `sockets.png` | a baton in gripR, a knife in gripL, a scabbard on hipL, a load on back, a hat on headTop; idle, walk, guard, talk; four bodies; fist close-ups |
| `grab.png` | a grab from behind from three sides; a body dragged by the wrists |
| `skin_<m, f, boy, old_m, old_f>.png`, `skin_*_n.png` | the five pictures and their normal maps |
| `faces_close.png` (`--faces`) | man, woman, old man, child at 1, 2 and 5 m (2 and 5 m blown up 3x), by day and under a gas lamp, front and three-quarter |
| `faces_big.png` | man (day, gas), woman, old man, old woman (gas), child from four sides, big |
| `faces_moves.png` | rest, talking, calling (the jaw), half and full blink, the eyes turned left and up |
| `faces_shapes.png` | every face shape at full on the man and the woman |
| `faces_hero.png` | a named man's near copy (side parting, mutton chops, walrus moustache) without and with hair cards |
| `faces_40.png` (`--sheet`), `faces_40_2m.png`, `faces_40_shapesonly.png` | 40 seeded people at 5 m and 2 m (each its own look, face mix and hair); the same face mixes with one look and no hair |
| `hands.png` (`--hands`) | the hand relaxed, open and in a fist from three sides; each grip from two sides; the docker's hand |

Run `pwsh -File native-godot/scripts/check-people2.ps1` for rendered native captures, parade, timing, shader inventory, data and multiplayer identity checks.

## Motion tools (`motion.py`, package D1; for D2, D3 and the fight clips J)

Everything works in the pose convention above (a pose: bone -> turn in armature axes, relative to the parent's
turned frame), plus one vector, the hips translation (armature axes, metres, from the rest position). Global turns
compose down the chain: `D[bone] = D[parent] @ pose[bone]`; heads `P[bone] = P[parent] + D[parent] @ (rest[bone] -
rest[parent])`. IK is solved in closed form in Python, not with Blender constraints: exact (a planted foot does not
move at all at the keys), the same on every run, fast; the result is plain FK keys.

| Tool | What it does |
|---|---|
| `yaw(d)`, `bow(d)`, `lean(d)`, `turn(y, b, l)`, `swing(S, fwd, out, twist)` | turns named by what they do: yaw + turns to the person's left; bow + tips an upright bone forward (a hanging one back: a knee); lean + tips an upright bone to the left (on the hips: the left side drops); `swing` is the old `limb()` |
| `V(left, fwd, up)`, `words(v)` | a point in the person's words to armature axes and back |
| `angle(a, b)` | degrees between two turns (atan2: exact for small angles) |
| `Curve(keys, period=None)` | a smooth cubic through keys `(t, value[, slope])`, values floats or Vectors; `period` makes it loop (slopes see across the seam) |
| `ease`, `ease_in`, `ease_out`, `smoothstep`, `smootherstep` | shapes on 0..1 |
| `overshoot(u, amount)` | 0 to 1, past the end by `amount`, back onto it; still at both ends |
| `lag(fn, delay, period)` | a signal later: a bone that trails the one that drives it |
| `follow(values, dt, freq, zeta, periodic)` | a spring trailing a sampled signal: follow-through and settle (loops close on themselves) |
| `share(total, bones, shares)` | one turn spread over a chain, exactly `total` together |
| `overlap(fn, bones, delay, falloff)` | offset of chained bones: the same motion rippling down a chain, each later and smaller |
| `Skel(J, mesh)` | one body's skeleton: `fk(pose, t)` (heads `P`, turns `D`, `point(bone, rest_point)`), `leg(pose, S, ankle, foot_rot, pole)`, `arm(pose, S, wrist, hand_rot, pole)`, `hold(pose, S, grip, hand_rot, pole)` (puts the `gripS` socket, the middle of the fist, on a handle), `look(pose, target, keep)` (a steady head over a moving trunk), `feet` (heel, its circle, ball, tip, sole from the mesh) |
| `twist_rule`, `clavicle_for` | the kit's armTwist (0.6 of the hand's turn) and shoulder lift rules |
| `roll(sk, S, flat_pos, yaw, r, ground_pitch)` | a planted foot rolled: r < 0 on the round heel (it rolls without slipping), 0 flat, r > 0 on the toes (the foot turns about the toe joint, the toes stay down) |
| `contacts(posed, sk, S)` | the posed heel, ball and tip |
| `Clip(name, poses, trans, loop, meta, root, ground, skel)` | a clip as frames at 24 fps; `sample(t)` plays it as the games do (slerp between keys) |
| `mirror_pose(pose, t)` | the other side's pose (L and R swapped, reflected) |
| `ease_into(clip, target, at, n, offset)`, `ease_from(clip, source, at, n, offset)` | join clips exactly: the last (first) n frames turn into the other clip's frames, so the hand-over frame is the other clip's own |
| `lock_feet(clip, stance)` | foot locking: a standing foot stays where it touched down (leg IK), let go smoothly when it lifts; for blends, gait switches, footwork that slides the body over planted feet, hit reactions |
| `key_clip(ao, clip)` | key every body bone's turn and the hips translation at every frame, one muted NLA track per clip |
| `slide(clip)` | the foot-slide measure: per foot the largest drift of a planted heel, ball or tip at the keys and as played (between keys too), and the swing scuffs |
| `seam(clip)` | a loop's seam: the turn between its last and first frame and the change of turning speed across it |
| `clearance(clip)`, `joins(a, b)`, `fk_check(ao, sk, pose)` | toe clearance in the swing; how far one clip's end is from another's start; this FK against Blender's own |

A worked use, a hand on a moving handle: build the trunk, then
`sk.hold(pose, "R", handle_point, hand_aim("R", fingers_dir, palm_dir), V(-0.6, -1, -0.3), t=hips_t)`
(`clips_move.hand_aim`, `hold_on_bone` for a point carried by a bone, `hold_in_world` for one fixed to the node).

## Locomotion (`clips_move.py`, package D1)

### How a clip is made (`evaluate(plan)`)

1. A plan says where the body goes (`body(t)`: a ground point and a facing), where each foot stands and when
   (`Stance`: a fixed place from landing to lifting, with its roll over time: heel strike, flat, heel off, toe off),
   how each foot swings to its next stance (keys for its path, pitch and toes, in the body's frame), and what the
   body does on top (`layers`, `upper`: pelvis, trunk, arms, head, hands).
2. The hips' height comes from the legs. While a foot carries the weight its knee follows a bend profile (a walk:
   nearly straight at the strike, bent at loading, straight over the foot, bending as the heel rises; a run: most
   bent at mid stance), so the pelvis drops at contact and rises over the foot by itself. A leg is never asked to be
   longer than it is; a landing leg pulls the pelvis down to meet its foot; in a run's flight the hips fly on a
   parabola under gravity. Then the height is smoothed (over the moving ground, so climbs loop).
3. A foot that no longer carries the weight rises on its toes as far as its leg needs (the knee bending toward
   toe off), never past 70 degrees: the heel rise comes out of the leg, not a table, and the toes stay planted.
   Three passes settle hips and heel rise together.
4. Every frame: legs by IK onto the feet (knees toward the feet), the trunk (lean, part of a big lean in the pelvis,
   the chest against the pelvis, the side lean that keeps the shoulders level, a nod at each strike, breathing),
   arms (a swing from the shoulder with the elbow and wrist lagging, or a hold), a level head that keeps 15-35% of
   the trunk's motion, hand shapes.
Steps and toe offs fall on whole frames (both feet sampled alike, no lift between two keys).

### The clips

Loops are two strides (left heel strikes at 0 and 0.5 of the clip, the right at 0.25 and 0.75), in place: move the
node at `speed`. Each is made on its own body; other bodies of the same base play it unchanged.

| Clips | Body | Speeds (m/s) |
|---|---|---|
| `man_stroll`, `_walk`, `_hurry`, `_run`, `_sprint` | man_middling | 0.9, 1.35, 1.9, 3.5, 5.5 |
| `woman_*` (the same five): narrow steps, more pelvis, small arm swing; running she holds her skirt up | woman_middling | the same |
| `old_stroll`, `_walk`, `_hurry`: short flat steps, wide base, bent knees, little arm swing, eyes down (no run: cap the old at 1.9) | old_man | 0.9-1.9 |
| `child_*` (five): quick steps, big arm swing, a bounce | child_middling | 0.9-5.5 |
| `stout_*` (five): wide base, toes out, a waddle, arms held out, leaning back behind the belly | man_stout | 0.9-5.5 |
| `laden_stroll`, `_walk`, `_hurry`: a load on the back, bent forward, hands on the straps | man_middling | 0.9-1.9 |
| `man_slope_up`, `_slope_down`, `woman_slope_*`: an 8 degree slope, leaning into it or holding back | own | 1.35 |
| `man_stairs_up`, `_stairs_down`, `woman_stairs_*`: one tread a step (rise 0.17, going 0.28), flat landings going up, toes first going down, lift before reach | own | about 0.6 along the stair |
| `sack_walk`, `crate_walk`, `cart_push`, `cart_pull`, `truck_push`, `truck_pull` | man_middling | 1.05-1.2 |
| `sack_hold`, `crate_hold`, `cart_push_hold`, `cart_pull_hold`, `truck_push_hold`, `truck_pull_hold`: standing with the load (4 s, a weight shift, breathing) | man_middling | 0 |

Clips that travel move and turn the hips (no root bone): play them, then move the node by `travel` (fwd, left, yaw)
and go on with the next clip from its start.

| Clips | What |
|---|---|
| `man_start_walk`, `man_start_run`, `woman_start_*` | from standing (feet at rest): the weight onto the left foot, a short right step, a full left one; ends exactly on the loop's frame 0 (`then`) |
| `man_stop_walk`, `man_stop_run`, `woman_stop_*` | from the loop's frame 0 (`from`): the right foot comes beside the left, the body runs on a little and settles back, the arms swing out and still, a small left step squares the stance |
| `man_turn_l90`, `_r90`, `_l180`, `_r180`, `woman_turn_*` | on the spot, standing to standing, three or four steps; the head leads and overshoots a little, the chest follows, the pelvis last, the arms trail and settle |

Loads and handles (`peopleRig.json locomotion.loads`, points in the man's words): the sack across the left shoulder
(from armUpL's head), the crate against the belly (from the chest), the handcart's grips ahead (props.glb
`HANDCART_GRIP`: 0.34 either side, 0.76 up) or at his sides when he draws it, the sack truck's handle tips ahead
(tipped back toward him) or behind. Whoever places the sack, crate, cart or truck model puts it there; the hands are
solved onto those points (`carries.png`, `holds.png` show stand-ins).

### For the runtimes (E, F)

- Hips translation tracks: the clip's own body's offset from its rest, added to man_middling's hips rest
  (`locomotion.trackBase`). On a body X: `X rest + (track - trackBase) * X.hipsBone / clipBody.hipsBone`. Keep the
  translation tracks (bob, sway, travel); the native sampler retains them.
- The speed blend (`locomotion.blend`, `blend_by_speed` is the reference): walks (stroll, walk, hurry) mix among
  themselves and runs (run, sprint) among themselves, two neighbours by speed with `w = (Sa - v Ta) / (v (Tb - Ta) -
  (Sb - Sa))` (S stride, T cycle from the clip's meta), one shared phase advanced by `dt / (2 T)`, `T = lerp(Ta, Tb,
  w)`; past a family's end play its end loop at `cycle = stride / v`; walk to run (and back) at 2.2 m/s by a
  crossfade inside a window where both gaits agree (`switch_windows`), never held as a mix. **Lock the planted feet
  with leg IK every frame** (`lock_feet`): a mix of poses moves the pose, not the feet. Measured from stroll to the
  fastest loop in 8 s: 1.2-1.9 mm stance slip with the lock, 14-19 cm without (the walk to run switch); no hitch (the
  sharpest change of turning speed stays below the loops' own).
- Start and stop hand over exactly (0.000 degrees, 0.00 mm, `checks.joinDeg`); turns end in the rest stance turned.
- Nothing is mirrored at run time: left and right turns are separate clips.

### Measures (printed by every build, stored per clip in `locomotion.clips.<name>.checks`)

- Foot slide in stance at the keys: 0.00-0.98 mm for every clip (most under 0.3). As played between keys: 0.3-3 mm
  for walks and carries, 3-7 mm for runs, 11 mm for the child's sprint: an in-place clip moves a planted foot back
  23 cm a frame at 5.5 m/s and interpolating joint turns bows that path; the runtime foot lock removes it.
- Swing scuffs: none, except up to 5 mm in the stop's squaring shuffle and 2-3 mm in the turning steps (low steps on
  purpose).
- Loop seams: under 0.0005 degrees.
- The file plays back what was authored: clips imported from people2.glb into Blender match the authored bone heads
  within 0.03 mm over whole clips, travel and turns included.

### Check pictures (`--move`, `.scratch/people2-build/shots/move/`)

`sheet_<style>.png` (each loop: four side views across the first stride and two from ahead), `turntable_<style>.png`
and `turntable_*_climbs`, `_carries`, `_startstop` (a frame of each clip from eight sides), `chrono_*` and
`strip_*` for slopes and stairs (chronophotographs: every third frame where it happens), `strip_*_start_*`,
`strip_*_stop_*` (the camera rides with the hips), `turns_<style>.png`, `carries.png`, `holds.png` (with stand-ins
for the sack, crate, cart and truck), `blend_<style>.png` (stroll to the fastest loop, one frame a half second) and
`blend_man.mp4` (the same as a film).

## Idles, talk and sitting (`clips_idle.py`, package D2)

### How a clip is made (`Spec`, `frame`, `evaluate`)

A clip is a `Spec` on a family's body (`Fam`: its skeleton, its stance, the near copy's surface for hands that rest
on it). Every frame:
1. the weight (`spec.weight(t)`, the share on the left foot) puts the hips over the loaded foot (`shift`), drops the
   free side of the pelvis (`list`) and turns the free hip forward (`yaw`); the hips' height comes from the loaded
   leg's knee (`kLoad`, nearly straight), never more than a leg reaches;
2. the legs are solved by IK onto the planted feet (`motion.Skel.leg`); the free foot rises on its ball (`roll`) as
   far as its relaxed knee (`kFree`) needs, the toes staying down; a shift of the feet is a short step (heel up,
   lift 2.8 cm, set down flat);
3. the spine chain counters the pelvis (the shoulders stay level) and breathes (a whole number of breaths a loop);
4. the head goes where it looks (`spec.look`: held places with a small overshoot and a drift) and the chest
   follows a share of it a moment later (`lead`, `lead_lag`): the head leads;
5. each arm is a `Hang` (forward, out, elbow, breathing, and a pendulum trail on the hips' sway), a `Place` (a
   hand's palm on a place of the body or in the space before it, by IK with the elbow toward a pole, the hand turned
   either to world directions or against its own forearm, `hand_turn`: supination, flexion, deviation; the turn about
   the forearm is held within 100 degrees, `limit_twist`), or an `ArmTrack` of them: between two poses the joints go
   over one after the other from the shoulder out (the hand 0.09 s and the fingers 0.11 s after the shoulder), eased,
   a stroke passing its end a little;
6. hand shapes (`HANDS`: the kit's and rest, clasp, scratch, beat, palm, tuck, pocket, knuckle) blend with the arm;
   the jaw speaks (`speech`: syllables of their own size inside each phrase).
Sitting is the same with the pelvis on the seat: the hips' height is the seat plus the thigh's back
(`sit_height`, from the near copy), the pelvis tilted back, the feet planted by IK (or, for a child on a bench,
hanging and swinging). Every signal is periodic in the loop and every loop of a family starts and ends in the
family's neutral stance (the weight in the middle, the feet at their base), so one idle or talk hands over to
another at a seam without a foot moving. The shoulder helpers are keyed by the rule (`motion.shoulder_helpers`).

### Families and clips

| Family | Body | Plays on | Clips |
|---|---|---|---|
| man | man_middling | man_middling, man_slight | `man_idle_shift`, `_feet` (a foot shifts, a scratch at the nape), `_hips`, `_behind` (rocking heel to toe), `man_fold`, `man_pockets`; `man_talk_calm`, `_eager`, `_cross`, `man_listen`, `_listen_fold`, `man_laugh`, `man_shrug`, `man_point`; `man_sit_bench`, `_chair`, `_crate`, `_step` and each one's `_down`, `_up` |
| woman | woman_middling | woman_middling, woman_slight | a woman's stance (feet close, the right a little ahead and turned out): `woman_idle_shift` (hands folded before her), `_feet` (a hand to the back of the head), `_hips` (fists on the hips), `woman_fold`, `woman_behind`, `woman_pockets` (hands folded low); the eight talk and listen clips; `woman_sit_bench`, `_chair`, `_crate`, `_step` (knees together, hands in the lap) with `_down`, `_up` |
| stout | man_stout | man_stout (falls back on man) | `stout_idle_hips`, `stout_fold`, `stout_pockets` (hands on his own bigger belly), `stout_sit_bench` |
| wstout | woman_stout | woman_stout (falls back on woman) | `wstout_idle_hips`, `wstout_fold`, `wstout_idle_shift`, `wstout_sit_bench` |
| old | old_man | old_man | bent knees, eyes lower, slower: `old_idle_behind`, `_front`, `_back` (a hand rubs the small of the back, a stretch), `_feet` (a scratch at the back of the head); `old_talk_calm`, `_cross`, `old_listen`, `old_laugh`, `old_point`; `old_sit_bench`, `_step` |
| oldw | old_woman | old_woman (falls back on old) | `oldw_idle_front`, `oldw_idle_fold`, `oldw_talk_calm`, `oldw_listen`, `oldw_sit_bench` |
| child | child_middling | child_middling, child_slight | quicker loops: `child_idle_shift`, `_rock`, `_feet`, `child_pockets`, `child_talk`, `child_listen`, `child_laugh`, `child_sit_bench` (the feet hang and swing), `child_sit_step` |

Talk: phrases with a gesture each (`GESTURES`: offer, offer_out, beat, beat2, point, chop, chest, open, stop,
wave, fist, count) from places before the body (`GP`, the hand turned against its forearm); a calm set (one hand,
small offers and beats, a hand to the chest), an eager one (both hands, bigger and quicker, leaning in) and a cross
one (a hand on the hip, pointing, chopping, a fist, shaking the head). The head nods into each stroke 0.13 s before
it lands. Listening: the weight shifts, small nods, the head tilted. A laugh, a shrug (shoulders up, palms up), and
pointing the way (the head turns first, the chest follows, the arm points along the street twice, then explains).

Seats (`SEATS`): bench 0.45 m, chair 0.46 (sitting back), crate 0.40 (elbows on the knees), step 0.20 (knees up).
Sitting down and getting up (`sit_change`, 1.75 s) go from the family's stance at the node to the seat's frame 0
and back: the feet step out from (or back under) the body, the hips come down late and soft with the trunk leaning
over the feet; both ends hand over exactly (`ease_into`, `ease_from`). They stay over the node, as the games place
a seated person: the first half second stands where the seat is.

### Measures (printed by every build, in `peopleRig.json idles.clips.<name>.checks`)

97 clips (69 loops and 28 changes of seat), 831 s, 20,050 frames. Planted feet at the keys: the ball and the toe
tips 0.000 mm in every clip; a heel that leaves the ground moves at most 0.31 mm while it rises (it turns about the
toe joint). As played (slerp between the keys): at most 0.36 mm standing, 0.001 mm seated. Loop seams: at most
0.00001 degrees, and the change of turning speed across a seam at most 0.76 deg/frame^2 (never above its loop's
own). Sitting down and getting up: planted feet at most 0.6 mm at the keys and 2.7 mm as played, the stepping feet
brush the ground at most 3 mm. `glb_slim` thins these clips' keys (587,000 to 116,000: a key left out is within
0.04 degrees, or 0.15 mm for the hips, of its neighbours' interpolation); the art master grows from 7.4 to 11.4 MB.

### For the runtimes

`peopleRig.json idles`: `bodyFamily`, per family its lists by motion (`idle`, `fold`, `behind`, `pockets`,
`talk.calm|eager|cross`, `listen`, `laugh`, `shrug`, `point`), its seats (`sit.<kind>`: clip, seat height, seated hips)
and changes (`sitDown`, `standUp`), the `fallback` family, `seats` and the `rules`. The hips translation tracks are
the clip's own body's offset on `trackBase`, as D1's. The native runtime follows these rules: docs/godot-people2.md
"Idles, talk and sitting".

### Check pictures (`--idle`, `.scratch/people2-build/shots/idle/`)

`sheet_<family>.png` (every clip a row: six moments from the front three-quarter and one from the side),
`strip_<clip>.png` (twelve frames across the clip), `kinds_<clip>.png` (the men's clips on docker_a, fishwife_a,
police and sooi, the women's on fishwife_a: two moments, front and back), with a stand-in seat under the seated ones.

### Known limits (D2)

- Clips play on other bodies of their family unchanged: on a slight body a hand that rests on the trunk stands off
  it by a few millimetres; the stout bodies have their own versions of the resting hands.
- A hand that rests on the body allows 3 cm for clothes (`CLOTH`): very thick layers (a shawl over a bodice) can
  still take a fingertip.
- Sitting down and getting up happen over the node (the seat): the first half second of sitting down stands in the
  seat's place before the feet step out.
- The eyes are the runtime's (`HumanLayers`), not the clips'; nothing blinks yet.
- A held thing goes where its hand goes: the fishwife's basket (on `gripL`) comes before her with her folded hands.

## Work (`clips_work.py`, package D3)

### How a clip is made

D2's solver (`clips_idle.Spec`, its `frame`) with three things added (`WSpec`, `wframe`):
- a work stance: the feet set for the job (`base`: wider, staggered) and stepped into and out of where the clip must
  start or end in the family's stance; kneeling legs (`kneel_hips`, `kneel_leg`: a knee joint on the ground, the
  shin back along it, the instep flat or the toes tucked) and given feet (a treadle, the pedals, a foot up on a wall);
- `Grip`: a fist round a handle, solved so the grip socket's fitted handle axis (`peopleRig.json grips`, `axisAt`)
  lies on the handle with the thumb along it and the wrist on its side; the hand takes the fitted curls for that
  handle's radius (`hands.grip_fit`); `Along` moves the fist along a path (a rope, a crank, a broom's handle);
- things: what the work moves (`things(t, ctx)`, a matrix and a size each, in the node's frame, made from the pose so a
  sack on the shoulder rides on the shoulder; `things_late` for a thing in a hand). The arms are solved onto them.
Every frame the settled grips and palms are measured against their targets (`gripMm`, `reachMm`).

### The clips

| Clips | Family | What |
|---|---|---|
| `sack_lift`, `sack_lift_high` | man | a sack off a pile onto the left shoulder: the stagger, the squat with a flat back (low) or the lean and the draw over the edge (waist high), the ears taken, the strain, the rise on straight arms rolled to the belly, the dip and the drive, the sack swung up and over (turning a quarter), the body giving under it, the left hand to the front end, the step up into the stance |
| `sack_hold`, `sack_down` | man | standing with the sack (weight shifts, deeper breathing, the head held away); setting it down onto a pile (tipped off the shoulder into the hands, lowered with a squat) |
| `sack_pass_give`, `sack_pass_take` | man | two men: the one at the pile lifts and heaves the sack onto the shoulder of the carrier at his right, who sets his knees and takes it; made together, the taker 0.50 m to the giver's right and 0.24 ahead (`partnerAt`) |
| `cask_roll` | man | a cask rolled along at 0.8 m/s: D1's gait bent over it, the palms pressing on its upper back in turn with the steps (a paced loop: the game turns the cask by the distance) |
| `rope_haul` (`pull`), `winch` | man | hand over hand on a rope from a block overhead (the body sinking into each pull); a winch's crank turned with both hands (two turns a loop, the body rocking with the handle) |
| `gut` (`fish_stall`) | wstout | a fishwife at her table: a fish taken from the heap, held down by the head, slit toward her, the guts scraped over the edge into the bucket, the fish to the basket, a glance up at the market |
| `sweep`, `man_sweep`, `scrub` | woman, man | a birch broom swept across (five strokes, the trunk turning, the weight from foot to foot); on hands and knees with the scrubbing brush, the left hand propped, once a loop the brush wetted in the bucket |
| `wash`, `lace`, `cross`, `woman_call` | woman | stooped over the bucket rubbing and wringing; at the lace pillow on a chair; the sign of the cross and a prayer; a street cry |
| `call`, `smoke`, `beg` (`old`), `man_beg`, `wall`, `lean_rail`, `point_up`, `write`, `man_cross` | man | a cry with the hand at the mouth; the pipe to the mouth and the smoke let out; alms with the cupped hand; leaning back on a wall with a foot up; forearms on a rail; pointing up at the spire with the guidebook; writing in the book on the forearm |
| `rifle_idle`, `rifle_talk`, `rifle_walk` | man | the sentry: the rifle at the shoulder in the right hand (still, talking with the left hand, marching) |
| `grind`, `row`, `ride` | man | the knife grinder (the treadle, the blade to the stone); rowing on a thwart (the drive 0..0.42 as the game's oars); the velocipede (one loop a wheel turn, the feet on the pedals) |
| `crouch`, `child_crouch`, `hop`, `rope_turn` | man, child | one knee down working at the ground (marbles, stones, cards); a hop (the game moves the node); turning a skipping rope |

The old `push`, `carry`, `walk_sack`, `idle_sack`, `push_idle` are D1's carry clips (`sack_walk`, `crate_walk`,
`truck_push`, `cart_push` and their holds) and `sack_hold`; `pockets`, `behind`, `fold` are D2's.

### Measures (printed by every build, in `peopleRig.json work.clips.<name>.checks`)

Planted feet at the keys at most 0.3 mm in every clip; loop seams under 0.0002 degrees; the hands on their handles
(`gripMm`) and palms on their places (`reachMm`) are printed with where the worst is: within 7 mm for the sack, the
cask, the rope, the winch, the broom, the knife and the oars' drive; known misses are the scrubbing hand at the far
end of a stroke (21 mm), the lace maker's right hand (18 mm), the oars in the recovery (24 mm) and the cross's touch
on the forehead (14 mm).

### For the runtimes

`peopleRig.json work`: `families` (per family the clips for a game motion, `motions`, and for a context the game
knows, `contexts`: `haul_sack`, `haul_pass`, `fish_stall`, `cask`, `winch`; `fallback`), `kinds` (kinds whose load
decides their clips: the sentry, docker_sack, the porter, the carter), `loads` (where the sack and a crate ride: a
bone, the offset and turn in the bone's frame, the size, the walk, the hold, the lifts and the set-down) and `clips`
(each with its `things`: on a bone, or a track of `[t, x, y, z, qx, qy, qz, qw, length, thickness, width]` in the
node's frame in game axes). The native runtime: docs/godot-people2.md "Work".

### Check pictures (`--work`, `.scratch/people2-build/shots/work/`)

`strip_<clip>.png` (twelve frames, front three-quarter and side, with stand-ins for the things and the props),
`seq_<clip>.png` (twelve frames across a transition), `feet_<clip>.png` (the feet's contacts from above). Trials:
`--only man_middling,woman_middling,woman_stout,child_middling,old_man --nokinds --no-move --no-idle --fast --work
[--work-only a,b]`.

## For the next packages

- **B (faces, hands, hair):** done, see above.
- **C (clothes, kinds):** the first pass is done (four kinds, "Kinds and clothes" above). The other kinds go into
  the four group files the same way; the shared functions are `clothes_kit.py`'s (ask before changing one another
  group relies on). New kinds receive independent picture layers from `pictures.py`.
- **D (motion):** D1, D2 and D3 are done ("Motion tools", "Locomotion", "Idles, talk and sitting", "Work" above). New motion builds on `motion.py`: author on the body
  the clip is for, key the 47 `keyed` bones and the hips translation in every clip (`motion.key_clip` does), check
  with `slide`, `seam`, `joins`; add the clips to `make_all`'s list or a list of their own beside it.
- **J (fights):** footwork is stances and swings in a `clips_move.Plan` (feet fixed while down, the body moving
  over them); guards and blows are poses on `Curve`s with `overshoot`, `follow` and `overlap`; grabs and blows on a
  mark use `Skel.arm` and `Skel.hold`; join moves with `ease_into` and `ease_from`; `lock_feet` holds the feet when a
  hit reaction or a blend moves the body; the two-person moves put both `Skel`s in one scene.
- **F (native runtime):** load `res://assets/game-models/people2.scn`; the bone names repeat per body (glTF adds `_1`: strip it, as today).
  Face shapes, blink and hard hands are morph targets of `_lod0` (see "Face shapes"); the eyes turn by `eyeL`/`eyeR`;
  the material has a normal map (use it or bake it into a bump; exactly one additional people2 shader kind).
  LOD: two meshes per body on one skeleton, show `_lod1` from 15 m and in mirrors and the lantern shadow. The
  old `people.glb` clips also play on these skeletons. Keep hips position tracks for fight clips. Each frame (or in
  the clips): armTwist = 0.6 of the hand's turn about the forearm if code turns the hand. Body scale against the old
  kit: `extras.people2.scaleToOld`.
- **J (fights):** grab and hit marks above; paired moves place both armatures by their top nodes; a body on the
  ground is the hips turned and translated; the drag pose in `grab.png` is reached with two-bone IK.
- **K (weapons):** model each with its grip at the origin, tip along +y, edge along -z; hang it on gripR/gripL,
  sheathed ones on hipL; move it to the grip table's `axisAt` for its handle size and use that table's curls.

## Leftovers fixed (#82, #138, #140, #182; 2026-10-18)

- **Shoulders and knees.** `motion.clavicle_for` (every hold pose of D1-D3) uses the old clips' rule
  (`clips_legacy.CLAV_FROM/RATE/MAX`: a quarter of the rise past 30 degrees, at most 30, none for a reach backward).
  `mhbody.shoulder_rule` splits the chest-helper-arm blend with smooth shares (the straight ramps' kinks folded the
  skin at the front of the armpit). `mhbody.knee_rule`: a 5.5 cm blend either way, its middle 2.5 cm below the joint on the
  kneecap's side and 2.5 cm above it behind; `preview.bend_measure` at 120 degrees: man_middling
  42% before, 46% after; woman_middling 52%, 54%; man_stout 48%, 45%; child_middling 75%, 66%.
- **The old.** `clips_legacy.OLD_STANCE` thigh 7, knee 14 degrees (was 5, 10), hips 6 mm lower. The stoop itself
  stays at 17 degrees (men) / 15 (women): it bends the body's rest shape, and the garments are laid on it from an
  upright pattern; at 24 and 32 degrees the old man's coat stood off his back and his chest came through its front.
  A deeper stoop needs the garments laid on the bent body (open).
- **Feet.** `mhbody.LOD0["foot"]` 950 (was 700; the scalp 560, was 260; the trunk gives them, 960, was 1,350, mostly
  under clothes; the legs keep 1,100): round toes with nails for barefoot people and a smooth bald crown. The urchins' dirt is noise splashes (a sine drew
  stripes).
- **Hair.** `mhface.HAIRLINE`'s nape runs nearly level across the back (a crop's and a cap's hair hung a tail down the
  nape, a bun left a dark stub). The face painter no longer fades its paint into plain skin along the head island's
  own cut over the crown (the pale streak over a bald head). `Side.locks`: 26 narrow rounded locks, staggered, and 9 on
  the small side (were 15 planks of 2.8 cm). `Undercap`: 2.6 mm under the cap, flat locks, a small flat knot (the hair
  showed through the linen).
- **The player's hats** (`held_player`): felt with matted fibres, a grosgrain band standing 0.8 mm proud with its bow
  on the left, the brim bound with ribbon; the flat cap's peak felt with four rows of stitching.
- **Layers** (`clothes_build`): `clean_sleeves` keeps a sleeve below the armpit on its own arm's bones (a sleeve
  touching the chest at rest was dragged into a wing when the arm rose); `follow_under` gives a garment lying on
  another most of the lower one's weights within 4-12 mm (shawl over sleeve, apron over skirt, coat over waistcoat),
  never across an arm and the trunk or legs, and a coat's sprung tails stay free of the trousers. `dress.SKIRT_UNDER`:
  a skirt is always under a jacket, coat or smock. The final layer bindings and skin rules are listed under
  “Clothes: high detail” above. The far copy's lining lies 4 mm deeper (`dress.thicken_far`).
- **Occlusion.** `clothes_build.occlusion` counts an arm against the trunk only inside the armpit's hollow (60 mm round
  rig.py's armpit mark): the hanging arm no longer darkens the front of the shoulder.
- **Seated skirts.** `dress.sit_key` writes a `sit` shape on a skirted kind's near copy (skirt, overskirt, flounce,
  habit skirt, apron): over the lap the front lies down on the thighs, below the knees the sides and back fall in to
  the legs, the front hangs straight and the hem drops 3 cm. The game keeps it live (`People2Faces`, beside blink,
  brow and smile) and sets it while the person sits (`Human2.SitWeight`, eased over 0.6 s).
- **Rowing** (`clips_work.row`, `row_handle`): the game's oars are pushed (the rower faces the bow, as Jef does), so
  the clip pushes too: the handles follow the oars' own stroke (drive 0..0.42, the dip eased out and in), the back
  leans into the push and comes back with the hands. The game puts the fists on its oars' grips (`Rowing.HoldOars`).
- **Climbing a quay ladder** (`clips_work.ladder`, `LADDER`): facing the wall 0.30 m off the rungs, the left hand
  with the right foot and the right hand with the left foot, two rungs (0.58 m) a loop; the game sets the phase from
  the node's height over the rungs (`Human.ClimbLadder`), backward for a climb down.

## Known limits

- The motion treats the back of the sole as a round heel (`motion.HEEL_R`). If anyone moves the sole or adds a heel
  (shoes, boots), the foot points come from the mesh at build time, so the clips follow; rebuild and read the slide
  and scuff measures (a longer toe catches the stairs: the toe end stays at 0.195 m from the ankle's line).
- (Cage bodies only, history: the MakeHuman feet have their own toes in the mesh; bare feet keep 950 near
  triangles since 2026-10-18.)
- Keys are at 24 fps (the kit's rate): fast in-place clips bow a planted foot between keys by a few mm (see the
  measures); the runtimes' foot lock takes it out.
- The skirt and coat-tail bones are not keyed (springs in the games); nor are the sockets.
- The faces are plain and a little stylised; the women's and children's faces differ from the men's by moved
  landmarks on one mesh, so the differences stay moderate. Hair is shells and tubes: no loose strands but on the cards.
- The fist (`HANDS["fist"]` in clips_legacy, D1's) leaves the finger tips short of the palm; the grips are fitted.
- The face shapes have no shape-key normals: lighting follows the base face (the shapes are small).
- Beards are shells over the decimated face: big beards (mutton chops) show a small dent or two over the cheekbone
  at 1 m (`faces_hero.png`); hair cards add little on top of a shell of the same colour.
- Undressed base bodies remain over A's crowd budget; the dressed kinds have separate clothing budgets (see Counts).
- The crown is about 1 cm higher than the table height (1.68 m for 1.67 m).
- The little finger has no bones of its own (it curls with the ring finger), as the plan allows.
- `girths()` cannot measure the old bodies' necks (the stoop tilts them out of a level cut).
