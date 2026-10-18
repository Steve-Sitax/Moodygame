using System;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Dev;

/// <summary>Shared with native proof helpers. A contaminated sample is evidence, never a budget pass.</summary>
public sealed class PerformanceLease : IDisposable
{
    private const string LockPath="D:/Code/_locks/PERF-LOCK";
    private readonly string owner;
    private readonly string receipt=Guid.NewGuid().ToString("N");
    private bool held;
    private readonly CancellationTokenSource stop=new();
    private readonly ConcurrentDictionary<int,string> windows=new();
    private Task? monitor;
    private bool disposed;
    private PerformanceLease(string owner)=>this.owner=(Environment.GetEnvironmentVariable("SCHELDEMIST_PERF_OWNER") is {Length:>0} bundle?bundle+" / ":"")+owner;
    public bool Isolated=>held&&windows.IsEmpty;
    public object Report()=>new{lockPath=LockPath,lockAcquired=held,owner,isolated=Isolated,concurrentGodotWindows=windows.OrderBy(p=>p.Key).Select(p=>new{pid=p.Key,title=p.Value}).ToArray()};
    public static async Task<PerformanceLease> Acquire(string owner)
    {
        var lease=new PerformanceLease(owner);Directory.CreateDirectory(Path.GetDirectoryName(LockPath)!);
        var deadline=DateTime.UtcNow.AddMinutes(20);
        do
        {
            try
            {
                using var file=new FileStream(LockPath,FileMode.CreateNew,FileAccess.Write,FileShare.Read);
                using var writer=new StreamWriter(file);writer.WriteLine($"{lease.owner} pid {Environment.ProcessId} {lease.receipt}");lease.held=true;break;
            }
            catch(IOException) when(File.Exists(LockPath))
            {
                if(DateTime.UtcNow>=deadline)break;
                Godot.GD.Print($"PERF_LOCK_WAIT: {owner}; {LockPath}");await Task.Delay(TimeSpan.FromSeconds(30));
            }
        }while(true);
        if(!lease.held)Godot.GD.PushWarning("PERF-LOCK unavailable for 20 minutes; measuring without an accepted isolated gate.");
        lease.Observe();
        lease.monitor=Task.Run(async()=>{try{while(true){await Task.Delay(1000,lease.stop.Token);lease.Observe();}}catch(OperationCanceledException){}});
        return lease;
    }
    private void Observe()
    {
        foreach(var process in Process.GetProcesses())
        using(process)
        {
            try{if(process.Id!=Environment.ProcessId&&process.ProcessName.Contains("Godot",StringComparison.OrdinalIgnoreCase)&&process.MainWindowHandle!=IntPtr.Zero)windows.TryAdd(process.Id,process.MainWindowTitle);}
            catch(InvalidOperationException){} // the other helper closed its own window
            catch(System.ComponentModel.Win32Exception){} // protected system processes are not inspectable
        }
    }
    public void Dispose()
    {
        if(disposed)return;disposed=true;
        stop.Cancel();monitor?.GetAwaiter().GetResult();Observe();
        Godot.GD.Print("PERF_ISOLATION: "+System.Text.Json.JsonSerializer.Serialize(Report()));
        if(held){if(File.Exists(LockPath)&&File.ReadAllText(LockPath).Contains(receipt))File.Delete(LockPath);held=false;}
        stop.Dispose();
    }
}
