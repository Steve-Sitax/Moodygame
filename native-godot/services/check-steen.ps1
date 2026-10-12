param([switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){& node (Join-Path $PSScriptRoot 'steen-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Original Steen oracle failed.'}}
$folder=Join-Path $workspace ('.scratch/native-steen-proof-'+[Guid]::NewGuid().ToString('N'));New-Item -ItemType Directory -Path $folder -Force|Out-Null
$source=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'godot/src/People').Replace('\','/'))
Set-Content -LiteralPath (Join-Path $folder 'Proof.csproj') -Value ('<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><Compile Include="'+$source+'/NativeMarketLayout.cs" /><Compile Include="'+$source+'/NativeMarketDressing.cs" /><Compile Include="'+$source+'/NativeSteenRules.cs" /></ItemGroup></Project>') -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/SteenProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
& dotnet run --project (Join-Path $folder 'Proof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native Steen proof failed.'}
