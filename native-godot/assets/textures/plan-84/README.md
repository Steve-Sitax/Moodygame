# Plan 84 picture bundle

Rows 3, 7, 8, 9, 10, 13; reusable rows 2 and 6. See each row README and manifest.json.

All maps are standalone PNGs; no runtime resources were edited. Native integration and geometric/contextual acceptance remain outstanding. Row 13 retains enumerated non-surface cells.

1024 px material photographs and 512 px props match the established native photographic texture families, rather than preserving the retired 16–128 px procedural cells. Brick aspect ratio follows its authored 224:192 bond. Maps within a set have identical resolution. Native card/atlas normalized cell locations are preserved except litter, which is supplied as separate high-resolution named marks with its original cell metadata.

Rebuild: python art-source/plan-84/build_maps.py --proof <external-folder>. Requires the installed PhotoCraft CLI and existing Python Pillow/NumPy/SciPy. No game, browser bake, editor import, scene conversion or Godot process is involved.

QA receipts: D:/Code/_tmp_verify/K-textures/validation.json and tiles/ under the same folder.
