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

Wait until the model has loaded before the interior check: without its markers it says so.

## Rebuild

    blender -b --factory-startup -P tools/blender/build_<name>.py      (writes the glb and shared/<name>Shell.ts)
    npx vitest run test/<name>.test.ts                                 (in server/)
