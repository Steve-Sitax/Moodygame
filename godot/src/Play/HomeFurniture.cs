using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.World;
using Scheldemist.Render;

namespace Scheldemist.Play;

/// <summary>homes.ts furniture: arms, stored pieces, a room-grid preview, rotation and server placement.</summary>
[GamePart(365)]
public partial class HomeFurniture : Node
{
    public static HomeFurniture I { get; private set; } = null!;
    private sealed record Def(string Layer, string Carry, int W, int D);
    private readonly Dictionary<string, Def> defs = new();
    private readonly Dictionary<string, JsonElement> classes = new();
    private readonly Dictionary<string, Node3D> templates = new();
    private readonly Dictionary<int, Node3D> shown = new();
    private readonly Dictionary<int, StaticBody3D> solids = new();
    private HomesView? last;
    private HomeItem? moving, arms;
    private Node3D? held, ghost;
    private Material good = null!, bad = null!;
    private ShaderMaterial lampGlass=null!;
    public float LampHeight(string home)=>Math.Min(classes[home].GetProperty("H").GetSingle()-.55f,2.05f)+.12f;
    private double poll;
    private readonly Action<Vector3,float>[] lampSpill = new Action<Vector3,float>[4];
    private double flicker;
    public int LitLamps { get; private set; }
    public HomeItem? CarriedFurniture => arms;
    public Vector3? PositionOf(int id)=>shown.TryGetValue(id,out var model)?model.GlobalPosition:null;
    public event Action<JsonElement>? CartChanged;
    public bool CartBusy { get; private set; }
    private int cartGeneration;
    private void CartReset(string how,ClientState? saved){cartGeneration++;last=null;Cancel();}
    public async Task LoadToCart(string cart)
    {
        if(CartBusy||arms==null||HomeLife.I.Busy||ServerLink.I?.Api is not {} api)return;
        CartBusy=true;int generation=cartGeneration;
        try{var reply=await api.IndoorCartLoad(cart,arms.Id,arms.Kind,Jef.I.X,Jef.I.Z);if(dead||generation!=cartGeneration)return;GameState.I.Apply(reply);CartChanged?.Invoke(reply.Carts);await ReloadHomes();}
        catch(ApiException e){GameState.I.Say(e.Message);}finally{CartBusy=false;}
    }
    public async Task LiftFromCart(string cart,int? index=null)
    {
        if(CartBusy||HomeLife.I.Busy||ServerLink.I?.Api is not {} api)return;
        CartBusy=true;int generation=cartGeneration;
        try{var reply=await api.IndoorCartUnload(cart,Jef.I.X,Jef.I.Z,index);if(dead||generation!=cartGeneration)return;GameState.I.Apply(reply);CartChanged?.Invoke(reply.Carts);await ReloadHomes();}
        catch(ApiException e){GameState.I.Say(e.Message);}finally{CartBusy=false;}
    }
    public Node3D CartModel(string kind) => (Node3D)templates[kind].Duplicate();
    public void RefreshAfterCart() { last = null; _ = ReloadHomes(); }
    private async Task ReloadHomes()
    {
        long end=System.Environment.TickCount64+10000;
        while(HomeLife.I.Busy&&!dead&&System.Environment.TickCount64<end)await Task.Delay(25);
        if(dead)return;await HomeLife.I.Load();Sync();
    }
    private int gx, gz, rot, oldX = int.MinValue, oldZ, oldRot;
    private string prompt = "";
    private bool valid, dead;
    private readonly byte[] occupied = new byte[512];
    private readonly bool[] seen = new bool[512];
    private readonly int[] queue = new int[512];
    public HomeItem? Moving => moving;
    public bool CanPut => valid;
    public HomePlace Preview => new(moving!.Id, gx, gz, rot);
    public override void _Ready()
    {
        I = this;
        using var doc = JsonDocument.Parse(File.ReadAllText(ProjectSettings.GlobalizePath("res://assets/places.json")));
        foreach (var h in doc.RootElement.GetProperty("homes").EnumerateArray()) classes[h.GetProperty("id").GetString()!] = h.GetProperty("definition").Clone();
        lampGlass=(ShaderMaterial)Goods.I.Plain(0xffd490).Duplicate();lampGlass.Shader=Psx.ShaderOf(Psx.KindOf(lampGlass.Shader)!.Value with {Unlit=true});
        foreach (var f in doc.RootElement.GetProperty("furniture").EnumerateObject()) { var d = f.Value; defs[f.Name] = new(d.GetProperty("layer").GetString()!, d.GetProperty("carry").GetString()!, d.GetProperty("w").GetInt32(), d.GetProperty("d").GetInt32()); templates[f.Name] = Make(f.Name); }
        good = Goods.I.Plain(0x71924e); bad = Goods.I.Plain(0xa14d42);
        for (int i=0;i<lampSpill.Length;i++) lampSpill[i]=Lights.I.AddMoving("home furniture lamp "+i, new Color(1,.68f,.32f), .6f);
        Interact.I.AddProvider(Keys);
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=CartReset;
    }
    private HomeLife.HomeFrame? Room()
    {
        var homes = HomeLife.I; return homes.Info?.Lease is { } l && homes.Frames.TryGetValue(l.Home, out var f) && f.Inside && ServerLink.I?.Api?.Guest == false ? f : null;
    }
    public override void _Process(double delta)
    {
        if (dead) return;
        flicker += delta; int lamps=0;
        foreach(var item in last?.Items ?? EmptyItems)
            if(item.Kind=="lamp" && item.State=="placed" && shown.TryGetValue(item.Id,out var model) && model.Visible && lamps<4 && HomeLife.I.Frames.TryGetValue(item.Home!,out var room) && room.Inside)
            { lampSpill[lamps++](model.Position+Vector3.Up*(LampHeight(item.Home!)-.07f),.3f*(.96f+.04f*(float)Math.Sin(flicker*7.3+item.Id))); }
        LitLamps=lamps; while(lamps<4)lampSpill[lamps++](Vector3.Zero,0);
        if ((poll -= delta) <= 0) { poll = 0.25; if (last != HomeLife.I.Info) Sync(); }
        if (moving != null) { if (Room() == null) Cancel(); else UpdatePreview(); }
    }
    private static readonly List<HomeItem> EmptyItems = new();
    private void Sync()
    {
        last = HomeLife.I.Info;
        foreach (var n in shown.Values) n.Visible = false;
        foreach (var b in solids.Values) b.CollisionLayer = 0;
        var nextArms = last?.Items.FirstOrDefault(i => i.State == "arms");
        if (nextArms?.Id != arms?.Id)
        {
            held?.QueueFree(); held = null; arms = nextArms;
            if (arms != null) { held = (Node3D)templates[arms.Kind].Duplicate(); held.Position = new(0.05f, -0.62f, -1.05f); held.Rotation = new(0.05f, 0.3f, 0); held.Scale = Vector3.One * (arms.Kind is "stove" or "table" ? 0.62f : 0.8f); Main.I.Cam.AddChild(held); }
            if (Goods.I.Carried == null) { Jef.I.Laden = arms != null; Jef.I.SpeedFactor = arms?.Kind == "stove" ? 0.6f : arms != null ? 0.8f : 1; }
        }
        if (last == null) { Cancel(); return; }
        foreach (var item in last.Items)
        {
            if (item.State != "placed" || item.Id == moving?.Id || item.Home == null || !HomeLife.I.Frames.TryGetValue(item.Home, out var f)) continue;
            if (!shown.TryGetValue(item.Id, out var model)) { model = (Node3D)templates[item.Kind].Duplicate(); Main.I.View.AddChild(model); shown[item.Id] = model;
                if(item.Kind=="clock") Scheldemist.Movers.Clocks.I.AddDial(model,new(0,1.74f,.164f),Vector3.Back,.105f,Goods.I.Plain(0x26221e),"home furniture clock",item.Home);
            }
            Pose(model, f, item.Kind, item.Gx!.Value, item.Gz!.Value, item.Rot); model.Visible = true;
            if (defs[item.Kind].Layer == "floor")
            {
                if (!solids.TryGetValue(item.Id, out var body)) { body = new StaticBody3D { CollisionLayer = Solid.Layer, CollisionMask = 0 }; var d = defs[item.Kind]; body.AddChild(new CollisionShape3D { Shape = new BoxShape3D { Size = new(d.W * 0.5f - 0.1f, 0.6f, d.D * 0.5f - 0.1f) }, Position = new(0, 0.3f, 0) }); Main.I.View.AddChild(body); solids[item.Id] = body; }
                body.GlobalTransform = model.GlobalTransform; body.CollisionLayer = Solid.Layer;
            }
        }
        oldX = int.MinValue;
    }
    private Offers? Keys(float x, float z)
    {
        if (dead || HomeLife.I.Busy) return null;
        var f = Room();
        if (moving != null) return new Offers { Only = new() { Act.Me(Key.E, prompt, () => _ = Put()), Act.Me(Key.R, "turn the piece", Turn), Act.Me(Key.G, "leave it where it was", Cancel) } };
        if (f == null) return arms == null ? null : new Offers { Extra = new() { Act.Me(Key.G, "leave " + arms.Name + " here", () => _ = HomeLife.I.Change(() => ServerLink.I!.Api!.HomeAbandon())) } };
        var o = new Offers { Extra = new() };
        HomeItem? next = null;
        if (last != null) foreach (var i in last.Items) if (i.State is "pocket" or "stored" or "arms") { next = i; break; }
        if (next != null) { var item = next; o.Extra.Add(Act.Me(Key.F, "put up " + item.Name, () => Begin(item))); }
        if (last != null) foreach (var item in last.Items)
            if (item.State == "placed" && item.Home == f.Id && shown.TryGetValue(item.Id, out var n) && RunWords.Dist(x, z, n.Position.X, n.Position.Z) < 1.7f)
            { var it = item; var d = defs[it.Kind];
              if(it.Kind=="stove" && RunWords.Dist(x,z,n.Position.X,n.Position.Z)<1.3f) o.Extra.Add(Act.At(Key.E,"warm yourself at the fire",n.Position+Vector3.Up*.5f,()=>_ = HomeLife.I.Change(()=>ServerLink.I!.Api!.HomeWarm())));
              o.Extra.Add(Act.At(Key.G, "move " + it.Name, n.Position + Vector3.Up * (d.Layer == "wall" ? 1.6f : d.Layer == "ceiling" ? 1.9f : 0.5f), () => Begin(it))); }
        return o;
    }
    public void Begin(HomeItem item)
    {
        if (Room() == null || moving != null) return;
        moving = item; rot = item.State == "placed" ? item.Rot : 0; ghost = (Node3D)templates[item.Kind].Duplicate(); Main.I.View.AddChild(ghost);
        if (shown.TryGetValue(item.Id, out var n)) n.Visible = false;
        if (solids.TryGetValue(item.Id, out var body)) body.CollisionLayer = 0;
        if (held != null) held.Visible = false;
        oldX = int.MinValue; UpdatePreview();
    }
    public void Turn() { if (moving != null && defs[moving.Kind].Layer is not ("wall" or "ceiling")) { rot = (rot + 1) % 4; UpdatePreview(); } }
    public void Cancel() { moving = null; ghost?.QueueFree(); ghost = null; if (held != null) held.Visible = true; last = null; }
    public async Task Put()
    {
        if (moving == null || HomeLife.I.Busy || !valid) { if (!valid) GameState.I.Say(prompt); return; }
        var ask = Preview; var item = moving;
        await HomeLife.I.Change(() => ServerLink.I!.Api!.HomePlace(ask));
        if (HomeLife.I.Info?.Items.Any(i => i.Id == item.Id && i.State == "placed" && i.Gx == ask.Gx && i.Gz == ask.Gz && i.Rot == ask.Rot) == true) { Cancel(); Sync(); }
    }
    private void UpdatePreview()
    {
        if (moving == null || ghost == null || Room() is not { } f) return;
        var d = defs[moving.Kind]; var p = f.Local(Jef.I.X, Jef.I.Z); var front = f.Local(Jef.I.X - MathF.Sin(Jef.I.Yaw), Jef.I.Z - MathF.Cos(Jef.I.Yaw));
        float tx = p.X + (front.X - p.X) * 1.1f, tz = p.Y + (front.Y - p.Y) * 1.1f;
        int nx = (int)MathF.Round(f.W * 2), nz = (int)MathF.Round(f.D * 2), w = rot % 2 == 0 ? d.W : d.D, depth = rot % 2 == 0 ? d.D : d.W;
        if (d.Layer == "wall")
        {
            float best = f.D - tz; rot = 0;
            if (f.W / 2 - tx < best) { best = f.W / 2 - tx; rot = 1; }
            if (tz < best) { best = tz; rot = 2; } if (tx + f.W / 2 < best) rot = 3;
            gx = rot is 0 or 2 ? JsRound((tx + f.W / 2) * 2 - d.W / 2f) : rot == 1 ? nx - 1 : 0;
            gz = rot is 1 or 3 ? JsRound(tz * 2 - d.W / 2f) : rot == 0 ? nz - 1 : 0;
        }
        else { if (d.Layer == "ceiling") w = depth = 1; gx = JsRound((tx + f.W / 2) * 2 - w / 2f); gz = JsRound(tz * 2 - depth / 2f); }
        if (oldX == gx && oldZ == gz && oldRot == rot) return; oldX = gx; oldZ = gz; oldRot = rot;
        string? why = Check(f, moving, gx, gz, rot);
        if (why == null && d.Layer == "floor" && p.X > -f.W / 2 + gx * 0.5f - 0.3f && p.X < -f.W / 2 + (gx + w) * 0.5f + 0.3f && p.Y > gz * 0.5f - 0.3f && p.Y < (gz + depth) * 0.5f + 0.3f) why = "you are standing there";
        valid = why == null; prompt = valid ? "set " + moving.Name + " down here (R turns it)" : why + " (R turns it)";
        Pose(ghost, f, moving.Kind, gx, gz, rot);
        foreach (var n in BakedWorld.All(ghost)) if (n is MeshInstance3D m) m.MaterialOverride = valid ? good : bad;
    }
    private static int JsRound(float n) => (int)MathF.Floor(n + 0.5f);
    private void Pose(Node3D n, HomeLife.HomeFrame f, string kind, int x, int z, int turn)
    {
        var d = defs[kind]; float px, pz, yaw;
        if (d.Layer == "wall")
        {
            px = turn is 0 or 2 ? -f.W / 2 + (x + d.W / 2f) * 0.5f : turn == 1 ? f.W / 2 - 0.02f : -f.W / 2 + 0.02f;
            pz = turn is 1 or 3 ? (z + d.W / 2f) * 0.5f : turn == 0 ? f.D - 0.02f : 0.02f; yaw = (turn + 2) % 4 * MathF.PI / 2;
        }
        else { int w = d.Layer == "ceiling" ? 1 : turn % 2 == 0 ? d.W : d.D, depth = d.Layer == "ceiling" ? 1 : turn % 2 == 0 ? d.D : d.W; px = -f.W / 2 + (x + w / 2f) * 0.5f; pz = (z + depth / 2f) * 0.5f; yaw = turn * MathF.PI / 2; }
        if(kind=="lamp"){float top=classes[f.Id].GetProperty("H").GetSingle(),y=LampHeight(f.Id)-.12f;var chain=n.GetChild<Node3D>(0);chain.Position=new(0,(top+y+.1f)/2,0);chain.Scale=new(1,(top-y-.1f)/.45f,1);n.GetChild<Node3D>(1).Position=new(0,y,0);n.GetChild<Node3D>(2).Position=new(0,y+.12f,0);}
        n.Position = f.World(px, pz); n.Rotation = new(0, f.Yaw + yaw * f.Mirror, 0); n.Scale = new(f.Mirror, 1, 1);
    }
    public string? CheckPlacement(HomeLife.HomeFrame f, HomeItem item, int x, int z, int turn) => Check(f,item,x,z,turn);
    private string? Check(HomeLife.HomeFrame f, HomeItem item, int x, int z, int turn)
    {
        var d = defs[item.Kind]; var c = classes[f.Id]; int nx = (int)MathF.Round(f.W * 2), nz = (int)MathF.Round(f.D * 2);
        int doorWall = c.TryGetProperty("doorWall", out var dw) ? dw.GetInt32() : 2, eaves = c.TryGetProperty("eaves", out var ea) ? ea.GetInt32() : 0;
        var door = c.GetProperty("door");
        if (d.Layer == "wall")
        {
            if(turn==0&&z!=nz-1 || turn==2&&z!=0 || turn==1&&x!=nx-1 || turn==3&&x!=0)return "not against a wall";
            int a = turn is 0 or 2 ? x : z, b = a + d.W - 1, length = turn is 0 or 2 ? nx : nz;
            if (a < 0 || b >= length) return "off the wall";
            bool window = false, curtains = false; foreach (var span in c.GetProperty("windows").EnumerateArray()) { window |= turn == 2 && a <= span[1].GetInt32() && b >= span[0].GetInt32(); curtains |= turn == 2 && a >= span[0].GetInt32() && b <= span[1].GetInt32(); }
            if (item.Kind == "curtains") { if (!curtains) return "curtains go at a window"; if (c.TryGetProperty("drapes", out var dr) && dr.GetBoolean()) return "heavy curtains hang there already"; }
            else if (window) return "that is the window";
            if (turn == doorWall && a <= door[1].GetInt32() && b >= door[0].GetInt32()) return "that is the door";
            if (eaves > 0 && (turn == 2 || (turn is 1 or 3 && a < eaves))) return "the roof is too low there";
            foreach (var span in c.GetProperty("noHang").EnumerateArray()) if (turn == span[0].GetInt32() && a <= span[2].GetInt32() && b >= span[1].GetInt32()) return "nothing hangs there";
            foreach (var p in last!.Items) if (p.Id != item.Id && p.State == "placed" && p.Home == f.Id && defs[p.Kind].Layer == "wall" && p.Rot == turn) { int start = turn is 0 or 2 ? p.Gx!.Value : p.Gz!.Value; if (a <= start + defs[p.Kind].W - 1 && b >= start) return "something hangs there already"; }
            return null;
        }
        int w = d.Layer == "ceiling" ? 1 : turn % 2 == 0 ? d.W : d.D, depth = d.Layer == "ceiling" ? 1 : turn % 2 == 0 ? d.D : d.W;
        if (x < 0 || z < 0 || x + w > nx || z + depth > nz) return "it does not fit there";
        if (d.Layer == "ceiling")
        {
            if (c.TryGetProperty("lampCols", out var cols) && (x < cols[0].GetInt32() || x > cols[1].GetInt32()) || eaves > 0 && z < eaves) return "the roof is too low there";
            foreach (var p in last!.Items) if (p.Id != item.Id && p.State == "placed" && p.Home == f.Id && defs[p.Kind].Layer == "ceiling" && p.Gx == x && p.Gz == z) return "a lamp hangs there already";
            return null;
        }
        Array.Clear(occupied); JsonElement bed = default;
        foreach (var fix in c.GetProperty("fixed").EnumerateArray()) { Mark(nx, fix.GetProperty("gx").GetInt32(), fix.GetProperty("gz").GetInt32(), fix.GetProperty("w").GetInt32(), fix.GetProperty("d").GetInt32(), 1); if (fix.GetProperty("kind").GetString()!.StartsWith("bed")) bed = fix; }
        foreach (var p in last!.Items) if (p.Id != item.Id && p.State == "placed" && p.Home == f.Id)
        { var pd = defs[p.Kind]; if (pd.Layer is not ("floor" or "rug")) continue; Mark(nx, p.Gx!.Value, p.Gz!.Value, p.Rot % 2 == 0 ? pd.W : pd.D, p.Rot % 2 == 0 ? pd.D : pd.W, pd.Layer == "floor" ? (byte)2 : (byte)4); }
        for (int Z = z; Z < z + depth; Z++) for (int X = x; X < x + w; X++)
        { byte flags = occupied[Z * nx + X]; if ((flags & 1) != 0) return "the room's own furniture is there"; if (d.Layer == "rug") { if ((flags & 4) != 0) return "a rug lies there already"; }
          else { if (eaves > 0 && Z < eaves) return "the roof is too low there"; if ((flags & 2) != 0) return "something stands there already"; if ((doorWall == 0 ? Z >= nz - 2 : Z <= 1) && X >= door[0].GetInt32() && X <= door[1].GetInt32()) return "that blocks the door"; } }
        if (d.Layer == "rug" || bed.ValueKind == JsonValueKind.Undefined) return null;
        Mark(nx, x, z, w, depth, 2); Array.Clear(seen); int count = 0, head = 0, row = doorWall == 0 ? nz - 1 : 0;
        for (int X = door[0].GetInt32(); X <= door[1].GetInt32(); X++) Enqueue(X, row);
        int bx = bed.GetProperty("gx").GetInt32(), bz = bed.GetProperty("gz").GetInt32(), bw = bed.GetProperty("w").GetInt32(), bd = bed.GetProperty("d").GetInt32();
        while (head < count) { int cell = queue[head++], X = cell % nx, Z = cell / nx; if ((X >= bx && X < bx + bw && (Z == bz - 1 || Z == bz + bd)) || (Z >= bz && Z < bz + bd && (X == bx - 1 || X == bx + bw))) return null; Enqueue(X + 1, Z); Enqueue(X - 1, Z); Enqueue(X, Z + 1); Enqueue(X, Z - 1); }
        return "that shuts off the bed";
        void Enqueue(int X, int Z) { if (X < 0 || Z < 0 || X >= nx || Z >= nz) return; int cell = Z * nx + X; if (seen[cell] || (occupied[cell] & 3) != 0) return; seen[cell] = true; queue[count++] = cell; }
    }
    private void Mark(int nx, int x, int z, int w, int d, byte flag) { for (int Z = z; Z < z + d; Z++) for (int X = x; X < x + w; X++) occupied[Z * nx + X] |= flag; }
    private Node3D Make(string kind)
    {
        var root = new Node3D { Name = "furniture_" + kind };
        void Box(float w, float h, float d, float x, float y, float z, int color) => root.AddChild(new MeshInstance3D { Mesh = new BoxMesh { Size = new(w,h,d), Material = Goods.I.Plain((uint)color) }, Position = new(x,y,z) });
        void Cyl(float top, float bottom, float h, float x, float y, float z, int color, int sides = 8) => root.AddChild(new MeshInstance3D { Mesh = new CylinderMesh { TopRadius = top, BottomRadius = bottom, Height = h, RadialSegments = sides, Material = Goods.I.Plain((uint)color) }, Position = new(x,y,z) });
        void Legs(float w, float d, float h, float thick) { foreach (float x in new[] { -w/2, w/2 }) foreach (float z in new[] { -d/2, d/2 }) Box(thick,h,thick,x,h/2,z,0x8a6446); }
        switch (kind)
        {
            case "chair": Box(.42f,.04f,.4f,0,.44f,0,0x9a8248); Legs(.38f,.36f,.42f,.04f); foreach (float x in new[] { -.19f,.19f }) Box(.04f,.5f,.04f,x,.7f,-.18f,0x8a6446); foreach (float y in new[] { .62f,.8f }) Box(.38f,.05f,.03f,0,y,-.18f,0x8a6446); break;
            case "table": Box(.92f,.05f,.92f,0,.74f,0,0xb09878); Legs(.86f,.86f,.72f,.06f); Cyl(.07f,.06f,.1f,.15f,.81f,-.1f,0x5a4a3a); break;
            case "rug": Box(1.4f,.015f,.95f,0,.008f,0,0x6a3a2a); for (int k = 0; k < 12; k++) Box(1.36f,.001f,.035f,0,.016f,-.45f+k*.08f,k%2==0?0x3a4a5a:0x8a7a5a); break;
            case "stove": Cyl(.22f,.24f,.55f,0,.42f,0,0x26221e,10); Cyl(.26f,.26f,.05f,0,.72f,0,0x26221e,10); Legs(.36f,.36f,.16f,.05f); Cyl(.06f,.06f,1.85f,0,1.675f,-.1f,0x26221e,6); Box(.14f,.1f,.02f,0,.36f,.235f,0xff7a2a); break;
            case "plant": Cyl(.13f,.1f,.22f,0,.11f,0,0xa0583a); Cyl(.03f,.03f,.2f,0,.3f,0,0x3a5a2a,5); for (int k=0;k<7;k++) Box(.1f,.03f,.1f,MathF.Sin(k*.9f)*.1f,.3f+k%3*.06f,MathF.Cos(k*.9f)*.1f,0x3a6a2a); Box(.07f,.06f,.07f,.04f,.46f,0,0xc02a22); Box(.07f,.06f,.07f,-.06f,.42f,.05f,0xc02a22); break;
            case "birdcage": Cyl(.18f,.2f,.03f,0,.015f,0,0x4a3424); Cyl(.02f,.02f,1.1f,0,.57f,0,0x4a3424,5); Cyl(.16f,.16f,.02f,0,1.12f,0,0x8a6446,10); for(int k=0;k<10;k++) Cyl(.006f,.006f,.32f,MathF.Sin(k*MathF.Tau/10)*.13f,1.29f,MathF.Cos(k*MathF.Tau/10)*.13f,0x8a7a50,4); Cyl(.1f,.1f,.02f,0,1.46f,0,0x8a6446,10); Box(.05f,.05f,.09f,0,1.2f,0,0x9a5a3a); Box(.04f,.04f,.04f,0,1.23f,.05f,0x5a6a7a); break;
            case "picture": Box(.44f,.54f,.03f,0,1.55f,.015f,0x4a3424); Box(.38f,.48f,.002f,0,1.55f,.032f,0xc8bc9a); Box(.04f,.35f,.002f,0,1.59f,.034f,0x6a6258); break;
            case "clock": Box(.32f,.42f,.16f,0,1.7f,.08f,0x4a3424); Box(.36f,.05f,.18f,0,1.94f,.08f,0x4a3424); Box(.24f,.24f,.002f,0,1.74f,.162f,0xe0d6bc); Box(.015f,.36f,.015f,0,1.33f,.1f,0x9a7a34); Box(.07f,.07f,.015f,0,1.15f,.1f,0x9a7a34); break;
            case "curtains": Box(1.05f,.03f,.03f,0,2.05f,.06f,0x26221e); foreach (float x in new[] { -.4f,.4f }) Box(.3f,1.2f,.03f,x,1.45f,.08f,0x7a2a22); break;
            case "lamp": Cyl(.008f,.008f,.45f,0,2.35f,0,0x26221e,4); Cyl(.08f,.09f,.09f,0,2.05f,0,0x9a7a34); Cyl(.035f,.045f,.16f,0,2.17f,0,0xffd490,6);root.GetChild<MeshInstance3D>(2).MaterialOverride=lampGlass; break;
        }
        return root;
    }
    public override void _ExitTree() { dead = true;cartGeneration++;if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=CartReset; held?.QueueFree(); ghost?.QueueFree(); foreach (var n in shown.Values) n.QueueFree(); foreach (var b in solids.Values) b.QueueFree(); foreach (var t in templates.Values) t.Free(); }
}


