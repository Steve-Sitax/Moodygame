# Washing and startup routes (#203)

Street garments and pegs share one weather controller: visible from 08:00 to 18:00 in dry weather.
Lines, rings and poles remain. Boat garments use the same laundry pack as street washing.
Boat cabin curtains share the old washing material and must remain in their windows.
New cloth is excluded from deck, hull and street collision calculations.

`--washing-proof <output> --no-mainmenu --dev` captures street and boat washing in daylight, rain,
night and restored daylight, with the standard isolated database, preferences, layouts and user-data arguments.
It checks visibility, then resets its disposable week and checks prison/park initialization and the first route plan.
It never resets a player save. Use this mode only with fresh test data, as with other native proofs.

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

This washing-only split starts from main `02602f0b3ec1bd279aaf5a5ac73e7d5f873bc23f`; its nine C# files match
the original candidate exactly. It contains no landmark/paving changes or town resources. Compilation and
static validation are separate from rendered acceptance: Godot was not run for this split because both slots
were reserved. Rerun the washing proof on this revision before claiming its rendered pass.

Remaining acceptance: observe a continuously moving boat and a newly library-spawned barge in dry daylight,
rain and darkness, front/back and from low angles. Garments/pegs must stay attached without a frame of lag,
hide and return with weather/time, and leave curtains, hull, deck collision and rigging intact. Verify no extra
line appears from hidden helper models. The existing washing proof does not certify these two scenarios.
