using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Scheldemist.Net;

namespace Scheldemist.Native.World;

public sealed record NativeHouseAddresses(string Host, string[] Lan, string[] Vpn, string? Fqdn)
{
    public string Signature(bool lan, bool vpn) => new JsonArray(new JsonArray((lan ? Lan : Array.Empty<string>()).OrderBy(s => s, StringComparer.Ordinal).Select(s => (JsonNode)JsonValue.Create(s)!).ToArray()), new JsonArray((vpn ? Vpn : Array.Empty<string>()).OrderBy(s => s, StringComparer.Ordinal).Select(s => (JsonNode)JsonValue.Create(s)!).ToArray()), vpn ? Fqdn : null).ToJsonString();
}

public sealed class NativeHouseAddressSource
{
    private string? executable;
    private bool executableLookedUp;
    private DateTimeOffset cacheAt;
    private string? cachedName;
    public static string? ParseNetbird(string text)
    {
        string? raw = null;
        try { raw = (JsonNode.Parse(text) as JsonObject)?["fqdn"] is JsonValue v && v.TryGetValue<string>(out string? name) ? name : null; }
        catch (System.Text.Json.JsonException) { var match = Regex.Match(text, @"^\s*FQDN:\s*(\S+)\s*$", RegexOptions.Multiline | RegexOptions.IgnoreCase); if (match.Success) raw = match.Groups[1].Value; }
        if (raw == null) return null; string result = raw.Trim().ToLowerInvariant().TrimEnd('.');
        return result.Contains('.') && HouseCertificateRules.DnsName(result) ? result : null;
    }
    public static string? FindNetbird(IEnumerable<string> path, IEnumerable<string> standard, bool windows)
    {
        foreach (string raw in path.Concat(standard))
        {
            string dir = raw.Trim().Trim('"'); if (!Path.IsPathFullyQualified(dir)) continue;
            string candidate = Path.Combine(dir, windows ? "netbird.exe" : "netbird"); if (File.Exists(candidate)) return candidate;
        }
        return null;
    }
    public async Task<NativeHouseAddresses> Read(CancellationToken cancel = default)
    {
        var addresses = new List<string>();
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces().Where(n => n.OperationalStatus == OperationalStatus.Up))
        {
            try { foreach (var unicast in nic.GetIPProperties().UnicastAddresses) if (unicast.Address.AddressFamily == AddressFamily.InterNetwork && !System.Net.IPAddress.IsLoopback(unicast.Address)) addresses.Add(unicast.Address.ToString()); }
            catch (NetworkInformationException) { /* An interface removed during enumeration is retried by the watch. */ }
        }
        return new(HouseCertificateRules.HostName(Environment.MachineName), addresses.Where(HouseCertificateRules.LanIp).Distinct().ToArray(), addresses.Where(HouseCertificateRules.VpnIp).Distinct().ToArray(), await VpnName(cancel).ConfigureAwait(false));
    }
    private async Task<string?> VpnName(CancellationToken cancel)
    {
        string? explicitName = Environment.GetEnvironmentVariable("SCHELDEMIST_VPN_FQDN"); if (!string.IsNullOrEmpty(explicitName)) return ParseNetbird("FQDN: " + explicitName);
        if (DateTimeOffset.UtcNow - cacheAt < TimeSpan.FromSeconds(cachedName == null ? 60 : 300)) return cachedName;
        if (!executableLookedUp)
        {
            bool win = OperatingSystem.IsWindows(); string programFiles = Environment.GetEnvironmentVariable("ProgramFiles") ?? @"C:\Program Files";
            executable = FindNetbird((Environment.GetEnvironmentVariable("PATH") ?? "").Split(Path.PathSeparator), win ? new[] { @"C:\Program Files\NetBird", Path.Combine(programFiles, "NetBird") } : new[] { "/usr/bin", "/usr/local/bin", "/opt/homebrew/bin" }, win); executableLookedUp = true;
        }
        string? value = null;
        if (executable != null)
        {
            string? json = await Run(executable, new[] { "status", "--json" }, cancel).ConfigureAwait(false); if (json != null) value = ParseNetbird(json);
            if (value == null && json != null) { string? text = await Run(executable, new[] { "status" }, cancel).ConfigureAwait(false); if (text != null) value = ParseNetbird(text); }
        }
        cacheAt = DateTimeOffset.UtcNow; cachedName = value; return value;
    }
    private static async Task<string?> Run(string executable, string[] args, CancellationToken cancel)
    {
        var start = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        foreach (string arg in args) start.ArgumentList.Add(arg);
        using var process = new Process { StartInfo = start }; using var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancel); deadline.CancelAfter(3000);
        bool started = false;
        try
        {
            if (!(started = process.Start())) return null;
            var stdout = ReadBounded(process.StandardOutput, deadline.Token); var stderr = ReadBounded(process.StandardError, deadline.Token);
            await process.WaitForExitAsync(deadline.Token).ConfigureAwait(false); string? text = await stdout.ConfigureAwait(false); await stderr.ConfigureAwait(false);
            return process.ExitCode == 0 ? text : null;
        }
        catch (Exception e) when (e is IOException or System.ComponentModel.Win32Exception or OperationCanceledException) { if (started && !process.HasExited) try { process.Kill(true); } catch (InvalidOperationException) { } return null; }
    }
    private static async Task<string?> ReadBounded(StreamReader reader, CancellationToken cancel)
    {
        var result = new System.Text.StringBuilder(); var buffer = new char[4096]; int count;
        while ((count = await reader.ReadAsync(buffer.AsMemory(), cancel).ConfigureAwait(false)) != 0) { if (result.Length + count > 1024 * 1024) throw new IOException("NetBird output too large."); result.Append(buffer, 0, count); }
        return result.ToString();
    }
}
