namespace Scheldemist.Town;

public partial class Townspeople
{
    // Reuse the shared reservation used by events and routine actors.
    public Sim? ClaimPlayerPerson(string id, object owner, double? x = null, double? z = null)
    {
        if (!byId.TryGetValue(id, out var s) || Crowd == null) return null;
        if (!ActionHold(s, owner)) return null;
        if (s.P == null)
        {
            if (x.HasValue && z.HasValue) { s.X = x.Value; s.Z = z.Value; }
            if (ActionClaim(s) == null) { ActionRelease(s, owner); return null; }
        }
        return s;
    }
    public void ReleasePlayerPerson(string id, object owner)
    {
        if (byId.TryGetValue(id, out var s)) ActionRelease(s, owner);
    }
}
