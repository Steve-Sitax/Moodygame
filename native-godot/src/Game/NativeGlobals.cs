using Godot;
using Scheldemist.Render;

namespace Scheldemist.Native.Game;

public static class NativeGlobals
{
    private static bool made;
    public static void Ensure()
    {
        if (made) return;
        made = true;
        void Add(string name, RenderingServer.GlobalShaderParameterType type, Variant value)
        { if (!ProjectSettings.HasSetting("shader_globals/" + name)) RenderingServer.GlobalShaderParameterAdd(name, type, value); }
        Add("psx_snap_res", RenderingServer.GlobalShaderParameterType.Vec2, new Vector2(100000, 100000));
        Add("psx_fog_color", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0.55f, 0.58f, 0.6f, 1));
        Add("psx_fog_near", RenderingServer.GlobalShaderParameterType.Float, 20f);
        Add("psx_fog_far", RenderingServer.GlobalShaderParameterType.Float, 160f);
        Add("psx_hemi_sky", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0.2f, 0.25f, 0.3f, 1));
        Add("psx_hemi_ground", RenderingServer.GlobalShaderParameterType.Vec4, new Vector4(0.02f, 0.02f, 0.015f, 1));
        Add("psx_time", RenderingServer.GlobalShaderParameterType.Float, 0f);
        Psx.EnsureGlobals();
    }
}
