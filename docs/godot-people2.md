# Native Godot people2

People2 stays off by default. `--people2` selects the matching dressed kind from
`res://assets/game-models/people2.scn`; missing kinds use the existing native people scene.
The dev console accepts `people2 on|off` for later spawns. `p2:<body>` selects a base
body while enabled, and `--people2-map docker_a=man_middling,fishwife_a=woman_stout`
overrides routing. The multiplayer `Humans.Motions` list is unchanged.

## Authoring and intake

The kit keeps its filenames and internal layout under `art-source/tools/blender/people2/`.
It imports legacy pose functions from `art-source/tools/blender/build_people.py`.
Bodies and faces retain the port's source artwork. Dressed kinds have a second clothing pass. Masters are
`art-source/client/public/models/people2.glb` and `art-source/shared/peopleRig.json`.
Blender check pictures go to `.scratch/people2-build/shots`, outside git.

```powershell
& $blender -b --factory-startup --python-exit-code 1 -P art-source/tools/blender/build_people2.py -- --plain .scratch/people2-plain/people2.glb
dotnet build native-godot/Scheldemist.Native.csproj
. ./native-godot/scripts/engine-tools.ps1
$engine = Resolve-WorkshopGodot
$intake = Join-Path (Get-Location) '.scratch/people2-intake'
New-Item -ItemType Directory -Force -Path $intake | Out-Null
$env:SCHELDEMIST_USER_DATA = Join-Path $intake 'userdata'
Invoke-WorkshopEngine $engine (Join-Path (Get-Location) 'native-godot') @('--rendering-method','forward_plus','--path',(Join-Path (Get-Location) 'native-godot'),'--log-file',(Join-Path $intake 'live.log'),'res://recovery/recover-game-models.tscn','--','--source-models',(Join-Path (Get-Location) '.scratch/people2-plain'),'--resume-intake','yes','--only','people2','--author-root',(Join-Path $intake 'layouts')) (Join-Path $intake 'engine.log') 180
```

Set `$blender` to the installed Blender 5.2 executable. Use `--python-exit-code 1` so a Python failure cannot look like a successful build. Run Blender with a process
timeout (25 minutes for the full build) and restore the environment after intake.
Use disposable data/layout directories; retain logs and delete only those test data.
The plain GLB has dense morph accessors and ordinary geometry. It replaces the retired
Node decoder; there is no decoder or GLB import during game startup or export.

Intake adds one scene plus `people2-resources/` and `people2.extras.json`, merging
`intake.json` and `full-intake.json`. Normal resume keeps an identical scene and rejects
a changed source. After rebuilding the plain GLB, replace the people2 kit in one command:

```powershell
pwsh -File native-godot/scripts/replace-people2.ps1
```

Optional `-SourceModels <directory>` and `-Rig <peopleRig.json>` select another full build.
The wrapper builds C#, imports the model with `--resume-intake yes --only people2 --replace people2`,
copies the matching rig and prepares the native pack/fingerprint. It records hashes of every
other model file and checks both manifests' other entries. The intake validates/imports the
GLB before replacing anything, backs up only people2's three owned paths and the manifests,
and restores them if saving fails. People2 rejects headless intake, whose dummy renderer cannot
persist usable ImageTexture resources; source placeholder images are checked before replacement. No other model can use `--replace`. Stored placements,
permanent IDs and editor layouts are untouched. Evidence lives in `.scratch/people2-replace-*`;
its isolated test data are removed automatically.

Copy the authored rig to `native-godot/world/data/shared/peopleRig.json` and register
`shared/peopleRig.json` in `native-godot/world/data/manifest.json`. Future
`faceTypes.json` uses the same registration when its schema and art are delivered.
`prepare-native-package.ps1` writes SHA256-addressed immutable blobs, updates the loose
cache version and fingerprints shipped resources, data and runtime source. `Paths.Shared`
reads the extracted data cache. Host and guest must agree on this content identity.

## Runtime contract

`People2Material` uses `ModelLibrary.NativeScene` before ordinary material conversion.
It preserves morphs, removes far-copy morphs if needed, and assembles compressed clothes/face/detail
Texture2DArrays synchronously during model preparation. One shared material reads per-mesh instance
uniforms for clothes layer, face layer and a stable-id skin shift. Source PNGs and the manifest live in
`res://assets/people2-pictures`; replacement imports them before intake. The scoped PNG import
presets are committed: colours require high-quality VRAM compression, normals require normal-map
compression with high quality off so Godot stores RGTC rather than BPTC. Imported colour is BC7/BPTC,
normals BC5/RGTC, all mipmapped with linear anisotropic shader filtering. Exported games load the
persisted compressed resources; no editor compression, PNG repaint or GLB decoding occurs at startup.
The existing people2 spatial shader kind covers sun, sky, fog, lamp/window spill, normal maps and
near detail. No shader kinds or lights are added. Vertex green selects the full-square head picture;
red retains the eye highlight. A hidden mesh reference includes the kind in the first-frame audit.
The current fourteen head pictures retain their authored body/kind assignment; the pending face-type
schema does not yet replace the existing integration-only `face_id` metadata.

`Human2` samples clips by bone name and blends locomotion at a shared heel phase; standing, talking and sitting
play the D2 clips (below).
`HumanLayers` caches attention, cloth springs and foot stance correction, stopping near
layers at 15 m. Main's animation snapshots and phase-controlled rider behavior remain.
`People2Faces.SetFace` resets omitted weights without clamping. Stable resident IDs feed
FNV-1a identity metadata immediately after spawn, including pooled bodies. Face IDs are
integration metadata; this port does not invent the pending face-type schema or artwork.

## Idles, talk and sitting (package D2)

`People2Moves` reads `peopleRig.json idles` (docs/people.md "Idles, talk and sitting"). `Humans.Motions` and the
wire are unchanged: the motion stays the game's word, and `Human2` picks the clip of the body's family locally.
Every choice comes from the person's stable id (`Human.SetIdentity`, FNV-1a), so every PC shows the same.

- idle: the family's idles; each person has its own (from the id) and changes now and then (after 20-50 s, at
  the end of a loop, most often back to its own) with a 1 s crossfade; every loop of a family starts and ends in
  the family's stance, so the feet stay. Each person plays standing and seated clips at its own rate (0.92-1.08).
- fold, behind, pockets, point: the family's own clip for it (a woman's pockets are hands folded low).
- talk: speaking (the calm, eager or cross set) and listening alternate at the end of each loop. A talker within
  3 m who also talks is the partner: a speaker yields at the end of a turn and a listener speaks when the other is
  quiet, so two never speak at once. The set follows the mood when the game knows it (a reply in Jef's talk:
  angry or cold cross, warm or amused eager, else calm, for 3 minutes), else the id (half calm, three in ten eager,
  two in ten cross). A shrug now and then in a calm or cross turn, a laugh now and then while listening to an
  eager one.
- sit: `SitDrop(seat)` picks the seated clip by the seat's height (under 0.32 m a step, under 0.43 a crate, else a
  bench or a chair by the id) and returns `seat - seat(clip) x hips/hips(clip)`: the clip lowers the hips itself. A
  seat of 0 is a seat at the node's own height (the omnibus, the boats). Near the camera `HumanLayers` puts the feet
  back on the floor by leg IK for a seat that is not the clip's own height. Sitting down and getting up play when the
  game changes between a standing motion and sit with a fade (not when it places a figure in its seat). Everyone
  sits now, women in skirts and aprons too (`Human.CanSit`, `Humans.CanSitKind`); the old people.glb keeps its
  rule (no women, no long aprons).
- the old play their own `_old` versions of the old standing clips where they exist.
- A fade between two standing clips locks the planted feet (`HumanLayers`, released when the node moves or
  turns). Fades put the shoulder helpers back on their rule near the camera (`People2Shoulders`), and so
  does code that turns an arm (`LeadLooks.Grip`, the emigrants' wave).

Proof: `& ./native-godot/scripts/check-people2.ps1 -Modes motion -Port <port>` (`--people2-motion <dir>`) puts a
row of eight people idling, a pair talking, a docker on the game's crate, a woman on a market stool, two people on
doorsteps (found by the colliders: the houses' 12 cm plinths) and two women on a town bench, and takes them at
3 m and 6 m at 13:00 and 19:30, with ten pictures 0.25 s apart of an idle, a talk, sitting down and getting up,
then lets them live 150 s at 30 Hz and records every clip change, the talkers' turns and the stand lock's drift
(`motion.json`).

Evidence (2026-10-13, 199 clips): `.scratch/people2-native-b955c1da441b4bc7b444c18aa72d5637/` (motion, captures,
routing, parade, identity, network, all PASS). 64 motion pictures inspected. In 150 s the pair spoke in turn: 0
frames with both speaking, 8% with both listening (a pause), 12 turns; idles changed every 20-50 s per person;
planted feet held by the stand lock moved 0.000 mm. Parade foot lock 0.008 mm; routing (14 roots, 16/64 bones,
faces) and 25 multiplayer checks pass with the new content fingerprint.
Shader audit: `.scratch/people2-native-5fdc2f50507e4d0184c3632444d6139a/shaders/` (532 samples, one people2
kind, no new kinds, 29 cache entries throughout, no problems). Timing under other worktrees' load (not exclusive,
so not the gate): with the D2 moves the people2 animation mean was 0.47/0.38 ms at the Vismarkt/Grote Markt
against 0.37/0.29 ms with them bypassed in the same conditions (+0.1 ms); all animation 0.86/0.73 ms.

## Work (package D3)

`People2Moves.LoadWork` reads `peopleRig.json work` (docs/people.md "Work"); `Human2` plays the work clips and
`People2Things` shows what they move. The wire is unchanged: the motion stays the game's word, the clip is chosen
locally from the motion, the person's stable id, a load and a context every PC works out the same.

- motions: a family's work clips for scrub (a woman sweeps one doorstep in three, from the id), lace, wash, cross,
  call, smoke, beg, wall, lean, write, grind, row, ride, crouch, hop, rope (the skipping rope), pull (the rope haul),
  point (pointing the way or up at the spire, from the id); the family's fallback (D3's) where it has none.
- kinds: the sentry marches and stands with the rifle (`rifle_*`); docker_sack walks and stands with the sack.
- loads (`Crowd.PuppetLoad`, people2 only): a sack rides the left shoulder (`sack_walk`, `sack_hold`, the one sack
  model at `loads.sack`); a crate, a box of fish or a keg is the game's node held against the belly (`crate_walk`,
  `crate_hold`). A sack let go is set down from the shoulder first (`sack_down`) and stays where it was put until the
  docker takes up the next or for 30 s.
- contexts: `Human.Work` = `haul_sack` for a docker bending at a sack pile (HaulRoutes: the host's `Townspeople` and
  the guest's `RemotePose` find it from the routes alone): he lifts the sack onto his shoulder (`sack_lift`, or
  `_high` when `PileTop` says the pile is at his waist). The host waits for the lift and the set-down
  (`Human.WorkSeconds`; positions are the host's). `fish_stall`: a fishwife behind a market fish table guts (`gut`)
  while idle or with folded arms; she stands 0.19 m nearer the table (`NativeMarket.People`).
- kits (`StreetLife`, `StreetKits`): a people2 scrubber's bucket at her left hand and no brush on the ground (it is in
  her hand), the washer's bucket before her, a smoker's pipe in his hand (the kit's pipe meshes).
- things (`People2Things`): the one sack (sized per frame: lying, draped over the shoulder), the quay's cask (turned by
  the distance walked), the alleys' birch broom, the lively scrubbing brush and the pipe; on a bone or on a track in
  the node's frame, shown within 60 m. A knife, a book, a rifle, a crank and the oars have no game model and are not
  drawn.
- the D3 clips put their own hips where the work needs them: `Human.MotionLift` is 0 for people2. Paced loops (the
  carries, the cask, the march) play at the walker's pace (two strides a loop) and lock their planted feet as the
  walks do.

Proof: `& ./native-godot/scripts/check-people2.ps1 -Modes work -Port <port>` (`--people2-work <dir>`) stages on the
Rijnkaai at the sack pile of haul route rk-m: a docker lifting (the game's context), lifts held at moments, a carrier
walking with a sack, one standing with it, one setting it down, two passing a sack, a cask rolled, a rope hauled from
a block, a fishwife at a fish table, a woman sweeping; pictures at 3 m and 6 m at 13:00, in rain and at 19:30, twelve pictures
0.25 s apart of a lift and of a pass, 60 s of their life at 30 Hz, and 45 s of the town's own hauling dockers live
(with `--people2-map docker_b=docker_a,docker_c=docker_a,docker_sack=docker_a,fishwife_b=fishwife_a`), with pictures
of their lifts and set-downs (`work.json`).

Evidence (2026-10-13, 235 clips): `.scratch/people2-native-59590afb765d413cb2eb0b6b26a2466a/` (work with rain, pictures
inspected; content identity 7 checks and multiplayer 25 checks pass with the new fingerprint) and
`.scratch/people2-native-9254f7b2a2ed433d96227592ab2f0dfb/work/`;
the paced loops' planted feet moved 0.002 mm (the sack walk) and 0.004 mm (the cask) under the runtime lock; in 45 s
eleven town dockers played `sack_lift`, `sack_lift_high`, `sack_walk`, `sack_hold`, `sack_down`, `crate_walk` and
`crate_hold` from the game's own haul. `.scratch/people2-native-3ad95f007a014193828d2099f90343f5/`: the D2 motion
proof (0 frames with both talkers speaking, 12 turns), routing and parade pass; the shader audit has one people2 kind,
29 programs throughout and no problems. Timing under other worktrees' Godot load (not exclusive, not the gate): all
animation 0.61/0.68 ms at the Vismarkt/Grote Markt, people2 0.30/0.38 ms, layers 0.03/0.06 ms, town update 1.06/1.26
ms (`.scratch/people2-native-5b0be255907f453e9d202078e972bb01/timing/`).

## Verification

```powershell
pwsh -File native-godot/scripts/check-people2.ps1
& ./native-godot/scripts/check-people2.ps1 -Modes dress-captures -Port 8903
& ./native-godot/scripts/check-people2.ps1 -Modes legacy-timing,timing
& ./native-godot/scripts/check-people2.ps1 -Modes routing
```

The routing fixture verifies the map overrides, all fourteen body/kind roots, the
16/64-bone off/on switch and the face setter/reset contract.

The runner builds/prepares once, accepts ports 8800–8999 with `-Port`, disables AI and writes evidence
under `.scratch/people2-native-*`. Each process has separate saves, settings, layouts
and static cache, a 420-second timeout and guaranteed shutdown/data cleanup.
Timing rejects every other Godot process before and throughout the run, including failed-launch
dialogs, and records a `tasklist` receipt before launch. `-WaitForTimingSeconds 3600` allows a one-hour wait.
Engine errors,
nonzero exits and failed JSON reports fail the runner.

Captures show docker_a, fishwife_a, police, sooi and the ten base bodies at Vismarkt, at 1 m and 3 m,
at 13:00 clear, 13:00 rain and 19:30 beside an existing lamp, with low rear views too.
The capture checks the live clock/weather and camera position. Inspect the PNGs.
The parade samples blend_walk, idle, walk and talk. Ordinary `--snap <dir> --views ...`
also works on `res://town.tscn`; use `--no-mainmenu` for automated snapshots/parades.
`dress-captures` adds 252 pictures: each kind in idle, walk and talk, front/back at 1/3 m,
plus low feet/undersides and elevated cap/shoulder/basket views, in all three environments.
It also shows the far copy at 3 m for silhouette inspection. The receipt records the live animation phase as well as clock, weather and camera position.
The inspection fixture freezes/hides the ordinary crowd so walkers cannot obscure the close views;
its four exhibit humans retain native animation, and the environment/light resources stay intact.

The shader audit requires exactly one people2 kind, zero late kinds and zero problems.
PeopleTest directly times every `Human.Update` and the existing `Townspeople.LogicMs`
bracket for 600 frames per square. Each mean must be below 1.5 ms. Layer timings are
included in animation timings, not extra costs; frame subtraction is diagnostic.
These CPU gates exclude GPU rendering and animal logic. Pack proofs compare every raw
file and test corrupt/path-escaping packets. The native multiplayer proof rejects a
mismatched fingerprint before joining and accepts matching authenticated clients.

Body/face/clothing repairs remain separate authoring work. Current close views retain
the source's tunic/waist gaps and some coarse face details. Face-type art and its schema
are still pending; neither shader success nor a synthetic morph test proves those art
features complete. People2 remains opt-in until that work is reviewed.

## Native port evidence (2026-10-13)

The full Blender rebuild passed in 567 seconds: ten bodies, four dressed kinds,
64 bones, 102 clips and one atlas material. The plain intake had no sparse accessors
or required compression extensions. All 34 existing stored model scenes retained
their hashes. The new model uses 150 external resources (largest 16,506,589 bytes).

Inspected captures: `.scratch/people2-native-b97a296d829c4b569f6365a203124133/captures/`.
There are 36 PNGs: front 1 m/3 m and low rear views, four kinds, three light/weather
states. `captures.json` verifies live hours 13/19.5, weather and the camera position.
Four exhibit figures allocated zero update bytes over 120 measured frames.

The same evidence root holds the fourteen-kind, four-row parade and its foot-lock
receipt (largest recorded stance slide 0.007865 mm), shader audit (534 samples,
one people2 kind, zero late kinds/problems, 29 generated cache entries throughout,
121 gameplay point lights plus one sun), seven content-identity checks and 341
data-pack checks over 320 logical files. Six disabled workshop preview lights are
reported separately; they are not gameplay lighting. Shader success does not cover
driver compilation timing.

Routing and refreshed multiplayer receipts:
`.scratch/people2-native-1195def6b4fd4a6c885349dce8695e64/`. Mapping, fourteen roots,
16/64-bone off/on routing and face assignment/reset pass; multiplayer passes 25
checks, including matching guests and rejection of a different content fingerprint.

Exclusive timing with seed 1873 and 648 residents:
`.scratch/people2-native-22f98f58473146588b34f027b1ac05a5/timing/peopletest.json`.
Each square has 600 direct samples. No other Godot engine appeared in its 180
process-isolation samples; a prior overlapping run was rejected and is not evidence.

| Square | All animation mean/p95 | Included people2 mean | Included layers mean | Town update mean/p95 |
|---|---:|---:|---:|---:|
| Vismarkt | 0.492 / 0.678 ms | 0.194 ms | 0.024 ms | 1.019 / 1.379 ms |
| Grote Markt | 0.461 / 0.583 ms | 0.183 ms | 0.025 ms | 1.041 / 1.413 ms |

Both 1.5 ms mean gates pass. Each square reports zero overlaps, blocked placements
and stuck walkers. Observed drawn counts are 51/52, including native extra figures.
Whole-frame means were 14.773/15.152 ms; p95 was 18.600/18.506 ms. Those complete
frame values do not establish a universal frame-budget pass or a speed improvement.

Final strict shader/identity/network recheck:
`.scratch/people2-native-30e6023bf81c43ebb4f233b000150c6c/`. It passes 539 shader
samples with one people2 kind, no late kinds/problems, generated cache 29 throughout
and unchanged gameplay lights; seven identity checks and 25 multiplayer checks pass.
Shipped content fingerprint:
`8a387141a3baa1504d501f674fbf54b5c69b24df03ef026fa984f9f30b6fe523`.
The optional legacy timing comparison was interrupted by another engine and discarded.
It supplies no performance comparison. All completed runs' test databases, settings,
layouts and extracted caches were deleted; logs, pictures and receipts remain outside git.

## Clothing second-pass evidence (2026-10-13)

The repaired build entrypoint keeps `--only` and `--kinds` independent. The documented
command enables `--python-exit-code 1`; the accepted bounded rebuild also rejected
Python tracebacks in its wrapper. Full rebuild: 669 seconds, ten bodies, four dressed kinds,
64 bones, 102 clips and one atlas material. Counts and edge notes are in
`docs/people.md`, under “Clothing second pass”; near crowd kinds are 8,898–8,900,
named Sooi is 11,500, and shipped far copies are 2,097–2,099 triangles. The basket
is 2,000. `.scratch/dress-pass/build.log` prints every garment/prop piece;
`.scratch/dress-pass/geometry.json` checks exported indices, finite positions/normals,
zero-area triangles (none) and four normalized joint weights.

Final rendered intake/preservation receipt:
`.scratch/people2-replace-dc50dbef600a4f0dba07b8fa801ab7a3/replacement.json`.
All 1,582 other model files and both manifests' other entries were preserved.
The scene has 150 external resources, largest 16,423,935 bytes. Guards reject
another model and headless people2 intake without changing any of the 1,736 stored
model/manifest files: `.scratch/dress-pass/intake-guards/guards.json`.

Accepted and inspected final pictures:
`.scratch/people2-native-1119086e80904e3aa5d6950b05b8b235/dress-captures/`.
All 252 PNGs were reviewed through the twelve `review/*.jpg` contact sheets,
including fronts, low backs, tops, feet, forced far copies, idle/walk/talk,
13:00 clear/rain and 19:30 lamplight. The basket stays upright beside the skirt;
its withies, handle and herring are visible from above. The apron edge stays clear
of the skirt in these poses; clogs retain a dark wooden surface under the lamps.
The retake freezes/hides ordinary crowd walkers to keep close inspection unobstructed.
This is automated art evidence, not manual player acceptance.

Technical receipts: `.scratch/people2-native-80c0e54a321d4842a10f11d3627fa4fb/`.
The shader audit passes 532 samples: exactly one people2 kind, zero late kinds/problems,
generated cache 29 throughout, 121 gameplay point lights and one sun unchanged.
Six disabled workshop preview lights remain separate. The fourteen-kind, four-row
parade passes; all sixteen PNGs were inspected (`parade/review.jpg`). Seven content
identity checks, 341 data-pack checks across 320 files and 25 multiplayer checks pass,
including matching clients and rejection of a mismatched content fingerprint.

Final shipped content fingerprint:
`e821b1b44b0812cd5be2dccc25dfc99c075d8731510a586834fd794ab0b54c99`.
The original headless intake attempt and aborted/occluded captures are not acceptance
evidence. Completed runs removed isolated databases, settings, layouts and extracted
caches; logs, art inputs, pictures and receipts remain outside git.

Second-pass timing is **not accepted**:
`.scratch/people2-native-6d4d7c99b11d48f09799face655b61ce/timing/`.
The runner waited for an exclusive start, then other worktrees launched engines during
measurement. All 190 process-isolation samples record overlap, so the runner rejected
this run despite `peopletest.json` reporting `ok: true`. Its test data were cleaned and
its own engine stopped. An uninterrupted exclusive window is still required; the
historical port timing above is not a new measurement of these assets. Re-run:

```powershell
& ./native-godot/scripts/check-people2.ps1 -Modes timing -Port 8905
```

## Layered picture evidence (2026-10-13)

Full Blender build: 876 seconds, ten bodies, four dressed kinds, 64 bones, 102 clips and
one tiny intake material. `.scratch/pictures-geometry.json` verifies all 32 mesh primitives,
finite positions/UVs, authored head selectors, one material and dense morphs. Replacement:
`.scratch/people2-replace-c100ba8a0ab04db69aa2a48b7fbe2f5d/replacement.json`; all 1,582
other model files and both manifests’ other entries were preserved.

GPU texture block payload, including every mip level (decimal MB):

| Set | Bytes | MB |
|---|---:|---:|
| Previous native atlas colour/normal images | 178,956,968 | 178.96 |
| Current ten bodies + four kinds, fourteen heads, held layer and shared details | 85,286,048 | 85.29 |
| Conservative projection: 61 dressed kinds + ten bodies + held layer, 32 faces, details | 295,005,248 | 295.01 |

The current load measures BC7/BPTC colour and BC5/RGTC normals, 1,398,128 bytes per
1024 px layer and 349,552 bytes per 512 px detail layer, with full mip chains.
These are measured compressed image/array payloads, not driver allocation measurements:
`RenderingServer.TextureMemUsed` returns zero at model preparation. Geometry and render
targets are outside the people-picture budget. The loader rejects a wrong format or size
and a projection of 300,000,000 bytes or more. The fresh isolated import in
`.scratch/people2-cold-pictures/result.json` reproduces all six arrays and the exact payload
from the committed PNG/import presets, without the existing project cache. Imported source textures are disposed after
extracting their compressed images; only the shared arrays remain in the material.

Accepted captures and routing:
`.scratch/people2-native-61a8e2eb72f94df3a8167e538076a0e5/`.
All 210 PNGs were inspected through the 21 Photocraft `captures/review/sheet-*.jpg` contact
sheets, with separate full-size close-ups. Four kinds and ten bodies appear at 1/3 m,
front, low back and top, in 13:00 clear/rain and 19:30 lamplight. Fine cloth weave is visible
at 1 m and fades with distance; head pictures are sharp and layers do not bleed into one
another. Existing waist/vest gaps and the fishwife’s jagged shawl edges are geometry findings,
visible in `day-sooi-1m.png`, `day-police-1m.png` and `rain-fishwife_a-1m.png`; this pass
preserves that authored geometry and its existing edge exceptions. New face types remain pending.

Content and multiplayer receipts:
`.scratch/people2-native-4e9e6e968fb3446ca0926bdb3477176d/`.
Identity: seven checks; pack: 341 checks over 320 files; network: 25 checks, including
matching authenticated guests and rejection of a different content fingerprint.
The first shader attempt hit the existing four-minute deadline under concurrent native games
and was discarded. Two subsequent 30-minute exclusive waits expired while other Godot
runs continued to start. There is no accepted shader-audit or CPU-timing result for this
change yet; the 1.5 ms mean gate and four-minute internal check deadline were not relaxed.
Run `check-people2.ps1 -Modes shaders,timing -Port 8931` from PowerShell with a real string
array for `-Modes` after the other engines finish. The runner now waits before shader
checks too; CPU timing still rejects overlap throughout the measured run.

Additional accepted and inspected views:
`.scratch/people2-native-e438ae18bc97482d979d142a354648b4/distance-captures/`.
Its 210 PNGs add 8 m fronts/low backs, 1/3 m sides and low feet in all three environments,
reviewed through its 21 Photocraft contact sheets. The temporary figures use one clear
exhibit point and are shown individually; earlier wide-rear cameras inside the building
were discarded and the capture fixture corrected. Combined accepted art proof: 420 PNGs.

## Integration evidence: animals + D2 motion on layered pictures (2026-10-13)

Branch `art3-integrate` merges art3-animals and art3-motion onto the layered-picture export.
Animals use the people2 shader with `layered_pictures = false` (their own coat picture, normal
map and albedo); people keep the Texture2DArrays. people2 was rebuilt once from the merged sources
(Blender plain glb, 1031 s, 199 clips of which 97 D2, one material) and replaced with
`replace-people2.ps1`; content fingerprint `0798c577...`.

- Shader audit (exclusive): 130 first-frame kinds before (art3) and after; the only change is the
  people2 kind's hash (its source gained the animal path), and the animals moved from the generic
  `qf_solid` kind onto it. 29 programs and cache entries; lights unchanged (1 directional, 121 omni).
  `.scratch/people2-native-a44c6fcb9418438a8a2997d22a2e43ea/shaders/`, baseline
  `.scratch/integrate-baseline/shaders.json`.
- Captures: 588 people2 PNGs (14 kinds/bodies; idle, talk, walk, sitting; 1/3/8 m; 13:00 clear and
  rain, 19:30), D2 motion (150 s: 12 talk turns, never both speaking, stand lock 0 mm), parade foot
  lock under 0.008 mm, routing, identity (7), pack (341), network (25) all pass:
  `.scratch/people2-native-8113126f929a41c795f66def2f6ad6f6/`, `.scratch/people2-native-b3dd30a4600f4cddba497418c563804e/`.
  Animals: slide, 774 captures (18 kinds at 1/3 m walking, sitting, lying; the dog cart), identity,
  network pass: `.scratch/animals-native-59b38b4840d140a9b2a55204ccf0d8b9/`.
- Timing: no exclusive window in 60 minutes (9 runs, each overlapped by other worktrees' engines),
  so no accepted 1.5 ms result. In those runs people+animals means were 0.71-1.48 ms except one
  Grote Markt at 1.78 ms, caused by a single 235.8 ms spike in the animals' update (median 0.19 ms);
  20-35 ms animal-update spikes occur in most runs. Re-run `check-people2.ps1 -Modes timing` alone.

## Integration evidence: D3 work on layered pictures + animals + D2 (2026-10-13)

Branch `art3-integrate2` merges `art3-work` with `--no-ff`. Authoring conflicts retain the layered
`pictures` export and add D3 `work` metadata; runtime D3 code and the work proof are retained.
Generated conflicts were resolved by rebuilding every people2 output together. The original layered
export, people material, shader, animal sources and multiplayer wire remain unchanged.

Blender plain build: 1087 s, 235 clips (97 D2 and 36 D3), 64 bones, one material. Both glbs contain
every declared clip; the plain intake has no required extension or sparse accessor. Replacement
preserved 1703 other model files and both manifests' other entries. Native fingerprint: `6ec774fa...`.
Build and preservation receipts: `.scratch/people2-integrate2-build/inventory.json`,
`.scratch/people2-replace-55b3476afd244c788618b02707f3256c/replacement.json`.

People proofs: `.scratch/people2-native-dda963720d6747118d18cdb74237cbbd/`.
Work, motion, captures, integration-captures, dress-captures, distance-captures, routing and parade
pass; all 1431 pictures were inspected using Photocraft contact sheets and full-size work views.
Carry/cask stance drift: 0.002/0.004 mm; parade: 0.0078642 mm maximum. D2: 150 s, 12 talk turns,
never both speaking, standing drift zero. Identity (7), pack (341 over 320 files), network (25) pass.

Animal proofs: `.scratch/animals-native-dac90b14b2994147884deec4b0f053de/`.
Slide (24 moving cases, maximum stance drift 2.32 mm), 774 captures, identity and network pass.
All 774 captures and four sun-test pictures were inspected through 27 Photocraft contact sheets.
Inherited animal follow-ups: faceted haunches/silhouettes and passing residents obscuring some lamp
views (`captures/lamps-dog_draught_brindle-1m-sit.png`); the animal geometry and capture code are unchanged.

Shader audit: `.scratch/people2-native-957a4d29342e40aebd2f24ebb8d09cc7/shaders/` passes with exactly
130 first-frame kinds, one people2 kind, 29 programs/cache entries, no problems, and unchanged
lights (one directional, 121 omni throughout clear/rain/fog). The runner now enforces 130 kinds.
Exclusive timing: `.scratch/people2-native-afda867edbc84621adfd9201ce4fe591/timing/` passes at
Vismarkt/Grote Markt: people + animals means 0.849/0.730 ms, town logic means 0.891/1.043 ms;
198 isolation samples, no other Godot engine. Animal updates still have isolated 42.068/20.554 ms
maxima; the mean gate is unchanged and passes.
Legacy timing also passes (0.822/0.524 ms people + animals; 187 isolation samples, zero overlap):
`.scratch/people2-native-3cba8808a621435696af0c398843979b/legacy-timing/`.
Animal shader/timing modes also pass: `.scratch/animals-native-ad780eb10b3047a9acc79fd33e23a102/`
and `.scratch/animals-native-c2e5eed833b34e8d8e69db1954883379/`. Shader inventory is again 130 kinds;
combined CPU means 0.717/0.485 ms, logic 0.853/0.817 ms, 196 isolation samples without overlap.
All 14 people2 modes and all six animal modes pass; all 2245 PNGs were inspected. Test data is removed,
proof logs and pictures remain under `.scratch`, and all engines started by these runs have stopped.

No merge-specific visual defect found. Art follow-ups: coarse faces and pale body-only exhibits,
police/Sooi waist and vest gaps, fishwife shawl edges, flattened broom bristles, missing gutting knife
(no native model), and dim work views away from lamps. See `work/day-gut-3m.png`,
`work/day-sweep-3m.png`, `captures/day-police-1m.png`, and the work lift/pass sequences.
