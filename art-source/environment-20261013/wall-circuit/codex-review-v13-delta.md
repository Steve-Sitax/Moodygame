# Codex V13 gate-lighting and daylight regression review

Gate lighting delta: **PASS, 8.3/10**. Overall circuit: **HOLD pending identification of the small-face findings below**; the gate pass does not waive them.

Reviewed all eight fresh gate passage/threshold night images across Keizerspoort, Kipdorppoort, Rode Poort and Sint-Jorispoort, plus all four atmospheric threshold night images. The upper vault now has a continuous, restrained warm response without the isolated dark cap oval. Brick courses remain readable, the entrance/exterior stays appropriately dark, and there is no visible broad ambient glow. Read-only inspection of `VaultBounce()` and its insertion confirms a bounded gate-footprint, lamp-position and height mask affecting the lamp-cap factor in the existing spill path, not a global emissive term. This is an approximation of reflected light, not a full indirect-light simulation.

Read `v13-day-regression.json` and reopened all 17 differing daylight images at full resolution. The other 271 daylight PNGs were reported identical. Stair 00 fit, railing sockets, material scale and weathering remain sound. Two surface findings require diagnostic closure:

- `seg-09-04-field-day.png`: a straight black vertical stroke at approximately x1034/y354–393 beneath the coping, and another at x1036/y524–536 on the plinth (1440×900). The upper stroke terminates mid-brick rather than reading as a continuous construction joint. The implementer is ray-picking its source.
- Thin repeated diagonal light lines cross stone faces in `seg-05-01-field-day.png` (approximately x650–1340/y490–535), `seg-05-02-field-day.png` (x700–1390/y495–537), and the left plinth return of `seg-07-02-field-day.png` (x0–95/y500–550). Their regular straight geometry suggests triangulation-edge exposure or a related backing/shading issue. Cause is not established; these should not be described as natural wear without evidence.

These are faint in wide contact sheets but visible at full resolution. This review updates the earlier whole-circuit pass with an explicit hold on the newly identified details. No implementation or assets were edited; characters and wildlife were not inspected.
