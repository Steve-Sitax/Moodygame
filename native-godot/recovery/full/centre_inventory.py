"""Read-only landmark/door inventory for the native whole-town intake.

No GLB buffers are imported or modified. Bounds are calculated from glTF accessor
limits and accumulated transforms, rather than assuming nodes use world positions.
"""
from __future__ import annotations

import argparse
import itertools
import json
import math
from pathlib import Path
import struct


IDENTITY = (1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1)


def multiply(a, b):
    return tuple(sum(a[k * 4 + row] * b[col * 4 + k] for k in range(4))
                 for col in range(4) for row in range(4))


def local_matrix(node):
    if "matrix" in node:
        return tuple(node["matrix"])
    x, y, z, w = node.get("rotation", [0, 0, 0, 1])
    sx, sy, sz = node.get("scale", [1, 1, 1])
    tx, ty, tz = node.get("translation", [0, 0, 0])
    return ((1 - 2 * (y*y + z*z)) * sx, 2 * (x*y + z*w) * sx, 2 * (x*z - y*w) * sx, 0,
            2 * (x*y - z*w) * sy, (1 - 2 * (x*x + z*z)) * sy, 2 * (y*z + x*w) * sy, 0,
            2 * (x*z + y*w) * sz, 2 * (y*z - x*w) * sz, (1 - 2 * (x*x + y*y)) * sz, 0,
            tx, ty, tz, 1)


def point(m, p):
    return tuple(sum(m[k * 4 + row] * p[k] for k in range(3)) + m[12 + row]
                 for row in range(3))


def union(boxes):
    boxes = [b for b in boxes if b]
    if not boxes:
        return None
    return tuple(min(b[i] for b in boxes) for i in range(3)) + tuple(max(b[i] for b in boxes) for i in range(3, 6))


class Inventory:
    def __init__(self, source: Path):
        with source.open("rb") as stream:
            magic, version, length = struct.unpack("<III", stream.read(12))
            if magic != 0x46546C67 or version != 2 or length != source.stat().st_size:
                raise ValueError("Not a complete glTF 2 binary")
            size, kind = struct.unpack("<II", stream.read(8))
            if kind != 0x4E4F534A:
                raise ValueError("First GLB chunk is not JSON")
            self.data = json.loads(stream.read(size))
        self.nodes = self.data["nodes"]
        self.parent = {}
        self.world = {}
        self.boxes = {}
        self.by_name = {}
        for index, node in enumerate(self.nodes):
            self.by_name.setdefault(node.get("name", ""), []).append(index)
            for child in node.get("children", []):
                if child in self.parent:
                    raise ValueError(f"Node {child} has two parents")
                self.parent[child] = index

    def transform(self, index):
        if index not in self.world:
            self.world[index] = multiply(self.transform(self.parent[index]) if index in self.parent else IDENTITY,
                                         local_matrix(self.nodes[index]))
        return self.world[index]

    def descendants(self, index):
        yield index
        for child in self.nodes[index].get("children", []):
            yield from self.descendants(child)

    def bounds(self, index):
        if index not in self.boxes:
            node = self.nodes[index]
            boxes = [self.bounds(c) for c in node.get("children", [])]
            if "mesh" in node:
                for primitive in self.data["meshes"][node["mesh"]]["primitives"]:
                    accessor = self.data["accessors"][primitive["attributes"]["POSITION"]]
                    if "min" not in accessor or "max" not in accessor:
                        raise ValueError(f"Missing position bounds on node {index}")
                    corners = [point(self.transform(index), p)
                               for p in itertools.product(*zip(accessor["min"], accessor["max"]))]
                    boxes.append(tuple(min(p[k] for p in corners) for k in range(3)) +
                                 tuple(max(p[k] for p in corners) for k in range(3)))
            self.boxes[index] = union(boxes)
        return self.boxes[index]

    def named(self, name, top_only=False):
        matches = self.by_name.get(name, [])
        if top_only:
            matches = [i for i in matches if i not in self.parent]
        if len(matches) != 1:
            raise ValueError(f"Expected exactly one {name}, got {matches}")
        return matches[0]

    def describe(self, index):
        nodes = list(self.descendants(index))
        box = self.bounds(index)
        return {"sourceNode": index, "name": self.nodes[index].get("name", ""),
                "parent": self.parent.get(index), "worldBounds": [round(v, 6) for v in box] if box else None,
                "worldOrigin": [round(v, 6) for v in point(self.transform(index), (0, 0, 0))],
                "nodeCount": len(nodes), "meshNodes": sum("mesh" in self.nodes[n] for n in nodes),
                "roomId": self.nodes[index].get("extras", {}).get("room", {}).get("id")}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--check", type=Path)
    args = parser.parse_args()
    inventory = Inventory(args.source)
    if args.manifest:
        manifest = centre_manifest(inventory, args.source)
        args.manifest.parent.mkdir(parents=True, exist_ok=True)
        args.manifest.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"manifest": str(args.manifest), "roots": len(manifest["roots"]),
                          "rooms": len(manifest["rooms"]), "entrances": len(manifest["entrances"]),
                          "sharedChildren": len(manifest["sharedChildren"])}, indent=2))
        return
    if args.check:
        report = check_manifest(inventory, args.source, json.loads(args.check.read_text(encoding="utf-8")))
        print(json.dumps(report, indent=2))
        if not report["passed"]:
            raise SystemExit(1)
        return
    names = ["cathedral_outside", "stadhuis", "vleeshuis", "market_grote_markt"]
    names += [name for name in inventory.by_name if name.startswith("ROOM_")]
    result = {"source": args.source.name, "nodes": len(inventory.nodes),
              "landmarksAndRooms": [inventory.describe(inventory.named(name)) for name in names]}
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2))


CENTRE_HOUSES = ["shop:tobacco_markt", "shop:cobbler_lane", "shop:draper_markt",
                "shop:butcher_vlees", "shop:apothecary_markt", "shop:barber_lane",
                "shop:hatter_markt", "shop:printer_jezuiet", "shop:books_kathedraal",
                "shop:clock_markt", "home:cellar", "home:garret", "home:widow", "tavern:engel"]
CENTRE_HALLS = {"cathedral": "cathedral_outside", "townhall": "stadhuis", "vleeshuis": "vleeshuis"}
CENTRE_CHURCHES = ["carolus", "stpaul", "stjacob"]
SOURCE_SHA256 = "ac8534149415142120f325986c7abd3818c38005206d45354f1ebb2619f3a7d9"


def leaf_hinges(inventory, hall_id):
    matches = []
    for index, node in enumerate(inventory.nodes):
        children = node.get("children", [])
        if "mesh" in node or not children or any("mesh" not in inventory.nodes[c] for c in children):
            continue
        materials = {inventory.data["materials"][p["material"]].get("name", "")
                     for c in children for p in inventory.data["meshes"][inventory.nodes[c]["mesh"]]["primitives"] if "material" in p}
        wanted = "cath_door_oak" if hall_id == "cathedral" else hall_id + "_leaf"
        if wanted in materials:
            matches.append(index)
    return matches


def centre_manifest(inventory, source):
    roots = []
    rooms = []
    entrances = []
    checks = []

    def add_root(name, role):
        index = inventory.named(name, top_only=True)
        roots.append({"sourceIndex": index, "sourceName": name, "role": role,
                      "bounds": inventory.describe(index)["worldBounds"]})
        return index

    for hall, name in CENTRE_HALLS.items():
        add_root(name, "landmark exterior")
    add_root("market_grote_markt", "market scenery")
    room_ids = list(CENTRE_HALLS) + ["cathedral_upper"] + CENTRE_CHURCHES + CENTRE_HOUSES
    for place in CENTRE_HOUSES:
        add_root("house_" + place, "house exterior and door hinge")
        add_root("house_" + place + "_openings", "opening anchors")
        if "shutters_" + place in inventory.by_name:
            add_root("shutters_" + place, "street shutters")
    for room_id in room_ids:
        root = add_root("ROOM_" + room_id, "room")
        room = inventory.nodes[root]["extras"]["room"]
        exterior = (inventory.named("house_" + room_id) if room_id in CENTRE_HOUSES else
                    inventory.named(CENTRE_HALLS[room_id]) if room_id in CENTRE_HALLS else
                    inventory.named("cathedral_outside") if room_id == "cathedral_upper" else 798)
        room_record = {"id": room_id, "sourceIndices": [root], "exteriorSourceIndex": exterior,
                       "sourceName": inventory.nodes[root]["name"],
                       "bounds": inventory.describe(root)["worldBounds"],
                       "reach": room["reach"], "budgeted": room["budgeted"],
                       "openingCount": len(room["openings"]),
                       "doorCount": sum(o["kind"] == "door" for o in room["openings"]),
                       "lightMetadata": "extras.room.lights", "openingMetadata": "extras.room.openings"}
        if room_id in CENTRE_HOUSES:
            room_record["liningSourceIndex"] = inventory.named("house_lining_" + room_id)
        rooms.append(room_record)
        candidates = (list(inventory.descendants(inventory.named("house_" + room_id + "_openings")))
                      if room_id in CENTRE_HOUSES else list(inventory.descendants(exterior)))
        all_hinges = ([inventory.nodes[exterior]["children"][0]] if room_id in CENTRE_HOUSES else
                      leaf_hinges(inventory, room_id))
        for number, opening in enumerate(o for o in room["openings"] if o["kind"] == "door"):
            box = opening["box"]
            markers = [i for i in candidates if inventory.nodes[i].get("name", "").startswith("opening_")
                       and inventory.nodes[i].get("extras", {}).get("kind") == "door"
                       and all(box[k] - .15 <= point(inventory.transform(i), (0, 0, 0))[k] <= box[k + 3] + .15 for k in range(3))]
            centre = opening["centre"]
            hinges = [i for i in all_hinges if math.dist(point(inventory.transform(i), (0, 0, 0)), centre) < 9]
            semantic_id = (room_id if room_id in CENTRE_HOUSES else
                           "cathedral_west" if room_id == "cathedral" else opening["label"])
            entrances.append({"id": semantic_id, "roomId": room_id,
                              "sourceIndices": markers + hinges, "markerSourceIndices": markers,
                              "hingeSourceIndices": hinges, "exteriorSourceIndex": exterior,
                              "centre": centre, "out": opening["out"], "bounds": box,
                              "sourceOpen": opening["open"], "label": opening["label"],
                              "doorMetadataIndex": next(i for i, o in enumerate(room["openings"]) if o is opening)})
    church_children = [i for i in inventory.nodes[798]["children"]
                       if inventory.nodes[i].get("name", "").startswith(tuple("church_" + c for c in CENTRE_CHURCHES))
                       or inventory.nodes[i].get("extras", {}).get("church") in CENTRE_CHURCHES]
    checks = ["Every referenced source index retains its exact snapshot name.",
              "Every room retains fog, lights, reach, budgeted and opening metadata.",
              "Every entrance has exterior opening markers and articulated door hinges.",
              "House rooms retain their matching dark lining and independent shutter roots.",
              "Door collision is owned by Doors, not permanent shell collision.",
              "Night room lights resolve from the native light configuration.",
              "Townhall, Vleeshuis and church parent relationships remain unchanged.",
              "Editor subsets reference shared roots; runtime loads each root once.",
              "Close views check material-appropriate geometry bevels on exposed edges."]
    return {"version": 1, "id": "centre-landmarks", "title": "City centre and churches",
            "sourceSha256": SOURCE_SHA256, "bounds": [-325, 25, 490, 325],
            "walkSpawn": [-254, .02, 96], "flySpawn": [-254, 8, 118],
            "flyYaw": math.pi, "flyPitch": -.3, "roots": roots,
            "sharedRoots": [{"sourceIndex": 4, "sourceName": "city", "notes": "Shared terrain and city building tiles; load once in the whole town."},
                            {"sourceIndex": 798, "sourceName": "churches", "notes": "Mixed parent containing three church exteriors, opening anchors, park meshes and pumps. Keep direct hierarchy at runtime; centre owns only the listed sharedChildren."}],
            "sharedChildren": [{"sourceIndex": i, "sourceName": inventory.nodes[i].get("name", ""),
                                "sourceParentIndex": 798, "role": "church exterior or opening anchor"} for i in church_children],
            "rooms": rooms, "entrances": entrances, "checks": checks,
            "exceptions": [{"rule": "Model edges and materials", "scope": "Hidden/mating shell seams, glazing and thin sheet lips", "reason": "Keep construction seams fitted and glass/sheet thickness physically plausible. Exposed stone, wood and iron arrises still require inspection and geometric bevels."}],
            "delegatedPlaces": {"harbour": ["shop:bakery_rijn", "shop:bakery_steen", "shop:grocer_canal", "shop:chandler_werf", "shop:pawn_vis", "shop:colonial_steen", "shop:roaster_canal", "home:merchant", "tavern:ankere", "tavern:schipke", "tavern:vliet", "tavern:bassin", "poesje"],
                                "outer": ["shop:bakery_south", "shop:grocer_south", "shop:cobbler_east", "home:alley", "tavern:linde", "tavern:zwarte_kat"]}}


def check_manifest(inventory, source, manifest):
    checks = []

    def check(name, condition):
        checks.append({"name": name, "pass": bool(condition)})

    roots = manifest["roots"]
    check("Unique centre root indices", len({r["sourceIndex"] for r in roots}) == len(roots))
    check("Unique semantic room identities", len({r["id"] for r in manifest["rooms"]}) == len(manifest["rooms"]))
    check("Unique semantic entrance identities", len({r["id"] for r in manifest["entrances"]}) == len(manifest["entrances"]))
    check("Manifest contains all assigned centre rooms", {r["id"] for r in manifest["rooms"]} == set(CENTRE_HALLS) | {"cathedral_upper"} | set(CENTRE_CHURCHES) | set(CENTRE_HOUSES))
    for root in roots + manifest["sharedRoots"] + manifest["sharedChildren"]:
        check(f"Source name {root['sourceIndex']}: {root['sourceName']}", inventory.nodes[root["sourceIndex"]].get("name", "") == root["sourceName"])
    check("Church child set excludes park and pump roots", all(not c["sourceName"].startswith("park_") and c["sourceName"] != "pump" for c in manifest["sharedChildren"]))
    check("Shared church children retain original parent", all(inventory.parent[c["sourceIndex"]] == 798 for c in manifest["sharedChildren"]))
    light_data = json.loads(source.with_name(source.stem + "_lights.json").read_text(encoding="utf-8"))
    light_ids = {r["id"] for r in light_data["rooms"]}
    for room in manifest["rooms"]:
        info = inventory.nodes[room["sourceIndices"][0]].get("extras", {}).get("room", {})
        check(f"Room identity {room['id']}", info.get("id") == room["id"])
        check(f"Room metadata {room['id']}", {"fog", "lights", "reach", "budgeted", "openings"}.issubset(info))
        check(f"Room opening counts {room['id']}", len(info["openings"]) == room["openingCount"] and sum(o["kind"] == "door" for o in info["openings"]) == room["doorCount"])
        check(f"Room night lights {room['id']}", room["id"] in light_ids)
        if "liningSourceIndex" in room:
            check(f"Room lining {room['id']}", inventory.nodes[room["liningSourceIndex"]]["name"] == "house_lining_" + room["id"])
    for entrance in manifest["entrances"]:
        check(f"Opening markers {entrance['id']}", len(entrance["markerSourceIndices"]) > 0)
        check(f"Door hinges {entrance['id']}", len(entrance["hingeSourceIndices"]) > 0)
        check(f"Door outward normal {entrance['id']}", abs(sum(v * v for v in entrance["out"]) - 1) < 1e-5)
    return {"district": manifest["id"], "passed": all(c["pass"] for c in checks),
            "assertions": len(checks), "failures": [c["name"] for c in checks if not c["pass"]],
            "rootCount": len(roots), "roomCount": len(manifest["rooms"]), "entranceCount": len(manifest["entrances"]),
            "sharedChildren": len(manifest["sharedChildren"])}


if __name__ == "__main__":
    main()
