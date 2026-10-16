using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>The lamplighter's authored lines. They need no AI and offer only what Jef truthfully found, saw or heard.</summary>
public sealed partial class NativeStory
{
    private const string AskChoice = "Where did he finish?";
    private const string AgainChoice = "Where was his last lamp again?";
    private bool IsLowie(JsonObject person, out JsonObject s)
    {
        s = (Single ? State : null)!;
        return s != null && S(person, "id") == S(s, "lowie");
    }
    private string? Opening(NativeServiceRequest request, JsonObject person)
    {
        if (request.PlayerId != Solo || !IsLowie(person, out var s)) return null;
        string helper = Helper(s);
        return S(s, "status") switch
        {
            "offered" => $"You're the new man? {helper} never brought the ladder back. His last two lamps are still dark.",
            "active" when !Inspected(s) => $"Anything on {helper}'s stretch?",
            "active" => $"Well? You were out at {helper}'s last lamp.",
            "done" => PayOwed(request.PlayerId, s) ?? $"No word of {helper}. I do his lamps myself now, and I don't dawdle at the end.",
            _ => null,
        };
    }
    private IEnumerable<string> Choices(int player, JsonObject person)
    {
        if (player != Solo || !IsLowie(person, out var s)) yield break;
        if (S(s, "status") == "offered") yield return AskChoice;
        else if (S(s, "status") == "active")
        {
            if (Inspected(s)) foreach (var report in Reports(s)) yield return report;
            else yield return AgainChoice;
        }
    }
    private JsonObject? Reply(NativeServiceRequest request, JsonObject person, string? topic, NativeTownTalk talk)
    {
        if (request.PlayerId != Solo || topic == null || !topic.StartsWith("extra:") || !IsLowie(person, out var s)) return null;
        string said = topic[6..], helper = Helper(s), where = Where(N(A(s["lamps"])[^1], "x"), N(A(s["lamps"])[^1], "z"));
        if (said == AskChoice && S(s, "status") == "offered")
        {
            s["status"] = "active"; s["accepted_day"] = Day;
            Fact(s, "word:lowie", "word", $"{First(s)}: {helper} took the last two lamps of the west round for him and never brought the ladder back. His last stop is the last lamp, {where}. {First(s)} loaned you his pole.");
            C.Atomic(() => { Save(s); C.Log(request.PlayerId, "story_begun", "antigoon:1", $"{Lowie(s)} asked Jef to finish {helper}'s lamps and look for him."); });
            host.PublishState(request.PlayerId);
            return talk.Line(request, person, $"At the last lamp, {where}. Take my pole. I don't want anyone else walking that stretch blind. Not one before {Time(N(s, "open"))}; it wastes the town's gas.");
        }
        if (said == AgainChoice && S(s, "status") == "active")
            return talk.Line(request, person, $"The last lamp of my round, {where}. The one before it is his too. Mind the pole.");
        if (S(s, "status") != "active" || !Inspected(s) || !Reports(s).Contains(said)) return null;
        int pay = Pay(s); string words = PayWords(s, pay);
        string line = said switch
        {
            SeenReport => $"Don't. Don't say that out loud on my round. ... Taller than the doors. {helper} wrote the same, didn't he. {words} Keep his book. He said a fishwife on the quay saw it first; ask her, in daylight.",
            HeardReport => $"Scraping. Towards the river. Every dog on the quay knows that sound and none of them will say. {words} Keep his book. He said a fishwife on the quay saw it first; ask her, in daylight.",
            _ => $"Bent? {helper} carried that ladder twenty years and never so much as scratched it. {words} Keep his book; it's more use with you. He said a fishwife on the quay saw it first. Ask her.",
        };
        Close(request.PlayerId, s, "talk", pay);
        return talk.Line(request, person, line + " And give me back my pole.");
    }
    public void AttachTalk(NativeTownTalk talk)
    {
        talk.OpeningOverrides.Insert(0, Opening);
        talk.ChoiceAdditions.Insert(0, Choices);
        talk.ReplyOverrides.Insert(0, (request, person, topic) => Reply(request, person, topic, talk));
    }
}
