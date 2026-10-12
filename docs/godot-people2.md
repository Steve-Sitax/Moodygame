# Native Godot people2

People2 stays off by default. `--people2` selects the matching dressed kind from
`res://assets/game-models/people2.scn`; missing kinds use the existing native people scene.
The dev console accepts `people2 on|off` for later spawns. `p2:<body>` selects a base
body while enabled, and `--people2-map docker_a=man_middling,fishwife_a=woman_stout`
overrides routing. The multiplayer `Humans.Motions` list is unchanged.

## Authoring and additive intake

The kit keeps its filenames and internal layout under `art-source/tools/blender/people2/`.
It imports legacy pose functions from `art-source/tools/blender/build_people.py`.
Bodies, faces and clothes are unchanged by this port. Masters are
`art-source/client/public/models/people2.glb` and `art-source/shared/peopleRig.json`.
Blender check pictures go to `.scratch/people2-build/shots`, outside git.

```powershell
& $blender -b --factory-startup -P art-source/tools/blender/build_people2.py -- --plain .scratch/people2-plain/people2.glb
dotnet build native-godot/Scheldemist.Native.csproj
. ./native-godot/scripts/engine-tools.ps1
$engine = Resolve-WorkshopGodot
$intake = Join-Path (Get-Location) '.scratch/people2-intake'
New-Item -ItemType Directory -Force -Path $intake | Out-Null
$env:SCHELDEMIST_USER_DATA = Join-Path $intake 'userdata'
Invoke-WorkshopEngine $engine (Join-Path (Get-Location) 'native-godot') @('--rendering-method','forward_plus','--path',(Join-Path (Get-Location) 'native-godot'),'--log-file',(Join-Path $intake 'live.log'),'res://recovery/recover-game-models.tscn','--','--source-models',(Join-Path (Get-Location) '.scratch/people2-plain'),'--resume-intake','yes','--only','people2','--author-root',(Join-Path $intake 'layouts')) (Join-Path $intake 'engine.log') 180
```

Set `$blender` to the installed Blender 5.2 executable. Run Blender with a process
timeout (25 minutes for the full build) and restore the environment after intake.
Use disposable data/layout directories; retain logs and delete only those test data.
The plain GLB has dense morph accessors and ordinary geometry. It replaces the retired
Node decoder; there is no decoder or GLB import during game startup or export.

Intake adds one scene plus `people2-resources/` and `people2.extras.json`, merging
`intake.json` and `full-intake.json`. It refuses to replace an existing stored scene
or resource directory. A repeated identical intake checks the source hash and keeps
native edits. Existing scenes, authored placements and permanent IDs remain intact.

Copy the authored rig to `native-godot/world/data/shared/peopleRig.json` and register
`shared/peopleRig.json` in `native-godot/world/data/manifest.json`. Future
`faceTypes.json` uses the same registration when its schema and art are delivered.
`prepare-native-package.ps1` writes SHA256-addressed immutable blobs, updates the loose
cache version and fingerprints shipped resources, data and runtime source. `Paths.Shared`
reads the extracted data cache. Host and guest must agree on this content identity.

## Runtime contract

`People2Material` uses `ModelLibrary.NativeScene` before ordinary material conversion.
It preserves source normal maps and near-copy morphs, removes far-copy morphs if needed,
and shares prepared materials. Colour mipmaps filter in linear light; normal mipmaps
renormalize linear vectors. The shader is read with Godot FileAccess, including in PCKs.
One spatial shader kind covers sun, sky, fog, existing lamp/window spill and normal maps.
No light counts change. A hidden mesh reference includes the kind in the first-frame audit.

`Human2` samples clips by bone name and blends locomotion at a shared heel phase.
`HumanLayers` caches attention, cloth springs and foot stance correction, stopping near
layers at 15 m. Main's animation snapshots and phase-controlled rider behavior remain.
`People2Faces.SetFace` resets omitted weights without clamping. Stable resident IDs feed
FNV-1a identity metadata immediately after spawn, including pooled bodies. Face IDs are
integration metadata; this port does not invent the pending face-type schema or artwork.

## Verification

```powershell
pwsh -File native-godot/scripts/check-people2.ps1
& ./native-godot/scripts/check-people2.ps1 -Modes legacy-timing,timing
& ./native-godot/scripts/check-people2.ps1 -Modes routing
```

The routing fixture verifies the map overrides, all fourteen body/kind roots, the
16/64-bone off/on switch and the face setter/reset contract.

The runner builds/prepares once, uses ports 8890–8899, disables AI and writes evidence
under `.scratch/people2-native-*`. Each process has separate saves, settings, layouts
and static cache, a 420-second timeout and guaranteed shutdown/data cleanup.
Timing rejects other running Godot engines before and throughout the run. An inert
failed-launch dialog titled `.NET assemblies not found` has no game loop and is
excluded explicitly in the isolation receipt. Engine errors,
nonzero exits and failed JSON reports fail the runner.

Captures show docker_a, fishwife_a, police and sooi at Vismarkt, at 1 m and 3 m,
at 13:00 clear, 13:00 rain and 19:30 beside an existing lamp, with low rear views too.
The capture checks the live clock/weather and camera position. Inspect the PNGs.
The parade samples blend_walk, idle, walk and talk. Ordinary `--snap <dir> --views ...`
also works on `res://town.tscn`; use `--no-mainmenu` for automated snapshots/parades.

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
