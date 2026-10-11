using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Movers;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>
/// `--ride-only crane-drift`: Jef rides a working crane on the ladder, the gallery and in the cabin while it travels
/// and slews; every frame his feet and eyes are read in the frame of the part he is on (the portal for the ladder,
/// the turning deck up top), as last drawn. Drift: feet away from where the ride says he stands. Jitter: the eyes'
/// frame-to-frame step in that part's frame while he holds still. The crane must keep its own work going meanwhile.
/// </summary>
public partial class RideTest
{
    private sealed class DriftPhase
    {
        public string Name = "";
        public int Frames;
        public float Drift, Jitter, YawJitter, ViewDrift, BodyYawDrift, CamBehind, Travelled, Slewed, A0, A1;
        public string Ok = "";
    }
    private readonly List<DriftPhase> drift = new();
    private readonly List<string> driftFails = new();
    /// <summary>A measured result: recorded, and the run goes on so every phase is measured; the end fails if any did.</summary>
    private void Measure(bool ok, string name)
    {
        checks.Add(new { name, ok }); GD.Print($"ridetest: {(ok ? "ok" : "FAIL")} {name}");
        if (!ok) driftFails.Add(name);
    }

    private static Transform3D PortalOf(Railway.Ladder l) => new(new Basis(Vector3.Up, l.Face - MathF.PI), l.Deck.Origin);

    /// <summary>Samples every frame (at the start of the next, i.e. the state that was drawn) until done or timed out.</summary>
    private async Task<DriftPhase> Watch(string name, int id, Func<bool> done, double seconds, string shot = "", int shotAt = 45)
    {
        // the view first settles on where he looks (the look eases after a turn), so only the ride's own turn counts
        await Until(() => Math.Abs(Mathf.AngleDifference(Jef.I.Cam.Rotation.Y, Jef.I.Yaw)) < .0005f, 3);
        var p = new DriftPhase { Name = name }; var climb = CraneClimb.I; var rail = Railway.I;
        var l0 = rail.LadderAt(id); var origin0 = l0.Deck.Origin;
        float a0 = Mathf.Wrap(l0.Deck.Basis.GetEuler().Y - (l0.Face - MathF.PI), -MathF.PI, MathF.PI), aPrev = a0;
        Vector3? lastEye = null; float? lastYaw = null, firstYaw = null, firstBody = null; float slewSum = 0; p.A0 = a0;
        ulong end = Time.GetTicksMsec() + (ulong)(seconds * 1000);
        while (Time.GetTicksMsec() < end && !done())
        {
            await Frames(1);
            if (climb.On != id) { p.Ok = "fell off the crane"; break; }
            var l = rail.LadderAt(id); var j = Jef.I;
            var frame = climb.OnLadder ? PortalOf(l) : l.Deck; var inv = frame.AffineInverse();
            var feet = inv * new Vector3(j.X, j.Y, j.Z); var eye = inv * j.Cam.GlobalPosition;
            Vector3 want;
            if (climb.OnLadder) want = new(0, climb.Height, -3.4f);
            else { climb.Deck.Frame = l.Deck; want = new(climb.Local.X, climb.Deck.Floor(climb.Local.X, climb.Local.Y), climb.Local.Y); }
            float d = feet.DistanceTo(want);
            p.Drift = Math.Max(p.Drift, d);
            float frameYaw = frame.Basis.GetEuler().Y, relYaw = Mathf.Wrap(j.Cam.Rotation.Y - frameYaw, -MathF.PI, MathF.PI);
            if (lastEye is { } e) p.Jitter = Math.Max(p.Jitter, eye.DistanceTo(e));
            if (lastYaw is { } y) p.YawJitter = Math.Max(p.YawJitter, Math.Abs(Mathf.Wrap(relYaw - y, -MathF.PI, MathF.PI)));
            float bodyRel = Mathf.Wrap(j.Yaw - frameYaw, -MathF.PI, MathF.PI); firstBody ??= bodyRel;
            p.BodyYawDrift = Math.Max(p.BodyYawDrift, Math.Abs(Mathf.Wrap(bodyRel - firstBody.Value, -MathF.PI, MathF.PI)));
            p.CamBehind = Math.Max(p.CamBehind, Math.Abs(Mathf.Wrap(j.Cam.Rotation.Y - j.Yaw, -MathF.PI, MathF.PI)));
            firstYaw ??= relYaw; p.ViewDrift = Math.Max(p.ViewDrift, Math.Abs(Mathf.Wrap(relYaw - firstYaw.Value, -MathF.PI, MathF.PI)));
            lastEye = eye; lastYaw = relYaw;
            float a = Mathf.Wrap(l.Deck.Basis.GetEuler().Y - (l.Face - MathF.PI), -MathF.PI, MathF.PI);
            slewSum += Math.Abs(Mathf.Wrap(a - aPrev, -MathF.PI, MathF.PI)); aPrev = a; p.A1 = a;
            p.Travelled = l.Deck.Origin.DistanceTo(origin0); p.Slewed = slewSum;
            p.Frames++;
            if (shot != "" && p.Frames == shotAt) { string file = System.IO.Path.Combine(dir, shot + ".png"); GetViewport().GetTexture().GetImage().SavePng(file); pictures.Add(file); }
        }
        p.Drift *= 100; p.Jitter *= 100; p.YawJitter = Mathf.RadToDeg(p.YawJitter); p.ViewDrift = Mathf.RadToDeg(p.ViewDrift); p.BodyYawDrift = Mathf.RadToDeg(p.BodyYawDrift); p.CamBehind = Mathf.RadToDeg(p.CamBehind); // cm, cm, degrees, degrees
        drift.Add(p);
        replies.Add(new { craneDrift = new { p.Name, p.Frames, driftCm = p.Drift, jitterCm = p.Jitter, viewYawJitterDeg = p.YawJitter, viewYawDriftDeg = p.ViewDrift, bodyYawDriftDeg = p.BodyYawDrift, viewBehindBodyDeg = p.CamBehind, slewFrom = p.A0, slewTo = p.A1, travelledM = p.Travelled, slewedRad = p.Slewed, p.Ok } });
        return p;
    }

    /// <summary>The jib's slew against the portal (radians).</summary>
    private static float Slew(int id) { var l = Railway.I.LadderAt(id); return Mathf.Wrap(l.Deck.Basis.GetEuler().Y - (l.Face - MathF.PI), -MathF.PI, MathF.PI); }

    /// <summary>The crane did its work (travelled its metre, or slewed to the angle) and Jef went with it rigidly.</summary>
    private void Judge(DriftPhase p, bool travel = false, float slewTo = float.NaN)
    {
        bool worked = travel ? p.Travelled > .95f : Math.Abs(Mathf.Wrap(p.A1 - slewTo, -MathF.PI, MathF.PI)) < .02f;
        Measure(worked, $"{p.Name}: the crane works on with Jef aboard ({(travel ? $"{p.Travelled:0.00} m" : $"{p.A0:0.00} to {p.A1:0.00} rad, asked {slewTo:0.00}")})");
        Measure(p.Drift < .1f && p.Jitter < .1f && p.ViewDrift < .05f, $"{p.Name}: carried rigidly (feet drift {p.Drift:0.0000} cm, eye jitter {p.Jitter:0.0000} cm, view turn lag {p.ViewDrift:0.000} deg)");
    }

    private bool driftGuard; private int focusPauses;
    /// <summary>The window losing focus (another program in front) pauses the game quietly; the measured ride goes on.</summary>
    private async Task KeepPlaying()
    {
        while (driftGuard)
        {
            await Frames(1);
            if (Scheldemist.Menu.Pause.Has("menu") && Scheldemist.Menu.MainMenu.I is { } menu) { focusPauses++; menu.Start(); }
        }
    }

    private async Task CraneDriftCheck()
    {
        MoverClock.Hold(13.75, 1);
        GameState.I.Apply(await ServerLink.I!.Api!.Post<JobsPayload>("api/dev/set", new { hour = 13, minute = 45, weather = "clear" }));
        driftGuard = true; _ = KeepPlaying();
        var rail = Railway.I; var climb = CraneClimb.I;
        replies.Add(new { processOrder = new { jef = new { index = Jef.I.GetIndex(), parent = Jef.I.GetParent()?.Name.ToString(), Jef.I.ProcessPriority }, railway = new { index = rail.GetIndex(), parent = rail.GetParent()?.Name.ToString(), rail.ProcessPriority }, craneClimb = new { index = climb.GetIndex(), climb.ProcessPriority } } });
        int id = Enumerable.Range(0, rail.LadderCount).First(i => climb.FootOf(i) != null && rail.RiderCanTravel(i));
        rail.RiderTestWork(id, 0);
        var foot = climb.FootOf(id)!.Value; var l = rail.LadderAt(id);
        Jef.I.Place(foot.X, foot.Z, l.Face, .2f); await Frames(12);
        Require(Interact.I.Press(Key.E) && climb.On == id, "E grips the crane ladder");
        // low on the rungs (below the 3 m the legs' guard looks at): the portal travels on, he with it
        Jef.I.SetKey(Key.W, true); Require(await Until(() => climb.Height > 1.4f, 10), "W climbs the first rungs"); Jef.I.ClearKeys();
        Require(rail.RiderTestTravel(id), "crane gets a runway trip");
        Judge(await Watch("ladder low, travel", id, () => false, 9, "drift-ladder-travel"), travel: true);
        // higher up, still on the rungs: travel and a slew (the ladder is on the portal; the jib turns over it)
        Jef.I.SetKey(Key.W, true); Require(await Until(() => climb.Height > 3.6f, 10), "W climbs high on the ladder"); Jef.I.ClearKeys();
        rail.RiderTestTravel(id);
        Judge(await Watch("ladder high, travel", id, () => false, 9), travel: true);
        rail.RiderTestWork(id, .7f);
        Judge(await Watch("ladder high, slew", id, () => false, 8), slewTo: .7f);
        // onto the gallery when it comes round
        rail.RiderTestWork(id, 0);
        Jef.I.SetKey(Key.W, true); Require(await Until(() => !climb.OnLadder, 30), "steps onto the gallery when it is at the ladder head"); Jef.I.ClearKeys();
        await WalkCrane(new Vector2(0, -1.7f));
        Jef.I.Yaw = rail.LadderAt(id).Deck.Basis.GetEuler().Y + MathF.PI / 2; Jef.I.Pitch = -.15f; await Frames(30);
        rail.RiderTestWork(id, 1.1f);
        Judge(await Watch("gallery, slew", id, () => false, 10, "drift-gallery-slew"), slewTo: 1.1f);
        rail.RiderTestTravel(id);
        Judge(await Watch("gallery, travel", id, () => false, 9), travel: true);
        // into the cabin, then slew back and travel
        rail.RiderTestWork(id, 0); await Until(() => Math.Abs(Slew(id)) < .01f, 15);
        foreach (var w in new[] { new Vector2(1.58f, -1.7f), new Vector2(1.58f, -.7f), new Vector2(.8f, -.7f), new Vector2(.8f, 1.08f), new Vector2(.2f, 1.08f) }) await WalkCrane(w);
        Require(Math.Abs(Jef.I.Y - 6.54f) < .02f, "in the cabin");
        Jef.I.Yaw = rail.LadderAt(id).Deck.Basis.GetEuler().Y + MathF.PI; Jef.I.Pitch = -.1f; await Frames(30);
        rail.RiderTestWork(id, -.9f);
        Judge(await Watch("cabin, slew", id, () => false, 9, "drift-cabin-slew"), slewTo: -.9f);
        rail.RiderTestTravel(id);
        Judge(await Watch("cabin, travel", id, () => false, 9, "drift-cabin-travel"), travel: true);
        // back out and down; the portal travels while he climbs down, and he steps off where the foot is then
        rail.RiderTestWork(id, 0); await Until(() => Math.Abs(Slew(id)) < .01f, 15);
        foreach (var w in new[] { new Vector2(.8f, 1.08f), new Vector2(.8f, -.7f), new Vector2(1.58f, -.7f), new Vector2(1.58f, -1.7f), new Vector2(0, -1.7f), new Vector2(0, -2.45f) }) await WalkCrane(w);
        Require(await Until(() => Interact.I.Find().Any(a => a.Text == "climb down the ladder"), 20), "ladder head offers the way down");
        Require(Interact.I.Press(Key.E), "E starts down");
        Jef.I.SetKey(Key.S, true);
        Require(await Until(() => climb.OnLadder && climb.Height < 1.6f, 15), "S climbs down the rungs");
        Jef.I.ClearKeys(); rail.RiderTestTravel(id);
        var o0 = rail.LadderAt(id).Deck.Origin;
        Measure(await Until(() => rail.LadderAt(id).Deck.Origin.DistanceTo(o0) > .15f, 10), "the portal travels while he is low on the ladder");
        Jef.I.SetKey(Key.S, true);
        Require(await Until(() => climb.On < 0, 15), "S climbs down to the ground");
        Jef.I.ClearKeys();
        var footNow = climb.FootOf(id); var at = new Vector3(Jef.I.X, Jef.I.Y, Jef.I.Z); var o1 = rail.LadderAt(id).Deck.Origin;
        Measure(footNow is { } f && new Vector2(f.X - at.X, f.Z - at.Z).Length() < .3f && Jef.I.BodyFree(at.X, at.Y, at.Z) && !Jef.I.Riding && !Jef.I.Swimming, $"steps off a travelling crane onto free ground at the ladder's foot where it is now ({o1.DistanceTo(o0):0.00} m travelled on the way down)");
        await Frames(90);
        float after = rail.LadderAt(id).Deck.Origin.DistanceTo(o1);
        replies.Add(new { stepOff = new { travelledWhileDescending = o1.DistanceTo(o0), travelledAfterStepOff = after, feet = new { at.X, at.Y, at.Z } } });
        Measure(after < .05f, $"the crane halts for Jef standing at its foot ({after * 100:0.0} cm after he stepped off)");
        await Shot("drift-stepped-off");
        replies.Add(new { craneDriftSummary = drift.Select(d => new { d.Name, d.Frames, driftCm = d.Drift, jitterCm = d.Jitter, viewYawJitterDeg = d.YawJitter, viewYawDriftDeg = d.ViewDrift, travelledM = d.Travelled, slewedRad = d.Slewed }).ToArray() });
        driftGuard = false; replies.Add(new { focusPauses });
        Require(driftFails.Count == 0, "crane rides measured within bounds: " + string.Join("; ", driftFails));
    }
}
