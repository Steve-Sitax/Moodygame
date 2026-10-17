using System;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using Godot;

namespace Scheldemist.Models;

/// <summary>
/// The relief of the models the game loads while it runs (issue 78). The baked town's materials carry the bump maps the
/// browser made for them (the bake's psx options, BakedWorld.Convert); a model's glTF carries none, so its surfaces drew
/// their colour picture flat. This is the browser's own rule, ported (world/bumps.ts autoBump and retro/psx.ts
/// heightFromColour): a strength by what the surface is, read from its material's name, then its picture's, then its
/// object's; a height map made from the picture itself (light stone high, dark joints low), so the bump always agrees
/// with the picture. The shader is the baked town's (Psx.Kind.Bump); no new kind of it.
/// </summary>
public static class ModelBump
{
    /// <summary>three's bumpScale by kind (bumps.ts BUMP_KIND): the height's change from one screen pixel to the next.</summary>
    private static readonly Dictionary<string, float> Strength = new()
    {
        ["stone"] = 1.4f, ["roof"] = 1.2f, ["tile"] = 0.7f, ["earth"] = 1.0f, ["wood"] = 1.1f, ["bark"] = 1.4f, ["fibre"] = 1.0f,
        ["mixed"] = 1.0f, ["iron"] = 0.6f, ["leather"] = 0.6f, ["food"] = 0.45f, ["plant"] = 0.4f, ["plaster"] = 0.4f,
        ["cloth"] = 0.28f, ["polished"] = 0.18f, ["none"] = 0f,
    };

    /// <summary>What a surface is, as words; the first rule that matches wins, so the smooth ones and the exceptions come first (bumps.ts RULES).</summary>
    private static readonly (Regex Pattern, string Kind)[] Rules =
    {
        (R(@"glass|mirror|\bpanes?\b|lampshade|bottle|paper|poster|\bbills?\b|letter|\bsigns?\b|numbers|notice|label|print|ledger|\brules\b|chart|music|\bmaps?\b|\bdials?\b|clock|portrait|saint|history|paint|picture|sketch|\barms\b|\bink\b|screen|gilt|gold|glow|flame|ember|candle|smoke|steam|\bsky\b|cloud|water|river|\bskin\b|\bface\b|forearm|\bhair\b|shadow|decal|grime|halo|\bsea\b|rosary|\b[pj] (altar|lady|side|chapel)\b|vogelpik|\bhorse\b|\bdog\b|\bcat\b|\bbird|gull|pigeon|sparrow|\brat\b|\bfish\b|\bpress\b|\bboard text\b|backdrop|\bbooth\b"), "none"),
        (R(@"marble|alabaster|brass|copper|pewter|\btins?\b|delft|\bjugs?\b|\bjars?\b|jarsrow|polished|lacquer|porcelain|glaze|\bglobe\b|\bbronze\b"), "polished"),
        (R(@"whitetiles|encaustic|checker|\btiles?\b|redtile"), "tile"),
        (R(@"brick|ashlar|masonry|\bvault stone\b"), "stone"),
        (R(@"cloth|linen|curtain|drape|velvet|plush|damask|baize|silk|blanket|\bsheet\b|skirt|shawl|canvas|\bsails?\b|tarpaulin|oilskin|awning|carpet|turkey|\brags?\b|felt|wool|\bbolts?\b|display|hatbox|bunting|flagcloth"), "cloth"),
        (R(@"leaves|foliage|\bplants?\b|reed|\bivy\b|moss|fern|grass|hedge|flower|lilies|lily|parsley|onions|herb|vegetation|\bweeds?\b"), "plant"),
        (R(@"\bbark\b|trunk"), "bark"),
        (R(@"\bloaf|bread|biscuit|\bmeat\b|sausage|\bapples?\b|cheese|\bfat\b|peperkoek|\btarts?\b|\bcakes?\b|candy|\bbeans\b|sugar|cigar|tobacco|coffee|mussel|\bbuns?\b"), "food"),
        (R(@"rope|wicker|basket|straw|\brush\b|\bhay\b|thatch|\bbales?\b|\bsacks?\b|sacking|hessian|bundle|\bnets?\b|broom|cordage|\bbooks?\b"), "fibre"),
        (R(@"leather|\bhides?\b|\bboots?\b|saddle|harness|\blasts?\b|\bshoes?\b"), "leather"),
        (R(@"iron|steel|\bzinc\b|\blead\b|metal|\brails?\b|hoop|chain|anchor|\bbars\b|\bknob\b|\bwire\b|\bpump\b|\bbells?\b|cannon|stove|\bgrate\b|rivet|\btar\b"), "iron"),
        (R(@"plaster|\bwash\b|whitewash|render|\bcream\b|ceil|\bdado\b|cornice|frieze|\bwhite\b|\blime\b|\bclay\b|\bpots?\b|chalk|\bsoot\b|\bvault\b|stucco|wallpaper|office wall|brownplaster"), "plaster"),
        (R(@"slate|pantile|\btiles?\b|redtile|\broof\b|roofing|shingle"), "roof"),
        (R(@"brick|stone|ashlar|granite|tournai|\bflags\b|hallflags|flagstone|\bslabs?\b|cobble|\bsetts?\b|plinth|quoin|coping|\bkerbs?\b|\bsteps?\b|hearth|masonry|quaywall|quay wall|backwalls?|\brock\b|cellar|\bbank\b|statue|\breveal\b|\bgravel\b|\bvh blue\b|\bvault (brick|stone)\b"), "stone"),
        (R(@"earth|\bmud\b|dirt|\bsand\b|\bruts\b|ground"), "earth"),
        (R(@"wood|plank|board|\boak\b|\bdeal\b|\bpine\b|mahogany|timber|\bbeams?\b|crate|\bcasks?\b|barrel|\btubs?\b|shutter|\bdoors?\b|\bleaf\b|\bpanels?\b|wainscot|\bframes?\b|\bdecks?\b|\bhull\b|drawers|counter|bench|chair|table|\bcarts?\b|wagon|wheel|\bstalls?\b|\bpiles?\b|\bmasts?\b|ladder|\bspars?\b|\boars?\b|\bchests?\b|\bbox(es)?\b|\bblock\b|typecase|\bform\b|shel(f|ves)|cabinet|wardrobe|\bbed\b|stool|dresser|joist|rafter|\blath\b|fence|\bposts?\b|\bgates?\b|stairdark|\bdark\b|darkwood|\bhoops\b"), "wood"),
        (R(@"\bsolid\b|atlas|\bgoods\b|clutter|litter|lively|streetlife|quayfurniture|\btrades\b|\bboats\b|\bprops\b|\bthin\b|market|velocipede|omnibus|railway"), "mixed"),
    };

    private static Regex R(string pattern) => new(pattern, RegexOptions.CultureInvariant);

    private static string Words(string s) => " " + Regex.Replace(s.ToLowerInvariant(), "[^a-z]+", " ").Trim() + " ";

    private static string? KindOf(string label)
    {
        string w = Words(label);
        foreach (var (pattern, kind) in Rules) if (pattern.IsMatch(w)) return kind;
        return null;
    }

    /// <summary>
    /// The bump strength of a surface (0: none, it stays smooth on purpose): the material's own name first, then its
    /// picture's, last its object's (bumps.ts autoBump). Two the browser set by hand: the draught team's atlas gets none
    /// (its uv wraps inside the cell: lines round the body, worklog cc70b81), the quay goods' atlas 0.4 (its edges drew
    /// pale dashes, worklog d1825a1).
    /// </summary>
    public static float StrengthOf(string material, string picture, string node)
    {
        if (material == "goods_team") return 0;
        if (material is "qg_solid" or "quaygoods_solid") return 0.4f;
        string? kind = (material != "" ? KindOf(material) : null) ?? KindOf(picture) ?? (node != "" ? KindOf(node) : null);
        return kind != null ? Strength[kind] : 0;
    }

    private static readonly Dictionary<Texture2D, ImageTexture?> Heights = new();
    private static readonly Dictionary<string, ImageTexture?> Drawn = new();

    /// <summary>A material the browser's rules keep smooth on purpose (glass, paper, water, paint pictures).</summary>
    public static bool IsSmooth(string label) => KindOf(label) == "none";

    /// <summary>
    /// A height map drawn with the model: assets/game-models/heights/&lt;model&gt;/&lt;material&gt;.png, 0.5 level, light high,
    /// painted with the same strokes as the colour (art-source/tools/blender/build_ferry.py write_heights). It replaces the
    /// map made from the picture's light, which cannot tell a grain line from a stain. Null when the model has none.
    /// </summary>
    public static Texture2D? Authored(string model, string material)
    {
        if (model == "" || material == "") return null;
        string path = $"res://assets/game-models/heights/{model}/{material}.png";
        if (Drawn.TryGetValue(path, out var done)) return done;
        ImageTexture? made = null;
        try
        {
            if (ResourceLoader.Exists(path) && ResourceLoader.Load<Texture2D>(path)?.GetImage() is { } image && image.GetWidth() > 0)
            {
                if (image.IsCompressed()) image.Decompress();
                image.Convert(Image.Format.L8);
                image.GenerateMipmaps();
                made = ImageTexture.CreateFromImage(image);
            }
        }
        catch (Exception e) { GD.PrintErr("model bump: a drawn height map was not read: " + path + ": " + e.Message); }
        Drawn[path] = made;
        return made;
    }

    /// <summary>One height map per picture (bumpFromMap's cache); null when the picture cannot be read.</summary>
    public static Texture2D? HeightOf(Texture2D picture)
    {
        if (Heights.TryGetValue(picture, out var done)) return done;
        ImageTexture? made = null;
        try { made = Make(picture); }
        catch (Exception e) { GD.PrintErr("model bump: a height map was not made: " + e.Message); }
        Heights[picture] = made;
        return made;
    }

    /// <summary>A box blur that wraps (the textures tile), r texels each way, on a w x h field (psx.ts wrapBlur).</summary>
    private static float[] WrapBlur(float[] src, int w, int h, int r)
    {
        int n = 2 * r + 1;
        var tmp = new float[w * h];
        var output = new float[w * h];
        for (int y = 0; y < h; y++)
        {
            int row = y * w;
            float s = 0;
            for (int d = -r; d <= r; d++) s += src[row + (((d % w) + w) % w)];
            for (int x = 0; x < w; x++)
            {
                tmp[row + x] = s / n;
                s += src[row + ((x + r + 1) % w)] - src[row + ((((x - r) % w) + w) % w)];
            }
        }
        for (int x = 0; x < w; x++)
        {
            float s = 0;
            for (int d = -r; d <= r; d++) s += tmp[(((d % h) + h) % h) * w + x];
            for (int y = 0; y < h; y++)
            {
                output[y * w + x] = s / n;
                s += tmp[((y + r + 1) % h) * w + x] - tmp[((((y - r) % h) + h) % h) * w + x];
            }
        }
        return output;
    }

    /// <summary>psx.ts heightFromColour, the sharp way (small pictures made bigger first, so a joint is as sharp as a pixel).</summary>
    private static ImageTexture? Make(Texture2D picture)
    {
        var image = picture.GetImage();
        if (image == null || image.GetWidth() < 1) return null;
        if (image.IsCompressed()) image.Decompress();
        image.Convert(Image.Format.Rgba8);
        double k = Math.Min(1.0, 512.0 / Math.Max(image.GetWidth(), image.GetHeight()));
        int w = Math.Max(4, (int)Math.Round(image.GetWidth() * k)), h = Math.Max(4, (int)Math.Round(image.GetHeight() * k));
        if (w != image.GetWidth() || h != image.GetHeight()) image.Resize(w, h, Image.Interpolation.Lanczos);
        var px = image.GetData();
        var lum = new float[w * h];
        for (int i = 0; i < w * h; i++) lum[i] = (px[i * 4] * 0.3f + px[i * 4 + 1] * 0.59f + px[i * 4 + 2] * 0.11f) / 255f;
        // the stone's own level round each texel, twice; what stands above it is the relief
        int radius = Math.Max(2, (int)Math.Round(Math.Min(w, h) / 16.0));
        var low = WrapBlur(WrapBlur(lum, w, h, radius), w, h, radius);
        var hp = new float[w * h];
        float most = 0;
        for (int i = 0; i < w * h; i++) { hp[i] = lum[i] - low[i]; most = Math.Max(most, Math.Abs(hp[i])); }
        // the 98th percentile of the relief's size, counted in 4096 bins
        var bins = new uint[4096];
        float toBin = 4095f / (most > 0 ? most : 1);
        for (int i = 0; i < w * h; i++) bins[(int)Math.Round(Math.Abs(hp[i]) * toBin)]++;
        long seen = 0;
        int b98 = 0;
        long want = (long)Math.Floor(w * h * 0.98) + 1;
        while (b98 < 4095 && (seen += bins[b98]) < want) b98++;
        float top = b98 / toBin;
        if (top <= 0) top = 1;
        int u = Math.Max(1, Math.Min(8, 256 / Math.Max(w, h)));
        int W = w * u, H = h * u;
        var big = new float[W * H];
        for (int y = 0; y < H; y++)
        {
            int sy = (y / u) * w;
            for (int x = 0; x < W; x++) big[y * W + x] = Math.Clamp(0.5f + 0.5f * hp[sy + x / u] / top, 0f, 1f);
        }
        if (u > 1)
        {
            int r = Math.Max(1, (int)Math.Round(u / 4.0));
            big = WrapBlur(WrapBlur(big, W, H, r), W, H, r);
        }
        else big = WrapBlur(big, W, H, 1);
        var bytes = new byte[W * H];
        for (int i = 0; i < W * H; i++) bytes[i] = (byte)Math.Round(255 * big[i]);
        var height = Image.CreateFromData(W, H, false, Image.Format.L8, bytes);
        height.GenerateMipmaps();
        return ImageTexture.CreateFromImage(height);
    }
}
