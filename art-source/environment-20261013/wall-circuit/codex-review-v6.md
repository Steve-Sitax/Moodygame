# Codex wall circuit V6 review

**7.9/10 — hold; connected-context acceptance still pending.** This replaces the provisional V5 findings, not the full V4 coverage record. V6 fixes have been inspected directly, not inferred from source alone.

Reviewed fresh seg04/06 base closes, hut14 back night, guard return day/rain/night, Keizerspoort passage/threshold/roof day, and stairs00/01/04/08 foot/back/treads day. V4 covered all287 day views; V5 inspected the repaired details in available day/rain/night. Full V7 circuit proof remains pending. No characters or wildlife were visually reviewed or modified.

Confirmed fixes: V6 removes the grey background wedges, shortens the overlapping kerb, keeps night water dark, and retains clean guard return sampling. Stair noses, fitted paving, stone courses, hip covers and hollow drainage shoes are visible. No new rail/pier or stair/wall collision was established in the reviewed views.

Remaining factual issues:
- Seg04 kerb ends in a thin pointed sliver. The subtraction routine does not cap new cut ends. A square, closed termination is needed; V7 is already addressing this.
- Seg06 proof omitted the actual Stadspark pond and bank. Filling the hole with the runtime river is insufficient: pond water belongs at y=-0.35. The apparently unsupported reedbank cannot be graded until the native bank is present.
- Static wall ferns use visibly flat angular cards. The build_wall.py fern construction confirms these are environmental foliage, not a reliable wildlife identification. V7 is replacing the fronds. Earlier classification remained explicitly uncertain.

Exact missing context, verified through metadata-only native scene inspection: root node-00798.scn, direct children park_1 through park_8. Pond is park_2, meshr001108, materialr001107, psx_water2, y=-0.35. Bank is park_6, meshr001120, materialr001119, boundsx[-319.3943,-277.6145], y[-2.75,0.270002], z[293.6155,328.9371]. Full native transforms/materials are in codex-pond-audit.log. No park asset edit is indicated by this proof omission.

Source/physics check: the proof's1200m river,239 subdivisions,tideY and4m camera snapping match Waters.cs. Add the same expanded CustomAabb for wave-culling parity. Runtime Solid builds current mesh triangles on a fresh load; changing the candidate mesh in an already-loaded proof does not refresh preexisting collision shapes. Installation needs a fresh-load collision check.

Other review triage: physically worn stair profiles, real stone blocks and geometric bevels exist. Rail-through-pier was previously disproved by ray depth. Guard wet highlights and paving darkening are visible; lack of an animated stream is not proof of disconnected drainage. Gate downpipes are visible in stair01/04 foot views. Rain/night files exist despite the other review's selected13 images. Unseen roof drainage, apparent brick size under foreshortening, or a rear lamp spill patch alone do not establish asset defects. Base grime can be strengthened, but do not repair unsupported collision claims by adding arbitrary geometry.

V7 changes are not pre-approved by this review; inspect the complete pond/bank context and new kerb end before a final score.
