using System;
using System.Collections.Generic;
using System.Text.Json;
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
        public bool Inside()
        {
            var p = Local(Jef.I.X, Jef.I.Z); float feet = Jef.I.Y - Origin.Y;
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
    private Hall? here;
    private double poll, locate;
    private bool loading, dead, candleBusy, hearing;
    private Window paper = null!;
    private string heading = "", body = "";
    private SermonView? sermon;
    private Label caption = null!;
    private int sermonLine = -1;
    private double sermonTime;
    public int HeardLines { get; private set; }
    public SermonReply? SermonResult { get; private set; }
    public Vector3 Point(string id, string mark) => halls.Find(h => h.Id == id)!.Mark(mark);
    public string? Here => here?.Id;
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
    }
    private Sheet? Write() { var sh = new Sheet(Dialogs.I!.Ui, 560, Css.Hex("e3d4ad"), (26, 18, 26, 14), maxHeight: GetViewport().GetVisibleRect().Size.Y * 0.85f) { Where = Window.Middle }; sh.Text("[b]" + Css.Esc(heading) + "[/b]", Face.Print, 24, bottom: 14); sh.Text(Css.Esc(body), Face.Print, 16, lineHeight: 1.45f); sh.Keys("E or Esc to fold it away", Face.Hand); return sh; }
    private void Show(string title, string text) { heading = title; body = text; paper.Open(); }
    public override void _Process(double delta)
    {
        if (hearing && sermon != null)
        {
            if (here?.Id != "cathedral") { hearing = false; sermon = null; caption.Visible = false; }
            else if ((sermonTime -= delta) <= 0)
            {
                if (++sermonLine >= sermon.Lines.Count) { hearing = false; sermon = null; caption.Visible = false; _ = FinishSermon(); }
                else { string line = sermon.Lines[sermonLine]; sermonTime = Math.Clamp(2.2 + line.Length / 55.0, 3, 4.6); caption.Text = line; caption.Visible = true; caption.Position = new Vector2((GetViewport().GetVisibleRect().Size.X - caption.Size.X) / 2, 125); HeardLines++; var at = here.Mark("pulpit"); Scheldemist.Audio.Soundscape.I?.Speech(at.X, at.Z, new("m", 55), Math.Min(sermonTime - 0.4, 5)); }
            }
        }
        if ((locate -= delta) <= 0)
        {
            locate = 0.25; Hall? next = null; foreach (var h in halls) if (h.Inside()) { next = h; break; }
            if (here != next) { here = next; _ = Enter(next?.Id); poll = 0; }
            foreach (var p in moving) if (HallPeople.I?.PositionOf(p.Id) is { } at) p.Entry.Place = at + Vector3.Up * 1.3f;
        }
        if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 12; _ = Load(); }
    }
    private async Task Enter(string? id) { if (ServerLink.I?.Api is not { } api) return; try { await api.LandmarkHere(id); } catch (ApiException) { } }
    public async Task Load()
    {
        if (loading || dead || ServerLink.I?.Api is not { } api) return; loading = true;
        try
        {
            foreach (var h in halls) { var next = await api.LandmarkNow(h.Id); if (dead) return; h.State = next; }
            foreach (var p in peoplePrompts) p.Dispose(); peoplePrompts.Clear(); moving.Clear();
            foreach (var h in halls) foreach (var person in h.State!.People)
            {
                var p = Interact.I.Add(Vector3.Zero, 2.4f, () => here == h && HallPeople.I?.PositionOf(person.Id) != null ? "talk to " + person.Name : null, () => Talk.I!.Open(person.Id, person.Name, person.Title));
                peoplePrompts.Add(p); moving.Add((p, person.Id));
            }
        }
        catch (ApiException) { }
        finally { loading = false; }
    }
    public async Task Candle() { if (candleBusy || here?.Id != "cathedral") return; candleBusy = true; try { var r = await ServerLink.I!.Api!.LandmarkCandle(); GameState.I.Apply(r); GameState.I.Say(r.Text); } catch (ApiException e) { GameState.I.Say(e.Message); } finally { candleBusy = false; } }
    public async Task HearSermon()
    {
        if (hearing || here?.Id != "cathedral") return; hearing = true;
        try { var s = await ServerLink.I!.Api!.Sermon(); if (!dead && here?.Id == "cathedral") { sermon = s; sermonLine = -1; sermonTime = 6.2; HeardLines = 0; SermonResult = null; } else hearing = false; }
        catch (ApiException e) { hearing = false; GameState.I.Say(e.Message); }
    }
    private async Task FinishSermon() { try { var r = await ServerLink.I!.Api!.SermonHeard(); if (dead || here?.Id != "cathedral") return; SermonResult = r; GameState.I.Apply(r); GameState.I.Say(r.Text); } catch (ApiException e) { GameState.I.Say(e.Message); } }
    public override void _ExitTree() { dead = true; foreach (var p in fixedPrompts) p.Dispose(); foreach (var p in peoplePrompts) p.Dispose(); paper.Close(); caption.QueueFree(); data?.Dispose(); }
}
