using System;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Town;

namespace Scheldemist.Native.World;

public static class NativeStartupProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        try
        {
            var deadline=DateTime.UtcNow.AddMinutes(12);
            bool sound=false,server=false,live=false;
            while(!game.Loaded || Loading.Busy || ServerLink.I?.Up!=true || !GameState.I.Live || game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not > 0)
            {
                if(!sound && Scheldemist.Audio.Soundscape.I is {Prepared:true}){sound=true;Scheldemist.Dev.StartupTiming.Mark("audio.ready");}
                if(!server && ServerLink.I?.Up==true){server=true;Scheldemist.Dev.StartupTiming.Mark("server.ready");}
                if(!live && GameState.I.Live){live=true;Scheldemist.Dev.StartupTiming.Mark("state.live");}
                if(DateTime.UtcNow>deadline)throw new TimeoutException("Startup did not reach the playable menu");
                await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
            }
            ulong menuMs=Time.GetTicksMsec();
            var menu=MainMenu.I??throw new InvalidOperationException("Startup menu is missing");
            menu.Start();
            for(int i=0;i<3;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.PhysicsFrame);
            if(!menu.InPlay)throw new InvalidOperationException("Menu did not enter gameplay");
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(output))!);
            File.WriteAllText(output,JsonSerializer.Serialize(new { menuMs,playableMs=Time.GetTicksMsec(),residents=game.GetNode<Townspeople>("Townspeople").Sims.Count,report=game.World.Report,timings=Scheldemist.Dev.StartupTiming.Snapshot() },new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"STARTUP_PLAYABLE: {Time.GetTicksMsec()} ms, menu {menuMs} ms");
            if(game.Flag("startup-verify-room-audit"))global::StartupRoomAuditProof.Verify();
            game.GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);game.GetTree().Quit(1);}
    }
}
