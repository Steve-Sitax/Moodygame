# M3g - Goods train, cranes at work, horse omnibus (2026-09-23, built, not yet committed)

Steve asked: a freight train on the quay railway that stops at the cranes, the cranes taking goods from the
ships or the quay into the wagons (or out of them); and a tram along the quays you can ride, if that is right
for 1873, else a hop-on hop-off horse wagon: faster than walking, less hungry, warmer.

## Research: what is right for autumn 1873

**How wagons moved on the quay lines.** The railway reached Antwerp's old docks in 1873: line 12B left the new
goods station Schijnpoort, served the Dokken en Stapelplaatsen goods station (built 1873-74) and branched to the
docks of the old port, opened together with the eastern ring line 12. The straight Scheldt quays with their
lines of rails and hydraulic cranes came later (built 1877-1885: a line of rails for the cranes, which put the
cargo straight into railway trucks, and a second line for the trucks). On quay and dock lines of this time,
wagons were moved one or a few at a time by horses, and by men with pinch bars; small shunting engines were
the exception on quays (sharp curves, timber sheds, fire). A Belgian example: the dock line from Gent-Zuid to
the Stapelhuis on the Handelsdok (1856-57) was worked by horses for its first years, by a locomotive from
June 1861. Antwerp's nations (naties) kept heavy draught horses for the port work ("natiepaarden").
I found no source that says in so many words who pulled the wagons on the Antwerp quays in 1873; horses are
the safe and likely answer.
**Chosen:** two heavy horses in tandem between the rails, a shunter at their heads, five wagons.

**The first Antwerp horse tram.** Sunday 25 May 1873, from the church of Berchem to the Meir, with three cars
(5,000 passengers on its first Sunday, 1 June 1873). More lines followed in 1873: Turnhoutsepoort to the
St. Jacobsstraat (July), the Berchem line on from the Meir to the St. Paulusplaats (20 July), and the line of
the Leien from the Koninklijk Stapelhuis to the Anselmostraat (25 August). So Steve's "about 1873" is right,
but those trams ran in the town and along the boulevards, not along the river quays. The harbour tram company
(S.A. des Tramways Maritimes d'Anvers) was founded in 1880 and opened its first line in 1881 (Pothoek to the
Falconplein); lines along the Brouwersvliet and the Scheldt quays were asked for after that.
**A tram along the quays is about eight years too early.**

**The closest correct thing.** Horse omnibuses: Antwerp had them from the 1830s (in 1838 twelve omnibus
services ran between the station and the town; they raced from the harbour to the station). **Chosen:** a
pair-horse omnibus with a driver on the box and a conductor on the back platform, going round the quays on
the cobbles, no rails, stops marked by a post with a board.

Sources:
- Paarden in Antwerpen in de 19e eeuw (PCVO Antwerpen paper, after E. Keutgens, *Honderd jaar tramexploitatie
  in Antwerpen en randgemeenten 1873-1973*): https://schipperskwartier.gilbertus.com/pdf/010.pdf
- Antwerpse tram: https://nl.wikipedia.org/wiki/Antwerpse_tram ; Antwerp tramway network:
  https://en.wikipedia.org/wiki/Antwerp_tramway_network ; horse tram lines: https://www.kusee.nl/tram/51-horse-antwerpen.php
- Spoorlijn 12B: https://nl.wikipedia.org/wiki/Spoorlijn_12B
- Gent-Zuid to Stapelhuis, horses then a locomotive: https://sites.google.com/view/belgischespoorlijnen/spoorlijnen/notities
- The new Scheldt quays, Scientific American Supplement, 26 July 1884: https://www.gutenberg.org/cache/epub/9266/pg9266-images.html

## What is built

### The goods train (`client/src/world/railway.ts`, new)
- Runs the line of `tools/city/design.py` DECOR "tracks" (smoothLine): out of the Werf store (off the map to
  the west), east along the river quays under the portal cranes, over the vliet and canal swing bridges and the
  lock bridge, round the Petit Bassin, back along the Rijnkaai and the Werf into the store. 1,403 m; then it
  waits 30-90 s in the store and comes out again.
- Two horses in tandem (the dray horse of props.glb, `world/horses.ts`), a shunter walking at their heads,
  five code-built wagons: open wagon with sacks, flat wagon with casks, open wagon with bales, flat wagon
  with crates, a covered van. Every axle follows the curve (the body is the chord between its two axles),
  spoked wheels turn, buffers and coupling chains stretch and swing on the bends, traces from the rear horse.
- At about 7 of the 10 portal cranes a trip (random), on one of the crane's passes: as the train comes up, the
  crane works out which row of the wagon to fill or empty, the train shunts so that row stands under the
  hook's circle (the hook is 11.5 m from the slewing axis; no luffing), and the crane does two lifts:
  from the moored hold (the hook goes down into it) into the wagon, or from a well-filled wagon back into
  the ship. A crane with no hull under its reach works a pile on the quay instead (none today: all ten found
  a hull). Idle cranes swing slowly about their rest.
- The cranes' own hook, falls and sling in boats.glb hang at a fixed height; they are folded away (vertices
  at the jib head below its underside) and drawn here: hoist rope, hook block, four-leg sling, the load.
- Stops for the player on the line (8 m short), for anything on the rails ahead (samples free when the
  railway was made), and 8 m short of an opening bridge that is not shut (an open swing bridge lies on the
  quay over the rails). A bridge does not open while the train is within 10 m of it or on it:
  `bridges.ts` option `busy` and the lock's `occupied`.
- The Petit Bassin handcart lane (traffic.ts `bassin_south`) ran along the rail band at z 116: moved to
  z 119.5, so the handcart and the train cannot meet head-on.

### The omnibus (`client/src/world/omnibus.ts`, new; riding: `client/src/game/ride.ts`, new)
- A round of 841 m: the Werf -> the Steenplein -> the Vismarkt -> over the canal bridge -> the Rijnkaai ->
  the Petit Bassin -> back along the Rijnkaai (inland) -> the Vismarkt -> the Steenplein -> round behind the
  Werf. Six stops with a post and board (the Vismarkt and the Steenplein are served both ways): eight calls
  a round. Trots at 3.2 m/s (11 km/h), slows on bends and bridges, stands 7 s at each stop.
- Stops for the player in its way, for anything on its lane, 8 m short of an opening bridge; follows the
  Werf dray when it catches it up. dressCity and the street life keep their props off its lane.
- Code-built: green and cream body, route board ("WERF · STEENPLEIN · VISMARKT · RIJNKAAI · PETIT BASSIN"),
  roof seat, back platform with a step, driver's box, big spoked back wheels, a front carriage that turns
  with the pole; two horses abreast (trot); a driver sitting on the box, a conductor on the platform.

### Riding
- At a stop, while the omnibus waits, stand at the step behind the back platform: **E get on the omnibus
  (5 c)**. The server takes the fare. You stand on the back platform and look round with the mouse; the view
  turns with the omnibus; walking is off. The conductor calls each stop; the note says "Next stop: ..." as it
  leaves. At a stop: **E get off at ...** You step down behind the platform (or beside it).
- Not with job goods in your arms ("No goods on the omnibus").
- Player mode: `firstPerson.ts` `rideStart / rideEnd / updateRide`, a generic "carried" mode.

### Server (engine numbers)
- `server/src/ride.ts` (new): fare **5 c** (`RIDE_FARE_C`), a ticket good for **20 game hours**
  (`RIDE_MAX_HOURS`: once round the line; Werf to Petit Bassin takes about 9.5 at the game's clock), stops checked against a fixed list.
  `POST /api/ride {action: "board" | "alight", stop}`; the payload has `ride: {on, fare_c}`.
- `day.ts applyHour`: on board, warmth -1 every **10 h by day** (on foot 5) and every **6 h at night**
  (on foot 3). Food as on foot: a ride costs no extra food; the time it saves is time you are not hungry in.
  The night ends a ride. The clock is untouched (a tick is 15 minutes, riding or not).
- Tests: `server/test/ride.test.ts` (fare once, no money no ride, bad stops, ticket runs out, night, warmth
  by day and night, food, clamps, clock).

### Sound (no new files)
- The train's horses and the omnibus go into `setVehicles` as drays (hooves and wheels).
- `soundscape.railClack(x, z)`: a knock and a ring at every rail joint under a wheel (made in code).
- The cranes call `soundscape.craneWork` (ratchet or winch, chain) when they start to hoist.

## Checks (on a copy of the save: test server 8797, vite 5183; never Steve's save)
- Train: runs the whole line; at the Petit Bassin crane (173, 66) it shunts a row under the hook, the crane
  swings to the moored hull, lowers into the hold, lifts two casks one by one and sets them in the flat wagon
  (slots 000000 -> 001100), then the train goes on. On the Rijnkaai crane (-12, 4) it loaded casks from the
  wagon into the Anna Maria. Wagons bend round the 10 m corners with each axle on the curve.
- Stops 8.7 m short of the player standing on the rails on the Werf; goes on when he steps off.
- Canal bridge opened for a boat: the train waited short of it. With the train at the bridge, the bridge
  stayed shut until the last wagon was over, then opened for the waiting boat.
- Omnibus: a whole round in 395 s (Werf 7 s, Steenplein 80, Vismarkt 111, Rijnkaai 166, Petit Bassin 196,
  Rijnkaai 232, Vismarkt 286, Steenplein 318, Werf 395), about 50 s of it behind the Werf dray.
  Werf to Petit Bassin 189 s; on foot the same way is about 250 s.
- Riding: E at the step showed "get on the omnibus (5 c)"; money 46 -> 41 on the server; the view rode the
  back platform over the canal bridge; "Next stop: the Rijnkaai." as it left; "The conductor calls out: the
  Rijnkaai."; E "get off at the Rijnkaai"; stepped down on free ground; the server's ride ended.
- Needs, live on the test server: board at 14:45, tick to 15:00: warmth 6 stays 6; on foot the same tick:
  6 -> 5. A bad stop name, a bad action and 3 c in the pocket were all refused.
- Path check `__scheldemist.paths()`: [] with the train in the store, and [] with the train working on the
  narrow west quay of the Petit Bassin and the omnibus at its stops.
- Frame cost (Rijnkaai view, both in sight): draw calls 357 -> 376-380, triangles +18k, render time within
  the noise (3.9 vs 4.1 ms); the two updates together 0.10 ms a frame. Empty goods meshes are not drawn.
- `cd client && npx tsc --noEmit`, `cd server && npx vitest run` (ride tests included), `npm run build`: pass.
- Pictures: `data/shots/m3g_*.jpg` (dock crane at work, hook lowering a cask, the train on a curve, the
  train in fog under a crane, the omnibus at the Vismarkt stop from the side and from behind, the view from
  the platform, a map of the lanes `m3g_map.png`).

## Open points
- Job spots on or at the rails: `werf_pontoon` (-249, 4) lies on the track and stacks along it;
  `crane_foot` (-21, 5.2), `ship_gangway` (-42, 5.6), `werf_quay` (-295, 6) and `bassin_south` (120, 117)
  lie at the edge of the rail band. Goods put there stop the train (it waits for anything on the rails)
  until they are carried off. Suggest moving these spots 2-3 m off the line in `shared/spots.json`.
- Walking townspeople are not colliders, so the vehicles do not see them. Both have an optional
  `people` hook for it (`world.railway().people = () => [...]`, the same for `world.omnibus()`); the crowd
  and the town need a list of positions to feed it.
- The rails run into the Werf store at x -318..-340 through its wall: a goods door there would look right.
- Night: no lamps on the omnibus (the scene's lamp count is fixed); it shows only by the gas lamps.

## M3g part 2: the omnibus network and the railway gate (2026-09-23)

Steve: "so we can take the horse omnibus through town also", "several omnibuses can do different routes",
the omnibus "has no lamps", and "the goods train clips out of a building: make nice opening gates".

### Two lines (`client/src/world/omnibus.ts`, now a network)
| Line | Board, colour | Omnibuses | Stops | Round |
|---|---|---|---|---|
| Quay line | KAAIEN, green | 1 | the Werf, the Steenplein, the Vismarkt, the Rijnkaai, the Petit Bassin, the Rijnkaai (back), the Vismarkt, the Steenplein | 841 m, 386 s (19 game hours) |
| Grote Markt line | GROTE MARKT, red | 2, about 172 s apart | the Vismarkt, the Vleeshuis, the Grote Markt (by the town hall), the Cathedral (Handschoenmarkt), the road to the Meir, the Brouwersvliet | 866 m, 349 s (17.5 game hours) |

- The town line is a one-way ring with no crossings, laid out on the walk map: at least 2.0 m from the lane's
  middle to any wall all round, every corner rounded (5 m). In two-way stretches it keeps its own lane: the
  canal quay (south x -89.5, north x -84.5), the wide street west of the Vleeshuis (x -149, x -145), the street
  into the Handschoenmarkt (west z 126.2, east z 129.8). A gas lamp at (-230, 128) stands between those two
  lanes, 0.6 m clear of each body. The ring goes round the Grote Markt stalls and leaves the square before the
  cathedral's west portal free (the lane passes 19 m from the portal).
- The Grote Markt's only wide way in is the street from the east (z 124-132); the north-west gap by the town
  hall is 4 m. The Meir street (x -150..-140, z 212-300) is a dead end at the map's edge, too narrow to turn a
  pair-horse omnibus: the stop "the road to the Meir" is at its mouth.
- The lines meet at the Vismarkt: two bays, 25 m apart (the quay bay at (-112, 8.3), the town bay at (-96, 31)).
- Omnibuses of one line follow: one that catches up waits behind the other, at a stop too.
- Every stop post has a plate in the colour of each line that calls there. Destination boards front and back,
  the stops on the side boards.
- Two carriage lamps per omnibus: dark glass by day, a warm flame and a glow after dusk (they follow the gas lamps).
- All omnibuses share one InstancedMesh per part (body, paint in the line colour, back wheels, front carriage,
  front wheels), one mesh for all boards, one for the lamp glass, one point set for the glow, one for the posts.
- Quay furniture now keeps off the omnibus lanes (its `avoid` list in rijnkaai.ts): two of its things stood on
  the lanes (by the vliet bridge and on the canal quay) and stopped the omnibuses.

### Fares and changes (`server/src/ride.ts`)
- One fare (5 c) buys a ticket good for 20 game hours from the moment you pay, with **one free change**: get
  off, and get on the other line while the ticket runs. Getting back on the same line, or a second change,
  is a new fare. Stop and line names are checked; the line must call at the stop.
- `POST /api/ride {action, stop, line}`; the payload has `ride: {on, fare_c, change}`. The prompt says
  "get on the GROTE MARKT omnibus (a free change)" when a change is free.
- Warmth on board as before (every 10 h by day, 6 h at night; on foot 5 and 3). Tests: 12 in `ride.test.ts`.

### The railway gate (`client/src/world/railgate.ts`, new)
- A gatehouse of the State Railways ("STAATSSPOORWEGEN") against the Werf store's east wall (x -318..-311,
  z 1.3..9.1): brick, stone plinth, piers, lintel with a keystone, cornice, a slate roof, a keeper's lodge
  with a window and a door, a hand bell on a bracket. Two timber leaves (dark green oak, Z braces, iron strap
  hinges) swing out to just past square.
- Belgium abolished its town tolls (octrois) in 1860: in 1873 this is a railway goods-shed door, not a customs gate.
- The train asks for the gate as it comes up (out of the store, or back along the Werf), waits till the
  leaves stand open, and they shut behind the last wagon; the keeper rings his bell (`soundscape.gateBell`,
  the bridge-keeper's hand bell recording). Behind the leaves a short covered way ends in the dark; anything
  wholly behind it is not drawn, so the train never appears or vanishes.
- One solid collider for the whole gatehouse, opening and all (walking into the open gate stops at the
  facade); the open leaves are solid too, and they do not move while the player stands in their sweep. The
  crowd and the drays keep out (solids, isFree). A crane never picks a wagon row under the gatehouse roof.
- The omnibuses never leave the map (both lines are closed loops).

### Checks (test save only)
- 800 s of both lines with the train and the drays: no stall; arrivals as in the table.
- Change: quay line from the Steenplein to the Vismarkt (5 c), off; "The conductor calls out: the Vismarkt.
  Change here for the Grote Markt line."; the town omnibus offered "a free change"; on it; money 40 -> 35.
- Gate: opens while the train is still in the store (it rolls out without stopping); on the way back it
  opens as the train comes up and shuts after the last wagon. The player walking into the open gate stops
  at the facade (x -310.3).
- Path check `[]` with three omnibuses about, and with the gate open and the train coming out.
- Cost at the Vismarkt with two omnibuses in view: 151 -> 163 draw calls (horses and people included),
  about +0.2 ms a frame (median of four), updates 0.05 ms.
- Pictures: `data/shots/m3g_town_grote_markt.jpg`, `m3g_town_cathedral.jpg`, `m3g_night_lamps.jpg`,
  `m3g_post_vismarkt.jpg`, `m3g_perf_vismarkt.jpg`, `m3g_gate_shut.jpg`, `m3g_gate_open_train.jpg`,
  `m3g_gate_front.jpg`, `m3g_town_clear.png` (street clearance map).

## M3g part 3: travelling cranes and a climbable ladder (2026-09-23)

Steve: "big cranes can and should be able to move from boat to boat if their track allows. make the ladder climbable".

### Travelling cranes (`client/src/world/railway.ts`)
- Each portal crane runs on its runway (DECOR `crane_rails`, 5.2 m gauge): the Werf (x -304.5..-225.2; kept 6.5 m clear
  of the railway gatehouse), the Rijnkaai (x -32.8..66.8), the Petit Bassin west (z 53.2..100.8) and east (z 53.2..104.8).
- Berths: places along the runway with a moored hold under the hook (jib no more than 0.45 rad off rest), found
  once from the hull footprints; a stretch of moored boats gives a berth about every 9 m (3 to 8 per crane).
- At a berth it works (the train's lifts, or its slow idle swing); after 25-60 s it moves on to another berth
  between its neighbours: jib swung in along the runway, hook up, the driver's bell (`onCraneTravel`, the hand
  bell), then 0.42 m/s, easing in and out; bogie wheels turn (the model's own wheels and rail stubs folded away,
  drawn per crane in one InstancedMesh); jib out over the new hold.
- Never within 12 m of another crane on its runway (its targets lie between the neighbours' held stretches, and
  it stops if one is closer ahead). It stops for the player, for people (the crowd's positions) and for anything
  on its bogies' line; spots the walk map already closed when the runway was surveyed (a quay wall a hand off)
  do not count. Held up 15 s, it works the boat it has come to.
- Leg colliders move with it (four rects per crane in place, part of the railway's colliders). The static crane
  colliders in rijnkaai.ts are gone.
- The train and a crane agree on the spot: when the train comes up (70 m ahead) it takes the crane where it
  stands or is going (a crane about to set off stays), and the crane stays there till the last lift.
- Kept clear: the quay furniture's avoid list has the runways; the sputtering gas lamp on the Rijnkaai moved
  from z 1.6 (on the runway) to 2.2; the omnibus post at the Rijnkaai moved inland to (30, 10.4).

### The ladder (`client/src/game/craneclimb.ts`, `firstPerson.ts` climbLadder*)
- The iron ladder up the portal leg (the model's, crane frame x 1.35..1.75, z -2.95) leads to the machinery deck
  behind the cabin (6.42 m, railed round in the model). At the foot the crane stands still and swings its jib to
  rest; then **E climb the crane's ladder** (or walk into the rungs). **W** up, **S** down, you face the rungs and
  can look about a little; at the top you step onto the deck (3.0 x 1.2 m, walkable with a rail all round:
  `rijnkaai.ts` raised decks). **E climb down the ladder** at the head. Not with goods in your arms.
- While you stand at the foot, climb or are up there, the crane neither travels nor slews, and the train does
  not plan a stop at it.
- The east cranes of the Petit Bassin have their ladder side against the Entrepot wall: no room at the foot, so
  no climbing there.
- Other ladders: the iron ladders in the quay walls are for climbing out of the water only (push into one or E);
  from the top you cannot climb down one (walking off the edge drops you in). There is no hold ladder on any ship.

### Checks (test save only)
- 600 s of all ten cranes: each made 1-8 trips; the closest two cranes on one runway came was 12.0 m.
- The train stopped at a Rijnkaai crane standing at a new berth (x -32.8) and loaded; the next crane waited reserved.
- Climb at the Werf crane: 0 to 6.42 m in about 13 s, stepped onto the deck, walked it: the rail held on all four
  sides (x -281.34..-278.84, z 5.58..6.5); E at the head, S down to the ground; the crane went back to work.
- Path check: the only entry is "boat hire at the Werf steps" (a new point from the rowing work): the Werf flight's
  top at (-320, 0) is more than 2.2 m from any open ground, with or without the railway gatehouse (checked by
  lifting its collider). Everything else reached.
- Cost: +1 draw call (the crane wheels); the railway's update rose from about 0.1 to 0.16 ms a frame (world.update
  0.37 vs 0.20 ms without the railway); frame time within noise (median 4.46 vs 4.36 ms, Rijnkaai view).
- Pictures: `data/shots/m3g_crane_travel.jpg`, `m3g_crane_wheels.jpg`, `m3g_ladder_climb.jpg`,
  `m3g_deck_view_quay.jpg`, `m3g_deck_view_river.jpg`.
