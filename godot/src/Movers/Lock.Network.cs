using System;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.Net.Mp;

namespace Scheldemist.Movers;

public partial class Lock
{
    public bool NetRemote {get;set;}
    public Action<string,JsonArray>? NetAsk;
    public JsonObject NetState()=>new(){["br"]=bridgeAngle,["g"]=new JsonArray(gateOpen.Select(x=>(JsonNode)JsonValue.Create(x)!).ToArray()),["fl"]=flat,["_n"]=cur==null?"":string.Join("+",cur.Names),["s"]=s,["v"]=lastV,["tt"]=turnT,["_d"]=dir,["_bf"]=backFace,["_st"]=state,["_wt"]=want,["_md"]=mode,["_in"]=inside,["_boat"]=boatWant,["_rf"]=rowFrom,["hd"]=held,["w"]=wait};
    public void NetApply(JsonObject value,double dt){
        if(group==null||curve==null)return;bridgeAngle=(float)Math.Clamp(NativeWorldFields.N(value,"br"),OpenBridge,0);var opened=NativeWorldFields.A(value["g"]);for(int i=0;i<Math.Min(2,opened.Count);i++)gateOpen[i]=(float)Math.Clamp(NativeWorldFields.N(new JsonObject{["v"]=opened[i]!.DeepClone()},"v"),0,1);flat=(float)NativeWorldFields.N(value,"fl",flat);
        string names=NativeWorldFields.S(value,"_n");if(names.Length>0&&(cur==null||string.Join("+",cur.Names)!=names)){cur=TrainFor(names.Split('+'));Show(cur);}
        s=NativeWorldFields.N(value,"s");lastV=NativeWorldFields.N(value,"v");turnT=NativeWorldFields.N(value,"tt");dir=NativeWorldFields.N(value,"_d")<0?-1:1;backFace=NativeWorldFields.N(value,"_bf")<0?-1:1;state=NativeWorldFields.S(value,"_st","river");want=NativeWorldFields.B(value,"_wt");mode=NativeWorldFields.S(value,"_md") is string m&&m.Length>0?m:null;inside=NativeWorldFields.B(value,"_in");boatWant=NativeWorldFields.B(value,"_boat");rowFrom=(int)NativeWorldFields.N(value,"_rf",-1);held=NativeWorldFields.N(value,"hd");wait=NativeWorldFields.N(value,"w");ShowLock(dt);
        if(cur!=null){if(state=="turn")Place(s,backFace,Math.PI*Mv.Smooth((float)(turnT/TurnS)));else if(state=="back")Place(s,backFace);else if(state=="dock")Place(LEN,1);else if(state=="river")Place(TailOff,1);else Place(s,dir);}
    }
}
