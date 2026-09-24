# M6 - Inside the landmarks, 2026-09-24

Why: Steve, 2026-09-24: "Create very good insides for the landmarks. Appropriate stuff will be going on in the landmarks."

You can now walk into the cathedral, the town hall, the Vleeshuis, the Steen and the Oostershuis. Each hall is built in code in the PS1 way and has its own life, which comes from the town's schedules and the clock.

## Research: the five buildings in 1873
| Building | What it was in 1873 | What we built from it |
|---|---|---|
| Cathedral | Rubens's Elevation of the Cross and Descent from the Cross are back in the church, since 1815. His Assumption hangs over the high altar. Michiel van der Voort's carved oak pulpit (1713) came from Hemiksem abbey in 1804. The organ case dates from 1657. There are baroque confessionals with carved figures. Durlet's restorations are under way. The neo-Gothic choir stalls date from 1880, so they are not in the game. | The two triptychs face each other across the transept. We place them as they hang today and assume the same for 1873. The Assumption hangs on a black and white marble retable with gilding. There is the pulpit, the confessionals, the organ case on a west gallery, and plain oak screens round the choir. |
| Town hall | Floris built it in 1561-65. In the 19th century the inner courtyard was roofed and made into the staircase hall (Bourla, and later Schadde and Dens). The Leys hall, with Hendrik Leys's history paintings, opened in 1870. In the wedding hall, Floris's alabaster caryatids stand at the chimneypiece. | The porter's lodge and a notice board, the staircase hall under a glass roof, and the civil registry's counter with the clerks' office. Upstairs are the wedding hall with the caryatid chimneypiece and a fire, the Leys hall with its paintings, and the aldermen's room. |
| Vleeshuis | This was no longer the butchers' hall. In 1873 it was Peyrot's wine warehouse, with a theatre hall (the society Liefde en Eendragt) and painters' studios upstairs. It was in poor repair. See `M6-vleeshuis.md`. | Three aisles of brick vaults full of casks, with shuttered great windows. Upstairs are the theatre hall (a small stage, a painted backcloth, curtains, footlights, benches) and a painter's studio with easels under a tall window. |
| Steen | The Museum of Antiquities, opened in 1864 in the old castle and prison. The sources say little about its contents: "fossils, stones and weapons", and by 1876 some exotic pieces. | Glass cases of finds (Roman pots and coins, pins, a lamp, jugs, seals, a fossil), tall cabinets, and carved stones. A second hall holds arms and armour (for looking only) and a small bronze gun. A stair goes down to the old prison cell, the last stop of the visit. The exact objects on show are our choice. |
| Oostershuis | The Hanse left in 1593. The building served as barracks and hospital. From 1815 it was used as warehouses. In 1863 the Hanseatic cities ceded it to the Belgian State. In 1882 the city took it over and rebuilt it as a grain store. It burned on 10 December 1893. | The State's warehouse: a gate passage, then a great timber hall of sacks, bales, crates and casks, with a scale, the storekeeper's desk and a hoist through the ceiling. What exactly was stored in 1873 is our choice. |

The chair rent in Belgian churches (a centime to the chair woman) and the church's uniformed beadle (the "suisse") come from general knowledge of the period. They were not checked in a source.

Sources:
- the cathedral: [Onze-Lieve-Vrouwekathedraal (Antwerpen), Wikipedia NL](https://nl.wikipedia.org/wiki/Onze-Lieve-Vrouwekathedraal_(Antwerpen)); [Inventaris Onroerend Erfgoed 4092](https://inventaris.onroerenderfgoed.be/erfgoedobjecten/4092); [preekstoelen.com](https://preekstoelen.com/info/belgie/antwerpen/onze-lieve-vrouwekathedraal);
- the town hall: [Inventaris Onroerend Erfgoed 4032](https://inventaris.onroerenderfgoed.be/erfgoedobjecten/4032); [stad Antwerpen, restauratie stadhuis](https://www.antwerpen.be/nl/dossier/restauratie-stadhuis/);
- the Steen: [Het Steen, Wikipedia NL](https://nl.wikipedia.org/wiki/Het_Steen_(Antwerpen)); [VAi, Het Steen](https://www.vai.be/collectie/collectie-highlights/het-steen); [OKV, Het etnografisch museum Antwerpen](https://www.okv.be/archief/het-etnografisch-museum-antwerpen);
- the Oostershuis: "Het Hanze- of Oostershuis", Dietsche Warande 1894, [DBNL](https://www.dbnl.org/tekst/_die003189401_01/_die003189401_01_0011.php); [Oostershuis, Wikipedia](https://en.wikipedia.org/wiki/Oostershuis); [A View on Cities, MAS](https://aviewoncities.com/antwerp/mas);
- the Vleeshuis: the sources listed in `M6-vleeshuis.md`.

## What is in
| Part | Where | Notes |
|---|---|---|
| Doors and hours | `shared/landmarks.ts` | There are six doors: the cathedral's west door, the town hall, the Vleeshuis's south and north doors, the museum door in the Steen's courtyard (2.2 m up), and the Oostershuis gate. Each step is the first reachable ground in front of its door. The engine sets the hours: the cathedral 6:00-19:00; the town hall 9:00-16:00 on weekdays; the Vleeshuis 7:00-18:00 on weekdays and on theatre evenings; the Steen 10:00-16:00; the Oostershuis 7:00-18:00 on weekdays. Outside those hours, E reads the closed door. |
| Going in | `game/landmarks.ts`, `game/interiors.ts` (small additions) | This uses the interiors' own way in: the same fade and the room-frame walking. A hall can set its own walking pace (1.2-1.45 m/s, Shift is faster), eye height (no stoop) and stone steps. E by a door takes you back out by that door. A night sheet takes you out quietly. You cannot go in carrying goods. |
| The halls | `world/landmarkRooms.ts` (cathedral), `world/landmarkHalls.ts` (the other four), `world/landmarkKit.ts` | Each hall is built in code, one merged mesh per material, with shading baked into vertex colour. Other features: pointed arches and vaults, glass that lights with the hour, day-light shafts, candle flames drawn as points, psx lamp glow. A hall may have two storeys (`Levels`): the town hall, the Vleeshuis and the Steen's cell. You climb real stairs, and the floor rises step by step. Paintings are dark, blurred shapes painted in code, never copies. |
| Who is inside | `server/src/landmarks/life.ts` | The engine decides, from the schedules and the clock. Townspeople whose schedule has them at home are the ones who come in, picked by a hash of the hour, so the street never shows them twice. The same holds for anyone busy in an action or an event. Nobody is in two landmarks at once. The client asks every 3 s and walks people in from the door to a place or a small round. Upstairs they are simply there, without climbing. |
| Cathedral life | life.ts, landmarks.ts | Mass at set hours: low masses on weekdays at 7, 9 and 11, said by the new curate. On Sunday: a low mass at 7, high mass 9-11 (all whose day says "church", up to 30, the parish priest, the organ) and vespers at 3. At mass the priest faces the altar, turns to the people three times, and the altar bell rings at the elevation. The six altar candles are lit, the sexton serves, the beadle stands at the head of the nave, and the chair woman goes along the rows. If Jef sits during mass, she takes her centime (`CHAIR_C` 1, once a mass; she lets it go if he has nothing). Between masses the curate hears confession, the beadle walks the aisles, and 2-5 of the pious pray on the chairs or at side altars. Some light a candle at the Lady altar (a new flame appears), and Jef can too (F, `CANDLE_C` 2 c, a line in the log). The organist practises on weekday afternoons. E on a painting, the pulpit, the organ, the font or a grave slab gives a short text. |
| The M4 wedding inside | life.ts `weddingNow` (reads `town_event` only) | While a wedding at the west door is still before its procession, the cathedral shows it: the couple at the communion rail, the priest facing them inside the rail, the sexton, the organist, and up to 26 guests in the front rows. The doors stay open for it. Once the procession walks, they are gone from the church. |
| Confession | `server/src/landmarks/confession.ts`, the panel in `landmarks.ts` | E at the curate's confessional, during his hours, and you kneel at the grille. You type in your own words. The regex gate and the fence are the same as in talk; a gated line gets a puzzled engine answer. The priest answers with advice and some dry humour: the model (hook `confession`), 20 s, then a guard (no sums, no promises, no police, no oaths; he may speak of God). The engine answers if the model is late, wrong or over its share. The engine sets the penance ("say three Hail Marys"). Esc asks for absolution. SECRET: what Jef says goes to the model once and is written nowhere: not the log, the event log, a memory, a rumour, world_state or the console. Only a count of today's confessions is kept, and nothing about Jef changes. |
| Town hall life | life.ts | The town's two town-hall clerks and the new ones work at desks and at the registry counter. The porter sits in his lodge. 1-3 callers come to the counter or wait on the bench. On Tuesday, Thursday and Saturday at 11, a civil wedding takes place upstairs if the town has a free courting pair: the alderman in the wedding hall, the registrar, two witnesses and the families. The engine picks that couple once for the day and keeps it. The register on the counter (E) lists today's marriages, and couples wed at the cathedral in an M4 event appear there too. The notice board by the door shows the newest bills pasted up in the town (`poster` table, read only). |
| Vleeshuis life | life.ts, landmarks.ts | Peyrot's cellar master stands at his desk. Three cellarmen roll casks along the floor (the cask rolls ahead of each man). A painter works in his studio. On Tuesday and Friday at 19:00 the theatre society rehearses: a fixed dozen of the town, whoever is free that evening. Upstairs you hear their lines, our own words for a Flemish history drama, with the speech murmur. On Sunday evening they perform to an audience of up to 16. |
| Steen and Oostershuis life | life.ts | In the Steen, the attendant walks his round and 2-6 visitors walk slowly from case to case, hands behind their backs. In the Oostershuis, the storekeeper writes at his desk, four natie men carry sacks from stack to scale to stack, and the hoist goes up and down. |
| New people | `server/src/landmarks/town.ts` | There are 19 newcomers. The cathedral gets the curate, the organist, the beadle and the chair woman. The town hall gets the registrar, the alderman, a clerk and the porter. The Vleeshuis gets the cellar master, three cellarmen and the painter. The Steen gets the attendant. The Oostershuis gets the storekeeper and four natie men. There are 11 new trades in `town/places.ts`. They work "inside": the street sees them walk to the door and go in. Each gets a house that nobody lives in near their landmark, or lodges in a house of the town. The landmarks are added to the town's places. Save migration: an older save gets them in place, once (world_state `landmarks`). |
| Talk | `talkExtras.context` (no edit of talk.ts) | E on anyone inside opens the usual talk window. The prompt tells them where they stand and what they do ("hearing confession in your confessional ... speak low: it is a church"). |
| Sound | `audio/organ.ts`, `soundscape.ts` (small additions) | Each hall has its own echo (the cathedral 4.8 s; the others 1.6-2.2 s). The street is muffled through the walls, but in the cathedral the bells come through. A quiet murmur plays in the church and the town hall. The organ is made in code: a soft chord bed that walks through a D-major progression, swelling in and out. The altar bell is three strikes of a small bell. Steps inside echo. No new recordings. |
| Path check, dev | `main.ts` | `paths()` also checks every landmark door. Dev: `__scheldemist.landmarks`: `devEnter(id or door)`, `devGo(x, z)`, `debug()`, `devConfess(text)`. `shotIn` takes pictures inside. |

## Budget
There is one new share: `CONFESSION_CALLS_PER_DAY = 2` in `server/src/config.ts`. It is out of what was left, never the reserve, and the daily total of 80 is unchanged. The shares are now: townspeople 30, director 9 + families 3, conversations 7 + surprises 3, paper 6, tavern 6, Poesje 2, homes 2, AI ideas 4, confession 2. That leaves 6 for the board, the outcomes, the named people and the epilogue. Nothing else in the landmarks calls a model.

## Checks (2026-09-24)
- `npm test`: 451 of 451. There is a new `server/test/landmarks.test.ts` with 20 tests:
  - the migration: a new town has the newcomers, the places and the doors; an older save gets the 19 in place with every other resident row, memory, relationship and the money unchanged, each in a free house or lodging, once only;
  - schedules inside:
    - a weekday low mass (the curate; only the pious who are at home);
    - Sunday high mass (only those whose day says church; the parish priest; the organ);
    - confession between masses; the church shut at night;
    - the town-hall clerks, and the hall shut on Sunday;
    - the cellarmen by day but not at noon; the Tuesday rehearsal;
    - the museum's attendant and visitors; the Oostershuis's men, and the building shut on Sunday;
    - nobody in two landmarks at once at five times; someone busy in an action is not drawn;
  - the M4 wedding inside (the couple, the priest and the guests; the organ; the register records them) and gone at the procession;
  - the civil wedding (the pair, the alderman, the registrar, witnesses; the same couple all day, never again another day; the register after the ceremony);
  - the notice board reads a poster and changes nothing;
  - the confession: the model's words; the confession sent fenced; nothing of it or of the answer in any table; money, needs, the log, events and memories unchanged; the curate remembers nothing and his talk prompt carries none of it;
  - hostile lines: all 30 of `hostile-lines.ts` with hostile model output (sums, "AI", a script tag, the police, an oath, extra fields such as `money_c` 9999). None of it gets through, nothing changes, nothing is kept, and more than 5 are gated;
  - the fallback: a model that never answers gives the engine's answer after the timeout; the share and the reserve are held;
  - the guard; no confession during mass or at night;
  - the candle price and its log line; the chair centime once a mass.
- `npm run build` passes.
- Old-save migration on a copy of the real save (a `.backup()` of `data/game.sqlite`, stripped of this work's rows): 19 added and 5 places added. The other 229 resident rows, the 79 memories, every relationship and the player were unchanged. A second open added nothing.
- In the browser, in my own tab, on test saves only:
  - `data/test-landmarks.sqlite` is a copy of the real save, with its ending cleared on the copy. `data/tmp-landmarks/fresh.sqlite` is a fresh town, used for the civil wedding. The server ran on 8911 and vite on 5291 (`data/vite-test-landmarks.config.mjs`, HMR off).
  - `__scheldemist.paths()` lists nothing, on both saves.
  - A weekday low mass: the curate at the altar, 12 of the pious on the chairs, the beadle, the chair woman.
  - Sunday high mass: 35 inside, the organ on.
  - The confession, with the real model at 15:00: "I stole a loaf from the baker on the Steenplein because I was hungry, and I lied to my landlady about the rent." The answer came in 8.2 s: "Hunger is a poor counsellor, my son, and Our Lord knows an empty belly better than any baker does. Go and tell the truth to those you have wronged, before your conscience starts charging you rent as well. And knock at the sisters' kitchen door; they would much rather feed you than pray for you afterwards." Afterwards every table of the save was searched: the words were in none of them, and not in the server's log. The only trace is one `ai_call` row (hook, time, tokens).
  - The M4 wedding: started from the Dev endpoint. Inside, Karel Hendrickx and Theresia Michiels stood at the rail with Father Cornelis Mols facing them, 34 inside in all, the organ playing.
  - The civil wedding (fresh town, Tuesday 11:10): Achiel Stevens and Stephanie Goossens stood before the alderman Jan-Baptist Gevers and the registrar, with two witnesses. The register then read "Married at the town hall before the alderman: Achiel Stevens and Stephanie Goossens."
  - Stairs: walked up to the town hall's wedding hall (level 1 at 5.4 m) and back down, up to the Vleeshuis theatre (6.2 m), and down to the Steen's cell (-2.4 m).
  - The rehearsal: a prompter and five actors on the stage, the footlights lit.
  - A candle bought at the Lady altar (300 to 298 c, a new flame).
  - Talk inside opened the usual window (Barbara Willems at the registry counter).
  - After the check the audio was closed and the tab parked on the licence page.
- Frame time, with the same harness as M6-interiors: `__scheldemist.perf(40)`, hidden tab, GPU-finished, with the town's own update running and other helpers' servers up:

| Hall | People | ms | Draw calls | Triangles |
|---|---|---|---|---|
| Cathedral, weekday | 16 | 2.2 | 68 | 41.1k |
| Cathedral, Sunday high mass | 35 | 4.7 | 85 | 58.0k |
| Town hall, morning | 12 | 3.1 | 52 | 17.1k |
| Town hall, civil wedding | 13 | 6.3 (a noisy run) | 53 | 17.9k |
| Vleeshuis, cellar | 5 | 3.3 | 31 | 25.9k |
| Vleeshuis, rehearsal | 6 | 3.1 | 25 | 26.5k |
| Steen | 3 | 1.4 | 22 | 7.1k |
| Oostershuis | 5 | 1.9-5.5 | 35 | 12.2k |

- The cathedral's hall alone is 27.7k triangles; each person adds about 870. The congregation is capped at 30 and wedding guests at 26 so a full church stays under 60k. A wedding measured before the cap: 34 people, 60.3k.

## Pictures (`data/shots/`)
- Cathedral: `m6l_cath_nave`, `m6l_cath_mass`, `m6l_cath_highmass`, `m6l_cath_highmass_front`, `m6l_cath_highmass_altar`, `m6l_cath_altar`, `m6l_cath_elevation`, `m6l_cath_pulpit`, `m6l_cath_lady_altar`, `m6l_cath_confessional`, `m6l_cath_wedding`, `m6l_cath_wedding_guests`.
- Town hall: `m6l_th_stair`, `m6l_th_office`, `m6l_th_wedding_hall`, `m6l_th_civil_wedding`, `m6l_th_civil_wedding2`.
- Vleeshuis: `m6l_vh_cellar`, `m6l_vh_cellar2`, `m6l_vh_cellarmen`, `m6l_vh_theatre`, `m6l_vh_studio`.
- Steen: `m6l_st_hall`, `m6l_st_visitors`, `m6l_st_arms`, `m6l_st_cell`.
- Oostershuis: `m6l_oh_hall`, `m6l_oh_stacks`, `m6l_oh_porters`.
- Some early pictures were taken before the lighting was tuned: `m6l_cath_elevation`, `m6l_th_stair`, `m6l_vh_cellar`, `m6l_oh_hall`. Bubbles, captions and the confession panel are HTML and do not show in the pictures.

## Files
- New:
  - `shared/landmarks.ts`;
  - `server/src/landmarks/{town,life,confession,deeds,routes}.ts`, `server/test/landmarks.test.ts`;
  - `client/src/world/{landmarkKit,landmarkRooms,landmarkHalls}.ts`, `client/src/game/landmarks.ts`, `landmarks.css`, `client/src/net/landmarksApi.ts`, `client/src/audio/organ.ts`;
  - `data/vite-test-landmarks.config.mjs`.
- Small edits:
  - server: `config.ts` (the share); `db.ts` (the migration on open and after a new game); `index.ts` (mount); `town/places.ts` (11 trades);
  - client: `main.ts` (wiring, the path check, dev); `game/interiors.ts` (the "landmark" room kind, its keys hook, busy seats, leaving by another door, a room's own floor, pace and eye, the seat's height); `world/rooms.ts` (the Room fields); `player/firstPerson.ts` (ride walking's pace, eye and step sound); `audio/soundscape.ts` (the hall echo, the organ and the bell, `setInterior` taking a hall name).

## Needed from main or other helpers
- **The bride's veil inside.** The couple inside wear their own clothes, because the wedding looks are in `wardrobe.ts`, which another helper owns. A small export there would let the landmarks dress a person by lead role, for example `dressLead(human, role)`.
- **The civil wedding before the church (the director).** M4 casts the bride and groom when the event starts, so the town hall cannot marry that couple an hour earlier. If `leads.ts` cast the couple when the wedding is planned, or exposed a function for it, the town hall would hold their civil wedding before the church; `life.ts` only needs to read `leads_json`. Today the register records the M4 couple as married at the town hall that morning.
- The morning sheet and `CLAUDE.md`'s Status line are main's.

## Problems and open points
- **The real save was migrated by the running dev server.** The main dev server (8787, `node --watch`) restarted when `db.ts` changed and ran the migration on `data/game.sqlite`. It added the 19 newcomers and the landmark places in place, which is additive: the same migration was checked on a copy to change nothing else. I did not write to it myself.
- **No civil weddings in the current save.** That town has only one unmarried woman of age, and she married in the M4 wedding, so no civil wedding comes up there. A fresh town has about two a week, and then its free pairs run out.
- **A few people can be seen twice.** Staff who also have a post in the street (the town's own priest, the sexton, whom the job board employs at the door) stand inside at the big services. A civil groom may still be drawn at his work outside that hour.
- **Upstairs people do not climb.** They appear in their places and are gone when they leave.
- The painter's canvases show their backs from the studio door. The pulpit and the confessionals read mostly as dark shapes.
- Seats Jef may take: the chair at each row's end in the cathedral, the callers' bench and two wedding-hall chairs, and the theatre benches at the middle aisle.
- Not browser-checked: the Sunday evening performance with its audience, vespers, and the organist's weekday practice. The engine tests cover them.

## Rerun
    npm test
    SCHELDEMIST_DB=data/test-landmarks.sqlite SCHELDEMIST_PORT=8911 node server/src/index.ts
    npx vite --config data/vite-test-landmarks.config.mjs   (from client/)

Take the test save as a `.backup()` of `data/game.sqlite`. The test saves and the probe files were deleted after the checks.
