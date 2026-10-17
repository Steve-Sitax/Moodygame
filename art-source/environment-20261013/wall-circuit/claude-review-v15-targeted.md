**What I did:** I looked at all 6 images. Most of them I saw full-size only. My crop tool was denied, so I could not zoom in. I changed no files.

## river-return-small-face: PASS, 8.5/10

- The old flaw is gone. The thin stacked stone strips at x1105-1150 y625-885 no longer show, in day, rain or clay.
- The plinth is now whole blocks. The joints run straight. I see no stretched or bent texture near x1000-1300.
- Rain looks good.
- Night is almost black. I cannot judge any joint in it. This is not a block, but night proves nothing here.

## seg-06-04-field: HOLD, 6.5/10

- **Lower right is clean now.** Codex's diagonals in the plinth (about x980-1440 y730-900) do not show in day or clay. The joints there look straight.
- **Flaw 1 (blocks acceptance):** the brick face has a patch edge.
  - A vertical tone seam runs at about x405-415, y150-620.
  - A horizontal seam joins it at about y205, x410-900.
  - Together they look like a pasted rectangle. This is a wear or UV patch boundary (a place where the texture map changes).
- **Flaw 2 (check it):** there may be a second vertical tone step at about x880-900, y480-900.
- **Flaw 3 (check it):** the clay image shows soft diagonal light streaks on the brick face. One runs from about x560,y900 up to x700,y600. Another is at about x1000-1150, y100-700. This can be a bad surface direction (normals) that makes uneven shading, or it can be normal shading. If it is the normals, it is the "diagonals" at a smaller size.

## What to do now

1. Take a 2x crop of seg-06-04-field day at x300-950 y120-650. This shows if the x405/y205 seam is real.
2. Take a clay crop at x500-1200 y100-900. This checks the diagonal streaks.
3. If the seam is real, fix the brick wear/UV patch boundary. Then run the full regression.
