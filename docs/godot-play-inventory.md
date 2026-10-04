# Godot player feature inventory

Audited on `godot/play2`, starting at `4d3b257`, 2026-10-04. Browser `client/src/main.ts` is the wiring index. Paths below are relative to `client/src/` and `godot/src/` respectively. “Partial” means source exists, not that the complete feature has been verified in this branch. Events, actor routines and director scenes belong to `godot/events` and are not changed here.

The audit covers every TypeScript module in `game/`, `menu/` and `net/`, and the M3–M7 milestone notes (including the M6 subnotes). Static models are provided by the shared bake; their presence is not evidence that their player actions work. This is the continuation checklist, with explicit gaps rather than a claim of parity.

| Player feature / window / default keys and prompts | Browser source | Godot source / status at audit | Missing or next check |
|---|---|---|---|
| Walk, turn, run, crouch, jump; remappable movement keys | `player/firstPerson.ts`, `menu/keys.ts`, `main.ts` | `Player/Jef.cs`, `Menu/Keys.cs`: present | Transport-specific movement below is implemented in dedicated owners; see their remaining checks |
| Water entry, swimming, cold, ladders, mantle, falls | `main.ts`, `game/deeds.ts`, `player/firstPerson.ts` | `Player/Jef.cs`, `Player/Mantle.cs`, `World/QuayExits.cs`, `Play/Falls.cs`: fall reporting implemented | Threshold checks pass at 2.99/3/5/8/12 m; an actual 5.2 m stone landing reports once, and water takes the fall. Rowboat quay jumps pass; physical falls from every threshold need wider checks; [ride handoff](milestones/godot-rides.md) |
| E nearest facing thing; F secondary action; numbered clickable keys | `game/jobs.ts`, `reach.ts`, `facing.ts`, `runs.ts`, `cursor.ts` | `Play/Interact.cs`, `Windows/Paper.cs`: present | Every new owner must register its prompts |
| E talk, B buy, W work, 1–3 answer, T own words; mood and note | `game/talk.ts`, `bubbles.ts` | `Talk/Talk.cs`, `Talk/Bubbles.cs`: present | Review no-AI typing gates; missing action owners below |
| H haggle then ware number; server prices after purchase | `game/talk.ts`, `net/api.ts` | `Talk/Talk.cs`, `Net/Api.cs`: present; no-AI gate corrected in this batch | Real AI price/story proof is outside this no-AI batch |
| Police visit, choices / T story, fine, let off, pursuit | `game/deeds.ts`, `talk.ts` | `Play/Deeds.cs`, `Net/Api.Deeds.cs`: witness reports, watch pursuit, server visit and verdict; no-AI choices only | Fine and arrest paths checked with a real server; AI typed story still needs an AI run |
| Police cell and release at prison | `game/deeds.ts`, `sleep.ts`, `day.ts` | `Play/Deeds.cs`: cell paper, held together tick, prison gate release | Arrest and release checked; together needs two live players |
| Food, medicine, drinks at seller; server money and needs | `game/talk.ts`, `pockets.ts` | `Talk/Talk.cs`, `Shop.cs`, `Pockets.cs`: present | Shop interior counters must expose their actions |
| I pockets; numbered eat/read; D discard papers; good name | `game/pockets.ts`, `shopIcons.ts`, `shopProps.ts` | `Talk/Pockets.cs`, `Game/PocketIcon.cs`, `ShopIcons.cs`: present | Lantern and deed-specific state still missing |
| Give a pocket item in talk, visible handover | `game/hands.ts`, `talk.ts` | `Play/Hands.cs` uses typed talk handover and a short visible hand/recipient prop | Visual handover checked; AI acceptance needs an AI run |
| Invite for drink, follow to tavern, G stand round, F table talk | `game/hands.ts`, `interiors.ts`, `steps.ts` | `Play/Hands.cs`, `TavernSeats.cs`: treat routines, entry/exit, server-priced rounds and seated talk | Guest, round and table prompts checked; a long walk behind Jef needs wider proof |
| Hire helpers in talk, named wage, crew stop and progress | `game/hands.ts`, `steps.ts`, `journeys.ts` | `Play/Hands.cs`: server routine stepping and reservation, wage and progress line | Server hire, up-front wage, arrival and stop checked; AI acceptance still needs an AI run |
| E hiring board; 1–9 take; J quest book; task card, map goal | `game/jobs.ts`, `runs.ts` | `Play/Jobs.cs`, `Paper.cs`, `Tick.cs`: present | Kinds outside carry/watch/deliver require their own runs |
| Lift/put down goods, carry slowdown/no jump, mixed loads | `game/goods.ts`, `props.ts`, `sackModel.ts`, `fishBox.ts`, `kegModel.ts` | `Play/Goods.cs`, `GoodsData.cs`: present | Loose quay pile feeds, handcart attachments |
| Carry, deliver, watch, employer handover and payment | `game/runs.ts`, `jobs.ts` | `Play/Runs.cs`, `Jobs.cs`: present | Twist walk-ups coordinated with events helper |
| Trouble card, numbered choices, E errand, refusal | `game/ideas.ts`, `follower.ts`, `walkup.ts` | `Play/Trouble.cs`: partial | Physical walk-up, stranger/foreman/thief follow-up belongs to events helper |
| E handcart grips, load/unload, E release, F unload, rent/own/lent | `game/handcart.ts`, `cartPhysics.ts`, `goods.ts` | `Play/Handcarts.cs`, `CartPhysics.cs`, `Net/Api.Handcart.cs`: partial | Owned/hired E grip/release, original goods on bed, G lift, F bulk carry delivery/payment pass; lent placement/return, furniture, household theft, expiry and save/load pass; remote gear still needs two-client proof |
| Pawn medal/lantern, redeem; numbered Berg counter, ticket reading | `game/press.ts` | `Talk/Press.cs`, `Play/PressWorld.cs`: F clerk works; pawn/redeem verified | E at the pawn interior's actual counter still needs the interior owner |
| Buy newspaper from newsboy; read, shipping, wanted jobs, discard | `game/press.ts`, `pockets.ts` | `Talk/Press.cs`, `Pockets.cs`: window/trade present | Newsboys’ nearby cries |
| F post counter, collect waiting mail, take round | `game/press.ts` | `Talk/Press.cs`, `Play/PressWorld.cs`: F clerk / E counter connected | Waiting-mail window existed before; no new collection behaviour |
| E fetch letters, E put under each door, E send telegram | `game/press.ts` LettersRun | `Play/Letters.cs`, `Play/Jobs.cs`, `Net/Api.Play.cs`: implemented and verified | Both 3- and 5-door rounds, telegram fee/pay, task card, book/map and restoration work; continuous walking route not checked here |
| Read own letters, T take errand | `game/press.ts` | `Talk/Press.cs`: present | Errand run above |
| Write / reply to letter at post; choose person, type, send | `game/ideas.ts` | `Play/Ideas.cs`, `Net/Api.Ideas.cs`: paper composer and typed send/reply, AI gate | No-AI option and hostile-line gate checked; actual AI letter needs an AI run |
| Read wall posters / wanted bills | `game/ideas.ts` | `Play/Ideas.cs` with `Talk/Press.cs`: server wall bill prompts | Bill opened in the world on paper |
| Lost things / dog collar, return to owner | `game/ideas.ts` | `Play/Ideas.cs`: street objects, dog and pick/return calls | Server pick/return checked; visual detail needs wider proof |
| Pick/read notebook; return, G squeeze, G sell at Berg | `game/ideas.ts` | `Play/Ideas.cs`: world pick, paper, return/squeeze/sell | Each route checked against a real server |
| Invited meeting: E knock | `game/ideas.ts` | `Play/Ideas.cs`: door prompt and reply | Meeting knock checked |
| Pickpocket behind a person, G; delayed discovery | `game/deeds.ts` | `Play/Deeds.cs`, `Deeds.Thieves.cs`: back-facing prompt, witness and discovery checks | G front/back and server result checked; delayed discovery timing needs wider proof |
| Thief at Jef’s pocket, E catch / collar, lost goods | `game/town.ts`, `deeds.ts`, `follower.ts` | `Play/Deeds.Thieves.cs`: visible thief, catch and loss recovery | Night thief, E catch and recovered money checked |
| Gang demand and menace card, pay/refuse/run, wounds | `game/families.ts`, `game/deeds.ts` | `Game/FamilyScenes.cs` handles family menace; `Play/Gangs.cs` handles three-man night robbery | Three men, paper demand and server pay/fight/run/stand outcomes checked; family menace AI typing gated without AI |
| Lantern E take, L hold/put away, warmth and light | `game/deeds.ts`, `lantern.ts` | `Play/Deeds.cs`: server pocket, E and L, carried model, existing light pool | Take/hold/put away checked; a full night warmth comparison needs wider proof |
| Velocipede E mount/dismount, crash/steps/edge, buy/rent | `game/deeds.ts`, `velocipedes.ts` | `Play/Velocipedes.cs`, `VeloGround.cs`, `Net/Api.Velocipede.cs`: owned/hired E mount/dismount, W/S/A/D/mouse, wheel/bar/lean animation, native collision, steps/edge, rail risk/fall/get-up, maker counter, authoritative buy/hire/leave, remote gear callback. 25 server-backed checks, five close pictures; 10,000 drive calls allocate 0 bytes | Household theft/reactions belong to deeds helper; ruts faded ends, wood surfaces beyond pier, every street/bridge, expiry and save/load pass; remote proof and auditory review still need checks. See `milestones/godot-rides.md` |
| Rowing boat E enter/leave, oars, docking/tow/anchor | `game/rowing.ts`, `boatMoorings.ts` | `Play/Rowing.cs`, `RowPhysics.cs`, `Api.Rowing.cs`: hire, oars/feather/shipping, current/waves, live hull clearance, steps/ladder docking, swimming and quay Space reboarding. 23 real-server checks, six close pictures, 10,000 drive calls allocate 0 bytes | Bridge hails, live leaf headroom, lock approaches/chamber exit and server-priced bridge/ship wrecks are implemented. Household boat taking belongs to deeds helper; save/load and live swimming/quay-jump climbs pass; all nine kinds and owned loose-boat ladder approaches need wider proof. Existing world tow/anchor movement stays with movers. See `milestones/godot-rides.md` |
| Swim/climb/jump onto ships, tide decks and moving frame | `game/rowing.ts`, `lifeAboard.ts`, `main.ts` | `Play/ShipWalk.cs`, `ShipWalk.Gangway.cs`, `World/MeshDeck.cs`: model floors, live tide/heave/roll/travel frame, swim E climb, Space aboard/off, Anna Maria gangway both ways on foot | 12 feature checks including model-board climb, continuous quay/gangway/deck return and underway ship following; 10,000 drive calls allocate 0 bytes. Moving-target climb follows the live frame; 23 ship checks include saved frame restore. Other hull floors and remote frames need wider proof |
| Omnibus stops E board; conductor fare, hop on/off; roof/inside | `game/ride.ts`, `net/api.ts` | `Play/Ride.cs`, `Player/Jef.Transport.cs`, `Movers/Omnibus.Player.cs`: implemented | Server-backed E/Space hop, pay/refuse, roof/inside, moving platform and alight checks pass; free-change/expiry/load and remote host need wider checks |
| Read stop timetable | `game/ride.ts` | `Play/RideStops.cs`, `Play/Ride.cs`, `Net/Api.Transport.cs`: implemented | E at the real stop post opens server timetable on paper; verified at Rijnkaai |
| E crane ladder, climb cabin, E down | `game/craneclimb.ts` | `Play/CraneClimb.cs`, `World/RaisedDeck.cs`, `Movers/Railway.Riders.cs`: implemented | E/W ladder, waiting for gallery, reachable cabin, slew/travel carrying and quay-side dock ladder pass; jump-off and cabin save/load pass in the focused 39-check repeat; saved rungs and multiplayer remain open; a longer dock alignment repeat timed out |
| E bench/bed sleep chooser, hours, wake key, collapse/night sheet | `game/day.ts`, `sleep.ts` | `Play/Day.cs`, `Game/DaySheets.cs`: present | Home beds below; police cell owner above |
| Doss-house rent and week ending, immutable ending paper | `game/day.ts`, `sleep.ts` | `Play/Day.cs`, `Game/DaySheets.cs`: present | Existing tests cover; retain single sheet owner |
| Homes: E notice, numbered rent, own key, bed/storage, furniture | `game/homes.ts`, `net/homesApi.ts` | `Play/HomeLife.cs`, `HomeFurniture.cs`, `PlacesWhere.cs`, `Net/Api.Places.cs`: implemented; [places evidence](godot-places.md) | Nightly rent/key/real bed/wake/fire and plant placement verified; Sunday rent, eviction/storage and other home/furniture classes need broader checks; placed stove warmth/lamp spill/details remain |
| Tavern E counter, drinks, tables, patrons; Poesje show | `game/interiors.ts`, `net/interiorApi.ts` | `Play/InsideCounters.cs`, `TavernSeats.cs`, `Poesje.cs`: implemented; [places evidence](godot-places.md) | Counter drink purchase, actual seated patron and whole paid puppet show verified; table conversation/rounds and Poesje audience/hits remain |
| Dice: E sit, numbered stake, roll, cheat, leave | `game/interiors.ts` | `Play/TavernSeats.cs` connects existing `Talk/Dice.cs` | Real free seat, arrived partner, G dice and numbered 2 c roll/leave verified; cheating remains the existing window, not a new test |
| Ballad: listen, verse/chorus sheet, B buy, sing/learn | `game/ballads.ts` | `Play/Ballads.cs`, `Net/Api.Places.cs`: implemented | Source uses G to buy; sung street lines, server sheet/pocket/read verified. Tavern singer floor/cry between rounds remain; no separate player sing/learn action found in this source |
| Sermon, cathedral prayers/rosary, alms, tower climb | `game/landmarks.ts` | `Play/LandmarkLife.cs`, `CathedralComfort.cs`: partial; [places evidence](godot-places.md) | Real looks/candle/chair/confession gate and timed high-mass sermon/trust verified; congregation nods, organ and church hush remain. Prayers are resident roles; rosary is a shop ware; no separate player alms/prayer/tower action found in listed source |
| Town hall clerks/wedding; Vleeshuis market; Steen/warehouse work | `game/landmarks.ts`, `net/landmarksApi.ts` | `Play/LandmarkLife.cs`, existing `People/HallPeople.cs`: partial | All five engine rosters and actual look/board papers verified; physical residents get ordinary E talk/work. A complete wedding and individual hall jobs have not been exercised; event scene owner remains `godot/events` |
| Emigrant camp, carry bundles/luggage, tender and liner boarding | `game/emigrants.ts`, `lifeAboard.ts` | `Play/Emigrants.cs`, `Town/Townspeople.Places.cs`: implemented | Server-gated luggage, family walk/real lighter deck/liner transfer verified. Baby carry, waving, camp notice and exact prop keepouts remain; full unforced voyage not tested |
| Hiring stand E join, fire bucket line E join/leave | `game/townlife.ts` | `Play/TownWork.cs`: implemented | Real event positions, accepted-once hiring, chain join and walk-away leave verified; physical bucket/chain actors remain with events owner |
| Dock piecework / cart / errands / lamp / mill / park jobs | `game/jobs.ts`, `handcart.ts`, `lampjob.ts`, `mills.ts`, `parkWork.ts` | `Play/DockWork.cs`, `LampWork.cs`, `MillWork.cs`, `ParkWork.cs`, `Jobs.cs`: implemented | Dock piece/7-lamp round/2-turn mill/10-pile park server pay verified; cart loan/take/return works, transport depends on play4. Errands reuse carry/deliver. Mill local snapshot/save and cap/chain visuals remain |
| Night job boxes E deposit/collect, sleeping employers | `game/questboxes.ts`, `nightlife.ts` | `Play/NightBoxes.cs`, `ProofWork`, `Runs.cs`: implemented | Named lit box, held-watch pay and parcel pickup/deposit/collect verified; held task restores. Exact browser box door/wall keepouts need refinement; employers use existing posted people/night hours |
| Back streets, shops, stalls, named resident routines | `game/backlife.ts`, `market.ts`, `lively.ts`, `town.ts`, `stalls.ts`, `shopCalls.ts`, `stallSpots.ts` | `Town/`, `People/`, `Movers/`: partial | Player counter hooks above; routines/events owned elsewhere |
| M map, zoom/pan, key/icons/categories, click route, live job marks | `game/map.ts`, `mapIcons.ts` | `Game/TownMap.cs`, `MapBase.cs`, `MapIcons.cs`, `Movers/MoverMap.cs`: present | New run/transport goals must attach |
| Esc closes top paper; E close; focus/click recapture; no leaking keys | `game/dialogs.ts`, `cursor.ts`, `pause.ts`, `main.ts` | `Windows/Dialogs.cs`, `Game/Wiring.cs`, `Ui/Dialogs.cs`: present | Check each new window on stack |
| P pause; Esc menu; save/load/continue/new game and autosave | `game/pause.ts`, `saves.ts`, `restoreData.ts`, `menu/menu.ts` | `Menu/MainMenu.cs`, `Saves.cs`, `Pause.cs`: present | New local feature state must restore |
| Settings, keys, text size, sound, retro look, population, AI setup | `game/settings.ts`, `prefs.ts`, `menu/apply.ts`, `tuning.ts`, `ai.ts`, `keys.ts` | `Menu/SettingsSheet.cs`, `AiSheet.cs`, `Prefs.cs`, `Keys.cs`, `Apply.cs`: present | New feature must use settings and bindings |
| Character colours/name and preview, help/credits/quit/loading | `menu/character.ts`, `fonts.ts`, `menu.ts` | `Menu/CharacterSheet.cs`, `Sheets.cs`, `Loading.cs`: present | Preview uses existing model hook |
| Ferry arrival and ashore, first-game hints | `game/ferryArrival.ts` | `Play/FerryArrival.cs`, `Api.Arrival.cs`: original ferry and floating landing, lowered plank, five animated passengers, server ashore, work hint and cast-off | 19 feature checks plus zero-allocation model/passenger update probe; continuous plank/58 m landing/quay route on foot. Solo creator, timed nags/guide release, night lamps and manual landing-to-quay walking pass in the 17-check gap repeat. Guest creator/reload before ashore and auditory review remain open; see `milestones/godot-rides.md` |
| Together host/join/leave, remote players and gear | `game/share.ts`, `net/mp/*`, `net/api.ts` | `Net/Mp/`, `Menu/TogetherSheet.cs`: present | New local rides must supply `Together.Gear`; world adapters owned elsewhere |
| Events/director, conversations, funerals, family visits/dreams | `game/events.ts`, `actions.ts`, `steps.ts`, `puppets.ts`, `hearses.ts`, `families.ts` | `Game/Actors.cs`, events owners and NPC puppet adapter | Six requested action scenarios plus seven packet assertions pass; two-client scenes and prisoner room movement remain open |
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

The deeds batch adds police and theft, a carried lantern, lost property and a dog, notebooks, post letters, meeting doors, gifts, tavern rounds, hired work and night gangs. The rows above keep the untested AI and together paths explicit. Other remaining player features and wider ride/place checks stay in their own rows.

## Deeds evidence (2026-10-04)

`node tools/godot/deeds-check.mjs --out deeds-final2 --no-import` passed **65/65** checks with a fresh `--no-ai` server and shared town bake. `godot/baked/deeds-final2/deedstest.json` contains 28 server/fixture replies and 28 PNGs. The runner used ports 8980/8981, waited for `PERF-LOCK`, bounded its Godot process and removed `test.sqlite`. `dotnet build godot`, headless import and `npm run build` pass. The pre-commit hook passed on the implementation commit.

The check includes a witnessed lantern theft and police fine, pursuit/arrest/cell/release, G from behind and E thief collar, a deterministic ordinary lost item and dog collar return, three notebook outcomes, a meeting knock, a hostile police line and hostile letter gate, a server-priced round, named helper wage/arrival/visible work post/stop, and gang pay/fight/run/stand with server money and health. Numbered police choices work without AI; a believable typed story and `let_off` require AI and remain unproved. Letter typing and actual gift/hire acceptance also need an AI run. Together cell handling needs two live players. Per-frame paths cache prompts and collections, but this batch has no dedicated allocation probe. The close pictures were reviewed; the known dark midday street lighting remains [issue #42](https://github.com/Steve-Sitax/Moodygame/issues/42).

Integration edits outside this batch's new files are `Game/Actors.cs` (step routines release the actor reservation), `Town/Townspeople.cs` (ordinary spawn skips reserved people), `Game/FamilyScenes.cs` (no-AI menace typing gate), `Net/Payloads.cs` (typed gift handover) and `Play/TavernSeats.cs` (F guest action and cached seated offers). No server gameplay source, shader kinds, shared bake or light counts changed.

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

Moving-gap ferry proof: 17 checks with Soundscape enabled in `moving-guidance-sound-repeat`, two inspected pictures, real solo creator and guided gangway exit, model night navigation lamps and saloon panes. Vehicle/ship Soundscape inputs allocate 0 B across 100 warmed gathers. Guest creator and auditory review remain open.

Moving-gap save proof: 126 omnibus/cart/velocipede/rowing checks, 23 ship checks, 39 focused crane checks, 24 rowing checks and eight expiry checks. The crane cabin is reached on foot and exited through its door. A longer dock-crane alignment repeat timed out and remains open. Saved rungs, household journeys, prisoner movement and two-client transport remain open. See `milestones/godot-rides.md` for exact local artifacts and scope.

Moving-gap event network status: action NPC/partner claims, releases and kind-3 puppet batches are wired. Seven in-engine wire/interpolation checks and five comparisons with the real browser codec pass. Two-client ownership/event playback, non-Actors scene figures and real prison-room walking remain open.


Moving-gap mover status: tow watchdog, loose-goods rail stopping, crane priority yielding, railway crew/harness and host docker-pile feeds are implemented. Four controlled mover assertions and one real server pile refill pass; overall mover reports still fail timing limits. Ten pictures inspected. Named resident journeys, all crane/pile combinations and active-rowing runtime proof remain open; see milestones/godot-movers.md.


Final moving-gap handoff, exact evidence and shared-file list: `milestones/godot-rides.md`, section "Moving gap final handoff". This is a partial feature handoff; named journeys, prisoner-room movement and live multiplayer validation remain open. Shader repeat passes; mover timing reports fail as recorded.
