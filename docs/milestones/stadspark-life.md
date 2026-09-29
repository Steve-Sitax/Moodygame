# Stadspark: planting, water and park life

Worktree branch `codex/stadspark`, based on `cb118c8`; main and the live save remain separate.

## What changed

- 47 trees, including a veteran oak with a broad root flare and spreading scaffold limbs, three hanging willows, and fuller crowns on the existing young trees. 298 planted clumps include 61 flower clumps; the existing hedges and beds remain. Placement and the walk map are generated together; all 511 changed walk-map cells were within the park before the final placement rebuild.
- Two original generated concept examples and an eight-cell transparent foliage atlas. The actual generated cutouts are packed at 64 pixels per cell and embedded in the GLB. Prompts and provenance are in `assets/concepts/stadspark/README.md` and `assets/ATTRIBUTION.md`.
- The pond attaches to the existing water mirror, at its own -0.35 m plane. Its darker water, restrained waves and small ripple distortion preserve recognisable reflections of trees, houses, bridge and animals. The river keeps its original material settings; pumps retain their still water material. No additional reflection pass or dynamic light is created.
- Original instanced low-poly bodies and wings: ducks, swans, their young, geese, squirrels and small tree birds. The ecology starts with 30 waterfowl (including six geese), ten squirrels and six tree birds. Waterfowl feed, separate, evade people/dogs/boats and shelter in bad weather or at night. Geese also graze on the bank and squirrels pause to eat. Unfledged broods stay on their pond. Independent adults depart for verified canal/river destinations and float at the live tide level there.
- Cats use the existing pathfinder to stalk ground prey; mothers defend nearby young, and an unguarded duck can occasionally be caught. Capture has a cooldown and the animal is absent for four minutes, returning only out of sight.
- Squirrels forage, run to real trunks, climb, perch and descend. The oak geometry and its perches share `shared/parkTreeLife.json`, so squirrels and small birds use the modelled limbs. Perching birds also forage below the tree and fly back to branches; occupied perches are avoided.
- Three existing wealthy households gain dogs and afternoon park walks, retaining their own homes and identities. Nearby visitors can pause at the pond to feed grain and then resume their schedule. Park outings yield to heavy rain and storms.
- Dogs pause to urinate or defecate. The keeper clears unclaimed droppings and goes to an existing nearby doorway after work or in bad weather. The player can borrow tools, scoop ten reserved piles and receive 35 c once per game day. Positions, scoop duration, claims and payment are checked and persisted by the server. Feeding at the bank costs 1 c.
- Regenerating park paths exposed a shared-haul spacing failure: individual arrival times changed workers' phase on a round. Shared haul crews now use evenly spaced starts and a common working pace; their journeys to work still use their personal pace.

## Rendering and simulation

All park planting still merges by its two shared bark/foliage materials. Wildlife uses twelve instanced body/wing meshes and one shared material. Threat providers are sampled twice per second; distant ecology updates in coarse steps. Ground triangles are rasterised once for land tests. The new work props use shared materials, and droppings and job markers are instanced. No per-frame scene traversal was added.

The same bird/squirrel visuals, planting, water, visiting residents and cats run in the web demo. Persistent cleanup pay and purchases remain server gameplay, in keeping with the demo's existing no-interactions rule. Wildlife is ambient client simulation; shared droppings and money are server-owned. The new wildlife state and toilet pose are not network-replicated between PCs.

## Rebuild

1. `python tools/textures/stadspark_atlas.py`
2. Blender background: `tools/blender/build_park_plants.py` and `tools/blender/build_park_animals.py`
3. `python tools/city/park.py --plants`
4. `python tools/city/walk_only.py`
5. `python tools/city/park_check.py`

## Checks

Browser testing uses a disposable copy of the save on server 8951 / client 5351. The actual cleanup actions were exercised on ten piles: balance 0 c to 35 c, ten recorded cleanups, paid exactly once. Path and shader checks both returned empty problem lists. Targeted engine tests cover ownership, timing, repeat pay, cancellation, weather, real household dogs, flights, mothers, tides and tree anchors.

`npm run build` passes. The final full suite passes: 97 files, 1,370 tests. The purity check now clones the crew roster too, preserving the shared-haul calculation's complete input. The browser's paths and shader problem lists are empty, including the new park work/feeding points. A visitor was observed walking to the bank and scattering food. The demo build bakes 25 routes and all 15 event templates.

## Rendering handoff for the next session

The user explicitly plans a separate performance session; related existing report: [issue 32](https://github.com/Steve-Sitax/Moodygame/issues/32). No city-wide renderer changes were attempted here. A T3 browser run at 1280 x 800 with a 1152 x 720 render target used the same 30-frame warm-up, 90-frame turning sample and six-second walking sample as `tools/perfcheck.mjs`. These timings precede the final six geese addition. Its new `--report` option checks samples collected in the collaborative browser without launching another browser. `node tools/perfcheck.mjs --report data/perf/stadspark-preview.json --budget 16.7` correctly fails:

| Place | Walking mean ms | Turning mean ms |
|---|---:|---:|
| Park | 27.02 | 19.82 |
| Grote Markt | 23.29 | 23.54 |
| Cathedral | 23.13 | 23.21 |
| Handschoenmarkt | 37.72 | 25.14 |
| Vismarkt | 18.65 | 26.52 |
| Rijnkaai | 16.19 | 26.93 |

The unchanged `cb118c8` client was also run through the same browser/server/save: its warmed park turning mean was 18.57 ms (median 16.3 ms). Its live sample suffered a large startup/frame-scheduling spike and is unsuitable for a direct walking comparison. Treat cross-run differences cautiously; the warmed turning samples suggest roughly 1.3 ms extra for the richer park, rather than proof of a tightly controlled benchmark.

The renderer dominates. In the new park walking view the main/room pass averaged about 1,600 calls, with hundreds more in mirrors; `render` averaged about 21 ms in an earlier sample. `world.parkNature` averaged about 0.1 ms for its update, which excludes drawing. Investigate scene/draw submission and reflection culling/batching using `docs/performance.md`; do not report the 60 fps budget as passed. Raw measurements are local in `data/perf/stadspark-preview.json`.

The temporary baseline git worktree was unregistered, but its directory `../MoodyGame-stadspark-baseline` remains because automatic approval review blocked deletion, including a narrower junction-only cleanup. No save was made in that directory. The actual test save belongs to the Stadspark stack and is removed by its normal stop command.
