# People, animals and street models in high detail; fighting (plan, 2026-10-11)

Project direction, 2026-10-11: "also make the humans, animals and other models more detailed and better textures + movements more
natural. horses were already ok". Later the same day: "create fighting animations, make them nice, smooth, high
quality. We will add fighting to the game. Boxing, stabbing, using objects like planks, swords, police batons. We
should also be able to buy or steal weapons."

This is the original scope plan, retained for future art packages. The active runtime is now native Godot.
People2 authoring lives in `art-source/tools/blender/people2`; the opt-in port, current commands and measured
acceptance are in `docs/godot-people2.md`. Browser-only packages, budget columns and client/server/shared TypeScript source citations are historical.
Active authoring uses art-source; gameplay and its protocol use native Godot/C#.
Other art work remains outside this port.

Rules for every package: `docs/05-art-direction.md` (high detail, no PS1 look, linear mipmapped textures, no deliberate
low poly), `docs/performance.md` and the `frame-budget` skill, `docs/rendering.md` (fixed lights, few shader kinds,
build before you show, bumps from the surface's own picture), `native-godot/README.md`, `docs/sacks.md` (one sack model),
CLAUDE.md (one model per thing changed everywhere, paths, changelog line, issues for side finds, no secrets, the web
native content identity and bounded game checks).

---

## 1. What is there today

### 1.1 People (both games share one file)

| Thing | Today | Where |
|---|---|---|
| File | `art-source/client/public/models/people.glb`, 2.8 MB, 51 kinds, one skinned mesh and one material per kind | `art-source/tools/blender/build_people.py` (2,954 lines) |
| Bodies | Two bases (man, woman); children are the same body scaled with a bigger head; age is only paint. Lofted rings: torso 10 sides, limbs 6, head 12 with a few pushed vertices for nose, brow, ears | `build_people.py:105-106, 362-429, 534-568` |
| Triangles | 742 (girl_b) to 1,064 (sweep), mean about 900 per person, everything included (body, clothes, hat, props) | measured from the glb |
| Weights | Every part bound 100% to one bone ("rigidly bound"): elbows, knees, shoulders and hips crease like a doll's joints | `build_people.py:338-343` |
| Shading | Flat shaded (`use_smooth = False`) | `:1722` |
| Faces | Painted: eyes are one row of pixels, brows, a mouth row, facial hair | `paint()`, `:1044-1118` |
| Hands | Mittens: a 4-sided loft and a thumb wedge, no fingers | `:618-624` |
| Hair | Painted on the head only (townspeople); Jef has hair meshes (bun, plaits, coronet, long) | `:1119-1129`, `build_player.py:213-236` |
| Hats | flatcap, knitcap, tophat, bowler, bonnet, kerchief, kepi, shako, wide (priest), souwester, whitecap, veil | `:704-801` |
| Clothes | Lofted single-sided shells (jacket, smock, coat tails, skirt, apron, shawl); long aprons cannot sit (thighs show through) | `clothes()`, `:653+`; `humans.ts:55-56` |
| Props | Lofted into the body on bones: pipe, ledger, book, cane, sabre, pompom, bayonet, rifle, logbook, basket, brushes, sack truck, handcart. The shoulder sack is the shared sack model on a socket | `:803-896`, `people_sockets.json` |
| Textures | One 128 x 128 picture per kind, an atlas of fixed cells (head 64 x 32 ...), painted in numpy. Browser: NearestFilter, no mipmaps (`humans.ts:108-117`): the blocky pixels the art direction now forbids | `TEX = 128`, `:69-86` |
| Skeleton | 16 bones, the same names and roll 0 in every kind: hips, spine, neck, head, armUp/armLow/hand L R, legUp/legLow/foot L R. No clavicles, no fingers, no toes, one spine bone | `:90-92, 504-508` |
| Clips | 36, keyed in Blender from pose functions on the first character (rotations only, a key every 2 or 4 frames at 24 fps): idle, walk, talk, fold, carry; idle_f, walk_f, talk_f; sit, walk_sack, idle_sack, push, push_idle, behind, lean; rifle_idle, rifle_walk, rifle_talk, write; ride, row; scrub, lace, cross, point, beg, call, crouch, hop, rope, grind, pull; wash, wall, pockets, smoke. No run, no hurry, no stroll, no turn, no start or stop, no stairs | `CLIPS`, `:2413-2489` |
| Kinds (51) | Named cast 9 (sooi, peeters, tuur, fientje, sailor, stranger, thief, foreman, recipient); crowd 15 (docker_a/b/c, docker_sack, porter, fishwife_a/b, maid, boy, girl, gentleman, priest, police, carter, sailor_b); town 12 (baker, shopkeeper, publican, clerk, old_man, beggar, wife_a/b, shopwife, old_woman, urchin, girl_b); garrison 4 (soldier, soldier_b, sentry, customs); lively 11 (milk_woman, baker_boy, grinder, ragman, coalman, sweep, sweep_boy, nun, beguine, tourist, tourist_lady). No emigrant kinds (`emigrants.ts:673` reuses others) | `PEOPLE`, `:108-314`; `humans.ts:16-28` |
| Jef | `player.glb`: 10 clothing cuts on the same kit and skeleton, separate hats and hair, painted per profile into a 128 px canvas (`player/look.ts`). First person shows only the right forearm and hand cut from the skinned mesh, in a fixed pose ("give" or "lantern") moved by code sway; the body draws for mirrors and the lantern shadow | `build_player.py`, `player/look.ts:307-385`, `game/hands.ts`, `game/lantern.ts`, `player/body.ts` |

**Browser playback** (`client/src/game/humans.ts`, 336 lines): each figure is a `SkeletonUtils.clone` with its own
`AnimationMixer`; `play()` crossfades 0.3 s; `setPace` scales the walk to a 1.2 m stride; hip bob and the kneel, crouch,
sit and hop lifts are code. Head turn toward Jef only in `backlife.ts:1272-1293`; a wave in `emigrants.ts:761`. No
general look-at, no foot IK, no breathing, no secondary motion. `frustumCulled = false` on the meshes; the crowd hides
figures past the fog + 4 m and out of view. Animation rate: every frame under 25 m, 15 fps to 45 m, 8 fps beyond
(`crowd.ts:270-271, 1011-1018`).

**Godot playback** (`godot/src/People/Human.cs`, 285 lines): people.glb read once (`ModelLibrary.Get("people")`), each
person a `Duplicate()` with its own `Skeleton3D` and `AnimationPlayer` (manual `Advance`), meshes, skins and materials
shared. Rotation tracks only, crossfade 0.3-0.5 s, a motion with no clip falls back to idle (`:190`). Shadows off; the
blob under the feet is `World/BlobFeet.cs`. Material: the psx ShaderMaterial (`ModelLibrary.cs:90-121`). Bone rates:
120 Hz under 8 m, 60 under 25 m, 15 under 45 m, then 8 (`Crowd.cs:271, 352-360`). Two-bone arm IK exists for event
leads (`Game/LeadLooks.cs:93-136`). No LOD, `VisibilityRange`, `AnimationTree` or MultiMesh for people anywhere. Jef has
no body, arms or hands in Godot at all (`Player/Jef.cs:133-153`: a capsule, the baked figure hidden).

**Counts.** 895-909 residents (the population setting; the old "about 190" is out of date). At most 50 drawn near the
camera (`MAX_PUPPETS`, Settings 20/50/75/100 in the browser; events raise it to 100 in Godot, `Game/Actors.cs:79`),
spawned at 55 m, let go at 68 m; the browser's nameless crowd adds up to 32 within 70 m. Indoors 10 per house (28
total), halls 2-7 each, the prison ring 10, posted people (the cast and the employers), market and street-life figures.
A busy view has 12 people in view and 50 drawn (`baked/people/peopletest.json`).

**Bone names are used in code** (keep them): `crowd.ts`, `backlife.ts`, `emigrants.ts`, `lively.ts`, `parkWork.ts`,
`people.ts`, `shopProps.ts`, `wardrobe.ts`, `world/traffic.ts`; Godot `Human.cs`, `Game/LeadLooks.cs`,
`Movers/StreetRig.cs`, `Play/Emigrants.cs`. The motion list is on the wire: `godot/src/Net/Mp/MpProtocol.cs`
(one byte) and `Human.cs Humans.Motions`, `MP_PROTOCOL = 5`.

**What looks wrong** (the survey, item 26: "a posed mannequin"; `baked/people/*.png`; the code):
1. Rigid binding and flat shading: limbs are tubes that break at the joints; at 3-6 m (talking range) a figure reads as
   a wooden doll.
2. 900 triangles and 6-sided limbs: square arms and legs, no shoulders, no neck shape, no buttocks, no calves; skirts
   are cones.
3. 128 px pictures with nearest filtering: faces are pixel rows; at talking range a face is a smudge with a line.
4. Mittens. Every handed thing (a rope, a sack, a cart handle, a coin, a weapon) looks wrong in a mitten.
5. Motion: one walk for everyone (women's walk_f apart), no weight shift, no pelvis turn, no counter-swing of the chest,
   no heel-toe roll, no toes; the hip bob is a code cosine, the same for all. Idles are near still. Turns are the whole
   body yawing on the spot. No run (people "run home" in the storm with the walk clip sped up). No start, stop, stairs or
   slope. Feet slide when the pace scale does not match. Heads never follow anything (except a few backlife figures).
6. No secondary motion: skirts, coat tails, aprons and shawls are stiff shells.
7. 15 women's kinds and long aprons cannot sit; indoor figures stand (Godot `Indoors.cs:17-19`).

### 1.2 Animals

| Kind | Model | Rig and motion | Count | Godot |
|---|---|---|---|---|
| **Horse** (the bar) | `build_props.py:1173-1848` `horse()`, props.glb: Brabant at true size, 16-sided rings, real anatomy, full harness; 5,678 triangles; its own 4 x 4 atlas of 64 px cells (`goods_team`); coats by moving atlas cells | No bones: nine rigid parts (body, eight leg pieces), procedural two-bone IK per leg (`world/horseGait.ts`): planted hooves (0.000 m slide), heel-to-toe roll, four-beat walk, diagonal trot, smoothed body wave, 0.5 s walk-trot ease; about 2 us per horse. Head, neck, ears and tail do not move | trains 2+2, omnibus pairs, hearse 2, fire pump 2, drays, led drays | `Movers/Horses.cs`, line for line |
| Dog (9 kinds on 4 breeds) | `build_animals.py` with its kit `animals/` (art3, 2026-10-13; round 2 the same day): bodies as distance fields at true size (mongrel 0.50 m, Belgian draught dog 0.64 m, Schipperke 0.32 m, terrier 0.38 m), the trunk, neck and head as lofts (top line, under line, widths) with the muscles and bony points laid on; drop, button and prick ears lying on the skull, eyes in sockets, nose with nostrils; 7,900-8,900 triangles near and 1,150 far; 1024 px pictures (imported BPTC colour, RGTC normals) with the full field baked into the normal picture; long-coat tufts in the outline (Schipperke ruff, terrier beard and brows); the draught dog's harness as skinned geometry and the trace as its own model | 47 bones (half-angle helpers at the big joints), smooth weights; clips per breed: walk, trot, run (rotary gallop) with planted paws, idle, sit (haunches folded, hocks down), lie (sphinx), sleep curled, sniff, scratch, shake, bark, beg | doorsteps (strays: mongrels, terriers, Schipperkes), dogs at heel, the draught dog in the milk and bread carts' shafts (tugs round the shaft ends, traces to the shaft hooks) | `People/Animal.cs` (runtime, pool), `Animals*.cs`, `StreetTrades.cs` |
| Cat (6 coats) | same kit: the alley cat, 0.25 m at the shoulder, about 6,500 triangles near | the same rig; walk, trot, run, idle, sit, lie (loaf), sleep curled, sniff, stretch, groom | ~45% of doorsteps, 2 park cats; `clutter.glb` still has 3 static cats (162 tris) | `Animal.cs`, `Animals.cs` |
| Pig (2) | same kit: the Kempen pig, 0.72 m at the back, about 9,000 triangles near: skin folds round the neck, the snout and the joints, pores, a crest of bristles, dried mud | the same rig; walk, trot, run (canter), idle, sit, lie, sleep, sniff (rooting), grunt nod, wallow | the dawn drove (`shared/drove.ts`): not ported to Godot, so not in the game yet | drove not ported |
| Hen | `build_lively.py:662-714`, lively.glb: rigid lathe and box parts (body 50, head 48, leg 24 tris) | code: head peck, legs swing as a sine, flee at 2 m (`lively.ts:2142-2216`) | up to 6 courts x 3 | none |
| Goat | same (body 92, head 96, leg 24 tris) | code: diagonal leg swing, graze (`lively.ts:2219-2268`), tethered | up to 2 | none |
| Ducks, swans, geese, squirrels, songbirds | `build_park_animals.py`: 10 x 6 UV-sphere ellipsoids, vertex colour, no texture, no bones; 700-1,376 triangles each; 4 wing meshes | code: swim bob, peck tilt, wing sine in flight (`world/parkWildlife.ts`), instanced, 90 m | 43 ducks, 9 swans, 6 geese, 10 squirrels, 6 songbirds | `People/ParkWildlife.cs`, MultiMesh, same math |
| Pigeons (squares, lofts), jackdaws, sparrows, crows | code geometry, wing beat in the shader (`world/ambient.ts:339`, `alive/lofts.ts`, `alive/jackdaws.ts`, `alive/sparrows.ts`, `wallLife.ts`) | procedural | pigeons share 72 slots with the gulls; lofts 16-24; jackdaws 26; sparrows 3 flocks; crows 12 | sound only, or none |
| Rats | the dead-rat litter model (`build_litter.py:1138`, 107 tris) stood upright, slid along wall feet with a bob, no legs (`world/litter.ts:1446, 1619`) | code | 8 | none |
| Bats, cats' eyes | `alive/night.ts` | code | 6, 6 pairs | `World/Bats.cs`, `NightLife.cs` |
| Gulls | another helper | | | |
| Cows | none: there is no cattle drove or cow in the game | | | |

Recorded faults: the brown dog "read as an otter", the first pig "as a tapir" (fixed); horses open: two lobes on the
chest from low in front, the roan too pink in dull light, no traces on shaft horses, the farrier's horse (`build_trades.py
tr_horse`, 356 tris, trades.glb) still the old simple one (`docs/milestones/vehicle-detail.md:131-134`).

**What sets the horse apart** (the bar for the rest): anatomy in 16-sided rings at true size; parts that bend at real
joints; feet that never slide (IK on the ground); a body that rides a smooth wave from the legs; gait timings from life.
Its textures are small (64 px cells), so the bar for pictures is set by the art direction, not by the horse.

### 1.3 Other street-level models

The worst 15 by (how often seen up close) x (how crude), with files and owners, are in "Street models: the worst 15"
after the packages. In short: the interiors' furniture, the benches, the shop-front spills, the market barrows and
stall goods, door leaves, signboards and awnings are box-and-beam work with 16-64 px cells painted for nearest-pixel
filtering (`interpolation = "Closest"`, e.g. `build_clutter.py:257`), which now smears under the smooth mipmapped
filtering of commit aacd8d5. Counted from the glbs: clutter.glb 3,591 triangles for 55 meshes (bench 84, baskets 61,
barrel 102), trades.glb 7,125 for 26, lively.glb 9,607 for 46, stalls.glb 19,838 for 59; against the horse's 5,678
alone.

---

## 2. The frame budget for people

### 2.1 Where the time goes today

- **Browser** (`data/perf/2026-10-11T16-51-48-610Z.json`, RTX 5090, ANGLE D3D11, budget 20 ms at 720 lines): live mean
  18.8 (cathedral) to 23.1 ms (Vismarkt), over the budget at four of five places. Draw calls 1,254-1,750. `crowd.update`
  0.6-0.8 ms and `town.update` 0.6-0.7 ms are in the top four. The GPU waits; the cost is three.js's work per draw on
  one CPU core (~2 us a draw, 4-5 us more per material switch). **So the browser has no room for more draws, more
  materials or more passes for people. Triangles are nearly free** (the card idles), bones are cheap if few people
  update them each frame.
- **Godot** (`baked/people/peopletest.json`): frame 1.9-2.2 ms at the two squares; people cost 0.22-0.42 ms there,
  0.8-1.1 ms in the README's runs. 50 drawn, 12 in view, ~1,015 draw calls. The `--peopletest` gate fails at 1.5 ms
  for people and animals. **Godot has room**: frame time is about 4.5-8 ms at the five places against 16.7.

### 2.2 What a person costs now and after

| | Browser now | Browser after | Godot now | Godot after |
|---|---|---|---|---|
| Draws per person per pass | 1 (one mesh, one material) | 1 (keep: body, clothes, hat and hair in one skinned mesh; hair cards only on the LOD0 of named people if they need alpha, then 2) | 1 | 1-2 |
| Passes that draw people | main, puddle mirror (50 m), river mirror (every 2nd frame), lantern shadow at night | the same; LOD1 in mirrors and the shadow | main only (shadows off) | main; shadows stay off (the blob) |
| Materials | 51 (one per kind) | **1 to 3 shared** (one atlas for all kinds, see 2.3): fewer switches than today, so the people pass gets cheaper | 51 | 1-3 |
| Triangles | ~900 | LOD0 6,000-9,000 (named people up to 12,000), LOD1 ~2,000 past 15 m | ~900 | same as browser |
| Bones | 16 | 50-60 (see 3, package A) | 16 | same |
| Bone work | mixer per person, rate by distance | the same rate rule; additive layers and IK only under 15 m | AnimationPlayer per person, 120 Hz under 8 m | AnimationTree per person under 25 m; modifiers (look-at, feet, springs) under 15 m |

Rough sums (to be measured, section 2.4): 50 people x 60 bones = 3,000 bone matrices a frame, under 0.1 ms on one core
in either engine; three.js's mixer with ~120 tracks a person at full rate for the ~12 under 25 m and lower rates past
that: ~0.3-0.5 ms (today's crowd.update is 0.6-0.8 ms for everything); 50 x 9,000 skinned triangles = 450k a frame, small
for the card. Godot skins on the GPU (a compute pass per skinned instance): 50 x ~5,000 vertices is nothing for an RTX
5090; on a weak laptop card LOD1 past 15 m keeps it down.

### 2.3 The technique (recommended)

1. **One shared skeleton layout** (a superset of today's 16 names, roll 0, same rest rotations in every kind), so one
   clip set drives all kinds, as now. Bone names follow the existing style; a `BoneMap` to Godot's
   `SkeletonProfileHumanoid` (exists in 4.7.2) is written once so licensed motion data could be retargeted later.
2. **Skinned meshes with smooth weights** (no more rigid parts), smooth shading with hard edges only where cloth folds.
3. **LODs with far copies, same draw count:** LOD0 under 15 m, LOD1 (about a quarter) from 15 m and in the mirrors and
   the lantern shadow. Browser: two meshes on one skeleton, one visible (no `THREE.LOD`: it would pick per camera and
   double the walk). Godot: `GeometryInstance3D.visibility_range_*` on two MeshInstance3D under one Skeleton3D, or the
   importer's own mesh LODs (automatic, per surface: try first, it costs nothing).
4. **One texture atlas for every kind** (a 4096 x 4096 colour atlas of 512 x 512 cells, plus a normal atlas and a
   small tiled cloth-detail texture shared by all): one material for all people, linear and mipmapped, with padding
   between cells against bleeding. Godot imports it VRAM-compressed; the browser loads it as KTX2 (BasisU) if three's
   loader is already in the client, else a 2048 atlas of 256 cells for LOD1 and the 4096 one for LOD0. A second
   material only for things that must differ (hair cards with alpha test; never alpha blend).
5. **No vertex animation textures or instanced skinning now.** At 50 drawn (100 at the most) the draw count is fine in
   Godot and is the same as today in the browser. VAT and instancing pay off for hundreds of far figures; the fog (25-40
   m) hides them anyway. Keep it as the next step if the population setting ever draws past 100 (section 4, package
   P-later).
6. **Hero quality for the named people** (the cast of 9, the employers on the board, the police agent who comes to Jef,
   a lead in an event): their own LOD0 with more face and hand detail (up to 12,000 triangles, a 1024 face cell).
7. **Motion = authored clips + procedural layers.** Authored in Blender from Python (as today, but with IK baked to FK,
   proper curves and the mechanics of 2.5); played with blends by speed; on top, cheap code layers near the camera:
   head and eye look-at, foot planting on slopes and stairs, breathing and weight shift as additive layers, cloth springs
   on skirts and coat tails.

### 2.4 How to measure

`pwsh -File native-godot/scripts/check-people2.ps1` runs isolated native proofs under `.scratch`.
The direct `Human.Update` mean and `Townspeople.LogicMs` mean must each stay below 1.5 ms; layers
are a subset of animation time. Whole-frame subtraction is diagnostic. Timing rejects other Godot
processes before and during sampling. The shader audit permits exactly one people2 kind and zero
late kinds or light-count changes. Capture all four dressed kinds at 1 m and 3 m at 13:00 clear,
13:00 rain and 19:30 beside existing lamps. Preserve raw reports and inspect the images.

---

## 3. Work packages

Order: **A** first (the rig and the body base: everything depends on it). Then **B, C1-C4, D1-D3** in parallel (each
owns new files of its own). **E** (browser runtime) and **F** (Godot runtime) start with A's first glb and grow with
the clips. **G** (Jef) after A and E/F's first cut. **H** (animals) and **I1-I6** (street models) are independent of A
and can start at once. **J** (fight motion), **K** (weapons) after A and D1; **L** (the fight system) is an outline,
not to be built now.

Every package uses its own worktree and isolated proof data. This port uses ports 8890-8899, commits by path after `tools/commit-check.ps1`, and does not push or merge. Add a changelog entry only for changes players see; people2 remains off by default.

**Licence rule for all.** Bodies, faces, clothes, textures and clips are made by us in Blender or code, or adapted
from CC0 and public-domain assets under `docs/cc0-assets.md` (owner, 2026-10-13: check the licence on the item's own
page, check it is useful, adapt it to the period, detail and budget, keep the originals in
`art-source/third_party/<source>/`, a row in `assets/ATTRIBUTION.md`). The owner approved MakeHuman's CC0 core assets
(base mesh, targets, rig weights, skins, eyes, brows, lashes) for people2 on 2026-10-13, with MPFB 2 (GPL code, never in
the repo or the game) as the authoring tool: `docs/makehuman.md`. Rigify (bundled with Blender) may be used to author;
what it generates is our own output. No model packs with other licences, no MakeHuman community uploads (their own
licences), no Mixamo (Adobe's terms forbid passing the raw data on, and this repo and its
releases are public), no motion capture unless it has a clear licence, is noted in `assets/ATTRIBUTION.md`, and the project owner
said yes first. The CMU Graphics Lab motion capture database (free for any use, not for resale as data) is the one
library worth asking the project owner about, for walks and boxing; it would need retargeting through the BoneMap and a cleanup
pass. Image models for texture tiles: as in `docs/learnings-for-next-game.md` (our prompt, record prompt, date, model and
SHA-256), and only with the project owner's existing OK for textures.

### A. The rig and the body base (blocking, one helper)

- **Goal.** A new people kit: a 50-60 bone skeleton and four smooth, weighted base bodies (man, woman, child, old) at
  6,000-9,000 triangles, with a LOD1 at ~2,000. The 16 old bone names stay, with the same rest directions, so the 36 old
  clips play on the new bodies on day one (new bones at rest).
- **Skeleton.** hips; spine, chest, upperChest (spine stays the name of the first); neck, head, jaw; clavicleL/R;
  armUp, armLow, hand (old names) plus forearm twist; fingers in groups that read well and stay cheap: thumb (3), index
  (3), middle (3), ring and little curled together (3 each, or one "fist" pair of bones per hand driven as one); legUp,
  legLow, foot (old) plus toe; two skirt bones front and back and two at the sides (only weighted on skirted kinds),
  coatTail L/R; sockets as bones: `gripR`, `gripL` (weapon and tool hold, palm frame), `hipL` (scabbard), `back` (a
  slung load), `headTop` (hat). Write the list and the BoneMap to `art-source/shared/peopleRig.json`.
- **Bodies.** Quad topology made in Python with real edge loops at shoulders, elbows, wrists, hips, knees and ankles
  (three loops a joint), subdivided once and shaped by measured 19th-century proportions (Quetelet measured Belgians;
  the helper checks the figures: roughly 1.65-1.68 m for men and 1.55-1.58 m for women). Smooth weights from Blender's automatic weights, then fixed by rule at the
  joints (no candy-wrapper wrists: the twist bone). Builds as shape keys baked to separate meshes per kind: slight,
  middling, stout; stooped for the old.
- **Files (owner).** New `art-source/tools/blender/people2/` (`rig.py`, `body.py`, `weights.py`, `lod.py`, `export.py`,
  `__init__.py`), `art-source/tools/blender/build_people2.py` (the entry, `--preview`, `--cast`), output
  `art-source/client/public/models/people2.glb` (a new file: people.glb stays untouched until E and F switch), `art-source/shared/peopleRig.json`,
  a new `docs/people.md` (how the kit works, like `docs/sacks.md`).
- **Verify.** Blender renders front, side, back and a turntable at 3 m and 10 m in the game's fog (`--cast`, like today's
  `crowd_cast.png`); every old clip played on the new bodies (a contact sheet), knees and elbows bent 120 degrees without
  collapse; triangle and bone counts printed; `pwsh -File native-godot/scripts/check-people2.ps1` for the file.
- **Risks.** Changing rest directions breaks every clip and code grip (keep roll 0 and the old axes). Sockets in the
  wrong frame put held things beside the hand again (`learnings` "held things go on the hand bones"): test each socket
  with a stick. Keep the compressed art master and a temporary plain GLB for native intake.
- **Frame budget.** Nothing in the game yet. **Godot:** additive native scene intake from Blender's `--plain` output.

### B. Faces, hands, hair (after A's topology)

- **Goal.** Faces that hold up at 2 m: modelled eyelids, eye sockets, nose, lips, ears, cheekbones, chin; eyes as small
  separate spheres (they can look); a face painter at 512 px (1024 for the named) with skin tone, stubble, wrinkles by
  age, ruddy drinkers' noses, pox scars; normal maps from the same height. A set of 12-16 face shapes mixed per person by
  seed (shape keys baked), so the crowd does not repeat. Five-fingered hands with nails and knuckles, hard-working hands
  for the dockers. Hair as shaped meshes (men's short, side parting, bald, long; women's bun, plaits, coronet under caps),
  beards and the period's moustaches, mutton chops, sideburns; alpha-tested cards only on the hero LOD0.
- **Files (owner).** `art-source/tools/blender/people2/head.py`, `face_paint.py`, `hands.py`, `hair.py`; `tools/textures/people/`
  (painters, if they are big enough to deserve their own scripts). No game code.
- **Verify.** Close renders at 1 m, 2 m and 5 m under a gas lamp colour and daylight; a sheet of 40 seeded faces (no two
  alike at 5 m); hands closed round a 4 cm handle and a 2 cm rope without passing through.
- **Risks.** The uncanny: keep faces plain, weathered, a little stylised; never glossy skin. Eye whites too bright in
  the fog (dim them). Hair cards cost a second material: only for the heroes.

### C. Clothes and the kinds (after A; four helpers in parallel, each owns its kinds)

- **Goal.** Every kind rebuilt in period dress of 1873 with real cloth thickness (no open shells: a skirt has an inside
  and a hem, aprons sit), folds in the normal map, seams, buttons, patches and wear, mud at the hems, tar and coal dust
  where they work. Clothes are skinned to the same skeleton; skirts and coat tails to their own bones.
- **The split.** `art-source/tools/blender/people2/kinds_*.py`, each a list of kinds and its clothes functions; shared cloth
  functions in `clothes_kit.py` (owned by C1, the others ask for changes through the coordinator).
  - **C1 workers** (`clothes_kit.py`, `kinds_workers.py`): docker_a/b/c, docker_sack, porter, carter, coalman, sweep,
    sweep_boy, grinder, ragman, baker_boy, beggar. The docker's blue kiel (smock), the natie's cap, clogs and leather
    shoulder pad; the coalman's sack hood.
  - **C2 women** (`kinds_women.py`): fishwife_a/b (shawl, white cap, striped skirt, basket), maid, wife_a/b, shopwife,
    old_woman, milk_woman, girl, girl_b, nun, beguine (the Antwerp beguines' black and white), tourist_lady (a bustle
    dress of 1873).
  - **C3 uniforms, cloth and gentry** (`kinds_uniform.py`): police (the Antwerp agent's dark tunic, kepi, belt, sabre on
    the `hipL` socket, a truncheon), soldier, soldier_b, sentry (the line infantry of 1873, shako with pompom), customs,
    priest (cassock and the wide hat), gentleman (frock coat, top hat, cane), clerk, tourist, shopkeeper, publican,
    baker (aprons that can sit).
  - **C4 the cast and new kinds** (`kinds_cast.py`): sooi, peeters, tuur, fientje, sailor, sailor_b, stranger, thief,
    foreman, recipient, boy, urchin, old_man; **new** emigrant kinds (a Kempen farmer in his Sunday smock with a bundle,
    his wife in a hooded cloak, two children, a German family; the Red Star Line began in 1873), a dock labourer's wife,
    a cattle drover (for H), a cutler and a smith (for K).
  - Props that today are lofted into bodies (pipe, ledger, cane, sabre, rifle, basket, brushes, sack truck, handcart)
    become separate models on sockets, made by the owner of the kind and placed in `art-source/tools/blender/people2/held.py`
    (owned by C3; the others add their own item functions in their own `kinds_*.py` and register them).
- **Files (output).** All C helpers write into `people2.glb` through A's exporter; the build runs every `kinds_*.py`.
  To avoid four helpers rebuilding one file at once, each writes its kinds to `art-source/client/public/models/people2_<group>.glb`
  while working; A's exporter joins them at the end (or the game reads the four files: decide in A, see 5, question 1).
- **Verify.** Cast sheets front, back and side, in fog at 10 m (`--cast`); the old clips on each kind (sit, lean, push,
  crouch) without cloth passing through the legs; the period check against pictures of 1870s Antwerp (the helper names
  its sources: museum photographs, period paintings, police and army regulations).
- **Risks.** One model per thing: the shoulder sack stays the sack model on its socket (`docs/sacks.md`,
  `people_sockets.json` moves to the new socket). The sack truck and the handcart the porter and the carter push are the
  same models as on the quay (`props.glb handcart`, `quaygoods.glb`): no second build of them inside the person.

### D. Motion (after A's rig; three helpers in parallel)

Motion tools for all three, owned by D1: `art-source/tools/blender/people2/motion.py` (Blender IK rigs on the export skeleton,
foot and hand targets, bake to FK rotation keys, curve tools: ease, overshoot, follow-through, offset of chained bones,
loop seam checks, foot-slide measure). The mechanics every clip follows:
- weight: the pelvis drops at contact and rises at passing; the body leads with the chest in a hurry and the belly in a
  stout man; the old shuffle; a child bounces;
- opposition: the pelvis turns and tilts, the chest turns against it, arms swing from the shoulder with the elbow lagging;
- feet: heel strike, flat, heel off, toe off; no slide (measured, as the horse: 0.000 m in stance);
- the head stays level and leads turns; breathing in every idle;
- no two people the same: a per-person phase, speed and amplitude (code), and two or three variants of the common clips.

- **D1 locomotion** (`motion.py`, `clips_move.py`): walk (man, woman in skirt, old, child, stout, laden) as a blend set by
  speed: stroll 0.9, walk 1.35, hurry 1.9 m/s, run 3.5, sprint 5.5; start, stop, turn on the spot (90 and 180 degrees
  with stepping feet), stairs up and down, a slope lean; walk_sack, carry, push and pull (cart and sack truck) on the new
  rig with hand targets on the handles.
- **D2 idles and talk** (`clips_idle.py`): four idles per sex with weight shifts, shifting feet, a look round, a scratch,
  hands in pockets, arms folded, hands behind; talk with three gesture sets (calm, eager, cross), listening nods, a
  laugh, a shrug, pointing the way; sit variants (bench, crate, chair, step) for all kinds, including women and aprons.
- **D3 work** (`clips_work.py`): the 36 old clips re-authored on the new rig with the mechanics above (scrub, lace, rope,
  grind, wash, row, ride, rifle_*, write, beg, call, smoke, wall, pockets, cross, point, crouch, hop, lean, behind,
  pull), plus the work players watch most: lifting a sack from a pile to the shoulder and down, two men passing a sack,
  rolling a cask, hauling a rope hand over hand, a fishwife gutting, sweeping, a crane crank.
- **Output.** Clips go into `people2.glb` (one shared set, as now). New animation names stay internal to people2 in this port; `Humans.Motions` and the native multiplayer wire list remain unchanged. Future protocol extensions need a separate coordinated version change.
- **Verify.** Contact sheets and a turntable video from Blender (`--poses`); the foot-slide measure printed per clip (0
  in stance); the blend set walked from stroll to run in one render without a hitch; in the game: `__scheldemist.t.meet`
  and `shot` at 3 m of each clip; Godot `--parade` (one row per clip).
- **Risks.** Too much motion reads as fidgeting: idles stay calm. Clips that do not loop clean pop at the seam (the loop
  check). Speed blends that do not share a foot phase slide (author all locomotion with the same phase: left heel at 0).

### E. The browser runtime (retired)

The browser runtime and its decoder/build tooling were retired. New work targets native Godot.

### F. The native Godot runtime (opt-in port complete)

`godot/src/People/People2*.cs`, `Human2.cs` and `HumanLayers.cs` use the native scene callback before
ordinary model material conversion. Source normals, dense morphs, clips and skeletons survive intake.
The shared material uses `native-godot/shaders/people2.gdshader`; one new shader kind, no new lights.
A phase sampler blends authored locomotion with cached near-only foot, attention and cloth layers.
Main's animation diagnostics and phase-controlled rider poses remain. `Humans.Motions` stays unchanged.

`--people2` is off by default; console `people2 on|off` affects later spawns, `--people2-map` overrides
kind routing, and `p2:<body>` selects a base body while enabled. Missing dressed kinds use the legacy
native scene. Resident IDs seed face metadata at spawn, including pooled copies. Face-type art remains
separate work; register future `faceTypes.json` in native shared data when its contract is delivered.

Native intake, the data pack and proof commands are in `docs/godot-people2.md`. `--parade`, `--snap`,
`--shaders` and `--peopletest --peoplechecks crowds` run on `native-godot/town.tscn`. Frozen intake
figures are stored native scenery; refreshing them requires a deliberate additive art migration.

### G. Jef in first person and in the mirrors (after A, E, F's first cut; one helper)

- **Goal.** Jef's own arms and hands in view in both games, both hands, fingers, sleeves of the chosen clothes; smooth
  weight in the camera; his body in the mirrors and the lantern shadow from the same kit; the character creator's
  choices (sex, age, build, skin, hair, facial hair, clothes, colours) on the new body.
- **Work.** `art-source/tools/blender/build_player.py` onto the people2 kit (`player2.glb`, the same cuts, the palette planes at
  512 px); first-person arm clips in `art-source/tools/blender/people2/clips_fp.py`: idle sway, walk bob, run pump, give, take,
  hold a lantern, carry a crate (two hands), push the handcart, climb a ladder, vault, swim strokes, row; the camera
  weight (a small lag and settle on stops and turns, never a sickening bob). Browser: `client/src/player/look.ts`,
  `player/body.ts`, `game/hands.ts`, `game/lantern.ts`, `player/firstPerson.ts` (only the camera spring). Godot: new
  `godot/src/Player/Arms.cs` (a viewmodel rig under the camera, its own `AnimationTree`), `Player/Jef.cs` (only the
  hook-up), a body for the mirrors.
- **Verify.** Pictures in both games of each arm pose at 13:00 and at night with the lantern; a walk and a run video;
  no arm clipping into walls (the arms draw last or shrink near walls); the menu's character creator with every option.
- **Frame budget.** One more skinned draw in view (the arms); in the browser one draw replaces the forearm cut-out.
- **Risks.** Motion sickness: keep the camera's own motion small; the project owner tries it first.

### H. Animals (independent; one helper, two if cows come in)

- **Goal.** Every animal to the horse's bar: anatomy at true size, smooth weighted skins, feet that never slide, heads,
  ears and tails that move, pictures at 256-512 px, linear and mipmapped.
- **Work.**
  - Dogs, cats, pigs (`art-source/tools/blender/build_animals.py`, `animals.glb`): 3,000-5,000 triangles, more breeds that fit
    1873 Antwerp (a Belgian draught dog for the carts, a Schipperke on the barges, a mongrel, a terrier for the rats;
    alley cats; a Kempen pig); clips: trot, gallop, scratch, shake, bark, beg, sleep curl, stretch, pig wallow and grunt
    nod; the planar IK already there becomes full IK to the ground.
  - The horse: keep. Fix its open items only (chest lobes, roan, traces) and give the farrier's horse (`build_trades.py
    tr_horse`) the real horse (one model per thing). Add a head nod in the walk, ear turns and a tail swish as rigid parts
    on the same pivots (`world/horseGait.ts`, `Movers/Horses.cs`): it was the one thing the bar lacked.
  - Hens and goats (`build_lively.py`, `lively.glb`; `game/lively.ts` motion): skinned models with bones and baked clips
    instead of sine-swung parts (peck, scratch, run, flap; graze, chew, butt, lie).
  - Park birds (`build_park_animals.py`, `world/parkWildlife.ts`, Godot `ParkWildlife.cs`): sculpted bodies with
    feather pictures, folded wings, a few bones (neck, head, wings, feet) baked to vertex animation for the instanced
    copies (they are MultiMesh/InstancedMesh: VAT fits here, not on people).
  - Pigeons, sparrows, jackdaws, crows (`world/ambient.ts`, `world/alive/*.ts`, `wallLife.ts`): one bird kit with
    walking, pecking and flying poses in the instanced shader.
  - Rats: a real rat (body, legs, tail, whiskers) with a scurry clip, instanced (`world/litter.ts`).
  - Godot: hens, goats, pigeons, rats and the drove have no code there; port them in `godot/src/People/Animals.Life.cs`
    and a new `godot/src/People/SmallLife.cs`.
  - Cows: there are none. Antwerp's cattle came in by road and rail to the slaughterhouse and the cattle market; a
    drove of 4-6 cows at dawn would follow the pig drove's code (`shared/drove.ts`). Ask the project owner (section 5).
- **Files (owner).** The builders named above, `art-source/client/public/models/animals.glb`, `park_animals.glb`, the `lively.glb`
  hen and goat parts only (the rest of `build_lively.py` belongs to I3), `client/src/game/animals.ts`,
  `client/src/game/droveWalk.ts`, the motion parts of `lively.ts` (hens, goats), `world/parkWildlife.ts`,
  `world/litter.ts` (rats only), Godot `People/Animals*.cs`, `ParkWildlife.cs`, new `SmallLife.cs`.
- **Verify.** Blender walk and run sheets with the foot-slide measure; game pictures at 2 m and 6 m; Godot `--peoplechecks
  wildlife` and `--peopletest` (animals are inside the 1.5 ms gate); `stuck()` and `paths()` for dogs that follow people.
- **Frame budget.** Animals are few (a few dozen live); the instanced birds stay one draw a kind.

### I. Street models (independent; six helpers, one builder file each)

See "Street models: the worst 15" below for the list, files and owners.

### J. Fight motion (after A and D1's motion tools; two helpers)

- **Goal.** Smooth, weighty fight motion on the people2 skeleton, for townspeople in third person and for Jef's arms in
  first person.
- **The set** (`art-source/tools/blender/people2/clips_fight.py`, J1; `clips_fight_weapons.py`, J2):
  - J1 bare hands and dirty fighting: guard stance (a boxer's of the 1870s: upright, fists forward, the London Prize Ring
    style, and a docker's brawling guard), footwork (step in, step back, circle left and right, shuffle), jab, cross,
    hook, uppercut, a wild drunk's swing (and the drunk guard, sway, stagger), blocks (high, body), parry, slip, duck,
    bob; grabs (collar, lapels), a shove, a headbutt, a knee, a kick, a stamp; hit reactions by direction and height (head
    left, right, back; body; gut), staggers (light, heavy), knock-down forward and back, getting up (two speeds), falling
    unconscious, lying still, a hand to the head; paired moments (a grab and throw, a takedown, two men wrestling on the
    ground, a pull apart); the crowd: watching, cheering, wincing, pointing, shouting, backing off, running away.
  - J2 weapons: drawing and putting away for each kind (knife from the pocket or belt, sabre from the scabbard on `hipL`,
    baton from the belt, a plank picked up from the ground); knife: guard, slash, stab, feint, a stab taken (to the gut,
    the arm), clutching a wound; one-handed blunt (truncheon, cudgel, bottle): strike high, low, backhand, a parry with
    the forearm; two-handed blunt (plank, boat hook, cask stave): swing, jab with the end, a block with the shaft; sabre
    (the police and the soldiers): guard, cut at the head and the flank, thrust, parry (prime, quarte, sixte), a
    disarming bind; throwing a bottle; dropping a weapon.
  - First person (`clips_fp_fight.py`, J1): the same moves for Jef's arms: fists in view in the guard, each punch with a
    wind-up and a follow-through, blocks raise both forearms; with a weapon, the weapon in view; impact: a short camera
    jolt on a hit landed, a bigger one and a blur on a hit taken, never a long shake.
- **How it plays.** In place clips with matched feet; the code moves the root with the footwork (the feet are planted
  at the clip's contact frames and IK holds them while the body slides a few cm: no foot skating). Blends of 0.1-0.2 s
  between moves; a guard as the base layer with an upper-body layer for punches (three.js action weights on a bone mask
  by name list; Godot `AnimationNodeBlend2` with a filter). Hit reactions picked by the blow's direction from 8
  directions x 2 heights, then a procedural push on the spine and head (an additive layer, its size from the blow).
  Paired moves: both bodies put at matched marks (the clip pair is authored on two rigs in one Blender scene; the
  engine moves the second person onto the first's mark over 0.2 s before it starts). A knock-out: Godot
  `PhysicalBoneSimulator3D` ragdoll blended from the fall clip for the last half second, then frozen on the ground;
  the browser has no physics engine in the client: there the authored falls (4 directions) and a foot and hand IK
  settle on the ground.
- **What is procedural, what is authored.** Authored: every attack, guard, block, fall, get-up, draw and paired move.
  Procedural: the root's footwork distance, the aim of a punch (a small IK reach to the target's head, at most 10 cm),
  hit reactions on top of the authored ones, feet and knees on uneven ground, the ragdoll end of a knock-out in Godot,
  the head look at the opponent, the crowd's ring (formation code, not clips).
- **Verify.** Blender sheets and videos per move; in the game a dev fight bench (`t.fight("docker_a", "police")` in the
  browser kit, `--fightbench <dir>` in Godot) that plays every move between two figures at 3 m with pictures from the
  side and from Jef's eyes; foot slide 0 in stance; blends without pops (a pose-difference measure per frame).
- **Risks.** It is the most work in this plan (about 120 clips plus 30 first-person). Make J1's guard, footwork, jab,
  cross, hit reactions and knock-down first and show the project owner before the rest. Motion capture of boxing would help most
  here (CMU has boxing takes): only with the project owner's OK and the licence noted.

### K. Weapons as items (after A's sockets; one helper)

- **The list (1873 Antwerp).**

| Item | Model notes | How Jef gets it |
|---|---|---|
| Clasp knife (horn handle) | already sold by the knife grinder (`server/src/town/livelyWares.ts:33`, 35 c) | grinder; pawnshop; steal from a stall or a drunk |
| Sailor's sheath knife | in a leather sheath on the belt | the ship chandler; a sailor (steal or win) |
| Butcher's or fish knife | broad blade | the butcher by the Vleeshuis, the fishwives' tables (steal) |
| Docker's hook (hand hook) | iron hook, wooden T handle; every docker carries one | a ship chandler or the smith; a docker |
| Cudgel, walking stick with a knob | oak or blackthorn | the second-hand dealer (`places.ts:249`); the gentleman's cane |
| Police truncheon | turned wood, the agent's | only by taking it from an agent (a serious deed) |
| Sabre | the police agent's and the soldiers' (`build_people.py` already hangs one on police and customs) | the pawnshop (an old cavalry sabre, dear); never bought new; steal from the garrison (very serious) |
| Plank, cask stave, boat hook, a pick handle | picked up on the quays and in the trade yards | lying about (props: planks pile, timber, quaygoods) |
| Bottle | an empty bottle (litter) or one bought in a tavern | litter, taverns |
| Brass knuckles | rare, under the counter | the pawnshop at night, a thief |
| Pistol, revolver | listed, out of scope | not in the game |

- **Shops.** Antwerp had cutlers (messenmakers) and smiths; a new shop `cutler` in `shared/shops.ts NEW_SHOPS` (a
  keeper of kind `old_man` or a new cutler kind from C4), the existing pawnshop (`pawn_vis`, the Berg van
  Barmhartigheid by the Vleeshuis), the second-hand dealer, the knife grinder, the velocipede smith (`bikeshop.ts`), a
  ship chandler if one exists, else a new one on the Rijnkaai.
- **How carried and shown.** On a socket of the body (`gripR` in hand, `hipL` for the sabre and the knife sheath, a
  pocket for the clasp knife: not drawn); the townspeople see a drawn weapon (a deed: the police come, people back off).
  In Jef's first person the weapon is in view when drawn. A key to draw and put away.
- **Files (owner).** `art-source/tools/blender/build_weapons.py`, `art-source/client/public/models/weapons.glb`, `shared/weapons.ts` (the
  catalogue: name, kind, hands, reach, weight, price range, where sold; numbers are the engine's). The shop and theft
  wiring belongs to L.
- **Verify.** Close renders; each weapon in a hand socket on three kinds and in Jef's view (both games); one model per
  thing: a plank picked up is the quay's planks model, a bottle is the litter bottle.

### L. The fight system (an outline only; not to build now)

The no-combat rule (`docs/08-open-questions.md` #10, and #11, #13; `docs/09-backlog.md` lines 38-43) stands until the project owner
starts this milestone; the decision row is then rewritten with his words of 2026-10-11. The backlog's "fight spike" (the
same street fight in three.js and Godot) is half answered: the Godot port was chosen on 2026-10-03; the spike now only
decides whether fights come to the browser game and the web demo too.

- **Who fights whom and why.** Gangs at night (`server/src/night/gangs.ts`: today the "fight" answer is narrated and
  rolled), tavern brawls (the prison already holds a man for "a knife drawn in a tavern brawl on the Rijnkaai",
  `town/prison.ts:156`), a thief caught (`town/thieves.ts`, `pickpocket.ts`), a docker cheated on a sack count, a drunk,
  trust below 0 ("hate", `docs/08` #11: at -5 a man may swing at Jef), the police arresting a man who resists, a fair
  fight for money (a boxing ring behind a tavern, with bets).
- **The engine owns everything.** The server decides who fights, every hit's outcome, damage, injury, money, trust and
  the police. Models only propose (a provoked man's words, a director's event of "a brawl at the Zwaan"), schema-checked
  and clamped (`docs/03-ai-design.md`). The violent-word gates (`director/vocab.ts:451`, `town/police.ts:945`,
  `town/haggle.ts:534`, `town/confront.ts:245`) stay for model text: a fight is never something a model writes into
  being. The client sends inputs (guard, punch, block, which weapon); the server answers with the result, as the
  police talk does today.
- **Health and injury.** `docs/01-game-design.md` already has Health 0-10 (injury). A fight takes health; a knife wound
  bleeds until a doctor or the apothecary (`apothecary_markt`) dresses it; a broken hand stops dock work for days; a
  black eye changes how people speak to Jef for two days.
- **The police.** The existing police (`town/police.ts`: witnesses, the visit, warning, fine 10-150 c, arrest, the cell,
  the prison `town/prison.ts`) take fights as deeds: a fist fight a fine, a drawn knife arrest, a stabbing the prison
  for days; an agent on the street steps in with his truncheon; soldiers never arrest (`garrison.ts`) but send for
  the police.
- **Trust and witnesses.** The deeds and witnesses code (`town/deeds.ts`, `rowDeeds.ts`, `rumours.ts`): who saw it, the
  rumour, trust with the victim's friends and faction, the dockers' naties and the gang.
- **Multiplayer.** The server owns the fight; each player's own body is local (the existing rule), hits are checked and
  decided on the server; a townsperson in a fight is a shared puppet of the cell owner (`docs/multiplayer-plan.md`); a
  fight between two players needs the project owner's yes (see 5).

---

## Street models: the worst 15

Not in this list (others own them): casks, kegs and rain butts (`docs/crates-casks-plan.md`, waiting for the project owner's go),
crates (separate `fx-props` branch), sacks (done, `docs/sacks.md`), the quay furniture
and port work spots (`next-update` D4), lanterns, boats. The omnibus, the goods wagons and the velocipede are already
detailed.

| # | Model | Built in | Today | Seen |
|---|---|---|---|---|
| 1 | Interior furniture: chairs, tables, stove, counters, shelves | `client/src/world/rooms.ts:295` Builder, `interiorKit.ts:405` chair, `:432` round table, `:440` square table, `:546` stove; `shopRooms.ts`, `cafeRooms.ts` | boxes, 8-segment cylinders, 8-128 px canvas textures | 21 shops, 8 taverns, homes, cafes, within 2 m |
| 2 | Benches | `build_clutter.py:594` | one box and six beams, 84 triangles | ~256 in town; players sit and sleep on them |
| 3 | Shop-front spills: baskets, crockery, clogs, bread, meat, apples and onions | `build_lively.py:347` (apples 7 cm cubes, `:332`) | 16/32 px cells, flat faces | every shop door |
| 4 | Market barrow, cart, fish bench, baskets, fish boxes | `build_trades.py:856-1095` | 8-10-sided solid disc wheels, a fish as one quad, 6-sided cabbages | Vismarkt daily, Grote Markt Wed and Sat, while buying |
| 5 | Stall frames and goods: fish, loaves, heaps, baskets, posts, awnings | `build_stalls.py:520-897, 1138` | box posts, 6-sided fish and loaves, 32-64 px cells | 29 stalls, 14 shop tables, at 1 m |
| 6 | Door leaves | `art-source/tools/blender/build_city.py:433`, `client/src/world/cityTextures.ts:180` | a 64 px painted cell over 1.1 x 2.2 m, flat in the reveal | every entry |
| 7 | Signboards, shop lettering, awnings | `build_streetlife.py:839, 852, 944` | an 11 px pixel font (3.6 cm a texel), awnings single quads | 3-10 m, every shop |
| 8 | Baskets (street) | `build_clutter.py:441` | three open 7-sided cones, no floor | alleys, doors |
| 9 | Parked handcart | `build_clutter.py:393, 285` | box bed, 10-sided disc wheels without spokes | wide streets |
| 10 | Dog carts, knife-grinder barrow, door chairs | `build_lively.py:463-572` | boxes, 12-gon rims, square spokes | moving rounds, doors |
| 11 | Pumps and troughs | `build_streetlife.py:1101-1170`, `build_clutter.py` pump | 8-sided lathe, box basin | 64 pumps in the bake |
| 12 | Cathedral lean-to stalls (rosaries, candles, prints) | `build_lively.py:261` | flat faces | the cathedral square |
| 13 | Rubbish, leftovers, broken crate | `build_clutter.py:451, 618` | low heaps | everywhere at the foot of walls |
| 14 | Well, madonnas, hanging trade signs (pretzel, key, boot, tankard) | `build_streetlife.py` (well 1,602, madonnas ~2,000, hang_* 156-368 tris) | fair shapes, small cells | corners, looked up at |
| 15 | Props handcart and dray | `build_props.py:900, 1042, 1108` | fair (lathe wheels, 12 spokes, 64 px cells) | Jef pushes the handcart at arm's length |

Found by the survey and worth an issue (CLAUDE.md "finds outside your task"): the rooms' barrel at `rooms.ts:326` is
meant to bulge but `CylinderGeometry(..., 10)` has one height segment, so it stays a plain tube (it is a cask: the
crates-casks plan replaces it).

**Market goods are one kit** (the rule "one model per thing"): a fish, a loaf, a cabbage, an apple, an onion, a basket,
a clog, a jug look the same on a stall, a barrow, a shop-front spill, a shop shelf and in a hand. I4 makes
`art-source/tools/blender/goods_kit.py` (and, for code-built rooms, `client/src/game/goodsKit.ts` that loads its glb) first; I1, I3
and I5 use it.

**Packages** (one builder file each, so they never edit the same file):
- **I1 interiors** (`client/src/world/rooms.ts`, `interiorKit.ts`, `shopRooms.ts`, `cafeRooms.ts`; a new
  `art-source/tools/blender/build_furniture.py` and `art-source/client/public/models/furniture.glb` for chairs, tables, settles, counters,
  stoves, beds, shelves, a clock case using the shared live-hands code): rank 1. Rooms keep `ROOM_POINT_LIGHTS` and few
  meshes: furniture as one InstancedMesh per kind across rooms, shared materials (`performance.md` "Lights and rooms").
- **I2 clutter** (`art-source/tools/blender/build_clutter.py`, `art-source/client/public/models/clutter.glb`): ranks 2, 8, 9, 13, the clutter
  pump. Leave its barrel, keg and rain butt to the casks plan; its three static cats go to H's cat model.
- **I3 lively** (`art-source/tools/blender/build_lively.py` except the hen and goat parts, `lively.glb`): ranks 3, 10, 12, using
  the goods kit; the dog cart's dogs stay H's dog model.
- **I4 market** (`art-source/tools/blender/goods_kit.py` first, then `build_trades.py` market items `mk_*` and `build_stalls.py`):
  ranks 4 and 5; the open stalls covered at night (survey 25) belongs to the stalls' code, `game/stalls.ts`, only if
  the coordinator gives it to I4.
- **I5 street fronts** (`art-source/tools/blender/build_streetlife.py`): ranks 7, 11, 14; a proper sign-painter's lettering
  (painted at 1024 px, serif and slab faces of the 1870s, gilt on black, the Dutch and French names as now). Rank 6
  (doors, in `build_city.py` and `cityTextures.ts`) is its own small package I6 because a city rebuild touches every
  house: door leaves as a set of 8-12 panelled, ledged and glazed doors made as one kit, painted at 512 px, with a real
  reveal and step.
- Rank 15 (handcart, dray) waits for H, which owns `build_props.py` for the horse; the same helper does it after.

**Each I package: verify** with bounded native town captures at 13:00 clear, rain and 19:30, plus native shader, navigation and timing checks. Still things are stored Godot scenes; moving models use ModelLibrary's native callback. Keep the shared sack sockets contract. **Frame budget**: more triangles are fine; no new materials (stay on each
builder's atlas, now at 128-256 px cells), no new draws (copies stay instanced or merged as today).

---

## 4. Order and parallel lanes

| Lane | Packages, in order | Depends on |
|---|---|---|
| 1 | A (rig, bodies) | none |
| 2 | B (faces, hands, hair) | A's topology (week 1) |
| 3 | C1, C2, C3, C4 (kinds) | A |
| 4 | D1 then D2 and D3 (motion) | A's rig |
| 5 | E (browser), F (Godot) | A's first glb; grow with C and D |
| 6 | G (Jef) | A, E, F |
| 7 | H (animals) | none |
| 8 | I4 (goods kit) first, then I1, I2, I3, I5, I6 (street models) | none; I1, I3, I5 use the goods kit |
| 9 | J1, J2 (fight motion) | A, D1's tools; the project owner sees J1's first moves |
| 10 | K (weapons) | A's sockets |
| later | L (fight system), P-later (VAT crowd past 100 drawn) | the project owner's decisions |

---

## 5. Questions for the project owner (with a recommended default)

**the project owner's answers, 2026-10-11** (they replace the defaults below where they differ; docs/08 #10):
- Fights are in the **Godot game only** (question 4). The browser and the web demo get the new people and animals; fights stay narrated there.
- **Killing is possible** (question 5: yes). Gangs give **killing jobs**, and Jef can **join gang battles**.
- **Consequences:** a murdered key quest giver is **replaced by a new person with another name**, who gives that work from then on. The new one **knows the old one was murdered**, and if anyone **saw** it, they know **who** did it.
- **Witnesses by sight only**, for theft as for violence: a deed counts as seen only when a person's eyes can see it (line of sight, light, fog, distance).
- **Screams:** a victim who screams makes people **look** (and so see), so a **silent kill** is safer: stealth matters (from behind, unseen, a quick silent blade; a shout spreads).
- Still open with the defaults below: 6 (the cost of a stabbing; now also of a killing), 7, 8, 9, 10.


1. **One people file or four?** Default: one `people2.glb` built from the four kind lists; the helpers work on
   `people2_<group>.glb` and A joins them.
2. **Cows?** Default: yes, a small dawn cattle drove to the butcher's (4 cows, the pig drove's code), after H's main work.
3. **Motion capture (CMU, free licence)?** Default: no for walks (we author them), ask again for boxing if J1's own
   keyframes do not convince the project owner.
4. **Fights in the browser game and the web demo?** Default: Godot only; the browser game gets the new people and
   animals, but fights stay narrated there.
5. **Can people die?** Default: no. A knife fight ends in a wound, the hospital (Sint-Elisabeth) and the prison for the
   one who stabbed; nobody dies on screen. Jef never dies: he wakes in the hospital or the cell, poorer.
6. **What does a stabbing cost Jef?** Default: arrest on the spot if seen, three days in the prison, the job lost, trust
   -4 with the victim's people and -2 with the town; unseen, a rumour and a search.
7. **Who may Jef fight without a deed?** Default: a gang that robs him, a man who swings first, a fair fight in a ring;
   everything else is a deed.
8. **Weapons on the street?** Default: a drawn weapon is a deed at once (people back off, the police come); a sheathed
   sailor's knife or a docker's hook is normal.
9. **Players fighting players?** Default: off; only when both have it on in the play-together settings.
10. **Blood?** Default: a little and dark (a stain on the shirt, a few drops), no gore; a setting to turn it off.

---

## 6. Risks for the whole plan

- **Size.** About 51 kinds plus 10 new, ~60 new or re-authored clips, ~150 fight clips, every animal and 15 models: many
  helper weeks. A first pass that shows the project owner the new body on four kinds (a docker, a fishwife, the police agent, Sooi)
  walking and talking in both games before C and D go wide is the cheapest check.
- **The browser budget is already over** at four places (section 2.1): this work must not add draws; it should save
  material switches. Anything that costs more goes to the project owner first.
- **Parallel editing.** Many sessions share the checkouts: each package owns the files named; `crowd.ts`, `town.ts`,
  `Crowd.cs` get only small call changes, by E and F alone. Stage by path, never `git add -A`.
- **One model per thing.** The sack, the handcart, the sack truck, planks, bottles and the lantern are other models;
  people hold them through sockets, never as copies built into a body.
