param([string]$Project = (Join-Path $PSScriptRoot '..'))
$ErrorActionPreference = 'Stop'
$Project = [IO.Path]::GetFullPath($Project)
$proof = Join-Path $Project ('proof/package-data-'+[Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof -Force)
$source = [Security.SecurityElement]::Escape((Join-Path $Project 'src/World/NativePackData.cs'))
[IO.File]::WriteAllText((Join-Path $proof 'Pack.Proof.csproj'),@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable></PropertyGroup><ItemGroup><Compile Include="$source" Link="NativePackData.cs" /></ItemGroup></Project>
"@)
[IO.File]::WriteAllText((Join-Path $proof 'Program.cs'),@'
using System;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.Json.Nodes;
using Scheldemist.Native.World;
string project = args[0], proof = args[1], pack = Path.Combine(project, "world", "data", "pack");
string text = File.ReadAllText(Path.Combine(pack, "manifest.json"));
int checks = 0, reads = 0;
void Check(bool okay, string name) { checks++; if (!okay) throw new Exception(name); }
byte[] Read(string path) { reads++; return File.ReadAllBytes(Path.Combine(pack, path)); }
var cold = NativePackData.Extract(text, Read, Path.Combine(proof,"cold"));
Check(cold.Extracted && reads == cold.Files, "cold extraction checks every logical file");
var manifest = JsonNode.Parse(text)!.AsObject();
foreach (var row in manifest["files"]!.AsArray()) {
    string file = row!["file"]!.GetValue<string>();
    string raw = file.StartsWith("services/") ? Path.Combine(project,"services","data",file[9..]) : file.StartsWith("maps/") ? Path.Combine(project,"world","town","maps",file[5..]) : Path.Combine(project,"world","data",file);
    Check(File.ReadAllBytes(raw).SequenceEqual(File.ReadAllBytes(Path.Combine(cold.Cache,file))), "exact raw bytes: " + file);
}
var warm = NativePackData.Extract(text, _ => throw new Exception("warm cache unexpectedly reads pack"), Path.Combine(proof,"cold"), true);
Check(!warm.Extracted && warm.Cache == cold.Cache, "verified warm cache preserves bytes");
void Refused(string input, string folder, Func<string,byte[]> reader) {
    bool refused = false; try { NativePackData.Extract(input, reader, Path.Combine(proof,folder)); } catch (IOException) { refused = true; }
    Check(refused, "refuse " + folder);
    Check(!Directory.GetFiles(Path.Combine(proof),".complete",SearchOption.AllDirectories).Any(p=>p.Contains(Path.DirectorySeparatorChar+folder+Path.DirectorySeparatorChar)), "no marker for " + folder);
}
foreach (string bad in new[]{"../outside", "/outside", "C:/outside", "maps/../outside", "maps\\outside", "maps//outside"}) {
    var broken = manifest.DeepClone(); broken["files"]![0]!["file"] = bad;
    Refused(broken.ToJsonString(), "path-"+checks, Read);
}
var duplicate = manifest.DeepClone(); duplicate["files"]!.AsArray().Add(duplicate["files"]![0]!.DeepClone());
Refused(duplicate.ToJsonString(),"duplicate",Read);
var corrupt = manifest.DeepClone(); corrupt["files"]![0]!["bytes"] = -1;
Refused(corrupt.ToJsonString(),"negative-size",Read);
Refused(text,"corrupt-blob", _ => new byte[]{1,2,3});
string first = manifest["files"]![0]!["file"]!.GetValue<string>();
File.WriteAllBytes(Path.Combine(cold.Cache,first),new byte[]{0});
bool rejected = false; try { NativePackData.Extract(text,Read,Path.Combine(proof,"cold"),true); } catch (IOException) { rejected = true; }
Check(rejected,"detect corrupted complete cache");
var receipt = new { passed=true, checks, files=cold.Files, bytes=cold.Bytes, version=cold.Version };
File.WriteAllText(Path.Combine(proof,"result.json"),JsonSerializer.Serialize(receipt));
Console.WriteLine(JsonSerializer.Serialize(receipt));
'@)
& dotnet run --project (Join-Path $proof 'Pack.Proof.csproj') -- $Project $proof
if($LASTEXITCODE -ne 0){throw "Native data proof failed: $proof"}
Write-Output "Proof: $proof"
