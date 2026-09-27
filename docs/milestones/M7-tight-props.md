# Tight prop collisions and quay cargo, 2026-09-26

Integration update 2026-09-27: the previously deferred cargo and static-prop batch is now
merged into main as `8355450` after Props in walls and Picture round were logged complete. The final checks
below supersede the original coordination hold at the end of this note.

Requested by Steve: low-poly assets that fit the game, collision matching their models (especially
the barrel pyramid), cargo/owner marks, matching bump maps and weather. Coordination is in
`docs/worklog.md`; the shared checkout already contained other sessions' work before this batch.

## Assets and materials

The generated reference is `assets/concepts/quay-props.png`; its README records the prompt and
official Kenney/Quaternius research links. The town's original Blender assets fit Antwerp better
than importing the researched packs. Casks now show merchant, origin/contents and lot marks;
shipping crates show glass/fragile and tools marks. These are illustrative cargo marks, not labels
bound to a player's changing inventory.

`build_quaygoods.py` creates colour and packed surface maps from the same atlas layout and grain
seeds. Surface R is height, G porosity, B wet sheen. Ink is excluded from height. `propSurface.ts`
uses the glTF UVs directly, 2 mm bump fading at 5–14 m, and the existing wetness uniform. Porous
wood darkens, iron gets restrained grazing sheen, cloth stays matte. No ground puddle/rain-ring
shader is applied to cargo, and changing weather adds no shader variants. The original batching
and low-poly silhouettes remain. The handcart shafts were also raised out of the ground.

## Collision

`modelCollision.ts` caches actual solid triangles per prototype and scales, with a local spatial
grid. Bounds are only broad-phase rejection; movement clips triangles to the player's vertical
body and checks the horizontal disk. Support comes from upward-facing model triangles, including
the separate cask tiers. Rotation, scale, mirrored scale and raised placement are handled.
The world path check also queries the surface after broad-phase rejection.

Applied to props3d (including initial stacks and lamps), quay goods, quay furniture, clutter,
street life, solid litter heaps/barrows, trade workplaces, town-place furniture, lively street
props and omnibus stop benches. Existing building shells, terrain, and moving-vehicle collision
systems retain their own implementations; this batch does not replace those systems. Existing
placement keep-outs remain conservative so the other sessions' placement checks keep working.

## Evidence and reproduction

- `npm run build`: passed again after the final navigation and cargo-foot placement fixes.
- `node --test client/test/modelCollision.test.mjs client/test/quayCollision.test.mjs`: 8 passed,
  no skips locally. The second file uses 56 real solid models exported by
  `blender -b --factory-startup -P tools/blender/preview_quay_props.py`; without that export it
  explicitly skips the two Blender-fixture checks. The six analytic tests always run.
- Isolated save stack `tight-assets`, Vite 5349 / server 8959. T3's Electron renderer repeatedly
  failed; Steve explicitly authorized Chrome. Chrome loaded the actual game successfully.
- Actual first-person controller crossed the cask pyramid while holding forward/jump: sampled
  feet rose to 2.279 m and the player crossed from local z +1.6 to below -2.4. Lower barrel tiers
  support landing; empty corners no longer block as full-height boxes.
- Quay-goods placement check after the handcart and actual-foot placement fixes: 398 placed props,
  zero problems. The latter rejects a crate if one foot lies on raised coping hidden by the walk map.
- Final full `paths()` check: `[]`. The initial shared reload had home/prison failures; navigation
  was updated to use model surfaces, and a clean test-server restart matched the current shared
  client/server work. No prison/home source edits were made by this session.
- Shader check after dry/rain views: zero problems. Same-camera controlled dry/wet shots confirm
  matching detail and subdued material-specific wetness. 1,000 movement probes near the pyramid
  averaged about 0.28 ms each on the busy development machine (diagnostic, not an FPS guarantee).
- Images in `data/shots/tight-assets-*`: Blender `models.png` and `cargo.png`; game
  `pyramid-clear.jpg`, `pyramid-rain.jpg`, `petroleum-rain.jpg`, `surface-dry.jpg`, `surface-wet.jpg`.
  These were inspected and progress pictures shown in the conversation.

Final navigation verification and integration status are maintained in `docs/worklog.md`.
No changes have been checked out into Steve's play worktree by this session.

## Final integration checks, 2026-09-27

The isolated branch `codex/remaining-props` starts from main `aab4be8`, incorporating the completed
placement, autumn ground, yard window, bump-rendering and performance work. Only this session's
remaining cargo art, collision loader changes, research reference and documentation are included.
The other sessions' attribution rearrangements and unrelated edits are preserved in the shared
checkout. Three accidental blank lines in `main.ts` were removed to stop blocking multiplayer's merge.

- `npm run build` passed. Nine collision tests passed with no skips, including 56 real Blender models.
- Chrome used an isolated copied save on 5469/9069. The actual first-person controller crossed the
  barrel pyramid: feet reached 2.302 m, ending at local z -2.804 m on the opposite side.
- Full `propcheck()`: 5,223 registered props, zero problems; 411 quay goods checked, 339 cargo colliders.
- `paths()`: `[]`; shader problems: `[]`, including after rain.
- The cargo's own packed height map is retained by the newer automatic bump pass, with runtime
  bumpScale 1 and the existing resolution correction. Shipping ink is excluded from height.
  Rain test reached wetness 0.994 and rain 0.644; no shader changes were triggered by the weather.
- Bump audit of the full town: 391 bump, 30 relief, 7 flat, 1 weak. This is not a claim that every
  pre-existing material or every game asset was redesigned by this batch.
- Close dry/wet cargo and pyramid images were inspected. Evidence is in the isolated checkout's
  `data/remaining-check.json`, `data/remaining-rain.json`, `data/remaining-build.log` and
  `data/shots/tight-assets-*` / `data/shots/remaining-cargo-rain.jpg`.

The playable checkout currently runs the other session's multiplayer branch. Do not roll it back
to main to deploy these props; merge this main commit into the multiplayer work first. This batch
does not migrate building shells, moving vehicles, boats, prison rooms or character collision.
