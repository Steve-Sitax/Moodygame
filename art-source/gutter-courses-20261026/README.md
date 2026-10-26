# Sidewalk, gutter and drain textures · 26 October 2026

Steve: make sure the sidewalk, gutter and drain textures look right.

## Found (measured on the installed town, then rendered)

- Pavement tops (flags r000016, explicit uv): 5,784 m2, 0.2 m2 stretched. Right as they were.
- Street gutters (old stone r000209, slab path): the slab shader lays its flags in world metres along the face's
  tangent. On 1,350 m2 of the 2,260 m2 of street gutters the courses ran across or slanting (north-south and slanting
  streets), and wherever the gutter ran along them a course joint ran lengthwise inside it at a random place.
- Kerb arrises: 279 m2 of bevels under 5 cm wide had their picture squashed over 3 times.
- Drains: gullies, channel plates and receivers sit right. 72 of 1,526 downpipe feet have no iron below them; most
  end on the pavement (`pipe-feet-without-drain.json`, issue filed).

## Repair (`native-godot/scripts/paving/gutter_courses.py`, `slab-phase.gd`, Psx slab block)

- Psx: with slab_turn 2 the face's uv is added to the slab picture's place (`suv += UV`). Flat low faces of this kind
  draw only the slab picture, so their uv was unused. Shader kind changed in place (baseline updated).
- Every old-stone surface of the 27 town blocks: flat low faces uv 0 (as before); each of 824 gutter strips gets its
  stones along it (tangent) and uv placing the gutter in the middle of the picture's widest course (0.36 m) along its
  smoothed middle line: no lengthwise joint inside a gutter. 36,285 squashed bevel faces get their picture unstretched.
- r000209 slab_turn 2 (`slab-phase.gd`). Positions and collision unchanged (support hashes identical).

## Checks

Top-down texture views before/after at four gutters; rendered gutters at 12:00, 13:00 in rain and 21:00; shader check
PASS after the baseline update.
