param([switch]$RefreshLegacyOracles)
$ErrorActionPreference='Stop'
if($RefreshLegacyOracles){throw 'Original-source regeneration is retired. Use the retained fixtures; historical capture scripts are in docs/archive/legacy-oracle-tools.'}
$workspace=(Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
if($RefreshLegacyOracles){ & node (Join-Path $PSScriptRoot 'night-oracles.mts');if($LASTEXITCODE -ne 0){throw 'Legacy night oracle recovery failed.'} }
$folder=Join-Path $workspace ('.scratch\native-night-proof-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$sources=[System.Security.SecurityElement]::Escape((Join-Path $workspace 'native-godot\src\Services'))
$project=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'proof\CoreProof.csproj.in') -Raw
$project=$project.Replace('../../native-godot/src/Services',$sources.Replace('\','/'))
Set-Content -LiteralPath (Join-Path $folder 'NightProof.csproj') -Value $project -Encoding utf8
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'proof\NightProof.cs.txt') -Destination (Join-Path $folder 'Program.cs')
& dotnet run --project (Join-Path $folder 'NightProof.csproj') -- $workspace
if($LASTEXITCODE -ne 0){throw 'Native night rule proof failed.'}
