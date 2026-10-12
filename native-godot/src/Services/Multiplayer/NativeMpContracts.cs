using System;
using System.Collections.Generic;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services.Multiplayer;

public sealed record NativeMpIdentity(int Id, bool Host, bool Admin, bool Guest, string? Name);
public sealed record NativeMpAuthorization(NativeMpIdentity? Identity, int Status = 200, JsonObject? Error = null);
public sealed record NativeMpResponse(int Status, JsonObject Body);

/// <summary>Transport callbacks enqueue frames; they never wait for network IO under the game state lock.</summary>
public sealed class NativeMpPeer
{
    public required Action<string> SendText { get; init; }
    public required Action<byte[]> SendBinary { get; init; }
    public required Action<int, string> Close { get; init; }
    public Func<long> BufferedBytes { get; init; } = () => 0;
    public Func<bool> IsOpen { get; init; } = () => true;
    public Action? Ping { get; init; }
}

public sealed class NativeMpConnection
{
    internal NativeMpConnection(NativeMpPeer peer, string address, long now) => (Peer, Address, HelloBy) = (peer, address, now + 5000);
    internal readonly NativeMpPeer Peer;
    internal readonly string Address;
    internal readonly long HelloBy;
    internal NativeMpIdentity? Identity;
    internal readonly Dictionary<int, (uint Seq, long At)> Sent = new();
    internal bool Alive = true, Closed;
    internal long BytesOut;
    public int PlayerId => Identity?.Id ?? 0;
}
