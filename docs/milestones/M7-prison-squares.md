# M7 - The prison, the round square and the greens, 2026-09-26

Steve, 2026-09-26 (then away, carte blanche): "Grass places, a circle square somewhere, decorate. We also need a
prison somewhere: find a building or multiple and put the prison there, with high detail inside and out."

One source for the numbers: `tools/city/places.py` -> `shared/townplaces.json`. It marks the houses the prison stands
on as gone in `shared/city_build.json`, drops the one court pump inside the compound from `city.json alleys.pumps`,
and adds the square's four lamps and three named places (Sint-Jansplein, Lijnwaadmarkt, Prison) to `city.json`.
`plan.py` reads the JSON (walk map: the compound and the furniture as wall; ground zones: lawns, gravel walks, the
compound's earth, no zone ground on the round square's disc).

## What Antwerp had in 1873 (reference only, nothing copied)
- The new prison in the Begijnenstraat: built 1854-59 on the grounds of the former Capuchin sisters' convent, to the
  plans of Joseph Jonas Dumont, who built most of Belgium's cellular prisons of the time. It was made for the
  cellular system of Edouard Ducpetiaux (inspector-general of prisons 1830-61): every man alone in his cell, after
  Pennsylvania and London's Pentonville (1840-42). A front building faced the street: brick and stone,
  neo-Romanesque, a gate in the middle, corner stones and battlements, and pairs of round-arched barred windows.
  Behind it, cell wings of three and four storeys stood round a central observation pavilion, each with a corridor
  and iron galleries under a vault. A high wall ran round the whole block.
- The old lock-ups: the Steen was the town's prison until 1823. In 1873 the police held people for a night at their
  posts round the town hall (in the game: the cell at the police post, M3h).
- Pages read: https://inventaris.onroerenderfgoed.be/erfgoedobjecten/4835 (and its texts),
  https://nl.wikipedia.org/wiki/Gevangenis_van_Antwerpen , https://en.wikipedia.org/wiki/Antwerp_prison .

## The prison
**Where.** The block south of the cathedral, between the cathedral's south street and the wall street. Its front
is on the quiet wall street under the rampart (the real prison stood south of the old centre too). The row along
the wall street and the court's cottages behind it came down: 33 houses (#646-656, #662, #1070-1090) are marked
`"gone"`. No entry was deleted or reordered, and every reader skips them. The houses on the cathedral's south
street and the corner houses (#642-645, #657-661) still stand, their backs to the prison wall 0.8-1.4 m off.
Nobody in an in-world house lived there. The server re-homes anyone who did (`store.ts rehomeLost`). The court's
pump (the court is inside the compound now) is off the pump list.

**The frame** (`shared/prisonPlan.ts`, the same as `places.py`; a test checks they agree): local x along the front,
z into the compound, the gate's middle at (0, 0), world origin (-355.0, 199.5), yaw 1.5411 (the old row's line).

**Outside** (`tools/blender/build_prison.py` -> `client/public/models/prison.glb`, 36k triangles, 950 KB, 7 objects;
placed by `client/src/world/prison.ts`, hooked in `rijnkaai.ts`):

| Part | What |
|---|---|
| Wall | 6.4 m of brick on a bluestone plinth, piers every 5 m on the street side, a rounded bluestone coping with iron spikes |
| Front building | Two storeys and battlements on stone corbels, pairs of round-arched barred windows with bluestone arch rings, string courses, square corner towers with quoins and their own battlements |
| Gate tower | 13.6 m. A deep round arch in two orders of bluestone voussoirs with a big keystone. Under a plaque ("GEVANGENIS 1855") a triple window and a clock. Rusticated corners, corbelled battlements, two round bartizans with slate cones, and a lantern each side of the gate. The gate is a real opening: its oak leaves hang in code |
| Governor's house | At the east end on the street: three storeys, sash windows in bluestone frames, the front door up three steps under a lamp, quoins, a hipped slate roof with dormers and chimneys, a walled garden behind |
| Watch pavilion | An octagon over the wings' roofs (18.4 m) with high round-arched windows, a slate roof and a louvred lantern with a lead cap and finial |
| Cell wings | Two, east and west, three storeys. One small barred window high in each cell, every 2.8 m, stone bands at the floors, pilaster strips. A slate roof with the corridor's glazed roof light along the ridge, ventilation stacks, and an oculus in each end gable. Wing A has the yard door (a real opening) |
| Chapel | In the west court: round-arched leaded windows, buttresses, the rose in its front gable, a bell-cote with its bell, a half-octagon apse |
| Yard | The exercise ring of flagstones round the warder's stand (a stone step and a wooden shelter), benches by the wall, a water butt, lanterns |

Materials: the brick and bluestone take the town's own pictures (`wall_brick.jpg`, `wall_ashlar_blue.jpg`), tinted
darker. The painted atlas holds the barred windows, sashes, doors, the plaque, the clock, the oculi and the rose.
Soot runs down under each wall's top and damp rises at the foot (vertex colours). The plane check on the exported
file: the pairs left are faces hidden inside other solids (merlons on the parapet, the pavilion's faces inside the
wings); no faces flat at y 0 but four hidden ones.

**Inside** (`client/src/world/prisonHall.ts`, the plan in `shared/prisonPlan.ts`): the halls' way (`hallInWorld.ts`).
The floor lies 0.1 m over the street.

| Room | What |
|---|---|
| Gate passage | Bluestone walls, a whitewashed barrel vault, a lantern, a bench, the notice of the hours, the porter's barred hatch into the guard room, the inner grille standing open at its end |
| Guard room | Whitewash over a grey-green dado, a beamed ceiling, the table with the register, the lamp and the ink, three chairs, the stove and its pipe, the bunk, the cupboard, the rifle rack, the key board, the clock, kepis on pegs; a warder at the table |
| Visitors' room | The visitors' side with benches; the double grille on panelled dados with the warder's gangway between (a warder on his stool in visiting hours); the prisoners' side with its bench and door |
| Link | Flagged, the offices' doors, a gas bracket |
| Watch pavilion | Octagonal, 16.8 m high, with iron galleries round it on two storeys and the lantern's light above. The chief warder stands at his desk on a platform, and a clock hangs over the link's arch |
| Wing A | The corridor between cell fronts three storeys high. Oak cell doors in bluestone frames, with straps, a judas, a food hatch and a number plate. Galleries on iron brackets with railings, two bridges across, the iron stair at the far end, the tall barred end window, the whitewashed vault with its roof light, and gas brackets |
| Two open cells | Looked into from their doors: the folding iron bed with straw and blanket, the hinged table and stool, the shelf with the Bible and the tin mug, the bucket, the tap, the rules on a board, the high barred window, a gas jet. In one a man sits on his bed by his oakum |
| Wing B | Seen through its shut grille |
| Yard door | The passage through the south row of cells, and its oak door |

The yard is a walk area of its own in the street's scene (`PP.YARD`), since the walk map has the whole compound
as wall. From wing A's door: the ring, the stand, the benches.

**The life** (the server's: `server/src/town/prison.ts`, `/api/prison`):
- Hours (`shared/prisonPlan.ts`): visiting 9-12 and 14-17, Sunday 14-16 (the gate stands open; at the end a warder
  shows Jef out: "Visiting hours are over."). Exercise 10:00-11:30 and 15:00-16:30, Sunday 10:30-11:30: seven to ten
  men walk the ring in silence, a warder on his stand. The day warders work 6-18: the gate warder on the street, the
  yard warder, the visiting-room warder, the guard room, the chief. At night only the night warder at the gate, the
  guard room and the chief. Their names are the engine's (Warder Maes, Chief warder Verstraeten ...). E by a warder:
  his word by the hour.
- The standing inmate: the town's seed picks one single working man (a docker, porter, carter, boatman or sailor,
  never a special person). He is held 16 days for "a knife drawn in a tavern brawl on the Rijnkaai", from the first
  time the prison is asked about. His home becomes the prison (house -1, the gate's step), his day "home" round the
  clock. On his last morning at seven the engine gives him back his home and his day.
- The police bring thieves: when Jef catches a pickpocket by the collar (`index.ts` catch route), the police pick the
  thief up that night and he is held three days ("Later that night the police pick him up ...").
- A visit: E at the grille in visiting hours ("ask to see a prisoner"). The warder brings the man Jef knows best of
  those held (`POST /api/prison/visit`), he appears behind the grille, and the talk opens. It is the town's own talk
  with that resident: the engine greets him with a line of the grille ("Keep your voice down. The warder writes down
  every word."), and the model's prompt says where he really is (`talkExtras.context`). No new model calls, no new
  budget.

## The round square (Sint-Jansplein)
Where streets L and B meet, the plan already had a round place of 14.7 m to the house fronts (`streets.py
tree_square`), bare cobbles with a patch of flags. Fourteen house fronts ring it and six streets run in, so no house
had to come down: it became the rond-point. Its ground is `townplaces.ts`'s own (the zones leave a hole for it):
- a pavement of flags along the fronts;
- the carriageway in granite setts laid in rings (the quays' picture on rings of uv; each 0.5 m ring laid on its own;
  no parallax, the relief light and the per-stone dice only);
- bluestone kerbs;
- the island in gravel, with a ring of flags round the fountain.

On the island (`tools/blender/build_places.py` -> `places.glb`):
- the fountain: an octagonal stone basin with a moulded coping, water, a pedestal with a cup and four bronze spouts,
  and St John the Baptist in bronze with his staff and the lamb;
- eight plane trees in cast-iron grilles (`trees3d.ts` got a `kindAt`);
- four benches;
- a hexagonal newspaper kiosk with bills, the papers in its window and a zinc dome;
- a cast-iron urinal with its enamel plate;
- four gas lamps, the town's own (`city.json decor.lamps` d66-d69).

**The lamps and the rounds.** Three lamplighters could not take the square: the east round would have needed 685 s
at a walk against a window of 432 s. So there is a fourth round, "north": the canal's quays, the street west of the
Vleeshuis quarter and the Sint-Jansplein (`lamplighters.ts ROUNDS`, `roundOf`). The quay road from x -100 goes to the
east round. `LAMPS_VERSION` is 10; on load one more man of the town (a docker or porter) takes the trade. The dusk
starts are now 2.4 min apart (`DUSK_STAGGER_H` 0.04), so the fourth window still closes by 20:34. Followed at a walk,
the four rounds take 378, 422, 433 and 440 s. `townlife.test.ts` was updated: four men, the migration of a
two-round save gives two men the trade, and a dawn round may start at a walk.

## The greens
The lawns are the ground zones' grass and the walks their earth (gravel). The railings, benches, flower beds and
trees come from `townplaces.ts` and `places.glb`, and the walk map has their solids.

| Green | Where | What |
|---|---|---|
| The Lijnwaadmarkt strip | The 24 m wide street north of the cathedral, x -215.6..-210.6, z 158..202 | A planted strip down its middle, as on the new boulevards: five limes on alternate sides, a gravel walk, five benches, round beds of late flowers at the ends, a low iron railing with openings at the ends and the middle |
| St James's churchyard | The forecourt of the south transept door, opened when #484 and #485 came down | Two railed plots either side of the walk to the door: a calvary with its little roof and bronze corpus, old grave slabs against the church, a lime, two benches, flower beds |
| The court green | The court behind the Sint-Jansplein, round its old tree | A railed lawn with a gravel walk through it, a second tree, two benches, two beds |

## The bared party walls (the lead's review)
The walls bared by the churches freed showed big dark camouflage blotches. They came from the ghost plaster cell
(`cityTextures.ts` cell 1,1), which was patchy noise with hard-edged holes. The lost house's outline is now one
clean, even film of old limewash over the brick (alpha 0.2 and a breath of variation). `build_city.py ghost_marks`
lays one wallpaper patch in most rooms, not one to three scraps. The floor lines, the flue soot, the fireplaces and
the anchors stay. `city.glb` and `streetlife.glb` were rebuilt (the prison's gone houses too).

## Files
- New: `tools/city/places.py`, `shared/townplaces.json`, `shared/prisonPlan.ts`, `tools/blender/build_prison.py`,
  `tools/blender/build_places.py`, `client/public/models/prison.glb`, `places.glb`, `client/src/world/prison.ts`,
  `prisonHall.ts`, `townplaces.ts`, `server/src/town/prison.ts`, `server/test/prison.test.ts`, this note.
- Small marked hunks: `tools/city/plan.py` (townplaces: walk map, ground zones), `tools/city/design.py` (keeps the
  lamps and places), `shared/city_build.json` (gone), `shared/city.json` (pumps, lamps, places, ground, walk),
  `client/public/city/walk.png`, `client/src/world/rijnkaai.ts` (loads), `client/src/main.ts` (the prison's hall,
  actions, paths, updates), `client/src/world/trees3d.ts` (`kindAt`), `server/src/index.ts` (routes, the catch),
  `server/src/town/lamplighters.ts`, `lampround.ts`, `server/test/townlife.test.ts`, `client/src/world/cityTextures.ts`,
  `tools/blender/build_city.py`, and the rebuilt `city.glb` and `streetlife.glb`.

## Checks (2026-09-26)
- On a clean export of HEAD c6aeb1d with this work applied: `npm run build` passes; the server suite passes, 886 of
  886 (the new `prison.test.ts`: the frame against `townplaces.json`; the gone houses with no door and no home; the
  compound as wall with the gate's step reachable; the hall flooded from the gate to the grille, the guard room, the
  pavilion, the cells' doors and the yard door, and not past the grille, into wing B or into a cell; the hours; the
  standing inmate in and out with his home and day given back; a visit only in hours; a caught thief held three days,
  the talk told where he is; the square's lamps on the north round; the benches' fronts and the greens' walks
  reachable). `node server/scripts/audit-save.ts --new 3`: 0 findings. The old-save tests (`lively`, `transport`)
  now expect four lamplighters and at most two new ones.
- In the browser (test stack `places`, 8953/5353), walking and looking:
  - The prison's ten points and the square's and greens' 25 points are all reached from the start
    (`world.reachFrom`). The whole `paths()` could not run in the shared tree that hour: another helper's
    unfinished shop code threw in it (`this.shops is not iterable`).
  - At the grille, E "ask to see a prisoner" brought Remi Van Hove (the standing inmate, 16 days for the knife)
    and opened the talk with him.
  - Put in the yard at 11:00, then 12:05: "Visiting hours are over.", and Jef stood on the step before the gate.
  - The gate is shut at night, with the night warder at it and its lanterns lit.
- `signs()`: 1,559 things, 3 problems, all shop boards of the shops helper, none here.
- Pictures (`data/shots/`):
  - the prison: `pl_pr2_gate`, `pl_pr2_along`, `pl_pr2_walk` (from the rampart), `pl_pr2_yard`, `pl_pr1_air`,
    `pl_mist_prison`, `pl_night_gate`;
  - inside: `pl_in1_gate` (the passage through the open gate), `pl_in1_passage`, `pl_in3_corr`, `pl_in2_pav`,
    `pl_in2_visit`, `pl_in3_guard`, `pl_in4_celln`, `pl_in4_cells`, `pl_in4_yarddoor`, `pl_in2_wingb`,
    `pl_in6_yard_eye`, `pl_in1_yardair`;
  - the square: `pl_rd1_eye`, `pl_rd1_eye2`, `pl_rd1_air`, `pl_mist_rond`, `pl_night_rond`;
  - the greens: `pl_gr1_lijn`, `pl_gr1_lijn2`, `pl_gr1_jacob`, `pl_gr1_jacob2`, `pl_gr1_court`, `pl_gr1_court2`,
    `pl_mist_lijn`, `pl_night_lijn`;
  - the bared walls: `pl_gh2_james_l`, `pl_gh2_james_r`, `pl_gh2_paul_s`, `pl_gh2_paul_n`, `pl_gh_james_far`.

## Open
- Wing B is only seen through its grille, and the galleries and the upper cells are not walked.
- The warders and the men in the ring are the prison's own figures, not townspeople; only the men held for the
  talk are residents.
- The talk's choices at the grille are the town's usual ones ("Is there any work going?"); the greeting and the
  model know where he is.

## Rebuild
    python tools/city/places.py                                     (under: node tools/withLock.mjs walk-map -- ...)
    cd tools/city && python plan.py --ground && python walk_only.py   (the same lock)
    blender -b --factory-startup -P tools/blender/build_prison.py
    blender -b --factory-startup -P tools/blender/build_places.py
    blender ... build_city.py, build_streetlife.py                   (under the city-glb lock)
