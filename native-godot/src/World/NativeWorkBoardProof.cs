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
using Scheldemist.Windows;
using Dialogs = Scheldemist.Ui.Dialogs;
namespace Scheldemist.Native.World;

/// <summary>
/// The hiring board worked with the mouse in the real town (issue 152), AI off, in a disposable save: E opens it, the
/// mouse over a job's words lights that job, the wheel over a job scrolls the list and a new state from the server
/// keeps the place, Esc closes it, a click on a job takes it, and after the window was left (the quiet pause) one
/// click on a job goes on and takes it. The mouse events go in as the window's own. Pictures go to the proof folder.
/// </summary>
public static class NativeWorkBoardProof
{
    public static async Task Run(NativeTownGame game,string output)
    {
        Directory.CreateDirectory(output);
        var checks=new JsonArray();
        async Task Frames(int count){for(int i=0;i<count;i++)await game.ToSignal(game.GetTree(),SceneTree.SignalName.ProcessFrame);}
        async Task Seconds(double s){var until=DateTime.UtcNow.AddSeconds(s);while(DateTime.UtcNow<until)await Frames(1);}
        async Task Shot(string name){await Frames(2);await game.ToSignal(RenderingServer.Singleton,RenderingServer.SignalName.FramePostDraw);game.GetViewport().GetTexture().GetImage().SavePng(Path.Combine(output,name+".png"));}
        void Check(string what,bool ok,string detail=""){checks.Add(new JsonObject{["check"]=what,["ok"]=ok,["detail"]=detail});GD.Print((ok?"BOARD_PASS: ":"BOARD_FAIL: ")+what+(detail==""?"":" ("+detail+")"));if(!ok)throw new Exception(what+(detail==""?"":": "+detail));}
        try
        {
            if(!Path.GetFullPath(Paths.Database).StartsWith(Path.GetFullPath(output)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)||!game.Flag("no-ai"))throw new Exception("Work board proof requires its own database and --no-ai.");
            var deadline=DateTime.UtcNow.AddSeconds(600);
            while(!game.Loaded||Loading.Busy||ServerLink.I?.Up!=true||!GameState.I.Live||game.GetNodeOrNull<Townspeople>("Townspeople")?.Sims.Count is not >500)
            {if(DateTime.UtcNow>deadline)throw new TimeoutException("Native town not ready");await Frames(1);}
            MainMenu.I!.Start();Jef.I.TestInput=true;Pause.Clear();Dialogs.CloseAll();var api=ServerLink.I!.Api!;
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set",new{day=1,hour=13,minute=0,weather="clear"}));await Frames(10);
            var vp=game.GetViewport();
            // a point on the paper, as the window's own mouse would have it
            Vector2 Screen(Vector2 canvas)=>vp.GetScreenTransform()*canvas;
            async Task Move(Vector2 at){var p=Screen(at);Input.ParseInputEvent(new InputEventMouseMotion{Position=p,GlobalPosition=p,Relative=new Vector2(2,1)});await Frames(3);}
            async Task Button(Vector2 at,MouseButton b){var p=Screen(at);foreach(bool down in new[]{true,false}){Input.ParseInputEvent(new InputEventMouseButton{Position=p,GlobalPosition=p,ButtonIndex=b,Pressed=down,ButtonMask=down?(MouseButtonMask)(1<<((int)b-1)):0});await Frames(1);}await Frames(2);}
            void Tap(Key key){foreach(bool down in new[]{true,false})Input.ParseInputEvent(new InputEventKey{Keycode=key,PhysicalKeycode=key,Pressed=down});}
            List<InkClick> Jobs_(){var list=new List<InkClick>();var card=Jobs.I.BoardPaper?.Card;if(card==null)return list;var todo=new Stack<Node>(new Node[]{card});while(todo.Count>0){var n=todo.Pop();if(n is InkClick c&&c.Code.StartsWith("Digit",StringComparison.Ordinal))list.Add(c);foreach(var k in n.GetChildren())todo.Push(k);}return list.OrderBy(c=>c.Code).ToList();}
            Control? Words(InkClick row){var todo=new Stack<Node>(new Node[]{row});RichTextLabel? last=null;while(todo.Count>0){var n=todo.Pop();if(n is RichTextLabel l)last=last==null||l.GetGlobalRect().Position.Y>last.GetGlobalRect().Position.Y?l:last;foreach(var k in n.GetChildren())todo.Push(k);}return last;}
            bool Over(InkClick row){var h=vp.GuiGetHoveredControl();return h!=null&&(h==row||row.IsAncestorOf(h));}
            string Hovered(){var h=vp.GuiGetHoveredControl();return h==null?"nothing":h.GetPath().ToString().Split('/').TakeLast(3).Aggregate((a,b)=>a+"/"+b);}
            Vector2 Middle(Control c){var r=c.GetGlobalRect();return r.Position+r.Size/2;}
            async Task OpenBoard(string why)
            {
                var (bx,bz)=Spots.Board;
                Jef.I.Place(bx+1.6f,bz,MathF.Atan2(1.6f,0),-.15f);
                bool pressed=false;for(int i=0;i<30&&!pressed;i++){Interact.I.RepeatPrompt();if(Interact.I.Text.Contains("hiring board",StringComparison.OrdinalIgnoreCase))pressed=Interact.I.Press(Key.E);else await Frames(2);}
                await Frames(8);
                Check($"E opens the board ({why})",pressed&&Jobs.I.BoardOpen&&Jobs_().Count>0,$"prompt '{Interact.I.Text}', rows {Jobs_().Count}");
            }
            int Taken()=>GameState.I.Jobs.Count(j=>j.Status=="taken");

            await OpenBoard("first");
            await Shot("01-board");
            var rows=Jobs_();var first=rows[0];
            var words=Words(first);
            Check("a whole job is one line to click",words!=null&&first.IsAncestorOf(words)&&first.GetGlobalRect().Size.Y>words!.GetGlobalRect().Size.Y,$"{rows.Count} jobs, first {first.GetGlobalRect().Size}");
            string Written(Node root)=>string.Join(" ",root.FindChildren("*","",true,false).Select(n=>n is Label l?l.Text:n is RichTextLabel r?r.Text:"").Where(t=>t!=""));
            Check("the footer says the mouse works",Written(Jobs.I.BoardPaper!.Card).Contains("Click a job"));
            // a good keeps its name everywhere: no job on the board speaks of bales while its goods are sacks (issue 152)
            var mixed=GameState.I.Jobs.Where(j=>JobTask.Of(j)?.Goods is {} g&&g!="bales"&&(j.Title+" "+j.Pitch).Contains("bale",StringComparison.OrdinalIgnoreCase)).Select(j=>j.Title).ToList();
            Check("no job names other goods than it carries",mixed.Count==0,string.Join(", ",mixed));
            int far=Written(Jobs.I.BoardPaper!.Card).Split(" m away").Length-1;
            Check("every open job says how far away it starts",far>0&&far==GameState.I.Jobs.Count(j=>j.Status=="offered"&&Jobs.I.VisibleJobs().Contains(j)),$"{far} jobs with a distance");

            await Move(Middle(words!));
            Check("the mouse over a job's words is over that job",Over(first),Hovered());
            await Shot("02-hover");

            var scroll=Jobs.I.BoardPaper!.Scroll;var bar=scroll?.GetVScrollBar();
            bool tall=bar!=null&&bar.MaxValue-bar.Page>4;
            Check("the board has its scroll",scroll!=null,tall?$"max {bar!.MaxValue}, page {bar.Page}":"the list fits the paper");
            if(tall)
            {
                for(int i=0;i<4;i++)await Button(Middle(words!),MouseButton.WheelDown);
                await Frames(4);
                int down=scroll!.ScrollVertical;
                Check("the wheel over a job scrolls the list",down>0,$"scroll {down}");
                var card=Jobs.I.BoardPaper!.Card;
                GameState.I.Apply(await api.Jobs());await Frames(4);
                Check("a new state from the server keeps the list where it was",Jobs.I.BoardPaper?.Card==card&&scroll.ScrollVertical==down,$"scroll {Jobs.I.BoardPaper?.Scroll?.ScrollVertical}");
                await Shot("03-scrolled");
                for(int i=0;i<8;i++)await Button(Middle(Jobs.I.BoardPaper!.Card),MouseButton.WheelUp);
                await Frames(4);
                Check("the wheel scrolls back up",scroll.ScrollVertical==0,$"scroll {scroll.ScrollVertical}");
            }

            Tap(Key.Escape);await Frames(6);
            Check("Esc closes the board",!Jobs.I.BoardOpen&&!(Scheldemist.Windows.Dialogs.I?.Any??true));

            await OpenBoard("click");
            int before=Taken();rows=Jobs_();
            await Move(Middle(Words(rows[0])!));
            await Button(Middle(Words(rows[0])!),MouseButton.Left);
            await Seconds(2);GameState.I.Apply(await api.Jobs());await Frames(4);
            Check("a click on a job's words takes it",Taken()==before+1&&!Jobs.I.BoardOpen,$"taken {before} to {Taken()}");
            await Shot("04-taken");

            await OpenBoard("after the window was left");
            MainMenu.I!.Notification((int)Node.NotificationApplicationFocusOut);await Frames(4);
            Check("leaving the window is the quiet pause",Pause.Paused,string.Join(",",Pause.Reasons));
            await Shot("05-quiet-pause");
            before=Taken();rows=Jobs_();
            await Button(Middle(Words(rows[0])!),MouseButton.Left);
            await Seconds(2);GameState.I.Apply(await api.Jobs());await Frames(4);
            Check("one click on a job goes on and takes it",!Pause.Paused&&Taken()==before+1&&!Jobs.I.BoardOpen,$"paused {string.Join(",",Pause.Reasons)}, taken {before} to {Taken()}");

            // The quest book: a click on a job follows it, a click on the story follows the story; the pointer goes with it.
            List<InkClick> Lines(string prefix){var list=new List<InkClick>();var card=Jobs.I.BookPaper?.Card;if(card==null)return list;var todo=new Stack<Node>(new Node[]{card});while(todo.Count>0){var n=todo.Pop();if(n is InkClick c&&c.Code.StartsWith(prefix,StringComparison.Ordinal))list.Add(c);foreach(var k in n.GetChildren())todo.Push(k);}return list.OrderBy(c=>c.Code).ToList();}
            Jobs.I.OpenBook();await Frames(8);
            var inBook=Jobs.I.InHand();var lines=Lines("Digit");var storyLine=Lines("KeyS").FirstOrDefault();
            Check("the book lists both jobs to click, and the story",lines.Count==2&&storyLine!=null&&inBook.Count==2,$"jobs {lines.Count}, story {(storyLine!=null)}");
            var other=inBook.First(j=>j.Id!=Jobs.I.Followed?.Id);
            var was=Jobs.I.PointerAt;
            await Move(Middle(Words(lines[1])!));
            Check("the mouse over the second job is over it",Over(lines[1]),Hovered());
            await Shot("06-book");
            await Button(Middle(Words(lines[1])!),MouseButton.Left);await Frames(6);
            Check("a click on a job in the book follows it",Jobs.I.Followed?.Id==other.Id,$"followed {Jobs.I.Followed?.Title}");
            Check("the pointer goes to that job",Jobs.I.PointerAt is {} at1&&(was==null||at1.DistanceTo(was.Value)>1),$"{was} to {Jobs.I.PointerAt}");
            var jobGoal=Jobs.I.PointerAt;
            storyLine=Lines("KeyS").First();
            await Button(Middle(storyLine),MouseButton.Left);await Frames(6);
            int marks=Written(Jobs.I.BookPaper!.Card).Split("followed[/b]").Length-1;
            Check("a click on the story follows it, and only the story says followed",Jobs.I.StoryFollowed&&Jobs.I.Followed==null&&marks==1,$"{marks} followed marks");
            Check("the pointer goes to the story",Jobs.I.PointerAt is {} at2&&Story.I?.Goal() is {} sg&&at2.DistanceTo(sg.At)<.1f,$"{Jobs.I.PointerAt}, story {Story.I?.Goal()?.Label}");
            await Shot("07-book-story");
            lines=Lines("Digit");var top=Jobs.I.InHand()[0];
            await Button(Middle(Words(lines[0])!),MouseButton.Left);await Frames(6);
            Check("a click on a job takes the pointer back from the story",!Jobs.I.StoryFollowed&&Jobs.I.Followed?.Id==top.Id&&Jobs.I.PointerAt is {} at3&&jobGoal is {} jg&&at3.DistanceTo(jg)<.1f,$"followed {Jobs.I.Followed?.Title}");
            Jobs.I.CloseBook();await Frames(3);

            File.WriteAllText(Path.Combine(output,"work-board-proof.json"),new JsonObject{["checks"]=checks}.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));
            GD.Print($"BOARD_PROOF_DONE: {checks.Count} checks");
            game.GetTree().Quit();
        }
        catch(Exception error)
        {
            File.WriteAllText(Path.Combine(output,"work-board-proof.json"),new JsonObject{["checks"]=checks}.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));
            File.WriteAllText(Path.Combine(output,"failure.txt"),error.ToString());GD.PrintErr(error);game.GetTree().Quit(1);
        }
    }
}
