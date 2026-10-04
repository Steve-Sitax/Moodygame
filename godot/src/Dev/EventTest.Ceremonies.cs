using System;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.People;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Dev;

public partial class EventTest
{
    private async Task Ceremonies(Api api, string[] only)
    {
        current = "ceremonies";
        var hall = HallPeople.I!; var cath = hall.Halls.First(h => h.Id == "cathedral");
        foreach (string kind in new[] { "wedding", "funeral" })
        {
            if (only.Length > 0 && !only.Contains("ceremonies") && !only.Contains(kind + "_inside")) continue;
            current = "ceremonies/" + kind;
            await Advance(api, 600);
            GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 2, hour = 10, minute = 0, weather = "clear", food = 10, warmth = 10, sleep = 10, health = 10 }));
            await Kit.I.Light(13.5, "clear");
            Jef.I.Place(cath.Origin.X + 1.4f, cath.Origin.Z + 12, MathF.PI, 0, cath.Origin.Y);
            await Wait(1);
            hall.ApplyHall("cathedral", await api.Get<JsonElement>("api/landmark/cathedral")); cath.HadRoster = true;
            var plan = await api.DevEvent(kind); Check(plan.Ok, "engine refused ceremony"); if (!plan.Ok) continue;
            await Advance(api, 2); var live = Events.I!.Find(plan.Id);
            int guard = 0;
            while (guard++ < 16 && live != null && Events.StageOf(live.Event)!.Op != "enter") { await Advance(api, (int)Math.Ceiling(live.Left) + 1); live = Events.I.Find(plan.Id); }
            Check(live != null, "ceremony never entered"); if (live == null) continue;
            await Advance(api, 12);
            for (int tries = 0; tries < 12; tries++)
            {
                await Refresh(api); hall.ApplyHall("cathedral", await api.Get<JsonElement>("api/landmark/cathedral"));
                if (cath.Figures.Values.Any(f => f.Ceremony && f.Moving)) break;
                await Wait(1);
            }
            live = Events.I.Find(plan.Id)!;
            int walking = cath.Figures.Values.Count(f => f.Ceremony && f.Moving);
            Check(walking > 0, "no ceremony people walked from door");
            await Wait(2); await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, kind + "-indoor-entry.png"));
            int enteredBefore = hall.CeremonyEntered; await Wait(72);
            Check(hall.CeremonyEntered > enteredBefore, "nobody reached an indoor place");
            foreach (var pending in cath.Figures.Values.Where(f => f.Ceremony && f.Moving && !f.Leaving)) GD.Print("ceremony pending " + pending.Role + " from=" + pending.Group.Position + " target=" + pending.Target + " goal=" + pending.CeremonyGoal + " path=" + pending.Path.Count);
            Check(!cath.Figures.Values.Any(f => f.Ceremony && f.Moving && !f.Leaving), "ceremony entrant still walking after entry window");
            await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, kind + "-indoor-ceremony.png"));
            Jef.I.Place(cath.Origin.X + 1.4f, cath.Origin.Z - 4, MathF.PI, -0.05f, 0);
            int exitedBefore = hall.CeremonyExited;
            await Advance(api, (int)Math.Ceiling(Events.StageOf(live.Event)!.Minutes) + 1);
            hall.ApplyHall("cathedral", await api.Get<JsonElement>("api/landmark/cathedral"));
            Check(cath.Figures.Values.Any(f => f.Leaving && f.Moving), "no exit walk from nave");
            await Wait(2); await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
            GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, kind + "-indoor-exit.png"));
            await Wait(40); Check(hall.CeremonyExited > exitedBefore, "nobody reached street door");
            Check(!cath.Figures.Values.Any(f => f.Ceremony && f.Leaving), "ceremony exit still in nave after exit window");
            rows.Add(new { kind = "ceremony", ceremony = kind, walking, entered = hall.CeremonyEntered - enteredBefore, exited = hall.CeremonyExited - exitedBefore });
        }
        if (only.Length > 0 && !only.Contains("ceremonies") && !only.Contains("sermon")) return;
        current = "ceremonies/sermon";
        await Advance(api, 600);
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 7, hour = 8, minute = 50, weather = "clear", food = 10, warmth = 10, sleep = 10, health = 10 }));
        Jef.I.Place(cath.Origin.X + 1.4f, cath.Origin.Z + 12, MathF.PI, 0, cath.Origin.Y);
        hall.ApplyHall("cathedral", await api.Get<JsonElement>("api/landmark/cathedral")); cath.HadRoster = true;
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 7, hour = 9, minute = 5 }));
        hall.ApplyHall("cathedral", await api.Get<JsonElement>("api/landmark/cathedral"));
        int flock = cath.Figures.Values.Count(f => f.Role == "worshipper");
        Check(flock > 0 && cath.Figures.Values.Any(f => f.Role == "preacher"), "sermon has no crowd or preacher");
        int entered = hall.CeremonyEntered; await Wait(72);
        foreach (var f in cath.Figures.Values.Where(f=>f.Role=="worshipper" && f.Moving))
            GD.Print("sermon pending " + f.Id + " from=" + f.Group.Position + " target=" + f.Target + " goal=" + f.CeremonyGoal + " path=" + f.Path.Count + " owned=" + Actors.I!.NpcOwned(f.Id) + " held=" + Main.I.GetNode<Townspeople>("Townspeople").ActionPerson(f.Id)?.ActionHeld + " inside=" + Main.I.GetNode<Townspeople>("Townspeople").ActionPerson(f.Id)?.Inside);
        Check(hall.CeremonyEntered > entered, "sermon crowd did not walk to chairs");
        Check(!cath.Figures.Values.Any(f => f.Role == "worshipper" && f.Moving && !f.Leaving), "sermon worshipper still walking after entry window");
        await ToSignal(RenderingServer.Singleton, RenderingServer.SignalName.FramePostDraw);
        GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, "sermon-crowd.png"));
        GameState.I.Apply(await api.Post<JobsPayload>("api/dev/set", new { day = 7, hour = 11, minute = 5 }));
        int exited = hall.CeremonyExited;
        hall.ApplyHall("cathedral", await api.Get<JsonElement>("api/landmark/cathedral"));
        Jef.I.Place(cath.Origin.X + 1.4f, cath.Origin.Z - 4, MathF.PI, -0.05f, 0);
        await Wait(72); Check(hall.CeremonyExited > exited, "sermon crowd did not walk out");
        Check(!cath.Figures.Values.Any(f => f.Role == "worshipper" && f.Leaving), "sermon worshipper still walking out after exit window");
        rows.Add(new { kind = "sermon", flock, entered = hall.CeremonyEntered - entered, exited = hall.CeremonyExited - exited });
    }
}
