# V14 final wall-circuit acceptance

V13 gate lighting passed Claude 8.6 and Codex's gate delta. Subsequent close inspection found two additional real surface blockers, so V13 was not installed.
Black vertical strokes crossed brick/coping/plinth near the river end. They persisted without bump, weather from the new circuit function, and shadows, but disappeared with plain albedo and with the older junction-weather function disabled. Clamping junction_noise's output to its intended [0,1] range before its powers removes the strokes with normal materials. Exact GPU intermediate values were not measured; do not assert a demonstrated NaN cause.
Thin diagonal edges crossed stone blocks on sloped wall faces. blocks() flattened the plane normal, wrongly separating the original triangles. It now groups and clips in the real inclined plane, preserving wall batter and rounding whole blocks. No placement or scene ID changes.
V14 geometry validation passes 179 meshes, 4,850,710 triangles; 581,725 redundant triangles removed. Materials remain 20; total resources199.
Full capture: candidate-v14-final.log, 611 images:289day161rain161night. New close camera river-return-small-face.
Fresh contact sheets: contacts-v14-final.log, 25 sheets from289dayimages. Inspect all25 and any suspicious views at full resolution.
Inspect river-return-small-face day/rain/night; seg-05-01-field,seg-05-02-field,seg-07-02-field,seg-09-04-field day; guard-drain-return day/rain/night; pondbase and stairs. New full capture supersedes old screenshots.
candidate-v14-atmosphere.log captures39 atmosphere images after the full pass. If complete inspect riverreturn, guard and gate at night, plus stair00day/rain. No inspection lamp in atmosphere captures.
Previous closed objections and evidence are in claude-review-v12-verification.md and claude-review-v13.md. Wet brick and base dirt were accepted, with stronger dirt optional polish; enclosed gate bounce resolved the remaining lamp patch.
Do not waive any visible defect. Give independent overall PASS/FAIL and grade, actual inspected coverage, coordinates for concrete blockers, uncertainty distinguished from proven defects. Read-only review, no edits and no characters.
