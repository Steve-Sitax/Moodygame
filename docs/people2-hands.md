# People2 hands and holding, round four

`clips_legacy.HANDS` contains anatomical curls from a straight finger. `thumb_axes`
also measures each MakeHuman finger's resting flexion; `finger_turns` subtracts it
before keying. D1, D2, D3 and the hand preview share this convention. Fists and
pointing hands stop below 180 degrees of combined flexion.

`motion.fit_grip_surface` fits the actual weighted near mesh around each handle,
with 0.6 mm pad clearance. It searches the three finger joints independently and
caches the result per body, side and radius during authoring. The grasp axis is
below the knuckles, clear of the palm pads. The runtime receives ordinary keys.
Work arm solving preserves the limited wrist turn and solves the grasp position
again; it does not stretch the arm to cover an unreachable target.

Work metadata includes `handContacts`: two wrist frames at 24 Hz, relative to the
held object's frame. Rope and partner poses use the person's frame; cask palms
use the unspun cask frame. `HumanLayers` interpolates them after stance and
attention layers and solves both arms analytically. `sack_walk` shares the hold's
left grasp while retaining the free arm's swing. Forearm twist and shoulder
helpers follow the corrected arms. Work props still use their existing models;
the crank reuses `trades/tr_rope_spin`. No shader kind or light is authored here.

The low lift lowers the pelvis 48 cm, shifts it back, holds the strain before the
rise, then dips and drives. The left ear remains held until the shoulder takes
the sack. The broom's upper end stays ahead of the abdomen. Native hips tracks
subtract the exported `locomotion.trackBase`, including its forward offset.

The basket's crown rests at the carrying elbow, with the palm on a fitted point
of the inner rim. The forearm retains its rest length. This arm layer applies
over idle, talk and walk; the free hand keeps clear of the apron at waist height.
Hands working or carrying another load put the basket away.

Men and women have eight standing idles; stout families also gained loose,
folded and behind poses. Permanent-id FNV buckets distribute the initial idle
bank without another avalanche hash. Attention fades between 12 and 15 m, and
the carrying pose applies to both meshes, so the LOD switch changes geometry
without abruptly dropping arm layers. `Humans.Motions` and wire data are unchanged.
The build matches far skin weights to the nearest near triangles, retaining four
normalized influences and all positions/UVs. This does not repair missing loops
or excessively reduced garment geometry: the far smock still breaks in the hip pose.

`--people2-hands-proof <isolated output>` captures work, basket motions, a twelve
frame lift at 0.25 s intervals, eight stable-id idles, and the 15 m LOD boundary.
It records live clock/weather and wrist, basket-crown and rim contact errors.
Run with `--people2 --no-ai --no-mainmenu --dev`, isolated `--db`, `--prefs`,
`--author-root` and `SCHELDEMIST_USER_DATA`, through the bounded engine helper.
Rebuild/intake and shader/network checks follow [godot-people2.md](godot-people2.md).

Art scope: this pass preserves cloth geometry and its edge notes. The cloth lane
owns `cut_body` and the damaged cuffs/collar; the reduced palm and finger surfaces
still show faceting in very close authoring views. Fresh animal PNG imports lack
committed GPU-compression presets on this branch; the proof's ignored local
imports were configured before running the native game.

Accepted contact proof: `.scratch/native-hands-35ac76153fc8418e82fb5ec1b60a168a/`:
77 native pictures, day/rain/19:30, 1/3 m, maximum wrist/rim/crook error 1.893 mm,
eight distinct permanent-id idles. Blender hand checks cover seven shapes on both
sides (no tip beyond the hand's back) and four 2–4 cm grips on both sides (zero
vertices inside, 0.6–0.8 mm clearance). Work grip error rounds to 0.00 mm.
Final intake `.scratch/people2-replace-5c29f4aba75948a493a271c0386131de/` preserves
1,711 other model files and both manifests' other entries. Identity (7), pack
(343 over 322 files) and network receipts are under
`.scratch/people2-native-cc479d4781b74e51accd5f8f7d6f04d1/`.

There is no accepted shader or CPU-timing result for this lane. Both strict shader
runs hit the unchanged four-minute deadline; even a 640×360 retake did not finish
under concurrent games. The timing runner's exclusive-start wait expired. The
1.5 ms mean gate remains unmeasured. The lead should rerun after the other engines
finish, alongside the merged cloth fixes. Inspection pictures and failed logs stay
outside git; test databases, settings, layouts and all engines started here are removed.
