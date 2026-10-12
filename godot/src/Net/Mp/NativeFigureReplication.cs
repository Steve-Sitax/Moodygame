using System;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Net.Mp;

/// <summary>Source jobfigs ownership, cadence, interpolation, removal and reconnect rules.</summary>
public sealed class NativeFigureReplication
{
    private sealed class Own {public ushort Id;public Func<NativeFigurePose?> Read=null!;public bool Fresh=true;}
    private sealed class Track {public ushort Sender,Id;public string Kind="";public List<(double Time,NativeFigurePose Pose)> Frames=new();public double? EndAt;public int Seen;}
    private readonly Dictionary<object,Own> own=new();
    private readonly Dictionary<int,Track> tracks=new();
    private readonly Dictionary<ushort,double> heard=new();
    private readonly List<double> late=new();
    private readonly List<ushort> sent=new();
    private ushort next=1;
    private double acc,delay=200;
    private int emptyLeft,batch;
    public int Sent {get;private set;}
    public int Received {get;private set;}
    public double Delay=>delay;
    public void Register(object key,Func<NativeFigurePose?> read){if(own.TryGetValue(key,out var row)){row.Read=read;return;}own[key]=new(){Id=next,Read=read};next=next>=0xfffe?(ushort)1:(ushort)(next+1);}
    public void Remove(object key)=>own.Remove(key);
    public void Send(double dt,double now,Func<byte[],bool> send)
    {
        acc+=dt;var rows=new List<NativeFigurePose>();var ids=new List<ushort>();
        foreach(var o in own.Values){if(rows.Count>=32)break;if(o.Read() is not{} s)continue;rows.Add(s with{Id=o.Id,Snap=o.Fresh||s.Snap});ids.Add(o.Id);}
        bool changed=!ids.SequenceEqual(sent);if(!changed&&rows.Count==0&&emptyLeft<=0)return;if(!changed&&acc<.1)return;
        if(!changed&&acc<1/(rows.Any(r=>r.Speed>0)?10.0:2))return;
        if(!send(NativeExtraProtocol.EncodeFigures(now,rows)))return;
        acc=0;sent.Clear();sent.AddRange(ids);foreach(var o in own.Values)if(ids.Contains(o.Id))o.Fresh=false;
        Sent++;emptyLeft=rows.Count>0?3:changed?2:emptyLeft-1;
    }
    public bool Receive(byte[] data,double arrived)
    {
        if(!NativeExtraProtocol.ReadFigures(data,out var sender,out double time,out var rows)||sender==0)return false;
        Received++;heard[sender]=arrived;late.Add(arrived-time);if(late.Count>50)late.RemoveAt(0);int no=++batch;
        foreach(var s in rows){int key=sender*65536+s.Id;if(!tracks.TryGetValue(key,out var tr)||tr.Kind!=s.Kind)tracks[key]=tr=new(){Sender=sender,Id=s.Id,Kind=s.Kind};tr.Seen=no;
            if(tr.Frames.Count>0&&time<=tr.Frames[^1].Time)continue;tr.Frames.Add((time,s));if(tr.Frames.Count>30)tr.Frames.RemoveAt(0);tr.EndAt=null;}
        foreach(var tr in tracks.Values)if(tr.Sender==sender&&tr.Seen!=no&&tr.EndAt==null)tr.EndAt=time;return true;
    }
    public Dictionary<int,NativeFigurePose> Frame(double dt,double now)
    {
        double wanted=NativeExtraProtocol.Delay(late),step=dt*1000*.05;delay+=Math.Clamp(wanted-delay,-step,step);double time=now-delay;
        var result=new Dictionary<int,NativeFigurePose>();foreach(var pair in tracks.ToArray()){var tr=pair.Value;if(now-heard.GetValueOrDefault(tr.Sender)>2500||tr.EndAt!=null&&time>=tr.EndAt){tracks.Remove(pair.Key);continue;}if(NativeExtraProtocol.Sample(tr.Frames,time)is{} s)result[pair.Key]=s;while(tr.Frames.Count>2&&tr.Frames[1].Time<=time)tr.Frames.RemoveAt(0);}return result;
    }
    public void DropSender(int id){foreach(var pair in tracks.Where(p=>p.Value.Sender==id).ToArray())tracks.Remove(pair.Key);heard.Remove((ushort)id);}
    public void Reset(){tracks.Clear();heard.Clear();sent.Clear();foreach(var o in own.Values)o.Fresh=true;}
}
