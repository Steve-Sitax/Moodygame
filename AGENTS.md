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
