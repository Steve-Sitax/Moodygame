# H6 native candidate: not accepted for main

This branch preserves partial work on #84, #198 and #200. The visible defects below block an overall environment pass.

- #84: 57 shared colour/height resources feed 62 materials: row 2 (3), row 3 (7), row 6 (14), row 8 (13),
  row 9 (8), row 10 (9), row 13 (8). `recovery/plan84-promote.json` records source hashes and parameters;
  `scripts/Plan84Promote.cs` preserves shaders, mesh geometry, authored transforms and permanent IDs.
- The photographic donors, generated cells and licences remain in the plan-84 source ledger and `assets/ATTRIBUTION.md`.
  No new source pictures were introduced. Row 7's separate litter atlas is not installed.
- Carolus sandstone relief was reduced by a factor of ten after the first native view. Its close view still fails:
  harsh relief on the gateposts/plinth, sharp block transitions and insufficient column/stone construction.
- The Sint-Jans monument still has sharp polygonal cap/base edges and a coarse statue. Long walls, narrow returns,
  special atlas cells, botanical/geological proxies, drainage and connected paving still need complete contextual review.
- #198: the guarded shell cut removes exactly 210 white and 44 black marble triangles per altar (1,270 total),
  retaining the shared choir and other altars. Five existing `church/altar_marble` parts use the original object placements.
  The model's 6–10 mm stone arrises and profiled bases are visible from low views; hidden mating planes stay sharp.
- A thin black crossed sliver below the left cornice remains visible close up. It persists with both old marble shells
  hidden; no old shell triangles remain in that enlarged capital region. Repair the model/junction before accepting #198.
- #200: the one-surface frozen litter mesh becomes 124 rigid visual groups with the same active material and 7,145
  triangles. Adjacent islands within 10 cm join as assembled scraps; no resulting group spans more than 0.91 m.
  Local river/dock/lock levels set the immersion; the sampled drawn bed clamps the whole group without deforming it.
  Thin scrap lips stay sharp. Existing IDs, horizontal placements and collision exclusions remain.
- Low/high surveys check all 124 groups: 100 ground at -5.2 m; none ground at -0.4 m; dock scraps stay at -0.7 m.
  A repeated low-water view has zero vertical drift. Geometry outside the litter repair at the Vliet outlet is #201.

Evidence outside source control: `D:/Code/_tmp_verify/H6-textures/`. `runs/cathedral-repaired/out/` has 75 rendered
day/rain/night pictures and 11 passing furniture checks; `runs/cathedral-final/out/cathedral.json` passes 13 checks,
including all five marble parts and zero old altar triangles. `runs/repaired-detail/out/` has low altar and tidal views.
`litter-check.json` records all 372 level assertions and the repeated-view stability check. These are partial checks,
not whole-town acceptance, and do not justify closing #84 or #198. No performance result is claimed.

Shader audit: 41 programs, 153 first-frame kinds matching the unchanged baseline, no new kinds or findings;
6 native preview lights. No merged-main navigation, desktop-icon or package check is claimed for this rejected candidate.
