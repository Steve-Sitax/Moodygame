# M7 short jobs: two things by hand, bigger loads by cart (2026-09-25)

Steve, after hearing that 5 barrels over 70 m take about 5 game hours at the new clock (a game hour
is two real minutes): "Shorter jobs if it is fetching stuff. Fetching is boring, so no more than 2
items. Maybe sometimes a job with more, further in the game, if we own a cart or if we can use the
owner's cart for it."

Not committed: the main session checks it and commits.

## The rules (the engine's; `server/src/hooks/loads.ts`)

| What | Old | New |
|---|---|---|
| Things by hand | 3, 4 or 5 (from the pay: under 90 c 3, under 130 c 4, else 5) | 1 or 2 (`HAND_MAX`); the model proposes `items`, the engine clamps |
| Time by hand | none (town employers: at most 70 m a trip) | the work at a walk must fit in 60 game minutes (`HAND_MAX_MIN`): two that would not become one; one that would not gets the employer's nearest place that fits |
| Distance used | the straight line | the way on foot over the walk map (`walkDist`, 8-way on a 1 m grid, cached per spot). The brewery door to the west canal quay: 32 m straight, about 90 m over the bridge |
| Cart work | none | 3 to 8 things (`CART_MIN`, `CART_MAX`), never more than one cart load (`cartCap`: 5 crates, 5 sacks, 3 barrels, 6 bundles of hides, 8 coils of rope, 5 chests), 120 game minutes at most (`CART_MAX_MIN`: fewer things, then a nearer goal) |
| Pay, tier 0 (band 50-150) | 50-150 whatever the load | by hand 50-90 c, one thing 50-70 c; cart work 100-150 c (`carryBand`: lower 40 % / 20 % of the band, cart the upper half; tier 1: 150-210 by hand, 225-300 by cart) |
| Night carry (band 120-300) | 3-5 things, 120-300 c | 1-2 by hand, 120-190 c (one thing 120-155 c); no cart work at night |
| Emigrants' luggage | all the family's chests (1-3) | at most 2; a family with three "carry the small one ourselves"; pay 10 + 15 a chest |
| Dawn hiring ("a day on the ship") | 3-5 sacks at 150 c | by hand 1-2 sacks (the pitch says how many); a cartload with the natie's handcart once cart work is open |
| An event's hands | 3-5 at 70 c | 1-2 at 70 c |
| The pitch | the model's words | the engine's count: "Two sacks of coffee" for one sack becomes "A sack of coffee"; "a barrel" on a cart of three "three barrels" (`sayCount`) |

**The gate** (one rule, `cartWorkOpen`): cart work is on the board once Jef has finished 3 jobs
(`CART_AFTER_DONE`), or at once when he owns a handcart (bought new or second-hand). At most one cart
job a board (`gateCarts`). The model is told whether cart work is open; with the gate shut every
`cart: true` is dropped. The fallback board gets a hand-written cart job (Sooi, 5 crates, crane to the
Hessenatie door, 140 c) only when the gate is open.

**Where carts do not go**: the pier head and the gangway (M6: flat ground only), and in among the
market stalls (Vismarkt, Grote Markt: in the browser a loaded cart wedged between the fish stalls).
Cart work does not start at the Katoennatie's door or the Entrepot quay: there is no room for the
lent cart off the quay railway (`NO_CART_FROM`; a test keeps it in step with `lentSpot`).

**Twists on a cart**: a heavy barrel would leave room for two: the cart work stands and the twist
goes. A heavy crate leaves room for four: both stay.

## The employer's handcart (`server/src/town/handcart.ts`, the `lent` kind)

- Taken (`game.ts takeHooks`, new): the employer's handcart ("Sooi's handcart") stands by the goods,
  empty, off the quay railway, the crane runways, the omnibus and dray lanes and the landmarks'
  doorways where it can (`lentSpot`; where the goods themselves lie in a street's lane, off the rails
  at least). Not when a cart of Jef's own (bought or hired) stands within 40 m of the goods.
- The client knows the quay's own things (stacked crates, the railway's standing wagon) that the walk
  map does not: once, before it is touched, it moves the cart to where the whole cart fits with room
  to swing a quarter round and room for Jef at the grips (`settleLent`, `POST /api/cart/:id/place`,
  within 12 m, never on the rails). Where it then stands is where it goes back to.
- Loading, pushing and tipping off are M6's (E on, E the shafts, F at the goal).
- The job ends: "The work is done. Sooi's handcart goes back to the foot of the crane within the
  hour, or his man fetches it and it costs you." Let go within 8 m of where it stood: taken in, no
  charge. Left elsewhere past the hour (`CART_RETURN_MIN` 60): 20 c (`CART_LEFT_FEE_C`, at most what
  he has), trust -1 with the employer's faction, and the employer remembers. Wheeled off by a thief
  (M6's theft roll, a busy place, Jef away): 100 c (`CART_LOST_C`), trust -2, remembered.
- An older save: offered carry work of 3-5 by hand goes to the new sizes once at start
  (`shortenOffered`: the count, the pay by the share carried, never under 50 c, the words). A job
  already in hand stays as it was taken.

The talk prompt and the outcome writer say "by hand" or "on the employer's handcart"
(`dialogue.ts workFacts`, `jobOutcome.ts workLine`). The board line reads "carry 2 crates by hand"
or "carry 5 crates on Sooi's handcart"; the job's first line adds "Sooi's handcart stands by the
goods: load it, push it there, and bring it back after"; the task line "Load the crates on the
handcart at the foot of the crane".

## Pay against the rest of the day

- Before: a carry job of 3-5 things took 2.5 to 5.5 game hours for 50-150 c: about 25-30 c a game hour.
- Now by hand (measured below): 18 to 60 game minutes for 70-90 c: about 90-230 c a game hour.
  Cart work: about one to two game hours for 100-150 c: 70-130 c a game hour.
- A watch pays 80-110 c for its 45-60 game minutes (about 110 c an hour); a delivery 50-150 c for a
  walk. Goods work is now in line with them instead of a quarter of them.
- The day's income is still set by the board (4 to 7 jobs, 2 or 3 of them carry work) and the most a
  carry job pays fell from 150 to 90 c by hand. Living costs about 30 c a day (the week's bed 150 c,
  bread 6 c for 3 points of food, food -1 every 6 game hours): one short job keeps him a day.

## Browser check (test stack `jobs2`, 8974 / 5374, a copy of Steve's save, day 4, silent tab)

Jef walked the jobs by a script in the tab: W held, turned toward the next point of the crowd's walk
grid, E and F through the game's own actions, the game stepped with `__scheldemist.step`; game minutes
= simulated seconds / 2, at a walk (never Shift).

| Job | Things | Way | Game minutes | Pay |
|---|---|---|---|---|
| The model's "Fish crates up from the Vliet" (Vliet landing to the fish stalls) | 2 crates | 25 m | 37 | 75 c |
| Dev job, the brewer (brewery door to the canal quay) | 2 barrels | 25 m | 38 | 90 c |
| The fallback "Two crates off the pier" (pier head to the crane) | 2 crates | 31 m straight, round the pier's root | about 60 (25 the first, 36 the second) | 90 c |
| The model's "A sack, crane to the Hessenatie" (the model wrote two; the engine made one) | 1 sack | 46 m | 26 | 70 c |
| The model's "One barrel to the brewery door" | 1 barrel | 25 m | 18 | 70 c |
| Cart, run 2 (dev, Sooi, crane to the Hessenatie door) | 5 crates | 46 m | loading 14, pushing and tipping 28 (done at 41.5), back about 21: about 63 | 140 c |
| Cart, run 1 (the same) | 5 crates | 46 m | loading 65 (the walk grid's detours round the pile), push 28 after 80 minutes of the script failing to turn the cart, back 21: about 115 without the script's turning | 140 c |

- The model (Opus, the real board, three boards written): with the gate shut it wrote only hand work
  ("One crate of plaice", "Two sacks for the Entrepot"); twice it wrote "Two sacks" with items 1 or on
  a way too long for two, which is what `sayCount` is for (seen after: "A sack, crane to the
  Hessenatie", "A sack of coffee off the sling"). With the gate open it wrote one cart job itself:
  "Barrels by handcart, brewery to west quay": 3 barrels, 130 c, "Take my handcart and bring it back to
  the yard where it stood".
- The lent cart: first placed on the quay railway at the crane's foot (picture: between the rails),
  which led to the rails and lanes check; then boxed in by the quay's crate stacks (picture), which led
  to the client's `settleLent`. After both: it stood 3-5 m from the pile off the rails, loaded in 2-3
  game minutes a crate, and was pushed and tipped off at the Hessenatie door; the job paid 140 c.
  Brought back to the crane: "You leave Sooi's handcart where it stood. Sooi's man wheels it in."
  Left at the door and the clock run on 65 minutes: "Sooi's man had to go and fetch his handcart from
  where you left it; 20 centimes come off your purse for his trouble."
- An older save's board: "Coffee sacks, crane to Hessenatie" (4 sacks, 95 c) became one sack at 50 c
  after the start; "Barrels across the brewers' canal" (4, 100 c) two at 50 c.
- `__scheldemist.paths()` lists nothing. No console errors from this work.

Pictures were looked at and deleted with the stack (`m7short_lent_cart`, `m7short_cart_stuck`,
`m7short_vliet_cart`).

## Tests

`npm test` 817 of 817 (46 files; `npm run build` passes). New `server/test/short-jobs.test.ts` (19):
the model's items (5, 50, 3, 0, -4) clamped to 1-2; two that would take over the hour become one, a
far goal comes nearer, the heavy one counted; the way on foot (over the canal bridge); pay bands and
the tier-0 clamps (99999 -> 90, one thing 70); every hand-written day, night and event job within the
rule; an older save's offered work shortened once (the pay by the share, the words, a job in hand
untouched); `sayCount` both ways and leaving "two hours" and "two men" alone; cart capacity and the
heavy twist; cart counts 1 -> 3, 4 -> 4, 50 -> 5 with the time inside two hours; no cart on the pier;
the gate (shut in a new game, open after 3 jobs or with a cart of his own, one cart job a board); the
fallback's cart job only behind the gate; the lent cart: where it stands (off the lanes and rails, a
place for every cart start), loaded, pushed, tipped off, paid, brought back free; left lying (20 c,
trust -1, the memory); stolen (100 c, trust -2); moved once by the client and never again; no lend
beside his own cart.

Changed tests: `jobBoard.test.ts` (the carry job is 2 hides at 90 c, its share and late pay),
`quest-tests.test.ts` (the brewer's 2 barrels; night carry is one sack, so the "too late" check is at
4:40), `emigrants.test.ts` (at most two chests).

## Files

- New: `server/src/hooks/loads.ts`, `server/test/short-jobs.test.ts`, this note.
- Server: `hooks/jobBoard.ts` (schema `items` and `cart`, the prompt, `fitCarry`, `gateCarts`,
  `taskFor`'s carry, the fallback board, `FALLBACK_CART_JOB`, `devJob` options, `shortenOffered`),
  `night/nightwork.ts` (schema `items`, the prompt, the fallback's pitches, `fitCarry` in the night's
  band), `director/hiring.ts` (by hand or the natie's cart), `town/emigrants.ts` (two chests),
  `town/handcart.ts` (the `lent` kind: `lentSpot`, `lendForJob`, `placeLent`, `lentTick`, `lentLost`,
  `offRails`), `town/handcartRoutes.ts` (`/api/cart/:id/place`), `game.ts` (`takeHooks`), `db.ts`
  (`shortenOffered` at start), `hooks/dialogue.ts`, `hooks/jobOutcome.ts` (by hand or on the cart).
- Client: `game/handcart.ts` (the `lent` kind, "take Sooi's handcart", `settleLent`, a quick reload
  when a job starts or ends), `game/jobs.ts` (the board line, the job's first line), `game/runs.ts`
  (the task line), `net/api.ts` (`cart`), `dev/testkit.ts` (`t.job({ cart, items })`).
- Docs: `01-game-design.md` (How big a job is), `03-ai-design.md`, `testing.md`, `M2.md`, `M2b.md`.

## Not done, or seen in passing

- The words: `sayCount` fixes the number, not the rest of the sentence ("A sack of coffee lie at the
  foot of the crane. Get them inside").
- No pointer or map mark leads back to where the lent cart stood; the notice names the place.
- A hired hand (M6) can be lent the employer's cart like Jef's own; not played.
- The measuring script could not turn a loaded cart in tight places (the Vliet landing among the
  stalls, facing the Hessenatie wall after tipping); a player backs and fills with S. The market
  stalls are now off limits for carts; the Vliet landing is not.
- Seen twice in the tab, not this work's: `Ideas.actions` threw "v.posters is not iterable" during a
  scripted run (`client/src/game/ideas.ts` line 280, a view without `posters`); a later fetch of
  `/api/ideas` was whole.
