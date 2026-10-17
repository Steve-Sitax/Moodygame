# Codex V15 targeted review

2026-10-13. Targeted repair verdict: PASS, 8.5/10. Whole-circuit V15 acceptance awaits the fresh full regression.

Opened actual candidate/river-return-small-face day/rain/night and seg-06-04-field-day at full resolution. After clay-v15.log reported completion, also opened both corresponding daylight clay images. No implementation or character assets edited.

- The seg-06-04-field lower-right plinth diagonal edges reported in V14 are absent in both normal materials and fresh clay. The visible stones now have continuous faces and normal masonry joints.
- The river-return stacked narrow strips around x1105–1150, y625–885 are absent in daylight, rain and clay. Full-width stones and staggered courses replace them. Neighboring stones show no visible bowing, gaps or texture distortion.
- The previously fixed vertical black stripe remains absent. Rain retains material variation and darkening. The unlit night image is naturally too dark for fine joint certification; daylight, rain and clay provide that evidence.

Claude's new possible brick tone rectangle at seg-06-04-field x405–415/y150–620 with a horizontal edge near y205 is not independently established by the full-resolution image. I see brick color variation and mortar courses, not a clear pasted rectangle. The fresh clay field also does not show a definite sharp diagonal shading boundary to my eye. Enlarged crops are pending to check that subtler claim; no new blocker is asserted from it yet.

This targeted pass closes the two demonstrated V14 geometry findings. It does not substitute for the forthcoming 25-contact-sheet whole-circuit regression after the plinth rebuild.

Crop verification: opened brick-v15-crop.png and clay-v15-crop.png. No rectangular wear patch or hard diagonal clay shading boundary is established. However, the brick enlargement reveals smaller color cuts inside individual bricks, notably near crop x225/y200–245 and x165/y470. The inspected shader varies horizontal texture offset across floor(uv.x*2) boundaries, which need not coincide with staggered mortar joints. This is a separate genuine material-alignment blocker. Overall V15 remains HOLD until variation is selected per actual brick cell, using the same coordinates for color and relief, and the corrected render is reviewed. The stone geometry pass above remains valid.
