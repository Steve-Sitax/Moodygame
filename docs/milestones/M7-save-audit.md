# M7 save audit (2026-09-26)

Steve: "In an old-map game, about 250 other homes still point at old spots. Those spots are open street,
so people can walk there, but no door is there. Find all that is still wrong and fix it."
Then (same day): the old saves are removed, so no load migration. The question became: does a NEW game
come out clean? Where it does not, fix the pickers that make the town.

## The check
`server/src/town/audit.ts` `auditSave(db)` holds every stored spot of a save against the current map
(the server's `houseDoors()` and the walk map). It reads the raw rows, so it runs on any save file.
It lists, by kind:
- a door record whose house has no door at its step now: homes, homes to let, the post office, the
  Logement, the Poesje. A house marked `"gone"` has no door, so it is listed too.
- a door record by its step only (shops, place doors, work doors, the dealer, the velocipede maker,
  the wheelwright, the Berg, the runner's lodging) with no house door at the step.
- a standing point no walk from the start reaches: posts, rounds, haul ends, stalls, places, newsboy
  corners, lamp stands, parked vehicles, boat landings, left velocipedes and carts, luggage on the quay,
  planned and running events, active errands, lost notebooks and things, open meetings.
- a door kept for one use with another household behind it: a home to let, a shop, the post office.
- a tavern, the Poesje or a home to let whose rooms the world draws in another house than the door
  it uses (`shared/inworld_houses.json`).

How to run it:
- `node server/scripts/audit-save.ts <save.sqlite> [--load] [--list]`: a save file. It reads a copy
  and never writes to the save. `--load` first runs the server's own repairs on the copy.
- `node server/scripts/audit-save.ts --new 5 [--size very_large] [--list]`: five brand-new games.
- `GET /api/dev/audit` on a dev server: the running game. `{count, kinds, findings}`.
- `server/test/audit.test.ts`.

## What it found
- Steve's old game (made on the map before 169942f), as a file: 339 findings. 287 homes, 19 work
  doors, 12 place doors, 5 shop doors, 5 homes to let, 2 Logement, and one each of the post office,
  the Berg, the dealer, the Poesje, the velocipede shop, the wheelwright, the runner and a post.
  After the load repair of c362aa5: 284. Those saves are gone now.
- Steve's current game (a new game): one finding, De Vliet (below). It keeps it: a save keeps its town.
- New games before the fix, 36 of them (all four sizes): De Vliet in every one. In very large towns
  also a home to let taken or drawn elsewhere (3 of 6).

## The bugs and the fixes
1. **De Vliet stood a house off its room.** The tavern took the door nearest its anchor (-120, 50).
   Its rooms are drawn in house 945, whose door is 6 m east. The sign and the E key were at the
   neighbour's closed door; the open doorway with the lit room was next to it.
   Fix: `population.ts` gives each tavern its own in-world house when it is within 35 m of the anchor.
2. **Very large towns filled the in-world houses first.** A boatman's family moved into house 808,
   the merchant's floor to let; a beggar into 905, the widow's room. The homes to let then fell back
   to other houses, and the client drew their rooms in the old ones.
   Fix: the in-world houses are kept (`server/src/town/kept.ts`). `population.ts`, `garrison.ts`,
   `paper/town.ts` (the post office) and `visitors.ts` skip them.
3. **A milk woman moved into a home to let.** `lively.ts` did not know the homes to let.
   Fix: `ensureLively` passes their houses, and `generateLively` skips them, also in its fallback.
   `visitors.ts` skips them too.

## Checks
- New games after the fix: 23 (9 normal, 3 small, 3 large, 8 very large): nothing listed.
- A tavern that takes its own house still draws the number the old picker drew, so the rest of a seed's town
  (names, stats, families) stays as it was. The seeded tests (town, emigrants, families, lamps) pass.
- Server suite: 843 of 845. The two that fail (lively and transport "on a copy of a real older save") fail
  without these changes too: the new walk map puts an old fixture's step off the walk, and c362aa5's repair
  moves that home.
- `server/test/audit.test.ts`: a new game with three seeds lists nothing; each tavern is at its own
  in-world house; the very large seed 543218927 lists nothing and its homes to let stand in their
  in-world houses; a stale home, a missing house, a shop door in a wall and a stall on the water are
  each listed.
- In the browser (test stack `audit`, 8950/5350, a new game): `/api/dev/audit` count 0; `paths()` [].
  Three homes shot at 13:00 in clear weather (`data/shots/audit_home_1..3.jpg`): a door in the middle of each.
  `audit_vliet_before.jpg` shows De Vliet's sign at the neighbour's door, before the fix;
  `audit_vliet_after.jpg` shows it at its own door.

## Not done
- No load repair for old saves (Steve removed them). c362aa5's repair stays.
- A save made before this fix keeps De Vliet at the neighbour's door until a new game.
- Houses marked `"gone"` later: a save whose homes stand in them will be listed by the audit; nothing moves them.
