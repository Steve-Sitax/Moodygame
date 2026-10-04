using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Town;
using Scheldemist.Windows;
using Scheldemist.World;
namespace Scheldemist.Play;

/// <summary>Browser deeds.ts and lantern.ts: geometry reports only; every verdict and sum comes from Node.</summary>
[GamePart(350)]
public partial class Deeds : Node
{
    public static Deeds I { get; private set; } = null!;
    private Api? Api => ServerLink.I?.Api;
    private Townspeople? town;
    private readonly List<Interact.Entry> entries = new();
    private readonly Dictionary<string, Node3D> lamps = new();
    private readonly Dictionary<string, Action<Vector3, float>> lampLight = new();
    private Node3D? hand;
    private bool owned, held, busy, polling, leaving, heldTick, disposed;
    public bool Lit => owned && held && Goods.I?.Carried == null;
    public bool Held => held;
    public PoliceView? Police { get; private set; }
    public DeedsWorld? World { get; private set; }
    public string LastError { get; private set; } = "";
    public event Action<object, object>? Answered;
    private double pollT, moveT, recogT;
    private float clock;
    private int verdict, seen = -1;
    private Window cell = null!;
    private CellNight? night;
    private Func<WhereReport>? priorWhere;
    // Actor code can take over police walks; return true only when it owns this visit.
    public Func<string, string, bool>? PoliceCome;
    public Action? ThingsReturned;
    private sealed class Pursuer
    {
        public string Id = "", Name = "", Kind = "";
        public int? Deed;
        public Townspeople.Sim Sim = null!;
        public double Left = 30;
        public bool Called, Opened;
        public double Far = 22;
    }
    private readonly Dictionary<string, Pursuer> pursuers = new();
    private readonly List<string> released = new();
    private readonly List<(int deed, string id, ulong at)> discoveries = new();
    private readonly List<(int deed, string id, ulong until)> suspects = new();
    private readonly Dictionary<string, ulong> recognised = new();
    private readonly Dictionary<string, (double close, double left)> thieves = new();
    private readonly Dictionary<string, ulong> robbed = new();
    private sealed class TargetActions { public Act Pick = null!; public Act Catch = null!; }
    private readonly Dictionary<string, TargetActions> targetActions = new();
    private readonly Offers offered = new() { Extra = new(), Options = new() };
    private string? walkedAgent;
    private Vector2 walkedFrom;
    private double walkedLeft;
    public Deeds() => I = this;
    public override void _Ready()
    {
        town = Main.I.GetNodeOrNull<Townspeople>("Townspeople");
        cell = new Window("police cell", WriteCell, CellKey) { EscCloses = true };
        hand = Carried.Lantern(); hand.Visible = false; hand.Scale = Vector3.One * 0.8f;
        hand.Position = new Vector3(0.28f, -0.17f, -0.5f);
        hand.GetNode<Node3D>("halo").Visible = false;
        Jef.I.Cam.AddChild(hand);
        GameState.I.PocketsChanged += PocketChanged;
        PocketChanged();
        priorWhere = GameState.I.Where;
        GameState.I.Where = () => new WhereReport(priorWhere?.Invoke().At, Lit);
        if (Talk.I is { } talk) { talk.OnClose += TalkClosed; talk.OnReply += TalkReplied; }
        Interact.I.AddProvider(Keys);
        ServerLink.I?.WhenUp(() => { _ = Load(); _ = Poll(); });
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset;
    }
    private void PocketChanged()
    {
        bool now = GameState.I.Pockets.Any(p => p.Kind == "lantern");
        if (now && !owned) held = true;
        owned = now; if (!owned) held = false;
    }
    private void Reset(string how, ClientState? state)
    {
        foreach (string id in pursuers.Keys) town?.ReleasePlayerPerson(id, this);
        foreach (string id in thieves.Keys) town?.ReleasePlayerPerson(id, this);
        pursuers.Clear(); discoveries.Clear(); suspects.Clear(); robbed.Clear(); thieves.Clear(); recognised.Clear(); targetActions.Clear();
        walkedAgent = null; verdict = 0; seen = -1; night = null; cell.Close(); Police = null; heldTick = false;
        held = false; owned = false; PocketChanged(); _ = Load(); _ = Poll();
    }
    public async Task Load()
    {
        if (Api == null) return;
        try
        {
            var w = await Api.DeedsWorld(); if (disposed) return;
            World = w;
            foreach (var e in entries) e.Dispose(); entries.Clear();
            foreach (var n in lamps.Values) n.Visible = false;
            foreach (var l in w.Lamps)
            {
                if (!lamps.TryGetValue(l.Id, out var node))
                {
                    node = Carried.Lantern(); Main.I.View.AddChild(node); lamps[l.Id] = node;
                    lampLight[l.Id] = Lights.I.AddMoving(l.Id, Render.Psx.Hex(0xffa048), 0.9f);
                }
                node.Position = new Vector3(l.X, l.Y != 0 ? l.Y : (float)(town?.Walk?.BaseAt(l.X, l.Z) ?? 0), l.Z);
                node.Visible = true;
                entries.Add(Interact.I.Add(node.Position + Vector3.Up * 0.2f, l.Y > 0.5 ? 2.2f : 1.8f, "take the lantern", () => _ = Take(l.Id)));
            }
            foreach (var f in w.Food)
                entries.Add(Interact.I.Add(new Vector3(f.X, (float)(town?.Walk?.BaseAt(f.X, f.Z) ?? 0) + 0.9f, f.Z), 2.3f,
                    () => Folk.Present(f.Keeper) ? "take " + f.Name : null, () => _ = Take(f.Id), Key.G));
        }
        catch (ApiException e) { LastError = e.Message; }
    }
    public void Toggle()
    {
        if (!owned) { GameState.I.Say("You have no lantern. A chandler sells them; people who work at night leave theirs about."); return; }
        held = !held; GameState.I.Say(held ? "You hold up the lantern." : "You put the lantern away.");
    }
    public override void _UnhandledInput(InputEvent e)
    {
        if (e is InputEventKey { Pressed: true, Echo: false } && !Interact.I.IsShut && Scheldemist.Menu.Keys.Is(e, "lantern")) { Toggle(); GetViewport().SetInputAsHandled(); }
    }
    private Offers? Keys(float x, float z) => KeysAt(x, z, Scheldemist.Dev.SpeedComparison.Cached);
    private Offers? KeysAt(float x, float z, bool cached)
    {
        if (busy || town?.Crowd == null) return null;
        var options = offered.Options!; var extra = offered.Extra!;
        options.Clear(); extra.Clear();
        if (cached)
            foreach (var s in town.Simulations) AddTarget(s, x, z, true);
        else
            foreach (var s in town.Sims) AddTarget(s, x, z, false);
        return offered;
    }
    private void AddTarget(Townspeople.Sim s, float x, float z, bool cached)
    {
        var options = offered.Options!; var extra = offered.Extra!;
        if (s.P == null || s.Inside) return;
        var at = new Vector3((float)s.P.X, cached ? 0 : s.P.Group.GlobalPosition.Y + 1.1f, (float)s.P.Z);
        float d = new Vector2(at.X - x, at.Z - z).Length();
        if (d >= 3.2f) return;
        if (cached) at.Y = s.P.Group.GlobalPosition.Y + 1.1f;
        if (!targetActions.TryGetValue(s.R.Id, out var actions))
        {
            string id = s.R.Id;
            actions = new TargetActions
            {
                Pick = Act.At(Key.G, "pick " + s.R.First + "'s pocket", at, () => _ = Pick(id)),
                Catch = Act.At(Key.E, "catch " + s.R.First, at, () => _ = Catch(id), 65)
            };
            targetActions.Add(id, actions);
        }
        actions.Pick.X = actions.Catch.X = at.X; actions.Pick.Y = actions.Catch.Y = at.Y; actions.Pick.Z = actions.Catch.Z = at.Z;
        if (robbed.TryGetValue(s.R.Id, out var when) && GameState.PlayNow - when < 25000 && d < 3.2)
            options.Add((d - 20, actions.Catch));
        if (d >= 1.8 || Jef.I.Hurrying || pursuers.ContainsKey(s.R.Id) || Facing(s, x, z) >= -0.25) return;
        extra.Add(actions.Pick);
    }
    private readonly record struct KeyState(int Kind, float Distance, Key Key, string Text, float X, float? Y, float Z, bool Self, float? Cone, Action Run);
    private static KeyState[] KeyStates(Offers? value)
    {
        var states = new List<KeyState>();
        if (value?.Options != null) foreach (var (distance, a) in value.Options)
            states.Add(new(0, distance, a.Key, a.Text, a.X, a.Y, a.Z, a.Self, a.Cone, a.Run));
        if (value?.Extra != null) foreach (var a in value.Extra)
            states.Add(new(1, 0, a.Key, a.Text, a.X, a.Y, a.Z, a.Self, a.Cone, a.Run));
        return states.ToArray();
    }
    /// <summary>Check original boxed enumeration/heights against the exact borrowed prompt path.</summary>
    public bool SameKeys(float x, float z)
    {
        var original = KeyStates(KeysAt(x, z, false));
        var cached = KeyStates(KeysAt(x, z, true));
        return original.SequenceEqual(cached);
    }
    public static double Facing(Townspeople.Sim s, double x, double z)
    {
        double sx = s.P?.X ?? s.X, sz = s.P?.Z ?? s.Z, d = Math.Sqrt((sx-x)*(sx-x)+(sz-z)*(sz-z));
        double yaw = s.P?.Yaw ?? s.Face ?? 0;
        return d > 0.05 ? (Math.Sin(yaw)*(x-sx)+Math.Cos(yaw)*(z-sz))/d : 1;
    }
    public bool Los(double ax, double az, double bx, double bz)
    {
        // Static walls: a ray across chest height ignores the ground and carried/player bodies.
        var query = PhysicsRayQueryParameters3D.Create(new Vector3((float)ax, 1.2f, (float)az), new Vector3((float)bx, 1.2f, (float)bz), 1);
        query.Exclude = new Godot.Collections.Array<Rid> { Jef.I.Body.GetRid() };
        return Jef.I.Body.GetWorld3D().DirectSpaceState.IntersectRay(query).Count == 0;
    }
    public List<Witness> Witnesses(double x, double z, string except = "")
    {
        var list = new List<Witness>();
        if (town != null) foreach (var s in town.Sims)
        {
            if (s.P == null || s.Inside || s.R.Id == except) continue;
            double d = Math.Sqrt((s.P.X-x)*(s.P.X-x)+(s.P.Z-z)*(s.P.Z-z));
            if (d < 45) list.Add(new Witness(s.R.Id, d, Los(s.P.X,s.P.Z,x,z), Facing(s,x,z)));
        }
        foreach (string id in new[] { "sooi", "peeters", "tuur", "fientje" })
            if (Folk.At(id) is { } p) { double d = new Vector2(p.X-(float)x,p.Z-(float)z).Length(); if (d < 45) list.Add(new Witness(id,d,Los(p.X,p.Z,x,z),d<6 ? 1 : 0.3)); }
        list.Sort((a,b) => a.D.CompareTo(b.D)); if (list.Count > 16) list.RemoveRange(16,list.Count-16); return list;
    }
    public async Task Take(string reference)
    {
        if (busy || Api == null) return; busy = true;
        try { var ask = new DeedAsk(reference,Jef.I.X,Jef.I.Z,Witnesses(Jef.I.X,Jef.I.Z),Jef.I.Crouching,Lit); var r = await Api.TakeDeed(ask); Answered?.Invoke(ask,r); Apply(r); await Load(); }
        catch (ApiException e) { Fail(e); } finally { busy = false; }
    }
    public async Task Pick(string id)
    {
        if (busy || Api == null || town == null || Jef.I.Hurrying) return;
        var s = town.Sims.FirstOrDefault(s => s.R.Id == id); if (s?.P == null || Facing(s,Jef.I.X,Jef.I.Z) >= -0.25) return;
        busy = true;
        try
        {
            double d = Math.Sqrt((s.P.X-Jef.I.X)*(s.P.X-Jef.I.X)+(s.P.Z-Jef.I.Z)*(s.P.Z-Jef.I.Z));
            int crowd = 0; foreach (var p in town.Sims) if (p.P != null && !p.Inside && Math.Abs(p.P.X-s.P.X)<5 && Math.Abs(p.P.Z-s.P.Z)<5 && new Vector2((float)(p.P.X-s.P.X),(float)(p.P.Z-s.P.Z)).Length()<5) crowd++;
            var ask = new PickAsk(id,Jef.I.X,Jef.I.Z,d,Facing(s,Jef.I.X,Jef.I.Z),Witnesses(Jef.I.X,Jef.I.Z,id),Jef.I.Crouching,Lit,false,Math.Max(0,crowd-1),false);
            var r = await Api.PickPocket(ask); Answered?.Invoke(ask,r); Apply(r);
            if (r.DiscoverS is > 0 && r.Deed is { } deed) discoveries.Add((deed,id,GameState.PlayNow+(ulong)(r.DiscoverS.Value*1000)));
        }
        catch (ApiException e) { Fail(e); } finally { busy = false; }
    }
    private void Fail(ApiException e) { LastError = e.Message; GameState.I.Say(e.Message); }
    private void Apply(DeedReply r)
    {
        if (disposed) return;
        if (r.Player.Day > 0) GameState.I.Apply(r);
        if (r.Text != "") GameState.I.Say(r.Text);
        if (r.Reactions.Count > 0) foreach (var rc in r.Reactions) React(rc,r.Deed);
        else if (r.Reaction != null) React(r.Reaction,r.Deed);
        foreach (var s in r.Suspects) suspects.Add((r.Deed ?? 0,s.Id,GameState.PlayNow+18000));
    }
    private void React(DeedReaction rc, int? deed)
    {
        if (rc.Line != "") GameState.I.Say(rc.Line);
        if (rc.Kind is "police" or "shout") return;
        Start(rc.Who,rc.Name,rc.Kind,deed);
    }
    private Pursuer? Start(string id,string name,string kind,int? deed = null)
    {
        if (pursuers.TryGetValue(id,out var old)) return old;
        var s = town?.ClaimPlayerPerson(id,this,Jef.I.X+25,Jef.I.Z+10); if (s?.P == null) return null;
        var pu = new Pursuer { Id=id,Name=name,Kind=kind,Deed=deed,Sim=s,Left=kind=="police" ? 600 : kind=="chase" ? 12 : 30 };
        pursuers[id]=pu; return pu;
    }
    private void Release(string id) { town?.ReleasePlayerPerson(id,this); pursuers.Remove(id); }
    public async Task Poll()
    {
        if (polling || Api == null || disposed) return; polling=true;
        try
        {
            var v = await Api.Police(); if (disposed) return; Police=v;
            if (!v.Held) heldTick = false;
            if (v.Last != null && v.Last.Visit != verdict)
            {
                bool first=verdict==0; verdict=v.Last.Visit;
                if (!first) { GameState.I.Say(v.Last.Text); _ = Load(); ThingsReturned?.Invoke(); }
            }
            foreach(var n in v.Seen) if (seen>=0 && n.N>seen) GameState.I.Say(n.Text);
            foreach(var n in v.Seen) seen=Math.Max(seen,n.N); seen=Math.Max(0,seen);
            if (v.Cell && !cell.IsOpen && !Talk.I!.IsOpen) await ShowCell();
            else if (v.Held && !heldTick && !cell.IsOpen) _ = TickHeldCell();
            foreach(var c in v.Confronts) Start(c.Npc,Folk.NameOf(c.Npc,c.Npc),"confront",c.Deed);
            if (v.Visit is { } visit && walkedAgent==null && !pursuers.ContainsKey(visit.Agent) && !cell.IsOpen && !v.Held)
            {
                if (PoliceCome?.Invoke(visit.Agent,visit.Name)!=true) Start(visit.Agent,visit.Name,"police");
            }
        }
        catch(ApiException e) { LastError=e.Message; } finally { polling=false; }
    }
    private async Task TickHeldCell()
    {
        if (Api == null || heldTick) return; heldTick = true;
        try
        {
            var player = Jef.I;
            GameState.I.Apply(await Api.Tick(GameState.I.Where(), true, new Pos3(player.X,player.Z,player.Y)));
        }
        catch (ApiException e) { LastError = e.Message; heldTick = false; }
    }
    public async Task PoliceAtJef(string agent,string name)
    {
        var pu=Start(agent,name,"police"); if (pu!=null) await Arrive(pu);
    }
    public async Task PoliceRanFrom(string agent)
    {
        if(Api==null) return;
        try { var r=await Api.PoliceFled(); Answered?.Invoke(new { fled=agent },r); await Poll(); }
        catch(ApiException e) { Fail(e); }
    }
    private async Task Arrive(Pursuer pu)
    {
        if(pu.Opened || Api==null) return; pu.Opened=true;
        try { var v=await Api.PoliceArrived(pu.Id); Answered?.Invoke(new { arrived=pu.Id },v); if(disposed) return; Police=v; Talk.I!.Open(pu.Id,pu.Name,"police agent"); }
        catch(ApiException e) { pu.Opened=false; Fail(e); }
    }
    private void TalkReplied(string id,TalkLine r) { if(r.End==true) { walkedAgent=null; _=Poll(); } }
    private void TalkClosed(string id) { _=AfterTalk(id); }
    private async Task AfterTalk(string id)
    {
        if(Api==null || !pursuers.TryGetValue(id,out var pu)) return;
        try
        {
            if(pu.Kind=="confront") { var r=await Api.Post<DeedReply>("api/confront/leave",new { id }); Apply(r); Release(id); return; }
            if(pu.Kind!="police") return;
            var v=await Api.Police(); Police=v;
            if(v.Visit?.Agent==id) { walkedAgent=id; walkedFrom=new Vector2(Jef.I.X,Jef.I.Z); walkedLeft=20; pu.Opened=false; }
            else { Release(id); if(v.Cell) await ShowCell(); }
        }
        catch(ApiException e) { Fail(e); }
    }
    public async Task Seize()
    {
        if(busy || Api==null) return; busy=true; walkedAgent=null;
        try { var r=await Api.PoliceSeize(); Answered?.Invoke(new { seize=true },r); GameState.I.Apply(r); GameState.I.Say(r.Text); foreach(string id in pursuers.Keys) town?.ReleasePlayerPerson(id,this); pursuers.Clear(); if(r.Cell) await ShowCell(); else await Poll(); }
        catch(ApiException e) { Fail(e); } finally { busy=false; }
    }
    public async Task ShowCell()
    {
        if(Api==null || cell.IsOpen) return;
        try { var r=await Api.PoliceCell(); if(disposed) return; Answered?.Invoke(new { cell=true },r); GameState.I.Apply(r); night=r.Night; GameState.I.Hold=true; cell.Open(); }
        catch(ApiException e) { Fail(e); }
    }
    private Sheet? WriteCell()
    {
        if(night==null) return null;
        var s=Paper("Night",night.Post.Label);
        foreach(string line in night.Summary) s.Text(Css.Esc(line),Face.Print,16,bottom:10);
        s.Keys("E or Esc  out into the morning"); return s;
    }
    public static Sheet Paper(string title,string sub="")
    {
        float ui=Dialogs.I!.Ui; var s=new Sheet(ui,Math.Min(620*ui,Main.I.GetViewport().GetVisibleRect().Size.X*0.86f),Css.Hex("d8cfb8"),(30,24,30,22),-0.8f,maxHeight:Main.I.GetViewport().GetVisibleRect().Size.Y*0.88f) { Where=Window.Middle };
        s.Text(Css.Esc(title),Face.Print,26,bottom:12); if(sub!="") s.Text(Css.Esc(sub),Face.Print,15,0.75f,bottom:12); return s;
    }
    private void CellKey(string code,string key) { if(code is "KeyE" or "Escape" or "Enter") _=LeaveCell(); }
    public async Task LeaveCell()
    {
        if(leaving || night==null || Api==null) return; leaving=true;
        try { await Api.PoliceCellDone(); if(disposed) return; var p=night.Post; night=null; cell.Close(); GameState.I.Hold=false; Jef.I.Place(p.X,p.Z,p.Yaw); GameState.I.Say("The prison gate shuts behind you. The Begijnenstraat is grey and cold."); await Load(); }
        catch(ApiException e) { Fail(e); } finally { leaving=false; }
    }
    public override void _Process(double delta)
    {
        if(disposed || Jef.I==null) return; clock+=(float)delta;
        if(hand!=null) { hand.Visible=Lit; hand.Position=new Vector3(0.28f,-0.17f+MathF.Sin(clock*3)*0.008f,-0.5f); }
        if(Lights.I!=null) Lights.I.Lantern=Lit && hand!=null ? new Vector4(hand.GlobalPosition.X,hand.GlobalPosition.Y,hand.GlobalPosition.Z,0.9f+MathF.Sin(clock*7.3f)*0.05f+MathF.Sin(clock*17.9f)*0.04f) : null;
        foreach(var pair in lamps) { var n=pair.Value; lampLight[pair.Key](n.GlobalPosition, n.Visible && (GameState.I.HourF>=19 || GameState.I.HourF<6.5) ? 1 : 0); }
        if(!GameState.I.Live || GameState.I.Paused) return;
        if((pollT-=delta)<=0) { pollT=2; _=Poll(); }
        if((moveT-=delta)<=0) { moveT=0.4; Pursue(0.4); Watch(); ThiefStep(0.4); }
        for(int i=discoveries.Count-1;i>=0;i--) if(GameState.PlayNow>=discoveries[i].at) { var q=discoveries[i]; discoveries.RemoveAt(i); _=Discover(q.deed,q.id); }
        if(walkedAgent!=null && !Talk.I!.IsOpen) { if(new Vector2(Jef.I.X,Jef.I.Z).DistanceTo(walkedFrom)>8) _=Seize(); else if((walkedLeft-=delta)<=0) walkedAgent=null; }
    }
    private void Pursue(double dt)
    {
        released.Clear();
        foreach(var pu in pursuers.Values)
        {
            if (!ReferenceEquals(pu.Sim.ActionOwner,this)) { released.Add(pu.Id); continue; }
            var p=pu.Sim.P; if(p==null) { released.Add(pu.Id); continue; }
            double dx=Jef.I.X-p.X,dz=Jef.I.Z-p.Z,d=Math.Sqrt(dx*dx+dz*dz); pu.Left-=dt;
            if(pu.Kind=="police")
            {
                if(!pu.Called && (d<6 || d<16 && Los(p.X,p.Z,Jef.I.X,Jef.I.Z))) { pu.Called=true; pu.Far=d+6; GameState.I.Say(pu.Name+": You there! Police. Stay where you are, I want a word."); }
                if(pu.Called && d>pu.Far) { _=Seize(); break; }
                if(d<2.4 && !Dialogs.I!.Any && !busy) { _=Arrive(pu); continue; }
            }
            else if(pu.Kind=="confront" && !pu.Opened && d<3.2 && !Dialogs.I!.Any) { pu.Opened=true; Talk.I!.Open(pu.Id,pu.Name,"who saw you"); continue; }
            else if(pu.Kind=="chase" && d<1.7 && pu.Deed is { } deed) { released.Add(pu.Id); _=ReturnCaught(deed); continue; }
            if(pu.Left<=0 || pu.Kind!="police" && d>35) { released.Add(pu.Id); continue; }
            if(Talk.I?.With==pu.Id || walkedAgent==pu.Id) { town!.Crowd!.PuppetStand(p,"talk",Math.Atan2(dx,dz)); continue; }
            if(pu.Kind=="fetch") { var post=Police?.Post; if(post!=null) town!.Crowd!.PuppetGo(p,post.X,post.Z,2.9); }
            else town!.Crowd!.PuppetGo(p,Jef.I.X-dx/Math.Max(d,1)*1.3,Jef.I.Z-dz/Math.Max(d,1)*1.3,pu.Kind=="chase" ? 2.7 : 1.9);
        }
        foreach(string id in released) Release(id);
    }
    private async Task ReturnCaught(int deed) { if(Api==null) return; try { Apply(await Api.ReturnDeed(deed,"caught")); await Load(); ThingsReturned?.Invoke(); } catch(ApiException e) { Fail(e); } }
    private async Task Discover(int deed,string id)
    {
        if(Api==null) return; var p=Folk.At(id); double d=p is { } at ? new Vector2(at.X-Jef.I.X,at.Z-Jef.I.Z).Length() : 99;
        var ask=new DiscoverAsk(d,p is { } q && Los(q.X,q.Z,Jef.I.X,Jef.I.Z),Jef.I.X,Jef.I.Z);
        try { var r=await Api.DiscoverPocket(deed,ask); Answered?.Invoke(ask,r); if(r.Hit) Apply(r); else if(d<20 && r.Text!="") GameState.I.Say(r.Text); } catch(ApiException e) { LastError=e.Message; }
    }
    private void Watch()
    {
        for(int i=suspects.Count-1;i>=0;i--) { var s=suspects[i]; if(GameState.PlayNow>s.until) { suspects.RemoveAt(i); continue; } if(Jef.I.Hurrying && Folk.At(s.id) is { } at && new Vector2(at.X-Jef.I.X,at.Z-Jef.I.Z).Length()<25 && Los(at.X,at.Z,Jef.I.X,Jef.I.Z)) { suspects.RemoveAt(i); _=Notice(s.deed,s.id); } }
        if((recogT-=0.4)>0) return; recogT=2;
        if(Police!=null && !Dialogs.I!.Any) foreach(string id in Police.Watchers) if(Folk.At(id) is { } at && new Vector2(at.X-Jef.I.X,at.Z-Jef.I.Z).Length()<8 && !pursuers.ContainsKey(id) && (!recognised.TryGetValue(id,out var last) || GameState.PlayNow-last>90000)) { recognised[id]=GameState.PlayNow; _=Recognise(id,at); }
    }
    private async Task Notice(int deed,string id) { if(Api==null) return; try { Apply(await Api.Post<DeedReply>($"api/deed/{deed}/noticed",new { who=id })); } catch(ApiException e) { LastError=e.Message; } }
    private async Task Recognise(string id,Vector3 at) { if(Api==null) return; try { Apply(await Api.Post<DeedReply>("api/deed/recognise",new { id=id,facing=Facing(town!.Sims.First(s => s.R.Id==id),Jef.I.X,Jef.I.Z),d=new Vector2(at.X-Jef.I.X,at.Z-Jef.I.Z).Length(),los=Los(at.X,at.Z,Jef.I.X,Jef.I.Z),x=Jef.I.X,z=Jef.I.Z,lantern=Lit })); } catch(ApiException e) { LastError=e.Message; } }
    public async Task Catch(string id) { if(busy || Api==null) return; busy=true; try { var r=await Api.CatchPocketThief(id); Answered?.Invoke(new { catchThief=id },r); Apply(r); robbed.Remove(id); town?.ReleasePlayerPerson(id,this); } catch(ApiException e) { Fail(e); } finally { busy=false; } }
    public override void _ExitTree()
    {
        disposed=true; cell.Close(); foreach(var e in entries) e.Dispose();
        GameState.I.PocketsChanged-=PocketChanged;
        if(Talk.I is { } t) { t.OnClose-=TalkClosed; t.OnReply-=TalkReplied; }
        if(Scheldemist.Menu.MainMenu.I is { } m) m.WorldReplaced-=Reset;
        foreach(string id in pursuers.Keys) town?.ReleasePlayerPerson(id,this);
        foreach(string id in thieves.Keys) town?.ReleasePlayerPerson(id,this);
        if(hand!=null && GodotObject.IsInstanceValid(hand)) hand.QueueFree();
        if(Lights.I!=null) Lights.I.Lantern=null;
    }
}
