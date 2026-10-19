# Plan 84: partial bark installation

Only the bark subset of H6 `2b637138f91fffb7f2a58d9b464f94cb65e6f2ee` is installed over
main `02602f0b3ec1bd279aaf5a5ac73e7d5f873bc23f`. Issue #84 remains open; this is not a completed environment.

- Four town materials: `r001169.res` (park), `r009469.res`, `r009495.res`, `r009512.res` (street trees).
- Two shared resources: `assets/materials/plan84-20261019/9-bark_atlas-{colour,height}.res`.
  Colour is BC7/sRGB; height is L8/linear; both have mipmaps. Original UV transforms are retained.
  Bark relief scales are 0.3877 (park) and 0.0635 (street trees), from the filtered H6 plan.
- The two source PNGs and CC0 provenance already exist on main: `assets/textures/plan-84/9/`,
  `art-source/plan-84/ROUND2-SOURCES.json` and the repository's `assets/ATTRIBUTION.md`.
- Foliage/alpha, barrels, brick and ashlar overlays are excluded. No H6 altar or litter changes are included.
  Current N5 cathedral and Ruien resources, placements, IDs, collision and lighting are retained.

## Geometry and acceptance

The edge rule applies even to this texture-only change. No mesh, branch, silhouette or tree shape is changed;
height adds bark grain, not rounded geometry. No new sharp-edge exception is claimed. Thin leaf cards remain
as authored. The prior park pictures retain the trunk/branch outline but expose angular forks; those junctions,
trunk bases, ends, backs and undersides still need close and low native review. Any visible geometric defect
blocks full asset acceptance, even if inherited. Botanical donor accuracy and half-atlas seams also remain review items.
Inspect adjacent ground, stairs, rails and drainage in context; unchanged surroundings are not an environment pass.

The prior H6 daylight pair was inspected at `D:/Code/_tmp_verify/H6-textures/runs/`:
`before-day/out/park_tree.png` and `resume-candidate-day/out/park_tree.png`. Bark grain improves, but the full
candidate loses leaf coverage; that rejected foliage is not copied. This pair is not a rendered check of this subset.
The isolated bark subset passed six rendered park views in day, rain and night. Grain is clearer and the original foliage coverage is retained. Evidence: D:/Code/_tmp_verify/fixall/bark-views-01/out/. This accepts the bark improvement, not a completed texture plan; street-tree junctions and the remaining rows stay under #84 for play review. Shader integration checks remain pending; no performance claim is made.
Compilation passed (0 errors, 22 warnings outside the helper). Static verification passed 24 hash/provenance
assertions and the exact 11-file scope; logs: `D:/Code/_tmp_verify/fixall/bark-subset-{build.log,validation.json}`.

## Reproduce and check

`recovery/plan84-promote.json` contains exactly four materials and their two textures, with original material and
PNG SHA-256 guards. The six installed resource blobs are copied byte-for-byte from H6. To regenerate, use a separate
disposable checkout containing this helper/scene/plan and the four original material blobs from `02602f0b`.
Do not restore resources in an active editor or the original H6 worktree. Build the native C# project first.
From the reproduction checkout's `native-godot` directory, with fresh external record/backup directories:

```text
<Godot Mono console> --rendering-method forward_plus --audio-driver Dummy --path . res://scripts/plan84-promote.tscn -- --plan recovery/plan84-promote.json --record <fresh-record-dir> --backup <fresh-backup-dir>
```

The helper refuses changed inputs and existing material backups. It records before/after parameters and hashes in
`promotion.json`; an already-promoted checkout intentionally fails its input guard. The normal game needs no bake.

After a coordinator assigns a slot/port, use `res://town.tscn -- --native-services --no-ai --no-mainmenu --dev`
with fresh `--db`, `--prefs`, `--author-root`, `SCHELDEMIST_USER_DATA`, seed 1873 and `--snap <fresh-out-dir>`.
Keep the silent right-screen override and a bounded process timeout. Exact initial `--views` (repeat on base and subset):

```text
park_tree_day:-267.52,1.62,331.92,49.9,24.8,13,clear;park_tree_rain:-267.52,1.62,331.92,49.9,24.8,13,rain;park_tree_night:-267.52,1.62,331.92,49.9,24.8,22,clear;park_day:-300,1.62,305,180,6,13,clear;park_rain:-300,1.62,305,180,6,13,rain;park_night:-300,1.62,305,180,6,22,clear
```

These six pictures check the known park comparison and connected canopy/ground; they do not cover every bark user.
Complete street-tree and reverse/low/underside views before full acceptance, and run the unchanged `--shaders` check.
