using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Native.World;

/// <summary>Check full collector width and the actual head mapping against native ground.</summary>
public partial class RuienDrainBurialProbe : Node3D
{
    private readonly List<object> failures=new();
    private int samples;
    private void Ground(Node node,Transform3D xf,string path)
    {
        if(node is Node3D spatial)xf*=spatial.Transform;
        path+="/"+node.Name;
        if(node is MeshInstance3D mesh&&mesh.Mesh!=null)
        {
            var bounds=xf*mesh.Mesh.GetAabb();
            if(bounds.Position.Y<12&&bounds.End.Y>-8)
            {
                var faces=mesh.Mesh.GetFaces();var keep=new List<Vector3>();
                for(int i=0;i+2<faces.Length;i+=3)
                {
                    var a=xf*faces[i];var b=xf*faces[i+1];var c=xf*faces[i+2];
                    if(MathF.Abs((b-a).Cross(c-a).Normalized().Y)<.4f||MathF.Min(a.Y,MathF.Min(b.Y,c.Y))>12||MathF.Max(a.Y,MathF.Max(b.Y,c.Y))< -8)continue;
                    keep.Add(a);keep.Add(b);keep.Add(c);
                }
                if(keep.Count>0)
                {
                    var body=new StaticBody3D{CollisionLayer=1,CollisionMask=0};body.SetMeta("source",path);
                    body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=keep.ToArray(),BackfaceCollision=true}});AddChild(body);
                }
            }
        }
        foreach(var child in node.GetChildren())Ground(child,xf,path);
    }
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            var net=RuienDrainNetwork.Read(Arg("--network"),Arg("--kit"),RuienData.Load());
            using var roots=JsonDocument.Parse(Godot.FileAccess.GetFileAsString("res://world/town/roots.json"));
            var included=new HashSet<string>{"city","town_wall","park_nature","townplaces","tide_mud"};var groundPaths=new List<string>();
            foreach(var row in roots.RootElement.EnumerateArray())
            {
                if(!included.Contains(row.GetProperty("godotName").GetString()!))continue;
                string path=row.GetProperty("path").GetString()!;groundPaths.Add(path);
                var node=ResourceLoader.Load<PackedScene>(path).Instantiate<Node3D>();
                NativePavingBacking.Lay(node,GD.Print);Ground(node,Transform3D.Identity,"");node.Free();
            }
            for(int i=0;i<3;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var space=GetWorld3D().DirectSpaceState;
            void Check(string id,float u,float lateral,Vector3 at)
            {
                using var ray=PhysicsRayQueryParameters3D.Create(new Vector3(at.X,12,at.Z),new Vector3(at.X,-8,at.Z),1);ray.HitBackFaces=true;
                var hit=space.IntersectRay(ray);samples++;
                if(hit.Count>0&&hit["position"].AsVector3().Y>=at.Y+.1f)return;
                failures.Add(new{id,u,lateral,at=new[]{at.X,at.Y,at.Z},ground=hit.Count>0?(float?)hit["position"].AsVector3().Y:null,
                    source=hit.Count>0?(hit["collider"].AsGodotObject() as Node)?.GetMeta("source").AsString():""});
            }
            foreach(var c in net.Collectors)
            {
                float length=c.Along[^1];int count=Math.Max(1,(int)Math.Ceiling(length/.2));
                for(int i=0;i<=count;i++)
                {
                    float u=length*i/count;var at=c.At(u);var t=c.Tangent(u);var side=new Vector3(-t.Z,0,t.X).Normalized();
                    foreach(float lateral in new[]{-.68f,0,.68f})Check("collector/"+c.Id,u,lateral,at+side*lateral+Vector3.Up*1.8f);
                }
            }
            var barrel=new List<(Vector2 P,Vector2 T)>();
            for(int i=0;i<10;i++)barrel.Add((new Vector2(0,-.9f*i/9),new Vector2(0,-1)));
            for(int i=1;i<14;i++)
            {
                float a=Mathf.DegToRad(70)*i/13;
                barrel.Add((new Vector2(1.05f*(1-MathF.Cos(a)),-.9f-1.05f*MathF.Sin(a)),new Vector2(MathF.Sin(a),-MathF.Cos(a))));
            }
            for(int i=0;i<5;i++){var end=barrel[^1];barrel.Add((end.P+end.T*.18f,end.T));}
            foreach(var h in net.Heads)
                for(int i=0;i<barrel.Count;i++)foreach(float lateral in new[]{-.68f,0,.68f})
                {
                    var row=barrel[i];var across=new Vector2(-row.T.Y,row.T.X);var p=row.P+across*lateral;
                    Check("head/"+h.Id,i,lateral,h.Map(new Vector3(p.X,h.Invert+1.8f,p.Y-h.Template.HalfWidth)));
                }
            var inputHashes=InputFiles.Hash(new[]{Arg("--network"),RuienData.AreasFile});
            var groundInputs=InputFiles.HashWithDependencies(groundPaths).Select(p=>new{path=p.Path,sha256=p.Sha256}).ToArray();
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{samples,errors=failures.Count,failures,networkSha256=inputHashes[0],areasSha256=inputHashes[1],
                nativeGeometryCode=StartupCacheCode.Revision(typeof(NativePavingBacking).Assembly),groundInputs},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"DRAIN BURIAL: {samples} samples, {failures.Count} exposed or unproven points");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
