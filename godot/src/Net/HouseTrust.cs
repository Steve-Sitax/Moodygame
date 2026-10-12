using System;
using System.Collections.Concurrent;
using System.IO;
using System.Linq;
using System.Net.Http;
using System.Net.Security;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Threading;
using System.Threading.Tasks;

namespace Scheldemist.Net;

/// <summary>A house CA is trusted only after its SHA-256 matches the fingerprint copied from the host.</summary>
public static class HouseTrust
{
    private static readonly ConcurrentDictionary<string, X509Certificate2> Roots = new(StringComparer.OrdinalIgnoreCase);
    private static string? storeDirectory;
    public static void ConfigureStore(string directory) => storeDirectory = Path.GetFullPath(directory);
    private static string StoreFile(Uri address) => Path.Combine(storeDirectory!, Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Origin(address)))) + ".crt");
    private static X509Certificate2? Root(Uri address)
    {
        if (Roots.TryGetValue(Origin(address), out var known)) return known;
        if (storeDirectory == null) return null;
        try { var saved = X509Certificate2.CreateFromPem(File.ReadAllText(StoreFile(address))); if (!NarrowRoot(saved)) { saved.Dispose(); return null; } return Roots.GetOrAdd(Origin(address), saved); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException) { return null; }
    }
    public static string? NormalizeFingerprint(string? fingerprint)
    {
        if (string.IsNullOrWhiteSpace(fingerprint)) return null;
        string value = fingerprint.Replace(":", "").Replace(" ", "").Replace("-", "").Trim();
        return value.Length == 64 && value.All(Uri.IsHexDigit) ? value.ToUpperInvariant() : null;
    }
    private static string Origin(Uri address) => new UriBuilder("https", address.Host, address.Port).Uri.GetLeftPart(UriPartial.Authority);
    public static HttpClientHandler Handler(string address)
    {
        var handler = new HttpClientHandler { AllowAutoRedirect = false };
        var uri = new Uri(address);
        if (uri.Scheme == "https") handler.ServerCertificateCustomValidationCallback = (_, certificate, _, errors) => Validate(uri, certificate, errors);
        return handler;
    }
    public static void Configure(ClientWebSocketOptions options, Uri address)
    {
        if (address.Scheme is "wss" or "https") options.RemoteCertificateValidationCallback = (_, certificate, _, errors) => certificate != null && Validate(address, certificate as X509Certificate2 ?? new X509Certificate2(certificate), errors);
    }
    public static bool Validate(Uri address, X509Certificate2? certificate, SslPolicyErrors errors)
    {
        if (certificate == null || (errors & (SslPolicyErrors.RemoteCertificateNotAvailable | SslPolicyErrors.RemoteCertificateNameMismatch)) != 0) return false;
        var root = Root(address); if (root == null) return errors == SslPolicyErrors.None;
        using var chain = new X509Chain(); chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust; chain.ChainPolicy.CustomTrustStore.Add(root);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck; chain.ChainPolicy.DisableCertificateDownloads = true; chain.ChainPolicy.ApplicationPolicy.Add(new System.Security.Cryptography.Oid(HouseCertificateRules.ServerAuth));
        return chain.Build(certificate) && chain.ChainElements.Count == 2 && chain.ChainElements[1].Certificate.RawData.AsSpan().SequenceEqual(root.RawData);
    }
    public static async Task Prepare(string address, string? fingerprint, CancellationToken cancel = default)
    {
        if (string.IsNullOrWhiteSpace(fingerprint)) return; var uri = new Uri(address);
        if (uri.Scheme != "https") throw new ApiException("Use the host's HTTPS address with the house fingerprint.", 400);
        string expected = NormalizeFingerprint(fingerprint) ?? throw new ApiException("Copy the full SHA-256 house fingerprint from the host's Together panel.", 400);
        var known = Root(uri); if (known != null && Convert.ToHexString(SHA256.HashData(known.RawData)) == expected) return;
        X509Certificate2? leaf = null; SslPolicyErrors observed = SslPolicyErrors.RemoteCertificateNotAvailable;
        // Only a credential-free public-certificate request runs before trust is established. No token, code or name is sent.
        using var handler = new HttpClientHandler { AllowAutoRedirect = false, UseCookies = false, UseDefaultCredentials = false };
        handler.ServerCertificateCustomValidationCallback = (_, certificate, _, errors) => { leaf?.Dispose(); leaf = certificate == null ? null : new X509Certificate2(certificate.RawData); observed = errors; return certificate != null && (errors & SslPolicyErrors.RemoteCertificateNameMismatch) == 0; };
        using var http = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(8) }; X509Certificate2? root = null;
        try
        {
            using var response = await http.GetAsync(new Uri(Origin(uri) + "/house-ca.crt"), HttpCompletionOption.ResponseHeadersRead, cancel).ConfigureAwait(false); response.EnsureSuccessStatusCode();
            if (response.Content.Headers.ContentLength > 16384) throw new ApiException("The host's public certificate is too large.", 400);
            await using var stream = await response.Content.ReadAsStreamAsync(cancel).ConfigureAwait(false); var buffer = new byte[16385]; int total = 0, count;
            while (total < buffer.Length && (count = await stream.ReadAsync(buffer.AsMemory(total), cancel).ConfigureAwait(false)) > 0) total += count;
            if (total > 16384) throw new ApiException("The host's public certificate is too large.", 400);
            string pem = Encoding.ASCII.GetString(buffer, 0, total); if (pem.Contains("PRIVATE KEY", StringComparison.Ordinal)) throw new ApiException("Invalid public house certificate.", 400);
            root = X509Certificate2.CreateFromPem(pem);
            byte[] actual = SHA256.HashData(root.RawData), desired = Convert.FromHexString(expected);
            if (!CryptographicOperations.FixedTimeEquals(actual, desired)) throw new ApiException("The house fingerprint does not match the host's screen. Check the address and copied fingerprint.", 403);
            if (!NarrowRoot(root)) throw new ApiException("This house certificate is not constrained to the host's own addresses.", 403);
            using var chain = new X509Chain(); chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust; chain.ChainPolicy.CustomTrustStore.Add(root); chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck; chain.ChainPolicy.DisableCertificateDownloads = true; chain.ChainPolicy.ApplicationPolicy.Add(new System.Security.Cryptography.Oid(HouseCertificateRules.ServerAuth));
            if (leaf == null || (observed & SslPolicyErrors.RemoteCertificateNameMismatch) != 0 || !chain.Build(leaf) || chain.ChainElements.Count != 2) throw new ApiException("The server certificate is not signed by that house certificate.", 403);
            // Retain old roots until process exit: certificate callbacks may still be validating an active connection.
            if (storeDirectory != null) { Directory.CreateDirectory(storeDirectory); string path=StoreFile(uri), temporary=path+"."+Guid.NewGuid().ToString("N")+".new"; File.WriteAllText(temporary,root.ExportCertificatePem()+"\n"); File.Move(temporary,path,true); }
            Roots[Origin(uri)] = root; root = null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or CryptographicException) { throw new ApiException("Cannot verify the host's house certificate: " + e.Message, 0, e); }
        finally { root?.Dispose(); leaf?.Dispose(); }
    }
    public static bool NarrowRoot(X509Certificate2 root)
    {
        try
        {
            var basic = root.Extensions.OfType<X509BasicConstraintsExtension>().SingleOrDefault(); var eku = root.Extensions.OfType<X509EnhancedKeyUsageExtension>().SingleOrDefault(); var nc = root.Extensions[HouseCertificateRules.ConstraintsOid];
            if (basic is not { CertificateAuthority: true, HasPathLengthConstraint: true, PathLengthConstraint: 0 } || !basic.Critical || eku == null || eku.EnhancedKeyUsages.Count != 1 || eku.EnhancedKeyUsages[0].Value != HouseCertificateRules.ServerAuth || nc == null || !nc.Critical) return false;
            var (dns, ranges) = HouseCertificateRules.ReadNameConstraints(nc.RawData); return dns.Length > 0 && dns.All(HouseCertificateRules.DnsName) && ranges.Length > 0 && ranges.All(r => r.EndsWith("/32", StringComparison.Ordinal) && HouseCertificateRules.PrivateIp(r[..^3]));
        }
        catch (Exception e) when (e is CryptographicException or System.Formats.Asn1.AsnContentException or InvalidOperationException) { return false; }
    }
}

