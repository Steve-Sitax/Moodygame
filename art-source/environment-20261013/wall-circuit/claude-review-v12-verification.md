**Result: FAIL. Grade: 8.0 out of 10.**

I edited no files.

**What I looked at:**
- The side-by-side brick crop.
- The lamp shader code, lines 121–126 and 150–164.
- The full night pictures `gate-keizerspoort-passage-night` and `gate-keizerspoort-threshold-night`.

## Blocker 2, wet brick: withdrawn
- My V12 claim was wrong. In the crop, the rain brick is clearly darker than the day brick. It is also a little richer in colour.
- The numbers agree. The rain brick has about 58% of the day brightness, and about 62% in the lowest rows.
- Darker colour with almost no shine is how wet brick looks under a grey sky. The result is believable.
- Optional polish: add a faint sheen on the bricks that face up.

## Blocker 3, dirt at the wall base: withdrawn, now polish
- In the 2x enlarged crop, the bottom rows are darker and the mortar is duller and browner. The base joins the paving.
- There is no defect here. A stronger band of splash dirt would be a taste choice, not a fix.

## Blocker 1, black oval above the lantern: still a blocker
- The shader evidence is correct. The cap rule is meant to keep light off the ceiling right above the lamp. So the code has no bug.
- The picture is still wrong:
  - **Black hole.** Inside the oval, the cap rule sets the lamp light to zero, and nothing else lights that spot. So the oval is the darkest thing in the frame. It is darker than the far, unlit corners of the vault.
  - **Hard rim.** The light goes from zero to full over a narrow band of angles. Just outside the oval, the ceiling is at its brightest. This makes a black disc inside a bright ring, which is the same ring look that V10 called a fault.
  - **No fill.** In a real vault, light that bounces off the lit walls and floor would fill this spot. This renderer adds no bounce light, so nothing softens the oval.
- On both night views, the oval reads as a stain or a hole in the ceiling, not as the shadow of a cap.

**Fix:** keep a small amount of the lamp light above the cap, about 15–25%. Also widen the soft edge of the cap rule. The ceiling stays darker above the lamp, but it no longer goes black. Then shoot both gate night views again, and the other gate passages too.

## What you do now
Fix the lantern ceiling oval only. The other two V12 blockers are closed. Then run V13.
