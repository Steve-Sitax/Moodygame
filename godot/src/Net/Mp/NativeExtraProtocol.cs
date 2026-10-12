using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Net.Mp;

public readonly record struct NativeAnimalPose(double X,double Z,double Yaw,string Motion,bool Snap=false);
public readonly record struct NativeFigurePose(ushort Id,string Kind,string Motion,bool Snap,bool Carrying,double X,double Y,double Z,double Yaw,double Speed);

/// <summary>The original animal and job figure wire format, independent of rendering.</summary>
public static class NativeExtraProtocol
{
    public static readonly string[] Animals={"idle","walk","run","sit","lie","sniff","peck","graze"};
    public static readonly string[] Figures={"stranger","thief","foreman","recipient"};
    public static readonly string[] Motions={"idle","walk","carry","fold","talk"};
    public static double Wrap(double angle)=>Math.Atan2(Math.Sin(angle),Math.Cos(angle));
    private static int R(double n)=>(int)Math.Floor(n+.5);
    private static int Index(string[] list,string item)=>Math.Max(0,Array.IndexOf(list,item));
    private static ushort Angle(double yaw,int quant)=>(ushort)(R((yaw%Math.Tau+Math.Tau)%Math.Tau*quant/Math.Tau)%quant);
    public static byte[] EncodeAnimals(double time,IReadOnlyList<(ushort Number,NativeAnimalPose Pose,bool Dog)> rows)
    {
        int n=Math.Min(200,rows.Count);var data=new byte[10+n*8];data[0]=5;data[1]=(byte)n;BinaryPrimitives.WriteDoubleLittleEndian(data.AsSpan(2),time);
        for(int i=0;i<n;i++){var row=rows[i];var span=data.AsSpan(10+i*8,8);BinaryPrimitives.WriteUInt16LittleEndian(span,row.Number);
            BinaryPrimitives.WriteInt16LittleEndian(span[2..],(short)Math.Clamp(R(row.Pose.X*50),-32767,32767));BinaryPrimitives.WriteInt16LittleEndian(span[4..],(short)Math.Clamp(R(row.Pose.Z*50),-32767,32767));
            span[6]=(byte)Angle(row.Pose.Yaw,256);span[7]=(byte)(Index(Animals,row.Pose.Motion)|(row.Pose.Snap?16:0)|(row.Dog?32:0));}
        return data;
    }
    public static bool ReadAnimals(byte[] data,out double time,out List<(ushort Number,NativeAnimalPose Pose,bool Dog)> rows)
    {
        rows=new();time=0;if(data.Length<10||data[0]!=5||data[1]>200||data.Length!=10+data[1]*8)return false;time=BinaryPrimitives.ReadDoubleLittleEndian(data.AsSpan(2));if(!double.IsFinite(time))return false;
        for(int i=0;i<data[1];i++){var span=data.AsSpan(10+i*8,8);int motion=span[7]&15;rows.Add((BinaryPrimitives.ReadUInt16LittleEndian(span),new(BinaryPrimitives.ReadInt16LittleEndian(span[2..])/50.0,BinaryPrimitives.ReadInt16LittleEndian(span[4..])/50.0,Wrap(span[6]*Math.Tau/256),motion<Animals.Length?Animals[motion]:"idle",(span[7]&16)!=0),(span[7]&32)!=0));}return true;
    }
    public static byte[] EncodeFigures(double time,IReadOnlyList<NativeFigurePose> rows,ushort sender=0)
    {
        int n=Math.Min(32,rows.Count);var data=new byte[12+n*22];data[0]=4;data[1]=(byte)n;BinaryPrimitives.WriteUInt16LittleEndian(data.AsSpan(2),sender);BinaryPrimitives.WriteDoubleLittleEndian(data.AsSpan(4),time);
        for(int i=0;i<n;i++){var s=rows[i];var span=data.AsSpan(12+i*22,22);BinaryPrimitives.WriteUInt16LittleEndian(span,s.Id);span[2]=(byte)Index(Figures,s.Kind);span[3]=(byte)Index(Motions,s.Motion);span[4]=(byte)((s.Snap?1:0)|(s.Carrying?2:0));
            BinaryPrimitives.WriteSingleLittleEndian(span[6..],(float)s.X);BinaryPrimitives.WriteSingleLittleEndian(span[10..],(float)s.Y);BinaryPrimitives.WriteSingleLittleEndian(span[14..],(float)s.Z);BinaryPrimitives.WriteUInt16LittleEndian(span[18..],Angle(s.Yaw,65536));BinaryPrimitives.WriteUInt16LittleEndian(span[20..],(ushort)Math.Clamp(R(s.Speed*100),0,65535));}
        return data;
    }
    public static bool ReadFigures(byte[] data,out ushort sender,out double time,out List<NativeFigurePose> rows)
    {
        rows=new();sender=0;time=0;if(data.Length<12||data[0]!=4||data[1]>32||data.Length!=12+data[1]*22)return false;time=BinaryPrimitives.ReadDoubleLittleEndian(data.AsSpan(4));if(!double.IsFinite(time))return false;sender=BinaryPrimitives.ReadUInt16LittleEndian(data.AsSpan(2));
        for(int i=0;i<data[1];i++){var span=data.AsSpan(12+i*22,22);double x=BinaryPrimitives.ReadSingleLittleEndian(span[6..]),y=BinaryPrimitives.ReadSingleLittleEndian(span[10..]),z=BinaryPrimitives.ReadSingleLittleEndian(span[14..]);if(!double.IsFinite(x)||!double.IsFinite(y)||!double.IsFinite(z))continue;
            rows.Add(new(BinaryPrimitives.ReadUInt16LittleEndian(span),span[2]<Figures.Length?Figures[span[2]]:"stranger",span[3]<Motions.Length?Motions[span[3]]:"idle",(span[4]&1)!=0,(span[4]&2)!=0,x,y,z,Wrap(BinaryPrimitives.ReadUInt16LittleEndian(span[18..])*Math.Tau/65536),BinaryPrimitives.ReadUInt16LittleEndian(span[20..])/100.0));}return true;
    }
    public static double Delay(IReadOnlyList<double> late,double min=200,double max=350)
    {if(late.Count<10)return min;var sorted=late.Order().ToArray();return Math.Clamp(sorted[(int)Math.Floor(sorted.Length*.95)]+110,min,max);}
    public static NativeFigurePose? Sample(IReadOnlyList<(double Time,NativeFigurePose Pose)> rows,double time)
    {
        if(rows.Count==0)return null;int i=0;while(i+1<rows.Count&&rows[i+1].Time<=time)i++;var a=rows[i];if(i+1>=rows.Count||time<=a.Time)return a.Pose;var b=rows[i+1];if(b.Pose.Snap||Math.Sqrt(Math.Pow(b.Pose.X-a.Pose.X,2)+Math.Pow(b.Pose.Z-a.Pose.Z,2))>4)return a.Pose;
        double u=(time-a.Time)/Math.Max(1,b.Time-a.Time);return (u<.5?a.Pose:b.Pose) with{X=a.Pose.X+(b.Pose.X-a.Pose.X)*u,Y=a.Pose.Y+(b.Pose.Y-a.Pose.Y)*u,Z=a.Pose.Z+(b.Pose.Z-a.Pose.Z)*u,Yaw=a.Pose.Yaw+Wrap(b.Pose.Yaw-a.Pose.Yaw)*u,Speed=a.Pose.Speed+(b.Pose.Speed-a.Pose.Speed)*u};
    }
}
