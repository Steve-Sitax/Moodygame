# M6 - How the town gets about (transport), 2026-09-24

Why (Steve, 2026-09-24): "Make sure NPCs can use transportation to where they want to go if applicable. If they need to go far and have a bike, use bike. But if they need to carry a big load, use a cart. Other family members can help load carts if multiple items. NPCs can also take the omnibus, no ride fee for them. Or they can take a boat also, for loads if they own one or multiple people move." Later the same day: "Also add a bike shop so we can buy and own a bike", and then "bikes don't get damage" (no damage, no repair).

Not committed yet: the main session checks it in the browser and commits it.

## Who owns what (the engine, `server/src/town/possessions.ts`)
Made once per town from its seed, by trade and wealth, and kept in world_state `transport` (version 3). A save made before this gets it on its next start; residents, memories, Jef and the M3h velocipede states stay as they were (tested on a copy of Steve's save).

| What | Who | Where it stands |
|---|---|---|
| Velocipedes (10 in the test town) | The six of M3h (two merchants, the brewer, a draper or the pawnbroker, the publican of Den Engel, a clerk at the Entrepot), then up to three men of some means (household wealth 3 or more, 17-52, youngest first; natie men are shareholders of their nation) and up to two clerks, but only men whose week takes them further than 300 m. The town is small: few go that far, most of them only on Sunday to mass. | Home: where M3h put it (by the door); a spot at each place of the owner's week. |
| Handcarts (17) | One per household of a carter, market woman, fishwife, grocer, chandler or the second-hand dealer (the very poorest carry by hand). | Home: beside the door, the shafts to the street; a spot by the stall or the door of the work. |
| Drays with a horse (3) | The three drays of the quay traffic (`world/traffic.ts`): two carters and a merchant. | Their round; their yard is the round's stop. |
| Rowing boats (3) | The boats tied up at quay steps (`rowing.ts` LOOSE): boatmen and quay households. | Their berth at the steps. |

Every spot is open ground with room round it (1.25 m for a cart), reachable, off the omnibus rounds, the drays' rounds, the quay railway and the crane runways, and off every house door, stall and shop table. The lanes are copied from `omnibus.ts` and `traffic.ts` into `possessions.ts` LANES: keep them in step if a round moves.

## How they go (`server/src/town/transport.ts`, pure, used by both sides)
`chooseMode`, in order:
1. A load: the family boat when both ends lie by one water; the dray for a big load (3 things or more); else the handcart; else the dray; with none of them, carried by hand.
2. A family of two or more going along the water in their boat (at least 120 m).
3. Up to 300 m (`WALK_MAX_M`): walk.
4. A long way with the owner's velocipede standing where the trip starts (and the rider 15-59): ride.
5. A long way with an omnibus stop within 170 m of both ends: the omnibus, when it is at most 1.25 times the walk (the wait is the real time until the next omnibus of the line stands at the stop, from where the omnibuses are). No fare for residents (`RESIDENT_FARE_C = 0`; the 5 c fare of `ride.ts` is Jef's alone).
6. Else walk.

Loads by the day (`scheduleLoad`): a market woman, fishwife, grocer or the dealer takes 2 to 4 things from home to the stall in the morning, and brings one home at night. Loading (`planLoading`): the one who goes and up to three of the household who are at home and 10 or older carry one thing each per round.

Where an owner's velocipede or cart stands now (`vehicleAt`): a velocipede leaves the house only for a long trip and then goes wherever its owner goes, so it comes home with him; a cart moves only with a load, or home again. The server uses this for theft (`deeds.ts veloHooks.at`: an owner's machine at his work can be taken there); the client parks it there.

## Errands with a load (`errandsFor`, engine-made per day, none on Sunday)
- Each family boat rows two sacks to another flight of steps on its own water (the river: the Vismarkt, the Rijnkaai, the cart stand, north of the lock), the owner at the oars, family members at home come along; it lies there, and they row it home at the errand's end (2.5 game hours).
- Each dray goes from its yard to a nearby shop door with three sacks: the owner leads it through the streets, carries the sacks to the door, and leads it back; the quay traffic dray is not drawn meanwhile.

## In the street (`client/src/game/journeys.ts`, new)
- Far off and unseen, a trip is timed by its mode: the town's unseen pace times the mode's speed (velocipede 4.2, cart 0.95, dray 1.2, walk 1.3 m/s).
- Near Jef it is seen:
  - Velocipede: the owner walks to his machine (it is gone from his door meanwhile, not solid, not to be taken), rides at 4 m/s on the crowd's grid, pedalling (the new `ride` clip, its loop set from the front wheel, so the feet stay on the pedals), and leans it at the spot at the other end.
  - Handcart: the family comes out of the door and carries the goods to the cart one by one (each thing shows on it: crates, sacks, baskets, fish tubs, chairs); then they go back in and the cart is pushed off (the `push` clip for anyone; `PushCart` from `traffic.ts` with its items); at the stall the things are carried off it and the cart stands there till the evening.
  - Omnibus: they walk to the stop, wait by the post, get on when an omnibus of the line stands there (`omnibus.ts boardResident`: men sit inside, a woman stands on the back platform), ride, and step off at their stop.
  - Dray: `traffic.ts LedDray`: the owner at the horse's head, the horse, fore-carriage and bed following the ground he walked, so the rig keeps to his way round the corners.
  - Boat: they walk to their steps, row out (`rowing.ts townBoatOut`: the rower on the thwart with the new `row` clip, the oars swept with his stroke, the family sitting, the sacks in the stern), row along open water (`waterPath`, an A* over `boatFree` water; never through the lock, never under an opening bridge, never where the tide has left less than 0.6 m), tie up at the other steps and go up them.
- M4 actions and events: someone sent far across town unseen goes at the pace of their way (their own velocipede if it is at home: `town.hiddenPace`); onlookers who come by omnibus (`actions.ts byTram`) now really ride one: unseen to the stop of the line nearest them, onto the next omnibus that stands there, inside it, and off the back platform at the event's stop.
- The drays of the quay traffic show their owner at the horse's head and stand in the yard when his day is done.

## Theft
A parked velocipede outside a home or a workplace is its owner's (the M3h rules apply as before). The owner uses it only if it is there. If Jef has it, the owner walks; when he goes for it on a long trip he is cross (a bubble line if Jef is near) and the server gives him a memory once per theft (`ownerMissed`); the theft's own memories and rumours are the M3h rules. Handcarts cannot be taken by Jef (he has no way to push one).

## The velocipede maker (`server/src/town/bikeshop.ts`, `trade.ts` ITEM_BUY)
- Research (quick): the pedal velocipede came out of Paris in the 1860s (Michaux, the Compagnie parisienne des velocipedes 1867-69); carriage makers and smiths built them and sold them abroad. In 1868 machines were advertised in France at 200 to 400 francs (a boy's from 120); a fine iron one with bronze fittings, a brake and a varnished saddle cost 270 francs in 1869. We found no named velocipede maker in Antwerp in 1873: a smith who builds and hires out boneshakers is plausible, not a traced address. Sources: en.wikipedia.org/wiki/Velocipede ; en.wikipedia.org/wiki/French_bicycle_industry ; onlinebicyclemuseum.co.uk/1866-michaux-serpentine-velocipede/ ; fr.wikipedia.org/wiki/V%C3%A9locip%C3%A8de .
- A NEW resident, the velocipede maker (trade `velo_maker`), in a free house nearest (-150, 96) between the Vleeshuis and the canal, with the place `velo_shop`, a "VELOCIPEDES" board over the door and two machines on show in his hours (8-12:30, 13:30-18:30).
- Prices (engine, `VELO_PRICE`, in proportion to the game's pay, a job 50-150 c): a second-hand machine 600 c (a hard week's saving), a new one 1200 c, a day's hire 30 c. Bought through the ordinary wares (F in talk); never a pocket slot; one machine of his own and one hire at a time.
- Owning: Jef's machine is saved on the server (world_state `jef_velos` and the M3h velocipede states with `own`); it stands where he left it (also after a reload) and he rides it with the M3h controls, with no deed.
- Hire: 14 game hours; not back at the maker's door by then, his boy fetches it and the maker takes 15 c (what Jef has).
- Theft of Jef's machine: left alone in a busy place (within 30 m of a market, a quay or a tavern door; Jef not within 25 m, as the client tells the server every 5 s), 4 % each game hour by day and 8 % at night. At his rented home's door and at the maker's it is safe. Then it is gone, a townsperson working near saw a man ride off (a rumour, tone 0), and it is a robbery of Jef on the record (log `robbed`, a pickpocket of the town, its price as its worth): the M4 police case takes it up, and a thief the police catch pays its worth back (the engine's fixed outcome in `director/convo.ts`).
- No damage and no repair (Steve).

## Clips (`tools/blender/build_people.py` -> `people.glb`)
Two clips appended after the others: `ride` (pedalling; legs by two-bone IK onto the crank circle of the front hub, keyed every frame) and `row` (on a thwart facing the stern, a two-second stroke). `push` already existed and is now played by anyone pushing a cart. Hash check (`node tools/blender/glbhash.mjs <file.glb>`, per mesh primitive, skin, image and animation): a rebuild of the old script was byte-identical; after the change all 40 figures, their skins and images and the 19 old clips hash the same, and only `anim:ride` (33d75d34095a0e52) and `anim:row` (cf7616d438dcbba3) are new.

## Files
- New: `server/src/town/transport.ts`, `possessions.ts`, `bikeshop.ts`, `transportRoutes.ts`; `server/test/transport.test.ts`; `client/src/game/journeys.ts`; `data/vite-test-transport.config.mjs`.
- Changed: `server/src/town/deeds.ts` (veloHooks: more velocipedes, positions by the owner's day, Jef's own; `setVeloState`), `server/src/trade.ts` (the maker's wares, `ITEM_BUY`), `server/src/town/places.ts` (trade `velo_maker`), `server/src/db.ts` and `index.ts` (the ensure calls, the routes: small), `server/test/deeds.test.ts` (the velocipede count), `client/src/game/crowd.ts` (puppet vehicles), `town.ts` (trips, errands), `humans.ts` (ride, row, push), `actions.ts` (the pace of the way, real omnibus rides), `velocipedes.ts` (owners using theirs, the model for riders, an empty list survives), `client/src/world/omnibus.ts` (named passengers), `traffic.ts` (items on a cart, dray owners, the led dray), `client/src/game/rowing.ts` (the town's boats), `client/src/main.ts` (wiring, path check, `__scheldemist.journeys`), `tools/blender/build_people.py`, `client/public/models/people.glb`.
- API: `GET /api/transport` (vehicles, where they are, the day's errands, Jef's machines, the shop), `POST /api/transport/seen`, `POST /api/transport/missed`.

## Checks (2026-09-24)
- `npm test`: 538 passed (one ballad test timed out once under load and passed alone). New `server/test/transport.test.ts` (26 tests): the migration (who owns what by trade and wealth, spots open and reachable and off the lanes, the same seed the same things, an older save made in place with nothing else changed, and on a copy of a real older save); the mode by distance, load and ownership; the day's loads; the velocipede following its owner's day; family help (who comes out, rounds, alone); the omnibus with no fare and Jef's purse untouched; a boat path on open water only, none through the shut lock or over land; the boat errands; a stolen velocipede (the owner walks, remembers once, the machine stays where Jef left it); the maker (the door, buying, no second one, hire and the boy's fee, owning across a reload, theft of Jef's machine as a police case with a rumour, safe at the maker's, no damage).
- `npm run build` passes. `__scheldemist.paths()` returns [] (58 new points: every velocipede and cart spot, the errands' ends, the maker's door).
- In the browser on a test save only (`data/test-transport.sqlite`, server 8961, vite 5361). The preview tab could not reach local ports after its first load (connection refused from the preview browser while curl reached the servers), so the checks ran in a headless Chrome (hardware ANGLE) driven over its debug port. Dev helpers used for the pictures: `__scheldemist.journeys.devGo(id, x, z, prevKey, load, fromHome)` and `devErrandNow(vehicle)`; the clock frozen at noon for daylight.
  - A natie man rode his velocipede from his door at the Petit Bassin westward, pedalling (`data/shots/m6t_ride_34.jpg`, `m6t_ride_2.jpg`, `m6t_ride_1.jpg`).
  - A market woman's family (her husband and daughter) came out and carried four things to the cart, then she pushed it off with the goods on it (`m6t_family_load_1.jpg`, `m6t_family_push.jpg`). At 6:00 a fishwife loaded hers alone: the rest of her house left for work at the same hour.
  - Two residents got on the quay omnibus at the Werf, one sitting inside, one standing on the platform (`m6t_omnibus_back.jpg`, `m6t_omnibus_side.jpg`).
  - Two family boats rowed their errands on the river, one with the owner and his son (`m6t_boat_row.jpg`, `m6t_boat_row2.jpg`).
  - A carter led his dray from the yard behind the Rijnkaai to the bakery and carried the sacks in (`m6t_dray_led.jpg`, `m6t_dray_unload.jpg`).
  - The maker's door with the board and two machines (`m6t_shop.jpg`); bought a second-hand machine (1000 c -> 400 c), rode it with no deed, left it.
  - Took a natie man's velocipede: it showed as gone to the town; his memory "Somebody took my velocipede..." was written by the M3h rules.
- Frame time (`perf(60)`, headless Chrome, hardware GPU): Werf, omnibus with resident passengers and a pushed cart in view 6.49 -> 6.53 ms (211 -> 222 draw calls); Petit Bassin with a rider in view 7.35 -> 7.41 ms; `journeys.update` 0.003 ms a frame. A rider adds the machine's 10 draw calls (only within the fog), a cart 2 plus its things, a led dray 10.

## Not yet
- Few residents go further than 300 m on a weekday in this small town, so riding is mostly a Sunday (mass) and an M4 action thing; the omnibus is taken only when the next one is near (the lines come round every three to six real minutes).
- A family going somewhere together along the water in their boat (rule 2) is only the boat errands so far; the schedules rarely send a whole household the same way at the same time.
- The byTram rides of M4 onlookers and the velocipede pace of unseen actions are typechecked and wired, not seen in the browser.
- The dray errand makes the quay-traffic dray vanish from its round wherever it was; the led dray and the horse are not solid for walkers.
- Handcarts cannot be taken by Jef; the M3h wording of an unseen theft says "from outside his house" in the owner's own memory (an old M3h text).
- Nameless omnibus passengers still ride beside the town's own.
