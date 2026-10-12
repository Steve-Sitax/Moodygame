"""Compare literal legacy routes with registered native route patterns.

Registration is reported separately from behavior parity. A native route that
throws for an unsupported operation is still partial and must be reviewed by its
module's parity proof before the legacy dependency can be retired.
"""
import argparse
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser()
parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
parser.add_argument("--registry", type=Path)
parser.add_argument("--output", type=Path)
args = parser.parse_args()
legacy_root = args.root / "server/src"
legacy = []
if legacy_root.exists():
    for path in sorted(legacy_root.rglob("*.ts")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r'''\bapp\.(get|post|put|delete)\(\s*["']([^"']+)''', text):
            legacy.append({"method": match[1].upper(), "path": match[2], "source": path.relative_to(args.root).as_posix()})
else:
    legacy = json.loads((args.root / "native-godot/services/legacy-routes.json").read_text(encoding="utf-8"))
if not legacy:
    raise SystemExit("No original route inventory; refusing an empty coverage report.")
if args.registry:
    registry = json.loads(args.registry.read_text(encoding="utf-8"))["routes"]
else:
    registry = []
    for path in sorted((args.root / "native-godot/src/Services").rglob("*.cs")):
        text = path.read_text(encoding="utf-8")
        for match in re.finditer(r'''\.Register(?:Async)?\(\s*"(GET|POST|PUT|DELETE)"\s*,\s*"([^"]+)"''', text):
            registry.append(match[1] + " " + match[2])
native = set(registry)
for route in legacy:
    route["status"] = "registered; behavior parity required" if route["method"] + " " + route["path"] in native else "missing"
groups = {}
for route in legacy:
    group = groups.setdefault(route["source"], {"total": 0, "registered": 0, "missing": 0})
    group["total"] += 1
    group["registered" if route["status"] != "missing" else "missing"] += 1
report = {"version": 1, "complete": False,
          "meaning": "Route registration is not proof of behavior, provider, LAN, saving or migration parity.",
          "legacyRouteCount": len(legacy), "nativeRouteCount": len(native),
          "registeredLegacyCount": sum(r["status"] != "missing" for r in legacy),
          "missingLegacyCount": sum(r["status"] == "missing" for r in legacy),
          "groups": groups, "routes": legacy,
          "extraNativeRoutes": sorted(native - {r["method"] + " " + r["path"] for r in legacy})}
output = args.output or args.root / "native-godot/services/coverage.json"
output.parent.mkdir(parents=True, exist_ok=True)
output.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
print(json.dumps({k: report[k] for k in ["legacyRouteCount", "nativeRouteCount", "registeredLegacyCount", "missingLegacyCount", "complete"]}))
