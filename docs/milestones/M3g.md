# M3g - Goods train, cranes at work, horse omnibus (2026-09-23, in progress)

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
- `server/src/ride.ts` (new): fare **5 c** (`RIDE_FARE_C`), a ticket good for **16 game hours**
  (`RIDE_MAX_HOURS`; once round is about 12 at the game's clock), stops checked against a fixed list.
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

## Checks
(filled in below as they are done)
