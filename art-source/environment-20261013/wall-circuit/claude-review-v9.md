# Wall circuit V9: independent review

**Result: FAIL. Grade: 5.5/10.**

I only read files. I made no changes. I checked all 14 full-size images and all 24 contact sheets (the log says "Created 24 sheets"). I did not look at characters or wildlife.

The contact sheets show day images only. The only rain and night evidence is in the full-size images.

## What is better now

- The vault curves are smooth. I see no flat facets in `gate-keizerspoort-passage-day.png`.
- The quoins (corner blocks) and plinth blocks show thin bevel highlights. Example: `guard-drain-return-day.png`, x 850–1270, y 135–390.
- The stair railing posts sit on the coping. The sockets follow the posts.
- The wall-walk parapets have scuppers (small drain holes in the parapet). Example: `gate-keizerspoort-roof-day.png`, x 320–352, y 795–815.
- The huts have downpipes, and gullies (street drain grates) sit at the stair feet.
- Rain ripples show on the pond in `seg-06-base-close-rain.png`.

## Blockers (visible proof)

1. **Gate arch stones are missing by day and black at night.** Both images use the same camera; the lantern is at x ≈ 885, y 150–210 in both.
   - In `gate-keizerspoort-threshold-night.png`, two thick arch rings show at x 615–1135, y 20–500. They are pure black with no stone texture. They merge into a black lens shape at x 810–955, y 45–120.
   - In `gate-keizerspoort-threshold-day.png`, those rings are not there. Plain brick fills the same area.
   - The rings face the lantern, so they should be lit. Possible causes are flipped normals, a visibility-range problem or a different resource load. I cannot tell which.
   - This is a proven render fault on the 50 new radial stones.

2. **The height-map shows stair steps at low angles.**
   - In `guard-drain-return-low-rain.png`, the brick joints show jagged, stepped edges: x 420–440, y 500–560 and x 700–720, y 330–400.
   - In `guard-drain-return-low-night.png`, dark dashed lines run along the brick edges: x 30–420, y 600–610 and x 350–760, y 880–890.
   - The tread fronts show black speckle: sheet-21 tile `stair-03-treads` and sheet-22 tile `stair-06-treads`, near original x 1580–2020, y 330–420.

3. **The rain images do not show wet stone.**
   - In `stair-00-wide-rain.png`, the granite plinth (x 0–890, y 500–800) is light grey and looks dry. It is lighter than in the day image.
   - In `seg-06-base-close-rain.png`, the wall looks almost the same as the day image.
   - In `kerb-seg04-end-rain.png`, the ground is darker but has no shine and no puddles.
   - Only the brick in `guard-drain-return-low-rain.png` shows a wet shine.

4. **One night image gives no evidence.** `seg-06-base-close-night.png` is almost all black. Only faint reeds show at x 1060–1440, y 380–640. The brief says views with no nearby fixture are labelled "inspection lamp". This image has no such label. Night behaviour at this wall base is not verified.

5. **The wall bases show almost no weathering.**
   - `guard-drain-return-day.png`: the lowest brick courses (x 0–620, y 600–690) are as clean as the courses above. There is no splash or dirt line at the cobbles.
   - `seg-06-base-close-day.png`: the wall meets the pond at y 600–800 with no water line, algae or damp band.
   - The "multiscale damp" claim is not visible at review distance.

6. **The town-side walkway strip is flat and unbuilt.** A dark, blurry band with no joints, setts or slabs runs along the wall base:
   - `stair-11-wide-day.png`: x 0–620, y 680–900
   - `stair-00-wide-rain.png`: x 0–640, y 670–900
   - `kerb-seg04-end-day.png`: x 430–1440, y 388–440
   - `gate-keizerspoort-threshold-day.png`: x 0–1200, y 560–900
   - The same band shows on almost every `seg-*-town` tile.
   - AGENTS.md says pavement must fit the foundations. This strip does not show that it does.

7. **The kerb at segment 04 is a loose stub.**
   - In `kerb-seg04-end-day.png`, a short, low kerb (x 210–735, y 428–510) starts at the timber face at x ≈ 220 and stops in open setts at x 735.
   - Its end is square, but it borders nothing and directs no water.
   - I cannot tell if its left end goes into the timber.

## Smaller defects

- **Gate passage construction.** In `gate-keizerspoort-passage-day.png`:
  - There is no threshold stone and no wheel guards (corner stones that protect the walls from cart wheels).
  - There is no drain channel. The setts run straight to the door at y 585.
  - The granite lining (x 0–595 and 845–1440, y 530–820) is almost flat. It has one joint only.
  - The vault starts on the granite with no impost (the ledge stone where an arch starts).
- **Stair treads.** In `stair-08-treads-day.png`, the tread nosings at y 680 and y 795 are hard straight lines with no visible bevel. The 16 mm wear trough is not visible: the treads look flat and evenly coloured.
- **Pond bank edge.** On sheet-15, tile `seg-06-02-town`, the bank edge is angular, near original x 378–718, y 1177–1350. This conflicts with the brief's claim that the damp wedges are gone. It is also possible this is the bank shape, not damp. I cannot tell.
- **Black block, cause unknown.** On sheet-19, tile `seg-09-04-town`, a pure black rectangle shows at original x 292–718, y 1588–1800. It may be a shadow, or a missing material or wrong face direction.
- **Two white streaks.** On sheet-18, tile `seg-08-base-close`, two white vertical streaks show at original x ≈ 1188, y 961–1037 and x ≈ 1253, y 1118–1199. They may be scratch decals or texture seams.
- **Repetition.**
  - The plinth blocks are the same size in a strict grid on every field and town tile.
  - The slate roofs use one even tile pattern, for example `gate-keizerspoort-roof-day.png`, x 470–1220, y 290–550.
  - The flat field grass has no texture detail.
- **Foliage is too bright.** In `stair-08-treads-day.png`, the leaves (x 1010–1440, y 140–420) are much brighter than the stone around them.
- **Gate tower downpipes (not certain).** In `gate-keizerspoort-roof-day.png`, I see no downpipe on the visible tower walls (x 480–1200). They may be on the hidden faces.

## Limits of this review

- Night evidence is in 4 images only. Rain evidence is in 5 images only. All 24 contact sheets are day images.
- I cannot prove the causes. The black arch rings may be normals, shadows or a load problem. The stepped edges may be parallax slicing or filtering.
- A geometry check that passes does not prove the rendered result.

## What to do now

1. Fix the arch rings first. Find out why they are missing by day and black at night, then re-render day and night with the same camera.
2. Fix the height-map stepping at low angles.
3. Make rain wet the stone.
4. Re-render `seg-06-base-close-night` with a labelled inspection lamp.
5. Give the walkway strip and the kerb at segment 04 real paving and joints, then add wall-base grime and water lines.

After that, review the full set again.
