# Street furniture · 19 October 2026

Issues #160 (the old wooden-looking pump and trough), #149 (the flat cellar hatch in the gutter) and #164 (the washing lines:
flat cloth cards on a straight stick).

## Cause

The bake drew its street pumps (a blue-stone pillar pump, read as a square wooden post with a pointed cap, and a plain
cast-iron one), its horse troughs, its cellar hatches, its washing lines and wash poles as boxes and flat cards merged into the
street-life and clutter meshes (browser `streetlife.ts`, `clutter.ts`). A hatch was laid on the plan's wall line at street
level: on a raised pavement it lay under the paving with its front strip showing in the gutter; on a street it lay as a box
away from the house. A washing line was two crossed ribbons; each piece one card (2 to 8 triangles). The courts' pumps
(washerwomen's pumps, churches group) were a coarse 8-sided column with a stone box.

## What changed

- Found in the meshes by each prototype's uv run (`find_protos.py`, `extract.py`: whole copies and copies the paving and
  shop-front passes had cut), the lines by the rope cell, and taken out (`native-godot/scripts/repair_street_furniture.py`):
  8 pumps (3 pillar, 5 iron), 4 troughs, 166 hatches, 229 lines (182 street-life, 47 clutter), 1,203 pieces of washing,
  39 wash poles; 31,884 triangles from 66 meshes. Nothing that looks like washing is left over 2 m.
- Each place measured in the real town (`NativeStreetFurnitureSurvey.cs`: 46,035 rays for the walls and ground round every
  old piece, the old pieces passed through; then 4,096 check rays over every new footprint) and planned
  (`native-godot/scripts/plan_street_furniture.py`, `world/town/furniture/street-furniture.json`).
- Pumps (#160): all 24 (8 street, 16 courts) are now the street-props kit's cast-iron pump with its stone basin
  (`street-pump-iron`, one model everywhere, as on the Vismarkt), at the old place and facing, on the ground. The courts'
  old copies are hidden at load (their nodes and ids stay in the scene). The washerwomen's places and the pump sounds come
  from the plan's coordinates, not the meshes: unchanged. (There is no drinking from a pump in the game; nothing to keep.)
- Troughs: a new blue-stone horse trough (2.00 x 0.70 m, 0.62 m, as before): one block, a proud worn rim (14 mm arrises), a
  rounded basin, water 7 cm under the rim, a footing; solid as a box.
- Hatches (#149): the kit's cellar hatch model is replaced in place (`props/cellar-hatch.tscn`, same node ids; the brewery's
  authored hatch gets it too): a cast-iron angle frame 1.10 x 0.44 m, its top 3 mm over the paving, two oak leaves of four
  boards each with grain and wear, strap hinges with domed bolts, a drop ring in a staple by the meeting rail; a convex
  collision box, walkable. 162 hatches stand with the frame's back 8 mm off the house front (its plinth or stall riser,
  measured 0.35 and 0.9 m up) and the hatch on the pavement's top (120) or on the setts at the wall (42; 2 cm up, where the
  setts' relief would draw over a lower frame). 4 are left out: the pavement there is narrower than the hatch or runs onto a
  step (`cellar-hatch-32`, `-105`, `-139`, `-142`).
- Washing (#164, `art-source/tools/blender/build_laundry.py`): one model per piece, each cut as a pattern and let fall on
  its line by Blender's cloth simulation, 2.5 mm thick (wool 3.5-4 mm), folds, creases, a sagging top between the pegs:
  shirt, shift, trousers, apron (with ties), a pair of stockings, a sheet and a towel over the line (red woven stripes).
  Linen, twill and blue-striped ticking pictures; each copy dyed (undyed and bleached linen, indigo work cotton, brown and
  grey wool). A turned beech dolly peg on each peg point; a hemp rope (laid strands) sagging between two forged eye bolts
  with rings, leaded into the walls, the rope knotted on; wash poles are an ash pole with two pieces.
  `NativeStreetFurniture.cs` places them: MultiMeshes per 32 m cell (pieces 90 m, pegs 28 m, rings 36 m), no collision.
  226 lines, 1,166 pieces on lines and 78 on 39 poles, 2,432 pegs. The line ends were moved onto the wall faces they were
  tied to (moved 0.6 m at most). The new pieces are wider than the cards, so they are spaced again from their old middles;
  11 lines lost one piece for room. Clearance: 22 lines over the omnibus's streets hang one storey higher (both houses go
  up that far), their pieces at least 3.7 m up (the omnibus is 3.33 m); elsewhere a piece hangs at least 2.6 m up
  (2.15 m in the back lanes); 54 pieces were changed for a shorter kind to keep that. 3 lines were tied to houses pulled
  down after the bake: they and their washing are gone (`line144`, `line146`, `line155`).
- The cloth is Psx's wet-paint kind (`wet_paint` 1.25: darker in rain) and sways in the wind: `Psx.ClothSwayVertex`, off
  unless a material sets `cloth_sway`; written into r000211 by `scripts/ClothSwayRepair.cs` (one kind changed in place).
- Every list (pumps, troughs, hatches, each line's ends and pieces, poles): `street-furniture-list.json`.

Edges (AGENTS.md): stone arrises 10-14 mm, cast iron 2 mm, oak boards 2.8 mm, straps 1.5 mm, the peg turned. The cloth is a
thin sheet: its rim is its thickness (an exception by its construction).

## Checks (real town, disposable saves, 2026-10-19)

- Pictures (some brightened for viewing only): `160-pump-trough-before-after.jpg`, `149-hatch-before-after.jpg`,
  `164-washing-before-after.jpg` (day; rain and night after).
- Shader check: PASS, 150 kinds, none new; one changed in place (`shader:39CE47A6510CE729` -> `shader:43E17AB42A4AAC86`,
  baseline updated).
- Stuck check (seed 1873, three hours): PASS, 942 watched, 0 stuck, 0 overlaps, 0 inside solids.
- Frame time (PERF-LOCK held, but another helper's game window was open: whole frames are contended), candidate against the
  original in one session, two passes each, five views (the three cells with most washing, the pump, a street line): GPU
  +0.01 to +0.47 ms per view (1.88 -> 1.90, 2.99 -> 3.05, 2.32 -> 2.38, 2.83 -> 3.16, 2.53 -> 2.65), draw calls +90 to
  +330, primitives +0.1 to +0.8 M; whole frames 19-32 ms in both states (set by the CPU); video memory +8 MB.

## Install

`scripts/store-laundry.ps1` builds the models and stores the `laundry` pack and the hatch. `facades-promote.tscn -- --candidate
<c> --record <r> --backup <outside git> --root streetlife,clutter` installs the meshes and the plan; `cloth-sway-repair.tscn
-- --backup <outside git>` the shader. `promotion.json` has every original and installed hash; the originals are kept outside
the repository and in git at the commit before this one. Never rebuild from installed meshes.

## Not done

- Residents do not take their washing in at night or in rain (the issue's "later").
- The boats' washing (barges' lines) keeps the boats' own cards.
- 23 wash-pole pieces had no room on the 1.75 m pole (two pieces each now).
