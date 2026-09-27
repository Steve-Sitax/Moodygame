# Light in the special buildings (2026-09-27)

Steve, 2026-09-27: "The special buildings need some better lighting inside and also light coming through windows.
Those buildings will keep having lights on all night, even when they are closed. Make it moody and cool. Churches
bright but with shadow work, take pictures, send to codex for mood passes and implement and give results to check."

## How it was done
1. Pictures of every hall inside and outside, at 13:00 and 22:00, clear (the test stack, `__scheldemist.halls().shot`,
   `shotFrom` for the cathedral).
2. Six of them went to Codex (`gpt-6-sol`, image paint-overs, locked-down command: read-only, no user config, stdin
   closed; only the game pictures and a mood prompt): the cathedral nave by day and by night, St James's nave by day,
   St James's front by night, the town hall by night, the Vleeshuis's hall by night. They are the target, not assets:
   nothing of them is in the game.
3. The code follows them (below). Pictures after, compared with the before.

## What changed
- **Windows lit all night** (`world/landmarkWindows.ts`). Every face of the shells' glass (`sh_glass`, `vh_glass`,
  `steen_glass`, the stand-ins' `landmark_glass`) and every window cell of the churches' and the cathedral's atlases
  gets a copy 3 cm out, drawn additive in the glass's own picture: the leads and the tracery stay dark, stained panes
  keep their colour, plain ones take amber lamplight. The cathedral's flat painted glass is leaded into small diamond
  panes. A church's windows burn alike; a building of rooms (the town hall) room by room, some dim, a few bright. The
  foot of a window is brighter than its head. From dusk (day 0.5) to dawn, open or shut. Each building fades with its
  own distance through the fog (to twice the fog's far): a soft glow, never a grey pane. The lowest windows (up to
  14 a mesh) throw their light on the street (`world/spill.ts`, kind `hall`). Dev: `__scheldemist.litWindows()`.
- **Round 2** (Steve, the same evening: "too many lights on in Stadhuis or the house at the harbour ... some lights can go
  out and on, but not all on ... more lights until 0:00 or 1:00 for meetings ... all windows adjacent to meeting
  rooms"; "churches have less light at night inside than is coming out ... in towers, not all rooms there will be
  lit"). A building of rooms (the town hall, the Hanseatic House, the Vleeshuis, the Steen) now lights room by room by
  the game clock (`NIGHTS` in `landmarkWindows.ts`): clerks going home between 19:00 and 23:30, one or two meetings a
  night (not on Sunday) lighting a room and its neighbours on the storey until 0:00 or 1:00, the porter's lodge all
  night, a watchman's lamp going on and off by the half hour, the first clerks before 7:00. Towers and attics (over
  the building's `roof`) stay dark but for a lamp going by. A church glows dim (about a quarter of before), brightest
  at a window's foot where the candles stand, its tower windows dark. Measured: the town hall 137 of 579 windows lit
  at 20:00, 40 at 23:30, 18 at 2:00; the Hanseatic House 2 of 26. The mesh's colours change only when a lamp does.
  A window is whole (Steve: "a window is a complete window and not a small part ... always completely off or on"): the
  panes of one face whose outlines meet within 0.3 m are one window, lit or dark together (the town hall: 579 panes,
  210 windows).
- **Sun and moon inside** (`world/hallSun.ts`) in the cathedral, St Paul, St James and St Charles: the sun is traced
  once, when the hall is built, from every texel of the floor (4 a metre) and of the arcades' walls over their arches
  back toward the sun. Where the ray leaves through a window the surface is lit in the glass's colours; a pier or
  column, the wall over an arcade, a gallery's floor or a mullion in its way throws its shadow. The light is a quad
  that lights what is under it by its own colour (`dst * (1 + src)`). Shafts (two crossed sheets, a little dust) only
  from windows whose light lands. The sun stands at an autumn noon's height (30 degrees) on the street sun's bearing.
  Only in clear or thin weather. By night the same paths carry a faint cold moon. Build cost: 30 to 140 ms per church,
  once, at load.
- **Nights inside**: the flat grey fill sinks to blue-black (hemisphere and ambient to a quarter or a third, their
  colour to moon blue), so the lamps' warm pools carry the room; the glass seen from inside holds the moon's blue.
  The lamps burn all night, shut or not: the cathedral's sanctuary lamp and two altar candles, its nave lamps, the Lady
  altar; the churches' altar, nave and crossing lamps stronger after dark; the town hall's, the Steen's and the
  Hanseatic House's lamps. The halls use `nightAir()` in `world/landmarkHalls.ts`.
- **Days inside**: a little less flat fill in the churches, so the sun's patches, the shafts and the shade on the far
  sides of the piers carry the brightness. The cathedral's old coloured floor pools and its shafts went (the traced
  ones replace them).

## Checks (test stack, 2026-09-27)
- `__scheldemist.shaders()`: `problems` empty, 2 light settings (street, rooms), about 1 program more (the window
  light: psx basic with vertex colours).
- `await __scheldemist.spill()` at 22:00 by the town hall, the cathedral and St James: `problems` empty.
- `await __scheldemist.interiorcheck()`: nothing new; the old finds (the landmarks' panes over their rooms are the
  shell's, not real windows) filed as issue #10.
- No light was added or removed; no light count changes at run time.

## Not done
- The prison keeps its own routine (cells dark at night, the chapel on Sunday evening): a prison is not lit all night.
- The sun's patches do not move with the hour; the sun stands where an autumn noon puts it.
- The piers' sunny sides are lit only by the halls' day lamps, not traced.
