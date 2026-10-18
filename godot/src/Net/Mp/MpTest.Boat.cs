using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;
using Scheldemist.Player;

namespace Scheldemist.Net.Mp;

/// <summary>
/// `--mpboat` after the walk (issue 156): the host takes a moored boat that is not his and rows her out. The server owns
/// her: the guest's game must hear she is out (gone from her mooring, the host drawn at her oars), and when the host
/// leaves her lying on the water the guest draws her where he left her. The games meet through small files.
/// </summary>
public partial class MpTest
{
    private static readonly string[] boatFiles = { "mpboat-taken.json", "mpboat-seen.json", "mpboat-left.json", "mpboat-left-seen.json" };
    private void BoatClean() { foreach (string f in boatFiles) File.Delete(MovingFile(f)); }

    private async Task<bool> HostBoat()
    {
        BoatClean();
        await Until(() => Rowing.I.Data.Boats.Count > 0, 20);
        var boat = Rowing.I.Data.Boats.Where(b => !b.Mine && !b.Lost && !b.Ridden && b.Owner != null).OrderBy(b => new Vector2(b.Home.X + 118, b.Home.Z - 36).Length()).FirstOrDefault();
        if (boat == null) return Fail("no moored boat for the host to take");
        var deck = ShipWalk.I.Decks.FirstOrDefault(d => d.Visible() && d.Small && d.Kind == boat.Kind && new Vector2(d.World().Origin.X - boat.Home.X, d.World().Origin.Z - boat.Home.Z).Length() < 0.7f);
        if (deck == null) return Fail("the moored boat has no deck to stand in");
        Jef.I.Place(boat.Home.X, boat.Home.Z + 1, 0); await Frames(20);
        ShipWalk.I.Attach(deck, deck.Mesh.Nearest(Vector2.Zero)); await Frames(10);
        await Rowing.I.TakeMoored(boat);
        if (!await Until(() => Rowing.I.Boat != null && !Rowing.I.Busy, 15)) return Fail("the host could not take the moored boat");
        MovingWrite("mpboat-taken.json", new { id = boat.Id, kind = boat.Kind, home = new[] { boat.Home.X, boat.Home.Z } });
        Jef.I.SetKey(Key.W, true); await Until(() => false, 4); Jef.I.ClearKeys();
        var seen = await MovingRead("mpboat-seen.json", 60);
        doc["boat_taken"] = new { boat.Id, boat.Kind, owner = boat.OwnerName, guest = seen };
        if (seen?.GetProperty("ok").GetBoolean() != true) return Fail("the guest did not see the host take and row the boat");
        // out on the water: over the side, she is left lying there
        var x = Rowing.I.Rower.X; var z = Rowing.I.Rower.Z;
        await Rowing.I.Leave(null);
        await Until(() => Rowing.I.Boat == null && !Rowing.I.Busy, 10);
        var left = Rowing.I.Data.Boats.FirstOrDefault(b => b.Id == boat.Id);
        MovingWrite("mpboat-left.json", new { id = boat.Id, x = left?.X ?? x, z = left?.Z ?? z });
        var leftSeen = await MovingRead("mpboat-left-seen.json", 60);
        doc["boat_left"] = new { at = new[] { left?.X ?? x, left?.Z ?? z }, guest = leftSeen };
        BoatClean();
        if (leftSeen?.GetProperty("ok").GetBoolean() != true) return Fail("the guest did not draw the boat where the host left her");
        return true;
    }

    private async Task<bool> GuestBoat()
    {
        var tg = Together.I!;
        bool sawOars = false;
        var make = tg.GearModel;
        tg.GearModel = (kind, sub) => { if (kind == MpProtocol.GearRowboat) sawOars = true; return make?.Invoke(kind, sub); };
        var taken = await MovingRead("mpboat-taken.json", 120);
        if (taken == null) return Fail("the host took no boat");
        string id = taken.Value.GetProperty("id").GetString()!; string kind = taken.Value.GetProperty("kind").GetString()!;
        float hx = (float)taken.Value.GetProperty("home")[0].GetDouble(), hz = (float)taken.Value.GetProperty("home")[1].GetDouble();
        // stand on the quay beside her mooring, where the host's figure is drawn
        foreach (float r in new[] { 3f, 5f, 7f, 9f }) { bool placed = false; for (int k = 0; k < 8 && !placed; k++) { float a = k * MathF.PI / 4, x = hx + MathF.Cos(a) * r, z = hz + MathF.Sin(a) * r; Scheldemist.World.Solid.I.Ensure(new Vector3(x, 0, z), 6); float g = Jef.I.GroundAt(x, z, 0.4f); if (float.IsFinite(g) && MathF.Abs(g) < 0.4f && Jef.I.StandFree(x, z, g)) { Jef.I.Place(x, z, MathF.Atan2(-(hx - x), -(hz - z))); placed = true; } } if (placed) break; }
        await Frames(30);
        bool ridden = await Until(() => { _ = Rowing.I.Load(); return Rowing.I.Data.Boats.Any(b => b.Id == id && b.Ridden); }, 30);
        await Frames(10);
        bool goneFromMooring = !Boats.I.MooredDecks().Any(m => m.Kind == kind && m.Shown() && new Vector2(m.World().Origin.X - hx, m.World().Origin.Z - hz).Length() < 0.7f);
        bool oars = await Until(() => sawOars || (tg.GearOf(1) & 3) == MpProtocol.GearRowboat, 20);
        MovingWrite("mpboat-seen.json", new { ok = ridden && goneFromMooring && oars, ridden, goneFromMooring, hostAtOars = oars });
        var left = await MovingRead("mpboat-left.json", 60);
        if (left == null) return Fail("the host did not leave the boat");
        float lx = (float)left.Value.GetProperty("x").GetDouble(), lz = (float)left.Value.GetProperty("z").GetDouble();
        bool drawn = await Until(() => { _ = Rowing.I.Load(); return Rowing.I.Drawings.TryGetValue(id, out var d) && d.Root.Visible && new Vector2(d.X - lx, d.Z - lz).Length() < 2; }, 30);
        bool stillGone = !Boats.I.MooredDecks().Any(m => m.Kind == kind && m.Shown() && new Vector2(m.World().Origin.X - hx, m.World().Origin.Z - hz).Length() < 0.7f);
        MovingWrite("mpboat-left-seen.json", new { ok = drawn && stillGone, drawn, stillGone });
        tg.GearModel = make;
        return drawn && stillGone;
    }
}
