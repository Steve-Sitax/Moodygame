using System;
using System.Collections.Generic;
using Godot;
using Scheldemist.Render;

namespace Scheldemist.World;

/// <summary>
/// The planar mirrors (the browser's world/mirror.ts): the river's (the quays, the ships and the sky in the water,
/// at the level of the water nearest the eye: the river, the dock or the lock) and the puddles' (the street in the
/// water on the paving, a plane at the street's level). Each is a small viewport inside the world's own, with a
/// camera mirrored in the plane, seeing the same world; the psx material finds its picture by the world point
/// (psx_water_mirror, psx_mirror and their matrices). What lies under a mirror's plane is not drawn in it: the psx
/// material leaves it out when the camera is that mirror's (psx_mir0, psx_mir1: Godot's camera has no slanted near
/// plane). The browser's sizes: 320 x 180 at 270 lines, grown with the render height; the river's picture 1.5 times
/// bigger with 12 degrees of margin and drawn every second frame, the puddles' every frame and 50 m far.
/// Not shown in a mirror: its own surface (the water; the paving with puddles), the rain (Mirrors.NoMirror).
/// </summary>
[GamePart(60)]
public partial class Mirrors : Node
{
    /// <summary>The water's sheets: not drawn in the river's mirror.</summary>
    public const uint WaterLayer = 1u << 9;
    /// <summary>The paving that holds puddles: not drawn in the puddles' mirror.</summary>
    public const uint GroundLayer = 1u << 10;
    /// <summary>Things no mirror shows (drawn round the eye: the rain, the great storm's spray).</summary>
    public const uint NoMirror = 1u << 11;
    private const uint All = 0xFFFFF;

    private sealed class Mirror
    {
        public string Name = "";
        public string On = "", Matrix = "";
        public SubViewport View = null!;
        public Camera3D Cam = null!;
        public float PlaneY, Far, Grow = 1, Margin;
        public bool EveryFrame;
        public int LastFrame = -10;
        public Vector3 LastEye, LastLook;
        public float LastPlane = float.NaN;
    }

    private Mirror river = null!, puddles = null!;
    /// <summary>The Stadspark pond's water (shared/parkGeometry.ts POND_LEVEL).</summary>
    public const float PondLevel = -0.35f;
    private int frame;
    // the settings' reflections: full, coarse (half the picture's size each way) or off
    private string quality = "full";
    // dev, to measure: --mirror-off river,puddles draws no picture for those (the water shows the sky's grey)
    private readonly string offList = Main.I.Arg("mirror-off");

    /// <summary>Dev: how many pictures each mirror drew.</summary>
    public (int river, int puddles) Drawn;

    public override void _Ready()
    {
        ProcessPriority = 80; // after the camera, the daylight and the water have moved
        quality = Menu.Prefs.Str("reflections");
        Menu.Prefs.Changed += _ => quality = Menu.Prefs.Str("reflections");
        Psx.EnsureGlobals();
        river = Make("water", 160, 1.5f, Mathf.DegToRad(12), false, All & ~WaterLayer & ~NoMirror & ~Rooms.RoomLayer);
        puddles = Make("puddles", 50, 1, 0, true, All & ~GroundLayer & ~NoMirror & ~Rooms.RoomLayer);
        Psx.Set("psx_water_mirror", river.View.GetTexture().GetRid());
        Psx.Set("psx_mirror", puddles.View.GetTexture().GetRid());
        // the surfaces: the water's sheets (Waters made the river's), the paving that holds puddles
        foreach (var n in BakedWorld.All(Main.I.View))
        {
            if (n is not MeshInstance3D mi || mi.Mesh == null || mi.Mesh.GetSurfaceCount() == 0) continue;
            var m = (mi.GetSurfaceOverrideMaterial(0) ?? mi.Mesh.SurfaceGetMaterial(0)) as ShaderMaterial;
            if (m == null) continue;
            if (m.HasMeta("psx_water")) mi.Layers = WaterLayer;
            else if (m.GetShaderParameter("puddles").VariantType != Variant.Type.Nil && m.GetShaderParameter("puddles").AsSingle() > 0) mi.Layers = GroundLayer;
        }
    }

    private Mirror Make(string name, float far, float grow, float margin, bool everyFrame, uint mask)
    {
        var vp = new SubViewport { Name = "mirror_" + name, RenderTargetUpdateMode = SubViewport.UpdateMode.Disabled, Msaa3D = Viewport.Msaa.Disabled, HandleInputLocally = false, Size = new Vector2I(320, 180) };
        // (inside the world's viewport: it sees the same world and is drawn before it)
        Main.I.View.AddChild(vp);
        var cam = new Camera3D { Name = "mirror_cam_" + name, CullMask = mask, KeepAspect = Camera3D.KeepAspectEnum.Height };
        vp.AddChild(cam);
        cam.Current = true;
        string uniform = name == "water" ? "psx_water_mirror" : "psx_mirror";
        return new Mirror { Name = name, On = uniform + "_on", Matrix = uniform + "_mat", View = vp, Cam = cam, Far = far, Grow = grow, Margin = margin, EveryFrame = everyFrame };
    }

    // where the water lies, every 4 m over the town (shared/city.json through Water.In), made once
    private const float GridX0 = -480, GridZ0 = -80, GridCell = 4;
    private const int GridW = 205, GridH = 140;
    private bool[]? waterGrid;

    private bool WaterAt(float x, float z)
    {
        if (waterGrid == null)
        {
            waterGrid = new bool[GridW * GridH];
            for (int j = 0; j < GridH; j++)
                for (int i = 0; i < GridW; i++)
                    waterGrid[j * GridW + i] = Water.In(GridX0 + (i + 0.5f) * GridCell, GridZ0 + (j + 0.5f) * GridCell);
        }
        int ci = (int)MathF.Floor((x - GridX0) / GridCell), cj = (int)MathF.Floor((z - GridZ0) / GridCell);
        // (past the town's edge on the river's side: the open river)
        if (ci < 0 || cj < 0 || ci >= GridW || cj >= GridH) return z < GridZ0;
        return waterGrid[cj * GridW + ci];
    }

    /// <summary>
    /// Is some water inside the fog and in the view (every 4 m round the eye)? With none, the river's mirror is not
    /// drawn: on a square where the houses hide all water it would draw the town a second time for nothing.
    /// </summary>
    private bool WaterInView(Camera3D cam)
    {
        var eye = cam.GlobalPosition;
        var look = -cam.GlobalTransform.Basis.Z;
        var flat = new Vector2(look.X, look.Z);
        // (looking steeply up or down the view covers every way round)
        bool any = flat.Length() < 0.35f;
        flat = flat.Normalized();
        float half = Mathf.DegToRad(cam.Fov / 2) * 1.9f + Mathf.DegToRad(14);
        float cos = MathF.Cos(Math.Min(MathF.PI, half));
        float r = Math.Min(172, Daylight.I.FogFar + 12);
        for (float dx = -r; dx <= r; dx += 4)
            for (float dz = -r; dz <= r; dz += 4)
            {
                float d2 = dx * dx + dz * dz;
                if (d2 > r * r) continue;
                if (!any && d2 > 64 && (dx * flat.X + dz * flat.Y) < cos * MathF.Sqrt(d2)) continue;
                if (WaterAt(eye.X + dx, eye.Z + dz)) return true;
            }
        return false;
    }

    public override void _Process(double delta)
    {
        using var frameCost = Scheldemist.Dev.FrameCost.Track("Mirrors");
        var view = Main.I.View;
        var cam = view.GetCamera3D();
        if (cam == null || Daylight.I == null) return;
        frame++;
        var eye = cam.GlobalPosition;
        // the river's mirror lies in the water nearest the eye (the river, the dock or the lock)
        bool inLock = eye.X > 100 - 6 && eye.X < 120 + 6 && eye.Z > 7 - 4 && eye.Z < 42;
        bool nearDock = eye.X > 62 - 25 && eye.X < 178 + 25 && eye.Z > 42 - 10 && eye.Z < 118 + 25;
        // (in the Stadspark: the pond's, which lies above the tide, drawn every frame and 110 m far)
        bool pond = eye.X > -395 && eye.X < -215 && eye.Z > 245 && eye.Z < 380;
        river.PlaneY = pond ? PondLevel : inLock ? (Tide.ChamberA + Tide.ChamberB) / 2 : nearDock ? Tide.Dock : Waters.Level;
        river.EveryFrame = pond;
        river.Far = pond ? 110 : 160;
        puddles.PlaneY = 0;
        // (the great storm's torn-up water mirrors nothing: no picture drawn then)
        bool calm = Daylight.I.Sea < 5.6f;
        if (quality == "off") calm = false; // (the settings: no second drawing of the town; the water shows the air's colour)
        Draw(river, cam, view, !offList.Contains("river") && calm && (pond || WaterInView(cam)), "psx_water_mirror", "psx_mir0", ref Drawn.river);
        Draw(puddles, cam, view, !offList.Contains("puddles") && calm && Daylight.I.Puddle > 0.01f, "psx_mirror", "psx_mir1", ref Drawn.puddles);
    }

    private void Draw(Mirror m, Camera3D cam, SubViewport view, bool on, string name, string clip, ref int count)
    {
        var eye = cam.GlobalPosition;
        if (!on || eye.Y <= m.PlaneY + 0.02f)
        {
            Psx.Set(m.On, 0f);
            m.LastFrame = -10;
            return;
        }
        var basis = cam.GlobalTransform.Basis;
        var look = -basis.Z;
        // mirrors take turns: one drawn every second frame keeps its picture (and that picture's matrix) in between,
        // unless it was not drawn the frame before, the eye moved half a metre or turned 4 degrees, or the plane moved
        if (!m.EveryFrame && m.LastFrame == frame - 1 && MathF.Abs(m.LastPlane - m.PlaneY) < 0.005f && m.LastEye.DistanceSquaredTo(eye) < 0.25f && m.LastLook.Dot(look) > 0.99756f) return;
        m.LastFrame = frame;
        m.LastPlane = m.PlaneY;
        m.LastEye = eye;
        m.LastLook = look;
        count++;

        // the picture grows with the render height (320 x 180 at 270 lines), as wide as the view
        float scale = Mathf.Clamp(view.Size.Y / 270f, 1, 4) * m.Grow * (quality == "coarse" ? 0.5f : 1);
        int h = (int)MathF.Round(180 * scale);
        var size = new Vector2I(Math.Max(16, (int)MathF.Round(h * (float)view.Size.X / Math.Max(1, view.Size.Y))), h);
        if (m.View.Size != size) m.View.Size = size;
        // the eye, where it looks and its up, mirrored in the plane
        var mEye = new Vector3(eye.X, 2 * m.PlaneY - eye.Y, eye.Z);
        var to = eye + look;
        var up = basis.Y;
        m.Cam.LookAtFromPosition(mEye, new Vector3(to.X, 2 * m.PlaneY - to.Y, to.Z), new Vector3(up.X, -up.Y, up.Z));
        float near = cam.Near, far = Math.Min(cam.Far, m.Far);
        if (!UniformUpdates.Cached || m.Cam.Near != near) m.Cam.Near = near;
        if (!UniformUpdates.Cached || m.Cam.Far != far) m.Cam.Far = far;
        // (a picture a frame old still covers the water after a turn: a margin on every side)
        float fov = Mathf.RadToDeg(2 * Math.Min(1.45f, Mathf.DegToRad(cam.Fov / 2) + m.Margin));
        if (!UniformUpdates.Cached || m.Cam.Fov != fov) m.Cam.Fov = fov;
        m.View.RenderTargetUpdateMode = SubViewport.UpdateMode.Once;
        // world -> the picture (the psx material takes x and y over w, halves them and turns y)
        var vp = m.Cam.GetCameraProjection() * new Projection(m.Cam.GlobalTransform.AffineInverse());
        Psx.Set(m.Matrix, vp);
        Psx.Set(m.On, 1f);
        Psx.Set(clip, new Vector4(mEye.X, mEye.Y, mEye.Z, m.PlaneY));
    }
}
