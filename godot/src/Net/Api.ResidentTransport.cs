using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;
using System.Threading.Tasks;

namespace Scheldemist.Net;

public sealed record ResidentVehicle
{
    public string Id{get;init;}="";public string Kind{get;init;}="";public string Owner{get;init;}="";public int Household{get;init;}
    public double[] Home{get;init;}=Array.Empty<double>();public Dictionary<string,double[]> Parks{get;init;}=new();
    public string? Route{get;init;}public ResidentBoat? Boat{get;init;}public string Label{get;init;}="";public bool Gone{get;init;}public string At{get;init;}="home";
}
public sealed record ResidentBoat {public string Kind{get;init;}="rowboat";public double[] Landing{get;init;}=Array.Empty<double>();public double[] Flight{get;init;}=Array.Empty<double>();}
public sealed record ResidentLoad {public string What{get;init;}="goods";public int Items{get;init;}}
public sealed record ResidentErrand
{
    public string Id{get;init;}="";public string Kind{get;init;}="";public string Vehicle{get;init;}="";public List<string> Who{get;init;}=new();
    public double Hour{get;init;}public double Back{get;init;}public double[] To{get;init;}=Array.Empty<double>();[JsonPropertyName("toLabel")]public string ToLabel{get;init;}="";public ResidentLoad Load{get;init;}=new();
}
public sealed record ResidentTransport {public int Day{get;init;}public List<ResidentVehicle> Vehicles{get;init;}=new();public List<ResidentErrand> Errands{get;init;}=new();public VeloJef Jef{get;init;}=new();}
public partial class Api {public Task<ResidentTransport> TownTransport()=>Get<ResidentTransport>("api/transport");public Task<OkReply> TransportMissed(string velo)=>Post<OkReply>("api/transport/missed",new{velo});}
