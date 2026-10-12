using System;
using System.Linq;
using System.Text.Json.Nodes;

namespace Scheldemist.Native.Services;

public sealed partial class NativeTownPopulation
{
    private sealed partial class Builder
    {
        private void BuildPlaces()
        {
            foreach(var fact in A(Facts["PLACES"])) {var p=Snap(N(fact?["x"]),N(fact?["z"]));places[S(fact,"id")]=new JsonObject{["label"]=fact!["label"]!.DeepClone(),["x"]=p.x,["z"]=p.z,["r"]=fact["r"]!.DeepClone(),["district"]=fact["district"]!.DeepClone()};}
            int? KeptHouse(string id)=>A(owner.Kept["houses"]).FirstOrDefault(h=>S(h,"id")==id) is { } h?(int)N(h["house"]):null;
            foreach(var shop in A(Facts["SHOPS"])) {string id=S(shop,"id");int? kept=KeptHouse("shop:"+id);double x=N(shop?["x"]),z=N(shop?["z"]);var own=kept==null?null:free.FirstOrDefault(d=>N(d["house"])==kept&&Distance(N(d["sx"]),N(d["sz"]),x,z)<=35);if(own!=null)rng();var d=own??DoorNear(x,z,35);if(d==null)continue;shopDoors[id]=d;shopHouses.Add((int)N(d["house"]));places[id]=new JsonObject{["label"]=shop!["label"]!.DeepClone(),["x"]=N(d["sx"]),["z"]=N(d["sz"]),["r"]=3,["district"]="town",["door"]=Pt(N(d["sx"]),N(d["sz"])),["out"]=d["out"]!.DeepClone()};}
            foreach(var tavern in A(Facts["TAVERNS"])) {string id="tavern:"+S(tavern,"id");int? kept=KeptHouse(id);double x=N(tavern?["x"]),z=N(tavern?["z"]);var own=free.FirstOrDefault(d=>kept!=null&&N(d["house"])==kept&&Distance(N(d["sx"]),N(d["sz"]),x,z)<=35);if(own!=null)rng();var d=own??DoorNear(x,z,35);if(d==null)continue;places[id]=new JsonObject{["label"]=tavern!["label"]!.DeepClone(),["x"]=N(d["sx"]),["z"]=N(d["sz"]),["r"]=4,["district"]="town",["door"]=Pt(N(d["sx"]),N(d["sz"])),["out"]=d["out"]!.DeepClone()};}
            foreach(var id in A(Facts["PLAY"]))places["play:"+id!.GetValue<string>()]=places[id.GetValue<string>()]!.DeepClone();foreach(var id in A(Facts["MARKETS"]))places["market:"+id!.GetValue<string>()]=places[id.GetValue<string>()]!.DeepClone();var church=owner.Spot("cathedral_door");places["church"]=new JsonObject{["label"]="the cathedral",["x"]=church["x"]!.DeepClone(),["z"]=church["z"]!.DeepClone(),["r"]=3,["district"]="grote-markt"};
            foreach(var stall in A(Facts["STALLS"])) {var p=Snap(N(stall?["x"]),N(stall?["z"]));stalls.Add(new JsonObject{["place"]=stall!["place"]!.DeepClone(),["x"]=p.x,["z"]=p.z,["face"]=stall["face"]!.DeepClone(),["goods"]=stall["goods"]!.DeepClone(),["keeper"]=null});}
            taverns=places.Select(p=>p.Key).Where(k=>k.StartsWith("tavern:",StringComparison.Ordinal)).ToArray();lamps=A(owner.City["decor"]?["lamps"]).Select(p=>Snap(N(p?[0]),N(p?[1])+1.2)).ToList();
        }
        private void AddStreetChildren()
        {
            int bands=scale>1.3?scale>2?3:2:1;var wheres=new[]{"vismarkt","werf","bassin"};for(int k=0;k<bands;k++){string where=wheres[k];var pl=places[where]??places["vismarkt"]!;string play=places.ContainsKey("play:"+where)?"play:"+where:"play:vismarkt";var d=DoorNear(N(pl["x"]),N(pl["z"]),200,4);var home=d!=null?Home(d):k>0?ShareHouse(N(pl["x"]),N(pl["z"])):null;if(home==null)continue;int hh=++household;string surname=Surname();for(int i=0;i<3;i++){string sex=i==2?"f":"m";Add(sex,Int(8,13),"street_child",sex=="m"?"son":"daughter",surname,home,new JsonObject{["place"]=play,["kind"]="roam"},hh);}}
        }
        private void FinishMarkets()
        {
            foreach(var person in residents.ToArray()){string trade=S(person,"trade");if(trade is not("fishwife"or"market_woman")||person["work"]?["stall"]!=null)continue;string oldPlace=S(person["work"],"place"),place=places.ContainsKey(oldPlace)?oldPlace:trade=="fishwife"?"vismarkt":"grote_markt";int? i=StallFor(place);if(i==null){person["work"]=Work("laundress",place,person["home"]!.AsObject());continue;}AssignStall(person,i.Value,place);}
            for(int i=0;i<stalls.Count;i++){var stall=stalls[i];if(stall["keeper"]!=null)continue;string trade=S(stall,"goods")=="fish"?"fishwife":"market_woman";var wife=residents.Where(r=>S(r,"trade")=="housewife"&&N(r["age"])>=20&&N(r["age"])<62).OrderBy(r=>Distance(N(r["home"]?["sx"]),N(r["home"]?["sz"]),N(stall["x"]),N(stall["z"]))).FirstOrDefault();if(wife==null){var d=DoorNear(N(stall["x"]),N(stall["z"]),200,4)??DoorNear(N(stall["x"]),N(stall["z"]),1e9);var home=d==null?ShareHouse(N(stall["x"]),N(stall["z"])):Home(d);if(home==null)break;int age=Int(34,60);string surname=Surname();wife=Add("f",age,trade,"widow",surname,home,new JsonObject{["place"]=S(stall,"place"),["kind"]="stall"},++household);}wife["trade"]=trade;wife["faction"]=Facts["TRADES"]![trade]!["faction"]?.DeepClone();wife["kind"]=Kind(trade,"f",(int)N(wife["age"]));AssignStall(wife,i,S(stall,"place"));}
        }
        private void EnsurePriestPolice()
        {
            int police=residents.Count(r=>S(r,"trade")=="police");bool priest=!residents.Any(r=>S(r,"trade")=="priest");if(!priest&&police>=4)return;rng=Random(seed^0x2f6e1873);var beats=new[]{"quays","town","werf","quays"};for(int i=police;i<4;i++){var pl=places[beats[i]]??places["rijnkaai"]!;var d=DoorNear(N(pl["x"]),N(pl["z"]),200,4)??DoorNear(N(pl["x"]),N(pl["z"]),1e9);var home=d==null?ShareHouse(N(pl["x"]),N(pl["z"])):Home(d);if(home==null)break;int age=Int(24,50);string surname=Surname();var head=Add("m",age,"police","head",surname,home,Work("police",beats[i],home),++household);Family(head,noKids:residents.Count>=target);}if(priest){var c=owner.Spot("cathedral_door");var d=DoorNear(N(c["x"]),N(c["z"]),200,3)??DoorNear(N(c["x"]),N(c["z"]),1e9);var home=d==null?ShareHouse(N(c["x"]),N(c["z"])):Home(d);if(home!=null){var p=Snap(N(c["x"])+1.5,N(c["z"])-.6);int age=Int(38,64);string surname=Surname();Add("m",age,"priest","single",surname,home,new JsonObject{["place"]="cathedral",["kind"]="post",["at"]=new JsonArray(p.x,p.z,Math.PI)},++household);}}
        }
    }
}
