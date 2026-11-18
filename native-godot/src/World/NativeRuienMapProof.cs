using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.World.Ruien;

namespace Scheldemist.Native.World;

public static class NativeRuienMapProof
{
    // Independent check against the installed physics world. The visual proof tests continuous
    // triangle coverage. Here the full mounting rectangle and perimeter must meet solid collision.
    private static bool PhysicsBacking(PhysicsDirectSpaceState3D space, Transform3D pose, Aabb box)
    {
        const float margin = .015f, spacing = .035f;
        int across = Mathf.CeilToInt((box.Size.X + 2 * margin) / spacing);
        int rows = Mathf.CeilToInt((box.Size.Y + 2 * margin) / spacing);
        using var ray = new PhysicsRayQueryParameters3D { CollisionMask = Scheldemist.World.Solid.Layer };
        for (int y = 0; y <= rows; y++)
        for (int x = 0; x <= across; x++)
        {
            var spot = pose * new Vector3(
                Mathf.Lerp(box.Position.X - margin, box.End.X + margin, (float)x / across),
                Mathf.Lerp(box.Position.Y - margin, box.End.Y + margin, (float)y / rows), 0);
            ray.From = spot + pose.Basis.Z * .045f;
            ray.To = spot - pose.Basis.Z * .055f;
            var result = space.IntersectRay(ray);
            if (result.Count == 0 || result["normal"].AsVector3().Dot(pose.Basis.Z) < .78f) return false;
        }
        return true;
    }

    public static void Fit(NativeTownGame game, string directory)
    {
        string manifest = Path.Combine(directory, "candidates.json");
        byte[] bytes = File.ReadAllBytes(manifest);
        using var all = JsonDocument.Parse(bytes);
        var models = GD.Load<PackedScene>("res://assets/models/ruien-wayfinding/street-plaques.scn").Instantiate<Node3D>();
        var backing = new NativePlaqueSupportProof(game);
        var space = game.View.FindWorld3D().DirectSpaceState;
        var selections = new Dictionary<string,JsonElement>();
        var rejected = new Dictionary<string,string>();
        var reserved = new List<(Vector3 At,float Width)>();
        static Vector3 V(JsonElement p) => new(p[0].GetSingle(), p[1].GetSingle(), p[2].GetSingle());
        bool Fits(JsonElement row, JsonElement pose, out string reason)
        {
            string id = row.GetProperty("id").GetString()!;
            var model = models.GetNode<MeshInstance3D>(id);
            var transform = new Transform3D(new Basis(V(pose[0]), V(pose[1]), V(pose[2])), V(pose[3]));
            model.Transform = transform;
            var box = model.Mesh.GetAabb();
            if (reserved.Any(p => transform.Origin.DistanceTo(p.At) < (box.Size.X + p.Width) * .5f + .20f))
            { reason = "overlapping plaques"; return false; }
            if (!backing.Supports(row.GetProperty("area").GetString()!, model, out reason)) return false;
            if (!PhysicsBacking(space, transform, box)) { reason = "installed collision"; return false; }
            selections.Add(id,pose);
            reserved.Add((transform.Origin,box.Size.X));
            return true;
        }
        var rows = all.RootElement.EnumerateArray().ToArray();
        foreach (var row in rows)
        {
            var id = row.GetProperty("id").GetString()!;
            if (!row.GetProperty("openingClear").GetBoolean()) rejected[id] = "opening or passage surround";
            else if (!Fits(row,row.GetProperty("original"),out var why)) rejected[id] = why;
        }
        foreach (var row in rows.Where(r => rejected.ContainsKey(r.GetProperty("id").GetString()!)))
            foreach (var pose in row.GetProperty("alternatives").EnumerateArray())
                if (Fits(row,pose,out _)) break;
        var mounted = rows.Where(r=>selections.ContainsKey(r.GetProperty("id").GetString()!)).Select(r=>new {
            id=r.GetProperty("id"), area=r.GetProperty("area"), street=r.GetProperty("street"), route=r.GetProperty("route"),
            pose=selections[r.GetProperty("id").GetString()!]
        }).ToArray();
        File.WriteAllText(Path.Combine(directory,"accepted.json"),JsonSerializer.Serialize(new {
            manifest=Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(), signs=mounted, rejectedOriginal=rejected,
            relocated=rejected.Keys.Where(selections.ContainsKey), removed=rejected.Keys.Where(k=>!selections.ContainsKey(k))
        }));
        GD.Print($"Plaque seats: {rows.Length} examined, {rejected.Count} original seats failed, {mounted.Length} fully supported mounts");
        models.Free();
        game.GetTree().Quit();
    }

    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int n)
        {
            for (int i = 0; i < n; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame);
        }
        async Task Shot(string name)
        {
            await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            using var picture = game.GetViewport().GetTexture().GetImage();
            if (picture.SavePng(Path.Combine(output, name + ".png")) != Error.Ok) throw new IOException(name);
        }
        var map = TownMap.I!;
        using var records = JsonDocument.Parse(Godot.FileAccess.GetFileAsString(RuienWayfinding.Survey));
        var lamps = Ruien.I!.Data.Areas.SelectMany(a => a.Sources).Where(s => s.Kind == "lamp").ToArray();
        var requested = game.Arg("plaque-view-ids").Split(',',StringSplitOptions.RemoveEmptyEntries);
        var available = records.RootElement.EnumerateArray().Select(r =>
        {
            var at = r.GetProperty("at");
            var face = r.GetProperty("face");
            return (id:r.GetProperty("id").GetString()!, street:r.GetProperty("street").GetString()!, at:new Vector3(at[0].GetSingle(),at[1].GetSingle(),at[2].GetSingle()),
                inward:new Vector3(face[0].GetSingle(),0,face[1].GetSingle()));
        }).OrderBy(p => lamps.Min(l => l.At.DistanceSquaredTo(p.at))).ToArray();
        var sites = requested.Length==0 ? available.DistinctBy(p => MathF.Round(p.at.Y)).Take(2).ToArray()
            : requested.Select(id=>available.First(p=>p.id==id)).ToArray();
        var camera = new Camera3D { Near=.03f, Fov=66, CullMask=game.Cam.CullMask & ~Arms.BodyLayer, Environment=game.Cam.Environment };
        game.View.AddChild(camera);
        camera.MakeCurrent();
        game.Cam = camera;
        Jef.I.Frozen = true;
        var huds = game.GetTree().Root.FindChildren("*","CanvasLayer",true,false).OfType<CanvasLayer>().Where(h=>h.Visible).ToList();
        foreach(var hud in huds) hud.Visible=false;
        foreach (var site in sites)
        {
            camera.GlobalPosition=site.at+site.inward*1.4f+Vector3.Up*.15f;
            camera.LookAt(site.at);
            var angles=camera.GlobalBasis.GetEuler(EulerOrder.Yxz);
            Jef.I.Place(camera.Position.X,camera.Position.Z,angles.Y,angles.X,camera.Position.Y-Jef.Eye);
            foreach(var (weather,hour) in new[]{("clear",13),("rain",13),("clear",23)})
            {
                await Scheldemist.Dev.Kit.I.Light(hour,weather);
                await Frames(45);
                var until=DateTime.UtcNow.AddSeconds(90);
                while(Ruien.I.PendingVisuals(camera.Position).Any())
                {
                    if(DateTime.UtcNow>until)throw new TimeoutException(site.street);
                    await Frames(1);
                }
                await Shot(site.street+"-"+weather+"-"+hour);
                if(weather=="clear" && hour==13)
                {
                    var close=camera.GlobalTransform;
                    camera.GlobalPosition=site.at+site.inward.Normalized()*2.0f+Vector3.Up.Cross(site.inward).Normalized()*1.4f-Vector3.Up*.4f;
                    camera.LookAt(site.at);
                    await Frames(12);
                    await Shot(site.id+"-wall-and-passage");
                    camera.GlobalTransform=close;
                }
            }
        }
        foreach(var hud in huds) hud.Visible=true;
        var plaques=game.View.GetNode<Node3D>("RuienStreetPlaques").GetChildren().OfType<MeshInstance3D>().ToArray();
        if(plaques.Length!=records.RootElement.GetArrayLength()) throw new InvalidOperationException("Plaque survey and scene differ");
        var space=game.View.FindWorld3D().DirectSpaceState;
        var backing=new NativePlaqueSupportProof(game);
        var survey=records.RootElement.EnumerateArray().ToDictionary(s=>s.GetProperty("id").GetString()!);
        var unsupported=new List<object>();
        foreach (var plaque in plaques)
        {
            var area=survey[plaque.Name.ToString()].GetProperty("area").GetString()!;
            bool supported=backing.Supports(area,plaque,out string why);
            if(!supported || !PhysicsBacking(space,plaque.GlobalTransform,plaque.Mesh.GetAabb()))
                unsupported.Add(new {name=plaque.Name.ToString(),area,why=supported?"installed collision":why});
        }
        File.WriteAllText(Path.Combine(output,"wall-check.json"),JsonSerializer.Serialize(unsupported));
        var settings=Path.Combine(output,"map-settings.json");
        File.WriteAllText(settings,"{\"hidden\":[\"pump\"]}");
        map.SettingsFile=settings;
        map.ReloadSettings();
        if(map.Shows("ruien") || map.Shows("pump"))throw new InvalidOperationException("Legacy map settings migration");
        map.Show();
        await Frames(5);
        map.SetShown("ruien",true);
        await Frames(8);
        var entrances=RuienEntrance.All;
        foreach(var door in entrances)
        {
            var mark=map.Find(door.Name);
            if(mark?.Icon!="ruien-stair" || mark.X!=door.Door.X || mark.Z!=door.Door.Y)
                throw new InvalidOperationException("Missing or misplaced entrance "+door.Id);
        }
        // Keep the game's ordinary captured cursor and send relative mouse travel just as during play.
        Jef.I.TestInput = true;
        async Task MoveTo(Vector2 p)
        {
            var cursor=(float[])map.Info()["cursor_px"]!;
            Input.ParseInputEvent(new InputEventMouseMotion { Position=p, GlobalPosition=p, Relative=p-new Vector2(cursor[0],cursor[1]) });
            await Frames(2);
        }
        async Task RightClick(Vector2 p)
        {
            await MoveTo(p);
            foreach(bool down in new[]{true,false})
            {
                Input.ParseInputEvent(new InputEventMouseButton { Position=p, GlobalPosition=p, ButtonIndex=MouseButton.Right, Pressed=down });
                await Frames(2);
            }
        }
        var window=game.GetViewport().GetVisibleRect().Size;
        var choices=entrances.Where(e=>map.OnScreen(e.Name) is {} s && s.X > window.X*.14f && s.X < window.X*.45f && s.Y>window.Y*.20f && s.Y<window.Y*.76f).ToList();
        var targetDoor=choices.Where(e=>e.Door.DistanceTo(new Vector2(Jef.I.X,Jef.I.Z))>30f)
            .MinBy(e=>map.OnScreen(e.Name)!.Value.DistanceSquaredTo(window*new Vector2(.36f,.42f)))!;
        var click=map.OnScreen(targetDoor.Name)!.Value;
        await RightClick(click);
        if(map.Waypoint is not {} first || first.DistanceTo(targetDoor.Door)>.2f)
            throw new InvalidOperationException($"Pin {map.Waypoint} does not match {targetDoor.Name} {targetDoor.Door} at {click}, mouse {Input.MouseMode}, hover {string.Join(' ',map.Info()["hover"] as string[] ?? Array.Empty<string>())}");
        var secondDoor=choices.MaxBy(e=>e.Door.DistanceSquaredTo(first))!;
        var other=map.OnScreen(secondDoor.Name)!.Value;
        await RightClick(other);
        if(map.Waypoint is not {} moved || moved.DistanceTo(secondDoor.Door)>.2f)
            throw new InvalidOperationException($"Pin {map.Waypoint} after moving from {first} to {secondDoor.Door} on screen {click} -> {other}, cursor {string.Join(',',(float[])map.Info()["cursor_px"]!)}, hover {string.Join(' ',map.Info()["hover"] as string[] ?? Array.Empty<string>())}");
        await RightClick(other - new Vector2(0,14));
        if(map.Waypoint!=null)throw new InvalidOperationException("Second click did not clear pin");
        var blank = window * new Vector2(.18f,.57f);
        await RightClick(blank);
        if(map.Waypoint is not {} freePin || map.Info()["hover"]!=null)throw new InvalidOperationException("Empty paper did not accept a free waypoint");
        await RightClick(blank + new Vector2(0,-14));
        if(map.Waypoint!=null)throw new InvalidOperationException("Clicking the head of a free waypoint did not clear it");
        await RightClick(click);
        await MoveTo(window - new Vector2(18,18));
        await Shot("paper-map");
        map.Close();
        await Frames(60);
        var arrow=game.Ui.FindChild("WaypointArrow",true,false) as Scheldemist.Play.Tick;
        if(arrow?.IsVisibleInTree()!=true || arrow.Modulate.A<.1f)throw new InvalidOperationException("Waypoint arrow absent in play");
        await Shot("waypoint-arrow");
        string? slot=null;
        async Task<string> SaveAction(Action<Action<string>> action)
        {
            var reply=new TaskCompletionSource<string>();
            action(r=>reply.TrySetResult(r));
            return await reply.Task.WaitAsync(TimeSpan.FromSeconds(90));
        }
        if(game.Flag("waypoint-save-proof"))
        {
            // Explicit fixture run using an isolated town. Choose an unused manual slot.
            var saves=await ServerLink.I!.Api!.Saves();
            slot=Enumerable.Range(1,5).Select(i=>"slot"+i).First(s=>saves.Saves!.All(save=>save.Slot!=s));
            string saved=await SaveAction(done=>MainMenu.I!.Saves.Save(slot,"Waypoint proof",done));
            if(!saved.StartsWith("saved "+slot+" ",StringComparison.Ordinal))throw new InvalidOperationException(saved);
            var jobs=Jobs.I;
            if(jobs.PointerAt==null)
            {
                jobs.OpenBook();
                Scheldemist.Windows.Dialogs.I!.SendKey("KeyS");
                jobs.CloseBook();
            }
            if(jobs.PointerAt==null)
                foreach(var job in jobs.VisibleJobs().Where(j=>j.Playable && j.Status=="offered"))
                {
                    await jobs.TakeJob(job);
                    if(jobs.PointerAt!=null)break;
                }
            await Frames(40);
            var quest=arrow.GetParent().GetChildren().OfType<Tick>().Single(q=>q!=arrow);
            if(jobs.PointerAt==null || quest.Modulate.A<.1f || arrow.Modulate.A<.1f || arrow.Position.Y<=quest.Position.Y+quest.Size.Y)
                throw new InvalidOperationException("Followed quest and waypoint did not render on separate rows");
            await Shot("quest-and-waypoint");
        }
        map.ReloadSettings();
        if(!map.Shows("ruien"))throw new InvalidOperationException("Ruien layer setting lost");
        map.Show();
        Input.ParseInputEvent(new InputEventKey { PhysicalKeycode=Key.Delete, Keycode=Key.Delete, Pressed=true });
        await Frames(2);
        Input.ParseInputEvent(new InputEventKey { PhysicalKeycode=Key.Delete, Keycode=Key.Delete, Pressed=false });
        await Frames(2);
        if(map.Waypoint!=null || arrow.Visible)throw new InvalidOperationException("Delete did not remove the waypoint and arrow");
        map.SetShown("ruien",false);
        await Frames(6);
        if(entrances.Any(e=>map.OnScreen(e.Name)!=null))throw new InvalidOperationException("Hidden entrance is still drawn");
        if(unsupported.Count>0) throw new InvalidOperationException($"{unsupported.Count} street plaques lack continuous backing");
        if(slot!=null)
        {
            string loaded=await SaveAction(done=>MainMenu.I!.Saves.Load(slot,done));
            if(loaded!="loaded "+slot || map.Waypoint is not {} restored || !restored.IsEqualApprox(first))
                throw new InvalidOperationException($"Waypoint after {loaded}: {map.Waypoint}, expected {first}");
        }
        File.WriteAllText(Path.Combine(output,"result.json"), JsonSerializer.Serialize(new {
            plaques=records.RootElement.GetArrayLength(), entrances=entrances.Count, photographed=sites.Select(s=>s.street),
            freePlacement=true, snappedDoors=new[]{targetDoor.Name,secondDoor.Name}, clearedByClickAndDelete=true,
            saveLoadAndBothArrows=slot!=null, passed=true
        }));
        game.GetTree().Quit();
    }
}
