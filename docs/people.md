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
(stockings, chapped hands) and, under a garment's neckline and wherever the kind's cover rule hides the skin, the
cloth worn under it or the garment's own colour (`clothes_kit.undershirt`), so a reduced neckline shows a shirt and a
slider's broader shoulders pushing skin through a tunic show cloth, not bare skin.

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
- **Under hats:** the hats are fitted to the bare skin with a margin (caps and kepi 11 mm, the women's cap 9 mm), so
  `KIND_HAIR` gives docker_a `capped` (or `bald`), police and Sooi `capped`, the capped women `undercap`. The hats'
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
