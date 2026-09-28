# D1: the docks at work

Steve, 2026-09-28 and 29: "make sure if cranes are unloading grain or other stuff it also goes to stacks or in trains or
straight to big carts, but make sure to not block trains or omnibus"; "player should also be able to haul cargo if he
gets a working permit from the foreman already there: 'den boek'"; "earn money per delivered piece, but money is less
than quests and depends on distance and type of good"; "dockworkers are also getting hungry and thirsty so they are
more likely to go to cafes nearby for some food and drink. Especially if no job or already a few jobs done";
"do all ... use the frame budget rule ... also make sure no npc glitch walk in place or can't find a way".

## Part 1: the piles are real goods (done)

- **The loop.** Ship, then crane, then the docker route's own pile, then the docker carries it to the door or drop pile.
  The piles are the routes' own piles of shared/hauls.ts. They stand off the rails, the omnibus and the lanes (checked
  since T1), so no new place can block the train or the omnibus.
- **Dockers** (client game/town.ts, haul): at his pile he lifts the top load for real (`npc_lift`; the server allows a
  docker only his own route's pile, goods/haulFlow.ts). At the other end he sets it down (`haul_in`): in at the door,
  onto the drop pile when it has room. An empty pile: he waits by it and never carries air.
- **Cranes** (client world/railway.ts): a "feed berth" is a place on the runway where a route's pile lies on the hook
  circle (11.5 m) and a hold is under the hook on the water side. Seven routes have one (`CRANE_FED`: rk-m, hn-1,
  en-1, en-2, wf-1, wf-2, wf-3). An idle crane at such a berth swings a sling from the hold onto the pile (three sacks
  or one crate) and reports it (`crane_put`); the server lays the loads in the pile's free places, one sling per 6 s
  a route. A crane prefers a berth whose pile lacks loads. The train's lifts come first.
- **The boats.** Piles no crane reaches get one load every 4 game minutes from 6:00 to 18:30 on weekdays, but only
  while no player is within 45 m (nobody sees sacks appear). At dawn every pile is whole again.
- **The train** still loads from the holds at its crane stops, as before.

## Part 3: dockers eat and drink (done)

A docker whose pile stayed empty three times, or who carried his run of loads (6 to 11), goes for a break at the
tavern nearest his route (within 160 m): 20 to 35 minutes when there was no work, 30 to 45 after a run. The town map
shows him off his plan: "A break at the tavern: food and a drink".

## Still to do

- Part 2: the foreman's book, pay per piece.
- Part 4: the goods kit (crates, casks, bales, baskets on the sack pattern).

## Checks

- Server: `server/test/d1-docks.test.ts`.
- Browser: `__scheldemist.carrycheck()` (every pile's places on open ground, nothing astray), `stuck()`, `paths()`,
  `world.railway().info().cranes[i].feeds / fed`.
- Test steps (`__scheldemist.step`, `t.run`) now run the railway too (the world update gets the camera, as a frame).
