using System;
using System.Collections.Generic;
using System.IO;
using System.Diagnostics.Tracing;
using System.Runtime;
using System.Threading;
using System.Text.Json;
using Godot;

namespace Scheldemist.Dev;

/// <summary>
/// Opt-in (`--gc-watch <file>`) record of every garbage collection while the town runs: its kind, generation, pause
/// lengths as the runtime reports them, the heap per generation after it, and every five seconds the heap's size.
/// Written to the file every ten seconds and at the end. Every pause (runtime suspended to resumed) also comes from the
/// runtime's GC events, so collections that end in the same frame are all counted.
/// </summary>
[GamePart(5)]
public partial class GcWatch : Node
{
    private string file = "";
    private int lastCount;
    private readonly long[] lastIndex = new long[3];
    private readonly List<object> collections = new();
    private readonly List<object> samples = new();
    private ulong nextSample, nextWrite;
    private int missed;
    private static readonly object pauseGate = new();
    private static readonly List<object> pauses = new();
    private PauseListener? listener;
    private static long frameSnapshot, clockOffsetMs;

    /// <summary>GC start (1), suspend begin (9) and restart end (3) of the runtime's GC keyword.</summary>
    private sealed class PauseListener : EventListener
    {
        private DateTime suspended, stopped, restarting;
        private int gc, depth; private uint reason, type;
        protected override void OnEventSourceCreated(EventSource source)
        {
            if (source.Name == "Microsoft-Windows-DotNETRuntime") EnableEvents(source, EventLevel.Informational, (EventKeywords)1);
        }
        protected override void OnEventWritten(EventWrittenEventArgs e)
        {
            switch (e.EventId)
            {
                case 1 when e.Payload is { Count: >= 4 } p: gc = Convert.ToInt32(p[0]); depth = Convert.ToInt32(p[1]); reason = Convert.ToUInt32(p[2]); type = Convert.ToUInt32(p[3]); break;
                case 9: suspended = e.TimeStamp; stopped = restarting = default; break;
                case 8: stopped = e.TimeStamp; break;
                case 7: restarting = e.TimeStamp; break;
                case 3 when suspended != default:
                    double ms = (e.TimeStamp - suspended).TotalMilliseconds;
                    double? suspendMs = stopped == default ? null : (stopped - suspended).TotalMilliseconds;
                    double? stoppedMs = stopped == default || restarting == default ? null : (restarting - stopped).TotalMilliseconds;
                    double? restartMs = restarting == default ? null : (e.TimeStamp - restarting).TotalMilliseconds;
                    suspended = default;
                    // Runtime events arrive on a worker. Only read managed clocks/cached frame numbers here.
                    lock (pauseGate) if (pauses.Count < 20000) pauses.Add(new { gc, generation = depth, reason, type, ms = Math.Round(ms, 3), suspendMs, stoppedMs, restartMs, frame = Volatile.Read(ref frameSnapshot), atMs = System.Environment.TickCount64 + clockOffsetMs });
                    break;
            }
        }
    }

    public override void _Ready()
    {
        file = Main.I.Arg("gc-watch");
        if (file == "") { SetProcess(false); return; }
        ProcessPriority = -1000;
        clockOffsetMs = (long)Time.GetTicksMsec() - System.Environment.TickCount64;
        Volatile.Write(ref frameSnapshot, (long)Engine.GetProcessFrames());
        collections.EnsureCapacity(4096); samples.EnsureCapacity(1024);
        lock (pauseGate) { pauses.Clear(); pauses.EnsureCapacity(4096); }
        listener = new PauseListener();
        lastCount = GC.CollectionCount(0);
        for (int k = 0; k < 3; k++) lastIndex[k] = GC.GetGCMemoryInfo((GCKind)(k + 1)).Index;
        Sample("ready");
    }

    private static readonly string[] kinds = { "ephemeral", "fullBlocking", "background" };

    public override void _Process(double delta)
    {
        Volatile.Write(ref frameSnapshot, (long)Engine.GetProcessFrames());
        int count = GC.CollectionCount(0);
        if (count != lastCount)
        {
            int seen = 0;
            for (int k = 0; k < 3; k++)
            {
                var info = GC.GetGCMemoryInfo((GCKind)(k + 1));
                if (info.Index <= lastIndex[k]) continue;
                lastIndex[k] = info.Index;
                seen++;
                if (collections.Count < 20000) collections.Add(new
                {
                    index = info.Index, kind = kinds[k], generation = info.Generation, frame = Engine.GetProcessFrames(), atMs = Time.GetTicksMsec(),
                    pauseMs = Pauses(info),
                    compacted = info.Compacted, concurrent = info.Concurrent, promotedMB = MB(info.PromotedBytes), heapMB = MB(info.HeapSizeBytes),
                    fragmentedMB = MB(info.FragmentedBytes), committedMB = MB(info.TotalCommittedBytes), pinned = info.PinnedObjectsCount,
                    afterMB = After(info),
                    latency = GCSettings.LatencyMode.ToString(),
                });
            }
            missed += Math.Max(0, count - lastCount - seen);
            lastCount = count;
        }
        ulong now = Time.GetTicksMsec();
        if (now >= nextSample) { nextSample = now + 5000; Sample("play"); }
        if (now >= nextWrite) { nextWrite = now + 10000; Write(); }
    }

    private static double[] Pauses(GCMemoryInfo info)
    {
        var list = new List<double>(2);
        foreach (var p in info.PauseDurations) if (p > TimeSpan.Zero) list.Add(Math.Round(p.TotalMilliseconds, 3));
        return list.ToArray();
    }

    /// <summary>Generation 0, 1, 2, large and pinned object heaps after the collection, MB.</summary>
    private static double[] After(GCMemoryInfo info)
    {
        var list = new List<double>(5);
        foreach (var g in info.GenerationInfo) list.Add(MB(g.SizeAfterBytes));
        return list.ToArray();
    }

    private static double MB(long bytes) => Math.Round(bytes / 1048576.0, 1);

    private void Sample(string when)
    {
        var info = GC.GetGCMemoryInfo();
        if (samples.Count >= 7200) return;
        samples.Add(new
        {
            when, loaded = Main.I.Loaded, solidFaceCacheMB = MB(World.Solid.I?.CachedFaceBytes ?? 0), frame = Engine.GetProcessFrames(), atMs = Time.GetTicksMsec(), heapMB = MB(info.HeapSizeBytes), committedMB = MB(info.TotalCommittedBytes),
            totalMemoryMB = MB(GC.GetTotalMemory(false)), allocatedMB = MB(GC.GetTotalAllocatedBytes()), pauseTotalMs = Math.Round(GC.GetTotalPauseDuration().TotalMilliseconds, 1),
            gen = new[] { GC.CollectionCount(0), GC.CollectionCount(1), GC.CollectionCount(2) }, server = GCSettings.IsServerGC, latency = GCSettings.LatencyMode.ToString(),
            afterMB = After(info),
        });
    }

    private void Write()
    {
        try
        {
            object[] paused;
            lock (pauseGate) paused = pauses.ToArray();
            File.WriteAllText(file, JsonSerializer.Serialize(new { missed, truncated = collections.Count >= 20000 || samples.Count >= 7200 || paused.Length >= 20000, collections, pauses = paused, samples }, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch (Exception e) { GD.PushWarning("gc-watch: " + e.Message); }
    }

    public override void _ExitTree() { if (file != "") { Sample("exit"); Write(); listener?.Dispose(); } }
}
