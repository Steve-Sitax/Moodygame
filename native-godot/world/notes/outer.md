# Outer district recovery

Snapshot: main `6b447c1`, town export made 2026-10-12, SHA256
`ac8534149415142120f325986c7abd3818c38005206d45354f1ebb2619f3a7d9` (977933624 bytes).
Treat the original town and model packs as read-only. Native scene edits and player layouts take precedence.

Four `recovery/full/outer-*.json` manifests partition the wall/gates, park/prison, southern/eastern streets and
visual hinterland. Source indices verify this snapshot; permanent semantic ids survive later source replacement.
Parent-linked selections remain within their original shared hierarchy. City tiles, tree batches, `churches`
and `mills` have one runtime copy. Centre owns church shells; outer owns park children 1153–1160 only.
North owns Oostershuis and mill `led_dray` 3629. Outer owns the other mills children and south/east shop groups.

Run `python native-godot/recovery/full/outer-validate.py <town.glb>` from the worktree root. The initial read-only
partition check passed 192 assertions for fingerprint, ownership, rooms, door markers and hidden templates.
This evidence does not replace rendered native scene, physics or gameplay checks.

Prison root 1235 has 198 opening markers and seven door markers, including gate 1303, governor 1322/1343,
wing doors 1385/1438 and chapel doors 1474/1475. Keep `liveClock` on 1246. Rooms 9493/9755/9781 retain fog,
lighting and opening metadata. Keep park keeper template 3683 hidden until its live game system owns it.

The material edge rule in root `AGENTS.md` applies to every exposed solid edge. Leaf/grass/ivy cards, glazing,
thin sheet lips and fitted hidden joints are explicit construction exceptions. Preserving a source mesh is
not approval to leave sharp stone or cast-iron silhouettes. Inspect day/rain/night, backs, lower faces and corners.

## Native navigation

`NativeWorldNavigation.Build(nativeTown, bounds)` rasterizes semantic floor triangles at 0.25 m, then applies
`Solid.Footprints` and actual native authored collision shapes. It uses no baked walk dump or per-cell physics ray.
Support connected to native ground can reach ramparts by stairs. Arbitrary roof/prop tops do not supply ground.
Quarter-metre heights check route links; `Crowd.NavGrid` cannot step across a cliff or straighten a route over it.
Existing baked-map route behavior stays unchanged. Native room grids remain separate for multiple floors at one X/Z.
`Ways.InstallNative(map)` uses the same scene grid for long routes and height checks, replacing runtime walk.png.
The independent fixture passed 23 stairs, cliffs, roof, prop, overhead, shore-margin and route assertions.
Root's subsequent quay/plank seam fixture passed 26. Static route support ignores temporary bodies; Crowd still
checks live bodies. Root's concurrent-body fixture passed 4.61 million queries while body counts crossed bitset words.

For newly authored floors, set `native_nav_surface` true and explicit `native_nav_min_y`/`native_nav_max_y` where
needed. Hide/disable a template before navigation builds. Rebuild the map after persistent scene/prop changes;
live vehicles and people use the existing registered body system. Raised bridges keep their live blocking rule.

Prison's local plan has five levels at 0, 3.6, 7.2, 4.2 and 5 m, a 0.1 m floor offset and eight stairs. Good gallery
support samples are world (-336.31791,3.7,187.04934) and (-336.31791,7.3,187.04934), both local (13,18.3).
They require indoor floor navigation, not the outdoor map's single ground height. The first stair runs along local
Z 13→9.6, X 1.3..2.2, Y 0→3.6 with 0.18 m risers. Preserve clear headroom and stair supports during edits.

Steen's city ground stays at Y=0, but exact source triangle probes show `steen_blue` 1976 supplies the raised ramp
and terrace: mid Y=1.0289, bend Y=2.0948, gate/terrace Y=2.2. `NativeSteenRamp.Create(cityJson)` stores an explicit
hidden walking-support mesh for that area. It draws no duplicate floor and defaults to no duplicate collider.
Keep the existing stone floor/collision; do not admit the entire Steen building as ground. Its persistent anchor
is `steen:outdoor-ramp`. An optional helper collider is for a future replacement of the actual floor only.
Park wildlife also needs native habitat/perch data, replacing runtime reads of client park_plants.json and shared
parkTreeLife.json. The model/instance templates alone do not restore animal behavior.

`NativeTown` reads durable SQLite resident records, exposes the complete public town, shares the C# schedule/
whereabouts sum, applies event closures and storm tavern hours, and finds routes through the native scene grid.
Its isolated memory-database proof now passes 1634 contract, schedule, privacy, closure, route, lag, conversation,
door-life and prison assertions, including original TypeScript reference outputs for 209 door plans/465 segments
and 1344 prison clock cases. The reference JSON fixtures run without a Node process.
`NativeTownTalk` has full conversation, opening, choice and reply hooks for story modules;
`NativePrison` initializes custody before the first public town load and restores original homes/days on release.

## Native rules and generation

`NativePark` owns daily reachable droppings, claimed rounds, actual scooping delay, the one daily wage, bird feed,
keeper cleanup and resident dog cooldowns. Twenty-eight original scatter layouts and three existing household dog
walkers match the TypeScript references. `PositionOf` checks the actual player; bots cannot use a claimed pile.

`NativeLandmarks` derives five interior populations from schedules and entered events, including civil weddings,
requiems, the register, theatre society, museum and staff. Its 2423 checks compare 1344 clocks, 1050 full rosters,
wedding/funeral entry/departure, chair/candle money and cathedral running consequences. Confession input stays in
local memory, behind the original text gate; narration is asynchronous and falls back to engine words/penance.
`NativeTownProfile` and `NativeTownArrival` pass 754 profile, appearance-code, text-gate, persistence and ferry checks.

`NativeTownPopulation.Generate(seed,size)` reproduces eight complete original base towns across two seeds and four
sizes, including households, stats, dogs, schedules, markets, sentries, paired soldiers and customs. Production uses
current native `Ways`; recorded source navigation in fixtures is only reference test input. House doors are derived
from authored `city_build` fronts and current reachable ground, with permanent house numbers and kept-room slots.
`Rebuild` is for a fresh new-game state, clears preceding generated people/augmentation records, and runs `Augment`
callbacks in source order. Ordinary launch/load keeps existing identities. Press and landmark staff additions use
actual home selection. The complete chain is installed by `NativeTownPopulationLifecycle` on a host new week:
town/garrison, press, homes, lamps, visitors, emigrants, landmarks, bike, cart, transport, lively, night, shops,
neighbourhood cafés, back streets, standing roles, rampart people and mills. Settings change the next new town's
size, while event size takes effect immediately. Guests cannot change population settings.

The whole-chain fixture passes 168 checks against eight complete original cold towns (seeds 1873/901 × four sizes),
including every resident, NPC label/faction, persisted augmentation record and stage count. Totals range 430–1195.
Source navigation recorded in `services/fixtures/population-lifecycle.json` is isolated reference input; production
never loads it. Run `services/check-outer-population.ps1 -Proof Lifecycle` without replacing a running game assembly.
Add `-RefreshLegacyOracles` only during recovery to execute the original TypeScript in isolated memory databases.

`NativeTown.PrivateTown` recomputes reachable activity anchors on cache rebuild, using saved anchors as source input
before replacing them; it does not rewrite a save. Centre's full Homes/Night and Shops/Cafés fixtures passed 96 each.
Long route precomputation runs outside the database gate, coalesces requests and rejects a replaced town revision.
`NativeRoutingProof` passed eight checks including simultaneous responsive state requests and full town routing.

Fresh possession selectors derive owners from current residents and clear native parking geometry. The transport
fixture passes 136 checks across eight towns, 26–46 household vehicles and 61 boats, weekly errands, source prompts,
idempotence and unchanged households. Bike/cart workshops pass 56 checks. Their providers must be connected to
Deeds/Rowing/Transport, otherwise fallback seed data would retain preceding owners after a new week.

Street-lamp tours use actual visible native lamp facts captured after district overlays. Source IDs survive; placed
lamps use `authored:<district>/<ObjectId>`. `townlife_lamps:topology` tracks ids/x/z/hung, so add/move/hide/load replans
only changed topology and keeps assigned men, held jobs and `lamps_help`. The independent lamp fixture passes 34
checks. Gang hand lanterns in Deeds are separate objects. Centre's LampJobs reads these current street rounds.
`NativeStreetLighting.At` supplies Deeds visibility from those same rounds, fog turns and held/lit job lamps;
without rounds it uses supplied native lamp facts. Its 44,474 source/stateful checks cover day/night, fog windows,
deadline/day changes, strongest/range light, authored ids and equal-count position edits. Backend calls read data,
not scene Nodes. `services/check-street-lighting.ps1` runs the isolated proof without changing the game assembly.

In-memory door normals retain signed zero for source atan2 directions. Persistent world/player JSON normalizes
negative zero to zero, matching JSON.stringify; the fixture verifies ordinary values and input signs survive.
Lamp walked-length memo keys are canonical but the first requested traversal supplies the actual length, as the
source does. Cold source modules are required for cold-fixture comparisons across seeds because that memo is shared
within an original running server. Native scene floor/prop changes still require navigation rebuilding.
