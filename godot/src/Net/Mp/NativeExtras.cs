using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using Godot;
using Scheldemist.Town;

namespace Scheldemist.Net.Mp;

/// <summary>One nearby game runs each animal and anonymous visitor; the other games draw its stream.</summary>
[GamePart(226)]
public partial class NativeExtras : Node
{
    public static NativeExtras? I {get;private set;}
    private Together together=null!;
    private Townspeople town=null!;
    private readonly Dictionary<string,int> owners=new();
    private readonly Dictionary<string,ushort> numbers=new();
    private readonly Dictionary<ushort,string> names=new();
    private readonly HashSet<string> claims=new(),releases=new(),gone=new();
    private sealed class AnimalOut {public NativeAnimalPose Pose;public string? DogOf;public double PutAt;public (NativeAnimalPose Pose,double At)? Sent;public bool Fresh=true;}
    private sealed class AnimalTrack {public double Heard;public readonly List<(double Time,NativeAnimalPose Pose)> Frames=new();}
    private readonly Dictionary<string,AnimalOut> animals=new();
    private readonly Dictionary<string,AnimalTrack> tracks=new();
    private readonly Dictionary<string,Puppet> mine=new();
    private sealed class Walker {public readonly RemoteTrack Track=new(){Delay=220};public Puppet? Body;public float Size=1;public double Heard,EndAt;}
    private readonly Dictionary<string,Walker> walkers=new();
    private readonly List<(string Prefix,Func<string,Puppet,bool> Adopt)> adopters=new();
    private readonly Dictionary<string,(double X,double Z,double Yaw,string Look,double At)> sent=new();
    private readonly List<double> late=new();
    private double accA,accW,alive,delay=220;
    private int serial;
    private bool connected;
    public int ReceivedAnimals {get;private set;}
    public int ReceivedWalkers {get;private set;}
    public int SentAnimals {get;private set;}
    public int SentWalkers {get;private set;}
    public int OwnerOf(string id)=>owners.GetValueOrDefault(id);
    public IEnumerable<string> AnimalsHeard=>tracks.Where(p=>together.ServerNow-p.Value.Heard<4000).Select(p=>p.Key);
    public override void _Ready(){I=this;together=Together.I!;town=Main.I.GetNode<Townspeople>("Townspeople");town.BeforeCrowd+=Apply;town.AfterCrowd+=Send;town.PopulationChanged+=PopulationReset;together.OtherText+=Text;together.OtherBatch+=Batch;}
    private static double Distance(double x,double z,double a,double b)=>Math.Sqrt(Math.Pow(x-a,2)+Math.Pow(z-b,2));
    public bool Nearest(double x,double z,double reach)
    {
        var me=Main.I.Cam.GlobalPosition;double distance=Distance(x,z,me.X,me.Z);if(distance>reach)return false;
        foreach(var row in together.Roster)if(row.Id!=together.PlayerId&&together.PlayerAt(row.Id)is{} p&&Distance(x,z,p.X,p.Z)<distance-.5)return false;return true;
    }
    public bool RunAnimal(string id,double x,double z,double reach=60)
    {
        if(!together.On)return true;if(!together.Connected)return false;
        int owner=OwnerOf(id);if(owner==together.PlayerId){var p=Main.I.Cam.GlobalPosition;if(Distance(x,z,p.X,p.Z)>reach+15){Release(id);return false;}return true;}
        if(owner!=0||!Nearest(x,z,reach))return false;owners[id]=together.PlayerId;releases.Remove(id);claims.Add(id);return true;
    }
    public void Release(string id,bool ended=false){if(OwnerOf(id)!=together.PlayerId)return;owners.Remove(id);claims.Remove(id);(ended?gone:releases).Add(id);animals.Remove(id);}
    public void PutAnimal(string id,NativeAnimalPose pose,string? dogOf=null){if(!animals.TryGetValue(id,out var row))animals[id]=row=new();row.Pose=pose;row.DogOf=dogOf;row.PutAt=together.ServerNow;}
    public NativeAnimalPose? Animal(string id)
    {
        if(!tracks.TryGetValue(id,out var tr)||tr.Frames.Count==0||together.ServerNow-tr.Heard>=4000)return null;
        double time=together.ServerNow-delay;while(tr.Frames.Count>2&&tr.Frames[1].Time<=time)tr.Frames.RemoveAt(0);var a=tr.Frames[0];if(tr.Frames.Count==1||time<=a.Time)return a.Pose;var b=tr.Frames[1];if(time>=b.Time)return b.Pose;if(b.Pose.Snap)return a.Pose;double u=(time-a.Time)/(b.Time-a.Time);
        return new(a.Pose.X+(b.Pose.X-a.Pose.X)*u,a.Pose.Z+(b.Pose.Z-a.Pose.Z)*u,a.Pose.Yaw+NativeExtraProtocol.Wrap(b.Pose.Yaw-a.Pose.Yaw)*u,u<.5?a.Pose.Motion:b.Pose.Motion);
    }
    public string NewId(string group,string kind)=>$"x:{group}:{kind}:{together.PlayerId}.{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()%10000000:x}.{serial++:x}";
    public void Person(string id,Puppet p){if(!together.On||mine.ContainsKey(id))return;mine[id]=p;if(OwnerOf(id)!=together.PlayerId){owners[id]=together.PlayerId;claims.Add(id);}}
    public void PersonGone(string id){mine.Remove(id);sent.Remove(id);Release(id,true);}
    public void OnAdopt(string prefix,Func<string,Puppet,bool> adopt)=>adopters.Add((prefix,adopt));
    public void OffAdopt(string prefix)=>adopters.RemoveAll(a=>a.Prefix==prefix);
    private void Adopt(string id,Walker row)
    {
        walkers.Remove(id);if(row.Body is not{} p)return;p.Remote=false;var adopter=adopters.FirstOrDefault(a=>id.StartsWith(a.Prefix,StringComparison.Ordinal));
        if(adopter.Adopt!=null&&adopter.Adopt(id,p))mine[id]=p;else{town.Crowd?.RemovePuppet(p);Release(id,true);}
    }
    private void Text(string type,JsonElement message)
    {
        if(type!="owners"||!message.TryGetProperty("list",out var list))return;
        if(message.TryGetProperty("full",out var full)&&full.ValueKind==JsonValueKind.True)foreach(string id in owners.Where(p=>p.Value!=together.PlayerId).Select(p=>p.Key).ToArray())owners.Remove(id);
        foreach(var item in list.EnumerateArray()){ushort n=item[0].GetUInt16();string id=item[1].GetString()!;int o=item[2].GetInt32(),was=OwnerOf(id);numbers[id]=n;names[n]=id;if(o==0)owners.Remove(id);else owners[id]=o;if(!id.StartsWith("x:"))continue;
            walkers.TryGetValue(id,out var row);
            if(mine.TryGetValue(id,out var own)&&o>0&&o!=together.PlayerId){town.Crowd?.RemovePuppet(own);mine.Remove(id);sent.Remove(id);continue;}
            if(o<0){if(row!=null)row.EndAt=together.ServerNow+delay+300;}
            else if(o==together.PlayerId&&row!=null)Adopt(id,row);
            else if(o==0&&row?.Body is{} body&&was!=together.PlayerId&&Nearest(body.X,body.Z,60)&&adopters.Any(a=>id.StartsWith(a.Prefix,StringComparison.Ordinal))){owners[id]=together.PlayerId;claims.Add(id);Adopt(id,row);}
            else if(o==together.PlayerId&&row==null&&was!=together.PlayerId&&!mine.ContainsKey(id))Release(id,true);
        }
    }
    private void NoteLate(double n){late.Add(n);if(late.Count>60)late.RemoveAt(0);}
    private void Batch(byte kind,byte[] data,double arrived)
    {
        if(kind==5&&NativeExtraProtocol.ReadAnimals(data,out double time,out var rows)){
            NoteLate(arrived-time);foreach(var row in rows){if(!names.TryGetValue(row.Number,out string? key))continue;string id=row.Dog?"dog:"+key:key;if(!row.Dog&&OwnerOf(id)==together.PlayerId)continue;
                if(!tracks.TryGetValue(id,out var tr))tracks[id]=tr=new();tr.Heard=together.ServerNow;if(tr.Frames.Count>0&&time<=tr.Frames[^1].Time)continue;tr.Frames.Add((time,row.Pose));if(tr.Frames.Count>30)tr.Frames.RemoveAt(0);ReceivedAnimals++;}return;
        }
        if(kind!=3||!EventPuppets.Valid(data))return;double t=BinaryPrimitives.ReadDoubleLittleEndian(data.AsSpan(2));bool any=false;
        for(int i=0;i<data[1];i++){if(!EventPuppets.Read(data.AsSpan(10+i*24,24),t,out ushort n,out var pose,out float size)||!names.TryGetValue(n,out string? id)||!id.StartsWith("x:")||OwnerOf(id)==0||OwnerOf(id)==together.PlayerId)continue;any=true;
            if(!walkers.TryGetValue(id,out var row)){var p=Main.I.Cam.GlobalPosition;if(Distance(pose.X,pose.Z,p.X,p.Z)>90)continue;walkers[id]=row=new();}
            row.Track.Push(pose,arrived);row.Size=size;row.Heard=together.ServerNow;ReceivedWalkers++;}
        if(any)NoteLate(arrived-t);
    }
    private void Apply(double dt)
    {
        if(!together.Connected){if(connected)Reset();connected=false;return;}connected=true;double step=dt*1000*.05;if(late.Count>=10)delay+=Math.Clamp(NativeExtraProtocol.Delay(late,200,400)-delay,-step,step);
        var me=Main.I.Cam.GlobalPosition;foreach(var pair in walkers.ToArray()){var row=pair.Value;row.Track.Delay=delay;var pose=row.Track.Sample(together.ServerNow);if(together.ServerNow-row.Heard>4000||row.EndAt>0&&together.ServerNow>row.EndAt||pose is{} far&&Distance(far.X,far.Z,me.X,me.Z)>100){if(row.Body!=null)town.Crowd?.RemovePuppet(row.Body);walkers.Remove(pair.Key);continue;}
            if(pose is not{} s||town.Crowd==null)continue;row.Body??=town.Crowd.AddPuppet(pair.Key.Split(':')[2],s.X,s.Z,s.Yaw,size:row.Size);if(row.Body is not{} p)continue;
            p.Remote=true;p.X=s.X;p.Z=s.Z;p.Yaw=s.Yaw;p.Size=row.Size;p.Group.Scale=Vector3.One*row.Size;string motion=EventPuppets.Motions[Math.Clamp(s.Mode,0,EventPuppets.Motions.Length-1)];p.Human.Play(motion);p.Human.SetPace(s.Speed);p.State=(s.Gear&1)!=0?"sit":motion=="walk"?"walk":"stand";p.PMotion=motion;town.Crowd.PuppetLantern(p,(s.Gear&2)!=0);town.Crowd.PuppetLoad(p,(s.Gear&4)!=0);town.Crowd.PuppetCarry(p,EventPuppets.Bought[Math.Clamp(s.PuppetBought,0,4)]);
        }
        foreach(string id in tracks.Where(p=>together.ServerNow-p.Value.Heard>8000).Select(p=>p.Key).ToArray())tracks.Remove(id);
    }
    private void Send(double dt)
    {
        if(!together.Connected)return;
        if(claims.Count>0&&together.SendText(new{type="claim",ids=claims.Take(200).ToArray()}))claims.Clear();
        if((releases.Count>0||gone.Count>0)&&together.SendText(new{type="release",ids=releases.Take(200).ToArray(),gone=gone.Take(200).ToArray()})){releases.Clear();gone.Clear();}
        double now=together.ServerNow;accA+=dt;
        if(accA>=.1){accA=0;var output=new List<(ushort,NativeAnimalPose,bool)>();foreach(var pair in animals.ToArray()){var row=pair.Value;string key=row.DogOf??pair.Key;if(!numbers.TryGetValue(key,out ushort n)||OwnerOf(key)!=together.PlayerId)continue;if(now-row.PutAt>6000){animals.Remove(pair.Key);continue;}
            var old=row.Sent;bool moved=old==null||Distance(row.Pose.X,row.Pose.Z,old.Value.Pose.X,old.Value.Pose.Z)>.02||Math.Abs(NativeExtraProtocol.Wrap(row.Pose.Yaw-old.Value.Pose.Yaw))>.03||row.Pose.Motion!=old.Value.Pose.Motion;
            if(!moved&&now-old!.Value.At<2000)continue;output.Add((n,row.Pose with{Snap=row.Fresh||row.Pose.Snap},row.DogOf!=null));row.Sent=(row.Pose,now);row.Fresh=false;}
            if(output.Count>0||now-alive>=1000&&owners.Values.Any(o=>o==together.PlayerId)){alive=now;for(int i=0;i<Math.Max(1,output.Count);i+=200)if(together.SendBinary(NativeExtraProtocol.EncodeAnimals(now,output.Skip(i).Take(200).ToArray())))SentAnimals+=Math.Min(200,output.Count-i);}
        }
        accW+=dt;if(accW<.1)return;double span=accW;accW=0;var outW=new List<(ushort,MpState,float)>();
        foreach(var pair in mine.ToArray()){var p=pair.Value;if(!GodotObject.IsInstanceValid(p.Group)||p.Group.IsQueuedForDeletion()){PersonGone(pair.Key);continue;}if(OwnerOf(pair.Key)==0){owners[pair.Key]=together.PlayerId;claims.Add(pair.Key);continue;}if(OwnerOf(pair.Key)!=together.PlayerId||!numbers.TryGetValue(pair.Key,out ushort n))continue;
            int mode=Math.Max(0,Array.IndexOf(EventPuppets.Motions,p.Human.Motion??"idle")),gear=(p.State=="sit"?1:0)|(p.Lantern!=null?2:0)|(p.Loaded?4:0);int bought=Math.Max(0,Array.IndexOf(EventPuppets.Bought,p.Bought));string look=$"{mode}|{gear}|{bought}|{p.Size:F3}";bool prior=sent.TryGetValue(pair.Key,out var old);bool moved=!prior||Distance(p.X,p.Z,old.X,old.Z)>.01||Math.Abs(NativeExtraProtocol.Wrap(p.Yaw-old.Yaw))>.01;if(prior&&!moved&&look==old.Look&&now-old.At<1000)continue;double dtS=prior?Math.Max(span,(now-old.At)/1000):span,vx=prior&&moved?(p.X-old.X)/dtS:0,vz=prior&&moved?(p.Z-old.Z)/dtS:0;bool snap=!prior||vx*vx+vz*vz>64;
            outW.Add((n,new(){T=now,X=(float)p.X,Z=(float)p.Z,Yaw=(float)p.Yaw,Vx=snap?0:(float)vx,Vz=snap?0:(float)vz,Mode=mode,Gear=gear|(snap?8:0),PuppetBought=bought},p.Size));sent[pair.Key]=(p.X,p.Z,p.Yaw,look,now);}
        for(int i=0;i<outW.Count;i+=150){int count=Math.Min(150,outW.Count-i);var data=new byte[10+count*24];data[0]=3;data[1]=(byte)count;BinaryPrimitives.WriteDoubleLittleEndian(data.AsSpan(2),now);for(int j=0;j<count;j++){var s=outW[i+j];EventPuppets.Write(data.AsSpan(10+j*24,24),s.Item1,s.Item2,s.Item3);}if(together.SendBinary(data))SentWalkers+=count;}
    }
    private void Reset(){foreach(var row in walkers.Values)if(row.Body!=null)town.Crowd?.RemovePuppet(row.Body);walkers.Clear();tracks.Clear();numbers.Clear();names.Clear();owners.Clear();sent.Clear();claims.Clear();releases.Clear();gone.Clear();foreach(string id in mine.Keys){owners[id]=together.PlayerId;claims.Add(id);}foreach(var row in animals.Values){row.Fresh=true;row.Sent=null;}late.Clear();accA=accW=0;}
    private void PopulationReset(){foreach(var p in mine.Values)town.Crowd?.RemovePuppet(p);mine.Clear();animals.Clear();Reset();}
    public override void _ExitTree(){PopulationReset();town.BeforeCrowd-=Apply;town.AfterCrowd-=Send;town.PopulationChanged-=PopulationReset;together.OtherText-=Text;together.OtherBatch-=Batch;if(I==this)I=null;}
}
