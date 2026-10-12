using Godot;
using Scheldemist.Native.Game;

[Tool]
public partial class NativeGameGlobalsPlugin : EditorPlugin
{
    public override void _EnterTree() => NativeGlobals.Ensure();
}
