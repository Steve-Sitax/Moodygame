using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;

namespace Scheldemist.Dev;

/// <summary>Opt-in CPU and managed-allocation timing, separate from normal frame measurements.</summary>
public static class FrameCost
{
    private static readonly bool Enabled = Main.I.Flag("profile-parts");
    private sealed class Total { public double Ms; public long Bytes; public int Calls; public double Max; }
    private static readonly Dictionary<string, Total> totals = new();
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
    public static void Clear() => totals.Clear();
    public static object[] Report() => totals.OrderByDescending(p => p.Value.Ms).Select(p => (object)new { part = p.Key, mean = p.Value.Ms / p.Value.Calls, max = p.Value.Max, bytesPerFrame = p.Value.Bytes / p.Value.Calls, calls = p.Value.Calls }).ToArray();
}
