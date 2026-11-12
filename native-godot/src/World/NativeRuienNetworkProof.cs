using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Text.Json;
using System.Threading.Tasks;
using System.Security.Cryptography;
using System.Text;
using Godot;
using Scheldemist.World;
using Scheldemist.World.Ruien;
using Scheldemist.Player;
using Scheldemist.Native.Services;
namespace Scheldemist.Native.World;
/// <summary>Actual assembled town physics, including retained and generated Ruien solids.</summary>
public static class NativeRuienNetworkProof
{
    private static string Inputs(RuienData data)
    {
        using var hash=IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        hash.AppendData(Encoding.UTF8.GetBytes("shared-geometry\n"+StartupCacheCode.Revision(typeof(RuienData).Assembly)+"\n"));
        hash.AppendData(Encoding.UTF8.GetBytes("native-geometry\n"+StartupCacheCode.Revision(typeof(NativeTownGame).Assembly)+"\n"));
        foreach(string file in new[]{RuienData.AreasFile,RuienEntrance.File,RuienNetworkGates.File,RuienDrainNetwork.Active?.Source??""}
            .Concat(data.Areas.Select(a=>a.Export+"/intake-receipt.json")))
            if(Godot.FileAccess.FileExists(file))
            {hash.AppendData(Encoding.UTF8.GetBytes(file+"\n"));hash.AppendData(Godot.FileAccess.GetFileAsBytes(file));}
        return Convert.ToHexString(hash.GetHashAndReset());
    }
    public static async Task<bool> Run(NativeTownGame game,string output)
    {
        var data=Ruien.I!.Data;var space=game.GetViewport().World3D.DirectSpaceState;
        var errors=new List<object>();int samples=0;var counts=new Dictionary<string,int>();
        using var spec=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile));
        var definitions=spec.RootElement.GetProperty("areas").EnumerateArray().ToDictionary(a=>a.GetProperty("id").GetString()!);
        var player=Jef.I!;player.Frozen=true;player.ClearKeys();
        using var person=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
        // Match the engine's step-over clearance: keep the upright crown fixed
        // while excluding obstacles below the giant's normal step height.
        using var giant=new CapsuleShape3D{Radius=AntigoonSize.ClearanceRadius,Height=3.86f-AntigoonSize.Step};
        // A walker may keep nearer the water where a shaft ladder or the vault's haunch narrows the wall side of a
        // 0.8 m walkway, or nearer the wall on a broad gallery ledge. One clear body position per station passes;
        // the stations are half a metre apart, so the side steps between them stay walkable.
        void Walk(string id,Vector3 expected,Vector2 across,float[] shifts)
        {
            int before=errors.Count;
            foreach(float shift in shifts)
            {
                int count=errors.Count;Test(id,expected+new Vector3(across.X,0,across.Y)*shift);
                if(errors.Count==count){errors.RemoveRange(before,errors.Count-before);samples-=Array.IndexOf(shifts,shift);return;}
            }
            // every position failed: keep the first (the middle of the walkway) as the finding
            errors.RemoveRange(before+1,errors.Count-before-1);samples-=shifts.Length-1;
        }
        void Test(string id,Vector3 expected,bool large=false)
        {
            samples++;counts[id]=counts.GetValueOrDefault(id)+1;
            using var ray=PhysicsRayQueryParameters3D.Create(expected+Vector3.Up*.28f,expected-Vector3.Up*.5f,Solid.Layer);
            var floor=space.IntersectRay(ray);
            float y=large?(floor.Count>0?floor["position"].AsVector3().Y:float.NegativeInfinity):player.GroundAt(expected.X,expected.Z,expected.Y);
            if(large)foreach(var offset in new[]{new Vector2(.12f,0),new Vector2(-.12f,0),new Vector2(0,.12f),new Vector2(0,-.12f)})
            {
                var p=expected+new Vector3(offset.X,0,offset.Y);
                using var supportRay=PhysicsRayQueryParameters3D.Create(p+Vector3.Up*.28f,p-Vector3.Up*.5f,Solid.Layer);
                var ground=space.IntersectRay(supportRay);
                if(ground.Count>0&&ground["normal"].AsVector3().Y>.5f)y=Math.Max(y,ground["position"].AsVector3().Y);
            }
            if(!float.IsFinite(y)||MathF.Abs(y-expected.Y)>(large?.5f:Jef.Step+.03f))
            {errors.Add(new{id,large,error="no support at the intended level",at=expected.ToString(),ground=y.ToString()});return;}
            var feet=new Vector3(expected.X,y+.012f,expected.Z);
            using var query=new PhysicsShapeQueryParameters3D{Shape=large?giant:person,CollisionMask=Solid.Layer,Margin=0,
                Transform=new Transform3D(Basis.Identity,feet+Vector3.Up*(large?AntigoonSize.Step+giant.Height/2:Jef.Step+(Jef.Tall-Jef.Step)/2))};
            var hits=space.IntersectShape(query,8);
            if(hits.Count>0)errors.Add(new{id,large,error="body blocked",at=feet.ToString(),hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.GetPath().ToString()).ToArray(),
                contacts=space.CollideShape(query,4).Select(p=>p.ToString()).ToArray()});
        }
        Vector3 V(JsonElement p)=>new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());
        void Way(string id,Vector3 a,Vector3 b)
        {
            samples++;counts[id]=counts.GetValueOrDefault(id)+1;
            if(!Reach(space,a,b,out string detail))errors.Add(new{id,large=false,error="no walkable way",detail});
        }
        void Segment(string name,Vector3 a,Vector3 b)
        {
            int n=Math.Max(1,(int)MathF.Ceiling(a.DistanceTo(b)/.25f));for(int i=0;i<=n;i++)Test(name,a.Lerp(b,i/(float)n));
        }
        RuienFoldBridge.ProofPhase=0;for(int i=0;i<3;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
            foreach(var area in definitions.Values)
            {
                if(area.TryGetProperty("walkProof",out var runs))foreach(var run in runs.EnumerateArray())
                    Way(area.GetProperty("id").GetString()+"/"+run.GetProperty("name").GetString(),V(run.GetProperty("from")),V(run.GetProperty("to")));
                if(area.TryGetProperty("walkDetours",out var detours))foreach(var detour in detours.EnumerateArray())
                {
                    var points=detour.GetProperty("points").EnumerateArray().Select(V).ToArray();
                    for(int i=0;i+1<points.Length;i++)Way(area.GetProperty("id").GetString()+"/detour/"+detour.GetProperty("name").GetString(),points[i],points[i+1]);
                }
                if(area.TryGetProperty("joinProof",out var joins))foreach(var join in joins.EnumerateArray())
                {
                    var points=join.GetProperty("points").EnumerateArray().Select(V).ToArray();
                    for(int i=0;i+1<points.Length;i++)Way(area.GetProperty("id").GetString()+"/join/"+join.GetProperty("name").GetString(),points[i],points[i+1]);
                }
            }
        foreach(var area in data.Areas)foreach(var bridge in area.Bridges)Way("bridge/"+bridge.Id,bridge.A,bridge.B);
        var access=RuienEntrance.All.Where(e=>e.Closure=="open").ToArray();
        var doors=access.Where(e=>RuienEntranceDoor.All.ContainsKey(e.Id)).Select(e=>RuienEntranceDoor.All[e.Id]).ToArray();
        var previousDoors=doors.ToDictionary(d=>d.Spec.Id,d=>d.Target);
        foreach(var door in doors)door.Set(true);
        ulong doorDeadline=Time.GetTicksMsec()+20000;
        while(doors.Any(d=>d.Open<.999f)&&Time.GetTicksMsec()<doorDeadline)await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
        foreach(var entry in access)
        {
            if(!RuienEntranceDoor.All.TryGetValue(entry.Id,out var door)||door.Open<.999f)
            {errors.Add(new{id="street/"+entry.Id,error="entrance door did not open"});continue;}
            var route=entry.Route.Select(entry.World).ToArray();
            for(int i=0;i+1<route.Length;i++)Way("street/"+entry.Id+"/leg"+i,route[i],route[i+1]);
            if(entry.ConnectArea.Length>0)Way("street/"+entry.Id+"/bottom",route[^1],RuienEntrance.LinkFrame(entry).Origin);
        }
        foreach(var door in doors)door.Set(previousDoors[door.Spec.Id]);
        foreach(var way in data.Areas.SelectMany(a=>a.Ways).Where(w=>w.Retired))
        {
            string id="retired-street/"+way.Id;var hole=way.Hole;
            if(RuienHatch.All.ContainsKey(way.Id))errors.Add(new{id,error="retired road opening still has a moving hatch"});
            for(float x=hole.Position.X+.08f;x<hole.End.X;x+=.2f)for(float z=hole.Position.Y+.08f;z<hole.End.Y;z+=.2f)
            {
                samples++;counts[id]=counts.GetValueOrDefault(id)+1;
                using var ray=PhysicsRayQueryParameters3D.Create(new Vector3(x,.5f,z),new Vector3(x,-.7f,z),Solid.Layer);
                var hit=space.IntersectRay(ray);float y=hit.Count>0?hit["position"].AsVector3().Y:float.NegativeInfinity;
                if(y<-.03f||y>.23f)errors.Add(new{id,error="retired road opening lacks continuous paving",at=new Vector2(x,z).ToString(),ground=y.ToString()});
            }
        }
        foreach(var entry in RuienEntrance.All.Where(e=>e.ConnectArea.StartsWith("network_")))
        {
            var frame=RuienEntrance.LinkFrame(entry);var path=entry.ConnectPath.Length>1?entry.ConnectPath:new[]{frame.Origin,frame*new Vector3(0,0,entry.ConnectLength)};
            for(int i=0;i+1<path.Length;i++)
            {
                Segment("entrance/"+entry.Id,path[i],path[i+1]);
                int n=Math.Max(1,(int)MathF.Ceiling(path[i].DistanceTo(path[i+1])/.2f));
                for(int k=0;k<=n;k++)
                {
                    var eye=path[i].Lerp(path[i+1],k/(float)n)+Vector3.Up*Jef.Eye;
                    samples++;counts["entrance-cover"]=counts.GetValueOrDefault("entrance-cover")+1;
                    float cover=Ruien.I.CoverAt(eye);
                    if(cover<.95f)errors.Add(new{id="entrance/"+entry.Id,error="tunnel visibility lost from connected passage",at=eye.ToString(),cover});
                }
            }
        }
        foreach(bool large in new[]{false,true})
        {
        RuienFoldBridge.ProofPhase=large?1:0;for(int i=0;i<3;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
        if(large)foreach(var definition in definitions.Values)
            if(definition.TryGetProperty("bedJoinProof",out var bedJoins))foreach(var join in bedJoins.EnumerateArray())
            {
                var points=join.GetProperty("points").EnumerateArray().Select(V).ToArray();
                for(int k=0;k+1<points.Length;k++)
                {
                    int n=Math.Max(1,(int)MathF.Ceiling(points[k].DistanceTo(points[k+1])/.2f));
                    for(int i=0;i<=n;i++)Test(definition.GetProperty("id").GetString()+"/bed-seam/"+join.GetProperty("name").GetString(),points[k].Lerp(points[k+1],i/(float)n),true);
                }
            }
        foreach(var area in data.Areas.Where(a=>a.Id.StartsWith("network_")&&a.Zones[0].Kind=="line"))
        {
            var zone=area.Zones[0];
            float start=1,end=zone.Length-1;
            if(definitions[area.Id].TryGetProperty("walkRange",out var range)){start=range[0].GetSingle();end=range[1].GetSingle();}
            for(float u=start;u<=end;u+=.5f)
            {
                var (p,t)=zone.Frame(u);var across=new Vector2(t.Y,-t.X);
                foreach(int side in (large?Array.Empty<int>():new[]{-1,1}).Where(zone.S.HasWalk))
                {
                    if(definitions[area.Id].TryGetProperty("walkDetours",out var detours)&&detours.EnumerateArray().Any(d=>
                        d.GetProperty("side").GetInt32()==side&&u>=d.GetProperty("start").GetSingle()&&u<=d.GetProperty("end").GetSingle()))continue;
                    float offset=(zone.S.Width/2-zone.S.Ledge+Jef.Radius+.05f)*side;var q=p+across*offset;
                    Walk(area.Id+"/walk/"+side,new Vector3(q.X,zone.S.LedgeY,q.Y),across*side,zone.S.Ledge>1?new[]{0,-.12f,-.24f,.3f,.6f}:new[]{0,-.1f,-.2f,-.3f});
                }
                // The giant wades on the bed, never on a people's ledge.
                if(large)Test(area.Id+"/bed",new Vector3(p.X,zone.S.Bed,p.Y),true);
            }
            if(counts.Count%16==0)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
        }
        }
        int connectedRooms=await ValidateRooms(game,data,Test,errors);
        RuienFoldBridge.ProofPhase=0;for(int i=0;i<3;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
        // Retained sample seams need continuity, not a one-metre exclusion around their ends.
        foreach(var area in data.Areas.Where(a=>a.Id.StartsWith("r1_l")))
        {
            var zone=area.Zones[0];var end=zone.Frame(zone.Length);var across=new Vector2(end.tan.Y,-end.tan.X);
            foreach(float u in new[]{-.4f,-.2f,0,.2f,.4f})
            {
                float side=zone.S.WalkwaySide;var q=end.at+end.tan*u+across*(side*(zone.S.Width/2-zone.S.Ledge+Jef.Radius+.05f));
                Test(area.Id+"/seam",new Vector3(q.X,zone.S.LedgeY,q.Y));
            }
        }
        NativeRuienDrainClearance.Report? drainage=null;
        if(RuienDrainNetwork.Active is {} network)
        {
            drainage=await NativeRuienDrainClearance.Run(game.View,network);
            samples+=drainage.Samples;counts["drainage/entrance-foundations"]=drainage.Samples;
            foreach(var finding in drainage.Errors)errors.Add(new{id=finding.Id,error="entrance foundation crosses hydraulic bore",entrance=finding.Entrance,at=finding.At.ToString()});
            if(drainage.Entrances!=RuienEntrance.All.Count())errors.Add(new{id="drainage",error="not all assembled entrance foundations were checked",found=drainage.Entrances,expected=RuienEntrance.All.Count()});
        }
        int gateSamples=0;float? previousTide=Tide.Held;
        try
        {
            // Boats rise and fall outside Solid. Test the complete leaf motion
            // against their live measured hulls at low, middle and high water.
            foreach(float tide in new[]{Tide.LwMin,Tide.MidY,Tide.HwMax})
            {
                Tide.Hold(tide);ulong until=Time.GetTicksMsec()+30000;
                while(MathF.Abs(Tide.River-tide)>.005f)
                {
                    if(Time.GetTicksMsec()>until)throw new TimeoutException("Gate proof tide did not settle");
                    await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
                }
                for(int i=0;i<3;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
                gateSamples+=NativeRuienGateClearance.Run(game.View,errors);
                if(game.Arg("ruien-gate-placement-survey") is {Length:>0} survey)
                    NativeRuienGateClearance.SurveyBoats(Scheldemist.Paths.Absolute(survey),output+FormattableString.Invariant($".placements-{tide}.json"));
            }
        }
        finally { Tide.Hold(previousTide); }
        samples+=gateSamples;counts["gates/full-swing"]=gateSamples;
        bool pass=errors.Count==0;Directory.CreateDirectory(Path.GetDirectoryName(output)!);
        File.WriteAllText(output,JsonSerializer.Serialize(new{pass,inputDigest=Inputs(data),areas=data.Areas.Count,connectedRooms,samples,counts,drainage,errors},new JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"RUIEN NETWORK PHYSICS: {samples} samples, {errors.Count} failures");player.Frozen=false;RuienFoldBridge.ProofPhase=null;return pass;
    }
    /// <summary>
    /// Whether a person's body can walk from a to b: a search over 10 cm stations for places where the floor
    /// carries him within one step of the last and his cylinder stands clear. A planned straight line fails on
    /// a footbridge's gear box or a vault rib beside it; a walker goes round, and so does this.
    /// </summary>
    public static bool Reach(PhysicsDirectSpaceState3D space,Vector3 a,Vector3 b,out string detail)
    {
        const float cell=.1f,pad=1.3f;
        using var person=new CylinderShape3D{Radius=Jef.Radius,Height=Jef.Tall-Jef.Step};
        // The stations lie on a lattice along a to b: a footbridge leaves the body 4 cm either side, and a
        // lattice across it at an angle has no station on its centre line.
        var flat=new Vector2(b.X-a.X,b.Z-a.Z);float length=flat.Length();
        var along=length>1e-4f?flat/length:Vector2.Right;var across=new Vector2(along.Y,-along.X);
        int lo=-(int)(pad/cell),hi=(int)MathF.Ceiling((length+pad)/cell),half=(int)(pad/cell);
        Vector2 At(int i,int j)=>new Vector2(a.X,a.Z)+along*(i*cell)+across*(j*cell);
        float? Stand(Vector2 p,float from)
        {
            float best=float.NegativeInfinity;
            foreach(var offset in new[]{Vector2.Zero,new Vector2(.04f,0),new Vector2(-.04f,0),new Vector2(0,.04f),new Vector2(0,-.04f)})
            {
                var top=new Vector3(p.X+offset.X,from+Jef.Step+.04f,p.Y+offset.Y);
                using var ray=PhysicsRayQueryParameters3D.Create(top,top+Vector3.Down*(2*Jef.Step+.3f),Solid.Layer);
                var hit=space.IntersectRay(ray);
                // only floor within his step of where he stands carries him to it
                if(hit.Count>0&&hit["normal"].AsVector3().Y>.5f&&hit["position"].AsVector3().Y<=from+Jef.Step+.005f)best=Math.Max(best,hit["position"].AsVector3().Y);
            }
            if(!float.IsFinite(best))return null;
            using var query=new PhysicsShapeQueryParameters3D{Shape=person,CollisionMask=Solid.Layer,Margin=0,
                Transform=new Transform3D(Basis.Identity,new Vector3(p.X,best+.012f+Jef.Step+(Jef.Tall-Jef.Step)/2,p.Y))};
            return space.IntersectShape(query,1).Count==0?best:null;
        }
        string Explain(Vector3 point)
        {
            using var ray=PhysicsRayQueryParameters3D.Create(point+Vector3.Up*(Jef.Step+.04f),point-Vector3.Up*(Jef.Step+.3f),Solid.Layer);
            var floor=space.IntersectRay(ray);float y=floor.Count>0?floor["position"].AsVector3().Y:point.Y;
            using var query=new PhysicsShapeQueryParameters3D{Shape=person,CollisionMask=Solid.Layer,Margin=0,
                Transform=new Transform3D(Basis.Identity,new Vector3(point.X,y+.012f+Jef.Step+(Jef.Tall-Jef.Step)/2,point.Z))};
            var hits=space.IntersectShape(query,16);
            return JsonSerializer.Serialize(new{at=point.ToString(),floor=floor.Count>0?floor["position"].AsVector3().ToString():"none",
                hits=hits.Select(h=>(h["collider"].AsGodotObject() as Node)?.GetPath().ToString()).Distinct().ToArray(),
                contacts=space.CollideShape(query,8).Select(p=>p.ToString()).ToArray()});
        }
        var height=new Dictionary<(int,int),float>();var queue=new Queue<(int i,int j)>();
        // the planned end points sit on a line that may touch a rail: start from any clear station beside it
        for(int i=-3;i<=3;i++)for(int j=-3;j<=3;j++)
            if(Stand(At(i,j),a.Y+.03f) is float y&&height.TryAdd((i,j),y))queue.Enqueue((i,j));
        if(queue.Count==0){detail="no clear standing place within 0.3 m of the start "+a+"; "+Explain(a);return false;}
        float nearest=float.MaxValue;Vector3 last=a;
        while(queue.TryDequeue(out var c))
        {
            float y=height[c];var p=At(c.i,c.j);
            float away=new Vector2(p.X-b.X,p.Y-b.Z).Length();
            if(away<.45f&&MathF.Abs(y-b.Y)<Jef.Step+.12f){detail="";return true;}
            if(away<nearest){nearest=away;last=new Vector3(p.X,y,p.Y);}
            foreach(var (di,dj) in new[]{(1,0),(-1,0),(0,1),(0,-1)})
            {
                int i=c.i+di,j=c.j+dj;
                if(i<lo||i>hi||j<-half||j>half||height.ContainsKey((i,j)))continue;
                if(Stand(At(i,j),y) is float next){height[(i,j)]=next;queue.Enqueue((i,j));}
            }
        }
        var toward=b-last;toward.Y=0;
        detail=$"the walkable floor from {a} ends {nearest:0.00} m short of {b}, at {last}; next "+Explain(last+toward.Normalized()*.2f)+"; end "+Explain(b);return false;
    }
    public static async Task<int> ValidateRooms(Node scene,RuienData data,Action<string,Vector3,bool> Test,List<object> errors,bool includeRouteSeams=true)
    {
        var space=scene.GetViewport().World3D.DirectSpaceState;
        using var giant=new CapsuleShape3D{Radius=AntigoonSize.ClearanceRadius,Height=3.86f-AntigoonSize.Step};
        // A straight line through a hall may hit a pier. Prove that its actual
        // bed has a connected body-sized route between every passage mouth.
        int connectedRooms=0;
        // a mouth closed by a brick end (areas.json channelEnds) is tested up to that wall, as a gate is to its doors
        var closed=new List<Vector2>();
        using(var areas=JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)))
            foreach(var definition in areas.RootElement.GetProperty("areas").EnumerateArray())
                if(definition.TryGetProperty("channelEnds",out var ends))
                    foreach(var end in ends.EnumerateArray()){var at=end.GetProperty("at");closed.Add(new Vector2(at[0].GetSingle(),at[2].GetSingle()));}
        foreach(var area in data.Areas.Where(a=>a.Id.StartsWith("network_")&&a.Zones[0].Kind=="room"))
        {
            var room=area.Zones[0];const float step=.4f;var origin=room.Rect.Position+Vector2.One*.6f;
            int nx=Math.Max(1,(int)((room.Rect.Size.X-1.2f)/step)+1),nz=Math.Max(1,(int)((room.Rect.Size.Y-1.2f)/step)+1);
            var free=new bool[nx,nz];var height=new float[nx,nz];
            for(int x=0;x<nx;x++)for(int z=0;z<nz;z++)
            {
                var p=origin+new Vector2(x*step,z*step);var at=new Vector3(p.X,room.S.Bed,p.Y);
                var from=new Vector3(at.X,Math.Max(room.S.Bed,-4.9f)+.35f,at.Z);
                using var ray=PhysicsRayQueryParameters3D.Create(from,at-Vector3.Up*.35f,Solid.Layer);
                var hit=space.IntersectRay(ray);
                if(hit.Count==0||hit["normal"].AsVector3().Y<.7f)continue;
                float y=hit["position"].AsVector3().Y;at.Y=y+.012f;height[x,z]=y;
                using var query=new PhysicsShapeQueryParameters3D{Shape=giant,CollisionMask=Solid.Layer,Margin=0,
                    Transform=new Transform3D(Basis.Identity,at+Vector3.Up*(AntigoonSize.Step+giant.Height/2))};
                free[x,z]=space.IntersectShape(query,1).Count==0;
            }
            var ports=new List<(int x,int z)>();
            foreach(var mouth in area.Zones.Skip(1).Where(z=>z.Kind=="line"&&z.Path.Length>1))
            {
                var direction=(mouth.Path[1]-mouth.Path[0]).Normalized();var p=mouth.Path[0]-direction*.6f;
                bool gate=mouth.Id.Contains("_GATE_",StringComparison.OrdinalIgnoreCase)||closed.Any(c=>c.DistanceTo(mouth.Path[^1])<.6f);
                var outer=mouth.Path[^1]+direction*(gate?-.65f:includeRouteSeams?.35f:-.15f);float span=p.DistanceTo(outer);float previous=float.NaN;
                for(float u=0;u<=span;u+=.2f)
                {
                    var xy=p.Lerp(outer,u/span);float upper=Math.Max(-4.9f,Math.Max(room.S.Bed,mouth.S.Bed))+.35f,lower=Math.Min(room.S.Bed,mouth.S.Bed)-.35f;
                    // A single ray can fall in a paving joint. Use the same small
                    // foot support footprint as the giant's body test above.
                    float y=float.NegativeInfinity;
                    foreach(var offset in new[]{Vector2.Zero,new Vector2(.12f,0),new Vector2(-.12f,0),new Vector2(0,.12f),new Vector2(0,-.12f)})
                    {
                        var q=xy+offset;
                        using var ray=PhysicsRayQueryParameters3D.Create(new Vector3(q.X,upper,q.Y),new Vector3(q.X,lower,q.Y),Solid.Layer);
                        var hit=space.IntersectRay(ray);
                        if(hit.Count>0&&hit["normal"].AsVector3().Y>.5f)y=Math.Max(y,hit["position"].AsVector3().Y);
                    }
                    if(!float.IsFinite(y)){errors.Add(new{id=area.Id,large=true,error="unsupported mouth bed",mouth=mouth.Id,u,at=xy.ToString()});continue;}
                    if(float.IsFinite(previous)&&Math.Abs(y-previous)>.65f)errors.Add(new{id=area.Id,large=true,error="mouth bed step exceeds 65 cm",mouth=mouth.Id,u});
                    previous=y;Test(area.Id+"/mouth-bed/"+mouth.Id,new Vector3(xy.X,y,xy.Y),true);
                }
                var candidates=new List<(float distance,int x,int z)>();
                for(int x=0;x<nx;x++)for(int z=0;z<nz;z++)if(free[x,z])
                {float d=(origin+new Vector2(x*step,z*step)).DistanceTo(p);if(d<1.05f)candidates.Add((d,x,z));}
                if(candidates.Count==0){errors.Add(new{id=area.Id,large=true,error="no body-sized bed route at mouth",mouth=mouth.Id});continue;}
                var cell=candidates.MinBy(c=>c.distance);ports.Add((cell.x,cell.z));
            }
            if(ports.Count>0)
            {
                var seen=new HashSet<(int,int)>{ports[0]};var queue=new Queue<(int x,int z)>();queue.Enqueue(ports[0]);
                while(queue.TryDequeue(out var cell))foreach(var delta in new[]{(1,0),(-1,0),(0,1),(0,-1)})
                {
                    int x=cell.x+delta.Item1,z=cell.z+delta.Item2;
                    // His bed steps at a rui portal rise 0.6 m; the mouth rule above allows 0.65 m.
                    if(x<0||z<0||x>=nx||z>=nz||!free[x,z]||Math.Abs(height[x,z]-height[cell.x,cell.z])>.65f||!seen.Add((x,z)))continue;
                    queue.Enqueue((x,z));
                }
                if(ports.Any(p=>!seen.Contains(p)))
                {
                    // Plan view of the bed for the repair: P port, o reached, . free, # blocked or no bed.
                    var map=new string[nz];
                    for(int z=0;z<nz;z++)map[z]=string.Concat(Enumerable.Range(0,nx).Select(x=>ports.Contains((x,z))?'P':seen.Contains((x,z))?'o':free[x,z]?'.':height[x,z]!=0?'#':' '));
                    var levels=new string[nz];
                    for(int z=0;z<nz;z++)levels[z]=string.Concat(Enumerable.Range(0,nx).Select(x=>height[x,z]==0?' ':(char)('a'+Math.Clamp((int)MathF.Round((height[x,z]-room.S.Bed)/.05f)+5,0,25))));
                    errors.Add(new{id=area.Id,large=true,error="room mouths separated by fixed collision",map,levels,bed=room.S.Bed});
                }
                else connectedRooms++;
            }
            await scene.ToSignal(scene.GetTree(),SceneTree.SignalName.ProcessFrame);
        }
        return connectedRooms;
    }

}
