using System;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

public static class NativeAiSchema
{
    public static JsonNode? Clean(JsonNode? node, bool strict = false)
    {
        if (node is JsonArray array) return new JsonArray(array.Select(n => Clean(n, strict)).ToArray());
        if (node is not JsonObject source) return node?.DeepClone();
        var result = new JsonObject();
        string[] unsupported = { "$schema", "minLength", "maxLength", "pattern", "format", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf", "minItems", "maxItems", "uniqueItems", "default" };
        foreach (var pair in source)
            if (pair.Key == "properties" && pair.Value is JsonObject fields)
                result[pair.Key] = new JsonObject(fields.Select(p => new System.Collections.Generic.KeyValuePair<string,JsonNode?>(p.Key, Clean(p.Value, strict))));
            else if (!unsupported.Contains(pair.Key)) result[pair.Key] = Clean(pair.Value, strict);
        if (Limits(source) is { Length: > 0 } words)
            result["description"] = (NativeGoods.S(source, "description") is { Length: > 0 } own ? own.TrimEnd('.') + ". " : "") + words;
        if (source["properties"] is JsonObject properties)
        {
            result["additionalProperties"] = false;
            if (strict)
            {
                var required = source["required"] as JsonArray ?? new JsonArray();
                foreach (var pair in properties)
                    if (!required.Any(n => n?.GetValue<string>() == pair.Key)) result["properties"]![pair.Key] = new JsonObject { ["anyOf"] = new JsonArray(Clean(pair.Value, true), new JsonObject { ["type"] = "null" }) };
                result["required"] = new JsonArray(properties.Select(p => (JsonNode)JsonValue.Create(p.Key)!).ToArray());
            }
        }
        return result;
    }
    /// <summary>The limits a wire format cannot carry, in words for the model's field description (fix 3, 2026-11-02):
    /// "At most 300 characters." "Exactly 3 items." "A whole number from -5 to 5."</summary>
    public static string Limits(JsonObject schema)
    {
        var parts = new System.Collections.Generic.List<string>();
        string Num(string key) => NativeGoods.Number(schema[key]).ToString(System.Globalization.CultureInfo.InvariantCulture);
        bool Has(string key) => schema[key] != null;
        if (Has("minLength") && Has("maxLength")) parts.Add(NativeGoods.Number(schema["minLength"]) <= 1 ? $"Not empty, at most {Num("maxLength")} characters." : $"{Num("minLength")} to {Num("maxLength")} characters.");
        else if (Has("maxLength")) parts.Add($"At most {Num("maxLength")} characters.");
        else if (Has("minLength") && NativeGoods.Number(schema["minLength"]) >= 1) parts.Add("Not empty.");
        if (Has("minItems") && Has("maxItems")) parts.Add(Num("minItems") == Num("maxItems") ? $"Exactly {Num("maxItems")} items." : $"{Num("minItems")} to {Num("maxItems")} items.");
        else if (Has("maxItems")) parts.Add($"At most {Num("maxItems")} items.");
        else if (Has("minItems")) parts.Add($"At least {Num("minItems")} items.");
        string whole = NativeGoods.S(schema, "type") == "integer" ? "A whole number" : "A number";
        if (Has("minimum") && Has("maximum")) parts.Add($"{whole} from {Num("minimum")} to {Num("maximum")}.");
        else if (Has("minimum")) parts.Add($"{whole} of at least {Num("minimum")}.");
        else if (Has("maximum")) parts.Add($"{whole} of at most {Num("maximum")}.");
        return string.Join(" ", parts);
    }
    /// <summary>Fits an answer to the schema's size limits before the check (fix 3): a string over its length is cut at a
    /// sentence or word end, a list over its count is shortened, a number is clamped into its range and an integer rounded.
    /// It only removes or clamps; it never writes words. Wrong types, missing fields and unknown enum values still fail
    /// the check, and every game module clamps its numbers again afterwards. `fitted` lists the paths changed.</summary>
    public static JsonNode? Fit(JsonNode? value, JsonObject schema, System.Collections.Generic.List<string>? fitted = null, string path = "$")
    {
        if (schema["anyOf"] is JsonArray any)
        {
            foreach (var branch in any.OfType<JsonObject>())
            {
                var trial = new System.Collections.Generic.List<string>(); var fit = Fit(value, branch, trial, path);
                if (Valid(fit, branch)) { fitted?.AddRange(trial); return fit; }
            }
            return value?.DeepClone();
        }
        if (value is JsonObject obj && schema["properties"] is JsonObject props)
        {
            var result = new JsonObject();
            foreach (var pair in obj) result[pair.Key] = props[pair.Key] is JsonObject child ? Fit(pair.Value, child, fitted, path + "." + pair.Key) : pair.Value?.DeepClone();
            return result;
        }
        if (value is JsonArray array)
        {
            var items = array.Select(n => schema["items"] is JsonObject item ? Fit(n, item, fitted, path + "[]") : n?.DeepClone()).ToList();
            if (schema["maxItems"] != null && items.Count > NativeGoods.Number(schema["maxItems"])) { items = items.Take((int)NativeGoods.Number(schema["maxItems"])).ToList(); fitted?.Add(path + " items"); }
            return new JsonArray(items.ToArray());
        }
        if (value?.GetValueKind() == JsonValueKind.String && schema["maxLength"] != null)
        {
            string text = value.GetValue<string>().Trim(); int max = (int)NativeGoods.Number(schema["maxLength"]);
            if (text.Length <= max) return JsonValue.Create(text);
            fitted?.Add(path + " length");
            return JsonValue.Create(Shorten(text, max));
        }
        if (value?.GetValueKind() == JsonValueKind.Number && NativeGoods.S(schema, "type") is "integer" or "number")
        {
            double n = NativeGoods.Number(value), was = n;
            if (!double.IsFinite(n)) return value.DeepClone();
            if (NativeGoods.S(schema, "type") == "integer") n = Math.Round(n, MidpointRounding.AwayFromZero);
            if (schema["minimum"] != null) n = Math.Max(n, NativeGoods.Number(schema["minimum"]));
            if (schema["maximum"] != null) n = Math.Min(n, NativeGoods.Number(schema["maximum"]));
            if (n == was) return value.DeepClone();
            fitted?.Add(path + " range");
            return NativeGoods.S(schema, "type") == "integer" ? JsonValue.Create((long)n) : JsonValue.Create(n);
        }
        return value?.DeepClone();
    }
    /// <summary>Cuts a text to at most `max` characters: at a sentence end if one keeps at least half, else at a word end with "...".</summary>
    public static string Shorten(string text, int max)
    {
        if (text.Length <= max) return text;
        string head = text[..max];
        if (".!?".Contains(head[^1]) && head.Length > max / 2) return head.TrimEnd();
        int sentence = Math.Max(head.LastIndexOf(". ", StringComparison.Ordinal), Math.Max(head.LastIndexOf("! ", StringComparison.Ordinal), head.LastIndexOf("? ", StringComparison.Ordinal)));
        if (sentence >= max / 2) return head[..(sentence + 1)];
        if (max < 8) return head;
        string cut = head[..(max - 3)]; int space = cut.LastIndexOf(' ');
        return (space >= max / 3 ? cut[..space] : cut).TrimEnd(',', ';', ':', ' ', '-') + "...";
    }
    public static JsonNode? StripNulls(JsonNode? node) => node switch {
        JsonObject obj => new JsonObject(obj.Where(p => p.Value != null).Select(p => new System.Collections.Generic.KeyValuePair<string,JsonNode?>(p.Key, StripNulls(p.Value)))),
        JsonArray array => new JsonArray(array.Select(StripNulls).ToArray()),
        _ => node?.DeepClone()
    };
    public static bool Valid(JsonNode? value, JsonObject schema)
    {
        if (schema["anyOf"] is JsonArray any && !any.Any(s => Valid(value, s!.AsObject()))) return false;
        if (schema["oneOf"] is JsonArray one && one.Count(s => Valid(value, s!.AsObject())) != 1) return false;
        if (schema["allOf"] is JsonArray all && !all.All(s => Valid(value, s!.AsObject()))) return false;
        if (schema["enum"] is JsonArray choices && !choices.Any(s => JsonNode.DeepEquals(s, value))) return false;
        string type = NativeGoods.S(schema, "type");
        bool match = type switch {
            "object" => value is JsonObject, "array" => value is JsonArray, "string" => value?.GetValueKind() == JsonValueKind.String,
            "number" => value?.GetValueKind() == JsonValueKind.Number, "integer" => value?.GetValueKind() == JsonValueKind.Number && NativeGoods.Number(value) == Math.Floor(NativeGoods.Number(value)),
            "boolean" => value?.GetValueKind() is JsonValueKind.True or JsonValueKind.False, "null" => value == null, _ => true
        };
        if (!match) return false;
        if (value is JsonObject obj)
        {
            if (schema["required"] is JsonArray required && required.Any(n => !obj.ContainsKey(n!.GetValue<string>()))) return false;
            if (schema["properties"] is JsonObject props)
            {
                if (schema["additionalProperties"]?.GetValueKind() == JsonValueKind.False && obj.Any(p => !props.ContainsKey(p.Key))) return false;
                if (obj.Any(p => props[p.Key] is JsonObject child && !Valid(p.Value, child))) return false;
            }
        }
        if (value is JsonArray array)
        {
            if (schema["minItems"] != null && array.Count < NativeGoods.Number(schema["minItems"]) || schema["maxItems"] != null && array.Count > NativeGoods.Number(schema["maxItems"])) return false;
            if (schema["items"] is JsonObject item && array.Any(n => !Valid(n, item))) return false;
        }
        if (value?.GetValueKind() == JsonValueKind.String)
        {
            string text = value.GetValue<string>();
            if (schema["minLength"] != null && text.Length < NativeGoods.Number(schema["minLength"]) || schema["maxLength"] != null && text.Length > NativeGoods.Number(schema["maxLength"])) return false;
            if (schema["pattern"] != null && !Regex.IsMatch(text, schema["pattern"]!.GetValue<string>(), RegexOptions.None, TimeSpan.FromMilliseconds(100))) return false;
        }
        if (value?.GetValueKind() == JsonValueKind.Number)
        {
            double n = NativeGoods.Number(value);
            if (!double.IsFinite(n) || schema["minimum"] != null && n < NativeGoods.Number(schema["minimum"]) || schema["maximum"] != null && n > NativeGoods.Number(schema["maximum"])) return false;
        }
        return true;
    }
    /// <summary>Diagnostic (AI audit 2026-11-02): the first place an answer breaks the schema, for the ai_call error text.
    /// Names the path and the rule only; never the answer's own words.</summary>
    public static string Why(JsonNode? value, JsonObject schema, string path = "$")
    {
        if (schema["anyOf"] is JsonArray any && !any.Any(s => Valid(value, s!.AsObject()))) return path + " matches no anyOf branch";
        if (schema["enum"] is JsonArray choices && !choices.Any(s => JsonNode.DeepEquals(s, value))) return path + " not in enum";
        if (!Valid(value, new JsonObject { ["type"] = schema["type"]?.DeepClone() })) return path + " wrong type (want " + NativeGoods.S(schema, "type") + ")";
        if (value is JsonObject obj)
        {
            if (schema["required"] is JsonArray required && required.FirstOrDefault(n => !obj.ContainsKey(n!.GetValue<string>())) is { } missing) return path + "." + missing.GetValue<string>() + " missing";
            if (schema["properties"] is JsonObject props)
            {
                if (schema["additionalProperties"]?.GetValueKind() == JsonValueKind.False && obj.FirstOrDefault(p => !props.ContainsKey(p.Key)) is { Key: { } extra }) return path + "." + extra + " not allowed";
                foreach (var p in obj) if (props[p.Key] is JsonObject child && !Valid(p.Value, child)) return Why(p.Value, child, path + "." + p.Key);
            }
        }
        if (value is JsonArray array)
        {
            if (schema["minItems"] != null && array.Count < NativeGoods.Number(schema["minItems"])) return $"{path} has {array.Count} items, minItems {schema["minItems"]}";
            if (schema["maxItems"] != null && array.Count > NativeGoods.Number(schema["maxItems"])) return $"{path} has {array.Count} items, maxItems {schema["maxItems"]}";
            if (schema["items"] is JsonObject item) for (int i = 0; i < array.Count; i++) if (!Valid(array[i], item)) return Why(array[i], item, $"{path}[{i}]");
        }
        if (value?.GetValueKind() == JsonValueKind.String)
        {
            int length = value.GetValue<string>().Length;
            if (schema["minLength"] != null && length < NativeGoods.Number(schema["minLength"])) return $"{path} length {length} < minLength {schema["minLength"]}";
            if (schema["maxLength"] != null && length > NativeGoods.Number(schema["maxLength"])) return $"{path} length {length} > maxLength {schema["maxLength"]}";
            if (schema["pattern"] != null) return path + " pattern";
        }
        if (value?.GetValueKind() == JsonValueKind.Number)
        {
            double n = NativeGoods.Number(value);
            if (schema["minimum"] != null && n < NativeGoods.Number(schema["minimum"])) return $"{path} {n} < minimum {schema["minimum"]}";
            if (schema["maximum"] != null && n > NativeGoods.Number(schema["maximum"])) return $"{path} {n} > maximum {schema["maximum"]}";
        }
        return path + " invalid";
    }
    public static JsonNode Parse(string text)
    {
        text = Regex.Replace(Regex.Replace(text.Trim(), "^```(?:json)?\\s*", "", RegexOptions.IgnoreCase), "\\s*```$", "");
        try { return JsonNode.Parse(text)!; }
        catch (JsonException) { int a = text.IndexOf('{'), b = text.LastIndexOf('}'); if (a >= 0 && b > a) return JsonNode.Parse(text[a..(b+1)])!; throw new InvalidOperationException("the answer was not JSON"); }
    }
}
