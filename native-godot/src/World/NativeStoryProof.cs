using Godot;
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Tasks;
using Scheldemist.Game;
using Scheldemist.Menu;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;
using Scheldemist.Town;
using Scheldemist.World;
using Dialogs = Scheldemist.Ui.Dialogs;
namespace Scheldemist.Native.World;

/// <summary>
/// Chapter 1 played through in the real town with AI off, in a disposable save: the lamplighter's authored offer, the
/// quest book entry, a refused early lamp, both lamps lit with E and rendered, the ladder and book with E, a save and
/// load in the middle, the staged sighting (no locator, no attack), the truthful report and its pay once, and the
/// door note for a sleeping lamplighter. Pictures go to the proof folder.
/// </summary>
public static class NativeStoryProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        var checks=new JsonArray();
        async Task Frames(int count){for(int i=0;i<count;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Seconds(double s){var until=DateTime.UtcNow.AddSeconds(s);while(DateTime.UtcNow<until)await Frames(1);}
        async Task Shot(string name){await Frames(2);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,name+".png"));}
        void Check(string what,bool ok,string detail=""){checks.Add(new JsonObject{["check"]=what,["ok"]=ok,["detail"]=detail});GD.Print((ok?"STORY_PASS: ":"STORY_FAIL: ")+what+(detail==""?"":" ("+detail+")"));if(!ok)throw new Exception(what+(detail==""?"":": "+detail));}
        try
        {
            if(!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!game.Flag("no-ai"))throw new Exception("Story proof requires its own database and --no-ai.");
            var deadline=DateTime.UtcNow.AddSeconds(600);
            while(!game.Loaded||Loading.Busy||ServerLink.I?.Up!=true||!GameState.I.Live||game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not >500)
            {if(DateTime.UtcNow>deadline)throw new TimeoutException("Native town not ready");await Frames(1);}
            MainMenu.I!.Start();Jef.I.TestInput=true;Pause.Clear();Dialogs.CloseAll();var api=ServerLink.I!.Api!;
            async Task Clock(int hour,int minute=0){GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour,minute,weather="clear"}));await Frames(10);}
            async Task<StoryView> View(){GameState.I.Apply(await api.Jobs());return GameState.I.Payload!.Story!;}
            int Money()=>GameState.I.Payload!.Player.MoneyC;
            void Face(float x,float z,float tx,float tz,float pitch=0)=>Jef.I.Place(x,z,MathF.Atan2(-(tx-x),-(tz-z)),pitch);
            async Task<bool> Press(string prompt){for(int i=0;i<30;i++){Interact.I.RepeatPrompt();if(Interact.I.Text.Contains(prompt,StringComparison.OrdinalIgnoreCase))return Interact.I.Press(Key.E);await Frames(2);}return false;}
            await Clock(13);
            var story=await View();
            Check("a new town offers chapter 1",story.Status=="offered"&&story.Chapter==1&&story.Lamps.Count==2&&story.Lowie!="",$"{story.Status}, lamplighter {story.LowieName}, lamps {string.Join(",",story.Lamps.Select(l=>l.Id))}");
            Check("the offer takes no job place",GameState.I.Jobs.All(j=>j.Status!="taken"));

            // The lamplighter's authored lines, with AI off.
            var open=await api.Talk(story.Lowie,"open",null);
            Check("the lamplighter opens with Pieter's lamps",open.NpcLine.Contains("never brought the ladder back"),open.NpcLine);
            Check("he offers the question",open.Choices.Contains("Where did he finish?"),string.Join(" | ",open.Choices));
            var asked=await api.Talk(story.Lowie,"choice","Where did he finish?");
            story=await View();
            Check("asking takes the chapter up and loans the pole",story.Status=="active"&&asked.NpcLine.Contains("Take my pole"),asked.NpcLine);
            Check("the book entry is followed",Jobs.I.StoryFollowed&&Story.I?.Goal() is {},$"goal {story.Goal?.Label}");
            Jobs.I.OpenBook();await Frames(6);await Shot("01-quest-book");Jobs.I.CloseBook();await Frames(3);

            // The last stop by day: the ladder and the book are there to be looked at.
            var ladder=story.Ladder!;var book=story.Book!;var last=story.Lamps[1];
            Face(ladder.X+1.4f,ladder.Z+.2f,ladder.X,ladder.Z,-.7f);await Seconds(1.5);await Shot("02-last-stop-day");
            Check("E looks at the ladder",await Press("ladder"),Interact.I.Text);await Seconds(1.5);
            Face(book.X+1f,book.Z+.3f,book.X,book.Z,-.9f);await Seconds(1);
            Check("E picks up the book",await Press("pick up the book"),Interact.I.Text);await Seconds(1.5);
            await Shot("03-route-book");Story.I?.ClosePaper();await Frames(3);
            story=await View();
            Check("ladder and book are journal facts",story.Inspected&&story.Book!.Taken&&story.Facts.Any(f=>f.Id=="ladder")&&story.Facts.Any(f=>f.Id=="book"));

            // Pieter's lamps: refused before dusk, dark among lit neighbours after it, lit with the pole.
            var first=story.Lamps[0];
            await Clock(15,30);Face(first.Sx,first.Sz,first.X,first.Z,.5f);await Seconds(1);
            bool early=await Press($"light {story.Helper}'s lamp");await Seconds(2);
            Check("a lamp before dusk is refused",early&&!(await View()).Lamps[0].Lit);
            await Clock(19,30);await Seconds(3);
            int Index(string id){int i=0;foreach(var l in Lights.I.Lamps){if(l.id==id)return i;i++;}return -1;}
            int k0=Index(first.Id),k1=Index(last.Id);
            Check("Pieter's lamps are in the town's lights",k0>=0&&k1>=0,$"{k0},{k1}");
            Check("his lamps stay dark at 19:30",Lights.I.LampBright(k0)<.1f&&Lights.I.LampBright(k1)<.1f,$"{Lights.I.LampBright(k0):0.00} {Lights.I.LampBright(k1):0.00}");
            Face(first.Sx+.4f,first.Sz+.4f,first.X,first.Z,.35f);await Seconds(1);await Shot("04-dark-lamp-night");
            Check("E lights the first lamp",await Press($"light {story.Helper}'s lamp"),Interact.I.Text);await Seconds(4);
            story=await View();
            Check("the first lamp is lit and burns",story.Lamps[0].Lit&&Lights.I.LampBright(k0)>.3f,$"{Lights.I.LampBright(k0):0.00}");
            await Shot("05-lit-lamp-night");

            // Save in the middle; load; the chapter is where it was.
            var client=new ClientState(new ClientClock(GameState.I.Day,GameState.I.Hour,GameState.I.Minute),null,new ClientPose(Jef.I.X,Jef.I.Z,Jef.I.Y,Jef.I.Yaw,Jef.I.Pitch));
            var saved=await api.Save("slot1","story proof",client);Check("saved mid-chapter",saved.Ok,saved.Error??"");
            // Loaded the way the menu does it, then back into play.
            string outcome="";MainMenu.I!.Saves.Load("slot1",o=>outcome=o);
            for(int i=0;i<600&&outcome=="";i++)await Frames(2);
            Check("loaded it again from the menu",outcome=="loaded slot1",outcome);
            MainMenu.I.Start();Pause.Clear();await Frames(120);
            story=await View();
            Check("after the load the chapter keeps its lamp and clues",story.Status=="active"&&story.Lamps[0].Lit&&!story.Lamps[1].Lit&&story.Inspected,$"{story.Status}");

            Face(last.Sx+.4f,last.Sz-.4f,last.X,last.Z,.35f);await Seconds(1);
            bool lastPressed=await Press($"light {story.Helper}'s lamp");if(!lastPressed)await Shot("debug-last-lamp");
            Check("E lights the last lamp",lastPressed,$"prompt \"{Interact.I.Text}\", playing {GameState.I.Playing}, paused {ServerLink.I?.Paused}, jef {Jef.I.X:0.0},{Jef.I.Z:0.0}, step {last.Sx:0.0},{last.Sz:0.0}, dialogs {Scheldemist.Windows.Dialogs.I?.Any}");await Seconds(4);
            story=await View();
            for(int i=0;i<40&&Lights.I.LampBright(k1)<=.3f;i++)await Seconds(.2);
            Check("both lamps lit",story.Lamps.All(l=>l.Lit)&&Lights.I.LampBright(k1)>.3f,$"lit {string.Join(",",story.Lamps.Select(l=>l.Lit))}, flame {Lights.I.LampBright(k1):0.00}, hour {GameState.I.HourF:0.00}");

            // The staged sighting at the authored junction, when one is chosen.
            var junction=game.StoryService!.Junction;
            if(junction is {} j)
            {
                await Clock(22,30);
                // Walk him into range: the spot 34 m from the junction with the clearest look at it.
                var eye=await game.ServiceHost!.WithState(_=>{
                    var e=game.AntigoonService!;
                    foreach(double r in new[]{30.0,34,38})for(int a=0;a<16;a++){var p=new Scheldemist.Native.Services.AntigoonBrain.Point(j.X+Math.Sin(a*Math.PI/8)*r,j.Z+Math.Cos(a*Math.PI/8)*r);
                        if(game.World.NativeWalk!.PathFree(p.X,p.Z)&&e.BodyVisible(p,j)&&e.StageAt(j,p,new(last.X,last.Z)) is {})return (Scheldemist.Native.Services.AntigoonBrain.Point?)p;}
                    return null;});
                Check("a spot to see the junction from",eye!=null);
                // Facing away: the scrape must turn his head first.
                Face((float)eye!.Value.X,(float)eye.Value.Z,(float)(2*eye.Value.X-j.X),(float)(2*eye.Value.Z-j.Z));
                JsonObject state=new();bool appeared=false,locator=false,attacked=false;int frames=0;
                for(int i=0;i<600&&!appeared;i++){state=JsonNode.Parse(await api.GetJson("api/antigoon"))!.AsObject();appeared=state["story_sound"]!=null;await Frames(3);}
                Check("the scrape comes first",appeared);
                Face((float)eye.Value.X,(float)eye.Value.Z,(float)j.X,(float)j.Z,.12f);
                bool crossed=false;var shots=0;
                for(int i=0;i<900;i++)
                {
                    state=JsonNode.Parse(await api.GetJson("api/antigoon"))!.AsObject();
                    if(state["development_spawn"]?.GetValue<bool>()==true||Main.I.Ui.GetNodeOrNull<Control>("AntigoonDevPointer")?.Visible==true)locator=true;
                    if((state["target"]?.GetValue<int>()??0)!=0||state["state"]?.GetValue<string>() is "attack" or "run" or "notice")attacked=true;
                    if(state["active"]?.GetValue<bool>()==true&&state["state"]?.GetValue<string>()=="walk"){crossed=true;if(frames++%25==0&&shots<4)await Shot($"06-sighting-{++shots}");}
                    if(crossed&&state["active"]?.GetValue<bool>()==false)break;
                    await Frames(3);
                }
                Check("he crossed in view",crossed);
                Check("no locator in the story",!locator);
                Check("no target and no attack",!attacked);
                await Seconds(8);
                story=await View();
                Check("what Jef saw and heard is written down",story.Facts.Any(f=>f.Id=="heard:scrape")&&story.Facts.Any(f=>f.Id=="seen:figure"),string.Join(",",story.Facts.Select(f=>f.Id)));
            }
            else GD.Print("STORY_NOTE: no sighting junction chosen yet; the sighting is not played.");

            // The report: only true variants; paid once.
            await Clock(20,0);
            int before=Money();
            open=await api.Talk(story.Lowie,"open",null);
            var reports=open.Choices.Where(c=>c.StartsWith("I found")||c.StartsWith("Something")).ToList();
            Check("the report choices are truthful",reports.Contains("I found his ladder bent at the last lamp, and his book on the stones.")&&(junction!=null)==reports.Any(c=>c.StartsWith("Something crossed")),string.Join(" | ",open.Choices));
            var told=await api.Talk(story.Lowie,"choice",reports.Last());
            story=await View();int paid=Money()-before;
            Check("telling him closes the chapter and pays the lamp rate once",story.Status=="done"&&paid==story.PaidC&&paid>0,$"{paid} c: {told.NpcLine}");
            open=await api.Talk(story.Lowie,"open",null);
            Check("no second pay",Money()-before==paid&&!open.Choices.Any(c=>c.StartsWith("I found")));
            Jobs.I.OpenBook();await Frames(6);await Shot("07-quest-book-done");Jobs.I.CloseBook();await Frames(3);

            // The other way: a sleeping lamplighter and a note under his door, paid when he reads it.
            await api.Post<JsonElement>("api/dev/story",new{status="active"});
            story=await View();
            await api.Post<StoryReply>("api/story/inspect",new{what="ladder",x=story.Ladder!.X,z=story.Ladder.Z});
            await api.Post<StoryReply>("api/story/inspect",new{what="book",x=story.Book!.X,z=story.Book.Z});
            await Clock(19,30);await api.Post<StoryReply>("api/story/light",new{lamp=story.Lamps[0].Id,x=story.Lamps[0].Sx,z=story.Lamps[0].Sz});
            await Clock(2,30);story=await View();
            var door=story.Door!;before=Money();
            Face(door.X+1.2f,door.Z,door.X,door.Z);await Seconds(1);
            Check("E pushes the note under his door",await Press("push a note"),Interact.I.Text);await Seconds(2);
            story=await View();
            Check("the note closes the chapter, the pay waits",story.Status=="done"&&story.OwedC>0&&Money()==before,$"owed {story.OwedC}");
            await Clock(10,0);
            open=await api.Talk(story.Lowie,"open",null);story=await View();
            Check("he pays the note once when next met",open.NpcLine.Contains("note under the door")&&Money()-before==story.PaidC&&story.OwedC==0,open.NpcLine);
            open=await api.Talk(story.Lowie,"open",null);
            Check("and only once",Money()-before==story.PaidC);
            File.WriteAllText(Path.Combine(output,"story-proof.json"),new JsonObject{["checks"]=checks}.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"STORY_PROOF_DONE: {checks.Count} checks");
            game.GetTree().Quit();
        }
        catch(Exception error)
        {
            File.WriteAllText(Path.Combine(output,"story-proof.json"),new JsonObject{["checks"]=checks}.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));
            File.WriteAllText(Path.Combine(output,"failure.txt"),error.ToString());GD.PrintErr(error);game.GetTree().Quit(1);
        }
    }
}
