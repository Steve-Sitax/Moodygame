using System;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Dev;

public partial class EventTest
{
    private async Task TransitProof(Townspeople town)
    {
        current = "omnibus"; Actors.I!.Reset(); await Kit.I.Light(13.5, "clear");
        var omnibus = Omnibus.I!; var bus = omnibus.Buses.First(b => b.Line.Id == "kaaien");
        var board = OmnibusLines.Stops.First(s => s.Id == "werf"); var off = OmnibusLines.Stops.First(s => s.Id == "steenplein");
        var person = town.Sims.First(s => s.Kind == "clerk" && !s.ActionHeld);
        town.ActionHold(person); town.ActionHide(person); person.X = board.X; person.Z = board.Z;
        Jef.I.Place(off.X, off.Z + 12, 0); await Frames(3);
        bus.S = bus.StopAt.First(s => s.Stop.Id == board.Id).S; bus.At = board; bus.DwellT = 60; bus.V = 0; bus.DepartAt = null;
        Actors.I.Apply(new ActionsPayload { Actions = new() { new PublicAction { Id = 200000100, Npc = person.R.Id, Kind = "attend", Phase = "walking", TargetX = off.X, TargetZ = off.Z, Role = "crowd", ForPlayer = -1 } } });
        var run = Actors.I.Runs[0]; run.TransitChosen = true; run.BoardStop = board; run.AlightStop = off;
        // The passenger belongs to this fixture; player routing is supplied only while it boards.
        run.Action = run.Action with { ForPlayer = null };
        int boards = Actors.I.TransitBoarded, alights = Actors.I.TransitAlighted;
        await Wait(8);
        Check(Actors.I.TransitBoarded == boards + 1 && omnibus.Passengers(bus).Any(p => p.Id == person.R.Id && p.State == "seated"), "attendee did not board and take a real seat");
        Jef.I.Place(board.X, board.Z + 8, 0); await Frames(5);
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, "omnibus-seated.png"));
        Jef.I.Place(off.X, off.Z + 12, 0); await Frames(3);
        var passenger = omnibus.Passengers(bus).FirstOrDefault(p => p.Id == person.R.Id);
        if (passenger != null)
        {
            var stop = bus.StopAt.Select((s, i) => (s, i)).First(s => s.s.Stop.Id == off.Id);
            bus.S = stop.s.S - 0.1f; bus.NextI = stop.i; bus.At = null; bus.DepartAt = null; bus.DwellT = 0; bus.V = 0.5f;
            await Wait(12);
        }
        Check(Actors.I.TransitAlighted == alights + 1 && run.Bus == null && !person.Inside, "attendee did not leave at its event stop");
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, "omnibus-attendee.png"));
        rows.Add(new { kind = "omnibus", boarded = Actors.I.TransitBoarded - boards, alighted = Actors.I.TransitAlighted - alights, timetableFixture = true });
        Actors.I.Reset();
    }
}
