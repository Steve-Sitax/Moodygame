"""Antwerp workers, 1873. Closed cloth rims; worn edges are geometry, grain is paint.

Factories reuse the fitted kiel and open working coat, without changing their originals.
Worker intake uses 14k/2.5k budgets and paints AFTER reduction and final unwrap.
Thin cloth lips and stitched seams intentionally remain crisp; wooden/leather corners
are rounded by the subdivision surface. No sack or vehicle is welded into a body.
"""
import copy
import math
import os

import numpy as np

from . import body as bd, clothes_kit as ck, dress as dr, lod, pictures as at, weights as wt
from . import kinds_workers as kw, kinds_cast as kc
from .clothes_kit import Cloth, hexrgb, sm


def work_finish(ctx):
    """Stitches, repaired elbows, occupational dust with clean creases under folds."""
    m = ctx.piece.meta
    n = ck._noise3(ctx.pos, 26, 73)
    exposed = ~ctx.inner
    if m.get("soot"):
        dust = sm(.18, .75, n) * exposed
        ctx.mix(dust * m["soot"], (.045, .039, .033))
        ctx.bump(dust, .00007)
    if m.get("flour"):
        dust = sm(.15, .7, n) * exposed
        dust *= .35 + .65 * sm(bd.Y(ctx.fit.P, .75), bd.Y(ctx.fit.P, .45), ctx.y)
        ctx.mix(dust * m["flour"], (.79, .76, .67))
        ctx.bump(dust, .00008)
    if m.get("patched"):
        for sg in (-1, 1):
            ck.patch(ctx, (sg * ctx.fit.hip_x, ctx.fit.knee_y + .01, .075),
                     (.033, .055), (.28, .25, .20))
    if "apron_top" in m:
        ck.seam_line(ctx, ctx.y - m["apron_bottom"] - .016)
        pocket = (np.abs(ctx.x + .055) < .048) & (np.abs(ctx.y - m["apron_top"] + .085) < .045)
        ctx.mul(pocket & exposed, .91)
        ck.seam_line(ctx, np.where(pocket & exposed, ctx.y - m["apron_top"] + .04, 1))


def finish(pc, rgb=None, weave=None, soot=0, flour=0, patched=False):
    cl = copy.copy(pc.cloth)
    if rgb is not None:
        cl.rgb = np.array(hexrgb(rgb), np.float32)
        cl.lining = cl.rgb * .75
    if weave is not None:
        cl.kind = weave
    previous = cl.extra

    def extra(ctx):
        if previous:
            previous(ctx)
        work_finish(ctx)
        if soot:
            # Legacy kiel elbow patches and wear used a blue palette. Coal and
            # soot workers' repairs are charcoal sackcloth on both faces.
            grey=ctx.rgb.mean(axis=1)
            ctx.rgb[:]=grey[:,None]*np.array((1.0,.97,.91))
    cl.extra = extra
    pc.cloth = cl
    pc.meta.update(soot=soot, flour=flour, patched=patched)
    return pc


def boots(fit, rgb=0x241a12):
    bt = ck.Piece("boots", copy.copy(kc.BOOT), scale=1.2)
    finish(bt, rgb)
    so = ck.Piece("soles", copy.copy(kc.SOLE), scale=1.2)
    for side in "LR":
        ck.shoe(fit, bt, so, side, shaft=.15)
    return [bt, so]


def cap(fit, rgb=0x2e2a26, style="flat", badge=False):
    cloth = Cloth(hexrgb(rgb), "wool" if style in ("flat", "knit") else "felt", wear=.65, dust=.25)
    crown = ck.Piece("cap", cloth, scale=1.3, hat=True)
    rim = ck.Piece("cap_peak", Cloth(hexrgb(rgb), "felt", wear=.6), scale=1.3, hat=True)
    if style == "flat":
        ids, _ = ck.flat_cap(fit, crown, rim, puff=.015)
        crown.meta["band_top"] = float(np.array(crown.V)[ids[1]][:, 1].mean())
        crown.meta["top"] = np.array(crown.V)[ids.max() + 1]
        crown.cloth.extra = kw._cap_extra
    elif style == "knit":
        # Close knitted stocking cap, rolled 18 mm band, not a brimmed natie cap.
        ids, _ = ck.flat_cap(fit, crown, rim, puff=.002, fwd=0, tilt=.007)
        rim = None
        def knit(ctx):
            rib = .5 + .5 * np.sin(np.arctan2(ctx.x, ctx.z) * 96)
            ctx.bump(rib, .00028)
            ctx.mul(rib, .9)
            ck.seam_line(ctx, ctx.y - crown.meta["band_top"])
        crown.meta["band_top"] = float(np.array(crown.V)[ids[1]][:, 1].mean())
        crown.cloth.extra = knit
    else:
        height = .145 if style == "top" else .070
        ck.kepi(fit, crown, rim, n=24, height=height, slope=0, taper=.006, tilt=.005)
        # Replace the peak by a continuous felt brim, with a rounded rolled edge.
        rim = ck.Piece("cap_peak", Cloth(hexrgb(rgb), "felt", wear=.7), scale=1.3, hat=True)
        c, top = ck.head_axis(fit)
        y = bd.Y(fit.P, .870) + fit.P["hs"] * .125
        angles = np.arange(32) * 2 * math.pi / 32
        r = ck.head_support(fit, y, angles) + .013
        rows = []
        for out, dy in ((0, 0), (.035, -.004), (.046, -.001), (.048, .004)):
            rows.append(np.stack([c[0] + (r + out) * np.sin(angles),
                                  np.full(32, y + dy), c[2] + (r + out) * np.cos(angles)], -1))
        rim.grid(np.array(rows), ck.hat_weights, closed=True, seam_col=16)
        rim.orient((0, 1, 0))
        if style == "bowler":
            # A bowler has a domed crown, not the flat drum of a kepi.
            crown=ck.Piece("cap",cloth,scale=1.3,hat=True)
            a=np.arange(24)*2*math.pi/24
            radius=ck.head_support(fit,y+.012,a)+.013
            height=max(.095,top+.020-y)
            rings=[]
            for t,factor in ((0,1),(.12,1),(.40,.95),(.70,.78),(.90,.48),(.985,.16)):
                rings.append(np.stack([c[0]+radius*factor*np.sin(a),np.full(24,y+height*t),
                                       c[2]+radius*factor*np.cos(a)],-1))
            ids=crown.grid(np.array(rings),ck.hat_weights,closed=True,seam_col=12)
            pole=crown.add((c[0],y+height,c[2]),dict(ck.HEAD_ONLY))
            for j in range(24):
                crown.face((ids[-1,j],ids[-1,(j+1)%24],pole))
            crown.seam(ids[-1,12],pole)
            crown.orient(lambda q:q-np.array((c[0],y-.02,c[2])))
    ck.thicken(crown, .0025, depth=.025)
    out = [crown]
    if rim is not None:
        ck.thicken(rim, .003, depth=None, crease=.05)
        out.append(rim)
    if badge:
        def brass(ctx):
            pos = fit.snap((0, bd.Y(fit.P, .95), .15), .018, ("head", "hair"))
            ck.button(ctx, pos, r=.011, rgb=(.53, .39, .16), metal=True)
        previous = crown.cloth.extra
        def extra(ctx):
            if previous:
                previous(ctx)
            brass(ctx)
        crown.cloth.extra = extra
    return out


def shoulder_pad(fit, onto):
    sh, Y = bd.shoulder_x(fit.P), fit.Y
    path = [(sh*.66,Y(.772),.098), (sh*.72,Y(.808),.068), (sh*.75,Y(.830),.022),
            (sh*.73,Y(.832),-.030), (sh*.68,Y(.806),-.080), (sh*.62,Y(.770),-.108)]
    pc = ck.Piece("pad", copy.copy(kw.LEATHER), scale=1.3)
    ck.strap_grid(fit, pc, path, [.11,.13,.14,.14,.13,.11], .009,
                  parts=("torso","arm","neck"), cols=8, onto=onto, rows=12)
    pc.meta["centre"] = onto.snap(path[3], .005)
    ck.thicken(pc, .004, depth=None, crease=.05)
    return pc


def apron(fit, onto, leather=False, flour=False):
    cl = Cloth(hexrgb(0x65452c if leather else 0xd2cabb), "leather" if leather else "linen",
               wear=.7, mud=.4, mud_h=.22, folds=.5 if leather else 1.2, extra=work_finish)
    pc = ck.Piece("apron", cl, scale=1.2)
    top, bottom = fit.Y(.61), fit.Y(.25)
    angles = np.radians(np.linspace(-65,65,17))
    rows = []
    for i, y in enumerate(np.linspace(top,bottom,9)):
        row = []
        for a in angles:
            q = onto.snap((.4*math.sin(a),y,.4*math.cos(a)), .02) if y > fit.hip_y else np.array(
                (math.sin(a)*(.18 + .055*i/8)*fit.P["w"], y, math.cos(a)*(.15 + .055*i/8)))
            q[1] = y
            q[2] += .006 * math.cos(a * 9) * i/8
            row.append(q)
        rows.append(row)
    pc.grid(np.array(rows), lambda p: ck.hang_weights(fit,p,front_legs=1,back_legs=.3,spring=.12))
    pc.orient((0,0,1))
    pc.meta.update(apron_top=top, apron_bottom=bottom, flour=.8 if flour else 0)
    ck.thicken(pc, .003 if leather else .002, depth=None, crease=.05)
    belt = ck.Piece("apron_band", copy.copy(cl))
    belt.cloth.extra = None
    ck.band(fit,belt,onto,top,.035,d=.015)
    ck.thicken(belt,.002,depth=None)
    return [pc,belt]


def coal_hood(fit, onto):
    """A cut sack over the crown, with a protective cape on neck and shoulders."""
    cl = Cloth(hexrgb(0x554b3b), "linen", wear=.85, dust=.6, folds=.8, extra=work_finish)
    pc = ck.Piece("sack_hood",cl,scale=1.3,hat=True)
    ids = ck.hood_cap(fit,pc,margin=.012,front=-26,back=110,side=106,cols=19,rows=10)
    # The sack's open back falls to the shoulders; face stays clear.
    loop = ids[-1]
    lower = []
    for j in loop:
        p = pc.V[j].copy()
        p[1] = fit.Y(.79)
        p[0] *= 1.65
        p[2] -= .035
        lower.append(onto.snap(p,.02))
    end = [pc.add(p,fit.near_w(p,("neck","torso"))) for p in lower]
    pc.grid_faces(np.array([loop,end]))
    pc.meta["soot"] = .8
    ck.thicken(pc,.003,depth=None,crease=.05)
    return pc


def clothing(fit, profile):
    """Make independent Pieces per kind; never mutate another kind's cloth constants."""
    p = profile
    kiel = p.get("kiel",False)
    pieces = kw.docker_a_dress(fit) if kiel else kc.sooi_dress(fit)
    pieces = [pc for pc in pieces if pc.name not in ("cap","cap_peak","clogL","clogR","boots","soles")]
    if not kiel:
        if not p.get("coat"):
            pieces = [pc for pc in pieces if pc.name not in ("coat","coat_collar","cuffL","cuffR")]
        if not p.get("vest"):
            pieces = [pc for pc in pieces if pc.name != "waistcoat"]
            if p.get("coat"):
                # A coat worn open needs a real shirt below its chest panel.
                pieces = [pc for pc in pieces if pc.name != "shirt"]
                sh=ck.Piece("shirt",copy.copy(kc.SHIRT))
                ck.upper(fit,sh,rows=(2,9),neck=0,sleeve=None,ease=lambda i:.006)
                ck.thicken(sh,.002,depth=.025)
                pieces.insert(0,sh)
        # A complete shirt when not covered by a working jacket; long sleeves or rolled cuffs.
        if not p.get("coat"):
            pieces = [pc for pc in pieces if pc.name not in ("shirt","shirt_collar")]
            sh = ck.Piece("shirt",copy.copy(kc.SHIRT))
            sleeve = "f1" if p.get("rolled") else "w1"
            ck.upper(fit,sh,rows=(2,9),neck=0,sleeve=sleeve,ease=lambda i:.006)
            ck.thicken(sh,.002,depth=.025)
            pieces.insert(0,sh)
        if p.get("coat") == "short":
            co = next(pc for pc in pieces if pc.name == "coat")
            hem = fit.Y(.49)
            for v in co.V:
                if v[1] < hem:
                    v[1] = hem + .35*(v[1]-hem)
            co.meta["hem"] = min(v[1] for v in co.V)
        if p.get("ragged"):
            co = next((pc for pc in pieces if pc.name == "coat"),None)
            if co:
                hem=co.meta["hem"]
                for v in co.V:
                    a=sm(hem+.08,hem,v[1])
                    v[1] += a * .009 * math.sin(v[0]*90 + v[2]*55)
    for pc in pieces:
        if pc.name in ("shirt","smock","coat","waistcoat","pad"):
            # Loose working cloth must clear the MakeHuman shoulder sliders and
            # the rolled forearm, including the garment's inside surface.
            for v in pc.V:
                if v[1] > fit.Y(.55):
                    v += fit.surface(v,("torso","arm","neck"))[1] * .008
        key = {"smock":"shirt","coat":"coat_col","coat_collar":"coat_col","cuffL":"shirt","cuffR":"shirt",
               "kerchief_ends":"kerchief","waistcoat":"vest"}.get(pc.name,pc.name)
        finish(pc,p.get(key),soot=p.get("soot",0),flour=p.get("flour",0),
               patched=p.get("ragged",False) and pc.name=="trousers")
    if not p.get("barefoot"):
        pieces += boots(fit,p.get("boots",0x241a12))
    if p.get("hat") != "hood":
        pieces += cap(fit,p.get("hat_col",0x2e2a26),p.get("hat","flat"),p.get("badge",False))
    else:
        pieces.append(coal_hood(fit,ck.Onto(pieces)))
    if p.get("pad") and not kiel:
        pieces.append(shoulder_pad(fit,ck.Onto(pieces)))
    if p.get("apron"):
        pieces += apron(fit,ck.Onto(pieces),p["apron"]=="leather",bool(p.get("flour")))
    return pieces


def build_kind(kind, make_body, ref_uv, layout, atl, tex=2048, log=print):
    """Worker build: reduce, restore layers, unwrap, then paint the final near topology.

    Keeping this pass here leaves the round-4 cloth lane's common pipeline untouched.
    """
    base = {n:(bb,bl) for n,bb,bl in bd.BODIES}[kind.body]
    face = dr.face_of(kind,bd.params(*base))
    b,_ = make_body(kind.name,*base,ref_uv)
    import bpy
    bpy.context.view_layer.update()
    b["vparts"] = wt.parts(b["lod0"])
    fit = ck.Fit(b)
    rgb,nmap = dr.paint_body(b,kind,layout["body_"+kind.name])
    atl.put("body_"+kind.name,rgb,nmap,placed=True)
    atl.clothes_zones("body_"+kind.name,dr.paint_body.zones)
    pieces=kind.dress(fit)
    cage,_=ck.build_objects(pieces,kind.name+"_clothes_lod1")
    near=lod.subdivide(cage,kind.name+"_clothes_lod0")
    ck.to_limit_keep_creases(cage)
    for ob in (near,cage):
        dr.limit4(ob)
    # Ray deletion excludes hands: their geometry is never clothing-covered skin.
    def covered(p,part):
        return not part.startswith(("finger","hand")) and (not part.startswith("arm") or p[1]>fit.Y(.55)) and kind.covers(p,part)
    cut0=ck.cut_body(b["lod0"],covered,near)
    cut1=ck.cut_body(b["lod1"],covered,cage)
    # Closed shirt/kiel sleeves replace the hidden upper arm even when a ray
    # misses the garment near a shoulder seam; slider blending can otherwise
    # uncover one retained skin triangle there. Hands and bare forearms stay.
    hidden=lambda p,part: part=="torso" or part.startswith("arm") and p[1]>fit.Y(kind.sleeve_cut)
    cut0+=ck.cut_body(b["lod0"],hidden)
    cut1+=ck.cut_body(b["lod1"],hidden)
    if not kind.barefoot:
        # A closed shoe replaces the foot, including rays which miss the last at
        # the toes. Retaining that skin produced an exposed bare foot in one boot.
        foot=lambda p,part: part.startswith("leg") and p[1]<.13
        cut0+=ck.cut_body(b["lod0"],foot)
        cut1+=ck.cut_body(b["lod1"],foot)
    order0,order1=ck.layer_order(near),ck.layer_order(cage)
    dr.reduce_cloth(near,14000-lod.tris(b["lod0"]))
    dr.reduce_cloth(cage,2500-lod.tris(b["lod1"]))
    ck.clear_layers(near,b["lod0"],order0)
    ck.clear_layers(cage,b["lod1"],order1)
    # Layer clearance can collapse a redundant far rim onto its neighbour.
    # Discard only zero-area faces before unwrap and UV projection.
    import bmesh
    for ob in (near,cage):
        bm=bmesh.new()
        bm.from_mesh(ob.data)
        gone=[f for f in bm.faces if f.calc_area()<1e-12]
        bmesh.ops.delete(bm,geom=gone,context="FACES_ONLY")
        loose=[v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm,geom=loose,context="VERTS")
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
    scales={pc.name:pc.scale for pc in pieces}
    scales.update({"in_"+pc.name:pc.scale for pc in pieces})
    ck.unwrap(near,scales)
    ck.unwrap(cage,scales)
    # Project every reduced face into one painted near triangle of its garment.
    transfer_uv(near,cage)
    crgb,cnrm=paint_pair(near,cage,pieces,fit,tex)
    atl.put("cloth_"+kind.name,crgb,cnrm)
    atl.clothes_zones("cloth_"+kind.name,dr.paint_clothes.zones)
    b["piece_counts"]={"lod0":dr.piece_counts(near),"lod1":dr.piece_counts(cage)}
    for ob in (b["lod0"],b["lod1"]):
        at.remap_uv(ob,layout["body_"+kind.name],layout["face_"+kind.name])
    for ob in (near,cage):
        at.remap_uv(ob,layout["cloth_"+kind.name])
        ob.parent=b["ao"]
        ob.modifiers.new("rig","ARMATURE").object=b["ao"]
    n0,n1=len(b["lod0"].data.vertices),len(b["lod1"].data.vertices)
    dr.join(b["lod0"],near)
    dr.join(b["lod1"],cage)
    dr.clothes_keys(b["lod0"],b,n0,0)
    dr.clothes_keys(b["lod1"],b,n1,1)
    b.update(vparts=wt.parts(b["lod0"]),cparts=wt.parts(b["lod1"]),kind=kind,face=face,pieces=pieces,fit=fit)
    b["counts"].update(lod0=lod.tris(b["lod0"]),lod1=lod.tris(b["lod1"]))
    log("[workers] kind %s: %d / %d triangles; cut %d/%d; pieces %s" %
        (kind.name,b["counts"]["lod0"],b["counts"]["lod1"],cut0,cut1,b["piece_counts"]))
    return b


def paint_pair(near,far,pieces,fit,size):
    """Fill the far triangles' UV chords, then retain the detailed near painting.

    A reduced face can span a concave island's unpainted gap even when all corners
    stay in that island. Both copies must contribute coverage to the shared layer.
    """
    from . import paint
    far_rgb,far_nrm=dr.paint_clothes(far,pieces,fit,size)
    far_zones=dr.paint_clothes.zones.copy()
    near_rgb,near_nrm=dr.paint_clothes(near,pieces,fit,size)
    near_zones=dr.paint_clothes.zones.copy()
    _,_,part,_=paint.position_map(near,size,wt.parts(near))
    covered=part>=0
    rgb=np.where(covered[...,None],near_rgb,far_rgb)
    normal=np.where(covered[...,None],near_nrm,far_nrm)
    dr.paint_clothes.zones=np.where(covered,near_zones,far_zones)
    return rgb,normal


def transfer_uv(near,far):
    """Project by garment into painted triangles, preserving atlas boundaries."""
    from mathutils.bvhtree import BVHTree
    from mathutils import Vector
    from mathutils.geometry import barycentric_transform
    near.data.calc_loop_triangles()
    triangles=list(near.data.loop_triangles)
    parts=wt.parts(near)
    fparts=wt.parts(far)
    uv=near.data.uv_layers.active.data
    points=[v.co[:] for v in near.data.vertices]
    bypart={}
    for i,t in enumerate(triangles):
        bypart.setdefault(parts[t.vertices[0]],[]).append(i)
    def tree(ids):return BVHTree.FromPolygons(points,[triangles[i].vertices[:] for i in ids],all_triangles=True)
    trees={p:tree(ids) for p,ids in bypart.items()}
    out=far.data.uv_layers.active.data
    for face in far.data.polygons:
        part=fparts[face.vertices[0]]
        if part not in trees:continue
        centre=sum((far.data.vertices[v].co for v in face.vertices),Vector())/len(face.vertices)
        _,_,index,_=trees[part].find_nearest(centre)
        chosen=bypart[part][index]
        # Keep the reduced face inside one painted triangle. A chord across a
        # concave chart can cut through another garment's packed UV island.
        local=tree([chosen])
        for li in face.loop_indices:
            q=far.data.vertices[far.data.loops[li].vertex_index].co
            loc,_,index,_=local.find_nearest(q)
            t=triangles[chosen]
            uvs=[Vector((*uv[l].uv,0)) for l in t.loops]
            value=barycentric_transform(loc,*[near.data.vertices[v].co for v in t.vertices],*uvs)
            out[li].uv=value[:2]


def check_sheets(dressed, bodies, actions, move_clips, held_obs, directory, rig_path):
    """Proofs use the real layered pictures and each kind's face/hair, after export.

    The generic C preview only knows the export placeholder, and does not hide
    MakeHuman's loose hair library. Adapt its clone locally for these worker sheets.
    """
    import json
    from . import preview as pv, preview_c as pc, preview_mh as pm
    with open(rig_path,encoding="utf-8") as f:
        rig=json.load(f)
    with open(os.path.join(directory,"manifest.json"),encoding="utf-8") as f:
        manifest=json.load(f)
    with open(rig_path.replace("_rig.json","_faces.json") if rig_path.endswith("_rig.json")
              else os.path.join(os.path.dirname(rig_path),"faceTypes.json"),encoding="utf-8") as f:
        cells=json.load(f)["cells"]
    pm.PICS=directory
    pm._MATS.clear()
    pm._IMGS.clear()
    pm.hide_all()
    if held_obs:
        material=pm.material("held",manifest["faces"][0])
        for ob in held_obs:
            ob.data.materials.clear()
            ob.data.materials.append(material)
    original=pv.clone
    def clone(b,lod="lod0",name=None):
        face=dict(b["face"])
        if face["cell"] not in manifest["faces"]:
            face["cell"]=manifest["faces"][manifest["entries"][b["name"]]["face"]]
        ao,meshes=pm.person(b["name"],face,lod=int(lod[-1]),rig=rig,cells=cells)
        return ao,meshes[0]
    pv.clone=clone
    try:
        return pc.cast(dressed,bodies,actions,move_clips,held_obs)
    finally:
        pv.clone=original


def export_glb(path, plain=False):
    """Export authored FK keys directly; the export rig has no IK or constraints.

    Resampling the entire slotted clip bank against every dressed armature grows
    prohibitively with a wide kit. Every animated bone is already keyed at 24 fps.
    Keep that bank and dense native morphs, with the common export settings.
    """
    import bpy
    import bmesh
    from . import export
    for ob in bpy.data.objects:
        if ob.type != "MESH" or not ob.name.startswith("held_"):
            continue
        bm=bmesh.new()
        bm.from_mesh(ob.data)
        bmesh.ops.delete(bm,geom=[f for f in bm.faces if f.calc_area()<1e-12],context="FACES_ONLY")
        bm.to_mesh(ob.data)
        bm.free()
        ob.data.update()
    os.makedirs(os.path.dirname(path),exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=path,export_format="GLB",export_yup=True,export_texcoords=True,export_normals=True,
        export_materials="EXPORT",export_vertex_color="ACTIVE",use_selection=False,export_skins=True,
        export_animations=True,export_animation_mode="ACTIONS",export_force_sampling=False,
        export_image_format="AUTO",export_jpeg_quality=88,export_image_quality=88,export_extras=True,
        export_influence_nb=4,export_draco_mesh_compression_enable=not plain,export_draco_mesh_compression_level=7,
        export_draco_position_quantization=14,export_draco_normal_quantization=10,export_draco_texcoord_quantization=12,
        export_rest_position_armature=True,export_def_bones=False,export_morph_normal=export.MORPH_NORMALS or plain,
        export_try_sparse_sk=not plain)
