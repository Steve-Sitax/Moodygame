using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Reflection;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Native.World;
using Scheldemist.Player;
using Scheldemist.Native.Services;

/// <summary>Focused native fixtures of a hall/route together with its actual gate and stairs.</summary>
public partial class RuienObstacleProbe : Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string Arg(string k)=>args[Array.IndexOf(args,k)+1];
            var wanted=Arg("--only").Split(',').ToHashSet();var data=RuienData.Load();
            var loaded=wanted.Concat(args.Contains("--context")?Arg("--context").Split(','):Array.Empty<string>()).ToHashSet();
            var entryIds=args.Contains("--entries")?Arg("--entries").Split(',').ToHashSet():new HashSet<string>();
            using var spec=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
            var defs=spec.RootElement.GetProperty("areas").EnumerateArray().ToDictionary(a=>a.GetProperty("id").GetString()!);
            foreach(var area in data.Areas.Where(a=>loaded.Contains(a.Id)))
            {
                var source=ResourceLoader.Load<ConcavePolygonShape3D>(area.Export+"/collision.res");
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=source.Data;
                RuienSeams.Apply(arrays,area);RuienEntrance.TrimConnected(arrays,area.Id);RuienConnections.TrimImported(arrays,area.Id);
                RuienConnections.TrimCollisionMouths(arrays,area.Id);
                var p=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array();var ix=arrays[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Array.Empty<int>():arrays[(int)Mesh.ArrayType.Index].AsInt32Array();
                var body=new StaticBody3D{Name=area.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=ix.Length>0?ix.Select(i=>p[i]).ToArray():p,BackfaceCollision=true}});AddChild(body);
                AddChild(RuienConnections.Build(defs[area.Id],area));
                foreach(var bridge in area.Bridges)AddChild(RuienFoldBridge.Build(bridge,data.Bridge));
            }
            var gates=RuienNetworkGates.Read();gates.Specs.RemoveAll(s=>!data.Areas.Any(a=>wanted.Contains(a.Id)&&a.Gates.Any(g=>g.Id==s.Id)));
            AddChild(gates.Build());gates.Update(0,-6);
            if(args.Contains("--with-drains")&&RuienDrainNetwork.Installed(data)is {} drainage)
                foreach(var head in drainage.Heads.Where(h=>loaded.Contains(h.Area)))
                {
                    var original=ResourceLoader.Load<ConcavePolygonShape3D>(drainage.Kit+"/"+head.Template.Name+"_collision.res");
                    var body=new StaticBody3D{Name="head_"+head.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                    body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=original.Data.Select(head.Map).ToArray(),BackfaceCollision=true}});AddChild(body);
                }
            var build=typeof(RuienEntrance).GetMethod("BuildStructure",BindingFlags.Static|BindingFlags.NonPublic)!;
            foreach(var entry in RuienEntrance.All.Where(s=>entryIds.Contains(s.Id)))AddChild((Node3D)build.Invoke(null,new object[]{entry})!);
            RuienFoldBridge.ProofPhase=0;for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            var space=GetWorld3D().DirectSpaceState;var errors=new List<object>();int checks=0;
            if(args.Contains("--walk-stations"))
            {
                using var person=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
                using var disk=new CylinderShape3D{Radius=Jef.Radius*.6f,Height=.02f};
                foreach(var area in data.Areas.Where(a=>wanted.Contains(a.Id)))foreach(var zone in area.Zones.Where(z=>z.Kind=="line"&&z.Length>5))
                    for(float u=1;u<=zone.Length-1;u+=.5f)foreach(int side in new[]{-1,1}.Where(zone.S.HasWalk))
                    {
                        checks++;var(p,t)=zone.Frame(u);var across=new Vector2(t.Y,-t.X)*side;bool clear=false;
                        foreach(float shift in zone.S.Ledge>1?new[]{0,-.12f,-.24f,.3f,.6f}:new[]{0,-.1f,-.2f,-.3f})
                        {
                            var q=p+across*(zone.S.Width/2-zone.S.Ledge+Jef.Radius+.05f+shift);var at=new Vector3(q.X,zone.S.LedgeY,q.Y);
                            float start=at.Y+Jef.Step+.015f;
                            using var support=new PhysicsShapeQueryParameters3D{Shape=disk,CollisionMask=Solid.Layer,Margin=0,
                                Transform=new Transform3D(Basis.Identity,new Vector3(at.X,start,at.Z)),Motion=Vector3.Down*1.2f};
                            var fractions=space.CastMotion(support);if(fractions[1]>=1)continue;
                            if(fractions[1]<=0)
                            {
                                using var ray=PhysicsRayQueryParameters3D.Create(at+Vector3.Up*Jef.Step,at-Vector3.Up*1.2f,Solid.Layer);
                                var floor=space.IntersectRay(ray);if(floor.Count==0)continue;at.Y=floor["position"].AsVector3().Y;
                            }
                            else at.Y=start-.01f-fractions[0]*1.2f;
                            if(MathF.Abs(at.Y-zone.S.LedgeY)>Jef.Step+.03f)continue;
                            using var query=new PhysicsShapeQueryParameters3D{Shape=person,CollisionMask=Solid.Layer,Margin=0,
                                Transform=new Transform3D(Basis.Identity,at+Vector3.Up*(.012f+Jef.Step+person.Height/2))};
                            if(space.IntersectShape(query,1).Count==0){clear=true;break;}
                        }
                        if(!clear)errors.Add(new{id=area.Id+"/walk/"+side,u,error="no clear body position"});
                    }
            }
            void Way(string id,Vector3 a,Vector3 b)
            {checks++;if(!NativeRuienNetworkProof.Reach(space,a,b,out string detail))errors.Add(new{id,detail});}
            Vector3 V(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
            if(args.Contains("--bed-joins"))
            {
                using var giantShape=new CapsuleShape3D{Radius=AntigoonSize.ClearanceRadius,Height=3.86f-AntigoonSize.Step};
                foreach(var area in data.Areas.Where(a=>wanted.Contains(a.Id)))
                    if(defs[area.Id].TryGetProperty("bedJoinProof",out var joins))foreach(var join in joins.EnumerateArray())
                    {
                        var points=join.GetProperty("points").EnumerateArray().Select(V).ToArray();
                        for(int segment=0;segment+1<points.Length;segment++)
                        {
                            var a=points[segment];var b=points[segment+1];int n=(int)MathF.Ceiling(a.DistanceTo(b)/.15f);
                            for(int i=0;i<=n;i++)
                            {
                                checks++;var at=a.Lerp(b,i/(float)n);
                                using var ray=PhysicsRayQueryParameters3D.Create(at+Vector3.Up*.28f,at-Vector3.Up*.5f,Solid.Layer);
                                var floor=space.IntersectRay(ray);
                                if(floor.Count==0){errors.Add(new{id=join.GetProperty("name").GetString(),at=at.ToString(),error="no floor"});continue;}
                                at.Y=floor["position"].AsVector3().Y;
                                using var query=new PhysicsShapeQueryParameters3D{Shape=giantShape,CollisionMask=Solid.Layer,Margin=0,
                                    Transform=new Transform3D(Basis.Identity,at+Vector3.Up*(.012f+AntigoonSize.Step+giantShape.Height/2))};
                                var hits=space.IntersectShape(query,8);
                                if(hits.Count>0)errors.Add(new{id=join.GetProperty("name").GetString(),at=at.ToString(),error="body blocked",
                                    hits=hits.Select(h=>(h["collider"].AsGodotObject()as Node)?.GetPath().ToString()).ToArray()});
                            }
                        }
                    }
            }
            foreach(var area in data.Areas.Where(a=>wanted.Contains(a.Id)&&!args.Contains("--bed-joins-only")))
            {
                if(defs[area.Id].TryGetProperty("walkProof",out var runs))foreach(var r in runs.EnumerateArray())Way(area.Id+"/"+r.GetProperty("name").GetString(),V(r.GetProperty("from")),V(r.GetProperty("to")));
                if(defs[area.Id].TryGetProperty("walkDetours",out var detours))foreach(var d in detours.EnumerateArray())
                {
                    var points=d.GetProperty("points").EnumerateArray().Select(V).ToArray();
                    for(int i=0;i+1<points.Length;i++)Way(area.Id+"/detour/"+d.GetProperty("name").GetString(),points[i],points[i+1]);
                }
                foreach(var bridge in area.Bridges)Way(bridge.Id,bridge.A,bridge.B);
                foreach(var zone in area.Zones.Where(z=>z.Kind=="line"&&z.Length>5))
                {
                    float start=1,end=zone.Length-1;
                    if(defs[area.Id].TryGetProperty("walkRange",out var range)){start=range[0].GetSingle();end=range[1].GetSingle();}
                    foreach(int side in new[]{-1,1}.Where(zone.S.HasWalk))
                        for(float u=start;u<end;u+=3)
                        {
                            if(defs[area.Id].TryGetProperty("walkDetours",out var bypasses)&&bypasses.EnumerateArray().Any(d=>
                                d.GetProperty("side").GetInt32()==side&&u+3>=d.GetProperty("start").GetSingle()&&u<=d.GetProperty("end").GetSingle()))continue;
                            Vector3 At(float s){var(p,t)=zone.Frame(s);var q=p+new Vector2(t.Y,-t.X)*(side*(zone.S.Width/2-zone.S.Ledge+.37f));return new(q.X,zone.S.LedgeY,q.Y);}
                            if(args.Contains("--junctions")&&!RuienEntrance.All.Where(e=>entryIds.Contains(e.Id)).Any(e=>
                                (e.ConnectPath.Length>1?e.ConnectPath[^1]:RuienEntrance.LinkFrame(e)*new Vector3(0,0,e.ConnectLength)).DistanceTo(At(u))<6))continue;
                            Way(zone.Id+"/ledge/"+side,At(u),At(Math.Min(u+3,end)));
                        }
                }
            }
            if(args.Contains("--giant"))
            {
                RuienFoldBridge.ProofPhase=1;for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                using var shape=new CapsuleShape3D{Radius=AntigoonSize.ClearanceRadius,Height=3.86f-AntigoonSize.Step};
                data.Areas.RemoveAll(a=>!wanted.Contains(a.Id));
                void Body(string id,Vector3 at,bool large)
                {
                    checks++;using var query=new PhysicsShapeQueryParameters3D{Shape=shape,CollisionMask=Solid.Layer,Margin=0,
                        Transform=new Transform3D(Basis.Identity,at+Vector3.Up*(.012f+AntigoonSize.Step+shape.Height/2))};
                    var hits=space.IntersectShape(query,8);
                    if(hits.Count>0)errors.Add(new{id,at=at.ToString(),hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.GetPath().ToString()).ToArray()});
                }
                int connected=await NativeRuienNetworkProof.ValidateRooms(this,data,Body,errors,args.Contains("--room-seams"));
                foreach(var area in data.Areas.Where(a=>a.Zones[0].Kind=="line"))
                {
                    var zone=area.Zones[0];float start=1,end=zone.Length-1;
                    if(defs[area.Id].TryGetProperty("walkRange",out var range)){start=range[0].GetSingle();end=range[1].GetSingle();}
                    for(float u=start;u<end;u+=.4f){var(p,t)=zone.Frame(u);Body(area.Id+"/giant-bed",new Vector3(p.X,zone.S.Bed,p.Y),true);}
                }
                int rooms=data.Areas.Count(a=>a.Zones[0].Kind=="room");
                if(connected!=rooms)errors.Add(new{error="disconnected room",connected,rooms});
            }
            RuienFoldBridge.ProofPhase=0;for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
            foreach(var entry in RuienEntrance.All.Where(s=>entryIds.Contains(s.Id)&&s.ConnectLength>0))
            {
                var f=RuienEntrance.LinkFrame(entry);var p=entry.ConnectPath.Length>1?entry.ConnectPath:new[]{f.Origin,f*new Vector3(0,0,entry.ConnectLength)};
                var from=entry.Route[^1];Way(entry.Id+"/landing",entry.World(from),p[0]);
                for(int i=0;i<p.Length-1;i+=10)Way(entry.Id+"/passage",p[i],p[Math.Min(i+10,p.Length-1)]);
            }
            var floorSamples=new List<object>();
            if(args.Contains("--floor-at"))
            {
                var p=Arg("--floor-at").Split(',').Select(v=>float.Parse(v,System.Globalization.CultureInfo.InvariantCulture)).ToArray();
                for(float x=-1;x<=1.01f;x+=.1f)foreach(float z in new[]{-.8f,0,.8f})
                {
                    using var ray=PhysicsRayQueryParameters3D.Create(new Vector3(p[0]+x,-4.4f,p[1]+z),new Vector3(p[0]+x,-12,p[1]+z),Solid.Layer);
                    var hit=space.IntersectRay(ray);floorSamples.Add(new{x=p[0]+x,z=p[1]+z,
                        hit=hit.Count>0?hit["position"].AsVector3().ToString():"none",normal=hit.Count>0?hit["normal"].AsVector3().ToString():"",
                        body=hit.Count>0?(hit["collider"].AsGodotObject()as Node)?.GetPath().ToString():""});
                }
            }
            File.WriteAllText(Arg("--out"),JsonSerializer.Serialize(new{pass=errors.Count==0,checks,errors,floorSamples},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"RUIEN OBSTACLE PROBE: {checks} checks, {errors.Count} failures");GetTree().Quit(errors.Count==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
