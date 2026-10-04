using System;
using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.People;
using Scheldemist.Talks;
using Scheldemist.Town;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>interiors.ts free seats, the existing people's sit clips, and the dice paper.</summary>
[GamePart(910)]
public partial class TavernSeats : Node
{
    public static TavernSeats I { get; private set; } = null!;
    public sealed class Seat { public Vector3 At, Approach; public float Yaw, Height; public int Table; public InsidePerson? Occupant; public Room Room = null!; }
    public sealed class Room { public string Id = ""; public Vector3 Origin; public float Yaw; public bool Open; public Rect2 Bounds; public readonly List<Seat> Seats = new(); }
    public readonly List<Room> Rooms = new();
    public Seat? Sitting { get; private set; }
    public Func<Act?>? GuestAction { get; set; }
    private readonly Offers seatedOffers = new() { Only = new() };
    private Act standAction = null!, diceAction = null!, talkAction = null!;
    private readonly List<Interact.Entry> prompts = new();
    private static readonly HashSet<string> Standers = new() { "peeters", "fientje", "fishwife_a", "fishwife_b", "maid", "girl", "wife_a", "wife_b", "shopwife", "old_woman", "girl_b", "baker", "shopkeeper", "publican", "docker_sack", "porter", "carter", "sentry" };
    private Townspeople? town;
    private double poll, pose;
    private bool loading, dead, diceBusy;
    private int generation;
    private Vector3 returnAt;
    private float yaw, pitch;
    private InsidePerson? mate;
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        ProcessPriority = 20; // after Jef (rides run his step at 10), before lighting and mirrors
        using var doc = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach (var c in doc.RootElement.GetProperty("counters").EnumerateArray())
        {
            if (c.GetProperty("kind").GetString() != "tavern") continue;
            var o = c.GetProperty("origin"); var r = new Room { Id = c.GetProperty("id").GetString()!, Yaw = c.GetProperty("yaw").GetSingle(), Origin = new(o.GetProperty("x").GetSingle(), c.GetProperty("floor_y").GetSingle(), o.GetProperty("z").GetSingle()) }; var rect=c.GetProperty("rect");r.Bounds=new(rect.GetProperty("minX").GetSingle(),rect.GetProperty("minZ").GetSingle(),rect.GetProperty("maxX").GetSingle()-rect.GetProperty("minX").GetSingle(),rect.GetProperty("maxZ").GetSingle()-rect.GetProperty("minZ").GetSingle());Rooms.Add(r);
            foreach (var s in c.GetProperty("seats").EnumerateArray())
            {
                var via = s.GetProperty("via"); var end = via[via.GetArrayLength()-1];
                var seat = new Seat { Room = r, At = World(r, s.GetProperty("x").GetSingle(), s.GetProperty("z").GetSingle()), Approach = World(r, end[0].GetSingle(), end[1].GetSingle()), Height = s.GetProperty("h").GetSingle(), Yaw = r.Yaw+s.GetProperty("yaw").GetSingle(), Table = s.GetProperty("table").GetInt32() }; r.Seats.Add(seat);
                prompts.Add(Interact.I.Add(seat.At + Vector3.Up*.45f, 1.05f, () => Sitting == null && r.Open && seat.Occupant == null && MathF.Abs(Jef.I.Y-r.Origin.Y)<.6f ? seat.Table==9 ? "sit at the counter" : "sit down at the table" : null, () => Sit(seat)));
            }
        }
        standAction = Act.Me(Key.E, "stand up", Stand);
        diceAction = Act.Me(Key.G, "play pitjesbak", () => _ = PlayDice());
        talkAction = Act.Me(Key.F, "talk to the person at your table", () => { if(mate!=null) Talk.I!.Open(mate.Id,mate.Name,"at your table"); });
        Interact.I.AddProvider(SeatedKeys);
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset;
    }
    private Offers? SeatedKeys(float x, float z)
    {
        if (Sitting == null) return null;
        var only = seatedOffers.Only!; only.Clear(); only.Add(standAction);
        if (mate != null) only.Add(diceAction);
        if (GuestAction?.Invoke() is { } guest) only.Add(guest);else if(mate!=null)only.Add(talkAction);
        return seatedOffers;
    }
    private void Reset(string how, ClientState? state) { generation++;tableLines=null;talkingRoom=null;TableLinesShown=0;chatClock=20; Stand(); foreach (var r in Rooms) { r.Open=false; foreach(var s in r.Seats)s.Occupant=null; } poll=0; }
    private static Vector3 World(Room r, float x, float z) => r.Origin + new Vector3(x*MathF.Cos(r.Yaw)+z*MathF.Sin(r.Yaw),0,-x*MathF.Sin(r.Yaw)+z*MathF.Cos(r.Yaw));
    private static uint Hash(string id) { uint h=2166136261; foreach(char c in id) h=unchecked((h^c)*16777619); return h; }
    public void Sit(Seat seat) { if (seat.Occupant!=null || Sitting!=null || !seat.Room.Open) return; returnAt=new(Jef.I.X,Jef.I.Y,Jef.I.Z); Sitting=seat; Jef.I.X=seat.At.X; Jef.I.Z=seat.At.Z; yaw=seat.Yaw+MathF.PI; pitch=0; Jef.I.Frozen=true; FindMate();if(seat.Table!=9)_ = Overhear(true); }
    public void Stand() { if(Sitting==null)return; Sitting=null; mate=null; Dice.I?.Close(); Jef.I.Frozen=false; Jef.I.Place(returnAt.X,returnAt.Z,yaw,pitch,returnAt.Y); }
    private void FindMate() { var previous=mate; mate=null; if(Sitting is not {} s)return; float best=2.6f; foreach(var q in s.Room.Seats) if(q.Occupant is {} who && HasFigure(s.Room.Id,who.Id)) { float d=q.Table==s.Table?0:new Vector2(q.At.X-s.At.X,q.At.Z-s.At.Z).Length(); if(d<best){best=d;mate=who;} } if(mate!=previous && mate!=null)diceAction.Text="play pitjesbak with "+mate.First; }
    private bool HasFigure(string room,string id) { if(town?.Indoors is not {} indoors)return false; foreach(var h in indoors.Houses)if(h.Id==room)return h.Figures.ContainsKey(id);return false; }
    private async Task PlayDice() { if(diceBusy || Sitting==null || mate==null)return; diceBusy=true; try { await Dice.I!.Sit(Sitting.Room.Id,mate.Id,mate.First); } finally{diceBusy=false;} }
    public override void _Input(InputEvent e) { if(Sitting!=null && Dialogs.I?.Top==null && e is InputEventMouseMotion m) { yaw-=m.Relative.X*Jef.TurnSens*Jef.I.LookSens; pitch=Math.Clamp(pitch-m.Relative.Y*Jef.TurnSens*Jef.I.LookSens*(Jef.I.InvertY?-1:1),-1.35f,1.35f); } }
    public override void _Process(double dt)
    {
        if((poll-=dt)<=0 && ServerLink.I?.Up==true){poll=8;_ = Load();}
        if((pose-=dt)<=0){pose=.25; Pose();FindMate();}
        UpdateChatter(dt);
        if(Sitting is {} s) { Jef.I.Frozen=true; Main.I.Cam.GlobalPosition=s.At+Vector3.Up*(s.Height+.72f); Main.I.Cam.GlobalRotation=new(pitch,yaw,0); }
    }
    public async Task Load()
    {
        if(loading||dead||ServerLink.I?.Api is not {} api)return; loading=true; int g=generation;
        try { foreach(var r in Rooms) { if(r.Origin.DistanceTo(new(Jef.I.X,r.Origin.Y,Jef.I.Z))>35)continue; var state=await api.Tavern(r.Id);if(dead||g!=generation)return;r.Open=state.Open;
            foreach(var s in r.Seats)s.Occupant=null;
            foreach(var p in state.Patrons) { if(p.Stand||p.Age<16||Standers.Contains(p.Kind)||Humans.Women.Contains(p.Kind)||Humans.OwnClips.ContainsKey(p.Kind)||Humans.NoSit.Contains(p.Kind)||r.Seats.Count==0)continue; int first=(int)(Hash(p.Id)%(uint)r.Seats.Count); for(int k=0;k<r.Seats.Count;k++){var s=r.Seats[(first+k)%r.Seats.Count];if(s.Occupant!=null||s==Sitting)continue;s.Occupant=p;break;} }
        } FindMate();Pose(); } catch(ApiException){}finally{loading=false;}
    }
    private void Pose()
    {
        if(town?.Indoors is not {} indoors)return;
        foreach(var r in Rooms) foreach(var h in indoors.Houses) { if(h.Id!=r.Id)continue; foreach(var s in r.Seats) if(s.Occupant is {} p && h.Figures.TryGetValue(p.Id,out var f) && f.Human.CanSit) { f.Group.GlobalPosition=s.At+Vector3.Up*f.Human.SitDrop(s.Height);f.Group.GlobalRotation=new(0,s.Yaw,0);f.Yaw=f.Want=s.Yaw;f.Wait=100;f.Human.Play("sit"); } }
    }
    public override void _ExitTree() { dead=true; foreach(var p in prompts)p.Dispose(); if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset; }
}
