param([switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$songRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $songRoot
try {
    if($RefreshLegacyOracles) { & node (Join-Path $PSScriptRoot 'ballad-oracles.mts'); if($LASTEXITCODE -ne 0){throw 'Original song oracle failed.'} }
    $songProof=Join-Path $songRoot ('.scratch/native-ballads-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $songProof | Out-Null
    $songSources=[System.Security.SecurityElement]::Escape((Join-Path $songRoot 'native-godot/src/Services').Replace('\','/'))
    $songProject=@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.30" /><Compile Include="$songSources/NativeCore*.cs" Exclude="$songSources/NativeCoreIdeas*.cs" /><Compile Include="$songSources/NativeService*.cs" /><Compile Include="$songSources/NativeGoods.cs" /><Compile Include="$songSources/NativeActions.cs" /><Compile Include="$songSources/NativeEvents*.cs" /><Compile Include="$songSources/NativeNorthNarration.cs" /><Compile Include="$songSources/NativeShops.cs" /><Compile Include="$songSources/NativeBallads*.cs" /></ItemGroup></Project>
"@
    Set-Content -LiteralPath (Join-Path $songProof 'SongProof.csproj') -Value $songProject -Encoding utf8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/BalladProof.cs.txt') -Destination (Join-Path $songProof 'Program.cs')
    & dotnet run --project (Join-Path $songProof 'SongProof.csproj') -- $songRoot
    if($LASTEXITCODE -ne 0){throw 'Native song/sermon proof failed.'}
} finally {Pop-Location}
