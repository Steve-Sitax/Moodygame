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

`Human2` samples clips by bone name and blends locomotion at a shared heel phase.
`HumanLayers` caches attention, cloth springs and foot stance correction, stopping near
layers at 15 m. Main's animation snapshots and phase-controlled rider behavior remain.
`People2Faces.SetFace` resets omitted weights without clamping. Stable resident IDs feed
FNV-1a identity metadata immediately after spawn, including pooled bodies. Face IDs are
integration metadata; this port does not invent the pending face-type schema or artwork.

## Verification

```powershell
pwsh -File native-godot/scripts/check-people2.ps1
& ./native-godot/scripts/check-people2.ps1 -Modes dress-captures -Port 8903
& ./native-godot/scripts/check-people2.ps1 -Modes legacy-timing,timing
& ./native-godot/scripts/check-people2.ps1 -Modes routing
```

The routing fixture verifies the map overrides, all fourteen body/kind roots, the
16/64-bone off/on switch and the face setter/reset contract.

The runner builds/prepares once, uses ports 8900–8909 (default 8903), disables AI and writes evidence
under `.scratch/people2-native-*`. Each process has separate saves, settings, layouts
and static cache, a 420-second timeout and guaranteed shutdown/data cleanup.
Timing rejects other running Godot engines before and throughout the run. An inert
failed-launch dialog titled `.NET assemblies not found` has no game loop and is
excluded explicitly in the isolation receipt. Engine errors,
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
