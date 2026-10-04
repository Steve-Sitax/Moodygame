# Godot events and actors

Worktree `MoodyGame-godot-events`, branch `godot/events`, from `4d3b257`. This is an implementation
handoff, not a claim that M4 and every M6 follow-up now have complete browser parity.

## What is connected

Events, Actors, Hearses, TownLife and FamilyScenes are discovered by GamePart; Main and Wiring need no edits.
Node still plans, reserves, clamps and settles actions and events. The client never plans an event or
awards money, harm, trust or a job outcome.

- Actions polls and actions/events pushes refresh authoritative stages and reservations. Client time only
  interpolates remaining minutes; it does not decide that the next stage has begun.
- Props use Goods/ModelLibrary for crates, sacks and barrels, and existing plain materials for flowers,
  cloth, lead dress and instruments. Props stay through a stage with `props: none`, as in the browser,
  then are freed at event end. Closed stall IDs go through MarketStalls.
- Soundscape EventSound/EventCues handles start nearby, move with the stage and stop at departure/end.
  Map marks use TownMap.AddMarks. A gathered event near Jef announces itself through Hud.Outcome.
- Actors hold existing Townspeople simulations, use Crowd for walking and Human for bodies, then release
  them to their schedules. Follow, go, wait, look, talk, fetch-police and seek execute engine-accepted actions;
  arrived, blocked, lost and found reports return to the engine. Other players' positions are respected,
  and their reports are not submitted from Jef's client.
- Attendance follows typed targets, groups and columns. Bride/groom and paired bearers use PuppetFollow.
  Distant unseen attendees can use the movers' resident omnibus hooks; fifteen seconds without a suitable
  bus returns them to walking.
- Scuffle actors meet, speak, shove and separate for the agent. Robbery has its purse lift, victim shout,
  flight and pursuit. Their dialogue and outcomes come from the event scene payload.
- Lead dress and organ, fiddle and accordion animate on existing bodies. Hand grips use cached bone indices.
  Wedding/requiem hall figures use the hall roster and the same dress. A carried coffin and cathedral bier
  are shown; a horse-drawn hearse loads it and follows the engine's departure road.
- Fires.I.Create uses the browser's window/roof coordinates and staged flames, smoke and steam. There is an
  alarm, bucket line, horse-drawn approaching pump, working brake and hose. Jef can join/leave the chain
  and stand at a hiring gate through engine routes. Foremen's calls use Bubbles.
- Tempest feeds Daylight.SetStorm, Townspeople.SetStorm and Soundscape.TempestNow.
- FamilyPeople.ActionReceived drives menace choices, the dimmed supper/outcome veil and dream notices.
  Menace retains the engine's run/talk/pay/stand choices and typing timeout.
- World replacement releases actors, stops sounds and clears props, hearses and fire/hiring interactions.

## Hooks and shared edits

The task's designated shared-file list has **one edit: Net/Api.cs**. It adds typed Events, DevEvent and
DevAction calls and FamilyMenace. No Main, BakedWorld, Solid, Jef, Wiring, Psx or shader edits.

Other integration edits:

| File | Change |
| --- | --- |
| Town/Townspeople.cs and Townspeople.Actions.cs | Held simulations bypass schedules; claim, unseen movement, inside/outside and release hooks reuse the existing body budget. |
| People/MarketStalls.cs | Event closure IDs and an unchanged-set fast path to avoid needless stall rebuilding. |
| People/HallPeople.cs and HallPeople.Events.cs | Position lookup, wedding/requiem dress and cathedral bier; ordinary hall plans remain authoritative. |
| Movers/OmnibusPeople.cs | Remove one resident passenger when its action is cancelled. |
| Net/Payloads.cs and EventData.cs | Typed scene, groups, fire, hiring and tempest payloads. |

## Checking it

Install into this checkout (`npm --prefix server install`), then `dotnet build godot`.
The runner imports new files, respects PERF-LOCK before each Godot launch, opens a real window,
uses ports 8920/8929 and fresh database/settings/user folders, applies a timeout and deletes its database:

```powershell
node tools/godot/events-check.mjs --out godot/baked/events-proof/release --timeout 660
```

It reads the shared bake and never rebakes. `--only musicians,house_fire` selects a subset;
`--no-import` skips an already completed import. The game argument is `-- --eventtest <absolute-dir>`.

The check starts sixteen templates through `/api/dev/director`, advances each authoritative stage with dev
routes, takes stage/lead pictures, checks reservations, attendance, prop/sound cleanup, released or legitimately
reassigned people, and Soundscape's actual composed-cue test log. It writes eventtest.json and quits. Patrol
and hiring attendance uses assigned targets, not just the event centre. The Master bus is silenced while
Soundscape still synthesizes and plays its cues.

Relevant server tests: 124 passed across M4, M4b, town life, funeral, emigrants and ballads; another 70 passed
across families/surprises and event/action checks. Browser/server builds pass. Dotnet has only the existing
nullable Grime.cs warning.

## Round-one performance and limits (superseded below)

The test measures Events + Actors + TownLife + Hearses for 239 steady frames of robbery at Grote Markt.
The preceding full run measured mean 0.00996 ms, p95 0.012 ms, maximum 0.016 ms, mean/p95 0 B per frame.
The final `release` run passed all sixteen kinds and fifty stages: mean 0.00985 ms, p95/max 0.013 ms,
mean/p95 0 B over 239 frames. Thirteen cue-bearing kinds fired a composed cue. All 68 pictures were
inspected in six contact sheets. This is **event-system CPU work**, not the whole frame.
It excludes shared Crowd/Human animation, renderer work and two-second network poll/sync setup. Poll replies,
stage changes, first-use models/materials and one-shot speech allocate. No new shader kinds or dynamic lights;
fire uses the existing fire/light hooks.

The existing capacity is fifty street bodies. Events hold and simulate more people, but a hundred-person
event does not draw a hundred bodies. Hidden travel is accelerated and emergence checked on the crowd grid;
it lacks the browser's full hidden route/step-out recovery.

## Round-one gaps (round-two results below)

- Lamplighter rounds, fog-window overrides and persistent three-day soot fronts from townlife.ts.
- Full walking ceremony entrances/exits and seating choreography. The hall roster currently takes over
  after the street action reaches its doorway. Funeral walkers do not retain the final browser exit walk.
- Exact hand-to-hand bucket choreography, bent hose, pump collision, driver/reins and every lead detail
  (including the showman's monkey and auction board). Current small props are procedural approximations.
- Prison rooms/arrest movement where scenes need them; they are not supplied by this part.
- Family dreams on the night sheet, rather than the current notice.
- Browser-equivalent four-attempt unwedge recovery. Attendance retries; ordinary actions report a blocked
  path after their progress timeout.
- Explicit Godot checks of every player-requested action and family menace choice, actual event omnibus
  attendance, AI-invented stages and two-client NPC ownership/world synchronization. The base net handoff
  leaves shared world/people ownership for its later round too.

Keep the engine's routes and existing people, sound, paper, daylight and fire hooks while completing these.

## Local evidence

Ignored proof folders are under `godot/baked/events-proof/` in this worktree, not in the shared bake:

- `release/eventtest.json`: sixteen completed kinds, fifty stages, no failures; `release/review-0.jpg` through
  `review-5.jpg` show every one of its 68 stage/lead PNGs. Dark midday streets match the already recorded
  shared lighting problem [issue 42](https://github.com/Steve-Sitax/Moodygame/issues/42).
- `family/eventtest.json`, `family/family-menace.png`, `family/family-harm.png`: synthetic presentation
  fixtures check opening choices, harm dimming and a harmless payment notice. They do not submit invented
  actions or claim to test engine harm/payment outcomes. Both pictures were inspected. Typing now pauses
  the decision timer, timeout closes the field, and friendly outcomes do not show the harm veil. Layout
  follows viewport size; world replacement clears the panel and veil.
- `vehicles/eventtest.json`: focused funeral/fire repeat passed all eight stages with no errors. Its twelve
  pictures were inspected, including `vehicles/funeral-hearse.png` and `vehicles/house_fire-pump.png`.
  The self-test now takes these focused prop pictures, in addition to its stage views. New stage rows use
  `soundKind` and `propsKind`, so their names do not differ from the boolean/count fields only by case.

All owned runs quit; the runner removed every test database, WAL and SHM. No Node or Godot process belonging
to this worktree remained. No push, merge, shared bake write or live-game save access.

No full-browser perfcheck launch was made: its default ports are outside this worker's assigned range.
The Godot event-system measurement above is the budget proof for this part; it is not passed off as a
whole-game rendering measurement or a browser pixel comparison.


## Round two

Merged `godot-port` first (0d2ea27), then worked only in the events worktree.
The six requested actions now have individual real-engine acceptance/behavior proofs:
follow, wait, go to a place, look for someone, talk to someone and fetch the police.
The fixture places real residents near accepted targets; it does not prove a long journey
across the entire map. Person proposals use the resident's name, not its internal ID.

The lamplighters consume the engine's nine rounds and 141 lamps, walk the supplied paths,
stop to work, and call the existing `Lights.I.SetLampLit` hook. Their fog windows and the
player job's `LampsHelp` payload are respected. The player lamplighter job belongs to play5.
Soot survives the event through the engine's soot list and fades for three days (day-two
opacity 0.33333334). Its texture is procedural, not a pixel copy of the browser's canvas.
Buckets now run between arrived hands in opposite directions, rather than cycling around
unoccupied slots. The pump has the browser's carriage dimensions, four spoked wheels,
paired rocking brakes, delivery branch, reel, pole, lantern and 16-segment curved hose;
it reuses load-time materials and introduces no light.

Ground-floor cathedral event figures walk from the real doorway to the room's places and
walk out before handing back to their street action. Room solids remain authoritative;
a cached free-grid route backs up the sparse room graph. First rosters, explicit appear,
unseen event entries and upstairs figures follow the browser's placement rules. The
browser's distant-nave hurry, near-door funeral exits and front-row seats are ported.
`HallPeople.ApplyHall` permits deterministic roster refreshes for tests and other owners.

Family dream pushes use `DaySheets.NightOpened` and `PutDream`; waiting dreams expire
after 120 seconds, replace the current dream once and may repeat on a later night.
Object snapshots do not put an old dream on a later night's paper.

A crowd can request 100 bodies from the existing people's drawing. Release restores the
ordinary 50-body capacity. Blocked attend/go actions try a small free unwedge and four
other approaches, then stand; a stage change or unseen recovery lets attendance resume.
The real omnibus passenger code is exercised with one boarding, seating and alighting;
the test supplies its timetable position to keep the run short.

Ownership hooks gate action movement, outcome reports, position sync, ceremony walking,
lamplighter walking and bucket-slot movement. Unknown ownership during multiplayer stops
local NPC movement until an owner list or the people's `OwnsNpc` callback supplies it.
The engine's owner rows are read through Together.OtherText. `Actors.RoomMovement` lets
the police/room owner consume an accepted action in its real room grid.

Remaining gaps: real prison room movement awaits that adapter; NPC claims, replicated
NPC pose batches and two-client proof await the net/people adapter described in
`docs/godot-net.md`. These hooks are not a completed multiplayer port. AI scenes and
real family menace outcomes remain untested. Some lead props remain approximations
(for example the showman's monkey and auction board). Exact browser pixel equality,
long-distance omnibus routing and an uncontended full rendering budget are not claimed.

Focused checks now also accept `--only actions`, `crowd100`, `omnibus`, `lamps`, `dreams`,
`ceremonies`, `wedding_inside`, `funeral_inside` and `sermon`. All use the runner's own
8920/8929 ports, fresh database and timeout, and respect the shared PERF-LOCK.

Shared integration files touched in this round: `Game/DaySheets.cs`, `Game/Actors.cs`,
`Game/Events.cs`, `Game/FamilyScenes.cs`, `Game/TownLife.cs`, `Game/LeadLooks.cs`,
`People/HallPeople.cs`, `People/HallPeople.Events.cs`, `Net/EventData.cs`, and the
`Dev/EventTest` partials. New ownership, fire, lamp and pump partials stay in Game.
No play3/play4/play5 or people's street/path files were edited in this round.


Round-two proof so far: `actions-final/eventtest.json` passed all six requests and
four-attempt recovery; its seven PNGs were inspected in `actions-final/review.jpg`.
`round2-verified/eventtest.json` passed fire's four stages, 37/38 arrived chain hands
and 16/17 buckets, four pump wheels, two brakes, a 128-triangle hose, soot persistence,
one real omnibus boarding and alighting, nine lamplighter rounds/141 lamps with one
observed stop, the fog windows, and all dream fixtures. Its eleven PNGs were inspected
in `round2-verified/review.jpg`. The seated bus picture needed a camera correction;
the passenger's seating is proved by its real passenger state, not that picture.

For 100 visible bodies, that run sampled 360 engine frames and 359 event-work frames:
Events + Actors + TownLife + Hearses mean 0.04346 ms, p95 0.054 ms, maximum 0.082 ms,
mean/p95 0 B per frame. The engine's process monitor read mean 8.0445 ms, p95 8.21 ms;
observed process-frame intervals were mean 5.6342 ms, p95 6.897 ms. The monitor and
frame intervals are different measures, not an isolated GPU benchmark. People logic's
last sample was 0.643 ms. Other workers were running on the shared PC. Unchanged soot
opacity is now set once rather than issuing a shader parameter call every frame.

`shaders-final/summary.json` passed: zero new shader kinds and zero problems. C# and
`npm run build` pass; only the existing Grime nullable warning and web build notices
remain. All commits use path staging and passed the repository's pre-commit hook.


Final strict indoor checks passed independently: `wedding-verified/eventtest.json`
records 28 walking/28 arrived/27 exited; `requiem-verified/eventtest.json` records
32 walking/32 arrived/31 exited. All ceremony entrants finished, and no departing
ceremony figure remained after the exit window. The different exit count includes
roles retained by the authoritative roster (the priest), not a stuck guest.
`sermon-verified/eventtest.json` records 30 worshippers, all 30 arriving and exiting; it checks that every worshipper arrives and
that none remains in its exit walk. Six wedding/requiem pictures were inspected in
`ceremonies-verified-review.jpg`; the sermon picture was inspected separately.
The earlier short-window failures are retained locally as diagnostic evidence;
front-row worshippers need more than 48 seconds to traverse the nave at browser pace.
The focused runner bounds are 200 seconds for wedding/requiem and 220 for sermon.
For all three in one run, use a longer explicit timeout (500 seconds).


The corrected `omnibus-verified` repeat passed one boarding/seating/alighting; both
its bus and attendee pictures were inspected. All owned runs quit and their fresh
SQLite databases, WAL and SHM files were removed. The shader runner's scratch town
was removed as well. No push or merge back was made, and the shared bake was read only.

## Moving-gap NPC wire adapter (2026-10-04)

Actors.Replication adds action NPC/partner claim and release requests and reads numeric ownership replies before stepping. Browser-compatible 24-byte puppet packets feed remote action bodies through RemoteTrack, including motion, scale, carry and lantern flags. `moving-events` passes seven codec/interpolation assertions and `puppet-wire` passes five byte-for-byte browser comparisons. True two-client claims, handoff, event scenes and prisoner room movement remain open; these checks must not be described as a completed multiplayer event port.


Final adapter regression: `moving-events-final` passes the seven wire assertions and six real requested action scenarios (follow, wait, go_to, look_for, talk_to, fetch_police). All six action pictures inspected. This remains single-client evidence; no claim of live remote event completion.
