using System;
using System.Threading;
using System.Threading.Tasks;
using Scheldemist.Net;

namespace Scheldemist.Native.World;

public sealed class NativeHostedBackend : ILocalMultiplayerBackend
{
    private readonly NativeBackendAdapter local;
    private readonly NativeNetworkHost network;
    private int disposed;
    public string ServerUrl => network.Url;
    public string HostToken { get; }
    public string WorldFingerprint { get; }
    public NativeHostedBackend(NativeBackendAdapter local, NativeNetworkHost network, string token, string fingerprint)
    { this.local = local; this.network = network; HostToken = token; WorldFingerprint = fingerprint; }
    public event Action<string>? Push { add => local.Push += value; remove => local.Push -= value; }
    public Task<string> Call(string method, string path, string? body) => local.Call(method, path, body);
    public void Dispose()
    {
        if (Interlocked.Exchange(ref disposed, 1) != 0) return;
        network.Dispose(); local.Dispose();
        Godot.GD.Print("native gameplay database closed");
    }
}
