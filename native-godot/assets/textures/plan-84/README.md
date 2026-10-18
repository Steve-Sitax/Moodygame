# Plan 84 round 2 picture bundle

Rows 3, 7, 8, 9, 10, 13; reusable rows 2 and 6. See each row README and manifest.json.

71 sets, 284 standalone PNGs. No runtime resource was edited. Native integration and geometric/contextual acceptance remain outstanding. Row 13 now includes photographic goods/fibres/prints and repainted sign lettering; remaining special cells are enumerated.

Map dimensions and names remain compatible with the round 1 handoff. Metre scales now follow the photographic donors: English-bond brick is 2.4 x 1.2 m, roof slate 3 x 3 m; bark halves have different scales in the manifest. Use the updated scales on installation. Native atlas rectangles are preserved. Litter remains separate high-resolution marks with its original cell metadata.

Rebuild round 2: `python art-source/plan-84/build_round2.py --proof <external-folder>`. Requires the installed PhotoCraft CLI and existing Python Pillow/NumPy/SciPy. `build_maps.py` is the historical round 1 builder; running it alone would restore the rejected maps. No game, browser bake, editor import, scene conversion or Godot process is involved.

Source/licence/checksum ledger: `art-source/plan-84/ROUND2-SOURCES.json`. Originals and own-page licence evidence: `art-source/third_party/plan84-round2/`. Generated originals and exact prompts: `art-source/plan-84/round2-generated/`.

QA receipts: `D:/Code/_tmp_verify/K2-textures/validation.json`, `comparisons/`, `tiles/` and `cells/`. Each comparison shows round 1 and round 2 colour and neutral grazing-light swatches. The 3x3 tests are repeat diagnostics; atlases repeat within cells, not across unrelated cells.

Stone donors are adapted mineral/ashlar photographs, not certified Belgian fossil limestone; fissured bark is an oak proxy. Those material/species details require art-direction review. Generated albedo samples use explicitly bounded/reconstructed relief, not a claim of measured photogrammetry. Maps cannot repair model silhouettes, exposed bevels, junctions, drainage, normals or collision.
