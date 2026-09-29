# T5: beer and coal

The plan: `docs/trade-plan.md`, chains 5 and 6. Decided (Steve 2026-09-27): beer and coal come after the four
chains of T3. Built in the night of 2026-09-29 under Steve's "do all" (no questions; defaults below).

## Done (2026-09-29)

- **Beer** (`shared/trade.ts` POSTS, server `trade/ledger.ts`): the five taverns (In de Ankere, Het Schipke, De Vliet,
  Den Engel, Het Bassin) are posts of pints (room 240, order at 90, a floor of 12 kept for players). They pour from
  9:30 to 2 at night (hours past 24 wrap), busiest in the evening. The brewery on the Canal des Brasseurs makes 840
  pints (14 kegs) each weekday at 6.
- **The keg run**: a tavern under its order level gets one keg (60 pints) from the brewery. The dispatcher sends a
  working man of the canal (a docker or a drayman at work, 16 to 60). He walks to the brewery door, takes the keg up
  there, carries it in both arms to the tavern's cellar hatch, and walks back empty.
- **Coal**: the two bakeries' ovens are posts of coal (baskets; room 12, order at 5). A bake burns 2 baskets (1 on
  Sunday). With too little coal the bake is short: half the coal, half the bread; none, no bread
  (`onMillEvents`). The coal yard on the canal's west quay gets 12 baskets from the barge each weekday at 7. The
  coalman (else a working man of the canal) takes 6 baskets to the oven that is short.
- **In the world** (`client/src/world/tradeYards.ts`): a cellar hatch (two oak flaps, iron rings) in the pavement
  before each tavern, where the kegs go in; the coal yard (a faceted heap with lumps on it and three baskets); three
  kegs by the brewery door. Four draw calls for all of it, shared materials, no new shader kind.
- **One keg model** (`client/src/game/kegModel.ts`, CLAUDE.md "one model per thing"): the keg of `clutter.glb`
  (`tools/blender/build_clutter.py` keg()). Places that draw a keg, all switched to it: the kegs by the back doors
  (clutter), the brewery's kegs (trade yards), the keg in the carrier's arms (crowd). clutter.ts hands the model over
  when clutter.glb is in.
- **The load is taken up at the source** (`client/src/game/town.ts tradeRunOf`): a man sent while across town first
  walks to the source's door; only there does he take the keg or the baskets up. Before, he went straight to the
  target with a load out of thin air. (The server's shelves keep their own time; he is only late.) This holds for
  every trade run (bread, meat, fish, beer, coal).
- **The town map and the talk**: the runs show on the map like T3's ("Taking beer from the brewery to In de
  Ankere"); `town/runs.ts` knows pints and baskets of coal.

## Defaults chosen (no one to ask)

- One keg a run (60 pints), not two: a man carries one keg in his arms. A dray for big orders waits (below).
- The brewery's men are the canal's working men: the town has no brewery staff of its own yet.
- The brewery kegs stand where a search finds open ground by the door, off the quay rails and out of the door's way
  (the brewery spot's facing is rough on the slanting quay; the first try stood the kegs on the canal water, the
  second on the rails).

## Not yet

- A dray with several kegs for a tavern far off or very short (M6 transport has drays).
- The coalman carries his 6 baskets as the bread carriers do (a basket on the arm); a coal sack on the back would
  look more right.
- The player cannot buy a keg or coal, or take a keg run as a job.

## Checks

- `server/test/t5-beer-coal.test.ts` (4): a tavern short of beer gets kegs from the brewery with a canal man; the
  taverns open past midnight; a cold oven bakes short; the coal yard sends the coalman. `t3-trade.test.ts` updated.
- Browser (test stack, 2026-09-29): runs from the brewery to In de Ankere and De Vliet: the man walks to the brewery
  door first, the keg in his arms from there to the hatch, empty back; the Ankere's stock goes up by the run.
  A coal run from the coal yard to the Steenplein bakery goes out with the coalman. Pictures: the keg carrier at the
  Ankere, the hatch, the coal yard, the brewery kegs. `shaders()`: no problems (215 programs). `paths()`: nothing.
- Frame budget: at the brewery, the trade yards on and off in one run: 9.3 ms and 9.5 ms mean (no difference within
  the noise); 4 draw calls added, plus 1 per keg carried.
