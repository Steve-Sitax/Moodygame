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
        {
            var seed=NativeDistrictLayouts.ReadSeed(state.District);
            try
            {
                var original=NativeDistrictLayouts.Capture(state.District,seed).Objects.ToDictionary(p=>p.Id,StringComparer.Ordinal);
                var current=NativeDistrictLayouts.Capture(state.District,state.Objects);
                var ids=current.Objects.Select(p=>p.Id).ToHashSet(StringComparer.Ordinal);
                var edits=current.Objects.Where(p=>!original.TryGetValue(p.Id,out var old)||!Same(old,p)).ToList();
                // Scene seeds are already covered by the content fingerprint. Send only edits within the existing
                // authenticated world packet's 512 KiB expansion limit; guests reconstruct the complete document.
                var delta=JsonNode.Parse((current with {Objects=edits}).Encode())!.AsObject();
                delta["seed"]=true;delta["removed"]=new JsonArray(original.Keys.Where(id=>!ids.Contains(id)).Order(StringComparer.Ordinal).Select(id=>(JsonNode)JsonValue.Create(id)!).ToArray());layouts[state.District.Id]=delta;
            }
            finally {seed.Free();}
        }
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
            if(pair.Value["seed"]?.GetValue<bool>()==true)
            {
                var seed=NativeDistrictLayouts.ReadSeed(district);
                try
                {
                    var complete=NativeDistrictLayouts.Capture(district,seed);var removed=pair.Value["removed"] as JsonArray??throw new InvalidDataException("Missing removed object ids.");
                    var deleted=removed.Select(n=>n?.GetValue<string>()??"").ToHashSet(StringComparer.Ordinal);
                    if(deleted.Any(id=>!complete.Objects.Any(p=>p.Id==id))||deleted.Count!=removed.Count)throw new InvalidDataException("Unknown or duplicate removed object id.");
                    var overrides=document.Objects.Select(p=>p.Id).ToHashSet(StringComparer.Ordinal);
                    document=document with {Objects=complete.Objects.Where(p=>!deleted.Contains(p.Id)&&!overrides.Contains(p.Id)).Concat(document.Objects).ToList()};
                    document.Validate(district.Id,district.Catalog.Index());
                }
                finally {seed.Free();}
            }
            checkedLayouts.Add(pair.Key, document);
        }
        NativeDistrictLayouts.RemoteLayouts = checkedLayouts;
    }

    private static string Hash(JsonObject value) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(value.ToJsonString()))).ToLowerInvariant();
    private static bool Same(Placement a,Placement b)=>a.Asset==b.Asset&&a.Position.SequenceEqual(b.Position)&&a.Rotation.SequenceEqual(b.Rotation)&&a.Scale.SequenceEqual(b.Scale);
}
