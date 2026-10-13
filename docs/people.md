# People: the people2 kit (skeleton, base bodies, kinds)

Packages A, B and the first pass of C of the people plan (`docs/plans/people.md`, section 3); since 2026-10-13 the
bodies, faces and sliders come from MakeHuman's CC0 core assets ("Bodies from MakeHuman" below, tools and licences in
[makehuman.md](makehuman.md)). The native game's new people are built on this kit: one 64-bone skeleton for everybody, ten base bodies with faces, hands and hair (B), and
the dressed kinds (C, "Kinds and clothes" below). Clothes and kinds (C), motion
(D), the native Godot runtime (F), Jef (G), fight motion (J) and weapons (K) all build on it. The native runtime is opt-in (`--people2`); ordinary play keeps the existing native people scene.

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
| `art-source/client/public/models/people2.glb` | 10 bodies and the kinds, each an armature (named after the body or kind) with `<name>_lod0` and `<name>_lod1`; the held things under `people2_held`; one tiny intake placeholder material; independent clothes/face pictures in `native-godot/assets/people2-pictures`; 199 clips (36 old, their 4 variants for the old, 62 locomotion, 97 idles, talk and sitting), the near copies' shape keys; compressed art geometry, lossless PNG placeholder |
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
  picture's density) plus the eyes 172; far copy 1,740 plus the eyes: 1,912. Hair pieces on top for a base body: hair 640 to 940, beard up to about 960, moustache about 150.
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

**Baked at spawn, not blended per frame.** The glb carries the sliders as live morph targets (for authoring and the
character creator). At intake they leave the meshes for one sparse file, `people2-resources/morphs.bin` (per mesh
and key: the vertices that move, their move and normal change as half floats; 16.7 MB, against over 100 MB of dense
blend shapes), and the stored meshes carry none. At spawn `People2Faces.Bake` adds every slider's move to the
person's own copy of the near and far mesh, merges the chosen hair, beard and moustache pieces into it (one draw
per person) and sets the face picture's layer and `body_tone`. A person then costs what a body without sliders
costs, whatever the number of sliders: see "Cost" below.

### Skin and face pictures

30 face pictures (`face_types.CELLS`, 1024 px colour and lossless normal in the face layer): MakeHuman's head island
over the full square, the inside of the mouth, the eye sockets, the eye's picture and two hair swatches (strands, a
plait's weave). Their base is one of nine MakeHuman skins (young, middle-aged and old; light, dark and East Asian
skinned; men and women) moved into our layout; our painter adds the rest. Toward the seam under the jaw and the nape
the face's own paint fades into its plain skin; `bodyTone` (per picture, in `faceTypes.json cells`) is that plain
skin over the body picture's skin along the seam, so the body's skin (times `body_tone` in the shader) meets the face
without a step. The body pictures: MakeHuman's skin of the body's group, the hands' weather, the base bodies' worn
linen drawers and vest (by height, not by part: a part's edge is a staircase of triangles), a kind's own paint
(stockings, chapped hands) and, under a garment's neckline and wherever the kind's cover rule hides the skin, the
cloth worn under it or the garment's own colour (`clothes_kit.undershirt`), so a reduced neckline shows a shirt and a
slider's broader shoulders pushing skin through a tunic show cloth, not bare skin.

### Hair (`mhhair.py`)

- **Shells** (crop, side, long, bald fringe; a woman's drawn-back hair under the bun, plaits and coronet; the
  undercap; full, short, chin, chops and sideburn beards): MakeHuman's full head cut along the contour where the
  hair's thickness reaches 0.9 mm (a smooth hairline), every point laid out from the near copy's own skin by its
  thickness (the edge 0.5 mm under it, so hair grows out of the skin), lumps of locks inside but not at the edge,
  reduced to the style's budget (crop 640, side 720, long 780, women's 660, full beard 760; far copies about a
  quarter, cut from the far copy's head). Beards keep the lips bare with a margin and lie thin next to them.
- **Tubes** (bun, plaits, coronet, the three moustaches, the imperial), their triangles turned to face out.
- **Pictures.** Shells and tubes use the face picture's swatches: strands mirrored left and right (front 0, back 1:
  no seam down the back of the head), fine straight streaks, soft locks and a sheen; a plait's weave. Beards run
  down the face and on back under the jaw at the same density both ways (`beard_uv`: the scalp's elevation map
  squeezed the strands under the chin into streaks; triangles stretched more than 4:1 in a full beard 388 of 760
  before, 69 after); sideburns keep the scalp's map.
- **Under hats.** Men's caps and kepis sit 11 mm over the scalp (a crop of hair fits under), and a kind with a hat
  takes its hair from `KIND_HAIR` (crop for the men, the undercap for the women).

### Clothes on the MakeHuman bodies

The garments are built as before on the cage `C`, now fitted onto the MakeHuman surface (`fit_cage`: 1 to 15 mm). The
kinds keep their budgets (near 8,900 for the crowd, 11,500 for the named; far 2,100), so with MakeHuman's face the
clothes get about 3,000 to 4,000 near triangles. After the reduction `clothes_kit.clear_layers` puts every layer back
under the one over it (`layer_order`, read before the reduction: the bodice under the shawl, the trousers under the
smock) and the skin under every garment, by 2 mm, both ways. The body is cut away only where a garment really
covers it (`cut_body` with the garments: a ray out from the skin meets one within 30 cm, or the skin pokes through one;
the cover rules alone, drawn for the cage bodies, cut a see-through hole at the nape). The insides and the rims
(hems, cuffs, the edges of brims and collars) are unwrapped at their cloth's own density (they were at 0.3: the
owner's rule of 2026-10-13, small sides without stretched or blurred pictures).

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

### The character creator (proposal; nothing of it is built)

- **Sliders the player moves:** the `player: true` sliders of `peopleSliders.json` (all but `face_age`, which
  follows the chosen age), each within `playerRange`: the eyes' size, spacing and opening within -0.8..0.8, the body's
  shape sliders within -0.6..0.6 (the belly -0.6..0.8), the origin sliders 0..1, everything else -1..1. On
  MakeHuman's targets that range stays a plausible face and body of the period; no slider goes past its target. Then a face picture from the cells of the chosen sex, age and skin, a hair
  style, beard and moustache from the same lists the types use, and a build.
- **Stored** with the player's character in the game's database as one small JSON object (`{"v": 1, "base":
  "man_middling", "cell": "m_mid_brown", "hair": "crop", "beard": null, "moustache": "walrus", "sliders": {"nose_long":
  0.4, ...}}`, only non-zero sliders, values rounded to 1/100).
- **Sent** to other players where the network now sends a person's kind and stable id: the same object, validated on
  arrival (known names only, values clamped to `playerRange`), and baked by `People2Faces.Bake` like any other face.
  No change to the wire format now.

### Known limits (2026-10-13)

- Fists and grips: the clips' hand shapes (`clips_legacy.HANDS`, motion packages) were set for the cage hands; on
  MakeHuman's shorter proximal finger joints a fist overshoots and the fingertips come through the back of the
  hand. The relaxed and open hands are right. The angles belong to the motion packages.
- The kinds' clothes are coarse at a metre (3,000 to 4,000 triangles next to MakeHuman's face); raising the crowd's
  near budget would buy them back.
- Beard and hair edges still show small steps at 0.6 m; the far copies' hair is a coarse cap.
- The fishwife's crossed shawl shows the bodice between and through its reduced bands.
- Garment UVs: after the reduction about one triangle in five of the big garments (smock, tunic, coat) is stretched
  more than 4:1 in its picture (the collapse moves points after the unwrap). No streak shows at a metre in the close
  shots, but unwrapping and painting after the reduction would remove it (a clothes-package change: the far copy
  shares the near copy's picture layout).
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

First pass (2026-10-12): four kinds, one from each group, so the owner sees the new people before C goes wide:
`docker_a` (workers), `fishwife_a` (women), `police` (uniforms), `sooi` (the cast). Each is its own armature in
people2.glb, named after the kind, with `<kind>_lod0` and `<kind>_lod1`, on the same 64 bones and the same rest pose
as its base body (`kinds.<kind>.body`), so every clip of that body plays on it unchanged.

### How a kind is made (`dress.build`)

1. The base body is made again under the kind's name (`build_people2.make_body`), with the kind's hair style.
2. The face: one setting per kind, `Kind.face` (`type`, `seed`, `sex`, `age`, `look`), is turned into a face by
   `dress.face_of()`: today B's look by seed, the hair style and the face-shape mix by seed. The mix is baked into the
   near copy; the face-shape keys stay and add to it (a crowd of one kind can still vary). A face package changes
   `face_of` and the settings, nothing else. `kinds.<kind>.face` and `faceMix` in peopleRig.json.
3. The body's picture (A's skin through the position map, B's hands, the kind's `skin` extras: socks, stockings,
   red or grimy hands) and the face square (512 px, 1024 for the named cast).
4. The garments: `Kind.dress(fit)` returns `clothes_kit.Piece`s. They are joined into one cage, unwrapped, subdivided
   once (the near copy) and moved onto their limit surface (the far copy), as A's bodies are. Redundant tessellation
   is then collapsed on the rounded clothing surface within each kind's remaining triangle allowance. Near skin,
   face and hand topology and morphs stay intact; the clothing carries interpolated UVs and rig weights.
5. The body under the clothes is cut away (`Kind.covers(point, part)`): what nobody sees costs nothing and cannot
   poke through. Head, eyes and hair always stay.
6. The cloth picture is painted in 3D on the garments (below).
7. UVs go into the kind’s clothes layer and full-square face layer, the clothes are joined into the body's two meshes, hats are made to follow the face
   shapes of the head under them.

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

1. In its group file (`kinds_workers.py`, `kinds_women.py`, `kinds_uniform.py`, `kinds_cast.py`) write
   `<kind>_dress(fit)` from the kit's functions, the `Cloth` looks with their `extra` painters, and
   `<kind>_covers(point, part)`. Lay garments from the inside out: a piece laid on another (`Onto`) needs it made.
   Ease: each layer at least the one below plus its thickness plus 3 mm.
2. Add `Kind(name, group, body, face=dict(type, seed, sex, age, look), hair=dict(hair, beard, moustache), dress,
   covers, skin, hats, held, avoid, note)` to the file's `KINDS`.
3. Trials: `blender -b --factory-startup -P art-source/tools/blender/build_people2.py -- --only <body> --kinds <kind> --no-move
   --fast --dress --out .scratch/try.glb` (writes the json beside the trial glb, not into shared/; with
   `PEOPLE2_HEADCACHE=<file>` B's head is meshed once over many trials, `PEOPLE2_DRESS_SHOTS=studio,detail,clips` picks
   the pictures, `PEOPLE2_SAVE_BLEND=<file>` keeps the scene, `PEOPLE2_NO_SLIM=1` leaves out `glb_slim`). Look at
   `studio_`, `detail_`, `clips_<kind>.png`.
4. A full build with `--plain`, additive native intake and data preparation as described above.

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

### Period sources

Worker expansion (`kinds_workers2.py`, `garments_workers.py`, `held_workers.py`):
- [War Heritage Institute, Belgian blue smock, 1825–1830](https://warheritage.be/en/belgian-smock-combat-outfit-civilian-guard-volunteer): surviving loose knee-length linen cut and buttons. Earlier than 1873; used for construction, not an exact natie uniform.
- [John Thomson, *Street Life in London*, 1877–1878, Rijksmuseum](https://www.rijksmuseum.nl/en/collection/object/Street-Life-in-London--d9eb89414ebab5cb4d04bb118b9deb8f) and [National Portrait Gallery, *The Temperance Sweep*, 1877](https://www.npg.org.uk/collections/interactives/room-21-street-life-london): worn street coats, caps and sweep equipment. Nearby period comparison; London is not evidence of an Antwerp trade regulation.
- The original kind palettes and the Antwerp sources below determine the dockers' kiel and shoulder pad. The coalman's cut-sack hood, porter's brass cap badge, grinder's leather apron and baker boy's flour distribution are reconstruction choices; no exact Antwerp 1873 pattern is claimed.

These twelve workers use 14,000 near / 2,500 far triangle ceilings. Garments are reduced and cleared of overlapping layers before their final unwrap and paint; each far face projects inside a painted near triangle of its garment, and both copies contribute coverage to the shared picture. Near hems, cuffs, collars, brims and soles keep the outside's texel density. Hands are excluded from body cutting. Shirt panels wholly hidden under a waistcoat are omitted; this prevents coarse FAR faces cutting through the waistcoat. Thin stitched cloth lips and hidden mating surfaces are edge exceptions; hat brims, boots and leather pads use rounded geometry.
The sack uses `work.loads.sack`; the handcart uses `PushCart` and the existing `props:tr_handcart`. The existing `quaygoods:sack_truck_bare` still needs a native two-grip attachment for the new porter: `People2Things.Has` does not support trucks. No second sack, truck or handcart is authored in a worker mesh. The chimney rods, brush and rope coil form one back-socket model shared by both sweeps.

The look follows public photographs, paintings and sculpture of Antwerp's working people of the 1860s-1880s:
- *Antwerpen: de oudste foto's 1847-1880* (1999) and *Antwerpen gefotografeerd in de 19de eeuw*
  (1976): dockers' long blue smocks, cloth caps and wooden clogs; fishwives' white caps, shawls and aprons;
- period paintings and the later *Le Débardeur* sculpture: the smock, cap and leather shoulder protection;
- the ModeMuseum Antwerpen kepi with a Belgian cockade (1870-1910, Europeana);
- identities from `art-source/tools/blender/build_people.py` and the original fictional personas.
The police tunic's exact cut, button metal, collar facing and docker's shoulder pad shape remain assumptions.

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

## Known limits

- The motion treats the back of the sole as a round heel (`motion.HEEL_R`). If anyone moves the sole or adds a heel
  (shoes, boots), the foot points come from the mesh at build time, so the clips follow; rebuild and read the slide
  and scuff measures (a longer toe catches the stairs: the toe end stays at 0.195 m from the ankle's line).
- Bare feet have no separate toes in the mesh (ten columns round the foot): the toes are a rounded arc in shape and
  are drawn in the paint.
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
