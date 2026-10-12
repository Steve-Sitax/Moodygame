using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Scheldemist.Native.Services.Multiplayer;

public sealed partial class NativeMultiplayer
{
    private static JsonObject ActionData(JsonObject row) { try{return JsonNode.Parse(Text(row,"data_json","{}")) as JsonObject??new();}catch(JsonException){return new();} }
    private int ComeHolder(JsonObject row) {
        var data=ActionData(row);double pid=Number(data,"pid");if(pid>0&&pid==Math.Truncate(pid))return(int)pid;
        var match=Regex.Match(Text(data,"ref"),@"^job:(\d+):");if(match.Success&&int.TryParse(match.Groups[1].Value,out int job)) { int holder=C.Scalar<int>("SELECT taken_by FROM job WHERE id=$p0",job);if(holder>0)return holder; }return 1;
    }
    private int SeekHolder(JsonObject row) {
        if(row["for_player"]!=null)return(int)Number(row,"for_player");var data=ActionData(row);if(data["player"]!=null)return(int)Number(data,"player");
        if(data["news"]!=null) { int player=C.Scalar<int>("SELECT player_id FROM family_news WHERE id=$p0",(int)Number(data,"news"));if(player>0)return player; }return 1;
    }
    private IReadOnlyDictionary<string,int> DefaultPins(IEnumerable<int> online) {
        var on=new HashSet<int>(online);var result=new Dictionary<string,int>(StringComparer.Ordinal);var rows=C.Rows("SELECT * FROM npc_action WHERE status='active' ORDER BY id").OfType<JsonObject>().ToArray();
        // Source priority: family seeks, hired/treat/return hands, then job calls.
        foreach(var row in rows.Where(r=>Text(r,"kind")=="seek")){int who=SeekHolder(row);if(on.Contains(who))result[Text(row,"npc_id")]=who;}
        foreach(var row in rows.Where(r=>Text(r,"kind")=="routine")) { var routine=ActionData(row)["routine"] as JsonObject;if(routine==null||Text(routine,"purpose") is not("hire" or "treat" or "goods_back"))continue;int who=(int)(routine["state"] is JsonObject state&&state["player"]!=null?Number(state,"player"):Number(routine,"player",1));if(on.Contains(who))result[Text(row,"npc_id")]=who; }
        foreach(var row in rows.Where(r=>Text(r,"kind")=="come")){int who=ComeHolder(row);if(on.Contains(who))result[Text(row,"npc_id")]=who;}return result;
    }
    private IEnumerable<int> DefaultFigureHolders()=>C.Rows("SELECT DISTINCT COALESCE(taken_by,1) AS player FROM job WHERE status='taken'").OfType<JsonObject>().Select(row=>(int)Number(row,"player")).Concat(C.Rows("SELECT * FROM npc_action WHERE kind='come' AND status='active'").OfType<JsonObject>().Select(ComeHolder)).Distinct();
    public bool MayReportNpc(int player,string npc) {
        int? walker=Walker(npc);if(walker==null||walker==player)return true;if(walker!=0)return false;
        var row=C.One("SELECT * FROM npc_action WHERE npc_id=$p0 AND status='active' AND kind='routine' ORDER BY id DESC LIMIT 1",npc);var routine=row==null?null:ActionData(row)["routine"] as JsonObject;return routine!=null&&(int)Number(routine,"player",1)==player;
    }
}
