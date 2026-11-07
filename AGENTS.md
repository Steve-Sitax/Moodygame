# Mandatory startup optimization on every game build

- Every game build includes a startup optimization pass, even when the requested change is unrelated to performance.
  Do this without waiting for another request; compilation alone does not complete the build task.
- Target (Steve, 2026-11-07): launch to playable under 60 s on a warm cache. Report the gap until it is met.
- Profile the resulting build through actual playable gameplay using `--startup-proof`, with the same isolated save,
  layouts and renderer as the comparison run. Inspect the largest remaining measured delays and optimize avoidable work.
- Validate the final build after optimization. Compare three repeat launches by median when claiming a speedup; record
  cache-miss launches separately. Keep timings and checks in `.scratch/startup-perf/`; explain material run variability.
- Fix startup regressions before declaring the build complete. If a remaining delay cannot safely be improved in this
  pass, record the measured bottleneck and concrete reason; never assume that the previous pass reached the limit.
- Preserve visual detail, authored placements and IDs, collision, navigation, gameplay and unsaved editor work. Verify
  affected geometry/cache behavior and unchanged non-timing world reports; run `native-godot/scripts/test-icons.ps1 -Full`.
- Keep valid geometry caches across unrelated builds. Construction or asset changes must invalidate affected caches;
  corrupt caches must rebuild safely. Do not replace content checks with file timestamps alone or require a manual bake.

# Adding to the start

Anything new that runs before the game is playable follows these rules (details: `docs/startup.md`).

- Time it: wrap the new step in `Dev.StartupTiming.Measure(...)` and compare `--startup-proof` runs before and after.
- Fixed geometry is built once and cached by content (`RuienGeometryCache`, `RuienEntrance.Cached`, `NativeCutCache`
  pattern). List a new construction source in its project's `StartupGeometrySource`; keep other code out of that list.
- Read a mesh's arrays once per pass and convert Godot arrays to C# arrays once, never inside a loop. A read from the
  loading thread waits for a main-thread frame. Search nearby triangles only, in their original order.
- Upload copies in one go (`MultiMeshData.Write`), not instance by instance.
- Files a part loads at start are declared in `World/StartupResources` so the prefetch reads them beside the town.
- Pure computation may run on workers (`Task`, `Parallel`) on arrays captured on the main thread; no scene, physics or
  part calls off the main thread. Parallel results must not depend on order.
- Ruien builders run on the Ruien worker ([Start-up](docs/ruien-native.md#start-up)): no scene-tree, physics or
  `Ruien.I` calls in them; lay nodes in through `place(...)`.
- Every collision triangle is built on the main thread at start (about 0.6 s per million). Keep collision to what
  people and the player touch, within the edge rules below.
- Prove the town is unchanged: the proof's `town digest`, `map digest`, `ruien pieces` and world report must match a
  `--no-startup-cache --ruien-in-order` run.

# Model edges and materials

- Give exposed edges a material-appropriate geometric bevel or radius. Keep an edge sharp only for an intentional
  cutting/machined feature, a thin sheet lip, a hidden/mating surface, or a reference that requires it. Record exceptions
  in the asset notes. Inspect tops, backs, undersides, ends and corners, not just the main camera view.
- Use geometry for visible silhouettes and corner highlights. Smooth normals and bump maps do not round a silhouette;
  height/normal maps add grain, pits, dents and small chips after the edge geometry is correct.
- Starting sizes at real-world scale: worn stone arrises 5–15 mm; cast metal edges 1–4 mm, more on heavy worn castings;
  wood edges 1–4 mm with wear following the grain; sheet edges a small bevel limited by their thickness. Adjust to the
  object's construction, size, use and reference. Do not round every material by the same amount.
- A cast mounting base should share the body's finish, roughness, corrosion and relief unless the reference calls for a
  different material. A rust stain is a transparent layer on the ground, without a raised plate or collision of its own.
- Verify exposed edges at close and low angles in Godot, from both sides and below, in dry daylight, rain and darkness.
  Keep UVs/height maps aligned and collision consistent. Resolve gaps and incorrect normals before tuning lighting;
  indirect light must follow the environment rather than making shaded surfaces glow at night.

Apply this rule to every new, modified or reviewed environment asset, including texture-only work on existing native
assets. Do not exempt visible geometric defects because they predate the current pass. Preserve authored placements,
permanent object IDs and unsaved editor work during resource repairs.

# Atmospheric city construction

- Follow [the atmospheric city rules](docs/05-art-direction.md#atmospheric-city-construction-and-acceptance) for all
  environment creation, conversion, repair and review. High detail is the default; fog, grain and dark lighting do not
  excuse flat geometry, missing construction detail, blurry textures or visible repetition.
- Review a connected piece of the city: roof/drainage, wall base, stairs, railings, pavement and kerb. Pavement must fit
  foundations and steps; kerbs must terminate or turn correctly, never cut through walls. Fix intersections and gaps.
- Weathering follows physical causes. Connect lower-wall grime and damp to splash, runoff and dirt on adjacent paving;
  place moss and small plants in persistently damp joints, damaged mortar and neglected cracks, with restrained variation.
- Verify appropriate gutters, downpipes, outlets and surface drainage in the native scene, including imported detail
  meshes and visibility distances. Show where water goes; do not add pipes arbitrarily to every wall.
- Reviewer scores and automated checks are evidence, not acceptance. A visible geometry, junction, drainage, material
  alignment or wear defect blocks an overall environment pass. Record unresolved defects explicitly; never call a
  texture-only improvement a finished high-detail asset or exempt known defects by narrowing the review after the fact.

# Ruien street access

- Entrances belong in a square clear of traffic, or behind a doorway. Never put an open hatch, stairwell, moving lid
  or access house in a carriageway, cart route or tram route. A walkable map pixel is not evidence of a safe site.
- Align entrances with the adjacent facade, boundary and paving courses. Include the surround, open leaves, landing
  and approach in the clearance review. Doors should open inward. Street ventilation grates stay closed to access.
- Review the actual native street and underground connection together; restore paving and collision at retired openings.
