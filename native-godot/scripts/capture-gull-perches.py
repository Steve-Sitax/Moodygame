"""One-time geometry fixture; shipped wildlife never reads GLB or runs Python."""
import json
import struct
import sys
from pathlib import Path

import numpy as np


def glb(path):
    with open(path, "rb") as stream:
        stream.read(12)
        size, _ = struct.unpack("<II", stream.read(8))
        document = json.loads(stream.read(size))
        size, _ = struct.unpack("<II", stream.read(8))
        data = stream.read(size)

    def values(index):
        accessor = document["accessors"][index]
        view = document["bufferViews"][accessor["bufferView"]]
        dtype = np.dtype({5126: "<f4", 5125: "<u4", 5123: "<u2", 5121: "u1"}[accessor["componentType"]])
        columns = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}[accessor["type"]]
        return np.ndarray((accessor["count"], columns), dtype=dtype, buffer=data,
                          offset=view.get("byteOffset", 0) + accessor.get("byteOffset", 0),
                          strides=(view.get("byteStride", columns * dtype.itemsize), dtype.itemsize))

    def geometry(node):
        parts = []
        for primitive in document["meshes"][node["mesh"]]["primitives"]:
            points = values(primitive["attributes"]["POSITION"])
            uv = values(primitive["attributes"]["TEXCOORD_0"])
            indices = values(primitive["indices"]).reshape(-1) if "indices" in primitive else np.arange(len(points))
            parts.append({"positions": points.tolist(), "uv": uv.tolist(), "indices": indices.tolist()})
        return parts

    return document, geometry


town, town_geometry = glb(sys.argv[1])
models, model_geometry = glb(sys.argv[2])
target = [shape for node in town["nodes"] if node.get("name") == "quayfurniture_0,0,0" for shape in town_geometry(node)]
prototypes = []
for node in models["nodes"]:
    if node.get("name") not in ("bollard_cannon", "bollard_mushroom"):
        continue
    shape = max(model_geometry(node), key=lambda part: len(part["indices"]))
    points = np.array(shape["positions"])
    low, high = points.min(axis=0), points.max(axis=0)
    prototypes.append({"name": node["name"], "shape": shape,
                       "top": [(low[0] + high[0]) / 2, high[1], (low[2] + high[2]) / 2],
                       "height": high[1] - low[1]})
output = Path(sys.argv[3])
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps({"target": target, "prototypes": prototypes}, separators=(",", ":")), encoding="utf-8")
print(f"Captured {sum(len(g['positions']) for g in target)} merged vertices, {len(prototypes)} bollard prototypes")
