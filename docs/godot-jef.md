# Jef: local people2 appearance

`Player/Arms.cs` owns two copies of one explicit MakeHuman recipe. The camera copy keeps the sleeve/arm/hand
triangles, original UVs, skin weights and normal maps; its forearm cuts stay behind the near plane. The full
copy uses visibility layer 19, excluded only from Jef's eyes and included in the existing planar cameras.
Neither copy changes collision, authored object placement, permanent ids or remote puppets.

The native sampler supplies idle/walk/run, crate, cart, rowing and stair motion. Local arm IK adds give/take,
lantern, ladder, vault and swimming targets, with eased target changes and a small turning lag. Existing work
clips supply finger grips. Goods pickup, handover and set-down trigger the short gestures. Crate grips use the
actual shared model's bounds and grip sockets; the carried crate sits below the centre of the view with both hands on its upper sides.
Rowing follows the rower's authoritative local stroke phase. The body also follows sitting and sleep state.
Empty hands stay out of sight while standing, walking or running. A quarter-second eased lift brings them
in for actions and lowers them again afterward. LEFT holds the lantern, RIGHT reserves a knife-ready action,
and BOTH carries or operates loads, carts, handlebars, ladders and oars. A right-hand action can coexist with a
left-hand lantern. Two-hand actions move the lantern onto the belt with an eased transition. The velocipede uses its actual steering grips; carts and oars
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

## Clothing and accessories

Sex, coat and apron select the fourteen `jef_<m|w>_<cut>` kinds described in [The player](people.md#the-player-kinds_playerpy-garments_playerpy-held_playerpy-2026-10-14).
The twenty controls override the face and build preset, including explicit zero values; age shapes the adult body.
Profile hats and boots/clogs replace the default shoes on their authored sockets. Hats follow the head-slider fit
table; capped hair stays beneath them. Preview, body and sleeves share the same profile factory and face cell.
Cloth colours use the authored per-texel tint masks, applied once to the stored sRGB colours and then mipmapped in
linear light. Buttons, soles and fixed linen remain fixed; plain shawls remove the check bars. The material keeps
the existing people2 shader and normal/detail arrays. No new shader kind or multiplayer field is added.

## Geometry notes

The arm mesh has no newly exposed world edge: its open elbow cut is a deliberately hidden mating boundary. Each open rim
is closed with a fan to its centre (`CapOpenEnds`), so a ladder or oar pose that points the upper arm at the eye
shows a closed sleeve rather than the inside of the tube.
Existing sleeve hems retain their source thickness and UVs. The lantern bail/rods have 2–2.5 mm round sections;
rolled lips round the iron base/cap perimeter. The four thin horn panes and sheet roof joints intentionally
retain planar edges. The base, rods, rims and roof share the existing iron finish. No collision is added to a
held lantern, and no new shader kind is introduced for palette choices.

## Reproduce

Run `native-godot/scripts/check-jef.ps1 -Mode jef -Port 9220` for isolated AI-off captures, live-slider interaction,
four profile save/readbacks, walking/running sequences, wall contraction, shared-crate socket error, planar
reflection and lantern shadow. `-Mode menu` runs the complete existing menu test. `-Mode inventory` records a
startup material inventory; `-WithoutArms` provides a control. Use `check-people2.ps1 -Modes shaders,timing,identity,network
-Port 9222 -WaitForTimingSeconds 2700` for the exclusive shader/timing and native content/network gates. Add
`-Extra @('--people2-player-timing','--people2-player-pose','lantern','--people2-profile')` from PowerShell to include
both local rigs, grip IK and collision probes in the free-camera crowd fixture. Sampling runs after the local rig;
its enclosing CPU scope subtracts the already counted Human.Update scopes. Logs and images remain in `.scratch`;
the runners remove their test database, preferences and layouts and stop their engine processes.

## Integration acceptance

The shader inventory uses main's 131-kind baseline (issue #136), with one people2 kind and zero new kinds.
The animation CPU gate remains 1.5 ms at both squares and requires an exclusive engine window. Final receipts
and inspected picture paths are recorded in `.scratch/report.md`.
The combined intake measured 1.467 ms at Vismarkt and 1.190 ms at Grote Markt with the local lantern rigs active.
Constant rotation curves are normalized once, and dense tracks locate their interval by checking the real key
boundaries around a calculated index. Key values, interpolation weights and animation frequency stay unchanged;
the native sampler proof compares these results with Godot's interpolation.
Re-run on 2026-10-14 after the hand-slot work: 1.282 ms Vismarkt and 0.998 ms Grote Markt (exclusive window), the
rotation sampler matches Godot to 1.8e-7 over 4,493,048 samples, shader audit 131 kinds with one people2 kind and
zero new, content identity 7, pack 343, native multiplayer and dedicated network, menu test and `test-icons.ps1 -Full` pass.
Known fault: in the ladder pose the sleeve cloth still clips the near plane at the lower corners.
