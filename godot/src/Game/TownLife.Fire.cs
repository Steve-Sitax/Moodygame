using System;
using System.Collections.Generic;
using System.Text.Json;
using Godot;
using Scheldemist.Net;
using Scheldemist.Render;
using Scheldemist.Town;

namespace Scheldemist.Game;

public partial class TownLife
{
    private sealed class Soot
    {
        public int Event;
        public bool Seen;
        public MeshInstance3D Node = null!;
        public ShaderMaterial Material = null!;
        public float Opacity;
    }
    private readonly List<Soot> sootPool = new(64);
    private TownLifeData? life;
    private double lifePoll;
    private bool lifePolling;
    public int SootCount { get { int n = 0; foreach (var s in sootPool) if (s.Event != 0) n++; return n; } }
    public int ChainHands { get; private set; }
    public float SootOpacity(int id) { foreach (var s in sootPool) if (s.Event == id) return s.Opacity; return 0; }
    private void PrepareSoot()
    {
        // A deterministic smoke texture, made once. Three window columns streak up the front.
        var image = Image.CreateEmpty(64, 128, false, Image.Format.Rgba8);
        for (int y = 0; y < 128; y++) for (int x = 0; x < 64; x++)
        {
            float a = 0.12f + 0.38f * (1 - y / 128f);
            foreach (int cx in new[] { 14, 32, 50 })
            {
                float spread = Math.Max(0, 1 - Math.Abs(x - cx + MathF.Sin(y * 0.17f + cx) * 3) / 9);
                a = Math.Min(0.95f, a + spread * (0.15f + 0.25f * MathF.Abs(MathF.Sin(x * 7 + y * 0.03f))));
            }
            a = Math.Max(a, 0.95f * Math.Max(0, 1 - y / 50f));
            image.SetPixel(x, y, new Color(10 / 255f, 8 / 255f, 6 / 255f, a));
        }
        var texture = ImageTexture.CreateFromImage(image);
        var shader = Psx.ShaderOf(new Psx.Kind(Unlit: false, Blend: true, Scissor: false, TwoSided: false, DepthWrite: false, Snap: true, Atlas: 0, VertexColor: false, Add: false, Fog: true));
        for (int i = 0; i < 64; i++)
        {
            var m = new ShaderMaterial { Shader = shader };
            m.SetShaderParameter("albedo", new Color(1, 1, 1, 0)); m.SetShaderParameter("tex", texture); m.SetShaderParameter("affine", 0.3f);
            var node = new MeshInstance3D { Name = "soot_" + i, Mesh = new QuadMesh { Size = Vector2.One, Material = m }, Visible = false, CastShadow = GeometryInstance3D.ShadowCastingSetting.Off };
            Main.I.View.AddChild(node); sootPool.Add(new Soot { Node = node, Material = m });
        }
    }
    public void ApplyLife(TownLifeData data) { life = data; SetRounds(data.Rounds); }
    private void PollLife(double delta)
    {
        if (ServerLink.I?.Api is not { } api || lifePolling || (lifePoll -= delta) > 0) return;
        lifePolling = true; lifePoll = 10;
        api.Run(api.TownLife(), reply => { lifePolling = false; var data = reply.Deserialize<TownLifeData>(Api.Json); if (data != null) ApplyLife(data); }, _ => lifePolling = false);
    }
    private void SetSoot(int id, double[] door, double[] outward, int storeys, float opacity)
    {
        Soot? found = null;
        foreach (var s in sootPool) if (s.Event == id) { found = s; break; }
        if (found == null) foreach (var s in sootPool) if (s.Event == 0) { found = s; s.Event = id; break; }
        if (found == null) return;
        float h = 3.8f + 3 * (Math.Clamp(storeys, 2, 5) - 1) + 1;
        found.Seen = true; bool changed = found.Opacity != opacity; found.Opacity = opacity;
        found.Node.Position = new Vector3((float)(door[0] + outward[0] * 0.06), h / 2, (float)(door[1] + outward[1] * 0.06));
        found.Node.Rotation = new Vector3(0, (float)Math.Atan2(outward[0], outward[1]), 0); found.Node.Scale = new Vector3(6.4f, h, 1);
        if (changed) found.Material.SetShaderParameter("albedo", new Color(1, 1, 1, opacity)); found.Node.Visible = true;
    }
    private void DrawSoot()
    {
        if (life != null) foreach (var s in life.Soot)
        {
            bool burning = false; foreach (var f in fires) if (f.Id == s.Event) { burning = true; break; }
            if (!burning) SetSoot(s.Event, s.Door, s.Out, s.Storeys, 0.85f * Math.Max(0, 1 - (life.Day - s.Day) / 3f) + 0.05f);
        }
        foreach (var s in sootPool)
        {
            if (!s.Seen) { s.Event = 0; s.Opacity = 0; s.Node.Visible = false; }
            s.Seen = false;
        }
    }
    private void ResetLife()
    {
        life = null; lifePoll = 0;
        foreach (var s in sootPool) { s.Event = 0; s.Seen = false; s.Node.Visible = false; }
        DropRounds();
    }
    private int Chain(FireLive f, int eventId, string act, int count, double delta)
    {
        var v = f.View; var crowd = town!.Crowd!; Array.Clear(f.Hands);
        if (Actors.I != null) foreach (var r in Actors.I.Runs)
        {
            var a = r.Action;
            if (a.EventId != eventId || a.Role != "chain" || r.Person?.P is not { } p) continue;
            int k = -1;
            for (int i = 0; i < v.Chain.Count && i < 64; i++) if (Math.Abs(v.Chain[i][0] - (a.TargetX ?? double.MaxValue)) < 0.05 && Math.Abs(v.Chain[i][1] - (a.TargetZ ?? double.MaxValue)) < 0.05) { k = i; break; }
            if (k < 0) continue;
            double sx = v.Chain[k][0], sz = v.Chain[k][1], d = Whereabouts.Hypot(p.X - sx, p.Z - sz);
            bool owned = Actors.I.NpcOwned(a.Npc);
            if (!owned) { f.Hands[k] = new Vector2((float)p.X, (float)p.Z); continue; }
            bool hidden = crowd.IsHidden(p.X, p.Z) && crowd.IsHidden(sx, sz);
            if (crowd.PuppetBusy(p)) { if (d > 6 && hidden && crowd.CanStand(sx, sz)) { p.X = sx; p.Z = sz; } else continue; }
            else if (d > 4) { if (hidden && crowd.CanStand(sx, sz)) { p.X = sx; p.Z = sz; } else { if (r.Retry <= 0) { crowd.PuppetGo(p, sx, sz, 1.6); r.Retry = 6; } continue; } }
            else if (d > 0.08)
            {
                double step = Math.Min(d, 1.2 * delta), nx = p.X + (sx - p.X) / d * step, nz = p.Z + (sz - p.Z) / d * step;
                if (crowd.CanStand(nx, nz)) { p.X = nx; p.Z = nz; }
            }
            f.Hands[k] = new Vector2((float)p.X, (float)p.Z);
            int iSlot = k < v.Full ? k : k - v.Full, opposite = k < v.Full ? v.Full + iSlot : iSlot;
            double tx = act == "fire_down" || opposite >= v.Chain.Count ? v.Step[0] : v.Chain[opposite][0], tz = act == "fire_down" || opposite >= v.Chain.Count ? v.Step[1] : v.Chain[opposite][1];
            double yaw = Math.Atan2(tx - p.X, tz - p.Z); string motion = act == "fire_chain" ? "carry" : "idle";
            if (p.Human.Motion != motion || Math.Abs(Math.Atan2(Math.Sin(p.Yaw - yaw), Math.Cos(p.Yaw - yaw))) > 0.3) crowd.PuppetStand(p, motion, yaw);
        }
        if (v.Jef is { In: true } jef && jef.Slot < 64 && Scheldemist.Player.Jef.I is { } j) f.Hands[jef.Slot] = new Vector2(j.X, j.Z);
        f.FullHands.Clear(); f.BackHands.Clear(); ChainHands = 0;
        for (int i = 0; i < v.Chain.Count && i < 64; i++) if (f.Hands[i] is { } h) { ChainHands++; if (i < v.Full) f.FullHands.Add(h); }
        for (int i = Math.Min(63, v.Chain.Count - 1); i >= v.Full; i--) if (f.Hands[i] is { } h) f.BackHands.Add(h);
        if (act != "fire_chain") return count;
        void Put(List<Vector2> line, int spacing)
        {
            if (line.Count < 2) return;
            for (int i = 0; i < line.Count && count < 64; i += spacing)
            {
                double u = (clock / 0.7 + i) % (line.Count - 1); int at = (int)u; float fraction = (float)(u - at);
                var pos = line[at].Lerp(line[at + 1], fraction);
                buckets.SetInstanceTransform(count++, new Transform3D(Basis.Identity, new Vector3(pos.X, (float)town.Walk!.BaseAt(pos.X, pos.Y) + 0.95f + MathF.Sin(fraction * MathF.PI) * 0.12f, pos.Y)));
            }
        }
        Put(f.FullHands, 2); Put(f.BackHands, 3); return count;
    }
}
