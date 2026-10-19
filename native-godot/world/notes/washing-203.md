# Washing and startup routes (#203)

Street garments and pegs share one weather controller: visible from 08:00 to 18:00 in dry weather.
Lines, rings and poles remain. Boat garments use the same laundry pack as street washing.
Boat cabin curtains share the old washing material and must remain in their windows.
New cloth is excluded from deck, hull and street collision calculations.

`--washing-proof <output> --no-mainmenu --dev` captures street and boat washing in daylight, rain,
night and restored daylight, with the standard isolated database, preferences, layouts and user-data arguments.
It checks visibility, then resets its disposable week and checks prison/park initialization and the first route plan.
It never resets a player save. Use this mode only with fresh test data, as with other native proofs.

Add `--washing-motion` for 120 post-draw frames in each of the four states, checking every existing
MultiMesh cloth transform against its source row times the initial attachment. It also places three disposable
Rhine barges through `Boats.I.Place`, checks immediate creation visibility, shared garment/peg geometry,
movement and restoration, and captures front/back/low views. A separate disposable row tests visible counts
0/1/all, resizing and zero scale without changing production rows. The normal mode retains its 11 assertions.

Pumps and hatches are installed before the native walk map is built. The separate startup-order defect was that
population rebuilding deleted prison/park records after their initialization. Prison's first view could then jail
a resident while a route plan was running. Registering those services after the population lifecycle, and preparing
custody on new weeks and loads, ensures their schedules exist before the backend is exposed. The revision check
and retry remain necessary when the town really changes during play.

The seven shared garment models are already on main. Each boat's six existing cards use shirt, shift,
trousers, apron, towel and sheet; stockings remain available without adding a seventh attachment.
Cloth keeps its local attachment origin for shader sway. MultiMesh copies follow the original row at
process priority -49, after Boats at -50. Only the half-tile washing cards are removed; .38-tile curtains stay.
The existing cloth, rounded peg and rope geometry is reused; no asset buffers are reimported or edited on disk.

Original combined candidate `ffefa404286065ad9de07f834c86eb60de66376a` passed all 11 real-town visibility
and route assertions in `washing-203/candidate-5b/out/washing.json` under the external verification directory.
664 street groups and 36 boat pieces
are present in dry daytime and put away in rain/night. Front/back screenshots preserve the cabin curtains.
Packed-buffer filtering fixtures preserve all eight audited boat bodies; the original raw-surface audit found
165 surfaces with zero changes. The native conversation check passed 170/170 on that combined candidate.

The washing-only split starts from main `02602f0b3ec1bd279aaf5a5ac73e7d5f873bc23f`; its initial 11-file
transplant is `3e527600` (original `fc5a67bc`). No landmark/paving work or asset/chunk changes are included.
The coordinator's split run passed 11/11 in `washing-203/split-washing-01/out/washing.json`.

The motion extension passed 50/50 with zero engine errors and clean shutdown in
`washing-203/motion-final/run-03/out/washing.json` under the external verification directory (seed 1873).
The original 664 street and 36 boat groups remain. All 24 existing MultiMesh cloth children passed 11,520
post-draw comparisons; maximum attachment error was 0.00003054. Sources really moved in every state.
All three new barges moved; maximum attachment error was 0.00006825. The separate count/resize fixture
passed 240 comparisons including 72 zero-scale samples, with zero error. Transform tolerance is 0.00025
(metres for origins, dimensionless for basis components).

The first `Place` observed `Library.Contains("rhine_barge") == false`, invoked the existing `DressWashing`
callback once, and produced six garments. Rain/night placement used the now-loaded library, invoked no
callback and copied correctly hidden garments immediately. All 18 garments returned in restored daylight.
No visibility workaround was needed. Hidden helper models acquired no washing.

Run 01 passed its 49 assertions but failed the runner: `MovingSounds` retained freed proof barges and threw
`ObjectDisposedException`. It now removes invalid hull entries before reading their nodes; run 03 includes
an explicit post-free sound gather. New emitter IDs increase monotonically so pruning cannot reuse a live ID.
Run 02 was stopped during startup after image review found the third
fixture on land at low tide. All final fixtures are in the far river; production placements were untouched.

The actual `check-conversations.ps1` passed 170/170 with clean engine exit in
`motion-final/conversations/conversation.json`. All runs use isolated fresh data and no AI; no performance
run was made. The final assembly also includes the emitter-ID refinement, added after the motion/conversation runs.
Its bounded `--shaders` run passed in `motion-final/shaders-final/out/shaders.json`: 41 programs, the exact
153 first-kind identities from the unchanged main baseline, zero new kinds/problems and zero engine errors,
with clean shutdown. The external wrapper initially rejected reversed expected counts; the same engine report
passed corrected validation without another run. Shader coverage excludes driver compilation timing,
transient resources between samples and unvisited actions, as recorded in the report.

Final images: `motion-final/run-03/out/{street,boat,boat-back}-{day,rain,night,restored}.png` and
`{moving-row,spawn}-{front,back,low}-{day,rain,night,restored}.png` (36 actual game captures).
The garments and pegs meet their lines in daylight and return after rain/night; empty lines, posts, cabin
curtains and rigging remain. Dark new-barge night views show line silhouettes, not a full hull material review.
This is bounded washing acceptance, not a whole-boat/city art pass, sailing-route test or performance result.
Main integration and the coordinator's final checks remain separate; no player acceptance is inferred.
