# Life gap handoff

Work in progress on `godot/gaps-life`. Source of behavior: the browser's walkup/runs/lively/animals,
park ecology, home entry and sound producers. No gameplay numbers move out of the Node server.

Implemented: street/game props and window residents, home entry remarks, wildlife capture/ecology,
real walk-ups and haul/watch actors, sound producers, room/puddle sound and storm gust/shelter.
Verified behavior and explicit remaining proof are listed below. Individual thief/foreman branches,
complete trade customer/door choreography and individual landmark work still need wider proof.
The whole-game frame gate and full sound gate currently fail as recorded below.

Wildlife increment verified on the shared next bake, fresh seed 1873, no AI, port 8911, Dummy audio driver:
74 animals (43 ducks, 9 swans, 6 geese, 10 squirrels, 6 songbirds); six capture/guard/cooldown/visibility
checks passed. The pressed duck moved away 1.703 m before flying. Both close daytime pictures were inspected:
`godot/baked/life-checks/wildlife/peopletest/animals_ducks_move_off.png` and `animals_duck_flight.png`.
The run quit normally and its temporary database was removed. The shader and final combined runs remain pending.

Walk-up increment: the focused job check passed in 91.2 seconds. The server chose resident `bk072`,
Dries Van Camp; he first drew at (-159.645, 63.632), walked into reach at the Vismarkt and was released
back to his schedule. `godot/baked/life-checks/walkup/jobtest/walkup-resident.png` was inspected.
The caller, destination, real resident and released action owner are checked. The default full job
check retains its frame checks; `--job-features-only` permits a focused behavior check. No speaker
output or WASAPI error occurred with the engine's Dummy driver. Historical WASAPI cause remains uncertain.

Automatic home remarks: focused home job check passed. The alley room cost the server's 46 c;
Irma Meeus (`bk146`) appeared with the engine fallback remark. Money, food and warmth stayed unchanged
by the remark. Leaving dismissed the visitor; re-entry made no second request that day. The close
`godot/baked/life-checks/home/jobtest/home-neighbour.png` was inspected. Furniture and floor ownership
remain with the places helper.

Audio shutdown: a 1.9-second window check reproduced a native `AudioStreamWav` constructor crash after
the success report, while the background startup beds were still being built. Audio workers are now
owned until exit, and no new worker starts after exit begins. The same quick window check then exited
cleanly. This is an evidenced project lifecycle bug; it does not establish the cause of the old WASAPI
output-device invalidation documented in `godot-jobs.md`. Dummy runs cannot reproduce a Windows device
invalidation, and `--no-soundscape` alone does not disable the engine's output driver.

Actor-driven twists: the real briber check passed in 91.1 seconds. Hubert Goossens (`r068`)
walked up, offered 50 c through F, and carried away the original `job:11:2` crate.
The server settled 40 c pay, 50 c extra, trust -1 and final money 140 c.
The close watch-briber picture was inspected. Stranger, thief and foreman behavior is implemented;
those branches still need individual end-to-end checks.

Full job check: 405.8 seconds, 22 steps; all 21 gameplay steps passed. The stranger was `wu08`
and the original one-crate sale settled 0 c pay +35 c extra, trust 0. The briber was `r144`;
the server correctly penalised the fixture leaving its post (0 c pay +50 c extra, trust -2).
The real weather-trouble speaker reached Jef, its choice and chandlery errand were accepted.
The separate frame step failed at mean 9.48 ms / p95 12.76 ms against 5 ms. No optimisation pass
is done in this features-first branch. A stricter focused briber arrival check is pending.

Full sound check: 158 rows, every wiring predicate true, 49 recordings loaded, no decoder failures.
Mean 0.0249 ms, p95 0.0373 ms, 28,619 sampled frames. Two failures remain: the unplaced bell
was 5.3 dB above prediction and one mixer frame took 2.081 ms (0.3 ms gate). This full sound gate
is not claimed as passing. The pure source parity checks passed again: 1,200 puddles (0 error),
600 gusts (max error 6.217e-15). TypeScript/client production build and server typecheck pass.

Restart check: the focused 48-row sound hook suite kept all producer wiring true and loaded the same
49 recordings, but a dray-wheel start took 0.365 ms against the 0.3 ms frame gate. The test
reported that one frame as its only problem. This remains an open timing gate, not a wiring failure.

After merging `godot-port` (look and moving parts), `MovingSounds` owns the live vehicle/ship lists
and the moving branch's railway crew owns the railway cues. `LifeSound` retains room floors,
puddles, animal/trade and great-storm producers. Live mover and railway producers pause only
during the isolated sound recording; otherwise they double count the test's scripted sounds.
The repeated full sound test then checked 159 rows: all level and wiring rows passed, 49 recordings
loaded with no decoder failures, mean 0.0269 ms/p95 0.0407 ms across 28,699 frames. One mixer
frame took 2.052 ms against the 0.3 ms gate. The full sound gate remains open on timing alone.

The combined full job check passed 21 gameplay steps out of 22, including real stranger and briber
actors and trouble delivery. Its Vismarkt frame step failed at 8.86 ms against 5 ms. The focused
tempest event passed four stages and started 14 placed gale sounds. The full event check reached
burglary after finishing the first 13 event kinds, then hit its 600-second bound; a separate
burglary/smuggling/night-watch tail passed 12 stages with no failures.

The ride test runner now starts Godot with Dummy audio even when the soundscape is disabled. A
focused cart run started without WASAPI errors and passed server/cart purchase and grip checks,
then failed its flat-street W movement assertion; [issue #57](https://github.com/Steve-Sitax/Moodygame/issues/57)
tracks that separate ride problem. The temporary database was removed. This check shows the
runner no longer touches WASAPI; it does not diagnose the old physical-device invalidation.

The final combined people repeat matched all 5,370 whereabouts answers, showed six child games
and 74 park animals, and found zero blocked walkers, stuck walkers or body overlaps at Vismarkt
and Grote Markt. The full people gate still failed the measured 1.5 ms life cost at Grote Markt
(1.626 ms on that run; the previous repeat measured 0.614 ms there). This features-first branch
does not claim the variable frame-cost gate as passing.
The combined shader check passed with zero new kinds and zero problems.
