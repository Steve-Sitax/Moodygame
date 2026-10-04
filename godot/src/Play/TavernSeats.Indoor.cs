using System;
using System.Collections.Generic;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Talks;
using Scheldemist.Windows;
namespace Scheldemist.Play;
public partial class TavernSeats
{
    private bool chatterBusy;
    private double chatClock=20,lineClock;
    private List<IndoorLine>? tableLines;
    private int tableLine;
    private Room? talkingRoom;
    public int TableLinesShown { get; private set; }
    private Room? ChatterRoom()
    {
        if(Sitting is {} s)return s.Room;
        foreach(var r in Rooms)if(r.Open&&MathF.Abs(Jef.I.Y-r.Origin.Y)<.6f){float dx=Jef.I.X-r.Origin.X,dz=Jef.I.Z-r.Origin.Z;var local=new Vector2(dx*MathF.Cos(r.Yaw)-dz*MathF.Sin(r.Yaw),dx*MathF.Sin(r.Yaw)+dz*MathF.Cos(r.Yaw));if(r.Bounds.HasPoint(local))return r;}return null;
    }
    private void UpdateChatter(double dt)
    {
        var room=ChatterRoom();if(room==null){tableLines=null;talkingRoom=null;return;}
        if(tableLines!=null && talkingRoom==room)
        {
            if((lineClock-=dt)>0)return;
            if(tableLine>=tableLines.Count){tableLines=null;return;}
            var line=tableLines[tableLine++];
            if(town?.Indoors is {} indoors)foreach(var h in indoors.Houses)if(h.Id==talkingRoom.Id&&h.Figures.TryGetValue(line.Who,out var f))
            {Bubbles.I?.Say(()=>IsInstanceValid(f.Group)?f.Group.GlobalPosition+Vector3.Up*1.15f:Vector3.Zero,line.Name,line.Text);TableLinesShown++;break;}
            lineClock=Math.Clamp(2.6+line.Text.Length/38.0,2.6,5.5);return;
        }
        if((chatClock-=dt)<=0){chatClock=38;if(!Talk.I!.IsOpen && Dialogs.I!.Top==null)_ = Overhear(false);}
    }
    public async Task Overhear(bool gossip)
    {
        if(chatterBusy||tableLines!=null||ChatterRoom() is not {} room||ServerLink.I?.Api is not {} api)return;
        Seat? first=null,second=null;float one=float.MaxValue,two=float.MaxValue;
        foreach(var q in room.Seats)if(q.Occupant!=null&&HasFigure(room.Id,q.Occupant.Id))
        {float d=new Vector2(q.At.X-Jef.I.X,q.At.Z-Jef.I.Z).Length()-(q.Table==Sitting?.Table?3:0);if(d<one){second=first;two=one;first=q;one=d;}else if(d<two){second=q;two=d;}}
        if(!gossip)foreach(var a in room.Seats)if(a.Occupant!=null&&HasFigure(room.Id,a.Occupant.Id)){foreach(var b in room.Seats)if(b!=a&&b.Table==a.Table&&b.Occupant!=null&&HasFigure(room.Id,b.Occupant.Id)){first=a;second=b;break;}if(second!=null&&second.Table==first?.Table)break;}
        if(first?.Occupant==null||second?.Occupant==null)return;
        chatterBusy=true;int g=generation;
        try{var talk=await api.IndoorTalk(room.Id,first.Occupant.Id,second.Occupant.Id,gossip);if(dead||g!=generation||ChatterRoom()!=room)return;tableLines=talk.Lines;tableLine=0;lineClock=0;talkingRoom=room;}
        catch(ApiException){chatClock=Math.Min(chatClock,2);}finally{chatterBusy=false;}
    }
}
