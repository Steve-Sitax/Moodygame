using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// One row on screen at a time: inspect every clip without updating a thousand off-camera skeletons.
internal partial class People2Parade : Node
{
    private readonly string dir;
    private readonly List<Human> people = new();
    private string[] rows = Array.Empty<string>();
    private Vector3 origin;
    private int row, frame;
    private int ShotAt => rows[row] == "blend_walk" ? 120 : 15;
    private readonly List<object> reports = new();
    public People2Parade(string dir) { this.dir = dir; }
    public override void _Ready()
    {
        Directory.CreateDirectory(dir);
        if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
        var place = Main.I.World.Facts.RootElement.GetProperty("places")[0].GetProperty("pos");
        origin = new Vector3(place[0].GetSingle(), 0, place[2].GetSingle()) + new Vector3(-14, 0, -22);
        // Clear the exhibition strip of baked stalls; the real town remains untouched.
        foreach (var n in World.BakedWorld.All(Main.I.World))
            if (n is MeshInstance3D mi)
            {
                var box = mi.GlobalTransform * mi.GetAabb();
                if (box.End.Y > 0.1f && box.Size.Y < 8 && box.End.X > origin.X - 2 && box.Position.X < origin.X + 16 && box.End.Z > origin.Z - 2 && box.Position.Z < origin.Z + 7) mi.Visible = false;
            }
        rows = new[] { "blend_walk" }.Concat(People2.ClipNames.OrderBy(k => k, StringComparer.Ordinal)).ToArray();
        if (Main.I.Arg("parade-rows") is { Length: > 0 } only) rows = rows.Where(r => only.Split(',').Contains(r)).ToArray();
        foreach (string kind in People2.Kinds.OrderBy(k => k, StringComparer.Ordinal))
        {
            var h = Humans.Make(kind);
            if (h == null) continue;
            Main.I.View.AddChild(h.Root); h.Start(); people.Add(h);
        }
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled); Engine.MaxFps = 0;
        Begin();
    }
    private void Begin()
    {
        frame = 0;
        for (int i = 0; i < people.Count; i++)
        {
            people[i].Root.Position = origin + new Vector3(i * 1.4f, 0, 0);
            if (rows[row] == "blend_walk") { people[i].Play("walk", 0); people[i].SetPace(1.12f); }
            else people[i].ParadeClip(rows[row]);
        }
        Look(0);
    }
    private void Look(int group)
    {
        Vector3 centre = origin + new Vector3(group * 4.2f + 1.4f, 0.9f, 0);
        if (rows[row] == "blend_walk" && people.Count > 0) centre.Z = people[0].Root.Position.Z;
        Main.I.Cam.LookAtFromPosition(centre + new Vector3(0, 0.55f, 3.8f), centre, Vector3.Up);
    }
    private void Shot(string suffix) => Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, rows[row] + "_" + suffix + ".png"));
    public override void _Process(double delta)
    {
        float dt = 1f / 60; // Reproducible pose sampling for pictures.
        if (rows[row] == "blend_walk")
        {
            float pace = frame < 30 ? 0.9f : frame < 60 ? 1.12f : frame < 90 ? 1.6f : 1.9f;
            foreach (var person in people) person.SetPace(pace);
        }
        foreach (var h in people)
        {
            if (rows[row] == "blend_walk") h.Root.Position += new Vector3(0, 0, dt * (frame < 30 ? 0.9f : frame < 60 ? 1.12f : frame < 90 ? 1.6f : 1.9f));
            h.Update(dt);
            var at = h.Root.Position; at.Y = origin.Y + h.MotionLift(); h.Root.Position = at;
        }
        frame++;
        if (rows[row] == "blend_walk") Look(frame < 120 ? 0 : frame < 123 ? 1 : frame < 126 ? 2 : 3);
        if (frame == ShotAt) { Shot("a"); Look(1); }
        if (frame == ShotAt + 3) { Shot("b"); Look(2); }
        if (frame == ShotAt + 6) { Shot("c"); Look(3); }
        if (frame == ShotAt + 9)
        {
            Shot("d"); reports.Add(new { clip = rows[row], kinds = people.Count, footLock = rows[row] == "blend_walk" ? people.Select(h => new { kind = h.Kind, slideMm = h.StanceSlide * 1000, samples = h.StanceSamples, reachMm = h.StanceReach * 1000 }).ToArray() : null });
            if (row == 0) File.WriteAllText(Path.Combine(dir, "feet.json"), JsonSerializer.Serialize(reports[0], new JsonSerializerOptions { WriteIndented = true }));
            row++;
            if (row == rows.Length)
            {
                File.WriteAllText(Path.Combine(dir, "parade.json"), JsonSerializer.Serialize(new { rows = reports, kinds = people.Select(h => h.Kind), drawCalls = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame) }, new JsonSerializerOptions { WriteIndented = true }));
                GetTree().Quit(); SetProcess(false);
            }
            else Begin();
        }
    }
}
