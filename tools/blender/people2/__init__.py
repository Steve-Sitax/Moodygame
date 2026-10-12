"""people2: the second people kit of Scheldemist (docs/people.md).

One skeleton of 62 bones (rig.py) for every person, four base bodies (man, woman, child, old) in builds
(body.py), weights by rule (weights.py), a far copy per body (lod.py), the base skin pictures (paint.py), the
36 old clips keyed onto the new rig (clips_legacy.py), the export (export.py) and the check pictures
(preview.py). The entry is tools/blender/build_people2.py.

Coordinates: everything is built in game space (x = the person's left, y up, z forward: the person faces +z),
in metres. B() turns a game point into Blender space (Z up, the person faces -Y); the glTF export turns it back
to Y up, so in the file and in both games the axes are the game's again.
"""

import os

from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "people2.glb")
RIG_JSON = os.path.join(ROOT, "shared", "peopleRig.json")
SHOTS = os.path.join(ROOT, "data", "shots", "people2")

FPS = 24
FOG = (0x3E / 255, 0x46 / 255, 0x4D / 255)  # the game's fog colour by day (rijnkaai.ts: THREE.Fog(0x3e464d, 3, 25))
FOG_NEAR, FOG_FAR = 3.0, 25.0


def B(x, y=None, z=None):
    """Game point (x left, y up, z forward) to Blender (x, -z, y)."""
    if y is None:
        x, y, z = x
    return Vector((x, -z, y))


def G(v):
    """Blender point back to game space."""
    return (v[0], v[2], -v[1])
