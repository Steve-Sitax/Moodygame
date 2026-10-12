using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>The original AI settings contract, stored locally; views and errors never contain connection keys.</summary>
public sealed class NativeAiConfiguration
{
    public JsonObject Definitions { get; }
    private JsonObject current;
    private readonly string file;
    public bool Saved { get; private set; }
    public NativeAiConfiguration(string definitions, string file, bool walk = false)
    {
        Definitions = JsonNode.Parse(File.ReadAllText(definitions))!.AsObject(); this.file = file;
        current = Definitions["defaults"]!.DeepClone().AsObject();
        if (File.Exists(file))
        {
            try
            {
                var stored = JsonNode.Parse(File.ReadAllText(file))!.AsObject();
                if (stored["version"]?.GetValue<int>() != 1) throw new InvalidDataException();
                Apply(stored, false, true); Saved = true;
            }
            catch (Exception e) when (e is System.Text.Json.JsonException or InvalidOperationException or NativeServiceException or IOException)
            { current = Definitions["defaults"]!.DeepClone().AsObject(); }
        }
        if (walk) current["mode"] = "walk";
    }
    public string Mode => S(current, "mode");
    public int CallsPerDay => (int)NativeGoods.N(current, "callsPerDay", 120);
    public string TypedLines => S(current, "typedLines", "same");
    public IEnumerable<string> Kinds => Definitions["kinds"]!.AsArray().Select(n => n!.GetValue<string>());
    public static string S(JsonNode? node, string name, string fallback = "") => NativeGoods.S(node, name, fallback);
    public JsonObject NormalChoice(JsonNode? input)
    {
        if (input is not JsonObject choice || choice.Any(p => p.Key is not ("provider" or "model" or "effort"))) throw new NativeServiceException("invalid AI choice");
        string provider = S(choice, "provider");
        if (!Definitions["providers"]!.AsArray().Any(p => p!.GetValue<string>() == provider)) throw new NativeServiceException("unknown AI provider");
        string model = S(choice, "model").Trim(), effort = S(choice, "effort");
        if (choice.ContainsKey("model") && !Regex.IsMatch(model, "^[A-Za-z0-9._:/@-]{1,100}$")) throw new NativeServiceException("invalid model name");
        if (choice.ContainsKey("effort") && effort is not ("low" or "medium" or "high")) throw new NativeServiceException("invalid effort");
        if (provider is "recommended" or "none") return new JsonObject { ["provider"] = provider };
        string? defaultModel = Definitions["options"]!["providers"]!.AsArray().First(p => S(p, "id") == provider)!["defaultModel"]?.GetValue<string>();
        if (model == "") model = defaultModel ?? throw new NativeServiceException("name a model for " + provider);
        var normal = new JsonObject { ["provider"] = provider, ["model"] = model };
        if (provider == "ollama" || provider is "claude_local" or "anthropic_api" && model.Contains("haiku", StringComparison.OrdinalIgnoreCase)) return normal;
        if (provider is "claude_local" or "anthropic_api" or "codex_cli") normal["effort"] = effort == "" ? "medium" : effort;
        else if (effort != "") normal["effort"] = effort;
        return normal;
    }
    private static void Members(JsonObject node, params string[] accepted)
    { if (node.Any(p => !accepted.Contains(p.Key))) throw new NativeServiceException("those settings were not accepted"); }
    private void Apply(JsonObject patch, bool write, bool loading = false)
    {
        Members(patch, loading ? new[] { "version", "mode", "typedLines", "callsPerDay", "default", "kinds", "connections" } : new[] { "mode", "typedLines", "callsPerDay", "default", "kinds", "connections" });
        var next = current.DeepClone().AsObject();
        foreach (var (field, values) in new[] { ("mode", new[] { "walk", "ai" }), ("typedLines", new[] { "same", "claude_only" }) })
            if (patch.ContainsKey(field)) { string value = S(patch, field); if (!values.Contains(value)) throw new NativeServiceException("invalid " + field); next[field] = value; }
        if (patch.ContainsKey("callsPerDay"))
        {
            if (patch["callsPerDay"] is not JsonValue value || !value.TryGetValue<double>(out double n) || n < 0 || n > 10000 || n != Math.Floor(n)) throw new NativeServiceException("calls per day must be a whole number from 0 to 10000");
            next["callsPerDay"] = (int)n;
        }
        if (patch.ContainsKey("default")) next["default"] = NormalChoice(patch["default"]);
        if (patch.ContainsKey("kinds"))
        {
            if (patch["kinds"] is not JsonObject kinds) throw new NativeServiceException("invalid kinds");
            foreach (var pair in kinds)
            {
                if (!Kinds.Contains(pair.Key)) throw new NativeServiceException("unknown kind");
                next["kinds"]![pair.Key] = pair.Value is JsonValue text && text.TryGetValue<string>(out var same) && same == "default" ? JsonValue.Create("default") : NormalChoice(pair.Value);
            }
        }
        if (patch.ContainsKey("connections"))
        {
            if (patch["connections"] is not JsonObject connections) throw new NativeServiceException("invalid connections");
            Members(connections, "anthropic_api", "openai_compat", "ollama");
            foreach (var pair in connections)
            {
                if (pair.Value is not JsonObject connection) throw new NativeServiceException("invalid connection");
                Members(connection, pair.Key == "anthropic_api" ? new[] { "apiKey" } : pair.Key == "ollama" ? new[] { "baseUrl" } : new[] { "baseUrl", "apiKey" });
                foreach (var setting in connection)
                {
                    if (setting.Key == "apiKey")
                    {
                        if (setting.Value == null) { next["connections"]![pair.Key]!.AsObject().Remove("apiKey"); continue; }
                        string key = setting.Value.GetValue<string>().Trim();
                        if (!Regex.IsMatch(key, "^[!-~]{8,300}$")) throw new NativeServiceException("invalid connection key");
                        next["connections"]![pair.Key]!["apiKey"] = key;
                    }
                    else
                    {
                        string url = setting.Value?.GetValue<string>().Trim().TrimEnd('/') ?? "";
                        if (url.Length > 300 || !Uri.TryCreate(url, UriKind.Absolute, out var parsed) || parsed.Scheme is not ("http" or "https") || parsed.UserInfo != "") throw new NativeServiceException("invalid connection address");
                        next["connections"]![pair.Key]!["baseUrl"] = url;
                    }
                }
            }
        }
        if (write)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(file))!);
            string temporary = file + "." + Guid.NewGuid().ToString("N") + ".tmp";
            File.WriteAllText(temporary, next.ToJsonString(new System.Text.Json.JsonSerializerOptions { WriteIndented = true }));
            File.Move(temporary, file, true); Saved = true;
        }
        current = next;
    }
    public JsonObject Patch(JsonObject patch) { Apply(patch, true); return View(); }
    public JsonObject Effective(string kind)
    {
        var value = current["kinds"]?[kind];
        return (value is JsonObject choice ? choice : current["default"]!).DeepClone().AsObject();
    }
    public JsonObject? ChoiceForHook(string hook)
    {
        if (Mode == "walk") return null;
        string? kind = Definitions["hooks"]!.AsObject().FirstOrDefault(p => p.Value!.AsArray().Any(h => h!.GetValue<string>() == hook)).Key;
        var choice = kind == null ? current["default"]!.DeepClone().AsObject() : Effective(kind);
        return S(choice, "provider") == "none" ? null : choice;
    }
    public JsonObject Connection(string provider) => current["connections"]![provider]!.DeepClone().AsObject();
    public string Scrub(string text)
    {
        foreach (string provider in new[] { "anthropic_api", "openai_compat" })
        { string key = S(current["connections"]![provider], "apiKey"); if (key.Length >= 8) text = text.Replace(key, "[key]", StringComparison.Ordinal); }
        text = Regex.Replace(text, @"\b(sk|rk|pk)-[A-Za-z0-9_\-*.]{6,}", "[key]");
        return Regex.Replace(text, @"(Bearer|x-api-key:?)\s+[^\s\""',}]+", "$1 [key]", RegexOptions.IgnoreCase);
    }
    public string Label(JsonObject choice)
    {
        var definition = Definitions["options"]!["providers"]!.AsArray().First(p => S(p, "id") == S(choice, "provider"))!;
        string model = S(choice, "model"), effort = S(choice, "effort");
        if (model == "") return S(definition, "label");
        var known = definition["models"]!.AsArray().FirstOrDefault(m => S(m, "id") == model);
        string name = known == null ? model : Regex.Replace(S(known, "label"), " \\(.*\\)$", "");
        return name + (effort == "" ? "" : ", " + effort + " effort") + " (" + S(definition, "label") + ")";
    }
    public JsonObject View()
    {
        var kinds = new JsonObject(); var effective = new JsonObject();
        foreach (string kind in Kinds)
        {
            kinds[kind] = current["kinds"]?[kind]?.DeepClone() ?? JsonValue.Create("default");
            var choice = Effective(kind); choice["label"] = Mode == "walk" ? "Walk around (no AI)" : Label(choice); effective[kind] = choice;
        }
        JsonObject Key(JsonNode? key) { string text = key?.GetValue<string>() ?? ""; return new() { ["set"] = text != "", ["last4"] = text == "" ? null : text[^4..] }; }
        var connections = current["connections"]!.DeepClone().AsObject();
        foreach (string provider in new[] { "anthropic_api", "openai_compat" }) connections[provider]!["apiKey"] = Key(connections[provider]!["apiKey"]);
        bool allOff = Kinds.All(k => S(Effective(k), "provider") == "none");
        return new JsonObject { ["mode"] = Mode, ["typedLines"] = TypedLines, ["callsPerDay"] = CallsPerDay,
            ["default"] = current["default"]!.DeepClone(), ["kinds"] = kinds, ["effective"] = effective,
            ["connections"] = connections, ["available"] = new JsonObject { ["claude_local"] = null, ["codex_cli"] = NativeAiProviders.FindCodex() != null },
            ["saved"] = Saved, ["options"] = Definitions["options"]!.DeepClone(),
            ["status"] = new JsonObject { ["title"] = Mode == "walk" ? "Walk-around mode" : allOff ? "No AI chosen" : "AI on", ["text"] = Mode == "walk" ? Definitions["options"]!["walk"]!["text"]!.DeepClone() : JsonValue.Create(allOff ? "Every kind of work is set to the hand-written lines." : "Default: " + Label(current["default"]!.AsObject()) + ".") } };
    }
}
