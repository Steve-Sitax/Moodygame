using Godot;
using Scheldemist.Movers;
using Scheldemist.Town;

namespace Scheldemist.Game;

public partial class Actors
{
    public int TransitBoarded { get; private set; }
    public int TransitAlighted { get; private set; }
    private void OffBus(Omnibus.Bus bus, string id, Vector3 foot)
    {
        foreach (var r in Runs) if (r.Action.Npc == id && r.Bus == bus && r.Person != null)
        {
            r.Bus = null; r.BoardStop = null; r.AlightStop = null; town!.ActionOutside(r.Person);
            r.Person.X = foot.X; r.Person.Z = foot.Z; TransitAlighted++; return;
        }
    }
    // actions.ts how/byTram: only distant, unseen crowd/guests/mourners/children;
    // a real resident passenger, and walking after fifteen seconds without a bus.
    private bool Transit(Run r, Townspeople.Sim person, double x, double z, double dt)
    {
        var omnibus = Omnibus.I; if (omnibus == null) return false;
        if (r.Bus != null) { person.X = r.Bus.Pa.X; person.Z = r.Bus.Pa.Y; return true; }
        if (!r.TransitChosen)
        {
            r.TransitChosen = true;
            double hash = r.TravelHash / 4294967296.0;
            if (r.Action.Lead != null || r.Action.Role is not ("crowd" or "guests" or "mourners" or "children") || r.Action.Phase is "procession" or "inside" or "leave" || person.P?.Shown == true || Whereabouts.Hypot(person.X - x, person.Z - z) < 90 || hash >= (r.Action.Role == "crowd" ? 0.4 : 0.3)) return false;
            double nearest = 70;
            foreach (var stop in OmnibusLines.Stops) { double d = Whereabouts.Hypot(stop.X - x, stop.Z - z); if (d < nearest) { r.AlightStop = stop; nearest = d; } }
            if (r.AlightStop == null) return false;
            nearest = double.PositiveInfinity;
            foreach (var stop in OmnibusLines.Stops) if (stop.Line == r.AlightStop.Line && stop.Id != r.AlightStop.Id) { double d = Whereabouts.Hypot(stop.X - person.X, stop.Z - person.Z); if (d < nearest) { r.BoardStop = stop; nearest = d; } }
            if (person.P != null && !person.P.Shown) town!.ActionHide(person);
        }
        if (r.BoardStop == null || r.AlightStop == null) return false;
        if ((r.BusWait += dt) > 15) { r.BoardStop = null; r.AlightStop = null; return false; }
        town!.ActionMoveHidden(person, r.BoardStop.X, r.BoardStop.Z, 6 * dt);
        if (Whereabouts.Hypot(person.X - r.BoardStop.X, person.Z - r.BoardStop.Z) > 3) return true;
        foreach (var bus in omnibus.Buses) if (bus.At?.Id == r.BoardStop.Id && bus.Line.Id == r.BoardStop.Line && omnibus.BoardResident(bus, r.Action.Npc, person.Kind, r.AlightStop.Id))
        {
            town.ActionInside(person, person.X, person.Z); r.Bus = bus; TransitBoarded++; break;
        }
        return true;
    }
}
