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
using Scheldemist.Render;
using System.Collections.Generic;

namespace Scheldemist.Native.World;

/// <summary>Matched dock and river water captures in an isolated save.</summary>
public static class NativeWaterProof
{
    public static async Task Run(NativeTownGame game, string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int n) { for (int i=0;i<n;i++) await game.ToSignal(game.GetTree(), SceneTree.SignalName.ProcessFrame); }
        try
        {
            if (!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) || !game.Flag("no-ai"))
                throw new Exception("Water proof requires a disposable database under its output folder and --no-ai.");
            var deadline = DateTime.UtcNow.AddMinutes(10);
            while (!game.Loaded || Loading.Busy || ServerLink.I?.Up != true || !GameState.I.Live)
            { if(DateTime.UtcNow>deadline) throw new Exception("Town load timed out"); await Frames(3); }
            var api=ServerLink.I!.Api!;
            Prefs.Set("benchDone", true); Prefs.Preset("high");
            MainMenu.I!.Start(); Jef.I.TestInput=true; Pause.Clear(); game.Ui.Visible=false;
            GameState.I.Apply(await api.NewGame());
            if (!Jef.I.Fly) Jef.I.ToggleFly();
            var camera=new Camera3D { Fov=65, Near=.05f, Far=game.Cam.Far, CullMask=game.Cam.CullMask, Environment=game.Cam.Environment };
            game.World.AddChild(camera);
            var shaders = Waters.Materials.Select(m=>m.Shader).Distinct().ToArray();
            var originals = new Dictionary<Shader,string>();
            foreach(var shader in shaders) {
                var id=shader.Code.Contains("dx * 0.28") ? "r001104" : "r001377";
                var old=ResourceLoader.Load<Shader>(Paths.Absolute("../art-source/water-20261105/originals/"+id+".res"),null,ResourceLoader.CacheMode.Ignore).Code;
                const string begin="vec3 psx_ripples_at(", end="// the wave normal";
                int a=old.IndexOf(begin), b=old.IndexOf(end,a), ca=shader.Code.IndexOf(begin), cb=shader.Code.IndexOf(end,ca);
                originals[shader]=old[..a]+shader.Code[ca..cb]+old[b..];
            }
            foreach(string stage in new[]{"before","final"}) {
            foreach(var shader in shaders) {
                string code=originals[shader];
                if(stage!="before") code=Psx.WithNaturalWater(code);
                shader.Code=code;
            }
            string captures=Path.Combine(output,stage); Directory.CreateDirectory(captures);
            foreach (string weather in new[]{"day","rain","night"})
            {
                int hour=weather=="night"?22:13;
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new { day=1,hour,minute=0,weather=weather=="rain"?"rain":"clear" }));
                MoverClock.Hold(hour,1); Daylight.I.SetTime(hour); Daylight.I.SetWeather(weather=="rain"?"rain":"clear"); Daylight.I.Settle();
                foreach(var shot in new[]{
                    ("dock",new Vector3(74,2,65),new Vector3(110,-2,83)),
                    ("dock-low",new Vector3(155,Tide.Dock+0.6f,94),new Vector3(130,Tide.Dock,80)),
                    ("dock-reverse",new Vector3(166,2,100),new Vector3(110,-2,80)),
                    ("schelde",new Vector3(25,2,-2),new Vector3(40,-2,-40)),
                    ("schelde-low",new Vector3(25,Tide.River+0.6f,-10),new Vector3(40,Tide.River,-45))})
                {
                    for(int frame=0;frame<75;frame++) {
                        Pause.Clear();
                        var eye=shot.Item2; var focus=shot.Item3;
                        if(shot.Item1.EndsWith("low")) { float level=shot.Item1.StartsWith("dock")?Tide.Dock:Tide.River; eye.Y=level+0.6f; focus.Y=level; }
                        game.Cam.GlobalPosition=eye; camera.GlobalPosition=eye;
                        camera.LookAt(focus); camera.MakeCurrent(); await Frames(1);
                    }
                    await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    using var img=game.GetViewport().GetTexture().GetImage();
                    img.SavePng(Path.Combine(captures,$"{shot.Item1}-{weather}.png"));
                }
            }
            }
            game.GetTree().Quit();
        }
        catch(Exception e) { File.WriteAllText(Path.Combine(output,"failure.txt"),e.ToString()); GD.PushError(e.ToString()); game.GetTree().Quit(1); }
    }
}
