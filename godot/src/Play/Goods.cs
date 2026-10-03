using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Render;
using Scheldemist.World;

namespace Scheldemist.Play;

/// <summary>One liftable thing in the world: the server's facts and the node that shows it here.</summary>
public sealed class Item
{
    /// <summary>What the server last said of it (or what this game did to it a moment ago, until the server answers).</summary>
    public GoodsItem S = new();
    public string Id => S.Id;
    public string Kind => S.Kind;
    public int? JobId => S.Job;
    public float X => (float)S.X;
    public float Z => (float)S.Z;
    public float Y => (float)S.Y;
    public bool Broken => S.Broken == true;
    public bool Heavy => S.Heavy == true;
    public bool CartOnly => S.CartOnly == true;
    /// <summary>Its model here; null: it lies in the bake's merged heaps and cannot be shown apart yet.</summary>
    public Node3D? Obj;
    internal CollisionShape3D? Shape;
    /// <summary>Where it was lifted from, and when (an owner calms down when it is put back).</summary>
    public (float X, float Z, ulong T)? LiftedFrom;
}

/// <summary>
/// The goods of the quays (game/goods.ts GoodsWorld, M8f): the server keeps the list, this draws it and asks the
/// server to lift, put down and hand over. The game shows a lift at once and undoes it when the server says no.
///
/// What is drawn: a job's goods and the town's plain crates, barrels and fish boxes. Their models are the bake's
/// own nodes (`goods &lt;id&gt;`, taken over by name) or copies of them; kinds the bake has no single node of (a sack, a
/// coil of rope, hides, a chest, a parcel) are plain stand-ins until the model files are decoded
/// (tools/godot/models.mjs). The casks, big crates and sacks of the quay heaps lie in the bake's merged meshes
/// (goods_casks, goods_sacks, quaygoods): they stay scenery, solid, and are not offered to lift yet.
/// A lying item is solid (a box on Solid's layer); in Jef's hands it hangs before the camera as in the browser
/// (props.ts hold), he walks slower and cannot jump (Jef.Laden).
/// </summary>
[GamePart(64)]
public partial class Goods : Node
{
    public static Goods I { get; private set; } = null!;

    public const float ReachItem = 1.8f;

    private readonly Dictionary<string, Item> all = new();
    private readonly Dictionary<string, Node3D> baked = new();
    private Node3D root = null!;
    private Node3D? crate, barrel;
    private int v;
    /// <summary>This player's number on the server.</summary>
    public int Me { get; private set; } = 1;
    public bool Loaded { get; private set; }
    public Item? Carried { get; private set; }
    public string LastRefusal { get; private set; } = "";
    public IEnumerable<Item> Items => all.Values.Where(i => i.S.Lies);
    public IReadOnlyDictionary<string, Item> All => all;

    /// <summary>The server took it out of Jef's hands (refused the lift, someone was quicker): the item and why.</summary>
    public event Action<Item, string>? Lost;
    /// <summary>Another's deed: an item put down near, or let go into the Schelde (item, "put" or "sunk", where).</summary>
    public event Action<Item, string, Vector2?>? Other;

    public Goods()
    {
        I = this;
        // the bake's single goods are lifted and set down: their solid boxes come from here
        Solid.Leave.Add(n => n.Name.ToString().StartsWith("goods ", StringComparison.Ordinal));
    }

    public override void _Ready()
    {
        root = new Node3D { Name = "goods_live" };
        Main.I.View.AddChild(root);
        foreach (var n in BakedWorld.All(Main.I.World))
            if (n is Node3D n3 && n.Name.ToString().StartsWith("goods ", StringComparison.Ordinal))
                baked[n.Name.ToString()] = n3;
        crate = baked.FirstOrDefault(k => k.Key.StartsWith("goods own_sooi", StringComparison.Ordinal)).Value;
        barrel = baked.FirstOrDefault(k => k.Key.StartsWith("goods own_peeters", StringComparison.Ordinal) || k.Key.StartsWith("goods own_tuur", StringComparison.Ordinal)).Value;
        Doors.I.HandsFull = () => Carried != null;
        ServerLink.I?.WhenUp(() =>
        {
            ServerLink.I.Api!.OtherPushed += OnPush;
            Load();
        });
    }

    // ------------------------------------------------------------------ the server's list

    private int tries;

    /// <summary>The whole list from the server (at the start, and after the push line came back).</summary>
    public void Load()
    {
        var api = ServerLink.I?.Api;
        if (api == null) return;
        api.Run(api.Goods<GoodsList>(), l =>
        {
            Me = l.You;
            Full(l.Items, l.V);
            Loaded = true;
            GD.Print($"goods: {all.Count} items from the server, {all.Values.Count(i => i.Obj != null)} shown here, {baked.Count} single goods in the bake");
        }, e =>
        {
            if (++tries < 6) GetTree().CreateTimer(tries).Timeout += Load;
            else GD.PrintErr($"goods: the list did not come: {e.Message}");
        });
    }

    private void Full(List<GoodsItem> items, int version)
    {
        var keep = items.Select(i => i.Id).ToHashSet();
        foreach (string id in all.Keys.Where(k => !keep.Contains(k)).ToList()) Forget(id, "");
        foreach (var s in items.OrderBy(i => i.Y)) Apply(s, true, "");
        v = version;
        // a single node of the bake the server no longer has (sold, sunk in an older game): not shown
        foreach (var (name, node) in baked)
            if (node.GetParent() != root && !all.Values.Any(i => i.Obj == node))
                node.Visible = false;
    }

    private void OnPush(PushMsg m)
    {
        if (m.Type == "resync")
        {
            Load();
            return;
        }
        if (m.Type != "goods") return;
        GoodsPush? p;
        try
        {
            p = m.Body.Deserialize<GoodsPush>(Api.Json);
        }
        catch (JsonException)
        {
            return;
        }
        if (p == null) return;
        if (p.Full == true)
        {
            Full(p.Items, p.V);
            return;
        }
        if (p.V != v + 1 && Loaded)
        {
            // one was missed: the whole list again
            if (p.V > v + 1) Load();
            if (p.V <= v) return;
        }
        v = p.V;
        int? who = p.Who is { ValueKind: JsonValueKind.Object } w && w.TryGetProperty("p", out var wp) && wp.ValueKind == JsonValueKind.Number ? wp.GetInt32() : null;
        foreach (var s in p.Items)
        {
            var it = Apply(s, false, p.Why);
            if (it != null && p.Why == "put" && who != Me) Other?.Invoke(it, "put", null);
        }
        foreach (string id in p.Gone)
        {
            if (all.TryGetValue(id, out var it) && p.Why == "sunk" && who != Me && p.At is { Length: 2 } at) Other?.Invoke(it, "sunk", new Vector2((float)at[0], (float)at[1]));
            Forget(id, p.Why);
        }
    }

    /// <summary>Can this item be shown here as a thing of its own (see the class's words)?</summary>
    private bool Showable(GoodsItem s)
    {
        if (baked.ContainsKey(Spots.BakedName("goods " + s.Id))) return true;
        if (!string.IsNullOrEmpty(s.Look)) return false;
        // the town's own sacks lie in the bake's merged heap; a job's are new
        if (s.Kind == "sacks") return s.Id.StartsWith("job:", StringComparison.Ordinal) || s.Id.StartsWith("spawn:", StringComparison.Ordinal);
        return GoodsRules.Info.ContainsKey(s.Kind);
    }

    private Item? Apply(GoodsItem s, bool force, string why)
    {
        bool isNew = !all.TryGetValue(s.Id, out var it);
        if (!isNew && !force && s.Rev < it!.S.Rev) return it;
        if (isNew)
        {
            it = new Item { S = s };
            all[s.Id] = it;
            if (Showable(s)) it.Obj = Model(s);
        }
        bool wasMine = Carried == it;
        it!.S = s;
        if (s.Lies)
        {
            if (wasMine) Release();
            Lay(it);
        }
        else if (s.ByPlayer == Me) ToHands(it);
        else
        {
            if (wasMine) Release();
            ToHeld(it);
        }
        if (wasMine && Carried != it) Lost?.Invoke(it, why == "" || why == "lift" || why == "put" ? "Someone was quicker." : why);
        return it;
    }

    private void Forget(string id, string why)
    {
        if (!all.Remove(id, out var it)) return;
        if (Carried == it)
        {
            Release();
            if (why != "" && why != "handed" && why != "sold" && why != "sunk" && why != "end") Lost?.Invoke(it, why == "taken" || why == "snatched" ? "" : why);
        }
        if (it.Obj != null && !sinking.Contains(it.Obj)) it.Obj.QueueFree();
        it.Obj = null;
    }

    // ------------------------------------------------------------------ the models

    private static readonly Psx.Kind PlainKind = new(Unlit: false, Blend: false, Scissor: false, TwoSided: false, DepthWrite: true, Snap: true, Atlas: 0, VertexColor: false, Add: false, Fog: true);
    private readonly Dictionary<uint, ShaderMaterial> plain = new();

    /// <summary>A plain psx material of one colour (0xrrggbb), shared.</summary>
    public ShaderMaterial Plain(uint hex)
    {
        if (plain.TryGetValue(hex, out var m)) return m;
        m = new ShaderMaterial { Shader = Psx.ShaderOf(PlainKind) };
        m.SetShaderParameter("albedo", new Color(((hex >> 16) & 255) / 255f, ((hex >> 8) & 255) / 255f, (hex & 255) / 255f));
        m.SetShaderParameter("affine", 0.0);
        plain[hex] = m;
        return m;
    }

    private static MeshInstance3D Part(PrimitiveMesh mesh, Material mat, float x, float y, float z)
    {
        mesh.Material = mat;
        return new MeshInstance3D { Mesh = mesh, Position = new Vector3(x, y, z) };
    }

    private Node3D Model(GoodsItem s)
    {
        string name = Spots.BakedName("goods " + s.Id);
        if (baked.TryGetValue(name, out var own))
        {
            own.Reparent(root, true);
            return own;
        }
        var g = MakeGoods(s.Kind);
        g.Name = name;
        root.AddChild(g);
        return g;
    }

    /// <summary>props.ts makeGoods: a job's goods as a model, its origin at its base.</summary>
    public Node3D MakeGoods(string kind)
    {
        if (kind == "crates" && crate != null) return Copy(crate);
        if (kind == "barrels" && barrel != null) return Copy(barrel);
        var g = new Node3D();
        switch (kind)
        {
            case "crates":
                g.AddChild(Part(new BoxMesh { Size = new Vector3(0.7f, 0.7f, 0.7f) }, Plain(0x7a5c3a), 0, 0.35f, 0));
                break;
            case "barrels":
                g.AddChild(Part(new CylinderMesh { TopRadius = 0.3f, BottomRadius = 0.3f, Height = 0.9f, RadialSegments = 8, Rings = 1 }, Plain(0x4a3626), 0, 0.45f, 0));
                foreach (float y in new[] { 0.18f, 0.72f }) g.AddChild(Part(new CylinderMesh { TopRadius = 0.335f, BottomRadius = 0.335f, Height = 0.06f, RadialSegments = 8, Rings = 1 }, Plain(0x2a2a2c), 0, y, 0));
                break;
            case "sacks":
            {
                // a filled sack lying flat (shared/goods.ts SACK_LIE: 0.88 long, 0.3 high, 0.5 wide), its mouth tied
                var body = Part(new CapsuleMesh { Radius = 0.25f, Height = 0.84f, RadialSegments = 8, Rings = 3 }, Plain(0xa8946a), 0, 0.15f, 0);
                body.Rotation = new Vector3(0, 0, MathF.PI / 2);
                body.Scale = new Vector3(0.6f, 1, 1);
                g.AddChild(body);
                var tie = Part(new CylinderMesh { TopRadius = 0.05f, BottomRadius = 0.09f, Height = 0.1f, RadialSegments = 6, Rings = 1 }, Plain(0x8a7650), 0.44f, 0.17f, 0);
                tie.Rotation = new Vector3(0, 0, -MathF.PI / 2);
                g.AddChild(tie);
                break;
            }
            case "hides":
                g.AddChild(Part(new BoxMesh { Size = new Vector3(0.9f, 0.28f, 0.7f) }, Plain(0x6a4a34), 0, 0.14f, 0));
                g.AddChild(Part(new BoxMesh { Size = new Vector3(0.06f, 0.3f, 0.72f) }, Plain(0x9a8660), 0.2f, 0.14f, 0));
                break;
            case "rope":
                for (int i = 0; i < 3; i++)
                    g.AddChild(Part(new TorusMesh { InnerRadius = 0.26f - i * 0.03f, OuterRadius = 0.38f - i * 0.03f, Rings = 8, RingSegments = 4 }, Plain(0x9a8660), 0, 0.06f + i * 0.1f, 0));
                break;
            case "chests":
            {
                g.AddChild(Part(new BoxMesh { Size = new Vector3(0.9f, 0.34f, 0.52f) }, Plain(0x9a7650), 0, 0.17f, 0));
                var lid = Part(new CylinderMesh { TopRadius = 0.26f, BottomRadius = 0.26f, Height = 0.9f, RadialSegments = 6, Rings = 1 }, Plain(0x9a7650), 0, 0.34f, 0);
                lid.Rotation = new Vector3(0, 0, MathF.PI / 2);
                lid.Scale = new Vector3(0.5f, 1, 1);
                g.AddChild(lid);
                foreach (float x in new[] { -0.3f, 0.3f }) g.AddChild(Part(new BoxMesh { Size = new Vector3(0.05f, 0.36f, 0.54f) }, Plain(0x2a2a2c), x, 0.18f, 0));
                break;
            }
            default: // parcel
                g.AddChild(Part(new BoxMesh { Size = new Vector3(0.45f, 0.3f, 0.35f) }, Plain(0xb8a888), 0, 0.15f, 0));
                g.AddChild(Part(new BoxMesh { Size = new Vector3(0.47f, 0.02f, 0.04f) }, Plain(0x9a8660), 0, 0.3f, 0));
                break;
        }
        return g;
    }

    /// <summary>A copy of a bake's goods node (the same meshes and materials), at the origin.</summary>
    private static Node3D Copy(Node3D from)
    {
        var g = new Node3D();
        foreach (var n in BakedWorld.All(from))
        {
            if (n is not MeshInstance3D { Mesh: not null } mi) continue;
            g.AddChild(new MeshInstance3D { Mesh = mi.Mesh, Transform = from.GlobalTransform.AffineInverse() * mi.GlobalTransform });
        }
        return g;
    }

    // ------------------------------------------------------------------ where an item is

    private void Solidify(Item it, bool on)
    {
        if (it.Obj == null) return;
        if (it.Shape == null)
        {
            if (!on) return;
            float h = (float)GoodsRules.HeightOf(it.S);
            var body = new StaticBody3D { Name = "solid", CollisionLayer = Solid.Layer, CollisionMask = 0 };
            it.Shape = new CollisionShape3D { Shape = new BoxShape3D { Size = new Vector3(GoodsRules.Foot * 2, h, GoodsRules.Foot * 2) }, Position = new Vector3(0, h / 2, 0) };
            body.AddChild(it.Shape);
            it.Obj.AddChild(body);
        }
        it.Shape.Disabled = !on;
    }

    private void Lay(Item it)
    {
        if (it.Obj == null) return;
        if (it.Obj.GetParent() != root) it.Obj.Reparent(root, false);
        it.Obj.Visible = true;
        it.Obj.Scale = Vector3.One;
        it.Obj.Position = new Vector3(it.X, it.Y, it.Z);
        it.Obj.Rotation = new Vector3(0, (float)it.S.Rot, 0);
        Solidify(it, true);
    }

    /// <summary>goods.ts toHands: before the camera, where the kind is held (props.ts hold), turned a little.</summary>
    private void ToHands(Item it)
    {
        Carried = it;
        var jef = Jef.I;
        jef.Laden = true;
        jef.SpeedFactor = it.Heavy ? 0.4f : GoodsRules.Of(it.Kind).Speed;
        if (it.Obj == null) return;
        Solidify(it, false);
        if (it.Obj.GetParent() != jef.Cam) it.Obj.Reparent(jef.Cam, false);
        var g = GoodsRules.Of(it.Kind);
        it.Obj.Visible = true;
        it.Obj.Position = new Vector3(g.HoldX, g.HoldY, g.HoldZ);
        it.Obj.Rotation = new Vector3(0.05f, 0.08f, 0);
        it.Obj.Scale = Vector3.One;
    }

    /// <summary>In another's hands or on a cart: shown by the part that walks him (not yet here).</summary>
    private void ToHeld(Item it)
    {
        if (it.Obj == null) return;
        Solidify(it, false);
        if (it.Obj.GetParent() != root) it.Obj.Reparent(root, false);
        it.Obj.Visible = false;
    }

    /// <summary>Out of Jef's hands, here only.</summary>
    private void Release()
    {
        if (Carried == null) return;
        Carried = null;
        Jef.I.Laden = false;
        Jef.I.SpeedFactor = 1;
    }

    // ------------------------------------------------------------------ finding

    /// <summary>goods.ts ahead: the spot d metres before Jef.</summary>
    public static (float X, float Z) Ahead(float d) => (Jef.I.X - MathF.Sin(Jef.I.Yaw) * d, Jef.I.Z - MathF.Cos(Jef.I.Yaw) * d);

    public bool Above(Item it) => all.Values.Any(o => o.S.Lies && o.S.On.Contains(it.Id));

    public Vector3 Middle(Item it) => new(it.X, it.Y + 0.3f, it.Z);

    /// <summary>Of the lying goods in reach, the one in view nearest the crosshair (goods.ts nearest, facing.ts pick).</summary>
    public Item? Nearest(float reach, Func<Item, bool> filter)
    {
        var jef = Jef.I;
        Item? top = null;
        float bs = float.PositiveInfinity;
        foreach (var it in all.Values)
        {
            if (!it.S.Lies || it.Obj == null || !filter(it)) continue;
            float dx = it.X - jef.X, dz = it.Z - jef.Z;
            if (MathF.Abs(dx) > reach + 1 || MathF.Abs(dz) > reach + 1) continue;
            float d = MathF.Sqrt(dx * dx + dz * dz) + MathF.Abs(it.Y + 0.4f - (jef.Y + 0.9f)) * 0.4f;
            if (d >= reach || Above(it)) continue;
            var m = Middle(it);
            float? off = Interact.Aim(m.X, m.Y, m.Z);
            if (off == null) continue;
            float score = d + off.Value * (0.3f / (MathF.PI / 180));
            if (score < bs) (top, bs) = (it, score);
        }
        return top;
    }

    private readonly PhysicsShapeQueryParameters3D freeQ = new() { CollisionMask = Solid.Layer, Margin = 0 };

    /// <summary>goods.ts canPlace: may the carried item be set down at (x, z)? "ground", "stack" or null.</summary>
    public string? CanPlace(float x, float z)
    {
        var it = Carried;
        if (it == null) return null;
        var p = GoodsRules.PlaceAt(all.Values.Select(i => i.S), it.Kind, x, z, it.Id);
        if (p == null) return null;
        if (p.On.Count > 0) return "stack";
        // the quay's own level only (not the gangway, a deck, a step), and nothing solid in the way
        float ground = Jef.I.GroundAt(x, z, 0);
        if (!float.IsFinite(ground) || MathF.Abs(ground) > 0.05f) return null;
        freeQ.Shape = new BoxShape3D { Size = new Vector3((GoodsRules.Foot + 0.03f) * 2, 0.4f, (GoodsRules.Foot + 0.03f) * 2) };
        freeQ.Transform = new Transform3D(Basis.Identity, new Vector3(x, 0.3f, z));
        return Main.I.View.FindWorld3D().DirectSpaceState.IntersectShape(freeQ, 1).Count == 0 ? "ground" : null;
    }

    // ------------------------------------------------------------------ asking the server

    private static JsonElement Holder(int p) => JsonDocument.Parse($"{{\"p\":{p}}}").RootElement.Clone();

    /// <summary>One ask; the server's answer (the items as they are now) is taken in. A refusal undoes what was shown.</summary>
    private Task<GoodsReply?> Ask(object ask)
    {
        var done = new TaskCompletionSource<GoodsReply?>();
        var api = ServerLink.I?.Api;
        if (api == null)
        {
            done.SetResult(null);
            return done.Task;
        }
        api.Run(api.GoodsAsk<GoodsReply>(ask), r =>
        {
            if (!r.Ok) LastRefusal = r.Why ?? r.Error ?? "";
            foreach (var s in r.Items) Apply(s, !r.Ok, r.Ok ? "" : LastRefusal);
            if (r.Ok && r.Gone != null)
                foreach (string id in r.Gone)
                    Forget(id, "");
            done.SetResult(r);
        }, e =>
        {
            // the server is away: nothing is undone; the push line's resync puts it right
            LastRefusal = e.Message;
            done.SetResult(null);
        });
        return done.Task;
    }

    /// <summary>Lift it: in his hands at once, then the server is asked.</summary>
    public void Lift(Item it)
    {
        if (it.CartOnly || Carried != null) return;
        it.LiftedFrom = (it.X, it.Z, Time.GetTicksMsec());
        it.S = it.S with { By = Holder(Me), On = new List<string>() };
        ToHands(it);
        _ = Ask(new { op = "lift", id = it.Id });
    }

    /// <summary>Set the carried item down at (x, z): where the shared rule says it comes to rest. Null: the stack is full.</summary>
    public Item? PutDown(float x, float z)
    {
        var it = Carried;
        if (it == null) return null;
        var p = GoodsRules.PlaceAt(all.Values.Select(i => i.S), it.Kind, x, z, it.Id);
        if (p == null) return null;
        Release();
        it.S = it.S with { By = null, X = p.X, Z = p.Z, Y = p.Y, On = p.On, Rot = GoodsRules.RotFor(it.Id, it.S.N + 1), N = it.S.N + 1 };
        Lay(it);
        _ = Ask(new { op = "put", id = it.Id, x = Math.Round(x, 3), z = Math.Round(z, 3) });
        return it;
    }

    /// <summary>The carried item leaves the world: "sunk", "handed", "sold", "snatched" or "taken". Its node is the caller's now.</summary>
    public Item? DropCarried(string why, Vector2? at = null)
    {
        var it = Carried;
        if (it == null) return null;
        Release();
        all.Remove(it.Id);
        if (it.Obj != null)
        {
            if (why == "sunk") sinking.Add(it.Obj);
            else
            {
                it.Obj.QueueFree();
                it.Obj = null;
            }
        }
        _ = at == null ? Ask(new { op = "drop", id = it.Id, why }) : Ask(new { op = "drop", id = it.Id, why, at = new[] { Math.Round(at.Value.X, 2), Math.Round(at.Value.Y, 2) } });
        return it;
    }
    private readonly HashSet<Node3D> sinking = new();
    /// <summary>The sinking is over: the node may go.</summary>
    public void Sunk(Node3D obj)
    {
        sinking.Remove(obj);
        obj.QueueFree();
    }

    /// <summary>A lying item of his own job taken off (a thief at the watch).</summary>
    public void Take(Item it)
    {
        Forget(it.Id, "");
        _ = Ask(new { op = "take", id = it.Id });
    }

    /// <summary>His job's goods, laid out by the server once (lay: they wait at the job's place). The job's items as they are now.</summary>
    public async Task<List<Item>> JobGoods(int job, bool lay)
    {
        await Ask(new { op = "job", job, lay });
        return all.Values.Where(i => i.JobId == job).ToList();
    }

    /// <summary>A deliver: the employer hands the goods over, into Jef's hands.</summary>
    public async Task<Item?> Handover(int job)
    {
        await Ask(new { op = "handover", job });
        return Carried is { } c && c.JobId == job ? c : null;
    }

    /// <summary>A carry from the ship: the i-th swung down onto the quay.</summary>
    public Task Lower(int job, int i, bool broken, bool heavy) => Ask(new { op = "lower", job, i, broken, heavy });

    /// <summary>The run is over here: its goods go (a watch's pile stays the employer's).</summary>
    public void ClearJob(int job)
    {
        foreach (var it in all.Values.Where(i => i.JobId == job).ToList())
        {
            if (it.S.Keep == true && it.S.Lies)
            {
                it.S = it.S with { Job = null };
                continue;
            }
            Forget(it.Id, "end");
        }
        _ = Ask(new { op = "end", job });
    }

    /// <summary>The item is no longer this job's (delivered: it is the employer's, lying at his door).</summary>
    public void Unjob(Item it) => it.S = it.S with { Job = null };
}
