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
- Park scoop-hand animation remains incomplete. Mill snapshots and capstan/chain hands are covered by the indoor gap checks below.
- More home classes/furniture kinds, Sunday rent/eviction/storage transitions need explicit gameplay checks. Home cart parking and exact bed load positions remain transport dependencies; the household adapter covers furniture load/unload and returned loans.
- Cafe piano, wider seat layouts and Poesje gossip/access restrictions remain incomplete. The indoor gap batch covers table conversation, rounds, audience seating and scripted puppet hits.
- A tavern singer's exact floor/arrival and the cry between song rounds remain incomplete. The listed `ballads.ts` has no separate player sing/learn control; no new engine action was invented.
- Other landmark chairs are not yet exposed. Individual Steen/warehouse/market job runs remain untested. Existing HallPeople actors supply the physical residents and wedding procession; the indoor checks exercise that owner's ceremony hooks and the four town-hall work roles. There are no new invented town-hall paid quests.
- Prayers are resident roles and rosary is shop stock in the inspected source. No separate player alms/prayer/tower action was found in the listed browser/API files; climbing static tower geometry is not independently tested.
- Boat visibility restoration is limited to the two emigrant lighters; broader mover bake visibility belongs to the world/transport owner. The indoor batch adds babies, waving, the ship-day notice and source track/omnibus/market keepouts. A full unforced voyage remains untested.
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


## Indoor gaps integration (godot/gaps-indoor)

The indoor adapter leaves handcart driving and bed geometry with the moving helper. `HomeFurniture.CarriedFurniture`, `CartModel(kind)`, `LoadToCart(cartId)`, `LiftFromCart(cartId, index)` and `RefreshAfterCart()` expose the household side. The own `IndoorCartLink` listens to `Handcarts.Answered`, `Deeds.CartTaken` and `Deeds.ThingsReturned`; it applies the engine cart answer and puts furniture copies on the existing `Drawn.Bed`. `CartTaken` sends the cart id and the engine's `again` flag. It does not create a second cart. Cart load/unload calls live in `Net/Api.Indoor.cs`.

Mill local state is held per job by `Jobs.Indoor.cs`; `IndoorSave` adds the `indoor_work` extension while preserving other capture fields. Restoration bounds completed turns and elapsed work against the server task and clears the transient call/turn animation, as in the browser. Materials for hands, audience props, babies and the notice are prepared at load. Hanging furniture lamps reserve four spill slots at load; they do not change the light count during play.

`tools/godot/indoor-data.mjs` derives the camp keepout rectangles from the browser's track smoothing and omnibus line plans plus the shared market fields. It writes only this worktree's `godot/assets/indoor-keepouts.json`. The walk-map circle approximation checks the centre and four corners; this does not claim an exact continuous collision-circle query.

The extended checks use ports 8900–8904 only. Run `--only wedding` in its own fresh world alongside `--only indoor`: the latter covers cathedral, homes, both mills, tavern, emigrants and Poesje. A wedding fixture followed by a backwards jump to Sunday can leave the curate owned by the existing event actor director; the combined all-places run remains open for that fixture interaction. Cathedral checks apply a fresh physical hall roster when the fixture changes the service hour; third-strike dismissal is tested after the earlier-week wedding. The held-cell check opens two authenticated live movement connections, keeps the guest walking and waits for the normal multiplayer world tick at dawn. `dev/advance` is deliberately not used to spend multiplayer rest. The fresh disposable databases are removed by the runners, which honor the shared `PERF-LOCK` and bound every Godot run.

Shared integration edits in this gap branch are `Play/Jobs.cs` (retain/restore mill state), `Play/Deeds.cs` (successful cart-take notification), `Game/Wiring.cs` (Poesje bench freezes movement through the existing owner), `Play/Day.cs` (place the sleeping prisoner at the server cell position, matching `sleep.ts`), and the places-owned `Net/Api.Places.cs` (typed organ/barred flags). No handcart driving, `Main.cs`, `BakedWorld.cs`, `Solid.cs`, `Jef.cs`, `Interact.cs`, `Talk.cs`, `Dice.cs` or server gameplay source is edited in this gap batch. Its typed new routes are in `Net/Api.Indoor.cs`.


### Final indoor proof

- `node tools/godot/places-check.mjs --only indoor --out indoor-core-proof --port 8900 --no-import`: **171/171**, **49 pictures**. Both mills finish two turns at the full engine **60 c** each; snapshots and save capture restore; stable probes allocate **0 bytes in 10,000 reads**. Placed stove, clock and lamp, lent-cart furniture load/unload/loan return and second-home household transfer pass. Cathedral sermon, organ, actual congregation and three hush strikes pass with **31** nearby witnesses, dismissal and the engine trust-loss cap. Table conversation, ordinary F talk and G dice pass. Emigrant luggage earns **40 c**, five deck passengers transfer to the liner, mothers carry babies and departing passengers wave. Poesje seats **14** actual spectators, charges **5 c**, speaks all **10** lines, times its stick hits and restores its audience on a distant return without another charge.
- `node tools/godot/places-check.mjs --only wedding --out indoor-wedding-proof --port 8902 --no-import`: **30/30**, **8 pictures**. Registrar, alderman, clerk and concierge follow their actual work routines and open ordinary talk/work papers; civil wedding hours, cathedral entry, ceremony positions, exit and final procession/reception stages pass.
- `node tools/godot/deeds-check.mjs --out indoor-deeds-proof-complete --port 8902 --no-import`: **82/82**, **30 pictures**. Three server-priced tavern rounds and the fourth-round refusal pass. Two authenticated live players exercise held rest, the awake guest, wake refusal, the server cell position, ordinary world-dawn release and summary acknowledgement. The thief fixture retries fresh nights after unsuccessful random picks while retaining the engine's two-attempt nightly cap.
- `godot/baked/indoor-shaders/shaders.json`: **103** shader programs at the first sample and thereafter, **534** samples, no problems. `dotnet build godot` passes with the two existing nullable warnings in Grime.cs and Deeds.cs.

Pictures are kept in the named local baked folders and reviewed individually, using contact pages where useful. Close picture examples: `indoor-core-proof/home-placed-clock.png`, `home-placed-lamp.png`, `mill-mid-turn-hands-1.png`, `emigrant-notice.png`, `emigrants-wave.png`, `poesje-audience-seat.png`; `indoor-wedding-proof/wedding-ceremony.png`; `indoor-deeds-proof-complete/treat-table.png`. The focused `indoor-held-picture-proof/deedstest.json` passes **13/13** and supplies the two reviewed cell pictures after waiting for the sleep fade; the host rests from **05:50 to 06:00** while the guest stays awake. The daytime rendering remains dark in the existing renderer. Full unforced tender voyage, AI-generated typed answers, wider household classes and exact moving-helper cart-bed packing remain open. No shared bake was written.
