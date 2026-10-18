using System;
using System.Linq;
using System.Text.Json;
using Scheldemist.Game;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Play;

public partial class Hands
{
    // NativeHands owns lifting, placing, delivery counts and wages. This walker reports a
    // completed physical approach; it never awards progress from a visible crate animation.
    private void NativeStep(Walk w, double dt)
    {
        var routine = w.Info; var step = routine.Step;
        if (step == null || w.Reported || town?.Crowd is not {} crowd || !GameState.I.Live) return;
        if (step.Kind is "enter" or "sit" or "leave" or "buy" or "give" or "pay" || step.Inside != null) return;
        var sim = w.Sim ?? town.ActionPerson(routine.Npc); if (sim == null) return;
        if(Scheldemist.Net.Mp.NativeStreet.I is{} street&&!street.Owns(routine.Npc))return;
        if (w.Sim == null) { if (!town.ActionHold(sim, this)) return; w.Sim = sim; }
        if (sim.Inside) town.ActionOutside(sim);
        if (sim.P is {} puppet) { sim.X = puppet.X; sim.Z = puppet.Z; }
        SyncNativeLoad(w);
        double x = sim.X, z = sim.Z, tx = step.X ?? x, tz = step.Z ?? z;
        double Distance(double a, double b) => Math.Sqrt((a - x) * (a - x) + (b - z) * (b - z));
        double jefDistance = Distance(Jef.I.X, Jef.I.Z);
        if (step.Kind == "wait") {
            if (sim.P == null && jefDistance < 58) town.ActionClaim(sim);
            if (sim.P is {} waiting && (crowd.PuppetBusy(waiting) || (w.Go -= dt) <= 0)) {
                crowd.PuppetStand(waiting, step.Label == "asking for more" ? "talk" : "idle", Math.Atan2(Jef.I.X - x, Jef.I.Z - z)); w.Go = 3;
            }
            return;
        }
        int picking = 0;
        if (step.Kind == "pick_up") {
            if (!Goods.I.Loaded) return;
            var ids = step.Gids.Count > 0 ? step.Gids : step.Gid == null ? null : new System.Collections.Generic.List<string> { step.Gid };
            var candidates = Goods.I.Items.Where(item => ids?.Contains(item.Id) ?? item.JobId == step.Job)
                .Where(item => !Goods.I.Above(item) && (routine.Strong || !item.Heavy)).OrderBy(item => Distance(item.X, item.Z)).Take(Math.Max(1, step.Count)).ToArray();
            if (candidates.Length == 0) { _ = Report(w, false, "none_left"); return; }
            tx = candidates[0].X; tz = candidates[0].Z; picking = candidates.Length;
        }
        else if (step.Kind == "follow") {
            if (room != null) {
                var counter = InsideCounters.I.Counters.FirstOrDefault(c => c.Id == room);
                if (counter == null) return;
                tx = counter.At.X; tz = counter.At.Z;
            } else {
                w.Lost = jefDistance > 40 ? w.Lost + dt : 0;
                if (w.Lost > 5) { _ = Report(w, false, "lost"); return; }
                if (Jef.I.Swimming) { if (sim.P is {} waiting) crowd.PuppetStand(waiting); return; }
                double scale = 1.8 / Math.Max(1, jefDistance); tx = Jef.I.X + (x - Jef.I.X) * scale; tz = Jef.I.Z + (z - Jef.I.Z) * scale;
            }
        }
        else if (step.Who == "jef") { tx = Jef.I.X; tz = Jef.I.Z; }
        else if (step.Who is { Length: > 0 } who && Folk.At(who) is {} at) { tx = at.X; tz = at.Z; }
        double raw = Distance(tx, tz);
        var open = crowd.OpenNear(tx, tz); double gx = open?.x ?? tx, gz = open?.z ?? tz, distance = Distance(gx, gz);
        double reach = step.Kind == "pick_up" ? routine.Cart == null ? 1.9 : 4.6 : routine.Cart == null ? 2.6 : 4.6;
        bool arrived = distance <= 1.6 || raw <= reach;
        if (step.Kind == "follow") arrived = room == null ? jefDistance <= 2.6 : raw <= 2.5;
        if (arrived) {
            if (sim.P == null && jefDistance < 58) town.ActionClaim(sim);
            if (sim.P is {} standing) crowd.PuppetStand(standing, "idle", Math.Atan2(Jef.I.X - x, Jef.I.Z - z));
            if (step.Kind != "follow") _ = Report(w, true, step.Kind == "pick_up" ? "picked up" : step.Kind == "carry" ? step.Off ? "gone" : "delivered" : "arrived", picking > 0 ? picking : null);
            return;
        }
        bool moved = double.IsNaN(w.LastX) || Math.Sqrt((x - w.LastX) * (x - w.LastX) + (z - w.LastZ) * (z - w.LastZ)) > .6;
        if (distance < w.Best - .3 || moved) { w.Best = Math.Min(w.Best, distance); w.Stuck = 0; w.LastX = x; w.LastZ = z; } else w.Stuck += dt;
        if (sim.P != null && jefDistance > 58 && crowd.IsHidden(x, z)) town.ActionHide(sim);
        if (sim.P == null) {
            if (jefDistance < 58) town.ActionClaim(sim);
            if (sim.P == null) { town.ActionMoveHidden(sim, gx, gz, dt * 6); return; }
        }
        var body = sim.P!;
        if (!crowd.CanStand(body.X, body.Z)) {
            w.Wedged += dt;
            if (w.Wedged > 1.5 && crowd.OpenNear(body.X, body.Z) is {} free && Math.Sqrt(Math.Pow(free.x - body.X, 2) + Math.Pow(free.z - body.Z, 2)) < 3) {
                body.X = free.x; body.Z = free.z; w.Go = 0; w.Wedged = 0;
            }
        } else w.Wedged = 0;
        if (w.Stuck > 16) {
            if (++w.Detours > 3) { _ = Report(w, false, "blocked"); return; }
            double side = w.Detours % 2 == 1 ? 1 : -1, offset = 3 + w.Detours, length = Math.Max(1, distance);
            if (crowd.OpenNear(x - (gz - z) / length * offset * side, z + (gx - x) / length * offset * side) is {} detour) crowd.PuppetGo(body, detour.x, detour.z, 1.3);
            w.Go = 3; w.Stuck = 0; w.Best = double.PositiveInfinity; return;
        }
        double pace = step.Kind == "carry" ? routine.Strong ? 1.1 : .85 : step.Kind == "follow" ? jefDistance > 10 ? 2.3 : 1.75 : distance > 12 ? 1.5 : 1.3;
        if ((w.Go -= dt) <= 0 || !crowd.PuppetBusy(body)) { w.Go = .7; crowd.PuppetGo(body, gx, gz, pace); }
        SyncNativeLoad(w);
    }

    private void SyncNativeLoad(Walk walk)
    {
        if (walk.Sim?.P is not {} body || town?.Crowd is not {} crowd) return;
        string? kind = HeldKind(walk.Info.Npc);
        if (kind != null && walk.Info.Cart == null && !body.Loaded) crowd.PuppetLoad(body, true, kind);
        else if ((kind == null || walk.Info.Cart != null) && body.Loaded && body.HandCarry) crowd.PuppetLoad(body, false);
    }

    /// <summary>The carry kind of the goods item a hired hand holds now (null: none).</summary>
    private static string? HeldKind(string npc)
    {
        var held = Goods.I.All.Values.FirstOrDefault(item => item.S.By is { ValueKind: JsonValueKind.Object } holder && holder.TryGetProperty("npc", out var who) && who.GetString() == npc);
        return held == null ? null : Crowd.CarryKindOf(held.Kind);
    }
}
