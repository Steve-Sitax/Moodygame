# M7 - Shops and cafes you walk into, 2026-09-26

Why: Steve, 2026-09-26: "More shops; create better cafe interiors, use designs by Codex for ideas. Not only the cafe has interiors but also any other shops over town."

There are now 18 shops in town. Nine are new: a butcher, a colonial goods shop, an apothecary, a barber, a hatter, a coffee roaster, a printer, a bookseller and a clockmaker. Each keeper sells real wares at engine prices in the shop's own hours. 17 of the 18 shops stand inside their own city house, the way the taverns do (M7-taverns-homes-inworld.md). The street door stands open in opening hours, and you walk in. There is a counter with the keeper behind it and his wife at its end. There are shelves and goods of the trade, a window display, lamps, and customers who came in on their errands. E at the counter opens the usual ware list. The five taverns were rebuilt as four kinds of cafe from Codex concept paintings of 1873 cafes. One of them has a billiard table and one has a piano.

## The shops
| Shop (id) | House | Trade, what it sells (engine prices, c) | Hours (Mon-Sat; Sunday) | New? |
|---|---|---|---|---|
| bakery_rijn | 779 (moved from 781) | baker: bread 6, peperkoek 3 | 5:45-13, 14-18:45 | old; front moved |
| bakery_steen | 913 | baker: bread 6, peperkoek 3 | 5:30-13, 14-19 | old |
| grocer_canal | 827 (moved from 848) | grocer: apple 2, cheese 6 | 7-12:30, 13:30-19 | old; front moved |
| grocer_werf | 41 (no inside) | grocer: apple 2, cheese 6 | 7-12:30, 13:30-18:30 | old; its house cannot hold a room, so it keeps its table outside |
| chandler_werf | 32 | chandler: biscuit 4, lantern 40, matches 2 | as before | old |
| tobacco_markt | 25 | tobacconist: matches 2, a clay pipe with shag 4, a cigar 8 | as before | old; sold nothing before |
| pawn_vis | 940 | the Berg van Barmhartigheid: E at the counter opens the Berg's page | as before | old |
| cobbler_lane | 831 | cobbler: laces 3, boots mended at the counter 12 (warmth +1) | as before | old; sold nothing before |
| draper_markt | 17 | draper: a woollen neckerchief 25 (warmth +2 worn), a knitted wool vest 45 (+3) | as before | old; sold nothing before |
| butcher_vlees | 950 | butcher: brawn 4, a smoked sausage 7, fat bacon 10 | 6:30-12:30, 13:30-18:30 | new |
| colonial_steen | 912 | colonial goods: sugar candy 2, dried figs 5, chocolate 6, a packet of tea 18 | 7:30-12:30, 13:30-19:30 | new |
| apothecary_markt | 16 (a corner) | apothecary: liquorice 2, cough syrup 15 (health +1), fever powder 30 (health +2) | 8-12:30, 13:30-20; Sunday 9:30-11 | new |
| barber_lane | 778 | barber: a shave 3, a haircut 6 (at the counter) | 7-12, 13-20; Sunday 7-10 (before mass) | new |
| hatter_markt | 45 | hatter: a flat cap 25 (warmth +1), a second-hand felt hat 60 | 8:30-12:30, 13:30-19 | new |
| roaster_canal | 820 | coffee roaster: a cup of coffee 4 (warmth +2, drunk there), roasted coffee 20 | 7-12:30, 13:30-18:30 | new |
| printer_jezuiet | 875 | printer: paper and an envelope 3, an almanac 10 | 7-12, 13-18:30 | new |
| books_kathedraal | 602 | bookseller: a cheap novel 8, a second-hand prayer book 25 | 9-12:30, 14-19 | new |
| clock_markt | 920 | clockmaker: a watch key 5, a second-hand pocket watch 150 | 8:30-12:30, 13:30-18:30 | new |

- **New item uses**:
  - "wear": putting a garment on gives its warmth now, and the item is gone from the pocket.
  - "smoke": a pipe or a cigar, warmth +1.
  - Counter services are had there and never pocketed: the shave, the haircut, the boots mended.
- **Pawn and gifts**: the Berg lends on the watch (worth 110), the felt hat (30) and the prayer book (15). Everything the shops sell is worth its price as a gift (town/gifts.ts).
- **Prices**: every price is the engine's (server/src/shops/wares.ts). They follow the game's own scale (bread 6 c, a job 50-150 c), not the real centimes of 1873. The proportions of the time are noted in that file. Haggling, the news prices and the event prices work as for every other seller (trade.ts).

## Who is inside
- **The keeper and his wife**: they serve while their hours run (the schedule; not shut by an event). The keeper stands behind the counter, the wife at its front end. In the town (game/town.ts), both go in at the door while the shop's room stands open. A new shop's keeper lives above his shop. He keeps the shop's hours, goes to mass on Sunday or opens on Sunday morning (the barber, the apothecary), and sometimes has an evening glass at the nearest tavern.
- **Customers**: the engine's roll is shared/shops.ts `shopCallers`, fixed for each game hour and the same on the server and in the client. Each open shop wants a few callers an hour. The number follows its trade's weight, and the mornings and the hour before supper are busier. It takes them from the townspeople about near it whose errand runs to the hour's end: those at the market, a walk out for the better shops, men idling or ashore for the tobacconist, the barber and the like. The nearest come first, shaken by a roll. Each person goes to one shop at most.
  - The town walks them to the door at the hour's start and in.
  - The server lists them inside from 20 minutes past (shops/state.ts).
  - They stand at the counter, the shelves or the window. In the barber's shop and at the Berg they may sit on the waiting bench, and at the barber's in the chair.
  - On the test save at 9:25 on a Tuesday (day 2), 27 callers were inside 16 of the 18 shops, between 1 and 3 a shop (the printer and the clockmaker had none that hour).

## The insides (client)
| Part | Where | Notes |
|---|---|---|
| The plan | `shared/housePlan.ts` kind "shop" | The house's ground floor behind the street door, planned as a taproom is. The front bays' painted glass is cut through, and the side walls' too on a corner. |
| Which houses | `shared/inworld_houses.json` "shop:<id>" (17), `tools/city/inworld.mts` -> `shared/inworld_build.json` -> `build_city.py` | Chosen from Steve's save: each old shop's own house, or its neighbour when its own is an odd footprint (781, 848, 41). The new shops take houses nobody lives or works in near their anchors. A new town puts the old shops in these houses (server town/population.ts, one draw kept as the taverns do). |
| The room | `client/src/world/shopRooms.ts` `buildShop` | The counter runs along a side wall from 1.45 m in, with the keeper behind it. It is on the wall nearer the door, or on the other wall when the door is close to that one (a narrow shop), so the way in from the door stays free. There are shelves floor to ceiling behind the counter, the trade's things on the other wall, and a display behind the front window. A deep house has a partition at 6.6 m with a panelled door to the back rooms. There is a stove (the baker has his oven), two hanging lamps (oil, or gas globes in the better shops), a beamed ceiling with a straight cornice, and the trade's floor: boards, tiles with sawdust, or flags. Floors get their relief from their own picture (`bumpFromMap`). |
| The trades | `shopRooms.ts` `DRESS` | The baker: real loaves on the shelves and a slanted rack, baskets of rolls, a table of tarts, flour sacks, the oven door with its glow. The butcher: white tiles, a marble counter, sides of pork and sausages on iron rails, a marble slab of cuts, the block and cleaver. The grocer: tipped crates of vegetables, strings of onions, sacks. The colonial goods shop: a wall of little drawers, tins, glass jars of candy, sugar loaves in blue paper, a coffee mill, sacks of beans, a ladder. The tobacconist: jars and cigar boxes, a glass case, the lamp to light a cigar, clay pipes in a rack, tobacco leaf hanging. The apothecary: a cabinet of porcelain jars, drawers, a marble counter with scales, a mortar, and the coloured show globes in the window. The barber: the heavy chair before a gilt mirror, a basin, bottles, towels, a waiting bench. The hatter: hats on shelves and on wooden heads, hat boxes, a tall mirror. The roaster: the drum over its brick furnace with its glow, sacks of green beans, a cooling sieve, a standing table. The printer: the iron hand press, type cases, stacks of paper, sheets drying on a line. The bookseller: bookcases on both walls, piles of books, a ladder. The clockmaker: clocks all over the wall, a tall case clock, a glass counter of watches, the workbench. The chandler: rope coils, lanterns, barrels, oilskins. The cobbler: boots in rows, his low bench, lasts, a hide. The draper: bolts of cloth, the brass yard rule, a dress form. The Berg: numbered bundles behind a grille, the ledger, a notice and a bench to wait on. |
| The pieces | `client/src/world/interiorKit.ts` | Bentwood chairs, marble and wooden tables, bottles, jars, loaves, sacks, crates, shelf rows as pictures, lamps (oil, globe, lantern, the billiard lamp), stoves and pictures on walls. The textures are painted in code (checkers, white tiles, marble, posters, a mirror, clock faces, boards, small paintings), and some are Codex pictures with a painted stand-in until they load. |
| Signs | `client/src/world/shopSigns.ts` | A painted board over the middle of each front, in the street-life board band. A wrought-iron bracket beside the door carries the trade's sign: a gilt pretzel, a hat, the barber's basin, a boot, a clock, a book, a pestle and mortar, a bull's head, a cup, an anchor. They are tagged for the sign check; streetlife's own random shop fronts keep off these houses (their doors are in-world doors). |
| The life | `client/src/game/interiors.ts` | Shops run in the same life as the taverns: the nearest building within 70 m. The keeper and helpers are synced every 4 s. E at the counter buys from the keeper through the talk window's ware list; at the Berg it opens the Berg's page (game/press.ts `openBergCounter`). F talks to the keeper, and E by a customer talks to them. Crossing the threshold gives the smell of the trade and who is there. At closing time the keeper puts the shutters up and Jef is put out. A shut shop's door: "The shutters are up". |
| What the keeper holds | `client/src/game/shopProps.ts` | The trade's thing on the right hand's bone: the baker a loaf, the butcher his cleaver, the barber a razor, the roaster his pot, the bookseller a book, the apothecary a bottle, and so on. |
| The town | `client/src/game/town.ts` (two hooks), `client/src/game/shopCalls.ts` | Keepers and wives go in at the door while the shop's room is open. Callers walk to the door at the hour's start. |
| Pockets | `client/src/game/shopIcons.ts` | Ink icons for the new wares. |

## The cafes (`client/src/world/cafeRooms.ts`)
Codex painted concept pictures of a brown cafe, a coffee house, a sailors' tavern and a better-class cafe of 1873, and of a grocer, an apothecary, a bakery and butcher, and four small shops (scratch only). The rooms follow them:

| Tavern | Style | What is in it |
|---|---|---|
| In de Ankere, Het Schipke | sailors' tavern | Low heavy beams and joists, limewash gone grey, a plank counter with pewter pots and stone jenever jugs, the barrel rack, a ship model on a shelf, the sea chart (Codex), a lifebuoy, rope coils, long tables with benches, candles in bottles, the brick hearth with its fire, lanterns on chains, the vogelpik board. |
| De Vliet | brown cafe | Dark oak wainscot (Codex), smoke-brown plaster, a panelled bar with a zinc top and three brass beer pumps, glasses, a gilt mirror over shelves of bottles, a barrel, a cast-iron stove, square tables with bentwood chairs (and a middle row when the room is wide), red and black tiles (Codex), two beer posters, a small saint in gilt, the slate with the day's prices, a clock, coat pegs, globe gas lamps. |
| Den Engel | the better cafe | Red damask (Codex), a wainscot, tall gilt mirrors between concert and theatre posters, a mahogany bar with a brass rail and pumps, round marble tables with plush chairs, a red plush banquette along the wall, an upright piano with a stool and candles (someone may sit and play), patterned cement tiles (Codex), a cornice, gas chandeliers. |
| Het Bassin | coffee house | Cream walls over a wainscot, a marble counter with the copper coffee urn and a glass case of cakes, cups, round marble tables with papers and cups, the papers on their sticks in a rack, the ship painting (Codex), a mirror, the stove, patterned tiles, a billiard table with balls under a green-shaded lamp at the back, cues on the wall. |

The life is the taverns' as before: the counter, the stools (table 9), the seats at the tables, the fire (a hearth or the stove), pitjesbak, gossip and chatter.

## Checks (2026-09-26)
- **Server**:
  - New `server/test/shops.test.ts`, 9 tests:
    - the new shops and their keepers each live above the shop in its listed house, once, with nobody else living there;
    - every listed shop house is its shop's door;
    - an older save's shop in a house with no inside moves its front and keeps its family's home;
    - every ware is known at engine prices;
    - buying works only in the hours and with the money; the barber is open on a Sunday morning;
    - a shave is never pocketed; a vest is worn (warmth +3) and a pipe smoked;
    - the Berg lends on the watch, and the gift values;
    - the callers' roll is the same answer every time, one shop a person, only open shops, the men's shops men only;
    - in a town, the customers are inside from 20 minutes past, each one out on an errand.
  - Adjusted older tests:
    - `families.test.ts`: the baker's gift is the cheapest thing to eat on his list, now peperkoek or bread.
    - `lively.test.ts` and `transport.test.ts` (the old saves): a shop worker's `work.at` belongs to the shop move, and the new keepers (`sk_...`) do not count as "the rest".
    - `config.ts`: TOWN_SIZES `about` is +9 for the new keepers.
- **Clean export** (`git archive HEAD` plus this work only, the old test saves copied in):
  - `npm run build` passes.
  - `npx vitest run` in server passes 885 of 885.
- **The browser**, on a test copy of Steve's save (`teststack.mjs start shops --server 8952 --vite 5352`), judged at height 0 with no psx colour or wobble:
  - **Paths**: `paths()` lists nothing, with every shop door, the counter and the shelves inside each open shop (`insidePathProblems`, by the house's plan).
  - **Signs**: `signs()` lists 0 problems among 17 shop boards and 11 shop brackets. The boards hang by the house plan's own front: the town's rounded door normal left three boards 4 cm off a slanting wall.
  - **Walked in with the door walk** (`houses()`, `walk` from 7 m out to 4 m in, for 17 shops and 5 cafes):
    - Inside mode starts 0.2 m past the door plane everywhere.
    - At the doors there are no spikes. The spikes seen were in the street at the walk's start after the jump (the first frames at a new place).
    - The worst frame inside was at Den Engel, 17.6 ms at 1.5 m in.
  - **Bought at the counter**: E "buy from Jozef" at the butcher's counter opened the ware list (brawn 4, sausage 7, bacon 10). Key 2 bought a sausage: money 50 to 43, and the sausage was in the pockets with its icon.
  - **The Berg**: E at the counter opened the Berg's page ("Petrus Smets behind the grille").
  - **Customers**: at 9:25 on day 2, 27 callers stood in 16 shops. At the bakery on the Steenplein, the keeper and his wife served and three women waited at the counter.
  - **The cafes at 20:00**:
    - In de Ankere had 13 people, De Vliet 8, Den Engel 8, Het Bassin 10 and Het Schipke 8.
    - They sat at the tables and on the banquette and stood at the bar and the billiard table.
  - **Night**, 19:10: the open shops' windows glowed warm with the room seen inside (the apothecary's show globes in its window), next to Den Engel's lit window. Shut shops had their lamps out.
  - **Z-fighting** (`zfight()`): each shop house adds only the same two hidden back-to-back faces as every in-world house (the leaf and lining against the wall); the boards and brackets add nothing. The rooms' own scenes are not in the check.
  - **Frame time** (`perf(30)`, hidden pane, other helpers' servers running, noisy):
    - In the street before the tobacconist and Den Engel, with 4 rooms drawn: 19 to 27 ms and 1000 draw calls, against 17 ms and 785 calls with the rooms off.
    - Inside the colonial goods shop: 3.3 to 3.9 ms and 113 calls, against 14 to 17 ms for the street alone.
    - Inside Den Engel, looking out on the Grote Markt: 14.6 to 16.8 ms and 1536 calls, against 13.4 to 14.0 ms and 1342 calls with the street alone. The room is about 190 calls, the most of any.
- **Pictures** (`data/shots/`):
  - Cafes: `sh_cafe_{ankere,vliet,engel,bassin,schipke}_{in,back}.jpg`.
  - Shops: `sh_<shop>_{in,out}.jpg` for all 17, and `sh_<shop>_customers.jpg` for the bakery on the Steenplein, the grocer, the barber and the colonial goods.
  - Keepers: `sh_keeper_{bakery_steen,butcher_vlees,barber_lane,roaster_canal,books_kathedraal,apothecary_markt,cobbler_lane,tobacco_markt}.jpg`.
  - Street: `sh_street_{butcher_vlees,apothecary_markt,colonial_steen}.jpg`, `sh_front_{bakery_rijn,cobbler_lane}.jpg`.
  - Night: `sh_night_{apothecary_markt,colonial_steen,tobacco_markt,engel}.jpg`.

## What is left
- **grocer_werf** has no inside. Its house (41) is an odd footprint only 1 m deep behind the door, and no free house stands near it, so it keeps its table outside, and its board and sign hang over its door.
- **city.glb**: this helper rebuilt it with the 17 shop houses cut, under the lock. The places helper also rebuilds it. It must be rebuilt once after both land (`node tools/city/inworld.mts`, then `build_city.py`).
- **What the keepers hold**: it rides on the right hand's bone. The keepers stand at "idle" with their hands down, so the thing is mostly below the counter's top.
- **Customers**: they are only townspeople out on errands or idle, so the afternoon is quieter than the morning. A shop shut by an event still draws its callers to the door, where they vanish (the client does not know the event).
- **Chatter**: in a shop there is none, and nobody plays pitjesbak. The barber's chair holds a customer, but there is no shaving motion.
- **Other saves**: the listed houses are fixed at build time. A save whose shops stand elsewhere (another seed, from before M7) keeps its old shop tables outside for those shops, and the client draws no room where the door does not match.
- **Two cafes** each show one frame spike just inside: Den Engel 17.6 ms at 1.5 m, Het Bassin 12.6 ms at 2.2 m. The likely causes are the chandelier globes and posters and the street seen through the window. Den Engel's room is about 190 draw calls; its many small materials could be merged further.

## Files
- **New**:
  - `shared/shops.ts`
  - `server/src/shops/{wares,town,state,routes}.ts`
  - `server/test/shops.test.ts`
  - `client/src/world/{interiorKit,shopRooms,cafeRooms,shopSigns}.ts`
  - `client/src/game/{shopCalls,shopIcons,shopProps}.ts`
  - nine Codex textures in `client/public/textures/` (`cafe_*`, `shop_*`; `assets/ATTRIBUTION.md`)
  - this note
- **Changed**:
  - `shared/housePlan.ts`: the kind "shop".
  - `shared/inworld_houses.json` and `shared/inworld_build.json`: 17 shop houses.
  - `server/src/trade.ts`: the wares, the new uses, the service line, the shop's own trade.
  - `server/src/town/places.ts`: 9 trades.
  - `server/src/town/population.ts`: shops prefer their listed house.
  - `server/src/town/gifts.ts`: `shopPrice`.
  - `server/src/db.ts`: `ensureShopsTown`.
  - `server/src/index.ts`: `mountShops`.
  - `server/src/config.ts`: TOWN_SIZES `about` +9.
  - `client/src/game/interiors.ts`: the shops' life, the cafes, the keys.
  - `client/src/world/rooms.ts`: exports, the Room kind "shop" and `serve`, calmer plaster stains.
  - `client/src/game/town.ts`: two hooks.
  - `client/src/game/pockets.ts`: icons.
  - `client/src/game/press.ts`: `openBergCounter`.
  - `client/src/main.ts`: two hooks.
  - `client/src/dev/signcheck.ts`: shop boards counted once.
  - `client/src/net/interiorApi.ts`: the shop calls.
  - `server/test/{families,lively,transport}.test.ts`.
  - `assets/ATTRIBUTION.md`.

## Rebuild
    node tools/city/inworld.mts --check      (after tools/city/plan.py: the listed doors still the houses' doors)
    node tools/city/inworld.mts
    node tools/withLock.mjs city-glb -- "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup -P tools/blender/build_city.py
    cd server && npx vitest run test/shops.test.ts test/houses-inworld.test.ts

In the tab: `__scheldemist.interiors.devEnter("butcher_vlees")` (any shop id or tavern id), `__scheldemist.shotIn(name, from, to)`, `fetch("/api/shops")`, `fetch("/api/shop/<id>")`.
