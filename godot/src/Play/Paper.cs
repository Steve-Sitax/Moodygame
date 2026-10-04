using System;
using Godot;
using Scheldemist.Game;

namespace Scheldemist.Play;

/// <summary>
/// The paper the game's windows are made of (client/src/style.css .paper, .board, .task, .night): a card with the
/// browser's colours, a slight turn and a soft shadow, and ink in the two faces. Sizes are CSS pixels times the
/// browser's --ui, as in Game/Hud.cs.
/// </summary>
public static class Paper
{
    /// <summary>#2a2420, the ink.</summary>
    public static readonly Color Ink = new("2a2420");
    /// <summary>#d4cab0 through the browser's sepia(0.35) contrast(0.95): the board, the sheets.</summary>
    public static readonly Color Sheet = new("ded4b1");
    /// <summary>#d8cfb8 through sepia(0.3): the small cards.</summary>
    public static readonly Color Card = new("ebdbbb");

    /// <summary>style.css --ui: everything on screen grows with the window.</summary>
    public static float Ui(float width) => width >= 3000 ? 2.2f : width >= 2200 ? 1.8f : width >= 1600 ? 1.5f : 1.3f;

    public static float UiNow => Ui(Main.I.GetViewport().GetVisibleRect().Size.X);

    public static int Px(float css) => Mathf.RoundToInt(css * UiNow);

    /// <summary>A piece of paper: background, padding (CSS px), a slight turn about its middle, a shadow under it.</summary>
    public static PanelContainer Make(Color bg, float padX, float padTop, float padBottom, float turnDeg, float shadow = 24, float drop = 6)
    {
        var box = new StyleBoxFlat
        {
            BgColor = bg,
            ContentMarginLeft = Px(padX),
            ContentMarginRight = Px(padX),
            ContentMarginTop = Px(padTop),
            ContentMarginBottom = Px(padBottom),
            ShadowColor = new Color(0, 0, 0, 0.5f),
            ShadowSize = Px(shadow * 0.6f),
            ShadowOffset = new Vector2(0, Px(drop)),
            AntiAliasing = true,
        };
        box.SetCornerRadiusAll(1);
        var card = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore, RotationDegrees = turnDeg };
        card.AddThemeStyleboxOverride("panel", box);
        card.Resized += () => card.PivotOffset = card.Size / 2;
        return card;
    }

    public static Label Text(string text, Font font, float size, float alpha = 1, bool wrap = false, HorizontalAlignment align = HorizontalAlignment.Left)
    {
        var l = new Label
        {
            Text = text,
            LabelSettings = new LabelSettings { Font = font, FontSize = Px(size), FontColor = new Color(Ink, alpha) },
            MouseFilter = Control.MouseFilterEnum.Ignore,
            HorizontalAlignment = align,
        };
        if (wrap) l.AutowrapMode = TextServer.AutowrapMode.WordSmart;
        return l;
    }

    /// <summary>A column of lines with no gap of its own.</summary>
    public static VBoxContainer Column(int gap = 0)
    {
        var c = new VBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        c.AddThemeConstantOverride("separation", gap);
        return c;
    }

    public static HBoxContainer Row(float gapCss = 10)
    {
        var r = new HBoxContainer { MouseFilter = Control.MouseFilterEnum.Ignore };
        r.AddThemeConstantOverride("separation", Px(gapCss));
        return r;
    }

    /// <summary>Put a card in the middle of the window (left 50%, top 50%), after its size is known.</summary>
    public static void Centre(Control card, float atY = 0.5f)
    {
        void Put()
        {
            var win = card.GetViewport().GetVisibleRect().Size;
            card.Position = new Vector2((win.X - card.Size.X) / 2, win.Y * atY - card.Size.Y / 2);
        }
        card.Resized += Put;
        card.Ready += Put;
    }
}
