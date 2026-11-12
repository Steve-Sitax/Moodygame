using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Player;

public partial class RuienDrainNetworkProbe : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            var data=RuienData.Load();var net=RuienDrainNetwork.Read(Arg("--network"),Arg("--kit"),data);
            var poses=new List<object>();var bad=new List<string>();
            foreach(var h in net.Heads)
            {
                try
                {
                    var ring=h.SeamRing;var seam=h.Seam;
                    poses.Add(new{id=h.Id,area=h.Area,template=h.Template.Name,h.Flat,h.Curved,seam=new[]{seam.X,seam.Y,seam.Z},ringVertices=ring.Length});
                }
                catch(Exception e){bad.Add(h.Id+": "+e.Message);}
            }
            var available=net.Heads.Where(h=>!bad.Any(b=>b.StartsWith(h.Id+":"))&&data.Areas.Any(a=>a.Id==h.Area&&Godot.FileAccess.FileExists(a.Export+"/collision.res")));
            var selected=args.Contains("--all")?available.ToArray():available.GroupBy(h=>(h.Template.Name,h.Flat)).Select(g=>g.First()).Take(6).ToArray();
            if(args.Contains("--only"))selected=available.Where(h=>Arg("--only").Split(',').Contains(h.Id)).ToArray();
            foreach(var h in selected)
            {
                var area=data.Areas.Single(a=>a.Id==h.Area);var original=ResourceLoader.Load<ConcavePolygonShape3D>(area.Export+"/collision.res");
                var region=h.CutBox.Grow(3);var p=original.Data;var near=new List<Vector3>();
                for(int i=0;i+2<p.Length;i+=3)if(new Aabb(p[i],Vector3.Zero).Expand(p[i+1]).Expand(p[i+2]).Intersects(region))near.AddRange(new[]{p[i],p[i+1],p[i+2]});
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=near.ToArray();
                RuienDrainNetwork.Trim(net,arrays,h.Area,region);
                var vertices=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Enumerable.Range(0,vertices.Length).ToArray():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                var body=new StaticBody3D{Name="host_"+h.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=ix.Select(i=>vertices[i]).ToArray(),BackfaceCollision=true}});AddChild(body);
            }
            if(args.Contains("--prepare")){RuienDrainNetwork.Active=net;AddChild(RuienDrainNetwork.Prepare(net).Root);}
            else AddChild(RuienDrainNetwork.Build(net,selected.Select(h=>h.Id),Array.Empty<string>(),drops:args.Contains("--visuals"),visuals:args.Contains("--visuals")));
            for(int i=0;i<5;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var space=GetWorld3D().DirectSpaceState;var checks=new List<object>();int blocked=0;
            foreach(var h in selected)
            {
                if(!h.Crossing)continue;
                foreach(float u in new[]{-.8f,-.4f,0,.4f,.8f})
                {
                    // The walker's real cylinder follows the clear inner lane;
                    // the outer arris lies beneath the low spring of the vault.
                    float centre=h.Host.Zone.S.Width/2-h.Host.Zone.S.Ledge+Jef.Radius+.015f;
                    var feet=h.Map(new Vector3(u,h.Host.Zone.S.LedgeY,-centre));
                    using var groundRay=PhysicsRayQueryParameters3D.Create(feet+Vector3.Up*.18f,feet-Vector3.Up*.3f,Solid.Layer);
                    var ground=space.IntersectRay(groundRay);
                    if(ground.Count>0&&ground["normal"].AsVector3().Y>.5f)feet.Y=ground["position"].AsVector3().Y;
                    feet.Y+=.012f;
                    using var shape=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
                    using var query=new PhysicsShapeQueryParameters3D{Shape=shape,Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*(Jef.Step+(Jef.Tall-Jef.Step)/2)),CollisionMask=Solid.Layer,Margin=0};
                    var hits=space.IntersectShape(query,32);if(hits.Count>0)blocked++;
                    checks.Add(new{id=h.Id,u,blocked=hits.Count>0,contacts=hits.Count>0?space.CollideShape(query,16).Select(p=>new[]{p.X,p.Y,p.Z}).ToArray():Array.Empty<float[]>(),hits=hits.Select(v=>(v["collider"].AsGodotObject()as Node)?.Name.ToString()).Distinct().ToArray()});
                }
            }
            var bore=new List<object>();int fits=0;
            foreach(var h in selected.GroupBy(h=>h.Template.Name).Select(g=>g.First()))
                foreach(float lateral in new[]{-.15f,0,.15f})for(int level=-5;level<=5;level++)
                {
                    var feet=h.Map(new Vector3(lateral,h.Invert+level*.05f,-h.Host.Zone.S.Width/2-.15f));
                    using var shape=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
                    using var query=new PhysicsShapeQueryParameters3D{Shape=shape,Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*(Jef.Step+(Jef.Tall-Jef.Step)/2)),CollisionMask=Solid.Layer,Margin=0};
                    bool clear=space.IntersectShape(query,1).Count==0;if(clear)fits++;
                    bore.Add(new{id=h.Id,lateral,level=level*.05f,clear});
                }
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{heads=net.Heads.Count,selected=selected.Length,collectors=net.Collectors.Count,inlets=net.Inlets.Count,badPoses=bad,blocked,boreFits=fits,poses,checks,bore},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"DRAIN NETWORK PROBE: {bad.Count} bad poses, {blocked} blocked gutter body samples, {fits} open body positions inside egg bores");GetTree().Quit(bad.Count==0&&blocked==0&&fits==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
