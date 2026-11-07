using System;
using System.Collections.Generic;
using System.Linq;
using System.Reflection;
using Godot;
using Scheldemist.World.Ruien;
using Scheldemist.World;

public partial class StartupHookProof : Node
{
    private static void Copy(ArrayMesh target,ArrayMesh source,int surface,Godot.Collections.Array arrays)
    {
        target.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays,null,null,source.SurfaceGetFormat(surface)&~Mesh.ArrayFormat.FlagCompressAttributes);
        int i=target.GetSurfaceCount()-1;target.SurfaceSetName(i,source.SurfaceGetName(surface));target.SurfaceSetMaterial(i,source.SurfaceGetMaterial(surface));
    }
    // The pre-optimization operations are the oracle, including index normalization and exact native ray tests.
    private static ArrayMesh? Original(ArrayMesh mesh,Func<string,bool> family,Func<Vector3,bool> drop,List<Vector3> removed,Vector3? light=null,Vector3 shift=default)
    {
        bool any=false;var done=new ArrayMesh();
        for(int s=0;s<mesh.GetSurfaceCount();s++)
        {
            var arrays=mesh.SurfaceGetArrays(s);string name=mesh.SurfaceGetName(s);
            if(light is {} at)
            {
                if(name.Contains("Brass_lamp")||name.Contains("Lamp_"))
                {
                    var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();
                    for(int i=0;i<p.Length;i++)if(new Vector2(p[i].X-at.X,p[i].Z-at.Z).Length()<.09f&&p[i].Y>at.Y-.14f&&p[i].Y<at.Y+.2f){p[i]+=shift;any=true;}
                    arrays[(int)Mesh.ArrayType.Vertex]=p;
                }
            }
            else if(family(name))
            {
                var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                if(ix.Length==0)ix=Enumerable.Range(0,p.Length).ToArray();
                var keep=new List<int>();
                for(int t=0;t<ix.Length;t+=3)
                    if(drop((p[ix[t]]+p[ix[t+1]]+p[ix[t+2]])/3)){any=true;removed.AddRange(new[]{p[ix[t]],p[ix[t+1]],p[ix[t+2]]});}
                    else keep.AddRange(new[]{ix[t],ix[t+1],ix[t+2]});
                if(keep.Count==0)continue;
                arrays[(int)Mesh.ArrayType.Index]=keep.ToArray();
            }
            Copy(done,mesh,s,arrays);
        }
        if(any)return done;done.Dispose();return null;
    }
    private static bool Same(ArrayMesh? a,ArrayMesh? b)
    {
        if(a==null||b==null)return a==b;
        if(a.GetSurfaceCount()!=b.GetSurfaceCount())return false;
        for(int s=0;s<a.GetSurfaceCount();s++)
            if(a.SurfaceGetName(s)!=b.SurfaceGetName(s)||a.SurfaceGetMaterial(s)!=b.SurfaceGetMaterial(s)||!GD.VarToBytes(a.SurfaceGetArrays(s)).SequenceEqual(GD.VarToBytes(b.SurfaceGetArrays(s))))return false;
        return true;
    }
    private static (Vector3,Vector3)? OriginalWall(List<ArrayMesh> walls,Vector3 at,Vector3 dir)
    {
        var from=at-dir*.8f;const float reach=1.8f;float best=reach;var normal=-dir;
        foreach(var mesh in walls)
        {
            if(!mesh.GetAabb().Grow(.1f).IntersectsSegment(from,from+dir*reach))continue;
            for(int s=0;s<mesh.GetSurfaceCount();s++)
            {
                if(!mesh.SurfaceGetName(s).Contains("brick"))continue;
                var arrays=mesh.SurfaceGetArrays(s);var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                for(int t=0;t+2<ix.Length;t+=3)
                {
                    Vector3 a=p[ix[t]],b=p[ix[t+1]],c=p[ix[t+2]];
                    if(Geometry3D.RayIntersectsTriangle(from,dir,a,b,c).Obj is not Vector3 hit)continue;
                    float d=from.DistanceTo(hit);if(d>=best)continue;best=d;normal=(b-a).Cross(c-a).Normalized();if(normal.Dot(dir)>0)normal=-normal;
                }
            }
        }
        return best<reach?(from+dir*best,normal):null;
    }
    private static int OriginalDrop(Node3D town,Func<MeshInstance3D,bool> pick,string[] materials,Transform3D inv,Aabb local,float keepAbove)
    {
        int dropped=0;
        foreach(var mi in BakedWorld.All(town).OfType<MeshInstance3D>())
        {
            if(mi.Mesh is not ArrayMesh mesh)continue;
            bool byName=pick(mi);if(!byName&&materials.Length==0)continue;
            var xf=Transform3D.Identity;for(Node? n=mi;n is Node3D n3;n=n.GetParent())xf=n3.Transform*xf;
            var to=inv*xf;if(!(to*mesh.GetAabb()).Intersects(local))continue;
            var cut=new ArrayMesh{ResourceName=mesh.ResourceName};int here=0;
            for(int si=0;si<mesh.GetSurfaceCount();si++)
            {
                var arrays=mesh.SurfaceGetArrays(si);string mat=mesh.SurfaceGetMaterial(si)?.ResourceName??"";
                if((byName||materials.Any(m=>mat.Contains(m,StringComparison.Ordinal)))&&mesh.SurfaceGetPrimitiveType(si)==Mesh.PrimitiveType.Triangles)
                    here+=RuienPatch.Drop(arrays,c=>{var q=to*c;return local.HasPoint(q)&&(keepAbove<=0||q.Y<keepAbove);});
                cut.AddSurfaceFromArrays(mesh.SurfaceGetPrimitiveType(si),arrays,null,null,mesh.SurfaceGetFormat(si));
                cut.SurfaceSetMaterial(si,mesh.SurfaceGetMaterial(si));cut.SurfaceSetName(si,mesh.SurfaceGetName(si));
            }
            if(here==0){cut.Dispose();continue;}
            foreach(var key in mesh.GetMetaList())cut.SetMeta(key,mesh.GetMeta(key));mi.Mesh=cut;dropped+=here;
        }
        return dropped;
    }
    private static int DropProof(ArrayMesh mesh)
    {
        var method=typeof(RuienEntrance).GetMethod("Drop",BindingFlags.NonPublic|BindingFlags.Static)!;
        int cases=0;
        foreach(bool batch in new[]{false,true})foreach(float yaw in new[]{0f,.73f,1.5707963f})foreach(bool byName in new[]{false,true})
        {
            Node3D Town()
            {
                var town=new Node3D{Name="town",Transform=new Transform3D(new Basis(Vector3.Up,yaw),new Vector3(12,2,7))};
                foreach(float x in new[]{0f,5f,150f})
                {
                    var branch=new Node3D{Name="branch_"+x,Position=new Vector3(x,0,0)};town.AddChild(branch);
                    branch.AddChild(new MeshInstance3D{Name="plant",Mesh=mesh,Rotation=new Vector3(0,.2f,0)});
                }
                return town;
            }
            var old=Town();var current=Town();
            try
            {
                var inv=old.Transform.AffineInverse();var local=new Aabb(new Vector3(-1,-1,-1),new Vector3(3,3,3));
                Func<MeshInstance3D,bool> pick=_=>byName;string[] materials={"proof"};
                using var scope=batch?QuayNotch.BeginCutBatch(current):null;
                // Repeat after a change: the original batch bounds must still conservatively cover the remaining mesh.
                foreach(var box in new[]{local,local,new Aabb(new Vector3(4,-1,-1),new Vector3(3,3,3))})
                {
                    int expected=OriginalDrop(old,pick,materials,inv,box,.02f);
                    int actual=(int)method.Invoke(null,new object[]{current,pick,materials,inv,box,.02f})!;
                    var a=BakedWorld.All(old).OfType<MeshInstance3D>().ToArray();var b=BakedWorld.All(current).OfType<MeshInstance3D>().ToArray();
                    if(expected!=actual||!a.Zip(b).All(pair=>Same((ArrayMesh)pair.First.Mesh,(ArrayMesh)pair.Second.Mesh)))throw new Exception("Entrance plant cut: exact surfaces and triangle counts");
                    cases++;
                }
            }
            finally{old.Free();current.Free();}
        }
        return cases;
    }
    public override void _Ready()
    {
        try
        {
            void Check(bool ok,string label){if(!ok)throw new Exception(label);}
            using var mesh=new ArrayMesh();using var material=new StandardMaterial3D{ResourceName="proof"};
            foreach(string family in new[]{"ruien_brick_stretcher","ruien_iron","ruien_Brass_lamp","ruien_Lamp_glass"})
            {
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);
                arrays[(int)Mesh.ArrayType.Vertex]=new[]{Vector3.Zero,new Vector3(.04f,0,0),new Vector3(0,.04f,.02f),new Vector3(4,0,0),new Vector3(4.04f,0,0),new Vector3(4,.04f,.02f)};
                arrays[(int)Mesh.ArrayType.Normal]=Enumerable.Repeat(Vector3.Back,6).ToArray();arrays[(int)Mesh.ArrayType.TexUV]=Enumerable.Range(0,6).Select(i=>new Vector2(i*.1f,i*.2f)).ToArray();
                if(family!="ruien_iron")arrays[(int)Mesh.ArrayType.Index]=Enumerable.Range(0,6).ToArray();
                mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);int index=mesh.GetSurfaceCount()-1;mesh.SurfaceSetName(index,family);mesh.SurfaceSetMaterial(index,material);
            }
            int edits=0,rays=0;
            foreach(var family in new Func<string,bool>[] {_=>true,n=>n=="ruien_iron",n=>n.Contains("brick"),_=>false})
                foreach(var drop in new Func<Vector3,bool>[] {_=>false,p=>p.X<1,_=>true})
                {
                    var oldRemoved=new List<Vector3>();var newRemoved=new List<Vector3>();
                    using var old=Original(mesh,family,drop,oldRemoved);using var current=RuienHook.Without(mesh,family,drop,newRemoved);
                    Check(Same(old,current)&&oldRemoved.SequenceEqual(newRemoved),"Bracket filter, arrays, materials and removal order");edits++;
                }
            var moved=typeof(RuienHook).GetMethod("Moved",BindingFlags.NonPublic|BindingFlags.Static)!;
            foreach(var light in new[]{Vector3.Zero,new Vector3(4,0,0),new Vector3(99,0,0)})foreach(var shift in new[]{Vector3.Zero,new Vector3(.1f,0,.2f)})
            {
                using var old=Original(mesh,_=>false,_=>false,new(),light,shift);using var current=(ArrayMesh?)moved.Invoke(null,new object[]{mesh,light,shift});
                Check(Same(old,current),"Lamp movement arrays/materials");edits++;
            }
            using var wall=new ArrayMesh();var points=new List<Vector3>();
            for(int y=-6;y<6;y++)for(int z=-6;z<6;z++)
            {
                float x=((y+z)&1)*.02f;Vector3 a=new(x,y,z),b=new(x,y+1,z),c=new(x,y+1,z+1),d=new(x,y,z+1);
                points.AddRange(new[]{a,b,c,a,c,d});
            }
            using var a0=new Godot.Collections.Array();a0.Resize((int)Mesh.ArrayType.Max);a0[(int)Mesh.ArrayType.Vertex]=points.ToArray();a0[(int)Mesh.ArrayType.Index]=Enumerable.Range(0,points.Count).ToArray();wall.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,a0);wall.SurfaceSetName(0,"ruien_brick_stretcher");
            var walls=new List<ArrayMesh>{wall};var method=typeof(RuienHook).GetMethod("Wall",BindingFlags.NonPublic|BindingFlags.Static)!;
            foreach(float x in new[]{-.8f,0f,.1f,1f,1.0001f})for(int i=-14;i<=14;i++)foreach(float jitter in new[]{0f,.00001f,.25f})
            {
                var at=new Vector3(x,i*.5f,i*.37f+jitter);var direction=Vector3.Left;
                var expected=OriginalWall(walls,at,direction);var actual=((Vector3,Vector3)?)method.Invoke(null,new object[]{walls,at,direction});
                Check(expected==actual,"Conservative ray rejection at "+at);rays++;
            }
            int cuts=DropProof(mesh);
            GD.Print($"STARTUP_HOOK_PASS: {cuts} entrance cuts, {edits} mesh edits and {rays} native ray comparisons, exact arrays/materials/removals and hit normals");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
