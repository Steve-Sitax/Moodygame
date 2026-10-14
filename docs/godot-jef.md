# Jef: local people2 appearance

`Player/Arms.cs` owns two copies of one explicit MakeHuman recipe. The camera copy keeps the sleeve/arm/hand
triangles, original UVs, skin weights and normal maps; its shoulder cuts stay behind the near plane. The full
copy uses visibility layer 19, excluded only from Jef's eyes and included in the existing planar cameras.
Neither copy changes collision, authored object placement, permanent ids or remote puppets.

The native sampler supplies idle/walk/run, crate, cart, rowing and stair motion. Local arm IK adds give/take,
lantern, ladder, vault and swimming targets, with eased target changes and a small turning lag. Existing work
clips supply finger grips. Goods pickup, handover and set-down trigger the short gestures. Crate grips use the
actual shared model's bounds and grip sockets; the carried crate sits 8 cm higher and 14 cm closer than before.
Rowing follows the rower's authoritative local stroke phase. The body also follows sitting and sleep state.
Empty hands stay out of sight while standing, walking or running. A quarter-second eased lift brings them
in for actions and lowers them again afterward. The velocipede uses its actual steering grips; carts and oars
also supply their world grip points. The swimming body's eyes stay anchored to Jef's camera.
Camera gait amplitude is 8 mm walking / 10 mm running, 6 mm sideways and 0.0015 radians roll at full bob preference.

Nine collision probes contract the camera rig immediately near a wall, including the first frame after a
teleport. A local instance parameter in the existing skin shader also pulls the rig's projected depth forward,
preserving its own depth order and covering thin overhangs between probes without a second shader kind.
The existing four-slot lantern pool now includes Jef; his slot alone may cast shadows when the
existing preference permits it. World light counts do not increase. The lantern instances share the same
reusable glass/frame/halo resources as NPCs. Its iron frame now includes a bail, round cage rods and rolled rims.

## Character screen and storage

`CharacterPreview` creates a private 3D viewport with two directional preview lights, drag rotation and a
throttled mesh update during slider drags (at most one every 80 ms). Its body uses the same factory as the game.
`Character.Shapes` exposes twenty MakeHuman controls, with curated bounds inside `peopleSliders.json`'s
player ranges. `People2Faces.PlayerSlider` displays the actual preset default, rather than a misleading zero.
The existing sex, age, build, skin, hair, clothes and period palette controls remain; beard and moustache can
be selected separately. Age drives `face_age`. The minimum player age remains 16, so a young player uses adult
proportions rather than a prepubescent child mesh.

Optional `faceType`, `sliders`, `beard` and `moustache` fields live inside the existing profile JSON. The native
service preserves them, validates known ids, clamps/rounds controls to hundredths and discards unknown sliders.
Empty extensions are omitted, preserving the legacy profile fixtures and appearance code. Explicit zero slider
overrides are retained, since a preset's default may be nonzero. Both game rigs refresh after loading/replacing
a world and after the character screen saves. See [the network proposal](jef-look-network.md)
for a future remote representation; no remote packet, roster field or motion number changes here.

## Clothing intake boundary

The separate clothing lane supplies `jef_<cut>` kinds. The runtime recognizes `jef_shirt`, `jef_jacket`,
`jef_coat`, `jef_smock`, `jef_blouse` and `jef_shawl` when the native rig/parts contain them. Until that intake,
the fallback uses the plain work-shirt `docker_a` on `man_middling`, `wife_a` on `woman_middling`, or the existing
old dressed body at 58+. Build controls shape that same mesh; the player's palette applies locally to skin,
hair, linen, wool, lower garments and footwear. Rest-space regions travel in UV2, preserving the original texture
UVs and keeping a raised sleeve in its shirt colour. Fallback hats and garment silhouettes remain those of the kit;
the clothing lane's selectable hats/cuts still need their intake. No people2 Blender authoring file was edited.

## Geometry notes

The arm mesh has no newly exposed world edge: its open shoulder cut is a deliberately hidden mating boundary.
Existing sleeve hems retain their source thickness and UVs. The lantern bail/rods have 2–2.5 mm round sections;
rolled lips round the iron base/cap perimeter. The four thin horn panes and sheet roof joints intentionally
retain planar edges. The base, rods, rims and roof share the existing iron finish. No collision is added to a
held lantern, and no new shader kind is introduced for palette choices.

## Reproduce

Run `native-godot/scripts/check-jef.ps1 -Mode jef -Port 9140` for isolated AI-off captures, live-slider interaction,
four profile save/readbacks, walking/running sequences, wall contraction, shared-crate socket error, planar
reflection and lantern shadow. `-Mode menu` runs the complete existing menu test. `-Mode inventory` records a
startup material inventory; `-WithoutArms` provides a control. Use `check-people2.ps1 -Modes shaders,timing,identity,network
-Port 9142` for the exclusive shader/timing and native content/network gates. Logs and images remain in `.scratch`;
the runners remove their test database, preferences and layouts and stop their engine processes.

## Verification status (2026-10-14)

The 69-image native proof passes: empty hands hidden, four profile round trips, no duplicate props, wall guard,
crate grip error below 0.001 mm and swimming eyes aligned to the camera. Profile regression (754 checks), content
identity (7), dedicated network (25), menu (66 steps) and the branch launchers' full test (5) pass.
The shader audit reports zero new kinds/problems, one people2 kind, 38 programs and unchanged world lights.
Its strict 130-kind gate still fails at 131, also reproduced with the base shader/lantern and no local rigs.
Performance acceptance remains open: concurrent worktree engines contaminated the reruns after the hidden-rig fix.
The 1.5 ms CPU gate and 130-kind gate remain unchanged. Detailed local receipts and control paths: `.scratch/report.md`.
