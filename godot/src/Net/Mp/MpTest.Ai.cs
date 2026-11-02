using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Scheldemist.Menu;

namespace Scheldemist.Net.Mp;

/// <summary>--mpai (with --mpconversation; the host runs with AI on, a fake provider): the AI switch for a guest.
/// The guest reads the host's AI state, may not change it, and follows the host's switch at once (the "ai" push);
/// its talk turns get typing exactly when the host's AI can answer.</summary>
public partial class MpTest
{
    private async Task<bool> HostAi(string npc)
    {
        var api = ServerLink.I!.Api!;
        AiState.Update(await api.AiConfig());
        var steps = new List<object>();
        MovingWrite("mp-ai-1.json", new { npc, mode = AiState.Mode, state = AiState.State });
        var first = await MovingRead("mp-ai-guest-1.json", 60);
        await Switch(api, "walk");
        bool off = await Until(() => AiState.Known && !AiState.On, 15);
        MovingWrite("mp-ai-2.json", new { npc, mode = AiState.Mode });
        var second = await MovingRead("mp-ai-guest-2.json", 60);
        await Switch(api, "ai");
        bool on = await Until(() => AiState.On, 15);
        MovingWrite("mp-ai-3.json", new { npc, mode = AiState.Mode });
        var third = await MovingRead("mp-ai-guest-3.json", 60);
        bool G(JsonElement? e, string k) => e?.TryGetProperty(k, out var v) == true && v.ValueKind == JsonValueKind.True;
        var checks = new[]
        {
            new { name = "guest sees the host's AI on and ready", pass = G(first, "sees_on") },
            new { name = "guest may not change the host's AI (403)", pass = G(first, "refused") },
            new { name = "guest may type while the host's AI is on", pass = G(first, "free") },
            new { name = "host switch off takes effect at once", pass = off },
            new { name = "guest hears AI off without a restart", pass = G(second, "sees_off") },
            new { name = "guest gets choices only while AI is off", pass = G(second, "no_typing") },
            new { name = "host switch on again", pass = on },
            new { name = "guest hears AI on again and may type", pass = G(third, "sees_on") && G(third, "free") },
        };
        doc["ai_checks"] = checks;
        doc["ai_guest"] = new[] { first, second, third };
        return checks.All(c => c.pass);
    }

    /// <summary>The host's switch: the menu item when the menus run, else the same server call it makes.</summary>
    private static async Task Switch(Api api, string mode)
    {
        if (MainMenu.I != null) { MainMenu.I.ToggleAi(); return; }
        AiState.Update(await api.PutAiConfig(new Dictionary<string, object?> { ["mode"] = mode }));
    }

    private async Task<bool> GuestAi()
    {
        var api = ServerLink.I!.Api!;
        var row = await MovingRead("mp-ai-1.json", 120);
        if (row == null) return Fail("host did not start the AI step");
        string npc = row.Value.GetProperty("npc").GetString()!;
        AiState.Update(await api.AiConfig());
        bool seesOn = AiState.On && AiState.State == "ready" && !AiState.Host;
        bool refused = false;
        try { await api.PutAiConfig(new Dictionary<string, object?> { ["mode"] = "walk" }); }
        catch (ApiException e) { refused = e.Status == 403; }
        var open = await api.Talk(npc, "open");
        MovingWrite("mp-ai-guest-1.json", new { seesOn, refused, free = open.Free == true && AiState.AllowsTyping, mode = AiState.Mode, state = AiState.State, host = AiState.Host });
        if (await MovingRead("mp-ai-2.json", 60) == null) return Fail("host did not switch AI off");
        bool seesOff = await Until(() => AiState.Known && !AiState.On, 15);
        var closed = await api.Talk(npc, "open");
        var typed = await api.Talk(npc, "free", "Is there any work on the quay today?");
        MovingWrite("mp-ai-guest-2.json", new { seesOff, noTyping = closed.Free == false && !AiState.AllowsTyping && typed.Free == false, gated = typed.Gated, mode = AiState.Mode });
        if (await MovingRead("mp-ai-3.json", 60) == null) return Fail("host did not switch AI on again");
        bool seesOnAgain = await Until(() => AiState.On, 15);
        var again = await api.Talk(npc, "open");
        MovingWrite("mp-ai-guest-3.json", new { seesOn = seesOnAgain, free = again.Free == true && AiState.AllowsTyping });
        return seesOn && refused && seesOff && seesOnAgain;
    }
}
