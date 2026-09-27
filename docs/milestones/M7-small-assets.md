# Small assets: safe collision and design batch, 2026-09-26

Update 2026-09-27: Props in walls and Picture round are complete. The prepared cargo and static-prop
changes have now been reconciled against main and verified for integration; see the final checks in
`M7-tight-props.md`. The original deferral table below records the first batch's scope, not a new hold
on the cargo merge. Boats, buildings, room and character collision remain outside these two batches.

Steve requested a merge of the completed work, then clarified: consult `docs/worklog.md`, work
only on assets outside the active list, and return to the listed assets later. Small assets also
need a visual pass. This batch therefore enables model collision for street/quay trees and
static omnibus stop benches, and introduces the shared contact code. It does not enable the
prepared barrel/crate and other prop-loader changes while Props in walls is still active.

## Included

- `modelCollision.ts`, `geom.ts`, the movement/support/navigation sections of `rijnkaai.ts`:
  triangle contacts clipped to the player's body height; actual upward-facing support surfaces;
  AABBs retained only for broad-phase rejection. Uniform tree instances share their triangle grid.
- `trees3d.ts`: collision from woody geometry at the actual placement, rotation and scale.
  Leaves are never solid. Initial trunk boxes are retired after models load. Other systems that
  call the tree renderer keep their own collider ownership; prison and park layout are untouched.
- `omnibus.ts`: model-shaped static stop benches only. Moving vehicles and routes are unchanged.
- `build_trees.py` / `trees.glb`: low-poly root buttresses, smaller irregular leaf clusters with
  visible forks, muted yellow/ochre palette. No extra tree mesh draw calls or added polygons.
- `trees_bark_surface.png`: height from the exact fissure/flaking masks used for the bark colour;
  lichen/colour patches are not holes. Same glTF UVs and vertical repeat, 2 mm detail fading with
  distance. Damp bark and leaves darken subtly using weather uniforms, with no weather-time
  material variants. Leaves have no artificial bark bump or ground puddle shader.
- `vegetation.ts`: three bent, uneven fans in place of rigid two-card crosses, dry seed stems,
  fewer faded flowers, rooted wind motion and modest rain darkening. Soft vegetation remains
  pass-through. The other session's fallen-leaf/litter/sky/gutter work is untouched.

## Deferred until the owning work finishes

| Assets | Active work to check first | Next pass |
|---|---|---|
| Barrels, crates, sacks; quay/workshop/street props | Props in walls | Reconcile prepared model-contact/cargo/bump changes with final placement; redesign remaining small props; repeat jump and prop checks |
| Ground litter and fallen leaves | Picture round 1, 4, 5 | Collision only for substantial solids; reconcile seasonal artwork |
| Boats, barges, ferry and pier | All boats; Ferry arrival and pier | Check final hull/deck/gangway contacts after the owning batch is logged complete |
| Prison and room assets | Prison made real; Empty shop fronts | Check final room geometry and doors before collision migration |
| City buildings/windows | Yard windows 3D | Use final city model, retain real openings and navigation |
| People and carried/animated props | Character creator; Job figures walk up | Audit against final rigs/animations |

The earlier cargo experiment and its evidence remain in the shared working checkout under
`docs/milestones/M7-tight-props.md`, `assets/concepts/` and `data/tight-assets-baseline/`.
They are deferred work, not a claim that every game asset has been redesigned or migrated.

## Validation

Seven analytic collision tests, including rotation, separate barrel tiers, overhangs, slopes,
mirrored/nonuniform transforms and shared uniform-scale tree contact. Run
`node --test client/test/modelCollision.test.mjs` (Node 24).

Build: `npm run build`. Model review: Blender `build_trees.py -- --preview` writes
`data/shots/trees_preview.png`. Browser checks run in Chrome against a copied save in the isolated
integration checkout on 5469/9069. Final path, shader, contact and dry/rain evidence is recorded
in `docs/worklog.md` before this batch is marked merged.

### Completed verification and integration

- Feature commit `abb6a21` is on main, pushed, and included in the playable checkout's `9aa9cd4`.
  Concurrent lighting and remote test fixes were reconciled in main `98bdebe`. Its tree exactly
  matched the isolated integration tree used for the final build and Chrome contact check.
- Seven analytic collision tests passed; `npm run build` passed (client and server).
- Final Chrome check found 548 mesh colliders (529 trees, 19 benches). Walking into a trunk
  stopped 0.455 m from its centre; walking alongside at a 0.54 m offset crossed it freely.
  `paths()` and shader problems were both empty. Clear, wet, actual rain and close bark views
  were inspected; the rain check also reported no shader problems.
- Images remain in `D:/Code/MoodyGame-tight-merge/data/shots/`: `trees_preview.png`,
  `small-assets-tree-dry.jpg`, `small-assets-tree-wet.jpg`, `small-assets-tree-crown.jpg`,
  `small-assets-tree-rain.jpg`, and `small-assets-bark-close.jpg`.
- An additional check of the concurrently merged AI router test file returned 19 passed and
  two timeouts (first Codex stub case and process-kill case). This is not a clean router suite;
  its owning session should investigate. No AI/test fixes were added by this asset batch.
  Output: isolated checkout `data/tight-router.log`.
- The private Chrome test instance and copied-save stack on 5469/9069 were closed and stopped.
  Other sessions' test stacks and the playable save were not used for testing.
