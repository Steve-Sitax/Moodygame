# Environment materials · 13 October 2026

The connected stair, city-wall and drainage repair is installed in the native source game.
Claude graded V9 8/10; Codex 8.1/10. Both found no concrete blocker in the reviewed junction.
The earlier texture-only result was rejected by Steve; its historical receipt remains in `art-source/environment-20261013/review`.
Current evidence, originals, geometry checks and installed hashes: `art-source/environment-20261013/junction`.

## Installed work

- The original manifest covers 17 materials: masonry, stone, iron, slate/roof atlas, chandler poster and selected debris.
- The junction repair replaces 13 materials and 15 mesh resources, retaining scene nodes, permanent IDs and transforms.
- Stone has actual rounded edges, separate ashlar/quoins and fitted coping. Iron has geometric bevels and mounting details.
- Paving fits the stair footprint; the obsolete intersecting border is removed. Soil, wet joints and wall-foot dirt connect.
- Gutters, curved hollow pipes, brackets, outlet shoes and three grated gullies reserve connections to the future Ruien.
- Thirteen shop windows on the drain frontage have physical rounded joinery. Roof clearance and guardhouse seams are repaired.
- Characters, authored scenes and editor layouts were not edited. Standalone packages were not rebuilt.

## Material construction

ImageGen sources and prompts live in `art-source/environment-20261013`; Photocraft packed the roof/debris atlases.
Brick uses 1.84 × 1.56 m cross-bond courses; band offsets affect colour and height together. Stair stone uses 1.2 m grain.
Slate laps preserve downhill orientation; GPU array layers prevent atlas mip bleeding. Fine soil uses 1.8 m sampling.
Dirt, paint, fossils and printed ink are colour, not exaggerated displacement. Wet response follows the game's sky and wet global.
Bevels follow `AGENTS.md`: stone 5–15 mm, metal 1–4 mm. Thin gutter lips and broken timber tips remain intentionally thin/sharp.

## Verification and reproduction

V9 passed geometry checks and day/rain/night inspection. All 27 fresh-load views match the reviewed candidate below the captions.
Stair support changed by at most 0.452 mm; the guard grate clears the parapet by 25.3 mm. Source collisions remain in place.
Pictures use native game geometry/materials in isolated scenery; fog previews add game fog values without actors or weather particles.
Run `environment-texture-review.tscn -- --junction-installed --context` in Forward+; add `--atmosphere` for fog views.
Rebuild candidates only from archived originals with `repair-city-junction.py`, then `--junction-candidate --context`.
Promotion requires matching source hashes and Forward+ GPU readback. Never reapply repairs to installed resources or save arrays headlessly.
Ruien port coordinates live in `world/town/drainage/ruien-inlets.json`; the underground network remains future work.

This is acceptance of the reviewed connected junction. Remaining specialised debris cells, other posters and other city blocks
retain earlier artwork and need their own contextual review; these scores do not certify the entire town.

