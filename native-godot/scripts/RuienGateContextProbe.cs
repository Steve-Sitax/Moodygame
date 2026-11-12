using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Native.World;

/// <summary>Replay actual assembled obstructions with the runtime bed and
/// chamber repairs. The original fixture must reproduce the full-world result.</summary>
public partial class RuienGateContextProbe:Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string name)=>args[Array.IndexOf(args,name)+1];
            bool original=args.Contains("--original");
            using var document=JsonDocument.Parse(File.ReadAllText(Arg("--geometry")));
            var rooms=new Dictionary<int,string>{{2,"network_j056"},{3,"network_j051_j059"},{4,"network_j042"}};
            void Body(string name,Vector3[] points)
            {
                var body=new StaticBody3D{Name=name.Replace('/','_'),CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=points,BackfaceCollision=true}});AddChild(body);
            }
            int ordinal=0;
            foreach(var row in document.RootElement.EnumerateArray())
            {
                int index=ordinal++;
                if(!original&&index==1)continue;
                if(args.Contains("--native-context")&&index is 0 or 5)continue;
                var points=row.GetProperty("faces").EnumerateArray().Select(v=>new Vector3(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle())).ToArray();
                if(!original&&rooms.TryGetValue(index,out string? area))
                {
                    using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=points;
                    RuienConnections.TrimImported(arrays,area);
                    var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index];
                    points=ix.VariantType==Variant.Type.Nil?p:ix.AsInt32Array().Select(i=>p[i]).ToArray();
                }
                Body("source_"+index,points);
            }
            if(args.Contains("--native-context"))
            {
                using var context=JsonDocument.Parse(File.ReadAllText(Arg("--native-context")));
                var town=new Node3D{Name="quay_context"};
                foreach(var row in context.RootElement.EnumerateArray())
                {
                    if(row.GetProperty("decal").GetBoolean())continue;
                    var points=row.GetProperty("faces").EnumerateArray().Select(v=>new Vector3(v[0].GetSingle(),v[1].GetSingle(),v[2].GetSingle())).ToArray();
                    using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=points;
                    var mesh=new ArrayMesh();mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles,arrays);
                    town.AddChild(new MeshInstance3D{Name=row.GetProperty("name").GetString()!,Mesh=mesh});
                }
                foreach(var gate in RuienData.Load().Areas.SelectMany(a=>a.Gates))
                    QuayNotch.CutConvex(town,gate.Meshes,gate.Origin,gate.Normal,gate.Opening,-.6f,gate.Depth+.4f,gate.Clear);
                foreach(var mesh in BakedWorld.All(town).OfType<MeshInstance3D>())Body("context_"+mesh.Name,mesh.Mesh.GetFaces());
                town.Free();
            }
            if(!original)
            {
                var town=new Node3D{Name="mud_context"};
                town.AddChild(ResourceLoader.Load<PackedScene>("res://world/town/roots/node-01530.scn").Instantiate());
                RuienGateBed.Scour(town,RuienData.Load());
                foreach(var mesh in BakedWorld.All(town).OfType<MeshInstance3D>())
                {
                    var xf=Transform3D.Identity;for(Node? n=mesh;n is Node3D n3;n=n.GetParent())xf=n3.Transform*xf;
                    Body("scoured_mud",mesh.Mesh.GetFaces().Select(p=>xf*p).ToArray());
                    if(args.Contains("--mud-out"))ResourceSaver.Save(mesh.Mesh,Arg("--mud-out"));
                }
                town.Free();
            }
            if(args.Contains("--drainage"))
            {
                var net=RuienDrainNetwork.Read(Arg("--drainage"),Arg("--drain-kit"),RuienData.Load());
                var pipes=RuienDrainNetwork.Build(net,Array.Empty<string>(),Arg("--collectors").Split(','),drops:false);
                foreach(var mesh in BakedWorld.All(pipes).OfType<MeshInstance3D>())
                {
                    var xf=Transform3D.Identity;for(Node? n=mesh;n is Node3D n3;n=n.GetParent())xf=n3.Transform*xf;
                    Body("collector_"+mesh.Name,mesh.Mesh.GetFaces().Select(p=>xf*p).ToArray());
                }
                pipes.Free();
            }
            AddChild(RuienNetworkGates.Read().Build());
            for(int i=0;i<3;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var errors=new List<object>();int samples=NativeRuienGateClearance.Run(this,errors);
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{original,samples,failures=errors.Count,errors},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"GATE CONTEXT: {samples} samples, {errors.Count} collisions");GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
