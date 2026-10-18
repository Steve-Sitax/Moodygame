# Town fronts, step 3 · 18 October 2026

Issues #188 (near detail never shown; stains ignore the light), #176 (shutters), #175 (name plates and shop signs) and
#28 (landmark windows with nothing behind them).

## #188 The near detail and the stains

- Cause: each town block has near-only meshes (`city_X_Z_d_1..5`: sills, heads, shutters, window boxes, shop fronts,
  fanlight bars, 2.58 million triangles of dressed stone, their grime). The browser showed them while the camera was within
  60 m of the block (city.ts `DETAIL_NEAR`); the bake froze that switch as it stood at the moment of export. Three blocks
  near the bake's camera (`city_-1_0`, `city_-2_0`, `city_-2_1`, Braderijstraat) showed their detail at every distance;
  the other 24 blocks (117 of 132 meshes) never did.
- Now `NativeNearDetail` (called from `NativeTown._Ready`) shows all 132 and gives each a GPU visibility range: its own
  radius plus 70 m, with a 12 m dithered fade. A block's detail appears while its nearest part is still 70 m or more away.
  `--no-near-detail` keeps the bake's state for comparisons.
- Collision: detail within 3 m of its block's lowest point (plinths, quoins, door surrounds, shop fronts, cellar hatches)
  is solid as drawn, the dressed stone by its plain stand-in boxes; detail higher up (sills, heads, bands, upper shutters)
  is out of reach and gets none. The grime decals and the window boxes' flowers get none.
- The grime decal shader (`r000218.res`, used by `r000221`) drew each stain unshaded in its own colour times the day's
  overall light: on a wall in shade or by a lamp at night a stain came out lighter or blacker than the wall around it. It is
  now multiplied over the lit wall (`blend_mul`, read against a 0.55 wall), so it darkens the wall's own light: sun, shade,
  rain, lamps. Same shader resource, code changed in place (`scripts/repair-decal-light.gd`; the GLB path's
  `Grime.DecalShader` has the same code). Original: see `promotion.json`.

Checks (real town, disposable saves):
- Frame time unchanged (6.94 ms, the 144 Hz cap) in seven views; GPU +0.05 to +0.20 ms per view; primitives +0.4 to
  +0.7 million per view; video memory unchanged (the meshes were loaded before, hidden). Measured with the PERF-LOCK held,
  detail toggled in one session (`--stone-corners-detail-toggle`).
- Collision: 9,641,466 to 10.1 million triangles; stuck check PASS (seed 1873, three hours).
- Shader check: 150 kinds before and after; the decal kind changed code in place (baseline updated).
- The razed houses (536, 537) show no detail: their detail vertices carry the house's alpha and are cut with the rest.

Pictures: `188-detail-before-after-day.jpg` (a street with hidden detail, before and after), `188-stains-*` (brightened
for viewing only).

## #176 The shutters

- The bake's shutters were flat boards in each block's `city_X_Z_d_1` mesh: a 64-pixel atlas cell (4,2 louvred, 5,2
  panelled) on a front quad, and two 30 mm side quads for an open leaf. 7,730 leaves in 25 blocks: 4,959 open (beside the
  window, 55-85 mm off the wall), 2,771 shut (in the opening, 35 mm back); two heights only (1.815 and 1.868 m).
- One model per kind (`scripts/build_shutters.py`, numpy/scipy; `build-shutters.gd` makes the meshes with the engine's
  LODs): stiles 72 mm and rails 125/90/85 mm as separate chamfered pieces (3 mm arrises), 42 mm thick louvred leaves with
  38 slats at 45 degrees (1.5 mm arrises, housed in the stiles), 34/30 mm panelled leaves with two fielded panels a side.
  Five width buckets (open 0.32/0.385, shut 0.45/0.56/0.70 m); a copy is stretched at most about 10 % across. The leaf
  looks the same from both edges, so a leaf hinged on the other side is the same model turned round, never mirrored.
- Iron (the town's wall iron `r000615`, no shader change): strap hinges with a rolled eye, a round end and three domed
  nails on the bottom and top rails; pintles with a cap on a square arm leaded 40 mm into the wall; a pivoting shutter dog
  in the wall over the free edge. A tipped leaf on a worn house hangs from its top hinge only and has no dog. The iron
  casts no shadow (a few centimetres across; it saves the shadow pass's draws).
- Paint (`scripts/shutter_paint.py`): a 2048 x 1024 painted-wood picture with its height map: lead white with brush marks
  and the wood's figure, the left half a kept house's paint, the right half a worn house's flaking to grey weathered wood
  with primer round the flakes. Two copies of the town's wood material (`city_wood`, same shader: no new kind) read the
  halves; a house over alpha 0.6 gets the worn one and its colour fades a quarter toward grey. Each copy carries its house's
  paint (the bake's vertex colour, brought to the old tone: measured in the game by day and at night).
- `NativeShutters` places them from `world/town/facades/shutters.json` (`repair-shutters.py`): MultiMeshes per block and
  model (307 for the leaves, 75 for the iron), each with its block's near range. A razed house's leaves go with it.
- The flat boards were taken out of the 25 `d_1` meshes (35,296 triangles; 2,264 left: other small fronts' pieces) with
  `facades-promote.tscn`; each leaf's plain collision box was added to the mesh's stand-in (92,760 triangles; only those
  within 3 m of the block's foot are used, see #188). `promotion-176.json` has every original and installed hash; the
  originals are kept outside the repository and in git at the commit before this one.

Checks (real town, disposable saves):
- Pictures: `176-*` (before and after, day; rain and night installed). The tone matches the old boards by day (84.6 against
  81.6 grey on the leaf) and at night (12.2 against 10.6). Rain does not darken the paint (the wood shader has no wet
  term; the old boards on the wall shader did).
- Timing with the PERF-LOCK held, but two other helpers' game windows were running, so frame times are not comparable
  (about 20 ms in both states): GPU +0.04 to +0.22 ms per view, draw calls +43 to +141 (shadow passes included).
