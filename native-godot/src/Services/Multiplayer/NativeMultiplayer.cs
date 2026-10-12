using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services.Multiplayer;

/// <summary>Native authenticated seats and protocol 6. Invoke stateful methods under NativeServiceHost.WithState.</summary>
public sealed partial class NativeMultiplayer : INativeServiceModule
{
    public const int Protocol=Scheldemist.Net.Mp.MpProtocol.Protocol;
    private readonly NativeServiceHost host;
    private NativeServiceContext C => host.Context;
    private readonly string? settingsPath;
    private JsonObject settings;
    private JsonObject endpoints = new() { ["open"] = new JsonArray(), ["urls"] = new JsonArray(), ["secureOpen"] = new JsonArray(), ["secure"] = new JsonObject { ["house"] = new JsonArray(), ["vpn"] = new JsonArray() }, ["tls"] = null };
    public string HostToken { get; } = RandomToken();
    public string Fingerprint { get; }
    public bool Enabled => settings["multiplayer"]!.GetValue<bool>();
    public Action<JsonObject>? SettingsChanged;
    public Action<int>? ClosePush;
    public Action<int, JsonObject?>? PlayerLeft;
    public Action<int, string>? EnsurePlayer;
    public Action<int, string>? CreateProfile;
    public Func<int, JsonObject>? Profile;
    public Func<IEnumerable<int>, IReadOnlyDictionary<string, int>>? Pins;
    public Func<IEnumerable<int>>? FigureHolders;
    public Action<JsonArray>? MapPlayers;
    public Action<JsonArray, bool>? MapOwners;
    public Action<int, byte[]>? MapPuppets;
    public Action<double, JsonObject>? MapWorld;
    private readonly Dictionary<string, List<long>> tries = new();
    private readonly Dictionary<string, (int Id, long Until)> moves = new();
    private readonly Dictionary<int, NativeMpBucket> http = new();
    private readonly Dictionary<int, int> httpRefused = new();
    private int httpTotal;
    public NativeMultiplayer(NativeServiceHost host, string? settingsPath, string fingerprint) {
        this.host = host; this.settingsPath = settingsPath; Fingerprint = fingerprint;
        if (string.IsNullOrWhiteSpace(fingerprint)) throw new ArgumentException("A native scene/layout fingerprint is required", nameof(fingerprint));
        settings = new JsonObject { ["multiplayer"] = false, ["lan"] = false, ["vpn"] = false, ["code"] = NewCode() };
        if (settingsPath != null && File.Exists(settingsPath)) {
            try { var read = JsonNode.Parse(File.ReadAllText(settingsPath)) as JsonObject;
            if (read != null) { foreach (string key in new[] { "multiplayer", "lan", "vpn" }) if (read[key] is JsonValue v && v.TryGetValue<bool>(out bool b)) settings[key] = b;
                if (read["code"] is JsonValue code && code.TryGetValue<string>(out string? s) && Regex.IsMatch(s, "^[A-Z]{4}-[0-9]{2}$")) settings["code"] = s; }
            } catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException) { }
        }
        if (Bool(settings,"lan") || Bool(settings,"vpn")) settings["multiplayer"] = true;
        C.Execute("CREATE TABLE IF NOT EXISTS mp_player(id INTEGER PRIMARY KEY CHECK(id>=2),name TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,admin INTEGER NOT NULL DEFAULT 0,pose_json TEXT,created_at TEXT NOT NULL,seen_at TEXT)");
    }
    internal static bool Bool(JsonObject obj,string key) => obj[key] is JsonValue v && v.TryGetValue<bool>(out bool b) && b;
    internal static string Text(JsonObject obj,string key,string fallback="") => obj[key] is JsonValue v && v.TryGetValue<string>(out string? s) ? s : fallback;
    internal static double Number(JsonObject obj,string key,double fallback=0) => NativeGoods.Number(obj[key],fallback);
    internal static string RandomToken() => Convert.ToHexString(RandomNumberGenerator.GetBytes(16)).ToLowerInvariant();
    internal static string Hash(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text))).ToLowerInvariant();
    public static string NewCode() { const string letters="ABCDEFGHJKMNPQRSTUVWXYZ",digits="23456789"; return new string(Enumerable.Range(0,4).Select(_=>letters[RandomNumberGenerator.GetInt32(letters.Length)]).ToArray())+"-"+new string(Enumerable.Range(0,2).Select(_=>digits[RandomNumberGenerator.GetInt32(digits.Length)]).ToArray()); }
    public static string CodeKey(string? value) { string key=Regex.Replace((value??"").ToUpperInvariant(),"[^A-Z0-9]",""); return key[..Math.Min(12,key.Length)]; }
    public static bool SameCode(string a,string? b) { byte[] x=Encoding.UTF8.GetBytes(CodeKey(a)),y=Encoding.UTF8.GetBytes(CodeKey(b)); return x.Length>0&&x.Length==y.Length&&CryptographicOperations.FixedTimeEquals(x,y); }
    public static string? CleanGuestName(string? raw) {
        if(raw==null)return null;string normalized;try{normalized=raw.Normalize(NormalizationForm.FormC);}catch(ArgumentException){normalized=raw;}
        var keep=new StringBuilder();foreach(var rune in normalized.EnumerateRunes()) { var category=Rune.GetUnicodeCategory(rune);if(category is UnicodeCategory.UppercaseLetter or UnicodeCategory.LowercaseLetter or UnicodeCategory.TitlecaseLetter or UnicodeCategory.ModifierLetter or UnicodeCategory.OtherLetter or UnicodeCategory.NonSpacingMark or UnicodeCategory.SpacingCombiningMark or UnicodeCategory.EnclosingMark||rune.Value is 32 or 39 or 45)keep.Append(rune.ToString()); }
        string s=Regex.Replace(keep.ToString(),@"\s+"," ").Trim();s=s[..Math.Min(20,s.Length)];return s.Length>0?s:null;
    }
    public void SetEndpoints(JsonObject value) => endpoints=value.DeepClone().AsObject();
    public JsonObject NetworkSettings() => new() { ["lan"] = settings["lan"]!.DeepClone(), ["vpn"] = settings["vpn"]!.DeepClone() };
    public bool AllowRemote(string address) {
        if(!IPAddress.TryParse(address,out var ip))return false; if(ip.IsIPv4MappedToIPv6)ip=ip.MapToIPv4();if(IPAddress.IsLoopback(ip))return true;
        byte[] b=ip.GetAddressBytes(); if(b.Length!=4)return false;
        bool vpn=b[0]==100&&b[1]>=64&&b[1]<=127;bool lan=b[0]==10||(b[0]==172&&b[1]>=16&&b[1]<=31)||(b[0]==192&&b[1]==168);
        return (lan&&Bool(settings,"lan"))||(vpn&&Bool(settings,"vpn"));
    }
    private NativeMpIdentity? Identity(string? token) {
        if(token==null||!Regex.IsMatch(token,"^[0-9a-f]{32}$"))return null;
        if(CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(token),Encoding.ASCII.GetBytes(HostToken)))return new(1,true,true,false,NameOf(1));
        var row=C.One("SELECT id,name,admin FROM mp_player WHERE token_hash=$p0",Hash(token));return row==null?null:new((int)Number(row,"id"),false,Number(row,"admin")==1,true,Text(row,"name"));
    }
    private NativeMpIdentity? IdentityFor(int player) { if(player==1)return new(1,true,true,false,NameOf(1));var row=C.One("SELECT id,name,admin FROM mp_player WHERE id=$p0",player);return row==null?null:new(player,false,Number(row,"admin")==1,true,Text(row,"name")); }
    public NativeMpAuthorization Authorize(string method,string path,string? token,string remoteAddress) {
        method=method.ToUpperInvariant();path=path.Split('?')[0];
        if(!AllowRemote(remoteAddress))return new(null,403,Error("The host has not opened the game to this network."));
        var who=Identity(token);bool publicRoute=(method=="GET"&&path=="/api/mp/info")||(method=="POST"&&(path=="/api/mp/join"||path=="/api/mp/move"));
        if(who==null)return publicRoute?new(null):new(null,401,new JsonObject{["error"]="Join the game first: the join code is on the host's screen.",["join"]=true});
        if(who.Guest) {
            if(!http.TryGetValue(who.Id,out var bucket))http[who.Id]=bucket=new(20,60,C.Now);
            if(!bucket.Take(C.Now)){httpRefused[who.Id]=httpRefused.GetValueOrDefault(who.Id)+1;httpTotal++;return new(null,429,Error("Too many requests from this PC at once. Wait a moment and try again."));}
            if(path.StartsWith("/api/dev/",StringComparison.Ordinal))return new(null,403,Error("Only the host may do that."));
            bool write=method!="GET"&&method!="HEAD";
            bool hostThing=path=="/api/new-game"||path=="/api/load"||path.StartsWith("/api/saves",StringComparison.Ordinal)||path=="/api/ai/config"||path=="/api/ai/test"||path.StartsWith("/api/settings/",StringComparison.Ordinal);
            bool adminThing=who.Admin&&(path=="/api/ai/config"||path=="/api/ai/test"||path.StartsWith("/api/settings/",StringComparison.Ordinal));
            if(write&&hostThing&&!adminThing)return new(null,403,Error("Only the host may do that."));
            (EnsurePlayer??host.Saves.EnsurePlayer)(who.Id,NameOf(who.Id));
        }
        return new(who);
    }
    private static JsonObject Error(string text)=>new(){["error"]=text};
    private static NativeMpResponse Fail(int status,string text)=>new(status,Error(text));
    public NativeMpResponse Handle(string method,string path,string? token,JsonObject body,string remoteAddress) {
        var auth=Authorize(method,path,token,remoteAddress);if(auth.Status!=200)return new(auth.Status,auth.Error!);return HandleWho(method,path,auth.Identity,body,remoteAddress);
    }
    public NativeMpResponse HandleLocal(string method,string path,int playerId,JsonObject body)=>HandleWho(method,path,IdentityFor(playerId),body,"local-adapter");
    private JsonObject HouseView() { var view=endpoints.DeepClone().AsObject();foreach(string key in new[]{"multiplayer","lan","vpn"})view[key]=settings[key]!.DeepClone();return view; }
    private string NameOf(int id) { string first=Profile==null?"":Text(Profile(id),"first");return first.Length>0?first:C.Scalar<string>("SELECT name FROM mp_player WHERE id=$p0",id)??(id==1?"Jef":"Visitor"); }
    private JsonObject Info(NativeMpIdentity? who)=>new(){["multiplayer"]=Enabled,["protocol"]=Protocol,["version"]=Fingerprint,["fingerprint"]=Fingerprint,["you"]=who==null?null:new JsonObject{["id"]=who.Id,["host"]=who.Host,["guest"]=who.Guest,["admin"]=who.Admin,["name"]=NameOf(who.Id)},["pausedAll"]=host.Saves.PausedAll,["house"]=endpoints["house"]?.DeepClone()};
    private bool MayTry(string address) { if(!tries.TryGetValue(address,out var list))tries[address]=list=new();list.RemoveAll(x=>C.Now-x>=60000);return list.Count<5; }
    private void CountTry(string address) { if(!tries.TryGetValue(address,out var list))tries[address]=list=new();list.Add(C.Now); }
    private string Stamp=>DateTimeOffset.FromUnixTimeMilliseconds(C.Now).ToString("o");
    private int? AddGuest(string name,out string token) {
        token=RandomToken();if(C.Scalar<long>("SELECT COUNT(*) FROM mp_player")>=64)return null;
        int id=(int)Math.Max(C.Scalar<long>("SELECT COALESCE(MAX(id),1) FROM mp_player"),Math.Max(C.Scalar<long>("SELECT COALESCE(MAX(id),1) FROM player"),C.Scalar<long>("SELECT COALESCE(MAX(player_id),1) FROM player_profile")))+1;
        if(id>65535)return null;C.Execute("INSERT INTO mp_player(id,name,token_hash,admin,created_at) VALUES($p0,$p1,$p2,0,$p3)",id,name,Hash(token),Stamp);(EnsurePlayer??host.Saves.EnsurePlayer)(id,name);return id;
    }
    private void SaveSettings() { if(settingsPath==null)return;Directory.CreateDirectory(Path.GetDirectoryName(Path.GetFullPath(settingsPath))!);string temporary=settingsPath+".tmp";File.WriteAllText(temporary,settings.ToJsonString(new JsonSerializerOptions{WriteIndented=true}));File.Move(temporary,settingsPath,true); }
    public void Register(NativeServiceHost service) {
        string[] reads={"info","host","stats"},writes={"join","transfer","move","config","code","kick","admin","pause-all"};
        foreach(string tail in reads)service.Register("GET","/api/mp/"+tail,r=>LocalResult(r));foreach(string tail in writes)service.Register("POST","/api/mp/"+tail,r=>LocalResult(r));
        service.NewGame+=ResetWorld;service.Loaded+=ResetWorld;
    }
    private JsonObject LocalResult(NativeServiceRequest r) { var response=HandleLocal(r.Method,r.Path,r.PlayerId,r.Body);if(response.Status!=200)throw new NativeServiceException(Text(response.Body,"error"),response.Status);return response.Body; }
}

