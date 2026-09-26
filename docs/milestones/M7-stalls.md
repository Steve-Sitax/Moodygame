# M7 stalls: stalls and goods, better and placed right (2026-09-26)

Steve: "some shops are weirdly going over a corner" (a shop's blue-and-white awning ran through the corner
of a yellow plaster house on a square), and "shop stalls and goods update: make a picture and ask codex to
make it look more detailed and implement", keeping the PS1 look, the fog and 1873.

## Placement
- **The cause**: a town shop's table and awning stood 1.9 m to one fixed side of its door. The door sits in
  the middle bay of its house front, so on a two-bay house the table's side had 1.4 to 1.8 m of wall and the
  2.6 m awning ran past the corner. 9 of the 11 shop tables did.
- **The fix** (`shared/shopFront.ts`, used by `game/stalls.ts`, `game/lively.ts` and the server's
  `town/deeds.ts` and `town/population.ts`): the table stands on the shop's own house front (the footprint
  edge the door is in), on the side with room, 0.7 m clear of the door's middle and 0.2 m clear of the end.
  A short front gets a shorter table and awning, a very short one the table alone, none at all when there is
  no room (the keeper then minds the shop from the step). The keeper stands between the door and the table;
  the food a thief lifts is on the table where it is drawn. Goods set out on the door's other side
  (`game/lively.ts`) keep to the same front; goods before street life's shops stand a hand off the wall and
  only where the house goes on behind them.
- **The market** (`game/market.ts`): each item is dressed first and its real extent (goods, crates at the
  ends) is what must fit, with room behind for the seller and before it for the buyers.
- **The check**: `await __scheldemist.stallcheck()` (`dev/stallcheck.ts`, registry `game/stallSpots.ts`). Every
  market item, town stall, shop table with its awning, cathedral stall and goods set out before a shop, by
  its model's points in two layers (table and goods; awning): into a house footprint or through a wall of
  the real geometry, past a corner (the house behind a wall-hung thing all along), on the walk map's walls or
  water, in a doorway, less than 1.5 m (market 1.2 m) of street before it, floating or sunk, overlapping
  another stall thing or a sign, board or awning on the wall. Before: 44 problems over 197 things (18 on
  the 9 shop tables past a corner, 13 market overlaps and blocked fronts, 13 on goods set out before shops: 8
  into a sill or a door's surround, 1 past a corner, 4 under a sloping awning, which the check now reads
  right). After: 0 over 202.

## The look
Codex repainted five of our own shots (the fish market, the Grote Markt vegetables and cheese, the cloth,
pottery and brazier stalls, the corner shop, the cobbler's lane); the game follows them:
- New kinds (stalls.glb `mk2_*`, built in `tools/blender/build_stalls.py`): the fishmonger's table (a wet
  dark top with a rim, a bed of ice, herring in rows, cod, a plaice, coiled eels, scales, a slate, a bucket,
  a basket and a crate under it, fish crates stacked behind, mud); the greengrocer's stall (crates tilted to
  the buyer in two steps, one vegetable to a crate, crates on the ground, a sack of chestnuts); a trestle table
  under a linen cloth with cheeses, bread or second-hand goods; the cloth seller (bolts and folded lengths,
  lengths over the table's edge, a rack with cloth hanging); the potter's spread on sacking; a hot food
  brazier with glowing coals and a pan of chestnuts; baskets on the stones.
- More on the old ones: heaps with volume, price slates, scales, dried cod hanging from a fish stall's rail,
  baskets, a bucket and a sack under the tables, a sack at a shop table's far end, boots and clogs on the
  cobbler's table, stools where sellers sit.
- By district: the Grote Markt neat (striped awnings, linen on the tables); the Vismarkt, the quays, the
  canal and the lanes rough (patched canvas, wet tables, mud and straw on the stones).
- Pictures: four Codex sheets cut into 14 pictures in `tools/blender/art/market/` (assets/ATTRIBUTION.md);
  one 256 px atlas (`market_detail`, 64 px cells), new awning canvases, a patched canvas, a mud decal.

## Cost
All the town's stalls and shop tables are one mesh per material, made again when a keeper opens or shuts
(at most once a second, about 25 ms). Stall draw calls near the Grote Markt: 165 before (145 of them the
town's stalls and shop tables), 46 after; stall triangles 63k before, 106k after.
