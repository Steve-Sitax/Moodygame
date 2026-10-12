using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Native.Services;

public sealed record NativeAiRoute(string Provider, string Model, string? Effort = null, string? Overruled = null);
public sealed record NativeAiRequest(NativeAiRoute Route, string System, string Prompt, JsonObject Schema);
public sealed record NativeAiAnswer(JsonNode? Output, int? InputTokens = null, int? OutputTokens = null, int? CacheRead = null);

public sealed class NativeAiProviders : IDisposable
{
    private readonly NativeAiConfiguration settings;
    private readonly string directory;
    private readonly HttpClient http;
    private readonly bool ownHttp;
    public string AnthropicUrl { get; set; } = "https://api.anthropic.com/v1/messages";
    public NativeAiProviders(NativeAiConfiguration settings, string directory, HttpClient? http = null)
    { this.settings = settings; this.directory = directory; ownHttp = http == null; this.http = http ?? new HttpClient { Timeout = Timeout.InfiniteTimeSpan }; }
    public void Dispose() { if (ownHttp) http.Dispose(); }
    private static string? Find(string name, string? explicitPath)
    {
        if (!string.IsNullOrEmpty(explicitPath) && File.Exists(explicitPath)) return Path.GetFullPath(explicitPath);
        foreach (string folder in (Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator))
            if (File.Exists(Path.Combine(folder, name))) return Path.Combine(folder, name);
        return null;
    }
    public static string? FindCodex()
    {
        string? provided = Find(OperatingSystem.IsWindows() ? "codex.exe" : "codex", Environment.GetEnvironmentVariable("SCHELDEMIST_CODEX_BIN"));
        if (provided != null) return provided;
        string native = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "npm/node_modules/@openai/codex/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe");
        return File.Exists(native) ? native : null;
    }
    private static string S(JsonNode? n,string key) => NativeGoods.S(n,key);
    private static int? Token(JsonNode? node) => node == null ? null : (int)NativeGoods.Number(node);
    public Task<NativeAiAnswer> Run(NativeAiRequest request, CancellationToken stop) => request.Route.Provider switch {
        "claude" or "codex" => Process(request, stop),
        _ => Http(request, stop)
    };
    private async Task<JsonNode> Post(string address, JsonObject body, Dictionary<string,string> headers, CancellationToken stop)
    {
        using var request = new HttpRequestMessage(HttpMethod.Post, address) { Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json") };
        foreach (var header in headers) request.Headers.TryAddWithoutValidation(header.Key, header.Value);
        using var reply = await http.SendAsync(request, stop).ConfigureAwait(false);
        string text = await reply.Content.ReadAsStringAsync(stop).ConfigureAwait(false);
        if (!reply.IsSuccessStatusCode)
        {
            string message = "";
            try { var error = JsonNode.Parse(text); message = error?["error"] is JsonObject obj ? S(obj,"message") : S(error,"error"); } catch { }
            throw new InvalidOperationException(settings.Scrub($"AI provider returned {(int)reply.StatusCode}. {message}")[..Math.Min(300, settings.Scrub($"AI provider returned {(int)reply.StatusCode}. {message}").Length)]);
        }
        return JsonNode.Parse(text) ?? throw new InvalidOperationException("the provider gave no JSON reply");
    }
    private async Task<NativeAiAnswer> Http(NativeAiRequest request, CancellationToken stop)
    {
        var route = request.Route; var headers = new Dictionary<string,string>();
        var messages = new JsonArray(new JsonObject { ["role"] = "system", ["content"] = request.System }, new JsonObject { ["role"] = "user", ["content"] = request.Prompt });
        string url; JsonObject body;
        if (route.Provider == "anthropic")
        {
            string key = S(settings.Connection("anthropic_api"),"apiKey"); if (key == "") throw new InvalidOperationException("No Anthropic API key is set.");
            headers["x-api-key"] = key; headers["anthropic-version"] = "2023-06-01"; url = AnthropicUrl;
            var config = new JsonObject { ["format"] = new JsonObject { ["type"] = "json_schema", ["schema"] = NativeAiSchema.Clean(request.Schema) } };
            if (route.Effort != null) config["effort"] = route.Effort;
            body = new JsonObject { ["model"] = route.Model, ["max_tokens"] = 8000, ["system"] = request.System, ["messages"] = new JsonArray(messages[1]!.DeepClone()), ["output_config"] = config };
        }
        else if (route.Provider == "openai")
        {
            var connection = settings.Connection("openai_compat"); url = S(connection,"baseUrl") + "/chat/completions";
            string key = S(connection,"apiKey"); if (key != "") headers["Authorization"] = "Bearer " + key;
            body = new JsonObject { ["model"] = route.Model, ["messages"] = messages,
                ["response_format"] = new JsonObject { ["type"] = "json_schema", ["json_schema"] = new JsonObject { ["name"] = "answer", ["strict"] = true, ["schema"] = NativeAiSchema.Clean(request.Schema,true) } } };
            if (route.Effort != null) body["reasoning_effort"] = route.Effort;
        }
        else if (route.Provider == "ollama")
        {
            url = S(settings.Connection("ollama"),"baseUrl") + "/api/chat";
            body = new JsonObject { ["model"] = route.Model, ["stream"] = false, ["format"] = NativeAiSchema.Clean(request.Schema), ["messages"] = messages };
        }
        else throw new InvalidOperationException("unknown provider");
        var reply = await Post(url,body,headers,stop).ConfigureAwait(false);
        if (route.Provider == "anthropic")
        {
            if (S(reply,"stop_reason") is "refusal" or "max_tokens") throw new InvalidOperationException("the provider declined or cut off the answer");
            var blocks = reply["content"]!.AsArray();
            if (blocks.Any(b => S(b,"type") is "tool_use" or "server_tool_use")) throw new InvalidOperationException("the model used a tool; answer thrown away");
            return new(NativeAiSchema.Parse(string.Join("",blocks.Where(b=>S(b,"type")=="text").Select(b=>S(b,"text")))),Token(reply["usage"]?["input_tokens"]),Token(reply["usage"]?["output_tokens"]),Token(reply["usage"]?["cache_read_input_tokens"]));
        }
        var message = route.Provider == "openai" ? reply["choices"]?[0]?["message"] : reply["message"];
        if (message?["tool_calls"] is JsonArray tools && tools.Count > 0) throw new InvalidOperationException("the model used a tool; answer thrown away");
        if (S(message,"refusal") != "" || route.Provider == "openai" && S(reply["choices"]?[0],"finish_reason") == "length") throw new InvalidOperationException("the provider declined or cut off the answer");
        var output = NativeAiSchema.Parse(S(message,"content"));
        return route.Provider == "openai" ? new(NativeAiSchema.StripNulls(output),Token(reply["usage"]?["prompt_tokens"]),Token(reply["usage"]?["completion_tokens"]),Token(reply["usage"]?["prompt_tokens_details"]?["cached_tokens"])) : new(output,Token(reply["prompt_eval_count"]),Token(reply["eval_count"]));
    }
    private async Task<NativeAiAnswer> Process(NativeAiRequest request, CancellationToken stop)
    {
        Directory.CreateDirectory(directory);
        string scratch = Path.GetFullPath(Path.Combine(directory, "call-" + Guid.NewGuid().ToString("N")));
        Directory.CreateDirectory(scratch);
        string binary = request.Route.Provider == "codex" ? FindCodex() ?? throw new InvalidOperationException("codex unavailable")
            : Find(OperatingSystem.IsWindows() ? "claude.exe" : "claude", Environment.GetEnvironmentVariable("SCHELDEMIST_CLAUDE_BIN")) ?? throw new InvalidOperationException("Claude unavailable");
        var start = new ProcessStartInfo(binary) { WorkingDirectory = scratch, UseShellExecute = false, CreateNoWindow = true, WindowStyle = ProcessWindowStyle.Hidden, RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true };
        void Add(params string[] args) { foreach (string arg in args) start.ArgumentList.Add(arg); }
        string output = Path.Combine(scratch,"answer.json");
        if (request.Route.Provider == "codex")
        {
            string schema = Path.Combine(scratch,"schema.json"); File.WriteAllText(schema, NativeAiSchema.Clean(request.Schema,true)!.ToJsonString());
            Add("exec", "-C", scratch, "--ignore-user-config", "--ignore-rules", "--skip-git-repo-check", "--ephemeral", "-s", "read-only", "-m", request.Route.Model,
                "-c", "model_reasoning_effort=" + System.Text.Json.JsonSerializer.Serialize(request.Route.Effort ?? "medium"), "-c", "web_search=\"disabled\"", "-c", "developer_instructions=" + System.Text.Json.JsonSerializer.Serialize(request.System));
            foreach (string feature in new[] { "shell_tool", "unified_exec", "apps", "browser_use", "computer_use", "image_generation", "multi_agent", "memories", "plugins", "hooks", "view_image", "goals" }) Add("--disable", feature);
            Add("--json", "--output-schema", schema, "-o", output, "--", "-");
        }
        else
        {
            Add("--print", "--output-format", "json", "--model", request.Route.Model, "--system-prompt", request.System, "--json-schema", NativeAiSchema.Clean(request.Schema)!.ToJsonString(), "--tools", "", "--mcp-config", "{\"mcpServers\":{}}", "--strict-mcp-config", "--setting-sources", "", "--no-session-persistence", "--max-turns", "3");
            if (request.Route.Effort != null) Add("--effort", request.Route.Effort); else start.Environment["MAX_THINKING_TOKENS"] = "0";
        }
        try
        {
            using var process = new System.Diagnostics.Process { StartInfo = start };
            process.Start();
            using var killed = stop.Register(() => { try { if (!process.HasExited) process.Kill(true); } catch (InvalidOperationException) { } });
            var stdout = process.StandardOutput.ReadToEndAsync(stop); var stderr = process.StandardError.ReadToEndAsync(stop);
            await process.StandardInput.WriteAsync(request.Prompt.AsMemory(),stop).ConfigureAwait(false); process.StandardInput.Close();
            await process.WaitForExitAsync(stop).ConfigureAwait(false);
            string text = await stdout.ConfigureAwait(false), error = await stderr.ConfigureAwait(false);
            if (process.ExitCode != 0) throw new InvalidOperationException(settings.Scrub("AI process exited " + process.ExitCode + ": " + error)[..Math.Min(300, settings.Scrub("AI process exited " + process.ExitCode + ": " + error).Length)]);
            if (request.Route.Provider == "claude")
            {
                var result = JsonNode.Parse(text)!;
                if (result is JsonArray events && events.Any(e => e?["message"]?["content"] is JsonArray blocks && blocks.Any(b => S(b,"type") == "tool_use"))) throw new InvalidOperationException("the model used a tool; answer thrown away");
                if (result is JsonArray list) result = list.Last(e => S(e,"type") == "result")!;
                if (S(result,"subtype") != "success" || result["is_error"]?.GetValue<bool>() == true) throw new InvalidOperationException("Claude gave no successful structured result");
                return new(result["structured_output"]?.DeepClone(),Token(result["usage"]?["input_tokens"]),Token(result["usage"]?["output_tokens"]),Token(result["usage"]?["cache_read_input_tokens"]));
            }
            string last = ""; int? input = null, generated = null, cache = null;
            foreach (string line in text.Split('\n').Where(l=>l.TrimStart().StartsWith('{')))
            {
                var message = JsonNode.Parse(line)!; string type = S(message["item"],"type");
                if (type != "" && type is not ("agent_message" or "reasoning")) throw new InvalidOperationException("Codex used a tool; answer thrown away");
                if (S(message,"type") is "error" or "turn.failed") throw new InvalidOperationException("Codex could not produce an answer");
                if (S(message,"type") == "item.completed" && type == "agent_message") last = S(message["item"],"text");
                if (S(message,"type") == "turn.completed") { input=Token(message["usage"]?["input_tokens"]); generated=Token(message["usage"]?["output_tokens"]); cache=Token(message["usage"]?["cached_input_tokens"]); }
            }
            return new(NativeAiSchema.StripNulls(NativeAiSchema.Parse(File.Exists(output) ? File.ReadAllText(output) : last)),input,generated,cache);
        }
        finally
        {
            string parent = Path.GetFullPath(directory) + Path.DirectorySeparatorChar;
            if (scratch.StartsWith(parent,StringComparison.OrdinalIgnoreCase) && Path.GetFileName(scratch).StartsWith("call-",StringComparison.Ordinal)) Directory.Delete(scratch,true);
        }
    }
}
