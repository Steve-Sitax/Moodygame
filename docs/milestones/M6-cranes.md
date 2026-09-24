# M6 cranes: cranes that do not run into each other (2026-09-24, built, not yet committed)

Steve: "I also saw cranes moving and having their booms go into each other. They should not be able to turn or move
further if they collide."

## What was wrong
- The cranes (M3g, `client/src/world/railway.ts`) kept 12 m apart on their runway, and nothing else. Nothing
  checked the jib: idle swings (up to 0.95 rad off the hull side), the jib laid along the runway to travel, and the
  swing to a wagon row all went through the neighbour's jib or cabin.
- With the jib along the runway toward a crane 12 m off, the hook (11.5 m out) hung right in that crane's cabin.
- Nothing checked the ships' masts either: the Rijnkaai crane swung its jib through the brig's rigging.
- Measured with the checks off (dev `craneCheck({ rules: false })`, 2400 s): a hook's fall 0.44 m into a neighbour's
  jib, a jib 1.3 m into the brig's rigging; with two cranes starting 12 m apart, a hook 3.26 m inside the
  neighbour's deck.

## What is built
### The geometry (`shared/cranes.ts`, new, pure; tests in `server/test/cranes.test.ts`)
- A crane is a handful of capsules (a 3D segment with a radius), from the model's numbers (`build_boats.py`
  portal_crane, portal_jib): the jib (heel 6.5 m up, 1.65 m out, rising at 40 degrees to 11.6 m out), the hoist fall
  from the jib head down to the hook (fatter with a load), the deck and cabin (with the A-frame), the portal top and
  its four legs.
- Clearance between two cranes: every pair of parts where one turns with the slew (jib, fall, cabin, deck); the
  portals against each other in plan. A jib high over a neighbour's cabin is fine; the same jib's hook in that cabin
  is not.
- Margins: 1 m for anything that turns (jib, fall, cabin), 2 m between portals.
- A step is taken if it keeps the margin, or does not bring anything closer than before (so a crane that starts too
  close can always back away). Checked thing by thing.

### The rule in the crane code (`railway.ts`)
- Every move goes through one check, `tryMove`: slew, hoist, travel, the idle swing, the lifts for the train, and
  the load coming onto the hook. The whole step is checked every 0.3 m of the jib head's path. Refused: the crane
  stands still.
- Checked against every crane that can ever come within reach, the moored ships' masts, and the goods train's
  wagons and horses (for the hooks of cranes not working the train).
- Who goes first: the player at the ladder or on the crane (4), working the train (3), travelling (2), idle (1); a tie
  goes to the lower crane number. A blocked crane that outranks the other asks it to make way:
  - the other's jib is in the way: it lifts its hook to 5.2 m and swings its jib away;
  - its cabin or portal is in the way: standing free at a berth, it moves to a berth away; travelling, it backs off
    8 m (as far as its runway and its other neighbour allow). A crane that makes way passes the rank on at half a
    step less, so it can push a third crane, never back onto the one that asked.
- No freezing: a blocked idle swing picks another swing; a travelling crane held by another crane for 2 s backs off,
  held 15 s it works the boat where it stands; a swing in or out held 12 s gives up (it stands as it is and tries
  again later); a lift for the train held 45 s lets the stop go (the train goes on). A crane the train had booked
  while it was travelling, held there 20 s, lets the stop go.
- Planning: cranes now keep **17 m** apart on the runway (was 12): with a load on the hook, a crane can lower into a
  wagon on its neighbour's side only if that neighbour stands 16.2 m off or more. The jib side for travel is the one
  with more room. The train only books a wagon row the crane can reach with its room kept, and only if the swing from
  the hold to the wagon is clear of masts; else it skips that crane (never happened in the long runs).
- A crane not working the train keeps its hook at 5.2 m or more while the hook is over the railway, so the train
  can pass under it.

### Masts (`boats.ts` tall, `rijnkaai.ts`)
- `boats.tall(name)`: the model's plan in 1 m cells with anything more than 4 m over the waterline (masts, rigging,
  yards, funnels), with the top of each. `rijnkaai.ts` collects them for every moored boat, the brig and the barques.
- Each cell is an upright capsule from 4 m over the water to its top (the water from the tide; the brig sits on the
  bottom at low water). The **jib** keeps 1 m off them; the hook's rope may hang past rigging into a hold (checking
  it removed most berths).
- A berth, a trip (the swing in along the runway here and out over the hold there) and an idle swing are only chosen
  if the jib's whole swing is clear of masts; berths are checked at the highest spring tide.

### Climbing (`craneclimb.ts` unchanged)
- A crane with the player at its ladder or on it stands still with its jib at rest (as in M3g), outranks every other
  crane and never makes way; the others keep their room from it.

### Other changes
- The Rijnkaai's second crane now starts at x 0 (was -12, only 12 m from the first; at -7 it could not reach a hull).
  Its sound emitter moved with it (`audio/emitters.ts`).
- Fixed an old travel bug: a bogie on the quay edge (x 170.4, Petit Bassin east) read the wall a hand off as "in the
  way" (the survey looked at the rounded half-metre spot, the check at the exact one); the crane stood there for
  good, and the train, which had booked it, waited too.
- Dev: `world.railway().craneCheck({ reset?, rules? })`: the closest approaches since the reset (jibs and cabins,
  portals, masts, train) with which cranes and when, and per crane: lifts, trips, idle swings, times it made way,
  seconds blocked and by what, the longest block, give-ups, skipped stops, its berths.

## Checks (test save `data/test-cranes.sqlite`, server 8991, vite 5391, headless Chrome; deleted after)
- Long run with the rules on, 4800 s (10 game days, the railway driven at 0.1 s steps), fresh start:
  - closest jibs and cabins **1.00 m** (margin 1), portals **11.1 m** (margin 2), masts **1.00 m**, a hook to the
    train's cars **1.35 m**;
  - no deadlock: the longest any crane stood blocked was 19 s (crane 0 behind crane 1 while 1 worked the train);
    every crane lifted goods for the train (2 to 6 lifts each) and swung idle; the two west Rijnkaai cranes and the
    three Werf cranes made 23 to 58 trips, the crane at x 60 and the Petit Bassin cranes 0 to 1; one give-up (a swing
    out held 12 s by a mast), no stops skipped.
- Through the game's own `__scheldemist.step()` with the crowd, 1440 s: jibs 1.00 m, portals 12.1 m, masts 1.01 m,
  train 1.38 m, longest block 1 s.
- Player on crane 1 (summoned to rest in 5 s, then occupied) for 600 s: it did not move once; the others stayed at
  least 6.15 m off.
- Tests: `server/test/cranes.test.ts` (15: segment distance; jibs at rest clear, swung together meet; the jib high
  over a neighbour but its hook in the cabin; 17 m lets a loaded hook reach the wagon, 12 m does not; portals;
  masts under, beside and below the jib; a low hook over a van; the step rule; ranks; the away angle; two cranes
  slewing into the same gap with ranks 3/1, 1/3 and 1/1: never within 1 m, the first gets there).
- `__scheldemist.paths()`: [] on a fresh start and after 1200 s of cranes moving.
- Cost: the railway's update 0.15 to 0.17 ms a frame (two runs each, rules off and on).
- `npm run build`, `npm test` (575 tests): pass.
- Pictures: `data/shots/m6_cranes_rijnkaai_jibs.jpg` (two Rijnkaai cranes travelling with their jibs laid toward each
  other, stopped with the heads about 3 m apart), `m6_cranes_werf_pair.jpg` (the three Werf cranes, the left one
  swung toward its neighbour).

## Open points
- **Train and omnibus deadlock (not the cranes):** in every long run the goods train came to stand at (64.6, 9.7)
  on the Rijnkaai, "blocked", with a horse omnibus waiting at (62, 8) on the rails ahead; neither moves again. It
  happened with the crane checks off too. The long runs pushed the train past it after 60 s (3 times in 4800 s).
  The crane booked for that stop waits at its "gate" with a load on the hook until the train comes.
- The Petit Bassin cranes rarely travel now: with 17 m between them only one pair of their three berths is far
  enough apart. They still work the train and swing.
- The mast check covers the jib, not the hook's rope in the rigging.
