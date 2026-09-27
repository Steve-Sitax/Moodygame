# M8d: shared work

Phase M8d of `docs/multiplayer-plan.md` (section 10): the director, the town's events, the jobs and their twists,
the police and each player's end work for every player in the game, not only the host. Built 2026-09-27 in the
worktree `D:\Code\MoodyGame-m8b` (branch `m8b`), after M8c.

## What is in

| Part | What | Where |
|---|---|---|
| Each player's place | The director and the events ask where a player is: `jefAt(now, id)` (his movement socket's place when fresh, else his tab's word), `playersAt()` for everyone in the game. A guest's tab no longer moves the host's place. | `server/src/director/actions.ts`, `player/current.ts` (`positionOf`), `mp/index.ts` |
| The director is fair | With two or more in the game its prompt has a PLAYERS block (where each is, a job or not, a lead or not) and "the next event is for X" with places near him. An event goes to the nearest player without a lead this round (within 250 m); the round starts again when everyone had one. `town_event.for_player`. Robberies are searched per player; the cards' promise is kept for each player. | `director/director.ts`, `scheduler.ts`, `schema.ts` |
| Townspeople's errands per player | `npc_action.for_player`: follow, seek, fetch the police are about one player; three asked in talk at most per player; only he can stop them. The PC that walks the townsperson walks him to that player (who may be another PC's). Errands (steps) run on their player's PC. | `director/actions.ts`, `steps.ts`, `client/src/game/actions.ts`, `steps.ts` |
| Who saw a scene | Robberies and scuffles keep `witnessedBy` (the players in sight). | `director/scenes.ts` |
| The AI budget | `ai_call.player_id`. With a daily limit set (Steve: none by default in multiplayer is open; alone it stays 120), the day grows by half a share per extra player; a player's own hooks (talk, typed lines, outcomes, letters, diary, epilogue) are capped at one share; out of share he gets the hand-written lines, the others still get the model. Played together at most 3 calls run at once, talk first, world hooks last; the wait is capped at 20 s and does not eat the call's own 20 s. | `server/src/ai/budget.ts`, `ai/claude.ts`, `config.ts` |
| The town's events per player | Family news, visits and menaces go to their player at his place (`family_news.player_id`); menaces and trouble limits per player; the stranger's errand per stranger and player; the fire's bucket chain has a slot per player (`fire_for`); the natie gate's hiring per player; a hand or a treat guest follows his own employer. `asWorld(fn)` runs the world's own work outside any player. | `director/families.ts`, `surprises.ts`, `fire.ts`, `hiring.ts`, `town/hire.ts`, `ideas/trouble.ts`, `night/gangs.ts` |
| Pins | A townsperson called for a player's job, visit, hire or treat is walked by that player's PC only (the server's `pins`, sent to all; his PC may take him from anyone). | `mp/index.ts` (`seekPins`, `handPins`, `jobPins`), `client/src/net/mp/street.ts` |
| Job twist figures for all | The thief, the stranger, the foreman, the recipient, gang lads and the stowaway a job makes are sent from the holder's PC (`MSG_FIGS`, 22 bytes a figure, 10 a second while one walks); the others draw them 200 ms behind; they go with the holder. `MP_PROTOCOL` 3. "Out of sight" is out of every player's sight; a figure vanishes only where nobody sees it. | `shared/mpProtocol.ts`, `client/src/net/mp/jobfigs.ts`, `client/src/game/figures.ts`, `town/walkup.ts` |
| Jobs | `finishJob` pays the player who did the job (M8c paid player 1) and moves only his trust; only the holder saves, holds, finishes or hands over his job. `shadowFacts` and the follower use the holder's place. The board: 4-7 jobs alone, plus 2 per extra player (up to 6); the night board 2-4 plus 2 per extra player. | `server/src/game.ts`, `hooks/jobBoard.ts`, `night/nightwork.ts`, `index.ts` |
| Players as witnesses | Another player in sight of a theft (weather, light, lantern, crouching, a clear line) is told "You saw Anna take Sooi's lantern by the Hessenatie door."; the thief hears "Anna saw it too." The police send a separate agent to ask him; an agent is never on two cases at once. | `town/deeds.ts`, `deedRoutes.ts`, `police.ts` |
| The cell | Played together, an arrest is a rest of kind "cell" till dawn at the world's pace; the sleep screen says "In the cell at the police post"; the others play on. A night passes fast only when everyone is asleep or in the cell. | `rest.ts`, `shared/sleep.ts`, `client/src/game/sleep.ts`, `deeds.ts` |
| Each player's end | Every player's end writes his own epilogue; at the world's week end each player in the game gets his own. A player whose health ends his week early gets his while the world goes on. | `day.ts`, `hooks/epilogue.ts`, `index.ts` |
| A new man on the ferry | After his own end, played together, N gives a new man: fresh money, needs and pockets, no job, room, trust or record. The old man is retired under his old name (a negative id), so the townspeople's memories stay true. Never a new week. | `player/multi.ts` (`resetPlayer`, `retiredMen`), `arrival.ts`, `client/src/game/day.ts` |
| A guest's first arrival | The character sheet ("Off the ferry to Antwerp", his join name filled in), then the ferry opening, not a place beside the host. A guest's number is never given twice (a removed guest's man, look and things stay his). | `arrival.ts`, `client/src/game/ferryArrival.ts`, `menu/character.ts`, `mp/players.ts` |
| Bugs | The paper's and the ideas' morning stop only when the world's week is over or every player in the game has ended. | `paper/routes.ts`, `ideas/routes.ts` |

## Checked (2026-09-27)

- Server: 1184 tests pass (79 files), among them `m8d-core`, `m8d-director` (19), `m8d-events` (10), `m8d-jobs`
  (12), `m8d-police` (9), `m8d-ending` (8), and the live two-player tests in `mp.test.ts`. `npm run build` clean.
- In the browser (test stack, host and `?seat=2`):
  - A new guest gets the sheet with "Off the ferry to Antwerp" and his name; Start, then the ferry; ashore later.
    (Found and fixed: a new guest got a removed guest's number and with it his old look "Tester"; the sheet opened
    behind the title menu where no click reached it.)
  - The host takes Sooi's lantern with Anna 6 m off: the host reads "Anna saw it too.", Anna's screen says "You saw
    Jef take Sooi's lantern by the Hessenatie door."
  - Anna takes a thief job; her thief is drawn on the host's screen (`jobFigs`: batches in, 2 drawn).
  - Anna's health to 0: "The end of Anna" on her screen, the host's clock goes on (19:03 to 19:08), no end for him;
    N: a new man, 50 c, health 8, the sheet and the ferry again.
  - Played alone: the clock moves on the tab's ticks, buying works, `shaders()` has no problems; `paths()` lists
    only a church house at the west end (the curate's or the organist's: the same known fault from main).
- Not checked in the browser: the cell (unit tests only), the director's fair leads with a live model, the AI
  queue under load.

## Review round 3 (2026-09-27)

Fixed:
- The director's, events' and actions' tick ran as whichever player's tick set it off (his name in the prompt and
  the shared log): now the world's own work (`asWorld`).
- Any player could report on any townsperson's errand: now only the PC that walks him or the player it is for.
- A new man kept the old man's errands, visits, family news, hands and callers: all ended by `resetPlayer`'s hooks.
- The call queue could outlast the client's 30 s: a call waits at most 8 s for its turn, then its own 20 s.
- `clerk`, `tavern_dice` and `hands_lines` count as the player's own calls.
- Job figures: no allocation per frame; batches only from a player with a job or a call (10 s grace), at most 15 a
  second a seat. The fallback board is sized by players. A witness's question is not dropped when he steals
  mid-talk. "Out of sight" counts walls beyond 10 m.
- Checked again in the browser after the fixes: the witness line, the guest's thief on the host's screen (66
  batches out, 66 in, none dropped), the sheet opening once the guest is in the game, `shaders()` empty.

Still missing for good games together (next):
1. Real co-op: two players on one job (shared carrying and pay), giving money or things to each other, a plain
   chat or a wave.
2. Director events for a group standing together.
3. The host leaving mid-game: what the guests see.
4. The other players on the guest's map; a way to find each other.
5. The night board's fallback sized by players; the cell, fair leads with a live model and the queue under load
   with 3-4 players checked in the browser.

M8e (next): https with a house certificate, `wss://`, the VPN's names and addresses (off by default), a Service
Worker from the manifest, rate limits per seat on frames and routes, VPN latency and reconnect.
