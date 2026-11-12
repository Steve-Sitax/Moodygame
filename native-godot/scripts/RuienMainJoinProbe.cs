using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Player;
public partial class RuienMainJoinProbe:Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string key)=>args[Array.IndexOf(args,key)+1];
            using var spec=JsonDocument.Parse(File.ReadAllText(Arg("--spec")));var data=RuienData.Load();
            using var areaSpec=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
            var originalLights=data.Areas.SelectMany(a=>a.Sources.Select(s=>(key:a.Id+"/"+s.Id,at:s.At))).ToDictionary(x=>x.key,x=>x.at);
            foreach(string id in spec.RootElement.GetProperty("areas").EnumerateArray().Select(x=>x.GetString()!))
            {
                var area=data.Areas.Single(a=>a.Id==id);var body=new StaticBody3D{Name=id,CollisionLayer=Solid.Layer,CollisionMask=0};
                if(area.RepairLampClearance)
                {
                    var loaded=RuienArea.Load(area)??throw new InvalidOperationException("Missing retained lamp area "+id);
                    RuienHook.Fit(area,loaded,loaded.Root);AddChild(loaded.Root);
                    body.AddChild(new CollisionShape3D{Shape=loaded.Shape});AddChild(body);continue;
                }
                var original=ResourceLoader.Load<ConcavePolygonShape3D>(area.Export+"/collision.res");
                var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=original.GetFaces();
                RuienSeams.Apply(arrays,area);
                var shape=new ConcavePolygonShape3D{BackfaceCollision=true};shape.SetFaces(arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array());
                body.AddChild(new CollisionShape3D{Shape=shape});AddChild(body);
                var definition=areaSpec.RootElement.GetProperty("areas").EnumerateArray().Single(a=>a.GetProperty("id").GetString()==id);
                if(definition.TryGetProperty("landingBlocks",out _))AddChild(RuienConnections.Build(definition,area));
                foreach(var bridge in area.Bridges)AddChild(RuienFoldBridge.Build(bridge,data.Bridge));
            }
            for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var space=GetWorld3D().DirectSpaceState;var checks=new List<object>();int blocked=0,missing=0;
            using var cylinder=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
            Vector3 V(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
            foreach(var path in spec.RootElement.GetProperty("paths").EnumerateArray())
            {
                var a=V(path.GetProperty("from"));var b=V(path.GetProperty("to"));int n=Math.Max(1,(int)MathF.Ceiling(a.DistanceTo(b)/.08f));
                if(path.TryGetProperty("source",out var source))
                {
                    string id=path.GetProperty("area").GetString()!;var zone=data.Areas.Single(a=>a.Id==id).Zones[0];var light=originalLights[id+"/"+source.GetString()];
                    zone.Inside(new Vector2(light.X,light.Z),out float u);
                    Vector3 Point(float at){var(p,t)=zone.Frame(at);var q=p+new Vector2(t.Y,-t.X)*zone.S.WalkwaySide*1.37f;return new Vector3(q.X,zone.S.LedgeY,q.Y);}
                    a=Point(u-.8f);b=Point(u+.8f);n=Math.Max(1,(int)MathF.Ceiling(a.DistanceTo(b)/.08f));
                }
                for(int i=0;i<=n;i++)
                {
                    var p=a.Lerp(b,i/(float)n);float ground=float.NegativeInfinity;
                    foreach(var offset in new[]{Vector2.Zero,new Vector2(.04f,0),new Vector2(-.04f,0),new Vector2(0,.04f),new Vector2(0,-.04f)})
                    {
                        var q=p+new Vector3(offset.X,0,offset.Y);var hit=space.IntersectRay(PhysicsRayQueryParameters3D.Create(q+Vector3.Up*.4f,q-Vector3.Up*.5f,Solid.Layer));
                        if(hit.Count>0&&hit["normal"].AsVector3().Y>.5f)ground=Math.Max(ground,hit["position"].AsVector3().Y);
                    }
                    if(!float.IsFinite(ground)){missing++;checks.Add(new{name=path.GetProperty("name").GetString(),at=p.ToString(),error="no floor"});continue;}
                    p.Y=ground+.012f;using var query=new PhysicsShapeQueryParameters3D{Shape=cylinder,CollisionMask=Solid.Layer,Margin=0,
                        Transform=new Transform3D(Basis.Identity,p+Vector3.Up*(Jef.Step+(Jef.Tall-Jef.Step)/2))};
                    var hits=space.IntersectShape(query,8);if(hits.Count>0)blocked++;
                    checks.Add(new{name=path.GetProperty("name").GetString(),at=p.ToString(),blocked=hits.Count>0,hits=hits.Select(h=>(h["collider"].AsGodotObject()as Node)?.Name.ToString()).ToArray(),contacts=hits.Count>0?space.CollideShape(query,4).Select(p=>p.ToString()).ToArray():Array.Empty<string>()});
                }
            }
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{blocked,missing,checks},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"MAIN JOIN PROBE: {blocked} blocked, {missing} unsupported");GetTree().Quit(blocked+missing==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
