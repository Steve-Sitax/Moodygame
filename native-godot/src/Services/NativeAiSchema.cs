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
    public static JsonNode Parse(string text)
    {
        text = Regex.Replace(Regex.Replace(text.Trim(), "^```(?:json)?\\s*", "", RegexOptions.IgnoreCase), "\\s*```$", "");
        try { return JsonNode.Parse(text)!; }
        catch (JsonException) { int a = text.IndexOf('{'), b = text.LastIndexOf('}'); if (a >= 0 && b > a) return JsonNode.Parse(text[a..(b+1)])!; throw new InvalidOperationException("the answer was not JSON"); }
    }
}
