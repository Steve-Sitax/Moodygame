using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

/// <summary>Authoritative pocket ownership, item effects, prices and transaction checks from trade.ts.</summary>
public sealed class NativeCoreTrade : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private readonly JsonObject wareRules;
    private NativeServiceContext C => host.Context;
    public Func<string, bool>? WorkResolver;
    public Func<string,JsonArray,JsonArray>? WaresModifier;
    public Func<int,string,JsonArray,JsonArray>? WaresForPlayer;
    public Func<int, string, string?>? RefusePurchase;
    public Func<int, string, string, int, int>? AgreedPrice;
    public readonly Dictionary<string, Action<int, string>> SpecialBuy = new();
    public readonly Dictionary<string, Func<int, int?>> ItemReferences = new();
    public readonly List<Action<int, string, string>> BoughtHooks = new();
    public readonly List<Func<int,string,string,string?>> BoughtLineHooks = new();
    public readonly List<Func<string,string,int,int>> SellerPrices = new();
    private static readonly Dictionary<string, string> HandOver = new() {
        ["fientje"] = "Fientje wraps it in yesterday's Handelsblad and takes your coins without counting.",
        ["peeters"] = "The widow counts your centimes twice and writes it in her book.",
        ["tuur"] = "Tuur pours from a flat bottle and looks up and down the kaai while you drink."
    };
    private static readonly Dictionary<string, string> BasicUse = new() {
        ["herring"] = "Salt and oil. It sits in your belly like a stone, a good stone.", ["eel"] = "Smoked eel, rich and warm. You feel it down to your boots.",
        ["biscuit"] = "Hard as a plank. You soften it in your mouth and it fills you, a little.", ["jenever"] = "It burns going down, then warms you from the inside.",
        ["bread"] = "Dark rye, still a little warm. It fills you properly.", ["apple"] = "Sour and crisp. Not much, but something.",
        ["beer"] = "Thin brown beer. It warms you a little and fills a corner of your belly."
    };
    public NativeCoreTrade(NativeServiceHost host) {this.host=host;wareRules=JsonNode.Parse(File.ReadAllText(Path.Combine(C.Options.DataDirectory,"native-trade.json")))!.AsObject();}
    public JsonObject? Item(string kind) => C.Rules["items"]?[kind] as JsonObject;
    public JsonArray Pockets(int playerId)
    {
        var rows = C.Rows("SELECT id,kind,job_id,ref FROM item WHERE player_id=$p0 ORDER BY id", playerId);
        foreach (var node in rows) { var row = node!.AsObject(); var kind = row["kind"]!.GetValue<string>(); var def = Item(kind);
            row["name"] = def?["name"]?.DeepClone() ?? JsonValue.Create(kind); row["use"] = def?["use"]?.DeepClone(); row["note"] = def?["note"]?.DeepClone(); }
        return rows;
    }
    public JsonArray Wares(string npc)
    {
        var wares=BaseWares(npc);var market=MarketFactors();
        foreach(var node in wares){var ware=node!.AsObject();string kind=ware["kind"]!.GetValue<string>();double factor=market(kind);if(factor!=1)ware["price_c"]=Math.Max(1,(int)Math.Floor(NativeCoreClock.Number(ware,"price_c")*factor+.5));int price=NativeCoreClock.Number(ware,"price_c");foreach(var sellerPrice in SellerPrices)price=sellerPrice(npc,kind,price);ware["price_c"]=Math.Max(1,price);ware["name"]=Item(kind)?["name"]?.DeepClone()??JsonValue.Create(kind);}
        return WaresModifier?.Invoke(npc,wares) ?? wares;
    }
    public JsonArray BaseWares(string npc)
    {
        if(C.Rules["wares"]?[npc] is JsonArray fixedWares)return fixedWares.DeepClone().AsArray();var record=C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0",npc);if(record==null)return new JsonArray();var r=JsonNode.Parse(record)!;var work=r["work"]!;JsonNode? found;
        if(work["stall"]!=null){int slot=(int)Value(work["stall"]);var stalls=C.World("town")?["stalls"] as JsonArray;string goods=slot>=0&&slot<stalls?.Count?stalls[slot]?["goods"]?.GetValue<string>()??"":"";found=wareRules["stallWares"]?[goods];}
        else if(work["shop"] is JsonValue shopValue&&shopValue.TryGetValue<string>(out var shop)&&shop.Length>0){string own=wareRules["shopTrades"]?[shop]?.GetValue<string>()??"";found=wareRules["tradeWares"]?[own];if(found==null){var keeper=(C.World("town")?["shops"] as JsonArray??new()).FirstOrDefault(s=>s?["id"]?.GetValue<string>()==shop)?["keeper"]?.GetValue<string>();string? head=keeper==null?null:C.Scalar<string>("SELECT data_json FROM resident WHERE id=$p0",keeper);string trade=(head==null?r:JsonNode.Parse(head))?["trade"]?.GetValue<string>()??r["trade"]!.GetValue<string>();found=wareRules["tradeWares"]?[trade];}}
        else found=wareRules["tradeWares"]?[r["trade"]!.GetValue<string>()];return found?.DeepClone().AsArray()??new JsonArray();
    }
    public JsonArray PersonalWares(int player,string npc){var listed=Wares(npc);return WaresForPlayer?.Invoke(player,npc,listed)??listed;}
    private static double Value(JsonNode? n){if(n is not JsonValue v)return 0;if(v.TryGetValue<double>(out var d))return d;if(v.TryGetValue<int>(out var i))return i;if(v.TryGetValue<long>(out var l))return l;return 0;}
    public Func<string,double> NewsFactors()
    {
        int day=NativeCoreClock.Number(host.Clock.View(),"day");var prices=C.Rows("SELECT prices_json FROM news_abroad WHERE day<=$p0 AND until_day>=$p0",day).Select(r=>JsonNode.Parse(r!["prices_json"]!.GetValue<string>())!).ToArray();return item=>{double factor=1;foreach(var table in prices){double f=Value(table[item]?["factor"]);if(double.IsFinite(f)&&f>0)factor*=f;}return Math.Clamp(factor,.5,3);};
    }
    public double NewsFactor(string item)=>NewsFactors()(item);
    public Func<string,double> MarketFactors(){var events=C.World("m4_prices");var news=NewsFactors();return item=>{double f=Value(events?[item]?["factor"]);return Math.Clamp((f>0?f:1)*news(item),.5,3);};}
    public bool AtWork(string npc)
    {
        if (WorkResolver != null) return WorkResolver(npc);
        if (C.Rules["wares"]?[npc] != null) return true; // Fixed sellers: source trade.atWork leaves their posted-hour visibility to the world.
        var resident = C.One("SELECT data_json FROM resident WHERE id=$p0", npc);
        if (resident == null) return false;
        var data = JsonNode.Parse(resident["data_json"]!.GetValue<string>())!;
        var clock = host.Clock.View(); int day = NativeCoreClock.Number(clock, "day");
        double hour = NativeCoreClock.Number(clock, "hour") + NativeCoreClock.Number(clock, "minute") / 60.0;
        var schedule = data["sched"]?[day % 7 == 0 ? "sunday" : "day"] as JsonArray;
        if (schedule == null) return false;
        foreach (var node in schedule) { var seg = node!.AsArray(); double a = seg[0]!.GetValue<double>(), b = seg[1]!.GetValue<double>();
            if ((hour >= a && hour < b || hour + 24 >= a && hour + 24 < b)) return seg[2]!.GetValue<string>() == "work"; }
        return false;
    }
    public JsonObject Buy(int playerId, string npc, string kind)
    {
        var listed = Wares(npc).FirstOrDefault(w => w?["kind"]?.GetValue<string>() == kind)?.AsObject();
        if (listed == null) throw new NativeServiceException("they do not sell that", 404);
        if (!AtWork(npc)) throw new NativeServiceException("the shop is shut; come back in working hours", 409);
        string? refusal = RefusePurchase?.Invoke(playerId, npc); if (refusal != null) throw new NativeServiceException(refusal, 409);
        int listPrice = NativeCoreClock.Number(listed, "price_c");
        int price = Math.Min(listPrice, Math.Max(Math.Max(1, (int)Math.Ceiling(listPrice * .6 - 1e-9)), AgreedPrice?.Invoke(playerId, npc, kind, listPrice) ?? listPrice));
        if (NativeCoreClock.Number(host.Player(playerId), "money_c") < price) throw new NativeServiceException($"not enough money: {price} c needed", 409);
        var def = Item(kind) ?? throw new NativeServiceException("no such item", 404);
        string use = def["use"]?.GetValue<string>() ?? "";
        bool drinkNow = use == "drink" || def["atCounter"]?.GetValue<bool>() == true;
        bool inArms = def["carry"]?.GetValue<string>() == "arms";
        bool needsSpecial = inArms && !ItemReferences.ContainsKey(kind) || kind.StartsWith("velocipede_") || kind.StartsWith("handcart_") || kind == "newspaper" && !ItemReferences.ContainsKey(kind);
        if (needsSpecial && !SpecialBuy.ContainsKey(kind)) throw new NativeServiceException("Native item ownership module is not implemented: " + kind, 501);
        if (!drinkNow && !inArms && !SpecialBuy.ContainsKey(kind) && C.Scalar<long>("SELECT COUNT(*) FROM item WHERE player_id=$p0", playerId) >= 6) throw new NativeServiceException("your pockets are full", 409);
        int? reference = ItemReferences.TryGetValue(kind, out var refFunc) ? refFunc(playerId) : null;
        string? lastLine=null;C.Atomic(() => {
            C.Execute("UPDATE player SET money_c=money_c-$p0 WHERE id=$p1", price, playerId);
            if (SpecialBuy.TryGetValue(kind, out var buy)) buy(playerId, npc);
            else if (drinkNow) ApplyNeeds(playerId, def);
            else if (!inArms) C.Execute("INSERT INTO item(kind,job_id,ref,player_id) VALUES($p0,NULL,$p1,$p2)", kind, reference, playerId);
            C.Log(playerId, "bought", kind, $"Jef bought {def["name"]!.GetValue<string>()} for {price} centimes.");
            if (drinkNow && use == "eat") C.Log(playerId, "ate", kind, $"Jef ate {def["name"]!.GetValue<string>()} at the counter.");
            Remember(playerId, npc, $"Jef bought {def["name"]!.GetValue<string>()} from me for {price} centimes.", drinkNow ? 3 : 2);
            foreach (var hook in BoughtHooks) hook(playerId, npc, kind);
            foreach (var hook in BoughtLineHooks) lastLine=hook(playerId,npc,kind)??lastLine;
        });
        string line = !string.IsNullOrEmpty(lastLine)?lastLine:HandOver.GetValueOrDefault(npc) ?? C.Rules["serviceLine"]?[kind]?.GetValue<string>() ?? SellerLine(npc);
        return new JsonObject { ["line"] = line, ["bought"] = kind, ["price_c"] = price };
    }
    private string SellerLine(string npc)
    {
        var row = C.One("SELECT data_json FROM resident WHERE id=$p0", npc);
        if (row == null) return "Coins change hands.";
        var data = JsonNode.Parse(row["data_json"]!.GetValue<string>())!;
        string first = data["first"]!.GetValue<string>();
        int warmth = (int)(data["stats"]?["warmth"]?.GetValue<double>() ?? 0), greed = (int)(data["stats"]?["greed"]?.GetValue<double>() ?? 0);
        return first + " takes your coins and hands it over" + (warmth >= 7 ? " with a nod" : greed >= 7 ? ", counting twice" : "") + ".";
    }
    public void Remember(int playerId, string npc, string text, int weight, string? gist = null, int tone = 0)
    {
        text = text.Trim(); if (text.Length > 200) text = text[..200];
        if (gist?.Length > 160) gist = gist[..160];
        C.Execute("INSERT INTO npc_memory(npc_id,text,source,heard_from,weight,day,spread,about_player,gist,tone) VALUES($p0,$p1,'seen',NULL,$p2,$p3,0,$p4,$p5,$p6)", npc, text, Math.Clamp(weight,1,10), NativeCoreClock.Number(host.Clock.View(), "day"), playerId, gist, Math.Clamp(tone,-2,2));
        host.MemoryHook?.Invoke(playerId,npc,weight);
    }
    private void ApplyNeeds(int id, JsonObject def) => C.Execute("UPDATE player SET food=MAX(0,MIN(10,food+$p0)),warmth=MAX(0,MIN(10,warmth+$p1)),health=MAX(0,MIN(10,health+$p2)) WHERE id=$p3", NativeCoreClock.Number(def, "food"), NativeCoreClock.Number(def, "warmth"), NativeCoreClock.Number(def, "health"), id);
    public JsonObject Use(int playerId, int itemId)
    {
        var row = C.One("SELECT id,kind FROM item WHERE id=$p0 AND player_id=$p1", itemId, playerId) ?? throw new NativeServiceException("not in your pockets", 404);
        string kind = row["kind"]!.GetValue<string>(); var def = Item(kind);
        string? use = def?["use"]?.GetValue<string>();
        if (use == null) throw new NativeServiceException("that is not yours to use", 409);
        if (use == "read") throw new NativeServiceException("open your pockets to read it", 409);
        C.Atomic(() => {
            C.Execute("DELETE FROM item WHERE id=$p0 AND player_id=$p1", itemId, playerId); ApplyNeeds(playerId, def!);
            string verb = use == "eat" ? "ate" : use == "wear" ? "put on" : use == "smoke" ? "smoked" : "drank";
            C.Log(playerId, use == "wear" ? "wore" : verb, kind, $"Jef {verb} {def!["name"]!.GetValue<string>()}.");
        });
        return new JsonObject { ["text"] = BasicUse.GetValueOrDefault(kind) ?? C.Rules["useText"]?[kind]?.GetValue<string>() ?? "Done." };
    }
    public void Parcel(int id, int job)
    {
        if (C.Scalar<long>("SELECT COUNT(*) FROM item WHERE job_id=$p0 AND player_id=$p1", job, id) != 0) return;
        if (C.Scalar<long>("SELECT COUNT(*) FROM item WHERE player_id=$p0", id) >= 6) throw new NativeServiceException("your pockets are full; eat something or leave it", 409);
        C.Execute("INSERT INTO item(kind,job_id,player_id) VALUES('parcel',$p0,$p1)", job, id);
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET", "/api/npc/:id/wares", r => new JsonObject { ["wares"] = PersonalWares(r.PlayerId,r.Param("id")) });
        service.Register("GET", "/api/npcs", r => new JsonArray(new[] { "sooi", "peeters", "fientje", "tuur" }.Select(npc => {
            var n = C.One("SELECT id,name,role FROM npc WHERE id=$p0", npc)!; n["wares"] = PersonalWares(r.PlayerId,npc); return (JsonNode)n;
        }).ToArray()));
        service.Register("POST", "/api/buy", r => { var reply = Buy(r.PlayerId, r.Text("npc"), r.Text("kind")); reply["wares"] = PersonalWares(r.PlayerId,r.Text("npc")); host.PublishState(r.PlayerId); return NativeCoreClock.Join(reply, host.Payload(r.PlayerId)); });
        service.Register("POST", "/api/use", r => { var reply = Use(r.PlayerId, r.Int("id")); host.PublishState(r.PlayerId); return NativeCoreClock.Join(reply, host.Payload(r.PlayerId)); });
    }
}
