# M7 - Walkthrough of the west half, 2026-09-25

Steve: "do some city walkthroughs and testing of quests and fix bugs". Three helpers walked the town at the
same time. This note is the west half: the cathedral and its quarter, the Grote Markt and the town hall,
the Handschoenmarkt, the Steen and the Steenplein, the Werf and the ferry pontoon, the Vismarkt, and the
back streets and alleys there. The east half and the jobs have their own notes.

How: test stack `west` (server 8971, vite 5371), a copy of Steve's save (day 4), one hidden tab, audio
silent. Jef walked with W (the kit's keys and `step`), from street to street and through every door.
By day at 13:00 clear, by night at 22:00, once in fog at night, and the new-game opening on a fresh
game (`/api/new-game` on the copy). Pictures in `data/shots/w_*.jpg`, 960 x 540.

## Bugs found

| # | Where (x, z) | What | Cause | Fix |
|---|---|---|---|---|
| 1 | Steen, the museum step (-183.9, -21.65) | At the museum's closing (16:00) Jef was put out and fell through the world. He fell to y -8.2 and stayed there. `devEnter("steen")` and `t.go` onto the porch did the same. | `FirstPerson.place()` set the feet to 0. The Steen's courtyard and museum are a walk area with its floor at 2.2 m. With feet at 0 no floor was within a step, so `groundAt` returned the river bed. `rideEnd` and `bikeMount` also asked for the ground with the feet at 0. | **Fixed.** `place()` sets the feet on `world.baseAt` (the ground floor there). `rideEnd` and `bikeMount` ask `groundAt` from that height. Checked: at 16:01 "The attendant rings his hand bell: the museum is closing. You go out into the courtyard." Jef stood on the courtyard with his feet at 2.2. |
| 2 | Steen, the stair head to the cell (-175.1, -29.9; hall x -9.0, z 6.1) | Jef could not get onto the stair down to the cell. | The back glass case (x -7.6) and the end of the stairwell's rail left a gap of 0 m for Jef's body (0.32 m). The test's flood uses 0.3 m, and at x -9.0 exactly it slipped through. | **Fixed** (`shared/steenPlan.ts`): the back case moved to x -7.3, and the rail now ends 0.6 m short of the head (`RAIL_END`, drawn and solid). The way on is 0.56 m wide. |
| 3 | Steen, the cell (-172.5, -27.3) | Once down, Jef could not climb back out. He stopped two steps from the top (feet 1.8): a trap. | The flight is steep (0.2 m rise on 0.28 m). The world keeps the body's ring (0.47 m) on floor within a step. From the second-last step the hall's floor ahead was more than a step up, so it counted as a wall. | **Fixed**: `WALK_STAIR` is the flight for walking. It reaches 0.5 m onto the hall's floor past the head and holds its height there, as the homes' flights do. The drawn flight is unchanged. New test in `halls-inworld.test.ts`: down to the cell with a 0.32 m body, and up the flight as the world walks it. |
| 4 | Steen stair (hall x -11.1, z 6.2, feet 0.8); any flight | Wedged on a flight: after climbing close to its side, no key moved Jef any more. | On a flight the side check keeps the body 0.32 m in. The ring (0.47 m) counts the floor beside the flight as a wall only once it is deeper than the drop (0.8 m), and that happens halfway up. Jef then stood on a spot that the rules themselves refused, so every step was refused. | **Fixed** (`world/rijnkaai.ts` `move`, shared code, kept small): when a step is refused and the spot Jef stands on is itself refused, `moveUnwedge` lets a step through if it keeps a floor within a step, touches no solid, and has no more wall round it than the spot has. Checked: he walks out. The town hall's great stair was climbed and walked down hugging both sides. |
| 5 | Steen gatehouse, the bronze gun (-182.2, -29.65) | The gun barrel floated 0.9 m above its carriage. | `landmarkKit.cyl` stands on `y` (its centre is at y + h/2), so the lying barrel's centre was at 1.45 m. | **Fixed** (`world/landmarkHalls.ts`): the barrel lies on the carriage (centre 0.72 m), muzzle toward the door, with the wheels under it on the floor. `w_steen_gun_before`, `w_steen_gun_after`. |
| 6 | Steenplein (-190.6, 40.5); Grote Markt | At night tavern singing was heard at full level on the Steenplein, from a house where no tavern stands ("tavern by the doss house"). The Grote Markt's was 17.5 m from Den Engel's door, and the Rijnkaai's 16 m from In de Ankere's. Het Schipke and Het Bassin had none. | The four sound points were fixed guesses from before the taverns stood in the world. | **Fixed** (`audio/emitters.ts`): one point at each of the five taverns' street doors, from `shared/inworld_houses.json`. Checked at 21:00: before Den Engel "tavern engel" 1.0. At (-190.6, 40.5) no tavern is heard. |
| 7 | Grote Markt, Handschoenmarkt, the cathedral quarter | At night these squares and lanes have no street lamps. Only the lit windows, a Madonna's lantern and Jef's own lantern light them (`w_n_gm_n`, `w_n_hsm_s`, `w_n_townhall`). | `decor.lamps` in `shared/city.json` has 32 lamps: 5 on the Werf, 6 on the Steenplein, 4 on the Vismarkt, the rest in the east. None stand on the two squares. | **Fixed** (Steve said yes, M7-lamps.md): 34 new lamps on the squares, the cathedral quarter, the lock bridge and main streets; d22, d23 had stood inside the town hall's walls and d26, d27 in the canal; every lamp now lights the ground. |
| 8 | Behind the Rijnkaai (31.35, 71.65), east half | In the fresh game, `paths()` listed "before a corner Madonna". A barrel cart stands before it (`w_madonna_block`). | A cart placed in the lane on day 1. It was not there on the copy of Steve's save (day 4). | **Not fixed**: this is in the east half and not in my files. Passed on. |
| 9 | Vismarkt, the fish benches (for example (-136.5, 26)) | `zfight()` lists the benches: the fish layer lies 5 mm over the slab (`build_trades.py mk_bench`). | A thin layer. | **Not changed.** No flicker shows in the close pictures (`w_vis_stall_top`, `w_vis_stall_top2`). The mottled look is the fish texture. |

## Looked at, not bugs
- Werf, the pontoon: the walk map ends at z -58, 2 m before the pontoon's end. Only while the ferry lies there is that end a landing. The quays at the Vliet inlet (-142, 25) have no rail: walking straight off the Steenplein edge, Jef falls in and swims, as designed.
- The ferry gangway is walkable within 0.33 m of the plank's middle (half width 0.8 m less the 0.47 m ring). From 0.46 m off the middle Jef stops at the inboard step. It is walked off straight down the middle.
- Den Engel and Het Schipke: the keepers turn to look at Jef, so from the counter's end you see them side on. The counter stops a walk straight up the middle, as noted for In de Ankere. The cathedral's trumeau stops a walk straight through the middle of the west door.
- Tavern signs over the doors look like a thin rod from the front: the hanging board is seen edge on.
- E prompts face the thing. At 22:40, facing the shut west door, E "try the door of the cathedral" shows 1.5 m before the leaves and goes when he turns away. G "lie down here and sleep rough" shows from 22:00.
- The alley at (-308, 272..299) ends at the map edge in a brick wall with washing over it (`w_alley_end`). The alley home's door is shut to a stranger.
- Text: every line seen was plain English (the museum's closing, the hints on the ferry, the tavern and shop signs).

## Sound (water only within about 5 m)
Measured with the soundscape's own numbers (`sound.graph()`, after 2.5 s of `update`):

| Where | Distance to the quay | Water | Other |
|---|---|---|---|
| Werf pontoon's end, 13:00 | on the water | 0.5 | |
| Het Schipke, inside | 17.6 m | 0.02 (fading out) | the tavern room, a moored boat's creak |
| Vismarkt (-118, 36) | 24 m | 0.01 (fading out) | Vismarkt stalls 1.0 |
| Werf (-237.7, 9), 22:30 | 9 m | 0 | moored boats, a gas lamp |
| Werf (-265, 5), fog, 23:00 | 5 m | 0.13 | |
| On the ferry's deck (new game) | on the water | 0.64 | |
| In the cathedral | 149 m | 0 | the church room |

## Frame time
`perf(30)`, median of three, hidden pane at 960 x 540, 13:00 clear, with the other helpers' stacks running.

| View | ms | Calls | Triangles |
|---|---|---|---|
| Grote Markt, toward the town hall's door | 10.6 | 316 | 349k |
| Handschoenmarkt, the cathedral's west door | 6.6 | 224 | 294k |
| Werf, looking along the quay toward the Steen | 11.4 | 1,019 | 683k |
| Steen courtyard, the museum door | 7.7 | 609 | 491k |
| Vismarkt, toward the river | 7.6 | 371 | 373k |
| Den Engel's door | 7.1 | 364 | 435k |
| Het Schipke's door | 6.7 | 291 | 391k |

No view is over 12 ms. The Werf is the heaviest: it has the most draw calls.

## Checks
- `npm run build` passes.
- Server: `halls-inworld` (28, one new), `cathedral-inworld`, `landmarks` and `houses-inworld` pass: 73 of 73.
- In the browser, on the copy of the save, by day: `paths()` lists nothing once the town hall's door has synced. For a moment after `t.light()` it listed the town hall's five inside points, because the door was still shut from 21:00. `signs()` 0 problems, `streetEnds()` nothing. In the fresh game: see bug 8.
- `zfight()`: 416 at the start (Rijnkaai, the Vismarkt market not out), 519 with the Vismarkt market out (81 of them the market's stalls), and 470 in the fresh game. The difference is the markets, the litter and the carts put out with the day. My changes are in the halls' own scenes, which `zfight()` does not see.
- Console: one 400, from my own picture upload as PNG (`/api/dev/shot` takes JPEG). No other errors.
- The tab was closed with `t.done()`, the viewport set back, and the stack stopped. Ports 8971 and 5371 are free.

## Walked
- **Werf and the pontoon** (`w_werf_1..4`, `w_pontoon_end_back`, `w_pontoon_end_down`): from the Werf along the pontoon to its end and back.
- **Het Schipke** (`w_schipke_front`, `w_schipke_in`, `w_schipke_in_back`, `w_schipke_counter`, `w_n_schipke`, `w_n_schipke_in`, `w_n_schipke_counter`): in and out by day and at night, with the keeper and two sailors at 22:30.
- **Steenplein and the Steen** (`w_steenplein_n`, `w_steenplein_steen`, `w_steen_court_door`, `w_steen_court_w`, `w_steen_door_close`, `w_steen_gatehouse*`, `w_steen_hall_e`, `w_steen_hall_w`, `w_steen_stairhead`, `w_steen_cell`, `w_steen_cell_back`, `w_n_steenplein`): up the ramp, across the courtyard, in, through the arch, down to the cell and back up and out, and put out at closing time.
- **Vismarkt** (`w_vismarkt_1..4`, `w_vis_steps_fwd`, `w_vis_steps_back`): the square and the edge of the Vliet inlet.
- **The back streets to the Grote Markt** (`w_stuck_155_44` is a house front where the straight line ended), the **Grote Markt** (`w_gm_*`), the **town hall** (`w_th_porch`, `w_th_vest`, `w_th_court`, `w_th_office`, `w_th_off_c`, `w_th_wedding`, `w_th_leys`, `w_th_lookout`): up the great stair and down, hugging both sides.
- **Den Engel** (`w_engel_front`, `w_engel_in`, `w_engel_in_l`, `w_engel_in_back`, `w_n_engel`).
- **Handschoenmarkt and the cathedral** (`w_hsm_n/e/s/w`, `w_cath_nave`, `w_cath_back`, `w_cath_n`, `w_n_cath_front`, `w_fog_n_cath`): in through the west door, and put out at 22:00.
- **The cathedral quarter's back lanes and the alley home** (`w_cath_quarter_w_lane`, `w_alley_n`, `w_alley_s`, `w_alley_end`).
- **The new game's opening** (`w_ferry_start`, `w_ferry_start_back`, `w_ferry_start_l`, `w_ferry_start_r`, `w_ferry_hauling`, `w_ferry_castoff`): on deck at 6:09 in fog with three passengers and the ferryman. Jef walked down the gangway to the pontoon. The server's stage became "ashore", the plank came up, the ferry cast off, and the hint about the Hessenatie's board was shown.
- A walk map of the west half, 0.5 m a pixel, for planning routes: `w_map_west` (white: free, orange: raised, blue: water, black: wall).

Not checked: the widow's home inside (it needs a lease), the Poesje and the garret (east half), a gang or a night event in the west half (the night test's work).

## Files changed
- `client/src/player/firstPerson.ts`: `place`, `rideEnd` and `bikeMount` stand Jef on the ground floor there (bug 1).
- `client/src/world/rijnkaai.ts`: `move` falls back to `moveUnwedge` and `wallCount` (bug 4). This is shared code; the file was re-read right before the edit.
- `shared/steenPlan.ts`: the back case at x -7.3, `RAIL_END`, `WALK_STAIR` (bugs 2 and 3).
- `client/src/world/landmarkHalls.ts`: the Steen's gun, and the rail drawn to `RAIL_END` (bugs 5 and 2).
- `client/src/audio/emitters.ts`: the taverns' sound at their doors (bug 6).
- `server/test/halls-inworld.test.ts`: the Steen with Jef's own body, down and back up.
- This note.
