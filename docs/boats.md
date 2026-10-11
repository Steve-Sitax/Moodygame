# Boats: the model contract

The one place for the rules every boat model keeps. A builder that breaks one of them also changes
every reader listed under "Who reads a boat" in the same piece of work. The plan that set these rules
is `docs/plans/next-update.md` (W0); the names of the placed vessels are in `shared/fleet.json`.

## Who builds what

| File | Builds |
|---|---|
| `tools/blender/build_boats.py` | the driver: the list of models (`BUILDERS`), the build, the export to `client/public/models/boats.glb`, the previews |
| `tools/blender/boats/common.py` | the mesh builder, the hull loft (`Hull`), the water cap (`cap_object`), the painters and materials, small parts (spars, sails, name boards, houses, barrels, sacks, lanterns, fenders, the open boat's hull and the ship's boat on deck) |
| `tools/blender/boats/ships.py` | liner, steamer, barque (and `barque_sail`), brig, schooner |
| `tools/blender/boats/inland.py` | Rhine barge and hengst (`barge`, and `hengst_sail`), the five lighters, the sloop (and `sloop_sail`), the pontoon section |
| `tools/blender/boats/tugs.py` | tug, paddle tug |
| `tools/blender/boats/small.py` | rowboat, dinghy, ship's boat, gig, bumboat, old boat, punt, work boat, eel boat |
| `tools/blender/boats/cranes.py` | portal crane and hand crane (in `boats.glb`, not boats) |
| `tools/blender/build_ferry.py` | the ferry St. Anna and the landing stage, into `ferry.glb` |

Run: `blender -b --factory-startup -P tools/blender/build_boats.py` (and `build_ferry.py`). `build_ferry`,
`build_lock`, `build_bridges` and `build_wall` import `build_boats` as `bb`: the driver re-exports every
name of the package, so a helper moved between the package files needs no change there.

A helper commits the Python only. The lead rebuilds `boats.glb` and `ferry.glb` after each merge and
compares them with `node tools/blender/glbhash.mjs <glb>` (same mesh, same hash; Draco output is stable
from one build to the next).

## Frame and units

- Metres, real size.
- Origin at the middle of the waterline: x = 0 on the centre line, y = 0 halfway along the hull,
  z = 0 the waterline she floats at. The game sets the origin on the water level (or the mud floor).
- Bow toward -Y in Blender, +Z in the game (the glTF export turns Blender (x, y, z) into (x, z, -y)).
- Port is +X, starboard -X (in Blender and in the game). The red side light sits on +X.
- Hull stations in `Hull` run t = 0 at the stern to t = 1 at the bow.

## Sizes

Length and beam are the game's own measure (`boats.ts dims()`: the footprint of every part below 2.4 m,
so bowsprits and yards up high do not count). Keel: the lowest point under the waterline. They stay
within 0.1 m of these numbers unless the work also updates every reader. Triangles: today's model
without its cap. Budget: the start value for the high-detail models (perfcheck decides), each with a far
copy.

| Kind | Length | Beam | Keel | Height | Tris today | Budget | Far copy |
|---|---|---|---|---|---|---|---|
| liner | 102.37 | 11.73 | -6.00 | 39.5 | 6,419 | 120k | 20% past 60 m, under 10% past 150 m |
| steamer | 58.49 | 8.38 | -3.80 | 27.0 | 4,219 | 70k | 20%, under 10% past 150 m |
| barque, barque_sail | 51.43 | 9.72 | -4.20 | 38.8 | 4,820 / 4,674 | 90k | 20%, under 10% past 150 m |
| brig | 39.91 | 8.99 | -3.00 | 33.4 | 3,694 | 70k | 20% |
| rhine_barge | 36.20 | 6.71 | -2.03 | 12.0 | 2,662 | 30k | 20% |
| schooner | 28.60 | 6.53 | -2.60 | 20.1 | 1,454 | 45k | 20% |
| ferry (`ferry.glb`) | 26.5 overall | 7.41 | -1.35 | 11.7 | 10,595 | 40k | 20% |
| hengst, hengst_sail | 23.35 | 5.97 | -2.25 | 17.5 | 2,672 / 2,616 | 25k | 20% |
| tug | 21.06 | 5.06 | -2.16 | 9.2 | 1,632 | 30k | 20% |
| paddle_tug | 21.06 | 6.51 | -2.10 | 9.2 | 1,148 | 30k | 20% |
| lighter (and _loaded, _coal, _sand, _timber) | 18.40 | 4.88 | -0.80 | 4.8 | 1,460 to 3,640 | 12-18k | 20% |
| sloop, sloop_sail | 15.35 | 4.24 | -1.56 | 10.8 / 11.9 | 1,562 / 1,656 | 15k | 20% |
| pontoon_section | 10.00 | 4.80 | -0.80 | 2.9 | 624 | 3k | none |
| gig | 8.68 | 1.42 | -0.22 | 1.9 | 1,918 | 4-8k | 20% |
| eelboat | 7.65 | 2.10 | -0.16 | 0.8 | 1,060 | 4-8k | 20% |
| workboat | 7.28 | 1.90 | -0.16 | 0.7 | 756 | 4-8k | 20% |
| shipsboat | 7.25 | 1.94 | -0.26 | 0.9 | 1,372 | 4-8k | 20% |
| punt | 7.00 | 1.39 | -0.12 | 0.6 | 690 | 4-8k | 20% |
| rowboat | 5.89 | 1.59 | -0.24 | 0.7 | 1,413 | 4-8k | 20% |
| bumboat | 5.45 | 1.99 | -0.25 | 1.5 | 2,492 | 4-8k | 20% |
| oldboat | 5.34 | 1.54 | -0.24 | 0.7 | 1,232 | 4-8k | 20% |
| dinghy | 5.07 | 1.66 | -0.24 | 0.9 | 1,358 | 4-8k | 20% |

Deck and seat heights are read by the game, so they move only together with their readers: the small
boats' glTF extra `row` and `shared/smallBoats.ts HULLS` (the boat check compares them), the brig's
`deck` extra and `rijnkaai.ts DECK` / `RAMP`, the pontoon's `deck_top`, `half_width`, `length`
(`PONTOON_DECK` 1.8 m), the barges' cabin for `lifeAboard.ts`.

## The nodes of a model

One top-level node per model, named by its kind (`lighter_loaded`), with its extras: `rig` (rigging as
line segments), `lamps`, `smoke`, `stove`, `row`, `deck`, `hawse` and the like. Its children:

| Child | What | Drawn |
|---|---|---|
| `<kind>_cap` | the water cap: one n-gon on the inner rail line (`Hull.rim()`, 3 cm under the sheer), material `cap`, facing up | never in colour: written to the stencil before the water, so no water shows inside the hull |
| `<kind>_stow` | the parts laid in (oars, a dinghy's mast), hidden while the boat is rowed | yes |
| `<kind>_walk` | (new, from B1-B4) the walkable deck, bottom boards and hatch tops as triangles | no: read by `MeshDeck` (Godot) and `shipWalk.ts` (browser) |
| `<kind>_block` | (new, from B1-B4) boxes for masts, deckhouses, hatches, winches: what a walker cannot pass | no |
| `<kind>_far` | (new, from B1-B4) the far copy, about 20% of the triangles | past 60 m, in place of the model |
| `<kind>_name_bow_p`, `_name_bow_s`, `_name_stern`, `_name_box_p`, `_name_box_s` | (new, from B1-B4) the name zones (below) | yes, through the names atlas |
| `jib`, `hand_crane_jib` | cranes only: the turning part, its origin on its axis | yes |

Every hull has a cap, and the cap follows the rail: on a heeled hull (under sail) it stays under the
rail cap. The browser finds the cap by its material `cap`; Godot and the rowing code by the name ending
`_cap`; the stowed parts by the name ending `_stow`.

**The hidden children.** A builder makes `_walk`, `_block`, `_far` and the name zones through its Mesh's
`finish(name, ob, objs)`, which `build_boats.py hull_parts` calls for the model and for its `_bare` copy
(`boats/inland.py Contract` does it for the inland craft). The browser takes the nodes ending `_walk`,
`_block` and `_far` out of the drawn models at load and keeps them in `ModelSet.aside` (`boats.ts
loadModelSet`); Godot's model library hides them (`ModelLibrary.IsAside`) and `MeshDeck` skips `_far` and
`_block`. After the zones change, run `python tools/blender/boats/lettering.py` again so the names atlas
lays its cells out for the new board shapes.

**The `_bare` copies.** A model with recorded sacks (`lighter_loaded`, `bumboat`; the ferry and the
landing stage in `ferry.glb`) is built a second time without them as `<kind>_bare`, and the game draws
that copy with the one sack model in each sack's place (`game/sackModel.ts`, `docs/sacks.md`). The copy
has the same children as the model: `<kind>_bare_cap`, `<kind>_bare_stow`, and later the walk, block,
far and name nodes. Before 2026-10-11 the copies had no cap and no stow, so the loaded lighter and the
bumboat showed the river inside them and the bumboat had no oars.

## Name zones

A vessel's name is not painted into her model: one model serves many vessels, each with her own name
(`shared/fleet.json`). Instead each hull carries name zones, and the game points each zone at the
vessel's cell in the names atlas (`boat_names.png`, 512 x 128 px cells, W3; the pointing is W5).

- Each zone is its own quad (or a strip of quads following the planking, or curved round a paddle box)
  with UVs that fill 0..1: u = 0 at the reader's left, u = 1 at the reader's right, v = 0 at the
  bottom, v = 1 at the top.
- Every board winds outward: its front face looks out of the hull, so it is never culled from outside
  and never seen mirrored from inside. On the port bow the text runs from bow to stern, on the
  starboard bow from stern to bow (as a reader standing alongside sees it).
- `_name_bow_p` and `_name_bow_s`: the name on both bows. `_name_stern`: the name and the port of
  registry (the owner and port on Rhine barges and lighters). `_name_box_p` and `_name_box_s`: the
  paddle boxes of the paddle tug and the ferry.
- The root node's extra `name_zones` gives each zone's size in metres, `{"bow_p": [w, h], ...}`, so the
  lettering can be fitted to it (a cell is 4:1).
- Lettering is flat: no bump in its cell (`flatLettering`, `client/src/world/bumps.ts`).

The registry gives each vessel a lettering `style` (`shared/fleet.json` lists them): gilt Roman on black
for big ships, white Roman or slab capitals for steamers, schooners and tugs, cream shaded capitals for
barges and hengsten, white block letters on a plank for lighters, small hand-painted letters for the
small boats, a half-scraped name for the old boats.

## Materials, textures and lines

- At most 4 materials a hull, shared by every hull: the boat atlas, the names atlas, sails and
  canvas (double-sided, cut out), glass. Today the builders still use the long material list in
  `common.py` (`MATS`) and the browser packs it into one atlas at load (`boats.ts loadModelSet`); B0
  turns it into the atlas pictures at 512 px a cell with a height atlas for the bump.
- Textures linear, with mipmaps (`docs/05-art-direction.md`); bumps from the surface's own picture
  (`docs/rendering.md`).
- The vertex colour `Col` carries the baked shade and the waterline grime; the game multiplies it in.
- Rigging stays lines: the extra `rig`, drawn with `ropeMaterial` (one line set a model), never tubes.

## Who reads a boat

These change together with a model: `shared/smallBoats.ts HULLS` (and the extra `row`),
`shared/lockfit.ts`, `client/src/world/anchorage.ts` clearances, `river.ts` lanes,
`boats_sack_sockets.json` (written by the build), `rijnkaai.ts DECK` and `RAMP`, `railway.ts` crane
holds, `lifeAboard.ts`, the lantern extras (`boats.ts lamps()`, Godot `BoatLamps.cs`), Godot
`ShipWater.cs` (riding lights and pumps), `ShipWalk.cs` and `MeshDeck.cs` (decks from the model),
`RowPhysics.cs` (the nine small hulls).

## The fleet registry

`shared/fleet.json` lists every vessel the game places, with `id`, `kind`, `name`, `port`, `flag`,
`style`, and `where`: which code placed her (`how`: `place`, `row`, `pontoon`, `anchorage`,
`anchorage_tow`, `river`, `lock`, `ferry`, `mooring`, `loose`, `hire`, `passage`) and the keys that pick
her out (a row's seed and slot, a river model and its copy number, a mooring id). `at` is where she lay
when the registry was written, a check only. No name is used twice; a ship's boat carries her mother
ship's name (`of`). `spare` holds names for copies the registry does not list (a river pool that grows,
a row slot that appears after a size change), by kind; `family` maps the sailing and loaded copies to
their kind's list. Multiplayer boats of other players are the same small boats, by their ids.
