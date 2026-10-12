using System;
using System.Threading.Tasks;

namespace Scheldemist.Net;

/// <summary>The game rules can live in the Godot process while keeping the same typed game contracts.</summary>
public interface ILocalGameBackend : IDisposable
{
    Task<string> Call(string method, string path, string? body);
    event Action<string>? Push;
}

/// <summary>The in-process host also accepts authenticated remote Godot clients.</summary>
public interface ILocalMultiplayerBackend : ILocalGameBackend
{
    string ServerUrl { get; }
    string HostToken { get; }
    string WorldFingerprint { get; }
}
