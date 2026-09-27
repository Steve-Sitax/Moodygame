# The town's trade: people who keep going, goods that must arrive (plan, not built)

Written 2026-09-27 after Steve's report:

> When I look at the map I see NPCs pop out of existence when far from a player, and if I run to that place I
> never see the NPC again. They should not just stop existing. Players should be able to catch up and see them
> again, still doing what they planned to: flour from a mill to bakeries, grain to the mill, small animals to
> butchers and meat to shops, fish from boats to shops and the market. The server should keep those needs in check
> and send workers. Players should also be able to get small jobs from those places.

This plan has two halves. Part A makes a townsperson who is far away keep existing, on a real way, at a place
every PC and the map agree on. Part B gives the town a trade: places that make, need and send goods, a server
that sends workers when stock runs low, and small jobs for players at every one of those places.

Part A is needed first. Without it the trade in part B would happen only near a player.

## Why people vanish today (from the code, 2026-09-27)

| Cause | Where | What it does |
|---|---|---|
| Positions live only in the browser | `client/src/game/town.ts` `load()`, `reschedule()` | The server makes the schedules but moves nobody (`server/src/mp/street.ts`, M8b choice C). There is no place where "Wout is 40 m up the Keizerstraat" is true for everyone. |
| Unseen people walk through walls | `town.ts` `coarse()`, `HIDDEN_SPEED = 6` | Out of sight, a person slides in a straight line at 6 m/s (a fast run) to the goal, through houses. He arrives far too soon, so he is not where the player expects him. At a home or indoor goal he is set `inside` and never spawns again until his next goal. |
| He may not appear where the player can see | `town.ts` spawn gate, `crowd.isHidden()` | A person comes back only where the player cannot see that spot (or inside 4 s of a door). If the player stands and looks at the spot, the person never appears. |
| He may not appear where the grid cannot stand him | `town.ts` spawn gate, `canStand` / `openNear` | The walking grid covers only a window round the player. His straight-line spot is often inside a house block, so he is skipped. |
| Held people freeze | `town.ts` `hideAway()`, `moveHidden()` | A person held for an errand and never released stays gone. |
| The map guesses | `server/src/mapview/model.ts` `plannedSpot()` | With no fresh batch (always so when played alone), the map draws the schedule's anchor, not the person. The dot jumps from the street to his workplace. People the plan puts indoors go into the "Indoors" layer, off by default. |

Also: there are no carriers for fish or meat at all. The only goods that move by the clock with no player near are the
mill stocks (`shared/mills.ts stepStocks`) and the Hessenatie dray's three casks (`shared/goods.ts DRAY_RUN`). Every
shop and stall has fixed prices and no stock.

## Part A: a person out of sight keeps going

### The idea: a run is a timetable on a real way

When the town sends somebody somewhere with a purpose (a **run**), the server writes down:

- who (the resident id), what he takes (goods ids from the M8f store, a cart id if any);
- the way: a list of points on the walk map, from the server's own path search, never through a wall;
- the legs: walk to the mill, load 20 minutes, walk to the bakery, unload 15 minutes, walk home;
- when he left, and his speed on each leg (walking 1.3 m/s, with a sack 1.0, a handcart 1.1, a dray 1.6).

Then **where he is, at any game time, is a sum, not a guess**: `runPlace(run, t)` gives a point on the way, the leg,
and what he holds. The server, every PC and the town map all compute the same answer from the same run. No one has to
send positions for a person nobody sees.

This is how the mill's man already works ("unseen, the man follows the same way by the clock"). Part A makes it the rule
for every run, and moves the run from the client to the server.

### What each side does

| Side | Job |
|---|---|
| Server | Owns runs: makes them (part B's dispatcher, or a schedule move), stores them in `world_state`, finishes them (the goods arrive, stock changes) at the planned time if no PC walks the man. Checks progress reports (below). |
| A PC, far from the man | Nothing but the sum. It does not move him. |
| A PC, near the man (the M8b walker) | Spawns him **at `runPlace(run, now)` with his load**, lets the crowd walk him along the rest of the way (local steering round people, carts, the player), and reports how far along the way he is (`s`, metres) with the M8b batch. |
| The town map | Draws `runPlace` for every run: a moving dot, with a small mark for the load (a sack, a basket, a cart). No more jump to the planned spot. |

**Progress reports.** Near a player the man may be slowed (a crowd, the player in his way, a door). The walker PC reports
`s`. The server keeps the later of the two only within limits: it moves the run's clock back by at most the time lost
(so the man does not jump ahead when he leaves view), and never lets `s` grow faster than his leg speed plus 20%.
When nobody walks him, the sum takes over from the last accepted `s`. Played alone, the one PC is the walker.

### Spawning must never skip a man on a run

The spawn rules change for people on a run (and later for everyone):

1. **The spot is on the way,** so it is always open ground. No `openNear` fallback, no skip.
2. **In view is allowed.** A man on a run who comes inside the spawn ring while the player looks at the spot fades in with
   the PS1 dither (0.5 s), the same dither the fog uses. At fog distance this is not seen. At 55 m in clear weather it
   looks like a man stepping out from behind others. That is better than a man who never comes.
3. **The ring grows for runs** from 55 m to the fog distance, capped at 90 m. Men on runs count first against
   `MAX_PUPPETS`: an idle stroller is trimmed before a carrier.
4. **Indoor legs are real.** Loading inside the mill store or the butcher's yard is a leg with a place inside the real
   interior (the interiors are real, never instanced). A player who walks in sees him there.

### Everyone else too (the schedule moves)

A plain schedule move (home to work at 6:00) becomes a small run as well: a way from the walk map and a walking speed,
not a straight line at 6 m/s. `coarse()` then follows the way, not the line. The cost is a path search per move on the
server, cached by (from, to) cell. With about 190 residents and a few moves a day each, that is under a thousand searches
a game day, most of them cache hits.

`hideAway()` and `moveHidden()` get a deadline: a held person with no release after one game hour is released by the
server onto his schedule's run.

### Checks for part A (added to the test kit)

- `__scheldemist.runs()`: every run, where the sum puts the man, and whether a puppet exists for him.
- `__scheldemist.findcheck()`: for each run whose man is within 40 m of the player on open, lit ground, there must be a
  puppet within 3 m of `runPlace`. Must list nothing. Run it while walking the player along a run.
- `popcheck()` stays empty (fade-ins are not pops).
- Server test: `runPlace` is pure and the same on server and client; a run's way never crosses a wall or water cell;
  a clock jump (sleep, a new day) finishes every due run once.

## Part B: the town's trade

### Stock, need and work

Each **post** (a place that makes, stores or uses goods) keeps a small ledger on the server:

| Field | Example (the bakery on the Steenplein) |
|---|---|
| holds | flour 5 sacks (room 8), coal 6 baskets (room 10), bread 0 (baked at 3:00, sold by the day) |
| uses | 3 sacks flour and 2 baskets coal at the 3:00 bake; 1 of each on Sunday |
| makes | bread by the bake; sold to townspeople and players through the day |
| order level | flour below 4: send for flour. coal below 4: send for coal |
| comes from | flour: the Kipdorp mill. coal: the coal barge at the canal quay |

The ledger uses whole units (sacks, baskets, crates, animals, barrels) that match the M8f goods kinds, so a unit on the
move is a real item a player can see and, as the rules allow, lift.

### The dispatcher

Every game quarter hour the server looks at every post:

1. A need is open when stock plus goods already on their way is under the order level.
2. It picks the source with stock, nearest by the walk map.
3. It picks the carrier: first the post's own man (the miller's man, the butcher's boy), then a free worker of a fitting
   trade from the town (a docker, a carter, a boatman who is at work and not on a run). The carrier must be awake, at work,
   and within his work hours when the run ends.
4. It makes the run (part A) and takes the goods off the source's ledger. They reach the target's ledger when the unload
   leg ends.
5. No carrier free, or the run would end after closing time: the need becomes **a job for players** (below). If no player
   takes it in a game hour, a carrier from the next shift takes it, late.

The dispatcher is plain engine code with hand-written numbers. No model call. The director (M6) may add **shocks** as it
does events today, as proposals the engine clamps: a storm keeps the fishing boats in, the mill's sail breaks, a barge is
late, a sick pig on a farm. A shock changes a rate or blocks a source for a set time. It never sets a stock.

### What shortage does

- **Prices.** As the bread price follows the bakery's loft today: short goods cost more, a glut costs less, in a clamped band
  (at most +2 c or -1 c for cheap goods, a fifth for dear goods). The fish price falls through the afternoon.
- **Talk.** The baker complains; a rumour ("no flour at the Steenplein, the Kipdorp mill has no wind") joins the rumour pool.
- **Work.** A shortage is where jobs come from (below).
- **Stalls.** A stall with nothing to sell packs up early.

### Players

- **Buying moves stock.** What a player buys comes off the shop's ledger. A player who buys all the bread empties the
  shelf for the town too.
- **Theft moves stock.** Goods lifted off a cart or out of a yard leave the ledger (a deed, as today). The target post
  waits and sends again.
- **Help moves stock.** A player who carries goods to a post adds them to its ledger.
- **Seen by all.** A run is the server's, so both players in a shared town see the same cart at the same place, and the
  town map shows it. (Multiplayer: this is the M8b walker plus a server-owned run; see `multiplayer-plan.md`.)

### Small jobs at every post

Every post with a ledger offers small work, made by the engine from its own state (as `offerMillJobs` does today): on the
job board, and with W in talk to the post's keeper or man. Hand-written words; an AI line may flavour it later under the
usual clamps.

| Kind | When it is offered | What the player does | Pay (engine, clamped to the tier band) |
|---|---|---|---|
| Fetch | A need is open and no carrier is free | Carry the goods from the source to the post (by hand 1-2 units, by barrow or handcart more, as `loads.ts`) | By weight and way, as the mill pay: `25 c + kg x m / 180` by hand |
| Help load | A run is loading at a post near the player | Stay and lift units onto the cart when called (E at the pile) | Half for being there, the rest per unit; the run leaves sooner |
| Ride along | A cart run with far to go | Walk with the cart; guard it through the back streets; push on the bridge ramps | A flat 30-50 c; thieves along the way may try the load (M6 thieves) |
| Stand in | The post's own man is sick, drunk or in the cell | Do his run by the timetable | His day's pay |
| Rush | A post is empty and it is sold out (no bread at 7:00) | Fetch before a time ("before the bell at 9") | Pay +50% if in time; trust with the keeper +1 |
| Take back | Empties (barrels, baskets, fish boxes) pile up at a post | Carry the empties back to the source | Small, but always there |

The trust goes to the keeper's own faction, as the mill work does.

## The chains

Steve named four. The first is built; the others are new. The rest are ideas for the same machine. Every chain reuses
places that exist; new places are marked **new**. Period notes are from general knowledge of Antwerp and Belgium around
1873 and need a check before the words go in the game.

### The four Steve named

**1. Grain to the mill (built: `shared/mills.ts`).** Barges land grain sacks at the canal quay and the Petit Bassin's south
quay; the mill's man fetches three sacks after dinner, a docker hands them up. Moves to the dispatcher with no change of
numbers.

**2. Flour to the bakers (built: `shared/mills.ts`).** The flour cart at 4:30. Moves to the dispatcher. New: the baker's
bread goes out again, to the baker boy's dog cart round (exists, `lively.ts`), the taverns, the garrison and the prison
(a daily bread order), and the emigrants' lodging house on the day before a liner sails.

**3. Small animals to the butcher, meat to the shops.**
- Farmers' wives and farm lads come in through the Kipdorppoort and the Sint-Jorispoort at dawn with small stock: a pig on a
  rope, two calves in a cart, geese and hens in baskets, a few sheep. They walk to **the butcher's yard (new: a yard
  behind the butcher by the Vleeshuis)**, and, Wednesday and Saturday, the hens and eggs to the Grote Markt.
- The butcher kills in the yard in the morning (off screen: a shut door, a sound, a lad with a bucket), hangs the meat,
  and sells from the shop.
- The butcher's boy takes meat in a covered basket to the taverns, the colonial goods shop (sausage, ham), and the better
  houses round the cathedral (a round, like the milk woman).
- Hides and tallow leave the yard: hides (an M8f kind) by handcart to the quay for a ship, tallow to the chandler (candles).
- Players: drive an animal in from the gate (a slow walk; a pig that stops, a goose that runs); carry a quarter of meat; fetch
  hides to the ship.

**4. Fish from the boats to the market and the shops.**
- Before dawn the eel boats and workboats (the small boat kinds exist) tie up at the Vliet steps and the Werf pontoon. The
  catch comes up in baskets and boxes.
- The auction at the Vismarkt at 6:00 (the fish merchant cries it); the fishwives buy and fill their stalls (the market exists).
- The fish merchant sends boxes on to the two grocers and the taverns that cook; the mussel seller (exists) gets mussels off
  a Zeeland boat.
- Fish spoils: what is left at the stalls loses value by the hour and goes cheap after noon; unsold at close is thrown to
  the gulls (a real bin, a real gull).
- Players: carry baskets up the steps at dawn; run a box to a tavern before noon; help the fishwife pack up.

### New chains (invented for this plan)

| # | Chain | From | Through | To | Carrier | Player work |
|---|---|---|---|---|---|---|
| 5 | Beer | Barley and malt sacks from a barge at the canal quay | The brewery on the Canal des Brasseurs (exists as chimneys; **new**: a brewery yard with a door at `brewery_yard`) | The five taverns and the four back-of-town estaminets | The brewer's dray, a pair of barrels a stop; empties back | Roll barrels down a tavern's cellar hatch; bring empties back (the take-back job) |
| 6 | Coal | A coal barge at the canal quay | **New**: a coal yard by the quay | The bakeries' ovens (the bake stops with no coal), the forge, the homes (the coalman's round, exists) | The coalman with his cart | Carry baskets; shovel at the barge; black hands (a wash at a pump) |
| 7 | Milk | Farms outside the Kipdorppoort | - | The rounds, the bakeries (butter), the taverns | The milk woman's dog cart (exists) | Push the cart up the bridge ramp; stand in for her |
| 8 | Coffee | Green coffee sacks at the Entrepot (bonded; customs must stamp) | The coffee roaster by the canal (exists) | The colonial goods shop, the taverns, the better houses | A docker to the roaster, the roaster's boy after | Fetch a sack from the Entrepot with the customs chit (a paper you carry) |
| 9 | Sugar | Raw sugar from a ship at the Hessenatie | The sugar refinery (exists as a chimney; the door **new**) | The colonial goods shop (sugar loaves), the bakers (peperkoek) | The Hessenatie dray (exists) | Help load the dray |
| 10 | Tobacco | Leaf bales at the Entrepot | **New**: a cigar maker's back room behind the tobacconist | The tobacconist on the Grote Markt | A porter | Carry bales; the tobacconist's rush order |
| 11 | Paper and news | Paper reams from a ship at the Rijnkaai | The printer by the Jesuits' church (exists) | The newsboys at dawn (M6 paper exists); posters to the bill-sticker | The printer's boy | Fetch reams; paste posters (the posters exist) |
| 12 | Victuals for the liner | The baker (biscuit), the butcher (salt meat in casks), the chandler (rope, lamp oil), the water casks | - | The liner's gangway on the day before she sails (M6 liner and tides exist) | Many: the day's biggest demand | A day of many small jobs; a rush before the tide |
| 13 | Timber and barrels | Baltic timber at the timber heaps on the quay (quay props exist) | **New**: a cooper's shop | The brewery (casks), the fish merchant (herring barrels) | A carter | Carry staves; roll a new cask |
| 14 | Ice | Ice from a Norwegian ship, into **new**: an ice cellar | - | The fish merchant, the butcher | A carter with straw in the cart | Carry blocks before they melt (a timer) |
| 15 | Laundry | The lodging houses, the taverns, the Oostershuis | The washerwomen at the court pumps (exist) | Back to the same | The washerwomen with bundles | Carry bundles; wring and hang |
| 16 | Hay and dung | Hay from a barge | The stables of the omnibus and the carters | Dung out through the gates to the farms (the dung on the streets exists) | The town's dung cart at dawn | Muck out a stable (low pay, a bad smell, sure work) |
| 17 | Rags to paper | The ragman's round (exists) | **New**: a rag store in the back of town | Sold to a paper maker's barge | The ragman | Sort rags; carry a bale to the barge |
| 18 | Bread for the barracks and the prison | The two bakeries | - | The garrison and the prison, daily at 6:00 | The baker boy | Stand in; the rush when the baker is short |

A full town with every chain would have about 20 posts and 40 runs out at the busiest hour.

## How this fits the rules of the project

- **The engine owns the numbers.** Stocks, rates, order levels, prices and pay are engine tables. The director only proposes
  shocks; the engine clamps them. No model call in the dispatcher.
- **Always a path.** Every post, source and door in a chain is checked by `paths()`. Every run's way is a walk-map path by
  construction; the server test fails a way that crosses a wall or water.
- **Interiors are real.** The new yards, stores and back rooms follow `docs/building-with-interior.md`.
- **No stutter.** Goods on runs are the M8f items, drawn as now. Fade-ins use the existing dither; no new shader kind.
  The trade tick is server-side and cheap (about 20 posts, 40 runs, a quarter-hour step).
- **Multiplayer.** The server owns runs and ledgers; the walker PC reports progress; late joiners get the runs with the
  world state. A player's buying, theft and help reach the ledger through the server.
- **Saves.** Ledgers and runs are in `world_state`. A clock jump (sleep, a new day) steps the ledgers and finishes due runs
  once, as `stepStocks` does.

## Phases

Status 2026-09-27: the core of T1 and T2 is built (`docs/milestones/T1-ways.md`): ways on foot for every day plan, the shared sum, the unseen walk it, the spawn wait, the town map at the sum. Still open from T1/T2: the mill carts and the dray as server runs, progress reports, the held-people deadline, the map's card and filters.

| Phase | What | Done when |
|---|---|---|
| T1 | Part A for the runs that exist: server path search and cache, `runPlace`, the mill carts and the dray as server runs, spawn on the way with the dither fade, the town map draws runs | Steve runs to a far mill cart seen on the map and finds it there, loaded, still going. `findcheck()` and `popcheck()` empty |
| T2 | Part A for every schedule move; the held-people deadline; the town map shows every resident with his "doing" line, the card and the filters | No resident slides through walls; the map dot and the man agree for everyone; every dot on the town map says what he is doing |
| T3 | The ledger and the dispatcher; chains 1-4 (grain, flour, animals and meat, fish); the butcher's yard; the food floor for players; the goods models for these chains (stencilled stand-ins first) | A game week with no player near keeps bread, meat and fish in the shops; a player's big buy shows up as a new run; a hungry player can always buy food |
| T4 | The quest book (J), up to 3 jobs, the HUD lines, the map's numbered marks, legend and way line; mixed cart loads; the small jobs at every post; "on your way" offers; prices and talk from shortage | Two jobs taken at once, both carried in one cart, each paid at its own goal, in the browser |
| T5 | Beer and coal (chains 5 and 6): the brewery yard, the coal yard, the cellar hatches of the taverns, their models | A tavern out of beer gets a dray; a bakery out of coal does not bake until the coalman comes |
| T6 onward | More chains, one or two at a time, in the order Steve picks | Per chain: its posts, runs, jobs and models seen in the browser |

**Pace.** A game hour is two real minutes. A run goes at walking or cart pace, as the mill carts do today (a long run takes
the morning), so a player on foot can always catch up with it. A plain schedule move keeps a faster unseen pace (so people
still get to work in a compressed day) and slows to walking pace inside the spawn ring; the progress report moves its
clock back by the time lost, so the dot on the map never jumps.

## Decided (Steve, 2026-09-27)

1. **Players move the stock, but food never runs out for a player.** Buying, theft and help all move the ledgers, and the
   town reacts (a run, a price, a complaint). But a hungry player can always buy something to eat: the ledger's last units
   of food are a **floor** kept for players. Below the order level the price climbs (the clamped band), and at the floor
   the shop still sells, dear: "The last loaf, and it costs you." Townspeople stop buying at the floor; players do not.
   Stalls packing up early keep one seller of cheap food open (a bread stall, the mussel seller) until the market's
   `lateGone`. What can run out for players: goods that are not food for hunger (coffee, tobacco, beer at one tavern: the
   next tavern has it).
2. **Beer and coal come next** after the four chains Steve named (phase T5).
3. **Every good looks like what it is**: its own model, or at least a box, sack or barrel with a stencil and a picture of
   what is in it. Goods that look like what they are, below.
4. **A cart takes several loads, and a player can hold several jobs at once** (grain to the mill and coal for a bakery on
   the way): the quest book, below.
5. **Where to go is clear** on the paper map and on the HUD: the quest book, below.
6. **The server's town map shows every townsperson, always, where he is and what he is doing** (Steve's question,
   2026-09-27): the town map shows everyone, below.

## The town map shows everyone

The host's town map (`docs/mapview.md`, port 8790) today draws a live dot only for people a PC walks near a player, and
guesses the rest from the schedule. After T1 and T2 it draws **every resident, at the place the sum gives, moving**:

- **Where.** A man on a run or a schedule move: `runPlace(run, now)`, on the street, never through a house. A man who
  stands (at work, at a stall, in the tavern): his spot. A man inside a building: a small dot at that building's door,
  hollow, with the room ("in the bakery, at the oven"). The "Indoors" layer is on by default.
- **Doing what.** Each dot has a line from the engine, in plain English, no model call:
  "Taking 3 sacks of flour from the Kipdorp mill to the Steenplein bakery (2 left to walk: 180 m)",
  "Selling fish at the Vismarkt", "Asleep at home", "Waiting for the grain barge", "Walking home from work".
  The line comes from the run's leg or the schedule's act, with the goods from the M8f store.
- **A card on click:** name, trade, home, the day's plan (the schedule's parts, the current one marked), the run's way
  drawn on the map as a line, what he carries, and, for a post, its stock.
- **Filters:** by trade, by "on a run", by chain (all the flour runs), by post. A list beside the map: every run now out,
  with its man, load, from, to and time to go.
- **Live and sum agree.** Near a player the dot is the live position from the walker PC, as now. Away from players it is
  the sum. Because the progress reports move the run's clock, the dot does not jump when a player walks away.

Not on the map: the nameless decoration (market shoppers, the crowd's porters). They are not townspeople and have no
plan. If Steve wants them on the map, they must become townspeople first (a later choice).

## The quest book: several jobs, a cart with several loads, clear goals

Today a player holds one job (`server/src/game.ts takeJob`: "finish the job you have first"; client `game/jobs.ts`
one `active` slot). The handcart's data already tags each item with its job (`server/src/town/handcart.ts`), so mixed
loads need only the rule changed.

**Several jobs.** A player may hold **up to 3 jobs** at once (an engine number, `MAX_JOBS_IN_HAND`). Each keeps its own
time limit, twists and pay. A fourth is refused in talk: "You have your hands full already." Giving one up works as
today (trust cost with that employer only).

**One followed job.** One job is **followed** at a time. It drives the HUD: the task card, the glow over its goal, the ink
tick at the screen edge. The others show smaller. Switch the followed job with the book or with **J** twice.

**The quest book (key J, a new action in `menu/keys.ts`).** A notebook in the same paper look as the map. One page per job:

| On the page | Example |
|---|---|
| Title and employer | "Grain for the Kipdorp mill", for Miller Wouters |
| What to carry, and how far along | 3 sacks of grain: 1 at the mill, 2 in your cart |
| From and to, with the distance from you | From the canal quay (60 m) to the Kipdorp mill store (410 m) |
| Pay and time | 120 c; before 17:00 (in 2 hours 10) |
| Twists you know of | "The foreman is watching" |
| Buttons | Follow, Show on the map, Give up |

A last page lists the cart: every item in it, and which job it is for.

**The HUD.** The task card shows the followed job in two lines: what to do next, and where, with a distance
("Set the sacks down at the Kipdorp mill store - 410 m"). Under it, one short line per other job ("and: coal for the
Kipdorp baker - 380 m"). The glow and the tick point only at the followed job's goal. The other goals get a small, dim ink
mark in the world when within 60 m.

**The paper map.** Each job gets a numbered mark: the followed job a red cross with its number, the others brown crosses
with theirs, the source of each job a small circle with the same number. The followed job's way from the player is drawn as
a dotted ink line, from the same path search T1 builds. A **legend** in the corner explains every mark (goal, source, work,
shop, bed, you).

**Mixed cart loads.** The handcart takes goods from all the jobs in hand, within its limits (`CART_LIMIT`: size 6,
260 kg). Each item stays tagged with its job. An item set down by its own job's goal counts for that job only; an item set
down by the wrong goal does not count, and the book says so ("That coal is for the baker, not the miller"). Unloading all
at once tips only the items of the goal's job.

**On your way.** When a player holds a job, the dispatcher looks for open needs whose source or goal lies within 60 m of
that job's way, and the keeper or the board offers them: "Going to the Kipdorp mill? Take two baskets of coal to the baker
by the gate; it is on your way." A job taken this way pays 10% more. This is how "grain to the mill and coal for a
bakery on the way" happens by itself.

**Multiplayer.** The book and the jobs are per player (M8c). The cart may be pushed by one player at a time, as now.

## Goods that look like what they are

Every good in a chain gets a model from a Blender builder (as `tools/blender/build_quaygoods.py`, with its `stencil()`),
in a new `tools/blender/build_tradegoods.py` to `client/public/models/tradegoods.glb`. Our own models, no third-party
assets. The stencil is the maker's name (a name, so Dutch is fine: "MOLEN KIPDORP", "BROUWERIJ DE HOORN") and a picture
mark (a wheat sheaf, a fish, a lump of coal, a barrel), so the contents read at a glance without words. The look-at hint
and the book say the contents in English ("a sack of flour from the Kipdorp mill").

| Good | Model | Carried as |
|---|---|---|
| Grain | Jute sack, tied at the neck, a wheat-sheaf stencil and the farm's name | Sack (exists as a kind) |
| Flour | Pale cotton sack, dusted white, the mill's name and a sheaf | Sack |
| Coal | Wicker coal basket, heaped black lumps; coal sacks for the coalman | New kind `coal`: size 0.6, 35 kg |
| Beer | Oak cask with iron hoops, the brewery's mark burnt in the head; a smaller keg for estaminets | Barrel (exists); empties are lighter |
| Fish | Wooden fish box with ice and straw; a round fish basket for the fishwives | New kind `fish`: size 0.5, 20 kg |
| Meat | Covered butcher's basket; a half pig in cloth on the shoulder | New kind `meat`: size 0.5, 25 kg |
| Live animals | A pig on a rope, a calf, sheep, geese and hens in wicker cages | Pigs, calves and sheep are **led** (they follow, as the M4 follow does); caged birds are carried |
| Eggs, butter, milk | Egg basket, butter crock, milk churn (the milk woman's cart has them) | New kind `dairy`: size 0.4, 15 kg |
| Coffee, sugar, tobacco | Coffee sack with a port stencil (RIO, SANTOS), sugar loaves in blue paper in a crate, tobacco bales in matting | Sack, crate, a new kind `bale` |
| Hides | Folded, salted hides tied with cord | Hides (exists) |
| Empties | Empty cask (lighter, rolls), empty basket, empty fish box | Same kinds, a flag `empty` |

Until a good's model is built, it is the existing box, sack or barrel **with the stencil decal and the picture mark** on
it, so a player never carries an unnamed box. Every model goes through the prop check, the close-shot loop and the shader
check (`__scheldemist.shaders()` empty) before it goes live.
