using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>homes.ts: notices, key and rent; own bed and fire inside the actual room.</summary>
[GamePart(355)]
public partial class HomeLife : Node
{
    public static HomeLife I { get; private set; } = null!;
    public HomesView? Info { get; private set; }
    public bool Busy { get; private set; }
    private double poll, doorTime;
    private int generation;
    private readonly List<Interact.Entry> prompts = new();
    private readonly List<Interact.Entry> notices = new();
    private readonly Dictionary<string, HomeFrame> frames = new();
    private Window notice = null!;
    private HomeDoor? selected;
    public sealed class HomeFrame
    {
        public string Id = ""; public float X, Z, Yaw, Rx, Rz, Mirror, Y, W, D;
        public Vector3 Bed, Fire;
        public Vector3 World(float x, float z, float height = 0) { x = Rx + x * Mirror; z += Rz; return new(X + x * MathF.Cos(Yaw) + z * MathF.Sin(Yaw), Y + height, Z - x * MathF.Sin(Yaw) + z * MathF.Cos(Yaw)); }
        public Vector2 Local(float x, float z) { float dx = x - X, dz = z - Z; return new((dx * MathF.Cos(Yaw) - dz * MathF.Sin(Yaw) - Rx) * Mirror, dx * MathF.Sin(Yaw) + dz * MathF.Cos(Yaw) - Rz); }
        public bool Inside { get { var p = Local(Jef.I.X, Jef.I.Z); return MathF.Abs(Jef.I.Y - Y) < 0.6f && MathF.Abs(p.X) < W / 2 + 0.05f && p.Y > -0.1f && p.Y < D + 0.05f; } }
    }
    public IReadOnlyDictionary<string, HomeFrame> Frames => frames;
    public override void _Ready()
    {
        I = this;
        using var doc = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach (var h in doc.RootElement.GetProperty("homes").EnumerateArray())
        {
            var o = h.GetProperty("origin"); var rf = h.GetProperty("room_frame"); var def = h.GetProperty("definition");
            var f = new HomeFrame { Id = h.GetProperty("id").GetString()!, X = o.GetProperty("x").GetSingle(), Z = o.GetProperty("z").GetSingle(), Yaw = h.GetProperty("yaw").GetSingle(), Rx = rf.GetProperty("x").GetSingle(), Rz = rf.GetProperty("z").GetSingle(), Mirror = rf.GetProperty("mirror").GetSingle(), Y = rf.GetProperty("y").GetSingle() + h.GetProperty("floor_y").GetSingle(), W = def.GetProperty("W").GetSingle(), D = def.GetProperty("D").GetSingle() };
            foreach (var fixedPiece in def.GetProperty("fixed").EnumerateArray())
            {
                var at = f.World(-f.W / 2 + (fixedPiece.GetProperty("gx").GetSingle() + fixedPiece.GetProperty("w").GetSingle() / 2) * 0.5f, (fixedPiece.GetProperty("gz").GetSingle() + fixedPiece.GetProperty("d").GetSingle() / 2) * 0.5f, 0.5f);
                string kind = fixedPiece.GetProperty("kind").GetString()!;
                if (kind.StartsWith("bed")) f.Bed = at;
                if (kind is "hearth" or "mantel") f.Fire = at;
            }
            frames.Add(f.Id, f);
            prompts.Add(Interact.I.Add(f.Bed, 1.4f, () => Mine(f) && f.Inside ? "go to bed" : null, () => Day.I.ChooseHome(Info!.Homes.First(h => h.Id == f.Id).Label)));
            if (f.Fire != Vector3.Zero) prompts.Add(Interact.I.Add(f.Fire, 1.3f, () => Mine(f) && f.Inside ? "warm yourself at the fire" : null, () => _ = Change(() => ServerLink.I!.Api!.HomeWarm())));
        }
        notice = new Window("home notice", WriteNotice, NoticeKey);
        Day.I.WakeHome += Wake;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced += Reset;
    }
    private bool Mine(HomeFrame f) => Info?.Lease?.Home == f.Id && ServerLink.I?.Api?.Guest == false;
    private void Reset(string how, ClientState? client) { generation++; Info = null; notice.Close(); poll = 0; foreach (var p in notices) p.Dispose(); notices.Clear(); foreach (var d in Doors.I.All) if (d.Id.StartsWith("home_")) Doors.I.Force(d, false); }
    public override void _Process(double delta)
    {
        if ((poll -= delta) <= 0 && !Busy && ServerLink.I?.Up == true) { poll = 10; _ = Load(); }
        if ((doorTime -= delta) > 0) return;
        doorTime = 0.25;
        foreach (var f in frames.Values)
        {
            var d = Doors.I.Get(Spots.BakedName("home:" + f.Id));
            if (d == null) continue;
            d.Kind = "home";
            bool open = Mine(f) && (f.Inside || new Vector2(Jef.I.X, Jef.I.Z).DistanceTo(new Vector2(f.X, f.Z)) < 4.5f);
            Doors.I.Force(d, open);
        }
    }
    public async Task Load()
    {
        if (Busy || ServerLink.I?.Api is not { } api) return;
        Busy = true; int g = generation;
        try { var info = await api.HomesInfo(); if (g == generation) Apply(info); }
        catch (ApiException) { poll = 2; }
        finally { Busy = false; }
    }
    private void Apply(HomesView info)
    {
        bool first = Info == null; Info = info;
        if (!first) return;
        foreach (var h in info.Homes)
        {
            var at = new Vector3(h.Wall[0], 1.2f, h.Wall[1]);
            notices.Add(Interact.I.Add(at, 1.8f, () => !Busy && Info?.Lease?.Home != h.Id ? "read the notice: " + h.Label + " to let" : null, () => { selected = h; notice.Open(); }));
            notices.Add(Interact.I.Add(at, 1.8f, () => !Busy && Info?.Lease?.Home == h.Id ? "pay the rent" : null, () => { selected = h; notice.Open(); }, Key.F));
        }
    }
    private Sheet? WriteNotice()
    {
        if (selected is not { } h) return null;
        var sh = new Sheet(1, 470, Css.Hex("e3d4ad"), (24, 20, 24, 16)) { Where = Window.Middle };
        sh.Text(Css.Esc(h.Notice), Face.Print, 20, bottom: 12);
        bool mine = Info?.Lease?.Home == h.Id;
        sh.Row(1, mine ? "Pay another night" : "Take the key for tonight", $"{(mine ? Info!.Lease!.DayC : h.DayC)} c");
        sh.Row(2, mine ? "Pay to Sunday" : "Take the key to Sunday", $"{(mine ? Info!.Lease!.ToSundayC : h.ToSundayC)} c");
        if (mine) sh.Text(Css.Esc(string.Join(", ", Info!.Lease!.Words)) + $". Rent owed: {Info.Lease.OwedC} c.", Face.Hand, 16, top: 8);
        sh.Keys("E or Esc to fold it away", Face.Hand); return sh;
    }
    private void NoticeKey(string code, string key)
    {
        if (code is "Escape" or "KeyE") { notice.Close(); return; }
        if (Busy || selected == null || code is not ("Digit1" or "Digit2")) return;
        string plan = code == "Digit1" ? "day" : "week";
        _ = Change(() => Info?.Lease?.Home == selected.Id ? ServerLink.I!.Api!.HomeRent(plan) : ServerLink.I!.Api!.HomeTake(new(selected.Id, plan)));
    }
    public async Task Change(Func<Task<HomeReply>> call)
    {
        if (Busy) return; Busy = true; int g = generation;
        try { var r = await call(); if (g != generation) return; Info = r.Homes; GameState.I.Apply(r); GameState.I.Say(r.Text); notice.Close(); }
        catch (ApiException e) { if (g == generation) GameState.I.Say(e.Message); }
        finally { Busy = false; }
    }
    private void Wake(string home) { if (frames.TryGetValue(home, out var f)) { var at = f.World(0, f.D / 2); Jef.I.Place(at.X, at.Z, f.Yaw); Jef.I.Y = f.Y; } }
    public override void _ExitTree()
    {
        generation++; foreach (var p in prompts) p.Dispose(); foreach (var p in notices) p.Dispose(); notice.Close(); Day.I.WakeHome -= Wake;
        if (Scheldemist.Menu.MainMenu.I is { } menu) menu.WorldReplaced -= Reset;
    }
}
