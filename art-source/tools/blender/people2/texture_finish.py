"""Bake cloth finish onto the frozen clothing-kit UVs; never save/export the scene.

Run Blender with the accepted authoring .blend, then -P this file -- --pictures DIR
--samples DIR --output DIR. The original pictures remain the palette/material-mask
authority. Generated scan samples supply surface detail, not garment shapes.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from people2 import clothes_build as cb, hands, paint, pictures, weights

KINDS = ("milk_woman", "foreman", "porter", "fishwife_a", "police",
         "docker_sack", "shopwife", "old_woman_dressed", "fishwife_b",
         "ragman", "old_man_dressed", "peeters")


def read(path):
    image = bpy.data.images.load(str(path.resolve()), check_existing=False)
    # Non-Color keeps the stored sRGB numbers, as the original cloth painter does.
    image.colorspace_settings.name = "Non-Color"
    w, h = image.size
    data = np.empty(w * h * 4, np.float32)
    image.pixels.foreach_get(data)
    bpy.data.images.remove(image)
    return data.reshape(h, w, 4)


def sample(image, u, v):
    h, w = image.shape
    x, y = (u % 1) * w, (v % 1) * h
    ix, iy = x.astype(int), y.astype(int)
    fx, fy = x - ix, y - iy
    return ((image[iy % h, ix % w] * (1-fx) + image[iy % h, (ix+1) % w] * fx) * (1-fy)
            + (image[(iy+1) % h, ix % w] * (1-fx) + image[(iy+1) % h, (ix+1) % w] * fx) * fy)


def grain(image, pos, normals, size):
    """Continuous rest-space triplanar sampling avoids narrow-island stretching."""
    x, y, z = (pos / size).T
    w = np.abs(normals) ** 6
    w /= np.maximum(w.sum(axis=1, keepdims=True), 1e-8)
    return (sample(image, z, y) * w[:, 0] + sample(image, x, z) * w[:, 1]
            + sample(image, x, y) * w[:, 2])


def mesh_digest(mesh):
    h = hashlib.sha256()
    for array in (np.array([v.co[:] for v in mesh.vertices], np.float32),
                  np.array([l.vertex_index for l in mesh.loops], np.int32),
                  np.array([l.uv[:] for l in mesh.uv_layers["UVMap"].data], np.float32)):
        h.update(array.tobytes())
    return h.hexdigest()


def finish(kind, source, samples, output):
    ob = bpy.data.objects[kind + "_lod0"]
    armature = ob.find_armature()
    def joint(name):
        v = armature.data.bones[name].head_local
        return np.array((v.x, v.z, -v.y))
    before = mesh_digest(ob.data)
    original = read(source / (kind + "_colour.png"))
    old_normal = read(source / (kind + "_normal.png"))
    cb.edge_layer(ob)  # temporary distance attribute; never written to the source scene
    pos, nrm, ids, names, extra = cb.position_map(
        ob, 1024, 1024, weights.parts(ob), extra=("_edge",))
    rgb = original[:, :, :3].copy()
    height = np.zeros((1024, 1024), np.float32)
    covered = np.zeros((1024, 1024), bool)
    report = []
    for i, name in enumerate(names):
        part = name.removeprefix("in_")
        mask = (ids == i) & (np.indices(ids.shape)[0] >= 512)
        if not mask.any():
            continue
        p, normals = pos[mask], nrm[mask]
        x, y, z = p.T
        old = original[mask, :3]
        zone = int(np.median(np.rint(original[mask, 3] * 5)))
        if zone == 5:
            continue
        covered |= mask
        edge = np.nan_to_num(extra["_edge"][mask, 0], posinf=1)
        wood = part == "clogs"
        material = "wood" if wood else "leather" if zone == 4 else "linen" if zone in (2, 3) else "wool"
        period = .36 if material == "linen" else .28 if material == "wool" else .20
        if material == "wool" and kind in ("police", "peeters"):
            period = .18 if kind == "police" else .16
        if kind == "porter" and part in ("coat", "trousers", "coat_collar"):
            material, period = "linen", .30
        g = grain(samples[material], p, normals, period)
        g = np.clip(g, -.7, .7)
        color = old.copy()
        if kind == "milk_woman" and part == "apron":
            # Keep the pocket and seams, but replace the chalky clouds with
            # rubbed indigo linen and small, irregular splash marks.
            base = np.median(old, axis=0)
            color = np.minimum(color, base[None]*1.10)
            specks = np.clip(paint._noise3(p, 95, 48)*2-.3, 0, 1)
            low = np.clip((1.15-y)/.7, 0, 1)
            color *= (1-.12*low*specks)[:, None]
        # The old red shawl's bright broken strokes looked like tears. Preserve its
        # rusty palette, replace those strokes with continuous dyed woven cloth.
        if kind == "milk_woman" and part == "shawl":
            base = np.median(old, axis=0)
            color = base[None] * (1 + .045 * paint._noise3(p, 32, 1873))[:, None]
        if wood:
            base = np.median(old, axis=0)
            color = base[None] * (1 + .20*g)[:, None]
            old_normal[mask, :3] = (.5, .5, 1)
        else:
            contrast = .38 if material == "linen" else .30
            if kind == "peeters" and material == "wool":
                contrast = .18
            color *= (1 + contrast*g)[:, None]
        h = g * (.00022 if wood else .00013 if material == "leather" else .00016)
        # Folded hems/bound edges, with individual muted linen stitches. Distances
        # are metres along the original garment, not atlas-pixel outlines.
        cloth = material in ("linen", "wool") and zone != 0
        if cloth and not name.startswith("in_"):
            bound = np.exp(-((edge-.004)/.0035)**2)
            seam = np.exp(-((edge-.009)/.0018)**2)
            stitch = seam * (.5+.5*np.sin((x+y+z)*2*np.pi/.005))**3
            color *= (1-.065*bound-.12*seam)[:, None]
            color += stitch[:, None] * np.minimum(color*.32, .055)
            h += bound*.00022 + stitch*.00022 - seam*.00012
        if material == "leather":
            crease = np.exp(-(np.sin((z*1.7+y)*150 + .6*np.sin(x*49))/.24)**2)
            toe = np.exp(-((y-.085)/.05)**2)
            color *= (1-.12*crease*toe)[:, None]
            h -= crease*toe*.00032
            welt = np.exp(-((y-.04)/.005)**2)
            stitch = welt * (.5+.5*np.sin((x+z)*1400))**4
            color += stitch[:, None]*.04
            h += stitch*.00025
        if kind == "foreman" and part == "waistcoat" and not name.startswith("in_"):
            front = (z > 0) & (normals[:, 2] > .25)
            for by in (1.18, 1.11, 1.04, .97):
                button = np.exp(-(((x-.008)/.005)**2+((y-by)/.005)**2)*2)*front
                hole = np.exp(-((y-by)/.0016)**2)*np.exp(-((x-.025)/.008)**8)*front
                thread = np.exp(-((np.abs(y-by)-.0028)/.0011)**2)
                thread *= np.exp(-((x-.025)/.008)**8)*front
                color *= (1-.55*button-.28*hole)[:, None]
                color += thread[:, None]*.018
                h += button*.0006-hole*.00015+thread*.00012
        if kind == "police" and part in ("buckle", "tunic", "collar", "kepi"):
            brass = (old[:,0] > old[:,2]*1.5) & (old[:,1] > old[:,2]*1.25)
            patina = np.clip(paint._noise3(p, 180, 41), 0, 1)*brass
            color *= (1-.16*patina)[:,None]
            h -= patina*.00007
        if kind == "ragman" and part in ("coat", "trousers", "coat_collar"):
            rib = np.cos((x+z*.28)*2*np.pi/.0035)
            color *= (1+.065*rib)[:, None]
            h += rib*.00018
        if kind in ("porter", "docker_sack", "ragman") and part in ("coat", "smock"):
            # Small darned elbow repair follows the sleeve's physical location.
            elbow_at = joint("armLowL")
            elbow = np.exp(-((np.abs(x)-elbow_at[0])/.055)**8-((y-elbow_at[1])/.045)**8)
            elbow *= np.clip(-normals[:, 2], 0, 1)
            darn = np.sin(x*2400)*np.sin(y*2100)
            color *= (1+elbow*(.06+.04*darn))[:, None]
            h += elbow*(.00018+.00010*darn)
        if kind == "shopwife" and name == "bodice":
            wrist = joint("handL")
            cuff = np.exp(-((np.abs(x)-wrist[0])/.055)**8)
            cuff *= np.clip(normals[:,2],0,1)
            for offset in (.025,.040):
                button = np.exp(-((y-wrist[1]-offset)/.004)**2)
                button *= np.exp(-((np.abs(x)-wrist[0]-.018)/.004)**2)*cuff
                color += button[:,None]*.025
                h += button*.0006
        if kind == "old_woman_dressed" and part == "shawl":
            darn = np.exp(-((x+.14)/.027)**8-((y-1.24)/.025)**8)
            color *= (1+darn*(.09+.06*np.sin(x*1800)*np.sin(y*1800)))[:, None]
        if part in ("apron", "skirt") and kind not in ("peeters", "shopwife"):
            low = np.exp(-((y-(p[:,1].min()+.025))/.055)**2)
            specks = np.clip(paint._noise3(p, 125, 1873)*2.4-.3, 0, 1)
            dirt = low*specks*.11
            color = color*(1-dirt[:, None]) + np.array((.19,.16,.115))*dirt[:, None]
        rgb[mask] = np.clip(color, 0, 1)
        height[mask] = h
        report.append(dict(part=name, material=material, texels=int(mask.sum())))
    # Extend the new signal into existing island padding, preserving alpha IDs and
    # all body pixels byte-for-byte. Normal perturbations use the actual UV metric.
    expanded = paint.dilate(covered[:, :, None].astype(np.float32), covered, steps=8)[:, :, 0] > .5
    padded = paint.dilate(rgb, covered, steps=8)
    rgb[expanded] = padded[expanded]
    rgb[:512] = original[:512, :, :3]
    detail_normal = hands.normal_from_height(height, pos, covered)
    shift = paint.dilate((detail_normal[:, :, :2]-.5)*covered[:, :, None], covered, steps=8)
    normal = old_normal.copy()
    normal[:, :, :2] = np.clip(normal[:, :, :2] + shift*.55, .08, .92)
    xy = normal[:, :, :2]*2-1
    normal[:, :, 2] = (np.sqrt(np.maximum(1-(xy*xy).sum(axis=2), .01))+1)*.5
    normal[:512] = old_normal[:512]
    color = np.concatenate((rgb, original[:, :, 3:4]), axis=2)
    pictures.save(kind+"_colour", color, str(output))
    pictures.save(kind+"_normal", normal, str(output), normal=True)
    assert mesh_digest(ob.data) == before, "Texture bake changed vertices, topology or UVs"
    return dict(kind=kind, mesh_uv_sha256=before, parts=report)


def detail(samples, output):
    """Same four 512px detail slots, periodic filtering and matched normal relief."""
    yy, xx = np.mgrid[:512, :512] / 512
    for material, name in (("wool", "wool"), ("linen", "linen"),
                           ("linen", "canvas"), ("leather", "leather")):
        src = samples[material]
        # Mix a half-tile-shifted copy near both ends. Its join is hidden in the
        # centre where the unshifted image owns the pixels. Both derivatives wrap.
        u, v = xx, yy
        wx = np.sin(np.pi*u)**2
        wy = np.sin(np.pi*v)**2
        g = (sample(src,u,v)*wx*wy + sample(src,u+.5,v)*(1-wx)*wy
             +sample(src,u,v+.5)*wx*(1-wy)+sample(src,u+.5,v+.5)*(1-wx)*(1-wy))
        g -= g.mean()
        strength = .44 if name == "canvas" else .32
        color = np.repeat(np.clip(.5+g[:,:,None]*strength, .22, .78), 3, axis=2)
        # A small normal perturbation adds fibres, not a raised grid.
        du = (np.roll(g,-1,axis=1)-np.roll(g,1,axis=1))*.55
        dv = (np.roll(g,-1,axis=0)-np.roll(g,1,axis=0))*.55
        normal = np.stack((-du,-dv,np.ones_like(g)),axis=2)
        normal /= np.linalg.norm(normal,axis=2,keepdims=True)
        pictures.save("detail_"+name+"_colour",color,str(output))
        pictures.save("detail_"+name+"_normal",normal*.5+.5,str(output),normal=True)


def main():
    parser = argparse.ArgumentParser()
    for name in ("pictures", "samples", "output"):
        parser.add_argument("--"+name, required=True, type=Path)
    parser.add_argument("--kinds", default=",".join(KINDS))
    args = parser.parse_args(sys.argv[sys.argv.index("--")+1:])
    args.output = args.output.resolve()
    manifest = json.loads((args.samples/"manifest.json").read_text())
    for kind in args.kinds.split(","):
        expected_mesh = manifest["meshUvSha256"][kind]
        if mesh_digest(bpy.data.objects[kind+"_lod0"].data) != expected_mesh:
            raise ValueError("Authoring mesh/UV differs from the accepted texture source: "+kind)
        for suffix in ("_colour.png", "_normal.png"):
            name = kind+suffix
            digest = hashlib.sha256((args.pictures/name).read_bytes()).hexdigest()
            if digest != manifest["sourcePictures"][name]:
                raise ValueError("Use the original source-revision picture, not an already finished map: "+name)
    samples = {}
    for name in ("linen", "wool", "leather", "wood"):
        gray = read(args.samples/(name+".png"))[:, :, :3].mean(axis=2)
        # Remove the photograph's mean tint; the existing garment owns its colour.
        samples[name] = gray/max(float(gray.mean()), .01)-1
    args.output.mkdir(parents=True, exist_ok=True)
    results = []
    for kind in args.kinds.split(","):
        results.append(finish(kind, args.pictures, samples, args.output))
        print("TEXTURE FINISHED", kind, flush=True)
    detail(samples, args.output)
    (args.output/"texture-finish.json").write_text(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
