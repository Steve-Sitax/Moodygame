using Godot;
using Scheldemist.Town;
namespace Scheldemist.Play;

public partial class Goods
{
    /// <summary>The original job item leaves Jef or the pile and travels in the actor's arms.</summary>
    internal void HandTo(Item item, Walkups.Call actor, string why)
    {
        if (actor.Puppet is not { } p) return;
        bool carried = Carried == item;
        if (carried) Release();
        all.Remove(item.Id);
        if (item.Obj is { } obj)
        {
            Solidify(item, false);
            actor.Load(item.Kind);
            p.LoadNode?.QueueFree();
            obj.Reparent(p.Group, false);
            obj.Position = new(0, 1.05f * p.Human.Scale, .52f);
            obj.Rotation = Vector3.Zero; obj.Scale = Vector3.One * .8f; obj.Visible = true;
            p.LoadNode = obj; p.LoadKind = item.Kind; item.Obj = null;
        }
        _ = carried ? Ask(new { op = "drop", id = item.Id, why }) : Ask(new { op = "take", id = item.Id });
    }
}
