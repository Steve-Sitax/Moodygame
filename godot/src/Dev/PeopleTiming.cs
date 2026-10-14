using System;
using System.Diagnostics;
using Godot;

namespace Scheldemist.Dev;

// Opt-in direct animation timing. Includes Human2's layers; layers are also reported separately.
[GamePart(221)]
public partial class PeopleTiming : Node
{
    private static bool enabled;
    private static bool profiling;
    public static readonly double[] PartsMs = new double[3];
    public static long ProfileStart() => profiling ? Stopwatch.GetTimestamp() : 0;
    public static void ProfileEnd(long start, int part) { if(start != 0) PartsMs[part] += Stopwatch.GetElapsedTime(start).TotalMilliseconds; }
    public static double LegacyMs, People2Ms, LayersMs;
    public static double LastHumanMs;
    public static double PlayerMs, PlayerOverheadMs, LastPlayerMs;
    public static int LegacyCalls, People2Calls;
    public readonly struct Scope : IDisposable
    {
        private readonly long start;
        private readonly int kind;
        private readonly double humansAtStart;
        internal Scope(int kind) { this.kind = kind; start = Stopwatch.GetTimestamp(); humansAtStart = kind == 3 ? LegacyMs + People2Ms : 0; }
        public void Dispose()
        {
            if (start == 0) return;
            double ms = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            if (kind == 3) { PlayerMs += ms; PlayerOverheadMs += Math.Max(0, ms - (LegacyMs + People2Ms - humansAtStart)); }
            else if (kind == 2) LayersMs += ms;
            else if (kind == 1) { People2Ms += ms; People2Calls++; }
            else { LegacyMs += ms; LegacyCalls++; }
        }
    }
    public static Scope Track(bool newer) => enabled ? new Scope(newer ? 1 : 0) : default;
    public static Scope Layers() => enabled ? new Scope(2) : default;
    public static Scope Player() => enabled ? new Scope(3) : default;
    public override void _Ready()
    {
        enabled = Main.I.Flag("peopletest");
        profiling = enabled && Main.I.Flag("people2-profile");
        if (enabled) RenderingServer.FramePostDraw += Reset;
        SetProcess(false);
    }
    private static void Reset() { LastHumanMs = LegacyMs + People2Ms + PlayerOverheadMs; LastPlayerMs = PlayerMs; LegacyMs = People2Ms = LayersMs = PlayerMs = PlayerOverheadMs = 0; LegacyCalls = People2Calls = 0; Array.Clear(PartsMs); }
    public override void _ExitTree() { if (enabled) RenderingServer.FramePostDraw -= Reset; enabled = false; Reset(); }
}
