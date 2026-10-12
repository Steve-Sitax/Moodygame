using System;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativePress
{
    public static bool RemarkOk(string line, string situation)
    {
        var allowed = Regex.Matches(situation, @"\d+").Select(m => m.Value).ToHashSet();
        return Regex.Matches(line, @"\d+").All(m => allowed.Contains(m.Value)) && !WordSums.IsMatch(line) && !Gifts.IsMatch(line);
    }
    private void BeginRemark(int who, string clerk, string situation, string fallback)
    {
        if (clerk == "") return;
        var resident = Resident(clerk); int started = generation;
        var request = resident != null && CanCallPress() ? new JsonObject {
            ["system"] = "Write one short line of speech for a clerk in Antwerp, October 1873. Plain English, Dutch only in names. Dry period flavour. Never name a sum, rule or offer absent from the supplied situation. The engine owns the transaction; write words only.",
            ["prompt"] = TextFor(who, new JsonObject { ["clerk"] = resident.DeepClone(), ["situation"] = situation }.ToJsonString()), ["schema"] = Definitions["remarkSchema"]!.DeepClone()
        } : null;
        Observe(Remark(who, clerk, situation, fallback, request, started));
    }
    private async Task Remark(int who, string clerk, string situation, string fallback, JsonObject? request, int started)
    {
        string text = fallback, source = "engine";
        if (request != null && NarrateAsync != null)
        {
            try
            {
                var output = await NarrateAsync(who, "clerk", request).ConfigureAwait(false);
                string line = output == null ? "" : NativeCoreInteriors.PlainEnglish(S(output, "line"));
                if (line.Length is >= 3 and <= 200 && RemarkOk(line, situation)) { text = line; source = "claude"; }
            }
            catch { /* The clerk still acknowledges the completed engine transaction. */ }
        }
        await host.WithState(_ => {
            if (generation == started) host.Publish("clerk", new JsonObject { ["who"] = clerk, ["name"] = Name(clerk), ["text"] = text, ["source"] = source });
            return true;
        }).ConfigureAwait(false);
    }
}
