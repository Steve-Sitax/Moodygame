param([string]$Project=(Join-Path $PSScriptRoot '..'),[switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
$Project=[IO.Path]::GetFullPath($Project)
if($RefreshLegacyOracles){& node (Join-Path $PSScriptRoot 'capture-posted-lanes.mjs') $Project;if($LASTEXITCODE -ne 0){throw 'Original lane fixture capture failed'}}
$root=[IO.Path]::GetFullPath((Join-Path $Project '..'))
$proof=Join-Path $Project ('proof/posted-lanes-'+[Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$api=[Security.SecurityElement]::Escape((Join-Path $Project '.godot/mono/temp/bin/Debug/GodotSharp.dll'))
$core=[Security.SecurityElement]::Escape((Join-Path $Project '.godot/mono/temp/bin/Debug/Scheldemist.dll'))
$helper=[Security.SecurityElement]::Escape((Join-Path $root 'godot/src/People/PostedLaneKeepouts.cs'))
[IO.File]::WriteAllText((Join-Path $proof 'Proof.csproj'),@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><NoWarn>CS0436</NoWarn></PropertyGroup><ItemGroup><Reference Include="GodotSharp"><HintPath>$api</HintPath></Reference><Reference Include="Scheldemist"><HintPath>$core</HintPath></Reference><Compile Include="$helper" Link="PostedLaneKeepouts.cs" /></ItemGroup></Project>
"@)
[IO.File]::WriteAllText((Join-Path $proof 'Program.cs'),@'
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Scheldemist.People;
var fixture=JsonNode.Parse(File.ReadAllText(args[0]))!;int checks=0;
void Check(bool okay,string name){checks++;if(!okay)throw new Exception(name);}
double N(JsonNode n,string key)=>n[key]!.GetValue<double>();
var lanes=fixture["lanes"]!.AsArray().Select(l=>new PostedLaneKeepouts.Box(N(l!,"minX"),N(l!,"maxX"),N(l!,"minZ"),N(l!,"maxZ"))).ToArray();
foreach(var c in fixture["cases"]!.AsArray()){
 double x=N(c!,"x"),z=N(c!,"z");string mode=c!["mode"]!.GetValue<string>();
 bool Ground(double cx,double cz)=>mode=="blocked-all"?false:mode=="blocked-north"?cz<z-.2:true;
 var at=PostedLaneKeepouts.Position(lanes,x,z,Ground);var expected=c["at"]!;
 Check(Math.Abs(at.X-expected[0]!.GetValue<double>())<1e-10&&Math.Abs(at.Z-expected[1]!.GetValue<double>())<1e-10,"original candidate selection "+checks);
}
var current=PostedLaneKeepouts.Current();
Check(current.Count>1000&&current.Count<lanes.Length,"native omnibus selectors independently supply all three loops");
Check(current.Select((b,i)=>Math.Abs(b.MinX-lanes[i].MinX)<.002&&Math.Abs(b.MaxX-lanes[i].MaxX)<.002&&Math.Abs(b.MinZ-lanes[i].MinZ)<.002&&Math.Abs(b.MaxZ-lanes[i].MaxZ)<.002).All(b=>b),"native omnibus lane geometry matches original source samples");
var northSouth=new[]{new PostedLaneKeepouts.Box(-1,1,-100,100)};
var sideways=PostedLaneKeepouts.Position(northSouth,0,0,(_,_)=>true);
Check(Math.Abs(sideways.X)>1.4&&PostedLaneKeepouts.Clear(northSouth,sideways.X,sideways.Z),"sideways escape from a north/south lane");
Check(PostedLaneKeepouts.Clear(northSouth,1.4,0)&&!PostedLaneKeepouts.Clear(northSouth,1.399,0),"source strict border and .4 metre padding");
var receipt=new{passed=true,checks,sourceCases=fixture["cases"]!.AsArray().Count,laneBoxes=lanes.Length,nativeOmnibusBoxes=current.Count};
File.WriteAllText(Path.Combine(args[1],"result.json"),System.Text.Json.JsonSerializer.Serialize(receipt));Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(receipt));
'@)
& dotnet run --project (Join-Path $proof 'Proof.csproj') -- (Join-Path $Project 'services/fixtures/native-posted-lanes.json') $proof
if($LASTEXITCODE -ne 0){throw "Posted lane proof failed: $proof"}
Write-Output "Proof: $proof"
