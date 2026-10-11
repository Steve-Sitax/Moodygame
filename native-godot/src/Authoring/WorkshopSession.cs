using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Authoring;

/// <summary>Godot-native scene instances and layout edits. No Main, BakedWorld, Node server or browser dependencies.</summary>
public partial class WorkshopSession : Node3D
{
    [Export] public AuthorCatalog Catalog { get; set; } = null!;
    [Export] public string DistrictId { get; set; } = "quay-pilot";
    public Dictionary<string, AuthorAsset> Assets { get; private set; } = new();
    public LayoutDocument Document { get; private set; } = null!;
    public LayoutStore Store { get; private set; } = null!;
    public EditHistory History { get; } = new();
    public WorkshopCamera Camera { get; private set; } = null!;
    public bool Editing => Camera.Editing;
    public bool Night { get; private set; }
    public bool Dirty => saved != Document.Encode();
    public string? SelectedId { get; private set; }
    public IReadOnlyDictionary<string, AuthoredObject> Instances => objects;
    public WorkshopUi Ui { get; private set; } = null!;
    public bool Snap { get; set; } = true;
    public float Grid { get; set; } = 0.25f;
    public bool HasPreview => ghost != null;
    private Node3D objectRoot = null!;
    private readonly Dictionary<string, AuthoredObject> objects = new();
    private string saved = "";
    private string? previewAsset, movingId;
    private Node3D? ghost;
    private Placement? candidate;
    private Vector3 previewRotation, previewScale = Vector3.One;
    private bool previewValid;
    private Vector2? click;
    private string previewReason = "";
    private readonly StandardMaterial3D previewMaterial = new()
    {
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded
    };

    public override void _Ready()
    {
        try
        {
            Assets = Catalog.Index();
            Camera = GetNode<WorkshopCamera>("Camera");
            objectRoot = GetNode<Node3D>("District/Objects");
            Document = new() { District = DistrictId, Objects = objectRoot.GetChildren().OfType<AuthoredObject>().Select(o => o.Record()).ToList() };
            Document.Validate(DistrictId, Assets);
            foreach (var node in objectRoot.GetChildren().OfType<AuthoredObject>()) objects.Add(node.ObjectId, node);
            var directory = Arg("author-dir", ProjectSettings.GlobalizePath("user://layouts/" + DistrictId));
            Store = new LayoutStore(Path.Combine(directory, "layout.json"));
            string? warning = null;
            try
            {
                if (Store.Read() is { } loaded) { loaded.Validate(DistrictId, Assets); Apply(loaded); }
            }
            catch (Exception e) when (e is IOException or System.Text.Json.JsonException or InvalidOperationException)
            {
                Store.RefuseWrites(); warning = "Your saved layout was kept unchanged. " + e.Message;
            }
            saved = Document.Encode();
            Ui = new WorkshopUi(); GetNode<CanvasLayer>("Ui").AddChild(Ui); Ui.Bind(this);
            GetTree().AutoAcceptQuit = false;
            GetTree().Root.CloseRequested += RequestQuit;
            if (warning != null) Ui.Note(warning);
            var proof = Arg("author-test");
            if (proof != "") _ = WorkshopProof.Run(this, proof, Arg("proof-stage", "write"));
            else if (Arg("author-shot") != "") _ = WorkshopProof.Picture(this, Arg("author-shot"));
        }
        catch (Exception e) { GD.PrintErr(e); GetTree().Quit(1); }
    }

    public static string Arg(string key, string fallback = "")
    {
        var args = OS.GetCmdlineUserArgs(); int i = Array.IndexOf(args, "--" + key);
        return i >= 0 && i + 1 < args.Length && !args[i + 1].StartsWith("--") ? args[i + 1] : fallback;
    }
    private void RequestQuit()
    {
        if (Dirty) Ui.ConfirmQuit(); else GetTree().Quit();
    }
    public override void _ExitTree()
    {
        GetTree().Root.CloseRequested -= RequestQuit;
        Input.MouseMode = Input.MouseModeEnum.Visible;
    }

    private static IEnumerable<Node> Nodes(Node node)
    {
        yield return node;
        foreach (var child in node.GetChildren()) foreach (var descendant in Nodes(child)) yield return descendant;
    }
    public void SetNight(bool night)
    {
        Night = night;
        GetNode<DirectionalLight3D>("Sun").LightEnergy = night ? 0.08f : 1.1f;
        GetNode<WorldEnvironment>("Environment").Environment.AmbientLightEnergy = night ? 0.15f : 0.65f;
        foreach (var lamp in Nodes(objectRoot).OfType<WorkshopLamp>()) lamp.SetNight(night);
        Ui?.Refresh();
    }
    public void SetEditing(bool editing) { CancelPreview(); Camera.SetEditing(editing); Ui.Refresh(); }

    private void Apply(LayoutDocument document)
    {
        document.Validate(DistrictId, Assets);
        var wanted = document.Objects.Select(p => p.Id).ToHashSet(StringComparer.Ordinal);
        foreach (var id in objects.Keys.Where(id => !wanted.Contains(id)).ToArray())
        {
            var node = objects[id]; objectRoot.RemoveChild(node); node.QueueFree(); objects.Remove(id);
        }
        foreach (var p in document.Objects)
        {
            if (!objects.TryGetValue(p.Id, out var node))
            {
                node = new AuthoredObject { ObjectId = p.Id, Asset = Assets[p.Asset], Name = "object_" + p.Id };
                objectRoot.AddChild(node); objects.Add(p.Id, node);
            }
            else if (node.Asset?.Id != p.Asset) node.Asset = Assets[p.Asset];
            node.Pose(p);
            foreach (var lamp in Nodes(node).OfType<WorkshopLamp>()) lamp.SetNight(Night);
        }
        Document = document.Copy();
        if (SelectedId != null && !objects.ContainsKey(SelectedId)) SelectedId = null;
        Ui?.Refresh();
    }
    private void Commit(LayoutDocument next)
    {
        var before = Document.Copy(); Apply(next); History.Add(before, next); Ui?.Refresh();
    }
    public void Undo() { CancelPreview(); if (History.Undo() is { } doc) Apply(doc); }
    public void Redo() { CancelPreview(); if (History.Redo() is { } doc) Apply(doc); }
    public void Select(string? id) { SelectedId = id != null && objects.ContainsKey(id) ? id : null; Ui?.Refresh(); }
    public void DeleteSelected()
    {
        if (SelectedId == null) return;
        CancelPreview(); var next = Document.Copy(); next.Objects.RemoveAll(p => p.Id == SelectedId); Commit(next);
    }
    public bool Place(string asset, Vector3 position, Vector3 rotation, Vector3 scale, string? move = null)
    {
        if (!Assets.ContainsKey(asset)) return false;
        var placement = new Placement { Id = move ?? Guid.NewGuid().ToString("N"), Asset = asset,
            Position = LayoutDocument.Floats(position), Rotation = LayoutDocument.Floats(rotation), Scale = LayoutDocument.Floats(scale) };
        var next = Document.Copy(); next.Objects.RemoveAll(p => p.Id == move); next.Objects.Add(placement);
        next.Validate(DistrictId, Assets);
        if (move != null && !objects.ContainsKey(move)) return false;
        if (!Clear(placement, out var why)) { Ui.Note(why); return false; }
        CancelPreview(); Commit(next); Select(placement.Id); return true;
    }
    public bool SetSelectedPose(Vector3 position, float yawDegrees)
    {
        if (SelectedId == null || !objects.TryGetValue(SelectedId, out var node)) return false;
        var rotation = node.Rotation; rotation.Y = Mathf.DegToRad(yawDegrees);
        return Place(node.Asset!.Id, position, rotation, node.Scale, SelectedId);
    }
    public bool Save()
    {
        try
        {
            Document.Validate(DistrictId, Assets); Store.Save(Document); saved = Document.Encode();
            Ui.Refresh(); Ui.Note("Town layout saved."); return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException)
        { Ui.Note(e.Message); return false; }
    }
    /// <summary>Export only authored wrappers. Shared asset scenes remain references, so later art updates propagate.</summary>
    public bool ExportScene(string file)
    {
        var root = new Node3D { Name = "Objects" };
        try
        {
            foreach (var p in Document.Objects)
            {
                var node = new AuthoredObject { ObjectId = p.Id, Asset = Assets[p.Asset], Name = "object_" + p.Id };
                root.AddChild(node); node.Owner = root; node.Pose(p);
            }
            var scene = new PackedScene(); var result = scene.Pack(root);
            if (result == Error.Ok) result = ResourceSaver.Save(scene, file);
            if (result != Error.Ok) throw new IOException("The scene could not be exported: " + result);
            Ui.Note("Editable Godot scene exported."); return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException) { Ui.Note(e.Message); return false; }
        finally { root.Free(); }
    }

    public bool Clear(Placement p, out string why)
    {
        var asset = Assets[p.Asset]; var position = LayoutDocument.Vector(p.Position);
        var scale = LayoutDocument.Vector(p.Scale); var rotation = LayoutDocument.Vector(p.Rotation);
        var size = asset.Footprint * scale;
        var basis = Basis.FromEuler(rotation);
        float reach = Math.Max(size.X, size.Z) * 0.5f;
        if (Math.Abs(position.X) + reach > 19.8f || Math.Abs(position.Z) + reach > 15.8f || Math.Abs(position.Y) > 0.05f)
        { why = "Place the object on the quay."; return false; }
        var exclude = new Godot.Collections.Array<Rid>();
        if (objects.TryGetValue(p.Id, out var own)) foreach (var body in Nodes(own).OfType<CollisionObject3D>()) exclude.Add(body.GetRid());
        using var shape = new BoxShape3D { Size = size * 0.98f };
        using var query = new PhysicsShapeQueryParameters3D { Shape = shape,
            Transform = new Transform3D(basis, position + basis * new Vector3(0, size.Y * 0.5f, 0)), CollisionMask = 2, Exclude = exclude, Margin = 0.001f };
        bool free = GetWorld3D().DirectSpaceState.IntersectShape(query, 1).Count == 0;
        why = free ? "Click to place. R turns the object; Esc cancels." : "There is another object here.";
        return free;
    }
    public string? Pick(Vector2 point)
    {
        var hit = Ray(point, 3);
        if (hit.Count == 0) return null;
        for (Node? node = hit["collider"].AsGodotObject() as Node; node != null; node = node.GetParent())
            if (node is AuthoredObject obj) return obj.ObjectId;
        return null;
    }
    private Godot.Collections.Dictionary Ray(Vector2 point, uint mask)
    {
        var eye = Camera.Eye;
        using var query = PhysicsRayQueryParameters3D.Create(eye.ProjectRayOrigin(point), eye.ProjectRayOrigin(point) + eye.ProjectRayNormal(point) * 200, mask);
        return GetWorld3D().DirectSpaceState.IntersectRay(query);
    }
    public void BeginPlace(string asset, string? move = null)
    {
        if (!Editing || !Assets.ContainsKey(asset)) return;
        CancelPreview(); previewAsset = asset; movingId = move;
        previewRotation = move != null ? objects[move].Rotation : Vector3.Zero;
        previewScale = move != null ? objects[move].Scale : Vector3.One;
        ghost = Assets[asset].Scene!.Instantiate<Node3D>(); ghost.Name = "PlacementPreview";
        foreach (var node in Nodes(ghost))
        {
            if (node is CollisionObject3D body) { body.CollisionLayer = 0; body.CollisionMask = 0; }
            if (node is Light3D light) light.Visible = false;
            if (node is MeshInstance3D mesh) mesh.MaterialOverride = previewMaterial;
        }
        AddChild(ghost); ghost.Visible = false;
        if (move != null) objects[move].Visible = false;
        Ui.Refresh();
    }
    public void MoveSelected() { if (SelectedId != null) BeginPlace(objects[SelectedId].Asset!.Id, SelectedId); }
    public void DuplicateSelected()
    {
        if (SelectedId == null) return;
        var original = objects[SelectedId];
        BeginPlace(original.Asset!.Id);
        previewRotation = original.Rotation; previewScale = original.Scale;
    }
    public void CancelPreview()
    {
        if (ghost != null) { RemoveChild(ghost); ghost.QueueFree(); ghost = null; }
        if (movingId != null && objects.TryGetValue(movingId, out var original)) original.Visible = true;
        previewAsset = movingId = null; candidate = null; click = null; Ui?.Refresh();
    }
    public override void _PhysicsProcess(double delta)
    {
        if (Ui == null || !Editing) return;
        if (ghost != null && previewAsset != null)
        {
            var point = click ?? GetViewport().GetMousePosition();
            var hit = Ui.OverPanel(point) || Input.MouseMode == Input.MouseModeEnum.Captured ? new Godot.Collections.Dictionary() : Ray(point, 1);
            ghost.Visible = hit.Count > 0;
            if (ghost.Visible)
            {
                var position = hit["position"].AsVector3();
                if (Snap) { position.X = Mathf.Snapped(position.X, Grid); position.Z = Mathf.Snapped(position.Z, Grid); }
                position.Y = 0;
                candidate = new() { Id = movingId ?? "preview", Asset = previewAsset, Position = LayoutDocument.Floats(position),
                    Rotation = LayoutDocument.Floats(previewRotation), Scale = LayoutDocument.Floats(previewScale) };
                previewValid = Clear(candidate, out previewReason);
                ghost.Position = position; ghost.Rotation = previewRotation; ghost.Scale = previewScale;
                var color = previewValid ? new Color(0.32f, 0.85f, 0.55f, 0.45f) : new Color(1, 0.3f, 0.22f, 0.45f);
                previewMaterial.AlbedoColor = color;
                Ui.PreviewNote(previewReason);
                if (click != null && previewValid) Place(previewAsset, position, previewRotation, previewScale, movingId);
            }
        }
        else if (click != null) Select(Pick(click.Value));
        click = null;
    }
    public override void _UnhandledInput(InputEvent e)
    {
        if (e is InputEventMouseButton b && b.ButtonIndex == MouseButton.Right)
        {
            Input.MouseMode = b.Pressed ? Input.MouseModeEnum.Captured : Input.MouseModeEnum.Visible;
            GetViewport().SetInputAsHandled();
        }
        else if (e is InputEventMouseMotion m && Input.MouseMode == Input.MouseModeEnum.Captured) Camera.Look(m);
        else if (e is InputEventMouseButton { Pressed: true, ButtonIndex: MouseButton.Left } left && Editing) click = left.Position;
        else if (e is InputEventKey { Pressed: true, Echo: false } key)
        {
            if (GetViewport().GuiGetFocusOwner() is LineEdit or SpinBox) return;
            bool handled = true;
            if (key.Keycode == Key.F2) SetEditing(!Editing);
            else if (key.Keycode == Key.Escape) { Input.MouseMode = Input.MouseModeEnum.Visible; CancelPreview(); }
            else if (!Editing) handled = false;
            else if (key.CtrlPressed && key.Keycode == Key.S) Save();
            else if (key.CtrlPressed && key.Keycode == Key.Z) { if (key.ShiftPressed) Redo(); else Undo(); }
            else if (key.CtrlPressed && key.Keycode == Key.Y) Redo();
            else if (key.CtrlPressed && key.Keycode == Key.D) DuplicateSelected();
            else if (key.Keycode == Key.Delete) DeleteSelected();
            else if (key.Keycode == Key.R && ghost != null) previewRotation.Y += Mathf.DegToRad(key.ShiftPressed ? -15 : 15);
            else handled = false;
            if (handled) GetViewport().SetInputAsHandled();
        }
    }

    public override void _Input(InputEvent e)
    {
        if (Ui == null || e is not InputEventKey { Pressed: true, Echo: false } key) return;
        // These actions remain available while a numeric or search field owns keyboard focus.
        if (key.Keycode == Key.F2) SetEditing(!Editing);
        else if (key.Keycode == Key.Escape)
        {
            Input.MouseMode = Input.MouseModeEnum.Visible; GetViewport().GuiGetFocusOwner()?.ReleaseFocus(); CancelPreview();
        }
        else if (Editing && key.CtrlPressed && key.Keycode == Key.S) Save();
        else return;
        GetViewport().SetInputAsHandled();
    }
}
