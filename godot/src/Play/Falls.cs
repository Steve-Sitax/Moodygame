using System;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;

namespace Scheldemist.Play;

/// <summary>The browser's fall hook: one report when a measured fall ends, including water landings.</summary>
[GamePart(910)]
public partial class Falls : Node
{
    public static Falls I { get; private set; } = null!;
    public event Action<float, bool, FallReply>? Answered;
    public override void _Ready() { I = this; Jef.I.Fell += OnFall; }
    public override void _ExitTree() { Jef.I.Fell -= OnFall; }
    private void OnFall(float height, bool water) => _ = Report(height, water);
    public async Task<FallReply?> Report(float height, bool water)
    {
        try
        {
            if (ServerLink.I?.Api is not { } api) return null;
            var reply = await api.Fall(height, water);
            if (!IsInsideTree()) return reply;
            GameState.I.Apply(reply);
            if (reply.Text is { Length: > 0 }) GameState.I.Say(reply.Text);
            Answered?.Invoke(height, water, reply);
            return reply;
        }
        catch (ApiException e) { if (IsInsideTree()) GameState.I.Say(e.Message); return null; }
    }
}
