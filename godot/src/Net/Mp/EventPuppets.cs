using System;
using System.Buffers.Binary;

namespace Scheldemist.Net.Mp;

/// <summary>The browser's 24-byte puppet entry, without allocating to read it.</summary>
public static class EventPuppets
{
    public const byte Kind=3;
    public const int Header=10,Entry=24,Max=150;
    public static readonly string[] Motions={"idle","walk","talk","fold","carry","sit","behind","lean","write","ride","row","push","scrub","lace","cross","point","beg","call","crouch","hop","rope","grind","pull","wash","wall","pockets","smoke"};
    public static bool Valid(ReadOnlySpan<byte> bytes)=>bytes.Length>=Header&&bytes[0]==Kind&&bytes[1]<=Max&&bytes.Length==Header+bytes[1]*Entry&&double.IsFinite(BinaryPrimitives.ReadDoubleLittleEndian(bytes[2..]));
    public static bool Read(ReadOnlySpan<byte> entry,double time,out ushort number,out MpState state,out float size)
    {
        number=BinaryPrimitives.ReadUInt16LittleEndian(entry);state=new(){T=time,X=BinaryPrimitives.ReadSingleLittleEndian(entry[2..]),Z=BinaryPrimitives.ReadSingleLittleEndian(entry[6..]),Yaw=BinaryPrimitives.ReadUInt16LittleEndian(entry[10..])*(MathF.Tau/65536),Vx=BinaryPrimitives.ReadInt16LittleEndian(entry[12..])*.01f,Vz=BinaryPrimitives.ReadInt16LittleEndian(entry[14..])*.01f,Mode=entry[16]<Motions.Length?entry[16]:0,Flags=(entry[17]&8)!=0?MpProtocol.FlagSnap:0,Gear=entry[17]};size=.8f+entry[18]/500f;
        return float.IsFinite(state.X)&&float.IsFinite(state.Z)&&Math.Abs(state.X)<2000&&Math.Abs(state.Z)<2000;
    }
    public static void Write(Span<byte> entry,ushort number,in MpState state,float size)
    {
        entry.Clear();BinaryPrimitives.WriteUInt16LittleEndian(entry,number);BinaryPrimitives.WriteSingleLittleEndian(entry[2..],state.X);BinaryPrimitives.WriteSingleLittleEndian(entry[6..],state.Z);
        BinaryPrimitives.WriteUInt16LittleEndian(entry[10..],(ushort)(Math.Round((state.Yaw%MathF.Tau+MathF.Tau)%MathF.Tau*65536/MathF.Tau)%65536));
        BinaryPrimitives.WriteInt16LittleEndian(entry[12..],(short)Math.Clamp(Math.Round(state.Vx*100),-32767,32767));BinaryPrimitives.WriteInt16LittleEndian(entry[14..],(short)Math.Clamp(Math.Round(state.Vz*100),-32767,32767));entry[16]=(byte)Math.Clamp(state.Mode,0,Motions.Length-1);entry[17]=(byte)state.Gear;entry[18]=(byte)Math.Clamp(Math.Round((size-.8)*500),0,255);
    }
}
