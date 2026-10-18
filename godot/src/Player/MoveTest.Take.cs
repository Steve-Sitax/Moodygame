using System;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;
using Scheldemist.World;

namespace Scheldemist.Player;

/// <summary>
/// Issue 156 (`--moveonly takeboat`): standing in somebody's moored boat, E offers to take her by her owner's name;
/// taking her is a deed (the engine's theft), Jef rows her out and back and ties her up again at her own ladder or
/// steps, which settles the deed. Then nobody's old boat: taken with no deed.
/// </summary>
public partial class MoveTest
{
    private async Task TakeBoatCheck()
    {
        var j = Jef.I;
        var sw = ShipWalk.I;
        await Tidy(13);
        await Until(() => Rowing.I.Data.Boats.Count > 0, 20);
        foreach (bool owned in new[] { true, false })
        {
            // the nearest moored boat of the kind wanted, drawn at her mooring
            var boat = Rowing.I.Data.Boats.Where(b => !b.Mine && !b.Lost && !b.Ridden && (owned ? b.Owner != null : b.Owner == null))
                .OrderBy(b => new Vector2(b.Home.X + 118, b.Home.Z - 36).Length()).FirstOrDefault();
            if (boat == null) { Check(false, owned ? "a moored boat with an owner" : "a moored boat that is nobody's"); continue; }
            var deck = sw.Decks.FirstOrDefault(d => d.Visible() && d.Small && d.Kind == boat.Kind && new Vector2(d.World().Origin.X - boat.Home.X, d.World().Origin.Z - boat.Home.Z).Length() < 0.7f);
            if (deck == null) { Check(false, $"the deck of the moored {boat.Kind} at {boat.Home.X:0.0}, {boat.Home.Z:0.0}"); continue; }
            Solid.I.Ensure(deck.World().Origin, 20);
            await Frames(5);
            sw.Attach(deck, deck.Mesh.Nearest(Vector2.Zero));
            await Frames(20);
            var offers = Interact.I.Find().Select(a => a.Text).ToArray();
            bool offered = offers.Contains(boat.Prompt);
            await Shot($"take-{(owned ? "owned" : "nobody")}-offer");
            Check(offered, $"in the moored {boat.Kind} E offers \"{boat.Prompt}\"", new { offers });
            if (!offered) { sw.Clear(); continue; }
            Interact.I.Press(Key.E);
            bool rowing = await Until(() => Rowing.I.Boat != null && !Rowing.I.Busy, 15);
            var mine = Rowing.I.Data.Boats.FirstOrDefault(b => b.Id == boat.Id);
            Check(rowing && mine?.Mine == true, $"E takes the {boat.Kind}: Jef sits at her oars and she is his to row", new { rowing, mine = mine?.Mine, owner = boat.OwnerName });
            if (!rowing) continue;
            await Shot($"take-{(owned ? "owned" : "nobody")}-rowing");
            // out a few strokes and back again
            var from = new Vector2(Rowing.I.Rower.X, Rowing.I.Rower.Z);
            j.SetKey(Key.W, true); await Sampled(t => t < 4, 6); j.ClearKeys();
            float went = new Vector2(Rowing.I.Rower.X, Rowing.I.Rower.Z).DistanceTo(from);
            j.SetKey(Key.S, true); await Sampled(t => t < 12 && new Vector2(Rowing.I.Rower.X, Rowing.I.Rower.Z).DistanceTo(from) > 0.8f, 14); j.ClearKeys();
            await Frames(30);
            Check(went > 1.5f, $"Jef rows the {boat.Kind} out", new { went = R(went) });
            var exit = Rowing.I.ExitHere();
            var keys = Interact.I.Find().Select(a => a.Text).ToArray();
            await Shot($"take-{(owned ? "owned" : "nobody")}-back");
            var own = Rowing.I.Data.Boats.FirstOrDefault(b => b.Id == boat.Id);
            Check(exit != null, $"back at her mooring the {boat.Kind} lies at a ladder or steps to get out", new { keys, exit = exit == null ? null : new { exit.Ladder, exit.Gx, exit.Gz }, on = Rowing.I.Data.On, rower = new[] { R(Rowing.I.Rower.X), R(Rowing.I.Rower.Z) }, home = new[] { R(boat.Home.X), R(boat.Home.Z) }, landing = own?.Landing, board = own?.Board });
            if (exit == null) { _ = Rowing.I.Leave(null); await Until(() => Rowing.I.Boat == null && !Rowing.I.Busy, 10); await Frames(30); j.Place(-118, 36, 0); await Frames(30); continue; }
            Interact.I.Press(Key.E);
            await Until(() => Rowing.I.Boat == null && !Rowing.I.Busy && !j.Climbing, 15);
            await Frames(30);
            var after = Rowing.I.Data.Boats.FirstOrDefault(b => b.Id == boat.Id);
            Check(after != null && !after.Mine && !after.Ridden && !j.Swimming, $"tied up at her own mooring and out on the quay, the {boat.Kind} is her owner's again", new { mine = after?.Mine, ridden = after?.Ridden, feet = new[] { R(j.X), R(j.Y), R(j.Z) }, j.Swimming });
            await Shot($"take-{(owned ? "owned" : "nobody")}-out");
        }
    }
}
