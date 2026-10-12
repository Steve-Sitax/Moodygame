using System;
using System.IO;
using System.Net.WebSockets;
using System.Text;
using System.Threading;
using System.Threading.Channels;
using System.Threading.Tasks;
namespace Scheldemist.Native.World;
    public sealed class NativeSocketPipe : IDisposable
    {
        private readonly WebSocket socket;
        private readonly CancellationTokenSource life;
        private readonly CancellationToken lifetime;
        private readonly object lifeGate = new();
        private bool lifeDisposed;
        private readonly Channel<(byte[] Bytes, WebSocketMessageType Kind)> queue = Channel.CreateBounded<(byte[], WebSocketMessageType)>(128);
        private readonly Task writer;
        private long buffered;
        private int closeCode = 1000;
        private string closeReason = "";
        public long BufferedBytes => Interlocked.Read(ref buffered);
        public bool IsOpen => !lifetime.IsCancellationRequested && socket.State == WebSocketState.Open;
        public NativeSocketPipe(WebSocket socket, CancellationToken stop) { this.socket = socket; life = CancellationTokenSource.CreateLinkedTokenSource(stop); lifetime = life.Token; writer = Task.Run(Write); }
        private void Cancel() { lock (lifeGate) { if (!lifeDisposed) life.Cancel(); } }
        public void Text(string message) => Send(Encoding.UTF8.GetBytes(message), WebSocketMessageType.Text);
        public void Binary(byte[] bytes) => Send(bytes, WebSocketMessageType.Binary);
        private void Send(byte[] bytes, WebSocketMessageType kind)
        {
            if (!IsOpen) return;
            Interlocked.Add(ref buffered, bytes.Length);
            if (BufferedBytes > 2 * 1024 * 1024 || !queue.Writer.TryWrite((bytes, kind))) { Interlocked.Add(ref buffered, -bytes.Length); Close(1008, "Connection cannot keep up."); }
        }
        private async Task Write()
        {
            try { await foreach (var item in queue.Reader.ReadAllAsync(lifetime)) { await socket.SendAsync(item.Bytes, item.Kind, true, lifetime); Interlocked.Add(ref buffered, -item.Bytes.Length); } }
            catch (Exception e) when (e is OperationCanceledException or WebSocketException or ObjectDisposedException) { Cancel(); }
        }
        public async Task Read(Func<byte[], bool, Task> receive)
        {
            var buffer = new byte[16384]; using var message = new MemoryStream();
            try
            {
                while (IsOpen)
                {
                    var frame = await socket.ReceiveAsync(buffer, lifetime).ConfigureAwait(false);
                    if (frame.MessageType == WebSocketMessageType.Close) break;
                    if (message.Length + frame.Count > 256 * 1024) { Close(1009, "Message too large."); break; }
                    message.Write(buffer, 0, frame.Count);
                    if (!frame.EndOfMessage) continue;
                    await receive(message.ToArray(), frame.MessageType == WebSocketMessageType.Text).ConfigureAwait(false);
                    message.SetLength(0);
                }
            }
            finally
            {
                Cancel(); await writer.ConfigureAwait(false);
                if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                {
                    using var limit = new CancellationTokenSource(1000);
                    try { await socket.CloseOutputAsync((WebSocketCloseStatus)closeCode, closeReason, limit.Token).ConfigureAwait(false); } catch (Exception e) when (e is WebSocketException or OperationCanceledException) { }
                }
            }
        }
        public void Close(int code, string reason) { closeCode = code; closeReason = reason; Cancel(); }
        public void Dispose() { lock (lifeGate) { if (lifeDisposed) return; life.Cancel(); lifeDisposed = true; life.Dispose(); } }
    }

