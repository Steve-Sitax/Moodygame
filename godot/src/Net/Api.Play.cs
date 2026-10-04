using System.Threading.Tasks;
using Scheldemist.Play;
using Scheldemist.Talks;

namespace Scheldemist.Net;

// Typed player calls kept beside Api.cs, like Api.Menu.cs; the same routes as game/press.ts.
public sealed partial class Api
{
    public Task<PressInfo> PressInfo() => Get<PressInfo>("api/press");
    public Task<PostReply> PostPickup(PostAsk ask) => Post<PostReply>("api/post/pickup", ask);
    public Task<PostReply> PostDeliver(PostAsk ask) => Post<PostReply>("api/post/deliver", ask);
    public Task<PostReply> PostTelegram(PostAsk ask) => Post<PostReply>("api/post/telegram", ask);
}
