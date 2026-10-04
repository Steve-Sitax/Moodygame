using System;
using Godot;

namespace Scheldemist.Ui;

/// <summary>
/// A piece of paper with its content on it (the CSS .paper and the menus' sheets): the paper's tone (lighter in the
/// middle, a faint grain, burnt edges), a soft shadow under it, the printer's double rule round the inside, a slight
/// turn. Children are laid inside the padding, one over the other (give it one box of content).
///
///   var card = new PaperCard(PaperCard.Kind.Title) { Tilt = -0.8f };
///   card.Pad(34, 22, 34, 16);            // CSS px
///   card.AddChild(content);
/// </summary>
public partial class PaperCard : Container
{
    public enum Kind
    {
        /// <summary>The old plain paper (style.css .paper): one tone, sepia 0.3. The pause card, the save list, notes.</summary>
        Plain,
        /// <summary>The title handbill (menu.css .title-sheet): light in the middle, double rule.</summary>
        Title,
        /// <summary>A menu sheet (menu.css .menu-sheet): lighter at the top, double rule.</summary>
        Sheet,
        /// <summary>The loading card (index.html #boot .card).</summary>
        Boot,
    }

    private const string Code = @"
shader_type canvas_item;
uniform vec2 size = vec2(100.0);
uniform vec3 hi : source_color = vec3(0.91, 0.88, 0.8);
uniform vec3 mid : source_color = vec3(0.87, 0.83, 0.73);
uniform vec3 lo : source_color = vec3(0.82, 0.78, 0.65);
uniform int mode = 0; // 0 one tone, 1 round (light in the middle), 2 down (light at the top)
uniform vec2 centre = vec2(0.5, 0.4);
uniform float mid_at = 0.55;
uniform float alpha = 1.0;
uniform float burn = 0.0; // the burnt edge's reach, px
uniform vec4 burn_col = vec4(0.431, 0.298, 0.118, 0.28);
uniform float rule_inset = 0.0; // the double rule's place from the edge, px (0: none)
uniform float rule_w = 1.0;
uniform vec4 rule_col = vec4(0.133, 0.106, 0.082, 0.28);
uniform float sepia = 0.0;
uniform float grain = 1.0;

float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float noise(vec2 p) {
	vec2 i = floor(p), f = fract(p);
	f = f * f * (3.0 - 2.0 * f);
	return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

void fragment() {
	vec2 p = UV * size;
	vec3 c = mid;
	if (mode == 1) {
		vec2 r = 1.41421 * max(centre, 1.0 - centre);
		float d = length((UV - centre) / r);
		c = d < mid_at ? mix(hi, mid, d / mid_at) : mix(mid, lo, clamp((d - mid_at) / (1.0 - mid_at), 0.0, 1.0));
	} else if (mode == 2) {
		c = UV.y < 0.3 ? mix(hi, mid, UV.y / 0.3) : mix(mid, lo, (UV.y - 0.3) / 0.7);
	}
	if (grain > 0.0) {
		float n = noise(p * 0.85) * 0.5 + noise(p * 1.7) * 0.3 + noise(p * 3.4) * 0.2;
		c = mix(c, vec3(0.2, 0.14, 0.08), grain * 0.11 * (0.25 + 1.5 * n));
	}
	if (burn > 0.0) {
		vec2 e = min(p, size - p);
		float ax = 1.0 - smoothstep(0.0, burn, e.x), ay = 1.0 - smoothstep(0.0, burn, e.y);
		float a = 1.0 - (1.0 - ax * ax * 0.5) * (1.0 - ay * ay * 0.5);
		c = mix(c, burn_col.rgb, burn_col.a * a * 1.6);
	}
	if (rule_inset > 0.0) {
		vec2 e = min(p, size - p);
		float d = min(e.x, e.y) - rule_inset;
		// a double rule: line, gap, line
		float on = step(0.0, d) * step(d, rule_w) + step(2.0 * rule_w, d) * step(d, 3.0 * rule_w);
		c = mix(c, rule_col.rgb, rule_col.a * on);
	}
	if (sepia > 0.0) {
		vec3 s = vec3(dot(c, vec3(0.393, 0.769, 0.189)), dot(c, vec3(0.349, 0.686, 0.168)), dot(c, vec3(0.272, 0.534, 0.131)));
		c = mix(c, s, sepia);
	}
	COLOR = vec4(c, alpha);
}";
    private static Shader? shader;

    private readonly Kind kind;
    private readonly ColorRect bg;
    private readonly Panel shadow;
    private readonly ShaderMaterial mat;
    private float padL, padT, padR, padB;

    /// <summary>The turn in degrees, about the middle (CSS rotate).</summary>
    public float Tilt
    {
        get => RotationDegrees;
        set => RotationDegrees = Kit.Calm ? 0 : value;
    }

    public PaperCard() : this(Kind.Plain)
    {
    }

    public PaperCard(Kind kind, float alpha = 1)
    {
        this.kind = kind;
        shader ??= new Shader { Code = Code };
        mat = new ShaderMaterial { Shader = shader };
        bool hc = Kit.HiContrast;
        mat.SetShaderParameter("alpha", alpha);
        mat.SetShaderParameter("grain", hc ? 0f : 1f);
        mat.SetShaderParameter("hi", Kit.PaperHi);
        mat.SetShaderParameter("mid", Kit.Paper);
        mat.SetShaderParameter("lo", Kit.Paper2);
        mat.SetShaderParameter("rule_col", Kit.InkFaint);
        mat.SetShaderParameter("rule_w", (float)Math.Max(1, Kit.Px(1)));
        float shadowSize = 30, shadowDrop = 6, shadowA = 0.55f;
        switch (kind)
        {
            case Kind.Plain:
                mat.SetShaderParameter("mid", hc ? Kit.Paper : new Color("d8cfb8"));
                mat.SetShaderParameter("grain", 0f);
                mat.SetShaderParameter("sepia", hc ? 0f : 0.3f);
                break;
            case Kind.Title:
                mat.SetShaderParameter("mode", 1);
                mat.SetShaderParameter("centre", new Vector2(0.5f, 0.4f));
                mat.SetShaderParameter("mid_at", 0.55f);
                mat.SetShaderParameter("burn", Kit.Pxf(38));
                mat.SetShaderParameter("burn_col", new Color(0.431f, 0.298f, 0.118f, hc ? 0f : 0.28f));
                mat.SetShaderParameter("rule_inset", Kit.Pxf(8));
                mat.SetShaderParameter("sepia", hc ? 0f : 0.18f);
                shadowSize = 50;
                shadowDrop = 14;
                shadowA = 0.7f;
                break;
            case Kind.Sheet:
                mat.SetShaderParameter("mode", 2);
                mat.SetShaderParameter("burn", Kit.Pxf(44));
                mat.SetShaderParameter("burn_col", new Color(0.431f, 0.298f, 0.118f, hc ? 0f : 0.25f));
                mat.SetShaderParameter("rule_inset", Kit.Pxf(7));
                mat.SetShaderParameter("sepia", hc ? 0f : 0.12f);
                shadowSize = 60;
                shadowDrop = 16;
                shadowA = 0.75f;
                break;
            case Kind.Boot:
                mat.SetShaderParameter("mode", 1);
                mat.SetShaderParameter("centre", new Vector2(0.45f, 0.35f));
                mat.SetShaderParameter("mid_at", 0.58f);
                mat.SetShaderParameter("burn", Kit.Pxf(34) / Kit.Scale);
                mat.SetShaderParameter("burn_col", new Color(0.431f, 0.298f, 0.118f, 0.26f));
                mat.SetShaderParameter("rule_inset", 6f);
                mat.SetShaderParameter("rule_w", 1f);
                shadowSize = 40 / Kit.Scale;
                shadowDrop = 12 / Kit.Scale;
                shadowA = 0.55f;
                break;
        }
        var sb = new StyleBoxFlat { BgColor = new Color(0, 0, 0, shadowA * 0.5f), ShadowColor = new Color(0, 0, 0, shadowA * 0.55f), ShadowSize = Kit.Px(shadowSize * 0.55f), ShadowOffset = new Vector2(0, Kit.Px(shadowDrop * 0.6f)) };
        shadow = new Panel { MouseFilter = MouseFilterEnum.Ignore };
        shadow.AddThemeStyleboxOverride("panel", sb);
        AddChild(shadow, false, InternalMode.Front);
        bg = new ColorRect { Material = mat, MouseFilter = MouseFilterEnum.Ignore };
        AddChild(bg, false, InternalMode.Front);
        MouseFilter = MouseFilterEnum.Stop;
    }

    /// <summary>The paper's padding, CSS px (left, top, right, bottom).</summary>
    public PaperCard Pad(float left, float top, float right, float bottom)
    {
        padL = Kit.Px(left);
        padT = Kit.Px(top);
        padR = Kit.Px(right);
        padB = Kit.Px(bottom);
        QueueSort();
        UpdateMinimumSize();
        return this;
    }

    public override Vector2 _GetMinimumSize()
    {
        var m = Vector2.Zero;
        foreach (var c in GetChildren())
            if (c is Control { Visible: true } k)
                m = m.Max(k.GetCombinedMinimumSize());
        return m + new Vector2(padL + padR, padT + padB);
    }

    public override void _Notification(int what)
    {
        // the paper's own size, for its shader and its turn (a card sized before it came into the tree hears no
        // "resized": taken at the sort and on entering too)
        if (what == NotificationResized || what == NotificationSortChildren || what == NotificationEnterTree)
        {
            PivotOffset = Size / 2;
            mat.SetShaderParameter("size", Size);
        }
        if (what != NotificationSortChildren) return;
        var full = new Rect2(Vector2.Zero, Size);
        FitChildInRect(shadow, full);
        FitChildInRect(bg, full);
        var inner = new Rect2(padL, padT, Math.Max(0, Size.X - padL - padR), Math.Max(0, Size.Y - padT - padB));
        foreach (var c in GetChildren())
            if (c is Control k)
                FitChildInRect(k, inner);
    }
}
