using System;
using System.Linq;
using System.Threading.Tasks;
using Godot;
using Scheldemist.Game;
using Scheldemist.Net;
using Scheldemist.Player;
using Scheldemist.Town;

namespace Scheldemist.Play;

public partial class Goods
{
    public async Task<GoodsReply?> DeliverDockLoad()
    {
        var item = Carried; if (item == null) return null;
        var result = await Ask(new { op = "haul_deliver", id = item.Id });
        if (result?.Ok != true) Load();
        return result;
    }
}
[GamePart(353)]
public partial class DockWork : Node
{
    public static DockWork I { get; private set; } = null!;
    public bool InBook { get; private set; }
    private bool busy,dead;
    private int generation;
    private double poll;
    private Interact.Entry? book;
    public override void _Ready()
    {
        I = this;
        if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced+=Reset;
        book = Interact.I.Add(Vector3.Zero, 3, () => !InBook && !busy && Folk.Present("sooi") ? "ask Sooi for his book (dock work by the piece)" : null, () => _ = Sign(), Key.F);
    }
    public override void _Process(double delta)
    {
        if (book != null && Folk.At("sooi") is { } at) book.Place = at + Vector3.Up * 1.3f;
        if ((poll -= delta) <= 0 && ServerLink.I?.Up == true) { poll = 10; _ = Load(); }
    }
    private void Reset(string how,ClientState? state){generation++;InBook=false;poll=0;}
    private async Task Load() { int g=generation;try {var r=await ServerLink.I!.Api!.DockBook();if(!dead&&g==generation)InBook=r.Book;} catch (ApiException) { } }
    public async Task Sign() { if (busy) return; busy = true; int g=generation;try { var r = await ServerLink.I!.Api!.DockSign();if(dead||g!=generation)return; InBook = r.Ok; GameState.I.Say(r.Line); } catch (ApiException e) { GameState.I.Say(e.Message); } finally { busy = false; } }
    public Act? CarryAction(Item item, float x, float z)
    {
        if (!InBook || busy || !item.Id.StartsWith("haul:")) return null;
        int suffix = item.Id.LastIndexOf("a:", StringComparison.Ordinal); if (suffix < 5) return null;
        string id = item.Id[5..suffix]; var route = HaulRoute.All.FirstOrDefault(r => r.Id == id);
        if (route == null || RunWords.Dist(x, z, (float)route.B.X, (float)route.B.Z) >= 2.6f) return null;
        return Act.Me(Key.E, "set it in (paid by the piece)", () => _ = Deliver());
    }
    private async Task Deliver()
    {
        if (busy) return; busy = true;
        try { var result = await Goods.I.DeliverDockLoad(); GameState.I.Apply(await ServerLink.I!.Api!.Jobs()); GameState.I.Say(result?.Ok == true ? "In. Paid for the piece." : result?.Why ?? "It did not go in."); }
        catch (ApiException e) { GameState.I.Say(e.Message); }
        finally { busy = false; }
    }
    public override void _ExitTree() {dead=true;generation++;book?.Dispose();if(Scheldemist.Menu.MainMenu.I is {} menu)menu.WorldReplaced-=Reset;}
}
