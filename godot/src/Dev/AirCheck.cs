using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// `--aircheck dir`: what smokes with nothing under it (the survey of 2026-10-11, finding 5: puffs in the air with no
/// chimney or funnel). Each chimney top the smoke starts from must stand on drawn geometry (a ray down from just over
/// it hits the still world within a metre); each boat's funnel or stove must be on a boat that is shown and there.
/// Writes dir/aircheck.txt with every one that fails, then quits (or leaves the run to --snap's views).
/// </summary>
[GamePart(991)]
public partial class AirCheck : Node
{
    private string dir = "";
    private int frames;

    public override void _Ready()
    {
        if (!Main.I.Flag("aircheck")) { SetPhysicsProcess(false); return; }
        dir = Main.I.Arg("aircheck");
        if (dir == "" || dir.StartsWith("--")) dir = ProjectSettings.GlobalizePath("res://baked/checks");
        Directory.CreateDirectory(dir);
    }

    public override void _PhysicsProcess(double delta)
    {
        if (++frames < 30) return;
        SetPhysicsProcess(false);
        var lines = new List<string>();
        var space = Main.I.View.FindWorld3D().DirectSpaceState;
        int chimneys = 0, bare = 0;
        if (Main.I.GetNodeOrNull<ChimneySmoke>("ChimneySmoke") is { } cs)
            foreach (var top in cs.Tops)
            {
                chimneys++;
                var hit = space.IntersectRay(PhysicsRayQueryParameters3D.Create(top + new Vector3(0, 0.4f, 0), top - new Vector3(0, 1.2f, 0), Solid.Layer));
                if (hit.Count > 0) continue;
                bare++;
                lines.Add($"chimney smoke with nothing under it at {top.Round()}");
            }
        int mouths = 0, loose = 0;
        if (Main.I.GetNodeOrNull<FunnelSmoke>("FunnelSmoke") is { } fs)
            foreach (var (at, shown, gone, funnel) in fs.Mouths())
            {
                mouths++;
                if (shown && !gone) continue;
                loose++;
                lines.Add($"{(funnel ? "funnel" : "stove")} smoke at {at.Round()}: her boat {(gone ? "is gone (a moored copy at zero size)" : "is not shown")}");
            }
        // (things in the air: a small drawn thing well off the ground with nothing round it within a metre or two:
        // not under it, not over it, not beside it; the survey's loads and lanterns with their crane or post missing)
        int small = 0, alone = 0;
        bool Hit(Vector3 a, Vector3 b) => space.IntersectRay(PhysicsRayQueryParameters3D.Create(a, b, Solid.Layer)).Count > 0;
        foreach (var nd in BakedWorld.All(Main.I.World))
        {
            if (nd is not MeshInstance3D mi || mi.Mesh == null || !mi.IsVisibleInTree()) continue;
            var box = mi.GlobalTransform * mi.GetAabb();
            if (box.Size.Length() > 6 || box.Size.Length() < 0.15) continue;
            var c = box.GetCenter();
            var bottom = new Vector3(c.X, box.Position.Y, c.Z);
            if (Hit(bottom + Vector3.Up * 0.05f, bottom + Vector3.Down * 4)) continue;
            small++;
            var top = new Vector3(c.X, box.End.Y, c.Z);
            if (Hit(top - Vector3.Up * 0.05f, top + Vector3.Up * 2)) continue;
            float r = box.Size.Length() / 2 + 1.5f;
            if (Hit(c, c + Vector3.Right * r) || Hit(c, c + Vector3.Left * r) || Hit(c, c + Vector3.Forward * r) || Hit(c, c + Vector3.Back * r)) continue;
            // (on the ground after all: the ground is solid only where it is walked; a thing low over open ground is fine)
            if (!Hit(bottom, bottom + Vector3.Down * 40)) continue;
            var ground = space.IntersectRay(PhysicsRayQueryParameters3D.Create(bottom, bottom + Vector3.Down * 40, Solid.Layer));
            float over = bottom.Y - ((Vector3)ground["position"]).Y;
            if (over < 4) continue;
            alone++;
            lines.Add($"in the air: {mi.GetPath().ToString().Split('/').TakeLast(3).Aggregate((x, y) => x + "/" + y)} at {c.Round()}, {over:0.0} m up, {box.Size.Length():0.0} m big");
        }
        lines.Insert(0, $"aircheck: {chimneys} chimneys, {bare} with nothing under them; {mouths} boat funnels and stoves, {loose} on a boat not there; {alone} small things alone in the air (of {small} with nothing under them)");
        File.WriteAllLines(Path.Combine(dir, "aircheck.txt"), lines);
        foreach (var l in lines.Take(40)) GD.Print(l);
        if (Main.I.Arg("views") == "") GetTree().Quit();
    }
}
