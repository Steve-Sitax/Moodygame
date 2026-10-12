using System.IO;
using System.Text.Json;
using Godot;

namespace Scheldemist.Dev;

// Optional settled GPU counters, also usable with the previous loader for an A/B measurement.
[GamePart(950)]
public partial class PeopleMemory : Node
{
    private int frame;
    public override void _Process(double delta)
    {
        string dir = Paths.TestOutput("people-memory");
        if (dir == "") { SetProcess(false); return; }
        if (++frame != 60) return;
        Directory.CreateDirectory(dir);
        File.WriteAllText(Path.Combine(dir, "memory.json"), JsonSerializer.Serialize(new
        {
            pid = OS.GetProcessId(),
            textureBytes = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.TextureMemUsed),
            bufferBytes = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.BufferMemUsed),
            videoBytes = RenderingServer.GetRenderingInfo(RenderingServer.RenderingInfo.VideoMemUsed)
        }));
        SetProcess(false);
    }
}
