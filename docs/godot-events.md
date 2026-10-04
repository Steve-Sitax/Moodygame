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

## Performance and limits

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

## Still required for complete browser parity

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
