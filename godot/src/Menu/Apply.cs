using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Game;
using Scheldemist.Ui;

namespace Scheldemist.Menu;

/// <summary>
/// The settings put to work (the browser's menu/apply.ts): every change in the menu reaches the game at once.
///
/// What each setting does in Godot today:
/// - Lines drawn, Render scale, PS1 wobble, PS1 colours: Main.SetPicture (the world's viewport, the snap grid
///   `psx_snap_res`, the retro pass's `levels`).
/// - Frame cap: Engine.MaxFps. Show the frame time: a small counter top right. Full screen: the window's mode.
/// - The five sound levels: the audio buses Master, Music, Ambience, Voices, Effects (made here when missing; the
///   sound's part plays into them by name).
/// - Field of view: the camera in use. Mouse speed, up and down turned round, head bob, view distance, speech
///   bubbles: `Tuning` (the player's, the sky's and the bubbles' parts read it).
/// - Text size, High-contrast paper, Reduce motion: the kit (Kit.SetLook): every paper builds again.
/// - The rest (rooms, people in the street, reflections, lantern shadows, light budget, particles, the corner map,
///   colour-safe markers, autosave) are kept and told (`Prefs.Changed`); their parts read them when they are ported.
/// </summary>
public static class Apply
{
    /// <summary>The sound's buses beside Master, by the setting that sets each.</summary>
    public static readonly (string pref, string bus)[] Buses = { ("music", "Music"), ("ambience", "Ambience"), ("voices", "Voices"), ("effects", "Effects") };

    private static bool wired;

    /// <summary>Before the town loads: the picture's size and what needs no world.</summary>
    public static void Early()
    {
        if (wired) return;
        wired = true;
        Prefs.Changed += OnChanged;
        All();
    }

    private static void OnChanged(IReadOnlyList<string> keys) => Some(keys);

    public static void All() => Some(null);

    private static void Some(IReadOnlyList<string>? changed)
    {
        bool Has(params string[] k) => changed == null || k.Any(changed.Contains);
        var main = Main.I;
        if (Has("height", "scale", "wobble", "psxColour")) main.SetPicture((int)Prefs.Num("height"), (float)Prefs.Num("scale"), Prefs.Bool("wobble"), Prefs.Bool("psxColour"));
        if (Has("frameCap") && !TestRun) Engine.MaxFps = (int)Prefs.Num("frameCap");
        if (Has("fullscreen") && !TestRun)
        {
            bool full = DisplayServer.WindowGetMode() is DisplayServer.WindowMode.Fullscreen or DisplayServer.WindowMode.ExclusiveFullscreen;
            if (full != Prefs.Bool("fullscreen")) DisplayServer.WindowSetMode(Prefs.Bool("fullscreen") ? DisplayServer.WindowMode.Fullscreen : DisplayServer.WindowMode.Windowed);
        }
        if (Has("master", "music", "ambience", "voices", "effects")) Sound();
        if (Has("fov")) Fov();
        if (Has("sens", "invertY", "headBob", "reduceMotion", "view", "bubbles"))
        {
            Tuning.Sens = (float)Prefs.Num("sens");
            Tuning.InvertY = Prefs.Bool("invertY");
            Tuning.Bob = Prefs.Bool("headBob") && !Prefs.Bool("reduceMotion") ? 1 : 0;
            Tuning.ViewFar = (float)Prefs.Num("view");
            Tuning.Bubbles = (float)Prefs.Num("bubbles");
        }
        if (Has("textSize", "contrast", "reduceMotion")) Kit.SetLook(main.GetViewport().GetVisibleRect().Size, (float)Prefs.Num("textSize"), Prefs.Bool("contrast"), Prefs.Bool("reduceMotion"));
    }

    /// <summary>A test's own run keeps its window and its frame rate whatever the settings say.</summary>
    private static bool TestRun => Main.I.Arg("menutest") != "";

    /// <summary>The camera in use sees as wide as the setting says (a part that brings its own camera gets it too: the menu's part calls this now and then).</summary>
    public static void Fov()
    {
        if (Main.I?.Cam is { } cam && GodotObject.IsInstanceValid(cam) && Math.Abs(cam.Fov - (float)Prefs.Num("fov")) > 0.01f) cam.Fov = (float)Prefs.Num("fov");
    }

    /// <summary>The sound's levels: each a bus by name, made when the sound's part has not made it yet.</summary>
    public static void Sound()
    {
        SetBus("Master", Prefs.Num("master"));
        foreach (var (pref, bus) in Buses)
        {
            if (AudioServer.GetBusIndex(bus) < 0)
            {
                AudioServer.AddBus();
                int i = AudioServer.BusCount - 1;
                AudioServer.SetBusName(i, bus);
                AudioServer.SetBusSend(i, "Master");
            }
            SetBus(bus, Prefs.Num(pref));
        }
    }

    private static void SetBus(string name, double level)
    {
        int i = AudioServer.GetBusIndex(name);
        if (i < 0) return;
        AudioServer.SetBusMute(i, level <= 0.001);
        AudioServer.SetBusVolumeDb(i, level <= 0.001 ? -80 : Mathf.LinearToDb((float)level));
    }

    // ------------------------------------------------------------------ frames: measured, and the first run's test

    /// <summary>The game's frames while Jef plays: frames a second, ms a frame, ms of the game's own work.</summary>
    public static double Fps, Interval, Work;
    public static int Samples;
    private static List<double>? bench;
    private static int benchSkip;
    /// <summary>The test chose a quality: (preset, frames a second).</summary>
    public static event Action<string, int>? Benchmarked;
    public static bool BenchmarkRunning => bench != null;

    /// <summary>Time the next 5 seconds of play and choose a quality: 42 frames a second or better stays High, 24 or better Medium, slower Low.</summary>
    public static void RunBenchmark()
    {
        bench = new List<double>();
        benchSkip = 45; // the first frames after a start are the shaders' and the textures'
    }

    /// <summary>One frame of play went by (the menu's part calls it, only while Jef plays).</summary>
    public static void Frame(double delta)
    {
        double iv = delta * 1000;
        if (iv <= 0 || iv >= 500) return;
        double k = Samples < 30 ? 0.3 : 0.05;
        Interval += (iv - Interval) * k;
        Work += (Performance.GetMonitor(Performance.Monitor.TimeProcess) * 1000 - Work) * k;
        Fps = 1000 / Math.Max(1, Interval);
        Samples++;
        if (bench == null || benchSkip-- > 0) return;
        bench.Add(iv);
        if (bench.Count < 240 && bench.Sum() < 5000) return;
        bench.Sort();
        double fps = 1000 / bench[bench.Count / 2];
        bench = null;
        string preset = fps >= 42 ? "high" : fps >= 24 ? "medium" : "low";
        Prefs.Preset(preset);
        Prefs.Set("benchDone", true, true);
        Benchmarked?.Invoke(preset, (int)Math.Round(fps));
    }
}
