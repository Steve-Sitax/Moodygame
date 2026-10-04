using System;

namespace Scheldemist.Town;

public partial class Townspeople
{
    // game/town.ts claim/release/moveHidden. The crowd still owns walking and body separation.
    public Sim? ActionPerson(string id) => byId.TryGetValue(id, out var s) ? s : null;

    public void ActionHold(Sim s)
    {
        if (s.ActionHeld) return;
        s.ActionHeld = true; s.Plain = false; s.Inside = false;
        s.Hw = null; s.Round = null; s.CoarseDt = 0;
        s.Goal.Mode = "action"; s.Goal.X = s.X; s.Goal.Z = s.Z;
    }
    public void ActionInside(Sim s, double x, double z)
    {
        Lose(s, true); s.X = x; s.Z = z; s.Inside = true;
    }
    public void ActionOutside(Sim s) { s.Inside = false; }
    public void ActionHide(Sim s) { Lose(s, true); }

    public Puppet? ActionClaim(Sim s)
    {
        if (Crowd == null) return null;
        if (s.P != null && Crowd.Alive(s.P)) return s.P;
        var at = Crowd.OpenNearFree(s.X, s.Z);
        if (at == null) return null;
        // Action bodies use the same finite street capacity as ordinary residents.
        int count = 0; Sim? far = null; double distance = 0;
        foreach (var other in sims)
        {
            if (other.P == null) continue;
            count++;
            double d = Dist(other.X, other.Z, px, pz);
            if (!other.ActionHeld && d > distance && Crowd.IsHidden(other.X, other.Z)) { far = other; distance = d; }
        }
        if (count >= MaxPuppets) { if (far == null) return null; Lose(far, true); }
        s.P = Crowd.AddPuppet(s.Kind, at.Value.x, at.Value.z);
        if (s.P != null) { s.X = s.P.X; s.Z = s.P.Z; }
        return s.P;
    }

    public void ActionMoveHidden(Sim s, double x, double z, double step)
    {
        if (s.P != null || Walk == null) return;
        double d = Dist(s.X, s.Z, x, z), k = d > 0 ? Math.Min(1, step / d) : 1;
        // Only unseen action travel may skip a distant grid; emergence is checked on the crowd grid.
        s.X += (x - s.X) * k; s.Z += (z - s.Z) * k;
        s.Goal.X = s.X; s.Goal.Z = s.Z;
    }

    public void ActionRelease(Sim s)
    {
        s.ActionHeld = false; s.Key = ""; s.Plain = false;
        if (s.P != null && Crowd != null) { Crowd.PuppetFollow(s.P, null); s.P.Human.Root.Rotation = Godot.Vector3.Zero; }
        Reschedule(s, false);
    }
}
