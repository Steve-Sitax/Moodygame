using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Scheldemist.Play;

namespace Scheldemist.Net.Mp;

/// <summary>Draws another player's made job figures; real residents use NativeStreet.</summary>
[GamePart(940)]
public partial class NativeJobFigures : Node
{
    public static NativeJobFigures? I {get;private set;}
    public readonly NativeFigureReplication Replication=new();
    private readonly Dictionary<int,Folk.Figure> drawn=new();
    private Together together=null!;
    private bool linked;
    public int Drawn=>drawn.Count;
    public override void _Ready(){I=this;together=Together.I!;together.OtherBatch+=Batch;together.RosterChanged+=Roster;if(Menu.MainMenu.I is{} m)m.WorldReplaced+=Replaced;}
    public void Register(object key,string kind,Func<(Vector3 Position,double Yaw,string Motion,bool Carrying)> read)
    {
        Vector3? last=null;double at=0;
        Replication.Register(key,()=>{var s=read();double now=together.ServerNow;double speed=last is{} p&&now>at?new Vector2(s.Position.X-p.X,s.Position.Z-p.Z).Length()/((now-at)/1000):0;bool snap=speed>8;last=s.Position;at=now;return new NativeFigurePose(0,kind,s.Motion,snap,s.Carrying,s.Position.X,s.Position.Y,s.Position.Z,s.Yaw,snap?0:speed);});
    }
    public void Remove(object key)=>Replication.Remove(key);
    private void Batch(byte kind,byte[] data,double arrived){if(kind==4)Replication.Receive(data,arrived);}
    private void Roster(){var ids=together.Roster.Select(r=>r.Id).ToHashSet();foreach(int key in drawn.Keys.Where(k=>!ids.Contains(k/65536)).ToArray()){Replication.DropSender(key/65536);drawn[key].Remove();drawn.Remove(key);}}
    private void Replaced(string _,Net.ClientState? __)=>Reset();
    private void Reset(){Replication.Reset();foreach(var f in drawn.Values)f.Remove();drawn.Clear();}
    public override void _Process(double dt)
    {
        if(!together.Connected){if(linked)Reset();linked=false;return;}linked=true;
        Replication.Send(dt,together.ServerNow,together.SendBinary);
        var rows=Replication.Frame(dt,together.ServerNow);var me=Main.I.Cam.GlobalPosition;
        foreach(var pair in drawn.ToArray())if(!rows.ContainsKey(pair.Key)){pair.Value.Remove();drawn.Remove(pair.Key);}
        foreach(var pair in rows){var s=pair.Value;double distance=Math.Sqrt(Math.Pow(s.X-me.X,2)+Math.Pow(s.Z-me.Z,2));bool exists=drawn.TryGetValue(pair.Key,out var f);
            if(distance>120+(exists?10:0)){if(f!=null){f.Remove();drawn.Remove(pair.Key);}continue;}
            if(f==null)drawn[pair.Key]=f=Folk.MakeFigure(s.Kind,(float)s.X,(float)s.Z,(float)s.Y,remote:true);
            f.Node.Position=new((float)s.X,(float)s.Y,(float)s.Z);f.Node.Rotation=new(0,(float)s.Yaw,0);f.SetMotion(s.Motion,(float)s.Speed,s.Carrying);f.Update((float)dt);
        }
    }
    public override void _ExitTree(){Reset();together.OtherBatch-=Batch;together.RosterChanged-=Roster;if(Menu.MainMenu.I is{} m)m.WorldReplaced-=Replaced;if(I==this)I=null;}
}
