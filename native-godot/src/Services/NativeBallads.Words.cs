using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed partial class NativeBallads
{
    private static string Line(JsonNode? array, int index) => array![index]!.GetValue<string>();
    private static string Capital(string s) => s.Length == 0 ? s : char.ToUpperInvariant(s[0]) + s[1..];
    public JsonObject FallbackBallad(JsonArray facts, int day)
    {
        var words = data["ballad"]!; var verses = new JsonArray();
        foreach (var (f, i) in facts.Take(3).Select((f, i) => (f, i))) {
            var pair = words["KIND_LINE"]![S(f, "kind")] ?? words["KIND_LINE"]!["event"]!;
            string text = Regex.Replace(S(f, "text"), @"\s*\([^)]*\)", "");
            text = Regex.Replace(text, @"\b\d+\s*(centimes?|francs?|c)\b", "a purse", RegexOptions.IgnoreCase);
            text = Regex.Replace(Regex.Replace(Regex.Replace(text, @"\d+", "some"), @"[;:].*$", ""), @"\.$", "").Trim();
            if (text.Length > 100) text = Regex.Replace(text[..100], @"\s+\S*$", "");
            verses.Add(new JsonArray(Line(words["OPENERS"], (day + i) % 4), Capital(text) + ",", Line(pair, 0), i == facts.Count - 1 ? Line(words["MORALS"], day % 4) : Capital(Line(pair, 1))));
        }
        while (verses.Count < 2) verses.Add(new JsonArray(Line(words["OPENERS"], (day + verses.Count) % 4), Line(words["KIND_LINE"]!["tide"], 0), Capital(Line(words["KIND_LINE"]!["tide"], 1)), Line(words["MORALS"], (day + 1) % 4)));
        return new() { ["title"] = facts.Any(f => B(f, "jef")) ? "The Farm Boy on the Quays" : Line(words["TITLES"], day % 4), ["verses"] = verses, ["chorus"] = words["CHORUS"]![day % 2]!.DeepClone() };
    }
    public JsonArray FallbackSermon(JsonArray facts, JsonObject? hint, int day)
    {
        var words = data["sermon"]!; var lines = new List<string> { Line(words["OPENINGS"], day % 2) };
        foreach (var fact in facts) if (words["BY_KIND"]![S(fact, "kind")] is {} line && !lines.Contains(line.GetValue<string>())) lines.Add(line.GetValue<string>());
        if (hint != null) lines.Add(words["HINT_LINE"]![S(hint, "kind")]!.GetValue<string>());
        foreach (var line in A(words["FILLER"])) if (lines.Count < 5) lines.Add(line!.GetValue<string>());
        return Strings(lines.Take(9).Append(S(words, "CLOSING")));
    }
    public HashSet<string> AllowedNames(IEnumerable<string> facts)
    {
        var names = A(data["guard"]!["COMMON"]).Select(n => n!.GetValue<string>()).ToHashSet(StringComparer.Ordinal);
        void Add(string text) { foreach (Match word in Regex.Matches(text.ToLowerInvariant(), @"[a-zà-ÿ'-]+")) names.Add(Regex.Replace(word.Value, @"'s$", "")); }
        foreach (var r in C.Rows("SELECT name FROM npc")) Add(S(r, "name"));
        foreach (var r in Residents()) Add(S(r, "name"));
        foreach (var place in (C.World("town")?["places"] as JsonObject ?? new())) Add(S(place.Value, "label"));
        foreach (string extra in new[] { "rijnkaai", "vismarkt", "steenplein", "werf", "vleeshuis", "steen", "oostershuis", "poesje", "handelsblad", "hessenatie", "logement", "kempenland", "berg", "barmhartigheid", "meir", "groenplaats" }) names.Add(extra);
        foreach (string fact in facts) Add(fact);
        return names;
    }
    private void AddPlain(HashSet<string> names, IEnumerable<string> text)
    {
        foreach (var word in A(data["guard"]!["TITLE_WORDS"])) names.Add(word!.GetValue<string>());
        foreach (string line in text) foreach (Match word in Regex.Matches(line, @"(?<![A-Za-zÀ-ÿ'-])[a-zà-ÿ][a-zà-ÿ'-]*")) names.Add(Regex.Replace(word.Value, @"'s$", ""));
    }
    public bool NamesOk(string text, HashSet<string> allowed)
    {
        var famous = A(data["guard"]!["FAMOUS"]).Select(w => w!.GetValue<string>()).ToHashSet();
        foreach (string sentence in Regex.Split(text, "[.!?;:]+|[\"“”]")) {
            var words = Regex.Matches(sentence, @"[A-Za-zÀ-ÿ'-]+");
            for (int i = 0; i < words.Count; i++) {
                string word = Regex.Replace(words[i].Value, @"'s$", ""), lower = word.ToLowerInvariant();
                if (famous.Contains(lower) || i > 0 && Regex.IsMatch(word, @"^[A-ZÀ-Þ]") && !allowed.Contains(lower)) return false;
            }
        }
        return true;
    }
    public string? CleanVerse(string input, HashSet<string> allowed, int maximum = 110)
    {
        string text = NativeCoreInteriors.PlainEnglish(Regex.Replace(input, @"[\r\n\t]+", " "));
        text = text[..Math.Min(text.Length, maximum)].Trim(); if (text.Length == 0) return null;
        foreach (string pattern in new[] { S(data["guard"], "ROUGH"), S(data["guard"], "VIOLENCE_RE"), S(data["guard"], "HARM_RE"), @"\d|\bfrancs?\b|\bcentimes?\b|\bsous?\b|\bguilders?\b", @"[<>{}`\\]|https?:|\bsystem prompt\b|\bAI\b|\bmodel\b" })
            if (Regex.IsMatch(text, pattern, RegexOptions.IgnoreCase)) return null;
        if (Regex.IsMatch(text, @"\b(AI|assistant|language model|prompt)\b") || !NamesOk(text, allowed)) return null;
        return text;
    }
    public JsonObject? CleanBallad(JsonObject output, JsonArray facts)
    {
        var verses = A(output["verses"]); var chorus = A(output["chorus"]);
        if (verses.Count is < 2 or > 3 || verses.Any(v => v is not JsonArray a || a.Count != 4) || chorus.Count is < 2 or > 4) return null;
        var all = new[] { S(output, "title") }.Concat(verses.SelectMany(v => A(v)).Concat(chorus).Select(v => v?.GetValue<string>() ?? "")).ToArray();
        var names = AllowedNames(facts.Select(f => S(f, "text"))); AddPlain(names, all);
        if (!facts.Any(f => B(f, "jef")) && all.Any(l => Regex.IsMatch(l, @"\bJef\b"))) return null;
        string? title = CleanVerse(all[0], names, 60); if (title == null) return null;
        var cleanVerses = new JsonArray();
        foreach (var verse in verses) {
            var lines = A(verse).Select(l => CleanVerse(l!.GetValue<string>(), names)).ToArray();
            if (lines.Any(l => l == null)) return null; cleanVerses.Add(Strings(lines!));
        }
        var cleanChorus = chorus.Select(l => CleanVerse(l!.GetValue<string>(), names)).ToArray();
        return cleanChorus.Any(l => l == null) ? null : new() { ["title"] = title, ["verses"] = cleanVerses, ["chorus"] = Strings(cleanChorus!) };
    }
    public JsonArray? CleanSermon(JsonArray lines, JsonArray facts, JsonObject? hint)
    {
        var text = lines.Select(l => l!.GetValue<string>()).ToArray(); var names = AllowedNames(Array.Empty<string>()); AddPlain(names, text);
        foreach (var f in facts) foreach (Match word in Regex.Matches(S(f, "text").ToLowerInvariant(), @"[a-z'-]+")) if (new[] { "america", "kempenland", "schelde" }.Contains(word.Value)) names.Add(word.Value);
        var result = new List<string>();
        foreach (string line in text) {
            if (Regex.IsMatch(line, @"\bJef\b") || hint == null && Regex.IsMatch(line, @"\byoung man on the quays?\b", RegexOptions.IgnoreCase)) return null;
            var clean = CleanVerse(line, names, 160); if (clean == null) return null; result.Add(clean);
        }
        return result.Count >= 6 ? Strings(result) : null;
    }
    private bool CanCall(string hook)
    {
        int running = C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook=$p1 AND error='running'", Day, hook);
        int unbooked = Math.Max(0, pending.Count - running), cap = DailyCallLimit();
        return NarrateAsync != null && C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook=$p1", Day, hook) < (hook == "ballad" ? 2 : 1)
            && (cap == 0 || C.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0", Day) + unbooked < cap - 15);
    }
    public async Task<JsonObject?> Write(bool sermon)
    {
        Task<JsonObject?> task = await host.WithState(_ => {
            if (sermon && Day % 7 != 0) return Task.FromResult<JsonObject?>(null);
            string hook = sermon ? "sermon" : "ballad", key = hook + ":" + Day;
            if (C.World(key) is JsonObject kept) return Task.FromResult<JsonObject?>(kept);
            if (writing.TryGetValue(key, out var active)) return active;
            var source = new TaskCompletionSource<JsonObject?>(TaskCreationOptions.RunContinuationsAsynchronously); writing[key] = source.Task;
            int day = Day, epoch = generation; var facts = sermon ? SermonFacts() : Facts(); var hint = sermon ? Hint() : null; bool narrate = CanCall(hook);
            if (narrate) pending.Add(key);
            Observe(FinishWriting(source, sermon, day, epoch, key, facts, hint, narrate)); return source.Task;
        }).ConfigureAwait(false);
        return await task.ConfigureAwait(false);
    }
    private async Task FinishWriting(TaskCompletionSource<JsonObject?> source, bool sermon, int day, int epoch, string key, JsonArray facts, JsonObject? hint, bool narrate)
    {
        try {
            // Begin after the caller releases its short state-lock section.
            await Task.Yield(); JsonObject? output = null; string hook = sermon ? "sermon" : "ballad";
            if (narrate) {
                var request = new JsonObject {
                    ["schema"] = data[sermon ? "sermonSchema" : "balladSchema"]!.DeepClone(),
                    ["system"] = sermon ? "You are the parish priest of Antwerp in 1873. Write six to ten short lines at Sunday mass from the engine FACTS. Be stern but fatherly, begin with the faithful and end with a blessing. Name no person. Only when a HINT is supplied may you mention a young man on the quays. Plain English, no sums, digits, politics, violence or invented events." : "Write a street ballad for Antwerp in 1873: two or three four-line verses, one per engine FACT, and a two-line chorus. Plain English, simple rhymes and six to ten words per line; a title at most six words. Only names supplied by the facts. No invented events, sums, digits, oaths or violence. Jef appears only if a fact is about him.",
                    ["prompt"] = new JsonObject { ["facts"] = facts.DeepClone(), ["hint"] = hint?.DeepClone(), ["day"] = day }.ToJsonString()
                };
                try { output = await NarrateAsync!(1, hook, request).ConfigureAwait(false); } catch { }
            }
            var result = await host.WithState(_ => {
                if (epoch != generation) throw new NativeServiceException("the day was reloaded while the words were written", 409);
                JsonNode? clean = null;
                try { clean = output == null ? null : sermon ? CleanSermon(A(output["lines"]), facts, hint) : CleanBallad(output, facts); } catch (InvalidOperationException) { }
                var record = new JsonObject { ["day"] = day, ["source"] = clean == null ? "engine" : "claude", ["facts"] = Strings(facts.Select(f => S(f, "text"))) };
                if (sermon) { record["lines"] = clean ?? FallbackSermon(facts, hint, day); record["kinds"] = Strings(facts.Select(f => S(f, "kind"))); record["hint"] = hint?.DeepClone(); }
                else { record["text"] = clean ?? FallbackBallad(facts, day); record["aboutJef"] = facts.Any(f => B(f, "jef")); }
                if (C.World(key) == null) C.SetWorld(key, record);
                return C.World(key)!.AsObject();
            }).ConfigureAwait(false);
            source.TrySetResult(result);
        } catch (Exception e) { source.TrySetException(e); }
        finally { await host.WithState(_ => { if (epoch == generation) { writing.Remove(key); pending.Remove(key); } return true; }).ConfigureAwait(false); }
    }
}
