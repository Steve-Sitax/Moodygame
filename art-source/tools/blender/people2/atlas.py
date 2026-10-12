"""The people2 picture atlas: one colour and one normal picture for every body, kind and held thing (docs/people.md
"Kinds and clothes", the plan's 2.3): one material for all people, so a crowd costs no material switches.

4096 x 4096 in cells of 1024 (rows up, as Blender keeps pixels):
- a skin cell per base picture (m, f, boy, old_m, old_f): A's body square with B's face in its head square;
- per kind a body cell (its own skin, hands and B's face square left empty) and a cloth cell (every garment);
- face squares: 512 for a crowd kind, 1024 for the named cast (hero), the kind's head and hair UVs moved there;
- a cell for the held things (held.py).
cells() lays them out in that order and fails if they do not fit (then: a second atlas and material, or smaller
cells for the crowd). Linear, mipmapped in the games; every cell is grown 12 px past its islands against bleeding.
"""

import numpy as np

SIZE = 4096
CELL = 1024
SKINS = ["m", "f", "boy", "old_m", "old_f"]


def cells(kinds):
    """The layout: {name: (x, y, w, h) in pixels}. kinds: list of (name, hero)."""
    out = {}
    free = [(c, r) for r in range(SIZE // CELL) for c in range(SIZE // CELL)]

    def take():
        if not free:
            raise RuntimeError("people2 atlas full: add a second atlas (docs/people.md 'Kinds and clothes')")
        c, r = free.pop(0)
        return (c * CELL, r * CELL, CELL, CELL)

    for s in SKINS:
        out["skin_" + s] = take()
    for name, _ in kinds:
        out["body_" + name] = take()
        out["cloth_" + name] = take()
    quads = []
    for name, hero in kinds:
        if hero:
            out["face_" + name] = take()
        else:
            if not quads:
                x, y, _, _ = take()
                quads = [(x, y), (x + CELL // 2, y), (x, y + CELL // 2), (x + CELL // 2, y + CELL // 2)]
            x, y = quads.pop(0)
            out["face_" + name] = (x, y, CELL // 2, CELL // 2)
    out["held"] = take()
    return out


def remap_uv(ob, rect, face_rect=None, head_rect=(0.75, 0.75, 1.0, 1.0)):
    """Move a mesh's UVs from its own unit square into its cell (pixels); with face_rect, the corners inside B's head
    square go to the kind's own face square instead."""
    me = ob.data
    uvd = me.uv_layers["UVMap"].data
    uv = np.zeros(len(uvd) * 2)
    uvd.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    x, y, w, h = rect
    out = np.stack([(x + uv[:, 0] * w) / SIZE, (y + uv[:, 1] * h) / SIZE], -1)
    if face_rect is not None:
        u0, v0, u1, v1 = head_rect
        # whole faces: a face whose corners all sit in the head square
        inside = (uv[:, 0] >= u0 - 1e-6) & (uv[:, 1] >= v0 - 1e-6)
        fx, fy, fw, fh = face_rect
        hu = (uv[:, 0] - u0) / (u1 - u0)
        hv = (uv[:, 1] - v0) / (v1 - v0)
        hd = np.stack([(fx + hu * fw) / SIZE, (fy + hv * fh) / SIZE], -1)
        for p in me.polygons:
            li = list(p.loop_indices)
            if inside[li].all():
                out[li] = hd[li]
    uvd.foreach_set("uv", out.ravel())
    me.update()


def down2(img):
    """Half the size, 2 x 2 box (pictures painted at twice the cell size come out smooth)."""
    h, w = img.shape[:2]
    return img.reshape(h // 2, 2, w // 2, 2, -1).mean(axis=(1, 3))


def down_normals(nmap):
    """Half the size of a normal map (0..1): average the vectors, normalise."""
    v = down2(nmap * 2 - 1)
    v /= np.maximum(np.linalg.norm(v, axis=-1, keepdims=True), 1e-6)
    return v * 0.5 + 0.5


def fit_to(img, size):
    while img.shape[0] > size:
        img = down2(img)
    if img.shape[0] < size:
        k = size // img.shape[0]
        img = np.repeat(np.repeat(img, k, axis=0), k, axis=1)
    return img


class Atlas:
    def __init__(self, layout):
        self.layout = layout
        self.rgb = np.zeros((SIZE, SIZE, 3), np.float32) + np.array((0.5, 0.45, 0.4), np.float32)
        self.nrm = np.zeros((SIZE, SIZE, 3), np.float32) + np.array((0.5, 0.5, 1.0), np.float32)

    def put(self, name, rgb=None, nrm=None):
        x, y, w, h = self.layout[name]
        if rgb is not None:
            self.rgb[y:y + h, x:x + w] = fit_to(rgb, w)
        if nrm is not None:
            n = nrm
            while n.shape[0] > w:
                n = down_normals(n)
            self.nrm[y:y + h, x:x + w] = fit_to(n, w)

    def images(self, shots=None):
        import os

        from . import paint

        img = paint.to_image("people2_atlas", self.rgb, os.path.join(shots, "atlas.png") if shots else None)
        nimg = paint.to_image("people2_atlas_n", self.nrm, os.path.join(shots, "atlas_n.png") if shots else None)
        nimg.colorspace_settings.name = "Non-Color"
        return img, nimg
