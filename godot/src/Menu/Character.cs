// The player's character: the C# port of shared/character.ts.
//
// KEEP IN STEP with shared/character.ts. The server clamps every profile with the TypeScript; this file
// must give the same answer for the same input, so the menu shows what the server will keep. When the
// TypeScript changes (a list, a default, a rule in cleanName or clampProfile, the look line), change this
// file the same way. The lists are append-only there, so they are append-only here.
//
// Ported: the lists and palette, the defaults (Jef, Mie), the name check, the clamp, the look line,
// the random character and Sunday best.
// Not ported (the menu does not need them): appearanceCode / fromAppearanceCode, wordsFor, aboutPlayer,
// phrasesBack, addressed.
//
// Plain C#: no Godot types, System.Text.Json only.

#nullable enable

using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace Scheldemist.Menu;

/// <summary>One colour of a palette: its id (what the profile stores), its name in words, its colour.</summary>
public sealed record Swatch(string Id, string Label, int Hex);

/// <summary>One option of a picker. Sex is "man" or "woman" when only that sex may wear it, null when both may.</summary>
public sealed record Choice(string Id, string Label, string? Sex = null);

/// <summary>One age band ("16-20" and so on) with its first and last year.</summary>
public sealed record AgeBandInfo(string Id, int Min, int Max);

/// <summary>The first names or surnames for the random character, by language.</summary>
public sealed record NameList(IReadOnlyList<string> Flemish, IReadOnlyList<string> Walloon);

/// <summary>A piece of clothing with a kind and a colour (head, coat, apron, feet).</summary>
public sealed class ClothesPiece
{
    [JsonPropertyName("kind")] public string Kind { get; set; } = "";
    [JsonPropertyName("colour")] public string Colour { get; set; } = "";

    public ClothesPiece() { }
    public ClothesPiece(string kind, string colour) { Kind = kind; Colour = colour; }
    public ClothesPiece Clone() => new(Kind, Colour);
}

/// <summary>A piece of clothing with only a colour (shirt, vest, lower).</summary>
public sealed class ClothesTint
{
    [JsonPropertyName("colour")] public string Colour { get; set; } = "";

    public ClothesTint() { }
    public ClothesTint(string colour) { Colour = colour; }
    public ClothesTint Clone() => new(Colour);
}

/// <summary>Hair: colour (an id from HairColours) and style (an id from HairStyles).</summary>
public sealed class ProfileHair
{
    [JsonPropertyName("colour")] public string Colour { get; set; } = "";
    [JsonPropertyName("style")] public string Style { get; set; } = "";

    public ProfileHair() { }
    public ProfileHair(string colour, string style) { Colour = colour; Style = style; }
    public ProfileHair Clone() => new(Colour, Style);
}

/// <summary>What the character wears. Same shape and order as the TS Clothes interface.</summary>
public sealed class ProfileClothes
{
    [JsonPropertyName("head")] public ClothesPiece Head { get; set; } = new();
    [JsonPropertyName("coat")] public ClothesPiece Coat { get; set; } = new();
    /// <summary>Shirt (men) or blouse (women).</summary>
    [JsonPropertyName("shirt")] public ClothesTint Shirt { get; set; } = new();
    /// <summary>A man's waistcoat (under the jacket; hidden by the smock).</summary>
    [JsonPropertyName("vest")] public ClothesTint Vest { get; set; } = new();
    /// <summary>Trousers (men) or skirt (women).</summary>
    [JsonPropertyName("lower")] public ClothesTint Lower { get; set; } = new();
    [JsonPropertyName("apron")] public ClothesPiece Apron { get; set; } = new();
    [JsonPropertyName("feet")] public ClothesPiece Feet { get; set; } = new();

    public ProfileClothes Clone() => new()
    {
        Head = Head.Clone(),
        Coat = Coat.Clone(),
        Shirt = Shirt.Clone(),
        Vest = Vest.Clone(),
        Lower = Lower.Clone(),
        Apron = Apron.Clone(),
        Feet = Feet.Clone(),
    };
}

/// <summary>
/// The character profile, in the server's JSON shape (the TS Profile interface). The property order is
/// the TS order, so the JSON reads the same.
/// </summary>
public sealed class Profile
{
    /// <summary>Schema version, always 1.</summary>
    [JsonPropertyName("v")] public int V { get; set; } = 1;
    [JsonPropertyName("first")] public string First { get; set; } = "";
    /// <summary>May be empty (Jef never had one).</summary>
    [JsonPropertyName("last")] public string Last { get; set; } = "";
    /// <summary>"man" or "woman".</summary>
    [JsonPropertyName("sex")] public string Sex { get; set; } = "man";
    /// <summary>The exact age, 16 to 60; the band follows from it.</summary>
    [JsonPropertyName("age")] public int Age { get; set; } = 19;
    /// <summary>"slight", "middling" or "stout".</summary>
    [JsonPropertyName("build")] public string Build { get; set; } = "middling";
    [JsonPropertyName("skin")] public string Skin { get; set; } = "";
    [JsonPropertyName("hair")] public ProfileHair Hair { get; set; } = new();
    [JsonPropertyName("face")] public string Face { get; set; } = "";
    [JsonPropertyName("clothes")] public ProfileClothes Clothes { get; set; } = new();
    /// <summary>Dressed in Sunday best (the look line says so).</summary>
    [JsonPropertyName("best")] public bool Best { get; set; }

    /// <summary>A deep copy: nothing is shared with this profile.</summary>
    public Profile Clone() => new()
    {
        V = V,
        First = First,
        Last = Last,
        Sex = Sex,
        Age = Age,
        Build = Build,
        Skin = Skin,
        Hair = Hair.Clone(),
        Face = Face,
        Clothes = Clothes.Clone(),
        Best = Best,
    };
}

public static class Character
{
    // ------------------------------------------------------------------ the palette

    /// <summary>The period palette for cloth (Antwerp 1873: dyed wool and linen, worn and faded; black and white linen for Sunday).</summary>
    public static readonly IReadOnlyList<Swatch> Cloth = new Swatch[]
    {
        new("indigo", "worn indigo", 0x34425a),
        new("faded_indigo", "faded blue", 0x5a6a80),
        new("blue_grey", "blue-grey", 0x46505a),
        new("brown", "brown", 0x5a4432),
        new("dark_brown", "dark brown", 0x3a2a1e),
        new("grey", "grey", 0x6e6a62),
        new("charcoal", "charcoal", 0x38383a),
        new("black", "black", 0x1a1a1c),
        new("faded_red", "faded red", 0x8a3e32),
        new("green", "bottle green", 0x3e5236),
        new("linen", "undyed linen", 0xc4baa0),
        new("white", "white linen", 0xe2ded2),
        new("ochre", "ochre", 0x9a7a40),
    };

    /// <summary>Colours for boots.</summary>
    public static readonly IReadOnlyList<Swatch> Leather = new Swatch[]
    {
        new("black_leather", "black", 0x161412),
        new("brown_leather", "brown", 0x3e2c1e),
        new("worn_leather", "worn", 0x5a4632),
    };

    /// <summary>Colours for clogs.</summary>
    public static readonly IReadOnlyList<Swatch> Wood = new Swatch[]
    {
        new("willow", "pale wood", 0xbfa070),
        new("tarred", "tarred", 0x2a2420),
        new("yellow", "yellow-painted", 0xb89a48),
    };

    public static readonly IReadOnlyList<Swatch> Skin = new Swatch[]
    {
        new("pale", "pale", 0xdcb49e),
        new("fair", "fair", 0xcc9e84),
        new("rosy", "ruddy", 0xc88a70),
        new("weathered", "weathered", 0xae7a5e),
        new("olive", "olive", 0x9e7454),
        new("brown", "brown", 0x7a5440),
    };

    /// <summary>Hair colours (HAIR in the TypeScript).</summary>
    public static readonly IReadOnlyList<Swatch> HairColours = new Swatch[]
    {
        new("flaxen", "flaxen", 0xc0a068),
        new("fair", "fair", 0x9a7a48),
        new("red", "red", 0x8a4222),
        new("light_brown", "light brown", 0x6a4a2a),
        new("dark_brown", "dark brown", 0x3a2a1c),
        new("black", "black", 0x16120e),
        new("grey", "grey", 0x8e8a82),
        new("white", "white", 0xc8c4bc),
    };

    // ------------------------------------------------------------------ the pickers' options

    public static readonly IReadOnlyList<Choice> Builds = new Choice[]
    {
        new("slight", "Slight"),
        new("middling", "Middling"),
        new("stout", "Stout"),
    };

    public static readonly IReadOnlyList<Choice> HairStyles = new Choice[]
    {
        new("short", "Short", "man"),
        new("long", "Long to the collar", "man"),
        new("balding", "Thinning", "man"),
        new("bun", "In a bun", "woman"),
        new("plaits", "In plaits", "woman"),
        new("coronet", "Plaits pinned round", "woman"),
    };

    /// <summary>Facial hair (men); a woman's is always "none".</summary>
    public static readonly IReadOnlyList<Choice> Faces = new Choice[]
    {
        new("none", "None", "woman"),
        new("clean", "Clean-shaven", "man"),
        new("light_stubble", "A few days' growth", "man"),
        new("stubble", "Stubble", "man"),
        new("moustache", "Moustache", "man"),
        new("whiskers", "Side whiskers", "man"),
        new("beard", "Short beard", "man"),
        new("walrus", "Walrus moustache", "man"),
    };

    public static readonly IReadOnlyList<Choice> Heads = new Choice[]
    {
        new("none", "Bare-headed"),
        new("cap", "Flat cap", "man"),
        new("knitcap", "Knitted cap", "man"),
        new("bowler", "Round hat", "man"),
        new("tophat", "Tall hat", "man"),
        new("bonnet", "Bonnet", "woman"),
        new("whitecap", "White cap", "woman"),
        new("headscarf", "Headscarf", "woman"),
    };

    public static readonly IReadOnlyList<Choice> Coats = new Choice[]
    {
        new("none", "Shirt and waistcoat", "man"),
        new("jacket", "Short jacket", "man"),
        new("coat", "Long coat", "man"),
        new("smock", "Blue smock (kiel)", "man"),
        new("no_shawl", "No shawl", "woman"),
        new("shawl", "Shawl", "woman"),
        new("check_shawl", "Check shawl", "woman"),
    };

    public static readonly IReadOnlyList<Choice> Aprons = new Choice[]
    {
        new("none", "No apron"),
        new("apron", "Apron"),
    };

    public static readonly IReadOnlyList<Choice> Feet = new Choice[]
    {
        new("boots", "Boots"),
        new("clogs", "Clogs"),
    };

    // ------------------------------------------------------------------ age and name limits

    public const int AgeMin = 16;
    public const int AgeMax = 60;

    public static readonly IReadOnlyList<AgeBandInfo> AgeBands = new AgeBandInfo[]
    {
        new("16-20", 16, 20),
        new("21-30", 21, 30),
        new("31-45", 31, 45),
        new("46-60", 46, 60),
    };

    /// <summary>The id of the band an age falls in; the first band when it falls in none.</summary>
    public static string AgeBand(int age)
    {
        foreach (var b in AgeBands)
            if (age >= b.Min && age <= b.Max) return b.Id;
        return AgeBands[0].Id;
    }

    /// <summary>The longest first name (NAME_MAX.first).</summary>
    public const int NameMaxFirst = 20;
    /// <summary>The longest surname (NAME_MAX.last).</summary>
    public const int NameMaxLast = 24;

    // ------------------------------------------------------------------ the defaults

    /// <summary>
    /// Today's Jef: a farm boy from the Kempen, 19, a thin brown jacket, a cap. A missing profile is this
    /// one. A new copy on every read, so nobody can change the default by accident.
    /// </summary>
    public static Profile Jef => new()
    {
        V = 1,
        First = "Jef",
        Last = "",
        Sex = "man",
        Age = 19,
        Build = "middling",
        Skin = "weathered",
        Hair = new ProfileHair("dark_brown", "short"),
        Face = "light_stubble",
        Clothes = new ProfileClothes
        {
            Head = new ClothesPiece("cap", "charcoal"),
            Coat = new ClothesPiece("jacket", "brown"),
            Shirt = new ClothesTint("linen"),
            Vest = new ClothesTint("charcoal"),
            Lower = new ClothesTint("grey"),
            Apron = new ClothesPiece("none", "linen"),
            Feet = new ClothesPiece("boots", "worn_leather"),
        },
        Best = false,
    };

    /// <summary>A woman's starting look (the creator's first "woman" pick). A new copy on every read.</summary>
    public static Profile Mie => new()
    {
        V = 1,
        First = "Mie",
        Last = "",
        Sex = "woman",
        Age = 19,
        Build = "middling",
        Skin = "fair",
        Hair = new ProfileHair("light_brown", "bun"),
        Face = "none",
        Clothes = new ProfileClothes
        {
            Head = new ClothesPiece("whitecap", "white"),
            Coat = new ClothesPiece("check_shawl", "faded_red"),
            Shirt = new ClothesTint("blue_grey"),
            Vest = new ClothesTint("charcoal"),
            Lower = new ClothesTint("brown"),
            Apron = new ClothesPiece("apron", "linen"),
            Feet = new ClothesPiece("clogs", "willow"),
        },
        Best = false,
    };

    /// <summary>The starting profile for a sex: Mie for "woman", Jef for anything else. A new copy.</summary>
    public static Profile DefaultFor(string? sex) => sex == "woman" ? Mie : Jef;

    /// <summary>Options open to this sex (the creator's pickers).</summary>
    public static List<Choice> OptionsFor(IEnumerable<Choice> list, string sex) =>
        list.Where(c => string.IsNullOrEmpty(c.Sex) || c.Sex == sex).ToList();

    /// <summary>
    /// The colours a slot may take: "feet" gives Wood for clogs and Leather otherwise, "skin" gives Skin,
    /// "hair" gives HairColours, every other slot gives Cloth.
    /// </summary>
    public static IReadOnlyList<Swatch> SwatchesFor(string slot, string? kind = null)
    {
        if (slot == "feet") return kind == "clogs" ? Wood : Leather;
        if (slot == "skin") return Skin;
        if (slot == "hair") return HairColours;
        return Cloth;
    }

    /// <summary>A long apron would hang under a long coat or a smock: a man wears one only in shirt sleeves or a short jacket.</summary>
    public static bool ApronAllowed(Profile p) =>
        p.Sex == "woman" || p.Clothes.Coat.Kind == "none" || p.Clothes.Coat.Kind == "jacket";

    // ------------------------------------------------------------------ names

    /// <summary>
    /// Words that may not be a name: they would read as ordinary English in every line about the player,
    /// or they are the town's own people. All lower case, all plain ASCII.
    /// </summary>
    private static readonly HashSet<string> NotNames = new(StringComparer.Ordinal)
    {
        "i", "me", "my", "you", "your", "he", "him", "his", "she", "her", "it", "its", "we", "us", "they", "them", "the", "a", "an", "and", "or", "but", "not", "no",
        "yes", "of", "to", "in", "on", "at", "by", "for", "with", "from", "this", "that", "who", "what", "one", "some", "all", "any",
        "god", "lord", "jesus", "christ", "devil", "satan", "mister", "missus", "sir", "madam", "lad", "lass", "man", "woman", "boy", "girl", "friend",
        "nobody", "somebody", "someone", "everyone", "police", "agent", "father", "mother", "sister", "brother", "king", "queen", "priest",
        "jenever", "antwerp", "schelde", "kempen", "system", "assistant", "user", "claude", "model", "prompt",
        // the game's own named people (server town/population.ts TAKEN); Jef is the player's own default
        "sooi", "tuur", "fientje", "peeters", "cools", "verhulst", "leentje", "van dyck",
    };

    // The ECMAScript option makes \b mean what it means in JavaScript (a word is A-Z, a-z, 0-9, _ only).
    private const RegexOptions JsRegexI = RegexOptions.ECMAScript | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant;

    /// <summary>The free-text gate's worst phrases (server hooks/dialogue.ts BLOCK), for names.</summary>
    private static readonly Regex[] Hostile =
    {
        new(@"ignore\b|previous|instruction|system ?prompt|you are now|jailbreak|developer mode|pretend\b", JsRegexI),
        new(@"\b(assistant|system|user|tool)\b", JsRegexI),
        new(@"\b(claude|anthropic|openai|chatgpt|gpt|llm|language model|ai model)\b", JsRegexI),
        new(@"\b(api ?key|password|sudo|powershell)\b", JsRegexI),
    };

    /// <summary>What JavaScript calls white space (\s and trim): not the same set as .NET's.</summary>
    private static bool IsJsSpace(char c) =>
        c is (char)0x09 or (char)0x0A or (char)0x0B or (char)0x0C or (char)0x0D or (char)0x20 or (char)0xA0 or (char)0x1680
            or (char)0x2028 or (char)0x2029 or (char)0x202F or (char)0x205F or (char)0x3000 or (char)0xFEFF
        || (c >= (char)0x2000 && c <= (char)0x200A);

    /// <summary>JavaScript's s.replace(/\s+/g, " ").trim().</summary>
    private static string CollapseSpaces(string s)
    {
        var sb = new StringBuilder(s.Length);
        var inSpace = false;
        foreach (var ch in s)
        {
            if (IsJsSpace(ch)) { inSpace = true; continue; }
            if (inSpace && sb.Length > 0) sb.Append(' ');
            inSpace = false;
            sb.Append(ch);
        }
        return sb.ToString();
    }

    /// <summary>A character the edges of a name lose: apostrophe, hyphen, space.</summary>
    private static bool IsNameEdge(char c) => c == '\'' || c == '-' || IsJsSpace(c);

    private static string TrimNameEnd(string s)
    {
        var end = s.Length;
        while (end > 0 && IsNameEdge(s[end - 1])) end--;
        return s.Substring(0, end);
    }

    /// <summary>NAME_CHARS: true when the text holds anything but letters, accents (marks), spaces, hyphens and apostrophes.</summary>
    private static bool HasNonNameChar(string s)
    {
        foreach (var rune in s.EnumerateRunes())
        {
            if (rune.Value == ' ' || rune.Value == '\'' || rune.Value == '-') continue;
            switch (Rune.GetUnicodeCategory(rune))
            {
                case UnicodeCategory.UppercaseLetter:
                case UnicodeCategory.LowercaseLetter:
                case UnicodeCategory.TitlecaseLetter:
                case UnicodeCategory.ModifierLetter:
                case UnicodeCategory.OtherLetter:
                case UnicodeCategory.NonSpacingMark:
                case UnicodeCategory.SpacingCombiningMark:
                case UnicodeCategory.EnclosingMark:
                    continue;
                default:
                    return true;
            }
        }
        return false;
    }

    /// <summary>Lower case for A to Z only. The forbidden words are plain ASCII, so this is all the check needs.</summary>
    private static string AsciiLower(string s)
    {
        var chars = s.ToCharArray();
        for (var i = 0; i < chars.Length; i++)
            if (chars[i] >= 'A' && chars[i] <= 'Z') chars[i] = (char)(chars[i] + 32);
        return new string(chars);
    }

    /// <summary>
    /// The letters whose JavaScript upper case (toLocaleUpperCase) is not what .NET's ToUpperInvariant
    /// gives: the German sharp s ("SS"), the dotless i, old Greek letters with an iota under them, and a
    /// few more that become two or three characters. "letter:upper case", in hex, UTF-16 units. Found by
    /// trying every letter against Node 24 (Unicode 16); in every other case the two agree.
    /// </summary>
    private const string UpperSpecialTable =
        "00DF:0053 0053;0131:0049;019B:A7DC;01F0:004A 030C;0264:A7CB;0390:0399 0308 0301;03B0:03A5 0308 0301;1E96:0048 0331;" +
        "1E97:0054 0308;1E98:0057 030A;1E99:0059 030A;1F50:03A5 0313;1F52:03A5 0313 0300;1F54:03A5 0313 0301;1F56:03A5 0313 0342;1F80:1F08 0399;" +
        "1F81:1F09 0399;1F82:1F0A 0399;1F83:1F0B 0399;1F84:1F0C 0399;1F85:1F0D 0399;1F86:1F0E 0399;1F87:1F0F 0399;1F88:1F08 0399;" +
        "1F89:1F09 0399;1F8A:1F0A 0399;1F8B:1F0B 0399;1F8C:1F0C 0399;1F8D:1F0D 0399;1F8E:1F0E 0399;1F8F:1F0F 0399;1F90:1F28 0399;" +
        "1F91:1F29 0399;1F92:1F2A 0399;1F93:1F2B 0399;1F94:1F2C 0399;1F95:1F2D 0399;1F96:1F2E 0399;1F97:1F2F 0399;1F98:1F28 0399;" +
        "1F99:1F29 0399;1F9A:1F2A 0399;1F9B:1F2B 0399;1F9C:1F2C 0399;1F9D:1F2D 0399;1F9E:1F2E 0399;1F9F:1F2F 0399;1FA0:1F68 0399;" +
        "1FA1:1F69 0399;1FA2:1F6A 0399;1FA3:1F6B 0399;1FA4:1F6C 0399;1FA5:1F6D 0399;1FA6:1F6E 0399;1FA7:1F6F 0399;1FA8:1F68 0399;" +
        "1FA9:1F69 0399;1FAA:1F6A 0399;1FAB:1F6B 0399;1FAC:1F6C 0399;1FAD:1F6D 0399;1FAE:1F6E 0399;1FAF:1F6F 0399;1FB2:1FBA 0399;" +
        "1FB3:0391 0399;1FB4:0386 0399;1FB6:0391 0342;1FB7:0391 0342 0399;1FBC:0391 0399;1FC2:1FCA 0399;1FC3:0397 0399;1FC4:0389 0399;" +
        "1FC6:0397 0342;1FC7:0397 0342 0399;1FCC:0397 0399;1FD2:0399 0308 0300;1FD6:0399 0342;1FD7:0399 0308 0342;1FE2:03A5 0308 0300;1FE4:03A1 0313;" +
        "1FE6:03A5 0342;1FE7:03A5 0308 0342;1FF2:1FFA 0399;1FF3:03A9 0399;1FF4:038F 0399;1FF6:03A9 0342;1FF7:03A9 0342 0399;1FFC:03A9 0399";

    private static readonly Dictionary<char, string> UpperSpecial = ReadUpperSpecial();

    private static Dictionary<char, string> ReadUpperSpecial()
    {
        var map = new Dictionary<char, string>();
        foreach (var entry in UpperSpecialTable.Split(';'))
        {
            var sides = entry.Split(':');
            var upper = new StringBuilder();
            foreach (var unit in sides[1].Split(' ')) upper.Append((char)Convert.ToInt32(unit, 16));
            map[(char)Convert.ToInt32(sides[0], 16)] = upper.ToString();
        }
        return map;
    }

    /// <summary>JavaScript's s.charAt(0).toLocaleUpperCase() for one UTF-16 unit.</summary>
    private static string UpperFirst(char c) =>
        UpperSpecial.TryGetValue(c, out var special) ? special : char.ToUpperInvariant(c).ToString();

    /// <summary>
    /// A name as typed, made safe: one form for look-alike letters, only letters, spaces, hyphens and
    /// apostrophes, at most three words and <paramref name="max"/> characters, the first letter upper case.
    /// Null when nothing usable is left or it is not a name (a common word, a town person's name, an order
    /// to a model). With <paramref name="allowEmpty"/> an empty name comes back as "" instead of null.
    /// </summary>
    public static string? CleanName(string? raw, int max, bool allowEmpty = false)
    {
        if (raw is null) return allowEmpty ? "" : null;
        string normal;
        try { normal = raw.Normalize(NormalizationForm.FormKC); }
        catch (ArgumentException) { return null; } // half a surrogate pair: not a letter, so not a name
        // curly and modifier apostrophes (U+2018, U+2019, U+02BC) become the plain one
        var typed = CollapseSpaces(normal.Replace((char)0x2018, (char)0x27).Replace((char)0x2019, (char)0x27).Replace((char)0x02BC, (char)0x27));
        // anything but letters, spaces, hyphens and apostrophes (digits, markup, quotes, control or invisible
        // characters): not a name at all, so nothing of it is kept
        if (HasNonNameChar(typed)) return null;
        var start = 0;
        while (start < typed.Length && IsNameEdge(typed[start])) start++;
        var s = TrimNameEnd(typed.Substring(start));
        if (s.Length == 0) return allowEmpty ? "" : null;
        foreach (var re in Hostile)
            if (re.IsMatch(s)) return null;
        s = string.Join(" ", s.Split(' ').Take(3));
        if (s.Length > max) s = TrimNameEnd(s.Substring(0, max));
        if (s.Length < 2) return allowEmpty && s.Length == 0 ? "" : null;
        if (NotNames.Contains(AsciiLower(s))) return null;
        foreach (var w in s.Split(' '))
            if (w.Length > 3 && NotNames.Contains(AsciiLower(w))) return null;
        return UpperFirst(s[0]) + s.Substring(1);
    }

    // ------------------------------------------------------------------ the clamp

    // Reading "anything" the way the TypeScript does. A JsonElement of kind Undefined stands for
    // JavaScript's undefined (a field that is not there); JSON null stays null, which is not the same.

    /// <summary>A field of an object; Undefined when it is not there or the parent is not an object.</summary>
    private static JsonElement Get(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) ? v : default;

    /// <summary>The string in an element, or null when it is not a string.</summary>
    private static string? Str(JsonElement e)
    {
        if (e.ValueKind != JsonValueKind.String) return null;
        try { return e.GetString(); }
        catch (InvalidOperationException) { return ((char)0xFFFD).ToString(); } // broken text: a string that matches nothing
    }

    /// <summary>pickId for a swatch list: the id when the list has it, else the default.</summary>
    private static string PickId(IReadOnlyList<Swatch> list, JsonElement v, string dflt)
    {
        var id = Str(v);
        if (id is null) return dflt;
        foreach (var x in list)
            if (x.Id == id) return x.Id;
        return dflt;
    }

    /// <summary>pickId for a choice list: the id when the list has it and this sex may wear it, else the default.</summary>
    private static string PickId(IReadOnlyList<Choice> list, JsonElement v, string dflt, string? sex = null)
    {
        var id = Str(v);
        if (id is null) return dflt;
        foreach (var x in list)
        {
            if (x.Id != id) continue;
            if (!string.IsNullOrEmpty(sex) && !string.IsNullOrEmpty(x.Sex) && x.Sex != sex) return dflt;
            return x.Id;
        }
        return dflt;
    }

    private static readonly Regex JsDecimal = new(@"^[+-]?(Infinity|(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?)$", RegexOptions.ECMAScript);
    private static readonly Regex JsRadix = new(@"^0([xX][0-9a-fA-F]+|[oO][0-7]+|[bB][01]+)$", RegexOptions.ECMAScript);

    /// <summary>JavaScript's Number(text).</summary>
    private static double JsNumber(string text)
    {
        int a = 0, b = text.Length;
        while (a < b && IsJsSpace(text[a])) a++;
        while (b > a && IsJsSpace(text[b - 1])) b--;
        var s = text.Substring(a, b - a);
        if (s.Length == 0) return 0;
        if (JsRadix.IsMatch(s))
        {
            var radix = char.ToLowerInvariant(s[1]) switch { 'x' => 16, 'o' => 8, _ => 2 };
            double n = 0;
            for (var i = 2; i < s.Length; i++) n = n * radix + Convert.ToInt32(s[i].ToString(), 16);
            return n;
        }
        if (!JsDecimal.IsMatch(s)) return double.NaN;
        if (s.EndsWith("Infinity", StringComparison.Ordinal)) return s[0] == '-' ? double.NegativeInfinity : double.PositiveInfinity;
        return double.Parse(s, NumberStyles.Float, CultureInfo.InvariantCulture);
    }

    /// <summary>JavaScript's Number(value) for any JSON value.</summary>
    private static double JsNumber(JsonElement e)
    {
        switch (e.ValueKind)
        {
            case JsonValueKind.Null: return 0;
            case JsonValueKind.True: return 1;
            case JsonValueKind.False: return 0;
            case JsonValueKind.Number:
                if (e.TryGetDouble(out var d)) return d;
                return e.GetRawText().StartsWith("-", StringComparison.Ordinal) ? double.NegativeInfinity : double.PositiveInfinity;
            case JsonValueKind.String: return JsNumber(Str(e) ?? "");
            case JsonValueKind.Array:
                // Number([]) is 0, Number([x]) is Number(String(x)), a longer array is not a number
                var n = e.GetArrayLength();
                if (n == 0) return 0;
                if (n > 1) return double.NaN;
                var only = e[0];
                return only.ValueKind switch
                {
                    JsonValueKind.Null => 0,
                    JsonValueKind.Number or JsonValueKind.String or JsonValueKind.Array => JsNumber(only),
                    _ => double.NaN,
                };
            default: return double.NaN; // undefined, an object
        }
    }

    /// <summary>JavaScript's Math.round: halves go up (2.5 gives 3, -2.5 gives -2).</summary>
    private static double JsRound(double x)
    {
        if (double.IsNaN(x) || double.IsInfinity(x)) return x;
        var floor = Math.Floor(x);
        return x - floor >= 0.5 ? floor + 1 : floor;
    }

    /// <summary>
    /// Any JSON in, a whole valid profile out: every field checked, clamped, or set to the sex's default.
    /// Fixed names the fields that were not usable as sent and were put back to a default ("first", "age",
    /// "hair.style", "coat.kind" and so on), each once, in the order the TypeScript finds them.
    /// </summary>
    public static (Profile Profile, List<string> Fixed) ClampProfile(JsonElement raw)
    {
        var r = raw; // Get() treats anything that is not an object as {}
        var fixedFields = new List<string>();
        void Push(string name) { if (!fixedFields.Contains(name)) fixedFields.Add(name); }

        var sexIn = Get(r, "sex");
        var sexText = Str(sexIn);
        var sex = sexText == "woman" ? "woman" : "man";
        if (sexIn.ValueKind != JsonValueKind.Undefined && sexText != "man" && sexText != "woman") Push("sex");
        var d = DefaultFor(sex);

        var first = CleanName(Str(Get(r, "first")), NameMaxFirst);
        if (first is null) Push("first");
        // r.last ?? "": a missing or null surname is an empty one; anything that is not text is empty too
        var lastIn = Get(r, "last");
        var last = lastIn.ValueKind is JsonValueKind.Undefined or JsonValueKind.Null
            ? CleanName("", NameMaxLast, true)
            : CleanName(Str(lastIn), NameMaxLast, true);
        if (last is null) Push("last");

        var ageN = JsRound(JsNumber(Get(r, "age")));
        var ageOk = !double.IsNaN(ageN) && !double.IsInfinity(ageN);
        var age = ageOk ? (int)Math.Max(AgeMin, Math.Min(AgeMax, ageN)) : d.Age;
        if (!ageOk || ageN != age) Push("age");

        var hair = Get(r, "hair");
        var c = Get(r, "clothes");
        // note(): a field that was sent and is not what we kept goes on the fixed list
        string Note(string name, string kept, JsonElement want)
        {
            if (want.ValueKind != JsonValueKind.Undefined && Str(want) != kept) Push(name);
            return kept;
        }

        JsonElement head = Get(c, "head"), coat = Get(c, "coat"), shirt = Get(c, "shirt"), vest = Get(c, "vest"),
            lower = Get(c, "lower"), apron = Get(c, "apron"), feet = Get(c, "feet");
        var feetKind = Note("feet.kind", PickId(Feet, Get(feet, "kind"), d.Clothes.Feet.Kind), Get(feet, "kind"));
        var feetSwatches = SwatchesFor("feet", feetKind);

        // the fields in the TypeScript's order: the fixed list comes out in the same order
        var p = new Profile { V = 1, First = first ?? d.First, Last = last ?? "", Sex = sex, Age = age };
        p.Build = Note("build", PickId(Builds, Get(r, "build"), d.Build), Get(r, "build"));
        p.Skin = Note("skin", PickId(Skin, Get(r, "skin"), d.Skin), Get(r, "skin"));
        p.Hair.Colour = Note("hair.colour", PickId(HairColours, Get(hair, "colour"), d.Hair.Colour), Get(hair, "colour"));
        p.Hair.Style = Note("hair.style", PickId(HairStyles, Get(hair, "style"), d.Hair.Style, sex), Get(hair, "style"));
        p.Face = Note("face", PickId(Faces, Get(r, "face"), d.Face, sex), Get(r, "face"));
        var cl = p.Clothes;
        cl.Head.Kind = Note("head.kind", PickId(Heads, Get(head, "kind"), d.Clothes.Head.Kind, sex), Get(head, "kind"));
        cl.Head.Colour = Note("head.colour", PickId(Cloth, Get(head, "colour"), d.Clothes.Head.Colour), Get(head, "colour"));
        cl.Coat.Kind = Note("coat.kind", PickId(Coats, Get(coat, "kind"), d.Clothes.Coat.Kind, sex), Get(coat, "kind"));
        cl.Coat.Colour = Note("coat.colour", PickId(Cloth, Get(coat, "colour"), d.Clothes.Coat.Colour), Get(coat, "colour"));
        cl.Shirt.Colour = Note("shirt.colour", PickId(Cloth, Get(shirt, "colour"), d.Clothes.Shirt.Colour), Get(shirt, "colour"));
        cl.Vest.Colour = Note("vest.colour", PickId(Cloth, Get(vest, "colour"), d.Clothes.Vest.Colour), Get(vest, "colour"));
        cl.Lower.Colour = Note("lower.colour", PickId(Cloth, Get(lower, "colour"), d.Clothes.Lower.Colour), Get(lower, "colour"));
        cl.Apron.Kind = Note("apron.kind", PickId(Aprons, Get(apron, "kind"), d.Clothes.Apron.Kind), Get(apron, "kind"));
        cl.Apron.Colour = Note("apron.colour", PickId(Cloth, Get(apron, "colour"), d.Clothes.Apron.Colour), Get(apron, "colour"));
        cl.Feet.Kind = feetKind;
        cl.Feet.Colour = Note("feet.colour", PickId(feetSwatches, Get(feet, "colour"), feetSwatches[0].Id), Get(feet, "colour"));
        p.Best = Get(r, "best").ValueKind == JsonValueKind.True;

        if (!ApronAllowed(p) && p.Clothes.Apron.Kind != "none")
        {
            p.Clothes.Apron.Kind = "none";
            Push("apron.kind");
        }
        return (p, fixedFields);
    }

    /// <summary>The clamp for a profile built in C# (the menu's working copy). Null gives the default, Jef.</summary>
    public static (Profile Profile, List<string> Fixed) ClampProfile(Profile? profile) =>
        ClampProfile(profile is null ? default : ToElement(profile));

    // ------------------------------------------------------------------ JSON

    /// <summary>The profile as the JSON the server takes: the TS Profile shape, fields in the TS order.</summary>
    public static string ToJson(Profile p) => Encoding.UTF8.GetString(ToUtf8(p));

    /// <summary>The same JSON as a JsonElement that owns its own memory.</summary>
    public static JsonElement ToElement(Profile p)
    {
        using var doc = JsonDocument.Parse(ToUtf8(p));
        return doc.RootElement.Clone();
    }

    /// <summary>A profile from the server's JSON, through the clamp (as the web client does with clampProfile(d.profile).profile).</summary>
    public static Profile FromJson(JsonElement json) => ClampProfile(json).Profile;

    /// <summary>The same from JSON text. Throws JsonException when the text is not JSON.</summary>
    public static Profile FromJson(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return ClampProfile(doc.RootElement).Profile;
    }

    // Written by hand, so it needs no reflection and does not depend on anyone's serializer options.
    private static byte[] ToUtf8(Profile p)
    {
        using var stream = new MemoryStream();
        using (var w = new Utf8JsonWriter(stream))
        {
            void Piece(string name, ClothesPiece? x)
            {
                if (x is null) { w.WriteNull(name); return; }
                w.WriteStartObject(name);
                w.WriteString("kind", x.Kind);
                w.WriteString("colour", x.Colour);
                w.WriteEndObject();
            }
            void Tint(string name, ClothesTint? x)
            {
                if (x is null) { w.WriteNull(name); return; }
                w.WriteStartObject(name);
                w.WriteString("colour", x.Colour);
                w.WriteEndObject();
            }

            w.WriteStartObject();
            w.WriteNumber("v", p.V);
            w.WriteString("first", p.First);
            w.WriteString("last", p.Last);
            w.WriteString("sex", p.Sex);
            w.WriteNumber("age", p.Age);
            w.WriteString("build", p.Build);
            w.WriteString("skin", p.Skin);
            if (p.Hair is null) w.WriteNull("hair");
            else
            {
                w.WriteStartObject("hair");
                w.WriteString("colour", p.Hair.Colour);
                w.WriteString("style", p.Hair.Style);
                w.WriteEndObject();
            }
            w.WriteString("face", p.Face);
            if (p.Clothes is null) w.WriteNull("clothes");
            else
            {
                w.WriteStartObject("clothes");
                Piece("head", p.Clothes.Head);
                Piece("coat", p.Clothes.Coat);
                Tint("shirt", p.Clothes.Shirt);
                Tint("vest", p.Clothes.Vest);
                Tint("lower", p.Clothes.Lower);
                Piece("apron", p.Clothes.Apron);
                Piece("feet", p.Clothes.Feet);
                w.WriteEndObject();
            }
            w.WriteBoolean("best", p.Best);
            w.WriteEndObject();
        }
        return stream.ToArray();
    }

    // ------------------------------------------------------------------ the look in words

    private static string Label(IReadOnlyList<Swatch> list, string id)
    {
        foreach (var x in list)
            if (x.Id == id) return x.Label;
        return id;
    }

    private static string ClothWord(string id) => Label(Cloth, id);

    private static readonly Dictionary<string, string> FaceWords = new()
    {
        ["clean"] = "clean-shaven",
        ["light_stubble"] = "a few days' growth on the chin",
        ["stubble"] = "stubble",
        ["moustache"] = "a moustache",
        ["whiskers"] = "side whiskers",
        ["beard"] = "a short beard",
        ["walrus"] = "a walrus moustache",
    };

    private static readonly Dictionary<string, string> HeadNames = new()
    {
        ["cap"] = "flat cap",
        ["knitcap"] = "knitted cap",
        ["bowler"] = "round hat",
        ["tophat"] = "tall hat",
        ["bonnet"] = "bonnet",
        ["whitecap"] = "white cap",
        ["headscarf"] = "headscarf",
    };

    /// <summary>"a " before a vowel becomes "an " ("a undyed linen apron" reads wrong).</summary>
    private static readonly Regex AToAn = new(@"\ba (?=[aeiou])", RegexOptions.ECMAScript);

    /// <summary>
    /// The look in a line, for the models: "a woman of about 30, slight, ..., in a faded red check shawl,
    /// ... and clogs". Give it a clamped profile.
    /// </summary>
    public static string LookLine(Profile p)
    {
        var w = p.Sex == "woman";
        var c = p.Clothes;
        var who = $"a {(p.Age <= 20 ? "young " : "")}{(w ? "woman" : "man")} of about {p.Age.ToString(CultureInfo.InvariantCulture)}";
        var build = p.Build == "middling" ? "" : $", {p.Build}";
        var hairCol = Label(HairColours, p.Hair.Colour);
        var hair =
            p.Hair.Style == "balding" ? $"thinning {hairCol} hair"
            : p.Hair.Style == "long" ? $"{hairCol} hair to the collar"
            : w ? $"{hairCol} hair {(p.Hair.Style == "bun" ? "in a bun" : p.Hair.Style == "plaits" ? "in plaits" : "in plaits pinned round the head")}"
            : $"short {hairCol} hair";
        var face = !w && FaceWords.TryGetValue(p.Face, out var faceWord) ? $", {faceWord}" : "";
        var skin = Label(Skin, p.Skin);
        var parts = new List<string>();
        if (c.Head.Kind != "none")
            parts.Add(c.Head.Kind == "whitecap" ? "a white cap" : $"a {ClothWord(c.Head.Colour)} {(HeadNames.TryGetValue(c.Head.Kind, out var headName) ? headName : c.Head.Kind)}");
        if (w)
        {
            if (c.Coat.Kind != "no_shawl") parts.Add($"a {ClothWord(c.Coat.Colour)} {(c.Coat.Kind == "check_shawl" ? "check shawl" : "shawl")} over a {ClothWord(c.Shirt.Colour)} blouse");
            else parts.Add($"a {ClothWord(c.Shirt.Colour)} blouse");
            parts.Add($"a {ClothWord(c.Lower.Colour)} skirt");
        }
        else
        {
            if (c.Coat.Kind == "jacket") parts.Add($"a {ClothWord(c.Coat.Colour)} jacket over a {ClothWord(c.Shirt.Colour)} shirt and {ClothWord(c.Vest.Colour)} waistcoat");
            else if (c.Coat.Kind == "coat") parts.Add($"a long {ClothWord(c.Coat.Colour)} coat");
            else if (c.Coat.Kind == "smock") parts.Add($"a {ClothWord(c.Coat.Colour)} smock");
            else parts.Add($"shirt sleeves ({ClothWord(c.Shirt.Colour)}) and a {ClothWord(c.Vest.Colour)} waistcoat");
            parts.Add($"{ClothWord(c.Lower.Colour)} trousers");
        }
        if (c.Apron.Kind == "apron") parts.Add($"a {ClothWord(c.Apron.Colour)} apron");
        parts.Add(c.Feet.Kind == "clogs" ? "clogs" : $"{Label(Leather, c.Feet.Colour)} boots");
        var dressed = parts.Count > 1 ? $"{string.Join(", ", parts.Take(parts.Count - 1))} and {parts[^1]}" : parts[0];
        return AToAn.Replace($"{who}{build}, {skin} skin, {hair}{face}; {(p.Best ? "in Sunday best: " : "in ")}{dressed}", "an ");
    }

    // ------------------------------------------------------------------ random (the creator's "Random")

    /// <summary>Names for the random character: period Flemish and Walloon first names and surnames.</summary>
    public static class Names
    {
        public static readonly NameList Man = new(
            new[] { "Jan", "Pieter", "Frans", "Karel", "Jozef", "Lowie", "Rik", "Kees", "Guust", "Pier", "Jaak", "Pol", "Constant", "Victor", "Emiel", "Alfons", "Fiel", "Remi", "Staf", "Tist", "Door", "Mon", "Sus", "Nand", "Bert" },
            new[] { "Jean", "Joseph", "Pierre", "Henri", "Jules", "Emile", "Arthur", "Léon", "Alphonse", "Camille", "Hubert", "Nicolas", "Lambert", "Gilles", "Désiré", "Auguste" });

        public static readonly NameList Woman = new(
            new[] { "Mie", "Anna", "Lies", "Trien", "Rosalie", "Leonie", "Sidonie", "Coleta", "Babette", "Clementine", "Tilde", "Virginie", "Fanny", "Mena", "Paulina", "Hortense", "Melanie", "Mieke", "Stien", "Net" },
            new[] { "Marie", "Jeanne", "Catherine", "Joséphine", "Louise", "Adèle", "Julie", "Elise", "Hélène", "Céline", "Pauline", "Victorine", "Marguerite", "Clémence" });

        public static readonly NameList Surname = new(
            new[] { "Janssens", "Maes", "Jacobs", "Mertens", "Willems", "Claes", "Goossens", "Wouters", "De Smedt", "Van den Bergh", "Verhoeven", "Hermans", "Aerts", "Vermeulen", "De Backer", "Laenen", "Nys", "Luyten", "Verbruggen", "Geerts", "Smets", "Michiels", "Bosmans", "Van Gorp", "Cuypers" },
            new[] { "Dubois", "Lambert", "Dupont", "Martin", "Leclercq", "Renard", "Lejeune", "Simon", "Laurent", "Delvaux", "Collard", "Gilson", "Dumont", "Lemaire", "Hardy", "Piret", "Masson", "Charlier" });
    }

    /// <summary>
    /// A period-true character at random: a Flemish or Walloon name, a look people of that station wore.
    /// <paramref name="rnd"/> gives numbers from 0 up to (not including) 1; it is asked in the same order
    /// as in the TypeScript, so the same numbers give the same character. <paramref name="sex"/> is "man",
    /// "woman" or null for either.
    /// </summary>
    public static Profile RandomProfile(Func<double>? rnd = null, string? sex = null)
    {
        rnd ??= Random.Shared.NextDouble;
        if (sex is not null && sex != "man" && sex != "woman") throw new ArgumentException("sex must be \"man\", \"woman\" or null", nameof(sex));
        T Pick<T>(IReadOnlyList<T> a) => a[(int)Math.Floor(rnd() * a.Count) % a.Count];

        sex ??= rnd() < 0.5 ? "man" : "woman";
        var man = sex == "man";
        var walloon = rnd() < 0.3;
        var nameList = man ? Names.Man : Names.Woman;
        var names = walloon ? nameList.Walloon : nameList.Flemish;
        var surnames = walloon ? Names.Surname.Walloon : Names.Surname.Flemish;
        // the young bands are in the hat more than once: most newcomers are young
        var band = Pick(new[] { AgeBands[0], AgeBands[1], AgeBands[2], AgeBands[3], AgeBands[0], AgeBands[1], AgeBands[1] });
        var age = band.Min + (int)Math.Floor(rnd() * (band.Max - band.Min + 1));
        List<string> Ids(IReadOnlyList<Choice> list) => OptionsFor(list, sex).Select(c => c.Id).ToList();
        var work = new[] { "indigo", "faded_indigo", "blue_grey", "brown", "dark_brown", "grey", "charcoal", "black", "faded_red", "green", "ochre" };
        IReadOnlyList<string> hairs = age > 50 ? new[] { "grey", "white", "grey", "dark_brown" }
            : age > 40 ? new[] { "grey", "dark_brown", "light_brown", "black", "fair" }
            : HairColours.Where(h => h.Id != "white" && h.Id != "grey").Select(h => h.Id).ToList();
        var feet = rnd() < 0.45 ? "clogs" : "boots";

        // one statement per field, in the TypeScript's order: every line that asks for a number asks in turn
        var raw = new Profile { V = 1, Sex = sex, Age = age, Best = false };
        raw.First = Pick(names);
        raw.Last = Pick(surnames);
        raw.Build = Pick(new[] { "slight", "middling", "middling", "stout" });
        raw.Skin = Pick(new[] { "pale", "fair", "fair", "rosy", "weathered", "weathered", "olive" });
        raw.Hair.Colour = Pick(hairs);
        raw.Hair.Style = man
            ? (age > 38 && rnd() < 0.4 ? "balding" : Pick(new[] { "short", "short", "long" }))
            : Pick(new[] { "bun", "bun", "plaits", "coronet" });
        IReadOnlyList<string> faces = age < 21 ? new[] { "clean", "light_stubble", "light_stubble", "clean" } : Ids(Faces);
        raw.Face = man ? Pick(faces) : "none";
        var cl = raw.Clothes;
        cl.Head.Kind = Pick(Ids(Heads).Where(h => h != "tophat").ToList());
        cl.Head.Colour = Pick(new[] { "charcoal", "black", "brown", "dark_brown", "grey", "indigo", "faded_red", "green", "blue_grey" });
        cl.Coat.Kind = Pick(Ids(Coats));
        cl.Coat.Colour = Pick(work);
        cl.Shirt.Colour = Pick(man ? new[] { "linen", "linen", "white", "faded_indigo", "grey" } : new[] { "blue_grey", "indigo", "brown", "black", "faded_red", "green", "grey", "dark_brown" });
        cl.Vest.Colour = Pick(new[] { "charcoal", "black", "dark_brown", "brown", "grey", "green" });
        cl.Lower.Colour = Pick(man ? new[] { "grey", "charcoal", "brown", "dark_brown", "indigo", "blue_grey" } : new[] { "brown", "dark_brown", "black", "indigo", "grey", "green", "faded_red" });
        cl.Apron.Kind = rnd() < (man ? 0.25 : 0.7) ? "apron" : "none";
        cl.Apron.Colour = Pick(new[] { "linen", "white", "faded_indigo", "indigo", "grey", "brown" });
        cl.Feet.Kind = feet;
        cl.Feet.Colour = Pick(feet == "clogs" ? Wood : Leather).Id;

        if (!man && raw.Clothes.Head.Kind == "whitecap") raw.Clothes.Head.Colour = "white";
        return ClampProfile(raw).Profile;
    }

    /// <summary>Sunday best: black and white linen, boots, a hat for a man and a bonnet for a woman (the creator's button). A new profile; the one given is not changed.</summary>
    public static Profile SundayBest(Profile p)
    {
        var w = p.Sex == "woman";
        var best = p.Clone();
        best.Best = true;
        best.Clothes = new ProfileClothes
        {
            Head = new ClothesPiece(w ? "bonnet" : p.Age > 35 ? "tophat" : "bowler", "black"),
            Coat = new ClothesPiece(w ? "shawl" : "coat", "black"),
            Shirt = new ClothesTint(w ? "black" : "white"),
            Vest = new ClothesTint("black"),
            Lower = new ClothesTint(w ? "black" : "charcoal"),
            Apron = new ClothesPiece("none", "white"),
            Feet = new ClothesPiece("boots", "black_leather"),
        };
        return ClampProfile(best).Profile;
    }
}
