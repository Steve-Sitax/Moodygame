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
