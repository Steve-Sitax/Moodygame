using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Player;
using Scheldemist.Native.Services;
/// <summary>
/// Early look at the staged network's own solids without the town: every exported area's collision with its
/// seam profiles and fold bridges, then a person on each walkway and Antigoon on each bed, plus the planned
/// walk, join and bed-seam lines. Native additions (entrance passages, drain heads, gates, landing blocks) are
/// absent, so a finding here is a lead; NativeRuienNetworkProof in the assembled town is the acceptance.
/// </summary>
public partial class RuienRouteNetworkProbe:Node3D
{
    public override async void _Ready()
    {
        try
        {
            var args=OS.GetCmdlineUserArgs();string output=args[Array.IndexOf(args,"--out")+1];var data=RuienData.Load();
            using var spec=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
            var definitions=spec.RootElement.GetProperty("areas").EnumerateArray().ToDictionary(a=>a.GetProperty("id").GetString()!);
            var loaded=new HashSet<string>();
            // --assembled: every area as the game loads it (entrance openings, drain mouths and seams cut in),
            // the drain network's solids and every connected entrance passage. Only the town is absent.
            bool assembled=args.Contains("--assembled");
            if(assembled)RuienDrainNetwork.Active=RuienDrainNetwork.Installed(data);
            foreach(var area in data.Areas)
            {
                string file=area.Export+"/collision.res";
                if(!ResourceLoader.Exists(file)&&!File.Exists(file))continue;
                if(assembled)
                {
                    // the game's own collision steps (RuienArea.Load), without its drawn meshes or its cache
                    var source=ResourceLoader.Load<ConcavePolygonShape3D>(file);var faces=source.Data;
                    using var cut=new Godot.Collections.Array();cut.Resize((int)Mesh.ArrayType.Max);cut[(int)Mesh.ArrayType.Vertex]=faces;
                    RuienSeams.Apply(cut,area);RuienStreetClosure.Trim(cut,area);RuienConnections.TrimImported(cut,area.Id);RuienEntrance.TrimConnected(cut,area.Id);
                    if(RuienDrainNetwork.Active is {} net&&net.ByArea.ContainsKey(area.Id)&&faces.Length>0)
                    {
                        var bounds=new Aabb(faces[0],Vector3.Zero);foreach(var face in faces)bounds=bounds.Expand(face);
                        RuienDrainNetwork.Trim(net,cut,area.Id,bounds);
                    }
                    RuienSurround.Trim(cut,area);RuienSurround.DropExportLeaves(cut,area,null);
                    var points=cut[(int)Mesh.ArrayType.Vertex].AsVector3Array();var index=cut[(int)Mesh.ArrayType.Index].VariantType==Variant.Type.Nil?Array.Empty<int>():cut[(int)Mesh.ArrayType.Index].AsInt32Array();
                    var solid=new StaticBody3D{Name=area.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                    solid.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=index.Length>0?index.Select(i=>points[i]).ToArray():points,BackfaceCollision=true}});AddChild(solid);
                    AddChild(RuienConnections.Build(definitions[area.Id],area));
                    foreach(var bridge in area.Bridges)AddChild(RuienFoldBridge.Build(bridge,data.Bridge));
                    loaded.Add(area.Id);continue;
                }
                var original=ResourceLoader.Load<ConcavePolygonShape3D>(file);
                using var arrays=new Godot.Collections.Array();arrays.Resize((int)Mesh.ArrayType.Max);arrays[(int)Mesh.ArrayType.Vertex]=original.Data;
                RuienSeams.Apply(arrays,area);var body=new StaticBody3D{Name=area.Id,CollisionLayer=Solid.Layer,CollisionMask=0};
                body.AddChild(new CollisionShape3D{Shape=new ConcavePolygonShape3D{Data=arrays[(int)Mesh.ArrayType.Vertex].AsVector3Array(),BackfaceCollision=true}});AddChild(body);
                foreach(var bridge in area.Bridges)AddChild(RuienFoldBridge.Build(bridge,data.Bridge));
                if(definitions[area.Id].TryGetProperty("landingBlocks",out _))AddChild(RuienConnections.Build(definitions[area.Id],area));
                loaded.Add(area.Id);
            }
            var passages=new List<RuienEntrance.Spec>();
            if(assembled)
            {
                if(RuienDrainNetwork.Active is {} drains)AddChild(RuienDrainNetwork.Prepare(drains).Root);
                foreach(var s in RuienEntrance.All.Where(s=>s.ConnectArea.StartsWith("network_")&&loaded.Contains(s.ConnectArea)))
                {
                    var stair=new Node3D{Name="entrance_"+s.Id,Transform=s.Local};stair.AddChild(RuienEntrance.BuildConnection(s));AddChild(stair);passages.Add(s);
                }
            }
            var space=GetWorld3D().DirectSpaceState;var errors=new List<object>();int samples=0;
            using var person=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
            using var giant=new CapsuleShape3D{Radius=AntigoonSize.ClearanceRadius,Height=3.86f-AntigoonSize.Step};
            object? Try(string id,Vector3 expected,bool large)
            {
                float y=float.NegativeInfinity;float spread=large?.12f:.05f;
                foreach(var offset in new[]{Vector2.Zero,new Vector2(spread,0),new Vector2(-spread,0),new Vector2(0,spread),new Vector2(0,-spread)})
                {
                    var p=expected+new Vector3(offset.X,0,offset.Y);
                    var ground=space.IntersectRay(PhysicsRayQueryParameters3D.Create(p+Vector3.Up*.28f,p-Vector3.Up*.5f,Solid.Layer));
                    if(ground.Count>0&&ground["normal"].AsVector3().Y>.5f)y=Math.Max(y,ground["position"].AsVector3().Y);
                }
                if(!float.IsFinite(y)||MathF.Abs(y-expected.Y)>(large?.5f:Jef.Step+.03f))
                    return new{id,large,error="no support at the intended level",at=expected.ToString(),ground=y.ToString()};
                var feet=new Vector3(expected.X,y+.012f,expected.Z);
                using var query=new PhysicsShapeQueryParameters3D{Shape=large?giant:person,CollisionMask=Solid.Layer,Margin=0,
                    Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*(large?AntigoonSize.Step+giant.Height/2:Jef.Step+(Jef.Tall-Jef.Step)/2))};
                var hits=space.IntersectShape(query,8);
                return hits.Count==0?null:new{id,large,error="body blocked",at=feet.ToString(),hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.Name.ToString()).Distinct().ToArray(),
                    contacts=space.CollideShape(query,4).Select(p=>p.ToString()).ToArray()};
            }
            void Test(string id,Vector3 expected,bool large=false){samples++;if(Try(id,expected,large) is {} error)errors.Add(error);}
            // A walker is free to keep nearer the water (a ladder or the low haunch of the vault narrows the wall
            // side) or, on a broad gallery ledge, nearer the wall. One clear body position per station is a pass.
            void Walk(string id,Vector3 expected,Vector2 across,float[] shifts)
            {
                samples++;var tries=new List<object>();
                foreach(float shift in shifts)
                {
                    var error=Try(id,expected+new Vector3(across.X,0,across.Y)*shift,false);
                    if(error==null)return;tries.Add(error);
                }
                errors.Add(new{id,large=false,error="no clear body position across the walkway",at=expected.ToString(),tries});
            }
            Vector3 V(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
            void Way(string id,Vector3 a,Vector3 b)
            {
                samples++;if(!Scheldemist.Native.World.NativeRuienNetworkProof.Reach(space,a,b,out string detail))errors.Add(new{id,large=false,error="no walkable way",detail});
            }
            void Segment(string name,Vector3 a,Vector3 b,bool large=false,float step=.25f)
            {
                int n=Math.Max(1,(int)MathF.Ceiling(a.DistanceTo(b)/step));for(int i=0;i<=n;i++)Test(name,a.Lerp(b,i/(float)n),large);
            }
            foreach(var s in passages)
            {
                // the passage from the stair's landing to the ledge it joins, in stations a body's walk apart
                var f=RuienEntrance.LinkFrame(s);var path=s.ConnectPath.Length>1?s.ConnectPath:new[]{f.Origin,f*new Vector3(0,0,s.ConnectLength)};
                var from=path[0];float run=0;
                for(int i=1;i<path.Length;i++)
                {
                    run+=path[i-1].DistanceTo(path[i]);
                    if(run<1.2f&&i<path.Length-1)continue;
                    Way("entrance/"+s.Id,from,path[i]);from=path[i];run=0;
                }
            }
            if(assembled)
            {
                RuienFoldBridge.ProofPhase=1;for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                int connected=await Scheldemist.Native.World.NativeRuienNetworkProof.ValidateRooms(this,data,(id,at,large)=>Test(id,at,large),errors,true);
                GD.Print($"ASSEMBLED ROOMS: {connected} connected");
            }
            foreach(bool large in new[]{false,true})
            {
                RuienFoldBridge.ProofPhase=large?1:0;for(int i=0;i<4;i++)await ToSignal(GetTree(),SceneTree.SignalName.PhysicsFrame);
                foreach(var definition in definitions.Values)
                {
                    string id=definition.GetProperty("id").GetString()!;if(!loaded.Contains(id))continue;
                    if(!large&&definition.TryGetProperty("walkProof",out var runs))foreach(var run in runs.EnumerateArray())
                        Way(id+"/"+run.GetProperty("name").GetString(),V(run.GetProperty("from")),V(run.GetProperty("to")));
                    if(definition.TryGetProperty(large?"bedJoinProof":"joinProof",out var joins))foreach(var join in joins.EnumerateArray())
                    {
                        var points=join.GetProperty("points").EnumerateArray().Select(V).ToArray();
                        for(int i=0;i+1<points.Length;i++)
                            if(large)Segment(id+"/bed-seam/"+join.GetProperty("name").GetString(),points[i],points[i+1],true,.2f);
                            else Way(id+"/join/"+join.GetProperty("name").GetString(),points[i],points[i+1]);
                    }
                }
                if(!large)foreach(var area in data.Areas.Where(a=>loaded.Contains(a.Id)))foreach(var bridge in area.Bridges)Way("bridge/"+bridge.Id,bridge.A,bridge.B);
                foreach(var area in data.Areas.Where(a=>loaded.Contains(a.Id)&&(a.Id.StartsWith("network_")||a.Id.StartsWith("r1_l"))&&a.Zones[0].Kind=="line"))
                {
                    var zone=area.Zones[0];float start=1,end=zone.Length-1;
                    if(definitions[area.Id].TryGetProperty("walkRange",out var range)){start=range[0].GetSingle();end=range[1].GetSingle();}
                    for(float u=start;u<=end;u+=.5f)
                    {
                        var (p,t)=zone.Frame(u);var across=new Vector2(t.Y,-t.X);
                        foreach(int side in (large?Array.Empty<int>():new[]{-1,1}).Where(zone.S.HasWalk))
                        {
                            float offset=(zone.S.Width/2-zone.S.Ledge+Jef.Radius+.05f)*side;var q=p+across*offset;
                            Walk(area.Id+"/walk/"+side,new Vector3(q.X,zone.S.LedgeY,q.Y),across*side,zone.S.Ledge>1?new[]{0,-.12f,-.24f,.3f,.6f}:new[]{0,-.1f,-.2f,-.3f});
                        }
                        if(large)Test(area.Id+"/bed",new Vector3(p.X,zone.S.Bed,p.Y),true);
                    }
                }
                await ToSignal(GetTree(),SceneTree.SignalName.ProcessFrame);
            }
            File.WriteAllText(output,JsonSerializer.Serialize(new{pass=errors.Count==0,areas=loaded.Count,samples,errors},new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"ROUTE NETWORK PROBE: {loaded.Count} areas, {samples} samples, {errors.Count} findings");GetTree().Quit(errors.Count==0?0:1);
        }
        catch(Exception e){GD.PrintErr(e);GetTree().Quit(1);}
    }
}
