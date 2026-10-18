using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Linq;
using System.Threading;
using System.Diagnostics.Tracing;

namespace Scheldemist.Dev;

/// <summary>Opt-in CPU and managed-allocation timing, separate from normal frame measurements.</summary>
public static class FrameCost
{
    private static readonly bool Enabled = Main.I?.Flag("profile-parts") ?? false;
    private sealed class Total { public double Ms; public long Bytes; public int Calls; public double Max; }
    private static readonly Dictionary<string, Total> totals = new();
    private static int frames;
    private static readonly List<object> spikes = new();
    private static readonly object gcGate = new();
    private static readonly List<object> gcEvents = new(1024);
    private static readonly long epochTicks = Enabled ? DateTime.UtcNow.Ticks - (long)Godot.Time.GetTicksUsec() * 10 : 0;
    private static readonly RuntimeGcListener? gcListener = Enabled ? new RuntimeGcListener() : null;
    private sealed class RuntimeGcListener : EventListener
    {
        protected override void OnEventSourceCreated(EventSource source)
        {
            if (source.Name == "Microsoft-Windows-DotNETRuntime") EnableEvents(source, EventLevel.Informational, (EventKeywords)1);
        }
        protected override void OnEventWritten(EventWrittenEventArgs e)
        {
            // Runtime timestamps retain pause boundaries even when this callback runs after the pause.
            if (e.EventId is not (1 or 2 or 3 or 7 or 8 or 9)) return;
            lock (gcGate) if (gcEvents.Count < 1024) gcEvents.Add(new { name = e.EventName, id = e.EventId, atUsec = (e.TimeStamp.ToUniversalTime().Ticks - epochTicks) / 10 });
        }
    }
    private static readonly ConcurrentDictionary<Type, string> continuationNames = new();
    public static void Frame() { if (Enabled) frames++; }
    public static void InstallContext()
    {
        if (Enabled && SynchronizationContext.Current is { } context && context is not ProfileContext)
            SynchronizationContext.SetSynchronizationContext(new ProfileContext(context));
    }
    private sealed class ProfileContext(SynchronizationContext inner) : SynchronizationContext
    {
        public override void Post(SendOrPostCallback callback, object? state)
        {
            var source = state as Delegate ?? callback;
            var type = source.Target?.GetType() ?? source.Method.DeclaringType ?? state?.GetType() ?? typeof(object);
            string name = continuationNames.GetOrAdd(type, static t => "Continuation:" + t.FullName);
            inner.Post(_ =>
            {
                var previous = Current;
                SetSynchronizationContext(this);
                try { using var scope = Track(name); callback(state); }
                finally { SetSynchronizationContext(previous); }
            }, null);
        }
    }
    private static readonly Dictionary<System.Reflection.MethodInfo, string> callbackNames = new();
    public static Scope Callback(Delegate callback)
    {
        if (!Enabled) return default;
        if (!callbackNames.TryGetValue(callback.Method, out var name))
            callbackNames[callback.Method] = name = "Callback:" + callback.Method.DeclaringType?.FullName + "." + callback.Method.Name;
        return Track(name);
    }
    public readonly struct Scope : IDisposable
    {
        private readonly string? name;
        private readonly long began, bytes;
        public Scope(string name) { this.name = name; began = Stopwatch.GetTimestamp(); bytes = GC.GetAllocatedBytesForCurrentThread(); }
        public void Dispose()
        {
            if (name == null) return;
            long allocated = GC.GetAllocatedBytesForCurrentThread() - bytes;
            double ms = Stopwatch.GetElapsedTime(began).TotalMilliseconds;
            if (!totals.TryGetValue(name, out var t)) totals[name] = t = new();
            t.Ms += ms; t.Bytes += allocated; t.Calls++; t.Max = Math.Max(t.Max, ms);
            if (ms >= 2 && spikes.Count < 4096) spikes.Add(new { part = name, frame = Godot.Engine.GetProcessFrames(), ms, allocated, endedUsec = Godot.Time.GetTicksUsec() });
        }
    }
    public static Scope Track(string name) => Enabled ? new Scope(name) : default;
    public static void Clear() { totals.Clear(); spikes.Clear(); frames = 0; lock (gcGate) gcEvents.Clear(); }
    public static object[] GcEvents() { if (gcListener == null) return Array.Empty<object>(); lock (gcGate) return gcEvents.ToArray(); }
    public static object[] Spikes() => spikes.ToArray();
    public static object[] Report() => totals.OrderByDescending(p => p.Value.Ms).Select(p => (object)new { part = p.Key, mean = p.Value.Ms / p.Value.Calls, max = p.Value.Max, bytesPerCall = p.Value.Bytes / p.Value.Calls, msPerFrame = p.Value.Ms / Math.Max(1, frames), bytesPerFrame = p.Value.Bytes / Math.Max(1, frames), calls = p.Value.Calls, frames }).ToArray();
}
