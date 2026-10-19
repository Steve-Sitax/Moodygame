# Cathedral marble

Original project artwork, generated from `art-source/tools/blender/workgoods/church.py`'s white and black marble painters, the same painters used by the carved side altars. No downloaded material.

The shell uses a 1.2 m repeat: both textures are sampled at 1024 pixels (853 pixels per metre). The painters keep their original seeds, colours and vein dimensions. Marble is polished; the colour veins do not add raised grain or change the shader.

Regenerate with `python native-godot/scripts/generate-cathedral-marble.py` (NumPy and Pillow). Then run `promote-cathedral-marble.gd` with a fresh external `--record` folder. It creates mipmapped texture resources, backs up the two materials and checks that shader code, other uniforms, material name and resource UID survive reload.

These textures change no geometry. The matching shell repair rounds exposed marble arrises and keeps the original collision/support faces. Inspect close views in daylight, rain and night before acceptance.
