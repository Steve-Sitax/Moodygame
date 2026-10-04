using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using Godot;
using Scheldemist.World;

namespace Scheldemist.Dev;

/// <summary>
/// Test pictures from chosen views, hours and weathers in one run (docs/testing.md: a good view, midday and clear
/// unless the dark or the fog is what is tested):
///   -- --snap dir --views "day:-118,1.62,36,180,0,13,clear;night:-118,1.62,36,180,10,22,mist"
/// Each view: name:x,y,z,yaw,pitch[,hour,weather,storm] (degrees; storm: the great storm's level 0..1; yaw 0 looks to -z, 180 to +z; pitch up). A view with no
/// place ("name:,,,,,21,rain") keeps the camera of the bake's first place. Writes dir/name.png and prints the mean
/// frame time there, then quits.
/// </summary>
[GamePart(900)]
public partial class Snap : Node
{
    private string dir = "";
    private readonly List<string[]> views = new();
    private int view = -1, frame;
    private ulong last;
    private readonly List<double> times = new();
    private const int Wait = 50, Timed = 90;

    public override void _Ready()
    {
        dir = Main.I.Arg("snap");
        string v = Main.I.Arg("views");
        if (dir == "" || v == "")
        {
            SetProcess(false);
            return;
        }
        System.IO.Directory.CreateDirectory(dir);
        foreach (var one in v.Split(';', StringSplitOptions.RemoveEmptyEntries))
        {
            int c = one.IndexOf(':');
            views.Add(new[] { one[..c] }.Concat(one[(c + 1)..].Split(',')).ToArray());
        }
        // (the pictures are taken from the free camera: Jef gives it up)
        if (Player.Jef.I is { Fly: false } jef) jef.ToggleFly();
        DisplayServer.WindowSetVsyncMode(DisplayServer.VSyncMode.Disabled);
        Engine.MaxFps = 0;
        ProcessPriority = -100;
        Next();
    }

    private static float F(string s) => float.Parse(s, CultureInfo.InvariantCulture);

    private void Next()
    {
        view++;
        frame = 0;
        times.Clear();
        if (view >= views.Count)
        {
            GetTree().Quit();
            SetProcess(false);
            return;
        }
        var a = views[view];
        var cam = Main.I.Cam;
        if (a.Length > 5 && a[1] != "")
        {
            cam.Position = new Vector3(F(a[1]), F(a[2]), F(a[3]));
            var q = Basis.FromEuler(new Vector3(Mathf.DegToRad(F(a[5])), Mathf.DegToRad(F(a[4])), 0), EulerOrder.Yxz).GetRotationQuaternion();
            if (cam is Player.FlyCam fly) fly.Face(q);
            else cam.Quaternion = q;
        }
        if (a.Length > 6 && a[6] != "")
        {
            Daylight.I.SetTime(F(a[6]));
            Tide.Set(1, F(a[6])); // (Monday's tide at that hour)
        }
        if (a.Length > 7 && a[7] != "") Daylight.I.SetWeather(a[7]);
        Daylight.I.SetStorm(a.Length > 8 && a[8] != "" ? F(a[8]) : 0);
        Daylight.I.Settle();
    }

    public override void _Process(double delta)
    {
        if (view < 0 || view >= views.Count) return;
        ulong now = Time.GetTicksUsec();
        if (frame > Wait) times.Add((now - last) / 1000.0);
        last = now;
        frame++;
        // (the first view waits for the loading screen to go)
        if (frame < Wait + Timed + (view == 0 ? 240 : 0)) return;
        string name = views[view][0];
        Main.I.GetViewport().GetTexture().GetImage().SavePng(System.IO.Path.Combine(dir, name + ".png"));
        times.Sort();
        GD.Print($"snap {name}: {times.Average():0.00} ms a frame (p95 {times[(int)(times.Count * 0.95)]:0.00}), {RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TotalDrawCallsInFrame)} draws, {Render.Psx.ShaderCount} psx shaders");
        Next();
    }
}
