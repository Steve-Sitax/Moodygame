using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Net;

/// <summary>
/// Where the game server and its Node are: the one place that knows. From a checkout: `node` from the PATH and
/// `server/` beside the Godot project. In the download (later, G7): `runtime/node` and `server/` beside the game's
/// program, as tools/package.mjs lays them out for the browser game today. Each can be set from outside:
/// SCHELDEMIST_NODE (the Node program), SCHELDEMIST_ROOT (the folder that holds server/, shared/ and data/).
/// </summary>
public sealed record ServerPaths
{
    /// <summary>The folder that holds server/, shared/, client/ and data/.</summary>
    public string Root { get; init; } = "";
    /// <summary>The Node program (a path, or "node" for the one on the PATH).</summary>
    public string Node { get; init; } = "node";
    public string ServerDir => Path.Combine(Root, "server");
    /// <summary>What Node runs, seen from ServerDir (Node 24 runs TypeScript as it is).</summary>
    public string Entry { get; init; } = "src/index.ts";
    public string DataDir => Path.Combine(Root, "data");
    /// <summary>The download: the server runs in production mode and never builds the browser game.</summary>
    public bool Packaged { get; init; }

    /// <summary>
    /// projectDir: the Godot project's folder (res://) when run from a checkout; exeDir: the folder of the game's
    /// program. The download is tried first (a server/ beside the program), then the checkout (server/ one up from
    /// the Godot project).
    /// </summary>
    public static ServerPaths Find(string projectDir, string exeDir)
    {
        string node = Environment.GetEnvironmentVariable("SCHELDEMIST_NODE") ?? "";
        string root = Environment.GetEnvironmentVariable("SCHELDEMIST_ROOT") ?? "";
        bool win = OperatingSystem.IsWindows();
        bool packaged = false;
        if (root == "")
        {
            if (exeDir != "" && File.Exists(Path.Combine(exeDir, "server", "src", "index.ts")))
            {
                root = exeDir;
                packaged = true;
            }
            else root = Path.GetFullPath(Path.Combine(projectDir, ".."));
        }
        else packaged = !Directory.Exists(Path.Combine(root, "godot"));
        if (node == "")
        {
            string own = Path.Combine(root, "runtime", win ? "node.exe" : "node");
            node = File.Exists(own) ? own : "node";
        }
        return new ServerPaths { Root = root, Node = node, Packaged = packaged };
    }
}

/// <summary>What the game asks of its server at start.</summary>
public sealed record ServerOptions
{
    /// <summary>A server that runs already ("http://127.0.0.1:8941"): none is started. Option --server.</summary>
    public string External { get; init; } = "";
    /// <summary>The first port to try (--port). Never one of ServerProcess.Forbidden.</summary>
    public int FirstPort { get; init; } = ServerProcess.FirstPort;
    /// <summary>Another save than data/game.sqlite (--db): SCHELDEMIST_DB.</summary>
    public string Db { get; init; } = "";
    /// <summary>No model calls (--no-ai): the server runs in walk-around mode (docs/ai-setup.md) from a settings file of its own.</summary>
    public bool NoAi { get; init; }
    /// <summary>How long the server may take to answer. A new save makes the town first.</summary>
    public TimeSpan Wait { get; init; } = TimeSpan.FromSeconds(90);
}

/// <summary>
/// The game server (server/, Node) as the Godot game's own background program: started with the game on a free port
/// on this PC, waited for until it answers, and stopped with the game, its whole process tree with it. What
/// tools/release/launch.mjs does for the browser game. With an outside server (--server) nothing is started or
/// stopped. Plain C#, no Godot types: it runs off the main thread.
/// </summary>
public sealed class ServerProcess : IDisposable
{
    public const int FirstPort = 8800;
    /// <summary>
    /// Never ours: Steve's own running game (8787, its https port 8788, its page 5173 and the spare 5183, its map
    /// 8790), the test stack (8941, 5341), and the local AI models on PCX (8080, 8088, 8090).
    /// </summary>
    public static readonly IReadOnlySet<int> Forbidden = new HashSet<int> { 8787, 8788, 8790, 5173, 5183, 5341, 8941, 8080, 8088, 8090 };

    /// <summary>"http://127.0.0.1:8800": no slash at the end.</summary>
    public string Url { get; private set; } = "";
    public int Port { get; private set; }
    /// <summary>True: this game started it and stops it.</summary>
    public bool Own { get; private set; }
    /// <summary>The server's own words (its log), the newest last: for the error on screen.</summary>
    public IReadOnlyList<string> LastLines
    {
        get
        {
            lock (tail) return tail.ToArray();
        }
    }
    public string LogFile { get; private set; } = "";
    public int Pid => proc is { HasExited: false } ? proc.Id : 0;

    private Process? proc;
    private IntPtr job = IntPtr.Zero;
    private StreamWriter? log;
    private readonly Queue<string> tail = new();
    private volatile bool listening;
    private bool stopped;

    private ServerProcess() { }

    /// <summary>
    /// Start the server (or find the outside one) and wait until it answers. Throws ServerStartException with words
    /// a player can read when it does not come up in time.
    /// </summary>
    public static async Task<ServerProcess> StartAsync(ServerPaths paths, ServerOptions opt, CancellationToken stop = default)
    {
        var s = new ServerProcess();
        if (opt.External != "")
        {
            if (!Uri.TryCreate(opt.External, UriKind.Absolute, out var u) || (u.Scheme != "http" && u.Scheme != "https"))
                throw new ServerStartException($"--server wants an address like http://127.0.0.1:8941, not \"{opt.External}\".");
            s.Url = u.GetLeftPart(UriPartial.Authority);
            s.Port = u.Port;
            if (!await Answers(s.Url, TimeSpan.FromSeconds(10), null, stop).ConfigureAwait(false))
                throw new ServerStartException($"The game server at {s.Url} does not answer. Is it running?");
            return s;
        }
        if (!File.Exists(Path.Combine(paths.ServerDir, paths.Entry)))
            throw new ServerStartException($"The game server is not where it should be: {Path.Combine(paths.ServerDir, paths.Entry)}");
        if (!Directory.Exists(Path.Combine(paths.ServerDir, "node_modules")))
            throw new ServerStartException($"The game server's packages are missing. Run once: npm --prefix \"{paths.ServerDir}\" install");

        // another program may take the port between the look and the start (two games started together): the next one then
        string why = "";
        int from = opt.FirstPort;
        for (int attempt = 0; attempt < 3; attempt++)
        {
            int port = FreePort(from);
            if (port < 0) throw new ServerStartException($"No free port from {from} on this PC. Close some programs and try again.");
            try
            {
                s.Launch(paths, opt, port);
            }
            catch (Exception e) when (e is not ServerStartException)
            {
                s.Stop();
                throw new ServerStartException($"Node did not start ({paths.Node}): {e.Message}. Is Node 24 installed?");
            }
            // ours answers: its own log says it listens (another game's server on the same port must not be taken for it)
            if (await Answers(s.Url, opt.Wait, s, stop).ConfigureAwait(false)) return s;
            bool died = s.proc is null or { HasExited: true };
            var last = s.LastLines;
            why = died
                ? $"The game server stopped while starting (port {port})."
                : $"The game server did not answer within {opt.Wait.TotalSeconds:0} seconds (port {port}).";
            if (last.Count > 0) why += "\n" + string.Join("\n", last.TakeLast(6));
            if (s.LogFile != "") why += $"\nIts log: {s.LogFile}";
            s.Stop();
            if (!died || !last.Any(l => l.Contains("EADDRINUSE"))) break;
            from = port + 2;
            s = new ServerProcess();
        }
        throw new ServerStartException(why);
    }

    /// <summary>A port from `from` up where it and the next (the server's https port, config.ts TLS_PORT) are free; -1: none in 100.</summary>
    public static int FreePort(int from)
    {
        for (int p = Math.Max(1024, from); p < from + 100; p++)
        {
            if (Forbidden.Contains(p) || Forbidden.Contains(p + 1)) continue;
            if (IsFree(p) && IsFree(p + 1)) return p;
        }
        return -1;
    }

    private static bool IsFree(int port)
    {
        try
        {
            var l = new TcpListener(IPAddress.Loopback, port);
            l.Start();
            l.Stop();
            return true;
        }
        catch (SocketException)
        {
            return false;
        }
    }

    private void Launch(ServerPaths paths, ServerOptions opt, int port)
    {
        Port = port;
        Url = $"http://127.0.0.1:{port}";
        Own = true;
        Directory.CreateDirectory(paths.DataDir);
        LogFile = Path.Combine(paths.DataDir, "godot-server.log");
        try
        {
            log = new StreamWriter(new FileStream(LogFile, FileMode.Create, System.IO.FileAccess.Write, FileShare.ReadWrite)) { AutoFlush = true };
        }
        catch (IOException)
        {
            log = null; // a second game on this checkout holds it: the server's words stay in memory only
            LogFile = "";
        }
        var info = new ProcessStartInfo
        {
            FileName = paths.Node,
            WorkingDirectory = paths.ServerDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = true,
        };
        info.ArgumentList.Add(paths.Entry);
        // the environment of tools/teststack.mjs and tools/release/launch.mjs
        info.Environment["SCHELDEMIST_PORT"] = port.ToString();
        // the Godot game is no page: the server's check of who talks to it passes its own port only
        info.Environment["SCHELDEMIST_CLIENT_PORT"] = port.ToString();
        // the host's town map (server mapview/): its own port by this game's, never 8790 (Steve's running game); none if taken
        int map = port + 1000;
        info.Environment["SCHELDEMIST_MAP_PORT"] = !Forbidden.Contains(map) && IsFree(map) ? map.ToString() : "0";
        if (opt.Db != "") info.Environment["SCHELDEMIST_DB"] = Path.GetFullPath(opt.Db);
        if (paths.Packaged)
        {
            info.Environment["NODE_ENV"] = "production";
            info.Environment["SCHELDEMIST_DIST"] = Path.Combine(paths.Root, "client", "dist");
        }
        if (opt.NoAi) info.Environment["SCHELDEMIST_AI_CONFIG"] = WalkConfig(paths);

        proc = new Process { StartInfo = info, EnableRaisingEvents = true };
        proc.OutputDataReceived += (_, e) => Heard(e.Data);
        proc.ErrorDataReceived += (_, e) => Heard(e.Data);
        proc.Start();
        // Windows: in a job that ends with this game, so a game that crashed or was ended from outside leaves no node behind
        if (OperatingSystem.IsWindows()) job = WinJob.KillOnClose(proc);
        proc.StandardInput.Close();
        proc.BeginOutputReadLine();
        proc.BeginErrorReadLine();
    }

    /// <summary>A settings file that says "walk around, no AI" (docs/ai-setup.md), for tests: the player's own data/ai-config.json is not touched.</summary>
    private static string WalkConfig(ServerPaths paths)
    {
        string f = Path.Combine(paths.DataDir, "godot-no-ai.ai-config.json");
        File.WriteAllText(f, "{\"version\":1,\"mode\":\"walk\",\"typedLines\":\"same\",\"callsPerDay\":120,\"default\":{\"provider\":\"recommended\"},\"kinds\":{},\"connections\":{\"anthropic_api\":{},\"openai_compat\":{\"baseUrl\":\"https://api.openai.com/v1\"},\"ollama\":{\"baseUrl\":\"http://127.0.0.1:11434\"}}}\n");
        return f;
    }

    private void Heard(string? line)
    {
        if (line == null) return;
        if (line.StartsWith("[server] http://", StringComparison.Ordinal)) listening = true;
        lock (tail)
        {
            tail.Enqueue(line);
            while (tail.Count > 40) tail.Dequeue();
            try
            {
                log?.WriteLine(line);
            }
            catch (Exception e) when (e is IOException or ObjectDisposedException)
            {
                // the log is closed: the game is stopping
            }
        }
    }

    /// <summary>Ask until the server answers /api/state. `own`: only once its log says it listens, and only while it lives.</summary>
    private static async Task<bool> Answers(string url, TimeSpan wait, ServerProcess? own, CancellationToken stop)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var until = Stopwatch.StartNew();
        while (until.Elapsed < wait && !stop.IsCancellationRequested)
        {
            if (own != null && own.proc is null or { HasExited: true }) return false;
            if (own == null || own.listening)
            {
                try
                {
                    using var r = await http.GetAsync(url + "/api/state", stop).ConfigureAwait(false);
                    if (r.IsSuccessStatusCode) return true;
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
                {
                    // not yet
                }
            }
            try
            {
                await Task.Delay(250, stop).ConfigureAwait(false);
            }
            catch (TaskCanceledException)
            {
                return false;
            }
        }
        return false;
    }

    /// <summary>Stop the server we started, its whole process tree with it. Safe to call twice; nothing for an outside server.</summary>
    public void Stop()
    {
        if (stopped) return;
        stopped = true;
        var p = proc;
        proc = null;
        if (p != null)
        {
            try
            {
                if (!p.HasExited)
                {
                    p.Kill(entireProcessTree: true);
                    p.WaitForExit(5000);
                }
            }
            catch (Exception e) when (e is InvalidOperationException or System.ComponentModel.Win32Exception or AggregateException)
            {
                // gone already
            }
            p.Dispose();
        }
        if (job != IntPtr.Zero)
        {
            WinJob.Close(job); // ends whatever of the tree is left
            job = IntPtr.Zero;
        }
        lock (tail)
        {
            log?.Dispose();
            log = null;
        }
    }

    public void Dispose() => Stop();
}

/// <summary>The server did not come up: Message is for the player's screen.</summary>
public sealed class ServerStartException : Exception
{
    public ServerStartException(string message) : base(message) { }
}

/// <summary>
/// Windows: a job object that ends its processes when its last handle closes. The game holds the only handle, so
/// the server (and what it started) ends with the game however the game ends.
/// </summary>
internal static class WinJob
{
    [StructLayout(LayoutKind.Sequential)]
    private struct BasicLimits
    {
        public long PerProcessUserTimeLimit;
        public long PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize;
        public UIntPtr MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass;
        public uint SchedulingClass;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct IoCounters
    {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct ExtendedLimits
    {
        public BasicLimits Basic;
        public IoCounters Io;
        public UIntPtr ProcessMemoryLimit;
        public UIntPtr JobMemoryLimit;
        public UIntPtr PeakProcessMemoryUsed;
        public UIntPtr PeakJobMemoryUsed;
    }

    private const uint KillOnJobClose = 0x2000;
    private const int ExtendedLimitInformation = 9;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern IntPtr CreateJobObjectW(IntPtr attributes, string? name);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetInformationJobObject(IntPtr job, int infoClass, ref ExtendedLimits info, uint length);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool CloseHandle(IntPtr handle);

    /// <summary>Put the process in a new kill-on-close job; zero when Windows refuses (the plain stop still works).</summary>
    public static IntPtr KillOnClose(Process p)
    {
        try
        {
            IntPtr job = CreateJobObjectW(IntPtr.Zero, null);
            if (job == IntPtr.Zero) return IntPtr.Zero;
            var info = new ExtendedLimits { Basic = new BasicLimits { LimitFlags = KillOnJobClose } };
            if (!SetInformationJobObject(job, ExtendedLimitInformation, ref info, (uint)Marshal.SizeOf<ExtendedLimits>()) || !AssignProcessToJobObject(job, p.Handle))
            {
                CloseHandle(job);
                return IntPtr.Zero;
            }
            return job;
        }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException or InvalidOperationException)
        {
            return IntPtr.Zero;
        }
    }

    public static void Close(IntPtr job)
    {
        try
        {
            CloseHandle(job);
        }
        catch (Exception e) when (e is EntryPointNotFoundException or DllNotFoundException)
        {
            // not Windows after all
        }
    }
}
