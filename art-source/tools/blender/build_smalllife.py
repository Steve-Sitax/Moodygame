"""Build package H: Blender skinned sources plus baked skins for the native MultiMesh path.

blender -b --factory-startup --python-exit-code 1 -P art-source/tools/blender/build_smalllife.py -- --plain .scratch/smalllife-plain/smalllife.glb
No third-party inputs. The native game loads stored resources, never Blender or a GLB.
"""
import gzip
import hashlib
import json
import os
import struct
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0,str(Path(__file__).resolve().parent))
from smalllife import models, motion, paint
from animals.pictures import png_bytes, IMPORT

ROOT=Path(__file__).resolve().parents[3]
DEST=ROOT/'native-godot/assets/smalllife'
C=np.array([[1.,0,0],[0,0,-1],[0,1,0]])
ARGS=sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else []
PLAIN=Path(ARGS[ARGS.index('--plain')+1]).resolve() if '--plain' in ARGS else ROOT/'.scratch/smalllife-plain/smalllife.glb'
if not PLAIN.is_relative_to(ROOT/'.scratch'):raise ValueError('Plain intake must stay in this worktree .scratch')
ONLY=ARGS[ARGS.index('--only')+1].split(',') if '--only' in ARGS else models.KINDS


def picture(name,data,normal=False):
    fn=DEST/(name+'.png');fn.write_bytes(png_bytes(data))
    preset=IMPORT.replace('animal-pictures','smalllife').format(name=fn.name,hq='false' if normal else 'true',nm=1 if normal else 0)
    (DEST/(fn.name+'.import')).write_text(preset,encoding='utf8')
    return hashlib.sha256(fn.read_bytes()).hexdigest()


def object_mesh(kind,m,J):
    mesh=bpy.data.meshes.new(kind)
    mesh.from_pydata((np.array(m.v)@C.T).tolist(),[],m.f);mesh.update()
    for p in mesh.polygons:p.use_smooth=True
    uv=mesh.uv_layers.new(name='UVMap');lookup=mesh.uv_layers.new(name='SkinVertex')
    for loop in mesh.loops:
        uv.data[loop.index].uv=m.uv[loop.vertex_index]
        weights=sorted(m.weights[loop.vertex_index].items(),key=lambda q:-q[1])
        if len(weights)>2:raise ValueError('palette supports two blended bones')
        first=weights[0];second=weights[1] if len(weights)>1 else (first[0],0.)
        names=list(J)
        # Keep bone indices away from integer boundaries: Godot quantises UVs in stored meshes.
        # A zero weight at exactly N can become N-epsilon and select the previous bone.
        lookup.data[loop.index].uv=(names.index(first[0])+.25+first[1]*.5,1-(names.index(second[0])+.25+second[1]*.5))
    colours=mesh.color_attributes.new(name='Col',type='FLOAT_COLOR',domain='POINT')
    for i,d in enumerate(colours.data):d.color=(m.eye[i],0,0,1)
    # Float normals from Blender agree across the closed lofts and UV seams.
    normals=np.empty(len(mesh.vertices)*3,np.float32);mesh.vertices.foreach_get('normal',normals)
    normals=normals.reshape(-1,3)@C
    ob=bpy.data.objects.new(kind,mesh);bpy.context.scene.collection.objects.link(ob)
    return ob,normals


def source_rig(kind,ob,m,J,parents,clips,Gs):
    arm=bpy.data.armatures.new(kind+'_rig');ao=bpy.data.objects.new(kind+'_source',arm)
    bpy.context.scene.collection.objects.link(ao);bpy.context.view_layer.objects.active=ao;ao.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    for n,p in J.items():
        b=arm.edit_bones.new(n);b.head=Vector(C@p);b.tail=Vector(C@(np.array(p)+[0,.04,0]))
        b.align_roll(Vector((0,1,0)))
    for n,par in parents.items():
        if par:arm.edit_bones[n].parent=arm.edit_bones[par]
    bpy.ops.object.mode_set(mode='OBJECT');ao.select_set(False)
    skin=ob.copy();skin.data=ob.data.copy();skin.name=kind+'_skin';bpy.context.scene.collection.objects.link(skin)
    skin.parent=ao;mod=skin.modifiers.new('smooth_skin','ARMATURE');mod.object=ao
    for n in J:
        vg=skin.vertex_groups.new(name=n)
        for i,w in enumerate(m.weights):
            if w.get(n,0)>0:vg.add([i],w[n],'REPLACE')
    rest={b.name:np.array(b.matrix_local) for b in arm.bones}
    CB=np.eye(4);CB[:3,:3]=C
    for clip,info in clips.items():
        action=bpy.data.actions.new(kind+'_'+clip);action.use_fake_user=True;ao.animation_data_create().action=action
        frames=Gs[clip]+[Gs[clip][0]]
        for i,G in enumerate(frames):
            for n in J:
                def bone_global(b):
                    inverse=np.eye(4);inverse[:3,3]=-np.array(J[b])
                    return CB@G[b]@inverse@CB.T@rest[b]
                gb=bone_global(n);par=parents[n]
                parent=bone_global(par) if par else np.eye(4)
                local=np.linalg.inv(parent)@gb
                restlocal=np.linalg.inv(rest[par])@rest[n] if par else rest[n]
                basis=Matrix((np.linalg.inv(restlocal)@local).tolist())
                pb=ao.pose.bones[n];pb.rotation_mode='QUATERNION';pb.matrix_basis=basis
                fr=i*info['seconds']/motion.FRAMES*30
                for prop in ('location','rotation_quaternion','scale'):pb.keyframe_insert(prop,frame=fr)
        tr=ao.animation_data.nla_tracks.new();tr.name=action.name
        strip=tr.strips.new(action.name,1,action);tr.mute=True;ao.animation_data.action=None
    for pb in ao.pose.bones:pb.matrix_basis=Matrix.Identity(4)


def main():
    DEST.mkdir(parents=True,exist_ok=True);PLAIN.parent.mkdir(parents=True,exist_ok=True)
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    report={'format':1,'framesPerClip':motion.FRAMES,'kinds':{},'pictures':{},'notes':
            'All silhouettes use rounded lofts. Feather edges, horn tips, claws and whisker tips intentionally thin/pointed. Hidden tube ends mate inside bodies. No gameplay collision on these decorative animals.'}
    for kind in ONLY:
        m,J,parents,contacts,h=models.build(kind);J={k:np.array(v) for k,v in J.items()}
        ob,normals=object_mesh(kind,m,J);col,nrm=paint.pictures(kind)
        for suffix,data in [('colour',col),('normal',nrm)]:report['pictures'][kind+'_'+suffix+'.png']=picture(kind+'_'+suffix,data,suffix=='normal')
        mat=bpy.data.materials.new(kind);mat.use_nodes=True
        bsdf=mat.node_tree.nodes.get('Principled BSDF');bsdf.inputs['Base Color'].default_value=(*col.mean(axis=(0,1)),1);bsdf.inputs['Roughness'].default_value=.8
        ob.data.materials.append(mat)
        clips=motion.clips(kind,h);Gs={}
        positions=[];norms=[];palettes=[];normal_palettes=[];joint_gap=0.;v=np.c_[np.array(m.v),np.ones(len(m.v))]
        W={n:np.array([w.get(n,0) for w in m.weights]) for n in J}
        for clip,info in clips.items():
            Gs[clip]=[]
            for i in range(motion.FRAMES):
                G=motion.pose(kind,J,parents,contacts,h,clip,i/motion.FRAMES,info['stride'],info['duty']);Gs[clip].append(G)
                for up,low,foot,hip,knee,toe in contacts:
                    end=G[low][:3,3]+G[low][:3,:3]@(J[foot]-J[low])
                    joint_gap=max(joint_gap,float(np.linalg.norm(end-G[foot][:3,3])))
                p=np.zeros((len(v),3));nrm_=np.zeros_like(p)
                palette=[];normal_palette=[]
                for n in J:
                    inv=np.eye(4);inv[:3,3]=-J[n];D=G[n]@inv
                    palette.extend(D[:3,:])
                    nr=np.zeros((3,4));nr[:3,:3]=np.linalg.inv(D[:3,:3]).T
                    normal_palette.extend(nr)
                    p+=(v@D.T)[:,:3]*W[n][:,None]
                    nrm_+=(normals@np.linalg.inv(D[:3,:3]))*W[n][:,None]
                nrm_/=np.maximum(np.linalg.norm(nrm_,axis=1)[:,None],1e-9)
                palettes.append(np.array(palette,dtype="<f2"));normal_palettes.append(np.array(normal_palette,dtype="<f2"))
                positions.append(np.c_[p,np.ones(len(p))].astype('<f2'))
                norms.append(np.c_[nrm_,np.ones(len(p))].astype('<f2'))
        vat=struct.pack('<II',len(J)*3,len(positions))+np.array(palettes).tobytes()+np.array(normal_palettes).tobytes()
        with open(DEST/(kind+'_skin.bin'),'wb') as f:
            with gzip.GzipFile(fileobj=f,mode='wb',mtime=0) as z:z.write(vat)
        source_rig(kind,ob,m,J,parents,clips,Gs)
        # A conservative local box includes spread wings and all action poses, used for instance culling.
        points=np.array(positions)[...,:3].astype(np.float32)
        lo=points.min(axis=(0,1))-.01;hi=points.max(axis=(0,1))+.01
        contact_error=0.
        for name,info in clips.items():
            if not info['stride']:continue
            # Measure IK contact positions during stance with the clip's root motion added.
            for i,c in enumerate(contacts):
                off=i*.25 if len(contacts)==4 and name=='walk' else (0,.5,.5,0)[i] if len(contacts)==4 else i*.5
                for t in np.linspace(0,info['duty']-.001,100):
                    phase=(t-off)%1;G=motion.pose(kind,J,parents,contacts,h,name,phase,info['stride'],info['duty'])
                    # Measure the world-space toe AFTER root travel; comparing it only to a desired local
                    # target would miss a stride/duty error and could report zero while every foot slides.
                    expected=np.array(c[5])+[0,0,info['stride']*info['duty']*.5]
                    world=G[c[2]][:3,3]+[0,0,info['stride']*t]
                    contact_error=max(contact_error,float(np.linalg.norm(world-expected)))
        report['kinds'][kind]={'height':h,'vertices':len(v),'triangles':len(m.f),'bones':len(J),'clips':clips,
                             'min':lo.tolist(),'max':hi.tolist(),'stanceErrorMm':contact_error*1000,'jointGapMm':joint_gap*1000,
                             'vatBytes':len(vat),'vatSha256':hashlib.sha256((DEST/(kind+'_skin.bin')).read_bytes()).hexdigest()}
        print(kind,report['kinds'][kind],flush=True)
    bpy.context.scene.render.fps=30
    master=ROOT/'art-source/client/public/models/smalllife.glb'
    options=dict(export_format='GLB',export_yup=True,export_materials='EXPORT',export_extras=True,export_vertex_color='ACTIVE')
    bpy.ops.export_scene.gltf(filepath=str(master),**options,export_animations=True,
        export_animation_mode='NLA_TRACKS',export_force_sampling=True,export_skins=True,
        export_rest_position_armature=True,export_optimize_animation_size=False,export_anim_slide_to_zero=True)
    # Native MultiMesh uses the baked bone palette, so import only the common rest surfaces. The
    # fully skinned, animated source above retains every bone, weight and clip for editing/rebuilding.
    bpy.ops.object.select_all(action='DESELECT')
    for kind in ONLY:bpy.data.objects[kind].select_set(True)
    bpy.ops.export_scene.gltf(filepath=str(PLAIN),**options,use_selection=True,export_animations=False,export_skins=False)
    (DEST/'kit.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8')
    print('SMALLLIFE BUILD COMPLETE',len(report['kinds']),flush=True)


if __name__=='__main__':main()
