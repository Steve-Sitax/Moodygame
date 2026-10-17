I read all 13 pictures and the rules. Now I write the review.

# V6 review: FAIL, 4/10

I did not change any files. I looked only at the pictures. I did not open meshes, collision or drain data.

## Pictures I read (all 13)
In `native-godot/proof/wall-circuit/candidate/`:
- guard-drain-return-day, -rain, -low-night
- stair-00-foot-day, stair-01-treads-day, stair-04-treads-day, stair-08-back-day
- gate-keizerspoort-passage-day, -threshold-day, -roof-day
- seg-04-base-close-day, seg-06-base-close-day
- hut-14-back-night

## Better than before
- Roof hip covers show on both gate towers (roof, hips from about 655,290 to 630,550).
- Stone blocks look like real blocks. I see no z-fighting stripe.
- The downpipe shoe sits above the grate (guard day, 720,570).
- The gate front has good detail: arms panel, pinnacles, voussoirs (roof, 885–1115, 520–900).

## Blockers I can see (sure)
1. **Rain has no cause and effect.** In guard rain, the brick, cobbles and grate look like day, only darker. No water comes out of the shoe at 720,570. There is no splash, no wet shine and no puddle at the grate (650–825, 555–685).
2. **Night bricks break up.** In guard low night, black jagged lines run under the brick edges (25–430, about 605). Broken dashes run along the bottom (0–300 and 600–830, about 875). I think this is the height or parallax effect failing at a flat angle.
3. **Railings have no fixings.** Post feet stop flat on stone at 800,555 and 930,715 (stair-08), and at 1080,345 (stair-00). There is no base, socket or lead plug. Rails join posts with no collar. The rail end at 705,265 (stair-00) has no end piece.
4. **Stair edges look new.** Stair-01 and stair-04 noses are straight, sharp and the same on each step (y 455, 515, 575, 680). Treads show no worn middle and no chips. The landing in stair-08 (700–1100, 480–900) is flat and has no wear.
5. **Wall feet are clean.** The brick and stone feet meet the paving with a hard, clean line and no dirt, splash or damp:
   - guard day: 0–630, 660–700
   - seg-04: 0–1440, 560–680
   - gate passage: y 535–820
   The cobbles next to them also show no matching stain.
6. **Wall plinth is flat and repeats.** In seg-04 and seg-06, every block has the same surface. The joints are thin lines only, and the edges are sharp with no chips. In gate passage (0–595, 535–820), the plinth looks like one slab with a single seam.
7. **Seg-06 plants are fake.** Flat dark blade cards sit on the wall face at 500–590,240; 920–1030,235–330; and 1170–1240,400–465. They have no thickness and no crack to grow from. The reeds (1050–1440, 380–650) have no bank or soil under them. They seem to float at the wall.
8. **Seg-06 waterline has no wet band.** Where wall meets water (about y 690–900, x 900–1440), there is no tide line, algae or darker stone.
9. **Gate threshold does not fit.** In the threshold view, the cobbles stop on a straight line (310,635 to 1200,830) against a plain, smooth surface. There is no sill, kerb or edge stone. That plain surface (0–1200, 570–900) has almost no texture up close.
10. **Gate passage has no drain.** The passage floor shows no channel or gully. The door (598–843, 305–585) has no frame, jamb or threshold stone. A dark gap shows at 598–610, 380–430.
11. **Seg-04 kerb sliver.** A pale strip (0–480, 640–790) gets thin and ends in a point at the wall foot (about 480,640). Either it runs into the wall or it was cut on a slant. Both break the kerb rule.

## Probable blockers (not sure)
- **Thin side looks stretched.** In guard day and rain, the narrow pale face at 795–840, 135–475 shows streaks that go up and down. This can be stretched texture on a small side.
- **Reddish joint lines.** In guard day, thin pink lines show at stone joints (850–1035, y 130 and 305). This can be colour from the brick texture leaking into the stone.
- **Brick size changes.** In the threshold view, the wall bricks at 0–300 look much smaller than the pier bricks at 1240–1440. The passage vault bricks also look small. Camera distance can explain part of this.
- **Roof water route is not visible.** I see no downpipes on the visible tower faces (roof view) or on the hut. The hut gutters and the wall-walk spouts are not clear. The small dark box at 335,800 may be a scupper (an opening that lets water out through a wall).
- **Hut light leak.** In hut-14, a lit orange piece of parapet shows at 445–465, 405–475. The parapet next to it is dark.
- **No fog by day.** The day views show the far horizon clearly (stair-08, roof). Art direction asks for dense fog from 3 m to 25 m. Maybe these proofs turned fog off on purpose.
- **Guard corner bond.** At the brick corner (x 625), the bricks look cut on each face. A real corner turns bricks across both faces.

## What the pictures cannot show
- **Ruien links.** I cannot check from pictures that each drain has its inlet, invert (the height of the pipe floor), pipe size and connection ID. I see only one grate (guard) and one road gully (stair-00, 170–360, 820–900).
- **Too dark.** hut-14 night is too dark for a detail check.
- **Missing views.** There are no rain or night pictures for the stairs, gate or wall segments, and no view from below.
- **Not checked.** Collision, edge sizes in mm, and whether the bevels are real geometry.

## Grades
| View | Grade |
|---|---|
| guard day | 5 |
| guard rain | 3 |
| guard night | 4 |
| stair-00 | 5 |
| stair-01 / 04 | 4 |
| stair-08 | 5 |
| gate passage | 4 |
| gate threshold | 3 |
| gate roof | 6 |
| seg-04 | 4 |
| seg-06 | 3 |
| hut-14 night | not gradable (too dark) |

## What to do now
1. Fix the sure blockers 1 to 11.
2. Then take new pictures: rain and night for the stairs, gate and wall segments, a brighter hut night picture, and a close look at each drain grate.
