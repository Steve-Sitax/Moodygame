# Life gap handoff

Work in progress on `godot/gaps-life`. Source of behavior: the browser's walkup/runs/lively/animals,
park ecology, home entry and sound producers. No gameplay numbers move out of the Node server.

Open: street/game props, window residents, home entry remarks, wildlife capture/ecology,
walk-up trouble and haul/watch actors, producer sound coverage, exact room/puddle sound,
storm gust/shelter, individual landmark work proof, and final people/job/sound checks.

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
