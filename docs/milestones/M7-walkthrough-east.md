# M7 - Walkthrough of the east half, 2026-09-25

Steve: "do some city walkthroughs and testing of quests and fix bugs". Three walkers worked at once. This note is the
east half: the Rijnkaai and its quays, the Hessenatie, the quay railway and the cranes, the lock and its bridges,
the Petit Bassin, the Oostershuis, the Entrepot quay, the canals and the vlieten with their bridges, the Vleeshuis,
the Poesje, and the taverns and homes of that half (In de Ankere, De Vliet, Het Bassin, the garret).

How: the test stack `east` (server 8972, vite 5372), one tab, `docs/testing.md`. Jef walked by the keys (W held,
turned toward each point), not by teleport, wherever it mattered: into every door, up and down every stair, over
every bridge, round the Petit Bassin. By day at 13:00 clear, at night at 22:00 clear, once at 22:00 in fog, at high
and low water (Dev tide hold), and in a fresh game (for the west walker's Madonna). Pictures are
`data/shots/east_*.jpg`, 960 x 540.

## Fixed

| # | Where (x, z) | What was wrong | Cause | Fix | Pictures |
|---|---|---|---|---|---|
| 1 | Before all five tavern doors: Het Bassin (78.5, 124.3), In de Ankere (-61.7, 47.7), De Vliet (-117.7, 48.3), Het Schipke, Den Engel | The publican stood in the street 1.7 m before his own door, all day. Jef walked into him and could not get in (Het Bassin). | His goal is set when his schedule's key changes. At load the in-world rooms are not attached yet, so `tavernInside` said no and he got the old "stand at the door" goal. The key never changed after that. | `client/src/game/town.ts reschedule`: the tavern's open state (`Sim.tav`) is part of what sets the goal again. A publican or a drinker is sent in (or out) when his tavern opens or shuts. All five went inside at once after the reload. | `east_bassin_front.jpg` (before), `east_bassin_in.jpg` (keeper behind the counter) |
| 2 | Het Bassin (78.5, 126), De Vliet (-117.7, 50), the garret's door (-123.3, 118), Den Engel (-222, 72.5) | Street-life shop fronts on houses whose insides stand in the world: "COAL AND PEAT" over Het Bassin, "WINE AND SPIRITS" over De Vliet, a chemist's board, awning and goods at the garret's door, "GROCER" over Den Engel. | `streetlife.ts` picked a trade for every front with a door. It skipped only the four named doors in `city.json`, not the in-world houses of `shared/inworld_houses.json`. | `client/src/world/streetlife.ts`: the shop is still chosen, with the same random draws, but on an in-world house's front it is not drawn and not stocked (`muted`, no `shopFronts` entry). Every other front stays exactly as it was: 114 shops (was 118). The streetlife z-fights were measured before and after in the same state and are the same list (532 and 532). | `east_bassin_front.jpg` (before), `east_bassin_front_fixed.jpg`, `east_garret_front.jpg` (after) |
| 3 | Het Bassin's doorway (78.5, 125.1) | Toon Geerts's velocipede leaned right in the tavern's doorway ("E take the velocipede" on the step). | `possessions.ts besideDoor`: a publican lives at his tavern (house -1), so his home has no house door and no way out. The "out" vector was (0, 0), every try was the door point itself, and the velocipede keep-off circles were checked for handcarts only. | `server/src/town/possessions.ts`: a home without a way out goes straight to `spotNear` (with the tavern door's 3 m keep-off), and the keep-off circles hold for velocipedes too. `TRANSPORT_V` 5 gives every save its vehicles again once. The machine stands at (77.2, 122.4) now. `transport.test.ts` passes. | `east_bassin_door_close.jpg` (before), `east_bassin_lookout.jpg` (after, beside the door) |
| 4 | The side windows of the corner taverns: Het Bassin's three on its east face (81.3, 128 to 136), In de Ankere's three on its side street | From the street the lit taproom showed as grey horizontal slats. From inside, the side windows showed flat grey instead of the street. | `houseInWorld.ts`: the dark lining stands 0.1 m inside the house's side and back faces, but it is open only at the front. Its side quads covered the cut side windows: the street was hidden from inside, and outside the lining fought the pane. | `client/src/world/houseInWorld.ts`: `holedFace` leaves the side and back faces of the lining open where a cut window is. Now there is the Oostershuis through Het Bassin's side window, the Rijnkaai cranes through In de Ankere's, and the fire and lamps from the street. | `east_bassin_sidewin.jpg`, `east_bassin_sidewin_out.jpg` (before); `east_bassin_sidewin_fixed.jpg`, `east_bassin_sidewin_out_fixed.jpg`, `east_ankere_in_side.jpg` (after) |
| 5 | Every tavern's hanging sign, for example In de Ankere (-59, 47.7) | Seen from one side of the street the name read in mirror writing. | One double-sided plane. | `client/src/game/interiors.ts decorate`: two single-sided faces back to back, each the right way round. Z-fights the same with and without the back faces (532). | `east_ankere_leak2.jpg` (before), `east_ankere_sign_fixed.jpg`, `east_ankere_sign_fixed2.jpg` (after, both sides) |
| 6 | Oostershuis gate, Petit Bassin south quay (116.9, 123.3) | The night giver Miel Verhaegen (the cracksman, "a man who needs a lookout") stood inside the pier of the Oostershuis gate's portal. Nobody could see him, and there was no "talk" when facing his spot. | `server/src/night/givers.ts POST_OFFSET` [-3, 3] from the `bassin_south` spot. The server's walk map calls that open, but the Oostershuis portal is a wall in the game. | Offset [-10.5, 1.1]: he stands between the warehouse doors west of the gate, off the drays' lane (the client moves him 1.4 m off the lane, to (109.5, 123.3)). `ensureNightTown` also moves an already-added giver whose post no longer matches the table. On the test save only the cracksman moved; the other three kept their posts. At 22:00: E "talk to Miel Verhaegen" facing him, nothing with his back turned. `night.test.ts` passes. | `east_n_cracksman.jpg` (before: the pier, no man), `east_n_cracksman_fixed.jpg` (after) |
| 7 | Reported by the west walker: the corner Madonna behind the Rijnkaai, her spot (31.35, 71.65) | In a fresh game `paths()` failed at "before a corner Madonna": a barrel dray stood on her spot. | Her spot (1.9 m out from the corner) lay inside the `rijnkaai_back` dray round (`world/traffic.ts`), at its corner (33, 69.5). A dray stops for anyone in its way, so it waits on the spot. | `client/src/world/streetlife.ts`: a Madonna's spot that falls in a dray or handcart round moves in front of one of her two faces, off the round. Three spots moved, all on that round: (30, 73) to (28.8, 72), (-2, 73) to (-0.8, 72), (6, 112) to (4.3, 113.2). No Madonna moved and nothing was drawn differently. No spot is left in a round. In the fresh game `paths()` is fine for her. | `w_madonna_block.jpg` (the west walker's) |

Shared code, kept small and re-read before each edit: `town.ts`, `interiors.ts`, `streetlife.ts` and
`houseInWorld.ts` serve the taverns of both halves (Het Schipke and Den Engel get fixes 1, 2 and 5 too).

## Not fixed

| Where (x, z) | What | Why not | Picture |
|---|---|---|---|
| Entrepot quay (about 172, 80) and other storehouse walls | "CARTS KEEP TO THE RIGHT" is painted across a (painted) window. | `quayfurniture.ts` places the wall notices between the gates only. The storehouse windows are texture, so the wall probe cannot see them. This needs the store fronts' openings (`facadeOpenings`) in `quayfurniture.ts`. That is a bigger change and it moves many notices. | `east_entrepot_board.jpg` |
| By the garret's door (-123.3, 118) | The two neighbouring houses both carry number 52. | The house numbers are drawn at random for each wall. Cosmetic. | `east_garret_front.jpg` |
| Vliet bridge (-146, 43.5) | The far half of the deck's planks warp strongly. | This is the psx affine texture look on a large quad. It is the same on other bridges, only less. | `east_br_vliet_mid.jpg` |
| Lock bridge (110, 17) at night | No lamp on or near the bridge. It is very dark. | A design question for Steve, not a bug. | `east_n_lockbridge.jpg` |
| Werf, fresh game (not my half) | `paths()` lists "the ferry's fore deck (the opening)" once Jef has been put ashore by `t.go` while the ferry still waits. | This is the ferry opening's work, which is not committed yet. Passed on to the lead. | none |

Known, and already listed in the M7 notes: the Oostershuis passage and halls and the garret are dark by day, and
the garret's gable window is painted. After a clock jump the landmark doors and the Poesje follow the new hour only
at their next refresh (up to 12 s). That is a test artifact, not seen in play.

## Checked and fine
- **Lock:** a tug came in on a level (both gates open, bascules up). A paddle tug went out through a full locking:
  the inner gates shut behind her, the chamber dropped, the outer gates opened, and she went off down river
  (`east_lockout_3/7/11.jpg`, `east_lock_pass_*.jpg`). No waits in the traffic log. The lock bridge deck is at y 0,
  and the railway crosses it (`east_lockbridge_*.jpg`). The mottled brown in the chamber is the warehouse's
  reflection, not mud (the mud toe lies at -4.75).
- **Tides:** held low, the river was at -5.2 with the mud strip at the wall foot (`east_low_wall_side.jpg`) and the dock
  and lock held at -0.7 and -1.4. Held high, it rose toward the day's high water (-0.55).
- **Bridges:** canal mouth, mid and high, vliet mouth and mid were walked end to end, flat, with no stops.
- **Buildings walked in and out:** Het Bassin, In de Ankere and De Vliet (taproom, counter, keeper, windows both
  ways). The Vleeshuis by its south door (the casks, the aisles, the street through the door); its door shuts at
  night. The Oostershuis gate passage and west hall. The garret after renting it for the night: five flights, y 0.18
  to 15.8 step by step. The Poesje at 20:00: down the 13 steps to -2.2, the audience and the puppets
  (`east_n_poesje_hall.jpg`).
- **Crane:** at the Rijnkaai crane's foot "E climb the crane's ladder" comes once the crane has parked (about 4 s,
  `summon`). Jef climbs to the gallery at 6.42 and back down (`east_crane_top.jpg`).
- **E facing:** the sack at the Hessenatie, the crane ladder and the cracksman are offered only while Jef looks at
  them.
- **People:** in 10 places (Rijnkaai, Hessenatie, east quay, lock, Petit Bassin, Het Bassin, back lane, In de Ankere,
  canal, Vleeshuis) nobody walked in place over 8 s.
- **Round the Petit Bassin:** west quay, south quay, east (Entrepot) quay, north quay. The crane legs on the west
  quay leave a passage (x 64 to 68). The velocipede at the Entrepot leans beside its door, not in it.
- **Sound** (the soundscape's own update, run by hand in the hidden tab): the water level follows the distance to
  the quay edge, `wFar` 0 beyond 6 m. It was 0.33 at 3 m from the edge, 0.04 and falling at 25 m, and 0.43 on the
  lock bridge (over the water). Rooms: tavern, vault (Vleeshuis), store (Oostershuis).
- **Frame time** (`perf(30)`): Rijnkaai clear 7.45 ms, 270 calls. Night in fog: Rijnkaai 6.4 ms, Petit Bassin 5.3 ms,
  In de Ankere 6.4 ms.
- **Console:** no errors. `signs()` 0 problems, `streetEnds()` empty, `paths()` empty on the test save.
- **Z-fights:** my changes were measured in the same state: 532 before, 532 after. Between runs the count moves with
  the tide (the pontoon), the lock leaves and the railway gate: 502 at the start, 532 later, 627 in a fresh game with
  the ferry.

## Files
- `client/src/game/town.ts` (fix 1)
- `client/src/world/streetlife.ts` (fixes 2 and 7)
- `server/src/town/possessions.ts` (fix 3, `TRANSPORT_V` 5)
- `client/src/world/houseInWorld.ts` (fix 4)
- `client/src/game/interiors.ts` (fix 5)
- `server/src/night/givers.ts` (fix 6)
- this note

`npm run build` passes. Server tests: `transport`, `night`, `houses-inworld`, `homes` (80 tests) pass.
