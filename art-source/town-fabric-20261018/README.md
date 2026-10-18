# Town fabric, step 1 · 18 October 2026

Issues #161 (Vleeshuis roof), #173 (ground-floor corner stones by wooden shop fronts) and #171 (the rest of the stone).

## #161 The Vleeshuis roof

- Cause of the dark blob: a recovered room object (`room-vleeshuis-source-9092-0`, kind `cask`) holds the whole hall's
  room furniture, 46 x 30 x 20 m. `FurnitureVisual` swapped every cask for the one shared keg and scaled it to the
  object's size: one keg over the whole roof. The same fault: two casks in the Oostershuis (63 m long), one 19 m row of
  casks in the Vleeshuis, a clock over the prison (26 x 15 x 56 m). A cask group over 2.2 m and a clock group over 3 m now
  keep their own authored models.
- The rooms' window glass (one baked shader, `r006245.res`, 39 materials) was unshaded: the leaded panes kept their
  midday grey all night. `native-godot/scripts/repair-room-glass.gd` gives it the sky's light (`psx_fill`) and a sky
  reflection at a glancing view. Original: `original-resources/r006245.res`.
- The slate roofs, stepped gables with copings, turret spires and tracery were already in the model; the keg hid them.
