# Wall circuit V10: independent review

**Result: FAIL. Grade: 6.5/10** (V9 was 5.5).

I only read files. I changed nothing. I checked the 14 V10 images you listed, at full size.

The log `candidate-v10-final.log` does not say "Complete" yet. It stops at "Wall circuit candidate: 198 resources". So I did not check the other views or the contact sheets. Because of this, I cannot pass the full circuit.

## V9 findings: what changed

### Fixed

1. **The arch rings no longer go black at night.**
   - In `gate-keizerspoort-threshold-night.png`, the vault (x 300–1230, y 0–490) shows lit brick. Nothing is pure black.
   - The day image shows the same brick with the same camera.
   - There is one soft dark oval on the crown above the lantern (x 810–975, y 45–125). The lantern cap blocks light going up, so this is correct. It is not a fault.
2. **The mortar no longer shows stair steps.**
   - In `guard-drain-return-low-day/rain/night.png`, the joints are smooth at x 420–440, y 500–560 and at x 700–760, y 330–400.
   - The dashed lines at y 600–610 and y 880–890 are gone.
   - In `stair-08-treads-day.png`, the tread fronts show no black speckle.
3. **Night evidence now exists.** `seg-06-base-close-night.png` has the label "inspection lamp". It shows the block joints and the fern clumps.
4. **The lamp light is correct in the current images.**
   - Guard-drain night: warm light falls off around the lamp (x 940–1300, y 180–650). The bracket shadow sits where the lamp position puts it. I see no rings and no hard cage shadows.
   - Gate night: the light reaches the walls on both sides and the setts. The outer faces stay dark.

### Withdrawn

5. **The town-side earth strip.** Earth beside a paved street is a design choice. It is not a hole. The stair foot now has a built stone apron and a gully: `stair-00-wide-day.png`, x 420–930, y 560–720.
6. **The kerb at segment 04 is no longer a blocker.** In `kerb-seg04-end-day.png` (x 210–735, y 428–510), both ends are square and closed. It does not cut into the timber. It still looks like it does nothing, but that is a design point only.
7. **Wheel guards.** No reference asks for them. A drain channel inside a covered passage is also optional.

### Still open (these block a pass)

8. **The wall base still shows no water line or damp band.**
   - `seg-06-base-close-day.png`: the wall meets the pond at x 0–1050, y 690–830. I see no algae line and no damp band there. The brief says "a narrow algae waterline", but I cannot see it.
   - There is only faint dark staining higher up (x 600–1000, y 540–650).
   - `guard-drain-return-day.png`: the lowest brick courses (x 0–640, y 560–690) are as clean as the courses above. There is no splash or dirt line at the cobbles, and none around the gully (x 650–825, y 555–680).
   - AGENTS.md calls this a wear defect. A wear defect blocks a pass.
9. **Rain only half works.**
   - These views now get wet: `stair-00-wide-rain.png`, where the granite plinth (x 0–890, y 500–800) is darker than in the day image, and `guard-drain-return-low-rain.png`, where brick and stone shine.
   - These do not: in `seg-06-base-close-rain.png`, the wall (x 0–1440, y 0–690) looks the same as the day image. Only the pond ripples change.
   - In `kerb-seg04-end-rain.png`, the kerb slab is the same as by day. The setts are only a little darker, with no shine and no puddles.

### Still open (smaller)

- **Stair treads** (`stair-08-treads-day.png`):
  - The nosings show only a thin highlight (y 595, 678, 798).
  - I cannot see the 16 mm wear troughs. The treads look flat and evenly coloured (x 140–1310, y 800–880).
  - The troughs may be too shallow to show at this angle. I cannot tell.
- **Foliage** is still too bright: yellow leaves at x 1010–1440, y 135–420.
- **The gate threshold** (`gate-keizerspoort-threshold-day.png`):
  - The setts run straight to the door at y 490. There is no sill stone.
  - The passage setts stop at a raw diagonal edge against the earth (x 330–1200, y 630–800). There is no edge stone.
- **Not checked this round:** the black block (sheet 19), the white streaks (sheet 18), the pond bank edge (sheet 15) and repetition. They need the new contact sheets.

## New, not certain

- In `guard-drain-return-low-*.png`, the left brick wall may have a horizontal seam at y ≈ 620–630, across x 0–830.
- At the same height, the wall corner jogs out a little: x ≈ 825–840, y ≈ 620–690.
- This may be a panel join, or just the texture. I cannot prove it. A wireframe view would settle it.

## What to do now

1. Make the pond water line and the splash band at the wall base clearly visible. Then re-render `seg-06-base-close-day` and `guard-drain-return-day`.
2. Make rain darken the granite at seg-06 and the kerb slab at segment 04.
3. When the log says "Complete", check the new contact sheets. Look first at sheets 15, 18 and 19.
