using System;
using System.Diagnostics;
using Godot;

namespace Scheldemist.Dev;

// Opt-in direct animation timing. Includes Human2's layers; layers are also reported separately.
[GamePart(221)]
public partial class PeopleTiming : Node
{
    private static bool enabled;
    public static double LegacyMs, People2Ms, LayersMs;
    public static int LegacyCalls, People2Calls;
    public readonly struct Scope : IDisposable
    {
        private readonly long start;
        private readonly int kind;
        internal Scope(int kind) { this.kind = kind; start = Stopwatch.GetTimestamp(); }
        public void Dispose()
        {
            if (start == 0) return;
            double ms = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            if (kind == 2) LayersMs += ms;
            else if (kind == 1) { People2Ms += ms; People2Calls++; }
            else { LegacyMs += ms; LegacyCalls++; }
        }
    }
    public static Scope Track(bool newer) => enabled ? new Scope(newer ? 1 : 0) : default;
    public static Scope Layers() => enabled ? new Scope(2) : default;
    public override void _Ready()
    {
        enabled = Main.I.Flag("peopletest");
        if (enabled) RenderingServer.FramePostDraw += Reset;
        SetProcess(false);
    }
    private static void Reset() { LegacyMs = People2Ms = LayersMs = 0; LegacyCalls = People2Calls = 0; }
    public override void _ExitTree() { if (enabled) RenderingServer.FramePostDraw -= Reset; enabled = false; Reset(); }
}
