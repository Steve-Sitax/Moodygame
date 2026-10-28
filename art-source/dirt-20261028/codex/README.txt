SCHELDEMIST - PROCEDURAL DIRT MATERIALS
Created for Antwerp, 1873. All files generated locally from original procedural
geometry/noise. No photographs, external imagery, logos or text in material maps.

SCALE AND CONVENTIONS
Every base material spans 1 metre x 1 metre per UV repeat. All material maps are
2048 x 2048 pixels: 0.48828125 mm per texel. Repeat on both UV axes.
Albedo: 8-bit RGB, sRGB, colour only; no directional lighting or AO baked in.
Height: true 16-bit single-channel PNG, linear, black low / white high.
Normal: 8-bit RGB tangent-space OpenGL (+Y/up), linear, flat = (128,128,255).
Image rows point down; tangent +Y points up. Do not flip green on import.
Roughness: 8-bit greyscale, linear; black smooth / white rough.
AO: 8-bit greyscale, linear; white unoccluded. Local multiscale approximation.
All maps share the exact layout. No metallic response (metallic = 0).
Wet variants reuse base height, normal and AO; blend albedo in linear light.
Wet colour is darker with warmer saturation; roughness falls in hollows and
on protruding clods. Mud water is a level plane, roughness 14/255, with flat
interior normals. Water pockets cover 12% of the wet-mud tile.

HEIGHT CALIBRATION
Recover metres = minimum + normalized_height * range. Normal maps are computed
from these physical metre heights at 1 m UV scale, with no strength multiplier.
dry_earth: minimum -0.00788186 m; range 0.01589112 m (15.89 mm).
pit_soil: minimum -0.00920728 m; range 0.03723516 m (37.24 mm).
wet_mud: minimum -0.00278554 m; range 0.01148960 m (11.49 mm).
grave_soil: minimum -0.01097059 m; range 0.04331176 m (43.31 mm).
yard_dirt: minimum -0.00699228 m; range 0.01686553 m (16.87 mm).

MATERIAL CONTENT
dry_earth: compact grey-brown earth, ash, coal flecks, mineral grit, pebbles,
fine irregular cracks and sparse crushed straw.
pit_soil: dark loose soil, overlapping 1-4 cm clods, smaller aggregates,
grit, fine root threads and sparse pressed brown leaf fragments.
wet_mud: glossy smeared earth, shallow ruts, partial worn-sole impressions,
level water pockets. No modern boot tread.
grave_soil: richer dark loam with denser turned clods, stone and sandy grit.
yard_dirt: packed earth, irregular brick/stone chips, straw, restrained dung
discolouration and shallow wheel scuffs.

REVIEW AND LIMITATIONS
Inspected all five low-sun previews, all base 4x4 albedo views and contact sheet.
Reduced broad colour variation and dark yard-smear contrast after repetition
review; clipped brick outlines to avoid regular square chips. All generation,
filtering, derivatives and debris placement wrap across both axes. Boundary
gradient tests compare wrap neighbours to interior neighbours; see JSON reports.
Opposite border texels are adjacent samples, not duplicated identical rows.
No visible seam lines in the reviewed sheets. A finite 1 m tile still repeats
exactly: deliberate inspection can identify repeated stones or impressions.
For large exposed areas, stochastic material blending remains advisable.
Debris is procedural and restrained; leaf fragments do not contain botanical
vein detail. Mud soles are worn partial impressions rather than hero decals.
AO is approximate and the previews use a simple directional BRDF, not ray tracing.
These are texture assets, not a completed native environment review. No Godot
scene, collision, placements or original resource was modified. Native dry,
rain and night acceptance remains for the integrator. Use height displacement
or suitable ground geometry where clods affect visible silhouettes; normals
alone do not change the outline. Tree-pit edges must meet kerbs and roots.

DELIVERABLES
31 material maps; five low-sun previews; labelled 2x2 albedo contact sheet;
eight 4x4 albedo QA sheets; two compact QA sheets; generation and validation
scripts; calibration/validation JSON; this README and provenance record.
Previews are 2048 square. Contact sheet is 2048 x 1152 and is not a material.
Regenerate with Python + NumPy, SciPy and Pillow: generate.py, then finish.py.
Only the containing directory receives writes.

FILE LIST
LICENCES.txt
README.txt
contact_sheet.png
dry_earth_albedo.png
dry_earth_ao.png
dry_earth_height.png
dry_earth_normal.png
dry_earth_roughness.png
dry_earth_wet_albedo.png
dry_earth_wet_roughness.png
file_checks.json
finish.py
generate.py
grave_soil_albedo.png
grave_soil_ao.png
grave_soil_height.png
grave_soil_normal.png
grave_soil_roughness.png
pit_soil_albedo.png
pit_soil_ao.png
pit_soil_height.png
pit_soil_normal.png
pit_soil_roughness.png
pit_soil_wet_albedo.png
pit_soil_wet_roughness.png
preview_dry_earth.png
preview_grave_soil.png
preview_pit_soil.png
preview_wet_mud.png
preview_yard_dirt.png
review_relief.png
review_tiling.png
tiling_4x4_dry_earth.png
tiling_4x4_dry_earth_wet.png
tiling_4x4_grave_soil.png
tiling_4x4_pit_soil.png
tiling_4x4_pit_soil_wet.png
tiling_4x4_wet_mud.png
tiling_4x4_yard_dirt.png
tiling_4x4_yard_dirt_wet.png
validation.json
wet_mud_albedo.png
wet_mud_ao.png
wet_mud_height.png
wet_mud_normal.png
wet_mud_roughness.png
yard_dirt_albedo.png
yard_dirt_ao.png
yard_dirt_height.png
yard_dirt_normal.png
yard_dirt_roughness.png
yard_dirt_wet_albedo.png
yard_dirt_wet_roughness.png
