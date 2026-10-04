using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.People;
using Scheldemist.Talks;
using Scheldemist.Windows;

namespace Scheldemist.Play;

/// <summary>The engine's current wall bills, lost property, notebooks, meetings and own letters.</summary>
[GamePart(354)]
public partial class Ideas : Node
{
    public static Ideas? I { get; private set; }
    public IdeaWorld? World { get; private set; }
    public LetterOptions? Letters { get; private set; }
    public IdeaReply? LastReply { get; private set; }
    private readonly List<Interact.Entry> entries = new();
    private readonly List<Node3D> marks = new();
    private readonly Dictionary<int, Animal> dogs = new();
    private readonly List<int> following = new();
    private Scheldemist.Town.Townspeople? town;
    private Window letter = null!;
    private LineEdit input = null!;
    private int chosen = -1;
    private bool loading, acting, sending, disposed;
    private double refresh;
    private readonly StandardMaterial3D paper = new() { AlbedoColor = new Color(0.83f, 0.75f, 0.55f), Roughness = 1 };
    private readonly StandardMaterial3D oilcloth = new() { AlbedoColor = new Color(0.21f, 0.15f, 0.1f), Roughness = 1 };
    private Api? Api => ServerLink.I?.Api;
    private static bool CanWrite => !Main.I.Flag("no-ai") && Scheldemist.Menu.AiSheet.Mode != "walk";
    public override void _Ready()
    {
        I = this;
        town = Main.I.GetNodeOrNull<Scheldemist.Town.Townspeople>("Townspeople");
        input = new LineEdit { ContextMenuEnabled = false, PlaceholderText = "Write the letter, then Enter", MaxLength = 1200 };
        input.TextSubmitted += line => { _ = Send(); };
        letter = new Window("letter", WriteLetter, LetterKey);
        ServerLink.I?.WhenUp(() => _ = Load());
        if (Scheldemist.Menu.MainMenu.I is { } m) m.WorldReplaced += Replaced;
    }
    private void Replaced(string how, ClientState? state) { Clear(); World = null; Letters = null; letter.Close(); _ = Load(); }
    public override void _Process(double delta)
    {
        if ((refresh -= delta) <= 0) { refresh = 15; _ = Load(); }
        for (int i = 0; i < following.Count; i++)
        {
            var dog = dogs[following[i]];
            var at = Ground(Jef.I.X + MathF.Sin(Jef.I.Yaw) * 1.2f, Jef.I.Z + MathF.Cos(Jef.I.Yaw) * 1.2f, 0);
            dog.Group.Position = dog.Group.Position.Lerp(at, MathF.Min(1, (float)delta * 2));
            dog.Play("walk"); dog.Update((float)delta);
        }
    }
    private void Clear()
    {
        foreach (var e in entries) e.Dispose(); entries.Clear();
        foreach (var n in marks) if (GodotObject.IsInstanceValid(n)) n.QueueFree(); marks.Clear();
        dogs.Clear(); following.Clear();
    }
    public async Task Load()
    {
        if (loading || disposed || Api == null) return;
        loading = true;
        try
        {
            var world = await Api.IdeaWorld(); if (disposed) return;
            World = world; Clear();
            foreach (var bill in world.Posters)
            {
                if (bill.Spot?.At is not { Length: >= 2 } point) continue;
                var at = Ground((float)point[0], (float)point[1], 1.45f);
                int id = bill.Id;
                entries.Add(Interact.I.Add(at, 2.4f, "read the bill: " + bill.Text.Heading.ToLowerInvariant(), () => _ = Press.I?.OpenBill(id)));
                Mark(at, new Vector3(0.36f, 0.48f, 0.02f), paper);
            }
            foreach (var lost in world.Lost)
            {
                int id = lost.Poster;
                if (lost.Dog != null && Animal.Make(lost.Dog.Look is "dog_brown" or "dog_black" or "dog_spotted" or "dog_grey" ? lost.Dog.Look : "dog_brown") is { } dog)
                {
                    Main.I.View.AddChild(dog.Group); marks.Add(dog.Group); dog.Start(); dogs[id] = dog;
                    dog.Group.Position = lost.State == "lying" ? Ground(lost.X, lost.Z, 0) : Ground(Jef.I.X, Jef.I.Z, 0);
                    if (lost.State == "held") following.Add(id);
                }
                if (lost.State == "lying")
                {
                    var at = Ground(lost.X, lost.Z, lost.Dog != null ? 0.4f : 0.15f);
                    entries.Add(Interact.I.Add(at, 1.9f, lost.Dog != null ? "take " + lost.Dog.Name + " by the collar" : "pick up " + lost.What, () => _ = Act($"api/posters/{id}/pick")));
                    if (lost.Dog == null) Mark(at, new Vector3(0.34f, 0.16f, 0.3f), oilcloth);
                }
                else if (lost.State == "held" && lost.Door is { Length: >= 2 } door)
                    entries.Add(Interact.I.Add(Ground((float)door[0], (float)door[1], 1.2f), 2.6f, "bring " + (lost.Dog?.Name ?? lost.What) + " back to " + lost.OwnerName, () => _ = Act($"api/posters/{id}/return")));
            }
            foreach (var diary in world.Diaries)
            {
                int id = diary.Id;
                if (diary.Status == "lying")
                {
                    var at = Ground(diary.X, diary.Z, 0.12f);
                    entries.Add(Interact.I.Add(at, 1.9f, "pick up the notebook", () => _ = Act($"api/diary/{id}/pick")));
                    Mark(at, new Vector3(0.2f, 0.035f, 0.15f), oilcloth);
                }
                else if (diary.Status == "held" && diary.Door is { Length: >= 2 } door)
                {
                    var at = Ground((float)door[0], (float)door[1], 1.2f);
                    entries.Add(Interact.I.Add(at, 2.6f, "give the notebook back to " + diary.OwnerName, () => _ = Act($"api/diary/{id}/return")));
                    entries.Add(Interact.I.Add(at, 2.6f, "squeeze " + diary.OwnerName + " over the notebook", () => _ = Act($"api/diary/{id}/squeeze"), Key.G));
                }
            }
            foreach (var meeting in world.Meetings)
            {
                int id = meeting.Id;
                var at = Ground(meeting.X, meeting.Z, 1.2f);
                entries.Add(Interact.I.Add(at, 2.6f, () => GameState.I.HourF >= meeting.FromH && GameState.I.HourF < meeting.ToH ? "knock: " + meeting.Name + " asked you to come by" : null, () => _ = Act($"api/meet/{id}")));
            }
            if (Press.I?.Info?.Berg?.Door is { Length: >= 2 } berg)
                foreach (var diary in world.Diaries) if (diary.Status == "held")
                {
                    int id = diary.Id;
                    entries.Add(Interact.I.Add(Ground((float)berg[0], (float)berg[1], 1.2f), 3.2f, "sell the notebook to the Berg's clerk", () => _ = Act($"api/diary/{id}/sell"), Key.G));
                }
            if (Press.I?.Info?.Post is { } post && Scheldemist.Play.Folk.At(post.Clerk) is { } clerk)
                entries.Add(Interact.I.Add(clerk, 3.2f, () => CanWrite ? "write a letter (a stamp)" : null, () => _ = OpenLetter(), Key.G));
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { loading = false; }
    }
    private Vector3 Ground(float x, float z, float up)
    {
        return new Vector3(x, (float)(town?.Walk?.BaseAt(x, z) ?? 0) + up, z);
    }
    private void Mark(Vector3 at, Vector3 size, Material material)
    {
        var node = new MeshInstance3D { Mesh = new BoxMesh { Size = size }, MaterialOverride = material, Position = at };
        Main.I.View.AddChild(node); marks.Add(node);
    }
    public async Task Act(string path)
    {
        if (acting || Api == null) return; acting = true;
        try
        {
            var result = await Api.IdeaAction(path, Jef.I.X, Jef.I.Z);
            if (disposed) return;
            LastReply = result;
            if (result.Player.Day > 0) GameState.I.Apply(result);
            GameState.I.Say(result.Text);
            await Load();
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { acting = false; }
    }
    public async Task OpenLetter()
    {
        if (!CanWrite || Api == null) return;
        try { Letters = await Api.LetterOptions(); chosen = -1; if (Letters.To.Count == 0) { GameState.I.Say("You know nobody in town well enough to write to yet."); return; } letter.Open(); }
        catch (ApiException e) { GameState.I.Say(e.Message); }
    }
    private Sheet? WriteLetter()
    {
        if (Letters == null) return null;
        var sheet = Deeds.Paper(chosen < 0 ? "A letter of your own" : "To " + Letters.To[chosen].Name, "A stamp: " + Letters.StampC + " centimes");
        if (chosen < 0)
        {
            for (int i = 0; i < Letters.To.Count && i < 9; i++) sheet.Row(i + 1, Css.Esc(Letters.To[i].Name), Css.Esc(Letters.To[i].Near));
            sheet.Keys("1-9  choose a person · Esc  step away");
        }
        else
        {
            sheet.Text("Write your own words. The evening post carries them.", Face.Print, 16, bottom: 10);
            if (input.GetParent() is { } old) old.RemoveChild(input);
            input.MaxLength = Letters.MaxChars;
            sheet.Add(sheet.Margin(input, 6, 4));
            sheet.Keys("Enter  seal and send · Esc  tear it up");
            input.CallDeferred(Control.MethodName.GrabFocus);
        }
        return sheet;
    }
    private void LetterKey(string code, string key)
    {
        if (code == "Escape") { letter.Close(); return; }
        if (chosen < 0 && code.StartsWith("Digit") && code.Length == 6 && int.TryParse(code[5..], out int n) && Letters != null && n > 0 && n <= Letters.To.Count) { chosen = n - 1; input.Text = ""; letter.Render(); }
        else if (chosen >= 0 && code == "Enter") _ = Send();
    }
    public async Task Send()
    {
        if (sending || !CanWrite || Api == null || Letters == null || chosen < 0 || string.IsNullOrWhiteSpace(input.Text)) return;
        sending = true;
        try
        {
            var result = await Api.SendLetter(Letters.To[chosen].Id, input.Text.Trim(), Jef.I.X, Jef.I.Z);
            LastReply = result; GameState.I.Apply(result); letter.Close(); GameState.I.Say(result.Text);
        }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { sending = false; }
    }
    public override void _ExitTree()
    {
        disposed = true; Clear(); letter.Close(); if (input.GetParent() == null) input.Free();
        if (Scheldemist.Menu.MainMenu.I is { } m) m.WorldReplaced -= Replaced;
        if (I == this) I = null;
    }
}
