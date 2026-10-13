using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using Godot;

namespace Scheldemist.People;

// Includes busy-square arrival/spawns, rather than measuring only settled animation.
[GamePart(222)]
internal partial class People2SpawnTrace : Node
{
    private readonly record struct Sample(ulong Frame, double WallMs, double ProcessMs, double UploadMs, double MakeMs, double AnimationMs, int Pending, long Uploads);
    private readonly List<Sample> samples = new(24000);
    private string output = "";
    private ulong last;
    private Town.Townspeople? town;
    private bool started;
    public override void _Ready()
    {
        output = Main.I.Arg("people2-spawn-trace");
        if (output == "" && Main.I.Flag("peopletest") && People2.Enabled) output = Paths.TestOutput("peopletest");
        if (output == "") { SetProcess(false); return; }
        town = Main.I.GetNodeOrNull<Town.Townspeople>("Townspeople");
        last = Time.GetTicksUsec(); RenderingServer.FramePostDraw += Record;
    }
    private void Record()
    {
        ulong now = Time.GetTicksUsec();
        if (!started && Main.I.Loaded && town?.Data != null) { started = true; last = now; return; }
        if (started && samples.Count < 24000)
            samples.Add(new Sample(Engine.GetProcessFrames(), (now-last)/1000.0, Performance.GetMonitor(Performance.Monitor.TimeProcess)*1000, People2Faces.LastUploadMs, People2.MakeMsThisFrame, Dev.PeopleTiming.LastHumanMs, People2Faces.Pending, People2Faces.UploadCount));
        last = now;
    }
    public override void _ExitTree()
    {
        if (output == "") return;
        RenderingServer.FramePostDraw -= Record;
        Directory.CreateDirectory(output);
        var builds = samples.Where(s => s.UploadMs > 0).ToArray();
        File.WriteAllText(Path.Combine(output, "people2-spawn-trace.json"), JsonSerializer.Serialize(new
        {
            budgetMs = 16.7, samples, builds = builds.Length, worstFrameMs = samples.Count > 0 ? samples.Max(s => s.WallMs) : 0,
            worstBuildFrameMs = builds.Length > 0 ? builds.Max(s => s.WallMs) : 0,
            worstUploadMs = People2Faces.MaxBakeMs, worstWorkerMs = People2Faces.MaxWorkerMs,
            uploadMeanMs = People2Faces.BakeCount > 0 ? People2Faces.BakeMs/People2Faces.BakeCount : 0,
            buildFramesOverBudget = builds.Count(s => s.ProcessMs > 16.7),
            worstPeopleCpuMs = samples.Count > 0 ? samples.Max(s => s.UploadMs+s.MakeMs+s.AnimationMs) : 0,
            peopleCpuFramesOverBudget = samples.Count(s => s.UploadMs+s.MakeMs+s.AnimationMs > 16.7),
            maxUploadsPerFrame = samples.Count > 1 ? samples.Skip(1).Select((s,i) => s.Uploads-samples[i].Uploads).Max() : 0,
        }, new JsonSerializerOptions { WriteIndented = true }));
    }
}
