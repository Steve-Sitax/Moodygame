I only read files. I changed nothing. Both logs are complete.

## Result: FAIL. Grade: 6.5/10 (same as V10)

## What is better
- **Rain on the kerb works.** In `kerb-seg04-end-rain.png`, the kerb slab and the setts are clearly darker than by day.
- **Rain on the pond wall works, but only a little.** Your numbers say 17.6% darker. The pair image agrees. Rough stone does not have to shine, so I accept this.
- **The pond wall now has a damp band.** In `seg-06-base-close-day.png`, the lowest course is darker at x 0–1050, y 550–690.
- The V10 fixes still hold: lit arch at night, no stair steps in the mortar, correct lamp light.

## Blockers (each one stops a pass)
1. **No dirt at the foot of the guard-drain wall.** In `guard-drain-return-day.png`:
   - The lowest brick courses (x 0–640, y 560–690) are as clean as the courses above.
   - There is no dirt around the gully (x 650–825, y 555–680).
   - The stone plinth on the right (x 820–1310, y 390–490) is also clean.
   - The day half of the pair image shows the same thing. V11 did not visibly change this view.
2. **No algae line where the wall meets the water.** In `seg-06-base-close`:
   - The wall meets the water along a line from x 0, y 830 to x 1050, y 690.
   - By day I see a dark band above that line, but no green line on it.
   - At night (x 0–1050, y 640–830), I see no line and no band at all.
3. **White streaks are still there (sheet 18).** In `seg-08-base-close-day.png`:
   - One double streak is at x 935–955, y 70–320. A second is at x 1060–1075, y 445–590.
   - Each one sits just right of a joint and stops part way down the block.
   - An edge highlight would run the full length of the joint. So this is probably a texture or UV fault (UV = how the picture is laid onto the shape). I cannot prove the cause.
4. **The black block is still there (sheet 19).** In `seg-09-04-town-day.png`:
   - The lower part of the neighbouring house goes pure black at x 585–1440, y 600–900.
   - Its top edge is leaf-shaped (y 600–690). This is probably an unlit hedge or a contact shadow.
   - The shaded brick just above it is still visible. So this black is wrong for daylight.

## Uncertain (need a closer view or a wireframe)
- **Pond bank** (`seg-06-02-town-day.png`):
  - The near bank shows a dark, smooth, untextured side at x 505–640, y 745–900.
  - The far island edge at x 1140–1440, y 570–625 looks like a slab floating on the water.
- **Narrow face of the pier** (same image): a plain grey strip at x 335–360, y 0–760, with a small step at y 320–340. This may be stretched texture on a narrow face.
- **Downpipe** (`guard-drain-return-rain.png`): a bright square at x 740–750, y 460–490. It shows only in rain.
- **Faint fern** (`seg-06-base-close`): at x 1165–1235, y 395–450 it looks half transparent.
- The V10 seam and jog at y 620–690 in guard-drain-low: I do not see them in the night image now.

## Design points only (not blockers)
- The foliage is still too bright and tan.
- The gate has no sill stone, and the passage setts have no edge stone.
- The setts near the kerb look soft at close range.

## Not checked
- I checked contact sheets 15, 18 and 19 only. I did not redo the other 21. Their geometry has not changed.
- The contact sheets are day only. So rain and night are checked only in the close views above.

## What to do now
1. Add splash dirt to the guard-drain wall foot and the gully. Then re-render `guard-drain-return-day`.
2. Make a visible green algae line at the seg-06 waterline. Check it by day and at night.
3. Find out why the seg-08 streaks and the seg-09-04 black band appear. A wireframe or debug view will show the cause.
