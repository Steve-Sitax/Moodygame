# Godot player feature inventory

Audited on `godot/play2`, starting at `4d3b257`, 2026-10-04. Browser `client/src/main.ts` is the wiring index. Paths below are relative to `client/src/` and `godot/src/` respectively. “Partial” means source exists, not that the complete feature has been verified in this branch. Events, actor routines and director scenes belong to `godot/events` and are not changed here.

The audit covers every TypeScript module in `game/`, `menu/` and `net/`, and the M3–M7 milestone notes (including the M6 subnotes). Static models are provided by the shared bake; their presence is not evidence that their player actions work. This is the continuation checklist, with explicit gaps rather than a claim of parity.

| Player feature / window / default keys and prompts | Browser source | Godot source / status at audit | Missing or next check |
|---|---|---|---|
| Walk, turn, run, crouch, jump; remappable movement keys | `player/firstPerson.ts`, `menu/keys.ts`, `main.ts` | `Player/Jef.cs`, `Menu/Keys.cs`: present | Transport-specific movement below is absent |
| Water entry, swimming, cold, ladders, mantle, falls | `main.ts`, `game/deeds.ts`, `player/firstPerson.ts` | `Player/Jef.cs`, `Player/Mantle.cs`, `World/QuayExits.cs`: partial | Fall damage reporting and jumping aboard boats need parity checks |
| E nearest facing thing; F secondary action; numbered clickable keys | `game/jobs.ts`, `reach.ts`, `facing.ts`, `runs.ts`, `cursor.ts` | `Play/Interact.cs`, `Windows/Paper.cs`: present | Every new owner must register its prompts |
| E talk, B buy, W work, 1–3 answer, T own words; mood and note | `game/talk.ts`, `bubbles.ts` | `Talk/Talk.cs`, `Talk/Bubbles.cs`: present | Review no-AI typing gates; missing action owners below |
| H haggle then ware number; server prices after purchase | `game/talk.ts`, `net/api.ts` | `Talk/Talk.cs`, `Net/Api.cs`: present; no-AI gate corrected in this batch | Real AI price/story proof is outside this no-AI batch |
| Police visit, choices / T story, fine, let off, pursuit | `game/deeds.ts`, `talk.ts` | Ordinary `Talk/Talk.cs` only: partial | Deeds owner, witness reports, visit arrival, verdict handling |
| Police cell and release at prison | `game/deeds.ts`, `sleep.ts`, `day.ts` | `Game/DaySheets.cs`: night papers only | Arrest/cell integration, together held cell, release position |
| Food, medicine, drinks at seller; server money and needs | `game/talk.ts`, `pockets.ts` | `Talk/Talk.cs`, `Shop.cs`, `Pockets.cs`: present | Shop interior counters must expose their actions |
| I pockets; numbered eat/read; D discard papers; good name | `game/pockets.ts`, `shopIcons.ts`, `shopProps.ts` | `Talk/Pockets.cs`, `Game/PocketIcon.cs`, `ShopIcons.cs`: present | Lantern and deed-specific state still missing |
| Give a pocket item in talk, visible handover | `game/hands.ts`, `talk.ts` | `Talk.OnReply` hook only: partial | Gift hand and recipient prop; server acceptance is already talk-driven |
| Invite for drink, follow to tavern, G stand round, F table talk | `game/hands.ts`, `interiors.ts`, `steps.ts` | No player owner | Treat calls, entry/exit, rounds, table prompts; routine walking belongs to events helper |
| Hire helpers in talk, named wage, crew stop and progress | `game/hands.ts`, `steps.ts`, `journeys.ts` | No player owner | Crew controls/display, hired-work goods integration; routine execution belongs to events helper |
| E hiring board; 1–9 take; J quest book; task card, map goal | `game/jobs.ts`, `runs.ts` | `Play/Jobs.cs`, `Paper.cs`, `Tick.cs`: present | Kinds outside carry/watch/deliver require their own runs |
| Lift/put down goods, carry slowdown/no jump, mixed loads | `game/goods.ts`, `props.ts`, `sackModel.ts`, `fishBox.ts`, `kegModel.ts` | `Play/Goods.cs`, `GoodsData.cs`: present | Loose quay pile feeds, handcart attachments |
| Carry, deliver, watch, employer handover and payment | `game/runs.ts`, `jobs.ts` | `Play/Runs.cs`, `Jobs.cs`: present | Twist walk-ups coordinated with events helper |
| Trouble card, numbered choices, E errand, refusal | `game/ideas.ts`, `follower.ts`, `walkup.ts` | `Play/Trouble.cs`: partial | Physical walk-up, stranger/foreman/thief follow-up belongs to events helper |
| E handcart grips, load/unload, E release, F unload, rent/own/lent | `game/handcart.ts`, `cartPhysics.ts`, `goods.ts` | NPC carts in `Movers/StreetRig.cs` only | Entire player cart owner, server calls, physical pushing, save/gear |
| Pawn medal/lantern, redeem; numbered Berg counter, ticket reading | `game/press.ts` | `Talk/Press.cs`, `Play/PressWorld.cs`: F clerk works; pawn/redeem verified | E at the pawn interior's actual counter still needs the interior owner |
| Buy newspaper from newsboy; read, shipping, wanted jobs, discard | `game/press.ts`, `pockets.ts` | `Talk/Press.cs`, `Pockets.cs`: window/trade present | Newsboys’ nearby cries |
| F post counter, collect waiting mail, take round | `game/press.ts` | `Talk/Press.cs`, `Play/PressWorld.cs`: F clerk / E counter connected | Waiting-mail window existed before; no new collection behaviour |
| E fetch letters, E put under each door, E send telegram | `game/press.ts` LettersRun | `Play/Letters.cs`, `Play/Jobs.cs`, `Net/Api.Play.cs`: implemented and verified | Both 3- and 5-door rounds, telegram fee/pay, task card, book/map and restoration work; continuous walking route not checked here |
| Read own letters, T take errand | `game/press.ts` | `Talk/Press.cs`: present | Errand run above |
| Write / reply to letter at post; choose person, type, send | `game/ideas.ts` | No owner | Paper composer, AI gate, typed API, hostile-line check |
| Read wall posters / wanted bills | `game/ideas.ts` | `Talk/Press.cs` has `OpenBill` only | World poster prompts and changing text |
| Lost things / dog collar, return to owner | `game/ideas.ts` | No owner | World objects, pick/return calls and prompts |
| Pick/read notebook; return, G squeeze, G sell at Berg | `game/ideas.ts` | `Talk/Press.cs` reads diary only | World pick/return/squeeze/sell |
| Invited meeting: E knock | `game/ideas.ts` | No owner | Meeting prompts and replies |
| Pickpocket behind a person, G; delayed discovery | `game/deeds.ts` | `Net/Api.cs.Pick` is legacy minimal API only | Current deeds payload, witness geometry, discovery and reactions |
| Thief at Jef’s pocket, E catch / collar, lost goods | `game/town.ts`, `deeds.ts`, `follower.ts` | No player owner | Theft/catch integration and visible thief |
| Gang demand and menace card, pay/refuse/run, wounds | `game/families.ts` | `People/FamilyPeople.cs` places residents only | Family push/poll state, menace window and server choices |
| Lantern E take, L hold/put away, warmth and light | `game/deeds.ts`, `lantern.ts` | Warmth report DTO exists; no lantern owner | Ownership, theft/return, model, existing light pool connection |
| Velocipede E mount/dismount, crash/steps/edge, buy/rent | `game/deeds.ts`, `velocipedes.ts` | `Net/Mp/RemoteGear.cs` draws remote only | Local riding physics, maker counter, deeds and gear |
| Rowing boat E enter/leave, oars, docking/tow/anchor | `game/rowing.ts`, `boatMoorings.ts` | `Movers/Boats.cs`, `Anchorage.cs`: world boats only | Local boat control, server ownership/position, avoidance, mooring |
| Swim/climb/jump onto ships, tide decks and moving frame | `game/rowing.ts`, `lifeAboard.ts`, `main.ts` | World tide and hull movement present | Player deck/frame and jump integration |
| Omnibus stops E board; conductor fare, hop on/off; roof/inside | `game/ride.ts`, `net/api.ts` | `Movers/Omnibus.cs`, `Net/Api.Ride`: world/core API present | Jef seats, conductor window, local ride state/gear |
| Read stop timetable | `game/ride.ts` | API only | Stop prompt/window |
| E crane ladder, climb cabin, E down | `game/craneclimb.ts` | `Movers/Cranes.cs` world motion only | Local ladder/deck and reachable cabin |
| E bench/bed sleep chooser, hours, wake key, collapse/night sheet | `game/day.ts`, `sleep.ts` | `Play/Day.cs`, `Game/DaySheets.cs`: present | Home beds below; police cell owner above |
| Doss-house rent and week ending, immutable ending paper | `game/day.ts`, `sleep.ts` | `Play/Day.cs`, `Game/DaySheets.cs`: present | Existing tests cover; retain single sheet owner |
| Homes: E notice, numbered rent, own key, bed/storage, furniture | `game/homes.ts`, `net/homesApi.ts` | `People/HomeVisitors.cs` / baked rooms only | Home notices/API/windows, rent/key state, bed/wake/storage/cart park |
| Tavern E counter, drinks, tables, patrons; Poesje show | `game/interiors.ts`, `net/interiorApi.ts` | `Talk/Shop.cs`, `Dice.cs`; baked interiors: partial | Interior player state, seat/leave, show, counter/table prompts |
| Dice: E sit, numbered stake, roll, cheat, leave | `game/interiors.ts` | `Talk/Dice.cs`: window present | Tavern physical seat prompt and occupancy |
| Ballad: listen, verse/chorus sheet, B buy, sing/learn | `game/ballads.ts` | No player owner | Ballad API/window, local sung lines and cues |
| Sermon, cathedral prayers/rosary, alms, tower climb | `game/landmarks.ts` | `People/HallPeople.cs`, baked halls only | Landmark state/API, player prompts/windows |
| Town hall clerks/wedding; Vleeshuis market; Steen/warehouse work | `game/landmarks.ts`, `net/landmarksApi.ts` | Hall people/bake only | Player interactions and landmark jobs |
| Emigrant camp, carry bundles/luggage, tender and liner boarding | `game/emigrants.ts`, `lifeAboard.ts` | Moving liner/boats in `Movers/` only | Emigrant task owner, goods/people boarding and server reports |
| Hiring stand E join, fire bucket line E join/leave | `game/townlife.ts` | `Net/Api` calls and world fires only | Player prompts/state/reports |
| Dock piecework / cart / errands / lamp / mill / park jobs | `game/jobs.ts`, `handcart.ts`, `lampjob.ts`, `mills.ts`, `parkWork.ts` | Carry/watch/deliver only | Separate run kinds, pole and timed action reports |
| Night job boxes E deposit/collect, sleeping employers | `game/questboxes.ts`, `nightlife.ts` | `Net/Api.Hold` only | Door-box prompts, reports and collection |
| Back streets, shops, stalls, named resident routines | `game/backlife.ts`, `market.ts`, `lively.ts`, `town.ts`, `stalls.ts`, `shopCalls.ts`, `stallSpots.ts` | `Town/`, `People/`, `Movers/`: partial | Player counter hooks above; routines/events owned elsewhere |
| M map, zoom/pan, key/icons/categories, click route, live job marks | `game/map.ts`, `mapIcons.ts` | `Game/TownMap.cs`, `MapBase.cs`, `MapIcons.cs`, `Movers/MoverMap.cs`: present | New run/transport goals must attach |
| Esc closes top paper; E close; focus/click recapture; no leaking keys | `game/dialogs.ts`, `cursor.ts`, `pause.ts`, `main.ts` | `Windows/Dialogs.cs`, `Game/Wiring.cs`, `Ui/Dialogs.cs`: present | Check each new window on stack |
| P pause; Esc menu; save/load/continue/new game and autosave | `game/pause.ts`, `saves.ts`, `restoreData.ts`, `menu/menu.ts` | `Menu/MainMenu.cs`, `Saves.cs`, `Pause.cs`: present | New local feature state must restore |
| Settings, keys, text size, sound, retro look, population, AI setup | `game/settings.ts`, `prefs.ts`, `menu/apply.ts`, `tuning.ts`, `ai.ts`, `keys.ts` | `Menu/SettingsSheet.cs`, `AiSheet.cs`, `Prefs.cs`, `Keys.cs`, `Apply.cs`: present | New feature must use settings and bindings |
| Character colours/name and preview, help/credits/quit/loading | `menu/character.ts`, `fonts.ts`, `menu.ts` | `Menu/CharacterSheet.cs`, `Sheets.cs`, `Loading.cs`: present | Preview uses existing model hook |
| Ferry arrival and ashore, first-game hints | `game/ferryArrival.ts` | No local owner | Arrival walk/plank/server completion and hints |
| Together host/join/leave, remote players and gear | `game/share.ts`, `net/mp/*`, `net/api.ts` | `Net/Mp/`, `Menu/TogetherSheet.cs`: present | New local rides must supply `Together.Gear`; world adapters owned elsewhere |
| Events/director, conversations, funerals, family visits/dreams | `game/events.ts`, `actions.ts`, `steps.ts`, `puppets.ts`, `hearses.ts`, `families.ts` | Existing bubbles/figures/world hooks only | Reserved for `godot/events`; no edits here |
| Dev console/test kit, paths/stuck/shaders/perf checks | `game/devmenu.ts`, `main.ts` | `Dev/Kit.cs`, `Checks.cs`, audits: present | This branch adds `--playtest` for its player work |

Supporting source modules (`animals`, `crowd`, `humans`, `people`, `figures`, `props`, `droveWalk`, `instruments`, `stationRound`, `facing`, `reach`, `corner`, `follower`, `lamplighter`, `shopCalls`, `shopProps`, `boatMoorings`) provide rendering, targeting, locomotion or data for the rows above; they do not introduce a separate player window. Multiplayer `identity`, `link`, `session`, `remotes`, `gear`, `world`, `street`, `extras`, `figures`, `jobfigs`, `househelp` are covered by Together and the owning feature rows.

## Batch order and evidence

1. Inventory committed before source changes.
2. Existing haggling and paper windows are retained. First implementation batch targets the absent money/work hooks: Berg/post world prompts and the postal delivery/telegram run, then the no-AI typing gate.
3. Remaining rows stay explicitly incomplete until server-backed checks and viewed pictures prove them. No AI gift/hire acceptance is claimed from a no-AI run.

## Implementation handoff

The postal run mirrors browser `press.ts`: pickup within 3.2 m, delivery within 2.4 m, wire within 3.2 m; each request includes the job, stop and Jef's actual position. Task state is read back from the server. The engine counts done stops, charges the wire fee and settles pay/trust through the existing jobs code. Taking from the board, a letter or the post counter goes through `Jobs.TakeJob`. The quest book can follow/set aside postal work, and restoration keeps server pickup/door state. A disposed run ignores an answer still on its way. The HUD strings are cached after a task reply; the per-frame postal update, goal and card reads allocate no managed memory.

The existing paper windows are reused. `PressWorld` registers F at the two clerks and E at the server's post-counter point; it refreshes positions four times a second. `Press` refetches its town/counter metadata after world replacement. T/H stay off with `--no-ai`, in the AI sheet's walk mode, or after a server `free: false` reply. H no longer opens a picker that can lead into typing without AI. Prices and ordinary numbered choices remain the server's.

| Check | Result / numbers | Evidence relative to this worktree |
|---|---|---|
| Initial real-window player run | 40/40 checks, 5 letters paid 105 c; telegram fee 50 c / pay 90 c; medal loan 70 c / redemption 74 c | `godot/baked/play-proof/playtest.json`, 17 viewed PNGs |
| Corrected task-card run | 40/40, no literal bold tags; 5 letters and wire completed | `godot/baked/play-final/playtest.json`, 17 PNGs reviewed in `contact-sheet.jpg` |
| Final seed-1873 run | 37/37, 3 letters paid 70 c; wire fee 50 c / pay 90 c, both jobs +1 trust; loan 70 c / redeem 74 c | `godot/baked/play-handoff/playtest.json`, 15 PNGs reviewed in `contact-sheet.jpg` |
| Server safeguards | Wrong door refused (409); hostile haggle and talk refused with money unchanged; UI typing disabled | Same JSON; `choices-only.png` |
| Postal allocation probe | 10,000 update + goal + HUD reads: 0 managed bytes | `replies.postal_frame_probe` in final JSON |
| Build/import | `dotnet build godot`, headless import, `npm run build` pass; existing `Render/Grime.cs` nullable warning retained | `play-proof/import.log`; build console |
| Whole-game frame gate | Failed in first run at 3/5 places; component-disabled run failed at 4/5. Other helpers' Godot windows were running, so no uncontended budget or regression claim | `godot/baked/play-perf/perfcheck.json`, `play-perf-baseline/perfcheck.json`; [issue #47](https://github.com/Steve-Sitax/Moodygame/issues/47) |

Final pictures include `berg-counter.png`, `pawned.png`, `redeemed.png`, `post-counter.png`, `letters-pickup.png`, `letter-door-1.png` through `letter-door-3.png`, `letters-book.png`, `letters-map.png`, `letters-paid.png`, `telegram-pickup.png`, `telegram-send.png`, `telegram-paid.png`, and `choices-only.png`. They are close, 13:45/clear views. Existing dark street lighting remains [issue #42](https://github.com/Steve-Sitax/Moodygame/issues/42). No shader, lamp or lighting fix is part of this branch.

Repeat from this worktree: `dotnet build godot`, then `node tools/godot/play-check.mjs`. It imports once, checks PERF-LOCK before every engine launch, opens a real window, uses seed 1873, port 8930 and map port 8931, writes pictures and server replies, times out after four minutes and removes its database. `--no-import --out another-proof --port 8932` repeats on the last import. `--mode perfcheck` and `--mode talktest` run those existing checks with the same bounded process/database wrapper. The final exit has no engine/server ERROR, exception or resource-leak lines. No own Node/Godot processes or test databases remain.

Limits: the script places Jef at the real server goal and summons clerks through the existing dev kit. It proves prompt routing and engine calls, not a continuous on-foot route through every house. A deterministic telegram job is inserted into **only** `<this worktree>/godot/baked/<output>/test.sqlite` by `tools/godot/play-fixture.mjs`; its pickup, fee and settlement use real server routes. No test edits a live save, bakes town geometry or accepts gifts/hired work without AI. `--playtest` currently covers this branch's counter/postal/gating batch, not the entire inventory.

Shared-file audit: **`Net/Api.cs` only** from the named shared-file list, changed by one word (`partial`) so its typed postal methods live in `Api.Play.cs`. No edits to `Main.cs`, `BakedWorld.cs`, `Solid.cs`, `Jef.cs`, `Wiring.cs`, `Psx.cs` or shaders. Integration files also touched: `Play/Jobs.cs` for postal following, cards/book/map and settlement; `Talk/Talk.cs` and `TalkTest.cs` for no-AI typing; `Talk/Press.cs` for typed metadata and load/reset. No server gameplay source, shared bake, packages or model assets changed. Dependency installs were normal directories, and their lockfile noise was restored.

Next helper: police/deeds and their visit/cell integration, gift/treat/hire player controls alongside the events helper's routine executor, player handcart, thieves/gang, then local boat/omnibus/velocipede rides. Wall posters, lost objects/notebooks and letter writing still need their world/composer owners. Homes, landmark player actions, ballads, emigrant work and special job kinds remain as listed above. This is deliberately a partial port.

## Browser key source index

Literal key codes found across all requested modules, to complement the action/window table. Number ranges, mouse actions and remappable movement are documented by their owning rows above; this index also includes dev-only key mentions. Read the listed browser handler when adding a missing owner.

| Browser file | Literal codes |
|---|---|
| `main.ts` | `ArrowDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `Enter`, `Escape`, `F8`, `F9`, `KeyA`, `KeyD`, `KeyE`, `KeyP`, `KeyS`, `KeyW`, `Space`, `Tab` |
| `game/ballads.ts` | `Escape`, `KeyE`, `KeyG`, `KeyI` |
| `game/craneclimb.ts` | `ArrowUp`, `KeyE`, `KeyW` |
| `game/cursor.ts` | `Enter`, `Escape`, `Tab` |
| `game/day.ts` | `Enter`, `Escape`, `KeyE`, `KeyN` |
| `game/deeds.ts` | `Enter`, `Escape`, `KeyE`, `KeyG`, `KeyL` |
| `game/devmenu.ts` | `Escape`, `F8`, `F9` |
| `game/families.ts` | `Enter`, `Escape`, `KeyP`, `KeyT` |
| `game/follower.ts` | `KeyE` |
| `game/handcart.ts` | `KeyE`, `KeyF`, `KeyG` |
| `game/hands.ts` | `KeyF`, `KeyG` |
| `game/homes.ts` | `KeyE`, `KeyF`, `KeyG`, `KeyR` |
| `game/ideas.ts` | `Enter`, `Escape`, `KeyE`, `KeyG` |
| `game/interiors.ts` | `Escape`, `KeyE`, `KeyF`, `KeyG` |
| `game/jobs.ts` | `Escape`, `KeyE`, `KeyF`, `KeyG`, `KeyJ`, `KeyM` |
| `game/lampjob.ts` | `KeyE` |
| `game/landmarks.ts` | `Enter`, `Escape`, `KeyE`, `KeyF` |
| `game/map.ts` | `ArrowDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `Escape`, `KeyA`, `KeyC`, `KeyD`, `KeyM`, `KeyS`, `KeyW` |
| `game/mills.ts` | `KeyE` |
| `game/nightlife.ts` | `KeyF`, `KeyH`, `KeyP`, `KeyR` |
| `game/parkWork.ts` | `KeyE`, `KeyF`, `KeyG` |
| `game/pockets.ts` | `Escape`, `KeyI` |
| `game/press.ts` | `Escape`, `KeyD`, `KeyE`, `KeyF`, `KeyT` |
| `game/ride.ts` | `Digit1`, `Digit2`, `Escape`, `KeyE`, `KeyF`, `Space` |
| `game/rowing.ts` | `KeyE`, `Space` |
| `game/runs.ts` | `KeyE`, `KeyF`, `KeyG` |
| `game/saves.ts` | `Enter` |
| `game/sleep.ts` | `Escape`, `KeyE`, `KeyP` |
| `game/talk.ts` | `Enter`, `Escape`, `KeyB`, `KeyE`, `KeyH`, `KeyT`, `KeyW` |
| `game/townlife.ts` | `KeyE` |
| `menu/keys.ts` | `Backspace`, `Enter`, `Escape`, `KeyA`, `KeyB`, `KeyC`, `KeyD`, `KeyE`, `KeyF`, `KeyG`, `KeyH`, `KeyI`, `KeyJ`, `KeyL`, `KeyM`, `KeyN`, `KeyP`, `KeyR`, `KeyS`, `KeyT`, `KeyW`, `Space`, `Tab` |
| `menu/menu.ts` | `ArrowDown`, `ArrowLeft`, `ArrowRight`, `ArrowUp`, `Enter`, `Escape`, `F8`, `F9`, `Space`, `Tab` |
| `net/mp/together.ts` | `F5` |
