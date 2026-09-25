"""Only the walk map again (client/public/city/walk.png), on the planned city.json and city_build.json.

A whole plan.py run does not give back the committed city (design.py first, and the trees come out a
little different), so a change to the walk map's rules touches only walk.png (2026-09-25: the lanes
opened cell by cell). city.json is written only if the map's size or frame changed.

    python tools/city/walk_only.py
"""
import json

import plan


def main():
    city = json.load(open(plan.CITY))
    build = json.load(open(plan.BUILD))
    # (as plan.main does for the designed map: the bridges are open ground over the water)
    plan.BRIDGES = {k: v["rect"] for k, v in city["designedBridges"].items()}
    walk = plan.walk_map(city, build["houses"], build["backs"], city["landmarks"])
    if walk != city.get("walk"):
        city["walk"] = walk
        json.dump(city, open(plan.CITY, "w"), separators=(",", ":"))
        print("city.json: walk frame changed", walk)


if __name__ == "__main__":
    main()
