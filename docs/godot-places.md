# Godot places and work handoff

Implementation on `godot/play5`, worktree `D:\Code\MoodyGame-godot-play5`, from `577901c`. This owns the places/work rows in [the inventory](godot-play-inventory.md). Other helpers' rows and source owners were left alone. This is a working feature batch with the remaining parity gaps listed below.

## What players can do

- Sign Sooi's dock book with F, lift an ordinary dock load and put it at the route's destination with E. The engine pays by the piece (7 c in the test).
- Take and follow cart work through the ordinary jobs code. The engine lends the employer's cart and returns the loan when work ends. The cart-driving/loading controller is the play4 integration dependency. Errands continue to use the existing carry/deliver runs.
- Take the lamplighter round, collect the pole, wait until the engine's permitted time, raise it to each lamp and hold the lighting action. `Lights.I.SetLampLit` reflects the engine's state. Seven lamps paid 110 c and +1 trust; daylight lighting was refused (409).
- Help at a mill on the real rampart floor: answer two wind calls, lean on the capstan/chain for five seconds and remain at the post. The fixture pays 60 c and +1 trust. The wall chunks are restored before the body's map is built.
- Ask the park keeper for ten piles, hold E to scoop each, receive 35 c once, and feed the birds with G for 1 c. Repeating a finished pile is refused.
- Collect a parcel from a sleeping employer's named, lit work box; deliver it to the real recipient; leave proof and collect the engine's pay from the box. Held watch work and its task can be restored. The tested watch paid 80 c/+1 trust, parcel 100 c. Goods remain in the engine's pocket until settlement clears them.
- Read E home notices and select nightly/Sunday rent. The own key opens the actual door. E at the real bed opens the existing sleep chooser; the engine accepts home sleep and waking places Jef on the room's real floor. E at the existing hearth warms through the engine. Furniture uses the room grid, rotation, wall/window/door/bed checks and server placement; all ten kinds have models prepared at load. The test buys and places a 15 c plant and rejects an out-of-room placement. Stored/pocket/arms pieces are offered with F.
- Use the actual tavern/shop counters: tavern E talk/F drink, shop E buy/F talk. A numbered brown beer costs the server's 5 c. Sit at a free table/counter seat, see arrived existing Human patrons seated, use G to open the existing dice paper with a present partner, roll a numbered 2 c stake and stand with E. Occupied seats cannot be offered to Jef.
- Enter the real Poesje cellar in the evening, pay the server's ticket once a day (5 c), watch the two imported curtains open, see the puppet roles and hear every server play line with captions. Leaving and entering again does not charge twice.
- Hear the street singer's tuned verse/chorus, buy the daily sheet with G (the actual browser key), read it from pockets on the paper kit. The source's syllable/tune shifts and .34 s beat are retained.
- Use E look prompts in all five real landmark halls. Read the town hall notice board and civil register; talk to existing physical hall residents through the ordinary work/trade paper. Light a 2 c cathedral candle, sit in a free row-end chair (1 c once a service), and kneel at the curate's confessional during the server's hours. Own-word typing requires AI; no-AI cannot send. A hostile test line is blocked by the server's regex gate before any model call.
- Hear the Sunday high-mass sermon automatically after the service's opening phase: the existing priest walks to the pulpit foot, climbs for three seconds, pauses, speaks each timed engine line, then descends. The engine gets the completion only after the last line and awards its trust only once that Sunday. Engine gossip is shown halfway through.
- Stand with the men at a running hiring event once, join the fire bucket line at its actual event point and leave by walking away. These actions report to the engine; actor/director ownership remains with the events helper.
- See the engine's emigrant camp props and accept luggage carry work. Taking luggage prevents boarding until it is done (409 refusal verified). Families leave the street schedule, walk to the quay, stand as real Humans on the existing tender and take their lowered chests with them. The engine records boarding; the same tender empties when it reaches its liner stop. Hidden frozen-bake tender meshes are restored at load.

`PlacesWhere` wraps the previous `GameState.Where` delegate, preserving its lantern flag and adding the real home/counter/Poesje/landmark room. This is required for engine home sleep and interior shelter. Later adapters should wrap rather than replace this delegate.

## Evidence and repeat

`dotnet build godot` passes (existing `Render/Grime.cs:43` nullable warning). New files were imported once with the headless Godot 4.7.2 C# executable. Own server/client npm installs were used; `npm run build` passed with existing Vite warnings. No server rules or dependencies were changed.

From this worktree:

```powershell
dotnet build godot
node tools/godot/places-check.mjs --out places-proof
node tools/godot/places-check.mjs --only landmarks --out cathedral-proof --no-import
node tools/godot/places-check.mjs --mode perfcheck --out places-perf --no-import
node tools/godot/places-check.mjs --mode talktest --out places-talk --no-import
```

The wrapper uses engine port 8990/map 8991 by default (8990–8993 selectable, next port reserved for the map), seed 1873 and the public shared bake/model inputs. Each import/run waits for the shared PERF-LOCK. It writes only inside this worktree's `godot/baked`, uses a private test database and user-data directory, times out at 180 s for import/240 s for an individual check/480 s for the combined check, kills its own child process tree and deletes SQLite database/journal files in `finally`. Test modes also quit themselves. It never starts the forbidden ports.

`-- --placestest <dir>` writes replies and per-check outcomes to `<dir>/placestest.json` plus close PNGs. It requires `--no-ai --db <dir>/test.sqlite`. Fixtures use the engine's dev endpoints for offered jobs, clocks and event stages. Work, rent, prices, guards, payouts, inventory and boarding decisions remain the ordinary server's. Jef is positioned at each actual action rather than testing every continuous walking route. The dice test ends ordinary patron arrival and advances their existing indoor animation. The emigrant test holds/restores the real initial quay stop for loading and advances its existing liner-stop state at the end; it does not prove a full unforced voyage. No AI answer quality is claimed.

| Check | Result | Evidence in this worktree |
|---|---|---|
| Combined places test | **189/189**, 48 PNGs all viewed in eight contact sheets | `godot/baked/places-final-complete/placestest.json`, `review-0.jpg` through `review-7.jpg` |
| Corrected pulpit and cathedral repeat | **39/39**, 11 PNGs all viewed; priest visibly inside bowl after height correction | `godot/baked/cathedral-pulpit-final/placestest.json`, `cathedral-sermon.png`, `review-0.jpg`, `review-1.jpg` |
| Close emigrant camp repeat | **16/16**, 3 PNGs all viewed; actual visible camp luggage determines the close view | `godot/baked/emigrant-camp-final/placestest.json`, `emigrant-camp.png`, `emigrants-tender.png` |
| Existing dialogue regression | **22/22**, 27 PNGs all viewed, no papers left open | `godot/baked/places-talk-final/talktest.json`, `review-0.jpg` through `review-4.jpg` |
| Whole-game frame gate | **3/5 pass**, 5 ms budget: cathedral 5.357 ms, Handschoenmarkt 5.536 ms live mean | `godot/baked/places-perf-final/perfcheck.json` |
| Places update loops disabled | **3/5 pass**: cathedral 5.085 ms, Handschoenmarkt 5.355 ms live mean | `godot/baked/places-perf-disabled/perfcheck.json` |

Both frame runs used the RTX 5090 and had no other observed Godot run before launch. This comparison disables this batch's update loops with `--baseline`; prepared geometry, prompts and the room delegate remain, so it is **not an exact parent-commit baseline**. The 5 ms gate is unresolved and no whole-game no-stutter claim is made. Live frames over 16 ms were 1 at the cathedral/2 at Vismarkt with the batch enabled and 2 at Vismarkt with updates disabled; collections were 1 at Grote Markt/1 at the cathedral enabled, 1 at the cathedral disabled. Broader renderer/frame work is described in the existing [rooms/performance handoff](godot-rooms-perf.md) and [player inventory](godot-play-inventory.md).

The combined pictures retain some previous-job note/toast text because the deterministic fixture freezes the normal playing clock; those overlays expire normally during play. Existing very dark interior/night rendering remains visible in the home and box pictures. The newer cathedral repeat provides cleaner close views. No engine/server ERROR, exception or resource-leak lines occurred in the completed combined, cathedral, emigrant, talk or frame logs. All own Godot/Node child processes ended and no test SQLite files remain.

Stable lamp and mill probes measure 10,000 update/goal/HUD reads each: **0 managed bytes**. This only establishes those stable run paths; it is not a whole-game allocation claim.

## Remaining parity work

- Cart driving/loading/gear must be integrated with play4. Carrying cart-job crates by hand is not evidence of transport parity.
- Mill work's local elapsed time/call/turn snapshot is not preserved when set aside or saved. Mill cap/chain and park scoop-hand animations are incomplete.
- More home classes/furniture kinds, Sunday rent/eviction/storage transitions need explicit gameplay checks. Placed-stove warmth and hanging-lamp spill, clock motion and some carried furniture details remain incomplete; the existing fireplace works. Home cart parking is a transport dependency.
- Tavern table conversation, drink invitation/rounds, cafe piano and some seat layouts remain incomplete. Poesje audience/seating, puppet hits/gossip and prop/access restrictions are incomplete.
- A tavern singer's exact floor/arrival and the cry between song rounds remain incomplete. The listed `ballads.ts` has no separate player sing/learn control; no new engine action was invented.
- Cathedral congregation nods/whisper bubble targeting, organ and church-running/hush scene remain incomplete. Other landmark chairs are not yet exposed. A complete wedding and individual Steen/warehouse/market job runs have not been tested. Existing HallPeople actors supply the physical residents; events belongs to its helper.
- Prayers are resident roles and rosary is shop stock in the inspected source. No separate player alms/prayer/tower action was found in the listed browser/API files; climbing static tower geometry is not independently tested.
- Emigrant baby prop, passenger waving, camp notice board and exact source prop keepouts are incomplete. Boat visibility restoration is limited to the two emigrant lighters; broader mover bake visibility belongs to the world/transport owner.
- Night boxes use the source distances/hours, named lamps and engine holds, but exact door/wall keepout scoring needs refinement. Fire buckets/chain actors remain the director helper's.
- Typed confession uses the existing server gate and AI fence; its real AI response path is not covered by `--no-ai` tests.

## Shared source edits

Only these files from the user's shared-file list changed:

| File | Why |
|---|---|
| `godot/src/Play/Jobs.cs` | Enable lamp/mill/cart kinds, restore held proof work, route dock piece placement/lifting and expose their goals. |
| `godot/src/Play/Runs.cs` | Pick up a night parcel at its employer's box and aim the goal there while the employer sleeps. |
| `godot/src/Play/Day.cs` | Public home-bed chooser entry; the existing sleep/wake owner stays intact. |

`Api` calls are exclusively in the new own partial `godot/src/Net/Api.Places.cs`; no `Api.cs` edit. The existing town owner is adapted through new `Town/Townspeople.Places.cs`; no `Townspeople.cs` edit. No `Main.cs`, `BakedWorld.cs`, `Solid.cs`, `Jef.cs`, `Wiring.cs`, `Interact.cs`, `Talk.cs` or `Dice.cs` edit. No runtime shader kinds or light counts are added: props/materials/puppet meshes/box lamps are prepared at load and use the existing fixed lantern spill pool.

Every feature commit includes a player-visible Unreleased line and the requested co-author trailer; the pre-commit hook passed. No push or merge.
