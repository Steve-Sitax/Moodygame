using System;
using System.Buffers.Binary;
using System.Collections.Generic;
using System.Linq;

namespace Scheldemist.Native.Services.Multiplayer;

public sealed record NativeMpState(uint Seq = 0, double T = 0, double X = 0, double Y = 0, double Z = 0,
    double Vx = 0, double Vy = 0, double Vz = 0, double Yaw = 0, double Pitch = 0, int Mode = 0, int Flags = 0,
    int Base = 0, int Gear = 0, double Lx = 0, double Ly = 0, double Lz = 0, double Lyaw = 0);

/// <summary>Protocol 5 byte layout, shared/mpProtocol.ts. Transport preserves accepted payload bytes.</summary>
public static class NativeMpProtocol
{
    public const int LegacyLayoutVersion=5,Version=Scheldemist.Net.Mp.MpProtocol.Protocol,MaxPayload=65536;
    public static NativeMpState? DecodeState(ReadOnlySpan<byte> data) {
        if (data.Length != 68 || data[0] != 1) return null; var b = data[2..]; if (b[0] >= 10) return null;
        double t = BinaryPrimitives.ReadDoubleLittleEndian(b[10..]); if (!double.IsFinite(t)) return null;
        var f = new double[12]; for (int i = 0; i < 12; i++) { f[i] = BinaryPrimitives.ReadSingleLittleEndian(b[(18 + i * 4)..]); if (!double.IsFinite(f[i])) return null; }
        return new(BinaryPrimitives.ReadUInt32LittleEndian(b[6..]), t, f[0], f[1], f[2], f[3], f[4], f[5], f[6], f[7], b[0], BinaryPrimitives.ReadUInt16LittleEndian(b[1..]), BinaryPrimitives.ReadUInt16LittleEndian(b[3..]), b[5], f[8], f[9], f[10], f[11]);
    }
    private static void Write(Span<byte> b, NativeMpState s) {
        b[0] = (byte)s.Mode; BinaryPrimitives.WriteUInt16LittleEndian(b[1..], (ushort)s.Flags); BinaryPrimitives.WriteUInt16LittleEndian(b[3..], (ushort)s.Base); b[5] = (byte)s.Gear; BinaryPrimitives.WriteUInt32LittleEndian(b[6..], s.Seq); BinaryPrimitives.WriteDoubleLittleEndian(b[10..], s.T);
        double[] f = { s.X,s.Y,s.Z,s.Vx,s.Vy,s.Vz,s.Yaw,s.Pitch,s.Lx,s.Ly,s.Lz,s.Lyaw }; for (int i = 0; i < f.Length; i++) BinaryPrimitives.WriteSingleLittleEndian(b[(18 + i * 4)..], (float)f[i]);
    }
    public static byte[] EncodeState(NativeMpState state) { var result = new byte[68]; result[0] = 1; Write(result.AsSpan(2), state); return result; }
    public static byte[] EncodeBatch(long now, IReadOnlyList<(int Id, NativeMpState State)> list) { int n = Math.Min(255,list.Count); var result = new byte[10+n*68]; result[0]=2; result[1]=(byte)n; BinaryPrimitives.WriteDoubleLittleEndian(result.AsSpan(2),now); for(int i=0;i<n;i++) { BinaryPrimitives.WriteUInt16LittleEndian(result.AsSpan(10+i*68),(ushort)list[i].Id); Write(result.AsSpan(12+i*68),list[i].State); } return result; }
    public static bool ValidBatch(ReadOnlySpan<byte> b, int kind) {
        int head = kind == 4 ? 12 : 10, size = kind == 3 ? 24 : kind == 4 ? 22 : 8, max = kind == 3 ? 150 : kind == 4 ? 32 : 200;
        return b.Length >= head && b[0] == kind && b[1] <= max && b.Length == head + b[1]*size && double.IsFinite(BinaryPrimitives.ReadDoubleLittleEndian(b[(kind == 4 ? 4 : 2)..]));
    }
    public static byte[] KeepOwned(byte[] bytes, Func<int,bool> owns) {
        int size = bytes[0] == 3 ? 24 : 8; var keep = Enumerable.Range(0, bytes[1]).Where(i=>owns(BinaryPrimitives.ReadUInt16LittleEndian(bytes.AsSpan(10+i*size)))).ToArray(); var output = new byte[10+keep.Length*size]; Array.Copy(bytes,output,10); output[1]=(byte)keep.Length; for(int i=0;i<keep.Length;i++) Array.Copy(bytes,10+keep[i]*size,output,10+i*size,size); return output;
    }
}
