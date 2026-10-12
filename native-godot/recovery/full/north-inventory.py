"""Read-only bounds/semantic inventory for the completed harbour snapshot.

This reads GLB JSON and accessor bounds, never the binary geometry or an exporter.
It is an intake check, not a runtime dependency or a replacement for rendered QA.
"""
import argparse
import itertools
import json
import math
import pathlib
import struct


IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]


def multiply(a, b):
    return [sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
            for col in range(4) for row in range(4)]


def matrix(node):
    if "matrix" in node:
        value = node["matrix"]
        if len(value) != 16 or not all(math.isfinite(v) for v in value):
            raise ValueError("Invalid source transform")
        return value
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    tx, ty, tz = node.get("translation", [0, 0, 0])
    return [(1 - 2 * (y*y + z*z))*sx, 2*(x*y + z*w)*sx, 2*(x*z - y*w)*sx, 0,
            2*(x*y - z*w)*sy, (1 - 2*(x*x + z*z))*sy, 2*(y*z + x*w)*sy, 0,
            2*(x*z + y*w)*sz, 2*(y*z - x*w)*sz, (1 - 2*(x*x + y*y))*sz, 0,
            tx, ty, tz, 1]


def transformed_bounds(bounds, pose):
    lo, hi = bounds
    points = list(itertools.product(*zip(lo, hi)))
    points = [[sum(pose[col * 4 + row] * p[col] for col in range(3)) + pose[12 + row]
               for row in range(3)] for p in points]
    return [[min(p[k] for p in points) for k in range(3)],
            [max(p[k] for p in points) for k in range(3)]]


def merge(a, b):
    if a is None:
        return b
    if b is None:
        return a
    return [[min(a[0][k], b[0][k]) for k in range(3)],
            [max(a[1][k], b[1][k]) for k in range(3)]]


def inventory(source):
    source = pathlib.Path(source)
    with source.open("rb") as stream:
        magic, version, size = struct.unpack("<III", stream.read(12))
        if magic != 0x46546C67 or version != 2 or size != source.stat().st_size:
            raise ValueError("Source is not a complete GLB 2 snapshot")
        length, tag = struct.unpack("<II", stream.read(8))
        if tag != 0x4E4F534A or not 0 < length <= 64 * 1024 * 1024:
            raise ValueError("Invalid GLB JSON chunk")
        data = json.loads(stream.read(length))
    facts = json.loads(source.with_suffix(".json").read_text(encoding="utf-8"))
    nodes = data["nodes"]
    roots = data["scenes"][data.get("scene", 0)]["nodes"]
    worlds, parents = {}, {}

    def visit(index, parent_pose, parent=None):
        if index in worlds:
            raise ValueError(f"Repeated node {index}; root ownership would be ambiguous")
        worlds[index] = multiply(parent_pose, matrix(nodes[index]))
        parents[index] = parent
        for child in nodes[index].get("children", []):
            visit(child, worlds[index], index)

    for root in roots:
        visit(root, IDENTITY)

    def descendants(index):
        yield index
        for child in nodes[index].get("children", []):
            yield from descendants(child)

    def bounds(index):
        result = None
        for child in descendants(index):
            node = nodes[child]
            if "mesh" not in node:
                continue
            for primitive in data["meshes"][node["mesh"]]["primitives"]:
                accessor = data["accessors"][primitive["attributes"]["POSITION"]]
                local = [accessor["min"], accessor["max"]]
                instances = facts.get("instances", {}).get(node.get("name", ""))
                if instances:
                    matrices = instances["m"]
                    if len(matrices) != instances["count"] * 16:
                        raise ValueError(f"Instance matrix count mismatch: {child}")
                    for start in range(0, len(matrices), 16):
                        pose = multiply(worlds[child], matrices[start:start+16])
                        result = merge(result, transformed_bounds(local, pose))
                else:
                    result = merge(result, transformed_bounds(local, worlds[child]))
        return result

    records = []
    for index in roots:
        node = nodes[index]
        family = list(descendants(index))
        record = {"index": index, "name": node.get("name", ""), "bounds": bounds(index),
                  "origin": worlds[index][12:15], "nodes": len(family),
                  "meshNodes": sum("mesh" in nodes[i] for i in family),
                  "skinNodes": sum("skin" in nodes[i] for i in family),
                  "hiddenNodes": sum(nodes[i].get("extras", {}).get("hidden", False) for i in family),
                  "extras": node.get("extras", {})}
        records.append(record)
    return {"source": {"bytes": source.stat().st_size, "factsMade": facts["made"]},
            "nodeCount": len(nodes), "rootCount": len(roots), "roots": records}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", help="Read-only completed town.glb")
    parser.add_argument("--output", required=True, help="Ignored proof JSON destination")
    args = parser.parse_args()
    result = inventory(args.source)
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, indent=2), encoding="utf-8")
    print(f"Inventoried {result['rootCount']} roots / {result['nodeCount']} nodes into {output}")


if __name__ == "__main__":
    main()
