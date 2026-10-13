"""Independent people pictures. Vertex colour G selects full-square faces; colour alpha selects detail."""
import json
import os
import numpy as np
from .atlas import fit_to, down_normals
SIZE = CELL = 1024
ZONES = {"none": 0, "wool": 1, "linen": 2, "canvas": 3, "leather": 4, "skin": 5}

def cells(kinds):
    out = {"skin_" + s: (0, 0, SIZE, SIZE) for s in ("m", "f", "boy", "old_m", "old_f")}
    for name, _ in kinds:
        out["body_" + name] = (8, 8, 1008, 496)
        out["cloth_" + name] = (8, 520, 1008, 496)
        out["face_" + name] = (0, 0, SIZE, SIZE)
    out["held"] = (0, 0, SIZE, SIZE)
    return out

def remap_uv(ob, rect, face_rect=None, head_rect=(0.75, 0.75, 1.0, 1.0)):
    me = ob.data
    uvd = me.uv_layers["UVMap"].data
    uv = np.zeros(len(uvd)*2)
    uvd.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    # Existing body head island, including eyes/hair, gets the whole face layer.
    body = face_rect is not None or rect == (0, 0, SIZE, SIZE) and not ob.name.startswith("_held")
    flags = np.zeros(len(uv), bool)
    if body:
        inside = (uv[:,0] >= .75-1e-6) & (uv[:,1] >= .75-1e-6)
        for poly in me.polygons:
            li = list(poly.loop_indices)
            if inside[li].all(): flags[li] = True
    x,y,w,h = rect
    out = (uv * (w,h) + (x,y)) / SIZE
    out[flags] = (uv[flags] - (.75,.75)) * 4
    uvd.foreach_set("uv", out.ravel())
    attr = me.color_attributes.get("picture_flags") or me.color_attributes.new(name="picture_flags", type="FLOAT_COLOR", domain="CORNER")
    rgba = np.zeros((len(uv),4), np.float32)
    rgba[:,1] = flags
    rgba[:,3] = 1
    attr.data.foreach_set("color", rgba.ravel())
    me.color_attributes.active_color = attr
    me.update()

def save(name, data, directory, normal=False):
    import bpy
    os.makedirs(directory, exist_ok=True)
    h,w = data.shape[:2]
    im = bpy.data.images.new(name, w, h, alpha=True)
    im.colorspace_settings.name = "Non-Color" if normal else "sRGB"
    rgba = np.ones((h,w,4), np.float32)
    rgba[:,:,:data.shape[2]] = data
    im.pixels.foreach_set(rgba.ravel())
    im.filepath_raw = os.path.join(directory, name + ".png")
    im.file_format = "PNG"
    im.save()
    bpy.data.images.remove(im)
    # Editor imports persist GPU blocks for exported games (Image.Compress is editor-only).
    from pathlib import Path
    resource = "res://assets/people2-pictures/" + name + ".png"
    import_path = Path(directory) / (name + ".png.import")
    if not import_path.exists():
        import hashlib
        dest = "res://.godot/imported/" + name + ".png-" + hashlib.md5(resource.encode()).hexdigest() + ".ctex"
        import_path.write_text('[remap]\nimporter="texture"\ntype="CompressedTexture2D"\npath.bptc="'+dest+'"\n\n[deps]\nsource_file="'+resource+'"\ndest_files=["'+dest+'"]\n\n[params]\ncompress/mode=2\ncompress/high_quality='+str(not normal).lower()+'\ncompress/normal_map='+str(1 if normal else 0)+'\nmipmaps/generate=true\nprocess/fix_alpha_border=false\nprocess/premult_alpha=false\n')

def normal_fit(n):
    while n.shape[0] > SIZE: n = down_normals(n)
    return fit_to(n, SIZE)

def skin_zones(pos, part, names, P):
    from . import body as bd, paint
    pname = np.array(names + [""])[np.where(part >= 0, part, len(names))]
    torso = np.char.startswith(pname, "torso")
    arm = np.char.startswith(pname, "arm")
    leg = np.char.startswith(pname, "leg")
    x,y,z = pos[...,0],pos[...,1],pos[...,2]
    Y = lambda f: bd.Y(P,f)
    waist = Y(.607)
    female = P["female"]
    neck = np.where(z > 0, Y(.775 if female else .790) + (np.abs(x)/((.11 if female else .12)*P["w"]))**(1.5 if female else 2) * (Y(.83)-Y(.775 if female else .79)), Y(.815 if female else .825))
    drawers = (leg|torso) & (y>Y(.33)) & (y<waist+.01)
    if female: drawers |= torso & (y<waist)
    vest = (torso & (y>waist-.06) & (y<neck)) | (arm & (y>Y(.715 if female else .735)) & (y<Y(.84)))
    zones = np.where(drawers|vest, 2., 5.)
    zones[np.char.startswith(pname,"hair")] = 0
    return paint.dilate(zones[...,None], part>=0)[...,0]

class Pictures:
    def __init__(self, layout):
        self.layout, self.parts, self.zones = layout, {}, {}
    def put(self, name, rgb=None, nrm=None):
        self.parts[name] = (fit_to(rgb, SIZE), normal_fit(nrm))
    def clothes_zones(self, name, zones):
        self.zones[name] = fit_to(zones[...,None], SIZE)[...,0]
    def write(self, bodies, dressed, directory, picture_of):
        from . import face_paint as fp
        entries, faces = {}, {}
        cloth_names, face_names = [], []
        for b in bodies + dressed:
            name = b["name"]
            if "kind" in b:
                rgb,nrm = self.parts["body_"+name]
                crgb,cnrm = self.parts["cloth_"+name]
                # Rectangles have their own 8px guard band. Source pictures are already dilated.
                c = np.zeros((SIZE,SIZE,3),np.float32)
                n = np.zeros((SIZE,SIZE,4),np.float32); n[:,:,:3] = (.5,.5,1)
                for key, col, norm, zone in (("body_"+name,rgb,nrm,self.zones.get("body_"+name,np.ones((SIZE,SIZE))*5)),
                    ("cloth_"+name,crgb,cnrm,self.zones.get("cloth_"+name,np.zeros((SIZE,SIZE))))):
                    x,y,w,h = self.layout[key]
                    ix = np.minimum((np.arange(w)*SIZE/w).astype(int),SIZE-1)
                    iy = np.minimum((np.arange(h)*SIZE/h).astype(int),SIZE-1)
                    c[y:y+h,x:x+w] = col[iy[:,None],ix]
                    n[y:y+h,x:x+w,:3] = norm[iy[:,None],ix]
                    n[y:y+h,x:x+w,3] = zone[iy[:,None],ix]/5
                    for a in range(1,9):
                        c[y-a,x:x+w] = c[y,x:x+w]; c[y+h-1+a,x:x+w] = c[y+h-1,x:x+w]
                        n[y-a,x:x+w] = n[y,x:x+w]; n[y+h-1+a,x:x+w] = n[y+h-1,x:x+w]
                        c[y-8:y+h+8,x-a] = c[y-8:y+h+8,x]; c[y-8:y+h+8,x+w-1+a] = c[y-8:y+h+8,x+w-1]
                        n[y-8:y+h+8,x-a] = n[y-8:y+h+8,x]; n[y-8:y+h+8,x+w-1+a] = n[y-8:y+h+8,x+w-1]
                frgb,fnrm = self.parts["face_"+name]
            else:
                c,nrm = self.parts["skin_"+picture_of(b["P"])]
                n = np.concatenate((nrm,self.zones.get("skin_"+picture_of(b["P"]),np.ones((SIZE,SIZE))*5)[...,None]/5),axis=2)
                frgb,_,fnrm = fp.paint(fp.BASE_LOOKS[picture_of(b["P"])], SIZE)
            entries[name] = {"clothes":len(cloth_names),"face":len(face_names)}
            faces[name] = len(face_names)
            cloth_names.append(name); face_names.append(name)
            c = np.concatenate((c, n[:,:,3:4]),axis=2)
            save(name+"_colour",c,directory); save(name+"_normal",n[:,:,:3],directory,True)
            save(name+"_face_colour",frgb,directory); save(name+"_face_normal",fnrm,directory,True)
        if "held" in self.parts:
            rgb,nrm = self.parts["held"]
            entries["people2_held"] = {"clothes":len(cloth_names),"face":0}
            cloth_names.append("held")
            save("held_colour",np.concatenate((rgb,np.zeros((SIZE,SIZE,1))),axis=2),directory); save("held_normal",nrm,directory,True)
        detail_names = detail(directory)
        manifest = {"version":1,"size":SIZE,"clothes":cloth_names,"faces":face_names,"entries":entries,"heads":faces,"faceIds":{str(i):i for i in range(len(face_names))},"zones":ZONES,"detail":detail_names,
            "zoneChannel":"clothes colour alpha = zone / 5 (linear); face flag = vertex green", "headUV":"full square", "shaderKindsAdded":0}
        with open(os.path.join(directory,"manifest.json"),"w") as f: json.dump(manifest,f,indent=2)
        return manifest

def detail(directory):
    # Periodic integer harmonics keep both values and derivatives seamless.
    y,x = np.mgrid[:512,:512] * (2*np.pi/512)
    names = ["none","wool","linen","canvas","leather","skin"]
    for i,name in enumerate(names):
        weave = np.sin(x*32)*np.cos(y*32)
        fine = np.sin(x*73+y*51)*np.cos(y*67-x*29)
        h = [np.zeros_like(x), fine*.65 + weave*.2,
             weave*.65 + np.sin(x*8)*np.sin(y*32)*.2,
             np.sin(x*16)*np.cos(y*16)*.8 + fine*.15,
             fine*.35 + np.sin(x*13+y*17)*np.cos(y*19)*.35,
             fine*.3 + np.sin(x*41+y*37)*np.cos(y*43-x*31)*.3][i]
        dy,dx = (np.roll(h,-1,axis=a)-np.roll(h,1,axis=a) for a in (0,1))
        n = np.stack((-dx*.35,-dy*.35,np.ones_like(x)),axis=2)
        n /= np.linalg.norm(n,axis=2,keepdims=True)
        c = np.stack([np.clip(.5+h*.08,0,1)]*3,axis=2)
        save("detail_"+name+"_colour",c,directory)
        save("detail_"+name+"_normal",n*.5+.5,directory,True)
    return ["detail_"+name for name in names]
