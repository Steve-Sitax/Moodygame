using System;
using System.Globalization;
using System.Collections.Generic;
using System.Runtime.CompilerServices;
using System.Text;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services;

/// <summary>Original five-second, 300-character dialogue gate shared by private typed narration.</summary>
public static class NativeTownDialogueGate
{
    private static readonly ConditionalWeakTable<NativeServiceHost, Dictionary<int, long>> Times = new();
    public static void Clear(NativeServiceHost host) => Times.GetOrCreateValue(host).Clear();
    /// <summary>Call under host.WithState or a synchronous native route; each player's wait spans talk and confession.</summary>
    public static (string text, string? reason) Check(NativeServiceHost host, int player, string raw)
    {
        var times = Times.GetOrCreateValue(host); var result = Check(raw, host.Context.Now, times.GetValueOrDefault(player));
        if (result.reason is null or "blocked") times[player] = host.Context.Now; return result;
    }
    private static readonly Regex[] Blocks = {
        new("ignore (all |any |the )?(previous|prior|above|earlier)",RegexOptions.IgnoreCase),new("system ?prompt",RegexOptions.IgnoreCase),new("you are now",RegexOptions.IgnoreCase),
        new(@"\b(jailbreak|developer mode|DAN mode)\b",RegexOptions.IgnoreCase),new(@"\bpretend (to be|you are)\b|\byour (instructions|rules|prompt)\b",RegexOptions.IgnoreCase),new("```|</?(system|assistant|user|tool)>",RegexOptions.IgnoreCase),
        new(@"\b(assistant|system|user)\s*:",RegexOptions.IgnoreCase),new(@"[a-z]:\\|/(etc|usr|home|bin|root)/",RegexOptions.IgnoreCase),new(@"\b(api[ _-]?key|password|rm -rf|sudo|powershell|cmd\.exe)\b",RegexOptions.IgnoreCase),
        new(@"\b(claude|anthropic|openai|chatgpt|gpt-?\d|llm|language model|ai model)\b",RegexOptions.IgnoreCase),new("<<<|>>>|\"\"\""),
        new(@"\b(SCENE|JEF SAYS|PERSON|THIS MEETING SO FAR|YOUR MEMORIES|YOU AND JEF|WHAT YOU KNOW OF JEF|ON THE KAAI LATELY|WORK YOU KNOW OF|THE MATTER|DECISION|IF FINED|IF ARRESTED|THE FACTS|SELLER)\b"),new(@"\bjef says\s*[:(]",RegexOptions.IgnoreCase),new(@"\b[A-Z]{3,}(?: [A-Z]{2,})*\s*:") };
    public static (string text, string? reason) Check(string raw, long now, long last)
    {
        var safe = new StringBuilder();
        // Remove malformed surrogate units before FormKC; valid supplementary Unicode remains one character.
        for (int i = 0; i < raw.Length; i++) { if (char.IsHighSurrogate(raw[i]) && i + 1 < raw.Length && char.IsLowSurrogate(raw[i + 1])) { safe.Append(raw[i]).Append(raw[++i]); } else if (!char.IsSurrogate(raw[i])) safe.Append(raw[i]); }
        string normalized = safe.ToString().Normalize(NormalizationForm.FormKC); var clean = new StringBuilder();
        for (int i = 0; i < normalized.Length; i++) {
            var category = CharUnicodeInfo.GetUnicodeCategory(normalized, i); char character = normalized[i];
            if (category is UnicodeCategory.Format or UnicodeCategory.PrivateUse or UnicodeCategory.Surrogate) continue;
            if (category is UnicodeCategory.Control or UnicodeCategory.LineSeparator or UnicodeCategory.ParagraphSeparator) clean.Append(' '); else clean.Append(character);
            if (char.IsHighSurrogate(character) && i + 1 < normalized.Length && char.IsLowSurrogate(normalized[i + 1])) clean.Append(normalized[++i]);
        }
        string text = Regex.Replace(clean.ToString(), @"\s+", " ").Trim();
        if (text.Length == 0) return (text, "empty"); if (text.Length > 300) return (text, "too long"); if (now - last < 5000) return (text, "too fast");
        foreach (var pattern in Blocks) if (pattern.IsMatch(text)) return (text, "blocked"); return (text, null);
    }
}
