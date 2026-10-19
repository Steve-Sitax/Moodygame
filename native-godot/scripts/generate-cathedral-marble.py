"""Regenerate the cathedral shell marble from the church model's own painters.
Run with Python + NumPy/Pillow: python native-godot/scripts/generate-cathedral-marble.py
The source painters are nested in church.cells; extract only their function ASTs so
this texture-only task does not import Blender or build geometry. Same seeds,
colours and seamless blend as the side altars, sampled at 1024 px per 1.2 metres.
"""
import ast
import hashlib
import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "art-source/tools/blender/workgoods"
OUT = ROOT / "native-godot/assets/materials/cathedral-marble-20261019"
SIZE, METRES = 1024, 1.2


def function(path, name, parent=None):
    tree = ast.parse(path.read_text(encoding="utf-8"))
    body = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == parent).body if parent else tree.body
    node = next(n for n in body if isinstance(n, ast.FunctionDef) and n.name == name)
    return node


def main():
    spec = importlib.util.spec_from_file_location("church_paint", SOURCE / "paint.py")
    paint = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(paint)
    functions = [function(SOURCE / "carving.py", "_tile")]
    functions += [function(SOURCE / "church.py", n, "cells") for n in ("marble", "marble_black")]
    namespace = {"np": np, "pt": paint}
    exec(compile(ast.Module(body=functions, type_ignores=[]), "church marble painters", "exec"), namespace)
    OUT.mkdir(parents=True, exist_ok=True)
    manifest = {"repeatMetres": METRES, "pixels": SIZE, "source": "workgoods/church.py marble and marble_black; carving.py _tile; paint.py", "textures": []}
    for name, painter in (("white", "marble"), ("black", "marble_black")):
        pixels = namespace[painter](SIZE, SIZE, SIZE / METRES)
        if pixels.shape != (SIZE, SIZE, 3) or not np.isfinite(pixels).all():
            raise ValueError("Invalid marble pixels")
        data = np.rint(np.clip(pixels, 0, 1) * 255).astype(np.uint8)
        path = OUT / (name + ".png")
        Image.fromarray(data).save(path, optimize=True)
        manifest["textures"].append({"file": path.name, "sha256": hashlib.sha256(path.read_bytes()).hexdigest(), "width": SIZE, "height": SIZE, "painter": painter})
    (OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    main()
