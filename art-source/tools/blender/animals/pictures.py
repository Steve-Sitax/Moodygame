"""The pictures' masters for the native game: every coat's colour picture, each rig's normal picture and the
harness's picture as 8-bit PNGs in native-godot/assets/animal-pictures, with the import settings the game requires
(colour: high-quality BPTC; normals: RGTC; both mipmapped), the same as the people2 pictures. Godot compresses them
when it imports them; Animal.cs loads them by name. The glb files carry small stand-ins, so the stored scene holds the
shapes and the clips and the pictures live once.

PNGs are written here (zlib, no filter), so the same pixels always give the same file.
"""

import os
import struct
import zlib

import numpy as np

from . import ROOT

FOLDER = os.path.abspath(os.path.join(ROOT, "..", "native-godot", "assets", "animal-pictures"))

IMPORT = """[remap]

importer="texture"
type="CompressedTexture2D"

[deps]

source_file="res://assets/animal-pictures/{name}"

[params]

compress/mode=2
compress/high_quality={hq}
compress/lossy_quality=0.7
compress/uastc_level=0
compress/rdo_quality_loss=0.0
compress/hdr_compression=1
compress/normal_map={nm}
compress/channel_pack=0
mipmaps/generate=true
mipmaps/limit=-1
roughness/mode=0
roughness/src_normal=""
process/channel_remap/red=0
process/channel_remap/green=1
process/channel_remap/blue=2
process/channel_remap/alpha=3
process/fix_alpha_border=false
process/premult_alpha=false
process/normal_map_invert_y=false
process/hdr_as_srgb=false
process/hdr_clamp_exposure=false
process/size_limit=0
detect_3d/compress_to=1
"""


def png_bytes(rgb):
    """An 8-bit RGB PNG of a picture (top row first, values 0..1)."""
    a = (np.clip(rgb, 0, 1) * 255 + 0.5).astype(np.uint8)
    h, w = a.shape[:2]
    raw = b"".join(b"\x00" + a[y].tobytes() for y in range(h))

    def chunk(t, d):
        c = struct.pack(">I", len(d)) + t + d
        return c + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) +
            chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def write(name, rgb, normal=False):
    """Write the PNG and, when it has none, its import settings; return the PNG's SHA-256."""
    import hashlib
    os.makedirs(FOLDER, exist_ok=True)
    data = png_bytes(rgb)
    path = os.path.join(FOLDER, name + ".png")
    with open(path, "wb") as f:
        f.write(data)
    imp = path + ".import"
    if not os.path.exists(imp):
        with open(imp, "w", encoding="utf-8", newline="\n") as f:
            f.write(IMPORT.format(name=name + ".png", hq="false" if normal else "true", nm=1 if normal else 0))
    return hashlib.sha256(data).hexdigest()
