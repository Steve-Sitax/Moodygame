using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Native.World;

/// <summary>
/// The bake's hiring board (#153: a black frame on two posts with four blank grey squares, a group of plain boxes by
/// the Hessenatie's door) gives way to the authored hiring board (assets/library/hiring-board.tres, workboard.scn),
/// where the game pins one note per open job. The old group keeps its nodes, hidden, without collision.
/// </summary>
public static class NativeWorkBoard
{
    public static int Retire(Node3D town)
    {
        var (bx, bz) = Scheldemist.Play.Spots.Board;
        if (bx == 0 && bz == 0) return 0;
        int hidden = 0;
        foreach (var group in town.GetChildren().OfType<Node3D>())
        {
            var parts = group.GetChildren().OfType<MeshInstance3D>().Where(m => m.Mesh != null).ToList();
            if (parts.Count < 6 || parts.Count > 12 || group.GetChildren().Count != parts.Count) continue;
            var box = parts.Select(m => group.Transform * m.Transform * m.GetAabb()).Aggregate((a, b) => a.Merge(b));
            if (box.Size.X > 2.6f || box.Size.Z > 2.6f || box.Size.Y > 2.8f || new Vector2(box.GetCenter().X - bx, box.GetCenter().Z - bz).Length() > .6f) continue;
            group.Visible = false;
            foreach (var n in BakedWorld.All(group)) n.SetMeta("native_replaced_event_snapshot", true);
            hidden++;
        }
        return hidden;
    }
}
