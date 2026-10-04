using System.Threading.Tasks;

namespace Scheldemist.Net;

public sealed record FallReply : JobsPayload
{
    public int Hurt { get; init; }
    public string? Text { get; init; }
}

public sealed partial class Api
{
    /// <summary>Only height and landing surface are reported. The server decides health and words.</summary>
    public Task<FallReply> Fall(float height, bool water) => Post<FallReply>("api/fall", new { height, water });
    public Task<TransportText> Timetable(string stop) => Post<TransportText>("api/ride", new { action = "timetable", stop });
}

public sealed record TransportText { public string Text { get; init; } = ""; }
