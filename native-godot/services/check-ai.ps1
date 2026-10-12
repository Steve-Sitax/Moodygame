param()
$ErrorActionPreference = 'Stop'
$aiWorkspace = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$aiTest = Join-Path $aiWorkspace ('.scratch\native-ai-' + [Guid]::NewGuid().ToString('N'))
$aiProof = Join-Path $aiWorkspace ('native-godot\proof\native-ai-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $aiTest -Force | Out-Null
$aiSources = [System.Security.SecurityElement]::Escape((Join-Path $aiWorkspace 'native-godot\src\Services').Replace('\','/'))
$aiProject = @"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.30" /><Compile Include="$aiSources/NativeCore*.cs" /><Compile Include="$aiSources/NativeService*.cs" /><Compile Include="$aiSources/NativeGoods.cs" /><Compile Include="$aiSources/NativeAi*.cs" /></ItemGroup></Project>
"@
Set-Content -LiteralPath (Join-Path $aiTest 'AiProof.csproj') -Value $aiProject -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof\AiProof.cs.txt') -Destination (Join-Path $aiTest 'Program.cs')
& dotnet run --project (Join-Path $aiTest 'AiProof.csproj') -- $aiWorkspace $aiProof
if ($LASTEXITCODE -ne 0) { throw 'Native AI proof failed.' }
