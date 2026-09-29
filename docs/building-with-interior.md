# A building with an inside

Steve's rule (CLAUDE.md, 2026-09-26): interiors are real, never instanced. A building you can enter has its inside
built in the world, inside its own shell, at the true size of the outside. Every window and door shows the inside from
the street and the street from inside. No separate scene you are faded into, no teleport, no rooms drawn only through
the door, no painted or blind windows over rooms that exist.

The prison is the first built this way (milestones/M7-prison-real.md). Copy its parts. The skeleton files are in
`tools/templates/interior/`.

## The parts

1. **The shell** (`tools/blender/build_<name>.py` -> `client/public/models/<name>.glb`).
   - Every window and door is cut through: a hole with its reveal, its sill, and its bars, sash bars or lead cames.
     No painted pane. The glass is the room's.
   - Every opening is written twice, from the same numbers:
     - an empty `opening_<id>` in the glb, with `kind`, `label`, `glaze`, `shape`, `hw`, `yb`, `yt`, `nx`, `nz`, `tx`,
       `tz`, `depth`, `arch` (and `r` for a round one) in its custom properties;
     - a row in a generated `shared/<name>Shell.ts` (the type is `shared/shellOpening.ts`).
     `build_prison.py` has the functions to copy: `Hole(glaze=..., label=...)`, `glazing`, `opening_record`,
     `round_opening`, `holed_triangle`, `opening_markers`.
   - Labels are human words: "wing A, south face, storey 2, cell 3".
   - No face of the shell inside a room: cut a wall that another part covers, stop a roof at the face it meets,
     leave out the inner faces of a tower that stands in a building.
   - Keep the clock markers (`clock_face_<name>`) as they are.
2. **The plan** (`shared/<name>Plan.ts`, pure numbers).
   - The frame (origin, yaw), the floor height, the storeys (`levels`), the stairs (a 45 degree stair has a rise of
     0.18 at most), the doors, the walk `area`, the steps down to the street.
   - Floors at least 1.2 m wide where people pass (doors, bridges, landings): the walk grids are 0.25 and 0.5 m.
   - `zones`: the parts of the building (rooms, cells, galleries) as boxes, each with what it `sees`. A shell opening
     belongs to the zone just behind it (`zoneOf`); an eye inside only draws the street through the windows of its
     own part and the parts it sees.
   - The area covers only the building. Where courts come up to it, follow its outline with fine steps, never a
     square that takes in the court.
   - The lights by the routine: which parts are lit at which hour.
3. **The rooms** (`client/src/world/<name>Rooms.ts`), built in the plan's frame at the shell's true size.
   - Line every face of the shell with `lining()` (`world/realOpenings.ts`): from the reveal's back to the room's inner
     face. It cuts every shell opening on that face, doors from the floor. The reveal runs on without a gap.
   - A room face never lies in the plane of a shell face: 2 cm in at least.
   - The glass: `glassPanes()`, one mesh, `userData.glass = true`.
   - One `Kit` per part, so a part out of view is not drawn.
   - Lamps: at most `ROOM_POINT_LIGHTS` per room (docs/rendering.md). A lit part at night glows with its own
     material's emissive colour and its gas flames, not with more lights.
4. **In the world** (`client/src/world/<name>Hall.ts`).
   - `createHallInWorld(world, inWorld, plan, room, air, points, [], 0.3, windowOpenings(windows, toWorld, seen))`:
     every window an opening (`seen` from the plan's zones), every door with its leaves in code.
   - `insideReach` on the room if it is tall: far windows then show the room's clear colour, not the town.
   - Courts and yards are walk areas of their own. Their `hits` answer only inside their own floor (the world asks
     every area near a point).
   - A door that never opens: its leaves in the street's scene, and an opening with `open: () => false`.
5. **The life**: the people in the rooms by the server's hours, the keys, the room sound, the put-out at closing.

## The checks (all must list nothing wrong)

| Check | In the test tab |
|---|---|
| The interior check | `await __scheldemist.interiorcheck("<id>")`: every shell opening is an opening of the room, a real room stands behind it, the lining meets the reveal, the room stays inside the shell, every floor is reached on foot |
| Paths | `await __scheldemist.paths()`: the building's points (while it is open) |
| Z-fight | `await __scheldemist.zfight()`, and the Blender plane check (`build_<name>.py` prints it) |
| Clocks | `__scheldemist.clocks().problems` |
| Props | `await __scheldemist.propcheck({ near: [x, y, z] })` if you placed things outside |
| Shaders | `__scheldemist.shaders().problems` |
| Walk | in and out through every door (W held, `__scheldemist.step`): inside at the far end, outside again |
| Pictures | from outside through three windows, from inside out, by day (13:00, clear) and by night; look at each |
| Tests | `server/test/<name>.test.ts`: the plan floods from each door to every part; zones behind every shell opening |

Wait until the model has loaded before the interior check: without its markers it says so. Run it near the building
(`__scheldemist.t.go([x, z])`, `t.run(1)`): the check looks only at meshes drawn now, and the town hides far shells.

## A shell built before this rule (issue #10, 2026-09-29)

The landmarks and churches had their rooms built in code first and their shells in Blender with painted or glazed
panes over them. Made real the same way, without rebuilding them from the skeleton:

- **Openings in the world frame.** Their scripts work in the landmark's frame, not the plan's: `real_opening()` writes
  world x, z and directions to `shared/<name>Shell.ts`, and the room takes them with `inFrame(rows, plan.origin,
  plan.yaw)` (`shared/shellOpening.ts`). A shape that is none of rect, round or quad (a pointed gothic window, a basket
  arch) carries its outline in `poly` (u from its middle, world y); `lining()` cuts it exactly, a door's head too.
- **The old panes stay, never drawn.** The panes of the real windows move to a mesh of their own
  (`<name>_lit_glass`, material `<glass>_lit`) whose material the loader makes invisible: `world/landmarkWindows.ts` lights
  a copy of it at night as before (the copy is marked glass for the check). An atlas-painted shell hands that mesh to its
  room as the room's glass (`world/shellGlass.ts`: `publishShellGlass`, `whenShellGlass`, `roomGlassFrom`); a plain
  glass shell's room makes its own (`realGlass`, `shellPicture`, `quarries` in `world/realOpenings.ts`).
- **Reveals of different depth on one face**: `lining()` puts a sleeve from a shallower reveal's back to the lining.
- **A vault or ceiling across a real window**: reshape it (the Vleeshuis's outer aisles have half vaults rising to the
  long walls), so the window shows whole from inside.
- **Parts that are not the hall** (issue #28, the three churches): each real opening carries a `zone` (hall, tower,
  attic, annex); the script writes the spaces behind the others too (`SHELL_SPACES` in `shared/churchesShell.ts`: outline,
  floor, top, which edges it lines, what it holds) and the hall builds them in its own scene, a Kit per part
  (`world/churchSpaces.ts`: linings, floors, belfries with bells and louvres, roof spaces with trusses, rooms with their
  furniture). Their windows are openings of the hall seen from the street only (`windowOpenings(..., seen)` answers
  false inside), their panes a glass mesh of their own (`_lit_glass_x`), no sun through them. A window whose outside is
  another roof (a tower's face under a transept's roof) is left out; a dormer's window needs the roof behind it cut
  (`gable_roof(cutouts=...)`).
- **City houses** (taverns, shops, the Poesje, the homes): their holes are cut by `build_city.py` from
  `shared/inworld_build.json`, which is the house plan's (houses-inworld test); `houseInWorld.ts` writes their markers from
  the same numbers. A room that draws its own reveal to its single-faced wall meets the shell's reveal there.
- **Windows with no inside** (towers, attics, parts never built) keep their panes until their rooms are built.

## Attics and towers (issue #28, 2026-09-29)

The Vleeshuis's attic, corner turrets and stair tower and the town hall's attic were built this way:

- **The numbers from the shell.** Besides its openings, the script writes into `shared/<name>Shell.ts` the roof's slopes
  (`SHELL_ROOF`: each eave's line, the slope, hipped or not), the dormers' insides (`SHELL_BAYS`: each front's middle and
  way out, the room's cheeks, the reveal's depth, the front's back, its foot and ceiling) and the towers (`SHELL_TOWERS`:
  the shell's rings, which faces stand outside the building, the stair's shaft and the top room as polygons). Types and
  the move into a plan's frame: `shared/shellAttic.ts`.
- **The roof cut open.** A slope with dormers is laid like a wall on its plane (`wall(..., efn=...)` in
  `build_vleeshuis.py`, `holed_slope` in `build_stadhuis.py`, hips as notches), each dormer's outline cut out of it; a
  dormer's front block has a real hole with its reveal, its old pane goes to the `_lit` glass.
- **No shell inside a room: carve it.** `carve()` / `carve_planes()` in `build_vleeshuis.py` split the faces near a room's
  convex volume by its planes and delete the pieces inside (a turret's shaft and top room, the whole attic under the
  boards): the building's walls, cornices and roof where a turret stands, its quoins and walls standing in the attic.
  A tower face partly inside the building is drawn where it stands outside it, so the tower is closed round its shaft.
- **The room** (`client/src/world/atticKit.ts`): `slopeLining` (boards 0.2 under the slate, the bays and towers cut out),
  `bay` (the lining behind a dormer's front with its window, cheeks, ceiling), `towerRoom` (the shaft's linings behind the
  slits, plain walls toward the building, a newel stair; the top room's linings, floor and ceiling; covers 2 cm before the
  tower's walls where they stand in the attic), `trimAtEnds` + `wallQuad` (a hall's linings stopping short of a turret's
  shaft in a corner, the hall's inner face closed as a plain wall).
- **Drawn only where seen**: the attic and tower groups are hidden by the room scene's `onBeforeRender` when the eye is in
  a part that cannot see them; the windows' `seen` answer per part (a tower's never, the attic's from the attic).
- **Walked or not**: the Vleeshuis's attic is walked (a stair from the studio, a third storey in the plan); a steep flight's
  walking rect runs on past its head at the floor's height, or the body's reach meets the floor's edge as a wall. The
  towers and the town hall's attic are seen, not walked (the town hall's attic and loft are locked parts in its plan).

## Rebuild

    blender -b --factory-startup -P tools/blender/build_<name>.py      (writes the glb and shared/<name>Shell.ts)
    npx vitest run test/<name>.test.ts                                 (in server/)
