using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading.Tasks;
namespace Scheldemist.Native.Services;
public sealed partial class NativeHands
{
    public Func<int,string,JsonObject,Task<JsonObject?>>? NarrateAsync;
    public Func<int>? DailyCallLimit;
    private int generation;
    private readonly ConcurrentDictionary<string,Task> pending=new();
    public Task LinesSettled()=>Task.WhenAll(pending.Values.ToArray());
    private void QueueLines(int player,JsonObject person)
    {
        string key=$"hands:lines:{Day}:{S(person,"id")}";if(NarrateAsync==null||C.World(key)!=null||pending.ContainsKey(key)||!NativeNorthNarration.MayCall(C,Day,"hands_lines",2,DailyCallLimit?.Invoke()??120,pending.Values.Count(t=>!t.IsCompleted)))return;
        var schema=NativeNorthNarration.Parse("""{"type":"object","properties":{"done":{"type":"string","minLength":1,"maxLength":120},"ask_more":{"type":"string","minLength":1,"maxLength":120},"quit":{"type":"string","minLength":1,"maxLength":120},"carry_on":{"type":"string","minLength":1,"maxLength":120}},"required":["done","ask_more","quit","carry_on"]}""");
        var request=NativeNorthNarration.Request("hands_lines",new(){["person"]=person.DeepClone(),["relationship"]=host.Rumours.Relationship(S(person,"id"),player)},schema,"Write done, ask_more, quit and carry_on in the person's voice. Each at most fourteen words; no oaths, threats, sums, numbers or coins. The engine supplies sums and decides outcomes.");
        int started=generation;var task=WriteLines(player,key,request,started);pending[key]=task;_=task.ContinueWith(done=>{_=done.Exception;((ICollection<KeyValuePair<string,Task>>)pending).Remove(new(key,done));},TaskScheduler.Default);
    }
    private async Task WriteLines(int player,string key,JsonObject request,int started)
    {
        JsonObject? output=null;try{output=await NarrateAsync!(player,"hands_lines",request).ConfigureAwait(false);}catch{}if(output==null)return;
        await host.WithState(_=>{if(generation!=started)return false;var valid=new JsonObject();foreach(string field in new[]{"done","ask_more","quit","carry_on"}){string text=S(output,field).Trim();if(text.Length==0||text.Length>120||text.Split(' ',StringSplitOptions.RemoveEmptyEntries).Length>14||Regex.IsMatch(text,@"[<>\u0060\\]|\d|\b(centimes?|francs?|coins?)\b",RegexOptions.IgnoreCase))continue;valid[field]=text;}if(valid.Count>0)C.SetWorld(key,valid);return true;}).ConfigureAwait(false);
    }
    private string HandLine(string npc,string field)
    {
        string cached=S(C.World($"hands:lines:{Day}:{npc}"),field);if(cached!="")return cached;var person=actions.Resident(npc);bool hot=N(person?["stats"],"temper",5)>=6,warm=N(person?["stats"],"warmth",5)>=6;
        return field switch{"done"=>warm?"That is the lot, and glad to help.":"That is the lot.","ask_more"=>hot?"This is heavier than you said.":"It is more work than I thought, this.","quit"=>hot?"Then carry them yourself.":"Then I am done. Find another man.",_=>hot?"Hm. A bargain is a bargain, I suppose.":"All right, all right. I will finish."};
    }
}
