SCHELDEMIST - TIDAL SILT / DRIER TIDAL SILT
Created 2026-10-28. Original deterministic procedural artwork, seed 1873.
Destination: D:/Code/ScheldemistWork/dirt/codex-silt/
No MoodyGame files were modified. No downloaded image sources were used.

FILES
Each prefix tidal_silt and tidal_silt_drier has six 2048 x 2048 PNG maps:
  <prefix>_albedo.png      RGB8, sRGB colour; no baked lighting/shadows
  <prefix>_height.png      grayscale16, linear unsigned height
  <prefix>_normal.png      RGB8, linear OpenGL tangent normal (+Y up)
  <prefix>_roughness.png   grayscale8, linear perceptual roughness
  <prefix>_ao.png          grayscale8, linear; white = unoccluded
  <prefix>_water_mask.png  grayscale8, linear; white = standing water

preview_<prefix>.png: 1500 x 1050 oblique material renders, sun ~21 degrees
above the horizon, GGX specular and analytic sky reflection. Same lighting
and exposure for both variants. These are CPU material previews, NOT Godot
screenshots or diffuse maps. Reflections deliberately show wetness.
top_<prefix>.png: 1200 x 1200 orthographic material inspection renders.
tiling_4x4_<prefix>.png: literal unrotated 4 x 4 shaded repeats, 2048 square.
tiling_4x4_<prefix>_albedo.png: literal unrotated 4 x 4 albedo repeats.
contact_sheet.png: 2400 x 800, no text. Upper row wet; lower row drier.
Columns: albedo / height / normal / roughness / AO / water mask.
Height thumbnails show full encoded range, not exaggerated contrast.
generate.py: reproducible authoring and preview source; numpy/scipy/Pillow.
validation.json: dimensions, modes, ranges, boundary statistics.
LICENCES.txt: provenance and source licence statement.

SCALE AND IMPORT
One tile = 2 m x 2 m; one texel = 0.9765625 mm.
Height decode in metres: (unsigned16 / 65535 - 0.5) * 0.050.
The 50 mm encoding range is NOT the relief amplitude: most codes are unused.
Wet surface range: -1.403 to +3.542 mm (4.945 mm total).
Drier surface range: -4.134 to +3.542 mm (7.676 mm total).
All maps repeat in both axes. No duplicated border pixel is required.
UV origin conventions: image right = +U; image up = tangent +V.
Normal RGB = normalized(-dh/du, -dh/dv, 1) * 0.5 + 0.5.
Use albedo as sRGB; every other map as linear data. Do not invert green
for OpenGL. Neutral normals quantize to (128,128,255).
Enable repeat and mipmapping, with anisotropic filtering at grazing angles.
Use a nonmetallic material; metallic = 0. Water sheen comes from roughness
and dielectric reflection. Do not turn the material metallic to match glare.
No emissive contribution. AO is restrained because the surface is shallow.
Do not multiply the displacement by centimetres beyond the stated decode.
Drainage trunks run generally image-top to image-bottom, with tributaries
joining toward the bottom. Align the mapped field with the foreshore fall.
A repeating height cannot encode an overall downhill gradient; the terrain
must provide that gradient and the actual connection to the river.

SURFACE
Grey-brown/olive-grey cohesive silt; tiny shell and coal flakes; embedded
straw/wood slivers; three softened sole impressions and five bird tracks.
No modern boot tread. Small debris has submillimetre relief, not clods.
Wet albedo channels span 35-99 sRGB byte values. Wet silt roughness is
0.25-0.40; water interiors are 0.05 (13/255 after quantization).
Water-mask transition pixels interpolate between water and silt roughness.
Standing water covers 22.30% at mask > 0.5, with soft meniscus transitions.
Every standing-water interior has EXACTLY the same 16-bit height code.
All water interiors have flat tangent normals. No ripples in pool height.
Drier version shares the ground, debris and track layout. Its former pool
beds are exposed; sparse fine crest cracks lower height by up to 0.35 mm.
It is lighter, with silt roughness 0.34-0.53 and 0.079% standing water.
The variants therefore share features, not identical height values in pools.

REVIEW / LIMITATIONS - NOT AN ENVIRONMENT ACCEPTANCE PASS
Inspected mudE.png and mudD.png in dirt/work/pairs. Their upper halves have
sand-like repetitive waves; lower halves show the rejected coarse, crumbly
mud. The new render reads as wet tidal mud: continuous smooth silt, shallow
branching drainage, standing water and glistening low-relief crests. It has
neither the old parallel sand ridges nor the rejected angular clod carpet.
The first procedural pass had conspicuous deep parallel runnels. These
were replaced with a denser, shallower network before delivery.
Remaining issue: the literal 4 x 4 sheet still reveals recurring pool shapes.
The strict 'no visible repeating motif' criterion is NOT fully met. Seamless
boundaries do not mean invisible repetition. This set needs world-scale
variation or complementary tiles before use across a large uninterrupted
foreshore. No randomized/rotated sheet is substituted for the requested test.
Fine tracks and embedded wood are subtle and simplified; debris is not a
replacement for occasional separate larger driftwood meshes. Drier cracks
can disappear under minification. The low-sun highlight is deliberately
strong and can make silt look polished; judge it with the game's lighting.
No in-game verification was performed. Native scene, adjoining quay base,
terrain silhouette, collision and drainage were outside this file-only task.
Displace/tessellate visible ground relief where needed; normal maps alone
cannot change silhouettes. There are no new hard exposed asset edges here:
all terrain relief is soft; grain and cracks are submillimetre detail.
Verify native geometry, water elevation and lighting in daylight, rain and
night before acceptance. This deliverable is a material candidate, not a
claim that the surrounding environment has passed review.

VALIDATION
All 12 requested maps verified at 2048 x 2048. Both height PNG IHDRs confirm
16-bit grayscale. Exported fully white water pixels have one height code
and (128,128,255) normals. Periodic filters, wrapped stamps and periodic
normal derivatives prevent an artificial seam at texture boundaries.
Boundary versus interior differences are recorded in validation.json;
these metrics support the seam check and do not override visual defects.
