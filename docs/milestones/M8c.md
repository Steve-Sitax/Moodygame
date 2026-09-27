# M8c: each his own man

Phase M8c of `docs/multiplayer-plan.md` (section 10): every player his own money, needs, pockets, work, room and
standing in the town; the town, its people and its clock the same for everyone. Built 2026-09-27 in the worktree
`D:\Code\MoodyGame-m8b` (branch `m8b`), after M8b. The rules the code follows: `docs/milestones/M8c-rules.md`.

## What is in

| Part | What | Where |
|---|---|---|
| Who the work is for | Every `/api` request runs as its player (the host 1, a guest his id): `pid()` from an AsyncLocalStorage context, set by the multiplayer part from the token. The engine's queries of the player's own things ask `pid()`; nothing else needed a new parameter. Outside a request (the world's own work) it is the host. `asPlayer(id, fn)`, `forEachOnline(fn)` run work as a player, or as each player in the game. | `server/src/player/current.ts`, `mp/index.ts` |
| The save | Several player rows (the old `CHECK (id = 1)` goes: the table is made again, the clock's triggers too; SQLite's `legacy_alter_table` for the rebuild, checked on a copy of Steve's save). `player_id` on pockets, the log, rooms and their furniture, deeds, letters, pawn tickets, diaries, meetings; `job.taken_by` (none: the host); trust per faction and each townsperson's view per player (keys with the player); a memory says whom it is about; `player_state` for the keys that were the one player's (his ride, his police record, his haggle, his gang, his carts ...), the host's older `world_state` key read until written. A guest's row and starting things are made when he joins. | `server/src/player/multi.ts`, `db.ts` |
| Every part of the engine | Money, needs, pockets, the job in hand (one per player; another's is off your board), trust, the townspeople's view and memories, rooms and rent (a room is let to one player), deeds and the police, thieves, haggling, talk, carts, velocipedes (only the rider leaves his), boats, gangs, families' visits, promises, errands, hired hands, the tavern, the Poesje, the sermon, the ballad, letters, the post, the pawn, posters and their rewards, diaries, meetings, landmarks. | four workers by folder, `server/src/**`; tests `server/test/m8c-*.test.ts` |
| Names | The engine writes "Jef" for "the player". Words kept for everyone (the log, the memories, the events) keep a guest's own name; read for a guest, the host's "Jef" there becomes the host's name. Every answer and push puts the asking player's name and words in (his profile, by his id). | `server/src/player/names.ts`, `player/prompt.ts`, `index.ts` |
| Pushes | Each tab says whose it is (a guest's tab its token, in its first message). "jobs" pushes are made per player; news about one player (his outcome, trouble, letters, gang, family, hands, rent, end) goes to him only; the town's news to all. | `server/src/index.ts` `broadcast`, `client/src/net/api.ts` |
| The world's tick | Played together, only the server's own tick moves the clock, once; every player in the game has his part of each piece of time: his hour when it turns (needs, his end, his drop), his sleep at the world's pace; the night passes fast (30 minutes every 300 ms) only when everyone in the game is asleep; a player who is gone is frozen till he is back. One player's night in a bed or a cell no longer carries the world to the morning. The town's per-player parts of the tick (the police, carts, velocipedes, boats, errands, the fortune teller's promise) run for each player. A tab's tick is its heartbeat: it says where he is and whether his tab shows him asleep, and hears how his sleep stands or how it ended. | `server/src/day.ts` `worldTick`, `rest.ts` (`restPiece`, `collapseRest`, `takeWoke`), `mp/index.ts` |
| Dropped where he stood | Dead on his feet, a player sleeps where he fell while the world goes on; the sleep screen comes to him with his next heartbeat. | `rest.ts`, `client/src/game/sleep.ts` `joinFromServer` |
| One talk at a time | A townsperson in talk with one player tells another "Maria is talking with Anna." until a goodbye (or 30 s after their last words). | `server/src/player/talking.ts` |
| Guests play | The visitor rule is gone: a guest works, buys, talks, rents, sleeps, steals and is arrested like the host. The world's own things stay the host's (a new week, loading a save, the settings, the house, the code, pause all, the dev tools). A guest's "save" keeps his own part (`client_state`), never a save file. | `mp/index.ts`, `save/routes.ts` |
| The world PC is asked | A guest boarding the omnibus asks the world PC to hold it; his boat asks it for a bridge or the lock (the lock waits where the world PC draws him). | `client/src/net/mp/world.ts` `ASKS`, `mp/index.ts` |

## Checked (2026-09-27)

- Server: 1122 tests pass (73 files), among them `m8c-core`, `m8c-town`, `m8c-director`, `m8c-homes`, `m8c-tick` and
  the two-player live-server test in `mp.test.ts` (a guest's purse, job, board and pushes his own).
- A copy of Steve's save upgraded: his man, money, letter, job and 1181 relationships stay player 1's; the triggers
  and the integrity check are fine; a second open changes nothing.
- In the browser, host and guest in two tabs: Anna buys a herring, 50 to 45 c on her screen and the server, the
  host's 35 c untouched; Anna, dead on her feet, drops asleep at the hour, her sleep screen opens by itself, and
  the host plays on while the world's clock moves 10 minutes, not a night.
- Played alone: the clock moves on the tab's ticks as before, buying works, `shaders()` has no problems, `paths()`
  lists only the home of Father Norbert Stessens (from main, its own task).

## Review round 2: what is still missing (2026-09-27)

For M8d:
- The director, events and job twists are still the host's: his leads, his facts (`crimeOpen`, `promiseThread`),
  one position for "Jef" (`syncFromClient`); family news and reactions, the stranger's errand; a menace to a guest.
- A job figure of a twist (the thief running off, the foreman) is made by the job holder's PC and not seen by others.
- A player's end: he gets his epilogue; a new man on the ferry for him is not there yet (he waits for the week's end).
Smaller:
- A guest never gets the ferry's opening scene; he starts ashore by the host.
- Treat: a guest's guest follows the host.
- Two sleepers wake and go on without seeing each other's sleep (fine), but a player in the cell sits out the
  night while the world's clock goes on at its pace (no fast night for one).
- Cranes: a guest may not climb one while another PC runs the world ("The crane is at work").
