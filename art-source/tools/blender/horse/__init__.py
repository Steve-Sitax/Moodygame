"""horse: the draught horse of Scheldemist as one model of rigid parts (docs/plans/people.md, package H).

The horse (a Brabant at true size, the shapes of build_props.py's "draught horse" section: body, neck and head lofts,
legs split at the knee and hock, the full harness) is cut into parts that the game moves on their own pivots, the way
it moves the legs (Movers/Horses.cs): the body; the neck with the collar and hames (nodding a little about the base of
the neck); the head with the bridle (nodding at the poll); each ear (turning at its base); the tail (swishing at the
dock); the four leg parts as before; and two straps the game stretches (a rein from the bit to the hame terret, a trace
from the hame tug's buckle to the shaft's hook). Every part shares one picture layout (a unique unwrap), painted per
coat at 2048 px with a normal picture (parts/paint.py). The entry is art-source/tools/blender/build_horse.py.

Coordinates: parts are built in the horse's Blender frame (HP(x, f, h): x across, f forward, h up; Blender y = -f);
the glTF export turns it into the game's (x, h, f). Each part's origin is its pivot.
"""

import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
OUT_DIR = os.path.abspath(os.path.join(ROOT, "..", ".scratch", "horse-build"))
PICTURES = os.path.abspath(os.path.join(ROOT, "..", "native-godot", "assets", "horse-pictures"))
TEX = 2048
COATS = ["bay", "chestnut", "black", "roan"]
