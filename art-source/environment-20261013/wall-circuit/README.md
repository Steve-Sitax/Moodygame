# Wall circuit repair — 2026-10-13

Status: V18 installed at the user's request; 199 resource hashes and both placement scenes verified unchanged after saving.
Scope: the connected city-wall circuit, 12 stairs, 15 huts, four gates, bastions, towers, mills and river ends.
Characters and wildlife are excluded; repairs preserve root scenes, placements and permanent resource IDs.
The guardhouse strip was coplanar backing/relief z-fighting; backing tops are recessed 12 mm and small faces use metric UVs.
Physical bevels, stair fittings, closed kerb ends, roof covers and drainage replace flat construction; stone follows the true wall slope.
Brick height is softened 2.4 px and aligned with albedo; course wrapping avoids partial border bricks. A subtle tone transition remains for user review.
Stone weathering follows ground contact, runoff and pond water; rooted fern geometry replaces flat wall fronds.
The neighboring house bounds stacked damp darkening; gate vaults receive locally bounded lamp bounce, without exterior glow.
Geometry and saved-mesh collision checks pass for 179 meshes and 4,727,291 triangles; see installed-collision.json.
Coverage is 289 daylight cameras plus 161 rain and 161 night captures; 25 contact sheets cover all daylight views.
Reviews cover V14/V15 circuit captures; final V18 full regression was deferred by the user. Three installed daylight captures were checked.
Earlier atmosphere proofs use the Daylight fog sample and native fixture spill; they are not final V18 captures.
Ruien entries reserve surface-inlet/sump outlets; underground routes and drops, including elevated huts, remain future work.
original-resources.zip and original-ruien-inlets.json are paired rollback backups; preserve other sessions' changes.
`source-geometry.zip` preserves immutable pre-repair exports; use current standalone `coverage.json` with the repair scripts.
Rebuild with `wall-circuit-cameras.py`, Blender `repair-wall-circuit.py`, then the Godot `--wall-circuit --circuit-candidate` proof.
Never re-audit installed resources as original input or promote diagnostic modes; promotion checks source hashes and saves backups.
See [art direction](../../../docs/05-art-direction.md#atmospheric-city-construction-and-acceptance) for standing acceptance rules.
This batch does not claim full-city completion, actor navigation simulation or a measured whole-game frame budget.
