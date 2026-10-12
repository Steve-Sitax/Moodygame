param([switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$pressWorkspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $pressWorkspace
try {
    if($RefreshLegacyOracles) { & node (Join-Path $PSScriptRoot 'press-oracles.mts'); if($LASTEXITCODE -ne 0){ throw 'Original press oracle failed.' } }
    $pressTest=Join-Path $pressWorkspace ('.scratch\native-press-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $pressTest | Out-Null
    $pressSources=[System.Security.SecurityElement]::Escape((Join-Path $pressWorkspace 'native-godot/src/Services').Replace('\','/'))
    $pressProject=@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.30" /><Compile Include="$pressSources/NativeCore*.cs" /><Compile Include="$pressSources/NativeService*.cs" /><Compile Include="$pressSources/NativeGoods.cs" /><Compile Include="$pressSources/NativePress.cs" /><Compile Include="$pressSources/NativePress.*.cs" /></ItemGroup></Project>
"@
    Set-Content -LiteralPath (Join-Path $pressTest 'PressProof.csproj') -Value $pressProject -Encoding utf8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/PressProof.cs.txt') -Destination (Join-Path $pressTest 'Program.cs')
    & dotnet run --project (Join-Path $pressTest 'PressProof.csproj') -- $pressWorkspace
    if($LASTEXITCODE -ne 0){ throw 'Native press proof failed.' }
} finally { Pop-Location }
