using System;
using System.IO;
using System.Linq;
using Godot;

namespace Scheldemist.Native.Authoring;

public partial class WorkshopUi : Control
{
    private WorkshopSession session = null!;
    private PanelContainer side = null!, top = null!;
    private Label state = null!, message = null!, selection = null!;
    private ItemList placed = null!;
    private Button undo = null!, redo = null!, save = null!, walk = null!, move = null!, duplicate = null!, delete = null!;
    private SpinBox x = null!, z = null!, angle = null!;
    private LineEdit search = null!;
    private OptionButton category = null!;
    private VBoxContainer library = null!;
    private bool refreshing;
    private ConfirmationDialog quit = null!;

    public void Bind(WorkshopSession world)
    {
        session = world;
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect); MouseFilter = MouseFilterEnum.Ignore;
        var theme = new Theme { DefaultFontSize = 16 };
        var panelStyle = new StyleBoxFlat { BgColor = new Color("18252eea"), CornerRadiusTopLeft = 8, CornerRadiusTopRight = 8,
            CornerRadiusBottomLeft = 8, CornerRadiusBottomRight = 8, ContentMarginLeft = 16, ContentMarginRight = 16, ContentMarginTop = 12, ContentMarginBottom = 12 };
        theme.SetStylebox("panel", "PanelContainer", panelStyle); Theme = theme;
        top = new PanelContainer { OffsetLeft = 18, OffsetTop = 16, OffsetRight = -18, OffsetBottom = 70, AnchorRight = 1 };
        AddChild(top);
        var bar = new HBoxContainer(); bar.AddThemeConstantOverride("separation", 12); top.AddChild(bar);
        bar.AddChild(new Label { Text = "SCHELDEMIST  /  TOWN WORKSHOP", SizeFlagsHorizontal = SizeFlags.ExpandFill });
        walk = Button(bar, "Walk the quay · F2", () => session.SetEditing(!session.Editing));
        Button(bar, "Day / night", () => session.SetNight(!session.Night));
        undo = Button(bar, "Undo", session.Undo); redo = Button(bar, "Redo", session.Redo);
        save = Button(bar, "Save · Ctrl+S", () => session.Save());
        Button(bar,"Save into game map",()=>session.PromoteMap());
        Button(bar, "Export scene", () => {
            if (session.Save()) session.ExportScene(Path.Combine(Path.GetDirectoryName(session.Store.File)!, "objects-export.tscn"));
        });

        side = new PanelContainer { OffsetLeft = 18, OffsetTop = 84, OffsetRight = 320, OffsetBottom = -108, AnchorBottom = 1 };
        AddChild(side);
        var sideScroll=new ScrollContainer{HorizontalScrollMode=ScrollContainer.ScrollMode.Disabled};side.AddChild(sideScroll);
        var col = new VBoxContainer{SizeFlagsHorizontal=SizeFlags.ExpandFill}; col.AddThemeConstantOverride("separation", 6); sideScroll.AddChild(col);
        col.AddChild(new Label { Text = "OBJECT LIBRARY" });
        var rooms = new OptionButton(); col.AddChild(rooms); rooms.AddItem("Enter a room…");
        foreach(var room in World.NativeDistrictLayouts.Available().Where(d=>d.RoomId!=""))
        {rooms.AddItem(room.Title);rooms.SetItemMetadata(rooms.ItemCount-1,room.Id);}
        rooms.ItemSelected += i => {if(i>0)session.EnterRoom(rooms.GetItemMetadata((int)i).AsString());};
        category = new OptionButton(); col.AddChild(category);
        category.ItemSelected += _ => FilterLibrary();
        RefreshCategories();
        search = new LineEdit { PlaceholderText = "Find an object…" }; col.AddChild(search); search.TextChanged += _ => FilterLibrary();
        var libraryScroll = new ScrollContainer { CustomMinimumSize = new Vector2(0, 104), HorizontalScrollMode = ScrollContainer.ScrollMode.Disabled };
        col.AddChild(libraryScroll);
        library = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill }; libraryScroll.AddChild(library); FilterLibrary();
        var grid = new HBoxContainer(); col.AddChild(grid);
        var snap = new CheckButton { Text = "Snap", ButtonPressed = true }; grid.AddChild(snap); snap.Toggled += value => session.Snap = value;
        var distance = new SpinBox { MinValue = 0.05, MaxValue = 2, Step = 0.05, Value = 0.25, Suffix = "m", SizeFlagsHorizontal = SizeFlags.ExpandFill };
        grid.AddChild(distance); distance.ValueChanged += value => session.Grid = (float)value;
        col.AddChild(new HSeparator()); col.AddChild(new Label { Text = "PLACED OBJECTS" });
        placed = new ItemList { CustomMinimumSize = new Vector2(0, 84), SizeFlagsVertical = SizeFlags.ExpandFill };
        col.AddChild(placed); placed.ItemSelected += i => { if (!refreshing) session.Select(placed.GetItemMetadata((int)i).AsString()); };
        selection = new Label { Text = "Select an object in the town." }; col.AddChild(selection);
        x = Number(col, "X", session.District.Bounds.Position.X, session.District.Bounds.End.X, 0.05);
        z = Number(col, "Z", session.District.Bounds.Position.Y, session.District.Bounds.End.Y, 0.05); angle = Number(col, "Turn", -3600, 3600, 15);
        Button(col, "Apply position", ApplyPosition);
        var actions = new HBoxContainer(); col.AddChild(actions);
        move = Button(actions, "Move", session.MoveSelected); duplicate = Button(actions, "Copy", session.DuplicateSelected); delete = Button(actions, "Delete", session.DeleteSelected);
        Button(col, "Cancel placement · Esc", session.CancelPreview);

        var bottom = new PanelContainer { AnchorTop = 1, AnchorRight = 1, AnchorBottom = 1, OffsetLeft = 18, OffsetRight = -18, OffsetTop = -92, OffsetBottom = -16 };
        AddChild(bottom); var lines = new VBoxContainer(); bottom.AddChild(lines);
        state = new Label(); lines.AddChild(state);
        message = new Label { Text = "Choose an object, then click the quay. Hold right mouse + WASD to look and move; Q/E down/up." }; lines.AddChild(message);
        quit = new ConfirmationDialog { Title = "Leave the workshop?", DialogText = "There are unsaved changes to the town layout.", OkButtonText = "Leave without saving" };
        AddChild(quit); quit.Confirmed += () => GetTree().Quit();
        quit.AddButton("Save and leave", true, "save");
        quit.CustomAction += action => { if (action == "save" && session.Save()) GetTree().Quit(); };
        Refresh();
    }
    private static Button Button(Node parent, string text, Action action)
    {
        var button = new Button { Text = text, FocusMode = FocusModeEnum.None }; button.Pressed += action; parent.AddChild(button); return button;
    }
    private static SpinBox Number(Node parent, string label, double min, double max, double step)
    {
        var row = new HBoxContainer(); parent.AddChild(row);
        row.AddChild(new Label { Text = label, CustomMinimumSize = new Vector2(45, 0) });
        var number = new SpinBox { MinValue = min, MaxValue = max, Step = step, SizeFlagsHorizontal = SizeFlags.ExpandFill };
        row.AddChild(number); return number;
    }
    private void FilterLibrary()
    {
        foreach (var child in library.GetChildren()) { library.RemoveChild(child); child.QueueFree(); }
        string selectedCategory=category.Selected>0?category.GetItemText(category.Selected):"";
        foreach (var asset in session.Assets.Values.Where(a => (selectedCategory==""||a.Category==selectedCategory)&&a.Title.Contains(search.Text, StringComparison.OrdinalIgnoreCase)).OrderBy(a=>a.Category).ThenBy(a=>a.Title))
        {
            var button=Button(library, asset.Title, () => session.BeginPlace(asset.Id));
            button.TextOverrunBehavior=TextServer.OverrunBehavior.TrimEllipsis;button.TooltipText=asset.Category+" · "+asset.Title;
        }
    }
    private void RefreshCategories()
    {
        string previous=category.Selected>0?category.GetItemText(category.Selected):"";
        category.Clear();category.AddItem("All categories");
        foreach(string name in session.Assets.Values.Select(a=>a.Category).Distinct().Order())
        {category.AddItem(name);if(name==previous)category.Select(category.ItemCount-1);}
    }
    public void RefreshLibrary() { RefreshCategories(); FilterLibrary(); }
    private void ApplyPosition()
    {
        if (session.SelectedId == null || !session.Instances.TryGetValue(session.SelectedId, out var node)) return;
        if (!session.SetSelectedPose(new Vector3((float)x.Value, node.Position.Y, (float)z.Value), (float)angle.Value)) Refresh();
    }
    public void Refresh()
    {
        if (state == null) return;
        refreshing = true;
        x.MinValue=session.District.Bounds.Position.X;x.MaxValue=session.District.Bounds.End.X;
        z.MinValue=session.District.Bounds.Position.Y;z.MaxValue=session.District.Bounds.End.Y;
        placed.Clear();
        foreach (var obj in session.Document.Objects)
        {
            string label = obj.Id.Length == 32 ? obj.Id[..6] : obj.Id;
            int i = placed.AddItem(session.Assets[obj.Asset].Title + " · " + label);
            placed.SetItemMetadata(i, obj.Id); if (obj.Id == session.SelectedId) placed.Select(i);
        }
        bool selected = session.SelectedId != null && session.Instances.ContainsKey(session.SelectedId);
        move.Disabled = duplicate.Disabled = delete.Disabled = !selected;
        if (selected)
        {
            var obj = session.Instances[session.SelectedId!]; selection.Text = obj.Asset!.Title;
            x.Value = obj.Position.X; z.Value = obj.Position.Z; angle.Value = Mathf.RadToDeg(obj.Rotation.Y);
        }
        else selection.Text = session.District.RoomId!=""?"Select an object in this room.":"Select an object in the town.";
        x.Editable=z.Editable=angle.Editable=selected;
        undo.Disabled = !session.History.CanUndo; redo.Disabled = !session.History.CanRedo;
        save.Disabled = !session.Store.Writable;
        walk.Text = session.Editing ? (session.District.RoomId!=""?"Walk the room · F2":"Walk the quay · F2") : "Edit town · F2";
        side.Visible = session.Editing;
        state.Text = $"{session.District.Title}  ·  {(session.Editing ? "EDITING" : "WALKING")}  ·  {session.Document.Objects.Count} objects  ·  {(session.Night ? "Night" : "Day")}  ·  {(session.Dirty ? "Unsaved changes" : "Layout saved")}";
        refreshing = false;
    }
    public bool OverPanel(Vector2 p) => (side.Visible && side.GetGlobalRect().HasPoint(p)) || top.GetGlobalRect().HasPoint(p) || p.Y > GetViewportRect().Size.Y - 85;
    public void Note(string text) => message.Text = text;
    public void PreviewNote(string text) { if (message.Text != text) message.Text = text; }
    public void ConfirmQuit() => quit.PopupCentered(new Vector2I(520, 180));
}
