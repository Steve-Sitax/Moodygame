# M7 - The prison made real, 2026-09-26

Steve: "Prison does not seem to have a real internal but instanced? Never do instanced, always go real, make it a hard
rule or put in a skel when creating a building with internals." The rule is in CLAUDE.md; the skeleton is
`docs/building-with-interior.md` with `tools/templates/interior/`.

## What made it read as instanced (walked day and night on a test stack, before)
- Every window of the shell was a painted pane (the atlas's barred glass): 182 windows, 6 bartizan slits, 4 roof
  lights, 2 oculi and the chapel's rose. From the street they were flat dark glass; nothing moved behind them, nothing
  lit them at night.
- Only 2 of 198 openings were real: the gate and wing A's yard door. The room was drawn only through them.
- Most of the building had no inside: wing B (a shut grille), the galleries and the upper cells (not walked), the
  front building's upper floor, the gate tower's rooms, the link's upper storey, the chapel, the governor's house.
- Where rooms stood, they did not fit the shell: the link's doors "to the offices" led nowhere; the wing's end had
  one tall window where the shell has two small ones and an oculus; the corridor was vaulted where the shell has
  its roof lights; the guard room's windows lay 10 cm off the shell's; the pavilion's clock hung behind a gallery.
- Shell faces stood inside the building: the corner towers' inner faces in the guard and visitors' rooms, the wings'
  walls and roofs inside the pavilion, the link's walls and roof inside the pavilion, the tower's back inside the link.
- From inside, the street showed only through the gate.

The interior check (below) against HEAD's shell, with today's openings marked on it: 198 openings, 532 problems
(181 not drawn through, 173 closed by a pane, 163 with no room wall behind the reveal, 15 with no room at all).

## What is built now
**The shell** (`tools/blender/build_prison.py`, `prison.glb` 44k triangles, 1.16 MB): every window cut through, its
sill kept, iron bars (or sash bars, or lead cames) at the reveal's back, no pane. The corner towers' windows, the
dormers, the bartizans' slits, both oculi, the rose and the roof lights are real holes too (the wings' roofs are built
round their lights; the gables round their round windows). The governor's two doors and the chapel's two doors are real
doorways. Wing B has a yard door like wing A's, to the west court. The faces that stood inside rooms are gone. Each
opening is an empty `opening_<id>` in the glb and a row in the generated `shared/prisonShell.ts` (198: 182 windows,
6 slits, 4 roof lights, 6 doors).

**The plan** (`shared/prisonPlan.ts`): five storeys (ground, first and second gallery, the offices, the records room),
eight stairs, three doors, the walk area following the pavilion's octagon, 118 zones (every room and every cell) with
what each sees, the chapel's and the governor's plans, the west court, and the lights by the routine
(`prisonLights`: the cells' gas from dusk to eight, the corridors and the pavilion low all night, the guard room always,
the offices till seven, the governor's evening till half past ten, the chapel on Sunday evenings).

**The rooms** (`client/src/world/prisonRooms.ts`), every face of the shell lined from the reveal's back to the room
(`world/realOpenings.ts lining()`):

| Part | What |
|---|---|
| Gate passage | as before; its end is a doorway through the tower's back wall to the link, the inner grille in it |
| Guard room, visitors' room | fitted to the shell (their windows and the corner towers'), the prisoners' side's door from the passage |
| Offices (upper floor) | the director's room, the clerk's room (west), the registry, the doctor's room (east); desks, presses, ledgers, a couch |
| Records room | in the gate tower over the passage: shelves of registers, the table, the ladder to the clock room; its triple window |
| Clock room | the tower's top, locked: the clock's movement behind the dial, its three windows; the two bartizans off it |
| Link | its two storeys: the corridor, the iron stair to the landing, the steps up into the records room |
| Watch pavilion | its eight walls with all eleven windows, two galleries 1.4 m wide, the chief's desk, the clock above the second gallery |
| Wings A and B | the corridor open to the roof lights, 94 cells on three storeys (every one built: bed, table, stool, shelf, bucket, tap, rules, gas jet; a third of the beds folded by day; oakum where a man is held), galleries 1 m wide, bridges, a scissor stair in each wing, two open cells in each wing and every fourth door's food hatch open, the yard passages |
| Chapel | the prisoners' stalls, the pulpit, the harmonium, the rail and the altar in the apse; leaded glass that glows from inside |
| Governor's house | three storeys (office, parlour, hall with its stair, bedrooms, the children's and the maid's), the garret behind each dormer; shut |

**In the world** (`client/src/world/prisonHall.ts`): three rooms (`createHallInWorld` with every window an opening,
`windowOpenings`); from inside, a window brings the street in only if the eye's zone sees it and it is within 14 m
(`insideReach`). The courts are walk areas of their own: the exercise yard (wing A's door) and the west court (wing B's
door, the chapel's side door). The chapel's gable door stays shut (its leaves in the street's scene). The life: as
before, placed in the real rooms; new: a warder on wing B's corridor and one on its first gallery, the clerk in the
registry and the director in his room by day, the governor at his desk in the evening, a man in wing B's open cell.

**Shared, kept general** (every other building unchanged unless it asks):
- `inworld.ts`: an opening may say whether it can be seen from an eye inside (`seen`), a room may cap the street
  through far windows from inside (`insideReach`);
- `hallInWorld.ts`: `createHallInWorld(..., windows)`: a hall's windows as openings;
- `hallPlan.ts insideness`: a door more than 6 m behind the point on its street side no longer counts (a building
  with doors on several sides; no porch reaches 6 m out).

## The interior check
`await __scheldemist.interiorcheck(id?)` (`client/src/dev/interiorcheck.ts`), for every room of `world/inworld.ts`:
each shell opening (its marker) is an opening of the room; rays from outside through it reach the room (not a pane of
the shell, not nothing; a ray may leave by a window opposite); the room's lining meets the reveal (no gap); the room
stays inside the shell round the opening; every opening of the room has a hole in the shell; every walkable floor of
the plan is reached from a door (the people's way). Shells without markers: their glass over the room is listed, and a
house's painted windows.

| Building | Before | After |
|---|---|---|
| The prison | 532 problems (see above) | nothing wrong (156 openings; doors open and shut) |
| The chapel | no room | nothing wrong (11 openings) |
| The governor's house | no room | nothing wrong (31 openings; shut: seen, not walked) |

The other buildings (for later; their shells have no markers yet):

| Building | Found |
|---|---|
| Cathedral | 101 places of the shell's glass over the hall (painted panes, not windows of the room) |
| Town hall | 281 places of glass over the hall |
| Vleeshuis | 36 places of glass |
| Steen | 5 places of glass; 6 free places not reached on foot |
| Carolus | 6 free places not reached (a corner at 12.25, 22.75) |
| Oostershuis, St Paul's, St James's | nothing found; their windows are painted in their atlases, which the check cannot see without markers |
| The 17 shops | each has 1 to 4 windows but no markers; 105 to 374 free places behind the counters not reached, even by the keeper |
| Taverns (5), homes widow, alley, merchant | windows but no markers; the merchant's storey 1 not reached |
| Home: garret | a painted window upstairs lit at night; storeys 1 to 5 not reached (no stair in the plan) |
| Home: cellar | nothing |
| The Poesje | 58 of 276 places in its cellar not reached |

## Checks (2026-09-26, test stack `prisonreal` 8999/5399, and a clean copy of HEAD 2b01103 with the patch)
- The interior check: nothing wrong for the prison, the chapel and the governor's house (with the gate open and shut).
- `paths()`: nothing, with the gate open (the prison's 12 points, the courts', the chapel's).
- `shaders()`: no problems; two light settings (the street, the rooms).
- `clocks()`: no problems; the pavilion's clock and the gate's run.
- Blender plane check: 233 pairs in one plane or within 2 cm (219 before; the same hidden ones: merlons on the
  parapets, the pavilion inside the wings), 8 faces flat at y 0 (both yard doors' frames, under the ground).
- Walked in and out (W held, `step`): the gate, both yard doors, the chapel's side door; the cathedral's west door,
  a shop (the bakery on the Rijnkaai) and a tavern (the Ankere) the same on HEAD and with the patch (the Ankere stops
  Jef on its threshold on both: not this work's).
- `npm run build` passes; the server suite 992 of 992 (`prison.test.ts` 13: every part flooded from the gate, the
  galleries up the stairs, the offices and the records room, never over a void; the chapel from its side door, not to
  the altar; a zone behind every shell opening, 94 cells; the routine's lights).

## Frame time
`__scheldemist.perf(20)`, the median of five, HEAD and HEAD with the patch on the same machine a minute apart (other
agents' tabs share the GPU: the milliseconds move by a few; calls and triangles are steady).

| View | HEAD (day) | Patch (day) | HEAD (19:30) | Patch (19:30) |
|---|---|---|---|---|
| Outside the gate, looking at it | 14.2 ms, 700 calls, 1.66 M tris | 16.7 ms, 800 calls, 1.72 M | 16.8 ms, 671, 1.53 M | 14.9 ms, 778, 1.59 M |
| The yard, looking at wing A | 14.1 ms, 917, 1.80 M | 12.5-15.6 ms, 960, 1.84 M | 15.6 ms, 1073, 1.69 M | 18.5 ms, 1112, 1.73 M |
| The pavilion, looking at its back | 2.2-6.9 ms, 25, 39 k (street not drawn) | 9.9-12.5 ms, 418, 1.59 M | 6.3 ms, 26, 39 k | 14.2 ms, 392, 1.49 M |
| Wing A's corridor, looking down it | 9.2-11.5 ms, 280, 1.10 M | 10.6-16.7 ms, 480, 1.51 M | 11.8 ms, 255, 1.07 M | 12.9 ms, 565, 1.48 M |

Outside, the rooms through every window cost about 100 draw calls. Inside, the cost is the street through the windows
(the pavilion's back windows, the roof lights): as the cathedral's door, it costs about what standing outside costs.

## Pictures
`scratchpad/prison-real/`: `contact_before.png`, `contact_after_day.png` (14:30 clear), `contact_after_night.png`
(19:30), and each picture as PNG (`before_*`, `after_day_*`, `after_night_*`); in `data/shots/` as `prx_b_*` (before),
`prx_A_*`, `prx_a_front`, `prx_n_*`, `prx_N_*` (after).

## Open
- The inside views cost the street through the windows; occlusion within the windows' rectangles (the culler can read
  `inWorld.visibility().outdoorsRect`) is the next saving.
- The other buildings' shells have no markers: their windows are painted (landmarks, churches) or cut but unmarked
  (houses). Each needs the skeleton's shell part.
- The chapel's life (a Sunday service with the men in their stalls) and the warders' rounds on the galleries are not
  written; the figures stand at their places.
- The kitchen and the laundry: in the basement in a real cellular prison; no window shows them, so none is built.

## Rebuild
    blender -b --factory-startup -P tools/blender/build_prison.py     (the glb and shared/prisonShell.ts)
    npx vitest run test/prison.test.ts                                (in server/)
