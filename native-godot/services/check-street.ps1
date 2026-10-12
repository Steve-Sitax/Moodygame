param([switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$streetRoot=(Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
Push-Location $streetRoot
try {
    if($RefreshLegacyOracles) { & node (Join-Path $PSScriptRoot 'street-oracles.mts'); if($LASTEXITCODE -ne 0){throw 'Original street incident oracle failed.'} }
    $streetProof=Join-Path $streetRoot ('.scratch/native-street-'+[guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $streetProof | Out-Null
    $streetSources=[System.Security.SecurityElement]::Escape((Join-Path $streetRoot 'native-godot/src/Services').Replace('\','/'))
    $streetProject=@"
<Project Sdk="Microsoft.NET.Sdk"><PropertyGroup><OutputType>Exe</OutputType><TargetFramework>net8.0</TargetFramework><ImplicitUsings>enable</ImplicitUsings><Nullable>enable</Nullable></PropertyGroup><ItemGroup><PackageReference Include="Microsoft.Data.Sqlite" Version="8.0.30" /><Compile Include="$streetSources/NativeCore*.cs" Exclude="$streetSources/NativeCoreIdeas*.cs" /><Compile Include="$streetSources/NativeService*.cs" /><Compile Include="$streetSources/NativeStreetIncidents.cs" /></ItemGroup></Project>
"@
    Set-Content -LiteralPath (Join-Path $streetProof 'StreetProof.csproj') -Value $streetProject -Encoding utf8
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/StreetProof.cs.txt') -Destination (Join-Path $streetProof 'Program.cs')
    & dotnet run --project (Join-Path $streetProof 'StreetProof.csproj') -- $streetRoot
    if($LASTEXITCODE -ne 0){throw 'Native street incident proof failed.'}
} finally {Pop-Location}
