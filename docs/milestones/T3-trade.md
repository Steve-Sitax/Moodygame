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

## Part 2: the dispatcher (done)

- Every quarter hour (`trade/ledger.ts dispatch`): a post under its order level in its open hours, with nothing on the
  way to it, gets a run from another post of the same good with plenty (well over its own order level). One of the
  source's people at work carries it on foot with two baskets (up to 24 loaves), along the server's way between the
  shop doors. The goods leave the source's shelf when it is sent and reach the target's at the end of the unloading.
  Today only bread has two posts; fish and meat have one each (their shortage is the dockers' boxes, the kill, and
  work for players in the book).
- **The run's clock** (`shared/trade.ts runAt`): load 6 min at the source's door, the walk at 1.2 m/s (a game minute
  is two real seconds), unload 4 min, back the same way.
- **In the game** (`game/town.ts`): the town asks `/api/trade` every 3 s; a man on a run walks to the target's door
  with a basket on his arm, stands while he unloads, walks back. Unseen he goes along the server's way (T2).
- **The town map**: the runs list and the dots (`town/runs.ts tradeRunNow`, chain "bread", "on foot with baskets"),
  with the plain line ("Taking 14 loaves from the bakery on the Steenplein to the bakery behind the Rijnkaai (120 m
  to go)"), and the chain filter "Bread".
- **The fish with nobody near**: the Vismarkt's dockers, unseen, take a box in every 6 minutes of the morning while no
  player is within 45 m (`haulUnseenTick`); in sight the drawn dockers do it.
- Dev: `POST /api/dev/trade {post, stock}` sets a shelf (the test kit); GET `/api/trade` lists the runs too.

## Checks

- `server/test/t3-trade.test.ts` (6): the town down to the floor, Sunday, the kill, the price band, buying at the
  floor, the bake, the fish box.
- Browser: `/api/trade` moves with the clock; the Vismarkt's dockers carry fish boxes (stacked at their own height,
  0.24 m); `carrycheck()`, `shaders()` clean.

## Part 3: chain 3 in the open (done, 2026-09-29)

- **The pigs** (`tools/blender/build_animals.py`, `client/public/models/animals.glb`): a new species in the animals'
  builder, as the dogs and cats (our own model, rig and code-painted 128 px texture): a low, deep farm pig on short
  thick legs, a big head with a flat snout disc, ears falling forward, a thin tail curled up; pig_pink and
  pig_spotted, 442 triangles each; idle, walk, run (a trot) and sniff (rooting). Added after the dogs and cats, so
  their paint does not change. The first try stood high on thin legs and read as a tapir: made lower and deeper.
- **The drove** (`shared/drove.ts`, server `trade/drove.ts`): on a weekday a farmer drives two to four pigs (the same
  on every PC for the day) from just inside the Kipdorp gate along the server's walk map to the butcher by the
  Vleeshuis, 318 m. He leaves at 3:45 with a lantern, at a pig's pace (0.9 m/s); they are in at the door by about
  6:45, before the kill at 7; then he walks back out. None on Sunday. Sent with GET `/api/trade` (`drove`).
- **In the game** (`client/game/droveWalk.ts`): near the player (70 m) the farmer (a crowd figure held by this layer,
  so the crowd does not push him) walks behind his pigs; the pigs go in a loose line 1.8 m apart, each a little off
  the middle of the way; at the door they close up and go in one after another, rooting while they wait.
- **The town map**: the drove in the runs list and on the map ("Driving 4 pigs from the Kipdorp gate to the butcher by
  the Vleeshuis, 120 m to go"), chain "animals"; the chain filter also lists meat, fish, beer and coal now.

## Next

- The map's card: a post's shelf; the runs list by chain.
- Jobs from shortage beyond the book: a rush fetch when a shelf is empty in the morning.
- The goods kit for crates and casks (the sack pattern: one model, a label sheet), then the stalls pack up early when
  their shelf is empty.
