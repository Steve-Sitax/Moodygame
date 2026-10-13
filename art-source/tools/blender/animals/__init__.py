"""animals: the second animal kit of Scheldemist (docs/plans/people.md, package H).

Dogs of 1873 Antwerp (a Belgian draught dog for the carts, a Schipperke of the barges, the street mongrel, a ratting
terrier), the alley cat and a Kempen pig, each at true size: a skeleton of real joints (anatomy.py), a body made as a
signed distance field and meshed once (body.py, mesh.py), skin weights by the part each point belongs to, a near copy
of about 4,500 triangles and a far copy of about 1,200, fur or skin pictures painted in 3D at 512 px with a normal
map (paint.py), and clips posed by inverse kinematics with the paws held still on the ground (pose.py, clips.py).
The entry is art-source/tools/blender/build_animals.py.

Coordinates: everything is built in game space (x = the animal's left, y up, z forward: the animal faces +z), in
metres. B() turns a game point into Blender space (Z up, the animal faces -Y); the glTF export turns it back to Y up,
so in the file and in the game the axes are the game's again.
"""

import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT = os.path.join(ROOT, "client", "public", "models", "animals.glb")
SHOTS = os.path.join(ROOT, "..", ".scratch", "animals-build", "shots")

FPS = 60
TEX = 512


def B(x, y=None, z=None):
    """Game point (x left, y up, z forward) to Blender (x, -z, y)."""
    from mathutils import Vector

    if y is None:
        x, y, z = x
    return Vector((float(x), float(-z), float(y)))


def G(v):
    """Blender point back to game space."""
    return (v[0], v[2], -v[1])
