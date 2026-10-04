using System;
using Godot;
using System.Buffers.Binary;
using Scheldemist.Net.Mp;

namespace Scheldemist.Dev;
public partial class EventTest
{
    private void PuppetWire()
    {
        current="puppets";var packet=new byte[34];packet[0]=3;packet[1]=1;BinaryPrimitives.WriteDoubleLittleEndian(packet.AsSpan(2),123456.5);
        var sent=new MpState {T=123456.5,X=-118.25f,Z=36.75f,Yaw=-MathF.PI/2,Vx=1.23f,Vz=-.45f,Mode=26,Gear=4|8};EventPuppets.Write(packet.AsSpan(10),513,sent,1.1f);
        Check(EventPuppets.Valid(packet),"browser-size puppet packet accepted");Check(packet[10]==1&&packet[11]==2&&packet[26]==26&&packet[27]==12&&packet[28]==150,"numeric id, smoke motion, sack/snap flags and size use browser byte offsets");
        Check(EventPuppets.Read(packet.AsSpan(10),sent.T,out ushort id,out var read,out float size)&&id==513&&read.X==sent.X&&read.Z==sent.Z&&Math.Abs(read.Yaw-3*MathF.PI/2)<.001f&&read.Vx==sent.Vx&&read.Vz==sent.Vz&&Math.Abs(size-1.1f)<.001f,"puppet position, heading, velocity and size survive wire round trip");
        Check(!EventPuppets.Valid(packet.AsSpan(0,33)),"truncated puppet packet rejected");BinaryPrimitives.WriteDoubleLittleEndian(packet.AsSpan(2),double.NaN);Check(!EventPuppets.Valid(packet),"nonfinite puppet clock rejected");BinaryPrimitives.WriteSingleLittleEndian(packet.AsSpan(12),float.PositiveInfinity);Check(!EventPuppets.Read(packet.AsSpan(10),sent.T,out _,out _,out _),"nonfinite puppet position rejected");
        var track=new RemoteTrack();track.Push(sent,123456.5);sent.T+=100;sent.X+=10;sent.Flags=MpProtocol.FlagSnap;track.Push(sent,sent.T);var pose=track.Sample(123606.5);Check(pose is {} p&&p.X==-118.25f,"ownership handoff snap prevents interpolation across a teleport");
        rows.Add(new{kind="puppets",checks=7,entryBytes=24,maxActors=150});
        GD.Print("eventtest: puppet wire checked (24 bytes, 150 actors)");
    }
}
