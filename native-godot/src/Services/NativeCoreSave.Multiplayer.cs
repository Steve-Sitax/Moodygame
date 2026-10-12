using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeCoreSave
{
    /// <summary>Connection accounts are the live server's identities, not an older saved world's tokens.</summary>
    internal JsonObject CaptureIdentities()
    {
        var tables=new JsonObject();
        foreach(var row in C.Rows("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'mp_%'")){
            string table=row!["name"]!.GetValue<string>();if(!System.Text.RegularExpressions.Regex.IsMatch(table,"^mp_[a-z_]+$"))continue;
            tables[table]=C.Rows("SELECT * FROM "+table);
        }
        return new JsonObject{["tables"]=tables,["profiles"]=C.Rows("SELECT * FROM player_profile")};
    }
    private static object? SqlValue(JsonNode? node)
    {
        if(node==null)return null;
        if(node is JsonValue v){
            if(v.TryGetValue<string>(out var s))return s;
            if(v.TryGetValue<long>(out var l))return l;
            if(v.TryGetValue<int>(out var i))return i;
            if(v.TryGetValue<double>(out var d))return d;
            if(v.TryGetValue<bool>(out var b))return b?1:0;
        }
        return node.ToJsonString();
    }
    private void InsertRow(string table,JsonObject row)
    {
        var keys=row.Select(p=>p.Key).ToArray();
        if(keys.Any(k=>!System.Text.RegularExpressions.Regex.IsMatch(k,"^[a-z_]+$")))throw new InvalidOperationException("Invalid native identity column");
        C.Execute("INSERT OR REPLACE INTO "+table+"("+string.Join(",",keys)+")VALUES("+string.Join(",",keys.Select((_,i)=>"$p"+i))+")",keys.Select(k=>SqlValue(row[k])).ToArray());
    }
    internal void RestoreIdentities(JsonObject snapshot)
    {
        C.Atomic(()=>{
            foreach(var table in snapshot["tables"]!.AsObject()){
                C.Execute("DELETE FROM "+table.Key);
                foreach(var row in table.Value!.AsArray())InsertRow(table.Key,row!.AsObject());
            }
            // A player who joined after this save retains the character they just created.
            foreach(var row in snapshot["profiles"]!.AsArray())
                if(C.Scalar<int>("SELECT COUNT(*) FROM player_profile WHERE player_id=$p0",NativeCoreClock.Number(row!.AsObject(),"player_id"))==0)InsertRow("player_profile",row.AsObject());
        });
        EnsureIdentities();
    }
    public void EnsureIdentities()
    {
        foreach(var row in C.Rows("SELECT id,name FROM mp_player ORDER BY id")){
            int id=NativeCoreClock.Number(row!.AsObject(),"id");EnsurePlayer(id,row["name"]!.GetValue<string>());
            // Fresh native population records have their own IDs; every connected player starts knowing them neutrally.
            C.Execute("INSERT OR IGNORE INTO npc_relationship(npc_id,player_id) SELECT npc_id,$p0 FROM npc_relationship WHERE player_id=1",id);
            C.Execute("INSERT OR IGNORE INTO faction_trust(player_id,faction,trust) SELECT $p0,faction,0 FROM faction_trust WHERE player_id=1",id);
        }
    }
}
