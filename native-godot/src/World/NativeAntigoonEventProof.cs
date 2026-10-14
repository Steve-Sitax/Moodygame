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
using Scheldemist.Ui;
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
            // Exercise scene replacement and responsive menu rebuilds before pressing the real event button.
            Dialogs.CloseAll();MainMenu.I!.QueueFree();await Frames(3);
            game.AddChild(new MainMenu{Name="MenuLifecycleProof"});await Frames(8);MainMenu.I!.Start();
            foreach(var size in new[]{new Vector2I(1360,900),new Vector2I(1440,1000),new Vector2I(1440,900)})
            {
                game.GetWindow().Size=size;await Frames(8);
                Scheldemist.Dev.DevSheet.Open();await Frames(4);Scheldemist.Dev.DevSheet.Close();await Frames(4);
                MainMenu.I!.ShowMenu(true);await Frames(2);MainMenu.I.Start();await Frames(2);
            }
            GD.Print("MENU_LIFECYCLE_PASS: replaced menu, resized and repeatedly opened/closed panels without stale callbacks.");
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=13,minute=0,weather="clear"}));
            Scheldemist.Dev.DevSheet.Open();await Frames(8);
            var sheet=Scheldemist.Dev.DevSheet.Current!;
            var button=sheet.FindChildren("ev_antigoon","",true,false).OfType<Scheldemist.Ui.InkButton>().Single();
            sheet.Scroll.EnsureControlVisible(button);await Frames(8);
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-event-button.png"));
            var playerBefore=new Vector2(Jef.I.X,Jef.I.Z);bool flyingBefore=Jef.I.Fly;
            var click=button.GetGlobalRect().GetCenter();
            Input.ParseInputEvent(new InputEventMouseMotion{Position=click,GlobalPosition=click});
            Input.ParseInputEvent(new InputEventMouseButton{ButtonIndex=MouseButton.Left,Pressed=true,Position=click,GlobalPosition=click});await Frames(2);
            Input.ParseInputEvent(new InputEventMouseButton{ButtonIndex=MouseButton.Left,Pressed=false,Position=click,GlobalPosition=click});
            var buttonDeadline=DateTime.UtcNow.AddSeconds(45);
            while(Scheldemist.Dev.DevSheet.Busy||!Scheldemist.Dev.DevSheet.Last.StartsWith("Antigoon is walking"))
            {if(DateTime.UtcNow>buttonDeadline)throw new Exception("Antigoon Events button failed: "+Scheldemist.Dev.DevSheet.Last);await Frames(1);}
            if(playerBefore.DistanceTo(new(Jef.I.X,Jef.I.Z))>.02f||Jef.I.Fly!=flyingBefore)throw new Exception("Event moved the player");
            GD.Print("ANTIGOON_PLAYER_POSITION_PASS: DEV event leaves player position and fly mode unchanged.");
            var selected=JsonNode.Parse(await api.GetJson("api/antigoon"))!.AsObject();
            if(selected["active"]?.GetValue<bool>()!=true||GameState.I.HourF<22)throw new Exception("Button did not start a nighttime encounter.");
            var encounter=game.AntigoonService!;var home=new P(selected["x"]!.GetValue<double>(),selected["z"]!.GetValue<double>());
            GD.Print($"ANTIGOON_EVENTS_BUTTON_PASS at {home}");
            Scheldemist.Dev.DevSheet.Close();Pause.Clear();
            GameState.I.PlayingWhen=()=>true;GameState.I.Hold=false;
            if(!Jef.I.Fly)Jef.I.ToggleFly();
            // Move only this disposable proof camera/player to inspect the remote encounter after checking no teleport.
            var view=Enumerable.Range(0,16).Select(i=>encounter.Snap(new(home.X+Math.Sin(i*Math.PI/8)*9,home.Z+Math.Cos(i*Math.PI/8)*9)))
                .Where(p=>p is {} q&&encounter.Clear(q)&&encounter.Sight(q,home)).Select(p=>new Vector2((float)p!.Value.X,(float)p.Value.Z)).First();
            Jef.I.Place(view.X,view.Y,0,0,(float)encounter.Ground(home));
            game.Cam.SetProcess(false);game.Cam.SetPhysicsProcess(false);game.Cam.SetProcessInput(false);game.Cam.SetProcessUnhandledInput(false);
            Input.MouseMode=Input.MouseModeEnum.Visible;
            game.Cam.GlobalPosition=new(view.X,(float)encounter.Ground(home)+3.2f,view.Y);game.Cam.LookAt(new((float)home.X,(float)encounter.Ground(home)+2.7f,(float)home.Z));
            await Frames(8);
            // Database-backed eligibility shares the service gate with the client's polling requests.
            var candidates=town.Sims.Where(s=>!s.ActionHeld&&!s.Aboard&&!s.InTrip&&new P(s.R.HomeSx,s.R.HomeSz).Distance(home)>25).ToArray();
            var chosen=await encounter.WithState(_=>
            {
                var eligible=candidates.Where(s=>encounter.MayObserve(1,s.R.Id)&&encounter.HumanPath(home,new(s.R.HomeSx,s.R.HomeSz)) is {Count:>0}).OrderBy(s=>new P(s.R.HomeSx,s.R.HomeSz).Distance(home)).First();
                return (person:eligible,home:encounter.ResidentHome(eligible.R.Id));
            });
            var person=chosen.person;
            var foot=Enumerable.Range(0,16).Select(i=>new P(home.X+Math.Sin(i*Math.PI/8)*3,home.Z+Math.Cos(i*Math.PI/8)*3)).First(p=>encounter.HumanClear(p)&&encounter.Sight(home,p));
            town.ActionOutside(person);person.X=foot.X;person.Z=foot.Z;
            if(town.ActionClaim(person) is {} puppet)town.RemotePose(person,new Scheldemist.Net.Mp.Pose{X=(float)foot.X,Z=(float)foot.Z},puppet.Size);
            GD.Print($"ANTIGOON_WITNESS {person.R.Id} at {foot}; allowed True, home {chosen.home}, sees {encounter.Sight(foot,home)}; playing {GameState.I.Playing}");
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
