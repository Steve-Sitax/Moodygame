# M7 mills: millers, flour and grain on the move, and mill work (2026-09-26)

Steve: "millers and transport from mill to bakery or docks or from docks, and potential jobs."

Period notes: tower mills stood on the Antwerp ramparts into the 1880s (the Schorsmolen by the Zandpoort ground
grain and bark). Grain came in by barge and was landed by the naties; the miller turned the cap into the wind by
the tail pole and its capstan wheel, stopped the sails in a gale and let them stand on Sunday. Flour went to the
bakers in sacks of about 50 kg by the mill's cart in the early morning.

## What is in

| Part | Where | Notes |
|---|---|---|
| Data and rules both sides read | `shared/mills.ts` | The two mills (the Kipdorp mill on the middle bastion, the north mill on the north-east bastion): door, capstan, stair, store, cart stand, stops, the carts' ways; wind by weather; the timetable; the stocks; the pay |
| People | `server/src/town/mills.ts` (`ensureMills`, ids `ml01`-`ml04`, trades `miller`, `miller_man` in `places.ts`) | Added once in place to every town. The miller at his mill 5:45-18:30, a pot at the tavern after, mass on Sunday. His man out with the cart at dawn and after dinner, hauling sacks between runs, the tavern after |
| Sails | `client/src/world/rampart.ts` (marked hunks: `millSails`, eased speed) | Turn only with wind (fog 0, mist 0.5, clear 1, rain 1.15, storm 0: braked), 6:00-18:30, never on Sunday |
| Life at the mill | `client/src/game/mills.ts` (town hook `town.mills`) | Miller at the door with wind, now and then at the capstan (push) or the gallery's chain (pull); in the mill in fog or a gale. The man carries sacks down the wall stair to the store and back up. The crowd cannot path a 1.8 m flight: the mill's people are walked up and down it by this file |
| The carts | same | Kipdorp mill: horse and dray (LedDray); north mill: handcart (PushCart). Flour: 4:30 load at the store, lead to the bakery (Steenplein, behind the Rijnkaai) along a fixed way, unload while the baker comes out to his door, back by about 10:00-10:25. Grain: 13:30 to a dock (the canal quay, the Petit Bassin's south quay), a docker of the town within 28 m hands the sacks up (else the man loads alone), back into the store by 17:10-18:40. A lantern before daylight. Unseen, the man follows the same way by the clock |
| Stocks | `shared/mills.ts stepStocks`, server `millStocks` (world_state `mills`) | Bakery bakes at 3:00 (3 sacks, Sunday 1), loft holds 8; mill grinds 0.5 sack an hour of breeze by day while it has grain; the flour cart brings what the loft lacks (at most 3, what the mill has); the grain run 3 sacks. Starts at grain 6, flour 6, loft 5 |
| Bread price | `trade.ts sellerPrice` hook | Bread and peperkoek +1 c when the loft has 1 sack or less, +2 c when empty; never more |
| Work for Jef | `server/src/town/mills.ts offerMillJobs` (board extras and every game hour; source `mill`) | Flour for the baker (loft + cart on its way <= 3), grain for the miller (grain <= 3), an hour's help at a windy mill (weekdays 7-16). Hand-written words, no model call. On the board and with W in talk to the baker or the miller |
| Help at the mill | task kind `mill`, `game.ts settle`, client `MillRun` (RUN_MAKERS) | 60 game minutes by the mill; the miller calls twice ("To the capstan!"), E at the capstan for 5 s turns the cap. Pay: half for being there, the rest by the turns; away over 20 s halves it; trust +1 when every call was answered, -1 when none was. A turned cap grinds a sack more |

Pay (engine, `millPay`, clamped to the tier band): by hand one sack, 25 c + 50 kg x metres / 180 (the Kipdorp store to
the Steenplein bakery, 337 m: 120 c); with the miller's barrow (once cart work is open) three sacks, 40 c + weight x way
/ 300 in the cart band (100-150 c). Twists are the carry twists: flour none, broken goods (a split sack), heavy load,
stranger offer; grain none, broken goods, foreman watches, stranger offer; the M6 trouble roll may add customs.
Taken, the flour is set aside at the store; what reaches the loft or the store counts.

## Checks (2026-09-26)

- `cd server && npx vitest run test/mills.test.ts`: 13 of 13 (the people once and pure, their day and the runs; spots,
  bakery doors and ways against the walk map; the carts' ways open, no leg under 2.5 m; the timetable; wind; a clear
  Tuesday of stocks; fog, Sunday, a full loft, a long gap; bread price; pay; the flour job set aside, delivered, paid
  and trusted; the grain job; the hour's help by turns; the barrow load). `backtown` and `transport` tests leave the
  `ml` ids out as they do the `wu` ids. Full server suite green.
- Browser, test stack `mills` (8943/5343, a copy of the save): `paths()` = `[]`; `propcheck()` mills 10 props, 0
  problems (the one listed problem is a litter crockery at -163, 301, not this work); `shaders()` problems empty;
  `popcheck()` pops `[]` through every run. `mills.update` 0.002 ms a frame; the sacks and the still carts are drawn
  within 150-160 m only.
- Followed the flour cart (dev shift `__scheldemist.mills.devRun("flour")`, by daylight): loading at the store
  (`mills_1_loading`, `mills_1b_loading`), on the way out of the Kipdorp gate street (`mills_2_on_the_way`), at the
  bakery (`mills_3_at_the_bakery`), unloading with the baker at his door (`mills_4_unloading`, `mills_4b_baker_at_door`).
  Grain loaded at the canal quay with a docker (`mills_grain_dock`); the north mill's handcart (`mills_ne_loading`,
  `mills_ne_handcart`); the sails in wind and still in fog (`mills_sails_wind`, `millSails` 1 and 0).
- The carry job: "A sack from the mill" for the Steenplein baker, 120 c, on the board and in his talk list; lifted at
  the store, carried, set down at his door: paid 120 c, the loft 5 to 6, the mill's flour 6 to 5 (`mills_job_1..4`).
- The hour's help at the Kipdorp mill: two calls, both turned (`mills_help_cap`, `mills_help_capstan`): paid 60 c,
  the mill's flour +1.

Pictures (PNG) are in the helper's scratchpad `mills/`.

## Open

- A game hour is two real minutes: the dawn flour run takes the whole morning (about 2.5 game hours each way), and the
  carry job by hand is long (the Kipdorp store to the Steenplein is about 3 game hours with a sack). The pay follows
  the way. Steve may want the barrow offered more often, or a nearer bakery.
- The flour run is in the dark in autumn (4:30): the man carries a lantern; pictures were taken with a dev shift.
- The miller's push at the capstan uses the plain "push" pose: no `reachArm` to the spokes yet.
- The unseen man walks the carts' way point to point by the clock; a man seen again far from it walks back onto it.
- The north mill's stair and bastion were walked; its capstan is the gallery's chain (Jef turns it from the walk).
