"""The MakeHuman people's check pictures (people2/preview_mh.py) from a saved build scene:

    blender -b <scene saved with PEOPLE2_SAVE_BLEND>.blend --python-exit-code 1 -P art-source/tools/blender/people2_sheets.py
        -- [types] [crowd] [lineup] [poses] [hands] [kinds]

The pictures read the built layers in native-godot/assets/people2-pictures and art-source/shared's rig and face json.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from people2 import preview_mh  # noqa: E402

ARGS = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
preview_mh.run(set(ARGS or ["types", "crowd", "lineup", "poses", "hands", "kinds"]))
