"""Dressing a kind (package C; docs/people.md "Kinds and clothes").

A kind is a base body (made again under the kind's own name, so its armature and meshes are the kind's), its face
(one setting: Kind.face, see face_of), its hair, the garments of its kinds_*.py entry and its held things. The
steps, in build():
1. the body, as A and B make it (build_people2.make_body), with the kind's hair style;
2. the face: the kind's face mix baked into the near copy (the face-shape keys stay, for more variety at run time);
3. the body's picture (skin, hands, the kind's extras such as socks or grime), and the face square;
4. the garments (Kind.dress(fit) -> Pieces), one cage: unwrapped, subdivided (near), on its limit surface (far);
5. the body under the clothes cut away (Kind.covers);
6. the cloth picture, painted on the garments in 3D;
7. UVs into the kind layer and full-square face, the clothes joined into the body's two meshes, hats made to follow the face shapes.
"""

import math
import os

import numpy as np

from . import SHOTS
from . import pictures as at
from . import G as toG
from . import clothes_kit as ck
from . import lod
from . import paint
from . import weights as wt


class Kind:
    """One kind of person. face: the one face setting (seed, age, sex, and optionally a face type name or look
    values): see face_of(). hair: a hair style dict (hair.py) or None for a seeded one. dress(fit) -> list of
    ck.Piece. covers(p, part) -> True where the body is hidden under the clothes. skin(ctx) paints extras on the
    body picture (socks, grime). held: [(model, socket, note)]. avoid: clips it should not play (and why)."""

    def __init__(self, name, group, body, face, dress, covers, hair=None, hats=(), held=(), hands_hard=0.0,
                 hero=False, skin=None, avoid=(), clips=(), note=""):
        self.name, self.group, self.body = name, group, body
        self.face, self.hair = face, hair
        self.dress, self.covers, self.skin = dress, covers, skin
        self.hats = tuple(hats)
        self.held = list(held)
        self.hands_hard = hands_hard
        self.hero = hero
        self.avoid = dict(avoid)
        self.clips = list(clips)
        self.note = note


def face_of(kind, P):
    """The kind's default face (the face the check pictures show and the game starts from): the named cast's fixed
    face (face_types.CAST), else face_types.face_for(the kind's seed). The game gives every person of a kind their own
    face at spawn (sliders, face picture, hair) from their id; the kind's mesh carries no face of its own."""
    from . import face_types as ft
    f = kind.face
    sex = f.get("sex", "f" if P["female"] else "m")
    if kind.name in ft.CAST:
        return ft.face_for(0, kind.name, sex, f.get("age", 35))
    return ft.face_for(f["seed"], kind.name, sex, f.get("age", 35))


def bake_shapes(ob, mix):
    """Bake a face-shape mix into a near copy: the basis and every key move by the mix, so the keys still add on top
    (the games may give each person of a kind more of them)."""
    me = ob.data
    if not me.shape_keys or not mix:
        return
    kb = me.shape_keys.key_blocks
    basis = me.shape_keys.reference_key
    n = len(me.vertices)
    b = np.zeros(n * 3)
    basis.data.foreach_get("co", b)
    D = np.zeros(n * 3)
    for name, w in mix.items():
        if name in kb:
            k = np.zeros(n * 3)
            kb[name].data.foreach_get("co", k)
            D += w * (k - b)
    for k_ in kb:
        c = np.zeros(n * 3)
        k_.data.foreach_get("co", c)
        k_.data.foreach_set("co", c + D)
    co = np.zeros(n * 3)
    me.vertices.foreach_get("co", co)
    me.vertices.foreach_set("co", co + D)
    me.update()


def limit4(ob):
    W = wt.read(ob)
    for vg in list(ob.vertex_groups):
        if not vg.name.startswith(("part_", "zone_")):
            ob.vertex_groups.remove(vg)
    wt.apply(ob, W, limit=4)


