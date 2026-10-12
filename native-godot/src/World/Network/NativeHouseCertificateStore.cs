using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Formats.Asn1;
using System.IO;
using System.Linq;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Security.Principal;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Scheldemist.Net;

namespace Scheldemist.Native.World;

public sealed class NativeHouseCertificates : IDisposable
{
    public X509Certificate2 Server { get; }
    public X509Certificate2 Ca { get; }
    public string CaPem => Ca.ExportCertificatePem() + "\n";
    public string CaSha256 => Fingerprint(Ca.RawData, HashAlgorithmName.SHA256);
    public string CaSha1 => Fingerprint(Ca.RawData, HashAlgorithmName.SHA1);
    public string Spki => Convert.ToBase64String(SHA256.HashData(Server.PublicKey.ExportSubjectPublicKeyInfo()));
    public string[] Names { get; }
    public bool MadeCa { get; }
    public bool MadeServer { get; }
    internal NativeHouseCertificates(X509Certificate2 ca, X509Certificate2 server, string[] names, bool madeCa, bool madeServer) { Ca = ca; Server = OperatingSystem.IsWindows() ? new X509Certificate2(server.Export(X509ContentType.Pfx), (string?)null, X509KeyStorageFlags.Exportable) : server; if (!ReferenceEquals(Server, server)) server.Dispose(); Names = names; MadeCa = madeCa; MadeServer = madeServer; }
    public static string Fingerprint(byte[] data, HashAlgorithmName algorithm) => string.Join(":", Convert.ToHexString(algorithm == HashAlgorithmName.SHA1 ? SHA1.HashData(data) : SHA256.HashData(data)).Chunk(2).Select(c => new string(c)));
    public void Dispose() { Server.Dispose(); Ca.Dispose(); }
}

/// <summary>Per-save P-256 CA: server authentication only, exact own-address /32 name constraints.</summary>
public static class NativeHouseCertificateStore
{
    private static readonly ConcurrentDictionary<string, SemaphoreSlim> Locks = new(StringComparer.OrdinalIgnoreCase);
    public static string DirectoryFor(string database, string? explicitDirectory = null)
    {
        explicitDirectory ??= Environment.GetEnvironmentVariable("SCHELDEMIST_TLS_DIR");
        if (!string.IsNullOrEmpty(explicitDirectory)) return Path.GetFullPath(explicitDirectory);
        string name = Path.GetFileName(database); string folder = name.Equals("game.sqlite", StringComparison.OrdinalIgnoreCase) ? "tls" : "tls-" + Regex.Replace(Regex.Replace(name, @"\.sqlite$", "", RegexOptions.IgnoreCase), "[^A-Za-z0-9._-]", "_");
        if (folder == "tls-") folder += "save";
        return Path.Combine(Path.GetDirectoryName(Path.GetFullPath(database))!, folder);
    }
    public static async Task<NativeHouseCertificates> Ensure(string directory, IEnumerable<string> dns, IEnumerable<string> ips, IEnumerable<string>? extraDns = null, IEnumerable<string>? extraIps = null, DateTimeOffset? at = null)
    {
        string dir = Path.GetFullPath(directory); var gate = Locks.GetOrAdd(dir, _ => new(1, 1)); await gate.WaitAsync().ConfigureAwait(false);
        try
        {
            Directory.CreateDirectory(dir); var now = at ?? DateTimeOffset.UtcNow;
            string[] names = HouseCertificateRules.DnsNames(dns), addresses = HouseCertificateRules.IpNames(ips);
            string[] caNames = HouseCertificateRules.DnsNames(names.Concat(extraDns ?? Array.Empty<string>())), caAddresses = HouseCertificateRules.IpNames(addresses.Concat(extraIps ?? Array.Empty<string>()));
            X509Certificate2? ca = LoadCa(dir, names, addresses, now); bool madeCa = ca == null;
            if (ca == null) { ca = MakeCa(caNames, caAddresses, now); WritePair(dir, "house-ca", ca); }
            try
            {
                X509Certificate2? server = LoadServer(dir, ca, names, addresses, now); bool madeServer = server == null;
                if (server == null) { server = MakeServer(ca, names, addresses, now); WritePair(dir, "server", server); }
                return new(ca, server, names.Concat(addresses).ToArray(), madeCa, madeServer);
            }
            catch { ca.Dispose(); throw; }
        }
        finally { gate.Release(); }
    }
    private static X509Certificate2? LoadPair(string dir, string name)
    {
        try { return X509Certificate2.CreateFromPemFile(Path.Combine(dir, name + ".crt"), Path.Combine(dir, name + ".key")); }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or CryptographicException or ArgumentException) { return null; }
    }
    private static bool ServerAuthOnly(X509Certificate2 c)
    {
        var extension = c.Extensions.OfType<X509EnhancedKeyUsageExtension>().SingleOrDefault();
        return extension != null && extension.EnhancedKeyUsages.Count == 1 && extension.EnhancedKeyUsages[0].Value == HouseCertificateRules.ServerAuth;
    }
    public static bool IsNarrowCa(X509Certificate2 ca)
    {
        try
        {
            var basic = ca.Extensions.OfType<X509BasicConstraintsExtension>().SingleOrDefault();
            var usage = ca.Extensions.OfType<X509KeyUsageExtension>().SingleOrDefault(); var nc = ca.Extensions[HouseCertificateRules.ConstraintsOid];
            if (basic == null || !basic.CertificateAuthority || !basic.HasPathLengthConstraint || basic.PathLengthConstraint != 0 || !basic.Critical || usage == null || !usage.Critical || usage.KeyUsages != (X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign) || nc == null || !nc.Critical || !ServerAuthOnly(ca)) return false;
            var (dns, ranges) = HouseCertificateRules.ReadNameConstraints(nc.RawData);
            return dns.Length > 0 && dns.All(HouseCertificateRules.DnsName) && ranges.Length > 0 && ranges.All(r => r.EndsWith("/32", StringComparison.Ordinal) && HouseCertificateRules.PrivateIp(r[..^3]));
        }
        catch (Exception e) when (e is CryptographicException or AsnContentException or InvalidOperationException) { return false; }
    }
    private static X509Certificate2? LoadCa(string dir, string[] dns, string[] ips, DateTimeOffset now)
    {
        var ca = LoadPair(dir, "house-ca"); if (ca == null) return null;
        try
        {
            var (allowedDns, allowedIps) = HouseCertificateRules.ReadNameConstraints(ca.Extensions[HouseCertificateRules.ConstraintsOid]?.RawData ?? Array.Empty<byte>());
            if (ca.HasPrivateKey && ca.GetECDsaPrivateKey() is { } key)
            {
                using (key) if (key.KeySize == 256 && IsNarrowCa(ca) && ca.NotBefore.ToUniversalTime() <= now.UtcDateTime && ca.NotAfter.ToUniversalTime() - now.UtcDateTime >= TimeSpan.FromDays(30) && dns.All(n => HouseCertificateRules.DnsPermitted(n, allowedDns)) && ips.All(ip => allowedIps.Contains(ip + "/32", StringComparer.Ordinal))) return ca;
            }
        }
        catch (Exception e) when (e is CryptographicException or AsnContentException) { }
        ca.Dispose(); return null;
    }
    private static X509Certificate2? LoadServer(string dir, X509Certificate2 ca, string[] dns, string[] ips, DateTimeOffset now)
    {
        var server = LoadPair(dir, "server"); if (server == null) return null;
        try
        {
            var (hasDns, hasIps) = San(server);
            if (server.HasPrivateKey && server.NotAfter.ToUniversalTime() - now.UtcDateTime >= TimeSpan.FromDays(30) && ServerAuthOnly(server) && hasDns.SequenceEqual(dns) && hasIps.SequenceEqual(ips) && Verify(server, ca, now)) return server;
        }
        catch (Exception e) when (e is CryptographicException or AsnContentException) { }
        server.Dispose(); return null;
    }
    public static bool Verify(X509Certificate2 server, X509Certificate2 ca, DateTimeOffset? at = null)
    {
        using var chain = new X509Chain(); chain.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        chain.ChainPolicy.CustomTrustStore.Add(ca); chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.DisableCertificateDownloads = true; chain.ChainPolicy.ApplicationPolicy.Add(new Oid(HouseCertificateRules.ServerAuth));
        if (at != null) chain.ChainPolicy.VerificationTime = at.Value.UtcDateTime;
        return chain.Build(server) && chain.ChainElements.Count == 2 && chain.ChainElements[1].Certificate.RawData.AsSpan().SequenceEqual(ca.RawData);
    }
    public static (string[] Dns, string[] Ips) San(X509Certificate2 c)
    {
        var dns = new List<string>(); var ips = new List<string>(); var raw = c.Extensions["2.5.29.17"]?.RawData ?? throw new CryptographicException("No SAN.");
        var reader = new AsnReader(raw, AsnEncodingRules.DER); var sequence = reader.ReadSequence(); reader.ThrowIfNotEmpty();
        while (sequence.HasData)
        {
            var tag = sequence.PeekTag();
            if (tag.HasSameClassAndValue(new Asn1Tag(TagClass.ContextSpecific, 2))) dns.Add(sequence.ReadCharacterString(UniversalTagNumber.IA5String, tag));
            else if (tag.HasSameClassAndValue(new Asn1Tag(TagClass.ContextSpecific, 7))) ips.Add(new System.Net.IPAddress(sequence.ReadOctetString(tag)).ToString());
            else sequence.ReadEncodedValue();
        }
        return (dns.OrderBy(n => n, StringComparer.Ordinal).ToArray(), ips.OrderBy(n => n, StringComparer.Ordinal).ToArray());
    }
    private static CertificateRequest Request(ECDsa key, string cn, bool ca)
    {
        var request = new CertificateRequest(new X500DistinguishedName("CN=" + cn), key, HashAlgorithmName.SHA256);
        request.CertificateExtensions.Add(new X509BasicConstraintsExtension(ca, ca, 0, true));
        request.CertificateExtensions.Add(new X509KeyUsageExtension(ca ? X509KeyUsageFlags.KeyCertSign | X509KeyUsageFlags.CrlSign : X509KeyUsageFlags.DigitalSignature, true));
        request.CertificateExtensions.Add(new X509EnhancedKeyUsageExtension(new OidCollection { new Oid(HouseCertificateRules.ServerAuth) }, false));
        request.CertificateExtensions.Add(new X509SubjectKeyIdentifierExtension(request.PublicKey, false)); return request;
    }
    private static byte[] Serial() { var serial = RandomNumberGenerator.GetBytes(16); serial[0] &= 0x7f; if (serial[0] == 0) serial[0] = 1; return serial; }
    private static X509Certificate2 MakeCa(string[] dns, string[] ips, DateTimeOffset now)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256); var request = Request(key, "Scheldemist house CA (" + HouseCertificateRules.HostName(Environment.MachineName) + ")", true);
        request.CertificateExtensions.Add(new X509Extension(HouseCertificateRules.ConstraintsOid, HouseCertificateRules.NameConstraintsDer(dns, ips.Select(ip => (ip, 32))), true));
        using var cert = request.Create(request.SubjectName, X509SignatureGenerator.CreateForECDsa(key), now.AddHours(-1), now.AddDays(3652), Serial()); return cert.CopyWithPrivateKey(key);
    }
    private static X509Certificate2 MakeServer(X509Certificate2 ca, string[] dns, string[] ips, DateTimeOffset now)
    {
        using var key = ECDsa.Create(ECCurve.NamedCurves.nistP256); var request = Request(key, HouseCertificateRules.HostName(Environment.MachineName), false);
        var san = new SubjectAlternativeNameBuilder(); foreach (string name in dns) san.AddDnsName(name); foreach (string ip in ips) san.AddIpAddress(System.Net.IPAddress.Parse(ip)); request.CertificateExtensions.Add(san.Build());
        var authority = new AsnWriter(AsnEncodingRules.DER); authority.PushSequence(); authority.WriteOctetString(Convert.FromHexString(ca.Extensions.OfType<X509SubjectKeyIdentifierExtension>().Single().SubjectKeyIdentifier!), new Asn1Tag(TagClass.ContextSpecific, 0)); authority.PopSequence(); request.CertificateExtensions.Add(new X509Extension("2.5.29.35", authority.Encode(), false));
        using var cert = request.Create(ca, now.AddHours(-1), now.AddDays(397), Serial()); return cert.CopyWithPrivateKey(key);
    }
    private static void WritePair(string dir, string name, X509Certificate2 cert)
    {
        using var key = cert.GetECDsaPrivateKey() ?? throw new CryptographicException("House key unavailable.");
        string path = Path.Combine(dir, name + ".key"); string temporary = path + ".new"; File.WriteAllText(temporary, "");
        if (OperatingSystem.IsWindows())
        {
            using var identity = WindowsIdentity.GetCurrent(); var rights = new FileSecurity(); rights.SetAccessRuleProtection(true, false);
            rights.AddAccessRule(new FileSystemAccessRule(identity.User!, FileSystemRights.FullControl, AccessControlType.Allow)); new FileInfo(temporary).SetAccessControl(rights);
        }
        else File.SetUnixFileMode(temporary, UnixFileMode.UserRead | UnixFileMode.UserWrite);
        File.WriteAllText(temporary, key.ExportPkcs8PrivateKeyPem() + "\n"); File.Move(temporary, path, true);
        File.WriteAllText(Path.Combine(dir, name + ".crt"), cert.ExportCertificatePem() + "\n");
    }
}


