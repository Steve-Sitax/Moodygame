# Godot player rides

Worktree `MoodyGame-godot-play4`, branch `godot/play4`. The shared bake is read only.

## Falls

`Play/Falls.cs` listens to Jef's existing measured landing event and calls the typed `Api.Transport.cs` method. Health and injury words come from the unchanged server. Both stone and water landings are reported once at landing. No shared file is needed for this hook.

The initial `--ridetest` batch checks the real server at 2.99, 3, 5, 8 and 12 metres. All 11 checks pass: stone harm is 0/1/2/3/4, water harm is zero. Pictures `godot/baked/ride-falls/fall-3.png`, `fall-5.png`, `fall-8.png`, `fall-12.png` were inspected, at 13:45/clear. The test calls the same reporting owner; these threshold checks do not yet prove a physical fall from every height.

`node tools/godot/ride-check.mjs` imports once, checks PERF-LOCK, runs a real window with seed 1873, port 8985 and map port 8986, enforces a four-minute timeout and removes its test database. Soundscape is disabled: the first sound-enabled run passed the assertions but hit the existing shutdown audio resource problem (issue 40) and crashed at exit. The sound-disabled run exits normally. C# builds with the existing Grime nullable warning.

The self-test explicitly lists unimplemented rides. A successful fall batch does not mean complete ride parity.

## Omnibus

`Play/Ride.cs` owns the browser's boarding and walking rules: E within 2.8 m of a stopped back step, E or Space within 2 m of a rolling step, no goods aboard, a bounded platform/door/aisle, occupied seats respected, F by the roof ladder and E back down. Jef follows the live frame, including turns. Moving alighting checks three landing positions against ground, water and bodies. The conductor comes after 1.8 seconds, accepts 1 to pay through server hopOn, or 2/Esc/15 seconds without an answer to put Jef off where there is room. All fares, changes, needs and tickets remain server-owned. Stop timetable requests have their own typed reply and real post prompts.

The conductor paper is cached between uses, as the browser keeps its fare element: replacing it immediately produced an empty second paper on this renderer. Both pay and refusal papers now have visible ink. Numbered rows and key hints work through the normal dialog stack. A replacement save clears local riding and alights any restored server ticket, as the browser does. Load races and remote-world holds still need dedicated multiplayer tests.

`godot/baked/ride-omnibus-proof/ridetest.json`: 41 checks pass (fall thresholds plus an actual 5.2 m landing reported once, stopped boarding, moving E/Space hopping, fare payment/refusal, roof/inside, moving-platform following, safe alighting and real timetable). Boarding costs the server's 5 c; paying another hop costs another 5 c; refusal costs zero. 10,000 omnibus drive calls allocate zero managed bytes. The test uses the live route but positions Jef and the bus near the Rijnkaai stop; it does not claim a full continuous ride round every line. Close pictures are `omnibus-step`, `omnibus-platform`, `omnibus-roof`, `omnibus-moving`, `omnibus-inside`, `conductor-pay`, `conductor-refuse`, `stop-timetable` in that directory. Midday lighting remains the existing issue 42.

Shared edits for this feature: `Player/Jef.cs` has two hooks (external translation and jump interception); its companion partial file owns transport helpers. `Movers/Omnibus.cs` has one hold check during boarding. `Movers/OmnibusPeople.cs` excludes the player's occupied seat from resident boarding. Their implementations live in `Movers/Omnibus.Player.cs`. No Main, BakedWorld, Solid, Mantle, Wiring, Jobs or Interact change. No new materials, shaders or lights.

## Crane

`Play/CraneClimb.cs` follows the travelling portal on the ladder and the turning jib on the gallery. E grips, W/S climbs, pushing W towards the ladder also grips, and the top waits until the gallery comes round. The browser's ten gallery/cabin floor areas are shared through `World/RaisedDeck.cs`; the cabin is reached through its doorway on foot. E at the head descends; Space launches a normal jump from the gallery. Papers freeze walking but keep Jef on the live frame. The dock ladder approach searches inward for free quay ground instead of requiring Jef to stand over water.

`godot/baked/ride-crane-dock/ridetest.json`: 72 checks pass, 20 pictures, including all previous fall/omnibus checks, real crane slew and runway travel, a complete walk through the cabin, descent, and a second climb/descent at a dock crane from dry quay ground. 10,000 gallery updates allocate zero managed bytes. Close pictures `crane-foot`, `crane-gallery`, `crane-turning`, `crane-cabin`, `crane-travel`, `crane-down`, `crane-dock-ladder`, `crane-dock-gallery` were inspected across the proof/dock batches. Midday remains dark under existing issue 42; the dock ladder picture also shows existing nearby world figures/goods afloat. These tests do not prove all ten ladder approaches, a jump-off, or multiplayer/save replacement.

No additional shared-file edit: `Movers/Railway.Riders.cs` is a partial accessor over existing live cranes. Guarded self-test methods queue ordinary hoist/slew/travel operations through the real crane engine. No crane is stopped for normal climbing, and no new material, shader or light is made.

## Handcart

`Play/Handcarts.cs` draws owned, hired, taken and lent carts from ModelLibrary. E grips/releases, normal Jef walking pushes with the browser's load pace, mouse turning swings the whole cart, and the bed tilts with raised grips. All eleven bed/wheel/shaft probes must fit flat open ground, clear of water, walls and live street walkers. The pure `CartPhysics.cs` ports the browser's translation/turn fallbacks and working free from a wedge. Reused ray/shape casts avoid managed allocations. Parked carts are solid. Release refuses the train's rails and the browser's 0.6 m crane-rail bands; teleport or another transport releases at the old place. Server position/seen reports and periodic authoritative refresh keep hire, ownership and load facts on the server. A restored server hold is released; gear is supplied through Together's existing callback, chained for other transports.

Loading moves each original goods model onto the bed, with no duplicate stand-in. Its four slots are 0.2 m above the axle pivot, as goods.ts specifies: the first picture inspection found coils hidden under the bed when this pivot offset was missing. The corrected close picture shows both coils. G lifts the top item back into Jef's arms, preserving its server id. F unloads allowed carry jobs in bulk; the server clears their job tags, and the existing run is told the delivery fact separately to settle and pay. Foreman-watched carry jobs and person deliveries remain one by one.

`godot/baked/ride-cart-edges/ridetest.json`: 45 checks pass, five pictures (the equivalent final batch was inspected) (`handcart-grips`, `handcart-pushing`, `handcart-loaded`, `handcart-unloaded`, `handcart-hired`). The server charges 200 c for the used cart, 12 c for 840 minutes' hire, and pays 90 c for the two-coil carry job. 10,000 collision calls and 10,000 held-model updates each allocate zero managed bytes. The earlier timed collision probe averaged 119 microseconds per call; this is not a whole-frame performance measurement. Pure rules additionally check the bed's side at a wall, a 10 cm step, a wheel's water margin and escaping a wedge. The fixture places carts through bounded server position reports; it does not claim a full continuous delivery route.

Remaining: furniture in arms must connect to the homes owner; household taking/witnesses to the deeds owner; lent-job return to the special-jobs owner. Lent-cart placement searches for a physically reachable grip but has no server-backed lent-job proof yet. Hire expiry, capacity refusal, rail release refusal, every cargo model, save replacement and remote gear need dedicated checks. The browser's wooden-pier water exclusion and crane-rail bands now have direct checks; a continuous push onto the pier is still unproven. Other bridges and raised wooden decks need the same water/ground audit. These are explicit gaps, not complete handcart parity.

Shared edits for this feature: `Player/Jef.cs` adds the cart constraint after its ordinary walking step (seven lines); `Player/Jef.Transport.cs` declares the callback. `Play/Jobs.cs` inserts the cart-loading action before its carried-goods actions (one line). Their implementations and delivery handoff live in `Goods.Handcart.cs` and `Jobs.Handcart.cs`. No Main, BakedWorld, Solid, Mantle, Wiring, Interact or Movers implementation edit. No new shader kind or light.

## Velocipede

`Play/Velocipedes.cs` loads the machine once at startup, keeps parked machines solid, and offers E for machines the server says are Jef's. The maker's Interact prompt opens the ordinary paper shop for buying/hiring. Mount/leave/seen use the existing server routes through `Api.Velocipede.cs`. The deeds helper retains taking household machines, witnesses and police; it can hand an already taken authoritative machine to `Mount`. No local money, hire time or injury is invented.

W pedals, S brakes/backs, A/D turn the bar and camera, the mouse steers toward the view while allowing a look around. The browser's speeds, acceleration, wheelbase, load-free requirement, ground-kind limits, steering, rail-groove/rut risk and 1.6-second get-up are ported. Native reusable ray and cylinder casts check floors, walls, steps and the water ahead. The feet follow the ground; the original front/rear wheels and steering fork animate, with saddle bob and lean. `VeloGround.cs` indexes the city's earth/flagstone triangles, the exact smoothed railway heads and crane rails, and baked rut triangles once. Wooden pier exclusion is shared in the ride's water check. Startup releases restored server rides, and a missing/expired machine clears the local ride. Together's gear callback is chained to the cart callback.

`godot/baked/ride-velo-crash/ridetest.json`: 25 checks pass, five close pictures inspected (`velocipede-parked`, `velocipede-riding`, `velocipede-dismounted`, `velocipede-edge`, `velocipede-crash`). The server charges 600 c used and 30 c for 840 minutes' hire. Both owned/hired E mounting work. The test pedals two metres on real ground, steers, brakes, dismounts, refuses an actual 20 cm raised slab and the quay edge, and exercises a fast real railway-groove fall. A ridetest-only dice fixture waits for speed above 3.5 m/s and then selects the ordinary risk/fall branch; it does not bypass the ground or server leave logic. The server confirms `down`, and Jef gets up. 10,000 drive calls allocate zero managed bytes. The first frame-count movement check was too short on a fast renderer; it now waits for distance with a bounded timeout.

Remaining: the browser's faded rut ends are not filtered by vertex alpha, wood surfaces beyond the pier need a surface audit, and every route/bridge, hire expiry, save replacement, remote appearance and sound need dedicated proof. The crash picture is deliberately close while Jef is low on the stones, showing part of the fallen machine; midday darkness remains issue 42. Native floor/wall checks are a port to the drawn Godot geometry, not a claim that every browser walk-map edge is identical.

Shared edits: `Player/Jef.cs` passes a driven camera roll through its existing ride hook (one changed line); `Player/Jef.Transport.cs` adds that roll field. The already owned `Movers/Railway.Riders.cs` partial exposes the existing smoothed rail-line helper at load time. No other shared implementation file changed for this feature. No new shader kind or light.

## Rowing

`Play/Rowing.cs` owns hired and already owned boats; `RowPhysics.cs` ports the browser's nine hulls, stroke/catch, hard pulling, backing, unequal oars, drag, turning, current, wave pitch/roll, three-point hull clearance and bump/fend fallbacks. Oars dip, feather and ship near a bank. The original ModelLibrary hull is used, with materials/mesh resources loaded before play. Live moving and moored hulls, native solids, water margins and canal mud are checked without frame lists. `World/BoatWater.cs` samples the browser's triangular wave surface. E leaves through reachable steps/ladders or into the water, and an abandoned hired hull preserves heading and river drift. E from swimming climbs aboard; Space/E from a quay makes a bounded jump to the thwart. Server calls own hire, effort, return and fines. A load releases a restored server ride rather than claiming a saved client pose was proved.

`godot/baked/ride-row-reboard-2/ridetest.json`: 23 checks pass, six close midday/clear pictures inspected (`rowing-hire`, `rowing-thwart`, `rowing-oars`, `rowing-returned`, `rowing-swimming`, `rowing-quay-jump`). The server charges 10 c for two hours, confirms hard strokes, return, and two reboardings. Actual water propulsion and turning pass; fixture placement then checks the ordinary exit, climb and jump paths. 10,000 drive calls allocate zero managed bytes. Midday remains dark (existing issue 42).

Remaining: household boat taking/witnesses belong to the deeds helper; already Mine boats have a typed mount handoff but no dedicated proof. Every small hull, loose-boat ladder approach, flooded hire steps, sounds, map marks, save/remote appearance, full continuous bridge/lock passages still need tests. Tow and anchor in the supplied browser sources describe world traffic, whose existing movers remain in charge; no invented player tow/anchor command is added. This row is partial.

Shared edits: `Movers/Boats.cs` passes both MultiMesh drawing paths through the owned partial's visibility filter (two lines). `Movers/Boats.Player.cs` hides the exact baked small hull when the local model takes it over and exposes allocation-free live hull clearance. `Player/Jef.Transport.cs` adds the water entry handoff used after leaving a thwart. No Main, BakedWorld, Solid, Mantle, Wiring, Interact or other Movers implementation edit.

## Rowing through bridges and the lock

The rower checks the browser's actual lifting-leaf underside (including the lock bridge), hull ends and seated head. Low headroom hails the real bridge keeper; leaving or rowing away releases the request. Closed lock gates refuse the whole hull, and the keeper chooses the approach side, then the opposite side once the rower is inside the chamber. A lowering leaf or a moving large hull runs the ordinary wreck path: the boat is removed, Jef goes into the water, and the unchanged server prices the loss through `Api.RowLost`.

`godot/baked/ride-navigation-final/ridetest.json`: all 16 checks pass; both close midday/clear pictures were inspected. The dedicated `--ride-only navigation` test uses a ridetest-only headroom fixture, like the browser's dev tall-rower check. It exercises the live bridge, gates and levelling rather than bypassing their movers; position fixtures place the hull on each side and in the chamber. Close pictures are `rowing-bridge.png` and `rowing-lock.png`. This is not a claim of continuous rowing through every approach. The rower's wave sampling now uses the browser's full beam and 0.8 hull half-length.

Shared edit: `Movers/Lock.cs` wraps its existing boat-request gate selection in `PlayerTarget` (one line). The approach/chamber logic and leaf underside accessor live in the owned partial files `Lock.Rowing.cs` and `Bridges.Player.cs`. Their per-frame loops use concrete lists and cached callbacks. No shader, material or light is made while rowing.

The combined ride check also exposed a cart interaction priority of zero. The cart now supplies its actual nearest-part distance, as the browser does. Test vehicles park clear of the next fixture, and each scenario resets its picture/tide hour to midday without stopping the movers.

## Ship decks and Anna Maria's gangway

`ShipWalk.cs` loads walkable floor/headroom cells from each original large-hull model, follows moored and travelling live frames, and offers E from water or quay to climb aboard. Space boards a reachable ship after the existing rowboat/omnibus handlers have had their turn; Space aboard launches Jef's ordinary jump. Deck movement stays within cells with room for a body and preserves the frame's heave, roll, yaw and translation. Replacing the week clears local riding and cancels an old climb callback.

Anna Maria's baked gangway is claimed from Solid before construction, then tilted at its live deck height. Its four-metre plank follows the browser's length and half-width. Walking down it has a dedicated floor: ordinary native body collision against the quay wall otherwise traps Jef while the low-tide ramp is below street level. He can walk from the quay to her deck and back without jumping, including while carrying goods at their ordinary pace. The deck head is measured once at load.

The ship portion of `godot/baked/ride-all-final/ridetest.json` passes 12 feature checks; its five close midday/clear pictures (`ship-gangway`, `ship-swim`, `ship-aboard`, `ship-walking`, `ship-moving`) were inspected. The live underway frame moves more than 0.2 m while Jef remains on its model floor; 10,000 frame walking calls allocate zero managed bytes. The test positions the swimmer at a moored hengst and directly attaches to an underway vessel, so it does not claim a continuous swim/jump approach to every moving hull. The moving picture looks down across the side deck and rail.

Shared edit: `Player/Jef.cs` takes the highest permitted transport/native ground at its three floor returns (one callback declaration in `Jef.Transport.cs`). This preserves native ground above a deck while supporting tide floors. No Main, BakedWorld, Solid implementation, Mantle, Wiring, Interact or additional Movers implementation edit. No new material, shader kind or light during play. Still to prove: every hull's floor and obstacle layout, a climb endpoint that follows a ship during the climb, swimmer hull clearance at all moving hulls, saved/remote frame restoration and deck footsteps.

The final `ride-water-final` check also tests 10,000 ship deck/gangway update calls with zero managed bytes; its five ship pictures were inspected. The combined check remains the 194-check full transport proof.

## Ferry arrival and first hint

`FerryArrival.cs` asks the unchanged server for the arrival stage and uses the existing character sheet when the server requests it. Original ModelLibrary ferry and landing models load before play; public GLB extras supply the gangway and landing furniture. Five original animated passengers queue across the lowered plank, wait behind Jef, and walk around the landing furniture. The ferryman raises the plank and casts off only after all five and Jef are ashore. Crossing the landing reports `api/arrival/ashore` and gives the browser's work-board hint. An ashore game does not restart the arrival. Browser nag/guide timing and departure motion are ported.

The measured deck joins a startup-made wooden plank with rope rails, the floating 58 m landing and its six-metre quay ramp. Jef can walk the whole route into town without a jump. Floors and furniture paths are measured at load/start; the ferryman's floor search is cached. No material, shader kind or light is added while playing. The ferry and stage contribute to the existing rowing water-clearance callback.

`godot/baked/ride-all-final/ridetest.json` passes 194 checks across all rides, with 45 close midday/clear pictures individually inspected. Its ferry portion passes 19 feature checks. The later `ride-water-final/ridetest.json` passes all 34 ship/ferry checks, including the two added model-update allocation probes, with nine individually inspected pictures. The ferry tests prove the real ashore server reply, all five passengers leaving, cast-off and movement, the continuous stage/quay walk, and zero missing sampled passenger floors. They do not measure each animated sole against each rendered plank. Both 10,000 warmed ferry drive calls and 10,000 warmed model/passenger update calls allocate zero managed bytes; these are not whole-frame performance claims.

Remaining: guest creator and reload before ashore, 35/75-second nags and 115-second guide need dedicated scenarios. Night lamps, sounds, steam/smoke, every tide and arrival remote/save coordinates remain unproved or absent. Existing midday darkness is issue 42. The generated plank uses existing model wood/rope materials; it is not a bake into the shared folder.

Shared edit for ferry: `Movers/Boats.Player.cs` gains an allocation-free registered water-clearance list (two lines). The remaining implementation is in owned new files. No Main, BakedWorld, Solid implementation, Mantle, Wiring, Interact, Jobs or Movers implementation edit is needed for ferry.

## Integration and final checks

Run `node tools/godot/ride-check.mjs --out <name>` for the bounded no-AI real-server ride check; `--only navigation` exercises bridge and lock keepers, and `--only water` exercises ship/ferry paths. The default uses the shared town/models read-only, owns ports 8985/8986, waits for PERF-LOCK, writes replies and pictures into this worktree, and removes its test database and child process tree. All new C# files have been imported. `dotnet build godot` passes with the existing Grime.cs nullable warning; the repository's npm build and commit hook pass. No game-server rules or numbers were changed.

Shared implementation files changed across this branch: `Player/Jef.cs` (ride/jump/camera/cart and permitted deck floor hooks); `Play/Jobs.cs` (one cart-loading prompt hook); `Movers/Omnibus.cs` (hold the boarding vehicle); `Movers/OmnibusPeople.cs` (reserve the player seat); `Movers/Boats.cs` (two exact local-hull visibility filters); `Movers/Lock.cs` (one rower gate-target hook). Shared Movers additions are owned partials `Boats.Player.cs`, `Bridges.Player.cs`, `Lock.Rowing.cs`, `Omnibus.Player.cs` and `Railway.Riders.cs`. `Player/Jef.Transport.cs` is the owned partial containing the transport hooks. `World/RaisedDeck.cs` is a new shared frame/floor helper for the crane galleries. No other shared implementation files changed. Inventory edits are limited to this agent's transport/fall rows.

## Moving gaps: moving climb endpoint (2026-10-04)

`godot/gaps-moving` uses the shared next bake read-only, ports 8905/8906. Ship climbs interpolate in the live deck frame, including translation, yaw, heave and roll. `Jef.ClimbTo` accepts an optional frame; fixed landings keep their original behavior. The server-backed ship repeat passed 16 checks, including climbing onto an underway hull and landing within 5 cm of its current deck position. Both 10,000-call allocation probes remain zero. Five PNGs in `godot/baked/moving-ship` were viewed; the existing underway camera points too high and needs a clearer replacement. No light or material change. Shared file: `Player/Jef.cs`, optional frame and two transform reads.

## Moving gaps: ferry and sound (2026-10-04)

`godot/baked/moving-ferry-scenarios/ridetest.json` passes 14 checks: real solo character submission, ferry boarding, warnings at 35/75 seconds, guidance at 115 seconds and actual gangway exit, fixed-pool night lamps and model saloon panes. Both close pictures were inspected. MovingSounds supplies the existing Soundscape vehicle and ship hooks with reusable lists; 100 warmed gathers allocate zero bytes. This verifies sound inputs, not an auditory review. The true guest creator still needs two-client proof. Smoke is left to the existing `godot/gaps-look` branch. No runtime light or shader kinds are created.

## Moving gaps: saved transport and approaches (2026-10-04)

RideSaves stores feet plus local ride state in the server's existing client-state envelope. The real save-menu load dispatch restores only an authoritative held cart, mounted velocipede, rowing hire/owned boat or valid omnibus ticket. Ship and crane saves validate the existing deck cells and live frame. `moving-saved-rides/ridetest.json` passes 126 checks (19 pictures); `moving-ship` passes 23 (five pictures); `moving-crane` passes 39 (eight pictures); `moving-row` passes 24 (six pictures); `moving-expiry` passes eight. The focused crane check walks the cabin door both ways, rides actual slew/runway travel and returns through both quay ladders. A longer repeat found a dock crane still unable to align with its ladder within 50 seconds; that unresolved clearance scenario remains in the diagnostic log. Saved ladder-rung state is implemented but not exercised.

The browser hire rule is preserved: an expired mounted/held hire remains with Jef until he releases it; a later server tick collects it. No client timer takes possessions away. Rowing climbs now have separate swimming, quay-jump, steps and owned-boat ladder approaches with a live final thwart. The hire/swim/jump/steps approaches pass; every owned loose-boat ladder and all nine hull kinds remain open. Warm 10,000-call ride/ship/rowing/cart probes still allocate zero bytes.

Together adds the protocol-5 omnibus local frame (base 1, bus index), with a sub-millimetre local/world reconstruction check. Existing boat/cart/velocipede gear hooks remain chained. Actual two-client ride and guest-ferry creator proof remains open. Named household transport journeys and prisoner room walking are not implemented by this batch. Smoke stays with the look helper.


## Ferry guide completion (2026-10-04)

The 115-second guide uses the browser deck path and gangway waypoints at 1.1 m/s, faces along its walk and releases at the landing. A one-shot latch prevents the guide restarting while the ashore reply is in flight. Small waypoint moves use a normalized direction, preventing an asymptotically slow hinge approach. The pontoon's existing drive remains until the normal quay exit.

`moving-guidance-repeat/ridetest.json` passes 17 checks, including the actual solo creator, both nags, night lamps, guide release and manual walking from landing to quay. Both pictures were inspected. The sound-enabled repeat released the guide successfully but ran out of the old 35-second wall-clock allowance six metres short of the pontoon end; the fixture now allows 75 seconds. Auditory review and guest creator remain open.


## Moving gap final handoff (2026-10-04)

Worktree: D:/Code/MoodyGame-godot-gaps-moving, branch godot/gaps-moving. Nothing pushed or merged. Every code item is committed with the required author trailer; explicit-path pre-commit checks passed. The shared bake was read only, PERF-LOCK was observed and only ports 8905–8909 were used. Own test databases and processes are gone. Unrelated import-generated .cs.uid files remain untracked.

Final evidence (local ignored artifacts, overlapping checks):

| Artifact under godot/baked | Outcome | Inspected pictures |
|---|---|---:|
| moving-saved-rides | 126 checks pass: real save/menu-load while on omnibus, cart, velocipede and rowing boat | 19 |
| moving-crane | 39 checks pass: reachable gallery/cabin, movement carrying, door exit and saved crane frame | 8 |
| moving-ship-final | 23 checks pass: live moving climb, deck/gangway and saved ship frame | 5 |
| moving-row | 24 checks pass: rowing and live swimming/quay boarding | 6 |
| moving-expiry | 8 checks pass: mounted hires retained, released overdue hires collected on server tick | 0 |
| moving-velo | 32 checks pass | 5 |
| moving-guidance-sound-repeat | 17 checks pass with Soundscape enabled; solo creator, both nags, guide release, night lamps and walk to quay; 100 warmed sound gathers allocate 0 B | 2 |
| moving-movers-final | Four feature assertions pass; overall timing fails | 8 |
| moving-feeds-final | One actual server-confirmed crane pile refill; overall timing fails | 2 |
| moving-rowing-crew | Two feature assertions pass; overall timing fails | 4 |
| moving-events-final | Seven wire/interpolation assertions and six requested action scenarios pass | 6 |
| puppet-wire | Five real browser/C# codec comparisons pass | 0 |
| moving-shaders-final | Pass: 103 initial/final programs, zero new shader kinds | 0 |

All 65 pictures listed above were inspected. Images remain local. Build passes with the two existing Grime/Deeds nullable warnings. npm run build and whitespace checks pass. The mover failures are not hidden: warm means 1.4859 ms and 1.3457 ms in the obstruction/crew tours, and an 18.091 ms peak in the pile-feed tour. Per Steve's instruction no optimisation pass was made.

Still open for implementation: named household transport journeys and Jef travelling alongside them; actual prisoner hall/cell movement; live two-client remote rides, guest ferry creator and action NPC contention/handoff/release/event playback. The action network adapter and omnibus local-frame hooks are wired, but those are not live multiplayer proof. Still open for wider proof/detail: saved crane rungs, all nine rowing hulls and owned loose-boat ladders, occupied rowing traffic encounters, all cooperative portal retreat pairs and crane/pile pairs, exact chain-link harness geometry, auditory review. The long dock-crane gallery alignment repeat timed out; the focused cabin repeat passes. Steam/smoke was left to the existing godot/gaps-look branch, without reading or editing its worktree.

Existing shared source files touched by this helper (new partial owners are listed by git, not included here):

- Player/Jef.cs: optional live climb frame.
- Audio/SoundWiring.cs: transport wood footsteps.
- Menu/MainMenu.cs: capture ride state in client saves; retain the actual menu load/replacement path in ride tests.
- Net/Mp/Together.cs: omnibus local-frame sampling and placement.
- Game/Actors.cs and Actors.Ownership.cs: claim/remote adapter hooks and numeric ownership.
- Dev/EventTest.cs: puppet test selector.
- Movers/BoatLamps.cs: ferry registration into the fixed pool.
- Movers/Anchorage.cs, River.cs and Railway.cs: yielding, crew/feed/sound/obstruction hooks and probe registration.
- Play/ShipWalk.cs, Ride.cs, Handcarts.cs, Velocipedes.cs, Rowing.cs and CraneClimb.cs: saved-state and live approach hooks.
- Play/FerryArrival.cs and RideTest.cs: arrival stats/guidance and extended ride checks.
- tools/godot/ride-check.mjs: own-port/lock/timeouts/disposable database guard, test selectors and optional sound.
- CHANGELOG.md, docs/godot-play-inventory.md, docs/godot-net.md, docs/godot-events.md and the ride/mover milestone handoffs.

No shared Main.cs, BakedWorld.cs, Solid.cs, Psx.cs, shader or server production rule was edited by this helper. New typed calls are isolated in Net/Api.Moving.cs.

## Moving gaps round two (2026-10-05)

Branch `godot/gaps-moving`, merged with `godot-port` d863562. Ports 8905-8908 only; no test database or process left.

What was added:

- Named resident journeys (`Play/ResidentJourneys.cs`, `Movers/Omnibus.Journeys.cs`, one hook in `Town/Townspeople.cs`): server/town/transport.ts rules choose the omnibus for long connected trips; the resident walks to the stop, boards a real free seat, rides, alights at the planned stop, walks on and is released. Jef can ride in the same bus.
- Prison people (`People/PrisonPeople.cs`, data generated by `tools/godot/prison-data.mjs` from shared/prisonPlan.ts): warders, pacing prisoners, the exercise ring by the server's roster and hours; event townspeople whose target is inside walk the prison floor grid from the gate.
- Saved crane rungs: the load checks the saved numbers; the rung test climbs above 3 m (below that the crane rightly stops for Jef under its legs).
- Nine rowing hulls: `--only hulls` sits Jef in each small-boat kind beside his hired boat and rows it.
- Two-game proof: `--mptest <dir> --mpmoving` (host port 8907, guest 8908). The host's event townsperson is owned by the host on both games, the guest's claim is refused, the guest draws him from the replica, the release reaches both, the host rides an omnibus and the guest draws him in that bus's frame, and the guest's character sheet boards its ferry. A platform rider now skips the walking-jump smoothing (`Net/Mp/Together.cs`), which had left him up to 2.2 m off the bus floor.
- Fixes found by the checks: ferry passengers finish their pontoon walk after the ferry leaves (they froze in the exit); omnibus waiters are only called when they fit (a standing waiter vanished at the step).

Final results (local artifacts under godot/baked):

| Check | Result |
|---|---|
| final-journeys | 15 pass, 2 pictures |
| final-prison | 7 pass, 2 pictures (hall grille, yard ring) |
| final-crane-rungs | 15 pass, 2 pictures |
| final-hulls | 24 pass (9 hulls, seat error 0, each rowed 0.8 m) |
| final-crane | 39 pass, 8 pictures |
| final-ferry (ferry-scenarios) | 17 pass |
| final-omni1, final-omni2 | 37 pass each |
| final-events (puppets, actions, omnibus) | 8 stages, no failures |
| final-movers2 (omnibus) | all probes move; overall fails on the known speed limits only (Rijnkaai mean 1.44 ms, tour peak 18 ms) |
| final-shaders | pass: 104 programs, 0 new kinds, 0 problems |
| moving-mp | pass 6 times in a row with the bus fix: claim, refused steal, replica walk 1.0 m, release, rider gap 0 m, guest sheet and ferry |

Open: the full `--only all` ride run passes each part alone but timed steps (bus hop, platform travel) flake when another Godot runs at the same time; the full movers and event runs exceed the harness's 6-minute limit. The guest's ride picture does not face the bus (the guest's view yaw is overridden while its character sheet is open); the numbers prove the placement. Owned loose-boat ladders, two-game boat/cart/velocipede gear rides, a live AI prison action and the auditory review stay open.

Shared files touched: `Net/Mp/Together.cs` (platform rider smoothing), `Net/Mp/MpTest.cs` (`--mpmoving` hook), `Movers/OmnibusWaiters.cs` (waiters that fit), `Play/FerryArrival.cs` (passengers finish), `Town/Townspeople.cs` (journey hook), `Play/RideTest.cs`, `Net/Api.Moving.cs`, CHANGELOG.md.
