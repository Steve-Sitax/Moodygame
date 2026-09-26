"""Build the player's figures (M7 character) from the townspeople's kit.

    blender -b --factory-startup -P tools/blender/build_player.py

Steve (2026-09-26): "some character customisation in the menu before start of a new game. Gender, age,
some clothes and colours, name. This in preparation for multiplayer."

The player is dressed from the same kit as the town (build_people.py: the lofted bodies, the
clothes, the hats, the painter), but in any colour of the period palette (shared/character.ts). A
townsperson's colours are painted into the texture; the player's are put in by the game, so this
writes, beside the figures, what the game needs to paint them:

  client/public/models/player.glb          the bodies, one per cut of clothes, on the townspeople's
                                           skeleton (bone names and rest pose the same: people.glb's
                                           clips drive them); the hats and the hair (buns, plaits,
                                           long hair at the nape) as small meshes to hang on the head
  client/public/models/player_base.png     each texture as painted in grey cloth (the fixed pixels:
                                           eyes, lips, buttons, the dress's collar)
  client/public/models/player_slot.png     which colour slot each pixel is (red = slot x 20:
                                           1 skin, 2 hair, 3 hat, 4 coat or shawl, 5 shirt or blouse,
                                           6 waistcoat, 7 trousers or skirt, 8 apron, 9 boots or clogs)
  client/public/models/player_shade.png    how light each pixel is against its slot's colour (x 127.5)
  client/public/models/player_atlas.json   where each tile is in the three pictures

How the slots are found: the painter is run once with every slot's cloth in mid grey, then once per
slot with that slot in white; a pixel that changes belongs to the slot that changes it most (the same
seed: the grain and the folds fall the same each time). The game then paints colour x shade.

Tiles (the three pictures share one layout, top row first, as the game's canvas):
  fig:<name>     the whole 128 x 128 texture of a figure
  head:<key>     the face cell (64 x 32) by sex, facial hair, age and thinning hair
  hat:<kind>     the hat cell (32 x 32) painted for each hat
  shawl:<style>  the shawl cell (32 x 16), plain or check
"""

import json
import math
import os
import struct
import sys
import zlib

import bmesh
import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_people as bp  # noqa: E402  (the townspeople's kit)

ROOT = bp.ROOT
MODELS = os.path.join(ROOT, "client", "public", "models")
OUT = os.path.join(MODELS, "player.glb")

GREY = 0x808080
WHITE = 0xFFFFFF
SLOTS = ["skin", "hair", "hat", "coat", "shirt", "vest", "lower", "apron", "boots"]
# which keys of a townsperson's dict each slot paints
SLOT_KEYS = {
    "skin": ["skin"],
    "hair": ["hair"],
    "hat": ["hat_col"],
    "coat": ["jacket", "smock", "shawl"],
    "shirt": ["shirt", "dress"],
    "vest": ["vest"],
    "lower": ["trousers", "lower_col"],
    "apron": ["apron"],
    "boots": ["boots"],
}
MAN_H = 1.74
WOMAN_H = 1.62

# ---------------------------------------------------------------- the cuts

def man(**kw):
    s = dict(bp.MALE, h=MAN_H, sh=0.205, skin=GREY, hair=GREY, face="clean", age=0.3,
             shirt=GREY, vest=GREY, trousers=GREY, boots=GREY)
    s.update(kw)
    return s


def woman(**kw):
    s = dict(bp.FEMALE, h=WOMAN_H, sh=0.18, skin=GREY, hair=GREY, face="woman", age=0.3,
             dress=GREY, collar=0xc8c0b0, lower="skirt", lower_col=GREY, boots=GREY)
    s.update(kw)
    return s


# one body per cut of clothes that changes the shape (the colours are the game's)
FIGURES = [
    ("m_shirt", man()),
    ("m_jacket", man(jacket=GREY, jacket_style="open", lower="jacket")),
    ("m_coat", man(jacket=GREY, jacket_style="coat", lower="coat")),
    ("m_smock", man(smock=GREY, lower="smock")),
    ("m_apron", man(lower="apron", apron=GREY)),
    ("m_jacket_apron", man(jacket=GREY, jacket_style="open", lower="apron", apron=GREY)),
    ("w_plain", woman()),
    ("w_apron", woman(apron=GREY)),
    ("w_shawl", woman(shawl=GREY, shawl_style="plain")),
    ("w_shawl_apron", woman(shawl=GREY, shawl_style="plain", apron=GREY)),
]
# the game's ids (shared/character.ts FACES) -> the painter's faces
MAN_FACES = {"clean": "clean", "light_stubble": "young_stubble", "stubble": "stubble", "moustache": "moustache",
             "whiskers": "chops", "beard": "gent", "walrus": "walrus"}
AGES = {"y": 0.3, "m": 0.6, "o": 0.85}  # up to 30, 31 to 45, 46 to 60
# hats: the game's ids -> the painter's, with the sex whose head they fit
HATS = [("cap", "flatcap", "m"), ("knitcap", "knitcap", "m"), ("bowler", "bowler", "m"), ("tophat", "tophat", "m"),
        ("bonnet", "bonnet", "w"), ("whitecap", "whitecap", "w"), ("headscarf", "kerchief", "w")]


# ---------------------------------------------------------------- painting the slots

def with_slot(s, slot, col):
    t = dict(s)
    for k in SLOT_KEYS[slot]:
        if k in t:
            t[k] = col
    return t


def painted(s, seed, post=None):
    img = bp.paint(s, seed)
    return post(img) if post else img


def slot_planes(s, seed, post=None):
    """base (fixed pixels right, slots in grey), slot index per pixel, shade per pixel and channel."""
    grey = painted(s, seed, post)
    best = np.zeros(grey.shape[:2])
    slot = np.zeros(grey.shape[:2], dtype=np.uint8)
    for i, name in enumerate(SLOTS, start=1):
        if not any(k in s for k in SLOT_KEYS[name]):
            continue
        lit = painted(with_slot(s, name, WHITE), seed, post)
        d = np.abs(lit - grey).sum(axis=2)
        take = (d > 3 / 255) & (d > best)
        slot[take] = i
        best[take] = d[take]
    shade = np.clip(grey / bp.rgb(GREY)[None, None, :], 0, 2)
    return grey, slot, shade


def balding(img):
    """Thinning hair: the front of the crown as bare as the forehead (the head cell, rows from the bottom)."""
    x0, y0, w, h = bp.CELLS["head"]
    cell = img[y0:y0 + h, x0:x0 + w]
    C = np.arange(w)
    ad = np.abs(C - (w - 1) / 2)
    front = ad < 11
    for R in range(25, 32):
        cell[R, front] = cell[23, front] * (0.97 + 0.01 * (R - 25))
    return img


def cut(img, cell):
    """A cell of a 128 x 128 picture (rows from the bottom), top row first."""
    x0, y0, w, h = bp.CELLS[cell]
    return np.flipud(img[y0:y0 + h, x0:x0 + w])


# ---------------------------------------------------------------- blender objects

def make_armature(name, s):
    k = s["h"] / 1.74
    J = bp.joints(s)
    arm = bpy.data.armatures.new(name + "_rig")
    ao = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(ao)
    bpy.context.view_layer.objects.active = ao
    bpy.ops.object.mode_set(mode="EDIT")
    for bn in bp.BONES:
        h0, h1 = J[bn]
        eb = arm.edit_bones.new(bn)
        eb.head = bp.B(*(c * k for c in h0))
        eb.tail = bp.B(*(c * k for c in h1))
        eb.roll = 0.0
    for bn, par in bp.PARENT.items():
        arm.edit_bones[bn].parent = arm.edit_bones[par]
    bpy.ops.object.mode_set(mode="OBJECT")
    return ao


def mesh_object(name, body, material, parent=None):
    me = bpy.data.meshes.new(name)
    bmesh.ops.triangulate(body.bm, faces=body.bm.faces[:])
    body.bm.to_mesh(me)
    tris = len(body.bm.faces)
    body.bm.free()
    mo = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(mo)
    me.materials.append(material)
    for poly in me.polygons:
        poly.use_smooth = False
    if parent is not None:
        for g in body.groups:
            mo.vertex_groups.new(name=g)
        mo.parent = parent
        mod = mo.modifiers.new("rig", "ARMATURE")
        mod.object = parent
    return mo, tris


def hat_body(s, hat):
    """Only the hat, bound to the head (a static mesh in the figure's space: the game hangs it on the head bone)."""
    b = bp.Body(s["h"] / 1.74, 1.0)
    bp.clothes(b, {"female": s["female"], "sh": s["sh"], "belly": 0.0, "cl": s["cl"], "hat": hat})
    return b


# hair beyond the painted head: UVs on a patch of hair at the back of the face cell
HAIR_UV = (0.02, 0.1, 0.72, 0.95)


def hair_body(s, style):
    b = bp.Body(s["h"] / 1.74, 1.0)
    R = bp.ring
    if style == "bun":
        # a knot of hair at the back of the head, above the nape
        b.loft([R(0, 1.655, -0.085, 0.03, 0.02), R(0, 1.655, -0.11, 0.048, 0.042), R(0, 1.655, -0.14, 0.04, 0.036),
                R(0, 1.655, -0.155, 0.012, 0.012)], "head", "head", 8, side=(1, 0, 0), fwd=(0, 1, 0),
               cap1=(0, 0, -0.004), sub=HAIR_UV)
    elif style == "plaits":
        # two plaits from behind the ears down over the shoulders to the collar bones
        for sg in (1, -1):
            b.loft([R(sg * 0.07, 1.6, -0.06, 0.018, 0.018), R(sg * 0.085, 1.52, -0.05, 0.02, 0.02),
                    R(sg * 0.095, 1.44, -0.02, 0.018, 0.018), R(sg * 0.1, 1.38, 0.02, 0.012, 0.012)],
                   "head", "head", 5, cap1=(0, -0.012, 0), sub=HAIR_UV)
    elif style == "coronet":
        # plaits pinned round the head: a thick band over the crown, ear to ear
        b.loft([R(0, 1.69, -0.012, 0.086, 0.098, 0.1), R(0, 1.705, -0.012, 0.095, 0.107, 0.11),
                R(0, 1.735, -0.014, 0.088, 0.1, 0.103)], "head", "head", 12, sub=HAIR_UV)
    elif style == "long":
        # a man's hair grown to the collar: a shell over the back of the head and the nape
        b.loft([R(0, 1.5, -0.03, 0.078, 0.07, 0.096), R(0, 1.58, -0.02, 0.086, 0.09, 0.098),
                R(0, 1.66, -0.01, 0.086, 0.098, 0.102), R(0, 1.72, -0.012, 0.074, 0.084, 0.092)],
               "head", "head", 10, arc=(100, 260), sub=HAIR_UV)
    return b


# ---------------------------------------------------------------- the pictures

def write_png(path, rgb):
    """An 8-bit RGB PNG (top row first), with zlib only."""
    h, w, _ = rgb.shape
    raw = b"".join(b"\x00" + rgb[y].astype(np.uint8).tobytes() for y in range(h))

    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
    png += chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
    with open(path, "wb") as f:
        f.write(png)


class Atlas:
    def __init__(self, width=1024):
        self.W = width
        self.tiles = []  # (key, base, slot, shade) top row first

    def add(self, key, base, slot, shade):
        self.tiles.append((key, base, slot, shade))

    def pack(self):
        rows = []
        x = y = row_h = 0
        rects = {}
        for key, base, _, _ in self.tiles:
            h, w = base.shape[:2]
            if x + w > self.W:
                x, y, row_h = 0, y + row_h, 0
            rects[key] = (x, y, w, h)
            x += w
            row_h = max(row_h, h)
        H = y + row_h
        planes = [np.zeros((H, self.W, 3)) for _ in range(3)]
        for key, base, slot, shade in self.tiles:
            x, y, w, h = rects[key]
            planes[0][y:y + h, x:x + w] = np.clip(base * 255 + 0.5, 0, 255)
            planes[1][y:y + h, x:x + w, 0] = slot * 20
            planes[2][y:y + h, x:x + w] = np.clip(shade * 127.5 + 0.5, 0, 255)
        return rects, planes


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    atlas = Atlas()
    report = []
    seed = 1873

    # the bodies
    grey_img = bp.make_image("player_grey", np.full((bp.TEX, bp.TEX, 3), 0.5))
    mat = bp.make_material("player", grey_img)
    for name, s in FIGURES:
        s = dict(s, name=name)
        ao = make_armature("fig_" + name, s)
        _, tris = mesh_object("fig_" + name + "_body", bp.build_body(s), mat, parent=ao)
        base, slot, shade = slot_planes(s, seed)
        atlas.add("fig:" + name, np.flipud(base), np.flipud(slot), np.flipud(shade))
        report.append(f"{name} {tris}")

    # the faces: by sex, facial hair, age, thinning hair
    for sex, faces in (("m", MAN_FACES), ("w", {"none": "woman"})):
        base_s = man() if sex == "m" else woman()
        for fid, face in faces.items():
            for ak, age in AGES.items():
                for bald in ((False, True) if sex == "m" else (False,)):
                    s = dict(base_s, face=face, age=age)
                    b, sl, sh = slot_planes(s, seed, balding if bald else None)
                    key = f"head:{sex}_{fid}_{ak}{'_bald' if bald else ''}"
                    atlas.add(key, cut(b, "head"), cut(sl[..., None], "head")[..., 0], cut(sh, "head"))

    # the hats: painted cells, and the meshes (in the figure's space; the game hangs them on the head)
    for gid, hat, sex in HATS:
        s = (man() if sex == "m" else woman())
        b, sl, sh = slot_planes(dict(s, hat=hat, hat_col=GREY), seed)
        atlas.add("hat:" + gid, cut(b, "hat"), cut(sl[..., None], "hat")[..., 0], cut(sh, "hat"))
        mesh_object(f"hat_{gid}", hat_body(s, hat), mat)
    for style in ("plain", "check"):
        s = woman(shawl=GREY, shawl_style=style)
        b, sl, sh = slot_planes(s, seed)
        atlas.add("shawl:" + style, cut(b, "shawl"), cut(sl[..., None], "shawl")[..., 0], cut(sh, "shawl"))

    # hair beyond the painted head
    for style, sex in (("bun", "w"), ("plaits", "w"), ("coronet", "w"), ("long", "m")):
        s = man() if sex == "m" else woman()
        mesh_object(f"hair_{style}", hair_body(s, style), mat)

    os.makedirs(MODELS, exist_ok=True)
    bpy.ops.export_scene.gltf(filepath=OUT, export_format="GLB", export_yup=True, export_texcoords=True, export_normals=True,
                              export_materials="EXPORT", use_selection=False, export_skins=True, export_animations=False,
                              export_image_format="AUTO", export_draco_mesh_compression_enable=True,
                              export_draco_mesh_compression_level=7)

    rects, planes = atlas.pack()
    for name, plane in zip(("base", "slot", "shade"), planes):
        write_png(os.path.join(MODELS, f"player_{name}.png"), plane)
    cells = {k: [v[0], bp.TEX - v[1] - v[3], v[2], v[3]] for k, v in bp.CELLS.items()}  # top row first
    with open(os.path.join(MODELS, "player_atlas.json"), "w") as f:
        json.dump({"slots": SLOTS, "tex": bp.TEX, "cells": cells, "tiles": {k: list(v) for k, v in rects.items()},
                   "heights": {"m": MAN_H, "w": WOMAN_H}}, f, indent=1)
    size = os.path.getsize(OUT) // 1024
    print(f"[build_player] {', '.join(report)} triangles; {len(rects)} tiles; -> {OUT} ({size} KB)")


if __name__ == "__main__":
    main()
