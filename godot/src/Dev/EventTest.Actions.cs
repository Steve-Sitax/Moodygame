using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Dev;

public partial class EventTest
{
    private async Task RequestedActions(Api api, Townspeople town)
    {
        current = "actions";
        await Advance(api, 600);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 2, hour = 13, minute = 30, weather = "clear", food = 10, warmth = 10, sleep = 10, health = 10 }));
        var place = town.Data!.Places.Values.First(p => p.Label.Contains("Grote Markt"));
        var centre = Kit.I.FreeNear(place.X, place.Z);
        Jef.I.Place((float)centre.X, (float)centre.Z, MathF.PI); await Frames(6);
        var candidates = town.Sims.Where(s => s.R.Age >= 18 && s.R.Work.Kind is not ("guard" or "shop" or "stall" or "tavern") && s.R.Trade != "agent").Take(80).ToArray();
        var target = candidates[^1]; town.ActionHold(target); town.ActionHide(target); target.X = centre.X; target.Z = centre.Z + 5; town.ActionClaim(target);
        int cursor = 0;
        foreach (string kind in new[] { "follow", "wait", "go_to", "look_for", "talk_to", "fetch_police" })
        {
            current = "actions/" + kind;
            Actors.Run? run = null; Townspeople.Sim? actor = null; ActionProposalReply? proposal = null;
            for (int tries = 0; tries < 30 && cursor < candidates.Length - 1; tries++)
            {
                actor = candidates[cursor++]; town.ActionHold(actor); town.ActionHide(actor);
                var start = Kit.I.FreeNear(centre.X + 3, centre.Z + 9); actor.X = start.X; actor.Z = start.Z; town.ActionClaim(actor);
                var people = new[] { new PersonAt(actor.R.Id, actor.X, actor.Z), new PersonAt(target.R.Id, target.P?.X ?? target.X, target.P?.Z ?? target.Z) };
                await api.ActionsSync(Jef.I.X, Jef.I.Z, people);
                proposal = await api.DevAction(actor.R.Id, kind, kind == "go_to" ? place.Label : target.R.Name, 30, kind == "fetch_police" ? "I saw a robbery" : "Please help me.");
                if (proposal.ActionId == null) { town.ActionRelease(actor); continue; }
                await Refresh(api); run = Actors.I!.Runs.FirstOrDefault(r => r.Action.Id == proposal.ActionId); break;
            }
            Check(run != null, "engine accepted no candidate: " + proposal?.Refused); if (run == null || actor == null) continue;
            if (kind == "fetch_police")
            {
                var agent = town.ActionPerson(run.Action.Target);
                Check(agent != null, "dispatch supplied no agent");
                if (agent != null) { town.ActionHold(agent); town.ActionHide(agent); agent.X = centre.X - 2; agent.Z = centre.Z + 6; town.ActionClaim(agent); }
            }
            
            await Wait(kind is "follow" or "go_to" or "fetch_police" ? 12 : 5);
            bool observed = kind == "follow" ? actor.P != null && Whereabouts.Hypot(actor.P.X - Jef.I.X, actor.P.Z - Jef.I.Z) < 4 : kind == "wait" ? actor.P != null && !town.Crowd!.PuppetBusy(actor.P) : run.Reported || run.Reporting;
            Check(observed, "accepted action did not reach its expected behavior");
            await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, "action-" + kind + ".png"));
            var reply = await api.Actions();
            rows.Add(new { kind = "requested_action", action = kind, accepted = proposal!.ActionId, observed, reports = Actors.I!.Reports, phase = reply.Actions.FirstOrDefault(a => a.Id == proposal.ActionId)?.Phase ?? "ended" });
            await Advance(api, 180); await Frames(3);
            town.ActionHold(target); town.ActionHide(target); target.X = centre.X; target.Z = centre.Z + 5; town.ActionClaim(target);
        }
        town.ActionRelease(target);
    }
    private async Task Crowd100(Townspeople town)
    {
        current = "crowd100";
        Actors.I!.Reset(); await Kit.I.Light(13.5, "clear");
        town.SetClock(2, 13.5); town.ClockRuns = false;
        var centre = Kit.I.FreeNear(-257, 80);
        Jef.I.Place((float)centre.X, (float)centre.Z + 18, 0, -0.1f); await Frames(6);
        foreach (var person in town.Sims) if (person.P != null) town.ActionHide(person);
        var people = town.Sims.Where(s => HumansKind(s.Kind)).Take(100).ToArray();
        var payload = new ActionsPayload();
        for (int i = 0; i < people.Length; i++)
        {
            var s = people[i]; town.ActionHold(s); s.Inside = false;
            var point = Kit.I.FreeNear(centre.X + (i % 10 - 4.5) * 1.5, centre.Z + (i / 10 - 4.5) * 1.5);
            s.X = point.X; s.Z = point.Z;
            payload.Actions.Add(new PublicAction { Id = 200000000 + i, Npc = s.R.Id, Kind = "attend", Phase = "at", Source = "presentation_fixture", TargetX = s.X, TargetZ = s.Z, ForPlayer = -1 });
        }
        Actors.I.Apply(payload);
        foreach (var person in people) town.ActionClaim(person);
        await Wait(4);
        int drawn = people.Count(s => s.P?.Shown == true);
        Check(drawn == 100, "not 100 visible attendee bodies: " + drawn);
        var frameMs = new List<double>(360);
        costs.Clear(); allocations.Clear(); measuring = true;
        for (int i = 0; i < 360; i++) { await Frames(1); frameMs.Add((double)Performance.GetMonitor(Performance.Monitor.TimeProcess) * 1000); }
        measuring = false; frameMs.Sort();
        rows.Add(new { kind = "crowd100", visible = drawn, presentationFixtures = true, frames = frameMs.Count, wholeFrameMeanMs = frameMs.Average(), wholeFrameP95Ms = frameMs[(int)(frameMs.Count * 0.95)], peopleLogicMs = town.LogicMs });
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, "attendees-100.png"));
        var recover = Actors.I.Runs.First(r => r.Person?.P != null); recover.GoalX = centre.X; recover.GoalZ = centre.Z; recover.Pace = 1.45;
        for (int i = 0; i < 5; i++) Actors.I.Recover(recover);
        Check(recover.Replans == 5 && recover.GaveUp, "attendance did not stop after four alternate ways");
        rows.Add(new { kind = "recovery", attempts = recover.Replans - 1, stopped = recover.GaveUp });
        Actors.I.Reset(); Check(town.MaxPuppets == 50, "event capacity did not return to normal");
    }
    private static bool HumansKind(string kind) => Scheldemist.People.Humans.IsKind(kind) && kind is not ("porter" or "carter");
}
