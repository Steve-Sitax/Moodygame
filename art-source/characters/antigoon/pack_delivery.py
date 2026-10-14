"""Lossless repository bundles (24 MiB parts); no extra Python packages required.

python art-source/characters/antigoon/pack_delivery.py pack
python art-source/characters/antigoon/pack_delivery.py unpack
Unpack restores the editable, texture-packed Blender source and standalone GLB.
The game reads its runtime bundle directly, including inside exported packages.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent
RUNTIME = ROOT.parents[2] / "native-godot/assets/characters/antigoon"
DELIVERIES = [
    (RUNTIME / "antigoon-playable.glb", RUNTIME / "packed"),
    (ROOT / "source/antigoon-playable.blend", ROOT / "source/packed"),
]


def pack(source, directory):
    data = source.read_bytes()
    directory.mkdir(parents=True, exist_ok=True)
    parts = []
    for i, offset in enumerate(range(0, len(data), 24 * 1024 * 1024)):
        chunk = data[offset:offset + 24 * 1024 * 1024]
        name = f"part-{i:02d}.bin"
        (directory / name).write_bytes(chunk)
        parts.append({"file": name, "bytes": len(chunk), "sha256": hashlib.sha256(chunk).hexdigest()})
    manifest = {"file": source.name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest(), "parts": parts}
    (directory / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Packed {source.name}: {len(parts)} parts, {len(data)} bytes")


def unpack(destination, directory):
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    chunks = []
    for part in manifest["parts"]:
        data = (directory / part["file"]).read_bytes()
        assert len(data) == part["bytes"] and hashlib.sha256(data).hexdigest() == part["sha256"], part["file"]
        chunks.append(data)
    data = b"".join(chunks)
    assert len(data) == manifest["bytes"] and hashlib.sha256(data).hexdigest() == manifest["sha256"]
    if destination.exists() and destination.read_bytes() != data:
        raise RuntimeError(f"Preserving modified file: {destination}")
    destination.write_bytes(data)
    print(f"Verified and restored {destination.name}")


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) == 2 else ""
    if command not in ("pack", "unpack"):
        raise SystemExit("Usage: pack_delivery.py pack|unpack")
    for source, directory in DELIVERIES:
        (pack if command == "pack" else unpack)(source, directory)
