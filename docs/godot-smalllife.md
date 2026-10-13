# Native small life (package H)

`build_smalllife.py` and its independent `smalllife/` kit author sixteen metre-scale kinds: hen,
cockerel, goat, mallard/female/young ducks, adult/young swans, goose, squirrel, songbird, pigeon,
sparrow, jackdaw, crow and rat. Dogs, cats, pigs and horses retain their separate authoring kits.
The hen uses CDmir's CC0 Chicken (animated); the rat uses Sean Buckley's CC0 Street Rat. Their original downloads,
licences and file hashes are preserved in `art-source/third_party`; `smalllife/cc0.py` adapts their scale, rig weights,
UVs and smooth normals, with 1024 px donor colour/normal pictures. The other kinds keep the original kit.
Original photographic feather/fur sources, exact imagegen prompts and source-file hashes are in
`art-source/smalllife/pictures/`; the painter adapts their detail to anatomical UV cells and species
colours. Every delivered 1024 px colour/normal pair is hashed in the native `kit.json`.
The two retained source sheets are 1254 × 1254 px, generated with the built-in imagegen tool.

## Build and intake

```powershell
pwsh -File native-godot/scripts/build-smalllife.ps1
pwsh -File native-godot/scripts/replace-smalllife.ps1 -Port 8990
pwsh -Command "& ./native-godot/scripts/check-smalllife.ps1 -Modes @('captures','integration','trace','shaders','timing','identity','network') -Port 8991"
```

The source GLB retains sixteen weighted skins and 96 named clips. The plain intake contains
only their common rest surfaces; weighted bone matrices and inverse-transpose normal matrices
are baked into compact half-float palettes, so instanced wildlife needs no runtime skeleton copies.
No GLB, Blender, Node or rebuild is needed during play/export. Palette files use `.bin`, already
included by both native export presets and the content fingerprint.

Replacement backs up only this kit's scene/resources/extras and restores both manifests on failure.
It checks hashes of every other stored model and all other manifest entries. Its authoring-only
LOD pass simplifies indices without changing positions or encoded skin weights; the game reads
stored LODs. Courtyard permanent IDs, scene placements and editor layouts are retained.

## Runtime

`SmallLifeKit` prepares shared pictures/materials/palettes and fixed buffers during loading.
Courtyard copies are pooled; hens/cockerels retain the existing hen IDs and goat ownership/motion
messages. Cockerels occupy the stable `:0` slot of each three-bird courtyard group. Size variation
comes from IDs. Park ecology and pigeon flock behavior remain native; their geometry uses the new
kit. `SmallLife` seeds three sparrow flocks, 26 jackdaws, 12 crows and eight rats from native fronts,
roof ray hits and checked wall runs. Roof birds forage on native ground and fly back to shelter.
These cosmetic haunts add no multiplayer fields or entries to `Humans.Motions`.

The existing people2 shader gains an optional bone-palette branch, disabled for ordinary people
and the other animals. Small life uses its plain-picture path, linear anisotropic mipmapped BC7
colour and BC5 normals. No lighting is added. Existing cotangent reconstruction follows the
posed surface, so normal-map details rotate with the skin. UV bone selectors keep padding away
from integers and normalize weights after decoding: native UV quantization previously selected
the preceding bone for zero weights. Geometry checks cover that regression, finite unit normals,
nonzero triangle area, all source clips, image hashes, joint reach and world-space stance contacts.

Silhouettes use rounded lofts, longitudinal body splines, feather vanes and real horns, ears,
cloven hooves, toes, tails and whiskers. Feather/whisker/claw/horn tips remain naturally thin or
pointed; loft ends have rounded caps, and tube tips are closed. Neck sections follow their curve.
Feather vane lips remain naturally thin at 0.1 mm; upper and lower faces have opposing normals.
Ear cartilage is 2 mm thick with a closed 1 mm rounded rim. Decorative wildlife adds no physical collider; existing ground,
water, courtyard clearance and wall-run rules govern it.

## Proof scope

Captures show every kind at 1/3/8 m (camera gaps measured from rest-surface bounds), fronts,
sides, low backs, tops and action poses, plus eight-phase gait/flight strips; clear/rain at 13:00
and lamplight at 19:30. Integration views use actual native haunts, not exhibit placements.
The trace visits one representative of each live species first, then stable shuffled haunts.
It measures town/park/courtyard/pigeon updates separately, including MultiMesh uploads.
Park logic updates every frame inside 12 m, every second frame to 25 m, every third beyond,
and once a second beyond 160 m; bone playback remains continuous from the clock or distance.

Trace and people timing require a quiet start and reject any other Godot engine throughout
measurement. Loading garbage is collected before the warmed trace; all subsequent GC events
and raw wall times remain recorded and counted against its strict 1 ms gate. People timing
includes the new small-life cost in the unchanged 1.5 ms mean gate. Pictures, logs and rejected
attempts stay in `.scratch`; disposable saves/settings/layouts are deleted by the runner.

## Evidence (2026-10-13)

- `.scratch/smalllife-geometry.json`: PASS, 16 skins, 96 source clips, 16 plain native surfaces,
  no runtime skeletons/clips, finite unit normals, no zero-area triangles, 1024 px picture pairs.
  Source joint/stance checks use a 0.01 mm tolerance; this measures authoring, not GPU half-float precision.
- `.scratch/smalllife-native-53f4e4a83a334f928eab53ba44f1715e/captures/`: 1,120 pictures reviewed
  in Photocraft contact sheets (288 day, 288 rain, 288 lamps, 256 gait/flight phases).
  Goat-only rim retakes: 70 pictures reviewed in `smalllife-native-8f0b26dcf57940eaa72f6f4bca025a2f/captures/`.
  The other fifteen source meshes retain byte-identical vertices, normals, UVs and indices
  (`.scratch/smalllife-rim-preservation.json`).
- `.scratch/smalllife-replace-27d30cc9613e47cf85cb2b4ed8428216/replacement.json`: 1,996 other files
  and all other model manifest entries preserved; content fingerprint
  `60fd2d90bfd405c759577e4641018deaf4a2ae141e9f3b3d435ed9d9b7a2e08f`.
- `smalllife-native-99e2bca6e42d44e6ad7aa50d214e2e08/`: final identity 7 checks PASS, multiplayer 25 PASS.
  Pictures use 44,740,096 compressed bytes; decoded animation palettes use 1,864,704 bytes.

- `smalllife-native-9290e2bd23eb44668dc0c604e5b441eb/integration/`: 13 checks PASS, 33 live
  pictures reviewed. Six checks explicitly verify courtyard bodies are drawn at their state
  coordinates after approaching them. The first receipt photographed uninitialized pooled bodies
  at the origin and is superseded. Moving wildlife and other actors can still obscure live views;
  the frozen exhibit views above provide the anatomical review.
- `smalllife-native-ab2f8e7920604cd2bba4d52df89559ae/shaders/shaders.json`: PASS on the same
  shader/material configuration before the goat-only rim change: 130 kinds, one people2 skin
  kind, 29 stable programs/cache entries, no new kinds, six native preview lights.

Exclusive performance remains unverified. Other Godot engines repeatedly occupied the machine;
the final shader/trace/timing runner waited and was stopped before launching an engine. The earlier
shader receipt above remains applicable to the unchanged shader/material configuration.
The last rejected nonexclusive trace (`smalllife-native-034c*/trace/smalllife-trace.json`) measured
5,491 frames: mean 0.196763 ms, p99 0.406 ms, max 1.4574 ms, two frames at or above 1 ms.
It fails the strict gate and is not an accepted performance proof. No exclusive 1.5 ms people-plus-
animals mean receipt exists. Rerun `trace,timing` with all other Godot engines closed before acceptance.
All own engines/runners are stopped; disposable proof databases, settings, saves and layouts removed.

## Outside findings

- Existing `native-godot/assets/animal-pictures/*.png.import` presets are ignored and untracked.
  A cold native import uses uncompressed pictures without mipmaps; F5 then fails `Animal.Picture`
  on `cat_black_colour`. Local generated presets were repaired for proof runs; these other-kit
  files are excluded from this change. Reproduce with a cold checkout/import and F5.
- Native dock stock/litter can obstruct an exhibit camera although `NativeWalk.Free` reports it
  clear. See `captures/day-rat-3m-front.png` in the full picture receipt above. Front-quarter views
  still encounter some clutter; side/action views show the animals. No world asset was changed.
