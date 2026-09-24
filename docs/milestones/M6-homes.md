# M6 - Homes to rent, and furnishing them, 2026-09-24

Why: Steve, 2026-09-24: "Rent different houses, more expensive ones. Decorate interior, we must be able to go inside."

## Research: rents in Antwerp around 1873 (quick)
- **What the sources say.** Antwerp's rents rose faster than in any other Belgian town in the 19th century: about 9 times from 1800 to 1920 (Ghent 3.6 times), a first high point around 1880, and separate series for merchants' houses, workers' houses and burghers' houses (Segers 1999, from the city's and the poor-relief's rent books). Workers lived in speculative small row houses, in rooms of *maisons de rapport* (a burgher-sized house let out room by room), and in alley and court housing (*steeg- en pleinbeluiken*): two bays, one to two storeys, often built in groups. Rooms under the roof were let as sleeping rooms. That rents were paid by the week or the month, and by the night at the bottom, is the brief's premise; we did not check it in a source.
- **What we did not find.** No exact 1873 Antwerp rent for a cellar, a garret or a widow's room turned up in a quick search. Ducpetiaux's 1855 budgets of 199 Belgian worker families and the Board of Trade's 1908 enquiry into Belgian working-class rents hold such figures; neither was read here.
- **So the numbers are ours, kept in proportion.** The game's wages: a tier-0 job pays 50 to 150 c, two or three a day; the doss house bed is 150 c a week (M5). Rents take a modest share of a week's pay, and the dearest room is for a man who has risen:

| Home | Rent a week | By the night | Against the doss house |
|---|---|---|---|
| a cellar room | 100 c | 15 c | cheaper, your own door, damp |
| a garret room | 140 c | 20 c | about the same, under the roof |
| a room at a widow's | 220 c | 32 c | linen, coffee and bread in the morning |
| a small house in an alley | 320 c | 46 c | your own hearth |
| a merchant's upper floor | 900 c | 129 c | two windows on the river, a stove, a proper bed |

The dealer's second-hand prices, in the same proportion: a geranium 15 c, a print 40 c, curtains 50 c, a chair 60 c, a finch in a cage 70 c, a rag rug 80 c, an oil lamp 90 c, a deal table 150 c, a wall clock 250 c, a cast-iron stove 400 c.

Sources: [Y. Segers, De huishuren in Belgie, 1800-1920, KU Leuven CES DPS 99.15](https://feb.kuleuven.be/research/economics/ces/documents/DPS/1999/dps9915.pdf); [Inventaris Onroerend Erfgoed, Antwerpen: 19de- en 20ste-eeuwse stadsuitbreiding](https://inventaris.onroerenderfgoed.be/themas/14755); [Edouard Ducpetiaux, Wikipedia](https://en.wikipedia.org/wiki/%C3%89douard_Ducp%C3%A9tiaux) (the 1855 budgets); [Board of Trade, Cost of living in Belgian towns (1908), HathiTrust record](https://catalog.hathitrust.org/Record/000954549).

## What is in
| Part | Where | Notes |
|---|---|---|
| Homes in the town | `server/src/homes/town.ts` | Five doors: a cellar room by the Canal des Brasseurs, a garret in the Schipperskwartier, a small house in the narrow alley behind the cathedral (a lane under 5 m wide, at most 3 storeys), a merchant's upper floor on the Rijnkaai (a door facing the river), and a room at a widow's near the Vismarkt. Four are house doors nobody lives or works behind, and no shop, tavern, the Poesje, the post office or a newsboy's corner uses them. The widow's door is her own. Each home has a landlord from the town's men of property (merchants, the brewer, the fish merchant, anyone of wealth 6 or more). Two NEW residents: the widow (a seamstress who works at home, goes to market in the morning and to church on Sunday) and the second-hand dealer (at his door 8:00-12:30 and 13:30-18:00, not on Sunday). An older save gets them in place, once; nobody else changes. Record: world_state `homes`; tables `home_lease`, `home_item`. |
| The door | `client/src/game/homes.ts keys()` | E reads the notice ("GARRET TO LET under the roof..."), with the rent a week and a night and the landlord's name. F takes the key to Sunday, G for tonight. At your own door: E goes in, F pays the rent (what is owed first, else on to Sunday). |
| Rent and the key | `server/src/homes/homes.ts` | All engine numbers (`shared/homes.ts` CLASSES). Rent by the week, or by the night at a seventh of it, rounded up. `paid_through` is the last day paid. Each night, a day not paid for is owed. The first owed night brings a note under the door in the night sheet ("rent owed ... Pay by Sunday, or the key goes back"). If rent is still owed at the week's end (Sunday night) after a warning, the landlord takes the key back and changes the lock (Jef sleeps rough). The things in the room stay with him for the rent, and he remembers it (tone -2). One home at a time: a new key gives up the old one (its paid days are lost), and a carter moves the things (set where they fit, else stacked by the door). No new key while rent is owed. This runs as a night hook in `day.ts` (`NIGHT_HOOKS`, a small general addition). |
| A night at home | `day.ts sleep(db, "home", night)`, `homes.ts sleepHome` | E by the bed: from 18:00, or earlier when dead tired (the doss house rule). Sleep goes to 10 as ever. Warmth: +4, plus half the room's warmth (the doss house gives +3, so every home is better). Health: +1 if fed, +1 more in a restful room (warmth + light + cheer of 6 or more). Food: -2 (at the widow's -1: coffee and bread). You wake in your own room. |
| The rooms | `client/src/world/homeRooms.ts`, `world/furniture.ts` | Built in code the way the taproom is, on the engine's 0.5 m grid. Cellar, 3.5 x 4 m: brick and flagstones, a small high window at pavement level, a straw pallet, a crate with a candle stub. Garret, 3.5 x 4.5 m: a sloping roof with rafters and knee walls, a plank bed, a crate and candle, a small gable window. Widow's room: wallpaper, a bed with linen and a blue quilt, a washstand with jug and basin, her chair, her crucifix. Alley house, 4.5 x 5 m: whitewash, red tiles, a Flemish box bed (bedstee) with curtains, a brick hearth with a fire, a chest. Merchant's floor, 6 x 6 m: green walls over dark panelling, a four-poster, a wardrobe, a tiled stove, a table with a cloth, two windows. Every window shows a painted view of the street, lit by the hour: the houses opposite; from the cellar, cobbles and boots; from the garret, the spire over the roofs; from the merchant's floor, the river and a mast. |
| Going in | `client/src/game/interiors.ts` (small additions: `enterOwn`, `frameOf`, `visit`, `homeKeys`, `placeId`) | Homes use the interiors' own way in: the same fade, room-frame walking, sound (the street muffled through the walls, no room bed) and way out. The taverns and the Poesje are unchanged. |
| The dealer | `homes/town.ts`, `trade.ts` (TRADE_WARES.dealer, `carry` on ItemDef) | He sells through the trade rules (F at the dealer opens the talk window's wares): ten pieces at engine prices (see above). In his hours, chairs, a table, a stove, a birdcage and a geranium stand out on the pavement (drawn merged by material). No room, no sale: "And where would you put it?" |
| Carrying | `homes.ts` (server `ITEM_REF`), `game/homes.ts showCarried` | A print, a lamp, a clock and curtains take a pocket slot (the pocket row points at the piece). A chair, a table, a rug (rolled), a stove, a plant and the birdcage are carried in both arms like goods. They show in front of you, slow you down (a stove to 0.6), go one at a time, and leave only two keys: E at your door carries it in, G leaves it in the street (it is gone). |
| Placing | `shared/homes.ts canPlace`, `game/homes.ts` | Inside, F takes out the next piece (from a pocket, your arms or the carter's pile) and G moves the piece in front of you. The piece follows your eyes over the grid, 1.1 m ahead: green where it may go, red where not. R turns it and E sets it down; the server checks the same rule and saves it. The rule: inside the room. Floor pieces not on the room's own furniture, another piece or the doorway; the way from the door to the bed stays open; not where you stand. A rug may lie under a table but not on another rug. Pictures and clocks go on a wall, not over the door, a window, a hearth or the garret's eaves. Curtains only at a window (the garret's gable window is too small for them). Lamps hang from the ceiling, one to a cell, under the garret's ridge. Each piece is a group of PS1 boxes and painted textures. |
| Comfort | `shared/homes.ts comfortOf, nightAt` | Warmth, light and cheer. Each room has its own (cellar 0/0/0, garret 0/1/0, widow 2/1/2, alley 2/1/1, merchant 4/2/3). Each kind of piece adds once: stove warmth 3; rug warmth 1 and cheer 1; curtains warmth 1; lamp light 2; every other piece cheer 1. Caps: 6, 4, 6. The player sees words only ("cold", "snug enough", "warm"; "dark", "bright"; "bare", "lived in", "homely"). A stove, the alley's hearth or the merchant's stove: E warms you +1, once a game hour. A placed lamp or stove lights the room. |
| The remark | `server/src/homes/remark.ts` (hook `home_remark`) | When Jef comes in, at most once a game day per home, the ENGINE picks who looks in: the widow in her own house when her schedule says she is home, else the nearest neighbour at home, 7:00-21:30. It also picks what they see: the room, the pieces by name, the comfort words, never a number. The model writes one line in their voice. A line with a number, a sum, an offer or a demand ("give", "pay", "owe", "free" and so on), an oath or markup gives way to the engine's line; so do a timeout and a used-up share. They stand in the doorway, say it in a bubble, and go. It changes nothing but a small memory of theirs. |
| Path check | `main.ts paths()` | Every home door, and the dealer's spot. |
| Dev | `__scheldemist.homes`: `debug()`, `devDoor(id)`, `devTake(id, plan)`, `devEnter()`, `devView(id)` (look round any room, bare), `devMove(id)`, `devTurn()`, `devPut()`, `devPlace(id, gx, gz, rot)` | |

## Follow-up: the merchant's floor furnished (main, 2026-09-24)
Main found the dearest home bare: a dark empty floor, one stove, flat green walls. Now it reads as a well-off merchant's rooms of 1873:
- dark red damask paper over the panelling, with a gilt dado rail;
- a painted frieze under the ceiling;
- a Turkey carpet;
- tall windows (0.7 to 2.6 m) on the river, with heavy red drapes and a pelmet;
- a grey marble mantel with a real fire, a gilt mirror, a clock and candlesticks;
- two red armchairs at the fire;
- a writing desk with ledgers, an inkwell and a green-shaded oil lamp;
- a glazed bookcase, two seascapes in gilt frames, and a brass chandelier over the table;
- the bed in an alcove behind a panelled partition with a green curtain.

The mantel replaces the tiled stove. The room's own comfort is now warmth 4, light 3, cheer 4, and its drapes leave no room for bought curtains (a new test). Pictures: `data/shots/m6h_merchant_before.jpg` and `m6h_merchant_window_before.jpg` (before); `m6h_merchant.jpg`, `m6h_merchant_window.jpg`, `m6h_merchant_fire.jpg`, `m6h_merchant_desk.jpg`, `m6h_merchant_alcove.jpg`, `m6h_merchant_night.jpg` (after).

Draw calls: every home now draws its walls and own furniture merged by material (`homeRooms.ts mergeStatic`); lights and glows stay separate. Inside the merchant's floor: 43 calls, about 1.9k triangles, 1.7 to 2.8 ms. The others: cellar 12, garret 14, widow 13, alley 17 calls, bare (before merging, about 77). Jef's own pieces are still drawn one by one, so they can be moved.

## Budget
New share `HOME_CALLS_PER_DAY = 2` in `server/src/config.ts` (the remark), out of what was left, never the reserve. 12 are left for the board, the outcomes, the named people and the epilogue.

## Files
- New: `shared/homes.ts` (the rooms, the pieces, the placing rule, comfort and the night: the engine's numbers, read by both sides), `shared/package.json` (marks `shared/` as ES modules for the server's typecheck), `server/src/homes/{town,homes,remark,routes}.ts`, `server/test/homes.test.ts`, `client/src/game/homes.ts`, `client/src/net/homesApi.ts`, `client/src/world/homeRooms.ts`, `client/src/world/furniture.ts`, `data/vite-test-homes.config.mjs`.
- Small edits: `server/src/day.ts` (`sleep` takes a home night; `NIGHT_HOOKS`), `server/src/db.ts` (schema, ensure, reset), `server/src/index.ts` (mount), `server/src/config.ts` (share), `server/src/trade.ts` (dealer wares from `shared/homes.ts`, `carry: "arms"`), `server/src/town/places.ts` (trade `dealer`), `client/src/game/interiors.ts` (see above), `client/src/world/rooms.ts` (helpers exported, `kind: "home"`, `home?`), `client/src/game/day.ts` (sleep through another route, the night sheet's place, waking at home), `client/src/net/api.ts` (`Night.where` "home"), `client/src/audio/soundscape.ts` (`setInterior("home")`), `client/src/main.ts` (wiring, path check, dev).
- A save made by an early build of this work named the dealer "Door" (Theodoor), which reads as a door in English; `ensureHomesTown` renames him "Dolf" once. Home labels are worded at read time, so a save keeps the door but not old wording.

## Checks (2026-09-24)
- `server/test/homes.test.ts`, 26 tests, all pass:
  - the town: five homes on real free doors (the widow behind hers), no two on one door; the dealer's wares at engine prices; an older save made newer in place (residents +2; memories, relationships, every other resident row and the money unchanged; once only);
  - rent: the key for tonight or to Sunday, the full week's price on a Monday; no money, no key; owed days; the first owed night warns; paying clears what is owed first; still owed at the week's end after a warning, the key is taken back, the things kept, Jef turned away to sleep rough; paid to Sunday, no warning; moving takes the things, and is refused while owing;
  - the night: every home beats the doss house bed (warmth, health), a dearer home is warmer, the merchant's floor is restful, the widow's breakfast; bedtime; no key, no bed; a stove and a lamp make the garret warmer and restful;
  - buying: no room, no sale (nothing moves); a big piece in the arms, one at a time; a small piece in a pocket, pointing at it; the shop shut out of hours;
  - placing: the rule (grid, own furniture, doorway, the bed cut off, rugs), walls, windows, curtains, eaves, lamps; place, move, turn; a bad place refused with nothing moved; the layout kept in a save file that is closed and opened again;
  - comfort: each kind counts once, the caps, the stove once an hour, the alley's hearth;
  - the remark: the widow's line from the model; 17 hostile or rough model lines (the hostile list, "500 francs for the linen", "a free loaf", a script tag, "you owe me twenty centimes", an oath) with extra fields `money_c: 99999`, `warmth: 10`, `trust: 10`: money, needs, the room and the lease unchanged, and no number, sum or demand gets through; a model that never answers gives the engine's line after the timeout; no call over the share or into the reserve; nobody looks in at night.
- `npm test` at the end: 348 of 351. The 3 failures are outside the homes: `day.test.ts`, `jobBoard.test.ts` and `deeds.test.ts` take "the first job" of a fresh save, and a fresh save now holds an emigrants' job seeded by another helper's work in progress. The `homes`, `interiors`, `trade` and `paper` tests all pass.
- `npm run build`: the client builds and my files typecheck on both sides. At the end the server typecheck stopped on two other helpers' tests in progress (`server/test/emigrants.test.ts` line 370, `server/test/townlife.test.ts` line 21). Earlier in the run, before those, the whole build passed with the homes in.
- The old-save migration also ran on a copy of the real save (`data/test-homes-oldsave.sqlite`, a `.backup()` of `data/game.sqlite`, day 2): the five homes, the widow and the dealer were added; money and day kept. The working copy was deleted afterwards.
- In the browser on a test save (`data/test-homes.sqlite`, server on 8861, vite on 5261 with `data/vite-test-homes.config.mjs`), never on `data/game.sqlite`:
  - `__scheldemist.paths()` lists nothing, with the five home doors and the dealer included.
  - At the garret door: "E read the notice: a garret room to let / F take the key to Sunday (120 c) / G take it for tonight (20 c)". Took it to Sunday.
  - At the dealer's (Dolf Van Ooteghem, by the Grote Markt): "F buy from Dolf Van Ooteghem". Bought a stove (in the arms; a chair after it was refused with "your arms are full"), then a lamp and a print (in pockets). With the stove in the arms the only keys were "E carry a cast-iron stove into your room / G leave a cast-iron stove here". Inside, the stove came up as a green ghost 1.1 m ahead. A chair turned with R and went down with E, and the server kept both.
  - Took the widow's room instead: the carter set the stove, lamp, print and chair in it. The widow, Barbara Van Hoof, at home at 11:00, came to the door. The model's line came in 3.3 s: "A stove, a lamp, a picture on the wall, and a second chair besides mine. The whole street will hear you've come up in the world."
  - Bought curtains; F took them out, Jef faced the window, and they went up at the window on the first try.
  - Bed at 20:00 with food 5, warmth 4, health 6, sleep 3. The night sheet: "Your own room: a room at a widow's near the Vismarkt ... You sleep between the widow's linen sheets. In the morning there is coffee and a heel of bread. You sleep deep and wake rested." Morning: sleep 10, warmth 10, health 8, food 4 (the doss house would have given warmth 7, health 7, food 3). E woke Jef inside the room.
  - The alley house, furnished for the pictures (rug, table, geranium, finch, clock, plus the carter's stove, lamp, print, chair and curtains), reads "warm, bright, homely"; a night there gives warmth +7 and health +2.
- Pictures:
  - each class inside, looking in and looking back at the window: `data/shots/m6h_cellar.jpg`, `m6h_cellar_window.jpg`, `m6h_garret.jpg`, `m6h_garret_window.jpg`, `m6h_widow.jpg`, `m6h_widow_window.jpg`, `m6h_alley.jpg`, `m6h_alley_window.jpg`, `m6h_merchant.jpg`, `m6h_merchant_window.jpg`;
  - decorated, before and after: `m6h_alley_before.jpg`, `m6h_alley_after.jpg`, `m6h_alley_after_window.jpg`;
  - the widow's room with Jef's things `m6h_widow_decorated.jpg`, the widow at the door `m6h_widow_visit.jpg`, the curtains `m6h_widow_curtains.jpg`;
  - the dealer's pavement `m6h_dealer.jpg`.
  - Bubbles and prompts are HTML and not in the pictures.
- Frame time (`__scheldemist.perf(60)`, hidden tab, other helpers' servers running):
  - inside a home: 1.3 to 1.7 ms, 77 draw calls, about 1k triangles;
  - at the alley door: 5.1 to 8.0 ms (549 calls);
  - at the dealer's: 4.5 to 7.4 ms (273 calls after merging the pavement pieces; before merging they added 49 calls);
  - on the Rijnkaai: 4.8 to 5.0 ms (195 calls).

## Not yet
- At midnight Jef, out of bed but inside his home, still counts as sleeping rough (the tick does not know where Jef is).
- The garret's gable window is too small for curtains; curtains go in the other rooms.
- Nobody else rents the empty homes. The landlords never come round for the rent; it is paid at the door.
- The dealer's pieces on the pavement do not block walking. He does not carry them in at night; they are just hidden outside his hours.
- A piece carried in the arms is not drawn inside a room (the ghost stands for it).
- Selling furniture back, or pawning it at the Berg.
