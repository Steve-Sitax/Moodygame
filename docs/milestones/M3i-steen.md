# M3i - Het Steen as it stood in 1873, 2026-09-23

Why: Steve, 2026-09-23: "put an agent on het steen. It has to be way more detailed and true to how it was/is. It normally has an archway and sloped road, investigate find images and alter. If it is not in its place, move." Then, after the research: "Yes true to 1873, no ramp then." And: "people visiting it would be nice, or other appropriate activities around it."

## What the sources say

### History
| When | What |
|---|---|
| c. 850 | A refuge castle with an earth rampart on the spot (the Burcht). |
| 1200-1225 | Het Steen and the castle wall built in stone, as the gatehouse of the Burcht. Prison from the early 14th century. |
| c. 1520 | Charles V has it rebuilt, after designs by Domien de Waghemakere and Rombout II Keldermans: the Tournai stone below kept, sandstone above. The Semini relief and its niche over the gate kept. From then "'s-Heeren Steen". |
| 1549 | Charles V gives it to the city. |
| until 1823 | Prison. 1826-27 a home for invalid soldiers. 1842 the city buys it back. |
| 1862 | Pieter Génard proposes a museum of antiquities; it opens in 1864 (restoration by architect Kennes). **In 1873 the Steen is the Museum of Antiquities.** |
| 1877-1885 | The Scheldt quays are straightened. The whole Burcht quarter goes: the Steenstraat, the Gevangenisstraat, the houses built against the Steen. The old riverside wall stands until 1883. The Steen survives only because it stood between the new quay and the railway; it is left alone on its mound. |
| 1887-1890 | Restoration and a new wing (Joseph Schadde, Ferdinand Truyman, city architect Gustave Royers; contractor Fréderic Masson; 160,000 francs). New: **the curved ramp with a balustrade and blue-stone corner posts** (then with obelisks and winged lions), the neo-Gothic north wing with its tall spired towers, a false parapet over the Steenpoort instead of its saddle roof, battlements on the corner towers, a rebuilt stepped gable on the west front. |
| 1952-1957 | National Maritime Museum; part of the 1890 wing replaced by a brick museum wing. 1963: the Lange Wapper statue at the foot of the ramp. |
| 2021 | Visitor centre and cruise terminal by noAarchitecten. |

### The gate, the archway and the sloped road
- **The archway existed in 1873.** It is the Steenpoort: a pointed arch through a plain stone gate block with a tiled saddle roof, the Semini relief (a small worn Roman-era figure, face and hands chipped off in 1587) in a round-headed niche above it, a round tower at each side. The lithographs of 1838 and 1844, Linnig's etching (before 1868), the 1880 photograph "La rue du Steen", Puttaert's engraving of 1880 and Verhaert's etching of 1881 all show it.
- **The balustraded ramp did not exist in 1873.** It was built in 1887-1890, after the quay works had lowered the ground round the Steen's mound.
- **What there was in 1873:** the Steenstraat, a narrow cobbled lane between houses, running along the inland side of the Steen and through the Steenpoort. It crossed the old moat of the Burcht on a stone bridge that was by then buried under the street, and rose gently to the gate: Linnig's watercolour of 1886 shows the bridge's arches laid bare once the houses were gone, and a photograph of c. 1883 (G. Hermans, VAi) is described as "the old bridge towards the Steenpoort". So the 1873 "sloped road" was a gentle rise in the lane, not a ramp.
- **Behind the arch**, on the lane, Charles V's gatehouse front: a door under a moulded four-centred arch between short thick columns with tall capitals, corbels with little basket arches, and above them a three-sided oriel with carved panels (Charles V's arms; the Burgundian saltire with the fire steels and the pillars of Hercules) under tall barred windows, a tall stepped gable behind. Next to it the prison range with two storeys of barred windows. The photograph of c. 1883 shows "MUSEUM VAN OUDHEDEN / MUSEE D'ANTIQUITES" painted over the ground floor of that range.
- **A calvary** (a large crucifix on a base with an iron railing and a lamp bracket) stood in the Steenstraat just outside the gate (1838 lithograph through the arch, 1880 photograph, Linnig 1886).

### The building in 1873 (and what is later)
From the river and the south (Linnig 1886, the 1823 and pre-1868 prints, the photographs of the cleared Steen): rough blue-grey Tournai stone below, yellowish sandstone above; a big three-quarter round tower on the corner by the river with a conical slate roof; a second round tower by the gate; nearly blind walls with small barred windows, slits and two round windows (oculi) on the west front; stepped gables; red tile and slate roofs with dormers and chimneys; a small corbelled turret with a conical cap; a battlemented stretch on corbels. All of it hemmed in by houses. **Not in 1873:** the tall slim tower with its spire, the neo-Gothic north wing, the battlemented tops of the corner towers, the false parapet over the gate, the ramp, the railings round a free-standing Steen, the Lange Wapper. Our earlier model (steen3, after Steve's photo) showed the Steen of the 1890s.

### Where it stood
The 1873 Vuillaume map (`data/refs/vuillaume_1873.jpg`, georeference `data/refs/georef.json`, rms 6 m) and OpenStreetMap, put in the M3c world frame:
- The Steen stood **on the quay line, not in the river**: its river front about 20 m behind the quay edge (Quai Van Dyck), inside the Burcht.
- A rounded quay **promontory** jutted into the river just **north** of it, in front of the Place du Bourg (the Burchtplein, a square with trees).
- The small fish market (Marché au poisson) lay just **south** of it; the Steenstraat reached the gate from there.
- The Vleeshuis lies 53 m north and 135 m inland of it; the town hall 87 m south and 200 m inland.

## What was built

### Position (`tools/city/design.py`)
- The Steen leaves the bastion and stands on the quay line: a designed rectangle of 34 x 16.5 m at x -222..-188, z 10.5..27, long side along the river (was: the OSM outline, which includes the 1889 and 2021 wings, at 0.8 scale, on the bastion at (-182, -20)). Its river front stands 10.5 m from the quay edge, behind the quay railway (z 4.0) and the omnibus lane (z 8.3).
- The bastion stays, as the quay promontory north of the Steen; its railings are unchanged. Its middle lies 23 m north of the Steen's middle (real: about 40 m).
- The Steenstraat: a 6 m lane along the Steen's inland side (z 27..33), in line with the street behind the town hall. The Steenpoort stands over it at the Steen's south end.
- New block of houses across the lane from the gatehouse (x -217..-206, z 33..45), as in the 1838-1880 views.
- The riverside houses behind the town hall end at x -246 (was -222): the small square between them and the Steen is the little fish market.
- Trees: the Steenplein rows keep only x -184..-152 (the square north of the Steen, like the tree-lined Place du Bourg); the Werf row ends at x -252. Lamps: the two quay lamps at x -214 and -190 (z 9.5) are gone (they stood where the Steen is now).
- Relations now: the Vleeshuis 89 m north and 80 m inland (real 53 / 135, before this change 66 / 119; the compact map cut the streets between), the town hall right behind the little fish market, the river in front.
- `PLACES` "Het Steen" moved to (-205, 18.75).

### Clashes found and fixed
- **Omnibus** (`world/omnibus.ts`): the quay line turned inland at x -204, through the new Steen. It now turns at x -234, over the little fish market.
- **Cart traffic** (`world/traffic.ts`, the "werf" loop): turned at x -216; now at x -240.
- **Cart ruts** (`world/ruts.ts`): a waypoint at (-200, 13) inside the Steen, now (-205, 8.5).
- The quay railway (z 4.0), the crane runways (to x -222) and the ferry pontoon (x -251..-247) are untouched and clear.

### The model (`tools/blender/build_landmarks.py`, `steen4`, 4,518 triangles)
World-aligned frame (u = x along the river, v = z inland). Materials: stone, slate, glass, lead, gilt, and a new 256x256 atlas `steen_atlas` (city.ts picks it up like every `*_atlas`). Stone gets a vertex tint: blue-grey Tournai stone below 4.5 m, yellowish sandstone above, a little per-face weathering.
- The river front: the great hall with a battlement on corbels (machicolations) and dormers behind it, slits, small barred windows, the two oculi; the north part under red pantiles with dormers, cross windows, and a corbelled turret on a squinch cone with loopholes and a conical cap.
- The big three-quarter round corner tower (18 sides) with a corbelled rim, a conical slate roof, a vane; the round tower by the gate; both with slits, barred windows, arched doors at their feet.
- The south front on the little fish market: a blind wall and a stepped gable with its three small windows.
- The Steenpoort over the lane: pointed arch (4.5 m wide, 5.6 m high) through a plain gate block with a pantiled roof, the arch's soffit, the Semini relief in its niche under a small hood, a lantern on a bracket, the east tower.
- On the lane: Charles V's gatehouse (portal with columns and capitals, the museum door with its wicket, corbels, the three-sided oriel with the carved panels and barred windows, a slate cap, a tall stepped gable); the prison range with barred windows on two floors, the painted museum name (a name, so Dutch and French), dormers, a downpipe; the board by the door in plain English: "MUSEUM OF ANTIQUITIES / OPEN 10 - 4".
- A small brick house built against the north-east corner (door and windows on the square, pantiles, a stepped gable); the Steen's own stepped gables rise behind it.
- String courses, eaves cornices, sandstone quoins, lead on the ridges, iron wall anchors, five chimneys.
- The calvary outside the gate, against the back of the town hall.
- The old `steen3` (the 1890s look) stays in the file, unused.

### The ramp (dropped)
Steve decided: true to 1873, no ramp. The gate stands at street level; the player walks along the lane, through the Steenpoort and up to the museum door. No height function was added to `rijnkaai.ts`. The gentle rise of the 1873 lane over the buried bridge is not modelled.

### Life round the Steen (`client/src/world/steenlife.ts`, new)
- By day, while the museum is open (10:00-16:00): the museum door stands open (a dark doorway over the painted door); an attendant in his coat beside it (9:30-16:30); visitors (crowd puppets: gentlemen, wives, a maid, a clerk, a priest, an old woman, a sailor) walk up the lane, stop and look at the gatehouse, step into the doorway and vanish, come out 40-120 s later and walk off; about a third only look and walk on. At most three outside and five in all, only while Jef is within 75 m.
- Round it: a painter on a stool at his easel on the promontory, sketching the Steen's corner tower (a small painted canvas); an old man fishing over the railing at the tip (rod, line, float, bucket); a boy and a girl at the west railing; a couple at the railing of the tip; two benches, a sailor resting on one.
- At night: no one at the door, the door shut, only the lantern on the Steenpoort lit (a glow).
- Colliders: the Steenpoort's east tower (it stands over the lane, outside the walk map's wall), the calvary, the easel, the angler, the benches.
- No change to crowd.ts or town.ts: it uses the crowd's puppet calls (addPuppet, puppetGo, puppetStand, removePuppet, isHidden, alive). The last steps into and out of the doorway are moved by hand (the crowd grid keeps walkers off the wall).

Wiring (main.ts, for main to add):

    import { createSteenLife } from "./world/steenlife";
    // after the trades:
    const steenLife = createSteenLife(world.scene, crowd);
    for (const r of steenLife.colliders) world.addCollider(r);
    // frame() and __scheldemist.step(), after trades.update(...):
    steenLife.update(dt, jobs.day.hourF, player.camera);
    // __scheldemist.paths(), with the other pathPoints:
    for (const q of steenLife.pathPoints()) if (!can(q.x, q.z, q.reach)) bad.push(q.label);
    // the dev object: steenLife,

## Reruns
    python tools/city/design.py && python tools/city/plan.py
    blender -b --factory-startup -P tools/blender/build_landmarks.py
    blender -b --factory-startup -P tools/blender/build_city.py
    blender -b --factory-startup -P tools/blender/build_props.py        # reads the house doors
    blender -b --factory-startup -P tools/blender/build_streetlife.py   # reads the house walls
    blender -b --factory-startup -P tools/blender/build_quayfurniture.py

## Checks (2026-09-23)
- `cd client && npx tsc --noEmit` and `npm run build` pass.
- Path check in the browser: `[]`, with steenlife's colliders in and its three points (the museum door, the Steenpoort from outside, the painter) reachable.
- Walking, by the world's own move(): from the street behind the town hall along the lane through the Steenpoort, at street level (y 0); the gatehouse wall stops you at the door; the east tower and the calvary are solid.
- Visitors over 260 s of game logic: they came, looked, went in, came out and left, again and again.
- Pictures (`data/shots/`): `m3i_air_sw`, `m3i_air_ne`, `m3i_air_top` (dev view), `m3i_eye_steenstraat` (the Steenpoort from the street behind the town hall), `m3i_eye_lane` (the lane, the painted name), `m3i_eye_werf`, `m3i_eye_steenplein`, `m3i_eye_bastion`, `m3i_door`, `m3i_visitor_in`, `m3i_visitor_out`, `m3i_painter`, `m3i_angler`, `m3i_couple`, `m3i_kids`, `m3i_bench`, `m3i_night_gate`, `m3i_night_lantern`. Steve's save was not touched.

## Open points
- steenlife.ts is not wired into main.ts yet (lines above); it was tested by loading it into the running page.
- The server reads `client/public/city/walk.png` when it starts (`server/src/town/walkmap.ts`): the town's walkers know the moved Steen after the next server restart.
- The house list changed near the Steen, so the random looks of the houses in the blocks after it in `design.py` (storeys, styles) changed too.
- The names "Steenplein" (map, omnibus stop, signs) stay; in 1873 the square north of the Steen was the Place du Bourg (Burchtplein), and the Steenplein only came with the 1880s works.
- The 1873 Steen was bigger inland (about 40 x 30 m with its court); the compact map gives it 34 x 16.5 m, without a courtyard.
- Reference copies (public domain and CC0, reference only) are in `data/refs/steen/` with `sources.json`; not in git.
