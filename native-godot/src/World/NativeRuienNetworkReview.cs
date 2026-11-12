using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

/// <summary>
/// Pictures of every generated Ruien area in the assembled native town: `--ruien-network-review <folder>` with
/// isolated data and the staged `--ruien-areas`. Each stretch is seen along its walkway at both seams and its
/// middle; each room from its corners and before every mouth. One evenly lit view shows faults; the authored
/// light shows the mood. `--ruien-review-only a,b` limits the areas. The pictures are the evidence: a person
/// (or a picture check) accepts them, this tool never does.
/// </summary>
public static class NativeRuienNetworkReview
{
    public static async Task Run(NativeTownGame game, string output)
    {
        try
        {
            Directory.CreateDirectory(output);
            async Task Frames(int n) { for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
            var deadline = DateTime.UtcNow.AddHours(4);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live)
            { if (DateTime.UtcNow > deadline) throw new TimeoutException("Native town not ready"); await Frames(1); }
            if(MainMenu.I?.InPlay!=true)MainMenu.I?.Start(); Jef.I.TestInput = true; Pause.Clear();
            var api = ServerLink.I!.Api!;
            int hour=int.TryParse(game.Arg("ruien-review-hour"),out int requestedHour)?requestedHour:13;
            string weather=game.Arg("ruien-review-weather")??"clear";
            if(float.TryParse(game.Arg("ruien-review-tide"),System.Globalization.NumberStyles.Float,System.Globalization.CultureInfo.InvariantCulture,out float reviewTide))
                Scheldemist.World.Tide.Hold(reviewTide);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour, minute = 0, weather }));
            // Gate motion takes real time; a fast capture must not photograph
            // the leaves halfway through opening just because 220 frames elapsed.
            if(int.TryParse(game.Arg("ruien-review-settle-seconds"),out int settleSeconds)&&settleSeconds>0)
                await game.ToSignal(game.GetTree().CreateTimer(Math.Clamp(settleSeconds,1,90)),SceneTreeTimer.SignalName.Timeout);
            bool physicsPassed=true;
            // one start serves both: the assembled physics proof first, then the pictures
            if (game.Arg("ruien-network-proof") is { Length: > 0 } proof)
            {
                physicsPassed = await NativeRuienNetworkProof.Run(game, Scheldemist.Paths.Absolute(proof));
                GD.Print("RUIEN NETWORK PROOF BEFORE REVIEW: " + (physicsPassed ? "pass" : "FAIL"));
                Jef.I.Frozen = false;
            }
            // (the proof runs for a long time: the game clock walked into the night, and the gates were shot in the dark)
            var noonAt = DateTime.MinValue;
            async Task Noon()
            {
                if ((DateTime.UtcNow - noonAt).TotalSeconds < 40) return;
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { hour, minute = 0, weather })); noonAt = DateTime.UtcNow;
            }
            var data = Ruien.I!.Data; var authored = data.Fill;
            // a room's proven walking line: free standing places for the camera (a corner 1.1 m in could lie in a pier)
            var standing = new Dictionary<string, List<Vector3>>();
            using (var spec = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)))
                foreach (var definition in spec.RootElement.GetProperty("areas").EnumerateArray())
                    if (definition.TryGetProperty("walkProof", out var runs))
                    {
                        var places = standing[definition.GetProperty("id").GetString()!] = new();
                        foreach (var run in runs.EnumerateArray())
                            foreach (string end in new[] { "from", "to" })
                            { var q = run.GetProperty(end); places.Add(new Vector3(q[0].GetSingle(), q[1].GetSingle(), q[2].GetSingle())); }
                    }
            var only = game.Arg("ruien-review-only") is { Length: > 0 } list ? list.Split(',').ToHashSet(StringComparer.OrdinalIgnoreCase) : null;
            var camera = new Camera3D { Name = "NetworkReviewCamera", Near = .05f, Far = 400, Fov = 78,
                CullMask=game.Cam.CullMask, Environment=game.Cam.Environment };
            camera.CullMask &= ~Arms.BodyLayer;
            game.View.AddChild(camera);
            var shots = new List<(string area, string name, Vector3 at, Vector3 look, bool mood)>();
            Vector3 ClearSight(Vector3 look,params Vector3[] candidates)
            {
                foreach(var candidate in candidates)
                {
                    using var ray=PhysicsRayQueryParameters3D.Create(candidate,look,Scheldemist.World.Solid.Layer);
                    ray.HitBackFaces=true;
                    var hit=game.GetViewport().World3D.DirectSpaceState.IntersectRay(ray);
                    if(hit.Count==0||hit["position"].AsVector3().DistanceTo(look)<.4f)return candidate;
                }
                return candidates[^1];
            }
            if(game.Arg("ruien-review-extra-views") is {Length:>0} extraViews)
            {
                using var extra=JsonDocument.Parse(File.ReadAllText(Scheldemist.Paths.Absolute(extraViews)));
                foreach(var view in extra.RootElement.GetProperty("shots").EnumerateArray())
                {
                    string area=view.GetProperty("area").GetString()!;
                    if(only!=null&&!only.Contains(area))continue;
                    Vector3 V(string key){var p=view.GetProperty(key);return new(p[0].GetSingle(),p[1].GetSingle(),p[2].GetSingle());}
                    shots.Add((area,view.GetProperty("name").GetString()!,V("at"),V("look"),true));
                }
            }
            foreach (var area in data.Areas.Where(a => only?.Contains(a.Id) ?? a.Id.StartsWith("network_")))
            {
                var zone = area.Zones[0];
                if (zone.Kind == "room")
                {
                    var r = zone.Rect; float eye = zone.S.LedgeY + 1.6f; var centre = r.GetCenter();
                    var target = new Vector3(centre.X, zone.S.LedgeY + .4f, centre.Y);
                    var corners = new[] { r.Position + Vector2.One * 1.1f, r.End - Vector2.One * 1.1f, new Vector2(r.End.X - 1.1f, r.Position.Y + 1.1f), new Vector2(r.Position.X + 1.1f, r.End.Y - 1.1f) };
                    standing.TryGetValue(area.Id, out var free);
                    Vector2 Stand(Vector2 wanted)
                    {
                        if (free is not { Count: > 0 }) return wanted;
                        var best = free.MinBy(q => new Vector2(q.X, q.Z).DistanceTo(wanted)); var at = new Vector2(best.X, best.Z);
                        return at + (centre - at).Normalized() * .3f;
                    }
                    for (int i = 0; i < corners.Length; i++) { var c = Stand(corners[i]); shots.Add((area.Id, "corner" + i, new Vector3(c.X, eye, c.Y), target, i == 0)); }
                    // a hall's centre is a pier: look up at the crown of its first bay instead
                    var bay = new Vector2(r.Size.X > 12 ? r.Position.X + 3.75f : centre.X, r.Size.Y > 12 ? r.Position.Y + 3.75f : centre.Y);
                    // Unequal bays and phase-shifted piers can put that nominal
                    // position inside masonry. Choose a nearby point with a real
                    // downward-facing vault above it, clear of street shafts.
                    Vector2? verifiedBay=null;float nearest=float.PositiveInfinity;
                    foreach(float dx in new[]{0f,-.7f,.7f,-1.4f,1.4f})foreach(float dz in new[]{0f,-.7f,.7f,-1.4f,1.4f})
                    {
                        var q=bay+new Vector2(dx,dz);if(!r.Grow(-.8f).HasPoint(q))continue;
                        using var ray=PhysicsRayQueryParameters3D.Create(new Vector3(q.X,zone.S.LedgeY+.3f,q.Y),new Vector3(q.X,.3f,q.Y),Scheldemist.World.Solid.Layer);
                        var hit=game.GetViewport().World3D.DirectSpaceState.IntersectRay(ray);
                        if(hit.Count==0||hit["normal"].AsVector3().Y>-.25f||hit["position"].AsVector3().Y>-.35f)continue;
                        float distance=dx*dx+dz*dz;if(distance>=nearest)continue;nearest=distance;verifiedBay=q;
                    }
                    if(verifiedBay is {} verified)bay=verified;
                    shots.Add((area.Id, "vault", new Vector3(bay.X, zone.S.LedgeY + .3f, bay.Y + .01f), new Vector3(bay.X, zone.S.Crown, bay.Y), false));
                    foreach (var mouth in area.Zones.Skip(1).Where(z => z.Kind == "line" && z.Path.Length > 1))
                    {
                        var direction = (mouth.Path[1] - mouth.Path[0]).Normalized(); var from = mouth.Path[0] - direction * 3.2f;
                        from = new Vector2(Math.Clamp(from.X, r.Position.X + .7f, r.End.X - .7f), Math.Clamp(from.Y, r.Position.Y + .7f, r.End.Y - .7f));
                        var to = mouth.Path[0] + direction * 2;
                        shots.Add((area.Id, "mouth_" + mouth.Id, new Vector3(from.X, eye, from.Y), new Vector3(to.X, zone.S.LedgeY + .2f, to.Y), false));
                    }
                    continue;
                }
                float length = zone.Length; int side = zone.S.WalkwaySide != 0 ? zone.S.WalkwaySide : 1;
                Vector3 Eye(float u, float height)
                {
                    var (p, t) = zone.Frame(Math.Clamp(u, 0, length)); var across = new Vector2(t.Y, -t.X);
                    var q = p + across * (side * (zone.S.Width / 2 - zone.S.Ledge / 2));
                    return new Vector3(q.X, zone.S.LedgeY + height, q.Y);
                }
                Vector3 Axis(float u, float y)
                {
                    var (p, t) = zone.Frame(Math.Clamp(u, 0, length)); var q = p + t * (u - Math.Clamp(u, 0, length));
                    return new Vector3(q.X, y, q.Y);
                }
                float mid = zone.S.LedgeY + .6f;
                shots.Add((area.Id, "start", Eye(Math.Min(3.5f, length * .5f), 1.6f), Axis(-2, mid), false));
                shots.Add((area.Id, "end", Eye(Math.Max(length - 3.5f, length * .5f), 1.6f), Axis(length + 2, mid), false));
                int parts = Math.Max(1, (int)MathF.Round(length / 22));
                for (int k = 0; k < parts; k++)
                {
                    float u = length * (k + .5f) / parts; bool forward = k % 2 == 0;
                    shots.Add((area.Id, "along" + k, Eye(u, 1.6f), Axis(u + (forward ? 7 : -7), mid), k == 0));
                }
            }
            // from the street: every closed vent grate, and every canal gate from over the water
            using (var spec = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienData.AreasFile)))
                foreach (var definition in spec.RootElement.GetProperty("areas").EnumerateArray())
                {
                    string id = definition.GetProperty("id").GetString()!;
                    if (!(only?.Contains(id) ?? id.StartsWith("network_")) || !definition.TryGetProperty("grates", out var grates)) continue;
                    foreach (var grate in grates.EnumerateArray())
                    {
                        var p = grate.GetProperty("at"); var at = new Vector3(p[0].GetSingle(), 0, p[2].GetSingle());
                        shots.Add((id, "street_" + grate.GetProperty("id").GetString(), at + new Vector3(1.9f, 1.7f, 1.5f), at, false));
                    }
                }
            foreach (var area in data.Areas.Where(a => only?.Contains(a.Id) ?? a.Id.StartsWith("network_")))
                foreach (var gate in area.Gates)
                {
                    var face = new Vector3(gate.Origin.X, gate.Sill + 1.2f, gate.Origin.Y); var outward = new Vector3(gate.Normal.X, 0, gate.Normal.Y);
                    var along = new Vector3(-outward.Z, 0, outward.X);
                    // (from above the street level: lower, the eye counts as underground and the town goes dark)
                    Vector3 Over(Vector3 q) => new(q.X, .9f, q.Z);
                    shots.Add((area.Id, "gate_" + gate.Id + "_front", Over(face + outward * 7), face, false));
                    shots.Add((area.Id, "gate_" + gate.Id + "_side", Over(face + outward * 4 + along * 5), face, false));
                    shots.Add((area.Id, "gate_" + gate.Id + "_near", Over(face + outward * 3.2f - along * 2.4f), face + Vector3.Up * .8f, false));
                }
            foreach(var area in data.Areas.Where(a=>only?.Contains(a.Id)??a.Id.StartsWith("network_")))
                foreach(var bridge in area.Bridges.Where(b=>b.Id.Contains("_access")||b.Id.Contains("_bypass_")||b.Id.Contains("_GATE_")))
                {
                    var along=(bridge.B-bridge.A).Normalized();var side=along.Cross(Vector3.Up);var middle=(bridge.A+bridge.B)/2;
                    // The last plank can meet a wall: the old reverse eye stood behind it.
                    var lookB=bridge.B+Vector3.Up*.4f;var lookA=bridge.A+Vector3.Up*.4f;
                    shots.Add((area.Id,"bridge_"+bridge.Id+"_a",ClearSight(lookB,bridge.A-along*.65f+Vector3.Up*1.5f,bridge.A+along*.35f+Vector3.Up*1.5f),lookB,true));
                    shots.Add((area.Id,"bridge_"+bridge.Id+"_b",ClearSight(lookA,bridge.B+along*.65f+Vector3.Up*1.5f,bridge.B-along*.35f+Vector3.Up*1.5f),lookA,false));
                    shots.Add((area.Id,"bridge_"+bridge.Id+"_underside",middle+side*1.5f-Vector3.Up*.7f,middle-Vector3.Up*.15f,false));
                }
            // every connected stair passage: from its landing, half way, and its mouth seen from the tunnel
            foreach (var entry in RuienEntrance.All.Where(e => e.Closure=="open" && (only?.Contains(e.ConnectArea.Length>0?e.ConnectArea:e.Line.ToLowerInvariant()) ?? true)))
            {
                string entryArea=entry.ConnectArea.Length>0?entry.ConnectArea:entry.Line.ToLowerInvariant();
                var frame = RuienEntrance.LinkFrame(entry);
                var street=new Vector3(entry.Door.X,entry.Street,entry.Door.Y);var outward=new Vector3(entry.Out.X,0,entry.Out.Y);var side=outward.Cross(Vector3.Up);
                var doorLook=street+Vector3.Up*.85f;
                var doorEye=street+outward*1.3f+Vector3.Up*1.65f;
                foreach(var (distance,lateral) in new[]{(3.4f,1.5f),(2.2f,.5f),(1.7f,0f),(3.4f,-1.5f),(1.3f,0f)})
                {
                    var candidate=street+outward*distance+side*lateral+Vector3.Up*1.65f;
                    using var ray=PhysicsRayQueryParameters3D.Create(candidate,doorLook,Scheldemist.World.Solid.Layer);
                    var obstruction=game.GetViewport().World3D.DirectSpaceState.IntersectRay(ray);
                    if(obstruction.Count>0&&obstruction["position"].AsVector3().DistanceTo(doorLook)>.65f)continue;
                    doorEye=candidate;break;
                }
                shots.Add((entryArea,"street_entrance_"+entry.Id,doorEye,doorLook,false));
                if(entry.House)
                {
                    var middle=entry.RunToWorld(new Vector3(entry.HouseBack/2,1,0));
                    var sideLook=middle-Vector3.Up*.65f;
                    // Aim at the outside face. A target inside the back gable made
                    // its own wall reject the wide views and select a close-up.
                    var backLook=entry.RunToWorld(new Vector3(entry.HouseBack+RuienStairHouse.BackWall+.015f,1.1f,0));
                    Vector3 At(float u,float y,float v)=>entry.RunToWorld(new Vector3(u,y,v));
                    var roofLook=At(entry.HouseBack/2,RuienStairHouse.Ridge,0);
                    shots.Add((entryArea,"street_house_"+entry.Id+"_side_low",At(entry.HouseBack/2,.45f,4),sideLook,false));
                    shots.Add((entryArea,"street_house_"+entry.Id+"_back",ClearSight(backLook,At(entry.HouseBack+3,1.7f,-2.5f),At(entry.HouseBack+3,1.7f,2.5f),At(entry.HouseBack+3,1.7f,0),At(entry.HouseBack+.9f,1.6f,.55f),At(entry.HouseBack+.8f,1.6f,-.55f)),backLook,false));
                    shots.Add((entryArea,"street_house_"+entry.Id+"_roof",ClearSight(roofLook,At(entry.HouseBack+2,5.5f,3),At(entry.HouseBack+2,5.5f,-3),At(-2,5.5f,2),At(entry.HouseBack/2,5.5f,0)),roofLook,false));
                }
                var path = entry.ConnectArea.Length==0?entry.Route.Select(entry.World).ToArray():entry.ConnectPath.Length > 1 ? entry.ConnectPath : new[] { frame.Origin, frame * new Vector3(0, 0, entry.ConnectLength) };
                float pathLength=0;for(int i=1;i<path.Length;i++)pathLength+=path[i-1].DistanceTo(path[i]);
                Vector3 Along(float metres)
                {
                    for(int i=1;i<path.Length;i++)
                    {
                        float length=path[i-1].DistanceTo(path[i]);
                        if(metres<=length)return path[i-1].Lerp(path[i],metres/Math.Max(length,.001f));
                        metres-=length;
                    }
                    return path[^1];
                }
                var eye = Vector3.Up * 1.55f;
                shots.Add((entryArea, "entrance_" + entry.Id + "_landing", path[0] + eye, Along(Math.Min(3,pathLength)) + Vector3.Up * 1.2f, false));
                shots.Add((entryArea, "entrance_" + entry.Id + "_middle", Along(pathLength/2) + eye, Along(Math.Min(pathLength,pathLength/2+3)) + Vector3.Up * 1.2f, false));
                var last = path[^1]; var into = (last - path[Math.Max(0, path.Length - 2)]).Normalized();
                var mouthLook=last-into*Math.Min(1.5f,pathLength*.5f)+Vector3.Up*1.2f;
                shots.Add((entryArea, "entrance_" + entry.Id + "_mouth", ClearSight(mouthLook,last+into*1.6f+eye,last+into*.55f+eye,last-into*.15f+eye),mouthLook,false));
            }
            if(game.Arg("ruien-review-shots") is {Length:>0} shotFilter)
            {
                var filter=new System.Text.RegularExpressions.Regex(shotFilter,System.Text.RegularExpressions.RegexOptions.CultureInvariant);
                shots.RemoveAll(s=>!filter.IsMatch(s.name));
                if(shots.Count==0)throw new ArgumentException("No review shots match "+shotFilter);
            }
            var index = new List<object>(); string previous = "";
            var huds = game.GetTree().Root.FindChildren("*", "CanvasLayer", true, false).OfType<CanvasLayer>().Where(c => c.Visible).ToList();
            foreach (var h in huds) h.Visible = false;
            var doorTargets=RuienEntranceDoor.All.Values.ToDictionary(d=>d.Spec.Id,d=>d.Target);
            bool lantern=game.Flag("ruien-review-lantern");
            if(lantern){Jef.I.Frozen=true;Arms.I!.ProofLantern=true;}
            camera.Current = true;
            // Water state, rain, wildlife and other camera-dependent parts also use
            // Main.Cam. Keep their observer at the lens taking the actual picture.
            game.Cam=camera;
            foreach (var shot in shots)
            {
                camera.GlobalPosition = shot.at; camera.LookAt(shot.look, MathF.Abs((shot.look - shot.at).Normalized().Y) > .98f ? Vector3.Forward : Vector3.Up);
                if(lantern)
                {
                    var euler=camera.GlobalBasis.GetEuler(EulerOrder.Yxz);
                    Jef.I.Place(shot.at.X,shot.at.Z,euler.Y,euler.X,shot.at.Y-Jef.Eye);
                }
                foreach (bool mood in shot.mood && !game.Flag("ruien-review-authored") ? new[] { false, true } : new[] { false })
                {
                    data.Fill = mood||game.Flag("ruien-review-authored") ? authored : new Color(.55f, .50f, .42f) * 1.2f;
                    // a new area streams its close meshes in; the same place only needs the light to settle
                    // (above ground the light takes longer to follow the eye out of the vaults)
                    bool street = shot.name.StartsWith("street_") || shot.name.StartsWith("gate_");
                    await Noon();
                    await Frames(street ? 220 : shot.area != previous ? 100 : 24); previous = street ? "" : shot.area;
                    if(game.GetTree().Paused)throw new InvalidOperationException("Review paused before "+shot.area+"/"+shot.name+": "+string.Join(',',Pause.Reasons));
                    // Frame counts alone do not establish readiness after jumping across a long gallery.
                    // The old capture could photograph the street through a mesh still being read from disk.
                    ulong visualDeadline=Time.GetTicksMsec()+60000;
                    while(Ruien.I!.PendingVisuals(shot.at).Take(1).Any())
                    {
                        if(Time.GetTicksMsec()>visualDeadline)throw new TimeoutException("Ruien view did not settle: "+shot.area+"/"+shot.name+": "+string.Join(", ",Ruien.I.PendingVisuals(shot.at).Take(12)));
                        await Frames(1);
                    }
                    await Frames(2);
                    if(game.Flag("ruien-review-water-profile") && index.Count==0)
                        await NativeRuienWaterReview.Profile(game,output);
                    if(game.Flag("ruien-review-frame-profile") && index.Count==0)
                    {
                        using var frameProfile=new RuienFrameProfile(game.GetTree());
                        await Frames(32);
                        File.WriteAllText(Path.Combine(output,"frame-profile.json"),JsonSerializer.Serialize(frameProfile.Finish(shot.name),new JsonSerializerOptions{WriteIndented=true}));
                        GD.Print($"REVIEW FRAME STATE: fps={Engine.GetFramesPerSecond()} cap={Engine.MaxFps} lowProcessor={OS.LowProcessorUsageMode} processSeconds={Performance.GetMonitor(Performance.Monitor.TimeProcess)} physicsSeconds={Performance.GetMonitor(Performance.Monitor.TimePhysicsProcess)}");
                    }
                    await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                    using var image = game.GetViewport().GetTexture().GetImage();
                    image.Resize(960, 960 * image.GetHeight() / image.GetWidth(), Image.Interpolation.Lanczos);
                    string file = $"{shot.area}__{shot.name}{(mood ? "__mood" : "")}.jpg";
                    image.SaveJpg(Path.Combine(output, file), .88f);
                    if(!mood&&game.Arg("ruien-review-water-motion") is {Length:>0} waterMotion&&waterMotion.Split(',').Contains(shot.name))
                        await NativeRuienWaterReview.Motion(game,output,Path.GetFileNameWithoutExtension(file));
                    if(!mood&&game.Arg("ruien-review-water-layers") is {Length:>0} waterLayers&&waterLayers.Split(',').Contains(shot.name))
                        await NativeRuienWaterReview.Capture(game,output,Path.GetFileNameWithoutExtension(file));
                    if(!mood&&game.Arg("ruien-review-pick") is {Length:>0} pick&&pick.Split(',').Contains(shot.name))
                    {
                        var findings=Scheldemist.Dev.GeometryPick.At(game.View,camera,new[]{new Vector2(.15f,.45f),new Vector2(.28f,.55f),new Vector2(.5f,.5f)}).ToArray();
                        File.WriteAllLines(Path.Combine(output,file+".picks.txt"),findings);
                    }
                    index.Add(new { file, shot.area, shot.name, mood, at = new[] { shot.at.X, shot.at.Y, shot.at.Z }, look = new[] { shot.look.X, shot.look.Y, shot.look.Z } });
                }
                const string entryPrefix="street_entrance_";
                if(shot.name.StartsWith(entryPrefix)&&RuienEntranceDoor.All.TryGetValue(shot.name[entryPrefix.Length..],out var entranceDoor))
                {
                    entranceDoor.Set(true);ulong until=Time.GetTicksMsec()+20000;
                    while(entranceDoor.Open<.999f&&Time.GetTicksMsec()<until)await Frames(1);
                    if(entranceDoor.Open<.999f)
                    {
                        var serverState=await api.Get<JsonElement>("api/ruien/hatches/"+entranceDoor.Spec.DoorId);
                        throw new InvalidOperationException($"Review door did not open: {entranceDoor.Spec.Id}; open={entranceDoor.Open}, target={entranceDoor.Target}, known={entranceDoor.Known}, treePaused={game.GetTree().Paused}, reasons={string.Join(',',Pause.Reasons)}, server={serverState}");
                    }
                    await Frames(24);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    using var openImage=game.GetViewport().GetTexture().GetImage();openImage.Resize(960,960*openImage.GetHeight()/openImage.GetWidth(),Image.Interpolation.Lanczos);
                    string name=shot.name+"_open",file=shot.area+"__"+name+".jpg";openImage.SaveJpg(Path.Combine(output,file),.88f);
                    index.Add(new{file,shot.area,name,mood=false,at=new[]{shot.at.X,shot.at.Y,shot.at.Z},look=new[]{shot.look.X,shot.look.Y,shot.look.Z}});
                }
                // Preserve the camera metadata if a later capture fails. Only the
                // final index.json below establishes that the requested set finished.
                File.WriteAllText(Path.Combine(output,"index.partial.json"),JsonSerializer.Serialize(new{shots=index},new JsonSerializerOptions{WriteIndented=true}));
            }
            foreach(var door in RuienEntranceDoor.All.Values)door.Set(doorTargets[door.Spec.Id]);
            if(lantern)Arms.I!.ProofLantern=false;
            data.Fill = authored;
            File.WriteAllText(Path.Combine(output, "index.json"), JsonSerializer.Serialize(new { shots = index }, new JsonSerializerOptions { WriteIndented = true }));
            GD.Print($"RUIEN NETWORK REVIEW: {index.Count} pictures");
            game.GetTree().Quit(physicsPassed?0:1);
        }
        catch (Exception e) { GD.PrintErr(e); game.GetTree().Quit(1); }
    }
}
