# Codex wall circuit review — V4

Overall: **7.5/10, fail pending visible repairs and valid replacement proof**. This is a connected-environment review, not a texture-only pass. Characters and wildlife were not reviewed.

Reviewed all 287 day views through contact sheets, with full-resolution inspection of all 12 stair feet, backs and tread views; all 15 hut backs; four gate fields, passages and town faces; exact guard return; pond/base concerns. Representative rain/night inspection included stairs00/08, guard return, and hut14 front/back. This is not a claim that every rain/night capture was individually reviewed.

## Concrete blockers

- Stair07/08/09/11 base weathering includes large hard triangular green/dark patches. Clearest: stair-08-foot-day and rain, left plinth. Pixel(247,450) hits r000803-relief triangle22443, materialr000648, world(-277.4729,0.2283,335.0938). Its vertex color is constant, so do not attribute this particular patch to varying vertex colors without further evidence. Replace the angular boundary with material/geometry-aligned causal damp and restrained moss.
- seg-06-base-close-day shows large flat green moss shapes with visibly coarse pixel-cutout edges. The old wall moss decal is identifiable independently of the uncertain pointed objects nearby. The current native wall/pond junction does not meet the requested close-view material quality.
- Gate passage plinths read as long continuous stone bands with horizontal joints but little visible vertical block division. Correct the clipped block construction before considering the close passage finished.

## Proof that needs replacement

- stair01/04/10-treads-day are obstructed by gate geometry and do not verify their treads.
- seg04-base-close-day is inside/under geometry. seg01-01-walk and seg04-02-walk face close gate fronts and do not cover the intended wall station.
- White water in night/day context is a known missing-global problem in the proof harness. It prevents lighting/context acceptance from those images; it is not evidence of a confirmed installed-water regression. Rerender after setting the actual game globals.

## Confirmed improvements

- All four gate field views have lost the diagonal/radial spandrel seams.
- Exact guard return has lost the narrow horizontal z-fighting stripes in day/night.
- Tread noses, string coping, newels, physical quoin blocks and roof drainage have meaningful geometry. Stair08 stands on native park ground once the missing context is included.
- Hut14 lamp now illuminates nearby brick, frame and paving while its roof remains dark. No clear guardhouse light leak was visible in the examined V4 night view.
- Broad wall station coverage did not expose another clear open wall corner or kerb passing through a wall.

## Rejected or unproven claims from the other review

- Stair11 right-side brick is the authored solid inner string wall, not a demonstrated hole.
- Stair08 rail-through-pier claim is a perspective overlap: ray at back-view pixel(970,370) hits railr808 at1.559m, then pier r804 at5.037m. They are about3.48m apart along that ray.
- The guard downpipe already has a curved shoe; an air gap above an open inlet is acceptable. Quoins have physical thickness and are not merely decals.
- Gate vault uses72 segments. Visible voussoir joints do not establish insufficient arch geometry. Vault UVs use physical1.84x1.56m scales; the alleged tiny-brick regression is not substantiated from foreshortened screenshots alone.
- Small newel/coping steps on stair00/02 are visible, but no open light gap was established. Treat them as construction-fit checks, not proven overlapping meshes.
- Two pointed shapes beside the pond remain unidentified and may belong to pond wildlife. They are excluded from defect claims; no wildlife asset inspection or modification was performed.

The parent is already repairing plinth clipping/weathering, old pond moss, roof hip detail and proof cameras/globals. Those changes require fresh inspection; this score does not pre-approve them.
