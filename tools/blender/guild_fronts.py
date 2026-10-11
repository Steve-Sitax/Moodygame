"""The guild houses of the Grote Markt: fourteen fronts made by hand (look survey #17, 2026-10-11).

The survey found the two rows of the square to be "one apartment block wearing interchangeable gables": the same
3 m window grid and floor lines through every house. Here each front on the square is drawn after the real ones of
Antwerp (the guild houses of the 1580s-1640s, and the Baroque and 18th-century fronts rebuilt among them): tall
Flemish Renaissance and Baroque fronts in white sandstone, bluestone, brick with stone bands and painted plaster,
stepped, scrolled, bell and neck gables, superposed pilaster orders, entablatures, carved panels, cross windows of
leaded glass, niches, obelisks, and gilt figures on the tops. Each differs in width (its plot), storey heights,
window count and width, cornices and gable; each leans a little forward, as the old fronts do.

Seven designs, each built twice in a variant of its own (other stone, storeys, windows, gable and figure):

    neck      a neck gable with claw pieces and a pediment (18 brick, 52 ochre plaster)
    gothic    late Gothic: stone with blind tracery, a stepped gable with pinnacles (19 bluestone, 54 sandstone)
    baroque   a Baroque stone frontispiece: three orders, a scrolled gable in two tiers, a niche with the Virgin,
              a gilt figure on top (20 St George, 53 an eagle)
    bell      an 18th-century bell gable over sash windows (21 white plaster, 25 yellow brick)
    step      Brabantine stepped gable in brick with stone bands, cross windows under relieving arches (22, 50)
    mannerist a stepped gable with a scroll in every step and obelisks, carved panels (23 cream, 55 brick)
    orders    Renaissance: three superposed orders, a tiered volute gable (24 Den Engel, its gilt angel; 51 a saint)

How they are built (tools/blender/build_city.py rect_house): the ground storey of each house stays as it was (its
door, shop windows and the rooms that stand behind them in the world, shared/inworld_build.json), up to the ground
storey's height. Over it the old front and its front gable are left out; this module builds the new front there
instead, in the city's own materials (no new shader): the walls in the facade material with the house's wall
picture (houseGrime.ts, "Mat" uv), the dressings in stone, gilt as stone tinted gold, the glass a cell of the
facade atlas (cityTextures.ts leadedLight, LEADED). The front is a slab FACE deep before the old wall line, closed
at its ends, along its outline and behind; it rises clear of the roof everywhere (the roof meets its back).

What the rest of the game needs from it is written to shared/city_guild_fronts.json (main() of build_city.py):
by house index, every window of the front (for the lit panes at night, ambient.ts, and the heads at the window
over the door, lively.ts).

    blender -b --factory-startup -P tools/blender/build_city.py -- --guild-preview .scratch/gf    pictures only
"""

import math
import os

# build_city.py hands its constants in (set_constants), so this file never imports it (it runs as __main__)
K = {}

LEADED, LEADED_SHUT = (0, 4), (1, 4)  # facade atlas cells (cityTextures.ts leadedLight): leaded panes; with the inner shutters shut

FACE = 0.32  # the front's face, out of the old wall line (the ground storey's face)
BACK = 0.035  # its back, just before the old wall line (the roof's edge lies between)
R_WIN = 0.2  # how deep the windows' glass stands behind the face
END_IN = 0.005  # the slab's ends stand this far in from the plot's corners

# stone, by its colour (a tint on the city's stone picture), and gilt
WHITE = (0.93, 0.89, 0.8)  # white sandstone (Lede, Balegem)
CREAM = (0.9, 0.83, 0.68)  # yellow sandstone (Gobertange)
BLUE = (0.5, 0.53, 0.57)  # bluestone (arduin)
GREY = (0.78, 0.77, 0.74)  # weathered grey stone
GILT = (1.0, 0.74, 0.24)
IRON = (0.16, 0.16, 0.17)
OAK = (0.55, 0.4, 0.28)

# ------------------------------------------------------------------ the fronts, by house index (city_build.json)
# wall: the wall picture and paint (build_city.py WALL_LAYERS, PAINTS; 0 brick_fine, 1 brick, 3 speklagen, 4 brick_yellow,
# 6 brick_white, 7 plaster_smooth, 10 render, 11 ashlar_sand, 12 ashlar_blue; paints 1 cream, 2 ochre, 3 pale grey, 6 white)
# yc: the ground cornice's foot (over the shop boards' band, 3.47..4.19 m); ent0 its height
# storeys: each upper storey's height, windows (n, width, kind), its order of pilasters and the band over it
FRONTS = {
    # ---- the east row, north to south (their fronts at x -222, facing the square)
    18: dict(name="neck gable in brick, a ball on its pediment", design="neck", wall=(0, 15), row=0, stone=WHITE, wear=0.32,
             lean=0.009, yc=4.25, ent0="plain", storeys=[
                 dict(h=3.7, n=2, w=1.25, win="cross", head="segment", sill=0.9, panels=True),
                 dict(h=3.4, n=2, w=1.2, win="cross", head="pediment", sill=0.85),
                 dict(h=3.15, n=2, w=1.15, win="cross", head="lintel", sill=0.8),
                 dict(h=2.8, n=2, w=1.0, win="cross", head="key", sill=0.7)],
             band="string", cornice="small",
             gable=dict(kind="neck", neck=0.52, hn=3.3, claws=True, top="segment", gwins=[dict(y=0.7, h=1.5, n=1, w=0.95, win="cross")],
                        finial="ball_gilt")),
    19: dict(name="late Gothic, bluestone and white stone, blind tracery, a stepped gable with pinnacles", design="gothic",
             wall=(12, 0), row=2, stone=WHITE, stone2=BLUE, wear=0.42, lean=0.012, yc=4.3, ent0="gothic", storeys=[
                 dict(h=4.0, n=1, w=1.9, win="cross3", head="pointed", sill=0.95, tracery=True),
                 dict(h=3.65, n=1, w=1.8, win="cross3", head="pointed", sill=0.9, tracery=True),
                 dict(h=3.4, n=1, w=1.7, win="cross", head="pointed", sill=0.85, tracery=True)],
             band="gothic", cornice="gothic",
             gable=dict(kind="step", steps=5, rise=1.05, top=0.9, pinnacles=True, copings=True,
                        gwins=[dict(y=0.55, h=1.6, n=1, w=1.15, win="cross", head="pointed"), dict(y=2.75, h=1.05, n=1, w=0.7, win="small")],
                        finial="cross")),
    20: dict(name="Baroque stone frontispiece, three orders, St George on top (after the crossbowmen's house)", design="baroque",
             wall=(7, 3), row=2, stone=WHITE, wear=0.2, lean=0.006, yc=4.25, ent0="doric", storeys=[
                 dict(h=4.4, n=3, w=1.2, win="cross", head="pediment", sill=1.0, order="doric", panels=True),
                 dict(h=3.95, n=3, w=1.15, win="cross", head="segment", sill=0.95, order="ionic", panels=True),
                 dict(h=3.6, n=3, w=1.1, win="cross", head="shell", sill=0.9, order="corinth")],
             band="order", cornice="grand",
             gable=dict(kind="tiers", tiers=[(0.66, 3.0, "ionic"), (0.38, 2.4, None)], scrolls="big", niche=1, top="segment",
                        gwins=[dict(y=0.6, h=1.75, n=2, w=0.85, win="cross", head="lintel")], statue="knight", obelisks=True)),
    21: dict(name="18th-century bell gable, white plaster over sash windows, an oculus", design="bell",
             wall=(7, 6), row=1, stone=WHITE, wear=0.25, lean=0.004, yc=4.25, ent0="plain", storeys=[
                 dict(h=3.3, n=2, w=1.05, win="sash", head="ears", sill=0.85),
                 dict(h=3.05, n=2, w=1.05, win="sash", head="key", sill=0.8),
                 dict(h=2.95, n=2, w=1.0, win="sash", head="key", sill=0.8),
                 dict(h=2.75, n=2, w=0.95, win="sash", head="lintel", sill=0.7)],
             band="none", cornice="small",
             gable=dict(kind="bell", hg=4.4, neck=0.36, gwins=[dict(y=0.55, h=1.45, n=1, w=0.9, win="sash", head="ears")],
                        oculus=(2.65, 0.36), top="pediment", vases=True, finial="vase")),
    22: dict(name="Brabantine stepped gable, brick with stone bands, cross windows under relieving arches", design="step",
             wall=(3, 0), row=0, stone=WHITE, wear=0.38, lean=0.01, yc=4.3, ent0="plain", storeys=[
                 dict(h=3.6, n=2, w=1.3, win="cross", head="arch", sill=0.95),
                 dict(h=3.45, n=2, w=1.3, win="cross", head="arch", sill=0.9),
                 dict(h=3.25, n=2, w=1.2, win="cross", head="arch", sill=0.85)],
             band="string", cornice="string",
             gable=dict(kind="step", steps=7, rise=0.82, top=0.85, copings=True, balls=True,
                        gwins=[dict(y=0.6, h=1.5, n=2, w=0.9, win="cross", head="arch"), dict(y=2.75, h=1.25, n=1, w=0.8, win="cross", head="arch"),
                               dict(y=4.5, h=0.75, n=1, w=0.6, win="small")], finial="vane")),
    23: dict(name="Mannerist stepped gable, a scroll in every step, obelisks, carved panels", design="mannerist",
             wall=(7, 1), row=1, stone=WHITE, wear=0.22, lean=0.007, yc=4.25, ent0="doric", storeys=[
                 dict(h=3.9, n=2, w=1.25, win="cross", head="pediment", sill=0.95, panels=True, order="rustic"),
                 dict(h=3.35, n=2, w=1.2, win="cross", head="segment", sill=0.9, panels=True),
                 dict(h=3.1, n=2, w=1.1, win="cross", head="lintel", sill=0.85, panels=True)],
             band="string", cornice="medium",
             gable=dict(kind="step", steps=4, rise=1.25, top=1.1, scroll_steps=True, obelisks=True, copings=True,
                        gwins=[dict(y=0.65, h=1.55, n=2, w=0.85, win="cross", head="shell"), dict(y=3.05, h=1.25, n=1, w=0.75, win="cross")],
                        finial="ball_gilt")),
    24: dict(name="Renaissance, three orders, a tiered volute gable with the gilt angel (Den Engel)", design="orders",
             wall=(11, 14), row=1, stone=WHITE, wear=0.18, lean=0.005, yc=4.3, ent0="doric", storeys=[
                 dict(h=4.15, n=2, w=1.3, win="cross", head="pediment", sill=1.0, order="doric", panels=True),
                 dict(h=3.7, n=2, w=1.25, win="cross", head="segment", sill=0.95, order="ionic", panels=True),
                 dict(h=3.4, n=2, w=1.15, win="cross", head="lintel", sill=0.9, order="corinth")],
             band="order", cornice="grand",
             gable=dict(kind="tiers", tiers=[(0.72, 2.6, "ionic"), (0.46, 2.2, "corinth")], scrolls="volute", top="pediment",
                        gwins=[dict(y=0.55, h=1.6, n=2, w=0.85, win="cross", head="lintel"), dict(y=3.1, h=1.25, n=1, w=0.8, win="cross")],
                        statue="angel", obelisks=True)),
    25: dict(name="bell gable in yellow brick with sandstone, sash windows", design="bell",
             wall=(6, 4), row=1, stone=WHITE, wear=0.35, lean=0.008, yc=4.3, ent0="plain", storeys=[
                 dict(h=3.45, n=2, w=1.0, win="sash", head="segment", sill=0.85),
                 dict(h=3.2, n=2, w=1.0, win="sash", head="lintel", sill=0.8),
                 dict(h=3.1, n=2, w=1.0, win="sash", head="lintel", sill=0.8),
                 dict(h=2.95, n=2, w=0.9, win="sash", head="lintel", sill=0.75)],
             band="anchors", cornice="small",
             gable=dict(kind="bell", hg=3.6, neck=0.44, gwins=[dict(y=0.7, h=1.35, n=1, w=0.95, win="loading")], top="segment",
                        finial="ball", beam=True)),
    # ---- the west row, south to north (their fronts at x -286, facing the square)
    50: dict(name="Brabantine stepped gable, red brick, three cross windows a storey", design="step",
             wall=(0, 14), row=0, stone=WHITE, wear=0.45, lean=0.011, yc=4.25, ent0="plain", storeys=[
                 dict(h=3.75, n=3, w=1.25, win="cross", head="arch", sill=0.95),
                 dict(h=3.45, n=3, w=1.2, win="cross", head="arch", sill=0.9)],
             band="string", cornice="string",
             gable=dict(kind="step", steps=6, rise=1.05, top=1.0, copings=True,
                        gwins=[dict(y=0.6, h=1.55, n=3, w=0.9, win="cross", head="arch"), dict(y=2.85, h=1.35, n=2, w=0.8, win="cross", head="arch"),
                               dict(y=4.95, h=0.85, n=1, w=0.65, win="loading")], finial="ball", beam=True)),
    51: dict(name="Renaissance, three orders in grey stone, a tiered volute gable, a gilt saint", design="orders",
             wall=(10, 3), row=2, stone=GREY, wear=0.3, lean=0.007, yc=4.25, ent0="doric", storeys=[
                 dict(h=3.95, n=3, w=1.05, win="cross", head="lintel", sill=0.95, order="doric"),
                 dict(h=3.55, n=3, w=1.0, win="cross", head="pediment", sill=0.9, order="ionic", panels=True),
                 dict(h=3.25, n=3, w=0.95, win="cross", head="lintel", sill=0.85, order="ionic")],
             band="order", cornice="medium",
             gable=dict(kind="tiers", tiers=[(0.7, 2.9, "ionic"), (0.42, 2.1, None)], scrolls="volute", top="segment", niche=0,
                        gwins=[dict(y=0.6, h=1.7, n=3, w=0.75, win="cross", head="lintel")], statue="saint", obelisks=False, balls=True)),
    52: dict(name="neck gable, ochre plaster, claw pieces, a broad attic window", design="neck",
             wall=(7, 2), row=1, stone=WHITE, wear=0.28, lean=0.006, yc=4.25, ent0="plain", storeys=[
                 dict(h=3.55, n=3, w=1.1, win="sash", head="hood", sill=0.9),
                 dict(h=3.2, n=3, w=1.05, win="sash", head="key", sill=0.85),
                 dict(h=3.05, n=3, w=1.0, win="sash", head="key", sill=0.8),
                 dict(h=2.7, n=3, w=0.95, win="sash", head="lintel", sill=0.7)],
             band="string", cornice="medium",
             gable=dict(kind="neck", neck=0.5, hn=3.6, claws=True, top="pediment",
                        gwins=[dict(y=0.6, h=1.55, n=1, w=1.25, win="sash", head="ears"), dict(y=2.55, h=0.0, n=0, w=0.0)],
                        oculus=(2.75, 0.3), finial="vase", vases=True)),
    53: dict(name="Baroque, the widest front: three orders, big scrolls, a niche, the gilt eagle", design="baroque",
             wall=(12, 0), row=2, stone=WHITE, wear=0.16, lean=0.005, yc=4.25, ent0="doric", storeys=[
                 dict(h=4.35, n=3, w=1.35, win="cross", head="pediment", sill=1.0, order="rustic", panels=True),
                 dict(h=3.85, n=3, w=1.3, win="cross", head="shell", sill=0.95, order="ionic", panels=True),
                 dict(h=3.5, n=3, w=1.2, win="cross", head="segment", sill=0.9, order="corinth")],
             band="order", cornice="grand",
             gable=dict(kind="tiers", tiers=[(0.64, 3.1, "corinth"), (0.36, 2.5, None)], scrolls="big", niche=1, top="segment",
                        gwins=[dict(y=0.65, h=1.8, n=2, w=0.95, win="cross", head="segment")], statue="eagle", obelisks=True)),
    54: dict(name="late Gothic in white stone, tall tracery panels, a stepped gable with pinnacles", design="gothic",
             wall=(11, 18), row=1, stone=WHITE, stone2=CREAM, wear=0.4, lean=0.013, yc=4.25, ent0="gothic", storeys=[
                 dict(h=3.85, n=2, w=1.25, win="cross", head="pointed", sill=0.95, tracery=True),
                 dict(h=3.45, n=2, w=1.2, win="cross", head="pointed", sill=0.9, tracery=True),
                 dict(h=3.2, n=2, w=1.1, win="cross", head="pointed", sill=0.85, tracery=True)],
             band="gothic", cornice="gothic",
             gable=dict(kind="step", steps=6, rise=1.0, top=0.95, pinnacles=True, copings=True,
                        gwins=[dict(y=0.6, h=1.6, n=2, w=0.85, win="cross", head="pointed"), dict(y=2.8, h=1.3, n=1, w=0.8, win="cross", head="pointed"),
                               dict(y=4.6, h=0.7, n=1, w=0.55, win="small")], finial="cross")),
    55: dict(name="Mannerist stepped gable in brick and stone, scrolls and obelisks", design="mannerist",
             wall=(3, 15), row=0, stone=CREAM, wear=0.3, lean=0.008, yc=4.25, ent0="plain", storeys=[
                 dict(h=3.75, n=2, w=1.3, win="cross", head="segment", sill=0.95, panels=True),
                 dict(h=3.4, n=2, w=1.25, win="cross", head="pediment", sill=0.9),
                 dict(h=3.15, n=2, w=1.2, win="cross", head="lintel", sill=0.85)],
             band="banded", cornice="medium",
             gable=dict(kind="step", steps=5, rise=1.15, top=1.0, scroll_steps=True, obelisks=True, copings=True,
                        gwins=[dict(y=0.6, h=1.6, n=2, w=0.9, win="cross", head="segment"), dict(y=2.9, h=1.3, n=1, w=0.85, win="cross"),
                               dict(y=4.75, h=0.75, n=1, w=0.6, win="small")], finial="ball_gilt")),
}

# the profiles of the bands and cornices: [(up, out)] from the wall's face, bottom to top, ending back at the face
PROFILES = {
    "plain": [(0, 0), (0, 0.06), (0.12, 0.06), (0.12, 0.12), (0.26, 0.12), (0.3, 0.2), (0.38, 0.2), (0.4, 0.0)],
    "doric": [(0, 0), (0, 0.04), (0.14, 0.04), (0.14, 0.07), (0.3, 0.07), (0.32, 0.03), (0.52, 0.03), (0.52, 0.1),
              (0.6, 0.16), (0.6, 0.3), (0.7, 0.3), (0.74, 0.34), (0.8, 0.34), (0.82, 0.0)],
    "gothic": [(0, 0), (0.0, 0.05), (0.08, 0.16), (0.2, 0.16), (0.24, 0.0)],
    "string": [(0, 0), (0, 0.05), (0.06, 0.1), (0.16, 0.1), (0.2, 0.0)],
    "small": [(0, 0), (0, 0.05), (0.1, 0.05), (0.18, 0.16), (0.24, 0.22), (0.3, 0.22), (0.32, 0.0)],
    "medium": [(0, 0), (0, 0.05), (0.12, 0.05), (0.12, 0.08), (0.26, 0.08), (0.3, 0.14), (0.36, 0.26), (0.44, 0.3), (0.5, 0.3), (0.52, 0.0)],
    "grand": [(0, 0), (0, 0.05), (0.13, 0.05), (0.13, 0.08), (0.28, 0.08), (0.3, 0.04), (0.56, 0.04), (0.58, 0.12),
              (0.64, 0.12), (0.7, 0.24), (0.7, 0.38), (0.82, 0.42), (0.88, 0.42), (0.9, 0.0)],
    # the band between two storeys of an order: architrave, frieze, a cornice
    "order": [(0, 0), (0, 0.04), (0.1, 0.04), (0.1, 0.06), (0.2, 0.06), (0.22, 0.03), (0.4, 0.03), (0.42, 0.1),
              (0.48, 0.16), (0.52, 0.2), (0.58, 0.2), (0.6, 0.0)],
    "band": [(0, 0), (0, 0.06), (0.14, 0.06), (0.16, 0.0)],
}


def set_constants(**kw):
    K.update(kw)


# ------------------------------------------------------------------ the frame and the primitives


def _clean(pts, eps=1e-5):
    out = []
    for p in pts:
        if not out or max(abs(a - b) for a, b in zip(p, out[-1])) > eps:
            out.append(p)
    if len(out) > 2 and max(abs(a - b) for a, b in zip(out[0], out[-1])) <= eps:
        out.pop()
    return out


def _bez(p0, p1, p2, p3, n):
    out = []
    for i in range(n + 1):
        t = i / n
        a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3
        out.append((a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0], a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1]))
    return out


def _area(poly):
    return sum(poly[i][0] * poly[(i + 1) % len(poly)][1] - poly[(i + 1) % len(poly)][0] * poly[i][1] for i in range(len(poly))) / 2


class Front:
    """One front, in its own frame: s along the wall from its first corner, y up, d out of the old wall line."""

    def __init__(self, b, h, a, bb, f, spec):
        self.b, self.h, self.spec = b, h, spec
        self.ax, self.az = a
        L = math.hypot(bb[0] - a[0], bb[1] - a[1])
        self.L = L
        self.ux, self.uz = (bb[0] - a[0]) / L, (bb[1] - a[1]) / L
        self.fx, self.fz = f[0], f[2]
        self.lean = spec.get("lean", 0.0)
        self.y_lean = spec["yc"] + 0.5  # (the ground cornice stands upright; the front leans over it)
        self.gh, self.sh = b.gh, b.sh
        self.row = spec.get("row", 1)
        self.stone = spec.get("stone", WHITE)
        self.stone2 = spec.get("stone2", self.stone)
        self.holes = []  # the openings through the face: dicts s0, s1, y0, y1
        self.windows = []  # for ambient.ts: [s_mid, y0, y1, width, out, storey, kind]
        self.storey_k = 0
        H, pitch = h["h"], math.radians(h["pitch"])
        self.H = H
        self.rise = min(L / 2 * math.tan(pitch), 9.0)

    # -------------------------------------------------- frame
    def W(self, s, y, d):
        dd = d + self.lean * max(0.0, y - self.y_lean)
        return (self.ax + self.ux * s + self.fx * dd, y, self.az + self.uz * s + self.fz * dd)

    def O(self, du, dy, dd):
        return (self.ux * du + self.fx * dd, dy, self.uz * du + self.fz * dd)

    def roof(self, s):
        """The roof's height over the front's plane at s (build_city.py rect_house: a front roof)."""
        return self.H + self.rise * max(0.0, 1 - abs(s - self.L / 2) / (self.L / 2))

    def tint(self, t):
        self.b.tint = t

    def q(self, pts, mat, uvs, cell, out, shade):
        pts = [tuple(p) for p in pts]
        if len(_clean(pts)) < 3:
            return None
        return self.b.face([self.W(*p) for p in pts], mat, uvs, cell, self.O(*out), shade)

    def sq(self, pts, out, shade=1.0, mat=None):
        """A stone face (s, y, d points), its uv in metres projected on its main plane."""
        mat = K["MAT_STONE"] if mat is None else mat
        BAY = K["BAY"]
        ax_ = max(range(3), key=lambda i: abs(out[i]))
        if ax_ == 2:
            uv = [(p[0] / BAY, p[1] / BAY) for p in pts]
        elif ax_ == 1:
            uv = [(p[0] / BAY, p[2] / BAY) for p in pts]
        else:
            uv = [(p[2] / BAY, p[1] / BAY) for p in pts]
        return self.q(pts, mat, uv, (0, 0), out, shade)

    def wq(self, pts, out, shade=0.95):
        """A wall face in the facade material: the plain wall cell, the house's wall picture."""
        BAY = K["BAY"]
        uv = [(p[0] / BAY, (p[1] - self.gh) / self.sh) for p in pts]
        return self.q(pts, K["MAT_FACADE"], uv, (K["PART_COL"]["blind"], self.row), out, shade)

    def box(self, s0, s1, y0, y1, d0, d1, shade=1.0, back=False, bottom=True, top=True, sides=True, mat=None, wall=False):
        f = self.wq if wall else (lambda pts, out, sh: self.sq(pts, out, sh, mat))
        f([(s0, y0, d1), (s1, y0, d1), (s1, y1, d1), (s0, y1, d1)], (0, 0, 1), shade)
        if top:
            f([(s0, y1, d0), (s1, y1, d0), (s1, y1, d1), (s0, y1, d1)], (0, 1, 0), shade * 1.06)
        if bottom:
            f([(s0, y0, d0), (s1, y0, d0), (s1, y0, d1), (s0, y0, d1)], (0, -1, 0), shade * 0.62)
        if sides:
            f([(s0, y0, d0), (s0, y0, d1), (s0, y1, d1), (s0, y1, d0)], (-1, 0, 0), shade * 0.82)
            f([(s1, y0, d0), (s1, y0, d1), (s1, y1, d1), (s1, y1, d0)], (1, 0, 0), shade * 0.82)
        if back:
            f([(s0, y0, d0), (s1, y0, d0), (s1, y1, d0), (s0, y1, d0)], (0, 0, -1), shade * 0.7)

    def moulding(self, s0, s1, y, prof, d0=FACE, shade=1.0, ends=True, scale=1.0):
        """A moulding along the front from s0 to s1: prof [(up, out)] from the face at d0, extruded."""
        pts = [(y + dy * scale, d0 + dd * scale) for dy, dd in prof]
        BAY = K["BAY"]
        v = 0.0
        for (ya, da), (yb, db) in zip(pts, pts[1:]):
            dy, dd = yb - ya, db - da
            ln = math.hypot(dy, dd)
            if ln < 1e-6:
                continue
            out = (0, -dd, dy)
            g = 1.06 if out[1] > 0.5 * ln else 0.6 if out[1] < -0.5 * ln else 0.95
            self.q([(s0, ya, da), (s1, ya, da), (s1, yb, db), (s0, yb, db)], K["MAT_STONE"],
                   [(s0 / BAY, v / BAY), (s1 / BAY, v / BAY), (s1 / BAY, (v + ln) / BAY), (s0 / BAY, (v + ln) / BAY)], (0, 0), out, shade * g)
            v += ln
        if ends:
            ring = [(y, d0)] + pts + [(pts[-1][0], d0)]
            ring = _clean(ring)
            if len(ring) >= 3:
                for se, sg in ((s0, -1), (s1, 1)):
                    self.sq([(se, yy, dd_) for yy, dd_ in ring], (sg, 0, 0), shade * 0.8)
        return pts[-1][0]

    def extrude(self, poly, d0, d1, shade=1.0, back=False, wall=False):
        """A flat shape [(s, y)] standing out of the front from d0 to d1: its face, its edges (and its back)."""
        poly = _clean(poly)
        if len(poly) < 3:
            return
        ccw = _area(poly) > 0
        f = self.wq if wall else (lambda pts, out, sh: self.sq(pts, out, sh))
        f([(s, y, d1) for s, y in poly], (0, 0, 1), shade)
        if back:
            f([(s, y, d0) for s, y in poly], (0, 0, -1), shade * 0.7)
        n = len(poly)
        for i in range(n):
            (sa, ya), (sb, yb) = poly[i], poly[(i + 1) % n]
            ds, dy = sb - sa, yb - ya
            if math.hypot(ds, dy) < 1e-6:
                continue
            nx, ny = (dy, -ds) if ccw else (-dy, ds)
            g = 1.05 if ny > 0.5 * math.hypot(nx, ny) else 0.62 if ny < -0.5 * math.hypot(nx, ny) else 0.82
            f([(sa, ya, d0), (sb, yb, d0), (sb, yb, d1), (sa, ya, d1)], (nx, ny, 0), shade * g)

    def lathe(self, sc, dc, prof, n=8, shade=1.0, phase=0.0, cap=True):
        """Turned about an upright axis at (sc, dc): prof [(y, r)] bottom to top."""
        BAY = K["BAY"]
        ang = [phase + 2 * math.pi * k / n for k in range(n)]
        for (ya, ra), (yb, rb) in zip(prof, prof[1:]):
            dy, dr = yb - ya, rb - ra
            if math.hypot(dy, dr) < 1e-6:
                continue
            for k in range(n):
                a0, a1 = ang[k], ang[(k + 1) % n]
                am = (a0 + a1) / 2 if k < n - 1 else (a0 + a1 + 2 * math.pi) / 2
                pts = [(sc + ra * math.cos(a0), ya, dc + ra * math.sin(a0)), (sc + ra * math.cos(a1), ya, dc + ra * math.sin(a1)),
                       (sc + rb * math.cos(a1), yb, dc + rb * math.sin(a1)), (sc + rb * math.cos(a0), yb, dc + rb * math.sin(a0))]
                out = (math.cos(am) * dy, -dr, math.sin(am) * dy)
                g = 1.0 + 0.12 * math.sin(am)  # (lit from the street side a little more)
                self.q(_clean(pts), K["MAT_STONE"], [(k / n, ya / BAY), ((k + 1) / n, ya / BAY), ((k + 1) / n, yb / BAY), (k / n, yb / BAY)][:len(_clean(pts))],
                       (0, 0), out, shade * g)
        if cap:
            for (y, r), sg in ((prof[0], -1), (prof[-1], 1)):
                if r > 1e-4:
                    self.sq([(sc + r * math.cos(a), y, dc + r * math.sin(a)) for a in ang], (0, sg, 0), shade * (1.05 if sg > 0 else 0.6))

    def ball(self, sc, y, dc, r, shade=1.0, n=10):
        prof = [(y - r * math.cos(math.pi * i / 6), r * math.sin(math.pi * i / 6)) for i in range(7)]
        self.lathe(sc, dc, prof, n, shade, cap=False)

    def rod(self, p0, p1, w, shade=1.0):
        self.b.rod(self.W(*p0), self.W(*p1), w, shade)

    # -------------------------------------------------- openings
    def window(self, s0, s1, y0, y1, kind="cross", head="lintel", sill=True, k=0, garret=False):
        """A window through the front: its hole, reveal and glass, its stone frame, mullion and transom, sill and head."""
        st = self.stone
        self.holes.append({"s0": s0, "s1": s1, "y0": y0, "y1": y1})
        R = R_WIN
        dg = FACE - R
        BAY = K["BAY"]
        w, hgt = s1 - s0, y1 - y0
        # the reveal: stone, in shadow
        self.tint(st)
        self.sq([(s0, y0, FACE), (s0, y0, dg), (s0, y1, dg), (s0, y1, FACE)], (1, 0, 0), 0.55)
        self.sq([(s1, y0, FACE), (s1, y0, dg), (s1, y1, dg), (s1, y1, FACE)], (-1, 0, 0), 0.5)
        self.sq([(s0, y1, FACE), (s1, y1, FACE), (s1, y1, dg), (s0, y1, dg)], (0, -1, 0), 0.4)
        self.sq([(s0, y0, FACE), (s1, y0, FACE), (s1, y0, dg), (s0, y0, dg)], (0, 1, 0), 0.75)
        lights = []
        if kind in ("cross", "cross3"):
            # mullion(s) and a transom of stone, 4 cm back from the face; four (six) lights of leaded glass
            nm = 2 if kind == "cross3" else 1
            mw = 0.11
            yt = y1 - hgt * 0.34
            cols = [s0 + w * (i + 1) / (nm + 1) for i in range(nm)]
            for c in cols:
                self.box(c - mw / 2, c + mw / 2, y0, y1, dg, FACE - 0.04, 0.9, bottom=False, top=False)
            self.box(s0, s1, yt - mw / 2, yt + mw / 2, dg, FACE - 0.04, 0.95, sides=False)
            edges = [s0] + [v for c in cols for v in (c - mw / 2, c + mw / 2)] + [s1]
            for i in range(0, len(edges), 2):
                a_, b_ = edges[i], edges[i + 1]
                lights.append((a_, b_, yt + mw / 2, y1, LEADED))
                lights.append((a_, b_, y0, yt - mw / 2, LEADED_SHUT if (int(abs(s0) * 10 + k) % 3 == 0) else LEADED))
        elif kind == "sash":
            cell = K["SASH"][int(abs(self.h["seed"]) + k) % 2]
            self.q([(s0, y0, dg), (s1, y0, dg), (s1, y1, dg), (s0, y1, dg)], K["MAT_FACADE"], [(0, 0), (1, 0), (1, 1), (0, 1)], cell, (0, 0, 1), 0.92)
        elif kind == "loading":
            self.q([(s0, y0, dg), (s1, y0, dg), (s1, y1, dg), (s0, y1, dg)], K["MAT_FACADE"], [(0, 0), (1, 0), (1, 1), (0, 1)], K["LOADING"], (0, 0, 1), 0.85)
        else:  # small: one light of leaded glass
            lights.append((s0, y0 + 0.0, s1, y1, LEADED) if False else (s0, s1, y0, y1, LEADED))
        for a_, b_, ya, yb, cell in lights:
            nu = max(1, round((b_ - a_) / 0.36))
            nv = max(1, round((yb - ya) / 0.42))
            self.q([(a_, ya, dg), (b_, ya, dg), (b_, yb, dg), (a_, yb, dg)], K["MAT_FACADE"], [(0, 0), (nu, 0), (nu, nv), (0, nv)], cell, (0, 0, 1), 0.95)
        # the stone frame round it (a flat surround, chamfered: two steps)
        fw = 0.09 if kind != "sash" else 0.11
        self.tint(st)
        for (pa, pb, ya, yb) in ((s0 - fw, s0, y0, y1), (s1, s1 + fw, y0, y1)):
            self.box(pa, pb, ya, yb, FACE, FACE + 0.05, 1.0, bottom=False, top=False)
        self.box(s0 - fw, s1 + fw, y1, y1 + fw, FACE, FACE + 0.05, 1.0, bottom=True, top=False)
        if sill:
            self.box(s0 - fw - 0.06, s1 + fw + 0.06, y0 - 0.12, y0, FACE, FACE + 0.13, 0.95)
        else:
            self.box(s0 - fw, s1 + fw, y0 - fw, y0, FACE, FACE + 0.05, 1.0, top=True)
        self.head(s0 - fw, s1 + fw, y1 + fw, head)
        # its pane at night: just before the glass, as wide as the window, ambient.ts lights it
        ym = (y0 + y1) / 2
        out = dg + self.lean * max(0.0, ym - self.y_lean) + 0.03
        self.windows.append([round((s0 + s1) / 2, 3), round(y0 + 0.02, 3), round(y1 - 0.02, 3), round(w - 0.02, 3), round(out, 3), k, 2 if garret else 0])

    def head(self, s0, s1, y, kind):
        """What stands over a window: a pediment, a segmental one, a shell in a lunette, a relieving arch, a
        pointed arch, a keystone, a hood, a plain lintel; ears on the frame (the 18th century)."""
        st = self.stone
        self.tint(st)
        w = s1 - s0
        sc = (s0 + s1) / 2
        if kind == "pediment":
            self.box(s0 - 0.04, s1 + 0.04, y, y + 0.1, FACE, FACE + 0.12, 1.0)
            hp = min(0.45, w * 0.28)
            for sg in (-1, 1):
                a = (sc + sg * (w / 2 + 0.06), y + 0.1)
                bpt = (sc, y + 0.1 + hp)
                pts = [(a[0], a[1]), (a[0] - sg * 0.0, a[1] + 0.1), (bpt[0], bpt[1] + 0.1), (bpt[0], bpt[1])]
                pts = [(p[0], p[1]) for p in pts]
                poly = pts if sg < 0 else list(reversed(pts))
                self.extrude(poly, FACE, FACE + 0.12, 1.0)
            self.extrude([(sc - w / 2 + 0.02, y + 0.1), (sc + w / 2 - 0.02, y + 0.1), (sc, y + 0.1 + hp - 0.04)], FACE, FACE + 0.05, 0.92)
        elif kind == "segment":
            self.box(s0 - 0.04, s1 + 0.04, y, y + 0.1, FACE, FACE + 0.12, 1.0)
            n = 8
            hp = min(0.32, w * 0.2)
            outer = [(sc + (w / 2 + 0.06) * math.cos(math.pi * i / n), y + 0.1 + (hp + 0.1) * math.sin(math.pi * i / n)) for i in range(n + 1)]
            inner = [(sc + (w / 2 - 0.06) * math.cos(math.pi * i / n), y + 0.1 + hp * 0.7 * math.sin(math.pi * i / n)) for i in range(n + 1)]
            for i in range(n):
                self.extrude([inner[i], outer[i], outer[i + 1], inner[i + 1]][::-1] if True else [], FACE, FACE + 0.12, 1.0)
            self.extrude([(inner[n][0], y + 0.1)] + inner[n::-1][:0] + list(reversed(inner)) + [(inner[0][0], y + 0.1)][:0], FACE, FACE + 0.04, 0.9)
        elif kind == "shell":
            # a lunette over the window with a carved shell in it
            n = 9
            r = w / 2
            ring_o = [(sc + (r + 0.07) * math.cos(math.pi * i / n), y + (r + 0.07) * math.sin(math.pi * i / n)) for i in range(n + 1)]
            ring_i = [(sc + r * math.cos(math.pi * i / n), y + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
            for i in range(n):
                self.extrude([ring_i[i], ring_o[i], ring_o[i + 1], ring_i[i + 1]], FACE, FACE + 0.1, 1.0)
            for i in range(n):
                a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
                am = (a0 + a1) / 2
                rr = r * 0.88
                self.extrude([(sc, y + 0.04), (sc + rr * math.cos(a0 + 0.03), y + rr * math.sin(a0 + 0.03)),
                              (sc + rr * 1.02 * math.cos(am), y + rr * 1.02 * math.sin(am)), (sc + rr * math.cos(a1 - 0.03), y + rr * math.sin(a1 - 0.03))][::-1],
                             FACE, FACE + 0.02 + 0.03 * math.sin(am), 0.9 + 0.1 * (i % 2))
        elif kind == "arch":
            # a relieving arch of stone and the brick tympanum under it (the wall itself)
            n = 8
            r = w / 2
            for i in range(n):
                a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
                self.extrude([(sc + r * math.cos(a0), y + r * 0.62 * math.sin(a0)), (sc + (r + 0.13) * math.cos(a0), y + (r * 0.62 + 0.13) * math.sin(a0)),
                              (sc + (r + 0.13) * math.cos(a1), y + (r * 0.62 + 0.13) * math.sin(a1)), (sc + r * math.cos(a1), y + r * 0.62 * math.sin(a1))][::-1],
                             FACE, FACE + 0.035, 0.92 + 0.12 * (i % 2))
        elif kind == "pointed":
            # a pointed arch over the window, its tympanum with a trefoil of tracery
            n = 6
            r = w * 0.62
            hgt = w * 0.55
            left = [(s0 + (1 - math.cos(math.pi / 2 * i / n)) * 0 + (sc - s0) * math.sin(math.pi / 2 * i / n), y + hgt * (1 - math.cos(math.pi / 2 * i / n))) for i in range(n + 1)]
            left = [(s0 + (sc - s0) * (1 - math.cos(math.pi / 2 * i / n)), y + hgt * math.sin(math.pi / 2 * i / n)) for i in range(n + 1)]
            right = [(s1 - (s, yv)[0] + s0, yv) for s, yv in left]
            for seq in (left, right):
                for i in range(n):
                    (sa, ya), (sb, yb) = seq[i], seq[i + 1]
                    nx_, ny_ = yb - ya, -(sb - sa)
                    ln = math.hypot(nx_, ny_) or 1
                    ox, oy = -nx_ / ln * 0.11, -ny_ / ln * 0.11
                    if seq is right:
                        ox, oy = -ox, -oy
                    poly = [(sa, ya), (sb, yb), (sb + ox, yb + oy), (sa + ox, ya + oy)]
                    if _area(poly) < 0:
                        poly = poly[::-1]
                    self.extrude(poly, FACE, FACE + 0.06, 1.0)
            # the trefoil: three small rings in the tympanum
            for (cx_, cy_, rr) in ((sc, y + hgt * 0.5, w * 0.12), (sc - w * 0.16, y + hgt * 0.24, w * 0.09), (sc + w * 0.16, y + hgt * 0.24, w * 0.09)):
                self.ring(cx_, cy_, rr, 0.035, FACE, FACE + 0.04, 8)
        elif kind == "key":
            self.box(s0, s1, y, y + 0.12, FACE, FACE + 0.08, 1.0)
            self.extrude([(sc - 0.09, y - 0.08), (sc + 0.09, y - 0.08), (sc + 0.13, y + 0.26), (sc - 0.13, y + 0.26)], FACE, FACE + 0.13, 1.05)
        elif kind == "hood":
            self.box(s0, s1, y, y + 0.16, FACE, FACE + 0.07, 0.95)
            self.box(s0 - 0.06, s1 + 0.06, y + 0.16, y + 0.27, FACE, FACE + 0.17, 1.05)
        elif kind == "ears":
            # the frame's ears (crossettes) and a keystone, as the 18th century made them
            for sg in (-1, 1):
                e = s0 if sg < 0 else s1
                self.box(e - 0.12 if sg < 0 else e, e if sg < 0 else e + 0.12, y - 0.24, y, FACE, FACE + 0.05, 1.0, top=False)
            self.box(s0 - 0.12, s1 + 0.12, y, y + 0.1, FACE, FACE + 0.08, 1.0)
            self.extrude([(sc - 0.08, y - 0.12), (sc + 0.08, y - 0.12), (sc + 0.12, y + 0.24), (sc - 0.12, y + 0.24)], FACE, FACE + 0.12, 1.05)
        else:  # lintel
            self.box(s0, s1, y, y + 0.14, FACE, FACE + 0.07, 1.0)

    def ring(self, sc, yc, r, t, d0, d1, n=10, shade=1.0):
        """A ring of stone on the front (a roundel, a trefoil's foil)."""
        for i in range(n):
            a0, a1 = 2 * math.pi * i / n, 2 * math.pi * (i + 1) / n
            self.extrude([(sc + r * math.cos(a0), yc + r * math.sin(a0)), (sc + (r + t) * math.cos(a0), yc + (r + t) * math.sin(a0)),
                          (sc + (r + t) * math.cos(a1), yc + (r + t) * math.sin(a1)), (sc + r * math.cos(a1), yc + r * math.sin(a1))][::-1],
                         d0, d1, shade)

    def oculus(self, sc, yc, r):
        """A round window: a square hole, its corners filled to a circle, a round reveal, glass, a moulded ring."""
        self.holes.append({"s0": sc - r, "s1": sc + r, "y0": yc - r, "y1": yc + r})
        n = 16
        dg = FACE - R_WIN
        circ = [(sc + r * math.cos(2 * math.pi * i / n), yc + r * math.sin(2 * math.pi * i / n)) for i in range(n)]
        # the corners between the square hole and the circle, in the wall
        corners = [(sc + r, yc + r), (sc - r, yc + r), (sc - r, yc - r), (sc + r, yc - r)]
        for q_ in range(4):
            arc = [circ[(q_ * 4 + i) % n] for i in range(5)]
            self.wq([(s, y, FACE) for s, y in [corners[q_]] + arc[::-1]], (0, 0, 1))
        self.tint(self.stone)
        for i in range(n):
            (sa, ya), (sb, yb) = circ[i], circ[(i + 1) % n]
            self.sq([(sa, ya, FACE), (sb, yb, FACE), (sb, yb, dg), (sa, ya, dg)], (sc - (sa + sb) / 2, yc - (ya + yb) / 2, 0), 0.55)
        self.q([(s, y, dg) for s, y in circ], K["MAT_FACADE"], [((s - sc + r) / 0.36, (y - yc + r) / 0.42) for s, y in circ], LEADED, (0, 0, 1), 0.95)
        self.ring(sc, yc, r, 0.12, FACE, FACE + 0.08, n)
        # (four keystones round it)
        for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
            cx_, cy_ = sc + (r + 0.06) * math.cos(a), yc + (r + 0.06) * math.sin(a)
            self.box(cx_ - 0.07, cx_ + 0.07, cy_ - 0.07, cy_ + 0.07, FACE + 0.02, FACE + 0.12, 1.05)
        self.windows.append([round(sc, 3), round(yc - r * 0.7, 3), round(yc + r * 0.7, 3), round(r * 1.4, 3),
                             round(dg + self.lean * max(0.0, yc - self.y_lean) + 0.03, 3), 90, 2])

    # -------------------------------------------------- the parts of a storey
    def pilaster(self, s0, s1, y0, y1, order, p=0.09):
        """A pilaster from y0 to y1: its base, shaft and capital, by its order."""
        self.tint(self.stone2 if order == "rustic" else self.stone)
        hb = 0.22
        self.box(s0 - 0.04, s1 + 0.04, y0, y0 + hb * 0.55, FACE, FACE + p + 0.05, 0.95, bottom=False)
        self.box(s0 - 0.02, s1 + 0.02, y0 + hb * 0.55, y0 + hb, FACE, FACE + p + 0.025, 1.0, bottom=False)
        cap = {"doric": 0.22, "ionic": 0.26, "corinth": 0.42, "rustic": 0.18}.get(order, 0.2)
        ys0, ys1 = y0 + hb, y1 - cap
        if order == "rustic":
            # banded: smooth and rusticated blocks in turn
            k = 0
            yy = ys0
            while yy < ys1 - 0.05:
                hh = min(0.32, ys1 - yy)
                big = k % 2 == 0
                self.box(s0 - (0.03 if big else 0), s1 + (0.03 if big else 0), yy, yy + hh - 0.015, FACE, FACE + p + (0.03 if big else 0), 0.96 if big else 1.0)
                yy += hh
                k += 1
        else:
            self.box(s0, s1, ys0, ys1, FACE, FACE + p, 1.0, bottom=False, top=False)
            if order in ("ionic", "corinth") and s1 - s0 > 0.3:
                # flutes: two grooves' shadow lines, as strips just proud
                for f_ in (0.33, 0.67):
                    c = s0 + (s1 - s0) * f_
                    self.box(c - 0.012, c + 0.012, ys0 + 0.15, ys1 - 0.12, FACE + p, FACE + p + 0.008, 0.62, bottom=False, top=False)
        if order == "doric" or order == "rustic":
            self.box(s0 - 0.02, s1 + 0.02, ys1, ys1 + 0.08, FACE, FACE + p + 0.03, 1.0)
            self.box(s0 - 0.05, s1 + 0.05, ys1 + 0.08, y1, FACE, FACE + p + 0.06, 1.05)
        elif order == "ionic":
            self.box(s0 - 0.03, s1 + 0.03, ys1, ys1 + 0.16, FACE, FACE + p + 0.03, 1.0)
            for sg, e in ((-1, s0), (1, s1)):
                self.ring(e + sg * -0.02, ys1 + 0.1, 0.035, 0.035, FACE + p + 0.02, FACE + p + 0.06, 8, 1.05)
            self.box(s0 - 0.06, s1 + 0.06, ys1 + 0.16, y1, FACE, FACE + p + 0.06, 1.05)
        else:  # corinthian: a bell of leaves, an abacus
            yb = ys1
            for i in range(3):
                ya_, yb_ = yb + 0.11 * i, yb + 0.11 * (i + 1)
                g = 0.03 * (i + 1)
                self.box(s0 - g, s1 + g, ya_, yb_, FACE, FACE + p + g, 0.92 + 0.06 * (i % 2), bottom=(i == 0))
            self.box(s0 - 0.11, s1 + 0.11, yb + 0.33, y1, FACE, FACE + p + 0.11, 1.06)

    def panel(self, s0, s1, y0, y1, kind="field"):
        """A carved panel under a window: a frame, a raised field, and a lozenge or a cartouche on it."""
        self.tint(self.stone)
        t = 0.06
        self.box(s0, s1, y0, y0 + t, FACE, FACE + 0.035, 0.95, bottom=False)
        self.box(s0, s1, y1 - t, y1, FACE, FACE + 0.035, 1.0, bottom=True, top=True)
        self.box(s0, s0 + t, y0 + t, y1 - t, FACE, FACE + 0.035, 0.95, bottom=False, top=False)
        self.box(s1 - t, s1, y0 + t, y1 - t, FACE, FACE + 0.035, 0.95, bottom=False, top=False)
        cx_, cy_ = (s0 + s1) / 2, (y0 + y1) / 2
        hw, hh = (s1 - s0) / 2 - t - 0.04, (y1 - y0) / 2 - t - 0.04
        if hw < 0.08 or hh < 0.05:
            return
        if kind == "cartouche":
            n = 12
            self.extrude([(cx_ + hw * 0.8 * math.cos(2 * math.pi * i / n), cy_ + hh * 0.9 * math.sin(2 * math.pi * i / n)) for i in range(n)], FACE, FACE + 0.05, 1.05)
            self.extrude([(cx_ + hw * 0.5 * math.cos(2 * math.pi * i / n), cy_ + hh * 0.55 * math.sin(2 * math.pi * i / n)) for i in range(n)], FACE + 0.05, FACE + 0.07, 0.95)
        else:
            self.extrude([(cx_, cy_ - hh), (cx_ + hw, cy_), (cx_, cy_ + hh), (cx_ - hw, cy_)], FACE, FACE + 0.045, 1.05)

    def festoon(self, s0, s1, y, drop):
        """A carved garland hanging between two points, with drops at its ends."""
        self.tint(self.stone)
        n = 8
        pts = [(s0 + (s1 - s0) * i / n, y - drop * math.sin(math.pi * i / n)) for i in range(n + 1)]
        for i in range(n):
            (sa, ya), (sb, yb) = pts[i], pts[i + 1]
            th = 0.07 + 0.04 * math.sin(math.pi * (i + 0.5) / n)
            self.extrude([(sa, ya - th), (sb, yb - th), (sb, yb + th * 0.5), (sa, ya + th * 0.5)], FACE, FACE + 0.06 + 0.02 * (i % 2), 0.95 + 0.08 * (i % 2))
        for e in (s0, s1):
            self.extrude([(e - 0.04, y), (e + 0.04, y), (e + 0.025, y - 0.32), (e - 0.025, y - 0.32)], FACE, FACE + 0.05, 1.0)

    def anchor(self, s, y):
        """A wall anchor, the end of an iron tie to a floor beam: an S of iron."""
        self.tint(IRON)
        self.box(s - 0.025, s + 0.025, y - 0.32, y + 0.32, FACE, FACE + 0.035, 0.3, bottom=False, top=False)
        self.box(s - 0.06, s + 0.06, y - 0.05, y + 0.05, FACE, FACE + 0.06, 0.4)

    # -------------------------------------------------- ornaments on the gable
    def obelisk(self, sc, y, hgt=1.0, dc=None, shade=1.0):
        dc = FACE * 0.5 if dc is None else dc
        b_ = 0.16 * hgt / 1.0
        self.tint(self.stone)
        self.lathe(sc, dc, [(y, b_ * 1.25), (y + 0.16 * hgt, b_ * 1.25), (y + 0.16 * hgt, b_), (y + hgt * 0.88, b_ * 0.35), (y + hgt * 0.88, 0.0)], 4, shade, math.pi / 4)
        self.ball(sc, y + hgt * 0.88 + 0.06 * hgt, dc, 0.06 * hgt, shade)

    def vase(self, sc, y, hgt=0.7, dc=None, gilt=False):
        dc = FACE * 0.5 if dc is None else dc
        k = hgt / 0.7
        self.tint(GILT if gilt else self.stone)
        self.lathe(sc, dc, [(y, 0.12 * k), (y + 0.06 * k, 0.12 * k), (y + 0.1 * k, 0.06 * k), (y + 0.16 * k, 0.07 * k), (y + 0.3 * k, 0.16 * k),
                            (y + 0.44 * k, 0.15 * k), (y + 0.52 * k, 0.09 * k), (y + 0.56 * k, 0.11 * k), (y + 0.6 * k, 0.05 * k), (y + 0.7 * k, 0.0)], 8, 1.0)

    def pinnacle(self, sc, y, hgt=1.4, dc=None):
        """A Gothic pinnacle: an octagonal shaft, a gablet ring, a spire with crockets, a finial."""
        dc = FACE * 0.5 if dc is None else dc
        r = 0.09 * hgt / 1.4 + 0.03
        self.tint(self.stone)
        self.lathe(sc, dc, [(y, r * 1.2), (y + 0.1, r * 1.2), (y + 0.1, r), (y + hgt * 0.42, r), (y + hgt * 0.42, r * 1.25), (y + hgt * 0.48, r * 1.25),
                            (y + hgt * 0.92, r * 0.18), (y + hgt * 0.92, 0.0)], 8, 1.0, math.pi / 8)
        for i in range(4):
            yy = y + hgt * (0.55 + 0.09 * i)
            rr = r * 1.25 * (1 - (yy - y - hgt * 0.48) / (hgt * 0.44)) + 0.05
            for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
                cs, cd = sc + rr * math.cos(a), dc + rr * math.sin(a)
                self.box(cs - 0.025, cs + 0.025, yy, yy + 0.06, cd - 0.025, cd + 0.025, 1.05)
        self.ball(sc, y + hgt * 0.92 + 0.05, dc, 0.05)

    def scroll(self, sa, ya, sb, yb, side, t=0.24, big=False):
        """A scroll (a volute, a claw piece) filling the step from the outer corner (sa, ya) up to the tier's side at
        (sb, yb): an S-curve rising from a curl, its edge banded, standing in the front's plane. side -1 left, 1 right."""
        hgt = yb - ya
        wd = abs(sb - sa)
        er = min(hgt * 0.2, wd * 0.28, 0.42 if big else 0.3)
        # the eye of the curl sits low at the outer end
        ex, ey = sa - side * -er, ya + er
        ex = sa + (er if side < 0 else -er)
        curve = _bez((sa, ya + er), (sa, ya + hgt * (0.62 if big else 0.5)), (sb, yb - hgt * (0.55 if big else 0.42)), (sb, yb), 10)
        poly = [(sb, ya)] + [(ex, ya)] + curve[::-1][::-1]
        poly = [(sb, ya), (ex, ya)] + [(sa + (ex - sa) * (1 - math.cos(a)) if False else ex + (sa - ex) * math.cos(a) * 0 + (sa - ex) * math.sin(a), ya + er - er * math.cos(a)) for a in [math.pi * i / 8 for i in range(1, 5)]] + curve[1:]
        if _area(poly) < 0:
            poly = poly[::-1]
        self.tint(self.stone)
        self.extrude(poly, BACK, FACE + 0.02, 1.0, back=True)
        # the banded edge along the curve
        for (pa, pb) in zip(curve, curve[1:]):
            nx_, ny_ = pb[1] - pa[1], -(pb[0] - pa[0])
            ln = math.hypot(nx_, ny_) or 1
            if side > 0:
                nx_, ny_ = -nx_, -ny_
            ox, oy = -nx_ / ln * 0.06, -ny_ / ln * 0.06
            band = [pa, pb, (pb[0] + ox, pb[1] + oy), (pa[0] + ox, pa[1] + oy)]
            if _area(band) < 0:
                band = band[::-1]
            self.extrude(band, FACE + 0.02, FACE + 0.07, 1.06)
        # the curl: a disc with its eye
        self.lathe_disc(ex, ey, er, FACE + 0.02, FACE + 0.1)
        self.lathe_disc(ex, ey, er * 0.4, FACE + 0.1, FACE + 0.14, 0.95)

    def lathe_disc(self, sc, yc, r, d0, d1, shade=1.0, n=12):
        """A disc standing out of the front (its axis along d)."""
        self.extrude([(sc + r * math.cos(2 * math.pi * i / n), yc + r * math.sin(2 * math.pi * i / n)) for i in range(n)], d0, d1, shade)

    def statue(self, kind, sc, y, dc=None, k=1.0):
        """A gilt figure on the top of the gable (or in its niche), about 1.6 m tall at k = 1: an angel blowing a
        trumpet, St George with his lance and shield, a saint (the Virgin with the child), a spread eagle."""
        dc = FACE * 0.55 if dc is None else dc
        self.tint(GILT)
        g = 1.25
        L_ = lambda prof, n=10: self.lathe(sc, dc, [(y + a * k, r * k) for a, r in prof], n, g)  # noqa: E731
        if kind == "eagle":
            self.ball(sc, y + 0.18 * k, dc, 0.18 * k, g)
            L_([(0.3, 0.0), (0.34, 0.14), (0.6, 0.17), (0.9, 0.12), (1.02, 0.06), (1.05, 0.0)])
            self.ball(sc, y + 1.1 * k, dc + 0.03, 0.09 * k, g)
            self.box(sc - 0.025 * k, sc + 0.025 * k, y + 1.06 * k, y + 1.12 * k, dc + 0.06, dc + 0.18 * k, g)
            for sg in (-1, 1):
                wing = [(sc + sg * 0.1 * k, y + 0.55 * k), (sc + sg * 0.55 * k, y + 1.25 * k), (sc + sg * 0.78 * k, y + 1.5 * k), (sc + sg * 0.82 * k, y + 1.2 * k),
                        (sc + sg * 0.7 * k, y + 0.95 * k), (sc + sg * 0.72 * k, y + 0.75 * k), (sc + sg * 0.5 * k, y + 0.62 * k), (sc + sg * 0.14 * k, y + 0.42 * k)]
                if _area(wing) < 0:
                    wing = wing[::-1]
                self.extrude(wing, dc - 0.04, dc + 0.02, g, back=True)
            return
        # a pedestal ball for the standing figures on a top, then the robe, the body, the head
        L_([(0.0, 0.2), (0.08, 0.22), (0.14, 0.17), (0.6, 0.15), (0.95, 0.12), (1.12, 0.15), (1.22, 0.13), (1.3, 0.06), (1.31, 0.0)])
        self.ball(sc, y + 1.4 * k, dc, 0.1 * k, g)
        if kind == "angel":
            for sg in (-1, 1):
                wing = [(sc + sg * 0.08 * k, y + 1.18 * k), (sc + sg * 0.32 * k, y + 1.58 * k), (sc + sg * 0.5 * k, y + 1.82 * k), (sc + sg * 0.56 * k, y + 1.6 * k),
                        (sc + sg * 0.5 * k, y + 1.25 * k), (sc + sg * 0.42 * k, y + 0.95 * k), (sc + sg * 0.3 * k, y + 0.7 * k), (sc + sg * 0.14 * k, y + 0.92 * k)]
                if _area(wing) < 0:
                    wing = wing[::-1]
                self.extrude(wing, dc - 0.14 * k, dc - 0.08 * k, g, back=True)
            # the raised arm and the trumpet
            self.rod((sc + 0.12 * k, y + 1.22 * k, dc), (sc + 0.22 * k, y + 1.42 * k, dc + 0.16 * k), 0.06 * k, g)
            self.rod((sc + 0.2 * k, y + 1.42 * k, dc + 0.16 * k), (sc + 0.05 * k, y + 1.47 * k, dc + 0.62 * k), 0.035 * k, g)
            self.box(sc + 0.0 * k, sc + 0.1 * k, y + 1.42 * k, y + 1.52 * k, dc + 0.6 * k, dc + 0.66 * k, g)
            self.rod((sc - 0.12 * k, y + 1.2 * k, dc), (sc - 0.2 * k, y + 0.9 * k, dc + 0.08 * k), 0.06 * k, g)
        elif kind == "knight":
            # a helmet's plume, the lance held upright, the shield before him
            self.box(sc - 0.02 * k, sc + 0.02 * k, y + 1.48 * k, y + 1.62 * k, dc - 0.05 * k, dc + 0.05 * k, g)
            self.rod((sc + 0.22 * k, y + 0.1 * k, dc + 0.05 * k), (sc + 0.3 * k, y + 2.1 * k, dc + 0.12 * k), 0.04 * k, g)
            self.box(sc + 0.27 * k, sc + 0.33 * k, y + 2.1 * k, y + 2.3 * k, dc + 0.09 * k, dc + 0.15 * k, g)
            self.rod((sc + 0.14 * k, y + 1.18 * k, dc), (sc + 0.27 * k, y + 1.0 * k, dc + 0.08 * k), 0.06 * k, g)
            shield = [(sc - 0.34 * k, y + 1.15 * k), (sc - 0.08 * k, y + 1.15 * k), (sc - 0.08 * k, y + 0.85 * k), (sc - 0.21 * k, y + 0.6 * k), (sc - 0.34 * k, y + 0.85 * k)]
            self.extrude(shield, dc + 0.14 * k, dc + 0.19 * k, g, back=True)
            # the dragon under his feet: a coiled tail
            for i in range(6):
                a0 = math.pi * 2 * i / 6
                self.ball(sc + 0.24 * k * math.cos(a0), y + 0.08 * k, dc + 0.22 * k * math.sin(a0), 0.06 * k, g, 6)
        elif kind == "saint":
            # a halo behind the head, the child on her arm
            self.ring(sc, y + 1.43 * k, 0.15 * k, 0.03 * k, dc - 0.1 * k, dc - 0.07 * k, 12, g)
            self.ball(sc + 0.12 * k, y + 1.08 * k, dc + 0.12 * k, 0.1 * k, g)
            self.ball(sc + 0.13 * k, y + 1.22 * k, dc + 0.13 * k, 0.06 * k, g)
            self.rod((sc - 0.12 * k, y + 1.2 * k, dc), (sc + 0.08 * k, y + 1.0 * k, dc + 0.16 * k), 0.06 * k, g)

    def finial(self, kind, sc, y):
        if kind == "ball_gilt":
            self.tint(self.stone)
            self.box(sc - 0.16, sc + 0.16, y, y + 0.22, BACK, FACE + 0.04, 1.0)
            self.tint(GILT)
            self.ball(sc, y + 0.42, FACE * 0.55, 0.2, 1.25)
            self.rod((sc, y + 0.6, FACE * 0.55), (sc, y + 1.1, FACE * 0.55), 0.04, 1.25)
        elif kind == "ball":
            self.tint(self.stone)
            self.box(sc - 0.16, sc + 0.16, y, y + 0.2, BACK, FACE + 0.04, 1.0)
            self.ball(sc, y + 0.4, FACE * 0.55, 0.2, 1.0)
        elif kind == "vase":
            self.tint(self.stone)
            self.box(sc - 0.18, sc + 0.18, y, y + 0.18, BACK, FACE + 0.04, 1.0)
            self.vase(sc, y + 0.18, 0.8)
        elif kind == "cross":
            self.tint(IRON)
            self.rod((sc, y, FACE * 0.55), (sc, y + 1.3, FACE * 0.55), 0.05, 0.35)
            self.rod((sc - 0.3, y + 0.95, FACE * 0.55), (sc + 0.3, y + 0.95, FACE * 0.55), 0.045, 0.35)
        elif kind == "vane":
            self.tint(IRON)
            self.rod((sc, y, FACE * 0.55), (sc, y + 1.4, FACE * 0.55), 0.045, 0.35)
            self.tint(GILT)
            self.ball(sc, y + 0.7, FACE * 0.55, 0.08, 1.2, 8)
            self.extrude([(sc, y + 1.08), (sc + 0.62, y + 1.12), (sc + 0.72, y + 1.26), (sc + 0.5, y + 1.22), (sc, y + 1.26)], FACE * 0.55 - 0.012, FACE * 0.55 + 0.012, 1.2, back=True)

    # -------------------------------------------------- the whole front
    def outline_top(self, outline):
        """top(s): the outline's height at s (strictly inside a span; outline [(s, y)] from s 0 to s L)."""
        def top(s):
            best = None
            for (sa, ya), (sb, yb) in zip(outline, outline[1:]):
                if sb - sa > 1e-7 and sa - 1e-9 <= s <= sb + 1e-9:
                    y = ya + (yb - ya) * (s - sa) / (sb - sa)
                    best = y if best is None else min(best, y)
            return best
        return top

    def wall_face(self, outline, y_base):
        """The front's face from y_base up to its outline, every opening left out: a grid split at the openings'
        edges and the outline's corners, each column clipped to the outline over it."""
        top = self.outline_top(outline)
        xs = sorted({0.0, self.L, *[s for s, _ in outline if 0 < s < self.L], *[v for o in self.holes for v in (o["s0"], o["s1"])]})
        ys = sorted({y_base, *[v for o in self.holes for v in (o["y0"], o["y1"])]})
        for xa, xb in zip(xs, xs[1:]):
            if xb - xa < 1e-5:
                continue
            fa, fb = top(xa + 1e-6), top(xb - 1e-6)
            if fa is None or fb is None:
                continue
            ftop = max(fa, fb)
            sm = (xa + xb) / 2
            here = [o for o in self.holes if o["s0"] < sm < o["s1"]]
            col = [y for y in ys if y < ftop - 1e-6] + [ftop]
            for ya, yb in zip(col, col[1:]):
                ym = (ya + yb) / 2
                if any(o["y0"] < ym < o["y1"] for o in here):
                    continue
                poly = [(xa, ya), (xb, ya), (xb, yb), (xa, yb)]

                def g(p):
                    return p[1] - (fa + (fb - fa) * (p[0] - xa) / (xb - xa))
                clipped = []
                for p, q_ in zip(poly, poly[1:] + poly[:1]):
                    gp, gq = g(p), g(q_)
                    if gp <= 1e-9:
                        clipped.append(p)
                    if (gp < -1e-9 < gq) or (gq < -1e-9 < gp):
                        t = gp / (gp - gq)
                        clipped.append((p[0] + (q_[0] - p[0]) * t, p[1] + (q_[1] - p[1]) * t))
                clipped = _clean(clipped)
                if len(clipped) >= 3:
                    self.wq([(s, y, FACE) for s, y in clipped], (0, 0, 1), 0.95)

    def slab_edges(self, outline, y_base):
        """Close the slab: its ends, its top along the outline (a coping where it is level), its back."""
        top = self.outline_top(outline)
        # the ends, from the foot to the outline (5 mm in: a neighbour's end never lies in the same plane)
        for s, sg in ((END_IN, -1), (self.L - END_IN, 1)):
            yt = outline[0][1] if sg < 0 else outline[-1][1]
            self.wq([(s, y_base, BACK), (s, y_base, FACE), (s, yt, FACE), (s, yt, BACK)], (sg, 0, 0), 0.8)
        for (sa, ya), (sb, yb) in zip(outline, outline[1:]):
            ds, dy = sb - sa, yb - ya
            if math.hypot(ds, dy) < 1e-6:
                continue
            nx_, ny_ = -dy, ds
            self.wq([(sa, ya, BACK), (sb, yb, BACK), (sb, yb, FACE), (sa, ya, FACE)], (nx_, ny_, 0), 1.0 if ny_ > 0 else 0.85)
        back = [(0.0, y_base)] + list(outline[1:-1]) + [(self.L, y_base)]
        back = [(END_IN, y_base), (END_IN, outline[0][1])] + list(outline[1:-1]) + [(self.L - END_IN, outline[-1][1]), (self.L - END_IN, y_base)]
        self.wq([(s, y, BACK) for s, y in _clean(back)], (0, 0, -1), 0.7)
        del top

    def windows_row(self, y0, y1, n, w, kind, head, k, sill=True, garret=False, span=None):
        """n windows of width w between y0 and y1, evenly spaced over the span (s0, s1); their middles."""
        s0, s1 = span or (0.0, self.L)
        mids = [s0 + (s1 - s0) * (i + 0.5) / n for i in range(n)]
        for m in mids:
            self.window(m - w / 2, m + w / 2, y0, y1, kind, head, sill, k, garret)
        return mids


def build(b, h, a, bb, f, spec):
    """Build the front of house h (index h["_i"]) from a to bb (its wall 0 over the ground storey), outward f.
    Returns its record for shared/city_guild_fronts.json."""
    fr = Front(b, h, a, bb, f, spec)
    L = fr.L
    keep_tint, keep_wear, keep_mat = b.tint, b.wear, b.wallmat
    ground_mat = b.wallmat
    b.wear = spec.get("wear", 0.25)
    # the frieze over the ground storey (the shop boards' band) in the ground storey's wall, flat in its plane
    yc = spec["yc"]
    fr.wq([(0.0, b.gh, 0.0), (L, b.gh, 0.0), (L, yc + 0.03, 0.0), (0.0, yc + 0.03, 0.0)], (0, 0, 1), 0.92)
    b.wallmat = spec["wall"]
    # the ground cornice, from the old wall line out over the new face
    fr.tint(fr.stone2 if spec.get("ent0") == "gothic" else fr.stone)
    prof0 = [(0, 0), (0, FACE + 0.04)] + [(dy, FACE + dd) for dy, dd in PROFILES[spec.get("ent0", "plain")][1:-1]] + [(PROFILES[spec.get("ent0", "plain")][-1][0], FACE - 0.001)]
    y = fr.moulding(0.004, L - 0.004, yc, prof0, 0.0, 1.0)
    y_face0 = y - 0.01
    # the storeys
    nst = len(spec["storeys"])
    pil_w = 0.34 if L > 6.2 else 0.28
    for k, st in enumerate(spec["storeys"]):
        y0 = y
        if k == nst - 1:
            # (the last storey stretches so the front's shoulders stand clear of the roof's edge: shoulder_need)
            need = shoulder_need(fr, spec)
            st = dict(st, h=max(st["h"], need - y0 - band_h(spec, last=True)))
        y1 = y0 + st["h"]
        order = st.get("order")
        if order:
            n = st["n"]
            pils = [(0.06, 0.06 + pil_w)] + [(L * i / n - pil_w / 2, L * i / n + pil_w / 2) for i in range(1, n)] + [(L - 0.06 - pil_w, L - 0.06)]
            for ps0, ps1 in pils:
                fr.pilaster(ps0, ps1, y0, y1, order)
        bh = band_h(spec, last=(k == nst - 1))
        wy0 = y0 + st.get("sill", 0.9)
        wy1 = y1 - bh_room(st)
        wy1 = min(wy1, y1 - 0.45)
        if st.get("tracery"):
            # blind tracery: tall panels between the windows, the storey's height, pointed at the top
            gothic_panels(fr, y0 + 0.12, y1 - 0.12, st)
        mids = fr.windows_row(wy0, wy1, st["n"], st["w"], st["win"], st["head"], k)
        if st.get("panels"):
            for m in mids:
                fr.panel(m - st["w"] / 2 - 0.04, m + st["w"] / 2 + 0.04, y0 + 0.12, wy0 - 0.2, "cartouche" if k % 2 == 0 else "field")
        if spec.get("band") == "anchors":
            for i in range(1, st["n"]):
                fr.anchor(L * i / st["n"], y1 - 0.25)
        # the band over the storey
        y = y1
        if k < nst - 1:
            fr.tint(fr.stone)
            kind = spec.get("band", "string")
            if kind == "order":
                fr.moulding(0.004, L - 0.004, y, PROFILES["order"], FACE, 1.0)
                if order:
                    for ps0, ps1 in pils:
                        fr.moulding(ps0 - 0.05, ps1 + 0.05, y - 0.015, PROFILES["order"], FACE + 0.09, 1.02, scale=1.0)
                y += PROFILES["order"][-1][0]
            elif kind == "gothic":
                fr.tint(fr.stone2)
                fr.moulding(0.004, L - 0.004, y, PROFILES["gothic"], FACE, 1.0)
                y += PROFILES["gothic"][-1][0]
            elif kind == "banded":
                fr.moulding(0.004, L - 0.004, y, PROFILES["band"], FACE, 1.0)
                y += PROFILES["band"][-1][0]
            elif kind == "none":
                pass
            else:
                fr.moulding(0.004, L - 0.004, y, PROFILES["string"], FACE, 1.0)
                y += PROFILES["string"][-1][0]
        fr.storey_k = k + 1
    # the main cornice under the gable
    fr.tint(fr.stone2 if spec.get("cornice") == "gothic" else fr.stone)
    ys = fr.moulding(0.004, L - 0.004, y, PROFILES[spec.get("cornice", "medium")], FACE, 1.0)
    if spec.get("band") == "order":
        # ressauts of the cornice over the last storey's pilasters
        st = spec["storeys"][-1]
        if st.get("order"):
            n = st["n"]
            pils = [(0.06, 0.06 + pil_w)] + [(L * i / n - pil_w / 2, L * i / n + pil_w / 2) for i in range(1, n)] + [(L - 0.06 - pil_w, L - 0.06)]
            for ps0, ps1 in pils:
                fr.moulding(ps0 - 0.05, ps1 + 0.05, y - 0.015, PROFILES[spec.get("cornice", "medium")], FACE + 0.09, 1.02)
    # the gable
    outline = gable(fr, spec, ys)
    fr.wall_face(outline_with_foot(fr, outline, ys), y_face0)
    fr.slab_edges(outline_with_foot(fr, outline, ys), y_face0)
    b.tint, b.wear, b.wallmat = keep_tint, keep_wear, keep_mat
    del ground_mat
    return {"name": spec["name"], "design": spec["design"], "top": round(max(y_ for _, y_ in outline), 2), "windows": fr.windows}


def band_h(spec, last=False):
    if last:
        return PROFILES[spec.get("cornice", "medium")][-1][0]
    kind = spec.get("band", "string")
    return {"order": PROFILES["order"][-1][0], "gothic": PROFILES["gothic"][-1][0], "banded": PROFILES["band"][-1][0], "none": 0.0}.get(kind, PROFILES["string"][-1][0])


def bh_room(st):
    """Room over a window for its head, by the head's kind."""
    return {"pediment": 0.85, "segment": 0.7, "shell": 0.2, "arch": 0.75, "pointed": 0.95, "ears": 0.5, "key": 0.5, "hood": 0.55}.get(st.get("head", "lintel"), 0.4)


def shoulder_need(fr, spec):
    """How high the front's shoulders (the cornice's top) must stand for its gable to hide the roof."""
    g = spec["gable"]
    L = fr.L
    margin = 0.25
    if g["kind"] == "neck":
        wn = g["neck"] * L
        return fr.roof((L - wn) / 2) + margin
    if g["kind"] == "bell":
        # the bell's shoulders begin at the edges and rise steeply: the roof's height a sixth in
        return fr.roof(L * 0.12) + margin
    if g["kind"] == "tiers":
        w1 = g["tiers"][0][0] * L
        return fr.roof((L - w1) / 2) + margin
    # stepped: the first step's tread is level with the shoulder plus its riser
    n = g["steps"]
    tread = (L / 2 - g["top"] / 2) / n
    return fr.roof(tread) + margin - g["rise"]


def outline_with_foot(fr, outline, ys):
    return outline


def gothic_panels(fr, y0, y1, st):
    """Blind tracery: slender pointed panels of stone between and beside the windows (the storey's height)."""
    L = fr.L
    n = st["n"]
    w = st["w"]
    mids = [L * (i + 0.5) / n for i in range(n)]
    edges = [0.0] + [v for m in mids for v in (m - w / 2 - 0.12, m + w / 2 + 0.12)] + [L]
    fr.tint(fr.stone)
    for i in range(0, len(edges), 2):
        a_, b_ = edges[i] + 0.08, edges[i + 1] - 0.08
        if b_ - a_ < 0.22:
            continue
        k = max(1, int((b_ - a_) / 0.28))
        pw = (b_ - a_) / k
        for j in range(k):
            pa, pb = a_ + j * pw, a_ + (j + 1) * pw
            # the ribs: two thin uprights, a pointed head
            fr.box(pa, pa + 0.04, y0, y1 - pw * 0.6, FACE, FACE + 0.05, 1.0, bottom=False, top=False)
            fr.box(pb - 0.04, pb, y0, y1 - pw * 0.6, FACE, FACE + 0.05, 1.0, bottom=False, top=False)
            c = (pa + pb) / 2
            yt = y1 - pw * 0.6
            fr.extrude([(pa, yt), (pa + 0.04, yt), (c, y1 - 0.06), (pb - 0.04, yt), (pb, yt), (c, y1)], FACE, FACE + 0.05, 1.02)


def gable(fr, spec, ys):
    """The gable over the shoulders at ys: its outline [(s, y)] from s 0 to L, and everything on it."""
    g = spec["gable"]
    L = fr.L
    kind = g["kind"]
    st = fr.stone
    fr.tint(st)
    k0 = len(spec["storeys"])
    if kind == "step":
        n = g["steps"]
        top_w = g["top"]
        tread = (L / 2 - top_w / 2) / n
        rise = g["rise"]
        left = [(0.0, ys)]
        for i in range(n):
            yv = ys + rise * (i + 1)
            left += [(tread * i, yv), (tread * (i + 1), yv)]
        # the top step a little higher
        ytop = ys + rise * (n + 1) + 0.15
        left += [(L / 2 - top_w / 2, ytop)]
        outline = left + [(L / 2 + top_w / 2, ytop)] + [(L - s, y) for s, y in reversed(left)]
        outline = _clean(outline)
        # clear of the roof everywhere: lift what does not clear (a riser is level with its tread's outer end)
        for i, (s, y) in enumerate(outline):
            need = fr.roof(s) + 0.2
            if y < need and 0 < s < L:
                print(f"[guild_fronts] house {fr.h['_i']}: the step at s {s:.2f} is under the roof ({y:.2f} < {need:.2f})")
        top = fr.outline_top(outline)
        gable_windows(fr, g, ys, top, k0)
        # the copings on each step's tread, and what stands on them
        for i in range(n):
            yv = ys + rise * (i + 1)
            for sg in (-1, 1):
                a_, b_ = (tread * i, tread * (i + 1)) if sg < 0 else (L - tread * (i + 1), L - tread * i)
                if g.get("copings"):
                    fr.tint(fr.stone2 if spec["design"] == "gothic" else st)
                    fr.box(max(0.004, a_ - 0.05), min(L - 0.004, b_ + 0.05), yv, yv + 0.14, BACK - 0.01, FACE + 0.08, 1.0)
                c = (a_ + b_) / 2
                if g.get("pinnacles"):
                    fr.pinnacle(c, yv + 0.14, 1.2 + 0.1 * (i % 2))
                elif g.get("obelisks") and i % 2 == 1:
                    fr.obelisk(c, yv + 0.14, 0.9)
                elif g.get("balls"):
                    fr.tint(st)
                    fr.ball(c, yv + 0.14 + 0.13, FACE * 0.55, 0.13)
                if g.get("scroll_steps"):
                    # a scroll in the step's corner, from its tread's outer end up to the next riser
                    if sg < 0:
                        fr.scroll(a_ + 0.02, yv + 0.14, b_, yv + rise * 0.86, -1)
                    else:
                        fr.scroll(b_ - 0.02, yv + 0.14, a_, yv + rise * 0.86, 1)
        fr.tint(fr.stone2 if spec["design"] == "gothic" else st)
        fr.box(L / 2 - top_w / 2 - 0.05, L / 2 + top_w / 2 + 0.05, ytop, ytop + 0.16, BACK - 0.01, FACE + 0.08, 1.0)
        fr.finial(g.get("finial", "ball"), L / 2, ytop + 0.16)
        if g.get("beam"):
            hoist_beam(fr, L / 2, ytop - 0.55)
        return outline
    if kind == "tiers":
        outline_l = [(0.0, ys)]
        yv = ys
        cur = 0.0
        tiers = g["tiers"]
        spans = []
        for wf, hh, order in tiers:
            sa = (L - wf * L) / 2
            spans.append((sa, L - sa, yv, yv + hh, order))
            outline_l += [(sa, yv), (sa, yv + hh)]
            yv += hh
        # the top: a pediment over the last tier
        sa, sb, _, ytier, _ = spans[-1]
        tw = sb - sa
        hp = tw * (0.3 if g.get("top") == "pediment" else 0.24)
        if g.get("top") == "pediment":
            outline_l += [(L / 2, ytier + hp)]
            outline = outline_l + [(L - s, y) for s, y in reversed(outline_l[:-1])]
        else:
            n = 8
            arc = [(L / 2 - tw / 2 * math.cos(math.pi * i / n), ytier + hp * math.sin(math.pi * i / n)) for i in range(1, n)]
            outline = outline_l + arc + [(L - s, y) for s, y in reversed(outline_l)]
        outline = _clean(outline)
        top = fr.outline_top(outline)
        gable_windows(fr, g, ys, top, k0)
        # each tier: pilasters at its sides, a band on top; the scrolls at its shoulders
        prev = (0.0, L)
        for i, (sa, sb, y0, y1, order) in enumerate(spans):
            if order:
                pw = 0.26
                fr.pilaster(sa + 0.03, sa + 0.03 + pw, y0, y1 - 0.3, order, 0.07)
                fr.pilaster(sb - 0.03 - pw, sb - 0.03, y0, y1 - 0.3, order, 0.07)
            fr.tint(st)
            fr.moulding(sa + 0.004, sb - 0.004, y1 - 0.3, PROFILES["small"], FACE, 1.0, scale=0.95)
            # the scrolls from the lower span's ends up the tier's sides
            big = g.get("scrolls") == "big"
            fr.scroll(prev[0] + 0.04, y0, sa, y1 - (0.32 if i == 0 else 0.3), -1, big=big)
            fr.scroll(prev[1] - 0.04, y0, sb, y1 - (0.32 if i == 0 else 0.3), 1, big=big)
            if g.get("obelisks") and i == 0:
                fr.obelisk(prev[0] + 0.25, y0, 1.25)
                fr.obelisk(prev[1] - 0.25, y0, 1.25)
            elif g.get("balls") and i == 0:
                fr.tint(st)
                fr.ball(prev[0] + 0.25, y0 + 0.22, FACE * 0.55, 0.2)
                fr.ball(prev[1] - 0.25, y0 + 0.22, FACE * 0.55, 0.2)
            prev = (sa, sb)
        # the niche in the top tier with its figure
        if g.get("niche") is not None:
            sa, sb, y0, y1, _ = spans[-1]
            niche(fr, L / 2, y0 + 0.2, min(0.62, (sb - sa) * 0.36), y1 - y0 - 0.65, "saint" if g.get("niche") == 1 else None)
        # the pediment's mouldings and the figure on top
        fr.tint(st)
        if g.get("top") == "pediment":
            rake(fr, [(L / 2 - tw / 2 - 0.05, ytier), (L / 2, ytier + hp + 0.06), (L / 2 + tw / 2 + 0.05, ytier)])
        else:
            n = 8
            rake(fr, [(L / 2 - (tw / 2 + 0.05) * math.cos(math.pi * i / n), ytier + (hp + 0.05) * math.sin(math.pi * i / n)) for i in range(n + 1)])
        apex = ytier + hp
        if g.get("statue"):
            fr.tint(st)
            fr.box(L / 2 - 0.26, L / 2 + 0.26, apex - 0.05, apex + 0.32, BACK - 0.01, FACE + 0.1, 1.0)
            fr.statue(g["statue"], L / 2, apex + 0.32, None, 1.0 if g["statue"] != "eagle" else 1.0)
        else:
            fr.finial(g.get("finial", "ball_gilt"), L / 2, apex)
        return outline
    if kind == "bell":
        hg = g["hg"]
        neck = g["neck"] * L
        ylow = ys
        # the bell: steep concave shoulders from the edges, a convex top under a small pediment or a segment
        left = _bez((0.0, ylow), (L * 0.16, ylow + hg * 0.12), (L / 2 - neck / 2, ylow + hg * 0.35), (L / 2 - neck / 2, ylow + hg * 0.72), 9)
        top_arc = _bez((L / 2 - neck / 2, ylow + hg * 0.72), (L / 2 - neck / 2, ylow + hg * 0.9), (L / 2 - neck * 0.3, ylow + hg), (L / 2, ylow + hg), 5)
        half = left + top_arc[1:]
        outline = half + [(L - s, y) for s, y in reversed(half[:-1])]
        outline = _clean(outline)
        for s, y in outline:
            if y < fr.roof(s) + 0.15 and 0 < s < L:
                print(f"[guild_fronts] house {fr.h['_i']}: the bell at s {s:.2f} is under the roof ({y:.2f} < {fr.roof(s) + 0.15:.2f})")
        top = fr.outline_top(outline)
        gable_windows(fr, g, ys, top, k0)
        if g.get("oculus"):
            oy, orr = g["oculus"]
            fr.oculus(L / 2, ys + oy, orr)
        # the stone edge along the bell's outline
        edge_band(fr, outline, 0.12, 0.08)
        # the scroll ends at its foot
        fr.tint(st)
        for sg, e in ((-1, 0.25), (1, L - 0.25)):
            fr.lathe_disc(e, ys + 0.22, 0.2, FACE, FACE + 0.1)
        if g.get("vases"):
            fr.vase(0.3, ys + 0.42, 0.7)
            fr.vase(L - 0.3, ys + 0.42, 0.7)
        apex = ys + hg
        fr.tint(st)
        if g.get("top") == "pediment":
            rake(fr, [(L / 2 - neck * 0.75, apex - 0.1), (L / 2, apex + 0.35), (L / 2 + neck * 0.75, apex - 0.1)])
            fr.box(L / 2 - neck * 0.75, L / 2 + neck * 0.75, apex - 0.22, apex - 0.08, BACK - 0.01, FACE + 0.1, 1.0)
            fr.finial(g.get("finial", "vase"), L / 2, apex + 0.3)
        else:
            fr.box(L / 2 - neck * 0.6, L / 2 + neck * 0.6, apex - 0.02, apex + 0.14, BACK - 0.01, FACE + 0.1, 1.0)
            fr.finial(g.get("finial", "ball"), L / 2, apex + 0.14)
        if g.get("beam"):
            hoist_beam(fr, L / 2, ys + g["gwins"][0]["y"] + g["gwins"][0]["h"] + 0.35)
        return outline
    if kind == "neck":
        wn = g["neck"] * L
        hn = g["hn"]
        sa, sb = (L - wn) / 2, (L + wn) / 2
        yt = ys + hn
        tw = wn
        hp = tw * (0.28 if g.get("top") == "pediment" else 0.2)
        left = [(0.0, ys), (sa, ys), (sa, yt)]
        if g.get("top") == "pediment":
            outline = left + [(L / 2, yt + hp)] + [(L - s, y) for s, y in reversed(left)]
        else:
            n = 8
            arc = [(L / 2 - tw / 2 * math.cos(math.pi * i / n), yt + hp * math.sin(math.pi * i / n)) for i in range(1, n)]
            outline = left + arc + [(L - s, y) for s, y in reversed(left)]
        outline = _clean(outline)
        top = fr.outline_top(outline)
        gable_windows(fr, g, ys, top, k0, span=(sa, sb))
        if g.get("oculus"):
            oy, orr = g["oculus"]
            fr.oculus(L / 2, ys + oy, orr)
        # the neck's sides in stone quoins, the claw pieces
        fr.tint(st)
        for e0, e1 in ((sa, sa + 0.16), (sb - 0.16, sb)):
            yy = ys
            j = 0
            while yy < yt - 0.1:
                hh = min(0.36, yt - yy)
                ext = 0.06 if j % 2 == 0 else 0.0
                fr.box(e0 - (ext if e0 == sa else 0), e1 + (ext if e1 == sb else 0), yy, yy + hh - 0.02, FACE, FACE + 0.05, 1.0 if j % 2 == 0 else 0.93)
                yy += hh
                j += 1
        fr.moulding(sa + 0.004, sb - 0.004, yt - 0.26, PROFILES["small"], FACE, 1.0, scale=0.85)
        if g.get("claws"):
            fr.scroll(0.06, ys, sa, yt - 0.3, -1, big=True)
            fr.scroll(L - 0.06, ys, sb, yt - 0.3, 1, big=True)
        # copings on the shoulders
        fr.box(0.004, sa, ys, ys + 0.1, BACK - 0.01, FACE + 0.06, 1.0)
        fr.box(sb, L - 0.004, ys, ys + 0.1, BACK - 0.01, FACE + 0.06, 1.0)
        if g.get("vases"):
            fr.vase(0.32, ys + 0.1, 0.75)
            fr.vase(L - 0.32, ys + 0.1, 0.75)
        if g.get("top") == "pediment":
            rake(fr, [(sa - 0.06, yt), (L / 2, yt + hp + 0.06), (sb + 0.06, yt)])
        else:
            n = 8
            rake(fr, [(L / 2 - (tw / 2 + 0.06) * math.cos(math.pi * i / n), yt + (hp + 0.06) * math.sin(math.pi * i / n)) for i in range(n + 1)])
        fr.finial(g.get("finial", "ball"), L / 2, yt + hp)
        return outline
    raise ValueError(kind)


def gable_windows(fr, g, ys, top, k0, span=None):
    """The gable's rows of windows (gwins: y over the shoulders, height, count, width), where they fit."""
    L = fr.L
    s0, s1 = span or (0.0, L)
    for j, row in enumerate(g.get("gwins", [])):
        if not row.get("n"):
            continue
        y0 = ys + row["y"]
        y1 = y0 + row["h"]
        n, w = row["n"], row["w"]
        # spread over the part of the gable wide enough at the head's height
        room = [s for s in [s0 + (s1 - s0) * i / 200 for i in range(201)] if (top(s) or 0) > y1 + 0.55]
        if not room:
            print(f"[guild_fronts] house {fr.h['_i']}: no room for gable row {j}")
            continue
        a_, b_ = min(room) + 0.12, max(room) - 0.12
        if (b_ - a_) < n * (w + 0.3):
            n = max(1, int((b_ - a_) / (w + 0.3)))
        mids = [a_ + (b_ - a_) * (i + 0.5) / n for i in range(n)]
        for m in mids:
            fr.window(m - w / 2, m + w / 2, y0, y1, row.get("win", "cross"), row.get("head", "lintel"), True, k0 + j, True)


def edge_band(fr, outline, w, proud):
    """A band of stone along an outline (inside it), standing out of the face."""
    fr.tint(fr.stone)
    for (pa, pb) in zip(outline, outline[1:]):
        ds, dy = pb[0] - pa[0], pb[1] - pa[1]
        ln = math.hypot(ds, dy)
        if ln < 1e-6:
            continue
        nx_, ny_ = dy / ln * w, -ds / ln * w  # (inward: the outline runs left to right over its region)
        band = [pa, pb, (pb[0] + nx_, pb[1] + ny_), (pa[0] + nx_, pa[1] + ny_)]
        if _area(band) < 0:
            band = band[::-1]
        fr.extrude(band, FACE, FACE + proud, 1.04)


def rake(fr, pts):
    """A raking cornice along points (a pediment's sides, a segment's curve)."""
    edge_band(fr, pts, 0.16, 0.14)
    for (pa, pb) in zip(pts, pts[1:]):
        ds, dy = pb[0] - pa[0], pb[1] - pa[1]
        ln = math.hypot(ds, dy)
        if ln < 1e-6:
            continue
        nx_, ny_ = -dy / ln * 0.07, ds / ln * 0.07  # (outward: a lip over the band)
        lip = [pa, pb, (pb[0] + nx_, pb[1] + ny_), (pa[0] + nx_, pa[1] + ny_)]
        if _area(lip) < 0:
            lip = lip[::-1]
        fr.extrude(lip, BACK - 0.01, FACE + 0.2, 1.06, back=True)


def niche(fr, sc, y0, r, hgt, figure):
    """A round-headed niche with a shell head and a figure in it."""
    fr.tint(fr.stone)
    dn = FACE - 0.22
    yt = y0 + hgt - r
    # its back and sides: the recess
    n = 8
    arc = [(sc + r * math.cos(math.pi * i / n), yt + r * math.sin(math.pi * i / n)) for i in range(n + 1)]
    fr.holes.append({"s0": sc - r, "s1": sc + r, "y0": y0, "y1": yt})
    # (the arch's spandrels over the rectangular hole are kept in the wall: the hole stops at yt; the half-dome sits
    # in front of the face over it)
    fr.sq([(sc - r, y0, dn), (sc + r, y0, dn), (sc + r, yt, dn), (sc - r, yt, dn)], (0, 0, 1), 0.5)
    fr.sq([(sc - r, y0, FACE), (sc - r, y0, dn), (sc - r, yt, dn), (sc - r, yt, FACE)], (1, 0, 0), 0.55)
    fr.sq([(sc + r, y0, FACE), (sc + r, y0, dn), (sc + r, yt, dn), (sc + r, yt, FACE)], (-1, 0, 0), 0.5)
    fr.sq([(sc - r, y0, FACE), (sc + r, y0, FACE), (sc + r, y0, dn), (sc - r, y0, dn)], (0, 1, 0), 0.8)
    # the shell head: ribs fanning out of its foot, in front of the face
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        am = (a0 + a1) / 2
        fr.extrude([(sc, yt), (sc + r * math.cos(a0), yt + r * math.sin(a0)), (sc + r * 1.03 * math.cos(am), yt + r * 1.03 * math.sin(am)), (sc + r * math.cos(a1), yt + r * math.sin(a1))][::-1],
                   FACE, FACE + 0.02 + 0.04 * math.sin(am), 0.85 + 0.12 * (i % 2))
    fr.ring(sc, yt, r, 0.08, FACE, FACE + 0.08, 16) if False else None
    for i in range(n):
        a0, a1 = math.pi * i / n, math.pi * (i + 1) / n
        fr.extrude([(sc + r * math.cos(a0), yt + r * math.sin(a0)), (sc + (r + 0.09) * math.cos(a0), yt + (r + 0.09) * math.sin(a0)),
                    (sc + (r + 0.09) * math.cos(a1), yt + (r + 0.09) * math.sin(a1)), (sc + r * math.cos(a1), yt + r * math.sin(a1))][::-1], FACE, FACE + 0.08, 1.02)
    fr.box(sc - r - 0.12, sc + r + 0.12, y0 - 0.14, y0, FACE, FACE + 0.16, 1.0)
    if figure:
        fr.statue(figure, sc, y0, (dn + FACE) / 2, min(1.0, (yt + r * 0.6 - y0) / 1.55))


def hoist_beam(fr, sc, y):
    """The hoist beam out of the gable's top, a pulley under its end."""
    fr.tint(OAK)
    fr.box(sc - 0.1, sc + 0.1, y, y + 0.2, FACE, FACE + 1.1, 0.7, mat=K["MAT_WOOD"])
    fr.tint(IRON)
    fr.lathe_disc(sc, y - 0.12, 0.09, FACE + 0.95, FACE + 1.0, 0.4)


def preview(out_dir):
    """Quick pictures of the fronts in Blender (shapes only: the vertex colours, no game textures):
    build_city.py -- --no-export --guild-preview <dir>."""
    import bpy
    from mathutils import Vector
    os.makedirs(out_dir, exist_ok=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_WORKBENCH"
    sh = sc.display.shading
    sh.light = "STUDIO"
    sh.color_type = "VERTEX"
    sh.show_shadows = True
    sh.show_cavity = True
    sc.render.resolution_x, sc.render.resolution_y = 1600, 1000
    cam = bpy.data.objects.new("gf_cam", bpy.data.cameras.new("gf_cam"))
    sc.collection.objects.link(cam)
    sc.camera = cam
    cam.data.lens = 28
    views = {"east": ((-262, 1.7, 94), (-222, 14, 94)), "west": ((-246, 1.7, 94), (-286, 14, 94)),
             "e_close": ((-236, 1.7, 76), (-222, 13, 76)), "w_close": ((-272, 1.7, 106), (-286, 13, 106)),
             "e_n": ((-238, 1.7, 112), (-222, 12, 96)), "w_s": ((-268, 1.7, 76), (-286, 12, 92))}
    for name, (eye, at) in views.items():
        e = Vector((eye[0], -eye[2], eye[1]))
        t = Vector((at[0], -at[2], at[1]))
        cam.location = e
        cam.rotation_euler = (t - e).to_track_quat("-Z", "Y").to_euler()
        sc.render.filepath = os.path.join(out_dir, f"gf_{name}.png")
        bpy.ops.render.render(write_still=True)
