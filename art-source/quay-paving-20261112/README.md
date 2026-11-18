# Quay paving and embedded rails — 12 November 2026

Final choice: option A, texture relief on the existing ground. The per-stone geometry experiment and unfinished streamer
were removed from the build. Their sources remain only in `.scratch/quay-paving/retired-3d-prototype`.

The quay uses world XZ UVs at its existing 2.5 m repeat. Original non-UV arrays, bounds and collision metadata are identical.
Track infill retains only 2.157 m² of exposed bedding; its 208 triangles inherit the adjacent paving's material and UV frame.
Its original collision stand-in is unchanged. These repairs remove the differently shaded strip across the quay paving.

Quay/street relief is 22/18 mm, bump 2.0, dome 1.1. The low-eye fade reaches full strength at 0.5 m rather than 1 m;
the grazing-angle guard remains. Original colour, height and stone-ID images retain irregular wear, chips and individual
height variation. No per-stone nodes, collision or runtime construction are added. Extreme ground-level silhouettes
remain flat, as expected for option A. This does not establish acceptance of the whole city as a high-detail environment.

The carriage-rut mesh loses its deep mud overlay where quay, street cobbles or flags already exist: 1,885.364 m² restored.
Paving keeps the original dirt mask's grime, wheel wear and individual sinking. Bare-earth/bridge remnants retain the old
treatment. Independent polygon coverage error is 0.000109 m². Overlay triangles: 1,224 versus 7,522.

Rails retain original routes, gauge, 35 mm crown height and exact 1,536-triangle collision. A real crowned section,
filleted head, narrow web, foot, expansion gaps and closed ends replace the rectangular ribbon. The prototype based joint
hardware on the crown's Y coordinate. In embedded track this hardware belongs below paving and is omitted from rendering:
a hidden/mating-surface exception. The head, web and underside remain closed. Full-attribute indexing preserves UV seams
and bevel normals. Final rails: 53,764 triangles and 80,780 vertices, versus the prototype's 160,772 and 482,316:
66.6% fewer triangles and 83.3% fewer vertices. These counts are not an FPS speedup claim.

`comparison.html` has six matching views in daylight, wet and night material tests. PNGs: `rail-before/after.png` and
`wheel-wear-before/after.png`. The static fixture lacks live sky/water; its backgrounds do not establish nighttime water
lighting correctness. Other texture inspections found no shared normal inversion. Roof overlap detail remains outside
acceptance. Authored placements, IDs and editor layouts were not changed.

Logs in `.scratch/quay-paving`: `option-a-final-proof.log` (original ground arrays/collision), `rail-underside.log`
(32 top/bottom probes and all 36 exposed ends), `option-a-icons.log` (seven launcher passes), and `final-build.log`.
`paved-ruts.json` and `rails.json` record numerical checks. Startup runs and the read-only geometry inventory live in
`.scratch/startup-perf/paving-a-*` and `geometry-audit.json`; only completed runs qualify as evidence.

Reproduction requires original backups and matching SHA-guarded dumps. Initial pass: `dump-quay.gd`,
`quay_track_infill.py`, `quay-paving-repair.tscn`. Final pass: a fresh dump, `paved_rut_infill.py`, then
`paving-finish-repair.tscn`. Do not rerun the initial pass over final materials. `rail-profile-repair.tscn` rebuilds rails
from their original backup. `quay-paving-review.tscn` renders before; `-- --after` renders final resources.
Full-world validation completed on 13 November: warm playable 181.866 s (one observation), cache-building playable
779.737 s, uncached/in-order reference 2,040.380 s. No runtime speedup is claimed. Town/navigation digests and non-timing
reports match; all 42,372 geometry rows agree after independent comparison of 7,046 serialized mesh pairs. Result and
mesh proof are `.scratch/startup-perf/paving-a-result.json` and `paving-a-mesh-equivalence.json`.
Three live-game review views are retained beside `live-frame-profile.json`. The frame sample ran concurrently with the
uncached reference and does not establish an A/B FPS gain. Two obsolete full-city cobble cache files were removed after
verifying their original SHA-256 values: 5,038,266,665 bytes reclaimed. Source/receipts remain archived in `.scratch`.
