# Drains under the bare downpipes · 27 October 2026 (#218)

72 of the 1526 downpipe feet had no iron under them (no channel plate, receiver or gully).
`native-godot/scripts/paving/pipe_drains.py` finds the feet as the drainage repair (#163) made them and copies a finished
set to each bare one: on a raised pavement the channel plate, receiver and kerb mouth of the drained pavement foot
whose kerb distance is nearest; at street level the nearest street gully. Each is turned to its own wall (the nearest
house outline's edge), moved to its foot and set on its own ground; its vertex alpha is the pipe's (the house's mark).
Appended to the iron surface of the pipe's block mesh (Solid skips it; plates and gullies are flat, walkable).

56 laid (every one has flat iron at its foot afterwards). Left (`report.json`): 8 whose houses are razed (the church
squares; their pipes go with them), 5 over steps, 3 where no street ground was found along the wall's normal.
