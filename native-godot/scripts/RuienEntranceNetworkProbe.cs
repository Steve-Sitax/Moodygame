using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Player;

public partial class RuienEntranceNetworkProbe : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            var data=RuienData.Load();var specs=RuienEntrance.All.Where(s=>s.ConnectArea.StartsWith("network_")).ToArray();
            if(args.Contains("--only"))specs=specs.Where(s=>Arg("--only").Split(',').Contains(s.Id)).ToArray();
            string Describe(GodotObject obj)
            {
                if(obj is not Node node)return obj.GetClass();
                string family=node.GetIndex()>0&&node.GetParent().GetChild(node.GetIndex()-1)is MeshInstance3D{Mesh:ArrayMesh mesh}?mesh.SurfaceGetName(0):"";
                return node.GetPath()+" "+family;
            }
            var missing=new List<string>();var built=new List<RuienEntrance.Spec>();
            foreach(var s in specs)
            {
                var area=data.Areas.Single(a=>a.Id==s.ConnectArea);string file=area.Export+"/collision.res";
                if(!Godot.FileAccess.FileExists(file)){missing.Add(s.Id);continue;}
                var original=ResourceLoader.Load<ConcavePolygonShape3D>(file);
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=original.Data;
                RuienEntrance.TrimConnected(arrays,area.Id);
                var v=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                var body=new StaticBody3D{Name="host_"+s.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=(ix.Length>0?ix.Select(i=>v[i]):v).ToArray(),BackfaceCollision=true}});AddChild(body);
                var stair=new Node3D{Name="connection_"+s.Id,Transform=s.Local};stair.AddChild(RuienEntrance.BuildConnection(s));AddChild(stair);built.Add(s);
            }
            for(int i=0;i<5;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var space=GetWorld3D().DirectSpaceState;var checks=new List<object>();int blocked=0,unsupported=0;
            foreach(var s in built)
            {
                var f=RuienEntrance.LinkFrame(s);var path=s.ConnectPath.Length>1?s.ConnectPath:new[]{f.Origin,f*new Vector3(0,0,s.ConnectLength)};
                float total=0;
                for(int k=0;k+1<path.Length;k++)
                {
                    float length=path[k].DistanceTo(path[k+1]);int count=Math.Max(1,(int)MathF.Ceiling(length/.25f));
                    for(int i=0;i<=count;i++)
                    {
                        var feet=path[k].Lerp(path[k+1],i/(float)count);float u=total+length*i/count;
                        if(u<.12f)continue; // the original stair supplies the landing side of this joint
                        using var ray=PhysicsRayQueryParameters3D.Create(feet+Vector3.Up*.35f,feet-Vector3.Up*.5f,Solid.Layer);
                        var ground=space.IntersectRay(ray);
                        // At a slab joint a vertical ray can graze the riser's
                        // vertical face at t=0. That face is not a walkable floor.
                        for(int attempt=0;ground.Count>0&&ground["normal"].AsVector3().Y<.5f&&attempt<8;attempt++)
                        {
                            var exclude=ray.Exclude;exclude.Add(ground["rid"].AsRid());ray.Exclude=exclude;ground=space.IntersectRay(ray);
                        }
                        if(ground.Count==0){unsupported++;checks.Add(new{id=s.Id,u,error="no support",feet=new[]{feet.X,feet.Y,feet.Z}});continue;}
                        feet.Y=ground["position"].AsVector3().Y+.015f;
                        using var shape=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
                        using var query=new PhysicsShapeQueryParameters3D{Shape=shape,Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*(Jef.Step+(Jef.Tall-Jef.Step)/2)),CollisionMask=Solid.Layer,Margin=0};
                        var hits=space.IntersectShape(query,32);if(hits.Count>0)blocked++;
                        checks.Add(new{id=s.Id,u,feet=new[]{feet.X,feet.Y,feet.Z},ground=Describe(ground["collider"].AsGodotObject()),groundNormal=ground["normal"].AsVector3().ToString(),
                            blocked=hits.Count>0,hits=hits.Select(v=>Describe(v["collider"].AsGodotObject())).Distinct().ToArray(),
                            contacts=hits.Count>0?space.CollideShape(query,16).Select(p=>new[]{p.X,p.Y,p.Z}).ToArray():Array.Empty<float[]>()});
                    }
                    total+=length;
                }
            }
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{entrances=specs.Length,built=built.Count,missing,blocked,unsupported,checks},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"ENTRANCE NETWORK PROBE: {built.Count}/{specs.Length} built, {blocked} blocked, {unsupported} unsupported");GetTree().Quit(blocked+unsupported+missing.Count==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
