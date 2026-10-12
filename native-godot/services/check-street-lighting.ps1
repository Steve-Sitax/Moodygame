param([switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){& node --experimental-strip-types (Join-Path $workspace 'native-godot/recovery/full/outer-street-lighting-oracle.mjs');if($LASTEXITCODE -ne 0){throw 'Original street lighting oracle failed.'}}
$folder=Join-Path $workspace ('.scratch\native-street-lighting-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$services=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot/src/Services').Replace('\','/'))
$project=(Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof/CoreProof.csproj.in') -Raw).Replace('../../native-godot/src/Services',$services)
$project=$project.Replace('</Project>','<ItemGroup><Compile Include="'+$services+'/NativeStreetLighting.cs" /><Compile Include="'+$services+'/NativeGoods.cs" /></ItemGroup></Project>')
Set-Content -LiteralPath (Join-Path $folder 'LightingProof.csproj') -Value $project -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof/NativeStreetLightingProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
$output=Join-Path $workspace 'native-godot/proof/native-street-lighting/result.json'
& dotnet run --project (Join-Path $folder 'LightingProof.csproj') -- $workspace $output
if($LASTEXITCODE -ne 0){throw 'Native street lighting proof failed.'}
