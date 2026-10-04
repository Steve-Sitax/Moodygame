using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Audio;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Town;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>ballads.ts: engine words and purchase, the same syllables and tune, sheets from pockets.</summary>
[GamePart(356)]
public partial class Ballads : Node
{
    public static Ballads I { get; private set; } = null!;
    public BalladView? Info { get; private set; }
    private static readonly int[][] Verse = { new[] { 0,4,7,7,9,7,4,7 }, new[] { 7,9,12,11,9,7,5,4 }, new[] { 0,4,7,7,9,12,11,9 }, new[] { 7,5,4,2,4,2,0,0 } };
    private static readonly int[][] Chorus = { new[] { 12,12,11,9,7,9,11,12 }, new[] { 9,7,5,4,2,4,2,0 }, new[] { 7,7,9,11,12,11,9,7 }, new[] { 5,4,2,2,4,2,0,0 } };
    private sealed record Line(string Text, bool Chorus, List<Note> Notes, double Seconds);
    private readonly List<Line> song = new();
    private double poll, lineTime, locate;
    private bool loading, buying, dead;
    private string songKey = "";
    private int askedDay = -1, index = -1;
    private Townspeople? town;
    private Vector3? singerAt;
    private Label tag = null!;
    private Window page = null!;
    private BalladSheet? sheet;
    private Action<PocketItem>? previousRead;
    private Interact.Entry? buy;
    public int Sung { get; private set; }
    public override void _Ready()
    {
        I = this; town = GetParent().GetNodeOrNull<Townspeople>("Townspeople");
        tag = new Label { Visible = false, MouseFilter = Control.MouseFilterEnum.Ignore, LabelSettings = new LabelSettings { Font = PaperFonts.Hand, FontSize = 21, FontColor = Css.Ink, OutlineColor = Css.Hex("e3d4ad"), OutlineSize = 5 } }; Main.I.Ui.AddChild(tag);
        page = new Window("ballad sheet", WriteSheet, (code, _) => { if (code is "KeyE" or "KeyI" or "Escape") page.Close(); });
        previousRead = Pockets.I!.OnRead; Pockets.I.OnRead = Read;
        buy = Interact.I.Add(Vector3.Zero, 2.6f, () => !buying && Info is { HaveSheet: false, Ballad: not null, Singing.Status: "running" } && singerAt != null ? $"buy a ballad sheet from {Info.Singer!.First} ({Info.PriceC} c)" : null, () => _ = Buy(), Key.G);
    }
    private void Read(PocketItem item) { if (item.Kind == "ballad") _ = ReadSheet(item.Ref ?? Info?.Day ?? 0); else previousRead?.Invoke(item); }
    public async Task ReadSheet(int day) { try { sheet = await ServerLink.I!.Api!.BalladSheet(day); if (!dead) page.Open(); } catch (ApiException e) { GameState.I.Say(e.Message); } }
    private Sheet? WriteSheet()
    {
        if (sheet == null) return null;
        var sh = new Sheet(Dialogs.I!.Ui, 530, Css.Hex("e6d9b9"), (28, 18, 28, 14), maxHeight: GetViewport().GetVisibleRect().Size.Y * 0.85f) { Where = Window.Middle };
        sh.Text("[b]" + Css.Esc(sheet.Title) + "[/b]", Face.Print, 24, bottom: 12, align: HorizontalAlignment.Center);
        sh.Text("A new song. To be sung to an old tune everybody knows.", Face.Hand, 14, bottom: 10);
        for (int i = 0; i < sheet.Verses.Count; i++) { sh.Text((i + 1) + ". " + Css.Esc(string.Join("\n", sheet.Verses[i])), Face.Print, 16, bottom: 8); sh.Text("[i]" + Css.Esc(string.Join("\n", sheet.Chorus)) + "[/i]", Face.Print, 16, bottom: 12); }
        sh.Text(Css.Esc($"Printed for the singer, Antwerp, {sheet.Weekday}. One centime."), Face.Print, 12);
        sh.Keys("E or Esc to fold it away", Face.Hand); return sh;
    }
    public async Task Load()
    {
        if (loading || dead || ServerLink.I?.Api is not { } api) return; loading = true;
        try
        {
            var next = await api.BalladInfo();
            if (next.Singing != null && next.Ballad == null && !next.Writing && askedDay != next.Day) { askedDay = next.Day; next = await api.BalladToday(); }
            if (dead) return; Info = next;
            string key = next.Day + ":" + next.Ballad?.Title;
            if (key != songKey) { songKey = key; song.Clear(); index = -1; lineTime = 2; if (next.Ballad is { } b) foreach (var v in b.Verses) { for (int i = 0; i < v.Count; i++) song.Add(Tune(v[i], i, false, next.Day)); for (int i = 0; i < b.Chorus.Count; i++) song.Add(Tune(b.Chorus[i], i, true, next.Day)); } }
        }
        catch (ApiException) { poll = 2; }
        finally { loading = false; }
    }
    private static Line Tune(string text, int i, bool chorus, int day)
    {
        int n = 0; foreach (Match word in Regex.Matches(text.ToLowerInvariant(), "[a-z']+")) n += Math.Max(1, Regex.Matches(Regex.Replace(word.Value, "e$", ""), "[aeiouy]+").Count);
        n = Math.Clamp(n, 4, 12); int[] phrase = (chorus ? Chorus : Verse)[i % 4]; int shift = new[] { 0, 2, -3, 5, -1 }[day % 5]; var notes = new List<Note>(n); double secs = 0;
        for (int k = 0; k < n; k++) { int semi = phrase[Math.Min(7, k * 8 / n)]; if (k > 0 && k < n - 1 && (k + day) % 5 == 0) semi += semi >= 7 ? -2 : 2; double beats = k == n - 1 ? 2 : n > 9 && k % 2 != 0 ? 0.75 : 1; notes.Add(new(semi + shift, beats)); secs += beats * 0.34; }
        return new(text, chorus, notes, secs);
    }
    public override void _Process(double delta)
    {
        if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 10; _ = Load(); }
        if ((locate -= delta) <= 0)
        {
            locate = 0.25; singerAt = Info?.Singer is { } who && town?.PositionOf(who.Id) is { } at ? new Vector3((float)at.x, 0, (float)at.z) : null;
            if (buy != null && singerAt is { } p) buy.Place = p + Vector3.Up * 1.3f;
        }
        if (Info?.Singing is not { Status: "running" } s || Info.Singer == null || song.Count == 0 || singerAt is not { } pos || Main.I.Cam.GlobalPosition.DistanceTo(pos) >= 30 || (s.Kind == "street" && s.X is { } sx && RunWords.Dist(pos.X, pos.Z, sx, s.Z ?? 0) >= 7)) { tag.Visible = false; return; }
        if ((lineTime -= delta) <= 0)
        {
            index++; if (index >= song.Count) { index = -1; lineTime = 10; tag.Visible = false; return; }
            var l = song[index]; lineTime = (Soundscape.I?.Sing(pos.X, pos.Z, new VoiceOf(Info.Singer.Sex, Info.Singer.Age), l.Notes, 0.34) ?? l.Seconds) + 0.4;
            tag.Text = Info.Singer.First + (l.Chorus ? ", all together: " : ": ") + l.Text; Sung++;
        }
        if (index < 0 || Main.I.Cam.IsPositionBehind(pos)) { tag.Visible = false; return; }
        tag.Visible = true; tag.Position = Main.I.Cam.UnprojectPosition(pos + Vector3.Up * 1.85f) - new Vector2(tag.Size.X / 2, tag.Size.Y);
    }
    public async Task Buy() { if (buying || ServerLink.I?.Api is not { } api) return; buying = true; try { var r = await api.BalladBuy(); if (dead) return; GameState.I.Apply(r); GameState.I.Say(r.Text); await Load(); } catch (ApiException e) { GameState.I.Say(e.Message); } finally { buying = false; } }
    public override void _ExitTree() { dead = true; buy?.Dispose(); page.Close(); tag.QueueFree(); if (Pockets.I != null) Pockets.I.OnRead = previousRead; }
}
