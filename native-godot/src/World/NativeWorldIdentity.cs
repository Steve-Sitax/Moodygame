using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.Native.Authoring;

namespace Scheldemist.Native.World;

public static class NativeWorldIdentity
{
    public static string ReadFingerprint()
    {
        const string file = "res://world/network-content.json";
        if (!Godot.FileAccess.FileExists(file)) throw new InvalidDataException("The native content fingerprint is missing. Prepare the native game package first.");
        return JsonNode.Parse(Godot.FileAccess.GetFileAsString(file))?["fingerprint"]?.GetValue<string>()
            ?? throw new InvalidDataException("The native content fingerprint is invalid.");
    }

    public static JsonObject Capture(NativeTown town, string fingerprint)
    {
        var layouts = new JsonObject();
        foreach (var state in town.Layouts.Districts.OrderBy(d => d.District.Id, StringComparer.Ordinal))
            layouts[state.District.Id] = JsonNode.Parse(NativeDistrictLayouts.Capture(state.District, state.Objects).Encode());
        return new JsonObject { ["fingerprint"] = fingerprint, ["layoutHash"] = Hash(layouts), ["layouts"] = layouts };
    }

    public static void UseRemote(JsonObject data, string fingerprint)
    {
        if (data["fingerprint"]?.GetValue<string>() != fingerprint) throw new InvalidDataException("The host has a different game build. Use the same download.");
        var layouts = data["layouts"] as JsonObject ?? throw new InvalidDataException("The host did not provide its district layouts.");
        if (data["layoutHash"]?.GetValue<string>() != Hash(layouts)) throw new InvalidDataException("The shared layouts failed their integrity check.");
        var districts = NativeDistrictLayouts.Available().ToDictionary(d => d.Id, StringComparer.Ordinal);
        if (layouts.Count != districts.Count) throw new InvalidDataException("The host has a different set of districts.");
        var checkedLayouts = new Dictionary<string, LayoutDocument>(StringComparer.Ordinal);
        foreach (var pair in layouts)
        {
            if (!districts.TryGetValue(pair.Key, out var district) || pair.Value == null) throw new InvalidDataException("The host sent an unknown district.");
            var document = LayoutDocument.Decode(pair.Value.ToJsonString());
            document.Validate(district.Id, district.Catalog.Index());
            checkedLayouts.Add(pair.Key, document);
        }
        NativeDistrictLayouts.RemoteLayouts = checkedLayouts;
    }

    private static string Hash(JsonObject value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToJsonString()))).ToLowerInvariant();
}
