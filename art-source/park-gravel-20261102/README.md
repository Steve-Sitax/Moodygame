# The Stadspark's path gravel · 2 November 2026 (#199)

The park's paths (`park_nature/park_ground_gravel`, the town's material r001150 `park_gravel`, 226 triangles, uv 0.5 a
metre) drew 3 to 8 cm pebbles, domed and dark, with a 3 cm parallax: from eye height they read as dark cobbles.

- `park_gravel.py <out>` draws a new 2 m tile, seamless, original artwork (no third-party picture): a pale buff sand
  binder with soft damp patches, packed with rolled river gravel of 2 to 24 mm (tan, grey, white quartz, flint, a few
  brick crumbs) sitting low with flat tops, and its height. `gravel_colour.png` (1024 px) and `gravel_relief.png`
  (512 px) are its output.
- `native-godot/scripts/texture-repair.tscn` installs them into r001147 (colour) and r001149 (relief), same resources,
  RGBA8 with mipmaps; only the park gravel's material uses them.
- `native-godot/scripts/park-gravel-repair.tscn` sets the material's numbers: parallax 0.03 -> 0.009 m, relief light
  2.8 -> 2.0, dome 2.5 -> 0.8.

Same shader, no new kind (shader check: 41 programs, 152 kinds, baseline matched). Pictures:
`D:/Code/_tmp_verify/run-2026-11-01/P-paving/` (`sbs3_park.png`: before and after at 13:00 clear, rain and 22:00).
