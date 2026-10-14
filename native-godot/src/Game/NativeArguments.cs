using System;
using Godot;
namespace Scheldemist.Native.Game;
public static class NativeArguments
{
    public static string Arg(string key,string fallback="")
    {
        var args=OS.GetCmdlineUserArgs();int i=Array.IndexOf(args,"--"+key);
        return i>=0&&i+1<args.Length&&!args[i+1].StartsWith("--")?args[i+1]:fallback;
    }
}
