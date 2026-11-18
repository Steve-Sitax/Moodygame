using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
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
            var deadline=DateTime.UtcNow.AddMinutes(int.TryParse(game.Arg("startup-timeout-minutes"),out int minutes)?Math.Clamp(minutes,1,90):12);
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
            if(game.Arg("ruien-life-review") is {Length:>0} lifeReview)
            {await ReviewRuienLife(game,Paths.Absolute(lifeReview));return;}
            if(game.Arg("colony-proof") is {Length:>0} colonyProof)
            {await NativeRuienRatsProof.Colony(game,Paths.Absolute(colonyProof));await FinishRuienReview(game,0);return;}
            if(game.Arg("ruien-rats-proof") is {Length:>0} ratsProof)
            {await NativeRuienRatsProof.Run(game,Paths.Absolute(ratsProof));await FinishRuienReview(game,0);return;}
            if(game.Arg("ruien-landmarks-proof") is {Length:>0} landmarksProof)
            {await NativeRuienLandmarksProof.Run(game,Paths.Absolute(landmarksProof));game.GetTree().Quit();return;}
            if(game.Arg("fit-ruien-plaques") is {Length:>0} plaqueFits)
            {NativeRuienMapProof.Fit(game,Paths.Absolute(plaqueFits));return;}
            if(game.Arg("ruien-map-proof") is {Length:>0} mapProof)
            {await NativeRuienMapProof.Run(game,Paths.Absolute(mapProof));return;}
            if(game.Arg("market-visual-proof") is {Length:>0} marketProof)
            {await NativeMarketVisualProof.Run(game,Paths.Absolute(marketProof));return;}
            if(game.Arg("river-traversal-proof") is {Length:>0} riverProof)
            {await Scheldemist.Player.RiverTraversalProof.Run(game,Scheldemist.Paths.Absolute(riverProof));return;}
            if(game.Flag("startup-verify-room-audit"))global::StartupRoomAuditProof.Verify();
            if(game.Arg("character-repair-proof") is {Length:>0} characterProof)
            {await Scheldemist.Player.CharacterRepairProof.Run(game,Scheldemist.Paths.Absolute(characterProof));return;}
            if(game.Arg("net-rack-proof") is {Length:>0} netProof)
            {await NativeNetRackProof.Run(game,Scheldemist.Paths.Absolute(netProof));return;}
            if(game.Arg("cargo-barrel-proof") is {Length:>0} barrelProof)
            {await NativeCargoBarrelProof.Run(game,Scheldemist.Paths.Absolute(barrelProof));return;}
            if(game.Arg("ruien-network-review") is {Length:>0} review)
            {await NativeRuienNetworkReview.Run(game,Scheldemist.Paths.Absolute(review));return;}
            if(game.Arg("ruien-network-proof") is {Length:>0} networkProof)
            {bool passed=await NativeRuienNetworkProof.Run(game,Scheldemist.Paths.Absolute(networkProof));game.GetTree().Quit(passed?0:1);}
            // A simultaneous street-view capture finishes and closes this same playable run.
            else if (game.GetNodeOrNull<Scheldemist.Dev.Snap>("Snap")?.IsProcessing() != true)
                game.GetTree().Quit();
        }
        catch(Exception e){GD.PrintErr(e);game.GetTree().Quit(1);}
    }

    private static async Task ReviewRuienLife(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        var failures=new List<string>();
        async Task Check(string name,Func<Task> work)
        {
            try { await work(); }
            catch(Exception e) { failures.Add(name+" — "+e.Message); GD.PrintErr(e); }
        }
        await Check("street sounds",async ()=>
        {
            var sound=Scheldemist.Audio.Soundscape.I ?? throw new InvalidOperationException("Soundscape is missing");
            var checks=await sound.ProofRuienStreetSound();
            File.WriteAllText(Path.Combine(output,"grate-sound.json"),JsonSerializer.Serialize(checks.Select(c=>new{c.name,c.ok,c.detail})));
            if(checks.Count==0 || checks.Any(c=>!c.ok))throw new InvalidOperationException("Grate sound checks failed");
        });
        await Check("sluice gauge",()=>NativeRuienGaugeProof.Run(game,Path.Combine(output,"gauge")));
        await Check("junction landmarks",()=>NativeRuienLandmarksProof.Run(game,Path.Combine(output,"junctions")));
        await Check("rats",()=>NativeRuienRatsProof.Run(game,Path.Combine(output,"rats")));
        File.WriteAllText(Path.Combine(output,"result.json"),JsonSerializer.Serialize(new{passed=failures.Count==0,failures}));
        await FinishRuienReview(game,failures.Count==0?0:1);
    }

    private static async Task FinishRuienReview(NativeTownGame game,int exitCode)
    {
        // The sweeps create temporary native wrappers. Allow their queued releases to
        // run on the main thread before shutting down the engine used for this proof.
        GC.Collect();
        GC.WaitForPendingFinalizers();
        for(int i=0;i<5;i++) await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);
        game.GetTree().Quit(exitCode);
    }
}
