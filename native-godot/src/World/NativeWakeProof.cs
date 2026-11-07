using System;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.Movers;

namespace Scheldemist.Native.World;

/// <summary>Native river wake captures in an isolated save, following an actual moving hull.</summary>
public static class NativeWakeProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int n) { for (int i=0;i<n;i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            if (!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !game.Flag("no-ai"))
                throw new Exception("Wake proof requires a disposable database under its output folder and --no-ai.");
            var deadline = DateTime.UtcNow.AddMinutes(10);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live)
            { if(DateTime.UtcNow>deadline) throw new Exception("Town load timed out"); await Frames(3); }
            var api=ServerLink.I!.Api!;
            MainMenu.I!.Start(); Jef.I.TestInput=true; Pause.Clear(); game.Ui.Visible=false;
            GameState.I.Apply(await api.NewGame());
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            var subjects = new[] { River.I.Movers.OrderBy(m=>m.Parts[0].Len).First(), River.I.Movers.OrderByDescending(m=>m.Parts[0].Len).First() }.Distinct().ToArray();
            foreach (var ship in subjects)
            {
            var part=ship.Parts[0];
            var camera=new Camera3D { Fov=65, Near=.05f, Far=game.Cam.Far, CullMask=game.Cam.CullMask, Environment=game.Cam.Environment };
            game.World.AddChild(camera);
            File.WriteAllText(Path.Combine(output,$"{ship.Lead}-subject.txt"), $"{ship.Lead}: length {part.Len}, beam {ship.Beam}, speed {ship.V}");
            foreach (string weather in new[]{"day","rain","night"})
            {
                int hour=weather=="night"?22:13;
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new { day=1,hour,minute=0,weather=weather=="rain"?"rain":"clear" }));
                MoverClock.Hold(hour,1); Daylight.I.SetTime(hour); Daylight.I.SetWeather(weather=="rain"?"rain":"clear"); Daylight.I.Settle();
                foreach (string view in new[]{"stern","high","side"})
                {
                    for(int frame=0;frame<100;frame++)
                    {
                        Pause.Clear();
                        var dir=new Vector3((float)ship.Hx,0,(float)ship.Hz); var side=new Vector3(-dir.Z,0,dir.X);
                        var stern=part.Boat.Outer.GlobalPosition-dir*(float)part.Len*.5f;
                        var focus=stern-dir*5;
                        var eye=view=="high"?stern-dir*20+side*16+Vector3.Up*28:view=="side"?stern+side*22+Vector3.Up*3:stern-dir*23+side*7+Vector3.Up*6;
                        game.Cam.GlobalPosition=eye; camera.GlobalPosition=eye; camera.LookAt(focus); camera.MakeCurrent();
                        await Frames(1);
                        if(frame==70 || frame==99)
                        {
                            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                            using var img=game.GetViewport().GetTexture().GetImage();
                            if(img.SavePng(Path.Combine(output,$"{ship.Lead}-{weather}-{view}-{frame}.png"))!=Error.Ok) throw new Exception("Capture failed");
                        }
                    }
                }
            }
            camera.QueueFree();
            }
            game.GetTree().Quit();
        }
        catch(Exception e) { File.WriteAllText(Path.Combine(output,"failure.txt"),e.ToString()); GD.PushError(e.ToString()); game.GetTree().Quit(1); }
    }
}
