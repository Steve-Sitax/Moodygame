# M3f - City detail pass, work log (2026-09-23, in progress)

Why: Steve's requests after M3d (ground variety, trees, rails, ships, a working lock, a living city, cathedral detail, 10 detail ideas), and his checks in the browser during the work. This is a log for reference; the milestone note comes when the batch is committed.

Nothing of this is committed yet. Last commit: 12d5bce (M3d).

## Done by main
| What | Where | Notes |
|---|---|---|
| Ground zones | `tools/city/plan.py` ground_zones, `world/city.ts`, `cityTextures.ts` | earth (quays near open water), flags (squares), cobble (streets); earth texture without the repeating rut lines (they showed as bands) |
| Trees | `build_city.py`, `cityTextures.ts` leafTexture | autumn leaf texture, no more white crowns |
| Kerbs, gateways | `build_city.py` | kerb 0.12 m, darker; gutter strip removed (it z-fought); carriage gateways in 22% of wide fronts |
| Quay railway | `design.py` DECOR tracks/crane_rails, new `world/tracks.ts` | one line along all river quays under the portal cranes (z 4.0), S-curve to the lock bridge, a loop round the Petit Bassin, a loading siding on the Rijnkaai; filleted curves; setts band with polygon offset (no z-fight); crane runways (gauge 5.2 m); cut out over every bridge rect (bridges carry their own rails); cranes moved to z 4.0; lamps and crates moved off the line; the Werf railing dropped (cranes there) |
| NPC path finding | `game/crowd.ts`, `rijnkaai.ts` solids() | the crowd's A* grid now closes cells round every solid (crates, carts, crane legs, lamps, tree trunks), rebuilt when solids change; stuck check (no closer to the waypoint for 2.5 s: block the cell ahead, plan again) |
| Readable HUD | `style.css` | everything scaled by --ui (1.3 to 2.2 by window width); long text in Georgia; bigger small print |
| Needs box | `game/pockets.ts` | rows with words: Food, Warmth, Sleep, Health; low needs in red |
| Wheel ruts | new `world/ruts.ts` | cart roads found on the walk map down the middle of streets (A* with a wall-distance cost), smoothed, painted as two ruts and a horse line, faded at the ends |
| Rain weather | `server/src/day.ts` (+ test), `api.ts`, `game/day.ts`, `rijnkaai.ts` | fog 35%, mist 30%, clear 20%, rain 15% |
| Puddles | `retro/psx.ts` option `puddles`, new `world/mirror.ts`, `city.ts`, `ambient.ts` | after Lagarde's wet surfaces: puddles in the ground shader where a tiling noise is highest (ragged edges), damp dark band, Fresnel between the ground under the water and a planar mirror of the street (GPU: the scene rendered from a camera mirrored in y = 0, oblique near plane, 320x180); fill from ambient: rain fills, fog/mist keep some, a sunny day dries them; earth 1.3x, flags 0.75x. The street-life flat puddles and ambient's decal puddles are removed. |
| Mirror bug (open) | `world/mirror.ts` | the ground mirror never drew: `renderer.info.render.frame` does not change in this game; fixed with a once-per-task flag (queueMicrotask). NOT YET CHECKED in the browser. Dev: `window.__mirrors` (calls, renders, why, error), `window.__psx`. Remove the dev fields before commit if noisy. |
| Cathedral materials | `city.ts` | `gilt` material; any `*_atlas` material in landmarks.glb gets a psx Lambert with its embedded map |
| Backlog | `docs/09-backlog.md` | velocipedes, theft and police (after the living city lands) |

## Done by helpers (wired in unless noted)
| Helper | Result | Wired? |
|---|---|---|
| Atmosphere (`world/ambient.ts`) | chimney smoke, gulls and pigeons, rain streaks, wet ground sheen, lit windows at night | yes (rijnkaai.ts; ground zones and quay copes `wet: true`) |
| Boats + lock (`build_boats.py`, `build_lock.py`, `world/lock.ts`) | working lock: swing bridge, mitre gates, tows pass; ships fancier (rigging lines, names, flags, smoke) | yes (createLock, onLockBridge in isWalkable/isWater, lock.update; static lock deck no longer built) |
| Street life (`build_streetlife.py`, `world/streetlife.ts`) | 120 shops with signs, bracket signs, awnings, corner Madonnas, pumps, troughs, the well, washing lines, plates, doorsteps, cellar hatches, grime, straw and dung | yes (after dressCity, avoid its colliders; update with camera) |
| Cathedral (`build_landmarks.py`) | detailed cathedral 9.2k tris, real portals (west 3, transepts 2, tower door), clock, 124 m spire, houses against it | yes (materials above); door positions in its report: central west (-262.0, 149.5) |
| Water (`quaysteps.ts`, `pier.ts`, psx water, `firstPerson.ts`) | WATER_Y -2.8, slime band, stone stairs (8 flights), 27 ladders, falling in, swimming (WASD 1 m/s, E at a ladder), detailed pier without gap, pontoon gangway, river mirror, `/api/swim` (-1 warmth, once a minute) | yes (by the helper, incl. main.ts toast) |
| Sound (`audio/soundscape.ts`, `emitters.ts`, `samples.ts`, 27 CC0 files) | carillon and hour strokes, ship bells, hooves and wheels, crane, smithy, market, taverns, rain, murmur | yes: clock and weather wraps in main.ts, setWeather in start(), setCrowd and setRain (psxUniforms.uRain) in frame(). Still to wire: setVehicles(traffic.info()) when traffic lands. Foghorn only in fog (mist horn 0, "rain" weather added). Steve should listen to the carillon tune, the market voices (Italian) and the tavern song |

## Still running (at the time of this log)
- **Sound helper again:** ship horns and whistles from ships passing on the Schelde (`setMovingShips(list)` from `boats.moving()`), lock and bridge signals, chuff/paddle loops; the foghorn never outside fog, silent until the weather is known.
- **Living city:** residents with homes, jobs, families, schedules; kids, dogs, cats, thieves at night; quest-givers with lights; shops with tarps at night; jobs on all quays; talk to everyone (stats and rumours). Writes `docs/milestones/M3e.md`. Told to route walkers through the crowd's NavGrid.
- **Quay goods and carts:** goods on the quays, `world/traffic.ts`; plus Steve's asks: a detailed handcart with natural motion (not glued to the hands, trailing hitch, wheels roll), more detailed crates (also the code crates in rijnkaai.ts).
- **Bridges and river ships (boats helper again):** opening bridges for the canal and vliet bridges (swing or draw), boats passing through, ships always moving on the Schelde (big and small, 1873), rails on the moving decks at z 4.0 and 17.5; one API `bridges.list` for walkability.
- **Landmarks (cathedral helper again):** the same treatment for the town hall, Vleeshuis, Steen, Hanseatic House, guild houses, churches; move the Handschoenmarkt well off the cathedral door.

## Open points
- Check the puddle mirror in the browser (a helper must look at the pictures: this chat's picture limit is full).
- Crowd on the lowered pontoon floats (crowd walks at y 0): take y from world.baseAt, or keep off.
- Frame cost with both mirrors: about 6.5-7.3 ms, 610 draw calls. Consider rendering the ground mirror every other frame or at a smaller size.
- The game clock moved on Steve's save during the work: that was Steve playing. Backups: `data/game.backup-ground.sqlite`, `data/game.swimtest.sqlite`. Do not restore without asking.
- Before commit: `npm run build` (unused names in helpers' files fail it), `npm test`, path check `[]`, browser check with sound off, docs note M3f, CLAUDE.md status, commit and push.

## Rules to keep (from Steve and CLAUDE.md)
- Plain English in game text; Dutch only in names. Engine owns all numbers. Model calls: 20 s timeout and a fallback.
- Never lock the pointer or set freeInput in tests; after each browser check send the preview tab to /audio/kenney-impact/License.txt.
- Helpers use their own preview tab (preview_open, reuseExistingTab=false).
- End each hand-back with the test link http://localhost:5173/ after checking it answers.

## Later the same day (main)
- Storm weather (5 %), sea state uniform (waves, boats roll); dev endpoint sets weather; Dev menu on the pause paper (dev builds): time, weather, events, needs, money, go to.
- Settings: picture size, PS1 colour, wobble; dither, grain and wobble keep their 270-line size at any picture size. Restart button (asks twice; the server copies the old week to data/backups/week-<time>.sqlite).
- Pause screen: W/A/S/D, Space or Enter resumes (Esc cannot take the mouse back: browser rule); Esc closes the Settings and Dev panels.
- Puddles: value noise in the shader (no repeats), at most about a fifth of the ground even in a storm; wet stone darker, patchy, with half-metre glints (Lagarde); rain streaks fainter and only near (3-7 m); the far "rain curtain" was removed (it read as blobs).
- Clear weather: fog from 120 m to 480 m, a lighter bluer sky by day; the far bank of the Schelde (farbank.ts, z -290): dyke, trees, houses, a mill, the fort's ramparts. Camera far 600 m, water sheet 1200 m, sky 560 m.
- Relief painted into cobbles, flagstones and rail setts; bump maps on the ground (subtle in the soft fog light).
- Quay stairs bonded 0.4 m into the wall, a slab landing with an edge kerb, the parapet carried onto the landing.
- The Anna Maria is now a Blender brig (hold, cabin, gangway down to a deck at y -0.4); the old code ship is gone; a barque lies outside her. Water stencil lids on every hull: no water inside boats.
- Swing bridges replaced by lifting bridges (they clipped the quay).
- Sounds fall off with distance (bells, market, taverns, ships), the foghorn is below -9 dBFS.
- M4 (director, NPC actions, events, world_event log) is designed, not built: data/m4-draft/NOTES.md. Steve: finish the rest first, then M4 in a new session.

## 2026-09-24 (main)
- Cobbles: no pattern repeats. Each paving has a stone id map (paving.ts); the shader (psx.ts `relief.id`, `holes`) mixes the stone's number with the tile's place in the world, so each stone rolls its own height, tone, sinking or muddy hole. Rule: never bake a feature into a repeating tile; roll it in world space.
- Cart wear: dirt.ts writes a wear channel (green) along the cart roads (wheel lines hardest) and in the middle of every street. Worn stones lie lower and rounder, are polished a little lighter, and sink or go missing far more often.
- Omnibus: E on the back platform between stops jumps you off while it rolls (ride.ts). A ride left open on the server by a page reload is closed when the game starts.
- Litter layer (M3j filth, docs/milestones/M3j-filth.md) wired in: dung, straw, gutters, ash, fish waste on the market clock, heaps, floating rubbish, rats at night.
- Cranes (M3g4): no see-through parts, a caged ladder with a landing, a walkable gallery and cabin, CRANE_SPOTS for jobs.
- Het Steen: Steve chose the restored look of about 1890 (ramp, north wing, spires, battlements), and allows map changes if every dependency is fixed.
- Lesson: never junction node_modules into a temp worktree; `git worktree remove --force` follows the junction.
