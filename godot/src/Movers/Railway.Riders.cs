using Godot;

namespace Scheldemist.Movers;

public partial class Railway
{
    /// <summary>Snapshots of the live portal and jib, without stopping their work or allocating lists.</summary>
    public readonly record struct Ladder(int Id, Vector3 Foot, Vector3 Hang, Vector3 Head, float Face, Transform3D Deck, string Mode, int Lifts);
    public int LadderCount => cranes.Count;
    public Ladder LadderAt(int i)
    {
        var c = cranes[i];
        var portal = new Transform3D(new Basis(Vector3.Up, c.Yaw), new Vector3(c.X, 0, c.Z));
        var deck = new Transform3D(new Basis(Vector3.Up, c.Yaw + c.A), new Vector3(c.X, 0, c.Z));
        return new(i, portal * new Vector3(0, 0, -3.55f), portal * new Vector3(0, 0, -3.4f), portal * new Vector3(0, 6.42f, -2.45f), c.Yaw + Mathf.Pi, deck, c.Mode, c.Lifts);
    }
    /// <summary>Self-test fixture only: an ordinary slew/hoist queue, using the real clearance and motion code.</summary>
    public void RiderTestWork(int i, float angle)
    {
        if (Main.I.Arg("ridetest") == "") throw new System.InvalidOperationException("ride fixture outside ridetest");
        var c = cranes[i]; c.Mode = "berth"; c.Reserved = false; c.OpT = 0;
        c.Ops.Clear(); c.Ops.Add(new Op { T = OpT.Hoist, V = Travel });
        c.Ops.Add(new Op { T = OpT.Slew, V = angle });
        c.Ops.Add(new Op { T = OpT.Wait, V = 60 });
    }
    public bool RiderTestTravel(int i)
    {
        if (Main.I.Arg("ridetest") == "") throw new System.InvalidOperationException("ride fixture outside ridetest");
        var c = cranes[i]; if (c.Axis == ' ') return false;
        c.Ops.Clear(); c.Reserved = false; c.Mode = "travel"; c.Speed = 0;
        c.Target = c.Pos + (c.Pos + 1 < c.Hi ? 1 : -1); c.NextA = c.A;
        return true;
    }
}
