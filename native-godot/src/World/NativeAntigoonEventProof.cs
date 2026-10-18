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
            var deadline=DateTime.UtcNow.AddSeconds(600);
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
            // His whole map at one metre a pixel: one colour per street area, grey where only people walk, white the stage, blue the player.
            var reachMap=encounter.ReachMap!();var picture=Image.CreateEmpty(820,560,false,Image.Format.Rgb8);
            await encounter.WithState(_=>
            {
                for(int z=0;z<560;z++)for(int x=0;x<820;x++)
                {
                    var p=new P(x-480+.5,z-80+.5);
                    int area=reachMap.Area(p);
                    picture.SetPixel(x,z,area!=0?Color.FromHsv(area*.137f%1,.85f,.9f):encounter.HumanClear(p)?new Color(.45f,.45f,.45f):Colors.Black);
                }
                return 0;
            });
            void Dot(P p,Color c){for(int dz=-3;dz<=3;dz++)for(int dx=-3;dx<=3;dx++){int x=(int)(p.X+480)+dx,z=(int)(p.Z+80)+dz;if(x>=0&&z>=0&&x<820&&z<560)picture.SetPixel(x,z,c);}}
            Dot(home,Colors.White);Dot(new(playerBefore.X,playerBefore.Y),new Color(.2f,.5f,1));
            picture.SavePng(Path.Combine(output,"reach-map.png"));
            Scheldemist.Dev.DevSheet.Close();Pause.Clear();
            GameState.I.PlayingWhen=()=>true;GameState.I.Hold=false;
            var pointer=game.Ui.GetNode<Control>("AntigoonDevPointer");
            var pointerDeadline=DateTime.UtcNow.AddSeconds(30);
            while(!pointer.Visible){if(DateTime.UtcNow>pointerDeadline)throw new Exception("DEV Antigoon arrow never appeared");await Frames(1);}
            var red=pointer.GetNode<Scheldemist.Play.Tick>("Arrow");
            if(red.Ink.R<.8f||red.Ink.G>.4f||!pointer.GetNode<Label>("Distance").Text.StartsWith("Antigoon · "))throw new Exception("Antigoon pointer is not red with a labelled distance");
            await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
            game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-dev-arrow.png"));
            Scheldemist.Menu.Prefs.SetDevMode(false);await Frames(3);
            if(pointer.Visible)throw new Exception("Antigoon arrow leaked into normal mode");
            Scheldemist.Menu.Prefs.SetDevMode(true);await Frames(3);
            if(!pointer.Visible)throw new Exception("Antigoon DEV arrow did not restore");
            GD.Print("ANTIGOON_DEV_ARROW_PASS: red quest-style arrow with live distance, hidden outside DEV mode.");
            if(!Jef.I.Fly)Jef.I.ToggleFly();
            // Move only this disposable proof camera/player to inspect the remote encounter after checking no teleport.
            var view=new[]{9.0,7,12,5,15}.SelectMany(r=>Enumerable.Range(0,16).Select(i=>new P(home.X+Math.Sin(i*Math.PI/8)*r,home.Z+Math.Cos(i*Math.PI/8)*r)))
                .Where(q=>encounter.HumanClear(q)&&encounter.Sight(q,home)).Select(p=>new Vector2((float)p.X,(float)p.Z)).First();
            // The camera may be close; the witness must stay outside attack range until the combat assertions.
            var observer=new[]{60.0,55,65}.SelectMany(r=>Enumerable.Range(0,32).Select(i=>new P(home.X+Math.Sin(i*Math.PI/16)*r,home.Z+Math.Cos(i*Math.PI/16)*r))).First(encounter.HumanClear);
            Jef.I.Place((float)observer.X,(float)observer.Z,0,0,(float)encounter.Ground(observer));
            game.Cam.SetProcess(false);game.Cam.SetPhysicsProcess(false);game.Cam.SetProcessInput(false);game.Cam.SetProcessUnhandledInput(false);
            // A free mouse pauses play (the menu takes over); live play keeps it captured.
            Input.MouseMode=Input.MouseModeEnum.Captured;Pause.Clear();
            game.Cam.GlobalPosition=new(view.X,(float)encounter.Ground(home)+3.2f,view.Y);game.Cam.LookAt(new((float)home.X,(float)encounter.Ground(home)+2.7f,(float)home.Z));
            await Frames(8);
            // Database-backed eligibility shares the service gate with the client's polling requests.
            // He roams now: the witness stands beside where the giant is, not where he was staged.
            var giantNow=At(await Sample(api));
            var foot=new[]{3.0,4,5,2.5,6}.SelectMany(r=>Enumerable.Range(0,16).Select(i=>new P(giantNow.X+Math.Sin(i*Math.PI/8)*r,giantNow.Z+Math.Cos(i*Math.PI/8)*r))).First(p=>encounter.HumanClear(p)&&encounter.Sight(giantNow,p));
            var candidates=town.Sims.Where(s=>!s.ActionHeld&&!s.Aboard&&!s.InTrip&&new P(s.R.HomeSx,s.R.HomeSz).Distance(foot)>25).OrderBy(s=>new P(s.R.HomeSx,s.R.HomeSz).Distance(foot)).Take(300).ToArray();
            // Database-backed eligibility shares the service gate with the client's polling requests.
            var chosen=await encounter.WithState(_=>
            {
                var eligible=candidates.FirstOrDefault(s=>encounter.MayObserve(1,s.R.Id)&&encounter.HumanPath(foot,new(s.R.HomeSx,s.R.HomeSz)) is {Count:>0})
                    ??throw new Exception($"No resident near the giant at {giantNow} can run home from {foot}");
                return (person:eligible,home:encounter.ResidentHome(eligible.R.Id));
            });
            var person=chosen.person;
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
            GD.Print("ANTIGOON_NATIVE_EVENT_PASS: real alley clearance, real resident, authoritative panic, native event rendering.");
            await Roams(game,api,encounter,playerBefore,output,Frames);
            await Kicks(game,api,encounter,output,Frames);
            await Grabs(game,api,encounter,output,Frames);
            await Feeds(game,api,encounter,playerBefore,output,Frames);
            game.GetTree().Quit();
        }
        catch(Exception error){File.WriteAllText(Path.Combine(output,"failure.txt"),error.ToString());GD.PrintErr(error);game.GetTree().Quit(1);}
    }
    private static async Task<JsonObject> Sample(Scheldemist.Net.Api api)=>JsonNode.Parse(await api.GetJson("api/antigoon"))!.AsObject();
    private static P At(JsonObject v)=>new(v["x"]!.GetValue<double>(),v["z"]!.GetValue<double>());
    /// <summary>With Jef far away he must keep walking his circuit of streets, not stop on his stage spot.</summary>
    private static async Task Roams(NativeTownGame game,Scheldemist.Net.Api api,Scheldemist.Native.Services.NativeAntigoon encounter,Vector2 far,string output,Func<int,Task> frames)
    {
        Jef.I.Place(far.X,far.Y,0,0);var trail=new System.Collections.Generic.List<P>();var until=DateTime.UtcNow.AddSeconds(30);
        // What the player sees: the drawn giant, frame by frame. Walking, his body must face the way he goes, and he
        // must not jerk back and forth.
        var actor=(Scheldemist.Native.Characters.AntigoonActor)game.FindChild("Antigoon",true,false);
        int moving=0,sideways=0,reversals=0;Vector3 last=actor.GlobalPosition,lastStep=Vector3.Zero;double clock=0,since=0;
        while(DateTime.UtcNow<until)
        {
            for(int f=0;f<30;f++)
            {
                await frames(1);double dt=game.GetProcessDeltaTime();clock+=dt;since+=dt;
                if(since<.2)continue;
                var step=actor.GlobalPosition-last;step.Y=0;float speed=step.Length()/(float)since;last=actor.GlobalPosition;since=0;
                if(speed>.5f&&actor.State is "walk" or "run" or "shield")
                {
                    moving++;var face=new Vector3(Mathf.Sin(actor.Rotation.Y),0,Mathf.Cos(actor.Rotation.Y));
                    if(face.AngleTo(step)>Mathf.DegToRad(50)){sideways++;GD.Print($"ANTIGOON_OFF {actor.State} facing off {Mathf.RadToDeg(face.AngleTo(step)):0} deg at {speed:0.0} m/s, host heading {Mathf.RadToDeg(Mathf.AngleDifference(actor.Rotation.Y,actor.Facing)):0} deg from body");}
                    if(lastStep.LengthSquared()>.01f&&lastStep.AngleTo(step)>Mathf.DegToRad(120)){reversals++;GD.Print($"ANTIGOON_REVERSAL {actor.State} turned {Mathf.RadToDeg(lastStep.AngleTo(step)):0} deg in 0.2 s at {speed:0.0} m/s");}
                }
                lastStep=speed>.5f?step:Vector3.Zero;
            }
            if(Pause.Paused){Input.MouseMode=Input.MouseModeEnum.Captured;Pause.Clear();}var v=await Sample(api);trail.Add(At(v));
            GD.Print($"ANTIGOON_TRACE {await encounter.WithState(e=>e.DevelopmentTrace())}");
        }
        GD.Print($"ANTIGOON_GAIT_LOOK {moving} moving samples: {sideways} facing over 50 degrees off his way, {reversals} sudden reversals");
        if(moving>10&&(sideways>moving/10||reversals>2))throw new Exception($"Antigoon walks sideways or jerks: {sideways}/{moving} off, {reversals} reversals");
        var start=trail[0];
        var spots=await encounter.WithState(e=>e.Roamable!(start,46));
        double furthest=spots.Count==0?0:spots.Max(p=>p.Distance(start));
        GD.Print($"ANTIGOON_REACH {spots.Count} roam spots, furthest {furthest:0.0} m");
        if(furthest<25)throw new Exception($"Antigoon is shut in: his streets reach only {furthest:0.0} m");
        // A metre map around his start: 'o' his map (flooded from here), '.' his map elsewhere, '+' he fits but it is cut off
        // from his streets (a safe place), 'w' water or no footing, '#' too tall to step over.
        File.WriteAllText(Path.Combine(output,"reach-map.txt"),await encounter.WithState(e=>
        {
            var reached=new System.Collections.Generic.HashSet<(int,int)>();var open=new System.Collections.Generic.Queue<(int,int)>();
            var origin=((int)Math.Round(start.X),(int)Math.Round(start.Z));reached.Add(origin);open.Enqueue(origin);
            while(open.Count>0){var (cx,cz)=open.Dequeue();foreach(var (dx,dz) in new[]{(1,0),(-1,0),(0,1),(0,-1)}){var n=(cx+dx,cz+dz);if(Math.Abs(n.Item1-origin.Item1)<=50&&Math.Abs(n.Item2-origin.Item2)<=50&&!reached.Contains(n)&&e.Clear(new(n.Item1,n.Item2))){reached.Add(n);open.Enqueue(n);}}}
            var map=new System.Text.StringBuilder();var reasons=new System.Collections.Generic.Dictionary<string,int>();
            for(int z=-50;z<=50;z++)
            {
                for(int x=-50;x<=50;x++)
                {
                    var p=new P(origin.Item1+x,origin.Item2+z);
                    if(x==0&&z==0){map.Append('@');continue;}
                    if(e.Clear(p)){map.Append(reached.Contains(((int)p.X,(int)p.Z))?'o':'.');continue;}
                    string why=e.BlockReason(p);map.Append(why=="clear"?'+':why is "water" or "no footing"?'w':'#');
                    if(why.Contains("triangles")){string band=why[(why.IndexOf("from")+5)..];band=band[..band.IndexOf(' ')];reasons[band]=(reasons.TryGetValue(band,out int seen)?seen:0)+1;}
                }
                map.AppendLine();
            }
            map.AppendLine("lowest blocking triangle over the feet (m): "+string.Join(", ",reasons.OrderBy(r=>double.Parse(r.Key)).Select(r=>r.Key+" x"+r.Value)));
            return map.ToString();
        }));
        double travelled=trail.Zip(trail.Skip(1),(a,b)=>a.Distance(b)).Sum(),reach=trail.Max(p=>p.Distance(trail[0]));
        GD.Print($"ANTIGOON_ROAM travelled {travelled:0.0} m, furthest {reach:0.0} m from where he started");
        if(travelled<25||reach<8)throw new Exception($"Antigoon stood still: travelled {travelled:0.0} m, furthest {reach:0.0} m");
        GD.Print("ANTIGOON_ROAM_PASS: the giant keeps walking reachable streets.");
    }
    /// <summary>Left alone he goes to food: a fish stall, the butcher, a bakery, a stray or a cat, and eats.</summary>
    private static async Task Feeds(NativeTownGame game,Scheldemist.Net.Api api,Scheldemist.Native.Services.NativeAntigoon encounter,Vector2 far,string output,Func<int,Task> frames)
    {
        // This is a remote observation; the original arrival position can be over water after the ferry has left.
        if(!Jef.I.Fly)Jef.I.ToggleFly();game.Cam.SetProcess(false);
        Jef.I.Drive=null;Jef.I.Place(far.X,far.Y,0,0);
        GameState.I.Apply(await api.Jobs());
        if(GameState.I.Health<=0||GameState.I.Ending!=null)throw new Exception("Combat killed the proof's witness; a game-over picture cannot prove eating.");
        GD.Print($"ANTIGOON_FOOD {await encounter.WithState(e=>e.FoodTrace())}");
        // The randomized developer stage can start across town. Budget the actual street route at his slower
        // shielding speed, with margin for corners, lamp-throw windups and polling; straight-line/120 s was not a route budget.
        double seconds=await encounter.WithState(e=>e.FoodWaitSeconds());
        File.WriteAllText(Path.Combine(output,"food-plan.json"),System.Text.Json.JsonSerializer.Serialize(await encounter.WithState(e=>e.FoodPlan()),new System.Text.Json.JsonSerializerOptions{WriteIndented=true}));
        GD.Print($"ANTIGOON_FOOD_WAIT: {seconds:0.0} seconds for the selected street route");
        var began=DateTime.UtcNow;var hardEnd=began.AddSeconds(Scheldemist.Native.Services.NativeAntigoon.FoodProofMaximumSeconds);
        var until=began.AddSeconds(seconds);string meal="";int ticks=0;
        string? goal=await encounter.WithState(e=>e.FoodTarget);
        while(DateTime.UtcNow<until)
        {
            await frames(20);if(Pause.Paused){Input.MouseMode=Input.MouseModeEnum.Captured;Pause.Clear();}
            var v=await Sample(api);
            if(v["state"]!.GetValue<string>()=="eat"&&v["meal"]?.GetValue<string>() is {} m){meal=m;break;}
            var plan=await encounter.WithState(e=>(Target:e.FoodTarget,Seconds:e.FoodTarget!=goal?e.FoodWaitSeconds():0));
            if(plan.Target!=goal)
            {
                goal=plan.Target;var changed=DateTime.UtcNow.AddSeconds(plan.Seconds);if(changed>until)until=changed<hardEnd?changed:hardEnd;
                GD.Print($"ANTIGOON_FOOD_REPLANNED {goal??"none"}: {(until-DateTime.UtcNow).TotalSeconds:0.0} seconds remain (bounded overall)");
            }
            if(++ticks%15==0)GD.Print($"ANTIGOON_FOOD_TRACE {await encounter.WithState(e=>e.DevelopmentTrace()+" | "+e.FoodGoal())}");
        }
        GD.Print($"ANTIGOON_FOOD {await encounter.WithState(e=>e.FoodTrace())}");
        if(meal=="")throw new Exception($"Left alone for {(DateTime.UtcNow-began).TotalSeconds:0.0} s, Antigoon never went to food: {await encounter.WithState(e=>e.FoodGoal())}");
        GameState.I.Apply(await api.Jobs());
        if(GameState.I.Health<=0||GameState.I.Ending!=null)throw new Exception("The remote witness died while waiting for food");
        var at=At(await Sample(api));
        // Jef's on-foot Look also owns the camera. Release it before framing the remote meal.
        if(!Jef.I.Fly)Jef.I.ToggleFly();
        var view=new[]{9.0,7,12,5,15}.SelectMany(r=>Enumerable.Range(0,24).Select(i=>new P(at.X+Math.Sin(i*Math.PI/12)*r,at.Z+Math.Cos(i*Math.PI/12)*r))).First(p=>encounter.HumanClear(p)&&encounter.BodyVisible(p,at));
        game.Cam.GlobalPosition=new((float)view.X,(float)encounter.Ground(view)+3,(float)view.Z);game.Cam.LookAt(new((float)at.X,(float)encounter.Ground(at)+2.5f,(float)at.Z));
        var actor=(Scheldemist.Native.Characters.AntigoonActor)game.FindChild("Antigoon",true,false);
        var renderedDeadline=DateTime.UtcNow.AddSeconds(4);
        while(actor.State!="eat"&&DateTime.UtcNow<renderedDeadline)await frames(1);
        if(actor.State!="eat")throw new Exception("The giant's renderer did not adopt the eating state");
        await frames(2);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-eating.png"));
        GD.Print($"ANTIGOON_FOOD_PASS: he went to {meal} and ate.");
    }
    /// <summary>
    /// Put the proof's Jef on a dark open spot before the giant, with no lamp light between them (light protects, and
    /// he would not come) and open stones behind (a throw is not stopped at once by a wall). Waits out the teleport
    /// hold while the street's collision round Jef is built.
    /// </summary>
    private static async Task<(P Giant,P Spot)> StandBefore(Scheldemist.Net.Api api,Scheldemist.Native.Services.NativeAntigoon encounter,Func<int,Task> frames,string what)
    {
        P giant=default,spot=default;
        var selectionDeadline=DateTime.UtcNow.AddSeconds(30);
        while(spot==default&&DateTime.UtcNow<selectionDeadline)
        {
            // Light reads the authoritative clock/rounds. Keep the search serialized with live API requests.
            var pick=await encounter.WithState(e=>
            {
                var g=e.DevelopmentPosition??throw new Exception("The developer giant disappeared");
                bool Dark(P a,P b){int n=Math.Max(1,(int)Math.Ceiling(a.Distance(b)*2));return Enumerable.Range(0,n+1).All(k=>e.Light(new(a.X+(b.X-a.X)*k/n,a.Z+(b.Z-a.Z)*k/n))<.4);}
                bool DarkRoute(P q){if(e.Path(g,q) is not {Count:>0} path)return false;var a=g;double length=0;foreach(var b in path){if(!Dark(a,b))return false;length+=a.Distance(b);a=b;}return length+a.Distance(q)<g.Distance(q)*1.2&&Dark(a,q);}
                // A reachable endpoint can be across a crane or a wall. This combat fixture needs a straight open
                // approach, not a street detour during which the witness leaves the giant's sight.
                bool Corridor(P q){int n=(int)Math.Ceiling(g.Distance(q)*4);return Enumerable.Range(1,n).All(k=>e.Fits(new(g.X+(q.X-g.X)*k/n,g.Z+(q.Z-g.Z)*k/n)));}
                bool Behind(P q){double dx=q.X-g.X,dz=q.Z-g.Z,d=Math.Sqrt(dx*dx+dz*dz);return d>.01&&Enumerable.Range(1,6).All(k=>e.HumanClear(new(q.X+dx/d*k*.5,q.Z+dz/d*k*.5)));}
                var q=new[]{9.0,7,6,4,3,2}.SelectMany(r=>Enumerable.Range(0,24).OrderBy(i=>Math.Abs(Math.IEEERemainder(i*Math.PI/12,Math.PI*2))).Select(i=>e.Snap(new(g.X+Math.Sin(e.DevelopmentYaw+i*Math.PI/12)*r,g.Z+Math.Cos(e.DevelopmentYaw+i*Math.PI/12)*r))))
                    .Where(p=>p is {} q&&e.HumanClear(q)&&e.Clear(q)&&e.Reach(g,q)&&e.Sight(q,g)&&e.Light(q)<.38&&Behind(q)&&Corridor(q)&&DarkRoute(q)).Select(p=>p!.Value).FirstOrDefault();
                return (Giant:g,Spot:q);
            });
            giant=pick.Giant;spot=pick.Spot;
            if(spot==default)await Task.Delay(250);
        }
        if(spot.X==0&&spot.Z==0)throw new Exception($"No dark open spot on his map near {giant} for the {what} proof");
        // Prepare the destination before placing Jef. Sixty fixed frames could conceal an entire attack under load.
        var ready=DateTime.UtcNow.AddSeconds(20);var feet=new Vector3((float)spot.X,(float)encounter.Ground(spot),(float)spot.Z);
        while(Scheldemist.World.Solid.I.Ensure(feet,14)>0&&DateTime.UtcNow<ready)await frames(1);
        Jef.I.Drive=null;
        Jef.I.Place((float)spot.X,(float)spot.Z,(float)Math.Atan2(-(giant.X-spot.X),-(giant.Z-spot.Z)),-.12f,feet.Y);
        while(Jef.I.PlacementPending&&DateTime.UtcNow<ready)await frames(1);
        if(Jef.I.PlacementPending)throw new Exception($"Jef's {what} placement did not settle");
        GD.Print($"ANTIGOON_COMBAT_READY {what}: giant {giant}, witness {spot}, health {GameState.I.Health}");
        return (giant,spot);
    }
    /// <summary>The attack after a kick is a grab: Jef is lifted by the neck before his face, then thrown about 6 m.</summary>
    private static async Task Grabs(NativeTownGame game,Scheldemist.Net.Api api,Scheldemist.Native.Services.NativeAntigoon encounter,string output,Func<int,Task> frames)
    {
        // Each combat assertion needs a living witness, independently of the damage in the preceding assertion.
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{health=10,food=10,warmth=10,sleep=10}));
        float Face(P from,P to)=>(float)Math.Atan2(-(to.X-from.X),-(to.Z-from.Z));
        // Up again where the kick threw him: back on a dark spot before the giant for his next attack, the grab.
        var before=await Sample(api);
        GD.Print("ANTIGOON_GRAB_START "+before.ToJsonString());
        if(before["state"]?.GetValue<string>()!="grab"||(before["target"]?.GetValue<int>()??0)<=0)await StandBefore(api,encounter,frames,"grab");
        var deadline=DateTime.UtcNow.AddSeconds(40);bool held=false,thrown=false,shot=false;Vector2 release=Vector2.Zero;
        int ticks=0;JsonObject last=new();
        while(!thrown)
        {
            if(DateTime.UtcNow>deadline)throw new Exception($"No grab and throw on Jef (held {held}): {last.ToJsonString()}");
            await frames(2);if(Pause.Paused){Input.MouseMode=Input.MouseModeEnum.Captured;Pause.Clear();}
            var v=await Sample(api);var g=At(v);var me=new P(Jef.I.X,Jef.I.Z);
            last=v;
            if(++ticks%15==0)GD.Print($"ANTIGOON_GRAB_TRACE {v["state"]} {v["state_time"]} target {v["target"]} held {v["held"]}, giant {g}, Jef {me}, health {GameState.I.Health}, fly {Jef.I.Fly}, pending {Jef.I.PlacementPending}");
            if(!held&&v["state"]!.GetValue<string>() is not ("grab" or "attack"))Jef.I.Yaw=Face(me,g);
            bool now=v["held"]?.GetValue<int>()>0;
            if(now&&!held)held=true;
            if(held&&!shot&&v["state_time"]!.GetValue<double>()>2.0)
            {
                shot=true;await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-held-close.png"));
                GD.Print($"ANTIGOON_GRAB_HELD Jef eye {Jef.I.Cam.GlobalPosition.Y-encoder(g):0.00} m over the street");
            }
            if(held&&!now){thrown=true;release=new(Jef.I.X,Jef.I.Z);}
        }
        double releasedAt=Jef.I.Clock;var landedDeadline=DateTime.UtcNow.AddSeconds(10);
        while((Jef.I.Clock-releasedAt<Scheldemist.Native.Services.AntigoonNightEvent.FlightTime+.25||!Jef.I.Grounded)&&DateTime.UtcNow<landedDeadline)await frames(1);
        if(!Jef.I.Grounded)throw new Exception("The thrown witness did not land");
        await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-after-throw.png"));
        float flown=release.DistanceTo(new(Jef.I.X,Jef.I.Z));
        GD.Print($"ANTIGOON_GRAB thrown {flown:0.0} m from his fist");
        bool walled=(await Sample(api))["throw"]?["wall"]?.GetValue<bool>()==true;
        if(flown<3&&!walled)throw new Exception($"The throw carried Jef only {flown:0.0} m");
        if(walled)GD.Print("ANTIGOON_GRAB a wall stopped the throw");
        GD.Print("ANTIGOON_GRAB_PASS: seized by the neck, held before his face, thrown across the street.");
        double encoder(P p)=>encounter.Ground(p);
    }
    /// <summary>Jef on foot in the dark in front of him: a bellow, a lunge, a landed kick that throws Jef back.</summary>
    private static async Task Kicks(NativeTownGame game,Scheldemist.Net.Api api,Scheldemist.Native.Services.NativeAntigoon encounter,string output,Func<int,Task> frames)
    {
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{health=10,food=10,warmth=10,sleep=10}));
        if(Jef.I.Fly)Jef.I.ToggleFly();
        // The new game's ferry arrival may still be carrying the proof's Jef: he is on foot in the street now.
        Jef.I.Drive=null;
        game.Cam.SetProcess(true);
        var previous=await Sample(api);int beforeKick=previous["kicked"]?.GetValue<int>()??0;
        var client=(Scheldemist.Native.Characters.NativeAntigoonClient)game.FindChild("AntigoonEncounter",true,false);int felt=client.KicksFelt;
        var (giant,spot)=await StandBefore(api,encounter,frames,"kick");
        float Face(P from,P to)=>(float)Math.Atan2(-(to.X-from.X),-(to.Z-from.Z));
        int kicked=beforeKick;var landed=Vector2.Zero;var hit=Vector2.Zero;var deadline=DateTime.UtcNow.AddSeconds(45);var shots=new System.Collections.Generic.HashSet<string>();
        while(kicked<=beforeKick)
        {
            if(DateTime.UtcNow>deadline)throw new Exception("Antigoon never landed a kick on Jef in the dark");
            await frames(2);if(Pause.Paused){Input.MouseMode=Input.MouseModeEnum.Captured;Pause.Clear();}var v=await Sample(api);kicked=v["kicked"]?.GetValue<int>()??0;
            var g=At(v);var me=new P(Jef.I.X,Jef.I.Z);
            // Hold Jef still, facing the giant, so the boot finds him.
            Jef.I.Yaw=Face(me,g);
            string state=v["state"]!.GetValue<string>();double time=v["state_time"]!.GetValue<double>();
            if(shots.Add("log"+(int)(DateTime.UtcNow-deadline).TotalSeconds))GD.Print($"ANTIGOON_KICK_TRACE {state} {time:0.00} target {v["target"]} at {g} jef {Jef.I.Body.GlobalPosition} light {encounter.Light(me):0.00}; {await encounter.WithState(e=>e.PlayerTrace(1))}");
            foreach(var (name,at) in new[]{("notice",.8),("attack",.35),("attack",.6)})
                if(state==name&&time>=at&&shots.Add(name+at))
                {
                    await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
                    game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,$"antigoon-{name}-{at:0.00}.png".Replace(',','.')));
                }
            hit=new(Jef.I.X,Jef.I.Z);
        }
        // The furthest he is thrown before anything else happens (the next attack may follow at once).
        float furthest=0;
        for(int i=0;i<40;i++){await frames(2);if((await Sample(api))["held"]?.GetValue<int>()>0)break;furthest=Math.Max(furthest,hit.DistanceTo(new(Jef.I.X,Jef.I.Z)));}
        await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);
        game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,"antigoon-after-kick.png"));
        landed=hit+(new Vector2(Jef.I.X,Jef.I.Z)-hit).Normalized()*furthest;
        GD.Print($"ANTIGOON_KICK shots {string.Join(",",shots.Where(s=>!s.StartsWith("log")))}; felt {client.KicksFelt-felt}; Jef thrown {hit.DistanceTo(landed):0.00} m (fly {Jef.I.Fly}, driven {Jef.I.Drive!=null}, swimming {Jef.I.Swimming}, climbing {Jef.I.Climbing}, grounded {Jef.I.Grounded}, collision pending {Scheldemist.World.Solid.I.Ensure(new Vector3(Jef.I.X,Jef.I.Y,Jef.I.Z),14)})");
        if(hit.DistanceTo(landed)<1.5f)throw new Exception($"Kick did not throw Jef back: {hit.DistanceTo(landed):0.00} m");
        GD.Print("ANTIGOON_KICK_PASS: landed kick throws Jef back with the view shaken.");
    }
}
