using System;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Town;

namespace Scheldemist.People;

/// <summary>
/// The Vismarkt's pitches (#150): each market-day stall belongs to a seller who lives in the town (the engine's
/// vm_seller_N, work.pitch N). She pushes her handcart from home, and her stall stands only while she is at it:
/// before the market opens she builds it (frame, then awning or cloth, then goods), she sells from opening to
/// closing, then she packs it away in the same stages and goes home with her cart. The hours are the vismarkt
/// field's pitches in native-extras.json (the engine reads the same: it refuses sales outside them).
/// </summary>
public partial class NativeMarket
{
    public const string SellerPrefix = "vm_seller_";
    internal static string SellerId(int pitch) => SellerPrefix + pitch;
    private static double Hour(Field f, string key) => N(f.Definition["pitches"]?[key]);
    private static int Weekday(int day) => ((day - 1) % 7 + 7) % 7 + 1;
    private bool Selling(Field f) => Weekday(town.Day) != 7 && town.Hour >= Hour(f, "open") && town.Hour < Hour(f, "close");

    /// <summary>The seller at her own pitch, at work (not passing it on her way home); a few steps round it (a
    /// stall-keeper's little round) keep her there.</summary>
    private Townspeople.Sim? There(NativeMarketItem it)
    {
        var s = town.ActionPerson(SellerId(it.Pitch));
        return s != null && !s.Inside && s.Key.StartsWith("work", StringComparison.Ordinal) && Distance(s.X, s.Z, it.Seller.X, it.Seller.Z) < 6 ? s : null;
    }

    /// <summary>Every pitch's stall up, sellers or not (a proof measuring the stalls' room).</summary>
    internal bool ShowAll;

    /// <summary>How far each pitch's stall stands now: -1 down (its seller is not there), 0 frame, 1 cover, 2 goods.</summary>
    private void PitchLevels(Field f)
    {
        if (ShowAll) { Array.Fill(f.Level, 2); return; }
        double setup = Hour(f, "setup"), open = Hour(f, "open"), close = Hour(f, "close"), packed = Hour(f, "packed"), hour = town.Hour;
        foreach (var it in f.Items)
        {
            int level = -1;
            if (There(it) != null)
            {
                if (hour < open) { double p = (hour - setup) / Math.Max(.01, open - setup); level = p < 1 / 3.0 ? 0 : p < 2 / 3.0 ? 1 : 2; }
                else if (hour >= close) { double p = (hour - close) / Math.Max(.01, packed - close); level = p < 1 / 3.0 ? 2 : p < 2 / 3.0 ? 1 : 0; }
                else level = 2;
            }
            f.Level[it.Rank] = level;
        }
    }

    /// <summary>Each seller stands at her own place behind her stall; behind a fish table she guts the catch while
    /// she sells (#129: the board's near edge 0.30 m before her, for her size).</summary>
    private void TendSellers(Field f)
    {
        var crowd = town.Crowd!;
        bool selling = Selling(f);
        foreach (var it in f.Items)
        {
            if (f.Level[it.Rank] < 0 || There(it) is not { P: { } p } s || s.ActionHeld || p.State == "walk" || p.Conversing) continue;
            if (Distance(p.X, p.Z, it.Seller.X, it.Seller.Z) > 1.6) continue;
            bool gut = it.Kind == "fishtable" && selling && f.Level[it.Rank] == 2 && p.Human.IsPeople2;
            double move = gut ? FishTableNear() - GutNear * p.Human.WorkRatio("gut") - it.SellerAt.Z : 0;
            double x = it.Seller.X + Math.Sin(it.Yaw) * move, z = it.Seller.Z + Math.Cos(it.Yaw) * move;
            if (gut) p.Human.Work = "fish_stall";
            else if (p.Human.Work == "fish_stall") p.Human.Work = null;
            if (Distance(p.X, p.Z, x, z) > .03) { p.X = x; p.Z = z; crowd.PuppetStand(p, "idle", it.Yaw); }
        }
    }

    /// <summary>A seller building or striking her stall works at it (crouched to her crates and back up), not calling her wares.</summary>
    private string? SellerMotion(Townspeople.Sim s)
    {
        if (!s.R.Id.StartsWith(SellerPrefix, StringComparison.Ordinal) || s.R.Work.Pitch is not { } pitch) return null;
        var f = fields.FirstOrDefault(f => f.Pitched);
        if (f == null || pitch >= f.Level.Length || f.Level[pitch] < 0 || Selling(f)) return null;
        return random.NextDouble() < .6 ? "crouch" : "idle";
    }

    private static string Clock(double hour) => $"{(int)hour}:{(int)Math.Round((hour - (int)hour) * 60):00}";

    /// <summary>Why this market seller sells nothing now ("not open yet ..."), or null: she sells, or she is not one.</summary>
    public string? NotOpen(string id)
    {
        if (!id.StartsWith(SellerPrefix, StringComparison.Ordinal)) return null;
        var f = fields.FirstOrDefault(f => f.Pitched);
        if (f == null) return null;
        if (Weekday(town.Day) == 7) return "no market on Sunday";
        if (town.Hour < Hour(f, "open")) return "not open yet: the stall opens at " + Clock(Hour(f, "open"));
        if (town.Hour >= Hour(f, "close")) return "packing up: the stall is shut until tomorrow";
        return null;
    }

    /// <summary>Each pitch: its seller, where she is, how far the stall stands (the proofs).</summary>
    public JsonArray PitchState() => new(fields.Where(f => f.Pitched).SelectMany(f => f.Items.Select(it =>
    {
        var s = town.ActionPerson(SellerId(it.Pitch));
        return (JsonNode)new JsonObject
        {
            ["pitch"] = it.Pitch, ["kind"] = it.Kind, ["goods"] = it.Goods, ["level"] = f.Level[it.Rank], ["seller"] = SellerId(it.Pitch), ["known"] = s != null,
            ["x"] = s == null ? null : Math.Round(s.X, 2), ["z"] = s == null ? null : Math.Round(s.Z, 2), ["inside"] = s?.Inside, ["key"] = s?.Key,
            ["drawn"] = s?.P != null, ["state"] = s?.P?.State, ["work"] = s?.P?.Human.Work, ["off"] = s == null ? null : Math.Round(Distance(s.P?.X ?? s.X, s.P?.Z ?? s.Z, it.Seller.X, it.Seller.Z), 2),
        };
    })).ToArray());
}
