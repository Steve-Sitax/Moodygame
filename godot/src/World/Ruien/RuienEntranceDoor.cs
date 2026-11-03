using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Game;
using Scheldemist.Models;
using Scheldemist.Net;
using Scheldemist.Play;
using Scheldemist.Player;

namespace Scheldemist.World.Ruien;

/// <summary>
/// An entrance's street door (RuienEntrance; docs/ruien-native.md "Entrances"): a ledged and braced oak leaf on strap
/// hinges that turns inward, its collision turning with it, opened and shut with E. Its state is the world's, kept by the
/// Ruien hatches' service (api/ruien/hatches/entrance_&lt;id&gt;), so saves and other players see the same door. Down at the
/// landing the closure answers E with why the way on is shut.
/// </summary>
public partial class RuienEntranceDoor : Node3D
{
    public static readonly Dictionary<string, RuienEntranceDoor> All = new();
    /// <summary>How much daylight comes in by an entrance's door light now (1 for any other source).</summary>
    public static float Light(string source)
    {
        foreach (var d in All.Values) if (d.Spec.LightId == source) return (d.Spec.Head == "arch" ? .15f : .03f) + (d.Spec.Head == "arch" ? .85f : .97f) * d.Open;
        return 1;
    }
    public RuienEntrance.Spec Spec = null!;
    public float Open { get; private set; }
    public bool Target { get; private set; }
    public bool Known { get; private set; }
    public const float OpenDeg = 86;
    public const float Planks = .042f, Ledges = .03f;
    private Node3D hinge = null!;
    private float poll;
    private bool pending;
    private bool? requested;

    public float LeafWidth => 2 * (Spec.DoorOpening.H - Spec.Post) - .01f;
    public float LeafHeight => Spec.DoorHeight - .02f;

    public override void _Ready()
    {
        All[Spec.Id] = this;
        var o = Spec.DoorOpening;
        // The hinge: the left post's inner edge, at the planks' inner face; the leaf runs +x from it.
        hinge = new Node3D { Name = "hinge", Position = new Vector3(-o.H + Spec.Post + .004f, .012f, Spec.LeafFace - Planks) };
        AddChild(hinge);
        Leaf(hinge, LeafWidth, LeafHeight);
        // the pintles on the post, fixed
        var fixedIron = new SurfaceTool(); fixedIron.Begin(Mesh.PrimitiveType.Triangles);
        var ironMat = RuienMaterials.Get("ruien_iron");
        foreach (float y in Straps(LeafHeight))
        {
            fixedIron.AppendFrom(BevelMesh.Box(new Vector3(.05f, .07f, .012f), .002f, ironMat), 0, new Transform3D(Basis.Identity, hinge.Position + new Vector3(-.03f, y, -.006f)));
            var pin = new SurfaceTool(); pin.CreateFrom(new CylinderMesh { TopRadius = .011f, BottomRadius = .011f, Height = .12f, RadialSegments = 16 }, 0); pin.Deindex();
            fixedIron.AppendFrom(pin.Commit(), 0, new Transform3D(Basis.Identity, hinge.Position + new Vector3(0, y, -.012f)));
        }
        RuienStair.Add(this, fixedIron, "ruien_iron", false);
        inside = GetParent()?.GetNodeOrNull<Node3D>("inside");
        CallDeferred(MethodName.Install);
    }

    private static float[] Straps(float height) => new[] { .28f, height - .28f };

    /// <summary>
    /// The leaf (in the hinge's frame: x across from the hinge, y up from the foot, z through it, the planks' outer face at
    /// z = Planks): vertical planks with 3 mm joints, three ledges and two braces on the inside rising from the hinge
    /// side, strap hinges on the ledges, clout nails, a ring handle and a keyhole plate outside. The planks are
    /// AddOak's pieces with their grain; the oak is laid out with the leaf's height as AddOak's x, so its damp is at the foot.
    /// </summary>
    private static void Leaf(Node3D hinge, float width, float height)
    {
        var oakMat = RuienMaterials.Get("ruien_oak"); var ironMat = RuienMaterials.Get("ruien_iron");
        // leaf coords -> AddOak's piece coords (x up the leaf, y through it, z across) and back
        var back = new Transform3D(new Basis(new Vector3(0, 1, 0), new Vector3(0, 0, 1), new Vector3(1, 0, 0)), Vector3.Zero);
        var to = back.AffineInverse();
        var oak = new List<(ArrayMesh mesh, Transform3D at, Vector3 grain, float column)>();
        void Oak(Vector3 size, Transform3D at, Vector3 grain, float column) => oak.Add((BevelMesh.Box(size, .003f, oakMat), to * at, to.Basis * grain, column));
        int n = Math.Max(4, (int)MathF.Round(width / .17f)); const float gap = .003f;
        float pw = (width - gap * (n - 1)) / n;
        for (int k = 0; k < n; k++)
            Oak(new Vector3(pw, height, Planks), new Transform3D(Basis.Identity, new Vector3(k * (pw + gap) + pw / 2, height / 2, Planks / 2)), Vector3.Up, k * .31f);
        float[] ledges = { .28f, height / 2, height - .28f };
        foreach (float y in ledges)
            Oak(new Vector3(width - .08f, .11f, Ledges), new Transform3D(Basis.Identity, new Vector3(width / 2, y, -Ledges / 2)), Vector3.Right, 1.3f + y * .1f);
        for (int i = 0; i < 2; i++)
        {
            var a = new Vector2(.09f, ledges[i] + .07f); var b = new Vector2(width - .09f, ledges[i + 1] - .07f);
            var d = b - a;
            Oak(new Vector3(d.Length(), .085f, .022f), new Transform3D(new Basis(Vector3.Back, MathF.Atan2(d.Y, d.X)), new Vector3((a.X + b.X) / 2, (a.Y + b.Y) / 2, -.011f)), new Vector3(d.X, d.Y, 0).Normalized(), 1.7f + i * .13f);
        }
        RuienSurround.AddOak(hinge, oak, back, 0, "entrance_leaf");
        var iron = new SurfaceTool(); iron.Begin(Mesh.PrimitiveType.Triangles);
        void Iron(Vector3 size, Vector3 at, float r = .002f, Basis? basis = null) => iron.AppendFrom(BevelMesh.Box(size, r, ironMat), 0, new Transform3D(basis ?? Basis.Identity, at));
        // strap hinges: a knuckle round the pin, the strap along the ledge, a diamond end, dome-headed bolts
        foreach (float y in Straps(height))
        {
            var knob = new SurfaceTool(); knob.CreateFrom(new CylinderMesh { TopRadius = .02f, BottomRadius = .02f, Height = .08f, RadialSegments = 20 }, 0); knob.Deindex();
            iron.AppendFrom(knob.Commit(), 0, new Transform3D(Basis.Identity, new Vector3(0, y, -.012f)));
            float strap = width * .72f;
            Iron(new Vector3(strap, .05f, .007f), new Vector3(strap / 2, y, -Ledges - .0035f));
            Iron(new Vector3(.05f, .05f, .007f), new Vector3(strap, y, -Ledges - .0035f), .002f, new Basis(Vector3.Back, Mathf.Pi / 4));
            for (float x = .08f; x < strap - .02f; x += .14f)
            {
                var head = new SurfaceTool(); head.CreateFrom(new SphereMesh { Radius = .01f, Height = .01f, RadialSegments = 12, Rings = 4, IsHemisphere = true }, 0); head.Deindex();
                iron.AppendFrom(head.Commit(), 0, new Transform3D(new Basis(Vector3.Right, -Mathf.Pi / 2), new Vector3(x, y, -Ledges - .007f)));
            }
        }
        // outside: clout nail heads along the ledges, the ring handle on its plate, the keyhole plate
        foreach (float y in ledges)
            for (float x = .06f; x < width - .03f; x += .13f)
            {
                var head = new SurfaceTool(); head.CreateFrom(new SphereMesh { Radius = .008f, Height = .008f, RadialSegments = 10, Rings = 3, IsHemisphere = true }, 0); head.Deindex();
                iron.AppendFrom(head.Commit(), 0, new Transform3D(new Basis(Vector3.Right, Mathf.Pi / 2), new Vector3(x, y + .025f, Planks)));
                iron.AppendFrom(head.Commit(), 0, new Transform3D(new Basis(Vector3.Right, Mathf.Pi / 2), new Vector3(x + .04f, y - .025f, Planks)));
            }
        float hx = width - .13f;
        Iron(new Vector3(.075f, .075f, .008f), new Vector3(hx, 1.0f, Planks + .004f), .002f);
        for (int i = 0; i < 14; i++)
        {
            float t = i * Mathf.Tau / 14;
            Iron(new Vector3(.024f, .011f, .011f), new Vector3(hx + MathF.Cos(t) * .045f, 1.0f - .045f + MathF.Sin(t) * .045f, Planks + .016f), .004f, new Basis(Vector3.Back, t + Mathf.Pi / 2));
        }
        Iron(new Vector3(.045f, .1f, .005f), new Vector3(hx, 1.16f, Planks + .0025f), .002f);
        Iron(new Vector3(.008f, .022f, .004f), new Vector3(hx, 1.165f, Planks + .006f), .001f);
        RuienStair.Add(hinge, iron, "ruien_iron", false);
    }

    private void Install() => Interact.I?.AddProvider(Keys);
    public override void _ExitTree() => All.Remove(Spec.Id);

    /// <summary>The door's middle (world), for the prompt and the checks.</summary>
    public Vector3 Middle => Spec.World(new Vector3(0, 1.1f, Spec.LeafFace));

    private Offers? Keys(float x, float z)
    {
        var j = Jef.I;
        if (j == null || j.Fly || j.Climbing || j.Frozen) return null;
        var at = Middle;
        float d = new Vector2(x - at.X, z - at.Z).Length();
        if (d > 2.2f || MathF.Abs(j.Y - Spec.Street) > 1.2f) { return Closure(x, z); }
        if (!Known || pending || requested.HasValue || MathF.Abs(Open - (Target ? 1 : 0)) > .01f) return null;
        return new Offers { Options = new() { (d, Act.At(Key.E, Target ? "close the door" : "open the door", at, Press)) } };
    }

    /// <summary>Down at the landing: the closure says why the way on is shut.</summary>
    private Offers? Closure(float x, float z)
    {
        var j = Jef.I!;
        var c = RuienEntrance.ClosureFront(Spec, 0);
        var at = c + Vector3.Up * 1.2f;
        float d = new Vector2(x - c.X, z - c.Z).Length();
        if (d > 1.9f || MathF.Abs(j.Y - c.Y) > 1f) return null;
        bool grille = Spec.Closure == "grille";
        return new Offers
        {
            Options = new()
            {
                (d, Act.At(Key.E, grille ? "try the iron gate" : "look at the new brickwork", at, () => GameState.I.Say(grille
                    ? "The gate is chained and padlocked. Beyond it the passage ends in raw new brick: the way on to the Ruien is closed for works."
                    : "The arch is filled with fresh brick, the mortar still pale. The way on to the Ruien is closed for works.")))
            }
        };
    }

    /// <summary>Someone (Jef) stands where the leaf swings.</summary>
    private bool InSwing()
    {
        var j = Jef.I; if (j == null) return false;
        var q = Spec.Local.AffineInverse() * new Vector3(j.X, j.Y, j.Z);
        var h = hinge.Position;
        return q.X < h.X + LeafWidth + Jef.Radius && q.X > h.X - Jef.Radius && q.Z < h.Z + Planks + Jef.Radius && q.Z > h.Z - LeafWidth - Jef.Radius && q.Y < 2;
    }

    public void Press()
    {
        if (Target && InSwing()) { GameState.I.Say("Step clear of the door to shut it."); return; }
        Set(!Target);
    }

    public void Set(bool open) => requested = open;

    private void Read(JsonElement state)
    {
        pending = false; Target = state.GetProperty("open").GetBoolean();
        if (!Known) { Open = Target ? 1 : 0; Known = true; }
    }

    public override void _PhysicsProcess(double delta)
    {
        poll -= (float)delta;
        var j = Jef.I;
        bool near = j != null && new Vector2(j.X - Spec.Door.X, j.Z - Spec.Door.Y).Length() < 40;
        if (!pending && ServerLink.I?.Api is { } api)
        {
            if (requested is bool open)
            {
                requested = null; pending = true; poll = 1;
                api.Run(api.Post<JsonElement>("api/ruien/hatches/" + Spec.DoorId, new { open }), Read, _ => pending = false);
            }
            else if (poll <= 0 && (near || !Known))
            {
                poll = 1; pending = true; api.Run(api.Get<JsonElement>("api/ruien/hatches/" + Spec.DoorId), Read, _ => pending = false);
            }
        }
        else if (ServerLink.I?.Api == null && requested is bool local)
        {
            // (no world service, a bare scene: the door is the scene's own)
            requested = null; Target = local; Known = true;
        }
        Open = Mathf.MoveToward(Open, Target ? 1 : 0, (float)delta * .85f);
        hinge.Rotation = new Vector3(0, Mathf.DegToRad(OpenDeg) * Mathf.SmoothStep(0, 1, Open), 0);
        // A stair-house's stair (its node "inside") is drawn only while it can be seen: the door open, or the eye in it.
        // Behind the shut house none of it can be seen: no draw calls for it there.
        if (inside != null)
        {
            var eye = GetViewport()?.GetCamera3D()?.GlobalPosition;
            bool show = Open > .001f || eye is Vector3 e && RuienEntrance.Holds(Spec, e);
            if (inside.Visible != show) inside.Visible = show;
        }
    }
    private Node3D? inside;
}
