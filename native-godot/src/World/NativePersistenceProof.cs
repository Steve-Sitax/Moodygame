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

namespace Scheldemist.Native.World;

/// <summary>Two real game processes: save through the menu, change the live world, then reload the saved slot.</summary>
public static class NativePersistenceProof
{
    public sealed record Expected(int Money, PocketItem[] Pockets, string Jobs, ClientState Client);
    public static async Task Run(NativeTownGame game,string output)
    {
        var checks=new List<object>();
        string phase=game.Arg("persistence-phase","write");
        void Check(string name,bool passed){checks.Add(new{name,passed});if(!passed)throw new InvalidOperationException(name);}
        async Task Frames(int count){for(int i=0;i<count;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Until(Func<bool> ready,int seconds=60)
        {
            var end=DateTime.UtcNow.AddSeconds(seconds);
            while(!ready()){if(DateTime.UtcNow>end)throw new TimeoutException("Persistence proof wait expired");await Frames(1);}
        }
        string Pockets()=>JsonSerializer.Serialize(GameState.I.Pockets.OrderBy(p=>p.Id));
        string Jobs()=>JsonSerializer.Serialize(GameState.I.Jobs.OrderBy(j=>j.Id).Select(j=>new{j.Id,j.Status,j.PayC,j.Task}));
        try
        {
            Directory.CreateDirectory(output);
            Check("isolated database inside proof directory",Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase));
            Check("known proof phase",phase is "write" or "read");
            await Until(()=>game.Loaded&&!Loading.Busy&&ServerLink.I?.Up==true&&GameState.I.Live&&game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count>500,600);
            var menu=MainMenu.I!;var api=ServerLink.I!.Api!;var j=Jef.I;
            menu.Start();await Frames(5);Check("real menu enters gameplay",menu.InPlay);
            if(phase=="write")
            {
                await api.Post<OkReply>("api/arrival/ashore");await Until(()=>!j.Riding,20);
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{hour=13,minute=0,weather="clear",money_c=1234,food=40}));
                if(j.Fly)j.ToggleFly();j.TestInput=true;j.Place(52.5f,2.25f,0,0,0);await Frames(45);
                Check("player stands on street collision",j.Grounded&&!j.Swimming);
                var bought=await api.Buy("fientje","herring");GameState.I.Apply(bought);
                Check("purchase changes money and inventory",GameState.I.Money==1234-bought.PriceC&&GameState.I.Pockets.Any(p=>p.Kind=="herring"));
                Pause.Set("persistence-proof",true);await Frames(3);
                var expected=new Expected(GameState.I.Money,GameState.I.Pockets.OrderBy(p=>p.Id).ToArray(),Jobs(),menu.Saves.Capture!());
                string outcome="";menu.Saves.Save("slot4","Persistence proof",s=>outcome=s);
                await Until(()=>outcome!="",90);Check("menu writes save slot",outcome.StartsWith("saved slot4",StringComparison.Ordinal));
                File.WriteAllText(Path.Combine(output,"expected.json"),JsonSerializer.Serialize(expected));
                Pause.Set("persistence-proof",false);
                GameState.I.Apply(await api.Use(expected.Pockets.First(p=>p.Kind=="herring").Id));
                GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{money_c=17}));
                j.Place(62.5f,2.25f,0,0,0);await Frames(20);
                Check("live world differs from saved money and pockets",GameState.I.Money!=expected.Money&&Pockets()!=JsonSerializer.Serialize(expected.Pockets));
                Check("live player moved away from saved position",Math.Abs(j.X-expected.Client.Pose.X)>5);
            }
            else
            {
                var expected=JsonSerializer.Deserialize<Expected>(File.ReadAllText(Path.Combine(output,"expected.json")))!;
                Check("new process sees changed live database",GameState.I.Money!=expected.Money&&Pockets()!=JsonSerializer.Serialize(expected.Pockets));
                string outcome="";menu.Saves.Load("slot4",s=>outcome=s);
                await Until(()=>outcome!="",90);Check("menu loads saved slot in new process",outcome=="loaded slot4");
                await Frames(3);
                Check("money restored exactly",GameState.I.Money==expected.Money);
                Check("stable inventory IDs and contents restored",Pockets()==JsonSerializer.Serialize(expected.Pockets));
                Check("job identities, status, pay and task state restored",Jobs()==expected.Jobs);
                menu.Start();await Frames(20);
                Check("player pose restored",Math.Abs(j.X-expected.Client.Pose.X)<.025&&Math.Abs(j.Z-expected.Client.Pose.Z)<.025&&Math.Abs(j.Y-expected.Client.Pose.Y)<.05);
                Check("restored player is supported and playable",menu.InPlay&&j.Grounded&&!j.Frozen&&!j.Swimming);
                await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                using var shot=game.GetViewport().GetTexture().GetImage();shot.SavePng(Path.Combine(output,"restored.png"));
            }
            File.WriteAllText(Path.Combine(output,phase+".json"),JsonSerializer.Serialize(new{passed=true,phase,checks}));
            GD.Print($"PERSISTENCE_GAMEPLAY_PASS: {phase}, {checks.Count} checks");game.GetTree().Quit();
        }
        catch(Exception e)
        {
            File.WriteAllText(Path.Combine(output,phase+".json"),JsonSerializer.Serialize(new{passed=false,phase,checks,error=e.ToString()}));
            GD.PushError(e.ToString());game.GetTree().Quit(1);
        }
    }
}
