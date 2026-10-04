using System;
using System.Collections.Generic;
using System.Text.Json;
using System.IO;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>landmarks.ts: real-hall entry, counters and residents; the existing people owner draws them.</summary>
[GamePart(359)]
public partial class LandmarkLife : Node
{
    public static LandmarkLife I { get; private set; } = null!;
    private sealed class Hall
    {
        public string Id = "";
        public JsonElement Plan;
        public Vector3 Origin;
        public float Yaw;
        public LandmarkView? State;
        public string[] GridRows = Array.Empty<string>();
        public Vector3 World(float x, float z, float y = 0) => Origin + new Vector3(x * MathF.Cos(Yaw) + z * MathF.Sin(Yaw), y, -x * MathF.Sin(Yaw) + z * MathF.Cos(Yaw));
        public Vector2 Local(float x, float z) { float dx = x - Origin.X, dz = z - Origin.Z; return new(dx * MathF.Cos(Yaw) - dz * MathF.Sin(Yaw), dx * MathF.Sin(Yaw) + dz * MathF.Cos(Yaw)); }
        public Vector3 Mark(string name) { var m = Plan.GetProperty("marks").GetProperty(name); return World(m.GetProperty("x").GetSingle(), m.GetProperty("z").GetSingle(), m.TryGetProperty("y", out var y) ? y.GetSingle() : 0); }
        public bool Inside() => Contains(new(Jef.I.X,Jef.I.Y,Jef.I.Z));
        public bool Contains(Vector3 point)
        {
            var p = Local(point.X, point.Z); float feet = point.Y - Origin.Y;
            if (Id == "cathedral")
            {
                var grid = Plan.GetProperty("freeGrid"); float step = grid.GetProperty("step").GetSingle(); int x = (int)MathF.Round((p.X - grid.GetProperty("x").GetSingle()) / step), z = (int)MathF.Round((p.Y - grid.GetProperty("z").GetSingle()) / step); var rows = grid.GetProperty("rows");
                if (z < 0 || z >= rows.GetArrayLength() || MathF.Abs(feet) > 3) return false; string row = GridRows[z]; return x >= 0 && x < row.Length && row[x] == '1' && p.Y > 0;
            }
            foreach (var level in Plan.GetProperty("levels").EnumerateArray()) if (MathF.Abs(feet - level.GetProperty("y").GetSingle()) < 0.6f)
                foreach (var r in level.GetProperty("floors").EnumerateArray()) if (p.X >= r.GetProperty("minX").GetSingle() && p.X <= r.GetProperty("maxX").GetSingle() && p.Y >= r.GetProperty("minZ").GetSingle() && p.Y <= r.GetProperty("maxZ").GetSingle()) return true;
            return false;
        }
    }
    private JsonDocument? data;
    private readonly List<Hall> halls = new();
    private readonly List<Interact.Entry> fixedPrompts = new(), peoplePrompts = new();
    private readonly List<(Interact.Entry Entry, string Id)> moving = new();
    private readonly Dictionary<string,Interact.Entry> registeredPeople = new();
    private Hall? here;
    private double poll, locate;
    private bool loading, dead, candleBusy, hearing;
    private Window paper = null!;
    private string heading = "", body = "";
    private SermonView? sermon;
    private Label caption = null!;
    private int sermonLine = -1;
    private double sermonTime;
    private int generation, sermonDay = -1, sermonStage;
    private HallPeople.Figure? preacher;
    private Vector3 sermonFrom;
    private string whisper = "";
    private double whisperTime;
    public bool PreacherInPulpit => preacher != null && sermonStage == 2 && preacher.Group.GlobalPosition.Y > LocalPoint("cathedral",0,0).Y + 2.7f;
    public int HeardLines { get; private set; }
    public SermonReply? SermonResult { get; private set; }
    public Vector3 Point(string id, string mark) => halls.Find(h => h.Id == id)!.Mark(mark);
    public string? Here => here?.Id;
    public string? RoomAt(Vector3 point){foreach(var hall in halls)if(hall.Contains(point))return hall.Id;return null;}
    public bool ConfessionOpen => here?.Id=="cathedral" && here.State?.Confession is {} c && c.ValueKind==JsonValueKind.Object && c.TryGetProperty("open",out var o) && o.GetBoolean();
    public Vector3 LocalPoint(string id,float x,float z)=>halls.Find(h=>h.Id==id)!.World(x,z);
    public readonly List<(string Hall,string Label,Vector3 At,float Floor)> Looks=new();
    public override void _Ready()
    {
        I = this; data = JsonDocument.Parse(HallPeopleData.Json);
        caption = new Label { Visible = false, MouseFilter = Control.MouseFilterEnum.Ignore, AutowrapMode = TextServer.AutowrapMode.WordSmart, Size = new Vector2(740, 120), LabelSettings = new LabelSettings { Font = PaperFonts.Hand, FontSize = 23, FontColor = Css.Ink, OutlineColor = Css.Hex("e3d4ad"), OutlineSize = 5 } }; Main.I.Ui.AddChild(caption);
        paper = new Window("landmark paper", Write, (code, _) => { if (code is "KeyE" or "Escape") paper.Close(); });
        foreach (var p in data.RootElement.GetProperty("rooms").EnumerateArray())
        {
            var o = p.GetProperty("origin"); var hall = new Hall { Id = p.GetProperty("id").GetString()!, Plan = p, Origin = new(o.GetProperty("x").GetSingle(), p.GetProperty("floorY").GetSingle(), o.GetProperty("z").GetSingle()), Yaw = p.GetProperty("yaw").GetSingle() }; halls.Add(hall);
            if (hall.Id == "cathedral")
            {
                var rows = p.GetProperty("freeGrid").GetProperty("rows"); hall.GridRows = new string[rows.GetArrayLength()]; for (int i = 0; i < hall.GridRows.Length; i++) hall.GridRows[i] = rows[i].GetString()!;
                fixedPrompts.Add(Interact.I.Add(hall.Mark("stand") + Vector3.Up * 0.6f, 1.8f, () => here == hall && !candleBusy ? "light a candle (2 c)" : null, () => _ = Candle(), Key.F));
                fixedPrompts.Add(Interact.I.Add(hall.Mark("pulpitFoot") + Vector3.Up, 30, () => here == hall && GameState.I.Day % 7 == 0 && GameState.I.HourF >= 9 && GameState.I.HourF < 11.5 && !hearing ? "listen to the Sunday sermon" : null, () => _ = HearSermon()));
            }
            if (hall.Id == "townhall")
            {
                fixedPrompts.Add(Interact.I.Add(hall.Mark("board") + Vector3.Up, 2, () => here == hall ? "read the notice board" : null, () => Show("The town hall's notices", string.Join("\n\n", hall.State?.Posters.ConvertAll(p => p.Heading + "\n" + p.Body) ?? new()))));
                fixedPrompts.Add(Interact.I.Add(hall.Mark("counter") + Vector3.Up, 2, () => here == hall ? "read the register of the civil state" : null, () => Show("The civil register", string.Join("\n", hall.State?.Register ?? new()))));
            }
        }
        if (Scheldemist.Menu.MainMenu.I is {} menu) menu.WorldReplaced += Reset;
        using var places=JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach(var look in places.RootElement.GetProperty("looks").EnumerateArray())
        {
            string hallId=look.GetProperty("hall").GetString()!,id=look.GetProperty("id").GetString()!;if(id is "board" or "register")continue;
            var h=halls.Find(h=>h.Id==hallId)!;float y=look.GetProperty("y").GetSingle();var at=h.World(look.GetProperty("x").GetSingle(),look.GetProperty("z").GetSingle(),y);string label=look.GetProperty("label").GetString()!,text=look.GetProperty("text").GetString()!;
            Looks.Add((hallId,label,at,at.Y));fixedPrompts.Add(Interact.I.Add(at+Vector3.Up*.9f,look.GetProperty("r").GetSingle(),()=>here==h&&MathF.Abs(Jef.I.Y-at.Y)<2?label:null,()=>Show(label,text)));
        }
    }
    private Sheet? Write() { var sh = new Sheet(Dialogs.I!.Ui, 560, Css.Hex("e3d4ad"), (26, 18, 26, 14), maxHeight: GetViewport().GetVisibleRect().Size.Y * 0.85f) { Where = Window.Middle }; sh.Text("[b]" + Css.Esc(heading) + "[/b]", Face.Print, 24, bottom: 14); sh.Text(Css.Esc(body), Face.Print, 16, lineHeight: 1.45f); sh.Keys("E or Esc to fold it away", Face.Hand); return sh; }
    private void Show(string title, string text) { heading = title; body = text; paper.Open(); }
    public override void _Process(double delta)
    {
        UpdateSermon(delta);
        UpdateIndoor(delta);
        if ((whisperTime -= delta) <= 0) whisper = "";
        if ((locate -= delta) <= 0)
        {
            locate = 0.25; Hall? next = null; foreach (var h in halls) if (h.Inside()) { next = h; break; }
            if (here != next) { here = next; _ = Enter(next?.Id); poll = 0; }
            foreach (var p in moving) if (HallPeople.I?.PositionOf(p.Id) is { } at) p.Entry.Place = at + Vector3.Up * 1.3f;
        }
        if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 12; _ = Load(); }
    }
    private static bool InRoster(Hall hall,string id){if(hall.State!=null)foreach(var person in hall.State.People)if(person.Id==id)return true;return false;}
    private async Task Enter(string? id) { if (ServerLink.I?.Api is not { } api) return; try { await api.LandmarkHere(id); } catch (ApiException) { } }
    public async Task Load()
    {
        if (loading || dead || ServerLink.I?.Api is not { } api) return; loading = true; int g = generation;
        try
        {
            foreach (var h in halls) { var next = await api.LandmarkNow(h.Id); if (dead || g != generation) return; h.State = next; }
            foreach (var h in halls) foreach (var person in h.State!.People)
            {
                string key=h.Id+":"+person.Id;if(registeredPeople.ContainsKey(key))continue;
                var p = Interact.I.Add(Vector3.Zero, 2.4f, () => here == h && InRoster(h,person.Id) && HallPeople.I?.PositionOf(person.Id) != null ? "talk to " + person.Name : null, () => Talk.I!.Open(person.Id, person.Name, person.Title));
                peoplePrompts.Add(p); registeredPeople.Add(key,p); moving.Add((p, person.Id));
            }
        }
        catch (ApiException) { }
        finally { loading = false; }
    }
    public async Task Candle() { if (candleBusy || here?.Id != "cathedral") return; candleBusy = true; try { var r = await ServerLink.I!.Api!.LandmarkCandle(); GameState.I.Apply(r); GameState.I.Say(r.Text); } catch (ApiException e) { GameState.I.Say(e.Message); } finally { candleBusy = false; } }
    private void Reset(string how, ClientState? state)
    {
        generation++; ResetIndoor(); EndSermon(); here = null; poll = locate = 0; sermonDay = -1; SermonResult = null; HeardLines = 0; paper.Close();
        foreach(var h in halls)h.State=null;
        // Keep prompts registered; the new roster controls their availability.
    }
    private HallPeople.Figure? FindPreacher()
    {
        if(HallPeople.I == null)return null;
        foreach(var h in HallPeople.I.Halls)if(h.Id=="cathedral")
        { foreach(var f in h.Figures.Values)if(f.Role=="preacher"&&!f.Leaving)return f; foreach(var f in h.Figures.Values)if(f.Role=="celebrant"&&!f.Leaving)return f; }
        return null;
    }
    public async Task HearSermon()
    {
        if (hearing || here?.Id != "cathedral") return;
        var f=FindPreacher(); if(f==null)return;
        hearing = true; int g=generation;
        try { var s = await ServerLink.I!.Api!.Sermon(); if (!dead && g==generation && here?.Id == "cathedral" && IsInstanceValid(f.Group)) { sermon = s; preacher=f; sermonFrom=f.Group.GlobalPosition; sermonLine=-1; sermonTime=0; sermonStage=1; sermonDay=s.Day; HeardLines=0; SermonResult=null; } else hearing=false; }
        catch (ApiException e) { hearing=false; GameState.I.Say(e.Message); }
    }
    private void HoldPreacher(Vector3 at, float yaw, string motion)
    {
        if(preacher==null || !IsInstanceValid(preacher.Group))return;
        preacher.Path.Clear(); preacher.Moving=false; preacher.Wait=100; preacher.Group.GlobalPosition=at; preacher.Group.GlobalRotation=new(0,yaw,0); preacher.Human.Play(motion);
    }
    private void EndSermon()
    {
        if(preacher!=null && IsInstanceValid(preacher.Group)) { var h=halls.Find(h=>h.Id=="cathedral")!; preacher.Group.GlobalPosition=h.Mark("preacherWait"); preacher.Target=preacher.Group.GlobalPosition; preacher.Wait=1; preacher.Human.Play("idle"); }
        preacher=null; sermon=null; hearing=false; sermonStage=0; caption.Visible=false; whisper="";
    }
    private void UpdateSermon(double dt)
    {
        if(!hearing)
        {
            if(here?.Id=="cathedral" && sermonDay!=GameState.I.Day && here.State?.Service is {} service && service.ValueKind==JsonValueKind.Object && service.TryGetProperty("kind",out var kind) && kind.GetString()=="high" && GameState.I.HourF>=9.12 && FindPreacher()!=null) _ = HearSermon();
            return;
        }
        if(sermon==null)return;
        if(here?.Id!="cathedral") {EndSermon();return;}
        // A refreshed service roster may replace the priest while he climbs.
        // Retry with its live figure instead of treating an interrupted sermon as heard.
        if(preacher==null || !IsInstanceValid(preacher.Group) || preacher.Leaving) {EndSermon();sermonDay=-1;return;}
        var h=here; var pulpit=h.Mark("pulpit"); pulpit.Y=h.Origin.Y; var foot=h.Mark("pulpitFoot");
        float yaw=h.Yaw+h.Plan.GetProperty("marks").GetProperty("pulpit").GetProperty("yaw").GetSingle();
        if(sermonStage==1)
        {
            sermonTime+=dt; float k1=Math.Min(1,(float)sermonTime/2),k2=Math.Clamp(((float)sermonTime-2)/3,0,1);
            var at=k2>0?foot.Lerp(pulpit,k2)+Vector3.Up*(2.8f*k2):sermonFrom.Lerp(foot,k1);
            HoldPreacher(at,k2>0?h.Yaw+MathF.PI*(.5f+(1-k2)*1.5f):MathF.Atan2(foot.X-sermonFrom.X,foot.Z-sermonFrom.Z),"walk");
            if(k2>=1){sermonStage=2;sermonTime=1.2;HoldPreacher(pulpit+Vector3.Up*2.8f,yaw,"idle");}return;
        }
        if(sermonStage==3)
        {
            sermonTime+=dt;float k=Math.Min(1,(float)sermonTime/3);HoldPreacher(pulpit.Lerp(h.Mark("preacherWait"),k)+Vector3.Up*(2.8f*(1-k)),h.Yaw+MathF.PI*(1.5f-k*.5f),"walk");if(k>=1)EndSermon();return;
        }
        HoldPreacher(pulpit+Vector3.Up*2.8f,yaw+(sermonLine%2==0?-.35f:.35f),sermonLine<0?"idle":"talk");
        if((sermonTime-=dt)>0)return;
        if(++sermonLine>=sermon.Lines.Count){sermonStage=3;sermonTime=0;caption.Visible=false;_ = FinishSermon();return;}
        string line=sermon.Lines[sermonLine];sermonTime=Math.Clamp(2.2+line.Length/55.0,3,4.6);caption.Text=line;caption.Visible=true;caption.Position=new((GetViewport().GetVisibleRect().Size.X-caption.Size.X)/2,125);HeardLines++; NodCongregation();
        Scheldemist.Audio.Soundscape.I?.Speech(pulpit.X,pulpit.Z,new("m",55),Math.Min(sermonTime-.4,5));
        if(sermonLine==sermon.Lines.Count/2 && sermon.Gossip is {} gossip){whisper=gossip.Name+", in a whisper: "+gossip.Text;whisperTime=5; WhisperAt(gossip);}
    }
    private async Task FinishSermon() { int g=generation; try { var r = await ServerLink.I!.Api!.SermonHeard(); if (dead || g!=generation || here?.Id != "cathedral") return; SermonResult = r; GameState.I.Apply(r); GameState.I.Say(r.Text); } catch (ApiException e) { if(!dead && g==generation)GameState.I.Say(e.Message); } }
    public override void _ExitTree() { dead = true; EndSermon(); if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset; foreach (var p in fixedPrompts) p.Dispose(); foreach (var p in peoplePrompts) p.Dispose(); paper.Close(); caption.QueueFree(); data?.Dispose(); }
}
