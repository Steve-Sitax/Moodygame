# Next update: the boats, the tide and the docks (plan, 2026-10-11)

Steve, 2026-10-11: "Remodel all boats in high detail, good textures, different names and names correctly on boats.
Bumpmapping where possible and no water in the boats themselves. From the biggest to smallest boats. More
differentiation. We must also be able to go above boats, just jump from quay and land in them. press key to use
them. test all with all water tides, no boats should go under water. also take the docks/ walls idea from the image
agent and make docks look way better".

This is a plan only. Nothing was changed. Paths are in `D:\Code\MoodyGame` (main) unless they say otherwise. The look
survey is `D:/Code/MoodyGame-godot/godot/baked/survey/report.md` (items 10, 15, 16, 22 and 24 are about water and docks).
Rules that apply to every package: `docs/05-art-direction.md` (high detail, no PS1 look, linear mipmapped textures),
`docs/performance.md`, `docs/rendering.md` (fixed lights, few shader kinds, bumps from the surface's own picture),
`godot/README.md`, and CLAUDE.md (one model per thing, paths, changelog, no secrets, a browser run at the end).

---

## 1. What is there today

### 1.1 Every boat kind, biggest to smallest

All the kinds below are built by `tools/blender/build_boats.py` into `client/public/models/boats.glb`, except the ferry
and the landing stage, which come from `tools/blender/build_ferry.py` into `ferry.glb`. Godot draws the still ones from
the bake (`godot/baked/next/town.glb`) and the moving ones from the decoded models (`tools/godot/models.mjs` to
`godot/baked/models/`). Triangle counts below include the cap and the stowed oars.

| Kind (model) | Length | Tris | Name painted today | Where and how many |
|---|---|---|---|---|
| liner | 97 m | 6,451 | KEMPENLAND / ANTWERPEN | 1, at anchor (0, -140), `anchorage.ts:259` |
| steamer | 56 m | 4,247 | SCHELDE / ANTWERPEN | 1 at anchor (`rijnkaai.ts:890`), and river traffic (`river.ts:63`) |
| barque, barque_sail | 48 m | 4,846 / 4,700 | ELISABETH (all of them) / ANTWERPEN | 4 still (`rijnkaai.ts:844, 891, 892, 903` in the dock); towed and under sail on the river |
| brig "Anna Maria" | 38 m | 3,726 | ANNA MARIA / ANTWERPEN | 1, Rijnkaai (-40, -7.2), `rijnkaai.ts:840`; deck walkable by gangway |
| rhine_barge | 34 m | 2,694 | NOORDSTER / ANTWERPEN | moored rows (`rijnkaai.ts:884-901`), pontoon rows (`boats.ts:1381`); crew aboard (`lifeAboard.ts`) |
| schooner | 26 m | 1,478 | ZWALUW | river traffic (`river.ts:65, 72`), the lock (`lock.ts:110`) |
| ferry "St. Anna" (`ferry.glb`) | 24 m | 10,631 | ST ANNA; stern ANTWERPEN faces inward | 1, opening scene only (`ferryArrival.ts:39`) |
| hengst, hengst_sail | 21 m | 2,704 / 2,648 | DE HOOP / TEMSE | most moored rows; under sail on the river and through the lock |
| tug | 19 m | 1,656 | HERCULES (all of them) | moored, the anchorage tows, the river tows, the lock |
| paddle_tug | 19 m | 1,172 | ST ANNA (same as the ferry) | at anchor (-205, -64), an anchorage tow, the river at 1.4x scale |
| lighter (5 variants: empty, loaded, coal, sand, timber) | 17 m | 1,488 to 3,668 | ZWALUW (all) / BOOM or LILLO | every moored row, the anchorage tows (emigrants), river tows, the lock, the pontoon |
| sloop (hoogaars), sloop_sail | 12.5 m | 1,584 / 1,678 | ZWALUW / DOEL | moored rows, one alone (`rijnkaai.ts:894`), river, lock |
| pontoon_section | 10 m | 624 | none | about 6 at the Werf, hidden under the landing stage |
| landing_stage (`ferry.glb`) | 60 m | 10,706 | ST ANNA on its notice board | 1, `landingStage.ts`; walkable |
| gig (water police) | 7.4 m | 1,938 | POLITIE | 1 mooring |
| shipsboat | 6.3 m | 1,392 | ANTWERPEN | 3 |
| eelboat | 6.2 m | 1,072 | LILLO | 5 |
| workboat (vlet) | 6.0 m | 768 | BOOM | 7 |
| rowboat | 5.4 m | 1,433 | none | 12, plus hire landings and river traffic |
| punt | 5.2 m | 702 | none | 12, plus a hire landing; one moving on the canal and the vliet |
| bumboat | 5.0 m | 2,512 | none | 4 |
| oldboat | 4.9 m | 1,252 | none | 6 |
| dinghy | 4.3 m | 1,378 | DOEL | 8 |

Totals: 58 small-boat moorings (`shared/smallBoats.ts MOORINGS`), 3 hire landings and 3 family boats on the server
(`server/src/rowing.ts:77-91`). Godot logs "45-47 single vessels, 38 rows of moored and small boats (76 boats)".
The moored rows are packed by a seeded random fill (`boats.ts mooreAlong`, 1069-1134), so the exact count per kind
comes from the seed. The instanced fleets cost 3 draw calls a kind (`boats.ts fleetOf`).

Who reads boat sizes and extras (they must change together with a model): `shared/smallBoats.ts HULLS` (the boat
check compares them with the glTF extra "row"), `shared/lockfit.ts`, `anchorage.ts` clearances, `river.ts` lanes,
`boats_sack_sockets.json`, the brig's `DECK` and `RAMP` (`rijnkaai.ts:86, 106`), `railway.ts` crane holds,
`lifeAboard.ts`, the lantern extras (`boats.ts lamps()`, Godot `BoatLamps.cs`), Godot `ShipWater.cs` (hard-coded
riding-light and pump tables), `ShipWalk.cs` (measures decks from the model), `RowPhysics.cs` (nine hulls).

### 1.2 Main problems found

**Detail and textures.** The hulls are low poly (a 97 m liner in 6,451 triangles, a punt in 702). Every boat texture
is painted at 64-128 px into one atlas of 128 px cells, with nearest filtering and no mipmaps (`boats.ts:489-520`).
That is the old PS1 look the art direction removed today.

**Names.**
- Eight names are shared by thirty models. ZWALUW is on all six lighters, both sloops and the schooner. Every barque
  is ELISABETH, every tug HERCULES. The paddle tug and the ferry are both ST ANNA.
- The letters are a 5x7 dot font on 16 px rows (`paint_names`, `build_boats.py:431`). They are unreadable past a few
  metres and shimmer. The small boats' boards are 5-12 cm letters.
- The ferry's stern board winds inward (`build_ferry.py:636`): culled from astern, mirrored from inside.
- The server's text disagrees with the hulls. `server/src/mapview/demo.ts:70-72` calls the liner Vaderland and a
  lighter De Hoop (the hengst's name). The newspaper's 15 ships (`server/src/paper/newspaper.ts:59-62`) are on no hull.

**Water inside the boats.**
- Browser: each hull has an invisible lid `<kind>_cap` over its rail that writes the stencil, so the water is not
  drawn there (`boats.ts:351-397`, `cap_object` in `build_boats.py:812`). But the `_bare` copies used for the sack
  swap (`sackModel.ts:682-716`) are built without a cap. So the loaded lighter and the bumboat (both open) and the
  ferry have no lid, and the bumboat loses her oars.
- Godot: `Psx.Cap()` is a working stencil lid (`godot/src/Render/Psx.cs:265`), and the water reads the stencil
  (`Psx.cs:843`). But `Movers/Boats.cs:156-159` hides every cap in the bake, and `Boats.cs:254` hides them in the
  model library copies. Its comment ("Godot has no such pass") is out of date. **So in Godot the river shows inside
  every open boat.** This is the most direct cause of "water in the boats".

**Tides.** The levels (`client/src/world/tide.ts`, copied in `godot/src/World/Tide.cs`): quay top y 0, spring high
water -0.40, mean high -0.65, half tide -2.80, mean low -4.95, spring low -5.20. The Petit Bassin is fixed at -0.70.
The lock chamber slopes between its two ends. The canal and vliet beds are at -5.05 (bare at spring lows). The mud
toe at the river walls is at -4.75. The brig sits on the bottom below -4.40. The server has no tide; both games work
it out from the clock. Where boats go wrong today:
1. The big moored rows along the river walls sink into the toe mud at low water: `mooreAlong` uses `bedAt`, which is
   `-Infinity` in the river (`boats.ts:1323`). A loaded lighter's keel reaches -6.05 against mud at -4.75. The
   anchorage lighter walked in against the Rijnkaai wall does the same (`anchorage.ts:929`).
2. A ladder climb into a boat on the mud aims at `levelAt + seat`, under her thwart (`rowing.ts:775-786`).
3. A drifted boat keeps the mud floor of her old spot (`rowing.ts:1446`).
4. Instanced boats in the lock chamber use the chamber's mean level, not the slope (`tide.ts:166`).
5. Crane loads go to `levelAt` plus the ship's offset and ignore her floor: at low water they land under the brig's
   deck (`railway.ts:1472, 1795, 1826, 1939`).
6. Heights fixed at build time: `b.deck(...).y`, the pontoon rect (`boats.ts:1398, 1465`), the landing "flooded" test
   (`rowing.ts:527`, `WATER_Y`), a fishing float (`steenlife.ts:216`), the pier braces (`pier.ts:80-93`).
7. The canal bed mesh is up to 0.12 m higher than the flat `CANAL_BED` the big hulls use (`tidemud.ts:114`).
8. Godot: after a clock jump the boats move to the new level at once, but the drawn river sheet eases at 0.6 m/s
   (`Waters.cs:64`); for up to 8 s boats float above or sink below the water.
9. Godot has no storm surge (the browser adds up to 1 m); the two games disagree in the great storm.
10. Moving ships (river, anchorage, lock tows) never take the ground; fine today, but a deeper new hull must keep
    clear of the beds.

Testing a tide today: browser `__scheldemist.world.tideDev.hold("high" | "low" | null)` (spring levels only) and the
dev menu; any other level only through the clock (`t.time`). `__scheldemist.rowing.boatCheck()` checks the small boats
and still vessels, not the moving ones. Godot: `--hour`, the kit's `hour`, and the snap tool's view hour
(`Tide.Set(1, hour)`, Monday's tide). No tide hold and no level setter in Godot.
Monday's tide by the clock: high 09:36 (-0.41), half ebb 13:04 (-2.8), low 16:31 (-5.19), half flood 19:16, high
22:01. The survey's 13:00 pictures were taken at half tide, not low water.

**Walking on boats.**
- Godot already has most of it. `Play/ShipWalk.cs` builds a floor grid (`World/MeshDeck.cs`, 0.25 m cells measured
  from the model) for every hull of 9 m and more, follows the live frame (heave, roll, tide, travel), auto-attaches
  when Jef lands on a deck (line 95), and offers E to step or jump on, climb on from the water, and leave. The brig's
  gangway has its own ramp (`ShipWalk.Gangway.cs`). `Play/Rowing.cs` offers "E jump down into your boat" for drops
  of 1.3-3.6 m, then rows (`RowPhysics.cs`). Shared hooks: `Jef.Transport.cs` (`Drive`, `Carry`, `TransportFloor`,
  `OnJump`, `LaunchFromRide`, `DropFromBoat`), `Jef.ClimbTo(..., frame)`, `World/RaisedDeck.cs`, `Interact` offers.
- Missing in Godot: floors for boats under 9 m and the pontoon (filtered at `ShipWalk.cs:36`); hired and owned
  rowing boats are never decks; no change from standing on a deck to using the boat (row, pole, sit); no punt mode
  (a punt is rowed); the camera does not roll on a deck (`DrivenRoll` never set); decks over 140 m away update every
  8th frame (fine while Jef is on one, he is the camera).
- Browser: no general deck walking. Only the brig's deck (`boats.deck`), the ferry, the landing stage, the omnibus
  and the crane galleries carry Jef (`firstPerson.ts RideWalk, rideStart, carryTo, onJump`; `rijnkaai.ts RaisedDeck`).
  Rowing: E hires or takes, "jump down (E or Space)" for drops up to 3.6 m, W/S/A/D/Shift row, E gets out
  (`rowing.ts:500-663`). `exitHere()` treats the brig's deck as too high (`rowing.ts:621-659`).
- Keys today: E use, Space jump, F/G/R second, third and fourth action, W/S/A/D with Shift (Godot `Menu/Keys.cs:27-49`).

### 1.3 The docks today

| Part | Built by | What is wrong |
|---|---|---|
| Water outlines and quays | `tools/city/design.py:40-65` to `shared/city.json` | river, lock (104..116, 0..46), Petit Bassin (70..170, 46..110), canal (-82..-70, 0..205), vliet (-150..-142, 0..72), moat. Fine. |
| Quay walls | `client/src/world/city.ts:291-399` | `quay_wall.jpg` (1024 px, 4 m a tile) and `quay_coping.jpg`, no bump, nearest filtering. The wall's u restarts on every segment, so the courses break at each corner. `wallMat.emissive 0x62645a` with the map as emissive (`city.ts:388`) washes out the tide bands. The tide line is vertex colour only (`quaysteps.ts:45-96`). |
| Stairs, ladders, rings | `client/src/world/quaysteps.ts` | stones cut from the wall picture; iron on a 64 px texture; rings are plain tori. |
| Bollards, fenders, coils | `tools/blender/build_quayfurniture.py`, `client/src/world/quayfurniture.ts`; old stand-ins `rijnkaai.ts:2542-2553` | painted 256 px atlases, nearest filtering; sparse along the edges (survey 24). |
| Canal and vliet beds | `client/src/world/tidemud.ts` | flat 4 m grid at -5.05, a 32 px grey texture with 5% glint pixels, a light tint and a shiny specular: "concrete pools", "snow at night" (survey 15). No channel, pools, tide line, debris, relief. |
| Water | browser `rijnkaai.ts:633-696`, `textures.ts:139-147`, `retro/psx.ts`; Godot `World/Waters.cs`, water in `Render/Psx.cs:891-1293` | a 64 px texture of 140 dashes tiled every 4 m: the zigzag stamp on the lock and the bands on the river. Shininess 120 gives the hard torch-cone glint (survey 10). |
| Mirrors | `client/src/world/mirror.ts`, Godot `World/Mirrors.cs` | 320x180; fine for this update. |
| Lock, gates, swing bridge | `tools/blender/build_lock.py`, `client/src/world/lock.ts` | materials from build_boats (same low-res atlas). |
| Town wall brick | `tools/blender/build_wall.py`, `tools/textures/townwall_maps.py`, `client/src/world/townWallBumps.ts`, `rampart.ts` | big diagonal streaks (survey 16, `r4/w05_rode_in.png`). The cause is not proven. Candidates: planar or radial arch UVs (`build_wall.py:849, 2401`), a height map out of step with its picture, or Godot's world-space mottle (`Psx.cs:646-657`). |
| Port life | `quayfurniture.ts`, `build_quaygoods.py`, D1 docks (`docs/milestones/D1-docks.md`) | two or three people, a horse, scattered goods (survey 24). |

A note on the vliet picture (`r1/q18_vliet_mid.png`) at 13:00: by the clock the water then stands about 2.3 m over
the bed, yet the picture reads as a dry pale floor. Either Godot draws no water there, or the canal water itself
reads as concrete. W1's tide snaps settle which one before D1 starts.

---

## 2. How the work is split

Hot files that many packages would touch are given to one owner each:
- `tools/blender/build_boats.py` (5,189 lines) is split first (W0) into one file per boat family, so the boat
  helpers never edit the same file.
- `client/src/retro/psx.ts` and `godot/src/Render/Psx.cs`: owned by D3 (water and shaders). Other packages ask D3
  for their switch (the name cell, the wet band) and do not edit these files.
- `client/src/world/boats.ts`: W4 owns the floating code (`place`, `writeFleet`, `mooreAlong` floors); W5 owns a new
  `boatNames.ts` with a two-line hook; B0 owns the material setup (lines 489-520). They run in that order.
- `client/src/world/rijnkaai.ts`: W1 the tide block only (`tideTarget`, `updateTide`, `tideDev`); D4 the old
  bollard and coil stand-ins only. Nobody else.
- The binary `boats.glb` and `ferry.glb`: helpers commit the Python only; the lead rebuilds the glb once after each
  merge (`blender -b --factory-startup -P tools/blender/build_boats.py`). Two helpers never commit the same binary.
- `godot/src/Movers/Boats.cs`: W2 the cap lines, W4 the floating parts, W5 a new partial `Boats.Names.cs`.

Helpers: look work (B0-B4, W3, D1, D2, D5, D6) on Opus 5.5 medium; code work (W1, W2, W4-W7, D3, D4) on Codex
`gpt-6.1-sol` medium (memory: "No Fable, Codex first"); a bug hunt goes to `gpt-6.1-sol` high. Each in its own
worktree from `main`, its own ports (8800 and up, never 8787, 5173, 8080, 8088, 8090), one Godot timing run at a time
(`godot/baked/PERF-LOCK`). No junctions in temporary worktrees.

Order: **Phase 0** W0, then **Phase 1** (W1, W2, W3, B0, D1, D2, D3, D5 in parallel), **Phase 2** (B1-B4, D4, D6 in
parallel), **Phase 3** (W4, then W5; W6 and W7 in parallel), **Phase 4** integration.

---

## 3. Phase 0

### W0. Split the boat builder, write the contract
- **Goal.** `build_boats.py` becomes a driver (BUILDERS, build_all, export, previews) plus a package:
  `tools/blender/boats/common.py` (Hull, helpers, painters), `ships.py` (liner, steamer, barque, brig, schooner),
  `inland.py` (rhine_barge, hengst, sloop, lighters, pontoon_section), `tugs.py` (tug, paddle_tug), `small.py` (the
  nine small kinds), `cranes.py` (portal and hand crane: not part of this update). The same output, mesh for mesh.
  Also: the `_bare` copies get their `_cap` and `_stow` (fixes the lid-less loaded lighter and bumboat), and
  `build_ferry.py` gives `ferry_bare` a cap.
- **The contract** (a new `docs/boats.md`, the one place for it):
  - origin at the waterline middle, bow to -Y in Blender (+z in the game), metres;
  - length, beam, waterline and deck heights stay within 0.1 m of today unless the package also updates every
    reader in 1.1;
  - every hull keeps `<kind>_cap` (one n-gon on the inner rail line) and adds `<kind>_walk` (hidden: the walkable
    deck, bottom boards and hatch tops as triangles) and `<kind>_block` (hidden: boxes for masts, deckhouses,
    hatches, winches);
  - name zones as their own quads: `<kind>_name_bow_p`, `_bow_s`, `_stern`, `_box_p/_s` (paddle boxes), with UVs
    filling 0..1. The game points each zone at the vessel's cell in the names atlas (W3, W5). Every board winds
    outward;
  - triangle budgets (start values; perfcheck decides): liner 120k, barque 90k, brig 70k, steamer 70k, schooner 45k,
    ferry 40k, rhine barge 30k, tugs 30k, hengst 25k, lighters 12-18k, sloop 15k, small boats 4-8k, pontoon 3k.
    Each hull also exports a far copy `<kind>_far` at about 20% (used past 60 m; under 10% past 150 m for the liner,
    barques and steamer);
  - at most 4 materials a hull (the boat atlas, the names atlas, sails or canvas, glass), shared by every hull;
  - rigging stays lines (`ropeMaterial`), as today.
- **Also:** `shared/fleet.json`, the registry of every placed vessel: `id`, `kind`, `name`, `port`, `flag`, lettering
  `style`, `where` (the placing line: `rijnkaai.ts`, `anchorage.ts`, `river.ts` kind, `lock.ts`, a moored row and
  its slot seed). Names from section 7. Small boats by mooring id.
- **Files:** `tools/blender/build_boats.py`, `tools/blender/boats/*.py`, `tools/blender/build_ferry.py` (the
  `ferry_bare` cap only), `docs/boats.md`, `shared/fleet.json`.
- **Verify.** `node tools/blender/glbhash.mjs` on the old and new `boats.glb`: every mesh hash the same, apart from
  the new caps and stows on the `_bare` copies. Browser: the loaded lighter and bumboat at high water in a swell,
  no water inside (`node tools/godot/look-refs.mjs --views ...`).
- **Risks.** Draco output may not be byte-stable; compare decoded meshes if the hashes differ for no reason.
- **Frame budget.** No change.
- **Godot.** Nothing (the caps stay hidden until W2).

---

## 4. Phase 1 (parallel)

### W1. The tide test kit and the boat-water check
- **Goal.** Any water level on demand in both games, and one check that lists every hull under water, in the mud
  or in the air, at every tide.
- **Browser.** `tideDev.hold(level)` takes a number as well as "high"/"low"; the test kit gets `t.tide(y | "high" |
  "low" | null)` and waits for the sheet to settle. A new `client/src/dev/boatWaterCheck.ts`
  (`__scheldemist.boatWater()`): every vessel (still, moored rows, small boats, river traffic, anchorage tows, lock
  boats, the liner, the ferry and pontoon) at the levels -5.20, -4.95, -4.40, -2.80, -0.65, -0.40 and the storm top
  (-0.50), and the lock chamber at both ends. Per hull: the keel against the bed (canal, vliet, wall toe), the
  waterline against the level when afloat (within 5 cm), the deck above the water, the cap present and on the rail,
  the lines to their rings. It runs moving boats for 60 s at each level.
- **Godot.** `Tide.Hold(float?)` in `World/Tide.cs`; the kit command `tide <y|high|low|clock>` (`Dev/Kit.cs`); an
  optional 9th view field `tide=` in `Dev/Snap.cs`; a new `Dev/BoatWaterCheck.cs` behind `--boatcheck <dir>` (same
  levels, `boatcheck.json`, `problems` must be empty), and a row in `tools/godot/checks.mjs`.
- **look-refs.** `tools/godot/look-refs.mjs --tide <y>` (holds the browser's tide through `--before`).
- **Files:** `client/src/world/tide.ts` (tideDev only), `client/src/world/rijnkaai.ts` (the tide block only),
  `client/src/dev/testkit.ts`, `client/src/dev/boatWaterCheck.ts` (new), `godot/src/World/Tide.cs`,
  `godot/src/Dev/Kit.cs`, `godot/src/Dev/Snap.cs`, `godot/src/Dev/BoatWaterCheck.cs` (new),
  `tools/godot/checks.mjs`, `tools/godot/look-refs.mjs`, `docs/testing.md` (the tide row).
- **Verify.** The check finds the ten cases of 1.2 (list them in the hand-back); midday clear snaps of the canal,
  vliet, Rijnkaai rows and the lock at -5.20, -2.80 and -0.40 in both games. Those snaps also settle the vliet question.
- **Risks.** The moving ships' state is per frame; run the check with the test steps (`t.step`), not real time.
- **Frame budget.** Dev only, nothing per frame in play.
- **Godot.** C# (above).

### W2. Godot: keep the water out of the hulls
- **Goal.** No river inside any boat in Godot.
- **Work.** Drop the cap hiding in `Movers/Boats.cs:156-159` and `:254`; keep `Psx.Cap()` (`RenderPriority -11`)
  before the water in the transparent pass; give the rowing copies (`Play/Rowing.cs` drawn hulls) their cap; hide a
  cap only when a boat sinks (the browser does this at `rowing.ts:909`).
- **Files:** `godot/src/Movers/Boats.cs` (those lines), `godot/src/Play/Rowing.cs` (the cap of drawn hulls).
- **Verify.** Snaps at high water in a swell and in the great storm (`--hour 9.6 --weather storm`): every open boat
  (lighters, punts, rowboats, eel boat, the barges' holds) from the quay, from above and from the water; the shaders
  check (`--shaders`, `problems` empty); a cap seen edge-on from the water must not cut the water behind the boat.
- **Risks.** A cap on a heeled hull (sailing) can poke above the rail; the rim must follow the rail (W0 contract).
- **Frame budget.** One more transparent draw per hull kind (instanced); measure with `--perfcheck`.
- **Godot.** C# only. Can start at once; it does not need W0.

### W3. The lettering kit and the names atlas
- **Goal.** Readable, period-right names: one cell per vessel name and per port, from `shared/fleet.json`.
- **Work.** `tools/blender/boats/lettering.py`: our own vector capitals, drawn in the script (no font file): a
  Roman serif, a Clarendon-style slab (the 1870s ship letter), a condensed sans for lighters' numbers, and the marks
  needed (A-Z, 0-9, `. & -`, A E O with umlauts, O with a slash, A with a ring, for German and Scandinavian names).
  Styles: gilt on black with a shadow (big ships), white on black (steamers, tugs), cream shaded with a drop shadow
  (barges, hengsten), white block letters painted on a plank (lighters), small hand-painted letters (small boats),
  half-scraped (the old boat). Atlas `boat_names.png` 2048x2048, cells 512x128 (64 cells), linear with mipmaps,
  lettering flat (no bump: the `flatLettering` rule in `bumps.ts`).
- **Files:** `tools/blender/boats/lettering.py` (new), `shared/fleet.json` (the names, with W0), a preview sheet in
  the helper's scratch folder.
- **Verify.** The preview sheet; each cell readable at its board's real size from 10 m in a Blender close-up.
- **Risks.** A free font would be quicker, but it is third-party: only with Steve's OK, an open licence (OFL), and a
  line in `assets/ATTRIBUTION.md`. Default: our own glyphs.
- **Godot.** Nothing here.

### B0. Boat materials at high detail
- **Goal.** The boat atlas rebuilt at high resolution with relief: carvel and clinker planking with seams and trenails,
  tar with weed and barnacles at the waterline, riveted iron plating, copper sheathing with green, red lead, deck
  planks with caulking, canvas, tarpaulin, rope, rust runs, paint chips, wet bilge boards.
- **Work.** In `tools/blender/boats/common.py`, the painters at 512 px per cell in a 2048x2048 colour atlas, plus a
  height atlas made from the same pictures (the bump rule). In the browser, `boats.ts` material setup (lines
  489-520): linear filtering, mipmaps, anisotropy, the atlas bump in its cell (`psx atlas` already supports it).
  The lock and bridge models share these materials (`build_lock.py`, `build_bridges.py`) and get them for free.
- **Files:** `tools/blender/boats/common.py` (painters and materials only), `client/src/world/boats.ts` (489-520 only).
- **Verify.** Blender close-ups of three hulls; `bumpaudit()` and `__scheldemist.shaders()` in the browser
  (`problems` empty); Godot `--shaders`.
- **Frame budget.** About 32 MB more texture memory (colour and height with mips). Same materials, same shader kinds.
- **Godot.** Bake again (the still boats) and the models library (`tools/godot/models.mjs`).

### D1. Canal and vliet beds that read as mud
- **Goal.** Survey 15: dark wet Scheldt silt, a trickle in a winding channel, pools that keep water at low tide, ripple
  marks, a green and black tide band on the walls, debris (a broken basket, a cart wheel, a chain, bottles, an old
  grapnel), a dark stain under each sewer outfall, boats tilted on the mud.
- **Work.** `tidemud.ts`: a sculpted bed (a channel 0.3 m deep along the middle, rising 0.4 m to the walls, pools at
  fixed hollows), at 1 m cells, its height in a texture; the material darker and only shiny where it is wet (wetness
  from the height under the current water and the time since the water left it). The channel and the pools get a
  small water sheet of their own (`attach` to the existing mirror; never a new mirror). Textures from a new
  `tools/textures/mud_maps.py` (1024 px colour and height, our own). The outfalls: an arched opening with a dark run.
- **Files:** `client/src/world/tidemud.ts`, `tools/textures/mud_maps.py` (new), `client/public/textures/mud_*`,
  `client/src/world/outfalls.ts` (new). Wet-band and wetness switches come from D3.
- **Verify.** Both games at -5.20, -4.70 and -2.80, midday clear and at night: `look-refs.mjs` views
  `vliet:-146,3,43,0,-25,16.5,clear` and `canal:-76,3,69,0,-25,16.5,clear` (and the survey's own views), Godot snaps
  with the same views; the boats on the bed tilt and none cut through it (W1's check).
- **Risks.** Steve asked for paths everywhere: the bed is not a walk area today. Leave it so, or run `paths()`.
- **Frame budget.** The bed is still: one mesh per canal, one material.
- **Godot.** Bake again; the pools' sheets need a line in `Waters.cs` (D3 owns it).

### D2. Quay walls, copings and the tide's marks
- **Goal.** Walls that read as 1873 Antwerp: bluestone (arduin) copings with rounded edges and iron cramps, brick or
  coursed ashlar faces in level courses that run on round corners, lime joints, rust runs under rings, white salt
  bloom above the high-water line, a wet dark band that dries slowly after the ebb, green weed between half tide and
  low water, black mussels and weed at the foot, timber rubbing fenders on the working quays.
- **Work.** `city.ts` quay section: one continuous u along each quay ring (no break at corners), stones in level
  courses, the emissive wash removed, a height map; `quaysteps.ts`: the bands as a texture layer, not just vertex
  colour; new `tools/textures/quay_maps.py` (colour and height, 2048 px, our own, replacing `quay_wall.jpg` and
  `quay_coping.jpg`). The wet band follows the last high water through a shared tide value (a D3 switch).
- **Files:** `client/src/world/city.ts` (291-399 only), `client/src/world/quayStone.ts`,
  `client/src/world/quaysteps.ts`, `tools/textures/quay_maps.py` (new), `client/public/textures/quay_*`.
- **Verify.** look-refs and Godot snaps at the Rijnkaai, the Werf, the vliet, the lock and the Petit Bassin at
  -5.20 and -0.65, midday clear and toward a gas lamp at night; `bumpaudit()`.
- **Frame budget.** Same material count; textures replace textures.
- **Godot.** Bake again.

### D3. Water surface and the shared shader switches
- **Goal.** Survey 10: no zigzag stamp, no bands, a soft wide sheen instead of the torch cone. And the small shader
  switches the others need.
- **Work.** A soft, detiled wave normal (two scrolling noise layers at different scales, turned against each other)
  in place of the 64 px dash texture (`textures.ts:139-147`); a lower, wider specular; the same in Godot's water
  (`Psx.cs:891-1293`). Switches for others, each fixed at material creation (rendering.md rule 3): `nameCell` (an
  instanced name plate picks its atlas cell from its instance colour; Godot from MultiMesh custom data) for W5;
  `tideWet` (one shared uniform: the last high water and the time since, for wet bands) for D1 and D2.
- **Files:** `client/src/retro/psx.ts`, `client/src/world/textures.ts` (water only), `client/src/world/rijnkaai.ts`
  water material lines (347-355 only), `godot/src/Render/Psx.cs`, `godot/src/World/Waters.cs`.
- **Verify.** Same views before and after in both games (lock, river from the Rijnkaai, basin), midday clear and in
  rain; `__scheldemist.shaders()` and Godot `--shaders`: `problems` empty, programs up by no more than the switches.
- **Frame budget.** Two texture reads more in the water; check `frameProf` at the Rijnkaai.
- **Godot.** C# and shader text.

### D5. The town wall brick
- **Goal.** Survey 16: level brick, no swirling streaks, soft irregular stains.
- **Work.** First a look-ref of `w05_rode_in` and `w08_joris_bridge` in the browser: if the browser has the streaks
  too, it is the model (UVs or height maps); if not, it is Godot (mottle, or the bump map's tiling). Then fix the
  cause: planar UVs on the scarp (`build_wall.py:849-855`), the radial arch mapping (`:2401`), a height map out of
  step with its picture (`townwall_maps.py`, checked by hash in `townWallBumps.ts`), or the mottle scale.
- **Files:** `tools/blender/build_wall.py`, `tools/textures/townwall_maps.py`, `client/src/world/townWallBumps.ts`,
  `client/src/world/rampart.ts`. If the cause is Godot's mottle, the change goes to D3 as a request.
- **Verify.** The two survey views in both games, plus a gate close-up; `bumpaudit()`.
- **Godot.** Bake again.

---

## 5. Phase 2 (parallel, after W0, B0 and W3)

Every B package works biggest to smallest inside its family, keeps the W0 contract (dims, extras, cap, walk, block,
name zones, budgets, far copy), and shows each kind in Blender close-ups, in the browser and in Godot. Loads use the
one model of their goods (`quaygoods.glb`, the sack swap): a sack, cask or crate looks the same in a hold, on a
pile, on a cart and in hands. Cabins and holds stay closed (doors shut, skylights dark or curtained): making one
enterable is big work and needs Steve's word first.

### B1. Ocean ships: liner, steamer, barque (and under sail), brig, schooner
- **Detail.** The liner: an iron screw steamer like the 1873 Vaderland (Palmers, Jarrow): plating with strakes and
  rivets, a clipper bow with a trail board, a counter stern with gilt name, deckhouses, skylights, cowl vents,
  davits with boats, one funnel with the line's band, four masts with yards and furled sails, ratlines, a bridge,
  anchors in hawses, an accommodation ladder. The steamer: a smaller iron cargo steamer with a well deck, winches,
  derricks and hatches. The barque and the brig: wooden hulls, copper below the waterline, a painted band with ports,
  a figurehead, catheads, channels and deadeyes, a deckhouse, a galley chimney, hatches with tarpaulins, a capstan,
  a ship's wheel, ship's boats on skids. The schooner: a Baltic or Groningen topsail schooner.
- **Differentiation.** Two barque variants (Norwegian timber barque with a deck load of deals; a German grain barque),
  two steamer variants (a British collier with a short funnel; a Belgian line steamer with a black and red funnel).
  New kinds need a row in `boats.ts BOAT_NAMES`, `river.ts` and the placing lines: ask the lead which places.
- **Files:** `tools/blender/boats/ships.py`; the brig's `DECK` and `RAMP` (`rijnkaai.ts:86, 106`) only if her deck
  moves.
- **Verify.** Close-ups; look-refs at the brig (-40, -7.2), the barque (-34, -26), the liner (0, -140), the steamer
  (-150, -62); Godot snaps of the same; W1's check; the brig walk (Godot `--ride-only water`).
- **Frame budget.** These are few (about 8 copies); their far copies matter on clear days from the Rijnkaai.
- **Godot.** Bake again and the models; `ShipWater.cs` tables (riding lights, pumps) if the hull shapes move.

### B2. Inland and harbour craft: Rhine barge, hengst (and under sail), sloop (and under sail), five lighters, pontoon
- **Detail.** The Rhine barge (Rijnaak): a long riveted iron or oak hull, the skipper's roof cabin aft with
  windows, curtains, a stove pipe, flower pots and washing, hatch boards, a mast in a tabernacle, leeboards. The
  hengst: a Zeeland fishing craft, round bow, leeboards, a wet well, nets. The sloop (hoogaars): a flat-bottomed
  Scheldt boat with a raked stem. The lighters: the harbour's open lichters, a forepeak cuddy with a stove,
  their loads (sacks, coal, sand, timber), heavy wales and fenders. The pontoon: tarred floats, plank deck.
- **Differentiation.** Two Rhine barge variants (German iron, Dutch wooden), lighters with different sheer and
  colours by owner.
- **Files:** `tools/blender/boats/inland.py`; `client/src/world/boats_sack_sockets.json` comes out of the build.
- **Verify.** look-refs at a Werf row (-290, -8), the Petit Bassin rows (70..170, 46..110) and the canal; the loaded
  lighter with no water inside; W1's check at all levels (the rows are the boats that sink into the toe mud today).
- **Frame budget.** The most copies (76 in rows): keep LOD0 near the budget, far copies for the dock's far side.
- **Godot.** Bake again; `lifeAboard` positions (Godot's people aboard) if the cabin moves.

### B3. Tugs and the ferry: tug, paddle tug, ferry "St. Anna", landing stage
- **Detail.** The screw tug: a towing hook and beams, a tall thin funnel, a wheelhouse open behind, fenders of rope.
  The paddle tug: paddle boxes with fan vents, a walking-beam or side-lever engine top, a bridge across the boxes.
  The ferry: keep her layout (the arrival reads her extras), raise her detail to the new materials, fix the stern
  board (`build_ferry.py:636`).
- **Files:** `tools/blender/boats/tugs.py`, `tools/blender/build_ferry.py`.
- **Verify.** The arrival scene in both games (Godot `--ride-only` ferry checks, `FerryArrival.Checks.cs`), the
  river tows, the lock with a tug (`__scheldemist.world.lock().passNow("in", ["tug"])`).
- **Godot.** Bake and models; the ferry extras must keep their names.

### B4. The small boats: gig, ship's boat, eel boat, work boat, rowboat, punt, bumboat, old boat, dinghy
- **Detail.** Real planking (clinker lands, carvel seams), frames, knees, thwarts, bottom boards, thole pins or
  rowlocks, a painter, a bailer; the punt square-ended with a quant pole; the old boat with a tin patch and standing
  bilge water (that water is part of the model, not the river).
- **Files:** `tools/blender/boats/small.py`, `shared/smallBoats.ts HULLS` (and the glTF extra "row" together, or the
  boat check fails).
- **Verify.** `__scheldemist.rowing.boatCheck()` at high and low water (61 boats, 116 ropes, 51 ladders, no problems);
  Godot `--ride-only hulls` (all nine hulls rowed); close shots of each at a ladder and on the mud.
- **Godot.** Bake and models; `RowPhysics.cs` hull numbers if HULLS changes.

### D4. Port life and mooring gear
- **Goal.** Survey 24: three or four dense work spots with lanes between them, bollards and rings along every edge,
  coils, fenders, gangplanks, and the big ships tied to the quay.
- **Work.** Work spots: the Anna Maria's berth on the Rijnkaai (sacks of coffee and sugar), the Werf (petroleum
  casks in rows: Antwerp's new trade of the 1860s and 70s), the Petit Bassin's east quay (Scandinavian timber in
  stacks, wool bales), by the Hessenhuis (hides, crates). Each with a tarpaulined stack, a hand barrow, a weighing
  beam, a tally clerk's desk. Every few metres along the working quays a cast-iron bollard (the cannon-shaped kind)
  or a ring; rope coils and fenders between. Mooring lines from every moored big ship and row boat to its bollards,
  sagging at high water and taut at low (`boatMoorings.ts` does this for the small boats).
- **Files:** `client/src/world/quayfurniture.ts` (layout), `tools/blender/build_quayfurniture.py`,
  `client/src/world/workspots.ts` (new), `client/src/world/shipLines.ts` (new), `rijnkaai.ts` (the old bollard and
  coil stand-ins at 2542-2553 only). Goods from `quaygoods.glb`, one model per good.
- **Verify.** `__scheldemist.paths()` empty, `stuck()`, `carrycheck()`; the D1 docks loop still runs (cranes, piles,
  dockers); look-refs of the Rijnkaai high view (survey `q05_rijnkaai_high`); Godot `--paths`, `--stuck`.
- **Risks.** The train, the omnibus and the dockers' lanes must stay free (D1 rule).
- **Frame budget.** Props instanced and merged per 64 m chunk (`quayfurniture.ts` does it); lines as one line set.
- **Godot.** Bake for the still props; the ship lines move with the tide: a C# port in `Movers/RopeLines.cs`.

### D6. Lock, Petit Bassin and Werf details
- **Goal.** The lock's mitre gates with balance beams and capstans, sluice paddles with racks, the keeper's hut,
  granite quoins at the gate recesses, the swing bridge in the new materials; the Werf crane and landing.
- **Files:** `tools/blender/build_lock.py`, `client/src/world/lock.ts` (visual parts only).
- **Verify.** A lock pass in both games (`passNow`, Godot `--ride-only navigation`); `fitTable()` unchanged.
- **Godot.** Bake again.

---

## 6. Phase 3

### W4. Boats at the right height at every tide
- **Goal.** W1's check empty in both games at every level.
- **Work.** The ten cases of 1.2: river rows and the wall lighter take the toe mud (`mudAt` like the small boats);
  the ladder climb aims at `max(level, floor)`; a drifted boat gets the floor of her new spot; chamber boats use the
  slope; crane loads use the ship's floor; the build-time heights become live; the bed mesh and `CANAL_BED` agree.
  Godot: boats follow the drawn sheet's eased level (one level in `Tide.cs`, read by both), and the storm surge.
- **Files:** `client/src/world/boats.ts` (`place`, `writeFleet`, `mooreAlong` floors), `client/src/world/tide.ts`,
  `client/src/game/rowing.ts` (climb target, drift floor), `client/src/world/railway.ts` (load heights),
  `client/src/world/anchorage.ts` (the wall lighter), `client/src/world/pier.ts`, `client/src/world/steenlife.ts`,
  `godot/src/Movers/Boats.cs` (floating parts), `godot/src/World/Tide.cs`, `godot/src/World/Waters.cs` (after D3).
- **Verify.** W1's check in both games; boat close-ups at -5.20 and -0.40; the clock jump in Godot (`skip 120`) with
  no boat off the water.
- **Godot.** C#.

### W5. Names on the hulls
- **Goal.** Every vessel shows her own name and port, readable, never mirrored, never doubled in one view.
- **Work.** `client/src/world/boatNames.ts` (new): at load, each name zone of each placed vessel points at her cell
  in `boat_names.png` (single vessels: their own small mesh; rows and fleets: one instanced plate set per style
  with the cell in the instance colour, D3's `nameCell`). Godot: `Movers/Boats.Names.cs` (new partial), MultiMesh
  custom data. The server's ship text is brought in line with `shared/fleet.json`: `server/src/mapview/demo.ts`,
  `server/src/director/hiring.ts:87`, the emigrants' poster (`emigrants.ts:372`), the newspaper's arrivals
  (`newspaper.ts:59-62`) take their names from the registry where a ship is in port.
- **Files:** `client/src/world/boatNames.ts` (new), a two-line hook in `boats.ts`, `godot/src/Movers/Boats.Names.cs`
  (new), the server files above, `shared/fleet.json`.
- **Verify.** A list from the game: every placed vessel with her name and cell, no two the same within 200 m; close
  shots of a bow, a stern and a paddle box in both games at 10 m and 40 m; server tests for the paper and the map.
- **Godot.** C#.

### W6. Jump on, walk on, use: Godot
- **Goal.** Jef jumps off any quay onto any deck or into any boat, walks on it while it heaves, rolls and rises with
  the tide, and presses E to use it.
- **Work.**
  - `MeshDeck` reads `<kind>_walk` and `<kind>_block` (W0) instead of scanning the whole model; every kind gets a
    deck, small boats and the pontoon too (`ShipWalk.cs:36` filter gone).
  - Hired and owned rowing boats and the moving punts register as decks (`ShipWalk.I.Add`).
  - The drop rule: a step down up to 1.3 m, a jump down up to 3.6 m (as today), a hard landing with a stumble from
    2.5 m (`Play/Falls.cs`); more than 3.6 m only by a ladder or steps (at low water a small boat lies 4-5 m down).
  - On a deck, E offers what the boat can do: "row" (rowboat, dinghy, gig, ship's boat, work boat, eel boat,
    bumboat, old boat: `Rowing.Sit` from the deck, the same hire and theft rules on the server), "pole" (punt: a new
    `Play/Punting.cs` drive, the quant pole on the bed, refused where the water is too deep), "sit" (on a hatch or a
    cabin top of a barge or lighter: a seat pose, the view free), "leave" (to the quay by steps or ladder, into the
    water, or a jump). Getting up from a seat goes back to the deck, not to the quay.
  - The camera rolls a little with the deck (`DrivenRoll`).
  - Multiplayer: a player on a deck is sent in the vessel's frame (vessel id and local position, like the
    omnibus's local frame) so another player sees him on the same deck.
- **Files:** `godot/src/Play/ShipWalk.cs`, `ShipWalk.Gangway.cs`, `godot/src/World/MeshDeck.cs`,
  `godot/src/Play/Rowing.cs`, `Rowing.Approaches.cs`, `godot/src/Play/Punting.cs` (new),
  `godot/src/Play/BoatSeat.cs` (new), `godot/src/Play/Falls.cs` (the landing), `godot/src/Player/Jef.Transport.cs`
  (one roll hook), `godot/src/Play/RideTest.cs` (a new `--ride-only decks`).
- **Verify.** `--ride-only decks`: at -5.20, -2.80 and -0.40, a jump from the quay onto every kind that lies at a
  quay (where the drop allows), 10 m of walking on a moving and a bobbing deck, E to row, pole and sit, and back;
  close pictures inspected; 10,000 drive calls allocate 0 bytes; `--paths` and `--stuck` pass.
- **Frame budget.** Deck lookup through a cell list of nearby hulls, nothing per hull per frame; no allocations.

### W7. Jump on, walk on, use: browser
- **Goal.** The same in the browser and the web demo.
- **Work.** `client/src/game/shipWalk.ts` (new): the decks from `<kind>_walk` and `<kind>_block`, a floor grid per
  kind at load, the live frame of each hull, `firstPerson.ts rideStart` / `RideWalk` / `carryTo` and the `onJump`
  chain; the same offers and drop rule as W6; rowing starts from the deck (`rowing.ts board`/`sitIn` from a deck,
  `exitHere` back to the deck).
- **Files:** `client/src/game/shipWalk.ts` (new), `client/src/player/firstPerson.ts` (hooks only),
  `client/src/game/rowing.ts` (after W4), `client/src/main.ts` (wiring), the web demo build (`docs/web-demo.md`).
- **Verify.** A test kit step per kind (`t.deck(kind)`), browser pictures at three tides, `paths()`, the web demo
  built and checked (`node tools/demo/build.mjs --base / --out client/dist-demo` from PowerShell).
- **Frame budget.** `frameProf` at the Rijnkaai with Jef on the brig and on a lighter.

---

## 7. Names: who gets what

All names are of the kind the ships of the 1870s carried; owners are invented, no living people. The registry
(`shared/fleet.json`) gives each placed vessel one name; no name twice in the harbour. Real ship names of the time
(Vaderland, Hammonia) are left to the newspaper and the posters, so no hull pretends to be a real one.
Merchant Shipping rules of the time (British 1854 act, copied by most lines): the name on both bows, the name and the
port of registry on the stern. Fishing marks (letters and numbers) came only with the 1882 North Sea convention:
none on the hengsten.

| Kind | Flag and home ports | Names | Lettering |
|---|---|---|---|
| liner (1) | Belgian; ANTWERPEN | KEMPENLAND (keep: the line's "-land" names) | gilt Roman capitals on black, bow and counter; scrollwork on the trail board |
| steamers | British: HULL, GOOLE, LEITH, NEWCASTLE, LONDON; Belgian: ANTWERPEN; German: HAMBURG, BREMEN; Dutch: ROTTERDAM | HUMBER LASS, OUSE, TYNESIDE, CITY OF LEITH, LADY ALICE, STAD ANTWERPEN, VILLE DE GAND, SCHELDESTAD, WESER, ELBE, MAAS | white Roman or slab capitals on the black bow, gilt on the stern |
| barques | Norwegian: ARENDAL, GRIMSTAD, DRAMMEN, CHRISTIANIA, LILLESAND, TVEDESTRAND; German: BREMEN, ELSFLETH, HAMBURG; Swedish: GEFLE, GOTEBORG (with the ring) | FREMAD, HAABET, NORDSTJERNEN, ELLIDA, FAMILIEN, SVANEN, JOHANNE, CONCORDIA, GERMANIA, HOPPET, FREJA | white or gilt Roman capitals on the transom, carved and painted bow boards |
| brig (1) | Belgian; ANTWERPEN | ANNA MARIA (keep: the game knows her) | gilt on black, a carved stern board |
| schooners | Danish: MARSTAL; English: FOWEY, PADSTOW; Dutch: GRONINGEN, DELFZIJL | THYRA, DAGMAR, MARY ANN, ELIZA JANE, VROUW ALIDA, DE JONGE JAN | white serif on the bow and transom |
| Rhine barges | German: RUHRORT, DUISBURG, MANNHEIM, KOLN (with the umlaut), EMMERICH; Dutch: NIJMEGEN | GOTTES SEGEN, DREI GEBRUDER (with the umlaut), MATHILDE, FORTUNA, ST. NIKOLAUS, WILHELMINA | large cream capitals with a drop shadow on the bows; the owner and port on the stern ("J. W. HAAS / RUHRORT") |
| hengsten | Zeeland: ARNEMUIDEN, BRUINISSE, YERSEKE, TERNEUZEN; Scheldt villages: DOEL, LILLO | TWEE GEBROEDERS, JONGE PIETER, DE VERWACHTING, HOOP OP ZEGEN, SINT-PIETER, DE VLIJT, DE HOOP | cream shaded capitals on the bow, port on the stern |
| sloops (hoogaars) | DOEL, LILLO, BATH, KALLO | MARIA, ZEEMEEUW, DRIE GEZUSTERS, ZWALUW | small white serif on the bow |
| lighters | owners of Antwerp, BOOM, TEMSE, RUPELMONDE, HEMIKSEM | SINT-JOZEF, NOOIT GEDACHT, DE TOEKOMST, LEOPOLD, VOORUIT, DRIE GEBROEDERS, plus a number ("No 12") | white block letters on a black plank; the owner and port on the stern ("H. VERSTRAETEN / BOOM") |
| tugs | ANTWERPEN | HERCULES, SIMSON, TITAN, ATLAS, ANTVERPIA, VOLHARDING | white slab capitals on the bow, gilt on the wheelhouse board |
| paddle tug | ANTWERPEN | SCHELDE (no longer ST ANNA) | gilt, curved round the paddle boxes |
| ferry (1) | ANTWERPEN | ST. ANNA (keep: the left-bank crossing to Sint-Anna) | curved on the paddle boxes, a stern board facing out |
| ship's boats | their ship | the mother ship's name (ANNA MARIA, FREMAD ...) on the transom | small white serif |
| gig | water police | POLITIE / No 2 | white on black |
| work boats, eel boats | their village | home port only, or a short name (DE PALING for an eel boat) | hand-painted |
| rowboats, punts, dinghies, bumboats | Antwerp | short pet names, some none: MIE, ROSALIE, KLEIN JAN, LIEVEKE, TRIENTJE | small hand-painted letters, worn; the bumboat a trade board ("BROOD - BIER") |
| old boat | none | half-scraped letters (an old name worn away) | faded |

---

## 8. Phase 4: integration and proof

1. The lead rebuilds `boats.glb` and `ferry.glb` after each merge; `glbhash.mjs` lists what changed.
2. Bake again: `node tools/godot/export-scene.mjs` (about 10 minutes) and the models (`tools/godot/models.mjs`).
3. Browser: `node tools/perfcheck.mjs` (every place within the budget), `__scheldemist.shaders()` (problems empty),
   `bumpaudit()`, `paths()`, `stuck()`, `rowing.boatCheck()`, `boatWater()` at every level.
4. Godot: `node tools/godot/checks.mjs --town godot/baked/next/town.glb --models godot/baked/models` (devtest, paths,
   stuck, shaders, perfcheck, clocks, interiors) plus `--boatcheck` and `node tools/godot/ride-check.mjs --out
   decks-final` (water, navigation, hulls, decks).
5. Pictures: one look-ref and one Godot snap per kind at -5.20, -2.80 and -0.40, midday clear (survey views where
   they exist), set side by side.
6. A browser run by hand on a test copy (`node tools/teststack.mjs start`, `docs/testing.md`), the audio closed after.
7. `CHANGELOG.md` lines under Unreleased in each commit (plain English); finds outside a task go to issues.
8. The web demo built, checked, `gh workflow run pages.yml --ref main`, the live page checked; say what did not fit.

## 9. Frame budget notes

- Browser frames are already about 30 ms at the busy places (Godot 4.5-8 ms). The cost is per draw and per material
  switch, not per triangle: keep the instanced fleets (3 draws a kind), shared materials, at most 4 a hull.
- Triangles: the start budgets in W0, far copies past 60 m. Measure the Rijnkaai, the Werf and the Petit Bassin
  (`frameProf`, Godot `--perfcheck`) before and after each B package.
- Texture memory: about 32 MB for the boat atlas, 16 MB for the names, 10-20 MB for the quay and mud maps.
- No new lights (boat lanterns stay spill sources, `lanternLights.ts addLantern`); no new mirrors (the canal pools
  `attach` to the existing one); new shader kinds only the D3 switches, built at load.
- Godot: no allocations per frame (no LINQ, lambdas, new lists); materials made at load; deck lookups through cells.
- A look change is not a speed change: no pixel-diff proof needed, but Steve sees the pictures.

## 10. Licences

Everything in this update is our own work: models and textures made by script (Blender, Python), as the boats are
today. A third-party asset (a font, a texture, a model) enters only with a clear licence, noted in
`assets/ATTRIBUTION.md`, and only after Steve's OK; prefer making it ourselves. The existing `quay_wall.jpg` and
`quay_coping.jpg` (Codex pictures, M7 quays) are replaced by our own maps in D2; note the change in ATTRIBUTION.md.
ArtCraft is not installed and not to be used.

## 11. Issues to file (outside these packages)

- The ferry's stern board faces inward (`build_ferry.py:636`): fixed in B3, but file it so the changelog can link it.
- The `_bare` copies have no caps (`build_boats.py:4826-4830`): fixed in W0.
- Godot hides the hull caps (`Movers/Boats.cs:156-159, 254`): fixed in W2.
- The server's ship names disagree with the hulls (`server/src/mapview/demo.ts:70-72`): fixed in W5.
- The vliet looks dry at half tide in Godot (`r1/q18_vliet_mid.png`, 13:00): W1 settles it.
