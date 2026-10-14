using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Native.Authoring;
using Scheldemist.Native.World;
using Scheldemist.World;
namespace Scheldemist.Native.Interiors;

/// <summary>One-time mapping of the existing hall/prison sitting plans to permanent scene objects.</summary>
public partial class FurnitureAnchorIntake : Node
{
    private sealed record Binding(string Room,string Id,float[] Original,float[] Local,float Height,float Yaw);
    public override void _Ready(){try{Run();GetTree().Quit();}catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}}
    private void Run()
    {
        if(Godot.FileAccess.FileExists("res://world/interiors/seat-bindings.json") && Scheldemist.Native.Game.NativeArguments.Arg("rebuild-migration-only")!="yes")throw new InvalidOperationException("Seat bindings already exist; preserve their ids.");
        var bindings=new List<Binding>();using var halls=JsonDocument.Parse(Scheldemist.People.HallPeopleData.Json);
        foreach(var room in halls.RootElement.GetProperty("rooms").EnumerateArray())
        {
            string id=room.GetProperty("id").GetString()!;var origin=room.GetProperty("origin");var frame=new Transform3D(new Basis(Vector3.Up,room.GetProperty("yaw").GetSingle()),new(origin.GetProperty("x").GetSingle(),room.GetProperty("floorY").GetSingle(),origin.GetProperty("z").GetSingle()));
            var marks=new List<(JsonElement mark,float height)>();
            if(!halls.RootElement.GetProperty("roles").TryGetProperty(id,out var roles))continue;
            foreach(var role in roles.EnumerateObject())
            {
                if(!role.Value.TryGetProperty("sit",out var seat))continue;
                if(role.Value.TryGetProperty("at",out var at)&&room.GetProperty("marks").TryGetProperty(at.GetString()!,out var mark))marks.Add((mark,seat.GetSingle()));
                if(role.Value.TryGetProperty("set",out var set)&&room.GetProperty("sets").TryGetProperty(set.GetString()!,out var points))marks.AddRange(points.EnumerateArray().Select(p=>(p,seat.GetSingle())));
            }
            BindRoom(id,frame,marks,bindings);
        }
        using var prison=JsonDocument.Parse(Scheldemist.People.PrisonData.Json);var p=prison.RootElement;var o=p.GetProperty("origin");var pf=new Transform3D(new Basis(Vector3.Up,p.GetProperty("yaw").GetSingle()),new(o.GetProperty("x").GetSingle(),0,o.GetProperty("z").GetSingle()));
        var pm=new List<(JsonElement,float)>();foreach(var spec in p.GetProperty("specs").EnumerateArray())if(spec.GetProperty("motion").GetString()=="sit")
        {
            var home=spec.GetProperty("home");string text=JsonSerializer.Serialize(new{x=home[0].GetSingle(),z=home[1].GetSingle(),y=spec.GetProperty("y").GetSingle(),yaw=spec.GetProperty("yaw").GetSingle()});pm.Add((JsonDocument.Parse(text).RootElement.Clone(),spec.GetProperty("seat").GetSingle()));
        }
        BindRoom("prison",pf,pm,bindings);
        File.WriteAllText(ProjectSettings.GlobalizePath("res://world/interiors/seat-bindings.json"),JsonSerializer.Serialize(bindings,new JsonSerializerOptions{PropertyNamingPolicy=JsonNamingPolicy.CamelCase,WriteIndented=true}));GD.Print("Permanent seat bindings: "+bindings.Count);
    }
    private static void BindRoom(string room,Transform3D frame,List<(JsonElement mark,float height)> marks,List<Binding> bindings)
    {
        string id="room-"+room;var district=ResourceLoader.Load<AuthorDistrict>(NativeDistrictLayouts.ResourcePath(id));var seed=NativeDistrictLayouts.ReadSeed(district);var objects=seed.GetChildren().OfType<AuthoredObject>().Where(o=>!o.ObjectId.Contains("-role-seat-",StringComparison.Ordinal)).ToList();var catalog=district.Catalog;var root=new Node3D{Name="Objects"};int added=0;
        try
        {
            foreach(var entry in marks)
            {
                var m=entry.mark;var original=frame*new Vector3(m.GetProperty("x").GetSingle(),m.TryGetProperty("y",out var y)?y.GetSingle():0,m.GetProperty("z").GetSingle());float yaw=frame.Basis.GetEuler().Y+(m.TryGetProperty("yaw",out var turn)?turn.GetSingle():0);
                if(bindings.Any(b=>b.Room==room&&LayoutDocument.Vector(b.Original).DistanceTo(original)<.01f))continue;
                var candidates=objects.Where(n=>n.Asset!.FurnitureKind is "chair" or "bench" or "settle" or "fitting").Where(n=>
                {
                    var a=n.Asset!;var local=n.Transform.AffineInverse()*original-a.FootprintOffset;
                    return Math.Abs(local.X)<=a.Footprint.X/2+.18f && Math.Abs(local.Z)<=a.Footprint.Z/2+.18f && a.FootprintOffset.Y+a.Footprint.Y>= (n.Transform.AffineInverse()*original).Y+entry.height-.15f && a.FootprintOffset.Y<=(n.Transform.AffineInverse()*original).Y+entry.height+.15f && a.Footprint.Y<1.6f;
                }).OrderBy(n=>n.Asset!.Footprint.X*n.Asset.Footprint.Z).ToArray();
                var node=candidates.FirstOrDefault();
                if(node==null)
                {
                    var asset=ResourceLoader.Load<AuthorAsset>("res://assets/library/furniture-chair.tres");node=new AuthoredObject{ObjectId=id+"-role-seat-"+added++,Name="role_seat_"+added,Asset=asset,Transform=new(Basis.FromEuler(new(0,yaw,0)),original)};objects.Add(node);
                }
                var point=node.Transform.AffineInverse()*original;
                if(node.Asset!.Id!="furniture-chair")
                {
                    var a=node.Asset;if(!a.SeatPoints.Any(v=>v.DistanceTo(point)<.01f))a.SeatPoints=a.SeatPoints.Append(point).ToArray();a.SeatHeight=entry.height;a.SeatYaw=yaw-node.Rotation.Y;
                    if(a.FurnitureKind=="fitting")
                    {
                        a.FurnitureKind=a.Footprint.X>1.2f||a.Footprint.Z>1.2f?"bench":"chair";
                        a.Title=a.Title.Replace("fitting ·",a.FurnitureKind+" ·",StringComparison.Ordinal);
                        string sourceScene=ProjectSettings.GlobalizePath(a.Scene!.ResourcePath);
                        File.WriteAllText(sourceScene,File.ReadAllText(sourceScene).Replace("Kind = \"fitting\"","Kind = \""+a.FurnitureKind+"\"",StringComparison.Ordinal));
                    }
                    ResourceSaver.Save(a,a.ResourcePath);
                }
                bindings.Add(new(room,node.ObjectId,LayoutDocument.Floats(original),LayoutDocument.Floats(point),entry.height,yaw-node.Rotation.Y));
            }
            foreach(var node in objects){var copy=new AuthoredObject{Name="object_"+node.ObjectId,ObjectId=node.ObjectId,Asset=node.Asset};copy.Pose(node.Record());root.AddChild(copy);copy.Owner=root;}
            var scene=new PackedScene();scene.Pack(root);ResourceSaver.Save(scene,"res://world/interiors/"+id+".objects.tscn");GD.Print(room+": "+marks.Count+" seat marks, "+added+" code-built chairs promoted");
        }
        finally{foreach(var node in objects.Where(n=>n.GetParent()==null))node.Free();root.Free();seed.Free();}
    }
}
