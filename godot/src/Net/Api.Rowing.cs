using System.Collections.Generic;
using System.Threading.Tasks;
using Scheldemist.Play;

namespace Scheldemist.Net;

public sealed record RowPlace {public float X {get;init;} public float Z {get;init;} public float Yaw {get;init;}}
public sealed record RowLanding
{public string Id {get;init;}="";public string Label {get;init;}="";public string Kind {get;init;}="rowboat";public string Waterman {get;init;}="";public float[] Top {get;init;}=System.Array.Empty<float>();public float[] Landing {get;init;}=System.Array.Empty<float>();public float X {get;init;} public float Z {get;init;} public float Yaw {get;init;}}
public sealed record RowLoose
{public string Id {get;init;}="";public string Kind {get;init;}="rowboat";public string? Owner {get;init;}public string OwnerName {get;init;}="";public string Prompt {get;init;}="";public RowPlace Home {get;init;}=new();public string Board {get;init;}="steps";public float[] Landing {get;init;}=System.Array.Empty<float>();public float X {get;init;}public float Z {get;init;}public float Yaw {get;init;}public bool Ridden {get;init;}public bool Mine {get;init;}public bool Lost {get;init;}}
public sealed record RowHire
{public string Landing {get;init;}="";public string Kind {get;init;}="rowboat";public int TimeLeftMin {get;init;}public int LateC {get;init;}public RowPlace? Left {get;init;}}
public sealed record RowFees {public int HireC {get;init;}public int Hours {get;init;}public int LateC {get;init;}public int LeftFineC {get;init;}}
public sealed record RowWorld
{public List<RowLanding> Landings {get;init;}=new();public List<RowLoose> Boats {get;init;}=new();public RowHire? Hire {get;init;}public string? On {get;init;}public int DebtC {get;init;}public CartNotice? Notice {get;init;}public bool Storm {get;init;}public RowFees Fees {get;init;}=new();}
public sealed record RowReply:JobsPayload {public RowWorld Row {get;init;}=new();public string Text {get;init;}="";public bool Returned {get;init;}public int PaidC {get;init;}public int OwedC {get;init;}}
public sealed record RowBoardReply {public RowWorld Row {get;init;}=new();public string Text {get;init;}="";}
public sealed record RowStrokeReply {public int Counted {get;init;}}
public sealed record RowMountReply:JobsPayload {public string Text {get;init;}="";public bool Again {get;init;}}
public partial class Api
{
    public Task<RowWorld> RowWorld()=>Get<RowWorld>("api/row/world");
    public Task<RowReply> RowHire(string landing,float x,float z)=>Post<RowReply>("api/row/hire",new{landing,x,z});
    public Task<RowBoardReply> RowBoard(float x,float z)=>Post<RowBoardReply>("api/row/board",new{x,z});
    public Task<RowReply> RowLeave(float x,float z,float yaw,bool ashore)=>Post<RowReply>("api/row/leave",new{x,z,yaw,ashore});
    public Task<RowStrokeReply> RowStroke(bool hard)=>Post<RowStrokeReply>("api/row/stroke",new{hard});
    public Task<RowReply> RowLost(string cause)=>Post<RowReply>("api/row/lost",new{cause});
    public Task<RowMountReply> RowMountMine(RowLoose boat,float x,float z)=>Post<RowMountReply>("api/deed",new{@ref=boat.Id,x,z,witnesses=System.Array.Empty<object>(),crouch=false,lantern=false});
}
