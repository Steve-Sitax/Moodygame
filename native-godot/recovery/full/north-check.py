"""Check harbour manifests against the exact completed source without loading Godot or modifying the source."""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import struct


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source")
    parser.add_argument("--project", default="native-godot")
    parser.add_argument("--output", default="native-godot/proof/full/north-manifest-check.json")
    args = parser.parse_args()
    source = pathlib.Path(args.source)
    with source.open("rb") as stream:
        stream.read(12)
        length, _ = struct.unpack("<II", stream.read(8))
        glb = json.loads(stream.read(length))
    nodes = glb["nodes"]
    root_indices = set(glb["scenes"][glb.get("scene", 0)]["nodes"])
    spec = importlib.util.spec_from_file_location("north_inventory", pathlib.Path(__file__).with_name("north-inventory.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    inventory = module.inventory(source)
    roots = {r["index"]: r for r in inventory["roots"]}
    with source.open("rb") as stream:
        source_hash = hashlib.file_digest(stream, "sha256").hexdigest()
    checks = []
    owners = {}

    def check(condition, description):
        checks.append({"check": description, "pass": bool(condition)})
        if not condition:
            raise ValueError(description)

    plans = sorted((pathlib.Path(args.project) / "world/districts").glob("north-*.json"))
    check(len(plans) == 5, "Five distinct harbour district manifests are present")
    for file in plans:
        plan = json.loads(file.read_text(encoding="utf-8"))
        check(plan["sourceSha256"] == source_hash and plan["sourceBytes"] == source.stat().st_size,
              plan["id"] + ": matches the complete immutable source snapshot")
        x, z, w, d = plan["bounds"]
        px, _, pz = plan["walkSpawn"]
        check(w > 0 and d > 0 and x <= px <= x+w and z <= pz <= z+d,
              plan["id"] + ": review spawn belongs to its placement boundary")
        for entry in plan["roots"]:
            index = entry["sourceIndex"]
            check(index in root_indices and roots[index]["name"] == entry["sourceName"],
                  f"{plan['id']}: root {index} preserves its exact index/name contract")
            check(index not in owners, f"{plan['id']}: root {index} has one harbour owner")
            owners[index] = plan["id"]
        check(len(set(plan["sharedRoots"])) == len(plan["sharedRoots"]) and all(i in root_indices for i in plan["sharedRoots"]),
              plan["id"] + ": shared references are unique direct roots")
        for room in plan["rooms"]:
            index = room["sourceIndices"][0]
            record = roots[index]
            check(record["extras"].get("room", {}).get("id") == room["id"] and index in owners,
                  plan["id"] + ": room semantic id " + room["id"])
            check(all(record[key] == room["expected" + key[0].upper() + key[1:]] for key in ["nodes", "hiddenNodes", "skinNodes"]),
                  plan["id"] + ": complete nested/hidden/skinned room " + room["id"])
        for entrance in plan["entrances"]:
            markers = [nodes[i] for i in entrance["sourceIndices"]]
            check(any(marker.get("extras", {}).get("kind") == "door" for marker in markers),
                  plan["id"] + ": genuine door marker for " + entrance["id"])
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps({"sourceSha256": source_hash, "ownedRoots": len(owners), "checks": checks}, indent=2) + "\n", encoding="utf-8")
    print(f"Passed {len(checks)} source/ownership/room/entrance checks; {len(owners)} unique harbour roots")


if __name__ == "__main__":
    main()
