using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Net;

namespace Scheldemist.World.Ruien;

/// <summary>
/// The folding iron footbridge over a rui channel (#286, #283; docs/ruien-native.md "Fold bridges"). One model for
/// every bridge: two riveted cast and wrought iron leaves, each on a flush knuckle hinge let into a bluestone seat at
/// its side of the mouth, with a worm-gear lifting box worked by a windlass key. The leaves rest down (people cross)
/// and fold up to stand flat in the jamb planes, so Antigoon wades upright through the clear channel between them.
/// - The engine owns it: the shared server state (api/ruien/bridges, NativeRuienBridges) decides when the leaves
///   rise and fall; this node only draws that phase. The rule: a leaf never moves while anyone is on it or in the
///   zone its rails sweep; Antigoon waits short of the mouth until both leaves stand.
/// - Collision is part of each leaf's hinge node, so it turns with the leaf (as the tide doors' does).
/// Frame: the root stands at pivot A on the deck top, +x along the span to pivot B, y up; z across (gear side +/-).
/// </summary>
public partial class RuienFoldBridge : Node3D
{
    public static readonly Dictionary<string, RuienFoldBridge> All = new();
    /// <summary>A phase drawn instead of the server's (proof pictures of the leaves part way up), or null.</summary>
    public static float? ProofPhase;
    /// <summary>The hinge axis below the deck top, and the knuckles' radius: flush hinges let into the seat's groove.</summary>
    public const float AxisDrop = .03f, Knuckle = .028f;
    /// <summary>A leaf's plain heel over the seat (hinge axis to the coping nose), before its girders start.</summary>
    public const float Heel = .18f;
    /// <summary>Where the rails start on a leaf whose pivot stands in a room corner (from the hinge axis).</summary>
    public const float OpenHeel = .55f;
    public RuienData.FoldBridge Spec = null!;
    public RuienData.FoldBridgeKit Kit = null!;
    /// <summary>Drawn phase 0 (down) .. 1 (standing); the server's last phase, target and hold.</summary>
    public float Phase { get; private set; }
    public float ServerPhase { get; private set; }
    public bool Known { get; private set; }
    public bool Raising { get; private set; }
    public bool Held { get; private set; }
    public float Span { get; private set; }
    public float Angle => Mathf.DegToRad(Kit.OpenDeg) * Mathf.SmoothStep(0, 1, Phase);
    private Node3D hingeA = null!, hingeB = null!;
    private float sincePoll;
    private static float poll;
    private static bool pending;
    private static ulong polledFrame;
    /// <summary>The server's giants (the live one, a proof's), for whoever draws them.</summary>
    public static readonly List<(string id, Vector3 at, float yaw, bool waiting)> Giants = new();

    /// <summary>The bridge's root transform: at pivot A on the deck top, +x towards B.</summary>
    public static Transform3D Frame(RuienData.FoldBridge s, RuienData.FoldBridgeKit k)
    {
        var x = new Vector3(s.B.X - s.A.X, 0, s.B.Z - s.A.Z).Normalized();
        var z = x.Cross(Vector3.Up);
        return new Transform3D(new Basis(x, Vector3.Up, z), new Vector3(s.A.X, s.A.Y + k.DeckAbove, s.A.Z));
    }
    public static RuienFoldBridge Build(RuienData.FoldBridge spec, RuienData.FoldBridgeKit kit)
    {
        var b = new RuienFoldBridge { Name = "fold_bridge_" + spec.Id, Spec = spec, Kit = kit, Transform = Frame(spec, kit) };
        b.Span = new Vector2(spec.B.X - spec.A.X, spec.B.Z - spec.A.Z).Length();
        b.Make();
        return b;
    }
    /// <summary>+1 when the gear stands on the frame's +z side.</summary>
    private float GearSign => Spec.Gear.LengthSquared() < .5f || Transform.Basis.Z.Dot(new Vector3(Spec.Gear.X, 0, Spec.Gear.Y)) >= 0 ? 1 : -1;
    /// <summary>A leaf's length from its hinge axis to the meeting joint (12 mm apart).</summary>
    public float LeafLength => Span / 2 - .006f;

    /// <summary>The drawn parts of one bridge shape (span, gear side, open heels), built once: the complete network
    /// has over a hundred bridges of a handful of shapes. Meshes also survive launches in the content cache.</summary>
    private sealed record Model(Mesh[] LeafA, Mesh[] LeafB, Mesh[] Fixed);
    private static readonly Dictionary<string, Model> Models = new();

    private void Make()
    {
        float gs = GearSign, L = LeafLength;
        hingeA = new Node3D { Name = "leaf_a", Position = new Vector3(0, -AxisDrop, 0) };
        hingeB = new Node3D { Name = "leaf_b", Position = new Vector3(Span, -AxisDrop, 0), Rotation = new Vector3(0, Mathf.Pi, 0) };
        AddChild(hingeA); AddChild(hingeB);
        // (a pivot 0.35 to 1.15 m from a room's corner wall: rails from the hinge left no body's width between
        // their ends and that wall, and cut the corner landing off from the walkway along it)
        float RailFrom(bool cover) => Math.Max(cover?Spec.RailStartB:Spec.RailStartA,(cover ? Spec.OpenHeelB : Spec.OpenHeelA) ? OpenHeel : .10f);
        string key = FormattableString.Invariant($"{Span:0.0000}|{gs:0}|{Spec.OpenHeelA}|{Spec.OpenHeelB}|{Kit.RailHalf:0.0000}|{RailFrom(false):0.0000}|{RailFrom(true):0.0000}");
        if (!Models.TryGetValue(key, out var model))
        {
            Model Draw()
            {
                using var timing = Dev.StartupTiming.Measure("ruien.bridge-model.build");
                Mesh[] Drawn(Node3D under, Action draw)
                {
                    // the model keeps the meshes (shared resources), never a node: a node held past the tree's end
                    // is a leak the engine reports as a fault when the game closes
                    draw(); var made = under.GetChildren().OfType<MeshInstance3D>().ToArray();
                    var meshes = made.Select(mi => mi.Mesh).ToArray();
                    foreach (var mi in made) { under.RemoveChild(mi); mi.Free(); }
                    return meshes;
                }
                var leafA = Drawn(hingeA, () => { var iron = new Parts(); Leaf(iron, L, false, RailFrom(false)); iron.Add(hingeA, "ruien_iron"); });
                var leafB = Drawn(hingeB, () => { var iron = new Parts(); Leaf(iron, L, true, RailFrom(true)); iron.Add(hingeB, "ruien_iron"); });
                var fixedParts = Drawn(this, () =>
                {
                    // the fixed parts at both pivots (pivot B's frame is turned half round: its leaf runs towards -x)
                    var stone = new Parts(); var fixedIron = new Parts(); var unused = new List<Vector3>();
                    foreach (var (px, dir) in new[] { (0f, 1f), (Span, -1f) })
                    {
                        // in pivot B's turned frame the gear side is -gs
                        var at = new Transform3D(dir > 0 ? Basis.Identity : new Basis(Vector3.Up, Mathf.Pi), new Vector3(px, 0, 0));
                        Seat(stone, fixedIron, unused, at, dir > 0 ? gs : -gs, dir > 0 ? Spec.OpenHeelA : Spec.OpenHeelB);
                    }
                    stone.Add(this, "ruien_bluestone");
                    fixedIron.Add(this, "ruien_iron");
                });
                return new Model(leafA, leafB, fixedParts);
            }
            Models[key] = model = CachedModel(key, Draw);
        }
        static MeshInstance3D Show(Mesh mesh) => new() { Mesh = mesh, Layers = Ruien.Layer, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
        foreach (var mesh in model.LeafA) hingeA.AddChild(Show(mesh));
        foreach (var mesh in model.LeafB) hingeB.AddChild(Show(mesh));
        foreach (var mesh in model.Fixed) AddChild(Show(mesh));
        Solid(hingeA, LeafSolid(L, RailFrom(false)), "ruien_bridge_" + Spec.Id + "_" + hingeA.Name);
        Solid(hingeB, LeafSolid(L, RailFrom(true)), "ruien_bridge_" + Spec.Id + "_" + hingeB.Name);
        var solid = new List<Vector3>();
        foreach (var (px, dir) in new[] { (0f, 1f), (Span, -1f) })
        {
            var at = new Transform3D(dir > 0 ? Basis.Identity : new Basis(Vector3.Up, Mathf.Pi), new Vector3(px, 0, 0));
            SeatSolid(solid, at, dir > 0 ? gs : -gs, dir > 0 ? Spec.OpenHeelA : Spec.OpenHeelB);
        }
        Solid(this, solid.ToArray(), "ruien_bridge_" + Spec.Id + "_seats");
    }

    /// <summary>A seat's collision: its walking top (over the groove too, where the knuckles fill it) and, unless
    /// the gear lies under a flush cover, the gear box.</summary>
    private static void SeatSolid(List<Vector3> solid, Transform3D at, float g, bool flush)
    {
        const float top = -.012f, bed = -.112f, back = -.32f, front = Heel - .004f;
        float near = -.42f * g, far = .62f * g, zc = .495f * g;
        BoxFaces(solid, at * Mid(back, front, bed, top, Math.Min(near, far), Math.Max(near, far)));
        if (!flush) BoxFaces(solid, at * Mid(-.11f, .11f, top, .35f, zc - .085f, zc + .085f));
    }

    private void Solid(Node3D at, Vector3[] faces, string name)
    {
        var body = new StaticBody3D { Name = name, CollisionLayer = Scheldemist.World.Solid.Layer, CollisionMask = 0 };
        body.AddChild(new CollisionShape3D { Shape = new ConcavePolygonShape3D { Data = faces, BackfaceCollision = true } });
        at.AddChild(body);
    }

    // ------------------------------------------------------------------ the leaf (hinge frame: x from the axis to the
    // meeting joint, y up with the deck top at +AxisDrop, z across)
    private static float DeckY(float y) => y + AxisDrop;
    /// <summary>The girders' underside below the deck top at x: deepest at the heel (a cantilever), shallow at the tip.</summary>
    public static float GirderBottom(float x, float L) => -.21f + .085f * Math.Clamp((x - Heel) / Math.Max(L - Heel, .1f), 0, 1);
    private static readonly Color Bloom = new(.30f, .07f, .22f, 0), Salt = new(.22f, .11f, .12f, 0), Sooty = new(.28f, .03f, .32f, 0);

    private void Leaf(Parts p, float L, bool cover, float railFrom)
    {
        float W = .36f, girder = .29f, rail = Kit.RailHalf;
        // flush knuckle hinge: the leaf's three knuckles (the seat holds the two between), forged straps under the plate
        foreach (var (z0, z1) in Knuckles(true))
        {
            p.Tube(new Vector3(0, 0, z0), new Vector3(0, 0, z1), Knuckle, 20, .0015f, Bloom, .55f);
            p.Box(new Vector3(.04f, DeckY(-.022f), (z0 + z1) / 2), new Vector3(.07f, .022f, z1 - z0 - .01f), .002f, Bloom, .6f);
        }
        // the chequer plate deck, its raised bars and the rivets over the girders and edge angles
        p.Box(new Vector3((.016f + L) / 2, DeckY(-.005f), 0), new Vector3(L - .016f, .010f, 2 * W), .002f, Sooty, .9f);
        for (float x = .06f; x < L - .03f; x += .085f)
            p.Box(new Vector3(x, DeckY(.0012f), 0), new Vector3(.012f, .0028f, 2 * W - .1f), .001f, Salt, .95f);
        foreach (float z in new[] { -girder, girder, -W + .022f, W - .022f })
            for (float x = Heel + .04f; x < L - .02f; x += .1f)
                p.Box(new Vector3(x, DeckY(.002f), z), new Vector3(.016f, .006f, .016f), .0028f, Bloom, .9f);
        // toe boards along both edges (flat bar standing 5 cm proud), bolted to the plate's edge angle
        foreach (float s in new[] { -1f, 1f })
        {
            p.Box(new Vector3((.03f + L - .01f) / 2, DeckY(.005f), s * (W - .005f)), new Vector3(L - .04f, .09f, .010f), .0015f, Bloom, .8f);
            p.Box(new Vector3((.03f + L - .01f) / 2, DeckY(-.03f), s * (W - .03f)), new Vector3(L - .04f, .010f, .05f), .0015f, Sooty, .6f);
        }
        // two riveted plate girders, deep at the heel, with flanges, end plates, stiffeners and three cross girders
        foreach (float s in new[] { -1f, 1f })
        {
            float z = s * girder, x0 = Heel + .012f, x1 = L - .01f, b0 = GirderBottom(x0, L), b1 = GirderBottom(x1, L);
            p.Prism(new[] { new Vector2(x0, DeckY(-.022f)), new Vector2(x1, DeckY(-.022f)), new Vector2(x1, DeckY(b1 + .012f)), new Vector2(x0, DeckY(b0 + .012f)) }, z - .006f, z + .006f, .0015f, Sooty, .55f);
            p.Box(new Vector3((x0 + x1) / 2, DeckY(-.016f), z), new Vector3(x1 - x0, .012f, .09f), .002f, Sooty, .6f);
            p.Prism(new[] { new Vector2(x0, DeckY(b0)), new Vector2(x1, DeckY(b1)), new Vector2(x1, DeckY(b1 + .012f)), new Vector2(x0, DeckY(b0 + .012f)) }, z - .04f, z + .04f, .0015f, Bloom, .5f);
            p.Box(new Vector3(x0 - .006f, DeckY((b0 - .01f) / 2), z), new Vector3(.012f, -b0 + .01f, .1f), .002f, Bloom, .55f);
            for (float x = x0 + .3f; x < x1 - .1f; x += .34f)
            {
                float bot = GirderBottom(x, L) + .012f, h = -.022f - bot;
                foreach (float o in new[] { -1f, 1f })
                    p.Box(new Vector3(x, DeckY(bot + h / 2), z + o * .022f), new Vector3(.010f, h - .002f, .032f), .0015f, Bloom, .5f);
                for (int k = 0; k < 3; k++)
                    p.Box(new Vector3(x + .03f, DeckY(bot + h * (k + .5f) / 3), z + s * .009f), new Vector3(.016f, .016f, .006f), .0028f, Salt, .6f);
            }
        }
        foreach (float x in new[] { Heel + .16f, (Heel + L) / 2, L - .07f })
        {
            float bot = Math.Max(GirderBottom(x, L) + .05f, -.12f);
            p.Box(new Vector3(x, DeckY((-.022f + bot) / 2), 0), new Vector3(.010f, -.022f - bot, 2 * girder - .012f), .0015f, Sooty, .45f);
            p.Box(new Vector3(x, DeckY(bot + .005f), 0), new Vector3(.05f, .010f, 2 * girder - .012f), .0015f, Sooty, .45f);
        }
        // the hand rails: round posts in cast shoes outside the toe boards, two rails (the R2 edge rail's sizes)
        int n = Math.Max(2, (int)MathF.Ceiling((L - .06f - railFrom) / .75f) + 1);
        var posts = Enumerable.Range(0, n).Select(i => railFrom + (L - .06f - railFrom) * i / (n - 1)).ToArray();
        foreach (float s in new[] { -1f, 1f })
        {
            float z = s * rail;
            for (int i = 0; i < n; i++)
            {
                float r = i == n - 1 ? .023f : .019f, x = posts[i];
                p.Box(new Vector3(x, DeckY(.0f), s * (W + .008f)), new Vector3(.07f, .10f, .016f), .003f, Bloom, .75f);
                foreach (float dx in new[] { -.025f, .025f }) p.Box(new Vector3(x + dx, DeckY(-.02f), s * (W + .018f)), new Vector3(.016f, .016f, .006f), .0028f, Salt, .8f);
                p.Tube(new Vector3(x, DeckY(-.04f), z), new Vector3(x, DeckY(1.0f), z), r, 12, .002f, Bloom, .85f);
                p.Ball(new Vector3(x, DeckY(1.0f + r * .8f), z), r * 1.35f, Bloom, .9f);
                foreach (float hy in new[] { .5f }) p.Tube(new Vector3(x, DeckY(hy - .025f), z), new Vector3(x, DeckY(hy + .025f), z), r + .007f, 12, .002f, Salt, .85f);
            }
            foreach (float hy in new[] { .5f, 1.0f })
                p.Tube(new Vector3(posts[0], DeckY(hy), z), new Vector3(posts[^1], DeckY(hy), z), .016f, 10, .002f, Bloom, .85f);
        }
        // pivot B's leaf carries the meeting strip over leaf A's end, bolted down with two countersunk heads
        if (cover)
        {
            p.Box(new Vector3(L + .006f, DeckY(.003f), 0), new Vector3(.08f, .006f, 2 * W - .12f), .0015f, Salt, .9f);
            foreach (float z in new[] { -.18f, .18f }) p.Box(new Vector3(L - .02f, DeckY(.0068f), z), new Vector3(.018f, .0016f, .018f), .0007f, Bloom, .9f);
        }
    }

    /// <summary>The leaf's collision: the deck, its girders and one slab along each rail (as R2: the bars carry none).</summary>
    private Vector3[] LeafSolid(float L, float railFrom)
    {
        var f = new List<Vector3>();
        BoxFaces(f, new Vector3((.02f + L) / 2, DeckY(-.015f), 0), new Vector3(L - .02f, .03f, .74f));
        BoxFaces(f, new Vector3((Heel + L) / 2, DeckY(-.11f), 0), new Vector3(L - Heel, .19f, .66f));
        foreach (float s in new[] { -1f, 1f }) BoxFaces(f, new Vector3((railFrom - .02f + L - .03f) / 2, DeckY(.55f), s * Kit.RailHalf), new Vector3(L - .03f - (railFrom - .02f), 1.1f, .04f));
        return f.ToArray();
    }

    /// <summary>The knuckles along the hinge: five equal ones over the deck's width, the leaf's at both ends and the middle.</summary>
    private static IEnumerable<(float z0, float z1)> Knuckles(bool leaf)
    {
        const float W = .36f, k = 2 * W / 5, gap = .0015f;
        for (int i = 0; i < 5; i++) if ((i % 2 == 0) == leaf) yield return (-W + i * k + gap, -W + (i + 1) * k - gap);
    }

    // ------------------------------------------------------------------ a pivot's seat (pivot frame, deck coordinates:
    // the leaf runs towards +x, the axis at (0, -AxisDrop), gear side g = +1/-1 on z)
    private void Seat(Parts stone, Parts iron, List<Vector3> solid, Transform3D at, float g, bool flush = false)
    {
        const float top = -.012f, bed = -.112f, groove = .04f, floor = -.075f, back = -.32f, front = Heel - .004f;
        float near = -.42f * g, far = .62f * g, gear = .58f * g;
        float zLo = Math.Min(near, far), zHi = Math.Max(near, far);
        stone.Xf = iron.Xf = at;
        // the dressed bluestone seat, cut by the hinge groove (which runs on under the gear box)
        stone.Box(Mid(back, -groove, bed, top, zLo, zHi), .010f, new Color(.18f, .02f, .30f, 0), .8f);
        stone.Box(Mid(groove, front, bed, top, zLo, zHi), .010f, new Color(.24f, .02f, .34f, 0), .75f);
        float gLo = Math.Min(-.37f * g, gear), gHi = Math.Max(-.37f * g, gear);
        stone.Box(Mid(-groove - .002f, groove + .002f, bed, floor, gLo, gHi), .004f, new Color(.55f, .02f, .55f, 0), .35f);
        foreach (var (a, b) in new[] { (Math.Min(near, -.37f * g), Math.Max(near, -.37f * g)), (Math.Min(gear, far), Math.Max(gear, far)) })
            stone.Box(Mid(-groove - .002f, groove + .002f, bed, top, a, b), .008f, new Color(.2f, .02f, .3f, 0), .7f);
        // the fixed knuckles on their saddles, and the hinge pin with machined flat ends
        foreach (var (z0, z1) in Knuckles(false))
        {
            iron.Tube(new Vector3(0, -AxisDrop, z0), new Vector3(0, -AxisDrop, z1), Knuckle, 20, .0015f, Bloom, .55f);
            iron.Box(Mid(-.03f, .03f, floor, -AxisDrop, z0 + .004f, z1 - .004f), .002f, Sooty, .35f);
        }
        iron.Tube(new Vector3(0, -AxisDrop, -.372f * g), new Vector3(0, -AxisDrop, .41f * g), .012f, 12, 0, Salt, .5f);
        // the lifting box: a cast worm-gear case over the pin's end, its neck in the groove, a windlass socket on top,
        // its base flange held down by four dome-headed bolts leaded into the stone
        float zc = .495f * g;
        iron.Box(Mid(-.035f, .035f, floor, top, zc - .075f, zc + .075f), .003f, Sooty, .4f);
        iron.Tube(new Vector3(0, -AxisDrop, .372f * g), new Vector3(0, -AxisDrop, .42f * g), .022f, 16, .002f, Bloom, .45f);
        if (flush)
        {
            // An open heel stands where people turn the corner beside the pivot: its worm gear lies in a pit under
            // a cast cover let flush into the seat, the windlass socket a low boss in its middle. Nothing to walk into.
            iron.Box(Mid(-.11f, .11f, top, top + .008f, zc - .085f, zc + .085f), .003f, Sooty, .8f);
            iron.Box(Mid(-.09f, .09f, top + .008f, top + .011f, zc - .065f, zc + .065f), .0015f, Bloom, .85f);
            iron.Box(new Vector3(0, top + .017f, zc), new Vector3(.05f, .012f, .05f), .003f, Bloom, .9f);
            iron.Box(new Vector3(0, top + .0245f, zc), new Vector3(.03f, .003f, .03f), .001f, Sooty, .5f);
            foreach (float x in new[] { -.095f, .095f })
                foreach (float dz in new[] { -.07f, .07f })
                    iron.Box(new Vector3(x, top + .011f, zc + dz), new Vector3(.02f, .007f, .02f), .003f, Salt, .8f);
            return;
        }
        iron.Box(Mid(-.11f, .11f, top, top + .018f, zc - .085f, zc + .085f), .004f, Bloom, .7f);
        iron.Box(Mid(-.085f, .085f, top + .018f, .19f, zc - .07f, zc + .07f), .005f, Bloom, .75f);
        iron.Box(Mid(-.075f, .075f, .19f, .205f, zc - .06f, zc + .06f), .004f, Salt, .85f);
        // the worm wheel's round side cover, bolted on outboard; the case's bolted joint faces the deck
        iron.Tube(new Vector3(0, .09f, zc + .068f * g), new Vector3(0, .09f, zc + .098f * g), .075f, 24, .004f, Bloom, .7f);
        for (int i = 0; i < 6; i++)
        {
            float ang = Mathf.Tau * i / 6;
            iron.Box(new Vector3(.058f * MathF.Cos(ang), .09f + .058f * MathF.Sin(ang), zc + .1f * g), new Vector3(.014f, .014f, .006f), .0021f, Salt, .8f);
        }
        for (int i = 0; i < 4; i++)
            iron.Box(new Vector3(.068f * (i < 2 ? -1 : 1), .04f + .12f * (i % 2), zc - .0715f * g), new Vector3(.016f, .016f, .005f), .0024f, Salt, .8f);
        iron.Tube(new Vector3(0, .205f, zc), new Vector3(0, .33f, zc), .018f, 12, .002f, Salt, .85f);
        iron.Box(new Vector3(0, .345f, zc), new Vector3(.032f, .032f, .032f), .003f, Bloom, .9f);
        iron.Box(new Vector3(0, .212f, zc), new Vector3(.05f, .014f, .05f), .003f, Bloom, .85f);
        foreach (float x in new[] { -.095f, .095f })
            foreach (float dz in new[] { -.07f, .07f })
            {
                iron.Box(new Vector3(x, top + .023f, zc + dz), new Vector3(.024f, .010f, .024f), .004f, Salt, .8f);
                iron.Box(new Vector3(x, top + .001f, zc + dz), new Vector3(.036f, .003f, .036f), .0008f, new Color(.4f, .25f, .2f, 0), .7f);
            }
    }

    private static Transform3D Mid(float x0, float x1, float y0, float y1, float z0, float z1)
        => new(Basis.Identity.Scaled(new Vector3(Math.Abs(x1 - x0), Math.Abs(y1 - y0), Math.Abs(z1 - z0))), new Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2));
    private static void BoxFaces(List<Vector3> f, Vector3 centre, Vector3 size) => BoxFaces(f, new Transform3D(Basis.Identity.Scaled(size), centre));
    private static void BoxFaces(List<Vector3> f, Transform3D xf)
    {
        var c = new Vector3[8];
        for (int i = 0; i < 8; i++) c[i] = xf * new Vector3((i & 1) - .5f, ((i >> 1) & 1) - .5f, ((i >> 2) & 1) - .5f);
        int[][] q = { new[] { 0, 2, 3, 1 }, new[] { 4, 5, 7, 6 }, new[] { 0, 1, 5, 4 }, new[] { 2, 6, 7, 3 }, new[] { 0, 4, 6, 2 }, new[] { 1, 3, 7, 5 } };
        foreach (var k in q) { f.Add(c[k[0]]); f.Add(c[k[1]]); f.Add(c[k[2]]); f.Add(c[k[0]]); f.Add(c[k[2]]); f.Add(c[k[3]]); }
    }

    // ------------------------------------------------------------------ the shared state, drawn
    public override void _Ready() => All[Spec.Id] = this;
    public override void _ExitTree() => All.Remove(Spec.Id);
    public override void _PhysicsProcess(double delta)
    {
        float dt = (float)delta;
        sincePoll += dt;
        if (polledFrame != Engine.GetPhysicsFrames())
        {
            polledFrame = Engine.GetPhysicsFrames();
            poll -= dt;
            if (!pending && poll <= 0 && ServerLink.I?.Api is { } api)
            {
                pending = true; poll = .25f;
                api.Run(api.Get<JsonElement>("api/ruien/bridges"), Read, _ => pending = false);
            }
        }
        float rate = dt / Kit.RaiseSeconds;
        // between polls the server's phase runs on at the same rate, unless a leaf waits
        float predicted = Held ? ServerPhase : Math.Clamp(ServerPhase + (Raising ? 1 : -1) * sincePoll / Kit.RaiseSeconds, 0, 1);
        float now = ProofPhase ?? (Known ? Mathf.MoveToward(Phase, predicted, rate * 1.5f + Math.Abs(predicted - Phase) * dt * 2) : 0);
        if (now == Phase && Known) return;
        Phase = now;
        hingeA.Rotation = new Vector3(0, 0, Angle);
        hingeB.Rotation = new Vector3(0, Mathf.Pi, Angle);
    }
    private static void Read(JsonElement state)
    {
        pending = false;
        foreach (var b in state.GetProperty("bridges").EnumerateArray())
            if (All.TryGetValue(b.GetProperty("id").GetString()!, out var bridge))
            {
                bridge.ServerPhase = b.GetProperty("phase").GetSingle();
                bridge.Raising = b.GetProperty("raising").GetBoolean();
                bridge.Held = b.GetProperty("held").GetBoolean();
                bridge.sincePoll = 0;
                if (!bridge.Known) { bridge.Phase = bridge.ServerPhase; bridge.Known = true; bridge.hingeA.Rotation = new Vector3(0, 0, bridge.Angle); bridge.hingeB.Rotation = new Vector3(0, Mathf.Pi, bridge.Angle); }
            }
        Giants.Clear();
        if (state.TryGetProperty("giants", out var gs))
            foreach (var g in gs.EnumerateArray())
                Giants.Add((g.GetProperty("id").GetString()!, new Vector3(g.GetProperty("x").GetSingle(), g.GetProperty("y").GetSingle(), g.GetProperty("z").GetSingle()), g.GetProperty("yaw").GetSingle(), g.GetProperty("waiting").GetBoolean()));
    }

    // ------------------------------------------------------------------ mesh building: closed, bevelled, metric UVs
    /// <summary>
    /// Closed bevelled parts in one stream: boxes (BevelMesh), chamfered prisms, tubes with chamfered ends and balls.
    /// UVs are metres projected on each face's own plane (tubes: arc length by length), divided by the family's tile
    /// in RuienStair.Add; weather colour (R wet, G salts, B soot) and occlusion per part.
    /// </summary>
    public sealed class Parts
    {
        private readonly SurfaceTool st = new();
        public Transform3D Xf = Transform3D.Identity;
        public int Triangles { get; private set; }
        public Parts() { st.Begin(Mesh.PrimitiveType.Triangles); st.SetCustomFormat(0, SurfaceTool.CustomFormat.Rgba8Unorm); }
        private void V(Vector3 p, Vector3 n, Vector2 uv, Color c, float ao)
        { st.SetNormal(n); st.SetUV(uv); st.SetColor(c); st.SetCustom(0, new Color(0, 0, 0, ao)); st.AddVertex(p); }
        /// <summary>A flat triangle (world positions), UVs projected on its own plane in metres.</summary>
        private void Tri(Vector3 a, Vector3 b, Vector3 c, Color w, float ao)
        {
            var n = (c - a).Cross(b - a); // (Godot's front faces wind clockwise seen from outside)
            if (n.LengthSquared() < 1e-14f) return;
            n = n.Normalized();
            var u = n.Cross(Math.Abs(n.Y) < .8f ? Vector3.Up : Vector3.Right).Normalized(); var v = n.Cross(u);
            Vector2 P(Vector3 q) => new(q.Dot(u), q.Dot(v));
            V(a, n, P(a), w, ao); V(b, n, P(b), w, ao); V(c, n, P(c), w, ao); Triangles++;
        }
        public void Box(Vector3 centre, Vector3 size, float bevel, Color w, float ao) => Box(new Transform3D(Basis.Identity, centre), size, bevel, w, ao);
        /// <summary>A unit box scaled by xf's basis (from <see cref="Mid"/>).</summary>
        public void Box(Transform3D unit, float bevel, Color w, float ao)
        {
            var size = unit.Basis.Scale;
            Box(new Transform3D(Basis.Identity, unit.Origin), size, bevel, w, ao);
        }
        private void Box(Transform3D at, Vector3 size, float bevel, Color w, float ao)
        {
            var a = Scheldemist.Models.BevelMesh.Box(size, bevel, null!).SurfaceGetArrays(0);
            var p = a[(int)Mesh.ArrayType.Vertex].AsVector3Array();
            for (int i = 0; i + 2 < p.Length; i += 3) Tri(Xf * (at * p[i]), Xf * (at * p[i + 1]), Xf * (at * p[i + 2]), w, ao);
        }
        /// <summary>A convex polygon in x-y (counter-clockwise or not) extruded from z0 to z1, every edge chamfered by b.</summary>
        public void Prism(Vector2[] poly, float z0, float z1, float b, Color w, float ao)
        {
            if (Signed(poly) < 0) poly = poly.Reverse().ToArray();
            // corners cut in plan, then the cap outline inset by b: a chamfer band joins it to the side faces
            var cut = new List<Vector2>();
            for (int i = 0; i < poly.Length; i++)
            {
                var p0 = poly[(i + poly.Length - 1) % poly.Length]; var p1 = poly[i]; var p2 = poly[(i + 1) % poly.Length];
                float s = Math.Min(b, Math.Min(p1.DistanceTo(p0), p1.DistanceTo(p2)) * .3f);
                cut.Add(p1 + (p0 - p1).Normalized() * s); cut.Add(p1 + (p2 - p1).Normalized() * s);
            }
            var inset = Inset(cut.ToArray(), b);
            Vector3 P(Vector2 q, float z) => Xf * new Vector3(q.X, q.Y, z);
            int n = cut.Count;
            for (int i = 0; i < n; i++)
            {
                int j = (i + 1) % n;
                Quad(P(cut[i], z0 + b), P(cut[j], z0 + b), P(cut[j], z1 - b), P(cut[i], z1 - b), w, ao);
                Quad(P(inset[i], z0), P(inset[j], z0), P(cut[j], z0 + b), P(cut[i], z0 + b), w, ao);
                Quad(P(cut[i], z1 - b), P(cut[j], z1 - b), P(inset[j], z1), P(inset[i], z1), w, ao);
            }
            for (int i = 1; i + 1 < n; i++)
            {
                Tri(P(inset[0], z0), P(inset[i], z0), P(inset[i + 1], z0), w, ao);
                Tri(P(inset[0], z1), P(inset[i + 1], z1), P(inset[i], z1), w, ao);
            }
        }
        private static float Signed(Vector2[] p) { float a = 0; for (int i = 0; i < p.Length; i++) a += p[i].Cross(p[(i + 1) % p.Length]); return a; }
        private static Vector2[] Inset(Vector2[] p, float d)
        {
            var o = new Vector2[p.Length];
            for (int i = 0; i < p.Length; i++)
            {
                var e0 = (p[i] - p[(i + p.Length - 1) % p.Length]).Normalized(); var e1 = (p[(i + 1) % p.Length] - p[i]).Normalized();
                var n0 = new Vector2(-e0.Y, e0.X); var n1 = new Vector2(-e1.Y, e1.X);
                var m = (n0 + n1).Normalized(); float c = Math.Max(m.Dot(n0), .3f);
                o[i] = p[i] + m * (d / c);
            }
            return o;
        }
        private void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color w, float ao)
        {
            // a, b, c, d run counter-clockwise seen from outside: two triangles wound the other way (Godot's front)
            Tri(a, c, b, w, ao); Tri(a, d, c, w, ao);
        }
        /// <summary>A closed round bar from a to b, its ends chamfered by e (flat machined faces inside the chamfer).</summary>
        public void Tube(Vector3 a, Vector3 b, float r, int sides, float e, Color w, float ao)
        {
            a = Xf * a; b = Xf * b;
            var axis = (b - a); float len = axis.Length(); axis /= len;
            var u = axis.Cross(Math.Abs(axis.Y) < .9f ? Vector3.Up : Vector3.Right).Normalized(); var v = axis.Cross(u);
            e = Math.Min(e, Math.Min(r * .4f, len * .2f));
            var rings = new (float t, float rad)[] { (0, r - e), (e, r), (len - e, r), (len, r - e) };
            Vector3 R(int k, int i) { float ang = Mathf.Tau * i / sides; return a + axis * rings[k].t + (u * MathF.Cos(ang) + v * MathF.Sin(ang)) * rings[k].rad; }
            for (int k = 0; k < 3; k++)
                for (int i = 0; i < sides; i++)
                {
                    int j = (i + 1) % sides;
                    Vector3 p00 = R(k, i), p01 = R(k, j), p10 = R(k + 1, i), p11 = R(k + 1, j);
                    // smooth round the bar, flat on the chamfers: the side band takes radial normals
                    if (k == 1) SmoothQuad(p00, p01, p11, p10, a, axis, rings[1].t, r, Mathf.Tau * i / sides, Mathf.Tau * j / sides, w, ao);
                    else { Tri(p00, p11, p01, w, ao); Tri(p00, p10, p11, w, ao); }
                }
            var c0 = a; var c1 = a + axis * len;
            for (int i = 0; i < sides; i++)
            {
                int j = (i + 1) % sides;
                Tri(c0, R(0, i), R(0, j), w, ao);
                Tri(c1, R(3, j), R(3, i), w, ao);
            }
        }
        private void SmoothQuad(Vector3 p00, Vector3 p01, Vector3 p11, Vector3 p10, Vector3 a, Vector3 axis, float t0, float r, float ang0, float ang1, Color w, float ao)
        {
            Vector3 N(Vector3 p) { var d = p - a; return (d - axis * d.Dot(axis)).Normalized(); }
            Vector2 UV(Vector3 p, float ang) => new(ang * r, (p - a).Dot(axis));
            void One(Vector3 p, float ang) => V(p, N(p), UV(p, ang), w, ao);
            One(p00, ang0); One(p11, ang1); One(p01, ang1);
            One(p00, ang0); One(p10, ang0); One(p11, ang1);
            Triangles += 2;
        }
        /// <summary>A ball (finial), as a closed low sphere.</summary>
        public void Ball(Vector3 c, float r, Color w, float ao)
        {
            c = Xf * c;
            const int lon = 14, lat = 8;
            Vector3 S(int i, int k) { float th = Mathf.Pi * k / lat - Mathf.Pi / 2, ph = Mathf.Tau * i / lon; return c + new Vector3(MathF.Cos(th) * MathF.Cos(ph), MathF.Sin(th), MathF.Cos(th) * MathF.Sin(ph)) * r; }
            for (int k = 0; k < lat; k++)
                for (int i = 0; i < lon; i++)
                {
                    int j = (i + 1) % lon;
                    var p = new[] { S(i, k), S(j, k), S(j, k + 1), S(i, k + 1) };
                    for (int t = 0; t < 2; t++)
                    {
                        var tri = t == 0 ? new[] { p[0], p[1], p[2] } : new[] { p[0], p[2], p[3] };
                        if ((tri[1] - tri[0]).Cross(tri[2] - tri[0]).LengthSquared() < 1e-14f) continue;
                        foreach (var q in tri) V(q, (q - c).Normalized(), new Vector2(MathF.Atan2(q.Z - c.Z, q.X - c.X) * r, (q.Y - c.Y)), w, ao);
                        Triangles++;
                    }
                }
        }
        public void Add(Node3D root, string family) => RuienStair.Add(root, st, family, false);
    }
}
