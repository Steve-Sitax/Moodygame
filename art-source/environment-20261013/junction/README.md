# City junction repair · 13 October 2026

Installed V9 after Claude 8/10 and Codex 8.1/10; both found no concrete blocker in the connected junction.
The user's rejected texture-only image is preserved as `rejected-railing-day.png`.
`installed-*.png` show the final native resource reload; atmosphere images use the game's fog values.

The repair adds real bevels, dressed stone blocks, fitted paving, continuous damp/grime, rooted weeds,
gutters, hollow downpipes, brackets, grated gullies and physical shop-window frames.
It fixes the kerb/stair intersection, guardhouse light leaks, grate/parapet collision and roof/wall clearance.
Authored nodes, transforms, permanent IDs, characters and editor work are untouched.

- `installation-receipt.json`: 28 changed resources, original/installed hashes, reviews and 27 exact fresh-load comparisons.
- `geometry-validation.json`: normals/winding, material selections, tread support, apron coverage, roof and grate clearance.
- `geometry-report.json`: construction dimensions and counts.
- `source-geometry.zip`, `original-resources.zip`: reproducible input and resource backups.
- `earth-v1.png`, `earth-prompt.json`: original fine-soil texture and built-in ImageGen prompt.
- `claude-v9-review.txt`, `codex-v9-review.txt`: independent final reviews; V6 rejection retained separately.
- `ruien-connections.json`: installation snapshot; live reservation data is in `native-godot/world/town/drainage/ruien-inlets.json`.

Reproduction and material details: `native-godot/assets/materials/environment-20261013/README.md`.
Underground Ruien construction and other city blocks are not represented as complete by this local review.
