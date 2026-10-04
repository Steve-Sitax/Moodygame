using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Threading;

namespace Scheldemist.Dev;

/// <summary>Opt-in CPU and managed-allocation timing, separate from normal frame measurements.</summary>
public static class FrameCost
{
    private static readonly bool Enabled = Main.I.Flag("profile-parts");
    private sealed class Total { public double Ms; public long Bytes; public int Calls; public double Max; }
    private static readonly Dictionary<string, Total> totals = new();
    private static int frames;
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
            inner.Post(_ =>
            {
                var previous = Current;
                SetSynchronizationContext(this);
                try { using var scope = Track("Continuation:" + (state?.GetType().FullName ?? callback.Method.DeclaringType?.FullName)); callback(state); }
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
        }
    }
    public static Scope Track(string name) => Enabled ? new Scope(name) : default;
    public static void Clear() { totals.Clear(); frames = 0; }
    public static object[] Report() => totals.OrderByDescending(p => p.Value.Ms).Select(p => (object)new { part = p.Key, mean = p.Value.Ms / p.Value.Calls, max = p.Value.Max, bytesPerCall = p.Value.Bytes / p.Value.Calls, msPerFrame = p.Value.Ms / Math.Max(1, frames), bytesPerFrame = p.Value.Bytes / Math.Max(1, frames), calls = p.Value.Calls, frames }).ToArray();
}
