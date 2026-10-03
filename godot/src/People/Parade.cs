using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

/// <summary>
/// A check of the people's models and clips: `-- --parade dir` stands every kind of people.glb in rows on the
/// Vismarkt, each row playing its own clip (walk, idle, talk, carry ...), takes pictures from the front and the
/// side, writes parade.json (kinds, clips, the frame time with them all moving) and quits.
/// </summary>
[GamePart(210)]
public partial class Parade : Node
{
    private string dir = "";
    private readonly List<(Human h, Node3D at)> people = new();
    private int frame;
    private ulong last;
    private readonly List<double> times = new();
    private static readonly string[] Rows = { "walk", "idle", "talk", "carry", "fold", "behind" };

    public override void _Ready()
    {
        dir = Main.I.Arg("parade", "");
        if (dir == "" || !Humans.Ready)
        {
            SetProcess(false);
            return;
        }
        Directory.CreateDirectory(dir);
        var place = Main.I.World.Facts.RootElement.GetProperty("places")[0].GetProperty("pos");
        var origin = new Vector3(place[0].GetSingle(), 0, place[2].GetSingle());
        var kinds = Humans.Kinds.OrderBy(k => k, StringComparer.Ordinal).ToList();
        for (int r = 0; r < Rows.Length; r++)
        {
            for (int i = 0; i < kinds.Count; i++)
            {
                var h = Humans.Make(kinds[i]);
                if (h == null) continue;
                var at = new Node3D { Position = origin + new Vector3((i - kinds.Count / 2f) * 0.8f, 0, -4 - r * 1.6f) };
                at.AddChild(h.Root);
                Main.I.View.AddChild(at);
                h.Start();
                h.Play(Rows[r], 0);
                h.SetPace(1.3f);
                people.Add((h, at));
            }
        }
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;
        Look(origin + new Vector3(-17, 1.6f, 0.5f), origin + new Vector3(-14, 0.9f, -6));
    }

    private static void Look(Vector3 from, Vector3 to) => Main.I.Cam.LookAtFromPosition(from, to, Vector3.Up);

    private void Shot(string name) => Main.I.View.GetTexture().GetImage().SavePng(Path.Combine(dir, name));

    public override void _Process(double delta)
    {
        foreach (var (h, _) in people) h.Update((float)delta);
        ulong now = Time.GetTicksUsec();
        if (frame > 20) times.Add((now - last) / 1000.0);
        last = now;
        frame++;
        var o = people[0].at.Position;
        float w = Humans.Kinds.Count() * 0.8f;
        switch (frame)
        {
            case 60: Shot("parade_left.png"); Look(o + new Vector3(w * 0.5f, 1.6f, 4.5f), o + new Vector3(w * 0.5f - 3, 0.9f, -3)); break;
            case 90: Shot("parade_mid.png"); Look(o + new Vector3(w - 4, 1.6f, 4.5f), o + new Vector3(w - 7, 0.9f, -3)); break;
            case 120: Shot("parade_right.png"); Look(o + new Vector3(-2.5f, 1.2f, 0), o + new Vector3(3, 0.9f, 0)); break;
            case 150: Shot("parade_side.png"); Look(o + new Vector3(1.2f, 1.3f, 2.2f), o + new Vector3(1.2f, 0.9f, 0)); break;
            case 180: Shot("parade_close.png"); break;
            case 181:
                times.Sort();
                File.WriteAllText(Path.Combine(dir, "parade.json"), JsonSerializer.Serialize(new
                {
                    kinds = Humans.Kinds.Count(),
                    people = people.Count,
                    rows = Rows,
                    loadMs = Humans.LoadMs,
                    frameMean = Math.Round(times.Average(), 3),
                    frameP95 = Math.Round(times[(int)(times.Count * 0.95)], 3),
                    drawCalls = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame),
                }, new JsonSerializerOptions { WriteIndented = true }));
                GetTree().Quit();
                break;
        }
    }
}
