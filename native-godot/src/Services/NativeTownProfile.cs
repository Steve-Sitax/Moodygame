using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Text;
using Scheldemist.Menu;

namespace Scheldemist.Native.Services;

/// <summary>Native character creator, persisted player look and the original compact appearance code.</summary>
public sealed class NativeTownProfile : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private const string B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    public NativeTownProfile(NativeServiceHost host) => this.host = host;
    private static int Index(IEnumerable<string> list, string id) => Math.Max(0, list.ToList().IndexOf(id));
    public static string Code(Profile p)
    {
        var c = p.Clothes;
        var fields = new[] { p.Sex == "woman" ? 1 : 0, p.Age - Character.AgeMin, Index(Character.Builds.Select(x => x.Id), p.Build), Index(Character.Skin.Select(x => x.Id), p.Skin), Index(Character.HairColours.Select(x => x.Id), p.Hair.Colour), Index(Character.HairStyles.Select(x => x.Id), p.Hair.Style), Index(Character.Faces.Select(x => x.Id), p.Face), Index(Character.Heads.Select(x => x.Id), c.Head.Kind), Index(Character.Cloth.Select(x => x.Id), c.Head.Colour), Index(Character.Coats.Select(x => x.Id), c.Coat.Kind), Index(Character.Cloth.Select(x => x.Id), c.Coat.Colour), Index(Character.Cloth.Select(x => x.Id), c.Shirt.Colour), Index(Character.Cloth.Select(x => x.Id), c.Vest.Colour), Index(Character.Cloth.Select(x => x.Id), c.Lower.Colour), Index(Character.Aprons.Select(x => x.Id), c.Apron.Kind), Index(Character.Cloth.Select(x => x.Id), c.Apron.Colour), Index(Character.Feet.Select(x => x.Id), c.Feet.Kind), Index((c.Feet.Kind == "clogs" ? Character.Wood : Character.Leather).Select(x => x.Id), c.Feet.Colour), p.Best ? 1 : 0 };
        return "A" + string.Concat(fields.Select(n => B64[Math.Clamp(n, 0, 63)]));
    }
    public static Profile? FromCode(string code, string first = "Stranger", string last = "")
    {
        if (code.Length != 20 || code[0] != 'A') return null; var n = code[1..].Select(ch => B64.IndexOf(ch)).ToArray(); if (n.Any(i => i < 0)) return null;
        string At(int index, IEnumerable<string> list) => list.ElementAtOrDefault(n[index]) ?? "";
        string feet = At(16, Character.Feet.Select(x => x.Id)); if (feet == "") feet = "boots";
        return Character.ClampProfile(new Profile { First = first, Last = last, Sex = n[0] == 1 ? "woman" : "man", Age = Character.AgeMin + n[1], Build = At(2, Character.Builds.Select(x => x.Id)), Skin = At(3, Character.Skin.Select(x => x.Id)), Hair = new ProfileHair(At(4, Character.HairColours.Select(x => x.Id)), At(5, Character.HairStyles.Select(x => x.Id))), Face = At(6, Character.Faces.Select(x => x.Id)), Clothes = new ProfileClothes { Head = new ClothesPiece(At(7, Character.Heads.Select(x => x.Id)), At(8, Character.Cloth.Select(x => x.Id))), Coat = new ClothesPiece(At(9, Character.Coats.Select(x => x.Id)), At(10, Character.Cloth.Select(x => x.Id))), Shirt = new ClothesTint(At(11, Character.Cloth.Select(x => x.Id))), Vest = new ClothesTint(At(12, Character.Cloth.Select(x => x.Id))), Lower = new ClothesTint(At(13, Character.Cloth.Select(x => x.Id))), Apron = new ClothesPiece(At(14, Character.Aprons.Select(x => x.Id)), At(15, Character.Cloth.Select(x => x.Id))), Feet = new ClothesPiece(feet, At(17, (feet == "clogs" ? Character.Wood : Character.Leather).Select(x => x.Id))) }, Best = n[18] == 1 }).Profile;
    }
    public Profile? Stored(int player = 1)
    {
        string? json = C.Scalar<string>("SELECT profile_json FROM player_profile WHERE player_id=$p0", player); if (json == null) return null; try { return Character.FromJson(json); } catch { return null; }
    }
    public Profile Of(int player = 1) => Stored(player) ?? Character.Jef;
    public static JsonObject Words(Profile p)
    {
        bool woman = p.Sex == "woman"; return new JsonObject { ["first"] = p.First, ["full"] = p.Last == "" ? p.First : p.First + " " + p.Last, ["he"] = woman ? "she" : "he", ["him"] = woman ? "her" : "him", ["his"] = woman ? "her" : "his", ["He"] = woman ? "She" : "He", ["youngMan"] = (p.Age <= 30 ? "young " : "") + (woman ? "woman" : "man"), ["man"] = woman ? "woman" : "man", ["lad"] = woman ? "lass" : "lad", ["boy"] = woman ? "girl" : "boy", ["mister"] = woman ? "missus" : "mister", ["son"] = woman ? "daughter" : "son" };
    }
    public JsonObject View(int player = 1)
    {
        var p = Of(player); var words = Words(p); var shown = new JsonObject(); foreach (string key in new[] { "he", "him", "his", "lad", "mister" }) shown[key] = words[key]!.DeepClone();
        return new JsonObject { ["id"] = player, ["profile"] = JsonNode.Parse(Character.ToJson(p)), ["code"] = Code(p), ["band"] = Character.AgeBand(p.Age), ["look"] = Character.LookLine(p), ["words"] = shown, ["made"] = Stored(player) != null };
    }
    private static double Coerce(JsonNode? node)
    {
        if (node == null) return 0;
        if (node is JsonArray a) return a.Count == 0 ? 0 : a.Count == 1 ? Coerce(a[0]) : double.NaN;
        if (node is not JsonValue value) return double.NaN; if (value.TryGetValue<double>(out var number)) return number; if (value.TryGetValue<int>(out var integer)) return integer; if (value.TryGetValue<long>(out var wide)) return wide; if (value.TryGetValue<bool>(out var boolean)) return boolean ? 1 : 0;
        if (value.TryGetValue<string>(out var text)) { text = text.Trim(); if (text == "") return 0; if (double.TryParse(text, NumberStyles.Float, CultureInfo.InvariantCulture, out number)) return number; try { if (text.StartsWith("0x", StringComparison.OrdinalIgnoreCase)) return Convert.ToInt64(text[2..], 16); if (text.StartsWith("0b", StringComparison.OrdinalIgnoreCase)) return Convert.ToInt64(text[2..], 2); if (text.StartsWith("0o", StringComparison.OrdinalIgnoreCase)) return Convert.ToInt64(text[2..], 8); } catch { } }
        return double.NaN;
    }
    public static (Profile Profile, List<string> Fixed)? Check(JsonNode? raw)
    {
        if (raw is not JsonObject input) return null; var shape = new JsonObject();
        void Text(JsonObject source, JsonObject target, string key, int max) { if (source[key] is JsonValue v && v.TryGetValue<string>(out var s) && s.Length <= max) target[key] = s; }
        Text(input, shape, "first", 200); Text(input, shape, "last", 200); foreach (string key in new[] { "build", "skin", "face" }) Text(input, shape, key, 24);
        if (input["sex"] is JsonValue sex && sex.TryGetValue<string>(out var s) && s is "man" or "woman") shape["sex"] = s;
        if (input.ContainsKey("age")) { double age = Coerce(input["age"]); if (double.IsFinite(age) && age >= 0 && age <= 200) shape["age"] = age; }
        if (input["best"] is JsonValue best && best.TryGetValue<bool>(out var b)) shape["best"] = b;
        if (input["hair"] is JsonObject hair) { var h = new JsonObject(); Text(hair, h, "colour", 24); Text(hair, h, "style", 24); shape["hair"] = h; }
        if (input["clothes"] is JsonObject clothes) { var c = new JsonObject(); foreach (string slot in new[] { "head", "coat", "shirt", "vest", "lower", "apron", "feet" }) if (clothes.ContainsKey(slot)) { var result = new JsonObject(); if (clothes[slot] is JsonObject value) { Text(value, result, "kind", 24); Text(value, result, "colour", 24); } c[slot] = result; } shape["clothes"] = c; }
        Text(input, shape, "faceType", 32);
        Text(input, shape, "beard", 24); Text(input, shape, "moustache", 24);
        if (input["sliders"] is JsonObject sliders && sliders.Count <= 64) shape["sliders"] = sliders.DeepClone();
        using var document = JsonDocument.Parse(shape.ToJsonString()); return Character.ClampProfile(document.RootElement);
    }
    public JsonObject Save(int player, JsonNode? raw)
    {
        var checkedProfile = Check(raw) ?? throw new NativeServiceException("a profile is an object: name, sex, age, looks, clothes"); var p = checkedProfile.Profile;
        C.Atomic(() => { C.Execute("INSERT INTO player_profile(player_id,profile_json,code,updated_at) VALUES($p0,$p1,$p2,$p3) ON CONFLICT(player_id) DO UPDATE SET profile_json=excluded.profile_json,code=excluded.code,updated_at=excluded.updated_at", player, Character.ToJson(p), Code(p), DateTimeOffset.FromUnixTimeMilliseconds(C.Now).ToString("o")); C.Execute("UPDATE player SET name=$p0 WHERE id=$p1", p.First, player); });
        var result = View(player); result["fixed"] = new JsonArray(checkedProfile.Fixed.Select(f => (JsonNode)JsonValue.Create(f)!).ToArray()); return result;
    }
    public static string Addressed(Profile p, string text)
    {
        bool young = p.Age <= 30; if (p.Sex != "woman") return young ? text : Regex.Replace(Regex.Replace(text, @"\byoung man\b", "man"), @"\bYoung man\b", "Man"); string yw = young ? "young woman" : "woman";
        foreach (var pair in new[] { ("lad", "lass"), ("Lad", "Lass"), ("farm boy", "farm girl"), ("Kempen boy", "Kempen girl"), ("errand boy", "errand girl"), ("young man", yw), ("Young man", char.ToUpperInvariant(yw[0]) + yw[1..]), ("my son", "my daughter"), ("mister", "missus"), ("Mister", "Missus"), ("sir", "missus"), ("Sir", "Missus"), ("a man who", "a woman who"), ("a better man", "a better woman"), ("Listen to him!", "Listen to her!"), ("his own", "her own") }) text = Regex.Replace(text, @"\b" + Regex.Escape(pair.Item1) + (pair.Item1.EndsWith('!') ? "" : @"\b"), pair.Item2); return text;
    }
    public static string About(Profile p, string text)
    {
        if (p.First == "Jef" && p.Sex == "man" && p.Age <= 30) return text; var w = Words(p); string Word(string key) => w[key]!.GetValue<string>();
        if (p.Sex == "woman" || p.Age > 30) { text = Regex.Replace(text, @"\bJef, a young man\b", "Jef, a " + Word("youngMan")); text = Regex.Replace(text, @"\b([Aa]) young man (called|named) Jef\b", m => m.Groups[1].Value + " " + Word("youngMan") + " " + m.Groups[2].Value + " Jef"); text = Regex.Replace(text, @"\bthe young man Jef\b", "the " + Word("youngMan") + " Jef"); text = Regex.Replace(text, @"\bJef, the young man\b", "Jef, the " + Word("youngMan")); text = Regex.Replace(text, @"\b([Aa]) young man on the quays\b", m => m.Groups[1].Value + " " + Word("youngMan") + " on the quays"); text = Regex.Replace(text, @"\b([Tt])he young man's\b", m => m.Groups[1].Value + "he " + Word("youngMan") + "'s"); text = Regex.Replace(text, @"\b([Tt]hat|[Tt]he|[Aa]) lad Jef\b", m => m.Groups[1].Value + " " + Word("lad") + " Jef"); }
        if (p.Sex == "woman") foreach (var pair in new[] { ("farm boy", "farm girl"), ("Farm Boy", "Farm Girl"), ("Kempen boy", "Kempen girl"), ("Jef, a man", "Jef, a woman") }) text = Regex.Replace(text, @"\b" + pair.Item1 + @"\b", pair.Item2);
        text = Regex.Replace(text, @"\blet him look to his conduct\b", "let " + Word("him") + " look to " + Word("his") + " conduct"); return p.First == "Jef" ? text : Regex.Replace(text, @"\bJef\b", _ => p.First);
    }
    public string Shown(int player, string text) => Stored(player) is { } profile ? About(profile, text) : text;
    /// <summary>Take one profile snapshot for a complete response; translating every string needs no further SQLite reads.</summary>
    public Func<string, string> ShownSnapshot(int player = 1)
    {
        var profile = Stored(player); return profile == null ? text => text : text => About(profile, text);
    }
    public string NameOf(int player = 1)
    {
        string? first = Stored(player)?.First; if (!string.IsNullOrEmpty(first)) return first; if (player == 1) return "Jef";
        string? joined = C.Scalar<string>("SELECT name FROM mp_player WHERE id=$p0", player); if (!string.IsNullOrEmpty(joined)) return joined;
        string? saved = C.Scalar<string>("SELECT name FROM player WHERE id=$p0", player); return string.IsNullOrEmpty(saved) ? "the visitor" : saved;
    }
    private static bool LetterOrMark(string text, int index)
    {
        if (index < 0 || index >= text.Length) return false; if (char.IsLowSurrogate(text[index]) && index > 0 && char.IsHighSurrogate(text[index - 1])) index--;
        if (!Rune.TryGetRuneAt(text, index, out var rune)) return false; return Rune.GetUnicodeCategory(rune) is UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter or UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark;
    }
    private static string JefNames(string text, string replacement)
    {
        var output = new StringBuilder(); int from = 0;
        for (int at = text.IndexOf("Jef", StringComparison.Ordinal); at >= 0; at = text.IndexOf("Jef", at + 3, StringComparison.Ordinal)) {
            if (LetterOrMark(text, at - 1) || LetterOrMark(text, at + 3)) continue; output.Append(text, from, at - from);
            // Original JavaScript replace uses a replacement string: honour its dollar tokens as well.
            for (int i = 0; i < replacement.Length; i++) {
                if (replacement[i] != '$' || i + 1 == replacement.Length) { output.Append(replacement[i]); continue; }
                switch (replacement[i + 1]) { case '$': output.Append('$'); i++; break; case '&': output.Append("Jef"); i++; break; case '`': output.Append(text, 0, at); i++; break; case '\'': output.Append(text, at + 3, text.Length - at - 3); i++; break; default: output.Append('$'); break; }
            } from = at + 3;
        } output.Append(text, from, text.Length - from); return output.ToString();
    }
    public string Store(int player, string text) => player == 1 ? text : JefNames(text, NameOf(player));
    public string Read(int player, string text) { if (player == 1) return text; string name = NameOf(1); return JefNames(text, name == "Jef" ? "Je\u200Df" : name); }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET", "/api/player/profile", r => View(r.PlayerId)); service.Register("PUT", "/api/player/profile", r => Save(r.PlayerId, r.Body.ContainsKey("profile") ? r.Body["profile"] : r.Body));
        service.Register("GET", "/api/player/:id/look", r => { if (!int.TryParse(r.Param("id"), out int id) || id != 1 && Stored(id) == null) throw new NativeServiceException("no such player", 404); var p = Of(id); return new JsonObject { ["id"] = id, ["code"] = Code(p), ["first"] = p.First, ["last"] = p.Last }; });
    }
}
