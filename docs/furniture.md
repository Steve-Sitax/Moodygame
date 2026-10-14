# Furniture kit (interiors, 1873)

High-detail furniture for the town's interiors: taverns, homes, shops, cafes and the halls of working-class and
middle-class Antwerp in 1873. Made in Blender Python by `art-source/tools/blender/build_furniture.py` and the modules
in `art-source/tools/blender/furniture/`. This file is the contract between the kit (helper furn-kit) and the editor
library that turns its pieces into placeable assets (helper furn-editor). Plan: `docs/plans/people.md`, "Street
models: the worst 15", rank 1 and package I1.

## Build

```powershell
& "C:/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --factory-startup --python-exit-code 1 `
  -P art-source/tools/blender/build_furniture.py -- [--only chair-ladderback,table-square] [--sheets] [--room] [--fast]
```

- Writes `art-source/client/public/models/furniture/<family>.glb` and `furniture.json` (the manifest) there.
- `--sheets` renders a check sheet per piece, `--room` the room arrangements; pictures go to `.scratch/furniture/`
  (outside git). A sheet has six columns (front, side from +X, back, three-quarter from above, top, underside) and
  four rows (1 m daylight, 3 m daylight, 1 m lamplight, 3 m lamplight); distances run from the piece's box, not its
  middle. Sheets render the shipped near copy (baked pictures) with EEVEE. `--fast` bakes at a quarter size for trying things; never ship a `--fast` build.
- Run it with a process timeout (a full build with sheets takes about 30 minutes on the RTX 5090).

## Files and nodes

One glb per family: `seating`, `tables`, `counters`, `storage`, `beds`, `stoves`, `clocks`, `wash`. Each top node of a
family glb is one piece, named by its node name (the id with `_` for `-`). A family glb is a standard glTF model pack
(no town facts): the recovery tool reads it with `modelPack: true` (`native-godot/recovery/README.md`, "Recover
standalone models").

Axes and origin (Godot): metres at real size, +Y up, the piece's front (the side a person uses) toward +Z, the origin on
the floor under the middle of the footprint. Wall pieces (wall shelf, wall clock) have their back face at z = 0 on the
origin's plane, so the origin goes on the wall at floor height.

Under each piece's top node `<node>`:

| Child | What |
|---|---|
| `<node>_near` | The near model (LOD0). One material, `furn_<node>`, except where the table below says otherwise. |
| `<node>_far` | The far copy (LOD1, a quarter or less of the triangles), its own material `furn_<node>_far` with small pictures (512-1024 px) baked from the near copy, so its edges and wear agree. Hidden by the game's `_far` rule (`ModelLibrary.IsAside`); the wrapper shows it past the near range (suggested switch at 8 m). |
| `<node>_seat_<n>`, `<node>_sleep_<n>`, `<node>_use_<n>` | Empty nodes: the points (below). Their +Z is the way a person there faces. |
| `<node>_dial` | Clocks only: the dial centre (see "Clocks"). |

Textures: one colour and one normal picture per piece (1024 px for small pieces, 2048 px for large ones) and a smaller
pair for the far copy, embedded as JPEG. Colour is sRGB with the wear, grime and a light ambient-occlusion baked in; the normal map is tangent space (glTF,
OpenGL green up). Import both linear-filtered with mipmaps (never nearest). The town's psx shader kinds read only the
colour; keep the normal map for materials that use it. No vertex colours, no second UV set.

## The manifest (`furniture.json`)

```json
{
  "version": 1,
  "axes": "metres; +Y up; front +Z; origin on the floor under the footprint's middle",
  "pieces": [{
    "id": "chair-ladderback",            // the permanent library id: never reuse or rename
    "node": "chair_ladderback",          // the top node in the glb
    "glb": "seating.glb",
    "title": "Rush-seat ladder-back chair",
    "category": "Furniture: seating",
    "rooms": ["home", "tavern"],         // where it belongs (a hint for the editor)
    "homeKind": "chair",                 // the home-furniture kind (places.json) it can stand for, or null
    "footprint": [0.46, 0.98, 0.45],     // AuthorAsset.Footprint: the clearance box's full size
    "footprintOffset": [0, 0, -0.01],    // AuthorAsset.FootprintOffset: box centre x, bottom y, centre z
    "collision": [{"size": [0.46, 0.46, 0.43], "at": [0, 0.23, 0], "yaw": 0}],
    "points": [{"kind": "seat", "node": "chair_ladderback_seat_0", "at": [0, 0.45, 0.02], "facing": [0, 0, 1]}],
    "triangles": {"near": 3410, "far": 880},
    "texture": {"px": 1024, "farPx": 512},
    "materials": ["furn_chair_ladderback", "furn_chair_ladderback_far"],
    "notes": "..."
  }]
}
```

- `footprint`/`footprintOffset` match `AuthorAsset` exactly, so the editor copies them.
- `collision`: simple boxes (centre `at`, full `size`, `yaw` degrees about +Y) for a `StaticBody3D` on layer 2, mask 0,
  as the library bench has. Use these instead of the trimesh the recovery tool makes from the faces.
- `points`: `seat` at the top of the seat where the hips go (the people's `SitDrop(seat)` takes this height), `sleep` on
  the mattress at the middle of the body with `head` (a unit vector from there to the pillow), `use` on the floor where
  a person stands or a chair goes to use the piece (serve, drink, cook, stoke, wash, write, rock, open, wind). Every
  point has `facing`, and `use` points also have `action`.
- `triangles`: counted after triangulation, per copy.

## Clocks

The game's clocks show the game's own time through one shared part (`godot/src/Movers/Clocks.cs`). A furniture clock
carries its own modelled hands as separate nodes so that part can turn them:

- `<node>_dial`: a mesh node (the hub boss) at the dial's centre. Its local +Z points out of the face, +Y to 12 o'clock.
- `<node>_dial/<node>_hour_hand` and `<node>_dial/<node>_minute_hand`: mesh nodes, children of the dial, origin on the
  arbor, pointing to 12 (+Y) at rest, with an identity rotation. The game turns them about local Z, clockwise
  (a negative angle): hour = -(minute of 12 hours) / 720 x 2 pi, minute = -(minute of the hour) / 60 x 2 pi.
- Call `Clocks.I.AdoptDial(dial, kind, where)` when the piece enters the tree; it finds the two hands by their suffix
  and lays them each game minute like every other clock. The hands share the piece's material.

## Pieces

| Id | Family | Title | Home kind |
|---|---|---|---|
| chair-ladderback | seating | Rush-seat ladder-back chair | chair |
| chair-tavern | seating | Tavern chair | |
| chair-cafe | seating | Bentwood cafe chair | |
| stool-low | seating | Low three-legged stool | |
| stool-bar | seating | Tall tavern stool | |
| settle | seating | High-backed settle | |
| bench-long | seating | Long bench | |
| bench-short | seating | Short bench | |
| table-cafe-round | tables | Round marble-top cafe table | |
| table-square | tables | Square deal table | table |
| table-kitchen-long | tables | Long kitchen table with a drawer | |
| desk-writing | tables | Writing desk | |
| counter-bar | counters | Bar counter with a zinc top | |
| counter-shop | counters | Shop counter with drawers | |
| shelf-wall | storage | Wall shelves with crockery | |
| dresser | storage | Dresser with crockery | |
| armoire | storage | Two-door cupboard | |
| bed-box | beds | Box bed | |
| bed-iron | beds | Iron bed | |
| mattress-straw | beds | Straw mattress on the floor | |
| cradle | beds | Rocking cradle | |
| stove-leuven | stoves | Cast-iron stove | stove |
| range-kitchen | stoves | Kitchen range with pipe | |
| clock-wall | clocks | Drop-dial wall clock | clock |
| clock-longcase | clocks | Long-case clock | |
| washstand | wash | Washstand with basin and jug | |

## How a piece is made

- Joinery as built in the 1870s: mortise and tenon with drawbore pegs, through-tenons where a country maker would show
  them, turned legs and stretchers, chamfered square legs, frame-and-panel doors, dovetailed drawer fronts, cast
  stove plates with flanges and bolts. Real sizes (seat 43-46 cm, table 74-76 cm, counter 100-105 cm).
- Edges follow `AGENTS.md`: wood 1-4 mm (worn more on seat fronts, arm rests, top edges and stretchers where feet go),
  cast iron 1-4 mm, sheet zinc a rolled lip. Every face, also narrow sides, ends and undersides, is textured at its
  material's density with the grain along the part (`kit.py`, `grain` UVs per part), then baked to the piece's atlas.
- Wear: scrubbed pale tops on deal tables, worn varnish on seat fronts, rails and arm ends, darker grime in the corners
  and under the edges, foot wear on stretchers, soot on stoves and pipes, a dull hand-polish on brass.
- Sources: our own geometry and painting; the photo textures are CC0 from Poly Haven
  (`art-source/third_party/polyhaven-furniture/`, rows in `assets/ATTRIBUTION.md`), graded and worn by the build.
  Poly Haven's CC0 furniture models were looked at and not used (modern or ornate, other budgets, no joinery to match).

## Budgets

Triangles per near copy: chairs and stools 2,000-4,000, tables 2,000-5,000, counters, dressers, cupboards and beds up to
8,000 (crockery and bedding included), stoves 5,000-8,000, clocks up to 4,000. Far copies about a quarter. One draw per
copy (one material) except the clock hands (the boss and two hands: three small nodes). No new shader kinds in the game: the editor's
standard material maps onto the existing psx kinds (`NativeTownMaterials`).
