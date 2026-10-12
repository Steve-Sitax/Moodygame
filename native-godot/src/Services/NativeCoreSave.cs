using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using Microsoft.Data.Sqlite;

namespace Scheldemist.Native.Services;

/// <summary>Whole SQLite world snapshots plus validated client poses; all writes are serialized by the host.</summary>
public sealed partial class NativeCoreSave : INativeServiceModule
{
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private readonly HashSet<string> holders = new();
    private string mode = "open";
    public bool Paused => host.MultiplayerEnabled() ? holders.Contains("host:all") : holders.Count != 0;
    public bool Busy => mode != "open";
    public bool PausedAll => holders.Contains("host:all");
    public NativeCoreSave(NativeServiceHost host) => this.host = host;
    public void EnsurePlayer(int id, string name)
    {
        if (id < 1) throw new NativeServiceException("no such player", 404);
        if (C.Scalar<int>("SELECT COUNT(*) FROM player WHERE id=$p0", id) != 0) return;
        var clock = host.Clock.View();
        C.Atomic(() => {
            C.Execute("INSERT INTO player(id,name,money_c,food,warmth,health,sleep,day,hour,minute,district,rent_paid_until) VALUES($p0,$p1,50,7,7,8,7,$p2,$p3,$p4,'rijnkaai',0)", id, name, NativeCoreClock.Number(clock,"day"), NativeCoreClock.Number(clock,"hour"), NativeCoreClock.Number(clock,"minute"));
            C.Execute("INSERT OR IGNORE INTO faction_trust(player_id,faction,trust) SELECT $p0,faction,0 FROM faction_trust WHERE player_id=1", id);
            C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) SELECT npc_id,$p0 FROM npc_relationship WHERE player_id=1", id);
            C.SetPlayerState(id,"arrival",new JsonObject{["stage"]="ferry",["creator"]=true,["log"]=true});
        });
    }
    public void SetPausedAll(bool on)
    {
        if (on) holders.Add("host:all"); else holders.Remove("host:all");
        host.Publish("gate",Gate());
    }
    public void MultiplayerModeChanged(bool enabled)
    {
        if(enabled)holders.RemoveWhere(h=>h!="host:all");else holders.Remove("host:all");
        host.Publish("gate",Gate());
    }
    private static bool Slot(string value) => Regex.IsMatch(value, "^(slot[1-5]|auto[12])$");
    public JsonObject Gate() => new() { ["paused"] = Paused, ["mode"] = mode, ["in_flight"] = 0, ["holders"] = new JsonArray(holders.Select(h => (JsonNode)JsonValue.Create(h)!).ToArray()) };
    private void ChangeMode(string next) { mode = next; host.Publish("gate", Gate()); }
    private string PathFor(string slot) => Path.Combine(C.Options.SaveDirectory, slot + ".sqlite");
    private static SqliteConnection Open(string path, bool readOnly = false)
    {
        var connection = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = path, Mode = readOnly ? SqliteOpenMode.ReadOnly : SqliteOpenMode.ReadWriteCreate, Pooling = false }.ToString());
        connection.Open(); return connection;
    }
    private JsonObject? Meta(string path)
    {
        if (!File.Exists(path)) return null;
        try { using var connection = Open(path, true); using var command = connection.CreateCommand(); command.CommandText = "SELECT key,value_json FROM save_meta";
            using var reader = command.ExecuteReader(); var result = new JsonObject();
            while (reader.Read()) result[reader.GetString(0)] = JsonNode.Parse(reader.GetString(1));
            return result["slot"] is JsonValue v && v.TryGetValue<string>(out var slot) && Slot(slot) ? result : null;
        } catch (SqliteException) { return null; } catch (System.Text.Json.JsonException) { return null; }
    }
    public JsonArray List()
    {
        Directory.CreateDirectory(C.Options.SaveDirectory);
        var saves = Enumerable.Range(1, 5).Select(i => "slot" + i).Concat(new[] { "auto1", "auto2" })
            .Select(s => Meta(PathFor(s))).Where(s => s != null).OrderByDescending(s => s!["saved_at"]!.GetValue<string>()).ToArray();
        return new JsonArray(saves.Select(s => (JsonNode)s!).ToArray());
    }
    private string AutoSlot()
    {
        var list = List().Where(n => n?["kind"]?.GetValue<string>() == "auto").ToArray(); var clock = host.Clock.View();
        if (list.Length != 0 && new[] { "day", "hour", "minute" }.All(k => NativeCoreClock.Number(list[0]!.AsObject(), k) == NativeCoreClock.Number(clock, k))) return list[0]!["slot"]!.GetValue<string>();
        foreach (string slot in new[] { "auto1", "auto2" }) if (!list.Any(n => n?["slot"]?.GetValue<string>() == slot)) return slot;
        return list.Last()!["slot"]!.GetValue<string>();
    }
    public JsonObject? Client(int playerId)
    {
        string? json = C.Scalar<string>("SELECT state_json FROM client_state WHERE player_id=$p0", playerId);
        try { return json == null ? null : ValidateClient(JsonNode.Parse(json)); } catch (System.Text.Json.JsonException) { return null; }
    }
    public JsonObject? ValidateClient(JsonNode? node)
    {
        if (node is not JsonObject original || original["v"] is not JsonValue version || !version.TryGetValue<int>(out int v) || v != 1 || original["pose"] is not JsonObject pose) return null;
        var client = original.DeepClone().AsObject(); var copy = client["pose"]!.AsObject();
        foreach (var (key, min, max) in new[] { ("x", -2000.0, 2000.0), ("z", -2000.0, 2000.0), ("y", -30.0, 80.0), ("yaw", -1e4, 1e4), ("pitch", -1.6, 1.6) }) {
            if (pose[key] is not JsonValue value || !value.TryGetValue<double>(out var n) || !double.IsFinite(n)) return null; copy[key] = Math.Clamp(n, min, max);
        }
        if (original["clock"] != null) {
            if (original["clock"] is not JsonObject clock) return null;
            foreach(var (key,min,max) in new[]{("day",1,7),("hour",0,23),("minute",0,59)}) if(clock[key] is not JsonValue value || !value.TryGetValue<int>(out int n) || n<min || n>max) return null;
        }
        if (original["place"] != null && (original["place"] is not JsonValue place || !place.TryGetValue<string>(out var text) || text.Length > 80)) return null;
        return client.ToJsonString().Length > 64 * 1024 ? null : client;
    }
    private JsonObject? WriteClient(int playerId, JsonNode? data)
    {
        var client = ValidateClient(data); if (client == null) return null;
        C.Execute("INSERT INTO client_state(player_id,state_json,saved_at) VALUES($p0,$p1,$p2) ON CONFLICT(player_id) DO UPDATE SET state_json=excluded.state_json,saved_at=excluded.saved_at", playerId, client.ToJsonString(), DateTimeOffset.UtcNow.ToString("o"));
        return client;
    }
    public JsonObject Save(NativeServiceRequest request)
    {
        string slot = request.Text("slot"); if (slot != "auto" && !Slot(slot)) throw new NativeServiceException("no such slot", 400);
        if (request.PlayerId != 1) { var guest = request.Body.ContainsKey("client") ? WriteClient(request.PlayerId, request.Body["client"]) : Client(request.PlayerId); return new JsonObject { ["ok"] = true, ["guest"] = true, ["client"] = guest != null }; }
        var timer = Stopwatch.StartNew(); ChangeMode("saving");
        string? temporary = null;
        try {
            if (slot == "auto") slot = AutoSlot(); string kind = slot.StartsWith("auto") ? "auto" : "slot";
            var client = request.Body.ContainsKey("client") ? WriteClient(request.PlayerId, request.Body["client"]) : Client(request.PlayerId);
            var clock = host.Clock.View();
            if (!host.MultiplayerEnabled() && client?["clock"] is JsonObject shown && NativeCoreClock.Number(shown,"day") == NativeCoreClock.Number(clock,"day") && NativeCoreClock.Number(shown,"hour") == NativeCoreClock.Number(clock,"hour")) {
                int minute = NativeCoreClock.Number(shown,"minute"), current = NativeCoreClock.Number(clock,"minute"); if (minute > current && minute-current < 5) { C.Execute("UPDATE player SET minute=$p0 WHERE id=1", minute); clock = host.Clock.View(); }
            }
            string cleaned(string text,int cap,bool collapse) { text=Regex.Replace(text,"[<>&\"\\x00-\\x1f]",""); if(collapse)text=Regex.Replace(text,@"\s+"," "); return text.Trim()[..Math.Min(cap,text.Trim().Length)]; }
            var old = Meta(PathFor(slot)); string label = kind=="auto"?"Autosave":cleaned(request.Text("label"),30,true); if(label.Length==0)label=old?["label"]?.GetValue<string>()??"Slot "+slot[^1];
            string place = cleaned(client?["place"]?.GetValue<string>()??"",60,false); if(place.Length==0)place="Antwerp";
            var info = new JsonObject { ["slot"]=slot,["kind"]=kind,["label"]=label,["saved_at"]=DateTimeOffset.UtcNow.ToString("o"),
                ["day"]=clock["day"]!.DeepClone(),["weekday"]=clock["weekday"]!.DeepClone(),["hour"]=clock["hour"]!.DeepClone(),["minute"]=clock["minute"]!.DeepClone(),
                ["place"]=place,["money_c"]=host.Player(1)["money_c"]!.DeepClone(),["week"]=C.World("town")?["seed"]?.DeepClone(),["version"]=1 };
            Directory.CreateDirectory(C.Options.SaveDirectory); temporary=Path.Combine(C.Options.SaveDirectory,slot+".tmp-"+Guid.NewGuid().ToString("N")+".sqlite");
            using(var copy=Open(temporary)) {
                C.Database.BackupDatabase(copy); using var command=copy.CreateCommand(); command.CommandText="CREATE TABLE IF NOT EXISTS save_meta(key TEXT PRIMARY KEY,value_json TEXT NOT NULL)"; command.ExecuteNonQuery();
                foreach(var pair in info) { command.CommandText="INSERT OR REPLACE INTO save_meta(key,value_json) VALUES($key,$value)";command.Parameters.Clear();command.Parameters.AddWithValue("$key",pair.Key);command.Parameters.AddWithValue("$value",pair.Value?.ToJsonString()??"null");command.ExecuteNonQuery(); }
                command.CommandText="PRAGMA journal_mode=DELETE"; command.Parameters.Clear();command.ExecuteNonQuery();
            }
            File.Move(temporary,PathFor(slot),true);temporary=null;host.PublishState(request.PlayerId);
            return new JsonObject { ["ok"]=true,["info"]=info,["saves"]=List(),["drained"]=true,["ms"]=timer.Elapsed.TotalMilliseconds };
        } finally { if(temporary!=null)File.Delete(temporary);ChangeMode("open"); }
    }
    public JsonObject Load(NativeServiceRequest request)
    {
        string slot=request.Text("slot");if(!Slot(slot))throw new NativeServiceException("no such slot",400);if(request.PlayerId!=1)throw new NativeServiceException("only the host loads a save",403);
        var info=Meta(PathFor(slot))??throw new NativeServiceException("no such save",404);var timer=Stopwatch.StartNew();ChangeMode("loading");
        try {
            var identities=CaptureIdentities();
            using var copy=Open(PathFor(slot),true);copy.BackupDatabase(C.Database);RestoreIdentities(identities);host.NotifyLoaded();EnsureIdentities();host.Publish("loaded",new JsonObject{["slot"]=slot});
            return NativeCoreClock.Join(new JsonObject{["ok"]=true,["info"]=info,["client"]=Client(request.PlayerId),["ms"]=timer.Elapsed.TotalMilliseconds},host.Payload(request.PlayerId));
        } finally {ChangeMode("open");}
    }
    public void Register(NativeServiceHost service)
    {
        service.Register("GET","/api/pause",r=>Gate());
        service.Register("POST","/api/pause",r=>{if(host.MultiplayerEnabled())return Gate();if(r.Body["on"] is not JsonValue value||!value.TryGetValue<bool>(out bool on))throw new NativeServiceException("on must be true or false",400);string client=r.Text("client","anon");if(on)holders.Add(client);else holders.Remove(client);host.Publish("gate",Gate());return Gate();});
        service.Register("GET","/api/saves",r=>{var saves=List();return new JsonObject{["saves"]=saves,["newest"]=saves.FirstOrDefault()?["slot"]?.DeepClone(),["gate"]=Gate()};});
        service.Register("GET","/api/client-state",r=>new JsonObject{["client"]=Client(r.PlayerId)});
        service.Register("POST","/api/save",Save);service.Register("POST","/api/load",Load);
    }
}
