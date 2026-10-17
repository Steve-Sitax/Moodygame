# Codex wall-circuit V9 review

Result: HOLD, 7.8/10. One confirmed material blocker remains. This supersedes the provisional 8.1 visual pass sent before the low-angle no-bump comparison.

Reviewed all 24 freshly rebuilt contact sheets (288 daylight views), plus full-resolution gate threshold/roof, guard return including low angles, pond, kerb end, stair feet/backs/treads and representative rain/night. Characters and wildlife were excluded. Implementation was not edited.

Confirmed blocker:
- `candidate/guard-drain-return-low-night.png`: black dashed, stepped mortar outlines, especially x30–420/y600–610 and x350–760/y880–890. The same outlines disappear in `candidate-nobump/guard-drain-return-low-night.png`. Both material samplers already use linear mipmapped anisotropic filtering. The almost binary, speckled `wall-brick-height.png`, differentiated in screen space at 4mm height, causes steep noisy normals. Preserve mortar alignment, soften height transitions and use filtered UV-space central differences or a continuous normal map. Recheck day/rain/night at the same low camera.

Resolved in V9:
- Pond plinth angular weather wedges are gone; native pond/bank support the reeds and replacement ferns root in mortar joints.
- Exact guard-return coplanar stripes are gone; pipe shoe is hollow, grate clear, stone joints aligned.
- Segment04 kerb end is square, closed and clear of the foundation; the former needle is gone.
- All 12 stair sets show fitted aprons, intact wall/stringer junctions and landing-post sockets. Corrected tread cameras01/04/10 are usable.
- Gate front radial seams are gone; folded hip covers close roof hips. Huts show physical gutters/downpipes, and wall walks show scuppers.

Claude V9 triage:
- Threshold-night black rings resemble lantern cage/shade projections onto the brick vault, not missing external radial stones. Parent corrected the proof to native spill lighting; that refreshed image still needs review.
- Stair00 rain visibly darkens stone relative to day; the claim it becomes lighter is not supported by the matched images. Wet sheen can be subtle on rough stone and need not make every face glossy.
- Pond night is too dark for close inspection. A labelled inspection-light image is appropriate evidence without brightening the actual native night.
- The dark town-side strip is textured earth, not an open geometry gap. Paving it is a construction/design choice; lack of slab joints alone does not prove foundation misfit.
- Strict masonry coursing, autumn leaves brighter than shaded stone, or downpipes occluded in roof cameras are not sufficient evidence of defects.

The full-day circuit review found no additional confirmed junction, drainage or geometry blocker. Fresh installed-resource and collision checks remain separate from this visual review. Underground Ruien connections are future work, not built here.

## V10 targeted follow-up

Result: PASS, 8.1/10 for the current reviewed circuit, combining the complete V9 daylight coverage with the V10 material/lighting delta checks. No confirmed visible blocker remains in those checks. The planned full V10 rerender has not yet been reviewed.

Reopened `guard-drain-return-low-{day,rain,night}`: softened height and UV central differences remove the dashed/stepped mortar artifact while keeping brick/mortar alignment and surface relief. Reopened the normal guard view: the narrow stone return remains free of the original coplanar stripes.

Reopened `gate-keizerspoort-threshold-night`: native spill lighting removes the false black arch rings. The remaining soft dark patch immediately above the lantern is its cap shadow; the brick vault remains present and correctly lit around it.

Reopened `seg-06-base-close-{day,rain,night}`: continuous damp/algae is now visible at the waterline without angular wedges. The labelled night inspection lamp makes block bevels, joints and fern roots readable. `stair-00-wide-rain` retains visible stone darkening and fitted pavement/grate junctions.

V10 fixes the one confirmed V9 material blocker. Final full-render regression checks and fresh installed-resource/collision checks remain to be recorded by the main agent.
