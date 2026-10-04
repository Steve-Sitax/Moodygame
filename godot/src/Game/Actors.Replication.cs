using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using Godot;
using Scheldemist.Net.Mp;

namespace Scheldemist.Game;

public partial class Actors
{
    private sealed class Replica
    {public ushort Number;public int Owner;public RemoteTrack Track=new();public float Size=1;public double X,Z,T;}
    private readonly Dictionary<string,Replica> replicas=new();
    private readonly Dictionary<ushort,string> replicaIds=new();
    private readonly HashSet<string> claimed=new();
    private double claimWait,replicaWait;
    private readonly List<Scheldemist.Town.Townspeople.Sim> eventPeople=new(150);
    private void ReplicaOwner(string id,ushort number,int owner)
    {
        if(!replicas.TryGetValue(id,out var replica))replicas.Add(id,replica=new());
        if(replica.Owner!=owner){replica.Track=new();replica.T=0;}replica.Number=number;replica.Owner=owner;replicaIds[number]=id;
    }
    private void ReplicaBatch(byte kind,byte[] bytes,double received)
    {
        if(kind!=EventPuppets.Kind||!EventPuppets.Valid(bytes)||town==null)return;
        double time=BinaryPrimitives.ReadDoubleLittleEndian(bytes.AsSpan(2));var together=Together.I;if(together==null)return;
        for(int i=0;i<bytes[1];i++)
        {
            if(!EventPuppets.Read(bytes.AsSpan(10+i*24,24),time,out ushort number,out var state,out float size)||!replicaIds.TryGetValue(number,out string? id)||!replicas.TryGetValue(id,out var replica)||replica.Owner==0||replica.Owner==together.PlayerId)continue;
            if(town.ActionPerson(id) is not {ActionHeld:true} person||!ReferenceEquals(person.ActionOwner,this))continue;
            replica.Size=size;replica.Track.Push(state,together.ServerNow);
        }
    }
    private void Replicate(double dt)
    {
        var together=Together.I;if(together?.Connected!=true||town==null)return;
        claimWait-=dt;replicaWait-=dt;
        if(claimWait<=0)
        {
            claimWait=1;var wanted=new List<string>();var released=new List<string>();
            foreach(var r in Runs)if(r.Action.ForPlayer==together.PlayerId||r.Action.ForPlayer==null&&!together.Guest){if(!wanted.Contains(r.Action.Npc))wanted.Add(r.Action.Npc);if(r.Other is {} other&&!wanted.Contains(other.R.Id))wanted.Add(other.R.Id);}
            foreach(string id in claimed)if(!wanted.Contains(id))released.Add(id);
            if(released.Count>0){together.SendText(new{type="release",ids=released});foreach(string id in released)claimed.Remove(id);}
            if(wanted.Count>0){together.SendText(new{type="claim",ids=wanted});foreach(string id in wanted)claimed.Add(id);}
        }
        foreach(var pair in replicas)
        {
            var person=town.ActionPerson(pair.Key);if(person is not {ActionHeld:true}||!ReferenceEquals(person.ActionOwner,this))continue;
            var replica=pair.Value;
            if(replica.Owner==0||replica.Owner==together.PlayerId||replica.Track.Sample(together.ServerNow) is not {} pose)continue;
            var s=person;if(s.Inside)continue;s.X=pose.X;s.Z=pose.Z;
            var p=s.P;if(p==null&&new Vector2(pose.X,pose.Z).DistanceSquaredTo(new(Main.I.Cam.GlobalPosition.X,Main.I.Cam.GlobalPosition.Z))<58*58)p=town.ActionClaim(s);
            if(p==null)continue;p.X=pose.X;p.Z=pose.Z;p.Yaw=pose.Yaw;p.Size=replica.Size;p.Loaded=(pose.Gear&4)!=0;town.Crowd!.PuppetLantern(p,(pose.Gear&1)!=0);
            town.Crowd!.PuppetStand(p,EventPuppets.Motions[pose.Mode],pose.Yaw);p.Human.SetPace(Math.Max(.3f,pose.Speed));
        }
        if(replicaWait>0)return;replicaWait=.1;
        eventPeople.Clear();foreach(var r in Runs){if(r.Person is {} person&&!eventPeople.Contains(person))eventPeople.Add(person);if(r.Other is {} other&&!eventPeople.Contains(other))eventPeople.Add(other);}
        int count=0;foreach(var s in eventPeople)if(NpcOwned(s.R.Id)&&replicas.TryGetValue(s.R.Id,out var q)&&q.Number>0)count++;
        count=Math.Min(count,EventPuppets.Max);if(count==0)return;var bytesOut=new byte[10+count*24];bytesOut[0]=EventPuppets.Kind;bytesOut[1]=(byte)count;double now=together.ServerNow;BinaryPrimitives.WriteDoubleLittleEndian(bytesOut.AsSpan(2),now);int n=0;
        foreach(var s in eventPeople)
        {
            if(n>=count)break;if(!NpcOwned(s.R.Id)||!replicas.TryGetValue(s.R.Id,out var q)||q.Number==0)continue;
            var p=s.P;double x=p?.X??s.X,z=p?.Z??s.Z;double elapsed=(now-q.T)/1000;bool snap=q.T==0||elapsed<=0||Math.Abs(x-q.X)+Math.Abs(z-q.Z)>8;
            string motion=p?.State=="walk"?"walk":p?.PMotion??"idle";var state=new MpState{T=now,X=(float)x,Z=(float)z,Yaw=(float)(p?.Yaw??0),Vx=snap?0:(float)((x-q.X)/elapsed),Vz=snap?0:(float)((z-q.Z)/elapsed),Mode=Math.Max(0,Array.IndexOf(EventPuppets.Motions,motion)),Gear=(p?.Loaded==true?4:0)|(p?.Lantern!=null?1:0)|(p?.State=="sit"?2:0)|(snap?8:0)};
            EventPuppets.Write(bytesOut.AsSpan(10+n*24,24),q.Number,state,p?.Size??1);q.X=x;q.Z=z;q.T=now;n++;
        }
        together.SendBinary(bytesOut);
    }
    private void ClearReplicas(){eventPeople.Clear();replicas.Clear();replicaIds.Clear();claimed.Clear();claimWait=replicaWait=0;}
}
