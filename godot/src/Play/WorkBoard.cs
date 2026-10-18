using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Windows;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>
/// The paper notes on the hiring board (#153): one per open job in its place on the board (the engine's eight places,
/// GameState.BoardSlots), pinned to the board model's face. Each note says what the work is, who gives it and what it
/// pays, readable from a metre; its paper, size and hand are the poster's own. Look at a note and press E to take
/// that job; the board's E (anywhere else on it) still opens the list. A taken job's note comes down, a new job's goes
/// up in the place that is free.
/// </summary>
[GamePart(340)]
public partial class WorkBoard : Node
{
    public static WorkBoard? I { get; private set; }
    // the board model's eight places (workboard.scn hiring_board extras), in its own frame: face toward +z
    public static readonly Vector3[] Places = new[] { 1.80f, 1.32f }.SelectMany(y => new[] { -.64f, -.215f, .215f, .64f }.Select(x => new Vector3(x, y, .089f))).ToArray();
    private static readonly uint[] Papers = { 0xdcd2b4, 0xe6e1d3, 0xd9c99a, 0xc8cdcc, 0xd8c4b0, 0xcfc39f };
    private static readonly Color[] Inks = { new(.10f, .09f, .08f), new(.24f, .16f, .10f), new(.12f, .16f, .30f) };

    public sealed class Note
    {
        public Job Job = null!;
        public int Place;
        public Node3D Root = null!;
        public Label3D Title = null!, Giver = null!, Pay = null!;
        public Vector3 At => Root.GlobalPosition;
    }

    private readonly List<Note> notes = new();
    public IReadOnlyList<Note> Notes => notes;
    private Node3D? board;
    private Transform3D frame;
    private string shown = "";
    private double poll;

    public override void _Ready()
    {
        I = this;
        Interact.I.AddProvider(Keys);
    }

    public override void _ExitTree() { if (I == this) I = null; }

    /// <summary>The board's frame: the authored hiring board, or the hiring spot facing the quay.</summary>
    public Transform3D Frame
    {
        get
        {
            if (board == null || !IsInstanceValid(board))
                board = BakedWorld.All(Main.I.World).OfType<Node3D>().FirstOrDefault(n => n.Get("ObjectId").VariantType == Variant.Type.String && n.Get("ObjectId").AsString() == "hiring-board");
            if (board != null) return board.GlobalTransform;
            var (bx, bz) = Spots.Board;
            return new Transform3D(Basis.FromEuler(new Vector3(0, MathF.PI, 0)), new Vector3(bx, 0, bz));
        }
    }

    public override void _Process(double delta)
    {
        if ((poll -= delta) > 0) return;
        poll = .3;
        var slots = GameState.I.BoardSlots;
        var jobs = GameState.I.Jobs;
        var up = slots == null ? new List<(Job job, int place)>() : jobs.Where(j => j.Status == "offered" && slots.ContainsKey(j.Id.ToString())).Select(j => (job: j, place: slots[j.Id.ToString()])).OrderBy(p => p.place).ToList();
        string key = string.Join(";", up.Select(p => $"{p.job.Id}:{p.place}:{p.job.Title}:{p.job.PayC}"));
        if (key == shown) return;
        shown = key;
        foreach (var n in notes) n.Root.QueueFree();
        notes.Clear();
        frame = Frame;
        foreach (var (job, place) in up)
            if (place >= 0 && place < Places.Length) notes.Add(Make(job, place));
    }

    private static uint Hash(string s) { uint h = 2166136261; foreach (char c in s) h = unchecked((h ^ c) * 16777619); return h; }

    private Note Make(Job job, int place)
    {
        // the poster's own paper, size and hand; each note a little askew
        uint h = Hash(job.EmployerNpc ?? job.EmployerName ?? "");
        uint k = Hash(job.Id.ToString());
        float w = .185f + (h % 5) * .008f, ht = .235f + (h / 5 % 4) * .01f;
        bool hand = h % 3 != 0;
        var ink = Inks[h / 7 % (uint)Inks.Length];
        var root = new Node3D { Name = "job_note_" + job.Id };
        Main.I.View.AddChild(root);
        root.GlobalTransform = frame * new Transform3D(Basis.FromEuler(new Vector3(0, 0, ((int)(k % 9) - 4) * .011f)), Places[place]);
        root.AddChild(new MeshInstance3D { Name = "paper", Mesh = new BoxMesh { Size = new Vector3(w, ht, .0016f) }, MaterialOverride = Goods.I.Plain(Papers[h % (uint)Papers.Length]), Position = new Vector3(0, 0, .0008f) });
        var pin = new MeshInstance3D { Name = "pin", Mesh = new CylinderMesh { TopRadius = .0055f, BottomRadius = .0065f, Height = .008f, RadialSegments = 8, Rings = 1 }, MaterialOverride = Goods.I.Plain(0x2b2723) };
        pin.Position = new Vector3(0, ht / 2 - .018f, .005f);
        pin.Rotation = new Vector3(MathF.PI / 2, 0, 0);
        root.AddChild(pin);
        float wrap = (w - .024f) / .00105f;
        Label3D Text(string text, Font font, int size, float y, HorizontalAlignment align = HorizontalAlignment.Left)
        {
            var l = new Label3D
            {
                Text = text, Font = font, FontSize = size, PixelSize = .00105f, Modulate = ink, OutlineSize = 0,
                AutowrapMode = TextServer.AutowrapMode.WordSmart, Width = wrap, HorizontalAlignment = align, VerticalAlignment = VerticalAlignment.Top,
                // (a left line starts at the label's origin, a right one ends there: put the origin at that margin)
                Position = new Vector3(align == HorizontalAlignment.Right ? w / 2 - .012f : -w / 2 + .012f, y, .0019f), DoubleSided = false,
            };
            root.AddChild(l);
            return l;
        }
        var titleFont = hand ? PaperFonts.HandBold : PaperFonts.PrintBold;
        var bodyFont = hand ? PaperFonts.Hand : PaperFonts.Print;
        var note = new Note { Job = job, Place = place, Root = root };
        note.Title = Text(job.Title, titleFont, 30, ht / 2 - .03f);
        note.Giver = Text("from " + (job.EmployerName ?? "the natie"), bodyFont, 24, -ht / 2 + .094f);
        note.Pay = Text($"pay {job.PayC} c", titleFont, 32, -ht / 2 + .036f, HorizontalAlignment.Right);
        return note;
    }

    /// <summary>E at a note takes its job (Jobs.TakeJob says no when the hands are full or the work is not in the game).</summary>
    private Offers? Keys(float x, float z)
    {
        if (notes.Count == 0) return null;
        var o = new Offers { Options = new List<(float, Act)>() };
        foreach (var n in notes)
        {
            if (!IsInstanceValid(n.Root)) continue;
            var at = n.At;
            float d = new Vector2(at.X - x, at.Z - z).Length();
            if (d > 2.2f) continue;
            var job = n.Job;
            o.Options.Add((d - .05f, Act.At(Key.E, "take the job: " + job.Title, at, () => _ = Jobs.I.TakeJob(job))));
        }
        return o.Options.Count == 0 ? null : o;
    }
}
