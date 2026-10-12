param([string]$Project=(Join-Path $PSScriptRoot '..'))
$ErrorActionPreference='Stop'
$Project=[IO.Path]::GetFullPath($Project)
$root=[IO.Path]::GetFullPath((Join-Path $Project '..'))
$proof=Join-Path $Project ('proof/gull-perches-'+[Guid]::NewGuid().ToString('N'))
[void](New-Item -ItemType Directory -Path $proof)
$api=[Security.SecurityElement]::Escape((Join-Path $Project '.godot/mono/temp/bin/Debug/GodotSharp.dll'))
$core=[Security.SecurityElement]::Escape((Join-Path $Project '.godot/mono/temp/bin/Debug/Scheldemist.dll'))
$helper=[Security.SecurityElement]::Escape((Join-Path $root 'godot/src/World/GullPerches.cs'))
[IO.File]::WriteAllText((Join-Path $proof 'Proof.csproj'),@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><NoWarn>CS0436</NoWarn></PropertyGroup><ItemGroup><Reference Include="GodotSharp"><HintPath>$api</HintPath></Reference><Reference Include="Scheldemist"><HintPath>$core</HintPath></Reference><Compile Include="$helper" Link="GullPerches.cs" /></ItemGroup></Project>
"@)
[IO.File]::WriteAllText((Join-Path $proof 'Program.cs'),@'
using System;
using System.IO;
using System.Linq;
using System.Text.Json.Nodes;
using Godot;
using Scheldemist.World;
var fixture=JsonNode.Parse(File.ReadAllText(args[0]))!;int checks=0;
void Check(bool okay,string name){checks++;if(!okay)throw new Exception(name);}
Vector3 Point(JsonNode n)=>new(n[0]!.GetValue<float>(),n[1]!.GetValue<float>(),n[2]!.GetValue<float>());
GullPerches.Geometry Shape(JsonNode n)=>new(n["positions"]!.AsArray().Select(p=>Point(p!)).ToArray(),n["uv"]!.AsArray().Select(p=>new Vector2(p![0]!.GetValue<float>(),p[1]!.GetValue<float>())).ToArray(),n["indices"]!.AsArray().Select(i=>i!.GetValue<int>()).ToArray());
var target=fixture["target"]!.AsArray().Select(g=>Shape(g!)).ToArray();
var prototypes=fixture["prototypes"]!.AsArray().Select(p=>(shape:Shape(p!["shape"]!),top:Point(p["top"]!),height:p["height"]!.GetValue<float>())).ToArray();
var original=GullPerches.Match(target,prototypes);
Check(original.Count==6,"actual original chunk has six cannon bollards, verified by their distinct model triangle");
Check(original.All(p=>Math.Abs(p.Top.Y-.875f)<.005f),"places lie on model caps, not below the quay");
Check(GullPerches.Match(target.Concat(target).ToArray(),prototypes).Count==original.Count,"duplicate chunk geometry does not duplicate perches");
var pose=new Transform3D(new Basis(Vector3.Up,.73f),new Vector3(-37,2,14));
var moved=target.Select(g=>g with {Positions=g.Positions.Select(p=>pose*p).ToArray()}).ToArray();
var transformed=GullPerches.Match(moved,prototypes);
Check(transformed.Count==original.Count,"arbitrary authored translation/rotation retain perches");
Check(original.All(p=>transformed.Any(q=>q.Top.DistanceTo(pose*p.Top)<.025f)),"caps follow actual transformed geometry");
Check(GullPerches.Match(target.Select(g=>g with {Uv=g.Uv.Select(u=>u+Vector2.One).ToArray()}).ToArray(),prototypes).Count==0,"similar shape with unrelated material UVs is refused");
var first=prototypes[0].shape;
var fragment=new GullPerches.Geometry(first.Positions.Take(3).ToArray(),first.Uv.Take(3).ToArray(),new[]{0,1,2});
Check(GullPerches.Match(new[]{fragment},prototypes).Count==0,"matching fragment cannot fabricate a whole bollard");
var receipt=new {passed=true,checks,sourcePerches=original.Count,places=original.Select(p=>new[]{p.Top.X,p.Top.Y,p.Top.Z})};
File.WriteAllText(Path.Combine(args[1],"result.json"),System.Text.Json.JsonSerializer.Serialize(receipt));
Console.WriteLine(System.Text.Json.JsonSerializer.Serialize(receipt));
'@)
& dotnet run --project (Join-Path $proof 'Proof.csproj') -- (Join-Path $Project 'services/fixtures/native-gull-perches.json') $proof
if($LASTEXITCODE -ne 0){throw "Gull geometry proof failed: $proof"}
Write-Output "Proof: $proof"
