using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Authentication;
using System.Text.Json.Nodes;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
using Scheldemist.Net;

namespace Scheldemist.Native.World;

/// <summary>Individual interface listeners, so switching LAN/VPN off closes those connections without rebinding loopback.</summary>
public sealed class NativeHouseListeners : IAsyncDisposable
{
    private readonly Func<HttpContext, Task> request;
    private readonly Func<JsonObject, Task> publish;
    private readonly Func<CancellationToken, Task<NativeHouseAddresses>> addresses;
    private readonly Action<string> log;
    private readonly string certificateDirectory;
    private readonly int httpPort;
    private readonly CancellationToken stopping;
    private readonly SemaphoreSlim gate = new(1, 1);
    private readonly Dictionary<string, WebApplication> listeners = new(StringComparer.Ordinal);
    private readonly List<NativeHouseCertificates> retiredCertificates = new();
    private NativeHouseCertificates? certificates;
    private string[] httpNames = new[] { "localhost", "127.0.0.1" }, tlsNames = Array.Empty<string>();
    private volatile bool lan, vpn, desiredLan, desiredVpn;
    private string lastAttempt = "";
    private DateTimeOffset certificateChecked;
    public int SecurePort { get; private set; }
    public string? Error { get; private set; }
    public bool Watching => desiredLan || desiredVpn;
    public NativeHouseListeners(int httpPort, string certificateDirectory, Func<HttpContext,Task> request, Func<JsonObject,Task> publish, CancellationToken stopping, Func<CancellationToken,Task<NativeHouseAddresses>>? addresses = null, Action<string>? log = null)
    {
        this.httpPort = httpPort; this.certificateDirectory = certificateDirectory; this.request = request; this.publish = publish; this.stopping = stopping;
        var source = new NativeHouseAddressSource(); this.addresses = addresses ?? source.Read; this.log = log ?? (_ => { });
        SecurePort = httpPort < 65535 ? httpPort + 1 : 65000;
    }
    public static (string[] Http, string[] Https, string[] Dns) Targets(NativeHouseAddresses own, bool lan, bool vpn)
    {
        string[] http = lan ? own.Lan.Where(HouseCertificateRules.LanIp).Distinct().ToArray() : Array.Empty<string>();
        string[] https = lan || vpn ? new[] { "127.0.0.1" }.Concat(http).Concat(vpn ? own.Vpn.Where(HouseCertificateRules.VpnIp) : Array.Empty<string>()).Distinct().ToArray() : Array.Empty<string>();
        string[] dns = HouseCertificateRules.DnsNames(new[] { "localhost", own.Host, own.Host + ".local" }.Concat(vpn && own.Fqdn != null ? new[] { own.Fqdn } : Array.Empty<string>()));
        return (http, https, dns);
    }
    public async Task Apply(bool openLan, bool openVpn, bool force = true)
    {
        if (force) { desiredLan = openLan; desiredVpn = openVpn; }
        await gate.WaitAsync(stopping).ConfigureAwait(false);
        try
        {
            lan = desiredLan; vpn = desiredVpn; var own = await addresses(stopping).ConfigureAwait(false); var target = Targets(own, lan, vpn);
            string signature = (lan ? "L" : "") + (vpn ? "V" : "") + own.Signature(lan, vpn);
            if (!force && lastAttempt == signature && DateTimeOffset.UtcNow - certificateChecked < TimeSpan.FromDays(1)) return;
            lastAttempt = signature; Error = null;
            httpNames = new[] { "localhost", "127.0.0.1", own.Host, own.Host + ".local" }.Concat(target.Http).ToArray();
            foreach (string key in listeners.Keys.Where(k => k.StartsWith("http:", StringComparison.Ordinal) && !target.Http.Contains(k[5..])).ToArray()) await Close(key).ConfigureAwait(false);
            foreach (string ip in target.Http) if (!listeners.ContainsKey("http:" + ip)) await Open("http:" + ip, ip, httpPort, false).ConfigureAwait(false);
            if (target.Https.Length == 0)
            {
                foreach (string key in listeners.Keys.Where(k => k.StartsWith("https:", StringComparison.Ordinal)).ToArray()) await Close(key).ConfigureAwait(false);
                tlsNames = Array.Empty<string>(); certificates = null;
            }
            else
            {
                try
                {
                    var fresh = await NativeHouseCertificateStore.Ensure(certificateDirectory, target.Dns, target.Https, own.Fqdn == null ? null : new[] { own.Fqdn }, own.Lan.Concat(own.Vpn)).ConfigureAwait(false);
                    retiredCertificates.Add(fresh); certificates = fresh; tlsNames = fresh.Names; certificateChecked = DateTimeOffset.UtcNow;
                    foreach (string key in listeners.Keys.Where(k => k.StartsWith("https:", StringComparison.Ordinal) && !target.Https.Contains(k[6..])).ToArray()) await Close(key).ConfigureAwait(false);
                    if (!listeners.ContainsKey("https:127.0.0.1"))
                    {
                        for (int attempt = 0; attempt < 20 && SecurePort <= 65535; attempt++, SecurePort++)
                        {
                            if (SecurePort == httpPort || Reserved.Contains(SecurePort)) continue;
                            if (await Open("https:127.0.0.1", "127.0.0.1", SecurePort, true).ConfigureAwait(false)) break;
                        }
                    }
                    if (listeners.ContainsKey("https:127.0.0.1")) foreach (string ip in target.Https.Where(ip => ip != "127.0.0.1")) if (!listeners.ContainsKey("https:" + ip)) await Open("https:" + ip, ip, SecurePort, true).ConfigureAwait(false);
                    if (!listeners.Keys.Any(k => k.StartsWith("https:", StringComparison.Ordinal))) Error ??= "No HTTPS port was available.";
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Security.Cryptography.CryptographicException or InvalidOperationException)
                {
                    Error = "Cannot prepare the house certificate: " + e.Message; log(Error);
                    foreach (string key in listeners.Keys.Where(k => k.StartsWith("https:", StringComparison.Ordinal)).ToArray()) await Close(key).ConfigureAwait(false);
                    certificates = null; tlsNames = Array.Empty<string>();
                }
            }
            var http = listeners.Keys.Where(k => k.StartsWith("http:", StringComparison.Ordinal)).Select(k => k[5..]).ToArray(); var secure = listeners.Keys.Where(k => k.StartsWith("https:", StringComparison.Ordinal)).Select(k => k[6..]).ToArray();
            var house = lan && secure.Length > 0 ? new[] { "https://" + own.Host + ":" + SecurePort }.Concat(target.Http.Where(secure.Contains).Select(ip => "https://" + ip + ":" + SecurePort)) : Array.Empty<string>();
            var vpnUrls = vpn && secure.Length > 0 ? (own.Fqdn == null ? Array.Empty<string>() : new[] { "https://" + own.Fqdn + ":" + SecurePort }).Concat(own.Vpn.Where(secure.Contains).Select(ip => "https://" + ip + ":" + SecurePort)) : Array.Empty<string>();
            var ca = certificates;
            await publish(new JsonObject { ["port"] = httpPort, ["securePort"] = SecurePort, ["open"] = Strings(http), ["urls"] = Strings(new[] { "http://127.0.0.1:" + httpPort }.Concat(http.Select(ip => "http://" + ip + ":" + httpPort)).Concat(lan && http.Length > 0 ? new[] { "http://" + own.Host + ":" + httpPort } : System.Array.Empty<string>())), ["secureOpen"] = Strings(secure), ["secure"] = new JsonObject { ["house"] = Strings(house), ["vpn"] = Strings(vpnUrls) }, ["tls"] = secure.Length == 0 || ca == null ? null : new JsonObject { ["caSha256"] = ca.CaSha256, ["caSha1"] = ca.CaSha1, ["spki"] = ca.Spki, ["names"] = Strings(ca.Names), ["serverUntil"] = ca.Server.NotAfter.ToUniversalTime().ToString("o"), ["publicCertificate"] = "/house-ca.crt" }, ["addressWatch"] = Watching, ["networkError"] = Error }).ConfigureAwait(false);
        }
        finally { gate.Release(); }
    }
    private static readonly HashSet<int> Reserved = new() { 8787, 8788, 8790, 5173, 5183, 5341, 8941, 8080, 8088, 8090 };
    private static JsonArray Strings(IEnumerable<string> values) => new(values.Select(s => (JsonNode)JsonValue.Create(s)!).ToArray());
    private async Task<bool> Open(string key, string ip, int port, bool secure)
    {
        var builder = WebApplication.CreateSlimBuilder(new WebApplicationOptions { Args = System.Array.Empty<string>(), ContentRootPath = AppContext.BaseDirectory, ApplicationName = typeof(NativeHouseListeners).Assembly.GetName().Name }); builder.Logging.ClearProviders();
        builder.WebHost.ConfigureKestrel(options => {
            options.AddServerHeader = false; options.Limits.MaxRequestBodySize = 1024 * 1024; options.Limits.MaxConcurrentConnections = 128; options.Limits.MaxConcurrentUpgradedConnections = 32; options.Limits.RequestHeadersTimeout = TimeSpan.FromSeconds(10);
            options.Listen(IPAddress.Parse(ip), port, listener => { if (secure) listener.UseHttps(https => { https.SslProtocols = SslProtocols.Tls12 | SslProtocols.Tls13; https.ServerCertificateSelector = (_, _) => certificates?.Server; }); });
        });
        var app = builder.Build(); app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(20) }); app.Run(context => request(context));
        try { await app.StartAsync(stopping).ConfigureAwait(false); listeners[key] = app; return true; }
        catch (IOException e) { await app.DisposeAsync().ConfigureAwait(false); Error = "Cannot listen on " + ip + ":" + port + ": " + e.Message; log(Error); return false; }
    }
    private async Task Close(string key)
    {
        var app = listeners[key]; listeners.Remove(key); using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try { await app.StopAsync(timeout.Token).ConfigureAwait(false); } catch (OperationCanceledException) { }
        await app.DisposeAsync().ConfigureAwait(false);
    }
    public bool Accepts(HttpContext context)
    {
        string name = context.Request.Host.Host.ToLowerInvariant().TrimEnd('.'); bool secure = context.Request.IsHttps;
        if (!(secure ? tlsNames : httpNames).Contains(name, StringComparer.Ordinal)) return false;
        string remote = context.Connection.RemoteIpAddress?.MapToIPv4().ToString() ?? "";
        if (!secure && HouseCertificateRules.VpnIp(remote)) return false;
        return IPAddress.TryParse(remote, out var ip) && IPAddress.IsLoopback(ip) || HouseCertificateRules.LanIp(remote) && lan || secure && HouseCertificateRules.VpnIp(remote) && vpn;
    }
    public async Task<bool> PublicCertificate(HttpContext context)
    {
        if (context.Request.Path != "/house-ca.crt") return false;
        var ca = certificates; if (context.Request.Method != "GET" || ca == null || !context.Request.IsHttps) { context.Response.StatusCode = 404; return true; }
        context.Response.Headers.CacheControl = "no-store"; context.Response.ContentType = "application/x-x509-ca-cert";
        await context.Response.WriteAsync(ca.CaPem, context.RequestAborted).ConfigureAwait(false); return true;
    }
    public async ValueTask DisposeAsync()
    {
        await gate.WaitAsync().ConfigureAwait(false);
        try { foreach (string key in listeners.Keys.ToArray()) await Close(key).ConfigureAwait(false); foreach (var cert in retiredCertificates) cert.Dispose(); retiredCertificates.Clear(); }
        finally { gate.Release(); }
    }
}


