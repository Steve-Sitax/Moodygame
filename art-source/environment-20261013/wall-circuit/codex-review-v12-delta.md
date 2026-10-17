# Codex V12 targeted delta review

**PASS, 8.1/10.** Read after `v12-targeted.log` reported completion with 199 resources. Reviewed fresh full-resolution guard-drain-return and segment 06 pond base in day/rain/night, plus segment 09-04 town daylight. Whole-circuit coverage remains documented separately in `codex-review-v11.md`; this is a targeted material delta review, not a claim that all contacts were regenerated for V12.

The stronger guard contact dirt remains attached to the lowest courses and adjacent paving without obscuring mortar. Rain visibly darkens both paving and masonry. The pond now has an olive-green algae band at the waterline with irregular fading into the stone above; no old angular noise patches or new relief misalignment appear. Its color remains credible under the labelled warm inspection lamp.

Correction after `v12-house-check.log` completed: the initial r221 grime-decal attribution was wrong. The implementer's pixel comparison showed that changing r221 had no effect, and the triangle ray instead hit house mesh r195 (`city_-4_0_1`) at approximately [-345.8978, 0.9607, 13.9997]. Stacked house `g_damp` and generic `psx_foot_dirt` caused the excessive darkening. The r221 change was reverted; r195 now limits the combined darkening while retaining the existing brick texture.

I reopened the resulting segment 09-04 town daylight image. Brick is now clearly readable down to ground level and the former nearly solid black band is gone, while the separate diagonal cast shadow remains. This is a real improvement over the initial V12 capture, for which my claimed improvement was unsupported. After the full V12 render completed, I also inspected the new rain and night images: brick stays readable through the base in both, with no return of a flat black rectangle. Night is explicitly labelled inspection lamp. The new neighbor delta passes. The guard and pond day/rain/night checks above remain valid.

No new concrete blocker in these deltas. Further darkening or greening is not necessary to establish causal wear. No implementation or asset files were edited by this reviewer.
