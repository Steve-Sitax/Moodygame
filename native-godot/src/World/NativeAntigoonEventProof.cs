using Godot;
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;
using P=Scheldemist.Native.Services.AntigoonBrain.Point;
namespace Scheldemist.Native.World;

/// <summary>Staged encounter in the real native streets, exclusively in a disposable proof save.</summary>
public static class NativeAntigoonEventProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        async Task Frames(int count){for(int i=0;i<count;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        try
        {
            if(!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!game.Flag("no-ai"))throw new Exception("Event proof requires its own database and --no-ai.");
            var deadline=DateTime.UtcNow.AddSeconds(120);
            while(!game.Loaded||Loading.Busy||ServerLink.I?.Up!=true||!GameState.I.Live||game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not >500)
            {if(DateTime.UtcNow>deadline)throw new TimeoutException("Native town not ready");await Frames(1);}
            MainMenu.I!.Start();Jef.I.TestInput=true;Pause.Clear();var api=ServerLink.I!.Api!;var town=game.GetNode<Townspeople>("Townspeople");
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=22,minute=0,weather="clear"}));await Frames(12);
            var encounter=game.AntigoonService!;P? alley=null,exit=null;
            foreach(var light in Lights.I.Lamps)
            {
                for(int i=0;i<16;i++)
                {
                    double a=i*Math.PI/8;var p=encounter.Snap(new(light.at.X+Math.Sin(a)*12,light.at.Z+Math.Cos(a)*12));
                    if(p is not {} at||!encounter.BackAlley(at)||!encounter.Clear(at)||encounter.Light(at)>=.25)continue;
                    for(int k=0;k<16;k++)
                    {
                        var end=encounter.Snap(new(at.X+Math.Sin(k*Math.PI/8)*10,at.Z+Math.Cos(k*Math.PI/8)*10));
                        if(end is {} q&&q.Distance(at)>7&&encounter.Clear(q)&&encounter.Sight(at,q)&&encounter.Path(at,q) is {Count:>0}){alley=at;exit=q;break;}
                    }
                    if(alley!=null)break;
                }
                if(alley!=null)break;
            }
            if(alley is not {} home)throw new Exception("No dark giant-sized back alley found in native map.");
            GD.Print($"ANTIGOON_NATIVE_ALLEY {home.X},{home.Z}");
            var view=new Vector2((float)exit!.Value.X,(float)exit.Value.Z);
            if(!Jef.I.Fly)Jef.I.ToggleFly();Jef.I.Place(view.X,view.Y,0,0,(float)encounter.Ground(home));
            GameState.I.PlayingWhen=()=>true;GameState.I.Hold=false;Pause.Clear();
            game.Cam.SetProcess(false);game.Cam.GlobalPosition=new(view.X,(float)encounter.Ground(home)+3.2f,view.Y);game.Cam.LookAt(new((float)home.X,(float)encounter.Ground(home)+2.7f,(float)home.Z));
            await encounter.StageProof(home);await Frames(8);
            var person=town.Sims.Where(s=>!s.ActionHeld&&!s.Aboard&&!s.InTrip&&new P(s.R.HomeSx,s.R.HomeSz).Distance(home)>25&&encounter.MayObserve(1,s.R.Id)&&encounter.HumanPath(home,new(s.R.HomeSx,s.R.HomeSz)) is {Count:>0}).OrderBy(s=>new P(s.R.HomeSx,s.R.HomeSz).Distance(home)).First();
            var foot=Enumerable.Range(0,16).Select(i=>new P(home.X+Math.Sin(i*Math.PI/8)*3,home.Z+Math.Cos(i*Math.PI/8)*3)).First(p=>encounter.HumanClear(p)&&encounter.Sight(home,p));
            town.ActionOutside(person);person.X=foot.X;person.Z=foot.Z;
            if(town.ActionClaim(person) is {} puppet)town.RemotePose(person,new Scheldemist.Net.Mp.Pose{X=(float)foot.X,Z=(float)foot.Z},puppet.Size);
            GD.Print($"ANTIGOON_WITNESS {person.R.Id} at {foot}; allowed {encounter.MayObserve(1,person.R.Id)}, home {encounter.ResidentHome(person.R.Id)}, sees {encounter.Sight(foot,home)}; playing {GameState.I.Playing}");
            var observed=await api.PostJson("api/antigoon/observe",new{people=new[]{new{id=person.R.Id,x=foot.X,z=foot.Z}}});
            File.WriteAllText(Path.Combine(output,"observation.json"),observed);
            JsonObject state=new();var until=DateTime.UtcNow.AddSeconds(8);
            do{await Frames(2);state=JsonNode.Parse(await api.PostJson("api/antigoon/observe",new{people=new[]{new{id=person.R.Id,x=foot.X,z=foot.Z}}}))!.AsObject();}while(DateTime.UtcNow<until&&!town.Sims.Any(p=>p.ServerEventDriven&&p.P!=null));
            File.WriteAllText(Path.Combine(output,"event-state.json"),state.ToJsonString());
            if((state["residents"] as JsonArray)?.Count is not >0)throw new Exception("Resident did not enter panic");
            if(!town.Sims.Any(p=>p.ServerEventDriven&&p.P!=null))throw new Exception("Real resident renderer did not adopt event pose");
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            game.View.GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-street-event.png"));
            File.WriteAllText(Path.Combine(output,"event-state.json"),state.ToJsonString());
            GD.Print("ANTIGOON_NATIVE_EVENT_PASS: real alley clearance, real resident, authoritative panic, native event rendering.");game.GetTree().Quit();
        }
        catch(Exception error){File.WriteAllText(Path.Combine(output,"failure.txt"),error.ToString());GD.PrintErr(error);game.GetTree().Quit(1);}
    }
}
