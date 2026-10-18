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
            // the item's own model (its stencil) in the actor's arms, with the hold pose; his old load goes (#148)
            if (actor.Owner.Crowd is { } crowd) crowd.PuppetLoad(p, true, item.Kind, node: obj);
            else obj.QueueFree();
            item.Obj = null;
        }
        else actor.Load(item.Kind);
        _ = carried ? Ask(new { op = "drop", id = item.Id, why }) : Ask(new { op = "take", id = item.Id });
    }
}
