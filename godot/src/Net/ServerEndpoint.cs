using System;

namespace Scheldemist.Net;

/// <summary>The native rules run in this Godot process, or in an authenticated remote Godot server.</summary>
public sealed record ServerEndpoint(string Url, bool Own)
{
    public int Port => Uri.TryCreate(Url, UriKind.Absolute, out var address) ? address.Port : 0;
    public int Pid => Own ? Environment.ProcessId : 0;
    public string LogFile => Paths.EngineLog;
}
