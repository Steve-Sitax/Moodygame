using System;
using Godot;
using Scheldemist.Game;
using Scheldemist.People;
using Scheldemist.Player;

namespace Scheldemist.Net.Mp;

/// <summary>
/// Another player's body (net/mp/figures.ts): a figure of the people model with his name over his head (a small
/// paper tag, "away" when his menu is up). The animation comes from his mode and his speed: walk, crouch, swim,
/// row, ride; in the air he stands in the arc. On the ground his feet are put on this PC's own ground at his
/// place (no floating, no sinking on stairs); in the air or in the water his own height counts.
/// The browser dresses him from his look code (player/look.ts); until the character's part is ported the code
/// only picks a man's or a woman's body (Together.FigureKind may pick another).
/// </summary>
public sealed class RemoteFigure
{
    private const float TagM = 40;
    private const float HeadM = 1.95f;

    public readonly int Id;
    public Human? Figure { get; private set; }
    public string Code { get; private set; } = "";
    public string Name { get; private set; } = "";
    public bool Away { get; private set; }
    /// <summary>Where he is drawn now (world).</summary>
    public Vector3 At;
    public float Yaw;
    public bool Shown { get; private set; }
    /// <summary>A footstep this frame (the caller plays it where he is).</summary>
    public bool Stepped { get; private set; }
    public bool Hurry { get; private set; }
    /// <summary>M8f: goods in his arms (the goods' part puts them on his shoulder and sets this): the carry walk.</summary>
    public bool Carrying;
    /// <summary>The figure's root, for what he carries.</summary>
    public Node3D? Root => Figure?.Root;

    private readonly PanelContainer tag;
    private readonly Label tagText;
    private float stepDist;
    private float lastX = float.NaN, lastZ = float.NaN;

    public RemoteFigure(int id)
    {
        Id = id;
        // .mp-tag: 13px print, ink on paper, a thin border
        var box = new StyleBoxFlat
        {
            BgColor = new Color(233 / 255f, 225 / 255f, 203 / 255f, 0.86f),
            BorderColor = new Color(34 / 255f, 27 / 255f, 21 / 255f, 0.45f),
            ContentMarginLeft = 7, ContentMarginRight = 7, ContentMarginTop = 1, ContentMarginBottom = 2,
            ShadowColor = new Color(0, 0, 0, 0.3f), ShadowSize = 2, ShadowOffset = new Vector2(0, 1),
        };
        box.SetBorderWidthAll(1);
        tag = new PanelContainer { MouseFilter = Control.MouseFilterEnum.Ignore, Visible = false };
        tag.AddThemeStyleboxOverride("panel", box);
        tagText = new Label { LabelSettings = new LabelSettings { Font = Fonts.Print, FontSize = 13, FontColor = new Color("221b15") }, MouseFilter = Control.MouseFilterEnum.Ignore };
        tag.AddChild(tagText);
        Main.I.Ui.AddChild(tag);
        Main.I.Ui.MoveChild(tag, 0); // under the HUD's papers and the windows
    }

    /// <summary>His name, "away", and his body (made again only when his look changed).</summary>
    public void Dress(RosterEntry r, string kind)
    {
        string label = r.Name + (r.Away ? " · away" : "");
        if (tagText.Text != label)
        {
            tagText.Text = label;
            tag.ResetSize();
        }
        Name = r.Name;
        Away = r.Away;
        if (r.Code == Code && Figure != null) return;
        var h = Humans.Make(kind);
        if (h == null) return; // the models are not in yet: asked again with the next roster
        Figure?.Root.QueueFree();
        h.Root.Visible = false;
        Main.I.View.AddChild(h.Root);
        h.Start();
        Figure = h;
        Code = r.Code;
    }

    public void Place(in Pose p, float dt)
    {
        var f = Figure;
        Stepped = false;
        if (f == null) return;
        string mode = p.Mode >= 0 && p.Mode < MpProtocol.Modes.Length ? MpProtocol.Modes[p.Mode] : "walk";
        bool grounded = (p.Flags & MpProtocol.FlagGrounded) != 0;
        float y = p.Y;
        if ((mode is "walk" or "crouch") && grounded && Jef.I != null)
        {
            float g = Jef.I.GroundAt(p.X, p.Z, p.Y, 0.2f);
            if (float.IsFinite(g) && Math.Abs(g - p.Y) < 0.45f) y = g;
        }
        At = new Vector3(p.X, y, p.Z);
        Yaw = p.Yaw;
        Shown = mode != "fly";
        f.Root.Visible = Shown;
        bool crouch = mode == "crouch";
        f.Root.Position = new Vector3(p.X, y - (crouch ? 0.4f : 0), p.Z);
        f.Root.Rotation = new Vector3(0, p.Yaw + MathF.PI, 0);
        float speed = p.Stale ? 0 : p.Speed;
        bool inAir = !grounded && mode is "walk" or "crouch";
        string motion =
            mode == "row" ? "row" : mode is "bike" or "sit" ? "ride" : crouch ? "crouch" : mode == "swim" ? "walk" : inAir ? "idle" : speed > 0.35f && mode is not ("ladder" or "climb" or "ride") ? "walk" : "idle";
        // (M8f: goods on his shoulder: the dockers' carry clip, walking or standing)
        f.Play(Carrying && motion is "walk" or "idle" && mode == "walk" ? "carry" : motion);
        f.SetPace(mode == "swim" ? Math.Max(0.4f, speed * 0.6f) : speed);
        f.Update(dt);
        // footsteps by the distance walked on the ground (as the own body's)
        if (!float.IsNaN(lastX) && grounded && mode is "walk" or "crouch")
        {
            stepDist += MathF.Sqrt((p.X - lastX) * (p.X - lastX) + (p.Z - lastZ) * (p.Z - lastZ));
            if (stepDist > 0.72f)
            {
                stepDist = 0;
                Stepped = true;
            }
        }
        Hurry = (p.Flags & MpProtocol.FlagHurry) != 0;
        lastX = p.X;
        lastZ = p.Z;
    }

    public void Hide()
    {
        if (Figure != null) Figure.Root.Visible = false;
        Shown = false;
        tag.Visible = false;
    }

    /// <summary>The name over his head: on screen, near enough, not behind the camera.</summary>
    public void DrawTag(Camera3D cam, Vector2 win, Vector2 view)
    {
        if (!Shown)
        {
            tag.Visible = false;
            return;
        }
        var point = new Vector3(At.X, At.Y + HeadM + 0.25f, At.Z);
        float d = cam.GlobalPosition.DistanceTo(At);
        if (d > TagM || cam.IsPositionBehind(point) || view.X < 1 || view.Y < 1)
        {
            tag.Visible = false;
            return;
        }
        var on = cam.UnprojectPosition(point) * win / view;
        if (on.X < -0.05f * win.X || on.X > 1.05f * win.X || on.Y < -0.05f * win.Y || on.Y > 1.05f * win.Y)
        {
            tag.Visible = false;
            return;
        }
        tag.Visible = true;
        tag.Position = new Vector2(MathF.Round(on.X - tag.Size.X / 2), MathF.Round(on.Y - tag.Size.Y));
        tag.Modulate = new Color(1, 1, 1, Math.Max(0.35f, 1 - d / TagM));
    }

    public void Dispose()
    {
        Figure?.Root.QueueFree();
        Figure = null;
        tag.QueueFree();
    }
}
