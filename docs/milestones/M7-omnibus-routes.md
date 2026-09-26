# M7 omnibus routes: more of the town by omnibus, 2026-09-26

Steve (2026-09-26, carte blanche): "Investigate omnibus routes, if we can cover more of town."
Built by a helper; not committed (the lead commits).

## What there was
Two lines, three omnibuses, all in the south-west third of the map: the quay line (green, the Werf to
the Petit Bassin and back, 841 m) and the Grote Markt ring (red, the Vismarkt, Vleeshuis, Grote Markt,
Handschoenmarkt, the Meir's mouth, the Brouwersvliet, 866 m). Nothing reached the gates, the park,
Sint-Jacob, Sint-Paulus, the angled streets or the wall, and the buses ran at any hour with no
timetable.

## Research (reference only)
Antwerp's first horse tram ran from 25 May 1873 from the Meir out to Berchem (the line of today's
tram 7); plans for a "tramway américain" went back to 1865, the council agreed in 1871. By 1900 nine
companies ran horse trams and one an omnibus line (Grote Markt to Zurenborg); the Tramways du Nord ran
from the Paardenmarkt to Merksem from 1879. We found no fares or headways for 1873. The game keeps
omnibuses (no rails) and one flat fare. Sources: nl.wikipedia.org/wiki/Antwerpse_tram ;
en.wikipedia.org/wiki/Antwerp_tramway_network ; kusee.nl/tram/51-horse-antwerpen.php ;
nvbs-actueel.com/2023-06-juni/150-jaar-tram-in-antwerpen/ .

## The network now (`shared/omnibusLines.ts`, new: one place for rounds, stops and timetable)
| Line | Colour, omnibuses | Round | Stops (terminus first) |
|---|---|---|---|
| KAAIEN | green, 1 | 841 m, as before | Werf, Steenplein, Vismarkt, Rijnkaai, Petit Bassin, Rijnkaai (back) |
| GROTE MARKT | red, 3 (was 2) | 1239 m | Vismarkt, Vleeshuis, Grote Markt, **Sint-Jorispoort**, **Stadspark**, Cathedral, road to the Meir, Brouwersvliet |
| KEIZERSPOORT (new) | blue, 2 | 717 m | **Keizerspoort**, **Sint-Paulus**, **Keizerstraat**, **Conscienceplein**, road to the Meir, **Sint-Jacob**, **Kipdorppoort**, **Ramparts** |

Picture of the old and new rounds, made by `python tools/city/omnibus_map.py` (new):
`data/shots/ob_routes_map.png` (dashed: before; coloured: now, arrows the way they run).

- Red, new part: from the Grote Markt out along the Handschoenmarkt's west end, down the gate road
  (z 150) to the Sint-Jorispoort, along the wall street (x -356 to -361), through the lane at z 247 and
  back along the cathedral's south side (x -304.5) past the Stadspark's corner. Where it runs a street
  both ways it keeps right on two lanes (Handschoenmarkt out z 132 / back z 139; the street south of the
  cathedral out x -307.8 / back x -304.5, 3.3 m apart); no crossing of its own path.
- Blue: the Meir (x -145, the same lane and way as red from z 158 to 208.5, one shared bay "the road to
  the Meir", one post), the wall street at z 344-349 (the Kipdorppoort and Keizerspoort gate houses and
  the wall's stairs 2 m or more off the body), the Keizerstraat (the long angled street) down to the
  canal, the high canal bridge (it waits while the bridge is open, as the others do), the lane to the
  Conscienceplein, into the Meir.
- Changes, free on one ticket as before: the Vismarkt (green and red) and the road to the Meir (red and
  blue).
- Not reached, and why: **Rode Poort** (the Bassin's quays carry the rails and the Eilandje dray, the
  only link from the Hanseatic side is a one-lane bend at x 58 z 156-170, and the north and east wall
  streets do not join at the NE bastion); the **Stadspark** itself (a railing all round, the wall
  street beside it is cut at x -290): the stop is 45 m from its west corner. The new round square
  (Sint-Jansplein, 20, 296) and the Lijnwaadmarkt (-213, 180) of the places helper lie 40 m and more
  from any lane; the prison's door (-358, 199) is on the wall street, 2 m beside the red lane.

## How the lanes were found and checked
A scratch planner on the walk map (clearance from every wall and every fixed solid dumped from the
game, the stairs' flights added, everything outside the wall's inner line blocked) routed candidate
rounds; corners were then tuned so the whole rig (tail to dashboard 1.0 m each side at the wheels, the
pair of horses) keeps 0.5 m or more off every wall and 0.25 m off every fixed thing, also in the turns.
In the game: `__scheldemist.world.omnibus().sweep()` (new) drives every round with the whole rig
against `isFree`; it lists only the old spot at x -90 z 98 on the canal quay (known since M7 quays).

## Stops
Every post has its name on the sign (both faces) and a timetable plate on the lane side (each line,
how often, the first and the last omnibus there); posts and benches are 2.8 m or more from any house
door and off every lane. 19 of the 21 posts have a park bench (cast-iron ends, slats; a solid,
`omnibus.ts stopSolids`); Sint-Paulus and the Keizerstraat have no room. People wait at the stops
near Jef by day (0 to 3, the same all hour; none before the first omnibus or late at night): one
sits on the bench, the others stand by the post; when an omnibus of a line that calls there stops,
they walk to its step and get on (it waits for them). E at a post: **read the timetable** (the
server tells it by the game clock).

## Timetable and fares (the engine's numbers, `shared/omnibusLines.ts`, used by client and server)
- Each line leaves its terminus from 6:00 to 22:00, one omnibus each headway: quay line every 205 min
  (one omnibus), Grote Markt every 95 min, Keizerspoort every 90 min (game minutes; a round is
  about 3 to 5 game hours at the M7 clock). The planned round (2.5 m/s and 9 s a stop) is a little
  slower than the omnibuses really go, so they wait a few minutes at the terminus.
- An omnibus at its terminus takes the line's next free departure (never one another took, never
  more than half a headway late) and waits; after the last one it stands there till 6:00 ("stands
  here for the night"; E at its step: the conductor says when). Omnibuses of a line queue behind each
  other (a queue is not a hold-up: no backing off); on the Meir a blue waits behind a red.
- Server (`ride.ts`): the lines and stop names come from the shared file; boarding outside the service
  hours is refused ("the first is due here at 6:00"); `POST /api/ride {action: "timetable", stop}`.
  The fare stays 5 c with one free change; residents ride free (M6).
- Residents (`journeys.ts busWait`) never count on an omnibus before the timetable's next one there.

## Small edits outside my files (marked "M7 omnibus routes")
- `client/src/main.ts`: the omnibuses' clock and eye hooks (frame and the kit's `step`).
- `client/src/world/rijnkaai.ts`: the benches' solids; the omnibuses also move in the kit's `step()`
  (no camera), so `t.run()` rides them. Before this `t.run` never moved an omnibus.
- `client/src/game/ride.ts`: read the timetable at a post; laid up for the night.
- `client/src/game/journeys.ts`: the timetable in the residents' wait.
- `client/src/net/api.ts`: the timetable action. `server/src/index.ts`: the route.
- `server/src/town/possessions.ts`: LANES read the shared rounds (parked carts and velocipedes of a new
  town keep off the new lanes; Steve's save: none of its 29 vehicle spots lies on a new lane).
- `server/src/town/lively.ts`: the English travellers' last sight stood in the red lane on the
  cathedral's south side (-305.5, 204); now on the kerb (-301.6, 204). `fixSights` moves it in place
  in older saves (only that stop of their round).

## Checks (test stack "bus", server 8954, vite 5354)
- Rode the whole Keizerspoort round end to end with Jef on the back platform (t.run): Sint-Paulus,
  Keizerstraat, Conscienceplein, Meir, Sint-Jacob, Kipdorppoort, Ramparts, Keizerspoort (queued behind
  the other blue omnibus at 13:30, then its own 15:00 departure), Sint-Paulus; off at the Keizerstraat.
  Fare 50 -> 45 c. Jef stayed on the platform (0.05 m), no backing off, no hold-up.
- Rode the Grote Markt line from the Vleeshuis through the Grote Markt, Sint-Jorispoort, Stadspark,
  Cathedral, Meir, Brouwersvliet to the Vismarkt (a free change from the blue ticket; the conductor put
  Jef off at the Vismarkt when that ticket ran out, as the rules say).
- `paths()`: [] with the new stops before the places helper's walk map change; after it, 9 entries, all
  at their new back-of-town court at (-30, 130), 50 m from any stop or lane (theirs).
- `routeClips()`: the same as before (the omnibus at x -90 z 98, three on the Eilandje dray loop).
- Night: at 23:00 the omnibuses finish their round and stand at the terminus till 6:00; boarding is
  refused with the first time; the plate and E give "next at 6:00, 7:30, 9:00".
- Server tests: new `server/test/omnibusRoutes.test.ts` (8) and `ride.test.ts` pass. The full run had
  failures in transport, lively (older save: lamplighter count), population, backtown and gifts tests,
  from other helpers' work in progress (the transport one fails with my change taken out as well).
- Build: my files typecheck and `vite build` bundles; `npm run build` stops on other helpers' errors
  in `client/src/world/alive/*`.
- Frame cost: `omnibus.update` 0.23 ms a frame with six omnibuses; at the Meir with two in view 16.0
  ms a frame and 1129 draw calls, the same as with them away (all parts instanced).
- Pictures (`data/shots/ob_*`): the Keizerspoort stop and the queue in the gate's mouth from above
  (`ob_keizerspoort_turn_above`), the stop with its post, bench and people waiting
  (`ob_keizerspoort_post2`, `ob_sign_close`, `ob_bench_close`), along the wall street
  (`ob_keizerspoort_turn`), the red omnibus turning into the gate road (`ob_sw_turn_above`), the
  Sint-Jorispoort stop (`ob_jorispoort_stop`, `ob_jorispoort_mist`), the cathedral's south side
  (`ob_stadspark_stop`, `_mist`), red and blue queued at the Meir (`ob_meir_two_lines`), blue on the
  high canal bridge (`ob_bridge_blue`).

## Not yet
- The timetable plate is small: at PS1 resolution it reads only close up; E at the post tells it.
- Waiting people are nameless (like the old nameless passengers); townspeople's own rides are M6's.
- The kit's `t.run` moves the client only: the game clock follows the server in real time, so a
  terminus wait in a test needs `t.skip()`.
- During the checks `landmarks.update` and `interiors.update` threw in the test tab (other helpers'
  work in progress); they were wrapped in the tab to go on.
