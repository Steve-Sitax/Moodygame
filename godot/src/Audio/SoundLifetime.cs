using System;
using System.Threading;
using System.Threading.Tasks;
namespace Scheldemist.Audio;

public partial class Soundscape
{
    private readonly object audioWorkersGate=new();
    private readonly ManualResetEventSlim audioWorkersDone=new(true);
    private int audioWorkers;
    private bool audioClosing;
    /// <summary>Finish native resource work while Godot is still alive, before engine teardown.</summary>
    private Task AudioWork(Action work)
    {
        lock(audioWorkersGate)
        {
            if(audioClosing)return Task.CompletedTask;
            audioWorkers++;audioWorkersDone.Reset();
        }
        return Task.Run(()=>
        {
            try{work();}
            finally{lock(audioWorkersGate){if(--audioWorkers==0)audioWorkersDone.Set();}}
        });
    }
    private void StopAudioWorkers()
    {
        lock(audioWorkersGate)audioClosing=true;
        // The workers never wait for a tree callback. Closing may wait for a render already in flight;
        // normal game frames never wait here, and no worker can start after this point.
        audioWorkersDone.Wait();
        while(ready.TryDequeue(out _)){}
    }
}
