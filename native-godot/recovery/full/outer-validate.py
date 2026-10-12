"""Read-only snapshot checks for the outer district partition manifests.

This is one-time recovery evidence, not a runtime world loader. It reads only the
GLB JSON chunk and streams its fingerprint; no source model or player save changes.
"""

import argparse
import hashlib
import json
import struct
from pathlib import Path


def read_graph(source):
    with source.open("rb") as handle:
        magic, version, length = struct.unpack("<III", handle.read(12))
        size, kind = struct.unpack("<II", handle.read(8))
        if magic != 0x46546C67 or version != 2 or kind != 0x4E4F534A:
            raise ValueError("Source is not a glTF 2 binary with a JSON first chunk")
        graph = json.loads(handle.read(size))
    if length != source.stat().st_size:
        raise ValueError("GLB header length differs from its actual length")
    return graph


def descendants(nodes, index):
    yield index
    for child in nodes[index].get("children", []):
        yield from descendants(nodes, child)


def validate(source, output):
    graph = read_graph(source)
    nodes = graph["nodes"]
    parents = {child: index for index, node in enumerate(nodes)
               for child in node.get("children", [])}
    plans = [json.loads(path.read_text(encoding="utf-8"))
             for path in sorted(Path(__file__).parent.glob("outer-*.json"))]
    plans = [plan for plan in plans if "roots" in plan]
    with source.open("rb") as handle:
        fingerprint = hashlib.file_digest(handle, "sha256").hexdigest()
    checks = []

    def check(name, passed, evidence):
        checks.append({"name": name, "passed": bool(passed), "evidence": evidence})

    selected = set()
    for plan in plans:
        prefix = plan["id"]
        check(prefix + ": source fingerprint", fingerprint == plan["source"]["sourceSha256"]
              and source.stat().st_size == plan["source"]["sourceBytes"], fingerprint)
        check(prefix + ": bounds and spawns", len(plan["bounds"]) == 4
              and all(value > 0 for value in plan["bounds"][2:])
              and all(len(plan[key]) == 3 for key in ("walkSpawn", "flySpawn")), plan["bounds"])
        for root in plan["roots"]:
            index = root["sourceIndex"]
            check(prefix + ": source " + str(index),
                  nodes[index].get("name", "") == root["sourceName"]
                  and parents.get(index) == root.get("sourceParentIndex"),
                  {"name": nodes[index].get("name", ""), "parent": parents.get(index)})
            check(prefix + ": unique ownership " + str(index), index not in selected, index)
            selected.add(index)
        for room in plan["rooms"]:
            index = room["sourceIndex"]
            metadata = nodes[index].get("extras", {}).get("room", {})
            check(prefix + ": room " + room["id"], metadata.get("id") == room["id"]
                  and bool(metadata.get("lights")),
                  {"id": metadata.get("id"), "lightRecords": len(metadata.get("lights", []))})
        for entrance in plan["entrances"]:
            indices = entrance["sourceIndices"]
            check(prefix + ": entrance " + entrance["id"],
                  bool(indices) and all(0 <= index < len(nodes) for index in indices), indices)

    prison = list(descendants(nodes, 1235))
    markers = [index for index in prison if nodes[index].get("name", "").startswith("opening_pr_")]
    doors = [index for index in markers if nodes[index].get("extras", {}).get("kind") == "door"]
    check("prison opening metadata", len(markers) == 198 and len(doors) == 7,
          {"markers": len(markers), "doors": doors})
    check("prison clock metadata", nodes[1246].get("extras", {}).get("liveClock") is True, 1246)
    check("hidden park keeper template", nodes[3683].get("extras", {}).get("hidden") is True, 3683)
    check("mill pivots retain hierarchy", parents.get(384) == 383 and parents.get(389) == 383,
          {"mill1": parents.get(384), "mill2": parents.get(389)})
    instance_templates = [index for index in descendants(nodes, 1225)
                          if nodes[index].get("name", "").startswith("INST")]
    check("park has instance templates", instance_templates == [1233, 1234], instance_templates)
    check("cross-district tree batches preserved", all(nodes[index].get("name", "").startswith("INST")
          for index in range(7673, 7692)), list(range(7673, 7692)))
    report = {"sourceSha256": fingerprint, "districts": [plan["id"] for plan in plans],
              "checks": checks, "passed": all(row["passed"] for row in checks),
              "remaining": "Rendered native edge, collision, room and gameplay checks follow shared intake."}
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"Outer source partition: {sum(row['passed'] for row in checks)}/{len(checks)} checks; {output}")
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path, default=Path("native-godot/proof/outer-inventory/validation.json"))
    args = parser.parse_args()
    validate(args.source, args.output)
