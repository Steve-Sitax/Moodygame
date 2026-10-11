using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Movers;
using Scheldemist.Play;

namespace Scheldemist.Player;

public partial class MoveTest
{
    /// <summary>The eye in the crane's frames: the portal on the ladder, the deck up top (both still in these checks).</summary>
    private async Task<List<Sample>> CraneRun(string name, Func<float, bool> step, float limit, List<object> rows, string shotWhen = "", string shotName = "")
    {
        var climb = CraneClimb.I;
        bool shot = false;
        var s = await Sampled(t =>
        {
            if (!shot && shotWhen != "" && climb.MoveName == shotWhen && climb.Moving && climb.MoveShare > 0.5f)
            {
                shot = true;
                _ = Shot(shotName, 0);
            }
            return step(t);
        }, limit);
        var snap = Snap(s);
        rows.Add(new { name, seconds = R(s.Count > 0 ? s[^1].T : 0), worstCm = R(snap.stepCm), maxSpeed = R(snap.speed), peak = Peak(s), end = new[] { R(Jef.I.X), R(Jef.I.Y), R(Jef.I.Z) }, track = Track(s, 6) });
        Check(snap.stepCm < 4, $"crane, {name}: the view moves no more than a few cm a frame", new { worstCm = R(snap.stepCm), maxSpeed = R(snap.speed) });
        return s;
    }

    private async Task CraneCheck()
    {
        var j = Jef.I;
        var rail = Railway.I;
        var climb = CraneClimb.I;
        int id = Enumerable.Range(0, rail.LadderCount).FirstOrDefault(i => climb.FootOf(i) != null, -1);
        if (id < 0) { Check(false, "a crane ladder with ground at its foot"); return; }
        var rows = new List<object>();
        rail.RiderTestWork(id, 0);
        await Until(() => Math.Abs(Slew(id)) < .01f, 20);
        var foot = climb.FootOf(id)!.Value;
        var l = rail.LadderAt(id);
        await Settle(foot.X, foot.Z, l.Face + 0.5f, .2f, foot.Y);

        // on: E at the foot, W up the rungs, through the gate onto the gallery
        Check(Interact.I.Press(Key.E) && climb.On == id, "E takes the crane's ladder");
        await CraneRun("onto the ladder", t => t < 1.2f, 1.5f, rows, "on", "crane-on");
        j.SetKey(Key.W, true);
        await CraneRun("up and through the gate", t => climb.OnLadder || climb.Moving, 14, rows, "top", "crane-gate");
        j.ClearKeys();
        Check(climb.On == id && !climb.OnLadder, "up on the gallery through its gate");
        await Shot("crane-gallery");

        // down again: E at the ladder head, S down, off at the foot
        Check(Interact.I.Press(Key.E), "E at the ladder head climbs down");
        j.SetKey(Key.S, true);
        await CraneRun("down from the gallery and off at the foot", t => climb.On >= 0, 14, rows, "off", "crane-off");
        j.ClearKeys();
        Check(climb.On < 0 && !j.Riding && j.Grounded && Math.Abs(j.Y - foot.Y) < 0.1f, "on his feet at the ladder's foot");
        await Frames(10);

        // the gallery swung away: at the top he climbs over its railing
        Check(Interact.I.Press(Key.E) && climb.On == id, "E takes the ladder again");
        j.SetKey(Key.W, true);
        await Until(() => climb.Height > 3.5f, 12);
        j.ClearKeys();
        rail.RiderTestWork(id, 1.45f);
        await Until(() => Math.Abs(Slew(id) - 1.45f) < .01f, 25);
        await Frames(10);
        j.SetKey(Key.W, true);
        var over = await CraneRun("up and over the railing (gallery swung away)", t => climb.OnLadder || climb.Moving, 14, rows, "over", "crane-over-rail");
        j.ClearKeys();
        float topEye = over.Max(x => x.Eye.Y);
        Check(climb.On == id && !climb.OnLadder && Math.Abs(j.Y - CraneClimb.DeckY) < 0.03f && climb.Deck.Stand(climb.Local.X, climb.Local.Y), "over the railing onto the gallery's walk", new { j.Y, local = new[] { R(climb.Local.X), R(climb.Local.Y) }, topEye = R(topEye) });
        j.Yaw += MathF.PI; // looking back the way he came: the rail and the ladder
        await Shot("crane-over-done", 30);

        // and back over it onto the ladder
        Check(Interact.I.Find().Any(a => a.Text == "climb over the railing onto the ladder"), "the gallery offers the way back over the railing");
        Check(Interact.I.Press(Key.E), "E climbs back over the railing");
        await CraneRun("back over the railing onto the ladder", t => climb.Moving, 6, rows, "back over", "crane-back-over");
        Check(climb.OnLadder && climb.On == id, "on the ladder again");
        j.SetKey(Key.S, true);
        await CraneRun("down the ladder and off", t => climb.On >= 0, 14, rows);
        j.ClearKeys();
        Check(climb.On < 0 && j.Grounded, "down on the ground again");
        rail.RiderTestWork(id, 0);
        reports.Add(new { crane = new { id, rows } });
    }

    private static float Slew(int id)
    {
        var l = Railway.I.LadderAt(id);
        return Mathf.Wrap(l.Deck.Basis.GetEuler().Y - (l.Face - MathF.PI), -MathF.PI, MathF.PI);
    }
}
