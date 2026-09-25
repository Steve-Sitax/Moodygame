# M6 - Tides (2026-09-24)

Steve, 2026-09-24: "implement your 10 suggestions". This one: "Tides. The Schelde at Antwerp rises and
falls about 4 m twice a day. Ships sit high or low at the quay, and the stairs go under water."

Not committed yet: the main session checks it in the browser and commits it.

## Research
| Fact | Value we use | Source |
|---|---|---|
| Mean tidal range at Antwerp, 1871-80 | 4.31 m (mean high water +4.80 m NKD, mean low water +0.31 m) | I. Coen, *De eeuwige Schelde?*, Waterbouwkundig Laboratorium 2008, table p. 56. Today it is about 5.2 m. |
| Length of a tide | 12 h 25 min | Coen p. 11; scheldeschorren.be "Het getij in de Westerschelde en Zeeschelde" |
| Springs and neaps | today +12 % and -15 % of the mean range; we use +-11.5 % on 1873: springs 4.8 m, neaps 3.8 m | Coen p. 11 (today's spring and neap levels at Antwerp) |
| Flood shorter than ebb | rise 5.5 h, fall 6.9 h | our assumption: the flood is shorter than the ebb at Antwerp today (about 5 h 20 against 7 h); no 1873 figure found |
| Old quays flooding | only in storm surges, not at ordinary springs. The surge of 31 January 1877 reached +6.90 m NKD at the Bonaparte lock, about 2.1 m over mean high water | Coen, table of storm levels p. 61 |
| Ships at the old quays | lay in the mud at low water | nl.wikipedia "Scheldekaaien" |
| The vlieten | tidal inner harbours; lighters and boats in them sank into the mud at low water | nl.wikipedia "Antwerpse vlieten" |

## What we chose
- **Levels** (quay top y 0, `world/tide.ts`): half tide -2.8 (the old WATER_Y). Mean high water -0.65,
  spring high water -0.40 (0.4 m under the edge stones), mean low water -4.95, spring low water -5.20.
- **Clock**: `tideAt(day, hour)` from the server's game clock (day 1 = Monday). High water on Monday
  at 9:36, springs peak on Tuesday morning; over the week the range falls toward neaps. Same after a
  reload. The water eases to a new level in a few seconds after a jump of the clock (sleep, Dev menu).
- **The Petit Bassin**: a closed dock at -0.7, just under mean high water, as the docks were kept.
- **The lock** (`world/lock.ts`): now really works. The two pairs of gates open on their own.
  A rowing boat is locked through: the keeper shuts the far pair, lets the water in or out through
  the sluices (0.25 m/s) till the chamber is at the boat's level, opens the near pair; once the boat
  is in, the other way round. The lock's own traffic is locked through the same way at any tide.
  Fix 2026-09-25 (Steve: "Do not send bigger boats or combinations through a lock, so they never need
  to wait until high tide"): the old tows (a tug with a lighter or a Rhine barge on a 9 m line, 48 to
  66 m) did not fit the chamber and waited off the gates for high water, sometimes for minutes. Now
  only a vessel or tow that fits the chamber with room to spare is sent (`shared/lockfit.ts`: 1 m free
  at each end, clear of the river gates' swing, 0.6 m each side of the open leaves; about 27 to 28 m
  for the beams we have): a tug running light, a paddle tug, a sailing hengst or sloop. No tow fits.
  A boat asks for the lock 100 m before it gets there (an out-bound one at its berth, and it leaves
  when the gates start to open), so the gates stand open on arrival. Within 0.3 m of the dock level
  (round spring high water) both pairs open and it goes straight through. One that no longer
  qualifies (too big, or kept 45 s off the gates, e.g. the bridge held down) turns away and goes back.
  The lifting bridge goes up only once a boat has asked. Check: `server/test/lock.test.ts` (the table
  of every vessel and tow against the chamber, and an hour of traffic from three starts), in the game
  `__scheldemist.world.lock().fitTable()` and `.traffic()` (the log of passages and their waits).
- **The canal and the Sint-Pietersvliet**: open to the river, so tidal. Their beds of mud lie at
  -5.05; at low spring water they run dry and the boats in them sit on the mud with a small list.
  A rowing boat there takes the ground when less than 0.35 m of water is left.
- **The brig** (the Anna Maria) sits on the bottom at her berth when the river falls below -4.4
  (her deck stays at -2.0), so her gangway is never too steep to walk.

## What follows the water
- The river sheet, `World.waterLevel` (swimming, rowing, splashes), the planar mirror (its plane
  follows the water nearest the eye: river, dock or lock), the shore foam (it rides on the sheet).
- New water sheets for the dock and the lock chamber. A second stencil bit keeps the river sheet out
  from under them (`boats.ts` dockWaterStencil; hull caps now write only bit 1).
- Every boat: moored rows, single boats, the pontoon and its barges, river traffic, the liner and its
  lighters, the lock's boats, canal and vliet passages, rowing boats lying at berths or drifting, tow
  hawsers and lashings.
- The brig's deck (`DECK.y` is live), her gangway (hangs from her rail, its foot rolls on the quay,
  `RAMP.zLow` is live) and mooring lines; the sailor and the job's recipient on deck ride with it.
- The ferry pontoon's gangway: a 7 m plank hinged at the quay edge; the walk slope follows it.
- The ladders go down below the lowest spring tide. A ladder whose top is under water is not offered.
- The quay steps: the landing floods at high water. Walking down a flooded flight you start to swim
  where the water is 1.2 m deep; a swimmer swims over the flooded landing and treads, and climbs out
  up the steps where they come out of the water (`quaysteps.ts` floodExit). At low water the landing
  stands high and dry; you get back up by the ladder at its end. `exitNear` uses the real level.
- The crane holds on the moored boats, the floating litter, the angler's float at the Steen, the
  lapping sound of the water.
- Fixed things stay fixed: quay walls, steps, pier piles now go down to below the lowest tide. The walls
  are slimy through the whole tide range up to the high-water mark (`tideShade`); the dock walls keep
  a band at the dock level. New mud at the foot of the river and canal walls (`world/tidemud.ts`) and
  a mud flat in front of the far bank.
- Rowing: the tidal current now runs with the real rise and fall (strongest at half tide). At high
  water you no longer fit under a bridge you pass under at low water. Boats can be hired from the
  steps above a flooded landing, or from the landing high above low water.

## Dev
Dev menu, row **Tide**: "now" (level, rising or falling, today's range, next high and low water, dock
and lock), "high water" / "low water" (hold the river at spring high or low water; local only, the save
is not touched), "follow the clock". In the console: `__scheldemist.world.tideDev.read()`.

## Tests (on a copy of the save, own servers 8851 / 5191)
- `npm run build` passes; `npm test` 289 passed; `__scheldemist.paths()` returns [] at high water,
  low water and on the clock.
- Low water: walked off the quay edge, fell 5 m, swam at the surface, climbed a wall ladder to the quay;
  climbed the ladder at a landing's end.
- High water: walked down the Rijnkaai steps, started to swim at 1.2 m depth, swam over the flooded
  landing, swam back and stepped out on the treads, walked up to the quay. Dock steps the same.
- Rowing: hired at the Rijnkaai steps at high water (standing on the treads) and at low water (from
  the landing); rowed out and back; got out onto the steps and up the landing ladder.
- Lock at low water: chamber drained to the river, river gates opened, boat in, gates shut, chamber
  filled to the dock, dock gates opened, all shut after.
- Shots in `data/shots/`: `tide-high-*` and `tide-low-*` for steps, brig, moored, pontoon, lock, dock,
  and `tide-low-canal` (the canal run dry, boats on the mud).

## Frame time (`__scheldemist.perf(40)`, fog, 8:15, same four places)
| | before | after |
|---|---|---|
| ms per frame | 4.7 - 7.0 | 3.4 - 5.7 (noise; no measurable cost) |
| draw calls | 159 - 216 | 162 - 220 |
| triangles | 244k - 278k | 258k - 287k |
Per frame the tide costs a few dozen comparisons: sheet heights, the brig kit only when the deck moved
5 mm, the pontoon pivot, each boat's level. No geometry is rebuilt.

## Open points
- The quay walls read very dark at low water on the north-facing river walls (wet slime in shade).
- A swimmer right against a river wall at low spring water can dip under the mud bank's edge.
- The whole-week tide repeats each week (the clock's day runs 1..7).
