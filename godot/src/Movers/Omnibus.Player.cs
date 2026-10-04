using System.Collections.Generic;

namespace Scheldemist.Movers;

public partial class Omnibus
{
    private readonly HashSet<Bus> playerHeld = new();
    private readonly Dictionary<Bus, int> playerSeats = new();
    public void HoldPlayer(Bus bus, bool held)
    {
        if (held) playerHeld.Add(bus);
        else { playerHeld.Remove(bus); if (bus.At != null) bus.DwellT = System.Math.Max(bus.DwellT, 2.5f); }
    }
    private bool PlayerHeld(Bus bus) => playerHeld.Contains(bus);
    private bool PlayerSeat(Bus bus, int seat) => playerSeats.TryGetValue(bus, out int i) && seat == i;
    public void SetPlayerSeat(Bus bus, int seat) { if (seat < 0) playerSeats.Remove(bus); else playerSeats[bus] = seat; }
}
