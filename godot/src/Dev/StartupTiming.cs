using System;
using System.Collections.Generic;
using System.Linq;
using Godot;

namespace Scheldemist.Dev;

/// <summary>Opt-in process-relative startup trace, including nested stages and every game part.</summary>
public static class StartupTiming
{
    public sealed record Entry(string Stage,ulong StartMs,ulong EndMs) { public ulong DurationMs=>EndMs-StartMs; }
    private static readonly bool Enabled=OS.GetCmdlineUserArgs().Any(a=>a is "--startup-profile" or "--startup-proof");
    private static readonly List<Entry> entries=new();
    private sealed class Span(string stage) : IDisposable
    {
        private readonly ulong start=Time.GetTicksMsec();
        public void Dispose()=>Record(new(stage,start,Time.GetTicksMsec()));
    }
    private static void Record(Entry entry)
    {
        lock(entries)entries.Add(entry);
        GD.Print($"startup profile: {entry.EndMs} ms: {entry.Stage}: {entry.DurationMs} ms");
    }
    public sealed class Sequence(string prefix) : IDisposable
    {
        private ulong last=Time.GetTicksMsec();
        public void Next(string stage){ulong now=Time.GetTicksMsec();Record(new(prefix+"."+stage,last,now));last=now;}
        public void Dispose()=>Next("finish");
    }
    public static Sequence? Split(string stage)=>Enabled?new Sequence(stage):null;
    public static IDisposable? Measure(string stage)=>Enabled?new Span(stage):null;
    public static void Mark(string stage) { if(Enabled){ulong now=Time.GetTicksMsec();Record(new(stage,now,now));} }
    public static Entry[] Snapshot(){lock(entries)return entries.ToArray();}
}
