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

Apply this rule to new assets and to existing assets as they are converted to native Godot. Preserve authored placements,
permanent object IDs and unsaved editor work during resource repairs.
