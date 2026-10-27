using System;
using System.Threading.Tasks;
using Godot;

namespace Scheldemist.World;

/// <summary>
/// The churches' window glass, drawn once at the start (2048 px, the same every run): the bake's glass was one 32 x 96 px
/// cell of a 256 px atlas, its stone surround painted in, stretched over windows up to 5 m by 18 m (Codex's review of the
/// glass, 2026-10-27: blurry diamond mesh, scattered squares, one crude roundel everywhere, glowing painted rims).
/// Nine columns of 192 px, each one light's worth of glass a little over a metre wide (ChurchGlass lays them on the windows
/// at their true size, never stretched), and on the right six round windows of 320 px:
/// - columns 0-5, stained glass: a border band, then 256 px panels, each a medallion (a roundel, a quatrefoil, a lozenge
///   or a pointed oval) with a rim, eight leaded petals and a boss, on a diaper ground; a band and a heavy saddle bar
///   between panels; each column its own colours (ruby #8F2430, cobalt #244A88, amber #C58A37 as the night reference);
/// - column 6, Sint-Carolus's plain glass: blue-grey diamond quarries (#75858D to #A1B1BA), each pane a little different;
/// - column 7, the parish churches' plain windows: pale leaded rectangles in a coloured border;
/// - column 8, the cathedral's plain windows: grisaille diamonds with a painted dot, a gold border;
/// - roses 0-3 coloured, 4-5 Sint-Carolus's blue-grey.
/// Two pictures of the same leading: the colour the light shows through it (lit from behind: the emission), and its face
/// from the side the light falls on (dark, slate and muted colour, each pane catching the sky a little differently: the
/// albedo). Lead #0E0F10 through, #222426 on the face.
/// </summary>
public static class ChurchGlassArt
{
    public const int Size = 2048, ColW = 192, Columns = 9, RoseX = 1728, RoseCell = 320, Panel = 256;
    public const int Plain = 6, PlainWarm = 7, PlainCathedral = 8, PlainRose = 4;

    private static readonly Vector3 Ruby = Hex(0x8F2430), RubyDeep = Hex(0x6A1A27), Cobalt = Hex(0x244A88), CobaltDeep = Hex(0x1B3768),
        Amber = Hex(0xC58A37), Gold = Hex(0xCFA445), Green = Hex(0x56703A), Purple = Hex(0x553A68), Grisaille = Hex(0x8A8672),
        GrisGreen = Hex(0x7C8670), Pale = Hex(0xA1B1BA), Mid = Hex(0x75858D), Warm = Hex(0xA8A286), Slate = Hex(0x485767);
    private static readonly Vector3 LeadThrough = Hex(0x0E0F10), LeadFace = Hex(0x222426);

    /// <summary>A stained column's colours: its ground (and the ground's odd quarry), the medallions' rim, field, petals and
    /// boss, the border's two.</summary>
    private readonly record struct Scheme(Vector3 Ground, Vector3 Odd, Vector3 Rim, Vector3 Field, Vector3 Petal, Vector3 Boss, Vector3 BorderA, Vector3 BorderB);

    private static readonly Scheme[] Schemes =
    {
        new(Cobalt, Ruby, Amber, Ruby, RubyDeep, Gold, Ruby, Amber),
        new(Grisaille, Amber, Ruby, Cobalt, CobaltDeep, Amber, Cobalt, Amber),
        new(RubyDeep, Cobalt, Gold, Cobalt, Green, Amber, Cobalt, Gold),
        new(GrisGreen, Ruby, Cobalt, Ruby, Amber, Gold, Ruby, Green),
        new(CobaltDeep, Gold, Gold, Green, Ruby, Ruby, Ruby, Amber),
        new(Purple, Amber, Amber, Cobalt, Ruby, Ruby, Amber, Cobalt),
    };

    private static Vector3 Hex(int h) => new(((h >> 16) & 255) / 255f, ((h >> 8) & 255) / 255f, (h & 255) / 255f);

    /// <summary>The two pictures (colour through, face), with their mipmaps.</summary>
    public static (ImageTexture colour, ImageTexture face) Build()
    {
        var through = new byte[Size * Size * 3];
        var face = new byte[Size * Size * 3];
        Parallel.For(0, Size, y =>
        {
            for (int x = 0; x < Size; x++)
            {
                Vector3 c;
                float lead;
                uint pane;
                if (x < Columns * ColW) Column(x / ColW, x % ColW + 0.5f, y + 0.5f, out c, out lead, out pane);
                else if (x >= RoseX && y < 6 * RoseCell) Rose(y / RoseCell, x - RoseX + 0.5f, y % RoseCell + 0.5f, out c, out lead, out pane);
                else { c = Mid; lead = 1; pane = 0; }
                float r = Rand(pane), r2 = Rand(pane * 7919u + 13u);
                // (the glass's own unevenness: a pane a little lighter or darker, gentle streaks through it)
                float ripple = 1 + 0.045f * MathF.Sin(0.19f * x + 0.07f * y + 6.28f * r) + 0.03f * MathF.Sin(0.05f * x - 0.12f * y + 3.1f * r2);
                var col = c * ((0.92f + 0.16f * r) * ripple);
                var thr = col.Lerp(LeadThrough, lead);
                // its face: slate with a little of its colour, each pane taking the sky at its own slant
                var fc = Slate.Lerp(c * 0.6f, 0.38f) * (0.72f + 0.5f * r2) * (1 + 0.6f * (ripple - 1));
                var fac = fc.Lerp(LeadFace, lead);
                int o = (y * Size + x) * 3;
                Put(through, o, thr);
                Put(face, o, fac);
            }
        });
        return (Texture(through), Texture(face));
    }

    private static ImageTexture Texture(byte[] data)
    {
        var img = Image.CreateFromData(Size, Size, false, Image.Format.Rgb8, data);
        img.GenerateMipmaps();
        return ImageTexture.CreateFromImage(img);
    }

    private static void Put(byte[] b, int o, Vector3 c)
    {
        b[o] = (byte)Math.Clamp((int)(c.X * 255 + 0.5f), 0, 255);
        b[o + 1] = (byte)Math.Clamp((int)(c.Y * 255 + 0.5f), 0, 255);
        b[o + 2] = (byte)Math.Clamp((int)(c.Z * 255 + 0.5f), 0, 255);
    }

    private static float Rand(uint h)
    {
        h ^= h >> 16; h *= 0x7feb352d; h ^= h >> 15; h *= 0x846ca68b; h ^= h >> 16;
        return (h & 0xffffff) / (float)0x1000000;
    }

    private static uint Id(int a, int b, int c) => (uint)(a * 73856093) ^ (uint)(b * 19349663) ^ (uint)(c * 83492791);

    /// <summary>How much of a lead line of this half width covers a pixel this far from its middle (smooth over a pixel).</summary>
    private static float Lead(float dist, float half) => Math.Clamp(half + 0.5f - MathF.Abs(dist), 0, 1);

    /// <summary>A column's pixel (x across its 192 px, y down its 2048): the pane's colour, the lead over it and the pane's id.</summary>
    private static void Column(int col, float x, float y, out Vector3 c, out float lead, out uint pane)
    {
        if (col >= Plain) { PlainColumn(col, x, y, out c, out lead, out pane); return; }
        var s = Schemes[col];
        const float border = 16;
        lead = 0;
        // the outer lead (heavy, it holds the light in the stone's groove) and the border's own inner line
        float edge = MathF.Min(x, ColW - x);
        lead = MathF.Max(lead, Lead(edge, 2.2f));
        if (edge < border)
        {
            lead = MathF.Max(lead, Lead(edge - border, 1.2f));
            float by = y + (x < ColW / 2 ? 0 : 12);
            int bi = (int)MathF.Floor(by / 24);
            lead = MathF.Max(lead, Lead(MathF.Min(by - bi * 24, (bi + 1) * 24 - by), 1.1f));
            c = (bi & 1) == 0 ? s.BorderA : s.BorderB;
            pane = Id(col, bi, x < ColW / 2 ? 1 : 2);
            return;
        }
        int k = (int)MathF.Floor(y / Panel);
        float py = y - k * Panel;
        // the band and the saddle bar between panels
        float band = MathF.Min(py, Panel - py);
        lead = MathF.Max(lead, Lead(band, 2.4f));
        if (band < 11)
        {
            lead = MathF.Max(lead, Lead(band - 11, 1.1f));
            int bi = (int)MathF.Floor((x - border) / 20);
            lead = MathF.Max(lead, Lead(MathF.Min(x - border - bi * 20, (bi + 1) * 20 - (x - border)), 1.0f));
            c = (bi & 1) == 0 ? s.BorderB : s.BorderA;
            pane = Id(col, k * 64 + bi, py < Panel / 2 ? 3 : 4);
            return;
        }
        // the medallion
        uint h = Id(col, k, 9);
        int type = (int)(Rand(h) * 4);
        float mx = x - ColW / 2f, my = py - Panel / 2f;
        float d = Medallion(type, mx, my);
        if (d < 0)
        {
            lead = MathF.Max(lead, Lead(d, 1.4f));
            if (d > -9)
            {
                // the rim, cut into short pieces
                float a = MathF.Atan2(my, mx);
                int ri = (int)MathF.Floor((a + MathF.PI) / (MathF.Tau / 16));
                lead = MathF.Max(lead, Lead(d + 9, 1.0f));
                float ra = (a + MathF.PI) - (ri + 0.5f) * (MathF.Tau / 16);
                float rr = MathF.Sqrt(mx * mx + my * my);
                lead = MathF.Max(lead, Lead(MathF.Abs(ra) * rr - MathF.Tau / 32 * rr, 0.9f));
                c = s.Rim;
                pane = Id(col, k, 100 + ri);
                return;
            }
            float r = MathF.Sqrt(mx * mx + my * my);
            const float boss = 17;
            if (r < boss)
            {
                lead = MathF.Max(lead, Lead(r - boss, 1.2f));
                c = s.Boss;
                pane = Id(col, k, 200);
                return;
            }
            lead = MathF.Max(lead, Lead(r - boss, 1.2f));
            // eight petals round the boss: a petal's own colour, the field between them
            float ang = MathF.Atan2(my, mx) + (type == 2 ? MathF.PI / 8 : 0);
            float sector = MathF.Tau / 8;
            int si = (int)MathF.Floor((ang + MathF.PI) / sector);
            float within = (ang + MathF.PI) - (si + 0.5f) * sector;
            float reach = (-d - 9) + r;
            // the petal: pointed, widest halfway out
            float t = Math.Clamp((r - boss) / MathF.Max(reach - boss - 4, 1), 0, 1);
            float half = sector * 0.42f * MathF.Sin(MathF.PI * MathF.Pow(t, 0.8f));
            float pd = (MathF.Abs(within) - half) * r;
            lead = MathF.Max(lead, Lead(pd, 1.0f));
            if (pd < 0)
            {
                c = s.Petal;
                pane = Id(col, k, 300 + si);
            }
            else
            {
                c = s.Field;
                pane = Id(col, k, 400 + si * 2 + (within > 0 ? 1 : 0));
                lead = MathF.Max(lead, Lead(within * r, 0.8f));
            }
            return;
        }
        lead = MathF.Max(lead, Lead(d, 1.4f));
        // the diaper ground: diamond quarries, one now and then of the accent colour
        Diamonds(x - ColW / 2f, y, 34, out float dl, out int qi, out int qj);
        lead = MathF.Max(lead, Lead(dl, 1.0f));
        pane = Id(col, qi, qj);
        c = Rand(pane * 31u + 7u) < 0.07f ? s.Odd : s.Ground;
    }

    /// <summary>The signed distance (px) to a medallion's outline: 0 a roundel, 1 a quatrefoil, 2 a lozenge, 3 a pointed oval.</summary>
    private static float Medallion(int type, float x, float y)
    {
        const float R = 62;
        switch (type)
        {
            case 1:
            {
                float o = R * 0.44f, r = R * 0.6f;
                float a = MathF.Sqrt((x - o) * (x - o) + y * y), b = MathF.Sqrt((x + o) * (x + o) + y * y);
                float c = MathF.Sqrt(x * x + (y - o) * (y - o)), d = MathF.Sqrt(x * x + (y + o) * (y + o));
                return MathF.Min(MathF.Min(a, b), MathF.Min(c, d)) - r;
            }
            case 2:
                return (MathF.Abs(x) * 1.15f + MathF.Abs(y) * 0.85f - R * 1.12f) * 0.71f;
            case 3:
            {
                float o = R * 0.62f, r = R * 1.45f;
                return MathF.Max(MathF.Sqrt((x - o) * (x - o) + y * y), MathF.Sqrt((x + o) * (x + o) + y * y)) - r;
            }
            default:
                return MathF.Sqrt(x * x + y * y) - R;
        }
    }

    /// <summary>A diamond lattice of this spacing: the distance to its nearest lead and the quarry's indices.</summary>
    private static void Diamonds(float x, float y, float spacing, out float dist, out int i, out int j)
    {
        float u = (x + y) / spacing, v = (x - y) / spacing;
        i = (int)MathF.Floor(u);
        j = (int)MathF.Floor(v);
        float fu = u - i, fv = v - j;
        dist = MathF.Min(MathF.Min(fu, 1 - fu), MathF.Min(fv, 1 - fv)) * spacing * 0.7071f;
    }

    private static void PlainColumn(int col, float x, float y, out Vector3 c, out float lead, out uint pane)
    {
        float border = col == Plain ? 12 : 14;
        float edge = MathF.Min(x, ColW - x);
        lead = Lead(edge, 2.2f);
        // the saddle bars
        float bar = y % 192;
        lead = MathF.Max(lead, Lead(MathF.Min(bar, 192 - bar), 2.0f));
        if (edge < border)
        {
            lead = MathF.Max(lead, Lead(edge - border, 1.1f));
            float by = y + (x < ColW / 2 ? 0 : 16);
            int bi = (int)MathF.Floor(by / 32);
            lead = MathF.Max(lead, Lead(MathF.Min(by - bi * 32, (bi + 1) * 32 - by), 1.0f));
            pane = Id(col, bi, x < ColW / 2 ? 1 : 2);
            float r = Rand(pane);
            c = col switch
            {
                Plain => Mid * (0.86f + 0.1f * r),
                PlainWarm => (bi & 1) == 0 ? Ruby : Cobalt,
                _ => (bi & 1) == 0 ? Gold : RubyDeep,
            };
            return;
        }
        if (col == PlainWarm)
        {
            // pale leaded rectangles, every other row half a pane over
            int row = (int)MathF.Floor(y / 40);
            float xo = x - border + ((row & 1) == 0 ? 0 : 16);
            int ci = (int)MathF.Floor(xo / 32);
            lead = MathF.Max(lead, Lead(MathF.Min(y - row * 40, (row + 1) * 40 - y), 0.9f));
            lead = MathF.Max(lead, Lead(MathF.Min(xo - ci * 32, (ci + 1) * 32 - xo), 0.9f));
            pane = Id(col, row, ci);
            float r = Rand(pane);
            c = Warm * (0.86f + 0.16f * r) + new Vector3(-0.02f, 0.01f * Rand(pane + 3), 0.02f * r);
            return;
        }
        Diamonds(x - ColW / 2f, y, col == Plain ? 36 : 30, out float dl, out int qi, out int qj);
        lead = MathF.Max(lead, Lead(dl, 1.0f));
        pane = Id(col, qi, qj);
        float q = Rand(pane);
        if (col == Plain)
        {
            // (continuous, each pane within about a tenth of its neighbours: no light and dark blocks)
            c = Mid.Lerp(Pale, 0.45f + 0.3f * q);
            return;
        }
        c = Grisaille * (0.9f + 0.14f * q);
        // the grisaille's painted dot in each quarry's middle
        float u = (x - ColW / 2f + y) / 30, v = (x - ColW / 2f - y) / 30;
        float du = (u - qi - 0.5f) * 30 * 0.7071f, dv = (v - qj - 0.5f) * 30 * 0.7071f;
        float dot = MathF.Sqrt(du * du + dv * dv);
        if (dot < 4.5f) c *= 0.55f + 0.45f * Math.Clamp(dot - 3, 0, 1);
    }

    private static readonly float[] Rings = { 26, 92, 130, 150 };

    /// <summary>A round window (320 px, its middle at 160, 160): the boss, eight petals, a ring of sixteen, a border ring.</summary>
    private static void Rose(int index, float x, float y, out Vector3 c, out float lead, out uint pane)
    {
        bool plain = index >= PlainRose;
        var s = Schemes[(index * 2 + 1) % Schemes.Length];
        float dx = x - 160, dy = y - 160;
        float r = MathF.Sqrt(dx * dx + dy * dy), a = MathF.Atan2(dy, dx) + MathF.PI;
        lead = 0;
        if (r > 150)
        {
            lead = Lead(r - 150, 1.6f);
            c = plain ? Mid : s.BorderA;
            pane = Id(index, 999, 0);
            if (r > 156) lead = 1;
            return;
        }
        foreach (var ring in Rings) lead = MathF.Max(lead, Lead(r - ring, ring > 140 ? 1.6f : 1.2f));
        if (r < 26)
        {
            c = plain ? Pale : s.Boss;
            pane = Id(index, 0, 0);
            return;
        }
        int n = r < 92 ? 8 : r < 130 ? 16 : 24;
        float sector = MathF.Tau / n;
        int si = (int)MathF.Floor(a / sector);
        float within = a - (si + 0.5f) * sector;
        lead = MathF.Max(lead, Lead((MathF.Abs(within) - sector / 2) * r, 0.9f));
        pane = Id(index, n, si);
        float q = Rand(pane);
        if (plain)
        {
            c = Mid.Lerp(Pale, 0.4f + 0.35f * q);
            return;
        }
        if (n == 8)
        {
            // a petal in each of the eight
            float t = (r - 26) / 66;
            float half = sector * 0.4f * MathF.Sin(MathF.PI * MathF.Pow(t, 0.75f));
            float pd = (MathF.Abs(within) - half) * r;
            lead = MathF.Max(lead, Lead(pd, 0.9f));
            c = pd < 0 ? ((si & 1) == 0 ? s.Petal : s.Rim) : s.Field;
            if (pd >= 0) pane = Id(index, 8, si * 2 + (within > 0 ? 1 : 0));
            return;
        }
        c = n == 16 ? ((si & 1) == 0 ? s.Rim : s.Ground) : ((si & 1) == 0 ? s.BorderA : s.BorderB);
    }
}
