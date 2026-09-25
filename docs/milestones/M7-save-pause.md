# M7 save and pause

Steve (2026-09-25): "We will add multiplayer in the future, keep it in mind. But now add a save game
system so we load where we left off. When saving, wait on the AI session to finish if active, and
block any new ones from starting, and then save. And also a pause. Same rule: finish the AI session
in the background while the screen freezes, and use the AI result when unfrozen. Nothing progresses
on pause, like real games."

## What is in

| Part | What | Where |
|---|---|---|
| The gate | Every model call passes it (`callClaude`). Open: as before. Paused: no new call starts (it waits; its 20 s limit only starts once it may go); a call already running finishes in the background and its answer waits in the gate until the unpause, so the caller applies it only then. Saving or loading: no new call starts; the calls in flight finish and are applied at once (an answer held by a pause too); then the save or load; then open. | `server/src/save/gate.ts`, `server/src/ai/claude.ts` |
| Server pause | Held per tab (`POST /api/pause {on, client}`; the tab's id also rides on the push channel `/ws?client=`). Paused: `/api/tick` answers `{advanced: false, paused: true}` and nothing after it runs (the director, events, actions, routines: all hang off the tick); `tick()` itself refuses too. A tab that goes away lets go (its channel closes; a holder without a channel is dropped after 60 s). No catching up: the clock goes on from where it stood. `playNow()` (real time less the pause) runs the talks' real-second freshness (a conversation does not go stale in a pause). | `save/gate.ts`, `save/routes.ts`, `day.ts`, `hooks/dialogue.ts`, `town/talk.ts`, `index.ts` |
| Saving | `POST /api/save {slot, label?, client, quiet?}`. The gate shuts ("saving"), the calls in flight finish and are applied, the browser's part goes in `client_state`, the clock is set to the minute on screen (within the tick the browser ran on), then better-sqlite3's online backup copies the whole database to a temp file, a `save_meta` table is added to it, and it is renamed over the slot. Requests that change the game wait for the gate meanwhile (the tick included). | `save/saves.ts` |
| Slots | Five of your own (`slot1`..`slot5`, a name each, "Slot N" by default) and two autosaves (`auto1`, `auto2`) that take turns; an autosave of the same game minute writes over the newest instead of losing the older. A save is one file: `data/saves/<database name>/<slot>.sqlite` (Steve's game: `data/saves/game/`; a test stack: `data/saves/test-<name>/`, deleted by `teststack.mjs stop`). | `save/saves.ts`, `tools/teststack.mjs` |
| Loading | `POST /api/load {slot}`: the gate shuts ("loading"), the calls in flight finish, the save is copied to a temp file and opened there with `openDb` (an older save is brought up to this build there, not in the live file), then every table of the live database is emptied and filled from it in one transaction (the same connection every route holds; the triggers are lifted out and put back), the model generation is bumped (a late answer from before drops its write), and the server's own memory is dropped: the town, transport, stealables and ballad names caches, the talks, the client's positions, recent convos, thieves, the gang roll, the row clock, the tick limit; then the board's state, a board if the day has none, the epilogue if due. Every tab gets `{type: "loaded"}` and starts again from the save. | `save/saves.ts`, `save/routes.ts`, `index.ts afterLoad` |
| A new week | Goes through the gate too (no call runs into the new week) and keeps the saves; the Restart button says so. | `index.ts /api/new-game`, `game/settings.ts` |
| The browser's pause | `game/pause.ts`, imported first: while paused `performance.now()` stands still (every real-second timer of the game, THREE's frame time: no dt jump at the unpause), `setTimeout` timers wait and run after the unpause with the time they had left, `setInterval` rounds are skipped (the tick, the polls), `AbortSignal.timeout` counts only playing time (a talk reply held by the server does not time out), a fetch made in play hands its reply over after the unpause, the push messages wait and are played in order after it, CSS animations stop, keys go only to the menu. The frame loop does no update while paused (the picture is drawn again twice a second for a resize); the kit's `step`/`run` do nothing either. The sound's AudioContext is suspended. | `client/src/game/pause.ts`, `main.ts`, `net/api.ts` |
| When it pauses | Once the game has been entered: P (a "Paused" card; P, W or a click goes on; Esc to the menu), the Esc menu, and whenever the game does not have the mouse (another window, another tab: the browser lets the mouse go). The first screen of a page is not a pause (the town may run behind it; the clock does not). Saving and loading pause too. | `main.ts` |
| Menu | The paper: a red "Paused" stamp in play; Continue (first screen, the newest save, with its day, time and place), Save (in play), Load, then Settings, Restart, Dev. The save list: name, weekday and time, day, place, money, how long ago; "Save over" and "Load" ask with a second click. "Saving..." / "Loading..." cards; while the server waits for the model: "Waiting for someone in the town to finish speaking." The menu now sits over the corner papers. | `game/saves.ts`, `style.css` |
| Autosaves | Every game hour while playing, quietly: the server saves only in a moment with no model call in flight (it looks for 8 s; else "put off", the tab tries again 30 s later), so play never stops for it ("Game saved" in the corner for 2 s). Also when the tab is hidden (a full save) and when it closes (a beacon). Not before the game was entered, and not on the way out of a load. | `game/saves.ts`, `save/saves.ts quiet` |
| What the browser adds | `client_state` (player 1): `clock` (the minute on screen), `place` (the nearest named place, or the room), `pose` (x, z, height, facing, pitch, in the water, crouching), `row` (the boat he sits in: kind, where, heading), `jobs` (what is in his hands: kind, job, owner, broken, heavy, his pace; the job's goods where they lie; the run's clock and what already happened: late, pocketed, the stranger done, the cargo lowered, for a watch its time, time away, the pile left, a thief, briber or foreman already seen). Checked on the server (shape, numbers in bounds, 64 KB at most); none of it is money, a need or a pay. | `main.ts captureClient`, `jobs.ts snapshot`, `runs.ts`, `rowing.ts`, `save/saves.ts ClientStateSchema` |
| Putting Jef back | A load sets the browser part in sessionStorage and reloads the page; the page puts it back once the city is in: the pose (`FirstPerson.restorePose`), the boat (`Rowing.apply` sits him in it instead of taking him out), the job's run (made from the server's job as on any reload) gets its goods laid where they lay, the carried thing into his hands, the run's clock. The first screen says "Loaded: 13:40, <place>. Click, or press W, to go on." The clock's run-on starts again from the loaded minute when play begins (it jumped 5 minutes before). | `restoreData.ts`, `saves.ts`, `main.ts restoreClient`, `day.ts` |
| Test kit | `t.pause(on)`, `t.paused()`, `t.save(slot, name)`, `t.load(slot)`, `t.saves()`, `t.capture()`; `__scheldemist.real` has the untouched timers for waiting through a pause. | `dev/testkit.ts`, docs/testing.md |

## Design choices

- **The hold is in the call, not in each hook.** Thirty-odd callers apply their answer right after
  `callClaude` returns; holding the return while paused makes every one of them (talk, the director,
  convos, rumours, paper, ballads, ideas, night work) wait without touching them.
- **The browser's pause is a pause clock, not a list of switches.** The client has some 60 real-time
  reads and 45 timers across 20 files; patching `performance.now`, the timers, `AbortSignal.timeout`
  and `fetch` in one module stops all of them, including ones added later. `real` is the way out for
  the pause screen itself.
- **Load in place, then reload the page.** Every route holds the one `db` connection, so the save's
  tables are copied into it (as a new week does with `resetDb`). The browser reloads rather than
  rebuilding the town in place: a save from another week is another town.
- **Autosave quietly.** Steve's rule (wait for the model, block new calls) makes a save stop play for
  up to 20 s; the hourly autosave waits for a quiet moment instead, so it never shows. The save on
  a hidden or closed tab waits in full (nobody is looking).
- **A lost focus pauses.** Losing the mouse to another window or tab pauses everything; the small
  "Click or press W to go on" hint stays (Steve: no menu for a snipping tool).
- **The first screen is not a pause** so a fresh page does not pause the server for a tab that has
  not been played; the clock does not run there anyway.

## Multiplayer notes

- The server stays the authority; the save holds no client-only truth the engine trusts. The browser's
  part is keyed by player (`client_state.player_id`, 1 today); money, needs, jobs, trust are the
  server's rows. With more players each row of `player`, `client_state`, pockets (`item`), jobs in
  hand and relationships needs a player id (today `player.id` is fixed at 1 by a CHECK).
- Two ways to save a shared world: one world save (all players' rows in one file, as now) written by
  the host; or a world save plus per-player files (position, pockets, jobs, relationships) so a
  player can take a character to another world. The first is what this code does; the second needs
  the player tables split out and `restoreInto` to copy only the world tables.
- Pause: the gate already counts holders by name. Options: any player pauses all (today's rule;
  fine for co-op on one machine), a vote (all holders must be in), or no world pause at all (a
  player's own menu does not stop the town, as in most online games) with only the host able to
  pause. The save gate (drain the model calls, block new ones) stays as it is in any of these.
- Loading replaces the whole world for everyone (the `loaded` push makes every tab reload). With
  players on other machines this becomes a host action with a warning.
- Autosave by the server on its own clock (not a tab's hour) once there is more than one tab.

## Checks

- `npm test`: 836 of 836 (new: `server/test/save-pause.test.ts`, 15 tests: a call in flight when
  saving, the save waits and its answer is in the file; a call asked while saving does not start
  until the file is written, then runs; a quiet autosave is put off while a call runs; autosaves take
  turns and one minute is kept once; a tick while paused moves nothing and the clock goes on 5 minutes
  after, no catching up; an answer that comes back during the pause is applied only after it; no new
  call starts during the pause; saving while paused lets a held answer into the save and stays paused;
  two holders; the play clock stands; the routes; the load round trip (clock 13:39 from the screen,
  money, needs, the job's progress, a memory, the browser part, the town cache); a load waits for a call
  in flight and its words do not land; the client state is checked; a missing slot changes nothing).
- `npm run build` passes. `__scheldemist.paths()` lists nothing.
- Browser, test stack `save` (8982 / 5382), a copy of Steve's save, sound silent:
  - **Save mid-job, load**: a carry job of 2 crates; one set down at the crane foot (1 / 2), the second
    lifted and carried into a street by the velocipede workshop (-140, 96), 13:40. The director was
    asked to think just before: the save waited for it (`[save] slot1 Monday 13:40 in 14471 ms`; the
    call took 15.2 s). Then the crate set down in the street, Jef to the Grote Markt, the clock on to
    14:30, the weather to fog. Load (78-84 ms on the server): Jef at -140, 96 facing the same way, the
    crate in his hands (pace 0.62), "1 / 2 delivered", 13:40 on the corner clock, clear sky, the
    dropped crate gone. Pictures `m7save_street` (before) and `m7save_after_load` (after): the same
    view, the crate in hand.
  - **Pause while a reply is on its way**: typed "How is the herring selling today, with the cold?" to
    Maria Bogaerts (fishwife), paused 0.7 s later. For 23.5 s: the server `paused: true, in_flight: 1`,
    the server clock 13:10 both times, the corner clock, Jef and the 8 nearest people at the same
    places to the centimetre, `t.run(10)` moved nothing, the sound suspended, the talk showing only
    "Maria Bogaerts ...". The model's call finished in 6.9 s in the background (`ai_call` ok); the
    reply ("Slow. The boats came in full and the auction went cheap ...") showed 216 ms after the
    unpause, with its three choices.
  - **Saving screen**: a save while the director was thinking showed "Saving... Waiting for someone in
    the town to finish speaking." (gate `mode: saving, in_flight: 1`), then "Saved", 4.4 s.
  - **In a boat**: hired Victor's boat at the Rijnkaai steps, rowed out, saved, rowed on, loaded: in
    the boat at -17.98, -8.66, heading -2.48, the server's hire kept (`m7save_boat_loaded`).
  - **Swimming**: over the side, saved, loaded: in the water at the same spot, still swimming.
  - **Continue**: the first screen showed "Continue: Monday 13:06, day 1, Vismarkt"; it loaded, the
    page came back with "Loaded: 13:06, Vismarkt. Click, or press W, to go on.", Jef on the spot.
  - Looked at: the "Paused" card, the menu with its stamp, the save list, the saving card, the first
    screen (the menu now over the corner papers).

## What is left

- Not put back after a load (the server keeps them, as on any reload): riding the omnibus (he stands
  where the bus was, the ride ends), a velocipede (it stands where he left it), holding a handcart
  (it stands with its load: E to take the shafts), up a crane (on the ground below), sitting in a
  tavern (standing). Open windows (talk, board, pockets) close.
- The townspeople stand where their day puts them at that minute, not where they were; figures of a
  job twist (a thief running off) are not saved: what they did is.
- The fetch hold covers `fetch`; nothing uses `XMLHttpRequest`. A second tab on the same server pauses
  the server for both (one holder each).
- One 409 answer showed in the console during the checks; it did not come from the save or pause routes
  (none in the server log) and was not traced.
- The autosave's "Game saved" note and the hidden-tab save were seen in the server log only
  (`[save] auto1 ...`), not in a picture.
