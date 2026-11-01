# The town's street setts · 1 November 2026 (#238, #223)

The street setts (`city/ground_cobble`, the town's material r000024) read swollen, glossy and too big up close, and near
black in the shade. Their 3 m relief tile drew stones of about 29 x 17 cm with joints 6 to 7 cm wide, the colour
reflected about 7 %, and the crowns were domed and lit hard. 1873 Antwerp setts (Quenast and Lessines porphyry) are
about 14 to 16 cm wide and 18 to 22 cm long, close-jointed on sand, their crowns worn flat, and reflect 12 to 15 %.

- `tighten_setts.py`: from `before_colour.png`, `before_relief.png`, `before_ids.png` (the stored maps as they were)
  writes `setts_colour.png`, `setts_relief.png`, `setts_ids.png`: every stone grows into its joint (joints keep at
  least about 2 cm; joint share of the tile 0.29 -> 0.17), the relief and ids now 1024 px, a worn arris of about 1.5 cm
  at the new edges, and the stones' colour lifted to porphyry's reflectance.
- `native-godot/scripts/texture-repair.tscn` installs them into r000019, r000021 and r000023 (same resources, RGBA8
  with mipmaps); only the street setts' material uses them.
- `native-godot/scripts/setts-relief-repair.tscn` sets the material's numbers: uv scale 1.4 (stones about 21 x 12 cm),
  relief light 2.6 -> 1.6, crown dome 2.5 -> 1.0, parallax 2.5 -> 1.4 cm, missing stones 1 -> 0.35 (a hole is drawn
  per stone; there are about twice as many a square metre now).

Same shader, no new kind. Pictures: `D:/Code/_tmp_verify/run-2026-11-01/B-dark/` (before3, after3).
