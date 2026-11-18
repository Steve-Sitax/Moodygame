using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.People;

/// <summary>Keep the quay's authored people anchors; dress and seat their live figures on the two existing stools.</summary>
[GamePart(965)]
public partial class NetMenders : Node
{
    public sealed record Mender(Node3D Anchor, Transform3D Authored, bool WasVisible, Human Human);
    public IReadOnlyList<Mender> People => people;
    private readonly List<Mender> people = new();

    public static IEnumerable<string> Resources() => new[]
    {
        "res://assets/game-models/people2_women1.scn",
        "res://assets/game-models/people2_women3.scn"
    };

    public override void _Ready()
    {
        if (!People2.Enabled) { SetProcess(false); return; }
        using var timing = Dev.StartupTiming.Measure("characters.net-menders");
        var rack = Main.I.World.FindChild("trade_nets", true, false) as Node3D;
        if (rack == null) { SetProcess(false); return; }
        foreach (var (path, id, kind, x) in new[]
        {
            ("Node31/old_woman", 1746, "old_woman", -.3f),
            ("Node32/fishwife_b", 1765, "fishwife_b", 1.2f)
        })
        {
            var anchor = rack.GetNodeOrNull<Node3D>(path);
            if (anchor == null || !anchor.HasMeta("source_node_index") || anchor.GetMeta("source_node_index").AsInt32() != id) continue;
            var human = People2.Make(kind);
            if (human == null) continue;
            human.Root.Name = "net_mender_" + id;
            // Only the visual replacement moves: source transforms, permanent IDs, stools and coarse collision stay intact.
            rack.AddChild(human.Root);
            human.Start(); human.SetIdentity("net-mender:" + id);
            human.Root.Position = new Vector3(x, human.SitDrop(.44f), 1);
            human.Root.Rotation = new Vector3(0, MathF.PI, 0);
            human.Play("sit", 0);
            foreach (var mesh in BakedWorld.All(human.Root).OfType<MeshInstance3D>())
                mesh.CastShadow = GeometryInstance3D.ShadowCastingSetting.On;
            people.Add(new(anchor, anchor.Transform, anchor.Visible, human));
            anchor.Visible = false;
        }
        if (people.Count == 0) SetProcess(false);
    }

    public override void _Process(double delta)
    {
        foreach (var p in people) p.Human.Update((float)Math.Min(delta, .05));
    }

    public override void _ExitTree()
    {
        foreach (var p in people)
        {
            if (GodotObject.IsInstanceValid(p.Anchor)) p.Anchor.Visible = p.WasVisible;
            p.Human.Dispose();
        }
        people.Clear();
    }
}
