# M7 - Sint-Pauluskerk and Sint-Jacobskerk, 2026-09-26

Steve, 2026-09-26, after the Carolus: "Now also do the 2 remaining churches in high detail inside and outside.
Look up pictures, create impressions with Codex."

Part 1: the outsides. Part 2: walking in and out, the insides.

## What they were like in 1873 (reference only, nothing copied)
**Sint-Pauluskerk** (the Dominicans' church, Veemarkt):
- A late-Gothic basilica of about 1517 to 1571. The nave has six bays, the transept is no wider than the nave,
  and the long friars' choir ends in a five-sided apse. It is about 88 m long and 25 m wide, with the vault at 25 m.
- The walls are brick with courses of pale stone (Lede sandstone, white stone). The buttresses step back, and
  the roofs are slate. The south aisle has four-light windows; the north aisle wall is nearly blind, because
  the fifteen Rosary paintings hang inside it.
- The west front in 1873 was the older 17th-century one, its top rebuilt in 1680-81 (the neo-Gothic front is
  from 1895-1901). The main entrance is a Baroque portal of 1734 in Gobertange stone with bluestone trim: a relief
  of the Virgin giving the rosary to St Dominic, and a pediment with Mary, Paul and Dominic.
- The tower (Millich, 1679-82) stands at the south, in the angle of the transept and the choir. It is about
  65 m high. The square brick base of five storeys has drip mouldings and small round windows. Above it:
  - the white octagonal belfry, with Ionic three-quarter columns and two tiers of openings;
  - a cupola with eight ribs, a balustrade, and an open lantern of eight arches with herms;
  - a small dome, an orb and the cross.
- The Calvary (1697-1747) stands against the south aisle: 63 life-size statues. An angels' path with the
  instruments of the Passion leads to the Holy Sepulchre's grotto. There are prophets' and evangelists'
  gardens, and a rock mound in three terraces with the crucifix on top. The Lourdes grotto of 1908 is left out.
- Inside (for part 2):
  - The high altar of 1670 is black and white marble, carved by the Verbrugghens, with a painting.
  - The oak confessionals (1657-59) stand in a continuous panelling with 20 life-size figures an aisle.
  - The oak choir stalls; the fifteen Mysteries of the Rosary in a row along the north aisle.
  - The organ of 1654-58 on the west gallery; marble communion rails.
  - The choir screen was gone since 1833.

**Sint-Jacobskerk** (Lange Nieuwstraat):
- Brabant Gothic, 1491 to 1656, in Lede sandstone with brick inside. It is about 98 m long and 55 m across the
  transept, and the vault is at 26 m. The nave has five bays with chapels between the buttresses. The transept
  projects two bays. The choir has four bays, a five-sided apse, an ambulatory and three radiating chapels
  (1626-38). Most of the tracery is flamboyant.
- The west tower was never finished: work stopped at the fifth storey, at about 55 m. It has four heavy corner
  buttresses stepping back three times, and it is capped by two small slate roofs (no lantern). The west portal
  of 1515 is a broad arch between buttresses, with a Baroque shell added late in the 17th century; its statues
  date from 1921, so they were not there in 1873.
- The south portal is neo-Gothic of 1864 (new in 1873). There is a round domed baptistery of 1804 south of the
  tower.
- Inside (for part 2):
  - The marble choir screen of 1669, with the organ (1727) on it; there was no west organ yet.
  - The high altar of 1685, with St James carried up by angels.
  - Rubens's burial chapel behind it, in the ambulatory.
  - The Holy Sacrament chapel; about 22 chapels in all.
  - The oak pulpit of 1678, and about 1,300 grave slabs.
- Pages read:
  - https://inventaris.onroerenderfgoed.be/erfgoedobjecten/4648
  - https://en.wikipedia.org/wiki/St._Paul%27s_Church,_Antwerp
  - https://nl.wikipedia.org/wiki/Sint-Pauluskerk_(Antwerpen)
  - https://nl.wikipedia.org/wiki/Calvarieberg_(Antwerpen)
  - https://topa.be/en/sint-pauluskerk/beschrijving/architectuur/ (and the pages on the tower, pulpit, confessionals, organ and Rosary mysteries)
  - https://www.sintpaulusantwerpen.be/en/art-history/art-collection/main-altar-2
  - https://www.sintpaulusantwerpen.be/en/art-history/calvary-garden/calvary-garden/
  - https://inventaris.onroerenderfgoed.be/erfgoedobjecten/6155
  - https://en.wikipedia.org/wiki/St._James%27_Church,_Antwerp
  - https://nl.wikipedia.org/wiki/Sint-Jacobskerk_(Antwerpen)
  - https://topa.be/sint-jacob/beschrijving/toren/ (and the pages on its architecture, building history, choir, burial chapels, parish church and plan)
  - https://mkantwerpen.be/en/churches/st-james-church/

## Codex pictures
All through `tools/codexImage.mjs` once it existed (one run at a time).
- Concepts (not in the repo): St Paul outside with the Calvary, St Paul inside, St James outside, St James inside.
- In the repo, with a row each in `assets/ATTRIBUTION.md`: `pj_brick.jpg`, `pj_white.jpg` and `pj_brabant.jpg`
  (client/public/textures).
- Made for part 2: the bluestone floor with grave slabs, the limewashed wall, three Rosary mysteries, St Paul's
  and St James's high altar paintings, and the Virgin and Child with saints for the burial chapel. These are new
  paintings, not copies.

## The outsides (part 1)
Both are rebuilt in `tools/blender/build_churches.py` (`stpaul()`, `stjacob()`, their numbers in `PF` and `JF`).
They share a set of Gothic parts:
- `gwin`: a window's stone in its reveal (mullions, a transom, a hood moulding with label stops, a sill);
- `pband`: pointed mouldings;
- `pinnacle`, and `gbuttress` (stepped buttresses with pinnacles);
- `fly`: flying buttresses with their webs;
- `gable_coping`: copings with crockets and finials;
- `gportal`: a porch of stepped pointed orders, a crocketed gable, statues on corbels under canopies;
- `blind_panel`: blind tracery;
- `parapet`: open parapets;
- `ridge_turret`.

**St Paul** (brick `pj_brick`, white stone `pj_white`):
- The west front on the square: brick with white bands and a four-light window. Buttresses with pinnacles, the
  gable's coping, pinnacles at its feet and a rose in it. The Baroque portal: Ionic columns and pilasters on
  bluestone pedestals, an entablature breaking forward, the rosary relief with two figures and a gilded glory,
  a pediment with three statues.
- The aisles under their row of cross gables, each coped. The south aisle has four-light windows between
  pinnacled buttresses. The north aisle has one window and blind tracery (the paintings are behind it), and the
  low north chapels have two-light windows.
- The clerestory has three-light windows and a white cornice. The nave roof has a lead ridge.
- The transept: the north front on its small square has a Gothic porch with statues, a four-light window, the
  rose, a coping with crockets and pinnacled buttresses.
- The long choir and the apse have windows, pinnacled buttresses and a cornice.
- The tower now stands at the south, as the real one does, storey by storey after the research. It is about
  46 m to the cross.
- The Calvary fills the strip along the south aisle. It has a brick wall with a white coping, an iron railing,
  gate piers with vases toward the square, and ten angels on pedestals along the path. The rock mound rises in
  three terraces against the aisle wall, with the grotto's mouth at its foot, and on top the crucifix, the
  Virgin, St John and prophets. The evangelists' figures stand in the east part. From the street you see it
  through the railing; the houses built against the south side hide the rest.
- The convent round the choir has white window frames.

**St James** (Lede sandstone `pj_brabant`):
- The west tower, five storeys marked by mouldings:
  - the portal, with two stepped pointed orders and the Baroque shell;
  - a four-light window, and belfry lights with mullions on three sides;
  - blind tracery panels;
  - four corner buttresses in three offsets with pinnacles, the last as shafts up to the top;
  - the open parapet, corner pinnacles, and the two small slate roofs with crosses.
- The aisles and the chapels between their buttresses have two- and three-light windows. The piers carry
  pinnacles, and flying buttresses run to the clerestory. There are open parapets on the aisles and the nave.
- The round domed baptistery (1804) of white stone stands south of the tower, in the first chapel's place.
- The transept fronts have six-light windows, crocketed copings, octagonal corner turrets with spires, and
  pinnacled buttresses. The south front has the neo-Gothic portal with a gable and statues. A ridge turret
  stands over the crossing.
- The choir has two-light clerestory windows and flyers. The ambulatory has three-light windows, pinnacled
  buttresses and flyers to the apse, and its three radiating chapels have their own windows and roofs.
- The sacristy, and the churchyard wall with a bluestone coping and headstones.

Both are about 24 to 28k triangles (`churches.glb` 101k in all). The plane check on the exported file finds
nothing in one plane. The pairs it lists within 5 cm are window mullions against their sills and the Calvary's
cross; none is nearer than 2.5 cm. The doors are still painted: they become real openings with the interiors.
The lanterns by the doors (`build_city.py CHURCH_LANTERNS`) stand where they did.

Pairs (before left, after right, 13:00 clear): `data/shots/pj_pair_paul.jpg`, `pj_pair_james.jpg`; mist:
`pj_pair_mist.jpg`; close: `pj_after_close.jpg` (the portals, the tower tops, the flyers, the Calvary through its
railing).

## The insides (part 2)
Both churches are walked into through their west doors, as the Carolus is: the plan in `shared/gothicPlan.ts`
(`PAUL`, `JAMES`: floors, walls and furniture as solids, the door, marks, the path check's places, the windows),
the hall built from it in `client/src/world/gothicHall.ts`, and set in the world by `createHallInWorld`
(`gothicInWorld`, hooked in `main.ts` next to the Carolus). The shells' west doors are real openings now
(`OPEN=True` in `build_churches.py`); the transept doors stay painted.

What is inside (numbers are the shells', so the walls stand inside them):
- **Walls and vaults.** Walls are extruded with their real openings: pointed arcades on round columns with
  leafy capitals, the clerestory windows in their lunettes, an openwork triforium parapet. The rib vaults are
  groins: two pointed barrels crossing, with ribs on the creases and along each bay. The crossing has clustered
  piers. The apse is five-sided under a ribbed half dome. Every window has its glass, mullions and a second pane
  in the reveal.
- **St Paul.**
  - The nave of six bays and the aisles; the low north chapels with flat panelled ceilings, oak beams and small
    altars; the fifteen Rosary paintings along the north aisle.
  - The oak confessionals in a row on the south aisle, with carved figures between them; the pulpit.
  - The organ on its west gallery; the Rosary and Holy Cross altars in the transept.
  - The communion rail, the friars' choir stalls, and the high altar of black and white marble with the
    conversion of St Paul.
- **St James.**
  - The tower hall under its own vault; the font; the nave of five bays with statues on the columns.
  - Chapels on both sides between the buttresses. The south's first bay is walled off: the baptistery stands there.
  - The pulpit; the transept altars.
  - The marble choir screen with the organ on it and two altars. The choir with stalls and the high altar
    (St James in glory, under the great shell).
  - The choir aisles and the ambulatory with confessionals. Rubens's chapel behind the high altar, with the
    Virgin and Child with saints.
- **Everywhere:** chairs in blocks with an aisle, brass chandeliers, candle stands, and candles on the altars.
  The floor is bluestone with grave slabs and a matching relief (the height map `pj_slabs_h.png`); the walls
  are limewashed (`pj_wash`); the stone is `pj_white` (St Paul) or `pj_brabant` (St James). The paintings are
  new Codex pictures (listed in `assets/ATTRIBUTION.md`).
- **Life:**
  - The doors stand open 6:00-19:00. At 19:00 the sexton puts Jef out on the step, facing the square, and shuts
    the door.
  - Inside, the church's own echo plays (`roomSound("church")`). The windows glow with the hour.
  - The path check knows ten places in each church (`gothic.pathPoints()`).
  - Carts, stalls and crates keep off the doors (`gothicKeepOut` in `doorKeep.ts`).
- St James's stone outside is a little lighter (`CAROLUS_TINT.pj_brabant` 1.62, 1.54, 1.4).

Checks (own stack, 2026-09-26):
- **Holes.** `hallcheck.gaps()` over points 3.5 m apart, four ways each, level and looking up: St Paul
  1074 views, St James 1549 views, none shows the background. Fixed on the way:
  - panes too small at a slant (now larger, with a back pane in the reveal);
  - `pointedAt` bulging for low arches;
  - the choir floor; the vault edge beside the tower;
  - the tower's east wall now reaches the vault;
  - the chapel walls at their corners.
- **Walking through the door.** `hallcheck.walk()` in and out, straight and turned, through both doors: no
  spike. The one jump is St James's opened door leaf passing out of view.
- **Z-fighting.** `zfight()` on the street near both churches lists nothing of the churches. The halls' own
  scenes: 102 small pairs each, all under 0.5 m2 (the tops of the confessionals, faces inside floors). Fixed
  on the way:
  - windows of the next wall taken into a wall (broken triangulation);
  - ribs drawn twice;
  - wall ends in one plane with the tower walls, the transept walls and the chapel arches;
  - the paintings' canvas on its frame.
  In dev, a wall now warns when a window or an opening runs past it.
- **Paths.** `paths()` lists nothing. One fix: the plan's areas overlap at the choir, where the flood had
  stopped at a seam.
- **Frame time** (1024x768, looking at the open door from 14 m, hall shown vs hidden):
  - St Paul: +0.1 to 0.7 ms, +27 draw calls, +55k triangles;
  - St James: +0.3 ms;
  - inside: 1.4 to 2.6 ms, 27 to 29 draw calls, 55 to 63k triangles.
- **Tests.** `server/test/gothic-inworld.test.ts` (16) checks that:
  - the floors lie inside the landmark;
  - there is one door;
  - every mark, place, confessional and the pulpit can be reached;
  - nobody passes the rail or the screen, but the ambulatory can be reached round the choir;
  - the baptistery bay is closed;
  - the shut door holds;
  - the threshold works.
  It passes with the other in-world tests (76).

Pictures (`data/shots`):
- inside by day: `pj_in_sheet_p.jpg`, `pj_in_sheet_j.jpg`;
- looking out through the door, mist inside, dusk with candles: `pj_mood_sheet.jpg` (rows 1, 3, 4);
- mist and night before the doors (open by day, shut and lanterns lit at night): `pj_out_sheet.jpg`.

Open points:
- The transept doors are painted, not opened.
- No people inside yet (no mass, no sexton figure).
- St Paul's Calvary is mostly hidden by the houses built against it.
- `possessions.ts` does not know the porches.
