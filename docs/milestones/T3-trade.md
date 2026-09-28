# T3: the town's trade

The plan: `docs/trade-plan.md` part B and the chains. Steve, 2026-09-29: "ok do all ... Goal is everything works fine
after M7". Decided 2026-09-27: players move the stock, but food never runs out for a player.

## Part 1: the food posts' ledger (done)

- **The posts** (`shared/trade.ts POSTS`): the two bakeries (bread), the butcher by the Vleeshuis (meat), the fish
  stalls of the Vismarkt (fish). Each has a shelf (room), an order level, a floor kept for players, open hours and
  what the town takes an hour (busier in the morning).
- **The ledger** (`server/src/trade/ledger.ts`, `world_state` key `trade`): stepped with the clock in five-minute
  steps, as the mills' `stepStocks` (at most three days of a gap), on every tick and whenever it is read.
  - The town buys from each open post down to its floor, never below; nothing on a Sunday.
  - **The bake** (the mills' 3:00 bake, `town/mills.ts millEventHooks`): every sack of flour baked is 24 loaves
    on that bakery's shelf. A short loft is a short bake is a short shelf.
  - **The kill** at 7:00 on weekdays in the butcher's yard (off screen, as the plan has it): 22 portions, 30 on Friday
    and Saturday.
  - **The fish**: the Vismarkt's two docker routes (vm-1, vm-2) now carry boxes of fish from the Vliet to the back of
    the fish banks. The boxes land at dawn only (`dawnOnly`); each box set in adds 6 fish to the stalls. A player in
    the foreman's book may carry them too (paid by the piece), which is how a short fish market gets help.
- **Buying moves the stock**: a player's food bought from a post's seller (the shop, its keeper's wife, the fish
  stalls and the fish merchant, Fientje, the bread stall and the baker's boy) takes one off the shelf, below the
  floor too: the food never runs out for him. At the floor the seller says so ("The last loaves...") and the price
  is at the top of the band.
- **The price by the shelf** (`stockPrice`): a cheap good at most +2 c or -1 c, a dear one a fifth; at the floor the
  top, under the order level half of it, a full shelf a step down; fish cheaper after 13:00 and 15:00. The bread's
  price follows the bread shelf now (the loft rule `breadExtra` stays only for its test).
- **The talk**: a post under its order level is news; every talk prompt gets up to three lines ("The bakery on the
  Steenplein is running low on bread.").
- **The fish box** (`client/game/fishBox.ts`): a low open box of rough boards packed with herring; on the Vliet
  piles, in the dockers' arms and in the player's hands (one model wherever it shows).
- **GET `/api/trade`**: every post's shelf, order level, floor and today's sales.

## Checks

- `server/test/t3-trade.test.ts` (6): the town down to the floor, Sunday, the kill, the price band, buying at the
  floor, the bake, the fish box.
- Browser: `/api/trade` moves with the clock; the Vismarkt's dockers carry fish boxes (stacked at their own height,
  0.24 m); `carrycheck()`, `shaders()` clean.

## Next

- The dispatcher: runs sent by need (a cart of bread to the other bakery, fish boxes onward to the grocers).
- Chain 3 in the open: farmers with animals through the gates at dawn to the butcher's yard (animal models).
- The map's card: a post's shelf; the runs list by chain.
- Jobs from shortage beyond the book: a rush fetch when a shelf is empty in the morning.
- The goods kit for crates and casks (the sack pattern: one model, a label sheet), then the stalls pack up early when
  their shelf is empty.
