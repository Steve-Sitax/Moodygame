using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Native.World;
using Scheldemist.Native.Services;
public partial class RuienRoomNetworkProbe:Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];var data=RuienData.Load();
            int onlyAt=Array.IndexOf(args,"--only");var only=onlyAt<0?null:args[onlyAt+1].Split(',').ToHashSet(StringComparer.OrdinalIgnoreCase);
            var selected=data.Areas.Where(a=>a.Id.StartsWith("network_")&&a.Zones[0].Kind=="room"&&(only==null||only.Contains(a.Id))).ToArray();
            if(only!=null)data.Areas.RemoveAll(a=>!selected.Contains(a));
            RuienFoldBridge.ProofPhase=1;
            foreach(var area in selected)
            {
                var original=ResourceLoader.Load<ConcavePolygonShape3D>(area.Export+"/collision.res");
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=original.Data;
                RuienSeams.Apply(arrays,area);var body=new StaticBody3D{Name=area.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(),BackfaceCollision=true}});AddChild(body);
                foreach(var bridge in area.Bridges)AddChild(RuienFoldBridge.Build(bridge,data.Bridge));
            }
            for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            using var shape=new CapsuleShape3D{Radius=AntigoonSize.ClearanceRadius,Height=3.86f-AntigoonSize.Step};
            var errors=new List<object>();int samples=0;var space=GetWorld3D().DirectSpaceState;
            void Check(string id,Vector3 at,bool large)
            {
                samples++;using var query=new PhysicsShapeQueryParameters3D{Shape=shape,CollisionMask=Solid.Layer,Margin=0,
                    Transform=new Transform3D(Basis.Identity,at+Vector3.Up*(.012f+AntigoonSize.Step+shape.Height/2))};
                var hits=space.IntersectShape(query,4);
                if(hits.Count>0)errors.Add(new{id,at=at.ToString(),error="body blocked",hits=hits.Select(h=>(h["collider"].AsGodotObject()as Node)?.GetPath().ToString()).ToArray(),
                    contacts=space.CollideShape(query,8).Select(p=>p.ToString()).ToArray()});
            }
            int connected=await NativeRuienNetworkProof.ValidateRooms(this,data,Check,errors,false);
            bool pass=connected==selected.Length&&errors.Count==0;
            File.WriteAllText(output,JsonSerializer.Serialize(new{pass,rooms=selected.Length,connected,samples,errors},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"ROOM NETWORK PROBE: {connected}/{selected.Length} connected, {errors.Count} failures");GetTree().Quit(pass?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
