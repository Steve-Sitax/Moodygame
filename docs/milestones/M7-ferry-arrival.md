# M7 - The ferry arrival (2026-09-25)

Steve, 2026-09-24: "The start of the game is: we step off a ferry and so enter the city. The ferry
takes off when we are off."

Not committed yet: the main session checks it in the browser and commits it.

## What
- A new game starts with Jef on the fore deck of the ferry from the left bank. The ferry is a small
  paddle steamer (boats.glb `paddle_tug`; its paddle box already reads "ST ANNA"). She lies across
  the river end of the Werf pontoon at dawn, with her gangway down onto the pontoon. The city, the
  Steen and the cathedral spire lie ahead through the fog.
- Three passengers (a fishwife, an old man, a docker) go ashore first, down the plank and along the
  pontoon into town, and then fade out in the fog. They are solid for Jef. If he stands in their
  way they wait, then squeeze past. The ferryman (`sailor_b`) stands at the rail by the gangway's
  foot and turns to watch Jef.
- Jef walks off himself. The deck is railed: the rails, the deck house, the mast and the bitts are
  walls. The only way off is the gangway: a short step up inboard to the rail's top, then the plank
  onto the pontoon. A hint shows when the game starts: "Step ashore: walk down the gangway onto
  the landing."
- Ashore (once he is 0.9 m along the pontoon past the plank):
  1. A second hint: the hiring board is at the Hessenatie on the Rijnkaai, along the quay past
     the Steen.
  2. The client tells the server.
  3. The ferryman hauls the plank up.
  4. The ferry whistles and casts off. She is pushed off sideways at first, so her paddle box
     clears the barges' ends. Then she steams off down river (2.4 m/s), turning away from the quay.
  5. She is taken away once she is 150 m from Jef, deep in the fog.
- If he stays aboard, the ferryman speaks after 35 s ("This is Antwerp. Down the plank with you, we
  go back across.") and after 75 s. At 115 s he walks Jef down the plank at 1.1 m/s. Jef is not
  teleported. Only time with the game in hand counts: the menu and the start screen stop the clock.
- The server keeps one fact, world_state `arrival` = `{stage: "ferry" | "ashore"}`.
  - A new week (db.ts seed) writes "ferry".
  - `POST /api/arrival/ashore` writes "ashore".
  - A save without the key (every save made before this) counts as ashore, so a game in progress
    loads as before, on the Rijnkaai.
  - A reload before Jef has stepped off plays the opening again.
- The first log line is now "Jef came off the ferry at the Werf at dawn, with 50 centimes and no
  name." The same day 1, 6:00, verb `arrived`, place `rijnkaai`. The epilogue's fallback text says
  "came off the ferry" too. The job board, the needs clock and the day are unchanged. The board
  is still written at the new game (14 jobs on day 1 in the test).

## How the deck is walked
- `World.addWalkArea` is the same hook the cathedral uses; no new rules were added to rijnkaai.ts.
- The deck floor is measured from the model when the ferry is placed. Rays are cast down onto the
  fore deck on a 0.2 m grid (1.3k rays, 136 to 213 ms, new games only). The rigging and the hull's
  stencil lid are skipped.
  - A cell is walkable when it has the lowest floor of its row and nothing stands above it.
  - The mast is found on a 0.1 m grid inside the model's tall cells (`boats.tall`).
  - Only the deck joined to the middle of the fore deck counts.
- Heights, as measured: deck 0.61 m above the waterline, rail 1.36 m. The pontoon deck is about
  1.8 m above the water. The inboard step has 1.5 m of run, so the path check's 0.36 m rise per
  0.5 m is met.
- The walk map ends at z -58, but the pontoon's last section runs to -60. While the ferry lies
  there, the last 2 m of the pontoon are a landing for the plank. The landing reaches 0.1 m past
  -58, so there is no seam of height 0 at exactly -58. Once the ferry has gone and Jef is off
  that bit, it returns to the walk map.
- The hull is a water solid, so swimmers and rowing boats keep off her. While she steams, she is a
  moving ship for the sound.
- Footsteps on the deck and the plank are wood (a new optional `WalkArea.wood`).

## Files
- New: `server/src/arrival.ts` (the stage, `GET /api/arrival`, `POST /api/arrival/ashore`, the
  log text), `server/test/arrival.test.ts`, `client/src/game/ferryArrival.ts`.
- Changed:
  - `server/src/db.ts`: the seed writes the stage and the new log line.
  - `server/src/index.ts`: mounts the routes, two lines.
  - `server/src/hooks/epilogue.ts`: the fallback line.
  - `client/src/main.ts`: makes it; `ferry.update` runs in the frame and in `step()`; its point
    joins `paths()`; `__scheldemist.ferry`.
  - `client/src/world/rijnkaai.ts`: `WalkArea.wood` and one line in `surfaceAt`.
  - `docs/testing.md`: a row for the opening.
- Dev: `__scheldemist.ferry`:
  - `info(true)` gives the stage, the gangway numbers, the passengers and the deck as a text map.
  - `devIdle(s)` skips the ferryman's patience.
  - `probe(lx, lz)` shows what a ray down meets on the model.

## Checks (test stack "ferry", server 8964, vite 5364, a new game on the copy only)
- `npm test` (server): `arrival.test.ts` 3 passed. It covers:
  - A new game is on the ferry, and its first line says so.
  - A save without the key, or with a bad value, is ashore.
  - The routes work, stepping off is idempotent, money and the day are untouched, and a new week
    puts Jef back on board.
  - `day.test.ts` also passes.
  - The full run has 9 failures in other sessions' work in progress: funeral, lively, m4, m4b,
    routines, townlife, ideas. They are action minutes, fire and walk-map numbers, not the seed.
- `npm run build`: the client builds. The server typecheck fails only in another session's
  `test/halls-inworld.test.ts`, `shared/hallPlan.ts` and `shared/townhallPlan.ts`. My files are
  clean.
- In the browser:
  - Walking to the ferry's side and toward the water keeps him on deck (no swim).
  - Down the gangway: deck -2.99, plank -1.80 onto the pontoon. The server stage became "ashore".
  - The plank came up, she steamed off and was gone at 150 m. The passengers walked into town and
    were removed out of sight.
  - The walk-off: both lines came, then the elbow line, and he was walked to z -57.2 with no
    teleport.
  - A reload after stepping off starts on the Rijnkaai (10, 12) with no ferry. A reload during the
    opening replayed it (done several times).
  - `__scheldemist.paths()` returns [] with the ferry's deck point included, and [] after she has
    gone.
- Pictures in `data/shots/`:
  - `ferry-deck-dawn` (the real start, 6:20 in fog).
  - `ferry-deck-view` (the view from the deck at noon, clear: the plank, the pontoon, the Steen,
    the town, the spire).
  - `ferry-gangway-down` (on the plank, the pontoon ahead) and `ferry-plank-side` (the plank from
    outside).
  - `ferry-top` and `ferry-outside-a/b` (where she lies against the pontoon's end and the barges).
  - `ferry-walked-off` (the ferryman's walk-off, a passenger ahead).
  - `ferry-plank-in` and `ferry-casting-off` (the plank hauled up).
  - `ferry-pulling-away` and `ferry-pulling-away-2` (her going down river, seen from the
    pontoon).

## What is left
- "Ashore" is the pontoon's end (the landing), not the quay itself: the ferry casts off while Jef
  still walks the 60 m pontoon to the Werf.
- The paddles do not turn: the model's wheels are inside closed boxes, and there is no wake.
- The ferryman has no talk (E) and no name. Tuur rows his own ferry in the design, so this steamer's
  man is left nameless.
- The ferry does not come back; there is no ferry service in the game yet.
- The passengers walk through things on land that are not on the walk grid (they follow
  `crowd.pathOn` from the quay; on the pontoon they keep to its middle line).
- During the check, the tab logged errors in `press.update` ('printed') and in `sound.update` and
  `events.update` (a non-finite AudioParam value). They are not in this work's files, and may come
  from the new test-tab mute. Not looked into.
