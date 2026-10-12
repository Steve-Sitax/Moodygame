using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

internal static class NativeNorthNarration
{
    public static bool MayCall(NativeServiceContext c,int day,string hook,int share,int dayLimit,int pending=0)
    {
        int mine=c.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook=$p1",day,hook),running=c.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0 AND hook=$p1 AND error='running'",day,hook),unbooked=System.Math.Max(0,pending-running),total=c.Scalar<int>("SELECT COUNT(*) FROM ai_call WHERE day=$p0",day);return mine+unbooked<share&&(dayLimit==0||total+unbooked<dayLimit-15);
    }
    public static JsonObject Request(string hook,JsonObject snapshot,JsonObject schema,string rules)=>new(){["hook"]=hook,["schema"]=schema.DeepClone(),["system"]="Antwerp, 1873. Write plain English; Dutch only in names and jenever. The native engine owns money, prices, actions, facts, schedules and outcomes. Return only the supplied JSON contract. "+rules,["prompt"]=snapshot.ToJsonString()};
    public static JsonObject Parse(string schema)=>JsonNode.Parse(schema)!.AsObject();
    public static readonly JsonObject PlanStep=Parse("""{"type":"object","properties":{"kind":{"type":"string","enum":["walk_to","buy","give","talk_to","fetch_cart","come_back","wait","follow","enter","pay","take"]},"target":{"type":"string","maxLength":80},"item":{"type":"string","maxLength":40},"count":{"type":"integer","minimum":0,"maximum":4},"message":{"type":"string","maxLength":200},"until_hour":{"type":"integer","minimum":-1,"maximum":23},"minutes":{"type":"integer","minimum":0,"maximum":120}},"required":["kind","target","item","count","message","until_hour","minutes"]}""");
    public static JsonObject CheckinSchema()
    {
        var schema=Parse("""{"type":"object","properties":{"decision":{"type":"string","enum":["continue","change_next","skip","come_back","give_up"]},"line":{"type":"string","maxLength":200},"why":{"type":"string","maxLength":200}},"required":["decision","step","line","why"]}""");schema["properties"]!["step"]=PlanStep.DeepClone();return schema;
    }
    public static readonly JsonObject Director=Parse("""{"type":"object","properties":{"template":{"type":"string","maxLength":30},"title":{"type":"string","maxLength":80},"place":{"type":"string","maxLength":60},"start_in_min":{"type":"integer","minimum":0,"maximum":180},"notice":{"type":"string","maxLength":160},"rumour":{"type":"string","maxLength":160},"why":{"type":"string","maxLength":200},"stages":{"type":"array","maxItems":6,"items":{"type":"object","properties":{"op":{"type":"string","enum":["gather","procession","sound","props","talk","notice","rumour","price","close","open","job","weather","scuffle","robbery","enter","depart"]},"minutes":{"type":"integer","minimum":5,"maximum":180},"place":{"type":"string"},"role":{"type":"string"},"count":{"type":"integer","minimum":0,"maximum":100},"sound":{"type":"string"},"mood":{"type":"string"},"props":{"type":"string"},"text":{"type":"string","maxLength":160},"item":{"type":"string"},"factor":{"type":"number","minimum":0.5,"maximum":3}},"required":["op","minutes","place","role","count","sound","mood","props","text","item","factor"]}}},"required":["template","title","place","start_in_min","notice","rumour","why","stages"]}""");
    public static readonly JsonObject Hiring=Parse("""{"type":"object","properties":{"calls":{"type":"array","maxItems":2,"items":{"type":"object","properties":{"spot":{"type":"string"},"call":{"type":"string","maxLength":200},"remarks":{"type":"array","maxItems":3,"items":{"type":"string","maxLength":120}},"to_jef":{"type":"string","maxLength":120}},"required":["spot","call","remarks","to_jef"]}}},"required":["calls"]}""");
}
