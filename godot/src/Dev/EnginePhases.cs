using System;
using System.Collections.Generic;
using System.Linq;
using System.Diagnostics.Tracing;
using System.Runtime.InteropServices;
using Godot;

namespace Scheldemist.Dev;

/// <summary>
/// Opt-in (`--engine-phases`) split of a whole frame between the engine's own signals, for frames that C# timing cannot
/// explain: the physics-frame handlers, all _PhysicsProcess calls, the physics tail (timers, freed nodes, deferred calls,
/// the Jolt step), the process-frame handlers (awaited signals resume here), all _Process calls, the process tail and the
/// render submission. Each slow frame keeps its split, the main thread's CPU cycles (a stalled thread burns none), the
/// nodes added and freed, the physics monitors, and the runtime's JIT and assembly loads on the main thread.
/// </summary>
public static partial class EnginePhases
{
    [DllImport("kernel32.dll")] private static extern IntPtr GetCurrentThread();
    [DllImport("kernel32.dll")] private static extern uint GetCurrentThreadId();
    [DllImport("kernel32.dll")] private static extern bool QueryThreadCycleTime(IntPtr thread, out ulong cycles);

    private enum Mark { PhysicsSignal, PhysicsFirst, PhysicsLast, ProcessSignal, ProcessFirst, ProcessLast, PreDraw, PostDraw }
    private static readonly string[] segmentNames = { "physicsSignalHandlers", "physicsProcess", "physicsTail", "processSignalHandlers", "process", "processTail", "renderSubmission" };
    private static readonly ulong[] marks = new ulong[8];
    private static ulong frameBegin, cyclesBegin, lastPostDraw;
    private static int physicsSteps;
    private static ulong gapCycles, cyclesAtEnd;
    private static double nodesAtBegin, objectsAtBegin;
    private static readonly List<object> slow = new();
    private static readonly List<double> walls = new();
    private static double thresholdMs = 25;
    private static uint mainThreadId;
    private static bool started;
    private static JitListener? jit;
    private static readonly object jitGate = new();
    private static readonly List<(ulong atUsec, string what)> jitEvents = new(4096);
    private static long epochTicks;

    private sealed partial class Edge : Node
    {
        public bool First;
        public override void _PhysicsProcess(double delta) => Stamp(First ? Mark.PhysicsFirst : Mark.PhysicsLast);
        public override void _Process(double delta) => Stamp(First ? Mark.ProcessFirst : Mark.ProcessLast);
    }

    private sealed class JitListener(bool jitEvents, bool allocations) : EventListener
    {
        private readonly bool jit = jitEvents, alloc = allocations;
        protected override void OnEventSourceCreated(EventSource source)
        {
            // JIT (0x10) and loader (0x8) keywords for method names; GC (0x1) verbose for allocation ticks and GC starts.
            if (source.Name != "Microsoft-Windows-DotNETRuntime") return;
            long keywords = 0;
            if (jit) keywords |= 0x18;
            if (alloc) keywords |= 0x1;
            EnableEvents(source, EventLevel.Verbose, (EventKeywords)keywords);
        }
        protected override void OnEventWritten(EventWrittenEventArgs e)
        {
            if (e.Payload == null) return;
            bool main = (uint)e.OSThreadId == mainThreadId;
            ulong at = (ulong)((e.TimeStamp.ToUniversalTime().Ticks - epochTicks) / 10);
            if (e.EventName is "GCAllocationTick_V4" or "GCAllocationTick_V3")
            {
                string type = e.PayloadNames!.IndexOf("TypeName") is int t and >= 0 ? e.Payload[t]?.ToString() ?? "?" : "?";
                long amount = e.PayloadNames.IndexOf("AllocationAmount64") is int m and >= 0 ? Convert.ToInt64(e.Payload[m]) : 100000;
                string key = (main ? "main " : "other ") + type;
                lock (jitGate) { allocationTicks[key] = allocationTicks.GetValueOrDefault(key) + amount; if (main) mainTickBytes += amount; else otherTickBytes += amount; }
                return;
            }
            if (e.EventName == "GCStart_V2")
            {
                lock (jitGate) if (gcStarts.Count < 4000) gcStarts.Add(new { atUsec = at, mainThread = main, osThread = e.OSThreadId, depth = e.Payload[1], reason = e.Payload[2] });
                return;
            }
            if (e.EventName == "GCEnd_V1")
            {
                lock (jitGate) if (gcStarts.Count < 4000) gcStarts.Add(new { atUsec = at, end = true, depth = e.Payload[1] });
                return;
            }
            if (!main || !jit) return;
            string? what = e.EventName switch
            {
                "MethodJittingStarted_V1" => "jit " + e.Payload[4] + "." + e.Payload[5],
                "AssemblyLoadStart" or "AssemblyLoadStart_V1" => "load " + e.Payload[1],
                "ModuleLoad_V2" => "module " + e.Payload[5],
                _ => null
            };
            if (what == null) return;
            lock (jitGate) if (EnginePhases.jitEvents.Count < 200000) EnginePhases.jitEvents.Add((at, what));
        }
    }
    private static readonly Dictionary<string, long> allocationTicks = new();
    private static readonly List<object> gcStarts = new();
    private static long mainTickBytes, otherTickBytes;

    public static bool Enabled { get; private set; }
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, long[]> calls = new();
    /// <summary>A server call and its reply size, counted while the split runs (what makes the background garbage).</summary>
    public static void CountCall(string method, string path, int replyChars)
    {
        if (!Enabled || !armed) return;
        int q = path.IndexOf('?'); string key = method + " " + (q >= 0 ? path[..q] : path);
        var c = calls.GetOrAdd(key, _ => new long[2]);
        System.Threading.Interlocked.Increment(ref c[0]); System.Threading.Interlocked.Add(ref c[1], replyChars);
    }

    /// <summary>Starts the split on the tree; frames at or over thresholdMs keep their detail.</summary>
    public static void Start(Node host, double threshold = 25, string signalDir = "")
    {
        if (started) return;
        started = Enabled = true;
        thresholdMs = threshold;
        mainThreadId = GetCurrentThreadId();
        epochTicks = DateTime.UtcNow.Ticks - (long)Time.GetTicksUsec() * 10;
        if (Main.I.Flag("engine-phases-stacks") && signalDir != "") StartWatchdog(signalDir);
        if (Main.I.Flag("engine-phases-jit") || Main.I.Flag("engine-phases-alloc")) jit = new JitListener(Main.I.Flag("engine-phases-jit"), Main.I.Flag("engine-phases-alloc"));
        var tree = host.GetTree();
        var first = new Edge { First = true, Name = "EnginePhasesFirst", ProcessPriority = int.MinValue, ProcessPhysicsPriority = int.MinValue };
        var last = new Edge { First = false, Name = "EnginePhasesLast", ProcessPriority = int.MaxValue, ProcessPhysicsPriority = int.MaxValue };
        host.AddChild(first); host.AddChild(last);
        tree.PhysicsFrame += () => { Begin(); physicsSteps++; Stamp(Mark.PhysicsSignal); };
        tree.ProcessFrame += () => { Begin(); Stamp(Mark.ProcessSignal); };
        RenderingServer.FramePreDraw += () => Stamp(Mark.PreDraw);
        RenderingServer.FramePostDraw += End;
    }

    private static void Stamp(Mark m)
    {
        // A second physics step in one frame keeps the first step's marks: its time falls in the physics tail.
        ulong now = Time.GetTicksUsec();
        if (m == Mark.ProcessFirst) System.Threading.Volatile.Write(ref processStamp, System.Diagnostics.Stopwatch.GetTimestamp());
        else if (m == Mark.ProcessLast) System.Threading.Volatile.Write(ref processStamp, 0);
        if (m is Mark.PhysicsSignal or Mark.PhysicsFirst or Mark.PhysicsLast && marks[(int)m] != 0) return;
        marks[(int)m] = now;
    }

    private static void Begin()
    {
        if (frameBegin != 0) return;
        frameBegin = Time.GetTicksUsec();
        QueryThreadCycleTime(GetCurrentThread(), out ulong cyclesNow);
        gapCycles = cyclesAtEnd == 0 ? 0 : cyclesNow - cyclesAtEnd;
        // node and object counts at the frame's start (a handler on every added node would wrap each one in C#)
        nodesAtBegin = Performance.GetMonitor(Performance.Monitor.ObjectNodeCount); objectsAtBegin = Performance.GetMonitor(Performance.Monitor.ObjectCount);
        QueryThreadCycleTime(GetCurrentThread(), out cyclesBegin);
    }

    private static void End()
    {
        ulong now = Time.GetTicksUsec();
        QueryThreadCycleTime(GetCurrentThread(), out ulong cycles);
        marks[(int)Mark.PostDraw] = now;
        double wall = lastPostDraw == 0 ? 0 : (now - lastPostDraw) / 1000.0;
        double inside = frameBegin == 0 ? 0 : (now - frameBegin) / 1000.0;
        if (frameBegin != 0 && walls.Count < 100000) walls.Add(inside);
        if (frameBegin != 0 && (inside >= thresholdMs || wall >= thresholdMs) && slow.Count < 400)
        {
            var split = new Dictionary<string, double>();
            ulong prev = frameBegin;
            for (int i = 0; i < segmentNames.Length; i++)
            {
                ulong at = marks[i + 1];
                if (at == 0 || at < prev) { split[segmentNames[i]] = -1; continue; }
                split[segmentNames[i]] = Math.Round((at - prev) / 1000.0, 3);
                prev = at;
            }
            List<string> runtime = new();
            lock (jitGate)
                foreach (var (atUsec, what) in jitEvents)
                    if (atUsec >= frameBegin && atUsec <= now && runtime.Count < 400) runtime.Add(what);
            int runtimeCount = 0;
            lock (jitGate) foreach (var (atUsec, _) in jitEvents) if (atUsec >= frameBegin && atUsec <= now) runtimeCount++;
            slow.Add(new
            {
                frame = Engine.GetProcessFrames(), beganUsec = frameBegin, wallMs = Math.Round(wall, 3), insideMs = Math.Round(inside, 3),
                mainThreadMegacycles = Math.Round((cycles - cyclesBegin) / 1e6, 2), gapBeforeMs = Math.Round((frameBegin - lastPostDraw) / 1000.0, 3), gapMegacycles = Math.Round(gapCycles / 1e6, 2), physicsSteps, split, nodesChange = Performance.GetMonitor(Performance.Monitor.ObjectNodeCount) - nodesAtBegin,
                objectsChange = Performance.GetMonitor(Performance.Monitor.ObjectCount) - objectsAtBegin,
                objects = Performance.GetMonitor(Performance.Monitor.ObjectCount), nodes = Performance.GetMonitor(Performance.Monitor.ObjectNodeCount),
                resources = Performance.GetMonitor(Performance.Monitor.ObjectResourceCount),
                physicsActive = Performance.GetMonitor(Performance.Monitor.Physics3DActiveObjects), physicsPairs = Performance.GetMonitor(Performance.Monitor.Physics3DCollisionPairs),
                physicsIslands = Performance.GetMonitor(Performance.Monitor.Physics3DIslandCount),
                gc = new[] { GC.CollectionCount(0), GC.CollectionCount(1), GC.CollectionCount(2) },
                runtimeEvents = runtimeCount, runtime
            });
        }
        Array.Clear(marks);
        frameBegin = 0; physicsSteps = 0;
        lastPostDraw = now; cyclesAtEnd = cycles;
    }

    private static long processStamp;
    private static volatile bool armed;
    /// <summary>
    /// For an outside sampler (a process snapshot reading the main thread's stack): writes "pid tid" to the folder and
    /// signals the named event Scheldemist-stall-pid while the frame's _Process calls have run longer than 30 ms.
    /// </summary>
    private static void StartWatchdog(string dir)
    {
        int pid = OS.GetProcessId();
        var signal = new System.Threading.EventWaitHandle(false, System.Threading.EventResetMode.AutoReset, "Scheldemist-stall-" + pid);
        System.IO.File.WriteAllText(System.IO.Path.Combine(dir, "engine-phases-main.txt"), pid + " " + mainThreadId);
        var thread = new System.Threading.Thread(() =>
        {
            for (;;)
            {
                System.Threading.Thread.Sleep(10);
                long began = System.Threading.Volatile.Read(ref processStamp);
                if (armed && began != 0 && System.Diagnostics.Stopwatch.GetElapsedTime(began).TotalMilliseconds > 30) signal.Set();
            }
        }) { IsBackground = true, Name = "engine phases watchdog" };
        thread.Start();
    }

    /// <summary>The slow frames so far and the inside-frame times; Clear starts a new sample.</summary>
    public static object Report()
    {
        var sorted = new List<double>(walls); sorted.Sort();
        double P(double q) => sorted.Count == 0 ? 0 : sorted[Math.Min(sorted.Count - 1, (int)(q * sorted.Count))];
        int jitTotal; object[] ticks, gcs; long mainBytes, otherBytes;
        lock (jitGate)
        {
            jitTotal = jitEvents.Count; gcs = gcStarts.ToArray(); mainBytes = mainTickBytes; otherBytes = otherTickBytes;
            var top = new List<KeyValuePair<string, long>>(allocationTicks); top.Sort((a, b) => b.Value.CompareTo(a.Value));
            ticks = top.GetRange(0, Math.Min(80, top.Count)).ConvertAll(p => (object)new { type = p.Key, sampledBytes = p.Value }).ToArray();
        }
        return new { thresholdMs, frames = walls.Count, p50 = P(0.5), p95 = P(0.95), max = sorted.Count == 0 ? 0 : sorted[^1], jitTracked = jit != null, runtimeEventsKept = jitTotal,
            sampledAllocationBytes = new { main = mainBytes, other = otherBytes },
            serverCalls = calls.OrderByDescending(c => c.Value[1]).Take(40).Select(c => new { call = c.Key, count = c.Value[0], replyChars = c.Value[1] }).ToArray(), allocationTicks = ticks, gcs, slow = slow.ToArray() };
    }
    public static void Clear() { armed = true; slow.Clear(); walls.Clear(); calls.Clear(); lock (jitGate) { jitEvents.Clear(); allocationTicks.Clear(); gcStarts.Clear(); mainTickBytes = otherTickBytes = 0; } }
}
