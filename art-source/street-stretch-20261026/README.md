# Street setts: no stretch, a row of setts on every joint · 26 October 2026

Steve: after the paving was turned along the streets (#170, #199), setts were stretched to streaks in places, and the
patterns clashed where two streets met.

## Cause

The layout's field uv (`layout.py`, a conformal fan per street) collapses past a street's end and inside tight
corners: `-ln(1 - k t) / k` is clipped at `|k t| = 0.6`, and the nearest centre-line sample jumps across a bend's
inside. Large faces there spanned the jump. Measured on the installed meshes (a face is stretched when its uv frame
is over 1.15 times longer one way, or a sett is under 0.8 or over 1.3 of its size): `ground_cobble` 7,029 m2 of field
and 506 m2 of edge course, `ground_quay` 1,691 and 51 m2. Every one of 2.8 km of joints between two street layouts
broke the pattern.

## Repair (`native-godot/scripts/paving/seam_stones.py`)

Works on the installed rows (`dump-ground.gd`), so the junction phase and the Ruien cut stay. Positions, outline,
holes, heights, normals, colours and uv2 are kept; only touched faces are cut again.
- Stretched field: patches (closed 0.35 m, outline straightened, 0.25 m into good setts) laid in straight courses in
  the frame of the same street's good setts beside them, continuing their courses where the frames agree.
- One row of setts laid lengthwise (one course: 3/13 m, quay 2.5/12 m), mitred at bends, on every joint between two
  layouts and on a patch's edge where its courses do not run on (over 2 cm off).
- A stretched edge-course face: its own course made rigid.
- After: stretched area 0.0008 m2 (cobble), 0.000001 m2 (quay); areas equal to the float.

`python seam_stones.py <rows> <tile> <rows per tile> <out> <report>`; install with
`res://scripts/stone-corners-promote.tscn -- --candidate <c> --record <r> --backup <outside git>` (surfaceRepairs
manifest). `dump-flat-ground.gd` dumps every upward face under 1.2 m for a town-wide stretch audit.

## Bump and texture

The relief shader takes its frame from the surface's own uv derivatives (`rel_frame`, `ground_tilt`), so the height,
stone id and light follow any rigid or mirrored frame. Colour, height and stone-id maps of the cobble, quay and flag
materials line up at zero shift (cross-correlation, no flip). Every new face is rigid, so bump and colour agree.

## Checks (2026-10-26)

Collision and walk-map support faces identical (promotion support hashes unchanged). Native build PASS.
Rendered gameplay before/after at the 20 worst places (13:00 clear), and 4 of them in rain and at 22:00: streaks gone,
setts whole, bumps on the stones. Pictures kept outside git. No frame-time check (Steve: visual only).

## Not done

`ground_flags` (3 m2 stretched) and the flag squares' joints unchanged. Kerb, rail, rut, coping and seam strips keep
their intended long uv.
