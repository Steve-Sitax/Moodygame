# Step and plinth tops along their stones · 27 October 2026 (#199)

The dressed stone's flat tops under 0.8 m (door steps and plinth tops, 916.7 m2, 87 983 faces) took the world's grid:
their picture's u ran along world x on 91% of them, whatever way the stone lay.
`native-godot/scripts/paving/step_tops.py` re-maps each stone's tops (a stone: its dice UV2.y and shared corners):
the same scale, the same picture at the stone's middle, u along the stone's long side, turned at most 90 degrees and
never mirrored; square blocks are left. 12 584 stones; turns cluster at 0 and 90 degrees (streets off the grid between).
Only uv changes (checked: every other attribute identical; mean scale 0.830 to 0.831; the stretched tops, some with
a degenerate map, now have none). 55 meshes, collision identical.
