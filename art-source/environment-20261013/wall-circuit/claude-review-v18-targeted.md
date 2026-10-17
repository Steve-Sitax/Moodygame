I could only look at the images at full size. I could not zoom: the PowerShell and PhotoCraft crop tools were blocked. That means the coordinates below are estimates, accurate to about ±10 px.

**Verdict: FAIL (not clean).** At least one cut inside bricks is still visible. The arbitrary cuts from v15 are mostly gone, but some straight vertical seams remain.

**1. `brick-v18-crop.png` (1300×1060): cut found**
- There are two straight vertical seams at **x ≈ 160** and **x ≈ 230**. They run from **y ≈ 90 to y ≈ 1000**, in the large bricks near the camera.
- The tone changes along a straight vertical line that crosses many courses. In running bond (each course shifted half a brick), such a line goes through the middle of the bricks in every second course. Normal mortar or colour change cannot do that.
- Clear examples:
  - x 160–235 at y ≈ 290–330
  - x 160–235 at y ≈ 380–410
  - x 160–235 at y ≈ 630–660
  - x 160–235 at y ≈ 730–760
- These are the same two positions as in v15. The v15 seams at **x ≈ 760** and **x ≈ 1170** (near y ≈ 540–580 and y ≈ 810–840) are gone in v18.
- My guess at the cause: the seven-brick span starts and ends on a mortar joint in one course. In the next course, that same edge falls half a brick off the joint, so it lands inside a brick. A single vertical wrap line cannot sit on a joint in both kinds of course.

**2. `seg-06-04-field-day.png` (1440×900): seam found, cause not proven**
- There is a straight vertical tone step at **x ≈ 405–420**, from **y ≈ 40 to y ≈ 640**. The bricks on the left are darker.
- It stops at y ≈ 640, but the bricks go on below that line. So it may be a shadow from the lamp bracket at the top (x ≈ 540–610, y ≈ 0–40), and not a texture cut.
- I cannot separate the two causes at this size.

**3. `river-return-small-face-day.png` (1440×900): no cut I can see, but a pattern problem**
- The bricks are only about 10 px wide, too small to judge cuts inside bricks.
- A clear diagonal diamond pattern repeats about every 150 px across the whole brick face (x 0–1440, y 90–590). This is visible tiling repetition. It is not a cut, but it looks like a pattern.

**What to do now**
1. Make close shots (2× or larger) of v18 at x 130–260, y 250–800. Check whether each seam lands on a joint in one course and inside a brick in the next.
2. Shoot seg-06-04 again with no sun shadow (overcast or noon) to rule the lamp shadow in or out.
