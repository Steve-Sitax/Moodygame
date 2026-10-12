using System;
using System.Buffers;
using System.Buffers.Binary;
using System.IO.Compression;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace Scheldemist.Net.Mp;

/// <summary>Native protocol 6 world state, Brotli encoded within fixed expansion bounds.</summary>
public static class NativeWorldPacket
{
    public const byte Kind=64,Version=1;
    public const int Header=14,MaxFrame=65536,MaxExpanded=512*1024;
    public static byte[]? Encode(double time,JsonObject state)
    {
        if(!double.IsFinite(time))return null;byte[] json=JsonSerializer.SerializeToUtf8Bytes(state);
        if(json.Length>MaxExpanded)return null;byte[] buffer=ArrayPool<byte>.Shared.Rent(MaxFrame);
        try{if(!BrotliEncoder.TryCompress(json,buffer.AsSpan(Header,MaxFrame-Header),out int n,4,20))return null;
            buffer[0]=Kind;buffer[1]=Version;BinaryPrimitives.WriteInt32LittleEndian(buffer.AsSpan(2),json.Length);BinaryPrimitives.WriteDoubleLittleEndian(buffer.AsSpan(6),time);return buffer.AsSpan(0,Header+n).ToArray();}
        finally{ArrayPool<byte>.Shared.Return(buffer);}
    }
    public static bool TryDecode(ReadOnlySpan<byte> frame,out double time,out JsonObject? state)
    {
        time=0;state=null;if(frame.Length<=Header||frame.Length>MaxFrame||frame[0]!=Kind||frame[1]!=Version)return false;
        int length=BinaryPrimitives.ReadInt32LittleEndian(frame[2..]);time=BinaryPrimitives.ReadDoubleLittleEndian(frame[6..]);
        if(length<2||length>MaxExpanded||!double.IsFinite(time))return false;
        byte[] buffer=ArrayPool<byte>.Shared.Rent(length);
        try{using var decoder=new BrotliDecoder();var status=decoder.Decompress(frame[Header..],buffer.AsSpan(0,length),out int read,out int written);if(status!=OperationStatus.Done||read!=frame.Length-Header||written!=length)return false;
            try{state=JsonNode.Parse(buffer.AsSpan(0,written)) as JsonObject;return state!=null;}catch(JsonException){return false;}}
        finally{ArrayPool<byte>.Shared.Return(buffer);}
    }
}
