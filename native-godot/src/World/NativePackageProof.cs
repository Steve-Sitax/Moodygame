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
using Scheldemist.Town;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>Cold, relocated release proof independent of the editor's saved layouts and game data.</summary>
public static class NativePackageProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        var checks = new List<object>(); var callbackErrors = new List<string>();
        void Check(string name, bool okay) { checks.Add(new { name, passed = okay }); if (!okay) throw new InvalidOperationException(name); }
        async Task Frames(int count) { for (int i = 0; i < count; i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            Check("release runs from exported resources", OS.HasFeature("native_standalone") && !OS.HasFeature("editor"));
            Check("legacy source root is unavailable", !Directory.Exists(Scheldemist.Paths.Root));
            string data = System.Environment.GetEnvironmentVariable("SCHELDEMIST_USER_DATA") ?? throw new Exception("Proof needs isolated writable data.");
            string dataRoot = Path.GetFullPath(data) + Path.DirectorySeparatorChar;
            Check("raw runtime data extracted into isolated cache", Scheldemist.Paths.NativeDataRoot!.StartsWith(dataRoot, StringComparison.OrdinalIgnoreCase));
            var deadline = DateTime.UtcNow.AddSeconds(100);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live || game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not > 0)
            {
                if (DateTime.UtcNow > deadline) throw new TimeoutException("Exported native backend and population did not become ready.");
                await Frames(1);
            }
            ServerLink.I!.Api!.Failed += error => callbackErrors.Add(error.ToString());
            Check("game rules run inside exported Godot process", game.UsesLocalBackend && ServerLink.I.Api.IsLocal);
            var town = (NativeTown)game.World;
            Check("all editable districts load from resource pack", town.Layouts.Districts.Count == 11);
            Check("proof uses isolated district layouts", town.Layouts.Districts.All(d => d.Store.File.StartsWith(Path.GetFullPath(game.Arg("author-root")) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)));
            Check("native resident models load", game.GetNode<Townspeople>("Townspeople").Sims.Count > 500);
            foreach (string endpoint in new[] { "api/trade", "api/mills", "api/lively", "api/settings/population", "api/mp/info" })
            {
                using var payload = await ServerLink.I.Api.Get<JsonDocument>(endpoint);
                Check("native endpoint " + endpoint, payload.RootElement.ValueKind == JsonValueKind.Object);
            }
            var menu = MainMenu.I ?? throw new Exception("Exported game menu is missing.");
            menu.Start(); await Frames(3);
            Check("real menu enters playable game", menu.InPlay);
            if (Jef.I is { Fly: false } player) player.ToggleFly();
            foreach (var view in new[] { (Name: "day", Hour: 13, Weather: "clear"), (Name: "rain", Hour: 13, Weather: "rain"), (Name: "night", Hour: 22, Weather: "mist") })
            {
                var state = await ServerLink.I.Api.Post<JobsPayload>("api/dev/set", new { day = 1, hour = view.Hour, minute = 0, weather = view.Weather });
                GameState.I.Apply(state); await Frames(3);
                var camera = new Vector3(52.5f, 1.62f, 2.25f);
                game.Cam.GlobalPosition = camera;
                var rotation = new Transform3D(Basis.Identity, camera).LookingAt(new Vector3(52.5f, 1.3f, 25)).Basis.GetRotationQuaternion();
                if (game.Cam is FlyCam fly) fly.Face(rotation); else game.Cam.Quaternion = rotation;
                Daylight.I.Settle(); await Frames(90);
                Check(view.Name + " renderer follows authoritative weather", Math.Abs(Daylight.I.Hour - view.Hour) < .1 && Daylight.I.Weather == view.Weather && menu.InPlay);
                await game.ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
                using var picture = game.GetViewport().GetTexture().GetImage();
                Check(view.Name + " screenshot captured", picture.SavePng(Path.Combine(output, view.Name + ".png")) == Error.Ok);
            }
            deadline = DateTime.UtcNow.AddSeconds(60);
            while (game.GetNode<Townspeople>("Townspeople").WaysWaiting < 0 && DateTime.UtcNow < deadline) await Frames(1);
            Check("native floor routing completes in release", game.GetNode<Townspeople>("Townspeople").WaysWaiting >= 0);
            await InspectPump(game, output, Check);
            File.WriteAllText(Path.Combine(output, "scene-renderer.json"), JsonSerializer.Serialize(new {
                residualMaterials = game.World.Unported.Distinct().OrderBy(s => s).ToArray(),
                residualNodes = BakedWorld.All(game.World).Where(n => n.Name.ToString() is "Node1476" or "Mesh2924").Select(n => new {
                    path=n.GetPath().ToString(), visible=n is Node3D spatial && spatial.IsVisibleInTree(),
                    sourceIndex=n.HasMeta("source_node_index") ? n.GetMeta("source_node_index").AsInt32() : -1,
                    sourceName=n.HasMeta("source_name") ? n.GetMeta("source_name").AsString() : ""
                }).ToArray(),
                gulls=Gulls.I is { } gulls ? new {gulls=gulls.Info.gulls,pigeons=gulls.Info.pigeons,perches=gulls.Info.spots} : null,
                fires=Fires.I is { } fires ? new {fires=fires.Info.fires,spots=fires.Info.spots} : null
            }));
            Check("release callbacks complete without errors", callbackErrors.Count == 0);
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed = true, checks }));
            GD.Print($"Native standalone package: {checks.Count} checks PASS"); game.GetTree().Quit();


        }
        catch (Exception error)
        {
            File.WriteAllText(Path.Combine(output, "result.json"), JsonSerializer.Serialize(new { passed = false, error = error.ToString(), checks, callbackErrors }));
            GD.PrintErr(error); game.GetTree().Quit(1);
        }
    }

    public static async Task InspectPump(NativeTownGame game, string output, Action<string, bool> Check)
            {
                async Task Frames(int count) { for(int i=0;i<count;i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
                var snapshots=BakedWorld.All(game.World).OfType<Node3D>().Where(n=>n.HasMeta("source_name") && n.GetMeta("source_name").AsString()=="fire_pump" && n.HasMeta("source_node_index") && n.GetMeta("source_node_index").AsInt32()==13360).ToArray();
                Check("frozen event pump is absent from rendering and physics",snapshots.Length==1 && snapshots.All(n=>!n.IsVisibleInTree()) && snapshots.SelectMany(BakedWorld.All).OfType<CollisionObject3D>().All(n=>n.CollisionLayer==0));
                var type=typeof(TownLife); var fire=Activator.CreateInstance(type.GetNestedType("FireLive",System.Reflection.BindingFlags.NonPublic)!,true);
                var pump=(Node3D)type.GetMethod("MakePump",System.Reflection.BindingFlags.NonPublic|System.Reflection.BindingFlags.Static)!.Invoke(null,new[]{fire})!;
                try
                {
                    game.View.AddChild(pump); pump.GlobalPosition=new Vector3(54,(float)game.World.NativeWalk!.BaseAt(54,8),8);
                    var lamp=pump.GetNode<MeshInstance3D>("pump_lantern"); var glow=pump.GetNode<MeshInstance3D>("pump_lantern_glow");
                    Check("actual event pump lantern has an unlit native material",lamp.Mesh!.SurfaceGetMaterial(0) is ShaderMaterial material && Scheldemist.Render.Psx.KindOf(material.Shader) is {Unlit:true});
                    Check("actual event pump has source-sized additive lantern glow",glow.Mesh is QuadMesh quad && Math.Abs(quad.Size.X-.8f)<.001 && glow.MaterialOverride is ShaderMaterial halo && Scheldemist.Render.Psx.KindOf(halo.Shader) is {Add:true,Fog:true});
                    var centre=lamp.ToGlobal(lamp.GetAabb().GetCenter());
                    var offsets=new[]{new Vector3(0,.8f,4),new Vector3(0,.8f,-4),new Vector3(4,.8f,0),new Vector3(-4,.8f,0),new Vector3(3,.8f,3),new Vector3(-3,.8f,3),new Vector3(-3,.8f,-3)};
                    var camera=centre+offsets.First(offset=>game.Cam.GetWorld3D().DirectSpaceState.IntersectRay(PhysicsRayQueryParameters3D.Create(centre+offset,centre,Solid.Layer)).Count==0);
                    game.Cam.GlobalPosition=camera;
                    var face=new Transform3D(Basis.Identity,camera).LookingAt(centre).Basis.GetRotationQuaternion();
                    if(game.Cam is FlyCam fly)fly.Face(face);else game.Cam.Quaternion=face;
                    await Frames(45);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    using var view=game.View.GetTexture().GetImage(); var pixel=game.Cam.UnprojectPosition(centre);
                    int x=(int)MathF.Round(pixel.X),y=(int)MathF.Round(pixel.Y);
                    Check("pump lantern is framed in real viewport",x>2&&y>2&&x<view.GetWidth()-3&&y<view.GetHeight()-3);
                    var colour=view.GetPixel(x,y);
                    var ray=PhysicsRayQueryParameters3D.Create(camera,centre,Solid.Layer);
                    var blocked=game.Cam.GetWorld3D().DirectSpaceState.IntersectRay(ray);
                    Check("pump lantern sightline is clear of real scenery",blocked.Count==0);
                    File.WriteAllText(Path.Combine(output,"pump-render.json"),JsonSerializer.Serialize(new {
                        camera=new[]{camera.X,camera.Y,camera.Z},centre=new[]{centre.X,centre.Y,centre.Z},
                        pixel=new[]{x,y},size=new[]{view.GetWidth(),view.GetHeight()},format=view.GetFormat().ToString(),
                        colour=new[]{colour.R,colour.G,colour.B,colour.A},lampAabb=lamp.GetAabb().ToString(),
                        blocker=blocked.Count>0 && blocked["collider"].AsGodotObject() is Node collider ? collider.GetPath().ToString() : ""
                    }));
                    view.SavePng(Path.Combine(output,"pump-raw.png"));
                    using var picture=game.GetViewport().GetTexture().GetImage();Check("actual pump lantern render captured",picture.SavePng(Path.Combine(output,"pump-lantern-night.png"))==Error.Ok);
                    Check("pump lantern actually renders bright after dark",colour.R*.2126f+colour.G*.7152f+colour.B*.0722f>.08f);
                }
                finally {pump.GetParent()?.RemoveChild(pump);pump.Free();}
            }
}
