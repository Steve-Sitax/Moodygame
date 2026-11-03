# Fitted ground junctions (#270)

The earth, flags, cobble and grass resources (`r000008`, `r000017`, `r000025`,
`r000031`) retain their original surface arrays and collision metadata. Each has
one added surface of fitted closures. Quay resource `r000039` needs no addition.
No scene transforms, permanent IDs, material resources or textures change.

The topology audit splits unmatched triangle edges at T-junctions and cancels
shared edges before fitting opposite ground boundaries or measured wall feet.
Closures are at most 20 mm wide. Three-way overlaps are partitioned, and the
recorded Ruien inlet diameters are reserved. This does not fill arbitrary holes:
cellars, stairwells and water boundaries must remain open.

At `wall-stair-09`, beside the grate near (-353.61, 282.52), the existing apron
bedding top is 20 mm below the street. A horizontal closure alone leaves a
grazing-angle opening. Seven fitted returns descend to -25 mm and overlap the
actual bedding by 4 mm horizontally. The grate, sump and inlet remain unchanged.
These are mating/buried joint surfaces: sharp ends are intentional, and no new
exposed stone arris requires a bevel. Existing stone bevels are retained.

The final resources add 8,256 triangles from 5,015 fitted pieces: earth 3,327,
flags 1,688, cobble 3,065 and grass 176. The applier omits 157 triangle halves
that collapse to zero area at native float precision and checks each remaining
triangle's winding independently. This is a geometry count, not a performance claim.
Original UV, UV2, color, tangent, normal and position values are untouched;
added surfaces extrapolate the source UV frame and interpolate other channels.
The sloped return has its own normal and regenerated tangent frame.

## Reproduction and verification

Keep original resource copies, plans, receipts and render output outside the
checkout. Use the native engine with `--headless --path native-godot --script`
for the audit/verification scripts, followed by `--` and their arguments.

1. `scripts/ground-junction-audit.gd ORIGINAL_RESOURCE_DIR AUDIT_DIR` exports
   original ground arrays and native wall intersections.
2. `python tools/ground-junctions.py AUDIT_DIR ORIGINAL_RESOURCE_DIR` produces
   `fitted-with-walls.json`, with intermediate topology receipts.
3. `scripts/ground-apron-audit.gd APRON_JSON` exports the native bedding/grate
   triangles; `python tools/ground-apron-junction.py AUDIT_DIR APRON_JSON PLAN_JSON`
   appends the local fitted return.
4. From original copies only, run `scripts/ground-junction-repair.tscn` with
   `-- --apply --plan PLAN_JSON --record EXTERNAL_BACKUP_DIR`. The tool rejects
   source hash mismatches and accumulated patches; omit `--apply` for a dry run.
5. Run `scripts/ground-junction-verify.gd ORIGINAL_RESOURCE_DIR RECEIPT_JSON` and
   `python tools/ground-junction-check.py PLAN_JSON RECEIPT_JSON`.
6. Build and review `scripts/ground-seam-review.tscn` in the native game. It hides
   the river backstop. Hour 12.5 temporarily makes the five ground materials
   neutral grey for diagnosis. Use daylight, rain, night and low views with
   isolated seed-1873 data, no AI, an unused port and the shared render lock.

The tools use installed numpy/scipy/shapely for offline geometry only. They add
no runtime dependency or third-party asset. Numerical checks do not replace
native visual review, and these repairs do not constitute overall city acceptance.

The final native review covered eight targets in daylight, rain and night, plus
five close/neutral views of the stair apron. The former see-through wedge is
closed while the grate remains open. Foliage and darkness limit some wide views;
repeated textures, retained stone detail and wider drainage still need work.
